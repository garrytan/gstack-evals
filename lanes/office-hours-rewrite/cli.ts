// Copyright (c) 2026 Garry Tan. MIT License.
// gstack-evals ohr: the office-hours rewrite eval's commands (prereg wiki/plans/2026-11-17-geva-552-office-hours-rewrite-prereg
// and its dated pre-run changes). Each command's work lives in its area; this file reads flags, opens the wire's metered
// client where a command spends, and writes outputs. Every output path, briefs folder and work folder must sit outside
// the repository, because each holds briefs, keys, transcripts or labels; the repository keeps counts and digests.
//   author      authoring under custody: the pilot, the draws, the sets, sealed with age (ledger item ohr-author)
//   audit       the fixed-script simulator audit over every sheet (ohr-audit)
//   run, rows   one launch on the Docker rig, and its rows against the frozen manifest (run/cli.ts)
//   score       packets, check-packets, judges (production labels) and sessions (scored rows)
//   judge-check the live judge probes, the gold pass, the check labels and section 12's judge check (ohr-judge-check)
//   read        admission, decision (section 10's table) and report (section 11's lead table)
//   dryrun, e2e, preflight: keyless proof before any paid stage
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { CODES, docAnchor, isReasonCode, type ReasonCode } from "../../src/errors/codes.ts";
import { writeSealed } from "../office-hours-founder/author/files.ts";
import { insideRepo } from "../review-noloss/suite.ts";
import { AuthorError } from "../office-hours-founder/author/files.ts";
import { ageDecrypter, ageSealer, openCustody, plaintextSha256, readJournal, readReuse, sealCustody, sealedJournal, SHM, writeAuthoring } from "./author/custody.ts";
import { authorRun, checkAnswers, haltOf, type Checkpoint, type Reuse } from "./author/run.ts";
import { gitReader, loadScreen } from "./author/screens.ts";
import { GOLD_EFFORT, JUDGE_EFFORT, REUSE_PLAINTEXT_SHA256, SEED } from "./frozen.ts";
import { admission, admissionState, type AdmissionReading } from "./read/admission.ts";
import { decide } from "./read/decision.ts";
import { authoringEnd, readStops } from "./read/stops.ts";
import { SPLIT } from "./ledger.ts";
import type { HandRead } from "./read/guards.ts";
import { leadTable, rates } from "./read/report.ts";
import { rowsCommand, runCommand } from "./run/cli.ts";
import { buildCommit, loadBriefs } from "./run/manifest.ts";
import { readRows, scheduledRows } from "./run/rows.ts";
import { parseBlock } from "./score/block.ts";
import { judgeCheck, type CheckResult } from "./score/check.ts";
import { judgePackets, labeller, type JudgedLabel } from "./score/judge.ts";
import { buildCheckPackets, buildLabelPackets, readPackets, writePackets, type Brief, type CheckAnswer, type PacketMap } from "./score/packets.ts";
import { scoreSessions, stockCredits } from "./score/score.ts";
import { runScriptAudit, type AuditSheet } from "./sim/audit.ts";
import { loadPerson } from "./sim/founder.ts";
import type { Key, ScoredSession, SessionRow } from "./types.ts";
import { openWire, type Wire } from "./wire.ts";

export interface Io {
  out: (text: string) => void;
  err: (text: string) => void;
}
type Env = Record<string, string | undefined>;
type Run = (argv: string[], io: Io, env: Env) => Promise<number> | number;

const usage = (msg: string): never => {
  throw Object.assign(new Error(msg), { code: "E_USAGE" });
};

