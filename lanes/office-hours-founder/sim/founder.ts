// Copyright (c) 2026 Garry Tan. MIT License.
// The office-hours founder eval's simulated founder (prereg section 4): the sheet loader, the frozen founder prompt, the
// visible transcript and the metered Gemini 4 Argon call that src/persona-sim/sim.ts runs each founder turn through.
//
// - loadFounder reads a unit's sheet.json and opening.md into a person sheet with FOUNDER_RULES as its rules text. Each
//   fact keeps its id, text and reveal_when; its kind stays off the sheet the simulator reads.
// - visibleTranscript: the advisor's message is every main-agent text block of one reply joined by blank lines, and each
//   founder turn's reply follows the advisor message it answered.
// - founderCall calls Argon on the simulator item's meter: effort medium, temperature 0, seed 20261109 and at most 1,200
//   output tokens; the meter caches replies by request digest. Before each call it refuses the call, as an allowance
//   refusal, when the call's worst case (the proxy's own reservation at 1,200 output tokens) does not fit what is left of
//   the session's allowance. A reply served by anything but Google Vertex (OpenRouter names it Google) is a drift
//   (E_OF_PROVIDER_DRIFT); the meter's own pin check accepts any name starting with Google, Google AI Studio included,
//   so this check is the strict one. A proxy allowance refusal (E_ALLOWANCE) is an allowance refusal; any other failed
//   call is a provider failure. The run side scores an allowance refusal and a check failure as missing and stops the
//   simulator's items on a drift.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chatPrice, openRouterRouting, priceRequest, reservationMicros } from "../../../src/runner/pricing/prices.ts";
import { personTurn, type CallFailure, type PersonSheet, type SimCall, type SimRequest, type VisibleTurn } from "../../../src/persona-sim/sim.ts";
import { MeterError, MODELS, requestBody, type CallRequest, type Meter } from "../../product-value/meter.ts";
import { SEED } from "../frozen.ts";
import type { FounderTurn, Sheet } from "../types.ts";

/** Section 4's frozen prompt; the sheet follows it. */
export const FOUNDER_RULES = [
  "You are playing a startup founder talking with an advisor. Stay in character for the whole conversation. Everything you know about yourself and your startup is in the sheet below: your persona, the opening message you already sent, and your facts. You know nothing else about your startup and nothing about what will happen to it later.",
  "",
  "Rules for every reply:",
  "1. Answer what the advisor's last message asks, in the first person and plain spoken words, in at most 120 words. Ask the advisor nothing, except what they mean when a question is unclear.",
  "2. You may repeat or rephrase anything in your opening message at any time.",
  "3. Each fact on the sheet stays hidden until the advisor asks for it. Reveal a fact only when the advisor's last message asks something its reveal_when line covers. When a question is broad, reveal at most two facts, the ones it covers most directly. Never volunteer a fact the last message did not ask about, even when it seems helpful.",
  "4. When the advisor asks something no fact and no line of your opening message answers, say in one short sentence that you don't know or haven't checked. Never invent a number, customer, conversation, event or plan.",
  "5. Never say what you think the advisor should recommend, and never praise or criticize their advice.",
  "6. When the advisor asks you to confirm a premise, a summary or a document, treat each part of it as a question about that part's subject. Agree, unless a part contradicts your opening message, a fact you have already revealed, or a hidden fact whose reveal_when line covers that subject; then say which part is wrong and state the fact that shows it, which counts as revealed. Rule 3's limit of two hidden facts per reply still holds.",
  "7. At a decision with options, choose the option the advisor marks as recommended, and if none is marked, the first one. Two exceptions: decline any web search, and decline starting another tool, review or skill after this conversation, saying you'll do that later.",
  "8. If the advisor asks you to go and do something before continuing, say you'll do it after this conversation and ask them to go on with what they have.",
  "9. You are building a startup, not a side project, a hobby or an internal project at a company.",
  "10. Never mention the sheet, these rules, fact ids, or that you are playing a role.",
  "",
  "Reply with a JSON object only: {\"reply\": \"<what you say>\", \"revealed\": [\"<fact id>\", ...], \"rules\": [<the rule numbers you applied>]}. List in revealed every hidden fact your reply states or clearly implies, and no other.",
].join("\n");

