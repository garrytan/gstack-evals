// Copyright (c) 2026 Garry Tan. MIT License.
// The Carbon judge call of the review-models eval (prereg section 4, "The judge"): the request and the reply reader only.
// One text-only call per review: the bug's evidence and the fix diff, then the review's findings as a numbered list with
// model names and arm cues removed (voice headers and severity vocabulary normalised), and one ruling per finding:
// names the bug, doesn't, or can't tell. An empty, cut-off, refused or unreadable reply is sent once more as attempt 2,
// and a second such reply rules every finding can't tell, with the failure kept for the per-arm count. The route is
// openrouter/google/gemini-4-carbon pinned to google-vertex by its src/runner/pricing/prices.ts row, at default effort
// (no reasoning field and no output cap). OpenRouter has no batch path, so every call is a single request. Nothing here
// sends anything: judgeReview takes the transport, the metering proxy in a run and a stub in tests.
import { JUDGE_ROUTE, judgeAnswer, judgeRequest } from "../../../src/adapters/judge.ts";
import { OPENROUTER_MODELS, openRouterRouting } from "../../../src/runner/pricing/prices.ts";
import { fencedBlocks } from "../../../src/trial/review/findings.ts";
import { CARBON, rmFail } from "./frozen.ts";

/** One finding of a review's final report: the native findings and the voice's section alike. */
export interface ReviewFinding {
  id: string;
  source: "native" | "voice";
  /** The severity label as the report wrote it. */
  severity: string;
  path: string | null;
  line: number | null;
  /** The claim and its evidence, as written. */
  text: string;
  /** A "Blocks: yes" field the parser read apart from the text. */
  blocks?: boolean;
}

/** A bug unit's known bug: the reviewer's comment, advisory or later fix PR, and the commit that fixed it. */
export interface Bug {
  unit: string;
  pool: "P" | "B";
  evidence: string;
  fix_diff: string;
}

export const RULINGS = ["names", "doesnt", "cant_tell"] as const;
export type Ruling = (typeof RULINGS)[number];

const BLOCKING_LABELS = new Set(["critical", "high", "p0", "p1"]);
const BLOCKS_YES = /\bblocks:\s*yes\b/i;

/** gstack's blocking rule at the pin: Critical, High, P0, P1 or Blocks: yes. */
export function isBlocking(f: Pick<ReviewFinding, "severity" | "text" | "blocks">): boolean {
  const label = f.severity.replace(/[^A-Za-z0-9]+/g, " ").trim().split(" ")[0]!.toLowerCase();
  return f.blocks === true || BLOCKING_LABELS.has(label) || BLOCKS_YES.test(f.severity) || BLOCKS_YES.test(f.text);
}

const MODEL_WORDS = /\b(?:claude(?:[- ]code)?|anthropic|opus|fable|sonnet|haiku|openai|chatgpt|gpt[-\w.]*\w|codex|astra|sol|gemini|gstack)\b/gi;
const CUE = /^\s*(?:\[[^\]\n]{0,40}\]|\([^)\n]{0,40}\)|(?:codex|outside voice|second[- ]model(?: review)?|second opinion|adversarial(?: challenge| review| subagent)?|structured review|review army|red[- ]team|specialist|voice|native)\b[^:\n]{0,40}:)\s*/i;
const SEVERITY_WORDS = /\b(?:CRITICAL|INFORMATIONAL|HIGH|MEDIUM|LOW|BLOCKER|BLOCKING|NIT|MAJOR|MINOR|SEVERE|P[0-3])\b/g;
const BLOCKS_FIELD = /\bblocks:\s*(?:yes|no)\b\.?/gi;

/** A finding's text with leading voice or reader tags dropped, model names masked and severity words and fields masked. */
export function normaliseText(text: string): string {
  let t = text;
  for (let m = CUE.exec(t); m && m[0].length; m = CUE.exec(t)) t = t.slice(m[0].length);
  return t.replace(BLOCKS_FIELD, "").replace(MODEL_WORDS, "[model]").replace(SEVERITY_WORDS, "[severity]").replace(/[ \t]+\n/g, "\n").trim();
}

/** The numbered list judge, labellers and adjudication share: one severity set (blocking or non-blocking), no source. */
export function numberedFindings(findings: readonly ReviewFinding[]): string {
  const ids = new Set(findings.map((f) => f.id));
  if (ids.size !== findings.length) rmFail("E_RM_JUDGE", "a review's finding ids repeat");
  return findings
    .map((f, i) => {
      const where = f.path ? f.path + (f.line !== null ? ":" + f.line : "") : "(no file cited)";
      return i + 1 + ". [" + (isBlocking(f) ? "blocking" : "non-blocking") + "] " + where + "\n" + normaliseText(f.text).replace(/^/gm, "   ");
    })
    .join("\n");
}

/** A fence longer than any backtick run in the text. */
export function fence(text: string): string {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  return "`".repeat(Math.max(3, longest + 1));
}

/** The bug's evidence and fix, as the judge and the labellers both see them. */
export function bugBlock(bug: Bug): string {
  const f = fence(bug.fix_diff);
  return "The bug, as the people who found or fixed it described it:\n" + bug.evidence.trim() + "\n\nThe diff that fixed it:\n" + f + "diff\n" + bug.fix_diff.replace(/\n$/, "") + "\n" + f;
}

