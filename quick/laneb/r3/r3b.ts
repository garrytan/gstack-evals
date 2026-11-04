// R3b (R3 amendment 5, wiki/plans/2026-11-04-geva-263-r3-amendment-5, with the task-fit fix D1 in
// wiki/plans/2026-11-04-geva-264-r3-d1-task-fit-fix): told /investigate at gstack 699a41cb with the procedure line against
// none, for one model on its own item. r3b4-opus ($376 with VMs, ledger port 9915) and r3b4-sol ($393, port 9916, after its
// own route check, route-check.ts --item r3b4-sol) are fixed below; itemCheck refuses any other first approval. An item
// holds four parts, run in order, each on its own VM, six trials at a time, with the run-time oracle gate on:
//   recheck              10 told trials on R3a4's pilot tasks (tasks/r3b-recheck.txt), the told exposure re-check (section 4)
//   grid-1 .. grid-3     one replicate each: the model's 70 R3b tasks (tasks/r3b-opus.txt or r3b-sol.txt) in none and told,
//                        140 trials in a seeded shuffle of task and arm (seed 20261106, the same order in each part), which
//                        prepare writes to the part's order.json and runner/agent/sitecustomize.py applies to Harbor's job
// Commands:
//   bun quick/laneb/r3/r3b.ts arm-check [<manifest dir>]        the told arm's manifest (default arms/manifests/r3b): gstack
//                                                               699a41cb, its tar sha256, Claude Code 2.1.312, the route hook
//                                                               (UserPromptSubmit) and the contract Stop hook in settings.json,
//                                                               and none.json byte-identical to arms/manifests/r3/none.json
//   bun quick/laneb/r3/r3b.ts hooks <trial dir>                 one trial's gstack hook state (evaluator/gstack-hooks), as JSON
//   bun quick/laneb/r3/r3b.ts prepare <work dir> --item <item>  env LEDGER, ARMS (none.tar.gz and gstack.tar.gz), SWEREBENCH
//   bun quick/laneb/r3/r3b.ts run <work dir> --item <item>      env LEDGER, R3A4_RECORD (the model's R3a4 record.json),
//                                                               UBI_RUNNER, UBI_OWNER, UBI_TTL_HOURS (12 or more), UBICLOUD_API_KEY,
//                                                               VM_USD_PER_HOUR, the provider keys, LEDGER_PORT (default the item's)
//   bun quick/laneb/r3/r3b.ts resume <work dir> --item <item>   the same env, after a projection stop and a recorded raise
//   bun quick/laneb/r3/r3b.ts analyze <work dir> --item <item>  env LEDGER; R3B_MDD_SIMS (simulated runs per lift, default 2000)
// Where the controller runs: run and resume launch the parts one after another and wait on each. A grid part runs about
// 7 hours, so start run (and any resume) detached, with setsid, on a host that stays awake for the whole run and keeps the
// item's ledger file, such as a dedicated runner VM the run thread names and pins. Never run it on a Capy machine that can
// sleep, the waiting agent's own included: a sleep kills the controller and the ledger service with it. The run thread
// attaches on a timer with a registered wait.
// The rules, from sections 4 and 5:
// - run binds the item only when prepare's plan matches the frozen task lists, every part has its oracle.json (the
//   run-time oracle gate can't be skipped by a missing ORACLE=1) and each grid part its order.json, Sol's route check on
//   r3b4-sol passed with the parts' proxy config, and the start rule holds: n x 3 x (measured none + measured told) from the
//   model's R3a4 record fits the recorded cap.
// - The re-check passes when at least 7 of its graded told trials are exposed (exposure.ts's exposed). Two or more infra
//   trials make it incomplete. Either stop ends the item before the grid, and its trials count in no grid rule.
// - After the re-check and after each grid part, a projection from cost data only (settled spend, each remaining trial at
//   the item's measured cost for its arm, each remaining part's VM, and $79.20 of reserve headroom) over the current cap
//   stops the run before the next part. resume relaunches from that part once per stop, on the same item and work dir,
//   after a raise is appended to the ledger (ledger.ts raise --approved-by <approvals file>), and only when the projection
//   fits the raised cap. A grid part's VM hours can't be split by arm, so from grid-1 on each remaining part's VM is the
//   mean settled VM cost of the grid parts so far.
// - analyze: a grid part that didn't complete, more than 10% infra in a part or in the none or told cell over the grid, or
//   a cap refusal makes the model's R3b incomplete (FIX-METHOD, harness limits; cost limits for a projection stop). Then,
//   in order: under 90% of graded told grid trials exposed is FIX-METHOD (exposure); told allowance stops more than 5
//   points above none's is FIX-METHOD (truncation); a 95% interval above zero is KEEP; a primary at or below zero is
//   FIX-METHOD (task fit) when the D1 sensitivity set holds fewer than 30 tasks, and CUT-CANDIDATE when the sensitivity
//   contrast is also at or below zero; anything else is FIX-METHOD (power). Everything else it prints is report-only.
// Exit codes: analyze 0 KEEP, 3 CUT-CANDIDATE, 5 FIX-METHOD on a complete grid, 6 the re-check stopped R3b, 4 incomplete;
// run 0 when it ended (analyze reads the parts), 5 when the start rule refused the bind; arm-check 1 on a failed check;
// 2 usage, 1 any other error.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { analyze as analyzeTrials, bootstrap, readSessionRows, rng, sessionsByTrial, type Trial } from "../analysis/analyze.ts";
import { fromMicros, readRows, totals, type Row } from "../runner/ledger.ts";
import { loadRebenchPool, R3A4_POOL_FILE, R3A4_POOL_SHA256 } from "../runner/materialize.ts";
import { PROCEDURE_LINES } from "../runner/grid.ts";
import { agentText, loadR3Trial, toTrial, type ProxyConfig, type R3Trial } from "./exposure.ts";
import { A4, bindCheck, coverage, launchEnv, OPUS, portTaken, PROXY_FILES, R3_ARMS, readRoute, routePassed, sh, SOL, unreadable, type R3aModel } from "./screen.ts";

const LANEB = resolve(import.meta.dir, "..");
export const PIN = "699a41cb6808e01240d02e82247693f9170d401a";
export const TOLD_TAR_SHA256 = "e93a3aa4e1e477d0046027b32defbd331c60a847404b67118373250c0c281975";
export const R3B = {
  manifests: "arms/manifests/r3b", cells: A4.cells, concurrent: A4.concurrent, allowanceUsd: 12, n: 70, gridParts: 3, claudeCode: "2.1.312",
  recheckFile: "tasks/r3b-recheck.txt", recheckSha256: "e4c16fb029f58453d370e89c73e76db64b8ed8b9824bde623c697c8c173ccbc0", recheckTasks: 10,
  recheckMinExposed: 7, recheckInfraStop: 2, shuffleSeed: 20261106, seed: 20261101, draws: 10000, exposureGate: 0.9, infraBound: 0.1,
  truncationPoints: 5, d1MinTasks: 30, reserveUsd: 79.2, vmUsdPerHour: 0.6, minTtlHours: 12, frozenMddPoints: 12.5,
  power: { target: 0.8, stepPoints: 0.5, concentration: 1.78, seed: 20261103 },
};
const NONE = "none", TOLD = "gstack";

