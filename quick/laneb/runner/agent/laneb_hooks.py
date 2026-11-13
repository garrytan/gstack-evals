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

import asyncio
import hashlib
import http.client
import io
import json
import os
import re
import shutil
import socket
import subprocess
import tarfile
import tempfile
import time
import uuid
from datetime import datetime
from pathlib import Path

from pydantic import Field

import laneb_agent
from laneb_agent import PROBE_TIMEOUT_S, LanebAgent, LanebInfraError, LanebOptions

# Harness mechanics live judge wiring (lanes/harness-mechanics/README.md "Not built"). The judge arms run their judgment
# hooks (lanes/harness-mechanics/judge/hm_judge.py) against a judge metering proxy on the VM (src/runner/proxy/metering-proxy.ts,
# started by quick/laneb/runner/vm-run.sh). The slot lifecycle mirrors lanes/decision-routing/agent/dr_harbor.py: bind over a
# management unix socket, inject the per-session env, unbind and finalize in the finally.
MANAGEMENT_HEADER = "x-gstack-evals-management"
MANAGEMENT_TIMEOUT_SEC = 120
# The judge slot's deciders, the same for both backends: jev (and its particle-1 escalation) for judge-jev, particle-1 for
# judge-p1. hm_judge.py always builds the particle-1 client, and judge-jev may escalate, so both ids are allowed on the slot
# (as in lanes/harness-mechanics/judge-dryrun.ts).
JUDGE_DECIDERS = ["typesafe:jev-1.13.0", "openrouter:particle-ai/particle-1"]
# Must equal lanes/harness-mechanics/judge.ts JEV_MODEL and dr_agent.deciders.JEV_MODEL (a keyless test checks). A judge
# session's hook log line whose Jev version is not this, or whose session the E1 ruling stopped, is a jevChanges line that
# stops the batch.
JEV_MODEL = "jev-1.13.0"
CANARY = re.compile(r"DRCANARY-[0-9a-f]{32}")
# The judge hook log and per-backend config inside the container (quick/laneb/arms/build.sh judge tar).
JUDGE_HOOK_LOG = "/root/.hm/log/hooks.jsonl"
JUDGE_CONFIG = "/root/.hm/judge/judge-{backend}.json"


class JudgeManagementError(RuntimeError):
    """The judge metering proxy's management socket refused or failed a bind, unbind or finalize."""


class _UnixHTTPConnection(http.client.HTTPConnection):
    def __init__(self, path: str, timeout: float):
        super().__init__("localhost", timeout=timeout)
        self._socket_path = path

    def connect(self) -> None:
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.settimeout(self.timeout)
        sock.connect(self._socket_path)
        self.sock = sock


def manage(route: str, body: dict) -> dict:
    """POST one management request to the judge metering proxy and return its JSON answer (mirrors dr_harbor.manage)."""
    socket_path, token = os.environ.get("HM_JUDGE_MGMT_SOCKET"), os.environ.get("HM_JUDGE_MGMT_TOKEN")
    if not socket_path or not token:
        raise JudgeManagementError("HM_JUDGE_MGMT_SOCKET and HM_JUDGE_MGMT_TOKEN must be set in the Harbor process")
    conn = _UnixHTTPConnection(socket_path, MANAGEMENT_TIMEOUT_SEC)
    try:
        conn.request("POST", route, json.dumps(body), {"content-type": "application/json", MANAGEMENT_HEADER: token})
        res = conn.getresponse()
        raw = res.read()
    finally:
        conn.close()
    try:
        answer = json.loads(raw)
    except ValueError:
        answer = {}
    if res.status != 200:
        raise JudgeManagementError(answer.get("detail") or f"judge management {route}: HTTP {res.status}")
    return answer


def judge_markers_file(options, task: str) -> str | None:
    """The task's markers file: <markers_dir>/<task>.json for the live per-task custody (one agent config serves every task
    in a judge rectangle, so custody is resolved per task at runtime, not as a static kwarg), else the single markers_file
    the keyless tests set, else None for a markerless bind. A markers_dir with no file for this task is a hard error, so a
    custody producer that skipped a task fails the session instead of binding markerless."""
    markers_dir = getattr(options, "markers_dir", None)
    if markers_dir:
        path = os.path.join(markers_dir, task + ".json")
        if not os.path.exists(path):
            raise JudgeManagementError(f"markers_dir {markers_dir} has no markers for task {task!r}; hm judge-custody must write one per judge task before launch")
        return path
    return getattr(options, "markers_file", None)


