// Copyright (c) 2026 Garry Tan. MIT License.
// The model-judged checks of key construction (prereg section 3 steps 4 to 7, plan K3 to K5 and M9): the blind audit's
// reply and how two auditors' verdicts combine, validator label packets and their parse (R2-18), the generic screen,
// the unanimous key (step 5) and the give-away check (step 6). Every credit comes from fixedMatching over the items the
// key holds at that step (PD-1, M9). Each check returns what it read, for the sealed record and the funnel.
import { AUTHORING, MONEY, STOCK_ROWS } from "../frozen.ts";
import { fixedMatching } from "../score/match.ts";
import type { AnyModel, KeyItem, LabelCell, Matching } from "../types.ts";
import type { CallRequest, Caller, Deps } from "./seams.ts";
import { labelPacket } from "./prompts.ts";
import { lastJsonObject } from "./text.ts";

/** Who wrote a reply and what it cost to get one: the attempts it took (1 or 2) and the parse failure, if any. */
export type Asked<T> = { ok: true; value: T; attempts: number } | { ok: false; reason: string; attempts: number };

/**
 * One call with K4's one resend: a reply that doesn't parse is sent again once, with the output cap doubled so the
 * reply cache can't answer it with the failed reply. A second failure returns the reason.
 */
export async function ask<T>(call: Caller, req: CallRequest, parse: (text: string) => T | string): Promise<Asked<T>> {
  let reason = "";
  for (let attempt = 1; attempt <= 1 + AUTHORING.resendsPerReply; attempt++) {
    const r = await call({ ...req, maxTokens: req.maxTokens * attempt, label: req.label + ":" + attempt });
    const v = parse(r.text);
    if (typeof v !== "string") return { ok: true, value: v, attempts: attempt };
    reason = v;
  }
  return { ok: false, reason, attempts: 1 + AUTHORING.resendsPerReply };
}

// ---- The audit (K3)

export const INPUT_FAILURES = ["plan-signposts", "evidence-recommends", "dated-after-plan", "real-person", "method-wording"] as const;
export type Verdict = "keep" | "fix" | "drop";

export interface AuditReply {
  items: { id: string; verdict: Verdict; reason: string; mentioned: boolean }[];
  inputFailures: { check: string; reason: string }[];
}

/** An auditor's reply: every audited item exactly once with a verdict, and input failures from the named list only. */
export function parseAudit(text: string, ids: readonly string[], x2: boolean): AuditReply | string {
  const j = lastJsonObject(text);
  if (!j || !Array.isArray(j.items)) return "no audit JSON with items";
  const allowed: readonly string[] = x2 ? [...INPUT_FAILURES, "decoy"] : INPUT_FAILURES;
  const items: AuditReply["items"] = [];
  for (const v of j.items) {
    const o = v as Record<string, unknown>;
    if (!o || typeof o.id !== "string" || !["keep", "fix", "drop"].includes(o.verdict as string)) return "an audit item lacks an id or a keep, fix or drop verdict";
    if (o.mentioned !== undefined && typeof o.mentioned !== "boolean") return "an audit item's mentioned is not true or false";
    items.push({ id: o.id, verdict: o.verdict as Verdict, reason: typeof o.reason === "string" ? o.reason : "", mentioned: o.mentioned === true });
  }
  const got = items.map((i) => i.id).sort();
  if (got.length !== ids.length || [...ids].sort().some((id, n) => got[n] !== id)) return "the audit doesn't give each item exactly once";
  const raw = j.input_failures ?? [];
  if (!Array.isArray(raw)) return "input_failures is not a list";
  const inputFailures: AuditReply["inputFailures"] = [];
  for (const v of raw) {
    const o = v as Record<string, unknown>;
    if (!o || typeof o.check !== "string" || !allowed.includes(o.check)) return "an input failure names no listed check";
    inputFailures.push({ check: o.check, reason: typeof o.reason === "string" ? o.reason : "" });
  }
  return { items, inputFailures };
}

/** Both auditors' replies, by auditor. */
export type Audits = Partial<Record<AnyModel, AuditReply>>;

export interface AuditReading {
  inputFailures: { auditor: AnyModel; check: string; reason: string }[];
  /** Items either auditor drops. */
  drop: string[];
  /** Items either auditor marks fix and neither drops. */
  fix: string[];
  /** Items either auditor flags mentioned. */
  mentioned: string[];
  /** Every item verdict with its reason, for the fix prompt's notes. */
  notes: { auditor: string; id: string; verdict: Verdict; reason: string }[];
}

