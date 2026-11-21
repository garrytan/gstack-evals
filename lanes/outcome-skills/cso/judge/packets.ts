// Copyright (c) 2026 Garry Tan. MIT License.
// Plan section 7's packets. Pass A gets only the redacted scored text. Pass B gets pass A's counted findings, two
// excerpts per finding cut from the audited tree around its first two cited locations that resolve (the cited line plus
// or minus excerpt_lines), the advisory, its CWE ids and families, the pre-fix hunks (at most 400 lines; an insert-only
// hunk as its two anchor lines plus its added lines, marked) and the known open advisories' summaries and files. A
// packet over max_input_tokens is trimmed in prereg.json's order (known open advisories to their summaries and file
// lists, then each hunk beyond its first 100 lines, largest file first) and never in its findings or excerpts.
import { csoFail, type CsoPrereg } from "../prereg.ts";
import type { HelperRecords, PreFixHunk, UnitRecord } from "../types.ts";
import { resolvePath, type TreeIndex } from "../score/checks.ts";
import { normalizePath } from "../score/text.ts";
import type { Finding } from "./schema.ts";

export const HUNK_LINES_MAX = 400;
export const HUNK_TRIM_LINES = 100;
/** The plan freezes no tokenizer. Packets are sized at one token per 3 bytes of UTF-8, which overcounts English and code,
 *  so a packet under the cap by this count is under it by any common tokenizer. */
export const estimateTokens = (s: string): number => Math.ceil(Buffer.byteLength(s, "utf8") / 3);

const FINDING_RULES = [
  "A finding is one weakness at one location that the text presents as a vulnerability, weakness or security risk in this repository, whatever its severity label, informational and dependency findings included.",
  "A table row and its later evidence block are one finding, and the same issue said twice is one finding.",
  "Not findings: plans to check something, items framed as checked and safe, items the text itself rules out, general advice that names no defect, and coverage notes.",
  "Order: findings in order of first appearance in the final message, then findings that appear only in earlier messages, in the order they appeared.",
].join("\n");

/** Pass A's prompt, the gold labellers' first call too: the key-blind finding list. */
export function passAPacket(scoredText: string): string {
  return [
    "You read a security audit report and list its findings. You see no answer key.",
    FINDING_RULES,
    "For each finding give its text as the report states it (quote the report's own words, including the mechanism if the report states one), whether it first appears in the final message or only in an earlier message, and every location it cites: the path exactly as written, the line or line range when given, and the function, method or type when named.",
    'Reply with one JSON object and nothing else: {"findings":[{"text":"...","source":"final"|"earlier","citations":[{"path":"...","start":12|null,"end":20|null,"symbol":"name"|null}]}]}. A report with no finding gives {"findings":[]}.',
    "=== Report ===",
    scoredText,
  ].join("\n\n");
}

/** Two excerpts for one finding from the audited tree, around its first two cited locations that resolve. */
export function excerpts(f: Finding, helper: HelperRecords, tree: TreeIndex, half: number): string[] {
  const out: string[] = [], seen = new Set<string>();
  for (const c of f.citations) {
    if (out.length === 2) break;
    const n = normalizePath(c.path, helper);
    const path = n === null ? null : resolvePath(n, tree);
    if (path === null) continue;
    const lines = tree.files.get(path)!;
    const sym = c.symbol ? lines.findIndex((l) => l.includes(c.symbol!)) + 1 : 0;
    const centre = Math.min(Math.max(c.start ?? (sym || 1), 1), lines.length);
    const from = Math.max(1, centre - half), to = Math.min(lines.length, centre + half);
    const k = path + ":" + from;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(path + " lines " + from + "-" + to + "\n" + lines.slice(from - 1, to).map((l, i) => String(from + i).padStart(6) + "  " + l).join("\n"));
  }
  return out.length ? out : ["(no cited location of this finding resolves in the audited tree)"];
}

const hunkLines = (h: PreFixHunk): string[] => [...h.text.split("\n"), ...(h.insert_only ? (h.added ?? []).map((a) => "+ " + a) : [])];

/** The pre-fix hunks as sent, at most HUNK_LINES_MAX lines in all, each hunk optionally cut to a line limit. */
export function renderHunks(hunks: readonly PreFixHunk[], limit: (i: number) => number = () => Infinity): string {
  const parts: string[] = [];
  let room = HUNK_LINES_MAX, left = 0;
  hunks.forEach((h, i) => {
    const all = hunkLines(h);
    const keep = all.slice(0, Math.min(limit(i), Math.max(room, 0)));
    left += all.length - keep.length;
    room -= keep.length;
    if (!keep.length) return;
    const head = h.insert_only ? h.file + ": insert-only hunk; anchor lines " + h.start + "-" + h.end + " (pre-fix), then the added lines marked +" : h.file + " lines " + h.start + "-" + h.end + " (pre-fix)";
    parts.push(head + "\n" + keep.join("\n") + (keep.length < all.length ? "\n(" + (all.length - keep.length) + " more lines of this hunk left out)" : ""));
  });
  return parts.join("\n\n") + (left ? "\n\n(" + left + " hunk lines left out in all)" : "");
}

