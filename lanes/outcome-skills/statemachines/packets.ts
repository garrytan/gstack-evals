// Copyright (c) 2026 Garry Tan. MIT License.
// Packets for the judged parts of the post: section 3's labeller packet (the issue, the fix and the fix's tests, never an
// arm's output) and section 10's judge packet (the folder's file list and a first-stage diff cut at 1,500 lines, never the
// issue, the fix, the arm, the model or the session), the three stock diffs every 50 diffs, the answer readers (strict
// JSON, anything else fails closed) and the R78 check with its planted known-bad items. Packets are files; a separate paid step sends them. Nothing here
// calls a model. Each packet's id is a digest of what the reader sees; a key file outside the packet maps it back.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Lang } from "./langs.ts";
import { blocks } from "./secondary.ts";
import { CHAT_PRICES } from "../../../src/runner/pricing/prices.ts";
import { ITEMS } from "./items.ts";
import { smFail } from "./unit.ts";

export const LABELLERS = { astra: "openai/gpt-6-astra", opus: "anthropic/claude-opus-5-5" } as const;
/** Section 10: GPT-6 Astra judges Opus sessions; Opus 5.5 judges Sol and particle-1 sessions. */
export const JUDGES: Record<string, string> = { "claude-opus-5-5": LABELLERS.astra, "openai/gpt-6.1-sol": LABELLERS.opus, "particle-ai/particle-1": LABELLERS.opus };
export const DIFF_LINE_CAP = 1500;
export const HUNK_CAP = 8;
export const STOCK_EVERY = 50;
export const STOCK_FLAG_SHARE = 0.1;
export const KAPPA_GATE = 0.6;
export const R78_START = 60;

export const judgeFor = (model: string): string => JUDGES[model] ?? smFail("E_SM_PACKET", "no frozen judge for session model " + model + "; section 10 names " + Object.keys(JUDGES).join(", "));
const digest = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 16);

// ---- Section 3: labeller packet ----

export const LABEL_QUESTIONS = [
  "1. Is this a defect a reviewer could see in the code before the fix (the code contradicts its documentation, types, tests or plain intent, crashes on valid input, or leaves state inconsistent), rather than a new feature, option or changed spec?",
  "2. Is it state-shaped, by the definition below?",
].join("\n");
export const STATE_SHAPED = [
  "A bug is state-shaped when the wrong behaviour depends on the order or history of events rather than on one input. Classes:",
  "1. A status, mode or flag not set, reset or cleared on some path, including a per-session flag that carries over between runs.",
  "2. Validate after mutate: a rejected action changes state before it is checked, or an error path returns after side effects.",
  "3. A transition allowed from a wrong state: double submit, use after close, re-entry, re-initialization, or a status guard that omits one terminal state.",
  "4. A handler that isn't idempotent, so two events apply an effect twice.",
  "5. Stale or cached state not invalidated or refreshed after a change.",
  "6. Order and lifecycle errors: use before initialization, teardown before work ends, events out of order, races, a lifecycle value captured at the wrong time.",
  "7. Resumption: retry, reconnect, resume or restart not restoring state.",
  "8. A step that handles only one of two state changes crossed in one update.",
  "Every other bug is \"other\": single-input logic, parsing, formatting, arithmetic, operator precedence, unchecked indices, wrong API use, types, platform, paths and configuration.",
].join("\n");
export const LABEL_FORMAT = 'Reply with one JSON object and nothing else: {"defect": "yes" or "no", "state_shaped": "yes" or "no", "reason": "one or two sentences"}';

export interface LabelPacket { schema: "sm-label-packet.v1"; packet: string; questions: string; state_shaped: string; answer_format: string; issue: string; fix: string; fix_tests: string }
export interface LabelAnswer { defect: "yes" | "no"; state_shaped: "yes" | "no"; reason: string }
export type Read<T> = { ok: true; answer: T } | { ok: false; code: "E_SM_JUDGE_ANSWER"; why: string };

/** The labeller packet from a unit dir: issue.md, fix.patch as published, and test.patch plus fix-tests.patch when prep
 *  wrote one. The key names the unit; the packet does not. */
export function labelPacket(unitDir: string): { packet: LabelPacket; key: { schema: "sm-label-key.v1"; packet: string; unit: string } } {
  const read = (n: string) => readFileSync(join(unitDir, n), "utf8");
  const id = (JSON.parse(read("unit.json")) as { id?: unknown }).id;
  if (typeof id !== "string" || !id) smFail("E_SM_PACKET", unitDir + "/unit.json has no id");
  const extra = existsSync(join(unitDir, "fix-tests.patch")) ? read("fix-tests.patch") : "";
  const body = { questions: LABEL_QUESTIONS, state_shaped: STATE_SHAPED, answer_format: LABEL_FORMAT, issue: read("issue.md"), fix: read("fix.patch"), fix_tests: read("test.patch") + extra };
  const packet: LabelPacket = { schema: "sm-label-packet.v1", packet: digest(body), ...body };
  return { packet, key: { schema: "sm-label-key.v1", packet: packet.packet, unit: id as string } };
}

