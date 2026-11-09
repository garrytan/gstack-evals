// Copyright (c) 2026 Garry Tan. MIT License.
// Invented minimal repositories and rows for the state machines family's tests (a test never imports another test).
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Lang } from "./langs.ts";
import type { MlRow } from "./source.ts";

const git = (dir: string, ...args: string[]) => {
  const r = spawnSync("git", ["-c", "user.name=fixture", "-c", "user.email=fixture@localhost", "-c", "commit.gpgsign=false", ...args], { cwd: dir, encoding: "utf8" });
  if (r.status !== 0) throw new Error("git " + args.join(" ") + ": " + r.stderr);
  return r.stdout.trim();
};

/** A repo with the given files committed over several commits (plus a tag, a branch and a remote), returning its dir and
 *  the head commit. Files under "untracked:" prefixes are written but not committed. */
export function fixtureRepo(files: Record<string, string>, commits = 3): { dir: string; head: string } {
  const dir = mkdtempSync(join(tmpdir(), "sm-fixture-"));
  git(dir, "init", "-q");
  git(dir, "symbolic-ref", "HEAD", "refs/heads/trunk");
  const entries = Object.entries(files);
  for (let c = 0; c < commits; c++) {
    for (const [p, body] of entries) {
      if (p.startsWith("untracked:")) continue;
      mkdirSync(dirname(join(dir, p)), { recursive: true });
      writeFileSync(join(dir, p), c === commits - 1 ? body : body + "\n// draft " + c + "\n");
    }
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "--allow-empty", "-m", "c" + c);
  }
  git(dir, "tag", "v1");
  git(dir, "branch", "side");
  git(dir, "remote", "add", "origin", "https://example.invalid/fixture.git");
  for (const [p, body] of entries) {
    if (!p.startsWith("untracked:")) continue;
    const q = p.slice(10);
    mkdirSync(dirname(join(dir, q)), { recursive: true });
    writeFileSync(join(dir, q), body);
  }
  return { dir, head: git(dir, "rev-parse", "HEAD") };
}

export const gitOut = git;

/** An invented dataset row in MultiLang's shape. */
export function fixtureRow(over: Partial<MlRow> = {}): MlRow {
  return {
    repo: "example-org/widget", pull_number: "7", instance_id: "example-org__widget-7", base_commit: "a".repeat(40),
    patch: "diff --git a/src/counter.rs b/src/counter.rs\n--- a/src/counter.rs\n+++ b/src/counter.rs\n@@ -1 +1 @@\n-old\n+    let total_after_reset = counter.reset_and_count();\n",
    test_patch: "diff --git a/tests/counter.rs b/tests/counter.rs\n--- a/tests/counter.rs\n+++ b/tests/counter.rs\n@@ -1 +1 @@\n-a\n+b\n",
    problem_statement: "The counter keeps its old value after reset.", created_at: "2026-04-02T10:00:00Z",
    rebuild_cmds: ["cd /testbed/repo && true"], test_cmds: ["cd /testbed/repo && ./run-tests.sh > out.log 2>&1"], print_cmds: ["cd /testbed/repo && cat out.log"],
    log_parser: "def parser(log: str) -> dict[str, str]:\n    return {}\n", FAIL_TO_PASS: ["counter::reset"], PASS_TO_PASS: ["counter::add"],
    docker_image: "example/widget-7", ...over,
  };
}

/** The fixture units' log parser (invented): cargo test's "test x ... ok", go test -v's "--- PASS: x" and "PASS x" lines. */
export const FIXTURE_PARSER = [
  "import re",
  "def parser(log: str) -> dict[str, str]:",
  "    out = {}",
  "    for l in log.splitlines():",
  "        m = re.match(r'^test (\\S+) \\.\\.\\. (ok|FAILED|ignored)', l)",
  "        if m:",
  "            out[m.group(1)] = {'ok': 'pass', 'FAILED': 'fail', 'ignored': 'skip'}[m.group(2)]",
  "            continue",
  "        m = re.match(r'^\\s*--- (PASS|FAIL|SKIP): (\\S+)', l) or re.match(r'^(PASS|FAIL|SKIP) (\\S+)$', l)",
  "        if m:",
  "            a, b = (m.group(1), m.group(2))",
  "            out[b] = a.lower()",
  "    return out",
  "",
].join("\n");

