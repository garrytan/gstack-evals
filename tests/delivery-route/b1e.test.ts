// Copyright (c) 2026 Garry Tan. MIT License.
// B1e (lanes/delivery-route/b1e.ts): the frozen task sets and rewrite files, the route table at the pin, the decision table
// and the readings, the plan, caps and launch guard, the pilot's pass rules, the power table, the six scripted sessions'
// captures, each also changed so a check must fail, and the table read from trial folders built on those captures.
import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { B1E_CASES, B1E_FILES, B1E_PROFILE, b1eApprove, b1eCap, b1eCaseProblems, b1eDone, b1eGuard, b1ePlan, b1eStats, b1eTotals, buildB1eTable, checkB1eRows, committedRoutes, counts, descriptionOf, inventoryDiff, listingFacts, loadB1eCaptured, mainReport, mdd, pairPower, pilotCells, pilotCheck, powerLines, reserveList, skillFile, skillProblems, supplyCells, taskList, verdictOf, VERDICTS, type B1eRow } from "../../lanes/delivery-route/b1e.ts";
import { B1E, B1E_ARM_NAMES, B1E_CAPS_USD, B1E_PILOT, DESCRIPTIONS, EXT_ARMS, GSTACK_ARMS, GSTACK_STABLE, RESERVE, SUPPLY, TASK_SETS } from "../../lanes/delivery-route/b1e-pins.ts";
import { twoArmPower, routeCounts } from "../../lanes/delivery-route/b1d.ts";
import { B1D } from "../../lanes/delivery-route/b1d-pins.ts";
import { MODELS, sha256 } from "../../lanes/delivery-route/pins.ts";
import { b1Row, pulledInputs } from "../../lanes/delivery-route/table.ts";
import { plannedCells } from "../../quick/laneb/l1/l1.ts";
import { readRows } from "../../quick/laneb/runner/ledger.ts";

const PRIMARY = taskList("primary"), NONFIT = taskList("nonfit"), EXTENSION = taskList("extension");
const FIX = join(import.meta.dir, "fixtures", "b1e-sessions");

