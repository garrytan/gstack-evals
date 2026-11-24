// Copyright (c) 2026 Garry Tan. MIT License.
// The /cso real-advisory preregistration (wiki/plans/2026-11-19-geva-561-cso-advisories-prereg, schema cso-advisories-prereg.v1),
// its dated pre-data deviations, and the lane's refusal helper. prereg.json in the post bundle is the one source for
// seeds, pins, texts, units, scoring, judge and analysis constants; code reads it here and nowhere else. Every refusal
// message starts with its reason code.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReasonCode } from "../../../src/errors/codes.ts";

export class CsoError extends Error {
  constructor(readonly code: ReasonCode, message: string) {
    super(code + " " + message);
  }
}
export const csoFail = (code: ReasonCode, message: string): never => {
  throw new CsoError(code, message);
};

export const POST_ID = "2026-11-19-geva-561-cso-advisories-prereg";
export const PREREG_PATH = join(import.meta.dir, "..", "..", "..", "wiki", "plans", POST_ID, "prereg.json");
export const DEVIATIONS_POST_ID = "2026-11-21-capy-cso-advisories-deviations";
/** The before-and-after rerun (GEVA-583): rerun.json, read beside prereg.json when CSO_PLAN=rerun. */
export const RERUN_POST_ID = "2026-11-23-geva-583-cso-rerun-prereg";
export const RERUN_PATH = join(import.meta.dir, "..", "..", "..", "wiki", "plans", RERUN_POST_ID, "rerun.json");
/** The rerun's items and the arms each pays for: the new cso arm only (the plain and old cso arms are reused). */
export const RERUN_ITEMS = ["cso2-pilot", "cso2-main", "cso2-judge", "cso2-vm", "cso2-reserve"] as const;
/** The long-list try (GEVA-589): the rerun's plan at a later gstack pin, longlist.json read the same way when CSO_PLAN=longlist. */
export const LONGLIST_POST_ID = "2026-11-24-geva-589-cso-longlist-change";
export const LONGLIST_PATH = join(import.meta.dir, "..", "..", "..", "wiki", "plans", LONGLIST_POST_ID, "longlist.json");
export const LONGLIST_ITEMS = ["cso3-pilot", "cso3-main", "cso3-judge", "cso3-vm", "cso3-reserve"] as const;
const OVERLAYS: Record<string, { path: string; items: readonly string[] }> = { rerun: { path: RERUN_PATH, items: RERUN_ITEMS }, longlist: { path: LONGLIST_PATH, items: LONGLIST_ITEMS } };

/** The dated pre-data deviations, as the deviations post lists them: a, b, CV5 and CV6 in the Captain's approvals record
 *  (approvals/2026-11-19-untested-parts-ship-guards-cso.md), c and d from the Captain's decisions of 2026-11-21. Run
 *  receipts name these ids and the commit that landed each. */
export const DEVIATIONS = {
  a: "The containment gate also scans each arm's installed gstack tree; a unit whose GHSA id, CVE id or fix-commit prefix appears there drops from every cell.",
  b: "Stage 1's judge-check release reports only whether each gold minimum was met and the pass or fail of each gate, not gold counts by class.",
  c: "A unit whose affected package an arm's installed gstack tree holds at or past its fixed version, in a lockfile or an installed package manifest, drops from every cell; the 16 such units at the pin drop by name before the draw, and the unit gate checks every arm's install for this route.",
  d: "The judge (judge.production, which every route's judge reads) runs at medium effort with an output cap of 65,536 in place of high and 16,000, from stage 0's third re-judge on (48,000 and then 128,000 at high effort before it, amended the same day); a judge reply cut off at its cap is labelled truncated, not malformed, and is a judge gap after the one retry at the same setting.",
  CV5: "When stage 2 takes R113's interim look, its O'Brien-Fleming bounds (3.18 and 2.25 at two-sided 0.025, then 2.80 and 1.98 at 0.05 once one contrast is rejected) replace section 10's Holm thresholds at both looks.",
  CV6: "The Sol stage's R111 pilot is its paid Codex smoke, sized with its own caps in the Sol proposal; a keyless session start doesn't count, and R78's 40 Sol reports still stand.",
} as const;
export type DeviationId = keyof typeof DEVIATIONS;

export interface Pin { repo: string; sha?: string; commit?: string; version?: string }
export interface CsoPrereg {
  schema: "cso-advisories-prereg.v1";
  post: string;
  draw_seed: number;
  bootstrap_seed: number;
  order_seed: number;
  check_seed: number;
  pins: { gstack: Pin & { files_sha256: Record<string, string> }; advisory_database: Pin; frame: Record<string, unknown> };
  texts: { task: string; continuation: string; question_reply: string };
  continuation_cap: number;
  units: { part1_h2h: string[]; part2_added: string[]; gates: string[]; repo_cap: number; positions: Record<string, unknown> } & Record<string, unknown>;
  judge: Record<string, unknown> & { kappa_min: number; check_reports_min: number; check_findings_min: number; class_min: number; anchor_share_max: number; refusal_max: number; kappa_non_anchor_min: number; gold_overcap_max: number };
  stage1_release: string[];
  items: Record<string, { central?: number; cap: number }>;
  /** rerun.json under CSO_PLAN=rerun, longlist.json under CSO_PLAN=longlist, else absent. */
  rerun?: Record<string, any>;
  [k: string]: unknown;
}

