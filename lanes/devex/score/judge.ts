// Copyright (c) 2026 Garry Tan. MIT License.
// dx judge (prereg 2026-11-09-geva-417, section 7, R78): runs packets through the shared metered client on one judge item,
// with each call's subject set to the model under test whose lists the packet holds, so a per-model stop cuts only that
// model. Production packets go to the production judge of their lists (Astra for Opus, Opus for Sol, both for particle-1
// with Gemini 4 Argon's third vote on the cells where they split; in stage 1 Astra and Opus read every list, so each
// production judge also labels the other models' lists for the check). Production runs at medium effort, the judge check's
// audit pass at maximum. A packet with a missing or unparsable cell is resent once, whole; a failed tie-break is retried
// once; a cell still missing stays unlabelled (E_DX_LABEL_MISSING). Every record names the judge model, the version the
// provider reported and the effort, and carries a cache key over model, version, prompt digest and packet digest.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { lastJson, readPinned, RESEND_NOTE, versionFile, versionTap } from "../../aftermath/judge.ts";
import { MeterError, MODELS, openMeter, pool, type MeterScope, type ModelKey } from "../../aftermath/meter.ts";
import type { ReasonCode } from "../../../src/errors/codes.ts";
import type { Label, ModelId } from "../types.ts";
import { cellKey, renderPacket, type JudgeKey, type LabelRecord, type PacketFile, type PacketMap, type PacketMeta, type PromptName } from "./packets.ts";

/** The label brief, the audit prompt and the paraphrase prompt, frozen before any arm output exists. */
export const PROMPT_SHA256: Readonly<Record<PromptName, string>> = {
  brief: "b6fe604ecc39eeb5fa0d16f2b8a9e0de98781abf42be3feacb571c672de34b6a",
  audit: "f87930837fa35bb750e507f8e867c586d771b7d33d2645aa0b54e23d4da1c98a",
  paraphrase: "d781580a6104de176178cc279d7708855aa374a90cd279a8ba94180b439b70a4",
};