def judge_custody(markers_file: str | None) -> tuple[list[str] | None, str | None]:
    """The task's custody from its markers file (mirrors dr_harbor): the full marker list and its one DRCANARY- canary, or
    (None, None) when no markers file is set, so the slot binds without custody."""
    if not markers_file:
        return None, None
    markers = json.loads(Path(markers_file).read_text())
    canaries = [m for m in markers if CANARY.fullmatch(m)]
    if len(canaries) != 1:
        raise JudgeManagementError(f"the markers file {markers_file} must hold exactly one DRCANARY- canary")
    return markers, canaries[0]


def jev_changed(line: dict) -> bool:
    """judge.ts jevChanges: a hook log line whose session the E1 ruling stopped, or whose Jev version is not the pin."""
    version = line.get("jev_version")
    return line.get("stopped") is True or (version is not None and version != JEV_MODEL)


def judge_task(logs_dir) -> str:
    """The task a trial runs: the basename of task.path in the trial's config.json, which Harbor writes into the trial dir
    before the agent starts (Trial._init_result) and vm-run.sh's oracle gate reads the same way. Harbor's layout is
    jobs/<job>/<trial>/agent, so logs_dir.parent.parent is the job, not the task, and the trial dir's name cuts long task
    names to 32 characters. A config that can't be read is a hard error, never a guessed task."""
    config = Path(logs_dir).parent / "config.json"
    try:
        task = str(json.loads(config.read_text())["task"]["path"]).rstrip("/").rsplit("/", 1)[-1]
    except (OSError, ValueError, KeyError, TypeError) as e:
        raise JudgeManagementError(f"cannot read the trial's task from {config}: {type(e).__name__}: {e}") from None
    if not task:
        raise JudgeManagementError(f"{config} names no task path")
    return task


def judge_journal_hits(journal: str, meter_id: str) -> dict:
    """One judge session's custody check (lanes/harness-mechanics/leak.ts journalCheck, cut to the session's own slot): the
    judge proxy's journal lines that carry the slot's meter_id, counting DR_CUSTODY_HIT refusals, marker_hit lines and every
    other refusal code."""
    custody_hits = marker_hits = 0
    refusals: dict[str, int] = {}
    with open(journal) as f:
        for raw in f:
            try:
                line = json.loads(raw)
            except ValueError:
                continue
            if not isinstance(line, dict) or line.get("meter_id") != meter_id:
                continue
            if line.get("kind") == "marker_hit":
                marker_hits += 1
            elif line.get("kind") == "refusal":
                code = str(line.get("code"))
                if code == "DR_CUSTODY_HIT":
                    custody_hits += 1
                else:
                    refusals[code] = refusals.get(code, 0) + 1
    return {"meter_id": meter_id, "custody_hits": custody_hits, "marker_hits": marker_hits, "refusals": refusals}


def write_judge_stop(record: dict) -> None:
    """Append a stop record to the batch STOP file it names (HM_JUDGE_STOP_FILE, $run/STOP, which vm-run.sh watches), so
    no further session starts."""
    if record.get("stop_file"):
        with open(record["stop_file"], "a") as f:
            f.write(json.dumps(record) + "\n")

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


# Harness mechanics D1: a gstack arm consents to the repo's checks before the session, as a user who installs gstack in
# their own repo would. It runs at the workdir with HOME=/root after the arm tar is extracted; its first output line goes in
# the arm info and a nonzero exit is an infrastructure failure. The dry run's d1-checks step runs this same text.
CHECKS_TRUST = "/root/.claude/skills/gstack/bin/gstack-checks trust"


