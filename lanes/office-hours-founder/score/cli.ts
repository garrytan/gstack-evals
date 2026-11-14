// Copyright (c) 2026 Garry Tan. MIT License.
// The score area's commands for gstack-evals of (the parent merges them into lanes/office-hours-founder/cli.ts):
//   packets        a stage's blind label packets from its launches' rows, and the map outside the packets folder.
//   check-packets  stage 1's judge-check packets with the anchors.
//   judge          one packets folder through its judges on a named ledger item with a spend cap.
//   score          the launches' rows, the maps and the labels into scored.ndjson and stock.ndjson.
// Rows come from run/rows.ts readRows through wire.ts completeRow; a real unit needs its <unit>/names.txt. Every out,
// cache, units, packets, launch, map and labels path must sit outside the repo. Output prints counts and digests only.
// The judge's caller runs on the product-value meter (one lease, the reply cache) and records the version the provider
// reported; Gemini's tie vote must be served by Google Vertex (sim/founder.ts VERTEX), so Google AI Studio or any other
// name stops the command with E_OF_PROVIDER_DRIFT, as does the meter's own pin check on any OpenRouter route.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { newRunId } from "../../../src/skill-eval/cli/call.ts";
import type { Caller } from "../../product-value/judge.ts";
import { MeterError, MODELS, openMeter } from "../../product-value/meter.ts";
import { insideRepo } from "../../review-noloss/suite.ts";
import { SEED } from "../frozen.ts";
import { readRows } from "../run/rows.ts";
import { entryId } from "../run/manifest.ts";
import { VERTEX } from "../sim/founder.ts";
import type { Key, SessionRow, Sheet, UnitMeta } from "../types.ts";
import { completeRow } from "../wire.ts";
import { CELLS, judgePackets, type JudgedLabel } from "./judge.ts";
import { buildCheckPackets, buildLabelPackets, readPackets, writePackets, type Built, type PacketMap } from "./packets.ts";
import { PRODUCTION_LABEL, scoreSessions, stockCredits, type ScoreUnit } from "./score.ts";

interface Io {
  out: (text: string) => void;
  err: (text: string) => void;
}
type Env = Record<string, string | undefined>;

const usage = (why: string): never => {
  throw new Error("E_USAGE " + why);
};
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/** Flags that take one value, and those that may repeat. */
function parse(argv: readonly string[], one: readonly string[], many: readonly string[] = []): Map<string, string[]> {
  const f = new Map<string, string[]>();
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i]!, v = argv[i + 1];
    if (!one.includes(k) && !many.includes(k)) usage("unknown argument " + JSON.stringify(k));
    if (v === undefined || v.startsWith("--")) usage(k + " needs a value");
    if (one.includes(k) && f.has(k)) usage(k + " is given once");
    f.set(k, [...(f.get(k) ?? []), v!]);
  }
  return f;
}

function need(f: Map<string, string[]>, keys: readonly string[]): void {
  for (const k of keys) if (!f.has(k)) usage("needs " + k);
}

/** Resolves a path flag and refuses it inside the repo. */
const outside = (flag: string, p: string): string => {
  const abs = resolve(p);
  if (insideRepo(abs)) usage(flag + " " + abs + " is inside the repo; units, transcripts, packets and labels stay sealed outside it");
  return abs;
};
const paths = (f: Map<string, string[]>, flag: string) => (f.get(flag) ?? []).map((p) => outside(flag, p));
const fresh = (flag: string, p: string) => (existsSync(p) ? usage(flag + " " + p + " exists; every build writes a new one") : p);

const readJson = <T>(p: string): T => JSON.parse(readFileSync(p, "utf8")) as T;
const readLines = <T>(p: string): T[] => readFileSync(p, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as T);
const writeLines = (p: string, rows: readonly unknown[]) => writeFileSync(p, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""), { mode: 0o600 });

/** Every unit under a sealed units dir: unit.json, key.json and sheet.json. */
function loadUnits(dir: string): Map<string, ScoreUnit> {
  if (!existsSync(dir)) usage("--units " + dir + " does not exist");
  const out = new Map<string, ScoreUnit>();
  for (const id of readdirSync(dir).sort()) {
    if (!existsSync(join(dir, id, "unit.json"))) continue;
    out.set(id, { meta: readJson<UnitMeta>(join(dir, id, "unit.json")), key: readJson<Key>(join(dir, id, "key.json")), sheet: readJson<Sheet>(join(dir, id, "sheet.json")) });
  }
  return out;
}

