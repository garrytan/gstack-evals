// R3's per-trial record (GEVA-101 prereg, sections 4.3, 4.5 and 4.8): the exposure export. One record per Harbor trial,
// carrying what the admission rule and the procedure gate read, and the model and route the trial ran on.
//
// Graded (GSTA-2 ruling for the R3 amendment): a trial is graded only when it has a verifier reward and a model response
// reached the agent (the proxy's last session row for the trial has ok_responses > 0; with no row, the SDK message log
// holds an assistant message). Anything else is infra. Otherwise the outcome is the tag's: reward 1 passes.
// Opened /investigate (GSTA-2 ruling): the proxy saw the slash command expand in the session's first request, or the agent
// opened the file itself (Skill tool, Read or cat, analyze.ts skillOpensFromMessages). Both signals are kept apart.
// The procedure shows when the agent's text (assistant text blocks and the result) matches GEVA-100's tb2_expo.py
// patterns: DEBUG REPORT or a Phase 1 to Phase 5 heading. Only booleans are exported, never transcript text.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { sessionsByTrial, skillOpensFromMessages, type SessionRow, type Trial } from "../analysis/analyze.ts";

export const GATE_SKILL = "investigate";
export const GATE_PATTERNS = { debug_report: /DEBUG REPORT/, phase: /Phase [1-5]/ };

type Row = SessionRow & { ok_responses: number; cmd_names?: string[] | null; cmd_expanded?: boolean | null };
export type ProxyConfig = { models: Record<string, { route: string; upstream_model: string }> };

export type R3Trial = {
  task: string; arm: string; model: string; route: string | null; upstream_model: string | null; trial: string;
  outcome: "pass" | "fail" | "infra"; reason: string; reward: number | null; model_responded: boolean; exception: string | null; cap_stop: boolean;
  cost_usd: number | null; attempts: number; requests: number; refused: number; budget_stop: boolean; agent_timeout: boolean; wall_s: number | null;
  told_skill: string | null; cmd_expanded: boolean | null; cmd_names: string[]; skill_opens: string[];
  body_loaded: boolean; investigate_opened: boolean; gate: { debug_report: boolean; phase: boolean }; procedure_shown: boolean; exposed: boolean;
};

const parseJson = (text: string | null): any => { try { return text === null ? null : JSON.parse(text); } catch { return null; } };
const readJson = (path: string): any => { try { return parseJson(readFileSync(path, "utf8")); } catch { return null; } };

export function agentText(lines: string[]): string {
  const texts: string[] = [];
  let result = "";
  for (const line of lines) {
    let rec: any;
    try { rec = JSON.parse(line); } catch { continue; }
    if (rec.type === "AssistantMessage" && Array.isArray(rec.content)) for (const b of rec.content) { if (b && typeof b.text === "string") texts.push(b.text); }
    else if (rec.type === "ResultMessage" && typeof rec.result === "string") result = rec.result;
  }
  return texts.join("\n") + "\n" + result;
}

