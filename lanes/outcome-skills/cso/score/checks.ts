// Copyright (c) 2026 Garry Tan. MIT License.
// Plan section 5's mechanical checks, which need no judge (section 6, attack 15): citations read from the scored text by
// code, phantom locations (a cited path not in the audited tree, or a line past the file's end) and section 12's stage 0
// citation gate (every citation that uses a helper snapshot root or handle resolves after normalization). A cited bare
// file name resolves when it is unique in the tree. An unresolved handle is flagged by the gate, never counted as a
// phantom; a plain wrong path is a phantom and never fails the gate.
import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { HelperRecords, SessionRecord } from "../types.ts";
import { HANDLE, normalizeText, PATH_TOKEN } from "./text.ts";

/** The audited tree: each file's lines by repository-relative path. */
export interface TreeIndex { files: ReadonlyMap<string, readonly string[]>; byBase: ReadonlyMap<string, readonly string[]> }

/** A tree index from path to file text. */
export function treeIndex(files: Record<string, string>): TreeIndex {
  const m = new Map<string, string[]>(), byBase = new Map<string, string[]>();
  for (const [p, t] of Object.entries(files)) {
    const lines = t.split("\n");
    if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
    m.set(p, lines);
    const b = p.slice(p.lastIndexOf("/") + 1);
    byBase.set(b, [...(byBase.get(b) ?? []), p]);
  }
  return { files: m, byBase };
}

/** A tree index read from a directory, leaving out .git and every symlink whose target resolves outside the directory, so an
 *  audited repository's link to a host file (/proc/self/environ, /etc/passwd) never reaches a citation or a judge excerpt. */
export function readTree(root: string): TreeIndex {
  const files: Record<string, string> = {};
  const top = realpathSync(root);
  const inside = (p: string) => (realpathSync(p) + sep).startsWith(top + sep);
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === ".git") continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() || (e.isSymbolicLink() && statSync(p, { throwIfNoEntry: false })?.isFile() && inside(p))) files[relative(root, p)] = readFileSync(p, "utf8");
    }
  };
  walk(root);
  return treeIndex(files);
}

/** A tree path for a cited path: exact, after a leading ./, or a unique basename; null when absent or ambiguous. */
export function resolvePath(path: string, tree: TreeIndex): string | null {
  const p = path.replace(/^\.\//, "").replace(/\/$/, "");
  if (tree.files.has(p)) return p;
  if (p.includes("/")) return null;
  const hits = tree.byBase.get(p) ?? [];
  return hits.length === 1 ? hits[0]! : null;
}

/** One location as cited: a path, an optional line range and an optional named function, method or type. */
export interface Citation { path: string; start: number | null; end: number | null; symbol: string | null }
export type CitationState = "resolved" | "ambiguous" | "handle_unresolved" | "phantom_path" | "phantom_line";

/** Where a normalized citation lands in the tree. */
export function citationState(c: Citation, tree: TreeIndex): { state: CitationState; path: string | null } {
  if (new RegExp("^(?:\\./)?" + HANDLE.source + "$").test(c.path)) return { state: "handle_unresolved", path: null };
  const path = resolvePath(c.path, tree);
  if (path === null) return { state: !c.path.includes("/") && (tree.byBase.get(c.path)?.length ?? 0) > 1 ? "ambiguous" : "phantom_path", path: null };
  const n = tree.files.get(path)!.length;
  if ((c.start !== null && c.start > n) || (c.end !== null && c.end > n)) return { state: "phantom_line", path };
  return { state: "resolved", path };
}

const LINES = /^(?::(\d+)(?:[-–:](\d+))?|#L(\d+)(?:-L?(\d+))?)/;

/** Citations read from a normalized text by code: every relative path token with a slash or a line suffix, and every bare
 *  file name whose extension some tree file has, with its line or line range when one follows. Unresolved handles are
 *  returned apart. */
export function textCitations(text: string, tree: TreeIndex): { citations: Citation[]; handles: string[] } {
  const exts = new Set([...tree.files.keys()].map((p) => p.slice(p.lastIndexOf("/") + 1)).filter((b) => b.includes(".")).map((b) => b.slice(b.lastIndexOf("."))));
  const citations: Citation[] = [];
  for (const m of text.matchAll(new RegExp(PATH_TOKEN.source, "g"))) {
    const tok = m[0].replace(/[.,;:)]+$/, "");
    const after = text.slice(m.index! + tok.length);
    const l = after.match(LINES);
    const ext = tok.includes(".") ? tok.slice(tok.lastIndexOf(".")) : "";
    if (!tok.includes("/") && !l && !exts.has(ext)) continue;
    const start = l ? Number(l[1] ?? l[3]) : null;
    const end = l && (l[2] ?? l[4]) ? Number(l[2] ?? l[4]) : start;
    citations.push({ path: tok, start, end, symbol: null });
  }
  return { citations, handles: [...text.matchAll(new RegExp(HANDLE.source, "g"))].map((m) => m[0]) };
}

export interface Phantoms { paths: number; lines: number; cited: number; items: { path: string; line: number | null; state: "phantom_path" | "phantom_line" }[] }

/** Phantom locations in one normalized scored text, each distinct path and line counted once. */
export function phantoms(text: string, tree: TreeIndex): Phantoms {
  const seen = new Set<string>();
  const out: Phantoms = { paths: 0, lines: 0, cited: 0, items: [] };
  for (const c of textCitations(text, tree).citations) {
    const k = c.path + ":" + (c.start ?? "") + "-" + (c.end ?? "");
    if (seen.has(k)) continue;
    seen.add(k);
    out.cited++;
    const s = citationState(c, tree).state;
    if (s === "phantom_path") out.paths++;
    if (s === "phantom_line") out.lines++;
    if (s === "phantom_path" || s === "phantom_line") out.items.push({ path: c.path, line: c.start, state: s });
  }
  return out;
}

export interface CitationGate { pass: boolean; snapshot_paths: number; handles_resolved: number; unresolved: { handle: string; reason: "no record" | "outside the tree" }[] }

/** Section 12's stage 0 citation gate for one cso session: every snapshot-rooted path is stripped, and every handle has a
 *  record that lands on a tree file. A snapshot path whose rest is not in the tree is a phantom, not a gate failure. */
export function citationGate(s: Pick<SessionRecord, "texts" | "helper">, tree: TreeIndex): CitationGate {
  const out: CitationGate = { pass: true, snapshot_paths: 0, handles_resolved: 0, unresolved: [] };
  for (const t of s.texts) {
    const n = normalizeText(t, s.helper);
    out.snapshot_paths += n.snapshot_paths;
    for (const h of n.handles_unresolved) out.unresolved.push({ handle: h, reason: "no record" });
    for (const h of n.handles_resolved) {
      const p = normalizeText(s.helper.handles[h]!, { snapshot_root: s.helper.snapshot_root, handles: {} } as HelperRecords).text;
      if (resolvePath(p, tree) === null) out.unresolved.push({ handle: h, reason: "outside the tree" });
      else out.handles_resolved++;
    }
  }
  out.pass = out.unresolved.length === 0;
  return out;
}
