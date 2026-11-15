// Copyright (c) 2026 Garry Tan. MIT License.
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { dropAtPaths, lineCounts, newTestPaths } from "../../lanes/outcome-skills/h2h/score/rules.ts";
import { scoreSession, type ScoreFirst } from "../../lanes/outcome-skills/h2h/score/score.ts";
import { extraArgs } from "../../lanes/outcome-skills/statemachines/testrun.ts";
import { nestedGitDirs, openTree } from "../../lanes/outcome-skills/h2h/score/tree.ts";
import type { H2hSession } from "../../lanes/outcome-skills/h2h/types.ts";
import type { OutcomeRecord, ScoreInput } from "../../lanes/outcome-skills/statemachines/score.ts";

const temp = (p: string) => mkdtempSync(join(tmpdir(), p));
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const git = (d: string, ...a: string[]) => {
  const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...a], { cwd: d, encoding: "utf8" });
  if (r.status !== 0) throw new Error("git " + a.join(" ") + ": " + r.stderr);
  return r.stdout.trim();
};
const put = (root: string, files: Record<string, string>) => {
  for (const [p, b] of Object.entries(files)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), b);
  }
};

/** A session repository at a base commit; returns its dir and base sha. */
function repo(files: Record<string, string> = { "src/a.go": "package a\n\nfunc A() int { return 1 }\n", "a_test.go": "package a\n" }) {
  const d = temp("h2h-score-repo-");
  git(d, "init", "-q", "-b", "main");
  put(d, files);
  git(d, "add", "-A");
  git(d, "commit", "-q", "-m", "base");
  return { d, base: git(d, "rev-parse", "HEAD") };
}

const TEST_PATCH = "diff --git a/tests/new_test.go b/tests/new_test.go\nnew file mode 100644\n--- /dev/null\n+++ b/tests/new_test.go\n@@ -0,0 +1 @@\n+package tests\n";

/** An sm-unit.v1 dir that readUnit accepts. */
function unitDir(id: string, repoDir: string, h2h?: Record<string, unknown>) {
  const dir = temp("h2h-score-unit-");
  const body: Record<string, string> = {
    "fix.patch": "diff --git a/src/a.go b/src/a.go\n", "test.patch": TEST_PATCH, "issue.md": "x\n", "parser.py": "def parser(log):\n  return {}\n",
    "harbor/task.toml": "x\n", "harbor/environment/Dockerfile": "FROM x\n", "harbor/instruction.md": "x\n",
  };
  put(dir, body);
  const u = {
    schema: "sm-unit.v1", id, lang: "go", base_commit: "b".repeat(40), repo_dir: repoDir, work_dir: repoDir, split: undefined,
    image: { ref: "example/fixture@sha256:" + "c".repeat(64), image_id: null, runtime_id: null }, test_patch: { files: ["tests/new_test.go"], sha256: sha(TEST_PATCH) },
    tests: { f2p: ["t1"], p2p: ["t2"] }, files: Object.fromEntries(Object.entries(body).map(([p, b]) => [p, sha(b)])), ...(h2h ? { h2h } : {}),
  };
  writeFileSync(join(dir, "unit.json"), JSON.stringify(u));
  return dir;
}

function session(over: Partial<H2hSession> = {}): H2hSession {
  return {
    schema: "h2h-session.v1", unit: "o__unit-1", arm: "superpowers", model: "claude-opus-5-5", item: "h2h-opus", stage: "stage1", index: 3, end: "completed", gap: null,
    turns: 2, scripted_turns: 1, continuations: 0, spurious_continuations: 0, done_seen: true, questions: 0, reservation_refusals: 0, cost_usd: 1,
    tokens: { input: 1, output: 1, cache_read: 0, cache_write: 0 }, wall_ms: 1, exposure: null, transcript: "t.jsonl", tree_bundle: "tree", ...over,
  };
}

