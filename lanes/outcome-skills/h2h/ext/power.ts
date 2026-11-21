// Copyright (c) 2026 Garry Tan. MIT License.
// The extension bundle's power.py in TypeScript (plan section 13): the base power function's MDD (exact McNemar by
// simulation, 80% power, design effect 1.2, numpy's stream) at the strictest Holm step of each part's family, then the
// chance a no-harm criterion passes by normal approximation with design effect 1.2. extPowerText prints power.txt byte
// for byte.
import { phi } from "../../../../src/runner/stats/outcome-decision.ts";
import { mdd, POWER, pyRound } from "../analysis/power.ts";

/** Section 13's rows: part, class and n, with the family size whose strictest Holm step it reads. */
export const POWER_ROWS: readonly { label: string; n: number; m: number }[] = [
  { label: "S, O, 100", n: 100, m: 10 }, { label: "S, B, 60", n: 60, m: 10 }, { label: "P, O, 100", n: 100, m: 12 }, { label: "P, B, 60", n: 60, m: 12 }, { label: "L, 100", n: 100, m: 3 },
];
export const NO_HARM_ROWS: readonly [number, number][] = [[100, 0.2], [100, 0.3], [100, 0.5], [60, 0.2]];

/** The chance a no-harm criterion passes when the true difference is trueDiff: the point difference must reach the higher
 *  of the floor and -1.96 standard errors, the standard error being sqrt(design effect * discordant share / n). */
export function noHarmPass(n: number, d: number, trueDiff: number, deff: number = POWER.deff, floor = -0.05, z = 1.959964): number {
  const se = Math.sqrt((deff * d) / n);
  return phi((trueDiff - Math.max(floor, -z * se)) / se);
}

const fmt = (v: number | null) => (v === null ? "none fits" : String(pyRound(100 * v)));
/** power.txt, line for line. */
export function extPowerText(): string {
  const out = ["part, class, n | strictest Holm step | MDD at discordant 0.2 | 0.3 | 0.4"];
  for (const r of POWER_ROWS) out.push(r.label + " | 0.05/" + r.m + " | " + [0.2, 0.3, 0.4].map((d) => fmt(mdd(r.n, d, 0.05 / r.m))).join(" | "));
  out.push("no-harm pass probability | n | discordant share | true 0 points | true -5 points | true -10 points");
  for (const [n, d] of NO_HARM_ROWS) out.push("no-harm | " + n + " | " + d + " | " + [0, -0.05, -0.1].map((t) => noHarmPass(n, d, t).toFixed(2)).join(" | "));
  return out.join("\n") + "\n";
}
