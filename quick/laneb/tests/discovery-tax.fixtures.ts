// Synthetic Harbor job folders for analysis/discovery-tax.ts: every row of the preregistration's section 7
// table and every claim branch of sections 6.1 to 6.3. No real task, transcript or key.
//   bun tests/discovery-tax.fixtures.ts <dir>   writes the job folders and one config per scenario
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FIT } from "../analysis/discovery-tax.ts";

export const TASKS = [...FIT, ...Array.from({ length: 32 }, (_, i) => `t${String(i + 6).padStart(2, "0")}`)];
export const BODY = "# Investigate\n\nA body long enough that its first two hundred characters span several lines.\n" + "Line of body text.\n".repeat(20);
const SKILLS = ["investigate", "review"];
type Spec = { task: string; arm: string; model: string; reward: number | null; msgs?: object[]; exc?: string; session?: Record<string, unknown>; name?: string; system_prompt?: string };

const said = (text = "working") => ({ type: "AssistantMessage", content: [{ text }], usage: { input_tokens: 10, output_tokens: 5 } });
export const M = {
  respond: [said()],
  refused: [{ type: "SystemMessage", subtype: "model_refusal_no_fallback" }, { type: "AssistantMessage", content: [{ text: "API Error: the safeguards flagged this message." }], usage: { input_tokens: 0, output_tokens: 0 } }],
  readOpen: (skill: string, id: string, text = "DEBUG REPORT") => [
    { type: "AssistantMessage", content: [{ id, name: "Read", input: { file_path: `/root/.claude/skills/${skill}/SKILL.md` } }], usage: { input_tokens: 10, output_tokens: 5 } },
    { type: "UserMessage", content: [{ tool_use_id: id, content: ("---\nname: x\n---\n" + BODY).split("\n").map((l, i) => `${String(i + 1).padStart(6)}\t${l}`).join("\n") }] },
    said(text),
  ],
  skill: (skill: string, id: string) => [{ type: "AssistantMessage", content: [{ id, name: "Skill", input: { skill } }], usage: { input_tokens: 10, output_tokens: 5 } }, { type: "UserMessage", content: [{ tool_use_id: id, content: "Launching skill" }] }],
  browse: [{ type: "AssistantMessage", content: [{ id: "b1", name: "Bash", input: { command: "ls /root/.claude/skills/" } }], usage: { input_tokens: 10, output_tokens: 5 } }],
  turnCap: [said(), { type: "ResultMessage", subtype: "error_max_turns", num_turns: 61, is_error: true }],
};

let n = 0;
export function trial(job: string, s: Spec) {
  const name = s.name ?? `${s.task}__${(n++).toString(36).padStart(7, "0")}`;
  const dir = join(job, name);
  mkdirSync(join(dir, "agent"), { recursive: true });
  writeFileSync(join(dir, "config.json"), JSON.stringify({ agent: { kwargs: { arm: s.arm, upstream_model: s.model, ...(s.system_prompt ? { system_prompt: s.system_prompt } : {}) } }, task: { path: "/run/tasks/" + s.task } }));
  writeFileSync(join(dir, "result.json"), JSON.stringify({ trial_name: name, verifier_result: s.reward === null ? null : { rewards: { reward: s.reward } }, exception_info: s.exc ? { exception_type: s.exc, exception_message: "" } : null }));
  writeFileSync(join(dir, "agent", "sdk-messages.jsonl"), (s.msgs ?? M.respond).map((m) => JSON.stringify(m)).join("\n") + "\n");
  writeFileSync(join(dir, "agent", "laneb-summary.json"), JSON.stringify({ session: { spent_micros: 20000, requests: 4, refused_budget: 0, cmd_expanded: s.arm !== "none", first_req_prompt_tokens: 1000, ...s.session } }));
  return name;
}

const bodies = (arms: string[]) => Object.fromEntries(arms.map((a) => [a, a === "none" ? {} : Object.fromEntries(SKILLS.map((k) => [k, BODY]))]));

