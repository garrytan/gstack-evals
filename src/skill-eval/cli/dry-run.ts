// --dry-run (interface v0.4, "Spend and ledger"): the matrix, the worst case in parts, parallelism and a worst-case wall
// time. It spends nothing and needs no key, ledger or lock. Preflight reuses the same plan for E_CAP_TOO_LOW: a spend cap
// below one arm-balanced round (one trial of every task in every arm, for every model) is refused.
//
// The worst case prices every session at its allowance, the most the metering proxy lets one session spend before it
// refuses the next call. An allowance is a token budget priced at the model's list price, uncached input included:
// 1.6M input and 32k output tokens per agent session. The proxy refuses a call whose bound (one token per body byte
// plus the output cap) would take the session past its allowance, so the allowance must hold a session's spend and its
// next request's bound. Replaying GSTA-13's metered office-hours sessions on Opus 5.5, 400k refused 89% to 100% of the
// skill-arm sessions before they finished, and 1.6M ($7.04 a session) refused none. Judges get 200k and 40k per judged
// run, and the user simulator 80k and 5k per interactive session. The rerun stage can rerun every task in every arm
// once, so it doubles the agent, judge and user simulator parts.
import { chatPrice } from "../../runner/pricing/prices.ts";
import { usd } from "../../runner/ledger/money.ts";
import type { Call } from "./call.ts";
import { providerOf } from "./policy.ts";

export interface Allowance {
  input: number;
  output: number;
}

export const SESSION_ALLOWANCE: Allowance = { input: 1_600_000, output: 32_000 };
/**
 * A judge is one request with no tools. The proxy writes its 32,768-token output cap into a request that names none and
 * reserves for it, so the output allowance must cover that cap (a reasoning judge thinks before its one line). The input
 * holds the whole answer (every turn of an interactive task, up to a session's 32,000 output tokens) and the evidence's
 * file lists. Only what the call uses is metered and spent.
 */
export const JUDGE_ALLOWANCE: Allowance = { input: 200_000, output: 40_000 };
export const USERSIM_ALLOWANCE: Allowance = { input: 80_000, output: 5_000 };

/** What the plan needs to know about the tasks the run will use. */
export interface PlanTask {
  id: string;
  judge: boolean;
  interactive: boolean;
  /** The task's agent timeout: its sidecar timeout_s, else --timeout. */
  timeout_s: number;
}

export interface Part {
  name: string;
  sessions: number;
  /** Micro-dollars per session; null when the model has no price row. */
  each: number | null;
  total: number | null;
  detail: string;
}

export interface Plan {
  matrix: string;
  sessions: number;
  parts: Part[];
  /** Micro-dollars; null when a part could not be priced. */
  total: number | null;
  /** One trial of every task in every arm, for every model, at the agent allowance. */
  round: number | null;
  /** Every agent session at its timeout, both rounds and calibration, spread over --parallel slots. */
  worst_wall_s: number;
  /** --calibrate: the parts are the calibration sessions alone. */
  calibrate: boolean;
}

/** A session's allowance at the model's list price, in micro-dollars: $/M tokens is micro-dollars per token. */
export function allowanceMicros(call: Pick<Call, "policy">, model: string, a: Allowance): number | null {
  const provider = providerOf(call.policy, model);
  const price = provider ? chatPrice(provider + ":" + model) : undefined;
  return price ? Math.ceil(a.input * price.input + a.output * price.output) : null;
}

const describe = (model: string, a: Allowance) => model + ": " + a.input / 1000 + "k input + " + a.output / 1000 + "k output tokens at list price";

