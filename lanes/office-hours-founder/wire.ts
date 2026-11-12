// Copyright (c) 2026 Garry Tan. MIT License.
// The office-hours founder eval's assembly of its areas.
// - simFounder: the simulator area's person turn (src/persona-sim, sim/founder.ts) behind the run area's session loop.
//   The run area's simulator slot enforces the attempt's allowance and refuses with the proxy's E_ALLOWANCE code, which
//   founderCall reads as an allowance refusal; founderCall still checks that Google Vertex served every reply.
// - completeRow: the scoring area's reads on a run row: exposure on office-hours sessions, the counters on every
//   session, and, on the real stratum, whether the assistant's text named the source.
import { existsSync, readFileSync } from "node:fs";
import { personTurn } from "../../src/persona-sim/sim.ts";
import type { CallRequest, CallResult } from "../product-value/meter.ts";
import { namesIn } from "./author/screens.ts";
import { replies } from "./parse.ts";
import type { RowLine } from "./run/rows.ts";
import type { FounderResult, FounderTurnFn, PersonSheet } from "./run/session.ts";
import { counters } from "./score/counters.ts";
import { exposure } from "./score/exposure.ts";
import { FOUNDER_RULES, founderCall } from "./sim/founder.ts";
import type { SessionRow, UnitMeta } from "./types.ts";

type Call = (req: CallRequest) => Promise<CallResult>;

/** The founder turn the run loop calls, with section 4's prompt or the one recorded rule-wording repair. */
export function simFounder(rules: string = FOUNDER_RULES): FounderTurnFn<PersonSheet, Call> {
  return async ({ sheet, transcript, call }): Promise<FounderResult> => {
    const t = await personTurn({
      sheet: { rules, persona: sheet.persona, opening: sheet.opening.trim(), items: sheet.facts.map((f) => ({ id: f.id, text: f.text, reveal_when: f.reveal_when })) },
      transcript,
      call: founderCall({ meter: { call }, session: { allowance_micros: Number.MAX_SAFE_INTEGER, spent_micros: 0 }, label: "founder" }),
    });
    if (t.kind === "reply") return { kind: "reply", reply: t.reply, revealed: t.revealed, rules: t.rules, attempts: t.attempts };
    if (t.kind === "check-failed") return { kind: "check-failed", checks: t.checks, attempts: t.attempts };
    return { kind: "call-failed", reason: t.reason, detail: t.detail };
  };
}

/** A run row with the scoring area's reads filled in. names is the real unit's Names line; constructed units have none. */
export function completeRow(line: RowLine, meta: UnitMeta, names: readonly string[] = []): SessionRow {
  const transcript = line.transcript && existsSync(line.transcript) ? readFileSync(line.transcript, "utf8") : "";
  const c = counters(transcript);
  const text = replies(transcript).flat().join("\n\n");
  if (meta.stratum === "real" && !names.length) throw new Error("E_USAGE completeRow: real unit " + meta.id + " needs its Names line to read named_source");
  return {
    ...line.row,
    exposure: line.row.arm === "office-hours" && transcript ? exposure(transcript, line.state_root, meta.founder_stage) : null,
    questions: c.questions,
    pushes: c.pushes,
    first_recommendation_reply: c.first_recommendation_reply,
    named_source: meta.stratum === "real" ? namesIn(text, names).length > 0 : false,
  };
}
