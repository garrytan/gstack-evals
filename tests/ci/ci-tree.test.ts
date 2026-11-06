import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { CHECK, treeRecord } from "../../scripts/ci-tree.ts";

// CI carry (GST-1182): scripts/ci-tree.ts writes ci.yml's tree.json, and .gstack/pregate.json's run_profiles and
// ship_lanes_from must name exactly what ci.yml runs and records. gstack's /ship and pregate carry a lane only when every
// line its inventory prints is in the files a verified run's tree.json lists.
const root = join(import.meta.dir, "..", "..");
const SCRIPT = join(root, "scripts", "ci-tree.ts");
const sh = (cwd: string, script: string) => {
  const r = spawnSync("bash", ["-eo", "pipefail", "-c", script], { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" } });
  if (r.status !== 0) throw new Error(script + "\n" + r.stderr);
  return r.stdout;
};
const lines = (s: string) => s.split("\n").filter(Boolean);
const scratch: string[] = [];
const tempRepo = (files: Record<string, string>) => {
  const dir = mkdtempSync(join(tmpdir(), "ci-tree-"));
  scratch.push(dir);
  for (const [n, body] of Object.entries(files)) {
    mkdirSync(join(dir, dirname(n)), { recursive: true });
    writeFileSync(join(dir, n), body);
  }
  sh(dir, "git init -q . && git add -f -A && git commit -qm fixtures");
  return dir;
};
afterEach(() => {
  for (const d of scratch.splice(0)) rmSync(d, { recursive: true, force: true });
});
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

type Step = { name?: string; uses?: string; run?: string; if?: unknown; "continue-on-error"?: unknown; with?: Record<string, unknown> };
const workflow = Bun.YAML.parse(readFileSync(join(root, ".github", "workflows", "ci.yml"), "utf8")) as { on: Record<string, unknown>; jobs: Record<string, { steps: Step[] }> };
const policy = JSON.parse(readFileSync(join(root, ".gstack", "pregate.json"), "utf8")) as {
  run_profiles: Record<string, { workflow: string; events: string[]; jobs: string[]; artifact: string; os?: string }>;
  ship_lanes_from: Record<string, { profiles: string[]; inventory: string }>;
};
const testInventory = policy.ship_lanes_from["bun test"]!.inventory;

describe("the bun test lane's inventory", () => {
  test("lists the files a real bun test run reports, plus a file with no case, which then cannot carry", () => {
    const body = 'import { test } from "bun:test";\ntest("t", () => {});\n';
    const names = ["a/one.test.ts", "a/two_test.tsx", "a/three.spec.mts", "a/four_spec.cjs", "a/five.TEST.js", "a/six.test.jsx", "b/seven.test.mjs", "b/eight.test.cts", "a/test.ts", "a/nine.test.d.ts", "a/helper.ts", "a/.hidden/ten.test.ts", ".top/eleven.test.ts", "node_modules/x/twelve.test.ts", "c/data.test.json", "c/thirteen_test.py"];
    const dir = tempRepo({ ...Object.fromEntries(names.map((n) => [n, body])), "a/zero.test.ts": 'import { test } from "bun:test";\nif (process.env.NEVER_SET_IN_CI_TREE_TEST) test("t", () => {});\n' });
    const junit = join(dir, "junit.xml");
    const run = spawnSync(process.execPath, ["--no-env-file", "--config=/dev/null", "test", "--reporter=junit", "--reporter-outfile=" + junit], { cwd: dir, encoding: "utf8", env: { ...process.env, NEVER_SET_IN_CI_TREE_TEST: "" } });
    expect(run.status).toBe(0);
    const ran = treeRecord(env(), { junit: readFileSync(junit, "utf8"), checks: "", tree: TREE }).files;
    expect(ran).toEqual(["a/five.TEST.js", "a/four_spec.cjs", "a/one.test.ts", "a/six.test.jsx", "a/three.spec.mts", "a/two_test.tsx", "b/eight.test.cts", "b/seven.test.mjs"]);
    expect(lines(sh(dir, testInventory))).toEqual([...ran, "a/zero.test.ts"].sort());
  });

  test("lists this repo's committed test files", () => {
    const listed = lines(sh(root, testInventory));
    expect(listed).toContain("tests/cli.test.ts");
    for (const f of listed) expect(f).toMatch(/[._](test|spec)\.[cm]?[jt]sx?$/i);
  });

  test("holds no test file that another test file imports, since bun then reports its cases under the importer and tree.json misses it", () => {
    const imports = lines(sh(root, testInventory)).flatMap((f) =>
      [...readFileSync(join(root, f), "utf8").matchAll(/(?:\bfrom|\bimport\s*\(?)\s*["']([^"']+)["']/g)]
        .map((m) => m[1]!)
        .filter((s) => s.startsWith(".") && /[._](test|spec)\.[cm]?[jt]sx?$/i.test(s))
        .map((s) => f + " imports " + s),
    );
    expect(imports).toEqual([]);
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

describe("ci-tree.ts record", () => {
  const record = (cwd: string, args: string[], over: Record<string, string>) =>
    spawnSync(process.execPath, ["--no-env-file", "--config=/dev/null", SCRIPT, "record", ...args], { cwd, encoding: "utf8", env: { ...process.env, ...env({ GITHUB_EVENT_NAME: "workflow_dispatch", PR_HEAD_SHA: "" }), ...over } });

  test("writes tree.json for HEAD's tree, making the out directory, and refuses another commit or a missing flag", () => {
    const dir = tempRepo({ "junit.xml": JUNIT, "checks.txt": "bun run typecheck\n" });
    const head = sh(dir, "git rev-parse HEAD").trim();
    const out = join(dir, "out", "tested-tree", "tree.json");
    const ok = record(dir, ["--junit", "junit.xml", "--checks", "checks.txt", "--out", out], { GITHUB_SHA: head });
    expect([ok.status, ok.stderr]).toEqual([0, ""]);
    expect(ok.stdout).toStartWith("TESTED_TREE: run 41/2 workflow_dispatch head " + head.slice(0, 12));
    const rec = JSON.parse(readFileSync(out, "utf8"));
    expect([rec.sha, rec.head_sha, rec.tree, rec.files.at(-1), rec.tests]).toEqual([head, head, sh(dir, "git rev-parse HEAD^{tree}").trim(), CHECK + "bun run typecheck", 2]);
    const other = record(dir, ["--junit", "junit.xml", "--checks", "checks.txt", "--out", join(dir, "other.json")], { GITHUB_SHA: SHA_A });
    expect([other.status, other.stderr.trim()]).toEqual([1, "ci-tree: HEAD is not GITHUB_SHA, the commit this run tested"]);
    const missing = record(dir, ["--checks", "checks.txt", "--out", join(dir, "missing.json")], { GITHUB_SHA: head });
    expect([missing.status, missing.stderr.trim()]).toEqual([1, "ci-tree: --junit <value> is required"]);
    expect([existsSync(join(dir, "other.json")), existsSync(join(dir, "missing.json"))]).toEqual([false, false]);
  });

  test("refuses a checkout that changed after checkout, so tree.json never names a tree the checks did not read", () => {
    const dir = tempRepo({ "junit.xml": JUNIT, "checks.txt": "bun run typecheck\n" });
    const head = sh(dir, "git rev-parse HEAD").trim();
    writeFileSync(join(dir, "stray.md"), "written by a step\n");
    const out = join(tmpdir(), "ci-tree-dirty-" + process.pid + ".json");
    const dirty = record(dir, ["--junit", "junit.xml", "--checks", "checks.txt", "--out", out], { GITHUB_SHA: head });
    expect([dirty.status, dirty.stderr.trim(), existsSync(out)]).toEqual([1, "ci-tree: the checkout changed after checkout, so the checks did not read HEAD's tree", false]);
  });

  test("refuses when git status fails, as on a corrupt index over a modified file, and writes nothing, while the clean tree before it records", () => {
    const dir = tempRepo({ "junit.xml": JUNIT, "checks.txt": "bun run typecheck\n", "tracked.md": "one\n" });
    const head = sh(dir, "git rev-parse HEAD").trim();
    const outDir = mkdtempSync(join(tmpdir(), "ci-tree-out-"));
    scratch.push(outDir);
    const args = (name: string) => ["--junit", "junit.xml", "--checks", "checks.txt", "--out", join(outDir, name)];
    const clean = record(dir, args("clean.json"), { GITHUB_SHA: head });
    expect([clean.status, clean.stderr, existsSync(join(outDir, "clean.json"))]).toEqual([0, "", true]);
    writeFileSync(join(dir, "tracked.md"), "two\n");
    writeFileSync(join(dir, ".git", "index"), "not an index\n");
    const corrupt = record(dir, args("corrupt.json"), { GITHUB_SHA: head });
    expect([corrupt.status, existsSync(join(outDir, "corrupt.json"))]).toEqual([1, false]);
    expect(corrupt.stderr).toStartWith("ci-tree: git status --porcelain --untracked-files=all exited 128: ");
  });
});

describe("ci.yml's wiki:check step", () => {
  const wiki = workflow.jobs.checks!.steps.find((s) => (s.run ?? "").trim().startsWith("bun run wiki:check ")) as Step & { shell?: string };
  const run = (stdout: string, o: { status?: number; baseIsDefault?: string } = {}) => {
    const dir = mkdtempSync(join(tmpdir(), "ci-wiki-step-"));
    scratch.push(dir);
    mkdirSync(join(dir, "bin"));
    writeFileSync(join(dir, "bin", "bun"), '#!/bin/bash\n[ "$*" = "run wiki:check --base base-sha" ] || { echo "unexpected bun $*" >&2; exit 9; }\nprintf "%s\\n" "$STUB_OUT"\nexit "$STUB_STATUS"\n', { mode: 0o755 });
    const env = { PATH: join(dir, "bin") + ":" + process.env.PATH, RUNNER_TEMP: dir, BASE: "base-sha", BASE_IS_DEFAULT: o.baseIsDefault ?? "true", GITHUB_BASE_REF: "stack-parent", STUB_OUT: stdout, STUB_STATUS: String(o.status ?? 0) };
    const r = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", wiki.run!], { cwd: dir, encoding: "utf8", env });
    const passed = join(dir, "checks-passed.txt");
    return { status: r.status, entries: existsSync(passed) ? lines(readFileSync(passed, "utf8")) : [], stdout: r.stdout };
  };
  const CHECKED = "wiki: ok, 3 posts; immutability checked against base-sha (merge base 0123456789ab)";

  test("runs under bash with pipefail, as GitHub runs a step that sets shell: bash", () => {
    expect(wiki.shell).toBe("bash");
  });

  test("writes the carry entry when wiki:check checked immutability against the default branch, and prints wiki:check's output", () => {
    const r = run(CHECKED);
    expect([r.status, r.entries]).toEqual([0, ["bun run wiki:check"]]);
    expect(r.stdout).toContain(CHECKED);
  });

  test("writes no entry when wiki:check passed without checking immutability", () => {
    for (const note of ["immutability not checked (--base none)", "immutability not checked: the push created the branch, so there is no previous commit", "immutability not checked: no origin/HEAD, origin/main or origin/master in this clone"]) {
      expect([note, run("wiki: ok, 3 posts; " + note).status, run("wiki: ok, 3 posts; " + note).entries]).toEqual([note, 0, []]);
    }
  });

  test("keeps the stacked-PR rule and fails the step, writing nothing, when wiki:check fails", () => {
    expect(run(CHECKED, { baseIsDefault: "false" })).toMatchObject({ status: 0, entries: [] });
    expect(run("wiki: 1 problem(s), 3 posts; immutability checked against base-sha (merge base 0123456789ab)", { status: 1 })).toMatchObject({ status: 1, entries: [] });
  });
});

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

  test("every mapped lane carries from this profile, and each check lane's inventory is the entry its step writes", () => {
    expect(Object.keys(policy.ship_lanes_from).sort()).toEqual(["bun run errors:check", "bun run typecheck", "bun run wiki:check", "bun test"]);
    for (const [command, lane] of Object.entries(policy.ship_lanes_from)) {
      expect([command, lane.profiles]).toEqual([command, [name]]);
      if (command === "bun test") continue;
      expect([command, lines(sh(root, lane.inventory))]).toEqual([command, [CHECK + command]]);
      const at = runs.findIndex((r) => r.startsWith(command + "\n") || r.startsWith(command + " "));
      expect([command, at >= 0 && at < record]).toEqual([command, true]);
      expect(runs[at]!.split("\n").at(-1)).toBe("echo '" + command + "' >> \"$RUNNER_TEMP/checks-passed.txt\"");
    }
    expect(runs[record]).toContain('--checks "$RUNNER_TEMP/checks-passed.txt"');
  });

  test("the wiki:check entry is written only when the run checked against the default branch", () => {
    const wiki = steps.find((s) => (s.run ?? "").trim().startsWith("bun run wiki:check "))! as Step & { env?: Record<string, string> };
    expect(wiki.env?.BASE_IS_DEFAULT).toBe("${{ github.event_name != 'pull_request' || github.base_ref == github.event.repository.default_branch }}");
    expect(wiki.run!.trim().split("\n").at(-2)).toStartWith('[ "$BASE_IS_DEFAULT" = true ] || {');
  });
});