/** A stand-in first-stage scorer: each call's patch text decides its strict reading. */
function fake(decide: (patch: string) => Partial<OutcomeRecord["strict"]> & { merge_conflict?: boolean }, calls: { patch: string; i: ScoreInput }[] = []): ScoreFirst {
  return (i) => {
    const patch = require("node:fs").readFileSync(i.patchFile, "utf8") as string;
    calls.push({ patch, i });
    const d = decide(patch);
    const strict = { applied: true, merge: "clean", three_way: 0, conflict: [], runs: [], fixed: false, broke: false, broke_by: { stable_missing: [], stable_failed: [], new_test_failed: [], build_failed: false }, absent: [], rerun_2of3: false, reruns: { fix: [], no_fix: [], break: [] }, new_tests: [], outcome: "no_fix", gap: null, apply_failed: false, ...d, merge_conflict: undefined } as unknown as OutcomeRecord["strict"];
    if (d.merge_conflict) Object.assign(strict, { outcome: null, gap: "E_SM_TEST_PATCH_CONFLICT", merge: "conflict" });
    return { strict, adapted: { ...strict, same_tree: true, fell_back_to_strict: null }, codes: { strict: strict.gap, adapted: strict.gap } } as unknown as OutcomeRecord;
  };
}
const CLEAN = { fixed: true, outcome: "clean_fix" } as const;

describe("h2h tree capture", () => {
  test("takes the main working tree with untracked files, leaves nested worktree dirs out and lists the worktree secondary", () => {
    const { d, base } = repo();
    git(d, "branch", "side");
    git(d, "worktree", "add", "-q", "-b", "feat", ".worktrees/feat");
    put(join(d, ".worktrees/feat"), { "src/a.go": "package a\n\nfunc A() int { return 2 }\n" });
    put(d, { "vendor/dep/.git/HEAD": "ref: refs/heads/main\n", "vendor/dep/x.go": "package dep\n" });
    git(d, "checkout", "-q", "side");
    put(d, { "src/b.go": "package a\n" });
    git(d, "add", "src/b.go");
    git(d, "commit", "-q", "-m", "side");
    git(d, "checkout", "-q", "main");
    put(d, { "src/a.go": "package a\n\nfunc A() int { return 3 }\n", "notes.txt": "untracked\n" });
    const t = openTree(d, base, { containerRepoDir: d });
    try {
      expect(t.main.patch).toContain("+func A() int { return 3 }");
      expect(t.main.patch).toContain("b/notes.txt");
      expect(t.main.patch).not.toContain(".worktrees");
      expect(t.main.patch).not.toContain("vendor/dep");
      expect(t.nested_left_out).toEqual([".worktrees/feat", "vendor/dep"]);
      expect(t.linked).toEqual([{ name: "feat", path: join(d, ".worktrees/feat"), in_tree: true, head: base }]);
      expect(t.candidates.map((c) => c.source)).toEqual(["worktree feat", "branch side"]);
      expect(t.candidates[0]!.patch).toContain("+func A() int { return 2 }");
      expect(t.candidates[1]!.patch).toContain("b/src/b.go");
      expect(t.readBase("src/a.go")).toContain("return 1");
      expect(t.readBase("nope.go")).toBeNull();
    } finally {
      t.close();
    }
  });

  test("ignores the arm's index, hooks and filters, and lists no ignored nested dir", () => {
    const { d, base } = repo();
    const marker = join(temp("h2h-marker-"), "ran");
    put(d, { ".gitattributes": "* filter=evil\n", "staged.go": "package a\n", ".gitignore": "build/\n", "build/sub/.git": "gitdir: /x\n" });
    git(d, "add", "staged.go");
    require("node:fs").rmSync(join(d, "staged.go"));
    git(d, "config", "filter.evil.clean", "touch " + marker);
    git(d, "config", "core.hooksPath", "/nonexistent");
    const t = openTree(d, base);
    try {
      expect(existsSync(marker)).toBe(false);
      expect(t.main.patch).not.toContain("staged.go");
      expect(t.main.patch).toContain("b/.gitattributes");
      expect(t.nested_left_out).toEqual([]);
      expect(nestedGitDirs(d)).toEqual(["build/sub"]);
    } finally {
      t.close();
    }
  });

  test("a tree with no git dir or without its base commit is a capture refusal", () => {
    const { d } = repo();
    expect(() => openTree(d, "f".repeat(40))).toThrow(/^E_H2H_SCORE_CAPTURE /);
    const bare = temp("h2h-nogit-");
    expect(() => openTree(bare, "f".repeat(40))).toThrow(/^E_H2H_SCORE_CAPTURE /);
    expect(() => openTree(bare, "HEAD")).toThrow(/^E_H2H_SCORE_INPUT /);
  });
});

