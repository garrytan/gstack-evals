// Copyright (c) 2026 Garry Tan. MIT License.
// Judge runs: the pinned brief, audit and detail prompts, the label parse with explicit unlabelled cells, the one whole-packet resend and the particle-1 panel.
// Copied from lanes/devex/score/judge.ts and lanes/aftermath/judge.ts at 5ee7f764232b196a1d0cec5b144a287b792f9c94: the
// metered client is a seam here (seams.ts), the labels are anticipated and screen hit with the 10x detail label, and
// the panel follows M11 and R2-18.
//
// - A cell is labelled or explicitly unlabelled; nothing defaults to "not anticipated". A missing or garbled entry, a
//   conflicting repeat, an index outside the list, and a yes that names no change index (R2-18) are unlabelled.
// - A packet with any unlabelled cell is resent once, whole, with its output cap doubled (K4) and a fixed note. A cell
//   still unlabelled stays so; a review with an unlabelled primary cell counts missing (E_DC_LABEL_MISSING, score.ts).
// - Opus lists are read with Astra's labels and Sol lists with Opus's. particle-1 lists go to Astra and Opus, and Gemini
//   4 Argon labels the whole packet when any cell splits: the anticipated or screen-hit label, a shared yes's edges, or
//   the detail on a pair both credit. The panel's yes takes two votes; its edges are those two judges name; with no
//   two-vote edge, Gemini's; and, under R2-18, with none from Gemini, the other judges' edges, unlabelled only when no
//   judge names one. A detail counts on a pair when two judges carry it, and Gemini's detail labels count on every pair
//   it names. A failed Gemini call is retried once (its resend), then its split cells stay unlabelled.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fail } from "../errors.ts";
import { JUDGE_OF, JUDGING, MONEY } from "../frozen.ts";
import type { LabelCell } from "../types.ts";
import { renderPacket } from "./packets.ts";
import type { JudgeCaller, JudgeReply } from "./seams.ts";
import { cellKey, type EdgeSource, type Judge, type JudgeLabels, type PacketFile, type PacketLabels, type PacketMeta, type RawCell, type ReaderCell } from "./types.ts";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export const PROMPT_DIR = join(import.meta.dir, "..", "prompts", "score");
export type PromptFile = "brief" | "audit" | "detail" | "pairwise" | "arm-guess" | "probe";
/** Build-time prompts, pinned before any arm output exists. */
export const PROMPT_SHA256: Readonly<Record<PromptFile, string>> = {
  brief: "8169b184141421eb3ce6652eb9cf408ca756a233c7e4d87ab4e976dcdf98bd04",
  audit: "20f3789e32ad58191b7cce447a8ffed34f05d741f1ecc0032067e73249e3501a",
  detail: "6e102ad07c167b8dcbbe6db331f2ba07df6b77640bdb346c0bb99f152480b895",
  pairwise: "4e4720db406e3d96102b3b6154c6704d93d46f7dcb4460323ea87320ec4dc59a",
  "arm-guess": "2d3032e3530963247c9af96781ccf8ed4b4e9b773ccf1c1d575d1328d30df6a3",
  probe: "5beedda6fef926ba2684295de84e8846228a40b6bc3c0f59274cffb89f6ac47e",
};

export function loadPrompt(name: PromptFile): string {
  const text = readFileSync(join(PROMPT_DIR, name + ".md"), "utf8");
  if (sha(text) !== PROMPT_SHA256[name]) fail("E_USAGE", "lanes/design-constructed/prompts/score/" + name + ".md does not match its pinned sha256; the score prompts are frozen at build time");
  return text;
}

export const RESEND_NOTE = "\n\n(This packet is sent a second time because the first answer missed or garbled at least one cell. Answer every cell.)";

/** Fills a template's {{NAME}} slots literally, so a "$" in a list never acts as a replacement pattern. */
export const fill = (template: string, slots: Readonly<Record<string, string>>): string => template.replace(/\{\{([A-Z]+)\}\}/g, (m, k: string) => (k in slots ? slots[k]! : m));

