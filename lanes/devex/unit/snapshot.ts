// Copyright (c) 2026 Garry Tan. MIT License.
// The unit snapshot builder (devex prereg section 4, Unit files and Repository instructions stripped; section 15 rule
// 7). From the repository's tree at the merge's first parent, exported without .git, it refuses a tree holding a
// .claude/ folder or a .mcp.json at any depth or over 150 MB, removes every CLAUDE.md, CLAUDE.local.md, AGENTS.md and
// .claude/AGENTS.md at any depth and of any entry type (recording each path), applies the alias map to every text file,
// and makes a fresh git repository with one commit and no remote. The output directory must not exist beforehand.
//   dx snapshot --from <exported tree> --out <new dir> [--alias alias.json]
//   dx snapshot --repo <owner/name> --sha <base sha> --out <new dir> [--alias alias.json]
import { cpSync, existsSync, lstatSync, readdirSync, readFileSync, rmSync, writeFileSync, type Stats } from "node:fs";
import { dirname, join } from "node:path";
import type { AliasMap } from "../types.ts";
import { exportBase, git } from "../mine/git.ts";
import { MAX_BASE_BYTES } from "../mine/units.ts";
import { aliasText } from "./alias.ts";

export const INSTRUCTION_NAMES: readonly string[] = ["CLAUDE.md", "CLAUDE.local.md", "AGENTS.md"];

const refuse = (why: string) => Object.assign(new Error("snapshot refused: " + why), { code: "E_USAGE" });

/** Walks a tree without following symlinks, skipping a top-level .git. */
function walk(root: string, visit: (rel: string, abs: string, st: Stats) => boolean | void, rel = ""): void {
  for (const name of readdirSync(join(root, rel)).sort()) {
    if (rel === "" && name === ".git") continue;
    const r = rel ? rel + "/" + name : name;
    const abs = join(root, r);
    const st = lstatSync(abs);
    if (visit(r, abs, st) === false) continue;
    if (st.isDirectory()) walk(root, visit, r);
  }
}

/** The frame facts of a tree: bytes without .git, and any .claude folder or .mcp.json at any depth. */
export function treeCheck(root: string): { bytes: number; claude_dir: string[]; mcp_json: string[] } {
  let bytes = 0;
  const claude: string[] = [], mcp: string[] = [];
  walk(root, (rel, _abs, st) => {
    const name = rel.slice(rel.lastIndexOf("/") + 1);
    if (!st.isDirectory()) bytes += st.size;
    if (name === ".claude" && st.isDirectory()) claude.push(rel);
    if (name === ".mcp.json") mcp.push(rel);
  });
  return { bytes, claude_dir: claude, mcp_json: mcp };
}

/** Removes every instruction file at any depth and of any entry type; returns the removed paths. */
export function stripInstructions(root: string): string[] {
  const removed: string[] = [];
  walk(root, (rel, abs) => {
    const name = rel.slice(rel.lastIndexOf("/") + 1);
    const parent = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
    const isClaudeAgents = name === "AGENTS.md" && (parent === ".claude" || parent.endsWith("/.claude"));
    if (INSTRUCTION_NAMES.includes(name) || isClaudeAgents) {
      rmSync(abs, { recursive: true, force: true });
      removed.push(rel);
      return false;
    }
  });
  return removed.sort();
}

const utf8 = new TextDecoder("utf-8", { fatal: true });
/** A regular file whose bytes hold no NUL and decode as UTF-8. */
function textOf(abs: string): string | null {
  const b = readFileSync(abs);
  if (b.includes(0)) return null;
  try {
    return utf8.decode(b);
  } catch {
    return null;
  }
}

/** Applies the alias map to every text file in place; returns how many changed. */
export function aliasTree(root: string, map: AliasMap): number {
  let changed = 0;
  walk(root, (_rel, abs, st) => {
    if (!st.isFile()) return;
    const t = textOf(abs);
    if (t === null) return;
    const a = aliasText(t, map);
    if (a !== t) {
      writeFileSync(abs, a);
      changed++;
    }
  });
  return changed;
}

/** A fresh repository with one commit and no remote, its commit object written directly (fixed author, fixed date). */
export function commitOnce(root: string): string {
  git(root, ["init", "-q", "--template="]);
  git(root, ["add", "-A", "--", "."]);
  const tree = git(root, ["write-tree"]).trim();
  const body = "tree " + tree + "\nauthor unit <unit@invalid> 0 +0000\ncommitter unit <unit@invalid> 0 +0000\n\nbase\n";
  const sha = git(root, ["hash-object", "-t", "commit", "-w", "--stdin"], body).trim();
  git(root, ["update-ref", "refs/heads/main", sha]);
  git(root, ["symbolic-ref", "HEAD", "refs/heads/main"]);
  return sha;
}

export interface SnapshotResult {
  stripped: string[];
  aliased_files: number;
  bytes: number;
  commit: string;
}

/** Builds the snapshot at out (which must not exist) from an exported tree. */
export function buildSnapshot(from: string, out: string, map: AliasMap): SnapshotResult {
  if (existsSync(out)) throw refuse(out + " already exists; every snapshot uses a new directory");
  const c = treeCheck(from);
  if (c.claude_dir.length) throw refuse("a .claude/ folder at " + c.claude_dir[0]);
  if (c.mcp_json.length) throw refuse("a .mcp.json at " + c.mcp_json[0]);
  if (c.bytes > MAX_BASE_BYTES) throw refuse("the tree is " + c.bytes + " bytes, over " + MAX_BASE_BYTES);
  cpSync(from, out, { recursive: true, verbatimSymlinks: true, filter: (src) => !(dirname(src) === from && src.endsWith("/.git")) });
  const stripped = stripInstructions(out);
  const aliased = aliasTree(out, map);
  const commit = commitOnce(out);
  return { stripped, aliased_files: aliased, bytes: c.bytes, commit };
}

const flag = (argv: string[], name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

export async function run(argv: string[], io: { out: (t: string) => void; err: (t: string) => void }): Promise<number> {
  const out = flag(argv, "--out"), from = flag(argv, "--from"), repo = flag(argv, "--repo"), sha = flag(argv, "--sha"), aliasFile = flag(argv, "--alias");
  if (!out || (!from && !(repo && sha))) throw Object.assign(new Error("dx snapshot (--from <tree> | --repo <owner/name> --sha <sha>) --out <new dir> [--alias alias.json]"), { code: "E_USAGE" });
  const map: AliasMap = aliasFile ? JSON.parse(readFileSync(aliasFile, "utf8")) : { entries: [], kept: [] };
  let tree = from;
  if (!tree) {
    tree = out + ".base";
    exportBase(repo!, sha!, tree);
  }
  try {
    const r = buildSnapshot(tree, out, map);
    io.out(JSON.stringify(r));
  } finally {
    if (!from) rmSync(tree, { recursive: true, force: true });
  }
  return 0;
}
