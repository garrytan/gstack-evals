// Copyright (c) 2026 Garry Tan. MIT License.
// One part R row per Lane B trial dir run by the Codex agent (quick/laneb/runner/agent/laneb_codex.py): config.json,
// result.json, the agent's evaluator records (laneb-summary.json, init.json, questions.json, codex-events.jsonl, the copied
// rollouts in codex-sessions/) and the metering proxy's session rows. The outcome follows section 4.7 (B1's rules): a session
// is graded when it has a verifier reward, a model response reached the agent and its rollout was copied out; a ledger cap
// stop is a cap stop; a session that hit its $5 allowance or the task's agent time limit is a limit stop, graded on what it
// left; anything else is infrastructure. Section 10 of pre-run change 1: the root thread's model and Codex version come from
// its rollout (turn_context.model, session_meta.cli_version), and a root thread on another model or version is an
// infrastructure gap; sub-agents on another model are counted. The load fields come from detect.ts (section 4.5 and 4.6), and an
// allowance stop says whether the proxy refused a reservation before the session spent $5 or its spend reached $5. The
// destructive-command check's denies and r-none's read audit (calls naming gstack or skill paths, and whether any skill text
// arrived) come from the rollout too.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { readSessionRows, sessionsByTrial, type SessionRow } from "../../../quick/laneb/analysis/analyze.ts";
import { detect, readHookLog, readSkillLines, whyNoLoad, type HookRead, type Reason, type SkillLoad } from "./detect.ts";
import { AGENT, CODEX, isArm, MODEL, R, R_EFFORT, type RArm } from "./pins.ts";

export type Thread = { file: string; id: string | null; cli_version: string | null; models: string[]; efforts: string[]; parent: string | null };
export type RRow = {
  schema: "codex-r-session/1";
  part: string | null;
  arm: RArm;
  task: string;
  trial: string;
  outcome: "graded" | "cap_stop" | "infra";
  reason: string;
  pass: boolean;
  reward: number | null;
  limit_stop: "allowance" | "time" | null;
  allowance: "reservation" | "spend" | null;
  cost_usd: number | null;
  tokens: number | null;
  wall_s: number | null;
  questions: number;
  resumes: number;
  safety_stop: boolean;
  root: Thread | null;
  sub_agents: { count: number; other_models: string[] };
  init: { model: string | null; reasoning_effort: string | null; codex_version: string | null; hook_trust: boolean | null; switches: Record<string, string | null> | null } | null;
  loads: { prove_it: SkillLoad; verify: SkillLoad; steps_arrived: boolean; named_in_text: boolean; line_delivered: boolean; hook: HookRead; why_no_load: Reason | null } | null;
  destructive: { denies: number; codex_rejects: number } | null;
  read_audit: { calls: number; skill_text: boolean } | null;
};

let SKILLS: ReturnType<typeof readSkillLines> | null = null;
export type RTableConfig = { jobs: { dir: string; part?: string }[]; sessions: string[] };

const readJson = (p: string) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };
const walk = (d: string): string[] => (existsSync(d) ? readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)])) : []);

/** One rollout file's thread: its id, Codex version, parent (a sub-agent's) and every model and effort its turns ran. */
export function readThread(file: string): Thread {
  const t: Thread = { file, id: null, cli_version: null, models: [], efforts: [], parent: null };
  for (const line of readFileSync(file, "utf8").split("\n")) {
    let d: any;
    try { d = JSON.parse(line); } catch { continue; }
    const p = d?.payload ?? {};
    if (d?.type === "session_meta" && t.id === null) { t.id = p.id ?? null; t.cli_version = p.cli_version ?? null; t.parent = p.parent_thread_id ?? p.forked_from_id ?? null; }
    if (d?.type === "turn_context") {
      if (typeof p.model === "string" && !t.models.includes(p.model)) t.models.push(p.model);
      if (typeof p.effort === "string" && !t.efforts.includes(p.effort)) t.efforts.push(p.effort);
    }
  }
  return t;
}

const SAFETY = /content[ _-]?(?:filter|policy)|safety|refus/i;
/** Whether Codex's event stream shows a provider safety stop: a failed turn or an error naming a content filter, policy,
 *  safety system or refusal. Its outcome class stays as section 4.7 gives it; the report counts these on their own line. */
export function safetyStop(events: string): boolean {
  return events.split("\n").some((l) => { try { const e = JSON.parse(l); return (e.type === "turn.failed" || e.type === "error") && SAFETY.test(JSON.stringify(e)); } catch { return false; } });
}

