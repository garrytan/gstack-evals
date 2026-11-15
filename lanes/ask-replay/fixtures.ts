// Copyright (c) 2026 Garry Tan. MIT License.
// Keyless fixtures shared by the dry run and the tests: a scripted stub model in each provider's answer shape, a
// stand-in gstack text for machines with no gstack clone, a tiny raw build input with planted secret shapes, and
// interval fixtures for the decision rows.
import type { Interval } from "./stats.ts";
import type { Decision, ModelIntervals } from "./score.ts";
import type { CallKey } from "./run.ts";
import type { BuildInput, TranscriptItem } from "./build.ts";
import type { GstackText } from "./prompt.ts";
import { FROZEN } from "./frozen.ts";
import type { Action, LabelReply, Sample, SampleRecord } from "./types.ts";

export type StubReply =
  | { action: Action | string; reason?: string; repeats?: unknown; reask_reason?: unknown; wrap?: boolean }
  | { raw: "unparsable" | "safety" | "upstream" | "none" | "kill" };

/** A provider answer body for text, in the model's provider shape. */
export function answerBody(model: Sample["model"], text: string, stop: "ok" | "safety" = "ok"): Record<string, unknown> {
  const p = FROZEN.models[model].provider;
  if (p === "anthropic") return { content: [{ type: "text", text }], stop_reason: stop === "safety" ? "refusal" : "end_turn", usage: { input_tokens: 1200, output_tokens: 80 } };
  if (p === "openai") return { status: "completed", output: [{ type: "message", content: [stop === "safety" ? { type: "refusal", refusal: "I can't help with that." } : { type: "output_text", text }] }], usage: { input_tokens: 1200, output_tokens: 80 } };
  return { provider: "particle-ai", choices: [{ message: { content: text }, finish_reason: stop === "safety" ? "content_filter" : "stop" }], usage: { prompt_tokens: 1200, completion_tokens: 80 } };
}

export class Killed extends Error {}

/** A stub labeller: the scripted label as the model's JSON text, or text with no valid label. */
export function labelSend(script: (s: Sample) => Partial<LabelReply> | "unparsable", calls: string[] = [], bodies: Array<Record<string, unknown>> = []) {
  return async (s: Sample, key: CallKey, body: Record<string, unknown>): Promise<{ status: number; body: unknown }> => {
    calls.push(s.id + "#" + key.draw + "/" + key.attempt);
    bodies.push(body);
    const r = script(s);
    return { status: 200, body: answerBody(s.model, r === "unparsable" ? "no label in this text" : JSON.stringify({ repeats_of: null, answer_judgement: [], reason: "scripted", ...r })) };
  };
}

/** A sealed labeller record for readout tests. */
export function labelRecord(id: string, item: string, model: Sample["model"], label: LabelReply | null): SampleRecord {
  return { sample: { id, item, arm: "a", model, replicate: 1 }, draw: 1, attempts: 1, missing: label ? null : "parse", agent_action: null, final_action: null, repeats: "not_asked", named: null, reask_reason: false, gate: "none", reason: label?.reason ?? null, text: null, capped: false, micros: 1, upstream_redraw: false, label };
}

/** A stub send that answers each call from a script; "kill" throws Killed, as a shard's process dying would. */
export function stubSend(script: (s: Sample, key: CallKey) => StubReply, calls: string[] = []) {
  return async (s: Sample, key: CallKey): Promise<{ status: number; body: unknown } | null> => {
    calls.push(s.id + "#" + key.draw + "/" + key.attempt);
    const r = script(s, key);
    if ("raw" in r) {
      if (r.raw === "kill") throw new Killed("killed at " + s.id);
      if (r.raw === "none") return null;
      if (r.raw === "upstream") return { status: 503, body: { error: { type: "overloaded" } } };
      if (r.raw === "safety") return { status: 200, body: answerBody(s.model, "", "safety") };
      return { status: 200, body: answerBody(s.model, "I would rather think about this more before answering.") };
    }
    const { wrap, ...fields } = r;
    const json = JSON.stringify({ reason: "scripted", ...fields });
    return { status: 200, body: answerBody(s.model, wrap ? "Here is my answer.\n" + json + "\nThanks." : json) };
  };
}

/** A stand-in for the pinned gstack files: lines of 40 or more characters that name gstack, as the real files do. */
export const FIXTURE_GSTACK: GstackText = {
  commit: "fixture",
  text: ["# capy/skill/gstack/factory.md", "", "Ask the owner once per decision, and never send the same ask twice.", "gstack keeps one open ask per decision and folds repeats into the digest.", "", "# captain/SKILL.md", "", "Check the stack is installed before each session begins on a machine."].join("\n"),
};

const iv = (lo: number, hi: number, loto: [number, number] | null = [lo, hi]): Interval => ({ delta: (lo + hi) / 2, lo, hi, n_items: 100, n_clusters: 80, loto });

