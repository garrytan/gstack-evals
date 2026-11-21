// Copyright (c) 2026 Garry Tan. MIT License.
// Part R's readings from its session table (table.ts): section 4.8's primary and the lines beside it, section 1's routing
// decision, and the pilot readout (section 9), which releases no load rate. Intervals: Wilson for one arm, Newcombe's
// method 10 for a paired difference. The MDD is section 10's exact two-sided McNemar at 0.05 and 80% power (power.py),
// ported, at the observed pairs and share of pairs that disagree.
import { readFileSync } from "node:fs";
import { REASONS, split, type HookPosition, type SplitRow } from "./detect.ts";
import { ARM_NAMES, PILOT_TASKS, R, type RArm } from "./pins.ts";
import { frozenRouteTable, type Position, type RouteRow } from "./routes.ts";
import type { RRow } from "./table.ts";

const Z = 1.959963984540054;
export function wilson(k: number, n: number): [number, number] {
  if (!n) return [0, 1];
  const p = k / n, z2 = Z * Z, den = 1 + z2 / n;
  const c = (p + z2 / (2 * n)) / den, h = (Z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / den;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}

/** Paired counts: a both arms yes, b the first arm only, c the second only, d neither. */
export type Pairs = { a: number; b: number; c: number; d: number };
export type Contrast = Pairs & { n: number; diff: number; lo: number; hi: number };
/** Newcombe (1998) method 10: Wilson limits for each marginal, combined with phi corrected toward 0 when ad > bc. */
export function newcombe10({ a, b, c, d }: Pairs): Contrast | null {
  const n = a + b + c + d;
  if (!n) return null;
  const p1 = (a + b) / n, p2 = (a + c) / n, [l1, u1] = wilson(a + b, n), [l2, u2] = wilson(a + c, n);
  const den = Math.sqrt((a + b) * (c + d) * (a + c) * (b + d));
  const phi = den ? (a * d > b * c ? Math.max(a * d - b * c - n / 2, 0) : a * d - b * c) / den : 0;
  const diff = p1 - p2;
  const dl = Math.sqrt(Math.max(0, (p1 - l1) ** 2 - 2 * phi * (p1 - l1) * (u2 - p2) + (u2 - p2) ** 2));
  const du = Math.sqrt(Math.max(0, (u1 - p1) ** 2 - 2 * phi * (u1 - p1) * (p2 - l2) + (p2 - l2) ** 2));
  return { a, b, c, d, n, diff, lo: Math.max(-1, diff - dl), hi: Math.min(1, diff + du) };
}

const LN: number[] = [0];
const lnf = (n: number) => { while (LN.length <= n) LN.push(LN[LN.length - 1]! + Math.log(LN.length)); return LN[n]!; };
const pmf = (k: number, n: number, p: number) => (p <= 0 ? +(k === 0) : p >= 1 ? +(k === n) : Math.exp(lnf(n) - lnf(k) - lnf(n - k) + k * Math.log(p) + (n - k) * Math.log(1 - p)));
const REJECT = new Map<number, (number | null)[]>();
function rejectTable(n: number): (number | null)[] {
  if (REJECT.has(n)) return REJECT.get(n)!;
  const out: (number | null)[] = [];
  for (let D = 0; D <= n; D++) {
    const tail = new Array(D + 2).fill(0);
    for (let g = D; g >= 0; g--) tail[g] = tail[g + 1] + pmf(g, D, 0.5);
    let need: number | null = null;
    for (let g = 0; g <= D; g++) if (g > D / 2 && 2 * tail[g] <= 0.05) { need = g; break; }
    out.push(need);
  }
  REJECT.set(n, out);
  return out;
}
export function powerPaired(n: number, disc: number, diff: number): number {
  if (diff > disc || diff <= 0) return 0;
  const pg = (disc + diff) / (2 * disc), rt = rejectTable(n);
  let pw = 0;
  for (let D = 0; D <= n; D++) {
    const need = rt[D], pD = pmf(D, n, disc);
    if (need == null || pD < 1e-12) continue;
    let s = 0;
    for (let g = need; g <= D; g++) s += pmf(g, D, pg);
    pw += pD * s;
  }
  return pw;
}
/** power.py's mdd(n, disc): the smallest difference in points, in steps of half a point, with 80% power; null when none fits. */
export function mdd(n: number, disc: number): number | null {
  for (let d = 0.005; d <= disc + 1e-9; d += 0.005) if (powerPaired(n, disc, d) >= 0.8) return Math.round(1000 * d) / 10;
  return null;
}

export type Verdict = "HOLD" | "INCOMPLETE" | "KEEP" | "FIX-METHOD" | "CUT-CANDIDATE";
export type DecisionIn = { held: boolean; incomplete: string[]; primary: Contrast | null; passes: Contrast | null; offShare: number; deliveredShare: number; mdd: number | null };
export type Decision = { verdict: Verdict; row: string; captain: string | null; widerThanMdd: boolean | null };
/** Section 1's routing rows, read on the primary. "Wider than the MDD" is read as the interval's width (hi minus lo, in
 *  points) above the MDD at the observed pairs and disagreement; no MDD fits counts as wider. The delivery condition reads
 *  as the line reaching fewer than 90% of the r-on sessions in the primary's pairs. */
export function decide(x: DecisionIn): Decision {
  const out = (verdict: Verdict, row: string, captain: string | null = null, widerThanMdd: boolean | null = null): Decision => ({ verdict, row, captain, widerThanMdd });
  if (x.held) return out("HOLD", "held at the coverage gate: no run, no reading", "the routing part goes to the Captain with the route table");
  if (x.incomplete.length) return out("INCOMPLETE", "no reading; gstack ships routing as planned (B1)", "what is missing: " + x.incomplete.join("; "));
  const p = x.primary;
  if (!p) return out("INCOMPLETE", "no covered task graded in both r-on and r-off", "no primary pairs");
  if (p.lo > 0) return out("KEEP", "primary above 0: routing stays on by default for Codex", x.passes && x.passes.hi < 0 ? "loads up, fixes down: passes r-on minus r-off lies wholly below 0; to the Captain and GStack Minder before the default is confirmed" : null);
  if (p.hi < 0) return out("FIX-METHOD", "primary below 0: routing ships off by default on Codex; FIX-METHOD on its line");
  if (x.offShare >= 0.8) return out("FIX-METHOD", "primary includes 0 and r-off loads in at least 80%: routing ships off on Codex; FIX-METHOD (ceiling) until the R61 attempt runs as its own quick look");
  const wider = x.mdd === null || 100 * (p.hi - p.lo) > x.mdd;
  if (x.deliveredShare < 0.9 || wider) return out("FIX-METHOD", "primary includes 0 and r-off loads in under 80%: routing ships off on Codex; FIX-METHOD (" + (x.deliveredShare < 0.9 ? "line delivered in under 90% of named sessions" : "interval wider than the MDD") + ")", null, wider);
  return out("CUT-CANDIDATE", "primary includes 0 and r-off loads in under 80%: routing ships off on Codex; CUT-CANDIDATE for the line on Codex", "Garry hears the cut candidate in plain words", wider);
}

const by = (rows: RRow[]) => {
  const m = new Map<string, RRow>();
  for (const r of rows) { const k = r.arm + "\t" + r.task, old = m.get(k); if (!old || old.outcome !== "graded" || r.outcome === "graded") m.set(k, r); }
  return (arm: RArm, task: string) => m.get(arm + "\t" + task);
};
const graded = (r: RRow | undefined): r is RRow => r?.outcome === "graded";
const loaded = (r: RRow) => !!r.loads?.prove_it.loaded;
export function pairs(cell: ReturnType<typeof by>, x: RArm, y: RArm, tasks: string[], v: (r: RRow) => boolean): Pairs {
  const p = { a: 0, b: 0, c: 0, d: 0 };
  for (const t of tasks) {
    const rx = cell(x, t), ry = cell(y, t);
    if (!graded(rx) || !graded(ry)) continue;
    const [u, w] = [v(rx), v(ry)];
    p[u && w ? "a" : u ? "b" : w ? "c" : "d"]++;
  }
  return p;
}

export type ArmOutcomes = { arm: RArm; tasks: number; sessions: number; graded: number; not_graded: number; cap_stops: number; infra: number; reservation: number; spend: number; time: number; safety: number; incomplete: boolean };
export type Reading = {
  item: string; outcomes: ArmOutcomes[]; covered: number; primary: Contrast | null; mdd: number | null; offShare: number; deliveredShare: number;
  decision: Decision; endToEnd: Contrast | null; withoutRuleB: Contrast | null; perArm: { arm: RArm; graded: number; loads: number; lo: number; hi: number; firstCall: number; verify: number; steps: number }[];
  split: { "r-on": SplitRow[]; "r-off": SplitRow[] }; reasons: Record<string, number>; passes: { contrast: string; c: Contrast | null; read: boolean }[];
};

export function itemTasks(item: string, table: RouteRow[] = frozenRouteTable()): string[] {
  if (item === "r-pilot") return [...PILOT_TASKS];
  if (item === "r-main") return table.filter((r) => r.kind === "run").map((r) => r.task);
  throw new Error("E_USAGE unknown item " + item + "; one of r-pilot, r-main");
}

function outcomes(rows: RRow[], cell: ReturnType<typeof by>, tasks: string[], arm: RArm, gapMax: number): ArmOutcomes {
  const mine = rows.filter((r) => r.arm === arm), g = tasks.filter((t) => graded(cell(arm, t))).length;
  const n = (f: (r: RRow) => boolean) => mine.filter(f).length;
  return {
    arm, tasks: tasks.length, sessions: mine.length, graded: g, not_graded: tasks.length - g, cap_stops: n((r) => r.outcome === "cap_stop"), infra: n((r) => r.outcome === "infra"),
    reservation: n((r) => r.allowance === "reservation"), spend: n((r) => r.allowance === "spend"), time: n((r) => r.limit_stop === "time"), safety: n((r) => r.safety_stop), incomplete: tasks.length - g > gapMax,
  };
}

/** Section 4.8's reading of the counted item. */
export function reading(rows: RRow[], item: string, table: RouteRow[] = frozenRouteTable()): Reading {
  const tasks = itemTasks(item, table), cell = by(rows);
  const pos = new Map<string, Position>(table.map((r) => [r.task, r.position]));
  const covered = tasks.filter((t) => (pos.get(t) ?? "not named") !== "not named");
  const held = table.filter((r) => r.kind === "run" && r.position !== "not named").length < R.gate;
  const outs = ARM_NAMES.map((a) => outcomes(rows, cell, tasks, a, R.gapMax));
  const incomplete = [
    ...outs.filter((o) => o.arm !== "r-none" && o.incomplete).map((o) => o.arm + " has " + o.not_graded + " of " + o.tasks + " sessions not graded"),
    ...(rows.some((r) => r.outcome === "cap_stop") ? ["a ledger cap stop ended the part"] : []),
  ];
  const primary = newcombe10(pairs(cell, "r-on", "r-off", covered, loaded));
  const onCells = covered.map((t) => [cell("r-on", t), cell("r-off", t)] as const).filter(([u, w]) => graded(u) && graded(w)).map(([u]) => u!);
  const deliveredShare = onCells.length ? onCells.filter((r) => r.loads?.line_delivered).length / onCells.length : 0;
  const offShare = primary ? (primary.a + primary.c) / primary.n : 0;
  const m = primary ? mdd(primary.n, (primary.b + primary.c) / primary.n) : null;
  const passOnOff = newcombe10(pairs(cell, "r-on", "r-off", tasks, (r) => r.pass));
  const noneOk = !outs.find((o) => o.arm === "r-none")!.incomplete;
  const reasons: Record<string, number> = Object.fromEntries(REASONS.map((r) => [r, 0]));
  for (const t of covered) { const r = cell("r-on", t); if (graded(r) && r.loads?.why_no_load) reasons[r.loads.why_no_load]!++; else if (graded(r) && !r.loads) reasons["hook log missing"]!++; }
  const g = (arm: RArm) => tasks.map((t) => cell(arm, t)).filter(graded);
  return {
    item, outcomes: outs, covered: covered.length, primary, mdd: m, offShare, deliveredShare,
    decision: decide({ held, incomplete, primary, passes: passOnOff, offShare, deliveredShare, mdd: m }),
    endToEnd: newcombe10(pairs(cell, "r-on", "r-off", tasks, loaded)),
    withoutRuleB: newcombe10(pairs(cell, "r-on", "r-off", covered, (r) => !!r.loads?.prove_it.rules.some((x) => x !== "b"))),
    perArm: ARM_NAMES.map((arm) => {
      const rs = g(arm), k = rs.filter(loaded).length, [lo, hi] = wilson(k, rs.length);
      return { arm, graded: rs.length, loads: k, lo, hi, firstCall: rs.filter((r) => r.loads?.prove_it.at_first_call).length, verify: rs.filter((r) => r.loads?.verify.loaded).length, steps: rs.filter((r) => r.loads?.steps_arrived).length };
    }),
    split: {
      "r-on": split(g("r-on").map((r) => ({ position: (r.loads?.hook.position ?? "log missing") as HookPosition, prove_it: loaded(r), verify: !!r.loads?.verify.loaded }))),
      "r-off": split(g("r-off").map((r) => ({ position: pos.get(r.task) ?? "not named", prove_it: loaded(r), verify: !!r.loads?.verify.loaded }))),
    },
    reasons,
    passes: [
      { contrast: "r-on minus r-off", c: passOnOff, read: true },
      { contrast: "r-on minus r-none", c: newcombe10(pairs(cell, "r-on", "r-none", tasks, (r) => r.pass)), read: noneOk },
      { contrast: "r-off minus r-none", c: newcombe10(pairs(cell, "r-off", "r-none", tasks, (r) => r.pass)), read: noneOk },
    ],
  };
}

const pct = (x: number) => (100 * x).toFixed(1);
const ci = (c: Contrast | null) => (c ? pct(c.diff) + " points [" + pct(c.lo) + ", " + pct(c.hi) + "] on " + c.n + " pairs (both " + c.a + ", first only " + c.b + ", second only " + c.c + ", neither " + c.d + ")" : "no pairs");

export function renderReading(x: Reading): string {
  const L: string[] = ["# Part R reading: " + x.item, "", "## Decision (section 1)", "", "**" + x.decision.verdict + "**: " + x.decision.row + ".", ""];
  if (x.decision.captain) L.push("To the Captain: " + x.decision.captain + ".", "");
  L.push("Primary, covered tasks graded in both arms (" + x.covered + " covered): r-on loads minus r-off loads, " + ci(x.primary) + ".", "");
  L.push("MDD at these pairs and this disagreement: " + (x.mdd === null ? "none fits" : x.mdd + " points") + "; interval width " + (x.primary ? pct(x.primary.hi - x.primary.lo) + " points" : "n/a") + ". r-off loads in " + pct(x.offShare) + "% of the pairs; the line reached " + pct(x.deliveredShare) + "% of their r-on sessions.", "");
  L.push("## Outcomes and gaps (section 4.7)", "", "| Arm | Tasks | Sessions | Graded | Not graded | Cap stops | Infrastructure | Allowance stops (reservation / spend) | Time stops | Safety stops | Reads |", "|---|---|---|---|---|---|---|---|---|---|---|");
  for (const o of x.outcomes) L.push("| " + [o.arm, o.tasks, o.sessions, o.graded, o.not_graded, o.cap_stops, o.infra, o.reservation + " / " + o.spend, o.time, o.safety, o.incomplete ? "INCOMPLETE" : "complete"].join(" | ") + " |");
  L.push("", "## Beside the primary (section 4.8)", "", "End to end, every task graded in both arms: " + ci(x.endToEnd) + ".", "", "Primary with the loads that count only under rule (b) left out (descriptive, decides nothing): " + ci(x.withoutRuleB) + ".", "");
  L.push("| Arm | Graded | prove-it loads | Wilson 95% | At the first call | /verify loads | Steps arrived |", "|---|---|---|---|---|---|---|");
  for (const a of x.perArm) L.push("| " + [a.arm, a.graded, a.loads, "[" + pct(a.lo) + ", " + pct(a.hi) + "]", a.firstCall, a.verify, a.steps].join(" | ") + " |");
  L.push("", "The split: r-on from each session's hook log, r-off from the route table.", "", "| Arm | Position | Sessions | prove-it | /verify | Neither |", "|---|---|---|---|---|---|");
  for (const arm of ["r-on", "r-off"] as const) for (const s of x.split[arm]) if (s.sessions || arm === "r-on") L.push("| " + [arm, s.position, s.sessions, s.prove_it, s.verify, s.neither].join(" | ") + " |");
  L.push("", "Why a graded r-on session on a covered task didn't load, first reason that applies:", "");
  for (const r of REASONS) L.push("- " + r + ": " + x.reasons[r]);
  L.push("", "Passes (B1's rule), paired:", "");
  for (const p of x.passes) L.push("- " + p.contrast + ": " + (p.read ? ci(p.c) : "not read, r-none is INCOMPLETE"));
  return L.join("\n") + "\n";
}

/** The pilot readout (section 9): supply and gaps, exposure, costs, allowance stops by kind, the hand reading's agreement and
 *  the ceiling flag. No load rate for any arm. hand holds "trial<TAB>prove_it<TAB>verify" lines, yes or no. */
export type PilotArm = { arm: RArm; tasks: number; supplied: number; gaps: string[]; costs: { n: number; mean: number | null; median: number | null; p95: number | null }; reservation: number; spend: number; time: number; safety: number; hand: { read: number; agree: number; disagree: string[] }; passes: boolean };
export type Pilot = { arms: PilotArm[]; exposure: { covered: number; delivered: number; logged: number }; ceiling: boolean };
export function readHand(text: string): Map<string, { prove_it: boolean; verify: boolean }> {
  const m = new Map<string, { prove_it: boolean; verify: boolean }>();
  for (const l of text.split("\n")) {
    const [trial, p, v] = l.trim().split("\t");
    if (!trial || trial === "trial" || !p || !v) continue;
    if (![p, v].every((x) => x === "yes" || x === "no")) throw new Error("E_USAGE the hand reading's " + trial + " line needs yes or no for prove_it and verify");
    m.set(trial, { prove_it: p === "yes", verify: v === "yes" });
  }
  return m;
}
export function pilot(rows: RRow[], hand: Map<string, { prove_it: boolean; verify: boolean }>, table: RouteRow[] = frozenRouteTable()): Pilot {
  const tasks = itemTasks("r-pilot", table), cell = by(rows);
  const pos = new Map<string, Position>(table.map((r) => [r.task, r.position]));
  const covered = tasks.filter((t) => (pos.get(t) ?? "not named") !== "not named");
  const onCovered = covered.map((t) => cell("r-on", t)).filter((r): r is RRow => !!r);
  const exposure = { covered: covered.length, delivered: onCovered.filter((r) => r.loads?.line_delivered).length, logged: onCovered.filter((r) => r.loads && r.loads.hook.position !== "not named" && r.loads.hook.position !== "log missing").length };
  const offCovered = covered.map((t) => cell("r-off", t)).filter(graded);
  const arms = ARM_NAMES.map((arm): PilotArm => {
    const mine = rows.filter((r) => r.arm === arm), gaps = tasks.filter((t) => !graded(cell(arm, t)));
    const cs = mine.map((r) => r.cost_usd).filter((c): c is number => c !== null).sort((a, b) => a - b);
    const mid = cs.length / 2;
    const read = mine.filter((r) => hand.has(r.trial)), disagree = read.filter((r) => { const h = hand.get(r.trial)!; return h.prove_it !== loaded(r) || h.verify !== !!r.loads?.verify.loaded; }).map((r) => r.trial);
    const exposed = arm !== "r-on" || (exposure.delivered === exposure.covered && exposure.logged === exposure.covered);
    return {
      arm, tasks: tasks.length, supplied: tasks.length - gaps.length, gaps,
      costs: { n: cs.length, mean: cs.length ? cs.reduce((a, b) => a + b, 0) / cs.length : null, median: cs.length ? (cs.length % 2 ? cs[Math.floor(mid)]! : (cs[mid - 1]! + cs[mid]!) / 2) : null, p95: cs.length ? cs[Math.ceil(0.95 * cs.length) - 1]! : null },
      reservation: mine.filter((r) => r.allowance === "reservation").length, spend: mine.filter((r) => r.allowance === "spend").length, time: mine.filter((r) => r.limit_stop === "time").length, safety: mine.filter((r) => r.safety_stop).length,
      hand: { read: read.length, agree: read.length - disagree.length, disagree },
      passes: !gaps.length && exposed && read.length >= 2 && !disagree.length,
    };
  });
  return { arms, exposure, ceiling: offCovered.length > 0 && offCovered.length === covered.length && offCovered.every(loaded) };
}

export function renderPilot(p: Pilot): string {
  const usd = (x: number | null) => (x === null ? "n/a" : "$" + x.toFixed(2));
  const L = ["# Part R pilot readout", "", "It releases no load rate for any arm (section 9).", "", "| Arm | Tasks supplied | Gaps | Cost mean / median / p95 | Allowance stops: reservation refused / spend reached $" + R.allowanceUsd + " | Time stops | Safety stops | Hand reading agrees | Pilot |", "|---|---|---|---|---|---|---|---|---|"];
  for (const a of p.arms) L.push("| " + [a.arm, a.supplied + " of " + a.tasks, a.gaps.join(", ") || "none", [a.costs.mean, a.costs.median, a.costs.p95].map(usd).join(" / "), a.reservation + " / " + a.spend, a.time, a.safety, a.hand.agree + " of " + a.hand.read + (a.hand.disagree.length ? " (disagrees: " + a.hand.disagree.join(", ") + ")" : ""), a.passes ? "passes" : "fails"].join(" | ") + " |");
  L.push("", "Exposure, r-on on the " + p.exposure.covered + " covered pilot tasks: the line was delivered in " + p.exposure.delivered + " and logged naming prove-it in " + p.exposure.logged + ".", "");
  if (p.arms.some((a) => a.reservation)) L.push("Allowance stops where the proxy refused a reservation before the session spent $" + R.allowanceUsd + " appeared, so a dated change raises the allowance before r-main (the parent's ruling D).", "");
  L.push(p.ceiling ? "**Ceiling case (section 1):** r-off loaded prove-it in every covered pilot session. The counted run goes ahead unless the Captain stops it." : "r-off did not load prove-it in every covered pilot session.");
  return L.join("\n") + "\n";
}

export function reportMain(tablePath: string, item: string, handPath?: string): string {
  const rows: RRow[] = readFileSync(tablePath, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
  if (item === "r-pilot") return renderPilot(pilot(rows, handPath ? readHand(readFileSync(handPath, "utf8")) : new Map()));
  return renderReading(reading(rows, item));
}
