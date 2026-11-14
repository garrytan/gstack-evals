// Copyright (c) 2026 Garry Tan. MIT License.
// Stage 3's units and their validation (2026-11-14 prereg section 11 "Units", "Authoring" and "Validation"; plan section
// 13). Up to 16 comparison units at the admitted tier, in draw order, at most one per base app. For each, Opus writes
// fixtures, key checks and three scenarios and Sol audits them; Opus then builds the unit twice from plan.md plus the
// oracle list, one oracle build at a time against the $30 reserve. A key check counts only when it passes on both oracle
// builds; a scenario only when the agent user completes it on one. A unit qualifies with at least one validated key
// check and three valid scenarios. With fewer than 8 qualifying units stage 3 doesn't run and its caps are released.
import { MONEY, STAGE3 } from "../frozen.ts";
import type { Recipe } from "../recipes/recipe.ts";
import type { Unit } from "../types.ts";
import { buildPrompt, checkBuild, runBuild, type BuildDeps, type CheckRun } from "./build.ts";
import type { SandboxTally } from "./sandbox.ts";
import { CapStopSignal, type Authored, type AuthoredAudit, type KeyCheck, type MoneySeam, type Scenario, type Stage3Authoring } from "./seams.ts";

/** A comparison unit as stage 3 reads it. */
export interface Stage3Candidate {
  unit: Unit;
  plan: string;
  /** The oracle list (the key's decisions as plan changes), rendered by the score area. */
  oracleBlock: string;
  tree: () => Promise<Uint8Array>;
  /** The base app's kept recipe. */
  recipe: Recipe;
  /** The routes a build must serve: the recipe's routes and the changed screen's route. */
  routes: string[];
}

export interface Validation {
  unit: string;
  accepted: { keyChecks: KeyCheck[]; scenarios: Scenario[]; fixtures: boolean };
  /** Key checks that passed on both oracle builds. */
  validated: KeyCheck[];
  /** Scenarios the agent user completed on at least one oracle build. */
  scenarios: Scenario[];
  oracle: CheckRun[];
  qualifies: boolean;
  why: string | null;
}

export interface Stage3Selection {
  units: Array<{ candidate: Stage3Candidate; validation: Validation; authored: Authored }>;
  tried: Validation[];
  skippedBaseApp: string[];
  /** Whether stage 3 runs: at least 8 qualifying units. */
  runs: boolean;
  capStop: { item: string; why: string } | null;
  /** Every oracle build and check VM with its dropped connections, in the order they ran. */
  sandboxes: SandboxTally[];
}

export interface SelectDeps {
  builds: BuildDeps;
  money: MoneySeam;
  authoring: Stage3Authoring;
}

const AUTHORING = "dc-stage3-authoring" as const;

/** What Sol's audit leaves: the key checks and scenarios it accepts, at most one key check per item and none for H. */
export function accepted(a: Authored, v: AuthoredAudit): Validation["accepted"] {
  const perItem = new Set<string>();
  const keyChecks = a.keyChecks.filter((k) => {
    if (v.keyChecks[k.id] !== true || (k.class as string) === "H" || perItem.has(k.item)) return false;
    perItem.add(k.item);
    return true;
  });
  return { keyChecks, scenarios: a.scenarios.filter((s) => v.scenarios[s.id] === true), fixtures: v.fixtures };
}

/** The counting rules on two oracle check runs. A missing or unserved oracle build passes no key check. */
export function countValidation(unit: string, acc: Validation["accepted"], oracle: CheckRun[]): Omit<Validation, "oracle"> {
  const reads = oracle.map((o) => (o.serves ? o.reads : null));
  const validated = acc.keyChecks.filter((k) => reads.length === STAGE3.oracleBuildsPerUnit && reads.every((r) => r?.keyChecks[k.id] === true));
  const scenarios = acc.scenarios.filter((s) => reads.some((r) => r?.agentUser.some((a) => a.scenario === s.id && a.completed === true)));
  const why = !validated.length ? "no key check passes on both oracle builds" : scenarios.length < STAGE3.scenarios ? "only " + scenarios.length + " of " + STAGE3.scenarios + " scenarios completed on an oracle build" : null;
  return { unit, accepted: acc, validated, scenarios, qualifies: why === null, why };
}

