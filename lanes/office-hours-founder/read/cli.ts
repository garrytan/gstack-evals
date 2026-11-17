// Copyright (c) 2026 Garry Tan. MIT License.
// The readings' commands for gstack-evals of (prereg wiki/plans/2026-11-09-geva-418-office-hours-founder-evidence-prereg,
// sections 10 to 13 and 16). The lane's cli.ts merges these rows into its table. None makes a model call or spends:
//   stage1      section 10's readings in read order from the scored sessions, the stock credits, the judge check's cells
//               and the fidelity audit's outcome; writes stage1.json.
//   projection  the stage 1 re-estimate, power.py's rerun, the allowances after the smoke and the per-item money
//               projection with the cut order, on the approved item caps and the ledger record's spend; writes
//               projection.json and allowances.json (the file of run --allowances reads).
//   stage2      section 11's readings from the scored sessions against the frozen manifests; writes stage2.json.
//   headline    section 16's bullets from stage2.json.
// Every data path must sit outside the repo, an output file is written once, and the commands print counts, digests and
// readings, never unit text. Every error line on stderr starts with its reason code.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { CODES, isReasonCode } from "../../../src/errors/codes.ts";
import { recordPath } from "../../../src/runner/ledger/paths.ts";
import { readItem } from "../../../src/runner/ledger/record.ts";
import { insideRepo } from "../../review-noloss/suite.ts";
import { ITEMS as LEDGER_ITEMS } from "../dryrun.ts";
import { MODELS } from "../frozen.ts";
import { cellRounds, loadUnits, readManifest, type Cell } from "../run/manifest.ts";
import { goldCells, type BlockRef, type PacketMap, type PacketMeta } from "../score/packets.ts";
import { PRODUCTION_LABEL, type ScoreLabel } from "../score/score.ts";
import type { AuditOutcome } from "../sim/fidelity.ts";
import type { ManifestEntry, ModelId, ScoredSession, StockCredit, UnitMeta, WItem } from "../types.ts";
import { headlines } from "./headline.ts";
import { allowances, ITEMS, medians, moneyProjection, powerMdd, projectionRerun, python3, type Python, type Rerun } from "./projection.ts";
import { MODEL_NAME, readStage1, type AuditResult, type CheckCell, type JudgeInput, type NearMissCell, type Stage1Reading } from "./stage1.ts";
import { readStage2, type Stage2Reading } from "./stage2.ts";

interface Io {
  out: (text: string) => void;
  err: (text: string) => void;
}
type Env = Record<string, string | undefined>;
type Kind = "one" | "many" | "bool";
type Flags = { one: (k: string) => string; maybe: (k: string) => string | undefined; many: (k: string) => string[]; has: (k: string) => boolean };
export interface Command {
  summary: string;
  run: (argv: string[], io: Io, env: Env) => Promise<number>;
}

class Refusal extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}
const refuse = (message: string, code = "E_USAGE"): never => {
  throw new Refusal(code, message);
};

function parse(argv: readonly string[], spec: Readonly<Record<string, Kind>>, required: readonly string[]): Flags {
  const got = new Map<string, string[]>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const kind = spec[a] ?? refuse("unknown argument " + JSON.stringify(a));
    if (kind === "bool") {
      got.set(a, []);
      continue;
    }
    const v = argv[++i];
    if (v === undefined || v.startsWith("--")) refuse(a + " needs a value");
    if (kind === "one" && got.has(a)) refuse(a + " is given once");
    got.set(a, [...(got.get(a) ?? []), v!]);
  }
  for (const k of required) if (!got.has(k)) refuse("needs " + k);
  return { one: (k) => got.get(k)![0]!, maybe: (k) => got.get(k)?.[0], many: (k) => got.get(k) ?? [], has: (k) => got.has(k) };
}

