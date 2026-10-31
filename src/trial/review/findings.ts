// The fixed findings parser for review units (plan 2026-10-30-geva-59-stacks-round-1-plan, section 4; findings T4 and
// T10). It reads the last fenced json block of the session's final assistant turn and returns one of four outcomes:
//
// - findings: a valid array, possibly empty. An empty array is a real zero.
// - missing: the final turn has no fenced json block. Zero findings, flagged.
// - malformed: the last block does not parse, is not an array, or an item breaks the shape. Flagged, never treated as no
//   findings.
// - incomplete: the session did not complete, so there is no final turn to read. Never scored as zero.
//
// Each finding keeps its native severity label and, where the arm gave one, confirmed. renderFindings turns findings into
// arm contract v1 lines (lanes/review-noloss/README.md): severity, path, line and summary (the claim), plus pass, id and
// the kept fields evidence and confirmed, so judge-packet sees only path, line and text. A finding that says whether it
// was confirmed also gets reader confirmed or unconfirmed: a review unit has one driver and no reader of its own, and the
// contract's severity_map.by_reader can then map a stack's unconfirmed findings apart from its confirmed ones, as the
// plan's primary map does for pstack (section 4).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Termination } from "../../types.ts";

export interface ToldFinding {
  file: string | null;
  line: number | null;
  severity: string;
  claim: string;
  evidence: string;
  confirmed?: boolean;
}

export type ParseOutcome =
  | { kind: "findings"; findings: ToldFinding[] }
  | { kind: "missing" }
  | { kind: "malformed"; reason: string }
  | { kind: "incomplete"; reason: string };

/** sha256 of this file: the session key's verifier part, so a parser change invalidates cached sessions. */
export const PARSER_SHA256 = createHash("sha256").update(readFileSync(fileURLToPath(import.meta.url))).digest("hex");

const OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;

/** Every fenced block's info word and body, in order. An unclosed fence runs to the end of the text, as in CommonMark. */
export function fencedBlocks(text: string): { info: string; body: string }[] {
  const blocks: { info: string; body: string }[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = OPEN.exec(lines[i]!);
    if (!m) continue;
    const fence = m[1]!;
    if (fence[0] === "`" && m[2]!.includes("`")) continue;
    const info = m[2]!.trim().split(/\s+/)[0] ?? "";
    const body: string[] = [];
    let j = i + 1;
    for (; j < lines.length; j++) {
      const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(lines[j]!);
      if (close && close[1]![0] === fence[0] && close[1]!.length >= fence.length) break;
      body.push(lines[j]!);
    }
    blocks.push({ info, body: body.join("\n") });
    i = j;
  }
  return blocks;
}

const KEYS = ["file", "line", "severity", "claim", "evidence", "confirmed"];

function shapeProblem(item: unknown, i: number): string | null {
  const at = "item " + i;
  if (item === null || typeof item !== "object" || Array.isArray(item)) return at + " is not an object";
  const f = item as Record<string, unknown>;
  if (!("file" in f) || !(f.file === null || (typeof f.file === "string" && f.file.trim() !== ""))) return at + ": file is not a path or null";
  if ("line" in f && !(f.line === null || (Number.isSafeInteger(f.line) && (f.line as number) >= 1))) return at + ": line is not a whole number from 1, or null";
  if (typeof f.severity !== "string" || !f.severity.trim()) return at + ": severity is not a label";
  if (typeof f.claim !== "string" || !f.claim.trim()) return at + ": claim is not text";
  if (typeof f.evidence !== "string") return at + ": evidence is not text";
  if ("confirmed" in f && typeof f.confirmed !== "boolean") return at + ": confirmed is not true or false";
  return null;
}

/** Parses one final assistant turn: findings, missing or malformed. */
export function parseFinalTurn(text: string): ParseOutcome {
  const block = fencedBlocks(text).filter((b) => b.info.toLowerCase() === "json").at(-1);
  if (!block) return { kind: "missing" };
  let value: unknown;
  try {
    value = JSON.parse(block.body);
  } catch (e) {
    return { kind: "malformed", reason: "the json block does not parse: " + (e as Error).message };
  }
  if (!Array.isArray(value)) return { kind: "malformed", reason: "the json block is not an array" };
  const findings: ToldFinding[] = [];
  for (const [i, item] of value.entries()) {
    const problem = shapeProblem(item, i);
    if (problem) return { kind: "malformed", reason: problem };
    const f = item as Record<string, unknown>;
    findings.push({ file: f.file as string | null, line: (f.line ?? null) as number | null, severity: (f.severity as string).trim(), claim: (f.claim as string).trim(), evidence: f.evidence as string, ...(typeof f.confirmed === "boolean" ? { confirmed: f.confirmed } : {}) });
  }
  return { kind: "findings", findings };
}

/** Parses a session: incomplete when it did not complete or left no final turn, else its final turn. */
export function parseFindings(record: { termination: Termination; turns: readonly string[] }): ParseOutcome {
  if (record.termination.kind !== "completed") return { kind: "incomplete", reason: "the session ended " + record.termination.kind + ("code" in record.termination && record.termination.code ? " (" + record.termination.code + ")" : "") };
  const last = record.turns.at(-1);
  if (last === undefined) return { kind: "incomplete", reason: "the session completed with no assistant turn" };
  return parseFinalTurn(last);
}

/** The outcome's label for counts: empty is a findings outcome with no findings. */
export const outcomeLabel = (p: ParseOutcome): "findings" | "empty" | "missing" | "malformed" | "incomplete" => (p.kind === "findings" ? (p.findings.length ? "findings" : "empty") : p.kind);

/** A path relative to the repository: the agent's work path prefix and ./ are dropped; null when it stays absolute. */
export function repoPath(file: string | null, workPath: string): string | null {
  if (file === null) return null;
  let p = file.trim();
  const prefix = workPath.replace(/\/+$/, "") + "/";
  if (p.startsWith(prefix)) p = p.slice(prefix.length);
  while (p.startsWith("./")) p = p.slice(2);
  return p === "" || p.startsWith("/") || p.startsWith("~") ? null : p;
}

/** Arm contract v1 lines for one pass: severity (native), path, line, summary (the claim), pass, id, evidence and confirmed. */
export function renderFindings(findings: readonly ToldFinding[], pass: number, workPath: string): Record<string, unknown>[] {
  return findings.map((f, i) => {
    const path = repoPath(f.file, workPath);
    return { severity: f.severity, path, line: f.line, summary: f.claim, pass, id: "p" + pass + "-" + (i + 1), evidence: f.evidence, ...(f.confirmed !== undefined ? { confirmed: f.confirmed, reader: f.confirmed ? "confirmed" : "unconfirmed" } : {}), ...(path === null && f.file !== null ? { raw_path: f.file } : {}) };
  });
}

export const FINDING_KEYS: readonly string[] = KEYS;
