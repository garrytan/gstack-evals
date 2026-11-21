// Copyright (c) 2026 Garry Tan. MIT License.
// gstack-evals codex-hooks c analysis <command>: part C's judging and analysis (lanes/codex-hooks/README.md). Every
// command works on one judging directory: --dir holds each batch the judges see (extract/, match/, adjudicate/), its
// key beside it (extract-key.json and so on, never inside a batch), each run's replies (<stage>-run/), the joined
// judgments (judged.json) and the checks. Only run without --dry-run calls a model.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { loadSuite, sha256, type Suite, type Unit } from "../../../review-noloss/suite.ts";
import { usd } from "../../../../src/runner/ledger/money.ts";
import { analyze, type Analysis, type Contrast } from "./analysis.ts";
import { checkItems, chooseRoute, confirmation, confirmationItems, goldLabels, pilotCheck, type Confirmation, type PilotCheck } from "./check.ts";
import { contractReading, e3Reading } from "./decide.ts";
import { BRIEF, CHECK, GOLD, JUDGE_ITEM, PASSES, POWER, ROUTES, SEED, SUITE, type RouteName } from "./frozen.ts";
import { joinReplies, readExtraction } from "./join.ts";
import { addRulings, anchorsFor, countedOf, judgedStates, loadKey, writeAdjudicate, writeExtract, writeMatch, type CodeAt, type Counted, type Judged, type Key, type Stage, type Unjudged } from "./judging.ts";
import { judgeItemDryRun, judgeModel, withMeteredJudges, worstCaseMicros } from "./meter.ts";
import { pilotReadout, type HandReading } from "./pilot.ts";
import { readStatesFile, type StatesFile } from "./record.ts";
import { promptFor, readBatch, runExtract, runGold, runJudged, type StageRun } from "./run.ts";
import { scoreSessions } from "./score.ts";
import { loadSeverityMaps } from "./severity.ts";

const USAGE = [
  "usage: codex-hooks c analysis <command>",
  "  packets extract|match|adjudicate --states <file> --dir <dir> [--pilot] [--seed <n>] [--source <owner/repo>=<clone>]...",
  "  run extract|match|adjudicate|gold --states <file> --dir <dir> [--pilot] [--route A|B] --item <ledger item> --run-id <id> [--ledger <path>] [--record <path>] [--concurrency <n>] [--dry-run]",
  "  join match|adjudicate --states <file> --dir <dir> [--pilot] [--route A|B]",
  "  check --states <pilot states> --dir <dir> --pilot [--route A|B]",
  "  confirm --states <file> --dir <dir> [--route A|B]",
  "  route --check A=<check.json> --confirm A=<confirm.json> [--check B=<file> --confirm B=<file>]",
  "  analyze --states <file> --dir <dir> --route-file <route.json> [--json]",
  "  pilot --states <pilot states> --hand <hand.json> [--dir <dir>] [--json]",
  "  judge-item [--run-id <id>]",
  "  power",
].join("\n");

class UsageError extends Error {}
const usage = (m: string): never => {
  throw new UsageError("E_USAGE " + m + "\n" + USAGE);
};

type Flags = Map<string, string[]>;
const BOOL = new Set(["--pilot", "--dry-run", "--json"]);
function parse(argv: string[]): { pos: string[]; flags: Flags } {
  const pos: string[] = [];
  const flags: Flags = new Map();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--")) {
      pos.push(a);
      continue;
    }
    const v = BOOL.has(a) ? "true" : argv[++i];
    if (v === undefined || v.startsWith("--")) usage(a + " needs a value");
    flags.set(a, [...(flags.get(a) ?? []), v!]);
  }
  return { pos, flags };
}
const one = (f: Flags, k: string) => f.get(k)?.[0] ?? usage("needs " + k);
const opt = (f: Flags, k: string) => f.get(k)?.[0];
const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;
const write = (path: string, v: unknown) => writeFileSync(path, JSON.stringify(v, (_, x) => (x instanceof Set ? [...x] : x instanceof Map ? Object.fromEntries(x) : x), 2) + "\n");

