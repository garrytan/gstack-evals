// Copyright (c) 2026 Garry Tan. MIT License.
// SR's sessions (plan sections 4 to 6): the plan of a part, and one session through the pstack-checks session path
// (pfchecks/run.ts runPfSession) with the review fields set: the arm's task turn, SR's limits, pstack for P, the gstack
// home for G+ and G0 checked against its commit, and the change under review built as the session's two commits.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { seededRandom } from "../../../src/runner/stats/paired.ts";
import type { Names, PfArm } from "../pfchecks/arms.ts";
import { runPfSession, type PfRun } from "../pfchecks/run.ts";
import { OPUS } from "../pfchecks/items.ts";
import { readUnit } from "../statemachines/unit.ts";
import { GSTACK, SR_ARMS, SR_MODELS, loadsGstack, loadsPstack, srLimits, srTaskTurn, type SrArm } from "./arms.ts";
import { srFail } from "./errors.ts";
import { SESSIONS } from "./items.ts";

export type Part = "pilot" | "test";
export interface SrPlanned { unit: string; part: Part; index: number; model: string; arm: SrArm; rep: number; item: string }

const itemOf = (part: Part, model: string) => (part === "pilot" ? "sr-pilot" : model === OPUS ? "sr-opus" : "sr-particle");

/** A part's sessions in order: per unit, every (model, arm, session) cell shuffled by one seededRandom(order_seed + k)
 *  stream (k 0 for the pilot, 1 for the counted run), so a unit's sessions run together, interleaved. The pilot runs
 *  one session a cell, the counted run SESSIONS. */
export function srPlan(units: string[], orderSeed: number, part: Part, models: readonly string[] = SR_MODELS): SrPlanned[] {
  if (!Number.isSafeInteger(orderSeed) || orderSeed < 0) srFail("E_SR_INPUT", "the order seed must be a whole number, from prereg.json order_seed");
  const reps = part === "pilot" ? 1 : SESSIONS;
  const rand = seededRandom(orderSeed + (part === "pilot" ? 0 : 1));
  const out: SrPlanned[] = [];
  for (const unit of units) {
    const cells = models.flatMap((model) => SR_ARMS.flatMap((arm) => Array.from({ length: reps }, (_, k) => ({ model, arm, rep: k + 1 }))));
    for (let i = cells.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [cells[i], cells[j]] = [cells[j]!, cells[i]!];
    }
    for (const c of cells) out.push({ unit, part, index: out.length, ...c, item: itemOf(part, c.model) });
  }
  return out;
}

/** The PF arm the session record's type carries (SR's own arm is the review field's): it changes nothing in the run. */
const pfArmOf = (arm: SrArm): PfArm => (arm === "N" || arm === "P" ? arm : "C");

export interface SrRunInput {
  unitDir: string; session: SrPlanned; names: Names; control: string; proxy: string; out: string; volume: string;
  effort: Record<string, Record<string, unknown>> | null;
  /** The homes arms/qa-install.sh filled for G+ and G0, each with gstack checked out at that arm's commit. */
  homes: Partial<Record<"G+" | "G0", string>>; harbor?: string; claude?: string; probeNode?: string;
}

/** The commit a home's gstack checkout is at, or null. */
export function homeCommit(home: string): string | null {
  const r = spawnSync("git", ["-C", join(home, ".claude/skills/gstack"), "rev-parse", "HEAD"], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}

export async function runSrSession(i: SrRunInput, run: typeof runPfSession = runPfSession): Promise<PfRun> {
  const s = i.session;
  const u = readUnit(i.unitDir);
  if (u.id !== s.unit) srFail("E_SR_INPUT", "session " + s.index + " is on unit " + s.unit + ", not " + u.id);
  if (!(SR_MODELS as readonly string[]).includes(s.model)) srFail("E_SR_ARM", "model " + s.model + " is not one of " + SR_MODELS.join(", "));
  if (!u.files["pr.patch"] || !existsSync(join(i.unitDir, "pr.patch"))) srFail("E_SR_INPUT", u.id + " has no pr.patch; convert it with sr convert");
  const pr = readFileSync(join(i.unitDir, "pr.patch"), "utf8");
  let home: string | null = null, pin: string | null = null;
  if (loadsGstack(s.arm)) {
    home = i.homes[s.arm] ?? srFail("E_SR_ARM", "arm " + s.arm + " needs its gstack home (--home-" + (s.arm === "G+" ? "gplus" : "g0") + ")");
    pin = GSTACK[s.arm];
    const at = homeCommit(home);
    if (at !== pin) srFail("E_SR_ARM", "arm " + s.arm + "'s home " + home + " has gstack at " + at + ", not " + pin);
  }
  return run({
    unitDir: i.unitDir, session: { unit: s.unit, part: s.part === "pilot" ? 0 : 1, index: s.index, model: s.model, arm: pfArmOf(s.arm), item: s.item }, names: i.names, control: i.control, proxy: i.proxy, out: i.out, volume: i.volume, effort: i.effort,
    review: { arm: s.arm, text: srTaskTurn(s.arm, i.names), pr, limits: srLimits(s.model), plugin: loadsPstack(s.arm), home, pin },
    ...(i.harbor ? { harbor: i.harbor } : {}), ...(i.claude ? { claude: i.claude } : {}), ...(i.probeNode !== undefined ? { probeNode: i.probeNode } : {}),
  });
}
