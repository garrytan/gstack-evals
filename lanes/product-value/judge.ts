// Copyright (c) 2026 Garry Tan. MIT License.
// pv judge (prereg 2026-11-08-geva-403, section 7, R78): runs packets through the metered client on one judge item.
// Production label packets (and the shuffled-key and gold packets beside them) go to the production judge of the
// lists they hold: GPT-6 Astra for Opus lists, Opus 5.5 for Sol lists, and for particle-1 lists both of them, with
// Gemini 4 Argon casting a third vote on the cells where they split. Production runs at medium effort; the judge
// check's separate pass runs the audit prompt at maximum effort on Astra and Opus. A packet with a missing or
// unparsable cell is resent once, whole, and the resend's answer replaces the first; a failed tie-break is retried
// once; a cell still missing stays unlabelled (E_PV_LABEL_MISSING). Every record names the judge model and the
// version the provider reported; calls are cached by the meter.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Io } from "./cli.ts";
import { need, parseArgs, PvError, readJson, refuseAliases, refuseInRepo, writeLines } from "./io.ts";
import { MODELS, openMeter, pool, type ModelKey } from "./meter.ts";
import { readPackets, renderPacket, type JudgeKey, type LabelRecord, type PacketFile, type PacketMap, type PacketMeta, type PromptName } from "./packets.ts";
import type { ArmId, Label } from "./types.ts";

/** The judge brief, audit prompt, pairwise prompt and probe prompt, frozen before any arm output exists. */
export const PROMPT_SHA256: Readonly<Record<PromptName, string>> = {
  brief: "268d48bf859b88bcea7edaf296e11c5c3c4675aaf7f821ac7babcf931e48be19",
  audit: "978356dd299672ca0d363d5f86ab14b93ce2d3e6f570a37cbcb85dba49f274ba",
  pairwise: "9144eb115c3f522c49c6a97d29d76efd529dcf72d8918873160004c50ec706c9",
  probe: "9149a1b4557d436f2c9778d0e5d86510f5339dad722f4ff87c419756f198c0de",
};

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export function loadPrompt(name: PromptName): string {
  const text = readFileSync(join(import.meta.dir, "prompts", name + ".md"), "utf8");
  if (sha(text) !== PROMPT_SHA256[name]) throw new PvError("E_USAGE", "lanes/product-value/prompts/" + name + ".md does not match its pinned sha256; the judge prompts are frozen (section 7)");
  return text;
}

export const RESEND_NOTE = "\n\n(This packet is sent a second time because the first answer missed or garbled at least one cell. Answer every cell.)";
export const EFFORT = { production: "medium", check: "max" } as const;
const MAX_TOKENS: Record<PromptName, number> = { brief: 16_000, audit: 32_000, pairwise: 4_000, probe: 2_000 };

export interface Reply {
  text: string | null;
  model_id: string;
  version: string | null;
  problem: string | null;
}
export type Caller = (o: { judge: JudgeKey; prompt: string; effort: string; maxTokens: number; label: string }) => Promise<Reply>;

/** The last JSON object in a reply, inside a code fence or bare. */
export function lastJson(text: string): any {
  const trimmed = text.trim();
  const fences = [...trimmed.matchAll(/```[a-zA-Z]*\n([\s\S]*?)```/g)].map((m) => m[1]!);
  for (const cand of [trimmed, ...fences.reverse(), trimmed.slice(trimmed.indexOf("{"), trimmed.lastIndexOf("}") + 1)]) {
    try {
      const v = JSON.parse(cand);
      if (v && typeof v === "object") return v;
    } catch {}
  }
  return null;
}

export interface Parsed {
  cells: Map<string, { label: Label; quotes?: string[] }>;
  missing: string[];
}
export const cellKey = (list: string, item: string) => list + "|" + item;

