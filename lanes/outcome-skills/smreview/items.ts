// Copyright (c) 2026 Garry Tan. MIT License.
// SR's ledger items and caps (plan section 12), fixed in code like pstack-checks' items.ts. This file records nothing and
// opens nothing: the caps are recorded on the ledger at init, and the driver's stage (driver/stage.ts) serves an SR item's
// arms on its models through the PF session path at srLimits' allowances.
import { OPUS, P1 } from "../pfchecks/items.ts";
import { SR_ARMS } from "./arms.ts";

const M = 1_000_000;

export const LINE = { name: "state-machines-review", cap_micros: 2720 * M, crew_counted_micros: 250 * M } as const;

export interface ItemDef { item: string; program: typeof LINE.name; skills: string[]; cap_micros: number; model: string | null; what: string }
const item = (name: string, usd: number, model: string | null, what: string): ItemDef => ({ item: name, program: LINE.name, skills: ["sr"], cap_micros: usd * M, model, what });

export const ITEMS: Record<string, ItemDef> = Object.fromEntries([
  item("sr-labels", 40, null, "GPT-6 Astra and Opus 5.5 eligibility labels with the state machines labeller, for the units it never labelled"),
  item("sr-vm", 400, null, "VMs: the oracle and the neutral-tree check on every drawn unit, and every session's runner"),
  item("sr-pilot", 180, null, "the pilot: 6 units, all five arms on Opus 5.5 and particle-1, one session a cell"),
  item("sr-opus", 1750, OPUS, "the counted run on Opus 5.5: n up to 40, all five arms, two sessions a cell"),
  item("sr-particle", 350, P1, "the same on particle-1"),
].map((d) => [d.item, d]));

/** The driver's SR stages: each session item and the models it pays for; every SR arm, as the PF path names it. */
export const SR_STAGES: Record<string, { models: readonly string[]; arms: string[] }> = {
  "sr-pilot": { models: [OPUS, P1], arms: SR_ARMS.map((a) => "pf:" + a) },
  "sr-opus": { models: [OPUS], arms: SR_ARMS.map((a) => "pf:" + a) },
  "sr-particle": { models: [P1], arms: SR_ARMS.map((a) => "pf:" + a) },
};

/** Planning prices per session in dollars: Opus N 2, C 4, P 4, G+ 6, G0 5; particle-1 at 0.2 of Opus. VM per session. */
export const PLANNING: Record<string, Record<string, number>> = {
  [OPUS]: { N: 2, C: 4, P: 4, "G+": 6, G0: 5 },
  [P1]: { N: 0.4, C: 0.8, P: 0.8, "G+": 1.2, G0: 1 },
};
export const VM_USD = 0.4;
export const N_MAX = 40, N_MIN = 20, SESSIONS = 2, PILOT_UNITS = 6;

export function itemsTable(): string[] {
  const sum = Object.values(ITEMS).reduce((a, d) => a + d.cap_micros, 0);
  return ["line " + LINE.name + " cap_micros=" + LINE.cap_micros + " items_micros=" + sum + " crew_counted_micros=" + LINE.crew_counted_micros, ...Object.values(ITEMS).map((d) => "  " + d.item + " cap_micros=" + d.cap_micros + " model=" + (d.model ?? "-") + "  " + d.what)];
}
