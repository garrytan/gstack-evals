// Copyright (c) 2026 Garry Tan. MIT License.
// Pre-run change 4 (wiki/plans/2026-11-22-geva-573-weekly-stable-pre-run-change-4): the stop boundary, when the look is
// ready, the required look, a STOP that ends paid work, the look's frozen rows, part results, each session read once,
// paid commands behind their checks and archives checked whole.
import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSha, noneArchiveProblem } from "../../lanes/weekly-stable/arms.ts";
import { main, paidGate, partProblems, recordLook, type WeekFile } from "../../lanes/weekly-stable/cli.ts";
import { partItems, taskLists } from "../../lanes/weekly-stable/plan.ts";
import { MODEL } from "../../lanes/weekly-stable/pins.ts";
import { pulledInputs } from "../../lanes/delivery-route/table.ts";
import { beyond, buildWeeklyTable, look, openCells, owed, pairsOf, reading, uniqueTrials, type WeeklyRow } from "../../lanes/weekly-stable/read.ts";
import { Ledger } from "../../quick/laneb/runner/ledger.ts";
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
  test("after a STOP, attach salvages a lost controller without preparing or launching new cells", () => {
    const w = workDir(week(), []), item = partItems("ws-2026-11-28")[2]!, work = join(w.dir, "p3");
    const part = { name: "s390-3", prefix: item + "/s390-3/" }, runner = join(w.dir, "ubi");
    const salvaged = join(w.dir, "salvaged"), calls = join(w.dir, "calls"), ledger = join(w.dir, item + ".jsonl");
    const books = new Ledger(ledger, item), reserveId = item + "/host-1";
    books.approve(20, { quotes: ["test approval"] });
    expect(books.reserve(reserveId, 1_000_000).ok).toBe(true);
    mkdirSync(join(work, "host"), { recursive: true });
    writeFileSync(join(work, "plan.json"), JSON.stringify({ item, parts: [part] }));
    writeFileSync(join(work, "host/pointer"), JSON.stringify({ ledger }));
    writeFileSync(join(work, "host/hosts.jsonl"), jsonl([{ event: "up", n: 1, name: "host-1", up_at: Date.now() / 1000, ttl_hours: 1, reserve_id: reserveId }]));
    writeFileSync(join(work, part.name + ".launch.json"), JSON.stringify({ at: stopped.start, prefix: part.prefix }));
    writeFileSync(runner, [
      "#!/usr/bin/env bash",
      'printf "%s\\n" "$*" >> "$CALLS"',
      'case "$1:$3" in',
      '  ssh:*host-status*) if test -e "$SALVAGED"; then',
      '    echo \'{"parts":{"s390-3":{"alive":false,"launch_exit":null,"salvage":{"pulled":false}}}}\'',
      '  else echo \'{"parts":{"s390-3":{"alive":false,"launch_exit":null}}}\'; fi ;;',
      '  ssh:*host-salvage*) touch "$SALVAGED" ;;',
      '  pull:*/ledger) mkdir -p "$4/ledger"; cp "$LEDGER" "$4/ledger/" ;;',
      '  pull:*/recovery) ;;',
      '  down:*) ;;',
      '  *) exit 2 ;;',
      'esac',
    ].join("\n") + "\n", { mode: 0o700 });
    const cli = (cmd: string, ...args: string[]) => spawnSync(process.execPath, [join(import.meta.dir, "../../lanes/weekly-stable/cli.ts"), cmd, work, ...args], {
      encoding: "utf8", env: { PATH: process.env.PATH, UBI_OWNER: "test", UBI_RUNNER: runner, UBI_RUNNER_SHA256: sha(readFileSync(runner)), UBI_RECOVERY_DIR: w.dir, CALLS: calls, SALVAGED: salvaged, LEDGER: ledger },
    });
    const before = cli("attach");
    expect([before.status, before.stderr, before.stdout]).toEqual([0, "", expect.stringContaining("NEXT: relaunch --part s390-3")]);
    expect(existsSync(salvaged)).toBe(false);
    writeFileSync(join(w.dir, "week.json"), JSON.stringify(stopped));
    expect(cli("relaunch", "--part", part.name).stderr).toMatch(/refused: the look stopped for HOLD/);
    const after = cli("attach");
    expect([after.status, after.stderr, after.stdout]).toEqual([0, "", expect.stringContaining("NEXT: host-down")]);
    expect(JSON.parse(readFileSync(join(work, part.name + ".result.json"), "utf8"))).toMatchObject({ salvage: { pulled: false }, loss: [expect.stringContaining("controller was lost")] });
    const down = cli("host-down");
    expect([down.status, down.stderr]).toEqual([0, ""]);
    expect(books.status().openIds).toEqual([]);
    expect(existsSync(join(work, part.name + "-relaunch"))).toBe(false);
    expect(readFileSync(calls, "utf8")).not.toMatch(/^(?:up|sync) |host\.sh .*launch/m);
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
    expect(partProblems(dir)).toEqual({ caps: [], missing: ["p2/s390-2", "p2/s390-2-a2"], unsettled: [] });
    writeFileSync(join(dir, "p2", "s390-2.result.json"), JSON.stringify({ launch_exit: 0, pulled: true, cap_stop: [], loss: [] }));
    writeFileSync(join(dir, "p2", "s390-2-a2.result.json"), JSON.stringify({ cap_stop: ["the proxy latched a cap stop"], loss: [] }));
    expect(partProblems(dir)).toEqual({ caps: ["p2/s390-2-a2: the proxy latched a cap stop"], missing: [], unsettled: [] });
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

describe("round 2: settled part results, one replacement per never-started session, and canonical part ids", () => {
  const layout = (root: string, part: string, trials: { task: string; arm: string; started: boolean }[], job = part) => {
    const dir = join(root, part, "pulled"), sessions: object[] = [];
    for (const t of trials) {
      const name = t.task + "__" + Math.random().toString(36).slice(2, 9), d = join(dir, "jobs", job, name);
      mkdirSync(join(d, "evaluator"), { recursive: true });
      writeFileSync(join(d, "config.json"), JSON.stringify({ agent: { name: "laneb-claude-code", kwargs: { arm: t.arm, upstream_model: MODEL.id } }, task: { path: "tasks/" + t.task } }));
      writeFileSync(join(d, "result.json"), JSON.stringify(t.started ? { trial_name: name, verifier_result: { rewards: { reward: 1 } } } : { trial_name: name, exception_info: { exception_type: "AgentCancelled" } }));
      if (t.started) sessions.push({ id: "s-" + name, trial: name, opened_at: name, ok_responses: 2, refused_budget: 0, spent_micros: 1000 });
    }
    mkdirSync(join(dir, "out"), { recursive: true });
    writeFileSync(join(dir, "out", "proxy-sessions.jsonl"), sessions.map((s) => JSON.stringify(s)).join("\n") + "\n");
    return dir;
  };
  test("a part whose VM was lost (exit 7) and not yet salvaged has no settled result, so a full report is INCOMPLETE", () => {
    const dir = scratch("weekly-unsettled-"), [, , item3] = partItems("ws-2026-11-28");
    mkdirSync(join(dir, "p3"), { recursive: true });
    writeFileSync(join(dir, "p3", "plan.json"), JSON.stringify({ item: item3, parts: [{ name: "s390-3" }] }));
    writeFileSync(join(dir, "p3", "s390-3.result.json"), JSON.stringify({ launch_exit: 7, pulled: false, cap_stop: [], loss: ["the part's results could not be pulled"], salvage: null }));
    expect(partProblems(dir)).toEqual({ caps: [], missing: [], unsettled: ["p3/s390-3"] });
    writeFileSync(join(dir, "p3", "s390-3.result.json"), JSON.stringify({ launch_exit: 7, pulled: true, cap_stop: ["cap-stop.json: refused"], loss: [], salvage: { by: "relaunch" } }));
    expect(partProblems(dir)).toEqual({ caps: ["p3/s390-3: cap-stop.json: refused"], missing: [], unsettled: [] });
  });
  test("a full report names an unsettled part as INCOMPLETE", async () => {
    const full = workDir(week({ look: { stop: null, at: "2026-11-29T00:00:00Z", rows: "look-rows.jsonl", rows_sha256: "0".repeat(64) } }), RUN.flatMap((t) => [...[1, 1, 1].map(() => row(t, "candidate", true)), ...[1, 1, 1].map(() => row(t, "stable", true)), row(t, "none", true)]));
    mkdirSync(join(full.dir, "p3"), { recursive: true });
    writeFileSync(join(full.dir, "p3", "plan.json"), JSON.stringify({ item: partItems("ws-2026-11-28")[2], parts: [{ name: "s390-3" }] }));
    writeFileSync(join(full.dir, "p3", "s390-3.result.json"), JSON.stringify({ launch_exit: 7, pulled: false, cap_stop: [], loss: [], salvage: null }));
    expect((await run(["report", full.table, full.dir, "--out", full.out])).code).toBe(0);
    expect([full.record().verdict, full.record().incomplete_reason]).toEqual(["INCOMPLETE", "a part's records were never pulled or its ending can't be classed, so a cap stop can't be ruled out (1 part; detail in the private report)"]);
    expect(readFileSync(join(full.out, "report.txt"), "utf8")).toContain("  not settled: p3/s390-3");
  });
  test("a session that never started and was relaunched owes no attempt 2, and its arm settles with the relaunch's row", () => {
    const root = scratch("weekly-replaced-"), t = RUN[0]!;
    const orig = layout(root, "s390-1", [...["candidate", "stable"].flatMap((arm) => [{ task: t, arm, started: true }, { task: t, arm, started: true }, { task: t, arm, started: false }]), { task: t, arm: "none", started: true }]);
    const rel = layout(root, "s390-1-relaunch", ["candidate", "stable"].map((arm) => ({ task: t, arm, started: true })));
    expect(owed([{ part: "s390-1", dir: orig }, { part: "s390-1-relaunch", dir: rel }]).owed).toEqual([]);
    const rows = [...buildWeeklyTable(pulledInputs(orig, "s390-1")), ...buildWeeklyTable(pulledInputs(rel, "s390-1-relaunch"))];
    expect(openCells(rows, [t])).toEqual([]);
    expect(pairsOf(rows, [t]).length).toBe(3);
    expect(owed([{ part: "s390-1", dir: orig }]).owed.length).toBe(2);
  });
  test("a week table takes each job's part from L1's layout, so a Harbor job suffix or a missing label still reads as its part", () => {
    const root = scratch("weekly-layout-"), t = RUN[0]!;
    const dir = layout(root, "s390-1-a2", [{ task: t, arm: "stable", started: true }], "s390-1-a2-2");
    const cfg = pulledInputs(dir, "s390-1-a2-2");
    expect(buildWeeklyTable(cfg).map((r) => r.part)).toEqual(["s390-1-a2"]);
    expect(buildWeeklyTable({ ...cfg, jobs: cfg.jobs.map((j) => ({ dir: j.dir })) }).map((r) => r.part)).toEqual(["s390-1-a2"]);
    const flat = scratch("weekly-flat-");
    mkdirSync(join(flat, "jobs", "job1"), { recursive: true });
    spawnSync("cp", ["-r", join(dir, "jobs", "s390-1-a2-2", "."), join(flat, "jobs", "job1")]);
    expect(() => buildWeeklyTable({ jobs: [{ dir: join(flat, "jobs", "job1") }], sessions: cfg.sessions })).toThrow(/names no L1 part/);
  });
});

describe("round 2: a relaunch replaces only what L1 counts as never started", () => {
  test("a session in flight when its VM died (a ledger reserve, no proxy row) is started: it owes its attempt 2, and the relaunch replaces only the session that never started", () => {
    const work = scratch("weekly-inflight-"), t = RUN[0]!, part = "s390-1";
    const trial = (p: string, name: string, arm: string, state: "graded" | "inflight" | "cancelled") => {
      const d = join(work, p, "pulled", "jobs", p, name);
      mkdirSync(join(d, "evaluator"), { recursive: true });
      writeFileSync(join(d, "config.json"), JSON.stringify({ agent: { name: "laneb-claude-code", kwargs: { arm, upstream_model: MODEL.id } }, task: { path: "tasks/" + t } }));
      if (state === "graded") writeFileSync(join(d, "result.json"), JSON.stringify({ trial_name: name, verifier_result: { rewards: { reward: 1 } } }));
      if (state === "cancelled") writeFileSync(join(d, "result.json"), JSON.stringify({ trial_name: name, exception_info: { exception_type: "AgentCancelled" } }));
      return name;
    };
    const sessions = (p: string, names: string[]) => { mkdirSync(join(work, p, "pulled", "out"), { recursive: true }); writeFileSync(join(work, p, "pulled", "out", "proxy-sessions.jsonl"), names.map((x) => JSON.stringify({ id: "s-" + x, trial: x, opened_at: x, ok_responses: 2, refused_budget: 0, spent_micros: 1000 })).join("\n") + "\n"); };
    const a = trial(part, t + "__aaaaaaa", "candidate", "inflight"), b = trial(part, t + "__bbbbbbb", "candidate", "graded"), c = trial(part, t + "__zzzzzzz", "candidate", "cancelled");
    const others = ["stable", "stable", "stable", "none"].map((arm, i) => trial(part, t + "__o" + i + "ooooo", arm, "graded"));
    sessions(part, [b, ...others]);
    const r1 = trial(part + "-relaunch", t + "__rrrrrrr", "candidate", "graded");
    sessions(part + "-relaunch", [r1]);
    mkdirSync(join(work, "host"), { recursive: true });
    writeFileSync(join(work, "host", "ledger.jsonl"), [a, b, ...others].map((x) => JSON.stringify({ kind: "reserve", id: "ws-2026-11-28-1:" + x, trial: x + "__env" })).join("\n") + "\n");
    const runs = [part, part + "-relaunch"].map((p) => ({ part: p, dir: join(work, p, "pulled") }));
    expect(owed(runs).owed.map((o) => [o.task, o.arm, o.reason.split(",")[0]])).toEqual([[t, "candidate", "no result.json"]]);
    const rows = runs.flatMap((r) => buildWeeklyTable(pulledInputs(r.dir, r.part)));
    expect(openCells(rows, [t])).toEqual([t + " candidate: 1 attempt 2 owed, 0 ran"]);
    expect(openCells([...rows, row(t, "candidate", true, { part: part + "-a2" })], [t])).toEqual([]);
  });
});

describe("follow-up: a part whose records were never pulled, or whose ending can't be classed, is never settled", () => {
  const item3 = () => partItems("ws-2026-11-28")[2];
  const p3 = (dir: string, result: object | null, o: { plan?: boolean; recover?: object } = {}) => {
    mkdirSync(join(dir, "p3", "host"), { recursive: true });
    if (o.plan !== false) writeFileSync(join(dir, "p3", "plan.json"), JSON.stringify({ item: item3(), parts: [{ name: "s390-3" }] }));
    if (result) writeFileSync(join(dir, "p3", "s390-3.result.json"), JSON.stringify(result));
    if (o.recover) writeFileSync(join(dir, "p3", "host", "recover.json"), JSON.stringify(o.recover));
  };
  test("a salvage that pulled nothing leaves the part unsettled", () => {
    const dir = scratch("weekly-fu-salvage-");
    p3(dir, { launch_exit: 7, pulled: false, cap_stop: [], loss: ["the part's results could not be pulled"], unclassified: [], salvage: { by: "relaunch", pulled: false, vm_down: true } });
    expect(partProblems(dir)).toEqual({ caps: [], missing: [], unsettled: ["p3/s390-3"] });
  });
  test("a lost host whose running part's records were lost (exit null, no salvage, recover incomplete) leaves the part and the host unsettled", () => {
    const dir = scratch("weekly-fu-recover-");
    p3(dir, { launch_exit: null, pulled: false, cap_stop: [], loss: ["the awake host was lost"], unclassified: [] }, { recover: { complete: false, running: "s390-3", part_results_pulled: false } });
    expect(partProblems(dir)).toEqual({ caps: [], missing: [], unsettled: ["p3/host", "p3/s390-3"] });
  });
  test("recover that rebuilt a pulled part but missed sessions still leaves the host unsettled", () => {
    const dir = scratch("weekly-fu-recover2-");
    p3(dir, { launch_exit: null, pulled: true, cap_stop: [], loss: ["the awake host was lost"], unclassified: [] }, { recover: { complete: false, running: "s390-3", part_results_pulled: true, missing_sessions: ["s-1"] } });
    expect(partProblems(dir)).toEqual({ caps: [], missing: [], unsettled: ["p3/host"] });
  });
  test("a salvage whose own pull failed stays unsettled even when a partial transfer left the folders", () => {
    const dir = scratch("weekly-fu-salvage-partial-");
    p3(dir, { launch_exit: 7, pulled: true, cap_stop: [], loss: ["the part's results could not be pulled"], unclassified: [], salvage: { by: "attach", pulled: false, vm_down: true } });
    expect(partProblems(dir)).toEqual({ caps: [], missing: [], unsettled: ["p3/s390-3"] });
  });
  test("a part kept at exit 7 and never salvaged stays unsettled even when a partial pull left its folders", () => {
    const dir = scratch("weekly-fu-partial-");
    p3(dir, { launch_exit: 7, pulled: true, cap_stop: [], loss: ["the part's results could not be pulled"], unclassified: [] });
    expect(partProblems(dir)).toEqual({ caps: [], missing: [], unsettled: ["p3/s390-3"] });
  });
  test("an ending L1 could not class leaves the part unsettled", () => {
    const dir = scratch("weekly-fu-unclassified-");
    p3(dir, { launch_exit: 0, vm_run_exit: "4", pulled: true, cap_stop: [], loss: [], unclassified: ["vm-run.sh exited 4, and the item's ledger was not read"] });
    expect(partProblems(dir)).toEqual({ caps: [], missing: [], unsettled: ["p3/s390-3"] });
  });
  test("a part folder with no plan.json is unsettled, since its parts can't be listed", () => {
    const dir = scratch("weekly-fu-noplan-");
    p3(dir, { launch_exit: 0, pulled: true, cap_stop: [], loss: [], unclassified: [] }, { plan: false });
    expect(partProblems(dir)).toEqual({ caps: [], missing: [], unsettled: ["p3"] });
  });
  test("a pulled part, a part where L1 shows no trial started, and a part with a cap stop are not flagged as unsettled", () => {
    for (const r of [
      { launch_exit: 0, pulled: true, cap_stop: [], loss: [], unclassified: [] },
      { launch_exit: 1, pulled: false, cap_stop: [], loss: ["the part VM never reached running (VM did not reach running), and the item's ledger holds no session or judge row for this part, so no trial started"], unclassified: [] },
    ]) {
      const dir = scratch("weekly-fu-settled-");
      p3(dir, r);
      expect(partProblems(dir)).toEqual({ caps: [], missing: [], unsettled: [] });
    }
    const dir = scratch("weekly-fu-cap-");
    p3(dir, { launch_exit: 7, pulled: false, cap_stop: ["the part's results were not pulled, and the item's ledger came within one session cap"], loss: [], unclassified: [] });
    expect(partProblems(dir)).toEqual({ caps: ["p3/s390-3: the part's results were not pulled, and the item's ledger came within one session cap"], missing: [], unsettled: [] });
  });
  test("a full report with a salvage that pulled nothing is INCOMPLETE", async () => {
    const full = workDir(week({ look: { stop: null, at: "2026-11-29T00:00:00Z", rows: "look-rows.jsonl", rows_sha256: "0".repeat(64) } }), RUN.flatMap((t) => [...[1, 1, 1].map(() => row(t, "candidate", true)), ...[1, 1, 1].map(() => row(t, "stable", true)), row(t, "none", true)]));
    p3(full.dir, { launch_exit: 7, pulled: false, cap_stop: [], loss: [], unclassified: [], salvage: { by: "attach", pulled: false, vm_down: true } });
    expect((await run(["report", full.table, full.dir, "--out", full.out])).code).toBe(0);
    expect(full.record().verdict).toBe("INCOMPLETE");
    expect(full.record().incomplete_reason).toContain("a cap stop can't be ruled out");
    expect(readFileSync(join(full.out, "report.txt"), "utf8")).toContain("  not settled: p3/s390-3");
  });
  test("an attempt-2 row whose session never started does not settle an owed rerun", () => {
    const rows = lookRows(), i = rows.findIndex((r) => r.task === RUN[0] && r.arm === "candidate");
    rows[i] = { ...rows[i]!, outcome: "infra", reason: NO_RESPONSE, pass: false };
    const queued = row(RUN[0]!, "candidate", false, { part: "s390-1-a2", outcome: "infra", reason: "no result.json", opened_at: null, started: false });
    expect(look([...rows, queued], RUN, []).open).toEqual([RUN[0] + " candidate: 1 attempt 2 owed, 0 ran"]);
    expect(look([...rows, { ...queued, started: true }], RUN, []).ready).toBe(true);
  });
  test("a job given by a relative path still takes its part from L1's folder layout", () => {
    const root = scratch("weekly-fu-rel-"), t = RUN[0]!, job = join(root, "s390-1-a2", "pulled", "jobs", "s390-1-a2"), name = t + "__relpath";
    mkdirSync(join(job, name, "evaluator"), { recursive: true });
    writeFileSync(join(job, name, "config.json"), JSON.stringify({ agent: { name: "laneb-claude-code", kwargs: { arm: "stable", upstream_model: MODEL.id } }, task: { path: "tasks/" + t } }));
    writeFileSync(join(job, name, "result.json"), JSON.stringify({ trial_name: name, verifier_result: { rewards: { reward: 1 } } }));
    const cwd = process.cwd();
    try {
      process.chdir(job);
      expect(buildWeeklyTable({ jobs: [{ dir: "." }], sessions: [] }).map((r) => r.part)).toEqual(["s390-1-a2"]);
    } finally { process.chdir(cwd); }
  });
});


describe("follow-up review: cap-stopped reruns, interrupted recovery and reruns whose VM never ran", () => {
  const item3 = () => partItems("ws-2026-11-28")[2];
  const pulled = { launch_exit: 0, pulled: true, cap_stop: [], loss: [], unclassified: [] };
  const part3 = (dir: string) => {
    mkdirSync(join(dir, "p3", "host"), { recursive: true });
    writeFileSync(join(dir, "p3", "plan.json"), JSON.stringify({ item: item3(), parts: [{ name: "s390-3" }] }));
    writeFileSync(join(dir, "p3", "s390-3.result.json"), JSON.stringify(pulled));
  };
  test("an attempt-2 cap-stop row settles its slot even with no start evidence", () => {
    const rows = lookRows(), i = rows.findIndex((r) => r.task === RUN[0] && r.arm === "candidate");
    rows[i] = { ...rows[i]!, outcome: "infra", reason: NO_RESPONSE, pass: false };
    const cap = row(RUN[0]!, "candidate", false, { part: "s390-1-a2", outcome: "cap_stop", reason: "cap stop", opened_at: null, started: false });
    expect(look([...rows, cap], RUN, []).ready).toBe(true);
  });
  test("an unreadable recover.json, or a recorded host loss with no recover.json, leaves the host unsettled", () => {
    const a = scratch("weekly-fr-torn-");
    part3(a);
    writeFileSync(join(a, "p3", "host", "recover.json"), "{");
    expect(partProblems(a).unsettled).toEqual(["p3/host"]);
    const b = scratch("weekly-fr-nomarker-");
    part3(b);
    writeFileSync(join(b, "p3", "host", "hosts.jsonl"), JSON.stringify({ event: "up", n: 1, name: "host-1" }) + "\n" + JSON.stringify({ event: "lost", n: 1, name: "host-1" }) + "\n");
    expect(partProblems(b).unsettled).toEqual(["p3/host"]);
    writeFileSync(join(b, "p3", "host", "recover.json"), JSON.stringify({ complete: true, host: "host-1" }));
    expect(partProblems(b).unsettled).toEqual([]);
  });
  test("a full report with a torn recover.json still writes an INCOMPLETE record", async () => {
    const full = workDir(week({ look: { stop: null, at: "2026-11-29T00:00:00Z", rows: "look-rows.jsonl", rows_sha256: "0".repeat(64) } }), RUN.flatMap((t) => [...[1, 1, 1].map(() => row(t, "candidate", true)), ...[1, 1, 1].map(() => row(t, "stable", true)), row(t, "none", true)]));
    part3(full.dir);
    writeFileSync(join(full.dir, "p3", "host", "recover.json"), "{");
    expect((await run(["report", full.table, full.dir, "--out", full.out])).code).toBe(0);
    expect(full.record().verdict).toBe("INCOMPLETE");
    expect(readFileSync(join(full.out, "report.txt"), "utf8")).toContain("  not settled: p3/host");
  });
  test("an attempt 2 whose VM never reached running started no trial, so it is settled", () => {
    const dir = scratch("weekly-fr-a2boot-");
    part3(dir);
    mkdirSync(join(dir, "p3", "s390-3-a2"), { recursive: true });
    writeFileSync(join(dir, "p3", "s390-3-a2", "l1-part.json"), JSON.stringify({ name: "s390-3-a2", attempt_of: "s390-3" }));
    writeFileSync(join(dir, "p3", "s390-3-a2", "vm-never-running"), "VM did not reach running in 600 s\n");
    writeFileSync(join(dir, "p3", "s390-3-a2.result.json"), JSON.stringify({ launch_exit: 1, pulled: false, cap_stop: [], loss: [], unclassified: [] }));
    expect(partProblems(dir)).toEqual({ caps: [], missing: [], unsettled: [] });
  });
});


describe("pre-run change 5: a host loss settles only through the recovery of that host", () => {
  const item3 = () => partItems("ws-2026-11-28")[2];
  const part3 = (dir: string, hosts: string | null, recover: object | null) => {
    mkdirSync(join(dir, "p3", "host"), { recursive: true });
    writeFileSync(join(dir, "p3", "plan.json"), JSON.stringify({ item: item3(), parts: [{ name: "s390-3" }] }));
    writeFileSync(join(dir, "p3", "s390-3.result.json"), JSON.stringify({ launch_exit: 0, pulled: true, cap_stop: [], loss: [], unclassified: [] }));
    if (hosts !== null) writeFileSync(join(dir, "p3", "host", "hosts.jsonl"), hosts);
    if (recover) writeFileSync(join(dir, "p3", "host", "recover.json"), JSON.stringify(recover));
  };
  const up = (n: number, name: string) => JSON.stringify({ event: "up", n, name }) + "\n";
  const lost = (n: number, name: string, at: number) => JSON.stringify({ event: "lost", n, name, down_confirmed_at: at }) + "\n";
  const twoLosses = up(1, "host-a") + lost(1, "host-a", 100) + up(2, "host-b") + lost(2, "host-b", 200);
  const full = () => workDir(week({ look: { stop: null, at: "2026-11-29T00:00:00Z", rows: "look-rows.jsonl", rows_sha256: "0".repeat(64) } }), RUN.flatMap((t) => [...[1, 1, 1].map(() => row(t, "candidate", true)), ...[1, 1, 1].map(() => row(t, "stable", true)), row(t, "none", true)]));
  test("an earlier host's complete recovery never settles a later loss", () => {
    const dir = scratch("weekly-c5-stale-");
    part3(dir, twoLosses, { complete: true, host: "host-a", down_confirmed_at: 100 });
    expect(partProblems(dir).unsettled).toEqual(["p3/host"]);
    writeFileSync(join(dir, "p3", "host", "recover.json"), JSON.stringify({ complete: true, host: "host-b", down_confirmed_at: 150 }));
    expect(partProblems(dir).unsettled).toEqual(["p3/host"]);
    writeFileSync(join(dir, "p3", "host", "recover.json"), JSON.stringify({ complete: true, host: "host-b", down_confirmed_at: 200 }));
    expect(partProblems(dir).unsettled).toEqual([]);
  });
  test("a complete recover.json with no recorded loss, or one that names no host, settles nothing", () => {
    const a = scratch("weekly-c5-nolost-");
    part3(a, up(1, "host-a"), { complete: true, host: "host-a", down_confirmed_at: 100 });
    expect(partProblems(a).unsettled).toEqual(["p3/host"]);
    const b = scratch("weekly-c5-noname-");
    part3(b, up(1, "host-a") + lost(1, "host-a", 100), { complete: true });
    expect(partProblems(b).unsettled).toEqual(["p3/host"]);
  });
  test("a full report after a later loss that an earlier recovery hides is INCOMPLETE", async () => {
    const f = full();
    part3(f.dir, twoLosses, { complete: true, host: "host-a", down_confirmed_at: 100 });
    expect((await run(["report", f.table, f.dir, "--out", f.out])).code).toBe(0);
    expect(f.record().verdict).toBe("INCOMPLETE");
    expect(f.record().incomplete_reason).toContain("a cap stop can't be ruled out");
    expect(readFileSync(join(f.out, "report.txt"), "utf8")).toContain("  not settled: p3/host");
  });
  test("a torn line in hosts.jsonl leaves the host unsettled, even when the recovery matches the newest loss it can read", () => {
    const dir = scratch("weekly-c5-torn-");
    part3(dir, up(1, "host-a") + lost(1, "host-a", 100) + up(2, "host-b") + '{"event":"lo\n', { complete: true, host: "host-a", down_confirmed_at: 100 });
    expect(partProblems(dir).unsettled).toEqual(["p3/host"]);
  });
  test("an unreadable hosts.jsonl leaves the host unsettled, and the full report still writes an INCOMPLETE record", async () => {
    const dir = scratch("weekly-c5-unreadable-");
    part3(dir, null, null);
    mkdirSync(join(dir, "p3", "host", "hosts.jsonl"));
    expect(partProblems(dir).unsettled).toEqual(["p3/host"]);
    const f = full();
    part3(f.dir, null, null);
    mkdirSync(join(f.dir, "p3", "host", "hosts.jsonl"));
    const r = await run(["report", f.table, f.dir, "--out", f.out]);
    expect([r.code, r.err]).toEqual([0, expect.not.stringContaining("E_INTERNAL")]);
    expect(f.record().verdict).toBe("INCOMPLETE");
    expect(readFileSync(join(f.out, "report.txt"), "utf8")).toContain("  not settled: p3/host");
  });
});
