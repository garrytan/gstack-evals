#!/usr/bin/env python3
# Frame and seeded draw for the /ship review panel judged sample (GEVA-559).
# Part A: fixed review findings named by gstack's Review-Finding commit trailers on merged PRs.
# Part B: PRs a later PR corrected within 7 days (phase 1 rows).
# Keyless and deterministic. Prints public items by repo, PR and finding id, and private items as counts and digests.
# Usage: draw.py <bare-clones-dir> <phase-1-7-day-rows-dir> <private-repos.json>
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


def draw_a(items):
    picked = []
    for k, s in enumerate(ORDER):
        pool = [i for i in items if i["stratum"] == s and i["tier"] in FULL and i["repo"] not in NOT_SENT]
        pub = sorted((i for i in pool if i["public"]), key=lambda i: i["id"])
        priv = sorted((i for i in pool if not i["public"]), key=lambda i: i["id"])
        rng = random.Random(SEED + k)
        rng.shuffle(pub)
        rng.shuffle(priv)
        for n, i in enumerate(pub + priv, 1):
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


def main(clones, rows_dir, private_path):
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
    A = draw_a(items)
    print("# part A: full/gate and full/code, the not-sent repository left out; 40 a stratum, public first")
    for s in ORDER:
        pool = [i for i in A if i["stratum"] == s]
        pub = sum(i["public"] for i in pool)
        print(f"# {s}: frame {len(pool)} ({pub} public, {len(pool) - pub} private)")
    print(f"# public findings at orders 1 to {2 * PER_STRATUM} (orders 41 on are the reserve, in order)")
    print("# stratum\torder\trole\trepo\tpr\tfinding\treader\ttier\titem")
    for i in A:
        if i["public"] and i["order"] <= 2 * PER_STRATUM:
            print(f"{i['stratum']}\t{i['order']}\t{i['role']}\t{i['repo']}\t{i['number']}\t{i['finding']}\t{i['reader']}\t{i['tier']}\t{i['id']}")
    for s in ORDER:
        priv = [i for i in A if i["stratum"] == s and not i["public"]]
        roles = collections.Counter(i["role"] for i in priv)
        print(f"# {s} private: {len(priv)} findings, roles {dict(sorted(roles.items()))}, sha256 {digest(f'{i['order']} {i['id']}' for i in priv)}")
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
