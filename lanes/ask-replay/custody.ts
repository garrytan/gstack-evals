// Copyright (c) 2026 Garry Tan. MIT License.
// Custody for the ask replay eval (prereg section 11), on the pattern of lanes/autoplan-audit/told.ts with an async
// reader. custody() first removes any ask-custody-* directory an earlier opening left on /dev/shm whose recorded owner
// pid is dead, a CUSTODY.md incident line each; a directory whose owner is alive or unreadable is left alone. It checks each sealed record's sha256 against its SHA256SUMS line, writes the identity (streamed in
// on stdin) to a fresh directory on /dev/shm that records its owner pid, decrypts every record there with age, removes the identity and proves it
// gone with test ! -e, then awaits the reader. The directory stays until the reader's promise settles; then it is
// removed and proved gone, and /tmp, /var/tmp and ~/.capy/tool-outputs are swept of files with an ask-replay record's
// name written since the opening, counted and deleted unopened. Each step is a CUSTODY.md line; a failure stops with
// E_ASK_CUSTODY. SIGTERM, SIGINT and SIGHUP during the opening remove the directory, log it and exit; SIGKILL skips the
// teardown, so the next opening's leftover sweep removes what it left and logs it.
// seal() encrypts a file to a recipient; sealedStore() is the reply store a paid shard writes, encrypting each record
// from memory so no reply touches disk in the clear. age and age-keygen come from ~/.local/bin when they are there.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { constants, homedir } from "node:os";
import { basename, join } from "node:path";
import { isatty } from "node:tty";
import { AskError, fail } from "./frozen.ts";
import type { Store } from "./run.ts";
import type { SampleRecord } from "./types.ts";

const bin = (name: string) => {
  const p = join(homedir(), ".local/bin", name);
  return existsSync(p) ? p : name;
};
export const AGE = bin("age");
export const AGE_KEYGEN = bin("age-keygen");
export const ASK_NAMES = /^(items|variant)(\.[\w-]+)?\.jsonl$|\.ask\.json$|^ask-replay-/;
const PREFIX = "ask-custody-";

export const sha256 = (b: string | Buffer): string => createHash("sha256").update(b).digest("hex");
/** test ! -e: the teardown proof. */
export const gone = (p: string): boolean => spawnSync("test", ["!", "-e", p]).status === 0;

export interface CustodyOptions {
  /** The sealed records (.age), each listed in sums. */
  files: string[];
  sums: string;
  log: string;
  identity: Buffer;
  shm?: string;
  sweep?: string[];
  now?: () => Date;
  /** Ends the process after a signal's teardown; defaults to process.exit. */
  exit?: (code: number) => void;
}

const line = (log: string, text: string, now: () => Date) => appendFileSync(log, "- " + now().toISOString() + " " + text + "\n");

/** The opening's owner pid file inside its directory. */
const OWNER = "owner.pid";

/** True only when the pid an opening recorded is a process that no longer exists (kill 0 fails with ESRCH). */
function ownerDead(dir: string): boolean {
  let pid: number;
  try {
    pid = Number(readFileSync(join(dir, OWNER), "utf8").trim());
  } catch {
    return false;
  }
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return false;
  } catch (e) {
    return (e as { code?: string }).code === "ESRCH";
  }
}

/** Removes the custody directories an earlier opening left on the RAM disk whose recorded owner pid is dead, an incident line each; returns how many. */
export function sweepLeftovers(shm: string, log: string, now: () => Date = () => new Date()): number {
  if (!existsSync(log)) writeFileSync(log, "# CUSTODY\n\n");
  let n = 0;
  for (const name of readdirSync(shm).filter((x) => x.startsWith(PREFIX))) {
    const left = join(shm, name);
    if (!ownerDead(left)) continue;
    rmSync(left, { recursive: true, force: true });
    if (!gone(left)) {
      line(log, "incident: a custody directory an earlier opening left is still on disk after its removal", now);
      fail("E_ASK_CUSTODY", "a leftover custody directory could not be removed");
    }
    line(log, "incident: removed a leftover custody directory from an earlier opening (test ! -e passed)", now);
    n++;
  }
  return n;
}

