// Gate 3, the visibility read (plan 2026-11-24-geva-590-review-models-prereg, section 2): Claude Opus 5.5 and GPT-6.2
// Astra each read the advisory, the fix and the BIC diff and answer whether the BIC introduces the advisory's defect in
// lines it adds. A unit stays only when both say yes. This file builds the requests, sends them through a transport the
// caller supplies (the metering proxy in a run, a stub in tests) and reads the replies; it holds no key. Both models run
// at their provider defaults, with the read-only correctness framing the factory uses so an OpenAI model does not read
// the task as offensive security work. A malformed or truncated reply gets one retry; a refusal is its own verdict.
import { createHash } from "node:crypto";
import { judgeAnswer } from "../../../adapters/judge.ts";
import type { Provider } from "../../../runner/pricing/prices.ts";
import { passed, type Gate } from "./gates.ts";
import { supplyFail } from "./git.ts";

export const VIS_MODELS = {
  opus: { provider: "anthropic", api: "claude-opus-5-5", route: "/v1/messages" },
  astra: { provider: "openai", api: "gpt-6.2-astra", route: "/v1/responses" },
} as const satisfies Record<string, { provider: Provider; api: string; route: string }>;
export type VisModel = keyof typeof VIS_MODELS;
export const VIS_MAX_OUTPUT = 16_000;

export interface VisMaterial { ghsa: string; summary: string; details: string; fix_diff: string; bic_diff: string }

export function visPrompt(m: VisMaterial): string {
  return [
    "This is a read-only correctness review of a published security advisory and two commits. Do not write exploits, proofs of concept or reproduction steps.",
    "",
    "Advisory " + m.ghsa + ": " + m.summary.trim(),
    m.details.trim(),
    "",
    "The fix, the commit that resolved the advisory:",
    "<fix_diff>",
    m.fix_diff.trimEnd(),
    "</fix_diff>",
    "",
    "The candidate commit:",
    "<candidate_diff>",
    m.bic_diff.trimEnd(),
    "</candidate_diff>",
    "",
    "Question: does the candidate commit introduce the advisory's defect in lines it adds? Say yes only when lines the candidate commit adds are part of the defect the fix removes or guards against. Explain in at most five sentences, then end with one line that is exactly ANSWER: YES or ANSWER: NO.",
  ].join("\n");
}

export interface VisRequest { ghsa: string; unit: string; model: VisModel; provider: Provider; route: string; prompt_sha256: string; body: Record<string, unknown> }

/** The two requests for one unit, one per model, each with the same prompt. */
export function visRequests(unit: string, m: VisMaterial): VisRequest[] {
  const prompt = visPrompt(m);
  const prompt_sha256 = createHash("sha256").update(prompt).digest("hex");
  const messages = [{ role: "user", content: prompt }];
  return (Object.keys(VIS_MODELS) as VisModel[]).map((model) => {
    const r = VIS_MODELS[model];
    const body = r.provider === "anthropic" ? { model: r.api, max_tokens: VIS_MAX_OUTPUT, messages } : { model: r.api, input: messages, store: false, max_output_tokens: VIS_MAX_OUTPUT };
    return { ghsa: m.ghsa, unit, model, provider: r.provider, route: r.route, prompt_sha256, body };
  });
}

export type Verdict = "yes" | "no" | "refused" | "truncated" | "malformed" | "error";
export interface VisReply { ghsa: string; model: VisModel; attempt: number; status: number; body: unknown }
/** The last "ANSWER: YES" or "ANSWER: NO" line of a reply, or null. */
export function parseAnswer(text: string): "yes" | "no" | null {
  const all = [...text.matchAll(/^\s*\**ANSWER:\s*(YES|NO)\**\s*$/gim)];
  return all.length ? (all[all.length - 1]![1]!.toLowerCase() as "yes" | "no") : null;
}

