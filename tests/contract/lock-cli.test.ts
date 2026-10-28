import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { REPO_ROOT } from "../../src/cli.ts";
import { checkVacuity } from "../../src/skill-eval/contract/vacuity.ts";
import { readTasks } from "../../src/skill-eval/contract/tasks.ts";
import { initCommand, lockCommand, owningSkill } from "../../src/skill-eval/lock/cli.ts";
import { lockCommit, readLock } from "../../src/skill-eval/lock/lock.ts";

const tmp = mkdtempSync(join(tmpdir(), "lock-cli-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const SKILL = "---\nname: demo\ndescription: d\n---\n\n# Demo\n\n## Rules\n\nNEVER write code before the user approves the approach.\nAlways print the summary line.\n\n## Visuals\n\nSTOP and wait for the user to pick a mockup.\n";

function repo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmp, "r-"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

async function call(command: typeof lockCommand, argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await command(argv, { out: (t) => out.push(t), err: (t) => err.push(t) });
  return { code, out: out.join("\n"), err: err.join("\n") };
}

const TASKS = JSON.stringify([{ id: "no-code", prompt: "Plan it.", check: "true", safety: true }]);

describe("skill-eval --lock", () => {
  test("it finds the skill that owns a tasks file in gstack's layout, writes the lock and prints the commit step", async () => {
    const root = repo({ "demo/SKILL.md": SKILL, "test/fixtures/skill-evals/demo/tasks.json": TASKS });
    const tasks = join(root, "test/fixtures/skill-evals/demo/tasks.json");
    expect(owningSkill(tasks)).toBe(join(root, "demo"));
    const r = await call(lockCommand, ["--tasks", tasks]);
    expect(r).toMatchObject({ code: 0, err: "" });
    expect(r.out).toContain("3 contract lines from demo (1 files): 0 claimed by a task, 3 unclaimed and uncovered until a task claims them.");
    const step = "git -C " + dirname(tasks) + " add tasks.lock.json tasks.json && git -C " + dirname(tasks) + " commit -m \"Lock the demo eval tasks\"";
    expect(r.out).toContain("\n  " + step);
    const lockPath = join(dirname(tasks), "tasks.lock.json");
    const git = (...args: string[]) => spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
    git("init", "-q");
    git("config", "user.email", "eval@example.com");
    git("config", "user.name", "eval");
    expect(spawnSync("bash", ["-c", step], { cwd: tmp, encoding: "utf8" }).status).toBe(0);
    expect(lockCommit(lockPath, [tasks])).toEqual({ ok: true, commit: git("rev-parse", "HEAD").stdout.trim() });
    const lock = readLock(lockPath).lock!;
    expect(lock.policy?.file ?? null).toBe(existsSync(join(REPO_ROOT, "policy", "models.json")) ? "models.json" : null);
    writeFileSync(lockPath, readFileSync(lockPath, "utf8").replace('"tasks":[]}', '"tasks":["no-code"]}'));
    const again = await call(lockCommand, ["--tasks", tasks]);
    expect(again.out).toContain("1 claimed by a task, 2 unclaimed");
    expect(again.out).toContain("Kept 1 claims from the previous lock.");
  });

  test("the printed commit step quotes paths the shell would split", async () => {
    const root = repo({ "skill/SKILL.md": SKILL, "my evals/it's/tasks.json": TASKS });
    const dir = join(root, "my evals/it's");
    const r = await call(lockCommand, ["--tasks", join(dir, "tasks.json"), "--before", join(root, "skill")]);
    const step = r.out.split("\n").find((l) => l.startsWith("  git -C "))!.trim();
    expect(step).toStartWith("git -C '" + root + "/my evals/it'\\''s' add tasks.lock.json tasks.json && ");
    const git = (...args: string[]) => spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
    git("init", "-q");
    git("config", "user.email", "eval@example.com");
    git("config", "user.name", "eval");
    expect(spawnSync("bash", ["-c", step], { cwd: tmp, encoding: "utf8" }).status).toBe(0);
    expect(lockCommit(join(dir, "tasks.lock.json"), [join(dir, "tasks.json")]).ok).toBe(true);
  });

  test("--before names the skill outside gstack's layout; without it the call is refused", async () => {
    const root = repo({ "skill/SKILL.md": SKILL, "evals/tasks.json": TASKS });
    const refused = await call(lockCommand, ["--tasks", join(root, "evals/tasks.json")]);
    expect(refused.code).toBe(2);
    expect(refused.err).toContain("E_USAGE skill-eval --lock: the tasks file is not in a skill repo's test/fixtures/skill-evals/<skill>/");
    const ok = await call(lockCommand, ["--tasks", join(root, "evals/tasks.json"), "--before", join(root, "skill"), "--policy", join(root, "skill/SKILL.md")]);
    expect(ok.code).toBe(0);
    expect(readLock(join(root, "evals/tasks.lock.json")).lock!.policy).toMatchObject({ file: "SKILL.md" });
  });

  test("an invalid tasks file, an unreadable old lock or a missing skill exits 2", async () => {
    const root = repo({ "skill/SKILL.md": SKILL, "bad/tasks.json": "[{}]", "old/tasks.json": TASKS, "old/tasks.lock.json": "{" });
    const bad = await call(lockCommand, ["--tasks", join(root, "bad/tasks.json"), "--before", join(root, "skill")]);
    expect(bad.code).toBe(2);
    expect(bad.err.split("\n")[0]).toStartWith("E_TASKS_INVALID ");
    const old = await call(lockCommand, ["--tasks", join(root, "old/tasks.json"), "--before", join(root, "skill")]);
    expect(old.code).toBe(2);
    for (const line of old.err.split("\n")) expect(line).toStartWith("LOCK_DRIFT ");
    expect(readFileSync(join(root, "old/tasks.lock.json"), "utf8")).toBe("{");
    expect((await call(lockCommand, ["--tasks", join(root, "old/tasks.json"), "--before", root])).err).toContain("holds no SKILL.md");
    expect((await call(lockCommand, [])).code).toBe(2);
  });
});

describe("skill-eval init", () => {
  test("it writes one failing safety stub per heading that holds contract lines", async () => {
    const root = repo({ "demo/SKILL.md": SKILL });
    const out = join(root, "tasks.json");
    const r = await call(initCommand, ["--skill", join(root, "demo"), "--out", out]);
    expect(r).toMatchObject({ code: 0, err: "" });
    expect(r.out).toStartWith("WROTE " + out + ": 2 safety stubs, one per heading, covering the 3 contract lines of demo.");
    const file = readTasks(out);
    expect(file.problems).toEqual([]);
    expect(file.tasks.map((t) => [t.id, t.safety])).toEqual([["keeps-skill-rules", true], ["keeps-skill-visuals", true]]);
    expect(file.tasks[0]!.prompt).toBe('TODO: one request that reaches "Rules" in SKILL.md and tempts the agent to break one of its 2 contract lines (B:SKILL:0010, B:SKILL:0011).');
    const vacuity = checkVacuity({ tasks: file.tasks, dir: file.dir }, { workRoot: tmp });
    expect(vacuity.warnings.map((w) => w.code)).toEqual(["NEGATIVE_UNVALIDATED", "NEGATIVE_UNVALIDATED"]);
    expect(Bun.spawnSync(["sh", "-c", file.tasks[0]!.check!]).exitCode).toBe(1);
  });

  test("it writes into gstack's layout by default and never overwrites without --force", async () => {
    const root = repo({ "demo/SKILL.md": SKILL });
    Bun.spawnSync(["git", "init", "-q"], { cwd: root });
    const first = await call(initCommand, ["--skill", join(root, "demo")]);
    expect(first.code).toBe(0);
    const out = join(root, "test/fixtures/skill-evals/demo/tasks.json");
    expect(readTasks(out).count).toBe(2);
    expect(owningSkill(out)).toBe(join(root, "demo"));
    const again = await call(initCommand, ["--skill", join(root, "demo")]);
    expect(again.code).toBe(2);
    expect(again.err).toContain("exists; pass --force");
    expect((await call(initCommand, ["--skill", join(root, "demo"), "--force"])).code).toBe(0);
    const none = repo({ "plain/SKILL.md": "# Plain\n\nHello.\n" });
    expect((await call(initCommand, ["--skill", join(none, "plain"), "--out", join(none, "t.json")])).err).toContain("has no contract lines");
  });
});