describe("the task sets and the rewrites", () => {
  test("the committed lists are the frozen sets: sorted, disjoint, and clear of the pilot task", () => {
    expect([PRIMARY.length, EXTENSION.length, NONFIT.length]).toEqual([TASK_SETS.primary.tasks, TASK_SETS.extension.tasks, TASK_SETS.nonfit.tasks]);
    const reserve = reserveList(), all = [...PRIMARY, ...EXTENSION, ...NONFIT, ...reserve];
    expect(reserve.length).toBe(RESERVE.tasks);
    expect(new Set(all).size).toBe(all.length);
    for (const t of B1E_PILOT) expect(all.includes(t)).toBe(false);
    expect(NONFIT.includes("tox-dev__tox-3846")).toBe(false);
  });
  test("the supply sample is ten frozen tasks, each on one gstack arm that runs its set, and the pilot is 14 cells", () => {
    const s = supplyCells();
    expect(s.length).toBe(SUPPLY.cells);
    expect(s.filter((c) => c.set === "primary").every((c) => EXTENSION.includes(c.task))).toBe(true);
    expect(s.filter((c) => c.set === "nonfit").every((c) => NONFIT.includes(c.task))).toBe(true);
    expect(s.map((c) => c.arm)).toEqual(["own", "hook", "long", "required", "hook", "long", "required", "hook", "long", "required"]);
    const cells = pilotCells();
    expect(cells.length).toBe(14);
    expect(GSTACK_ARMS.map((a) => cells.filter((c) => c.arm === a).length)).toEqual([4, 2, 4, 4]);
  });
  test("long and required are B1's prove-it with only the description line rewritten, at their frozen lengths", () => {
    expect(skillProblems()).toEqual([]);
    for (const a of ["own", "long", "required"] as const) expect(descriptionOf(readFileSync(skillFile(a), "utf8"))!.length).toBe(DESCRIPTIONS[a].chars);
    expect(descriptionOf(readFileSync(skillFile("required"), "utf8"))!.startsWith("REQUIRED before any bug fix")).toBe(true);
  });
  test("b1e-build.sh is executable, reads gstack's repo, sha and loadout and prove-it's file from the pins, and the launch guard watches it", () => {
    const f = "lanes/delivery-route/b1e-build.sh", text = readFileSync(join(import.meta.dir, "..", "..", f), "utf8");
    for (const k of ["repo", "sha", "loadout", "prove_it", "own"]) expect(text).toContain("$(pin " + k + ")");
    expect(text.includes(GSTACK_STABLE.sha) || text.includes(GSTACK_STABLE.tag)).toBe(false);
    expect(statSync(join(import.meta.dir, "..", "..", f)).mode & 0o111).not.toBe(0);
    expect(B1E_FILES).toContain(f);
  });
  test("b1e-build.sh refuses a folder that already holds any arm's tar or tar.gz", () => {
    const f = join(import.meta.dir, "..", "..", "lanes/delivery-route/b1e-build.sh");
    for (const t of ["hook.tar", "own.tar.gz", "required.tar", "long.tar.gz"]) {
      const d = mkdtempSync(join(tmpdir(), "b1e-build-"));
      try {
        writeFileSync(join(d, t), "");
        const r = spawnSync("bash", [f, d], { encoding: "utf8", timeout: 60_000 });
        expect([r.status, r.stderr]).toEqual([1, expect.stringContaining("refusing: " + join(d, t) + " exists")]);
      } finally {
        rmSync(d, { recursive: true, force: true });
      }
    }
  }, 120000);
  test("a file inventory diff names only the paths whose rows differ", () => {
    const a = "sha256\tbytes\tmode\ttype\tpath\nx\t1\t644\tfile\ta\ny\t1\t644\tfile\tb\n";
    expect(inventoryDiff(a, a.replace("y\t1", "z\t1"))).toEqual(["b"]);
    expect(inventoryDiff(a, a + "w\t1\t644\tfile\tc\n")).toEqual(["c"]);
  });
});

describe("the route table at gstack v1.102.1.0", () => {
  const rows = committedRoutes();
  test("the hook names prove-it alone on 71 of 81 bug fixes, 13 of 27 feature requests and the pilot task; lib and hook agree", () => {
    expect(rows.filter((r) => r[0] === "primary").map((r) => r[1])).toEqual(PRIMARY);
    expect(rows.filter((r) => r[0] === "nonfit").map((r) => r[1])).toEqual(NONFIT);
    expect(routeCounts(rows.filter((r) => r[0] === "primary"))).toMatchObject({ tasks: 81, only: 71, "not named": 10, nothing: 10, two_names: 0, disagree: 0 });
    expect(routeCounts(rows.filter((r) => r[0] === "nonfit"))).toMatchObject({ tasks: 27, only: 13, "not named": 14, verify: 1, nothing: 13, disagree: 0 });
    expect(rows.filter((r) => r[0] === "extension").map((r) => r[1])).toEqual(EXTENSION);
    expect(routeCounts(rows.filter((r) => r[0] === "extension"))).toMatchObject({ tasks: 81, only: 74, "not named": 7, nothing: 7, two_names: 0, disagree: 0 });
    expect(rows.filter((r) => r[0] === "pilot").map((r) => [r[1], r[5]])).toEqual([[B1E_PILOT[0], "prove-it"]]);
  });
});