/** One JSON object, the whole reply bar surrounding whitespace, with exactly the given keys. */
function strictObject(text: string, keys: string[]): Record<string, unknown> | string {
  const t = text.trim();
  if (!t.startsWith("{") || !t.endsWith("}")) return "the reply is not one bare JSON object";
  let v: unknown;
  try {
    v = JSON.parse(t);
  } catch {
    return "the reply is not valid JSON";
  }
  return exact(v, keys);
}
function exact(v: unknown, keys: string[]): Record<string, unknown> | string {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return "not an object";
  const got = Object.keys(v).sort();
  return got.join() === [...keys].sort().join() ? (v as Record<string, unknown>) : "keys are " + got.join(",") + ", want " + [...keys].sort().join(",");
}
const yesNo = (v: unknown): v is "yes" | "no" => v === "yes" || v === "no";
const text = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const bad = <T>(why: string): Read<T> => ({ ok: false, code: "E_SM_JUDGE_ANSWER", why });

export function readLabelAnswer(reply: string): Read<LabelAnswer> {
  const o = strictObject(reply, ["defect", "state_shaped", "reason"]);
  if (typeof o === "string") return bad(o);
  if (!yesNo(o.defect) || !yesNo(o.state_shaped)) return bad("defect and state_shaped must be \"yes\" or \"no\"");
  if (!text(o.reason)) return bad("reason must be a non-empty string");
  return { ok: true, answer: { defect: o.defect, state_shaped: o.state_shaped, reason: o.reason } };
}

/** Section 3: eligible only when both labellers say defect; state or other when both agree, else unclear. A malformed or
 *  missing answer (null) fails closed: the unit is not eligible. */
export function combineLabels(astra: LabelAnswer | null, opus: LabelAnswer | null) {
  const malformed = ([["astra", astra], ["opus", opus]] as const).filter(([, a]) => a === null).map(([n]) => n as string);
  const eligible = !!astra && !!opus && astra.defect === "yes" && opus.defect === "yes";
  const stratum: "state" | "other" | "unclear" = astra && opus && astra.state_shaped === opus.state_shaped ? (astra.state_shaped === "yes" ? "state" : "other") : "unclear";
  return { eligible, stratum, defect: [astra?.defect ?? null, opus?.defect ?? null], state_shaped: [astra?.state_shaped ?? null, opus?.state_shaped ?? null], malformed };
}

/** Cohen's kappa for two raters over categorical pairs; null with no pairs or when chance agreement is 1. */
export function cohenKappa(pairs: ReadonlyArray<readonly [string, string]>): number | null {
  const n = pairs.length;
  if (!n) return null;
  const cats = [...new Set(pairs.flat())];
  const po = pairs.filter(([a, b]) => a === b).length / n;
  const pe = cats.reduce((s, c) => s + (pairs.filter(([a]) => a === c).length / n) * (pairs.filter(([, b]) => b === c).length / n), 0);
  return pe === 1 ? null : (po - pe) / (1 - pe);
}

/** Section 3's agreement on both questions, over units where both answers read. */
export function labelAgreement(rows: ReadonlyArray<{ astra: LabelAnswer | null; opus: LabelAnswer | null }>) {
  const both = rows.filter((r): r is { astra: LabelAnswer; opus: LabelAnswer } => !!r.astra && !!r.opus);
  return {
    n: both.length, malformed: rows.length - both.length,
    defect: cohenKappa(both.map((r) => [r.astra.defect, r.opus.defect] as const)),
    state_shaped: cohenKappa(both.map((r) => [r.astra.state_shaped, r.opus.state_shaped] as const)),
  };
}

// ---- Section 10: judge packet ----

export const JUDGE_QUESTIONS = [
  "Below is a change to a repository and the list of files in the folder it works in.",
  "Rate the change's effect on UX (the people who use the software), DX (the developers who work in this code) and AX (AI agents that work in this code), each as a whole number from -2 (much worse) to +2 (much better), with a one-sentence reason.",
  "For each hunk listed by id, say whether it changes a real defect.",
].join("\n");
export const JUDGE_FORMAT = 'Reply with one JSON object and nothing else: {"ux": {"score": -2 to 2, "reason": "..."}, "dx": {...}, "ax": {...}, "hunks": [{"id": "h1", "real_defect": "yes" or "no"}, ...]} with one entry for every listed hunk.';

export interface JudgePacket {
  schema: "sm-judge-packet.v1"; packet: string; questions: string; answer_format: string; files: string[]; diff: string; cut: boolean;
  hunks: Array<{ id: string; path: string; diff_line: number; lines: number }>;
}
export interface Rating { score: number; reason: string }
export interface JudgeAnswer { ux: Rating; dx: Rating; ax: Rating; hunks: Array<{ id: string; real_defect: "yes" | "no" }> }
export const AXES = ["ux", "dx", "ax"] as const;

/** The judge packet: the diff cut at 1,500 lines (cut flags it) and at most 8 hunks, largest first by changed lines,
 *  among the runs wholly inside the cut. The packet holds only the diff and the folder's file list. */
