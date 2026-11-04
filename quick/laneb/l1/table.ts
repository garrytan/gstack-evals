// L1 per-session outcome table (the L1 superseding preregistration, sections 6 and 10). One L1SessionRow (src/types.ts) per
// Lane B trial, from the trial's config.json, result.json and evaluator/ files and the metering proxy's session rows.
//
// Outcome (section 6, R3 amendment 4's rule): a trial is graded when it has a verifier reward and a model response reached the
// agent (the proxy's last session row has ok_responses > 0; with no row, the SDK log holds model output). An allowance stop
// (the proxy refused a request for the session's budget) or a turn-cap stop after a model response is a graded fail for pass
// and adherence, reward or not (#169 7.5). A LedgerCapStop is a cap stop: the run is incomplete. Anything else is infra, a
// coverage gap. A none session whose read audit hits an installed gstack path or a drive is contaminated: dropped, counted.
// route_hook, contract_record and contract_check_met come from evaluator/l1-evidence.json when a harness unit wrote it, and
// are null otherwise: the SDK log carries neither the route hook's line nor the contract record (probes.ts).
//
// The probe L prefix for each pin is the first 200 characters of that pin's installed investigate/SKILL.md, checked against
// the digests the preregistration's install-manifest.md froze; a mismatch refuses the table.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readSessionRows, sessionsByTrial, type SessionRow } from "../analysis/analyze.ts";
import type { L1Arm, L1Instrument, L1SessionRow } from "../../../src/types.ts";
import { parseLog, runProbes } from "./probes.ts";

export const ARMS: readonly L1Arm[] = ["none", "before-u", "after-u", "before-t", "after-t", "off-u", "off-t"];
export const INSTRUMENTS: readonly L1Instrument[] = ["pilot", "smoke", "f1", "tb2"];
export const PREFIX_SHA256 = {
  before: "07bd7af57db2433d97f3d9a4646bf9e3314f69d08c37a35dcec8cd5987e916a0",
  after: "5bd9a0c6e900276b4d8a08727bee300c3ce85ba1a08ae47361729d7056c83f61",
} as const;
export type Pin = keyof typeof PREFIX_SHA256;
/** The sha256 of the probes.ts that scores every row this table writes; analyze.ts refuses rows from any other. */
export const PROBES_SHA256 = createHash("sha256").update(readFileSync(join(import.meta.dir, "probes.ts"))).digest("hex");

export class UsageError extends Error {}

export const pinOf = (arm: L1Arm): Pin | null => (arm === "none" ? null : arm.startsWith("before") ? "before" : "after");
export const repoOf = (task: string, instrument: L1Instrument) => (instrument === "tb2" ? task : task.replace(/-\d+$/, ""));

/** The first 200 characters of a pin's installed investigate/SKILL.md, refused unless they hash to the frozen digest. */
export function investigatePrefix(skillMd: string, pin: Pin): string {
  const prefix = [...skillMd].slice(0, 200).join("");
  const got = createHash("sha256").update(prefix).digest("hex");
  if (got !== PREFIX_SHA256[pin]) throw new UsageError("E_USAGE l1 table: the " + pin + " investigate/SKILL.md's first 200 characters hash to " + got + ", not the frozen " + PREFIX_SHA256[pin]);
  return prefix;
}

const readJson = (path: string): any => {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
};

export type TableContext = { instrument: L1Instrument; part: string | null; sessions: Map<string, SessionRow[]>; prefixes: Record<Pin, string>; home: string };

