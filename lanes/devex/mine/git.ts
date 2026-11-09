// Copyright (c) 2026 Garry Tan. MIT License.
// Git on untrusted clones (devex prereg section 15 rule 7): every call runs with hooks off (core.hooksPath=/dev/null),
// no global or system config (so no filter driver, credential helper or URL rewrite reaches it), no LFS smudge, no
// fsmonitor, HTTPS as the only protocol and no submodules, and the remote must pass the GitHub egress allowlist. No
// repository code runs. exportBase fetches one commit shallowly and leaves its tree without .git. unitDiff reads a
// unit's diff from a blobless partial clone kept per repository, with no external diff and no textconv.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { assertGitHub } from "../../aftermath/gh.ts";

export const SAFE_CONFIG: readonly string[] = [
  "core.hooksPath=/dev/null",
  "core.fsmonitor=false",
  "core.untrackedCache=false",
  "protocol.allow=never",
  "protocol.https.allow=always",
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
  GIT_ASKPASS: "/bin/false",
  GIT_TEMPLATE_DIR: "",
};

/** The full argument list for one hardened git call. */
export const safeArgs = (args: readonly string[]) => [...SAFE_CONFIG.flatMap((c) => ["-c", c]), ...args];

/** Runs git hardened in cwd; throws with code E_MINE_SOURCE on failure. */
export function git(cwd: string, args: readonly string[], input?: string): string {
  const env: Record<string, string> = { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: "/nonexistent", ...SAFE_ENV };
  const r = spawnSync("git", safeArgs(args), { cwd, env, encoding: "utf8", input, maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw Object.assign(new Error("git " + args[0] + " failed: " + (r.stderr || "").trim().slice(0, 300)), { code: "E_MINE_SOURCE" });
  return r.stdout;
}

/** Fetches one commit of a GitHub repository over HTTPS, depth 1, and leaves its tree at dest without .git. */
export function exportBase(repo: string, sha: string, dest: string): void {
  if (!/^[0-9a-f]{40}$/.test(sha)) throw Object.assign(new Error("exportBase needs a full commit sha"), { code: "E_USAGE" });
  if (existsSync(dest)) throw Object.assign(new Error("exportBase: " + dest + " already exists"), { code: "E_USAGE" });
  const url = assertGitHub("https://github.com/" + repo + ".git", "E_MINE_SOURCE").toString();
  const work = mkdtempSync(join(dirname(dest), ".export-"));
  try {
    git(work, ["init", "-q", "--template="]);
    git(work, ["fetch", "-q", "--depth", "1", "--no-tags", "--no-recurse-submodules", url, sha]);
    git(work, ["checkout", "-q", "--detach", "FETCH_HEAD"]);
    rmSync(join(work, ".git"), { recursive: true, force: true });
    renameSync(work, dest);
  } catch (e) {
    rmSync(work, { recursive: true, force: true });
    throw e;
  }
}

/**
 * The unit's diff, the merge commit against its first parent (base), first maxBytes, or null when git can't produce
 * it. A bare blobless partial clone of the repository is kept at clones/<owner>__<name>.git and reused across runs;
 * each unit fetches its two commits at depth 1 and git diff fetches only the changed files' blobs.
 */
export function unitDiff(repo: string, baseSha: string, mergeSha: string, clones: string, maxBytes: number): string | null {
  if (!/^[0-9a-f]{40}$/.test(baseSha) || !/^[0-9a-f]{40}$/.test(mergeSha)) throw Object.assign(new Error("unitDiff needs full commit shas"), { code: "E_USAGE" });
  const url = assertGitHub("https://github.com/" + repo + ".git", "E_MINE_SOURCE").toString();
  const dir = join(clones, repo.replace("/", "__") + ".git");
  try {
    if (!existsSync(join(dir, "HEAD"))) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      git(dir, ["init", "-q", "--bare", "--template="]);
      git(dir, ["remote", "add", "origin", url]);
    }
    git(dir, ["fetch", "-q", "--filter=blob:none", "--depth", "1", "--no-tags", "--no-recurse-submodules", "--no-write-fetch-head", "origin", mergeSha, baseSha]);
    return git(dir, ["diff", "--no-ext-diff", "--no-textconv", "--no-color", baseSha, mergeSha]).slice(0, maxBytes);
  } catch {
    return null;
  }
}
