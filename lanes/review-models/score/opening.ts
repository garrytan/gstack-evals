// When the review-models eval's paid steps may start (pre-run change 10, GEVA-590). Pilot steps and the paid preparation
// the pilot needs open at PILOT_OPENS; counted steps, the validation batch included, keep the frozen 2026-11-28 06:00Z
// and still wait for the Captain's read of the pilot readout. There is no flag or variable that moves either time.
import { rmFail } from "./frozen.ts";

export const OPENS = { pilot: "2026-11-26T21:30:00Z", counted: "2026-11-28T06:00:00Z" } as const;
export type Phase = keyof typeof OPENS;

/** The eval closed when the gstack-evals Captain accepted the pilot's R111 stop. The steps that reach the seven defects the
 * final review found (its sends, contamination, validation readout, visibility steps, pilot plan, pilot run, e2e and
 * review-units --cell-items) call requireLive first. Reading the historical pilot readout stays open. A generic review-units
 * run without --cell-items and rm-run items are not closed here. Reopening needs a new preregistration and fixes for the defects listed on
 * the results page (wiki/board/2026-11-27-geva-590-review-models-results), not a change to this line alone. */
export const CLOSED = { at: "2026-11-27T05:33:50Z", why: "the pilot stopped under R111 and the Captain accepted the stop" } as const;

/** Refuses every step of the closed eval, before it reads, writes or spends anything. */
export function requireLive(step: string): void {
  rmFail("E_RM_CLOSED", step + " is a step of the review-models eval, which closed at " + CLOSED.at + ": " + CLOSED.why);
}

/** Refuses a paid step whose phase has not opened yet. */
export function requireOpen(phase: Phase, step: string, now: number = Date.now()): void {
  if (now < Date.parse(OPENS[phase])) rmFail("E_RM_NOT_OPEN", step + " is a " + phase + " step and opens at " + OPENS[phase] + " (pre-run change 10); it is " + new Date(now).toISOString());
}