export function judgePacket(x: { diff: string; files: string[] }): { packet: JudgePacket; lines_total: number } {
  const L = x.diff.split("\n");
  if (L[L.length - 1] === "") L.pop();
  const cut = L.length > DIFF_LINE_CAP;
  const shown = L.slice(0, DIFF_LINE_CAP);
  const hunks = blocks(x.diff)
    .map((b, k) => ({ b, k }))
    .filter(({ b }) => b.rows[1] < DIFF_LINE_CAP)
    .sort((p, q) => q.b.added + q.b.removed - (p.b.added + p.b.removed) || p.k - q.k)
    .slice(0, HUNK_CAP)
    .map(({ b }, i) => ({ id: "h" + (i + 1), path: b.path, diff_line: b.rows[0] + 1, lines: b.added + b.removed }));
  const body = { questions: JUDGE_QUESTIONS, answer_format: JUDGE_FORMAT, files: [...x.files].sort(), diff: shown.length ? shown.join("\n") + "\n" : "", cut, hunks };
  return { packet: { schema: "sm-judge-packet.v1", packet: digest(body), ...body }, lines_total: L.length };
}

export function readJudgeAnswer(reply: string, packet: JudgePacket): Read<JudgeAnswer> {
  const o = strictObject(reply, ["ux", "dx", "ax", "hunks"]);
  if (typeof o === "string") return bad(o);
  const out: Partial<JudgeAnswer> = {};
  for (const ax of AXES) {
    const r = exact(o[ax], ["score", "reason"]);
    if (typeof r === "string") return bad(ax + ": " + r);
    if (!Number.isInteger(r.score) || (r.score as number) < -2 || (r.score as number) > 2) return bad(ax + ".score must be a whole number from -2 to 2");
    if (!text(r.reason)) return bad(ax + ".reason must be a non-empty string");
    out[ax] = { score: r.score as number, reason: r.reason };
  }
  if (!Array.isArray(o.hunks)) return bad("hunks must be a list");
  const want = packet.hunks.map((h) => h.id);
  const hs: JudgeAnswer["hunks"] = [];
  for (const h of o.hunks) {
    const e = exact(h, ["id", "real_defect"]);
    if (typeof e === "string") return bad("hunk: " + e);
    if (typeof e.id !== "string" || !want.includes(e.id) || hs.some((x) => x.id === e.id)) return bad("hunk id " + String(e.id) + " is not a listed hunk or repeats");
    if (!yesNo(e.real_defect)) return bad("real_defect must be \"yes\" or \"no\"");
    hs.push({ id: e.id, real_defect: e.real_defect });
  }
  if (hs.length !== want.length) return bad("answers " + hs.length + " of " + want.length + " hunks");
  return { ok: true, answer: { ...(out as Omit<JudgeAnswer, "hunks">), hunks: hs } };
}

// ---- Stock diffs (comments and whitespace only, a rename-only refactor, logging added everywhere) ----

