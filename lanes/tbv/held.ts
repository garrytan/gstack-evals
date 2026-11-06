// Copyright (c) 2026 Garry Tan. MIT License.
// Confined held-out steps (the tbv pins addendum). extract, assemble-a and assemble-b (held-step) and tbv-held's unsealed
// record copies (held-unseal) run in docker containers built from an empty image, with the host's system directories,
// the bun binary and this checkout bound read-only, the network off and no host environment. The only writable mount
// is a fresh work dir on tmpfs; the seal container's only writable mount is the sealed directory. A probe container
// with the same mounts checks that nothing else is writable before each real one runs, so a stray write fails inside
// the container instead of needing a scan afterwards.
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { accessSync, closeSync, constants, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import type { Dirent } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fail, TbvError } from "./errors.ts";
import type { Io } from "./types.ts";

export const IMAGE = "gstack-evals-tbv-empty:1";
const EMPTY_LAYER = "sha256:" + createHash("sha256").update(Buffer.alloc(10240)).digest("hex");
const LABEL = "gstack-evals.tbv-held=1";
const REPO = resolve(import.meta.dir, "../..");
const SELF = join(import.meta.dir, "held.ts");
const BUN = "/opt/tbv/bun";
const STEP = ".held-step";
const SEALED = ".sealed";
const SYSTEM = ["/usr", "/bin", "/sbin", "/lib", "/lib64"];
const VOLATILE = new Set(["tmpfs", "ramfs", "devtmpfs"]);
/** The Capy drives are fuse mounts that sync off the machine and keep earlier versions; any fuse mount is treated as one. */
const synced = (type: string) => /^fuse(\.|$)/.test(type);
const errno = (e: unknown) => (e as NodeJS.ErrnoException | undefined)?.code ?? String(e);

export interface Fs {
  lstat: (p: string) => unknown;
  realpath: (p: string) => string;
}
const REAL: Fs = { lstat: lstatSync, realpath: (p) => realpathSync(p) };

/** Where a path lives: its real path (the deepest existing ancestor resolved, the rest joined back), whether it exists, and
 * the deepest mount holding it from a /proc/mounts table. Any error other than ENOENT on the way up (EACCES under an
 * unreadable directory, ENOTCONN under a broken fuse mount) refuses instead of guessing. */
export function place(path: string, mounts: string, fs: Fs = REAL): { real: string; exists: boolean; type: string; at: string } {
  const rest: string[] = [];
  let at = resolve(path);
  for (;;) {
    try {
      fs.lstat(at);
      break;
    } catch (e) {
      if (errno(e) !== "ENOENT" || dirname(at) === at) fail("E_TBV_CUSTODY", "cannot place " + path + ": " + at + " gives " + errno(e) + "; a held-out step never runs on a path it cannot check");
      rest.unshift(basename(at));
      at = dirname(at);
    }
  }
  let real = "";
  try {
    real = join(fs.realpath(at), ...rest);
  } catch (e) {
    fail("E_TBV_CUSTODY", "cannot place " + path + ": resolving " + at + " gives " + errno(e) + "; a held-out step never runs on a path it cannot check");
  }
  const unescape = (s: string) => s.replace(/\\([0-7]{3})/g, (_, o: string) => String.fromCharCode(parseInt(o, 8)));
  const table = mounts.split("\n").map((l) => l.split(" ")).filter((f) => f.length >= 3).map((f) => ({ at: unescape(f[1]!), type: f[2]! }));
  const under = (m: string) => m === "/" || real === m || real.startsWith(m + "/");
  const m = table.filter((x) => under(x.at)).reverse().sort((a, b) => b.at.length - a.at.length)[0] ?? fail("E_TBV_CUSTODY", "no mount in the table holds " + real);
  return { real, exists: rest.length === 0, type: m.type, at: m.at };
}

interface Docker {
  docker?: string;
  mounts?: string;
  io?: Io;
}
interface Bind {
  src: string;
  rw: boolean;
}
const quiet: Io = { out: () => {}, err: () => {} };