const command = (name: string, summary: string, usage: string, spec: Readonly<Record<string, Kind>>, required: readonly string[], body: (f: Flags, io: Io, env: Env) => number): Command => ({
  summary,
  run: async (argv, io, env) => {
    if (argv.includes("--help")) {
      io.out(usage);
      return 0;
    }
    try {
      return body(parse(argv, spec, required), io, env);
    } catch (e) {
      const message = String((e as Error).message ?? e);
      const lead = /^(E_[A-Z0-9_]+) /.exec(message)?.[1];
      const named = e instanceof Refusal ? e.code : lead;
      const code = named && isReasonCode(named) ? named : "E_INTERNAL";
      io.err(code + " of " + name + ": " + message.replace(/^E_[A-Z0-9_]+ /, "") + (e instanceof Refusal ? "\n" + code + " usage: " + usage.split("\n")[0] : ""));
      return CODES[code].exit ?? 1;
    }
  },
});

const sha256 = (t: string) => createHash("sha256").update(t).digest("hex");

/** A data path outside the repo: units, scored sessions, packets, labels and outputs stay sealed there. */
function sealed(path: string, what: string): string {
  const abs = resolve(path);
  if (insideRepo(abs)) refuse(what + " " + abs + " is inside the repo, and eval data stays sealed outside it");
  return abs;
}
function readInput(path: string, what: string): { path: string; text: string } {
  const abs = sealed(path, what);
  if (!existsSync(abs)) refuse(what + " " + abs + " does not exist");
  return { path: abs, text: readFileSync(abs, "utf8") };
}
const json = <T>(path: string, what: string): T => {
  const { text } = readInput(path, what);
  try {
    return JSON.parse(text) as T;
  } catch {
    return refuse(what + " " + path + " is not JSON");
  }
};
/** Every line of each file, each a JSON object holding the named fields. */
function ndjson<T>(paths: readonly string[], what: string, fields: readonly string[]): T[] {
  return paths.flatMap((p) =>
    readInput(p, what).text.split("\n").filter((l) => l.trim()).map((l, i) => {
      let v: Record<string, unknown>;
      try {
        v = JSON.parse(l);
      } catch {
        return refuse(what + " " + p + " line " + (i + 1) + " is not JSON");
      }
      for (const k of fields) if (!(k in v)) refuse(what + " " + p + " line " + (i + 1) + " has no " + k);
      return v as T;
    }),
  );
}
/** Writes one reading file; a reading is written once, so an existing file refuses. */
function writeOnce(dir: string, name: string, data: unknown, io: Io): void {
  const out = sealed(dir, "--out");
  mkdirSync(out, { recursive: true, mode: 0o700 });
  const file = join(out, name);
  if (existsSync(file)) refuse(file + " exists, and a reading is written once; pass a new --out");
  const text = JSON.stringify(data, null, 2) + "\n";
  writeFileSync(file, text, { mode: 0o600, flag: "wx" });
  io.out("wrote " + file + " sha256 " + sha256(text));
}

const SESSION_FIELDS = ["stage", "kind", "unit", "model", "arm", "pass", "end", "W", "repairs"] as const;
const scoredFrom = (f: Flags) => ndjson<ScoredSession>(f.many("--scored"), "--scored", SESSION_FIELDS);
const stockFrom = (f: Flags) => ndjson<StockCredit>(f.many("--stock"), "--stock", ["stage", "model", "row", "unit", "W"]);
const labelsFrom = (paths: readonly string[], what: string) => ndjson<ScoreLabel>(paths, what, ["packet", "block", "judge", "customer", "wedge"]);
const unitsFrom = (f: Flags): UnitMeta[] => {
  const dir = sealed(f.one("--units-dir"), "--units-dir");
  if (!existsSync(dir)) refuse("--units-dir " + dir + " does not exist");
  return loadUnits(dir);
};
const idsIn = (units: readonly UnitMeta[], set: UnitMeta["set"]) => units.filter((u) => u.set === set).map((u) => u.id).sort();
const entryKey = (e: ManifestEntry) => [e.stage, e.kind, e.model, e.arm, e.unit, "p" + e.pass].join("/");

/** The repairs whose re-smoke is a second smoke round (smoke rule 4). */
const SMOKE_REPAIRS = ["forced-line", "limit-30"];
const resmoked = (s: ScoredSession) => s.repairs.some((r) => SMOKE_REPAIRS.includes(r));

