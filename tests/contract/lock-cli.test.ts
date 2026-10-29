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
    const step = "git -C " + dirname(tasks) + " add tasks.lock.json tasks.json && git -C " + dirname(tasks) + " commit -m 'Lock the demo eval tasks'";
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

  test("the printed commit message is shell-quoted, so a skill folder name cannot run a command", async () => {
    const name = "x$(echo INJECTED)`echo TICK`";
    const root = repo({ [name + "/SKILL.md"]: SKILL, "ev/tasks.json": TASKS });
    const r = await call(lockCommand, ["--tasks", join(root, "ev/tasks.json"), "--before", join(root, name)]);
    const step = r.out.split("\n").find((l) => l.startsWith("  git -C "))!.trim();
    expect(step).toEndWith(" commit -m 'Lock the " + name + " eval tasks'");
    const git = (...args: string[]) => spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
    git("init", "-q");
    git("config", "user.email", "eval@example.com");
    git("config", "user.name", "eval");
    expect(spawnSync("bash", ["-c", step], { cwd: tmp, encoding: "utf8" }).status).toBe(0);
    expect(git("log", "-1", "--format=%s").stdout.trim()).toBe("Lock the " + name + " eval tasks");
  });

  test("init's printed next commands quote the tasks path, so a skill folder name cannot run a command", async () => {
    const name = "x$(echo INJECTED)`echo TICK`";
    const root = repo({ [name + "/SKILL.md"]: SKILL });
    const out = join(root, "ev", name, "tasks.json");
    const r = await call(initCommand, ["--skill", join(root, name), "--out", out]);
    expect(r.code).toBe(0);
    const next = r.out.split("\n").find((l) => l.startsWith("Next: "))!;
    const arg = next.slice(next.indexOf("--lock --tasks ") + "--lock --tasks ".length, next.lastIndexOf(", and commit"));
    expect(spawnSync("bash", ["-c", "printf '%s' " + arg], { encoding: "utf8" }).stdout).toBe(out);
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

describe("skill-eval coverage gaps found by the /ship audit", () => {
  // Generated by gstack /ship Step 7 coverage audit (pass 1).
  // Value: protects=a relock prints which claims it dropped because their task left the tasks file; fails_when=the dropped clause is removed
  // or prints the wrong count or ids; why_new=lock.test.ts checks buildLock's dropped list, no test reads the CLI line; seam=none;
  // no_claim=none beyond protects
  test("a relock names the claims it dropped because their task left the tasks file", async () => {
    const root = repo({ "skill/SKILL.md": SKILL, "ev/tasks.json": TASKS });
    const tasks = join(root, "ev/tasks.json");
    const lockPath = join(root, "ev/tasks.lock.json");
    expect((await call(lockCommand, ["--tasks", tasks, "--before", join(root, "skill")])).code).toBe(0);
    writeFileSync(lockPath, readFileSync(lockPath, "utf8").replace('"tasks":[]}', '"tasks":["no-code"]}'));
    writeFileSync(tasks, JSON.stringify([{ id: "other", prompt: "Plan it.", check: "true", safety: true }]));
    const again = await call(lockCommand, ["--tasks", tasks, "--before", join(root, "skill")]);
    expect(again.code).toBe(0);
    expect(again.out).toContain("Kept 0 claims from the previous lock; dropped 1 whose task left the tasks file: B:SKILL:0010 no-code.");
    expect(readLock(lockPath).lock!.lines.every((l) => l.tasks.length === 0)).toBe(true);
  });

  // Generated by gstack /ship Step 7 coverage audit (pass 1).
  // Value: protects=with --ext the printed commit step adds tasks.ext.json, so running it commits every file the lock pins; fails_when=the
  // ext path drops out of the add list or the LOCKED line; why_new=no lock-cli test passes --ext; seam=none;
  // no_claim=a sidecar with one timeout entry stands in for a real one
  test("with --ext the printed commit step adds the sidecar, so a paid run finds every pinned file committed", async () => {
    const root = repo({ "skill/SKILL.md": SKILL, "ev/tasks.json": TASKS, "ev/tasks.ext.json": JSON.stringify({ schema_version: 1, tasks: { "no-code": { timeout_s: 60 } } }) });
    const dir = join(root, "ev");
    const r = await call(lockCommand, ["--tasks", join(dir, "tasks.json"), "--ext", join(dir, "tasks.ext.json"), "--before", join(root, "skill")]);
    expect(r).toMatchObject({ code: 0, err: "" });
    expect(r.out).toMatch(/^LOCKED .*, ext [0-9a-f]{12}, policy /);
    const step = r.out.split("\n").find((l) => l.startsWith("  git -C "))!.trim();
    expect(step).toStartWith("git -C " + dir + " add tasks.lock.json tasks.json tasks.ext.json && ");
    const git = (...args: string[]) => spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
    git("init", "-q");
    git("config", "user.email", "eval@example.com");
    git("config", "user.name", "eval");
    expect(spawnSync("bash", ["-c", step], { cwd: tmp, encoding: "utf8" }).status).toBe(0);
    expect(lockCommit(join(dir, "tasks.lock.json"), [join(dir, "tasks.json"), join(dir, "tasks.ext.json")]).ok).toBe(true);
  });

  // Generated by gstack /ship Step 7 coverage audit (pass 1).
  // Value: protects=--policy naming a missing file is refused with E_USAGE and writes no lock; fails_when=the existence check goes and the
  // lock pins no policy or the command throws; why_new=no test passes a missing --policy; seam=none; no_claim=none beyond protects
  test("a --policy path that does not exist exits 2 and writes no lock", async () => {
    const root = repo({ "skill/SKILL.md": SKILL, "ev/tasks.json": TASKS });
    const r = await call(lockCommand, ["--tasks", join(root, "ev/tasks.json"), "--before", join(root, "skill"), "--policy", join(root, "missing.json")]);
    expect(r.code).toBe(2);
    expect(r.err.split("\n")[0]).toBe("E_USAGE skill-eval --lock: no policy file at " + join(root, "missing.json"));
    expect(existsSync(join(root, "ev/tasks.lock.json"))).toBe(false);
  });

  // Generated by gstack /ship Step 7 coverage audit (pass 1).
  // Value: protects=init on a folder with no SKILL.md is refused with E_USAGE and writes nothing; fails_when=the SKILL.md guard is removed
  // and init writes an empty or partial tasks file; why_new=init tests only use folders that hold SKILL.md; seam=none;
  // no_claim=none beyond protects
  test("init on a folder without SKILL.md exits 2 and writes no tasks file", async () => {
    const root = repo({ "notes/README.md": "NEVER do this.\n" });
    const out = join(root, "tasks.json");
    const r = await call(initCommand, ["--skill", join(root, "notes"), "--out", out]);
    expect(r.code).toBe(2);
    expect(r.err.split("\n")[0]).toBe("E_USAGE skill-eval init: " + join(root, "notes") + " holds no SKILL.md");
    expect(existsSync(out)).toBe(false);
  });

  // Generated by gstack /ship Step 7 coverage audit (pass 1).
  // Value: protects=init stubs lines above any heading, gives colliding stub ids a -2 suffix, and clips the id list after 3; fails_when=ids
  // collide into one invalid tasks file, the top-of-file wording breaks, or the list stops clipping; why_new=the init test has 2 headings,
  // 2 lines each at most, no collision; seam=none; no_claim=none beyond protects
  test("init stubs lines above any heading, suffixes colliding ids and clips long id lists", async () => {
    const skill = "---\nname: demo\ndescription: d\n---\n\nNEVER push to main.\n\n## Rules\n\nNEVER write code first.\nNEVER skip tests.\nNEVER merge.\nAlways print the summary line.\n";
    const root = repo({ "demo/SKILL.md": skill, "demo/sections/skill.md": "## Rules\n\nSTOP and wait for the user.\n" });
    const out = join(root, "tasks.json");
    const r = await call(initCommand, ["--skill", join(root, "demo"), "--out", out]);
    expect(r).toMatchObject({ code: 0, err: "" });
    const file = readTasks(out);
    expect(file.problems).toEqual([]);
    expect(file.tasks.map((t) => t.id)).toEqual(["keeps-skill", "keeps-skill-rules", "keeps-skill-rules-2"]);
    expect(file.tasks[0]!.prompt).toContain("reaches the top of SKILL.md and tempts the agent to break one of its 1 contract lines (B:SKILL:0006).");
    expect(file.tasks[1]!.prompt).toEndWith("one of its 4 contract lines (B:SKILL:0010, B:SKILL:0011, B:SKILL:0012, ...).");
  });
  // Generated by gstack /ship Step 7 coverage audit (pass 2).
  // Value: protects=a tasks file in gstack's layout whose skill folder lacks SKILL.md is refused and writes no lock; fails_when=owningSkill
  // drops its SKILL.md check and --lock reads a non-skill folder; why_new=layout tests always create SKILL.md; seam=none;
  // no_claim=none beyond protects
  test("a tasks file in gstack's layout whose skill folder holds no SKILL.md needs --before", async () => {
    const root = repo({ "demo/README.md": "NEVER do this.\n", "test/fixtures/skill-evals/demo/tasks.json": TASKS });
    const tasks = join(root, "test/fixtures/skill-evals/demo/tasks.json");
    expect(owningSkill(tasks)).toBeNull();
    const r = await call(lockCommand, ["--tasks", tasks]);
    expect(r.code).toBe(2);
    expect(r.err.split("\n")[0]).toStartWith("E_USAGE skill-eval --lock: the tasks file is not in a skill repo's test/fixtures/skill-evals/<skill>/");
    expect(existsSync(join(dirname(tasks), "tasks.lock.json"))).toBe(false);
  });

  // Generated by gstack /ship Step 7 coverage audit (pass 2).
  // Value: protects=--lock refuses an unknown or repeated flag with E_USAGE and --help prints usage with exit 0; fails_when=a typo flag is
  // ignored and a lock is written, or --help errors; why_new=no test passes a bad flag or --help to --lock; seam=none; no_claim=none beyond protects
  test("--lock refuses unknown and repeated flags, and --help prints its usage", async () => {
    const root = repo({ "skill/SKILL.md": SKILL, "ev/tasks.json": TASKS });
    const tasks = join(root, "ev/tasks.json");
    const unknown = await call(lockCommand, ["--tasks", tasks, "--befor", join(root, "skill")]);
    expect(unknown.code).toBe(2);
    expect(unknown.err.split("\n")[0]).toBe('E_USAGE skill-eval --lock: unknown argument "--befor"');
    const twice = await call(lockCommand, ["--tasks", tasks, "--tasks", tasks, "--before", join(root, "skill")]);
    expect(twice.code).toBe(2);
    expect(twice.err.split("\n")[0]).toBe("E_USAGE skill-eval --lock: --tasks given twice");
    expect(existsSync(join(root, "ev/tasks.lock.json"))).toBe(false);
    const help = await call(lockCommand, ["--help"]);
    expect(help).toMatchObject({ code: 0, err: "" });
    expect(help.out).toStartWith("Usage: gstack-evals skill-eval --lock --tasks <tasks.json>");
  });

  // Generated by gstack /ship Step 7 coverage audit (pass 2).
  // Value: protects=an invalid sibling tasks.ext.json stops --lock with E_TASKS_INVALID naming the sidecar, and no lock is written;
  // fails_when=ext problems are dropped from ok or the message names the tasks file; why_new=the invalid-input test breaks only tasks.json;
  // seam=none; no_claim=none beyond protects
  test("an invalid tasks.ext.json beside the tasks file exits 2 naming the sidecar and writes no lock", async () => {
    const root = repo({ "skill/SKILL.md": SKILL, "ev/tasks.json": TASKS, "ev/tasks.ext.json": JSON.stringify({ schema_version: 1, tasks: { ghost: { timeout_s: 60 } } }) });
    const r = await call(lockCommand, ["--tasks", join(root, "ev/tasks.json"), "--before", join(root, "skill")]);
    expect(r.code).toBe(2);
    expect(r.err.split("\n")[0]).toStartWith("E_TASKS_INVALID " + join(root, "ev/tasks.ext.json") + ": ");
    expect(existsSync(join(root, "ev/tasks.lock.json"))).toBe(false);
  });

  // Generated by gstack /ship Step 7 coverage audit (pass 2).
  // Value: protects=init refuses an unknown flag and a missing --skill with E_USAGE, and --help prints usage with exit 0; fails_when=init
  // ignores a typo flag or runs without --skill; why_new=init tests pass only valid flags; seam=none; no_claim=none beyond protects
  test("init refuses an unknown flag and a missing --skill, and --help prints its usage", async () => {
    const unknown = await call(initCommand, ["--skil", tmp]);
    expect(unknown.code).toBe(2);
    expect(unknown.err.split("\n")[0]).toBe('E_USAGE skill-eval init: unknown argument "--skil"');
    const missing = await call(initCommand, ["--force"]);
    expect(missing.code).toBe(2);
    expect(missing.err.split("\n")[0]).toBe("E_USAGE skill-eval init: --skill is required");
    const help = await call(initCommand, ["-h"]);
    expect(help).toMatchObject({ code: 0, err: "" });
    expect(help.out).toBe("Usage: gstack-evals skill-eval init --skill <dir> [--out <tasks.json>] [--force]");
  });

  // Generated by gstack /ship Step 7 coverage audit (pass 2).
  // Value: protects=init outside a git repo writes ./tasks.json in the working directory; fails_when=the fallback path changes or init
  // writes beside the skill; why_new=default-out test runs inside git init; seam=none; no_claim=assumes the OS temp dir is not inside a git repo
  test("init outside a git repo writes tasks.json in the working directory", () => {
    const root = repo({ "demo/SKILL.md": SKILL, "cwd/.keep": "" });
    const cwd = join(root, "cwd");
    expect(spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: join(root, "demo"), encoding: "utf8" }).status).not.toBe(0);
    const script = "import { initCommand } from " + JSON.stringify(join(REPO_ROOT, "src/skill-eval/lock/cli.ts")) + "; process.exit(await initCommand(['--skill', " + JSON.stringify(join(root, "demo")) + "]));";
    const r = spawnSync(process.execPath, ["-e", script], { cwd, encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout).toStartWith("WROTE tasks.json: 2 safety stubs");
    expect(readTasks(join(cwd, "tasks.json")).count).toBe(2);
    expect(existsSync(join(root, "demo/tasks.json"))).toBe(false);
  });
});
