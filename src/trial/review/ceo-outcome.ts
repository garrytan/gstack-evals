// The ceo-outcome lens (wiki/plans/2026-11-04-geva-285-ceo-outcome-prereg, sections 5 and 6, as the guard amendment
// 2026-11-05-geva-289-ceo-rule-guards-amendment and the ladder amendment 2026-11-05-geva-295-ceo-ladder-amendment change
// them). Plan units reviewed under the frozen ceo-outcome block instead of plan.ts's plan-findings block.
//
// - Arms: none, lens, gstack-auto (autoplan's CEO-only run) and gstack-forced (CEO v2's forced line). Each prompt is the
//   arm's line, a blank line and CEO_TEMPLATE, template.txt's bytes; a test pins both digests and the wiki files.
// - The lens carries its own gstack-auto spec (CEO_GSTACK_AUTO), so plan.ts and its parser digest stay as they are.
// - parseCeoBlock reads one block's body: one JSON object with a "top" array whose items each carry an "issue" string,
//   else malformed. A forecast that is not a whole number from 0 to 100 is null. A missing, empty or non-string fix
//   reads "". Every item is kept; the scripts score the first three. A reason never quotes the block.
// - lastCeoBlock reads the last ceo-outcome fence in the main agent's own text blocks (capped.ts's mainAgentTexts: no
//   subagent text, API error or AskUserQuestion). A malformed last block reads as no block, even after a valid one. The
//   driver's follow-up decision (needsFollowUp) reads the same filter on the same messages the transcript holds.
// - endState is section 6's end-state table with B1's readings 1 to 4 and 9 to 11: scored, no-block, gap, or
//   incomplete for a session the ledger item's cap stopped.
// - words and cut40 are the one word rule every ceo script uses: a word is a maximal run of non-whitespace characters as
//   JavaScript's \s defines it, the same rule as ceo-rule.ts's wc, and a cut is the first 40 words joined by single spaces.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Termination } from "../../types.ts";
import { mainAgentTexts } from "./capped.ts";
import { fencedBlocks } from "./findings.ts";
import { compareVersions, PLAN_ASK, PLAN_LENSES, type PlanArm } from "./plan.ts";

const sha256 = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");

/** The --plan value that runs this lens. */
export const CEO_LENS = "ceo-outcome";
export const CEO_FENCE = "ceo-outcome";

/** template.txt of the prereg, byte for byte. */
export const CEO_TEMPLATE = "The plan is plan.md at the root of this repository. The context it was written in is in context/; read what you need. Do not commit or push.\n\nEnd your reply with one fenced block whose info string is ceo-outcome. It holds one JSON object with two fields:\n- \"top\": an array of at most 3 objects, most important first: the issues most likely to decide whether this plan works out. Each object has \"issue\" (what will go wrong or matter, in at most 40 words; judges see only the first 40 words of each issue), \"evidence\" (what in plan.md or context/ shows it) and \"fix\" (what the plan should change). Use an empty array when you see no issue that could decide the outcome.\n- \"forecast\": a whole number from 0 to 100, your probability that this plan, as written, is carried out and still in place 60 days after it ships, with no reversal and no major cut in scope.\n";
export const CEO_TEMPLATE_SHA256 = sha256(CEO_TEMPLATE);

/** CEO v2's forced line (wiki/plans/2026-11-01-geva-115-planning-ceo-v2-admission-prereg/forced-line.txt, without its newline). */
export const FORCED_LINE = "/plan-ceo-review Run this skill's full procedure before you answer: complete Step 0 (Nuclear Scope Challenge + Mode Selection) and state the mode you choose, then Read sections/review-sections.md and write its Review Sections 1 to 10 in order, plus Section 11 or its skip note, before your findings.";

/** The one follow-up turn, the same for every arm. */
export const FOLLOW_UP = "End your reply with the ceo-outcome block the first message asked for.";

/** The lens's gstack-auto: autoplan's CEO-only run, released in gstack 1.93.0.0. */
export const CEO_GSTACK_AUTO = { command: "/autoplan --ceo-only", min_version: "1.93.0.0" } as const;

