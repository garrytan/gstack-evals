// Copyright (c) 2026 Garry Tan. MIT License.
// One B1 row per Lane B trial dir, from config.json, result.json, the SDK log, Claude Code's transcript, the final patch and
// the metering proxy's session rows, through L1's readers (analysis/analyze.ts, l1/probes.ts) and the detector (detect.ts).
// Outcome, as the harness mechanics eval reads it: a trial is graded when it has a verifier reward and a model response
// reached the agent, whatever stopped the session (an allowance stop, a turn cap or a model error after a response scores
// by the verifier's reward on the shipped diff). LedgerCapStop is a cap stop. Anything else is infra: no result, no model
// response, or no verifier reward. The read audit is descriptive: it lists reads of gstack paths and drives outside the
// arm's own files, and changes no outcome, since no tar but gstack-shaped holds a gstack file (sessions.ts checks it).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { readSessionRows, sessionsByTrial, type SessionRow } from "../../quick/laneb/analysis/analyze.ts";
import { parseLog, runProbes, type Rec } from "../../quick/laneb/l1/probes.ts";
import { detect, type Detection } from "./detect.ts";
import { isB1bArm, ROUTING, type B1bArm } from "./b1b-pins.ts";
import { isB1cArm, type B1cArm } from "./b1c-pins.ts";
import { isB1dArm, type B1dArm } from "./b1d-pins.ts";
import { ARM_NAMES, ARM_SOURCES, DESCRIBED_SKILL, isArm, REPO, SKILL, type B1Arm } from "./pins.ts";

export type B1Row = {
  schema: "b1-session/1";
  model: string;
  part: string | null;
  arm: B1Arm | B1bArm | B1cArm | B1dArm;
  task: string;
  trial: string;
  outcome: "graded" | "cap_stop" | "infra";
  reason: string;
  pass: boolean;
  reward: number | null;
  allowance_stop: boolean;
  turn_cap: boolean;
  cost_usd: number | null;
  tokens: number | null;
  /** The step text reached the session: a user record of Claude Code's transcript holds it (a typed expansion or a load). */
  steps_seen: boolean | null;
  /** Skill tool calls naming the arm's own skill (described: test-driven-development; gstack-shaped: prove-it). */
  skill_loads: number;
  /** A provider safety stop: a model turn that stopped for refusal, or an API error naming a content filter or policy. Its
   *  outcome class stays as the outcome rules give it; the report counts these on their own line. */
  safety_stop: boolean;
  /** Reads of gstack paths or a drive, other than the arm's own skill files. Descriptive. */
  audit_hits: string[];
  detect: Detection;
};
export type B1TableConfig = { jobs: { dir: string; part?: string }[]; sessions: string[]; home?: string };

const readJson = (p: string) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };
const OWN: Record<B1Arm | B1bArm | B1cArm | B1dArm, string[]> = { none: [], described: ["/.claude/skills/" + DESCRIBED_SKILL], "gstack-shaped": ["/.claude/skills/" + SKILL, "/.claude/skills/gstack"], command: [], "claude-md": ["/.claude/skills/" + SKILL, "/.claude/skills/gstack", "/" + ROUTING.path], hook: ["/.claude/skills/" + SKILL, "/.claude/skills/gstack", "/.gstack"], "project-md": ["/.claude/skills/" + SKILL, "/.claude/skills/gstack"], "gstack-main": ["/.claude/skills", "/.gstack"], "project-md-noescape": ["/.claude/skills/" + SKILL, "/.claude/skills/gstack"] };
const ownSkill: Record<B1Arm | B1bArm | B1cArm | B1dArm, string | null> = { none: null, described: DESCRIBED_SKILL, "gstack-shaped": SKILL, command: null, "claude-md": SKILL, hook: SKILL, "project-md": SKILL, "gstack-main": SKILL, "project-md-noescape": SKILL };
let stepsText: string | null = null;
const stepsNeedle = () => (stepsText ??= JSON.stringify(readFileSync(join(REPO, ARM_SOURCES, "steps.md"), "utf8").trimEnd()).slice(1, -1));

/** Whether a Claude Code transcript's user records hold the step text. */
export function stepsSeen(transcript: string): boolean {
  const needle = stepsNeedle();
  return transcript.split("\n").some((l) => l.includes(needle) && /"type":"user"/.test(l));
}
const SAFETY = /"stop_reason":"refusal"|content[ _-]?(?:filter|policy)/i;
/** Whether a Claude Code transcript shows a provider safety stop: an assistant turn that stopped for refusal, or an API error
 *  message that names a content filter or content policy. */
