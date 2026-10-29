import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadContract } from "../../src/skill-eval/contract/sidecar.ts";
import { readSkillFiles } from "../../src/skill-eval/lock/contract-lines.ts";
import { lockCommand } from "../../src/skill-eval/lock/cli.ts";
import { buildLock, LockInputError, readLock } from "../../src/skill-eval/lock/lock.ts";
import { collect, tree } from "./helpers.ts";

const FRONT = "---\nname: demo\ndescription: d\n---\n\n# Demo\n\n";
const TASKS = [{ id: "no-code", prompt: "Plan it.", check: "true", safety: true }];

describe("buildLock's inputs (brief item 4)", () => {
  // Value: protects=buildLock refuses a tasks file or sidecar the contract refuses instead of pinning it; fails_when=buildLock locks a file with problems or an unread file; why_new=buildLock trusted its caller (GSTA-17's note on #18); seam=none; no_claim=lockCommand's own check, which ran first already
  test("it refuses a tasks file or a sidecar with problems", () => {
    const skill = readSkillFiles(tree({ "SKILL.md": FRONT + "NEVER guess.\n" }));
    const bad = tree({ "tasks.json": JSON.stringify([{ id: "Bad Id", prompt: "x", check: "true" }]) });
    const contract = loadContract(join(bad, "tasks.json"));
    const build = () => buildLock({ lockPath: join(bad, "tasks.lock.json"), tasks: contract.tasks, ext: contract.ext, policy: null, skillName: "demo", before: skill, previous: null });
    expect(build).toThrow(LockInputError);
    expect(build).toThrow("tasks file: Bad Id: id must be kebab-case");
    const ext = tree({ "tasks.json": JSON.stringify(TASKS), "tasks.ext.json": JSON.stringify({ schema_version: 1, tasks: { ghost: {} } }) });
    const withExt = loadContract(join(ext, "tasks.json"));
    expect(() => buildLock({ lockPath: join(ext, "tasks.lock.json"), tasks: withExt.tasks, ext: withExt.ext, policy: null, skillName: "demo", before: skill, previous: null })).toThrow("sidecar: ghost: no task with this id");
  });

  // Value: protects=a relock reports the claims it drops when a repeated line's copy count changes, instead of dropping them silently; fails_when=unmatched is empty or the CLI line is missing; why_new=claims fell away with no output (GSTA-17's note on #18); seam=none; no_claim=which copy a claim belongs to
  test("a relock names the claims it drops when a line's copies change in number", async () => {
    const two = FRONT + "STOP and wait for the user.\n\n## Later\n\nSTOP and wait for the user.\n";
    const root = tree({ "demo/SKILL.md": two, "test/fixtures/skill-evals/demo/tasks.json": JSON.stringify(TASKS) });
    const tasks = join(root, "test/fixtures/skill-evals/demo/tasks.json");
    const lockPath = join(root, "test/fixtures/skill-evals/demo/tasks.lock.json");
    expect(await lockCommand(["--tasks", tasks], collect())).toBe(0);
    writeFileSync(lockPath, readFileSync(lockPath, "utf8").replaceAll('"tasks":[]}', '"tasks":["no-code"]}'));
    const claimed = readLock(lockPath).lock!.lines.filter((l) => l.tasks.length).map((l) => l.id);
    expect(claimed.length).toBe(2);
    writeFileSync(join(root, "demo/SKILL.md"), FRONT + "STOP and wait for the user.\n");
    const io = collect();
    expect(await lockCommand(["--tasks", tasks], io)).toBe(0);
    const out = io.text().out;
    expect(out).toContain("Dropped 2 claims on lines whose copies changed in number, so they could not follow their line: " + claimed.map((id) => id + " no-code (2 copies in the lock, 1 now)").join(", ") + ". Claim those lines again.");
    expect(readLock(lockPath).lock!.lines.every((l) => l.tasks.length === 0)).toBe(true);
  });
});
