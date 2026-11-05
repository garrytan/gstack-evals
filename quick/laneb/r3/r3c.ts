// R3c (R3 amendment 6, wiki/plans/2026-11-05-geva-284-r3c-calibrated, with five build points the Captain ruled on
// 2026-11-05): told /investigate at gstack 699a41cb with the procedure line against none, Opus 5.5 only, on SWE-rebench pool
// tasks whose measured none rate is in [0.2, 0.8]. The frozen rules are r3c-rules.ts (the post's r3c.ts.txt with only its
// import lines changed; a keyless test checks). One item, r3c-opus ($750, ledger port 9917), holds every part, each on its
// own VM, six trials at a time, with the run-time oracle gate on:
//   cal-1a .. cal-1c   cal-1's 438 none trials (calibrationPlan over the frozen tiers): each candidate repeated by its
//                      tier's trial count, shuffled with seed 20261112 and cut into three parts of 146 in that order. A part
//                      lists a task once per trial it holds, and its order.json is its slice of the shuffle.
//   cal-2              4 more none trials on each t4 task whose cal-1 trial failed (cal2Tasks), in Harbor's own order;
//                      prepared once cal-1c settles, and skipped when no t4 task failed.
//   admit              r3c-rules.ts admission at its frozen 2,000 simulated grids, on every calibration trial, at the
//                      ledger's current cap and settled total. GO prepares the grid and stops; STOP ends the item.
//   grid-1 .. grid-k   the admitted tasks x R replicates x {none, told}, 4 replicates a part (the last takes the
//                      remainder), each part in a seed 20261113 shuffle of its task, arm and replicate slots.
// Every arm's prompt ends with R3C.closingLine after a blank line (closing_line=r3c-root-cause-files).
// Commands (bun quick/laneb/r3/r3c.ts ...):
//   arm-check [<manifest dir>]          R3b's told arm check; the told arm is R3b's, unchanged
//   prepare <work dir> --item r3c-opus  env LEDGER, INHAND (the five in-hand records and r3c-taskfit.tsv), ARMS (none.tar.gz
//                                       and the told arm's gstack.tar.gz), SWEREBENCH: prepares cal-1a to cal-1c
//   run <work dir> --item r3c-opus      the same env, plus UBI_RUNNER, UBI_OWNER, UBI_TTL_HOURS (12 or more),
//                                       UBICLOUD_API_KEY, VM_USD_PER_HOUR=0.6, VM_RESERVE_HOURS=4, the provider keys and
//                                       LEDGER_PORT (default 9917): binds the item, runs calibration and admit, and on GO
//                                       prepares the grid parts and stops, so the run thread can send the admit lines first
//   grid <work dir> --item r3c-opus     the same env, once the admit lines have reached the Captain: runs the grid parts
//   resume <work dir> --item r3c-opus   the same env, after a projection stop and a recorded raise
//   admit <work dir> --item r3c-opus    env LEDGER, INHAND: prints admission again from the pulled calibration (exit 0 GO,
//                                       5 STOP); it writes nothing
//   analyze <work dir> --item r3c-opus  env LEDGER, INHAND; R3C_MDD_SIMS (the report-only MDD re-simulation, default 2000)
// Where the controller runs: run, grid and resume launch the parts one after another and wait on each, for many hours, so
// start them detached, with setsid, on a host that stays awake for the whole run and keeps the item's ledger file, such as a
// dedicated runner VM the run thread names and pins. Never on a Capy machine that can sleep.
// The rules:
// - run binds the item only when prepare's plan holds the frozen candidates (sha256 7a2b33c7...) and the seed 20261112
//   split, every part has its oracle.json and its plan's tasks, attempts, arms and order, every task's verifier parser is
//   the pinned one (whose passing statuses are PASSED and XFAIL), and the start rule holds: settled spend plus cal-1 and a
//   worst-case cal-2 (4 trials on every t4 task) at R3b's measured none cost and VM hours, plus the $79.20 reserve
//   headroom, fits the item's cap.
// - Before every later part, a projection from cost data only over the ledger's current cap stops the run before that
//   part: settled spend; plus each remaining trial at the item's measured cost for its arm (graded trials only, a graded
//   trial with no metered cost at the $12 allowance); plus each remaining trial's VM at the item's measured VM cost a
//   trial; plus the reserve headroom. In calibration the remaining trials are the remaining cal-1 slots and cal-2 (440
//   until cal-1c settles), at R3b's none cost and VM hours until cal-1a settles. In the grid, until grid-1 settles, none is
//   admit's priced none cost, told is that times R3b's told over none, and VM is R3b's hours; from grid-1 on all three come
//   from the grid's own trials. resume relaunches from the stopped part once per stop, after a raise recorded after it
//   (ledger.ts raise --approved-by <file>), and only when the projection fits the raised cap.
// - A part is incomplete on any launch or cap failure, a trial count other than its plan's, no "laneb order: applied N
//   trials" line in its harbor.log when it has an order.json, or more than 10% infra trials. An incomplete calibration part
//   ends the item before admit. An incomplete grid part, or more than 10% infra in the grid's none or told cell, makes R3c
//   incomplete.
// - analyze, on a complete grid and in order: under 90% of graded told grid trials exposed is FIX-METHOD (exposure); told
//   allowance stops more than 5 points above none's is FIX-METHOD (truncation); a 95% interval above zero is KEEP; a
//   primary at or below zero is FIX-METHOD (task fit) when the D1 sensitivity set holds fewer than ceil(3n/7) tasks, and
//   CUT-CANDIDATE when the sensitivity contrast is also at or below zero; anything else is FIX-METHOD (power). Every other
//   line is report-only.
// - Localization (report only) reads each graded trial's closing block from its main-thread assistant text: cliStream
//   turns the agent's sdk-messages.jsonl into the stream r3c-rules.ts mainText reads, then closingBlock. A trial with no
//   readable main-thread text is a recorded error (E_TRANSCRIPT_UNREADABLE), never a miss, and while any graded grid trial
//   has one, localization prints that error instead of rates.
// Exit codes: run 0 admission GO (grid prepared), 5 admission STOP, 4 stopped before admit, 7 the start rule refused the
// bind; grid and resume 0 when the parts ran to the end or to admit, 4 when a part or a projection stopped them (resume
// after a calibration stop ends with run's codes); admit 0 GO, 5 STOP; analyze 0 KEEP, 3 CUT-CANDIDATE, 5 FIX-METHOD on a
// complete grid, 6 admission STOP, 4 incomplete; arm-check 1 on a failed check; 2 usage; 1 any other error.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { analyze as analyzeTrials, bootstrap, readSessionRows, rng, sessionsByTrial } from "../analysis/analyze.ts";
import { fromMicros, readRows, totals, type Row } from "../runner/ledger.ts";
import { CLOSING_LINES, PROCEDURE_LINES } from "../runner/grid.ts";
import { agentText, loadR3Trial, toTrial, type ProxyConfig, type R3Trial } from "./exposure.ts";
import { armCheck, hookState, phaseHeadings, PIN, R3B_TOLD, repoSkills, TOLD_TAR_SHA256, vmSettled, type GridTrial } from "./r3b.ts";
import { A4, itemCheck, launchEnv, OPUS, portTaken, PROXY_FILES, R3_ARMS, sh, unreadable, type R3aModel } from "./screen.ts";
import { admission, admissionLines, admitOptions, cal2Tasks, calibrationPlan, closingBlock, f2pShare, goldFiles, GRID, idsSha, loadInHand, locHit, locRank, mainText, mddPoints, oracleF2p, R3C, tiers, type TrialRow } from "./r3c-rules.ts";