/** The whole prompt a judge reads for a packet: the brief or audit prompt, the detail label at 10x, then the packet. */
export const promptFor = (p: PacketFile): string => fill(loadPrompt(p.prompt), { DETAIL: p.tier === "10x" ? loadPrompt("detail") : "", PACKET: renderPacket(p) });
/** The prompt digest: the pinned templates the packet's prompt uses. 2x and 10x packets differ here and in the packet digest. */
export const promptDigest = (p: PacketFile): string => sha(PROMPT_SHA256[p.prompt] + (p.tier === "10x" ? "\n" + PROMPT_SHA256.detail : ""));
export const packetDigest = (p: PacketFile): string => sha(renderPacket(p));
/** A call's cache identity: judge, effort, tier, prompt digest and packet digest. */
export const cacheKeyOf = (judge: Judge, effort: string, p: PacketFile): string => sha([judge, effort, p.tier, promptDigest(p), packetDigest(p)].join("\n"));

/** The last JSON object in a reply, inside a code fence or bare. */
export function lastJson(text: string): any {
  const trimmed = text.trim();
  const fences = [...trimmed.matchAll(/`{3}[a-zA-Z]*\n([\s\S]*?)`{3}/g)].map((m) => m[1]!);
  for (const cand of [trimmed, ...fences.reverse(), trimmed.slice(trimmed.indexOf("{"), trimmed.lastIndexOf("}") + 1)]) {
    try {
      const v = JSON.parse(cand);
      if (v && typeof v === "object") return v;
    } catch {}
  }
  return null;
}

/** Change indices: absent or null reads as none; anything but whole numbers 1 to n is garbled (null). */
const indices = (v: unknown, n: number): number[] | null => {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) return null;
  const out = [...new Set<number>(v as number[])].sort((a, b) => a - b);
  return out.every((c) => Number.isInteger(c) && c >= 1 && c <= n) ? out : null;
};

function readCell(e: any, n: number, tier: PacketFile["tier"], keyed: boolean, audit: boolean): RawCell | null {
  if (typeof e.anticipated !== "boolean" || typeof e.screen_hit !== "boolean") return null;
  const edges = e.anticipated ? indices(e.changes, n) : [];
  const screenEdges = e.screen_hit ? indices(e.screen_changes, n) : [];
  if (edges === null || screenEdges === null) return null;
  let detailEdges: number[] | null = null;
  if (tier === "10x") {
    detailEdges = [];
    if (keyed && e.anticipated) {
      if (!Array.isArray(e.detail_changes)) return null;
      const d = indices(e.detail_changes, n);
      if (d === null || d.some((c) => !edges.includes(c))) return null;
      detailEdges = d;
    }
  }
  const noIndex = (e.anticipated && edges.length === 0) || (e.screen_hit && screenEdges.length === 0);
  return { anticipated: e.anticipated, edges, screenHit: e.screen_hit, screenEdges, detailEdges, noIndex, ...(audit ? { quotes: Array.isArray(e.quotes) ? e.quotes.map(String) : [] } : {}) };
}

/** Reads a label answer against its packet: one valid entry per (list, item) cell; a conflicting repeat or anything else is null. */
export function parseLabels(text: string | null, p: PacketFile): Map<string, RawCell | null> {
  const sizes = new Map(p.lists.map((l) => [l.id, l.changes.length]));
  const keyed = new Map(p.items.map((i) => [i.id, i.detail !== null]));
  const seen = new Map<string, RawCell | null>();
  const obj = text === null ? null : lastJson(text);
  for (const e of Array.isArray(obj?.labels) ? obj.labels : []) {
    if (!e || typeof e !== "object" || !sizes.has(e.list) || !keyed.has(e.item)) continue;
    const k = cellKey(e.list, e.item);
    const cell = readCell(e, sizes.get(e.list)!, p.tier, keyed.get(e.item)!, p.prompt === "audit");
    const prior = seen.get(k);
    seen.set(k, prior === undefined ? cell : prior && cell && JSON.stringify(prior) === JSON.stringify(cell) ? prior : null);
  }
  const out = new Map<string, RawCell | null>();
  for (const l of p.lists) for (const i of p.items) out.set(cellKey(l.id, i.id), seen.get(cellKey(l.id, i.id)) ?? null);
  return out;
}