/** Docker is up, no labelled container from a dead step still runs, and the tag holds the empty import (one empty layer,
 * nothing set in its config); returns the image id every container then runs, so a later retag cannot swap it. */
function ready(o: Docker): string {
  const exe = o.docker ?? "docker";
  const v = spawnSync(exe, ["version", "--format", "{{.Server.Version}}"], { encoding: "utf8" });
  if (v.error || v.status !== 0) fail("E_TBV_CUSTODY", "docker is not available (" + (v.error ? errno(v.error) : (v.stderr ?? "").trim().slice(0, 200)) + "), so the step cannot run confined; a held-out step never runs unconfined");
  const ps = spawnSync(exe, ["ps", "-q", "--filter", "label=" + LABEL], { encoding: "utf8" });
  if (ps.status !== 0) fail("E_TBV_CUSTODY", "docker ps failed (" + (ps.stderr ?? "").trim().slice(0, 200) + "), so a held-out container left by a dead step cannot be ruled out");
  const left = ps.stdout.trim().split(/\s+/).filter(Boolean);
  if (left.length) fail("E_TBV_CUSTODY", "a held-out container from an earlier step is still running (" + left.join(", ") + "): its caller died before it ended. Stop it with docker kill " + left.join(" ") + ", log it in CUSTODY.md and delete its work dir by the leftover rule, then rerun");
  const look = () => spawnSync(exe, ["image", "inspect", "--format", "{{json .}}", IMAGE], { encoding: "utf8" });
  let ins = look();
  if (ins.status !== 0) {
    const imp = spawnSync(exe, ["import", "-", IMAGE], { input: Buffer.alloc(10240), encoding: "utf8" });
    if (imp.status !== 0) fail("E_TBV_CUSTODY", "docker could not make the empty image " + IMAGE + ": " + (imp.stderr ?? "").trim().slice(0, 200));
    ins = look();
  }
  let img: { Id?: string; Config?: Record<string, unknown> | null; RootFS?: { Layers?: string[] } } = {};
  try { img = JSON.parse(ins.stdout); } catch { img = {}; }
  const set = Object.entries(img.Config ?? {}).filter(([, v]) => v !== null && v !== false && v !== "" && !(typeof v === "object" && !Object.keys(v as object).length)).map(([k]) => k);
  if (ins.status !== 0 || !img.Id || JSON.stringify(img.RootFS?.Layers) !== JSON.stringify([EMPTY_LAYER]) || set.length) fail("E_TBV_CUSTODY", "the image " + IMAGE + " is not the empty import (" + (set.length ? "its config sets " + set.join(", ") : "its layers are not the one empty tar") + "); held-out steps run only in the empty image, so remove it with docker image rm " + IMAGE + " and rerun");
  return img.Id!;
}

