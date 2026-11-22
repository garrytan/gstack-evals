// Copyright (c) 2026 Garry Tan. MIT License.
// Pre-run change 4 (wiki/plans/2026-11-22-geva-573-weekly-stable-pre-run-change-4): the stop boundary, when the look is
// ready, the required look, a STOP that ends paid work, the look's frozen rows, part results, each session read once,
// paid commands behind their checks and archives checked whole.
import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSha, noneArchiveProblem } from "../../lanes/weekly-stable/arms.ts";
import { main, paidGate, partProblems, recordLook, type WeekFile } from "../../lanes/weekly-stable/cli.ts";
import { partItems, taskLists } from "../../lanes/weekly-stable/plan.ts";
import { MODEL } from "../../lanes/weekly-stable/pins.ts";
import { beyond, look, owed, reading, uniqueTrials, type WeeklyRow } from "../../lanes/weekly-stable/read.ts";
import { stageArms } from "../../quick/laneb/runner/prepare-run.ts";

const roots: string[] = [];
afterAll(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }); });
const scratch = (p: string) => { const d = mkdtempSync(join(tmpdir(), p)); roots.push(d); return d; };
const sha = (b: string | Buffer) => createHash("sha256").update(b).digest("hex");
const TARS = { candidate: "tar-c", stable: "tar-s", none: "tar-n" };
const RUN = taskLists().run;
const week = (o: Partial<WeekFile> = {}): WeekFile => ({
  date: "2026-11-28", week_of: null, base: "ws-2026-11-28", seed: 1, start: "2026-11-28T06:00:00.000Z", candidate: "c".repeat(40), stable: "s".repeat(40), stable_tag: "v1.0.0.0",
  decision: { kind: "run" } as WeekFile["decision"], held: null, dropped: [], setup_failed: [], contamination: {}, smoke: { rig: [], flag: null, detail: [] }, arms: { pass: true, tars: TARS }, look: null, ...o,
});
let n = 0;
const row = (task: string, arm: WeeklyRow["arm"], pass: boolean, o: Partial<WeeklyRow> = {}): WeeklyRow => ({
  schema: "b1-session/1", model: MODEL.id, part: "s390-1", arm, task, trial: task + "__" + ++n, outcome: "graded", reason: "graded", pass, reward: pass ? 1 : 0, allowance_stop: false, turn_cap: false,
  cost_usd: arm === "none" ? 0.31 : 0.48, tokens: null, steps_seen: null, skill_loads: 0, safety_stop: false, audit_hits: [], detect: null as never, responded: true, opened_at: String(n).padStart(6, "0"),
  tar_sha256: TARS[arm], listing: arm !== "none", listed: 60, hook_events: arm === "none" ? null : 1, routed: arm === "none" ? null : [], skill_calls: [], skill_reads: 0, ...o,
});
/** A task whose candidate loses two of three sessions to stable's three passes on two of every three tasks: a HOLD at the look. */
const holdTask = (t: string, i: number) => [...(i % 3 === 0 ? [1, 1, 1] : [0, 1, 0]).map((p) => row(t, "candidate", !!p)), ...[1, 1, 1].map(() => row(t, "stable", true)), row(t, "none", true)];
const lookRows = () => RUN.slice(0, 65).flatMap(holdTask);
const NO_RESPONSE = "no model response reached the agent";
const jsonl = (rows: object[]) => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
/** A week's work folder: week.json, a table and a results check that passes. */
function workDir(w: WeekFile, rows: object[]) {
  const dir = scratch("weekly-c4-");
  mkdirSync(join(dir, "gstack-clone", "bin"), { recursive: true });
  writeFileSync(join(dir, "gstack-clone", "bin", "gstack-eval-plan"), "process.exit(0);\n");
  writeFileSync(join(dir, "week.json"), JSON.stringify(w));
  writeFileSync(join(dir, "table.jsonl"), jsonl(rows));
  return { dir, table: join(dir, "table.jsonl"), out: join(dir, "out"), week: () => JSON.parse(readFileSync(join(dir, "week.json"), "utf8")) as WeekFile, record: () => JSON.parse(readFileSync(join(dir, "out", "weekly.json"), "utf8")) };
}
async function run(argv: string[]) {
  const errs: string[] = [], orig = console.error;
  console.error = (...m: unknown[]) => { errs.push(m.map(String).join(" ")); };
  try { return { code: await main(argv), err: errs.join("\n") }; } finally { console.error = orig; }
}

