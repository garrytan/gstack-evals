// Value: protects=gate 1 reads both fix dates in UTC against 2026-07-01 and fails on any earlier disclosure, and gate 4
// finds instruction files, needles in tracked files or commit messages, and a fix inside the head's history;
// fails_when=a date offset, a needle's case or the ancestry check is mishandled; why_new=GEVA-590 section 2 gates 1 and 4;
// seam=gate1, treeProblems, containmentAt; no_claim=real repositories
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { containmentAt, gate1, treeProblems } from "../../../../src/trial/review/supply/gates.ts";
import { commitAll, git, tree } from "../../../cli/helpers.ts";

describe("gate 1", () => {
  const ok = { author: "2026-07-01T00:00:00Z", committer: "2026-08-02T10:00:00+02:00" };
  test("both dates on or after 2026-07-01 in UTC", () => {
    expect(gate1(ok, {})).toBe("ok");
    expect(gate1({ ...ok, author: "2026-06-30T22:00:00-04:00" }, {})).toBe("ok");
    expect(gate1({ ...ok, author: "2026-07-01T01:00:00+02:00" }, {})).toEqual({ fail: "the fix's author date 2026-07-01T01:00:00+02:00 is before 2026-07-01" });
    expect(gate1({ ...ok, committer: "2026-06-30T23:59:59Z" }, {})).toEqual({ fail: "the fix's committer date 2026-06-30T23:59:59Z is before 2026-07-01" });
    expect(gate1({ ...ok, author: "" }, {})).toMatchObject({ fail: expect.stringContaining("author date") });
  });
  test("an earlier disclosure fails; an unread one is not a date", () => {
    expect(gate1(ok, { "the review comment": "2026-07-03T00:00:00Z", other: null })).toBe("ok");
    expect(gate1(ok, { "the advisory's publication": "2026-06-15" })).toEqual({ fail: "the advisory's publication 2026-06-15 is before 2026-07-01" });
  });
});

function repo(extra: Record<string, string> = {}, message = "change") {
  const root = tree({ "src/a.ts": "a();\n" });
  commitAll(root, "initial");
  for (const [p, text] of Object.entries(extra)) {
    mkdirSync(join(root, p, ".."), { recursive: true });
    writeFileSync(join(root, p), text);
  }
  writeFileSync(join(root, "src/a.ts"), "b();\n");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", message);
  return root;
}

describe("gate 4", () => {
  const needles = { strings: ["GHSA-abcd-efgh-ijkl", "CVE-2026-1234"], fix: null };
  test("a clean tree passes", () => {
    expect(treeProblems(repo(), needles)).toEqual([]);
  });
  test("instruction files, needles in files and in commit messages each fail", () => {
    expect(treeProblems(repo({ "CLAUDE.md": "x", "pkg/AGENTS.md": "y", ".claude/settings.json": "{}" }), needles)).toEqual(["instruction files: .claude/settings.json, CLAUDE.md, pkg/AGENTS.md"]);
    expect(treeProblems(repo({ "docs/notes.txt": "see ghsa-ABCD-efgh-ijkl" }), needles)).toEqual(["files hold a needle: docs/notes.txt"]);
    expect(treeProblems(repo({}, "refs cve-2026-1234"), needles)).toEqual(["commit messages name CVE-2026-1234"]);
  });
  test("the fix's short sha and a fix inside the head's history fail", () => {
    const root = repo();
    const head = git(root, "rev-parse", "HEAD");
    expect(treeProblems(root, { strings: [], fix: head })).toEqual(["the fix commit is in the head's history"]);
    writeFileSync(join(root, "src/b.ts"), "// " + head.slice(0, 12) + "\n");
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "mention");
    const later = git(root, "rev-parse", "HEAD");
    git(root, "checkout", "-q", head);
    expect(treeProblems(root, { strings: [], fix: later })).toEqual([]);
    git(root, "checkout", "-q", later);
    expect(treeProblems(root, { strings: [], fix: head })).toEqual(["files hold a needle: src/b.ts", "the fix commit is in the head's history"]);
  });
  test("containmentAt checks out a revision of a bare clone and cleans up", () => {
    const root = repo({ "AGENTS.md": "x" });
    const bad = git(root, "rev-parse", "HEAD"), good = git(root, "rev-parse", "HEAD^");
    const scratch = mkdtempSync(join(tmpdir(), "rms-gates-"));
    const bare = join(scratch, "bare.git");
    git(scratch, "clone", "-q", "--bare", root, bare);
    expect(containmentAt(bare, good, needles, join(scratch, "wt", "x"))).toBe("ok");
    expect(containmentAt(bare, bad, needles, join(scratch, "wt", "x"))).toEqual({ fail: "instruction files: AGENTS.md" });
    expect(git(bare, "worktree", "list").split("\n")).toHaveLength(1);
  });
});