type Part = { name: string; job: string; arm: string; prefix: string };
// One item per model (amendment 5 section 8). basis holds R3a4's measured costs that size the cap and seed the
// projection before grid-1: the screen's none mean over all 200 tasks and over the model's 70 R3b tasks, the pilot's
// told mean, the told scale (R3b tasks' screen none cost over the pilot tasks'), VM hours per none and told trial, and
// the route check's cost (Sol only).
export type R3bItem = R3aModel & {
  from: string; tasksFile: string; tasksSha256: string; screenNoneRate: number;
  admitted: { file: string; sha256: string };
  basis: { screenNoneUsd: number; r3bNoneUsd: number; pilotToldUsd: number; toldScale: number; noneVmHours: number; toldVmHours: number; routeUsd: number };
};
// The told arm is amendment 4's told arm with the procedure line, run on laneb_hooks.LanebHooksAgent so each trial's gstack
// hook state is copied out after the session; the none arm is the screens' arm, agent included, so admission carries over.
export const R3B_TOLD = R3_ARMS.toldLine + ":gstack_hooks=copy";
const r3bParts = (item: string): Part[] => [
  { name: "recheck", job: item + "-recheck", arm: R3B_TOLD, prefix: item + "-recheck/" },
  ...[1, 2, 3].map((k) => ({ name: "grid-" + k, job: item + "-grid-" + k, arm: R3_ARMS.none + "," + R3B_TOLD, prefix: item + "-grid-" + k + "/" })),
];
const startProjection = (n: number, cNone: number, cTold: number) => {
  const usd = n * 3 * (cNone + cTold);
  return { text: "start projection $" + usd.toFixed(2), usd: { r3b: usd } };
};
export const R3B4: Record<string, R3bItem> = {
  "r3b4-opus": {
    id: OPUS, label: "Opus 5.5", item: "r3b4-opus", capUsd: 376, capFrom: "amendment 5's", routePrefix: null, ledgerPort: "9915", parts: r3bParts("r3b4-opus"),
    tag: " for Opus 5.5", stop: "Opus's R3b stops, and Sol's is unaffected", incomplete: "Opus's R3b is incomplete; the Captain gets the record.",
    a4: { allowanceUsd: R3B.allowanceUsd }, armManifests: R3B.manifests, projection: startProjection,
    from: "r3a4-opus", tasksFile: "tasks/r3b-opus.txt", tasksSha256: "c4dc57fba3c9652e453dd32b57711b9bd55cd51a27803c74ea308ed54c073471", screenNoneRate: 0.645,
    admitted: { file: "tasks/r3a4-admitted-opus.txt", sha256: "df48f3cc0c9e649f8cfc457955bf67429c0f34bbe00970a70e1c0ffb5f8e7881" },
    basis: { screenNoneUsd: 0.370227, r3bNoneUsd: 0.460213, pilotToldUsd: 0.736251, toldScale: 1.16, noneVmHours: 0.0306, toldVmHours: 0.0537, routeUsd: 0 },
  },
  "r3b4-sol": {
    id: SOL, label: "GPT-6.1 Sol", item: "r3b4-sol", capUsd: 393, capFrom: "amendment 5's", routePrefix: "r3b4-sol-route/", ledgerPort: "9916", parts: r3bParts("r3b4-sol"),
    tag: " for GPT-6.1 Sol", stop: "Sol's R3b stops, and Opus's is unaffected", incomplete: "Sol's R3b is incomplete; the Captain gets the record.",
    a4: { allowanceUsd: R3B.allowanceUsd }, armManifests: R3B.manifests, projection: startProjection,
    from: "r3a4-sol", tasksFile: "tasks/r3b-sol.txt", tasksSha256: "c357947874938eb82365c2fe70360600252f2fb4ffa6a5cc76ba58dc74b016ac", screenNoneRate: 0.595,
    admitted: { file: "tasks/r3a4-admitted-sol.txt", sha256: "fc5527d7b15328fd5deecfdfd3af91bed716c71ec55be85cb2c387161a7a17ba" },
    basis: { screenNoneUsd: 0.437612, r3bNoneUsd: 0.518808, pilotToldUsd: 0.897166, toldScale: 0.965, noneVmHours: 0.0267, toldVmHours: 0.0741, routeUsd: 0.17 },
  },
};

// Amendment 5 section 8's sizing: sessions, VM hours at $0.60 and the reserve headroom, rounded up to a whole dollar.
export function capSizing(m: R3bItem) {
  const b = m.basis, n = R3B.n * R3B.gridParts;
  const sessions = b.routeUsd + R3B.recheckTasks * b.pilotToldUsd + n * b.r3bNoneUsd + n * b.pilotToldUsd * b.toldScale;
  const hours = R3B.recheckTasks * b.toldVmHours + n * b.noneVmHours * (b.r3bNoneUsd / b.screenNoneUsd) + n * b.toldVmHours * b.toldScale;
  const vm = hours * R3B.vmUsdPerHour;
  return { sessions, vm, reserve: R3B.reserveUsd, cap: Math.ceil(sessions + vm + R3B.reserveUsd) };
}

export const idsSha = (ids: string[]) => createHash("sha256").update(ids.map((i) => i + "\n").join("")).digest("hex");
export function taskList(file: string, sha256: string): string[] {
  const ids = readFileSync(join(LANEB, file), "utf8").split("\n").filter(Boolean);
  if (idsSha(ids) !== sha256) throw new Error(file + ": sha256 " + idsSha(ids) + " is not the frozen " + sha256);
  return ids;
}
export const recheckTasks = () => taskList(R3B.recheckFile, R3B.recheckSha256);

// Every grid part's trial order: the 140 (task, arm) pairs, tasks sorted with none before told, drawn one at a time
// with seed 20261106, as the screen's draws are made.
export function gridOrder(tasks: string[]): [string, string][] {
  const r = rng(R3B.shuffleSeed), left = [...tasks].sort().flatMap((t) => [[t, NONE], [t, TOLD]] as [string, string][]), out: [string, string][] = [];
  while (left.length) out.push(left.splice(Math.floor(r() * left.length), 1)[0]!);
  return out;
}

// The told arm's manifest (section 2 and section 9 item 1). Returns the problems; none means it passes.
export function armCheck(dir = join(LANEB, R3B.manifests)): string[] {
  const problems: string[] = [];
  let g: any = null;
  try { g = JSON.parse(readFileSync(join(dir, "gstack.json"), "utf8")); } catch { problems.push(dir + "/gstack.json is missing or not JSON"); }
  if (g) {
    if (g.gstack_sha !== PIN) problems.push("gstack.json's gstack_sha is " + g.gstack_sha + ", not the pin " + PIN);
    if (g.tar?.sha256 !== TOLD_TAR_SHA256) problems.push("gstack.json's tar sha256 is " + g.tar?.sha256 + ", not " + TOLD_TAR_SHA256);
    if (g.claude_code !== R3B.claudeCode) problems.push("gstack.json's Claude Code is " + g.claude_code + ", not " + R3B.claudeCode);
    if (!(g.skills?.names ?? []).includes("investigate")) problems.push("gstack.json lists no investigate skill");
    const hooks: any[] = Array.isArray(g.settings?.hooks) ? g.settings.hooks : [];
    for (const [event, name] of [["UserPromptSubmit", "skill-route-hook"], ["Stop", "skill-contract-stop-hook"]]) {
      if (!hooks.some((h) => h.event === event && String(h.command).endsWith("/" + name))) problems.push("gstack.json's settings register no " + event + " hook running " + name + "; ./setup leaves it out when its switch resolves off");
    }
  }
  const none = join(dir, "none.json"), r3 = join(LANEB, "arms/manifests/r3/none.json");
  if (!existsSync(none) || readFileSync(none, "utf8") !== readFileSync(r3, "utf8")) problems.push("none.json is not arms/manifests/r3/none.json byte for byte; the none arm doesn't change");
  return problems;
}

