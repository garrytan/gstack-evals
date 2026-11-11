#!/usr/bin/env python3
# Scratch (GEVA-434, Captain containment alert 2026-11-10): object-level check of eng-review unit workspaces.
# usage: contain-check.py markers <units_root> <ids_file> <out.json> <clones_dir>   build markers from key.json, unit.json and the upstream clone
#        contain-check.py check <markers.json> <unit_id>=<dir> ...         dir holds plan.md and repo/ as a session sees them
# Prints unit ids and counts only. A tracked .gitmodules with no gitlink and no nested .git holds no objects, so it is reported, not failed. unit.json, key.json and classify.json are never mounted, so the other-files scan skips them.
# Base content comes from the base commit's tree (git ls-tree -r <base>), never from the index. markers takes it from the upstream clone at base_sha and records its blob entries; check hashes the worktree against that tree, then finds the one commit in the unit repo that holds the same paths and modes with the same blobs, or blobs that differ only by git add's .gitattributes normalization of the worktree's base bytes (the builder rewrites the base tree as a fresh one-commit repo, gitlinks left out), requires HEAD there, and then hashes every worktree file (untracked, ignored and tracked) as a git blob against that tree and compares every index entry to it, so a staged-only hidden test fails. No git command here writes (no status, no index refresh).
import hashlib, json, os, re, subprocess, sys
os.environ["GIT_OPTIONAL_LOCKS"] = "0"

HEX = re.compile(r"[0-9a-f]{40}")
def git(repo, *a, ok=False):
    r = subprocess.run(["git", "-c", "core.hooksPath=/dev/null", "-C", repo, *a], capture_output=True, text=True)
    if r.returncode != 0 and not ok: raise RuntimeError(HEX.sub("<id>", "git " + " ".join(a) + ": " + r.stderr.strip()[:200]))
    return r.stdout

def gitb(repo, *a):
    r = subprocess.run(["git", "-c", "core.hooksPath=/dev/null", "-C", repo, *a], capture_output=True)
    if r.returncode != 0: raise RuntimeError(HEX.sub("<id>", "git " + " ".join(a) + ": " + r.stderr.decode(errors="replace").strip()[:200]))
    return r.stdout

def tree_map(repo, rev):
    t = {}
    for e in gitb(repo, "ls-tree", "-r", "-z", "--full-tree", rev).split(b"\0"):
        if e and not e.startswith(b"160000 "):
            meta, path = e.split(b"\t", 1); mode, _, sha = meta.split(); t[path] = (mode.decode(), sha.decode())
    return t

def blob_sha(data): return hashlib.sha1(b"blob %d\0" % len(data) + data).hexdigest()

def markers(root, ids_file, out, clones):
    res = {}
    for line in open(ids_file):
        uid = line.split()[-1]
        d = os.path.join(root, uid)
        u = json.load(open(os.path.join(d, "unit.json"))); k = json.load(open(os.path.join(d, "key.json")))
        shas = {u["merge_sha"], *u.get("aftermath", [])} | set(re.findall(r"\b[0-9a-f]{40}\b", json.dumps(k)))
        shas.discard(u["base_sha"])
        up = tree_map(os.path.join(clones, u["repo"].replace("/", "__")), u["base_sha"])
        base = {os.fsdecode(p) for p in up}
        change = {x["file"] for x in k.get("diffstat", [])} | set(k.get("touched", {}).get("files", []))
        new = sorted({it["file"] for it in k["items"] if it.get("file") and it["file"] not in base and it["file"] not in change})
        res[uid] = {"shas": sorted(shas), "files_new": new, "base_tree": {os.fsdecode(p): list(v) for p, v in up.items()}}
    json.dump(res, open(out, "w"))
    print("markers for", len(res), "units;", sum(len(v["shas"]) for v in res.values()), "later shas;", sum(len(v["files_new"]) for v in res.values()), "aftermath-only new files")

