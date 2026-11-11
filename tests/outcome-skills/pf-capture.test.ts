// Copyright (c) 2026 Garry Tan. MIT License.
import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, truncateSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commitLocal, inventoryLocal } from "../../lanes/outcome-skills/pfchecks/capture.ts";

const git = (d: string, ...a: string[]) => spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd: d, encoding: "utf8" });
test("captures new, changed, ignored and deleted paths outside the build-output list, and counts the forced ones", () => {
  const d = mkdtempSync(join(tmpdir(), "pf-cap-"));
  git(d, "init", "-q", "-b", "main");
  writeFileSync(join(d, ".gitignore"), ".claude/skills/\n*.log\n");
  writeFileSync(join(d, "a.go"), "package a\n");
  writeFileSync(join(d, "gone.txt"), "x\n");
  git(d, "add", "-A");
  git(d, "commit", "-q", "-m", "base");
  mkdirSync(join(d, "build"));
  writeFileSync(join(d, "build", "pre.o"), "old");
  const inv = join(d, "..", "inv-" + Date.now());
  writeFileSync(inv, inventoryLocal(d));
  mkdirSync(join(d, ".claude", "skills", "verify"), { recursive: true });
  writeFileSync(join(d, ".claude", "skills", "verify", "SKILL.md"), "---\nname: verify\n---\n");
  writeFileSync(join(d, "a.go"), "package a\n// edited\n");
  writeFileSync(join(d, "a_test.go"), "package a\n");
  writeFileSync(join(d, "build", "out.o"), "bin");
  mkdirSync(join(d, "sub", "target"), { recursive: true });
  writeFileSync(join(d, "sub", "target", "x"), "bin");
  rmSync(join(d, "gone.txt"));
  const c = commitLocal(d, inv);
  expect(c.forced).toEqual([".claude/skills/verify/SKILL.md"]);
  expect(c.changed).toBe(3);
  expect(c.deleted).toBe(1);
  const files = git(d, "ls-tree", "-r", "--name-only", "HEAD").stdout.trim().split("\n").sort();
  expect(files).toEqual([".claude/skills/verify/SKILL.md", ".gitignore", "a.go", "a_test.go"]);
  const log = git(d, "log", "-1", "--format=%an %ae %aI %s").stdout.trim();
  expect(log).toBe("session session@localhost 2000-01-01T00:00:01Z session end");
});

// Value: protects=section 6.1's capture rule for listed build-output directories; fails_when=a listed directory git tracks files in at the base (src/bin, a Java build package, a tracked dist/) is pruned, or an untracked one is captured, or a glob character in a tracked directory's name widens the exception; why_new=the any-depth prune dropped src/bin and Java build packages from S; seam=sh/capture.sh list; no_claim=what the scoring trees keep (pf-trees.test.ts)
test("a listed build-output directory is pruned only when git tracks no file under it at the base", () => {
  const d = mkdtempSync(join(tmpdir(), "pf-cap-listed-"));
  git(d, "init", "-q", "-b", "main");
  const base: Record<string, string> = { "src/bin/tool.rs": "fn main() {}\n", "src/test/java/com/x/build/OldTest.java": "class OldTest {}\n", "dist/app.js": "old\n", "p[1]/dist/x.js": "old\n", "lib.rs": "\n" };
  for (const [p, t] of Object.entries(base)) {
    mkdirSync(join(d, p, ".."), { recursive: true });
    writeFileSync(join(d, p), t);
  }
  git(d, "add", "-A");
  git(d, "commit", "-q", "-m", "base");
  const inv = join(d, "..", "inv-listed-" + Date.now());
  writeFileSync(inv, inventoryLocal(d));
  const now: Record<string, string> = { "src/bin/tool.rs": "fn main() {}\n#[cfg(test)]\nmod tests {}\n", "src/test/java/com/x/build/NewTest.java": "class NewTest {}\n", "dist/app.js": "rebuilt\n", "dist/chunk.js": "new\n", "p[1]/dist/x.js": "rebuilt\n", "p1/dist/y.js": "out\n", "target/debug/x": "bin", "sub/build/y.o": "bin", "src/bin2/out/z": "bin" };
  for (const [p, t] of Object.entries(now)) {
    mkdirSync(join(d, p, ".."), { recursive: true });
    writeFileSync(join(d, p), t);
  }
  const c = commitLocal(d, inv);
  expect(c.changed).toBe(5);
  const files = git(d, "ls-tree", "-r", "--name-only", "HEAD").stdout.trim().split("\n").sort();
  expect(files).toEqual(["dist/app.js", "dist/chunk.js", "lib.rs", "p[1]/dist/x.js", "src/bin/tool.rs", "src/test/java/com/x/build/NewTest.java", "src/test/java/com/x/build/OldTest.java"]);
  expect(git(d, "show", "HEAD:src/bin/tool.rs").stdout).toContain("mod tests");
  expect(git(d, "show", "HEAD:dist/app.js").stdout).toBe("rebuilt\n");
  rmSync(d, { recursive: true, force: true });
});

