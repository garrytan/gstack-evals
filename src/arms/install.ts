// Arm installs on a real host (GST-272). Each arm of a call becomes an ordered list of layers: directories on this machine
// laid out relative to the agent's HOME. The Docker rig copies them into an arm image (src/skill-eval/cli/run-host.ts),
// and the keyless test rig copies them into a session's HOME.
//
// - A stack tree comes from a local git repository that already holds the commit: the checkout a base was inferred
//   from, a gstack checkout on this machine, or a repository under <state>/sources/. Nothing is fetched (E_STACK_SOURCE).
//   git archive extracts the tree, and its bytes are verified by digest: hashed again in an empty repository with every
//   git attribute off, they must give the commit's tree id (E_STACK_DIGEST).
// - A tree is installed by its own installer, gstack's `./setup --host <host> --no-browser -q` unless the arm names one,
//   with the checkout at ~/.local/share/<repo>. The Docker rig runs it in a builder container from the pinned trial
//   image, with egress at build time and never in a trial; the keyless rig runs it in a scratch HOME. The kept output is
//   the checkout, the host's skills directory and Claude Code's settings.json. ~/.gstack, ~/.bun and the host's own
//   state are dropped (each trial seeds its own state root), and so are .git and eval fixture paths (FIXTURE_PATH), which
//   are also removed from the tree before its installer runs. Links into HOME
//   become relative and modes become 0755 or 0644, except the host config and data directories the CLIs write their
//   own state into (~/.claude, ~/.codex, ~/.local, ~/.local/share), which become 1777 like HOME itself, so the agent's
//   uid can add files there but cannot change the root-owned install. Every layer is laid out from HOME. Each install
//   and derived layer is cached under <state>/installs/ by a hash of its inputs, and checked against its recorded
//   digest when reused (E_STACK_DIGEST). A run holds each entry it uses (a file named for the run in <entry>.holds/),
//   and releaseInstalls deletes the entries the run built once no other run holds them. Taking a hold, committing a
//   build and deciding a deletion each run under one flock on <state>/installs.lock, so runs that share a state root
//   never delete an entry another run holds.
// - A base arm is two layers: the base tree minus the target skill, installed (the none arm), then every file that
//   installing the arm's skill folder in its place adds or changes. Each base arm runs the base's installer on its own
//   tree, so the host's render of the skill (Codex renders gstack-<skill> from its template) is the installer's own.
// - A stack arm is the stack at its sha, or one subtree of it (StackRef.path, verified against git rev-parse <sha>:<path>),
//   installed whole by its installer: gstack's setup, or the one src/arms/stacks.ts lists for pstack and tstack, with
//   the checkout named for the stack. A stack listed with rig-authored files gets them as a second layer, and its
//   provenance records each file's sha256. A stack that is a Claude Code plugin records its plugin root (plugins), which
//   the host loads as a plugin directory, and the target skill is also looked up under the plugin's skills/.
// - A placebo arm is one layer that Lane B's placebo generator (quick/laneb/arms/placebo/placebo.ts, its default seed)
//   makes from the named arm's installed skills directory: every skill folder keeps one SKILL.md with its front matter
//   (less hooks) and the router's routing text, and every other body becomes prose of the same o200k token count. For a
//   plugin arm (pstack) the same is done under the plugin's skills/, and the plugin keeps only its manifest
//   (.claude-plugin/plugin.json): no playbooks, scripts, references or agents.
// - The target skill is the folder under the host's skills directory whose SKILL.md (links followed inside the tree)
//   names it in its front matter. Its roots are every path that reaches that folder.
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { dlopen, FFIType } from "bun:ffi";
import { chmodSync, closeSync, cpSync, existsSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, readlinkSync, renameSync, rmdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_SEED, placeboSkill } from "../../quick/laneb/arms/placebo/placebo.ts";
import { SKILL_DIRS } from "../adapters/host.ts";
import type { ReasonCode } from "../errors/codes.ts";
import { gstackCheckouts, NAME } from "../skill-eval/cli/arms.ts";
import { dirTreeSha256 } from "../trial/cache.ts";
import { FIXTURE_PATH, WRITABLE } from "../trial/image.ts";
import type { ArmSpec, Host, StackRef } from "../types.ts";
import { stackKind } from "./stacks.ts";

/** A directory on this machine and where it lands, relative to the agent's HOME ("" for HOME itself). */
export interface Layer {
  src: string;
  dest: string;
}

/** The target skill as one arm installs it. Paths without a leading slash are relative to the agent's HOME. */
export interface ArmSkill {
  /** Every path that reaches the skill's folder: its registration under the skills directory, the real folder, aliases. */
  roots: string[];
  /** The SKILL.md the host reads, links resolved: the file a calibration copy appends its sentinel to. */
  skillMd: string;
  /** The skill's folder on this machine, for the size of the files a session reads. */
  dir: string;
  /** SKILL.md's bytes on this machine. */
  file: string;
}

