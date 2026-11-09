# Copyright (c) 2026 Garry Tan. MIT License.
"""Non-root tool commands, checked inside a real task container (run by nonroot.sh as root).

It starts the way dr_harbor starts dr_agent.session: as root under env -i, with a bearer in DR_PROXY_TOKEN. It prepares
the agent user the way dr_harbor does (python -I -m dr_agent.agent_user setup), builds the session's environment from
mini's swebench.yaml with the session's own code, and checks through it:

  1 commands run with a uid other than 0;
  2 no /proc file the command user can read (environ and cmdline of every pid and thread) holds the bearer, while the
    same scan run as root finds it (the scan's positive control);
  3 a submit registers (the first output line is the submit marker, so BASH_ENV was read without an error);
  4 the interpreter, the conda env and the repo's packages resolve the same as root, never under /opt/dr;
  5 the user can write in /testbed and run git there, and the session's Tracker snapshot sees the edit;
  6 after dr_agent.agent_user restore, root's git in /testbed works (the patch export and the verifier).

It also prints side effects (HOME and site-packages writability, sudo, SO_MARK) without judging them.
usage: nonroot_probe.py <expected conda env>
"""
import base64
import json
import os
import subprocess
import sys
from pathlib import Path

import yaml
from minisweagent.config import builtin_config_dir
from minisweagent.exceptions import Submitted

from dr_agent import session, state

TOKEN = os.environ.get("DR_PROXY_TOKEN", "")
PY = "/opt/dr/venv/bin/python"
SCAN = (
    "for f in /proc/[0-9]*/environ /proc/[0-9]*/cmdline /proc/[0-9]*/task/[0-9]*/environ /proc/[0-9]*/task/[0-9]*/cmdline; "
    "do if cat \"$f\" > /dev/null 2>&1; then echo \"R $f $(base64 -w0 < \"$f\")\"; else echo \"U $f\"; fi; done"
)
RESOLVE = [
    "command -v python",
    "echo \"conda=$CONDA_DEFAULT_ENV\"",
    "python -c 'import sys; print(sys.executable); print(sys.path)'",
    "python -m pytest --version 2>&1 | head -1",
]
results = []


def check(name, ok, detail=""):
    results.append((name, bool(ok)))
    print(("PASS " if ok else "FAIL ") + name + (" (" + detail + ")" if detail else ""), flush=True)


def run(env, command):
    try:
        return env.execute({"command": command})
    except Submitted as s:
        return {"submitted": True, "output": str(s)}


def scan_hits(output):
    hits, readable, unreadable = 0, 0, 0
    for line in output.splitlines():
        parts = line.split(" ", 2)
        if parts[0] == "U":
            unreadable += 1
        elif parts[0] == "R":
            readable += 1
            if TOKEN.encode() in base64.b64decode(parts[2] if len(parts) > 2 else ""):
                hits += 1
    return hits, readable, unreadable


def main():
    expected_env = sys.argv[1]
    check("the probe holds a bearer in its initial environment, as the session does", len(TOKEN) >= 32)
    for key in [k for k in os.environ if k.startswith("DR_")]:
        del os.environ[key]
    swebench = yaml.safe_load((Path(builtin_config_dir) / "benchmarks" / "swebench.yaml").read_text())
    section = swebench["environment"]
    as_root = session.local_environment(section, "/testbed")
    supported = hasattr(session, "agent_ids")
    check("dr_agent.session can run commands as the agent user", supported)
    if supported:
        setup = subprocess.run([PY, "-I", "-m", "dr_agent.agent_user", "setup"], capture_output=True, text=True)
        check("dr_agent.agent_user setup exits 0", setup.returncode == 0, (setup.stdout + setup.stderr).strip()[-300:])
        run_as = session.agent_ids({"agent_user": "agent"})
        state.RUN_AS = run_as
        agent = session.local_environment(section, "/testbed", run_as=run_as)
    else:
        agent = as_root

    uid = run(agent, "id -u")
    check("1 commands run with a uid other than 0", uid.get("output", "").strip() not in ("", "0"), "id -u -> " + uid.get("output", "").strip()[:80])

    hits, readable, unreadable = scan_hits(run(agent, SCAN).get("output", ""))
    check("2 no /proc environ or cmdline the command user can read holds the bearer", hits == 0, f"{hits} hits, {readable} readable, {unreadable} unreadable")
    root_hits, _, _ = scan_hits(run(as_root, SCAN).get("output", ""))
    check("2 positive control: the same scan as root finds the bearer", root_hits > 0, f"{root_hits} hits")

    sub = run(agent, "echo COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT")
    check("3 a submit registers", sub.get("submitted") is True, json.dumps(sub)[:200])

    for command in RESOLVE:
        a, r = run(agent, command).get("output", ""), run(as_root, command).get("output", "")
        check("4 resolves as root does: " + command, a == r, a.strip()[:300])
        check("4 not under /opt/dr: " + command, "/opt/dr" not in a)
    conda = run(agent, "echo $CONDA_DEFAULT_ENV").get("output", "").strip()
    check("4 BASH_ENV activates the image's env " + expected_env, conda == expected_env, conda)

    edit = run(agent, "echo '# dr probe' >> README.md && git status --short && git diff --stat && test \"$(stat -c %u README.md)\" != 0")
    check("5 the user edits /testbed and runs git there", edit.get("returncode") == 0 and "README.md" in edit.get("output", ""), edit.get("output", "")[:300])
    snap = state.snapshot_diff("/testbed", binary=False).decode("utf-8", "replace")
    check("5 the Tracker's snapshot sees the edit", "# dr probe" in snap, snap[:200])

    if supported:
        restore = subprocess.run([PY, "-I", "-m", "dr_agent.agent_user", "restore"], capture_output=True, text=True)
        check("6 dr_agent.agent_user restore exits 0", restore.returncode == 0, (restore.stdout + restore.stderr).strip()[-300:])
    export = subprocess.run("cd /testbed && git add -A && git -c core.fileMode=false diff --cached --binary HEAD", shell=True, capture_output=True, text=True)
    check("6 root's git exports the patch afterwards", export.returncode == 0 and "# dr probe" in export.stdout, export.stderr.strip()[:300])
    subprocess.run("cd /testbed && git reset -q && git checkout -q -- README.md", shell=True)

    print("side effects as the command user:", flush=True)
    for command in [
        "id",
        "test -w \"$HOME\" && echo HOME writable || echo HOME not writable",
        "d=$(python -c 'import sysconfig; print(sysconfig.get_path(\"purelib\"))'); test -w \"$d\" && echo \"$d writable\" || echo \"$d not writable\"",
        "sudo -n true 2>&1 | head -1; echo sudo exit ${PIPESTATUS[0]}",
        "python -c 'import socket; s=socket.socket(); s.setsockopt(socket.SOL_SOCKET, 36, 114514); print(\"SO_MARK set\")' 2>&1 | tail -1",
    ]:
        print("  $ " + command + "\n    " + run(agent, command).get("output", "").strip().replace("\n", "\n    "), flush=True)
    failed = [n for n, ok in results if not ok]
    print(f"{len(results) - len(failed)} passed, {len(failed)} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