class LanebHooksOptions(LanebOptions):
    strip_snapshot: bool = Field(default=False, description="Strip auto-loaded instruction files from the snapshot before the arm is extracted (harness mechanics).")
    checks_trust: bool = Field(default=False, description="Run gstack-checks trust at the workdir after the arm is extracted (harness mechanics D1, gstack arms only).")
    judge_backend: str | None = Field(default=None, description="A harness mechanics judge arm's judgment-hook backend, jev or p1. Set means the judge path: bind a slot on the judge metering proxy, inject HM_JUDGE_PROXY/HM_JUDGE_TOKEN/HM_JUDGE_CONFIG (/root/.hm/judge/judge-<backend>.json), and stop the batch on a jevChanges line. Unset means run() delegates to the pinned LanebAgent.run byte for byte.")
    markers_dir: str | None = Field(default=None, description="A directory of per-task markers files; the judge session reads <markers_dir>/<task>.json for the task it runs (self.logs_dir.parent.parent.name). The live judge path uses this, because one agent config serves every task in a judge rectangle, so custody cannot be a static per-task kwarg (hm judge-custody writes the files before launch). A missing file is a hard error, never a markerless bind.")
    markers_file: str | None = Field(default=None, description="A single JSON list of the judge session's runner-only markers (one DRCANARY- canary), sent to the judge slot's bind as forbidden_markers and canary (harness mechanics custody; mirrors dr_harbor). Used by the keyless tests; markers_dir takes precedence. Unset (and no markers_dir) binds the slot without custody.")
    judge_allowance_micros: int = Field(default=2_000_000, description="The judge slot's allowance in integer micro-dollars: the decider spend the metering proxy lets one judge session run before DR_ALLOWANCE_STOP.")