export interface ArmInstall {
  name: string;
  layers: Layer[];
  /** The session key's arm tree: sha256 over each layer's destination and tree digest, or kind:name for an empty arm. */
  tree_sha256: string;
  skill: ArmSkill | null;
  /** gstack-skill-start relative to HOME, when the arm installs a gstack tree: calibration's config check runs it. */
  gstack: string | null;
  /** Plugin roots relative to HOME that the host loads for each session as plugin directories (pstack); empty for most arms. */
  plugins: string[];
  provenance: Record<string, unknown>;
}

export class InstallError extends Error {
  constructor(readonly code: ReasonCode, readonly detail: string, readonly fix?: string) {
    super(code + ": " + detail);
  }
}

/** Runs one tree's installer and copies the kept paths under HOME into out. Returns null, or why it failed. */
export interface InstallRunner {
  /** Names the runner in the install cache key: the builder image's digest, or "local". */
  id: string;
  /** HOME as the installer sees it; links into it are made relative. */
  home: string;
  run(src: string, o: { name: string; command: string; keep: readonly string[]; out: string; log: string }): string | null;
}

export const PLACEBO_GENERATOR = fileURLToPath(new URL("../../quick/laneb/arms/placebo/placebo.ts", import.meta.url));

/** The installer a stack arm runs when it names none: gstack's own setup for the host, without the browser. */
export const stackInstall = (host: Host): string => "./setup --host " + host + " --no-browser -q";

