#!/usr/bin/env python3
"""Recompute task digests from the registry-pinned git commit.

For each task in tasks.json (main and reserves), this script:
  1. clones the pinned git_url (or reuses --cache-dir/<repo>) and fetches git_commit_id,
  2. lists every file tracked under the task path at that commit (git ls-tree, no working tree involved),
  3. digest = sha256 over the lines "<relative path>\0<sha256 of file bytes>\n", sorted by relative path
     (POSIX separators, byte order). This is the serialization Harbor's Packager.compute_content_hash uses;
     here it covers every tracked file in the task directory, with no exclusions.
Prints a table and exits non-zero if any digest differs from tasks.json. Use --write to fill tasks.json instead.
Needs only git and Python 3.11+.
"""
import argparse, hashlib, json, subprocess, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def git(repo, *args, binary=False):
    out = subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True)
    return out.stdout if binary else out.stdout.decode()


def ensure_repo(url, commit, cache):
    repo = cache / url.rstrip("/").split("/")[-1].removesuffix(".git")
    if not repo.exists():
        subprocess.run(["git", "init", "-q", str(repo)], check=True)
        git(repo, "remote", "add", "origin", url)
    try:
        git(repo, "cat-file", "-e", f"{commit}^{{commit}}")
    except subprocess.CalledProcessError:
        git(repo, "fetch", "-q", "--depth", "1", "origin", commit)
    return repo


def task_digest(repo, commit, path):
    listing = git(repo, "ls-tree", "-r", "-z", "--full-tree", commit, "--", path.rstrip("/") + "/")
    entries = []
    for rec in filter(None, listing.split("\0")):
        meta, full = rec.split("\t", 1)
        mode, kind, obj = meta.split()
        if kind != "blob":
            raise SystemExit(f"unexpected {kind} at {full}")
        data = git(repo, "cat-file", "blob", obj, binary=True)  # symlinks (mode 120000) hash their target string
        entries.append((full[len(path.rstrip("/")) + 1:], hashlib.sha256(data).hexdigest()))
    outer = hashlib.sha256()
    for rel, h in sorted(entries, key=lambda e: e[0].encode()):
        outer.update(f"{rel}\0{h}\n".encode())
    return outer.hexdigest(), len(entries)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tasks", default=str(HERE / "tasks.json"))
    ap.add_argument("--cache-dir", default=str(Path.home() / ".cache/gsta12-digest"))
    ap.add_argument("--write", action="store_true", help="write digests into tasks.json instead of checking")
    a = ap.parse_args()
    cache = Path(a.cache_dir)
    cache.mkdir(parents=True, exist_ok=True)
    doc = json.loads(Path(a.tasks).read_text())
    bad = 0
    for t in doc["main"] + doc["reserves"]:
        reg = t["registry"]
        repo = ensure_repo(reg["git_url"], reg["git_commit_id"], cache)
        d, n = task_digest(repo, reg["git_commit_id"], reg["path"])
        ok = t.get("digest") == f"sha256:{d}"
        if a.write:
            t["digest"], t["digest_files"] = f"sha256:{d}", n
        elif not ok:
            bad += 1
        print(f"{t['task_id']:40s} {n:4d} files  sha256:{d}  {'written' if a.write else ('ok' if ok else 'MISMATCH')}")
    if a.write:
        Path(a.tasks).write_text(json.dumps(doc, indent=1) + "\n")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
