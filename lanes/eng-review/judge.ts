// Copyright (c) 2026 Garry Tan. MIT License.
// er judge (prereg 2026-11-08-geva-405, section 7, R78): runs a map's packets through the product-value lane's metered
// judge client (meter.ts) on one named ledger item, in the map's order. Rules:
// - Routing: label, shuffled and gold packets go to the production judge of the lists they hold: GPT-6 Astra for Opus
//   lists, Opus 5.5 for Sol lists, and for particle-1 lists both, with Gemini 4 Argon voting on split cells and the
//   median of three taken. The judge check's packets go to Astra and Opus with the audit prompt; Gemini settles the cells
//   where they disagree (printed only). Pairwise packets go to the production judge of their model; arm-guess and
//   recognition packets to Astra. Generic-screen packets go to Astra and Opus, each on its own.
// - Effort: medium in production, generic, pairwise, arm-guess and recognition; maximum in the judge check.
// - A packet with a missing or unparsable cell is resent once, whole, and the resend's answer replaces the first; a failed
//   Gemini tie-break is retried once; a cell still missing stays unlabelled (E_ER_LABEL_MISSING).
// - Every record names the judge model, the provider's version string and the effort, with the prompt's and packet's
//   sha256. The meter caches each call by model and request digest, which holds the prompt and the packet.
// - A provider other than the route's pin stops the run (E_ER_PROVIDER_DRIFT).
// Build-time choices: an anticipated label implies path_hit (its checks join path_checks); an anticipated cell needs
// credit "check" or "code"; a panel cell is split when Astra and Opus differ on anticipated or path_hit, each label takes
// the majority, check indices are the union over the judges that voted yes, and credit is the majority over the judges
// that voted anticipated, a tie taking "check". The resend appends a fixed note, so it never reads the cached answer.
import { join } from "node:path";
import type { Io } from "./cli.ts";
import { need, parseArgs, PvError, readJson, refuseAliases, refuseInRepo, writeLines } from "../product-value/io.ts";
import { lastJson, openJudge, RESEND_NOTE, type Caller as PvCaller } from "../product-value/judge.ts";
import { pool } from "../product-value/meter.ts";
import { readFileSync } from "node:fs";
import { packetDigest, readPackets, renderPacket, sha256, type JudgeKey, type LabelRecord, type PacketFile, type PacketMap, type PacketMeta, type PromptName } from "./packets.ts";
import type { Label } from "./types.ts";

/** The judge brief, audit prompt, pairwise prompt, arm-guess probe and recognition probe, frozen before any arm output. */
export const PROMPT_SHA256: Readonly<Record<PromptName, string>> = {
  brief: "cb88ae649925d4a7fe764bdcfa72bf0346cb8cc917dd3109a8fc881cfab651a6",
  audit: "de1d2903996307c4ba485d22856406d429c118478f98688bb4438ea348cb83e3",
  pairwise: "2fdc3a22897e66c243f007fc60fa282d00d0fc57f6a5543fdd231d417730b7af",
  armguess: "416f6c769aac5f87f74f459ef242fe16986039645f883dfa4b55fdbffb5879f8",
  recognition: "6ae82d66c677f47d665094acecfa35a4f08daa63bd4d6dc873f0a354cde1ec53",
};

export function loadPrompt(name: PromptName): string {
  const text = readFileSync(join(import.meta.dir, "prompts", name + ".md"), "utf8");
  if (sha256(text) !== PROMPT_SHA256[name]) throw new PvError("E_USAGE", "lanes/eng-review/prompts/" + name + ".md does not match its pinned sha256; the judge prompts are frozen (section 7)");
  return text;
}

export const EFFORT = { production: "medium", check: "max" } as const;
const MAX_TOKENS: Record<PromptName, number> = { brief: 16_000, audit: 32_000, pairwise: 4_000, armguess: 2_000, recognition: 4_000 };

export interface Reply {
  text: string | null;
  model_id: string;
  version: string | null;
  problem: string | null;
}
export type Caller = (o: { judge: JudgeKey; prompt: string; effort: string; maxTokens: number; label: string }) => Promise<Reply>;

export interface Cell {
  label: Label;
  quotes?: string[];
}
export interface Parsed {
  cells: Map<string, Cell>;
  missing: string[];
}
export const cellKey = (list: string, item: string) => list + "|" + item;

const indices = (v: unknown, n: number): number[] | null => {
  if (!Array.isArray(v)) return null;
  const xs = [...new Set(v)];
  return xs.every((c) => Number.isInteger(c) && (c as number) >= 1 && (c as number) <= n) ? (xs as number[]).sort((a, b) => a - b) : null;
};