/** Flags: one value each, repeatable lists, and booleans; anything else is refused. */
function flags(argv: readonly string[], spec: { one?: readonly string[]; many?: readonly string[]; bool?: readonly string[] }): Map<string, string[]> {
  const f = new Map<string, string[]>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (spec.bool?.includes(a)) f.set(a, []);
    else if (spec.one?.includes(a) || spec.many?.includes(a)) {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) usage(a + " needs a value");
      if (spec.one?.includes(a) && f.has(a)) usage(a + " is given once");
      f.set(a, [...(f.get(a) ?? []), v!]);
    } else usage("unknown argument " + JSON.stringify(a));
  }
  return f;
}
const need = (f: Map<string, string[]>, cmd: string, keys: readonly string[]) => {
  for (const k of keys) if (!f.has(k)) usage(cmd + " needs " + k);
};
const one = (f: Map<string, string[]>, k: string) => f.get(k)?.[0];

/** A path that holds sealed material: refused inside the repository. */
export function outside(flag: string, p: string): string {
  const abs = resolve(p);
  if (insideRepo(abs)) usage(flag + " " + abs + " is inside the repository, and it holds briefs, transcripts or labels that stay outside it");
  return abs;
}
const fresh = (flag: string, p: string) => {
  const abs = outside(flag, p);
  if (existsSync(abs)) usage(flag + " " + abs + " exists; every run writes a new path");
  return abs;
};
const dollars = (v: string | undefined, flag: string): number => {
  const n = Math.round(Number(v) * 1_000_000);
  if (!(n > 0)) usage(flag + " must be a positive number of dollars");
  return n;
};
const readJson = <T>(p: string): T => JSON.parse(readFileSync(p, "utf8")) as T;
const writeJson = (p: string, v: unknown) => {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(v, null, 2) + "\n", { mode: 0o600 });
};
const ndjson = <T>(p: string): T[] => readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as T);

/** The briefs a scorer reads: each brief's key.json and brief.json, by id. */
export function readBriefs(dir: string): Map<string, Brief> {
  return new Map(loadBriefs(dir).map((meta) => [meta.id, { meta, key: readJson<Key>(join(dir, meta.id, "key.json")) }]));
}
/** Every row of the named launch folders. */
export const launchRows = (dirs: readonly string[]): SessionRow[] => dirs.flatMap((d) => [...readRows(d).values()].map((l) => l.row));

async function withWire<T>(o: { dir: string; item: string; cap: string | undefined; label: string; runId?: string; record?: string; ledger?: string; env: Env; io: Io; cmd: string; buildCommit?: string }, body: (w: Wire) => Promise<T>): Promise<T> {
  const w = await openWire({ dir: o.dir, item: o.item, capMicros: dollars(o.cap, "--spend-cap"), label: o.label, runId: o.runId, record: o.record, ledger: o.ledger, env: o.env, io: o.io, buildCommit: o.buildCommit });
  try {
    return await body(w);
  } finally {
    await w.close(o.cmd);
  }
}

const AUTHOR_USAGE = "gstack-evals ohr author --work <new dir under /dev/shm> --out <new sealed path> --recipients <age recipients file> --identity <age identity file> (--reuse <the first attempt's sealed authoring output> | --resume <a sealed checkpoint-<drafts>.age>) --gstack <clone holding both pins> --item <ledger item> --spend-cap <usd> [--meter <the stopped run's meter dir under /dev/shm, if it survived>] [--concurrency <n>] [--record <dir>] [--ledger <path>]";

/**
 * ohr author: authorRun from the reused briefs (a new run) or from a sealed checkpoint and the draft records sealed after
 * it (a stopped run), sealing every settled draft and a checkpoint after every batch into the checkpoints folder (the
 * new run's <out>.checkpoints, or the checkpoint's own folder), then the placed briefs, every outcome and the judge
 * check's answers sealed with age. A resume continues the run id its checkpoint records on the same ledger item, with
 * or without the stopped run's meter dir; that dir only adds its reply cache. Spend and the cap's room come from the
 * ledger item, and the projection's scale from the sealed records' per-draft spend.
 */
