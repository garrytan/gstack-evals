// The skill-eval call resolved into what a run uses (interface v0.4, "Call"), with effective defaults: every setting
// the caller did not give is filled from the flag table's default or its rule, and printed with where it came from.
// resolveCall parses and resolves; preflight (preflight.ts) checks models, keys, the ledger, the lock and vacuity.
//
// The default <out> (U7, brief item 2): <state>/runs/<run id>, where <state> is ~/.capy/work/gstack-evals on a Capy
// machine (when XDG_STATE_HOME is unset) and $XDG_STATE_HOME/gstack-evals otherwise (~/.local/state/gstack-evals when
// that is unset too). The same rule places the local ledger. A run directory holds transcripts, so it is never the OS
// temp dir (wiped on a Capy wake) and never inside the tasks repo (where transcripts could be committed).
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { availableParallelism, homedir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { ledgerPath, recordPath, type Resolved } from "../../runner/ledger/paths.ts";
import { parseUsd } from "../../runner/ledger/money.ts";
import type { Host } from "../../types.ts";
import { resolveArms, type ResolvedArms } from "./arms.ts";
import { unbuiltFlags, type ParsedFlags } from "./flags.ts";
import { DEFAULT_POLICY, loadPolicy, providerOf, type LoadedPolicy, type PolicyProvider } from "./policy.ts";

/** The providers whose models each host runs: Claude Code runs Anthropic models; Codex runs OpenAI and OpenAI-compatible (OpenRouter) ones. */
export const HOST_PROVIDERS: Record<Host, readonly PolicyProvider[]> = { claude: ["anthropic"], codex: ["openai", "openrouter"] };

export interface Setting {
  name: string;
  value: string;
  /** "default", "flag", a variable's name, "inferred ..." or "policy default". */
  source: string;
}

export interface Call {
  tasks: string;
  ext: string | null;
  host: Host;
  models: string[];
  trials: number;
  /** Micro-dollars; null when --spend-cap was not given. */
  spendCap: number | null;
  dryRun: boolean;
  tasksOnly: string[] | null;
  /** The resolved arms, before2 included when the noise floor is on, in the order before, before2, after, none, placebo, bare. */
  arms: ResolvedArms;
  noiseFloor: boolean;
  policy: LoadedPolicy;
  smoke: boolean;
  judgeModel: string;
  usersimModel: string;
  isolation: "docker" | "process";
  parallel: number;
  timeoutS: number;
  margin: number | null;
  ledger: Resolved;
  record: Resolved;
  item: string | null;
  out: Resolved;
  json: boolean;
  runId: string;
  effective: Setting[];
}

export type CallError = { code: "E_USAGE" | "E_LOOSE_GSTACK" | "E_MODEL_POLICY"; message: string; fix?: string };

type Env = Record<string, string | undefined>;

/** Where run directories go: the Capy work dir on a Capy machine, else the XDG state dir. */
export function runsRoot(env: Env = process.env, home = homedir()): Resolved {
  if (!env.XDG_STATE_HOME && existsSync(join(home, ".capy", "work"))) return { path: join(home, ".capy", "work", "gstack-evals", "runs"), rule: "~/.capy/work/gstack-evals/runs, the Capy default" };
  if (env.XDG_STATE_HOME) return { path: join(env.XDG_STATE_HOME, "gstack-evals", "runs"), rule: "$XDG_STATE_HOME/gstack-evals/runs" };
  return { path: join(home, ".local", "state", "gstack-evals", "runs"), rule: "~/.local/state/gstack-evals/runs, the XDG default" };
}

export function newRunId(label: string, now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) + "-" + stamp + "-" + randomBytes(2).toString("hex");
}

const show = (path: string) => {
  const rel = relative(process.cwd(), path);
  return rel && !rel.startsWith("..") ? rel : path;
};