const LABEL_RULES = [
  "Label each finding numbered under Findings to label against the advisory. Use only the finding's own words: never supply a mechanism the finding leaves out.",
  "location: the finding names one of the fix's non-test source files and points into the vulnerable code: a cited line range of at most 40 lines that overlaps, or lies within 10 lines of, a pre-fix hunk in that file; or a named function, method or type whose definition contains a pre-fix hunk; or the function, endpoint or code path the advisory names as vulnerable. A range wider than 40 lines never counts.",
  "class: the finding's weakness is in the same CWE family as one of the advisory's CWE ids. When every advisory CWE is broad (CWE-20, 74, 284, 664, 668, 682, 691, 693, 707 or 710), class holds when the finding names the same missing check or broken protection the advisory describes, and the family map is not used. A CWE outside the map matches only itself and the advisory's description.",
  "same_defect: the finding describes the advisory's flaw, not another bug nearby with the same class.",
  "grounding: the finding's own words state the mechanism (what input reaches which code, and which check is missing or wrong).",
  "file_level: the finding names a fix file and the right class, wherever in the file it points.",
  "known: the GHSA id of a known open advisory the finding matches by the same location, class, same_defect and grounding rules, each labelled, or null.",
  "validity: supported (the cited code exists and does what the finding says, an outside party plausibly controls the input it names, and the impact follows), unsupported (the code isn't there or doesn't do that, the input isn't attacker-controlled in any plausible use, or the impact doesn't follow), or cant_tell.",
  "Each label is yes, no or cant_tell (validity: supported, unsupported or cant_tell), with a short quote from the finding or the code in quotes.",
].join("\n");

const LABEL_SHAPE = '{"finding":1,"location":"yes","class":"yes","same_defect":"yes","grounding":"yes","file_level":"yes","known":null,"validity":"supported","quotes":{"location":"..."}}';

export interface PacketInput { unit: UnitRecord; helper: HelperRecords; tree: TreeIndex; label: Finding[]; validityOnly?: Finding[] }
export interface Packet { text: string; tokens: number; trimmed: string[]; over_cap: boolean }

function findingBlock(fs: readonly Finding[], i: PacketInput, half: number): string {
  return fs.map((f, k) => ["Finding " + (k + 1) + ": " + f.text, "Cited: " + (f.citations.map((c) => c.path + (c.start ? ":" + c.start + (c.end && c.end !== c.start ? "-" + c.end : "") : "") + (c.symbol ? " (" + c.symbol + ")" : "")).join(", ") || "nothing"), ...excerpts(f, i.helper, i.tree, half).map((e) => "Excerpt\n" + e)].join("\n")).join("\n\n");
}

/** Pass B's packet (the production judge's labels, or a gold labeller's second call when validityOnly is set), trimmed in
 *  the frozen order when it would pass max_input_tokens. */
export function passBPacket(i: PacketInput, p: CsoPrereg, count: (s: string) => number = estimateTokens): Packet {
  const sc = p.scoring as { excerpt_lines?: number };
  const cap = (p.judge as { max_input_tokens?: number }).max_input_tokens;
  if (!Number.isInteger(sc.excerpt_lines) || !Number.isInteger(cap)) csoFail("E_CSO_PACKET", "prereg.json lacks scoring.excerpt_lines or judge.max_input_tokens");
  const u = i.unit;
  const files = [...new Set(u.hunks.map((h) => h.file))];
  const size = (f: string) => u.hunks.filter((h) => h.file === f).reduce((a, h) => a + hunkLines(h).length, 0);
  const order = u.hunks.map((h, k) => ({ h, k })).sort((a, b) => size(b.h.file) - size(a.h.file) || files.indexOf(a.h.file) - files.indexOf(b.h.file) || a.k - b.k).map((x) => x.k);
  const cut = new Set<number>();
  const build = () => [
    "You label findings from a security audit report against a published, fixed security advisory.",
    LABEL_RULES,
    i.validityOnly ? 'Reply with one JSON object and nothing else: {"own":[' + LABEL_SHAPE + ', ...],"pass_a":[{"finding":1,"validity":"supported"}, ...]}, with one own entry per finding under Findings to label and one pass_a entry per finding under Findings to rate for validity, in order.' : 'Reply with one JSON object and nothing else: {"labels":[' + LABEL_SHAPE + ", ...]}, one entry per finding, in order.",
    "=== Advisory ===\n" + u.ghsa + ": " + u.advisory.summary + "\n\n" + u.advisory.details,
    "=== CWE ===\n" + u.cwe_ids.join(", ") + (u.cwe_families.length ? " (families: " + u.cwe_families.join(", ") + ")" : " (no family in the map)"),
    "=== Fix hunks (pre-fix side of the non-test source files) ===\n" + renderHunks(u.hunks, (k) => (cut.has(k) ? HUNK_TRIM_LINES : Infinity)),
    "=== Known open advisories of this repository ===\n" + (u.known_open.map((a) => a.ghsa + ": " + a.summary + "\nFiles: " + a.files.join(", ")).join("\n\n") || "none"),
    "=== Findings to label ===\n" + (findingBlock(i.label, i, sc.excerpt_lines!) || "none"),
    ...(i.validityOnly ? ["=== Findings to rate for validity ===\n" + (findingBlock(i.validityOnly, i, sc.excerpt_lines!) || "none")] : []),
  ].join("\n\n");
  const trimmed: string[] = [];
  let text = build();
  if (count(text) > cap!) trimmed.push("known_open_to_summaries_and_files");
  for (const k of order) {
    if (count(text) <= cap!) break;
    if (hunkLines(u.hunks[k]!).length <= HUNK_TRIM_LINES) continue;
    cut.add(k);
    trimmed.push("hunk " + u.hunks[k]!.file + ":" + u.hunks[k]!.start);
    text = build();
  }
  const tokens = count(text);
  return { text, tokens, trimmed, over_cap: tokens > cap! };
}
