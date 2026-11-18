// Copyright (c) 2026 Garry Tan. MIT License.
// The reading area's dry-run seams for the office-hours rewrite eval (prereg
// wiki/plans/2026-11-17-geva-552-office-hours-rewrite-prereg, section 12 stage 1's dry run: every row of section 10 on
// planted data, and every gate on planted known-good and known-bad cases). Each seam drives one frozen rule on one side
// of its edge through this area's code, on invented rows that are never eval briefs. The fixture builders are exported
// for tests/ohr/read.
import { ARMS, MODELS, PRIMARY_MODELS } from "../frozen.ts";
import type { ArmId, EndState, KeptWhole, ModelId, ScoredSession, Seam } from "../types.ts";

// ---- Fixtures ----

/** One scored session: a stage 2 founder block on brief f01 that made the right call. */
export const row = (o: Partial<ScoredSession>): ScoredSession => ({
  stage: 2, brief: "f01", model: "opus", arm: "none", kind: "founder", cluster: "f01", set: "comparison", traction: false, end: "block",
  R1: 1, R2: 1, R3: 1, R: 1, exposure: null, kept_whole: null, compliance: null, founder_replies: 5, questions: 5, usd: 1, sim_usd: 0.1, ...o,
});

const pad = (k: number) => String(k).padStart(2, "0");
const kept = (k: boolean, startup_only: string[] = []): KeptWhole => ({ builder_mode: true, startup_only, builder_doc_approved: k, before_cap: true, kept: k });

/**
 * 24 builder briefs b01 to b24, each its own cluster, on every arm and model of stage 2. Every skill session is kept
 * whole and every session makes the right call, except: new loses kept-whole on the lost briefs, new loses the right
 * call on the wrong briefs, and the leak briefs' new sessions carry a detector hit for a startup-only question.
 */
export function builderRows(o: { lost?: string[]; wrong?: string[]; leak?: string[]; models?: readonly ModelId[] }): ScoredSession[] {
  const out: ScoredSession[] = [];
  for (let k = 1; k <= 24; k++) {
    const brief = "b" + pad(k);
    for (const model of o.models ?? MODELS) for (const arm of ARMS) {
      const isNew = arm === "new";
      const R = isNew && o.wrong?.includes(brief) ? 0 : 1;
      out.push(row({ brief, cluster: brief, kind: "builder", model, arm, R, R2: R, kept_whole: arm === "none" ? null : kept(!(isNew && o.lost?.includes(brief)), isNew && o.leak?.includes(brief) ? ["the payment test"] : []) }));
    }
  }
  return out;
}

type Bit = 0 | 1;
export interface FounderPlan {
  /** R per arm, brief index j (0 to 39; twins j and j+1 for even j share cluster c = floor(j / 2)) and model. Defaults to 1. */
  R?: (arm: ArmId, j: number, model: ModelId) => Bit;
  questions?: (arm: ArmId, j: number) => number;
  replies?: (arm: ArmId, j: number) => number;
  traction?: (j: number) => boolean;
  /** An end other than block; missing and contaminated rows carry no bits. */
  end?: (arm: ArmId, j: number, model: ModelId) => EndState | undefined;
  stage?: 1 | 2;
}

/** 40 founder briefs f01 to f40 in 20 twin clusters c01 to c20, on every arm and model, 5 questions and 5 founder replies each. */
export function founderRows(p: FounderPlan): ScoredSession[] {
  const out: ScoredSession[] = [];
  for (let j = 0; j < 40; j++) for (const model of MODELS) for (const arm of ARMS) {
    const end = p.end?.(arm, j, model) ?? "block";
    const gone = end === "missing" || end === "contaminated";
    const R = gone ? null : (p.R?.(arm, j, model) ?? 1);
    out.push(row({
      stage: p.stage ?? 2, brief: "f" + pad(j + 1), cluster: "c" + pad(Math.floor(j / 2) + 1), model, arm, end, traction: p.traction?.(j) ?? false,
      R, R1: gone ? null : 1, R2: R, R3: gone ? null : 1, questions: 5 + (p.questions?.(arm, j) ?? 0), founder_replies: 5 + (p.replies?.(arm, j) ?? 0),
    }));
  }
  return out;
}

export const seams: Seam[] = [];