class LanebHooksAgent(LanebAgent):
    options_model = LanebHooksOptions

    async def run(self, instruction: str, environment, context) -> None:
        # A non-judge arm takes the pinned path with no duplication, so its launch spec and job.json env stay byte-identical.
        if not getattr(self.options, "judge_backend", None):
            return await super().run(instruction, environment, context)
        # The judge path is a faithful copy of laneb_agent.LanebAgent.run at sha
        # 09cdba851d46a35bf8ade440003ccf79231753ed210e76c4d3c818b983f32a79 plus the live judge additions: a judge-proxy slot
        # bound with the task's custody, HM_JUDGE_PROXY / HM_JUDGE_TOKEN / HM_JUDGE_CONFIG injected into both the session's
        # env dict and the claude wrapper's docker exec -e forward (the frozen judge tar's hooks read them from the
        # container env only), the slot unbound and finalized in the finally, and a jevChanges stop after the session
        # closes. Names laneb_agent owns or a test monkeypatches (query, post_json, the SDK types, the env tuples, the
        # prompt builder, the option tables) are reached through the laneb_agent module so the copy tracks the pin and the
        # test's stubs apply. agent_test.py guards that this path sets the three env vars and binds/unbinds and that the
        # non-judge path takes super().run.
        backend = self.options.judge_backend
        if backend not in ("jev", "p1"):
            raise ValueError(f"judge_backend {backend!r} is not one of ('jev', 'p1')")
        if self.options.system_prompt not in laneb_agent.SYSTEM_PROMPTS:
            raise ValueError(f"system_prompt {self.options.system_prompt!r} is not one of {sorted(laneb_agent.SYSTEM_PROMPTS)}")
        if self.options.session_kind not in laneb_agent.SESSION_KINDS:
            raise ValueError(f"session_kind {self.options.session_kind!r} is not one of {list(laneb_agent.SESSION_KINDS)}")
        if self.options.procedure_line and (self.options.procedure_line not in laneb_agent.PROCEDURE_LINES or not self.options.told_skill):
            raise ValueError(f"procedure_line {self.options.procedure_line!r} is not one of {sorted(laneb_agent.PROCEDURE_LINES)} on a told arm")
        if self.options.closing_line and self.options.closing_line not in laneb_agent.CLOSING_LINES:
            raise ValueError(f"closing_line {self.options.closing_line!r} is not one of {sorted(laneb_agent.CLOSING_LINES)}")
        agent_options = {"system_prompt": self.options.system_prompt, "session_kind": self.options.session_kind, **({"told_skill": self.options.told_skill} if self.options.told_skill else {}),
                         **({"procedure_line": self.options.procedure_line} if self.options.procedure_line else {}),
                         **({"closing_line": self.options.closing_line} if self.options.closing_line else {}), "judge_backend": backend}
        evdir = self._evaluator_dir()
        evdir.mkdir(parents=True, exist_ok=True)
        persona = json.loads(Path(self.options.persona_path).read_text())
        sim = laneb_agent.Simulator(persona, evdir / "usersim-events.jsonl")
        log = sim.log

        container = await asyncio.to_thread(self._container_id, environment)
        arm_info = self._arm_info
        log(arm_info)

        auth = self._resolve_auth_env()
        base_url = auth.get("ANTHROPIC_BASE_URL")
        if not base_url:
            raise RuntimeError("laneb agent needs --base-url pointing at the metering proxy")
        proxy_base = os.environ.get("HM_JUDGE_PROXY_BASE")
        if not proxy_base:
            raise JudgeManagementError("HM_JUDGE_PROXY_BASE must be set in the Harbor process for a judge arm")
        journal = os.environ.get("HM_JUDGE_JOURNAL")
        if not journal:
            raise JudgeManagementError("HM_JUDGE_JOURNAL must be set in the Harbor process for a judge arm")

        open_body = {"trial": environment.session_id, "model": self.options.upstream_model, "cap_usd": self.options.session_cap_usd,
                     "meta": {"arm": self.options.arm, "arm_tar_sha256": arm_info["tar_sha256"], **agent_options}, "open_key": uuid.uuid4().hex}
        for attempt in range(1, laneb_agent.OPEN_ATTEMPTS + 1):
            try:
                session = await asyncio.to_thread(laneb_agent.post_json, self.options.control_url + "/sessions", open_body)
                break
            except laneb_agent.HttpStatusError as e:
                if e.code == 409:
                    log({"event": "ledger_cap_stop", "message": str(e)[:300]})
                    raise laneb_agent.LedgerCapStop(str(e)) from None
                if e.code < 500 or attempt == laneb_agent.OPEN_ATTEMPTS:
                    raise LanebInfraError(f"session open failed: {e}") from None
                log({"event": "session_open_retry", "attempt": attempt, "message": str(e)[:300]})
                await asyncio.sleep(laneb_agent.OPEN_RETRY_S)
            except Exception as e:
                if attempt == laneb_agent.OPEN_ATTEMPTS:
                    raise LanebInfraError(f"session open failed after {attempt} attempts: {type(e).__name__}: {e}") from None
                log({"event": "session_open_retry", "attempt": attempt, "message": f"{type(e).__name__}: {e}"[:300]})
                await asyncio.sleep(laneb_agent.OPEN_RETRY_S)
        log({"event": "session_open", "session": session["id"], "model": self.options.upstream_model, "cap_usd": self.options.session_cap_usd})

        started = time.time()
        result = {}
        error = None
        summary = None
        binding = None
        try:
            model = self._resolved_model_name() or self.options.upstream_model
            # Judge addition: bind a metering-proxy slot per judge session, with the task's custody (mirrors dr_harbor).
            # One agent config serves every task in a judge rectangle, so custody is resolved per task here, from the task
            # the cell already names, not from a static kwarg.
            task = judge_task(self.logs_dir)
            markers, canary = judge_custody(judge_markers_file(self.options, task))
            cell = {"run_id": environment.session_id, "arm": self.options.arm, "task": task,
                    "model": self.options.upstream_model, "trial": 1, "attempt": 1}
            bind_body = {"cell": cell, "models": JUDGE_DECIDERS, "deciders": JUDGE_DECIDERS,
                         "allowance_micros": int(getattr(self.options, "judge_allowance_micros", 2_000_000)),
                         **({"forbidden_markers": markers, "canary": canary} if markers is not None else {})}
            binding = await asyncio.to_thread(manage, "/bind", bind_body)
            judge_proxy = f"{proxy_base.rstrip('/')}/{binding['slot']}"
            judge_config = JUDGE_CONFIG.format(backend=backend)
            log({"event": "judge_bind", "slot": binding["slot"], "meter_id": binding["meter_id"], "backend": backend, "config": judge_config, "custody": markers is not None})
            env = {
                "ANTHROPIC_API_KEY": session["token"],
                "ANTHROPIC_BASE_URL": base_url,
                "ANTHROPIC_MODEL": model,
                **{k: model for k in laneb_agent.ALIAS_ENV},
                "CLAUDE_CONFIG_DIR": "/root/.claude",
                "HOME": "/root",
                "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
                "CLAUDE_CODE_DISABLE_BUNDLED_SKILLS": "1",
                "CLAUDE_CODE_MAX_OUTPUT_TOKENS": str(self.options.max_output_tokens),
                "DISABLE_AUTOUPDATER": "1",
                "DISABLE_TELEMETRY": "1",
                "DISABLE_ERROR_REPORTING": "1",
                "IS_SANDBOX": "1",
            }
            forwarded = laneb_agent.FORWARDED_ENV
            if self.options.session_kind:
                env["GSTACK_SESSION_KIND"] = self.options.session_kind
                forwarded += ("GSTACK_SESSION_KIND",)
            # Judge addition: the three judge env vars ride both the SDK subprocess env and the docker exec -e forward,
            # since the judge tar's hooks read HM_JUDGE_CONFIG / HM_JUDGE_PROXY / HM_JUDGE_TOKEN from the container env only.
            env["HM_JUDGE_PROXY"] = judge_proxy
            env["HM_JUDGE_TOKEN"] = binding["token"]
            env["HM_JUDGE_CONFIG"] = judge_config
            forwarded += ("HM_JUDGE_PROXY", "HM_JUDGE_TOKEN", "HM_JUDGE_CONFIG")

            wrapper_text = Path(self.options.wrapper_path).read_text()
            told = self.options.told_skill
            line = self.options.procedure_line
            closing = self.options.closing_line
            prompt_text = laneb_agent.build_prompt(wrapper_text, instruction, bool(told), told, procedure_line=line, closing_line=closing)
            log({"event": "prompt", "wrapper_sha256": hashlib.sha256(wrapper_text.encode()).hexdigest(), "instruction_sha256": hashlib.sha256(instruction.encode()).hexdigest(), "told_skill": told,
                 **({"procedure_line": line, "procedure_line_sha256": hashlib.sha256(laneb_agent.PROCEDURE_LINES[line].encode()).hexdigest()} if line else {}),
                 **({"closing_line": closing, "closing_line_sha256": hashlib.sha256(laneb_agent.CLOSING_LINES[closing].encode()).hexdigest()} if closing else {})})

            host_dir = Path(tempfile.mkdtemp(prefix="laneb-agent-"))
            wrapper = host_dir / "claude-in-container"
            forward = " ".join(f"-e {name}" for name in forwarded)
            workdir = f"-w {self.options.workdir} " if self.options.workdir else ""
            wrapper.write_text(f"#!/bin/sh\nexec docker exec -i {workdir}{forward} {container} claude \"$@\"\n")
            wrapper.chmod(0o755)

            async def can_use_tool(tool_name, tool_input, ctx):
                if tool_name == "AskUserQuestion":
                    answers = sim.answer(tool_input.get("questions", []))
                    return laneb_agent.PermissionResultAllow(updated_input={**tool_input, "answers": answers})
                return laneb_agent.PermissionResultAllow(updated_input=tool_input)

            async def keep_open(input_data, tool_use_id, ctx):
                return {"continue_": True}

            async def prompt():
                yield {"type": "user", "message": {"role": "user", "content": prompt_text}}

            disallowed = ["WebSearch", "WebFetch"]
            options = laneb_agent.ClaudeAgentOptions(
                cli_path=str(wrapper),
                cwd=str(host_dir),
                env=env,
                can_use_tool=can_use_tool,
                hooks={"PreToolUse": [laneb_agent.HookMatcher(matcher=None, hooks=[keep_open])]},
                permission_mode="default",
                model=model,
                setting_sources=["user", "project"],
                max_turns=self.options.sdk_max_turns,
                disallowed_tools=disallowed,
                **laneb_agent.SYSTEM_PROMPTS[self.options.system_prompt],
            )
            log({"event": "disallowed_tools", "tools": disallowed})
            with (evdir / "sdk-messages.jsonl").open("a") as out:
                async for message in laneb_agent.query(prompt=prompt(), options=options):
                    record = {"type": type(message).__name__, "t": round(time.time() - started, 2)}
                    data = getattr(message, "data", None)
                    if isinstance(data, dict) and data.get("subtype") == "init":
                        record["init"] = {k: data.get(k) for k in ("tools", "skills", "slash_commands", "model", "permissionMode", "cwd", "claude_code_version", "apiKeySource")} | agent_options
                    for attr in ("content", "parent_tool_use_id", "subtype", "result", "usage", "total_cost_usd", "num_turns", "is_error", "stop_reason"):
                        if hasattr(message, attr):
                            record[attr] = getattr(message, attr)
                    if type(message).__name__ == "ResultMessage":
                        result = {k: record.get(k) for k in ("subtype", "num_turns", "is_error", "total_cost_usd", "stop_reason")}
                    out.write(json.dumps(record, default=lambda o: getattr(o, "__dict__", str(o))) + "\n")
        except Exception as e:
            error = e
            log({"event": "agent_error", "type": type(e).__name__, "message": str(e)[:500]})
        finally:
            # Run in a thread and awaited to the end even if this task is cancelled again, so Harbor never moves on to the
            # verifier before the teardown, close and summary finish.
            base = {"result": result, "error": None if error is None else {"type": type(error).__name__, "message": str(error)[:500]}, "arm": arm_info, **agent_options, "wall_s": round(time.time() - started, 1)}
            teardown = asyncio.ensure_future(asyncio.to_thread(self._teardown, container, session["id"], log, base))
            cancelled = None
            while not teardown.done():
                try:
                    await asyncio.shield(teardown)
                except asyncio.CancelledError as e:
                    cancelled = e
            summary = teardown.result()
            closed = summary["session"] or {}
            usage = closed.get("usage", {})
            cached = usage.get("cache_read_input_tokens", 0)
            context.n_input_tokens = usage.get("input_tokens", 0) + usage.get("cache_creation_input_tokens", 0) + usage.get("cache_creation_1h_input_tokens", 0) + cached
            context.n_cache_tokens = cached
            context.n_output_tokens = usage.get("output_tokens", 0)
            context.cost_usd = closed["spent_micros"] / 1_000_000 if "spent_micros" in closed else None
            context.metadata = {"laneb": {"arm": self.options.arm, "session": session["id"], "refused": closed.get("refused"), "requests": closed.get("requests"), "ok_responses": closed.get("ok_responses"), "close_error": summary["close_error"], "result": result,
                                          "judge_backend": backend, "judge_slot": binding["slot"] if binding else None}}
            # Judge addition: unbind and finalize the slot, then check the judge journal for this slot's custody hits and the
            # session's hook log for a jevChanges line, and stop the batch on either. Each step records its own failure and
            # never masks the session's outcome.
            if binding is not None:
                errors = summary["teardown_errors"]

                def judge_error(key: str, event: str, e: Exception) -> None:
                    errors[key] = f"{type(e).__name__}: {e}"[:300]
                    log({"event": event, "message": errors[key]})

                try:
                    await asyncio.to_thread(manage, "/unbind", {"slot": binding["slot"]})
                except Exception as e:
                    judge_error("judge_unbind", "judge_unbind_error", e)
                try:
                    meter = await asyncio.to_thread(manage, "/finalize", {"meter_id": binding["meter_id"]})
                    (evdir / "judge-meter.json").write_text(json.dumps(meter, indent=2))
                except Exception as e:
                    judge_error("judge_finalize", "judge_finalize_error", e)
                try:
                    hits = judge_journal_hits(journal, binding["meter_id"])
                    context.metadata["laneb"]["judge_hits"] = hits
                    summary["judge_hits"] = hits
                    log({"event": "judge_journal", **hits})
                    if hits["custody_hits"]:
                        record = {"reason": "custody_hit", "arm": self.options.arm, "session": environment.session_id, **hits, "stop_file": os.environ.get("HM_JUDGE_STOP_FILE")}
                        log({"event": "custody_hit_stop", **record})
                        write_judge_stop(record)
                except Exception as e:
                    judge_error("judge_journal", "judge_journal_error", e)
                try:
                    self._judge_stop_on_jev_changes(container, log, environment.session_id)
                except Exception as e:
                    judge_error("judge_hook_log", "judge_post_session_error", e)
                try:
                    (evdir / "laneb-summary.json").write_text(json.dumps(summary, indent=2, default=str))
                except Exception:
                    pass
            if cancelled is not None:
                raise cancelled
        if summary["session"] is not None and not summary["session"].get("ok_responses"):
            raise LanebInfraError(f"no model response reached the agent, so this is an infrastructure failure: {error or result}") from error

    def _judge_stop_on_jev_changes(self, container: str, log, session_id: str) -> list[dict]:
        """Read the judge session's hook log, copy it out for the analysis, and on a jevChanges line write the batch STOP
        file ($run/STOP, which vm-run.sh watches, by HM_JUDGE_STOP_FILE) so no further judge session starts. Returns the
        jevChanges lines. A docker exec that fails raises and writes no judge-hooks.jsonl, so an empty copy never stands
        in for a log that was not read; the caller records the failure in laneb-summary.json's teardown_errors."""
        res = self._exec(container, f"cat {JUDGE_HOOK_LOG} 2>/dev/null || true", timeout=PROBE_TIMEOUT_S)
        if res.returncode != 0:
            raise RuntimeError(f"judge hook log copy failed: docker exec exited {res.returncode}: {res.stderr[-300:]!r}")
        text = res.stdout.decode(errors="replace")
        evdir = self._evaluator_dir()
        (evdir / "judge-hooks.jsonl").write_text(text)
        lines = []
        for entry in text.split("\n"):
            if not entry.strip():
                continue
            try:
                lines.append(json.loads(entry))
            except ValueError:
                pass
        changed = [entry for entry in lines if jev_changed(entry)]
        log({"event": "judge_hook_log", "lines": len(lines), "jev_changes": len(changed)})
        if not changed:
            return []
        (evdir / "judge-jevchanges.json").write_text(json.dumps(changed) + "\n")
        record = {"reason": "jevChanges", "arm": self.options.arm, "session": session_id, "jev_changes": changed[:5], "stop_file": os.environ.get("HM_JUDGE_STOP_FILE")}
        log({"event": "jev_changes_stop", **record})
        write_judge_stop(record)
        return changed

    def _strip_snapshot(self, container: str) -> list[str]:
        root = self.options.workdir or "."
        res = subprocess.run(["docker", "exec", "-i", container, "python3", "-", root], input=STRIP_SNAPSHOT.encode(), capture_output=True, timeout=300)
        if res.returncode != 0:
            raise LanebInfraError(f"snapshot strip failed: {res.stderr[-500:]!r}")
        return json.loads(res.stdout.decode().strip().splitlines()[-1])

    def _checks_trust(self, container: str) -> str:
        workdir = ["-w", self.options.workdir] if self.options.workdir else []
        try:
            res = subprocess.run(["docker", "exec", "-i", "-e", "HOME=/root", *workdir, container, "sh", "-c", CHECKS_TRUST], capture_output=True, timeout=300)
        except subprocess.TimeoutExpired:
            raise LanebInfraError("gstack-checks trust timed out") from None
        if res.returncode != 0:
            raise LanebInfraError(f"gstack-checks trust exited {res.returncode}: {res.stderr[-500:]!r}")
        return (res.stdout.decode(errors="replace").strip().splitlines() or [""])[0]

    def _inject_arm(self, container: str) -> dict:
        stripped = self._strip_snapshot(container) if self.options.strip_snapshot else None
        info = super()._inject_arm(container)
        if stripped is not None:
            info = {**info, "stripped": stripped}
        if self.options.checks_trust:
            info = {**info, "checks_trust": self._checks_trust(container)}
        return info

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