const rowOf = (arm: B1eRow["arm"], task: string, f: { loaded?: boolean; followed?: boolean } = {}, over: Partial<B1eRow> = {}): B1eRow => ({
  schema: "b1-session/1", model: "claude-opus-5-5", part: "b1e-x", arm, task, trial: arm + "__" + task, outcome: "graded", reason: "graded", pass: false, reward: 0,
  allowance_stop: false, turn_cap: false, cost_usd: 0.5, tokens: 1, steps_seen: !!f.loaded, skill_loads: f.loaded ? 1 : 0, safety_stop: false, audit_hits: [],
  detect: { followed: !!f.followed } as B1eRow["detect"],
  set: NONFIT.includes(task) ? "nonfit" : "primary", responded: true,
  load: { loaded: !!f.loaded, via: f.loaded ? "Skill" : null, at_call: f.loaded ? 1 : null, failed: 0, named: !!f.loaded, first_text: "" },
  named: arm === "hook" ? ["prove-it"] : null, routed_events: arm === "none" ? null : arm === "hook" ? 1 : 0, route_mark: arm === "none" ? null : arm === "hook", tar_sha256: "tar-" + arm, first_call: !!f.loaded, ...over,
});

describe("the decision table", () => {
  const ok = { incomplete: false, nonfitLoaded: 3, nonfitGraded: 27, followed: { lo: -0.1 }, loads: { lo: -0.1 } };
  test("each row, in order: INCOMPLETE, over-loading, followed against the hook, loads against the hook", () => {
    expect(verdictOf({ ...ok, incomplete: true, nonfitLoaded: 20 })).toBe("incomplete");
    expect(verdictOf({ ...ok, nonfitLoaded: 9 })).toBe("over-loads");
    expect(verdictOf({ ...ok, nonfitLoaded: 8 })).toBe("rewrite");
    expect(verdictOf({ ...ok, followed: { lo: -0.15 } })).toBe("fix-method");
    expect(verdictOf({ ...ok, followed: { lo: -0.2 }, loads: { lo: -0.149 } })).toBe("fix-method");
    expect(verdictOf({ ...ok, followed: { lo: -0.2 }, loads: { lo: -0.16 } })).toBe("loads less");
    expect(verdictOf({ ...ok, nonfitLoaded: 8, nonfitGraded: 24 })).toBe("over-loads");
  });
  test("a non-fit session counts when a model response reached the agent; a primary session needs B1's grade", () => {
    expect(counts({ set: "nonfit", outcome: "infra", responded: true })).toBe(true);
    expect(counts({ set: "primary", outcome: "infra", responded: true })).toBe(false);
    expect(counts({ set: "nonfit", outcome: "infra", responded: false })).toBe(false);
  });
  const world = (rate: Record<string, number>, nonfitLoads: Record<string, number>, loads: Record<string, number> = {}) => [
    ...B1E_ARM_NAMES.flatMap((a) => [...PRIMARY, ...((EXT_ARMS as readonly string[]).includes(a) ? EXTENSION : [])].map((t, i) => rowOf(a, t, { loaded: a !== "none" && i < (loads[a] ?? 140), followed: i < rate[a]! }))),
    ...GSTACK_ARMS.flatMap((a) => NONFIT.map((t, i) => rowOf(a, t, { loaded: i < nonfitLoads[a]! }))),
  ];
  test("the report gives each rewrite its row and the advice, with the Opus-only line", () => {
    const r = mainReport(world({ hook: 60, own: 5, long: 60, required: 80, none: 0 }, { hook: 13, own: 1, long: 4, required: 12 }), PRIMARY, NONFIT, EXTENSION);
    expect(r.verdicts).toEqual({ long: "rewrite", required: "over-loads" });
    expect(r.lines).toContain("  long: rewrite: " + VERDICTS.rewrite);
    expect(r.lines.some((l) => l.startsWith("  advice: rewrite gstack's descriptions in the style of long"))).toBe(true);
    expect(r.lines.some((l) => l.includes("GPT-6.2 Sol in Codex first"))).toBe(true);
    const req = mainReport(world({ hook: 60, own: 5, long: 20, required: 80, none: 0 }, { hook: 13, own: 1, long: 4, required: 4 }, { long: 60 }), PRIMARY, NONFIT, EXTENSION);
    expect(req.verdicts).toEqual({ long: "loads less", required: "rewrite" });
    expect(req.lines.find((l) => l.startsWith("  advice:"))).toContain("REQUIRED wording is a product call for gstack's owner");
  });
  test("a rewrite that loads like the hook but is followed less reads FIX-METHOD, and gaps past the limit read INCOMPLETE", () => {
    const rows = world({ hook: 80, own: 5, long: 40, required: 80, none: 0 }, { hook: 13, own: 1, long: 4, required: 4 });
    expect(mainReport(rows, PRIMARY, NONFIT, EXTENSION).verdicts.long).toBe("fix-method");
    const gaps = rows.map((r) => (r.arm === "required" && r.set === "nonfit" && NONFIT.indexOf(r.task) < 3 ? { ...r, outcome: "infra" as const, responded: false } : r));
    expect(mainReport(gaps, PRIMARY, NONFIT, EXTENSION).verdicts.required).toBe("incomplete");
    expect(b1eStats(gaps, "required", "nonfit", NONFIT.length)).toMatchObject({ graded: 24, gaps: 3, incomplete: true });
  });
  test("the decision comparisons pair on 162 tasks; own and none pair with the hook on the first 81", () => {
    const rows = world({ hook: 60, own: 30, long: 60, required: 60, none: 0 }, { hook: 13, own: 1, long: 4, required: 4 }), lines = mainReport(rows, PRIMARY, NONFIT, EXTENSION).lines;
    expect(lines.some((l) => l.startsWith("  followed, long - hook: ") && l.includes(" on 162 paired tasks"))).toBe(true);
    expect(lines.some((l) => l.startsWith("  followed, own - hook (descriptive): ") && l.includes(" on 81 paired tasks"))).toBe(true);
    expect(lines.some((l) => l.startsWith("  followed, long - hook, the first 81 tasks only (descriptive): ") && l.includes(" on 81 paired tasks"))).toBe(true);
    expect(b1eStats(rows.filter((r) => r.arm === "long" && EXTENSION.indexOf(r.task) < 9), "long", "primary", 162)).toMatchObject({ graded: 90, gaps: 72, incomplete: true });
    expect(b1eStats(rows.filter((r) => r.arm === "long" && EXTENSION.indexOf(r.task) < 65), "long", "primary", 162)).toMatchObject({ graded: 146, gaps: 16, incomplete: false });
  });
  test("the report refuses rows that aren't planned cells or count twice", () => {
    const cells = [{ task: PRIMARY[0]!, arm: "hook" }];
    expect(checkB1eRows([rowOf("hook", PRIMARY[0]!)], cells)).toEqual([]);
    expect(checkB1eRows([rowOf("hook", PRIMARY[0]!), rowOf("hook", PRIMARY[0]!)], cells)).toEqual(["two counted rows for hook " + PRIMARY[0]]);
    expect(checkB1eRows([rowOf("none", NONFIT[0]!)], cells)).toHaveLength(1);
  });
});

