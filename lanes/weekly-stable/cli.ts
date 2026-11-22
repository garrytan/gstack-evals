// Copyright (c) 2026 Garry Tan. MIT License.
// gstack-evals weekly <command>: the weekly stable number (lanes/weekly-stable/README.md walks a week through these in order).
// prepare, host-up, launch, attach, relaunch, rerun, recover and host-down run on L1's host and part machinery under the
// week's profile (plan.ts profileFor), with L1's exit codes; host-up, launch and relaunch pass the launch guard first.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { L1, l1Main, type PartPlan } from "../../quick/laneb/l1/l1.ts";
import { readRows, type Row } from "../../quick/laneb/runner/ledger.ts";
import { ARMS_DIR, armsCheck, contaminationSearch, manifestDir, writeManifests } from "./arms.ts";
import { approve, baseOf, guard, isoWeek, markDone, partItems, profileFor, projection, taskLists, weekBase, weekPlan, weekSeed, type WeekState } from "./plan.ts";
import { CHANGE2, GSTACK_ARMS, isItem, PILOT, RECORD, REPO, S390, WEEK_ITEM, WEEKLY, WEEKLY_ARM_NAMES, type GstackArm, type WeeklyArm } from "./pins.ts";
import { buildWeeklyTable, look, pilotCheck, reading, resultsMarkdown, smokeCheck, weekRecord, type Verdict, type WeeklyRow } from "./read.ts";
import { byWeekDesc, decide, resolveWeek, standingHold, type Decision, type Held } from "./resolve.ts";

const usage = (m: string): never => { throw new Error("E_USAGE " + m); };
const USAGE = "usage: weekly resolve <work> [--now <iso>] [--remeasure <n> --week <YYYY-MM-DD>] | build <work> | arms manifest|check <work> | contamination <work> | plan <work> | approve --ledger <jsonl> --item <item> --usd <cap> --approved-by <who> | done --ledger <jsonl> --item <item> | guard <part-work> | prepare <part-work> --item <item> | host-up|attach|recover|host-down <part-work> | launch|relaunch|rerun <part-work> --part <part> | table <config.json> <out.jsonl> | smoke <table.jsonl> <work> | look <table.jsonl> <work> | pilot-report <table.jsonl> [--out <dir>] | report <table.jsonl> <work> --out <dir> [--stopped HOLD|GAIN] [--incomplete <why>]... [--flag <line>]... | record <work> --out <dir> | publish <out> [--dry-run]";
const LAUNCHER = ["prepare", "host-up", "launch", "attach", "relaunch", "rerun", "recover", "host-down"], GUARDED = ["host-up", "launch", "relaunch"];
const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const writeJson = (p: string, v: unknown) => writeFileSync(p, JSON.stringify(v, null, 2) + "\n");
export type GhRun = (args: string[]) => { status: number | null; stdout: string; stderr: string };
const gh: GhRun = (args) => spawnSync("gh", args, { encoding: "utf8", maxBuffer: 64 << 20 });

export type WeekFile = WeekState & {
  week_of?: string | null; start: string; decision: Decision; held: Held | null; setup_failed: GstackArm[]; contamination: Record<string, string[]> | null; smoke: { rig: string[]; flag: string | null; detail: string[] } | null;
  /** The arms check that passed for this week, with each arm's tar digest; the report reads only sessions on these tars. */
  arms?: { pass: true; tars: Record<WeeklyArm, string> } | null;
  /** The look, recorded the one time it ran. */
  look?: { stop: "HOLD" | "GAIN" | null; at: string; trials?: string[] } | null;
};
const weekFile = (work: string) => join(work, "week.json");
export const readWeek = (work: string): WeekFile => (existsSync(weekFile(work)) ? readJson(weekFile(work)) : usage(work + " has no week.json; run weekly resolve first"));
const shasOf = (w: WeekFile): Record<GstackArm, string> => ({ candidate: w.candidate, stable: w.stable });
const VERDICTS = ["HOLD", "GAIN", "NO_CHANGE", "INCOMPLETE"];

/** What a counted launch needs first (pre-run change 3): the arms check and the contamination search for the smoke; for any
 *  other part, also a smoke with no rig failure. */
