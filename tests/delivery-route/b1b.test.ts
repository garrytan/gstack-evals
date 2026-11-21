// Copyright (c) 2026 Garry Tan. MIT License.
// B1b (lanes/delivery-route/b1b.ts): the load detector both ways, the reason a session didn't load, the decision table and
// its guard, the caps and the launch guard, the none arm's reuse check, the two arm trees, the route table and the four
// scripted sessions' captures.
import { describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { B1B_CASES, b1bApprove, b1bCap, b1bCaseProblems, b1bCheck, b1bDone, b1bGuard, b1bReading, b1bReport, b1bRow, b1bStats, checkB1bRows, harnessDirty, loadB1bCaptured, loadsOf, paired, READINGS, reuseCheck, whyNot, type B1bRow, type Load } from "../../lanes/delivery-route/b1b.ts";
import { B1B_BUNDLE, B1B_CAPS_USD, HOOK_SUBSTITUTIONS, ROUTING, type B1bArm } from "../../lanes/delivery-route/b1b-pins.ts";
import { B1B_RUN } from "../../lanes/delivery-route/b1c-pins.ts";
import { ARM_SOURCES, REPO } from "../../lanes/delivery-route/pins.ts";
import { b1Row, type B1Row } from "../../lanes/delivery-route/table.ts";
import { readRows } from "../../quick/laneb/runner/ledger.ts";

const SKILL_MD = "/root/.claude/skills/prove-it/SKILL.md";
const call = (id: string, name: string, input: object) => ({ type: "AssistantMessage", content: [{ type: "tool_use", id, name, input }] });
const result = (id: string, content: string, is_error = false) => ({ type: "UserMessage", content: [{ type: "tool_result", tool_use_id: id, content, is_error }] });
const text = (t: string) => ({ type: "AssistantMessage", content: [{ type: "text", text: t }] });
const LINE = readFileSync(join(REPO, ARM_SOURCES, "gstack-shaped-SKILL.md"), "utf8").split("\n").map((l) => l.trim()).find((l) => l.length >= 40)!;

describe("the load detector", () => {
  test("a Skill call, a Read of the SKILL.md and a Bash read of it each count when they work", () => {
    expect(loadsOf([call("a", "Skill", { skill: "prove-it" }), result("a", "Launching skill: prove-it")] as any)).toMatchObject({ loaded: true, via: "Skill", at_call: 1, failed: 0 });
    expect(loadsOf([call("a", "Bash", { command: "ls" }), result("a", "x"), call("b", "Read", { file_path: SKILL_MD }), result("b", "1\t---")] as any)).toMatchObject({ loaded: true, via: "Read", at_call: 2 });
    expect(loadsOf([call("a", "Read", { file_path: "~/.claude/skills/prove-it/SKILL.md" }), result("a", "ok")] as any).via).toBe("Read");
    expect(loadsOf([call("a", "Bash", { command: "cat " + SKILL_MD }), result("a", "header\n" + LINE + "\n")] as any)).toMatchObject({ loaded: true, via: "Bash" });
  });
  test("a load-shaped call that errors, or a Bash call that never prints the file, is a failed load", () => {
    expect(loadsOf([call("a", "Skill", { skill: "prove-it" }), result("a", "Unknown skill", true)] as any)).toMatchObject({ loaded: false, failed: 1 });
    expect(loadsOf([call("a", "Bash", { command: "cat " + SKILL_MD }), result("a", "No such file")] as any)).toMatchObject({ loaded: false, failed: 1 });
    expect(loadsOf([call("a", "Skill", { skill: "prove-it" })] as any)).toMatchObject({ loaded: false, failed: 1 });
  });
  test("another skill or file does not count; naming the skill in text or another call is named", () => {
    expect(loadsOf([call("a", "Skill", { skill: "plugin-authoring" }), result("a", "Launching skill: plugin-authoring")] as any)).toMatchObject({ loaded: false, named: false, failed: 0 });
    expect(loadsOf([text("I will use prove-it here."), call("a", "Read", { file_path: "/testbed/calc.py" }), result("a", "x")] as any)).toMatchObject({ loaded: false, named: true, first_text: "I will use prove-it here." });
    expect(loadsOf([call("a", "Grep", { pattern: "prove-it" }), result("a", "")] as any)).toMatchObject({ loaded: false, named: true });
  });
  test("the SDK log's text blocks carry no type field, and they are still read as the model's text", () => {
    const sdk = (t: string) => ({ type: "AssistantMessage", content: [{ text: t }] });
    const l = loadsOf([call("a", "Bash", { command: "ls" }), result("a", "x"), sdk("The routing hook asked me to run /prove-it. I didn't.")] as any);
    expect(l).toMatchObject({ loaded: false, named: true, first_text: "The routing hook asked me to run /prove-it. I didn't." });
    expect(whyNot("hook", "graded", l, true)).toBe("named, not loaded");
    expect(loadsOf([{ type: "AssistantMessage", content: [{ thinking: "prove-it", signature: "s" }] }, { type: "UserMessage", content: [{ text: "prove-it" }] }] as any)).toMatchObject({ named: false, first_text: "" });
  });
});

const load = (over: Partial<Load> = {}): Load => ({ loaded: false, via: null, at_call: null, failed: 0, named: false, first_text: "", ...over });
describe("the reason a session didn't load", () => {
  test("first that applies, and none for a load or an ungraded session", () => {
    expect(whyNot("hook", "graded", load({ failed: 1, named: true }), false)).toBe("line not delivered");
    expect(whyNot("hook", "graded", load({ failed: 1 }), true)).toBe("load failed");
    expect(whyNot("claude-md", "graded", load({ failed: 1 }), null)).toBe("load failed");
    expect(whyNot("claude-md", "graded", load({ named: true }), null)).toBe("named, not loaded");
    expect(whyNot("hook", "graded", load(), true)).toBe("never named");
    expect(whyNot("hook", "graded", load({ loaded: true, via: "Skill" }), false)).toBeNull();
    expect(whyNot("claude-md", "infra", load(), null)).toBeNull();
  });
});

const row = (arm: B1bArm, task: string, loaded: boolean, followed = loaded, outcome: B1Row["outcome"] = "graded"): B1bRow => ({
  schema: "b1-session/1", model: "claude-opus-5-5", part: "b1b-1", arm, task, trial: task + "__" + arm, outcome, reason: outcome, pass: false, reward: outcome === "graded" ? 0 : null,
  allowance_stop: false, turn_cap: false, cost_usd: 0.5, tokens: 1, steps_seen: loaded, skill_loads: loaded ? 1 : 0, safety_stop: false, audit_hits: [],
  detect: { followed, followed_tool_only: followed, followed_as_merged: followed, test_before_source: followed, failing_before_source: followed, passing_after_source: followed, source_changed: true, bash_only_source: false, source_write_unseen: false, unread_background: 0, unresolved_writes: 0, spec_folder_write: false, test_file: null, fix_files: [] },
  load: load(loaded ? { loaded: true, via: "Skill", at_call: 1 } : {}), route_mark: arm === "hook" ? true : null, route_logged: arm === "hook" ? true : null, why_not: outcome === "graded" && !loaded ? "never named" : null,
});
/** 60 tasks; each arm loads on tasks [from, from + k), and the last gaps tasks are ungraded. */
const rows = (k: Record<B1bArm, number>, from: Partial<Record<B1bArm, number>> = {}, gaps: Partial<Record<B1bArm, number>> = {}) =>
  (["claude-md", "hook"] as B1bArm[]).flatMap((a) => Array.from({ length: 60 }, (_, i) => row(a, "t" + i, i >= (from[a] ?? 0) && i < (from[a] ?? 0) + k[a], undefined, i >= 60 - (gaps[a] ?? 0) ? "infra" : "graded")));
const read = (r: B1bRow[]) => b1bReading(b1bStats(r, 60), paired(r.filter((x) => x.arm === "hook"), r.filter((x) => x.arm === "claude-md"), (x: any) => x.load.loaded, (x: any) => x.load.loaded)).key;

describe("the decision table", () => {
  test("the bar is 48 of 60 graded, and 6 gaps are allowed", () => {
    const s = b1bStats(rows({ "claude-md": 47, hook: 48 }), 60);
    expect(s.map((x) => [x.arm, x.loaded, x.reaches])).toEqual([["claude-md", 47, false], ["hook", 48, true]]);
    expect(b1bStats(rows({ "claude-md": 44, hook: 0 }, {}, { "claude-md": 5 }), 60)[0]).toMatchObject({ graded: 55, loaded: 44, reaches: true, incomplete: false });
    expect(b1bStats(rows({ "claude-md": 50, hook: 50 }, {}, { hook: 7 }), 60)[1]!.incomplete).toBe(true);
  });
  test("every cell", () => {
    expect(read(rows({ "claude-md": 50, hook: 55 }))).toBe("both");
    expect(read(rows({ "claude-md": 20, hook: 55 }))).toBe("hook");
    expect(read(rows({ "claude-md": 55, hook: 20 }))).toBe("claude-md");
    expect(read(rows({ "claude-md": 30, hook: 40 }))).toBe("neither");
    expect(read(rows({ "claude-md": 50, hook: 50 }, {}, { hook: 7 }))).toBe("incomplete");
    const capped = rows({ "claude-md": 55, hook: 55 });
    capped[3] = { ...capped[3]!, outcome: "cap_stop", why_not: null };
    expect(read(capped)).toBe("incomplete");
  });
  test("the guard: one route at the bar and the other just under it, with a paired interval that holds 0, is not shown", () => {
    expect(read(rows({ "claude-md": 47, hook: 48 }))).toBe("not-shown");
    expect(read(rows({ "claude-md": 48, hook: 47 }))).toBe("not-shown");
    expect(READINGS["not-shown"]).toContain("changes nothing");
  });
  test("the paired difference counts discordant tasks, and the report reads B1's Opus references from its pinned bundle", () => {
    const r = rows({ "claude-md": 30, hook: 40 }, { hook: 20 });
    const p = paired(r.filter((x) => x.arm === "hook"), r.filter((x) => x.arm === "claude-md"), (x: any) => x.load.loaded, (x: any) => x.load.loaded);
    expect([p.pairs, p.both, p.a_only, p.b_only, p.neither]).toEqual([60, 10, 30, 20, 0]);
    const rep = b1bReport(r);
    expect(rep.lines.find((l) => l.includes("reference, B1 none"))).toBe("  reference, B1 none (reused no-gstack arm): followed 0/60, steps seen 0");
    expect(rep.lines.find((l) => l.includes("reference, B1 gstack-shaped"))).toContain("steps seen 60");
    expect(rep.reading?.key).toBe("neither");
  });
  test("rows the report reads: a task outside the draw, another model, or two graded rows for one cell", () => {
    const r = [row("hook", "t0", true), row("hook", "t0", false), { ...row("claude-md", "t1", true), model: "gpt-6.1-sol" }, row("claude-md", "zz", true)];
    expect(checkB1bRows(r, ["t0", "t1"]).sort()).toEqual(["t1__claude-md ran gpt-6.1-sol, not claude-opus-5-5", "two graded rows for hook t0", "zz__claude-md is task zz, not one of the planned tasks"]);
  });
  test("a smoke-only table prints its stats and no reading", () => {
    const r = (["claude-md", "hook"] as B1bArm[]).flatMap((a) => ["yt-project__unyt-628", "getmoto__moto-9590"].map((t) => row(a, t, true)));
    const rep = b1bReport(r, [], 2, true);
    expect(rep.reading).toBeNull();
    expect(rep.lines.some((l) => l.startsWith("  reading:"))).toBe(false);
    expect(rep.lines.some((l) => l.startsWith("  hook: loaded 2/2"))).toBe(true);
    expect(b1bReport(r, [], 2).reading?.key).toBe("both");
  });
  test("safety stops count every row of the arm, ungraded ones included, as B1's report does", () => {
    const r = [...rows({ "claude-md": 0, hook: 0 }), { ...row("hook", "t59", false, false, "infra"), trial: "t59__hook-a2", safety_stop: true }];
    expect(b1bStats(r, 60).map((s) => [s.arm, s.safety_stops])).toEqual([["claude-md", 0], ["hook", 1]]);
  });
});

describe("money", () => {
  test("each cap is the recorded formula: 1.35 x expected, six open allowances and the VM share, rounded up to $10", () => {
    for (const i of ["b1b-smoke", "b1b-opus"] as const) expect(b1bCap(i).cap).toBe(B1B_CAPS_USD[i]);
    expect(b1bCap("b1b-opus")).toMatchObject({ expected: 57.6, parallel: 30 });
  });
  test("the approval row takes only the recorded cap, once", () => {
    const dir = mkdtempSync(join(tmpdir(), "b1b-ledger-")), path = join(dir, "b1b-opus.jsonl");
    try {
      expect(() => b1bApprove(path, "b1b-opus", 120, "the Captain")).toThrow(/refused: b1b-opus's recorded cap is \$130/);
      expect(() => b1bApprove(path, "b1b-opus", 130, " ")).toThrow(/approved-by/);
      expect(() => b1bApprove(path, "b1-opus", 130, "the Captain")).toThrow(/unknown item/);
      b1bApprove(path, "b1b-opus", 130, "the Captain");
      expect(readRows(path).map((r) => r.kind)).toEqual(["approval"]);
      expect(() => b1bApprove(path, "b1b-opus", 130, "the Captain")).toThrow(/already holds rows/);
      expect(b1bGuard("b1b-opus", { "b1b-opus": readRows(path) }, {}, 0).ok).toBe(true);
      b1bDone(path, "b1b-opus");
      const g = b1bGuard("b1b-opus", { "b1b-opus": readRows(path) }, {}, 0);
      expect(g.ok).toBe(false);
      expect(g.why).toContain("b1b-opus is marked done; a done item never launches again");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  test("the launch guard counts both items' projections and the crew's counter against the $250 stop", () => {
    expect(b1bGuard("b1b-opus", {}, {}, 100).ok).toBe(true);
    const g = b1bGuard("b1b-opus", {}, {}, 110);
    expect(g.ok).toBe(false);
    expect(g.why[0]).toMatch(/^all-in \$251\.\d\d passes the \$250\.00 stop$/);
  });
});

describe("the none arm's reuse", () => {
  test("every session-deciding tree is the same at B1b's run commit as at B1's run commit", () => {
    const r = reuseCheck(B1B_RUN.commit);
    expect(r.lines.filter((l) => !l.startsWith("SAME "))).toEqual([expect.stringMatching(/^REUSE PASS/)]);
    expect(r.same).toBe(true);
  });
  test("the launch guard's dirty check refuses an uncommitted change to a harness path and passes a clean one", () => {
    const repo = mkdtempSync(join(tmpdir(), "b1b-dirty-"));
    try {
      const sh = (args: string[]) => expect(spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" }).status).toBe(0);
      sh(["init", "-q"]);
      mkdirSync(join(repo, "quick/laneb/runner"), { recursive: true });
      writeFileSync(join(repo, "quick/laneb/runner/a.py"), "x = 1\n");
      writeFileSync(join(repo, "notes.txt"), "a\n");
      sh(["add", "-A"]);
      sh(["-c", "user.name=b1b", "-c", "user.email=b1b@example.invalid", "commit", "-qm", "snapshot"]);
      writeFileSync(join(repo, "notes.txt"), "b\n");
      expect(harnessDirty(repo)).toEqual([]);
      writeFileSync(join(repo, "quick/laneb/runner/a.py"), "x = 2\n");
      expect(harnessDirty(repo)).toEqual([" M quick/laneb/runner/a.py"]);
    } finally { rmSync(repo, { recursive: true, force: true }); }
  });
});

describe("arms", () => {
  test("the routing block names /prove-it in place of the bug line, and the hook carries its one change", () => {
    const md = readFileSync(join(REPO, ARM_SOURCES, "b1b/CLAUDE.md"), "utf8"), hook = readFileSync(join(REPO, ARM_SOURCES, "b1b/gstack/hosts/claude/hooks/skill-route-hook.ts.txt"), "utf8");
    expect([md.startsWith(ROUTING.heading), md.includes(ROUTING.bug[1]), md.includes(ROUTING.bug[0])]).toEqual([true, true, false]);
    for (const [from, to] of HOOK_SUBSTITUTIONS) expect([hook.split(to).length - 1, hook.includes(from)]).toEqual([1, false]);
  });
  test("each tree is B1's gstack-shaped tree byte for byte plus its route's files, and the tars rebuild against the manifests", () => {
    const r = b1bCheck();
    expect(r.lines.filter((l) => l.startsWith("PROBLEM"))).toEqual([]);
    expect(r.pass).toBe(true);
  });
});

describe("the route table", () => {
  const t = readFileSync(join(REPO, B1B_BUNDLE, "route-table.tsv"), "utf8").trim().split("\n").slice(1).map((l) => l.split("\t"));
  test("as shipped, gstack's hook names no skill on any of the 62 prompts; the arm's hook names /prove-it on all of them", () => {
    expect(t.length).toBe(62);
    expect(t.filter((x) => x[4]!.startsWith("routed"))).toEqual([]);
    expect(t.filter((x) => !x[8])).toEqual([]);
    expect(t.filter((x) => x[0] === "run" && x[7] === "true").length).toBe(22);
  });
});

describe("the table", () => {
  const FIX = join(import.meta.dir, "fixtures/b1b-sessions"), job = mkdtempSync(join(tmpdir(), "b1b-table-"));
  let n = 0;
  const trial = (arm: string, capture: string, mark: boolean | null, log: string | null) => {
    const name = "t1__" + ++n, dir = join(job, name);
    mkdirSync(join(dir, "evaluator", "gstack-hooks", "hooks"), { recursive: true });
    writeFileSync(join(dir, "config.json"), JSON.stringify({ agent: { name: "laneb-claude-code", kwargs: { arm, upstream_model: "claude-opus-5-5" } }, task: { path: "tasks/t1" } }));
    writeFileSync(join(dir, "result.json"), JSON.stringify({ trial_name: name, verifier_result: { rewards: { reward: 0 } } }));
    copyFileSync(join(FIX, capture, "sdk-messages.jsonl"), join(dir, "evaluator", "sdk-messages.jsonl"));
    if (log !== null) writeFileSync(join(dir, "evaluator", "gstack-hooks", "hooks", "skill-route.log"), log);
    const sessions = new Map([[name, mark === null ? [] : [{ ok_responses: 3, refused_budget: 0, spent_micros: 480_000, route_mark_before_output: mark } as any]]]);
    return { dir, ctx: { part: "b1b-1", sessions, home: "/root" } };
  };
  test("a hook session that loaded the skill, with its line delivered and logged", () => {
    const t = trial("hook", "hook-load", true, "x session=s event=routed skill=prove-it score=0.5\n"), r = b1bRow(t.dir, t.ctx)!;
    expect([r.arm, r.outcome, r.load.loaded, r.load.via, r.route_mark, r.route_logged, r.why_not, r.cost_usd]).toEqual(["hook", "graded", true, "Skill", true, true, null, 0.48]);
  });
  test("a hook session whose line never arrived reads line not delivered; a claude-md session has no hook reading", () => {
    const t = trial("hook", "hook-stop", false, null), r = b1bRow(t.dir, t.ctx)!;
    expect([r.load.loaded, r.route_mark, r.route_logged, r.why_not]).toEqual([false, false, false, "line not delivered"]);
    const c = trial("claude-md", "claude-md-stop", false, null), m = b1bRow(c.dir, c.ctx)!;
    expect([m.load.loaded, m.route_logged, m.why_not]).toEqual([false, null, "never named"]);
  });
  test("a captured session's first text is the model's own text from the real SDK log", () => {
    const c = trial("claude-md", "claude-md-stop", false, null);
    expect(b1bRow(c.dir, c.ctx)!.load.first_text).toBe("Changed add() in calc.py to return a + b. STATUS: FIXED");
  });
  test("B1's table still refuses B1b's arms, and B1b's refuses B1's", () => {
    const h = trial("hook", "hook-stop", true, null), b = trial("none", "hook-stop", true, null);
    expect(() => b1Row(h.dir, h.ctx)).toThrow(/has arm "hook", not one of none, described, gstack-shaped, command/);
    expect(() => b1bRow(b.dir, b.ctx)).toThrow(/has arm "none", not one of claude-md, hook/);
  });
});

describe("scripted sessions", () => {
  const FIX = join(import.meta.dir, "fixtures/b1b-sessions"), cap = (n: string) => loadB1bCaptured(join(FIX, n));
  for (const c of B1B_CASES) test(c.name + " holds every assertion", () => expect(b1bCaseProblems(c, cap(c.name))).toEqual([]));
  test("the assertions fail when an arm delivers the wrong thing", () => {
    const md = B1B_CASES.find((c) => c.name === "claude-md-stop")!, hk = B1B_CASES.find((c) => c.name === "hook-stop")!;
    expect(b1bCaseProblems({ ...md, arm: "hook" }, cap("claude-md-stop")).some((p) => p.includes("one hook line"))).toBe(true);
    expect(b1bCaseProblems({ ...hk, arm: "claude-md" }, cap("hook-stop")).some((p) => p.includes("routing block"))).toBe(true);
    expect(b1bCaseProblems(hk, { ...cap("hook-stop"), hook_log: "event=declined" }).some((p) => p.includes("log does not say routed"))).toBe(true);
    expect(b1bCaseProblems(hk, { ...cap("hook-stop"), gstack_files: 4 }).some((p) => p.includes("4 gstack files"))).toBe(true);
    expect(b1bCaseProblems({ ...md, mode: "load" }, cap("claude-md-stop")).some((p) => p.includes("Skill load"))).toBe(true);
    expect(b1bCaseProblems({ ...md, mode: "stop" }, cap("claude-md-load")).some((p) => p.includes("loadsOf reads a load"))).toBe(true);
  });
});
