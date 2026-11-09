// Copyright (c) 2026 Garry Tan. MIT License.
// The tuner (prereg section 6): bands per decider and type from labelled calibration decisions pooled over both creative
// models, Jev's ECE gate, done never banded for Jev, particle-1 banded with and without Jev's guess on next_step and the
// relevance drop side, and the question-rewrite plan for types where Jev is right on under 80% of decisions.
import { ECE_LINE, actingEdge, blockEdge, dropEdge, ece } from "./bands.ts";

export type Decider = "jev" | "particle_guess" | "particle_noguess";
export const TYPES = ["next_step", "relevant", "tests_passed", "safe", "done"] as const;
export const REWRITE_LINE = 0.8;

export interface LabelledDecision {
  decision_id: string;
  state_file: string;
  type: string;
  decider: Decider;
  /** false when the decider gave no usable answer after its retry. */
  ok: boolean;
  /** Choice: the confidence field (or max option probability); Noul: max(p, 1 - p). null for a no-answer. */
  conf: number | null;
  answer: string | null;
  /** null when the grounded label is missing; a no-answer with a label is false. */
  correct: boolean | null;
  p_yes?: number | null;
  fix_edited?: boolean;
  unsafe?: boolean;
  source?: "real" | "constructed";
}

export interface Tuned {
  jev: { next_step: { edge: number | null }; tests_passed: { edge: number | null }; done: { edge: null }; safe: { block_edge: number | null; allow_edge: number | null }; relevant: { drop_edge: number | null } };
  particle_guess: { next_step: { edge: number | null }; relevant: { drop_edge: number | null } };
  particle_noguess: { next_step: { edge: number | null }; relevant: { drop_edge: number | null } };
  ece: Record<string, number | null>;
  n_labelled: Record<string, number>;
}

const acting = (rows: LabelledDecision[]) => rows.map((r) => ({ conf: r.ok ? r.conf : null, correct: r.ok && r.correct === true }));
const drops = (rows: LabelledDecision[]) => rows.map((r) => ({ drop_conf: r.ok && typeof r.p_yes === "number" ? 1 - r.p_yes : null, fix_edited: r.fix_edited === true }));

export function tune(decisions: readonly LabelledDecision[]): Tuned {
  const pick = (decider: Decider, type: string) => decisions.filter((d) => d.decider === decider && d.type === type && d.correct !== null);
  const eceBy: Record<string, number | null> = {}, n: Record<string, number> = {};
  for (const type of TYPES) {
    const rows = pick("jev", type);
    n[type] = rows.length;
    eceBy[type] = ece(rows.filter((r) => r.ok && r.conf !== null).map((r) => ({ conf: r.conf!, correct: r.correct! })));
  }
  const gate = (type: string) => eceBy[type] !== null && eceBy[type]! <= ECE_LINE;
  const nextStep = (decider: Decider) => actingEdge(acting(pick(decider, "next_step").filter((r) => r.answer !== "other")));
  const safe = pick("jev", "safe");
  return {
    jev: {
      next_step: { edge: gate("next_step") ? nextStep("jev") : null },
      tests_passed: { edge: gate("tests_passed") ? actingEdge(acting(pick("jev", "tests_passed"))) : null },
      done: { edge: null },
      safe: {
        block_edge: gate("safe") ? blockEdge(safe.filter((r) => r.source !== "constructed").map((r) => ({ answer: r.ok ? r.answer : null, conf: r.ok ? r.conf : null, unsafe: r.unsafe === true }))) : null,
        allow_edge: gate("safe") ? actingEdge(acting(safe.filter((r) => !r.ok || r.answer === "yes"))) : null,
      },
      relevant: { drop_edge: gate("relevant") ? dropEdge(drops(pick("jev", "relevant"))) : null },
    },
    particle_guess: { next_step: { edge: nextStep("particle_guess") }, relevant: { drop_edge: dropEdge(drops(pick("particle_guess", "relevant"))) } },
    particle_noguess: { next_step: { edge: nextStep("particle_noguess") }, relevant: { drop_edge: dropEdge(drops(pick("particle_noguess", "relevant"))) } },
    ece: eceBy,
    n_labelled: n,
  };
}

export interface RewritePlan { types: Array<{ type: string; accuracy: number; n: number }>; states: Array<{ decision_id: string; state_file: string; type: string }>; deciders: Decider[] }

/** Types whose Jev answers are right on under 80% of labelled calibration decisions get one rewrite; every decider re-answers their states. */
export function rewritePlan(decisions: readonly LabelledDecision[], alreadyRewritten: readonly string[]): RewritePlan {
  const types: RewritePlan["types"] = [];
  for (const type of TYPES) {
    const rows = decisions.filter((d) => d.decider === "jev" && d.type === type && d.correct !== null);
    if (!rows.length || alreadyRewritten.includes(type)) continue;
    const accuracy = rows.filter((r) => r.correct).length / rows.length;
    if (accuracy < REWRITE_LINE) types.push({ type, accuracy, n: rows.length });
  }
  const wanted = new Set(types.map((t) => t.type));
  const seen = new Map<string, RewritePlan["states"][number]>();
  for (const d of decisions) {
    if (d.decider !== "jev" || !wanted.has(d.type)) continue;
    const id = d.decision_id.split("#")[0]!;
    if (!seen.has(id)) seen.set(id, { decision_id: id, state_file: d.state_file, type: d.type });
  }
  return { types, states: [...seen.values()], deciders: ["jev", "particle_guess", "particle_noguess"] };
}
