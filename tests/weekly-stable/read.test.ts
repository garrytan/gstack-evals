// Copyright (c) 2026 Garry Tan. MIT License.
import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pulledInputs } from "../../lanes/delivery-route/table.ts";
import { MODEL, S390, SOL_LINE } from "../../lanes/weekly-stable/pins.ts";
import { buildWeeklyTable, clusterStat, costRatio, look, pairsOf, pilotCheck, reading, recomputedHold, resultsMarkdown, smokeCheck, vsNone, weekRecord, type Pair, type WeeklyRow } from "../../lanes/weekly-stable/read.ts";

const FIX = join(import.meta.dir, "fixtures"), CAPTURED = join(import.meta.dir, "../delivery-route/fixtures/b1f-sessions"), roots: string[] = [];
afterAll(() => { for (const d of roots) rmSync(d, { recursive: true, force: true }); });

let n = 0;
const row = (task: string, arm: WeeklyRow["arm"], pass: boolean, o: Partial<WeeklyRow> = {}): WeeklyRow => ({
  schema: "b1-session/1", model: MODEL.id, part: "s390-1", arm, task, trial: task + "__" + ++n, outcome: "graded", reason: "graded", pass, reward: pass ? 1 : 0, allowance_stop: false, turn_cap: false,
  cost_usd: arm === "none" ? 0.31 : 0.48, tokens: null, steps_seen: null, skill_loads: 0, safety_stop: false, audit_hits: [], detect: null as never, responded: true, opened_at: String(n).padStart(6, "0"),
  tar_sha256: "tar-" + arm, listing: arm !== "none", listed: 60, hook_events: arm === "none" ? null : 1, routed: arm === "none" ? null : [], skill_calls: [], skill_reads: 0, ...o,
});
const task = (t: string, c: number[], s: number[], none = 1) => [...c.map((p) => row(t, "candidate", !!p)), ...s.map((p) => row(t, "stable", !!p)), row(t, "none", !!none)];