const LANEB = resolve(import.meta.dir, "..");
const NONE = "none", TOLD = "gstack";
export const CLOSING = "r3c-root-cause-files";
export const R3C_NONE = R3_ARMS.none + ":closing_line=" + CLOSING;
export const R3C_TOLD = R3B_TOLD + ":closing_line=" + CLOSING;
export const RUN = {
  item: "r3c-opus", capUsd: 750, ledgerPort: "9917", manifests: "arms/manifests/r3b", cells: A4.cells, concurrent: A4.concurrent, allowanceUsd: 12,
  candidatesSha256: "7a2b33c723b14ae97c4d8286a42bc5d914ffe2d856eb1ef42b50e1dcddfd1d27", cal1Parts: ["cal-1a", "cal-1b", "cal-1c"], cal1Seed: 20261112,
  gridSeed: 20261113, gridPartReplicates: 4, infraBound: 0.1, exposureGate: 0.9, truncationPoints: 5, seed: 20261101, draws: 10000, minTtlHours: 12,
  vmUsdPerHour: "0.6", vmReserveHours: "4",
  // The verifier parser every pool task ships (tests/parser.py): its report.json gives each FAIL_TO_PASS and PASS_TO_PASS
  // test's status, and it counts PASSED and XFAIL toward the reward.
  parserSha256: "bdedd1a6f64c511cc1e2c8c4b9e9402d61e68d962dbebc78d9d86ec4ea3cd261", passStatuses: ["PASSED", "XFAIL"],
};
export const ITEM: R3aModel = {
  id: OPUS, label: "Opus 5.5", item: RUN.item, capUsd: RUN.capUsd, capFrom: "amendment 6's", routePrefix: null, ledgerPort: RUN.ledgerPort, parts: [],
  tag: " for Opus 5.5", stop: "R3c stops", incomplete: "R3c is incomplete; the Captain gets the record.", projection: () => ({ text: "", usd: {} }),
  a4: { allowanceUsd: RUN.allowanceUsd }, armManifests: RUN.manifests,
};
export type Part = { name: string; job: string; arm: string; prefix: string };
const part = (name: string): Part => ({ name, job: RUN.item + "-" + name, arm: name.startsWith("grid-") ? R3C_NONE + "," + R3C_TOLD : R3C_NONE, prefix: RUN.item + "-" + name + "/" });
const sha = (b: string | Buffer) => createHash("sha256").update(b).digest("hex");
const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const writeJson = (p: string, v: unknown) => writeFileSync(p, JSON.stringify(v, null, 2) + "\n");
const fmt = (x: unknown, d: number) => (typeof x === "number" && Number.isFinite(x) ? x.toFixed(d) : "n/a");
const draw = <T>(seed: number, items: T[]): T[] => { const r = rng(seed), left = [...items], out: T[] = []; while (left.length) out.push(left.splice(Math.floor(r() * left.length), 1)[0]!); return out; };

// cal-1's split: every candidate repeated by its tier's trial count (calibrationPlan's order), shuffled with seed 20261112,
// cut into three consecutive parts.
export function cal1Split(tr: ReturnType<typeof tiers>) {
  const slots = draw(RUN.cal1Seed, calibrationPlan(tr).cal1.flatMap((x) => Array.from({ length: x.trials }, () => x.task)));
  const size = Math.ceil(slots.length / RUN.cal1Parts.length);
  return { slots, parts: RUN.cal1Parts.map((name, k) => ({ name, slots: slots.slice(k * size, (k + 1) * size) })) };
}
// The grid: parts of 4 replicates, the last taking the remainder; each part's order is a seed 20261113 shuffle of its tasks
// x arms x replicates, tasks sorted with none before told.
export const gridSizes = (R: number) => Array.from({ length: Math.ceil(R / RUN.gridPartReplicates) }, (_, k) => Math.min(RUN.gridPartReplicates, R - k * RUN.gridPartReplicates));
export const gridOrder = (tasks: string[], reps: number) => draw(RUN.gridSeed, [...tasks].sort().flatMap((t) => Array.from({ length: reps }, () => [[t, NONE], [t, TOLD]] as [string, string][]).flat()));

// The start rule (section 9): settled spend plus cal-1 and a worst-case cal-2 at R3b's measured none cost and VM hours, plus
// the reserve headroom, fits the cap.
const planTrialUsd = R3C.cost.opus.planNoneUsd + R3C.vmUsdPerHour * R3C.cost.opus.vmHoursNone;
export function startRule(tr: ReturnType<typeof tiers>, capUsd: number, settledUsd = 0) {
  const trials = calibrationPlan(tr).cal1Trials + R3C.t4Second * tr.t4.length;
  const usd = settledUsd + trials * planTrialUsd + R3C.reserveUsd, ok = usd <= capUsd + 1e-9;
  return { ok, usd, trials, line: "start rule: projection $" + usd.toFixed(2) + " = settled $" + settledUsd.toFixed(2) + " + " + trials + " calibration trials (cal-1 and a worst-case cal-2) at $" + planTrialUsd.toFixed(5) + " + reserve headroom $" + R3C.reserveUsd.toFixed(2) + ", " + (ok ? "fits" : "passes") + " " + RUN.item + "'s $" + capUsd + " cap" + (ok ? "" : "; " + RUN.item + " does not bind") };
}

// A trial's cost for the projections: graded trials only, a graded trial with no metered cost at the allowance.
const meanCost = (ts: R3Trial[]) => { const g = ts.filter((t) => t.outcome !== "infra"); return g.length ? g.reduce((s, t) => s + (t.cost_usd ?? RUN.allowanceUsd), 0) / g.length : null; };

export type CalState = { rows: Row[]; capUsd: number; next: string; remainingTrials: number; cal2Known: boolean; done: R3Trial[]; doneVmUsd: number };
export function calProjection(o: CalState) {
  const settled = fromMicros(totals(o.rows).settledMicros);
  const none = o.done.length ? meanCost(o.done) ?? RUN.allowanceUsd : R3C.cost.opus.planNoneUsd;
  const vm = o.done.length ? o.doneVmUsd / o.done.length : R3C.vmUsdPerHour * R3C.cost.opus.vmHoursNone;
  const usd = settled + o.remainingTrials * (none + vm) + R3C.reserveUsd, over = usd > o.capUsd + 1e-9;
  const line = "before " + o.next + ": projection $" + usd.toFixed(2) + " (settled $" + settled.toFixed(2) + "; " + o.remainingTrials + " calibration trials" + (o.cal2Known ? "" : ", cal-2 at its worst case") + " at $" + none.toFixed(4) + " none and $" + vm.toFixed(4) + " VM a trial; reserve headroom $" + R3C.reserveUsd.toFixed(2) + ") " + (over ? "passes" : "fits") + " " + RUN.item + "'s $" + o.capUsd + " cap" + (over ? "; the run stops before " + o.next + " and the Captain decides a raise" : "; " + o.next + " starts");
  return { over, line, record: { next: o.next, projection_usd: usd, cap_usd: o.capUsd, settled_usd: settled, remaining_trials: o.remainingTrials, cal2_known: o.cal2Known, none_usd: none, vm_trial_usd: vm, reserve_usd: R3C.reserveUsd, over } };
}
export type GridState = { rows: Row[]; capUsd: number; next: string; n: number; remainingReps: number; admitNoneUsd: number; done: R3Trial[]; doneVmUsd: number };
export function gridProjection(o: GridState) {
  const settled = fromMicros(totals(o.rows).settledMicros), c = R3C.cost.opus;
  const none = o.done.length ? meanCost(o.done.filter((t) => t.arm === NONE)) ?? RUN.allowanceUsd : o.admitNoneUsd;
  const told = o.done.length ? meanCost(o.done.filter((t) => t.arm === TOLD)) ?? RUN.allowanceUsd : o.admitNoneUsd * c.toldOverNone;
  const pairs = o.n * o.remainingReps;
  const vm = o.done.length ? pairs * 2 * (o.doneVmUsd / o.done.length) : pairs * R3C.vmUsdPerHour * (c.vmHoursNone + c.vmHoursTold);
  const usd = settled + pairs * (none + told) + vm + R3C.reserveUsd, over = ![none, told, vm, usd].every((x) => typeof x === "number" && Number.isFinite(x)) || usd > o.capUsd + 1e-9;
  const line = "before " + o.next + ": projection $" + fmt(usd, 2) + " (settled $" + settled.toFixed(2) + "; " + pairs + " task-replicate pairs at $" + fmt(none, 4) + " none and $" + fmt(told, 4) + " told, VM $" + fmt(vm, 2) + "; reserve headroom $" + R3C.reserveUsd.toFixed(2) + ") " + (over ? "passes" : "fits") + " " + RUN.item + "'s $" + o.capUsd + " cap" + (over ? "; the run stops before " + o.next + " and the Captain decides a raise" : "; " + o.next + " starts");
  return { over, line, record: { next: o.next, projection_usd: usd, cap_usd: o.capUsd, settled_usd: settled, remaining_pairs: pairs, none_usd: none, told_usd: told, vm_usd: vm, reserve_usd: R3C.reserveUsd, over } };
}

// Localization input: the agent's sdk-messages.jsonl as the message stream r3c-rules.ts mainText reads. The agent logs each
// assistant message as {type: "AssistantMessage", content, parent_tool_use_id} with the SDK's blocks as plain objects: a
// text block {text}, a thinking block {thinking, signature}, a tool call {id, name, input}. A record with no
// parent_tool_use_id field comes from a build that did not log it, so main-thread text can't be told from a subagent's:
// that, an unparseable line other than a torn last line, or no non-blank main-thread text block, is E_TRANSCRIPT_UNREADABLE.
export function cliStream(lines: string[]) {
  const out: { type: string; parent_tool_use_id: string | null; message: { content: unknown[] } }[] = [];
  const body = lines.filter((l) => l.trim());
  body.forEach((line, i) => {
    let rec: any;
    try { rec = JSON.parse(line); } catch { if (i === body.length - 1) return; throw new Error("E_TRANSCRIPT_UNREADABLE line " + (i + 1) + " is not JSON, and only a torn last line may be"); }
    if (rec?.type !== "AssistantMessage") return;
    if (!("parent_tool_use_id" in rec)) throw new Error("E_TRANSCRIPT_UNREADABLE record " + (i + 1) + " (AssistantMessage) has no parent_tool_use_id field, so main-thread text can't be told from a subagent's");
    const content = (Array.isArray(rec.content) ? rec.content : []).map((b: any) =>
      b && typeof b === "object" && "thinking" in b ? { type: "thinking", thinking: b.thinking }
        : b && typeof b === "object" && typeof b.text === "string" ? { type: "text", text: b.text }
          : b && typeof b === "object" && "name" in b && "input" in b ? { type: "tool_use", name: b.name }
            : { type: "other" });
    out.push({ type: "assistant", parent_tool_use_id: rec.parent_tool_use_id ?? null, message: { content } });
  });
  return out;
}
export function readClosing(lines: string[]): { block: string[] | null; error: string | null } {
  try {
    const text = mainText(cliStream(lines));
    if (!text.some((t) => t.trim())) throw new Error("E_TRANSCRIPT_UNREADABLE no main-thread assistant text block");
    return { block: closingBlock(text), error: null };
  } catch (e) {
    const msg = String((e as Error).message);
    if (!msg.startsWith("E_TRANSCRIPT_UNREADABLE")) throw e;
    return { block: null, error: msg };
  }
}