/** The launches' rows through completeRow, each session once. A real unit's Names line comes from its names.txt. */
function loadRows(launches: readonly string[], unitsDir: string, units: ReadonlyMap<string, ScoreUnit>): SessionRow[] {
  const seen = new Set<string>();
  const out: SessionRow[] = [];
  for (const launch of launches)
    for (const [id, line] of readRows(launch)) {
      if (seen.has(id)) usage("session " + id + " appears in two launches");
      seen.add(id);
      const u = units.get(line.row.unit) ?? usage("a row of " + launch + " names a unit that is not under --units");
      const names = join(unitsDir, u.meta.id, "names.txt");
      if (u.meta.stratum === "real" && !existsSync(names)) usage("real unit " + u.meta.id + " has no names.txt, so its in-session naming can't be read");
      out.push(completeRow(line, u.meta, u.meta.stratum === "real" ? readFileSync(names, "utf8").split("\n").map((n) => n.trim()).filter(Boolean) : []));
    }
  return out;
}

function report(io: Io, what: string, built: Built, mapPath: string): void {
  const roles: Record<string, number> = {};
  for (const p of Object.values(built.map.packets)) roles[p.role] = (roles[p.role] ?? 0) + 1;
  const blocks = built.packets.reduce((n, p) => n + p.blocks.length, 0);
  io.out(what + ": " + built.packets.length + " packets (" + Object.entries(roles).map(([r, n]) => r + " " + n).join(", ") + "), " + blocks + " blocks; map sha256 " + sha(readFileSync(mapPath, "utf8")));
}

async function packets(argv: string[], io: Io): Promise<number> {
  const f = parse(argv, ["--stage", "--units", "--out", "--map", "--check-map", "--check-packets", "--check-labels"], ["--launch"]);
  need(f, ["--stage", "--launch", "--units", "--out", "--map"]);
  const stage = Number(f.get("--stage")![0]) as 1 | 2;
  if (stage !== 1 && stage !== 2) usage("--stage takes 1 or 2");
  const unitsDir = outside("--units", f.get("--units")![0]!);
  const out = fresh("--out", outside("--out", f.get("--out")![0]!));
  const mapPath = fresh("--map", outside("--map", f.get("--map")![0]!));
  const units = loadUnits(unitsDir);
  const rows = loadRows(paths(f, "--launch"), unitsDir, units);
  const wrong = rows.find((r) => r.stage !== stage);
  if (wrong) usage("session " + entryId(wrong) + " is a stage " + wrong.stage + " session, not stage " + stage);
  const checkFlags = ["--check-map", "--check-packets", "--check-labels"];
  if (stage === 1 && checkFlags.some((k) => f.has(k))) usage("stage 1 packets take no judge-check inputs");
  if (stage === 2) need(f, checkFlags);
  const check = stage === 2 ? { map: readJson<PacketMap>(outside("--check-map", f.get("--check-map")![0]!)), packets: readPackets(outside("--check-packets", f.get("--check-packets")![0]!)), labels: readLines<JudgedLabel>(outside("--check-labels", f.get("--check-labels")![0]!)) } : undefined;
  const built = buildLabelPackets({ stage, seed: SEED, units, rows }, check);
  writePackets(built, out, mapPath);
  report(io, "of packets: stage " + stage + ", " + rows.length + " sessions", built, mapPath);
  return 0;
}

async function checkPackets(argv: string[], io: Io): Promise<number> {
  const f = parse(argv, ["--units", "--out", "--map"], ["--launch"]);
  need(f, ["--launch", "--units", "--out", "--map"]);
  const unitsDir = outside("--units", f.get("--units")![0]!);
  const out = fresh("--out", outside("--out", f.get("--out")![0]!));
  const mapPath = fresh("--map", outside("--map", f.get("--map")![0]!));
  const units = loadUnits(unitsDir);
  const rows = loadRows(paths(f, "--launch"), unitsDir, units);
  const built = buildCheckPackets({ stage: 1, seed: SEED, units, rows });
  writePackets(built, out, mapPath);
  report(io, "of check-packets: " + rows.length + " sessions", built, mapPath);
  return 0;
}

