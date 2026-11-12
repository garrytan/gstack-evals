// Copyright (c) 2026 Garry Tan. MIT License.
// The model-backed checks of the office-hours founder eval's authoring (prereg sections 2, 3 and 7), each a function over
// a unit's current files, through an injected caller and the shared Labeller, so tests and seams run keyless:
// - validate: the unanimous key and the give-away check (Opus 5.5, GPT-6.1 Sol, GPT-6 Astra at medium effort), each
//   block labelled by a judge outside its family (Astra labels Opus's block, Opus labels Sol's and Astra's);
// - audit: the constructed blind audit, (a) to (e), by Opus in a fresh call and the other author family, high effort;
// - probe: the recognition probe on five models with two prompts each, and its counting rules on both strata;
// - genericScreen: Astra and Opus label each W item against stock rows 1 and 2 as if they were sessions;
// - typeLabels: section 3's type rule by Opus and Sol, with Argon settling a split.
// A reply a check cannot read is asked once more with twice the token budget, which also keeps the meter's reply cache
// from answering the second ask; the README records each such retry as a build-time choice.
import type { CallRequest } from "../../product-value/meter.ts";
import { STOCK_ROWS, fullInformation, pitchOnly } from "../frozen.ts";
import { normalizeBlock, parseFirstMove } from "../parse.ts";
import type { AuthorFamily, KeyItems, Labeller, LabelRecord, ProjectType, WItem } from "../types.ts";
import { factOrder, modelOf, otherFamily } from "./draws.ts";
import { jsonObject, W_ITEMS, type Caller, type UnitFiles } from "./files.ts";
import { AUDIT_CHECKS, auditPrompt, probeJudgeConstructed, probeJudgeReal, probePrompt, typePrompt, unitText, type AuditCheck } from "./prompts.ts";
import { namesIn, words, type Screen } from "./screens.ts";

export interface Deps {
  call: Caller;
  label: Labeller;
  screen: Screen;
}

export type Cells = Omit<LabelRecord, "block" | "unit" | "key_unit" | "key">;

/** One call whose reply must parse: a reply that does not is asked once more with twice the token budget. A string is the last problem. */
export async function ask<T>(call: Caller, req: CallRequest, parse: (text: string) => T | string): Promise<T | string> {
  let problem = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await call({ ...req, maxTokens: req.maxTokens * 2 ** attempt, label: req.label + ":" + (attempt + 1) });
    const got = res.text === null ? "no reply: " + (res.problem ?? "status " + res.status) : parse(res.text);
    if (typeof got !== "string") return got;
    problem = got;
  }
  return problem;
}

export const keyItems = (u: UnitFiles): KeyItems => ({ customer: u.key.customer, wedge: u.key.wedge, first_move: u.key.first_move, pivot: u.key.pivot });
/** The W items the unit's key does not mark mentioned. */
export const openItems = (u: UnitFiles): WItem[] => W_ITEMS.filter((i) => !u.key.mentioned.includes(i));
/** A W credit as section 8 scores one: the item's cell is credited and the block is not multi-target. */
export const credited = (r: Cells, item: WItem): boolean => r[item] === true && r.multi_target !== true;

/** Section 3 steps 3 and 4's three validators and the judge outside each one's family. */
export const VALIDATORS = [
  { model: "opus", judge: "astra" },
  { model: "sol", judge: "opus" },
  { model: "astra", judge: "opus" },
] as const;
export type Validator = (typeof VALIDATORS)[number]["model"];

/**
 * Runs the three validators on the full-information prompt (unanimous) or the pitch alone (give-away). A validator whose
 * reply holds no block, or whose block comes back with an unlabelled cell that can change W (an open item's cell or
 * multi-target), is asked once more; a second failure leaves it null, which drops the unit.
 */
