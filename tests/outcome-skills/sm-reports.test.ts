// Copyright (c) 2026 Garry Tan. MIT License.
// The stale report rule (keyless): the report paths read literally from a print command, and the run script run by the
// host's bash on a small git tree. A run deletes the untracked report files its print command reads before it starts,
// hides report files the run did not write, and parses nothing when no fresh report is left or a separate rebuild step
// exits non-zero. A test command's own non-zero exit never means the run built nothing. A run creates, empty, the parent
// directory of each report path its test command writes into, when that directory is missing from the tree.
import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { printReading, reportDirs } from "../../lanes/outcome-skills/statemachines/reports.ts";
import { parseRun, runScript, settleRun, type RebuildRule, type TestRun } from "../../lanes/outcome-skills/statemachines/testrun.ts";

describe("report paths read from the print command", () => {
  test("a cat of a glob is a report path under the command's cd", () => {
    const r = printReading({ rebuild: [], test: ["mvn -q test"], print: ["cd /testbed && cat target/surefire-reports/*.xml"] });
    expect(r.kind).toBe("report");
    expect(r.paths).toEqual([{ cwd: "/testbed", glob: "target/surefire-reports/*.xml" }]);
  });
  test("a find with -path tests is read as the same find, each -o branch its own path", () => {
    const r = printReading({ rebuild: [], test: ["mvn test"], print: ["cd /testbed; { printf '%s\\n' '<x>'; find . -type f \\( -path '*/target/surefire-reports/TEST-*.xml' -o -path '*/target/failsafe-reports/TEST-*.xml' \\) -print0 | sort -z | xargs -0 cat; }"] });
    expect(r.kind).toBe("report");
    expect(r.paths).toEqual([
      { cwd: "/testbed", find: { root: ".", follow: false, tests: [["-path", "*/target/surefire-reports/TEST-*.xml"]] } },
      { cwd: "/testbed", find: { root: ".", follow: false, tests: [["-path", "*/target/failsafe-reports/TEST-*.xml"]] } },
    ]);
  });
  test("a for loop over a glob and a cat of its variable reads the glob", () => {
    const r = printReading({ rebuild: [], test: ["ctest"], print: ["for f in reports/gtest/*.json; do printf '\\n===== %s =====\\n' \"$f\"; cat \"$f\"; done"] });
    expect(r.paths).toEqual([{ cwd: "", glob: "reports/gtest/*.json" }]);
  });
  test("a file the test command writes by redirection is a log, not a report", () => {
    const r = printReading({ rebuild: [], test: ["cargo test 2>&1 | tee test-output.log"], print: ["cd /testbed ; cat test-output.log"] });
    expect(r.kind).toBe("log");
    expect(r.paths).toEqual([{ cwd: "/testbed", glob: "test-output.log" }]);
  });
  test("a command it cannot read literally is unreadable and gives no paths", () => {
    const r = printReading({ rebuild: [], test: ["t"], print: ["python3 collect.py reports"] });
    expect(r.kind).toBe("unreadable");
    expect(r.paths).toEqual([]);
    expect(r.unread).toContain("python3");
  });
});

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A small git tree with one tracked source file and a stale untracked report from an earlier build. */
function tree(): string {
  const d = mkdtempSync(join(tmpdir(), "sm-reports-"));
  dirs.push(d);
  const g = (...a: string[]) => spawnSync("git", ["-C", d, ...a], { encoding: "utf8" });
  mkdirSync(join(d, "src"));
  writeFileSync(join(d, "src/A.txt"), "source\n");
  writeFileSync(join(d, ".gitignore"), "target/\n");
  g("init", "-q");
  g("-c", "user.email=t@example.com", "-c", "user.name=t", "add", ".");
  g("-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-qm", "base");
  mkdirSync(join(d, "target/reports"), { recursive: true });
  writeFileSync(join(d, "target/reports/TEST-old.xml"), "old PASSED\n");
  utimesSync(join(d, "target/reports/TEST-old.xml"), new Date(2020, 0, 1), new Date(2020, 0, 1));
  return d;
}