describe("plan, caps and the launch guard", () => {
  test("the pilot is its 14 cells; the main item is 81 tasks on five arms, 81 on three and 27 on four", () => {
    const pilot = b1ePlan("b1e-pilot");
    expect(pilot.sessions).toBe(14);
    expect([...plannedCells(pilot.parts[0]!).keys()].sort()).toEqual(pilotCells().map((c) => c.task + "\t" + c.arm).sort());
    const main = b1ePlan("b1e-main");
    expect(main.sessions).toBe(81 * 5 + 81 * 3 + 27 * 4);
    const cells = main.parts.flatMap((p) => [...plannedCells(p).keys()]);
    expect(new Set(cells).size).toBe(cells.length);
    expect(cells.filter((c) => EXTENSION.includes(c.split("\t")[0]!)).map((c) => c.split("\t")[1]).every((a) => (EXT_ARMS as readonly string[]).includes(a!))).toBe(true);
    expect(main.parts.map((p) => p.name)).toEqual(["b1e-primary-1", "b1e-primary-2", "b1e-primary-3", "b1e-primary-4", "b1e-extension-1", "b1e-extension-2", "b1e-extension-3", "b1e-extension-4", "b1e-nonfit"]);
  });
  test("each recorded cap is its formula cap", () => {
    for (const i of ["b1e-pilot", "b1e-main"] as const) expect(b1eCap(i).cap).toBe(B1E_CAPS_USD[i]);
  });
  test("the guard passes the pilot, holds the main run until the pilot is done, and refuses past the all-in stop", () => {
    expect(b1eGuard("b1e-pilot", {}, {}, 0).ok).toBe(true);
    expect(b1eGuard("b1e-main", {}, {}, 0).why).toContain("b1e-pilot is not marked done; the counted run waits for the pilot and its report");
    const dir = mkdtempSync(join(tmpdir(), "b1e-guard-")), led = join(dir, "pilot.jsonl");
    b1eApprove(led, "b1e-pilot", 50, "test");
    writeFileSync(led, readFileSync(led, "utf8") + JSON.stringify({ ts: "t", item: "b1e-pilot", kind: "note", id: "done", usd_micros: 0 }) + "\n");
    const rows = readRows(led);
    expect(b1eTotals(rows, "b1e-pilot").done).toBe(true);
    expect(b1eGuard("b1e-main", { "b1e-pilot": rows }, {}, 0).ok).toBe(true);
    const over = b1eGuard("b1e-main", { "b1e-pilot": rows }, {}, B1E.stopUsd);
    expect(over.ok).toBe(false);
    expect(over.why.some((w) => w.includes("passes the $" + B1E.stopUsd + ".00 stop"))).toBe(true);
    expect(() => b1eApprove(join(dir, "x.jsonl"), "b1e-main", 300, "test")).toThrow("refused");
  });
  test("a relaunch past the all-in stop runs with OVERSHOOT; a fresh launch there is refused", () => {
    const part = b1ePlan("b1e-pilot").parts[0]!.name, re = b1eGuard("b1e-pilot", {}, {}, B1E.stopUsd, part), fresh = b1eGuard("b1e-pilot", {}, {}, B1E.stopUsd);
    expect(re.ok).toBe(true);
    expect(re.lines[0]!.startsWith("B1E_LAUNCH OVERSHOOT b1e-pilot")).toBe(true);
    expect(re.lines[1]).toContain("relaunch of " + part + " runs anyway");
    expect(fresh.ok).toBe(false);
    expect(fresh.lines[0]!.startsWith("B1E_LAUNCH REFUSE b1e-pilot")).toBe(true);
    expect(fresh.why.some((w) => w.includes("passes the $" + B1E.stopUsd + ".00 stop"))).toBe(true);
  });
  test("done refuses open reservations and a second done, and otherwise writes the done note", () => {
    const led = join(mkdtempSync(join(tmpdir(), "b1e-done-")), "pilot.jsonl");
    b1eApprove(led, "b1e-pilot", 50, "test");
    const add = (row: object) => writeFileSync(led, readFileSync(led, "utf8") + JSON.stringify({ ts: "t", item: "b1e-pilot", ...row }) + "\n");
    add({ kind: "reserve", id: "s1", usd_micros: 1 });
    expect(() => b1eDone(led, "b1e-pilot")).toThrow("still holds 1 open reservations");
    add({ kind: "settle", id: "s1", usd_micros: 1 });
    b1eDone(led, "b1e-pilot");
    expect(b1eTotals(readRows(led), "b1e-pilot").done).toBe(true);
    expect(() => b1eDone(led, "b1e-pilot")).toThrow("marked done already");
  });
});