export function launchGate(w: WeekFile, part: string): string[] {
  const why: string[] = [];
  if (!w.arms?.pass) why.push("the arms check has not passed for this week; run weekly arms check");
  if (w.contamination === null) why.push("the contamination search has not run; run weekly contamination");
  if (!part.startsWith("smoke") && (!w.smoke || w.smoke.rig.length)) why.push(w.smoke ? "the smoke failed for a rig reason, so no counted part runs" : "the smoke has not been read; run weekly smoke first");
  return why;
}
/** The weekly thread's meter: {as_of, usd}, read no more than an hour after as_of. */
export function meterReading(file: string, now: number): number {
  const m = readJson(file), at = Date.parse(m?.as_of);
  if (!Number.isFinite(at)) return usage("weekly launch guard: the meter file needs as_of, the ISO time cost.dollars was read");
  if (at > now + 5 * 60_000) return usage("weekly launch guard: the meter's as_of " + m.as_of + " is in the future");
  if (now - at > WEEKLY.meterMaxAgeMinutes * 60_000) return usage("weekly launch guard: the meter reading from " + m.as_of + " is older than " + WEEKLY.meterMaxAgeMinutes + " minutes; rewrite it from cost.dollars");
  if (typeof m.usd !== "number" || !(m.usd >= 0)) return usage("weekly launch guard: the meter file needs usd, a number of at least 0");
  return m.usd;
}
/** The tasks a report counts and their rows: the run's tasks less those dropped, only the look's after a stop; the smoke's
 *  sessions and dropped tasks never count. */
export function reportRows(w: WeekFile, rows: WeeklyRow[], stopped: "HOLD" | "GAIN" | undefined) {
  const run = taskLists().run, kept = run.slice(0, stopped ? S390.look.tasks : run.length).filter((t) => !w.dropped.includes(t));
  return { kept, rows: rows.filter((r) => kept.includes(r.task)) };
}
export function tableGate(w: WeekFile, rows: WeeklyRow[]): string[] {
  const why: string[] = [];
  if (w.contamination === null) why.push("the contamination search has not run for this week");
  if (!w.arms?.pass) why.push("the arms check has not passed for this week");
  else { const off = rows.filter((r) => r.outcome === "graded" && r.tar_sha256 !== w.arms!.tars[r.arm]); if (off.length) why.push(off.length + " graded session" + (off.length === 1 ? "" : "s") + " ran a tar that is not this week's " + off[0]!.arm + " arm; the table is not this week's"); }
  return why;
}
export function reportGate(w: WeekFile, rows: WeeklyRow[], stopped: "HOLD" | "GAIN" | undefined): string[] {
  const why = tableGate(w, rows);
  if (w.look?.stop && stopped !== w.look.stop) why.push("the look stopped for " + w.look.stop + " at " + w.look.at + "; report with --stopped " + w.look.stop);
  else if (stopped && !w.look?.stop) why.push("--stopped " + stopped + " but no look recorded a stop");
  else if (stopped) {
    if (!Array.isArray(w.look?.trials) || !w.look.trials.length) why.push("the stopped look has no recorded trials");
    else {
      const seen = new Set(rows.map((r) => r.trial));
      if (w.look.trials.some((t) => !seen.has(t))) why.push("the table is missing a recorded trial from the stopped look");
      if (seen.size !== rows.length) why.push("the stopped table contains a duplicate trial");
    }
  }
  return why;
}
/** Records the look's one reading; a look that is not ready records nothing. */
export function recordLook(w: WeekFile, l: { ready: boolean; stop: "HOLD" | "GAIN" | null }, at: string, trials: string[]): boolean {
  if (w.look) return usage("the look already ran at " + w.look.at + " (" + (w.look.stop ?? "CONTINUE") + "); it runs once");
  if (!l.ready) return false;
  w.look = { stop: l.stop, at, ...(l.stop ? { trials } : {}) };
  return true;
}
/** Cap stops in any part's result files (W/p1..p3/<part>.result.json). */
export function partCapStops(work: string): string[] {
  return ["p1", "p2", "p3"].flatMap((p) => (existsSync(join(work, p)) ? readdirSync(join(work, p)).filter((f) => f.endsWith(".result.json")).sort() : []).flatMap((f) => {
    const cap = readJson(join(work, p, f)).cap_stop;
    return Array.isArray(cap) ? cap.map((c: string) => p + "/" + f.slice(0, -".result.json".length) + ": " + c) : [p + "/" + f + " has no cap_stop list, so a cap stop can't be ruled out"];
  }));
}
export function capStopReason(caps: string[]): string[] {
  return caps.length ? ["a part ended at a cap stop (" + caps.length + " cap-stop line" + (caps.length === 1 ? "" : "s") + " across parts; detail in the private report)"] : [];
}
/** The release create command, with GitHub's latest pointer only on the newest week; a release list that fails or isn't JSON
 *  is an error, never an empty list. */