export function safetyStop(transcript: string): boolean {
  return transcript.split("\n").some((l) => /"type":"assistant"/.test(l) && (/"stop_reason":"refusal"/.test(l) || (/"isApiErrorMessage":true/.test(l) && SAFETY.test(l))));
}
export const skillLoads = (recs: Rec[], skill: string | null) => (skill ? recs.filter((r) => r.type === "AssistantMessage").flatMap((r) => (Array.isArray(r.content) ? r.content : [])).filter((b: any) => b?.name === "Skill" && String(b.input?.skill ?? "").replace(/^\//, "") === skill).length : 0);

export function b1Row(dir: string, ctx: { part: string | null; sessions: Map<string, SessionRow[]>; home: string; arms?: readonly string[] }): B1Row | null {
  const config = readJson(join(dir, "config.json"));
  if (!config || config.agent?.name !== "laneb-claude-code") return null;
  const result = readJson(join(dir, "result.json"));
  const kwargs = config.agent.kwargs ?? {};
  const arm = String(kwargs.arm ?? "");
  const arms = ctx.arms ?? ARM_NAMES;
  if (!arms.includes(arm) || !(isArm(arm) || isB1bArm(arm) || isB1cArm(arm) || isB1dArm(arm))) throw new Error("E_USAGE b1 table: " + dir + " has arm " + JSON.stringify(kwargs.arm) + ", not one of " + arms.join(", "));
  const task = String(config.task?.path ?? result?.task_name ?? "").split("/").filter(Boolean).at(-1) ?? "?";
  const trial = String(result?.trial_name ?? dir.split("/").filter(Boolean).at(-1));
  const msgs = join(dir, "evaluator", "sdk-messages.jsonl");
  const recs = existsSync(msgs) ? parseLog(readFileSync(msgs, "utf8")) : [];
  const p = runProbes(recs, { gstackRoots: [], investigatePrefix: null, home: ctx.home });
  const rows = ctx.sessions.get(trial) ?? [];
  const last = rows.at(-1);
  const responded = last ? (last.ok_responses ?? 0) > 0 : p.model_text;
  const exc = result?.exception_info?.exception_type ?? null;
  const rewards = result?.verifier_result?.rewards;
  const keys = rewards && typeof rewards === "object" ? Object.keys(rewards) : [];
  const v = keys.includes("reward") ? rewards.reward : keys.length === 1 ? rewards[keys[0]!] : undefined;
  const raw = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  const reward = result && Number.isFinite(raw) ? raw : null;
  const allowance = (last?.refused_budget ?? 0) > 0;
  let outcome: B1Row["outcome"] = "infra";
  let reason: string;
  if (exc === "LedgerCapStop") { outcome = "cap_stop"; reason = "ledger cap stop"; }
  else if (!result) reason = "no result.json";
  else if (!responded) reason = "no model response reached the agent" + (exc ? " (" + exc + ")" : "");
  else if (reward === null) reason = "no verifier reward, verifier infrastructure error" + (allowance ? " (allowance stop)" : p.turn_cap ? " (turn cap)" : exc ? " (" + exc + ")" : "");
  else { outcome = "graded"; reason = allowance ? "allowance stop, graded on the shipped diff" : p.turn_cap ? "turn cap, graded on the shipped diff" : exc ? exc + ", graded on the shipped diff" : "graded"; }
  const cc = join(dir, "evaluator", "claude-projects");
  const main = existsSync(cc) ? readdirSync(cc).flatMap((d) => (statSync(join(cc, d)).isDirectory() ? readdirSync(join(cc, d)).filter((f) => f.endsWith(".jsonl")).map((f) => join(cc, d, f)) : [])) : [];
  const transcript = main.length === 1 ? readFileSync(main[0]!, "utf8") : null;
  const patchFile = join(dir, "artifacts", "logs", "artifacts", "model.patch");
  const usage = readJson(join(dir, "evaluator", "laneb-summary.json"))?.session?.usage;
  return {
    schema: "b1-session/1",
    model: String(kwargs.upstream_model ?? "?"),
    part: ctx.part,
    arm,
    task,
    trial,
    outcome,
    reason,
    pass: outcome === "graded" && reward !== null && reward >= 1,
    reward,
    allowance_stop: allowance,
    turn_cap: p.turn_cap,
    cost_usd: rows.length ? rows.reduce((x, r) => x + (r.spent_micros ?? 0), 0) / 1e6 : null,
    tokens: usage ? ["input_tokens", "cache_creation_input_tokens", "cache_creation_1h_input_tokens", "cache_read_input_tokens", "output_tokens"].reduce((x, k) => x + (Number(usage[k]) || 0), 0) : null,
    steps_seen: transcript === null ? null : stepsSeen(transcript),
    skill_loads: skillLoads(recs, ownSkill[arm]),
    safety_stop: transcript !== null && safetyStop(transcript),
    audit_hits: p.audit_hits.filter((h) => !OWN[arm].some((o) => h.includes(ctx.home + o + "/") || h.endsWith(ctx.home + o))),
    detect: detect(recs, existsSync(patchFile) ? readFileSync(patchFile, "utf8") : ""),
  };
}

export function buildB1Table(cfg: B1TableConfig): B1Row[] {
  if (!Array.isArray(cfg.jobs) || !cfg.jobs.length) throw new Error("E_USAGE b1 table: the config needs jobs, each {dir, part}");
  if (!Array.isArray(cfg.sessions)) throw new Error("E_USAGE b1 table: the config needs sessions, the proxy-sessions.jsonl files of the runs in jobs");
  const sessions = sessionsByTrial(readSessionRows(cfg.sessions));
  const out: B1Row[] = [];
  for (const job of cfg.jobs) for (const name of readdirSync(job.dir).sort()) {
    const d = join(job.dir, name);
    if (!statSync(d).isDirectory()) continue;
    const row = b1Row(d, { part: job.part ?? null, sessions, home: cfg.home ?? "/root" });
    if (row) out.push(row);
  }
  return out;
}
/** A pulled part dir's Harbor jobs and its proxy's session rows, as buildB1Table takes them. */
export function pulledInputs(pulled: string, part: string): B1TableConfig {
  const d = join(pulled, "jobs"), s = join(pulled, "out/proxy-sessions.jsonl");
  return { jobs: existsSync(d) ? readdirSync(d).filter((j) => statSync(join(d, j)).isDirectory()).map((j) => ({ dir: join(d, j), part })) : [], sessions: existsSync(s) ? [s] : [] };
}
