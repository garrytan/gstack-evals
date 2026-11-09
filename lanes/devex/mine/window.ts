// Copyright (c) 2026 Garry Tan. MIT License.
// The window and the funnel's free screen, step 1 (devex prereg sections 3 and 4). The window holds the issues and
// discussions created and the pull requests merged in the 60 days after the unit's release, bots left out and author
// association kept. The screen lists candidates from three sources: the screen pilot's rule (screen-rule.md, frozen
// verbatim and parsed from it here), anything in the window that cross-references the unit's pull request or its
// closing issues, and merged pull requests in the window that change a file the unit changed and also a docs, help or
// error path. A unit with no candidate drops as screen-negative. No model call.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parsePy } from "./frame.ts";
import { py, pyEscape } from "./pyre.ts";

export const SCREEN_RULE = readFileSync(join(import.meta.dir, "screen-rule.md"), "utf8");
const S = parsePy(SCREEN_RULE);
const rx = (name: string, g = false) => {
  const r = S.rx[name];
  if (!r) throw new Error("screen-rule.md holds no " + name);
  return py(r.src, { I: r.I, S: r.S }, g);
};
const list = (name: string) => {
  const v = S.set[name];
  if (!v) throw new Error("screen-rule.md holds no " + name);
  return new Set(v);
};
export const OUTSIDE = list("OUTSIDE");
export const STOP = list("STOP");
export const FLAG_STOP = list("FLAG_STOP");
export const CC_TYPES = list("CC_TYPES");
export const DOC_PATH = rx("DOC_PATH");
const FILEEXT = rx("FILEEXT");
const BT = rx("BT", true), FLAG = rx("FLAG", true), EP = rx("EP", true), SNAKE = rx("SNAKE", true), DOT = rx("DOT", true), CALL = rx("CALL", true), FENCE = rx("FENCE", true);
/** Rule 5's docs title, read case-insensitively. */
export const DOC_TITLE = py("\\b(docs?|documentation|readme|help|error messages?|errors?)\\b", { I: true });
/** Rule 1's diff paths besides DOC_PATH: cli, cmd, commands, flags, args or options. */
export const CLI_DIFF_PATH = py("(^|/)(cli|cmd|commands?|flags|args|options)([/._-]|$)", { I: true });
export const MAX_IDENTIFIERS = 6;
export const DIFF_BYTES = 300_000;

export interface WindowItem {
  kind: "issue" | "discussion" | "pr";
  number: number;
  title: string;
  body: string;
  author_association: string;
  created_at: string;
  merged_at: string | null;
  /** Changed paths, pull requests only. */
  files: string[];
}

/** Bots out: a Bot author or a login ending in [bot]. */
export const isBot = (author: { login?: string; __typename?: string } | null | undefined) => !!author && (author.__typename === "Bot" || /\[bot\]$/i.test(author.login ?? ""));

const cleanText = (t: string) => t.replace(/<!--[\s\S]*?-->/g, " ").replace(/\bhttps?:\/\/[^\s)>\]]+/gi, " ");
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

/** Rule 1's raw candidates from text: backticked spans, flags, endpoints, snake_case, dotted tokens, calls and "<repo> <subcommand>" from fenced lines. */
export function textCandidates(text: string, repoName: string): string[] {
  const t = cleanText(text);
  const out: string[] = [];
  for (const m of t.matchAll(BT)) if (words(m[1]!) <= 4) out.push(m[1]!.trim());
  for (const r of [FLAG, EP, SNAKE]) for (const m of t.matchAll(r)) out.push(m[0]);
  for (const m of t.matchAll(DOT)) if (!FILEEXT.test(m[0])) out.push(m[0]);
  for (const m of t.matchAll(CALL)) out.push(m[1]!);
  const name = repoName.toLowerCase();
  for (const f of t.matchAll(FENCE)) {
    for (const line of f[0].split("\n")) {
      const m = /^\s*(?:\$\s+)?(\S+)\s+([a-z][a-z0-9-]*)\b/.exec(line);
      if (m && m[1]!.toLowerCase() === name) out.push(m[1] + " " + m[2]);
    }
  }
  return out;
}

