// Copyright (c) 2026 Garry Tan. MIT License.
// Plan section 8 (harness plan 15.4): did /cso run? Frozen detectors over one session's transcripts, read against the
// pinned helper's real output (gstack 5afef04, lib/cso/cli.ts): start prints the RunReportV3 JSON (runId
// "<13 digits>-<16 hex>", source.root), inspect prints { report, manifest } whose entries carry their plain path, or the
// path's handle with a displayPath when the helper redacted the path, and never a pathId, read prints the file, submit prints { runId, findings, completeness }, finish prints { runId, status, completeness },
// and a refusal prints {"ok":false,"error":{code,message}} on stderr with exit 1. Loaded: the /cso command block or the
// cso skill's base-directory marker. Procedure ran: a start through gstack-cso-launcher returned a run id, an inspect or
// read used that run, and a finish on it ran. Also read: completeness, findings submitted, tooling errors (a failed
// launcher call with no helper refusal), host file reads after start, and the helper records (snapshot root and handles).
// Stage 0 repair (deviations post, d): a command may bind the launcher or the run id to a shell variable and call through it
// (`R=<run>; L=<launcher>; $L inspect $R`), and may hold several calls. Each command is read with the variables it assigns
// expanded, its own assignments dropped, and every launcher call in it counted. A binding ends with its command, since each
// Bash call starts a fresh shell. When one command's output holds several helper objects, the last one that starts a line is read.
// A start whose JSON the model cut short (Opus piped it through head -100) still names its run by its "runId" line.
import { createHash } from "node:crypto";
import { events, type Ev } from "../h2h/sessions/exposure.ts";
import type { Exposure, HelperRecords } from "./types.ts";

