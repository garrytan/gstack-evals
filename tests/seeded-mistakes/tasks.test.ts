// Keyless tests for the seeded-mistake Lane A tasks (docs/benchmarks/2026-11-seeded-mistakes, GST-348). The tasks file
// passes the contract and preflight's vacuity check, the lock pins it against a stub that holds no stack's text, and on
// every task the oracle passes the reference solutions while failing the fix alone, a snapshot guard and a guard that
// remembers only the old mistakes' exact bytes. Nothing in a graded tree (a bunfig.toml, a tsconfig.json, a symlink,
// code that exits early, a check that rewrites files, a reshaped config, code that looks for its scenario) changes how
// grade.ts grades it, and a tree's own failures fail it rather than reading as a grader fault.
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { REPO_ROOT } from "../../src/cli.ts";
import { readTasks } from "../../src/skill-eval/contract/tasks.ts";
import { checkVacuity } from "../../src/skill-eval/contract/vacuity.ts";
import { readSkillFiles } from "../../src/skill-eval/lock/contract-lines.ts";
import { readLock, treeSha256 } from "../../src/skill-eval/lock/lock.ts";

const SUITE = join(REPO_ROOT, "docs/benchmarks/2026-11-seeded-mistakes");
const TASKS = join(SUITE, "tasks");
const REFS = join(REPO_ROOT, "tests/seeded-mistakes/references");
const GUARDS = join(REPO_ROOT, "tests/seeded-mistakes/guards");
const ENV = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? tmpdir(), LANG: "C.UTF-8" };
const CHECK = 'bun --no-env-file --config="$SKILL_EVAL_FIXTURES/bunfig.toml" --tsconfig-override="$SKILL_EVAL_FIXTURES/tsconfig.json" "$SKILL_EVAL_FIXTURES/grade.ts" ';
const KINDS: Record<string, string> = {
  "admin-route-flag": "test gap",
  "migration-rollback": "test gap",
  "missing-translation": "test gap",
  "timeout-units": "config footgun",
  "env-flag-strings": "config footgun",
  "config-key-typo": "config footgun",
  "secret-file-mode": "unsafe default",
  "html-escape": "unsafe default",
  "open-redirect": "unsafe default",
  "empty-average": "missed edge case",
  "month-end": "missed edge case",
  "limit-off-by-one": "missed edge case",
};
const file = readTasks(join(TASKS, "tasks.json"));
const ids = file.tasks.map((t) => t.id);
const sha256 = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");

function run(cmd: string[], cwd: string, env: Record<string, string> = {}): string {
  const r = Bun.spawnSync(cmd, { cwd, env: { ...ENV, ...env } });
  if (r.exitCode !== 0) throw new Error(cmd.join(" ") + " exited " + r.exitCode + ": " + r.stderr.toString());
  return r.stdout.toString();
}

function seed(root: string, id: string, name: string, steps: string[]): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  run(["sh", join(TASKS, "seed.sh"), id], dir);
  for (const step of steps) run(["sh", join(REFS, id + ".sh"), step], dir);
  return dir;
}

const sources = (dir: string) => run(["git", "ls-files", "-co", "--exclude-standard"], dir).split("\n").filter((f) => f && !f.startsWith("tests/")).sort();

function addSnapshotGuard(dir: string) {
  writeFileSync(join(dir, "tests/snapshot.json"), JSON.stringify(Object.fromEntries(sources(dir).map((f) => [f, sha256(readFileSync(join(dir, f)))]))));
  copyFileSync(join(GUARDS, "snapshot.ts"), join(dir, "tests/snapshot.test.ts"));
}

function addLiteralGuard(root: string, id: string, dir: string) {
  const pristine = seed(root, id, "pristine", []);
  const forbidden: [string, string][] = [];
  for (const scenario of ["revert-a", "revert-c"]) {
    const copy = join(root, "literal-" + scenario);
    cpSync(dir, copy, { recursive: true });
    run(["sh", join(TASKS, id, "mutants.sh"), scenario], copy, { PRISTINE: pristine });
    for (const f of sources(copy)) {
      const sha = sha256(readFileSync(join(copy, f)));
      if (!existsSync(join(dir, f)) || sha256(readFileSync(join(dir, f))) !== sha) forbidden.push([f, sha]);
    }
  }
  writeFileSync(join(dir, "tests/literal.json"), JSON.stringify(forbidden));
  copyFileSync(join(GUARDS, "literal.ts"), join(dir, "tests/literal.test.ts"));
}

type Scenario = { check: boolean | null; oracle: boolean | null; ok: boolean; reason?: string };
type Grade = { code: number; pass: boolean; order: string[]; scenarios: Record<string, Scenario>; refused?: string; reason?: string };