export function judgePrompt(bug: Bug, findings: readonly ReviewFinding[]): string {
  return [
    "You are checking whether a code review found one known bug. The review was written before the fix below existed.",
    bugBlock(bug),
    "The review's findings, numbered:\n" + numberedFindings(findings),
    'For each finding, rule whether it names this bug. "names": it identifies the defect the fix repairs (the same faulty behaviour, in the code the fix changes or the code that causes it), at any severity and whatever fix it proposes. "doesnt": it is about something else. "cant_tell": the finding is too vague to decide.',
    'Answer with one fenced json block and nothing after it, ruling every finding exactly once:\n{"rulings": [{"finding": 1, "ruling": "names", "reason": "one sentence"}]}',
  ].join("\n\n");
}

export type Parsed<T> = { kind: "ok"; value: T } | { kind: "empty" } | { kind: "malformed"; reason: string };

/** The reply's JSON: its last fenced json (or unlabelled) block, else the whole reply when it is one JSON value. */
export function replyJson(text: string): Parsed<unknown> {
  if (!text.trim()) return { kind: "empty" };
  const blocks = fencedBlocks(text).filter((b) => b.info === "" || b.info.toLowerCase() === "json");
  const source = blocks.length ? blocks.at(-1)!.body : text.trim();
  try {
    return { kind: "ok", value: JSON.parse(source) };
  } catch {
    return { kind: "malformed", reason: "the reply holds no JSON block that parses" };
  }
}

/** One ruling per finding 1..n, each exactly once. */
export function parseJudgeReply(text: string, n: number): Parsed<Array<{ ruling: Ruling; reason: string }>> {
  const j = replyJson(text);
  if (j.kind !== "ok") return j;
  const list = (j.value as { rulings?: unknown })?.rulings;
  if (!Array.isArray(list)) return { kind: "malformed", reason: "the reply has no rulings array" };
  const out: Array<{ ruling: Ruling; reason: string } | undefined> = Array.from({ length: n }, () => undefined);
  for (const r of list as Array<Record<string, unknown>>) {
    const k = r?.finding;
    if (typeof k !== "number" || !Number.isInteger(k) || k < 1 || k > n) return { kind: "malformed", reason: "a ruling names finding " + JSON.stringify(k) + ", not 1 to " + n };
    if (out[k - 1]) return { kind: "malformed", reason: "finding " + k + " is ruled twice" };
    if (!RULINGS.includes(r.ruling as Ruling)) return { kind: "malformed", reason: "finding " + k + " has ruling " + JSON.stringify(r.ruling) };
    out[k - 1] = { ruling: r.ruling as Ruling, reason: typeof r.reason === "string" ? r.reason : "" };
  }
  const missing = out.flatMap((r, i) => (r ? [] : [i + 1]));
  if (missing.length) return { kind: "malformed", reason: "no ruling for finding " + missing.join(", ") };
  return { kind: "ok", value: out as Array<{ ruling: Ruling; reason: string }> };
}

/** The request body: Carbon on OpenRouter, only google-vertex, no fallbacks, data collection denied, at the row's price ceiling. */
export function carbonRequest(prompt: string): Record<string, unknown> {
  const price = OPENROUTER_MODELS[CARBON.model];
  if (!price || price.providers?.length !== 1 || price.providers[0] !== CARBON.pin) return rmFail("E_RM_JUDGE", CARBON.model + " has no price row pinned to " + CARBON.pin + " alone");
  return { ...judgeRequest("openrouter", CARBON.model, prompt), provider: openRouterRouting(price) };
}

export const CARBON_ROUTE = JUDGE_ROUTE.openrouter;

/** The reply's text, and whether it was cut off at its length or stopped by the provider's filter. */
export function readCarbonReply(r: { status: number; body: unknown }): { text: string; cut_off: boolean; refused: boolean } {
  if (r.status !== 200) return rmFail("E_RM_JUDGE", "the Carbon call answered HTTP " + r.status + "; a transport failure is the run driver's to retry, never a ruling");
  const choice = (r.body as { choices?: Array<{ finish_reason?: string; message?: { refusal?: unknown } }> })?.choices?.[0];
  return { text: judgeAnswer("openrouter", r.body), cut_off: choice?.finish_reason === "length", refused: choice?.finish_reason === "content_filter" || !!choice?.message?.refusal };
}

export type Send = (body: Record<string, unknown>, attempt: number) => Promise<{ status: number; body: unknown }>;

export interface Judged {
  /** By finding id. */
  rulings: Record<string, Ruling>;
  reasons: Record<string, string>;
  attempts: number;
  /** Why each failed attempt failed: empty, cut off, refused, or malformed with its reason. */
  failures: string[];
  /** True when both attempts failed and every finding was ruled can't tell. */
  failed: boolean;
}

/** Judges one review. A review with no findings needs no call and names nothing. */
export async function judgeReview(bug: Bug, findings: readonly ReviewFinding[], send: Send): Promise<Judged> {
  const judged: Judged = { rulings: {}, reasons: {}, attempts: 0, failures: [], failed: false };
  if (!findings.length) return judged;
  const body = carbonRequest(judgePrompt(bug, findings));
  for (let attempt = 1; attempt <= 2; attempt++) {
    judged.attempts = attempt;
    const reply = readCarbonReply(await send(body, attempt));
    const parsed = reply.refused ? null : reply.cut_off ? null : parseJudgeReply(reply.text, findings.length);
    if (parsed?.kind === "ok") {
      findings.forEach((f, i) => ((judged.rulings[f.id] = parsed.value[i]!.ruling), (judged.reasons[f.id] = parsed.value[i]!.reason)));
      return judged;
    }
    judged.failures.push(reply.refused ? "refused" : reply.cut_off ? "cut off" : parsed!.kind === "empty" ? "empty" : "malformed: " + (parsed as { reason: string }).reason);
  }
  for (const f of findings) judged.rulings[f.id] = "cant_tell";
  judged.failed = true;
  return judged;
}
