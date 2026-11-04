// Where the ledger's two tiers live (interface v0.4, "Spend and ledger"). Each has a flag, a variable and a default, and
// every resolved path carries the rule that chose it. The local SQLite tier is refused on a network or FUSE mount, and so
// is a program's record when an envelope entry is written (envelope.ts).
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join, resolve } from "node:path";

export interface Resolved {
  path: string;
  rule: string;
}

export interface Mount {
  point: string;
  type: string;
}

type Env = Record<string, string | undefined>;

function stateDir(env: Env, home: string): Resolved {
  if (env.XDG_STATE_HOME) return { path: join(env.XDG_STATE_HOME, "gstack-evals"), rule: "$XDG_STATE_HOME/gstack-evals" };
  return { path: join(home, ".local", "state", "gstack-evals"), rule: "~/.local/state/gstack-evals, the XDG default" };
}

/** The local SQLite ledger: --ledger, GSTACK_EVALS_LEDGER, then the state directory (on Capy, ~/.capy/work/gstack-evals). Never the OS temp dir. */
export function ledgerPath(flag?: string, env: Env = process.env, home = homedir()): Resolved {
  if (flag) return { path: resolve(flag), rule: "--ledger" };
  if (env.GSTACK_EVALS_LEDGER) return { path: resolve(env.GSTACK_EVALS_LEDGER), rule: "GSTACK_EVALS_LEDGER" };
  if (!env.XDG_STATE_HOME && existsSync(join(home, ".capy", "work"))) {
    return { path: join(home, ".capy", "work", "gstack-evals", "ledger.sqlite"), rule: "~/.capy/work/gstack-evals, the Capy default" };
  }
  const dir = stateDir(env, home);
  return { path: join(dir.path, "ledger.sqlite"), rule: dir.rule };
}

/** The approval record: --ledger-record, GSTACK_EVALS_LEDGER_RECORD, then the state directory. On Capy, a record with no program may sit on your Captain drive; a program's record lives on its envelope host's local disk. */
export function recordPath(flag?: string, env: Env = process.env, home = homedir()): Resolved {
  if (flag) return { path: resolve(flag), rule: "--ledger-record" };
  if (env.GSTACK_EVALS_LEDGER_RECORD) return { path: resolve(env.GSTACK_EVALS_LEDGER_RECORD), rule: "GSTACK_EVALS_LEDGER_RECORD" };
  const dir = stateDir(env, home);
  return { path: join(dir.path, "record"), rule: dir.rule };
}

const REMOTE = /^(nfs\d*|cifs|smb\d*|smbfs|afpfs|afs|ceph|glusterfs|lustre|gpfs|9p|ncpfs|coda|davfs|webdav|sshfs|fuseblk|fuse(\..+)?|macfuse|osxfuse|remote .+)$/;

export function readMounts(): Mount[] {
  if (platform() === "linux") {
    try {
      return readFileSync("/proc/self/mounts", "utf8").split("\n").filter(Boolean).map((line) => {
        const [, point = "", type = ""] = line.split(" ");
        return { point: point.replace(/\\(\d{3})/g, (_, octal: string) => String.fromCharCode(parseInt(octal, 8))), type };
      });
    } catch {
      return [];
    }
  }
  if (platform() !== "darwin") return [];
  return (spawnSync("mount", { encoding: "utf8" }).stdout ?? "").split("\n").flatMap((line) => {
    const m = / on (.+) \(([^,)]+)([^)]*)\)$/.exec(line);
    return m ? [{ point: m[1]!, type: (m[3]!.includes("local") ? "" : "remote ") + m[2] }] : [];
  });
}

/** The file system type when path would sit on a network or FUSE mount, else null. */
export function remoteMount(path: string, mounts: Mount[] = readMounts()): string | null {
  let dir = resolve(path);
  while (!existsSync(dir) && dirname(dir) !== dir) dir = dirname(dir);
  const real = realpathSync(dir);
  const under = (point: string) => real === point || real.startsWith(point.endsWith("/") ? point : point + "/");
  const mount = mounts.filter((m) => under(m.point)).sort((a, b) => b.point.length - a.point.length)[0];
  return mount && REMOTE.test(mount.type) ? mount.type : null;
}