/** The provider's model string and served-by name of each upstream reply, by request model and prompt. */
function tap(base: typeof fetch, dir: string): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const res = await base(url, init);
    try {
      const req = JSON.parse(String(init?.body ?? "null"));
      const prompt = (req?.input ?? req?.messages)?.[0]?.content;
      const body = JSON.parse(await res.clone().text());
      if (typeof prompt === "string" && typeof body?.model === "string") writeFileSync(join(dir, sha(String(req.model) + "\n" + prompt) + ".version"), body.model, { mode: 0o600 });
    } catch {}
    return res;
  }) as typeof fetch;
}

const drift = (detail: string): never => {
  throw new Error("E_OF_PROVIDER_DRIFT " + detail + "; stop this model's judge items and ask the Captain");
};

/** The judge caller on one meter: the version the provider reported, and the strict Vertex check on Gemini. */
function caller(meter: Awaited<ReturnType<typeof openMeter>>, vdir: string): Caller {
  return async (c) => {
    let r;
    try {
      r = await meter.call({ model: c.judge, prompt: c.prompt, maxTokens: c.maxTokens, effort: c.effort, label: c.label });
    } catch (e) {
      if (e instanceof MeterError && e.code === "E_PV_PROVIDER_DRIFT") drift(e.message.replace(/^E_PV_PROVIDER_DRIFT /, ""));
      throw e;
    }
    const m = MODELS[c.judge];
    if (c.judge === "gemini" && r.text !== null && !VERTEX.test(r.served_by ?? "")) drift(m.id + " was served by " + (r.served_by ?? "an unnamed provider") + ", not Google Vertex");
    const vfile = join(vdir, sha(m.id + "\n" + c.prompt) + ".version");
    return { text: r.text, model_id: m.provider + ":" + m.id, version: existsSync(vfile) ? readFileSync(vfile, "utf8") : null, problem: r.problem };
  };
}

/** Cells a stage's readings need that stayed null: the production label (or both check judges) on every needed cell. */
export function unlabelled(map: PacketMap, labels: readonly JudgedLabel[]): number {
  return labels.reduce((n, l) => {
    const p = map.packets[l.packet];
    if (!p) return n;
    const counts = map.kind === "check" ? l.judge === "astra" || l.judge === "opus" : l.judge === PRODUCTION_LABEL[p.model];
    return counts ? n + CELLS.filter((c) => (c !== "doubt" || p.doubt) && l[c] === null).length : n;
  }, 0);
}

