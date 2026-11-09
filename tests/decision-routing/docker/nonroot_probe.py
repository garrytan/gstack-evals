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
  6 after dr_agent.agent_user restore, root's git in /testbed works (the patch export and the verifier);
  7 nothing the user plants in /testbed/.git runs as root: a clean filter, core.fsmonitor and a hooksPath
    post-index-change hook planted as the user leave no marker through restore and the root export
    (dr_agent.agent_user export), a process the user left running is gone after restore, and the same plants put back
    by root do run under the old plain root git add (the check's control).

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



MARKS = "/tmp/dr-planted"
PLANT = (
    "cd /testbed && git config filter.drprobe.clean \"sh -c 'id -u > {m}/clean; cat'\" && echo '* filter=drprobe' > .gitattributes"
    " && mkdir -p .git/drhooks && printf '#!/bin/sh\nid -u > {m}/fsmonitor\n' > .git/fsm.sh && chmod +x .git/fsm.sh"
    " && printf '#!/bin/sh\nid -u > {m}/hook\n' > .git/drhooks/post-index-change && chmod +x .git/drhooks/post-index-change"
    " && git config core.fsmonitor /testbed/.git/fsm.sh && git config core.hooksPath /testbed/.git/drhooks"
).format(m=MARKS)


def planted_checks(agent):
    os.makedirs(MARKS, exist_ok=True)
    os.chmod(MARKS, 0o777)
    setup = subprocess.run([PY, "-I", "-m", "dr_agent.agent_user", "setup"], capture_output=True, text=True)
    plant = run(agent, PLANT + " && (setsid sleep 600 > /dev/null 2>&1 &) && echo planted")
    check("7 the user plants a clean filter, core.fsmonitor and a hooksPath hook", setup.returncode == 0 and "planted" in plant.get("output", ""), plant.get("output", "")[-300:])
    for name in os.listdir(MARKS):
        os.unlink(os.path.join(MARKS, name))
    restore = subprocess.run([PY, "-I", "-m", "dr_agent.agent_user", "restore"], capture_output=True, text=True)
    left = 0
    for pid in (p for p in os.listdir("/proc") if p.isdigit()):
        try:
            status = open(f"/proc/{pid}/status").read()
        except OSError:
            continue
        state = next((line.split()[1] for line in status.splitlines() if line.startswith("State:")), "")
        uids = next((line.split()[1:] for line in status.splitlines() if line.startswith("Uid:")), [])
        left += "10001" in uids and state not in ("Z", "X")
    check("7 restore leaves no process of the user running", restore.returncode == 0 and left == 0, f"restore {restore.returncode}, {left} left; " + restore.stderr.strip()[-200:])
    export = subprocess.run([PY, "-I", "-m", "dr_agent.agent_user", "export", "/tmp/dr-probe.patch"], capture_output=True, text=True)
    check("7 the root export runs none of the plants", export.returncode == 0 and os.listdir(MARKS) == [], f"export {export.returncode}, marks {sorted(os.listdir(MARKS))}; " + export.stderr.strip()[-200:])
    check("7 the root export still writes the patch", "# dr probe" in open("/tmp/dr-probe.patch").read() if os.path.exists("/tmp/dr-probe.patch") else False)
    subprocess.run("cd /testbed && git reset -q && " + PLANT.replace("cd /testbed && ", "", 1), shell=True, capture_output=True)
    for name in os.listdir(MARKS):
        os.unlink(os.path.join(MARKS, name))
    subprocess.run("cd /testbed && git add -A && git -c core.fileMode=false diff --cached --binary HEAD > /dev/null", shell=True, capture_output=True)
    marks = {n: open(os.path.join(MARKS, n)).read().strip() for n in os.listdir(MARKS)}
    check("7 control: the same plants run as root under a plain root git add", marks.get("clean") == "0" and marks.get("hook") == "0", json.dumps(marks))
    subprocess.run([PY, "-I", "-m", "dr_agent.agent_user", "setup"], capture_output=True)
    subprocess.run([PY, "-I", "-m", "dr_agent.agent_user", "restore"], capture_output=True)


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
    if supported:
        planted_checks(agent)
    subprocess.run("cd /testbed && git reset -q && git checkout -q -- README.md; rm -f .gitattributes", shell=True)

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
