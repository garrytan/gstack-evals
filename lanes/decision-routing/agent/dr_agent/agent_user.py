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
of whatever the agent left. export never runs git in the agent's .git: it builds a root-only git dir from setup's config
copy, the agent repo's HEAD, index, refs and ignore and attribute files copied as plain data (a symlink there stops the
export), and the repo's objects read through alternates, so a commondir, config.worktree or hook the agent planted is
never read. It runs that git with fsmonitor off, hooks pointed at /dev/null and no global config, refuses a /testbed/.git
that is not a plain directory, and writes the patch as a new file, never through a symlink the agent left at its path.
"""
import grp
import os
import pwd
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
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


def _copy_plain(src, dst):
    """Copy one regular file the agent wrote, never through a symlink (E_DR_RUNTIME on anything else)."""
    try:
        fd = os.open(src, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except OSError as e:
        raise SystemExit(f"E_DR_RUNTIME: {src} is not a regular file ({e.strerror}), so the patch is not exported")
    with os.fdopen(fd, "rb") as fin:
        if not stat.S_ISREG(os.fstat(fin.fileno()).st_mode):
            raise SystemExit(f"E_DR_RUNTIME: {src} is not a regular file, so the patch is not exported")
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        with open(dst, "xb") as fout:
            shutil.copyfileobj(fin, fout)


def _export_git_dir(git_dir, work, saved):
    """A root-only git dir for the export: root's saved config, the agent repo's HEAD, index, refs and ignore and
    attribute files copied as plain data, and its objects read through alternates. Nothing else in the agent's .git
    (commondir, config, config.worktree, hooks) is read."""
    if os.path.isfile(saved):
        shutil.copyfile(saved, os.path.join(work, "config"))
    os.makedirs(os.path.join(work, "objects", "info"))
    with open(os.path.join(work, "objects", "info", "alternates"), "w") as f:
        f.write(os.path.join(git_dir, "objects") + "\n")
    names = ["HEAD", "index", "packed-refs", "shallow", os.path.join("info", "exclude"), os.path.join("info", "attributes")]
    names += [n for n in os.listdir(git_dir) if n.startswith("sharedindex.")]
    for sub in ("info", "refs"):
        if os.path.islink(os.path.join(git_dir, sub)):
            raise SystemExit(f"E_DR_RUNTIME: {os.path.join(git_dir, sub)} is not a plain directory, so the patch is not exported")
    for name in names:
        if os.path.lexists(os.path.join(git_dir, name)):
            _copy_plain(os.path.join(git_dir, name), os.path.join(work, name))
    refs = os.path.join(git_dir, "refs")
    os.makedirs(os.path.join(work, "refs"))
    for top, dirs, files in os.walk(refs):
        for name in dirs:
            if os.path.islink(os.path.join(top, name)):
                raise SystemExit(f"E_DR_RUNTIME: {os.path.join(top, name)} is not a plain directory, so the patch is not exported")
        for name in files:
            _copy_plain(os.path.join(top, name), os.path.join(work, os.path.relpath(os.path.join(top, name), git_dir)))


def _open_patch(patch):
    """A new file at patch, opened without following a symlink the agent left there or at its directory."""
    parent, name = os.path.split(os.path.abspath(patch))
    os.makedirs(parent, exist_ok=True)
    dfd = os.open(parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        try:
            os.unlink(name, dir_fd=dfd)
        except FileNotFoundError:
            pass
        except OSError as e:
            raise SystemExit(f"E_DR_RUNTIME: {patch} could not be cleared ({e.strerror}), so the patch is not exported")
        return os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o644, dir_fd=dfd)
    finally:
        os.close(dfd)


def export(patch, testbed=TESTBED, saved=SAVED_GIT_CONFIG):
    """Root's patch export: git add -A, then the staged diff against HEAD, run in a root-only git dir so nothing the
    agent planted in .git is read as config or run."""
    git_dir = os.path.join(testbed, ".git")
    if os.path.islink(git_dir) or not os.path.isdir(git_dir):
        raise SystemExit(f"E_DR_RUNTIME: {git_dir} is not a plain directory, so the patch is not exported")
    work = tempfile.mkdtemp(prefix="dr-export-")
    try:
        _export_git_dir(git_dir, work, saved)
        env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
        env.update(GIT_DIR=work, GIT_WORK_TREE=testbed, GIT_CONFIG_GLOBAL="/dev/null")
        subprocess.run(["git", *GIT_SAFE, "add", "-A"], cwd=testbed, env=env, check=True)
        with os.fdopen(_open_patch(patch), "wb") as f:
            subprocess.run(["git", *GIT_SAFE, "-c", "core.fileMode=false", "diff", "--cached", "--binary", "HEAD"], cwd=testbed, env=env, stdout=f, check=True)
    finally:
        shutil.rmtree(work, ignore_errors=True)


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
