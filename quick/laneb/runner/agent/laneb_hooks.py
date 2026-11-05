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
import tarfile
from pathlib import Path

from laneb_agent import PROBE_TIMEOUT_S, LanebAgent

GSTACK_HOOK_STATE = 'cd /root/.gstack 2>/dev/null || exit 0; set --; for d in hooks skill-contracts; do [ -d "$d" ] && set -- "$@" "$d"; done; [ "$#" -gt 0 ] || exit 0; exec tar -cf - "$@"'
CLAUDE_TRANSCRIPTS = 'cd /root/.claude/projects 2>/dev/null || exit 0; set --; for f in */*.jsonl */*/subagents/*.jsonl; do [ -f "$f" ] && set -- "$@" "$f"; done; [ "$#" -gt 0 ] || exit 0; exec tar -cf - -- "$@"'
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
    investigate = sorted((r for r in runs.values() if isinstance(r, dict) and INVESTIGATE.search(str(r.get("skill")))), key=lambda r: str(r.get("updated_at")))
    outcome = investigate[-1].get("outcome") if investigate else None
    out["contract_check_met"] = True if outcome in MET else False if outcome in UNMET else None
    return out


class LanebHooksAgent(LanebAgent):
    def _copy_tree(self, container: str, script: str, dest: Path, what: str) -> list[str]:
        shutil.rmtree(dest, ignore_errors=True)
        res = self._exec(container, script, timeout=PROBE_TIMEOUT_S)
        if res.returncode != 0:
            raise RuntimeError(f"{what} copy failed: {res.stderr[-300:]!r}")
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
