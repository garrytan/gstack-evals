// Copyright (c) 2026 Garry Tan. MIT License.
// Keyless tests of the eng-review build read's run pipeline (lanes/eng-build/pipeline.ts) with stub sessions and model
// calls on a temporary ledger: the paid-stage lease rule, screen, unit build, notes, the review stage with its Stop hook,
// bundles and resume, the build stage with its cache and gap rule, the test-line count, the build session's end rule,
// and the eb subcommands' refusals. The grader runs a real unit only under GSTACK_EVALS_DOCKER=1.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readItem } from "../../src/runner/ledger/record.ts";
import { main } from "../../lanes/eng-build/cli.ts";
import { fixtureUnit, oneCommitRepo, stubBuild, stubGrader, stubReview, tempLedger } from "../../lanes/eng-build/dryrun-pipeline.ts";
import { EbError } from "../../lanes/eng-build/errors.ts";
import { buildEnd, reviewEnd } from "../../lanes/eng-build/launch.ts";
import { bundleFor, buildUnits, paidItem, runBuilds, runReviews, screenAll, stubLauncher, testLinesAdded, underLease, unitGrader, writeNotes, type Launcher, type ReviewSession } from "../../lanes/eng-build/pipeline.ts";
import { removeLabelled } from "../../lanes/eng-build/screen.ts";
import { buildUnit, readUnit, type BuildOutcome } from "../../lanes/eng-build/unit.ts";
import { patchFrom, tempDir } from "../real/fixture.ts";
import { goRepo, GO_CALC, GO_FIXED } from "../eng-build/fixture.ts";

const codeOf = async (f: () => unknown): Promise<string> => {
  try {
    await f();
    return "no stop";
  } catch (e) {
    return e instanceof EbError ? e.code + " " + e.message : String(e);
  }
};

let tmp: ReturnType<typeof tempDir>;
let n = 0;
const fresh = () => join(tmp.dir, "t" + ++n);
beforeAll(() => {
  tmp = tempDir("eb-pipeline-test-");
});
afterAll(() => tmp?.cleanup());

describe("paid stages run under one ledger lease", () => {
  test("a stage without its ledger flags, on another stage's item or above the plan cap is refused before anything runs", async () => {
    expect(await codeOf(() => paidItem("review", { item: "eb-reviews-opus" }))).toBe("E_USAGE the paid review stage runs only under a ledger lease; it needs --cap-usd, --ledger-record, --ledger, and nothing ran");
    expect(await codeOf(() => paidItem("build", { item: "eb-reviews-opus", capUsd: "5", record: "r", ledger: "l" }))).toBe("E_USAGE the build stage spends from eb-builds-opus or eb-stage-sol or eb-stage-particle, not eb-reviews-opus");
    expect(await codeOf(() => paidItem("notes", { item: "eb-build-units", capUsd: "921", record: "r", ledger: "l" }))).toBe("E_USAGE --cap-usd 921 is not a positive amount at or under item eb-build-units's plan cap of $920");
  });

  test("the lease is open while the stage runs and settled after, also when the stage throws; a launcher with no lease runs nothing", async () => {
    const dir = fresh();
    mkdirSync(dir, { recursive: true });
    const l = tempLedger(dir, ["eb-reviews-opus"]);
    const p = paidItem("review", { item: "eb-reviews-opus", capUsd: "10", record: l.record, ledger: l.ledger });
    const during = await underLease(p, stubLauncher("backend"), async (b, lease) => b + " " + (readItem(l.record, p.item).open?.lease_id === lease));
    expect(during).toBe("backend true");
    expect(await codeOf(() => underLease(p, stubLauncher(0), async () => { throw new EbError("E_EB_GAP", "stub"); }))).toBe("E_EB_GAP stub");
    const st = readItem(l.record, p.item);
    expect(st.leases.length).toBe(2);
    expect(st.leases.every((x) => x.close !== null)).toBe(true);
    let closed = false;
    let ran = false;
    const none: Launcher<number> = async () => ({ lease_id: "", backend: 1, close: async () => void (closed = true) });
    expect(await codeOf(() => underLease(p, none, async () => void (ran = true)))).toBe("E_USAGE the eb-reviews-opus launcher opened no lease, so no session ran");
    expect([closed, ran]).toEqual([true, false]);
  });
});

