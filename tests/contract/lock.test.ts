import { afterAll, describe, expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { REPO_ROOT } from "../../src/cli.ts";
import { loadContract } from "../../src/skill-eval/contract/sidecar.ts";
import { contractLines, lineFates, readSkillFiles } from "../../src/skill-eval/lock/contract-lines.ts";
import { buildLock, coverageGaps, lineCoverage, lockCommit, lockDrift, readLock, renderLock, uncoveredRemovals, writeLock, type Lock, type OldArmRun } from "../../src/skill-eval/lock/lock.ts";

const tmp = mkdtempSync(join(tmpdir(), "lock-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const FRONT = "---\nname: demo\ndescription: A demo skill.\n---\n\n# Demo\n\n## Rules\n\n";
const V1 = {
  "SKILL.md": FRONT + "NEVER write code before the user approves the approach.\nAsk the user which approach they want via AskUserQuestion.\nAlways print the summary line.\n\n## Visuals\n\nRead sections/visual.md when the idea has a UI.\n",
  "sections/visual.md": "# Visual step\n\nSTOP and wait for the user to pick a mockup variant.\n",
};
// The diet: the NEVER line moves out of SKILL.md, the summary line goes, the STOP line is reworded.
const V2 = {
  "SKILL.md": FRONT + "Ask the user which approach they want via AskUserQuestion.\n\nRead sections/rules.md first.\n",
  "sections/rules.md": "# Rules\n\nNEVER write code before the user approves the approach.\n",
  "sections/visual.md": "# Visual step\n\nSTOP and wait for the user to pick a mockup.\n",
};
const TASKS = [
  { id: "no-code", prompt: "Plan it with me.", check: "true", safety: true },
  { id: "asks-approach", prompt: "Which way should we go?", must: ["approach"] },
  { id: "summary", prompt: "Wrap up.", must: ["summary"] },
];

function tree(files: Record<string, string>, root = mkdtempSync(join(tmp, "t-"))): string {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

function lockFor(skill: Record<string, string>, tasks: unknown[] = TASKS, previous: Lock | null = null) {
  const dir = tree({ "tasks.json": JSON.stringify(tasks) });
  const contract = loadContract(join(dir, "tasks.json"));
  return { dir, contract, ...buildLock({ lockPath: join(dir, "tasks.lock.json"), tasks: contract.tasks, ext: contract.ext, policy: null, skillName: "demo", before: readSkillFiles(tree(skill)), previous }) };
}

const claim = (lock: Lock, claims: Record<string, string[]>): Lock => ({ ...lock, lines: lock.lines.map((l) => ({ ...l, tasks: claims[l.id] ?? l.tasks })) });

describe("contract lines", () => {
  test("lines, categories, ask categories and loads come from SKILL.md and its sections", () => {
    const { lock } = lockFor(V1);
    expect(lock.lines.map((l) => [l.id, l.categories.join(","), l.ask, l.load])).toEqual([
      ["B:SKILL:0010", "never,ask", "approach", "always"],
      ["B:SKILL:0011", "ask", "approach", "always"],
      ["B:SKILL:0012", "output", null, "always"],
      ["B:visual:0003", "stop,ask,output", "visual", "on-demand"],
    ]);
    expect(lock.lines.every((l) => l.tasks.length === 0)).toBe(true);
    expect(lock.skill.files.map((f) => f.path)).toEqual(["SKILL.md", "sections/visual.md"]);
    expect(lock.tasks.file).toBe("tasks.json");
  });

  test("an edited copy's treatment of each line: kept, moved, rewritten or removed", () => {
    const lines = contractLines(readSkillFiles(tree(V1)));
    expect(lineFates(lines, readSkillFiles(tree(V2))).map((f) => [f.id, f.class, f.match?.file])).toEqual([
      ["B:SKILL:0010", "moved", "sections/rules.md"],
      ["B:SKILL:0011", "kept", "SKILL.md"],
      ["B:SKILL:0012", "removed", expect.any(String)],
      ["B:visual:0003", "rewritten", "sections/visual.md"],
    ]);
  });
});

describe("tasks.lock.json", () => {
  test("it renders one line object per row, reads back unchanged and validates against the schema", () => {
    const { dir, lock } = lockFor(V1);
    const path = join(dir, "tasks.lock.json");
    writeLock(path, lock);
    const text = readFileSync(path, "utf8");
    expect(text).toBe(renderLock(lock));
    expect(text).toContain('\n    {"id":"B:SKILL:0010",');
    expect(readLock(path)).toEqual({ lock, problem: null });
    const schema = JSON.parse(readFileSync(join(REPO_ROOT, "schema", "tasks.schema.json"), "utf8"));
    const ajv = new Ajv2020({ strict: true, strictRequired: false, allowUnionTypes: true }).addSchema(schema);
    expect(ajv.validate(schema.$id + "#/$defs/lock", lock)).toBe(true);
    writeFileSync(path, "{}");
    expect(readLock(path).problem).toContain("is not a schema_version 1 tasks lock");
  });

  test("a relock keeps claims for unchanged lines and drops claims whose task is gone", () => {
    const first = claim(lockFor(V1).lock, { "B:SKILL:0010": ["no-code"], "B:SKILL:0012": ["summary"] });
    const shifted = { ...V1, "SKILL.md": V1["SKILL.md"].replace("## Rules\n\n", "## Rules\n\nSome context first.\n\n") };
    const again = lockFor(shifted, TASKS.slice(0, 2), first);
    expect(again.lock.lines.find((l) => l.text.startsWith("NEVER"))).toMatchObject({ id: "B:SKILL:0012", tasks: ["no-code"] });
    expect(again.carried).toBe(1);
    expect(again.dropped).toEqual(["B:SKILL:0014 summary"]);
  });

  test("drift names what changed since the lock", () => {
    const { lock, contract } = lockFor(V1);
    const before = readSkillFiles(tree(V1));
    expect(lockDrift(lock, { tasks: contract.tasks, ext: null, policySha256: null, before })).toEqual([]);
    const changed = lockFor(V1, [...TASKS, { id: "extra", prompt: "p", check: "true" }]).contract;
    const drift = lockDrift(lock, { tasks: changed.tasks, ext: { path: "x", sha256: "a".repeat(64), problems: [], sidecar: null }, policySha256: "b".repeat(64), before: readSkillFiles(tree(V2)) });
    expect(drift.map((d) => d.split(":")[0])).toEqual(["tasks file changed", "tasks.ext.json changed", "policy changed", "the before copy differs from the locked one"]);
    expect(drift[3]).toBe("the before copy differs from the locked one: SKILL.md changed or added, sections/rules.md changed or added, sections/visual.md changed or added");
    expect(lockDrift({ ...lock, extractor: { version: 0, sha256: "c".repeat(64) } }, { tasks: contract.tasks, ext: null, policySha256: null })).toEqual([expect.stringMatching(/^the contract-line rules changed/)]);
  });

  test("a paid run needs the lock and its pinned files committed and clean at HEAD", () => {
    const { dir, lock, contract } = lockFor(V1);
    const lockPath = join(dir, "tasks.lock.json");
    expect(lockCommit(lockPath, [contract.tasks.path])).toEqual({ ok: false, reason: "no lock at " + lockPath });
    writeLock(lockPath, lock);
    expect(lockCommit(lockPath, [contract.tasks.path])).toEqual({ ok: false, reason: "the lock is not in a git repository with a commit" });
    const git = (...args: string[]) => spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    git("init", "-q");
    git("config", "user.email", "eval@example.com");
    git("config", "user.name", "eval");
    writeFileSync(join(dir, "README"), "x");
    git("add", "README");
    git("commit", "-qm", "init");
    expect(lockCommit(lockPath, [contract.tasks.path])).toEqual({ ok: false, reason: "not committed: tasks.lock.json, tasks.json" });
    git("add", "-A");
    git("commit", "-qm", "lock");
    const head = git("rev-parse", "HEAD").stdout.trim();
    expect(lockCommit(lockPath, [contract.tasks.path])).toEqual({ ok: true, commit: head });
    writeFileSync(contract.tasks.path, "[]");
    expect(lockCommit(lockPath, [contract.tasks.path])).toEqual({ ok: false, reason: "uncommitted changes: M tasks.json" });
  });
});

describe("gate coverage", () => {
  const runs: OldArmRun[] = [
    { task: "no-code", passed: true, files_read: ["SKILL.md"], asked: ["approach"] },
    { task: "asks-approach", passed: true, files_read: ["SKILL.md"], asked: [] },
    { task: "summary", passed: false, files_read: ["SKILL.md"], asked: [] },
  ];

  test("a line is covered only when a passing old-arm run of a claiming task reached it", () => {
    const lock = claim(lockFor(V1).lock, { "B:SKILL:0010": ["no-code"], "B:SKILL:0011": ["asks-approach"], "B:SKILL:0012": ["summary"] });
    expect(lineCoverage(lock.lines, runs).map((c) => [c.id, c.status, c.reached_by])).toEqual([
      ["B:SKILL:0010", "covered", ["no-code"]],
      ["B:SKILL:0011", "unreached", []],
      ["B:SKILL:0012", "unreached", []],
      ["B:visual:0003", "unclaimed", []],
    ]);
    const visual = claim(lock, { "B:visual:0003": ["no-code"] }).lines[3]!;
    expect(lineCoverage([visual], runs)[0]!.status).toBe("unreached");
    expect(lineCoverage([visual], [{ task: "no-code", passed: true, files_read: ["SKILL.md", "sections/visual.md"], asked: ["approach"] }])[0]!.status).toBe("unreached");
    expect(lineCoverage([visual], [{ task: "no-code", passed: true, files_read: ["SKILL.md", "sections/visual.md"], asked: ["visual"] }])[0]!.status).toBe("covered");
  });

  test("a line the diet moved out of SKILL.md that no task covers shows as a gap", () => {
    const lock = lockFor(V1).lock;
    const fates = lineFates(contractLines(readSkillFiles(tree(V1))), readSkillFiles(tree(V2)));
    const gaps = coverageGaps(lock.lines, fates, lineCoverage(lock.lines, runs));
    expect(gaps).toEqual([
      { id: "B:SKILL:0010", class: "moved", status: "unclaimed" },
      { id: "B:SKILL:0012", class: "removed", status: "unclaimed" },
      { id: "B:visual:0003", class: "rewritten", status: "unclaimed" },
    ]);
    const covered = claim(lock, { "B:SKILL:0010": ["no-code"] });
    expect(coverageGaps(covered.lines, fates, lineCoverage(covered.lines, runs)).map((g) => g.id)).toEqual(["B:SKILL:0012", "B:visual:0003"]);
  });

  test("a rewritten or removed line clears only when a covering task still passes in after", () => {
    const lock = claim(lockFor(V1).lock, { "B:SKILL:0012": ["summary"], "B:visual:0003": ["no-code"] });
    const fates = lineFates(contractLines(readSkillFiles(tree(V1))), readSkillFiles(tree(V2)));
    const reach: OldArmRun[] = [...runs, { task: "no-code", passed: true, files_read: ["SKILL.md", "sections/visual.md"], asked: ["visual"] }];
    const coverage = lineCoverage(lock.lines, reach);
    expect(uncoveredRemovals(fates, coverage, () => true)).toEqual([{ id: "B:SKILL:0012", class: "removed", why: "unreached", tasks: ["summary"] }]);
    expect(uncoveredRemovals(fates, coverage, (t) => t !== "no-code")).toEqual([
      { id: "B:SKILL:0012", class: "removed", why: "unreached", tasks: ["summary"] },
      { id: "B:visual:0003", class: "rewritten", why: "fails-in-after", tasks: ["no-code"] },
    ]);
  });
});