// The inventory as capture.sh printed it before the one-pass hashing (e31a95b): one sha256sum per file. Kept here to hold
// the new implementation to the same bytes.
const OLD_INVENTORY = [
  "set -euo pipefail",
  "cd \"$1\"",
  "list() {",
  "  find . \\( -name .git -prune \\) -o \\( -type d \\( -name target -o -name build -o -name out -o -name dist -o -name bin -o -name obj \\",
  "    -o -name node_modules -o -name .venv -o -name venv -o -name __pycache__ -o -name .gradle -o -name .pytest_cache -o -name .tox \\",
  "    -o -name .mypy_cache -o -name .cache -o -name CMakeFiles -o -name 'cmake-build-*' \\) -prune \\) -o \\( \\( -type f -o -type l \\) -print0 \\) | LC_ALL=C sort -z",
  "}",
  "hashes() {",
  "  while IFS= read -r -d '' f; do",
  "    f=${f#./}",
  "    case $f in *$'\\n'*|*$'\\t'*) continue;; esac",
  "    if [ -L \"$f\" ]; then h=$(printf 'link:%s' \"$(readlink -- \"$f\")\" | sha256sum); else h=$(sha256sum < \"$f\"); fi",
  "    printf '%s\\t%s\\n' \"${h%% *}\" \"$f\"",
  "  done",
  "}",
  "list | hashes",
].join("\n");

const tricky = (d: string) => {
  const files: Record<string, string> = { "a b.txt": "x\n", "\u00fcn\u00ef/\u00e7\u00f8d\u00e9.go": "package u\n", "back\\slash.txt": "b", "cr\rname": "c", "-rf": "r", empty: "", "tab\tname": "t", "new\nline": "n", "deep/er/file.rs": "fn x() {}\n" };
  for (const [p, t] of Object.entries(files)) {
    mkdirSync(join(d, p, ".."), { recursive: true });
    writeFileSync(join(d, p), t);
  }
  writeFileSync(Buffer.concat([Buffer.from(d + "/lat"), Buffer.from([0xe9]), Buffer.from(".txt")]), "l");
  for (const [p, to] of Object.entries({ "link-file": "a b.txt", "link-dangling": "nowhere/x", "link-dir": "\u00fcn\u00ef", "link \u00fcn\u00ef": "\u00fcn\u00ef/\u00e7\u00f8d\u00e9.go", "deep/link-up": "../a b.txt" })) symlinkSync(to, join(d, p));
};

// Value: protects=section 6.1's inventory bytes across the one-pass hashing; fails_when=a content hash, a symlink's link:<target> hash, the order or the skip of names holding a tab or newline differs from the per-file implementation; why_new=capture and save now hash the tree once with batched sha256sum; seam=sh/capture.sh hashes; no_claim=the 120 s hold (driver/stage.ts)
test("the one-pass inventory is byte-identical to the per-file implementation on symlinks, spaces, backslashes and names outside ASCII", () => {
  const d = mkdtempSync(join(tmpdir(), "pf-cap-inv-"));
  git(d, "init", "-q", "-b", "main");
  tricky(d);
  const old = spawnSync("bash", ["-c", OLD_INVENTORY, "bash", d], { encoding: "utf8" });
  expect(old.status).toBe(0);
  expect(old.stdout.split("\n").length).toBe(14);
  expect(inventoryLocal(d)).toBe(old.stdout);
  rmSync(d, { recursive: true, force: true });
});

// Value: protects=section 4's wrap-up rule that S's head and inventory are saved right after the session-end commit; fails_when=the save needs a second hashing pass, or its inventory differs from a fresh one; why_new=wrapup.sh save hashed the whole tree again inside the 120 s hold; seam=capture.sh commit with a save dir; no_claim=wrapup.sh keep (pf-session.test.ts)
test("capture.sh commit with a save dir writes S's head and an inventory byte-identical to a fresh one, in the same run", () => {
  const d = mkdtempSync(join(tmpdir(), "pf-cap-save-"));
  git(d, "init", "-q", "-b", "main");
  writeFileSync(join(d, "a.go"), "package a\n");
  git(d, "add", "-A");
  git(d, "commit", "-q", "-m", "base");
  const inv = join(d, "..", "inv-save-" + Date.now());
  writeFileSync(inv, inventoryLocal(d));
  tricky(d);
  const save = join(mkdtempSync(join(tmpdir(), "pf-cap-dir-")), "work");
  const c = commitLocal(d, inv, save);
  expect(readFileSync(join(save, "s.head"), "utf8")).toBe(c.head + "\n");
  expect(readFileSync(join(save, "s.inv"), "utf8")).toBe(inventoryLocal(d));
  expect(readFileSync(join(save, "s.inv"), "utf8")).toBe(spawnSync("bash", ["-c", OLD_INVENTORY, "bash", d], { encoding: "utf8" }).stdout);
  rmSync(d, { recursive: true, force: true });
});

// Value: protects=section 6.1's capture of every changed path, root files named - and -- included; fails_when=the batched hasher reads a file named - as stdin, so its hash is the empty input's and an edit to it never reaches S; why_new=#305's outside voice (s11/outside-voice#1) found that the one-pass hasher strips ./ before sha256sum; seam=sh/capture.sh hashes; no_claim=names holding a tab or newline, which the inventory skips by design
test("a root file named - is hashed by its content, and an edit to it reaches S", () => {
  const d = mkdtempSync(join(tmpdir(), "pf-cap-dash-"));
  git(d, "init", "-q", "-b", "main");
  for (const [p, t] of Object.entries({ "-": "old\n", "--": "dd\n", "-n": "n\n", "sub/-": "s\n" })) {
    mkdirSync(join(d, p, ".."), { recursive: true });
    writeFileSync(join(d, p), t);
  }
  git(d, "add", "-A");
  git(d, "commit", "-q", "-m", "base");
  const sha = (t: string) => createHash("sha256").update(t).digest("hex");
  const before = inventoryLocal(d);
  expect(before).toBe(["-\told\n", "--\tdd\n", "-n\tn\n", "sub/-\ts\n"].map((l) => { const [p, t] = l.split("\t") as [string, string]; return sha(t) + "\t" + p + "\n"; }).join(""));
  const inv = join(d, "..", "inv-dash-" + Date.now());
  writeFileSync(inv, before);
  writeFileSync(join(d, "-"), "new\n");
  writeFileSync(join(d, "sub", "-"), "t\n");
  const c = commitLocal(d, inv);
  expect(c.changed).toBe(2);
  expect(git(d, "show", "HEAD:-").stdout).toBe("new\n");
  expect(git(d, "show", "HEAD:sub/-").stdout).toBe("t\n");
  rmSync(d, { recursive: true, force: true });
});