describe("the pilot", () => {
  const routes = committedRoutes(), tars = { hook: "tar-hook", own: "tar-own", long: "tar-long", required: "tar-required" };
  const named = (t: string) => { const x = routes.find((r) => r[1] === t)![5]!; return x === "-" ? [] : x.split(","); };
  const pilot = (over: (r: B1eRow) => Partial<B1eRow> | null = () => ({})) => pilotCells().flatMap((c) => {
    const r = rowOf(c.arm, c.task, { loaded: c.arm === "required" && !c.supply }, c.arm === "hook" ? { named: named(c.task), route_mark: named(c.task).length > 0, routed_events: named(c.task).length ? 1 : 0 } : {}), o = over(r);
    return o === null ? [] : [{ ...r, ...o }];
  });
  const supplyTask = (arm: string, set: string) => supplyCells().find((c) => c.arm === arm && c.set === set)!.task;
  test("every arm passes on its own outputs, every supply task counts, and the loads line names the load the detector read", () => {
    const r = pilotCheck(pilot(), routes, tars);
    expect([r.failed, r.supply]).toEqual([[], []]);
    expect(r.lines.slice(0, 4)).toEqual(GSTACK_ARMS.map((a) => "  pilot PASS " + a));
    expect(r.lines[4]).toBe("  pilot supply: 10 of 10 supply tasks counted");
    expect(r.lines[5]).toBe("  pilot loads read: 1 (required via Skill at call 1)");
  });
  test("a supply task with no counted session is a supply failure, not an arm failure; a non-fit one counts on any model response", () => {
    const nf = supplyTask("long", "nonfit"), pr = supplyTask("own", "primary");
    const lost = pilotCheck(pilot((r) => (r.task === nf ? null : {})), routes, tars);
    expect([lost.failed, lost.supply]).toEqual([[], [nf + " on long"]]);
    expect(lost.lines).toContain("  pilot SUPPLY FAIL " + nf + " on long: no counted session; the reserve rule applies (README section 3)");
    expect(pilotCheck(pilot((r) => (r.task === nf ? { outcome: "infra", responded: true } : {})), routes, tars).supply).toEqual([]);
    expect(pilotCheck(pilot((r) => (r.task === pr ? { outcome: "infra", responded: true } : {})), routes, tars).supply).toEqual([pr + " on own"]);
    expect(pilotCheck(pilot((r) => (r.task === B1E_PILOT[0] && r.arm === "own" ? null : {})), routes, tars).failed).toEqual(["own"]);
    expect(pilotCheck(pilot((r) => (r.task === pr ? { routed_events: 2 } : {})), routes, tars).failed).toEqual(["own"]);
  });
  test("a wrong tar, a lost hook line, routing that isn't off, an audit hit or no load at all fails", () => {
    expect(pilotCheck(pilot((r) => (r.arm === "long" ? { tar_sha256: "tar-own" } : {})), routes, tars).failed).toEqual(["long"]);
    expect(pilotCheck(pilot((r) => (r.arm === "hook" && r.task === B1E_PILOT[0] ? { route_mark: false } : {})), routes, tars).failed).toEqual(["hook"]);
    expect(pilotCheck(pilot((r) => (r.arm === "hook" && r.task === B1E_PILOT[0] ? { named: null } : {})), routes, tars).failed).toEqual(["hook"]);
    expect(pilotCheck(pilot((r) => (r.arm === "own" ? { routed_events: 1 } : {})), routes, tars).failed).toEqual(["own"]);
    expect(pilotCheck(pilot((r) => (r.arm === "required" ? { route_mark: true } : {})), routes, tars).failed).toEqual(["required"]);
    expect(pilotCheck(pilot((r) => (r.arm === "own" ? { audit_hits: ["/root/.capy"] } : {})), routes, tars).failed).toEqual(["own"]);
    expect(pilotCheck(pilot((r) => ({ load: { ...r.load, loaded: false } })), routes, tars).failed).toEqual(["loads"]);
  });
});