/** One container: the host's system directories, the bun binary and this checkout read-only, then the binds given. */
function container(o: Docker & { image: string }, binds: Bind[], workdir: string, cmd: string[]) {
  const mounts = [...SYSTEM.filter((p) => { try { return statSync(p).isDirectory(); } catch { return false; } }).map((p) => ({ src: p, dst: p, rw: false })), { src: process.execPath, dst: BUN, rw: false }, { src: REPO, dst: REPO, rw: false }, ...binds.map((b) => ({ ...b, dst: b.src }))];
  for (const m of mounts) if (/[,"\n]/.test(m.src)) fail("E_TBV_CUSTODY", "the path " + JSON.stringify(m.src) + " holds a comma, a quote or a newline, which docker's --mount cannot take");
  const args = ["run", "--rm", "--network", "none", "--read-only", "--ipc", "none", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--pids-limit", "512", "--ulimit", "core=0", "--log-driver", "none", "--label", LABEL, "--user", process.getuid!() + ":" + process.getgid!(), "--env", "HOME=/nonexistent", "--env", "PATH=/opt/tbv:/usr/local/bin:/usr/bin:/bin", "--env", "BUN_RUNTIME_TRANSPILER_CACHE_PATH=0", "--workdir", workdir, ...mounts.flatMap((m) => ["--mount", "type=bind,src=" + m.src + ",dst=" + m.dst + (m.rw ? "" : ",readonly")]), o.image, ...cmd];
  return spawnSync(o.docker ?? "docker", args, { encoding: "utf8", maxBuffer: 1 << 24 });
}

/** The probe: the same mounts as the container it guards; anything writable but the allowed directory refuses. */
function probe(o: Docker & { image: string }, binds: Bind[], allowed: string) {
  const r = container(o, binds, allowed, [BUN, SELF, "--inner", "probe", allowed]);
  if (r.status !== 0 || r.stdout.trim()) fail("E_TBV_CUSTODY", "the confinement probe refused the container (exit " + r.status + "): " + (r.stdout + r.stderr).trim().split("\n").slice(0, 8).join("; ") + "; nothing ran");
}

/** A fresh work dir on tmpfs: refused if it exists (a dead run's plaintext; the leftover rule deletes it first), off tmpfs, or the mount point itself. */
function freshWork(work: string, mounts: string) {
  const w = place(work, mounts);
  if (w.exists) fail("E_TBV_CUSTODY", "leftover plaintext at " + work + ": a work dir that exists is a dead run's; log it in CUSTODY.md and delete it by the leftover rule, then rerun");
  if (w.type !== "tmpfs") fail("E_TBV_CUSTODY", "the work dir " + work + " is on " + w.type + " (" + w.at + "), not tmpfs; held-out plaintext lives only under /dev/shm");
  if (dirname(w.real) === w.real) fail("E_TBV_CUSTODY", "the work dir cannot be /");
  return w;
}

function existing(paths: string[], flag: string, mounts: string) {
  return paths.map((p) => {
    const at = place(p, mounts);
    if (!at.exists) fail("E_TBV_CUSTODY", "--" + flag + " " + p + " does not exist");
    const st = (() => { try { return statSync(at.real); } catch (e) { return fail("E_TBV_CUSTODY", "--" + flag + " " + p + " cannot be read (" + errno(e) + ")"); } })();
    if (!st.isFile() && !st.isDirectory()) fail("E_TBV_CUSTODY", "--" + flag + " " + p + " is not a regular file or a directory; a socket, FIFO or device lets a confined command talk to the host through a read-only bind, so nothing ran");
    return { path: resolve(p), ...at };
  });
}

export interface HeldStep extends Docker {
  work: string;
  held: string;
  sealCmd: string;
  inputs: string[];
  ro: string[];
  cmd: string[];
  /** Test hook: extra writable binds, which the probe must refuse. */
  extraBinds?: string[];
  /** Test hook: extra read-only binds that skip the host checks, so the probe's own socket and FIFO refusal is tested. */
  roBinds?: string[];
}

/** held-step: checks, then probe, command, probe and seal containers. Returns 0, or throws a TbvError. */
export function heldStep(o: HeldStep): number {
  const io = o.io ?? quiet;
  const mounts = o.mounts ?? readFileSync("/proc/mounts", "utf8");
  if (!o.sealCmd) fail("E_TBV_CUSTODY", "held-step seals every output; pass --seal-cmd");
  if (!o.cmd.length) fail("E_USAGE", "held-step needs a command after --");
  const inputs = existing(o.inputs, "input", mounts);
  for (const i of inputs) if (synced(i.type)) fail("E_TBV_BURNED", "burned-task event: the held-out-derived input " + i.path + " sits on " + i.type + " (" + i.at + "), which syncs off this machine, keeps earlier versions and is readable by other crew threads. Nothing ran and nothing was deleted: deleting it would not undo the exposure. Stop B2, log the path in CUSTODY.md and bring the affected tasks to the Captain to rule on dropping them");
  for (const i of inputs) if (i.type !== "tmpfs") fail("E_TBV_CUSTODY", "--input " + i.path + " is on " + i.type + " (" + i.at + "); held-out-derived plaintext lives only on tmpfs. Log it in CUSTODY.md and delete it, or show it is not held-out-derived and pass it as --ro");
  const ro = existing(o.ro, "ro", mounts);
  const held = place(o.held, mounts);
  if (VOLATILE.has(held.type) || synced(held.type)) fail("E_TBV_CUSTODY", "--held " + o.held + " is on " + held.type + " (" + held.at + "); sealed copies go to a local disk directory (preflight 1)");
  const w = freshWork(o.work, mounts);
  const d = { ...o, image: ready(o) };
  mkdirSync(o.held, { recursive: true, mode: 0o700 });
  try {
    mkdirSync(o.work, { mode: 0o700 });
  } catch (e) {
    fail("E_TBV_CUSTODY", "cannot make the work dir " + o.work + " (" + errno(e) + ")");
  }
  mkdirSync(join(o.work, STEP), { mode: 0o700 });
  const work = w.real;
  const reads = [...inputs, ...ro].map((p) => ({ src: p.real, rw: false }));
  const extra = [...(o.extraBinds ?? []).map((src) => ({ src, rw: true })), ...(o.roBinds ?? []).map((src) => ({ src, rw: false }))];
  try {
    probe(d, [...reads, ...extra, { src: work, rw: true }], work);
  } catch (e) {
    rmSync(o.work, { recursive: true, force: true });
    throw e;
  }
  const run = container(d, [...reads, ...extra, { src: work, rw: true }], work, ["/bin/sh", "-c", 'exec "$@" >"$0/' + STEP + '/stdout" 2>"$0/' + STEP + '/stderr"', work, ...o.cmd]);
  if (run.status !== 0) fail("E_TBV_STEP", "the confined command exited " + (run.status ?? (run.signal ? "on " + run.signal : errno(run.error))) + (run.stderr.trim() ? " (" + run.stderr.trim().slice(0, 300) + ")" : "") + "; nothing was sealed. Its outputs and streams stay under " + o.work + " on tmpfs; read them there, then delete the work dir by the leftover rule");
  const sealBinds = [...ro.map((p) => ({ src: p.real, rw: false })), ...extra, { src: work, rw: false }, { src: realpathSync(o.held), rw: true }];
  probe(d, sealBinds, realpathSync(o.held));
  const s = container(d, sealBinds, work, [BUN, SELF, "--inner", "seal", work, realpathSync(o.held), o.sealCmd]);
  if (s.status !== 0) fail("E_TBV_CUSTODY", "the seal container refused (exit " + s.status + "): " + (s.stderr || s.stdout).trim().slice(0, 400) + "; the plaintext stays under " + o.work + " on tmpfs");
  io.out("held-step: probe ok, command exit 0, " + s.stdout.trim() + " files into " + o.held + "; plaintext stays under " + o.work + " until B2 has used it");
  return 0;
}

export interface HeldUnseal extends Docker {
  work: string;
  froms: string[];
  prefix: string;
  unsealCmd: string;
  ro: string[];
}

/** held-unseal: each <prefix>*.sealed in the --from directories, unsealed into a fresh work dir on tmpfs, confined. */
export function heldUnseal(o: HeldUnseal): number {
  const io = o.io ?? quiet;
  const mounts = o.mounts ?? readFileSync("/proc/mounts", "utf8");
  if (!o.unsealCmd) fail("E_TBV_CUSTODY", "held-unseal needs --unseal-cmd");
  if (!o.prefix || o.prefix.includes("/")) fail("E_USAGE", "held-unseal needs a --prefix without a slash, such as reading-");
  if (!o.froms.length) fail("E_USAGE", "held-unseal needs at least one --from");
  const froms = existing(o.froms, "from", mounts);
  const ro = existing(o.ro, "ro", mounts);
  const w = freshWork(o.work, mounts);
  const d = { ...o, image: ready(o) };
  try {
    mkdirSync(o.work, { mode: 0o700 });
  } catch (e) {
    fail("E_TBV_CUSTODY", "cannot make the work dir " + o.work + " (" + errno(e) + ")");
  }
  const binds = [...froms.map((p) => ({ src: p.real, rw: false })), ...ro.map((p) => ({ src: p.real, rw: false })), { src: w.real, rw: true }];
  try {
    probe(d, binds, w.real);
  } catch (e) {
    rmSync(o.work, { recursive: true, force: true });
    throw e;
  }
  const r = container(d, binds, w.real, [BUN, SELF, "--inner", "unseal", w.real, o.prefix, o.unsealCmd, ...froms.map((f) => f.real)]);
  if (r.status !== 0) fail("E_TBV_CUSTODY", "the unseal container refused (exit " + r.status + "): " + (r.stderr || r.stdout).trim().slice(0, 400) + "; delete " + o.work + " by the leftover rule before a rerun");
  io.out("held-unseal: probe ok, " + r.stdout.trim() + " records into " + o.work + "; delete it when the step that reads it is done");
  return 0;
}

/** Seals one plaintext file: the seal command's output goes to <target>.tmp (O_EXCL), is synced, and is linked to the
 * target, which fails on an existing target, so nothing is ever overwritten; then the .tmp goes. */
export function sealOne(file: string, target: string, cmd: string): void {
  const tmp = target + ".tmp";
  for (const p of [target, tmp]) {
    let there = true;
    try { lstatSync(p); } catch { there = false; }
    if (there) fail("E_TBV_CUSTODY", p + " already exists; a seal never overwrites");
  }
  const r = spawnSync("sh", ["-c", cmd], { input: readFileSync(file), maxBuffer: 1 << 30 });
  if (r.error || r.status !== 0 || !r.stdout?.length) fail("E_TBV_CUSTODY", "the seal command " + (r.error ? errno(r.error) : r.status !== 0 ? "exited " + r.status : "wrote nothing") + " for " + file + "; no sealed copy of it was written");
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  const fd = openSync(tmp, "wx", 0o600);
  try {
    writeFileSync(fd, r.stdout);
    fsyncSync(fd);
  } catch (e) {
    closeSync(fd);
    unlinkSync(tmp);
    fail("E_TBV_CUSTODY", "writing " + tmp + " failed (" + errno(e) + ")");
  }
  closeSync(fd);
  try {
    linkSync(tmp, target);
  } catch (e) {
    unlinkSync(tmp);
    fail("E_TBV_CUSTODY", "cannot move " + tmp + " to " + target + " (" + errno(e) + "); a seal never overwrites");
  }
  unlinkSync(tmp);
}

/** Inside the seal container: walk the whole work dir first (an unreadable directory or file, a symlink or a special file refuses
 * before any seal), refuse if any target or .tmp exists, then seal each file to <held>/<path>.sealed. */
function sealAll(work: string, held: string, cmd: string) {
  const files: string[] = [];
  const walk = (dir: string, rel: string) => {
    let names: string[] = [];
    try {
      names = readdirSync(dir).sort();
    } catch (e) {
      fail("E_TBV_CUSTODY", "cannot read " + dir + " in the work dir (" + errno(e) + "); nothing was sealed");
    }
    for (const n of names) {
      const p = join(dir, n), r = rel ? rel + "/" + n : n;
      let st: ReturnType<typeof lstatSync> | undefined;
      try { st = lstatSync(p); } catch (e) { fail("E_TBV_CUSTODY", "cannot stat " + p + " (" + errno(e) + "); nothing was sealed"); }
      if (st!.isDirectory()) walk(p, r);
      else if (st!.isFile()) {
        try { closeSync(openSync(p, "r")); } catch (e) { fail("E_TBV_CUSTODY", "cannot read " + p + " (" + errno(e) + "); nothing was sealed"); }
        files.push(r);
      }
      else fail("E_TBV_CUSTODY", p + " is a symlink or a special file; a step leaves only files and directories, so nothing was sealed");
    }
  };
  walk(work, "");
  for (const r of files) for (const p of [join(held, r + SEALED), join(held, r + SEALED + ".tmp")]) {
    let there = true;
    try { lstatSync(p); } catch { there = false; }
    if (there) fail("E_TBV_CUSTODY", p + " already exists in the sealed directory; nothing was sealed, and a seal never overwrites");
  }
  let n = 0;
  for (const r of files) {
    try {
      sealOne(join(work, r), join(held, r + SEALED), cmd);
    } catch (e) {
      fail(e instanceof TbvError ? e.code : "E_TBV_CUSTODY", (e instanceof TbvError ? e.message : "sealing " + r + " failed (" + errno(e) + ")") + " (" + n + " of " + files.length + " files were sealed before it)");
    }
    n++;
  }
  return "sealed " + n;
}

/** Inside the unseal container: every <prefix>*.sealed regular file in the --from directories, unsealed into work (O_EXCL). */
function unsealAll(work: string, prefix: string, cmd: string, froms: string[]) {
  let n = 0;
  for (const d of froms) {
    let names: string[] = [];
    try {
      names = readdirSync(d).sort();
    } catch (e) {
      fail("E_TBV_CUSTODY", "cannot read --from " + d + " (" + errno(e) + ")");
    }
    for (const name of names.filter((x) => x.startsWith(prefix) && x.endsWith(SEALED))) {
      const p = join(d, name);
      if (!lstatSync(p).isFile()) fail("E_TBV_CUSTODY", p + " is not a regular file");
      const r = spawnSync("sh", ["-c", cmd], { input: readFileSync(p), maxBuffer: 1 << 30 });
      if (r.error || r.status !== 0 || !r.stdout?.length) fail("E_TBV_CUSTODY", "the unseal command " + (r.error ? errno(r.error) : r.status !== 0 ? "exited " + r.status : "wrote nothing") + " on " + p);
      try {
        writeFileSync(join(work, name.slice(0, -SEALED.length)), r.stdout, { flag: "wx", mode: 0o600 });
      } catch (e) {
        fail("E_TBV_CUSTODY", "cannot write " + name.slice(0, -SEALED.length) + " (" + errno(e) + "); two --from directories may hold the same record");
      }
      n++;
    }
  }
  if (!n) fail("E_TBV_CUSTODY", "no " + prefix + "*" + SEALED + " file in --from " + froms.join(", "));
  return "unsealed " + n;
}

/** Inside the probe container: try to create a file at every mount point and at the usual scratch places; print each
 * place outside the allowed directory where that worked. Character devices (/dev/null over docker's masked /proc files)
 * take writes and keep nothing, and /dev/mqueue holds kernel message queues of the container's own IPC namespace, which
 * die with it, so both are skipped. Then any mount mountinfo lists rw, other than the allowed directory and docker's own
 * /proc, /sys and /dev mounts, refuses; and a walk of everything the container sees (all but /proc, /sys, /dev/pts and
 * /dev/mqueue) refuses any socket or FIFO, which a read-only bind still lets a command talk through, and any directory it
 * can enter but not list. A socket or FIFO bound as a mount point itself shows as docker's placeholder file to readdir, so
 * each mount point outside the kernel set is also stat'ed. */
function probeInside(allowed: string) {
  const unescape = (s: string) => s.replace(/\\([0-7]{3})/g, (_, o: string) => String.fromCharCode(parseInt(o, 8)));
  const table = readFileSync("/proc/self/mountinfo", "utf8").trim().split("\n").map((l) => l.split(" ")).map((f) => ({ at: unescape(f[4]!), type: f[f.indexOf("-") + 1]! }));
  const points = table.filter((m) => m.type !== "mqueue").map((m) => m.at);
  const bad: string[] = [];
  for (const p of new Set([...points, "/", "/tmp", "/var/tmp", "/dev/shm", "/dev", "/run", "/home", "/root"])) {
    if (p === allowed || p.startsWith(allowed + "/")) continue;
    let st: ReturnType<typeof statSync>;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) {
      const f = join(p, ".tbv-probe-" + randomBytes(6).toString("hex"));
      try { closeSync(openSync(f, "wx")); } catch { continue; }
      unlinkSync(f);
      bad.push("writable " + p);
    } else if (st.isFile()) {
      try { closeSync(openSync(p, "r+")); } catch { continue; }
      bad.push("writable " + p);
    }
  }
  const mine = (p: string) => p === allowed || p.startsWith(allowed + "/");
  const kernel = (p: string) => p === "/proc" || p.startsWith("/proc/") || p === "/sys" || p.startsWith("/sys/") || p === "/dev" || p === "/dev/pts" || p === "/dev/mqueue";
  for (const m of readFileSync("/proc/self/mountinfo", "utf8").trim().split("\n").map((l) => l.split(" "))) {
    const at = unescape(m[4]!);
    if (mine(at) || kernel(at)) continue;
    if (m[5]!.split(",").includes("rw")) bad.push("rw mount " + at);
    let st: ReturnType<typeof statSync>;
    try { st = statSync(at); } catch { continue; }
    if (st.isSocket()) bad.push("socket " + at);
    else if (st.isFIFO()) bad.push("fifo " + at);
  }
  const skip = new Set(["/proc", "/sys", "/dev/pts", "/dev/mqueue"]);
  const walk = (dir: string) => {
    let entries: Dirent[] = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      try { accessSync(dir, constants.X_OK); } catch { return; }
      bad.push("unlistable " + dir);
      return;
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (skip.has(p)) continue;
      if (e.isSocket()) bad.push("socket " + p);
      else if (e.isFIFO()) bad.push("fifo " + p);
      else if (e.isDirectory()) walk(p);
    }
  };
  walk("/");
  return bad.join("\n");
}

function inner(argv: string[]): number {
  const [mode, ...a] = argv;
  try {
    const out = mode === "probe" ? probeInside(a[0]!) : mode === "seal" ? sealAll(a[0]!, a[1]!, a[2]!) : mode === "unseal" ? unsealAll(a[0]!, a[1]!, a[2]!, a.slice(3)) : fail("E_USAGE", "unknown inner mode " + mode);
    if (out) console.log(out);
    return mode === "probe" && out ? 1 : 0;
  } catch (e) {
    if (!(e instanceof TbvError)) throw e;
    console.error(e.code + " " + e.message);
    return 2;
  }
}

/** tbv held-step --work DIR --held DIR --seal-cmd CMD [--input PATH]... [--ro PATH]... -- COMMAND [ARGS...]
 *  tbv held-unseal --work DIR --from DIR [--from DIR]... --prefix PFX --unseal-cmd CMD [--ro PATH]... */
export async function run(argv: string[], io: Io): Promise<number> {
  const [sub, ...rest] = argv;
  const one: Record<string, string> = {};
  const many: Record<string, string[]> = { input: [], ro: [], from: [] };
  const single = sub === "held-step" ? ["work", "held", "seal-cmd"] : ["work", "prefix", "unseal-cmd"];
  const repeat = sub === "held-step" ? ["input", "ro"] : ["from", "ro"];
  let i = 0;
  for (; i < rest.length && rest[i] !== "--"; i += 2) {
    const k = rest[i]!.replace(/^--/, ""), v = rest[i + 1];
    if (!rest[i]!.startsWith("--") || v === undefined || (!single.includes(k) && !repeat.includes(k))) fail("E_USAGE", "unknown flag or missing value: " + rest[i] + "; flags are " + [...single, ...repeat].map((f) => "--" + f).join(" "));
    if (repeat.includes(k)) many[k]!.push(v);
    else if (one[k] !== undefined) fail("E_USAGE", "--" + k + " given twice");
    else one[k] = v;
  }
  for (const k of single) if (!one[k]) fail("E_USAGE", sub + " needs --" + k);
  if (sub === "held-step") return heldStep({ work: one.work!, held: one.held!, sealCmd: one["seal-cmd"]!, inputs: many.input!, ro: many.ro!, cmd: rest.slice(i + 1), io });
  if (i < rest.length) fail("E_USAGE", "held-unseal takes no command");
  return heldUnseal({ work: one.work!, froms: many.from!, prefix: one.prefix!, unsealCmd: one["unseal-cmd"]!, ro: many.ro!, io });
}

if (import.meta.main) process.exit(inner(process.argv.slice(3)));
