# Copyright (c) 2026 Garry Tan. MIT License.
"""The unprivileged user every agent command runs as: python -I -m dr_agent.agent_user setup | restore.

dr_harbor runs both as root in the task container. setup adds the user (AGENT_USER, uid and gid AGENT_UID, home /root,
the HOME the session already sets) to /etc/passwd and /etc/group when missing, opens /root for reading and traversal
(go+rx) so the user's bash can read mini's BASH_ENV=/root/.bashrc, and gives the user /testbed. restore gives /testbed
back to root after the session, so root's git there (the patch export and the verifier) needs no safe.directory.
A user or group that holds the name or the id with the other half different is refused (E_DR_RUNTIME).
"""
import grp
import os
import pwd
import stat
import sys

AGENT_USER = "agent"
AGENT_UID = 10001
TESTBED = "/testbed"


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


def setup(testbed=TESTBED):
    _ensure("/etc/group", AGENT_USER, AGENT_UID, f"{AGENT_USER}:x:{AGENT_UID}:", grp.getgrnam, grp.getgrgid)
    _ensure("/etc/passwd", AGENT_USER, AGENT_UID, f"{AGENT_USER}:x:{AGENT_UID}:{AGENT_UID}::/root:/bin/bash", lambda n: pwd.getpwnam(n)[:4], lambda i: pwd.getpwuid(i)[:4])
    os.chmod("/root", stat.S_IMODE(os.stat("/root").st_mode) | 0o055)
    chown_tree(testbed, AGENT_UID, AGENT_UID)


def restore(testbed=TESTBED):
    chown_tree(testbed, 0, 0)


def main(argv=None):
    args = sys.argv[1:] if argv is None else argv
    if args not in (["setup"], ["restore"]):
        print("E_USAGE: usage: python -I -m dr_agent.agent_user setup | restore", file=sys.stderr)
        return 2
    (setup if args[0] == "setup" else restore)()
    print(f"dr_agent.agent_user {args[0]}: {AGENT_USER} uid {AGENT_UID}, {TESTBED}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
