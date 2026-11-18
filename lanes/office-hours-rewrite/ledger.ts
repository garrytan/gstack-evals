// Copyright (c) 2026 Garry Tan. MIT License.
// The office-hours rewrite eval's ledger items: how each approved item cap (frozen.CAPS, pre-run change 1 item 4a) splits
// into the ledger items its runs lease, and the schedule check that says whether each launch finishes inside them. One
// ledger item serves one run, a launch leases two (arms through the rig, simulator through the meter), and a stage's
// production labels are their own run inside the stage's approved item. Pre-run change 4 freezes this table as its
// split.tsv (replacing change 3's), and tests/ohr/ledger.test.ts holds the two equal.
//
// The schedule check (pre-run change 4, fix 1) walks each launch's real round order from the manifest builder
// (run/manifest.ts launchRounds) at a multiple of cost.py's central figure a session (CENTRAL), and applies the launch
// loop's reservation rule (run/run.ts roundReserve): a round starts only when one attempt's arm allowance for each of
// its sessions fits the arm item after the spend so far, and the simulator allowance, once a session, fits the
// simulator item. A launch finishes when every round starts, and its labels item then holds the labels of every session
// at the same multiple plus LABEL_RESERVE for the judge call in flight. Retries are not modelled: a retry runs only when
// its allowance still fits, so a retry the item cannot hold ends the launch as a cap stop, which reads INCOMPLETE.
// - Stage 1 must finish at 1.35 times central. Its one admission repair (change 1, item 4a; prereg section 12 stage 4)
//   reruns only what failed, which is at most the whole of stage 1, so it is checked as a launch over stage 1's rounds
//   on the remainder of stage 1's cap, and must start at least its first round (one brief on Opus, the costliest).
// - Stage 2 and particle-1's stage 2 must finish at central. Their approved caps cannot hold their schedules at 1.35
//   times central under this rule, whatever the split; admission A6 holds their projections to their caps after stage 1.
// Items that are not launches (authoring, the audit, the judge check, hosts) and stage 2's items, which change 4 does not
// re-split, keep change 3's rule: a cap of at least 1.35 times central plus the stated allowance.
import { CAPS } from "./frozen.ts";
import { capProblem, launchRounds, LAUNCHES, type LaunchName } from "./run/manifest.ts";
import { ALLOWANCES, roundReserve } from "./run/run.ts";
import type { BriefMeta, ManifestEntry, ModelId } from "./types.ts";

export type Line = keyof typeof CAPS;

export interface LedgerPart {
  item: string;
  line: Line;
  what: string;
  /** cost.py's central dollars for this part; null for a repair item, which has none. */
  central: number | null;
  /** The allowance the part keeps on top of 1.35 times central, in dollars; null where the schedule check sets the cap. */
  allowance: number | null;
  cap: number;
}

export const SPLIT: readonly LedgerPart[] = [
  { item: "ohr-author", line: "authoring", what: "the pilot and every draw after it, one run", central: 183.24, allowance: 3.5, cap: 251 },
  { item: "ohr-audit", line: "simulator_audit", what: "the fixed script's simulator calls and both auditors, one run", central: 29.34, allowance: 1, cap: 41 },
  { item: "ohr-s1-arms", line: "stage1", what: "stage 1's arm sessions, all three models", central: 99.6, allowance: null, cap: 151 },
  { item: "ohr-s1-sim", line: "stage1", what: "stage 1's simulator", central: 5.76, allowance: null, cap: 14 },
  { item: "ohr-s1-labels", line: "stage1", what: "stage 1's production labels", central: 4.32, allowance: null, cap: 7 },
  { item: "ohr-s1-repair-arms", line: "stage1", what: "the one admission repair's arm sessions", central: null, allowance: null, cap: 38 },
  { item: "ohr-s1-repair-sim", line: "stage1", what: "the one admission repair's simulator", central: null, allowance: null, cap: 7 },
  { item: "ohr-s1-repair-labels", line: "stage1", what: "the one admission repair's labels", central: null, allowance: null, cap: 3 },
  { item: "ohr-judge-check", line: "judge_check", what: "the live judge probes, the gold pass and the check labels, one run", central: 89.8, allowance: 1, cap: 123 },
  { item: "ohr-s2-arms", line: "stage2", what: "stage 2's Opus and Sol arm sessions", central: 1109.2, allowance: 13.58, cap: 1511 },
  { item: "ohr-s2-sim", line: "stage2", what: "stage 2's Opus and Sol simulator", central: 45.12, allowance: 1, cap: 62 },
  { item: "ohr-s2-labels", line: "stage2", what: "stage 2's Opus and Sol production labels", central: 33.84, allowance: 1, cap: 47 },
  { item: "ohr-s2p-arms", line: "stage2_particle", what: "stage 2's particle-1 arm sessions", central: 61.1, allowance: null, cap: 83 },
  { item: "ohr-s2p-sim", line: "stage2_particle", what: "stage 2's particle-1 simulator", central: 22.56, allowance: null, cap: 34 },
  { item: "ohr-s2p-labels", line: "stage2_particle", what: "stage 2's particle-1 production labels", central: 16.92, allowance: null, cap: 22 },
  { item: "ohr-hosts", line: "hosts", what: "the runner VMs", central: 15.28, allowance: 1, cap: 22 },
];

