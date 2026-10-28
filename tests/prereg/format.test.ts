import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { admissionProblems, loadPreregistration, preregistrationProblems, type Preregistration } from "../../src/runner/prereg/format.ts";

const fixture = (path: string): Preregistration => JSON.parse(readFileSync(path, "utf8"));
const LANEA_QUICK = join(import.meta.dir, "fixtures", "lanea-quick.json");
const LANEB_QUICK = join(import.meta.dir, "fixtures", "laneb-quick.json");
const REPLAY_QUICK = join(import.meta.dir, "fixtures", "replay-quick.json");

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
    expect(preregistrationProblems(fixture(LANEA_QUICK))).toEqual([]);
    expect(preregistrationProblems(fixture(REPLAY_QUICK))).toEqual([]);
  });

  test("Lane B is refused until its placeholders are filled", () => {
    const p = fixture(LANEB_QUICK);
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


describe("field checks the ship gate found untested", () => {
  const base = () => parity(300, ["haiku"]) as any;

  // Value: protects=preregistrationProblems refuses a bad id, a blank title, a model without a provider, a non-ISO date, an unknown claim, non-list limits, an unknown arm kind, an arm without a description, a non-bare arm without pins and an empty pin; fails_when=any of those top-level or arm guards is removed or reworded; why_new=no test reached these branches; seam=none; no_claim=does not cover every combination of failures
  // Generated by gstack /ship (PR #16 ship gate).
  test("identity fields and arms", () => {
    const p = base();
    Object.assign(p, { id: "Bad_ID", title: " ", model: "opus", date: "28/10/2026", claim: "maybe", limits: "none" });
    p.arms[0].kind = "naked";
    p.arms[1].description = "";
    p.arms.push({ name: "empty", kind: "stack", description: "x", pins: {} }, { name: "blank", kind: "overlay", description: "x", pins: { sha: "" } });
    expect(preregistrationProblems(p)).toEqual([
      "id must be lowercase letters, digits, dots and hyphens",
      "title required",
      "model must be the author's model as provider/model",
      "date must be YYYY-MM-DD",
      "claim must be exploratory or confirmatory",
      "limits must be a list of sentences (it may be empty)",
      "arm none: kind must be one of bare, placebo, stack, overlay, loadout",
      "arm none: pins required (a sha or digest that fixes what the arm installs)",
      "arm gstack: description required",
      "arm empty: pins required (a sha or digest that fixes what the arm installs)",
      "arm blank: pin sha is empty",
    ]);
    const dup = base();
    dup.arms.push({ ...dup.arms[0] });
    expect(preregistrationProblems(dup)).toEqual(["arm none is listed twice"]);
  });

  // Value: protects=models, task sets and cells are refused when a route, weights, role or session cap is invalid, a task set lacks a source, a count, a boolean sealed flag or matching ids, or a cell names an unlisted or non-agent model, an unlisted task set, zero trials or a repeated model, arm and task set; fails_when=any of those guards is removed; why_new=the existing tests cover only sealed ids, short digests and unlisted arms; seam=none; no_claim=does not check message order beyond this fixture
  // Generated by gstack /ship (PR #16 ship gate).
  test("models, task sets and cells", () => {
    const p = base();
    Object.assign(p.models[0], { route: "", weights: "mixed" });
    p.models.push({ id: "judge", route: "anthropic", weights: "closed", role: "judge", session_cap_usd: -1 }, { id: "sim", route: "anthropic", weights: "closed", role: "critic" });
    p.tasks.push({ id: "extra", source: "", count: 0, digest: "c".repeat(64), sealed: "no" }, { id: "short", source: "x", count: 3, digest: "d".repeat(64), sealed: false, ids: ["a", "a", "b"] });
    p.cells.push(
      { id: "c1", model: "ghost", arm: "none", tasks: "build-fix", trials: 3 },
      { id: "c2", model: "judge", arm: "none", tasks: "nowhere", trials: 0 },
      { id: "c3", model: "opus", arm: "none", tasks: "build-fix", trials: 3 },
    );
    expect(preregistrationProblems(p)).toEqual([
      "model opus: route required",
      "model opus: weights must be open or closed",
      "model judge: session_cap_usd must be a positive number",
      "model sim: role must be agent, judge or simulator",
      "task set extra: source required",
      "task set extra: count must be an integer >= 1",
      "task set extra: sealed must be true or false",
      "task set short: ids must be 3 distinct task ids",
      "cell c1: model ghost is not listed",
      "cell c2: model judge is not an agent model",
      "cell c2: task set nowhere is not listed",
      "cell c2: trials must be an integer >= 1",
      "cell c3 repeats model, arm and task set opus none build-fix",
    ]);
  });

  // Value: protects=the analysis block is required and its pairing, alpha, interval method, level, resamples and seed are each checked; fails_when=any analysis guard is removed or its range changes; why_new=only missing_cells and pairing-with-trials were tested; seam=none; no_claim=does not test values at each boundary
  // Generated by gstack /ship (PR #16 ship gate).
  test("the analysis block", () => {
    const missing = base();
    delete missing.analysis;
    expect(preregistrationProblems(missing)).toEqual([
      "analysis required",
      "power check for parity-haiku: no such comparison",
      "a confirmatory preregistration needs at least one noninferiority or superiority comparison",
    ]);
    const p = base();
    Object.assign(p.analysis, { pairing: "item", alpha: 0.5, interval: { method: "percentile", level: 0.5, resamples: 999, seed: 1.5 } });
    expect(preregistrationProblems(p)).toEqual([
      "analysis.pairing must be task_mean or trial",
      "analysis.alpha must be in (0, 0.5)",
      "analysis.interval.method must be task_clustered_bootstrap",
      "analysis.interval.level must be in [0.8, 1)",
      "analysis.interval.resamples must be an integer >= 1000",
      "analysis.interval.seed must be an integer",
    ]);
  });

  // Value: protects=Holm families must name listed noninferiority or superiority comparisons once, power checks must name a listed comparison and carry a valid sd, source, effect, alpha and power, and comparisons need distinct cells, an exact assertion, a known gate, a direction, a positive margin and min_effect >= 0, with at least one decided comparison when confirmatory; fails_when=any of those guards is removed; why_new=the existing tests cover only the Holm alpha split, ceiling rule and parity gate; seam=none; no_claim=does not prove the Holm split is the right one for every family shape
  // Generated by gstack /ship (PR #16 ship gate).
  test("comparisons, Holm families and power checks", () => {
    const p = base();
    p.analysis.comparisons.push(
      { id: "same", a: "opus/none", b: "opus/none", metric: "pass", gate: "exact" },
      { id: "odd", a: "opus/none", b: "haiku/none", metric: "pass", gate: "bayes" },
      { id: "nodir", a: "opus/none", b: "haiku/none", metric: "pass", gate: "noninferiority", margin: 0 },
      { id: "sup", a: "opus/none", b: "haiku/none", metric: "pass", gate: "superiority", direction: "higher", min_effect: -1 },
    );
    p.analysis.holm = [{ id: "f1", comparisons: ["parity-haiku", "ghost", "same"] }, { id: "f2", comparisons: ["parity-haiku"] }];
    const check = { sd: 0.3, sd_source: "x", effect: 0.07, alpha: 0.05, power: 0.9 };
    p.power = [
      { comparison: "parity-haiku", sd: 0, sd_source: "", effect: 0.2, alpha: 0.6, power: 0.9 },
      { comparison: "ghost", ...check }, { comparison: "nodir", ...check }, { comparison: "sup", ...check },
    ];
    expect(preregistrationProblems(p)).toEqual([
      "Holm family f1: comparison ghost is not listed",
      "Holm family f1: same is not a noninferiority or superiority comparison",
      "comparison parity-haiku is in two Holm families",
      "power check for ghost: no such comparison",
      "power check for parity-haiku: sd must be positive and sd_source must say where it came from",
      "power check for parity-haiku: effect must be positive and, for noninferiority, at most the margin",
      "power check for parity-haiku: alpha must be in (0, 0.5) and power in [0.5, 1)",
      "comparison same: a and b are the same cell",
      "comparison same: an exact gate needs its assertion",
      "comparison odd: gate must be exact, noninferiority, superiority or exploratory",
      "comparison nodir: direction must be higher or lower",
      "comparison nodir: a noninferiority gate needs a margin > 0",
      "comparison nodir is one of 3 confirmatory gates but in no Holm family; list it in one (a family of one states an unsplit alpha)",
      "power check for nodir: effect must be positive and, for noninferiority, at most the margin",
      "comparison sup: a superiority gate needs min_effect >= 0",
      "comparison sup is one of 3 confirmatory gates but in no Holm family; list it in one (a family of one states an unsplit alpha)",
    ]);
    const undecided = base();
    undecided.analysis.comparisons[0].gate = "exploratory";
    delete undecided.analysis.comparisons[0].parity;
    undecided.analysis.holm = [];
    expect(preregistrationProblems(undecided)).toEqual(["a confirmatory preregistration needs at least one noninferiority or superiority comparison"]);
  });

  // Value: protects=money.cap_usd must be a number >= 0, a paid run needs its line item, ledger, reservation and stop rule, and a peg needs a source, a parseable as_of and a full sha256; fails_when=any money or peg guard is removed; why_new=only the owner's words, funding and the missing peg note were tested; seam=none; no_claim=does not test a caller-funded run's ledger beyond these fields
  // Generated by gstack /ship (PR #16 ship gate).
  test("money and the peg", () => {
    const negative = base();
    negative.money = { cap_usd: -5 };
    expect(preregistrationProblems(negative)).toEqual(["money.cap_usd must be a number >= 0"]);
    const p = base();
    p.money = { cap_usd: 10, funding: "caller", approval: { words: "ok", by: "o", source: "s" } };
    p.peg = { as_of: "soon", sha256: "abc", source: "" };
    expect(preregistrationProblems(p)).toEqual([
      "money.line_item required for a paid run",
      "money.ledger required for a paid run",
      "money.reservation required for a paid run",
      "money.stop_rule required for a paid run",
      "peg.source required",
      "peg.as_of must be a date or null",
      "peg.sha256 must be a full sha256 or null",
    ]);
  });
});


describe("ship review fixes in the format", () => {
  const CHEAP = ["haiku", "deepseek", "glm"];

  // Value: protects=a confirmatory preregistration with several decided comparisons must place each in a Holm family, so dropping the holm block cannot turn a three-model parity design into three unsplit tests; fails_when=a comparison outside every family falls back to an unsplit alpha again; why_new=the existing Holm test always declares the family; seam=none; no_claim=does not decide how families map to gates.ts families
  // Generated by gstack /ship (PR #16 ship gate).
  test("removing the Holm block does not waive the split", () => {
    const p = parity(158, CHEAP);
    delete p.analysis.holm;
    for (const check of p.power!) check.alpha = 0.05;
    expect(preregistrationProblems(p)).toEqual(CHEAP.map((m) => `comparison parity-${m} is one of 3 confirmatory gates but in no Holm family; list it in one (a family of one states an unsplit alpha)`));
    const single = parity(158, ["haiku"]);
    delete single.analysis.holm;
    single.power![0]!.alpha = 0.05;
    expect(preregistrationProblems(single)).toEqual([]);
  });

  // Value: protects=each comparison has at most one power check, so an invalid or conflicting earlier record cannot hide behind a later valid one; fails_when=power checks are collected into a map without a duplicate check; why_new=no test listed a comparison twice; seam=none; no_claim=does not check which of two records a consumer would read
  // Generated by gstack /ship (PR #16 ship gate).
  test("a comparison's power check is listed once", () => {
    const p = parity(300, ["haiku"]);
    p.power!.unshift({ ...p.power![0]!, sd: -100, power: 2 });
    expect(preregistrationProblems(p)).toEqual(["power check for parity-haiku is listed twice"]);
  });

  test("null power entries are reported, not thrown", () => {
    const p = parity(300, ["haiku"]);
    p.power!.push(null as never, null as never);
    expect(preregistrationProblems(p)).toContain("power check for undefined is listed twice");
  });

  // Value: protects=listed task ids must be nonempty strings, as pairTaskMeans needs; fails_when=the ids check counts and dedupes values without checking their type; why_new=the existing ids tests used strings only; seam=none; no_claim=does not check ids against the digest
  // Generated by gstack /ship (PR #16 ship gate).
  test("task ids are nonempty strings", () => {
    const p = parity(300, ["haiku"]);
    Object.assign(p.tasks[0]!, { sealed: false, ids: [null, ...Array.from({ length: 299 }, (_, i) => i + 1)] });
    expect(preregistrationProblems(p)).toEqual(["task set build-fix: ids must be 300 distinct task ids"]);
    p.tasks[0]!.ids = Array.from({ length: 300 }, (_, i) => `t${i}`);
    expect(preregistrationProblems(p)).toEqual([]);
  });
});