// Per-test record: the task parser's /logs/verifier/report.json, as Harbor keeps it in the trial's verifier/ directory.
export function testRecord(trialDir: string): { f2p: Record<string, string>; p2p: Record<string, string> } | null {
  try {
    const r = readJson(join(trialDir, "verifier", "report.json"));
    if (!r || typeof r.fail_to_pass !== "object" || typeof r.pass_to_pass !== "object") return null;
    return { f2p: r.fail_to_pass, p2p: r.pass_to_pass };
  } catch { return null; }
}
export const passStatus = (rec: ReturnType<typeof testRecord>) => Object.fromEntries(Object.entries({ ...(rec?.p2p ?? {}), ...(rec?.f2p ?? {}) }).map(([k, v]) => [k, RUN.passStatuses.includes(String(v)) ? "pass" : String(v)]));
export function taskTests(taskDir: string): { f2p: string[]; p2p: string[] } {
  const c = readJson(join(taskDir, "tests", "config.json"));
  if (!Array.isArray(c.FAIL_TO_PASS) || !Array.isArray(c.PASS_TO_PASS)) throw new Error(taskDir + "/tests/config.json has no FAIL_TO_PASS and PASS_TO_PASS lists");
  return { f2p: c.FAIL_TO_PASS.map(String), p2p: c.PASS_TO_PASS.map(String) };
}
export const trialF2p = (rec: ReturnType<typeof testRecord>, t: { f2p: string[]; p2p: string[] }) => f2pShare(passStatus(rec), t.f2p, t.p2p);

export type R3cTrial = GridTrial & { part: string; closing: string[] | null; closing_error: string | null; tests: ReturnType<typeof testRecord>; f2p_share: number | null };
const gstackSkills = () => new Set<string>(readJson(join(LANEB, RUN.manifests, "gstack.json")).skills.names);
const trialDirs = (jobsDir: string, oracle: boolean) => !existsSync(jobsDir) ? [] : readdirSync(jobsDir).sort().filter((j) => j.endsWith("-oracle") === oracle && statSync(join(jobsDir, j)).isDirectory())
  .flatMap((j) => readdirSync(join(jobsDir, j)).sort().map((n) => join(jobsDir, j, n)).filter((d) => statSync(d).isDirectory()));

export function loadTrials(partName: string, partDir: string): R3cTrial[] {
  const jobs = join(partDir, "pulled/jobs"), sessionsPath = join(partDir, "pulled/out/proxy-sessions.jsonl");
  const sessions = sessionsByTrial(existsSync(sessionsPath) && !unreadable(sessionsPath) ? readSessionRows([sessionsPath]) : []);
  const proxy = readJson(join(partDir, "proxy.json")) as ProxyConfig, skills = gstackSkills(), tests = new Map<string, { f2p: string[]; p2p: string[] }>();
  const out: R3cTrial[] = [];
  for (const d of trialDirs(jobs, false)) {
    const t = loadR3Trial(d, sessions, proxy);
    if (!t) continue;
    const msgs = join(d, "evaluator", "sdk-messages.jsonl");
    const lines = existsSync(msgs) ? readFileSync(msgs, "utf8").split("\n") : [];
    if (!tests.has(t.task)) tests.set(t.task, taskTests(join(partDir, "tasks", t.task)));
    const rec = testRecord(d), c = readClosing(lines);
    out.push({ ...t, phase_headings: phaseHeadings(agentText(lines)), hooks: hookState(d), ...repoSkills(lines, skills), part: partName, closing: c.block, closing_error: c.error, tests: rec, f2p_share: trialF2p(rec, tests.get(t.task)!) });
  }
  return out;
}
// The oracle gate's trials (report only): each task's oracle patch, which goldFiles reads, and the oracle's per-test score.
// Harbor keeps the container's /logs/artifacts/ under the trial's artifacts/logs/artifacts/ (the keyless capture shows it).
export function loadOracle(partDir: string) {
  const out: { task: string; patch: string | null; f2p_share: number | null }[] = [];
  for (const d of trialDirs(join(partDir, "pulled/jobs"), true)) {
    let task: string;
    try { task = String(readJson(join(d, "config.json")).task.path).split("/").filter(Boolean).at(-1)!; } catch { continue; }
    const patchPath = join(d, "artifacts", "logs", "artifacts", "model.patch");
    out.push({ task, patch: existsSync(patchPath) ? readFileSync(patchPath, "utf8") : null, f2p_share: trialF2p(testRecord(d), taskTests(join(partDir, "tasks", task))) });
  }
  return out;
}

// Each part's plan: the (task, arm) trial counts, the job's attempts and arms, and its order (null for Harbor's own order).
export type PartPlan = { name: string; tasks: string[]; attempts: number; arms: string[]; order: [string, string][] | null; counts: Map<string, number> };
const key = (task: string, arm: string) => task + "\t" + arm;
function countsOf(pairs: [string, string][]) { const m = new Map<string, number>(); for (const [t, a] of pairs) m.set(key(t, a), (m.get(key(t, a)) ?? 0) + 1); return m; }
function inHand() {
  const dir = process.env.INHAND ?? "";
  if (!dir) throw new Error("E_USAGE set INHAND to the directory holding the five in-hand records named in r3c-rules.ts INHAND and the post's r3c-taskfit.tsv");
  const h = loadInHand(dir), tr = tiers(h, "opus"), cands = [...tr.t1, ...tr.t2, ...tr.t3, ...tr.t4];
  if (idsSha(cands) !== RUN.candidatesSha256) throw new Error("E_PIN_MISMATCH the candidates' sha256 " + idsSha(cands) + " is not the frozen " + RUN.candidatesSha256 + "; fix: check INHAND holds the pinned records");
  return { h, tr };
}
export function planOf(work: string, tr: ReturnType<typeof tiers>, name: string): PartPlan | null {
  const split = cal1Split(tr), c1 = split.parts.find((p) => p.name === name);
  if (c1) { const order = c1.slots.map((t) => [t, NONE] as [string, string]); return { name, tasks: [...new Set(c1.slots)].sort(), attempts: 1, arms: [NONE], order, counts: countsOf(order) }; }
  if (name === "cal-2") {
    if (!existsSync(join(work, "cal2.json"))) return null;
    const tasks: string[] = readJson(join(work, "cal2.json")).tasks;
    return { name, tasks, attempts: R3C.t4Second, arms: [NONE], order: null, counts: countsOf(tasks.flatMap((t) => Array.from({ length: R3C.t4Second }, () => [t, NONE] as [string, string]))) };
  }
  const k = /^grid-(\d+)$/.exec(name);
  if (!k || !existsSync(join(work, "grid.json"))) return null;
  const g = readJson(join(work, "grid.json")), size = gridSizes(g.R)[Number(k[1]) - 1];
  if (!size) return null;
  const order = gridOrder(g.list, size);
  return { name, tasks: [...g.list].sort(), attempts: size, arms: [NONE, TOLD], order, counts: countsOf(order) };
}
const calNames = (work: string) => [...RUN.cal1Parts, ...(existsSync(join(work, "cal2.json")) && readJson(join(work, "cal2.json")).tasks.length ? ["cal-2"] : [])];
const gridNames = (work: string) => (existsSync(join(work, "grid.json")) ? gridSizes(readJson(join(work, "grid.json")).R).map((_, k) => "grid-" + (k + 1)) : []);