describe("power", () => {
  test("with phi 0 the paired power is B1d's two-arm model, and B1e's margin is B1d's", () => {
    expect(B1E.margin).toBe(B1D.margin);
    for (const [a, b] of [[0.3, 0.3], [0.4, 0.3]]) { const x = pairPower(a!, b!, 40)!, y = twoArmPower(a!, b!, 40); expect(x.matches).toBeCloseTo(y.matches, 12); expect(x.below).toBeCloseTo(y.below, 12); }
  });
  test("the MDD at n=162 and n=81, and the planning phi from B1d's published rows", () => {
    expect([mdd(0.3, 162, "below"), mdd(0.3, 162, "below", 0.257)]).toEqual([0.14, 0.12]);
    expect([mdd(0.3, 81, "below"), mdd(0.3, 81, "below", 0.257)]).toEqual([0.18, 0.16]);
    const lines = powerLines(40, 20, 27);
    expect(lines[0]).toBe("decision comparisons (long and required against the hook): 40 tasks, paired by task; followed and loads move in steps of 2.50 points");
    expect(lines).toContain("planning phi: 0.257 (the lower); phi 0 is the independent model");
    expect(lines).toContain("non-fit: 27 tasks; a rewrite over-loads at 9 or more loads of 27 counted sessions");
  }, 120000);
});