function run(d: string, commands: { rebuild: string[]; test: string[]; print: string[] }, rule: RebuildRule = "applies"): TestRun {
  const tmp = mkdtempSync(join(tmpdir(), "sm-reports-tmp-"));
  dirs.push(tmp);
  const r = spawnSync("bash", ["-s"], { cwd: d, input: runScript(commands, d), encoding: "utf8", env: { PATH: process.env.PATH!, TMPDIR: tmp, HOME: tmp } });
  return settleRun({ stdout: r.stdout, stderr: r.stderr, status: r.status ?? -1, wall_ms: 1, timed_out: false }, commands, 60_000, rule);
}

const PRINT = ["cat target/reports/*.xml"];

describe("the stale report rule on a run", () => {
  test("a stale report with no build is deleted at the start, and the run parses nothing", () => {
    const d = tree();
    const t = run(d, { rebuild: [], test: ["exit 3"], print: PRINT });
    expect(t.reports).toEqual({ deleted: 1, kept: 0, refused: 0, unhidden: 0, fresh: 0 });
    expect(t.built_nothing).toBe("no_fresh_report");
    expect(t.log).not.toContain("old PASSED");
    expect(parseRun(t, "src", "x", () => { throw new Error("the parser ran"); })).toEqual({});
  });
  test("a fresh run parses as before", () => {
    const d = tree();
    const t = run(d, { rebuild: ["true"], test: ["mkdir -p target/reports && echo 'new PASSED' > target/reports/TEST-new.xml"], print: PRINT });
    expect(t.reports).toEqual({ deleted: 1, kept: 0, refused: 0, unhidden: 0, fresh: 1 });
    expect(t.built_nothing).toBeNull();
    expect(t.log).toBe("new PASSED\n");
    expect(parseRun(t, "src", "x", (_s, log) => ({ got: log.trim() }))).toEqual({ got: "new PASSED" });
  });
  test("a tracked file is never deleted at the start; the freshness check refuses it when the run did not write it", () => {
    const d = tree();
    spawnSync("git", ["-C", d, "add", "-f", "target/reports/TEST-old.xml"]);
    const t = run(d, { rebuild: [], test: ["test -f target/reports/TEST-old.xml"], print: PRINT });
    expect(t.exits).toEqual([0]);
    expect(t.reports).toEqual({ deleted: 0, kept: 1, refused: 1, unhidden: 0, fresh: 0 });
    expect(t.built_nothing).toBe("no_fresh_report");
    expect(readFileSync(join(d, "src/A.txt"), "utf8")).toBe("source\n");
  });
  test("a rebuild command that exits non-zero, in a unit with a separate rebuild step, builds nothing", () => {
    const d = tree();
    const t = run(d, { rebuild: ["exit 1"], test: ["mkdir -p target/reports && echo 'new PASSED' > target/reports/TEST-new.xml"], print: PRINT });
    expect(t.exits).toEqual([1, 0]);
    expect(t.built_nothing).toBe("rebuild_failed");
  });
  test("a unit exempt from the rebuild rule parses a fresh run whose rebuild failed, and still parses nothing from a stale report", () => {
    const d = tree();
    const t = run(d, { rebuild: ["exit 1"], test: ["mkdir -p target/reports && echo 'new PASSED' > target/reports/TEST-new.xml"], print: PRINT }, "exempt");
    expect(t.exits).toEqual([1, 0]);
    expect(t.built_nothing).toBeNull();
    expect(parseRun(t, "src", "x", (_s, log) => ({ got: log.trim() }))).toEqual({ got: "new PASSED" });
    const old = run(tree(), { rebuild: ["exit 1"], test: ["exit 3"], print: PRINT }, "exempt");
    expect(old.built_nothing).toBe("no_fresh_report");
  });
  test("a test command's non-zero exit never means the run built nothing", () => {
    for (const rebuild of [[], ["true"]]) {
      const d = tree();
      const t = run(d, { rebuild, test: ["mkdir -p target/reports && echo 'new FAILED' > target/reports/TEST-new.xml; exit 1"], print: PRINT });
      expect(t.exits.at(-1)).toBe(1);
      expect(t.built_nothing).toBeNull();
      expect(t.log).toBe("new FAILED\n");
    }
  });
  test("a print command it cannot read touches no file and keeps the old reading", () => {
    const d = tree();
    const t = run(d, { rebuild: [], test: ["true"], print: ["python3 -c 'print(1)' >/dev/null; cat target/reports/*.xml"] });
    expect(t.reports).toBeNull();
    expect(t.built_nothing).toBeNull();
    expect(t.log).toBe("old PASSED\n");
    expect(existsSync(join(d, "target/reports/TEST-old.xml"))).toBe(true);
  });
});