/** The sessions in force: for each scheduled session, the version with the most repairs, which the repair's rerun wrote. */
function inForce(xs: readonly ScoredSession[]): ScoredSession[] {
  const by = new Map<string, ScoredSession>();
  for (const s of xs) {
    const o = by.get(entryKey(s));
    if (o && o.repairs.length === s.repairs.length) refuse("--scored holds two sessions for " + entryKey(s) + " under the same repairs");
    if (!o || s.repairs.length > o.repairs.length) by.set(entryKey(s), s);
  }
  return [...by.values()];
}

const refKey = (r: BlockRef) => JSON.stringify(r);
const signature = (p: PacketMeta) => p.model + "|" + p.unit + "|" + Object.values(p.blocks).map(refKey).sort().join(",");
const labelIndex = (labels: readonly ScoreLabel[]) => new Map(labels.map((l) => [l.packet + "|" + l.block + "|" + l.judge, l]));

/**
 * The judge check's cells per production judge: each gold cell of the check pass (Astra and Opus agree) found again in
 * the stage 1 production packet with the same blocks, and scored on that model's production label; and the near-miss
 * anchors' cells from the production anchor packets. Near-miss blocks have labels fixed by construction and stock row 3
 * is never an anchor, so neither is a gold cell.
 */
export function judgeInputs(check: PacketMap, checkLabels: readonly ScoreLabel[], prod: PacketMap, labels: readonly ScoreLabel[]): Record<ModelId, JudgeInput> {
  if (check.kind !== "check") refuse("--check-map is not a judge check map");
  if (prod.kind !== "label" || prod.stage !== 1) refuse("--map is not stage 1's production label map");
  const bySignature = new Map(Object.values(prod.packets).filter((p) => p.role !== "shuffled").map((p) => [signature(p), p]));
  const label = labelIndex(labels);
  const fresh = () => ({ cells: [] as CheckCell[], unlabelled: 0, near_miss: [] as NearMissCell[] });
  const out = { opus: fresh(), sol: fresh(), particle: fresh() };
  for (const g of goldCells(check, checkLabels)) {
    const cp = check.packets[g.packet]!;
    const ref = cp.blocks[g.block]!;
    if (ref.kind === "near-miss" || (ref.kind === "stock" && ref.row === 3)) continue;
    const pp = bySignature.get(signature(cp)) ?? refuse("the check packet " + g.packet + " has no production packet with the same blocks");
    const block = Object.entries(pp.blocks).find(([, r]) => refKey(r) === refKey(ref))![0];
    const judged = label.get(pp.id + "|" + block + "|" + PRODUCTION_LABEL[pp.model])?.[g.item] ?? null;
    if (judged === null) out[pp.model].unlabelled++;
    else out[pp.model].cells.push({ gold: g.gold, judged, kind: ref.kind === "session" ? "arm" : ref.kind === "oracle" ? "oracle" : "stock", list: pp.id + "|" + block });
  }
  for (const p of Object.values(prod.packets))
    for (const [id, ref] of Object.entries(p.blocks))
      if (p.role === "anchor" && ref.kind === "near-miss")
        for (const item of ["customer", "wedge"] as const) out[p.model].near_miss.push({ expected: ref.expect[item], judged: label.get(p.id + "|" + id + "|" + PRODUCTION_LABEL[p.model])?.[item] ?? null });
  return out;
}

/** The stage 2 gold re-check: each gold packet's inserted cells against its model's production labels. */
export function goldInputs(maps: readonly PacketMap[], labels: readonly ScoreLabel[]): Record<ModelId, Array<{ gold: boolean; judged: boolean | null }>> {
  const label = labelIndex(labels);
  const out = Object.fromEntries(MODELS.map((m) => [m, [] as Array<{ gold: boolean; judged: boolean | null }>])) as Record<ModelId, Array<{ gold: boolean; judged: boolean | null }>>;
  for (const map of maps)
    for (const p of Object.values(map.packets))
      for (const g of p.role === "gold" ? (p.gold ?? []) : []) out[p.model].push({ gold: g.gold, judged: label.get(p.id + "|" + g.block + "|" + PRODUCTION_LABEL[p.model])?.[g.item as WItem] ?? null });
  return out;
}

