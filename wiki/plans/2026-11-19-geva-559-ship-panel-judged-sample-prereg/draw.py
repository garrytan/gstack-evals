#!/usr/bin/env python3
# Frame and seeded draw for the /ship review panel judged sample (GEVA-559).
# Part A: fixed review findings named by gstack's Review-Finding commit trailers on merged PRs.
# Part B: PRs a later PR corrected within 7 days (phase 1 rows).
# Keyless and deterministic. Prints public items by repo, PR and finding id, and private items as counts and digests.
# Usage: draw.py <bare-clones-dir> <phase-1-7-day-rows-dir> <private-repos.json> <pr-dumps-dir>
# pr-dumps-dir holds one JSON line per PR (gh pr list --json number,url,body,...) per repository, as the keyless read wrote them.
# Part A draws only from PRs whose first-pass list is complete (README section 2); checking that fetches each candidate PR's
# refs/pull/<n>/head into the bare clone with git (no API call).
# private-repos.json maps clone names to owner/repo for the private repositories, with a "not_sent" list. It is kept
# outside this repository so no private repository is named here; draw.txt prints its sha256.
import collections, hashlib, json, random, re, subprocess, sys
from pathlib import Path

PREREG_ID = "2026-11-19-geva-559-ship-panel-judged-sample-prereg"
SEED = int(hashlib.sha256(PREREG_ID.encode()).hexdigest()[:16], 16)
PUBLIC_REPOS = {"gstack": "garrytan/gstack", "gstack-evals": "garrytan/gstack-evals", "gbrain": "garrytan/gbrain",
                "alphaclaw": "garrytan/alphaclaw", "gbrain-evals": "garrytan/gbrain-evals"}
PUBLIC = set(PUBLIC_REPOS.values())
REPOS, NOT_SENT = dict(PUBLIC_REPOS), set()
STRATA = {"red-team": "RT", "adversarial-native": "AD", "outside-voice": "SM", "cross-family-audit": "SM", "gpt-6.1-sol": "SM",
          "core": "FR", "specialist-batched": "FR", "specialist": "FR", "testing": "FR", "security": "FR",
          "state-machines": "FR", "api-contract": "FR", "claim-check": "FR", "specialist/claim-check": "FR"}
ORDER = ["RT", "AD", "SM", "FR"]
PER_STRATUM = 40
FULL = ("full/gate", "full/code")


def rows(rows_dir):
    out = {}
    for f in sorted(Path(rows_dir).glob("*.jsonl")):
        for line in open(f):
            r = json.loads(line)
            r["tier"] = f"{r['depth']}/{r['cls']}" if r.get("depth") else "legacy"
            if r["repo"] in REPOS.values():
                out[(r["repo"], r["number"])] = r
    return out


def trailer_items(clones, R):
    items = []
    for name, repo in REPOS.items():
        log = subprocess.run(["git", "-C", str(Path(clones) / f"{name}.git"), "log", "--all", "--format=%x1e%H%x1f%s%x1f%B"],
                             capture_output=True, text=True, check=True).stdout
        seen = set()
        for rec in log.split("\x1e")[1:]:
            sha, subject, body = rec.split("\x1f", 2)
            found = re.findall(r"^Review-Finding:\s*(\S+)(.*)$", body, re.M)
            m = re.search(r"\(#(\d+)\)\s*$", subject)
            if not found or not m or (repo, int(m.group(1))) not in R or (repo, int(m.group(1))) in seen:
                continue
            pr = int(m.group(1))
            seen.add((repo, pr))
            ids = {}
            for fid, rest in found:
                rd = re.search(r"reader=(\S+)", rest)
                ids.setdefault(fid, rd.group(1) if rd else fid.split("/")[1].split("#")[0] if "/" in fid else "?")
            for fid, reader in sorted(ids.items()):
                items.append({"repo": repo, "number": pr, "squash": sha, "finding": fid, "reader": reader,
                              "stratum": STRATA.get(reader), "tier": R[(repo, pr)]["tier"], "public": repo in PUBLIC,
                              "id": hashlib.sha256(f"{repo}#{pr}#{fid}".encode()).hexdigest()[:16]})
    return items


