// Copyright (c) 2026 Garry Tan. MIT License.
// One HmSessionRow (src/types.ts) per Lane B trial dir, from config.json, result.json, the SDK log and the metering proxy's
// session rows, through L1's readers (analysis/analyze.ts, l1/probes.ts). Score fields come from score.ts.
// Outcome: a trial is graded when it has a verifier reward and a model response reached the agent; an allowance or
// turn-cap stop after a response is a graded fail; LedgerCapStop is a cap stop; anything else is infra. A no-gstack
// session whose read audit hits a gstack path or a drive is contaminated.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { readSessionRows, sessionsByTrial, type SessionRow } from "../../quick/laneb/analysis/analyze.ts";
import { parseLog, runProbes } from "../../quick/laneb/l1/probes.ts";
import type { HmArm, HmSessionRow } from "../../src/types.ts";
import { ARMS, NO_GSTACK } from "./pins.ts";
import { scoreSession } from "./score.ts";

const readJson = (p: string) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };
export type HmTableConfig = { jobs: { dir: string; part?: string }[]; sessions: string[]; home?: string };

export function hmRow(dir: string, ctx: { part: string | null; sessions: Map<string, SessionRow[]>; home: string }): HmSessionRow | null {
  const config = readJson(join(dir, "config.json"));
  if (!config || config.agent?.name !== "laneb-claude-code") return null;
  const result = readJson(join(dir, "result.json"));
  const kwargs = config.agent.kwargs ?? {};
  const arm = String(kwargs.arm ?? "") as HmArm;
  if (!Object.hasOwn(ARMS, arm)) throw new Error("E_USAGE hm table: " + dir + " has arm " + JSON.stringify(kwargs.arm) + ", not one of " + Object.keys(ARMS).join(", "));
  const task = String(config.task?.path ?? result?.task_name ?? "").split("/").filter(Boolean).at(-1) ?? "?";
  const trial = String(result?.trial_name ?? dir.split("/").filter(Boolean).at(-1));
  const msgs = join(dir, "evaluator", "sdk-messages.jsonl");
  const recs = existsSync(msgs) ? parseLog(readFileSync(msgs, "utf8")) : [];
  const gstack = !NO_GSTACK.includes(arm);
  const p = runProbes(recs, { gstackRoots: gstack ? [ctx.home + "/.claude/skills/", ctx.home + "/.gstack/"] : [], investigatePrefix: null, home: ctx.home });
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
  const stopped = allowance || p.turn_cap;
  let outcome: HmSessionRow["outcome"] = "infra";
  let reason: string;
  if (exc === "LedgerCapStop") { outcome = "cap_stop"; reason = "ledger cap stop"; }
  else if (!result) reason = "no result.json";
  else if (!responded) reason = "no model response reached the agent" + (exc ? " (" + exc + ")" : "");
  else if (reward === null && !stopped) reason = exc ? exc + ", no verifier reward" : "no verifier reward";
  else { outcome = "graded"; reason = allowance ? "allowance stop, graded fail" : p.turn_cap ? "turn cap, graded fail" : exc ? exc + ", graded" : "graded"; }
  if (outcome === "graded" && !gstack && p.audit_hits.length) { outcome = "contaminated"; reason = "read audit: " + p.audit_hits[0]; }
  const usage = readJson(join(dir, "evaluator", "laneb-summary.json"))?.session?.usage;
  const evidence = readJson(join(dir, "evaluator", "l1-evidence.json")) ?? {};
  const flag = (x: unknown) => (typeof x === "boolean" ? x : null);
  const pass = outcome === "graded" && !stopped && reward !== null && reward >= 1;
  const cc = join(dir, "evaluator", "claude-projects");
  const main = existsSync(cc) ? readdirSync(cc).flatMap((p) => (statSync(join(cc, p)).isDirectory() ? readdirSync(join(cc, p)).filter((f) => f.endsWith(".jsonl")).map((f) => join(cc, p, f)) : [])) : [];
  const stem = main.length === 1 ? basename(main[0]!, ".jsonl") : null;
  const hooks = join(dir, "evaluator", "gstack-hooks");
  const recFile = stem ? join(hooks, "skill-contracts", stem.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 128) + ".json") : "";
  const record = !stem || !existsSync(hooks) ? null : existsSync(recFile) ? readJson(recFile) : false;
  return {
    schema: "hm-session/1",
    model: String(kwargs.upstream_model ?? "?"),
    part: ctx.part,
    arm,
    task,
    trial,
    outcome,
    pass,
    reward,
    allowance_stop: allowance,
    turn_cap: p.turn_cap,
    reason,
    cost_usd: rows.length ? rows.reduce((x, r) => x + (r.spent_micros ?? 0), 0) / 1e6 : null,
    tokens: usage ? ["input_tokens", "cache_creation_input_tokens", "cache_creation_1h_input_tokens", "cache_read_input_tokens", "output_tokens"].reduce((x, k) => x + (Number(usage[k]) || 0), 0) : null,
    contract_record: flag(evidence.contract_record),
    contract_check_met: flag(evidence.contract_check_met),
    audit_hits: p.audit_hits,
    score: scoreSession(recs, { pass: outcome === "graded" ? pass : null, transcript: stem ? readFileSync(main[0]!, "utf8") : null, record }),
  };
}

export function buildHmTable(cfg: HmTableConfig): HmSessionRow[] {
  if (!Array.isArray(cfg.jobs) || !cfg.jobs.length) throw new Error("E_USAGE hm table: the config needs jobs, each {dir, part}");
  if (!Array.isArray(cfg.sessions)) throw new Error("E_USAGE hm table: the config needs sessions, the proxy-sessions.jsonl files of the runs in jobs");
  const sessions = sessionsByTrial(readSessionRows(cfg.sessions));
  const out: HmSessionRow[] = [];
  for (const job of cfg.jobs) for (const name of readdirSync(job.dir).sort()) {
    const d = join(job.dir, name);
    if (!statSync(d).isDirectory()) continue;
    const row = hmRow(d, { part: job.part ?? null, sessions, home: cfg.home ?? "/root" });
    if (row) out.push(row);
  }
  return out;
}