export function publishArgs(p: { tag: string; week: string; verdict: string }, rec: { candidate: { sha: string }; stable: { tag: string } }, out: string, run: GhRun = gh): { args: string[] } | { error: string } {
  const list = run(["release", "list", "--repo", RECORD.repo, "--limit", "200", "--json", "tagName"]);
  if (list.status !== 0) return { error: "gh release list failed: " + (list.stderr ?? "").trim().slice(0, 200) };
  let tags: string[];
  try { tags = (JSON.parse(list.stdout) as { tagName: string }[]).map((x) => x.tagName).filter((t) => /^weekly-\d{4}-w\d{2}/.test(t)); } catch { return { error: "gh release list did not return JSON" }; }
  if (tags.includes(p.tag)) return { error: "release " + p.tag + " exists; a published record is never edited, so a correction takes the next -r<k> tag" };
  const latest = !tags.some((t) => t.slice(0, 15) > p.tag.slice(0, 15));
  return { args: ["release", "create", p.tag, join(out, RECORD.asset), "--repo", RECORD.repo, "--title", "gstack weekly benchmark " + p.week + ": " + p.verdict, "--notes", "gstack's release candidate " + rec.candidate.sha.slice(0, 12) + " against stable " + rec.stable.tag + ", Claude Opus 5.5 in Claude Code: " + p.verdict + ". The record is weekly.json, schema 1.", "--latest=" + latest] };
}

/** The HOLD that stands, read from every published weekly record ordered by run start (window.start), newest first, ties
 *  by tag, past any INCOMPLETE ones. A read error, or a record whose run start is not a time, returns error, so the week is
 *  INCOMPLETE; a repository with no weekly record has no HOLD. */
export function latestHold(run: GhRun = gh): { held: Held | null } | { error: string } {
  const list = run(["release", "list", "--repo", RECORD.repo, "--limit", "200", "--json", "tagName"]);
  if (list.status !== 0) return { error: "gh release list failed: " + (list.stderr ?? "").trim().slice(0, 200) };
  let listed: { tagName: string }[];
  try { listed = JSON.parse(list.stdout); } catch { return { error: "gh release list did not return JSON: " + list.stdout.trim().slice(0, 200) }; }
  const recs: { tag: string; start: number; rec: { verdict: string; week: string; candidate: { sha: string } } }[] = [];
  for (const tag of listed.map((x) => x.tagName).filter((t) => /^weekly-\d{4}-w\d{2}(-r\d+)?$/.test(t))) {
    const d = run(["release", "download", tag, "--repo", RECORD.repo, "-p", RECORD.asset, "-O", "-"]);
    if (d.status !== 0) return { error: "gh release download " + tag + " failed: " + (d.stderr ?? "").trim().slice(0, 200) };
    let rec;
    try { rec = JSON.parse(d.stdout); } catch { return { error: tag + "'s " + RECORD.asset + " is not JSON" }; }
    if (!VERDICTS.includes(rec?.verdict)) return { error: tag + "'s verdict " + rec?.verdict + " is not HOLD, GAIN, NO_CHANGE or INCOMPLETE" };
    const start = Date.parse(rec?.window?.start);
    if (!Number.isFinite(start)) return { error: tag + "'s window.start is not a time" };
    recs.push({ tag, start, rec });
  }
  return { held: standingHold(recs.sort((a, b) => b.start - a.start || byWeekDesc(a.tag, b.tag)).map((x) => x.rec)) };
}
function rowsOf(path: string): WeeklyRow[] { return readFileSync(path, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)); }
const tarShas = () => Object.fromEntries(WEEKLY_ARM_NAMES.map((a) => [a, readJson(join(manifestDir(), a + ".json")).tar.sha256])) as Record<WeeklyArm, string>;