// Every task's verifier parser is the pinned one, so "pass" means PASSED or XFAIL (section 7).
function parserCheck(dir: string, tasks: string[]) {
  for (const t of new Set(tasks)) {
    const p = join(dir, "tasks", t, "tests", "parser.py"), got = existsSync(p) ? sha(readFileSync(p)) : "missing";
    if (got !== RUN.parserSha256) throw new Error("E_PIN_MISMATCH " + p + ": sha256 " + got + " is not the pinned verifier parser " + RUN.parserSha256 + ", whose passing statuses are PASSED and XFAIL; fix: materialize the task again from the pinned SWE-rebench export");
  }
}
// A prepared part matches its plan: oracle.json over its tasks, job.json's tasks (once per trial for cal-1), attempts and
// arms, the closing line on every arm, the told arm's procedure line, the order file, and the pinned parser.
function partCheck(work: string, p: PartPlan) {
  const dir = join(work, p.name);
  if (!existsSync(join(dir, "oracle.json"))) throw new Error(p.name + " has no oracle.json, so its run-time oracle gate can't run; prepare it again with this build");
  const job = readJson(join(dir, "job.json")), oracle = readJson(join(dir, "oracle.json"));
  const names = (j: any) => j.tasks.map((t: any) => String(t.path).split("/").at(-1)).sort();
  const want = p.order && p.attempts === 1 ? p.order.map(([t]) => t).sort() : p.tasks;
  if (JSON.stringify(names(job)) !== JSON.stringify(want) || job.n_attempts !== p.attempts) throw new Error(p.name + "/job.json's tasks or attempts are not the plan's");
  if (JSON.stringify([...new Set(names(oracle))]) !== JSON.stringify(p.tasks)) throw new Error(p.name + "/oracle.json's tasks are not the plan's");
  const agents: any[] = job.agents;
  if (JSON.stringify(agents.map((a) => a.kwargs.arm).sort()) !== JSON.stringify([...p.arms].sort())) throw new Error(p.name + "/job.json's arms are not " + p.arms.join(" and "));
  for (const a of agents) {
    if (a.kwargs.closing_line !== CLOSING) throw new Error(p.name + ": arm " + a.kwargs.arm + " has no closing line " + CLOSING);
    if (a.kwargs.arm === TOLD && (a.kwargs.arm_sha256 !== TOLD_TAR_SHA256 || a.kwargs.procedure_line !== "investigate-phases" || a.kwargs.told_skill !== "investigate")) throw new Error(p.name + ": the told arm is not gstack " + PIN.slice(0, 8) + " told /investigate with the procedure line");
  }
  const orderPath = join(dir, "order.json");
  if (p.order ? !existsSync(orderPath) || JSON.stringify(readJson(orderPath)) !== JSON.stringify(p.order) : existsSync(orderPath)) throw new Error(p.name + "'s order.json is not the plan's");
  parserCheck(dir, p.tasks);
}
function planCheck(work: string, tr: ReturnType<typeof tiers>) {
  if (!existsSync(join(work, "plan.json"))) throw new Error("E_USAGE " + work + " has no plan.json; run prepare first");
  const plan = readJson(join(work, "plan.json"));
  if (plan.item !== RUN.item) throw new Error("E_USAGE " + work + "/plan.json is item " + plan.item + "'s, not " + RUN.item + "'s; nothing was bound or launched");
  if (plan.candidates_sha256 !== RUN.candidatesSha256 || plan.cal1_slots_sha256 !== sha(JSON.stringify(cal1Split(tr).slots))) throw new Error(work + "/plan.json's candidates or cal-1 split are not the frozen ones");
  for (const name of [...calNames(work), ...gridNames(work)]) if (existsSync(join(work, name))) partCheck(work, planOf(work, tr, name)!);
  return plan;
}

function preparePart(work: string, p: PartPlan) {
  const arms = process.env.ARMS ?? "";
  if (!arms) throw new Error("E_USAGE set ARMS to the directory holding none.tar.gz and the told arm's gstack.tar.gz (the project drive's laneb-arms/r3b-gstack-699a41cb, joined)");
  const pp = part(p.name), dir = join(work, p.name);
  const env = { ...process.env, TASK_SET: "swerebench-r3a4", CELLS: RUN.cells, ARM_MANIFESTS: RUN.manifests, TASKS: p.tasks.join(","), ORACLE: "1" };
  const rc = sh([process.execPath, join(LANEB, "runner/prepare-run.ts"), dir, pp.job, OPUS, pp.arm, arms, String(p.attempts), RUN.concurrent], env);
  if (rc !== 0) throw new Error("prepare-run for " + p.name + " exited " + rc);
  if (p.order && p.attempts === 1) {
    const job = readJson(join(dir, "job.json")), base = String(job.tasks[0].path).replace(/\/[^/]+$/, "");
    job.tasks = p.order.map(([t]) => ({ path: base + "/" + t }));
    writeJson(join(dir, "job.json"), job);
  }
  if (p.order) writeFileSync(join(dir, "order.json"), JSON.stringify(p.order) + "\n");
  writeFileSync(join(dir, "STOP_ON_CAP"), "");
  partCheck(work, p);
}

function prepare(work: string) {
  itemCheck(process.env.LEDGER ?? "", ITEM);
  const bad = armCheck();
  if (bad.length) throw new Error("arm-check fails: " + bad.join("; "));
  const { tr } = inHand(), split = cal1Split(tr);
  mkdirSync(work, { recursive: true });
  for (const name of RUN.cal1Parts) preparePart(work, planOf(work, tr, name)!);
  writeJson(join(work, "plan.json"), {
    item: RUN.item, cap_usd: RUN.capUsd, pin: PIN, told_tar_sha256: TOLD_TAR_SHA256, candidates_sha256: RUN.candidatesSha256, cal1_seed: RUN.cal1Seed,
    cal1_slots_sha256: sha(JSON.stringify(split.slots)), cal1_parts: split.parts.map((p) => ({ name: p.name, trials: p.slots.length, tasks: new Set(p.slots).size })),
    grid_seed: RUN.gridSeed, procedure_line_sha256: sha(PROCEDURE_LINES["investigate-phases"]), closing_line_sha256: sha(CLOSING_LINES[CLOSING]), parser_sha256: RUN.parserSha256, concurrent: Number(RUN.concurrent),
  });
  console.log("prepared " + work + ": cal-1a to cal-1c (" + split.parts.map((p) => p.slots.length).join(", ") + " none trials, seed " + RUN.cal1Seed + " split), every part with its oracle.json; cal-2 and the grid are prepared during run; item " + RUN.item + " unbound");
}

// Why a part is incomplete, or null; cost marks a projection stop (FIX-METHOD, cost limits).
export function partStop(work: string, p: PartPlan, trials: R3cTrial[]): { reason: string; cost: boolean } | null {
  const dir = join(work, p.name), stop = (reason: string, cost = false) => ({ reason, cost });
  const projected = join(work, p.name + ".projection-stop");
  if (existsSync(projected)) return stop(p.name + " was not launched: " + readJson(projected).line, true);
  const exitFile = join(work, p.name + ".launch-exit");
  const exitText = existsSync(exitFile) ? readFileSync(exitFile, "utf8").trim() : null;
  if (exitText !== null && !/^\d+$/.test(exitText)) return stop(p.name + ": launch exit unreadable");
  const rc = exitText === null ? null : Number(exitText);
  if (rc === 9) return stop(RUN.item + " refused " + p.name + "'s VM reserve");
  if (existsSync(join(dir, "vm-cap-stop"))) return stop(p.name + ": " + readFileSync(join(dir, "vm-cap-stop"), "utf8").trim());
  const bad = PROXY_FILES.find((f) => existsSync(join(dir, "pulled/out", f)) && unreadable(join(dir, "pulled/out", f)));
  if (bad) return stop(p.name + ": pulled/out/" + bad + " is empty or unparseable");
  const status = [join(dir, "pulled/out/cap-stop.json"), join(dir, "pulled/out/proxy-status-end.json")].map((f) => (existsSync(f) ? readJson(f) : null)).find((s) => s?.cap_stop);
  if (status) return stop(p.name + ": " + status.cap_stop);
  const capped = trials.find((t) => t.cap_stop);
  if (capped) return stop(p.name + ": " + capped.trial + " stopped at the cap (LedgerCapStop)");
  const pullFails = join(dir, "pulled/out/pull-fails.txt");
  if (existsSync(pullFails)) return stop(p.name + ": infra before any model call: an image did not pull: " + readFileSync(pullFails, "utf8").trim().split("\n").join("; "));
  if (rc === null) return stop(p.name + " was never launched");
  if (rc !== 0) return stop(p.name + "'s launch exited " + rc);
  if (!existsSync(join(dir, "pulled/jobs"))) return stop(p.name + " has no pulled results");
  if (p.order) {
    const log = join(dir, "pulled/out/harbor.log");
    if (!existsSync(log) || !readFileSync(log, "utf8").includes("laneb order: applied " + p.order.length + " trials")) return stop(p.name + ": its harbor.log has no 'laneb order: applied " + p.order.length + " trials' line, so the planned order is not shown to have run");
  }
  const got = countsOf(trials.filter((t) => t.model === OPUS).map((t) => [t.task, t.arm]));
  const stray = trials.filter((t) => t.model !== OPUS || !p.counts.has(key(t.task, t.arm)));
  if (stray.length) return stop(p.name + ": " + stray.length + " trials outside the plan (" + stray.slice(0, 3).map((t) => t.trial).join(", ") + ")");
  const off = [...p.counts].filter(([k, n]) => (got.get(k) ?? 0) !== n);
  if (off.length) return stop(p.name + ": " + off.length + " task and arm cells have a trial count other than the plan's (" + off.slice(0, 3).map(([k, n]) => k.replace("\t", " ") + " " + (got.get(k) ?? 0) + " of " + n).join(", ") + ")");
  const infra = trials.filter((t) => t.outcome === "infra").length;
  return infra > RUN.infraBound * trials.length ? stop(p.name + ": " + infra + " of " + trials.length + " trials are infra, over 10%") : null;
}
function loadPart(work: string, p: PartPlan) {
  const dir = join(work, p.name);
  const trials = existsSync(join(dir, "pulled/jobs")) ? loadTrials(p.name, dir) : [];
  return { plan: p, trials, stop: partStop(work, p, trials) };
}

