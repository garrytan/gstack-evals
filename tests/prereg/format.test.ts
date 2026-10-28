import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { admissionProblems, loadPreregistration, preregistrationProblems, type Preregistration } from "../../src/runner/prereg/format.ts";

const FIXTURES = join(import.meta.dir, "fixtures");
const fixture = (name: string): Preregistration => JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), "utf8"));

// A Phase 3 style parity preregistration: Opus none and gstack at 3 trials, each cheap model's arms at 5.
function parity(tasks: number, cheap: string[]): Preregistration {
  const ids = cheap.map((m) => `parity-${m}`);
  return {
    schema_version: 1, id: "test-parity", title: "Parity on build-fix", author: "test", model: "anthropic/claude-opus-5-5", date: "2026-10-28",
    claim: "confirmatory", question: "Does gstack bring each cheap model to parity with Opus 5.5 without gstack?",
    arms: [{ name: "none", kind: "bare", description: "No skills.", pins: {} }, { name: "gstack", kind: "stack", description: "gstack.", pins: { gstack: "61e201ec08bc" } }],
    models: [
      { id: "opus", route: "anthropic", weights: "closed", role: "agent" },
      ...cheap.map((id) => ({ id, route: "openrouter", weights: "open" as const, role: "agent" as const })),
    ],
    cells: [
      { id: "opus/none", model: "opus", arm: "none", tasks: "build-fix", trials: 3 },
      { id: "opus/gstack", model: "opus", arm: "gstack", tasks: "build-fix", trials: 3 },
      ...cheap.flatMap((m) => ["none", "gstack"].map((arm) => ({ id: `${m}/${arm}`, model: m, arm, tasks: "build-fix", trials: 5 }))),
    ],
    tasks: [{ id: "build-fix", source: "minted", count: tasks, digest: "a".repeat(64), sealed: true }],
    metrics: { primary: [{ id: "pass", definition: "hidden tests pass", direction: "higher" }] },
    analysis: {
      pairing: "task_mean", alpha: 0.05,
      interval: { method: "task_clustered_bootstrap", level: 0.95, resamples: 10000, seed: 1 },
      missing_cells: { min_trials: 2, on_missing: "drop_task", max_dropped_share: 0.05 },
      comparisons: cheap.map((m, i) => ({ id: ids[i]!, a: "opus/none", b: `${m}/gstack`, metric: "pass", gate: "noninferiority" as const, direction: "higher" as const, margin: 0.1, parity: true })),
      holm: [{ id: "parity", comparisons: ids }],
      ceiling_rule: "Opus none at 90% or more, or half the tasks passing every trial in every arm, withholds every parity claim.",
    },
    power: ids.map((comparison) => ({ comparison, sd: 0.3, sd_source: "Phase 2b, Haiku 5.5 plus gstack at 2 trials", effect: 0.07, alpha: 0.05 / cheap.length, power: 0.9 })),
    money: { cap_usd: 100, funding: "program", line_item: "phase-3", ledger: "ledger/phase-3.jsonl", approval: { words: "yes", by: "owner", source: "test" }, reservation: "worst case per session", stop_rule: "cap stop is incomplete" },
    peg: { as_of: "2026-10-26", sha256: "b".repeat(64), source: "OpenRouter Data API, category=programming" },
    limits: [],
  };
}

describe("the quick-look preregistrations fit the format", () => {
  test("Lane A and the review replay pass as their posts wrote them", () => {
    expect(preregistrationProblems(fixture("lanea-quick"))).toEqual([]);
    expect(preregistrationProblems(fixture("replay-quick"))).toEqual([]);
  });

  test("Lane B is refused until its placeholders are filled", () => {
    const p = fixture("laneb-quick");
    expect(preregistrationProblems(p)).toEqual([
      "arms[0].pins.tarball has an unfilled placeholder: __NONE_TAR__",
      "arms[1].pins.tarball has an unfilled placeholder: __GSTACK_TAR__",
      "arms[2].pins.tarball has an unfilled placeholder: __PLACEBO_TAR__",
      "arms[2].pins.generator has an unfilled placeholder: __GEN_HASH__",
      "arms[2].pins.seed has an unfilled placeholder: __SEED__",
    ]);
    for (const arm of p.arms) for (const key of Object.keys(arm.pins)) if (arm.pins[key]!.startsWith("__")) arm.pins[key] = "c".repeat(64);
    expect(preregistrationProblems(p)).toEqual([]);
  });
});