interface Ctx {
  suite: Suite;
  suiteRef: { id: string; sha256: string };
  states: StatesFile;
  statesSha256: string;
  units: string[];
  passes: number;
  pilot: boolean;
  dir: string;
  maps: ReturnType<typeof loadSeverityMaps>;
  route: RouteName;
}

function context(f: Flags): Ctx {
  const loaded = loadSuite(SUITE.path);
  if (loaded.sha256 !== SUITE.sha256) throw new Error("E_CH_C_FROZEN " + SUITE.path + " hashes to " + loaded.sha256 + ", not " + SUITE.sha256);
  const path = resolve(one(f, "--states"));
  const text = readFileSync(path, "utf8");
  const pilot = f.has("--pilot");
  const passes = pilot ? 1 : PASSES;
  const units = pilot ? [...new Set(text.split("\n").filter((l) => l.trim()).map((l) => (JSON.parse(l) as { unit: string }).unit))].sort() : loaded.suite.units.map((u) => u.id);
  const route = (opt(f, "--route") ?? "A") as RouteName;
  if (!Object.hasOwn(ROUTES, route)) usage("--route is A or B");
  return { suite: loaded.suite, suiteRef: { id: loaded.suite.id, sha256: loaded.sha256 }, states: readStatesFile(path, loaded.suite, { passes, units }), statesSha256: sha256(text), units, passes, pilot, dir: resolve(f.get("--dir")?.[0] ?? "."), maps: loadSeverityMaps(), route };
}

const keyPath = (c: Ctx, s: Stage) => join(c.dir, s + "-key.json");
const runDir = (c: Ctx, s: Stage | "gold") => join(c.dir, s + "-run");
function key(c: Ctx, s: Stage): Key {
  const k = loadKey(keyPath(c, s), c.suiteRef, s);
  if (k.states_sha256 !== c.statesSha256) throw new Error("E_CH_C_BLIND the " + s + " batch was built from another states file (" + k.states_sha256.slice(0, 12) + "); use the one it was built from");
  return k;
}
const maybe = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : null);
const unjudgedAt = (dir: string): Unjudged[] => (existsSync(join(dir, "unjudged.json")) ? readJson<{ entries: Unjudged[] }>(join(dir, "unjudged.json")).entries : []);

/** Each state's counted findings, the extraction's for a no_block state, and which states are mechanical or judge gaps. */
function counted(c: Ctx): { counted: Counted; mechanical: string[]; gaps: string[]; extractBatch: string | null } {
  const need = c.states.states.some((s) => s.record.no_block);
  const out: Counted = new Map();
  let extractBatch: string | null = null;
  if (need) {
    const k = key(c, "extract");
    extractBatch = k.batch;
    for (const [id, v] of readExtraction(k, maybe(join(runDir(c, "extract"), "primary.json")), unjudgedAt(runDir(c, "extract")))) out.set(id, v);
  }
  const mechanical: string[] = [];
  const gaps: string[] = [];
  for (const s of c.states.states) {
    const x = countedOf(s, out);
    if (x === null) gaps.push(s.id);
    else if (x !== undefined && !x.length) mechanical.push(s.id);
  }
  return { counted: out, mechanical, gaps, extractBatch };
}

/** The evidence sheet's code: the finding's file at the unit's head in a local clone, 30 lines either side of its line. */
export function gitCodeAt(sources: Map<string, string>): CodeAt {
  return (unit: Unit, path: string | null, line: number | null) => {
    if (!path) return { code: null, code_note: "the finding names no file, so the sheet shows no code" };
    const clone = sources.get(unit.repo) ?? usage("no --source clone for " + unit.repo + ", which unit " + unit.id + " needs at head " + unit.head);
    const r = spawnSync("git", ["-C", clone, "show", unit.head + ":" + path], { encoding: "utf8", maxBuffer: 256 << 20 });
    if (r.status !== 0) return { code: null, code_note: path + " is not a file in the repository at the head, so the sheet shows no code" };
    const lines = r.stdout.replace(/\n$/, "").split("\n");
    if (line !== null && line > lines.length) return { code: null, code_note: "line " + line + " is past the end of " + path + " (" + lines.length + " lines) at the head" };
    const from = line === null ? 1 : Math.max(1, line - 30);
    const to = Math.min(lines.length, line === null ? 200 : line + 30);
    return { code: { path, from, to, text: lines.slice(from - 1, to).map((l, i) => String(from + i).padStart(String(to).length) + "  " + l).join("\n") }, code_note: null };
  };
}