describe("section 1: the stop boundary is strict at the look and at the end", () => {
  test("exact equality at 2.797 or 1.977 SE is no stop and no verdict; just past it is", () => {
    expect(beyond(-2.797, 1, 2.797)).toBeNull();
    expect(beyond(2.797, 1, 2.797)).toBeNull();
    expect(beyond(-1.977, 1, 1.977)).toBeNull();
    expect(beyond(1.977, 1, 1.977)).toBeNull();
    expect(beyond(-2.7971, 1, 2.797)).toBe("HOLD");
    expect(beyond(2.7971, 1, 2.797)).toBe("GAIN");
    expect(beyond(-1.9771, 1, 1.977)).toBe("HOLD");
  });
  test("a difference with no spread stops; no difference, or no variance estimate, does not", () => {
    expect(beyond(-0.1, 0, 2.797)).toBe("HOLD");
    expect(beyond(0.1, 0, 2.797)).toBe("GAIN");
    expect(beyond(0, 0, 2.797)).toBeNull();
    expect(beyond(-1, Number.NaN, 2.797)).toBeNull();
  });
  test("the look's stop and the stopped reading's verdict come from the same test", () => {
    const l = look(lookRows(), RUN, []);
    expect(l.stop).toBe(beyond(l.stat!.d, l.stat!.se, 2.797));
    const r = reading({ rows: lookRows(), run: RUN, dropped: [], seed: 1, incomplete: [], flags: [], stoppedAt: "HOLD" });
    expect([r.verdict, beyond(r.stat.d, r.stat.se, r.stat.bound)]).toEqual(["HOLD", "HOLD"]);
  });
});

describe("section 2: the look waits for every arm of its tasks to settle, none rows and reruns included", () => {
  test("a missing none row keeps the look from being ready", () => {
    const rows = lookRows().filter((r) => !(r.task === RUN[64] && r.arm === "none"));
    const l = look(rows, RUN, []);
    expect([l.ready, l.open]).toEqual([false, [RUN[64] + " none: 0 of 1 sessions"]]);
  });
  test("a session with no response waits for its attempt 2; a graded or failed attempt 2 settles it", () => {
    const rows = lookRows(), i = rows.findIndex((r) => r.task === RUN[0] && r.arm === "candidate");
    rows[i] = { ...rows[i]!, outcome: "infra", reason: NO_RESPONSE, pass: false };
    const l = look(rows, RUN, []);
    expect([l.ready, l.open]).toEqual([false, [RUN[0] + " candidate: 1 attempt 2 owed, 0 ran"]]);
    expect(look([...rows, row(RUN[0]!, "candidate", true, { part: "s390-1-a2" })], RUN, []).ready).toBe(true);
    expect(look([...rows, row(RUN[0]!, "candidate", false, { part: "s390-1-a2", outcome: "infra", reason: NO_RESPONSE })], RUN, []).ready).toBe(true);
  });
  test("a first-attempt cap stop owes no rerun, so it settles its arm (the report then reads the week INCOMPLETE)", () => {
    const rows = lookRows(), i = rows.findIndex((r) => r.task === RUN[3] && r.arm === "stable");
    rows[i] = { ...rows[i]!, outcome: "cap_stop", reason: "cap stop", pass: false };
    expect(look(rows, RUN, []).ready).toBe(true);
  });
  test("dropped tasks are not waited for", () => {
    const rows = lookRows().filter((r) => r.task !== RUN[10]);
    expect(look(rows, RUN, []).ready).toBe(false);
    expect(look(rows, RUN, [RUN[10]!]).ready).toBe(true);
  });
});

describe("section 4: a STOP decides nothing alone; the report applies every INCOMPLETE rule to the look's rows", () => {
  test("seven none gaps among the 65 look tasks pass the scaled limit of 6, so a stopped week is INCOMPLETE; six are not", () => {
    const gaps = (k: number) => lookRows().map((r) => (r.arm === "none" && RUN.indexOf(r.task) < k ? { ...r, outcome: "infra" as const, reason: NO_RESPONSE, pass: false } : r));
    const read = (rows: WeeklyRow[]) => reading({ rows, run: RUN, dropped: [], seed: 1, incomplete: [], flags: [], stoppedAt: "HOLD" });
    expect(read(gaps(7)).incomplete_reason).toBe("none has 7 of 65 sessions ungraded, more than 6");
    expect(read(gaps(6)).verdict).toBe("HOLD");
  });
});

