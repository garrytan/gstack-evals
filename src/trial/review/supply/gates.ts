// Gates 1 and 4 for both pools (plan 2026-11-24-geva-590-review-models-prereg, section 2). Gate 1: the fix commit's
// author and committer dates are both on or after 2026-07-01 (read in UTC), and no public disclosure the supply can see
// predates it. Gate 4, containment: the unit tree carries no history past its head (the fix is not an ancestor) and no
// tracked file or commit message holding a needle: the advisory id, a CVE id, the fix commit's first 12 hex characters,
// or the review-real-bugs suite's name and case ids. Instruction files (CLAUDE.md, AGENTS.md, anything under .claude/,
// .mcp.json) stay, as the Captain ruled on 2026-11-24 for pre-run change 2: they come from the unit's own pre-fix tree,
// the needle checks read their text like any file, their sha256 is recorded, and executable config is disabled. Every
// .mcp.json is removed and every .claude/settings*.json loses the keys that run commands or grant permissions; a
// settings file that is not JSON cannot be stripped, so its unit fails gate 4. The stripped files are marked
// skip-worktree, so the working tree reads clean to git while the agent's tools see the stripped text.
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { removeTree } from "../../cleanup.ts";
import { git, gitOut, supplyFail, type CommitDates } from "./git.ts";

export const CUTOFF = "2026-07-01";
const CUTOFF_MS = Date.parse(CUTOFF + "T00:00:00Z");

/** A gate's result: "ok", or why the unit fails it. A gate with no result yet is pending. */
export type Gate = "ok" | { fail: string };
export const passed = (g: Gate | undefined): boolean => g === "ok";

const onOrAfter = (iso: string): boolean => Number.isFinite(Date.parse(iso)) && Date.parse(iso) >= CUTOFF_MS;

/** Gate 1 from the fix commit's dates and each disclosure date the supply read (label to ISO date). */
export function gate1(fix: CommitDates, disclosures: Record<string, string | null>): Gate {
  if (!onOrAfter(fix.author)) return { fail: "the fix's author date " + fix.author + " is before " + CUTOFF };
  if (!onOrAfter(fix.committer)) return { fail: "the fix's committer date " + fix.committer + " is before " + CUTOFF };
  for (const [what, at] of Object.entries(disclosures)) {
    if (at !== null && !onOrAfter(at)) return { fail: what + " " + at + " is before " + CUTOFF };
  }
  return "ok";
}

export interface Needles { strings: string[]; fix: string | null }

const sha = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
export const SETTINGS = /(^|\/)\.claude\/settings[^/]*\.json$/;
export const MCP = /(^|\/)\.mcp\.json$/;
/** Settings keys that run a command, start a server or grant a permission: stripped from every .claude/settings*.json. */
export const EXEC_KEYS = ["hooks", "permissions", "statusLine", "apiKeyHelper", "awsAuthRefresh", "awsCredentialExport", "otelHeadersHelper", "mcpServers", "enableAllProjectMcpServers", "enabledMcpjsonServers"];

const instructionFile = (path: string): boolean => {
  const parts = path.split("/");
  const name = parts[parts.length - 1];
  return name === "CLAUDE.md" || name === "AGENTS.md" || name === ".mcp.json" || parts.includes(".claude");
};

/** What a unit tree carries of each instruction file type: the flags the scorer splits on later. */
export interface InstructionFlags { claude_md: boolean; root_claude_md: boolean; agents_md: boolean; claude_dir: boolean; settings: boolean; mcp_json: boolean }
export interface Stripped { path: string; action: "removed" | "keys"; keys: string[]; sha256_before: string; sha256_after: string | null }
export interface Inventory {
  /** sha256 of each instruction file as the unit's head carries it, by repo path (a symlink hashes its target text, a
   *  submodule its commit). */
  files: Record<string, string>;
  flags: InstructionFlags;
  /** Instruction files the unit's own diff changes: they come from the PR or BIC side, still before the fix. */
  changed_by_unit: string[];
  /** What stripping disables, per file. */
  strip: Stripped[];
  /** Why the unit cannot be stripped (a settings file that is not JSON), or null. */
  refuse: string | null;
}