/** How two auditors' verdicts combine: an input failure from either; an item either drops; fix from either. */
export function readAudits(a: Audits): AuditReading {
  const out: AuditReading = { inputFailures: [], drop: [], fix: [], mentioned: [], notes: [] };
  for (const [auditor, r] of Object.entries(a) as [AnyModel, AuditReply][]) {
    for (const f of r.inputFailures) out.inputFailures.push({ auditor, ...f });
    for (const i of r.items) {
      out.notes.push({ auditor, id: i.id, verdict: i.verdict, reason: i.reason });
      if (i.verdict === "drop" && !out.drop.includes(i.id)) out.drop.push(i.id);
      if (i.mentioned && !out.mentioned.includes(i.id)) out.mentioned.push(i.id);
    }
  }
  for (const n of out.notes) if (n.verdict === "fix" && !out.drop.includes(n.id) && !out.fix.includes(n.id)) out.fix.push(n.id);
  for (const l of [out.drop, out.fix, out.mentioned]) l.sort();
  return out;
}

/** Runs both auditors once each, with K4's resend; null when either reply fails to parse twice (the unit drops, BT). */
export async function runAudits(deps: Deps, auditors: readonly AnyModel[], prompt: string, ids: readonly string[], label: string, x2: boolean): Promise<{ audits: Audits; attempts: number } | { audits: null; reason: string; attempts: number }> {
  const audits: Audits = {};
  let attempts = 0;
  for (const m of auditors) {
    const r = await ask(deps.call, { model: m, effort: "high", maxTokens: MONEY.outputCaps.audit, prompt, label: label + ":" + m }, (t) => parseAudit(t, ids, x2));
    attempts += r.attempts;
    if (!r.ok) return { audits: null, reason: m + "'s audit reply didn't parse twice: " + r.reason, attempts };
    audits[m] = r.value;
  }
  return { audits, attempts };
}

// ---- Label packets (section 6's labels, R2-18)

export interface LabelList {
  id: string;
  changes: readonly string[];
}

/** One packet's cells: list id to item id to cell. Every pair is present, labelled or explicitly unlabelled. */
export type Cells = Record<string, Record<string, LabelCell>>;

const indexList = (v: unknown, n: number): number[] | null => {
  if (!Array.isArray(v)) return null;
  const out = new Set<number>();
  for (const x of v) {
    if (typeof x !== "number" || !Number.isInteger(x) || x < 1 || x > n) return null;
    out.add(x);
  }
  return [...out].sort((a, b) => a - b);
};

/**
 * A label reply's cells. A missing pair, a malformed label, an index outside the list, a yes with no change index
 * (R2-18) or, on a detail packet, an anticipated yes on a detailed item without detail_changes inside its anticipated
 * changes, is unlabelled. On packets without details every detailEdges is null.
 */
export function parseLabels(text: string, lists: readonly LabelList[], items: readonly { id: string; detail: string | null }[], details: boolean): Cells {
  const j = lastJsonObject(text);
  const got = new Map<string, Record<string, unknown>>();
  if (j && Array.isArray(j.cells)) for (const c of j.cells) {
    const o = c as Record<string, unknown>;
    if (o && typeof o.list === "string" && typeof o.item === "string" && !got.has(o.list + "\u0000" + o.item)) got.set(o.list + "\u0000" + o.item, o);
  }
  const out: Cells = {};
  for (const l of lists) {
    out[l.id] = {};
    for (const it of items) {
      const o = got.get(l.id + "\u0000" + it.id);
      const un = (why: string): LabelCell => ({ kind: "unlabelled", why });
      let cell: LabelCell;
      if (!o) cell = un(j ? "no cell" : "no label JSON");
      else if (typeof o.anticipated !== "boolean" || typeof o.screen_hit !== "boolean") cell = un("a label is not true or false");
      else {
        const ant = o.anticipated ? indexList(o.anticipated_changes, l.changes.length) : [];
        const hit = o.screen_hit ? indexList(o.screen_hit_changes, l.changes.length) : [];
        if (ant === null || hit === null) cell = un("a change index outside the list");
        else if ((o.anticipated && !ant.length) || (o.screen_hit && !hit.length)) cell = un("a yes with no change index");
        else if (!details || it.detail === null || !o.anticipated) cell = { kind: "labelled", anticipated: o.anticipated, screenHit: o.screen_hit, anticipatedEdges: ant, screenHitEdges: hit, detailEdges: details ? [] : null };
        else {
          const det = indexList(o.detail_changes, l.changes.length);
          if (det === null || det.some((d) => !ant.includes(d))) cell = un("detail changes missing or outside the anticipated changes");
          else cell = { kind: "labelled", anticipated: true, screenHit: o.screen_hit, anticipatedEdges: ant, screenHitEdges: hit, detailEdges: det };
        }
      }
      out[l.id]![it.id] = cell;
    }
  }
  return out;
}