describe("section 8: paid commands wait for their checks, and a STOP ends them", () => {
  const stopped = week({ look: { stop: "HOLD", at: "2026-11-29T00:00:00Z", rows: "look-rows.jsonl", rows_sha256: "0".repeat(64) } });
  test("part 1 prepares and hosts the smoke after the arms check and the contamination search", () => {
    const noSmoke = week({ smoke: null });
    expect(paidGate(noSmoke, "prepare", "p1")).toEqual([]);
    expect(paidGate(noSmoke, "host-up", "p1")).toEqual([]);
    expect(paidGate(noSmoke, "launch", "p1", "smoke")).toEqual([]);
    expect(paidGate(noSmoke, "rerun", "p1", "smoke")).toEqual([]);
    expect(paidGate(week({ arms: null, smoke: null }), "prepare", "p1")[0]).toMatch(/arms check/);
    expect(paidGate(week({ contamination: null, smoke: null }), "host-up", "p1")[0]).toMatch(/contamination search/);
  });
  test("part 1's counted tasks, and every command on parts 2 and 3, wait for a smoke with no rig failure", () => {
    const noSmoke = week({ smoke: null }), rig = week({ smoke: { rig: ["t: wrong tar"], flag: null, detail: [] } });
    expect(paidGate(noSmoke, "launch", "p1", "s390-1")[0]).toMatch(/smoke/);
    expect(paidGate(noSmoke, "relaunch", "p1", "s390-1")[0]).toMatch(/smoke/);
    for (const cmd of ["prepare", "host-up", "launch", "relaunch", "rerun"]) {
      expect(paidGate(noSmoke, cmd, "p2", "s390-2")[0]).toMatch(/smoke/);
      expect(paidGate(rig, cmd, "p3", "s390-3")[0]).toMatch(/smoke/);
      expect(paidGate(week(), cmd, "p2", "s390-2")).toEqual([]);
    }
  });
  test("after a STOP, prepare, host-up, launch, relaunch and rerun are refused on every part", () => {
    for (const cmd of ["prepare", "host-up", "launch", "relaunch", "rerun"]) for (const p of ["p1", "p2", "p3"]) expect(paidGate(stopped, cmd, p, "s390-" + p.slice(1)).join("; ")).toMatch(/look stopped for HOLD.*only attach, recover and host-down/);
  });
  test("the command line refuses host-up on part 2 before the smoke, and prepare after a STOP, before L1 runs", async () => {
    const w = workDir(week({ smoke: null }), []), [, item2] = partItems("ws-2026-11-28");
    mkdirSync(join(w.dir, "p2"), { recursive: true });
    writeFileSync(join(w.dir, "p2", "plan.json"), JSON.stringify({ item: item2, parts: [{ name: "s390-2" }] }));
    const up = await run(["host-up", join(w.dir, "p2")]);
    expect([up.code, up.err]).toEqual([2, expect.stringMatching(/^E_USAGE refused: .*smoke/)]);
    const s = workDir(stopped, []);
    mkdirSync(join(s.dir, "p3"), { recursive: true });
    const prep = await run(["prepare", join(s.dir, "p3"), "--item", partItems("ws-2026-11-28")[2]!]);
    expect([prep.code, prep.err]).toEqual([2, expect.stringMatching(/^E_USAGE refused: the look stopped for HOLD/)]);
  });
});