/** Reads a label answer against its packet: one valid entry per (list, item) cell; anything else is missing. */
export function parseLabels(text: string | null, packet: PacketFile, audit: boolean): Parsed {
  const sizes = new Map(packet.lists.map((l) => [l.id, l.changes.length]));
  const items = new Set(packet.items.map((i) => i.id));
  const seen = new Map<string, { label: Label; quotes?: string[] } | null>();
  const obj = text === null ? null : lastJson(text);
  for (const e of Array.isArray(obj?.labels) ? obj.labels : []) {
    if (!e || !sizes.has(e.list) || !items.has(e.item) || typeof e.anticipated !== "boolean") continue;
    const k = cellKey(e.list, e.item);
    const n = sizes.get(e.list)!;
    const changes = Array.isArray(e.changes) ? [...new Set<number>(e.changes)].sort((a, b) => a - b) : [];
    const ok = e.anticipated ? changes.length > 0 && changes.every((c) => Number.isInteger(c) && c >= 1 && c <= n) : true;
    const cell = ok ? { label: { anticipated: e.anticipated, changes: e.anticipated ? changes : [] }, ...(audit ? { quotes: Array.isArray(e.quotes) ? e.quotes.map(String) : [] } : {}) } : null;
    const prior = seen.get(k);
    seen.set(k, prior === undefined ? cell : prior && cell && JSON.stringify(prior.label) === JSON.stringify(cell.label) ? prior : null);
  }
  const cells = new Map<string, { label: Label; quotes?: string[] }>();
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
  problem: string | null;
  missing: number;
}

async function labelOnce(p: PacketFile, judge: JudgeKey, effort: string, call: Caller, logs: CallLog[]): Promise<{ parsed: Parsed; reply: Reply }> {
  const audit = p.prompt === "audit";
  const base = loadPrompt(p.prompt).replace("{{PACKET}}", renderPacket(p));
  let reply: Reply = { text: null, model_id: "", version: null, problem: null };
  let parsed: Parsed = { cells: new Map(), missing: [] };
  for (let attempt = 1; attempt <= 2; attempt++) {
    reply = await call({ judge, prompt: attempt === 1 ? base : base + RESEND_NOTE, effort, maxTokens: MAX_TOKENS[p.prompt], label: p.id + ":" + judge + ":" + attempt });
    parsed = parseLabels(reply.text, p, audit);
    logs.push({ packet: p.id, judge, attempt, model_id: reply.model_id, version: reply.version, problem: reply.problem, missing: parsed.missing.length });
    if (!parsed.missing.length) break;
  }
  return { parsed, reply };
}

const record = (p: PacketFile, judge: LabelRecord["judge"], reply: Reply, effort: string, list: string, item: string, cell: { label: Label; quotes?: string[] } | undefined): LabelRecord => ({
  packet: p.id,
  judge,
  model_id: reply.model_id,
  version: reply.version,
  effort,
  list,
  item,
  label: cell?.label ?? null,
  ...(cell?.quotes ? { quotes: cell.quotes } : {}),
});

/**
 * Labels one packet with each of its judges. For a particle-1 panel packet it adds the panel's records: the label both
 * judges gave, or on a split Gemini's vote, and for an anticipated label the union of change indices from the judges
 * that voted anticipated. A panel cell missing either first vote, or a split Gemini leaves open, stays unlabelled.
 */
export async function labelPacket(p: PacketFile, meta: PacketMeta, effort: string, call: Caller, logs: CallLog[]): Promise<LabelRecord[]> {
  const out: LabelRecord[] = [];
  const answers = new Map<JudgeKey, { parsed: Parsed; reply: Reply }>();
  for (const judge of meta.judges) {
    const a = await labelOnce(p, judge, effort, call, logs);
    answers.set(judge, a);
    for (const l of p.lists) for (const i of p.items) out.push(record(p, judge, a.reply, effort, l.id, i.id, a.parsed.cells.get(cellKey(l.id, i.id))));
  }
  if (meta.role === "check" || meta.role === "generic" || meta.judges.length < 2) return out;
  const astra = answers.get("astra")!, opus = answers.get("opus")!;
  const split = p.lists.flatMap((l) => p.items.map((i) => cellKey(l.id, i.id))).filter((k) => astra.parsed.cells.has(k) && opus.parsed.cells.has(k) && astra.parsed.cells.get(k)!.label.anticipated !== opus.parsed.cells.get(k)!.label.anticipated);
  let gemini: { parsed: Parsed; reply: Reply } | null = null;
  if (split.length) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const prompt = loadPrompt(p.prompt).replace("{{PACKET}}", renderPacket(p)) + (attempt === 2 ? RESEND_NOTE : "");
      const reply = await call({ judge: "gemini", prompt, effort, maxTokens: MAX_TOKENS[p.prompt], label: p.id + ":gemini:" + attempt });
      const parsed = parseLabels(reply.text, p, false);
      const open = split.filter((k) => !parsed.cells.has(k)).length;
      logs.push({ packet: p.id, judge: "gemini", attempt, model_id: reply.model_id, version: reply.version, problem: reply.problem, missing: open });
      gemini = { parsed, reply };
      if (!open) break;
    }
    for (const k of split) {
      const [l, i] = k.split("|") as [string, string];
      out.push(record(p, "gemini", gemini!.reply, effort, l, i, gemini!.parsed.cells.get(k)));
    }
  }
  for (const l of p.lists)
    for (const i of p.items) {
      const k = cellKey(l.id, i.id);
      const votes = [astra.parsed.cells.get(k), opus.parsed.cells.get(k)];
      if (split.includes(k)) votes.push(gemini?.parsed.cells.get(k));
      const panel: LabelRecord = { packet: p.id, judge: "panel", model_id: "panel:" + [astra.reply.model_id, opus.reply.model_id, ...(split.includes(k) ? [gemini?.reply.model_id ?? ""] : [])].join("+"), version: [astra.reply.version, opus.reply.version, ...(split.includes(k) ? [gemini?.reply.version ?? null] : [])].join("+"), effort, list: l.id, item: i.id, label: null };
      if (votes.some((v) => !v)) {
        out.push(panel);
        continue;
      }
      const yes = votes.filter((v) => v!.label.anticipated);
      const anticipated = yes.length * 2 > votes.length;
      out.push({ ...panel, label: { anticipated, changes: anticipated ? [...new Set(yes.flatMap((v) => v!.label.changes))].sort((a, b) => a - b) : [] } });
    }
  return out;
}