// factor: the frozen layout, every preset cell labelled arm@claude-code-preset, and sdk-default cells (none, gstack,
// gstack-rewritten) on m-claim and m-zero, where gstack never opens.
function runD(root: string, factor = false) {
  const job = join(root, factor ? "jobs-d-factor" : "jobs-d");
  const sp = factor ? "claude-code-preset" : undefined;
  const sessions: object[] = [];
  const opens = (model: string, arm: string, i: number) => {
    if (model === "m-claim") return arm !== "none" && i % 5 < 3;
    if (model === "m-zero") return arm === "gstack-rewritten" && i % 4 !== 0;
    if (model === "m-sparse") return (arm === "gstack" || arm === "placebo") && i === 7;
    return false;
  };
  for (const model of ["m-claim", "m-zero", "m-sparse", "m-gate"]) for (const arm of ["none", "gstack", "gstack-rewritten", "placebo"]) TASKS.forEach((task, i) => {
    const spec: Spec = { task, arm, model, system_prompt: sp, reward: i % 2, msgs: opens(model, arm, i) ? M.readOpen("investigate", `r${i}`, i % 3 ? "DEBUG REPORT: Phase 5, root cause" : "done") : M.respond };
    if (model === "m-gate" && arm === "none" && i < 5) Object.assign(spec, { msgs: M.refused, reward: 0 });
    if (model === "m-claim" && i === 10) {
      if (arm === "none") Object.assign(spec, { reward: null, exc: "AgentTimeoutError" });
      if (arm === "gstack") Object.assign(spec, { msgs: [], reward: null, exc: "RuntimeError" });
      if (arm === "placebo") Object.assign(spec, { session: { refused_budget: 1 }, reward: 0 });
      if (arm === "gstack-rewritten") Object.assign(spec, { msgs: [...M.respond, ...M.skill("plugin-authoring", "p1"), ...M.browse] });
    }
    if (factor && model === "m-claim" && i === 12 && arm === "none") Object.assign(spec, { msgs: [...M.skill("doctor", "d1"), ...M.turnCap] });
    const name = trial(job, spec);
    if (model === "m-claim" && i === 11 && arm === "none") sessions.push({ trial: name + "__env", ok_responses: 3, opened_at: "2026-11-01T00:00:00Z" }, { trial: name + "__env", ok_responses: 2, opened_at: "2026-11-01T00:10:00Z" });
  });
  for (const arm of ["none", "gstack"]) trial(job, { task: "dropped-task", arm, model: "m-claim", reward: 1, system_prompt: sp });
  if (factor) for (const model of ["m-claim", "m-zero"]) for (const arm of ["none", "gstack", "gstack-rewritten"]) TASKS.forEach((task, i) => {
    trial(job, { task, arm, model, system_prompt: "sdk-default", reward: i % 2, msgs: arm === "gstack-rewritten" && i % 2 ? M.readOpen("investigate", `s${i}`) : M.respond });
  });
  const sessionsPath = join(root, factor ? "sessions-d-factor.jsonl" : "sessions-d.jsonl");
  writeFileSync(sessionsPath, sessions.map((s) => JSON.stringify(s)).join("\n") + "\n");
  return { run: "D", models: ["m-claim", "m-zero", "m-sparse", "m-gate"], jobs: [job], sessions: [sessionsPath], dropped_tasks: ["dropped-task"],
    listing_check: { none: true, gstack: true, "gstack-rewritten": true, placebo: true }, bodies: bodies(["none", "gstack", "gstack-rewritten", "placebo"]),
    ...(factor ? { setting: "claude-code-preset", contrast: { setting: "sdk-default", models: ["m-claim", "m-zero"] }, d2: "pooled", d3: "pooled", mdd: { d2_per_model: 25.0, d2_pooled: 9.0, d3_per_model: 27.0, d3_pooled: 15.0 } } : {}) };
}

