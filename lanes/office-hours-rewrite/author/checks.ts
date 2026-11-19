// Copyright (c) 2026 Garry Tan. MIT License.
// The model-backed checks of the office-hours rewrite eval's authoring (prereg section 3, "Authoring and validation",
// "Unanimous key" and "Give-away screen"; section 5's labeller), each over a brief's current files through an injected
// caller, block parser and the shared Labeller, so tests and seams run keyless:
// - validate: Opus 5.5, GPT-6.1 Sol and GPT-6.2 Astra answer the full-information prompt (unanimous key) or the opening
//   alone (give-away), and a judge outside each one's family labels its block: Astra labels Opus, Opus labels Sol and
//   Astra. A validator with no block, or an unlabelled cell the rule reads, is asked once more; a second miss is null.
// - audit: the blind audit, (a) to (f), by Opus and the author family that did not write the brief, at high effort.
// - probe: the founder lane's recognition probe, as is.
// - genericScreen: Astra and Opus label the three stock rows against the key; a credited cell makes the brief generic.
import type { Deps as FounderDeps } from "../../office-hours-founder/author/checks.ts";
import { VALIDATORS, ask, probe as founderProbe, type ProbeRecord, type Validator } from "../../office-hours-founder/author/checks.ts";
import { jsonObject, type Caller, type UnitFiles } from "../../office-hours-founder/author/files.ts";
import { STOCK_ROWS } from "../frozen.ts";
import type { AuthorFamily, Block, BlockParser, Cells, KeyItems, Labeller } from "../types.ts";
import { factOrder, modelOf, otherFamily } from "./draws.ts";
import { keyJson, priorJson, sheetJson, type BriefFiles } from "./files.ts";
import { AUDIT_CHECKS, auditPrompt, fence, fullInformation, openingOnly, type AuditCheck } from "./prompts.ts";
import type { Screen } from "./screens.ts";

export { VALIDATORS, type Validator };

export interface Deps {
  call: Caller;
  label: Labeller;
  parse: BlockParser;
  screen: Screen;
}

export const keyItems = (b: BriefFiles, contrast: string): KeyItems => ({ call: b.key.call, actions: b.key.actions, contrast });

/** The brief's files as one text, fenced by name, for the audit, the probe and a rewrite. */
export const briefText = (b: BriefFiles, names: readonly string[] = ["opening.md", "sheet.json", "key.json", "prior.json"]): string =>
  [
    ["opening.md", b.opening.trim()],
    ["sheet.json", sheetJson(b.sheet).trim()],
    ["key.json", keyJson(b.key).trim()],
    ...(b.prior ? [["prior.json", priorJson(b.prior).trim()]] : []),
  ].filter(([n]) => names.includes(n!)).map(([n, body]) => fence(n!, body!)).join("\n\n");

export interface Validation {
  cells: Cells;
  block: Block;
}

/** Runs the three validators on one prompt. kind names the screen, and the cells each must have labelled. */
export async function validate(id: string, b: BriefFiles, contrast: string, kind: "unanimous" | "give-away", deps: Deps): Promise<Record<Validator, Validation | null>> {
  const prompt = kind === "unanimous" ? fullInformation(b.opening, factOrder(id, b.sheet.facts).map((f) => f.text), b.prior) : openingOnly(b.opening, b.prior);
  const one = async (v: (typeof VALIDATORS)[number]): Promise<Validation | null> => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const label = id + ":" + kind + ":" + v.model + ":" + (attempt + 1);
      const res = await deps.call({ model: v.model, prompt, maxTokens: 8000 * 2 ** attempt, effort: "medium", label });
      const p = deps.parse(res.text ?? "");
      if (p.kind !== "block") continue;
      const cells = (await deps.label({ judge: v.judge, brief: id, items: keyItems(b, contrast), blocks: [{ id: "b1", block: p.block }], effort: "medium", label })).get("b1") ?? null;
      if (cells && cells.decision !== null && (kind === "give-away" || cells.action !== null)) return { cells, block: p.block };
    }
    return null;
  };
  const got = await Promise.all(VALIDATORS.map(one));
  return Object.fromEntries(VALIDATORS.map((v, k) => [v.model, got[k]!])) as Record<Validator, Validation | null>;
}

/** The unanimous key: every validator made the key's call and named an acceptable action. */
export const unanimous = (r: Record<Validator, Validation | null>): boolean => Object.values(r).every((v) => v !== null && v.cells.decision === true && v.cells.action === true);
/** The give-away screen: no validator made the key's call from the opening alone. */
export const notGivenAway = (r: Record<Validator, Validation | null>): boolean => Object.values(r).every((v) => v !== null && v.cells.decision !== true);

/** The blind audit. A reply that cannot be read after one more ask fails every check. */
export async function audit(id: string, b: BriefFiles, author: AuthorFamily, contrast: string, surface: string | null, deps: Deps): Promise<{ failed: AuditCheck[]; by: Record<string, AuditCheck[]> }> {
  const checks = Object.keys(AUDIT_CHECKS) as AuditCheck[];
  const parse = (t: string): AuditCheck[] | string => {
    const o = jsonObject(t);
    return o && checks.every((k) => o[k] === "pass" || o[k] === "fail") ? checks.filter((k) => o[k] === "fail") : "the audit reply marks no pass or fail on every check";
  };
  const auditors = ["opus", modelOf(otherFamily(author))] as const;
  const got = await Promise.all(auditors.map((m) => ask(deps.call, { model: m, prompt: auditPrompt(briefText(b), contrast, surface), maxTokens: 8000, effort: "high", label: id + ":audit:" + m }, parse)));
  const by = Object.fromEntries(auditors.map((m, k) => [m, typeof got[k] === "string" ? checks : (got[k] as AuditCheck[])]));
  return { failed: checks.filter((c) => Object.values(by).some((f) => f.includes(c))), by };
}

/**
 * The founder lane's recognition probe, as is. It reads only opening, sheet and key from its unit and calls only the
 * caller, so the brief goes in under the founder unit's field names and the other deps are unused.
 */
export function probe(id: string, b: BriefFiles, deps: Deps): Promise<{ hit: boolean; records: ProbeRecord[] }> {
  const unit = { opening: b.opening, sheet: b.sheet, key: b.key } as unknown as UnitFiles;
  return founderProbe(id, unit, null, { call: deps.call } as FounderDeps);
}

/** The generic screen: either judge crediting either cell of any stock row makes the brief generic; an unlabelled cell is counted. */
export async function genericScreen(id: string, b: BriefFiles, contrast: string, deps: Deps): Promise<{ generic: boolean; credited: string[]; unlabelled: number }> {
  const blocks = STOCK_ROWS.map((r) => ({ id: "b" + r.row, block: { decision: r.decision, next_action: r.next_action, why: r.why } }));
  const credited: string[] = [];
  let unlabelled = 0;
  for (const judge of ["astra", "opus"] as const) {
    const got = await deps.label({ judge, brief: id, items: keyItems(b, contrast), blocks, effort: "medium", label: id + ":generic:" + judge });
    for (const blk of blocks) {
      const c = got.get(blk.id) ?? null;
      for (const cell of ["decision", "action"] as const) {
        if (!c || c[cell] === null) unlabelled++;
        else if (c[cell]) credited.push(judge + " " + blk.id + " " + cell);
      }
    }
  }
  return { generic: credited.length > 0, credited, unlabelled };
}
