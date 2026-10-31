// Keyless tests for the seeded-mistake Lane A tasks (docs/benchmarks/2026-11-seeded-mistakes, GST-348). The tasks file
// passes the contract and preflight's vacuity check, the lock pins it against a stub that holds no stack's text, and on
// every task the oracle passes the reference solutions while failing the fix alone, a snapshot guard and a guard that
// remembers only the old mistakes' exact bytes.
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

type Scenario = { check: boolean; oracle: boolean; ok: boolean };
type Grade = { code: number; pass: boolean; scenarios: Record<string, Scenario> };

async function grade(dir: string, id: string): Promise<Grade> {
  const p = Bun.spawn(["bun", join(TASKS, "grade.ts"), id], { cwd: dir, env: ENV, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
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
      expect(t.check).toBe('bun "$SKILL_EVAL_FIXTURES/grade.ts" ' + t.id);
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

  // Value: protects=the tasks were written first: the lock pins this tasks file and the policy against a stub with no procedure; fails_when=tasks.json changes without a relock, or the lock names a real skill or claims contract lines; why_new=GST-348 (a lock per task, built with skill-eval --lock); seam=tasks.lock.json; no_claim=the round 2 relock, which its preregistration makes
  test("the lock pins the tasks file against the stack-neutral stub", () => {
    const { lock } = readLock(join(TASKS, "tasks.lock.json"));
    expect(lock!.tasks).toEqual({ file: "tasks.json", sha256: file.sha256! });
    expect(lock!.ext).toBeNull();
    expect(lock!.policy?.sha256).toBe(sha256(readFileSync(join(REPO_ROOT, "policy/models.json"))));
    expect(lock!.skill.name).toBe("stack-neutral");
    expect(lock!.skill.tree_sha256).toBe(treeSha256(readSkillFiles(join(SUITE, "stack-neutral"))));
    expect(lock!.lines).toEqual([]);
  });
});

describe.each(ids)("%s", (id) => {
  // Value: protects=the oracle grades the guard, not the fix: a reference guard passes (a test, a lint rule or a design change), while the fix alone, a snapshot of the source and a guard that remembers only the old bytes all fail, each on the scenario built to catch it; fails_when=a scenario stops separating them, a mutant stops applying, or an oracle rejects a correct solution; why_new=GST-348; seam=grade.ts, mutants.sh and oracle.ts; no_claim=how models score
  test("the oracle passes the reference solutions and fails the fix alone, a snapshot guard and a literal guard", async () => {
    const root = mkdtempSync(join(tmpdir(), "seeded-" + id + "-"));
    try {
      const refs = ["guard", ...(readFileSync(join(REFS, id + ".sh"), "utf8").includes("\n  alt)") ? ["alt"] : [])];
      const snapshot = seed(root, id, "snapshot", ["fix"]);
      addSnapshotGuard(snapshot);
      const literal = seed(root, id, "literal", ["fix"]);
      addLiteralGuard(root, id, literal);
      const dirs = [seed(root, id, "fix", ["fix"]), snapshot, literal, ...refs.map((r) => seed(root, id, r, ["fix", r]))];
      const [fix, snap, lit, ...good] = await Promise.all(dirs.map((d) => grade(d, id)));
      for (const g of good) expect(g).toMatchObject({ code: 0, pass: true });
      expect(fix!.pass).toBe(false);
      expect([fix!.scenarios.final!.ok, fix!.scenarios.touch!.ok]).toEqual([true, true]);
      expect(fix!.scenarios["revert-c"]).toEqual({ check: true, oracle: false, ok: false });
      expect(snap!.pass).toBe(false);
      expect(snap!.scenarios.final!.ok).toBe(true);
      expect(["touch", "revert-a", "revert-c", "fresh"].map((s) => snap!.scenarios[s]!.check)).toEqual([false, false, false, false]);
      expect(lit!.pass).toBe(false);
      expect([lit!.scenarios.final!.ok, lit!.scenarios.touch!.ok, lit!.scenarios["revert-a"]!.check, lit!.scenarios["revert-c"]!.check]).toEqual([true, true, false, false]);
      expect(lit!.scenarios.fresh).toEqual({ check: true, oracle: false, ok: false });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 240_000);
});
