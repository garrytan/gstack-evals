// Copyright (c) 2026 Garry Tan. MIT License.
// The review replay plan (plan v3.2, "Review replay lane", requirement 4): the frozen items a replay runs, checked before
// any spend. Paths are relative to the plan file. A plan states its cut-off rule; there is no default (GSTA-11 rerun
// precondition 3).
//
//   {schema_version: 1, name, prereg: {path, sha256}, max_output_tokens, cut_off: {min_visible_chars},
//    items: [{id, case, role, arm, model, effort, trial, prompt: {path, sha256}}]}
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { ReasonCode } from "../../src/errors/codes.ts";
import { loadPolicy, modelProblem, providerOf, type PolicyProvider } from "../../src/skill-eval/cli/policy.ts";

export const REPLAY_ROLES = ["specialist", "red-team", "fix-check"] as const;

export interface FrozenFile {
  path: string;
  sha256: string;
}

export interface PlanItem {
  id: string;
  case: string;
  role: (typeof REPLAY_ROLES)[number];
  arm: string;
  /** A model id in the policy file. */
  model: string;
  effort: string | null;
  trial: number;
  prompt: FrozenFile;
}

export interface ReplayPlan {
  schema_version: 1;
  name: string;
  prereg: FrozenFile;
  max_output_tokens: number;
  /** A cut-off reply with fewer visible characters than this is an empty response. */
  cut_off: { min_visible_chars: number };
  items: PlanItem[];
}

export interface LoadedPlan {
  plan: ReplayPlan;
  sha256: string;
  /** Each item's prompt text, by item id, read once and checked against its digest. */
  prompts: Map<string, string>;
}

/** A refusal or a stop with the reason code it prints. */
export class ReplayError extends Error {
  constructor(
    readonly code: ReasonCode,
    message: string,
  ) {
    super(message);
  }
}

export const KEY_ENV: Record<PolicyProvider, string> = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY", openrouter: "OPENROUTER_API_KEY" };

export const sha256 = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";
const count = (v: unknown, min: number) => Number.isSafeInteger(v) && (v as number) >= min;
const frozen = (v: unknown) => isObject(v) && text(v.path) && typeof v.sha256 === "string" && /^[0-9a-f]{64}$/.test(v.sha256);

/** Problems in a parsed plan; empty when it fits the shape above. */
export function planProblems(v: unknown): string[] {
  if (!isObject(v)) return ["must be a JSON object {schema_version, name, prereg, max_output_tokens, cut_off, items}"];
  const problems: string[] = [];
  if (v.schema_version !== 1) problems.push("schema_version must be 1");
  if (!text(v.name)) problems.push("name must be a non-empty string");
  if (!frozen(v.prereg)) problems.push("prereg must be {path, sha256} with a hex sha256");
  if (!count(v.max_output_tokens, 1)) problems.push("max_output_tokens must be a positive integer");
  if (!isObject(v.cut_off) || !count(v.cut_off.min_visible_chars, 0)) problems.push("cut_off must state {min_visible_chars}; a plan preregisters its cut-off rule and there is no default");
  if (!Array.isArray(v.items) || !v.items.length) return [...problems, "items must be a non-empty list"];
  const seen = new Set<string>();
  v.items.forEach((item, i) => {
    const at = "items[" + i + "]";
    if (!isObject(item)) return void problems.push(at + " must be an object");
    for (const key of ["id", "case", "arm", "model"]) if (!text(item[key])) problems.push(at + "." + key + " must be a non-empty string");
    if (text(item.id) && !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(item.id)) problems.push(at + ".id must be letters, digits, _ and -, since it names the item's files");
    if (!REPLAY_ROLES.includes(item.role as PlanItem["role"])) problems.push(at + ".role must be one of " + REPLAY_ROLES.join(", "));
    if (item.effort !== null && !text(item.effort)) problems.push(at + ".effort must be a string or null");
    if (!count(item.trial, 1)) problems.push(at + ".trial must be a positive integer");
    if (!frozen(item.prompt)) problems.push(at + ".prompt must be {path, sha256} with a hex sha256");
    if (text(item.id) && seen.has(item.id)) problems.push(at + ".id " + item.id + " repeats an earlier item id");
    if (text(item.id)) seen.add(item.id);
  });
  return problems;
}

function checkFrozen(dir: string, file: FrozenFile, what: string): Buffer {
  let bytes: Buffer;
  try {
    bytes = readFileSync(resolve(dir, file.path));
  } catch (error) {
    throw new ReplayError("E_REPLAY_PLAN", what + " " + file.path + " cannot be read: " + (error as Error).message);
  }
  const actual = sha256(bytes);
  if (actual !== file.sha256) throw new ReplayError("E_REPLAY_PLAN", what + " " + file.path + " has sha256 " + actual + ", not the frozen " + file.sha256);
  return bytes;
}

/** Reads and checks a plan: its shape, then the preregistration and every prompt against their frozen digests. */
export function loadPlan(path: string): LoadedPlan {
  let bytes: Buffer;
  let parsed: unknown;
  try {
    bytes = readFileSync(path);
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new ReplayError("E_REPLAY_PLAN", "the plan " + path + " cannot be read as JSON: " + (error as Error).message);
  }
  const problems = planProblems(parsed);
  if (problems.length) throw new ReplayError("E_REPLAY_PLAN", "the plan " + path + " is malformed: " + problems.slice(0, 5).join("; "));
  const plan = parsed as ReplayPlan;
  const dir = dirname(resolve(path));
  checkFrozen(dir, plan.prereg, "the preregistration");
  const prompts = new Map(plan.items.map((item) => [item.id, checkFrozen(dir, item.prompt, "item " + item.id + "'s prompt").toString("utf8")]));
  return { plan, sha256: sha256(bytes), prompts };
}

/** Each model's provider, once the policy allows it as a subject and the proxy can route it (modelProblem checks routable); then each provider's key, by name. */
export function checkModels(plan: ReplayPlan, policyPath: string, env: Record<string, string | undefined>): { providers: Map<string, PolicyProvider>; policy_sha256: string } {
  const loaded = loadPolicy(policyPath);
  if ("problem" in loaded) throw new ReplayError("E_MODEL_POLICY", loaded.problem);
  const providers = new Map<string, PolicyProvider>();
  for (const model of new Set(plan.items.map((i) => i.model))) {
    const problem = modelProblem(loaded, model, "subject", { smoke: false });
    if (problem) throw new ReplayError("E_MODEL_POLICY", problem);
    providers.set(model, providerOf(loaded, model)!);
  }
  const missing = [...new Set([...providers.values()].map((p) => KEY_ENV[p]))].filter((name) => !env[name]);
  if (missing.length) throw new ReplayError("E_KEY_MISSING", "the replay needs " + missing.join(" and ") + ", which " + (missing.length > 1 ? "are" : "is") + " not set");
  return { providers, policy_sha256: loaded.sha256 };
}