FINDING_ID = re.compile(r"(?<![\w/#-])((?:[a-z0-9-]+/)?([a-z][a-z-]*(?:/[a-z-]+)?)#\d+)")


def receipts_total(body):
    # (fixed + noted + deferred, noted + deferred) summed over every receipt that records a review loop, or None
    total, unfixed, seen = 0, 0, 0
    for m in re.finditer(r"```gstack-ship-receipt\s*(\{.*?\})\s*```", body, re.S):
        try:
            loop = json.loads(m.group(1)).get("review_loop")
        except ValueError:
            continue
        if isinstance(loop, dict):
            total += sum(int(loop.get(k) or 0) for k in ("fixed", "noted", "deferred"))
            unfixed += sum(int(loop.get(k) or 0) for k in ("noted", "deferred"))
            seen += 1
    return (total, unfixed) if seen else None


def shown_ids(body, trailer_ids, readers):
    ids = set(trailer_ids)
    for m in FINDING_ID.finditer(body):
        if m.group(2) in readers or m.group(2).split("/")[-1] in readers:
            ids.add(m.group(1))
    return ids


def in_body(fid, lines):
    rx = re.compile(r"(?<![\w/#-])" + re.escape(fid) + r"(?!\d)")
    return any(rx.search(ln) for ln in lines)


def complete_prs(clones, items, bodies):
    readers = {i["reader"] for i in items}
    by = collections.defaultdict(list)
    for i in items:
        if i["public"] and i["tier"] in FULL:
            by[(i["repo"], i["number"])].append(i)
    count_ok = {}
    for (repo, pr), its in sorted(by.items()):
        body = bodies.get((repo, pr), "")
        counts = receipts_total(body)
        trailer_ids = {i["finding"] for i in its}
        ids = shown_ids(body, trailer_ids, readers)
        if counts is not None and len(ids) >= counts[0] and len(ids - trailer_ids) >= counts[1]:
            count_ok[(repo, pr)] = its
    for repo in sorted({r for r, _ in count_ok}):
        git = Path(clones) / f"{repo.split('/')[1]}.git"
        specs = [f"+refs/pull/{pr}/head:refs/pull/{pr}/head" for r, pr in sorted(count_ok) if r == repo]
        subprocess.run(["git", "-C", str(git), "fetch", "-q", "origin", *specs], check=True)
    complete = set()
    for (repo, pr), its in sorted(count_ok.items()):
        git = Path(clones) / f"{repo.split('/')[1]}.git"
        msgs = subprocess.run(["git", "-C", str(git), "log", f"refs/pull/{pr}/head", "--not", f"{its[0]['squash']}^", "--format=%B"],
                              capture_output=True, text=True, check=True).stdout
        carried = set(re.findall(r"^Review-Finding:\s*(\S+)", msgs, re.M))
        lines = bodies.get((repo, pr), "").split("\n")
        if all(in_body(i["finding"], lines) or i["finding"] in carried for i in its):
            complete.add((repo, pr))
    return len(by), len(count_ok), complete


def draw_a(items, complete):
    picked = []
    for k, s in enumerate(ORDER):
        pool = sorted((i for i in items if i["stratum"] == s and (i["repo"], i["number"]) in complete), key=lambda i: i["id"])
        random.Random(SEED + k).shuffle(pool)
        for n, i in enumerate(pool, 1):
            role = "reserve" if n > PER_STRATUM else "gold" if n <= 5 else "batch" if n == 6 else "main"
            picked.append(dict(i, order=n, role=role))
    return picked


def draw_b(R):
    cands = []
    for (repo, pr), r in R.items():
        if r.get("blame") != "ok" or r.get("exposure_days", 0) < r.get("window", 30) - 0.01 or not r.get("corr_touch"):
            continue
        cands.append({"repo": repo, "number": pr, "tier": r["tier"], "later": sorted(r["corr_touch"]), "public": repo in PUBLIC,
                      "id": hashlib.sha256(f"{repo}#{pr}".encode()).hexdigest()[:16]})
    cands.sort(key=lambda c: c["id"])
    random.Random(SEED + 10).shuffle(cands)
    gold = batch = 0
    for n, c in enumerate(cands, 1):
        c["order"], c["role"] = n, "not-sent" if c["repo"] in NOT_SENT else "main"
        if c["role"] == "main" and gold < 20:
            c["role"], gold = "gold", gold + 1
        elif c["role"] == "main" and not c["public"] and batch < 4:
            c["role"], batch = "batch", batch + 1
    return cands