export async function validate(id: string, u: UnitFiles, kind: "unanimous" | "give-away", deps: Deps): Promise<Record<Validator, Cells | null>> {
  const prompt = kind === "unanimous" ? fullInformation(u.opening, factOrder(id, u.sheet.facts).map((f) => f.text), true) : pitchOnly(u.opening);
  const items = openItems(u);
  const one = async (v: (typeof VALIDATORS)[number]): Promise<Cells | null> => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const label = id + ":" + kind + ":" + v.model + ":" + (attempt + 1);
      const res = await deps.call({ model: v.model, prompt, maxTokens: 8000 * 2 ** attempt, effort: "medium", label });
      const p = parseFirstMove([res.text ?? ""]);
      if (p.kind !== "block") continue;
      const cells = (await deps.label({ judge: v.judge, unit: id, items: keyItems(u), blocks: [{ id: v.model, block: normalizeBlock(p.block) }], effort: "medium", label })).get(v.model) ?? null;
      if (cells && cells.multi_target !== null && items.every((i) => cells[i] !== null)) return cells;
    }
    return null;
  };
  const got = await Promise.all(VALIDATORS.map(one));
  return Object.fromEntries(VALIDATORS.map((v, k) => [v.model, got[k]!])) as Record<Validator, Cells | null>;
}

/** The unanimous rule: every validator answered and is credited on every open W item. */
export const unanimous = (u: UnitFiles, r: Record<Validator, Cells | null>): boolean => Object.values(r).every((c) => c !== null && openItems(u).every((i) => credited(c, i)));
/** The give-away rule: every validator answered and none is credited on any open W item. */
export const notGivenAway = (u: UnitFiles, r: Record<Validator, Cells | null>): boolean => Object.values(r).every((c) => c !== null && !openItems(u).some((i) => credited(c, i)));

const same = (a: string, b: string) => words(a).join(" ") === words(b).join(" ");

/**
 * Section 3 step 5, the constructed blind audit. Check (b)'s mechanical part runs first, keyless: an alternative whose
 * customer or wedge is the key's own, word for word, fails (b) without a call. An audit reply that cannot be read after
 * one more ask fails every check.
 */
export async function audit(id: string, u: UnitFiles, author: AuthorFamily, deps: Deps): Promise<{ failed: AuditCheck[]; by: Record<string, AuditCheck[]> }> {
  if (same(u.key.alternative!.customer, u.key.customer) || same(u.key.alternative!.wedge, u.key.wedge)) return { failed: ["b"], by: { keyless: ["b"] } };
  const checks = Object.keys(AUDIT_CHECKS) as AuditCheck[];
  const parse = (t: string): AuditCheck[] | string => {
    const o = jsonObject(t);
    return o && checks.every((k) => o[k] === "pass" || o[k] === "fail") ? checks.filter((k) => o[k] === "fail") : "the audit reply marks no pass or fail on every check";
  };
  const auditors = ["opus", modelOf(otherFamily(author))] as const;
  const got = await Promise.all(auditors.map((m) => ask(deps.call, { model: m, prompt: auditPrompt(unitText(u.opening, u.sheet, u.key)), maxTokens: 8000, effort: "high", label: id + ":audit:" + m }, parse)));
  const by = Object.fromEntries(auditors.map((m, k) => [m, typeof got[k] === "string" ? checks : (got[k] as AuditCheck[])]));
  return { failed: checks.filter((c) => Object.values(by).some((f) => f.includes(c))), by };
}

/** Section 3's probe models: the three under test, the simulator's model and Astra, whose guesses print and decide nothing. */
export const PROBE_MODELS = ["opus", "sol", "particle", "gemini", "astra"] as const;

export interface ProbeRecord {
  model: (typeof PROBE_MODELS)[number];
  prompt: "opening" | "full";
  answered: boolean;
  /** A counted guess: a Names-line hit (real stratum) or both judges' call. */
  counted: boolean;
  by: "name" | "judges" | null;
}

/**
 * The recognition probe. Every model answers the opening alone and the opening with the sheet and the key, at default
 * effort. On a real-history unit a guess counts when it names a Names-line entry, or when Opus and Astra both judge it
 * identifies the source unambiguously; on a constructed unit, when Opus and Astra both list the same named company as
 * one whose early history the story matches closely. A judge reply that cannot be read is no judgment. A hit is one
 * counted guess by a model other than Astra.
 */
