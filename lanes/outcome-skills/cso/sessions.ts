// Copyright (c) 2026 Garry Tan. MIT License.
// Plan sections 4 and 9 (harness plan 15.3): one session's turns, limits, environment and end, on the head-to-head's
// session loop (h2h_turns.py reads the config csoConfig writes, in h2h's h2h-config.v1 shape). The first turn is the
// arm's entry followed by T; a turn that ends without DONE (h2h's rule: any of the last 3 non-empty lines, markers and
// punctuation stripped, any case) gets the continuation, at most 3 times. The end comes from h2h's endOf over the recorded
// summary, plus OpenAI's cyber-policy refusal for Sol: an upstream end or an infra failure gets one whole-session retry and
// a second is a gap. The record keeps every assistant text block, every opened path, and the model id and harness
// version the session itself reported.
import { HARBOR_MODEL } from "../statemachines/run.ts";
import type { H2hPrereg } from "../h2h/prereg.ts";
import { claudeEnv, QUIET } from "../h2h/sessions/run.ts";
import { endOf, gapOf, retries, withRefusalFallback } from "../h2h/sessions/session.ts";
import { hasDone } from "../h2h/sessions/turns.ts";
import { events } from "../h2h/sessions/exposure.ts";
import { csoFail, type CsoPrereg } from "./prereg.ts";
import type { CsoArm, CsoModel, CsoStage, Exposure, HelperRecords, SessionEnd, SessionRecord } from "./types.ts";

type Rec = Record<string, any>;
export type Host = "claude_code" | "codex";

/** The model id prereg.json names for each model under test. */
export function modelId(model: CsoModel, p: CsoPrereg): string {
  const m = p.models as { primary: { id: string }; low_cost_primary: { id: string }; conditional: { id: string } };
  return model === "opus" ? m.primary.id : model === "particle" ? m.low_cost_primary.id : m.conditional.id;
}

/** The Harbor model a Claude Code session runs (E_CSO_SESSION for Sol, which runs in Codex). */
export const harborModel = (model: CsoModel, p: CsoPrereg): string => HARBOR_MODEL[modelId(model, p).replace(/^anthropic:/, "")] ?? csoFail("E_CSO_SESSION", model + " has no Claude Code route; Sol runs in Codex");

/** Whether an arm runs in a cell: untold only in stage 0 and stage 1 on Opus, the others everywhere their host lists them. */
export function armRuns(arm: CsoArm, model: CsoModel, stage: CsoStage, p: CsoPrereg, host: Host = model === "sol" ? "codex" : "claude_code"): boolean {
  const a = (p.arms as Record<Host, Record<string, { stages?: string[]; models?: string[] }>>)[host]?.[arm];
  if (!a) return false;
  return (!a.stages || a.stages.includes(stage)) && (!a.models || a.models.includes(model));
}

/** The first turn: the arm's entry prefix followed by T (prereg.json entry_rule). */
export function firstTurn(arm: CsoArm, p: CsoPrereg, host: Host = "claude_code"): string {
  const a = (p.arms as Record<Host, Record<string, { entry: string }>>)[host]?.[arm] ?? csoFail("E_CSO_SESSION", "prereg.json has no " + host + " arm " + arm);
  if (a.entry !== "" && !a.entry.endsWith(" ")) csoFail("E_CSO_PREREG", arm + "'s entry " + JSON.stringify(a.entry) + " is not a prefix");
  return a.entry + p.texts.task;
}

const doneOnly = (p: CsoPrereg) => ({ done_rule: p.done_rule }) as unknown as H2hPrereg;
/** The DONE rule over a turn's final message. */
export const csoDone = (finalMessage: string | null | undefined, p: CsoPrereg): boolean => hasDone(finalMessage, doneOnly(p));

/** What follows a completed turn: done when DONE was seen, the continuation while fewer than the cap were sent, else the
 *  cap (the session ends completed either way). */
export function nextStep(finalMessage: string | null | undefined, continuations: number, p: CsoPrereg): "done" | "continuation" | "cap" {
  if (csoDone(finalMessage, p)) return "done";
  return continuations < p.continuation_cap ? "continuation" : "cap";
}

