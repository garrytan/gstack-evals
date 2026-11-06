"""Real sandbox setup for one bound T-G task, with no model call. tests/outcome-skills/images-sandbox.test.ts starts a
container from bind's tag and runs this with python3: real_agent's U4 image check against the manifest row, the sidecar's
trial, the egress table and its probe from the runtime layer's /opt/laneb/bin/node, and the in-container prep all run for
real. Only the session open is replaced, so nothing reaches a model. The Agent SDK and Harbor are stubbed as unit_test.py
stubs them. argv[1] is setup (the container runs the pinned image) or refused (the tag was moved to another image first).
"""

import asyncio
import json
import os
import sys
import tempfile
import traceback
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import unit_test as u  # noqa: E402

ra = u.ra
ENV = os.environ


class Reached(Exception):
    """The session open, the first step that would reach a model."""


def agent():
    d = Path(tempfile.mkdtemp(prefix="sandbox-setup-"))
    a = ra.RealAgent.__new__(ra.RealAgent)
    a.options = types.SimpleNamespace(
        persona_path=str(u.ROOT / "lanes/real-outcome/agent/ship-persona.json"), task_json=ENV["TASK_JSON"], arms_path=str(u.ROOT / "lanes/outcome-skills/arms/registry.json"),
        arm="none", ledger="u4", task_label=ENV["LABEL"], trial_n=1, rerun="", image_id=ENV["IMAGE_ID"], manifest=ENV["MANIFEST"], manifest_sha256=ENV["MANIFEST_SHA256"],
        repo_dir="", repo_name="sandbox/repo", feature_branch="feature", probe_node="/opt/laneb/bin/node", sidecar_url=ENV["SIDECAR"], upstream_model="claude-opus-5-5",
    )
    a._arm_info = {"event": "arm", "arm": "none", "tar_sha256": "t"}
    a._evaluator_dir = lambda: d / "evaluator"
    a._container_id = lambda environment: ENV["CONTAINER"]
    a._resolve_auth_env = lambda: {"ANTHROPIC_BASE_URL": ENV["BASE_URL"]}
    a.sessions = []

    def open_session(*args):
        a.sessions.append(args)
        raise Reached()

    a._open_session = open_session
    a.dir = d
    return a


def run(a):
    try:
        asyncio.run(a.run("Add a ratio function.", types.SimpleNamespace(session_id="tg-sandbox"), types.SimpleNamespace()))
    except Exception as e:
        return e
    raise AssertionError("run() went on past the session open")


def events(a):
    return {e["event"]: e for e in (json.loads(line) for line in (a.dir / "evaluator/usersim-events.jsonl").read_text().splitlines())}


def test_setup():
    a = agent()
    e = run(a)
    assert isinstance(e, Reached), repr(e)
    ev = events(a)
    assert ev["image"]["image_id"] == ENV["IMAGE_ID"], ev.get("image")
    proxy = ENV["BASE_URL"].split("://")[1]
    assert proxy in ev["egress"]["allow"] and len(ev["egress"]["allow"]) == 2, ev.get("egress")
    probe = ev["egress_probe"]["result"]
    assert all(probe[k] == "open" for k in ev["egress"]["allow"]) and probe["1.1.1.1:443"] != "open", probe
    task = json.loads(Path(ENV["TASK_JSON"]).read_text())
    assert ev["sandbox_prep"]["branch"] == "feature" and ev["sandbox_prep"]["head"] == task["base_commit"], ev.get("sandbox_prep")
    assert "sandbox_close" in ev and len(a.sessions) == 1, (ev.keys(), a.sessions)


def test_refused():
    a = agent()
    e = run(a)
    assert isinstance(e, ra.SandboxSetupError) and "not the manifest's " + ENV["IMAGE_ID"] in str(e), repr(e)
    ev = events(a)
    assert "sandbox_open" not in ev and "image" not in ev and a.sessions == [], (ev.keys(), a.sessions)


def main():
    name = "test_" + sys.argv[1]
    try:
        globals()[name]()
        print("PASS", name)
    except Exception:
        print("FAIL", name)
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
