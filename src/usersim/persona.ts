// The persona's free-form answers on a real host (U10b). A question the task's sidecar does not answer goes to the
// user simulator's model, the one the call carries from the policy (defaults.usersim), never one named here. Each answer
// is one request with no tools (src/adapters/judge.ts), sent through the session's own usersim slot on the metering
// proxy under the run's lease, from a container that holds no skill and no copy of the agent's work. The persona never
// enters the agent's container; only the answer does, and it still passes the simulator's binding rules
// (src/usersim/sim.ts), so a free-form answer approves nothing.
//
// A source that cannot answer ends the agent's cell: a cap stop stops it as a cap stop, a proxy refusal or provider
// failure leaves a missing cell with its code, and a timeout or crash of the request leaves a missing cell, E_USERSIM.
// A completed request with no text gives null, and the simulator sends its fixed non-approving fallback.
import type { Termination } from "../types.ts";

/** The output cap one free-form answer asks the proxy for; the session's usersim allowance covers several. */
export const PERSONA_MAX_OUTPUT_TOKENS = 1024;

/** Seconds one free-form answer may take. */
export const PERSONA_TIMEOUT_S = 120;

/** What a free-form source gives the adapter: the answer's text (null when the model gave none), or the termination that ends the cell. */
export type PersonaAnswer = { text: string | null } | { stop: Termination };

export function personaPrompt(persona: string, question: string): string {
  return [
    "You are playing the user in a session with an AI coding assistant. Stay in character as this user:",
    "",
    "<persona>",
    persona.trim(),
    "</persona>",
    "",
    "The assistant asks you:",
    "",
    "<question>",
    question.trim(),
    "</question>",
    "",
    "Reply as this user, in one to three plain sentences. Answer only what was asked; when it lists options, say which one you want.",
  ].join("\n");
}

/** The answer one free-form request's termination and last turn give. */
export function personaAnswer(termination: Termination, text: string | undefined): PersonaAnswer {
  if (termination.kind === "completed") return { text: text?.trim() ? text.trim() : null };
  if (termination.kind === "cap_stop" || termination.kind === "credentials_rejected" || termination.kind === "missing") return { stop: termination };
  return { stop: { kind: "missing", code: "E_USERSIM" } };
}
