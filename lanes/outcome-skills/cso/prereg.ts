// Copyright (c) 2026 Garry Tan. MIT License.
// The /cso real-advisory preregistration (wiki/plans/2026-11-19-geva-561-cso-advisories-prereg, schema cso-advisories-prereg.v1),
// its dated pre-data deviations, and the lane's refusal helper. prereg.json in the post bundle is the one source for
// seeds, pins, texts, units, scoring, judge and analysis constants; code reads it here and nowhere else. Every refusal
// message starts with its reason code.
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
export const DEVIATIONS_POST_ID = "2026-11-21-geva-561-cso-advisories-deviations";

/** The dated pre-data deviations the Captain recorded (approvals/2026-11-19-untested-parts-ship-guards-cso.md), as the
 *  deviations post lists them. Run receipts name these ids and the commit that landed each. */
export const DEVIATIONS = {
  a: "The containment gate also scans each arm's installed gstack tree; a unit whose GHSA id, CVE id or fix-commit prefix appears there drops from every cell.",
  b: "Stage 1's judge-check release reports only whether each gold minimum was met and the pass or fail of each gate, not gold counts by class.",
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
  [k: string]: unknown;
}

const u32 = (n: unknown) => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 0xffffffff;

/** Reads and checks prereg.json (E_CSO_PREREG when it is missing, not cso-advisories-prereg.v1, or lacks a seed, a text or a unit list). */
export function loadCsoPrereg(path = PREREG_PATH): CsoPrereg {
  if (!existsSync(path)) csoFail("E_CSO_PREREG", path + " does not exist");
  const p = JSON.parse(readFileSync(path, "utf8")) as CsoPrereg;
  if (p.schema !== "cso-advisories-prereg.v1") csoFail("E_CSO_PREREG", "schema is " + String(p.schema) + ", not cso-advisories-prereg.v1");
  for (const k of ["draw_seed", "bootstrap_seed", "order_seed", "check_seed"] as const) if (!u32(p[k])) csoFail("E_CSO_PREREG", k + " is not an unsigned 32-bit integer");
  for (const k of ["task", "continuation", "question_reply"] as const) if (typeof p.texts?.[k] !== "string" || !p.texts[k]) csoFail("E_CSO_PREREG", "texts." + k + " is missing");
  if (!Array.isArray(p.units?.part1_h2h) || !Array.isArray(p.units?.part2_added)) csoFail("E_CSO_PREREG", "units.part1_h2h or units.part2_added is missing");
  return p;
}