const sha = (text: string | Buffer): string => createHash("sha256").update(text).digest("hex");
const cleanEnv = (): Record<string, string> => Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined && !e[0].startsWith("GIT_")));
const git = (cwd: string, args: string[], env: Record<string, string> = cleanEnv()) => spawnSync("git", args, { cwd, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const sourceGit = (cwd: string, args: string[]) => git(cwd, ["--no-replace-objects", ...args], { ...cleanEnv(), GIT_NO_LAZY_FETCH: "1" });
const quote = (s: string): string => "'" + s.replaceAll("'", "'\\''") + "'";
const checkoutName = (ref: StackRef): string => stackKind(ref)?.name ?? ref.repo.split("/").pop()!;
const kept = (host: Host, name: string): string[] => [".local/share/" + name, SKILL_DIRS[host], ...(host === "claude" ? [".claude/settings.json"] : [])];

/** Repositories that may hold a stack's commit, in search order: the inferred checkout, gstack checkouts, <state>/sources/*. */
export function stackSources(o: { root: string | null; home: string; state: string }): string[] {
  const pinned = join(o.state, "sources");
  const dirs = existsSync(pinned) ? readdirSync(pinned).sort().map((n) => join(pinned, n)) : [];
  return [...new Set([...(o.root ? [o.root] : []), ...gstackCheckouts(o.home).map(([root]) => root), ...dirs])];
}

export { WRITABLE };

/** The install recipe: bump it when canonicalize, WRITABLE or FIXTURE_PATH changes, so no install cached under an older recipe is reused. */
const INSTALL_RECIPE = 2;

const NO_ATTRIBUTES = "* -text -eol -crlf -filter -ident -diff -merge -export-subst -export-ignore -working-tree-encoding\n";

/** The tree at ref.sha (or its subtree at ref.path) from the first source that holds the commit, extracted into to and verified against that tree's id. */
export function stackTree(ref: StackRef, sources: readonly string[], to: string): { source: string; git_tree: string; tree_sha256: string } {
  const name = ref.repo + "@" + ref.sha + (ref.path ? ":" + ref.path : "");
  const source = sources.find((s) => existsSync(s) && sourceGit(s, ["cat-file", "-e", ref.sha + "^{commit}"]).status === 0);
  if (!source) throw new InstallError("E_STACK_SOURCE", name + " is in no local repository (searched: " + (sources.join(", ") || "none") + ")", "Fetch the commit into a gstack checkout (git -C ~/.local/share/gstack fetch origin " + ref.sha + ") or clone the repository under <state>/sources/, then run again. The rig never fetches.");
  const treeish = ref.path ? ref.sha + ":" + ref.path : ref.sha + "^{tree}";
  if (ref.path && sourceGit(source, ["cat-file", "-t", treeish]).stdout.trim() !== "tree") throw new InstallError("E_STACK_SOURCE", name + ": commit " + ref.sha + " in " + source + " has no folder at " + ref.path, "Check the subtree path, relative to the repository root: git -C " + source + " ls-tree " + ref.sha + " " + ref.path);
  const gitTree = sourceGit(source, ["rev-parse", treeish]).stdout.trim();
  const scratch = to + ".x-" + randomBytes(4).toString("hex");
  const tree = join(scratch, "tree");
  mkdirSync(tree, { recursive: true });
  try {
    const tar = join(scratch, "tree.tar");
    const archived = sourceGit(source, ["archive", "--format=tar", "-o", tar, ref.path ? treeish : ref.sha]);
    const extracted = archived.status === 0 ? spawnSync("tar", ["-x", "-f", tar, "-C", tree], { encoding: "utf8" }) : archived;
    if (extracted.status !== 0) throw new InstallError("E_STACK_SOURCE", "cannot extract " + name + " from " + source + ": " + (extracted.stderr || "").trim());
    rmSync(tar);
    const verify = join(scratch, "verify");
    git(scratch, ["init", "-q", verify]);
    writeFileSync(join(verify, ".git", "info", "attributes"), NO_ATTRIBUTES);
    const env = { ...cleanEnv(), GIT_DIR: join(verify, ".git"), GIT_WORK_TREE: tree, GIT_INDEX_FILE: join(scratch, "index"), GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" };
    const config = ["-c", "core.autocrlf=false", "-c", "core.filemode=true", "-c", "core.symlinks=true", "-c", "core.ignorecase=false", "-c", "core.precomposeunicode=false"];
    const added = git(tree, [...config, "add", "-A", "-f", "."], env);
    const got = added.status === 0 ? git(tree, [...config, "write-tree"], env).stdout.trim() : "none (" + added.stderr.trim() + ")";
    if (got !== gitTree) throw new InstallError("E_STACK_DIGEST", "the tree git archive extracted for " + name + " from " + source + " hashes to " + got + ", not the commit's tree " + gitTree, "Run git -C " + source + " fsck, and check the tree for export-ignore, export-subst or filter attributes, which change what git archive writes. A tree that does not verify is never installed.");
    rmSync(to, { recursive: true, force: true });
    renameSync(tree, to);
    return { source, git_tree: gitTree, tree_sha256: dirTreeSha256(to) };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

const SCRIPT = (src: string, out: string, o: { name: string; command: string; keep: readonly string[] }) =>
  [
    "set -e",
    'mkdir -p "$HOME/.local/share"',
    "cp -R " + quote(src) + ' "$HOME/.local/share/' + o.name + '"',
    'cd "$HOME/.local/share/' + o.name + '"',
    o.command,
    'cd "$HOME"',
    "for p in " + o.keep.map(quote).join(" ") + '; do if [ -e "$p" ] || [ -L "$p" ]; then mkdir -p ' + quote(out) + '/"$(dirname "$p")"; cp -R -P "$p" ' + quote(out) + '/"$p"; fi; done',
  ].join("\n");

/** The Docker rig's runner: the installer runs in a builder container from the pinned trial image as the caller's uid, with a fresh Bun cache of its own beside out, removed afterwards. */
export function dockerInstaller(o: { image: string; digest: string; docker: string; home: string }): InstallRunner {
  return {
    id: "docker " + o.digest,
    home: o.home,
    run(src, r) {
      const cache = join(dirname(r.out), "bun-cache");
      mkdirSync(cache, { recursive: true });
      mkdirSync(r.out, { recursive: true });
      try {
        const user = (process.getuid?.() ?? 1000) + ":" + (process.getgid?.() ?? 1000);
        const res = spawnSync(o.docker, ["run", "--rm", "--user", user, "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "-e", "HOME=" + o.home, "-v", src + ":/gse-src:ro", "-v", r.out + ":/gse-out", "-v", cache + ":" + o.home + "/.bun/install/cache", "--entrypoint", "sh", o.image, "-c", SCRIPT("/gse-src", "/gse-out", r)], { encoding: "utf8", timeout: 1_800_000, maxBuffer: 256 * 1024 * 1024 });
        writeFileSync(r.log, (res.stdout ?? "") + (res.stderr ?? "") + (res.error ? String(res.error.message) : ""));
        return res.status === 0 ? null : "the builder exited " + res.status + " (log: " + r.log + ")";
      } finally {
        rmSync(cache, { recursive: true, force: true });
      }
    },
  };
}

/** The keyless rig's runner: the installer runs on this machine with HOME at <scratch>/home. */
export function localInstaller(scratch: string): InstallRunner {
  const home = join(scratch, "home");
  return {
    id: "local",
    home,
    run(src, r) {
      rmSync(home, { recursive: true, force: true });
      mkdirSync(home, { recursive: true });
      mkdirSync(r.out, { recursive: true });
      const res = spawnSync("sh", ["-c", SCRIPT(src, r.out, r)], { cwd: home, env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: home, LANG: "C.UTF-8" }, encoding: "utf8", timeout: 600_000 });
      writeFileSync(r.log, (res.stdout ?? "") + (res.stderr ?? ""));
      return res.status === 0 ? null : "the installer exited " + res.status + " (log: " + r.log + ")";
    },
  };
}

/** Drops .git, skill-evals paths and special files, makes links into home relative, and sets modes to 0755 or 0644 (1777 for WRITABLE). */
export function canonicalize(root: string, home: string | null): void {
  const walk = (dir: string, rel: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      const relPath = rel ? rel + "/" + name : name;
      const st = lstatSync(path);
      if (name === ".git" || FIXTURE_PATH.test(relPath)) rmSync(path, { recursive: true, force: true });
      else if (st.isSymbolicLink()) {
        const target = readlinkSync(path);
        if (home !== null && (target === home || target.startsWith(home + "/"))) {
          unlinkSync(path);
          symlinkSync(posix.relative(posix.dirname("/" + relPath), "/" + target.slice(home.length + 1)) || ".", path);
        }
      } else if (st.isDirectory()) {
        chmodSync(path, WRITABLE.includes(relPath) ? 0o1777 : 0o755);
        walk(path, relPath);
      } else if (st.isFile()) chmodSync(path, st.mode & 0o111 ? 0o755 : 0o644);
      else rmSync(path, { force: true });
    }
  };
  walk(root, "");
}

/** Removes every eval fixture path (FIXTURE_PATH) under root. */
function dropFixtures(root: string, rel = ""): void {
  for (const name of readdirSync(join(root, rel))) {
    const r = rel ? rel + "/" + name : name;
    if (FIXTURE_PATH.test(r)) rmSync(join(root, r), { recursive: true, force: true });
    else if (lstatSync(join(root, r)).isDirectory()) dropFixtures(root, r);
  }
}

/** The first link under a loose folder that is absolute, dangling or leaves the folder, or null. */
function outsideLink(dir: string, rel = ""): string | null {
  for (const name of readdirSync(join(dir, rel)).sort()) {
    const r = rel ? rel + "/" + name : name;
    const st = lstatSync(join(dir, r));
    if (name === ".git") continue;
    if (st.isSymbolicLink() && resolveIn(dir, r) === null) return r;
    const inner = st.isDirectory() ? outsideLink(dir, r) : null;
    if (inner) return inner;
  }
  return null;
}

/** A run's claim on the install cache: each entry it uses gets a hold file named for the run, saying whether the run built it. */
export interface CacheHold {
  run: string;
  /** Every entry directory the run holds. */
  entries: string[];
}

/** The hold of a run that may already hold entries: a resumed run takes over every entry of the run it continues, those its arms no longer use included. */
export function runHold(state: string, run: string): CacheHold {
  if (typeof run !== "string" || !/^[A-Za-z0-9._-]+$/.test(run) || run === "." || run === "..") throw new InstallError("E_USAGE", "the run id " + JSON.stringify(run) + " is not a plain name, so it cannot name an install hold", "Resume only an out dir whose run.json gstack-evals wrote.");
  const installs = join(state, "installs");
  const names = existsSync(installs) ? readdirSync(installs).sort() : [];
  return { run, entries: names.filter((n) => n.endsWith(".holds") && existsSync(join(installs, n, run))).map((n) => join(installs, n.slice(0, -".holds".length))) };
}

let libc: { symbols: { flock: (fd: number, operation: number) => number } } | null = null;
const LOCK_EX = 2;

/** Runs fn holding an exclusive flock on <installs>.lock, waiting for it. The kernel drops the lock when its descriptor closes or its process dies. */
function locked<T>(installs: string, fn: () => T): T {
  libc ??= dlopen(process.platform === "darwin" ? "libc.dylib" : "libc.so.6", { flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 } });
  mkdirSync(installs, { recursive: true });
  const fd = openSync(installs + ".lock", "a", 0o600);
  try {
    if (libc.symbols.flock(fd, LOCK_EX) !== 0) throw new InstallError("E_IMAGE_BUILD", "could not lock " + installs + ".lock to change the install cache's holds", "Keep the state root on a local filesystem that supports flock(2).");
    return fn();
  } finally {
    closeSync(fd);
  }
}

/** A content-addressed directory under <state>/installs: built once into home/, reused only while it still hashes to its recorded digest. */
function cached(state: string, key: string, meta: Record<string, unknown>, build: (home: string) => void, hold?: CacheHold): { dir: string; tree_sha256: string } {
  const installs = join(state, "installs");
  const dir = join(installs, key.slice(0, 32));
  const record = join(dir, "install.json");
  const mark = (word: "used" | "built") => {
    if (!hold) return;
    mkdirSync(dir + ".holds", { recursive: true });
    writeFileSync(join(dir + ".holds", hold.run), word + "\n");
  };
  if (hold) {
    locked(installs, () => {
      if (!existsSync(join(dir + ".holds", hold.run))) mark("used");
    });
    hold.entries.push(dir);
  }
  const reuse = () => {
    const recorded = (JSON.parse(readFileSync(record, "utf8")) as { tree_sha256: string }).tree_sha256;
    const now = dirTreeSha256(join(dir, "home"));
    if (now !== recorded) throw new InstallError("E_STACK_DIGEST", "the cached install " + dir + " hashes to " + now + ", not its recorded " + recorded, "Remove " + dir + " and run again; it is rebuilt from the verified tree.");
    return { dir: join(dir, "home"), tree_sha256: now };
  };
  if (existsSync(record)) return reuse();
  const tmp = dir + ".tmp-" + randomBytes(4).toString("hex");
  try {
    mkdirSync(join(tmp, "home"), { recursive: true });
    build(join(tmp, "home"));
    const tree = dirTreeSha256(join(tmp, "home"));
    writeFileSync(join(tmp, "install.json"), JSON.stringify({ schema_version: 1, ...meta, tree_sha256: tree }, null, 2) + "\n");
    const committed = locked(installs, () => {
      if (existsSync(record)) return false;
      rmSync(dir, { recursive: true, force: true });
      renameSync(tmp, dir);
      mark("built");
      return true;
    });
    return committed ? { dir: join(dir, "home"), tree_sha256: tree } : reuse();
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Ends a run's holds. An entry the run built is deleted with its log once no other run holds it; while another run does,
 * that run's hold is marked built instead, so the last run to let go deletes it. Entries the run only reused stay.
 * Returns the entries deleted.
 */
export function releaseInstalls(hold: CacheHold): string[] {
  const deleted: string[] = [];
  for (const dir of new Set(hold.entries)) {
    const holds = dir + ".holds";
    const mine = join(holds, hold.run);
    const doomed = locked(dirname(dir), () => {
      const built = existsSync(mine) && readFileSync(mine, "utf8").trim() === "built";
      const others = existsSync(holds) ? readdirSync(holds).filter((n) => n !== hold.run).sort() : [];
      if (others.length) {
        if (built) writeFileSync(join(holds, others[0]!), "built\n");
        rmSync(mine, { force: true });
        return null;
      }
      let to: string | null = null;
      if (built && existsSync(dir)) {
        to = dir + ".rm-" + randomBytes(4).toString("hex");
        renameSync(dir, to);
        rmSync(dir + ".log", { force: true });
      }
      rmSync(mine, { force: true });
      try {
        rmdirSync(holds);
      } catch {}
      return to;
    });
    if (!doomed) continue;
    rmSync(doomed, { recursive: true, force: true });
    deleted.push(dir);
  }
  return deleted;
}

/** Follows links one component at a time inside tree; the real path relative to tree, or null when it is missing or leaves the tree. */
function resolveIn(tree: string, rel: string, depth = 0): string | null {
  let cur: string[] = [];
  for (const part of rel.split("/").filter(Boolean)) {
    const next = [...cur, part];
    const st = lstatSync(join(tree, ...next), { throwIfNoEntry: false });
    if (!st) return null;
    if (!st.isSymbolicLink()) {
      cur = next;
      continue;
    }
    const target = readlinkSync(join(tree, ...next));
    const joined = posix.normalize(posix.join(cur.join("/") || ".", target));
    if (depth > 32 || target.startsWith("/") || joined === ".." || joined.startsWith("../")) return null;
    const resolved = resolveIn(tree, joined === "." ? "" : joined, depth + 1);
    if (resolved === null) return null;
    cur = resolved ? resolved.split("/") : [];
  }
  return cur.join("/");
}

const frontName = (text: string): string | null => /^name:\s*["']?([A-Za-z0-9_.:-]+)["']?\s*$/m.exec(/^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? "")?.[1] ?? null;
const isFile = (tree: string, rel: string | null): rel is string => rel !== null && lstatSync(join(tree, rel), { throwIfNoEntry: false })?.isFile() === true;

/** The target skill in an installed tree: under the host's skills directory, then each plugin root's skills/. */
export function findSkill(tree: string, skillsDir: string, skill: string, plugins: readonly string[] = []): ArmSkill | null {
  for (const dir of [skillsDir, ...plugins.map((p) => p + "/skills")]) {
    const found = skillIn(tree, dir, skill);
    if (found) return found;
  }
  return null;
}

/** Every folder under skillsDir whose SKILL.md names the skill, with its real folder and aliases. */
function skillIn(tree: string, skillsDir: string, skill: string): ArmSkill | null {
  const top = join(tree, skillsDir);
  if (!existsSync(top)) return null;
  const entries = readdirSync(top).sort();
  const regs: string[] = [];
  let md: string | null = null;
  for (const e of entries) {
    const real = resolveIn(tree, skillsDir + "/" + e + "/SKILL.md");
    if (!isFile(tree, real) || frontName(readFileSync(join(tree, real), "utf8")) !== skill) continue;
    regs.push(skillsDir + "/" + e);
    md ??= real;
  }
  if (md === null) return null;
  const real = posix.dirname(md);
  const roots = new Set([...regs, real]);
  for (const e of entries) {
    const link = skillsDir + "/" + e;
    if (!lstatSync(join(tree, link)).isSymbolicLink()) continue;
    const to = resolveIn(tree, link);
    if (to !== null && to !== real && (to === "" || real.startsWith(to + "/"))) roots.add(link + "/" + real.slice(to ? to.length + 1 : 0));
  }
  return { roots: [...roots].sort(), skillMd: md, dir: join(tree, real), file: join(tree, md) };
}

/** The files in full that base lacks or holds differently, copied into to; returns the paths base holds that full does not, which a layer cannot remove. */
function overlay(full: string, base: string, to: string): string[] {
  const lost: string[] = [];
  const same = (a: string, b: string): boolean => {
    const x = lstatSync(a);
    const y = lstatSync(b);
    if (x.isSymbolicLink() || y.isSymbolicLink()) return x.isSymbolicLink() && y.isSymbolicLink() && readlinkSync(a) === readlinkSync(b);
    return x.isFile() && y.isFile() && (x.mode & 0o111) === (y.mode & 0o111) && x.size === y.size && readFileSync(a).equals(readFileSync(b));
  };
  const isDir = (st: ReturnType<typeof lstatSync> | undefined) => st !== undefined && st.isDirectory() && !st.isSymbolicLink();
  const walk = (rel: string) => {
    const names = readdirSync(join(full, rel));
    for (const name of names.sort()) {
      const r = rel ? rel + "/" + name : name;
      const f = lstatSync(join(full, r));
      const b = lstatSync(join(base, r), { throwIfNoEntry: false });
      if (isDir(f) && isDir(b)) walk(r);
      else if (b && isDir(f) !== isDir(b)) lost.push(r);
      else if (!b || !same(join(full, r), join(base, r))) {
        mkdirSync(join(to, rel), { recursive: true });
        cpSync(join(full, r), join(to, r), { recursive: true, verbatimSymlinks: true });
      }
    }
    for (const name of readdirSync(join(base, rel))) if (!names.includes(name)) lost.push(rel ? rel + "/" + name : name);
  };
  walk("");
  canonicalize(to, null);
  return lost;
}

/** Installs every arm of a call for one host. Throws InstallError with a reason code. */
export function installArms(o: { host: Host; arms: readonly ArmSpec[]; skill: string | null; base: { ref: StackRef; root: string | null } | null; sources: readonly string[]; runner: InstallRunner; state: string; hold?: CacheHold }): ArmInstall[] {
  const skillsDir = SKILL_DIRS[o.host];
  const work = join(o.state, "installs", "work-" + randomBytes(6).toString("hex"));
  const trees = new Map<string, ReturnType<typeof stackTree> & { dir: string }>();
  const extract = (ref: StackRef) => {
    const id = ref.repo + "@" + ref.sha + ":" + (ref.path ?? "");
    const dir = join(work, "src-" + sha(id).slice(0, 24));
    let t = trees.get(id);
    if (!t) trees.set(id, (t = { ...stackTree(ref, o.sources, dir), dir }));
    return t;
  };
  const install = (ref: StackRef, folder: string | null | undefined, command: string, label: string) => {
    const src = join(work, "stage-" + randomBytes(6).toString("hex"));
    cpSync(extract(ref).dir, src, { recursive: true, verbatimSymlinks: true });
    if (folder !== undefined) {
      rmSync(join(src, o.skill!), { recursive: true, force: true });
      if (folder !== null) cpSync(folder, join(src, o.skill!), { recursive: true, verbatimSymlinks: true, filter: (from) => !from.split("/").includes(".git") });
    }
    dropFixtures(src);
    const name = checkoutName(ref);
    const keep = kept(o.host, name);
    const srcTree = dirTreeSha256(src);
    const key = sha(JSON.stringify({ recipe: INSTALL_RECIPE, src: srcTree, host: o.host, name, command, keep, runner: o.runner.id }));
    return cached(o.state, key, { src_tree_sha256: srcTree, host: o.host, name, command, runner: o.runner.id }, (home) => {
      const failed = o.runner.run(src, { name, command, keep, out: home, log: join(o.state, "installs", key.slice(0, 32) + ".log") });
      if (failed) throw new InstallError("E_IMAGE_BUILD", "installing " + label + " for " + o.host + " with `" + command + "` failed: " + failed);
      canonicalize(home, o.runner.home);
    }, o.hold);
  };
  const digestOf = (layer: Layer, known?: string) => layer.dest + " " + (known ?? dirTreeSha256(layer.src));
  const gstackIn = (tree: string) => (isFile(tree, resolveIn(tree, skillsDir + "/gstack/bin/gstack-skill-start")) ? skillsDir + "/gstack/bin/gstack-skill-start" : null);
  const need = (name: string, tree: string, plugins: readonly string[] = []): ArmSkill => {
    const found = findSkill(tree, skillsDir, o.skill!, plugins);
    if (!found) throw new InstallError("E_USAGE", "arm " + name + " installs no skill named " + o.skill + " under ~/" + [skillsDir, ...plugins.map((p) => p + "/skills")].join(" or ~/") + " (no folder there has a SKILL.md whose front matter names it)");
    return found;
  };
  const done: ArmInstall[] = [];
  const fulls = new Map<string, string>();
  if (!o.skill && o.arms.some((a) => a.kind === "stack" || a.kind === "placebo" || (a.kind === "overlay" && a.base !== null))) throw new InstallError("E_USAGE", "a base, stack or placebo arm needs the target skill's name (--skill)");
  if (o.skill && !NAME.test(o.skill)) throw new InstallError("E_USAGE", "--skill " + JSON.stringify(o.skill) + " is not a skill name: a lowercase letter, then lowercase letters, digits, - or _");
  try {
    for (const arm of o.arms) {
      const empty = (provenance: Record<string, unknown>): ArmInstall => ({ name: arm.name, layers: [], tree_sha256: arm.kind + ":" + arm.name, skill: null, gstack: null, plugins: [], provenance });
      if (arm.kind === "bare" || (arm.kind === "overlay" && arm.base === null && arm.dir === null)) {
        done.push(empty({ kind: arm.kind }));
      } else if (arm.kind === "loadout") {
        throw new InstallError("E_USAGE", "loadout arm " + arm.name + ": a real host has no loadout install yet");
      } else if (arm.kind === "overlay" && arm.base === null) {
        const at = skillsDir + "/" + arm.skill;
        const link = outsideLink(arm.dir!);
        if (link) throw new InstallError("E_IMAGE_BUILD", "loose arm " + arm.name + ": " + join(arm.dir!, link) + " is a link that is absolute, dangling or leaves the folder, so it could carry a file from this machine into the arm image", "Replace the link with the file it points to, or with a relative link to a file inside the folder.");
        const made = cached(o.state, sha(JSON.stringify({ recipe: INSTALL_RECIPE, loose: dirTreeSha256(arm.dir!), at })), { loose: arm.dir, at }, (home) => {
          cpSync(arm.dir!, join(home, at), { recursive: true, verbatimSymlinks: true, filter: (from) => !from.split("/").includes(".git") });
          canonicalize(home, null);
        }, o.hold);
        const layer = { src: made.dir, dest: "" };
        done.push({ name: arm.name, layers: [layer], tree_sha256: sha(digestOf(layer, made.tree_sha256)), skill: { roots: [at], skillMd: at + "/SKILL.md", dir: join(made.dir, at), file: join(made.dir, at, "SKILL.md") }, gstack: null, plugins: [], provenance: { kind: "overlay", dir: arm.dir, tree_sha256: made.tree_sha256 } });
        fulls.set(arm.name, made.dir);
      } else if (arm.kind === "overlay") {
        const ref = arm.base!;
        const command = stackInstall(o.host);
        const t = extract(ref);
        const base = { repo: ref.repo, sha: ref.sha, source: t.source, git_tree: t.git_tree, tree_sha256: t.tree_sha256 };
        const none = install(ref, null, command, ref.repo + "@" + ref.sha.slice(0, 12) + " without " + o.skill);
        const first = { src: none.dir, dest: "" };
        if (arm.dir === null) {
          if (findSkill(none.dir, skillsDir, o.skill!)) throw new InstallError("E_USAGE", "arm " + arm.name + ": the base still installs " + o.skill + " after its " + o.skill + "/ folder is removed, so none would hold the skill");
          done.push({ name: arm.name, layers: [first], tree_sha256: sha(digestOf(first, none.tree_sha256)), skill: null, gstack: gstackIn(none.dir), plugins: [], provenance: { kind: "base", base, install: { command, runner: o.runner.id, tree_sha256: none.tree_sha256 } } });
          fulls.set(arm.name, none.dir);
          continue;
        }
        const full = install(ref, arm.dir, command, arm.name + " on " + ref.repo + "@" + ref.sha.slice(0, 12));
        const top = cached(o.state, sha(JSON.stringify({ recipe: INSTALL_RECIPE, overlay: full.tree_sha256, on: none.tree_sha256 })), { overlay_of: full.tree_sha256, on: none.tree_sha256 }, (home) => {
          const lost = overlay(full.dir, none.dir, home);
          if (lost.length) throw new InstallError("E_IMAGE_BUILD", "installing arm " + arm.name + "'s skill folder on the base removes " + lost.slice(0, 5).join(", ") + (lost.length > 5 ? " and " + (lost.length - 5) + " more" : "") + ", which a layer on the base cannot remove");
        }, o.hold);
        const second = { src: top.dir, dest: "" };
        done.push({ name: arm.name, layers: [first, second], tree_sha256: sha(digestOf(first, none.tree_sha256) + "\n" + digestOf(second, top.tree_sha256)), skill: need(arm.name, full.dir), gstack: gstackIn(full.dir), plugins: [], provenance: { kind: "base", base, dir: arm.dir, install: { command, runner: o.runner.id, tree_sha256: full.tree_sha256 } } });
        fulls.set(arm.name, full.dir);
      } else if (arm.kind === "stack") {
        const kind = stackKind(arm.stack);
        const command = arm.install[o.host] ?? (kind ? kind.install[o.host] : stackInstall(o.host));
        if (!command) throw new InstallError("E_USAGE", "arm " + arm.name + ": " + kind!.name + " has no installer for " + o.host + "; it installs on " + Object.keys(kind!.install).join(" and "));
        const t = extract(arm.stack);
        const full = install(arm.stack, undefined, command, arm.stack.repo + "@" + arm.stack.sha.slice(0, 12) + (arm.stack.path ? ":" + arm.stack.path : ""));
        const layers: Layer[] = [{ src: full.dir, dest: "" }];
        const digests = [digestOf(layers[0]!, full.tree_sha256)];
        const files = Object.entries(o.host === "claude" ? (kind?.files ?? {}) : {}).map(([dest, src]) => ({ dest, src, sha256: sha(readFileSync(src)) }));
        if (files.length) {
          const added = cached(o.state, sha(JSON.stringify({ recipe: INSTALL_RECIPE, files: files.map((f) => [f.dest, f.sha256]) })), { files: files.map((f) => ({ dest: f.dest, sha256: f.sha256 })) }, (home) => {
            for (const f of files) {
              mkdirSync(join(home, posix.dirname(f.dest)), { recursive: true });
              writeFileSync(join(home, f.dest), readFileSync(f.src));
            }
            canonicalize(home, null);
          }, o.hold);
          layers.push({ src: added.dir, dest: "" });
          digests.push(digestOf(layers[1]!, added.tree_sha256));
        }
        const plugins = kind?.plugin ? [".local/share/" + kind.name] : [];
        done.push({ name: arm.name, layers, tree_sha256: sha(digests.join("\n")), skill: need(arm.name, full.dir, plugins), gstack: gstackIn(full.dir), plugins, provenance: { kind: "stack", stack: { repo: arm.stack.repo, sha: arm.stack.sha, ...(arm.stack.path ? { path: arm.stack.path } : {}), source: t.source, git_tree: t.git_tree, tree_sha256: t.tree_sha256 }, install: { command, runner: o.runner.id, tree_sha256: full.tree_sha256 }, ...(files.length ? { files: Object.fromEntries(files.map((f) => [f.dest, f.sha256])) } : {}) } });
        fulls.set(arm.name, full.dir);
      } else {
        const of = done.find((d) => d.name === arm.of);
        if (!of?.skill) throw new InstallError("E_USAGE", "placebo arm " + arm.name + " is generated from arm " + arm.of + ", which installs no skill");
        const tree = fulls.get(of.name)!;
        const generator = sha(readFileSync(PLACEBO_GENERATOR));
        const plugins = of.plugins;
        const roots = [skillsDir, ...plugins.map((p) => p + "/skills")];
        const made = cached(o.state, sha(JSON.stringify({ recipe: INSTALL_RECIPE, placebo: of.tree_sha256, generator, seed: DEFAULT_SEED, skillsDir, ...(plugins.length ? { plugins } : {}) })), { placebo_of: of.tree_sha256, generator_sha256: generator, seed: DEFAULT_SEED }, (home) => {
          const folders = roots.flatMap((root) => (existsSync(join(tree, root)) ? readdirSync(join(tree, root)).sort() : []).flatMap((e) => {
            const real = resolveIn(tree, root + "/" + e + "/SKILL.md");
            return isFile(tree, real) ? [[root + "/" + e, join(tree, real)] as const] : [];
          }));
          for (const [folder, file] of folders) {
            let text: string;
            try {
              text = placeboSkill(posix.basename(folder), readFileSync(file, "utf8"), DEFAULT_SEED).output;
            } catch (error) {
              throw new InstallError("E_IMAGE_BUILD", "the placebo generator cannot rewrite " + folder + "/SKILL.md: " + (error as Error).message);
            }
            mkdirSync(join(home, folder), { recursive: true });
            writeFileSync(join(home, folder, "SKILL.md"), text);
          }
          for (const p of plugins) {
            const manifest = resolveIn(tree, p + "/.claude-plugin/plugin.json");
            if (!isFile(tree, manifest)) throw new InstallError("E_IMAGE_BUILD", "placebo arm " + arm.name + ": " + p + "/.claude-plugin/plugin.json is missing or leaves the installed tree");
            mkdirSync(join(home, p, ".claude-plugin"), { recursive: true });
            writeFileSync(join(home, p, ".claude-plugin", "plugin.json"), readFileSync(join(tree, manifest)));
          }
          canonicalize(home, null);
        }, o.hold);
        const layer = { src: made.dir, dest: "" };
        done.push({ name: arm.name, layers: [layer], tree_sha256: sha(digestOf(layer, made.tree_sha256)), skill: need(arm.name, made.dir, plugins), gstack: null, plugins, provenance: { kind: "placebo", of: arm.of, seed: DEFAULT_SEED, generator_sha256: generator, tree_sha256: made.tree_sha256, ...(plugins.length ? { plugins } : {}) } });
        fulls.set(arm.name, made.dir);
      }
    }
    return done;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** A calibration copy's extra layer: the arm's SKILL.md with the sentinel line appended, at the path the host reads. */
export function sentinelLayer(install: ArmInstall, text: string, dir: string): Layer {
  mkdirSync(join(dir, posix.dirname(install.skill!.skillMd)), { recursive: true });
  writeFileSync(join(dir, install.skill!.skillMd), text);
  canonicalize(dir, null);
  return { src: dir, dest: "" };
}

/** Copies an arm's layers into a HOME in order, as the keyless rig installs them. */
export function copyLayers(layers: readonly Layer[], home: string): void {
  for (const layer of layers) {
    const to = layer.dest ? join(home, layer.dest) : home;
    mkdirSync(to, { recursive: true });
    cpSync(layer.src, to, { recursive: true, verbatimSymlinks: true, force: true });
  }
}
