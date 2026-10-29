import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  census,
  gitIn,
  noncePurpose,
  parseManifest,
  passingTests,
  publishable,
  routeDispatch,
  runCases,
  trainBase,
  trainPolicy,
  trainRecord,
  type CasePanel,
  type GateCase,
  type RouteInput,
} from "../../scripts/gate.ts";

// scripts/gate.ts (U19): the train-gate route, the case runner and its record, and the publish check, on scratch repositories
// whose train branches have the shape gstack's train build pushes.
const GATE = join(import.meta.dir, "..", "..", "scripts", "gate.ts");
const sh = (cwd: string, script: string) => {
  const r = spawnSync("bash", ["-eo", "pipefail", "-c", script], { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" } });
  if (r.status !== 0) throw new Error(script + "\n" + r.stderr);
  return r.stdout.trim();
};
const POLICY = JSON.stringify({ train: { record_artifact: "gstack-evals-train-record", full_gate_check: "gstack-evals/full-gate" } });
const TRAIN = "gate.train-0123456789ab-0123456789ab-x1y2z3";
const BISECT = "gate.bisect-0123456789ab-0123456789ab-x1y2z3";

/** main, an optional scratch base carrying the train policy, two PR branches and a two-slot train on train/<nonce>. */
function scratchTrain(scratchBase: boolean) {
  const dir = mkdtempSync(join(tmpdir(), "gate-train-"));
  sh(dir, "git init -q -b main . && echo a > a.txt && git add a.txt && git commit -qm init");
  if (scratchBase) sh(dir, "git checkout -qb scratch");
  mkdirSync(join(dir, ".gstack"));
  writeFileSync(join(dir, ".gstack", "ship-policy.json"), POLICY);
  sh(dir, "git add .gstack && git commit -qm policy");
  if (scratchBase) sh(dir, "git checkout -q main && echo m > m.txt && git add m.txt && git commit -qm main-moved && git checkout -q scratch");
  const base = sh(dir, "git rev-parse HEAD");
  const p1 = sh(dir, "git checkout -qb p1 && echo 1 > one.txt && git add one.txt && git commit -qm one && git rev-parse HEAD");
  const p2 = sh(dir, `git checkout -q ${base} -b p2 && mkdir -p gate && echo 2 > gate/two.txt && git add gate && git commit -qm two && git rev-parse HEAD`);
  sh(dir, `git checkout -q ${base} -b train/${TRAIN}`);
  const t1 = sh(dir, `git merge -q --no-ff -m "train T1: merge #11 at ${p1.slice(0, 12)}" p1 && git rev-parse HEAD`);
  const t2 = sh(dir, `git merge -q --no-ff -m "train T2: merge #12 at ${p2.slice(0, 12)}" p2 && git rev-parse HEAD`);
  return { dir, base, p1, p2, t1, t2 };
}

const CASES: GateCase[] = [
  { id: "ok", kind: "command", run: "true" },
  { id: "named", kind: "junit", run: "printf '<testsuites><testcase name=\"a &amp; b\" /></testsuites>' > \"$GATE_JUNIT\"", tests: ["a & b"] },
];
const pass = (id: string, kind = "command"): CasePanel => ({ case: id, kind, status: "PASS", red_class: null, cost_usd: 0 });

describe("trainBase", () => {
  test("finds the base and slot count from the train head, on the default branch or a scratch base", () => {
    for (const scratch of [false, true]) {
      const t = scratchTrain(scratch);
      const git = gitIn(t.dir);
      expect(trainBase(git, t.t2)).toEqual({ base: t.base, slots: 2 });
      expect(trainBase(git, t.t1)).toEqual({ base: t.base, slots: 1 });
      expect(trainBase(git, t.base)).toBeNull();
      expect(sh(t.dir, "git rev-parse main") === t.base).toBe(!scratch);
    }
  });

  test("refuses a chain that skips a slot or never reaches T1", () => {
    const t = scratchTrain(false);
    const skip = sh(t.dir, `git checkout -q ${t.t1} && git merge -q --no-ff -m "train T3: merge #13 at ${t.p2.slice(0, 12)}" ${t.p2} && git rev-parse HEAD`);
    expect(trainBase(gitIn(t.dir), skip)).toEqual({ error: "train T1 follows T3" });
    const noT1 = sh(t.dir, `git checkout -q ${t.base} && git merge -q --no-ff -m "train T2: merge #12 at ${t.p2.slice(0, 12)}" ${t.p2} && git rev-parse HEAD`);
    expect(trainBase(gitIn(t.dir), noT1)).toEqual({ error: noT1.slice(0, 12) + " has no T1 within 7 first parents" });
  });

  test("reads the train policy at a commit", () => {
    const t = scratchTrain(true);
    expect(trainPolicy(gitIn(t.dir), t.base)).toEqual({ record_artifact: "gstack-evals-train-record", full_gate_check: "gstack-evals/full-gate" });
    expect(trainPolicy(gitIn(t.dir), "main")).toBeNull();
  });
});

describe("routeDispatch", () => {
  const t = scratchTrain(true);
  const git = gitIn(t.dir);
  const deps = {
    isAncestor: (c: string, h: string) => spawnSync("git", ["merge-base", "--is-ancestor", c, h], { cwd: t.dir }).status === 0,
    caseIds: new Set(["typecheck", "unit"]),
    train: trainBase(git, t.t2) as { base: string; slots: number },
    policy: trainPolicy(git, t.base),
  };
  const input = (o: Partial<RouteInput>): RouteInput => ({ refName: "train/" + TRAIN, head: t.t2, expectedSha: t.t2, nonce: TRAIN, evalsAll: true, cases: "", prefixShas: "", ...o });
  const refused = (o: Partial<RouteInput>, d = deps) => (routeDispatch(input(o), d) as { error?: string }).error ?? "";

  test("routes a train gate and a bisect on train/<nonce>", () => {
    expect(noncePurpose(TRAIN)).toBe("train");
    expect(noncePurpose(BISECT)).toBe("bisect");
    expect(routeDispatch(input({}), deps)).toEqual({ mode: "train", cases: [], prefixes: [] });
    expect(routeDispatch(input({ nonce: BISECT, evalsAll: false, cases: "unit", prefixShas: t.t1 + "," + t.t2 }), deps)).toEqual({ mode: "bisect", cases: ["unit"], prefixes: [t.t1, t.t2] });
    expect(routeDispatch(input({ refName: "main", nonce: "", expectedSha: "", evalsAll: false }), deps)).toEqual({ mode: "dispatch", cases: [], prefixes: [] });
  });

  test("refuses a train gate that is off its branch, not the full gate, not the expected head, not a train or has no policy", () => {
    expect(refused({ refName: "main" })).toContain("runs on train/<nonce>, not main");
    expect(refused({ evalsAll: false })).toContain("evals_all=true");
    expect(refused({ expectedSha: t.t1 })).toContain("is not the train head");
    expect(refused({ expectedSha: "" })).toContain("(empty)");
    expect(refused({}, { ...deps, train: null as never })).toContain("is not a train head");
    expect(refused({}, { ...deps, policy: null })).toContain("needs a train block");
  });

  test("refuses a bisect without its nonce, with unknown cases, or with prefixes off the train", () => {
    expect(refused({ cases: "unit", prefixShas: t.t1 })).toContain("needs a bisect nonce");
    const b = { nonce: BISECT, evalsAll: false };
    expect(refused({ ...b, cases: "nope", prefixShas: t.t1 })).toContain("not in the base's m0 gate: nope");
    expect(refused({ ...b, cases: "unit,unit", prefixShas: t.t1 })).toContain("distinct case ids");
    expect(refused({ ...b, cases: "unit", prefixShas: "abc" })).toContain("is not a full commit SHA");
    expect(refused({ ...b, cases: "unit", prefixShas: sh(t.dir, "git rev-parse main") })).toContain("is not an ancestor of the train head");
    expect(refused({ ...b, cases: "unit", prefixShas: "" })).toContain("prefix_shas must name");
  });

  test("refuses a nonce that is not a train or bisect nonce, and a plain dispatch on another head", () => {
    expect(refused({ nonce: "gate.screen.narrow-0123456789ab-0123456789ab-x" })).toContain("is not a train or bisect nonce");
    expect(refused({ nonce: "", refName: "main", evalsAll: false, expectedSha: t.t1 })).toContain("is not the checked-out head");
  });
});

describe("the case runner and its record", () => {
  test("judges commands by exit code and junit cases by their named tests", () => {
    const dir = mkdtempSync(join(tmpdir(), "gate-run-"));
    const log: string[] = [];
    const run = (cases: GateCase[], timeoutMs?: number) => runCases(cases, { root: dir, env: {}, log: (l) => log.push(l), timeoutMs });
    expect(run(CASES)).toEqual([pass("ok"), pass("named", "junit")]);
    const red = run([
      { id: "bad", kind: "command", run: "exit 3" },
      { id: "absent", kind: "junit", run: "printf '<testsuites/>' > \"$GATE_JUNIT\"", tests: ["a"] },
      { id: "skipped", kind: "junit", run: "printf '<testcase name=\"a\"><skipped /></testcase>' > \"$GATE_JUNIT\"", tests: ["a"] },
      { id: "nofile", kind: "junit", run: "true", tests: ["a"] },
    ]);
    expect(red.map((p) => [p.case, p.status, p.red_class])).toEqual([
      ["bad", "FAIL", "VERDICT"],
      ["absent", "FAIL", "VERDICT"],
      ["skipped", "FAIL", "VERDICT"],
      ["nofile", "FAIL", "VERDICT"],
    ]);
    expect(run([{ id: "slow", kind: "command", run: "sleep 5" }], 300)[0]).toMatchObject({ status: "INFRA", red_class: "INFRA" });
    expect(log.some((l) => l.startsWith("GATE: absent FAIL (absent, skipped or failing: a)"))).toBe(true);
  });

  test("reads passing tests from a JUnit report", () => {
    const xml = '<testcase name="x &apos;y&apos;" /><testcase name="f"><failure /></testcase><testcase name="s"><skipped /></testcase><testcase name="e"><error /></testcase>';
    expect([...passingTests(xml)]).toEqual(["x 'y'"]);
  });

  test("is GREEN only when every planned case ran and passed, in order", () => {
    const green = trainRecord({ nonce: TRAIN, head: "h", tree: "t", base: "b", planned: CASES, panels: [pass("ok"), pass("named", "junit")] });
    expect(green).toMatchObject({ schema: 1, kind: "train-gate", verdict: "GREEN", census: { complete: true, planned: { rule: 2, judge: 0 }, executed: { rule: 2, judge: 0 } } });
    const red = trainRecord({ nonce: TRAIN, head: "h", tree: "t", base: "b", planned: CASES, panels: [pass("ok"), { ...pass("named", "junit"), status: "FAIL", red_class: "VERDICT" }] });
    expect(red).toMatchObject({ verdict: "RED", census: { complete: false, executed: { rule: 2, judge: 0 } } });
    expect(census(CASES, [pass("ok")]).complete).toBe(false);
    expect(census(CASES, [pass("named", "junit"), pass("ok")]).complete).toBe(false);
    expect(census([], []).complete).toBe(false);
  });
});

describe("publishable", () => {
  const expectFor = (o: Partial<Parameters<typeof publishable>[1]> = {}) => ({ nonce: TRAIN, head: "h", tree: "t", planned: CASES, slots: 1, touched: ["src/x.ts"], surface: [".github/workflows/**", "gate/**", "scripts/gate.ts"], ...o });
  const green = trainRecord({ nonce: TRAIN, head: "h", tree: "t", base: "b", planned: CASES, panels: [pass("ok"), pass("named", "junit")] });

  test("passes a complete green census bound to this run", () => {
    expect(publishable(green, expectFor())).toMatchObject({ ok: true });
    expect(publishable(green, expectFor({ touched: ["gate/manifest.json"] }))).toMatchObject({ ok: true });
  });

  test("refuses a record for another run, a red or partial census, or a census of a shorter gate", () => {
    expect(publishable(null, expectFor())).toEqual({ error: "no train-gate record" });
    expect((publishable(green, expectFor({ nonce: "other" })) as { error: string }).error).toContain("not this run's");
    expect((publishable(green, expectFor({ tree: "u" })) as { error: string }).error).toContain("not this run's");
    const red = trainRecord({ nonce: TRAIN, head: "h", tree: "t", base: "b", planned: CASES, panels: [pass("ok"), { ...pass("named", "junit"), status: "FAIL", red_class: "VERDICT" }] });
    expect((publishable(red, expectFor()) as { error: string }).error).toContain("named FAIL");
    const short = trainRecord({ nonce: TRAIN, head: "h", tree: "t", base: "b", planned: [CASES[0]!], panels: [pass("ok")] });
    expect((publishable(short, expectFor()) as { error: string }).error).toContain("not a complete green census");
  });

  test("refuses a train of two or more pull requests that touches the gate surface", () => {
    expect((publishable(green, expectFor({ slots: 2, touched: ["src/x.ts", "gate/manifest.json"] })) as { error: string }).error).toContain("a 2-PR train touches the gate surface (gate/manifest.json)");
    expect((publishable(green, expectFor({ slots: 2, touched: [".github/workflows/ci.yml"] })) as { error: string }).error).toContain("gate surface");
    expect(publishable(green, expectFor({ slots: 2 }))).toMatchObject({ ok: true });
  });
});

describe("the gate.ts command line", () => {
  const bun = (cwd: string, args: string[], env: Record<string, string> = {}) => spawnSync(process.execPath, ["--no-env-file", "--config=/dev/null", GATE, ...args], { cwd, encoding: "utf8", env: { ...process.env, ...env } });

  test("route prints the train's mode, base and policy, and refuses a base the workflow got wrong", () => {
    const t = scratchTrain(true);
    sh(t.dir, "git checkout -q " + t.t2);
    const env = { GITHUB_REF_NAME: "train/" + TRAIN, NONCE: TRAIN, EXPECTED_SHA: t.t2, EVALS_ALL: "true", CASES: "", PREFIX_SHAS: "" };
    const out = join(t.dir, "..", "out-" + Date.now());
    const ok = bun(t.dir, ["route", "--repo", t.dir, "--base", t.base, "--github-output", out], env);
    expect(ok.status).toBe(0);
    expect(readFileSync(out, "utf8")).toBe(["mode=train", "base=" + t.base, "slots=2", "cases=", "prefixes=[]", "record_artifact=gstack-evals-train-record", "full_gate_check=gstack-evals/full-gate", ""].join("\n"));
    const wrong = bun(t.dir, ["route", "--repo", t.dir, "--base", t.p1], env);
    expect(wrong.status).toBe(1);
    expect(wrong.stderr).toContain("gate: route refused: the workflow's base");
  });

  test("run writes a record and exits 0 only on GREEN; bisect writes a prefix record", () => {
    const t = scratchTrain(false);
    sh(t.dir, "git checkout -q " + t.t2);
    const manifest = (cases: GateCase[]) => {
      const f = join(t.dir, "..", "m-" + Math.random().toString(36).slice(2) + ".json");
      writeFileSync(f, JSON.stringify({ schema: 1, stages: { m0: cases }, gate_surface: ["gate/**"] }));
      return f;
    };
    const rec = join(t.dir, "..", "rec-" + Date.now() + ".json");
    const green = bun(t.dir, ["run", "--manifest", manifest([...CASES, { id: "env", kind: "command", run: 'test "$GATE_BASE" = ' + t.base + ' && test "$GATE_HEAD" = ' + t.t2 }]), "--nonce", TRAIN, "--out", rec]);
    expect(green.status).toBe(0);
    expect(JSON.parse(readFileSync(rec, "utf8"))).toMatchObject({ verdict: "GREEN", nonce: TRAIN, head_sha: t.t2, tree: sh(t.dir, "git rev-parse HEAD^{tree}"), base_sha: t.base });
    const red = bun(t.dir, ["run", "--manifest", manifest([{ id: "bad", kind: "command", run: "false" }]), "--out", rec]);
    expect(red.status).toBe(1);
    expect(JSON.parse(readFileSync(rec, "utf8"))).toMatchObject({ verdict: "RED", panels: [{ case: "bad", status: "FAIL", red_class: "VERDICT" }] });
    const bis = bun(t.dir, ["bisect", "--manifest", manifest(CASES), "--cases", "ok", "--nonce", BISECT, "--out", rec]);
    expect(bis.status).toBe(0);
    expect(JSON.parse(readFileSync(rec, "utf8"))).toEqual({ schema: 1, kind: "train-bisect-prefix", nonce: BISECT, prefix_sha: t.t2, checked_out_sha: t.t2, panels: [pass("ok")] });
    expect(bun(t.dir, ["bisect", "--manifest", manifest(CASES), "--cases", "nope", "--nonce", BISECT, "--out", rec]).status).toBe(1);
  });

  test("publish passes a green record and refuses a 2-PR train that touches the gate surface", () => {
    const t = scratchTrain(false);
    sh(t.dir, "git checkout -q " + t.base);
    const tree = sh(t.dir, "git rev-parse " + t.t1 + "^{tree}");
    const rec = join(t.dir, "..", "pub-" + Date.now() + ".json");
    const m = join(t.dir, "..", "pm-" + Date.now() + ".json");
    writeFileSync(m, JSON.stringify({ schema: 1, stages: { m0: CASES }, gate_surface: ["gate/**"] }));
    writeFileSync(rec, JSON.stringify(trainRecord({ nonce: TRAIN, head: t.t1, tree, base: t.base, planned: CASES, panels: [pass("ok"), pass("named", "junit")] })));
    const ok = bun(t.dir, ["publish", "--manifest", m, "--repo", t.dir, "--record", rec, "--nonce", TRAIN, "--head", t.t1]);
    expect(ok.stdout).toContain("PUBLISH: green rule 2/2");
    expect(ok.status).toBe(0);
    const tree2 = sh(t.dir, "git rev-parse " + t.t2 + "^{tree}");
    writeFileSync(rec, JSON.stringify(trainRecord({ nonce: TRAIN, head: t.t2, tree: tree2, base: t.base, planned: CASES, panels: [pass("ok"), pass("named", "junit")] })));
    const surface = bun(t.dir, ["publish", "--manifest", m, "--repo", t.dir, "--record", rec, "--nonce", TRAIN, "--head", t.t2]);
    expect(surface.status).toBe(1);
    expect(surface.stderr).toContain("a 2-PR train touches the gate surface (gate/two.txt)");
  });
});

describe("gate/manifest.json", () => {
  test("is valid and runs the m0 stage the plan names, with the hygiene test as a named junit case", () => {
    const m = parseManifest(readFileSync(join(import.meta.dir, "..", "..", "gate", "manifest.json"), "utf8"));
    if ("error" in m) throw new Error(m.error);
    expect(m.stages.m0!.map((c) => c.id)).toEqual(["typecheck", "unit", "wiki", "errors-doc", "sealed", "hygiene"]);
    expect(m.gate_surface).toEqual([".github/workflows/**", "gate/**", "scripts/gate.ts", "tests/ci/**", ".gstack/**", "package.json"]);
  });

  test("refuses malformed manifests", () => {
    const bad = (m: unknown) => (parseManifest(JSON.stringify(m)) as { error?: string }).error ?? "";
    const ok = { schema: 1, stages: { m0: CASES }, gate_surface: ["gate/**"] };
    expect(bad({ ...ok, schema: 2 })).toContain("schema 1");
    expect(bad({ ...ok, stages: {} })).toContain("no m0 stage");
    expect(bad({ ...ok, gate_surface: [] })).toContain("gate_surface");
    expect(bad({ ...ok, stages: { m0: [CASES[0], CASES[0]] } })).toContain("listed twice");
    expect(bad({ ...ok, stages: { m0: [{ id: "Bad Id", kind: "command", run: "true" }] } })).toContain("lowercase");
    expect(bad({ ...ok, stages: { m0: [{ id: "j", kind: "junit", run: "true" }] } })).toContain("names the tests");
    expect(bad({ ...ok, stages: { m0: [{ id: "c", kind: "command", run: "true", tests: ["a"] }] } })).toContain("only a junit case");
    expect(parseManifest("{")).toMatchObject({ error: expect.stringContaining("not JSON") });
  });
});
