// Copyright (c) 2026 Garry Tan. MIT License.
// arms-pins.json (plan sections 2 and 15): one types.ts ArmInstall record per arm, built from the installed homes and
// their install records. pin_checks compares each git-installed tree with its pin's git tree (a checkout by HEAD, tree id
// and git status; a copied tree by hashing it as a git tree with every attribute off), and each npm install with the
// registry (version and integrity of the tarball the build downloads) and, for GSD, with the git tree at the pin file by
// file. newer_seen records each pinned source's default-branch head and latest release on the freeze date, read through
// gh and npm; the pins never move. home_tree_sha256 uses the frozen rule in hash.ts.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { stackTree } from "../../../../src/arms/install.ts";
import type { StackRef } from "../../../../src/types.ts";
import { h2hFail, PREREG_PATH, readPrereg, type H2hPrereg } from "../prereg.ts";
import { ALL_ARMS, BROWSER, type ArmInstall, type H2hArm } from "../types.ts";
import { HASH_RULE, homeTreeSha256 } from "./hash.ts";
import { readRecord, sourceClone, type InstallRecord } from "./install.ts";
import { ARM_HOME, homeArm, homeDir } from "./layer.ts";
import { BUILD_PINS, INSTALL_IMAGE, LOCAL_MARKETPLACES, rewriteMarketplace } from "./recipes.ts";

export const ARMS_PINS_PATH = join(dirname(PREREG_PATH), "arms-pins.json");
type PinCheck = ArmInstall["pin_checks"][number];
type Seen = ArmInstall["newer_seen"][number];

const sha = (b: string | Buffer, alg = "sha256") => createHash(alg).update(b).digest(alg === "sha512" ? "base64" : "hex");
const run = (cmd: string, args: string[], o: { cwd?: string; env?: Record<string, string>; input?: string } = {}) => spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, timeout: 600_000, ...o });
const cleanEnv = (): Record<string, string> => Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined && !e[0].startsWith("GIT_")));

/** Each pack's browser path as installed (plan section 3; stage 0 records it in sessions). */
export const BROWSER_PATHS: Record<H2hArm, string> = {
  none: "none installed; on B1 units the unit image's Playwright Chromium (part B) through the unit's own test runner",
  gstack: "gstack's browse binary .claude/skills/gstack/browse/dist/browse, built by ./setup, driving the Playwright Chromium ./setup installed under .cache/ms-playwright (chromium-1254 and its headless shell)",
  superpowers: "none: the pack documents no browser runtime",
  "agent-skills": "the chrome-devtools MCP server at user scope in .claude.json: npx -y chrome-devtools-mcp@" + BUILD_PINS.chrome_devtools_mcp.version + " --isolated --headless --executablePath " + BROWSER.wrapper_container_path + " (the package from npx's cache in .npm/_npx)",
  gsd: "no install-time browser: its UI agents run npx playwright (the unit's own Playwright and the image's Chromium) and take CHROME_BIN, " + BROWSER.env.CHROME_BIN + " on B1 units",
  pstack: "none: the pack documents no browser runtime",
  tstack: "none: the pack documents no browser runtime",
  "gstack-pony": "as gstack",
  "gstack-oneline": "as gstack",
  "gstack-qa": "as gstack (/qa drives browse)",
};

/** Where an arm's install differs from its README's commands, in plain words (PART-A.md gives the reasons). */
export const DEVIATIONS: Record<H2hArm, string[]> = {
  none: [],
  gstack: ["clone fetched at the pin from a local clone (depth 1, origin set to GitHub) instead of GitHub's head", "the CLAUDE.md section is prereg.json's frozen text, appended by the build"],
  superpowers: ["the official marketplace is added from GitHub (Claude Code refuses a local copy or a sha ref under its reserved name) and its clone is reset to the commit read on the freeze date before the install"],
  "agent-skills": ["marketplace added from the pinned tree copied under HOME, with its plugin source rewritten from GitHub (no ref) to the marketplace root", "chrome-devtools-mcp at a pinned version instead of @latest, registered at user scope, with --headless and --executablePath " + BROWSER.wrapper_container_path],
  gsd: ["npx gets -y so it does not wait at its install prompt; the version is prereg.json's pin instead of @latest"],
  pstack: ["marketplace added from the pinned cursor/plugins tree copied under HOME instead of GitHub's head"],
  tstack: ["skills copied from the pinned tree instead of a fresh clone of the default branch"],
  "gstack-pony": ["as gstack", "ponystack's marketplace added from its pinned tree copied under HOME instead of GitHub's head"],
  "gstack-oneline": ["as gstack"],
  "gstack-qa": ["as gstack"],
};