export type CeoArm = "none" | "lens" | "gstack-auto" | "gstack-forced";
export const CEO_ARMS: readonly CeoArm[] = ["none", "lens", "gstack-auto", "gstack-forced"];
export const isCeoArm = (v: string): v is CeoArm => (CEO_ARMS as readonly string[]).includes(v);
/** The plan arm each ceo arm runs as: its install, skill and cell. */
export const CEO_PLAN_ARM: Readonly<Record<CeoArm, PlanArm>> = { none: "none", lens: "lens", "gstack-auto": "gstack-auto", "gstack-forced": "gstack" };

/** The arm's line: the first paragraph of its prompt. */
export function ceoArmLine(arm: CeoArm): string {
  if (arm === "none") return PLAN_ASK;
  if (arm === "lens") return PLAN_LENSES.ceo.line + " " + PLAN_ASK;
  if (arm === "gstack-auto") return CEO_GSTACK_AUTO.command + " " + PLAN_ASK;
  return FORCED_LINE + " " + PLAN_ASK;
}

export const ceoPrompt = (arm: CeoArm): string => ceoArmLine(arm) + "\n\n" + CEO_TEMPLATE;

/** Why a gstack tree cannot run the lens's gstack-auto arm, or null when it can. */
export function ceoAutoProblem(version: string | null): string | null {
  if (version === null || !/^\d+(\.\d+)*$/.test(version)) return "the gstack tree has no readable VERSION, so it cannot be checked against " + CEO_GSTACK_AUTO.min_version + ", the release that ships " + JSON.stringify(CEO_GSTACK_AUTO.command) + "\n  fix: run gstack-auto from a gstack commit whose VERSION file reads " + CEO_GSTACK_AUTO.min_version + " or later";
  return compareVersions(version, CEO_GSTACK_AUTO.min_version) < 0 ? "gstack " + version + " is older than " + CEO_GSTACK_AUTO.min_version + ", the release that ships " + JSON.stringify(CEO_GSTACK_AUTO.command) + "\n  fix: run gstack-auto from a gstack commit at " + CEO_GSTACK_AUTO.min_version + " or later" : null;
}

/** The word count every ceo script uses: ceo-rule.ts's wc. */
export const words = (s: string): number => s.split(/\s+/).filter(Boolean).length;
/** The first 40 words of s joined by single spaces. */
export const cut40 = (s: string): string => s.split(/\s+/).filter(Boolean).slice(0, 40).join(" ");

export interface CeoItem {
  issue: string;
  /** As the block gave it; null when absent. */
  evidence: unknown;
  /** "" when the block gave no fix, an empty one or one that is not a string. */
  fix: string;
}

export type CeoParse =
  | { kind: "block"; top: CeoItem[]; forecast: number | null; body_sha256: string }
  | { kind: "malformed"; reason: string; body_sha256: string }
  | { kind: "missing" }
  /** The session's transcript.ndjson could not be read. */
  | { kind: "unreadable"; reason: string };

/** Parses one ceo-outcome block's body. */
export function parseCeoBlock(body: string): Extract<CeoParse, { kind: "block" | "malformed" }> {
  const body_sha256 = sha256(body);
  const malformed = (reason: string) => ({ kind: "malformed" as const, reason, body_sha256 });
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return malformed("the " + CEO_FENCE + " block is not valid JSON");
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) return malformed("the " + CEO_FENCE + " block is not one JSON object");
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.top)) return malformed("the " + CEO_FENCE + " block has no \"top\" array");
  const top: CeoItem[] = [];
  for (const [i, item] of v.top.entries()) {
    const f = item as Record<string, unknown> | null;
    if (f === null || typeof f !== "object" || Array.isArray(f) || typeof f.issue !== "string") return malformed("top item " + i + " has no \"issue\" string");
    top.push({ issue: f.issue, evidence: f.evidence ?? null, fix: typeof f.fix === "string" ? f.fix : "" });
  }
  const forecast = Number.isInteger(v.forecast) && (v.forecast as number) >= 0 && (v.forecast as number) <= 100 ? (v.forecast as number) : null;
  return { kind: "block", top, forecast, body_sha256 };
}

