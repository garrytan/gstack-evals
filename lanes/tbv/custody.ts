// Copyright (c) 2026 Garry Tan. MIT License.
// Custody for a run (prereg section 16): the plaintext root on tmpfs, the leftover check at start, and sealed records
// through configured seal and unseal commands (age in production). A command reads the plaintext or the sealed bytes on
// stdin and writes the other on stdout.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fail } from "./errors.ts";

const SEALED = ".sealed";

/** The deepest existing ancestor's real path, with the rest of the path joined back on. */
function realish(path: string): string {
  const rest: string[] = [];
  let at = resolve(path);
  while (!existsSync(at) && dirname(at) !== at) {
    rest.unshift(basename(at));
    at = dirname(at);
  }
  return join(realpathSync(at), ...rest);
}

/** The plaintext root: on tmpfs (read from /proc/mounts), unless devPlaintext, which is refused for held-out input or with an unseal command. */
export function plaintextRoot(dir: string, o: { devPlaintext: boolean; held: boolean; unsealCmd?: string | null; mounts?: string }): string {
  const at = resolve(dir);
  if (o.devPlaintext) {
    if (o.held) fail("E_TBV_CUSTODY", "--dev-plaintext is refused for held-out input; held-out plaintext lives only on tmpfs (/dev/shm)");
    if (o.unsealCmd) fail("E_TBV_CUSTODY", "--dev-plaintext is refused with --unseal-cmd, since sealed input is custody material");
    return at;
  }
  const real = realish(at);
  const mounts = (o.mounts ?? readFileSync("/proc/mounts", "utf8"))
    .split("\n")
    .map((l) => l.split(" "))
    .filter((f) => f.length >= 3)
    .map((f) => ({ at: f[1]!.replace(/\\040/g, " "), type: f[2]! }));
  const under = (m: string) => real === m || real.startsWith(m.endsWith("/") ? m : m + "/");
  const mount = mounts.filter((m) => under(m.at)).sort((a, b) => b.at.length - a.at.length)[0];
  if (mount?.type !== "tmpfs") fail("E_TBV_CUSTODY", "the plaintext root " + at + " is on " + (mount ? mount.type + " (" + mount.at + ")" : "no listed mount") + ", not tmpfs; put it under /dev/shm, or pass --dev-plaintext for dev data only");
  return at;
}

/** The leftover check (test ! -e): a dead run's plaintext root is deleted and the deletion logged. True when one was found. */
export function leftover(dir: string, log: (text: string) => void): boolean {
  if (!existsSync(dir)) return false;
  rmSync(dir, { recursive: true, force: true });
  if (existsSync(dir)) fail("E_TBV_CUSTODY", "leftover plaintext at " + dir + " could not be deleted; delete it before anything else");
  log("custody: deleted leftover plaintext root " + dir + " from a dead run");
  return true;
}

function through(cmd: string, input: Buffer | string, what: string): Buffer {
  const r = spawnSync("sh", ["-c", cmd], { input, maxBuffer: 1 << 30 });
  if (r.error || r.status !== 0) fail("E_TBV_CUSTODY", "the " + what + " command exited " + (r.status ?? String(r.error)) + ": " + String(r.stderr ?? "").trim().slice(0, 200));
  return r.stdout;
}

/** Seals text into path through cmd (or writes it plain when cmd is null, for dev data). The file appears whole or not at all. */
export function seal(cmd: string | null, text: string, path: string): void {
  const bytes = cmd === null ? Buffer.from(text) : through(cmd, text, "seal");
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path + ".tmp", bytes, { mode: 0o600 });
  renameSync(path + ".tmp", path);
}

export function unseal(cmd: string | null, path: string): string {
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch (e) {
    return fail("E_TBV_CUSTODY", "the sealed checkpoint " + path + " cannot be read: " + (e as Error).message);
  }
  return (cmd === null ? bytes : through(cmd, bytes, "unseal")).toString("utf8");
}

export interface Vault {
  root: string;
  durable: string;
  put(name: string, text: string): void;
  all(): Map<string, string>;
}
/** Plaintext in root, a sealed copy of each file in durable as soon as it is written. */
export function openVault(o: { root: string; durable: string; sealCmd: string | null; unsealCmd: string | null }): Vault {
  return {
    root: o.root,
    durable: o.durable,
    put(name, text) {
      mkdirSync(o.root, { recursive: true, mode: 0o700 });
      writeFileSync(join(o.root, name), text, { mode: 0o600 });
      seal(o.sealCmd, text, join(o.durable, name + (o.sealCmd === null ? "" : SEALED)));
    },
    all() {
      const out = new Map<string, string>();
      if (!existsSync(o.durable)) return out;
      for (const n of readdirSync(o.durable).sort()) {
        if (n.endsWith(".tmp")) continue;
        const sealed = n.endsWith(SEALED);
        if (sealed && o.unsealCmd === null) fail("E_TBV_CUSTODY", "the durable directory " + o.durable + " holds sealed checkpoints and no --unseal-cmd was given");
        out.set(sealed ? n.slice(0, -SEALED.length) : n, unseal(sealed ? o.unsealCmd : null, join(o.durable, n)));
      }
      return out;
    },
  };
}