describe("h2h scoring rules", () => {
  test("drops arm files at the fix's new test paths and keeps the rest", () => {
    const u = unitDir("o__unit-1", "/w");
    expect(newTestPaths(u, {})).toEqual(["tests/new_test.go"]);
    const patch = TEST_PATCH.replace("+package tests", "+package mine") + "diff --git a/src/a.go b/src/a.go\n--- a/src/a.go\n+++ b/src/a.go\n@@ -1 +1 @@\n-x\n+y\n";
    const r = dropAtPaths(patch, ["tests/new_test.go"]);
    expect(r.dropped).toEqual(["tests/new_test.go"]);
    expect(r.patch).toStartWith("diff --git a/src/a.go");
  });

  test("counts non-test lines, leaves out lockfiles, generated files and test files, and counts planning files apart", () => {
    const { d, base } = repo({ "src/a.go": "package a\n", "gen/z.go": "// Code generated by x. DO NOT EDIT.\npackage gen\n", "a_test.go": "package a\n" });
    put(d, {
      "src/a.go": "package a\n\nfunc B() {}\n", "gen/z.go": "// Code generated by x. DO NOT EDIT.\npackage gen\nvar X = 1\n", "a_test.go": "package a\n// more\n",
      "Gemfile.lock": "a\nb\n", ".planning/PLAN.md": "one\ntwo\nthree\n", "docs/superpowers/plans/p.md": "p\n",
    });
    const t = openTree(d, base);
    try {
      const c = lineCounts(t.main.patch, "go", ["a_test.go"], t.readBase);
      expect(c).toEqual({ lines: 2, planning: 4, generated: ["gen/z.go"], lockfiles: ["Gemfile.lock"] });
    } finally {
      t.close();
    }
  });
});