describe("screen, units and notes", () => {
  test("screen prints a drop with its code; units keeps only qualifying units and prints each drop", async () => {
    const lines: string[] = [];
    const r = screenAll({ candidates: [{ id: "c1", base: "a", merge: "b", fixes: [] }], repo: "/fixture/repo", work: "/fixture/work", screen: (c) => ({ id: c.id, qualifies: false, code: "E_EB_NO_AFTERMATH", step: "fix", cls: "no_test_change", ecosystems: [], functionalPass: 0, f2p: [], base: { pass: 0, fail: 0, no_result: 0 }, steps: [] }), log: (l) => lines.push(l) });
    expect(r.map((x) => x.qualifies)).toEqual([false]);
    expect(lines).toEqual(["E_EB_NO_AFTERMATH screen c1: dropped at fix (no_test_change)"]);
    const fx = goRepo(join(fresh(), "repo"));
    const out: string[] = [];
    const kept = await buildUnits({ specs: [{ spec: fx.spec, repo: fx.repo }], out: fresh(), work: fresh(), labels: join(fresh(), "labels.json"), seed: 1, build: (_s, _r, dir) => ({ qualifies: false, dir, eb: { unit: fixtureUnit("ebgo"), drops: [{ code: "E_EB_IMAGE", step: "merged", cls: "no_functional_pass", cases: 0 }] } }) as unknown as BuildOutcome, log: (l) => out.push(l) });
    expect(kept).toEqual([]);
    expect(out).toEqual(["E_EB_IMAGE unit ebgo: merged (no_functional_pass)"]);
  });

  // Value: protects=the unit stage's containment gates dropping a unit before the pilot; fails_when=a unit whose gate
  // returns a drop still reaches units.json, or the drop prints in another shape than a build drop.
  test("units leaves out a qualifying unit whose containment gate drops it, with the build drop's line", async () => {
    const fx = goRepo(join(fresh(), "repo"));
    const out: string[] = [];
    const seen: string[] = [];
    const kept = await buildUnits({ specs: [{ spec: fx.spec, repo: fx.repo }], out: fresh(), work: fresh(), labels: join(fresh(), "labels.json"), seed: 1, build: (_s, _r, dir) => ({ qualifies: true, dir, eb: { unit: fixtureUnit("ebgo"), drops: [] } }) as unknown as BuildOutcome, log: (l) => out.push(l), gate: async (u) => (seen.push(u.unit.id), [{ code: "E_EB_LEAK", step: "sidecar-origin", cls: "tag", cases: 0 }]) });
    expect(kept).toEqual([]);
    expect(seen).toEqual(["ebgo"]);
    expect(out.filter((l) => l.startsWith("E_"))).toEqual(["E_EB_LEAK unit ebgo: sidecar-origin (tag)"]);
  });

  test("notes: a refused note is written nowhere; a written note is never asked for again", async () => {
    const fx = goRepo(join(fresh(), "repo"));
    const u = { dir: "/fixture/unit", repo: fx.repo, spec: fx.spec, unit: fixtureUnit(fx.spec.id) };
    const out = fresh();
    const lines: string[] = [];
    const refused = await writeNotes({ units: [u], out, call: async (role) => (role === "writer" ? "A note." : "FAIL"), log: (l) => lines.push(l) });
    expect(refused).toEqual({ written: [], refused: ["ebgo"] });
    expect(existsSync(join(out, "ebgo.md"))).toBe(false);
    expect(lines[0]!.startsWith("note ebgo: the audit refused it (")).toBe(true);
    writeFileSync(join(out, "ebgo.md"), "kept\n");
    let calls = 0;
    expect(await writeNotes({ units: [u], out, call: async () => (calls++, "PASS") })).toEqual({ written: ["ebgo"], refused: [] });
    expect(calls).toBe(0);
  });
});