async function author(argv: string[], io: Io, env: Env): Promise<number> {
  const f = flags(argv, { one: ["--work", "--out", "--recipients", "--identity", "--reuse", "--resume", "--meter", "--gstack", "--item", "--spend-cap", "--concurrency", "--record", "--ledger"] });
  need(f, "ohr author", ["--work", "--out", "--recipients", "--identity", "--gstack", "--item", "--spend-cap"]);
  if (f.has("--reuse") === f.has("--resume")) usage("ohr author takes one of --reuse, for a new run, and --resume, for a stopped one. Usage: " + AUTHOR_USAGE);
  const work = resolve(one(f, "--work")!);
  if (!work.startsWith(SHM + "/")) usage("--work " + work + " is not under " + SHM + "; plaintext briefs live only in memory-backed storage. Usage: " + AUTHOR_USAGE);
  if (existsSync(work)) usage("--work " + work + " exists; every run writes into a new work directory");
  const out = fresh("--out", one(f, "--out")!);
  const concurrency = Number(one(f, "--concurrency") ?? "4");
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) usage("--concurrency is a whole number of at least 1");
  const meter = resolve(one(f, "--meter") ?? work + ".meter");
  if (f.has("--meter") && (!meter.startsWith(SHM + "/") || !existsSync(meter))) usage("--meter " + meter + " is not an existing meter directory under " + SHM);
  const identity = resolve(one(f, "--identity")!);
  const resumeFrom = f.has("--resume") ? outside("--resume", one(f, "--resume")!) : null;
  const checkpoints = resumeFrom ? dirname(resumeFrom) : fresh("--out", out + ".checkpoints");
  let reuse: Reuse | undefined, resume: (Checkpoint & { run_id: string }) | undefined;
  if (resumeFrom) resume = readJournal(resumeFrom, ageDecrypter(identity), work);
  else {
    const sealed = outside("--reuse", one(f, "--reuse")!);
    const sha = plaintextSha256(sealed, identity);
    if (sha !== REUSE_PLAINTEXT_SHA256) throw new AuthorError("E_OHR_REUSE", sealed + "'s plaintext has sha256 " + sha + ", not the " + REUSE_PLAINTEXT_SHA256 + " section 4 records for the first attempt's authoring output");
    reuse = readReuse(sealed, ageDecrypter(identity), work);
    for (const x of reuse.failed) io.err("E_OHR_REUSE " + x.id + " in slot " + x.slot + " is not reused: " + x.why + "; its slot is drafted again");
    mkdirSync(checkpoints, { recursive: true, mode: 0o700 });
  }
  const screen = loadScreen(gitReader(resolve(one(f, "--gstack")!)));
  const cap = dollars(one(f, "--spend-cap"), "--spend-cap") / 1e6;
  const sealer = ageSealer(resolve(one(f, "--recipients")!));
  return withWire({ dir: meter, item: one(f, "--item")!, cap: one(f, "--spend-cap"), label: "ohr-author", runId: resume?.run_id, record: one(f, "--record"), ledger: one(f, "--ledger"), env, io, cmd: "ohr author" }, async (w) => {
    const run = await authorRun({ call: w.call, label: labeller(w.judge), parse: parseBlock, screen, spent: w.spent, spentOn: w.spentOn }, { cap, concurrency, reuse, resume, journal: sealedJournal({ dir: checkpoints, work, sealer, runId: w.runId }) });
    const sink = openCustody(work, out);
    const summary = writeAuthoring(sink, run);
    writeSealed(sink, "authoring/check-answers.json", JSON.stringify(checkAnswers(run), null, 2) + "\n");
    sealCustody(sink, out, sealer);
    io.out(JSON.stringify(summary, null, 2));
    io.out("ohr author: sealed to " + out + "; every draft record and checkpoint is sealed in " + checkpoints + "; the meter's cache stays in " + meter);
    const halt = haltOf(run, () => null);
    if (halt) io.err(halt.message);
    return halt ? 2 : 0;
  });
}

