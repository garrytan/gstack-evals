// Copyright (c) 2026 Garry Tan. MIT License.
// The read area's own shapes: one scored review cell as the readings take it, and the judge check figures they read.
// They live here, not in the lane's types.ts, because no other area codes against them yet; the integrator may move them.
import type { CellState, Model, SessionKind } from "../types.ts";

/**
 * One review cell after its state is final (plan section 6). a is the cell's A at the read tier; g and d are set at the
 * 10x read only (d null when the unit holds no detail-keyed item). shuffledA and shuffledG are the same list scored
 * against the shuffle partner's key, G with the partner's keyed details (PD-7). words is the list's word count.
 * exposed is the arm's detector reading; null when it couldn't be read.
 */
export interface ReadCell {
  unit: string;
  model: Model;
  arm: SessionKind;
  pass: number;
  state: CellState;
  a: number | null;
  g: number | null;
  d: number | null;
  shuffledA: number | null;
  shuffledG: number | null;
  words: number | null;
  exposed: boolean | null;
}

/** A judge check's figures as the score area reports them: kappa (null when not estimable) and the gold shortfall. */
export interface JudgeCheck {
  kappa: number | null;
  goldShort: boolean;
}
