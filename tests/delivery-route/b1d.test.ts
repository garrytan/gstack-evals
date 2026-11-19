// Copyright (c) 2026 Garry Tan. MIT License.
// B1d (lanes/delivery-route/b1d.ts): the noescape block and the small tars, the route table and the smoke rule, Garry's bar
// and the held-out readings, the power table, the caps and launch guard, the controls' reuse check, the session rows and the
// eight scripted sessions' captures.
import { describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { B1D_CASES, b1cRows, b1dMain, inSampleRoutes, powerLines, b1dApprove, b1dCap, b1dCaseProblems, b1dDone, b1dGuard, b1dPlan, b1dRow, b1dStats, band, checkB1dRows, clearOdds, hoMdd, hoReading, hoReport, inReading, listingFacts, loadB1dCaptured, namedOf, noescapeBlock, positionOf, readRouteTsv, reuseB1c, routeCounts, routeFile, routesByTask, smokeOf, splitLines, tertiles, WHY_NOT_MAIN, whyNot, type B1dRow, type InReading } from "../../lanes/delivery-route/b1d.ts";
import { B1D, B1D_ARM, B1D_ARM_NAMES, B1D_CAPS_USD, B1D_SMOKE, GSTACK_ARM, HELDOUT, NOESCAPE } from "../../lanes/delivery-route/b1d-pins.ts";
import { PLACEMENT } from "../../lanes/delivery-route/b1c-pins.ts";
import { reuseCheck, type Load } from "../../lanes/delivery-route/b1b.ts";
import { ARM_SOURCES, drawnTasks, loadBundle, REPO, sha256 } from "../../lanes/delivery-route/pins.ts";
import { b1Row } from "../../lanes/delivery-route/table.ts";
import { readRows } from "../../quick/laneb/runner/ledger.ts";

const RUN = drawnTasks(loadBundle()).run;

describe("the noescape arm", () => {
  test("its block is B1b's block with only the escape clause removed, and the committed source is that text", () => {
    const b1b = readFileSync(join(REPO, ARM_SOURCES, PLACEMENT.blockSource), "utf8"), mine = readFileSync(join(REPO, ARM_SOURCES, NOESCAPE.source), "utf8");
    expect(noescapeBlock()).toBe(mine);
    expect(mine).toBe(b1b.replace(NOESCAPE.from, NOESCAPE.to));
    expect(mine.includes("answer directly for quick questions")).toBe(false);
    expect(b1b.length - mine.length).toBe(NOESCAPE.from.length - NOESCAPE.to.length);
  });
});

describe("the route table", () => {
  const rows = readRouteTsv(readFileSync(routeFile(), "utf8"));
  test("B1's 60 run prompts at the pin: prove-it alone on 33, second of two on 7, not named on 20; lib and hook agree", () => {
    const run = rows.filter((r) => r[0] === "run");
    expect(run.map((r) => r[1])).toEqual(RUN);
    expect(routeCounts(run)).toMatchObject({ tasks: 60, only: 33, "first of two": 0, "second of two": 7, "not named": 20, verify: 9, nothing: 18, disagree: 0 });
    expect(routeCounts(rows.filter((r) => r[0] === "calibration"))).toMatchObject({ tasks: 10, only: 6, "second of two": 2, "not named": 2, disagree: 0 });
  });
  test("the smoke rule picks the first calibration task named prove-it alone and the first named nothing", () => {
    expect(smokeOf(rows)).toEqual([...B1D_SMOKE]);
    expect(smokeOf(rows.filter((r) => r[1] !== B1D_SMOKE[0]))[0]).not.toBe(B1D_SMOKE[0]);
  });
  test("where the hook puts prove-it", () => {
    expect([["prove-it"], ["prove-it", "verify"], ["verify", "prove-it"], ["verify"], []].map(positionOf)).toEqual(["only", "first of two", "second of two", "not named", "not named"]);
    expect(HELDOUT.coverage.only + HELDOUT.coverage.first + HELDOUT.coverage.second + HELDOUT.coverage.none).toBe(HELDOUT.tasks);
  });
  test("prompt-length tertiles sort by length, ties by task id, 20 a tertile", () => {
    const routes = new Map(["a", "b", "c", "d", "e", "f"].map((t, i) => [t, { position: "only" as const, chars: [5, 1, 5, 3, 9, 1][i]! }]));
    expect([...tertiles(routes, ["a", "b", "c", "d", "e", "f"]).entries()].sort()).toEqual([["a", 2], ["b", 1], ["c", 3], ["d", 2], ["e", 3], ["f", 1]]);
  });
});

const load = (over: Partial<Load> = {}): Load => ({ loaded: false, via: null, at_call: null, failed: 0, named: false, first_text: "", ...over });
const row = (arm: B1dRow["arm"], task: string, loaded: boolean, over: Partial<B1dRow> = {}): B1dRow => {
  const r = {
    schema: "b1-session/1", model: "claude-opus-5-5", part: "b1d-x", arm, task, trial: arm + "__" + task, outcome: "graded", reason: "graded", pass: false, reward: 0,
    allowance_stop: false, turn_cap: false, cost_usd: 0.5, tokens: 1, steps_seen: loaded, skill_loads: loaded ? 1 : 0, safety_stop: false, audit_hits: [],
    detect: { followed: loaded, followed_tool_only: loaded, followed_as_merged: loaded, test_before_source: loaded, failing_before_source: loaded, passing_after_source: loaded, source_changed: true, bash_only_source: false, source_write_unseen: false, unread_background: 0, unresolved_writes: 0, spec_folder_write: false, test_file: null, fix_files: [] },
    load: load(loaded ? { loaded: true, via: "Skill", at_call: 1 } : {}), verify: { loaded: false, via: null, at_call: null }, named: arm === B1D_ARM ? ["prove-it"] : null, position: arm === B1D_ARM ? "only" : null,
    route_mark: arm === B1D_ARM ? true : null, placed: arm === "project-md" || arm === NOESCAPE.arm ? true : null, first_call: loaded, why_not: null, ...over,
  } as B1dRow;
  return { ...r, why_not: over.why_not !== undefined ? over.why_not : whyNot(r) };
};
const mainRows = (k: number, gaps = 0) => RUN.map((t, i) => row(B1D_ARM, t, i < k, i >= 60 - gaps ? { outcome: "infra" } : {}));
const readIn = (rows: B1dRow[]) => inReading(b1dStats(rows, B1D_ARM, 60));

describe("the decision", () => {
  test("Garry's bar is a point count: 39 of 60 clears, 38 is short, and too many gaps or a cap stop is INCOMPLETE", () => {
    expect([39, 40, 38, 0].map((k) => readIn(mainRows(k)).key)).toEqual(["clears", "clears", "short", "short"]);
    expect(readIn(mainRows(39)).text).toContain("the CLAUDE.md routing block is cut, unless the held-out readings below stop it");
    expect(readIn(mainRows(38)).text).toContain("the CLAUDE.md routing block stays and the result goes to Garry");
    expect(readIn(mainRows(45, 7)).key).toBe("incomplete");
    const capped = mainRows(45);
    capped[59] = { ...capped[59]!, outcome: "cap_stop", why_not: null };
    expect(readIn(capped).key).toBe("incomplete");
  });
  const clears: InReading = { key: "clears", text: "" }, short: InReading = { key: "short", text: "" };
  const ho = (diff: number, block: [number, number], noescape: [number, number], incomplete = false) => hoReading(clears, { incomplete, mainVsBlock: { diff, lo: diff - 0.15, hi: diff + 0.15 }, blockVsMain: { lo: block[0], hi: block[1] }, noescapeVsMain: { lo: noescape[0], hi: noescape[1] } });
  test("the disagreement rule fires at a held-out shortfall of 26 points or more, and stops the cut", () => {
    expect(B1D.hoMdd).toBe(0.26);
    const at25 = ho(-15 / 60, [-0.05, 0.4], [-0.5, -0.2]), at27 = ho(-16 / 60, [-0.05, 0.4], [-0.5, -0.2]);
    expect([at25.disagree, at27.disagree]).toEqual([false, true]);
    expect(at27.decision).toContain("not cut on its own");
    expect(at27.decision).toContain("26.7 points fewer");
    expect(ho(0, [-0.5, -0.2], [-0.5, -0.2]).decision).toBe("the CLAUDE.md routing block is cut (Garry's rule)");
    expect(hoReading(short, { incomplete: false, mainVsBlock: { diff: 0.3, lo: 0.1, hi: 0.5 }, blockVsMain: { lo: -0.5, hi: -0.1 }, noescapeVsMain: { lo: -0.5, hi: -0.1 } }).decision).toBe("the block stays and the result goes to Garry");
    expect(ho(0, [-0.5, -0.2], [-0.5, -0.2], true).decision).toContain("held-out set is INCOMPLETE");
  });
  test("the R48 wording for CLAUDE.md routing, stated before data", () => {
    expect(ho(0, [-0.1, 0.2], [-0.5, -0.2]).verdict).toContain("no R48 verdict for CLAUDE.md routing: the current block matches the hook");
    expect(ho(0, [-0.1, 0.2], [-0.1, 0.2]).decision).toBe("the CLAUDE.md routing block is cut (Garry's rule)");
    expect(ho(0, [-0.5, -0.2], [-0.1, 0.2]).verdict).toContain("FIX-METHOD for CLAUDE.md routing: the block without its escape clause matches the hook, so rewrite the block, not cut it");
    expect(ho(0, [-0.5, -0.2], [-0.1, 0.2]).decision).toContain("rewrite the block");
    expect(ho(0, [-0.5, -0.2], [-0.5, -0.2]).verdict).toContain("CUT-CANDIDATE for the current block and for CLAUDE.md routing in general");
    expect(ho(0, [-0.5, -0.2], [-0.3, 0]).verdict).toBe("CUT-CANDIDATE for the current block's wording and FIX-METHOD for CLAUDE.md routing in general: removing the escape clause did not settle it");
    expect([band({ lo: -0.14, hi: 0.2 }), band({ lo: -0.3, hi: -0.1 }), band({ lo: -0.4, hi: -0.16 })]).toEqual(["matches", "middle", "clearly loses"]);
  });
  test("the held-out report pairs each arm, splits by where the hook put prove-it, and prints the strata", () => {
    const tasks = Array.from({ length: 60 }, (_, i) => "t" + String(i).padStart(2, "0") + (i % 10 === 0 ? "_interface" : ""));
    const routes = new Map(tasks.map((t, i) => [t, { position: (i < 40 ? "only" : i < 47 ? "second of two" : "not named") as any, chars: 100 + i }]));
    const rows = tasks.flatMap((t, i) => [row(B1D_ARM, t, i < 40, i < 40 ? {} : { named: i < 47 ? ["verify", "prove-it"] : [], position: i < 47 ? "second of two" : "not named" }), row("project-md", t, i < 39), row(NOESCAPE.arm, t, i < 45), row("none", t, false)]);
    const rep = hoReport(rows, clears, routes, tasks);
    expect(rep.reading).toMatchObject({ incomplete: false, disagree: false, block: "matches", noescape: "matches", decision: "the CLAUDE.md routing block is cut (Garry's rule)" });
    expect(rep.lines).toContain("  keyless coverage (the hook at the pin on each prompt): prove-it only 40, first of two 0, second of two 7, not named 13");
    expect(rep.lines).toContain("  hook put prove-it second of two (7 sessions): prove-it loaded 0, /verify loaded 0, neither 7");
    expect(rep.lines).toContain("  _interface tasks (6 tasks): gstack-main 4/6, project-md 4/6, project-md-noescape 5/6, none 0/6");
    expect(rep.lines).toContain("  length tertile 3 (140 to 159 characters) (20 tasks): gstack-main 0/20, project-md 0/20, project-md-noescape 5/20, none 0/20");
    const short = tasks.flatMap((t, i) => [row(B1D_ARM, t, i < 40), row("project-md", t, i < 25), row(NOESCAPE.arm, t, i < 40), row("none", t, false)]);
    expect(hoReport(short, clears, routes, tasks).lines.at(-1)).toBe("  decision: not cut on its own: the hook clears the bar and the current block falls short of it on the held-out set, but the block without its escape clause matches the hook, so the verdict says rewrite the block, and it goes to Garry");
  });
  test("the row check refuses a stray task, another arm, another model and a repeat", () => {
    const r = [row(B1D_ARM, "t0", true), row(B1D_ARM, "t0", false), { ...row(B1D_ARM, "t1", true), model: "gpt-6.1-sol" }, row("none", "t1", false), row(B1D_ARM, "zz", true)];
    expect(checkB1dRows(r, ["t0", "t1"], [B1D_ARM]).sort()).toEqual(["gstack-main__t1 ran gpt-6.1-sol, not claude-opus-5-5", "gstack-main__zz is task zz, not one of the planned tasks", "none__t1 is arm none, not one of gstack-main", "two graded rows for gstack-main t0"]);
  });
  test("report --item b1d-ho refuses an --in table that is not the in-sample gstack-main table", async () => {
    const dir = mkdtempSync(join(tmpdir(), "b1d-report-")), ho = join(dir, "ho.jsonl"), tsv = join(dir, "routes.tsv"), errs: string[] = [], err = console.error;
    writeFileSync(ho, ["ho0", "ho1"].flatMap((t) => B1D_ARM_NAMES.map((a) => JSON.stringify(row(a, t, false)))).join("\n") + "\n");
    writeFileSync(tsv, "");
    console.error = (m: string) => { errs.push(m); };
    try {
      expect(await b1dMain(["report", ho, "--item", "b1d-ho", "--in", ho, "--routes", tsv])).toBe(2);
      expect(errs.length).toBeGreaterThan(0);
      expect(errs.every((m) => m.startsWith("E_USAGE b1d report --in: "))).toBe(true);
      expect(errs).toContain("E_USAGE b1d report --in: gstack-main__ho0 is task ho0, not one of the planned tasks");
    } finally { console.error = err; rmSync(dir, { recursive: true, force: true }); }
  });
  test("the reason a gstack-main session didn't load prove-it, first that applies", () => {
    const r = (over: Partial<B1dRow>) => whyNot({ ...row(B1D_ARM, "t", false), ...over });
    const got = [r({ named: null }), r({ named: ["verify"] }), r({ route_mark: "quoted" }), r({ verify: { loaded: true, via: "Skill", at_call: 1 } }), r({ load: load({ failed: 1, named: true }) }), r({ load: load({ named: true }) }), r({})];
    expect(got).toEqual([...WHY_NOT_MAIN]);
    expect(r({ named: [], route_mark: false, verify: { loaded: true, via: "Skill", at_call: 1 } })).toBe("hook did not name prove-it");
    expect(whyNot({ ...row("project-md", "t", false), placed: false })).toBe("block not placed");
    expect(whyNot(row("none", "t", false))).toBeNull();
  });
  test("namedOf reads the hook's last routed line, and splitLines counts sessions with no log", () => {
    expect(namedOf(null)).toBeNull();
    expect(namedOf("x event=no-route reason=below-threshold\n")).toEqual([]);
    expect(namedOf("x event=routed skill=verify score=1 also=prove-it also_score=1\n")).toEqual(["verify", "prove-it"]);
    expect(splitLines([row(B1D_ARM, "t", true, { named: null, position: null })])[4]).toBe("  hook log missing (1 sessions): prove-it loaded 1");
  });
});

describe("power", () => {
  test("the odds of clearing 39 on the in-sample coverage (40 named, 20 not)", () => {
    const c = { first: 33, second: 7, none: 20 };
    expect(clearOdds(c, 1)).toBe(1);
    expect(clearOdds(c, 58 / 60)).toBeCloseTo(0.613, 3);
    expect(clearOdds(c, 0.9)).toBeCloseTo(0.08, 3);
    expect(clearOdds(c, 58 / 60, 0, 0.5)).toBeLessThan(0.05);
  });
  test("the held-out MDD at B1c's 39 of 60 is the frozen 26 points", () => expect(hoMdd(39 / 60)).toBe(B1D.hoMdd));
});

describe("money", () => {
  test("the plans: 2 smoke sessions, 60 in-sample, 240 held-out in three parts of 80 with every arm of a task in its part", () => {
    expect(b1dPlan("b1d-smoke", RUN, null).sessions).toBe(2);
    expect(b1dPlan("b1d-in", RUN, null).sessions).toBe(60);
    const ho = b1dPlan("b1d-ho", RUN, null);
    expect([ho.sessions, ho.parts.length]).toEqual([240, 3]);
    for (const p of ho.parts) expect(p.rects.flatMap((r) => r.arms).sort()).toEqual([...B1D_ARM_NAMES].sort());
  });
  test("each recorded cap is at least its formula, and the smoke and in-sample caps are the formula exactly", () => {
    expect([b1dCap("b1d-smoke").cap, b1dCap("b1d-in").cap]).toEqual([B1D_CAPS_USD["b1d-smoke"], B1D_CAPS_USD["b1d-in"]]);
    expect(b1dCap("b1d-ho").cap).toBeLessThanOrEqual(B1D_CAPS_USD["b1d-ho"]);
    expect(B1D_CAPS_USD["b1d-smoke"] + B1D_CAPS_USD["b1d-in"] + B1D_CAPS_USD["b1d-ho"]).toBeLessThanOrEqual(B1D.stopUsd);
  });
  test("the approval row takes only the recorded cap, once, and a done item never launches again", () => {
    const dir = mkdtempSync(join(tmpdir(), "b1d-ledger-")), path = join(dir, "b1d-in.jsonl");
    try {
      expect(() => b1dApprove(path, "b1d-in", 80, "the Captain")).toThrow(/refused: b1d-in's recorded cap is \$90/);
      expect(() => b1dApprove(path, "b1c-opus", 90, "the Captain")).toThrow(/unknown item/);
      b1dApprove(path, "b1d-in", 90, "the Captain");
      expect(() => b1dApprove(path, "b1d-in", 90, "the Captain")).toThrow(/already holds rows/);
      expect(b1dGuard("b1d-in", { "b1d-in": readRows(path) }, {}, 0).ok).toBe(true);
      b1dDone(path, "b1d-in");
      expect(b1dGuard("b1d-in", { "b1d-in": readRows(path) }, {}, 0).why).toContain("b1d-in is marked done; a done item never launches again");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  test("the launch guard counts every item's projection and this lane's counter against the $340 stop", () => {
    const g0 = b1dGuard("b1d-in", {}, {}, 0), all = Number(/all-in \$([\d.]+)/.exec(g0.lines[0]!)![1]);
    expect(b1dGuard("b1d-in", {}, {}, B1D.stopUsd - all).ok).toBe(true);
    const g = b1dGuard("b1d-in", {}, {}, B1D.stopUsd - all + 0.01);
    expect(g.ok).toBe(false);
    expect(g.why[0]).toBe("all-in $340.01 passes the $340.00 stop");
  });
});

describe("the controls' reuse", () => {
  test("B1c's rows are its published rows, 39 of 60 loaded, and the trees behind them and B1's none arm are the same at this head", () => {
    expect(b1cRows().filter((r) => r.arm === "project-md" && r.outcome === "graded" && r.load?.loaded).length).toBe(39);
    const a = reuseB1c("HEAD"), b = reuseCheck("HEAD");
    expect(a.lines.filter((l) => !l.startsWith("SAME "))).toEqual([expect.stringMatching(/^REUSE PASS/)]);
    expect([a.same, b.same]).toEqual([true, true]);
  });
});

describe("the table", () => {
  const FIX = join(import.meta.dir, "fixtures/b1d-sessions"), job = mkdtempSync(join(tmpdir(), "b1d-table-"));
  let n = 0;
  const trial = (arm: string, capture: string, opts: { hookLog?: boolean; info?: object; mark?: boolean } = {}) => {
    const name = "t1__" + ++n, dir = join(job, name), cap = loadB1dCaptured(join(FIX, capture));
    mkdirSync(join(dir, "evaluator"), { recursive: true }); mkdirSync(join(dir, "artifacts/logs/artifacts"), { recursive: true });
    writeFileSync(join(dir, "config.json"), JSON.stringify({ agent: { name: "laneb-claude-code", kwargs: { arm, upstream_model: "claude-opus-5-5" } }, task: { path: "tasks/t1" } }));
    writeFileSync(join(dir, "result.json"), JSON.stringify({ trial_name: name, verifier_result: { rewards: { reward: 0 } } }));
    copyFileSync(join(FIX, capture, "sdk-messages.jsonl"), join(dir, "evaluator", "sdk-messages.jsonl"));
    writeFileSync(join(dir, "artifacts/logs/artifacts/model.patch"), "diff --git a/calc.py b/calc.py\n");
    if (opts.hookLog !== false && cap.hook_log !== null) { mkdirSync(join(dir, "evaluator/gstack-hooks/hooks"), { recursive: true }); writeFileSync(join(dir, "evaluator/gstack-hooks/hooks/skill-route.log"), cap.hook_log); }
    if (opts.info) writeFileSync(join(dir, "evaluator", "usersim-events.jsonl"), JSON.stringify({ event: "start" }) + "\n" + JSON.stringify({ event: "arm", ...opts.info }) + "\n");
    const sessions = new Map([[name, [{ ok_responses: 3, refused_budget: 0, spent_micros: 480_000, route_mark_before_output: opts.mark ?? true } as any]]]);
    return { dir, ctx: { part: "b1d-in-1", sessions, home: "/root" } };
  };
  test("a gstack-main session the hook named prove-it alone on, that loaded it at the first call", () => {
    const t = trial(B1D_ARM, "main-one"), r = b1dRow(t.dir, t.ctx)!;
    expect([r.arm, r.outcome, r.load.loaded, r.load.at_call, r.named, r.position, r.route_mark, r.first_call, r.why_not, r.cost_usd]).toEqual([B1D_ARM, "graded", true, 1, ["prove-it"], "only", true, true, null, 0.48]);
  });
  test("the two-name session that loaded /verify instead, and the plain session the hook named nothing on", () => {
    const two = b1dRow(...Object.values(trial(B1D_ARM, "main-two")) as [string, any])!, none = b1dRow(...Object.values(trial(B1D_ARM, "main-none")) as [string, any])!;
    expect([two.named, two.position, two.verify.loaded, two.load.loaded, two.why_not]).toEqual([["verify", "prove-it"], "second of two", true, false, "loaded /verify instead"]);
    expect([none.named, none.position, none.why_not]).toEqual([[], "not named", "hook did not name prove-it"]);
  });
  test("a session whose hook log was not copied has no position; the noescape arm reads its placement line", () => {
    const t = trial(B1D_ARM, "main-one", { hookLog: false }), r = b1dRow(t.dir, t.ctx)!;
    expect([r.named, r.position, r.why_not]).toEqual([null, null, null]);
    const lost = trial(B1D_ARM, "main-none", { hookLog: false }), q = b1dRow(lost.dir, lost.ctx)!;
    expect([q.named, q.why_not]).toEqual([null, "hook log missing"]);
    const cap = loadB1dCaptured(join(FIX, "noescape-stop")), u = trial(NOESCAPE.arm, "noescape-stop", { info: cap.arm_info! }), s = b1dRow(u.dir, u.ctx)!;
    expect([s.arm, s.placed, s.named, s.route_mark, s.why_not]).toEqual([NOESCAPE.arm, true, null, null, "never named"]);
  });
  test("B1's table refuses B1d's arms", () => {
    const t = trial(B1D_ARM, "main-one");
    expect(() => b1Row(t.dir, t.ctx)).toThrow(/has arm "gstack-main", not one of none/);
  });
});

describe("scripted sessions", () => {
  const FIX = join(import.meta.dir, "fixtures/b1d-sessions"), cap = (n: string) => loadB1dCaptured(join(FIX, n));
  for (const c of B1D_CASES) test(c.name + " holds every assertion", () => expect(b1dCaseProblems(c, cap(c.name))).toEqual([]));
  test("each arm's skill listing: gstack-main lists 64 entries in full, the project-file arms 2, none 1", () => {
    const facts = (n: string) => listingFacts(cap(n).listing);
    expect(facts("main-one")).toEqual({ chars: 9746, entries: GSTACK_ARM.listed + 1, bare: 0, prove_it: "full" });
    expect(facts("noescape-stop")).toEqual({ chars: 426, entries: 2, bare: 0, prove_it: "full" });
    expect(facts("project-md-stop")).toEqual(facts("noescape-stop"));
    expect(facts("none-stop")).toEqual({ chars: 332, entries: 1, bare: 0, prove_it: "absent" });
  });
  test("the assertions fail when the arm delivers the wrong thing", () => {
    const at = (n: string) => B1D_CASES.find((c) => c.name === n)!, has = (p: string[], w: string) => p.some((x) => x.includes(w));
    const one = cap("main-one"), guard = cap("main-guard"), no = cap("noescape-stop");
    expect(has(b1dCaseProblems(at("main-one"), { ...one, listing: one.listing!.replace(/^- verify: .*$/m, "- verify") }), "bare name")).toBe(true);
    expect(has(b1dCaseProblems(at("main-one"), { ...one, listing: one.listing!.replace(/^- qa: .*\n/m, "") }), "does not name qa")).toBe(true);
    expect(has(b1dCaseProblems(at("main-one"), { ...one, listing: one.listing! + "- modernize: x\n" }), "user-only modernize")).toBe(true);
    expect(has(b1dCaseProblems(at("main-one"), { ...one, hook_context: [] }), "one hook line naming /prove-it alone")).toBe(true);
    expect(has(b1dCaseProblems(at("main-one"), { ...one, hook_log: "x event=routed skill=verify\n" }), "routed to prove-it alone")).toBe(true);
    expect(has(b1dCaseProblems(at("main-two"), cap("main-one")), "two-name line")).toBe(true);
    expect(has(b1dCaseProblems(at("main-guard"), { ...guard, guard: "" }), "does not ask")).toBe(true);
    expect(has(b1dCaseProblems(at("noescape-stop"), cap("project-md-stop")), "holds the escape clause")).toBe(true);
    expect(has(b1dCaseProblems(at("noescape-stop"), { ...no, probe: { ...no.probe!, commits: "1" } }), "routing commit")).toBe(true);
    expect(has(b1dCaseProblems(at("main-none"), cap("main-one")), "a hook line reached a session")).toBe(true);
  });
  test("the commit cue holds in both project-file arms: gstack's message on the snapshot, and the block byte for byte", () => {
    for (const n of ["noescape-stop", "project-md-stop"]) expect(cap(n).probe).toMatchObject({ subject: PLACEMENT.message, commits: "2" });
    expect(cap("noescape-stop").probe!.claude_md_sha256).toBe(sha256(noescapeBlock()));
  });
});

describe("the preregistration's attachments", () => {
  const B = join(REPO, "wiki/plans/2026-11-19-capy-b1d-hook-default-prereg"), body = (f: string) => readFileSync(join(B, f), "utf8").split("\n").slice(1).join("\n");
  test("power.txt is what b1d power prints on the committed route table and B1c's published rows", () => expect(body("power.txt")).toBe(powerLines().join("\n") + "\n"));
  test("the route table is the one the front matter pins, and its run rows are B1's 60 tasks", () => {
    const routes = inSampleRoutes();
    expect(RUN.every((t) => routes.has(t))).toBe(true);
    expect(routes.size).toBe(70);
  });
  test("plan.txt holds each item's recorded cap", () => {
    for (const i of ["b1d-smoke", "b1d-in", "b1d-ho"] as const) expect(body("plan.txt")).toContain(i + ": ");
    for (const i of ["b1d-smoke", "b1d-in", "b1d-ho"] as const) expect(body("plan.txt")).toMatch(new RegExp(i + ": .*recorded cap \\$" + B1D_CAPS_USD[i] + "\n"));
  });
  test("heldout.txt is draw.py's pool line, the pinned draw digests and the pinned coverage, and names no held-out task", () => {
    const pool = spawnSync("python3", [join(B, "draw.py")], { encoding: "utf8" });
    expect(pool.status).toBe(1);
    const text = readFileSync(join(B, "heldout.txt"), "utf8"), first = pool.stdout.trim();
    expect(first).toBe("pool " + HELDOUT.pool.tasks + " tasks from " + HELDOUT.pool.repos + " repositories, sorted sha256 " + HELDOUT.pool.sortedSha256);
    expect(text).toContain(first + "\nrun 60 tasks from 60 repositories, sorted sha256 " + HELDOUT.sortedSha256 + " draw-order sha256 " + HELDOUT.drawSha256 + "\n");
    const c = HELDOUT.coverage;
    expect(text).toContain("prove-it named alone " + c.only + ", first of two " + c.first + ", second of two " + c.second + ", not named " + c.none);
    expect(readFileSync(join(B, "draw.py"), "utf8")).toContain("SEED_SHA256 = '" + HELDOUT.seedSha256 + "'");
    const ids = new Set((JSON.parse(readFileSync(join(REPO, "quick/laneb/tasks/swerebench-r3a4.json"), "utf8")).tasks as { task_id: string }[]).map((t) => t.task_id).filter((t) => !RUN.includes(t)));
    expect([...readFileSync(join(B, "README.md"), "utf8").matchAll(/[\w.-]+__[\w.-]+/g)].map((m) => m[0]).filter((t) => ids.has(t) && !(B1D_SMOKE as readonly string[]).includes(t))).toEqual([]);
    expect([...text.matchAll(/[\w.-]+__[\w.-]+/g)]).toEqual([]);
  });
});
