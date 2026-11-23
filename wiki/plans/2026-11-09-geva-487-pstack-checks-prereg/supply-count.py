"""Free supply count for the pstack generated-checks preregistration. Keyless, no model calls.

Run from a directory whose pq/ folder holds the datasets' published parquet files: SWE-bench-Live MultiLang
(pq/ml_<lang>.parquet) and, for the wider count only, SWE-bench-Live (pq/live_full_*.parquet) and the SWE-rebench
leaderboard (pq/lb_<month>.parquet). Each source is read when its files are present.
Usage: uv run -q --with duckdb python3 supply-count.py 2025-01-01
Prints the state-keyword candidates from that date: all of them, at 3 a repository, by month and by language.
"""
import duckdb, re, json, collections, glob, os, sys
con = duckdb.connect()
CUT = sys.argv[1] if len(sys.argv) > 1 else "2026-07-01"
srcs = []
if glob.glob("pq/live_full_*.parquet"):
    srcs.append(("live", "SELECT instance_id, repo, CAST(created_at AS VARCHAR) c, 'py' lang, docker_image img, problem_statement ps, patch, test_patch, len(FAIL_TO_PASS) f2p, len(PASS_TO_PASS) p2p FROM read_parquet('pq/live_full_*.parquet')"))
if glob.glob("pq/ml_*.parquet"):
    srcs.append(("live_ml", "SELECT instance_id, repo, CAST(created_at AS VARCHAR) c, regexp_extract(filename, 'ml_([a-z]+)', 1) lang, docker_image img, problem_statement ps, patch, test_patch, len(FAIL_TO_PASS) f2p, len(PASS_TO_PASS) p2p FROM read_parquet('pq/ml_*.parquet', filename=true)"))
if glob.glob("pq/lb_*.parquet"):
    srcs.append(("rebench_lb", "SELECT instance_id, repo, CAST(created_at AS VARCHAR) c, 'py' lang, docker_image img, problem_statement ps, patch, test_patch, len(FAIL_TO_PASS) f2p, len(PASS_TO_PASS) p2p FROM read_parquet('pq/lb_*.parquet', union_by_name=true)"))
if os.path.exists("pq/v2_0.parquet"):
    srcs.append(("rebench_v2", "SELECT instance_id, repo, CAST(created_at AS VARCHAR) c, language lang, image_name img, problem_statement ps, patch, test_patch, len(FAIL_TO_PASS) f2p, len(PASS_TO_PASS) p2p FROM read_parquet('pq/v2_0.parquet')"))
BUG = re.compile(r"\b(bug|error|incorrect(ly)?|wrong|fails?|failing|failure|crash(es)?|exception|regression|broken|unexpected(ly)?|doesn'?t work|does not work|traceback|panic|not working)\b", re.I)
FEAT = re.compile(r"\b(feature request|add support for|support for|would be nice|enhancement|proposal|new option|allow (users? )?to)\b", re.I)
SM = re.compile(r"(state machine|state transition|invalid state|wrong state|inconsistent state|stale (state|cache|data|value|entry)|race condition|already (closed|running|started|initiali[sz]ed|connected|exists|released|disposed|stopped)|not (reset|cleared|restored)|after (closing|close|cancel|cancell?ation|reconnect|retry|restart|reload|shutdown|disconnect|an error|failure)|\bstuck\b|\bhangs?\b|\btwice\b|double[- ](free|count|submit|fire|call|close)|idempot|re-?entran|out of order|lifecycle|life cycle|\bpending\b|in[- ]progress|is_running|is_closed|\bresume\b|\bretr(y|ies)\b)", re.I)
rows = {}
for name, sql in srcs:
    for r in con.execute(sql).fetchall():
        iid, repo, c, lang, img, ps, patch, tp, f2p, p2p = r
        if not c or c[:10] < CUT: continue
        rec = rows.setdefault((repo or "").lower() + "|" + (iid or ""), dict(src=set(), repo=repo, c=c[:10], lang=lang, img=bool(img), ps=ps or "", patch=patch or "", f2p=f2p or 0, p2p=p2p or 0))
        rec["src"].add(name)
# dedupe the same PR across sources by repo + trailing number
byk = {}
for k, r in rows.items():
    num = re.findall(r"(\d+)$", k.split("|")[1] or "")
    kk = (r["repo"] or "").lower() + "#" + (num[0] if num else k)
    if kk in byk: byk[kk]["src"] |= r["src"]
    else: byk[kk] = r
res = collections.OrderedDict()
res["window_start"] = CUT
res["unique_tasks"] = len(byk)
res["by_source"] = collections.Counter(s for r in byk.values() for s in r["src"])
res["by_month"] = dict(sorted(collections.Counter(r["c"][:7] for r in byk.values()).items()))
res["by_lang"] = collections.Counter(r["lang"] for r in byk.values())
res["repos"] = len({r["repo"] for r in byk.values()})
usable = [r for r in byk.values() if r["img"] and r["f2p"] >= 1 and r["p2p"] >= 1]
res["usable_image_f2p_p2p"] = len(usable)
bug = [r for r in usable if BUG.search(r["ps"][:5000]) and not FEAT.search(r["ps"][:800])]
res["usable_bug_heuristic"] = len(bug)
res["usable_bug_repos"] = len({r["repo"] for r in bug})
small = [r for r in bug if 1 <= len(set(re.findall(r"^diff --git a/(\S+)", r["patch"], re.M))) <= 6]
res["bug_small_patch_1to6_files"] = len(small)
sm = [r for r in small if SM.search(r["ps"][:5000] + "\n" + r["patch"][:30000])]
res["statey_keyword_share_of_small_bug"] = round(len(sm) / max(1, len(small)), 3)
res["statey_keyword_count"] = len(sm)
res["small_bug_by_lang"] = collections.Counter(r["lang"] for r in small)
res["small_bug_by_month"] = dict(sorted(collections.Counter(r["c"][:7] for r in small).items()))
cap = collections.Counter(r["repo"] for r in small)
res["small_bug_with_repo_cap_3"] = sum(min(3, v) for v in cap.values())

capsm = collections.Counter(r["repo"] for r in sm)
res2 = {"window": CUT, "statey": len(sm), "statey_cap3": sum(min(3, v) for v in capsm.values()), "statey_repos": len(capsm),
        "statey_by_month": dict(sorted(collections.Counter(r["c"][:7] for r in sm).items())),
        "statey_by_lang": dict(collections.Counter(r["lang"] for r in sm))}
print(json.dumps(res2))
