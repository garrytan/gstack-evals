# Copyright (c) 2026 Garry Tan. MIT License.
"""The unprivileged user every agent command runs as: python -I -m dr_agent.agent_user setup | restore | export <patch>.

dr_harbor runs both as root in the task container. setup adds the user (AGENT_USER, uid and gid AGENT_UID, home /root,
the HOME the session already sets) to /etc/passwd and /etc/group when missing, opens /root for reading and traversal
(go+rx) so the user's bash can read mini's BASH_ENV=/root/.bashrc, and gives the user /testbed. restore gives /testbed
back to root after the session, so root's git there (the patch export and the verifier) needs no safe.directory.
A user or group that holds the name or the id with the other half different is refused (E_DR_RUNTIME).

The agent owns /testbed/.git during the session, so anything it plants there (a clean filter, core.fsmonitor, a
hooksPath) would run as root in root's git. setup keeps a root-only copy of /testbed/.git/config (SAVED_GIT_CONFIG);
restore first kills every process of the agent's uid, then gives /testbed back to root and puts that copy back in place
of whatever the agent left. export runs root's git for the patch with fsmonitor off, hooks pointed at /dev/null and no
global config, as a second layer, and refuses a /testbed/.git that is not a plain directory.
"""
import grp
import os
import pwd
import shutil
import signal
import stat
import subprocess
import sys
import time

AGENT_USER = "agent"
AGENT_UID = 10001
TESTBED = "/testbed"
SAVED_GIT_CONFIG = "/opt/dr/run/git-config"
GIT_SAFE = ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null"]


def _ensure(path, name, ident, line, lookup_name, lookup_id):
    try:
        by_name = lookup_name(name)
    except KeyError:
        by_name = None
    try:
        by_id = lookup_id(ident)
    except KeyError:
        by_id = None
    if by_name is None and by_id is None:
        with open(path, "a") as f:
            f.write(line + "\n")
        return
    if by_name is None or by_id is None or by_name != by_id:
        raise SystemExit(f"E_DR_RUNTIME: {path} already holds {name} or id {ident} for something else; the agent user needs both")


def chown_tree(root, uid, gid):
    os.chown(root, uid, gid, follow_symlinks=False)
    for top, dirs, files in os.walk(root):
        for name in dirs + files:
            os.chown(os.path.join(top, name), uid, gid, follow_symlinks=False)


def save_git_config(testbed=TESTBED, saved=SAVED_GIT_CONFIG):
    """Keep a root-only copy of the repo's config, or note that it had none."""
    config = os.path.join(testbed, ".git", "config")
    if os.path.lexists(saved):
        os.unlink(saved)
    if os.path.isfile(config) and not os.path.islink(config):
        shutil.copyfile(config, saved)
        os.chmod(saved, 0o600)


def restore_git_config(testbed=TESTBED, saved=SAVED_GIT_CONFIG):
    """Replace whatever the agent left at .git/config with the copy setup kept (none if the repo had none)."""
    git_dir = os.path.join(testbed, ".git")
    if os.path.islink(git_dir) or not os.path.isdir(git_dir):
        return
    config = os.path.join(git_dir, "config")
    if os.path.isdir(config) and not os.path.islink(config):
        shutil.rmtree(config)
    elif os.path.lexists(config):
        os.unlink(config)
    if os.path.isfile(saved):
        shutil.copyfile(saved, config)


def _uids(status):
    for line in status.splitlines():
        if line.startswith("Uid:"):
            return {int(x) for x in line.split()[1:]}
    return set()


def kill_uid(uid=AGENT_UID, proc="/proc", rounds=50):
    """SIGKILL every live process any of whose uids is uid, until none is left; zombies run nothing and are skipped."""
    for _ in range(rounds):
        live = []
        for pid in (p for p in os.listdir(proc) if p.isdigit()):
            try:
                with open(os.path.join(proc, pid, "status")) as f:
                    status = f.read()
            except OSError:
                continue
            state = next((line.split()[1] for line in status.splitlines() if line.startswith("State:")), "")
            if uid in _uids(status) and state not in ("Z", "X"):
                live.append(int(pid))
        if not live:
            return
        for pid in live:
            try:
                os.kill(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        time.sleep(0.1)
    raise SystemExit(f"E_DR_RUNTIME: processes of uid {uid} outlived {rounds} kill rounds")


def setup(testbed=TESTBED):
    _ensure("/etc/group", AGENT_USER, AGENT_UID, f"{AGENT_USER}:x:{AGENT_UID}:", grp.getgrnam, grp.getgrgid)
    _ensure("/etc/passwd", AGENT_USER, AGENT_UID, f"{AGENT_USER}:x:{AGENT_UID}:{AGENT_UID}::/root:/bin/bash", lambda n: pwd.getpwnam(n)[:4], lambda i: pwd.getpwuid(i)[:4])
    os.chmod("/root", stat.S_IMODE(os.stat("/root").st_mode) | 0o055)
    save_git_config(testbed)
    chown_tree(testbed, AGENT_UID, AGENT_UID)


def restore(testbed=TESTBED):
    kill_uid()
    chown_tree(testbed, 0, 0)
    restore_git_config(testbed)


def export(patch, testbed=TESTBED):
    """Root's patch export: git add -A, then the staged diff against HEAD, with nothing the agent planted able to run."""
    git_dir = os.path.join(testbed, ".git")
    if os.path.islink(git_dir) or not os.path.isdir(git_dir):
        raise SystemExit(f"E_DR_RUNTIME: {git_dir} is not a plain directory, so the patch is not exported")
    env = {**os.environ, "GIT_DIR": git_dir, "GIT_WORK_TREE": testbed, "GIT_CONFIG_GLOBAL": "/dev/null"}
    os.makedirs(os.path.dirname(patch), exist_ok=True)
    subprocess.run(["git", *GIT_SAFE, "add", "-A"], cwd=testbed, env=env, check=True)
    with open(patch, "wb") as f:
        subprocess.run(["git", *GIT_SAFE, "-c", "core.fileMode=false", "diff", "--cached", "--binary", "HEAD"], cwd=testbed, env=env, stdout=f, check=True)


def main(argv=None):
    args = sys.argv[1:] if argv is None else argv
    if args not in (["setup"], ["restore"]) and not (len(args) == 2 and args[0] == "export"):
        print("E_USAGE: usage: python -I -m dr_agent.agent_user setup | restore | export <patch>", file=sys.stderr)
        return 2
    if args[0] == "export":
        export(args[1])
    else:
        (setup if args[0] == "setup" else restore)()
    print(f"dr_agent.agent_user {args[0]}: {AGENT_USER} uid {AGENT_UID}, {TESTBED}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
