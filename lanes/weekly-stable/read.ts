// Copyright (c) 2026 Garry Tan. MIT License.
// Step 6 of a week (lanes/weekly-stable/README.md): the session rows, the paired reading, the verdict and FLAG lines, the
// interim look, the public record (weekly.json), the results table gstack's results check reads, and the pilot's and the
// smoke's checks on their own outputs.
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";
import { readSessionRows, rng, sessionsByTrial } from "../../quick/laneb/analysis/analyze.ts";
import { relaunchRects } from "../../quick/laneb/l1/l1.ts";
import { parseLog, type Rec } from "../../quick/laneb/l1/probes.ts";
import { newcombe } from "../delivery-route/analyze.ts";
import { namedOf } from "../delivery-route/b1d.ts";
import { needsRerun } from "../delivery-route/money.ts";
import { b1Row, pulledInputs, type B1Row, type B1TableConfig } from "../delivery-route/table.ts";
import { setOwedReruns } from "./plan.ts";
import { GSTACK_ARMS, MODEL, PILOT, RECORD, S390, SOL_LINE, TASK_SET, WEEKLY, WEEKLY_ARM_NAMES, WEEKLY_ARMS, type GstackArm, type WeeklyArm } from "./pins.ts";

// ---- Session rows: B1's row, plus when the session opened, the arm tar it ran, and exposure.
export type WeeklyRow = Omit<B1Row, "arm"> & {
  arm: WeeklyArm; responded: boolean; opened_at: string | null; tar_sha256: string | null;
  /** Claude Code's init record lists gstack's skills (the "gstack" skill among them); null with no init record. */
  listing: boolean | null; listed: number | null;
  /** Events gstack's routing hook logged, and the skills it routed to; null with no hook log. */
  hook_events: number | null; routed: string[] | null;
  /** Skill tool calls by name, and reads of a SKILL.md under ~/.claude/skills. */
  skill_calls: string[]; skill_reads: number;
};
const blocks = (recs: Rec[]) => recs.filter((r) => r.type === "AssistantMessage").flatMap((r) => (Array.isArray(r.content) ? r.content : [])) as any[];
function armEvent(dir: string): string | null {
  const f = join(dir, "evaluator", "usersim-events.jsonl");
  for (const l of existsSync(f) ? readFileSync(f, "utf8").split("\n") : []) { try { const e = JSON.parse(l); if (e?.event === "arm") return typeof e.tar_sha256 === "string" ? e.tar_sha256 : null; } catch { continue; } }
  return null;
}
export function weeklyRow(dir: string, ctx: Parameters<typeof b1Row>[1]): WeeklyRow | null {
  const row = b1Row(dir, { ...ctx, arms: WEEKLY_ARM_NAMES });
  if (!row) return null;
  const msgs = join(dir, "evaluator", "sdk-messages.jsonl"), recs = existsSync(msgs) ? parseLog(readFileSync(msgs, "utf8")) : [];
  const init = recs.find((r) => r.type === "SystemMessage" && Array.isArray(r.init?.skills))?.init, sessions = ctx.sessions.get(row.trial) ?? [];
  const logFile = join(dir, "evaluator", "gstack-hooks", "hooks", "skill-route.log"), log = existsSync(logFile) ? readFileSync(logFile, "utf8") : null;
  const b = blocks(recs);
  const last: any = sessions.at(-1);
  return {
    ...row, arm: row.arm as WeeklyArm, responded: row.outcome !== "cap_stop" && (last ? (last.ok_responses ?? 0) > 0 : b.length > 0), opened_at: sessions[0]?.opened_at ?? null, tar_sha256: armEvent(dir),
    listing: init ? init.skills.includes("gstack") : null, listed: init ? init.skills.length : null,
    hook_events: log === null ? null : log.split("\n").filter((l) => /\bevent=/.test(l)).length, routed: namedOf(log),
    skill_calls: b.filter((x) => x?.name === "Skill" && x.input).map((x) => String(x.input?.skill ?? "").replace(/^\//, "")),
    skill_reads: b.filter((x) => x?.name === "Read" && x.input && /\/\.claude\/skills\/.+\/SKILL\.md$/.test(String(x.input?.file_path ?? ""))).length,
  };
}
/** A job's L1 part id from L1's folder layout, <part>/pulled/jobs/<job>; null outside that layout. */
const layoutPart = (dir: string) => /([^/]+)\/pulled\/jobs\/[^/]+\/?$/.exec(dir)?.[1] ?? null;
/** Every trial folder under the config's jobs, each job folder read once; one trial found in two folders is refused, so no
 *  session counts twice. Each row's part is L1's part id from the folder layout, else the config's label (pre-run change 4
 *  section 2), so a Harbor job suffix never hides an attempt 2; a job with neither is refused. */
export function buildWeeklyTable(cfg: B1TableConfig): WeeklyRow[] {
  const sessions = sessionsByTrial(readSessionRows(cfg.sessions)), out: WeeklyRow[] = [], jobs = new Set<string>(), trials = new Map<string, string>();
  for (const job of cfg.jobs) {
    if (jobs.has(realpathSync(job.dir))) continue;
    jobs.add(realpathSync(job.dir));
    const part = layoutPart(job.dir) ?? job.part ?? null;
    if (!part) throw new Error("E_USAGE job " + job.dir + " names no L1 part: its path is not <part>/pulled/jobs/<job> and the config gives none");
    for (const name of readdirSync(job.dir).sort()) {
      const d = join(job.dir, name);
      if (!statSync(d).isDirectory()) continue;
      const row = weeklyRow(d, { part, sessions, home: cfg.home ?? "/root" });
      if (!row) continue;
      if (trials.has(row.trial)) throw new Error("E_USAGE trial " + row.trial + " appears twice, in " + trials.get(row.trial) + " and " + d + "; a session is read once");
      trials.set(row.trial, d);
      out.push(row);
    }
  }
  return out;
}
/** Refuses a trial that appears twice in a table, from any source (pre-run change 4 section 7). */
export function uniqueTrials<T extends { trial: string }>(rows: T[], source: string): T[] {
  const seen = new Set<string>();
  for (const r of rows) { if (seen.has(r.trial)) throw new Error("E_USAGE trial " + r.trial + " appears twice in " + source + "; a session is read once"); seen.add(r.trial); }
  return rows;
}
/** Sessions a relaunch replaced (pre-run change 4 section 2): in part P, rows that never opened a proxy session, for a task and
 *  arm that P-relaunch ran, up to the number of rows P-relaunch holds there. L1's relaunch starts one session for each
 *  session that never started, so these are neither first attempts nor owed an attempt 2. */
export function replacedTrials(rows: WeeklyRow[]): Set<string> {
  const key = (p: string, t: string, a: string) => p + "\t" + t + "\t" + a, left = new Map<string, number>(), out = new Set<string>();
  for (const r of rows) if (/-relaunch$/.test(r.part ?? "")) { const k = key(r.part!.slice(0, -"-relaunch".length), r.task, r.arm); left.set(k, (left.get(k) ?? 0) + 1); }
  for (const r of [...rows].sort((a, b) => a.trial.localeCompare(b.trial))) {
    const k = key(r.part ?? "", r.task, r.arm), n = left.get(k) ?? 0;
    if (n > 0 && r.opened_at === null && r.outcome !== "graded") { out.add(r.trial); left.set(k, n - 1); }
  }
  return out;
}
/** An infrastructure session (no model response) reruns once, in a part of its own after its part ends. The pulls of a part
 *  and its relaunch are one table, so one session pulled twice never owes two reruns, and a session the relaunch replaced owes
 *  none. */
export function owed(runs: { part: string; dir: string }[]) {
  const rows = uniqueTrials(runs.flatMap((r) => { const c = pulledInputs(r.dir, r.part); return c.jobs.length ? buildWeeklyTable(c) : []; }), "the attempt-2 planner's pulls of " + runs.map((r) => r.part).join(", ")), gone = replacedTrials(rows), owe = rows.filter((r) => needsRerun(r as unknown as B1Row) && !gone.has(r.trial));
  const n = new Map<string, number>();
  for (const r of owe) n.set(r.task + "\t" + r.arm, (n.get(r.task + "\t" + r.arm) ?? 0) + 1);
  return { owed: owe.map((r) => ({ task: r.task, arm: r.arm, reason: r.reason })), rects: relaunchRects([...n].map(([k, replicates]) => ({ task: k.split("\t")[0]!, arm: k.split("\t")[1]!, replicates }))) };
}
setOwedReruns(owed);

// ---- The paired reading (pre-run change 1 section 5; change 2): a task's graded sessions in each gstack arm are numbered
// from 1 in the order they opened, and candidate session k pairs with stable session k.
const graded = (r: WeeklyRow) => r.outcome === "graded";
const byOpen = (a: WeeklyRow, b: WeeklyRow) => String(a.opened_at ?? "~").localeCompare(String(b.opened_at ?? "~")) || a.trial.localeCompare(b.trial);
export const gradedOf = (rows: WeeklyRow[], task: string, arm: WeeklyArm) => rows.filter((r) => r.task === task && r.arm === arm && graded(r)).sort(byOpen);
export type Pair = { task: string; k: number; c: number; s: number };
export function pairsOf(rows: WeeklyRow[], tasks: string[]): Pair[] {
  const out: Pair[] = [];
  for (const t of tasks) { const c = gradedOf(rows, t, "candidate"), s = gradedOf(rows, t, "stable"); for (let k = 0; k < Math.min(c.length, s.length); k++) out.push({ task: t, k: k + 1, c: c[k]!.pass ? 1 : 0, s: s[k]!.pass ? 1 : 0 }); }
  return out;
}
export type Stat = { n: number; tasks: number; d: number; se: number; z: number; lo: number; hi: number; bound: number; disagree: number; rho: number | null; mdd: number };
/** Candidate minus stable over pairs, with the preregistration's cluster-robust variance by task:
 *  V = G/(G-1) x sum over tasks of (s_g - n_g D)^2 / N^2, and the interval D +/- bound x sqrt(V). */
export function clusterStat(pairs: Pair[], bound: number): Stat {
  const N = pairs.length, by = new Map<string, { s: number; n: number }>();
  for (const p of pairs) { const g = by.get(p.task) ?? { s: 0, n: 0 }; g.s += p.c - p.s; g.n++; by.set(p.task, g); }
  const G = by.size, D = N ? pairs.reduce((x, p) => x + p.c - p.s, 0) / N : 0;
  const V = G > 1 ? (G / (G - 1)) * [...by.values()].reduce((x, g) => x + (g.s - g.n * D) ** 2, 0) / (N * N) : NaN, se = Math.sqrt(V);
  const iid = N > 1 ? pairs.reduce((x, p) => x + (p.c - p.s - D) ** 2, 0) / (N - 1) / N : NaN, m = N / G;
  const rho = iid > 0 && m > 1 ? (V / iid - 1) / (m - 1) : null;
  return { n: N, tasks: G, d: D, se, z: se > 0 ? D / se : se === 0 && D !== 0 ? Math.sign(D) * Infinity : 0, lo: D - bound * se, hi: D + bound * se, bound, disagree: N ? pairs.filter((p) => p.c !== p.s).length / N : 0, rho, mdd: (S390.zEnd + S390.zPower) * se };
}
/** A stop or a verdict (pre-run change 4 section 1): HOLD when the interval at bound SE lies wholly below 0, GAIN when it
 *  lies wholly above. Both tests are strict, so a z of exactly the bound is neither, as gstack's HOLD check (hi below 0) reads it. */
export function beyond(d: number, se: number, bound: number): "HOLD" | "GAIN" | null {
  return d + bound * se < 0 ? "HOLD" : d - bound * se > 0 ? "GAIN" : null;
}
/** Candidate minus none: each task's first graded candidate session against its none session, Newcombe's 95% interval. */
export function vsNone(rows: WeeklyRow[], tasks: string[]) {
  let a = 0, b = 0, c = 0, d = 0;
  for (const t of tasks) { const x = gradedOf(rows, t, "candidate")[0], y = gradedOf(rows, t, "none")[0]; if (!x || !y) continue; if (x.pass && y.pass) a++; else if (x.pass) b++; else if (y.pass) c++; else d++; }
  return { pairs: a + b + c + d, ...newcombe(a, b, c, d) };
}
/** The cost ratio, candidate over stable: the geometric mean over tasks of the ratio of each arm's mean dollars per graded
 *  session, with a 95% bootstrap interval over tasks (10,000 resamples, L1's generator seeded with the week's seed). */
export function costRatio(rows: WeeklyRow[], tasks: string[], seed: number, resamples: number = S390.bootstrap) {
  const mean = (xs: WeeklyRow[]) => xs.reduce((x, r) => x + (r.cost_usd ?? 0), 0) / xs.length;
  const logs = tasks.flatMap((t) => { const c = gradedOf(rows, t, "candidate").filter((r) => (r.cost_usd ?? 0) > 0), s = gradedOf(rows, t, "stable").filter((r) => (r.cost_usd ?? 0) > 0); return c.length && s.length ? [Math.log(mean(c) / mean(s))] : []; });
  if (!logs.length) return null;
  const r = rng(seed), means: number[] = [];
  for (let i = 0; i < resamples; i++) { let x = 0; for (let j = 0; j < logs.length; j++) x += logs[Math.floor(r() * logs.length)]!; means.push(x / logs.length); }
  means.sort((x, y) => x - y);
  return { tasks: logs.length, ratio: Math.exp(logs.reduce((x, y) => x + y, 0) / logs.length), lo: Math.exp(means[Math.floor(0.025 * resamples)]!), hi: Math.exp(means[Math.ceil(0.975 * resamples) - 1]!) };
}

// ---- The interim look (pre-run change 1 section 5, change 4 sections 1 and 2): the first 65 tasks in run order, once every
// arm of each has settled. It prints STOP or CONTINUE and no estimate.
const attempt2 = (r: WeeklyRow) => /-a2$/.test(r.part ?? "");
/** Each arm of these tasks that has not settled: fewer first-attempt sessions than planned, or a session with no response
 *  whose attempt-2 row has not arrived. A first-attempt cap stop owes no rerun, so it settles its arm; a session a relaunch
 *  replaced is not counted, and the relaunch's row stands in its place. */
export function openCells(rows: WeeklyRow[], tasks: string[]): string[] {
  const gone = replacedTrials(rows);
  return tasks.flatMap((t) => WEEKLY_ARM_NAMES.flatMap((a) => {
    const mine = rows.filter((r) => r.task === t && r.arm === a && !gone.has(r.trial)), first = mine.filter((r) => !attempt2(r)), owe = first.filter((r) => needsRerun(r as unknown as B1Row)).length, ran = mine.length - first.length;
    if (first.length < WEEKLY_ARMS[a].sessions) return [t + " " + a + ": " + first.length + " of " + WEEKLY_ARMS[a].sessions + " sessions"];
    return ran < owe ? [t + " " + a + ": " + owe + " attempt 2 owed, " + ran + " ran"] : [];
  }));
}
export function look(rows: WeeklyRow[], run: string[], dropped: string[]) {
  const tasks = run.slice(0, S390.look.tasks).filter((t) => !dropped.includes(t)), open = openCells(rows, tasks);
  if (open.length) return { ready: false as const, stop: null, stat: null, tasks, open };
  const stat = clusterStat(pairsOf(rows, tasks), S390.look.z);
  return { ready: true as const, stop: beyond(stat.d, stat.se, S390.look.z), stat, tasks, open };
}

// ---- The week's verdict and record.
export type Verdict = "HOLD" | "GAIN" | "NO_CHANGE" | "INCOMPLETE";
export type WeekInput = {
  rows: WeeklyRow[]; run: string[]; dropped: string[]; seed: number;
  /** Reasons the week is INCOMPLETE before any reading: a gstack arm's ./setup failed, the smoke failed for a rig reason,
   *  the results check refused, and the like. */
  incomplete: string[];
  /** FLAG lines decided outside the reading: an exposure change the smoke saw, a bridge week. */
  flags: string[];
  /** The look's stop, when the week stopped there. */
  stoppedAt: "HOLD" | "GAIN" | null;
};
const pts = (x: number) => 100 * x;
const f1 = (x: number) => (x >= 0 ? "+" : "") + x.toFixed(1);
/** The week's reading. After a stop at the look, every count and statistic reads only the look's 65 tasks: sessions still
 *  queued for the other tasks are never read (pre-run change 2, section 2). */
export function reading(w: WeekInput) {
  const early = w.stoppedAt !== null, kept = w.run.slice(0, early ? S390.look.tasks : w.run.length).filter((t) => !w.dropped.includes(t)), why = [...w.incomplete], flags = [...w.flags];
  const rows = w.rows.filter((r) => kept.includes(r.task));
  if (w.dropped.length > S390.maxDropped) why.push("the contamination check dropped " + w.dropped.length + " tasks, more than " + S390.maxDropped);
  const capStop = rows.some((r) => r.outcome === "cap_stop");
  if (capStop) why.push("a ledger item hit a cap stop");
  const share = kept.length / w.run.filter((t) => !w.dropped.includes(t)).length;
  const ungraded = Object.fromEntries(WEEKLY_ARM_NAMES.map((a) => [a, kept.reduce((x, t) => x + Math.max(0, WEEKLY_ARMS[a].sessions - gradedOf(rows, t, a).length), 0)])) as Record<WeeklyArm, number>;
  for (const a of WEEKLY_ARM_NAMES) { const max = Math.floor(S390.maxUngraded[a] * (early ? share : 1)); if (ungraded[a] > max) why.push(a + " has " + ungraded[a] + " of " + kept.length * WEEKLY_ARMS[a].sessions + " sessions ungraded, more than " + max); }
  const stat = clusterStat(pairsOf(rows, kept), early ? S390.look.z : S390.zEnd);
  const none = vsNone(rows, kept), cost = costRatio(rows, kept, w.seed);
  const safety = Object.fromEntries(WEEKLY_ARM_NAMES.map((a) => [a, rows.filter((r) => r.arm === a && r.safety_stop).length])) as Record<WeeklyArm, number>;
  let verdict: Verdict = why.length ? "INCOMPLETE" : beyond(stat.d, stat.se, stat.bound) ?? "NO_CHANGE";
  if (!why.length && early && verdict !== w.stoppedAt) why.push("the look stopped for " + w.stoppedAt + " but the rows read " + verdict), verdict = "INCOMPLETE";
  if (verdict !== "INCOMPLETE") {
    if (stat.d <= -S390.mddPoints / 100 && stat.lo < 0 && stat.hi > 0) flags.push("candidate minus stable is " + f1(pts(stat.d)) + " points, at or below minus the planned MDD of " + S390.mddPoints + ", while its interval crosses 0");
    if (none.hi < 0) flags.push("candidate minus none is " + f1(pts(none.diff)) + " points [" + f1(pts(none.lo)) + ", " + f1(pts(none.hi)) + "], wholly below 0");
    if (cost && cost.lo > 1 && cost.ratio >= S390.costFlag) flags.push("the candidate costs " + cost.ratio.toFixed(2) + "x stable [" + cost.lo.toFixed(2) + ", " + cost.hi.toFixed(2) + "] per session");
    if (Math.abs(safety.candidate - safety.stable) >= S390.safetyFlag) flags.push("provider safety stops: candidate " + safety.candidate + ", stable " + safety.stable);
    if (stat.hi < 0) flags.push("area " + TASK_SET.area + ": " + f1(pts(stat.d)) + " points [" + f1(pts(stat.lo)) + ", " + f1(pts(stat.hi)) + "], wholly below 0");
  }
  if (capStop && cost) flags.push("the cost ratio covers only the tasks that finished before the cap stop, which lean toward cheaper sessions");
  flags.push(SOL_LINE);
  return { verdict, incomplete_reason: why.length ? why.join("; ") : null, stopped_early: early, stat, none, cost, safety, ungraded, flags, kept: kept.length };
}
export type Reading = ReturnType<typeof reading>;

export type RecordInput = { week: string; candidate: string; stable: { tag: string; sha: string }; window: { start: string; end: string }; results_check: string; results: string; run: string; supersedes?: string | null };
/** The public record, schema 1 of GStack Minder's Q16. Numbers are in points, unrounded, so gstack's HOLD recomputation
 *  from the model row (hi below 0) always agrees with the verdict; an INCOMPLETE week carries no model row, area or
 *  realized figure, so it can never recompute as a HOLD (its partial numbers stay in the private report). stale_after
 *  dates the verdict and the FLAG lines 9 days after the run started; a HOLD has none, because it stands until a later
 *  candidate's record replaces it (GStack Minder, 2026-11-22). No task id, repository name or task text. */
export function weekRecord(r: Reading | null, o: RecordInput, verdict: Verdict = r?.verdict ?? "INCOMPLETE", reason: string | null = r?.incomplete_reason ?? null) {
  const ran = r !== null && r.stat.n > 0 && verdict !== "INCOMPLETE", start = Date.parse(o.window.start);
  if (!Number.isFinite(start)) throw new Error("E_USAGE the record's window.start " + o.window.start + " is not an ISO time");
  const stale = new Date(start + WEEKLY.staleDays * 86_400_000).toISOString();
  return {
    schema: RECORD.schema, week: o.week, task_set: TASK_SET.record, candidate: { sha: o.candidate }, stable: o.stable, window: o.window, verdict,
    mdd_points: S390.mddPoints, interval: RECORD.interval,
    models: ran ? { [MODEL.id]: { host: MODEL.host, n: r!.stat.n, d: pts(r!.stat.d), lo: pts(r!.stat.lo), hi: pts(r!.stat.hi), vs_none: { d: pts(r!.none.diff), lo: pts(r!.none.lo), hi: pts(r!.none.hi) } } } : {},
    areas: ran ? [{ name: TASK_SET.area, model: MODEL.id, d: pts(r!.stat.d), lo: pts(r!.stat.lo), hi: pts(r!.stat.hi) }] : [],
    flags: r?.flags ?? [SOL_LINE], incomplete_reason: verdict === "INCOMPLETE" ? reason : null,
    stopped_early: r?.stopped_early ?? false,
    stale_after: { verdict: verdict === "HOLD" ? null : stale, flags: stale },
    realized: ran ? { disagreement: r!.stat.disagree, rho: r!.stat.rho, mdd_points: pts(r!.stat.mdd) } : null,
    results_check: o.results_check, prereg: RECORD.prereg, results: o.results, run: o.run,
    ...(o.supersedes ? { supersedes: o.supersedes } : {}),
  };
}
/** gstack's own recomputation of HOLD (Q17): any model row whose interval lies wholly below 0. */
export const recomputedHold = (rec: ReturnType<typeof weekRecord>) => Object.values(rec.models).some((m) => m.hi < 0);

/** The table gstack-eval-plan results --check reads: one row per Arms identity in change 2's eval-plan.md. */
export const ARM_IDS: Record<WeeklyArm, string> = { candidate: MODEL.id + "#candidate", stable: MODEL.id + "#stable", none: MODEL.id + "#no-gstack" };
export function resultsMarkdown(rows: WeeklyRow[], kept: string[], title: string): string {
  const line = (a: WeeklyArm) => { const g = kept.flatMap((t) => gradedOf(rows, t, a)), planned = kept.length * WEEKLY_ARMS[a].sessions; return "| `" + ARM_IDS[a] + "` | " + g.length + " of " + planned + " | " + g.filter((r) => r.pass).length + " of " + g.length + " | $" + rows.filter((r) => r.arm === a).reduce((x, r) => x + (r.cost_usd ?? 0), 0).toFixed(2) + " |"; };
  return "# " + title + "\n\n| Arm | Sessions graded | Passes | Metered cost |\n|---|---|---|---|\n" + WEEKLY_ARM_NAMES.map(line).join("\n") + "\n";
}

// ---- The pilot (R111) and the weekly smoke, on their own outputs.
export type ArmTars = Record<WeeklyArm, string>;
function partRan(rows: WeeklyRow[], arm: WeeklyArm, tars: ArmTars, tasks: string[]) {
  const why: string[] = [], supply: string[] = [], exposure: string[] = [];
  for (const t of tasks) {
    const all = rows.filter((r) => r.arm === arm && r.task === t), g = all.filter(graded);
    if (g.length !== 1) { supply.push(t + " has " + g.length + " graded sessions (" + all.map((r) => r.reason).join("; ") + ")"); continue; }
    const r = g[0]!;
    if (r.tar_sha256 !== tars[arm]) why.push(t + ": the session's arm tar is " + r.tar_sha256 + ", not " + tars[arm]);
    if (arm === "none") {
      if (r.audit_hits.length) why.push(t + ": the read audit has " + r.audit_hits.length + " hits (" + r.audit_hits.slice(0, 3).join(", ") + ")");
      if (r.listing !== false) why.push(t + ": the init record " + (r.listing === null ? "is missing" : "lists gstack"));
      if (r.hook_events !== null) why.push(t + ": a gstack hook log exists in a none session");
    } else {
      if (r.listing !== true) exposure.push(t + ": gstack's skill listing " + (r.listing === null ? "has no init record" : "did not reach the model"));
      if (!r.hook_events) exposure.push(t + ": gstack's routing hook logged " + (r.hook_events === null ? "nothing (no log)" : "no event"));
      if (r.audit_hits.length) why.push(t + ": the read audit has " + r.audit_hits.length + " hits outside gstack's own folders");
    }
  }
  return { why, supply, exposure };
}
/** Each arm: every pilot task graded once (supply), its tar the manifest's, its exposure as planned (gstack arms: listing
 *  reached the model and the hook logged an event; none: no gstack in the listing, no hook log, no audit hit), and its
 *  settled spend at or under its pilot cap. Telemetry off is checked on the built tree (arms check). */
export function pilotCheck(rows: WeeklyRow[], tars: ArmTars, tasks: string[]) {
  const lines: string[] = [], failed: string[] = [];
  for (const arm of WEEKLY_ARM_NAMES) {
    const p = partRan(rows, arm, tars, tasks), spent = rows.filter((r) => r.arm === arm).reduce((x, r) => x + (r.cost_usd ?? 0), 0), cap = PILOT.settleCaps[arm];
    const why = [...p.why, ...p.exposure, ...p.supply.map((s) => "supply: " + s), ...(spent > cap ? ["settled $" + spent.toFixed(2) + ", above its pilot cap $" + cap] : [])];
    if (why.length) failed.push(arm);
    lines.push("  pilot " + (why.length ? "FAIL " + arm + ": " + why.join("; ") : "PASS " + arm + ": " + tasks.length + " graded, tar " + tars[arm].slice(0, 12) + ", settled $" + spent.toFixed(2) + " of $" + cap));
  }
  return { lines, failed };
}
/** The weekly smoke on the candidate: a session that did not grade or ran the wrong tar is a rig failure (INCOMPLETE); a
 *  missing listing or hook event, on a tree that passed its build checks, is the release's own change (a FLAG). rig and
 *  detail name tasks and stay in the private report; flag is the public line and names none. */
export function smokeCheck(rows: WeeklyRow[], tars: ArmTars, tasks: string[]) {
  const p = partRan(rows.filter((r) => r.arm === "candidate"), "candidate", tars, tasks), n = (re: RegExp) => p.exposure.filter((x) => re.test(x)).length;
  const parts = [[n(/skill listing/), "gstack's skill listing did not reach the model"], [n(/routing hook/), "gstack's routing hook logged no event"]].filter(([k]) => k).map(([k, what]) => what + " in " + k + " of " + tasks.length + " smoke sessions");
  return { rig: [...p.why, ...p.supply], flag: parts.length ? "exposure changed: " + parts.join("; ") : null, detail: p.exposure };
}
export const isGstackArm = (a: string): a is GstackArm => (GSTACK_ARMS as readonly string[]).includes(a);