/** Deviation (d): the judge's output cap and effort, 65,536 at medium in place of prereg.json's frozen 16,000 at high
 *  (E_CSO_PREREG when prereg.json holds other values, so the deviation never lands on a plan it was not written against).
 *  65,536 is the most one Carbon call returns through OpenRouter (one Vertex output segment). */
export const JUDGE_MAX_OUTPUT_D = 65_536;
export const JUDGE_EFFORT_D = "medium";
export function judgeEffort(p: CsoPrereg): string {
  const frozen = (p.judge as { production?: { effort?: unknown } }).production?.effort;
  if (frozen !== "high") csoFail("E_CSO_PREREG", "judge.production.effort is " + String(frozen) + ", not the high that deviation (d) lowers to " + JUDGE_EFFORT_D);
  return JUDGE_EFFORT_D;
}
export function judgeMaxOutput(p: CsoPrereg): number {
  const frozen = (p.judge as { production?: { max_output_tokens?: unknown } }).production?.max_output_tokens;
  if (frozen !== 16_000) csoFail("E_CSO_PREREG", "judge.production.max_output_tokens is " + String(frozen) + ", not the 16,000 that deviation (d) raises to " + JUDGE_MAX_OUTPUT_D);
  return JUDGE_MAX_OUTPUT_D;
}

const u32 = (n: unknown) => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 0xffffffff;

/** Reads and checks prereg.json (E_CSO_PREREG when it is missing, not cso-advisories-prereg.v1, or lacks a seed, a text or a unit list).
 *  Under CSO_PLAN=rerun or longlist it returns that plan's overlay (withRerun) over it. */
export function loadCsoPrereg(path = PREREG_PATH, env: Record<string, string | undefined> = process.env): CsoPrereg {
  if (!existsSync(path)) csoFail("E_CSO_PREREG", path + " does not exist");
  const p = JSON.parse(readFileSync(path, "utf8")) as CsoPrereg;
  if (p.schema !== "cso-advisories-prereg.v1") csoFail("E_CSO_PREREG", "schema is " + String(p.schema) + ", not cso-advisories-prereg.v1");
  for (const k of ["draw_seed", "bootstrap_seed", "order_seed", "check_seed"] as const) if (!u32(p[k])) csoFail("E_CSO_PREREG", k + " is not an unsigned 32-bit integer");
  for (const k of ["task", "continuation", "question_reply"] as const) if (typeof p.texts?.[k] !== "string" || !p.texts[k]) csoFail("E_CSO_PREREG", "texts." + k + " is missing");
  if (!Array.isArray(p.units?.part1_h2h) || !Array.isArray(p.units?.part2_added)) csoFail("E_CSO_PREREG", "units.part1_h2h or units.part2_added is missing");
  if (env.CSO_PLAN === undefined || env.CSO_PLAN === "") return p;
  const o = Object.hasOwn(OVERLAYS, env.CSO_PLAN) ? OVERLAYS[env.CSO_PLAN]! : csoFail("E_CSO_PREREG", "CSO_PLAN is rerun, longlist or unset, not " + JSON.stringify(env.CSO_PLAN));
  if (!existsSync(o.path)) csoFail("E_CSO_PREREG", o.path + " does not exist");
  return withRerun(p, JSON.parse(readFileSync(o.path, "utf8")), createHash("sha256").update(readFileSync(path)).digest("hex"), o.items);
}

/** The rerun overlay (rerun prereg section 9 item 1): the parent's plan with the new gstack pin, the rerun's items, the
 *  pooled judge check's rules (a floor of 100 gold
 *  reports and no oracle or stock anchor fill). Nothing else the parent froze changes. E_CSO_PREREG when rerun.json names
 *  another parent prereg.json than the one read. */
export function withRerun(p: CsoPrereg, r: Record<string, any>, parentSha256: string, itemNames: readonly string[] = RERUN_ITEMS): CsoPrereg {
  if (r.schema !== "cso-rerun-prereg.v1") csoFail("E_CSO_PREREG", "rerun.json schema is " + String(r.schema) + ", not cso-rerun-prereg.v1");
  if (r.parent_prereg_json_sha256 !== parentSha256) csoFail("E_CSO_PREREG", "rerun.json names parent prereg.json " + String(r.parent_prereg_json_sha256) + ", not the " + parentSha256 + " read");
  const g = r.pins?.gstack;
  if (!g || !/^[0-9a-f]{40}$/.test(String(g.sha)) || !g.files_sha256) csoFail("E_CSO_PREREG", "rerun.json's gstack pin has no 40-hex sha or files_sha256");
  const items: Record<string, { central?: number; cap: number }> = {};
  for (const k of itemNames) items[k] = r.items?.[k] ?? csoFail("E_CSO_PREREG", "rerun.json has no item " + k);
  const rules = r.judge?.check_rules ?? csoFail("E_CSO_PREREG", "rerun.json has no judge.check_rules");
  return {
    ...p,
    pins: { ...p.pins, gstack: g },
    items,
    judge: { ...p.judge, check_reports_min: rules.check_reports_min, anchor_fill: false },
    rerun: r,
  };
}