function packets(c: Ctx, stage: Stage, f: Flags, out: (s: string) => void): void {
  const seed = Number(opt(f, "--seed") ?? SEED);
  const base = { suite: c.suite, suiteSha256: c.suiteRef.sha256, states: c.states, statesSha256: c.statesSha256, maps: c.maps, seed, out: join(c.dir, stage), key: keyPath(c, stage) };
  if (stage === "extract") {
    const k = writeExtract(base);
    return out("extract: batch " + k.batch + ", " + k.packets.length + " packets in " + base.out);
  }
  if (stage === "match") {
    const x = counted(c);
    const items = c.states.states.filter((s) => !x.gaps.includes(s.id) && !x.mechanical.includes(s.id)).reduce((n, s) => n + c.suite.units.find((u) => u.id === s.record.unit)!.blockers.length, 0);
    const anchors = c.pilot ? anchorsFor(c.suite, c.suite.units.filter((u) => c.units.includes(u.id)), items, { seed, offset: CHECK.near_miss_offset, maxShare: CHECK.anchors_max_share }) : [];
    const r = writeMatch({ ...base, counted: x.counted, anchors });
    return out("match: batch " + r.key.batch + ", " + r.key.packets.length + " packets (" + anchors.length + " anchors), " + r.mechanical.length + " states with no counted finding, " + r.gaps.length + " left unjudged by extraction, in " + base.out);
  }
  const judged = readJson<Judged>(join(c.dir, "judged.json"));
  const sources = new Map((f.get("--source") ?? []).map((s) => (s.indexOf("=") > 0 ? [s.slice(0, s.indexOf("=")), resolve(s.slice(s.indexOf("=") + 1))] : usage("--source takes <owner/repo>=<clone>"))));
  const k = writeAdjudicate({ ...base, judged, codeAt: gitCodeAt(sources) });
  out(k ? "adjudicate: batch " + k.batch + ", " + k.packets.length + " packets in " + base.out : "adjudicate: no unmatched blocking finding, so there is nothing to adjudicate and no batch");
}

/** The packets gold labellers read: the pilot's whole matching batch, or the packets of the confirmation draw. */
function goldFiles(c: Ctx, k: Key): { files: string[]; items: string[] } {
  if (c.pilot) return { files: k.packets.map((p) => p.file), items: checkItems(k, c.suite).map((i) => i.item) };
  const joined = joinedMatch(c, k).labels as Map<string, Set<string>>;
  const items = confirmationItems(joined, SEED);
  return { files: [...new Set(items.map((i) => i.slice(0, i.indexOf(" "))))], items };
}

function joinedMatch(c: Ctx, k: Key) {
  const x = counted(c);
  const d = runDir(c, "match");
  return { ...joinReplies<Set<string>>({ key: k, suite: c.suite, states: c.states, counted: x.counted, maps: c.maps, mechanical: x.mechanical, primary: readFileSync(join(d, "primary.json"), "utf8"), second: readFileSync(join(d, "second.json"), "utf8"), third: maybe(join(d, "third.json")), unjudged: unjudgedAt(d) }), x };
}

