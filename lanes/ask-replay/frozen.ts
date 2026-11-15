// Copyright (c) 2026 Garry Tan. MIT License.
// Reads frozen.json, the file that holds every frozen number of the ask replay prereg. A value written as
// TODO(custody:<name>) is filled at freeze; a paid command refuses while one is left (E_ASK_UNFROZEN).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReasonCode } from "../../src/errors/codes.ts";
import type { Arm, ModelKey } from "./types.ts";

export interface ModelRow {
  provider: "anthropic" | "openai" | "openrouter";
  id: string;
  price_row: string;
  arms: Arm[];
  reasoning_effort: string;
  json_schema: boolean;
  data_collection?: "deny";
  /** labeller: runs only the label calls (label.ts), never an arm. */
  role?: "labeller";
}

export interface Frozen {
  schema: number;
  prereg: string;
  question: string;
  decision_table: string[];
  margins: { needless_points: number; must_ask_points: number };
  frontier_models: ModelKey[];
  models: Record<ModelKey, ModelRow>;
  temperature: string;
  caching: { anthropic: string; openai: string; openrouter: string; replicates: string };
  output_cap: { tokens: number; raised_tokens: number; raise_when_smoke_capped_share_above: number };
  replicates: { k: number; k_after_pilot_rule: number };
  window: { chars: number; cut_note: string };
  items: { classes: Record<string, number>; pre_stratum_before: string };
  ledger: { row_text_cap: number; answer_quote_cap: number; id_prefix: string; id_hex: number; strip: string[]; addendum: string };
  retries: { unparsable: number; upstream: number; upstream_backoff_ms: number[]; end_of_run_upstream_redraw_passes: number; resume_redraws: number };
  safety_stop: Record<string, string>;
  missing_ceiling: number;
  stats: { bootstrap_draws: number; bootstrap_seed: number | string; order_seed: number | string; mdd_factor: number; planned_spread: { needless: number; must_ask: number }; planned_items: { needless: number; duplicates: number; must_ask: number }; proxy_effective_clusters: number | string; captain_hears_needless_mdd_above: number };
  pilot: { needless: number; must_ask: number; arms: Record<string, number>; models: ModelKey[]; admit_min_needless_sends: number; admit_max_must_ask_misses: number; k3_when_projected_mdd_above: number; spread_formula: string; draw: string; seed: string };
  label_audit: { items: number; must_ask: number; duplicates: number; permission_and_observable: number; kappa_min: number; labellers: string[]; reasoning_effort: string; seed: string; draw: string };
  labelling: { codebook: string; codebook_sha256: string; kinds: Record<"audit" | "contingency" | "link", { spend_item: string; models: ModelKey[]; classes: string[] | null }>; blind_to: string; primary_when_kappa_fails: string; links: string; answer_judged: string };
  rules_ask_pattern: { pattern: string; flags: string; use: string };
  gstack: { version: string; commit: string; files: Array<{ path: string; sha256: string; bytes: number }> };
  exposure_phrases: string[];
  lettered_decision: string;
  s1: { min_shared_content_words: number };
  privacy: { placeholder: string; jaccard_fail_above: number; jaccard_min_words: number; ngram: number };
  public_scan: { code_pattern: string; code_allow: string[]; agent_notes_heading: string };
  shards: { stop_launching_after_minutes: number; limit_minutes: number; concurrency: number; request_timeout_ms: number };
  smoke: { items: number; per_class: Record<string, number>; seed: number; replicates: number };
  synthetic: { seed: number; items: number; threads: number; sha256: string };
  /** The prereg's spend items (I1 to I8 and the pilot retry) as ledger line item names; one lease serves one run. */
  spend_items: Record<string, string>;
}

export const FROZEN_PATH = join(import.meta.dir, "frozen.json");
export const FROZEN: Frozen = JSON.parse(readFileSync(FROZEN_PATH, "utf8"));

export class AskError extends Error {
  constructor(readonly code: ReasonCode, message: string) {
    super(code + " " + message);
  }
}

export const fail = (code: ReasonCode, message: string): never => {
  throw new AskError(code, message);
};

export const PLACEHOLDER = /^TODO\(custody:[a-z0-9_]+\)$/;

/** Paths in frozen.json whose value is still a TODO(custody:<name>) placeholder. */
export function placeholders(value: unknown = FROZEN, path = ""): string[] {
  if (typeof value === "string") return PLACEHOLDER.test(value) ? [path] : [];
  if (Array.isArray(value)) return value.flatMap((v, i) => placeholders(v, path + "[" + i + "]"));
  if (value && typeof value === "object") return Object.entries(value).flatMap(([k, v]) => placeholders(v, path ? path + "." + k : k));
  return [];
}

/** A frozen seed, or the test seed when the frozen one is still a placeholder and the caller is keyless. */
export function seed(name: "bootstrap_seed" | "order_seed", keyless: boolean): number {
  const v = FROZEN.stats[name];
  if (typeof v === "number") return v;
  if (keyless) return 20261115;
  return fail("E_ASK_UNFROZEN", "frozen.json stats." + name + " is still " + v + "; fill it at freeze before any paid call");
}
