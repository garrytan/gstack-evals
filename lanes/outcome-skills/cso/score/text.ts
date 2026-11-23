// Copyright (c) 2026 Garry Tan. MIT License.
// Plan section 5's scored text, path normalization and redaction (prereg.json scoring.path_normalization,
// final_message_chars_cap, earlier_text_chars_cap, redaction and redaction_rule). Normalization runs first on every
// assistant text block: a leading helper snapshot root is stripped and a helper handle is replaced by its recorded path;
// a handle with no record stays as written, so the finding citing it has no location. Then the caps pick the text, and
// redaction runs last. No redaction term applies inside a cited path or a handle, and /cso matches only as a command.
import { csoFail, type CsoPrereg } from "../prereg.ts";
import type { HelperRecords, SessionRecord } from "../types.ts";

/** A snapshot path handle as the pinned helper prints it (gstack lib/cso/contracts.ts at 5afef04). */
export const HANDLE = /@cso-path\/\/[a-f0-9]{32}/g;
/** A cited path: a relative path with at least one slash, or a file name with an extension. It never starts right after a
 *  slash or a tilde, so an absolute or home path is not a citation into the audited tree. */
export const PATH_TOKEN = /(?<![\w.@+~/-])(?:[\w@+-][\w.@+-]*(?:\/[\w.@+-]+)+\/?|[\w@+-][\w.@+-]*\.[A-Za-z][A-Za-z0-9]{0,7}(?![\w/]))/g;
export const REDACTED = "[redacted]";
const STATUS_BLOCK = /^[ \t]*Status:.*\r?\n[ \t]*Ran:.*\r?\n[ \t]*Reason:.*\r?\n[ \t]*Next:.*$/gm;

export interface Normalized { text: string; snapshot_paths: number; handles_resolved: string[]; handles_unresolved: string[] }

const rootOf = (h: HelperRecords) => h.snapshot_root?.replace(/\/+$/, "") || null;

/** Strips the helper snapshot root and resolves handles in one text block. */
export function normalizeText(text: string, helper: HelperRecords): Normalized {
  const root = rootOf(helper);
  let out = text, snapshot_paths = 0;
  if (root) {
    const parts = out.split(root + "/");
    snapshot_paths = parts.length - 1;
    out = parts.join("");
  }
  const handles_resolved: string[] = [], handles_unresolved: string[] = [];
  out = out.replace(HANDLE, (h) => {
    const path = helper.handles[h];
    if (path === undefined) {
      handles_unresolved.push(h);
      return h;
    }
    handles_resolved.push(h);
    return root && path.startsWith(root + "/") ? path.slice(root.length + 1) : path;
  });
  return { text: out, snapshot_paths, handles_resolved, handles_unresolved };
}

/** One cited path after normalization: the snapshot root stripped, a handle resolved, or null for a handle with no record. */
export function normalizePath(path: string, helper: HelperRecords): string | null {
  const root = rootOf(helper);
  const h = path.match(new RegExp("^(?:\\./)?(" + HANDLE.source + ")$"));
  const p = h ? helper.handles[h[1]!] : path;
  if (p === undefined) return null;
  return root && p.startsWith(root + "/") ? p.slice(root.length + 1) : p;
}

/** The redaction terms compiled from prereg.json (E_CSO_SCORE_INPUT when the list is malformed or lacks the one
 *  status-block entry). */
export function redactionTerms(p: CsoPrereg): RegExp[] {
  const list = (p.scoring as { redaction?: unknown } | undefined)?.redaction;
  if (!Array.isArray(list) || !list.every((t) => typeof t === "string")) return csoFail("E_CSO_SCORE_INPUT", "prereg.json scoring.redaction is not a list of strings");
  const status = (list as string[]).filter((t) => t.startsWith("the helper's four-line status block"));
  if (status.length !== 1) csoFail("E_CSO_SCORE_INPUT", "prereg.json scoring.redaction has no single status-block entry");
  return (list as string[]).filter((t) => t !== status[0]).map((t) => new RegExp(t === "/cso\\b" ? "(?<![^\\s\"'\\x60(\\[*])" + t : t, "g"));
}