/** Each paid launch's two items: arms through the rig's lease and the simulator through the meter. */
export const LAUNCH_ITEMS: Readonly<Record<LaunchName, { arms: string; sim: string }>> = {
  stage1: { arms: "ohr-s1-arms", sim: "ohr-s1-sim" },
  stage2: { arms: "ohr-s2-arms", sim: "ohr-s2-sim" },
  "stage2-particle": { arms: "ohr-s2p-arms", sim: "ohr-s2p-sim" },
};

/** cost.py's planning figures, in dollars a session: each model's skill and none sessions, the simulator and a label. */
export const CENTRAL: { session: Readonly<Record<ModelId, { skill: number; none: number }>>; sim: number; label: number } = {
  session: { opus: { skill: 3.5, none: 0.5 }, sol: { skill: 2.0, none: 0.3 }, particle: { skill: 0.3, none: 0.05 } },
  sim: 0.08,
  label: 0.06,
};

/** What a labels item keeps on top of its labels for the judge call in flight: cost.py's $1 allowance for "the rest". */
export const LABEL_RESERVE = 1;

/** One launch the schedule check walks: its rounds, its three items and what it must reach. */
export interface Schedule {
  name: string;
  launch: LaunchName;
  items: { arms: string; sim: string; labels: string };
  /** The multiple of central the whole schedule must finish at, or null for the repair, which must start its first round at 1.35. */
  finish: number | null;
}

export const SCHEDULES: readonly Schedule[] = [
  { name: "stage1", launch: "stage1", items: { ...LAUNCH_ITEMS.stage1, labels: "ohr-s1-labels" }, finish: 1.35 },
  { name: "stage1-repair", launch: "stage1", items: { arms: "ohr-s1-repair-arms", sim: "ohr-s1-repair-sim", labels: "ohr-s1-repair-labels" }, finish: null },
  { name: "stage2", launch: "stage2", items: { ...LAUNCH_ITEMS.stage2, labels: "ohr-s2-labels" }, finish: 1 },
  { name: "stage2-particle", launch: "stage2-particle", items: { ...LAUNCH_ITEMS["stage2-particle"], labels: "ohr-s2p-labels" }, finish: 1 },
];

const D = 1_000_000;
const cents = (x: number) => Math.round(x * 100);
const dollars = (micros: number) => Math.round(micros / 10_000) / 100;

/** Stand-in briefs with the frozen set sizes: launchRounds reads only their ids and draws, and every brief costs the same. */
function scheduleBriefs(launch: LaunchName): { briefs: BriefMeta[]; ids: string[] } {
  const n = LAUNCHES[launch].set === "calibration" ? 8 : 94;
  const briefs = Array.from({ length: n }, (_, i) => ({ id: "s-" + String(i).padStart(3, "0"), draw: i + 1, set: LAUNCHES[launch].set }) as BriefMeta);
  return { briefs, ids: briefs.map((b) => b.id) };
}

const sessionMicros = (e: ManifestEntry, at: number) => Math.round(at * CENTRAL.session[e.model][e.arm === "none" ? "none" : "skill"] * D);

export interface ScheduleRead {
  name: string;
  at: number;
  rounds: number;
  /** Rounds that start before the first one an item cannot hold. */
  started: number;
  sessions: number;
  /** Sessions in the rounds that start. */
  ran: number;
  /** The most each item must hold for every round to start (spend before a round plus its reservation), and the labels the sessions that ran need, in dollars. */
  need: { arms: number; sim: number; labels: number };
  caps: { arms: number; sim: number; labels: number };
  /** The first item that refuses a round, or labels when every round starts and the labels do not fit; null when it finishes. */
  stops_on: "arms" | "sim" | "labels" | null;
}

/** Walks one launch's rounds at at times central against the split's caps. attempts is how many attempts a round holds per session: 1 under change 4, 2 under the rule it replaced. */
export function walkSchedule(s: Schedule, at: number, split: readonly LedgerPart[] = SPLIT, attempts: 1 | 2 = 1): ScheduleRead {
  const capOf = (item: string) => {
    const p = split.find((x) => x.item === item);
    if (!p) throw new Error("E_INTERNAL schedule " + s.name + ": item " + item + " is not in the split");
    return p.cap * D;
  };
  const caps = { arms: capOf(s.items.arms), sim: capOf(s.items.sim), labels: capOf(s.items.labels) };
  const { briefs, ids } = scheduleBriefs(s.launch);
  const rounds = launchRounds(s.launch, briefs, ids);
  let arms = 0, sim = 0, started = 0, ran = 0;
  let stops: ScheduleRead["stops_on"] = null;
  const need = { arms: 0, sim: 0, labels: 0 };
  for (const round of rounds) {
    const one = roundReserve(ALLOWANCES, round);
    const r = { arms: attempts * one.arms, sim: attempts * one.sim };
    need.arms = Math.max(need.arms, arms + r.arms);
    need.sim = Math.max(need.sim, sim + r.sim);
    if (stops === null && arms + r.arms > caps.arms) stops = "arms";
    if (stops === null && sim + r.sim > caps.sim) stops = "sim";
    if (stops === null) {
      started++;
      ran += round.length;
    }
    for (const e of round) arms += sessionMicros(e, at);
    sim += round.length * Math.round(at * CENTRAL.sim * D);
  }
  need.labels = Math.round(at * ran * CENTRAL.label * D) + LABEL_RESERVE * D;
  if (stops === null && need.labels > caps.labels) stops = "labels";
  return { name: s.name, at, rounds: rounds.length, started, sessions: rounds.reduce((n, r) => n + r.length, 0), ran, need: { arms: dollars(need.arms), sim: dollars(need.sim), labels: dollars(need.labels) }, caps: { arms: dollars(caps.arms), sim: dollars(caps.sim), labels: dollars(caps.labels) }, stops_on: stops };
}