/** Decision-row fixtures: per frontier model interval sets, by name. */
export const DECISION_FIXTURES: Record<string, { opus: ModelIntervals; sol: ModelIntervals; row: Decision["row"]; cut_candidate: boolean }> = (() => {
  const base = (o: Partial<ModelIntervals>): ModelIntervals => ({ inconclusive: false, cb_needless: iv(-0.3, -0.15), cb_must: iv(-0.02, 0.03), dc_needless: iv(-0.05, 0.06), dc_must: iv(-0.02, 0.03), ab_needless: iv(0.1, 0.3), ab_must: iv(-0.03, 0.02), ac_needless: iv(0.2, 0.4), ac_must: iv(-0.03, 0.02), ...o });
  return {
    build_and_trim: { opus: base({}), sol: base({}), row: "build and trim", cut_candidate: false },
    build_no_trim: { opus: base({ dc_needless: iv(0.02, 0.14) }), sol: base({}), row: "build", cut_candidate: false },
    cut_failed_guard: { opus: base({}), sol: base({ cb_must: iv(0.01, 0.08) }), row: "fix-method", cut_candidate: false },
    c_clearly_worse: { opus: base({ cb_needless: iv(0.1, 0.25), dc_needless: iv(-0.3, -0.1) }), sol: base({ cb_needless: iv(0.05, 0.2) }), row: "drop", cut_candidate: false },
    a_clearly_better: { opus: base({ cb_needless: iv(-0.05, 0.04), ab_needless: iv(-0.3, -0.15), ac_needless: iv(-0.25, -0.1) }), sol: base({ cb_needless: iv(-0.06, 0.05), ab_needless: iv(-0.2, -0.05), ac_needless: iv(-0.2, -0.04) }), row: "drop", cut_candidate: true },
    loto_crosses_zero: { opus: base({ cb_needless: iv(-0.09, -0.01, [-0.12, 0.01]) }), sol: base({ cb_needless: iv(-0.04, 0.05) }), row: "drop", cut_candidate: false },
    wide_needless: { opus: base({ cb_needless: iv(-0.25, 0.05) }), sol: base({ cb_needless: iv(-0.2, 0.04) }), row: "inconclusive", cut_candidate: false },
    past_missing_ceiling: { opus: base({ inconclusive: true }), sol: base({ cb_needless: iv(-0.04, 0.05) }), row: "inconclusive", cut_candidate: false },
  };
})();

const at = (d: number, h: number) => new Date(Date.UTC(2026, 9, d, h)).toISOString();

/** A tiny raw build input: one thread with a planted key, an email and a phone number, a NOT_ASK row and an unreadable row. */
export function buildFixture(): BuildInput {
  const items: TranscriptItem[] = [
    { id: "e1", source: "assistant", text: "Status: the parser work merged.", createdAt: at(12, 9) },
    { id: "e2", source: "assistant", text: "Pat:\nShould we cap uploads at 10 MB or 25 MB? I recommend 10 MB.", createdAt: at(12, 10) },
    { id: "e3", source: "tool", tool: "bash", text: "ls", createdAt: at(12, 10) },
    { id: "e4", source: "user", authorName: "Pat Owner", text: "10 MB. Mail me at pat@example.com or call 555-010-4477.", createdAt: at(12, 12) },
    { id: "e5", source: "user", text: "Crew report: the nightly build passed.", createdAt: at(13, 8) },
    { id: "e6", source: "tool", tool: "message_user", text: "Checking again: should we cap uploads at 10 MB or 25 MB? Key sk-ant-abcdefghijklmnop1234 is in the log.", createdAt: at(13, 9) },
    { id: "e7", source: "assistant", text: "Should the web app drop the old tablet layout?", createdAt: at(16, 9) },
  ];
  const audit = [
    { thread: "fixture-thread", event: "e1", at: at(12, 9), latency_min: "", class: "NOT_ASK", reply_kind: "none", note: "never read" },
    { thread: "fixture-thread", event: "e2", at: at(12, 10), latency_min: "120", class: "DECISION", reply_kind: "answer", note: "never read" },
    { thread: "fixture-thread", event: "e6", at: at(13, 9), latency_min: "", class: "DUPLICATE", reply_kind: "none", note: "never read" },
    { thread: "fixture-thread", event: "e7", at: at(16, 9), latency_min: "", class: "DECISION", reply_kind: "none", note: "never read" },
    { thread: "fixture-thread", event: "missing", at: at(16, 10), latency_min: "", class: "OBSERVABLE", reply_kind: "none", note: "never read" },
  ];
  const rules = [
    "| Rule | Rule text | Owner's words | Date | Scope | Recorded | Status |",
    "|---|---|---|---|---|---|---|",
    "| R1 | Merge on green without asking. | words | 2026-10-10 | all | x | live |",
    "| R2 | Rerun a failed test once. | words | undated | all | x | live |",
    "| R3 | Check CI yourself. | words | first said 2026-10-14, again 2026-10-11 | all | x | live |",
    "| R4 | Keep a digest. | words | unknown | all | x | live |",
  ].join("\n");
  let n = 0;
  return { threads: new Map([["fixture-thread", items]]), audit, rules, owner: ["Pat Owner"], newId: () => "i-fixture" + n++ };
}
