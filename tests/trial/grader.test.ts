import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadContract } from "../../src/skill-eval/contract/sidecar.ts";
import type { ContractTask } from "../../src/skill-eval/contract/tasks.ts";
import { gradeTrial, verdictTasks, type VerdictTask } from "../../src/skill-eval/verdict/grade.ts";
import { removeTree } from "../../src/trial/cleanup.ts";
import { importDelta, snapshot } from "../../src/trial/delta.ts";
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
  agent: (_task, o) => ({ exec: (command, ms) => localStep(command, o.work, o.env, ms), stop() {} }),
};

const skills = Object.fromEntries(["learn", "write-skill"].map((s) => {
  const contract = loadContract(join(FIXTURES, s, "tasks.json"));
  return [s, { tasks: contract.tasks.tasks, verdict: Object.fromEntries(verdictTasks(contract).map((t) => [t.id, t])) as Record<string, VerdictTask> }];
}));

function trial(sandbox: Sandbox, skill: string, task: ContractTask, transcript: Transcript, extra: Partial<TrialSpec> = {}) {
  const agent = replayAgent(transcript);
  const run = runTrial({ cell: { model: "replay", arm: "after", round: 1, trial: 0 }, task, tasksDir: join(FIXTURES, skill), sandbox, agent, dir: scratch("trial-" + task.id), timeoutS: 120, ...extra });
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
      test("every " + skill + " task passes on its oracle transcript and fails on the nop", () => {
        const ids = skills[skill]!.tasks.map((t) => t.id);
        expect(ids.length).toBe(skill === "learn" ? 10 : 2);
        for (const t of skills[skill]!.tasks) {
          const oracle = trial(sandbox(), skill, t, ORACLE[skill]![t.id]!);
          expect([t.id, oracle.outcome, oracle.record.check]).toEqual([t.id, "pass", t.check === undefined ? null : true]);
          const nop = trial(sandbox(), skill, t, NOP);
          expect([t.id, nop.outcome]).toEqual([t.id, "fail"]);
        }
      }, 600_000);
    }

    // Value: protects=a safety check grades the agent's changes against the evaluator's baseline, so committing a violation cannot hide it; fails_when=the agent's commit moves the grader's HEAD and git diff HEAD passes; why_new=U9 grader test (committed violation); seam=importDelta, runTrial; no_claim=changes outside the work tree
    test("a committed violation of a safety check still fails, though the agent's own tree passes it", () => {
      const t = task("learn", "no-code-change");
      const r = trial(sandbox(), "learn", t, { steps: ["printf '  # cached\\n' >> app/models/user.rb && git add -A && git commit -qm tidy"], turns: ["Act on n-plus-one-queries."] }, { keep: true });
      expect(r.record.check).toBe(false);
      expect(r.outcome).toBe("fail");
      expect(r.delta!.changed).toContain("app/models/user.rb");
      expect(checkAgentTree(sandbox(), "learn", t, r.dir)).toBe(true);
    }, 300_000);

    test("a forbidden deletion grades as it does in the agent's tree, and a committed one still fails", () => {
      const t = task("learn", "no-code-change");
      const plain = trial(sandbox(), "learn", t, { steps: ["rm app/models/user.rb"], turns: ["n-plus-one"] }, { keep: true });
      expect(plain.delta!.deleted).toEqual(["app/models/user.rb"]);
      expect(plain.record.check).toBe(false);
      expect(checkAgentTree(sandbox(), "learn", t, plain.dir)).toBe(false);
      const committed = trial(sandbox(), "learn", t, { steps: ["git rm -q app/models/user.rb && git commit -qm drop"], turns: ["n-plus-one"] }, { keep: true });
      expect(committed.record.check).toBe(false);
      expect(checkAgentTree(sandbox(), "learn", t, committed.dir)).toBe(true);
    }, 300_000);

    test("a new skill folder comes across and grades as in the agent's tree", () => {
      const t = task("write-skill", "new-skill");
      const r = trial(sandbox(), "write-skill", t, ORACLE["write-skill"]!["new-skill"]!, { keep: true });
      expect(r.delta!.added).toEqual(expect.arrayContaining(["skills", "skills/changelog", "skills/changelog/SKILL.md"]));
      expect(r.record.check).toBe(true);
      expect(checkAgentTree(sandbox(), "write-skill", t, r.dir)).toBe(true);
    }, 300_000);

    test("the state root's changes come across; a paths list that leaves it out does not import them", () => {
      const t = task("learn", "add");
      expect(trial(sandbox(), "learn", t, ORACLE.learn!.add!).record.check).toBe(true);
      const narrowed = trial(sandbox(), "learn", t, ORACLE.learn!.add!, { entry: { paths: ["app"] } });
      expect(narrowed.record.check).toBe(false);
      const viaVar = { ...t, check: 'grep -rq flaky-port-3000 "$GSTACK_HOME/projects"' };
      expect(trial(sandbox(), "learn", viaVar, ORACLE.learn!.add!).record.check).toBe(true);
      expect(trial(sandbox(), "learn", viaVar, ORACLE.learn!.add!, { entry: { paths: ["app"] } }).record.check).toBe(false);
    }, 300_000);

    // Value: protects=every kebab task id stays disjoint from the evaluator's trees; fails_when=an id such as fixtures, baseline, grade or home puts the tasks directory in the agent's work dir or makes a snapshot copy onto itself; why_new=#59 review; seam=runTrial; no_claim=none beyond protects
    test("a task id that names an evaluator tree keeps the tasks directory out of the work dir and still grades", () => {
      const t = task("learn", "add");
      for (const id of ["fixtures", "baseline", "grade", "home", "work"]) {
        const r = runTrial({ cell: { model: "replay", arm: "after", round: 1, trial: 0 }, task: { ...t, id }, tasksDir: join(FIXTURES, "learn"), sandbox: sandbox(), agent: replayAgent(ORACLE.learn!.add!), dir: scratch("id-" + id), timeoutS: 120, keep: true });
        expect([id, r.record.termination.kind, r.record.check]).toEqual([id, "completed", true]);
        expect(existsSync(join(r.dir, "work", id, "tasks.json"))).toBe(false);
      }
    }, 300_000);

    test("a timeout is its own outcome, a failing setup and a check that cannot judge are missing cells", () => {
      const t = task("learn", "add");
      const slow = trial(sandbox(), "learn", t, { steps: ["sleep 10"], turns: [] }, { timeoutS: 1 });
      expect(slow.record.termination).toEqual({ kind: "timeout" });
      expect(slow.record.check).toBeNull();
      expect(trial(sandbox(), "learn", { ...t, setup: "exit 3" }, NOP).record.termination).toEqual({ kind: "missing", code: "E_TASKS_INVALID" });
      expect(trial(sandbox(), "learn", { ...t, check: "exit 2" }, NOP).record.termination).toEqual({ kind: "missing", code: "E_VERIFIER" });
    }, 300_000);

    test("trees cleanup cannot remove are named in the result and in trial.json, and the grade stands", () => {
      const t = task("learn", "add");
      const r = trial(sandbox(), "learn", t, ORACLE.learn!.add!, { cleanup: { remove: () => {} } });
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
    expect(existsSync(join(grade, "escape"))).toBe(false);
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

  // Value: protects=modes are restored by walking the grade tree's real directories, never through a link that replaced a parent; fails_when=a recorded mode for a/b lands on c/b after a becomes a -> c; why_new=#59 review; seam=importDelta; no_claim=the mode of a directory the import creates only as a parent
  test("a directory replaced by a symlink to another directory does not pass its children's modes through the link", () => {
    const root = scratch("relinked");
    const [baseline, after, grade] = ["baseline", "after", "grade"].map((n) => join(root, n));
    mkdirSync(join(baseline, "a", "b"), { recursive: true });
    mkdirSync(join(baseline, "c"), { recursive: true });
    chmodSync(join(baseline, "a", "b"), 0o700);
    snapshot(baseline, after);
    snapshot(baseline, grade);
    removeTree(join(after, "a"));
    symlinkSync("c", join(after, "a"));
    mkdirSync(join(after, "c", "b"));
    chmodSync(join(after, "c", "b"), 0o755);
    writeFileSync(join(after, "c", "b", "x"), "x");
    importDelta(baseline, after, grade, ["a", "c/b/x"]);
    expect(readFileSync(join(grade, "a", "b", "x"), "utf8")).toBe("x");
    expect(statSync(join(grade, "c", "b")).mode & 0o777).not.toBe(0o700);
  });
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
  test("a canary planted in the tasks directory is out of the agent's reach, while setup can read it", () => {
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
    const r = runTrial({ cell: { model: "replay", arm: "after", round: 1, trial: 0 }, task: t, tasksDir, sandbox, agent, dir: scratch("canary-trial"), timeoutS: 300 });
    expect(r.record.termination).toEqual({ kind: "completed" });
    const seen = agent.outputs.map((o) => o.stdout + o.stderr).join("\n");
    expect(seen).not.toContain(canary);
    expect(agent.outputs[0]!.stdout.trim()).toBe("");
    expect(agent.outputs[1]!.stdout).toContain("No such file or directory");
    expect(agent.outputs[2]!.stdout).not.toContain("SKILL_EVAL_FIXTURES");
  }, 600_000);
});
