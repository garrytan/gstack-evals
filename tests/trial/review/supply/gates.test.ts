// Value: protects=gate 1 reads both fix dates in UTC against 2026-07-01 and fails on any earlier disclosure, and gate 4
// finds needles in tracked files (instruction files included) or commit messages and a fix inside the head's history,
// keeps instruction files with their sha256 and flags, and strips executable config (pre-run change 2);
// fails_when=a date offset, a needle's case or the ancestry check is mishandled; why_new=GEVA-590 section 2 gates 1 and 4;
// seam=gate1, treeProblems, containmentAt; no_claim=real repositories
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { containmentAt, gate1, inventory, stripExecutable, treeProblems } from "../../../../src/trial/review/supply/gates.ts";
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
  test("needles in files, instruction files included, and in commit messages each fail; instruction files alone pass", () => {
    expect(treeProblems(repo({ "CLAUDE.md": "x", "pkg/AGENTS.md": "y", ".claude/settings.json": "{}" }), needles)).toEqual([]);
    expect(treeProblems(repo({ "docs/notes.txt": "see ghsa-ABCD-efgh-ijkl" }), needles)).toEqual(["files hold a needle: docs/notes.txt"]);
    expect(treeProblems(repo({ "CLAUDE.md": "Fixed CVE-2026-1234 here" }), needles)).toEqual(["files hold a needle: CLAUDE.md"]);
    expect(treeProblems(repo({ ".claude/commands/x.md": "see GHSA-abcd-efgh-ijkl" }), needles)).toEqual(["files hold a needle: .claude/commands/x.md"]);
    expect(treeProblems(repo({ "AGENTS.md": "rrb-case-1" }), { strings: ["rrb-case-1"], fix: null })).toEqual(["files hold a needle: AGENTS.md"]);
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
  test("containmentAt checks out a revision of a bare clone, takes its inventory and cleans up", () => {
    const root = repo({ "AGENTS.md": "x", ".claude/settings.json": "not json" });
    const bad = git(root, "rev-parse", "HEAD"), good = git(root, "rev-parse", "HEAD^");
    const scratch = mkdtempSync(join(tmpdir(), "rms-gates-"));
    const bare = join(scratch, "bare.git");
    git(scratch, "clone", "-q", "--bare", root, bare);
    expect(containmentAt(bare, good, good, needles, join(scratch, "wt", "x"))).toMatchObject({ g4: "ok", instructions: { files: {}, strip: [], refuse: null } });
    const c = containmentAt(bare, bad, good, needles, join(scratch, "wt", "x"));
    expect(c.g4).toEqual({ fail: ".claude/settings.json is not a JSON object, so its executable settings cannot be stripped" });
    expect(c.instructions.changed_by_unit).toEqual([".claude/settings.json", "AGENTS.md"]);
    expect(git(bare, "worktree", "list").split("\n")).toHaveLength(1);
  });
});

describe("instruction files under pre-run change 2", () => {
  const settings = { hooks: { PreToolUse: [] }, permissions: { allow: ["Bash(*)"] }, statusLine: { type: "command", command: "x" }, model: "opus", env: { A: "1" } };
  test("inventory hashes every instruction file, flags each type and plans the strip", () => {
    const root = repo({ "CLAUDE.md": "c", "docs/AGENTS.md": "a", ".claude/settings.json": JSON.stringify(settings), ".claude/settings.local.json": JSON.stringify({ model: "x" }), ".claude/skills/s/SKILL.md": "s", ".mcp.json": "{}", "pkg/.mcp.json": "{}" });
    const inv = inventory(root, null);
    expect(Object.keys(inv.files)).toEqual([".claude/settings.json", ".claude/settings.local.json", ".claude/skills/s/SKILL.md", ".mcp.json", "CLAUDE.md", "docs/AGENTS.md", "pkg/.mcp.json"]);
    expect(inv.files["CLAUDE.md"]).toBe(createHash("sha256").update("c").digest("hex"));
    expect(inv.flags).toEqual({ claude_md: true, root_claude_md: true, agents_md: true, claude_dir: true, settings: true, mcp_json: true });
    expect(inv.strip.map((s) => [s.path, s.action, s.keys])).toEqual([[".claude/settings.json", "keys", ["hooks", "permissions", "statusLine"]], [".mcp.json", "removed", []], ["pkg/.mcp.json", "removed", []]]);
    expect(inv.refuse).toBeNull();
    stripExecutable(root, inv);
    expect(JSON.parse(readFileSync(join(root, ".claude/settings.json"), "utf8"))).toEqual({ model: "opus", env: { A: "1" } });
    expect(createHash("sha256").update(readFileSync(join(root, ".claude/settings.json"))).digest("hex")).toBe(inv.strip[0]!.sha256_after!);
    expect(existsSync(join(root, ".mcp.json")) || existsSync(join(root, "pkg/.mcp.json"))).toBe(false);
    expect(git(root, "status", "--porcelain")).toBe("");
    expect(git(root, "show", "HEAD:.mcp.json")).toBe("{}");
  });
  test("a submodule under .claude/ is hashed by its commit", () => {
    const sub = repo();
    const root = repo();
    git(root, "-c", "protocol.file.allow=always", "submodule", "add", "-q", sub, ".claude/skills/vendored");
    git(root, "commit", "-q", "-m", "add submodule");
    const inv = inventory(root, null);
    expect(inv.files[".claude/skills/vendored"]).toBe(createHash("sha256").update("gitlink:" + git(sub, "rev-parse", "HEAD")).digest("hex"));
    expect(inv.flags.claude_dir).toBe(true);
  });
  test("a tree with none has no flags; a nested CLAUDE.md is not the repo's", () => {
    expect(inventory(repo(), null).flags).toEqual({ claude_md: false, root_claude_md: false, agents_md: false, claude_dir: false, settings: false, mcp_json: false });
    expect(inventory(repo({ "pkg/CLAUDE.md": "x" }), null).flags).toMatchObject({ claude_md: true, root_claude_md: false });
  });
});