/** One judge's own reading of a cell: a yes with no index is unlabelled (R2-18). */
export function toLabelCell(raw: RawCell | null): LabelCell {
  if (raw === null) return { kind: "unlabelled", why: "missing or garbled after the one whole-packet resend" };
  if (raw.noIndex) return { kind: "unlabelled", why: "a yes names no change index (R2-18)" };
  return { kind: "labelled", anticipated: raw.anticipated, screenHit: raw.screenHit, anticipatedEdges: raw.anticipated ? raw.edges : [], screenHitEdges: raw.screenHit ? raw.screenEdges : [], detailEdges: raw.detailEdges };
}

const unlabelledCount = (cells: Map<string, RawCell | null>) => [...cells.values()].filter((c) => c === null || c.noIndex).length;

/** Asks one judge for every cell and resends the whole packet once, at twice the cap, when open() still counts a cell. */
export async function ask(p: PacketFile, judge: Judge, effort: "medium" | "max", subject: PacketMeta["model"] | null, call: JudgeCaller, open: (cells: Map<string, RawCell | null>) => number = unlabelledCount): Promise<JudgeLabels> {
  const prompt = promptFor(p);
  const cap = effort === "max" ? MONEY.outputCaps.judgeCheck : MONEY.outputCaps.productionLabels;
  const key = cacheKeyOf(judge, effort, p);
  let reply: JudgeReply = { text: null, modelId: "", version: null, problem: "not called" };
  let cells = new Map<string, RawCell | null>();
  let attempts = 0;
  for (let attempt = 1; attempt <= 2; attempt++) {
    attempts = attempt;
    reply = await call({ judge, prompt: attempt === 1 ? prompt : prompt + RESEND_NOTE, effort, maxTokens: attempt === 1 ? cap : 2 * cap, label: p.id + ":" + judge + ":" + attempt, subject, cacheKey: attempt === 1 ? key : sha(key + "\nresend") });
    cells = parseLabels(reply.text, p);
    if (open(cells) === 0) break;
  }
  return { packet: p.id, judge, modelId: reply.modelId, version: reply.version, effort, cacheKey: key, attempts, cells };
}

const same = (x: readonly number[], y: readonly number[]) => x.length === y.length && x.every((v, i) => v === y[i]);

/** Whether Astra's and Opus's cells split, which sends the cell to Gemini (M11). */
export function splits(a: RawCell, o: RawCell): boolean {
  if (a.anticipated !== o.anticipated || a.screenHit !== o.screenHit) return true;
  if (a.anticipated && !same(a.edges, o.edges)) return true;
  if (a.screenHit && !same(a.screenEdges, o.screenEdges)) return true;
  if (a.detailEdges && o.detailEdges) for (const c of a.edges) if (o.edges.includes(c) && a.detailEdges.includes(c) !== o.detailEdges.includes(c)) return true;
  return false;
}

type Vote = { yes: false } | { yes: true; edges: number[]; via: EdgeSource } | { yes: true; edges: null };

function vote(voters: readonly RawCell[], gemini: RawCell | null, yes: (c: RawCell) => boolean, edges: (c: RawCell) => number[]): Vote {
  const ys = voters.filter(yes);
  if (ys.length * 2 <= voters.length) return { yes: false };
  const count = new Map<number, number>();
  for (const v of ys) for (const c of edges(v)) count.set(c, (count.get(c) ?? 0) + 1);
  const two = [...count.keys()].filter((c) => count.get(c)! >= 2).sort((a, b) => a - b);
  if (two.length) return { yes: true, edges: two, via: "two-vote" };
  if (gemini && yes(gemini) && edges(gemini).length) return { yes: true, edges: edges(gemini), via: "gemini" };
  const others = [...count.keys()].sort((a, b) => a - b);
  return others.length ? { yes: true, edges: others, via: "others" } : { yes: true, edges: null };
}

/**
 * The panel's cell from Astra's, Opus's and (when asked) Gemini's raw cells. A cell missing either first vote, or a
 * split cell Gemini left missing after its retry, is unlabelled; so is a yes no judge names an index for (R2-18).
 */