/** The last ceo-outcome block in the main agent's own text blocks, parsed; missing when there is none. */
export function lastCeoBlock(texts: readonly string[]): CeoParse {
  for (let t = texts.length - 1; t >= 0; t--) {
    const block = fencedBlocks(texts[t]!).filter((b) => b.info.toLowerCase() === CEO_FENCE).at(-1);
    if (block) return parseCeoBlock(block.body);
  }
  return { kind: "missing" };
}

/** A session's one parse, from its transcript.ndjson text. */
export const ceoTranscriptParse = (transcript: string): CeoParse => lastCeoBlock(mainAgentTexts(transcript));

/** The driver's follow-up decision: the transcript so far has no parsable last block. */
export const needsFollowUp = (transcript: string): boolean => ceoTranscriptParse(transcript).kind !== "block";

export type CeoEndState = "scored" | "no-block" | "gap" | "incomplete";
export const CEO_END_STATES: readonly CeoEndState[] = ["scored", "no-block", "gap", "incomplete"];

/**
 * Section 6's end-state table. The turn cap, the allowance, a timeout or a completed session: scored with a block, else
 * no-block (readings 1 and 2; a completed session has had its follow-up turn). A CLI failure, an infra failure (the
 * provider, the proxy, the container, the evaluator, a refusal other than the allowance's), rejected credentials, a send
 * with no recorded outcome or the background deadline: scored with a block, else gap. A session the ledger item's cap
 * stopped is incomplete (reading 3). An unreadable transcript is a gap (reading 4). The follow-up turn's own
 * terminations read the same way (reading 10).
 */
export function endState(termination: Termination, parse: CeoParse): CeoEndState {
  const block = parse.kind === "block";
  switch (termination.kind) {
    case "cap_stop":
      return "incomplete";
    case "completed":
    case "turn_cap":
    case "allowance_stop":
    case "timeout":
      return parse.kind === "unreadable" ? "gap" : block ? "scored" : "no-block";
    case "arm_failure":
    case "missing":
    case "infra":
    case "credentials_rejected":
    case "unknown":
      return block ? "scored" : "gap";
    default: {
      const unknown: never = termination;
      throw new Error("E_INTERNAL: termination " + JSON.stringify(unknown) + " has no end state");
    }
  }
}

/** A parse's row fields: each issue and fix cut by cut40 and counted by words before the cut; empty arrays without a block. */
export function ceoRowFields(parse: CeoParse): { issues: string[]; words: number[]; fixes: string[]; fix_words: number[] } {
  const top = parse.kind === "block" ? parse.top : [];
  return { issues: top.map((i) => cut40(i.issue)), words: top.map((i) => words(i.issue)), fixes: top.map((i) => cut40(i.fix)), fix_words: top.map((i) => words(i.fix)) };
}

/** Contract v1's severity for a ceo issue: top for the three scored, extra past them. */
export const CEO_SEVERITY_MAP = { default: { top: "CRITICAL", extra: "INFORMATIONAL" } } as const;

/** Arm contract v1 lines for one pass: one per issue in rank order, on plan.md with no line. */
export const renderCeoFindings = (top: readonly CeoItem[], pass: number): Record<string, unknown>[] => top.map((f, i) => ({ severity: i < 3 ? "top" : "extra", path: "plan.md", line: null, summary: f.issue, evidence: typeof f.evidence === "string" ? f.evidence : JSON.stringify(f.evidence), fix: f.fix, rank: i + 1, pass, id: "p" + pass + "-" + (i + 1) }));

/** sha256 of this file: part of a ceo-outcome session key's verifier, and stored with every journaled parse. */
export const CEO_PARSER_SHA256 = sha256(readFileSync(fileURLToPath(import.meta.url)));