// gates: the factor run's job, plus m-claim's second replicate of its two D3 cells as its own job (every preset trial opens,
// so it would move D1 and D2 if they read it), plus m-partial, whose preset cells a ledger stop cut short: gstack graded on
// 25 of 37 tasks (its last 12 never launched), gstack-rewritten and placebo missing on those 12 (no model response). Every
// graded m-partial trial is eligible, so only the completeness gate catches it. task_count is 38: the 37 tasks and
// dropped-task, which the oracle rule takes out.
function runDGates(root: string, factor: any) {
  const r2 = join(root, "jobs-d-r2");
  TASKS.forEach((task, i) => {
    for (const sp of ["claude-code-preset", "sdk-default"]) trial(r2, { task, arm: "gstack", model: "m-claim", system_prompt: sp, reward: 1, msgs: sp === "sdk-default" ? M.respond : M.readOpen("investigate", `q${i}`) });
  });
  const partial = join(root, "jobs-d-partial");
  for (const arm of ["none", "gstack", "gstack-rewritten", "placebo"]) TASKS.forEach((task, i) => {
    if (arm === "gstack" && i >= 25) return;
    const stopped = arm !== "none" && i >= 25;
    trial(partial, { task, arm, model: "m-partial", system_prompt: "claude-code-preset", ...(stopped ? { msgs: [], reward: null, exc: "RuntimeError" } : { reward: i % 2, msgs: arm === "gstack-rewritten" && i % 2 ? M.readOpen("investigate", `p${i}`) : M.respond }) });
  });
  return { ...factor, models: ["m-claim", "m-zero", "m-partial"], jobs: [...factor.jobs, r2, partial], replicate_2_jobs: [r2], task_count: 38,
    contrast: { setting: "sdk-default", models: ["m-claim"] }, d3: "per-model", mdd: { d2_per_model: "22.3 to 25.8", d2_pooled: { "3": "7.5 to 10.3", "2": "10.8 to 13.0" }, d3_per_model: "10.9 to 15.4" } };
}

// pass(model, arm, i) per scenario; told cells load their body unless bodyLoad says otherwise.
function runT(root: string, scenario: string, pass: (model: string, arm: string, i: number) => number, bodyLoad: (model: string, arm: string, i: number) => boolean = () => true) {
  const job = join(root, "jobs-t-" + scenario);
  const models = ["particle-1", "claude-haiku-5-5", "deepseek-v4.1-flash-1017"];
  for (const model of models) for (const arm of ["none", "placebo-short", "placebo"]) TASKS.forEach((task, i) => {
    trial(job, { task, arm, model, reward: pass(model, arm, i), session: { cmd_expanded: arm !== "none" && bodyLoad(model, arm, i), refused_budget: arm === "placebo" && i % 9 === 0 ? 1 : 0 } });
  });
  return { run: "T", models, jobs: [job] };
}

export function scenarios(root: string): Record<string, object> {
  const plain = runD(root);
  const factor = runD(root, true);
  return {
    "run-d": plain,
    "run-d-factor": factor,
    "run-d-gates": runDGates(root, factor),
    "run-t-confirmed": runT(root, "confirmed", (m, a, i) => {
      if (m === "particle-1") return a === "placebo" ? (i % 5 === 0 ? 1 : 0) : 1;
      if (m === "claude-haiku-5-5") return a === "placebo" ? (i % 4 === 0 ? 1 : 0) : 1;
      return a === "placebo" ? 1 : i % 4 === 0 ? 1 : 0;
    }),
    "run-t-reversed": runT(root, "reversed", (m, a, i) => (m === "particle-1" ? (a === "none" ? (i % 3 === 0 ? 1 : 0) : 1) : i % 2), (m, a, i) => !(m === "deepseek-v4.1-flash-1017" && a === "placebo" && i < 4)),
    "run-t-not-confirmed": runT(root, "not-confirmed", (m, a, i) => (a === "placebo" && (i === 7 || i === 8) ? 1 - (i % 2) : i % 2)),
  };
}

if (import.meta.main) {
  const root = Bun.argv[2]!;
  mkdirSync(root, { recursive: true });
  for (const [name, cfg] of Object.entries(scenarios(root))) writeFileSync(join(root, name + ".json"), JSON.stringify(cfg, null, 2) + "\n");
}