// Value: protects=section 6.1's capture of every changed path, a change to a file's executable bit alone included; fails_when=the inventory compares content only, so a test launcher the agent made executable (or one it made plain) keeps base's mode in S and scoring gets permission denied; why_new=#305's Capy review (capture.sh:56); seam=sh/capture.sh hashes and commit; no_claim=modes git does not record (only the owner's executable bit is tracked)
test("a change to a file's executable bit alone reaches S, in both directions, and an untouched file is not captured", () => {
  const d = mkdtempSync(join(tmpdir(), "pf-cap-mode-"));
  git(d, "init", "-q", "-b", "main");
  for (const p of ["run-tests.sh", "tool.sh", "keep.sh"]) writeFileSync(join(d, p), "#!/bin/sh\nexit 0\n");
  chmodSync(join(d, "tool.sh"), 0o755);
  git(d, "add", "-A");
  git(d, "commit", "-q", "-m", "base");
  const inv = join(d, "..", "inv-mode-" + Date.now());
  const before = inventoryLocal(d);
  writeFileSync(inv, before);
  chmodSync(join(d, "run-tests.sh"), 0o755);
  chmodSync(join(d, "tool.sh"), 0o644);
  const after = inventoryLocal(d);
  expect(after).not.toBe(before);
  expect(after.split("\n").find((l) => l.endsWith("\tkeep.sh"))).toBe(before.split("\n").find((l) => l.endsWith("\tkeep.sh")));
  const c = commitLocal(d, inv);
  expect(c.changed).toBe(2);
  const modes = Object.fromEntries(git(d, "ls-tree", "HEAD").stdout.trim().split("\n").map((l) => [l.split("\t")[1], l.split(" ")[0]]));
  expect(modes).toEqual({ "keep.sh": "100644", "run-tests.sh": "100755", "tool.sh": "100644" });
  rmSync(d, { recursive: true, force: true });
});


// Value: protects=section 6.1's prune of listed build-output directories when the base tracks only a placeholder under one (build/.gitkeep and the like); fails_when=a tracked .gitkeep, .keep, .gitignore or .empty keeps a listed directory in the inventory, so capture force-adds every ignored artefact under it, or a placeholder next to a real tracked file prunes that directory; why_new=#305's run notes item 3 (15 of the 798 pool units in the drive's candidate file track a placeholder-only listed directory at base, five of them fluent-bit's build/ and bin/); seam=sh/capture.sh list; no_claim=what the transplant keeps from a captured listed directory (pf-trees.test.ts)
test("a listed build-output directory whose only tracked files are placeholders is pruned like an untracked one", () => {
  const d = mkdtempSync(join(tmpdir(), "pf-cap-keep-"));
  git(d, "init", "-q", "-b", "main");
  const base: Record<string, string> = { ".gitignore": "*.o\n/dist/*\n!/dist/.gitignore\n", "build/.gitkeep": "", "bin/.keep": "", "dist/.gitignore": "*\n", "pkg/out/.empty": "", "lib/build/.gitkeep": "", "lib/build/gen.c": "int g;\n", "src/a.c": "int a;\n" };
  for (const [p, t] of Object.entries(base)) {
    mkdirSync(join(d, p, ".."), { recursive: true });
    writeFileSync(join(d, p), t);
  }
  git(d, "add", "-f", "-A");
  git(d, "commit", "-q", "-m", "base");
  const inv = join(d, "..", "inv-keep-" + Date.now());
  writeFileSync(inv, inventoryLocal(d));
  const now: Record<string, string> = { "build/main.o": "obj", "build/CMakeCache.txt": "cache", "bin/tool": "elf", "dist/app.js": "bundle", "pkg/out/x.o": "obj", "lib/build/gen.o": "obj", "lib/build/gen_test.c": "int t;\n", "src/a_test.c": "int t;\n" };
  for (const [p, t] of Object.entries(now)) {
    mkdirSync(join(d, p, ".."), { recursive: true });
    writeFileSync(join(d, p), t);
  }
  const c = commitLocal(d, inv);
  expect(c.forced).toEqual(["lib/build/gen.o"]);
  expect(c.changed).toBe(3);
  const files = git(d, "ls-tree", "-r", "--name-only", "HEAD").stdout.trim().split("\n").sort();
  expect(files).toEqual([".gitignore", "bin/.keep", "build/.gitkeep", "dist/.gitignore", "lib/build/.gitkeep", "lib/build/gen.c", "lib/build/gen.o", "lib/build/gen_test.c", "pkg/out/.empty", "src/a.c", "src/a_test.c"]);
  rmSync(d, { recursive: true, force: true });
});

