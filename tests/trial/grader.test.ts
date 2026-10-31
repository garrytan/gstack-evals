import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadContract } from "../../src/skill-eval/contract/sidecar.ts";
import type { ContractTask } from "../../src/skill-eval/contract/tasks.ts";
import { hostReadiness } from "../../src/skill-eval/cli/run-host.ts";
import { gradeTrial, verdictTasks, type VerdictTask } from "../../src/skill-eval/verdict/grade.ts";
import { removeTree } from "../../src/trial/cleanup.ts";
import { importDelta, PLACEHOLDER, snapshot } from "../../src/trial/delta.ts";
import { buildTrialImage } from "../../src/trial/image.ts";
import { NOP, replayAgent, type Transcript } from "../../src/trial/replay.ts";
import { bwrapArgs, dockerSandbox, IsolationError, processSandbox, type Sandbox, type StepResult } from "../../src/trial/sandbox.ts";
import { runTrial, type TrialSpec } from "../../src/trial/trial.ts";

const DOCKER = process.env.GSTACK_EVALS_DOCKER === "1";
const FIXTURES = join(import.meta.dir, "../contract/fixtures/gstack");
const ORACLE = JSON.parse(readFileSync(join(import.meta.dir, "fixtures/oracle-transcripts.json"), "utf8")) as Record<string, Record<string, Transcript>>;
const roots: string[] = [];
const scratch = (name: string) => {
  const dir = mkdtempSync(join(tmpdir(), "gse-" + name + "-"));
  roots.push(dir);
  return dir;
};
afterAll(() => roots.forEach((r) => removeTree(r)));