/** sim/fidelity.ts's stage 1 outcome as the reading takes it; repaired says the sim-prompt rerun is in force. */
export function stage1Audit(o: AuditOutcome, repaired: boolean): AuditResult {
  if (o.read === "pass") return { pass: true, no_read: false, repaired };
  if (o.read === "repair") return { pass: false, no_read: false, repaired: false };
  if (o.read === "fix-method") return { pass: false, no_read: false, repaired: true };
  if (o.read === "no-read") return { pass: false, no_read: true, repaired };
  return refuse("--audit reads " + o.read + ", which is a stage 2 outcome");
}

const STAGE1_USAGE = [
  "gstack-evals of stage1 --units-dir <dir> --scored <scored.ndjson>... --stock <stock.ndjson>... --audit <outcome.json>",
  "    --map <stage 1 label map> --labels <labels.ndjson>... --check-map <check map> --check-labels <labels.ndjson>... --out <dir> [--ceiling-attempt]",
].join("\n");

function stage1Command(f: Flags, io: Io): number {
  const units = unitsFrom(f);
  const raw = scoredFrom(f).filter((s) => s.stage === 1);
  const isSmoke = (s: ScoredSession) => s.kind === "arm" && s.arm === "office-hours";
  const sessions = inForce(raw.filter((s) => !isSmoke(s)));
  const smoke = inForce(raw.filter((s) => isSmoke(s) && !resmoked(s)));
  const resmoke = inForce(raw.filter((s) => isSmoke(s) && resmoked(s)));
  const judges = judgeInputs(json<PacketMap>(f.one("--check-map"), "--check-map"), labelsFrom(f.many("--check-labels"), "--check-labels"), json<PacketMap>(f.one("--map"), "--map"), labelsFrom(f.many("--labels"), "--labels"));
  const audit = stage1Audit(json<AuditOutcome>(f.one("--audit"), "--audit"), sessions.some((s) => s.repairs.includes("sim-prompt")));
  const reading: Stage1Reading = readStage1({ sessions, units, audit, judges, stock: stockFrom(f), smoke, resmoke, ceiling_attempt: f.has("--ceiling-attempt") });
  io.out("of stage1: " + units.length + " units, " + sessions.length + " sessions in force, " + smoke.length + " smoke and " + resmoke.length + " re-smoke sessions");
  for (const l of reading.lines) io.out(l);
  io.out("ends: " + (reading.ends ?? "nothing ends the eval"));
  for (const m of MODELS) if (reading.untested[m].length || reading.smoke_drop[m]) io.out(MODEL_NAME[m] + " reads untested: " + [...reading.untested[m], ...(reading.smoke_drop[m] ? ["smoke (office-hours contrasts)"] : [])].join(", "));
  io.out("stage 2 may start: " + (reading.ready ? "yes, once the projection rerun fits" : "no"));
  for (const code of reading.codes) io.err(code + " of stage1: " + (reading.ends ?? "a model's contrasts read untested; see the lines above"));
  writeOnce(f.one("--out"), "stage1.json", { reading }, io);
  return 0;
}

/** The "## Item caps" section of the approvals: one "<item> $<dollars>" line per ledger item, every item listed once. */
export function itemCaps(markdown: string): Map<string, number> {
  const section = /^## Item caps[ \t]*$([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(markdown)?.[1] ?? refuse("--approvals has no ## Item caps section");
  const caps = new Map<string, number>();
  for (const line of section.split("\n").map((l) => l.trim()).filter(Boolean)) {
    const m = /^(?:[-*]\s+)?`?([a-z0-9-]+)`?\s+\$([0-9][0-9,]*(?:\.[0-9]+)?)$/.exec(line) ?? refuse("--approvals: the Item caps line " + JSON.stringify(line) + " is not \"<item> $<dollars>\"");
    if (!(LEDGER_ITEMS as readonly string[]).includes(m[1]!)) refuse("--approvals names item " + m[1] + ", which is not one of the eval's ledger items");
    if (caps.has(m[1]!)) refuse("--approvals lists " + m[1] + " twice");
    caps.set(m[1]!, Number(m[2]!.replace(/,/g, "")));
  }
  const missing = LEDGER_ITEMS.filter((i) => !caps.has(i));
  if (missing.length) refuse("--approvals lists no cap for " + missing.join(", "));
  return caps;
}