const AUDIT_USAGE = "gstack-evals ohr audit --briefs-dir <dir> --item <ledger item> --spend-cap <usd> --out <new record.json> [--parallel <n>] [--record <dir>] [--ledger <path>]";

/** ohr audit: frozen.AUDIT_SCRIPT over every sheet, the seeded sample, GPT-6.2 Astra and Opus 5.5 at max. */
async function audit(argv: string[], io: Io, env: Env): Promise<number> {
  const f = flags(argv, { one: ["--briefs-dir", "--item", "--spend-cap", "--out", "--parallel", "--record", "--ledger"] });
  need(f, "ohr audit", ["--briefs-dir", "--item", "--spend-cap", "--out"]);
  const dir = outside("--briefs-dir", one(f, "--briefs-dir")!);
  const out = fresh("--out", one(f, "--out")!);
  const parallel = Number(one(f, "--parallel") ?? "8");
  if (!Number.isSafeInteger(parallel) || parallel < 1) usage("--parallel is a whole number of at least 1. Usage: " + AUDIT_USAGE);
  const sheets: AuditSheet[] = loadBriefs(dir).map((m) => ({ brief: m.id, kind: m.kind, sheet: loadPerson(join(dir, m.id), m.kind) }));
  if (!sheets.length) usage("--briefs-dir " + dir + " holds no briefs");
  const commit = buildCommit();
  return withWire({ dir: out + ".meter", item: one(f, "--item")!, cap: one(f, "--spend-cap"), label: "ohr-audit", record: one(f, "--record"), ledger: one(f, "--ledger"), env, io, cmd: "ohr audit", buildCommit: commit }, async (w) => {
    const rec = await runScriptAudit({ sheets, call: (s) => w.sim("audit:" + s.brief), auditors: { astra: w.auditor("astra"), opus: w.auditor("opus") }, parallel });
    writeJson(out, { ...rec, build_commit: commit });
    io.out("ohr audit: " + rec.sheets + " sheets, " + rec.script_turns + " script turns, " + rec.guard_failures + " guard failures, " + rec.audited + " audited, " + rec.failing + " failing, read " + rec.read);
    if (rec.code) io.err(rec.code + " ohr audit: " + rec.reasons.join("; "));
    return rec.read === "pass" ? 0 : 2;
  });
}

const SCORE_USAGE = [
  "gstack-evals ohr score packets --stage 1|2 --briefs-dir <dir> --launch <out dir>... --packets <new dir> --map <new file> [--taken <map>...]",
  "gstack-evals ohr score check-packets --briefs-dir <dir> --launch <stage 1 out dir>... --answers <check-answers.json> --taken <map>... --packets <new dir> --map <new file>",
  "gstack-evals ohr score judges --packets <dir> --map <label map> --item <ledger item> --spend-cap <usd> --out <new labels.ndjson> [--record <dir>] [--ledger <path>]",
  "gstack-evals ohr score sessions --briefs-dir <dir> --launch <out dir>... --map <label map>... --labels <labels.ndjson>... --out <new scored.json>",
].join("\n");