function launchChecks(state: string) {
  const env = launchEnv(ITEM, state);
  if (env.rate !== RUN.vmUsdPerHour && Number(env.rate) !== Number(RUN.vmUsdPerHour)) throw new Error("E_USAGE set VM_USD_PER_HOUR=0.6, the rate R3c's projections and reserve headroom use; " + state);
  if (Number(env.hours) !== Number(RUN.vmReserveHours)) throw new Error("E_USAGE set VM_RESERVE_HOURS=4, the block the $79.20 reserve headroom counts; " + state);
  const ttl = Number(process.env.UBI_TTL_HOURS || "3");
  if (ttl < RUN.minTtlHours) throw new Error("E_USAGE set UBI_TTL_HOURS to " + RUN.minTtlHours + " or more; a part runs for hours, and ubi-runner.sh reaps a VM past its TTL; " + state);
  for (const v of ["ARMS", "SWEREBENCH"]) if (!process.env[v]) throw new Error("E_USAGE set " + v + "; run prepares cal-2 and the grid as it goes; " + state);
  return env;
}
type LaunchOpts = { ledger: string; lport: string; hours: string };
const busyLine = (lport: string) => "something already answers on 127.0.0.1:" + lport + " (another run's ledger service?)";
const capOf = (ledger: string) => fromMicros(totals(readRows(ledger)).capMicros);

// Launches one part and reads it back; false (with a printed line) when the run stops here.
function launchPart(work: string, p: PartPlan, o: LaunchOpts): boolean {
  const dir = join(work, p.name), pp = part(p.name);
  if (!existsSync(join(dir, "oracle.json"))) { console.log(p.name + ": no oracle.json, so its run-time oracle gate can't run; the run stops here"); return false; }
  if (portTaken("127.0.0.1", o.lport)) { console.log(p.name + ": " + busyLine(o.lport) + "; the run stops here"); return false; }
  const rc = sh(["bash", join(LANEB, "runner/launch.sh"), dir, pp.prefix, String(capOf(o.ledger))], { ...process.env, LEDGER: o.ledger, LEDGER_PORT: o.lport, ITEM: RUN.item, VM_RESERVE_HOURS: o.hours });
  writeFileSync(join(work, p.name + ".launch-exit"), rc + "\n");
  if (rc !== 0 || existsSync(join(dir, "pulled/out/cap-stop.json")) || existsSync(join(dir, "vm-cap-stop"))) { console.log(p.name + ": launch exited " + rc + "; the run stops here"); return false; }
  const loaded = loadPart(work, p);
  if (loaded.stop) { console.log(p.name + " is incomplete (" + loaded.stop.reason + "); the run stops here"); return false; }
  return true;
}

// The projection before a part, from the parts that ran before it.
export function projectionBefore(work: string, tr: ReturnType<typeof tiers>, name: string, rows: Row[], capUsd: number) {
  if (RUN.cal1Parts.includes(name) || name === "cal-2") {
    const i = [...RUN.cal1Parts, "cal-2"].indexOf(name), split = cal1Split(tr);
    const doneNames = RUN.cal1Parts.slice(0, Math.min(i, 3));
    const done = doneNames.flatMap((n) => loadPart(work, planOf(work, tr, n)!).trials);
    const cal2Known = existsSync(join(work, "cal2.json"));
    const remaining = split.parts.slice(Math.min(i, 3)).reduce((s, p) => s + p.slots.length, 0) + (cal2Known ? R3C.t4Second * readJson(join(work, "cal2.json")).tasks.length : R3C.t4Second * tr.t4.length);
    return calProjection({ rows, capUsd, next: name, remainingTrials: remaining, cal2Known, done, doneVmUsd: doneNames.reduce((s, n) => s + vmSettled(rows, part(n).prefix), 0) });
  }
  const g = readJson(join(work, "grid.json")), names = gridNames(work), i = names.indexOf(name);
  const doneNames = names.slice(0, i), done = doneNames.flatMap((n) => loadPart(work, planOf(work, tr, n)!).trials);
  return gridProjection({ rows, capUsd, next: name, n: g.list.length, remainingReps: gridSizes(g.R).slice(i).reduce((a, b) => a + b, 0), admitNoneUsd: g.none_usd, done, doneVmUsd: doneNames.reduce((s, n) => s + vmSettled(rows, part(n).prefix), 0) });
}
function projectionGate(work: string, tr: ReturnType<typeof tiers>, name: string, ledger: string): boolean {
  const rows = readRows(ledger), p = projectionBefore(work, tr, name, rows, capOf(ledger));
  console.log(p.line);
  writeJson(join(work, "projection-" + name + ".json"), { ...p.record, line: p.line });
  if (!p.over) return true;
  writeFileSync(join(work, name + ".projection-stop"), JSON.stringify({ line: p.line, approvals: rows.filter((r) => r.kind === "approval").length }) + "\n");
  return false;
}