describe("the paired reading", () => {
  // Three tasks, three pairs each, worked by hand: D = 1/9, V = 3/2 x ((5/3)^2 + (4/3)^2 + (1/3)^2) / 81 = 7/81, the iid
  // variance (44/9)/8/9 = 11/162, so the design effect is 14/11 and rho (14/11 - 1)/(3 - 1) = 3/22.
  const P: Pair[] = [[1, 0], [1, 0], [0, 0], [0, 1], [0, 0], [1, 1], [1, 0], [0, 0], [0, 1]].map(([c, s], i) => ({ task: "ABC"[Math.floor(i / 3)]!, k: (i % 3) + 1, c: c!, s: s! }));
  test("a difference with no spread is a stop at the look, not a z of 0", () => {
    const pairs: Pair[] = Array.from({ length: 65 }, (_, i) => [1, 2, 3].map((k) => ({ task: "t" + i, k, c: 0, s: 1 }))).flat();
    const s = clusterStat(pairs, S390.look.z);
    expect([s.se, s.z]).toEqual([0, -Infinity]);
    expect(clusterStat(pairs.map((p) => ({ ...p, c: 1 })), S390.look.z).z).toBe(0);
  });
  test("the cluster-robust interval matches the hand-worked table", () => {
    const s = clusterStat(P, 1.977);
    expect([s.n, s.tasks]).toEqual([9, 3]);
    expect(s.d).toBeCloseTo(1 / 9, 12);
    expect(s.se).toBeCloseTo(Math.sqrt(7 / 81), 12);
    expect(s.lo).toBeCloseTo(1 / 9 - 1.977 * Math.sqrt(7 / 81), 12);
    expect(s.disagree).toBeCloseTo(5 / 9, 12);
    expect(s.rho!).toBeCloseTo(3 / 22, 12);
    expect(s.mdd).toBeCloseTo((1.977 + 0.8416) * Math.sqrt(7 / 81), 12);
  });
  test("session k pairs by open order among graded sessions; an ungraded session drops out of the numbering", () => {
    const rows = [row("T", "stable", true, { opened_at: "3" }), row("T", "candidate", false, { opened_at: "2" }), row("T", "candidate", true, { opened_at: "1" }), row("T", "stable", false, { opened_at: "4", outcome: "infra" }), row("T", "stable", false, { opened_at: "5" })];
    expect(pairsOf(rows, ["T"])).toEqual([{ task: "T", k: 1, c: 1, s: 1 }, { task: "T", k: 2, c: 0, s: 0 }]);
  });
  test("candidate minus none pairs each task's first candidate session with its none session", () => {
    const rows = [...task("A", [0, 1, 1], [1, 1, 1], 1), ...task("B", [1, 0, 0], [0, 0, 0], 0)];
    expect(vsNone(rows, ["A", "B"])).toMatchObject({ pairs: 2 });
    expect(vsNone(rows, ["A", "B"]).diff).toBeCloseTo(0, 12);
  });
  test("the cost ratio is a geometric mean over tasks, with a seeded bootstrap that repeats", () => {
    const rows = [...task("A", [1, 1, 1], [1, 1, 1]).map((r) => (r.arm === "candidate" ? { ...r, cost_usd: 1 } : r.arm === "stable" ? { ...r, cost_usd: 0.5 } : r)), ...task("B", [1, 1, 1], [1, 1, 1]).map((r) => (r.arm === "candidate" ? { ...r, cost_usd: 0.5 } : r.arm === "stable" ? { ...r, cost_usd: 1 } : r))];
    const c = costRatio(rows, ["A", "B"], 1275945340, 2000)!;
    expect(c.ratio).toBeCloseTo(1, 12);
    expect(costRatio(rows, ["A", "B"], 1275945340, 2000)).toEqual(c);
    expect(c.lo).toBeLessThan(1);
    expect(c.hi).toBeGreaterThan(1);
  });
});

