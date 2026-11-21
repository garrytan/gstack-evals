// Copyright (c) 2026 Garry Tan. MIT License.
// One B2 row per Lane B trial dir, on both hosts (section 6), from config.json, result.json, the agent's evaluator records and
// the metering proxy's session rows. Claude Code trials (Lane B's Claude agent): the SDK log, Claude Code's transcript and
// gstack's hook log. Codex trials (B2's Codex agent, laneb_b2_codex.py): laneb-summary.json, init.json, the copied rollouts
// in codex-sessions/ and gstack's hook log. Section 8's outcome: a session is graded when it has a verifier reward and a model
// response reached the agent (on Codex also: its rollout was copied out, and every thread ran gpt-6.2-sol at effort low in
// Codex 0.170.0), whatever stopped it; LedgerCapStop is a cap stop; anything else is infrastructure. The model and CLI version
// come from the session's own record: Claude Code's init message (model, claude_code_version), and Codex's session_meta
// cli_version and turn_context model. Passes with a regression test read testFilesInDiff on the graded diff; followed,
// followed_b2 and followed_as_merged read the detector on the SDK log, or on codexRecs of the rollouts (scorer.ts).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { readSessionRows, sessionsByTrial, type SessionRow } from "../../quick/laneb/analysis/analyze.ts";
import { parseLog, runProbes, type Rec } from "../../quick/laneb/l1/probes.ts";
import { safetyStop as ccSafety, stepsSeen as ccSteps } from "../delivery-route/table.ts";
import { namedOf } from "../delivery-route/b1d.ts";
import { detect as codexLoads, readHookLog } from "../codex-hooks/r/detect.ts";
import type { SkillLines } from "../codex-hooks/r/arms.ts";
import { readThread, safetyStop as cxSafety, type Thread } from "../codex-hooks/r/table.ts";
import { codexRecs, detectBoth, testFilesInDiff, type Detection } from "./scorer.ts";
import { ARM_DEFS, B2, CODEX, HOSTS, LINE, MODELS, PROVE_IT, REPO, repoOf, SKILL, SOL_EFFORT, type Arm, type Host } from "./pins.ts";
import { AGENT as CODEX_AGENT } from "./prepare-run.ts";

export const CLAUDE_AGENT = "laneb-claude-code";
export type B2Row = {
  schema: "b2-session/1";
  host: Host;
  label: string;
  arm: Arm;
  part: string | null;
  task: string;
  repo: string | null;
  trial: string;
  /** From the session's own record: Claude Code's init model, or the root rollout's turn_context model. */
  model: string | null;
  cli_version: string | null;
  /** The Agent SDK's version is not in a Claude Code session's own record; null there. */
  sdk_version: string | null;
  effort: string[] | null;
  outcome: "graded" | "cap_stop" | "infra";
  reason: string;
  pass: boolean;
  reward: number | null;
  /** The graded diff's test files (section 6.2), whether it touches one at all, and whether every one sits at the root. */
  test_files: string[];
  touches_test: boolean;
  regression_test: boolean;
  root_only: boolean;
  followed: boolean | null;
  followed_b2: boolean | null;
  followed_as_merged: boolean | null;
  detect: Detection | null;
  /** Rollout items the Codex reader could not read (null on Claude Code); such a session is scored both ways. */
  unreadable_items: number | null;
  steps_seen: boolean | null;
  /** The line arrived in the session's records (the user-instructions text on Claude Code, the AGENTS.md item on Codex). */
  line_seen: boolean;
  /** The skills the host listed to the model at start: Claude Code's init skills, or Codex's skills_instructions names. */
  skills_listed: string[];
  prove_it_loads: number;
  gstack_loads: string[];
  /** What gstack's routing hook named, from its own log; null when there is no log (a no-gstack arm, or none copied). */
  routing_named: string[] | null;
  start_seen: boolean;
  questions: number;
  cost_usd: number | null;
  tokens: number | null;
  wall_s: number | null;
  allowance_stop: boolean;
  turn_cap: boolean;
  time_stop: boolean;
  safety_stop: boolean;
  /** The read audit of the no-gstack arms: reads of gstack paths, skills or a drive. null in a gstack arm. */
  audit: number | null;
};
export type B2TableConfig = { jobs: { dir: string; part?: string }[]; sessions: string[]; home?: string };

