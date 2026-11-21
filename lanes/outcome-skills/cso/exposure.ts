// Copyright (c) 2026 Garry Tan. MIT License.
// Plan section 8 (harness plan 15.4): did /cso run? Frozen detectors over one session's transcripts, read against the
// pinned helper's real output (gstack 5afef04, lib/cso/cli.ts): start prints the RunReportV3 JSON (runId
// "<13 digits>-<16 hex>", source.root), inspect prints { report, manifest } whose entries pair each path with its pathId,
// read prints the file, submit prints { runId, findings, completeness }, finish prints { runId, status, completeness },
// and a refusal prints {"ok":false,"error":{code,message}} on stderr with exit 1. Loaded: the /cso command block or the
// cso skill's base-directory marker. Procedure ran: a start through gstack-cso-launcher returned a run id, an inspect or
// read used that run, and a finish on it ran. Also read: completeness, findings submitted, tooling errors (a failed
// launcher call with no helper refusal), host file reads after start, and the helper records (snapshot root and handles).
import { events, type Ev } from "../h2h/sessions/exposure.ts";
import type { Exposure, HelperRecords } from "./types.ts";

type Rec = Record<string, any>;
export const LAUNCHER = /gstack-cso-launcher(?:\.exe)?['"]?\s+([a-z][a-z0-9-]*)((?:\s+[^\s;&|]+)*)/;
export const RUN_ID = /\b\d{13}-[0-9a-f]{16}\b/;
export const HANDLE = (pathId: string): string => "@cso-path//" + pathId;
const COMMAND_BLOCK = /<command-name>\/?cso<\/command-name>/;
const BASE_DIR = /Base directory for this skill:\s*\S*\/cso\/?(\s|$)/;
const HELPER_REFUSAL = /"ok"\s*:\s*false\s*,\s*"error"\s*:\s*\{\s*"code"/;
const HOST_READ_TOOLS = new Set(["Read", "Grep", "Glob", "LS", "NotebookRead"]);
const SHELL_READ = /(^|[;&|(]\s*)(cat|head|tail|sed|less|more|nl|grep|egrep|rg|awk|find|ls|tree|strings|xxd|od)\s/;

/** One helper call through the launcher: its operation, arguments, output and whether the tool reported an error. */
export interface HelperCall { at: number; op: string; args: string[]; out: string; error: boolean }

/** Every launcher call in order, paired with its result. */
export function helperCalls(evs: readonly Ev[]): HelperCall[] {
  const results = new Map(evs.filter((e) => e.kind === "tool_result" && e.id).map((e) => [e.id!, e]));
  const out: HelperCall[] = [];
  for (const e of evs) {
    if (e.kind !== "tool_use" || e.name !== "Bash" || typeof e.input?.command !== "string") continue;
    const m = LAUNCHER.exec(e.input.command);
    if (!m) continue;
    const r = e.id ? results.get(e.id) : undefined;
    out.push({ at: e.at, op: m[1]!, args: m[2]!.trim().split(/\s+/).filter(Boolean).map((a) => a.replace(/^["']|["']$/g, "")), out: r?.text ?? "", error: r ? r.error === true : true });
  }
  return out;
}

/** The first JSON object a helper printed, or null. */
export function helperJson(out: string): Rec | null {
  const i = out.indexOf("{"), j = out.lastIndexOf("}");
  if (i < 0 || j <= i) return null;
  try {
    const v = JSON.parse(out.slice(i, j + 1));
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
}

const COMPLETENESS: Record<string, Exposure["completeness"]> = { complete: "complete", partial: "partial", "not assessed": "not_assessed" };

/** Whether the cso skill body expanded in the session. */
export const loaded = (evs: readonly Ev[]): boolean => evs.some((e) => (e.kind === "context" || e.kind === "tool_result") && (COMMAND_BLOCK.test(e.text) || BASE_DIR.test(e.text)));

/** Section 8's exposure and the helper records from one session's events (both transcripts, read in order). */
export function csoExposure(records: readonly Rec[]): { exposure: Exposure; helper: HelperRecords } {
  const evs = events(records as Rec[]);
  const calls = helperCalls(evs);
  const start = calls.find((c) => c.op === "start" && !c.error && RUN_ID.test(String(helperJson(c.out)?.runId ?? "")));
  const run = start ? String(helperJson(start.out)!.runId) : null;
  const after = (c: HelperCall) => start !== undefined && c.at > start.at && c.args[0] === run;
  const used = calls.some((c) => after(c) && (c.op === "inspect" || c.op === "read"));
  const finish = calls.filter((c) => after(c) && c.op === "finish" && !c.error).at(-1);
  const fin = finish ? helperJson(finish.out) : null;
  const submits = calls.filter((c) => after(c) && c.op === "submit" && !c.error).map((c) => helperJson(c.out)).filter((j): j is Rec => j !== null && typeof j.findings === "number");
  const helper: HelperRecords = { snapshot_root: null, handles: {} };
  const root = start ? helperJson(start.out)?.source?.root : undefined;
  if (typeof root === "string" && root) helper.snapshot_root = root;
  for (const c of calls) {
    if (c.error || (c.op !== "inspect" && c.op !== "start" && c.op !== "read")) continue;
    const j = helperJson(c.out);
    const entries = (j?.manifest?.entries ?? []) as Rec[];
    for (const en of entries) if (typeof en?.pathId === "string" && /^[a-f0-9]{32}$/.test(en.pathId) && typeof en.path === "string" && !en.path.startsWith("@cso-path//")) helper.handles[HANDLE(en.pathId)] = en.path;
    if (!helper.snapshot_root && typeof j?.manifest?.root === "string") helper.snapshot_root = j.manifest.root;
  }
  const hostReads = start ? evs.filter((e) => e.at > start.at && e.kind === "tool_use" && (HOST_READ_TOOLS.has(e.name!) || (e.name === "Bash" && typeof e.input?.command === "string" && !LAUNCHER.test(e.input.command) && SHELL_READ.test(e.input.command)))).length : 0;
  const exposure: Exposure = {
    loaded: loaded(evs),
    procedure_ran: start !== undefined && used && finish !== undefined,
    run_id: run,
    completeness: fin && typeof fin.completeness === "string" ? (COMPLETENESS[fin.completeness] ?? null) : null,
    findings_submitted: submits.length ? Number(submits.at(-1)!.findings) : start ? 0 : null,
    tooling_errors: calls.filter((c) => c.error && !HELPER_REFUSAL.test(c.out)).length,
    host_reads_after_start: hostReads,
  };
  return { exposure, helper };
}

/** untold's triggered reading: /cso loaded or the helper started a run without being typed. */
export const untoldTriggered = (e: Exposure): boolean => e.loaded || e.run_id !== null;