export const unlabelled = (c: Cells): number => Object.values(c).reduce((s, row) => s + Object.values(row).filter((x) => x.kind === "unlabelled").length, 0);

/** One label packet with the one whole-packet resend when any cell is unlabelled. ok is false when the resend still has one. */
export async function labelRound(call: Caller, judge: AnyModel, items: readonly KeyItem[], lists: readonly LabelList[], details: boolean, cap: number, label: string): Promise<{ ok: boolean; cells: Cells; attempts: number }> {
  const view = items.map((i) => ({ id: i.id, statement: i.statement, detail: details ? i.detail : null }));
  const prompt = labelPacket(view, lists, details);
  let cells: Cells = {};
  for (let attempt = 1; attempt <= 1 + AUTHORING.resendsPerReply; attempt++) {
    const r = await call({ model: judge, effort: "medium", maxTokens: cap * attempt, prompt, label: label + ":" + judge + ":" + attempt });
    cells = parseLabels(r.text, lists, view, details);
    if (!unlabelled(cells)) return { ok: true, cells, attempts: attempt };
  }
  return { ok: false, cells, attempts: 1 + AUTHORING.resendsPerReply };
}

// ---- The generic screen (K5, PD-3)

export interface GenericReading {
  generic: string[];
  /** Items made generic only because a cell stayed missing after the resend (fail closed, BT). */
  missing: string[];
  cells: Partial<Record<AnyModel, Cells>>;
}

/** Astra and Opus label every key item against stock rows 1 and 2 as if they were reviews; row 3 never screens. */
export async function genericScreen(call: Caller, items: readonly KeyItem[], label: string): Promise<GenericReading> {
  const lists: LabelList[] = STOCK_ROWS.filter((r) => r.row !== 3).map((r) => ({ id: "list-" + r.row, changes: r.changes }));
  const generic = new Set<string>();
  const missing = new Set<string>();
  const cells: GenericReading["cells"] = {};
  for (const m of AUTHORING.genericScreenLabellers) {
    const r = await labelRound(call, m, items, lists, false, MONEY.outputCaps.genericScreenLabels, label + ":generic");
    cells[m] = r.cells;
    for (const it of items)
      for (const l of lists) {
        const c = r.cells[l.id]![it.id]!;
        if (c.kind === "unlabelled") missing.add(it.id);
        else if (c.anticipated) generic.add(it.id);
      }
  }
  for (const id of missing) generic.add(id);
  return { generic: [...generic].sort(), missing: [...missing].filter((id) => !itemsAnticipated(cells, id)).sort(), cells };
}

const itemsAnticipated = (cells: GenericReading["cells"], id: string): boolean => Object.values(cells).some((c) => Object.values(c!).some((row) => row[id]?.kind === "labelled" && row[id]!.anticipated));

// ---- Steps 5 and 6 (M9)

export type Validator = keyof typeof AUTHORING.validators;
export const VALIDATORS = Object.keys(AUTHORING.validators) as Validator[];

export interface BlockRecord {
  validator: Validator;
  judge: AnyModel;
  changes: string[];
  cells: Cells;
  /** The matching over the step's candidates (M9). */
  matching: Matching;
  /** The strata matching over mentioned and generic items, printed only. */
  strata: Matching;
  /** Per candidate: some change behind the anticipated yes states the detail (2x unanimous only; M10). */
  detail: Record<string, boolean>;
  /** M14: credited candidates whose credit a tie-break decided (another maximum matching leaves them out). */
  tieDecided: string[];
  attempts: { block: number; labels: number };
}

