// The model policy file (interface v0.4, "Call": --policy). A policy lists the models a run may call and the roles each
// may take: subject (a model under test), judge (the blinded judge for tasks with a judge rubric), adjudicator (blinded
// cross-family adjudication of disputes) and usersim (the user simulator's free-form answers). policy/models.json is the
// default and carries the gstack-evals crews' rules; other projects bring their own with --policy (policy/examples/).
//
//   {schema_version: 1, name, source, models: {<id>: {provider, roles, smoke_only?, refused_because?}},
//    defaults: {judge: {anthropic, openai}, adjudicator: {anthropic, openai}, usersim}}
//
// A model the policy does not list is refused, so a policy allows only what it names (the newest generation of each
// family, in the default). A row with refused_because prints that reason. A smoke_only model runs only with --smoke.
// Every model must also be routable by the metering proxy (a route for its provider and a price row), or its spend could
// not be held against a cap; a policy may list a model before the proxy can route it.
//
// The default gives Sonnet 5.5 the roles of the other current models, judge included (Garry, 2026-10-29). The judge is
// chosen per preregistration; the Opus 5.5 preference is stated in docs/skill-eval.md, not enforced here. A caller's
// own policy sets its own roles.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "../../cli.ts";
import { routable } from "../../runner/proxy/metering-proxy.ts";

export const ROLES = ["subject", "judge", "adjudicator", "usersim"] as const;
export type Role = (typeof ROLES)[number];

export const DEFAULT_POLICY = join(REPO_ROOT, "policy", "models.json");

/** How calls reach a model: openrouter serves OpenAI-compatible routes for the codex host and an Anthropic-compatible Messages route for the claude host. */
export type PolicyProvider = "anthropic" | "openai" | "openrouter";

export interface PolicyModel {
  provider: PolicyProvider;
  roles: Role[];
  smoke_only?: boolean;
  refused_because?: string;
}

export interface ModelPolicy {
  schema_version: 1;
  name: string;
  source: string;
  models: Record<string, PolicyModel>;
  defaults: { judge: Record<PolicyProvider, string>; adjudicator: Record<PolicyProvider, string>; usersim: string };
}

export interface LoadedPolicy {
  path: string;
  sha256: string;
  policy: ModelPolicy;
}

const PROVIDERS: readonly PolicyProvider[] = ["anthropic", "openai", "openrouter"];
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

/** Problems in a parsed policy file; empty when it fits the shape above. */
export function policyProblems(v: unknown): string[] {
  if (!isObject(v)) return ["must be a JSON object {schema_version, name, source, models, defaults}"];
  const problems = Object.keys(v).filter((k) => !["schema_version", "name", "source", "models", "defaults"].includes(k)).map((k) => "unknown key " + k);
  if (v.schema_version !== 1) problems.push("schema_version must be 1");
  for (const key of ["name", "source"]) if (!text(v[key])) problems.push(key + " must be a non-empty string");
  if (!isObject(v.models) || !Object.keys(v.models).length) return [...problems, "models must be an object keyed by model id"];
  for (const [id, m] of Object.entries(v.models)) {
    if (!isObject(m)) {
      problems.push(id + ": must be an object {provider, roles}");
      continue;
    }
    problems.push(...Object.keys(m).filter((k) => !["provider", "roles", "smoke_only", "refused_because"].includes(k)).map((k) => id + ": unknown key " + k));
    if (!PROVIDERS.includes(m.provider as PolicyProvider)) problems.push(id + ": provider must be one of " + PROVIDERS.join(", "));
    if (!Array.isArray(m.roles) || !m.roles.every((r) => ROLES.includes(r as Role)) || new Set(m.roles).size !== m.roles.length) problems.push(id + ": roles must be a list of distinct roles from " + ROLES.join(", "));
    if ("smoke_only" in m && typeof m.smoke_only !== "boolean") problems.push(id + ": smoke_only must be a boolean");
    if ("refused_because" in m && !text(m.refused_because)) problems.push(id + ": refused_because must be a non-empty string");
  }
  const d = v.defaults;
  if (!isObject(d)) return [...problems, "defaults must be an object {judge, adjudicator, usersim}"];
  problems.push(...Object.keys(d).filter((k) => !["judge", "adjudicator", "usersim"].includes(k)).map((k) => "defaults: unknown key " + k));
  for (const role of ["judge", "adjudicator"] as const) {
    const byProvider = d[role];
    if (!isObject(byProvider) || !PROVIDERS.every((p) => text(byProvider[p])) || Object.keys(byProvider).some((p) => !PROVIDERS.includes(p as PolicyProvider))) problems.push("defaults." + role + " must name a model for each of " + PROVIDERS.join(" and "));
  }
  if (!text(d.usersim)) problems.push("defaults.usersim must name a model");
  return problems;
}

export function loadPolicy(path: string): LoadedPolicy | { problem: string } {
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch (error) {
    return { problem: "cannot read the policy file " + path + ": " + (error as Error).message };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    return { problem: "the policy file " + path + " is not valid JSON: " + (error as Error).message };
  }
  const problems = policyProblems(parsed);
  if (problems.length) return { problem: "the policy file " + path + " breaks the policy shape: " + problems.slice(0, 5).join("; ") };
  return { path, sha256: createHash("sha256").update(bytes).digest("hex"), policy: parsed as ModelPolicy };
}

/** Why a model may not take a role under a policy, or null when it may. */
export function modelProblem(loaded: LoadedPolicy, model: string, role: Role, options: { smoke: boolean }): string | null {
  const where = model + " as " + (role === "subject" ? "a model under test" : role === "usersim" ? "the user simulator" : "the " + role);
  const row = loaded.policy.models[model];
  if (!row) {
    const allowed = Object.entries(loaded.policy.models).filter(([, m]) => m.roles.includes(role)).map(([id]) => id);
    return where + ": not in the policy " + loaded.policy.name + " (" + loaded.path + "); it allows " + (allowed.join(", ") || "no model") + " for that role";
  }
  if (row.refused_because) return where + ": refused by the policy " + loaded.policy.name + ": " + row.refused_because;
  if (!row.roles.includes(role)) return where + ": the policy " + loaded.policy.name + " allows it only as " + (row.roles.join(", ") || "nothing");
  if (row.smoke_only && !options.smoke) return where + ": the policy allows it only in smoke runs (--smoke)";
  if (!routable(row.provider, model)) return where + ": the metering proxy has no route or no price row for " + row.provider + ":" + model + ", so its spend could not be held against a cap";
  return null;
}

export const providerOf = (loaded: LoadedPolicy, model: string): PolicyProvider | null => loaded.policy.models[model]?.provider ?? null;