const readJson = (p: string) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };
const readText = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : null);
const walk = (d: string): string[] => (existsSync(d) ? readdirSync(d).sort().flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)])) : []);
const tableErr = (m: string): never => { throw new Error("E_B2_TABLE " + m); };
let REPOS: Map<string, string> | null = null;
let LINES: Record<string, SkillLines> | null = null;
export const SKILL_LINES = join(REPO, "quick/laneb", B2.armManifests, "skill-lines.json");
const skillLines = () => (LINES ??= JSON.parse(readFileSync(SKILL_LINES, "utf8")));
export const START_MARK = "SKILL_START_PROTO";

/** The verifier's reward, as B1 reads it. */
function rewardOf(result: any): number | null {
  const rewards = result?.verifier_result?.rewards;
  const keys = rewards && typeof rewards === "object" ? Object.keys(rewards) : [];
  const v = keys.includes("reward") ? rewards.reward : keys.length === 1 ? rewards[keys[0]!] : undefined;
  const raw = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return result && Number.isFinite(raw) ? raw : null;
}
const tokensOf = (usage: any) => (usage ? ["input_tokens", "cache_creation_input_tokens", "cache_creation_1h_input_tokens", "cache_read_input_tokens", "output_tokens"].reduce((x, k) => x + (Number(usage[k]) || 0), 0) : null);
/** Section 6.2 on a graded diff. */
export function regression(patch: string, pass: boolean) {
  const files = testFilesInDiff(patch);
  return { test_files: files, touches_test: files.length > 0, regression_test: pass && files.length > 0, root_only: files.length > 0 && files.every((f) => !f.includes("/")) };
}

/** Skill loads in Claude Code's SDK log: Skill calls (and Reads of a skill's SKILL.md) whose result is no error. prove-it's
 *  count, and every other skill named, Claude Code's own plugin-authoring left out. */