describe("verdicts, flags and the record", () => {
  const RUN = Array.from({ length: 70 }, (_, i) => "t" + i);
  const week = (f: (i: number) => [number[], number[], number?]) => RUN.flatMap((t, i) => { const [c, s, none] = f(i); return task(t, c, s, none ?? 1); });
  const read = (rows: WeeklyRow[], o: Partial<Parameters<typeof reading>[0]> = {}) => reading({ rows, run: RUN, dropped: [], seed: 1, incomplete: [], flags: [], stoppedAt: null, ...o });
  test("a candidate that loses about a third of stable's passes is a HOLD, with the area FLAG; gstack's recomputation agrees", () => {
    const r = read(week((i) => (i % 3 === 0 ? [[1, 1, 1], [1, 1, 1]] : [[0, 1, 0], [1, 1, 1]])));
    expect(r.verdict).toBe("HOLD");
    expect(r.flags.some((f) => f.startsWith("area python-bugfix:"))).toBe(true);
    const rec = weekRecord(r, { week: "2026-W48", candidate: "c".repeat(40), stable: { tag: "v1.0.0.0", sha: "s".repeat(40) }, window: { start: "2026-11-28T06:00:00.000Z", end: "2026-11-30T06:00:00.000Z" }, results_check: "pass", results: "r", run: "u" });
    expect([rec.verdict, recomputedHold(rec), rec.models[MODEL.id]!.n, rec.flags.at(-1)]).toEqual(["HOLD", true, 210, SOL_LINE]);
    expect(JSON.stringify(rec)).not.toMatch(/"t\d+"/);
    expect(rec.stale_after).toEqual({ verdict: null, flags: "2026-12-07T06:00:00.000Z" });
  });
  test("equal arms are NO CHANGE; a clear gain is a GAIN and holds nothing", () => {
    const same = read(week((i) => [[i % 2, 1, 0], [i % 2, 1, 0]]));
    expect(same.verdict).toBe("NO_CHANGE");
    const gain = read(week((i) => (i % 3 === 0 ? [[1, 1, 1], [1, 1, 1]] : [[1, 1, 1], [0, 1, 0]])));
    expect(gain.verdict).toBe("GAIN");
    expect(recomputedHold(weekRecord(gain, { week: "w", candidate: "c", stable: { tag: "v", sha: "s" }, window: { start: "2026-11-28T06:00:00.000Z", end: "2026-11-30T06:00:00.000Z" }, results_check: "pass", results: "r", run: "u" }))).toBe(false);
  });
  test("INCOMPLETE: too many ungraded sessions, a cap stop, too many dropped tasks or an outside reason; never a HOLD", () => {
    const rows = week(() => [[0, 0, 0], [1, 1, 1]]);
    expect(read(rows).verdict).toBe("HOLD");
    const gaps = rows.map((r) => (r.arm === "stable" && Number(r.task.slice(1)) < 14 ? { ...r, outcome: "infra" as const, pass: false } : r));
    expect(read(gaps).incomplete_reason).toBe("stable has 42 of 210 sessions ungraded, more than 39");
    expect(read([...rows, row("t1", "candidate", false, { outcome: "cap_stop" })]).verdict).toBe("INCOMPLETE");
    expect(read(rows, { dropped: RUN.slice(0, 14) }).incomplete_reason).toMatch(/dropped 14 tasks/);
    const failed = read(rows, { incomplete: ["gstack's results check: fail"] });
    expect(failed.verdict).toBe("INCOMPLETE");
    const rec = weekRecord(failed, { week: "w", candidate: "c", stable: { tag: "v", sha: "s" }, window: { start: "2026-11-28T06:00:00.000Z", end: "2026-11-30T06:00:00.000Z" }, results_check: "fail", results: "r", run: "u" });
    expect([rec.verdict, rec.models, rec.areas, rec.realized, recomputedHold(rec)]).toEqual(["INCOMPLETE", {}, [], null, false]);
    expect(rec.stale_after).toEqual({ verdict: "2026-12-07T06:00:00.000Z", flags: "2026-12-07T06:00:00.000Z" });
    expect(() => weekRecord(failed, { week: "w", candidate: "c", stable: { tag: "v", sha: "s" }, window: { start: "a", end: "b" }, results_check: "fail", results: "r", run: "u" })).toThrow(/not an ISO time/);
  });
  test("the FLAG lines: losing to none, a costlier candidate, safety stops", () => {
    const r = read(week((i) => [[i % 2, 1, 1], [i % 2, 1, 1], 1]).map((x) => (x.arm === "candidate" ? { ...x, cost_usd: 0.6, safety_stop: x.task < "t2" } : x)));
    expect(r.verdict).toBe("NO_CHANGE");
    expect(r.flags.map((f) => f.split(" ").slice(0, 3).join(" "))).toEqual(expect.arrayContaining(["candidate minus none", "the candidate costs", "provider safety stops:"]));
  });
  test("the look waits for the first 65 tasks' sessions, then stops only past 2.797", () => {
    const rows = week((i) => (i % 3 === 0 ? [[1, 1, 1], [1, 1, 1]] : [[0, 1, 0], [1, 1, 1]]));
    expect(look(rows.filter((r) => r.task !== "t64" || r.arm === "none"), RUN, []).ready).toBe(false);
    const l = look(rows, RUN, []);
    expect([l.ready, l.stop, l.tasks.length]).toEqual([true, "HOLD", 65]);
    expect(look(week((i) => [[i % 2, 1, 1], [1 - (i % 2), 1, 1]]), RUN, []).stop).toBeNull();
    const early = read(rows, { stoppedAt: "HOLD" });
    expect([early.verdict, early.stopped_early, early.stat.n, early.stat.bound]).toEqual(["HOLD", true, 195, 2.797]);
  });
  test("a stop at the look on 130 planned tasks reads only the look's rows: the unrun half is never ungraded", () => {
    const run = Array.from({ length: 130 }, (_, i) => "u" + i), look65 = run.slice(0, 65).flatMap((t, i) => task(t, i % 3 === 0 ? [1, 1, 1] : [0, 1, 0], [1, 1, 1]));
    expect(look(look65, run, []).stop).toBe("HOLD");
    const r = reading({ rows: look65, run, dropped: [], seed: 1, incomplete: [], flags: [], stoppedAt: "HOLD" });
    expect([r.verdict, r.incomplete_reason, r.kept, r.ungraded]).toEqual(["HOLD", null, 65, { candidate: 0, stable: 0, none: 0 }]);
    expect(reading({ rows: look65, run, dropped: [], seed: 1, incomplete: [], flags: [], stoppedAt: null }).verdict).toBe("INCOMPLETE");
  });
  test("after a stop at the look, results.md over the look's 65 tasks and their rows counts only those tasks' sessions and cost", () => {
    const run = Array.from({ length: 130 }, (_, i) => "u" + i), rows = run.flatMap((t) => task(t, [1, 1, 0], [1, 0, 0]));
    const kept = run.slice(0, S390.look.tasks), md = resultsMarkdown(rows.filter((r) => kept.includes(r.task)), kept, "gstack weekly benchmark test");
    expect(md).toContain("| 195 of 195 | 130 of 195 | $93.60 |");
    expect(md).toContain("| 195 of 195 | 65 of 195 | $93.60 |");
    expect(md).toContain("| 65 of 65 | 65 of 65 | $20.15 |");
    expect(resultsMarkdown(rows, kept, "gstack weekly benchmark test")).toContain("| 195 of 195 | 130 of 195 | $187.20 |");
  });
  test("the results table has the shape gstack's results check passed on 2026-11-22 (fixtures/results-check-ok.txt)", () => {
    const ok = readFileSync(join(FIX, "results-check-ok.md"), "utf8"), md = resultsMarkdown(week(() => [[1, 0, 1], [1, 1, 0]]), RUN, "gstack weekly benchmark test");
    const shape = (s: string) => s.split("\n").map((l) => l.replace(/\d+(\.\d+)?/g, "N"));
    expect(shape(md)).toEqual(shape(ok));
    expect(readFileSync(join(FIX, "results-check-ok.txt"), "utf8")).toMatch(/RESULTS: ok no_gstack_rows=1\/1 rows=3\/3/);
  });
});