const localStep = (command: string, cwd: string, env: Record<string, string>, timeoutMs: number): StepResult => {
  const r = spawnSync("sh", ["-c", command], { cwd, env, timeout: timeoutMs, encoding: "utf8" });
  const timedOut = (r.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT";
  return { exitCode: timedOut ? null : r.status, timedOut, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
};

/** The grader's keyless tier: the same pipeline with every step on this machine. It isolates nothing, so it never runs the canary. */
const local: Sandbox = {
  isolation: "process",
  workPath: (work) => work,
  fixturesPath: (f) => f,
  homePath: (dir) => {
    mkdirSync(join(dir, "home"), { recursive: true });
    return join(dir, "home");
  },
  step: (_role, command, _task, o) => localStep(command, o.work, o.env, o.timeoutMs),
  agent: (_task, o) => ({ exec: (command, ms) => localStep(command, o.work, o.env, ms), spawn: (argv, env = {}) => spawn(argv[0]!, argv.slice(1), { cwd: o.work, env: { ...o.env, ...env }, stdio: ["pipe", "pipe", "pipe"] }), stop() {} }),
};

const skills = Object.fromEntries(["learn", "write-skill"].map((s) => {
  const contract = loadContract(join(FIXTURES, s, "tasks.json"));
  return [s, { tasks: contract.tasks.tasks, verdict: Object.fromEntries(verdictTasks(contract).map((t) => [t.id, t])) as Record<string, VerdictTask> }];
}));

async function trial(sandbox: Sandbox, skill: string, task: ContractTask, transcript: Transcript, extra: Partial<TrialSpec> = {}) {
  const agent = replayAgent(transcript);
  const run = await runTrial({ cell: { model: "replay", arm: "after", round: 1, trial: 0 }, task, tasksDir: join(FIXTURES, skill), sandbox, agent, dir: scratch("trial-" + task.id), timeoutS: 120, ...extra });
  return { ...run, agent, outcome: gradeTrial(skills[skill]!.verdict[task.id]!, run.record).outcome };
}

const task = (skill: string, id: string) => skills[skill]!.tasks.find((t) => t.id === id)!;

/** The check on the agent's own tree, for comparison with the grade tree. */
const checkAgentTree = (sandbox: Sandbox, skill: string, t: ContractTask, dir: string) =>
  sandbox.step("check", t.check!, t.id, { work: join(dir, "work", t.id), fixtures: join(dir, "fixtures"), env: { PATH: "/usr/local/bin:/usr/bin:/bin", HOME: sandbox.homePath(dir), LANG: "C.UTF-8", TERM: "dumb", SKILL_EVAL_FIXTURES: sandbox.fixturesPath(join(dir, "fixtures")), GSTACK_HOME: sandbox.workPath(join(dir, "work", t.id), t.id) + "/.gstack-home", GSTACK_STATE_ROOT: sandbox.workPath(join(dir, "work", t.id), t.id) + "/.gstack-home" }, timeoutMs: 60_000 }).exitCode === 0;

function graderSuite(name: string, sandbox: () => Sandbox) {
  describe(name, () => {
    // Value: protects=the whole trial grades each committed contract task as its author meant: the oracle passes and the nop fails, every check included; fails_when=a task grades wrong through setup, the state root, the delta import or the check runner; why_new=U9's done-means (all 12 committed contract tasks, /learn's ten checks); seam=runTrial, replayAgent; no_claim=how a real model does on them
    for (const skill of ["learn", "write-skill"]) {
      test("every " + skill + " task passes on its oracle transcript and fails on the nop", async () => {
        const ids = skills[skill]!.tasks.map((t) => t.id);
        expect(ids.length).toBe(skill === "learn" ? 10 : 2);
        for (const t of skills[skill]!.tasks) {
          const oracle = (await trial(sandbox(), skill, t, ORACLE[skill]![t.id]!));
          expect([t.id, oracle.outcome, oracle.record.check]).toEqual([t.id, "pass", t.check === undefined ? null : true]);
          const nop = (await trial(sandbox(), skill, t, NOP));
          expect([t.id, nop.outcome]).toEqual([t.id, "fail"]);
        }
      }, 600_000);
    }

    // Value: protects=a safety check grades the agent's changes against the evaluator's baseline, so committing a violation cannot hide it; fails_when=the agent's commit moves the grader's HEAD and git diff HEAD passes; why_new=U9 grader test (committed violation); seam=importDelta, runTrial; no_claim=changes outside the work tree
    test("a committed violation of a safety check still fails, though the agent's own tree passes it", async () => {
      const t = task("learn", "no-code-change");
      const r = (await trial(sandbox(), "learn", t, { steps: ["printf '  # cached\\n' >> app/models/user.rb && git add -A && git commit -qm tidy"], turns: ["Act on n-plus-one-queries."] }, { keep: true }));
      expect(r.record.check).toBe(false);
      expect(r.outcome).toBe("fail");
      expect(r.delta!.changed).toContain("app/models/user.rb");
      expect(checkAgentTree(sandbox(), "learn", t, r.dir)).toBe(true);
    }, 300_000);

    test("a forbidden deletion grades as it does in the agent's tree, and a committed one still fails", async () => {
      const t = task("learn", "no-code-change");
      const plain = (await trial(sandbox(), "learn", t, { steps: ["rm app/models/user.rb"], turns: ["n-plus-one"] }, { keep: true }));
      expect(plain.delta!.deleted).toEqual(["app/models/user.rb"]);
      expect(plain.record.check).toBe(false);
      expect(checkAgentTree(sandbox(), "learn", t, plain.dir)).toBe(false);
      const committed = (await trial(sandbox(), "learn", t, { steps: ["git rm -q app/models/user.rb && git commit -qm drop"], turns: ["n-plus-one"] }, { keep: true }));
      expect(committed.record.check).toBe(false);
      expect(checkAgentTree(sandbox(), "learn", t, committed.dir)).toBe(true);
    }, 300_000);

    test("a new skill folder comes across and grades as in the agent's tree", async () => {
      const t = task("write-skill", "new-skill");
      const r = (await trial(sandbox(), "write-skill", t, ORACLE["write-skill"]!["new-skill"]!, { keep: true }));
      expect(r.delta!.added).toEqual(expect.arrayContaining(["skills", "skills/changelog", "skills/changelog/SKILL.md"]));
      expect(r.record.check).toBe(true);
      expect(checkAgentTree(sandbox(), "write-skill", t, r.dir)).toBe(true);
    }, 300_000);

    test("the state root's changes come across; a paths list that leaves it out does not import them", async () => {
      const t = task("learn", "add");
      expect((await trial(sandbox(), "learn", t, ORACLE.learn!.add!)).record.check).toBe(true);
      const narrowed = (await trial(sandbox(), "learn", t, ORACLE.learn!.add!, { entry: { paths: ["app"] } }));
      expect(narrowed.record.check).toBe(false);
      const viaVar = { ...t, check: 'grep -rq flaky-port-3000 "$GSTACK_HOME/projects"' };
      expect((await trial(sandbox(), "learn", viaVar, ORACLE.learn!.add!)).record.check).toBe(true);
      expect((await trial(sandbox(), "learn", viaVar, ORACLE.learn!.add!, { entry: { paths: ["app"] } })).record.check).toBe(false);
    }, 300_000);

    // Value: protects=every kebab task id stays disjoint from the evaluator's trees; fails_when=an id such as fixtures, baseline, grade or home puts the tasks directory in the agent's work dir or makes a snapshot copy onto itself; why_new=#59 review; seam=runTrial; no_claim=none beyond protects
    test("a task id that names an evaluator tree keeps the tasks directory out of the work dir and still grades", async () => {
      const t = task("learn", "add");
      for (const id of ["fixtures", "baseline", "grade", "home", "work"]) {
        const r = await runTrial({ cell: { model: "replay", arm: "after", round: 1, trial: 0 }, task: { ...t, id }, tasksDir: join(FIXTURES, "learn"), sandbox: sandbox(), agent: replayAgent(ORACLE.learn!.add!), dir: scratch("id-" + id), timeoutS: 120, keep: true });
        expect([id, r.record.termination.kind, r.record.check]).toEqual([id, "completed", true]);
        expect(existsSync(join(r.dir, "work", id, "tasks.json"))).toBe(false);
      }
    }, 300_000);

    test("a timeout is its own outcome, a failing setup and a check that cannot judge are missing cells", async () => {
      const t = task("learn", "add");
      const slow = (await trial(sandbox(), "learn", t, { steps: ["sleep 10"], turns: [] }, { timeoutS: 1 }));
      expect(slow.record.termination).toEqual({ kind: "timeout" });
      expect(slow.record.check).toBeNull();
      expect((await trial(sandbox(), "learn", { ...t, setup: "exit 3" }, NOP)).record.termination).toEqual({ kind: "missing", code: "E_TASKS_INVALID" });
      expect((await trial(sandbox(), "learn", { ...t, check: "exit 2" }, NOP)).record.termination).toEqual({ kind: "missing", code: "E_VERIFIER" });
    }, 300_000);

    test("trees cleanup cannot remove are named in the result and in trial.json, and the grade stands", async () => {
      const t = task("learn", "add");
      const r = (await trial(sandbox(), "learn", t, ORACLE.learn!.add!, { cleanup: { remove: () => {} } }));
      expect(r.outcome).toBe("pass");
      expect(r.leftovers.map((l) => l.replace(r.dir, "<dir>"))).toEqual(["work/add", "baseline", "grade", "fixtures"].map((tree) => "could not remove <dir>/" + tree + ": still present after removal"));
      expect(JSON.parse(readFileSync(join(r.dir, "trial.json"), "utf8")).logs.leftovers).toEqual(r.leftovers);
    }, 300_000);
  });
}

graderSuite("trial grader (keyless, on this machine)", () => local);

describe("delta import", () => {
  test("type changes, escaping symlinks and fifos: files become directories and back, and what cannot be graded is dropped and named", () => {
    const root = scratch("delta");
    const [baseline, after, grade] = ["baseline", "after", "grade"].map((n) => join(root, n));
    mkdirSync(join(baseline, "d"), { recursive: true });
    writeFileSync(join(baseline, "a"), "file");
    writeFileSync(join(baseline, "d", "x"), "x");
    mkdirSync(join(baseline, ".git"));
    writeFileSync(join(baseline, ".git", "HEAD"), "ref: refs/heads/main\n");
    snapshot(baseline, after);
    snapshot(baseline, grade);
    removeTree(join(after, "a"));
    mkdirSync(join(after, "a"));
    writeFileSync(join(after, "a", "b"), "now a dir");
    removeTree(join(after, "d"));
    writeFileSync(join(after, "d"), "now a file");
    writeFileSync(join(after, ".git", "HEAD"), "ref: refs/heads/agent\n");
    symlinkSync("/etc/passwd", join(after, "escape"));
    symlinkSync("a/b", join(after, "inside"));
    spawnSync("mkfifo", [join(after, "pipe")]);
    const delta = importDelta(baseline, after, grade);
    expect(readFileSync(join(grade, "a", "b"), "utf8")).toBe("now a dir");
    expect(readFileSync(join(grade, "d"), "utf8")).toBe("now a file");
    expect(readFileSync(join(grade, "inside"), "utf8")).toBe("now a dir");
    expect(readdirSync(join(grade, "escape"))).toEqual([PLACEHOLDER]);
    expect(readFileSync(join(grade, ".git", "HEAD"), "utf8")).toBe("ref: refs/heads/main\n");
    expect(delta.dropped.map((d) => d.path).toSorted()).toEqual(["escape", "pipe"]);
    expect(delta.deleted).toEqual(["d/x"]);
  });

  // Value: protects=a symlink is imported only when its whole chain resolves inside the work tree; fails_when=a chain through a link like a -> . reaches the check's /fixtures or another path outside; why_new=#59 review; seam=importDelta; no_claim=absolute links into the work dir's container path, which are dropped too
  test("a symlink chain that escapes through an intermediate link is dropped; one that stays inside is kept", () => {
    const root = scratch("chain");
    const [baseline, after, grade] = ["baseline", "after", "grade"].map((n) => join(root, n));
    mkdirSync(baseline, { recursive: true });
    snapshot(baseline, after);
    snapshot(baseline, grade);
    writeFileSync(join(after, "file"), "inside");
    symlinkSync(".", join(after, "a"));
    symlinkSync("a/../demo/a/../../fixtures/expected.txt", join(after, "answer"));
    symlinkSync("a/a/file", join(after, "ok"));
    symlinkSync("loop", join(after, "loop"));
    const delta = importDelta(baseline, after, grade);
    expect(delta.dropped.map((d) => d.path).toSorted()).toEqual(["answer", "loop"]);
    expect(readFileSync(join(grade, "ok"), "utf8")).toBe("inside");
  });

  // Value: protects=an agent's read-only directories import with their contents and keep their modes, under a baseline directory that is read-only too; fails_when=a parent's final mode is set before its children are copied and the import throws EACCES; why_new=#59 review; seam=importDelta; no_claim=root, who writes anywhere
  test.skipIf(process.getuid?.() === 0)("read-only directories import with their children and keep their modes", () => {
    const root = scratch("modes");
    const [baseline, after, grade] = ["baseline", "after", "grade"].map((n) => join(root, n));
    mkdirSync(join(baseline, "locked"), { recursive: true });
    chmodSync(join(baseline, "locked"), 0o555);
    snapshot(baseline, after);
    snapshot(baseline, grade);
    chmodSync(join(after, "locked"), 0o755);
    writeFileSync(join(after, "locked", "new"), "added");
    chmodSync(join(after, "locked"), 0o555);
    mkdirSync(join(after, "d"));
    writeFileSync(join(after, "d", "f"), "f");
    chmodSync(join(after, "d"), 0o555);
    const delta = importDelta(baseline, after, grade);
    expect(delta.added.toSorted()).toEqual(["d", "d/f", "locked/new"]);
    expect(readFileSync(join(grade, "locked", "new"), "utf8")).toBe("added");
    expect(readFileSync(join(grade, "d", "f"), "utf8")).toBe("f");
    expect([statSync(join(grade, "locked")).mode & 0o777, statSync(join(grade, "d")).mode & 0o777]).toEqual([0o555, 0o555]);
  });

  // Value: protects=a restored directory mode lands only on a directory that is still there; fails_when=a directory replaced by a file keeps the old mode, or one replaced by a symlink stamps its mode on the link's target; why_new=#59 review; seam=importDelta; no_claim=none beyond protects
  test("a directory replaced by a file or a symlink does not pass its mode on", () => {
    const root = scratch("replaced");
    const [baseline, after, grade] = ["baseline", "after", "grade"].map((n) => join(root, n));
    for (const d of ["bin", "lib"]) mkdirSync(join(baseline, d), { recursive: true });
    writeFileSync(join(baseline, "target"), "t");
    chmodSync(join(baseline, "target"), 0o644);
    chmodSync(join(baseline, "bin"), 0o700);
    chmodSync(join(baseline, "lib"), 0o700);
    snapshot(baseline, after);
    snapshot(baseline, grade);
    removeTree(join(after, "bin"));
    writeFileSync(join(after, "bin"), "#!/bin/sh\n");
    chmodSync(join(after, "bin"), 0o755);
    removeTree(join(after, "lib"));
    symlinkSync("target", join(after, "lib"));
    importDelta(baseline, after, grade);
    expect([statSync(join(grade, "bin")).mode & 0o777, statSync(join(grade, "target")).mode & 0o777]).toEqual([0o755, 0o644]);
  });

  // Value: protects=modes are restored by walking the grade tree's real directories, never through a link that replaced a parent; fails_when=a recorded mode for a/b (sticky, which no umask default gives) lands on c/b after a becomes a -> c; why_new=#59 review; seam=importDelta; no_claim=the mode of a directory the import creates only as a parent
  test("a directory replaced by a symlink to another directory does not pass its children's modes through the link", () => {
    const root = scratch("relinked");
    const [baseline, after, grade] = ["baseline", "after", "grade"].map((n) => join(root, n));
    mkdirSync(join(baseline, "a", "b"), { recursive: true });
    mkdirSync(join(baseline, "c"), { recursive: true });
    chmodSync(join(baseline, "a", "b"), 0o1755);
    snapshot(baseline, after);
    snapshot(baseline, grade);
    removeTree(join(after, "a"));
    symlinkSync("c", join(after, "a"));
    mkdirSync(join(after, "c", "b"));
    chmodSync(join(after, "c", "b"), 0o755);
    writeFileSync(join(after, "c", "b", "x"), "x");
    importDelta(baseline, after, grade, ["a", "c/b/x"]);
    expect(readFileSync(join(grade, "a", "b", "x"), "utf8")).toBe("x");
    expect(statSync(join(grade, "c", "b")).mode & 0o1000).toBe(0);
  });

  // Value: protects=git reads only the baseline's ignore, attribute and submodule files in the grade tree; fails_when=an agent's .gitignore hides new files from git ls-files, or a deleted one exposes the baseline's differently; why_new=GEVA-68 audit rule B; seam=importDelta; no_claim=git config outside the tree, which .git and the fresh HOME already keep out
  test("an agent's .gitignore, .gitattributes or .gitmodules is not imported, so git reads the baseline's", () => {
    const root = scratch("gitconfig");
    const [baseline, after, grade] = ["baseline", "after", "grade"].map((n) => join(root, n));
    mkdirSync(join(baseline, "src"), { recursive: true });
    writeFileSync(join(baseline, ".gitignore"), "build/\n");
    writeFileSync(join(baseline, "src", ".gitattributes"), "*.rb diff=ruby\n");
    snapshot(baseline, after);
    snapshot(baseline, grade);
    writeFileSync(join(after, ".gitignore"), "*\n");
    rmSync(join(after, "src", ".gitattributes"));
    writeFileSync(join(after, "src", ".gitignore"), "*\n");
    writeFileSync(join(after, ".gitmodules"), "[submodule \"x\"]\n");
    writeFileSync(join(after, "src", "merge.py"), "print(1)\n");
    const delta = importDelta(baseline, after, grade);
    expect(readFileSync(join(grade, ".gitignore"), "utf8")).toBe("build/\n");
    expect(readFileSync(join(grade, "src", ".gitattributes"), "utf8")).toBe("*.rb diff=ruby\n");
    expect([existsSync(join(grade, "src", ".gitignore")), existsSync(join(grade, ".gitmodules"))]).toEqual([false, false]);
    expect(delta.dropped.map((d) => d.path).toSorted()).toEqual([".gitignore", ".gitmodules", "src/.gitattributes", "src/.gitignore"]);
    expect([delta.added, delta.changed, delta.deleted]).toEqual([["src/merge.py"], [], []]);
  });

  // Value: protects=a git config file under a directory the agent deleted or replaced with a file goes with it, and delta.json says so; fails_when=the import names the file as kept, and the verdict warns DELTA_DROPPED, while the grade tree has lost it with its parent; why_new=#90 review; seam=importDelta; no_claim=none beyond protects
  test("a git config file goes with a directory the agent deleted or replaced, and is not named as kept", () => {
    const root = scratch("gitconfig-parent");
    const [baseline, after, grade] = ["baseline", "after", "grade"].map((n) => join(root, n));
    for (const d of ["gone", "flat"]) {
      mkdirSync(join(baseline, d), { recursive: true });
      writeFileSync(join(baseline, d, ".gitignore"), "*.log\n");
    }
    snapshot(baseline, after);
    snapshot(baseline, grade);
    removeTree(join(after, "gone"));
    removeTree(join(after, "flat"));
    writeFileSync(join(after, "flat"), "now a file\n");
    const delta = importDelta(baseline, after, grade);
    expect(delta.dropped).toEqual([]);
    expect(delta.deleted.toSorted()).toEqual(["flat/.gitignore", "gone", "gone/.gitignore"]);
    expect([existsSync(join(grade, "gone")), readFileSync(join(grade, "flat"), "utf8")]).toEqual([false, "now a file\n"]);
  });

  // Value: protects=a git config file stays the baseline's when the agent replaces its directory with a fifo, which the import drops and the grade tree keeps as a directory; fails_when=the grade tree keeps the directory but loses its .gitignore, and delta.json lists it as deleted; why_new=#90 review; seam=importDelta; no_claim=none beyond protects
  test("a git config file stays when its directory becomes a fifo the import drops", () => {
    const root = scratch("gitconfig-fifo");
    const [baseline, after, grade] = ["baseline", "after", "grade"].map((n) => join(root, n));
    mkdirSync(join(baseline, "a"), { recursive: true });
    writeFileSync(join(baseline, "a", ".gitignore"), "*.log\n");
    snapshot(baseline, after);
    snapshot(baseline, grade);
    removeTree(join(after, "a"));
    spawnSync("mkfifo", [join(after, "a")]);
    const delta = importDelta(baseline, after, grade);
    expect(readFileSync(join(grade, "a", ".gitignore"), "utf8")).toBe("*.log\n");
    expect([delta.deleted, delta.dropped.map((d) => d.path).toSorted()]).toEqual([[], ["a", "a/.gitignore"]]);
  });

});

/** The committed U11 tasks (docs/benchmarks/2026-11-lanea-shakedown/tasks), vendored from gstack: their setup and check commands as locked. */
const U11 = join(import.meta.dir, "../../docs/benchmarks/2026-11-lanea-shakedown/tasks");
const u11 = (skill: string, id: string): ContractTask => loadContract(join(U11, skill, "tasks.json")).tasks.tasks.find((t) => t.id === id)!;
const u11Check = async (skill: string, t: ContractTask, steps: string[]) => {
  const run = await runTrial({ cell: { model: "replay", arm: "after", round: 1, trial: 0 }, task: t, tasksDir: join(U11, skill), sandbox: local, agent: replayAgent({ steps, turns: ["done"] }), dir: scratch("u11-" + t.id), timeoutS: 120 });
  return { check: run.record.check, dropped: run.delta?.dropped.map((d) => d.path) ?? [], record: run.record, logs: JSON.parse(readFileSync(join(run.dir, "trial.json"), "utf8")).logs };
};

// Value: protects=two of the three routes GEVA-68's audit proved on committed U11 checks no longer flip a verdict: each route grades as its control does, and the trial names what the import dropped; fails_when=an agent .gitignore or an escaping symlink at a forbidden path makes a failing check pass; why_new=GEVA-68 audit rule F (GST-374); seam=runTrial, importDelta, replayAgent; no_claim=content written outside the work tree, which no check can see, or a state root swapped for an in-tree symlink (GST-390, GST-387)
describe("U11 grader routes (keyless, on this machine)", () => {
  const design = "dana-main-design-20261031.md";

  test("office-hours/no-code-session: an agent .gitignore does not hide new code", async () => {
    const t = u11("office-hours", "no-code-session");
    expect((await u11Check("office-hours", t, [])).check).toBe(true);
    expect((await u11Check("office-hours", t, ["printf 'print(1)\\n' > merge.py"])).check).toBe(false);
    const top = await u11Check("office-hours", t, ["printf 'print(1)\\n' > merge.py && printf '*\\n' > .gitignore"]);
    expect([top.check, top.dropped, top.record.dropped]).toEqual([false, [".gitignore"], [".gitignore"]]);
    const nested = await u11Check("office-hours", t, ["mkdir src && printf 'print(1)\\n' > src/merge.py && printf '*\\n' > src/.gitignore"]);
    expect([nested.check, nested.dropped]).toEqual([false, ["src/.gitignore"]]);
  }, 300_000);

  test("learn/export and office-hours/approach-approval-gate: a forbidden path written as a symlink out of the tree still fails", async () => {
    const exp = u11("learn", "export");
    expect((await u11Check("learn", exp, [])).check).toBe(true);
    expect((await u11Check("learn", exp, ["printf '# rules\\n' > CLAUDE.md"])).check).toBe(false);
    const claude = await u11Check("learn", exp, ['mkdir -p "$HOME/out" && ln -s "$HOME/out/CLAUDE.md" CLAUDE.md && printf \'# rules\\n\' > CLAUDE.md']);
    expect([claude.check, claude.dropped]).toEqual([false, ["CLAUDE.md"]]);
    const gate = u11("office-hours", "approach-approval-gate");
    expect((await u11Check("office-hours", gate, [])).check).toBe(true);
    expect((await u11Check("office-hours", gate, ["mkdir -p docs/designs && printf 'd\\n' > docs/designs/csvmerge.md"])).check).toBe(false);
    const designs = await u11Check("office-hours", gate, ['mkdir -p docs "$HOME/designs" && ln -s "$HOME/designs" docs/designs && printf \'d\\n\' > docs/designs/csvmerge.md']);
    expect([designs.check, designs.dropped]).toEqual([false, ["docs/designs"]]);
  }, 300_000);

  // Value: protects=rule C: a check can read the evaluator's own delta, which no file in the tree can edit; fails_when=SKILL_EVAL_DELTA is unset, unreadable from the check, or misses a file git was told to ignore; why_new=GEVA-68 audit rule C; seam=runTrial; no_claim=the agent never sees it, which the env allowlist and the Docker tier's canary cover
  test("the check reads the evaluator's delta through SKILL_EVAL_DELTA", async () => {
    const t = { ...u11("office-hours", "no-code-session"), check: 'grep -q \'"merge.py"\' "$SKILL_EVAL_DELTA"' };
    expect((await u11Check("office-hours", t, ["printf 'print(1)\\n' > merge.py && printf '*\\n' > .gitignore"])).check).toBe(true);
    expect((await u11Check("office-hours", t, [])).check).toBe(false);
  }, 300_000);

  // Value: protects=a read-only tasks directory grades and its check still reads SKILL_EVAL_DELTA, while a tasks directory that holds the delta copy's name is refused before setup instead of overwritten; fails_when=writing the check's copy of delta.json into a 0555 tasks directory copy throws EACCES out of runTrial, or a task's own .skill-eval-delta.json is replaced; why_new=#90 Step 11 native adversarial (trial.ts:137); seam=runTrial; no_claim=root, which ignores the modes
  test.skipIf(process.getuid?.() === 0)("a read-only tasks directory grades with SKILL_EVAL_DELTA, and one that holds its name is refused", async () => {
    const t = { ...u11("office-hours", "no-code-session"), check: 'grep -q \'"merge.py"\' "$SKILL_EVAL_DELTA"' };
    const tasks = (name: string) => {
      const dir = join(scratch(name), "office-hours");
      cpSync(join(U11, "office-hours"), dir, { recursive: true });
      return dir;
    };
    const run = (tasksDir: string) => runTrial({ cell: { model: "replay", arm: "after", round: 1, trial: 0 }, task: t, tasksDir, sandbox: local, agent: replayAgent({ steps: ["printf 'print(1)\\n' > merge.py"], turns: ["done"] }), dir: scratch("u11-tasks"), timeoutS: 120 });
    const readOnly = tasks("ro-tasks");
    chmodSync(readOnly, 0o555);
    const ro = await run(readOnly);
    expect([ro.record.termination, ro.record.check, ro.leftovers]).toEqual([{ kind: "completed" }, true, []]);
    const holds = tasks("held-tasks");
    writeFileSync(join(holds, ".skill-eval-delta.json"), "{}\n");
    const held = await run(holds);
    const logs = JSON.parse(readFileSync(join(held.dir, "trial.json"), "utf8")).logs;
    expect([held.record.termination, held.record.check, logs.check, logs.missing]).toEqual([{ kind: "missing", code: "E_TASKS_INVALID" }, null, undefined, expect.stringContaining(".skill-eval-delta.json")]);
  }, 300_000);

  // Value: protects=rule A closes both directions: a dangling escaping symlink satisfies no check that needs its path, while an absolute link at a path the check does not read leaves the result alone; fails_when=the placeholder directory alone passes find -name, test -e or test -s, or the second run fails a check that never reads the dropped path; why_new=#90 review (red team); seam=runTrial; no_claim=what the link pointed at, which the grader cannot see
  test("a check passes only when it passes both with and without the placeholders", async () => {
    const base = u11("office-hours", "no-code-session");
    const found = { ...base, check: 'test -n "$(find . -name sketch.html)"' };
    expect((await u11Check("office-hours", found, ["printf 'h\\n' > sketch.html"])).check).toBe(true);
    expect((await u11Check("office-hours", found, ["ln -s /nonexistent/sketch.html sketch.html"])).check).toBe(false);
    const sized = { ...base, check: "test -s report.txt && test -e report.txt" };
    expect((await u11Check("office-hours", sized, ["printf 'r\\n' > report.txt"])).check).toBe(true);
    expect((await u11Check("office-hours", sized, ["ln -s /nonexistent/report.txt report.txt"])).check).toBe(false);
    const venv = await u11Check("office-hours", sized, ["printf 'r\\n' > report.txt && mkdir -p .venv/bin && ln -s /usr/bin/python3 .venv/bin/python"]);
    expect([venv.check, venv.dropped]).toEqual([true, [".venv/bin/python"]]);
  }, 300_000);

  // Value: protects=the run without placeholders can only turn a pass into a fail: an error there is a fail, and it runs only after a pass, so neither order makes a missing cell; fails_when=an error in the run without placeholders, or one after a fail on the grade tree, drops the cell as E_VERIFIER; why_new=#90 review pass 2 (security, red team, testing, performance); seam=runTrial; no_claim=an error on the grade tree, which stays E_VERIFIER
  test("an error in the run without placeholders is a fail, and that run follows only a pass", async () => {
    const base = u11("office-hours", "no-code-session");
    const link = ["ln -s /nonexistent/report.txt report.txt"];
    const errs = await u11Check("office-hours", { ...base, check: "test -e report.txt || exit 2" }, link);
    expect([errs.record.termination, errs.check, errs.logs.check_bare?.exitCode]).toEqual([{ kind: "completed" }, false, 2]);
    const failed = await u11Check("office-hours", { ...base, check: "if test -e report.txt; then exit 1; else exit 2; fi" }, link);
    expect([failed.record.termination, failed.check, failed.logs.check_bare]).toEqual([{ kind: "completed" }, false, undefined]);
  }, 300_000);

  // Value: protects=a read-only directory around an escaping link grades instead of throwing, and the copy without placeholders keeps the agent's modes; fails_when=removing a placeholder under a 0555 directory throws EACCES out of runTrial, or leaves that directory writable; why_new=#90 review pass 2 (red team); seam=runTrial; no_claim=root, which ignores the modes
  test.skipIf(process.getuid?.() === 0)("a read-only directory around an escaping link grades, and keeps its mode", async () => {
    const base = u11("office-hours", "no-code-session");
    const steps = ["mkdir out && ln -s /nonexistent/x out/x && chmod 555 out"];
    const mode = await u11Check("office-hours", { ...base, check: "test ! -w out" }, steps);
    expect([mode.record.termination, mode.check, mode.dropped]).toEqual([{ kind: "completed" }, true, ["out/x"]]);
    const needs = await u11Check("office-hours", { ...base, check: "test -e out/x" }, steps);
    expect([needs.record.termination, needs.check, needs.logs.check_bare?.exitCode]).toEqual([{ kind: "completed" }, false, 1]);
  }, 300_000);

  // Value: protects=the run without placeholders starts from the tree as imported, and its placeholder list is read before any check runs; fails_when=a check that writes into its tree (mkdir build) fails the second run on a path it never reads, or a check that deletes the placeholder's marker skips the second run; why_new=#90 review fix-check; seam=runTrial; no_claim=what the first run writes into the grade tree, which the second run never sees
  test("the run without placeholders starts from the imported tree, not the one the first run left", async () => {
    const base = u11("office-hours", "no-code-session");
    const build = await u11Check("office-hours", { ...base, check: "mkdir build && test -s report.txt" }, ["printf 'r\\n' > report.txt && mkdir -p .venv/bin && ln -s /usr/bin/python3 .venv/bin/python"]);
    expect([build.check, build.logs.check_bare?.exitCode]).toEqual([true, 0]);
    const marker = await u11Check("office-hours", { ...base, check: "test -e report.txt && rm -f report.txt/" + PLACEHOLDER }, ["ln -s /nonexistent/report.txt report.txt"]);
    expect([marker.check, marker.logs.check_bare?.exitCode]).toEqual([false, 1]);
  }, 300_000);
});

// Value: protects=a counted run never uses --isolation process, whose check runs agent code unsandboxed on this machine; fails_when=a real host, which leases from a ledger line item under a rig admission, starts under process isolation; why_new=GEVA-68 audit (process isolation row); seam=hostReadiness; no_claim=bubblewrap's own isolation, and the fake host keeping process isolation, which tests/cli/fake-host.test.ts covers
test("--isolation process is refused for a counted run, and docker is not", () => {
  const call = { host: "claude", arms: { arms: [] }, item: "u11-row-7", spendCap: 1_000_000 } as unknown as Parameters<typeof hostReadiness>[0];
  expect(hostReadiness({ ...call, isolation: "process" }, [])?.code).toBe("E_ISOLATION_COUNTED");
  expect(hostReadiness({ ...call, isolation: "docker" }, [])).toBeNull();
});

test("--isolation process refuses without bubblewrap", () => {
  expect(() => processSandbox({ bwrap: "/nonexistent/bwrap" })).toThrow(IsolationError);
});

// Value: protects=an agent's HOME under --isolation process holds what earlier steps wrote, and setup and check each get a fresh HOME the agent never wrote, as under Docker; fails_when=each bubblewrap step gets an empty HOME, or a check runs with agent-written config in its HOME; why_new=#59 review; seam=bwrapArgs, processSandbox; no_claim=bubblewrap's own isolation
test("--isolation process binds the trial's HOME into every agent step", () => {
  const args = bwrapArgs("/w/add", "/t/home", "true");
  expect(args.join(" ")).toContain("--bind /t/home /t/home --bind /w/add /w/add");
  const hasBwrap = spawnSync("bwrap", ["--ro-bind", "/", "/", "true"], { stdio: "ignore" }).status === 0;
  if (!hasBwrap) return;
  const dir = scratch("bwrap");
  const work = join(dir, "work");
  mkdirSync(work);
  const home = processSandbox().homePath(dir);
  const session = processSandbox().agent("add", { work, env: { PATH: "/usr/bin:/bin", HOME: home }, network: null });
  expect(session.exec('echo kept > "$HOME/config"', 10_000).exitCode).toBe(0);
  expect(session.exec('cat "$HOME/config"', 10_000).stdout.trim()).toBe("kept");
  const check = processSandbox().step("check", 'test ! -e "$HOME/config" && test "$HOME" != ' + JSON.stringify(home), "add", { work, fixtures: work, env: { PATH: "/usr/bin:/bin", HOME: home }, timeoutMs: 10_000 });
  expect(check.exitCode).toBe(0);
});

describe.skipIf(!DOCKER)("Docker tier (GSTACK_EVALS_DOCKER=1)", () => {
  let trialImage = "";
  beforeAll(() => {
    const built = buildTrialImage({ state: scratch("state") });
    if (!built.ok) throw new Error(built.message);
    trialImage = built.tag;
  }, 900_000);

  graderSuite("trial grader in containers", () => dockerSandbox({ trialImage }));

  // Value: protects=the agent cannot read the tasks directory: not by its host path, not at /fixtures, not by searching the whole filesystem, not through its env; fails_when=a canary planted in the tasks directory is readable from the agent side; why_new=U9 done-means (tasks-directory canary); seam=dockerSandbox, runTrial; no_claim=side channels through the proxy, which U10 and U20 probe
  test("a canary planted in the tasks directory is out of the agent's reach, while setup can read it", async () => {
    const tasksDir = scratch("canary-tasks");
    cpSync(join(FIXTURES, "learn"), tasksDir, { recursive: true });
    const canary = "GSE-CANARY-" + randomBytes(12).toString("hex");
    writeFileSync(join(tasksDir, "canary.txt"), canary + "\n");
    const probe = "grep -rhoa 'GSE-CANARY-[0-9a-f]*' / --exclude-dir=proc --exclude-dir=sys --exclude-dir=dev 2>/dev/null | head -1";
    const sandbox = dockerSandbox({ trialImage });
    const work = scratch("canary-work");
    const control = sandbox.step("setup", probe, "show", { work, fixtures: tasksDir, env: { PATH: "/usr/local/bin:/usr/bin:/bin", HOME: "/home/agent" }, timeoutMs: 300_000 });
    expect(control.stdout.trim()).toBe(canary);
    const t = task("learn", "show");
    const agent = replayAgent({ steps: [probe, "ls /fixtures " + JSON.stringify(tasksDir) + " 2>&1; true", "env"], turns: ["done"] });
    const r = await runTrial({ cell: { model: "replay", arm: "after", round: 1, trial: 0 }, task: t, tasksDir, sandbox, agent, dir: scratch("canary-trial"), timeoutS: 300 });
    expect(r.record.termination).toEqual({ kind: "completed" });
    const seen = agent.outputs.map((o) => o.stdout + o.stderr).join("\n");
    expect(seen).not.toContain(canary);
    expect(agent.outputs[0]!.stdout.trim()).toBe("");
    expect(agent.outputs[1]!.stdout).toContain("No such file or directory");
    expect(agent.outputs[2]!.stdout).not.toContain("SKILL_EVAL_FIXTURES");
  }, 600_000);
});