/** A patch that turns the repo's committed files into the given ones (null deletes), as git diff writes it with index
 *  lines, so git apply --3way finds the base blobs. The repo is left as committed. */
export function patchOf(dir: string, files: Record<string, string | null>): string {
  for (const [p, body] of Object.entries(files)) {
    if (body === null) rmSync(join(dir, p), { force: true });
    else {
      mkdirSync(dirname(join(dir, p)), { recursive: true });
      writeFileSync(join(dir, p), body);
    }
  }
  git(dir, "add", "-A");
  const d = spawnSync("git", ["diff", "--cached", "--binary"], { cwd: dir, encoding: "utf8" }).stdout;
  git(dir, "reset", "-q", "--hard", "HEAD");
  git(dir, "clean", "-fdq");
  return d;
}

/** An invented sm-unit.v1 dir for the scorer, its tree volume (the repo copied in, one commit) and its known ids. */
export function scoreUnit(o: {
  id: string; lang: Lang; image: string; files: Record<string, string>; tests: Record<string, string | null>; fixTests?: Record<string, string>;
  commands: { rebuild: string[]; test: string[]; print: string[] }; f2p: string[]; stable: string[]; known: string[];
}): { dir: string; volume: string; repo: string } {
  const { dir: repo } = fixtureRepo(o.files, 1);
  const testPatch = patchOf(repo, o.tests);
  const fixTests = o.fixTests ? patchOf(repo, o.fixTests) : "";
  const dir = mkdtempSync(join(tmpdir(), "sm-score-unit-"));
  const body: Record<string, string> = {
    "fix.patch": testPatch, "test.patch": testPatch, "issue.md": "invented", "parser.py": FIXTURE_PARSER, "harbor/task.toml": "[environment]\n",
    "harbor/environment/Dockerfile": "FROM scratch\n", "harbor/instruction.md": "invented", "oracle-ids.json": JSON.stringify([...o.known].sort()) + "\n",
    ...(o.fixTests ? { "fix-tests.patch": fixTests, "fix-source.patch": "" } : {}),
  };
  for (const [p, b] of Object.entries(body)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), b);
  }
  const sha = (b: string) => createHash("sha256").update(b).digest("hex");
  const u = {
    schema: "sm-unit.v1", id: o.id, source: "live-multilang", revision: "fixture", repo: "example-org/" + o.id, pull_number: "1", created_at: "2026-04-01T00:00:00Z", month: "2026-04",
    lang: o.lang, base_commit: "b".repeat(40), repo_dir: "/w", work_dir: "/w", image: { ref: "example/fixture@sha256:" + "c".repeat(64), image_id: o.image, runtime_id: o.image },
    commands: o.commands, parser_sha256: sha(FIXTURE_PARSER), fix: { files: [], all_files: [], added_lines_30: 0, sha256: "" }, test_patch: { files: Object.keys(o.tests), sha256: sha(testPatch) },
    tests: { f2p: o.f2p, p2p: o.stable }, scope: null, file_scope: [], strip: null, labels: null,
    ...(o.fixTests ? { split: { in_source_tests: true, test_hunks: 1, source_files: [] } } : {}),
    oracle: { runs: [], stable: o.stable, stable_sha256: "", f2p_ok: true, max_wall_ms: 0, verdict: "kept", smoke: null, leak: null, history: null },
    files: Object.fromEntries(Object.entries(body).map(([p, b]) => [p, sha(b)])),
  };
  writeFileSync(join(dir, "unit.json"), JSON.stringify(u, null, 1) + "\n");
  const volume = "sm-score-fixture-" + o.id + "-" + process.pid;
  spawnSync("docker", ["volume", "create", volume], { encoding: "utf8" });
  const c = spawnSync("docker", ["run", "--rm", "--network", "none", "--user", "0:0", "-v", repo + ":/s:ro", "-v", volume + ":/d", "--entrypoint", "sh", o.image, "-c", "cp -a /s/. /d/"], { encoding: "utf8" });
  if (c.status !== 0) throw new Error("fixture volume: " + c.stderr);
  return { dir, volume, repo };
}