describe("report directories the test command writes into (selection)", () => {
  const sel = (test: string[], print: string[]) => reportDirs({ rebuild: [], test, print });
  test("the parent of a report path the test command names by tee or redirection is selected", () => {
    expect(sel([". /usr/local/cargo/env; env USER=root cargo test --all -- --nocapture 2>&1 | tee reports/test-output.log"], ["cat reports/test-output.log"])).toEqual([{ cwd: "", dir: "reports" }]);
    expect(sel(["go test -json ./... > reports/go-test-results.json"], ["cat reports/go-test-results.json"])).toEqual([{ cwd: "", dir: "reports" }]);
    expect(sel(["cd /testbed && cargo test 2>&1 | tee reports/test-output.log"], ["cd /testbed && cat reports/test-output.log"])).toEqual([{ cwd: "/testbed", dir: "reports" }]);
  });
  test("a report path only the print command names is not selected", () => {
    expect(sel(["cargo test 2>&1"], ["cat reports/test-output.log"])).toEqual([]);
    expect(sel(["cargo test 2>&1 | tee other/test-output.log"], ["cat reports/test-output.log"])).toEqual([]);
    expect(reportDirs({ rebuild: ["make > reports/test-output.log"], test: ["make test"], print: ["cat reports/test-output.log"] })).toEqual([]);
  });
  test("a directory the test command makes itself is not selected, so its own mkdir still runs as before", () => {
    expect(sel(["mkdir reports && cargo test 2>&1 | tee reports/test-output.log"], ["cat reports/test-output.log"])).toEqual([]);
    expect(sel(["cd /testbed && mkdir -p reports/sub && cargo test 2>&1 | tee reports/test-output.log"], ["cd /testbed && cat reports/test-output.log"])).toEqual([]);
  });
  test("an absolute path or one outside the tree is not selected", () => {
    expect(sel(["go test > /tmp/r/out.json"], ["cat /tmp/r/out.json"])).toEqual([]);
    expect(sel(["go test > ../r/out.json"], ["cat ../r/out.json"])).toEqual([]);
    expect(sel(["go test > a/../../r/out.json"], ["cat a/../../r/out.json"])).toEqual([]);
  });
  test("a glob file name selects its parent only; a glob in the directory or a file at the top selects nothing", () => {
    expect(sel(["mvn test > target/reports/TEST-a.xml"], ["cat target/reports/*.xml"])).toEqual([{ cwd: "", dir: "target/reports" }]);
    expect(sel(["mvn test > target/reports/TEST-a.txt"], ["cat target/reports/*.xml"])).toEqual([]);
    expect(sel(["mvn test > a/reports/x.xml"], ["cat */reports/x.xml"])).toEqual([]);
    expect(sel(["cargo test | tee out.log"], ["cat out.log"])).toEqual([]);
    expect(sel(["t | tee reports/x.log"], ["python3 collect.py reports/x.log"])).toEqual([]);
  });
});

/** A small git tree with one tracked source file and no report directory. */
function bare(): string {
  const d = mkdtempSync(join(tmpdir(), "sm-reports-bare-"));
  dirs.push(d);
  const g = (...a: string[]) => spawnSync("git", ["-C", d, ...a], { encoding: "utf8" });
  mkdirSync(join(d, "src"));
  writeFileSync(join(d, "src/A.txt"), "source\n");
  g("init", "-q");
  g("-c", "user.email=t@example.com", "-c", "user.name=t", "add", ".");
  g("-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-qm", "base");
  return d;
}

