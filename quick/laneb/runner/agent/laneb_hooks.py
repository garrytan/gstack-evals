"""Lane B's agent with one more teardown step, for R3b's told arm (R3 amendment 5 section 9 item 2): after the session
is closed and settled, it copies the arm's gstack hook logs and contract records (/root/.gstack/hooks and
/root/.gstack/skill-contracts) out of the container to evaluator/gstack-hooks/, so r3/r3b.ts reads each told trial's hook
log lines from evidence the agent never wrote. Everything else is laneb_agent.LanebAgent unchanged; laneb_agent.py
itself stays byte-identical, since the real-outcome lane pins it. grid.ts picks this class for an arm with
gstack_hooks=copy. A copy that fails is recorded in laneb-summary.json's teardown_errors and never raises, and it runs
only after the parent's teardown has stopped Claude Code and closed the session. An arm with no gstack state copies
nothing."""

import io
import json
import tarfile

from laneb_agent import PROBE_TIMEOUT_S, LanebAgent

GSTACK_HOOK_STATE = 'cd /root/.gstack 2>/dev/null || exit 0; set --; for d in hooks skill-contracts; do [ -d "$d" ] && set -- "$@" "$d"; done; [ "$#" -gt 0 ] || exit 0; exec tar -cf - "$@"'


class LanebHooksAgent(LanebAgent):
    def _copy_gstack_hooks(self, container: str, evdir) -> list[str]:
        res = self._exec(container, GSTACK_HOOK_STATE, timeout=PROBE_TIMEOUT_S)
        if res.returncode != 0:
            raise RuntimeError(f"gstack hook state copy failed: {res.stderr[-300:]!r}")
        if not res.stdout:
            return []
        dest = evdir / "gstack-hooks"
        with tarfile.open(fileobj=io.BytesIO(res.stdout)) as tf:
            tf.extractall(dest, members=[m for m in tf.getmembers() if m.isfile() or m.isdir()], filter="data")
        return sorted(str(f.relative_to(dest)) for f in dest.rglob("*") if f.is_file())

    def _teardown(self, container: str, session_id: str, log, base: dict) -> dict:
        summary = super()._teardown(container, session_id, log, base)
        evdir = self._evaluator_dir()
        try:
            copied = self._copy_gstack_hooks(container, evdir)
            if copied:
                log({"event": "gstack_hooks", "files": copied})
        except Exception as e:
            summary["teardown_errors"]["gstack_hooks"] = f"{type(e).__name__}: {e}"[:300]
            try:
                (evdir / "laneb-summary.json").write_text(json.dumps(summary, indent=2, default=str))
            except Exception:
                pass
        return summary