export const calibrationRows = (trials: R3cTrial[]): TrialRow[] => trials.map((t) => ({ part: t.part, task: t.task, arm: t.arm, outcome: t.outcome, cost_usd: t.cost_usd }));
function calTrials(work: string, tr: ReturnType<typeof tiers>) {
  const parts = calNames(work).map((n) => loadPart(work, planOf(work, tr, n)!));
  return { parts, trials: parts.flatMap((p) => p.trials) };
}
// After calibration: admission at the frozen 2,000 sims, at the ledger's current cap and settled total.
function admitStep(work: string, h: ReturnType<typeof loadInHand>, tr: ReturnType<typeof tiers>, ledger: string): number {
  const { trials } = calTrials(work, tr), rows = calibrationRows(trials), t = totals(readRows(ledger));
  writeFileSync(join(work, "calibration.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  const cap = fromMicros(t.capMicros), settled = fromMicros(t.settledMicros);
  const a = admission(h, "opus", rows, admitOptions(cap, settled)), lines = admissionLines(a);
  lines.unshift("admit: bun quick/laneb/r3/r3c-rules.ts admit <INHAND> --model opus --calibration " + join(work, "calibration.jsonl") + " --cap-usd " + cap + " --settled-usd " + settled.toFixed(6));
  for (const l of lines) console.log(l);
  writeFileSync(join(work, "admit.txt"), lines.join("\n") + "\n");
  writeJson(join(work, "admission.json"), { ...a, cap_usd: cap, settled_usd: settled, calibration_sha256: sha(readFileSync(join(work, "calibration.jsonl"))) });
  if (!a.go) { writeFileSync(join(work, "admit.stop"), lines.at(-1) + "\n"); return 5; }
  const x = a as any;
  writeJson(join(work, "grid.json"), { n: a.n, R: x.R, list: a.list, list_sha256: a.listSha256, none_usd: a.noneUsd, mdd: x.mdd, sizes: gridSizes(x.R) });
  for (const name of gridNames(work)) preparePart(work, planOf(work, tr, name)!);
  writeFileSync(join(work, "grid.ready"), lines.at(-1) + "\n");
  console.log("admission GO: grid-1 to grid-" + gridNames(work).length + " prepared (" + gridSizes(x.R).join(", ") + " replicates); send the admit lines to the Captain, then run r3c.ts grid");
  return 0;
}
// Calibration from a part on: each part, the projection before the next, cal-2 prepared once cal-1c settles, then admit.
function runCal(work: string, h: ReturnType<typeof loadInHand>, tr: ReturnType<typeof tiers>, from: string, o: LaunchOpts): number {
  const names = [...RUN.cal1Parts, "cal-2"];
  for (let i = names.indexOf(from); i < names.length; i++) {
    const name = names[i]!;
    if (name === "cal-2" && !calNames(work).includes("cal-2")) break;
    if (!launchPart(work, planOf(work, tr, name)!, o)) return 4;
    if (name === "cal-1c" && !existsSync(join(work, "cal2.json"))) {
      const c1 = RUN.cal1Parts.flatMap((n) => loadPart(work, planOf(work, tr, n)!).trials);
      const tasks = cal2Tasks(tr, calibrationRows(c1));
      writeJson(join(work, "cal2.json"), { tasks, sha256: idsSha(tasks), trials: tasks.length * R3C.t4Second });
      console.log("cal-2: " + tasks.length + " t4 tasks failed their cal-1 trial, " + tasks.length * R3C.t4Second + " none trials");
      if (tasks.length) preparePart(work, planOf(work, tr, "cal-2")!);
    }
    const next = names[i + 1];
    if (next && calNames(work).includes(next) && !projectionGate(work, tr, next, o.ledger)) return 4;
  }
  return admitStep(work, h, tr, o.ledger);
}
function runGrid(work: string, tr: ReturnType<typeof tiers>, from: number, o: LaunchOpts): number {
  const names = gridNames(work);
  for (let i = from; i < names.length; i++) {
    if (!launchPart(work, planOf(work, tr, names[i]!)!, o)) return 4;
    if (i + 1 < names.length && !projectionGate(work, tr, names[i + 1]!, o.ledger)) return 4;
  }
  return 0;
}

function boundWork(ledger: string, work: string) {
  const bound = ledger + ".bound";
  if (!existsSync(bound)) throw new Error(RUN.item + " is not bound to a run; run binds it first");
  const w = String(readJson(bound).work);
  if (resolve(w) !== work) throw new Error(RUN.item + " is bound to the run in " + w + ", not " + work + "; nothing was launched");
}
function ports(state: string) {
  const lport = process.env.LEDGER_PORT ?? RUN.ledgerPort;
  if (portTaken("127.0.0.1", lport)) throw new Error("E_USAGE " + busyLine(lport) + "; set LEDGER_PORT to a free port; " + state);
  return lport;
}

function run(work: string): number {
  const ledger = process.env.LEDGER ?? "", bound = ledger + ".bound";
  const boundTo = () => RUN.item + " is already bound to a run (" + readFileSync(bound, "utf8").trim() + "); an item serves one run";
  if (existsSync(bound)) throw new Error(boundTo());
  const { hours } = launchChecks(RUN.item + " is still unbound");
  const { h, tr } = inHand();
  planCheck(work, tr);
  for (const name of RUN.cal1Parts) if (!existsSync(join(work, name))) throw new Error(name + " is not prepared; run prepare first; " + RUN.item + " is still unbound");
  const bad = armCheck();
  if (bad.length) throw new Error("arm-check fails: " + bad.join("; ") + "; " + RUN.item + " is still unbound");
  const lport = ports(RUN.item + " is still unbound");
  const rows = itemCheck(ledger, ITEM);
  const start = startRule(tr, capOf(ledger), fromMicros(totals(rows).settledMicros));
  console.log(start.line);
  if (!start.ok) return 7;
  try {
    writeFileSync(bound, JSON.stringify({ item: RUN.item, work, at: new Date().toISOString() }) + "\n", { flag: "wx" });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    throw new Error(boundTo());
  }
  itemCheck(ledger, ITEM);
  writeJson(join(work, "start.json"), { projection_usd: start.usd, trials: start.trials, line: start.line });
  return runCal(work, h, tr, RUN.cal1Parts[0]!, { ledger, lport, hours });
}

function grid(work: string): number {
  const ledger = process.env.LEDGER ?? "";
  boundWork(ledger, work);
  const { hours } = launchChecks("the grid stays unlaunched");
  const { tr } = inHand();
  if (!existsSync(join(work, "grid.ready"))) throw new Error(work + " has no grid.ready: admission has not said GO, so no grid runs");
  planCheck(work, tr);
  const names = gridNames(work);
  if (names.some((n) => existsSync(join(work, n + ".launch-exit")) || existsSync(join(work, n + ".projection-stop")))) throw new Error("the grid has already started; after a projection stop, resume relaunches it");
  const lport = ports("the grid stays unlaunched");
  if (!projectionGate(work, tr, names[0]!, ledger)) return 4;
  return runGrid(work, tr, 0, { ledger, lport, hours });
}

// After a projection stop: one resume per stop, on the same item and work dir, once a raise recorded after the stop is on
// the ledger and the projection fits it.
function resume(work: string): number {
  const ledger = process.env.LEDGER ?? "";
  boundWork(ledger, work);
  const { h, tr } = inHand();
  const all = [...RUN.cal1Parts, "cal-2", ...gridNames(work)];
  const name = all.find((n) => existsSync(join(work, n + ".projection-stop")));
  if (!name) throw new Error(work + " has no projection stop; resume follows only a projection stop, and only once for each");
  const stopFile = join(work, name + ".projection-stop");
  const { hours } = launchChecks(name + " stays stopped");
  const stop = readJson(stopFile), rows = readRows(ledger), approvals = rows.filter((r) => r.kind === "approval");
  if (approvals[0]?.item !== RUN.item || approvals[0]?.usd_micros !== RUN.capUsd * 1_000_000) throw new Error(ledger + ": the first approval row is not " + RUN.item + "'s at amendment 6's $" + RUN.capUsd);
  if (approvals.length <= Number(stop.approvals) || approvals.at(-1)?.item !== RUN.item) throw new Error("no cap raise is recorded on " + ledger + " for " + RUN.item + " since the projection stop before " + name + "; it stays stopped");
  const capUsd = capOf(ledger);
  planCheck(work, tr);
  const p = projectionBefore(work, tr, name, rows, capUsd);
  console.log(p.line);
  if (p.over) throw new Error("the projection of $" + p.record.projection_usd.toFixed(2) + " still passes " + RUN.item + "'s raised $" + capUsd + " cap; " + name + " stays stopped");
  const lport = ports(name + " stays stopped");
  writeJson(join(work, "cap-raise-" + name + ".json"), { raise: approvals.at(-1), projection: { ...p.record, line: p.line } });
  renameSync(stopFile, stopFile + ".raised");
  try {
    return name.startsWith("grid-") ? runGrid(work, tr, gridNames(work).indexOf(name), { ledger, lport, hours }) : runCal(work, h, tr, name, { ledger, lport, hours });
  } finally {
    if (!existsSync(join(work, name + ".launch-exit"))) renameSync(stopFile + ".raised", stopFile);
  }
}

function admitAgain(work: string): number {
  const ledger = process.env.LEDGER ?? "";
  const { h, tr } = inHand();
  planCheck(work, tr);
  const { parts, trials } = calTrials(work, tr);
  const stopped = parts.find((p) => p.stop);
  if (stopped) throw new Error("calibration is incomplete (" + stopped.stop!.reason + "), so admission can't run");
  if (!existsSync(join(work, "cal2.json"))) throw new Error("cal-2 was never planned, so calibration has not finished");
  const t = totals(readRows(ledger)), a = admission(h, "opus", calibrationRows(trials), admitOptions(fromMicros(t.capMicros), fromMicros(t.settledMicros)));
  for (const l of admissionLines(a)) console.log(l);
  return a.go ? 0 : 5;
}

// Told minus none on a per-trial value (report only): per-task means over the trials with a value, paired tasks, and
// analyze()'s task-clustered bootstrap (10,000 draws, seed 20261101).
export function pairedLift(trials: R3cTrial[], value: (t: R3cTrial) => number | null) {
  const cell = (arm: string) => { const m = new Map<string, number[]>(); for (const t of trials.filter((x) => x.arm === arm)) { const v = value(t); if (v !== null) m.set(t.task, [...(m.get(t.task) ?? []), v]); } return new Map([...m].map(([k, xs]) => [k, xs.reduce((a, b) => a + b, 0) / xs.length])); };
  const cn = cell(NONE), ct = cell(TOLD), tasks = [...cn.keys()].filter((k) => ct.has(k)).sort();
  if (!tasks.length) return null;
  const stat = (smp: string[]) => smp.reduce((z, k) => z + ct.get(k)! - cn.get(k)!, 0) / smp.length;
  const b = bootstrap(tasks, stat, { seed: RUN.seed, b: RUN.draws });
  return { diff: stat(tasks), lo: b.lo, hi: b.hi, tasks: tasks.length };
}
const pts = (x: number) => (x >= 0 ? "+" : "") + (100 * x).toFixed(1);
const pct = (x: number) => (100 * x).toFixed(1) + "%";
const ci = (c: { diff: number; lo: number; hi: number }) => pts(c.diff) + " points (95% CI " + pts(c.lo) + " to " + pts(c.hi) + ")";
const share = (xs: boolean[]) => (xs.length ? xs.filter(Boolean).length / xs.length : 0);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

export type Verdict = "KEEP" | "CUT-CANDIDATE" | "FIX-METHOD (exposure)" | "FIX-METHOD (truncation)" | "FIX-METHOD (task fit)" | "FIX-METHOD (power)";
export const d1Min = (n: number) => Math.ceil((3 * n) / 7);
// The outcome on a complete grid and the report-only lines beside it. adm is admission.json; gold maps a task to its root-
// cause files (goldFiles of its oracle patch); dist is r3c-taskfit.tsv's distance.
export function gridOutcome(grid: R3cTrial[], adm: any, o: { sims: number; gold: Map<string, string[]>; dist: Map<string, number> }) {
  const graded = grid.filter((t) => t.outcome !== "infra"), told = graded.filter((t) => t.arm === TOLD), none = graded.filter((t) => t.arm === NONE);
  const exposed = told.filter((t) => t.exposed).length, exposure = told.length ? exposed / told.length : 0;
  const stops = (ts: R3Trial[]) => ts.filter((t) => t.budget_stop).length, stopShare = (ts: R3Trial[]) => (ts.length ? stops(ts) / ts.length : 0);
  const toldRun = grid.filter((t) => t.arm === TOLD), noneRun = grid.filter((t) => t.arm === NONE), truncation = 100 * (stopShare(toldRun) - stopShare(noneRun));
  const opts = { models: [OPUS], arms: [NONE, TOLD], reference: OPUS, seed: RUN.seed, b: RUN.draws };
  const contrast = (ts: R3cTrial[]) => analyzeTrials(ts.map(toTrial), opts).contrasts.find((c) => c.contrast === TOLD + " - " + NONE)!;
  const rep = analyzeTrials(grid.map(toTrial), opts), primary = contrast(grid);
  const rate = (arm: string) => rep.passRates.find((r) => r.arm === arm)!;
  const pairedTasks = [...new Set(none.map((t) => t.task))].filter((k) => told.some((t) => t.task === k)).sort();
  const solved = new Set(graded.filter((t) => t.outcome === "pass").map((t) => t.task)), sensSet = pairedTasks.filter((k) => solved.has(k));
  const sens = sensSet.length ? contrast(grid.filter((t) => sensSet.includes(t.task))) : null, minSet = d1Min(adm.n);
  let verdict: Verdict;
  if (exposure < RUN.exposureGate) verdict = "FIX-METHOD (exposure)";
  else if (truncation > RUN.truncationPoints) verdict = "FIX-METHOD (truncation)";
  else if (primary.lo > 0) verdict = "KEEP";
  else if (primary.diff <= 0) verdict = sensSet.length < minSet ? "FIX-METHOD (task fit)" : sens!.diff <= 0 ? "CUT-CANDIDATE" : "FIX-METHOD (task fit)";
  else verdict = "FIX-METHOD (power)";
  const lines: string[] = [];
  lines.push("grid: none " + rate(NONE).passes + " of " + rate(NONE).trials + " graded trials passed (control rate " + pct(rate(NONE).rate) + "), told " + rate(TOLD).passes + " of " + rate(TOLD).trials + " (" + pct(rate(TOLD).rate) + "); " + pairedTasks.length + " paired tasks of " + adm.n + " admitted");
  lines.push("exposure: " + exposed + " of " + told.length + " graded told grid trials exposed (" + pct(exposure) + "; the gate needs 90%)");
  lines.push("allowance stops: told " + stops(toldRun) + " of " + toldRun.length + " sessions (" + pct(stopShare(toldRun)) + "), none " + stops(noneRun) + " of " + noneRun.length + " (" + pct(stopShare(noneRun)) + "), infra included; the truncation bound is 5 points");
  lines.push("primary: told minus none " + ci(primary) + " on " + primary.tasks + " paired tasks");
  lines.push("D1 sensitivity: " + sensSet.length + " paired tasks solved by at least one graded grid trial in either arm, against ceil(3n/7) = " + minSet + " at n = " + adm.n + (sens ? "; told minus none " + ci(sens) + " on them" : "; the set is empty"));
  // Report-only from here (section 7).
  lines.push("frozen MDD (report only): " + adm.mdd + " points at " + adm.n + " tasks x " + adm.R + " replicates (" + adm.mddSplit + " if the lift sits on half the tasks); beta-binomial law: MDD " + adm.beta?.mdd + " points, null size " + pct(adm.beta?.nullSize ?? NaN));
  const noneByTask = new Map<string, boolean[]>();
  for (const t of none) noneByTask.set(t.task, [...(noneByTask.get(t.task) ?? []), t.outcome === "pass"]);
  const rates = [...noneByTask].map(([k, xs]) => [k, share(xs)] as const), lo = R3C.band[0], hi = R3C.band[1];
  const posts = rates.map(([, r]) => GRID.map((_, j) => (j === Math.round(r * R3C.npmle.grid) ? 1 : 0)));
  const resim = posts.length ? mddPoints(posts, adm.R, o.sims) : null;
  lines.push("MDD re-simulated at the grid's own none rates (report only): " + (resim === null ? "none found up to 100 points" : resim + " points") + " at " + adm.R + " replicates on " + posts.length + " tasks, " + o.sims + " simulated grids a lift");
  const outside = rates.filter(([, r]) => r < lo - 1e-9 || r > hi + 1e-9).length;
  lines.push("task fit (report only): the grid's none arm puts " + outside + " of " + rates.length + " admitted tasks outside the band [" + lo + ", " + hi + "] (" + pct(rates.length ? outside / rates.length : 0) + ")");
  const farTasks = new Set(pairedTasks.filter((k) => o.dist.get(k) === 2)), far = farTasks.size ? contrast(grid.filter((t) => farTasks.has(t.task))) : null;
  lines.push("far tasks (report only): " + (far ? "told minus none " + ci(far) + " on " + far.tasks + " paired far tasks" : "no far task in the grid"));
  const hooks = { ran: told.filter((t) => t.hooks.stop_hook_ran).length, held: told.filter((t) => t.hooks.held_back).length, route: told.filter((t) => t.hooks.route_hook_ran).length };
  lines.push("Stop hook (report only): ran in " + hooks.ran + " of " + told.length + " graded told grid trials and held a stop back in " + hooks.held + "; the route hook logged in " + hooks.route);
  const cps = (arm: string) => rate(arm).costPerSuccess;
  lines.push("cost per success (report only): none " + (cps(NONE) === null ? "n/a" : "$" + cps(NONE)!.toFixed(2)) + ", told " + (cps(TOLD) === null ? "n/a" : "$" + cps(TOLD)!.toFixed(2)));
  const errors = graded.filter((t) => t.closing_error);
  const goldOf = (t: R3cTrial) => o.gold.get(t.task) ?? [];
  const scorable = graded.filter((t) => goldOf(t).length), noGold = [...new Set(graded.filter((t) => !goldOf(t).length).map((t) => t.task))];
  let localization: Record<string, unknown>;
  if (errors.length) {
    lines.push("E_TRANSCRIPT_UNREADABLE localization (report only): " + errors.length + " graded grid trials have no readable main-thread text (" + errors.slice(0, 3).map((t) => t.trial).join(", ") + "), so no localization rates are printed; each is a recorded error, never a miss");
    localization = { error: "E_TRANSCRIPT_UNREADABLE", trials: errors.map((t) => ({ trial: t.trial, error: t.closing_error })) };
  } else {
    const hit = (k: number) => (t: R3cTrial) => (goldOf(t).length ? (locHit(t.closing!, goldOf(t), k) ? 1 : 0) : null);
    const rank = (t: R3cTrial) => (goldOf(t).length ? locRank(t.closing!, goldOf(t)) : null);
    const arm = (a: string) => { const ts = graded.filter((t) => t.arm === a), sc = scorable.filter((t) => t.arm === a); return { trials: ts.length, block: share(ts.map((t) => t.closing!.length > 0)), hit1: mean(sc.map((t) => hit(1)(t)!)), hit3: mean(sc.map((t) => hit(3)(t)!)), rank: mean(sc.map((t) => rank(t)!)), scored: sc.length }; };
    const an = arm(NONE), at = arm(TOLD), l1 = pairedLift(scorable, hit(1)), l3 = pairedLift(scorable, hit(3)), lr = pairedLift(scorable, rank);
    const split = (held: boolean) => { const ts = scorable.filter((t) => t.arm === TOLD && t.hooks.held_back === held); return { trials: ts.length, hit1: mean(ts.map((t) => hit(1)(t)!)), hit3: mean(ts.map((t) => hit(3)(t)!)) }; };
    const held = split(true), free = split(false);
    lines.push("localization (report only): a closing block in none " + pct(an.block) + " and told " + pct(at.block) + " of graded trials; hit@1 none " + pct(an.hit1) + ", told " + pct(at.hit1) + "; hit@3 none " + pct(an.hit3) + ", told " + pct(at.hit3) + " (" + an.scored + " and " + at.scored + " trials scored; " + noGold.length + " tasks out of the measure with no root-cause file)");
    lines.push("localization lifts (report only): hit@1 " + (l1 ? ci(l1) : "n/a") + ", hit@3 " + (l3 ? ci(l3) : "n/a") + ", locRank " + (lr ? ci(lr) : "n/a") + " (locRank none " + an.rank.toFixed(3) + ", told " + at.rank.toFixed(3) + ")");
    lines.push("told localization by Stop hook (report only): held a stop back " + held.trials + " trials, hit@1 " + pct(held.hit1) + ", hit@3 " + pct(held.hit3) + "; did not " + free.trials + " trials, hit@1 " + pct(free.hit1) + ", hit@3 " + pct(free.hit3));
    localization = { none: an, told: at, hit1: l1, hit3: l3, loc_rank: lr, told_held_back: held, told_not_held_back: free, out_of_measure: noGold };
  }
  const f2pArm = (a: string) => { const ts = graded.filter((t) => t.arm === a); const v = ts.filter((t) => t.f2p_share !== null); return { trials: ts.length, mean: mean(v.map((t) => t.f2p_share!)), nulls: ts.length - v.length }; };
  const fn = f2pArm(NONE), ft = f2pArm(TOLD), fl = pairedLift(graded, (t) => t.f2p_share);
  lines.push("f2pShare (report only): none " + fn.mean.toFixed(3) + ", told " + ft.mean.toFixed(3) + " (null, out of the measure: none " + fn.nulls + ", told " + ft.nulls + "); told minus none " + (fl ? ci(fl) : "n/a"));
  const head = "R3c outcome for Opus 5.5: " + verdict + ". ", armName = "told /investigate at " + PIN.slice(0, 8) + " with the procedure line";
  lines.push({
    "KEEP": head + "The " + armName + " beats none by " + ci(primary) + " on " + primary.tasks + " paired tasks.",
    "CUT-CANDIDATE": head + "The " + armName + " minus none is at or below zero: " + ci(primary) + " on " + primary.tasks + " paired tasks, and " + (sens ? ci(sens) : "") + " on the " + sensSet.length + "-task D1 sensitivity set; control rate " + pct(rate(NONE).rate) + ", MDD " + adm.mdd + " points, procedure visible in " + pct(exposure) + ", allowance stops told " + stops(toldRun) + " and none " + stops(noneRun) + ". That means no lift of MDD size, not proof of zero.",
    "FIX-METHOD (task fit)": head + "The primary is at or below zero (" + ci(primary) + "), and " + (sensSet.length < minSet ? "only " + sensSet.length + " tasks were solved by any graded grid trial, fewer than ceil(3n/7) = " + minSet : "the D1 sensitivity contrast is above zero") + ".",
    "FIX-METHOD (power)": head + "Told minus none is " + ci(primary) + ": above zero, with an interval that includes zero.",
    "FIX-METHOD (exposure)": head + "The procedure was visible in " + exposed + " of " + told.length + " graded told grid trials (" + pct(exposure) + "), under 90%.",
    "FIX-METHOD (truncation)": head + pct(stopShare(toldRun)) + " of told sessions ended at the $" + RUN.allowanceUsd + " allowance against " + pct(stopShare(noneRun)) + " of none sessions, more than 5 points apart.",
  }[verdict]);
  return {
    verdict, exit: verdict === "KEEP" ? 0 : verdict === "CUT-CANDIDATE" ? 3 : 5, lines,
    record: { outcome: verdict, primary, sensitivity: { tasks: sensSet.length, min_tasks: minSet, set: sensSet, contrast: sens }, exposure: { exposed, graded_told: told.length, rate: exposure },
      allowance_stops: { told: stops(toldRun), none: stops(noneRun), sessions: { told: toldRun.length, none: noneRun.length }, points_apart: truncation }, pass_rates: rep.passRates, paired_tasks: pairedTasks.length,
      mdd_resimulated: resim, outside_band: { tasks: outside, of: rates.length }, far, stop_hook: hooks, localization, f2p_share: { none: fn, told: ft, lift: fl } },
  };
}

function analyze(work: string): number {
  const ledger = process.env.LEDGER ?? "";
  const { h, tr } = inHand();
  planCheck(work, tr);
  const rows = readRows(ledger), t = totals(rows);
  const lines = [RUN.item + ": settled $" + fromMicros(t.settledMicros).toFixed(2) + " of $" + fromMicros(t.capMicros) + ", open reserves " + t.openIds.length];
  const record: Record<string, unknown> = { item: RUN.item, model: OPUS, pin: PIN, ledger: { cap_usd: fromMicros(t.capMicros), settled_usd: fromMicros(t.settledMicros), open_reserves: t.openIds } };
  const cal = calNames(work).map((n) => loadPart(work, planOf(work, tr, n)!));
  const grid = gridNames(work).map((n) => loadPart(work, planOf(work, tr, n)!));
  const all = [...cal, ...grid].flatMap((p) => p.trials);
  writeFileSync(join(work, "trials.jsonl"), all.map((x) => JSON.stringify(x)).join("\n") + (all.length ? "\n" : ""));
  const oracle = [...calNames(work), ...gridNames(work)].filter((n) => existsSync(join(work, n))).flatMap((n) => loadOracle(join(work, n)));
  const of = oracleF2p(oracle.map((x) => x.f2p_share));
  lines.push("oracle per-test (report only): " + of.trials + " oracle trials, " + of.one + " score f2pShare 1 and " + of.nulls + " score null");
  record.oracle_f2p = of;
  const finish = (outcome: string, exit: number) => {
    for (const l of lines) console.log(l);
    writeJson(join(work, "record.json"), { ...record, outcome, lines });
    return exit;
  };
  const incomplete = (reason: string, cost: boolean) => { lines.push("R3c outcome for Opus 5.5: none (incomplete: " + reason + "). FIX-METHOD (" + (cost ? "cost limits" : "harness limits") + "). " + ITEM.incomplete); return finish("incomplete", 4); };
  const calStop = cal.find((p) => p.stop);
  if (calStop) return incomplete(calStop.stop!.reason, calStop.stop!.cost);
  if (!existsSync(join(work, "cal2.json"))) return incomplete("cal-2 was never planned, so calibration did not finish", false);
  const calTr = cal.flatMap((p) => p.trials);
  lines.push("calibration: " + calTr.length + " none trials, " + calTr.filter((x) => x.outcome !== "infra").length + " graded, " + calTr.filter((x) => x.outcome === "pass").length + " passed");
  if (!existsSync(join(work, "admission.json"))) return incomplete("admission never ran", false);
  const adm = readJson(join(work, "admission.json"));
  record.admission = adm;
  lines.push(...readFileSync(join(work, "admit.txt"), "utf8").trim().split("\n"));
  if (!adm.go) { lines.push("R3c outcome for Opus 5.5: none (admission STOP: " + adm.reason + "). No grid ran; the admitted count, the measured rates and the MDD the money could buy are above."); return finish("admission-stop", 6); }
  const gridStop = grid.find((p) => p.stop);
  if (!grid.length) return incomplete("the grid was never prepared", false);
  if (gridStop) return incomplete(gridStop.stop!.reason, gridStop.stop!.cost);
  const gt = grid.flatMap((p) => p.trials);
  for (const arm of [NONE, TOLD]) {
    const cell = gt.filter((x) => x.arm === arm), infra = cell.filter((x) => x.outcome === "infra").length;
    if (infra > RUN.infraBound * cell.length) return incomplete(infra + " of " + cell.length + " " + arm + " grid trials are infra, over 10%", false);
  }
  const gold = new Map<string, string[]>();
  for (const x of oracle) if (x.patch !== null && !gold.has(x.task)) gold.set(x.task, goldFiles(x.patch));
  const sims = Number(process.env.R3C_MDD_SIMS ?? "2000");
  if (!Number.isInteger(sims) || sims < 1) throw new Error("E_USAGE R3C_MDD_SIMS must be a whole number of simulated grids, 1 or more");
  const out = gridOutcome(gt, adm, { sims, gold, dist: h.dist });
  lines.push(...out.lines);
  Object.assign(record, out.record);
  return finish(out.verdict, out.exit);
}

if (import.meta.main) {
  const [cmd, arg, ...rest] = Bun.argv.slice(2);
  try {
    if (cmd === "arm-check") {
      const problems = armCheck(arg ? resolve(arg) : undefined);
      console.log(problems.length ? "arm-check: FAIL " + problems.join("; ") : "arm-check: pass gstack " + PIN + ", told arm tar " + TOLD_TAR_SHA256 + ", R3b's told arm, unchanged");
      process.exit(problems.length ? 1 : 0);
    }
    if (!arg || rest.length !== 2 || rest[0] !== "--item" || rest[1] !== RUN.item || !["prepare", "run", "grid", "resume", "admit", "analyze"].includes(cmd ?? "")) {
      console.error("E_USAGE usage: bun quick/laneb/r3/r3c.ts arm-check [<manifest dir>] | prepare|run|grid|resume|admit|analyze <work dir> --item " + RUN.item);
      process.exit(2);
    }
    if (!process.env.LEDGER) { console.error("E_USAGE set LEDGER to " + RUN.item + "'s jsonl ledger"); process.exit(2); }
    const work = resolve(arg);
    if (cmd === "prepare") { prepare(work); process.exit(0); }
    process.exit({ run, grid, resume, admit: admitAgain, analyze }[cmd as "run"](work));
  } catch (e) {
    const msg = String((e as Error).message ?? e);
    const code = /^E_(USAGE|PIN_MISMATCH)/.test(msg) ? 2 : 1;
    console.error(/^E_[A-Z_]+ /.test(msg) ? msg : "E_INTERNAL " + msg);
    process.exit(code);
  }
}
