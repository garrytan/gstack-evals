"""Keyless tests of real_agent's image check (G admission readiness): a U4 session runs only when its trial container
runs the T-G manifest's image id, and the check comes before any sandbox or session opens. The Agent SDK and Harbor are
stubbed as unit_test.py stubs them. Run by tests/outcome-skills/images.test.ts with python3.
"""

import asyncio
import hashlib
import json
import sys
import tempfile
import traceback
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import unit_test as u  # noqa: E402

ra = u.ra
IMAGE = "sha256:" + "a" * 64
OTHER = "sha256:" + "b" * 64


class Reached(Exception):
    pass


def agent(image_id=IMAGE, container_image=IMAGE, ledger="u4", row=("t-1", IMAGE), recorded=None, manifest=True):
    d = Path(tempfile.mkdtemp(prefix="image-test-"))
    m = d / "tg-images.json"
    m.write_text(json.dumps({"schema": "tg-images.v1", "rows": [{"label": row[0], "image_id": row[1]}]}))
    (d / "task.json").write_text(json.dumps({"repo_dir": "/testbed", "base_branch": "main", "base_commit": "0" * 40, "kind": "K3", "start_ref": "main"}))
    a = ra.RealAgent.__new__(ra.RealAgent)
    a.options = types.SimpleNamespace(
        persona_path=str(u.ROOT / "lanes/real-outcome/agent/ship-persona.json"), task_json=str(d / "task.json"), arms_path=str(u.ROOT / "lanes/outcome-skills/arms/registry.json"),
        arm="none", ledger=ledger, task_label="t-1", trial_n=1, rerun="", image_id=image_id,
        manifest=str(m) if manifest else "", manifest_sha256=recorded or hashlib.sha256(m.read_bytes()).hexdigest(),
    )
    a._arm_info = {"event": "arm", "arm": "none"}
    a._evaluator_dir = lambda: d / "evaluator"
    a._container_id = lambda environment: "cid"
    a.inspected = []
    a._container_image = lambda container: a.inspected.append(container) or container_image
    a._resolve_auth_env = lambda: {"ANTHROPIC_BASE_URL": "http://127.0.0.1:9"}
    a.opened = []

    def open_sandbox(*args):
        a.opened.append(args)
        raise Reached()

    a._open_sandbox = open_sandbox
    a.dir = d
    return a


def run(a):
    try:
        asyncio.run(a.run("Add it.", types.SimpleNamespace(session_id="trial-1"), types.SimpleNamespace()))
    except Exception as e:
        return e
    raise AssertionError("run() returned without reaching the sandbox")


def events(a):
    path = a.dir / "evaluator/usersim-events.jsonl"
    return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []


def test_the_manifest_image_runs_on_to_the_sandbox():
    a = agent()
    e = run(a)
    assert isinstance(e, Reached), repr(e)
    assert a.inspected == ["cid"] and len(a.opened) == 1
    assert {"event": "image", "image_id": IMAGE} in [{k: v for k, v in ev.items() if k != "ts"} for ev in events(a)]


def test_another_image_refuses_before_the_sandbox_opens():
    a = agent(container_image=OTHER)
    e = run(a)
    assert isinstance(e, ra.SandboxSetupError) and "runs image " + OTHER + ", not the manifest's " + IMAGE in str(e), repr(e)
    assert a.opened == []


def test_a_missing_or_malformed_image_id_refuses_before_docker_is_asked():
    for bad in ("", "sha256:" + "a" * 63, IMAGE.upper(), "busybox:1.36", IMAGE + "\n"):
        a = agent(image_id=bad)
        e = run(a)
        assert isinstance(e, ra.SandboxSetupError) and "set image_id" in str(e), (bad, repr(e))
        assert a.inspected == [] and a.opened == [], bad


def test_an_unreadable_container_image_refuses():
    a = agent()

    def broken(container):
        raise ra.SandboxSetupError("E_REAL_SANDBOX_SETUP docker inspect could not read the trial container's image (gone); nothing was opened")

    a._container_image = broken
    e = run(a)
    assert isinstance(e, ra.SandboxSetupError) and "could not read" in str(e), repr(e)
    assert a.opened == []


def test_an_image_id_that_is_not_the_tasks_manifest_row_refuses_before_docker_is_asked():
    a = agent(image_id=OTHER, container_image=OTHER)
    e = run(a)
    assert isinstance(e, ra.SandboxSetupError) and "image_id " + OTHER + " is not " + IMAGE + ", the image the manifest's row for task t-1 pins" in str(e), repr(e)
    assert a.inspected == [] and a.opened == []


def test_a_manifest_with_no_row_for_the_task_refuses():
    a = agent(row=("t-2", IMAGE))
    e = run(a)
    assert isinstance(e, ra.SandboxSetupError) and "has no row for task t-1" in str(e), repr(e)
    assert a.inspected == [] and a.opened == []


def test_a_manifest_whose_bytes_are_not_the_recorded_sha256_refuses():
    a = agent(recorded="0" * 64)
    e = run(a)
    assert isinstance(e, ra.SandboxSetupError) and "set manifest to its path and manifest_sha256" in str(e), repr(e)
    assert a.inspected == [] and a.opened == []


def test_a_session_with_no_manifest_refuses():
    a = agent(manifest=False)
    e = run(a)
    assert isinstance(e, ra.SandboxSetupError) and "reads its image from the T-G manifest" in str(e), repr(e)
    assert a.inspected == [] and a.opened == []


def main():
    failed = 0
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print("PASS", name)
            except Exception:
                failed += 1
                print("FAIL", name)
                traceback.print_exc()
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