const SH = join(import.meta.dir, "../../lanes/outcome-skills/pfchecks/sh");
// Value: protects=#305's run notes item 4 for a file the agent's leftover process deletes while the capture hashes the tree; fails_when=the hashing fails with no PF_ARM_STATE line naming the file, names a file that is still there, or a tree with nothing vanishing fails; why_new=a failed hash gave pf_turns no cause in what the agent wrote to route on; seam=capture.sh hashes; no_claim=the routing itself (pf_agent_sdk_test.py)
test("a file that vanishes while the capture hashes the tree fails the inventory with a PF_ARM_STATE vanished line naming only that file", () => {
  const d = mkdtempSync(join(tmpdir(), "pf-cap-vanish-"));
  const repo = join(d, "repo");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  writeFileSync(join(repo, "keep.txt"), "keep\n");
  writeFileSync(join(repo, "gone.txt"), "gone\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "base");
  const real = spawnSync("sh", ["-c", "command -v sha256sum"], { encoding: "utf8" }).stdout.trim();
  const bin = join(d, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "sha256sum"), "#!/bin/sh\nrm -f ./gone.txt\nexec " + real + ' "$@"\n');
  chmodSync(join(bin, "sha256sum"), 0o755);
  const run = (path: string) => spawnSync("bash", [join(SH, "capture.sh"), "inventory", repo], { encoding: "utf8", env: { ...process.env, PATH: path } });
  const clean = run(process.env.PATH ?? "");
  expect([clean.status, clean.stderr]).toEqual([0, ""]);
  const r = run(bin + ":" + (process.env.PATH ?? ""));
  expect(r.status).not.toBe(0);
  expect(r.stderr.split("\n").filter((l) => l.startsWith("PF_ARM_STATE "))).toEqual(["PF_ARM_STATE vanished gone.txt"]);
  rmSync(d, { recursive: true, force: true });
});