export class DxJudgeError extends Error {
  constructor(readonly code: ReasonCode, message: string) {
    super(code + " " + message);
  }
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export function loadPrompt(name: PromptName): string {
  const text = readPinned(join(import.meta.dir, "prompts"), name, PROMPT_SHA256[name]);
  if (text === null) throw new DxJudgeError("E_USAGE", "lanes/devex/score/prompts/" + name + ".md does not match its pinned sha256; the judge prompts are frozen (section 7)");
  return text;
}

export const EFFORT = { production: "medium", check: "max" } as const;
const MAX_TOKENS: Record<PromptName, number> = { brief: 16_000, audit: 32_000, paraphrase: 4_000 };

export interface Reply {
  text: string | null;
  model_id: string;
  version: string | null;
  problem: string | null;
}
export type Caller = (o: { judge: JudgeKey; prompt: string; effort: string; maxTokens: number; label: string; subject: ModelId | null }) => Promise<Reply>;

type Cell = { label: Label; quotes?: string[] };
export interface Parsed {
  cells: Map<string, Cell>;
  missing: string[];
}

const indices = (v: unknown, n: number): number[] | null => {
  if (!Array.isArray(v)) return null;
  const out = [...new Set<number>(v as number[])].sort((a, b) => a - b);
  return out.every((c) => Number.isInteger(c) && c >= 1 && c <= n) ? out : null;
};

/** Reads one answer entry: a yes needs at least one valid index; the who label is null exactly when the item has no context. */
function readCell(e: any, n: number, hasContext: boolean): Label | null {
  if (typeof e.anticipated !== "boolean" || typeof e.surface !== "boolean") return null;
  const ch = e.anticipated ? indices(e.changes, n) : [];
  const sc = e.surface ? indices(e.surface_changes, n) : [];
  if (!ch || !sc || (e.anticipated && !ch.length) || (e.surface && !sc.length)) return null;
  if (!hasContext) return e.who === null || e.who === undefined ? { anticipated: e.anticipated, changes: ch, surface: e.surface, surface_changes: sc, who: null, who_changes: [] } : null;
  if (typeof e.who !== "boolean") return null;
  const wc = e.who ? indices(e.who_changes, n) : [];
  if (!wc || (e.who && !wc.length)) return null;
  return { anticipated: e.anticipated, changes: ch, surface: e.surface, surface_changes: sc, who: e.who, who_changes: wc };
}

/** Reads a label answer against its packet: one valid entry per (list, item) cell; a conflicting repeat or anything else is missing. */
export function parseLabels(text: string | null, packet: PacketFile, audit: boolean): Parsed {
  const sizes = new Map(packet.lists.map((l) => [l.id, l.changes.length]));
  const ctx = new Map(packet.items.map((i) => [i.id, i.context !== null]));
  const seen = new Map<string, Cell | null>();
  const obj = text === null ? null : lastJson(text);
  for (const e of Array.isArray(obj?.labels) ? obj.labels : []) {
    if (!e || !sizes.has(e.list) || !ctx.has(e.item)) continue;
    const k = cellKey(e.list, e.item);
    const label = readCell(e, sizes.get(e.list)!, ctx.get(e.item)!);
    const cell = label ? { label, ...(audit ? { quotes: Array.isArray(e.quotes) ? e.quotes.map(String) : [] } : {}) } : null;
    const prior = seen.get(k);
    seen.set(k, prior === undefined ? cell : prior && cell && JSON.stringify(prior.label) === JSON.stringify(cell.label) ? prior : null);
  }
  const cells = new Map<string, Cell>();
  const missing: string[] = [];
  for (const l of packet.lists)
    for (const i of packet.items) {
      const c = seen.get(cellKey(l.id, i.id));
      if (c) cells.set(cellKey(l.id, i.id), c);
      else missing.push(cellKey(l.id, i.id));
    }
  return { cells, missing };
}

export interface CallLog {
  packet: string;
  judge: JudgeKey;
  attempt: number;
  model_id: string;
  version: string | null;
  effort: string;
  problem: string | null;
  missing: number;
}

const promptFor = (p: PacketFile) => loadPrompt(p.prompt).replace("{{PACKET}}", renderPacket(p));
export const cacheKeyOf = (modelId: string, version: string | null, p: PacketFile): string => sha([modelId, version ?? "", PROMPT_SHA256[p.prompt], sha(renderPacket(p))].join("\n"));

/** Asks one judge for every cell; resends the whole packet once when any cell is missing; open lists the cells that matter. */
async function ask(p: PacketFile, judge: JudgeKey, effort: string, subject: ModelId | null, call: Caller, logs: CallLog[], open: (parsed: Parsed) => number): Promise<{ parsed: Parsed; reply: Reply }> {
  const base = promptFor(p);
  let out = { parsed: { cells: new Map(), missing: [] } as Parsed, reply: { text: null, model_id: "", version: null, problem: null } as Reply };
  for (let attempt = 1; attempt <= 2; attempt++) {
    const reply = await call({ judge, prompt: attempt === 1 ? base : base + RESEND_NOTE, effort, maxTokens: MAX_TOKENS[p.prompt], label: p.id + ":" + judge + ":" + attempt, subject });
    const parsed = parseLabels(reply.text, p, p.prompt === "audit");
    const n = open(parsed);
    logs.push({ packet: p.id, judge, attempt, model_id: reply.model_id, version: reply.version, effort, problem: reply.problem, missing: n });
    out = { parsed, reply };
    if (!n) break;
  }
  return out;
}

const FIELDS = [
  ["anticipated", "changes"],
  ["surface", "surface_changes"],
  ["who", "who_changes"],
] as const;

/** The panel's label: per label, the two judges' shared answer or, on a split, the majority with Gemini's vote; yes takes the union of the yes voters' indices. */
export function panelLabel(votes: ReadonlyArray<Label | undefined>, split: boolean): Label | null {
  const used = split ? votes.slice(0, 3) : votes.slice(0, 2);
  if (used.some((v) => !v)) return null;
  const vs = used as Label[];
  const out: any = {};
  for (const [f, idx] of FIELDS) {
    if (vs[0]![f] === null) {
      out[f] = null;
      out[idx] = [];
      continue;
    }
    const yes = vs.filter((v) => v[f] === true);
    const v = yes.length * 2 > vs.length;
    out[f] = v;
    out[idx] = v ? [...new Set(yes.flatMap((x) => x[idx]))].sort((a, b) => a - b) : [];
  }
  return out as Label;
}

const splits = (a: Label, b: Label): boolean => a.anticipated !== b.anticipated || a.surface !== b.surface || a.who !== b.who;

/**
 * Labels one packet with each of its judges. For a two-judge production, shuffled or calibration packet it adds the
 * panel's records: the labels both judges gave, or on a cell where any label splits, the majority with Gemini's vote. A
 * panel cell missing either first vote, or a split Gemini leaves open after its one retry, stays unlabelled.
 */
export async function labelPacket(p: PacketFile, meta: PacketMeta, effort: string, call: Caller, logs: CallLog[]): Promise<LabelRecord[]> {
  const out: LabelRecord[] = [];
  const subject = meta.model;
  const rec = (judge: LabelRecord["judge"], reply: Reply, list: string, item: string, cell: Cell | undefined | null, label?: Label | null): LabelRecord => ({
    packet: p.id,
    judge,
    subject,
    model_id: reply.model_id,
    version: reply.version,
    effort,
    cache_key: cacheKeyOf(reply.model_id, reply.version, p),
    list,
    item,
    label: label !== undefined ? label : (cell?.label ?? null),
    ...(cell?.quotes ? { quotes: cell.quotes } : {}),
  });
  const answers = new Map<JudgeKey, { parsed: Parsed; reply: Reply }>();
  for (const judge of meta.judges) {
    const a = await ask(p, judge, effort, subject, call, logs, (x) => x.missing.length);
    answers.set(judge, a);
    for (const l of p.lists) for (const i of p.items) out.push(rec(judge, a.reply, l.id, i.id, a.parsed.cells.get(cellKey(l.id, i.id))));
  }
  if (meta.role === "check" || meta.role === "generic" || meta.judges.length < 2) return out;
  const astra = answers.get("astra")!, opus = answers.get("opus")!;
  const keys = p.lists.flatMap((l) => p.items.map((i) => cellKey(l.id, i.id)));
  const split = new Set(keys.filter((k) => astra.parsed.cells.has(k) && opus.parsed.cells.has(k) && splits(astra.parsed.cells.get(k)!.label, opus.parsed.cells.get(k)!.label)));
  let gemini: { parsed: Parsed; reply: Reply } | null = null;
  if (split.size) {
    gemini = await ask(p, "gemini", effort, subject, call, logs, (x) => [...split].filter((k) => !x.cells.has(k)).length);
    for (const k of split) {
      const [l, i] = k.split("|") as [string, string];
      out.push(rec("gemini", gemini.reply, l, i, gemini.parsed.cells.get(k)));
    }
  }
  for (const k of keys) {
    const [l, i] = k.split("|") as [string, string];
    const sp = split.has(k);
    const panelReply: Reply = { text: null, model_id: "panel:" + [astra.reply.model_id, opus.reply.model_id, ...(sp ? [gemini?.reply.model_id ?? ""] : [])].join("+"), version: [astra.reply.version, opus.reply.version, ...(sp ? [gemini?.reply.version ?? null] : [])].join("+"), problem: null };
    const label = panelLabel([astra.parsed.cells.get(k)?.label, opus.parsed.cells.get(k)?.label, gemini?.parsed.cells.get(k)?.label], sp);
    out.push(rec("panel", panelReply, l, i, null, label));
  }
  return out;
}

export interface JudgeResult {
  labels: LabelRecord[];
  calls: CallLog[];
  /** Cells the readings use that stayed unlabelled after the one resend or the one tie-break retry (E_DX_LABEL_MISSING). */
  unlabelled: number;
}

/** Runs every packet of a map with its judges; the check pass runs at maximum effort, everything else at medium. */
export async function judgePackets(o: { map: PacketMap; packets: ReadonlyMap<string, PacketFile>; call: Caller; concurrency: number }): Promise<JudgeResult> {
  const res: JudgeResult = { labels: [], calls: [], unlabelled: 0 };
  const effort = o.map.kind === "check" ? EFFORT.check : EFFORT.production;
  const ids = Object.keys(o.map.packets).sort();
  for (const id of ids) if (!o.packets.has(id)) throw new DxJudgeError("E_USAGE", "packet " + id + " is in the map but not in the packets");
  await pool(
    o.concurrency,
    ids.map((id) => async () => {
      res.labels.push(...(await labelPacket(o.packets.get(id)!, o.map.packets[id]!, effort, o.call, res.calls)));
    }),
  );
  for (const l of res.labels) {
    const meta = o.map.packets[l.packet]!;
    const read = meta.judges.length > 1 && meta.role !== "check" && meta.role !== "generic" ? l.judge === "panel" : l.judge !== "gemini";
    if (read && l.label === null) res.unlabelled++;
  }
  return res;
}

/** Asks Argon to paraphrase one verbatim oracle list; resent once when the answer is unreadable or the count differs. */
export async function paraphrase(unit: string, verbatim: readonly string[], call: Caller, logs: CallLog[]): Promise<string[] | null> {
  const p: PacketFile = { id: "para-" + unit, prompt: "paraphrase", items: [], lists: [{ id: "v", changes: [...verbatim] }] };
  const base = promptFor(p);
  for (let attempt = 1; attempt <= 2; attempt++) {
    const reply = await call({ judge: "gemini", prompt: attempt === 1 ? base : base + RESEND_NOTE, effort: EFFORT.production, maxTokens: MAX_TOKENS.paraphrase, label: p.id + ":gemini:" + attempt, subject: null });
    const obj = reply.text === null ? null : lastJson(reply.text);
    const ok = Array.isArray(obj?.changes) && obj.changes.length === verbatim.length && obj.changes.every((c: unknown) => typeof c === "string" && c.trim());
    logs.push({ packet: p.id, judge: "gemini", attempt, model_id: reply.model_id, version: reply.version, effort: EFFORT.production, problem: reply.problem, missing: ok ? 0 : 1 });
    if (ok) return obj.changes.map((c: string) => c.trim());
  }
  return null;
}

const JUDGE_MODEL: Record<JudgeKey, ModelKey> = { astra: "astra", opus: "opus", gemini: "gemini" };

/**
 * Opens the shared metered client on a judge item with the devex drift rule (E_DX_PROVIDER_DRIFT stops only the drifted
 * model) and returns a Caller that sets each call's subject and records the version the provider reported. stop() cuts
 * one model under test (its later judge calls are refused) and leaves every other model on the same open lease.
 */
export async function openJudge(o: { item: string; runId: string; out: string; cacheDir: string; record?: string; ledger?: string; env?: Record<string, string | undefined>; fetch?: typeof fetch; warn?: (line: string) => void }): Promise<{ call: Caller; stop: (subject: ModelId, code: ReasonCode, why: string) => Promise<void>; close: () => Promise<{ spent_micros: number; unknown_micros: number }> }> {
  const vdir = join(o.cacheDir, "versions");
  mkdirSync(vdir, { recursive: true, mode: 0o700 });
  const meter = await openMeter({ item: o.item, runId: o.runId, out: o.out, cacheDir: o.cacheDir, maxOutputTokens: 32_000, record: o.record, ledger: o.ledger, env: o.env, fetch: versionTap(o.fetch ?? fetch, vdir), driftCode: "E_DX_PROVIDER_DRIFT", onDrift: "stop-model", arm: "dx", warn: (code, m) => o.warn?.(code + " " + m) });
  const call: Caller = async (c) => {
    const key = JUDGE_MODEL[c.judge];
    let r: Awaited<ReturnType<typeof meter.call>>;
    try {
      r = await meter.call({ model: key, prompt: c.prompt, maxTokens: c.maxTokens, effort: c.effort, label: c.label, ...(c.subject ? { subject: c.subject } : {}) });
    } catch (e) {
      if (!(e instanceof MeterError)) throw e;
      return { text: null, model_id: MODELS[key].provider + ":" + MODELS[key].id, version: null, problem: e.message };
    }
    const vfile = versionFile(vdir, MODELS[key].id, c.prompt);
    return { text: r.text, model_id: MODELS[key].provider + ":" + MODELS[key].id, version: existsSync(vfile) ? readFileSync(vfile, "utf8") : null, problem: r.problem };
  };
  return {
    call,
    async stop(subject, code, why) {
      await meter.stop({ subject } as MeterScope, code, why);
    },
    close: () => meter.close(),
  };
}