/** Counts and deletes, without opening, files with an ask-replay record's name written at or after since. */
export function sweep(dirs: readonly string[], since: Date): number {
  let n = 0;
  const walk = (d: string, depth: number) => {
    if (depth > 6 || !existsSync(d)) return;
    let names: string[] = [];
    try {
      names = readdirSync(d);
    } catch {
      return;
    }
    for (const name of names) {
      const p = join(d, name);
      let s;
      try {
        s = statSync(p);
      } catch {
        continue;
      }
      if (s.isDirectory()) walk(p, depth + 1);
      else if (ASK_NAMES.test(name) && s.mtimeMs >= since.getTime() - 1000) {
        unlinkSync(p);
        n++;
      }
    }
  };
  for (const d of dirs) walk(d, 0);
  return n;
}

export async function custody<T>(o: CustodyOptions, read: (dir: string) => Promise<T> | T): Promise<T> {
  const now = o.now ?? (() => new Date());
  const shm = o.shm ?? "/dev/shm";
  const sweepDirs = o.sweep ?? ["/tmp", "/var/tmp", join(homedir(), ".capy/tool-outputs")];
  if (!existsSync(o.log)) writeFileSync(o.log, "# CUSTODY\n\n");
  const opened = now();
  const incident = (why: string): never => {
    line(o.log, "incident: " + why, now);
    return fail("E_ASK_CUSTODY", why);
  };
  if (!existsSync(shm) || !realpathSync(shm).startsWith("/dev/shm")) incident("the decrypt directory is not on /dev/shm");
  sweepLeftovers(shm, o.log, now);
  const sums = new Map(readFileSync(o.sums, "utf8").split("\n").filter((l) => l.trim()).map((l) => [l.slice(66).trim(), l.slice(0, 64)] as const));
  for (const f of o.files) if (sums.get(basename(f)) !== sha256(readFileSync(f))) incident("a sealed record's sha256 differs from its SHA256SUMS line");
  const dir = mkdtempSync(join(shm, PREFIX));
  writeFileSync(join(dir, OWNER), String(process.pid), { mode: 0o600 });
  const plain = join(dir, "plain");
  mkdirSync(plain, { mode: 0o700 });
  const identity = join(dir, "identity");
  line(o.log, "open: " + o.files.length + " sealed records, digests checked, decrypting on the RAM disk", now);
  let result: T | undefined;
  let error: unknown = null;
  const signals = (["SIGTERM", "SIGINT", "SIGHUP"] as const).map((sig) => {
    const on = () => {
      rmSync(identity, { force: true });
      rmSync(dir, { recursive: true, force: true });
      line(o.log, "incident: " + sig + " ended the opening; decrypted directory removed (test ! -e " + (gone(dir) ? "passed" : "FAILED") + ")", now);
      (o.exit ?? process.exit)(128 + constants.signals[sig]);
    };
    process.on(sig, on);
    return () => process.off(sig, on);
  });
  try {
    writeFileSync(identity, o.identity, { mode: 0o600 });
    for (const f of o.files) {
      const out = join(plain, basename(f).replace(/\.age$/, ""));
      const r = spawnSync(AGE, ["-d", "-i", identity, "-o", out, f], { encoding: "utf8" });
      if (r.status !== 0) incident("age could not decrypt a sealed record (exit " + r.status + ")");
      if (out.endsWith(".tar")) {
        const x = spawnSync("tar", ["-xf", out, "-C", plain], { encoding: "utf8" });
        rmSync(out, { force: true });
        if (x.status !== 0) incident("a decrypted archive did not extract");
      }
    }
    rmSync(identity, { force: true });
    if (!gone(identity)) incident("the identity is still on disk after its removal");
    line(o.log, "identity removed (test ! -e passed)", now);
    result = await read(plain);
  } catch (e) {
    error = e;
  } finally {
    for (const off of signals) off();
    rmSync(identity, { force: true });
    rmSync(dir, { recursive: true, force: true });
    const ok = gone(dir) && gone(identity);
    const swept = sweep(sweepDirs, opened);
    line(o.log, "close: decrypted directory removed (test ! -e " + (ok ? "passed" : "FAILED") + "), sweep deleted " + swept + " record-named files unopened", now);
    if (!ok) error ??= new AskError("E_ASK_CUSTODY", "a decrypted file is still on disk");
  }
  if (error) throw error;
  return result as T;
}