// One trial's gstack hook state, from what the agent copied out of the container after the session: the hook trace logs
// (hooks/skill-contract.log and hooks/skill-route.log, lines "<time> session=<id> event=<event> ...") and the contract
// records (skill-contracts/<session>.json). The Stop hook ran when it logged any event, and held a stop back when it logged
// event=blocked; outcome is the investigate run's last recorded outcome (met, met_after_block, miss, ...), or null.
export function hookState(dir: string) {
  const root = join(dir, "evaluator", "gstack-hooks");
  const files: string[] = [];
  const walk = (d: string): void => { for (const e of readdirSync(d, { withFileTypes: true })) { if (e.isDirectory()) walk(join(d, e.name)); else files.push(join(d, e.name)); } };
  if (existsSync(root)) walk(root);
  const events = (hook: string) => [hook + ".log.1", hook + ".log"].flatMap((f) => (existsSync(join(root, "hooks", f)) ? readFileSync(join(root, "hooks", f), "utf8").split("\n") : []))
    .map((l) => /(?:^| )event=(\S+)/.exec(l)?.[1]).filter((e): e is string => !!e);
  const contract = events("skill-contract"), route = events("skill-route");
  const runs: any[] = [];
  const records = join(root, "skill-contracts");
  if (existsSync(records)) for (const f of readdirSync(records).filter((f) => f.endsWith(".json")).sort()) {
    try { runs.push(...Object.values(JSON.parse(readFileSync(join(records, f), "utf8")).runs ?? {})); } catch { /* an unreadable record shows only in the logs */ }
  }
  const investigate = runs.filter((r) => /(^|[:/-])investigate$/.test(String(r?.skill))).sort((a, b) => String(a.updated_at).localeCompare(String(b.updated_at)));
  const count = (xs: string[]) => Object.fromEntries([...new Set(xs)].sort().map((x) => [x, xs.filter((y) => y === x).length]));
  return {
    files: files.length, stop_hook_ran: contract.length > 0, held_back: contract.includes("blocked"), outcome: (investigate.at(-1)?.outcome as string | undefined) ?? null,
    route_hook_ran: route.length > 0, routed: route.includes("routed"), contract_events: count(contract), route_events: count(route),
  };
}

