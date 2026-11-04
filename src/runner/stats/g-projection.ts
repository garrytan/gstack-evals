// The projection check between stages for the G family (outcome-per-skill plan v3 section 6, build step O4). Between
// admission, screening and the confirmatory run, it re-sizes each live skill from its settled spend and the metered
// means so far, the way R3 amendment 4's between-part check (F1) projects a run from cost data only. A stage starts
// only if the re-sized MDD stays at or under the 20-point bound, the projection stays inside the skill's cap, and the
// program envelope can hold it; otherwise the skill stops as FIX-METHOD (price) before the stage spends.
//
// Spend comes only from O6's envelope, which counts each skill's settled U4 leases, its open leases at their whole
// reservation, admitted leases not yet written, and crew use. A skill's projection is that committed spend, plus the
// crew use its thread still expects, plus every priced part of plan v3's cost model still to run at the metered means:
// before screening, the candidates' authoring (the slice's is spent), the screen and the confirmatory sessions; before
// the confirmatory run, the confirmatory sessions alone, on at most the screened panel's tasks. Designs fit the $1,700
// plan line, as cost.py sizes them, and keep the rest of the $2,000 cap as reserve.
//
// With both skills alive, the both-alive search (cost.py's best(), on projected prices) sizes both. One skill past the
// bound stops and the other re-sizes alone; with both past it, or no both-alive design inside the line, the Captain's
// pick C applies: plan-eng-review re-sizes alone first, then autoplan. A lone survivor re-sizes on M1's fixed ladder
// (prereg section 7); before the confirmatory run, rungs above the screened panel's task count can't run and are passed
// over, unless the confirmatory prereg says otherwise for a panel already built.
import type { EnvelopeStatus } from "../ledger/envelope.ts";
import { aloneParts, BOUND, bestPair, costs, G_SKILLS, ladder, meteredPricer, NS, PLANNED, pySum, type GMetered, type GSkill, type Parts, type PriceModel } from "./g-resize.ts";

export type Stage = "screening" | "confirmatory";

export interface ProjectionInput {
  /** The stage about to start. */
  stage: Stage;
  /** The G skills still alive; the others stopped at an earlier stage. */
  alive: readonly GSkill[];
  /** O6's envelope status for the program that holds the G skills (envelopeStatus). */
  envelope: EnvelopeStatus;
  /** Admission's metered inputs (prereg section 6, item 5), updated with later stages' metered means. */
  metered: GMetered;
  /** Crew model use each live skill's threads still expect, in dollars, on top of what the envelope has counted. */
  crew_open_usd: Partial<Record<GSkill, number>>;
  /** The screened panel's task count; required before the confirmatory run. */
  panel_tasks?: number;
}

export interface SkillProjection {
  skill: GSkill;
  alive: boolean;
  committed_usd: number;
  crew_open_usd: number;
  /** Priced parts still to run at the design, or at the cheapest one tried when nothing fits. */
  remaining_usd: number | null;
  projection_usd: number | null;
  cap_usd: number;
  design: { n: number; k: number; mdd: number } | null;
  passes: boolean;
  route: "go" | "FIX-METHOD (price)" | "stopped before this stage";
  reason: string;
}

export interface Projection {
  stage: Stage;
  skills: Record<GSkill, SkillProjection>;
  program: { cap_usd: number; committed_usd: number; projected_usd: number; fits: boolean };
}

const usd = (micros: number) => micros / 1_000_000;
const dollars = (x: number) => "$" + x.toFixed(2);

/** Both alive: each skill's parts still to run at n tasks and k trials, from cost.py's costs(). */
function pairRemaining(M: PriceModel, stage: Stage, n: [number, number], k: number): [number, number] {
  const cs = costs(M, "G", n, k);
  const cand = Math.max(...n) / M.YIELD.G;
  const rest = (c: Parts) => (stage === "screening" ? pySum([(cand * M.AUTH.G) / 2, c.screen!, c.conf_none!, c.conf_told!]) : pySum([c.conf_none!, c.conf_told!]));
  return [rest(cs[0]), rest(cs[1])];
}

/** A lone survivor: every shared part still to run is its own, from survivor.py's alone() terms. */
function aloneRemaining(M: PriceModel, stage: Stage, s: GSkill, n: number, k: number): number {
  const c = aloneParts(M, "G", s, n, k);
  return stage === "screening" ? pySum([c.author!, c.screen!, c.conf_none!, c.conf_told!]) : pySum([c.conf_none!, c.conf_told!]);
}