/** The identity from stdin (fd 0 by default): refused at once when stdin is a terminal or empty. */
export function readIdentity(fd = 0): Buffer {
  if (isatty(fd)) fail("E_ASK_IDENTITY", "stdin is a terminal; pipe the age identity on stdin");
  let b: Buffer;
  try {
    b = readFileSync(fd);
  } catch {
    return fail("E_ASK_IDENTITY", "stdin could not be read");
  }
  if (!b.toString("utf8").trim()) fail("E_ASK_IDENTITY", "stdin is empty; pipe the age identity on stdin");
  return b;
}

/** Encrypts file to recipient as file.age, adds its line to sums when given, and removes the plaintext unless keep is set. */
export function seal(file: string, recipient: string, o: { sums?: string; keep?: boolean } = {}): { path: string; sha256: string } {
  const out = file + ".age";
  const r = spawnSync(AGE, ["-r", recipient, "-o", out + ".tmp", file], { encoding: "utf8" });
  if (r.status !== 0) fail("E_ASK_CUSTODY", "age could not seal a file (exit " + r.status + ")");
  renameSync(out + ".tmp", out);
  const digest = sha256(readFileSync(out));
  if (o.sums) appendFileSync(o.sums, digest + "  " + basename(out) + "\n");
  if (!o.keep) {
    rmSync(file, { force: true });
    if (!gone(file)) fail("E_ASK_CUSTODY", "a sealed file's plaintext is still on disk after its removal");
  }
  return { path: out, sha256: digest };
}

/** A new throwaway identity and its recipient, for the dry run and tests. */
export function keygen(): { identity: Buffer; recipient: string } {
  const r = spawnSync(AGE_KEYGEN, [], { encoding: "utf8" });
  if (r.status !== 0) fail("E_ASK_CUSTODY", "age-keygen failed (exit " + r.status + ")");
  const recipient = /public key: (age1\w+)/.exec(r.stdout + r.stderr)?.[1];
  if (!recipient) fail("E_ASK_CUSTODY", "age-keygen printed no public key");
  return { identity: Buffer.from(r.stdout), recipient: recipient! };
}

const recordName = (id: string) => id + ".ask.json";

/** The paid shard's reply store: each record encrypted from memory to the recipient, then renamed into place. */
export function sealedStore(dir: string, recipient: string): Store {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return {
    has: (id) => existsSync(join(dir, recordName(id) + ".age")),
    write: (id, record) => {
      const final = join(dir, recordName(id) + ".age");
      const r = spawnSync(AGE, ["-r", recipient, "-o", final + ".tmp"], { input: JSON.stringify(record) });
      if (r.status !== 0) fail("E_ASK_CUSTODY", "age could not seal a reply (exit " + r.status + ")");
      renameSync(final + ".tmp", final);
    },
  };
}

/** A plain reply store for keyless runs: one JSON file per record, written to a temporary name and renamed. */
export function plainStore(dir: string): Store & { read(): Map<string, SampleRecord> } {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return {
    has: (id) => existsSync(join(dir, recordName(id))),
    write: (id, record) => {
      const final = join(dir, recordName(id));
      writeFileSync(final + ".tmp", JSON.stringify(record), { mode: 0o600 });
      renameSync(final + ".tmp", final);
    },
    read: () => readRecords(dir),
  };
}

/** Records from a directory of decrypted *.ask.json files, by store id. */
export function readRecords(dir: string): Map<string, SampleRecord> {
  return new Map(readdirSync(dir).filter((f) => f.endsWith(".ask.json")).map((f) => [f.slice(0, -".ask.json".length), JSON.parse(readFileSync(join(dir, f), "utf8")) as SampleRecord]));
}

/** SHA256SUMS for every .age file in dir; returns its path. */
export function writeSums(dir: string): string {
  const path = join(dir, "SHA256SUMS");
  writeFileSync(path, readdirSync(dir).filter((f) => f.endsWith(".age")).sort().map((f) => sha256(readFileSync(join(dir, f))) + "  " + f).join("\n") + "\n");
  return path;
}