// The stricter indicator (amendment 4 section 7, report-only): distinct Phase 1 to Phase 5 headings in the agent's text,
// a heading being a line that starts with "Phase <n>", after any markdown heading marks, quote marks or bold.
export const PHASE_HEADING = /^[ \t>]*(?:#{1,6}[ \t]*|\*\*|__)?[ \t]*Phase ([1-5])\b/gm;
export const phaseHeadings = (text: string) => new Set([...text.matchAll(PHASE_HEADING)].map((x) => x[1])).size;

// Task-repo skills (R3a4 deviation 3, report-only): the session's init skill list less Claude Code's two built-ins and the
// arm's gstack skills, and the Skill tool calls that name no gstack skill.
export const BUILTIN_SKILLS = ["doctor", "plugin-authoring"];
export function repoSkills(lines: string[], gstackSkills: Set<string>) {
  let init: string[] | null = null;
  const calls: string[] = [];
  for (const line of lines) {
    let rec: any;
    try { rec = JSON.parse(line); } catch { continue; }
    if (init === null && Array.isArray(rec?.init?.skills)) init = rec.init.skills.map((s: any) => (typeof s === "string" ? s : String(s?.name ?? ""))).filter(Boolean);
    if (rec?.type === "AssistantMessage" && Array.isArray(rec.content)) for (const b of rec.content) if (b?.name === "Skill") calls.push(String(b.input?.skill ?? b.input?.command ?? b.input?.name ?? "?").replace(/^\//, ""));
  }
  return { repo_skills: (init ?? []).filter((s) => !BUILTIN_SKILLS.includes(s) && !gstackSkills.has(s)), non_gstack_skill_calls: calls.filter((c) => !gstackSkills.has(c)).length };
}

export type GridTrial = R3Trial & { phase_headings: number; hooks: ReturnType<typeof hookState>; repo_skills: string[]; non_gstack_skill_calls: number };
const gstackSkills = () => new Set<string>(JSON.parse(readFileSync(join(LANEB, R3B.manifests, "gstack.json"), "utf8")).skills.names);

export function loadGridTrials(jobsDir: string, sessionRows: ReturnType<typeof readSessionRows>, proxy: ProxyConfig, skills = gstackSkills()): GridTrial[] {
  const sessions = sessionsByTrial(sessionRows), out: GridTrial[] = [];
  for (const job of readdirSync(jobsDir).sort()) {
    const jd = join(jobsDir, job);
    if (!statSync(jd).isDirectory()) continue;
    for (const name of readdirSync(jd).sort()) {
      const d = join(jd, name);
      if (!statSync(d).isDirectory()) continue;
      const t = loadR3Trial(d, sessions, proxy);
      if (!t) continue;
      const msgs = join(d, "evaluator", "sdk-messages.jsonl");
      const lines = existsSync(msgs) ? readFileSync(msgs, "utf8").split("\n") : [];
      out.push({ ...t, phase_headings: phaseHeadings(agentText(lines)), hooks: hookState(d), ...repoSkills(lines, skills) });
    }
  }
  return out;
}

export function recheckGate(trials: R3Trial[]) {
  const graded = trials.filter((t) => t.outcome !== "infra");
  const infra = trials.length - graded.length, exposed = graded.filter((t) => t.exposed).length;
  return { trials: trials.length, graded: graded.length, infra, exposed, incomplete: infra >= R3B.recheckInfraStop, pass: infra < R3B.recheckInfraStop && exposed >= R3B.recheckMinExposed };
}
export const recheckStopLine = (m: R3bItem, g: ReturnType<typeof recheckGate>) =>
  "R3b did not run for " + m.label + ": told /investigate at " + PIN.slice(0, 8) + " showed the procedure in " + g.exposed + " of " + g.graded + " re-check trials, under " + R3B.recheckMinExposed + ".";

// The start rule (section 5): amendment 4 section 13's projection from the model's R3a4 record fits the recorded cap.
export function startRule(recordPath: string, m: R3bItem, capUsd: number) {
  let rec: any;
  try { rec = JSON.parse(readFileSync(recordPath, "utf8")); } catch { throw new Error("E_USAGE R3A4_RECORD " + JSON.stringify(recordPath) + " is not readable JSON; set it to " + m.from + "'s record.json"); }
  if (rec.item !== m.from || rec.outcome !== "admitted") throw new Error(recordPath + " is " + rec.item + "'s record with outcome " + rec.outcome + ", not " + m.from + "'s admitted record");
  if (JSON.stringify(rec.r3b_tasks) !== JSON.stringify(taskList(m.tasksFile, m.tasksSha256))) throw new Error(recordPath + "'s r3b_tasks are not " + m.tasksFile);
  if (JSON.stringify([...(rec.pilot?.tasks ?? [])].sort()) !== JSON.stringify([...recheckTasks()].sort())) throw new Error(recordPath + "'s pilot tasks are not " + R3B.recheckFile);
  const none = rec.measured_cost_per_trial_usd?.none, told = rec.measured_cost_per_trial_usd?.told;
  if (rec.n !== R3B.n || !Number.isFinite(none) || !Number.isFinite(told)) throw new Error(recordPath + " has no n of " + R3B.n + " or no measured none and told cost per trial");
  const usd = rec.n * 3 * (none + told), ok = usd <= capUsd;
  return { ok, usd, line: "start rule: projection $" + usd.toFixed(2) + " = " + rec.n + " x 3 x ($" + none.toFixed(4) + " none + $" + told.toFixed(4) + " told), from " + m.from + "'s record, " + (ok ? "fits" : "passes") + " " + m.item + "'s $" + capUsd + " cap" + (ok ? "" : "; " + m.item + " does not bind") };
}

const meanCost = (all: R3Trial[]) => { const ts = all.filter((t) => t.outcome !== "infra"); return ts.length ? ts.reduce((s, t) => s + (t.cost_usd ?? R3B.allowanceUsd), 0) / ts.length : null; };
export const vmSettled = (rows: Row[], prefix: string) => fromMicros(rows.filter((r) => r.kind === "settle" && r.id.startsWith(prefix) && String(r.kind_detail ?? "").startsWith("VM hours")).reduce((s, r) => s + r.usd_micros, 0));

// The projection after a part (section 5), from cost data only. done is the number of grid parts completed, grid their
// trials and gridVmUsd their settled VM cost. Each mean is over graded trials, the basis admission() measured the cap on:
// infra trials stay out, and a graded trial with no metered cost counts at the $12 allowance.
export function gridProjection(o: { rows: Row[]; m: R3bItem; capUsd: number; after: string; next: string; done: number; recheck: R3Trial[]; grid: R3Trial[]; gridVmUsd: number }) {
  const { m, capUsd } = o, b = m.basis, remaining = R3B.gridParts - o.done;
  const settled = fromMicros(totals(o.rows).settledMicros);
  const none = o.done ? meanCost(o.grid.filter((t) => t.arm === NONE))! : b.r3bNoneUsd;
  const told = o.done ? meanCost(o.grid.filter((t) => t.arm === TOLD))! : (meanCost(o.recheck) ?? R3B.allowanceUsd) * b.toldScale;
  const vmPart = o.done ? o.gridVmUsd / o.done : R3B.n * (b.noneVmHours * (b.r3bNoneUsd / b.screenNoneUsd) + b.toldVmHours * b.toldScale) * R3B.vmUsdPerHour;
  const usd = settled + remaining * (R3B.n * none + R3B.n * told + vmPart) + R3B.reserveUsd;
  const over = usd > capUsd;
  const line = "after " + o.after + ": projection $" + usd.toFixed(2) + " (settled $" + settled.toFixed(2) + "; " + remaining + " parts of " + R3B.n + " none at $" + none.toFixed(4) + " and " + R3B.n + " told at $" + told.toFixed(4) +
    ", VM $" + vmPart.toFixed(2) + " a part; reserve headroom $" + R3B.reserveUsd.toFixed(2) + ") " + (over ? "passes" : "fits") + " " + m.item + "'s $" + capUsd + " cap" + (over ? "; the run stops before " + o.next + " and the Captain decides a raise" : "; " + o.next + " starts");
  return { over, line, record: { after: o.after, next: o.next, projection_usd: usd, cap_usd: capUsd, settled_usd: settled, remaining_parts: remaining, none_usd: none, told_usd: told, vm_part_usd: vmPart, reserve_usd: R3B.reserveUsd, over } };
}

// Why a part is incomplete, or null; cost marks a projection stop (FIX-METHOD, cost limits).
function partStop(work: string, part: Part, trials: R3Trial[], tasks: string[], m: R3bItem): { reason: string; cost: boolean } | null {
  const dir = join(work, part.name), stop = (reason: string, cost = false) => ({ reason, cost });
  const projected = join(work, part.name + ".projection-stop");
  if (existsSync(projected)) return stop(part.name + " was not launched: " + JSON.parse(readFileSync(projected, "utf8")).line, true);
  const exitFile = join(work, part.name + ".launch-exit");
  const exitText = existsSync(exitFile) ? readFileSync(exitFile, "utf8").trim() : null;
  if (exitText !== null && !/^\d+$/.test(exitText)) return stop(part.name + ": launch exit unreadable");
  const rc = exitText === null ? null : Number(exitText);
  if (rc === 9) return stop(m.item + " refused " + part.name + "'s VM reserve");
  if (existsSync(join(dir, "vm-cap-stop"))) return stop(part.name + ": " + readFileSync(join(dir, "vm-cap-stop"), "utf8").trim());
  const bad = PROXY_FILES.find((f) => existsSync(join(dir, "pulled/out", f)) && unreadable(join(dir, "pulled/out", f)));
  if (bad) return stop(part.name + ": pulled/out/" + bad + " is empty or unparseable");
  const status = [join(dir, "pulled/out/cap-stop.json"), join(dir, "pulled/out/proxy-status-end.json")].map((p) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null)).find((s) => s?.cap_stop);
  if (status) return stop(part.name + ": " + status.cap_stop);
  const capped = trials.find((t) => t.cap_stop);
  if (capped) return stop(part.name + ": " + capped.trial + " stopped at the cap (LedgerCapStop)");
  const pullFails = join(dir, "pulled/out/pull-fails.txt");
  if (existsSync(pullFails)) return stop(part.name + ": infra before any model call: an image did not pull: " + readFileSync(pullFails, "utf8").trim().split("\n").join("; "));
  if (rc === null) return stop(part.name + " was never launched");
  if (rc !== 0) return stop(part.name + "'s launch exited " + rc);
  if (!existsSync(join(dir, "pulled/jobs"))) return stop(part.name + " has no pulled results");
  const arms = part.name === "recheck" ? [TOLD] : [NONE, TOLD];
  const stray = trials.filter((t) => !arms.includes(t.arm));
  if (stray.length) return stop(part.name + ": " + stray.length + " trials outside the plan (" + stray.slice(0, 3).map((t) => t.trial).join(", ") + ")");
  for (const arm of arms) {
    const gap = coverage(trials.filter((t) => t.arm === arm), tasks, arm, m.id);
    if (gap) return stop(part.name + " " + arm + ": " + gap);
  }
  const infra = trials.filter((t) => t.outcome === "infra").length;
  if (part.name === "recheck") return infra >= R3B.recheckInfraStop ? stop("recheck: " + infra + " of " + trials.length + " trials are infra, two or more") : null;
  return infra > R3B.infraBound * trials.length ? stop(part.name + ": " + infra + " of " + trials.length + " trials are infra, over 10%") : null;
}

function loadPart(work: string, part: Part, m: R3bItem) {
  const dir = join(work, part.name);
  const tasks = part.name === "recheck" ? recheckTasks() : taskList(m.tasksFile, m.tasksSha256);
  const sessions = join(dir, "pulled/out/proxy-sessions.jsonl");
  const trials = existsSync(join(dir, "pulled/jobs"))
    ? loadGridTrials(join(dir, "pulled/jobs"), existsSync(sessions) && !unreadable(sessions) ? readSessionRows([sessions]) : [], JSON.parse(readFileSync(join(dir, "proxy.json"), "utf8")))
    : [];
  return { part, trials, stop: partStop(work, part, trials, tasks, m) };
}

// The prepared plan must be this item's, on the frozen task lists, with every part's oracle.json (section 9 item 4) and
// each grid part's order.json.
function planCheck(work: string, m: R3bItem) {
  if (!existsSync(join(work, "plan.json"))) throw new Error("E_USAGE " + work + " has no plan.json; run prepare first");
  const plan = JSON.parse(readFileSync(join(work, "plan.json"), "utf8"));
  if (plan.item !== m.item) throw new Error("E_USAGE " + work + "/plan.json is item " + plan.item + "'s, not " + m.item + "'s; nothing was bound or launched");
  const tasks = taskList(m.tasksFile, m.tasksSha256), order = JSON.stringify(gridOrder(tasks));
  if (plan.tasks_sha256 !== m.tasksSha256 || plan.recheck_sha256 !== R3B.recheckSha256 || plan.order_sha256 !== createHash("sha256").update(order).digest("hex")) throw new Error(work + "/plan.json's tasks or order are not the frozen ones");
  for (const part of m.parts) {
    const dir = join(work, part.name);
    if (!existsSync(join(dir, "oracle.json"))) throw new Error(part.name + " has no oracle.json, so its run-time oracle gate can't run; prepare it again with this build (amendment 5 section 9 item 4)");
    const job = JSON.parse(readFileSync(join(dir, "job.json"), "utf8"));
    const want = part.name === "recheck" ? recheckTasks() : tasks;
    if (JSON.stringify(job.tasks.map((t: any) => String(t.path).split("/").at(-1)).sort()) !== JSON.stringify([...want].sort())) throw new Error(part.name + "/job.json's tasks are not the plan's");
    if (part.name !== "recheck" && (!existsSync(join(dir, "order.json")) || JSON.stringify(JSON.parse(readFileSync(join(dir, "order.json"), "utf8"))) !== order)) throw new Error(part.name + " has no order.json with the seed " + R3B.shuffleSeed + " shuffle");
  }
  return plan;
}

function prepare(work: string, m: R3bItem) {
  const ledger = process.env.LEDGER ?? "";
  bindCheck(ledger, m, [join(LANEB, "config/proxy.json")]);
  const bad = armCheck();
  if (bad.length) throw new Error("arm-check fails: " + bad.join("; "));
  const arms = process.env.ARMS;
  if (!arms) throw new Error("E_USAGE set ARMS to the directory holding none.tar.gz and the told arm's gstack.tar.gz (the project drive's laneb-arms/r3b-gstack-699a41cb, joined)");
  const tasks = taskList(m.tasksFile, m.tasksSha256), recheck = recheckTasks(), order = gridOrder(tasks);
  mkdirSync(work, { recursive: true });
  for (const part of m.parts) {
    const env = { ...process.env, TASK_SET: "swerebench-r3a4", CELLS: R3B.cells, ARM_MANIFESTS: R3B.manifests, TASKS: (part.name === "recheck" ? recheck : tasks).join(","), ORACLE: "1" };
    const rc = sh([process.execPath, join(LANEB, "runner/prepare-run.ts"), join(work, part.name), part.job, m.id, part.arm, arms, "1", R3B.concurrent], env);
    if (rc !== 0) throw new Error("prepare-run for " + part.name + " exited " + rc);
    writeFileSync(join(work, part.name, "STOP_ON_CAP"), "");
    if (part.name !== "recheck") writeFileSync(join(work, part.name, "order.json"), JSON.stringify(order) + "\n");
  }
  writeFileSync(join(work, "plan.json"), JSON.stringify({
    item: m.item, cap_usd: m.capUsd, pin: PIN, told_tar_sha256: TOLD_TAR_SHA256, tasks_sha256: m.tasksSha256, recheck_sha256: R3B.recheckSha256,
    shuffle_seed: R3B.shuffleSeed, order_sha256: createHash("sha256").update(JSON.stringify(order)).digest("hex"),
    procedure_line_sha256: createHash("sha256").update(PROCEDURE_LINES["investigate-phases"]).digest("hex"), concurrent: Number(R3B.concurrent), parts: m.parts,
  }, null, 2) + "\n");
  console.log("prepared " + work + ": recheck (" + recheck.length + " tasks, told) and grid-1 to grid-3 (" + tasks.length + " tasks x none and told each, seed " + R3B.shuffleSeed + " order), every part with its oracle.json; item " + m.item + " unbound");
}

function launchChecks(m: R3bItem, state: string) {
  const env = launchEnv(m, state);
  const ttl = Number(process.env.UBI_TTL_HOURS || "3");
  if (ttl < R3B.minTtlHours) throw new Error("E_USAGE set UBI_TTL_HOURS to " + R3B.minTtlHours + " or more; a grid part runs about 7 hours, and ubi-runner.sh reaps a VM past its TTL; " + state);
  return env;
}

function projectionAfter(work: string, m: R3bItem, i: number, rows: Row[], capUsd: number) {
  const done = m.parts.slice(1, i + 1);
  return gridProjection({
    rows, m, capUsd, after: m.parts[i]!.name, next: m.parts[i + 1]!.name, done: done.length, recheck: loadPart(work, m.parts[0]!, m).trials,
    grid: done.flatMap((p) => loadPart(work, p, m).trials), gridVmUsd: done.reduce((s, p) => s + vmSettled(rows, p.prefix), 0),
  });
}

type LaunchOpts = { ledger: string; lport: string; hours: string; busy: string };
function launchFrom(work: string, m: R3bItem, from: number, o: LaunchOpts) {
  for (const [i, part] of m.parts.entries()) {
    if (i < from) continue;
    const dir = join(work, part.name);
    if (!existsSync(join(dir, "oracle.json"))) { console.log(part.name + ": no oracle.json, so its run-time oracle gate can't run; the run stops here"); return; }
    if (portTaken("127.0.0.1", o.lport)) { console.log(part.name + ": " + o.busy + "; the run stops here"); return; }
    const cap = fromMicros(totals(readRows(o.ledger)).capMicros);
    const rc = sh(["bash", join(LANEB, "runner/launch.sh"), dir, part.prefix, String(cap)], { ...process.env, LEDGER: o.ledger, LEDGER_PORT: o.lport, ITEM: m.item, VM_RESERVE_HOURS: o.hours });
    writeFileSync(join(work, part.name + ".launch-exit"), rc + "\n");
    if (rc !== 0 || existsSync(join(dir, "pulled/out/cap-stop.json")) || existsSync(join(dir, "vm-cap-stop"))) { console.log(part.name + ": launch exited " + rc + "; the run stops here"); return; }
    const loaded = loadPart(work, part, m);
    if (loaded.stop) { console.log(part.name + " is incomplete (" + loaded.stop.reason + "); the run stops here"); return; }
    if (part.name === "recheck") {
      const g = recheckGate(loaded.trials);
      if (!g.pass) { const line = recheckStopLine(m, g); console.log(line); writeFileSync(join(work, "recheck.gate-stop"), line + "\n"); return; }
      console.log("re-check: " + g.exposed + " of " + g.graded + " graded told trials exposed, at least " + R3B.recheckMinExposed);
    }
    if (i === m.parts.length - 1) return;
    const rows = readRows(o.ledger), p = projectionAfter(work, m, i, rows, cap);
    console.log(p.line);
    writeFileSync(join(work, "projection-" + part.name + ".json"), JSON.stringify({ ...p.record, line: p.line }, null, 2) + "\n");
    if (p.over) {
      writeFileSync(join(work, m.parts[i + 1]!.name + ".projection-stop"), JSON.stringify({ line: p.line, approvals: rows.filter((r) => r.kind === "approval").length }) + "\n");
      return;
    }
  }
}

function run(work: string, m: R3bItem): number {
  const ledger = process.env.LEDGER ?? "", bound = ledger + ".bound";
  const boundTo = () => m.item + " is already bound to a run (" + readFileSync(bound, "utf8").trim() + "); an item serves one run";
  if (existsSync(bound)) throw new Error(boundTo());
  const { hours } = launchChecks(m, m.item + " is still unbound");
  planCheck(work, m);
  routePassed(ledger, m);
  const bad = armCheck();
  if (bad.length) throw new Error("arm-check fails: " + bad.join("; ") + "; " + m.item + " is still unbound");
  const lport = process.env.LEDGER_PORT ?? m.ledgerPort;
  const busy = "something already answers on 127.0.0.1:" + lport + " (another run's ledger service?)";
  if (portTaken("127.0.0.1", lport)) throw new Error("E_USAGE " + busy + "; set LEDGER_PORT to a free port; " + m.item + " is still unbound");
  const configs = m.parts.map((part) => join(work, part.name, "proxy.json"));
  bindCheck(ledger, m, configs);
  const record = process.env.R3A4_RECORD ?? "";
  if (!record) throw new Error("E_USAGE set R3A4_RECORD to " + m.from + "'s record.json, which the start rule reads; " + m.item + " is still unbound");
  const start = startRule(record, m, fromMicros(totals(readRows(ledger)).capMicros));
  console.log(start.line);
  if (!start.ok) return 5;
  try {
    writeFileSync(bound, JSON.stringify({ item: m.item, work, at: new Date().toISOString() }) + "\n", { flag: "wx" });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    throw new Error(boundTo());
  }
  bindCheck(ledger, m, configs);
  writeFileSync(join(work, "start.json"), JSON.stringify({ projection_usd: start.usd, line: start.line }, null, 2) + "\n");
  launchFrom(work, m, 0, { ledger, lport, hours, busy });
  return 0;
}

// After a projection stop: one resume per stop, on the same item and work dir, once a raise recorded after the stop is on
// the ledger and the projection fits it.
function resume(work: string, m: R3bItem) {
  const ledger = process.env.LEDGER ?? "", bound = ledger + ".bound";
  if (!existsSync(bound)) throw new Error(m.item + " is not bound to a run; resume follows run's projection stop");
  const boundWork = String(JSON.parse(readFileSync(bound, "utf8")).work);
  if (resolve(boundWork) !== work) throw new Error(m.item + " is bound to the run in " + boundWork + ", not " + work + "; nothing was launched");
  const i = m.parts.findIndex((p) => existsSync(join(work, p.name + ".projection-stop")));
  if (i < 1) throw new Error(work + " has no projection stop; resume follows only a projection stop, and only once for each");
  const part = m.parts[i]!, stopFile = join(work, part.name + ".projection-stop");
  const { hours } = launchChecks(m, part.name + " stays stopped");
  const stop = JSON.parse(readFileSync(stopFile, "utf8"));
  const rows = readRows(ledger), approvals = rows.filter((r) => r.kind === "approval");
  if (approvals[0]?.item !== m.item || approvals[0]?.usd_micros !== m.capUsd * 1_000_000) throw new Error(ledger + ": the first approval row is not " + m.item + "'s at " + m.capFrom + " $" + m.capUsd);
  if (approvals.length <= Number(stop.approvals) || approvals.at(-1)?.item !== m.item) throw new Error("no cap raise is recorded on " + ledger + " for " + m.item + " since the projection stop before " + part.name + "; it stays stopped (amendment 5 section 5)");
  const capUsd = fromMicros(totals(rows).capMicros);
  planCheck(work, m);
  const p = projectionAfter(work, m, i - 1, rows, capUsd);
  console.log(p.line);
  if (p.over) throw new Error("the projection of $" + p.record.projection_usd.toFixed(2) + " still passes " + m.item + "'s raised $" + capUsd + " cap; " + part.name + " stays stopped");
  const lport = process.env.LEDGER_PORT ?? m.ledgerPort;
  const busy = "something already answers on 127.0.0.1:" + lport + " (another run's ledger service?)";
  if (portTaken("127.0.0.1", lport)) throw new Error("E_USAGE " + busy + "; set LEDGER_PORT to a free port; " + part.name + " stays stopped");
  writeFileSync(join(work, "cap-raise-" + part.name + ".json"), JSON.stringify({ raise: approvals.at(-1), projection: { ...p.record, line: p.line } }, null, 2) + "\n");
  renameSync(stopFile, stopFile + ".raised");
  try {
    launchFrom(work, m, i, { ledger, lport, hours, busy });
  } finally {
    if (!existsSync(join(work, part.name + ".launch-exit"))) renameSync(stopFile + ".raised", stopFile);
  }
}

// Power under section 6's task model, as r3b-power.ts.txt runs it, with the generator re-seeded at each lift so a search
// over lifts is deterministic: per-task none chance p ~ Beta(m c, (1 - m) c), or given one failed screen trial
// Beta(m c, (1 - m) c + 1) ("failed"), told = min(1, p + d), 3 replicates per arm, and KEEP when the paired task-clustered
// 95% interval (10,000 draws, seed 20261101, analyze()'s contrast) is above zero.
export function keepRate(o: { m: number; n: number; d: number; sims: number; draw: "failed" | "prior"; c?: number }) {
  const c = o.c ?? R3B.power.concentration, u = rng(R3B.power.seed);
  const normal = () => { let x = 0, y = 0, s = 0; do { x = 2 * u() - 1; y = 2 * u() - 1; s = x * x + y * y; } while (s >= 1 || s === 0); return x * Math.sqrt(-2 * Math.log(s) / s); };
  const gamma = (k: number): number => {
    if (k < 1) return gamma(k + 1) * Math.pow(u(), 1 / k);
    const d = k - 1 / 3, cc = 1 / Math.sqrt(9 * d);
    for (;;) { const z = normal(), v = Math.pow(1 + cc * z, 3); if (v <= 0) continue; if (Math.log(u()) < 0.5 * z * z + d - d * v + d * Math.log(v)) return d * v; }
  };
  const a = o.m * c, b = (1 - o.m) * c + (o.draw === "failed" ? 1 : 0);
  let keep = 0;
  for (let s = 0; s < o.sims; s++) {
    const none = new Map<string, number>(), told = new Map<string, number>(), tasks: string[] = [];
    for (let i = 0; i < o.n; i++) {
      const x = gamma(a), p = x / (x + gamma(b)), q = Math.min(1, p + o.d);
      let kn = 0, kt = 0;
      for (let r = 0; r < 3; r++) { kn += +(u() < p); kt += +(u() < q); }
      none.set("t" + i, kn / 3); told.set("t" + i, kt / 3); tasks.push("t" + i);
    }
    tasks.sort();
    const avg = (map: Map<string, number>, sample: string[]) => sample.reduce((z, k) => z + map.get(k)!, 0) / sample.length;
    if (bootstrap(tasks, (smp) => avg(told, smp) - avg(none, smp), { seed: R3B.seed, b: R3B.draws }).lo > 0) keep++;
  }
  return keep / o.sims;
}
// The smallest lift on a 0.5-point grid up to 100 points with KEEP in at least 80% of runs, in points, or null.
export function simulatedMdd(o: { m: number; n: number; sims: number; draw: "failed" | "prior" }): number | null {
  if (o.n < 1) return null;
  const at = (k: number) => keepRate({ ...o, d: (k * R3B.power.stepPoints) / 100 }) >= R3B.power.target;
  let lo = 1, hi = 100 / R3B.power.stepPoints;
  if (!at(hi)) return null;
  while (lo < hi) { const mid = Math.floor((lo + hi) / 2); if (at(mid)) hi = mid; else lo = mid + 1; }
  return lo * R3B.power.stepPoints;
}
export const formulaMdd = (n: number) => 100 * 2.8 * Math.sqrt((2 * 0.16) / 3 / n);

const pts = (x: number) => (x >= 0 ? "+" : "") + (100 * x).toFixed(1);
const pct = (x: number) => (100 * x).toFixed(1) + "%";

// The cross-model overlap of unsolved admitted tasks (GSTA-2's report-only sentence): both models' R3a4 admitted lists,
// with the count expected if the two failed independently on the 200 screen tasks.
export function overlapLine() {
  const opus = R3B4["r3b4-opus"]!, sol = R3B4["r3b4-sol"]!;
  const a = taskList(opus.admitted.file, opus.admitted.sha256), b = new Set(taskList(sol.admitted.file, sol.admitted.sha256));
  const both = a.filter((t) => b.has(t)).length;
  return { both, opus: a.length, sol: b.size, independent: (a.length * b.size) / A4.screenTasks, line: "cross-model overlap (report only): " + both + " of " + opus.label + "'s " + a.length + " admitted tasks are also unsolved by " + sol.label + " (" + b.size + " admitted), against about " + ((a.length * b.size) / A4.screenTasks).toFixed(1) + " if the two failed independently on the " + A4.screenTasks + " screen tasks" };
}

export type Verdict = "KEEP" | "CUT-CANDIDATE" | "FIX-METHOD (exposure)" | "FIX-METHOD (truncation)" | "FIX-METHOD (task fit)" | "FIX-METHOD (power)";
// The outcome on a complete grid (#112 section 4.6, amendment 4 section 12 with D1 as fixed, amendment 5 section 5) and the
// report-only counts beside it. Every graded told grid trial counts in every contrast; the E1 truncation bound counts every
// grid session, infra included, since it compares sessions that ended at the allowance.
export function gridOutcome(grid: GridTrial[], m: R3bItem, o: { sims: number; repoOf?: Map<string, string> }) {
  const graded = grid.filter((t) => t.outcome !== "infra");
  const told = graded.filter((t) => t.arm === TOLD), none = graded.filter((t) => t.arm === NONE);
  const exposed = told.filter((t) => t.exposed).length, exposure = told.length ? exposed / told.length : 0;
  const stops = (ts: R3Trial[]) => ts.filter((t) => t.budget_stop).length;
  const share = (ts: R3Trial[]) => (ts.length ? stops(ts) / ts.length : 0);
  const toldRun = grid.filter((t) => t.arm === TOLD), noneRun = grid.filter((t) => t.arm === NONE);
  const truncation = 100 * (share(toldRun) - share(noneRun));
  const opts = { models: [m.id], arms: [NONE, TOLD], reference: m.id, seed: R3B.seed, b: R3B.draws };
  const rep = analyzeTrials(grid.map(toTrial), opts);
  const primary = rep.contrasts.find((c) => c.contrast === TOLD + " - " + NONE)!;
  const rate = (arm: string) => rep.passRates.find((r) => r.arm === arm)!;
  const pairedTasks = [...new Set(none.map((t) => t.task))].filter((k) => told.some((t) => t.task === k)).sort();
  const solved = new Set(graded.filter((t) => t.outcome === "pass").map((t) => t.task));
  const sensSet = pairedTasks.filter((k) => solved.has(k));
  const sens = sensSet.length ? analyzeTrials(grid.filter((t) => sensSet.includes(t.task)).map(toTrial), opts).contrasts.find((c) => c.contrast === TOLD + " - " + NONE)! : null;
  let verdict: Verdict;
  if (exposure < R3B.exposureGate) verdict = "FIX-METHOD (exposure)";
  else if (truncation > R3B.truncationPoints) verdict = "FIX-METHOD (truncation)";
  else if (primary.lo > 0) verdict = "KEEP";
  else if (primary.diff <= 0) verdict = sensSet.length < R3B.d1MinTasks ? "FIX-METHOD (task fit)" : sens!.diff <= 0 ? "CUT-CANDIDATE" : "FIX-METHOD (task fit)";
  else verdict = "FIX-METHOD (power)";
  const lines: string[] = [];
  const ci = (c: { diff: number; lo: number; hi: number }) => pts(c.diff) + " points (95% CI " + pts(c.lo) + " to " + pts(c.hi) + ")";
  lines.push("grid: none " + rate(NONE).passes + " of " + rate(NONE).trials + " graded trials passed (control rate " + pct(rate(NONE).rate) + "), told " + rate(TOLD).passes + " of " + rate(TOLD).trials + " (" + pct(rate(TOLD).rate) + "); " + pairedTasks.length + " paired tasks");
  lines.push("exposure: " + exposed + " of " + told.length + " graded told grid trials exposed (" + pct(exposure) + "; the gate needs 90%)");
  lines.push("allowance stops: told " + stops(toldRun) + " of " + toldRun.length + " sessions (" + pct(share(toldRun)) + "), none " + stops(noneRun) + " of " + noneRun.length + " (" + pct(share(noneRun)) + "), infra included; the truncation bound is 5 points");
  lines.push("primary: told minus none " + ci(primary) + " on " + primary.tasks + " paired tasks");
  lines.push("D1 sensitivity: " + sensSet.length + " paired tasks solved by at least one graded grid trial in either arm" + (sens ? "; told minus none " + ci(sens) + " on them" : "; the set is empty"));
  // Report-only from here (amendment 5 section 5, amendment 4 sections 7 and 12, GSTA-2's sentence).
  let repo: { lo: number; hi: number; repos: number } | null = null;
  if (o.repoOf) {
    const byRepo = new Map<string, string[]>();
    for (const k of pairedTasks) { const r = o.repoOf.get(k) ?? k; byRepo.set(r, [...(byRepo.get(r) ?? []), k]); }
    const cell = (arm: string) => { const acc = new Map<string, number[]>(); for (const t of graded.filter((x) => x.arm === arm)) acc.set(t.task, [...(acc.get(t.task) ?? []), t.outcome === "pass" ? 1 : 0]); return new Map([...acc].map(([k, xs]) => [k, xs.reduce((a, b) => a + b, 0) / xs.length])); };
    const cn = cell(NONE), ct = cell(TOLD);
    const b = bootstrap([...byRepo.keys()].sort(), (smp) => { const ks = smp.flatMap((r) => byRepo.get(r)!); return ks.reduce((z, k) => z + ct.get(k)! - cn.get(k)!, 0) / ks.length; }, { seed: R3B.seed, b: R3B.draws });
    repo = { lo: b.lo, hi: b.hi, repos: byRepo.size };
    lines.push("repository-clustered interval (report only): " + pts(b.lo) + " to " + pts(b.hi) + " points over " + byRepo.size + " repositories");
  }
  const phases = [0, 1, 2, 3, 4, 5].map((k) => told.filter((t) => t.phase_headings === k).length);
  lines.push("stricter indicator (report only): told trials by distinct Phase 1-5 headings, 0 to 5: " + phases.join(", ") + "; mean " + (told.length ? told.reduce((s, t) => s + t.phase_headings, 0) / told.length : 0).toFixed(2));
  const hookCounts = (ts: GridTrial[]) => ({ trials: ts.length, stop_hook_ran: ts.filter((t) => t.hooks.stop_hook_ran).length, held_back: ts.filter((t) => t.hooks.held_back).length, route_hook_ran: ts.filter((t) => t.hooks.route_hook_ran).length,
    outcomes: Object.fromEntries([...new Set(ts.map((t) => t.hooks.outcome ?? "none"))].sort().map((k) => [k, ts.filter((t) => (t.hooks.outcome ?? "none") === k).length])) });
  const hooks = hookCounts(told);
  lines.push("Stop hook (report only): ran in " + hooks.stop_hook_ran + " of " + told.length + " graded told grid trials and held a stop back in " + hooks.held_back + "; outcomes " + Object.entries(hooks.outcomes).map(([k, v]) => k + " " + v).join(", ") + "; the route hook logged in " + hooks.route_hook_ran);
  const cps = (arm: string) => rate(arm).costPerSuccess;
  lines.push("cost per success (report only): none " + (cps(NONE) === null ? "n/a" : "$" + cps(NONE)!.toFixed(2)) + ", told " + (cps(TOLD) === null ? "n/a" : "$" + cps(TOLD)!.toFixed(2)));
  const repoSk = (ts: GridTrial[]) => { const s = ts.filter((t) => t.repo_skills.length); return { sessions: s.length, non_gstack_skill_calls: s.reduce((z, t) => z + t.non_gstack_skill_calls, 0) }; };
  const rs = { none: repoSk(grid.filter((t) => t.arm === NONE)), told: repoSk(grid.filter((t) => t.arm === TOLD)) };
  lines.push("task-repo skills (report only): none " + rs.none.sessions + " sessions with them in the init list and " + rs.none.non_gstack_skill_calls + " Skill calls to non-gstack skills there; told " + rs.told.sessions + " and " + rs.told.non_gstack_skill_calls);
  const overlap = overlapLine();
  lines.push(overlap.line);
  const mdd: Record<string, number | null> = {};
  if (verdict !== "KEEP") {
    mdd.frozen = R3B.frozenMddPoints;
    mdd.resimulated = simulatedMdd({ m: rate(NONE).rate, n: sensSet.length, sims: o.sims, draw: "prior" });
    lines.push("MDD (amendment 5 section 6): " + R3B.frozenMddPoints + " points at 70 tasks; re-simulated at the grid's none rate " + pct(rate(NONE).rate) + " and the sensitivity set's " + sensSet.length + " tasks (report only): " + (mdd.resimulated === null ? "none found up to 100 points" : mdd.resimulated + " points") + ", " + o.sims + " runs a lift");
  }
  if (verdict === "FIX-METHOD (power)") {
    mdd.formula = formulaMdd(primary.tasks);
    mdd.r3b_power = simulatedMdd({ m: m.screenNoneRate, n: primary.tasks, sims: o.sims, draw: "failed" });
    lines.push("MDD at the realized n of " + primary.tasks + " paired tasks: #112's formula " + mdd.formula.toFixed(1) + " points; r3b-power's model at screen none rate " + m.screenNoneRate + ": " + (mdd.r3b_power === null ? "none found up to 100 points" : mdd.r3b_power + " points"));
  }
  const arm = "told /investigate at " + PIN.slice(0, 8) + " with the procedure line";
  const head = "R3b outcome" + m.tag + ": " + verdict + ". ";
  const outcomeLine = {
    "KEEP": head + "The " + arm + " beats none by " + ci(primary) + " on " + primary.tasks + " paired tasks.",
    "CUT-CANDIDATE": head + "The " + arm + " minus none is at or below zero: " + ci(primary) + " on " + primary.tasks + " paired tasks, and " + (sens ? ci(sens) : "") + " on the " + sensSet.length + "-task D1 sensitivity set; control rate " + pct(rate(NONE).rate) + ", MDD " + R3B.frozenMddPoints + " points, procedure visible in " + pct(exposure) + ", allowance stops told " + stops(toldRun) + " and none " + stops(noneRun) + ". That means no lift of MDD size, not proof of zero.",
    "FIX-METHOD (task fit)": head + "The primary is at or below zero (" + ci(primary) + "), and " + (sensSet.length < R3B.d1MinTasks ? "only " + sensSet.length + " tasks were solved by any graded grid trial, fewer than " + R3B.d1MinTasks : "the D1 sensitivity contrast is above zero") + ".",
    "FIX-METHOD (power)": head + "Told minus none is " + ci(primary) + ": above zero, with an interval that includes zero.",
    "FIX-METHOD (exposure)": head + "The procedure was visible in " + exposed + " of " + told.length + " graded told grid trials (" + pct(exposure) + "), under 90%.",
    "FIX-METHOD (truncation)": head + pct(share(toldRun)) + " of told sessions ended at the $" + R3B.allowanceUsd + " allowance against " + pct(share(noneRun)) + " of none sessions, more than 5 points apart.",
  }[verdict];
  lines.push(outcomeLine);
  const exit = verdict === "KEEP" ? 0 : verdict === "CUT-CANDIDATE" ? 3 : 5;
  return {
    verdict, exit, lines, record: {
      outcome: verdict, primary, sensitivity: { tasks: sensSet.length, set: sensSet, contrast: sens }, exposure: { exposed, graded_told: told.length, rate: exposure },
      allowance_stops: { told: stops(toldRun), none: stops(noneRun), sessions: { told: toldRun.length, none: noneRun.length }, points_apart: truncation }, pass_rates: rep.passRates, paired_tasks: pairedTasks.length,
      repository_interval: repo, stricter_indicator: phases, stop_hook: hooks, task_repo_skills: rs, cross_model_overlap: overlap, mdd_points: mdd,
    },
  };
}

const nearestRankP95 = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.ceil(0.95 * s.length) - 1]! : null; };