export interface StepReading {
  /** Null when every block and label came back; else why the unit drops. */
  dropped: string | null;
  /** True when the step stopped early because fewer than 3 candidates could remain. */
  earlyExit: boolean;
  blocks: BlockRecord[];
  /** The candidates the step removes: not unanimous (step 5) or given away (step 6). */
  removed: string[];
  /** The candidates left. */
  kept: string[];
}

/** M14: the credited items some other maximum matching leaves uncredited, so the tie-break decided their credit. */
export function tieDecided(items: readonly { id: string; keyedDetail: boolean; edges: { change: number; detail: boolean }[] }[], m: Matching): string[] {
  return Object.entries(m.assigned)
    .filter(([, c]) => c !== null)
    .map(([id]) => id)
    .filter((id) => fixedMatching(items.map((i) => (i.id === id ? { ...i, edges: [] } : i))).credited === m.credited);
}

const edgesOf = (cell: LabelCell | undefined) => (cell && cell.kind === "labelled" ? cell.anticipatedEdges.map((change) => ({ change, detail: false })) : []);

/**
 * Step 5 or 6 over the given candidates. Each validator writes one block (one resend); its judge labels the block
 * against the candidates and the strata items (one whole-packet resend); fixedMatching over the candidates gives the
 * credits. Step 5 keeps an item credited in every block; step 6 removes an item any block credits. With earlyExit,
 * no further validator runs once fewer than minPrimary candidates can remain (K1); the gate check runs every block.
 */
export async function validatorStep(
  deps: Deps,
  kind: "unanimous" | "give-away",
  cands: readonly KeyItem[],
  strata: readonly KeyItem[],
  prompt: string,
  o: { label: string; details: boolean; earlyExit: boolean; minPrimary: number },
): Promise<StepReading> {
  const blocks: BlockRecord[] = [];
  let left = new Set(cands.map((i) => i.id));
  const labelled = [...cands, ...strata].sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const v of VALIDATORS) {
    const judge = AUTHORING.validators[v] as AnyModel;
    const block = await ask(deps.call, { model: v, effort: "medium", maxTokens: MONEY.outputCaps.validatorBlock, prompt, label: o.label + ":block:" + v }, (t) => deps.parseBlock(t) ?? "no parsable plan-changes block");
    if (!block.ok) return { dropped: kind + ": " + v + " gave no parsable block twice", earlyExit: false, blocks, removed: [], kept: [...left].sort() };
    const lists = [{ id: "list-a", changes: block.value }];
    const lab = await labelRound(deps.call, judge, labelled, lists, o.details, MONEY.outputCaps.validatorLabels, o.label + ":labels:" + v);
    const row = lab.cells["list-a"]!;
    const matchItems = cands.map((i) => ({ id: i.id, keyedDetail: false, edges: edgesOf(row[i.id]) }));
    const matching = fixedMatching(matchItems);
    const strataMatching = fixedMatching(strata.map((i) => ({ id: i.id, keyedDetail: false, edges: edgesOf(row[i.id]) })));
    const detail: Record<string, boolean> = {};
    for (const i of cands) {
      const c = row[i.id];
      detail[i.id] = !!c && c.kind === "labelled" && c.anticipated && (c.detailEdges ?? []).length > 0;
    }
    blocks.push({ validator: v, judge, changes: block.value, cells: lab.cells, matching, strata: strataMatching, detail, tieDecided: tieDecided(matchItems, matching), attempts: { block: block.attempts, labels: lab.attempts } });
    if (!lab.ok) return { dropped: kind + ": " + judge + "'s labels on " + v + "'s block still had an unlabelled cell after the resend", earlyExit: false, blocks, removed: [], kept: [...left].sort() };
    const credited = new Set(Object.entries(matching.assigned).filter(([, c]) => c !== null).map(([id]) => id));
    left = new Set([...left].filter((id) => (kind === "unanimous" ? credited.has(id) : !credited.has(id))));
    if (o.earlyExit && left.size < o.minPrimary && blocks.length < VALIDATORS.length) {
      const removed = cands.map((i) => i.id).filter((id) => !left.has(id));
      return { dropped: kind + ": fewer than " + o.minPrimary + " items can remain after " + v + "'s block", earlyExit: true, blocks, removed, kept: [...left].sort() };
    }
  }
  return { dropped: null, earlyExit: false, blocks, removed: cands.map((i) => i.id).filter((id) => !left.has(id)), kept: [...left].sort() };
}