/** The largest multiple of central, to a thousandth, at which the whole schedule finishes; 0 when it does not finish at all. */
export function finishesUpTo(s: Schedule, split: readonly LedgerPart[] = SPLIT): number {
  if (walkSchedule(s, 0, split).stops_on !== null) return 0;
  let lo = 0, hi = 3000;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (walkSchedule(s, mid / 1000, split).stops_on === null) lo = mid;
    else hi = mid;
  }
  return lo / 1000;
}

/** Every schedule the split cannot hold at its required multiple, or an empty list. */
export function scheduleProblems(split: readonly LedgerPart[] = SPLIT): string[] {
  const out: string[] = [];
  for (const s of SCHEDULES) {
    const r = walkSchedule(s, s.finish ?? 1.35, split);
    if (s.finish === null) {
      const first = Math.round(1.35 * Math.min(r.ran, 3) * CENTRAL.label * D) + LABEL_RESERVE * D;
      if (r.started < 1) out.push(s.name + ": its first round (one brief on Opus) does not start at 1.35 times central; " + (r.stops_on === "arms" ? s.items.arms + " holds $" + r.caps.arms : s.items.sim + " holds $" + r.caps.sim));
      else if (first > r.caps.labels * D) out.push(s.name + ": " + s.items.labels + " cannot hold its first round's labels at 1.35 times central ($" + dollars(first) + ")");
      continue;
    }
    if (r.stops_on === null) continue;
    out.push(s.name + ": does not finish at " + s.finish + " times central; " + s.items[r.stops_on] + " holds $" + r.caps[r.stops_on] + " and needs $" + r.need[r.stops_on] + (r.stops_on === "labels" ? "" : ", so the launch stops after " + r.started + " of " + r.rounds + " rounds"));
  }
  return out;
}

/** Every way the split breaks its rules, or an empty list. */
export function splitProblems(split: readonly LedgerPart[] = SPLIT, caps: Readonly<Record<Line, number>> = CAPS): string[] {
  const out: string[] = [];
  const capOf = (item: string) => split.find((p) => p.item === item)?.cap;
  const items = split.map((p) => p.item);
  for (const dup of new Set(items.filter((x, i) => items.indexOf(x) !== i))) out.push("item " + dup + " appears twice");
  for (const line of Object.keys(caps) as Line[]) {
    const parts = split.filter((p) => p.line === line);
    if (!parts.length) out.push("approved item " + line + " has no ledger item");
    const sum = parts.reduce((t, p) => t + p.cap, 0);
    if (sum > caps[line]) out.push(line + "'s ledger items sum to $" + sum + ", past its approved cap of $" + caps[line]);
  }
  const scheduled = new Set(SCHEDULES.flatMap((s) => Object.values(s.items)));
  for (const p of split) {
    if (!(p.line in caps)) out.push(p.item + " names no approved item (" + p.line + ")");
    if (!(Number.isInteger(p.cap) && p.cap > 0)) out.push(p.item + "'s cap $" + p.cap + " is not a positive whole number of dollars");
    if (p.allowance === null && !scheduled.has(p.item)) out.push(p.item + " has no allowance and no schedule sets its cap");
    if (p.central === null || p.allowance === null) continue;
    if (cents(p.cap) < Math.ceil(135 * p.central)) out.push(p.item + "'s cap $" + p.cap + " is under 1.35 times its central $" + p.central);
    if (cents(p.cap) < cents(1.35 * p.central + p.allowance) - 1) out.push(p.item + "'s cap $" + p.cap + " does not hold 1.35 times central plus its stated allowance");
  }
  const missing = SCHEDULES.flatMap((s) => Object.values(s.items)).filter((i) => capOf(i) === undefined);
  for (const [launch, it] of Object.entries(LAUNCH_ITEMS) as [LaunchName, { arms: string; sim: string }][]) {
    const arms = capOf(it.arms), sim = capOf(it.sim);
    if (arms === undefined || sim === undefined) continue;
    const problem = capProblem(launch, arms * 1_000_000, sim * 1_000_000);
    if (problem) out.push(launch + ": " + problem);
  }
  if (missing.length) out.push("the schedules' items " + missing.join(", ") + " are not in the split");
  else out.push(...scheduleProblems(split));
  return out;
}