def digest(lines):
    return hashlib.sha256("\n".join(lines).encode()).hexdigest()


def main(clones, rows_dir, private_path, dumps_dir):
    raw = open(private_path, "rb").read()
    private = json.loads(raw)
    REPOS.update(private["repos"])
    NOT_SENT.update(private["not_sent"])
    R = rows(rows_dir)
    print(f"# private-repos.json sha256 {hashlib.sha256(raw).hexdigest()}: {len(private['repos'])} private repositories, {len(private['not_sent'])} not sent to any model")
    items = trailer_items(clones, R)
    prs = {(i["repo"], i["number"]) for i in items}
    print(f"# Review-Finding trailers on merged PRs with a /ship receipt: {len(items)} findings in {len(prs)} PRs; seed {SEED}")
    full_prs = [p for p in prs if R[p]["tier"] in FULL]
    agree = collections.Counter()
    for p in full_prs:
        n, fx = sum(1 for i in items if (i["repo"], i["number"]) == p), R[p].get("fixed") or 0
        agree["equal" if n == fx else "more" if n > fx else "fewer"] += 1
    print(f"# full-depth PRs with trailers: {len(full_prs)}; trailer count against the last receipt's fixed: " +
          ", ".join(f"{k} {v}" for k, v in sorted(agree.items())))
    print("# reader\tstratum\ttier\tvisibility\tfindings")
    c = collections.Counter((i["reader"], i["stratum"] or "-", i["tier"], "public" if i["public"] else "private") for i in items)
    for k in sorted(c):
        print("\t".join(k) + f"\t{c[k]}")
    bodies = {}
    for f in sorted(Path(dumps_dir).glob("*.jsonl")):
        for line in open(f):
            p = json.loads(line)
            bodies[("/".join(p["url"].split("/")[3:5]), p["number"])] = p.get("body") or ""
    n_prs, n_count, complete = complete_prs(clones, items, bodies)
    print(f"# part A: public full-depth PRs with trailers {n_prs}; enough finding ids for their receipts {n_count}; "
          f"complete first-pass list {len(complete)}")
    A = draw_a(items, complete)
    for s in ORDER:
        pool = [i for i in A if i["stratum"] == s]
        allpub = sum(1 for i in items if i["stratum"] == s and i["public"] and i["tier"] in FULL)
        print(f"# {s}: {allpub} public full-depth findings, {len(pool)} on complete-list PRs; sample {min(PER_STRATUM, len(pool))}")
    print(f"# part A sample: {sum(i['role'] != 'reserve' for i in A)} findings in {len({(i['repo'], i['number']) for i in A if i['role'] != 'reserve'})} PRs; orders 41 on are the reserve, in order")
    print("# stratum\torder\trole\trepo\tpr\tfinding\treader\ttier\titem")
    for i in A:
        print(f"{i['stratum']}\t{i['order']}\t{i['role']}\t{i['repo']}\t{i['number']}\t{i['finding']}\t{i['reader']}\t{i['tier']}\t{i['id']}")
    B = draw_b(R)
    print(f"# part B: PRs a later PR corrected within 7 days (full 7-day exposure, blame ok): {len(B)}; seed {SEED + 10}")
    cb = collections.Counter((c["tier"], "public" if c["public"] else "private", c["role"]) for c in B)
    for k in sorted(cb):
        print("# " + "\t".join(k) + f"\t{cb[k]}")
    print("# B\torder\trole\trepo\tpr\ttier\tlater_prs")
    for c in B:
        if c["public"]:
            print(f"B\t{c['order']}\t{c['role']}\t{c['repo']}\t{c['number']}\t{c['tier']}\t{','.join(map(str, c['later']))}")
    priv = [c for c in B if not c["public"]]
    print(f"# part B private: {len(priv)} PRs, sha256 {digest(f'{c['order']} {c['id']} {c['role']}' for c in priv)}")


if __name__ == "__main__":
    main(*sys.argv[1:])
