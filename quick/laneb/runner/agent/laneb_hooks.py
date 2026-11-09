"""Lane B's agent with more teardown steps, for R3b's told arm (R3 amendment 5 section 9 item 2) and every L1 arm. After the
session is closed and settled, it copies the arm's gstack hook logs and contract records (/root/.gstack/hooks and
/root/.gstack/skill-contracts) out of the container to evaluator/gstack-hooks/, so r3/r3b.ts reads each told trial's hook
log lines from evidence the agent never wrote. It then copies Claude Code's session transcripts (*.jsonl under
/root/.claude/projects) to evaluator/claude-projects/ and writes evaluator/l1-evidence.json from the two copies, with the
same three fields added to laneb-summary.json:

- route_hook: the transcript holds the UserPromptSubmit route hook's line as hook context (ROUTE_MARK). The route hook skips
  a prompt that opens with a slash command, so a told session reads false.
- contract_record: the contract Stop hook left its record for this session (skill-contracts/<session id>.json).
- contract_check_met: the record's last investigate run ended met (met, met_waived, met_after_block) or not (blocked,
  miss); null with no investigate run or no record.

The session is the one top-level transcript; with none, or more than one, the session is unknown and every field it decides
is null, never false. A copy that failed leaves the fields it decides null. Paths are the after pin's (gstack 699a41cb):
the state root is $HOME/.gstack with no GSTACK_STATE_ROOT set (lib/state-root.ts), records are
<root>/skill-contracts/<session id>.json (lib/skill-contract.ts recordPath) and hook logs <root>/hooks/<hook>.log
(lib/skill-route.ts traceLogPath).

Everything else is laneb_agent.LanebAgent unchanged; laneb_agent.py itself stays byte-identical, since the real-outcome lane
pins it. grid.ts picks this class for an arm with gstack_hooks=copy. A copy or evidence step that fails is recorded in
laneb-summary.json's teardown_errors and never raises, and each runs only after the parent's teardown has stopped Claude
Code, exported the patch and closed the session. An arm with no gstack state copies no hook state.
"""

import io
import json
import re
import shutil
import subprocess
import tarfile
from datetime import datetime
from pathlib import Path

from laneb_agent import PROBE_TIMEOUT_S, LanebAgent, LanebInfraError

# Each copy measures its tar inside the container first and refuses one past the cap. It then sends the tar through head, so
# a tree that a process the model left running grows between the two passes still sends at most the cap plus one byte: a
# send cut off there, or one whose tar fails, is refused in the container (exit 3), and the agent refuses a reply past the
# cap. A refused copy is a failed copy, and the fields it decides stay null.
TREE_CAP_BYTES = 256 << 20
_CAPPED_TAR = (f'c={TREE_CAP_BYTES}; n=$(tar -cf - -- "$@" | wc -c); [ "$n" -le "$c" ] || {{ echo "the tar is $n bytes, over the $c-byte cap" >&2; exit 3; }}; '
               'exec 4>&1; s=$({ { tar -cf - -- "$@"; echo $? >&3; } | head -c $((c + 1)) >&4; } 3>&1); '
               '[ "$s" = 0 ] || { echo "the tar grew past the $c-byte cap or failed (tar status $s)" >&2; exit 3; }')
GSTACK_HOOK_STATE = 'cd /root/.gstack 2>/dev/null || exit 0; set --; for d in hooks skill-contracts; do [ -d "$d" ] && set -- "$@" "$d"; done; [ "$#" -gt 0 ] || exit 0; ' + _CAPPED_TAR
CLAUDE_TRANSCRIPTS = 'cd /root/.claude/projects 2>/dev/null || exit 0; set --; for f in */*.jsonl */*/subagents/*.jsonl; do [ -f "$f" ] && set -- "$@" "$f"; done; [ "$#" -gt 0 ] || exit 0; ' + _CAPPED_TAR
ROUTE_MARK = "gstack skill routing (UserPromptSubmit hook;"
MET = {"met", "met_waived", "met_after_block"}
UNMET = {"blocked", "miss"}
INVESTIGATE = re.compile(r"(^|[:/-])investigate$")


def _route_context(line: str) -> bool:
    try:
        rec = json.loads(line)
    except ValueError:
        return False
    att = rec.get("attachment") if isinstance(rec, dict) and rec.get("type") == "attachment" else None
    if not isinstance(att, dict) or att.get("type") != "hook_additional_context" or att.get("hookEvent", att.get("hookName")) != "UserPromptSubmit":
        return False
    content = att.get("content")
    return any(ROUTE_MARK in str(c) for c in (content if isinstance(content, list) else [content]))


def _updated_at(run: dict) -> datetime | None:
    """A run's updated_at as an aware time, or None when it is not an ISO 8601 string with a zone (no last run can be told)."""
    v = run.get("updated_at")
    try:
        t = datetime.fromisoformat(v.replace("Z", "+00:00")) if isinstance(v, str) else None
    except ValueError:
        return None
    return t if t is not None and t.tzinfo is not None else None


