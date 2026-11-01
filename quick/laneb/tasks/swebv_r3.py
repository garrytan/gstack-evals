#!/usr/bin/env python3
"""R3's SWE-bench Verified task set (GEVA-101 prereg, sections 4.1 and 4.8): the 93 in-band ids with a digest per task.

swebv-r3.txt is r3-band.py's sorted id list, one per line; its sha256 must be the prereg's. Each id is looked up in the
Harbor Hub pin for swebench-verified@1.0 (raw/hub, from fetch_registry.py), and its digest is computed from the pinned
harbor-datasets commit the way digest_tasks.py computes TB2's: sha256 over sorted "<relpath>\0<sha256 of file>\n" lines
for every tracked file in the task directory. That is also materialize.ts treeDigest over a checkout, so prepare-run can
check a checkout against these digests.
  --write   write swebv-r3.json
  --check   recompute every digest and exit 1 on any difference from swebv-r3.json (the default)
  --checkout <dir>  also leave a sparse checkout of the 93 task directories at <dir> (prepare-run's SWEBV)
"""
import argparse, hashlib, json, subprocess, sys
from pathlib import Path

from digest_tasks import git, task_digest

HERE = Path(__file__).resolve().parent
BAND_SHA256 = "5d555f1ff7eb6d7f3b5fb760ad46992ab5fb49d975f4cbd4585a0cfa637fdc67"


def band_ids():
    raw = (HERE / "swebv-r3.txt").read_bytes()
    got = hashlib.sha256(raw).hexdigest()
    if got != BAND_SHA256:
        raise SystemExit(f"swebv-r3.txt: sha256 {got} is not the prereg's {BAND_SHA256}")
    return raw.decode().split()


def fetch(url, commit, paths, repo):
    if not repo.exists():
        subprocess.run(["git", "init", "-q", str(repo)], check=True)
        git(repo, "remote", "add", "origin", url)
    try:
        git(repo, "cat-file", "-e", f"{commit}^{{commit}}")
    except subprocess.CalledProcessError:
        git(repo, "fetch", "-q", "--depth", "1", "--filter=blob:none", "origin", commit)
    git(repo, "sparse-checkout", "set", "--no-cone", *[p.rstrip("/") + "/" for p in paths])
    git(repo, "checkout", "-q", "--detach", commit)
    return repo


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--checkout", default=str(Path.home() / ".capy/work/ref/harbor-datasets"))
    a = ap.parse_args()
    ids = band_ids()
    hub = json.loads((HERE / "raw/hub/swebench-verified@1.0.json").read_text())
    reg = {t["name"]: t for t in hub["tasks"]}
    missing = [i for i in ids if i not in reg]
    if missing:
        raise SystemExit(f"not in the swebench-verified@1.0 registry: {missing}")
    pins = {(reg[i]["git_url"], reg[i]["git_commit_id"]) for i in ids}
    if len(pins) != 1:
        raise SystemExit(f"expected one registry pin, got {sorted(pins)}")
    url, commit = pins.pop()
    repo = fetch(url, commit, [reg[i]["path"] for i in ids], Path(a.checkout))
    tasks = []
    for i in ids:
        d, n = task_digest(repo, commit, reg[i]["path"])
        tasks.append({"task_id": i, "registry": {"git_url": url, "git_commit_id": commit, "path": reg[i]["path"]}, "digest": f"sha256:{d}", "digest_files": n})
    doc = {
        "note": "R3's in-band SWE-bench Verified tasks (GEVA-101 prereg, section 4.1): swebv-r3.txt with its sha256, and a digest per task at the Harbor Hub pin. Built by swebv_r3.py.",
        "dataset": {"name": hub["name"], "version": hub["version"]},
        "band_file": "swebv-r3.txt",
        "band_sha256": BAND_SHA256,
        "digest_algorithm": "sha256 over sorted lines '<relpath>\\0<sha256(file)>\\n' for every git-tracked file under the task path at registry.git_commit_id (digest_tasks.py)",
        "tasks": tasks,
    }
    path = HERE / "swebv-r3.json"
    if a.write:
        path.write_text(json.dumps(doc, indent=1) + "\n")
        print(f"wrote {path}: {len(tasks)} tasks at {url}@{commit}")
        return
    old = json.loads(path.read_text())
    bad = [t["task_id"] for t, o in zip(tasks, old["tasks"]) if t != o] + (["<count>"] if len(tasks) != len(old["tasks"]) else [])
    for t in tasks:
        print(f"{t['task_id']:40s} {t['digest_files']:4d} files  {t['digest']}")
    if bad:
        raise SystemExit(f"digests differ from swebv-r3.json: {bad}")
    print(f"ok: {len(tasks)} tasks match swebv-r3.json")


if __name__ == "__main__":
    main()