async function judge(argv: string[], io: Io, env: Env, o: { fetch?: typeof fetch } = {}): Promise<number> {
  const f = parse(argv, ["--packets", "--map", "--item", "--spend-cap", "--out", "--effort", "--concurrency", "--cache", "--record", "--ledger"]);
  need(f, ["--packets", "--map", "--item", "--spend-cap", "--out", "--effort", "--cache"]);
  const one = (k: string) => f.get(k)?.[0];
  const map = readJson<PacketMap>(outside("--map", one("--map")!));
  const files = readPackets(outside("--packets", one("--packets")!));
  const out = outside("--out", one("--out")!);
  const cache = outside("--cache", one("--cache")!);
  const effort = one("--effort");
  if (effort !== "medium" && effort !== "max") usage("--effort takes medium or max");
  if ((effort === "max") !== (map.kind === "check")) usage("--effort " + effort + " doesn't fit a " + map.kind + " map: max is for the judge check's packets only, medium for every other packet");
  const cap = Math.round(Number(one("--spend-cap")) * 1_000_000);
  if (!(cap > 0)) usage("--spend-cap must be a positive number of dollars");
  const concurrency = Number(one("--concurrency") ?? "4");
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) usage("--concurrency must be a whole number of at least 1");
  const runFile = out + ".run.json";
  const runId = existsSync(runFile) ? readJson<{ run_id: string }>(runFile).run_id : newRunId("of-judge-" + map.kind + "-" + map.stage);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(runFile, JSON.stringify({ run_id: runId }) + "\n");
  const vdir = join(cache, "versions");
  mkdirSync(vdir, { recursive: true, mode: 0o700 });
  const meter = await openMeter({ item: one("--item")!, runId, out: out + ".meter", cacheDir: cache, maxOutputTokens: 32_000, amountMicros: cap, record: one("--record"), ledger: one("--ledger"), env, fetch: tap(o.fetch ?? fetch, vdir), warn: (code, m) => io.err(code + " " + m) });
  let result;
  try {
    result = await judgePackets({ map, packets: files, call: caller(meter, vdir), concurrency });
  } finally {
    const closed = await meter.close();
    io.out("of judge: settled " + (closed.spent_micros / 1e6).toFixed(4) + " dollars on " + one("--item") + (closed.unknown_micros ? ", " + (closed.unknown_micros / 1e6).toFixed(4) + " unknown" : ""));
  }
  writeLines(out, result.labels);
  writeLines(out + ".calls.ndjson", result.calls);
  io.out("of judge: " + Object.keys(map.packets).length + " packets, " + result.labels.length + " label records, " + result.calls.length + " calls; labels sha256 " + sha(readFileSync(out, "utf8")));
  const open = unlabelled(map, result.labels);
  if (open) io.err("E_OF_LABEL_MISSING " + open + " cells stayed unlabelled after the one resend (or the one tie-break retry); a block missing a customer, wedge or multi-target cell is unscored and counts as missing");
  return 0;
}

async function score(argv: string[], io: Io): Promise<number> {
  const f = parse(argv, ["--units", "--out"], ["--launch", "--map", "--labels"]);
  need(f, ["--launch", "--units", "--map", "--labels", "--out"]);
  const unitsDir = outside("--units", f.get("--units")![0]!);
  const out = outside("--out", f.get("--out")![0]!);
  const units = loadUnits(unitsDir);
  const rows = loadRows(paths(f, "--launch"), unitsDir, units);
  const maps = paths(f, "--map").map((p) => readJson<PacketMap>(p));
  const labels = paths(f, "--labels").flatMap((p) => readLines<JudgedLabel>(p));
  const scored = scoreSessions({ rows, units, maps, labels });
  const stock = stockCredits({ units, maps, labels });
  mkdirSync(dirname(out), { recursive: true });
  writeLines(out, scored);
  writeLines(join(dirname(out), "stock.ndjson"), stock);
  const cells = new Map<string, number[]>();
  for (const s of scored) {
    const k = "stage " + s.stage + " " + s.kind + " " + s.stratum + " " + s.model + " " + s.arm;
    const c = cells.get(k) ?? [0, 0, 0];
    c[s.W === 1 ? 0 : s.W === 0 ? 1 : 2]!++;
    cells.set(k, c);
  }
  for (const [k, [one, zero, none]] of [...cells].sort(([a], [b]) => (a < b ? -1 : 1))) io.out(k + ": W=1 " + one + ", W=0 " + zero + ", unscored " + none);
  io.out("of score: " + scored.length + " sessions, " + stock.length + " stock readings; scored sha256 " + sha(readFileSync(out, "utf8")));
  return 0;
}

export const commands: Record<string, { summary: string; run: (argv: string[], io: Io, env: Env) => Promise<number> }> = {
  packets: { summary: "a stage's blind label packets from its launches (stage 2 takes the judge check's gold), the map outside them", run: (argv, io) => packets(argv, io) },
  "check-packets": { summary: "stage 1's judge-check packets with the anchors, for Astra and Opus", run: (argv, io) => checkPackets(argv, io) },
  judge: { summary: "one packets folder through its judges on a ledger item with a spend cap; counts unlabelled cells", run: (argv, io, env) => judge(argv, io, env) },
  score: { summary: "launch rows, maps and labels into scored.ndjson and stock.ndjson, with W counts per model and arm", run: (argv, io) => score(argv, io) },
};

/** The judge command with an injected upstream fetch, for keyless tests. */
export const judgeWith = (fetchImpl: typeof fetch) => (argv: string[], io: Io, env: Env) => judge(argv, io, env, { fetch: fetchImpl });