describe("rows from trial folders, on sessions Claude Code really ran (B1f's captured sessions)", () => {
  const rig = () => {
    const root = mkdtempSync(join(tmpdir(), "weekly-table-")), sessions: object[] = [];
    roots.push(root);
    const trial = (arm: string, t: string, capture: string, o: { hook?: string } = {}) => {
      const name = t + "__" + ++n, dir = join(root, "jobs", "job1", name);
      mkdirSync(join(dir, "evaluator", "gstack-hooks", "hooks"), { recursive: true });
      writeFileSync(join(dir, "config.json"), JSON.stringify({ agent: { name: "laneb-claude-code", kwargs: { arm, upstream_model: MODEL.id } }, task: { path: "tasks/" + t } }));
      writeFileSync(join(dir, "result.json"), JSON.stringify({ trial_name: name, verifier_result: { rewards: { reward: 1 } } }));
      writeFileSync(join(dir, "evaluator", "sdk-messages.jsonl"), readFileSync(join(CAPTURED, capture, "sdk-messages.jsonl"), "utf8"));
      writeFileSync(join(dir, "evaluator", "usersim-events.jsonl"), JSON.stringify({ event: "arm", tar_sha256: "tar-" + arm }) + "\n");
      if (o.hook !== undefined) writeFileSync(join(dir, "evaluator", "gstack-hooks", "hooks", "skill-route.log"), o.hook);
      sessions.push({ id: "s" + n, trial: name, opened_at: String(n).padStart(4, "0"), ok_responses: 3, refused_budget: 0, spent_micros: arm === "none" ? 310_000 : 480_000 });
    };
    const table = () => { mkdirSync(join(root, "out"), { recursive: true }); writeFileSync(join(root, "out", "proxy-sessions.jsonl"), sessions.map((s) => JSON.stringify(s) + "\n").join("")); return buildWeeklyTable(pulledInputs(root, "pilot")); };
    return { trial, table };
  };
  const TARS = { candidate: "tar-candidate", stable: "tar-stable", none: "tar-none" };
  const PILOT = ["psd-tools__psd-tools-593", "BerriAI__litellm-16526", "schemathesis__schemathesis-3195"];
  test("gstack sessions read the listing and the hook's event; none reads no listing and no hook; the pilot passes each arm", () => {
    const t = rig();
    for (const task of PILOT) { t.trial("candidate", task, "hook-load", { hook: "ts=1 event=routed skill=prove-it session=x\n" }); t.trial("stable", task, "hook-load", { hook: "ts=1 event=routed skill=prove-it session=x\n" }); t.trial("none", task, "none-stop"); }
    const rows = t.table();
    expect(rows.filter((r) => r.task === PILOT[0]).map((r) => [r.arm, r.outcome, r.listing, r.hook_events, r.routed, r.skill_calls, r.cost_usd])).toEqual([
      ["candidate", "graded", true, 1, ["prove-it"], ["prove-it"], 0.48], ["stable", "graded", true, 1, ["prove-it"], ["prove-it"], 0.48], ["none", "graded", false, null, null, [], 0.31]]);
    const p = pilotCheck(rows, TARS, PILOT);
    expect(p.failed).toEqual([]);
    expect(smokeCheck(rows, TARS, PILOT)).toEqual({ rig: [], flag: null, detail: [] });
  });
  test("a job listed twice in the table config is read once; one trial in two folders is refused", () => {
    const t = rig();
    for (const task of PILOT) t.trial("candidate", task, "hook-load", { hook: "ts=1 event=routed skill=prove-it\n" });
    const rows = t.table(), root = roots.at(-1)!, cfg = pulledInputs(root, "pilot");
    expect(buildWeeklyTable({ ...cfg, jobs: [...cfg.jobs, ...cfg.jobs] }).length).toBe(rows.length);
    const copy = join(root, "jobs", "job2");
    mkdirSync(copy, { recursive: true });
    spawnSync("cp", ["-r", join(root, "jobs", "job1", rows[0]!.trial), copy]);
    expect(() => buildWeeklyTable({ ...cfg, jobs: [...cfg.jobs, { ...cfg.jobs[0]!, dir: copy }] })).toThrow(/twice/);
  });
  test("a candidate whose hook logged nothing is the release's own change (a smoke FLAG) and fails the pilot; a wrong tar is a rig failure", () => {
    const t = rig();
    for (const task of PILOT) { t.trial("candidate", task, "own-load", { hook: "" }); t.trial("stable", task, "hook-load", { hook: "ts=1 event=routed skill=prove-it\n" }); t.trial("none", task, "none-stop"); }
    const rows = t.table(), s = smokeCheck(rows, TARS, PILOT);
    expect([s.rig, s.flag]).toEqual([[], "exposure changed: gstack's routing hook logged no event in 3 of 3 smoke sessions"]);
    expect(s.detail[0]).toMatch(/^psd-tools__psd-tools-593: gstack's routing hook logged no event/);
    expect(pilotCheck(rows, TARS, PILOT).failed).toEqual(["candidate"]);
    expect(smokeCheck(rows, { ...TARS, candidate: "other" }, PILOT).rig.length).toBe(3);
  });
});