/** One session's limits: the model's allowance (or exactly twice it after stage 1's doubling rule), the wall and the turns. */
export function csoLimits(model: CsoModel, p: CsoPrereg, allowanceUsd?: number): { allowance_usd: number; wall_sec: number; max_turns: number } {
  const l = p.limits as { allowance_usd: Record<string, number>; wall_sec: number; max_turns: number };
  const base = l.allowance_usd[model === "particle" ? "particle-1" : model] ?? csoFail("E_CSO_PREREG", "prereg.json has no allowance for " + model);
  const cap = allowanceUsd ?? base;
  if (cap !== base && cap !== 2 * base) csoFail("E_CSO_SESSION", model + "'s allowance is $" + base + " or, after stage 1's doubling, $" + 2 * base + "; not $" + cap);
  return { allowance_usd: cap, wall_sec: l.wall_sec, max_turns: l.max_turns };
}

/** Claude Code's environment: h2h's fixed block with this plan's env; GSTACK_SESSION_KIND is never set. */
export function csoClaudeEnv(p: CsoPrereg): Record<string, string> {
  const env = claudeEnv({ env: p.env } as unknown as H2hPrereg);
  delete env.GSTACK_SESSION_KIND;
  return env;
}

/** The config h2h_turns.py reads, in h2h's shape: one scripted turn, the continuation and its cap, the DONE rule, the
 *  limits, WebSearch and WebFetch disallowed, the environment, and the arm's home. */
export function csoConfig(o: { arm: CsoArm; model: CsoModel; home: string | null; allowance?: number }, p: CsoPrereg) {
  const l = csoLimits(o.model, p, o.allowance);
  return {
    schema: "h2h-config.v1", arm: "cso:" + o.arm, turns: [firstTurn(o.arm, p)], continuation: p.texts.continuation, done_rule: p.done_rule, continuation_cap: p.continuation_cap, no_answer: p.texts.question_reply,
    limits: { ...l, ...QUIET }, disallowed_tools: [...(p.disallowed_tools as string[])], env: csoClaudeEnv(p), home: o.home, home_rule: o.arm === "none" ? "none" : "gstack",
  };
}

/** OpenAI's cyber-policy refusal in a Codex transcript: an error or turn failure whose code or message names cyber_policy. */
export function cyberPolicyStop(records: readonly Rec[]): boolean {
  return records.some((r) => {
    const e = r?.error ?? r?.msg?.error ?? r?.item?.error;
    return /cyber_policy/i.test(String(e?.code ?? "") + " " + String(e?.message ?? "") + " " + String(r?.type === "error" ? (r.message ?? "") : ""));
  });
}

export interface EndRead { end: SessionEnd; reason: string | null; retry: boolean }

/** Section 9's end from one attempt's recorded summary and transcript. A cap stop refuses (E_CSO_CAP_STOP): the item ends
 *  incomplete and the session is never retried. */
export function readEnd(summary: Rec | null, attempt: 1 | 2, records: readonly Rec[] = []): EndRead {
  const fallback = records.some((m) => m?.subtype === "model_refusal_fallback" || m?.data?.subtype === "model_refusal_fallback");
  const s = summary && fallback ? { ...summary, refusal_fallback: true } : summary;
  if (s && cyberPolicyStop(records)) return { end: "safety_stop", reason: "E_CSO_STOP_SAFETY OpenAI's cyber-policy refusal", retry: false };
  const e = endOf(s);
  if (e === "cap_stop") return csoFail("E_CSO_CAP_STOP", "the slot was refused at the cap: " + String(s?.slot?.open_refused ?? "the item lease"));
  if (e === "safety_stop") return { end: e, reason: "E_CSO_STOP_SAFETY " + (s?.refusal_fallback ? "Claude Code's refusal fallback, refused at the proxy" : "a refusal stop"), retry: false };
  if (e === "limit_wall" || e === "limit_turns" || e === "limit_allowance") return { end: e, reason: "E_CSO_STOP_LIMIT " + e.slice(6), retry: false };
  if (e === "completed") return { end: e, reason: null, retry: false };
  if (retries(e, attempt, s)) return { end: "gap", reason: null, retry: true };
  const h2h = gapOf(e, attempt, s);
  return { end: "gap", reason: (e === "upstream" ? "E_CSO_GAP_UPSTREAM" : "E_CSO_GAP_INFRA") + " " + (h2h ?? e) + (typeof s?.refused === "string" ? ": " + s.refused.slice(0, 300) : ""), retry: false };
}

export { withRefusalFallback };

/** Every assistant text block the user saw, in order: main-thread assistant messages only, no tool input or output, no
 *  thinking, and not the result record that repeats the last one. */
export function assistantTexts(records: readonly Rec[]): string[] {
  const main = records.filter((r) => r?.type !== "ResultMessage" && r?.type !== "result");
  return events(main as Rec[]).filter((e) => e.kind === "text" && e.role === "assistant" && e.main).map((e) => e.text);
}