export function panelCell(a: RawCell | null, o: RawCell | null, g: RawCell | null | undefined, tenX: boolean): ReaderCell {
  if (a === null || o === null) return { kind: "unlabelled", why: "a panel member's cell is missing after the one resend" };
  const asked = splits(a, o);
  if (asked && !g) return { kind: "unlabelled", why: "a failed Gemini tie-break, after its one retry" };
  const voters = asked ? [a, o, g!] : [a, o];
  const gem = asked ? g! : null;
  const ant = vote(voters, gem, (c) => c.anticipated, (c) => c.edges);
  const scr = vote(voters, gem, (c) => c.screenHit, (c) => c.screenEdges);
  if ((ant.yes && ant.edges === null) || (scr.yes && scr.edges === null)) return { kind: "unlabelled", why: "the panel's yes has no change index from any judge (R2-18)" };
  const anticipatedEdges = ant.yes ? ant.edges! : [];
  const detailEdges = !tenX ? null : anticipatedEdges.filter((c) => voters.filter((v) => v.anticipated && v.edges.includes(c) && (v.detailEdges ?? []).includes(c)).length >= 2);
  return { kind: "labelled", anticipated: ant.yes, screenHit: scr.yes, anticipatedEdges, screenHitEdges: scr.yes ? scr.edges! : [], detailEdges, ...(ant.yes ? { via: (ant as { via: EdgeSource }).via } : {}) };
}

/**
 * Labels one packet. A check-pass packet goes to all three families at maximum effort and has no reader. Every other
 * packet goes to its model's reader at medium effort: Astra or Opus alone, or the panel with Gemini on split cells.
 */
export async function labelPacket(p: PacketFile, meta: PacketMeta, call: JudgeCaller): Promise<PacketLabels> {
  if (meta.id !== p.id) fail("E_USAGE", "packet " + p.id + " is paired with the map entry of " + meta.id);
  const keys = p.lists.flatMap((l) => p.items.map((i) => cellKey(l.id, i.id)));
  if (meta.role === "check") {
    const judges = await Promise.all((["astra", "opus", "argon"] as const).map((j) => ask(p, j, JUDGING.checkEffort, meta.model, call)));
    return { packet: p.id, judges, reader: new Map() };
  }
  const effort = JUDGING.productionEffort;
  const reader = JUDGE_OF[meta.model];
  if (reader !== "panel") {
    const j = await ask(p, reader, effort, meta.model, call);
    return { packet: p.id, judges: [j], reader: new Map(keys.map((k) => [k, toLabelCell(j.cells.get(k) ?? null)])) };
  }
  const [a, o] = await Promise.all([ask(p, "astra", effort, meta.model, call), ask(p, "opus", effort, meta.model, call)]);
  const split = keys.filter((k) => {
    const x = a.cells.get(k), y = o.cells.get(k);
    return x && y && splits(x, y);
  });
  const judges = [a, o];
  let g: JudgeLabels | null = null;
  if (split.length) {
    g = await ask(p, "argon", effort, meta.model, call, (cells) => split.filter((k) => !cells.get(k)).length);
    judges.push(g);
  }
  const cells = new Map<string, ReaderCell>(keys.map((k) => [k, panelCell(a.cells.get(k) ?? null, o.cells.get(k) ?? null, g?.cells.get(k), p.tier === "10x")]));
  return { packet: p.id, judges, reader: cells };
}

/** Labels every packet of a build in order; the integrator's caller runs them under the judge item's concurrency. */
export async function labelAll(built: { packets: readonly PacketFile[]; metas: readonly PacketMeta[] }, call: JudgeCaller): Promise<PacketLabels[]> {
  const metas = new Map(built.metas.map((m) => [m.id, m]));
  const out: PacketLabels[] = [];
  for (const p of built.packets) {
    const m = metas.get(p.id);
    if (!m) fail("E_USAGE", "packet " + p.id + " has no map entry");
    out.push(await labelPacket(p, m!, call));
  }
  return out;
}
