// Copyright (c) 2026 Garry Tan. MIT License.
// The score area's seams: the one model caller every judge, pairwise and probe call goes through. Integration wires the money area's metered client.
import type { Model } from "../types.ts";
import type { Judge } from "./types.ts";

/** One judge call. cacheKey is the call's cache identity: model, prompt digest and packet digest (prereg section 6). */
export interface JudgeCall {
  judge: Judge;
  prompt: string;
  effort: "medium" | "max";
  maxTokens: number;
  /** A label for the ledger and logs, for example "<packet>:astra:1". */
  label: string;
  /** The model under test whose lists the call reads, so a per-model stop cuts only that model; null for model-free calls. */
  subject: Model | null;
  cacheKey: string;
}

/** The reply: text or null, the model id and the version the provider reported, and any problem the client saw. */
export interface JudgeReply {
  text: string | null;
  modelId: string;
  version: string | null;
  problem: string | null;
}

export type JudgeCaller = (call: JudgeCall) => Promise<JudgeReply>;