async function score(argv: string[], io: Io, env: Env): Promise<number> {
  const [sub, ...rest] = argv;
  if (sub === "packets" || sub === "check-packets") {
    const f = flags(rest, { one: ["--stage", "--briefs-dir", "--answers", "--packets", "--map"], many: ["--launch", "--taken"] });
    need(f, "ohr score " + sub, ["--briefs-dir", "--launch", "--packets", "--map", ...(sub === "packets" ? ["--stage"] : ["--answers", "--taken"])]);
    const packetsDir = fresh("--packets", one(f, "--packets")!), mapPath = fresh("--map", one(f, "--map")!);
    const briefs = readBriefs(outside("--briefs-dir", one(f, "--briefs-dir")!));
    const rows = launchRows(f.get("--launch")!.map((d) => outside("--launch", d)));
    const taken = (f.get("--taken") ?? []).map((p) => readJson<PacketMap>(p));
    let built;
    if (sub === "packets") {
      const stage = Number(one(f, "--stage"));
      if (stage !== 1 && stage !== 2) usage("--stage takes 1 or 2");
      built = buildLabelPackets({ stage: stage as 1 | 2, seed: SEED, briefs, rows, taken });
    } else built = buildCheckPackets({ seed: SEED, briefs, rows, answers: readJson<CheckAnswer[]>(outside("--answers", one(f, "--answers")!)), taken });
    writePackets(built, packetsDir, mapPath);
    io.out("ohr score " + sub + ": " + built.packets.length + " packets, " + built.packets.reduce((n, p) => n + p.blocks.length, 0) + " blocks");
    return 0;
  }
  if (sub === "judges") {
    const f = flags(rest, { one: ["--packets", "--map", "--item", "--spend-cap", "--out", "--record", "--ledger"] });
    need(f, "ohr score judges", ["--packets", "--map", "--item", "--spend-cap", "--out"]);
    const out = fresh("--out", one(f, "--out")!);
    const map = readJson<PacketMap>(outside("--map", one(f, "--map")!));
    if (map.kind !== "label") usage("ohr score judges labels a label map; a check map goes through ohr judge-check");
    const packets = readPackets(outside("--packets", one(f, "--packets")!));
    return withWire({ dir: out + ".meter", item: one(f, "--item")!, cap: one(f, "--spend-cap"), label: "ohr-labels-s" + map.stage, record: one(f, "--record"), ledger: one(f, "--ledger"), env, io, cmd: "ohr score judges", buildCommit: buildCommit() }, async (w) => {
      const r = await judgePackets({ map, packets, call: w.judge, effort: JUDGE_EFFORT });
      writeFileSync(out, r.labels.map((l) => JSON.stringify(l)).join("\n") + "\n", { mode: 0o600 });
      io.out("ohr score judges: " + r.labels.length + " labels from " + r.calls.length + " calls");
      if (r.unlabelled) io.err("E_OHR_LABEL_MISSING ohr score judges: " + r.unlabelled + " cells unlabelled after the one resend");
      return 0;
    });
  }
  if (sub === "sessions") {
    const f = flags(rest, { one: ["--briefs-dir", "--out"], many: ["--launch", "--map", "--labels"] });
    need(f, "ohr score sessions", ["--briefs-dir", "--launch", "--map", "--labels", "--out"]);
    const out = fresh("--out", one(f, "--out")!);
    const briefs = readBriefs(outside("--briefs-dir", one(f, "--briefs-dir")!));
    const rows = f.get("--launch")!.map((d) => outside("--launch", d)).flatMap(scheduledRows);
    const maps = f.get("--map")!.map((p) => readJson<PacketMap>(p));
    const labels = f.get("--labels")!.flatMap((p) => ndjson<JudgedLabel>(p));
    const scored = scoreSessions({ rows, briefs, maps, labels });
    writeJson(out, scored);
    const stock = stockCredits(maps, labels);
    io.out("ohr score sessions: " + scored.length + " scored rows; stock rows " + stock.rows + ", credited " + stock.credited + ", unlabelled " + stock.unlabelled);
    return 0;
  }
  io.err("E_USAGE ohr score: " + (sub ? "no subcommand " + JSON.stringify(sub) : "name a subcommand") + "\n" + SCORE_USAGE);
  return 2;
}

/** One cheap call per judge route, so a dead route shows before any label is spent. */
async function probe(w: Wire): Promise<{ judge: "astra" | "opus"; ok: boolean; model_id: string; version: string | null; problem: string | null }[]> {
  return Promise.all((["astra", "opus"] as const).map(async (judge) => {
    const r = await w.judge({ judge, prompt: "Reply with the one word ok.", effort: JUDGE_EFFORT, maxTokens: 2000, label: "probe:" + judge });
    return { judge, ok: r.text !== null, model_id: r.model_id, version: r.version, problem: r.problem };
  }));
}

