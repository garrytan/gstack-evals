// Copyright (c) 2026 Garry Tan. MIT License.
// Runs one home's install recipe (recipes.ts) the way plan section 2 says: in a throwaway container from the pinned
// install image, with network, whose only writable mount is the session HOME (a bind-mounted host directory at /root).
// Sources are prepared on the host first: each pinned repository is cloned once into a sources directory and the pin is
// checked there; a tree source is extracted with git archive and checked against the pin's git tree id
// (src/arms/install.ts stackTree) before it is mounted read-only. The container gets no key and no host variable, only
// INSTALL_ENV. After it, prereg.json's gstack CLAUDE.md section is appended on the host, and the install record (sources,
// image, Claude Code version, tree hash and roots) is written beside the home with the log. A failed step is recorded
// with its exit and the log, never patched.
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { stackTree } from "../../../../src/arms/install.ts";
import type { StackRef } from "../../../../src/types.ts";
import { h2hFail, readPrereg, type H2hPrereg } from "../prereg.ts";
import type { H2hArm } from "../types.ts";
import { homeRoots, homeTreeSha256 } from "./hash.ts";
import { ARM_HOME, homeArm, logPath, recordPath } from "./layer.ts";
import { appendClaudeMd, INSTALL_ENV, installDockerfile, installScript, INSTALL_IMAGE, recipe, rewriteMarketplace, SRC_DIR, type Recipe } from "./recipes.ts";

const sha = (b: string | Buffer) => createHash("sha256").update(b).digest("hex");
const run = (cmd: string, args: string[], o: { cwd?: string; input?: string; timeout?: number } = {}) => spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, timeout: o.timeout ?? 600_000, cwd: o.cwd, input: o.input });

/** One prepared source as the install record keeps it. */
export interface SourceRecord { name: string; repo: string; sha: string; kind: "clone" | "tree"; git_tree: string; tree_sha256?: string; rewrite?: { file: string; before_sha256: string; after_sha256: string } }
/** The install record (h2h-arm-install.v1) beside each home; pins.ts reads it. */
export interface InstallRecord {
  schema: "h2h-arm-install.v1";
  home: H2hArm;
  image: { tag: string; id: string; dockerfile_sha256: string };
  claude_code_version: string;
  env: Record<string, string>;
  sources: SourceRecord[];
  steps: string[];
  claude_md: boolean;
  started_at: string;
  ended_at: string;
  exit: number;
  failure: string | null;
  home_tree_sha256: string | null;
  roots: string[];
}

/** The install image, built once per Dockerfile (tag h2h-arm-install:<12 hex of its sha256>) and reused. */
export function ensureImage(): { tag: string; id: string; dockerfile_sha256: string } {
  const df = installDockerfile();
  const dsha = sha(df);
  const tag = "h2h-arm-install:" + dsha.slice(0, 12);
  if (run("docker", ["image", "inspect", tag]).status !== 0) {
    const b = run("docker", ["build", "-q", "-t", tag, "-"], { input: df, timeout: 3_600_000 });
    if (b.status !== 0) h2hFail("E_H2H_INSTALL", "the install image did not build: " + (b.stderr || b.stdout).trim().slice(-400));
  }
  const id = run("docker", ["image", "inspect", "-f", "{{.Id}}", tag]).stdout.trim();
  return { tag, id, dockerfile_sha256: dsha };
}

/** The Claude Code version the install image runs, checked against the pin. */
export function claudeVersion(image: string): string {
  const r = run("docker", ["run", "--rm", "--network", "none", "--entrypoint", "claude", image, "--version"]);
  const v = (r.stdout.trim().split(/\s+/)[0] ?? "").trim();
  if (v !== INSTALL_IMAGE.claude_code) h2hFail("E_H2H_INSTALL", "the install image runs Claude Code " + (v || "nothing") + ", not the pinned " + INSTALL_IMAGE.claude_code);
  return v;
}

/** The local clone of repo under sources (cloned from GitHub when missing), holding sha (fetched when missing). */
export function sourceClone(sources: string, repo: string, sha: string): string {
  const dir = join(sources, repo.replace("/", "_"));
  const has = () => run("git", ["-C", dir, "cat-file", "-e", sha + "^{commit}"]).status === 0;
  if (!existsSync(dir)) {
    mkdirSync(sources, { recursive: true });
    const c = run("git", ["clone", "--quiet", "https://github.com/" + repo + ".git", dir], { timeout: 1_800_000 });
    if (c.status !== 0) h2hFail("E_H2H_PIN", "cloning " + repo + " failed: " + c.stderr.trim().slice(-300));
  }
  if (!has()) run("git", ["-C", dir, "fetch", "--quiet", "origin", sha], { timeout: 1_800_000 });
  if (!has()) h2hFail("E_H2H_PIN", repo + " has no commit " + sha + "; the pin is frozen and never moves");
  return dir;
}