export interface PairRecord {
  packet: string;
  judge: JudgeKey;
  model_id: string;
  version: string | null;
  choice: "A" | "B" | "tie" | null;
  why: string | null;
}
export interface ProbeRecord {
  packet: string;
  judge: JudgeKey;
  model_id: string;
  version: string | null;
  guess: ArmId | null;
}

async function askOnce<T>(p: PacketFile, judge: JudgeKey, effort: string, call: Caller, logs: CallLog[], read: (obj: any) => T | null): Promise<{ value: T | null; reply: Reply }> {
  const base = loadPrompt(p.prompt).replace("{{PACKET}}", renderPacket(p));
  let out: { value: T | null; reply: Reply } = { value: null, reply: { text: null, model_id: "", version: null, problem: null } };
  for (let attempt = 1; attempt <= 2; attempt++) {
    const reply = await call({ judge, prompt: attempt === 1 ? base : base + RESEND_NOTE, effort, maxTokens: MAX_TOKENS[p.prompt], label: p.id + ":" + judge + ":" + attempt });
    const value = reply.text === null ? null : read(lastJson(reply.text));
    logs.push({ packet: p.id, judge, attempt, model_id: reply.model_id, version: reply.version, problem: reply.problem, missing: value === null ? 1 : 0 });
    out = { value, reply };
    if (value !== null) break;
  }
  return out;
}

export interface JudgeResult {
  labels: LabelRecord[];
  pairs: PairRecord[];
  probes: ProbeRecord[];
  calls: CallLog[];
}

/** Runs every packet of a map with its judges; the pass (production or check) sets the effort. */
export async function judgePackets(o: { map: PacketMap; packets: Map<string, PacketFile>; call: Caller; concurrency: number }): Promise<JudgeResult> {
  const res: JudgeResult = { labels: [], pairs: [], probes: [], calls: [] };
  const effort = o.map.kind === "check" ? EFFORT.check : EFFORT.production;
  const ids = Object.keys(o.map.packets).sort();
  for (const id of ids) if (!o.packets.has(id)) throw new PvError("E_USAGE", "packet " + id + " is in the map but not in the packets directory");
  const jobs = ids.map((id) => async () => {
    const meta = o.map.packets[id]!, p = o.packets.get(id)!;
    if (p.prompt === "pairwise") {
      for (const judge of meta.judges) {
        const a = await askOnce(p, judge, effort, o.call, res.calls, (v) => (v && ["A", "B", "tie"].includes(v.choice) ? { choice: v.choice as "A" | "B" | "tie", why: typeof v.why === "string" ? v.why : "" } : null));
        res.pairs.push({ packet: id, judge, model_id: a.reply.model_id, version: a.reply.version, choice: a.value?.choice ?? null, why: a.value?.why ?? null });
      }
    } else if (p.prompt === "probe") {
      for (const judge of meta.judges) {
        const a = await askOnce(p, judge, effort, o.call, res.calls, (v) => (v && ["none", "lens", "skill"].includes(v.guess) ? (v.guess as ArmId) : null));
        res.probes.push({ packet: id, judge, model_id: a.reply.model_id, version: a.reply.version, guess: a.value });
      }
    } else res.labels.push(...(await labelPacket(p, meta, effort, o.call, res.calls)));
  });
  await pool(o.concurrency, jobs);
  return res;
}