const PROJECTION_USAGE = [
  "gstack-evals of projection --units-dir <dir> --scored <stage 1 scored.ndjson>... --map <stage 1 label map> --approvals <file.md>",
  "    --ceiling <usd> --out <dir> [--record <dir>] [--extra <item>=<usd>]...",
].join("\n");

function projectionCommand(f: Flags, io: Io, env: Env, python: Python): number {
  const units = unitsFrom(f);
  const stage1 = scoredFrom(f).filter((s) => s.stage === 1);
  const comparison = idsIn(units, "comparison");
  if (!comparison.length) refuse("--units-dir holds no comparison unit");
  const caps = itemCaps(readFileSync(resolve(f.one("--approvals")), "utf8"));
  const ceiling = Number(f.one("--ceiling"));
  if (!(ceiling > 0)) refuse("--ceiling must be a positive number of dollars");
  const record = recordPath(f.maybe("--record"), env).path;
  const spent = (item: string) => readItem(record, item).committed_micros / 1_000_000;
  const extra = new Map(f.many("--extra").map((x) => {
    const [item, usd] = x.split("=");
    if (!(LEDGER_ITEMS as readonly string[]).includes(item!) || !(Number(usd) >= 0)) refuse("--extra takes <item>=<usd> on a ledger item, not " + JSON.stringify(x));
    return [item!, Number(usd)] as const;
  }));
  const packets = Object.keys(json<PacketMap>(f.one("--map"), "--map").packets).length;
  const perPacket = packets ? spent("of-s1-labels") / packets : 0;
  if (!(perPacket > 0)) refuse("the per-packet label cost needs stage 1's label packets in --map and spend on of-s1-labels in the ledger record");
  const rerun: Rerun = projectionRerun(inForce(stage1), idsIn(units, "calibration"), comparison.length, python);
  const allow = allowances(stage1);
  const med = medians(stage1);
  const per = (x: number) => Object.fromEntries(MODELS.map((m) => [m, x])) as Record<ModelId, number>;
  const money = moneyProjection({
    comparison,
    real: idsIn(units, "real"),
    cost: { session: med.session, sim: med.sim, pitch: med.session, packet: per(2 * perPacket), pitch_packet: per(perPacket) },
    items: Object.fromEntries(ITEMS.map((x) => [x, { cap: caps.get(x)!, spent: spent(x), extra: extra.get(x) ?? 0 }])) as Parameters<typeof moneyProjection>[0]["items"],
    others: LEDGER_ITEMS.filter((x) => !(ITEMS as readonly string[]).includes(x)).map((x) => ({ name: x, cap: caps.get(x)!, spent: spent(x), projected: extra.get(x) ?? 0 })),
    ceiling,
  });
  io.out("of projection: " + comparison.length + " comparison units, " + stage1.length + " stage 1 sessions, " + packets + " stage 1 label packets");
  for (const m of MODELS) {
    const e = rerun.estimates[m], d = rerun.mdd[m];
    io.out(MODEL_NAME[m] + ": control " + e.p0 + ", ICC " + e.rho + ", shuffled-key credit " + e.s + " over " + e.units + " units; at " + rerun.units + " units and " + d.passes + " passes, W MDD " + (d.w ?? "over 0.50") + ", guard-rule MDD " + (d.guard ?? "over 0.50"));
  }
  io.out(rerun.next);
  for (const x of money.items) io.out("item " + x.name + ": spent " + x.spent + ", projected " + x.projected + ", cap " + x.cap + (x.fits ? "" : ", over its cap"));
  io.out("line: " + money.total + " against the ceiling " + ceiling + "; cuts " + (money.cuts.join(", ") || "none") + (money.captain ? "; to the Captain: " + money.captain : ""));
  io.out("stage 2 may start on the projection: " + (rerun.opus_ok && !money.captain ? "yes" : "no"));
  writeOnce(f.one("--out"), "projection.json", { rerun, allowances: allow, medians: med, packet_usd: perPacket, money }, io);
  writeOnce(f.one("--out"), "allowances.json", allow, io);
  return 0;
}

