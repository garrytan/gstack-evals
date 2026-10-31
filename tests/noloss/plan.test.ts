import { afterAll, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadCatalog } from "../../lanes/review-replay/catalog/catalog.ts";
import { PLAN_HEADING_WORDS, PLAN_HEADING_WORDS_SHA256, PLAN_MATERIAL_CAP, planMaterial } from "../../lanes/review-noloss/judge.ts";
import { spawnSync } from "node:child_process";
import { simulate } from "../../lanes/review-noloss/power.ts";
import { checkSealedRoot, checkSuite, loadSuite, PLAN_JUDGING_RULE, REPO_ROOT, sealedLeaks, stubProblems, suiteFromCatalog, suiteStub, SUITES_DIR, type SuiteStub } from "../../lanes/review-noloss/suite.ts";
import { cleanup, run, tmp } from "./helpers.ts";
import { CUSTODY, planPanel, planText, writePlanArm, type PlanArm } from "./plan-panel.ts";

afterAll(cleanup);
const inRepo: string[] = [];
afterAll(() => inRepo.forEach((p) => rmSync(p, { recursive: true, force: true })));

const panel = planPanel(tmp("noloss-plan-"), { seeded: 10, "real-neutral": 1, decoy: 4, pilot: 2 });
const S = ["--sealed-root", panel.sealedRoot];
const catalog = join(panel.sealedRoot, "catalog", "plans");
const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));

describe("plan cases and plan suites (B1)", () => {
  test("plan cases are a kind in the one catalog loader, and a decoy's case is its INFORMATIONAL bait", () => {
    const loaded = loadCatalog(catalog, REPO_ROOT);
    expect([loaded.cases.length, loaded.plans.length, loaded.problems]).toEqual([0, 10 * 2 + 1 + 4 + 2, []]);
    const bad = tmp("noloss-plan-bad-");
    const decoy = json(join(catalog, "planpanel-12-1.json"));
    writeFileSync(join(bad, "planpanel-12-1.json"), JSON.stringify({ ...decoy, severity: { deserved: "CRITICAL", basis: "x" } }));
    const seeded = json(join(catalog, "planpanel-1-1.json"));
    writeFileSync(join(bad, "planpanel-1-1.json"), JSON.stringify({ ...seeded, plan: { ...seeded.plan, flaw_class: "bait" } }));
    writeFileSync(join(bad, "planpanel-2-1.json"), JSON.stringify({ ...json(join(catalog, "planpanel-2-1.json")), defect: { ...seeded.defect, file: "src/a.ts" } }));
    const problems = loadCatalog(bad, REPO_ROOT).problems.map((p) => p.file + ": " + p.message);
    expect(problems).toEqual([
      "planpanel-1-1.json: flaw_class bait goes with stratum decoy, and only there",
      "planpanel-12-1.json: a decoy plan's case is its bait, so its deserved severity is INFORMATIONAL",
      "planpanel-2-1.json: schema: /defect/file must be equal to constant",
      'planpanel-2-1.json: schema: / must match "then" schema',
    ]);
  });

  test("a plan suite holds one unit per plan, grouped by stratum, with pilot units left out and the plan judging rule", () => {
    const s = panel.suite;
    expect([s.kind, s.sealed, s.units.length, s.judging_rule]).toEqual(["plan", true, 15, PLAN_JUDGING_RULE]);
    expect(Object.keys(s.groups).sort()).toEqual(["decoy", "real-neutral", "seeded"]);
    expect(s.units.filter((u) => u.group === "seeded").every((u) => u.blockers.length === 2 && u.blockers.every((b) => b.counts === "blocking" && b.file === "plan.md" && b.location === "added"))).toBe(true);
    expect(s.units.filter((u) => u.group === "decoy").every((u) => u.blockers.length === 1 && u.blockers[0]!.counts === "over-blocking")).toBe(true);
    expect(s.excluded.map((e) => e.reason)).toEqual(["stratum pilot is not in this suite; pilot units are never scored", "stratum pilot is not in this suite; pilot units are never scored"]);
    expect(checkSuite(s, { repoRoot: panel.sealedRoot })).toEqual([]);
    const pilot = suiteFromCatalog({ id: "pilot", catalogs: ["catalog/plans"], released: null, root: panel.sealedRoot, strata: ["pilot"] });
    expect(pilot.units.map((u) => u.group)).toEqual(["pilot", "pilot"]);
    expect(checkSuite({ ...s, judging_rule: "same path and cause" }, { repoRoot: panel.sealedRoot })).toEqual(["a plan suite carries the plan judging rule (PLAN_JUDGING_RULE in lanes/review-noloss/suite.ts)"]);
  });

  test("a suite holds review cases or plan cases, never both", () => {
    const mixed = tmp("noloss-plan-mixed-");
    cpSync(catalog, join(mixed, "plans"), { recursive: true });
    cpSync(join(REPO_ROOT, "lanes/review-replay/catalog/public"), join(mixed, "public"), { recursive: true });
    expect(() => suiteFromCatalog({ id: "mixed", catalogs: ["plans", "public"], released: "2026-01-01", root: mixed })).toThrow(/a suite holds one kind/);
  });
});