describe("h2h scoreSession", () => {
  const setup = (h2h?: Record<string, unknown>) => {
    const { d, base } = repo();
    const record = temp("h2h-score-rec-");
    require("node:fs").renameSync(d, join(record, "tree"));
    return { record, tree: join(record, "tree"), base, unit: unitDir("o__unit-1", join(record, "tree"), h2h) };
  };

  test("a B1 unit is scored under section 3's browser conditions and a B2 unit under none", () => {
    for (const kind of ["B1", "B2"]) {
      const s = setup({ kind });
      const calls: { patch: string; i: ScoreInput }[] = [];
      scoreSession(session({ base_head: s.base }), s.record, s.unit, { scoreFirst: fake(() => CLEAN, calls) });
      if (kind === "B1") expect(extraArgs(calls[0]!.i.extra).slice(0, 2)).toEqual(["--shm-size", "2g"]);
      else expect(calls[0]!.i.extra).toBeUndefined();
    }
  });

  test("an arm test at a new hidden-test path is dropped and logged, and a failing new test scores both ways", () => {
    const s = setup();
    put(s.tree, { "tests/new_test.go": "package tests\n// arm's own\n", "src/a.go": "package a\n\nfunc A() int { return 9 }\n" });
    const calls: { patch: string; i: ScoreInput }[] = [];
    const r = scoreSession(session({ base_head: s.base }), s.record, s.unit, { scoreFirst: fake(() => ({ fixed: true, broke: true, outcome: "fix_broke", broke_by: { stable_missing: [], stable_failed: [], new_test_failed: ["TestMine"], build_failed: false } }), calls) });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.patch).not.toContain("tests/new_test.go");
    expect(calls[0]!.i.cell).toBe("superpowers");
    expect(r.score).toMatchObject({ outcome: "fix_broke", verified: false, verified_without_new_test_rule: true, dropped_arm_tests: ["tests/new_test.go"], worktree_pass: null, gap: null, lines_changed: 2 });
    expect(r.warnings).toEqual(["E_H2H_SCORE_ARM_TEST_DROPPED o__unit-1/superpowers/stage1/3 dropped tests/new_test.go"]);
  });

  test("a stable test that failed is no fix under either reading", () => {
    const s = setup();
    put(s.tree, { "src/a.go": "package a\n// x\n" });
    const r = scoreSession(session({ base_head: s.base }), s.record, s.unit, { scoreFirst: fake(() => ({ fixed: true, broke: true, outcome: "fix_broke", broke_by: { stable_missing: [], stable_failed: ["t2"], new_test_failed: [], build_failed: false } })) });
    expect(r.score).toMatchObject({ verified: false, verified_without_new_test_rule: false, adapted_verified: false });
  });

  test("a linked worktree that passes while the main checkout does not sets the worktree secondary only", () => {
    const s = setup();
    git(s.tree, "worktree", "add", "-q", "-b", "fix", ".worktrees/fix");
    put(join(s.tree, ".worktrees/fix"), { "src/a.go": "package a\n\nfunc A() int { return 2 }\n" });
    const r = scoreSession(session({ base_head: s.base }), s.record, s.unit, { scoreFirst: fake((p) => (p.includes("return 2") ? CLEAN : {})) });
    expect(r.score).toMatchObject({ outcome: "no_fix", verified: false, worktree_pass: true, nested_left_out: [".worktrees/fix"], worktree_candidates: [{ source: "worktree fix", verified: true, gap: null }] });
    expect(r.warnings).toEqual(["E_H2H_SCORE_NESTED_WORKTREE o__unit-1/superpowers/stage1/3 left out .worktrees/fix"]);
  });

  test("reads a tar tree bundle the same way", () => {
    const s = setup();
    put(s.tree, { "src/a.go": "package a\n\nfunc A() int { return 2 }\n" });
    const tar = spawnSync("tar", ["-cf", join(s.record, "tree.tar"), "-C", s.record, "tree"]);
    expect(tar.status).toBe(0);
    require("node:fs").rmSync(s.tree, { recursive: true });
    const r = scoreSession(session({ base_head: s.base, tree_bundle: "tree.tar" }), s.record, s.unit, { scoreFirst: fake(() => CLEAN) });
    expect(r.score).toMatchObject({ outcome: "clean_fix", verified: true, adapted_verified: true, lines_changed: 2 });
  });

  test("session ends and scoring gaps follow section 7 rule 6", () => {
    const s = setup();
    const sf = fake(() => CLEAN);
    const run = (over: Partial<H2hSession>, f: ScoreFirst = sf) => scoreSession(session({ base_head: s.base, ...over }), s.record, s.unit, { scoreFirst: f }).score;
    expect(run({ gap: "E_PF_UPSTREAM", end: "upstream" })).toMatchObject({ outcome: null, gap: "E_PF_UPSTREAM", verified: false });
    expect(run({ end: "safety_stop" })).toMatchObject({ outcome: "no_fix", gap: null, verified: false });
    expect(run({ end: "cap_stop" })).toMatchObject({ outcome: null, gap: "CAP_STOP" });
    expect(() => run({ end: "infra" })).toThrow(/^E_H2H_SCORE_INPUT /);
    expect(run({ end: "limit_allowance" })).toMatchObject({ outcome: "clean_fix", verified: true });
    expect(run({}, fake(() => ({ merge_conflict: true })))).toMatchObject({ outcome: null, gap: "E_SM_TEST_PATCH_CONFLICT", verified: false });
    let n = 0;
    const flaky: ScoreFirst = (i) => {
      if (++n === 1) throw new Error("E_SM_INFRA_GAP docker went away");
      return sf(i);
    };
    expect(run({}, flaky)).toMatchObject({ outcome: "clean_fix" });
    expect(n).toBe(2);
    const down: ScoreFirst = () => {
      throw new Error("E_SM_INFRA_GAP docker went away");
    };
    expect(run({}, down)).toMatchObject({ outcome: null, gap: "E_SM_INFRA_GAP" });
    require("node:fs").rmSync(join(s.tree, ".git"), { recursive: true });
    expect(run({})).toMatchObject({ outcome: null, gap: "E_H2H_SCORE_CAPTURE" });
    expect(() => scoreSession(session(), s.record, s.unit, { scoreFirst: sf })).toThrow(/^E_H2H_SCORE_INPUT .*base_head/);
    expect(() => scoreSession(session({ unit: "o__other" }), s.record, s.unit, { scoreFirst: sf })).toThrow(/^E_H2H_SCORE_INPUT /);
  });
});
