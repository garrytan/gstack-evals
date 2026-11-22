// Copyright (c) 2026 Garry Tan. MIT License.
// gstack-evals weekly <command>: the weekly stable number (lanes/weekly-stable/README.md walks a week through these in order).
// prepare, host-up, launch, attach, relaunch, rerun, recover and host-down run on L1's host and part machinery under the
// week's profile (plan.ts profileFor), with L1's exit codes; host-up, launch and relaunch pass the launch guard first.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { L1, l1Main, type PartPlan } from "../../quick/laneb/l1/l1.ts";
import { readRows, type Row } from "../../quick/laneb/runner/ledger.ts";
import { ARMS_DIR, armsCheck, contaminationSearch, manifestDir, writeManifests } from "./arms.ts";
import { approve, baseOf, guard, isoWeek, markDone, partItems, profileFor, projection, taskLists, weekBase, weekPlan, weekSeed, type WeekState } from "./plan.ts";
import { CHANGE2, GSTACK_ARMS, isItem, PILOT, RECORD, REPO, WEEK_ITEM, WEEKLY, WEEKLY_ARM_NAMES, type GstackArm, type WeeklyArm } from "./pins.ts";
import { buildWeeklyTable, look, pilotCheck, reading, resultsMarkdown, smokeCheck, weekRecord, type Verdict, type WeeklyRow } from "./read.ts";
import { byWeekDesc, decide, resolveWeek, standingHold, type Decision, type Held } from "./resolve.ts";

const usage = (m: string): never => { throw new Error("E_USAGE " + m); };
const USAGE = "usage: weekly resolve <work> [--now <iso>] [--remeasure <n>] | build <work> | arms manifest|check <work> | contamination <work> | plan <work> | approve --ledger <jsonl> --item <item> --usd <cap> --approved-by <who> | done --ledger <jsonl> --item <item> | guard <part-work> | prepare <part-work> --item <item> | host-up|attach|recover|host-down <part-work> | launch|relaunch|rerun <part-work> --part <part> | table <config.json> <out.jsonl> | smoke <table.jsonl> <work> | look <table.jsonl> <work> | pilot-report <table.jsonl> [--out <dir>] | report <table.jsonl> <work> --out <dir> [--stopped HOLD|GAIN] [--incomplete <why>]... [--flag <line>]... | record <work> --out <dir> | publish <out> [--dry-run]";
const LAUNCHER = ["prepare", "host-up", "launch", "attach", "relaunch", "rerun", "recover", "host-down"], GUARDED = ["host-up", "launch", "relaunch"];
const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const writeJson = (p: string, v: unknown) => writeFileSync(p, JSON.stringify(v, null, 2) + "\n");
const gh = (args: string[]) => spawnSync("gh", args, { encoding: "utf8", maxBuffer: 64 << 20 });

export type WeekFile = WeekState & { start: string; decision: Decision; held: Held | null; setup_failed: GstackArm[]; contamination: Record<string, string[]> | null; smoke: { rig: string[]; flag: string | null; detail: string[] } | null };
const weekFile = (work: string) => join(work, "week.json");
export const readWeek = (work: string): WeekFile => (existsSync(weekFile(work)) ? readJson(weekFile(work)) : usage(work + " has no week.json; run weekly resolve first"));
const shasOf = (w: WeekFile): Record<GstackArm, string> => ({ candidate: w.candidate, stable: w.stable });

/** The latest published record's HOLD, if it is one: the commit it held and the week. No published release is no HOLD;
 *  any other failure to read the record is an error, and the week stops INCOMPLETE rather than risk measuring a held commit. */
/** The HOLD that stands, read from the published weekly records newest week first, past any INCOMPLETE ones. A read
 *  error returns error, so the week is INCOMPLETE; a repository with no weekly record has no HOLD. */