describe("the review stage", () => {
  test("each session gets a stripped one-commit tree and the plan; the Stop hook is on skill arms only; a resume reruns nothing", async () => {
    const dir = fresh();
    const unit = { id: "u1", repo: oneCommitRepo(join(dir, "base")), plan: join(dir, "plan.md") };
    writeFileSync(unit.plan, "# Plan\n");
    const seen = { hooks: {} as Record<string, boolean>, prompts: [] as string[] };
    const trees: string[][] = [];
    const inner = stubReview(seen);
    const session: ReviewSession = async (s) => {
      trees.push([existsSync(join(s.seed, "repo", "CLAUDE.md")) ? "CLAUDE.md kept" : "stripped", readFileSync(join(s.seed, "plan.md"), "utf8")]);
      return inner(s);
    };
    const out = join(dir, "out");
    for (const arm of ["plain", "precut"] as const) await runReviews({ units: [unit], arm, reviewer: "opus", reps: [1, 2], out, session });
    expect(seen.hooks).toEqual({ plain: false, precut: true });
    expect(trees.every(([s, p]) => s === "stripped" && p === "# Plan\n")).toBe(true);
    expect(seen.prompts[0]).toBe("Review the plan in plan.md for the code in /work/repo, and make it better before anyone builds it. Leave the improved plan in plan.md.");
    const again = await runReviews({ units: [unit], arm: "precut", reviewer: "opus", reps: [1, 2], out, session: async () => { throw new Error("reran"); } });
    expect(again.map((r) => [r.rep, r.outcome, r.exposed, r.bundleWords])).toEqual([[1, "completed", false, 9], [2, "completed", false, 9]]);
  });

  test("two upstream errors make a gap with no bundle; cost sums every attempt", async () => {
    const dir = fresh();
    const unit = { id: "u2", repo: oneCommitRepo(join(dir, "base")), plan: join(dir, "plan.md") };
    writeFileSync(unit.plan, "# Plan\n");
    const lines: string[] = [];
    const recs = await runReviews({ units: [unit], arm: "plain", reviewer: "sol", reps: [1], out: join(dir, "out"), log: (l) => lines.push(l), session: async (s) => ({ end: "upstream", costUsd: 0.25, result: { dir: s.dir, outputs: { plan: null, transcript: "", stateRoot: null, coverage: null }, finalRepo: join(s.seed, "repo"), blocks: 0 } }) });
    expect(recs[0]).toMatchObject({ outcome: "upstream_gap", bundleWords: 0, costUsd: 0.5 });
    expect(existsSync(join(dir, "out", "bundles"))).toBe(false);
  });

  test("a bundle on disk with other bytes stops the resume", async () => {
    const dir = fresh();
    const outputs = { plan: "# Plan\n", transcript: "", stateRoot: null, coverage: null };
    expect(bundleFor("plain", outputs, dir).words).toBe(4);
    expect(await codeOf(() => bundleFor("plain", { ...outputs, plan: "# Other\n" }, dir))).toStartWith("E_EB_CACHE_STALE review bundle");
  });
});

describe("the build stage", () => {
  test("a reviewed arm whose review ended in a gap never builds; finished cells are read back, never rerun", async () => {
    const out = fresh();
    const unit = fixtureUnit("u3");
    const gap = { unit: "u3", arm: "plain" as const, reviewer: "opus" as const, rep: 1, outcome: "infra_gap" as const, exposed: null, exposedBeforeBlock: null, blocks: 0, bundleWords: 0, truncated: false, repoEditsDiscarded: 0, costUsd: 0.1 };
    let sessions = 0;
    const session = async (s: Parameters<typeof stubBuild>[0]) => (sessions++, stubBuild(s));
    const lines: string[] = [];
    const a = await runBuilds({ units: [{ unit, note: "Add Mul." }], arm: "plain", reviewer: "opus", reps: [1], pilot: true, reviews: [gap], out, session, grader: stubGrader, log: (l) => lines.push(l) });
    expect([a[0]!.outcome, sessions]).toEqual(["infra_gap", 0]);
    expect(lines[0]).toStartWith("E_EB_GAP cell u3:plain:opus:1");
    const b = await runBuilds({ units: [{ unit, note: "Add Mul." }], arm: "none", reviewer: null, reps: [1, 2], pilot: true, reviews: [], out, session, grader: stubGrader });
    expect([b.map((x) => x.outcome), sessions]).toEqual([["completed", "completed"], 2]);
    await runBuilds({ units: [{ unit, note: "Add Mul." }], arm: "none", reviewer: null, reps: [1, 2], pilot: true, reviews: [], out, session, grader: stubGrader });
    expect(sessions).toBe(2);
    expect(await codeOf(() => runBuilds({ units: [], arm: "none", reviewer: "opus", reps: [1], pilot: false, reviews: [], out, session, grader: stubGrader }))).toBe("E_USAGE the none arm builds with no reviewer, and every other arm names one");
  });

  test("test lines count only added lines in test files", () => {
    const patch = ["diff --git a/calc.go b/calc.go", "--- a/calc.go", "+++ b/calc.go", "+func Mul() {}", "diff --git a/calc_test.go b/calc_test.go", "--- a/calc_test.go", "+++ b/calc_test.go", "+func TestMul() {}", "+", "-old", "diff --git a/web/test/a.js b/web/test/a.js", "+++ b/web/test/a.js", "+it()", "+++ b/tests/test_ops.py", "+def test_x(): pass"].join("\n");
    expect(testLinesAdded(patch)).toBe(4);
  });

  test("a Lane B session's end follows the outcome driver's end kinds", () => {
    const proxy = { refusals: [], unknown_micros: 0, allowance_stops: 0, finalized: true, spent_micros: 10 };
    expect(buildEnd({ termination: "completed", proxy })).toBe("completed");
    expect(buildEnd({ termination: "turn_ceiling", proxy })).toBe("limit");
    expect(buildEnd({ termination: "error_result", proxy })).toBe("upstream_gap");
    expect(buildEnd({ termination: "cancelled", proxy })).toBe("infra_gap");
    expect(buildEnd(null)).toBe("infra_gap");
  });
});

