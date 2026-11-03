#!/usr/bin/env python3
"""Install manifest for one gstack pin installed by its own ./setup --host claude --loadout lite into a clean HOME.
Paths are normalized (<HOME>, <RENDER>) so the manifest is public-safe and comparable across machines."""
import hashlib, json, os, re, subprocess, sys
W = os.path.abspath(os.environ.get("L1_PINS_DIR", "pins"))
def sha(b): return hashlib.sha256(b).hexdigest()
def norm(b, home, render):
    return b.replace(render.encode(), b"<RENDER>").replace(home.encode(), b"<HOME>")
def tree(root, home, render, lock=None):
    rows = []
    for d, _, fs in os.walk(root):
        for f in fs:
            p = os.path.join(d, f); rel = os.path.relpath(p, root)
            if rel == "loadout.lock.json": continue
            rows.append((rel, sha(norm(open(p, "rb").read(), home, render))))
    rows.sort()
    return rows, sha("".join(f"{r}\t{h}\n" for r, h in rows).encode())
out = {}
for p in ("before", "after"):
    H = f"{W}/home-{p}"; R = f"{H}/.gstack/render/claude"; G = f"{H}/.claude/skills/gstack"
    head = subprocess.check_output(["git", "-C", G, "rev-parse", "HEAD"], text=True).strip()
    ver = open(f"{G}/VERSION").read().strip()
    st = json.load(open(f"{H}/.claude/settings.json"))
    hooks = []
    for ev, groups in sorted(st.get("hooks", {}).items()):
        for g in groups:
            for h in g["hooks"]:
                hooks.append({"event": ev, "source": g.get("_gstack_source"), "command": h["command"].replace(H, "<HOME>"), "timeout": h.get("timeout")})
    cfg = [l for l in open(f"{H}/.gstack/config.yaml").read().splitlines() if l.strip() and not l.lstrip().startswith("#")]
    rows, digest = tree(R, H, R)
    lock = json.load(open(f"{W}/lock-{p}-inplace.json"))
    lock_rows = {f["path"]: f["sha256"] for f in lock["files"]}
    raw_match = sum(1 for rel, _ in rows if rel in lock_rows and sha(open(os.path.join(R, rel), "rb").read()) == lock_rows[rel])
    canon_rows, canon_digest = tree(f"{W}/render-{p}", f"{W}/render-{p}", f"{W}/render-{p}")
    skills = sorted(x for x in os.listdir(f"{H}/.claude/skills"))
    def body(skill):
        b = open(f"{R}/{skill}/SKILL.md", "rb").read(); nb = norm(b, H, R)
        t = b.decode()
        return {"bytes": len(b), "sha256_normalized": sha(nb), "first200_sha256": sha(nb.decode()[:200].encode()),
                "debug_report_template": all(re.search(rf"^{re.escape(l)}:", t, re.M) for l in ("Symptom", "Root cause", "Fix", "Evidence", "Regression test", "Status")) if skill == "investigate" else None,
                "contract_block": bool(re.search(r"^contract:", t.split("\n---", 1)[0], re.M))}
    rt = None
    rp = f"{G}/lib/skill-route.ts"
    if os.path.exists(rp):
        m = re.search(r"ROUTE_THRESHOLD = ([0-9.]+)", open(rp).read()); rt = m.group(1) if m else None
    out[p] = {"sha": head, "version": ver, "setup": "./setup --host claude --loadout lite (clean HOME, non-interactive, GSTACK_SKIP_PLAYWRIGHT=1 GSTACK_SKIP_FONTS=1), exit 0",
              "hooks": hooks, "config": cfg, "skills_dir_entries": len(skills), "skills": skills,
              "lite": {"spec": lock["spec"], "spec_sha256": lock["spec_sha256"], "files": len(lock["files"]), "excluded": lock.get("excluded"),
                       "setup_render_matches_lock_bytes": f"{raw_match} of {len(lock['files'])}",
                       "tree_digest_normalized": digest, "canonical_render_tree_digest_normalized": canon_digest},
              "investigate": body("investigate"), "review": body("review"), "route_threshold": rt,
              "hook_runtime": "each hook is a bash shim that runs bun from PATH and exits 0 on any failure (fail-open)"}
    out[p]["_rows"] = dict(rows)
b, a = out["before"], out["after"]
changed = sorted(k for k in set(b["_rows"]) | set(a["_rows"]) if b["_rows"].get(k) != a["_rows"].get(k))
skill_changed = sorted({k.split("/")[0] for k in changed})
for p in out: out[p].pop("_rows")
diff = {"files_changed": len(changed), "skills_with_changed_files": skill_changed,
        "hooks_added": [h for h in a["hooks"] if h not in b["hooks"]], "hooks_removed": [h for h in b["hooks"] if h not in a["hooks"]],
        "skills_added": sorted(set(a["skills"]) - set(b["skills"])), "skills_removed": sorted(set(b["skills"]) - set(a["skills"]))}
json.dump({"pins": out, "diff": diff}, open(f"{W}/manifest.json", "w"), indent=1)
print(json.dumps({"diff": diff, "before": {k: v for k, v in b.items() if k != "skills"}, "after": {k: v for k, v in a.items() if k != "skills"}}, indent=1))