const CHECK_USAGE = "gstack-evals ohr judge-check --packets <dir> --map <check map> --out <new dir> (--item <ledger item> --spend-cap <usd> [--record <dir>] [--ledger <path>] | --gold <labels.ndjson> --labels <labels.ndjson>)";

/** The judge check read over labels already in hand: one result per production judge. */
export function readCheck(map: PacketMap, gold: readonly JudgedLabel[], labels: readonly JudgedLabel[]): Record<"astra" | "opus", CheckResult> {
  return { astra: judgeCheck({ map, gold, labels: labels.filter((l) => l.judge === "astra"), judge: "astra" }), opus: judgeCheck({ map, gold, labels: labels.filter((l) => l.judge === "opus"), judge: "opus" }) };
}

async function judgeCheckCommand(argv: string[], io: Io, env: Env): Promise<number> {
  const f = flags(argv, { one: ["--packets", "--map", "--out", "--item", "--spend-cap", "--record", "--ledger", "--gold", "--labels"] });
  need(f, "ohr judge-check", ["--map", "--out"]);
  const out = fresh("--out", one(f, "--out")!);
  const map = readJson<PacketMap>(outside("--map", one(f, "--map")!));
  if (map.kind !== "check") usage("ohr judge-check reads a check map; build it with ohr score check-packets. Usage: " + CHECK_USAGE);
  const report = (gold: JudgedLabel[], labels: JudgedLabel[], probes: unknown) => {
    const result = readCheck(map, gold, labels);
    writeJson(join(out, "check.json"), { probes, ...result });
    for (const r of Object.values(result)) {
      io.out("ohr judge-check: " + r.judge + " " + r.verdict + ", " + r.outputs + " outputs from " + r.blocks + " blocks, kappa " + r.kappa + ", on real blocks " + r.kappa_real + ", near-miss " + r.near_miss + ", stock credited " + r.stock_credited + " of " + r.stock_rows);
      if (r.code) io.err(r.code + " ohr judge-check: " + r.judge + ": " + r.reasons.join("; "));
    }
    return Object.values(result).every((r) => r.verdict === "PASS") ? 0 : 3;
  };
  if (f.has("--gold") || f.has("--labels")) {
    need(f, "ohr judge-check", ["--gold", "--labels"]);
    return report(ndjson(outside("--gold", one(f, "--gold")!)), ndjson(outside("--labels", one(f, "--labels")!)), null);
  }
  need(f, "ohr judge-check", ["--packets", "--item", "--spend-cap"]);
  const packets = readPackets(outside("--packets", one(f, "--packets")!));
  return withWire({ dir: out + ".meter", item: one(f, "--item")!, cap: one(f, "--spend-cap"), label: "ohr-judge-check", record: one(f, "--record"), ledger: one(f, "--ledger"), env, io, cmd: "ohr judge-check", buildCommit: buildCommit() }, async (w) => {
    const probes = await probe(w);
    for (const p of probes) io.out("ohr judge-check: probe " + p.judge + " " + (p.ok ? "answered" : "failed") + " (" + p.model_id + ", " + (p.version ?? "no version") + ")");
    if (probes.some((p) => !p.ok)) {
      writeJson(join(out, "check.json"), { probes });
      io.err("E_OHR_JUDGE_INPUT ohr judge-check: a judge route did not answer its probe: " + probes.filter((p) => !p.ok).map((p) => p.judge + " " + p.problem).join("; "));
      return 2;
    }
    const gold = await judgePackets({ map, packets, call: w.judge, effort: GOLD_EFFORT });
    const labels = await judgePackets({ map, packets, call: w.judge, effort: JUDGE_EFFORT });
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, "gold.ndjson"), gold.labels.map((l) => JSON.stringify(l)).join("\n") + "\n", { mode: 0o600 });
    writeFileSync(join(out, "labels.ndjson"), labels.labels.map((l) => JSON.stringify(l)).join("\n") + "\n", { mode: 0o600 });
    return report(gold.labels, labels.labels, probes);
  });
}