/** Two oracle builds, one at a time, each admitted at the $30 reserve on dc-stage3-authoring, each then checked. */
async function oracleRuns(c: Stage3Candidate, acc: Validation["accepted"], d: SelectDeps): Promise<CheckRun[]> {
  const out: CheckRun[] = [];
  for (let i = 1; i <= STAGE3.oracleBuildsPerUnit; i++) {
    const label = "oracle build " + i + " " + c.unit.id;
    const adm = await d.money.admit({ item: AUTHORING, run: label, reserveUsd: MONEY.oracleBuildReserveUsd });
    if (!adm.ok) {
      await d.money.capStop(AUTHORING, adm.why);
      throw new CapStopSignal(AUTHORING, adm.why);
    }
    let spent: number | null = null;
    try {
      const b = await runBuild({ label, tree: c.tree, plan: c.plan, prompt: buildPrompt(c.oracleBlock), sub: { item: AUTHORING, id: adm.id } }, d.builds, () => d.money.reconcile(adm.id));
      spent = b.spentUsd;
      out.push(
        b.tree
          ? await checkBuild(b.tree, c.recipe, { unit: c.unit, item: AUTHORING, routes: c.routes, keyChecks: acc.keyChecks, scenarios: acc.scenarios, fixtures: acc.fixtures }, d.builds, "oracle check " + i + " " + c.unit.id)
          : { serves: null, failedStep: "the oracle build went missing", reads: null },
      );
    } finally {
      await d.money.settle(adm.id, spent);
    }
  }
  return out;
}

/** Validates one unit: author, audit, two oracle builds, then the counting rules. */
export async function validateUnit(c: Stage3Candidate, d: SelectDeps): Promise<{ validation: Validation; authored: Authored }> {
  const authored = await d.authoring.author(c.unit);
  const acc = accepted(authored, await d.authoring.audit(c.unit, authored));
  if (!acc.keyChecks.length || acc.scenarios.length < STAGE3.scenarios)
    return { authored, validation: { unit: c.unit.id, accepted: acc, validated: [], scenarios: acc.scenarios, oracle: [], qualifies: false, why: "Sol's audit left " + acc.keyChecks.length + " key checks and " + acc.scenarios.length + " scenarios" } };
  const oracle = await oracleRuns(c, acc, d);
  return { authored, validation: { ...countValidation(c.unit.id, acc, oracle), oracle } };
}

/**
 * Tries candidates in draw order, one unit per base app, until maxUnits qualify (16, or 12 under the cut order). Fewer
 * than 8 qualifying: stage 3 doesn't run and the stage 3 items are released.
 */
export async function selectUnits(candidates: readonly Stage3Candidate[], d: SelectDeps, maxUnits: number = STAGE3.maxUnits): Promise<Stage3Selection> {
  const out: Stage3Selection = { units: [], tried: [], skippedBaseApp: [], runs: false, capStop: null, sandboxes: [] };
  d = { ...d, builds: { ...d.builds, tally: out.sandboxes } };
  const apps = new Set<string>();
  for (const c of [...candidates].sort((a, b) => a.unit.position - b.unit.position)) {
    if (out.units.length >= maxUnits) break;
    if (apps.has(c.unit.baseApp)) {
      out.skippedBaseApp.push(c.unit.id);
      continue;
    }
    try {
      const v = await validateUnit(c, d);
      out.tried.push(v.validation);
      if (v.validation.qualifies) {
        out.units.push({ candidate: c, ...v });
        apps.add(c.unit.baseApp);
      }
    } catch (e) {
      if (!(e instanceof CapStopSignal)) throw e;
      out.capStop = { item: e.item, why: e.message };
      break;
    }
  }
  out.runs = out.units.length >= STAGE3.minUnits;
  if (!out.runs) for (const item of ["dc-stage3-authoring", "dc-stage3-builds", "dc-stage3-reads"] as const) await d.money.release(item, "only " + out.units.length + " units qualify for stage 3, under " + STAGE3.minUnits + "; stage 3 doesn't run");
  return out;
}
