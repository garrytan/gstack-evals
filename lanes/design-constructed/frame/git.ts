// Copyright (c) 2026 Garry Tan. MIT License.
// Source: lanes/devex/mine/git.ts at 5ee7f764232b196a1d0cec5b144a287b792f9c94 (build-devex-review-eval), adapted.
// Git on untrusted clones (prereg section 3 and start rule 10): every call runs with hooks off, no global or system
// config (so no filter driver, credential helper or URL rewrite reaches it), no LFS smudge, no fsmonitor, no
// submodules and only the protocols the caller names (HTTPS for the frame). No repository code runs. fetchAt fetches one
// commit by its oid at depth 1, never a moving ref, and checks it out detached, keeping .git for later exports.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

export const SAFE_CONFIG: readonly string[] = [
  "core.hooksPath=/dev/null",
  "core.fsmonitor=false",
  "core.untrackedCache=false",
  "protocol.allow=never",
  "filter.lfs.smudge=",
  "filter.lfs.process=",
  "filter.lfs.required=false",
  "submodule.recurse=false",
  "fetch.recurseSubmodules=false",
  "advice.detachedHead=false",
  "init.defaultBranch=main",
];

export const SAFE_ENV: Readonly<Record<string, string>> = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_ATTR_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
  GIT_LFS_SKIP_SMUDGE: "1",
  GIT_NO_REPLACE_OBJECTS: "1",
  GIT_ASKPASS: "/bin/false",
  GIT_TEMPLATE_DIR: "",
};

/** The full argument list for one hardened git call that may use only the named protocols. */
export const safeArgs = (args: readonly string[], protocols: readonly string[] = ["https"]) => [
  ...[...SAFE_CONFIG, ...protocols.map((p) => "protocol." + p + ".allow=always")].flatMap((c) => ["-c", c]),
  ...args,
];

/** Runs git hardened in cwd; throws on failure. */
export function git(cwd: string, args: readonly string[], protocols: readonly string[] = ["https"]): string {
  const env: Record<string, string> = { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: "/nonexistent", ...SAFE_ENV };
  const r = spawnSync("git", safeArgs(args, protocols), { cwd, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error("git " + args[0] + " failed: " + (r.stderr || "").trim().slice(0, 300));
  return r.stdout;
}

/** The commit dest holds checked out, or null when dest is not a clone. */
export function headOf(dest: string): string | null {
  if (!existsSync(join(dest, ".git"))) return null;
  try {
    return git(dest, ["rev-parse", "HEAD"]).trim();
  } catch {
    return null;
  }
}

/**
 * Fetches one commit by its oid, depth 1, no tags, no submodules, and checks it out detached at dest, which must not
 * exist. On any failure dest is left absent and the error is thrown.
 */
export function fetchAt(url: string, oid: string, dest: string, protocols: readonly string[] = ["https"]): void {
  if (!/^[0-9a-f]{40}$/.test(oid)) throw new Error("fetchAt needs a full commit oid");
  if (existsSync(dest)) throw new Error("fetchAt: " + dest + " already exists");
  const work = mkdtempSync(join(dirname(dest), ".clone-"));
  try {
    git(work, ["init", "-q", "--template="], protocols);
    git(work, ["fetch", "-q", "--depth", "1", "--no-tags", "--no-recurse-submodules", url, oid], protocols);
    git(work, ["checkout", "-q", "--detach", oid], protocols);
    if (git(work, ["rev-parse", "HEAD"], protocols).trim() !== oid) throw new Error("fetchAt: HEAD is not " + oid);
    renameSync(work, dest);
  } catch (e) {
    rmSync(work, { recursive: true, force: true });
    throw e;
  }
}