export async function probe(id: string, u: UnitFiles, names: readonly string[] | null, deps: Deps): Promise<{ hit: boolean; records: ProbeRecord[] }> {
  const one = async (model: ProbeRecord["model"], prompt: ProbeRecord["prompt"]): Promise<ProbeRecord> => {
    const base = id + ":probe:" + model + ":" + prompt;
    const reply = await ask(deps.call, { model, prompt: prompt === "opening" ? probePrompt(u.opening) : probePrompt(u.opening, u.sheet, u.key), maxTokens: 2000, effort: null, label: base }, (t) => (t.trim() ? { reply: t } : "an empty reply"));
    if (typeof reply === "string") return { model, prompt, answered: false, counted: false, by: null };
    if (names && namesIn(reply.reply, names).length) return { model, prompt, answered: true, counted: true, by: "name" };
    const judged = await Promise.all((["opus", "astra"] as const).map((judge) =>
      ask(deps.call, { model: judge, prompt: names ? probeJudgeReal(names, reply.reply) : probeJudgeConstructed(unitText(u.opening, u.sheet, u.key), reply.reply), maxTokens: 2000, effort: "medium", label: base + ":judge:" + judge }, (t) => {
        const o = jsonObject(t);
        if (names) return typeof o?.identifies === "boolean" ? { yes: o.identifies, companies: [] as string[] } : "no identifies field";
        return Array.isArray(o?.matches) && o.matches.every((m) => typeof m === "string") ? { yes: o.matches.length > 0, companies: (o.matches as string[]).map((m) => words(m).join(" ")) } : "no matches list";
      })));
    const [a, b] = judged.map((j) => (typeof j === "string" ? null : j));
    const counted = !!a && !!b && a.yes && b.yes && (names !== null || a.companies.some((c) => b.companies.includes(c)));
    return { model, prompt, answered: true, counted, by: counted ? "judges" : null };
  };
  const records = await Promise.all(PROBE_MODELS.flatMap((m) => (["opening", "full"] as const).map((p) => one(m, p))));
  return { hit: records.some((r) => r.counted && r.model !== "astra"), records };
}

/** Section 2's generic screen: an item either judge credits on stock row 1 or 2, as if the rows were sessions, becomes generic. An unlabelled cell is no credit and is counted. */
export async function genericScreen(id: string, u: UnitFiles, deps: Deps): Promise<{ generic: WItem[]; unlabelled: number }> {
  const blocks = STOCK_ROWS.filter((r) => r.row !== 3).map((r) => ({ id: "row" + r.row, block: normalizeBlock(r.block) }));
  const generic = new Set<WItem>();
  let unlabelled = 0;
  for (const judge of ["astra", "opus"] as const) {
    const got = await deps.label({ judge, unit: id, items: keyItems(u), blocks, effort: "medium", label: id + ":generic:" + judge });
    for (const b of blocks) {
      const cells = got.get(b.id) ?? null;
      for (const item of W_ITEMS) {
        if (!cells || cells[item] === null || cells.multi_target === null) unlabelled++;
        else if (credited(cells, item)) generic.add(item);
      }
    }
  }
  return { generic: W_ITEMS.filter((i) => generic.has(i)), unlabelled };
}

const TYPES: readonly ProjectType[] = ["marketplace", "developer tools", "B2B", "consumer", "other"];
const STAGES = ["pre-product", "has users"] as const;
type Stage = (typeof STAGES)[number];

/** Section 3's type labels, blind to the key: Opus and Sol label each unit, and Argon settles a split, on the type and the founder's stage alike. */
export async function typeLabels(id: string, u: UnitFiles, deps: Deps): Promise<{ type: ProjectType | null; stage: Stage | null; votes: Record<string, unknown> }> {
  const parse = (t: string): { type: ProjectType; stage: Stage | null } | string => {
    const o = jsonObject(t);
    if (!o || !TYPES.includes(o.type as ProjectType)) return "no type from the list";
    return { type: o.type as ProjectType, stage: STAGES.includes(o.stage as Stage) ? (o.stage as Stage) : null };
  };
  const req = (model: "opus" | "sol" | "gemini") => ask(deps.call, { model, prompt: typePrompt(u.opening, u.sheet.persona), maxTokens: 2000, effort: null, label: id + ":type:" + model }, parse);
  const [o, s] = (await Promise.all([req("opus"), req("sol")])).map((v) => (typeof v === "string" ? null : v));
  const agreeType = !!o && !!s && o.type === s.type;
  const agreeStage = !!o?.stage && o.stage === s?.stage;
  const g = agreeType && agreeStage ? null : await req("gemini");
  const settle = typeof g === "string" ? null : g;
  return { type: agreeType ? o!.type : (settle?.type ?? null), stage: agreeStage ? o!.stage : (settle?.stage ?? null), votes: { opus: o, sol: s, gemini: settle } };
}
