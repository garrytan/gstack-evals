// Copyright (c) 2026 Garry Tan. MIT License.
// The model a reply reports against the model this eval pinned for the call (pre-run change 4, fix 2). A reply counts
// only when the model it names is the pin, or a dated snapshot of the pin that the provider names by appending the date
// (claude-opus-5-5-20261101, gpt-6.2-astra-2026-11-01). Any other name, or no name at all, is a drift.
// - reportsPin: the rule above, for one reported name.
// - modelDrift: the E_OHR_MODEL_DRIFT line for a direct call's reply, or null; wire.ts stops a judge or auditor command
//   on it, and sim/founder.ts turns it into a simulator drift.
// - offPin: every model name an arm session's transcript reports on an assistant message that is not the pin; run.ts
//   halts the launch on any (the session is not counted). Claude Code's own error frames name "<synthetic>" and are
//   skipped, since no provider served them.
import { readTranscript } from "../../src/trial/review/readers.ts";

const DATED = /^-(\d{8}|\d{4}-\d{2}-\d{2})$/;

/** True when reported is the pin or the pin with a date appended. */
export const reportsPin = (pin: string, reported: string | null | undefined): boolean => typeof reported === "string" && (reported === pin || (reported.startsWith(pin) && DATED.test(reported.slice(pin.length))));

/** The drift line for a reply that names another model, or null when it names the pin. */
export function modelDrift(pin: string, reported: string | null | undefined, what: string): string | null {
  if (reportsPin(pin, reported)) return null;
  return "E_OHR_MODEL_DRIFT " + what + " asked for " + pin + " and the reply reports " + (typeof reported === "string" ? reported : "no model") + "; it does not count, so the command stops for the Captain";
}

/** The models an arm session's assistant messages report that are not its pin, each once. */
export function offPin(transcript: string, pin: string): string[] {
  const seen = new Set<string>();
  for (const m of readTranscript(transcript) as Record<string, any>[]) {
    if (m.type !== "assistant") continue;
    const reported = m.message?.model;
    if (reported === "<synthetic>") continue;
    if (!reportsPin(pin, reported)) seen.add(typeof reported === "string" ? reported : "(no model)");
  }
  return [...seen];
}
