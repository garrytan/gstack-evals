import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "../../src/cli.ts";
import { skillEvalCommand } from "../../src/skill-eval/cli/skill-eval.ts";
import { collect, tree } from "./helpers.ts";

async function run(argv: string[], env: Record<string, string> = {}) {
  const io = collect();
  const code = await skillEvalCommand(argv, io, env);
  return { code, ...io.text() };
}

const SKILL = "---\nname: demo\ndescription: d\n---\n\n# Demo\n\nNEVER write code before the user approves.\n";

describe("gstack-evals skill-eval routing", () => {
  // Value: protects=diet.md's lock step reaches U5's --lock and init through skill-eval; fails_when=--lock or init stops routing; why_new=skill-eval had no module, so diet.md's step 6 exited not built yet; seam=U5's lockCommand and initCommand; no_claim=the lock's contents (tests/contract/lock-cli.test.ts)
  test("--lock and init route to U5's commands", async () => {
    const root = tree({ "demo/SKILL.md": SKILL, "test/fixtures/skill-evals/demo/tasks.json": JSON.stringify([{ id: "no-code", prompt: "Plan it.", check: "true", safety: true }]) });
    const tasks = join(root, "test/fixtures/skill-evals/demo/tasks.json");
    const lock = await run(["--lock", "--tasks", tasks]);
    expect(lock.code).toBe(0);
    expect(lock.out).toContain("LOCKED ");
    expect(existsSync(join(root, "test/fixtures/skill-evals/demo/tasks.lock.json"))).toBe(true);
    const init = await run(["init", "--skill", join(root, "demo"), "--out", join(root, "new-tasks.json")]);
    expect(init.code).toBe(0);
    expect(init.out).toContain("WROTE ");
  });

  // Value: protects=help prints the call and the flag table; a bad call exits 2 with E_USAGE on every stderr line; fails_when=help drops the table or an error line lacks its code; why_new=new; seam=none; no_claim=none beyond protects
  test("--help prints the call and every flag; a bad call is E_USAGE", async () => {
    const help = await run(["--help"]);
    expect(help.code).toBe(0);
    expect(help.out).toContain("gstack-evals skill-eval --arms before=<dir>,after=<dir>,none");
    expect(help.out).toContain("--no-noise-floor");
    const bad = await run(["--bogus"]);
    expect(bad.code).toBe(2);
    for (const line of bad.err.split("\n")) expect(line).toStartWith("E_USAGE ");
  });

  // Value: protects=a resolvable call prints its effective defaults, and a loose gstack folder stops with E_LOOSE_GSTACK and its fix; fails_when=the effective block or the code line is lost; why_new=new; seam=none; no_claim=the run itself, which U7's next pull requests build
  test("a call prints its effective defaults; a loose gstack folder is E_LOOSE_GSTACK", async () => {
    const loose = tree({ "SKILL.md": SKILL });
    const r = await run(["--arms", "before=" + loose + ",after=" + loose + ",none", "--tasks", join(loose, "tasks.json"), "--host", "claude", "--model", "claude-opus-5-5"]);
    expect(r.code).toBe(2);
    expect(r.out).toStartWith("effective:");
    expect(r.out).toContain("noise floor");
    const gstacky = tree({ "SKILL.md": SKILL + "Run ~/.claude/skills/gstack/bin/gstack-slug.\n" });
    const g = await run(["--arms", "before=" + gstacky + ",after=" + gstacky, "--tasks", join(gstacky, "tasks.json"), "--host", "claude", "--model", "claude-opus-5-5"], { HOME: "/nonexistent" });
    expect(g.code).toBe(2);
    expect(g.err).toContain("E_LOOSE_GSTACK fix: ");
    for (const line of g.err.split("\n")) expect(line).toStartWith("E_LOOSE_GSTACK ");
  });

  // Value: protects=the explain and skill-eval rows in bin/gstack-evals run their modules; fails_when=a row's module moves or lacks main; why_new=both rows printed not built yet; seam=src/cli.ts; no_claim=none beyond protects
  test("bin/gstack-evals runs explain and skill-eval", () => {
    const bin = join(REPO_ROOT, "bin", "gstack-evals");
    const explain = spawnSync(bin, ["explain", "E_LOOSE_GSTACK"], { encoding: "utf8" });
    expect(explain.status).toBe(0);
    expect(explain.stdout).toStartWith("E_LOOSE_GSTACK (exit 2, INCOMPLETE)");
    const help = spawnSync(bin, ["skill-eval", "--help"], { encoding: "utf8" });
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("Options:");
  });
});