const READ_USAGE = [
  "gstack-evals ohr read admission --scored <stage 1 scored.json> --launch <stage 1 out dir>... --audit <audit record.json> --judge-check <check.json> --label-usd <dollars a session> --out <new file> [--prior <earlier admission.json>]",
  "gstack-evals ohr read decision --scored <stage 2 scored.json> --admission <admission.json>... --judge-check <check.json> --hand-reads <file> --launch <launch out dir>... --record <ledger record dir> --authoring <sealed authoring output> --identity <age identity file> --out <new file> [--cap-stop]",
  "gstack-evals ohr read report --scored <scored.json> --out <new file>",
].join("\n");

const passed = (p: string) => {
  const c = readJson<Record<"astra" | "opus", { verdict: string }>>(p);
  return { astra: c.astra?.verdict === "PASS", opus: c.opus?.verdict === "PASS" };
};

function read(argv: string[], io: Io): number {
  const [sub, ...rest] = argv;
  if (sub === "admission") {
    const f = flags(rest, { one: ["--scored", "--audit", "--judge-check", "--label-usd", "--out", "--prior"], many: ["--launch"] });
    need(f, "ohr read admission", ["--scored", "--launch", "--audit", "--judge-check", "--label-usd", "--out"]);
    const out = fresh("--out", one(f, "--out")!);
    const label_usd = Number(one(f, "--label-usd"));
    if (!(label_usd >= 0)) usage("--label-usd is the measured label dollars a session");
    const reading = admission({ rows: readJson<ScoredSession[]>(outside("--scored", one(f, "--scored")!)), sessions: launchRows(f.get("--launch")!.map((d) => outside("--launch", d))), audit: { pass: readJson<{ read: string }>(outside("--audit", one(f, "--audit")!)).read === "pass" }, judges: passed(outside("--judge-check", one(f, "--judge-check")!)), label_usd });
    const reads = [...(f.has("--prior") ? [readJson<AdmissionReading>(one(f, "--prior")!)] : []), reading];
    const state = admissionState(reads);
    writeJson(out, { ...reading, state });
    for (const c of reading.conditions) io.out(c.id + " " + (c.pass ? "pass" : "FAIL") + " " + JSON.stringify(c.values));
    io.out("ohr read admission: " + state);
    return state === "admitted" ? 0 : 2;
  }
  if (sub === "decision") {
    const f = flags(rest, { one: ["--scored", "--judge-check", "--hand-reads", "--record", "--authoring", "--identity", "--out"], many: ["--admission", "--launch"], bool: ["--cap-stop"] });
    need(f, "ohr read decision", ["--scored", "--admission", "--judge-check", "--hand-reads", "--launch", "--record", "--authoring", "--identity", "--out"]);
    const out = fresh("--out", one(f, "--out")!);
    const authoring = authoringEnd(outside("--authoring", one(f, "--authoring")!), ageDecrypter(resolve(one(f, "--identity")!)));
    const stops = readStops({ launches: f.get("--launch")!.map((d) => outside("--launch", d)), record: resolve(one(f, "--record")!), items: [...new Set(SPLIT.map((p) => p.item))], authoring, flag: f.has("--cap-stop") });
    for (const s of stops) io.out("ohr read decision: row 1 stop: " + s);
    const d = decide({ rows: readJson<ScoredSession[]>(outside("--scored", one(f, "--scored")!)), admission: admissionState(f.get("--admission")!.map((p) => readJson<AdmissionReading>(p))), stops, judge_checks: passed(outside("--judge-check", one(f, "--judge-check")!)), hand_reads: readJson<HandRead[]>(outside("--hand-reads", one(f, "--hand-reads")!)) });
    writeJson(out, d);
    io.out("ohr read decision: row " + d.row + ", " + d.outcome);
    return 0;
  }
  if (sub === "report") {
    const f = flags(rest, { one: ["--scored", "--out"] });
    need(f, "ohr read report", ["--scored", "--out"]);
    const out = fresh("--out", one(f, "--out")!);
    const rows = readJson<ScoredSession[]>(outside("--scored", one(f, "--scored")!));
    writeJson(out, { lead: leadTable(rows), founder: rates(rows, "founder"), builder: rates(rows, "builder") });
    io.out("ohr read report: written");
    return 0;
  }
  io.err("E_USAGE ohr read: " + (sub ? "no subcommand " + JSON.stringify(sub) : "name a subcommand") + "\n" + READ_USAGE);
  return 2;
}