describe("the scripted sessions at the pin", () => {
  for (const c of B1E_CASES) test(c.name + " passes on its capture", () => { expect(b1eCaseProblems(c, loadB1eCaptured(join(FIX, c.name)))).toEqual([]); });
  const cap = (name: string) => loadB1eCaptured(join(FIX, name)), byName = (n: string) => B1E_CASES.find((c) => c.name === n)!;
  test("each listing carries the arm's own description in full", () => {
    for (const [n, a] of [["own-load", "own"], ["long-load", "long"], ["required-stop", "required"]] as const) expect(listingFacts(cap(n).listing, a).prove_it).toBe("full");
    expect(listingFacts(cap("long-load").listing, "required").prove_it).toBe("cut");
  });
  test("a changed capture fails: a hook line with routing off, the wrong switch, a missing load, a cut description", () => {
    const own = cap("own-load");
    expect(b1eCaseProblems(byName("own-load"), { ...own, hook_context: ["x"] }).length).toBeGreaterThan(0);
    expect(b1eCaseProblems(byName("own-load"), { ...own, probe: { ...own.probe, skill_routing: "on" } }).length).toBeGreaterThan(0);
    expect(b1eCaseProblems(byName("long-load"), { ...cap("long-load"), loaded: null }).length).toBeGreaterThan(0);
    const long = cap("long-load"), d = descriptionOf(readFileSync(skillFile("long"), "utf8"))!;
    expect(b1eCaseProblems(byName("long-load"), { ...long, listing: long.listing!.replace(d, d.slice(0, 250)) }).length).toBeGreaterThan(0);
    const hook = cap("hook-load");
    expect(b1eCaseProblems(byName("hook-load"), { ...hook, hook_context: [] }).length).toBeGreaterThan(0);
    expect(b1eCaseProblems(byName("none-stop"), { ...cap("none-stop"), hook_context: ["x"] }).length).toBeGreaterThan(0);
  });
  test("the captures are the committed ones", () => {
    for (const c of B1E_CASES) expect(sha256(readFileSync(join(FIX, c.name, "capture.json")))).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("the table on trial folders", () => {
  const roots: string[] = [];
  afterAll(() => { for (const d of roots) rmSync(d, { recursive: true, force: true }); });
  const rig = () => {
    const root = mkdtempSync(join(tmpdir(), "b1e-table-")), sessions: object[] = [];
    roots.push(root);
    let n = 0;
    const trial = (arm: string, task: string, o: { capture?: string; edit?: (s: string) => string; result?: boolean; ok?: number } = {}) => {
      const name = task + "__" + ++n, dir = join(root, "jobs", "job1", name);
      mkdirSync(join(dir, "evaluator"), { recursive: true });
      writeFileSync(join(dir, "config.json"), JSON.stringify({ agent: { name: "laneb-claude-code", kwargs: { arm, upstream_model: MODELS.opus.id } }, task: { path: "tasks/" + task } }));
      if (o.result !== false) writeFileSync(join(dir, "result.json"), JSON.stringify({ trial_name: name, verifier_result: { rewards: { reward: 0 } } }));
      if (o.capture) writeFileSync(join(dir, "evaluator", "sdk-messages.jsonl"), (o.edit ?? ((s: string) => s))(readFileSync(join(FIX, o.capture, "sdk-messages.jsonl"), "utf8")));
      if (o.ok !== undefined) sessions.push({ id: "s" + n, trial: name, opened_at: String(n).padStart(3, "0"), ok_responses: o.ok, refused_budget: 0, spent_micros: 480_000 });
      return dir;
    };
    const table = () => {
      mkdirSync(join(root, "out"), { recursive: true });
      writeFileSync(join(root, "out", "proxy-sessions.jsonl"), sessions.map((s) => JSON.stringify(s) + "\n").join(""));
      return buildB1eTable(pulledInputs(root, "b1e-main"));
    };
    return { root, trial, table };
  };
  test("every arm reads from a trial folder built on its captured session, and B1's own table still refuses the rewrites", () => {
    const t = rig(), task = PRIMARY[0]!, caps = { hook: "hook-load", own: "own-load", long: "long-load", required: "required-stop", none: "none-stop" } as const;
    const dirs = B1E_ARM_NAMES.map((a) => t.trial(a, task, { capture: caps[a], ok: 3 }));
    const rows = t.table();
    expect(rows.map((r) => [r.arm, r.set, r.outcome, r.responded, r.load.loaded, r.audit_hits])).toEqual([["hook", "primary", "graded", true, true, []], ["own", "primary", "graded", true, true, []], ["long", "primary", "graded", true, true, []], ["required", "primary", "graded", true, false, []], ["none", "primary", "graded", true, false, []]]);
    expect(checkB1eRows(rows, B1E_ARM_NAMES.map((arm) => ({ task, arm })))).toEqual([]);
    expect(() => b1Row(dirs[1]!, { part: null, sessions: new Map(), home: "/root" })).toThrow(/has arm "own", not one of none/);
  });
  test("a non-fit session counts once a model response reached it, with or without result.json; one with no response reruns, as does a bug-fix session with no result.json", () => {
    const t = rig();
    t.trial("own", NONFIT[0]!, { capture: "own-load", result: false, ok: 2 });
    t.trial("required", NONFIT[1]!, { capture: "required-stop", result: false });
    t.trial("long", NONFIT[2]!, { ok: 0 });
    t.trial("hook", PRIMARY[0]!, { capture: "hook-load", result: false, ok: 2 });
    const by = Object.fromEntries(t.table().map((r) => [r.arm, [r.set, r.reason, r.responded, counts(r)]]));
    expect(by).toEqual({ own: ["nonfit", "no result.json", true, true], required: ["nonfit", "no result.json", true, true], long: ["nonfit", "no model response reached the agent", false, false], hook: ["primary", "no result.json", true, false] });
    const owed = B1E_PROFILE.attempt2!.owed([{ dir: t.root, part: "b1e-main" }]).owed.sort((a, b) => a.arm.localeCompare(b.arm));
    expect(owed).toEqual([{ task: PRIMARY[0]!, arm: "hook", reason: "no result.json" }, { task: NONFIT[2]!, arm: "long", reason: "no model response reached the agent" }]);
  });
  test("a hook session that loads another gstack skill has no audit hit, because each gstack arm installs all of gstack", () => {
    const t = rig(), dir = t.trial("hook", PRIMARY[0]!, { capture: "hook-load", edit: (s) => s.replaceAll("prove-it", "verify"), ok: 3 });
    const [r] = t.table();
    expect([r!.load.loaded, r!.audit_hits]).toEqual([false, []]);
    expect(b1Row(dir, { part: null, sessions: new Map(), home: "/root", arms: B1E_ARM_NAMES })!.audit_hits).toEqual(["Skill verify -> /root/.claude/skills/verify"]);
  });
});