export function rRow(dir: string, ctx: { part: string | null; sessions: Map<string, SessionRow[]> }): RRow | null {
  const config = readJson(join(dir, "config.json"));
  if (!config || config.agent?.name !== AGENT.name) return null;
  const result = readJson(join(dir, "result.json"));
  const kwargs = config.agent.kwargs ?? {};
  const arm = String(kwargs.arm ?? "");
  if (!isArm(arm)) throw new Error("E_CODEX_R_TABLE " + dir + " has arm " + JSON.stringify(kwargs.arm) + ", not one of part R's");
  const task = String(config.task?.path ?? result?.task_name ?? "").split("/").filter(Boolean).at(-1) ?? "?";
  const trial = String(result?.trial_name ?? dir.split("/").filter(Boolean).at(-1));
  const ev = join(dir, "evaluator"), summary = readJson(join(ev, "laneb-summary.json"));
  const rows = ctx.sessions.get(trial) ?? [];
  const last = rows.at(-1);
  const responded = last ? (last.ok_responses ?? 0) > 0 : (summary?.session?.ok_responses ?? 0) > 0;
  const exc = result?.exception_info?.exception_type ?? null;
  const rewards = result?.verifier_result?.rewards;
  const keys = rewards && typeof rewards === "object" ? Object.keys(rewards) : [];
  const v = keys.includes("reward") ? rewards.reward : keys.length === 1 ? rewards[keys[0]!] : undefined;
  const raw = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  const reward = result && Number.isFinite(raw) ? raw : null;
  const limit: RRow["limit_stop"] = (last?.refused_budget ?? 0) > 0 ? "allowance" : exc === "AgentTimeoutError" ? "time" : null;
  const threads = walk(join(ev, "codex-sessions")).filter((f) => /rollout-.*\.jsonl$/.test(f)).sort().map(readThread);
  const rootId: string | null = summary?.result?.thread_id ?? null;
  const root = threads.find((t) => rootId !== null && t.id === rootId) ?? (rootId === null ? threads.find((t) => t.parent === null) ?? null : null);
  const subs = threads.filter((t) => t !== root);
  const offRoot = root && (root.cli_version !== CODEX.version || root.models.some((m) => m !== MODEL) || root.efforts.some((e) => e !== R_EFFORT));
  let outcome: RRow["outcome"] = "infra";
  let reason: string;
  if (exc === "LedgerCapStop") { outcome = "cap_stop"; reason = "ledger cap stop"; }
  else if (!result) reason = "no result.json";
  else if (!responded) reason = "no model response reached the agent" + (exc ? " (" + exc + ")" : "");
  else if (!root) reason = "no rollout copied out for the root thread";
  else if (offRoot) reason = "root thread on " + root.models.join("/") + " at " + root.efforts.join("/") + " in Codex " + root.cli_version + ", not " + MODEL + " at " + R_EFFORT + " in " + CODEX.version;
  else if (reward === null) reason = "no verifier reward, verifier infrastructure error" + (limit ? " (" + limit + " limit stop)" : exc ? " (" + exc + ")" : "");
  else { outcome = "graded"; reason = limit ? limit + " limit stop, graded on what it left" : exc ? exc + ", graded on the shipped diff" : "graded"; }
  const det = threads.length ? detect(ev, (SKILLS ??= readSkillLines())) : null;
  const hook = det ? readHookLog(ev, root?.id ?? det.root) : null;
  const cost_usd = rows.length ? rows.reduce((x, r) => x + (r.spent_micros ?? 0), 0) / 1e6 : null;
  const usage = summary?.session?.usage;
  const init = readJson(join(ev, "init.json"));
  const events = existsSync(join(ev, "codex-events.jsonl")) ? readFileSync(join(ev, "codex-events.jsonl"), "utf8") : "";
  return {
    schema: "codex-r-session/1", part: ctx.part, arm, task, trial, outcome, reason,
    pass: outcome === "graded" && reward !== null && reward >= 1, reward, limit_stop: limit,
    allowance: limit === "allowance" ? ((cost_usd ?? 0) >= R.allowanceUsd ? "spend" : "reservation") : null,
    cost_usd,
    tokens: usage ? ["input_tokens", "cache_creation_input_tokens", "cache_creation_1h_input_tokens", "cache_read_input_tokens", "output_tokens"].reduce((x, k) => x + (Number(usage[k]) || 0), 0) : null,
    wall_s: typeof summary?.wall_s === "number" ? summary.wall_s : null,
    questions: Number(summary?.result?.questions ?? 0), resumes: Number(summary?.result?.resumes ?? 0),
    safety_stop: safetyStop(events), root,
    sub_agents: { count: subs.length, other_models: [...new Set(subs.flatMap((t) => t.models).filter((m) => m !== MODEL))] },
    init: init ? { model: init.model ?? null, reasoning_effort: init.reasoning_effort ?? null, codex_version: init.codex_version ?? null, hook_trust: init.hook_trust ?? null, switches: init.switches ?? null } : null,
    destructive: det ? det.guard : null,
    read_audit: det && arm === "r-none" ? { calls: det.audit.calls, skill_text: Object.values(det.loads).some((l) => l.loaded || l.b_excluded > 0) } : null,
    loads: det && hook ? { prove_it: det.loads["prove-it"], verify: det.loads["gstack-verify"], steps_arrived: det.steps_arrived, named_in_text: det.named_in_text, line_delivered: det.line_delivered, hook, why_no_load: arm === "r-on" ? whyNoLoad(det, hook) : null } : null,
  };
}

export function buildRTable(cfg: RTableConfig): RRow[] {
  if (!Array.isArray(cfg.jobs) || !cfg.jobs.length) throw new Error("E_USAGE codex-hooks r table: the config needs jobs, each {dir, part}");
  if (!Array.isArray(cfg.sessions)) throw new Error("E_USAGE codex-hooks r table: the config needs sessions, the proxy-sessions.jsonl files of the runs in jobs");
  const sessions = sessionsByTrial(readSessionRows(cfg.sessions));
  const out: RRow[] = [];
  for (const job of cfg.jobs) for (const name of readdirSync(job.dir).sort()) {
    const d = join(job.dir, name);
    if (!statSync(d).isDirectory()) continue;
    const row = rRow(d, { part: job.part ?? null, sessions });
    if (row) out.push(row);
  }
  return out;
}

/** A pulled part dir's Harbor jobs and its proxy's session rows, as buildRTable takes them. */
export function pulledInputs(pulled: string, part: string): RTableConfig {
  const d = join(pulled, "jobs"), s = join(pulled, "out/proxy-sessions.jsonl");
  return { jobs: existsSync(d) ? readdirSync(d).filter((j) => statSync(join(d, j)).isDirectory()).map((j) => ({ dir: join(d, j), part })) : [], sessions: existsSync(s) ? [s] : [] };
}