/** Prepares every source of a recipe on the host and returns the docker -v arguments and the records. */
export function prepareSources(r: Recipe, o: { sources: string; scratch: string }): { mounts: string[]; records: SourceRecord[] } {
  const mounts: string[] = [];
  const records: SourceRecord[] = [];
  for (const s of r.sources) {
    const clone = sourceClone(o.sources, s.repo, s.sha);
    if (s.kind === "clone") {
      mounts.push("-v", resolve(clone) + ":" + SRC_DIR + "/" + s.name + ":ro");
      records.push({ name: s.name, repo: s.repo, sha: s.sha, kind: s.kind, git_tree: run("git", ["-C", clone, "rev-parse", s.sha + "^{tree}"]).stdout.trim() });
      continue;
    }
    const to = join(o.scratch, s.name);
    const t = stackTree({ repo: s.repo, sha: s.sha } as StackRef, [clone], to);
    const rec: SourceRecord = { name: s.name, repo: s.repo, sha: s.sha, kind: s.kind, git_tree: t.git_tree, tree_sha256: t.tree_sha256 };
    if (s.rewrite) {
      const file = ".claude-plugin/marketplace.json";
      const before = readFileSync(join(to, file), "utf8");
      const after = rewriteMarketplace(before, s.name);
      writeFileSync(join(to, file), after);
      rec.rewrite = { file, before_sha256: sha(before), after_sha256: sha(after) };
    }
    mounts.push("-v", resolve(to) + ":" + SRC_DIR + "/" + s.name + ":ro");
    records.push(rec);
  }
  return { mounts, records };
}

/** Installs arm's home (its home arm's, for gstack-oneline and gstack-qa) into home, an empty or missing directory.
 *  Refuses (E_H2H_INSTALL) a non-empty home; a failed install keeps its record and log and refuses with the step's exit. */
export function installHome(arm: H2hArm, o: { home: string; sources: string; prereg?: H2hPrereg }): InstallRecord {
  const p = o.prereg ?? readPrereg();
  const r = recipe(arm, p);
  const home = resolve(o.home);
  if (existsSync(home) && readdirSync(home).length) h2hFail("E_H2H_INSTALL", home + " is not empty; an install writes a fresh home");
  mkdirSync(home, { recursive: true });
  const scratch = join(dirname(home), "." + r.home + "-src-" + randomBytes(4).toString("hex"));
  const started = new Date().toISOString();
  try {
    const image = ensureImage();
    const version = claudeVersion(image.tag);
    const { mounts, records } = prepareSources(r, { sources: o.sources, scratch });
    const user = (process.getuid?.() ?? 1000) + ":" + (process.getgid?.() ?? 1000);
    const name = "h2h-install-" + r.home + "-" + randomBytes(4).toString("hex");
    const env = Object.entries(INSTALL_ENV).flatMap(([k, v]) => ["-e", k + "=" + v]);
    const d = run("docker", ["run", "--rm", "--name", name, "--user", "0:0", "-v", home + ":" + ARM_HOME, ...mounts, "-w", ARM_HOME, ...env, "--entrypoint", "bash", image.tag, "-c", installScript(r), "bash", user], { timeout: 3_600_000 });
    writeFileSync(logPath(home), (d.stdout ?? "") + (d.stderr ?? "") + (d.error ? "\n" + d.error.message : ""));
    const exit = d.status ?? -1;
    const failure = exit === 0 ? null : (((d.stdout ?? "") + (d.stderr ?? "")).trim().split("\n").slice(-12).join("\n") || String(d.error?.message ?? "no output"));
    if (exit === 0 && r.claude_md) {
      const f = join(home, ".claude", "CLAUDE.md");
      writeFileSync(f, appendClaudeMd(existsSync(f) ? readFileSync(f, "utf8") : null, p.gstack_claude_md));
    }
    const rec: InstallRecord = {
      schema: "h2h-arm-install.v1", home: r.home, image, claude_code_version: version, env: INSTALL_ENV, sources: records, steps: r.steps, claude_md: r.claude_md,
      started_at: started, ended_at: new Date().toISOString(), exit, failure, home_tree_sha256: exit === 0 ? homeTreeSha256(home) : null, roots: exit === 0 ? homeRoots(home) : [],
    };
    writeFileSync(recordPath(home), JSON.stringify(rec, null, 2) + "\n");
    if (exit !== 0) h2hFail("E_H2H_INSTALL", "the " + r.home + " install exited " + exit + " (log: " + logPath(home) + "): " + (failure ?? "").split("\n").slice(-3).join(" | "));
    return rec;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** Reads a home's install record. */
export function readRecord(home: string): InstallRecord {
  const f = recordPath(resolve(home));
  if (!existsSync(f)) h2hFail("E_H2H_INSTALL", f + " does not exist; run install for this home first");
  const j = JSON.parse(readFileSync(f, "utf8")) as InstallRecord;
  if (j.schema !== "h2h-arm-install.v1") h2hFail("E_H2H_INSTALL", f + " is not an h2h-arm-install.v1 record");
  return j;
}

export { homeArm };
