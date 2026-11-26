// When the review-models eval's paid steps may start (pre-run change 10, GEVA-590). Pilot steps and the paid preparation
// the pilot needs open at PILOT_OPENS; counted steps, the validation batch included, keep the frozen 2026-11-28 06:00Z
// and still wait for the Captain's read of the pilot readout. There is no flag or variable that moves either time.
import { rmFail } from "./frozen.ts";

export const OPENS = { pilot: "2026-11-26T21:30:00Z", counted: "2026-11-28T06:00:00Z" } as const;
export type Phase = keyof typeof OPENS;

/** Refuses a paid step whose phase has not opened yet. */
export function requireOpen(phase: Phase, step: string, now: number = Date.now()): void {
  if (now < Date.parse(OPENS[phase])) rmFail("E_RM_NOT_OPEN", step + " is a " + phase + " step and opens at " + OPENS[phase] + " (pre-run change 10); it is " + new Date(now).toISOString());
}