/** A part work dir's plan, its parts with any prepared attempt 2 or relaunch, and those finished (a result written). */
function partState(work: string, relaunching?: string) {
  const plan = readJson(join(work, "plan.json")), prepared = (plan.parts as PartPlan[]).flatMap((p) => [p.name + "-a2", p.name + "-relaunch"]).map((n) => join(work, n, "l1-part.json")).filter((x) => existsSync(x)).map((x) => readJson(x) as PartPlan);
  const parts = [...plan.parts, ...prepared];
  return { item: String(plan.item), parts, finished: parts.map((p) => p.name).filter((n) => n !== relaunching && existsSync(join(work, n + ".result.json"))) };
}
const ledgerOf = (work: string, item: string, own?: string) => {
  const dir = process.env.WEEKLY_LEDGERS ?? "", mirror = join(work, "host/ledger.jsonl");
  return own && existsSync(own) ? readRows(own) : existsSync(mirror) ? readRows(mirror) : dir && existsSync(join(dir, item + ".jsonl")) ? readRows(join(dir, item + ".jsonl")) : [];
};
/** The launch guard's inputs: this part's plan and ledger (LEDGER, else the host mirror), each sibling part's (W/p<k>, its
 *  mirror or WEEKLY_LEDGERS/<item>.jsonl; an unprepared part counts at its full plan), and WEEKLY_METER, a file
 *  {as_of, usd} written from this thread's cost.dollars. */
function guardWork(work: string, relaunching?: string) {
  const me = partState(work, relaunching), ledgers: Record<string, Row[]> = { [me.item]: ledgerOf(work, me.item, process.env.LEDGER) }, plans: Record<string, { parts: PartPlan[]; finished: string[] }> = { [me.item]: me };
  let meter = 0;
  if (me.item !== PILOT.item) {
    const w = readWeek(dirname(work)), l = taskLists(), meterFile = process.env.WEEKLY_METER ?? "";
    if (!meterFile || !existsSync(meterFile)) usage("weekly launch guard: set WEEKLY_METER to a file {as_of, usd} written from this thread's cost.dollars");
    meter = meterReading(meterFile, Date.now());
    partItems(baseOf(me.item)).forEach((item, i) => {
      if (item === me.item) return;
      const dir = join(dirname(work), "p" + (i + 1));
      plans[item] = existsSync(join(dir, "plan.json")) ? partState(dir) : { parts: weekPlan(item, l.run, l.pilot, w.dropped, w.seed), finished: [] };
      ledgers[item] = ledgerOf(dir, item);
    });
  }
  const g = guard(me.item, ledgers, plans, meter, relaunching);
  for (const l of g.lines) console.log(l);
  if (!g.ok) throw new Error("E_WEEKLY_LAUNCH " + me.item + ": " + g.why.join("; ") + "; take it to the Captain before launching");
}

