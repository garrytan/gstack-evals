#!/usr/bin/env python3
"""R3 amendment 4 drop rule (plan section 4 items 5 and 6): two finished oracle passes per shard in, the drop list out.

Adapted from amendment 3's drop-list.py.txt. A task passes a pass when one of its oracle trials has verifier/reward.txt
equal to 1, as vm-run.sh's gate scores it. A task is dropped when it failed either pass. Each failure's kind is "reference
fails" (the verifier ran and the reward was not 1), "image unpullable" (its base image failed every pull try and the
trial has no reward) or "other: <exception>" (no reward for another reason, or no trial). A pass counts only when its
finished file holds a "finished_at" line and its pass.exit is 0; otherwise it is void and nothing is written.

Usage:
  drop-list.py shard <pool json> <N>     the comma list of shard N's tasks (1 to 4: sorted pool ids, every fourth)
  drop-list.py drops <pool json> <out json> <out tsv> <shard run dir> <shard out dir> [<shard run dir> <shard out dir>]...
    A shard out dir is oracle-preflight.sh's: it holds pass1/ and pass2/. Every pool task must be in exactly one shard.
Exit codes: 0 the drop list was written, 2 a pass is void or the shards don't cover the pool once, 3 the drop list was
written and more than a quarter of the pool is dropped (the attempt stops before any model call).
"""
import hashlib, json, os, sys

SHARDS = 4
sha = lambda b: hashlib.sha256(b).hexdigest()
fsha = lambda p: sha(open(p, "rb").read())


def fail(msg, code=2):
    print(msg, file=sys.stderr)
    sys.exit(code)


def pool_ids(pool_file):
    return [t["task_id"] for t in json.load(open(pool_file))["tasks"]]


def base_image(tasks_dir, task):
    froms = [l.split()[1] for l in open(os.path.join(tasks_dir, task, "environment/Dockerfile")) if l.split()[:1] and l.split()[0].upper() == "FROM"]
    return froms[-1]


def read_pass(d, label):
    fin = os.path.join(d, "finished")
    lines = open(fin).read().splitlines() if os.path.isfile(fin) else []
    if not any(l.startswith("finished_at ") for l in lines):
        fail(f"{label} ({d}) has no finished_at line; it is void")
    code = open(os.path.join(d, "pass.exit")).read().strip() if os.path.isfile(os.path.join(d, "pass.exit")) else "missing"
    if code != "0":
        fail(f"{label} ({d}) exited {code}, not 0; it is void")
    pulls = {}
    for line in open(os.path.join(d, "pulls.tsv")):
        status, tries, image, digest, note = line.rstrip("\n").split("\t")
        pulls[image] = {"status": status, "tries": int(tries), "repo_digest": digest, "note": note}
    trials = {}
    jobs = os.path.join(d, "jobs")
    for job in sorted(os.listdir(jobs)):
        if not job.endswith("-oracle") or not os.path.isdir(os.path.join(jobs, job)):
            continue
        for t in sorted(os.listdir(os.path.join(jobs, job))):
            td = os.path.join(jobs, job, t)
            if not os.path.isfile(os.path.join(td, "config.json")):
                continue
            task = json.load(open(os.path.join(td, "config.json")))["task"]["path"].rstrip("/").split("/")[-1]
            rp = os.path.join(td, "verifier/reward.txt")
            reward = open(rp).read().strip() if os.path.exists(rp) else None
            res = json.load(open(os.path.join(td, "result.json"))) if os.path.exists(os.path.join(td, "result.json")) else {}
            exc = (res.get("exception_info") or {}).get("exception_type")
            digests = {f: fsha(os.path.join(td, f)) for f in ("result.json", "verifier/reward.txt", "verifier/test-stdout.txt", "exception.txt") if os.path.exists(os.path.join(td, f))}
            trials.setdefault(task, []).append({"trial": t, "reward": reward, "exception": exc, "digests": digests})
    return {"pulls": pulls, "trials": trials, "fails_file": open(os.path.join(d, "oracle-fails.txt")).read().split(), "harbor_exit": open(os.path.join(d, "harbor.exit")).read().strip(),
            "oracle_fails_sha256": fsha(os.path.join(d, "oracle-fails.txt")), "pulls_sha256": fsha(os.path.join(d, "pulls.tsv")), "finished": lines[0]}


def passed(r):
    try:
        return float(r) == 1
    except (TypeError, ValueError):
        return False


def verdict(img, pa, task):
    pull = pa["pulls"].get(img, {"status": "missing", "tries": 0, "repo_digest": "-", "note": "not in pulls.tsv"})
    ts = pa["trials"].get(task, [])
    if any(passed(t["reward"]) for t in ts):
        kind = "pass"
    elif any(t["reward"] is not None for t in ts):
        kind = "reference fails"
    elif pull["status"] != "ok":
        kind = "image unpullable"
    else:
        kind = "other: " + (",".join(sorted({t["exception"] or "no reward" for t in ts})) if ts else "no trial")
    return {"result": "pass" if kind == "pass" else "fail", "kind": kind, "image": img, "pull": pull, "trials": ts}