function analyze(work: string, m: R3bItem): number {
  const ledger = process.env.LEDGER ?? "";
  planCheck(work, m);
  const parts = m.parts.map((p) => loadPart(work, p, m));
  const rows = readRows(ledger), t = totals(rows);
  const all = parts.flatMap((p) => p.trials.map((x) => ({ part: p.part.name, ...x })));
  writeFileSync(join(work, "trials.jsonl"), all.map((x) => JSON.stringify(x)).join("\n") + "\n");
  const ledgerLine = m.item + ": settled $" + fromMicros(t.settledMicros).toFixed(2) + " of $" + fromMicros(t.capMicros) + ", open reserves " + t.openIds.length;
  const lines = [ledgerLine];
  const record: Record<string, unknown> = { item: m.item, model: m.id, pin: PIN, ...(m.routePrefix ? { route_check: readRoute(ledger) } : {}), ledger: { cap_usd: fromMicros(t.capMicros), settled_usd: fromMicros(t.settledMicros), open_reserves: t.openIds } };
  const finish = (outcome: string, exit: number) => {
    for (const l of lines) console.log(l);
    writeFileSync(join(work, "record.json"), JSON.stringify({ ...record, outcome, lines }, null, 2) + "\n");
    return exit;
  };
  const re = parts[0]!, g = recheckGate(re.trials), reTold = re.trials.filter((x) => x.outcome !== "infra") as GridTrial[];
  const costs = reTold.map((x) => x.cost_usd).filter((c): c is number => c !== null);
  const rePasses = reTold.filter((x) => x.outcome === "pass").length;
  record.recheck = { ...g, passes: rePasses, cost_per_trial_usd: costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : null, p95_usd: nearestRankP95(costs),
    stop_hook_ran: reTold.filter((x) => x.hooks.stop_hook_ran).length, held_back: reTold.filter((x) => x.hooks.held_back).length };
  lines.push("re-check: " + g.exposed + " of " + g.graded + " graded told trials exposed (" + g.infra + " infra), " + rePasses + " passed (report only); told cost per trial " + (costs.length ? "$" + (costs.reduce((a, b) => a + b, 0) / costs.length).toFixed(2) + ", nearest-rank p95 $" + nearestRankP95(costs)!.toFixed(2) : "n/a") +
    "; Stop hook ran in " + (record.recheck as any).stop_hook_ran + " and held a stop back in " + (record.recheck as any).held_back + " (report only)");
  if (re.stop) {
    lines.push("R3b outcome" + m.tag + ": none (incomplete: " + re.stop.reason + "). FIX-METHOD (harness limits): the re-check is incomplete, so R3b did not run. " + m.incomplete);
    return finish("incomplete", 4);
  }
  if (!g.pass) {
    lines.push(recheckStopLine(m, g));
    lines.push("R3b outcome" + m.tag + ": FIX-METHOD (exposure), beside the R3a4 pilot's 10 of 10 at the old pin. The re-check is not rerun to change a verdict.");
    return finish("recheck-fix-method", 6);
  }
  const stopped = parts.slice(1).find((p) => p.stop);
  if (stopped) {
    lines.push("R3b outcome" + m.tag + ": none (incomplete: " + stopped.stop!.reason + "). FIX-METHOD (" + (stopped.stop!.cost ? "cost limits" : "harness limits") + "). " + m.incomplete);
    return finish("incomplete", 4);
  }
  const grid = parts.slice(1).flatMap((p) => p.trials);
  for (const arm of [NONE, TOLD]) {
    const cell = grid.filter((x) => x.arm === arm), infra = cell.filter((x) => x.outcome === "infra").length;
    if (infra > R3B.infraBound * cell.length) {
      lines.push("R3b outcome" + m.tag + ": none (incomplete: " + infra + " of " + cell.length + " " + arm + " grid trials are infra, over 10%). FIX-METHOD (harness limits). " + m.incomplete);
      return finish("incomplete", 4);
    }
  }
  const repoOf = new Map(loadRebenchPool(join(LANEB, R3A4_POOL_FILE), R3A4_POOL_SHA256).map((x) => [x.task_id, x.repo]));
  const sims = Number(process.env.R3B_MDD_SIMS ?? "2000");
  if (!Number.isInteger(sims) || sims < 1) throw new Error("E_USAGE R3B_MDD_SIMS must be a whole number of simulated runs, 1 or more");
  const out = gridOutcome(grid, m, { sims, repoOf });
  lines.push(...out.lines);
  Object.assign(record, out.record);
  return finish(out.verdict, out.exit);
}