/** One answer entry as a label, or null when it breaks the brief's shape. */
export function readEntry(e: any, n: number): Label | null {
  if (!e || typeof e.anticipated !== "boolean" || typeof e.path_hit !== "boolean") return null;
  const checks = e.anticipated ? indices(e.checks, n) : [];
  const pathChecks = e.path_hit ? indices(e.path_checks, n) : [];
  if (!checks || !pathChecks || (e.anticipated && !checks.length) || (e.path_hit && !pathChecks.length)) return null;
  if (e.anticipated && e.credit !== "check" && e.credit !== "code") return null;
  const path = [...new Set([...pathChecks, ...checks])].sort((a, b) => a - b);
  return { anticipated: e.anticipated, checks, path_hit: e.path_hit || e.anticipated, path_checks: path, credit: e.anticipated ? e.credit : null };
}

/** Reads a label answer against its packet: one valid entry per (list, item) cell; anything else is missing. */
export function parseLabels(text: string | null, packet: PacketFile, audit: boolean): Parsed {
  const sizes = new Map(packet.lists.map((l) => [l.id, l.checks.length]));
  const items = new Set(packet.items.map((i) => i.id));
  const seen = new Map<string, Cell | null>();
  const obj = text === null ? null : lastJson(text);
  for (const e of Array.isArray(obj?.labels) ? obj.labels : []) {
    if (!e || !sizes.has(e.list) || !items.has(e.item)) continue;
    const k = cellKey(e.list, e.item);
    const label = readEntry(e, sizes.get(e.list)!);
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

async function labelOnce(p: PacketFile, judge: JudgeKey, effort: string, call: Caller, logs: CallLog[], prompt: PromptName, only?: readonly string[]): Promise<{ parsed: Parsed; reply: Reply }> {
  const base = loadPrompt(prompt).replace("{{PACKET}}", renderPacket(p));
  let reply: Reply = { text: null, model_id: "", version: null, problem: null };
  let parsed: Parsed = { cells: new Map(), missing: [] };
  for (let attempt = 1; attempt <= 2; attempt++) {
    reply = await call({ judge, prompt: attempt === 1 ? base : base + RESEND_NOTE, effort, maxTokens: MAX_TOKENS[prompt], label: p.id + ":" + judge + ":" + attempt });
    parsed = parseLabels(reply.text, p, prompt === "audit");
    const open = only ? only.filter((k) => !parsed.cells.has(k)).length : parsed.missing.length;
    logs.push({ packet: p.id, judge, attempt, model_id: reply.model_id, version: reply.version, effort, problem: reply.problem, missing: open });
    if (!open) break;
  }
  return { parsed, reply };
}

const record = (p: PacketFile, judge: LabelRecord["judge"], reply: Pick<Reply, "model_id" | "version">, effort: string, list: string, item: string, cell: Cell | undefined): LabelRecord => ({
  packet: p.id, judge, model_id: reply.model_id, version: reply.version, effort, prompt_sha256: PROMPT_SHA256[p.prompt], packet_sha256: packetDigest(p), list, item, label: cell?.label ?? null, ...(cell?.quotes ? { quotes: cell.quotes } : {}),
});

/** The median of two or three votes: majority on each label, union of indices from the yes votes, majority credit. */
export function panelLabel(votes: readonly Label[]): Label {
  const yes = votes.filter((v) => v.anticipated);
  const hit = votes.filter((v) => v.path_hit);
  const anticipated = yes.length * 2 > votes.length;
  const path_hit = hit.length * 2 > votes.length || anticipated;
  const union = (xs: Label[], f: (l: Label) => number[]) => [...new Set(xs.flatMap(f))].sort((a, b) => a - b);
  const code = yes.filter((v) => v.credit === "code").length;
  return { anticipated, checks: anticipated ? union(yes, (l) => l.checks) : [], path_hit, path_checks: path_hit ? union([...hit, ...yes], (l) => [...l.path_checks, ...l.checks]) : [], credit: anticipated ? (code * 2 > yes.length ? "code" : "check") : null };
}

const splits = (a: Label, b: Label) => a.anticipated !== b.anticipated || a.path_hit !== b.path_hit;

/**
 * Labels one packet with each of its judges. A particle-1 panel packet adds the panel's records; a judge-check packet
 * adds Gemini's records on the cells where Astra and Opus disagree on anticipated.
 */
export async function labelPacket(p: PacketFile, meta: PacketMeta, effort: string, call: Caller, logs: CallLog[]): Promise<LabelRecord[]> {
  const out: LabelRecord[] = [];
  const answers = new Map<JudgeKey, { parsed: Parsed; reply: Reply }>();
  for (const judge of meta.judges) {
    const a = await labelOnce(p, judge, effort, call, logs, p.prompt);
    answers.set(judge, a);
    for (const l of p.lists) for (const i of p.items) out.push(record(p, judge, a.reply, effort, l.id, i.id, a.parsed.cells.get(cellKey(l.id, i.id))));
  }
  if (meta.role === "generic" || meta.judges.length < 2) return out;
  const astra = answers.get("astra")!, opus = answers.get("opus")!;
  const keys = p.lists.flatMap((l) => p.items.map((i) => cellKey(l.id, i.id)));
  const both = (k: string) => astra.parsed.cells.has(k) && opus.parsed.cells.has(k);
  const check = meta.role === "check";
  const split = keys.filter((k) => both(k) && (check ? astra.parsed.cells.get(k)!.label.anticipated !== opus.parsed.cells.get(k)!.label.anticipated : splits(astra.parsed.cells.get(k)!.label, opus.parsed.cells.get(k)!.label)));
  let gemini: { parsed: Parsed; reply: Reply } | null = null;
  if (split.length) {
    gemini = await labelOnce(p, "gemini", effort, call, logs, p.prompt, split);
    for (const k of split) {
      const [l, i] = k.split("|") as [string, string];
      out.push(record(p, "gemini", gemini.reply, effort, l, i, gemini.parsed.cells.get(k)));
    }
  }
  if (check) return out;
  for (const k of keys) {
    const [l, i] = k.split("|") as [string, string];
    const votes = [astra.parsed.cells.get(k)?.label, opus.parsed.cells.get(k)?.label];
    if (split.includes(k)) votes.push(gemini?.parsed.cells.get(k)?.label);
    const model_id = "panel:" + [astra.reply.model_id, opus.reply.model_id, ...(split.includes(k) ? [gemini?.reply.model_id ?? ""] : [])].join("+");
    const version = [astra.reply.version, opus.reply.version, ...(split.includes(k) ? [gemini?.reply.version ?? null] : [])].join("+");
    out.push(record(p, "panel", { model_id, version }, effort, l, i, votes.every((v) => v) ? { label: panelLabel(votes as Label[]) } : undefined));
  }
  return out;
}

export interface PairRecord {
  packet: string;
  judge: JudgeKey;
  model_id: string;
  version: string | null;
  effort: string;
  choice: "A" | "B" | "tie" | null;
  why: string | null;
}
export interface GuessRecord {
  packet: string;
  judge: JudgeKey;
  model_id: string;
  version: string | null;
  effort: string;
  guess: "none" | "lens" | "skill" | null;
}

async function askOnce<T>(p: PacketFile, judge: JudgeKey, effort: string, call: Caller, logs: CallLog[], read: (obj: any) => T | null): Promise<{ value: T | null; reply: Reply }> {
  const base = loadPrompt(p.prompt).replace("{{PACKET}}", renderPacket(p));
  let out: { value: T | null; reply: Reply } = { value: null, reply: { text: null, model_id: "", version: null, problem: null } };
  for (let attempt = 1; attempt <= 2; attempt++) {
    const reply = await call({ judge, prompt: attempt === 1 ? base : base + RESEND_NOTE, effort, maxTokens: MAX_TOKENS[p.prompt], label: p.id + ":" + judge + ":" + attempt });
    const value = reply.text === null ? null : read(lastJson(reply.text));
    logs.push({ packet: p.id, judge, attempt, model_id: reply.model_id, version: reply.version, effort, problem: reply.problem, missing: value === null ? 1 : 0 });
    out = { value, reply };
    if (value !== null) break;
  }
  return out;
}

export interface JudgeResult {
  labels: LabelRecord[];
  pairs: PairRecord[];
  guesses: GuessRecord[];
  calls: CallLog[];
}

/** Runs every packet of a map, in its order, with its judges; the map's kind sets the effort. */
export async function judgePackets(o: { map: PacketMap; packets: Map<string, PacketFile>; call: Caller; concurrency: number }): Promise<JudgeResult> {
  const res: JudgeResult = { labels: [], pairs: [], guesses: [], calls: [] };
  const effort = o.map.kind === "check" ? EFFORT.check : EFFORT.production;
  const ids = o.map.order.length ? o.map.order : Object.keys(o.map.packets).sort();
  for (const id of ids) if (!o.packets.has(id) || !o.map.packets[id]) throw new PvError("E_USAGE", "packet " + id + " is in the map's order but not in the packets directory or the map");
  const jobs = ids.map((id) => async () => {
    const meta = o.map.packets[id]!, p = o.packets.get(id)!;
    if (p.prompt === "pairwise") {
      for (const judge of meta.judges) {
        const a = await askOnce(p, judge, effort, o.call, res.calls, (v) => (v && ["A", "B", "tie"].includes(v.choice) ? { choice: v.choice as "A" | "B" | "tie", why: typeof v.why === "string" ? v.why : "" } : null));
        res.pairs.push({ packet: id, judge, model_id: a.reply.model_id, version: a.reply.version, effort, choice: a.value?.choice ?? null, why: a.value?.why ?? null });
      }
    } else if (p.prompt === "armguess") {
      for (const judge of meta.judges) {
        const a = await askOnce(p, judge, effort, o.call, res.calls, (v) => (v && ["none", "lens", "skill"].includes(v.guess) ? (v.guess as "none" | "lens" | "skill") : null));
        res.guesses.push({ packet: id, judge, model_id: a.reply.model_id, version: a.reply.version, effort, guess: a.value });
      }
    } else res.labels.push(...(await labelPacket(p, meta, effort, o.call, res.calls)));
  });
  await pool(o.concurrency, jobs);
  return res;
}

/** Wraps the product-value meter's judge client: its provider-drift stop becomes E_ER_PROVIDER_DRIFT. */
export async function openErJudge(o: Parameters<typeof openJudge>[0]): Promise<{ call: Caller; close: () => Promise<void> }> {
  const j = await openJudge(o);
  const call: Caller = async (c) => {
    try {
      return await (j.call as PvCaller)(c);
    } catch (e) {
      const err = e as { code?: string; message?: string };
      if (err.code === "E_PV_PROVIDER_DRIFT") throw new PvError("E_ER_PROVIDER_DRIFT", String(err.message).replace(/^E_PV_PROVIDER_DRIFT /, ""));
      throw e;
    }
  };
  return { call, close: j.close };
}

const USAGE = "gstack-evals er judge --packets <dir> --map <map.json> --item <ledger item> --run-id <id> --out <dir> --cache <dir> [--record <dir>] [--ledger <path>] [--concurrency n]";

export async function run(argv: string[], io: Io, o: { fetch?: typeof fetch; env?: Record<string, string | undefined> } = {}): Promise<number> {
  const a = parseArgs(argv, { packets: "one", map: "one", item: "one", "run-id": "one", out: "one", cache: "one", record: "one", ledger: "one", concurrency: "one" }, USAGE);
  need(a, ["packets", "map", "item", "run-id", "out", "cache"], USAGE);
  const paths: Array<[string, string]> = [["--packets", a.one.packets!], ["--map", a.one.map!], ["--out", a.one.out!], ["--cache", a.one.cache!]];
  for (const f of ["record", "ledger"]) if (a.one[f]) paths.push(["--" + f, a.one[f]!]);
  refuseAliases(paths);
  for (const f of ["out", "cache"]) refuseInRepo("--" + f, a.one[f]!);
  const concurrency = a.one.concurrency === undefined ? 4 : Number(a.one.concurrency);
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) throw new PvError("E_USAGE", "--concurrency is a whole number of at least 1");
  const map = readJson<PacketMap>(a.one.map!, "packet map");
  const packets = readPackets(a.one.packets!);
  for (const name of Object.keys(PROMPT_SHA256) as PromptName[]) loadPrompt(name);
  const judge = await openErJudge({ item: a.one.item!, runId: a.one["run-id"]!, out: a.one.out!, cacheDir: a.one.cache!, record: a.one.record, ledger: a.one.ledger, env: o.env, fetch: o.fetch, io });
  let result: JudgeResult;
  try {
    result = await judgePackets({ map, packets, call: judge.call, concurrency });
  } finally {
    await judge.close();
  }
  writeLines(join(a.one.out!, "labels.ndjson"), result.labels);
  writeLines(join(a.one.out!, "pairwise.ndjson"), result.pairs);
  writeLines(join(a.one.out!, "armguess.ndjson"), result.guesses);
  writeLines(join(a.one.out!, "calls.ndjson"), result.calls);
  const final = (l: LabelRecord) => {
    const m = map.packets[l.packet]!;
    return m.judges.length > 1 && m.role !== "check" && m.role !== "generic" ? l.judge === "panel" : l.judge !== "gemini";
  };
  const unlabelled = result.labels.filter((l) => final(l) && l.label === null).length;
  if (unlabelled) io.err("E_ER_LABEL_MISSING " + unlabelled + " cells stayed unlabelled after the one resend (or the one tie-break retry); they count against coverage, never as not anticipated. Call lines are in " + join(a.one.out!, "calls.ndjson"));
  const open = result.pairs.filter((p) => p.choice === null).length + result.guesses.filter((g) => g.guess === null).length;
  if (open) io.err("E_ER_LABEL_MISSING " + open + " pairwise or arm-guess answers stayed unread after one resend");
  io.out("er judge: " + Object.keys(map.packets).length + " packets, " + result.labels.length + " label records, " + result.pairs.length + " pairwise, " + result.guesses.length + " arm guesses, " + result.calls.length + " calls; written under " + a.one.out);
  return 0;
}