export function claudeLoads(recs: Rec[], home = "/root"): { prove_it: number; others: string[] } {
  const calls: { id: string; skill: string }[] = [], errs = new Set<string>();
  for (const r of recs) for (const b of Array.isArray(r.content) ? (r.content as any[]) : []) {
    if (r.type === "AssistantMessage" && b?.name === "Skill") calls.push({ id: String(b.id), skill: String(b.input?.skill ?? "").replace(/^\//, "") });
    else if (r.type === "AssistantMessage" && b?.name === "Read") { const m = new RegExp("^(?:~|" + home + ")/\\.claude/skills/([\\w.:-]+)/SKILL\\.md$").exec(String(b.input?.file_path ?? "")); if (m) calls.push({ id: String(b.id), skill: m[1]! }); }
    else if (r.type === "UserMessage" && typeof b?.tool_use_id === "string" && b.is_error) errs.add(b.tool_use_id);
  }
  const ok = calls.filter((c) => !errs.has(c.id) && c.skill && c.skill !== "plugin-authoring");
  return { prove_it: ok.filter((c) => c.skill === SKILL).length, others: [...new Set(ok.filter((c) => c.skill !== SKILL).map((c) => c.skill))] };
}
/** gstack's start step in a Claude Code session: its load-time injected output (gstack 7f9c1bc5 and later) or a Bash result
 *  holding it, in a user record. */
export const claudeStartSeen = (sdk: string) => sdk.split("\n").some((l) => l.includes(START_MARK) && /"type": ?"UserMessage"/.test(l));
/** gstack's start step in a Codex session: a call that runs gstack-skill-start, or a tool output holding its first line. */
export const codexStartSeen = (rollouts: string[]) => rollouts.some((t) => t.split("\n").some((l) => /"type":"response_item"/.test(l) && ((/_call"/.test(l) && l.includes("gstack-skill-start")) || (/_call_output"/.test(l) && l.includes(START_MARK)))));
/** gstack skills a Codex session loaded beyond prove-it: a call naming a skill folder's SKILL.md under ~/.codex/skills, or a
 *  <skill> item Codex injected, with prove-it left out. */
export function codexGstackLoads(rollouts: string[]): string[] {
  const out = new Set<string>();
  for (const t of rollouts) for (const l of t.split("\n")) {
    if (!/"type":"response_item"/.test(l)) continue;
    if (/_call"/.test(l)) for (const m of l.matchAll(/(?:\.codex|CODEX_HOME\}?)\/skills\/([\w.-]+)\/SKILL\.md/g)) out.add(m[1]!);
    if (/"role":"user"/.test(l)) for (const m of l.matchAll(/<skill>\\n<name>([\w.-]+)<\/name>/g)) out.add(m[1]!);
  }
  out.delete(SKILL);
  return [...out].sort();
}

/** The skills Codex listed in a session's skills_instructions block (the first rollout line that holds one). */
export function codexListed(rollouts: string[]): string[] {
  for (const t of rollouts) for (const l of t.split("\n")) if (l.includes("<skills_instructions>")) return [...new Set([...l.matchAll(/\\n- ([\w.:-]+): /g)].map((m) => m[1]!))];
  return [];
}

function base(dir: string, ctx: { part: string | null; sessions: Map<string, SessionRow[]> }, host: Host) {
  const config = readJson(join(dir, "config.json"));
  const result = readJson(join(dir, "result.json"));
  const kwargs = config.agent.kwargs ?? {};
  const label = String(kwargs.arm ?? ""), d = ARM_DEFS[label];
  if (!d || d.host !== host) tableErr(dir + " has arm " + JSON.stringify(kwargs.arm) + ", not one of B2's " + host + " arms");
  const task = String(config.task?.path ?? result?.task_name ?? "").split("/").filter(Boolean).at(-1) ?? "?";
  const trial = String(result?.trial_name ?? dir.split("/").filter(Boolean).at(-1));
  const rows = ctx.sessions.get(trial) ?? [];
  const ev = join(dir, "evaluator"), summary = readJson(join(ev, "laneb-summary.json"));
  const patch = readText(join(dir, "artifacts", "logs", "artifacts", "model.patch")) ?? "";
  return {
    d: d!, kwargs, result, task, trial, rows, ev, summary, patch, exc: result?.exception_info?.exception_type ?? null, reward: rewardOf(result),
    cost: rows.length ? rows.reduce((x, r) => x + (r.spent_micros ?? 0), 0) / 1e6 : null, allowance: (rows.at(-1)?.refused_budget ?? 0) > 0,
    repo: (REPOS ??= repoOf()).get(task) ?? null,
  };
}
const outcomeOf = (b: { result: unknown; exc: string | null; reward: number | null }, responded: boolean, other: string | null, limit: string) => {
  if (b.exc === "LedgerCapStop") return { outcome: "cap_stop" as const, reason: "ledger cap stop" };
  if (!b.result) return { outcome: "infra" as const, reason: "no result.json" };
  if (!responded) return { outcome: "infra" as const, reason: "no model response reached the agent" + (b.exc ? " (" + b.exc + ")" : "") };
  if (other) return { outcome: "infra" as const, reason: other };
  if (b.reward === null) return { outcome: "infra" as const, reason: "no verifier reward, verifier infrastructure error" + (limit ? " (" + limit + ")" : b.exc ? " (" + b.exc + ")" : "") };
  return { outcome: "graded" as const, reason: limit ? limit + ", graded on the shipped diff" : b.exc ? b.exc + ", graded on the shipped diff" : "graded" };
};

export function claudeRow(dir: string, ctx: { part: string | null; sessions: Map<string, SessionRow[]>; home: string }): B2Row {
  const b = base(dir, ctx, "claude");
  const sdk = readText(join(b.ev, "sdk-messages.jsonl")) ?? "";
  const recs = parseLog(sdk);
  const p = runProbes(recs, { gstackRoots: [], investigatePrefix: null, home: ctx.home });
  const init = recs.find((r) => r.type === "SystemMessage" && r.subtype === "init")?.init ?? null;
  const responded = b.rows.length ? (b.rows.at(-1)!.ok_responses ?? 0) > 0 : p.model_text;
  const planned = String(b.kwargs.upstream_model ?? "");
  const model: string | null = typeof init?.model === "string" ? init.model : null;
  const cli: string | null = typeof init?.claude_code_version === "string" ? init.claude_code_version : null;
  const other = model !== null && model !== planned ? "the session record names model " + model + ", not " + planned : cli !== null && cli !== HOSTS.claude.version ? "Claude Code " + cli + ", not " + HOSTS.claude.version : null;
  const o = outcomeOf(b, responded, other, b.allowance ? "allowance stop" : p.turn_cap ? "turn cap" : "");
  const pass = o.outcome === "graded" && b.reward !== null && b.reward >= 1;
  const cc = join(b.ev, "claude-projects");
  const main = existsSync(cc) ? readdirSync(cc).flatMap((x) => (statSync(join(cc, x)).isDirectory() ? readdirSync(join(cc, x)).filter((f) => f.endsWith(".jsonl")).map((f) => join(cc, x, f)) : [])) : [];
  const transcript = main.length === 1 ? readFileSync(main[0]!, "utf8") : null;
  const det = recs.length ? detectBoth(recs, b.patch) : null;
  const loads = claudeLoads(recs, ctx.home);
  const hookLog = readText(join(b.ev, "gstack-hooks", "hooks", "skill-route.log"));
  return {
    schema: "b2-session/1", host: "claude", label: b.d.label, arm: b.d.arm, part: ctx.part, task: b.task, repo: b.repo, trial: b.trial,
    model, cli_version: cli, sdk_version: null, effort: null, ...o, pass, reward: b.reward, ...regression(b.patch, pass),
    followed: det ? det.b1.followed : null, followed_b2: det ? det.b2.followed : null, followed_as_merged: det ? det.b1.followed_as_merged : null, detect: det?.b2 ?? null, unreadable_items: null,
    steps_seen: transcript === null ? null : ccSteps(transcript), line_seen: sdk.includes(LINE) || (transcript ?? "").includes(LINE), skills_listed: Array.isArray(init?.skills) ? init.skills.map(String) : [], prove_it_loads: loads.prove_it, gstack_loads: loads.others,
    routing_named: b.d.gstack ? namedOf(hookLog) : null, start_seen: claudeStartSeen(sdk),
    questions: recs.filter((r) => r.type === "AssistantMessage").flatMap((r) => (Array.isArray(r.content) ? (r.content as any[]) : [])).filter((x) => x?.name === "AskUserQuestion").length,
    cost_usd: b.cost, tokens: tokensOf(b.summary?.session?.usage), wall_s: typeof b.summary?.wall_s === "number" ? b.summary.wall_s : null,
    allowance_stop: b.allowance, turn_cap: p.turn_cap, time_stop: b.exc === "AgentTimeoutError", safety_stop: transcript !== null && ccSafety(transcript),
    audit: b.d.gstack ? null : p.audit_hits.length,
  };
}

export function codexRow(dir: string, ctx: { part: string | null; sessions: Map<string, SessionRow[]> }): B2Row {
  const b = base(dir, ctx, "codex");
  const files = walk(join(b.ev, "codex-sessions")).filter((f) => /rollout-.*\.jsonl$/.test(f));
  const threads: Thread[] = files.map(readThread), texts = files.map((f) => readFileSync(f, "utf8"));
  const rootId: string | null = b.summary?.result?.thread_id ?? null;
  const root = threads.find((t) => rootId !== null && t.id === rootId) ?? (rootId === null ? threads.find((t) => t.parent === null) ?? null : null);
  const responded = b.rows.length ? (b.rows.at(-1)!.ok_responses ?? 0) > 0 : (b.summary?.session?.ok_responses ?? 0) > 0;
  const efforts = [...new Set(threads.flatMap((t) => t.efforts))];
  const other = !root ? "no rollout copied out for the root thread"
    : root.cli_version !== CODEX.version ? "the root rollout's Codex is " + root.cli_version + ", not " + CODEX.version
    : root.models.some((m) => m !== MODELS.sol.id) ? "the root thread ran " + root.models.join("/") + ", not " + MODELS.sol.id
    : efforts.some((e) => e !== SOL_EFFORT) ? "a thread ran at effort " + efforts.join("/") + ", not " + SOL_EFFORT : null;
  const time = b.exc === "AgentTimeoutError";
  const o = outcomeOf(b, responded, other, b.allowance ? "allowance stop" : time ? "time limit stop" : "");
  const pass = o.outcome === "graded" && b.reward !== null && b.reward >= 1;
  let det: { b1: Detection; b2: Detection } | null = null, unreadable: number | null = null;
  if (texts.length) { const c = codexRecs(texts); unreadable = c.unreadable; det = detectBoth(c.recs, b.patch, "/testbed"); }
  const loads = texts.length ? codexLoads(b.ev, skillLines()) : null;
  const hook = b.d.gstack ? readHookLog(b.ev, root?.id ?? loads?.root ?? null) : null;
  const events = readText(join(b.ev, "codex-events.jsonl")) ?? "";
  return {
    schema: "b2-session/1", host: "codex", label: b.d.label, arm: b.d.arm, part: ctx.part, task: b.task, repo: b.repo, trial: b.trial,
    model: root?.models[0] ?? null, cli_version: root?.cli_version ?? null, sdk_version: null, effort: efforts, ...o, pass, reward: b.reward, ...regression(b.patch, pass),
    followed: det ? det.b1.followed : null, followed_b2: det ? det.b2.followed : null, followed_as_merged: det ? det.b1.followed_as_merged : null, detect: det?.b2 ?? null, unreadable_items: unreadable,
    steps_seen: loads ? loads.steps_arrived || loads.loads["prove-it"].loaded : null, line_seen: texts.some((x) => x.includes(LINE)), skills_listed: codexListed(texts), prove_it_loads: loads?.loads["prove-it"].loaded ? 1 : 0, gstack_loads: codexGstackLoads(texts),
    routing_named: hook && hook.position !== "log missing" ? hook.named : null, start_seen: codexStartSeen(texts),
    questions: Number(b.summary?.result?.questions ?? 0), cost_usd: b.cost, tokens: tokensOf(b.summary?.session?.usage), wall_s: typeof b.summary?.wall_s === "number" ? b.summary.wall_s : null,
    allowance_stop: b.allowance, turn_cap: false, time_stop: time, safety_stop: cxSafety(events),
    audit: b.d.gstack ? null : loads ? loads.audit.calls : 0,
  };
}

/** One row per trial dir of B2's agents; any other agent's trial is left out. */
export function b2Row(dir: string, ctx: { part: string | null; sessions: Map<string, SessionRow[]>; home: string }): B2Row | null {
  const name = readJson(join(dir, "config.json"))?.agent?.name;
  if (name === CLAUDE_AGENT) return claudeRow(dir, ctx);
  if (name === CODEX_AGENT.name) return codexRow(dir, ctx);
  return null;
}

export function buildB2Table(cfg: B2TableConfig): B2Row[] {
  if (!Array.isArray(cfg.jobs) || !cfg.jobs.length) throw new Error("E_USAGE b2 table: the config needs jobs, each {dir, part}");
  if (!Array.isArray(cfg.sessions)) throw new Error("E_USAGE b2 table: the config needs sessions, the proxy-sessions.jsonl files of the runs in jobs");
  const sessions = sessionsByTrial(readSessionRows(cfg.sessions));
  const out: B2Row[] = [];
  for (const job of cfg.jobs) for (const name of readdirSync(job.dir).sort()) {
    const d = join(job.dir, name);
    if (!statSync(d).isDirectory()) continue;
    const row = b2Row(d, { part: job.part ?? null, sessions, home: cfg.home ?? "/root" });
    if (row) out.push(row);
  }
  return out;
}
/** A pulled part dir's Harbor jobs and its proxy's session rows, as buildB2Table takes them. */
export function pulledInputs(pulled: string, part: string): B2TableConfig {
  const d = join(pulled, "jobs"), s = join(pulled, "out/proxy-sessions.jsonl");
  return { jobs: existsSync(d) ? readdirSync(d).filter((j) => statSync(join(d, j)).isDirectory()).map((j) => ({ dir: join(d, j), part })) : [], sessions: existsSync(s) ? [s] : [] };
}
export { PROVE_IT };