async function check(dir: string, id: string, env: Record<string, string> = {}): Promise<{ code: number; out: string; err: string }> {
  const p = Bun.spawn(["sh", "-c", CHECK + id], { cwd: dir, env: { ...ENV, SKILL_EVAL_FIXTURES: TASKS, ...env }, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { code, out, err };
}

async function grade(dir: string, id: string, env: Record<string, string> = {}): Promise<Grade> {
  const { code, out, err } = await check(dir, id, env);
  if (code !== 0 && code !== 1) throw new Error("grade.ts " + id + " exited " + code + ": " + err);
  return { code, ...JSON.parse(out) };
}

describe("seeded-mistake tasks", () => {
  // Value: protects=the suite's shape: twelve contract tasks, three per mistake kind, each with its seed history, mutants, oracle and reference; fails_when=a task is dropped, renamed, made a safety task or loses a file; why_new=GST-348 (item J of the stacks round 1 plan); seam=tasks.json and the task folders; no_claim=that the tasks have headroom on any model
  test("the tasks file passes the contract, holds three tasks per kind, and every task has its files", () => {
    expect(file.problems).toEqual([]);
    expect([...ids].sort()).toEqual(Object.keys(KINDS).sort());
    for (const kind of new Set(Object.values(KINDS))) expect(Object.values(KINDS).filter((k) => k === kind).length).toBe(3);
    for (const t of file.tasks) {
      expect(t.setup).toBe('sh "$SKILL_EVAL_FIXTURES/seed.sh" ' + t.id);
      expect(t.check).toBe(CHECK + t.id);
      expect(t.safety ?? false).toBe(false);
      for (const f of ["history.sh", "mutants.sh", "oracle.ts"]) expect(existsSync(join(TASKS, t.id, f)), t.id + "/" + f).toBe(true);
      expect(existsSync(join(REFS, t.id + ".sh")), t.id).toBe(true);
    }
  });

  // Value: protects=stack neutrality: no prompt or seeded repo names a stack, a skill, or the mechanism a guard must use; fails_when=a prompt or a seed history mentions gstack, pstack, tstack, superpowers, a skill, or asks for a test, lint rule or type; why_new=GST-348 brief (fair to gstack, pstack and none); seam=the prompts and history.sh files; no_claim=that the wording favors no arm in effect
  test("no prompt or seeded repo names a stack, a skill or a guard mechanism", () => {
    const stack = /\b(g|p|t)stack\b|superpowers|\bskills?\b/i;
    for (const t of file.tasks) {
      expect(stack.test(t.prompt), t.id).toBe(false);
      expect(/\b(tests?|lint|types?|typecheck)\b/i.test(t.prompt), t.id).toBe(false);
      expect(stack.test(readFileSync(join(TASKS, t.id, "history.sh"), "utf8")), t.id).toBe(false);
    }
  });

  // Value: protects=preflight accepts the suite: each task's whole predicate fails on the untouched fixture; fails_when=a seeded mistake stops biting or a check errors instead of failing; why_new=GST-348; seam=checkVacuity, the same function preflight and --lock run; no_claim=that the check is right on agent output, which the reference tests below cover
  test("preflight's vacuity check accepts every task", () => {
    const report = checkVacuity({ tasks: file.tasks, dir: TASKS });
    expect(report.stops).toEqual([]);
    expect(report.results.map((r) => [r.id, r.status])).toEqual(ids.map((id) => [id, "ok"]));
  }, 240_000);

  // Value: protects=the tasks were written first: the lock pins this tasks file and a policy against a stub with no procedure; fails_when=tasks.json changes without a relock, or the lock names a real skill or claims contract lines; why_new=GST-348 (a lock per task, built with skill-eval --lock); seam=tasks.lock.json; no_claim=the round 2 relock, which its preregistration makes
  test("the lock pins the tasks file against the stack-neutral stub", () => {
    const { lock } = readLock(join(TASKS, "tasks.lock.json"));
    expect(lock!.tasks).toEqual({ file: "tasks.json", sha256: file.sha256! });
    expect(lock!.ext).toBeNull();
    expect(lock!.policy?.file).toBe("models.json");
    expect(lock!.policy?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(lock!.skill.name).toBe("stack-neutral");
    expect(lock!.skill.tree_sha256).toBe(treeSha256(readSkillFiles(join(SUITE, "stack-neutral"))));
    expect(lock!.lines).toEqual([]);
  });
});

describe.each(ids)("%s", (id) => {
  // Value: protects=the oracle grades the guard, not the fix: a reference guard passes (a test, a lint rule or a design change), fresh-ok included, while the fix alone, a snapshot of the source and a guard that remembers only the old bytes all fail, each on the scenario built to catch it; fails_when=a scenario stops separating them, a mutant stops applying, or an oracle or fresh-ok's file rejects a correct solution; why_new=GST-348; seam=grade.ts, mutants.sh and oracle.ts; no_claim=how models score
  test("the oracle passes the reference solutions and fails the fix alone, a snapshot guard and a literal guard", async () => {
    const root = mkdtempSync(join(tmpdir(), "seeded-" + id + "-"));
    try {
      const refs = ["guard", ...(/^\s*alt\)/m.test(readFileSync(join(REFS, id + ".sh"), "utf8")) ? ["alt"] : [])];
      const snapshot = seed(root, id, "snapshot", ["fix"]);
      addSnapshotGuard(snapshot);
      const literal = seed(root, id, "literal", ["fix"]);
      addLiteralGuard(root, id, literal);
      const dirs = [seed(root, id, "fix", ["fix"]), snapshot, literal, ...refs.map((r) => seed(root, id, r, ["fix", r]))];
      const [fix, snap, lit, ...good] = await Promise.all(dirs.map((d) => grade(d, id)));
      for (const g of good) expect(g).toMatchObject({ code: 0, pass: true });
      expect(fix!.pass).toBe(false);
      expect([fix!.scenarios.final!.ok, fix!.scenarios.touch!.ok, fix!.scenarios["fresh-ok"]!.ok]).toEqual([true, true, true]);
      expect(fix!.scenarios["revert-c"]).toEqual({ check: true, oracle: false, ok: false });
      expect(fix!.scenarios["revert-a"]).toEqual({ check: false, oracle: false, ok: true });
      expect(snap!.pass).toBe(false);
      expect(snap!.scenarios.final!.ok).toBe(true);
      expect(["touch", "revert-a", "revert-c", "fresh", "fresh-ok"].map((s) => snap!.scenarios[s]!.check)).toEqual([false, false, false, false, false]);
      expect(lit!.pass).toBe(false);
      expect([lit!.scenarios.final!.ok, lit!.scenarios.touch!.ok, lit!.scenarios["fresh-ok"]!.ok, lit!.scenarios["revert-a"]!.check, lit!.scenarios["revert-c"]!.check]).toEqual([true, true, true, false, false]);
      expect(lit!.scenarios.fresh).toEqual({ check: true, oracle: false, ok: false });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 240_000);
});

describe("grade.ts grades the tree, not the tree's config", () => {
  const ID = "empty-average";
  const write = (dir: string, files: Record<string, string>) => {
    for (const [f, body] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, f)), { recursive: true });
      writeFileSync(join(dir, f), body);
    }
  };
  const inRoot = async (fn: (root: string) => Promise<void>) => {
    const root = mkdtempSync(join(tmpdir(), "seeded-grade-"));
    try {
      await fn(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  };

  // Value: protects=a bunfig.toml preload in the graded tree can neither skip grading, nor pass the oracle, nor stop a mutant's bun step; fails_when=the check, the oracle or mutants.sh stops running bun under the suite's own bunfig.toml; why_new=GEVA-64's /ship blocking finding 1 (GST-348); seam=tasks.json's check, grade.ts's oracle step and mutants.sh's bun -e steps; no_claim=that the repo's own bun run check ignores the tree's config, which it must not
  test("a preload that exits 0 neither skips grading, nor passes the oracle, nor skips a mutant", async () => {
    await inRoot(async (root) => {
      const exit = { "exit.ts": "process.exit(0);\n" };
      const both = seed(root, ID, "both", ["fix"]);
      write(both, { ...exit, "bunfig.toml": 'preload = ["./exit.ts"]\n\n[test]\npreload = ["./exit.ts"]\n' });
      const testOnly = seed(root, ID, "test-only", ["fix"]);
      write(testOnly, { ...exit, "bunfig.toml": '[test]\npreload = ["./exit.ts"]\n' });
      const mutant = seed(root, "missing-translation", "mutant", ["fix"]);
      write(mutant, { ...exit, "bunfig.toml": 'preload = ["./exit.ts"]\n' });
      const [a, b, m] = await Promise.all([grade(both, ID), grade(testOnly, ID), grade(mutant, "missing-translation")]);
      for (const g of [a, b]) {
        expect(g).toMatchObject({ code: 1, pass: false });
        expect(g!.scenarios["revert-c"]).toEqual({ check: true, oracle: false, ok: false });
      }
      expect(m).toMatchObject({ code: 1, pass: false });
      expect(m!.scenarios.fresh).toEqual({ check: true, oracle: false, ok: false });
    });
  }, 240_000);

  // Value: protects=a .env file in the graded tree cannot reach the grader: TMPDIR=. there once put grade.ts's copies inside the tree, so a failing tree came out unjudged (exit 2); fails_when=the check drops --no-env-file and the suite's bunfig.toml stops setting env = false; why_new=the Captain's grader audit (GST-374, row 16) on GEVA-67; seam=tasks.json's check; no_claim=that the repo's own bun run check ignores .env, which it must not
  test("a .env file in the tree does not reach the grader", async () => {
    await inRoot(async (root) => {
      const dir = seed(root, ID, "dotenv", ["fix"]);
      write(dir, { ".env": "TMPDIR=.\n" });
      const g = await grade(dir, ID);
      expect(g).toMatchObject({ code: 1, pass: false });
      expect(g.scenarios["revert-c"]).toEqual({ check: true, oracle: false, ok: false });
    });
  }, 240_000);

  // Value: protects=a coverage threshold the repo's own tests meet (fresh-ok's new report included) cannot fail a correct fix through the oracle; fails_when=the oracle reads the tree's [test] config again; why_new=GEVA-64's /ship blocking finding 1 (GST-348); seam=grade.ts's oracle step; no_claim=that the threshold is ignored by the repo's own check
  test("a coverageThreshold in the tree's bunfig.toml does not fail a correct fix", async () => {
    await inRoot(async (root) => {
      const dir = seed(root, ID, "coverage", ["fix", "guard"]);
      writeFileSync(join(dir, "src/reports/latency.ts"), readFileSync(join(dir, "src/reports/latency.ts"), "utf8") + '\nexport function label(): string {\n  return "latency";\n}\n');
      write(dir, {
        "tests/label.test.ts": 'import { expect, test } from "bun:test";\nimport { readdirSync } from "node:fs";\nimport { join } from "node:path";\nimport { label } from "../src/reports/latency.ts";\nimport { summarize } from "../src/reports/order-value.ts";\n\ntest("label and order totals", () => {\n  expect(label()).toBe("latency");\n  expect(summarize([{ total: 10 }, { total: 30 }]).averageOrder).toBe(20);\n});\n\ntest("every report runs over one row", async () => {\n  const dir = join(import.meta.dir, "../src/reports");\n  for (const file of readdirSync(dir)) expect(await (await import(join(dir, file))).summarize([{ total: 10, seconds: 10 }]), file).toBeDefined();\n});\n',
        "bunfig.toml": "[test]\ncoverage = true\ncoverageThreshold = 1\n",
      });
      const g = await grade(dir, ID);
      expect(g).toMatchObject({ code: 0, pass: true });
      expect(g.scenarios.final).toEqual({ check: true, oracle: true, ok: true });
    });
  }, 240_000);

  // Value: protects=a relative symlink inside the tree stays inside each copy, so mutants never write into the graded tree; fails_when=grade.ts copies links as absolute links back into the tree again; why_new=GEVA-64's /ship blocking finding 2 (GST-348); seam=grade.ts's copies; no_claim=anything about hard links, which copy as files
  test("a symlink inside the tree is copied as a link, so no mutant writes into the graded tree", async () => {
    await inRoot(async (root) => {
      const dir = seed(root, ID, "linked", ["fix", "guard"]);
      mkdirSync(join(dir, "lib"));
      renameSync(join(dir, "src/reports/latency.ts"), join(dir, "lib/latency.ts"));
      symlinkSync("../../lib/latency.ts", join(dir, "src/reports/latency.ts"));
      const before = readFileSync(join(dir, "lib/latency.ts"), "utf8");
      const g = await grade(dir, ID);
      expect(readFileSync(join(dir, "lib/latency.ts"), "utf8")).toBe(before);
      expect(g).toMatchObject({ code: 0, pass: true });
    });
  }, 240_000);

  // Value: protects=a symlink that leaves the tree, or points nowhere, fails the grade before any mutant can write through it, while a link that loops inside the tree is graded like any other file and passes; fails_when=grade.ts stops refusing such links, or starts refusing (or failing on) a loop inside the tree; why_new=GEVA-64's /ship blocking finding 2 (GST-348), and GEVA-73's /ship finding I3 (the loop case only asserted the exit code was not 2); seam=grade.ts's link check; no_claim=that the trial's delta import lets such links through
  test("a symlink that leaves the tree, or points nowhere, fails the grade and nothing outside is written; a loop inside the tree is still judged", async () => {
    await inRoot(async (root) => {
      const outside = seed(root, ID, "outside", ["fix", "guard"]);
      mkdirSync(join(root, "elsewhere"));
      renameSync(join(outside, "src/reports/latency.ts"), join(root, "elsewhere/latency.ts"));
      symlinkSync(join(root, "elsewhere/latency.ts"), join(outside, "src/reports/latency.ts"));
      const dangling = seed(root, ID, "dangling", ["fix", "guard"]);
      symlinkSync("missing.ts", join(dangling, "src/reports/gone.ts"));
      const shut = join(root, "shut");
      mkdirSync(shut, { mode: 0o000 });
      const folder = seed(root, ID, "folder", ["fix", "guard"]);
      symlinkSync(shut, join(folder, "src/out"));
      const loop = seed(root, ID, "loop", ["fix", "guard"]);
      symlinkSync(".", join(loop, "src/self"));
      const before = readFileSync(join(root, "elsewhere/latency.ts"), "utf8");
      try {
        const [out, gone, dir, self] = await Promise.all([grade(outside, ID), grade(dangling, ID), grade(folder, ID), grade(loop, ID)]);
        expect(readFileSync(join(root, "elsewhere/latency.ts"), "utf8")).toBe(before);
        expect(out).toMatchObject({ code: 1, pass: false, refused: "src/reports/latency.ts" });
        expect(gone).toMatchObject({ code: 1, pass: false, refused: "src/reports/gone.ts" });
        expect(dir).toMatchObject({ code: 1, pass: false, refused: "src/out" });
        expect(self).toMatchObject({ code: 0, pass: true });
        expect(self.refused).toBeUndefined();
      } finally {
        chmodSync(shut, 0o755);
      }
    });
  }, 240_000);

  // Value: protects=neither a tsconfig.json paths entry nor tree code that exits early can pass grading; fails_when=the check stops overriding the tree's tsconfig.json, or the oracle trusts its exit code without its JUnit report; why_new=GEVA-67 found both routes while fixing GEVA-64's finding 1 (GST-348); seam=tasks.json's check and grade.ts's oracle report check; no_claim=that the oracle can defend against code written to tamper with it in other ways
  test("a tsconfig.json paths entry or code that exits early cannot pass the check or the oracle", async () => {
    await inRoot(async (root) => {
      const paths = seed(root, ID, "paths", ["fix"]);
      write(paths, { "stand-in.ts": "export {};\n", "tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "*": ["./stand-in.ts"] } } }) + "\n" });
      const early = seed(root, ID, "early", ["fix"]);
      writeFileSync(join(early, "src/reports/latency.ts"), "process.exit(0);\n" + readFileSync(join(early, "src/reports/latency.ts"), "utf8"));
      for (const g of await Promise.all([grade(paths, ID), grade(early, ID)])) {
        expect(g).toMatchObject({ code: 1, pass: false });
        expect(g.scenarios.final).toEqual({ check: true, oracle: false, ok: false });
      }
    });
  }, 240_000);

  // Value: protects=the oracle grades the mutated tree, not what the repo's check leaves behind; fails_when=the oracle runs after the check in the same copy again; why_new=GEVA-67 (GST-348): a test that restores the fixed file made the fix alone pass every scenario; seam=grade.ts's scenario order; no_claim=that tree code imported by the oracle cannot tamper with it
  test("a check that rewrites the mutated files does not change the oracle's verdict", async () => {
    await inRoot(async (root) => {
      const dir = seed(root, ID, "restore", ["fix"]);
      const fixed = readFileSync(join(dir, "src/reports/order-value.ts"), "utf8");
      write(dir, {
        "tests/restore.test.ts": 'import { test } from "bun:test";\nimport { rmSync, writeFileSync } from "node:fs";\nimport { join } from "node:path";\n\nconst dir = join(import.meta.dir, "../src/reports");\ntest("tidy", () => {\n  writeFileSync(join(dir, "order-value.ts"), ' + JSON.stringify(fixed) + ');\n  rmSync(join(dir, "session-length.ts"), { force: true });\n});\n',
      });
      const g = await grade(dir, ID);
      expect(g).toMatchObject({ code: 1, pass: false });
      expect(g.scenarios["revert-c"]).toEqual({ check: true, oracle: false, ok: false });
    });
  }, 240_000);

  // Value: protects=the check cannot tell which scenario it is in from the folder it runs in; fails_when=scenarios run at paths that name them again; why_new=the /ship Red Team on GEVA-67 (GST-348): a check that failed only in the mistake scenarios' folders passed with no guard; seam=grade.ts's scenario loop; no_claim=that a check keeping state between its runs cannot guess, which the random order only makes unreliable
  test("the check cannot tell its scenario from the folder it runs in or the mutants' seed", async () => {
    await inRoot(async (root) => {
      const probes = { where: 'case "$PWD" in */[234]/repo) exit 1 ;; esac; bun test', seed: "[ -d ../pristine ] && exit 1; bun test" };
      const dirs = Object.entries(probes).map(([name, script]) => {
        const dir = seed(root, ID, name, ["fix"]);
        const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
        pkg.scripts.check = script;
        write(dir, { "package.json": JSON.stringify(pkg, null, 2) + "\n" });
        return dir;
      });
      for (const g of await Promise.all(dirs.map((dir) => grade(dir, ID)))) {
        expect(g).toMatchObject({ code: 1, pass: false });
        expect(g.scenarios["revert-c"]).toEqual({ check: true, oracle: false, ok: false });
        expect([...g.order].sort()).toEqual(["final", "fresh", "fresh-ok", "revert-a", "revert-c", "touch"]);
      }
    });
  }, 240_000);

  // Value: protects=the check cannot read the oracle's verdict or run the oracle's copy; fails_when=the oracle's report or its copy of the tree is still on disk while the check runs; why_new=the /ship Red Team at 032c9c9 (GST-348): a check that failed when ../oracle.xml showed a failing test passed every scenario with the fix alone; seam=grade.ts's scenario loop; no_claim=that tree code cannot find the grader's own files some other way, which the README puts out of reach
  test("the check cannot read the oracle's report or run the oracle's copy", async () => {
    await inRoot(async (root) => {
      const probes = { verdict: 'grep -qs "<failure" ../oracle.xml && exit 1; bun test', oracle: "if [ -d ../oracle/__grade__ ]; then (cd ../oracle && bun test ./__grade__) || exit 1; fi; bun test" };
      const dirs = Object.entries(probes).map(([name, script]) => {
        const dir = seed(root, ID, name, ["fix"]);
        const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
        pkg.scripts.check = script;
        write(dir, { "package.json": JSON.stringify(pkg, null, 2) + "\n" });
        return dir;
      });
      for (const g of await Promise.all(dirs.map((dir) => grade(dir, ID)))) {
        expect(g).toMatchObject({ code: 1, pass: false });
        expect(g.scenarios["revert-c"]).toEqual({ check: true, oracle: false, ok: false });
      }
    });
  }, 240_000);

  // Value: protects=fresh is not free for a tree that stops loading files from a folder: the new route or migration must be served or listed; fails_when=the admin-route-flag or migration-rollback oracle stops checking that fresh's file is wired in; why_new=the /ship Red Team on GEVA-67 (GST-348): a fixed route list plus a test for one route passed every scenario; seam=admin-route-flag/oracle.ts and migration-rollback/oracle.ts; no_claim=that other tasks' fresh files cannot be left unloaded, which they cannot be today because they are imported by name or by every caller
  test("admin-route-flag and migration-rollback: a fresh file the tree never loads does not pass fresh", async () => {
    await inRoot(async (root) => {
      const routes = seed(root, "admin-route-flag", "static-routes", ["fix"]);
      write(routes, {
        "src/routes/index.ts": 'import exportRoute from "./export.ts";\nimport health from "./health.ts";\nimport refunds from "./refunds.ts";\nimport type { Route } from "./types.ts";\n\nexport const routes: Route[] = [exportRoute, health, refunds];\n',
        "tests/refunds.test.ts": 'import { expect, test } from "bun:test";\nimport { handle } from "../src/router.ts";\n\ntest("/admin/refunds needs the admin token", () => {\n  expect(handle({ method: "POST", path: "/admin/refunds", headers: {} }).status).toBe(401);\n});\n',
      });
      const migrations = seed(root, "migration-rollback", "static-migrations", ["fix"]);
      const names = readdirSync(join(migrations, "migrations")).filter((f) => f.endsWith(".ts")).sort();
      const scan = readFileSync(join(migrations, "src/migrate.ts"), "utf8");
      const listed = scan.replace(/const files = readdirSync\(dir\)[^\n]*/, "const files = " + JSON.stringify(names) + ";");
      expect(listed).not.toBe(scan);
      writeFileSync(join(migrations, "src/migrate.ts"), listed);
      for (const g of await Promise.all([grade(routes, "admin-route-flag"), grade(migrations, "migration-rollback")])) {
        expect(g).toMatchObject({ code: 1, pass: false });
        expect(g.scenarios.fresh).toEqual({ check: true, oracle: false, ok: false });
      }
    });
  }, 240_000);

  // Value: protects=the oracle counts a blank label as harm: a design that renders a missing key as nothing does not make the mistake harmless; fails_when=the missing-translation oracle accepts blank lines again; why_new=GEVA-64's /ship non-blocking finding (GST-348); seam=missing-translation/oracle.ts; no_claim=that the oracle checks wording
  test("missing-translation: rendering a missing key as a blank label does not count as harmless", async () => {
    await inRoot(async (root) => {
      const dir = seed(root, "missing-translation", "blank", ["fix"]);
      writeFileSync(join(dir, "src/i18n.ts"), readFileSync(join(dir, "src/i18n.ts"), "utf8").replace("?? key", '?? ""'));
      const g = await grade(dir, "missing-translation");
      expect(g).toMatchObject({ code: 1, pass: false });
      expect(g.scenarios["revert-c"]).toEqual({ check: true, oracle: false, ok: false });
    });
  }, 240_000);

  // Value: protects=the JSON mutants find their key wherever the tree keeps it: a tree that nests or wraps its config gets each mistake put back where it reads it, so only a real guard passes, while a nested tree with a real guard still passes and a tree whose config has nothing to edit fails rather than passing for free; fails_when=a JSON mutant edits a fixed key path again, or counts as applied when it found nothing to change; why_new=GEVA-73's /ship Red Team finding C1 (GST-348): a config nested under limits passed every scenario with no real guard; seam=json-edit.ts and the mutants.sh of config-key-typo, timeout-units and missing-translation; no_claim=that every possible reshaping keeps its key names, which the prompt asks agents to keep
  test("the JSON mutants find their key wherever the tree keeps it, and a mutant with nothing to change fails the tree", async () => {
    await inRoot(async (root) => {
      const plans = (dir: string, plan: (limits: string) => string) => {
        const rows = [["free", 3, 1], ["team", 20, 10], ["pro", 50, 5]].map(([name, projects, seats]) => '  "' + name + '": ' + plan('"maxProjects": ' + projects + ', "maxSeats": ' + seats));
        write(dir, { "config/plans.json": "{\n" + rows.join(",\n") + "\n}\n" });
      };
      const nestPlans = (name: string, guard: string) => {
        const dir = seed(root, "config-key-typo", name, ["fix"]);
        plans(dir, (limits) => '{ "limits": { ' + limits + " } }");
        const src = readFileSync(join(dir, "src/plans.ts"), "utf8");
        const nested = src.replace("const table: Record<string, Partial<Limits>> = plans;", "const table: Record<string, Partial<Limits>> = Object.fromEntries(Object.entries(plans).map(([name, plan]) => [name, (plan as { limits: Partial<Limits> }).limits]));");
        expect(nested).not.toBe(src);
        write(dir, { "src/plans.ts": nested, "tests/plan-shape.test.ts": 'import { expect, test } from "bun:test";\nimport plans from "../config/plans.json";\n\ntest("every plan has its limits", () => {\n  for (const [name, plan] of Object.entries(plans)) ' + guard + "\n});\n" });
        return dir;
      };
      const weakPlans = nestPlans("plans-weak", 'expect(typeof (plan as { limits?: unknown }).limits, name).toBe("object");');
      const soundPlans = nestPlans("plans-sound", 'expect(Object.keys((plan as { limits: object }).limits).sort(), name).toEqual(["maxProjects", "maxSeats"]);');
      const services = seed(root, "timeout-units", "services-weak", ["fix"]);
      write(services, {
        "config/services.json": '{\n  "payments": { "url": "http://payments.example.com", "limits": { "timeoutMs": 5000 } },\n  "search": { "url": "http://search.example.com", "limits": { "timeoutMs": 3000 } },\n  "email": { "url": "http://email.example.com", "limits": { "timeoutMs": 10000 } }\n}\n',
        "src/client.ts": readFileSync(join(services, "src/client.ts"), "utf8").replace("type Service = { url: string; timeoutMs: number };", "type Service = { url: string; limits: { timeoutMs: number } };").replace("return service.timeoutMs;", "return service.limits.timeoutMs;"),
        "tests/service-shape.test.ts": 'import { expect, test } from "bun:test";\nimport services from "../config/services.json";\n\ntest("every service has its limits", () => {\n  for (const [name, s] of Object.entries(services)) expect(typeof s.limits, name).toBe("object");\n});\n',
      });
      const locales = seed(root, "missing-translation", "locales-weak", ["fix"]);
      write(locales, {
        "locales/en.json": '{\n  "checkout": { "title": "Checkout", "pay": "Pay now" },\n  "profile": { "title": "Profile", "save": "Save changes" }\n}\n',
        "locales/fr.json": '{\n  "checkout": { "title": "Paiement", "pay": "Payer maintenant" },\n  "profile": { "title": "Profil", "save": "Enregistrer les modifications" }\n}\n',
        "src/i18n.ts": 'import en from "../locales/en.json";\nimport fr from "../locales/fr.json";\n\nconst messages: Record<string, unknown> = { en, fr };\n\nexport function t(locale: string, key: string): string {\n  const found = key.split(".").reduce<unknown>((at, part) => (at as Record<string, unknown> | undefined)?.[part], messages[locale]);\n  return typeof found === "string" ? found : key;\n}\n',
        "tests/locale-shape.test.ts": 'import { expect, test } from "bun:test";\nimport { readdirSync, readFileSync } from "node:fs";\nimport { join } from "node:path";\n\nconst dir = join(import.meta.dir, "../locales");\nconst keys = (node: unknown): string[] => (node && typeof node === "object" ? Object.entries(node).flatMap(([k, v]) => [k, ...keys(v)]) : []);\n\ntest("locale files nest their keys", () => {\n  for (const file of readdirSync(dir)) expect(keys(JSON.parse(readFileSync(join(dir, file), "utf8"))).filter((k) => k.includes(".")), file).toEqual([]);\n});\n',
      });
      const renamed = seed(root, "config-key-typo", "renamed", ["fix", "guard"]);
      plans(renamed, (limits) => "{ " + limits.replaceAll('"maxProjects"', '"projects"').replaceAll('"maxSeats"', '"seats"') + " }");
      write(renamed, {
        "src/plans.ts": readFileSync(join(renamed, "src/plans.ts"), "utf8").replace("const table: Record<string, Partial<Limits>> = plans;", "const table: Record<string, Partial<Limits>> = Object.fromEntries(Object.entries(plans).map(([name, plan]) => [name, { maxProjects: plan.projects, maxSeats: plan.seats }]));"),
        "tests/plan-keys.test.ts": 'import { expect, test } from "bun:test";\nimport plans from "../config/plans.json";\n\ntest("every plan sets exactly projects and seats", () => {\n  for (const [name, plan] of Object.entries(plans)) expect(Object.keys(plan).sort(), name).toEqual(["projects", "seats"]);\n});\n',
      });
      const [weak, sound, slow, raw, gone] = await Promise.all([grade(weakPlans, "config-key-typo"), grade(soundPlans, "config-key-typo"), grade(services, "timeout-units"), grade(locales, "missing-translation"), grade(renamed, "config-key-typo")]);
      for (const g of [weak, slow, raw]) {
        expect(g).toMatchObject({ code: 1, pass: false });
        expect([g.scenarios.final!.ok, g.scenarios.touch!.ok, g.scenarios["fresh-ok"]!.ok]).toEqual([true, true, true]);
        expect(g.scenarios["revert-c"]).toEqual({ check: true, oracle: false, ok: false });
      }
      expect(weak.scenarios.fresh).toEqual({ check: true, oracle: false, ok: false });
      expect(sound).toMatchObject({ code: 0, pass: true });
      expect(gone).toMatchObject({ code: 1, pass: false });
      expect(gone.scenarios.final).toEqual({ check: true, oracle: true, ok: true });
      for (const s of ["revert-a", "revert-c", "fresh", "fresh-ok"]) expect(gone.scenarios[s]).toMatchObject({ check: null, oracle: null, ok: false, reason: expect.stringContaining("the tree's layout stopped the " + s + " mutant: E_TASKS_INVALID: json-edit: config/plans.json: no ") });
    });
  }, 240_000);

  // Value: protects=a guard that fails on any change in what the config means (a snapshot of the parsed plans) fails the grade: fresh-ok adds a correct plan, which such a guard rejects; fails_when=the grader drops fresh-ok, or fresh-ok's edit writes the mistake or nothing at all; why_new=GEVA-73's /ship Red Team finding C2 (GST-348): touch is cosmetic, so a snapshot of meaning passed every scenario; seam=grade.ts's MUST_PASS and each mutants.sh's fresh-ok; no_claim=that a guard can tell a correct new plan from a wrong one by any means but behavior
  test("a snapshot of what the config means fails fresh-ok, so it fails the grade", async () => {
    await inRoot(async (root) => {
      const dir = seed(root, "config-key-typo", "meaning", ["fix"]);
      write(dir, { "tests/plans-snapshot.test.ts": 'import { expect, test } from "bun:test";\nimport plans from "../config/plans.json";\n\ntest("plans match their snapshot", () => {\n  expect(plans).toMatchSnapshot();\n});\n' });
      run(["bun", "test"], dir);
      expect(existsSync(join(dir, "tests/__snapshots__"))).toBe(true);
      const g = await grade(dir, "config-key-typo");
      expect(g).toMatchObject({ code: 1, pass: false });
      expect(["revert-a", "revert-c", "fresh"].map((s) => g.scenarios[s]!.ok)).toEqual([true, true, true]);
      expect(g.scenarios["fresh-ok"]).toEqual({ check: false, oracle: true, ok: false });
    });
  }, 240_000);

  // Value: protects=a relative link that climbs out through the copy root's name and back in passes in one copy but not another, so each copy is checked where it is used and no mutant writes into the master copy; fails_when=grade.ts checks links in its first copy only; why_new=GEVA-73's /ship finding I1 (GST-348); seam=grade.ts's link check on each copy; no_claim=that tree code cannot write outside its copy at run time
  test("a link that climbs through the copy root's name is refused in the copy where it would leave", async () => {
    await inRoot(async (root) => {
      const dir = seed(root, ID, "tree", ["fix", "guard"]);
      mkdirSync(join(dir, "lib"));
      renameSync(join(dir, "src/reports/latency.ts"), join(dir, "lib/latency.ts"));
      symlinkSync("../../../tree/lib/latency.ts", join(dir, "src/reports/latency.ts"));
      const before = readFileSync(join(dir, "lib/latency.ts"), "utf8");
      expect(readFileSync(join(dir, "src/reports/latency.ts"), "utf8")).toBe(before);
      const g = await grade(dir, ID);
      expect(readFileSync(join(dir, "lib/latency.ts"), "utf8")).toBe(before);
      expect(g).toMatchObject({ code: 1, pass: false, refused: "src/reports/latency.ts" });
    });
  }, 240_000);

  // Value: protects=nothing the oracle's process can read (its environment or its arguments) names the scenario, so tree code the oracle imports cannot act safe only when a mistake is in place; fails_when=grade.ts passes the scenario to the oracle by env or argv again; why_new=GEVA-73's /ship finding I2 (GST-348): GRADE_SCENARIO sat in the oracle's env; seam=grade.ts's oracle step and the oracles' "with no mistake in place" blocks; no_claim=that tree code cannot tamper with the oracle's process in other ways
  test("tree code the oracle imports finds no scenario name in its environment or arguments", async () => {
    await inRoot(async (root) => {
      const dir = seed(root, ID, "sniff", ["fix", "guard"]);
      const sniff = 'const SCENARIOS = ["final", "touch", "revert-a", "revert-c", "fresh", "fresh-ok"];\nif ([...Object.values(process.env), ...process.argv].some((v) => SCENARIOS.includes(v ?? ""))) throw new Error("graded in a named scenario");\n';
      write(dir, { "src/reports/latency.ts": sniff + readFileSync(join(dir, "src/reports/latency.ts"), "utf8") });
      const g = await grade(dir, ID);
      expect(g).toMatchObject({ code: 0, pass: true });
    });
  }, 240_000);

  // Value: protects=the secret-file-mode oracle removes every folder it saves credentials into, pass or fail; fails_when=the oracle stops cleaning up in a finally block; why_new=GEVA-73's /ship finding I4 (GST-348): one keyless run left 623 credential folders in /tmp; seam=secret-file-mode/oracle.ts; no_claim=that the tree's own check cleans up after itself
  test("secret-file-mode: the oracle leaves no credential folder behind", async () => {
    await inRoot(async (root) => {
      const dir = seed(root, "secret-file-mode", "tree", ["fix", "guard"]);
      mkdirSync(join(dir, "__grade__"));
      copyFileSync(join(TASKS, "secret-file-mode/oracle.ts"), join(dir, "__grade__/oracle.test.ts"));
      const tmp = join(root, "tmp");
      mkdirSync(tmp);
      run([process.execPath, "--no-env-file", "--config=" + join(TASKS, "bunfig.toml"), "test", "./__grade__/oracle.test.ts"], dir, { TMPDIR: tmp });
      expect(readdirSync(tmp).filter((f) => f.startsWith("oracle-"))).toEqual([]);
    });
  }, 240_000);

  // Value: protects=a tree whose own steps break fails, rather than exiting 2, which the trial reads as a verifier fault and retries: a copy that fails on a FIFO, a mutant the tree's layout stopped, and a check killed by a signal (a hang ends the same way, by SIGTERM at the step limit); fails_when=any of these exits 2 again, or the layout case stops naming its reason; why_new=GEVA-73's /ship finding I5 (GST-348); seam=grade.ts's step results and the mutant probe on the seed; no_claim=that the trial retries nothing else
  test("a tree that breaks a step fails the grade instead of exiting 2", async () => {
    await inRoot(async (root) => {
      const fifo = seed(root, ID, "fifo", ["fix", "guard"]);
      run(["mkfifo", join(fifo, "notes.fifo")], fifo);
      const blocked = seed(root, ID, "blocked", ["fix"]);
      rmSync(join(blocked, "src/reports/latency.ts"));
      mkdirSync(join(blocked, "src/reports/latency.ts"));
      const killed = seed(root, ID, "killed", ["fix"]);
      write(killed, { "package.json": '{ "scripts": { "check": "kill -9 $$" } }\n' });
      const hung = seed(root, "html-escape", "hung", ["fix", "alt"]);
      write(hung, { "package.json": '{ "scripts": { "check": "kill -9 $$" } }\n' });
      const [pipe, mutant, signal, harmless] = await Promise.all([grade(fifo, ID), grade(blocked, ID), grade(killed, ID), grade(hung, "html-escape")]);
      expect(pipe).toMatchObject({ code: 1, pass: false, reason: expect.stringContaining("the tree could not be copied") });
      expect(mutant).toMatchObject({ code: 1, pass: false });
      expect(mutant.scenarios["revert-a"]).toMatchObject({ check: null, oracle: null, ok: false, reason: expect.stringContaining("the tree's layout stopped the revert-a mutant") });
      expect(signal).toMatchObject({ code: 1, pass: false });
      expect(signal.scenarios.final).toMatchObject({ check: null, ok: false, reason: expect.stringContaining("bun run check did not finish") });
      expect(harmless).toMatchObject({ code: 1, pass: false });
      expect(Object.values(harmless.scenarios).map((s) => s.ok)).toEqual([false, false, false, false, false, false]);
      expect(harmless.scenarios["revert-c"]).toMatchObject({ check: null, oracle: true, ok: false, reason: expect.stringContaining("bun run check did not finish") });
    });
  }, 240_000);

  // Value: protects=grade.ts exits 2 only when the grader itself failed (an unknown task, a mutant that fails on the seed too, a step that cannot start), and a pass is never turned into a failure by cleanup; fails_when=a grader fault exits 0 or 1, or a read-only directory makes a pass exit 1; why_new=GEVA-64's /ship non-blocking findings and GEVA-73's finding I5 (GST-348); seam=grade.ts's exit codes and cleanup; no_claim=how the trial records exit 2, which judgeCheck covers
  test("grade.ts exits 2 only when the grader failed, and cleanup never changes a verdict", async () => {
    await inRoot(async (root) => {
      const plain = seed(root, ID, "plain", ["fix", "guard"]);
      const suite = join(root, "suite");
      cpSync(TASKS, suite, { recursive: true });
      writeFileSync(join(suite, ID, "mutants.sh"), "exit 1\n");
      const bin = join(root, "bin");
      mkdirSync(bin);
      symlinkSync(process.execPath, join(bin, "bun"));
      symlinkSync(Bun.which("sh")!, join(bin, "sh"));
      const locked = seed(root, ID, "locked", ["fix", "guard"]);
      write(locked, { "notes/read-only.md": "kept\n" });
      chmodSync(join(locked, "notes"), 0o555);
      try {
        const [unknown, broken, start, pass] = await Promise.all([check(plain, "no-such-task"), check(plain, ID, { SKILL_EVAL_FIXTURES: suite }), check(plain, ID, { PATH: bin }), check(locked, ID)]);
        for (const r of [unknown, broken, start]) {
          expect(r.code, r.err).toBe(2);
          expect(r.err).toMatch(/^E_TASKS_INVALID: grade: /m);
        }
        expect(pass.code, pass.err).toBe(0);
        expect(JSON.parse(pass.out).pass).toBe(true);
      } finally {
        chmodSync(join(locked, "notes"), 0o755);
      }
    });
  }, 240_000);

  // Value: protects=grading starts no git process that outlives its step: since git 2.47 every commit in seed.sh detaches `git maintenance run --auto`, which unlinks its lock in the seed's .git a few milliseconds later, and when that lands while remove() deletes the seed, Bun's rmSync stops early without an error, so the next scenario's mkdir of the seed exits 2 with EEXIST; fails_when=grade.ts runs git with auto maintenance on again; why_new=the native adversarial reader at ec8f835 on GEVA-75's /ship (GST-348): 2 of 9 full-file runs exited 2; seam=grade.ts's NO_GIT_CONFIG; no_claim=that tree code cannot leave its own processes running
  test("grading starts no background git maintenance", async () => {
    await inRoot(async (root) => {
      const dir = seed(root, ID, "traced", ["fix", "guard"]);
      const bin = join(root, "bin");
      const trace = join(root, "trace2.json");
      mkdirSync(bin);
      write(bin, { git: "#!/bin/sh\nGIT_TRACE2_EVENT='" + trace + "' exec '" + join(run(["git", "--exec-path"], root).trim(), "git") + "' \"$@\"\n" });
      chmodSync(join(bin, "git"), 0o755);
      const r = await check(dir, ID, { PATH: bin + ":" + ENV.PATH });
      expect(r.code, r.err).toBe(0);
      const events = readFileSync(trace, "utf8").split("\n");
      expect(events.some((e) => /"argv":\[[^\]]*"commit"/.test(e))).toBe(true);
      expect(events.filter((e) => /"argv":\[[^\]]*"maintenance"|"label":"detach"/.test(e))).toEqual([]);
    });
  }, 240_000);

  // Value: protects=a check that hangs, or passes but leaves a process holding its stderr, fails every scenario with a reason by the grade's own deadline, so the trial's check timeout never fires first and a hung tree records a fail, not an unjudged trial; fails_when=grade.ts loses its total deadline, stops capping each step at the time left, or counts a step that timed out with status 0 as finished; why_new=#87's /ship pass 4 red-team finding 1 (GST-413); seam=grade.ts's deadline, lowered through GRADE_DEADLINE_MS in grade.ts's own environment, which no step passes on to the tree; no_claim=that grade.ts can stop tree code that ignores SIGTERM
  test("a check that hangs in every scenario fails the grade, with a reason, by the grade's deadline", async () => {
    await inRoot(async (root) => {
      const loop = seed(root, ID, "loop", ["fix"]);
      write(loop, { "tests/loop.test.ts": 'import { test } from "bun:test";\n\ntest("waits for the month to end", () => {\n  while (true) {}\n});\n' });
      const held = seed(root, ID, "held", ["fix"]);
      write(held, { "tests/server.test.ts": 'import { test } from "bun:test";\nimport { spawn } from "node:child_process";\n\ntest("starts a server", () => {\n  spawn("sleep", ["60"], { stdio: ["ignore", "ignore", "inherit"], detached: true }).unref();\n});\n' });
      const started = Date.now();
      const grades = await Promise.all([loop, held].map((dir) => grade(dir, ID, { GRADE_DEADLINE_MS: "15000" })));
      expect(Date.now() - started).toBeLessThan(25_000);
      for (const g of grades) {
        expect(g).toMatchObject({ code: 1, pass: false });
        expect(Object.values(g.scenarios).some((s) => s.reason?.includes("15-second deadline passed"))).toBe(true);
        for (const name of g.order) expect([name, g.scenarios[name]!.ok, typeof g.scenarios[name]!.reason]).toEqual([name, false, "string"]);
      }
    });
  }, 60_000);
});