/** The instruction files of the checked-out tree at dir, their flags, and the strip plan. base is the unit's base commit. */
export function inventory(dir: string, base: string | null): Inventory {
  const tracked = gitOut(dir, ["ls-files", "-z"], "list the unit's files").split("\0").filter(Boolean).filter(instructionFile).sort();
  const files: Record<string, string> = {};
  const strip: Stripped[] = [];
  let refuse: string | null = null;
  for (const path of tracked) {
    const file = join(dir, path);
    const st = lstatSync(file, { throwIfNoEntry: false });
    if (!st) continue;
    if (path.split("/").pop() === ".claude" && st.isSymbolicLink()) {
      files[path] = sha("symlink:" + readlinkSync(file));
      refuse ??= path + " is a symlink, so the settings it points to cannot be stripped";
      continue;
    }
    if (st.isDirectory()) {
      files[path] = sha("gitlink:" + gitOut(dir, ["rev-parse", "HEAD:" + path], "read the submodule commit at " + path).trim());
      continue;
    }
    const text = st.isSymbolicLink() ? "symlink:" + readlinkSync(file) : readFileSync(file, "utf8");
    files[path] = sha(st.isSymbolicLink() ? text : readFileSync(file));
    if (MCP.test(path)) strip.push({ path, action: "removed", keys: [], sha256_before: files[path]!, sha256_after: null });
    else if (SETTINGS.test(path)) {
      let json: unknown;
      try {
        json = st.isSymbolicLink() ? undefined : JSON.parse(text);
      } catch {}
      if (!json || typeof json !== "object" || Array.isArray(json)) {
        refuse ??= path + " is not a JSON object, so its executable settings cannot be stripped";
        continue;
      }
      const keys = EXEC_KEYS.filter((k) => Object.hasOwn(json as object, k));
      if (!keys.length) continue;
      const after = JSON.stringify(Object.fromEntries(Object.entries(json as object).filter(([k]) => !keys.includes(k))), null, 2) + "\n";
      strip.push({ path, action: "keys", keys, sha256_before: files[path]!, sha256_after: sha(after) });
    }
  }
  const changed = base ? gitOut(dir, ["diff", "--name-only", base, "HEAD"], "list the unit's changed files").split("\n").filter((p) => p && instructionFile(p)) : [];
  const paths = Object.keys(files);
  const flags = { claude_md: paths.some((p) => p.split("/").pop() === "CLAUDE.md"), root_claude_md: paths.includes("CLAUDE.md"), agents_md: paths.some((p) => p.split("/").pop() === "AGENTS.md"), claude_dir: paths.some((p) => p.split("/").slice(0, -1).includes(".claude")), settings: paths.some((p) => SETTINGS.test(p)), mcp_json: paths.some((p) => MCP.test(p)) };
  return { files, flags, changed_by_unit: changed.sort(), strip, refuse };
}

/** Applies an inventory's strip plan to the tree at dir and marks each stripped file skip-worktree. */
export function stripExecutable(dir: string, inv: Inventory): void {
  for (const s of inv.strip) {
    const file = join(dir, s.path);
    if (s.action === "removed") rmSync(file, { force: true });
    else {
      const json = JSON.parse(readFileSync(file, "utf8"));
      for (const k of s.keys) delete json[k];
      writeFileSync(file, JSON.stringify(json, null, 2) + "\n");
      if (sha(readFileSync(file)) !== s.sha256_after) supplyFail("E_RMS_GIT", s.path + " stripped to other bytes than planned");
    }
  }
  if (inv.strip.length) gitOut(dir, ["update-index", "--skip-worktree", "--", ...inv.strip.map((s) => s.path)], "mark the stripped files skip-worktree");
  if (inv.strip.some((s) => s.action === "removed" && existsSync(join(dir, s.path)))) supplyFail("E_RMS_GIT", "a .mcp.json survived stripping");
}

/** Every containment problem of a checked-out tree at dir whose HEAD is the unit's head: an empty list passes gate 4. */
export function treeProblems(dir: string, needles: Needles): string[] {
  const problems: string[] = [];
  const strings = needles.strings.filter(Boolean);
  if (needles.fix) strings.push(needles.fix.slice(0, 12));
  if (strings.length) {
    const grep = git(dir, ["grep", "-l", "-I", "-i", "-F", ...strings.flatMap((s) => ["-e", s])]);
    if (grep.status === 0) problems.push("files hold a needle: " + grep.stdout.trim().split("\n").slice(0, 5).join(", "));
    else if (grep.status !== 1) supplyFail("E_RMS_GIT", "git grep in " + dir + ": " + grep.stderr.trim());
    const log = gitOut(dir, ["log", "--format=%B", "HEAD"], "read the unit's commit messages").toLowerCase();
    const named = strings.filter((s) => log.includes(s.toLowerCase()));
    if (named.length) problems.push("commit messages name " + named.join(", "));
  }
  if (needles.fix) {
    const anc = git(dir, ["merge-base", "--is-ancestor", needles.fix, "HEAD"]);
    if (anc.status === 0) problems.push("the fix commit is in the head's history");
  }
  return problems;
}

/** Gate 4 on a source clone: checks out rev in a temporary worktree (fetching its blobs once), takes the inventory against
 *  base, and runs treeProblems there. The inventory's refusal fails the gate too. */
export function containmentAt(clone: string, rev: string, base: string, needles: Needles, wt: string): { g4: Gate; instructions: Inventory } {
  removeTree(wt);
  mkdirSync(dirname(wt), { recursive: true });
  git(clone, ["worktree", "prune"]);
  gitOut(clone, ["worktree", "add", "--quiet", "--detach", wt, rev], "check out " + rev, { timeoutMs: 3_600_000 });
  try {
    const instructions = inventory(wt, base);
    const problems = [...treeProblems(wt, needles), ...(instructions.refuse ? [instructions.refuse] : [])];
    return { g4: problems.length ? { fail: problems.join("; ") } : "ok", instructions };
  } finally {
    git(clone, ["worktree", "remove", "--force", wt]);
    removeTree(wt);
  }
}