export const STOCK_KINDS = ["comments_whitespace", "rename_only", "logging"] as const;
export type StockKind = (typeof STOCK_KINDS)[number];
const NOT_A_FUNCTION = String.raw`(?!(?:if|for|while|switch|catch|else|do|return|try|synchronized|using|lock|foreach|new|throw)\b)`;
const C_FN = new RegExp(String.raw`^\s*(?=\S)` + NOT_A_FUNCTION + String.raw`[\w<>\[\],.*&:~ ]*?\b\w+\s*\([^;]*\)\s*(?:const\s*)?(?:noexcept\s*)?(?:throws\s+[\w., ]+)?\{\s*$`);
const JS_FN = new RegExp(String.raw`^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\b.*\{\s*$|=>\s*\{\s*$|^\s*(?:(?:public|private|protected|static|async)\s+)*` + NOT_A_FUNCTION + String.raw`\w+\s*\([^;]*\)\s*(?::\s*[^{=]+)?\{\s*$`);
/** A line that opens a function body. */
export const FUNCTION_LINE: Record<Lang, RegExp> = {
  go: /^\s*func\b.*\{\s*$/, rust: /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?(?:const\s+)?fn\s+\w+.*\{\s*$/,
  java: C_FN, csharp: C_FN, c: C_FN, cpp: C_FN, js: JS_FN, ts: JS_FN, python: /^\s*(?:async\s+)?def\s+\w+.*:\s*$/,
};
/** A local declaration whose name the rename-only diff renames (the file's first, four characters or more). */
export const LOCAL_NAME: Record<Lang, RegExp> = {
  go: /\b([a-z][A-Za-z0-9_]{3,})\s*:=/, rust: /\blet\s+(?:mut\s+)?([a-z_][a-z0-9_]{3,})\b/,
  java: /\b(?:int|long|short|boolean|char|double|float|var|String)\s+([a-z_][A-Za-z0-9_]{3,})\s*[=;]/,
  csharp: /\b(?:int|long|short|bool|char|double|float|var|string)\s+([a-z_][A-Za-z0-9_]{3,})\s*[=;]/,
  c: /\b(?:int|long|short|bool|char|double|float|size_t)\s+\*?([a-z_][A-Za-z0-9_]{3,})\s*[=;]/,
  cpp: /\b(?:int|long|short|bool|char|double|float|auto|size_t)\s+\*?([a-z_][A-Za-z0-9_]{3,})\s*[=;]/,
  js: /\b(?:let|const|var)\s+([a-z_$][A-Za-z0-9_$]{3,})\s*[=;]/, ts: /\b(?:let|const|var)\s+([a-z_$][A-Za-z0-9_$]{3,})\s*[=:;]/,
  python: /^\s*([a-z_][a-z0-9_]{3,})\s*=(?!=)/m,
};
export const LOG_CALL: Record<Lang, string> = {
  go: 'println("enter")', rust: 'eprintln!("enter");', java: 'System.err.println("enter");', c: 'fprintf(stderr, "enter\\n");',
  cpp: 'std::cerr << "enter\\n";', csharp: 'System.Console.Error.WriteLine("enter");', js: 'console.log("enter");', ts: 'console.log("enter");', python: 'print("enter")',
};
/** The header a C or C++ log call needs, added when the file does not include it. */
export const LOG_HEADER: Partial<Record<Lang, { line: string; has: RegExp }>> = {
  c: { line: "#include <stdio.h>", has: /^\s*#\s*include\s*<stdio\.h>/m },
  cpp: { line: "#include <iostream>", has: /^\s*#\s*include\s*<iostream>/m },
};
const QUOTES: Record<Lang, string> = { go: '"`', rust: '"', java: "\"'", csharp: "\"'", c: "\"'", cpp: "\"'", js: "\"'`", ts: "\"'`", python: "\"'" };
const TS_TYPE = /^\s*(?:export\s+)?(?:declare\s+)?(?:interface\s+\w|type\s+\w[^=]*=)/;
const indentOf = (l: string) => /^\s*/.exec(l)![0];

/** A line with its one-line string literals blanked and its line comment cut, columns kept. */
function code(lang: Lang, line: string): string {
  let out = "", q = "";
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (q) {
      if (c === "\\") {
        out += "  ";
        i++;
      } else if (c === q) {
        q = "";
        out += c;
      } else out += " ";
      continue;
    }
    if (lang === "python" ? c === "#" : c === "/" && line[i + 1] === "/") break;
    if (QUOTES[lang].includes(c)) q = c;
    out += c;
  }
  return out;
}

/** The function bodies the stock diffs touch: each line that opens one (FUNCTION_LINE) and the body's last line. A line
 *  after a macro continuation, a Java or C# type with a parameter list (a record or primary constructor), a Java or C#
 *  anonymous class or object initializer passed as an argument, a TypeScript
 *  type or interface member, and a TypeScript signature whose return type is an object type open no body and are left out. */
function functionBodies(lang: Lang, lines: string[]): Array<{ at: number; end: number }> {
  const depth = [0];
  for (const l of lines) {
    const c = code(lang, l);
    depth.push(depth.at(-1)! + (c.match(/\{/g)?.length ?? 0) - (c.match(/\}/g)?.length ?? 0));
  }
  const typed = new Set<number>();
  if (lang === "ts" || lang === "js") lines.forEach((l, i) => {
    if (TS_TYPE.test(l)) for (let j = i; j < lines.length && (j === i || depth[j]! > depth[i]!); j++) typed.add(j);
  });
  const out: Array<{ at: number; end: number }> = [];
  lines.forEach((l, i) => {
    if (!FUNCTION_LINE[lang].test(l) || (i > 0 && /\\\s*$/.test(lines[i - 1]!)) || typed.has(i)) return;
    if ((lang === "java" || lang === "csharp") && /\b(?:class|record|struct|interface|enum)\b/.test(code(lang, l).split("(")[0]!)) return;
    if ((lang === "java" || lang === "csharp") && /\bnew\s+[\w.<>\[\], ]+\([^()]*\)\s*\{\s*$/.test(code(lang, l))) return;
    if (lang === "ts" && /\)\s*:\s*\{\s*$/.test(l)) return;
    let end = i;
    if (lang === "python") while (end + 1 < lines.length && (!lines[end + 1]!.trim() || indentOf(lines[end + 1]!).length > indentOf(l).length)) end++;
    else while (end + 1 < lines.length && depth[end + 1]! > depth[i]!) end++;
    out.push({ at: i, end });
  });
  return out;
}

/** The log line for one function body and the line it goes after, or null where a statement can't go first: a Go
 *  signature ending in an anonymous struct or interface type, a Rust const fn, a Java enum constant's body or a
 *  constructor that must call super or this first, and a Python body whose indent can't be read. A Python body takes its
 *  first statement's indent, and its log line goes after a docstring so the docstring stays the body's first statement. */
function logLine(lang: Lang, lines: string[], f: { at: number; end: number }, unit: string): { after: number; line: string } | null {
  const l = lines[f.at]!;
  const b = lines.findIndex((x, i) => i > f.at && i <= f.end && x.trim() && !(lang === "python" && x.trim().startsWith("#")));
  const body = b < 0 ? undefined : lines[b];
  if (lang === "go" && /\b(?:struct|interface)\s*\{\s*$/.test(l)) return null;
  if (lang === "rust" && /\bconst\s+(?:unsafe\s+)?fn\b/.test(l)) return null;
  if (lang === "java" && (/^\s*[A-Z][A-Z0-9_]*\s*\(/.test(l) || /^\s*(?:super|this)\s*\(/.test(body ?? ""))) return null;
  if (lang !== "python") return { after: f.at, line: indentOf(l) + unit + LOG_CALL[lang] };
  const ind = indentOf(body ?? "");
  if (!(ind.length > indentOf(l).length && ind.startsWith(indentOf(l)))) return null;
  const doc = /^\s*[rRuUbB]{0,2}("""|'''|"|')/.exec(body!)?.[1];
  if (!doc) return { after: f.at, line: ind + LOG_CALL.python };
  const rest = body!.trim().replace(/^[rRuUbB]{0,2}/, "").slice(doc.length);
  const after = doc.length === 1 || rest.includes(doc) ? b : lines.findIndex((x, i) => i > b && i <= f.end && x.includes(doc));
  return after < 0 ? null : { after, line: ind + LOG_CALL.python };
}

/** The C or C++ header line added before the file's first #include outside any #if (an include guard's block counts as
 *  outside), else after the include guard's #define, else at the top. */
function withHeader(lines: string[], header: string): string[] {
  let depth = 0, guard = -1;
  const at = (i: number) => [...lines.slice(0, i), header, ...lines.slice(i)];
  for (let i = 0; i < lines.length; i++) {
    const d = /^\s*#\s*(\w+)/.exec(lines[i]!)?.[1];
    if (d === "include" && (depth === 0 || (depth === 1 && guard >= 0))) return at(i);
    if (d === "if" || d === "ifdef" || d === "ifndef") {
      const next = lines.slice(i + 1).find((x) => x.trim());
      if (depth === 0 && guard < 0 && d === "ifndef" && /^\s*#\s*define\b/.test(next ?? "")) guard = lines.indexOf(next!, i + 1);
      depth++;
    } else if (d === "endif") depth--;
  }
  return at(guard >= 0 ? guard + 1 : 0);
}

/** The rename-only diff: the file's first local (LOCAL_NAME) whose every use sits in the body of the function that
 *  declares it, renamed there. A use as a member, a key, a field shorthand or a named argument, a use inside a string or
 *  comment on its line, or a Python global or nonlocal of that name skips the local, so the rename keeps the behavior. */
function renameOnly(x: { lang: Lang; path: string; text: string }, lines: string[], fns: Array<{ at: number; end: number }>): string | null {
  const word = (n: string, flags = "") => new RegExp("(?<![\\w$])" + n.replace(/\$/g, "\\$") + "(?![\\w$])", flags);
  const starts = [0];
  for (const l of lines) starts.push(starts.at(-1)! + l.length + 1);
  const lineAt = (off: number) => {
    let lo = 0, hi = lines.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid]! <= off) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  const opener = (s: string) => {
    let d = 0;
    for (let k = s.length - 1; k >= 0; k--) {
      if (")]}".includes(s[k]!)) d++;
      else if ("([{".includes(s[k]!) && d-- === 0) return s[k]!;
    }
    return null;
  };
  const suffix = x.lang === "python" || x.lang === "rust" ? "_value" : "Value";
  for (const m of x.text.matchAll(new RegExp(LOCAL_NAME[x.lang].source, LOCAL_NAME[x.lang].flags.replace("g", "") + "g"))) {
    const name = m[1]!, declAt = m.index! + m[0].indexOf(name), at = lineAt(declAt);
    const f = fns.filter((g) => g.at < at && at <= g.end).at(-1);
    if (!f || word(name + suffix).test(x.text) || (x.lang === "python" && new RegExp("\\b(?:global|nonlocal)\\b.*" + word(name).source).test(x.text))) continue;
    const bad = [...x.text.matchAll(word(name, "g"))].some((o) => {
      const i = lineAt(o.index!), col = o.index! - starts[i]!, c = code(x.lang, lines[i]!);
      const before = c.slice(0, col), after = c.slice(col + name.length);
      return i <= f.at || i > f.end || c.slice(col, col + name.length) !== name || /(?:\.|->|::)\s*$/.test(before) || (o.index !== declAt && /^\s*:(?![:=])/.test(after)) ||
        (/^\s*[,}]/.test(after) && (opener(before) === "{" || !before.trim())) || (x.lang === "python" && /[(,]\s*$/.test(before) && /^\s*=(?!=)/.test(after));
    });
    if (!bad) return unified(x.path, x.text, lines.map((l, i) => (i > f.at && i <= f.end ? l.replace(word(name, "g"), name + suffix) : l)).join("\n"));
  }
  return null;
}

function unified(path: string, before: string, after: string): string | null {
  if (before === after) return null;
  const d = mkdtempSync(join(tmpdir(), "sm-stock-"));
  try {
    writeFileSync(join(d, "a"), before);
    writeFileSync(join(d, "b"), after);
    const r = spawnSync("diff", ["-u", "--label", "a/" + path, "--label", "b/" + path, join(d, "a"), join(d, "b")], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
    if (r.status !== 1) smFail("E_SM_PACKET", "diff -u failed on the stock copy of " + path);
    return "diff --git a/" + path + " b/" + path + "\n" + r.stdout;
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
}

/** The three stock diffs from one file of the unit's own tree, by keyless transforms that keep the file valid. A kind the
 *  file cannot give (no local to rename safely, no function a log call can open, a Rust no_std file) is null. Logging
 *  adds the header a C or C++ log call needs. */
export function stockDiffs(x: { lang: Lang; path: string; text: string }): Array<{ kind: StockKind; diff: string | null }> {
  const lines = x.text.split("\n");
  const fns = functionBodies(x.lang, lines);
  const fn = new Set(fns.map((f) => f.at));
  const unit = lines.some((l) => l.startsWith("\t")) ? "\t" : "    ";
  const comment = x.lang === "python" ? "#" : "//";
  const commented = lines.flatMap((l, i) => (fn.has(i) ? ["", indentOf(l) + comment + " Reviewed.", l] : [l]));
  if (!fn.size) commented.unshift(comment + " Reviewed.");
  const logs = new Map(fns.flatMap((f) => {
    const s = logLine(x.lang, lines, f, unit);
    return s === null ? [] : [[s.after, s.line] as const];
  }));
  let logged = lines.flatMap((l, i) => (logs.has(i) ? [l, logs.get(i)!] : [l]));
  const header = LOG_HEADER[x.lang];
  if (header && !header.has.test(x.text)) logged = withHeader(logged, header.line);
  const noStd = x.lang === "rust" && /^\s*#!\[no_std\]/m.test(x.text);
  return [
    { kind: "comments_whitespace", diff: unified(x.path, x.text, commented.join("\n")) },
    { kind: "rename_only", diff: renameOnly(x, lines, fns) },
    { kind: "logging", diff: logs.size && !noStd ? unified(x.path, x.text, logged.join("\n")) : null },
  ];
}

/** Each judge's queue: its diffs in order, with the three stock diffs after every 50th. */
export function judgeQueue<T>(items: readonly T[], stockFor: (item: T) => T[]): T[] {
  return items.flatMap((it, i) => ((i + 1) % STOCK_EVERY === 0 ? [it, ...stockFor(it)] : [it]));
}

/** A judge scoring stock diffs above 0 (on any axis) on more than 10% of them has its secondaries flagged. A malformed
 *  answer (null) counts as above 0. */
export function stockFlag(answers: ReadonlyArray<JudgeAnswer | null>) {
  const malformed = answers.filter((a) => a === null).length;
  const above = answers.filter((a) => a === null || AXES.some((ax) => a[ax].score > 0)).length;
  return { n: answers.length, above, malformed, flagged: answers.length > 0 && above / answers.length > STOCK_FLAG_SHARE };
}

// ---- R78 check: planted known-bad items beside the stock items ----

export type Axis = (typeof AXES)[number];
export const PLANT_UNITS = 8;
export const PLANT_KINDS = ["negate_condition", "strip_comments", "blank_error_text"] as const;
export type PlantKind = (typeof PLANT_KINDS)[number];
const PLANT_AXIS: Record<PlantKind, Axis> = { negate_condition: "ux", strip_comments: "dx", blank_error_text: "ax" };
const C_IF = { re: /^(\s*)if \((.+)\)(\s*\{?\s*)$/, to: "$1if (!($2))$3" };
const IF_LINE: Record<Lang, { re: RegExp; to: string }> = {
  python: { re: /^(\s*)if (.+):(\s*)$/, to: "$1if not ($2):$3" },
  go: { re: /^(\s*)if ([^;{]+) \{(\s*)$/, to: "$1if !($2) {$3" },
  rust: { re: /^(\s*)if (?!let )([^{]+) \{(\s*)$/, to: "$1if !($2) {$3" },
  java: C_IF, c: C_IF, cpp: C_IF, csharp: C_IF, js: C_IF, ts: C_IF,
};
const ERROR_LINE = /\b(?:errors\.New|Errorf|panic|raise|throw|bail!|anyhow!)|\w*(?:Error|Exception)\(/;
const STRING_LITERAL = /"(?:[^"\\\n]|\\.)*"/g;
export const R78_PRICE_BOUND = { input_tokens: 20_000, output_tokens: 1_500 } as const;
const REAL_DIFFS_PER_MODEL = 240;

/** The three known-bad plants from one file of a unit's base tree, each aimed at one axis. UX: the first if condition
 *  in the file is negated. DX: every full-line comment is deleted (at least 3 are needed). AX: every string literal on a
 *  line that raises or builds an error becomes "failed". A plant the file cannot give is null. */
export function plantDiffs(x: { lang: Lang; path: string; text: string }): Array<{ kind: PlantKind; axis: Axis; diff: string | null }> {
  const lines = x.text.split("\n");
  const rule = IF_LINE[x.lang];
  const at = lines.findIndex((l) => rule.re.test(l));
  const negated = at < 0 ? null : lines.map((l, i) => (i === at ? l.replace(rule.re, rule.to) : l)).join("\n");
  const comment = x.lang === "python" ? /^\s*#(?!!)/ : /^\s*\/\//;
  const kept = lines.filter((l) => !comment.test(l));
  const blanked = lines.map((l) => (ERROR_LINE.test(l) ? l.replace(STRING_LITERAL, '"failed"') : l)).join("\n");
  const diffs: Record<PlantKind, string | null> = {
    negate_condition: negated === null ? null : unified(x.path, x.text, negated),
    strip_comments: lines.length - kept.length >= 3 ? unified(x.path, x.text, kept.join("\n")) : null,
    blank_error_text: blanked === x.text ? null : unified(x.path, x.text, blanked),
  };
  return PLANT_KINDS.map((kind) => ({ kind, axis: PLANT_AXIS[kind], diff: diffs[kind] }));
}

export interface R78Key { schema: "sm-r78-key.v1"; packet: string; unit: string; kind: "bad" | "neutral"; axis: Axis | null; made_by: PlantKind | StockKind; lines_total: number }

/** The labelled set: units in draw order, six items from each unit's base-tree file (three plants, known-bad, and its
 *  three stock diffs, known-neutral), skipping a unit that cannot give all six, until PLANT_UNITS units give 24 of each. */
export function labelledSet(units: ReadonlyArray<{ unit: string; lang: Lang; path: string; text: string; files: string[] }>) {
  const items: Array<{ packet: JudgePacket; key: R78Key }> = [];
  const skipped: string[] = [];
  let taken = 0;
  for (const u of units) {
    if (taken === PLANT_UNITS) break;
    const made = [
      ...plantDiffs(u).map((p) => ({ kind: "bad" as const, axis: p.axis as Axis | null, made_by: p.kind as PlantKind | StockKind, diff: p.diff })),
      ...stockDiffs(u).map((s) => ({ kind: "neutral" as const, axis: null, made_by: s.kind, diff: s.diff })),
    ];
    if (made.some((m) => m.diff === null)) {
      skipped.push(u.unit);
      continue;
    }
    taken++;
    for (const m of made) {
      const { packet, lines_total } = judgePacket({ diff: m.diff!, files: u.files });
      assertBlind(packet, [u.unit]);
      items.push({ packet, key: { schema: "sm-r78-key.v1", packet: packet.packet, unit: u.unit, kind: m.kind, axis: m.axis, made_by: m.made_by, lines_total } });
    }
  }
  if (taken < PLANT_UNITS) smFail("E_SM_PACKET", "the labelled set needs " + PLANT_UNITS + " units that give all six items; " + taken + " did, skipped " + skipped.join(", "));
  return { items, skipped };
}

export interface R78Row { id: string; a: JudgeAnswer | null; b: JudgeAnswer | null }
export interface R78Labelled extends R78Row { kind: "bad" | "neutral"; axis: Axis | null }
const sign = (s: number) => (s > 0 ? "+" : s < 0 ? "-" : "0");

/** Section 10's R78 check (a: GPT-6 Astra, b: Opus 5.5). On the labelled set: each judge's catch rate (targeted axis
 *  below 0) on known-bad items and false-fail rate (any axis below 0) on neutral ones; a malformed answer is a miss or a
 *  false fail. Kappa per axis on signs over the first 60 real diffs in seeded order where both answers read, printed
 *  beside every result; a judged verdict on an axis may stand only at kappa 0.6 or more. The real diffs' agreement
 *  share is one descriptive line. */
export function r78Check(x: { real: readonly R78Row[]; labelled: readonly R78Labelled[] }) {
  const set = x.real.slice(0, R78_START);
  const both = set.filter((r) => r.a && r.b);
  const axes = Object.fromEntries(AXES.map((ax) => {
    const kappa = cohenKappa(both.map((r) => [sign(r.a![ax].score), sign(r.b![ax].score)] as const));
    const may_stand = kappa !== null && kappa >= KAPPA_GATE;
    return [ax, { kappa, n: both.length, malformed: set.length - both.length, may_stand, reading: may_stand ? "passes its check" : "judge failed its check" }];
  })) as Record<Axis, { kappa: number | null; n: number; malformed: number; may_stand: boolean; reading: string }>;
  const kappa = Object.fromEntries(AXES.map((ax) => [ax, axes[ax].kappa])) as Record<Axis, number | null>;
  const bad = x.labelled.filter((r) => r.kind === "bad"), neutral = x.labelled.filter((r) => r.kind === "neutral");
  const judge = (who: "a" | "b") => {
    const caught = bad.filter((r) => r[who] !== null && r[who]![r.axis!].score < 0).length;
    const failed = neutral.filter((r) => r[who] === null || AXES.some((ax) => r[who]![ax].score < 0)).length;
    return {
      catch: { n: bad.length, caught, rate: bad.length ? caught / bad.length : null },
      false_fail: { n: neutral.length, failed, rate: neutral.length ? failed / neutral.length : null },
      stock_above: { n: neutral.length, above: neutral.filter((r) => r[who] !== null && AXES.some((ax) => r[who]![ax].score > 0)).length },
      malformed: x.labelled.filter((r) => r[who] === null).length,
      kappa,
    };
  };
  const same = both.filter((r) => AXES.every((ax) => sign(r.a![ax].score) === sign(r.b![ax].score))).length;
  return {
    real_used: set.length,
    axes,
    judges: { astra: judge("a"), opus: judge("b") },
    agreement: "descriptive only: " + same + " of " + set.length + " real diffs got the same sign from both judges on every axis; this is not a catch or false-fail rate",
  };
}

/** A judged verdict on one axis, or "judge failed its check" when that axis's kappa is under 0.6; kappa prints beside it. */
export function judgedVerdict(r: ReturnType<typeof r78Check>, axis: Axis, verdict: string): string {
  const a = r.axes[axis];
  return (a.may_stand ? verdict : "judge failed its check") + " (kappa " + (a.kappa === null ? "none" : a.kappa.toFixed(2)) + ")";
}

/** The sm-judges item's judge calls at a per-call bound of 20,000 input and 1,500 output tokens, priced from prices.ts:
 *  720 real diffs (Astra judges Opus's 240, Opus judges Sol's and particle-1's 480), three stock diffs per 50 in each
 *  queue, the second grade on the R78 check's 60 real diffs (priced at Astra's rate, the dearer judge) and both judges
 *  on every labelled item. */
export function r78Price() {
  const per = (id: string) => { const p = CHAT_PRICES[id]!; return (R78_PRICE_BOUND.input_tokens * p.input + R78_PRICE_BOUND.output_tokens * p.output) / 1e6; };
  const astra = per("openai:gpt-6-astra"), opus = per("anthropic:claude-opus-5-5");
  const calls = {
    real_astra: REAL_DIFFS_PER_MODEL, real_opus: 2 * REAL_DIFFS_PER_MODEL,
    stock_astra: Math.floor(REAL_DIFFS_PER_MODEL / STOCK_EVERY) * STOCK_KINDS.length, stock_opus: Math.floor((2 * REAL_DIFFS_PER_MODEL) / STOCK_EVERY) * STOCK_KINDS.length,
    r78_real_second: R78_START, labelled: PLANT_UNITS * (PLANT_KINDS.length + STOCK_KINDS.length) * 2,
  };
  const usd = (calls.real_astra + calls.stock_astra + calls.r78_real_second) * astra + (calls.real_opus + calls.stock_opus) * opus + (calls.labelled / 2) * (astra + opus);
  const cap_usd = ITEMS["sm-judges"]!.cap_micros / 1e6;
  return { bound: R78_PRICE_BOUND, per_call_usd: { astra, opus }, calls, usd, cap_usd, fits: usd <= cap_usd };
}

/** The judge key for a first-stage diff: what the packet leaves out. */
export function judgeKey(packet: JudgePacket, x: { unit: string; model: string; cell: string; lines_total: number; stock: StockKind | null }) {
  return { schema: "sm-judge-key.v1", packet: packet.packet, unit: x.unit, model: x.model, cell: x.cell, judge: judgeFor(x.model), lines_total: x.lines_total, stock: x.stock };
}

/** Refuses a packet whose text names one of the given strings (the session's model, cell or id). */
export function assertBlind(packet: LabelPacket | JudgePacket, names: string[]): void {
  const s = JSON.stringify(packet);
  for (const n of names) if (n && s.includes(n)) smFail("E_SM_PACKET", "packet " + packet.packet + " names " + JSON.stringify(n) + "; packets are blind to arm, model and session");
}


// ---- The paid sender's order for the labelled items ----

/** A queue seed: 16 random bytes as hex, minted once when a judge's queue file is first built. */
export function mintSeed(fill: (b: Uint8Array) => Uint8Array = (b) => crypto.getRandomValues(b)): string {
  return Buffer.from(fill(new Uint8Array(16))).toString("hex");
}

/** A Fisher-Yates shuffle driven by sha256(seed:counter), so one seed always gives one order. */
export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const out = [...items];
  let n = 0;
  const next = () => Number(BigInt("0x" + createHash("sha256").update(seed + ":" + n++).digest("hex").slice(0, 13))) / 2 ** 52;
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** One judge's queue of labelled items (plants, stock and real, by packet id) in the order the paid sender sends them. The
 *  first build mints the seed and writes it with the order to file; a rebuild from an existing file reuses its seed. The
 *  order shuffles the ids in sorted order, so it does not depend on the order they are handed in. */
export function labelledQueue(file: string, ids: readonly string[]): { schema: "sm-labelled-queue.v1"; seed: string; order: string[] } {
  const prior = existsSync(file);
  const seed = prior ? (JSON.parse(readFileSync(file, "utf8")) as { seed: string }).seed : mintSeed();
  const q = { schema: "sm-labelled-queue.v1" as const, seed, order: seededShuffle([...ids].sort(), seed) };
  if (!prior) writeFileSync(file, JSON.stringify(q, null, 1) + "\n", { flag: "wx" });
  return q;
}