describe("power and parity", () => {
  const CHEAP = ["haiku", "deepseek", "glm"];

  test("three cheap models at 213 tasks and SD 0.30 are underpowered by one task; 214 pass", () => {
    expect(preregistrationProblems(parity(213, CHEAP))).toEqual(CHEAP.map((m) => `comparison parity-${m} is underpowered: 214 tasks needed at SD 0.3, 213 preregistered; preregister it as exploratory, or parity as not attempted`));
    expect(preregistrationProblems(parity(214, CHEAP))).toEqual([]);
  });

  test("one primary cheap model at alpha 0.05 is covered by 213 tasks", () => {
    expect(preregistrationProblems(parity(213, ["haiku"]))).toEqual([]);
  });

  test("a power check must use the Holm split, and a parity claim needs its ceiling rule and a noninferiority gate", () => {
    const p = parity(300, CHEAP);
    p.power![0]!.alpha = 0.05;
    delete p.analysis.ceiling_rule;
    p.analysis.comparisons[1]!.gate = "superiority";
    p.analysis.comparisons[1]!.min_effect = 0;
    expect(preregistrationProblems(p)).toEqual([
      "comparison parity-haiku: a parity claim needs analysis.ceiling_rule, so the frontier reference is shown off ceiling",
      "power check for parity-haiku: alpha 0.05 is above the family's 0.05 split 3 ways by Holm",
      "comparison parity-deepseek: a parity claim needs a noninferiority gate",
      "comparison parity-deepseek: a parity claim needs analysis.ceiling_rule, so the frontier reference is shown off ceiling",
      "comparison parity-glm: a parity claim needs analysis.ceiling_rule, so the frontier reference is shown off ceiling",
    ]);
  });

  test("an exploratory preregistration decides nothing, and a confirmatory one needs a power check per gate", () => {
    const exploratory = parity(300, ["haiku"]);
    exploratory.claim = "exploratory";
    expect(preregistrationProblems(exploratory)).toEqual(["comparison parity-haiku: an exploratory preregistration decides nothing; make the gate exploratory or the claim confirmatory"]);
    const unchecked = parity(300, ["haiku"]);
    delete unchecked.power;
    expect(preregistrationProblems(unchecked)).toEqual(["comparison parity-haiku: a confirmatory gate needs a power check"]);
  });

  test("trial-level pairing needs equal trials", () => {
    const p = parity(300, ["haiku"]);
    p.analysis.pairing = "trial";
    expect(preregistrationProblems(p)).toEqual(["comparison parity-haiku: trial-level pairing needs equal trials (3 and 5); use task_mean pairing"]);
  });

  test("a gate on a lower-is-better metric needs the metric's failure_value", () => {
    const p = parity(300, ["haiku"]);
    p.analysis.comparisons[0]!.direction = "lower";
    expect(preregistrationProblems(p)).toEqual(["comparison parity-haiku: metric pass improves downward, so it needs failure_value, the score of a system failure that left no value"]);
    p.metrics.primary[0]!.failure_value = 1;
    expect(preregistrationProblems(p)).toEqual([]);
    p.metrics.primary[0]!.failure_value = "worst" as never;
    expect(preregistrationProblems(p)).toEqual(["metric pass: failure_value must be a finite number"]);
  });

  test("the missing-cell minimum cannot exceed either cell's scheduled trials", () => {
    const p = parity(300, ["haiku"]);
    p.analysis.missing_cells.min_trials = 3;
    expect(preregistrationProblems(p)).toEqual([]);
    p.analysis.missing_cells.min_trials = 4;
    expect(preregistrationProblems(p)).toEqual(["comparison parity-haiku: missing_cells.min_trials 4 is above the trials scheduled (3 and 5), so every task would count as missing"]);
  });
});