describe("report directories the test command writes into (run)", () => {
  test("a run that writes its report into a directory created at its start, empty, reads fresh", () => {
    const d = bare();
    const t = run(d, { rebuild: ["true"], test: ['[ -d reports ] && [ -z "$(ls -A reports)" ] && echo "new PASSED" | tee reports/out.log'], print: ["cat reports/out.log"] });
    expect(t.created_dirs).toEqual(["reports"]);
    expect(t.exits).toEqual([0, 0]);
    expect(t.reports).toEqual({ deleted: 0, kept: 0, refused: 0, unhidden: 0, fresh: 1 });
    expect(t.built_nothing).toBeNull();
    expect(t.log).toBe("new PASSED\n");
  });
  test("a run that writes nothing into the created directory still reads no_fresh_report", () => {
    const d = bare();
    const t = run(d, { rebuild: [], test: ["true || tee reports/out.log"], print: ["cat reports/out.log"] });
    expect(t.created_dirs).toEqual(["reports"]);
    expect(t.built_nothing).toBe("no_fresh_report");
    expect(readdirSync(join(d, "reports"))).toEqual([]);
  });
  test("a stale report is still deleted first, and its existing directory is not created", () => {
    const d = tree();
    const t = run(d, { rebuild: [], test: ["exit 3 || echo x > target/reports/TEST-new.xml"], print: PRINT });
    expect(t.created_dirs).toEqual([]);
    expect(t.reports).toEqual({ deleted: 1, kept: 0, refused: 0, unhidden: 0, fresh: 0 });
    expect(t.built_nothing).toBe("no_fresh_report");
  });
  test("a directory the print command reaches outside the tree is not created", () => {
    const d = bare();
    const out = mkdtempSync(join(tmpdir(), "sm-reports-out-"));
    dirs.push(out);
    const t = run(d, { rebuild: [], test: ["echo x | tee r/out.log"], print: ["cd " + out + " && cat r/out.log"] });
    expect(t.created_dirs).toEqual([]);
    expect(existsSync(join(out, "r"))).toBe(false);
    expect(existsSync(join(d, "r"))).toBe(false);
  });
  test("a print command with no report paths creates nothing", () => {
    const d = bare();
    const t = run(d, { rebuild: [], test: ["echo x | tee r/out.log"], print: ["python3 -c 'print(1)' r/out.log"] });
    expect(t.created_dirs).toEqual([]);
    expect(existsSync(join(d, "r"))).toBe(false);
  });
});

describe("commands read no stdin", () => {
  test("a command that reads stdin no longer swallows the rest of the script, so a later command runs", () => {
    const d = bare();
    const t = run(d, { rebuild: ["cat > /dev/null"], test: ["cat > /dev/null; echo 't1 PASSED' > out.log"], print: ["cat > /dev/null; cat out.log"] });
    expect(t.exits).toEqual([0, 0]);
    expect(t.reports).toMatchObject({ fresh: 1 });
    expect(t.built_nothing).toBeNull();
    expect(t.log).toBe("t1 PASSED\n");
  });
  test("a command that reads nothing behaves as before", () => {
    const d = bare();
    const t = run(d, { rebuild: ["true"], test: ["echo 't1 PASSED' > out.log", "exit 4"], print: ["cat out.log"] });
    expect(t.exits).toEqual([0, 0, 4]);
    expect(t.reports).toEqual({ deleted: 0, kept: 0, refused: 0, unhidden: 0, fresh: 1 });
    expect(t.built_nothing).toBeNull();
    expect(t.log).toBe("t1 PASSED\n");
  });
});