// Value: protects=#305's run notes item 4: what makes a post-turn failure the arm's; fails_when=state.sh misses a cause in what the agent wrote (a work file the step needs, an s.head that names no commit, .git, its config, HEAD, the index, unmerged entries, a stale lock from the session), or names one on a clean tree, for a lock the harness made after the step started, or for one older than the session; why_new=every post-turn failure was E_PF_INFRA_GAP, whatever its cause; seam=sh/state.sh; no_claim=the routing in pf_turns and run.ts (pf_agent_sdk_test.py, pf-run.test.ts)
test("state.sh names each cause in what the agent wrote, and nothing on a clean tree, for a lock made after the step started or for one older than the session", () => {
  const d = mkdtempSync(join(tmpdir(), "pf-state-"));
  const repo = join(d, "repo");
  const work = join(d, "work");
  mkdirSync(repo);
  mkdirSync(work);
  git(repo, "init", "-q", "-b", "main");
  writeFileSync(join(repo, "a.txt"), "a\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "base");
  const head = git(repo, "rev-parse", "HEAD").stdout.trim();
  const at = (p: string, s: number) => utimesSync(p, new Date(Date.now() + s * 1000), new Date(Date.now() + s * 1000));
  const lock = join(repo, ".git", "index.lock");
  writeFileSync(lock, "");
  at(lock, -600);
  for (const [n, body] of [["inv", ""], ["s.head", head + "\n"], ["s.inv", ""], ["pf-step.stamp", ""]] as const) writeFileSync(join(work, n), body);
  at(join(work, "inv"), -300);
  const state = (...names: string[]) => {
    const r = spawnSync("bash", [join(SH, "state.sh"), repo, work, ...names], { encoding: "utf8" });
    expect(r.status).toBe(0);
    return r.stdout.split("\n").filter(Boolean);
  };
  expect(state("inv", "s.head", "s.inv")).toEqual([]);
  at(lock, 60);
  expect(state()).toEqual([]);
  at(lock, -60);
  expect(state()).toEqual(["PF_ARM_STATE lock .git/index.lock"]);
  rmSync(lock);
  rmSync(join(work, "s.head"));
  rmSync(join(work, "inv"));
  expect(state("inv", "s.head", "s.inv")).toEqual(["PF_ARM_STATE missing inv", "PF_ARM_STATE missing s.head"]);
  writeFileSync(join(work, "s.head"), "f".repeat(40) + "\n");
  expect(state("s.head")).toEqual(["PF_ARM_STATE s.head names no commit"]);
  writeFileSync(join(work, "s.head"), head + "\n");
  const config = readFileSync(join(repo, ".git", "config"), "utf8");
  writeFileSync(join(repo, ".git", "config"), "[core\n");
  expect(state()).toEqual(["PF_ARM_STATE config .git/config is unreadable"]);
  writeFileSync(join(repo, ".git", "config"), config + "[core]\n\tbare = true\n");
  expect(state()).toEqual(["PF_ARM_STATE worktree git sees no work tree at the repository root"]);
  writeFileSync(join(repo, ".git", "config"), config);
  writeFileSync(join(repo, ".git", "HEAD"), "ref: refs/heads/nowhere\n");
  expect(state()).toEqual(["PF_ARM_STATE head HEAD names no commit"]);
  writeFileSync(join(repo, ".git", "HEAD"), "ref: refs/heads/main\n");
  writeFileSync(join(repo, ".git", "index"), "not an index");
  expect(state()).toEqual(["PF_ARM_STATE index the index is unreadable"]);
  rmSync(join(repo, ".git", "index"));
  git(repo, "reset", "-q");
  git(repo, "checkout", "-q", "-b", "other");
  writeFileSync(join(repo, "a.txt"), "other\n");
  git(repo, "commit", "-q", "-am", "other");
  git(repo, "checkout", "-q", "main");
  writeFileSync(join(repo, "a.txt"), "main\n");
  git(repo, "commit", "-q", "-am", "main");
  git(repo, "merge", "-q", "other");
  expect(state()).toEqual(["PF_ARM_STATE unmerged the index has unmerged entries"]);
  rmSync(join(repo, ".git"), { recursive: true, force: true });
  expect(state()).toEqual(["PF_ARM_STATE git_dir .git is not a directory"]);
  rmSync(repo, { recursive: true, force: true });
  expect(state()).toEqual(["PF_ARM_STATE repo " + repo + " is not a directory"]);
  rmSync(d, { recursive: true, force: true });
});

const sessionTree = (prefix: string) => {
  const d = mkdtempSync(join(tmpdir(), prefix));
  const repo = join(d, "repo");
  const work = join(d, "work");
  mkdirSync(repo);
  mkdirSync(work);
  git(repo, "init", "-q", "-b", "main");
  writeFileSync(join(repo, "a.txt"), "a\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "base");
  Bun.sleepSync(30);
  writeFileSync(join(work, "inv"), "");
  writeFileSync(join(work, "inv.filters"), "");
  writeFileSync(join(work, "pf-step.stamp"), "");
  Bun.sleepSync(30);
  const state = (pre: string[] = [], env: Record<string, string> = {}) => {
    const r = spawnSync("bash", [join(SH, "state.sh"), ...pre, repo, work], { encoding: "utf8", env: { ...process.env, ...env } });
    expect(r.status).toBe(0);
    return r.stdout.split("\n").filter(Boolean);
  };
  const later = (p: string) => utimesSync(p, new Date(Date.now() + 60_000), new Date(Date.now() + 60_000));
  return { d, repo, work, state, later };
};

// Value: protects=the Captain's ruling item 4 on #324 (red-team#3): a post-turn step that times out on a tree the agent grew is the arm's; fails_when=state.sh names no growth on a timed-out step after the session wrote 8 GiB the capture lists, or names it below 8 GiB, without --timed-out, for a pruned directory or for files from before the session; why_new=every step timeout was E_PF_CAPTURE, whatever the tree held; seam=sh/state.sh with capture.sh size; no_claim=the 2,000,000-file bound's value (capture.sh size's own test covers the file count and its stop)
test("on a timed-out step, state.sh names a tree the session grew by 8 GiB, and nothing below that, without --timed-out, in a pruned directory or from before the session", () => {
  const { d, repo, work, state, later } = sessionTree("pf-state-grown-");
  expect(state(["--timed-out"])).toEqual(["PF_TREE_SIZE files=0 bytes=0 stopped=0"]);
  const big = join(repo, "states.bin");
  writeFileSync(big, "");
  truncateSync(big, 8 * 2 ** 30 - 1);
  expect(state(["--timed-out"])).toEqual(["PF_TREE_SIZE files=1 bytes=8589934591 stopped=0"]);
  truncateSync(big, 8 * 2 ** 30);
  expect(state(["--timed-out"])).toEqual(["PF_ARM_STATE grown the session wrote files=1 bytes=8589934592, at least 2000000 files or 8589934592 bytes", "PF_TREE_SIZE files=1 bytes=8589934592 stopped=1"]);
  expect(state()).toEqual([]);
  mkdirSync(join(repo, "node_modules"));
  renameSync(big, join(repo, "node_modules", "states.bin"));
  expect(state(["--timed-out"])).toEqual(["PF_TREE_SIZE files=0 bytes=0 stopped=0"]);
  renameSync(join(repo, "node_modules", "states.bin"), big);
  later(join(work, "inv"));
  expect(state(["--timed-out"])).toEqual(["PF_TREE_SIZE files=0 bytes=0 stopped=0"]);
  rmSync(d, { recursive: true, force: true });
});

// Value: protects=the Captain's ruling item 4 on #324: the growth count state.sh reads on a timeout; fails_when=capture.sh size counts a file the capture does not list (a pruned directory, .git, a file from before the session), misses one it lists, or does not stop at the first bound reached; why_new=nothing counted what the session wrote; seam=capture.sh size; no_claim=the routing (state.sh's test, pf_agent_sdk_test.py)
test("capture.sh size counts the files and bytes the session wrote as the capture lists them, and stops at the first bound it reaches", () => {
  const { d, repo, work } = sessionTree("pf-size-");
  mkdirSync(join(repo, "new"));
  for (const n of [1, 2, 3, 4, 5]) writeFileSync(join(repo, "new", "f" + n), "x\n");
  mkdirSync(join(repo, "node_modules"));
  writeFileSync(join(repo, "node_modules", "skip"), "skipped\n");
  mkdirSync(join(repo, "target"));
  writeFileSync(join(repo, "target", "skip"), "skipped\n");
  writeFileSync(join(repo, ".git", "skip"), "skipped\n");
  const size = (...limits: string[]) => {
    const r = spawnSync("bash", [join(SH, "capture.sh"), "size", repo, join(work, "inv"), ...limits], { encoding: "utf8" });
    expect([r.status, r.stderr]).toEqual([0, ""]);
    return r.stdout;
  };
  expect(size("100", "1000")).toBe("files=5 bytes=10 stopped=0\n");
  expect(size("3", "1000")).toBe("files=3 bytes=6 stopped=1\n");
  expect(size("100", "4")).toBe("files=2 bytes=4 stopped=1\n");
  rmSync(d, { recursive: true, force: true });
});

// Value: protects=the Captain's ruling item 4 on #324 (adversarial-native#2): a file or directory the agent made unreadable makes a failed capture the arm's; fails_when=state.sh misses an unreadable file or a directory the capture cannot enter, or names a symlink, a path in a pruned directory or one from before the session; why_new=sha256sum's and find's permission errors printed no PF_ARM_STATE line, so the failure was E_PF_CAPTURE; seam=sh/state.sh with capture.sh unreadable; no_claim=a step run as root, where nothing is unreadable
test.skipIf(process.getuid?.() === 0)("state.sh names a file or directory the session made unreadable, as the capture lists it, after the inventory fails on them", () => {
  const { d, repo, work, state, later } = sessionTree("pf-state-unreadable-");
  writeFileSync(join(repo, "u.txt"), "u\n");
  chmodSync(join(repo, "u.txt"), 0);
  mkdirSync(join(repo, "locked"));
  writeFileSync(join(repo, "locked", "f"), "f\n");
  chmodSync(join(repo, "locked"), 0o600);
  mkdirSync(join(repo, "node_modules"));
  writeFileSync(join(repo, "node_modules", "x"), "x\n");
  chmodSync(join(repo, "node_modules", "x"), 0);
  symlinkSync("missing", join(repo, "dangling"));
  const inv = spawnSync("bash", [join(SH, "capture.sh"), "inventory", repo], { encoding: "utf8" });
  expect(inv.status).not.toBe(0);
  expect(state()).toEqual(["PF_ARM_STATE unreadable locked", "PF_ARM_STATE unreadable u.txt"]);
  later(join(work, "inv"));
  expect(state()).toEqual([]);
  chmodSync(join(repo, "locked"), 0o755);
  rmSync(d, { recursive: true, force: true });
});

// Value: protects=the Captain's ruling item 4 on #324 (adversarial-native#2): a link the agent's process removes makes a failed capture the arm's; fails_when=a symlink that vanishes while the tree is hashed hashes as link: and the run passes, or a file that vanishes before the commit adds it fails with no PF_ARM_STATE line, or a line names a path that is still there; why_new=readlink failed silently inside $( ), and a failed git add named no cause; seam=capture.sh hashes and commit; no_claim=the routing (pf_agent_sdk_test.py)
test("a symlink that vanishes while the capture hashes the tree, or a file that vanishes before the commit adds it, fails with a PF_ARM_STATE vanished line naming only that path", () => {
  const d = mkdtempSync(join(tmpdir(), "pf-cap-vanish-link-"));
  const repo = join(d, "repo");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  writeFileSync(join(repo, "keep.txt"), "keep\n");
  symlinkSync("keep.txt", join(repo, "link"));
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "base");
  const which = (c: string) => spawnSync("sh", ["-c", "command -v " + c], { encoding: "utf8" }).stdout.trim();
  const bin = join(d, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "sha256sum"), "#!/bin/sh\nrm -f ./link\nexec " + which("sha256sum") + ' "$@"\n');
  chmodSync(join(bin, "sha256sum"), 0o755);
  const run = (path: string, ...args: string[]) => spawnSync("bash", [join(SH, "capture.sh"), ...args], { encoding: "utf8", env: { ...process.env, PATH: path } });
  const arm = (r: { stderr: string }) => r.stderr.split("\n").filter((l) => l.startsWith("PF_ARM_STATE "));
  const clean = run(process.env.PATH ?? "", "inventory", repo);
  expect([clean.status, clean.stderr]).toEqual([0, ""]);
  writeFileSync(join(d, "inv"), clean.stdout);
  const r = run(bin + ":" + (process.env.PATH ?? ""), "inventory", repo);
  expect(r.status).not.toBe(0);
  expect(arm(r)).toEqual(["PF_ARM_STATE vanished link"]);
  symlinkSync("keep.txt", join(repo, "link"));
  writeFileSync(join(repo, "new.txt"), "new\n");
  const gbin = join(d, "gbin");
  mkdirSync(gbin);
  writeFileSync(join(gbin, "git"), '#!/bin/sh\ncase " $* " in *" check-ignore "*) rm -f new.txt ;; esac\nPATH=${PATH#*:} exec git "$@"\n');
  chmodSync(join(gbin, "git"), 0o755);
  const c = run(gbin + ":" + (process.env.PATH ?? ""), "commit", repo, join(d, "inv"));
  expect(c.status).not.toBe(0);
  expect(arm(c)).toEqual(["PF_ARM_STATE vanished new.txt"]);
  rmSync(d, { recursive: true, force: true });
});

