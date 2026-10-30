// Receipts and journals outlive the machine that wrote them (U3 handoff: "keep smoke-run receipts and journals off
// ephemeral VMs"; Captain brief item 8). A run refuses to keep its proxy journal or its receipts under the OS temp dir,
// /tmp, /var/tmp or /dev/shm, or on a tmpfs or ramfs mount, since those vanish with a reboot, a Capy wake or a deleted VM.
// On a VM the runner deletes afterwards (a Ubicloud smoke run), GSTACK_EVALS_EPHEMERAL=1 says so, and the run then needs
// GSTACK_EVALS_RECEIPTS naming where it copies its receipts and journal before it exits (docs/adapters.md, Lane A).
import { cpSync, existsSync, mkdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { readMounts, type Mount } from "../runner/ledger/paths.ts";

type Env = Record<string, string | undefined>;

const VOLATILE_FS = new Set(["tmpfs", "ramfs", "devtmpfs"]);

const real = (path: string): string => {
  let p = resolve(path);
  const rest: string[] = [];
  while (!existsSync(p) && dirname(p) !== p) {
    rest.unshift(p.slice(dirname(p).length + 1));
    p = dirname(p);
  }
  return join(realpathSync(p), ...rest);
};

const under = (path: string, root: string) => {
  const rel = relative(root, path);
  return rel === "" || (rel !== ".." && !rel.startsWith(".." + sep) && !rel.startsWith(sep));
};

/** Why receipts or a journal at path would not survive the machine, or null when they would. */
export function volatilePathProblem(path: string, mounts: Mount[] = readMounts(), tmp: string = tmpdir()): string | null {
  const p = real(path);
  for (const root of new Set([tmp, "/tmp", "/var/tmp", "/dev/shm"].map((r) => (existsSync(r) ? realpathSync(r) : r)))) {
    if (under(p, root)) return p + " is under " + root + ", which does not outlive the machine";
  }
  const mount = mounts.filter((m) => under(p, m.point)).sort((a, b) => b.point.length - a.point.length)[0];
  if (mount && VOLATILE_FS.has(mount.type)) return p + " is on a " + mount.type + " mount at " + mount.point + ", which does not outlive the machine";
  return null;
}

/** Where an ephemeral VM's run copies its receipts and journal, or the problem that stops the run. */
export function receiptsSink(env: Env = process.env): { sink: string | null } | { problem: string } {
  if (env.GSTACK_EVALS_EPHEMERAL !== "1") return { sink: null };
  if (!env.GSTACK_EVALS_RECEIPTS) return { problem: "GSTACK_EVALS_EPHEMERAL=1 says this machine is deleted after the run, so GSTACK_EVALS_RECEIPTS must name a directory the receipts and journal are copied to (a mount that outlives the VM, or the directory the runner copies back before deleting it)" };
  return { sink: resolve(env.GSTACK_EVALS_RECEIPTS) };
}

/**
 * Copies the run's receipts and journal to the sink, keeping their paths under the run's out dir. A file outside out has
 * no place under the sink, so the copy refuses before it writes anything; the run keeps its journal under out.
 */
export function copyToSink(out: string, files: readonly string[], sink: string): string[] {
  const outside = files.filter((file) => !under(resolve(file), resolve(out)));
  if (outside.length) throw new Error("these files are outside the run's out dir " + resolve(out) + ", so they have no place under the receipts sink: " + outside.join(", "));
  const copied: string[] = [];
  for (const file of files) {
    if (!existsSync(file)) continue;
    const target = join(sink, relative(resolve(out), resolve(file)));
    mkdirSync(dirname(target), { recursive: true });
    cpSync(file, target, { recursive: true, force: true });
    copied.push(target);
  }
  return copied;
}