const JUDGE_MODEL: Record<JudgeKey, ModelKey> = { astra: "astra", opus: "opus", gemini: "gemini" };

/** The provider's model string from an upstream request and reply, keyed by the prompt it carried. */
export function versionTap(base: typeof fetch, dir: string): typeof fetch {
  return (async (url: any, init?: any) => {
    const res = await base(url, init);
    try {
      const req = JSON.parse(String(init?.body ?? "null"));
      const prompt = (req?.input ?? req?.messages)?.[0]?.content;
      const body = JSON.parse(await res.clone().text());
      if (typeof prompt === "string" && typeof body?.model === "string") writeFileSync(join(dir, sha(String(req.model) + "\n" + prompt) + ".version"), body.model, { mode: 0o600 });
    } catch {}
    return res;
  }) as typeof fetch;
}

/** Opens the metered client on a judge item and returns a Caller that records each reply's model version. */
export async function openJudge(o: { item: string; runId: string; out: string; cacheDir: string; record?: string; ledger?: string; env?: Record<string, string | undefined>; fetch?: typeof fetch; io: Io }): Promise<{ call: Caller; close: () => Promise<void> }> {
  const vdir = join(o.cacheDir, "versions");
  mkdirSync(vdir, { recursive: true, mode: 0o700 });
  const meter = await openMeter({ item: o.item, runId: o.runId, out: o.out, cacheDir: o.cacheDir, maxOutputTokens: 32_000, record: o.record, ledger: o.ledger, env: o.env, fetch: versionTap(o.fetch ?? fetch, vdir), warn: (code, m) => o.io.err(code + " " + m) });
  const call: Caller = async (c) => {
    const key = JUDGE_MODEL[c.judge];
    const r = await meter.call({ model: key, prompt: c.prompt, maxTokens: c.maxTokens, effort: c.effort, label: c.label });
    const vfile = join(vdir, sha(MODELS[key].id + "\n" + c.prompt) + ".version");
    return { text: r.text, model_id: MODELS[key].provider + ":" + MODELS[key].id, version: existsSync(vfile) ? readFileSync(vfile, "utf8") : null, problem: r.problem };
  };
  return {
    call,
    async close() {
      const closed = await meter.close();
      o.io.out("pv: settled " + (closed.spent_micros / 1e6).toFixed(4) + " dollars on " + o.item + (closed.unknown_micros ? ", " + (closed.unknown_micros / 1e6).toFixed(4) + " unknown" : ""));
    },
  };
}

const USAGE = "gstack-evals pv judge --packets <dir> --map <map.json> --item <ledger item> --run-id <id> --out <dir> --cache <dir> [--record <dir>] [--ledger <path>] [--concurrency n]";

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
  const judge = await openJudge({ item: a.one.item!, runId: a.one["run-id"]!, out: a.one.out!, cacheDir: a.one.cache!, record: a.one.record, ledger: a.one.ledger, env: o.env, fetch: o.fetch, io });
  let result: JudgeResult;
  try {
    result = await judgePackets({ map, packets, call: judge.call, concurrency });
  } finally {
    await judge.close();
  }
  writeLines(join(a.one.out!, "labels.ndjson"), result.labels);
  writeLines(join(a.one.out!, "pairwise.ndjson"), result.pairs);
  writeLines(join(a.one.out!, "probe.ndjson"), result.probes);
  writeLines(join(a.one.out!, "calls.ndjson"), result.calls);
  const unlabelled = result.labels.filter((l) => l.label === null && (l.judge === "panel" || !map.packets[l.packet]!.judges.includes("astra") || map.packets[l.packet]!.judges.length === 1 || map.packets[l.packet]!.role === "check"));
  if (unlabelled.length) io.err("E_PV_LABEL_MISSING " + unlabelled.length + " cells stayed unlabelled after the one resend (or the one tie-break retry); they count against coverage. Raw answers are cached under " + a.one.cache + ", call lines in " + join(a.one.out!, "calls.ndjson"));
  const open = result.pairs.filter((p) => p.choice === null).length + result.probes.filter((p) => p.guess === null).length;
  if (open) io.err("E_PV_LABEL_MISSING " + open + " pairwise or probe answers stayed unread after one resend");
  io.out("pv judge: " + Object.keys(map.packets).length + " packets, " + result.labels.length + " label records, " + result.pairs.length + " pairwise, " + result.probes.length + " probe, " + result.calls.length + " calls; written under " + a.one.out);
  return 0;
}