describe("absolute report paths inside the tree (selection)", () => {
  const sel = (test: string[], print: string[], workDir?: string) => reportDirs({ rebuild: [], test, print }, { repoDir: "/testbed", workDir });
  test("an absolute print path under the repo dir that the test command names after its cd reads as its tree-relative path", () => {
    expect(sel(["cd /testbed && go test -json ./... > reports/go-test-results.json"], ["cat /testbed/reports/go-test-results.json"])).toEqual([{ cwd: "/testbed", dir: "reports" }]);
    expect(sel(["cd /testbed/backend && go test -json ./... > ../reports/go.json"], ["cat /testbed/reports/go.json"])).toEqual([{ cwd: "/testbed", dir: "reports" }]);
    expect(sel(["go test -json ./... > reports/go.json"], ["cat /testbed/reports/go.json"])).toEqual([{ cwd: "/testbed", dir: "reports" }]);
    expect(sel(["mvn test > /testbed/target/r/TEST-a.xml"], ["cd /testbed && cat /testbed/target/r/*.xml"])).toEqual([{ cwd: "/testbed", dir: "target/r" }]);
  });
  test("an absolute print path the test command does not name, or names under another directory, is not selected", () => {
    expect(sel(["cd /testbed && go test ./..."], ["cat /testbed/reports/go.json"])).toEqual([]);
    expect(sel(["cd /other && go test > reports/go.json"], ["cat /testbed/reports/go.json"])).toEqual([]);
    expect(sel(["go test > reports/go.json"], ["cat /testbed/reports/go.json"], "/srv")).toEqual([]);
    expect(sel(["cd $D && go test > reports/go.json"], ["cat /testbed/reports/go.json"])).toEqual([]);
    expect(reportDirs({ rebuild: ["cd /testbed && make > reports/go.json"], test: ["make test"], print: ["cat /testbed/reports/go.json"] }, { repoDir: "/testbed" })).toEqual([]);
  });
  test("outside the tree, a .. step, a glob in the directory, a file at the top or a dir the test makes is not selected", () => {
    expect(sel(["go test > /tmp/r/out.json"], ["cat /tmp/r/out.json"])).toEqual([]);
    expect(sel(["cd /testbed2 && go test > r/out.json"], ["cat /testbed2/r/out.json"])).toEqual([]);
    expect(sel(["cd /testbed && go test > reports/out.json"], ["cat /testbed/a/../reports/out.json"])).toEqual([]);
    expect(sel(["cd /testbed && go test > a/reports/out.json"], ["cat /testbed/*/reports/out.json"])).toEqual([]);
    expect(sel(["cd /testbed && go test > out.json"], ["cat /testbed/out.json"])).toEqual([]);
    expect(sel(["cd /testbed && mkdir -p reports && go test > reports/out.json"], ["cat /testbed/reports/out.json"])).toEqual([]);
    expect(sel(["mkdir -p /testbed/reports/x && go test > /testbed/reports/out.json"], ["cat /testbed/reports/out.json"])).toEqual([]);
  });
  test("a file directly in a directory the print or test command cd's into selects nothing, as a file at the top of its cwd", () => {
    expect(sel(["cd /testbed/rust; cargo test 2>&1 | tee test-output.log"], ["cd /testbed/rust; cat test-output.log"])).toEqual([]);
    expect(sel(["cd /testbed/build ; make check 2>&1 | tee test-output.log"], ["cat /testbed/build/test-output.log"])).toEqual([]);
  });
  test("without the repo dir an absolute print path selects nothing, as before", () => {
    expect(reportDirs({ rebuild: [], test: ["cd /testbed && go test > reports/out.json"], print: ["cat /testbed/reports/out.json"] })).toEqual([]);
  });
});

describe("absolute report paths inside the tree (run)", () => {
  test("a run that writes its report into a directory created at its start, empty, reads fresh", () => {
    const d = bare();
    const t = run(d, { rebuild: [], test: ["cd " + d + ' && [ -d reports ] && [ -z "$(ls -A reports)" ] && echo "new PASSED" > reports/out.json'], print: ["cat " + d + "/reports/out.json"] });
    expect(t.created_dirs).toEqual(["reports"]);
    expect(t.exits).toEqual([0]);
    expect(t.reports).toEqual({ deleted: 0, kept: 0, refused: 0, unhidden: 0, fresh: 1 });
    expect(t.built_nothing).toBeNull();
    expect(t.log).toBe("new PASSED\n");
  });
  test("a run that writes nothing into the created directory still reads no_fresh_report", () => {
    const d = bare();
    const t = run(d, { rebuild: [], test: ["cd " + d + " && true || tee reports/out.json"], print: ["cat " + d + "/reports/out.json"] });
    expect(t.created_dirs).toEqual(["reports"]);
    expect(t.built_nothing).toBe("no_fresh_report");
    expect(readdirSync(join(d, "reports"))).toEqual([]);
  });
  test("a stale report is still deleted first, and its existing directory is not created", () => {
    const d = tree();
    const t = run(d, { rebuild: [], test: ["exit 3 || echo x > " + d + "/target/reports/TEST-new.xml"], print: ["cat " + d + "/target/reports/*.xml"] });
    expect(t.created_dirs).toEqual([]);
    expect(t.reports).toEqual({ deleted: 1, kept: 0, refused: 0, unhidden: 0, fresh: 0 });
    expect(t.built_nothing).toBe("no_fresh_report");
  });
  test("an absolute path outside the tree is not created", () => {
    const d = bare();
    const out = mkdtempSync(join(tmpdir(), "sm-reports-out-"));
    dirs.push(out);
    const t = run(d, { rebuild: [], test: ["echo x | tee " + out + "/r/out.log"], print: ["cat " + out + "/r/out.log"] });
    expect(t.created_dirs).toEqual([]);
    expect(existsSync(join(out, "r"))).toBe(false);
  });
});