/** Section 4's call settings for every simulator call. */
export const SIM_CALL = { model: "gemini", effort: "medium", temperature: 0, seed: SEED, maxTokens: 1200 } as const;

/** Names OpenRouter gives Google's Vertex endpoint; Google AI Studio is not one. */
export const VERTEX = /^(google|google vertex|google-vertex)$/i;

export function loadFounder(dir: string, rules: string = FOUNDER_RULES): PersonSheet {
  const sheet = JSON.parse(readFileSync(join(dir, "sheet.json"), "utf8")) as Sheet;
  return { rules, persona: sheet.persona, opening: readFileSync(join(dir, "opening.md"), "utf8").trim(), items: sheet.facts.map((f) => ({ id: f.id, text: f.text, reveal_when: f.reveal_when })) };
}

/** The visible transcript before the next founder turn: each reply's texts, joined by blank lines, then the founder reply that answered it. */
export function visibleTranscript(advisor: readonly (readonly string[])[], founder: readonly FounderTurn[]): VisibleTurn[] {
  if (advisor.length !== founder.length + 1) throw new Error("E_USAGE founder: the next founder turn needs one more advisor reply than founder turns");
  return advisor.flatMap((texts, i): VisibleTurn[] => [{ role: "assistant", text: texts.join("\n\n") }, ...(i < founder.length ? [{ role: "person" as const, text: founder[i]!.reply }] : [])]);
}

const callRequest = (req: SimRequest, label: string): CallRequest => ({ model: SIM_CALL.model, prompt: "", maxTokens: SIM_CALL.maxTokens, effort: SIM_CALL.effort, label, system: req.system, messages: req.messages, temperature: SIM_CALL.temperature, seed: SIM_CALL.seed });

/** A simulator call's worst case in micros, as the metering proxy reserves it. */
export function worstCase(req: SimRequest): number {
  const m = MODELS.gemini;
  const c = callRequest(req, "");
  const body = { ...requestBody(m, c.prompt, c.maxTokens, c.effort, c), provider: openRouterRouting(chatPrice("openrouter:" + m.id)!) };
  return reservationMicros(priceRequest("openrouter", body, SIM_CALL.maxTokens, "/v1/chat/completions"));
}

/** One session's simulator allowance and the spend recorded against it, in micros. founderCall adds each call's spend. */
export interface SimSession {
  allowance_micros: number;
  spent_micros: number;
}

const drift = (detail: string): CallFailure => ({ kind: "call-failed", reason: "drift", detail: "E_OF_PROVIDER_DRIFT " + detail + "; stop the simulator's items and ask the Captain" });

export function founderCall(o: { meter: Pick<Meter, "call">; session: SimSession; label: string }): SimCall {
  return async (req) => {
    const worst = worstCase(req);
    const left = o.session.allowance_micros - o.session.spent_micros;
    if (worst > left) return { kind: "call-failed", reason: "allowance", detail: "the simulator's call needs up to " + worst + " micros and the session's allowance has " + left + " left" };
    let res;
    try {
      res = await o.meter.call(callRequest(req, o.label));
    } catch (e) {
      if (e instanceof MeterError && e.code === "E_PV_PROVIDER_DRIFT") return drift(e.message);
      throw e;
    }
    o.session.spent_micros += res.micros ?? worst;
    if (res.text === null) return { kind: "call-failed", reason: res.status === 402 && res.problem?.startsWith("E_ALLOWANCE") ? "allowance" : "provider", detail: res.problem ?? "HTTP " + res.status };
    if (!VERTEX.test(res.served_by ?? "")) return drift(MODELS.gemini.id + " was served by " + (res.served_by ?? "an unnamed provider") + ", not Google Vertex");
    return { kind: "text", text: res.text };
  };
}

/** The run side's founder turn: the person-sim turn on this eval's sheet, transcript and call. */
export const founderTurn = personTurn;