/** The worst case in parts. With --calibrate it holds only the calibration sessions, and `round` is all of them. */
export function plan(call: Pick<Call, "policy" | "models" | "arms" | "trials" | "parallel" | "timeoutS" | "judgeModel" | "usersimModel"> & Partial<Pick<Call, "calibrate">>, tasks: readonly PlanTask[]): Plan {
  const arms = call.arms.arms.map((a) => a.name);
  const perModel = call.calibrate ? 0 : arms.length * tasks.length * call.trials;
  const parts: Part[] = [];
  const add = (name: string, sessions: number, each: number | null, detail: string) => parts.push({ name, sessions, each, total: each === null ? null : each * sessions, detail });
  for (const model of call.models) {
    const each = allowanceMicros(call, model, SESSION_ALLOWANCE);
    if (!call.calibrate) {
      add("sessions " + model, perModel, each, describe(model, SESSION_ALLOWANCE));
      add("rerun stage " + model, perModel, each, "up to every task in every arm once more, if a task goes red in round 1");
    }
    const calibration = arms.length + 3 + (call.arms.base ? 1 : 0) + (tasks.some((t) => t.interactive) ? 1 : 0);
    add("calibration " + model, calibration, each, "one per arm, plus shell, config, egress, base and user-simulator checks");
  }
  if (!call.calibrate) {
    const judged = tasks.filter((t) => t.judge).length * arms.length * call.trials * call.models.length * 2;
    add("judge " + call.judgeModel, judged, judged ? allowanceMicros(call, call.judgeModel, JUDGE_ALLOWANCE) : 0, judged ? describe(call.judgeModel, JUDGE_ALLOWANCE) + ", both rounds" : "no task has a judge rubric");
    const simulated = tasks.filter((t) => t.interactive).length * arms.length * call.trials * call.models.length * 2;
    add("usersim " + call.usersimModel, simulated, simulated ? allowanceMicros(call, call.usersimModel, USERSIM_ALLOWANCE) : 0, simulated ? describe(call.usersimModel, USERSIM_ALLOWANCE) + " per interactive session, both rounds" : "no interactive task");
  }
  const totals = parts.map((p) => p.total);
  const total = totals.includes(null) ? null : (totals as number[]).reduce((s, x) => s + x, 0);
  const roundParts = call.models.map((m) => allowanceMicros(call, m, SESSION_ALLOWANCE));
  const taskSeconds = call.calibrate ? 0 : tasks.reduce((s, t) => s + t.timeout_s, 0) * arms.length * call.trials * 2;
  const calibrationSeconds = parts.filter((p) => p.name.startsWith("calibration ")).reduce((s, p) => s + p.sessions, 0) * call.timeoutS;
  const longest = call.calibrate ? call.timeoutS : Math.max(call.timeoutS, ...tasks.map((t) => t.timeout_s));
  const models = call.models.length + " model" + (call.models.length > 1 ? "s" : "") + " x " + arms.length + " arms (" + arms.join(", ") + ")";
  return {
    matrix: call.calibrate ? models + ": calibration only (--calibrate), no trial sessions" : models + " x " + tasks.length + " tasks x " + call.trials + " trials = " + perModel * call.models.length + " sessions",
    sessions: perModel * call.models.length,
    parts,
    total,
    round: call.calibrate ? total : roundParts.includes(null) ? null : (roundParts as number[]).reduce((s, x) => s + x * arms.length * tasks.length, 0),
    worst_wall_s: Math.ceil((taskSeconds * call.models.length + calibrationSeconds) / call.parallel) + longest,
    calibrate: call.calibrate === true,
  };
}

export function planLines(p: Plan, parallel: number): string[] {
  const money = (m: number | null) => (m === null ? "unpriced (no price row)" : usd(m));
  const width = Math.max(...p.parts.map((x) => x.name.length));
  return [
    "matrix: " + p.matrix,
    "worst case, each session at its allowance (the proxy refuses a call past it):",
    ...p.parts.map((x) => "  " + x.name.padEnd(width) + "  " + x.sessions + " x " + money(x.each) + " = " + money(x.total) + "  (" + x.detail + ")"),
    "  " + "total".padEnd(width) + "  " + money(p.total),
    (p.calibrate ? "the calibration sessions: " : "one arm-balanced round: ") + money(p.round) + "; a smaller --spend-cap is refused (E_CAP_TOO_LOW)",
    "parallel " + parallel + "; worst-case wall time " + (p.worst_wall_s / 3600).toFixed(1) + " h (" + (p.calibrate ? "every calibration session at its timeout" : "every agent session at its timeout, task timeouts, rerun stage and calibration included; judge calls not counted") + ")",
  ];
}