function resultsCheck(work: string, out: string): string {
  const clone = join(work, "gstack-clone"), plan = join(REPO, CHANGE2, "eval-plan.md");
  if (!existsSync(join(clone, "bin/gstack-eval-plan"))) return "not run: no gstack clone at " + clone;
  const r = spawnSync(process.execPath, [join(clone, "bin/gstack-eval-plan"), "results", "--check", plan, join(out, "results.md")], { cwd: clone, encoding: "utf8" });
  writeFileSync(join(out, "results-check.txt"), (r.stdout ?? "") + (r.stderr ?? ""));
  return r.status === 0 ? "pass" : "fail: " + ((r.stdout ?? "").trim().split("\n")[0] ?? "") + " " + ((r.stderr ?? "").trim().split("\n")[0] ?? "");
}
export function recordInput(w: WeekFile, check: string) {
  const head = spawnSync("git", ["-C", REPO, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim(), wk = isoWeek(w.week_of ?? w.date), suffix = w.base.slice(("ws-" + w.date).length);
  const tag = wk.tag + suffix, stable = w.decision.stable ?? { tag: "none", sha: w.stable || "0".repeat(40) };
  return { tag, input: { week: wk.label, candidate: w.candidate || stable.sha, stable, window: { start: w.start, end: new Date().toISOString() }, results_check: check, results: "https://github.com/" + RECORD.repo + "/releases/tag/" + tag, run: "https://github.com/" + RECORD.repo + "/tree/" + head + "/lanes/weekly-stable", supersedes: suffix ? (suffix === "-r1" ? wk.tag : wk.tag + "-r" + (Number(suffix.slice(2)) - 1)) : null } };
}
const pageRow = (w: WeekFile, rec: ReturnType<typeof weekRecord>) => { const m = Object.values(rec.models)[0]; return "| " + rec.week + " | " + (w.stable_tag || "-") + " " + (w.stable ? w.stable.slice(0, 12) : "-") + " | " + (w.candidate ? w.candidate.slice(0, 12) : "-") + " | " + rec.verdict + (rec.stopped_early ? " (stopped at the look)" : "") + " | " + (m ? m.d.toFixed(1) + " [" + m.lo.toFixed(1) + ", " + m.hi.toFixed(1) + "] on " + m.n + " pairs; vs none " + m.vs_none.d.toFixed(1) + " [" + m.vs_none.lo.toFixed(1) + ", " + m.vs_none.hi.toFixed(1) + "]" : rec.incomplete_reason ?? "-") + " | " + rec.flags.length + " flags |"; };

export async function main(argv: string[]): Promise<number> {
  try { return await run(argv); } catch (e) {
    const m = (e as Error).message;
    console.error(m.startsWith("E_") ? m : "E_INTERNAL " + m);
    return m.startsWith("E_") ? 2 : 1;
  }
}
async function run(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv, opt = (k: string) => { const i = rest.indexOf("--" + k); return i >= 0 ? rest[i + 1] : undefined; };
  const opts = (k: string) => rest.flatMap((x, i) => (x === "--" + k && rest[i + 1] !== undefined ? [rest[i + 1]!] : []));
  if (cmd === "resolve") {
    const work = resolve(rest[0] ?? usage(USAGE)), now = opt("now") ? Date.parse(opt("now")!) : Date.now();
    if (!Number.isFinite(now)) return usage("--now is an ISO time");
    if (existsSync(weekFile(work))) return usage(work + " already holds a week.json; a week resolves once, so start a new work folder");
    mkdirSync(work, { recursive: true });
    const remeasure = Number(opt("remeasure") ?? 0);
    if (!Number.isInteger(remeasure) || remeasure < 0) return usage("--remeasure is a whole number");
    const date = new Date(now).toISOString().slice(0, 10), weekOf = opt("week") ?? null;
    if (remeasure && !weekOf) return usage("--remeasure needs --week <YYYY-MM-DD>, the date of the week whose record it re-measures");
    if (!remeasure && weekOf) return usage("--week goes only with --remeasure");
    const weekAt = weekOf && /^\d{4}-\d{2}-\d{2}$/.test(weekOf) ? Date.parse(weekOf + "T00:00:00Z") : NaN;
    if (weekOf && (!Number.isFinite(weekAt) || new Date(weekAt).toISOString().slice(0, 10) !== weekOf)) return usage("--week " + weekOf + " is not a real date (YYYY-MM-DD)");
    if (weekOf && weekOf > date) return usage("--week " + weekOf + " is after the run date " + date);
    const prior = latestHold(), held = "held" in prior ? prior.held : null, shim = resolveWeek(join(work, "gstack-clone"), now);
    const d = "error" in prior ? { kind: "incomplete" as const, reason: "the latest published record could not be read (" + prior.error + "), so a HOLD cannot be ruled out", candidate: shim.candidate ? { sha: shim.candidate.sha } : null, stable: null, hold: shim.hold ?? null } : decide(shim, held);
    writeJson(join(work, "resolve.json"), shim);
    const w: WeekFile = { date, week_of: weekOf, base: weekBase(date, remeasure), seed: weekSeed(date), start: new Date(now).toISOString(), decision: d, held, candidate: d.candidate?.sha ?? "", stable: d.stable?.sha ?? "", stable_tag: d.stable?.tag ?? "", dropped: [], setup_failed: [], contamination: null, smoke: null, arms: null, look: null };
    writeJson(weekFile(work), w);
    console.log("WEEK " + (d.kind === "run" ? "RUN" : d.kind.toUpperCase()) + " " + w.base + ": " + (d.kind === "run" ? "candidate " + d.candidate.sha + " (" + d.candidate.version + ", gated by " + d.candidate.via + ", " + d.commits + " first-parent commits after stable) against stable " + d.stable.tag + " " + d.stable.sha : d.reason) + (d.hold ? "; gstack's release gate holds: " + d.hold : ""));
    return 0;
  }
  if (cmd === "build") {
    const work = resolve(rest[0] ?? usage(USAGE)), w = readWeek(work);
    if (w.decision.kind !== "run") return usage("the week runs nothing: " + (w.decision as { reason: string }).reason);
    for (const a of GSTACK_ARMS) {
      const r = spawnSync("bash", [join(import.meta.dir, "build.sh"), a, shasOf(w)[a], ARMS_DIR()], { stdio: "inherit" });
      if (r.status === 3) w.setup_failed.push(a);
      else if (r.status !== 0) { console.error("E_WEEKLY_BUILD " + a + ": build.sh exited " + r.status); return 1; }
    }
    writeJson(weekFile(work), w);
    if (w.setup_failed.length) { console.log("WEEK INCOMPLETE: gstack's own ./setup failed for " + w.setup_failed.join(" and ") + " (candidate: broken-install report to GStack Minder; stable: to the gstack-evals Captain)"); return 1; }
    return 0;
  }
  if (cmd === "arms") {
    const work = resolve(rest[1] ?? usage(USAGE)), w = readWeek(work);
    if (rest[0] === "manifest") { for (const l of writeManifests(ARMS_DIR(), shasOf(w))) console.log(l); return 0; }
    if (rest[0] === "check") {
      const r = armsCheck(ARMS_DIR(), shasOf(w));
      w.arms = r.pass ? { pass: true, tars: tarShas() } : null;
      writeJson(weekFile(work), w);
      for (const l of r.lines) console.log(l);
      console.log("WEEKLY ARMS " + (r.pass ? "PASS" : "FAIL"));
      return r.pass ? 0 : 1;
    }
    return usage(USAGE);
  }
  if (cmd === "contamination") {
    const work = resolve(rest[0] ?? usage(USAGE)), w = readWeek(work), l = taskLists(), ids = [...l.run, ...l.pilot], hits: Record<string, string[]> = {};
    for (const a of GSTACK_ARMS) {
      const r = contaminationSearch(join(ARMS_DIR(), "trees", a), ids);
      if (r.error) { console.error("E_WEEKLY_BUILD " + a + ": the contamination search failed: " + r.error); return 1; }
      for (const [id, files] of Object.entries(r.hits)) hits[id] = [...(hits[id] ?? []), ...files.map((f) => a + ":" + f)];
    }
    w.contamination = hits; w.dropped = l.run.filter((t) => hits[t]);
    writeJson(weekFile(work), w);
    const pilotHits = l.pilot.filter((t) => hits[t]);
    console.log("contamination: " + Object.keys(hits).length + " of " + ids.length + " ids named in a built tree; " + w.dropped.length + " of the 130 dropped" + (pilotHits.length ? "; smoke tasks named: " + pilotHits.length : ""));
    return 0;
  }
  if (cmd === "plan") {
    const w = readWeek(resolve(rest[0] ?? usage(USAGE))), l = taskLists();
    for (const item of [PILOT.item, ...partItems(w.base)]) {
      const parts = weekPlan(item, l.run, l.pilot, w.dropped, w.seed), p = projection(item, parts);
      console.log(item + ": " + parts.map((x) => x.name + " (" + x.rects.map((r) => r.tasks.length + "x" + r.arms.length).join("+") + ")").join(", ") + "; " + p.sessions + " sessions; expected $" + p.expected.toFixed(2) + ", open-session reserve $" + p.parallel.toFixed(2) + ", VM $" + p.vm.toFixed(2) + ", cap $" + p.cap);
    }
    return 0;
  }
  if (cmd === "approve" || cmd === "done") {
    const ledger = opt("ledger"), it = opt("item") ?? "";
    if (!ledger || !isItem(it)) return usage(USAGE);
    if (cmd === "done") { markDone(resolve(ledger), it); console.log(it + " marked done on " + ledger); return 0; }
    const u = opt("usd") ?? "";
    if (!/^\d+(\.\d+)?$/.test(u)) return usage(USAGE);
    approve(resolve(ledger), it, Number(u), opt("approved-by") ?? "");
    console.log("approved " + it + " at $" + u + " on " + ledger);
    return 0;
  }
  if (cmd === "guard") { guardWork(resolve(rest[0] ?? usage(USAGE))); return 0; }
  if (cmd && LAUNCHER.includes(cmd)) {
    const work = resolve(rest[0] ?? usage(USAGE)), item = cmd === "prepare" ? (opt("item") ?? usage(USAGE)) : String(readJson(join(work, "plan.json")).item);
    if (!isItem(item)) return usage("unknown item " + item);
    const week = WEEK_ITEM.test(item) ? readWeek(dirname(work)) : null;
    if (week && week.decision.kind !== "run") return usage("the week runs nothing: " + (week.decision as { reason: string }).reason);
    if (week && !partItems(week.base).includes(item)) return usage(item + " is not a part of this week, " + week.base);
    if (week && basename(work) !== "p" + item.slice(-1)) return usage("part " + item.slice(-1) + "'s work dir is " + join(dirname(work), "p" + item.slice(-1)) + ", beside week.json");
    if (week && ["launch", "relaunch", "rerun"].includes(cmd)) { const gate = launchGate(week, opt("part") ?? usage(USAGE)); if (gate.length) return usage("refused: " + gate.join("; ")); }
    if (GUARDED.includes(cmd)) { if (cmd === "relaunch" && !opt("part")) return usage(USAGE); guardWork(work, cmd === "relaunch" ? opt("part") : undefined); }
    (L1.vm as { ttlHours: number }).ttlHours = WEEKLY.vmTtlHours;
    l1Main(argv, profileFor(item, week));
    return 0;
  }
  if (cmd === "table") {
    const [cfg, outPath] = rest;
    if (!cfg || !outPath) return usage(USAGE);
    const rows = buildWeeklyTable(readJson(cfg));
    writeFileSync(outPath, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""));
    console.log("wrote " + rows.length + " rows to " + outPath);
    return 0;
  }
  if (cmd === "smoke") {
    const rows = rowsOf(rest[0] ?? usage(USAGE)), work = resolve(rest[1] ?? usage(USAGE)), w = readWeek(work), s = smokeCheck(rows, tarShas(), taskLists().pilot);
    w.smoke = s; writeJson(weekFile(work), w);
    console.log("WEEKLY SMOKE " + (s.rig.length ? "RIG FAIL: " + s.rig.join("; ") : s.flag ? "PASS with FLAG " + s.flag : "PASS"));
    return s.rig.length ? 1 : 0;
  }
  if (cmd === "look") {
    const work = resolve(rest[1] ?? usage(USAGE)), rows = rowsOf(rest[0] ?? usage(USAGE)), w = readWeek(work);
    const gate = tableGate(w, rows);
    if (gate.length) return usage("refused: " + gate.join("; "));
    const l = look(rows, taskLists().run, w.dropped);
    const tasks = new Set(l.tasks), trials = l.stop ? rows.filter((r) => tasks.has(r.task)).map((r) => r.trial) : [];
    if (recordLook(w, l, new Date().toISOString(), trials)) writeJson(weekFile(work), w);
    console.log(!l.ready ? "WEEKLY LOOK NOT READY: the first " + l.tasks.length + " tasks' candidate and stable sessions have not all settled" : l.stop ? "WEEKLY LOOK STOP " + l.stop : "WEEKLY LOOK CONTINUE");
    return 0;
  }
  if (cmd === "pilot-report") {
    const rows = rowsOf(rest[0] ?? usage(USAGE)), r = pilotCheck(rows, tarShas(), taskLists().pilot), out = opt("out");
    const lines = ["== weekly pilot: " + taskLists().pilot.length + " tasks on every arm", ...r.lines, "WEEKLY PILOT " + (r.failed.length ? "FAIL " + r.failed.join(", ") : "PASS")];
    for (const l of lines) console.log(l);
    if (out) { mkdirSync(out, { recursive: true }); writeFileSync(join(out, "pilot-report.txt"), lines.join("\n") + "\n"); }
    return r.failed.length ? 1 : 0;
  }
  if (cmd === "report" || cmd === "record") {
    const work = resolve((cmd === "report" ? rest[1] : rest[0]) ?? usage(USAGE)), out = resolve(opt("out") ?? usage(USAGE)), w = readWeek(work);
    mkdirSync(out, { recursive: true });
    let rec: ReturnType<typeof weekRecord>, lines: string[];
    if (cmd === "record") {
      if (w.decision.kind === "run" && !w.setup_failed.length) return usage("the week ran; write its record with weekly report");
      const why = w.setup_failed.length ? "gstack's own ./setup failed for " + w.setup_failed.join(" and ") : (w.decision as { reason: string }).reason;
      rec = weekRecord(null, recordInput(w, "not run: no session ran").input, "INCOMPLETE", why);
      lines = ["WEEKLY RECORD INCOMPLETE " + w.base + ": " + why];
    } else {
      const stopped = opt("stopped") as "HOLD" | "GAIN" | undefined;
      if (stopped && stopped !== "HOLD" && stopped !== "GAIN") return usage("--stopped is HOLD or GAIN");
      const trials = stopped && Array.isArray(w.look?.trials) ? new Set(w.look.trials) : null;
      const rows = rowsOf(rest[0] ?? usage(USAGE)).filter((r) => trials === null || trials.has(r.trial));
      const gate = reportGate(w, rows, stopped);
      if (gate.length) return usage("refused: " + gate.join("; "));
      const l = taskLists(), counted = reportRows(w, rows, stopped), caps = stopped ? [] : partCapStops(work);
      writeFileSync(join(out, "results.md"), resultsMarkdown(counted.rows, counted.kept, "gstack weekly benchmark " + isoWeek(w.week_of ?? w.date).label));
      const check = resultsCheck(work, out), incomplete = [...opts("incomplete"), ...capStopReason(caps), ...(w.smoke?.rig.length ? ["the weekly smoke failed for a rig reason in " + w.smoke.rig.length + " of its checks"] : []), ...(check === "pass" ? [] : ["gstack's results check: " + check])];
      const r = reading({ rows, run: l.run, dropped: w.dropped, seed: w.seed, incomplete, flags: [...(w.smoke?.flag ? [w.smoke.flag] : []), ...opts("flag")], stoppedAt: stopped ?? null });
      rec = weekRecord(r, recordInput(w, check).input);
      const s = r.stat, p = (x: number) => (100 * x).toFixed(1);
      lines = ["== weekly " + rec.week + " (" + w.base + "): candidate " + w.candidate.slice(0, 12) + " against stable " + w.stable_tag, "  verdict " + rec.verdict + (r.stopped_early ? " (stopped at the look)" : "") + (rec.incomplete_reason ? ": " + rec.incomplete_reason : ""),
        "  candidate minus stable: " + p(s.d) + " points [" + p(s.lo) + ", " + p(s.hi) + "] at " + s.bound + " SE on " + s.n + " pairs over " + s.tasks + " tasks; z " + s.z.toFixed(3) + "; disagreement " + p(s.disagree) + "%, rho " + (s.rho === null ? "n/a" : s.rho.toFixed(3)) + ", realized MDD " + p(s.mdd) + " points (planned " + rec.mdd_points + ")",
        "  candidate minus none (descriptive): " + p(r.none.diff) + " points [" + p(r.none.lo) + ", " + p(r.none.hi) + "] on " + r.none.pairs + " pairs",
        "  cost ratio, candidate over stable: " + (r.cost ? r.cost.ratio.toFixed(3) + " [" + r.cost.lo.toFixed(3) + ", " + r.cost.hi.toFixed(3) + "] on " + r.cost.tasks + " tasks" : "n/a"),
        "  ungraded sessions: " + WEEKLY_ARM_NAMES.map((a) => a + " " + r.ungraded[a]).join(", ") + "; safety stops: " + WEEKLY_ARM_NAMES.map((a) => a + " " + r.safety[a]).join(", ") + "; dropped " + w.dropped.length,
        ...rec.flags.map((f) => "  FLAG " + f), ...caps.map((c) => "  cap stop: " + c), ...(w.smoke ? [...w.smoke.rig, ...w.smoke.detail].map((x) => "  smoke: " + x) : []), "  results check: " + check];
    }
    writeJson(join(out, RECORD.asset), rec);
    writeFileSync(join(out, "report.txt"), lines.join("\n") + "\n");
    writeFileSync(join(out, "page-row.md"), pageRow(w, rec) + "\n");
    writeJson(join(out, "publish.json"), { tag: recordInput(w, rec.results_check).tag, week: rec.week, verdict: rec.verdict as Verdict });
    for (const l of lines) console.log(l);
    return 0;
  }
  if (cmd === "publish") {
    const out = resolve(rest[0] ?? usage(USAGE)), p = readJson(join(out, "publish.json")), rec = readJson(join(out, RECORD.asset));
    const planned = publishArgs(p, rec, out);
    if ("error" in planned) return usage("refused: " + planned.error);
    const args = planned.args;
    console.log("gh " + args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(" "));
    if (rest.includes("--dry-run")) return 0;
    const r = gh(args);
    process.stdout.write(r.stdout ?? ""); process.stderr.write(r.stderr ?? "");
    return r.status === 0 ? 0 : 1;
  }
  return usage(USAGE);
}
if (import.meta.main) process.exit(await main(process.argv.slice(2)));