async function runStage(c: Ctx, stage: Stage | "gold", f: Flags, out: (s: string) => void, env: Record<string, string | undefined>, fetchImpl?: (input: string, init: RequestInit) => Promise<Response>): Promise<void> {
  const route = ROUTES[c.route];
  const brief = readFileSync(BRIEF.path, "utf8");
  if (sha256(brief) !== BRIEF.sha256) throw new Error("E_CH_C_FROZEN " + BRIEF.path + " is not #108's brief " + BRIEF.sha256);
  const k = key(c, stage === "gold" ? "match" : stage);
  const b = readBatch(join(c.dir, stage === "gold" ? "match" : stage), k);
  const role = stage === "adjudicate" ? "adjudicator" : "judge";
  const models = (stage === "extract" ? [route.primary] : stage === "gold" ? [...GOLD] : [route.primary, route.second, route.third]).map((id) => judgeModel(id, role));
  const gold = stage === "gold" ? goldFiles(c, k) : null;
  const files = gold ? gold.files : k.packets.map((p) => p.file);
  if (f.has("--dry-run")) {
    let total = 0;
    for (const m of models)
      for (const p of k.packets.filter((x) => files.includes(x.file))) {
        const w = worstCaseMicros(m, promptFor(b, p, brief));
        total += w;
        out(m.id + "  " + p.file + "  worst case " + usd(w));
      }
    out("worst case: " + usd(total) + " if every model listed read every packet listed, each at every send the retry budget allows; the judge item's cap is $" + JUDGE_ITEM.cap_usd + ". Nothing was sent.");
    return;
  }
  const dir = runDir(c, stage);
  if (existsSync(join(dir, "run.json"))) usage(dir + " already holds a finished run; judge again into a fresh --dir");
  const item = one(f, "--item");
  const runId = one(f, "--run-id");
  const concurrency = Number(opt(f, "--concurrency") ?? 4);
  const x = stage === "extract" ? null : counted(c);
  const { value: r, requests, lease_id } = await withMeteredJudges({ item, runId, record: opt(f, "--record") ?? "", ledger: opt(f, "--ledger") ?? "", out: dir, models, env, fetch: fetchImpl }, async (send): Promise<StageRun | Awaited<ReturnType<typeof runGold>>> => {
    if (stage === "extract") return runExtract({ b, suite: c.suite, model: route.primary, send, concurrency });
    if (stage === "gold") return runGold({ b, suite: c.suite, brief, models: GOLD, files, send, concurrency });
    return runJudged({ b, suite: c.suite, brief, states: c.states, counted: x!.counted, maps: c.maps, mechanical: x!.mechanical, route, send, concurrency });
  });
  if ("sets" in r) {
    for (const [role, text] of Object.entries(r.replies)) writeFileSync(join(dir, role + ".json"), text);
    if (r.unjudged.length) write(join(dir, "unjudged.json"), { batch: k.batch, entries: r.unjudged });
  } else {
    GOLD.forEach((m, i) => writeFileSync(join(dir, "gold-" + (i + 1) + ".json"), r.replies.get(m)!));
    if (r.unjudged.length) write(join(dir, "unjudged.json"), { batch: k.batch, entries: r.unjudged });
  }
  write(join(dir, "run.json"), { version: 1, stage, batch: k.batch, route: stage === "gold" ? null : c.route, models: models.map((m) => m.id), item, run_id: runId, lease_id, requests, unjudged: r.unjudged.length });
  out(stage + ": batch " + k.batch + ", " + requests + " requests, " + r.unjudged.length + " packets unjudged; replies in " + dir);
}

