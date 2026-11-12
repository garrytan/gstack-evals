#!/usr/bin/env python3
# Copyright (c) 2026 Garry Tan. MIT License.
# Fixture tests for lanes/eng-review/contain-check.py (GEVA-434's containment check, carried by prereg
# 2026-11-11-geva-522 section 11). tests/er/contain-check.test.ts runs this file.
# usage: test-contain-check.py <contain-check.py>   synthetic repos only, no unit data. The unit repo is built by the
# lane's own buildUnitRepo (lanes/eng-review/author/run.ts), so the fixture has the real shape: a fresh one-commit repo
# holding the upstream base tree, gitlinks left out, with the upstream base commit absent.
import json, os, shutil, subprocess, sys, tempfile
S = os.path.abspath(sys.argv[1]); T = tempfile.mkdtemp(prefix="cc-fix-")
os.environ["GIT_OPTIONAL_LOCKS"] = "0"
BUILD = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "lanes", "eng-review", "author", "run.ts")
def sh(*a, cwd=None): return subprocess.run(a, cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()
def w(p, s):
    os.makedirs(os.path.dirname(p), exist_ok=True); open(p, "w").write(s)
def upstream(root):
    up = os.path.join(root, "clones", "fixture__up"); os.makedirs(up)
    sh("git", "init", "-q", "-b", "main", cwd=up)
    w(os.path.join(up, "src/a.ts"), "export const a = 1;\n"); w(os.path.join(up, ".gitignore"), "*.log\n"); w(os.path.join(up, "README.md"), "fixture\n")
    os.symlink("src/a.ts", os.path.join(up, "a-link")); w(os.path.join(up, "bin/run"), "#!/bin/sh\n"); os.chmod(os.path.join(up, "bin/run"), 0o755)
    w(os.path.join(up, ".gitattributes"), "*.txt text=auto\n"); open(os.path.join(up, "crlf.txt"), "wb").write(b"one\r\ntwo\r\n")
    sh("git", "add", "-A", cwd=up); sh("git", "update-index", "--add", "--cacheinfo", "160000," + "e" * 40 + ",vendor/sub", cwd=up)
    raw = sh("git", "hash-object", "-w", "--no-filters", "crlf.txt", cwd=up); sh("git", "update-index", "--cacheinfo", "100644," + raw + ",crlf.txt", cwd=up)
    sh("git", "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-q", "-m", "base", cwd=up); b = sh("git", "rev-parse", "HEAD", cwd=up)
    w(os.path.join(up, "tests/hidden.test.ts"), "test('hidden', () => {});\n"); sh("git", "add", "-A", cwd=up); sh("git", "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-q", "-m", "merge", cwd=up)
    return up, b, sh("git", "rev-parse", "HEAD", cwd=up)
def unit(root, build_rev=None):
    up, b, m = upstream(root)
    d = os.path.join(root, "units", "er-fixture"); os.makedirs(d)
    sh("bun", "-e", "import { buildUnitRepo } from '" + BUILD + "'; buildUnitRepo(process.argv[1], process.argv[2], process.argv[3]);", up, build_rev(b, m) if build_rev else b, os.path.join(d, "repo"))
    w(os.path.join(d, "plan.md"), "# plan\nadd a test\n")
    json.dump({"base_sha": b, "merge_sha": m, "aftermath": [], "repo": "fixture/up"}, open(os.path.join(d, "unit.json"), "w"))
    json.dump({"items": [{"file": "tests/hidden.test.ts"}, {"file": "src/a.ts"}], "diffstat": [{"file": "src/b.ts"}], "touched": {"files": []}}, open(os.path.join(d, "key.json"), "w"))
    w(os.path.join(root, "ids.txt"), "calibration er-fixture\n")
    return d, os.path.join(d, "repo")
def markers(root):
    out = os.path.join(root, "markers.json")
    sh("python3", S, "markers", os.path.join(root, "units"), os.path.join(root, "ids.txt"), out, os.path.join(root, "clones"))
    return out, json.load(open(out))["er-fixture"]
def check(mk, d):
    r = subprocess.run(["python3", S, "check", mk, "er-fixture=" + d], capture_output=True, text=True)
    return "checked 1 ok 1" in r.stdout, r.stdout + r.stderr
def staged_hidden(r): w(os.path.join(r, "tests/hidden.test.ts"), "test('hidden', () => {});\n"); sh("git", "add", "tests/hidden.test.ts", cwd=r)
def staged_hidden_gone(r): staged_hidden(r); os.remove(os.path.join(r, "tests/hidden.test.ts"))
def untracked(r): w(os.path.join(r, "tests/extra.test.ts"), "test('x', () => {});\n")
def ignored(r): w(os.path.join(r, "debug.log"), "later output\n")
def modified(r): w(os.path.join(r, "src/a.ts"), "export const a = 2;\n")
def skip_worktree(r): modified(r); sh("git", "update-index", "--skip-worktree", "src/a.ts", cwd=r)
def assume_unchanged(r): modified(r); sh("git", "update-index", "--assume-unchanged", "src/a.ts", cwd=r)
def staged_modified(r): modified(r); sh("git", "add", "src/a.ts", cwd=r); w(os.path.join(r, "src/a.ts"), "export const a = 1;\n")
def index_dropped(r): sh("git", "rm", "-q", "--cached", "README.md", cwd=r)
def head_moved(r): w(os.path.join(r, "src/b.ts"), "export const b = 1;\n"); sh("git", "add", "-A", cwd=r); sh("git", "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-q", "-m", "later", cwd=r)
def crlf_rewritten(r): open(os.path.join(r, "crlf.txt"), "wb").write(b"one\ntwo\n")
def symlink_retargeted(r): os.remove(os.path.join(r, "a-link")); os.symlink("README.md", os.path.join(r, "a-link"))
cases = [("clean", None, True), ("staged hidden test, also in worktree", staged_hidden, False), ("staged hidden test, removed from worktree", staged_hidden_gone, False),
         ("untracked file", untracked, False), ("ignored file", ignored, False), ("modified tracked file", modified, False),
         ("modified tracked file under skip-worktree", skip_worktree, False), ("modified tracked file under assume-unchanged", assume_unchanged, False),
         ("staged change, worktree back at base", staged_modified, False), ("base file dropped from the index", index_dropped, False),
         ("HEAD moved past the base commit", head_moved, False), ("symlink retargeted", symlink_retargeted, False), ("CRLF base file rewritten as LF (what git add stores)", crlf_rewritten, False)]
fails = 0
def say(ok, what):
    global fails; fails += not ok; print(("PASS" if ok else "FAIL"), what)
try:
    root = os.path.join(T, "clean"); d, r = unit(root); mk, m0 = markers(root)
    say("tests/hidden.test.ts" in m0["files_new"] and "src/a.ts" not in m0["files_new"], "markers list the aftermath-only file " + str(m0["files_new"]))
    say(subprocess.run(["git", "-C", r, "cat-file", "-e", json.load(open(os.path.join(d, "unit.json")))["base_sha"]], capture_output=True).returncode != 0, "fixture shape: the upstream base commit is absent from the unit repo")
    up_raw = sh("git", "-C", os.path.join(root, "clones", "fixture__up"), "rev-parse", json.load(open(os.path.join(d, "unit.json")))["base_sha"] + ":crlf.txt")
    say(sh("git", "-C", r, "rev-parse", "HEAD:crlf.txt") != up_raw, "fixture shape: the builder's git add normalized the CRLF base blob, so the unit commit differs from the base there")
    got, out = check(mk, d)
    say(got and "normalization 1" in out, "clean unit passes with that one normalized blob counted")
    root2 = os.path.join(T, "staged"); d2, r2 = unit(root2); staged_hidden(r2); _, m1 = markers(root2)
    say("tests/hidden.test.ts" in m1["files_new"], "markers take base content from the base tree, not the index: a staged hidden test stays a marker " + str(m1["files_new"]))
    for name, mut, want in cases:
        c = os.path.join(T, "case"); shutil.rmtree(c, ignore_errors=True); shutil.copytree(d, c, symlinks=True)
        if mut: mut(os.path.join(c, "repo"))
        got, out = check(mk, c)
        say(got == want, name + " | check says " + ("ok" if got else "fail") + " | want " + ("ok" if want else "fail"))
        if got != want: print("   ", out.strip().splitlines()[0][:400])
    root3 = os.path.join(T, "wrong"); d3, _ = unit(root3, lambda b, m: m)
    got, out = check(mk, d3)
    say(not got and "0 commits in the repo hold the base tree" in out, "unit repo built from a later commit, not the base | check says " + ("ok" if got else "fail"))
finally:
    shutil.rmtree(T, ignore_errors=True)
print("failures", fails); sys.exit(1 if fails else 0)