describe("the other rules", () => {
  const base = () => parity(300, ["haiku"]);

  test("sealed sets list no ids, digests are full, and comparisons pair cells on one task set", () => {
    const p = base();
    p.tasks[0]!.ids = Array.from({ length: 300 }, (_, i) => `t${i}`);
    p.tasks.push({ id: "other", source: "x", count: 5, digest: "abc123", sealed: false });
    p.cells.push({ id: "haiku/other", model: "haiku", arm: "gstack", tasks: "other", trials: 5 });
    p.analysis.comparisons.push({ id: "cross", a: "opus/none", b: "haiku/other", metric: "pass", gate: "exploratory" });
    expect(preregistrationProblems(p)).toEqual([
      "task set build-fix: a sealed set lists counts and digests only, never task ids",
      "task set other: digest must be a full sha256 in lowercase hex",
      "comparison cross: cells opus/none and haiku/other run different task sets, so they cannot pair by task",
    ]);
  });

  test("a paid run needs the owner's words, and an open-weight model needs the peg", () => {
    const p = base();
    p.money.approval = { words: "", by: "owner", source: "test" };
    delete p.peg;
    expect(preregistrationProblems(p)).toEqual([
      "money.approval needs the owner's words, who said them and where",
      "peg required: haiku has open weights, so record the OpenRouter programming ranking read at preregistration",
    ]);
    const q = base();
    q.peg = { as_of: null, sha256: null, source: "collection page" };
    expect(preregistrationProblems(q)).toEqual(["peg.note must say why as_of or sha256 is missing"]);
  });

  test("structure: unknown fields, missing metrics, unlisted arms and a bad missing-cell rule", () => {
    const p = base() as Preregistration & { tuned_after?: boolean };
    p.tuned_after = true;
    p.metrics.primary = [];
    p.cells[0]!.arm = "gbrain";
    p.analysis.missing_cells = { min_trials: 0, on_missing: "drop_task" };
    expect(preregistrationProblems(p)).toEqual([
      "unknown field tuned_after",
      "cell opus/none: arm gbrain is not listed",
      "metrics.primary must name at least one metric",
      "analysis.missing_cells: min_trials must be an integer >= 1",
      "comparison parity-haiku: metric pass is not listed",
    ]);
    expect(preregistrationProblems([])).toEqual(["a preregistration must be a JSON object"]);
  });

  test("loadPreregistration returns a valid file and throws with every problem", () => {
    const dir = mkdtempSync(join(tmpdir(), "prereg-format-"));
    const good = join(dir, "good.json"), bad = join(dir, "bad.json");
    writeFileSync(good, JSON.stringify(base()));
    writeFileSync(bad, JSON.stringify({ ...base(), schema_version: 2 }));
    expect(loadPreregistration(good, { item: "phase-3", admission: "required" }).id).toBe("test-parity");
    expect(() => loadPreregistration(bad, { item: "phase-3", admission: "required" })).toThrow("cannot be run: schema_version must be 1");
    expect(() => loadPreregistration(good, { item: "phase-3", admission: "warn" })).toThrow("needs an item created with --admission required");
  });
});

describe("admission (GSTA-8's CI plan, decision 3)", () => {
  const program = () => parity(300, ["haiku"]);

  test("a program preregistration needs a ledger item that requires admission", () => {
    expect(admissionProblems(program(), { item: "phase-3", admission: "required" })).toEqual([]);
    expect(admissionProblems(program(), { item: "phase-3", admission: "warn" })).toEqual(["line item phase-3 has admission warn; a program preregistration needs an item created with --admission required"]);
    expect(admissionProblems(program(), { item: "phase-3" })).toEqual(["line item phase-3 has admission unset; a program preregistration needs an item created with --admission required"]);
    expect(admissionProblems(program(), null)).toEqual(["line item phase-3 has no record in the ledger; create it with ledger init --item phase-3 --admission required"]);
    expect(admissionProblems(program(), { item: "replay-quick", admission: "required" })).toEqual(["the ledger record given is for line item replay-quick, not phase-3"]);
  });

  test("a caller's run and an unpaid run need no admission, and a paid run must say who funds it", () => {
    const caller = program();
    caller.money.funding = "caller";
    expect(admissionProblems(caller, { item: "phase-3", admission: "warn" })).toEqual([]);
    const unpaid = program();
    unpaid.money = { cap_usd: 0 };
    expect(admissionProblems(unpaid, null)).toEqual([]);
    const unsaid = program();
    delete unsaid.money.funding;
    expect(preregistrationProblems(unsaid)).toEqual(["money.funding must be program or caller for a paid run"]);
  });
});