// Value: protects=the Captain's ruling item 4 on #324 (adversarial-native#2): git filters the agent set make a failed post-turn step the arm's; fails_when=state.sh misses a filter key in .git/config or in a file it includes, or names one from another config file; why_new=a filter in .git/config that git can still read printed no PF_ARM_STATE line; seam=sh/state.sh; no_claim=fsmonitor, hooks or the global config
test("state.sh names every filter key the session set in .git/config, through an include too, and none from the global config", () => {
  const { d, repo, state } = sessionTree("pf-state-filter-");
  const global = join(d, "global.cfg");
  writeFileSync(global, '[filter "lfs"]\n\tclean = git-lfs clean -- %f\n');
  expect(state([], { GIT_CONFIG_GLOBAL: global })).toEqual([]);
  git(repo, "config", "filter.x.clean", "false");
  git(repo, "config", "filter.x.required", "true");
  expect(state()).toEqual(["PF_ARM_STATE filter .git/config sets filter.x.clean", "PF_ARM_STATE filter .git/config sets filter.x.required"]);
  git(repo, "config", "--remove-section", "filter.x");
  writeFileSync(join(d, "extra.cfg"), '[filter "y"]\n\tsmudge = cat\n');
  git(repo, "config", "include.path", join(d, "extra.cfg"));
  expect(state()).toEqual(["PF_ARM_STATE filter .git/config sets filter.y.smudge"]);
  rmSync(d, { recursive: true, force: true });
});