const STAGE2_USAGE = [
  "gstack-evals of stage2 --units-dir <dir> --scored <scored.ndjson>... --stock <stock.ndjson>... --manifest <manifest.json>...",
  "    --stage1 <stage1.json> --projection <projection.json> --map <stage 2 label map>... --labels <labels.ndjson>... --audit <outcome.json>",
  "    --out <dir> [--arm-guess <correct>/<total>]",
].join("\n");

function stage2Command(f: Flags, io: Io, python: Python): number {
  const units = unitsFrom(f);
  const launches = f.many("--manifest").map((p) => {
    const path = readInput(p, "--manifest").path;
    const stops = join(dirname(path), "stops.json");
    return { m: readManifest(path), stopped: existsSync(stops) && (JSON.parse(readFileSync(stops, "utf8")) as { stops: unknown[] }).stops.length > 0 };
  });
  const entries = (cell: Cell) => cellRounds(cell, launches.filter((l) => l.m.cell === cell).flatMap((l) => l.m.entries)).flat();
  const primary = entries("stage2");
  if (!primary.length) refuse("--manifest needs the stage2 cell's frozen manifest");
  const stage1 = json<{ reading: Stage1Reading }>(f.one("--stage1"), "--stage1").reading;
  const est = json<{ rerun: Rerun }>(f.one("--projection"), "--projection").rerun.estimates;
  const audit = json<AuditOutcome>(f.one("--audit"), "--audit");
  if (audit.read !== "pass" && audit.read !== "void" && audit.read !== "no-read") refuse("--audit reads " + audit.read + ", which is a stage 1 outcome");
  const guess = f.maybe("--arm-guess");
  const [correct, total] = guess ? guess.split("/").map(Number) : [0, 0];
  if (!(Number.isInteger(correct) && Number.isInteger(total) && correct! >= 0 && correct! <= total!)) refuse("--arm-guess takes <correct>/<total>");
  const sessions = scoredFrom(f).filter((s) => s.stage === 2);
  const reading: Stage2Reading = readStage2({
    manifest: primary,
    real_manifest: entries("real"),
    pitch_manifest: entries("pitch"),
    sessions,
    units,
    stage1,
    stock: stockFrom(f),
    gold: goldInputs(f.many("--map").map((p) => json<PacketMap>(p, "--map")), labelsFrom(f.many("--labels"), "--labels")),
    voided: audit.read !== "pass",
    stopped: launches.some((l) => l.m.cell === "stage2" && l.stopped),
    pitch_stopped: launches.some((l) => l.m.cell === "pitch" && l.stopped),
    arm_guess: { correct: correct!, total: total! },
    mdd: (model, n, passes) => powerMdd([{ p0: est[model].p0, rho: est[model].rho, s: est[model].s, n, passes }], python)[0]!.w,
  });
  io.out("of stage2: " + primary.length + " scheduled primary sessions, " + entries("pitch").length + " pitch-only and " + entries("real").length + " real-stratum, " + sessions.length + " stage 2 sessions scored");
  for (const m of MODELS) {
    const r = reading.models[m];
    const name = MODEL_NAME[m];
    for (const c of Object.values(r.contrasts)) io.out(name + " " + c.name + ": " + (c.w ? "W " + c.w.delta + " (95% interval " + (c.w.ci95?.join(" to ") ?? "n/a") + ", p " + c.w.p + ", " + c.w.units + " units, " + c.w.worse + " worse)" : "no matched pass") + "; " + c.verdict + " (" + c.why + ")");
    for (const l of r.reading.lines) io.out(name + ": " + l);
    for (const c of r.cells) io.out(name + " " + c.arm + ": " + c.scheduled + " scheduled, missing " + c.missing_rate + ", no block " + c.no_block_rate + ", arm stop " + c.arm_stop_rate + ", gstack reads " + c.gstack_rate + ", shuffled-key complete " + c.specificity_rate);
    io.out(name + ": exposure " + (r.exposure.rate ?? "n/a") + " over " + r.exposure.sessions + " sessions; effective units " + r.effective_units + ", MDD " + (r.mdd ?? "over 0.50"));
    io.out(name + " pitch-only: office-hours minus none " + (r.pitch.diff?.delta ?? "n/a") + ", the conversation's part " + (r.pitch.part?.delta ?? "n/a") + "; headline condition " + (r.pitch.condition ? "holds" : "does not hold"));
    io.out(name + " real stratum: office-hours minus none on W " + (r.real.W?.delta ?? "n/a"));
  }
  if (reading.models.opus.interim) io.out("interim stop: " + reading.models.opus.interim.exposed + " of " + reading.models.opus.interim.sessions + " exposed" + (reading.models.opus.interim.stop ? ", the Opus office-hours arm stops" : ""));
  io.out("arm guess: " + (total ? reading.arm_guess.rate + (reading.arm_guess.flag ? ", above 0.70, flagged" : "") : "not given"));
  if (reading.real_opposite) io.out("the real stratum's Opus difference has the opposite sign from the primary's");
  for (const code of reading.codes) io.err(code + " of stage2: see the readings above");
  writeOnce(f.one("--out"), "stage2.json", { reading }, io);
  return 0;
}

