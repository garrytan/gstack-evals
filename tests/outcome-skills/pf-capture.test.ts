// Copyright (c) 2026 Garry Tan. MIT License.
import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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