type Rec = Record<string, any>;
export const LAUNCHER = /gstack-cso-launcher(?:\.exe)?['"]?\s+([a-z][a-z0-9-]*)((?:\s+[^\s;&|]+)*)/;
const SHELL_VAR = /(?<=^|[\s;&|(])([A-Za-z_]\w*)=("[^"]*"|'[^']*'|[^\s;&|()]*)|\$\{([A-Za-z_]\w*)\}|\$([A-Za-z_]\w*)/g;
export const RUN_ID = /\b\d{13}-[0-9a-f]{16}\b/;
const START_RUN_ID = /"runId"\s*:\s*"(\d{13}-[0-9a-f]{16})"/;
export const HANDLE = (pathId: string): string => "@cso-path//" + pathId;
/** The pinned helper's path id for one tree-relative path (contracts.ts snapshotPathId): the first 32 hex of the sha256 of
 *  its canonical { kind: "cso-path-v3", path }. It hashes only the relative path, so the unit's tree resolves it. */
export const pathId = (path: string): string => createHash("sha256").update('{"kind":"cso-path-v3","path":' + JSON.stringify(path) + "}").digest("hex").slice(0, 32);
const PRINTED = /@cso-path\/\/([a-f0-9]{32})/g;
const COMMAND_BLOCK = /<command-name>\/?cso<\/command-name>/;
const BASE_DIR = /Base directory for this skill:\s*\S*\/cso\/?(\s|$)/;
const HELPER_REFUSAL = /"ok"\s*:\s*false\s*,\s*"error"\s*:\s*\{\s*"code"/;
const HOST_READ_TOOLS = new Set(["Read", "Grep", "Glob", "LS", "NotebookRead"]);
const SHELL_READ = /(^|[;&|(]\s*)(cat|head|tail|sed|less|more|nl|grep|egrep|rg|awk|find|ls|tree|strings|xxd|od)\s/;

/** One helper call through the launcher: its operation, arguments, output and whether the tool reported an error. */
export interface HelperCall { at: number; op: string; args: string[]; out: string; error: boolean }

/** One command with the variables it assigns expanded where it uses them and its assignments' values dropped. */
export function expandCommand(command: string): string {
  const vars = new Map<string, string>();
  return command.replace(SHELL_VAR, (all, name?: string, value?: string, braced?: string, bare?: string) => {
    if (name === undefined) return vars.get((braced ?? bare)!) ?? all;
    vars.set(name, /^(["']).*\1$/s.test(value!) ? value!.slice(1, -1) : value!);
    return name + "=";
  });
}

/** Every launcher call in order, paired with its result. */
export function helperCalls(evs: readonly Ev[]): HelperCall[] {
  const results = new Map(evs.filter((e) => e.kind === "tool_result" && e.id).map((e) => [e.id!, e]));
  const out: HelperCall[] = [];
  for (const e of evs) {
    if (e.kind !== "tool_use" || e.name !== "Bash" || typeof e.input?.command !== "string") continue;
    const r = e.id ? results.get(e.id) : undefined;
    for (const m of expandCommand(e.input.command).matchAll(new RegExp(LAUNCHER.source, "g"))) {
      out.push({ at: e.at, op: m[1]!, args: m[2]!.trim().split(/\s+/).filter(Boolean).map((a) => a.replace(/^["']|["']$/g, "")), out: r?.text ?? "", error: r ? r.error === true : true });
    }
  }
  return out;
}

/** The JSON object a helper printed, or, when the output holds several, the last one that starts a line, or null. */
export function helperJson(out: string): Rec | null {
  return helperObjects(out).at(-1) ?? null;
}

/** Every JSON object a helper printed: the whole output when it parses as one, else each object that starts a line. */
export function helperObjects(out: string): Rec[] {
  const parse = (t: string): Rec | null => {
    try {
      const v = JSON.parse(t);
      return v && typeof v === "object" ? v : null;
    } catch {
      return null;
    }
  };
  const i = out.indexOf("{"), j = out.lastIndexOf("}");
  if (i < 0 || j <= i) return [];
  const whole = parse(out.slice(i, j + 1));
  if (whole) return [whole];
  const all: Rec[] = [];
  let done = -1;
  for (const { index: at } of out.matchAll(/^\{/gm)) {
    if (at! <= done) continue;
    let depth = 0, str = false, esc = false, end = -1;
    for (let k = at; k < out.length && end < 0; k++) {
      const ch = out[k];
      if (str) [esc, str] = [!esc && ch === "\\", str && (esc || ch !== '"')];
      else if (ch === '"') str = true;
      else if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) end = k;
    }
    const v = end < 0 ? null : parse(out.slice(at, end + 1));
    if (v) {
      all.push(v);
      done = end;
    }
  }
  return all;
}

const COMPLETENESS: Record<string, Exposure["completeness"]> = { complete: "complete", partial: "partial", "not assessed": "not_assessed" };

/** Whether the cso skill body expanded in the session. */
export const loaded = (evs: readonly Ev[]): boolean => evs.some((e) => (e.kind === "context" || e.kind === "tool_result") && (COMMAND_BLOCK.test(e.text) || BASE_DIR.test(e.text)));

const SCOPE_FLAGS = ["--infra", "--code", "--skills", "--supply-chain", "--owasp"];
/** A start's mode and scope as the pinned helper's parseStart reads them: --comprehensive or daily, then one scope flag,
 *  --scope DOMAIN as domain:DOMAIN, or default. */
export function startScope(args: readonly string[], out: Rec | null): string {
  const pol = out?.policy;
  if (typeof pol?.mode === "string" && typeof pol?.scope === "string") return pol.mode + "/" + pol.scope;
  const named = args.includes("--scope") ? args[args.indexOf("--scope") + 1] : undefined;
  return (args.includes("--comprehensive") ? "comprehensive" : "daily") + "/" + (named ? "domain:" + named : (SCOPE_FLAGS.find((f) => args.includes(f))?.slice(2) ?? "default"));
}

/** Section 8's exposure and the helper records from one session's SDK transcript events, read in order. A handle
 *  the helper printed is recorded under the tree path whose id it carries; one that names no path in tree stays unrecorded. */
/** The rerun's detector fixes (GEVA-583 prereg section 4) read one run: the start that made it, its id, which calls are on
 *  it, the finish that counts, and the saved run record for it. */
interface RunRead { start?: HelperCall; run: string | null; on: (c: HelperCall) => boolean; finish?: HelperCall; recordFinished: boolean; record?: Rec }
const FINISHED = /"status"\s*:\s*"finished"|'status': 'finished'|\bexit[=:]\s*0\b/i;
const VIA_SHELL = /^[$`]/;

/** Fix 1: a start the helper didn't refuse names its run when its output prints an id; else, when the saved record holds as
 *  many runs as the session has unrefused starts, the k-th start takes the k-th run by the creation time in its id; else
 *  the first id a later call passes or prints before any other start. Fix 2: a call is on the run when it names the id, or
 *  a shell variable or substitution while the session holds exactly one accepted start. Fix 3: a finish counts when it
 *  printed the helper's finish or exited 0 with no refusal, though a later step of its command failed; or the record shows
 *  the run finished. Of several runs, the first that was used and finished is read, else the first with an id. */
function fixedRun(evs: readonly Ev[], calls: readonly HelperCall[], runOf: (c: HelperCall) => string | null, runRecords: readonly Rec[]): RunRead {
  const refused = (c: HelperCall) => HELPER_REFUSAL.test(c.out) && calls.filter((d) => d.at === c.at).length === 1;
  const later = (a: HelperCall, b: HelperCall) => b.at > a.at || (b.at === a.at && calls.indexOf(b) > calls.indexOf(a));
  const starts = calls.filter((c) => c.op === "start");
  const accepted = starts.filter((c) => !refused(c));
  const recorded = runRecords.map((r) => String(r?.runId ?? "")).filter((v) => RUN_ID.test(v)).sort();
  const byOrder = recorded.length === accepted.length;
  const idFor = (c: HelperCall, k: number): string | null => {
    const printed = runOf(c) ?? RUN_ID.exec(c.out)?.[0];
    if (printed) return printed;
    if (byOrder) return recorded[k]!;
    const next = starts.find((s) => later(c, s));
    for (const d of calls) {
      if (!later(c, d) || d.at !== c.at) continue;
      if (d.op === "start") return null;
      const m = RUN_ID.exec(d.args.join(" "));
      if (m) return m[0];
    }
    for (const e of evs) {
      if (e.at <= c.at || (next && e.at >= next.at) || (e.kind !== "tool_use" && e.kind !== "tool_result")) continue;
      const m = RUN_ID.exec(e.text);
      if (m) return m[0];
    }
    return null;
  };
  const reads = accepted.map((start, k) => {
    const run = idFor(start, k);
    const on = (c: HelperCall) => run !== null && later(start, c) && (c.args[0] === run || (VIA_SHELL.test(c.args[0] ?? "") && accepted.length === 1));
    const finish = calls.filter((c) => on(c) && c.op === "finish" && !refused(c) && (!c.error || (FINISHED.test(c.out) && !c.out.includes("<tool_use_error>")))).at(-1);
    const record = runRecords.find((r) => r?.runId === run);
    return { start, run, on, finish, record, recordFinished: record?.status === "finished", used: calls.some((c) => on(c) && (c.op === "inspect" || c.op === "read")) };
  }).filter((r) => r.run !== null);
  return reads.find((r) => r.used && (r.finish !== undefined || r.recordFinished)) ?? reads[0] ?? { run: null, on: () => false, recordFinished: false };
}

/** csoExposure's options: fixed reads exposure with the rerun's detector fixes, over runRecords, the helper's run records
 *  (report.json) saved from the session container. Without fixed, the frozen GEVA-561 detector runs unchanged. */
export interface ExposureOptions { fixed?: boolean; runRecords?: readonly Rec[] }

export function csoExposure(records: readonly Rec[], tree: readonly string[] = [], opts: ExposureOptions = {}): { exposure: Exposure; helper: HelperRecords } {
  const evs = events(records as Rec[]);
  const calls = helperCalls(evs);
  const runOf = (c: HelperCall): string | null => {
    const j = helperJson(c.out);
    const v = j ? String(j.runId ?? "") : (START_RUN_ID.exec(c.out)?.[1] ?? "");
    return RUN_ID.test(v) ? v : null;
  };
  const read: RunRead = opts.fixed ? fixedRun(evs, calls, runOf, opts.runRecords ?? []) : (() => {
    const start = calls.find((c) => c.op === "start" && !c.error && runOf(c) !== null);
    const run = start ? runOf(start) : null;
    const on = (c: HelperCall) => start !== undefined && c.at > start.at && c.args[0] === run;
    return { start, run, on, finish: calls.filter((c) => on(c) && c.op === "finish" && !c.error).at(-1), recordFinished: false };
  })();
  const { start, run, finish } = read;
  const after = read.on;
  const used = calls.some((c) => after(c) && (c.op === "inspect" || c.op === "read"));
  const fin = finish ? helperJson(finish.out) : null;
  const submits = calls.filter((c) => after(c) && c.op === "submit" && !c.error).map((c) => helperObjects(c.out).filter((j) => typeof j.findings === "number").at(-1)).filter((j): j is Rec => j !== undefined);
  const helper: HelperRecords = { snapshot_root: null, handles: {} };
  const root = start ? helperJson(start.out)?.source?.root : undefined;
  if (typeof root === "string" && root) helper.snapshot_root = root;
  const ids = new Map(tree.map((p) => [pathId(p), p]));
  for (const c of calls) {
    if (c.error) continue;
    for (const m of c.out.matchAll(PRINTED)) if (ids.has(m[1]!)) helper.handles[m[0]] = ids.get(m[1]!)!;
    if (c.op !== "inspect" && c.op !== "start") continue;
    const j = helperJson(c.out);
    if (!helper.snapshot_root && typeof j?.manifest?.root === "string") helper.snapshot_root = j.manifest.root;
  }
  const hostReads = start ? evs.filter((e) => e.at > start.at && e.kind === "tool_use" && (HOST_READ_TOOLS.has(e.name!) || (e.name === "Bash" && typeof e.input?.command === "string" && !LAUNCHER.test(expandCommand(e.input.command)) && SHELL_READ.test(e.input.command)))).length : 0;
  const exposure: Exposure = {
    loaded: loaded(evs),
    procedure_ran: start !== undefined && used && (finish !== undefined || read.recordFinished),
    run_id: run,
    completeness: fin && typeof fin.completeness === "string" ? (COMPLETENESS[fin.completeness] ?? null) : typeof read.record?.completeness === "string" ? (COMPLETENESS[read.record.completeness] ?? null) : null,
    findings_submitted: submits.length ? Number(submits.at(-1)!.findings) : start ? 0 : null,
    tooling_errors: calls.filter((c) => c.error && !HELPER_REFUSAL.test(c.out)).length,
    host_reads_after_start: hostReads,
    scope: start ? startScope(start.args, helperJson(start.out)) : null,
  };
  return { exposure, helper };
}

/** untold's triggered reading: /cso loaded or the helper started a run without being typed. */
export const untoldTriggered = (e: Exposure): boolean => e.loaded || e.run_id !== null;