function join_(c: Ctx, stage: "match" | "adjudicate", out: (s: string) => void): void {
  if (stage === "match") {
    const k = key(c, "match");
    const j = joinedMatch(c, k);
    const judged = judgedStates({ key: k, states: c.states, counted: j.x.counted, mechanical: j.x.mechanical, gaps: j.x.gaps, labels: j.labels as Map<string, Set<string>>, dropped: j.sets.dropped, route: c.route, extractBatch: j.x.extractBatch });
    write(join(c.dir, "judged.json"), judged);
    write(join(c.dir, "match-join.json"), { batch: k.batch, judges: j.judges, second_required: j.sets.second.size, arms_or_states_differed: j.sets.differ, third_required: j.sets.third?.size ?? 0, kappa_primary_second: j.kappa_primary_second, unjudged: j.sets.dropped.size });
    return out("match join: " + judged.states.length + " states; second read " + j.sets.second.size + " items, third " + (j.sets.third?.size ?? 0) + ", kappa primary against second " + j.kappa_primary_second);
  }
  const judged = readJson<Judged>(join(c.dir, "judged.json"));
  if (!existsSync(keyPath(c, "adjudicate"))) {
    write(join(c.dir, "judged.json"), addRulings(judged, null, new Map()));
    return out("adjudicate join: no batch, so no ruling is needed");
  }
  const k = key(c, "adjudicate");
  const x = counted(c);
  const d = runDir(c, "adjudicate");
  const j = joinReplies<"defect" | "not-defect" | "known-informational">({ key: k, suite: c.suite, states: c.states, counted: x.counted, maps: c.maps, mechanical: x.mechanical, primary: readFileSync(join(d, "primary.json"), "utf8"), second: readFileSync(join(d, "second.json"), "utf8"), third: maybe(join(d, "third.json")), unjudged: unjudgedAt(d) });
  write(join(c.dir, "judged.json"), addRulings(judged, k, j.labels));
  write(join(c.dir, "adjudicate-join.json"), { batch: k.batch, judges: j.judges, second_required: j.sets.second.size, third_required: j.sets.third?.size ?? 0, kappa_primary_second: j.kappa_primary_second, unjudged: j.sets.dropped.size });
  out("adjudicate join: second read " + j.sets.second.size + " findings, third " + (j.sets.third?.size ?? 0) + ", kappa primary against second " + j.kappa_primary_second);
}

const goldReplies = (c: Ctx) => GOLD.map((_, i) => readFileSync(join(runDir(c, "gold"), "gold-" + (i + 1) + ".json"), "utf8"));

const pts = (x: number) => (x >= 0 ? "+" : "") + (100 * x).toFixed(1);
function line(c: Contrast): string {
  const s = c.stats;
  if (c.incomplete) return c.name + ": withheld (" + c.incomplete + ")";
  if (!s) return c.name + ": no pairs";
  const share = c.metric === "found" || c.metric === "blocking";
  const v = (x: number) => (share ? pts(x) + " points" : (x >= 0 ? "+" : "") + x.toFixed(3) + " per session");
  return c.name + ": " + v(s.delta) + " [" + (s.ci95 ? v(s.ci95[0]) + ", " + v(s.ci95[1]) : "n/a") + "], sign-flip p " + (s.p === null ? "n/a" : s.p.toPrecision(3)) + " on " + s.informative_clusters + " clusters (min p " + (s.min_p ?? "n/a") + "), " + s.gains + " up, " + s.losses + " down, " + s.pairs + " pairs (" + c.dropped + " dropped); reads " + c.reading;
}

export function renderAnalysis(a: Analysis, route: RouteName | null): string[] {
  const contract = contractReading(a, route);
  const e3 = e3Reading(a, route);
  const lines = ["Contract: " + contract.text, "E3: " + e3.text, "", line(a.primary), line(a.check_a) + (a.check_a_fails ? " (check A fails)" : " (check A holds)"), line(a.e3)];
  if (a.e3_cost_per_added_bug_usd !== null) lines.push("E3 cost per added known bug: $" + a.e3_cost_per_added_bug_usd.toFixed(2));
  lines.push("", ...a.within.map(line), "", ...a.between.map(line), "");
  for (const s of Object.values(a.arms)) lines.push(s.arm + ": " + s.scored + " of " + s.planned + " sessions scored" + (s.not_scored_total ? " (" + Object.entries(s.not_scored).map(([k, n]) => k + " " + n).join(", ") + ")" : "") + (s.incomplete ? ", INCOMPLETE" : "") + "; blocked " + s.blocked + ", false blocks " + s.false_block_sessions + ", fail-opens " + s.fail_open_sessions + ", limit stops " + s.limit_stops + ", safety stops " + s.safety_stops + ", no text " + s.no_text + ", reruns " + s.reruns + "; extracted states " + s.extracted_states.first_stop + " first stop and " + s.extracted_states.final + " final; final refers back " + s.final_refers_back + "; cost " + (s.cost.mean_usd === null ? "n/a" : "$" + s.cost.mean_usd.toFixed(2) + " a session") + (s.cost.per_found_bug_usd === null ? "" : ", $" + s.cost.per_found_bug_usd.toFixed(2) + " a found bug-pass"));
  lines.push("", "MDDs (power.txt): contract primary " + POWER.contract_within.map((x) => x.mdd_points + " points at " + x.losses_pct + "% losses").join(", ") + "; between arms " + POWER.between_arms.map((x) => (x.mdd_points ?? "none fits") + (x.mdd_points ? " points" : "") + " at " + x.disagree_pct + "% disagreeing").join(", ") + ".");
  return lines;
}