export function latestHold(): { held: Held | null } | { error: string } {
  const list = gh(["release", "list", "--repo", RECORD.repo, "--limit", "200", "--json", "tagName"]);
  if (list.status !== 0) return { error: "gh release list failed: " + (list.stderr ?? "").trim().slice(0, 200) };
  const tags = (JSON.parse(list.stdout) as { tagName: string }[]).map((x) => x.tagName).filter((t) => /^weekly-\d{4}-w\d{2}(-r\d+)?$/.test(t)).sort(byWeekDesc), recs = [];
  for (const tag of tags) {
    const d = gh(["release", "download", tag, "--repo", RECORD.repo, "-p", RECORD.asset, "-O", "-"]);
    if (d.status !== 0) return { error: "gh release download " + tag + " failed: " + (d.stderr ?? "").trim().slice(0, 200) };
    try { recs.push(JSON.parse(d.stdout)); } catch { return { error: tag + "'s " + RECORD.asset + " is not JSON" }; }
    if (recs.at(-1).verdict !== "INCOMPLETE") break;
  }
  return { held: standingHold(recs) };
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
    meter = readJson(meterFile).usd;
    if (typeof meter !== "number" || !(meter >= 0)) usage("weekly launch guard: the meter file needs usd, a number of at least 0");
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
function recordInput(w: WeekFile, check: string) {
  const head = spawnSync("git", ["-C", REPO, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim(), wk = isoWeek(w.date), suffix = w.base.slice(("ws-" + w.date).length);
  const tag = wk.tag + suffix, stable = w.decision.stable ?? { tag: "none", sha: w.stable || "0".repeat(40) };
  return { tag, input: { week: wk.label, candidate: w.candidate || stable.sha, stable, window: { start: w.start, end: new Date().toISOString() }, results_check: check, results: "https://github.com/" + RECORD.repo + "/releases/tag/" + tag, run: "https://github.com/" + RECORD.repo + "/tree/" + head + "/lanes/weekly-stable", supersedes: suffix ? (suffix === "-r1" ? wk.tag : wk.tag + "-r" + (Number(suffix.slice(2)) - 1)) : null } };
}
const pageRow = (w: WeekFile, rec: ReturnType<typeof weekRecord>) => { const m = Object.values(rec.models)[0]; return "| " + rec.week + " | " + w.decision.stable?.tag + " " + w.stable.slice(0, 12) + " | " + (w.candidate ? w.candidate.slice(0, 12) : "-") + " | " + rec.verdict + (rec.stopped_early ? " (stopped at the look)" : "") + " | " + (m ? m.d.toFixed(1) + " [" + m.lo.toFixed(1) + ", " + m.hi.toFixed(1) + "] on " + m.n + " pairs; vs none " + m.vs_none.d.toFixed(1) + " [" + m.vs_none.lo.toFixed(1) + ", " + m.vs_none.hi.toFixed(1) + "]" : rec.incomplete_reason ?? "-") + " | " + rec.flags.length + " flags |"; };

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
    mkdirSync(work, { recursive: true });
    const remeasure = Number(opt("remeasure") ?? 0);
    if (!Number.isInteger(remeasure) || remeasure < 0) return usage("--remeasure is a whole number");
    const prior = latestHold(), held = "held" in prior ? prior.held : null, shim = resolveWeek(join(work, "gstack-clone"), now);
    const d = "error" in prior ? { kind: "incomplete" as const, reason: "the latest published record could not be read (" + prior.error + "), so a HOLD cannot be ruled out", candidate: shim.candidate ? { sha: shim.candidate.sha } : null, stable: null, hold: shim.hold ?? null } : decide(shim, held);
    const date = new Date(now).toISOString().slice(0, 10);
    writeJson(join(work, "resolve.json"), shim);
    const w: WeekFile = { date, base: weekBase(date, remeasure), seed: weekSeed(date), start: new Date(now).toISOString(), decision: d, held, candidate: d.candidate?.sha ?? "", stable: d.stable?.sha ?? "", stable_tag: d.stable?.tag ?? "", dropped: [], setup_failed: [], contamination: null, smoke: null };
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
    if (rest[0] === "check") { const r = armsCheck(ARMS_DIR(), shasOf(w)); for (const l of r.lines) console.log(l); console.log("WEEKLY ARMS " + (r.pass ? "PASS" : "FAIL")); return r.pass ? 0 : 1; }
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
    const rows = rowsOf(rest[0] ?? usage(USAGE)), w = readWeek(resolve(rest[1] ?? usage(USAGE))), l = look(rows, taskLists().run, w.dropped);
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
      const rows = rowsOf(rest[0] ?? usage(USAGE)), stopped = opt("stopped") as "HOLD" | "GAIN" | undefined;
      if (stopped && stopped !== "HOLD" && stopped !== "GAIN") return usage("--stopped is HOLD or GAIN");
      const l = taskLists(), kept = l.run.filter((t) => !w.dropped.includes(t));
      writeFileSync(join(out, "results.md"), resultsMarkdown(rows, kept, "gstack weekly benchmark " + isoWeek(w.date).label));
      const check = resultsCheck(work, out), incomplete = [...opts("incomplete"), ...(w.smoke?.rig.length ? ["the weekly smoke failed for a rig reason in " + w.smoke.rig.length + " of its checks"] : []), ...(check === "pass" ? [] : ["gstack's results check: " + check])];
      const r = reading({ rows, run: l.run, dropped: w.dropped, seed: w.seed, incomplete, flags: [...(w.smoke?.flag ? [w.smoke.flag] : []), ...opts("flag")], stoppedAt: stopped ?? null });
      rec = weekRecord(r, recordInput(w, check).input);
      const s = r.stat, p = (x: number) => (100 * x).toFixed(1);
      lines = ["== weekly " + rec.week + " (" + w.base + "): candidate " + w.candidate.slice(0, 12) + " against stable " + w.stable_tag, "  verdict " + rec.verdict + (r.stopped_early ? " (stopped at the look)" : "") + (rec.incomplete_reason ? ": " + rec.incomplete_reason : ""),
        "  candidate minus stable: " + p(s.d) + " points [" + p(s.lo) + ", " + p(s.hi) + "] at " + s.bound + " SE on " + s.n + " pairs over " + s.tasks + " tasks; z " + s.z.toFixed(3) + "; disagreement " + p(s.disagree) + "%, rho " + (s.rho === null ? "n/a" : s.rho.toFixed(3)) + ", realized MDD " + p(s.mdd) + " points (planned " + rec.mdd_points + ")",
        "  candidate minus none (descriptive): " + p(r.none.diff) + " points [" + p(r.none.lo) + ", " + p(r.none.hi) + "] on " + r.none.pairs + " pairs",
        "  cost ratio, candidate over stable: " + (r.cost ? r.cost.ratio.toFixed(3) + " [" + r.cost.lo.toFixed(3) + ", " + r.cost.hi.toFixed(3) + "] on " + r.cost.tasks + " tasks" : "n/a"),
        "  ungraded sessions: " + WEEKLY_ARM_NAMES.map((a) => a + " " + r.ungraded[a]).join(", ") + "; safety stops: " + WEEKLY_ARM_NAMES.map((a) => a + " " + r.safety[a]).join(", ") + "; dropped " + w.dropped.length,
        ...rec.flags.map((f) => "  FLAG " + f), ...(w.smoke ? [...w.smoke.rig, ...w.smoke.detail].map((x) => "  smoke: " + x) : []), "  results check: " + check];
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
    const list = gh(["release", "list", "--repo", RECORD.repo, "--limit", "200", "--json", "tagName"]), tags = list.status === 0 ? (JSON.parse(list.stdout) as { tagName: string }[]).map((x) => x.tagName).filter((t) => /^weekly-\d{4}-w\d{2}/.test(t)) : [];
    if (tags.includes(p.tag)) return usage("refused: release " + p.tag + " exists; a published record is never edited, so a correction takes the next -r<k> tag");
    const latest = !tags.some((t) => t.slice(0, 15) > p.tag.slice(0, 15));
    const args = ["release", "create", p.tag, join(out, RECORD.asset), "--repo", RECORD.repo, "--title", "gstack weekly benchmark " + p.week + ": " + p.verdict, "--notes", "gstack's release candidate " + rec.candidate.sha.slice(0, 12) + " against stable " + rec.stable.tag + ", Claude Opus 5.5 in Claude Code: " + p.verdict + ". The record is weekly.json, schema 1.", "--latest=" + latest];
    console.log("gh " + args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(" "));
    if (rest.includes("--dry-run")) return 0;
    const r = gh(args);
    process.stdout.write(r.stdout ?? ""); process.stderr.write(r.stderr ?? "");
    return r.status === 0 ? 0 : 1;
  }
  return usage(USAGE);
}
if (import.meta.main) process.exit(await main(process.argv.slice(2)));