def l1_evidence(transcripts: Path | None, hooks: Path | None) -> dict:
    """The three L1 hook fields from the copied transcripts and hook state; a None directory is a copy that failed."""
    main = sorted(p for p in transcripts.glob("*/*.jsonl") if p.is_file()) if transcripts is not None else []
    stem = main[0].stem if len(main) == 1 else None
    out = {"route_hook": None, "contract_record": None, "contract_check_met": None}
    if stem is None:
        return out
    out["route_hook"] = any(_route_context(line) for line in main[0].read_text(errors="replace").splitlines())
    if hooks is None:
        return out
    record = hooks / "skill-contracts" / (re.sub(r"[^A-Za-z0-9_-]", "_", stem)[:128] + ".json")
    if not record.exists():
        out["contract_record"] = False
        return out
    try:
        runs = json.loads(record.read_text()).get("runs")
    except (ValueError, AttributeError, OSError):
        return out
    if not isinstance(runs, dict):
        return out
    out["contract_record"] = True
    investigate = [r for r in runs.values() if isinstance(r, dict) and INVESTIGATE.search(str(r.get("skill")))]
    when = [_updated_at(r) for r in investigate]
    if None in when:
        return out
    outcome = investigate[sorted(range(len(investigate)), key=lambda i: when[i])[-1]].get("outcome") if investigate else None
    out["contract_check_met"] = True if outcome in MET else False if outcome in UNMET else None
    return out


# The harness mechanics snapshot strip (lanes/harness-mechanics/arms.ts stripSnapshot, which tests/harness-mechanics
# holds this copy equal to): CLAUDE.md, CLAUDE.local.md and AGENTS.md at any depth, the files a CLAUDE.md imports with
# @path inside the snapshot, and every .claude entry. It runs in the task container with python3 before the arm tar is
# extracted, so a gstack arm's own install writes after it. Prints the removed paths as one JSON list.
STRIP_SNAPSHOT = r"""
import json, os, re, shutil, sys
root = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else ".")
INSTR = re.compile(r"^(?:CLAUDE\.md|CLAUDE\.local\.md|AGENTS\.md)$")
IMP = re.compile(r"(?:^|\s)@((?:~|\.{0,2}/|[\w.-]+/)?[\w./-]+)")
removed, imports = set(), []
def visit(d):
    for name in os.listdir(d):
        p = os.path.join(d, name)
        if name == ".git":
            continue
        if name == ".claude":
            removed.add(os.path.relpath(p, root) + ("/" if os.path.isdir(p) and not os.path.islink(p) else ""))
            continue
        if os.path.isdir(p) and not os.path.islink(p):
            visit(p)
        elif INSTR.match(name):
            removed.add(os.path.relpath(p, root))
            if name.startswith("CLAUDE") and os.path.isfile(p) and not os.path.islink(p):
                for m in IMP.finditer(open(p, encoding="utf-8", errors="replace").read()):
                    imports.append(os.path.normpath(os.path.join(os.path.dirname(p), m.group(1))))
visit(root)
for f in imports:
    if f.startswith(root + "/") and os.path.isfile(f) and not os.path.islink(f):
        removed.add(os.path.relpath(f, root))
for r in removed:
    q = os.path.join(root, r.rstrip("/"))
    if os.path.isdir(q) and not os.path.islink(q):
        shutil.rmtree(q, ignore_errors=True)
    elif os.path.lexists(q):
        os.remove(q)
print(json.dumps(sorted(removed)))
"""


class LanebHooksAgent(LanebAgent):
    def _strip_snapshot(self, container: str) -> list[str]:
        root = self.options.workdir or "."
        res = subprocess.run(["docker", "exec", "-i", container, "python3", "-", root], input=STRIP_SNAPSHOT.encode(), capture_output=True, timeout=300)
        if res.returncode != 0:
            raise LanebInfraError(f"snapshot strip failed: {res.stderr[-500:]!r}")
        return json.loads(res.stdout.decode().strip().splitlines()[-1])

    def _inject_arm(self, container: str) -> dict:
        if not self.options.strip_snapshot:
            return super()._inject_arm(container)
        stripped = self._strip_snapshot(container)
        return {**super()._inject_arm(container), "stripped": stripped}

    def _copy_tree(self, container: str, script: str, dest: Path, what: str) -> list[str]:
        shutil.rmtree(dest, ignore_errors=True)
        res = self._exec(container, script, timeout=PROBE_TIMEOUT_S)
        if res.returncode != 0:
            raise RuntimeError(f"{what} copy failed: {res.stderr[-300:]!r}")
        if len(res.stdout) > TREE_CAP_BYTES:
            raise RuntimeError(f"{what} copy failed: the tar is {len(res.stdout)} bytes, over the {TREE_CAP_BYTES}-byte cap")
        if not res.stdout:
            return []
        with tarfile.open(fileobj=io.BytesIO(res.stdout)) as tf:
            tf.extractall(dest, members=[m for m in tf.getmembers() if m.isfile() or m.isdir()], filter="data")
        return sorted(str(f.relative_to(dest)) for f in dest.rglob("*") if f.is_file())

    def _teardown(self, container: str, session_id: str, log, base: dict) -> dict:
        summary = super()._teardown(container, session_id, log, base)
        evdir = self._evaluator_dir()
        errors = summary["teardown_errors"]
        copied = {}
        for key, script, name in (("gstack_hooks", GSTACK_HOOK_STATE, "gstack-hooks"), ("transcripts", CLAUDE_TRANSCRIPTS, "claude-projects")):
            try:
                files = self._copy_tree(container, script, evdir / name, key)
                copied[key] = evdir / name
                if files:
                    log({"event": key, "files": files})
            except Exception as e:
                errors[key] = f"{type(e).__name__}: {e}"[:300]
        try:
            evidence = l1_evidence(copied.get("transcripts"), copied.get("gstack_hooks"))
            (evdir / "l1-evidence.json").write_text(json.dumps(evidence) + "\n")
            summary.update(evidence)
        except Exception as e:
            errors["l1_evidence"] = f"{type(e).__name__}: {e}"[:300]
        try:
            (evdir / "laneb-summary.json").write_text(json.dumps(summary, indent=2, default=str))
        except Exception:
            pass
        return summary