export interface Io {
  out: (s: string) => void;
  err: (s: string) => void;
}

export async function main(argv: string[], io: Io = { out: (s) => console.log(s), err: (s) => console.error(s) }, o: { env?: Record<string, string | undefined>; fetch?: (input: string, init: RequestInit) => Promise<Response> } = {}): Promise<number> {
  try {
    const { pos, flags } = parse(argv);
    const [cmd, sub] = pos;
    if (cmd === "packets") {
      if (sub !== "extract" && sub !== "match" && sub !== "adjudicate") usage("packets takes extract, match or adjudicate");
      packets(context(flags), sub as Stage, flags, io.out);
    } else if (cmd === "run") {
      if (sub !== "extract" && sub !== "match" && sub !== "adjudicate" && sub !== "gold") usage("run takes extract, match, adjudicate or gold");
      await runStage(context(flags), sub as Stage | "gold", flags, io.out, o.env ?? process.env, o.fetch);
    } else if (cmd === "join") {
      if (sub !== "match" && sub !== "adjudicate") usage("join takes match or adjudicate");
      join_(context(flags), sub as "match" | "adjudicate", io.out);
    } else if (cmd === "check") {
      const c = context(flags);
      if (!c.pilot) usage("check reads the pilot: pass --pilot with the pilot's states");
      const k = key(c, "match");
      const j = joinedMatch(c, k);
      const gold = goldLabels(k, c.suite, goldReplies(c), checkItems(k, c.suite).map((i) => i.item));
      const r: PilotCheck = pilotCheck({ route: c.route, key: k, suite: c.suite, gold, primary: j.primary, joined: j.labels as Map<string, Set<string>> });
      write(join(c.dir, "check.json"), r);
      io.out("judge check, route " + r.route + ": " + (r.pass ? "pass" : "fail") + "; primary kappa " + r.primary.kappa + " on " + r.primary.items + " gold items (" + (r.primary.why ?? "passes") + "); joined kappa " + r.joined.kappa + " (" + (r.joined.why ?? "passes") + "); non-anchor kappa " + r.non_anchor.joined.kappa + (r.non_anchor.required ? " (required)" : " (reported)"));
    } else if (cmd === "confirm") {
      const c = context(flags);
      if (c.pilot) usage("confirm reads the counted run, not the pilot");
      const k = key(c, "match");
      const j = joinedMatch(c, k);
      const items = confirmationItems(j.labels as Map<string, Set<string>>, SEED);
      const r: Confirmation = confirmation({ route: c.route, items, gold: goldLabels(k, c.suite, goldReplies(c), items), joined: j.labels as Map<string, Set<string>> });
      write(join(c.dir, "confirm.json"), r);
      io.out("confirmation check, route " + r.route + ": " + (r.pass ? "pass" : "fail") + "; joined kappa " + r.joined.kappa + " on " + r.joined.items + " gold items of " + r.drawn + " drawn");
    } else if (cmd === "route") {
      const pairs = (k: string) => new Map((flags.get(k) ?? []).map((s) => [s.slice(0, s.indexOf("=")), readJson<{ pass: boolean; route: RouteName }>(s.slice(s.indexOf("=") + 1))]));
      const checks = pairs("--check");
      const confirms = pairs("--confirm");
      const r = chooseRoute(Object.fromEntries(["A", "B"].map((x) => [x, { pilot: checks.get(x) ?? null, confirmation: confirms.get(x) ?? null }])));
      io.out(JSON.stringify({ route: r, checks: Object.fromEntries([...checks].map(([x, v]) => [x, v.pass])), confirmations: Object.fromEntries([...confirms].map(([x, v]) => [x, v.pass])) }));
    } else if (cmd === "analyze") {
      const c = context(flags);
      const judged = readJson<Judged>(join(c.dir, "judged.json"));
      const route = readJson<{ route: RouteName | null }>(one(flags, "--route-file")).route;
      if (route !== null && route !== judged.route) throw new Error("E_CH_C_CHECK the route that passed is " + route + ", but judged.json was judged on route " + judged.route);
      const a = analyze(c.suite, c.states, scoreSessions(c.states, judged, c.maps), { units: c.units, passes: c.passes });
      if (flags.has("--json")) io.out(JSON.stringify({ analysis: a, contract: contractReading(a, route), e3: e3Reading(a, route) }, null, 2));
      else for (const l of renderAnalysis(a, route)) io.out(l);
    } else if (cmd === "pilot") {
      const c = context(new Map([...flags, ["--pilot", ["true"]]]));
      const hand = readJson<HandReading[]>(one(flags, "--hand"));
      const check = flags.has("--dir") && existsSync(join(c.dir, "check.json")) ? readJson<PilotCheck>(join(c.dir, "check.json")) : null;
      const r = pilotReadout(c.states, hand, check);
      if (flags.has("--json")) io.out(JSON.stringify(r, null, 2));
      else {
        for (const a of r.arms) io.out(a.arm + ": " + a.scored + " of " + a.sessions + " scored, gaps " + JSON.stringify(a.gaps) + ", reruns " + a.reruns + "; blocked " + a.exposure.blocked + " (" + a.exposure.blocks + " blocks, items " + JSON.stringify(a.exposure.items_named) + "), fail-opens " + a.exposure.fail_open + ", false blocks " + a.exposure.false_block + ", would block " + a.exposure.would_block + "; cost mean " + (a.cost.mean_usd?.toFixed(2) ?? "n/a") + ", median " + (a.cost.median_usd?.toFixed(2) ?? "n/a") + ", p95 " + (a.cost.p95_usd?.toFixed(2) ?? "n/a") + "; hand reading " + a.hand.agree + " of " + a.hand.read);
        if (r.judge_check) io.out("judge check: " + (r.judge_check.pass ? "pass" : "fail") + ", primary kappa " + r.judge_check.primary.kappa + ", joined kappa " + r.judge_check.joined.kappa);
        for (const s of r.statements) io.out(s);
        io.out(r.r113.line);
      }
    } else if (cmd === "judge-item") {
      const r = judgeItemDryRun(opt(flags, "--run-id") ?? "geva-562-judge-dry-run");
      io.out("judge item " + r.item + ": central $" + JUDGE_ITEM.central_usd + ", cap " + r.cap + "; on a temporary ledger, lease " + r.lease_id + " opened and settled (" + r.settled + "), " + r.committed + " committed. It pays for " + JUDGE_ITEM.what + ".");
    } else if (cmd === "power") {
      io.out(JSON.stringify(POWER, null, 2));
    } else usage(cmd ? "unknown command " + JSON.stringify(cmd) : "needs a command");
    return 0;
  } catch (e) {
    const m = (e as Error).message;
    io.err(/^[A-Z][A-Z0-9_]+\b/.test(m) ? m : "E_INTERNAL " + m);
    return 2;
  }
}

if (import.meta.main) process.exit(await main(Bun.argv.slice(2)));