function headlineCommand(f: Flags, io: Io): number {
  const reading = json<{ reading: Stage2Reading }>(f.one("--stage2"), "--stage2").reading;
  const next: Partial<Record<ModelId, string>> = {};
  for (const x of f.many("--next")) {
    const at = x.indexOf("=");
    const model = x.slice(0, at) as ModelId;
    if (at < 1 || !MODELS.includes(model) || !x.slice(at + 1).trim()) refuse("--next takes <model>=<what the next attempt changes>, with model one of " + MODELS.join(", "));
    next[model] = x.slice(at + 1).trim();
  }
  const owed = MODELS.filter((m) => ["untested", "not shown"].includes(reading.models[m].contrasts["office-hours-none"].verdict) && !next[m]);
  if (owed.length) refuse("the " + owed.map((m) => MODEL_NAME[m]).join(" and ") + " headline reads untested or not shown and needs --next " + owed[0] + "=<what the next attempt changes>");
  io.out(headlines(reading, next).join("\n\n"));
  return 0;
}

/** The commands with power.py's runner injected, so tests make no subprocess call. */
export function makeCommands(deps: { python: Python }): Record<string, Command> {
  return {
    stage1: command("stage1", "section 10's stage 1 readings in read order, and whether stage 2 may start", STAGE1_USAGE, { "--units-dir": "one", "--scored": "many", "--stock": "many", "--audit": "one", "--map": "one", "--labels": "many", "--check-map": "one", "--check-labels": "many", "--out": "one", "--ceiling-attempt": "bool" }, ["--units-dir", "--scored", "--stock", "--audit", "--map", "--labels", "--check-map", "--check-labels", "--out"], (f, io) => stage1Command(f, io)),
    projection: command("projection", "the projection rerun before stage 2: re-estimate, power.py, allowances and the money projection", PROJECTION_USAGE, { "--units-dir": "one", "--scored": "many", "--map": "one", "--approvals": "one", "--ceiling": "one", "--record": "one", "--extra": "many", "--out": "one" }, ["--units-dir", "--scored", "--map", "--approvals", "--ceiling", "--out"], (f, io, env) => projectionCommand(f, io, env, deps.python)),
    stage2: command("stage2", "section 11's stage 2 readings against the frozen manifests", STAGE2_USAGE, { "--units-dir": "one", "--scored": "many", "--stock": "many", "--manifest": "many", "--stage1": "one", "--projection": "one", "--map": "many", "--labels": "many", "--audit": "one", "--arm-guess": "one", "--out": "one" }, ["--units-dir", "--scored", "--stock", "--manifest", "--stage1", "--projection", "--map", "--labels", "--audit", "--out"], (f, io) => stage2Command(f, io, deps.python)),
    headline: command("headline", "section 16's fixed opening bullets from stage2.json", "gstack-evals of headline --stage2 <stage2.json> [--next <model>=<what the next attempt changes>]...", { "--stage2": "one", "--next": "many" }, ["--stage2"], (f, io) => headlineCommand(f, io)),
  };
}

export const commands: Record<string, Command> = makeCommands({ python: python3 });
