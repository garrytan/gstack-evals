import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { CHECK, isTestFile, listTestFiles, treeRecord } from "../../scripts/ci-tree.ts";

// CI carry (GST-1182): scripts/ci-tree.ts writes ci.yml's tree.json and lists the bun test lane's inventory, and
// .gstack/pregate.json's run_profiles and ship_lanes_from must name exactly what ci.yml runs and records. gstack's /ship and
// pregate carry a lane only when its inventory is covered by the files a verified run's tree.json lists.
const root = join(import.meta.dir, "..", "..");
const sh = (cwd: string, script: string) => {
  const r = spawnSync("bash", ["-eo", "pipefail", "-c", script], { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" } });
  if (r.status !== 0) throw new Error(script + "\n" + r.stderr);
  return r.stdout;
};
const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const TREE = "c".repeat(40);
const env = (over: Record<string, string | undefined> = {}) => ({ GITHUB_RUN_ID: "41", GITHUB_RUN_ATTEMPT: "2", GITHUB_EVENT_NAME: "pull_request", GITHUB_SHA: SHA_A, PR_HEAD_SHA: SHA_B, RUNNER_OS: "Linux", ...over });
const JUNIT = [
  '<testsuites name="bun test" tests="4" skipped="1" failures="0">',
  '  <testsuite name="tests/b.test.ts" file="tests/b.test.ts"><testcase name="one" /><testcase name="two"><skipped /></testcase></testsuite>',
  '  <testsuite name="tests/a.test.ts" file="tests/a.test.ts"><testsuite name="group" file="tests/a.test.ts"><testcase name="three" /></testsuite></testsuite>',
  '  <testsuite name="quick/x/s.test.ts" file="quick/x/s.test.ts"><testcase name="only skipped"><skipped /></testcase></testsuite>',
  "</testsuites>",
].join("\n");

describe("isTestFile and listTestFiles", () => {
  test("list the same files bun test runs, read from a real bun test JUnit report", () => {
    const dir = mkdtempSync(join(tmpdir(), "ci-tree-"));
    const body = 'import { test } from "bun:test";\ntest("t", () => {});\n';
    const names = ["a/one.test.ts", "a/two_test.tsx", "a/three.spec.mts", "a/four_spec.cjs", "a/five.TEST.js", "a/six.test.jsx", "b/seven.test.mjs", "b/eight.test.cts", "a/test.ts", "a/nine.test.d.ts", "a/helper.ts", "a/.hidden/ten.test.ts", ".top/eleven.test.ts", "node_modules/x/twelve.test.ts", "c/data.test.json", "c/thirteen_test.py"];
    for (const n of names) {
      mkdirSync(join(dir, dirname(n)), { recursive: true });
      writeFileSync(join(dir, n), body);
    }
    sh(dir, "git init -q . && git add -f -A && git commit -qm fixtures");
    const junit = join(dir, "junit.xml");
    const run = spawnSync(process.execPath, ["--no-env-file", "--config=/dev/null", "test", "--reporter=junit", "--reporter-outfile=" + junit], { cwd: dir, encoding: "utf8" });
    expect(run.status).toBe(0);
    const ran = treeRecord(env(), { junit: readFileSync(junit, "utf8"), checks: "", tree: TREE }).files;
    expect(listTestFiles(dir)).toEqual(ran);
    expect(ran).toEqual(["a/five.TEST.js", "a/four_spec.cjs", "a/one.test.ts", "a/six.test.jsx", "a/three.spec.mts", "a/two_test.tsx", "b/eight.test.cts", "b/seven.test.mjs"]);
    for (const n of names) expect([n, isTestFile(n)]).toEqual([n, ran.includes(n)]);
  });

  test("list this repo's committed tree", () => {
    const files = listTestFiles(root);
    expect(files).toContain("tests/cli.test.ts");
    expect(files.every(isTestFile)).toBe(true);
    expect(files).toEqual([...files].sort());
  });
});

describe("treeRecord", () => {
  test("records a pull_request run's merge commit and head, its test files, its passed checks and its passing case count", () => {
    expect(treeRecord(env(), { junit: JUNIT, checks: "bun run typecheck\nbun run errors:check\n\nbun run typecheck\n", tree: TREE })).toEqual({
      run_id: 41,
      run_attempt: 2,
      event: "pull_request",
      sha: SHA_A,
      head_sha: SHA_B,
      tree: TREE,
      os: "Linux",
      files: ["quick/x/s.test.ts", "tests/a.test.ts", "tests/b.test.ts", CHECK + "bun run typecheck", CHECK + "bun run errors:check"],
      tests: 2,
    });
  });

  test("takes the head from GITHUB_SHA on a dispatch", () => {
    const rec = treeRecord(env({ GITHUB_EVENT_NAME: "workflow_dispatch", PR_HEAD_SHA: "" }), { junit: JUNIT, checks: "", tree: TREE });
    expect([rec.sha, rec.head_sha, rec.event]).toEqual([SHA_A, SHA_A, "workflow_dispatch"]);
  });

  test("refuses a failing case, an empty report and malformed run facts", () => {
    const failing = JUNIT.replace('<testcase name="one" />', '<testcase name="one"><failure message="x" /></testcase>');
    expect(() => treeRecord(env(), { junit: failing, checks: "", tree: TREE })).toThrow("1 failing case(s), the first tests/b.test.ts > one");
    expect(() => treeRecord(env(), { junit: '<testsuites name="bun test" tests="0"></testsuites>', checks: "", tree: TREE })).toThrow("lists no test file");
    expect(() => treeRecord(env({ PR_HEAD_SHA: undefined }), { junit: JUNIT, checks: "", tree: TREE })).toThrow("needs PR_HEAD_SHA");
    expect(() => treeRecord(env({ GITHUB_RUN_ATTEMPT: "0" }), { junit: JUNIT, checks: "", tree: TREE })).toThrow("GITHUB_RUN_ATTEMPT is not a positive integer");
    expect(() => treeRecord(env({ RUNNER_OS: "" }), { junit: JUNIT, checks: "", tree: TREE })).toThrow("RUNNER_OS");
    expect(() => treeRecord(env(), { junit: JUNIT, checks: "", tree: "HEAD" })).toThrow("is not a tree id");
  });
});

type Step = { name?: string; uses?: string; run?: string; if?: unknown; "continue-on-error"?: unknown; with?: Record<string, unknown> };
const workflow = Bun.YAML.parse(readFileSync(join(root, ".github", "workflows", "ci.yml"), "utf8")) as { on: Record<string, unknown>; jobs: Record<string, { steps: Step[] }> };
const policy = JSON.parse(readFileSync(join(root, ".gstack", "pregate.json"), "utf8")) as {
  run_profiles: Record<string, { workflow: string; events: string[]; jobs: string[]; artifact: string; os?: string }>;
  ship_lanes_from: Record<string, { profiles: string[]; inventory: string }>;
};

describe("ci.yml and .gstack/pregate.json agree on CI carry", () => {
  const [name, profile] = Object.entries(policy.run_profiles).find(([, p]) => p.workflow === "ci.yml")!;
  const job = profile.jobs[0]!;
  const steps = workflow.jobs[job]!.steps;
  const runs = steps.map((s) => (s.run ?? "").trim());
  const record = runs.findIndex((r) => r.startsWith("bun scripts/ci-tree.ts record "));
  const upload = steps.findIndex((s) => s.uses?.startsWith("actions/upload-artifact@"));

  test("the profile names ci.yml's one checks job, its artifact, its OS and events it runs on", () => {
    expect(profile.jobs).toEqual(["checks"]);
    expect(Object.keys(workflow.jobs)).toEqual(["checks"]);
    expect(profile.os).toBe("Linux");
    for (const e of profile.events) expect(Object.keys(workflow.on)).toContain(e);
    expect(steps[upload]!.with).toMatchObject({ name: profile.artifact, path: "${{ runner.temp }}/tested-tree/tree.json", "if-no-files-found": "error" });
    expect(runs[record]).toContain('--out "$RUNNER_TEMP/tested-tree/tree.json"');
    expect(upload).toBe(record + 1);
    expect(upload).toBe(steps.length - 1);
  });

  test("no step in the job can be skipped or fail without failing the job", () => {
    for (const s of steps) expect([s.name ?? s.uses, s.if, s["continue-on-error"]]).toEqual([s.name ?? s.uses, undefined, undefined]);
  });

  test("bun test writes the JUnit report the record reads, before the record", () => {
    const tests = runs.findIndex((r) => r.startsWith("bun test "));
    expect(runs[tests]).toBe('bun test --reporter=junit --reporter-outfile="$RUNNER_TEMP/junit.xml"');
    expect(runs[record]).toContain('--junit "$RUNNER_TEMP/junit.xml"');
    expect(tests).toBeLessThan(record);
  });

  test("every mapped lane carries from this profile and its inventory is what the record covers", () => {
    expect(Object.keys(policy.ship_lanes_from).sort()).toEqual(["bun run errors:check", "bun run typecheck", "bun run wiki:check", "bun test"]);
    for (const [command, lane] of Object.entries(policy.ship_lanes_from)) {
      expect([command, lane.profiles]).toEqual([command, [name]]);
      const listed = sh(root, lane.inventory).split("\n").filter(Boolean);
      if (command === "bun test") {
        expect(listed).toEqual(listTestFiles(root));
        continue;
      }
      expect([command, listed]).toEqual([command, [CHECK + command]]);
      const at = runs.findIndex((r) => r.startsWith(command + "\n") || r.startsWith(command + " "));
      expect([command, at >= 0 && at < record]).toEqual([command, true]);
      expect(runs[at]!.split("\n").at(-1)).toBe("echo '" + command + "' >> \"$RUNNER_TEMP/checks-passed.txt\"");
    }
    expect(runs[record]).toContain('--checks "$RUNNER_TEMP/checks-passed.txt"');
  });
});