// A trial directory whose config.json names the Lane B agent is a trial: with no readable result.json it has no reward,
// so it is infra. A directory with no readable config.json can't be attributed and gives null; the screen counts its
// task as missing. The route check passes in the config.json and result.json it read itself (route-check.ts judge), so
// those files are read once and a read that fails on our machine is never taken here for a missing file.
export function loadR3Trial(dir: string, sessions: Map<string, SessionRow[]>, proxy: ProxyConfig, files?: { config: string; result: string | null }): R3Trial | null {
  const config = files ? parseJson(files.config) : readJson(join(dir, "config.json"));
  if (!config || config.agent?.name !== "laneb-claude-code") return null;
  const resultJson = files ? parseJson(files.result) : readJson(join(dir, "result.json"));
  const result = resultJson ?? {};
  const kwargs = config.agent.kwargs ?? {};
  const task = String(config.task?.path ?? result.task_name ?? "").split("/").filter(Boolean).at(-1) ?? "?";
  const trial = String(result.trial_name ?? dir.split("/").filter(Boolean).at(-1));
  const model = String(kwargs.upstream_model ?? "?");
  const msgsPath = join(dir, "evaluator", "sdk-messages.jsonl");
  const lines = existsSync(msgsPath) ? readFileSync(msgsPath, "utf8").split("\n") : [];
  const summary = readJson(join(dir, "evaluator", "laneb-summary.json"));
  const rows = (sessions.get(trial) ?? []) as Row[];
  const last = rows.at(-1);
  const assistant = lines.some((l) => { try { return JSON.parse(l).type === "AssistantMessage"; } catch { return false; } });
  const modelResponded = last ? (last.ok_responses ?? 0) > 0 : assistant;
  const exc = result.exception_info?.exception_type ?? null;
  const raw = Number(result.verifier_result?.rewards?.reward ?? Object.values(result.verifier_result?.rewards ?? {})[0]);
  const reward = Number.isFinite(raw) ? raw : null;
  const budgetStop = (last?.refused_budget ?? 0) > 0;
  const agentTimeout = exc === "AgentTimeoutError";
  let outcome: R3Trial["outcome"] = "infra";
  let reason: string;
  if (!resultJson) reason = "no result.json";
  else if (reward === null) reason = exc ? `${exc}: ${String(result.exception_info?.exception_message ?? "").slice(0, 160)}` : "no verifier reward";
  else if (!modelResponded) reason = `no model response reached the agent${exc ? ` (${exc})` : ""}, reward ${reward} not graded`;
  else {
    outcome = reward >= 1 ? "pass" : "fail";
    reason = agentTimeout ? "agent timeout, graded" : budgetStop ? "session budget stop, graded" : exc ? `${exc}, graded` : "graded";
  }
  const toldSkill = typeof kwargs.told_skill === "string" && kwargs.told_skill ? kwargs.told_skill : null;
  const cmdNames = last?.cmd_names ?? [];
  const skillOpens = skillOpensFromMessages(lines);
  const text = agentText(lines);
  const gate = { debug_report: GATE_PATTERNS.debug_report.test(text), phase: GATE_PATTERNS.phase.test(text) };
  const investigateOpened = cmdNames.includes(GATE_SKILL) || skillOpens.includes(GATE_SKILL);
  const procedureShown = gate.debug_report || gate.phase;
  return {
    task, arm: String(kwargs.arm ?? "?"), model, route: proxy.models[model]?.route ?? null, upstream_model: proxy.models[model]?.upstream_model ?? null, trial,
    outcome, reason, reward, model_responded: modelResponded, exception: exc, cap_stop: exc === "LedgerCapStop",
    cost_usd: rows.length ? rows.reduce((x, r) => x + (r.spent_micros ?? 0), 0) / 1e6 : null, attempts: rows.length,
    requests: last?.requests ?? 0, refused: last?.refused ?? 0, budget_stop: budgetStop, agent_timeout: agentTimeout, wall_s: typeof summary?.wall_s === "number" ? summary.wall_s : null,
    told_skill: toldSkill, cmd_expanded: last?.cmd_expanded ?? null, cmd_names: cmdNames, skill_opens: skillOpens,
    body_loaded: toldSkill !== null && cmdNames.includes(toldSkill), investigate_opened: investigateOpened, gate, procedure_shown: procedureShown,
    exposed: investigateOpened && procedureShown,
  };
}

export function loadR3Jobs(jobsDir: string, sessionRows: SessionRow[], proxy: ProxyConfig): R3Trial[] {
  const sessions = sessionsByTrial(sessionRows);
  const out: R3Trial[] = [];
  for (const job of readdirSync(jobsDir).sort()) {
    const jd = join(jobsDir, job);
    if (!statSync(jd).isDirectory()) continue;
    for (const name of readdirSync(jd).sort()) {
      const d = join(jd, name);
      if (!statSync(d).isDirectory()) continue;
      const t = loadR3Trial(d, sessions, proxy);
      if (t) out.push(t);
    }
  }
  return out;
}

// The record as analyze()'s Trial. Every R3 trial has noReward false: a trial with no reward is infra, as at the tag.
export function toTrial(t: R3Trial): Trial {
  return {
    task: t.task, arm: t.arm, model: t.model, trialName: t.trial, outcome: t.outcome, reason: t.reason, noReward: false, modelResponded: t.model_responded,
    costUsd: t.cost_usd, attempts: t.attempts, requests: t.requests, refused: t.refused, skillOpens: t.skill_opens, budgetStop: t.budget_stop,
    agentTimeout: t.agent_timeout, wallS: t.wall_s,
  };
}