/** Rule 1's diff candidates: backticked spans and flags on added lines of docs or cli-like files. */
export function diffCandidates(diff: string): string[] {
  const out: string[] = [];
  let take = false;
  for (const line of diff.slice(0, DIFF_BYTES).split("\n")) {
    if (line.startsWith("+++ ")) {
      const p = line.slice(4).replace(/^b\//, "");
      take = DOC_PATH.test(p) || CLI_DIFF_PATH.test(p);
      continue;
    }
    if (!take || !line.startsWith("+")) continue;
    for (const m of line.slice(1).matchAll(BT)) if (words(m[1]!) <= 4) out.push(m[1]!.trim());
    for (const m of line.slice(1).matchAll(FLAG)) out.push(m[0]);
  }
  return out;
}

/** Rule 2's drops; survivors keep their first spelling, duplicates dropped case-insensitively. */
export function keepCandidate(c: string): boolean {
  const l = c.toLowerCase();
  if (c.length < 4) return false;
  if (STOP.has(l) || CC_TYPES.has(l) || FLAG_STOP.has(l)) return false;
  if (/^\d+$/.test(c)) return false;
  if (/^v?\d+(\.\d+)+([-+.][0-9A-Za-z.-]*)?$/.test(c)) return false;
  if (/^(#\d+|[\w.-]+\/[\w.-]+#\d+|GH-\d+)$/i.test(c)) return false;
  if (/^[0-9a-f]{7,40}$/i.test(c)) return false;
  if (/[<>=+"',;*]/.test(c)) return false;
  if (c.includes(" ") && !/^[A-Za-z][\w.-]* [a-z][a-z0-9-]*$/.test(c)) return false;
  if (c.includes("/") && (!c.startsWith("/") || FILEEXT.test(c) || (c.match(/\//g) ?? []).length > 5)) return false;
  if (FILEEXT.test(c)) return false;
  if (/^test_/i.test(c) || /_tests?$/i.test(c) || (c.match(/_/g) ?? []).length > 4) return false;
  return true;
}

/** Rule 4's match: case-insensitive, not preceded or followed by a word character or hyphen. */
export const tokenRx = (tok: string) => py("(?<![\\w-])" + pyEscape(tok) + "(?![\\w-])", { I: true });

/** Rules 1 to 3: the kept identifiers, at most 6, by df ascending then length descending. */
export function identifiers(raw: readonly string[], items: readonly WindowItem[]): Array<{ token: string; df: number }> {
  const seen = new Set<string>();
  const cands = raw.filter((c) => {
    const k = c.toLowerCase();
    if (!keepCandidate(c) || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const limit = Math.max(3, 0.1 * items.length);
  return cands
    .map((token) => {
      const r = tokenRx(token);
      return { token, df: items.filter((i) => r.test(i.title) || r.test(i.body)).length };
    })
    .filter((x) => x.df <= limit)
    .sort((a, b) => a.df - b.df || b.token.length - a.token.length)
    .slice(0, MAX_IDENTIFIERS);
}

export interface ScreenUnit {
  repo: string;
  number: number;
  title: string;
  /** Plan text: the earliest pre-merge description and closing-issue bodies. */
  text: string;
  closing: number[];
  files: string[];
  /** The unit's diff (first 300 KB), or null when it could not be read. */
  diff: string | null;
  /** Window items GitHub's timeline names as cross-referencing the unit or its closing issues. */
  timeline_refs: Array<{ kind: "issue" | "pr"; number: number }>;
}

export interface Screen {
  identifiers: Array<{ token: string; df: number }>;
  window_items: number;
  candidates: Array<{ kind: WindowItem["kind"]; number: number; author_association: string; sources: Array<"screen" | "xref" | "file-doc"> }>;
  positive: boolean;
}

/** Whether text names the unit's pull request or a closing issue by #n, owner/repo#n or URL. */
function refers(text: string, repo: string, nums: readonly number[]): boolean {
  const r = repo.replace(/[.*+?^$|()[\]\\{}]/g, (c) => "\\" + c);
  return nums.some((n) => new RegExp("(^|[^\\w/&])#" + n + "(?!\\d)|(^|[^\\w])" + r + "#" + n + "(?!\\d)|github\\.com/" + r + "/(pull|issues)/" + n + "(?!\\d)", "i").test(text));
}

/** The free screen over a unit's window items (the unit itself excluded). */
export function screen(u: ScreenUnit, all: readonly WindowItem[]): Screen {
  const items = all.filter((i) => !(i.kind === "pr" && i.number === u.number));
  const repoName = u.repo.split("/")[1]!;
  const raw = [...textCandidates(u.title + "\n" + u.text, repoName), ...(u.diff ? diffCandidates(u.diff) : [])];
  const ids = identifiers(raw, items);
  const rxs = ids.map((x) => tokenRx(x.token));
  const named = (i: WindowItem) => rxs.some((r) => r.test(i.title) || r.test(i.body));
  const unitFiles = new Set(u.files);
  const refNums = [u.number, ...u.closing];
  const timeline = new Set(u.timeline_refs.map((t) => t.kind + "#" + t.number));
  const cands: Screen["candidates"] = [];
  for (const i of items) {
    const sources: Array<"screen" | "xref" | "file-doc"> = [];
    if (named(i)) {
      if ((i.kind === "issue" || i.kind === "discussion") && OUTSIDE.has(i.author_association)) sources.push("screen");
      if (i.kind === "pr" && (i.files.some((p) => DOC_PATH.test(p)) || DOC_TITLE.test(i.title))) sources.push("screen");
    }
    if (timeline.has((i.kind === "pr" ? "pr" : "issue") + "#" + i.number) || refers(i.title + "\n" + i.body, u.repo, refNums)) sources.push("xref");
    if (i.kind === "pr" && i.files.some((p) => unitFiles.has(p)) && i.files.some((p) => DOC_PATH.test(p))) sources.push("file-doc");
    if (sources.length) cands.push({ kind: i.kind, number: i.number, author_association: i.author_association, sources });
  }
  return { identifiers: ids, window_items: items.length, candidates: cands, positive: cands.length > 0 };
}
