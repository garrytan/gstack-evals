// Copyright (c) 2026 Garry Tan. MIT License.
// Part C's pilot readout (preregistration section 9) and the R113 line (section 10). It releases only supply and gap
// counts, the contract's exposure numbers, costs, the hand-reading agreement and the judge check. It releases no found
// rate for any arm: nothing here reads a judged match. It says plainly when the contract blocked in no c-on pilot
// session (the ceiling case), and it names the pre-run change 1 flags the Captain hears before c-main spends.
import { ALLOWANCE_USD, ARMS, R113, POWER, SESSIONS_PER_ARM, type CArm } from "./frozen.ts";
import type { PilotCheck } from "./check.ts";
import type { StatesFile } from "./record.ts";

/** One hand reading (section 9): whether the detectors and the contract readout agree with a person's reading of a session. */
export interface HandReading {
  arm: CArm;
  session: string;
  agree: boolean;
  note: string;
}

const quantile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))]! : null;
};

export interface PilotArm {
  arm: CArm;
  sessions: number;
  scored: number;
  gaps: Record<string, number>;
  reruns: number;
  missing: number;
  exposure: { blocked: number; blocks: number; evaluated_stops: number; items_named: Record<string, number>; fail_open: number; false_block: number; would_block: number };
  flags: { read_shape_sessions: number; unknown_namespace_sessions: number; other_model_sessions: number };
  cost: { metered: number; mean_usd: number | null; median_usd: number | null; p95_usd: number | null; allowance_usd: number; over_half_allowance: boolean };
  hand: { read: number; agree: number };
}

export interface PilotReadout {
  arms: PilotArm[];
  statements: string[];
  judge_check: PilotCheck | null;
  r113: { projected_usd: number | null; look: boolean; line: string };
}