def worktree_vs_base(repo, up):
    new = mod = 0; seen = set(); top = os.fsencode(repo)
    for dp, dns, fns in os.walk(top):
        if dp == top and b".git" in dns: dns.remove(b".git")
        for n in fns + [x for x in dns if os.path.islink(os.path.join(dp, x))]:
            p = os.path.join(dp, n); rel = os.path.relpath(p, top)
            if os.path.islink(p): data = os.fsencode(os.readlink(p))
            elif os.path.isfile(p): data = open(p, "rb").read()
            else: new += 1; continue
            seen.add(rel); b = up.get(rel)
            if b is None: new += 1
            elif blob_sha(data) != b[1]: mod += 1
        dns[:] = [x for x in dns if not os.path.islink(os.path.join(dp, x))]
    return new, mod, len(set(up) - seen)

def holds_base(repo, c, up, worktree_at_base):
    t = tree_map(repo, c)
    if set(t) != set(up) or any(t[p][0] != up[p][0] for p in t): return None
    norm = 0
    for p, (mode, sha) in t.items():
        if sha == up[p][1]: continue
        if not worktree_at_base or mode == "120000": return None
        if git(repo, "hash-object", "--path=" + os.fsdecode(p), os.path.join(repo, os.fsdecode(p))).strip() != sha: return None
        norm += 1
    return norm

def index_vs_commit(repo, t):
    idx = 0; listed = set()
    for e in gitb(repo, "ls-files", "-s", "-z").split(b"\0"):
        if e:
            meta, path = e.split(b"\t", 1); mode, sha, stage = meta.split(); listed.add(path)
            idx += stage != b"0" or t.get(path) != (mode.decode(), sha.decode())
    return idx + len(set(t) - listed)