export const SUBCOMMANDS: Record<string, { summary: string; run: Run }> = {
  author: { summary: "authoring under custody: the pilot, the draws and the sets, sealed with age", run: author },
  audit: { summary: "the fixed-script simulator audit over every sheet, GPT-6.2 Astra and Opus 5.5 at max", run: audit },
  run: { summary: "one launch (stage1, stage2 or stage2-particle) on the Docker rig with the simulated person", run: (argv, io, env) => runCommand(argv, io, env) },
  rows: { summary: "a launch's rows against its frozen manifest, with the end-state counts", run: (argv, io) => rowsCommand(argv, io) },
  score: { summary: "packets, check-packets, judges (production labels) and sessions (scored rows)", run: score },
  "judge-check": { summary: "the live judge probes, the gold pass, the check labels and section 12's judge check", run: judgeCheckCommand },
  read: { summary: "admission (A1 to A7), decision (section 10's table) and report (section 11's lead table)", run: (argv, io) => read(argv, io) },
  dryrun: { summary: "the keyless dry run over every area's seams and one ledger lease per ledger item", run: async (argv, io) => (await import("./dryrun.ts")).run(argv, io) },
  e2e: { summary: "the keyless end to end on Docker, then a planted scoring pass through score and read", run: async (argv, io) => (await import("./e2e-score.ts")).run(argv, io) },
  preflight: { summary: "section 12's no-model preflight: the pins in the local gstack, Docker, the dry run and the end to end", run: async (argv, io, env) => (await import("./preflight.ts")).run(argv, io, env) },
};

const lines = (code: ReasonCode, message: string) => [message, "fix: " + CODES[code].fix, "docs: " + docAnchor(code)].flatMap((t) => t.split(/\r\n|\r|\n/)).map((l) => code + " " + l).join("\n");

export async function main(argv: string[], io: Io = { out: (t) => console.log(t), err: (t) => console.error(t) }, env: Env = process.env): Promise<number> {
  const [sub, ...rest] = argv;
  if (!sub || sub === "--help" || sub === "-h") {
    io.out(["gstack-evals ohr <command>", "", ...Object.entries(SUBCOMMANDS).map(([k, v]) => "  " + k.padEnd(14) + v.summary)].join("\n"));
    return sub ? 0 : 2;
  }
  const entry = SUBCOMMANDS[sub];
  if (!entry) {
    io.err(lines("E_USAGE", "gstack-evals ohr: no command " + JSON.stringify(sub) + "; run gstack-evals ohr --help"));
    return 2;
  }
  try {
    return await entry.run(rest, io, env);
  } catch (e) {
    const err = e as { code?: string; message?: string };
    const lead = /^(E_[A-Z0-9_]+) /.exec(String(err.message ?? ""))?.[1];
    const named = err.code ?? lead;
    const code = typeof named === "string" && isReasonCode(named) ? named : "E_INTERNAL";
    io.err(lines(code, "gstack-evals ohr " + sub + ": " + String(err.message ?? e).replace(new RegExp("^" + code + " "), "")));
    return CODES[code].exit ?? 1;
  }
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