// Value: protects=the owner's ruling B1: a git filter the dataset image's base repo already had is not the arm's; fails_when=state.sh names a filter key whose value the start inventory saved unchanged, misses one the session added or changed, or names any filter when inv.filters is missing; why_new=state.sh named every filter key in .git/config, so a base filter.lfs turned any infra failure of a post-turn step into E_PF_ARM post_turn; seam=sh/state.sh over <work>/inv.filters, which capture.sh filters writes at the start inventory; no_claim=the routing in pf_turns (pf_agent_sdk_test.py)
test("state.sh names only the filter keys the session added or changed since the start inventory, and none when inv.filters is missing", () => {
  const { d, repo, work, state } = sessionTree("pf-state-base-filter-");
  git(repo, "config", "filter.lfs.clean", "git-lfs clean -- %f");
  git(repo, "config", "filter.lfs.smudge", "git-lfs smudge -- %f");
  git(repo, "config", "filter.lfs.required", "true");
  const saved = spawnSync("bash", [join(SH, "capture.sh"), "filters", repo], { encoding: "utf8" });
  expect([saved.status, saved.stdout]).toEqual([0, "filter.lfs.clean\tgit-lfs clean -- %f\nfilter.lfs.required\ttrue\nfilter.lfs.smudge\tgit-lfs smudge -- %f\n"]);
  writeFileSync(join(work, "inv.filters"), saved.stdout);
  expect(state()).toEqual([]);
  git(repo, "config", "filter.lfs.clean", "sh -c 'cat'");
  git(repo, "config", "filter.x.smudge", "cat");
  expect(state()).toEqual(["PF_ARM_STATE filter .git/config sets filter.lfs.clean", "PF_ARM_STATE filter .git/config sets filter.x.smudge"]);
  rmSync(join(work, "inv.filters"));
  expect(state()).toEqual([]);
  rmSync(d, { recursive: true, force: true });
});

// Value: protects=the Captain's ruling item 5 on #324 (red-team#4): a lock the harness's own git leaves when pf_turns times its step out is infra; fails_when=state.sh names a lock on a timed-out step, or stops naming one the session's git left when the step failed without a timeout; why_new=a lock from the step's own git whose mtime fell in the stamp's clock tick read as the agent's; seam=sh/state.sh --timed-out; no_claim=a lock the agent's git left when the harness ended its turn (red-team#4's turn-end case)
test("on a timed-out step, state.sh names no lock, even one in the same clock tick as the step's stamp, and still names it when the step failed", () => {
  const { d, repo, work, state } = sessionTree("pf-state-timeout-lock-");
  const past = new Date(Date.now() - 300_000);
  utimesSync(join(work, "inv"), past, past);
  const lock = join(repo, ".git", "index.lock");
  writeFileSync(lock, "");
  expect(spawnSync("touch", ["-r", join(work, "pf-step.stamp"), lock]).status).toBe(0);
  expect(state()).toEqual(["PF_ARM_STATE lock .git/index.lock"]);
  expect(state(["--timed-out"])).toEqual(["PF_TREE_SIZE files=1 bytes=2 stopped=0"]);
  rmSync(d, { recursive: true, force: true });
});

// Value: protects=the Captain's ruling item 9 on #324: the harness's git after a paid turn runs nothing the session or the machine's git config set up; fails_when=a hook in .git/hooks, a core.fsmonitor command in .git/config, a filter from the system config or an excludesFile from the global config runs or counts during capture.sh commit, wrapup.sh keep or state.sh; why_new=commit passed --no-verify, but post-commit, reference-transaction, post-checkout, fsmonitor and outside config still reached the harness's git; seam=sh/capture.sh, sh/wrapup.sh and sh/state.sh git calls; no_claim=pf_turns' bundle step (bundle create runs no hook and reads no index) and the default ignore file under XDG_CONFIG_HOME, which git reads without any config
test("capture.sh commit, wrapup.sh keep and state.sh run no hook, fsmonitor or filter, and read no global or system config", () => {
  const { d, repo, work } = sessionTree("pf-cap-hooks-");
  const marks = join(d, "marks");
  const mark = (name: string) => {
    const p = join(d, "mark-" + name);
    writeFileSync(p, `#!/bin/sh\necho ${name} >> '${marks}'\n`);
    chmodSync(p, 0o755);
    return p;
  };
  for (const h of ["post-commit", "post-checkout", "reference-transaction", "post-index-change"]) {
    writeFileSync(join(repo, ".git", "hooks", h), `#!/bin/sh\necho ${h} >> '${marks}'\n`);
    chmodSync(join(repo, ".git", "hooks", h), 0o755);
  }
  git(repo, "config", "core.fsmonitor", mark("fsmonitor"));
  const home = join(d, "home");
  mkdirSync(join(home, ".config"), { recursive: true });
  writeFileSync(join(d, "global-ignore"), "new.txt\n");
  writeFileSync(join(home, ".gitconfig"), `[core]\n\texcludesFile = ${join(d, "global-ignore")}\n`);
  const sys = join(d, "system.cfg");
  writeFileSync(join(d, "attrs"), "sys.txt filter=mark\n");
  spawnSync("git", ["config", "--file", sys, "core.attributesFile", join(d, "attrs")]);
  spawnSync("git", ["config", "--file", sys, "filter.mark.clean", `sh -c 'echo filter >> "${marks}"; cat'`]);
  const env: Record<string, string | undefined> = { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, ".config"), GIT_CONFIG_SYSTEM: sys };
  delete env.GIT_CONFIG_GLOBAL;
  delete env.GIT_CONFIG_NOSYSTEM;
  const run = (...a: string[]) => spawnSync("bash", a, { encoding: "utf8", env });
  const ran = () => {
    let s = "";
    try { s = readFileSync(marks, "utf8"); rmSync(marks); } catch {}
    return [...new Set(s.split("\n").filter(Boolean))].sort();
  };
  const inv = join(d, "inv");
  writeFileSync(inv, run(join(SH, "capture.sh"), "inventory", repo).stdout);
  writeFileSync(join(repo, "new.txt"), "new\n");
  writeFileSync(join(repo, "sys.txt"), "sys\n");
  const c = run(join(SH, "capture.sh"), "commit", repo, inv, work);
  const seen: Record<string, unknown> = { capture: c.stdout.replace(/head=[0-9a-f]{40}/, "head=H"), commit: ran() };
  writeFileSync(join(repo, "later.txt"), "x\n");
  seen.wrapup = run(join(SH, "wrapup.sh"), "keep", repo, work).stdout;
  seen.keep = ran();
  run(join(SH, "state.sh"), repo, work, "s.head");
  seen.state = ran();
  expect(seen).toEqual({ capture: "PF_CAPTURE changed=2 deleted=0 forced=0 head=H\n", commit: [], wrapup: "PF_DISCARD later.txt\nPF_WRAPUP checks=0 discarded=1\n", keep: [], state: [] });
  rmSync(d, { recursive: true, force: true });
});