def check(mk, uid, d):
    repo = os.path.join(d, "repo"); g = os.path.join(repo, ".git"); f = []
    objs = [l.split() for l in git(repo, "cat-file", "--batch-all-objects", "--batch-check=%(objectname) %(objecttype)").splitlines()]
    commits = [o[0] for o in objs if o[1] == "commit"]
    up = {os.fsencode(p): tuple(v) for p, v in mk[uid]["base_tree"].items()}
    wt_new, wt_mod, wt_missing = worktree_vs_base(repo, up)
    found = [(c, n) for c in commits for n in [holds_base(repo, c, up, wt_mod == 0)] if n is not None]
    if len(found) != 1: return {"unit": uid, "ok": False, "error": str(len(found)) + " commits in the repo hold the base tree", "worktree_new": wt_new, "worktree_modified": wt_mod}
    head = base = found[0][0]
    bt = {"index_not_at_base": index_vs_commit(repo, tree_map(repo, base)), "worktree_new": wt_new, "worktree_modified": wt_mod, "missing_from_worktree": wt_missing, "normalized_in_commit": found[0][1]}
    head_at_base = git(repo, "rev-parse", "HEAD").strip() == base
    anc = lambda s: s == head or subprocess.run(["git", "-C", repo, "merge-base", "--is-ancestor", s, head], capture_output=True).returncode == 0
    refs = [l.split() for l in git(repo, "for-each-ref", "--format=%(objectname) %(refname)").splitlines() if l.strip()]
    if os.path.exists(os.path.join(g, "packed-refs")):
        refs += [l.split()[:2] for l in open(os.path.join(g, "packed-refs")) if re.match(r"^\^?[0-9a-f]{40}", l)]
    for h in ["HEAD", "FETCH_HEAD", "ORIG_HEAD", "MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "BISECT_HEAD", "AUTO_MERGE"]:
        p = os.path.join(g, h)
        if os.path.exists(p): refs += [[s, h] for s in re.findall(r"[0-9a-f]{40}", open(p).read())] + ([[head, "HEAD"]] if h == "HEAD" else [])
    bad_refs = [r[1] for r in refs if not anc(r[0].lstrip("^"))]
    bad_commits = [c for c in commits if not anc(c)]
    reach = set(l.split()[0] for l in git(repo, "rev-list", "--objects", head).splitlines() if l.strip())
    unreach = sum(1 for o in objs if o[0] not in reach)
    alt = [p for p in ["objects/info/alternates", "objects/info/http-alternates"] if os.path.exists(os.path.join(g, p))]
    gitlinks = sum(1 for l in git(repo, "ls-tree", "-r", head).splitlines() if l.startswith("160000"))
    nested = int(subprocess.run(["bash", "-c", "find " + repo + " -mindepth 2 -name .git | wc -l"], capture_output=True, text=True).stdout.strip())
    gm = os.path.exists(os.path.join(repo, ".gitmodules"))
    m = mk[uid]; hits = {}
    pats = [s[:7] + "[0-9a-f]{0,33}" for s in m["shas"]]
    for label, target in [("plan", os.path.join(d, "plan.md")), ("repo", repo), ("other", d)]:
        excl = ["--exclude-dir=.git"] + (["--exclude=plan.md", "--exclude-dir=repo", "--exclude=unit.json", "--exclude=key.json", "--exclude=classify.json"] if label == "other" else [])
        n_sha = 0; n_file = 0
        if pats:
            r = subprocess.run(["grep", "-rIoEwh", *excl, "-e", "|".join(pats), target], capture_output=True, text=True)
            n_sha = len([x for x in r.stdout.splitlines() if x])
        if m["files_new"]:
            r = subprocess.run(["grep", "-rIoFh", *excl, *sum([["-e", x] for x in m["files_new"]], []), target], capture_output=True, text=True)
            n_file = len([x for x in r.stdout.splitlines() if x])
        hits[label] = [n_sha, n_file]
    ok = head_at_base and not bad_refs and not bad_commits and not alt and not gitlinks and not nested and bt["index_not_at_base"] == 0 and bt["worktree_new"] == 0 and bt["worktree_modified"] == 0 and unreach == 0 and hits["plan"] == [0, 0] and hits["repo"] == [0, 0] and hits["other"] == [0, 0]
    return {"unit": uid, "ok": ok, "refs": len(refs), "bad_refs": len(bad_refs), "commits": len(commits), "bad_commits": len(bad_commits), "objects": len(objs), "unreachable": unreach,
            "alternates": len(alt), "gitlinks": gitlinks, "nested_git": nested, "gitmodules": gm, "head_at_base": head_at_base, **bt, "hits_sha_file": hits}

if sys.argv[1] == "markers": markers(*sys.argv[2:6])
else:
    mk = json.load(open(sys.argv[2])); rows = []
    for pair in sys.argv[3:]:
        uid, d = pair.split("=", 1)
        try: rows.append(check(mk, uid, d))
        except Exception as e: rows.append({"unit": uid, "ok": False, "error": HEX.sub("<id>", str(e))[:200]})
    for r in rows:
        if not r["ok"]: print("FAIL", json.dumps(r))
    tot = lambda k: sum(r.get(k, 0) for r in rows)
    print("checked", len(rows), "ok", sum(r["ok"] for r in rows), "| refs", tot("refs"), "bad", tot("bad_refs"), "| commits", tot("commits"), "bad", tot("bad_commits"), "| unreachable objects", tot("unreachable"), "| alternates", tot("alternates"), "gitlinks", tot("gitlinks"), "nested .git", tot("nested_git"))
    print("against the base tree (ls-tree -r <base>): head at base", sum(bool(r.get("head_at_base")) for r in rows), "| index entries not at base", tot("index_not_at_base"), "| worktree files not in base", tot("worktree_new"), "modified from base", tot("worktree_modified"), "| base files missing from worktree", tot("missing_from_worktree"), "| commit blobs differing from base only by the repo's own .gitattributes normalization", tot("normalized_in_commit"))
    print("marker hits [later-sha, aftermath-only file] plan", [sum(r.get("hits_sha_file", {}).get("plan", [0, 0])[i] for r in rows) for i in (0, 1)], "repo", [sum(r.get("hits_sha_file", {}).get("repo", [0, 0])[i] for r in rows) for i in (0, 1)], "other", [sum(r.get("hits_sha_file", {}).get("other", [0, 0])[i] for r in rows) for i in (0, 1)])