export function projectionCheck(input: ProjectionInput): Projection {
  const { stage, envelope } = input;
  if (stage !== "screening" && stage !== "confirmatory") throw new Error("the projection check runs before screening or before the confirmatory run, not " + JSON.stringify(stage));
  const alive = [...new Set(input.alive)];
  if (alive.length !== input.alive.length) throw new Error("a skill is listed alive twice");
  for (const s of alive) if (!(G_SKILLS as readonly string[]).includes(s)) throw new Error(s + " is not a G skill");
  let maxN = Infinity;
  if (stage === "confirmatory") {
    if (input.panel_tasks === undefined) throw new Error("the check before the confirmatory run needs panel_tasks, the screened panel's task count");
    if (!Number.isSafeInteger(input.panel_tasks) || input.panel_tasks < 1) throw new Error("panel_tasks must be a whole number of tasks, not " + input.panel_tasks);
    maxN = input.panel_tasks;
  }
  const M = meteredPricer(input.metered);
  const line = (s: GSkill) => {
    const l = envelope.skills[s];
    if (!l) throw new Error("program " + envelope.program.program + " has no line for " + s + ", so its spend can't be read");
    return l;
  };
  const crew = (s: GSkill) => {
    const c = input.crew_open_usd[s];
    if (c === undefined || !Number.isFinite(c) || c < 0) throw new Error("crew_open_usd needs the crew use still expected for " + s + ", in dollars, 0 or more");
    return c;
  };
  const base = (s: GSkill) => usd(line(s).committed_micros) + (alive.includes(s) ? crew(s) : 0);
  const out = {} as Record<GSkill, SkillProjection>;
  for (const s of G_SKILLS) {
    const committed = usd(line(s).committed_micros);
    out[s] = { skill: s, alive: alive.includes(s), committed_usd: committed, crew_open_usd: alive.includes(s) ? crew(s) : 0, remaining_usd: null, projection_usd: null, cap_usd: usd(line(s).cap_micros), design: null, passes: false, route: alive.includes(s) ? "FIX-METHOD (price)" : "stopped before this stage", reason: alive.includes(s) ? "" : "stopped before this stage; not read" };
  }
  const go = (s: GSkill, n: number, k: number, mdd: number, remaining: number, why: string) => {
    Object.assign(out[s], { remaining_usd: remaining, projection_usd: base(s) + remaining, design: { n, k, mdd }, passes: true, route: "go", reason: why });
  };
  const stop = (s: GSkill, why: string, size?: { n: number; k: number; mdd: number | null; remaining: number }) => {
    Object.assign(out[s], { passes: false, route: "FIX-METHOD (price)", design: null, reason: why, remaining_usd: size ? size.remaining : null, projection_usd: size ? base(s) + size.remaining : null });
  };
  const alone = (s: GSkill, why: string) => {
    const l = ladder((n, k) => base(s) + aloneRemaining(M, stage, s, n, k), ...PLANNED[s], maxN);
    const tried = l.tried.map((t) => t.n + "x" + t.k + " $" + t.price + " MDD " + (t.mdd ?? "none")).join(", ");
    if (l.stops) {
      const last = l.tried.at(-1);
      stop(s, why + "; alone on M1's ladder [" + tried + "] no rung fits the $1,700 plan line at MDD 20 or under", last ? { n: last.n, k: last.k, mdd: last.mdd, remaining: aloneRemaining(M, stage, s, last.n, last.k) } : undefined);
      return false;
    }
    go(s, l.n!, l.k!, l.mdd!, aloneRemaining(M, stage, s, l.n!, l.k!), why + "; alone on M1's ladder [" + tried + "]");
    return true;
  };
  if (alive.length === 1) {
    alone(alive[0]!, "lone survivor before " + stage);
  } else if (alive.length === 2) {
    const ns = NS.filter((n) => n <= maxN);
    const pair = bestPair((n, k) => {
      const r = pairRemaining(M, stage, n, k);
      return [{ committed: base("plan-eng-review"), remaining: r[0] }, { committed: base("autoplan"), remaining: r[1] }];
    }, [0, 0], [0, 0], ns);
    const over = pair ? G_SKILLS.filter((_, i) => pair.mdd[i]! > BOUND) : [];
    if (pair && over.length === 0) {
      G_SKILLS.forEach((s, i) => go(s, pair.n[i]!, pair.k, pair.mdd[i]!, pair.parts[i]!.remaining!, "both alive before " + stage + " at " + pair.n[0] + "x" + pair.k + " and " + pair.n[1] + "x" + pair.k));
    } else if (pair && over.length === 1) {
      const s = over[0]!, keep: GSkill = s === "plan-eng-review" ? "autoplan" : "plan-eng-review";
      const i = G_SKILLS.indexOf(s);
      stop(s, "both alive the best design leaves " + s + " past the 20-point bound at " + pair.n[i] + "x" + pair.k + ", MDD " + pair.mdd[i], { n: pair.n[i]!, k: pair.k, mdd: pair.mdd[i]!, remaining: pair.parts[i]!.remaining! });
      alone(keep, s + " stops past the bound with both alive");
    } else {
      const why = pair ? "both alive the best design leaves both skills past the 20-point bound" : "no both-alive design fits the $1,700 plan line";
      if (!alone("plan-eng-review", why + " (pick C: plan-eng-review first)")) alone("autoplan", why + "; plan-eng-review finds no rung, so autoplan re-sizes alone");
      else stop("autoplan", why + "; plan-eng-review re-sizes alone first (pick C), so autoplan stops");
    }
  }
  for (const s of alive) {
    const x = out[s];
    if (x.passes && x.projection_usd! > x.cap_usd) stop(s, "the projection " + dollars(x.projection_usd!) + " passes the skill's " + dollars(x.cap_usd) + " cap", { n: x.design!.n, k: x.design!.k, mdd: x.design!.mdd, remaining: x.remaining_usd! });
  }
  const committed = usd(envelope.total.committed_micros), cap = usd(envelope.total.cap_micros);
  const projected = committed + alive.filter((s) => out[s].passes).reduce((a, s) => a + out[s].crew_open_usd + out[s].remaining_usd!, 0);
  const fits = projected <= cap;
  if (!fits) {
    for (const s of alive) {
      const x = out[s];
      if (x.passes) stop(s, "the program envelope holds " + dollars(committed) + " of its " + dollars(cap) + " and this stage's projection takes it to " + dollars(projected), { n: x.design!.n, k: x.design!.k, mdd: x.design!.mdd, remaining: x.remaining_usd! });
    }
  }
  return { stage, skills: out, program: { cap_usd: cap, committed_usd: committed, projected_usd: projected, fits } };
}