describe("review attempt ends", () => {
  test("web results despite the denial are a containment failure: infra with its reason, so one rerun and then a gap", async () => {
    const web = reviewEnd({ state: "contaminated", web: ["https://example.com"] } as never, "u1:precut:opus:1");
    expect(web).toEqual({ end: "infra", why: "1 web result despite the denied web tools, a containment failure, so the attempt ends infra (one rerun, then a gap)" });
    expect(reviewEnd({ state: "arm-stop", reason: "turn limit", detail: "" } as never, "c").end).toBe("limit");
    expect(reviewEnd({ state: "infra", reason: "API error", detail: "" } as never, "c").end).toBe("upstream");
    expect(reviewEnd({ state: "infra", reason: "crash", detail: "" } as never, "c").end).toBe("infra");
    expect(reviewEnd({ state: "no-block" } as never, "c").end).toBe("completed");
    expect(await codeOf(() => reviewEnd({ state: "cap" } as never, "c"))).toStartWith("E_EB_CELL_INCOMPLETE the proxy stopped cell c at the cap");
    const dir = fresh();
    const unit = { id: "u9", repo: oneCommitRepo(join(dir, "base")), plan: join(dir, "plan.md") };
    writeFileSync(unit.plan, "# Plan\n");
    const recs = await runReviews({ units: [unit], arm: "plain", reviewer: "opus", reps: [1], out: join(dir, "out"), session: async (s) => ({ end: web.end, costUsd: 0.1, result: { dir: s.dir, outputs: { plan: null, transcript: "", stateRoot: null, coverage: null }, finalRepo: join(s.seed, "repo"), blocks: 0 } }) });
    expect(recs[0]!.outcome).toBe("infra_gap");
  });
});

describe("eb subcommands", () => {
  const run = async (argv: string[]) => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await main(argv, { out: (t) => out.push(t), err: (t) => err.push(t) });
    return { code, err: err.join("\n") };
  };
  test("every paid subcommand refuses to run without a lease, and review refuses the none arm", async () => {
    for (const sub of ["notes", "review", "build"]) {
      const r = await run([sub, "--arm", "plain"]);
      expect(r.code).toBe(2);
      expect(r.err).toStartWith("E_USAGE gstack-evals eb " + sub + ": the paid " + sub + " stage runs only under a ledger lease");
    }
    expect((await run(["review", "--arm", "none,plain"])).err).toStartWith("E_USAGE gstack-evals eb review: the none arm runs no review session");
  });
});

describe.skipIf(process.env.GSTACK_EVALS_DOCKER !== "1")("the grader in Docker (GSTACK_EVALS_DOCKER=1)", () => {
  afterAll(() => removeLabelled());
  test("a build's final.patch fixing the merge's bug passes its aftermath case in every run", async () => {
    const fx = goRepo(join(fresh(), "repo"));
    const out = buildUnit(fx.spec, fx.repo, join(fresh(), "unit"), { work: fresh(), labels: join(fresh(), "labels.json"), seed: 7 });
    const tree = fresh();
    mkdirSync(tree, { recursive: true });
    writeFileSync(join(tree, "final.patch"), patchFrom(fx.repo, fx.sha.base!, { "calc.go": GO_CALC + GO_FIXED }));
    const unit = readUnit(out.dir).eb.unit;
    const r = await unitGrader({ dirs: new Map([[unit.id, out.dir]]), work: fresh(), runs: 2 })({ unit, tree });
    expect(r.aftermath.B1).toEqual([{ id: ".::TestMulZero", runs: ["pass", "pass"] }]);
    expect(r.functional.map((c) => c.runs)).toEqual([["pass", "pass"], ["pass", "pass"]]);
    expect(r.catches).toEqual({ B1: false });
    expect(r.coverage).toBe(0);
  }, 1_800_000);
});
