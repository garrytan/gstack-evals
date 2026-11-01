// Copyright (c) 2026 Garry Tan. MIT License.
// The review replay catalog (plan v3.2, "Review replay lane", requirement 1): one case per file under a catalog dir,
// validated against schema.json, plus the checks a schema cannot make. New code for U13a; GSTA-131's panel cases
// (panel/panel-cases.json) seeded public/. A case is a review case or, with kind plan, a plan case (planning lane plan
// 2026-10-31-geva-79-planning-lane-plan, B1): one schema and one loader for both.

import Ajv2020 from "ajv/dist/2020";
import { readdirSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export const CATALOG_SCHEMA = join(import.meta.dir, "schema.json");
const REPO_ROOT = resolve(import.meta.dir, "../../..");

export interface DecoyAudit {
  later_fix_checked: true;
  later_fix: { ref: string; fixed: string } | null;
  verdict: "clean" | "holds-defect";
  by: string;
  at: string;
  method: string;
}

export interface Decoy {
  kind: "fix-commit" | "clean-pr";
  repo: string;
  pr: number;
  range: { from: string; to: string };
  audit: DecoyAudit | null;
}

export interface ReplayCase {
  schema_version: 1;
  kind?: "review";
  id: string;
  visibility: "public" | "sealed";
  repo: string;
  pr: number;
  reviewed_head: string;
  merge_base: string;
  diff_range: { from: string; to: string; note?: string };
  roles: Array<{ role: "specialist" | "red-team" | "fix-check"; checklist?: string }>;
  defect: { file: string; line: number; summary: string };
  severity: { deserved: "CRITICAL" | "INFORMATIONAL" | null; basis: string; in_history: Array<{ by: string; rated: string }> };
  fix: { commit: string; pr: number };
  decoys: Decoy[];
  receipt: { source: string; evidence: string[] };
  answer_key_audit: { by: string; at: string; verdict: "confirmed" | "rejected"; notes: string } | null;
  shelf_life: { first_appeared: string; source: string; short: boolean };
  credit: string;
}

export type Lens = "ceo" | "devex" | "design" | "eng";
export type PlanStratum = "seeded" | "real-neutral" | "home-field" | "decoy" | "pilot";

/** A plan flaw: the unit's head commit adds plan.md, and the answer key names the cause and the plan section. */
export interface PlanCase {
  schema_version: 1;
  kind: "plan";
  id: string;
  visibility: "public" | "sealed";
  repo: string;
  pr: number;
  reviewed_head: string;
  merge_base: string;
  plan: { digest: string; lens: Lens; stratum: PlanStratum; source: string; plan_type: "greenfield" | "added-capability" | "fix"; flaw_class: "wrong-thing" | "right-thing-badly" | "bait" };
  defect: { file: "plan.md"; line: number; section: string; cause: string; summary: string };
  severity: { deserved: "CRITICAL" | "INFORMATIONAL" | null; basis: string };
  receipt: { source: string; evidence: string[] };
  answer_key_audit: ReplayCase["answer_key_audit"];
  credit: string;
}

export type CatalogCase = ReplayCase | PlanCase;
export const isPlanCase = (c: CatalogCase): c is PlanCase => c.kind === "plan";

export interface CatalogProblem {
  file: string;
  message: string;
}

/**
 * A decoy counts as a clean PR only when an audit checked for a later fix and found it clean. An unaudited decoy is
 * never scored as clean: GSTA-20 found that decoy y09 had passed review and still held a real bug.
 */
export function scorableAsClean(decoy: Decoy): boolean {
  return decoy.audit !== null && decoy.audit.verdict === "clean";
}

/**
 * Loads every *.json case in dir: review cases in cases, plan cases in plans. A case comes back only when it has no
 * problem; problems name the file and say what to change. repoRoot is this repo's root, where a sealed case must never be.
 */
export function loadCatalog(dir: string, repoRoot = REPO_ROOT): { cases: ReplayCase[]; plans: PlanCase[]; problems: CatalogProblem[] } {
  const ajv = new Ajv2020({ strict: true, strictRequired: false, allowUnionTypes: true, allErrors: true });
  const validate = ajv.compile(JSON.parse(readFileSync(CATALOG_SCHEMA, "utf8")));
  const rel = relative(resolve(repoRoot), resolve(dir));
  const inRepo = !isAbsolute(rel) && rel.split(sep)[0] !== "..";
  const cases: ReplayCase[] = [];
  const plans: PlanCase[] = [];
  const problems: CatalogProblem[] = [];
  const seen = new Map<string, string>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    const fail = (message: string) => problems.push({ file, message });
    let value: unknown;
    try {
      value = JSON.parse(readFileSync(join(dir, file), "utf8"));
    } catch (e) {
      fail("not JSON: " + (e as Error).message);
      continue;
    }
    if (!validate(value)) {
      for (const err of validate.errors ?? []) fail("schema: " + (err.instancePath || "/") + " " + err.message);
      continue;
    }
    const c = value as CatalogCase;
    const before = problems.length;
    if (file !== c.id + ".json") fail("the file must be named " + c.id + ".json, after its id");
    if (seen.has(c.id)) fail("duplicate id " + c.id + ", also in " + seen.get(c.id));
    else seen.set(c.id, file);
    if (c.visibility === "sealed" && inRepo) fail("a sealed case is in the repo tree; move it to the sealed store and commit only its digest");
    if (!isPlanCase(c))
      c.decoys.forEach((d, i) => {
        if (d.audit?.verdict === "holds-defect") fail("decoy " + i + " (" + d.repo + "#" + d.pr + ") holds a defect, so it is not a decoy; make it a defect case");
      });
    if (isPlanCase(c) && c.plan.stratum === "decoy" && c.severity.deserved !== "INFORMATIONAL") fail("a decoy plan's case is its bait, so its deserved severity is INFORMATIONAL");
    if (isPlanCase(c) && (c.plan.flaw_class === "bait") !== (c.plan.stratum === "decoy")) fail("flaw_class bait goes with stratum decoy, and only there");
    if (problems.length === before) {
      if (isPlanCase(c)) plans.push(c);
      else cases.push(c);
    }
  }
  return { cases, plans, problems };
}