/** One trial directory as a row, or null when it is not a Lane B trial. */
export function sessionRow(dir: string, ctx: TableContext): L1SessionRow | null {
  const config = readJson(join(dir, "config.json"));
  if (!config || config.agent?.name !== "laneb-claude-code") return null;
  const result = readJson(join(dir, "result.json"));
  const kwargs = config.agent.kwargs ?? {};
  const arm = String(kwargs.arm ?? "") as L1Arm;
  if (!ARMS.includes(arm)) throw new UsageError("E_USAGE l1 table: " + dir + " has arm " + JSON.stringify(kwargs.arm) + ", not one of " + ARMS.join(", "));
  const task = String(config.task?.path ?? result?.task_name ?? "").split("/").filter(Boolean).at(-1) ?? "?";
  const trial = String(result?.trial_name ?? dir.split("/").filter(Boolean).at(-1));
  const msgs = join(dir, "evaluator", "sdk-messages.jsonl");
  const recs = existsSync(msgs) ? parseLog(readFileSync(msgs, "utf8")) : [];
  const pin = pinOf(arm);
  const p = runProbes(recs, { gstackRoots: pin ? [ctx.home + "/.claude/skills/", ctx.home + "/.gstack/"] : [], investigatePrefix: pin ? ctx.prefixes[pin] : null, home: ctx.home });
  const rows = ctx.sessions.get(trial) ?? [];
  const last = rows.at(-1);
  const responded = last ? (last.ok_responses ?? 0) > 0 : p.model_text;
  const exc = result?.exception_info?.exception_type ?? null;
  const raw = Number(result?.verifier_result?.rewards?.reward ?? Object.values(result?.verifier_result?.rewards ?? {})[0]);
  const reward = result && Number.isFinite(raw) ? raw : null;
  const allowance = (last?.refused_budget ?? 0) > 0;
  const stopped = allowance || p.turn_cap;
  let outcome: L1SessionRow["outcome"] = "infra";
  let reason: string;
  if (exc === "LedgerCapStop") { outcome = "cap_stop"; reason = "ledger cap stop"; }
  else if (!result) reason = "no result.json";
  else if (!responded) reason = "no model response reached the agent" + (exc ? " (" + exc + ")" : "");
  else if (reward === null && !stopped) reason = exc ? exc + ", no verifier reward" : "no verifier reward";
  else {
    outcome = "graded";
    reason = allowance ? "allowance stop, graded fail" : p.turn_cap ? "turn cap, graded fail" : exc ? exc + ", graded" : "graded";
  }
  if (outcome === "graded" && arm === "none" && p.audit_hits.length) { outcome = "contaminated"; reason = "read audit: " + p.audit_hits[0]; }
  const summary = readJson(join(dir, "evaluator", "laneb-summary.json"));
  const usage = summary?.session?.usage;
  const evidence = readJson(join(dir, "evaluator", "l1-evidence.json")) ?? {};
  const flag = (v: unknown) => (typeof v === "boolean" ? v : null);
  return {
    schema: "l1-session/1",
    model: String(kwargs.upstream_model ?? "?"),
    instrument: ctx.instrument,
    part: ctx.part,
    arm,
    task,
    repo: repoOf(task, ctx.instrument),
    trial,
    outcome,
    pass: outcome === "graded" && !stopped && reward !== null && reward >= 1,
    reward,
    allowance_stop: allowance,
    turn_cap: p.turn_cap,
    reason,
    cost_usd: rows.length ? rows.reduce((x, r) => x + (r.spent_micros ?? 0), 0) / 1e6 : null,
    tokens: usage ? ["input_tokens", "cache_creation_input_tokens", "cache_creation_1h_input_tokens", "cache_read_input_tokens", "output_tokens"].reduce((x, k) => x + (Number(usage[k]) || 0), 0) : null,
    load_investigate: p.probe_l.investigate,
    gstack_loads: p.probe_l.gstack_loads,
    repo_loads: p.probe_l.repo_loads,
    skill_unresolved: p.probe_l.unresolved,
    complete: p.probe_i.complete && !stopped,
    probe_i: { report: p.probe_i.report, fix_edited: p.probe_i.fix_edited, status: p.probe_i.status, check_after_edit: p.probe_i.check_after_edit, edits: p.probe_i.edits },
    background_at_result: p.background.at_result,
    contract_block: p.contract_block,
    route_hook: flag(evidence.route_hook),
    contract_record: flag(evidence.contract_record),
    contract_check_met: flag(evidence.contract_check_met),
    audit_hits: p.audit_hits,
    probes_sha256: PROBES_SHA256,
  };
}

export type TableConfig = { jobs: { dir: string; instrument: L1Instrument; part?: string }[]; sessions: string[]; prefixes: Record<Pin, string>; home?: string };

export function buildTable(cfg: TableConfig): L1SessionRow[] {
  if (!Array.isArray(cfg.jobs) || !cfg.jobs.length) throw new UsageError("E_USAGE l1 table: the config needs jobs, each {dir, instrument, part}");
  if (!Array.isArray(cfg.sessions) || !cfg.sessions.length) throw new UsageError("E_USAGE l1 table: the config needs sessions, the proxy-sessions.jsonl files of the runs in jobs");
  const prefixes = { before: investigatePrefix(readFileSync(cfg.prefixes?.before, "utf8"), "before"), after: investigatePrefix(readFileSync(cfg.prefixes?.after, "utf8"), "after") };
  const sessions = sessionsByTrial(readSessionRows(cfg.sessions));
  const out: L1SessionRow[] = [];
  for (const job of cfg.jobs) {
    if (!INSTRUMENTS.includes(job.instrument)) throw new UsageError("E_USAGE l1 table: instrument " + JSON.stringify(job.instrument) + " is not one of " + INSTRUMENTS.join(", "));
    for (const name of readdirSync(job.dir).sort()) {
      const d = join(job.dir, name);
      if (!statSync(d).isDirectory()) continue;
      const row = sessionRow(d, { instrument: job.instrument, part: job.part ?? null, sessions, prefixes, home: cfg.home ?? "/root" });
      if (row) out.push(row);
    }
  }
  return out;
}

if (import.meta.main) {
  const [cfgPath, outPath] = Bun.argv.slice(2);
  try {
    if (!cfgPath || !outPath) throw new UsageError("E_USAGE usage: bun quick/laneb/l1/table.ts <config.json> <sessions.jsonl>");
    const rows = buildTable(JSON.parse(readFileSync(cfgPath, "utf8")));
    writeFileSync(outPath, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""));
    console.log("wrote " + rows.length + " rows to " + outPath);
  } catch (e) {
    console.error(e instanceof UsageError ? e.message : "E_USAGE l1 table: " + String(e));
    process.exit(2);
  }
}