def drops(pool_file, out_json, out_tsv, pairs):
    pool = pool_ids(pool_file)
    shards, owner = [], {}
    for run_dir, out_dir in pairs:
        tasks = [p["path"].rstrip("/").split("/")[-1] for p in json.load(open(os.path.join(run_dir, "oracle.json")))["tasks"]]
        for t in tasks:
            if t in owner:
                fail(f"{t} is in two shards ({owner[t]} and {run_dir})")
            owner[t] = run_dir
        shards.append({"run": run_dir, "tasks": tasks, "passes": [read_pass(os.path.join(out_dir, f"pass{n}"), f"{out_dir} pass {n}") for n in (1, 2)]})
    if sorted(owner) != sorted(pool):
        fail(f"the shards cover {len(owner)} tasks, not the pool's {len(pool)} once each")
    rows, dropped = [], []
    for s in shards:
        for task in s["tasks"]:
            img = base_image(os.path.join(s["run"], "tasks"), task)
            v = [verdict(img, pa, task) for pa in s["passes"]]
            rows.append((task, v))
            if any(x["result"] == "fail" for x in v):
                kinds = [x["kind"] for x in v]
                reason = kinds[0] if kinds[0] == kinds[1] else f"pass 1: {kinds[0]}; pass 2: {kinds[1]}"
                dropped.append({"task": task, "reason": reason, "pass1": v[0], "pass2": v[1]})
        for n, pa in enumerate(s["passes"], 1):
            mine = sorted(t for t, v in rows if t in s["tasks"] and v[n - 1]["result"] == "fail")
            if mine != sorted(pa["fails_file"]):
                fail(f"{s['run']} pass {n}: this scorer's fails {mine} differ from the VM's oracle-fails.txt {sorted(pa['fails_file'])}", 1)
    rows.sort()
    dropped.sort(key=lambda d: d["task"])
    gone = {d["task"] for d in dropped}
    kept = [t for t in pool if t not in gone]
    listing = lambda ids: "".join(i + "\n" for i in sorted(ids)).encode()
    doc = {
        "pool_file_sha256": fsha(pool_file), "pool_size": len(pool), "rule": "R3 amendment 4, plan section 4 item 5: a task that fails the reference solution in either pass is dropped",
        "shards": [{"tasks": len(s["tasks"]), "tasks_ids_sha256": sha(listing(s["tasks"])),
                    "passes": [{"pass": n, "harbor_exit": pa["harbor_exit"], "pass_exit": "0", "finished": pa["finished"],
                                "passed": sum(v[n - 1]["result"] == "pass" for t, v in rows if t in s["tasks"]), "failed": sum(v[n - 1]["result"] == "fail" for t, v in rows if t in s["tasks"]),
                                "images": len(pa["pulls"]), "images_pulled": sum(p["status"] == "ok" for p in pa["pulls"].values()),
                                "oracle_fails_sha256": pa["oracle_fails_sha256"], "pulls_sha256": pa["pulls_sha256"]} for n, pa in enumerate(s["passes"], 1)]} for s in shards],
        "dropped": dropped, "dropped_ids_sha256": sha(listing(gone)), "kept_size": len(kept), "kept_ids_sha256": sha(listing(kept)),
    }
    open(out_json, "w").write(json.dumps(doc, indent=2) + "\n")
    with open(out_tsv, "w") as f:
        f.write("task\tpass1\tpass1_kind\tpass1_reward\tpass2\tpass2_kind\tpass2_reward\tdropped\n")
        for task, v in rows:
            rw = lambda x: ",".join(str(t["reward"]) for t in x["trials"]) or "-"
            f.write(f"{task}\t{v[0]['result']}\t{v[0]['kind']}\t{rw(v[0])}\t{v[1]['result']}\t{v[1]['kind']}\t{rw(v[1])}\t{'yes' if task in gone else 'no'}\n")
    for d in dropped:
        print(f"dropped {d['task']}: {d['reason']}")
    print(f"pool: {len(pool)} -> {len(kept)} tasks; kept ids sha256 {doc['kept_ids_sha256']}; dropped ids sha256 {doc['dropped_ids_sha256']}")
    print(f"{os.path.basename(out_json)} sha256 {fsha(out_json)}")
    if len(gone) * 4 > len(pool):
        print(f"STOP: {len(gone)} of {len(pool)} pool tasks failed the preflight, more than a quarter; no model call runs and the Captain gets the record")
        sys.exit(3)


def main():
    a = sys.argv[1:]
    if a[:1] == ["shard"] and len(a) == 3 and a[2] in [str(n) for n in range(1, SHARDS + 1)]:
        print(",".join(sorted(pool_ids(a[1]))[int(a[2]) - 1::SHARDS]))
    elif a[:1] == ["drops"] and len(a) >= 6 and len(a) % 2 == 0:
        drops(a[1], a[2], a[3], list(zip(a[4::2], a[5::2])))
    else:
        fail(__doc__)


if __name__ == "__main__":
    main()