/** A directory's git tree id: its files hashed in an empty repository with every git attribute off, as git add -A -f
 *  stores them. A .git entry is never added, and empty directories have no entry, as in git. */
export function dirGitTree(at: string): string {
  const dir = resolve(at);
  const scratch = mkdtempSync(join(tmpdir(), "h2h-tree-"));
  try {
    run("git", ["init", "-q", join(scratch, "r")], { env: cleanEnv() });
    writeFileSync(join(scratch, "r", ".git", "info", "attributes"), "* -text -eol -crlf -filter -ident -diff -merge -export-subst -export-ignore -working-tree-encoding\n");
    const env = { ...cleanEnv(), GIT_DIR: join(scratch, "r", ".git"), GIT_WORK_TREE: dir, GIT_INDEX_FILE: join(scratch, "index"), GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" };
    const cfg = ["-c", "core.autocrlf=false", "-c", "core.filemode=true", "-c", "core.symlinks=true", "-c", "core.ignorecase=false", "-c", "core.excludesFile=/dev/null"];
    const a = run("git", [...cfg, "add", "-A", "-f", "."], { cwd: dir, env });
    if (a.status !== 0) return "none (" + a.stderr.trim().slice(0, 200) + ")";
    return run("git", [...cfg, "write-tree"], { cwd: dir, env }).stdout.trim();
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** Rewrites every link under dir whose target ends in "/" to the same target without it, as Claude Code 2.1.325's plugin
 *  copy writes links, and returns each changed link as "path -> target". */
export function trimLinkSlashes(dir: string): string[] {
  const out: string[] = [];
  const walk = (abs: string, r: string) => {
    for (const n of readdirSync(abs).sort()) {
      const p = join(abs, n);
      const q = r ? r + "/" + n : n;
      const st = lstatSync(p);
      if (st.isDirectory()) walk(p, q);
      else if (st.isSymbolicLink()) {
        const t = readlinkSync(p);
        if (t.length > 1 && t.endsWith("/")) {
          unlinkSync(p);
          symlinkSync(t.replace(/\/+$/, ""), p);
          out.push(q + " -> " + t.replace(/\/+$/, ""));
        }
      }
    }
  };
  walk(dir, "");
  return out;
}

/** A git checkout in a home against its pin: HEAD, HEAD's tree and no tracked file changed (git status with no optional
 *  locks, so the check writes nothing). */
export function checkoutCheck(repo: string, dir: string, pin: string, tree: string): PinCheck {
  if (!existsSync(join(dir, ".git"))) return { repo, matched: false, how: dir + " holds no git checkout" };
  const g = (...a: string[]) => run("git", ["--no-optional-locks", "-C", dir, ...a], { env: cleanEnv() }).stdout.trim();
  const head = g("rev-parse", "HEAD");
  const htree = g("rev-parse", "HEAD^{tree}");
  const changed = g("status", "--porcelain", "--untracked-files=no").split("\n").filter(Boolean);
  const ok = head === pin && htree === tree && changed.length === 0;
  return { repo, matched: ok, how: "checkout " + rel(dir) + ": HEAD " + head + (head === pin ? " is the pin" : " is not the pin " + pin) + ", its tree " + htree + (htree === tree ? " is the pin's tree" : " is not the pin's tree " + tree) + ", and git status shows " + changed.length + " tracked files changed" + (changed.length ? " (" + changed.slice(0, 5).join(", ") + ")" : "") + "; untracked files are the installer's own output" };
}

let HOME_ROOT = "";
const rel = (p: string) => (HOME_ROOT && p.startsWith(HOME_ROOT) ? "~/" + relative(HOME_ROOT, p) : p);

/** A copied tree in a home against a git tree id. */
export function treeCheck(repo: string, dir: string, tree: string, what: string): PinCheck {
  const got = existsSync(dir) ? dirGitTree(dir) : "missing";
  return { repo, matched: got === tree, how: what + " " + rel(dir) + " hashed as a git tree (attributes off) is " + got + (got === tree ? ", the pin's tree" : ", not the pin's tree " + tree) };
}

/** Every regular file under dir, relative path to sha256. */
function fileMap(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (abs: string, r: string) => {
    for (const n of readdirSync(abs)) {
      const p = join(abs, n);
      const q = r ? r + "/" + n : n;
      const st = lstatSync(p);
      if (st.isDirectory()) walk(p, q);
      else if (st.isFile()) out.set(q, sha(readFileSync(p)));
    }
  };
  walk(dir, "");
  return out;
}

/** The registry's record and tarball for an exact npm version, downloaded and extracted into a scratch dir. */
async function npmTarball(name: string, version: string): Promise<{ integrity: string; tarball: string; gitHead: string | null; got: string; dir: string; scratch: string }> {
  const v = run("npm", ["view", name + "@" + version, "dist.integrity", "dist.tarball", "gitHead", "--json"]);
  if (v.status !== 0) return h2hFail("E_H2H_PIN", "npm view " + name + "@" + version + " failed: " + v.stderr.trim().slice(-200));
  const j = JSON.parse(v.stdout) as Record<string, string>;
  const res = await fetch(j["dist.tarball"]!);
  if (!res.ok) return h2hFail("E_H2H_PIN", "downloading " + j["dist.tarball"] + " answered " + res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  const scratch = mkdtempSync(join(tmpdir(), "h2h-npm-"));
  writeFileSync(join(scratch, "p.tgz"), buf);
  run("tar", ["-xzf", join(scratch, "p.tgz"), "-C", scratch]);
  return { integrity: j["dist.integrity"]!, tarball: j["dist.tarball"]!, gitHead: j.gitHead ?? null, got: "sha512-" + sha(buf, "sha512"), dir: join(scratch, "package"), scratch };
}

/** The npx install of name@version in a home's npx cache, or null. */
function npxInstall(home: string, name: string, version: string): string | null {
  const root = join(home, ".npm", "_npx");
  if (!existsSync(root)) return null;
  for (const h of readdirSync(root).sort()) {
    const d = join(root, h, "node_modules", name);
    if (existsSync(join(d, "package.json")) && (JSON.parse(readFileSync(join(d, "package.json"), "utf8")) as { version?: string }).version === version) return d;
  }
  return null;
}

/** An npm install against the registry: the downloaded tarball's sha512 is the registry's integrity (and the pin's, when
 *  given), and the copy npx installed in the home holds exactly the tarball's files. With git, every tarball file that
 *  has a path in the git tree at the pin must hash to that blob; files the package build made are counted apart. */
export async function npmCheck(repo: string, home: string, name: string, version: string, o: { integrity?: string; git?: { clone: string; sha: string } } = {}): Promise<PinCheck> {
  const t = await npmTarball(name, version);
  try {
    const installed = npxInstall(home, name, version);
    const want = fileMap(t.dir);
    const have = installed ? fileMap(installed) : new Map<string, string>();
    const same = installed !== null && want.size === have.size && [...want].every(([p, s]) => have.get(p) === s);
    let gitPart = "";
    let gitOk = true;
    if (o.git) {
      const ls = run("git", ["-C", o.git.clone, "ls-tree", "-r", "-z", o.git.sha], { env: cleanEnv() }).stdout.split("\0").filter(Boolean);
      const blobs = new Map(ls.map((e) => [e.slice(e.indexOf("\t") + 1), e.split(" ")[2]!.split("\t")[0]!]));
      const paths = [...want.keys()].sort();
      const ids = run("git", ["hash-object", "--no-filters", "--stdin-paths"], { cwd: t.dir, input: paths.join("\n") + "\n", env: cleanEnv() }).stdout.trim().split("\n");
      const mapped = paths.filter((p) => blobs.has(p));
      const differ = mapped.filter((p) => blobs.get(p) !== ids[paths.indexOf(p)]);
      gitOk = t.gitHead === o.git.sha && differ.length === 0 && mapped.length > 0;
      gitPart = "; the registry's gitHead is " + t.gitHead + (t.gitHead === o.git.sha ? " (the pin)" : " (not the pin)") + "; of the tarball's " + paths.length + " files, " + mapped.length + " have a path in the git tree at the pin and " + differ.length + " of those differ" + (differ.length ? " (" + differ.slice(0, 5).join(", ") + ")" : "") + ", and " + (paths.length - mapped.length) + " are build output with no git path";
    }
    const intOk = t.got === t.integrity && (!o.integrity || o.integrity === t.integrity);
    return { repo, matched: intOk && same && gitOk, how: "npm " + name + "@" + version + ": the tarball downloaded from the registry hashes to " + t.got + (t.got === t.integrity ? ", the registry's dist.integrity" : ", not the registry's " + t.integrity) + (o.integrity ? (o.integrity === t.integrity ? " and the pin's" : ", not the pin's " + o.integrity) : "") + "; the copy npx installed in " + (installed ? rel(installed) : "(none found in .npm/_npx)") + (same ? " holds exactly the tarball's " + want.size + " files" : " differs from the tarball's files") + gitPart };
  } finally {
    rmSync(t.scratch, { recursive: true, force: true });
  }
}

/** The installPath Claude Code recorded for plugin@marketplace, as a host path under home. */
function pluginDir(home: string, id: string): string {
  const f = join(home, ".claude", "plugins", "installed_plugins.json");
  const j = existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as { plugins: Record<string, Array<{ installPath: string; gitCommitSha?: string; version?: string }>> }) : { plugins: {} };
  const p = j.plugins[id]?.[0];
  if (!p) return join(home, "missing-plugin-" + id);
  return join(home, relative(ARM_HOME, p.installPath));
}

/** The pin checks for one installed home. sources: the local clones directory install.ts used. */
export async function pinChecks(home: H2hArm, dir: string, rec: InstallRecord, o: { sources: string; prereg: H2hPrereg }): Promise<PinCheck[]> {
  HOME_ROOT = dir;
  const p = o.prereg;
  const src = (name: string) => rec.sources.find((s) => s.name === name) ?? h2hFail("E_H2H_PIN", "the " + home + " install record has no source " + name);
  const treeOf = (repo: string, s: string, path?: string) => run("git", ["-C", sourceClone(o.sources, repo, s), "rev-parse", path ? s + ":" + path : s + "^{tree}"], { env: cleanEnv() }).stdout.trim();
  const gstack = () => checkoutCheck(p.pins.gstack!.repo, join(dir, ".claude/skills/gstack"), p.pins.gstack!.sha, src("gstack").git_tree);
  const localTree = (name: string, mkt: string, plugin: string) => {
    const s = src(name);
    return [treeCheck(s.repo, join(dir, LOCAL_MARKETPLACES, name), s.git_tree, "marketplace tree"), treeCheck(s.repo, pluginDir(dir, plugin + "@" + mkt), s.git_tree, "installed plugin")];
  };
  switch (home) {
    case "none":
      return [];
    case "gstack":
      return [gstack()];
    case "superpowers": {
      const sp = p.pins.superpowers!;
      const m = BUILD_PINS.official_marketplace;
      const mdir = join(dir, ".claude/plugins/marketplaces/claude-plugins-official");
      return [checkoutCheck(m.repo, mdir, m.sha, treeOf(m.repo, m.sha)), treeCheck(sp.repo, pluginDir(dir, "superpowers@claude-plugins-official"), treeOf(sp.repo, sp.sha), "installed plugin")];
    }
    case "agent-skills": {
      const s = src("agent-skills");
      const scratch = mkdtempSync(join(tmpdir(), "h2h-as-"));
      let want = "";
      let copied = "";
      let links: string[] = [];
      try {
        stackTree({ repo: s.repo, sha: s.sha } as StackRef, [sourceClone(o.sources, s.repo, s.sha)], join(scratch, "t"));
        const f = join(scratch, "t", ".claude-plugin", "marketplace.json");
        writeFileSync(f, rewriteMarketplace(readFileSync(f, "utf8"), "agent-skills"));
        want = dirGitTree(join(scratch, "t"));
        links = trimLinkSlashes(join(scratch, "t"));
        copied = dirGitTree(join(scratch, "t"));
      } finally {
        rmSync(scratch, { recursive: true, force: true });
      }
      const note = " (the pin's tree " + s.git_tree + " with only .claude-plugin/marketplace.json's agent-skills source rewritten to \"./\", sha256 " + s.rewrite?.before_sha256 + " to " + s.rewrite?.after_sha256 + ")";
      const copy = "; Claude Code's plugin copy writes link targets without a trailing slash (" + (links.join(", ") || "none here") + "), so the expected tree applies that";
      const [a, b] = [treeCheck(s.repo, join(dir, LOCAL_MARKETPLACES, "agent-skills"), want, "marketplace tree"), treeCheck(s.repo, pluginDir(dir, "agent-skills@addy-agent-skills"), copied, "installed plugin")];
      const d = BUILD_PINS.chrome_devtools_mcp;
      return [{ ...a!, how: a!.how + note }, { ...b!, how: b!.how + note + copy }, await npmCheck("npm:" + d.npm, dir, d.npm, d.version, { integrity: d.integrity })];
    }
    case "gsd": {
      const g = p.pins.gsd!;
      const [name, version] = [g.npm!.slice(0, g.npm!.lastIndexOf("@")), g.npm!.slice(g.npm!.lastIndexOf("@") + 1)];
      return [await npmCheck(g.repo, dir, name, version, { git: { clone: sourceClone(o.sources, g.repo, g.sha), sha: g.sha } })];
    }
    case "pstack": {
      const c = p.pins.pstack!;
      const s = src("cursor-plugins");
      const sub = treeOf(c.repo, c.sha, c.path);
      return [treeCheck(c.repo, join(dir, LOCAL_MARKETPLACES, "cursor-plugins"), s.git_tree, "marketplace tree"), { ...treeCheck(c.repo, pluginDir(dir, "pstack@cursor-plugins"), c.tree!, "installed plugin " + c.path), matched: dirGitTree(pluginDir(dir, "pstack@cursor-plugins")) === c.tree && sub === c.tree }];
    }
    case "tstack": {
      const t = p.pins.tstack!;
      return [treeCheck(t.repo, join(dir, ".claude/skills"), treeOf(t.repo, t.sha, "skills"), "skills directory")];
    }
    case "gstack-pony":
      return [gstack(), ...localTree("ponystack", "ponystack", "ponystack")];
    default:
      return h2hFail("E_H2H_PIN", "no pin checks for home " + home);
  }
}

/** Today's default-branch head and latest release of a public GitHub repository: the head through git ls-remote, the
 *  latest release through the github.com redirect of /releases/latest and its tag's commit through git ls-remote. No API
 *  call: the REST API answers this machine's unauthenticated reads with a rate limit (PART-A.md). */
const seenCache = new Map<string, Seen[]>();
export async function newerSeen(repo: string): Promise<Seen[]> {
  if (seenCache.has(repo)) return seenCache.get(repo)!;
  const url = "https://github.com/" + repo + ".git";
  const ls = (...refs: string[]) => {
    const r = run("git", ["ls-remote", "--symref", url, ...refs], { env: cleanEnv() });
    if (r.status !== 0) h2hFail("E_H2H_PIN", "git ls-remote " + url + " failed: " + r.stderr.trim().slice(-200));
    return r.stdout.split("\n").filter(Boolean);
  };
  const head = ls("HEAD");
  const branch = (head.find((l) => l.startsWith("ref: ")) ?? "").replace(/^ref: refs\/heads\/(\S+)\s+HEAD$/, "$1");
  const sha = (head.find((l) => /^[0-9a-f]{40}\s+HEAD$/.test(l)) ?? "").slice(0, 40);
  if (!branch || !sha) h2hFail("E_H2H_PIN", "git ls-remote " + url + " named no default branch");
  const out: Seen[] = [{ repo, sha, version: "head of " + branch }];
  const res = await fetch("https://github.com/" + repo + "/releases/latest", { redirect: "manual" });
  const tag = decodeURIComponent((res.headers.get("location") ?? "").match(/\/releases\/tag\/([^/?#]+)$/)?.[1] ?? "");
  if (tag) {
    const refs = ls("refs/tags/" + tag, "refs/tags/" + tag + "^{}");
    const line = refs.find((l) => l.endsWith("^{}")) ?? refs[0] ?? "";
    out.push({ repo, sha: line.slice(0, 40), version: "latest release " + tag });
  }
  seenCache.set(repo, out);
  return out;
}

/** Today's latest version of an npm package. */
export function npmLatest(name: string): Seen {
  const v = run("npm", ["view", name, "version", "gitHead", "--json"]);
  const raw = v.status === 0 ? (JSON.parse(v.stdout) as string | { version?: string; gitHead?: string }) : {};
  const j = typeof raw === "string" ? { version: raw, gitHead: undefined } : raw;
  return { repo: "npm:" + name, sha: j.gitHead ?? "", version: "latest " + (j.version ?? "unreadable") };
}

/** The pins prereg.json (and this build, on the freeze date) fixes for an arm's home. */
export function armPins(arm: H2hArm, p: H2hPrereg): ArmInstall["pins"] {
  const pin = (k: string) => ({ repo: p.pins[k]!.repo, sha: p.pins[k]!.sha, ...(p.pins[k]!.version ? { version: p.pins[k]!.version } : {}) });
  const d = BUILD_PINS.chrome_devtools_mcp;
  const m = BUILD_PINS.official_marketplace;
  const byHome: Record<string, ArmInstall["pins"]> = {
    none: [], gstack: [pin("gstack")], superpowers: [pin("superpowers"), { repo: m.repo, sha: m.sha }], "agent-skills": [pin("agent-skills"), { repo: "npm:" + d.npm, sha: d.integrity, version: d.version }],
    gsd: [pin("gsd")], pstack: [pin("pstack")], tstack: [pin("tstack")], "gstack-pony": [pin("gstack"), pin("ponystack")],
  };
  return byHome[homeArm(arm)] ?? [];
}

/** newer_seen for an arm: every pinned GitHub source's head and latest release, and npm's latest for an npm pin. */
export async function armSeen(arm: H2hArm, p: H2hPrereg): Promise<Seen[]> {
  const out: Seen[] = [];
  for (const pin of armPins(arm, p)) {
    if (pin.repo.startsWith("npm:")) out.push(npmLatest(pin.repo.slice(4)));
    else out.push(...(await newerSeen(pin.repo)));
  }
  if (homeArm(arm) === "gsd") out.push(npmLatest(p.pins.gsd!.npm!.slice(0, p.pins.gsd!.npm!.lastIndexOf("@"))));
  return out;
}

export interface ArmsPins {
  schema: "h2h-arms-pins.v1";
  freeze_date: string;
  install_image: typeof INSTALL_IMAGE & { tag: string; id: string; dockerfile_sha256: string };
  claude_code_latest: Seen;
  build_pins: typeof BUILD_PINS;
  hash_rule: typeof HASH_RULE;
  arms: ArmInstall[];
}

/** Builds arms-pins.json from the homes under homes (one directory per home arm, each with its install record). */
export async function buildArmsPins(at: string, o: { sources: string; prereg?: H2hPrereg }): Promise<ArmsPins> {
  const p = o.prereg ?? readPrereg();
  const homes = resolve(at);
  const byHome = new Map<H2hArm, { rec: InstallRecord; tree: string; checks: PinCheck[] }>();
  const arms: ArmInstall[] = [];
  for (const arm of ALL_ARMS) {
    const h = homeArm(arm);
    if (!byHome.has(h)) {
      const dir = homeDir(homes, h);
      const rec = readRecord(dir);
      if (rec.exit !== 0) h2hFail("E_H2H_INSTALL", "the " + h + " install failed (exit " + rec.exit + "); arms-pins.json takes only finished installs");
      const tree = homeTreeSha256(dir);
      byHome.set(h, { rec, tree, checks: await pinChecks(h, dir, rec, { sources: o.sources, prereg: p }) });
    }
    const b = byHome.get(h)!;
    arms.push({ arm, home_of: h === arm ? null : h, pins: armPins(arm, p), roots: b.rec.roots, home_tree_sha256: b.tree, pin_checks: b.checks, newer_seen: await armSeen(arm, p), claude_code_version: b.rec.claude_code_version, browser: BROWSER_PATHS[arm], deviations: DEVIATIONS[arm] });
  }
  const image = byHome.get("none")!.rec.image;
  return { schema: "h2h-arms-pins.v1", freeze_date: BUILD_PINS.freeze_date, install_image: { ...INSTALL_IMAGE, ...image }, claude_code_latest: npmLatest(BUILD_PINS.claude_code.npm), build_pins: BUILD_PINS, hash_rule: HASH_RULE, arms };
}

/** Reads arms-pins.json and returns one arm's record (E_H2H_PIN when missing). */
export function readArmInstall(arm: H2hArm, path = ARMS_PINS_PATH): ArmInstall {
  if (!existsSync(path)) return h2hFail("E_H2H_PIN", path + " does not exist; run gstack-evals h2h pins first");
  const j = JSON.parse(readFileSync(path, "utf8")) as ArmsPins;
  return j.arms.find((a) => a.arm === arm) ?? h2hFail("E_H2H_PIN", path + " has no record for arm " + arm);
}