if (import.meta.main) {
  const [cmd, arg, ...rest] = Bun.argv.slice(2);
  try {
    if (cmd === "arm-check") {
      const problems = armCheck(arg ? resolve(arg) : undefined);
      console.log(problems.length ? "arm-check: FAIL " + problems.join("; ") : "arm-check: pass gstack " + PIN + ", told arm tar " + TOLD_TAR_SHA256 + ", Claude Code " + R3B.claudeCode + ", hooks UserPromptSubmit skill-route-hook and Stop skill-contract-stop-hook registered; none.json is arms/manifests/r3/none.json");
      process.exit(problems.length ? 1 : 0);
    }
    if (cmd === "hooks" && arg) { console.log(JSON.stringify(hookState(resolve(arg)))); process.exit(0); }
    const m = rest.length === 2 && rest[0] === "--item" ? R3B4[rest[1]!] : undefined;
    if (!arg || !m || !["prepare", "run", "resume", "analyze"].includes(cmd ?? "")) {
      console.error("E_USAGE usage: bun quick/laneb/r3/r3b.ts arm-check [<manifest dir>] | hooks <trial dir> | prepare|run|resume|analyze <work dir> --item " + Object.keys(R3B4).join("|"));
      process.exit(2);
    }
    if (!process.env.LEDGER) { console.error("E_USAGE set LEDGER to " + m.item + "'s jsonl ledger"); process.exit(2); }
    const work = resolve(arg);
    if (cmd === "prepare") prepare(work, m);
    if (cmd === "run") process.exit(run(work, m));
    if (cmd === "resume") resume(work, m);
    if (cmd === "analyze") process.exit(analyze(work, m));
  } catch (e) {
    const msg = String((e as Error).message ?? e);
    console.error(msg.startsWith("E_USAGE") ? msg : "E_INTERNAL " + msg);
    process.exit(msg.startsWith("E_USAGE") ? 2 : 1);
  }
}