/** One reply's verdict. */
export function verdictOf(provider: Provider, status: number, body: any): Verdict {
  if (status !== 200) return "error";
  if (provider === "anthropic" ? body?.stop_reason === "refusal" : (body?.output ?? []).some((i: any) => (i?.content ?? []).some((c: any) => c?.type === "refusal")) || body?.incomplete_details?.reason === "content_filter") return "refused";
  const answer = parseAnswer(judgeAnswer(provider, body));
  if (answer) return answer;
  return (provider === "anthropic" ? body?.stop_reason === "max_tokens" : body?.incomplete_details?.reason === "max_output_tokens") ? "truncated" : "malformed";
}

export type Transport = (req: { provider: Provider; route: string; body: Record<string, unknown>; attempt?: number }) => Promise<{ status: number; body: unknown }>;

/** A reply that decides its model's verdict: yes, no, a refusal, or a second malformed or truncated reply. A non-200
 *  reply settles nothing, so a later send asks again. */
export function settled(provider: Provider, r: VisReply): boolean {
  const v = verdictOf(provider, r.status, r.body);
  return v === "yes" || v === "no" || v === "refused" || ((v === "malformed" || v === "truncated") && r.attempt >= 2);
}

/** Sends every request with no settled reply, at most twice each per call: attempt 1, attempt 2 after a malformed or
 *  truncated reply, and the same attempt again after a non-200 reply. Each reply goes to record before the next send,
 *  so a stopped send resumes without paying twice. */
export async function sendVisibility(requests: readonly VisRequest[], done: readonly VisReply[], transport: Transport, record: (r: VisReply) => void): Promise<number> {
  const last = latest(done);
  let sent = 0;
  for (const q of requests) {
    let prev = last.get(q.ghsa + " " + q.model);
    for (let tries = 0; tries < 2 && !(prev && settled(q.provider, prev)); tries++) {
      const attempt = !prev ? 1 : prev.status !== 200 ? prev.attempt : prev.attempt + 1;
      const res = await transport({ provider: q.provider, route: q.route, body: q.body, attempt });
      prev = { ghsa: q.ghsa, model: q.model, attempt, status: res.status, body: res.body };
      record(prev);
      sent++;
    }
  }
  return sent;
}

const latest = (replies: readonly VisReply[]): Map<string, VisReply> => {
  const m = new Map<string, VisReply>();
  for (const r of replies) {
    const k = r.ghsa + " " + r.model;
    if (!m.has(k) || m.get(k)!.attempt <= r.attempt) m.set(k, r);
  }
  return m;
};

export interface VisResult { unit: string; verdicts: Partial<Record<VisModel, Verdict>>; g3?: Gate }

/** Gate 3 per advisory from the requests and every reply: ok when both models say yes, a failure once both have settled
 *  otherwise, and no gate (pending) while a model has no settled reply. */
export function readVisibility(requests: readonly VisRequest[], replies: readonly VisReply[]): Record<string, VisResult> {
  const last = latest(replies);
  const out: Record<string, VisResult> = {};
  for (const q of requests) {
    const res = (out[q.ghsa] ??= { unit: q.unit, verdicts: {} });
    if (res.unit !== q.unit) supplyFail("E_RMS_INPUT", q.ghsa + " has requests for two units");
    const r = last.get(q.ghsa + " " + q.model);
    if (r && settled(q.provider, r)) res.verdicts[q.model] = verdictOf(q.provider, r.status, r.body);
  }
  for (const res of Object.values(out)) {
    const models = Object.keys(VIS_MODELS) as VisModel[];
    if (!models.every((m) => res.verdicts[m])) continue;
    const not = models.filter((m) => res.verdicts[m] !== "yes");
    res.g3 = not.length ? { fail: not.map((m) => m + " " + res.verdicts[m]).join(", ") } : "ok";
  }
  return out;
}

export const visPassed = (r: VisResult | undefined): boolean => passed(r?.g3);