/** Redacts one normalized text: the status block first, then each term outside cited paths and handles. */
export function redact(text: string, p: CsoPrereg): string {
  const terms = redactionTerms(p);
  const t = text.replace(STATUS_BLOCK, REDACTED);
  const keep: [number, number][] = [];
  for (const re of [HANDLE, PATH_TOKEN]) for (const m of t.matchAll(new RegExp(re.source, "g"))) keep.push([m.index!, m.index! + m[0].length]);
  keep.sort((a, b) => a[0] - b[0]);
  const gap = (s: string) => terms.reduce((x, re) => x.replace(re, REDACTED), s);
  let out = "", at = 0;
  for (const [s, e] of keep) {
    if (e <= at) continue;
    out += gap(t.slice(at, Math.max(s, at))) + t.slice(Math.max(s, at), e);
    at = e;
  }
  return out + gap(t.slice(at));
}

export interface ScoredText {
  /** The redacted text pass A and the gold labellers read. */
  text: string;
  /** The normalized, capped text before redaction, which the code checks read. */
  plain: string;
  final: string;
  /** Earlier blocks kept, newest first, each with its index in SessionRecord.texts. */
  earlier: { index: number; text: string }[];
  final_truncated: boolean;
  earlier_truncated: boolean;
  snapshot_paths: number;
  handles_resolved: string[];
  handles_unresolved: string[];
  empty: boolean;
}

const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);

/** Section 5's scored text for one session: the final message first (its first final_message_chars_cap characters), then
 *  earlier text from newest to oldest up to earlier_text_chars_cap in all. Each block keeps its own reading order and is
 *  headed with its place in the session, so pass A can apply the order rule. */
export function scoredText(s: Pick<SessionRecord, "texts" | "helper">, p: CsoPrereg): ScoredText {
  const sc = p.scoring as { final_message_chars_cap?: number; earlier_text_chars_cap?: number };
  if (!Number.isInteger(sc.final_message_chars_cap) || !Number.isInteger(sc.earlier_text_chars_cap)) csoFail("E_CSO_SCORE_INPUT", "prereg.json scoring caps are missing");
  const norm = s.texts.map((t) => normalizeText(t, s.helper));
  const blocks = norm.map((n, i) => ({ i, t: n.text })).filter((x) => x.t.trim() !== "");
  const out: ScoredText = { text: "", plain: "", final: "", earlier: [], final_truncated: false, earlier_truncated: false, snapshot_paths: 0, handles_resolved: [], handles_unresolved: [], empty: blocks.length === 0 };
  if (out.empty) return out;
  const last = blocks[blocks.length - 1]!;
  out.final = cut(last.t, sc.final_message_chars_cap!);
  out.final_truncated = out.final.length < last.t.length;
  let room = sc.earlier_text_chars_cap!;
  for (const x of blocks.slice(0, -1).reverse()) {
    if (room <= 0) {
      out.earlier_truncated = true;
      break;
    }
    const t = cut(x.t, room);
    if (t.length < x.t.length) out.earlier_truncated = true;
    out.earlier.push({ index: x.i, text: t });
    room -= t.length;
  }
  for (const i of [last.i, ...out.earlier.map((e) => e.index)]) {
    out.snapshot_paths += norm[i]!.snapshot_paths;
    out.handles_resolved.push(...norm[i]!.handles_resolved);
    out.handles_unresolved.push(...norm[i]!.handles_unresolved);
  }
  const block = (f: (x: string) => string) => ["=== Final message ===", f(out.final), ...out.earlier.flatMap((e) => ["=== Earlier message " + (e.index + 1) + " ===", f(e.text)])].join("\n\n");
  out.plain = block((x) => x);
  out.text = block((x) => redact(x, p));
  return out;
}