export function resolveCall(parsed: ParsedFlags, env: Env = process.env, home = homedir()): Call | CallError {
  const v = parsed.values;
  const usage = (message: string, fix?: string): CallError => ({ code: "E_USAGE", message, ...(fix ? { fix } : {}) });
  const unbuilt = unbuiltFlags(parsed);
  if (unbuilt.length) return usage(unbuilt.map((f) => f.name + " is not built yet (" + f.owner + ")").join("; "));
  for (const name of ["--arms", "--tasks", "--host", "--model"]) if (!v.has(name)) return usage("skill-eval needs " + name + "; gstack-evals skill-eval --help shows the call");
  const effective: Setting[] = [];
  const from = (name: string, fallback = "default") => (v.has(name) ? (parsed.from.get(name) === "flag" ? "flag" : parsed.from.get(name)!) : fallback);
  const set = (name: string, value: string, source: string) => effective.push({ name, value, source });

  const tasks = resolve(v.get("--tasks") as string);
  const host = v.get("--host") as Host;
  const models = v.get("--model") as string[];
  if (new Set(models).size !== models.length) return usage("--model names a model twice");
  const tasksOnly = (v.get("--tasks-only") as string[] | undefined) ?? null;

  const arms = resolveArms(v.get("--arms") as string[], { base: v.get("--base") as string | undefined, skill: v.get("--skill") as string | undefined }, home);
  if ("code" in arms) return arms;
  const noiseFloor = !v.has("--no-noise-floor");
  if (noiseFloor) {
    const before = arms.arms.find((a) => a.name === "before")!;
    arms.arms.splice(1, 0, { ...before, name: "before2" });
  }

  const policyPath = v.has("--policy") ? resolve(v.get("--policy") as string) : DEFAULT_POLICY;
  const policy = loadPolicy(policyPath);
  if ("problem" in policy) return { code: "E_MODEL_POLICY", message: policy.problem };
  const provider = providerOf(policy, models[0]!) ?? HOST_PROVIDERS[host][0]!;
  const judge = (v.get("--judge-model") as string | undefined) ?? policy.policy.defaults.judge[provider];

  const capText = v.get("--spend-cap") as string | undefined;
  const spendCap = capText === undefined ? null : parseUsd(capText);
  if (capText !== undefined && spendCap === null) return usage("--spend-cap takes a dollar amount under $1 billion with at most six decimals");

  const trials = (v.get("--trials") as number | undefined) ?? 3;
  const parallel = (v.get("--parallel") as number | undefined) ?? Math.min(4, availableParallelism());
  const timeoutS = (v.get("--timeout") as number | undefined) ?? 600;
  const isolation = ((v.get("--isolation") as string | undefined) ?? "docker") as "docker" | "process";
  const item = (v.get("--item") as string | undefined) ?? null;
  const ledger = ledgerPath(parsed.from.get("--ledger") === "flag" ? (v.get("--ledger") as string) : undefined, env, home);
  const record = recordPath(parsed.from.get("--ledger-record") === "flag" ? (v.get("--ledger-record") as string) : undefined, env, home);
  const runId = newRunId(arms.skill?.name ?? basename(dirname(tasks)));
  const root = runsRoot(env, home);
  const out: Resolved = v.has("--out") ? { path: resolve(v.get("--out") as string), rule: "--out" } : { path: join(root.path, runId), rule: root.rule };

  set("tasks", show(tasks), "flag");
  set("host", host + " (runs " + HOST_PROVIDERS[host].join(" and ") + " models)", "flag");
  set("models", models.join(", "), "flag");
  set("trials", String(trials), from("--trials"));
  set("noise floor", noiseFloor ? "on: before2 runs a second copy of before" : "off", noiseFloor ? "default; --no-noise-floor drops it" : "flag");
  set("arms", arms.arms.map((a) => a.name).join(", "), "flag");
  set("base", arms.base ? arms.base.ref.repo + "@" + arms.base.ref.sha : "none: arms are loose folders", arms.base?.source ?? "default");
  set("skill", arms.skill?.name ?? "none", arms.skill?.source ?? "default");
  for (const note of arms.notes) set("note", note, "inferred");
  set("policy", show(policy.path) + " sha256 " + policy.sha256.slice(0, 12), from("--policy"));
  set("judge model", judge + " (used only by tasks with a judge rubric)", v.has("--judge-model") ? "flag" : "policy default for " + provider + " subjects");
  set("usersim model", policy.policy.defaults.usersim + " (free-form answers for interactive tasks)", "policy default");
  set("smoke", v.has("--smoke") ? "on" : "off", from("--smoke"));
  set("isolation", isolation, from("--isolation"));
  set("parallel", String(parallel), from("--parallel", "default: min(4, available parallelism)"));
  set("timeout", timeoutS + " s per session; a sidecar timeout_s overrides it per task", from("--timeout"));
  set("margin", v.has("--margin") ? v.get("--margin") + " points" : "none (no non-inferiority claim)", from("--margin"));
  set("spend cap", capText === undefined ? "none" : "$" + capText, from("--spend-cap"));
  set("line item", item ?? "none", from("--item"));
  set("ledger", ledger.path, ledger.rule);
  set("ledger record", record.path, record.rule);
  set("out", out.path, out.rule === "--out" ? "flag" : "default: " + out.rule);

  return {
    tasks,
    ext: v.has("--ext") ? resolve(v.get("--ext") as string) : null,
    host,
    models,
    trials,
    spendCap,
    dryRun: v.has("--dry-run"),
    tasksOnly,
    arms,
    noiseFloor,
    policy,
    smoke: v.has("--smoke"),
    judgeModel: judge,
    usersimModel: policy.policy.defaults.usersim,
    isolation,
    parallel,
    timeoutS,
    margin: (v.get("--margin") as number | undefined) ?? null,
    ledger,
    record,
    item,
    out,
    json: v.has("--json"),
    runId,
    effective,
  };
}

export function effectiveLines(call: Pick<Call, "effective">): string[] {
  const width = Math.max(...call.effective.map((s) => s.name.length));
  return ["effective:", ...call.effective.map((s) => "  " + s.name.padEnd(width) + "  " + s.value + " (" + s.source + ")")];
}

export const SKILL_EVAL_HELP = [
  "Usage: gstack-evals skill-eval --arms before=<dir>,after=<dir>,none --tasks <tasks.json>",
  "                               --host claude|codex --model <id> --trials 3 --spend-cap <usd> --out <dir> [options]",
  "       gstack-evals skill-eval --example[=miss|safety|unopened|not-measurable|cap-stop]",
  "       gstack-evals skill-eval --lock --tasks <tasks.json> [--ext <file>] [--before <dir>] [--policy <file>]",
  "       gstack-evals skill-eval init --skill <dir> [--out <tasks.json>] [--force]",
  "",
  "Options:",
].join("\n");

