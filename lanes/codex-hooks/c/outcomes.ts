// Copyright (c) 2026 Garry Tan. MIT License.
// Section 5.8's outcome per part C session, with section 2's effort check and pre-run change 1's section 10 (the model and
// Codex version each session recorded).
//
// Classes, first match wins:
// - cap_stop: the ledger's cap stopped the session. Never rerun; it ends its part INCOMPLETE.
// - safety: a provider safety stop, a refusal part in an assistant message or an upstream answer naming a safety or
//   content policy. It keeps its class and is scored when a response reached the agent and the rollout was copied.
// - infra (reruns once as attempt 2; a second infra is a gap): no rollout was copied (E_CODEX_C_NO_ROLLOUT); no model
//   response reached the agent (E_CODEX_C_NO_RESPONSE); or the session's record breaks the pin (E_CODEX_C_DRIFT): the root
//   thread ran a model other than gpt-6.1-sol, a rollout names a Codex version other than 0.170.0, a request in the
//   proxy's journal names a model no thread's turns ran or carries another effort than the arm's, or the journal holds no
//   request for the session's meter. The model and version come from the journal and the rollouts, never from the plan.
// - limit_stop: the session hit its allowance or its time limit; it is scored on its last assistant message.
// - no_text: the root thread left no assistant text; scored as finding nothing and counted on its own line.
// - scored: everything else.
// A sub-agent on another model is listed (sub_models) and its session stays scored.
import { CODEX } from "../pins.ts";
import { ARMS, MODEL, type ArmName } from "./pins.ts";
import { lastAssistant, responded, type SessionRollouts } from "./rollout.ts";
import type { Cell } from "./states.ts";

export type OutcomeClass = "scored" | "limit_stop" | "no_text" | "safety" | "infra" | "cap_stop";

export interface OutcomeRow extends Cell {
  attempt: number;
  class: OutcomeClass;
  scored: boolean;
  code: string | null;
  reasons: string[];
  termination: string;
  root_models: string[];
  sub_models: string[];
  journal_models: string[];
  journal_efforts: string[];
  cli_versions: string[];
  requests: number;
  rerun: boolean;
  gap: boolean;
}

export interface SessionInput {
  cell: Cell;
  attempt: number;
  termination: { kind: string; code?: string };
  allowance_stops: number;
  meter_id: string;
  rollouts: SessionRollouts;
  journal: readonly Record<string, any>[];
}

const SAFETY = /cyber_policy|content_policy|safety|content_filter|invalid_prompt/i;
const uniq = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => x !== null))].sort();

export function outcome(s: SessionInput): OutcomeRow {
  const { cell, rollouts: r } = s;
  const root = r.root;
  const requests = s.journal.filter((l) => l.kind === "request" && l.cell?.meter_id === s.meter_id);
  const rids = new Set(requests.map((l) => l.reservation_id));
  const answers = s.journal.filter((l) => l.kind === "outcome" && (l.meter_id === s.meter_id || rids.has(l.reservation_id)));
  const threads = root ? [root, ...r.subs] : r.subs;
  const root_models = uniq(root?.turns.map((t) => t.model) ?? []);
  const sub_models = uniq(r.subs.flatMap((t) => t.turns.map((x) => x.model))).filter((m) => m !== MODEL);
  const turnModels = new Set(threads.flatMap((t) => t.turns.map((x) => x.model)));
  const journal_models = uniq(requests.map((l) => (typeof l.model === "string" ? l.model : null)));
  const journal_efforts = uniq(requests.map((l) => (typeof l.fields?.reasoning?.effort === "string" ? l.fields.reasoning.effort : null)));
  const cli_versions = uniq(threads.map((t) => t.cli_version));
  const effort = ARMS[cell.arm as ArmName]?.effort ?? null;
  const term = s.termination.kind + (s.termination.code ? " " + s.termination.code : "");
  const base = { ...cell, attempt: s.attempt, termination: term, root_models, sub_models, journal_models, journal_efforts, cli_versions, requests: requests.length };
  const row = (cls: OutcomeClass, scored: boolean, code: string | null, reasons: string[]): OutcomeRow => ({ ...base, class: cls, scored, code, reasons, rerun: cls === "infra" && s.attempt === 1, gap: cls === "infra" && s.attempt > 1 });

  if (s.termination.kind === "cap_stop") return row("cap_stop", false, "CAP_STOP", ["the ledger's cap stopped the session"]);
  const reached = root !== null && responded(root);
  const refused = root?.items.some((x) => x.kind === "message" && x.role === "assistant" && x.refusal) ?? false;
  const safetyAnswer = answers.some((l) => l.upstream_body !== undefined && SAFETY.test(JSON.stringify(l.upstream_body)));
  if (refused || safetyAnswer) return row("safety", reached, null, [refused ? "an assistant message holds a refusal" : "an upstream answer names a safety or content policy"]);
  if (!root) return row("infra", false, "E_CODEX_C_NO_ROLLOUT", ["no root rollout was copied" + (r.problems.length ? ": " + r.problems.join("; ") : "")]);
  if (!reached) return row("infra", false, "E_CODEX_C_NO_RESPONSE", ["no model response reached the agent"]);
  const drift: string[] = [];
  for (const m of root_models) if (m !== MODEL) drift.push("the root thread ran " + m);
  if (!root_models.length) drift.push("the root rollout records no turn model");
  for (const v of cli_versions) if (v !== CODEX.version) drift.push("a rollout names Codex " + v);
  if (threads.some((t) => t.cli_version === null)) drift.push("a rollout names no Codex version");
  if (!requests.length) drift.push("the journal holds no request for meter " + s.meter_id + ", so its models and efforts cannot be read");
  for (const m of journal_models) if (!turnModels.has(m)) drift.push("a request names " + m + ", which no thread's turns ran");
  if (requests.some((l) => typeof l.model !== "string")) drift.push("a request names no model");
  for (const e of journal_efforts) if (e !== effort) drift.push("a request ran at effort " + e + ", not the arm's " + effort);
  if (requests.some((l) => typeof l.fields?.reasoning?.effort !== "string")) drift.push("a request carries no reasoning effort");
  if (drift.length) return row("infra", false, "E_CODEX_C_DRIFT", drift);
  if (s.termination.kind === "timeout" || s.termination.code === "E_ALLOWANCE" || s.allowance_stops > 0) return row("limit_stop", true, null, [s.termination.kind === "timeout" ? "the session hit its time limit" : "the session hit its allowance"]);
  if (lastAssistant(root) === null) return row("no_text", true, null, ["the root thread left no assistant text"]);
  return row("scored", true, null, []);
}