const QUOTED = /^["']|["']$/g;
const SHELL_READ = /^(cat|head|tail|sed|less|more|nl|grep|egrep|rg|awk|wc|find|ls|tree|file|strings|xxd|od)$/;
/** A shell command's path words for the tools that read files. */
function shellPaths(cmd: string): string[] {
  const out: string[] = [];
  for (const seg of cmd.split(/&&|\|\||;|\|/)) {
    const w = seg.trim().split(/\s+/).map((x) => x.replace(QUOTED, ""));
    if (!w.length || !SHELL_READ.test(w[0]!)) continue;
    for (const a of w.slice(1)) if (a && !a.startsWith("-") && /[./]/.test(a) && !/[*?$(){}<>]/.test(a) && !/^\d+(,\d+)?p$/.test(a)) out.push(a);
  }
  return out;
}

/** Repository-relative paths the session opened or listed through any tool, in first-seen order: Read, Grep, Glob, LS
 *  and NotebookRead paths, the helper's read argument, and the path words of shell reads. Absolute paths outside repoDir
 *  are kept as they are. */
export function openedPaths(records: readonly Rec[], repoDir: string): string[] {
  const seen = new Set<string>();
  const add = (raw: unknown) => {
    if (typeof raw !== "string" || !raw) return;
    let p = raw.trim();
    if (p.startsWith(repoDir + "/")) p = p.slice(repoDir.length + 1);
    else if (p === repoDir) p = ".";
    p = p.replace(/^\.\//, "");
    if (p) seen.add(p);
  };
  for (const e of events(records as Rec[])) {
    if (e.kind !== "tool_use") continue;
    const i = e.input ?? {};
    if (["Read", "NotebookRead"].includes(e.name!)) add(i.file_path ?? i.notebook_path);
    else if (["Grep", "Glob", "LS"].includes(e.name!)) add(i.path ?? ".");
    else if (e.name === "Bash" && typeof i.command === "string") {
      const h = /gstack-cso-launcher(?:\.exe)?\s+(read|history)\s+\S+\s+(\S+)/.exec(i.command);
      if (h) add(h[2]!.replace(QUOTED, ""));
      else for (const p of shellPaths(i.command)) add(p);
    }
  }
  return [...seen];
}

/** The model id and harness version the session's own init record reported (E_CSO_SESSION when it has none). */
export function sessionIdentity(records: readonly Rec[]): { model_id: string; harness_version: string } {
  for (const r of records) {
    const d = r?.subtype === "init" ? (r.data ?? r) : null;
    if (d && typeof d.model === "string" && typeof d.claude_code_version === "string") return { model_id: d.model, harness_version: d.claude_code_version };
  }
  return csoFail("E_CSO_SESSION", "the transcript holds no init record with the model and Claude Code version");
}

/** One session's record from its last attempt's summary and transcript. Spend and tokens are summed over attempts. */
export function csoSessionRecord(o: {
  unit: string; arm: CsoArm; model: CsoModel; stage: CsoStage; attempts: 1 | 2; end: EndRead; summary: Rec | null; records: readonly Rec[]; repoDir: string;
  exposure: Exposure; helper: HelperRecords; usage: Array<{ spent_micros: number; tokens: SessionRecord["tokens"] }>; wall_sec: number;
}): SessionRecord {
  const id = sessionIdentity(o.records);
  const sum = (k: keyof SessionRecord["tokens"]) => o.usage.reduce((n, u) => n + u.tokens[k], 0);
  return {
    schema: "cso-session.v1", unit: o.unit, arm: o.arm, model: o.model, stage: o.stage, model_id: id.model_id, harness: o.model === "sol" ? "codex" : "claude-code", harness_version: id.harness_version,
    end: o.end.end, reason: o.end.reason, attempts: o.attempts, continuations: Number(o.summary?.continuations ?? 0), done_seen: o.summary?.done === true,
    texts: assistantTexts(o.records), opened: openedPaths(o.records, o.repoDir), helper: o.helper, exposure: o.exposure,
    cost_usd: o.usage.reduce((n, u) => n + u.spent_micros, 0) / 1_000_000, wall_sec: o.wall_sec, turns: ((o.summary?.turns ?? []) as Rec[]).length,
    tokens: { input: sum("input"), output: sum("output"), cache_read: sum("cache_read"), cache_write: sum("cache_write") },
  };
}