export function pilotReadout(states: StatesFile, hand: readonly HandReading[], check: PilotCheck | null): PilotReadout {
  const arms = ARMS.map((arm): PilotArm => {
    const ss = states.sessions.filter((s) => s.arm === arm);
    const scored = ss.filter((s) => s.outcome === "scored");
    const gaps: Record<string, number> = {};
    for (const s of ss) if (s.outcome !== "scored") gaps[s.outcome_code!] = (gaps[s.outcome_code!] ?? 0) + 1;
    const items: Record<string, number> = {};
    for (const s of scored) for (const i of s.exposure?.items_named ?? []) items[i] = (items[i] ?? 0) + 1;
    const usd = scored.map((s) => s.cost.usd).filter((x): x is number => x !== null);
    const p95 = quantile(usd, 0.95);
    const sum = (f: (s: (typeof scored)[number]) => number) => scored.reduce((n, s) => n + f(s), 0);
    const hs = hand.filter((h) => h.arm === arm);
    return {
      arm,
      sessions: ss.length + states.missing.filter((m) => m.arm === arm).length,
      scored: scored.length,
      gaps,
      reruns: ss.filter((s) => s.attempts === 2).length,
      missing: states.missing.filter((m) => m.arm === arm).length,
      exposure: { blocked: scored.filter((s) => s.blocked).length, blocks: sum((s) => s.exposure?.blocks ?? 0), evaluated_stops: sum((s) => s.exposure?.evaluated_stops ?? 0), items_named: items, fail_open: scored.filter((s) => s.exposure?.fail_open).length, false_block: scored.filter((s) => s.exposure?.false_block).length, would_block: scored.filter((s) => s.exposure?.would_block).length },
      flags: { read_shape_sessions: scored.filter((s) => (s.exposure?.read_shape_flags ?? 0) > 0).length, unknown_namespace_sessions: scored.filter((s) => (s.exposure?.unknown_namespace_spawns ?? 0) > 0).length, other_model_sessions: scored.filter((s) => (s.exposure?.subagent_other_model ?? 0) > 0).length },
      cost: { metered: usd.length, mean_usd: usd.length ? usd.reduce((a, b) => a + b, 0) / usd.length : null, median_usd: quantile(usd, 0.5), p95_usd: p95, allowance_usd: ALLOWANCE_USD[arm], over_half_allowance: p95 !== null && p95 > ALLOWANCE_USD[arm] / 2 },
      hand: { read: hs.length, agree: hs.filter((h) => h.agree).length },
    };
  });
  const by = (a: CArm) => arms.find((x) => x.arm === a)!;
  const statements: string[] = [];
  if (by("c-on").scored && by("c-on").exposure.blocked === 0) statements.push("The contract blocked in no c-on pilot session: the ceiling case of section 1. The counted run goes ahead unless the Captain stops it.");
  for (const a of ["c-on", "c-high"] as const) {
    if (by(a).exposure.fail_open) statements.push(a + ": the contract failed open in " + by(a).exposure.fail_open + " pilot sessions, so this arm's pilot does not pass (section 9).");
    for (const [k, n] of [["SKILL.md read-shape flags", by(a).flags.read_shape_sessions], ["spawn_agent calls in an unknown namespace", by(a).flags.unknown_namespace_sessions]] as const) if (n > 1) statements.push(a + ": " + k + " in " + n + " pilot sessions, more than one, so the Captain hears it before c-main spends (pre-run change 1, section 7).");
    if (by(a).flags.other_model_sessions) statements.push(a + ": a sub-agent ran on another model in " + by(a).flags.other_model_sessions + " pilot sessions, so the Captain hears it before c-main spends (pre-run change 1, section 10).");
  }
  if (arms.some((a) => a.cost.over_half_allowance)) statements.push("A pilot 95th-percentile session cost passes half its allowance in " + arms.filter((a) => a.cost.over_half_allowance).map((a) => a.arm).join(", ") + ": every allowance of part C doubles before the counted run, and its caps are re-priced (section 5.7).");
  for (const a of arms) if (a.hand.read < 2 || a.hand.agree < a.hand.read) statements.push(a.arm + ": the hand reading agrees on " + a.hand.agree + " of " + a.hand.read + " sessions; section 9 needs agreement on 2 sessions per arm.");
  if (check && !check.pass) statements.push("The judge check failed on route " + check.route + " (primary " + (check.primary.why ?? "passed") + "; joined " + (check.joined.why ?? "passed") + "). Route B, with Gemini 4 Carbon as the primary, is judged and checked the same way (section 5.5).");
  return { arms, statements, judge_check: check, r113: r113Line(arms) };
}

/** R113: the counted run re-priced at the pilot's mean session costs, 66 sessions per arm, plus the VM shares and the judge item. */
export function r113Line(arms: readonly PilotArm[]): PilotReadout["r113"] {
  if (arms.some((a) => a.cost.mean_usd === null)) return { projected_usd: null, look: false, line: "R113: not re-priced, since an arm has no metered pilot session; the planned run is $" + R113.planned_usd + ", under $" + R113.threshold_usd + ", so no interim look until re-pricing says otherwise." };
  const projected = arms.reduce((n, a) => n + SESSIONS_PER_ARM * a.cost.mean_usd!, 0) + R113.vm_usd + R113.judge_usd;
  if (projected <= R113.threshold_usd) return { projected_usd: projected, look: false, line: "R113: no interim look. The counted run re-priced at the pilot's costs is $" + projected.toFixed(2) + ", not above $" + R113.threshold_usd + "." };
  return { projected_usd: projected, look: true, line: "R113: the counted run re-priced at the pilot's costs is $" + projected.toFixed(2) + ", above $" + R113.threshold_usd + ". Before its first counted session, a dated change adds one look at half its units in seeded unit order: O'Brien-Fleming two-look bounds at two-sided 0.05 per decision, |z| of at least " + POWER.obrien_fleming.interim_z + " at the look and " + POWER.obrien_fleming.final_z + " at the end; a futility stop when conditional power under the planned effect (the MDD) falls below " + R113.futility_conditional_power * 100 + "%; an early stop flagged as possibly overstated; no other look at any primary; an arm stops only when every decision that reads it has stopped." };
}