describe("sections 3 and 5: a required look, and its frozen rows", () => {
  test("a ready look writes its tasks' rows beside week.json and records the file's digest; CONTINUE too", async () => {
    const rows = lookRows(), w = workDir(week(), [...rows, row(RUN[65]!, "candidate", true)]);
    expect((await run(["look", w.table, w.dir])).code).toBe(0);
    const recorded = w.week().look!, file = readFileSync(join(w.dir, "look-rows.jsonl"));
    expect([recorded.stop, recorded.rows, recorded.rows_sha256]).toEqual(["HOLD", "look-rows.jsonl", sha(file)]);
    expect(file.toString().trim().split("\n").map((l) => JSON.parse(l).trial)).toEqual(rows.map((r) => r.trial));
    const even = RUN.slice(0, 65).flatMap((t, i) => [...[i % 2, 1, 1].map((p) => row(t, "candidate", !!p)), ...[1 - (i % 2), 1, 1].map((p) => row(t, "stable", !!p)), row(t, "none", true)]);
    const c = workDir(week(), even);
    expect((await run(["look", c.table, c.dir])).code).toBe(0);
    expect([c.week().look!.stop, c.week().look!.rows_sha256]).toEqual([null, sha(readFileSync(join(c.dir, "look-rows.jsonl")))]);
  });
  test("recordLook keeps the snapshot's name and digest, refuses a second look and records nothing when not ready", () => {
    const w = week();
    expect(recordLook(w, { ready: false, stop: null }, "2026-11-29T00:00:00Z", { rows: "look-rows.jsonl", rows_sha256: "a".repeat(64) })).toBe(false);
    expect(w.look).toBeNull();
    expect(recordLook(w, { ready: true, stop: "GAIN" }, "2026-11-29T00:00:00Z", { rows: "look-rows.jsonl", rows_sha256: "a".repeat(64) })).toBe(true);
    expect(w.look).toEqual({ stop: "GAIN", at: "2026-11-29T00:00:00Z", rows: "look-rows.jsonl", rows_sha256: "a".repeat(64) });
    expect(() => recordLook(w, { ready: true, stop: null }, "2026-11-29T01:00:00Z", { rows: "look-rows.jsonl", rows_sha256: "b".repeat(64) })).toThrow(/look already ran/);
  });
  test("a stopped report reads only the frozen rows, whatever table it is given, the same trial ids included; an edited snapshot is refused", async () => {
    const rows = lookRows(), w = workDir(week(), rows);
    expect((await run(["look", w.table, w.dir])).code).toBe(0);
    const late = { ...row(RUN[0]!, "candidate", true), part: "s390-1-a2" };
    writeFileSync(w.table, jsonl([...rows.map((r) => (r.arm === "candidate" ? { ...r, pass: true } : r)), late]));
    expect((await run(["report", w.table, w.dir, "--out", w.out, "--stopped", "HOLD"])).code).toBe(0);
    expect(w.record().verdict).toBe("HOLD");
    expect(readFileSync(join(w.out, "results.md"), "utf8")).toMatch(/#candidate\x60 \| 195 of 195 \| 109 of 195 \|/);
    const snap = join(w.dir, "look-rows.jsonl");
    writeFileSync(snap, readFileSync(snap, "utf8").replace('"pass":false', '"pass":true'));
    const r = await run(["report", w.table, w.dir, "--out", w.out, "--stopped", "HOLD"]);
    expect([r.code, r.err]).toEqual([2, expect.stringMatching(/look-rows.jsonl.*sha256/)]);
  });
  test("a week whose look never became ready reports only INCOMPLETE, and says why", async () => {
    const rows = RUN.flatMap(holdTask), w = workDir(week(), rows);
    expect((await run(["report", w.table, w.dir, "--out", w.out])).code).toBe(0);
    expect([w.record().verdict, w.record().incomplete_reason]).toEqual(["INCOMPLETE", "the interim look was never recorded, so the week has no verdict"]);
  });
});

describe("section 6: part results", () => {
  const parts = (dir: string) => {
    const [, item2] = partItems("ws-2026-11-28");
    mkdirSync(join(dir, "p2", "s390-2-a2"), { recursive: true });
    writeFileSync(join(dir, "p2", "plan.json"), JSON.stringify({ item: item2, parts: [{ name: "s390-2" }] }));
    writeFileSync(join(dir, "p2", "s390-2-a2", "l1-part.json"), JSON.stringify({ name: "s390-2-a2" }));
  };
  test("every planned part, and every attempt 2 or relaunch prepared, needs a result file", () => {
    const dir = scratch("weekly-parts-");
    parts(dir);
    expect(partProblems(dir)).toEqual({ caps: [], missing: ["p2/s390-2", "p2/s390-2-a2"] });
    writeFileSync(join(dir, "p2", "s390-2.result.json"), JSON.stringify({ cap_stop: [], loss: [] }));
    writeFileSync(join(dir, "p2", "s390-2-a2.result.json"), JSON.stringify({ cap_stop: ["the proxy latched a cap stop"], loss: [] }));
    expect(partProblems(dir)).toEqual({ caps: ["p2/s390-2-a2: the proxy latched a cap stop"], missing: [] });
  });
  test("a full report with a part that wrote no result is INCOMPLETE; a stopped one is not (A1)", async () => {
    const full = workDir(week({ look: { stop: null, at: "2026-11-29T00:00:00Z", rows: "look-rows.jsonl", rows_sha256: "0".repeat(64) } }), RUN.flatMap((t) => [...[1, 1, 1].map(() => row(t, "candidate", true)), ...[1, 1, 1].map(() => row(t, "stable", true)), row(t, "none", true)]));
    parts(full.dir);
    expect((await run(["report", full.table, full.dir, "--out", full.out])).code).toBe(0);
    expect([full.record().verdict, full.record().incomplete_reason]).toEqual(["INCOMPLETE", "a part wrote no result (2 parts; detail in the private report)"]);
    expect(readFileSync(join(full.out, "report.txt"), "utf8")).toContain("  no result: p2/s390-2");
    const rows = lookRows(), s = workDir(week(), rows);
    expect((await run(["look", s.table, s.dir])).code).toBe(0);
    parts(s.dir);
    expect((await run(["report", s.table, s.dir, "--out", s.out, "--stopped", "HOLD"])).code).toBe(0);
    expect(s.record().verdict).toBe("HOLD");
  });
});

describe("section 7: each session is read once, from any source", () => {
  test("a JSONL table with a trial twice is refused by smoke, look, report and pilot-report", async () => {
    const rows = lookRows(), w = workDir(week({ look: { stop: null, at: "2026-11-29T00:00:00Z", rows: "look-rows.jsonl", rows_sha256: "0".repeat(64) } }), [...rows, rows[5]!]);
    for (const argv of [["smoke", w.table, w.dir], ["look", w.table, w.dir], ["report", w.table, w.dir, "--out", w.out], ["pilot-report", w.table]]) {
      const r = await run(argv);
      expect([argv[0], r.code, r.err]).toEqual([argv[0], 2, expect.stringMatching(/appears twice/)]);
    }
    expect(() => uniqueTrials(rows, "t")).not.toThrow();
  });
  test("the attempt-2 planner refuses one session pulled twice, so it never owes two reruns for it", () => {
    const root = scratch("weekly-owed-"), name = RUN[0] + "__x1", d = join(root, "jobs", "job1", name);
    mkdirSync(join(d, "evaluator"), { recursive: true });
    writeFileSync(join(d, "config.json"), JSON.stringify({ agent: { name: "laneb-claude-code", kwargs: { arm: "candidate", upstream_model: MODEL.id } }, task: { path: "tasks/" + RUN[0] } }));
    writeFileSync(join(d, "result.json"), JSON.stringify({ trial_name: name, verifier_result: { rewards: { reward: 1 } } }));
    mkdirSync(join(root, "out"), { recursive: true });
    writeFileSync(join(root, "out", "proxy-sessions.jsonl"), JSON.stringify({ id: "s1", trial: name, opened_at: "0001", ok_responses: 0, refused_budget: 0, spent_micros: 0 }) + "\n");
    expect(owed([{ part: "s390-1", dir: root }]).owed.length).toBe(1);
    expect(() => owed([{ part: "s390-1", dir: root }, { part: "s390-1-relaunch", dir: root }])).toThrow(/appears twice/);
  });
});

describe("section 9: archives are checked whole", () => {
  const gz = (dir: string, name: string, body: string, junk = "") => { writeFileSync(join(dir, name + ".raw"), body); spawnSync("sh", ["-c", 'gzip -c "$1" > "$2"', "sh", join(dir, name + ".raw"), join(dir, name + ".tar.gz")]); if (junk) writeFileSync(join(dir, name + ".tar.gz"), Buffer.concat([readFileSync(join(dir, name + ".tar.gz")), Buffer.from(junk)])); };
  test("gzip must exit 0: an archive whose decoded bytes match but which gzip reports bad is refused", () => {
    const d = scratch("weekly-gz-");
    gz(d, "none", "none arm bytes", "trailing junk");
    expect(gunzipSha(join(d, "none.tar.gz"))).toMatchObject({ sha256: sha("none arm bytes"), error: expect.stringMatching(/gzip exited/) });
    expect(noneArchiveProblem(d, sha("none arm bytes"))).toMatch(/gzip exited/);
    gz(d, "none", "none arm bytes");
    expect(gunzipSha(join(d, "none.tar.gz"))).toEqual({ sha256: sha("none arm bytes"), error: null });
    expect(noneArchiveProblem(d, sha("none arm bytes"))).toBeNull();
  });
  test("L1's staging refuses the same archive", () => {
    const root = scratch("weekly-stage-"), armDir = join(root, "tars"), runDir = join(root, "run");
    for (const x of [armDir, join(root, "m"), join(runDir, "arms")]) mkdirSync(x, { recursive: true });
    writeFileSync(join(root, "m", "none.json"), JSON.stringify({ tar: { sha256: sha("none-bytes") } }));
    gz(armDir, "none", "none-bytes", "trailing junk");
    expect(() => stageArms("none", { armDir, run: runDir, root, armManifests: "m", vm: "/vm" })).toThrow(/gzip exited/);
    gz(armDir, "none", "none-bytes");
    expect(stageArms("none", { armDir, run: runDir, root, armManifests: "m", vm: "/vm" })[0]!.sha256).toBe(sha("none-bytes"));
  });
});