describe("the sealed root and the stub (open item 1)", () => {
  test("the sealed root takes any absolute directory outside the checkout and refuses one inside it", () => {
    const deep = join(tmp("noloss-root-"), "a b", "c");
    mkdirSync(deep, { recursive: true });
    for (const ok of [panel.sealedRoot, deep, tmp("other-")]) expect(checkSealedRoot(ok)).toBe(ok);
    const link = join(tmp("noloss-link-"), "repo");
    symlinkSync(join(REPO_ROOT, "lanes"), link);
    for (const [dir, why] of [["lanes", /is not an absolute path/], [REPO_ROOT, /is inside the repo/], [join(REPO_ROOT, "lanes", "nope"), /is inside the repo/], [link, /is inside the repo; .* \(it resolves to /], [join(deep, "missing"), /does not exist/]] as const) expect(() => checkSealedRoot(dir)).toThrow(why);
  });

  test("the CLI refuses a relative or in-repo --sealed-root with E_NOLOSS_SUITE", async () => {
    for (const dir of ["sealed", join(REPO_ROOT, "lanes")]) {
      const r = await run(["suite", "--check", "--suite", panel.stubPath, "--sealed-root", dir]);
      expect([r.code, r.err]).toEqual([2, expect.stringMatching(/^E_NOLOSS_SUITE --sealed-root (sealed is not an absolute path|.* is inside the repo)/)]);
    }
  });

  test("suite --stub prints counts and digests only, and the stub names no unit, commit or case", async () => {
    const r = await run(["suite", "--stub", "--suite", panel.suitePath, "--custody", CUSTODY, ...S]);
    expect(r.code).toBe(0);
    const stub = JSON.parse(r.out) as SuiteStub;
    expect(stub).toEqual(json(panel.stubPath));
    expect(Object.keys(stub).sort()).toEqual(["catalogs_sha256", "counts", "custody", "id", "kind", "purpose", "schema_version", "sealed", "sha256", "stub", "title"]);
    expect(stub.counts).toEqual({ units: 15, clusters: 15, blocking: 21, detection: 0, over_blocking: 4, groups: { seeded: 10, "real-neutral": 1, decoy: 4 } });
    expect(sealedLeaks(panel.suite, r.out)).toEqual([]);
    const head = panel.suite.units[0]!.head;
    expect(sealedLeaks(panel.suite, "unit " + head)).toEqual([head.slice(0, 7), head.slice(0, 12), head].sort());
    const bare = await run(["suite", "--stub", "--suite", panel.suitePath, "--custody", "an age bundle", ...S]);
    expect([bare.code, bare.err]).toEqual([2, expect.stringContaining('--custody must start "procedural custody"')]);
    expect(stubProblems({ ...stub, custody: "sealed per plan v3.2" })).toEqual(['custody must start "procedural custody": a key held apart is procedural custody, not plan v3.2 sealing']);
    expect(stubProblems({ ...stub, units: [] } as unknown as SuiteStub)).toEqual(["a stub holds counts and digests only; remove units"]);
  });

  test("a stub loads its sealed suite only with a sealed root whose suite and catalogs match its digests", () => {
    expect(() => loadSuite(panel.stubPath, { sealedRoot: null })).toThrow(/is its stub \(counts and digests only\); pass --sealed-root <dir>/);
    const loaded = loadSuite(panel.stubPath, { sealedRoot: panel.sealedRoot });
    expect([loaded.path, loaded.suite.id, loaded.stub?.custody]).toEqual([panel.suitePath, "planpanel-test", CUSTODY]);
    const copy = (name: string) => {
      const d = join(tmp("noloss-tamper-"), name);
      cpSync(panel.sealedRoot, d, { recursive: true });
      return d;
    };
    const suiteMoved = copy("s");
    writeFileSync(join(suiteMoved, "suites", "planpanel-test.json"), readFileSync(panel.suitePath, "utf8") + " ");
    expect(() => loadSuite(panel.stubPath, { sealedRoot: suiteMoved })).toThrow(/hashes to [0-9a-f]{64}, not the stub's/);
    const keyMoved = copy("k");
    const c = json(join(keyMoved, "catalog", "plans", "planpanel-1-1.json"));
    writeFileSync(join(keyMoved, "catalog", "plans", "planpanel-1-1.json"), JSON.stringify({ ...c, defect: { ...c.defect, cause: "another cause" } }, null, 2) + "\n");
    expect(() => loadSuite(panel.stubPath, { sealedRoot: keyMoved })).toThrow(/an answer key changed after the stub was committed/);
    const counted = join(tmp("noloss-stub-"), "planpanel-test.json");
    const stub = json(panel.stubPath);
    writeFileSync(counted, JSON.stringify({ ...stub, counts: { ...stub.counts, units: 16 } }));
    expect(() => loadSuite(counted, { sealedRoot: panel.sealedRoot })).toThrow(/counts .*, not the stub's/);
  });

  test("a public suite read from outside the repo finds its catalogs under --sealed-root, and refuses with a code without it", async () => {
    const p = planPanel(tmp("noloss-plan-public-"), { seeded: 2, decoy: 1 }, { id: "planpanel-public", visibility: "public" });
    const bare = await run(["suite", "--check", "--suite", p.suitePath]);
    expect([bare.code, bare.err]).toEqual([2, expect.stringMatching(/^E_NOLOSS_SUITE suite planpanel-public names catalog catalog\/plans, which is not under .*; a suite read from outside the repo finds its catalogs under --sealed-root <dir>/)]);
    const held = await run(["suite", "--check", "--suite", p.suitePath, "--sealed-root", p.sealedRoot]);
    expect([held.code, held.err]).toEqual([0, ""]);
  });

  test("a sealed case or a whole sealed suite inside the repo tree is refused", async () => {
    const dir = join(REPO_ROOT, ".noloss-plan-test-" + process.pid);
    inRepo.push(dir);
    cpSync(catalog, join(dir, "plans"), { recursive: true });
    const loaded = loadCatalog(join(dir, "plans"));
    expect(loaded.plans.length).toBe(0);
    expect(new Set(loaded.problems.map((p) => p.message))).toEqual(new Set(["a sealed case is in the repo tree; move it to the sealed store and commit only its digest"]));
    const r = await run(["suite", "--from-catalog", join(".noloss-plan-test-" + process.pid, "plans"), "--id", "inrepo"]);
    expect([r.code, r.err]).toEqual([2, expect.stringContaining("a sealed case is in the repo tree")]);
    cpSync(panel.suitePath, join(dir, "whole.json"));
    expect(() => loadSuite(join(dir, "whole.json"), { sealedRoot: panel.sealedRoot })).toThrow(/holds it whole inside the repo; move it under a sealed root/);
    const out = await run(["suite", "--from-catalog", "catalog/plans", "--id", "x", "--out", join(dir, "x.json"), ...S]);
    expect([out.code, out.err]).toEqual([2, expect.stringContaining("is sealed, and --out " + join(dir, "x.json") + " is inside the repo")]);
  });
});

describe("power at a Holm step and with flaws that move together (B1, open item 12)", () => {
  const clusters = (seeded: number) => [...Array(seeded).fill(2), 1, 1, 1];
  const base = { passes_variant: 3, passes_reference: 3, recall: 0.35, spread: 2, margin_points: 10, sims: 2000, seed: 1 };
  const loss = (seeded: number, points: number, extra: { alpha?: number; dependence?: number } = {}) => simulate({ ...base, clusters: clusters(seeded), delta_points: -points, ...extra }).loss;

  test("--alpha reproduces the dry run's mirror: 24 seeded plans at 0.05/8 call a 15-point loss 68.9% and a 20-point loss 94.1%", () => {
    expect([loss(24, 15, { alpha: 0.05 / 8 }), loss(24, 20, { alpha: 0.05 / 8 }), loss(24, 15, { alpha: 0.05 / 4 }), loss(24, 20, { alpha: 0.05 / 4 })]).toEqual([0.689, 0.941, 0.7845, 0.9705]);
    expect([loss(16, 20, { alpha: 0.05 / 8 }), loss(20, 20, { alpha: 0.05 / 8 }), loss(32, 20, { alpha: 0.05 / 8 })]).toEqual([0.748, 0.8625, 0.986]);
    expect([loss(24, 15), loss(24, 20)]).toEqual([0.9305, 0.996]);
    expect(loss(24, 15, { alpha: 0.05 })).toBe(loss(24, 15));
  });

  test("--dependence 0 is the independent model, and power falls as the flaws of one plan move together", () => {
    const at = (dependence: number) => loss(24, 20, { alpha: 0.05 / 8, dependence });
    expect(at(0)).toBe(loss(24, 20, { alpha: 0.05 / 8 }));
    expect([at(0.6), at(1)]).toEqual([0.8985, 0.8185]);
    expect(at(1)).toBeLessThan(at(0.6));
    expect(at(0.6)).toBeLessThan(at(0));
    expect(() => loss(24, 20, { dependence: 1.5 })).toThrow(/--dependence is a share from 0 to 1/);
    expect(() => loss(24, 20, { alpha: 0 })).toThrow(/--alpha is a share strictly between 0 and 1/);
  });

  test("the command takes --alpha and --dependence", async () => {
    const r = await run(["power", "--clusters", "2,2,2,1", "--passes", "3", "--recall", "0.35", "--margin", "10", "--loss", "20", "--sims", "50", "--alpha", "0.00625", "--dependence", "0.5", "--json"]);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out).inputs).toMatchObject({ alpha: 0.00625, dependence: 0.5 });
    expect((await run(["power", "--clusters", "2,2", "--passes", "3", "--recall", "0.35", "--margin", "10", "--alpha", "1"])).err).toContain("--alpha");
  });
});

const ARMS: Record<string, PlanArm> = {
  none: { id: "none", passes: 3, outcome: (_u, b) => (b.id === "B1" && b.counts === "blocking" ? "F" : "M") },
  flagall: { id: "flagall", passes: 3, outcome: () => "F", noise: 3 },
  honest: { id: "honest", passes: 3, outcome: (_u, b) => (b.counts === "blocking" ? "F" : "M") },
};
const arms = (id: string): PlanArm => ARMS[id]!;

describe("plan judge packets (B6, open item 11)", () => {
  const dir = tmp("noloss-plan-judge-");
  const heading = (u: { pr: number }, b: { id: string } | null) => ({ section: b ? "Premise Challenge" : "Scope", claim: "CRITICAL: the Nuclear Scope Challenge finds unit " + u.pr + " solves the wrong problem.", evidence: "context/goals.md says readers want offline reading (HIGH).", fix: "Rewrite the Problem section; see the GSTACK REVIEW REPORT." });
  const raw = (id: string) => writePlanArm(join(dir, "src", id), panel.suite, { ...arms(id), raw: true, text: heading });

  test("packets show section, claim, evidence and fix only, strip gstack's heading words, and carry the plan as it was", async () => {
    for (const id of ["none", "flagall"]) expect((await run(["ingest", raw(id), "--suite", panel.stubPath, "--root", join(dir, "arms"), ...S])).code).toBe(0);
    const armDirs = ["none", "flagall"].flatMap((id) => ["--arm", join(dir, "arms", "planpanel-test", id)]);
    const packet = (out: string, extra: string[] = []) => run(["judge-packet", "--suite", panel.stubPath, ...armDirs, "--seed", "7", "--out", join(dir, out), "--key", join(dir, out + ".key.json"), ...S, ...extra]);
    const missing = await packet("p0");
    expect([missing.code, missing.err]).toEqual([2, expect.stringContaining("is a plan suite, so its packets carry each unit's tree; pass --source example/plan-panel=<clone>")]);
    const r = await packet("p1", ["--source", "example/plan-panel=" + panel.clone]);
    expect([r.code, r.err]).toEqual([0, ""]);
    const files = readdirSync(join(dir, "p1", "packets"));
    expect(files.length).toBe(15);
    const one = json(join(dir, "p1", "packets", files.find((f) => f.startsWith("1."))!));
    for (const f of one.findings) expect(Object.keys(f).sort()).toEqual(["claim", "evidence", "fix", "id", "line", "section"]);
    expect(one.blockers).toEqual([{ id: "B1", section: "Problem", line: 3, cause: expect.stringContaining("losing links") }, { id: "B2", section: "Scope", line: 9, cause: expect.stringContaining("three apps") }]);
    const text = files.map((f) => readFileSync(join(dir, "p1", "packets", f), "utf8")).join("\n");
    for (const leak of ["Premise Challenge", "Nuclear Scope Challenge", "GSTACK REVIEW REPORT", "CRITICAL", "HIGH", "flagall", "High"]) expect(text).not.toContain(leak);
    expect(one.findings[0].claim).toMatch(/^\[severity\]: the finds unit 1 solves the wrong problem\.$/);
    expect(text).not.toContain("[heading]");
    expect(one.material.plan_sha256).toBe(json(join(catalog, "planpanel-1-1.json")).plan.digest);
    expect(one.material.files.map((f: { path: string }) => f.path)).toEqual(["context/goals.md", "plan.md"]);
    expect(one.material.files[1].text).toBe(planText(1));
    const batch = json(join(dir, "p1", "batch.json"));
    expect([batch.judging_rule, batch.heading_words_sha256]).toEqual([PLAN_JUDGING_RULE, PLAN_HEADING_WORDS_SHA256]);
  });

  test("a clone whose plan.md differs from the case's digest is refused", async () => {
    const moved = join(tmp("noloss-plan-clone-"), "clone");
    cpSync(panel.clone, moved, { recursive: true });
    const sealed = join(tmp("noloss-plan-sealed-"), "sealed");
    cpSync(panel.sealedRoot, sealed, { recursive: true });
    const c = json(join(sealed, "catalog", "plans", "planpanel-1-1.json"));
    writeFileSync(join(sealed, "catalog", "plans", "planpanel-1-1.json"), JSON.stringify({ ...c, plan: { ...c.plan, digest: "0".repeat(64) } }, null, 2) + "\n");
    const r = await run(["judge-packet", "--suite", join(sealed, "suites", "planpanel-test.json"), "--arm", join(dir, "arms", "planpanel-test", "none"), "--seed", "7", "--out", join(dir, "p2"), "--key", join(dir, "p2.key.json"), "--source", "example/plan-panel=" + moved, "--sealed-root", sealed]);
    expect([r.code, r.err]).toEqual([2, expect.stringMatching(/^E_NOLOSS_BLIND .*plan\.md at head [0-9a-f]{12} hashes to [0-9a-f]{64}, not case planpanel-1-1's plan digest 0{64}/)]);
  });

  test("the heading word list is frozen by its digest", () => {
    expect(PLAN_HEADING_WORDS.length).toBe(63);
    expect(PLAN_HEADING_WORDS_SHA256).toBe("ecb56e71518091b9e7b41bc5c3507ca3c29de228304e48c8f51398d50d03f853");
  });

  test("a plan finding with no section is refused from packets", async () => {
    const d = tmp("noloss-plan-nosection-");
    const src = writePlanArm(join(d, "src"), panel.suite, { id: "nosection", passes: 1, raw: true, outcome: () => "F", text: () => ({ section: "", claim: "A finding.", evidence: "context/goals.md", fix: "Fix it." }) });
    expect((await run(["ingest", src, "--suite", panel.stubPath, "--root", join(d, "arms"), ...S])).code).toBe(0);
    const r = await run(["judge-packet", "--suite", panel.stubPath, "--arm", join(d, "arms", "planpanel-test", "nosection"), "--seed", "7", "--out", join(d, "p"), "--key", join(d, "k.json"), "--source", "example/plan-panel=" + panel.clone, ...S]);
    expect([r.code, r.err]).toEqual([2, expect.stringContaining("it has no section, and a plan finding names the plan.md heading it is about")]);
  });

  test("sealedLeaks names 7-character commits and the unit repo, and a stub refuses a title that names one", () => {
    const u = panel.suite.units[0]!;
    expect(sealedLeaks(panel.suite, "see " + u.head.slice(0, 7) + " in " + u.repo)).toEqual([u.head.slice(0, 7), u.repo].sort());
    expect(() => suiteStub({ ...panel.suite, title: "rerun of " + u.base.slice(0, 7) }, readFileSync(panel.suitePath, "utf8"), panel.sealedRoot, CUSTODY)).toThrow("the stub would publish what the seal hides in the suite's title, purpose or custody: " + u.base.slice(0, 7));
  });

  test("planMaterial refuses a head the clone lacks, a head with no plan.md, a tree over the cap and an object it cannot read", () => {
    const u = panel.suite.units[0]!;
    expect(() => planMaterial(panel.clone, "0".repeat(40))).toThrow("does not hold head " + "0".repeat(40));
    expect(() => planMaterial(panel.clone, u.base)).toThrow("head " + u.base + " in " + panel.clone + " has no plan.md");
    const big = join(tmp("noloss-plan-big-"), "clone");
    cpSync(panel.clone, big, { recursive: true });
    const git = (...a: string[]) => spawnSync("git", ["-C", big, ...a], { encoding: "utf8" }).stdout.trim();
    git("checkout", "-q", "-b", "big", u.head);
    writeFileSync(join(big, "context", "big.md"), "x".repeat(PLAN_MATERIAL_CAP));
    git("add", "-A");
    git("commit", "-q", "-m", "big");
    expect(() => planMaterial(big, git("rev-parse", "HEAD"))).toThrow("over the plan packet's " + PLAN_MATERIAL_CAP);
    const blob = git("rev-parse", "HEAD:context/goals.md");
    rmSync(join(big, ".git", "objects", blob.slice(0, 2), blob.slice(2)));
    expect(() => planMaterial(big, u.head)).toThrow("cannot read context/goals.md at head " + u.head);
  });

});

describe("the decoy-only false-alarm gate and the volume-matched reading (open item 7)", () => {
  const dir = tmp("noloss-plan-gate-");
  const root = join(dir, "arms");
  const prereg = join(dir, "comparisons.json");
  const cmp = (variant: string, reference: string) => ({ id: variant + "-vs-" + reference, variant, reference, margin_points: 10, margin_reason: "test", post_hoc: false, frozen_bar: null, false_alarm_gate: { margin_per_decoy: 1 } });
  const score = (variant: string, reference: string, extra: string[] = [], suite = panel.stubPath, armsRoot = root, file = prereg) => run(["score", "--suite", suite, "--root", armsRoot, "--prereg", file, "--variant", variant, "--reference", reference, ...S, ...extra]);

  test("setup: none, a flag-everything arm and an honest arm ingest on the sealed suite", async () => {
    writeFileSync(prereg, JSON.stringify({ schema_version: 1, suite: "planpanel-test", decision_rule: "test rule", seed: 1, draws: 1000, comparisons: [cmp("none", "flagall"), cmp("none", "honest")], loss_family: { order: ["none-vs-flagall", "none-vs-honest"], null: "zero", reason: "test" } }));
    for (const id of ["none", "flagall", "honest"]) expect((await run(["ingest", writePlanArm(join(dir, "src", id), panel.suite, arms(id)), "--suite", panel.stubPath, "--root", root, ...S])).code).toBe(0);
  });

  test("a synthetic flag-everything arm wins on recall and fails the gate, so its claim may not be made", async () => {
    const r = await score("none", "flagall", ["--expect", "FALSE_ALARM_GATE_FAIL"]);
    expect(r.code).toBe(0);
    const text = await score("none", "flagall");
    expect(text.code).toBe(1);
    expect(text.out).toContain("sealed suite planpanel-test, read through its stub");
    expect(text.out).toContain("false-alarm gate (decoys only, margin 1 per decoy): must-fix false alarms per decoy per pass flagall 4.00, none 0.00 on 4 decoys; flagall's excess +4.00 [95% CI +4.00, +4.00]: FAIL.");
    expect(text.out).toContain('claim "flagall catches more of these blockers than none": may not be made: false-alarm gate FAIL.');
    expect(text.out.split("\n").at(-1)).toBe("verdict: LOSS FALSE_ALARM_GATE_FAIL");
    expect(text.err).toBe("FALSE_ALARM_GATE_FAIL none-vs-flagall: LOSS, but the false-alarm gate is FAIL, so the claim that flagall catches more of these blockers may not be made.");
    expect((await score("none", "flagall", ["--expect", "LOSS"])).code).not.toBe(0);
  });

  test("an arm that catches every flaw with no false alarm passes the gate, and its claim may be made", async () => {
    const r = await score("none", "honest", ["--json"]);
    const rec = JSON.parse(r.out);
    expect([r.code, rec.result.verdict, rec.warnings, rec.false_alarm_gate.result, rec.false_alarm_gate.excess, rec.loss_claim.eligible]).toEqual([1, "LOSS", [], "PASS", 0, true]);
    expect((await score("none", "honest", ["--expect", "LOSS"])).code).toBe(0);
  });

  test("decoy findings with no adjudication leave the gate unread, which also blocks the claim", async () => {
    const src = writePlanArm(join(dir, "src", "noisy"), panel.suite, { ...arms("flagall"), id: "noisy" });
    rmSync(join(src, "adjudication.tsv"));
    expect((await run(["ingest", src, "--suite", panel.stubPath, "--root", root, ...S])).code).toBe(0);
    const rec = JSON.parse((await run(["score", "--suite", panel.stubPath, "--root", root, "--variant", "none", "--reference", "noisy", "--margin", "10", "--margin-reason", "t", "--false-alarm-gate", "1", "--json", ...S])).out);
    expect([rec.false_alarm_gate.result, rec.false_alarm_gate.reasons, rec.warnings]).toEqual([null, ["arm noisy has 36 must-fix findings on decoys with no adjudication row"], ["FALSE_ALARM_GATE_FAIL"]]);
  });

  test("labelled and blind adjudication are never pooled, so the gate stays unread and the claim may not be made", async () => {
    const src = writePlanArm(join(dir, "src", "mixed"), panel.suite, { ...arms("honest"), id: "mixed", noise: 1 });
    const adj = join(src, "adjudication.tsv");
    writeFileSync(adj, readFileSync(adj, "utf8").replace(/^(\d+\tp1-n1\t1\tnot-defect\tsynthetic\t)no\t/gm, "$1yes\t"));
    expect((await run(["ingest", src, "--suite", panel.stubPath, "--root", root, ...S])).code).toBe(0);
    const file = join(dir, "mixed.json");
    writeFileSync(file, JSON.stringify({ ...json(prereg), comparisons: [cmp("none", "mixed")], loss_family: { order: ["none-vs-mixed"], null: "zero", reason: "test" } }));
    const rec = JSON.parse((await score("none", "mixed", ["--json"], panel.stubPath, root, file)).out);
    expect([rec.result.verdict, rec.false_alarm_gate.per_decoy, rec.false_alarm_gate.result, rec.false_alarm_gate.reasons, rec.loss_claim.eligible]).toEqual(["LOSS", { variant: 0, reference: 1 }, null, ["labelled and blind adjudication are never pooled"], false]);
  });

  test("decoy rulings that are all labelled leave the gate unread beside blind judgments, so the claim may not be made", async () => {
    const src = writePlanArm(join(dir, "src", "seen"), panel.suite, { ...arms("honest"), id: "seen", noise: 1 });
    const adj = join(src, "adjudication.tsv");
    writeFileSync(adj, readFileSync(adj, "utf8").replace(/^(\d+\tp\d+-n1\t\d+\tnot-defect\tsynthetic\t)no\t/gm, "$1yes\t"));
    expect((await run(["ingest", src, "--suite", panel.stubPath, "--root", root, ...S])).code).toBe(0);
    const file = join(dir, "seen.json");
    writeFileSync(file, JSON.stringify({ ...json(prereg), comparisons: [cmp("none", "seen")], loss_family: { order: ["none-vs-seen"], null: "zero", reason: "test" } }));
    const rec = JSON.parse((await score("none", "seen", ["--json"], panel.stubPath, root, file)).out);
    expect([rec.result.verdict, rec.judging.labelled, rec.false_alarm_gate.result, rec.false_alarm_gate.reasons, rec.loss_claim.eligible]).toEqual(["LOSS", false, null, ["the decoy rulings are labelled adjudication, and the gate reads blind adjudication only"], false]);
  });

  test("a comparisons file's gate must be a non-negative margin per decoy", async () => {
    const bad = join(dir, "bad.json");
    writeFileSync(bad, JSON.stringify({ ...json(prereg), comparisons: [{ ...cmp("none", "flagall"), false_alarm_gate: { margin: 1 } }], loss_family: { order: ["none-vs-flagall"], null: "zero", reason: "test" } }));
    const r = await score("none", "flagall", [], panel.stubPath, root, bad);
    expect([r.code, r.err]).toEqual([2, expect.stringContaining("false_alarm_gate is { margin_per_decoy: <a non-negative number of must-fix false alarms per decoy> }")]);
  });

  test("derive --first-k keeps each unit-pass's first k must-fix findings: the flag-everything arm's edge and its noise go", async () => {
    const out = join(dir, "k1");
    const d = await run(["derive", "--suite", panel.stubPath, "--comparisons", prereg, "--root", root, "--id", "planpanel-k1", "--out", out, "--first-k", "1", ...S]);
    expect([d.code, d.out]).toEqual([0, expect.stringContaining("keep each unit-pass's first 1 must-fix findings as must-fix and relabel the rest VOLUME-CUT (volume-matched)")]);
    const r = await score("none", "flagall", ["--json"], join(out, "planpanel-k1.json"), join(out, "arms"), join(out, "comparisons.planpanel-k1.json"));
    const rec = JSON.parse(r.out);
    expect([rec.result.verdict === "LOSS", rec.false_alarm_gate.per_decoy, rec.false_alarm_gate.result]).toEqual([false, { variant: 0, reference: 1 }, "PASS"]);
    const inRepo = join(REPO_ROOT, ".plan-derive-test-" + process.pid);
    const refused = await run(["derive", "--suite", panel.stubPath, "--comparisons", prereg, "--root", root, "--id", "planpanel-inrepo", "--out", inRepo, "--first-k", "1", ...S]);
    expect([refused.code, refused.err, existsSync(inRepo)]).toEqual([2, expect.stringContaining("is inside the repo, and suite planpanel-inrepo derives from sealed suite planpanel-test, so it is sealed too"), false]);
    const both = await run(["derive", "--suite", panel.stubPath, "--comparisons", prereg, "--root", root, "--id", "planpanel-k2", "--out", join(dir, "k2"), "--first-k", "1", "--severity-map", prereg, ...S]);
    expect([both.code, both.err]).toEqual([2, expect.stringContaining("give one of --severity-map, --impact and --first-k")]);
  });
});

describe("a sealed suite's export table (open item 1)", () => {
  test("export writes a sealed table into the repo only with --publish-sealed-table, and only when it names nothing the seal hides", async () => {
    const dir = tmp("noloss-plan-export-");
    const id = "planpanel-export-" + process.pid;
    const p = planPanel(dir, { seeded: 3, decoy: 1 }, { id });
    const stub = join(SUITES_DIR, id + ".json");
    const table = join(REPO_ROOT, "tables", "." + id + ".json");
    inRepo.push(stub, table);
    cpSync(p.stubPath, stub);
    const root = join(dir, "arms");
    for (const a of ["none", "honest"]) expect((await run(["ingest", writePlanArm(join(dir, "src", a), p.suite, arms(a)), "--suite", id, "--root", root, "--sealed-root", p.sealedRoot])).code).toBe(0);
    const cmpPath = join(dir, "comparisons.json");
    writeFileSync(cmpPath, JSON.stringify({ schema_version: 1, suite: id, decision_rule: "test rule", seed: 1, draws: 1000, comparisons: [{ id: "none-vs-honest", variant: "none", reference: "honest", margin_points: 10, margin_reason: "test", post_hoc: false, frozen_bar: null, false_alarm_gate: { margin_per_decoy: 1 } }], loss_family: { order: ["none-vs-honest"], null: "zero", reason: "test" } }));
    const exp = (extra: string[]) => run(["export", "--comparisons", cmpPath, "--root", root, "--table", table, "--sealed-root", p.sealedRoot, ...extra]);
    const refused = await exp([]);
    expect([refused.code, refused.err]).toEqual([2, expect.stringContaining("pass --publish-sealed-table to publish one that names no sealed unit, cluster, commit or case")]);
    expect(existsSync(table)).toBe(false);
    expect((await exp(["--publish-sealed-table"])).code).toBe(0);
    const text = readFileSync(table, "utf8");
    expect(sealedLeaks(p.suite, text)).toEqual([]);
    expect(JSON.parse(text).suite).toMatchObject({ id, sealed: true });
    const head = p.suite.units[0]!.head.slice(0, 12);
    const leaky = writePlanArm(join(dir, "src", "leaky"), p.suite, { ...arms("honest"), id: "leaky" });
    writeFileSync(join(leaky, "arm.json"), JSON.stringify({ ...json(join(leaky, "arm.json")), label: "rerun of " + head }));
    expect((await run(["ingest", leaky, "--suite", id, "--root", root, "--sealed-root", p.sealedRoot])).code).toBe(0);
    writeFileSync(cmpPath, JSON.stringify({ ...json(cmpPath), comparisons: [{ ...json(cmpPath).comparisons[0], id: "none-vs-leaky", reference: "leaky" }], loss_family: { order: ["none-vs-leaky"], null: "zero", reason: "test" } }));
    const leak = await exp(["--publish-sealed-table"]);
    expect([leak.code, leak.err]).toEqual([2, expect.stringContaining("names what the seal hides, so it is not published: " + head.slice(0, 7) + ", " + head)]);
    expect(readFileSync(table, "utf8")).toBe(text);
  });
});