// Value: protects=the owner's addition to the Captain's ruling item 9 on #324: no ignore file outside the repository marks a path the harness's git captures as forced; fails_when=capture.sh commit counts a path as forced because an ignore file under XDG_CONFIG_HOME, which git reads with no config at all, lists it; why_new=item 9 cleared the global and system config, but git still read $XDG_CONFIG_HOME/git/ignore as its default core.excludesFile; seam=the git calls in sh/capture.sh, sh/state.sh, sh/wrapup.sh and pf_turns' bundle step, which now pass core.excludesFile=/dev/null; no_claim=a .gitignore or .git/info/exclude inside the repository, which still apply
test("capture.sh commit counts no path as forced through an ignore file under XDG_CONFIG_HOME", () => {
  const { d, repo, work } = sessionTree("pf-cap-xdg-");
  const xdg = join(d, "xdg");
  mkdirSync(join(xdg, "git"), { recursive: true });
  writeFileSync(join(xdg, "git", "ignore"), "new.txt\n");
  const env = { ...process.env, HOME: join(d, "home"), XDG_CONFIG_HOME: xdg };
  const run = (...a: string[]) => spawnSync("bash", a, { encoding: "utf8", env });
  const inv = join(d, "inv");
  writeFileSync(inv, run(join(SH, "capture.sh"), "inventory", repo).stdout);
  writeFileSync(join(repo, "new.txt"), "new\n");
  expect(spawnSync("git", ["check-ignore", "-q", "new.txt"], { cwd: repo, env }).status).toBe(0);
  const c = run(join(SH, "capture.sh"), "commit", repo, inv, work);
  expect([c.status, c.stdout.replace(/head=[0-9a-f]{40}/, "head=H")]).toEqual([0, "PF_CAPTURE changed=1 deleted=0 forced=0 head=H\n"]);
  rmSync(d, { recursive: true, force: true });
});

// Value: protects=the owner's ruling F1: on a timeout the cheap size count runs first, and a tree it already finds grown is not walked again; fails_when=state.sh --timed-out runs the unreadable scan before capture.sh size, or runs it after size names the grown line, or skips it on a tree that has not grown; why_new=the unreadable scan walked the whole tree first, so on a grown tree it could spend state.sh's own timeout before size ran; seam=sh/state.sh's order of capture.sh calls; no_claim=either count's own result (their own tests)
test("on a timed-out step, state.sh runs capture.sh size before the unreadable scan, and skips the scan once the tree has grown", () => {
  const { d, repo, work } = sessionTree("pf-state-order-");
  const sh = join(d, "sh");
  const log = join(d, "calls");
  mkdirSync(sh);
  writeFileSync(join(sh, "state.sh"), readFileSync(join(SH, "state.sh")));
  writeFileSync(join(sh, "capture.sh"), `#!/usr/bin/env bash\necho "$1" >> '${log}'\nexec bash '${join(SH, "capture.sh")}' "$@"\n`);
  const run = () => {
    rmSync(log, { force: true });
    const r = spawnSync("bash", [join(sh, "state.sh"), "--timed-out", repo, work], { encoding: "utf8" });
    return { grown: r.stdout.includes("PF_ARM_STATE grown "), calls: readFileSync(log, "utf8").split("\n").filter((c) => c === "size" || c === "unreadable") };
  };
  writeFileSync(join(repo, "b.txt"), "b\n");
  expect(run()).toEqual({ grown: false, calls: ["size", "unreadable"] });
  writeFileSync(join(repo, "states.bin"), "");
  truncateSync(join(repo, "states.bin"), 8 * 2 ** 30);
  expect(run()).toEqual({ grown: true, calls: ["size"] });
  rmSync(d, { recursive: true, force: true });
});

// Value: protects=the owner's ruling G1: the base-versus-session filter comparison reads every repo-level config scope; fails_when=a filter the session planted in .git/config.worktree under extensions.worktreeConfig is not named, or one the start inventory already saw there is; why_new=capture.sh filters read only --local, so a worktree-scope filter, which the harness's git still applies, was never a cause; seam=capture.sh filters and state.sh; no_claim=the system and global scopes, which the harness's git does not read
test("state.sh names a filter the session planted in .git/config.worktree under extensions.worktreeConfig, and not one the start inventory saw there", () => {
  const { d, repo, work, state } = sessionTree("pf-state-worktree-filter-");
  git(repo, "config", "extensions.worktreeConfig", "true");
  const save = () => writeFileSync(join(work, "inv.filters"), spawnSync("bash", [join(SH, "capture.sh"), "filters", repo], { encoding: "utf8" }).stdout);
  save();
  writeFileSync(join(repo, ".git", "config.worktree"), '[filter "w"]\n\tclean = cat\n');
  expect(git(repo, "config", "--get", "filter.w.clean").stdout).toBe("cat\n");
  expect(state()).toEqual(["PF_ARM_STATE filter .git/config sets filter.w.clean"]);
  save();
  expect(state()).toEqual([]);
  rmSync(d, { recursive: true, force: true });
});
