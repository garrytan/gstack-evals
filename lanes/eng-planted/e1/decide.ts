// Copyright (c) 2026 Garry Tan. MIT License.
// Eval 1's Decision rows in their order (prereg 2026-11-24-geva-587-design-time-state-modeling, the Decision section),
// with pre-run change 2's corrections: "read" is the complement of untested; a C reading whose interval holds both 0 and
// +10 is not distinguished; a missing Opus or Sol estimate holds C's draft; and D's cut row needs exposure only on the
// models left in its pool. A stopped arm (the futility look) takes only rows that act on nothing.
import { E1, type E1Arm, type E1Model } from "./frozen.ts";
import { contrast, gains, isRead, readOnAny, type Cell, type Reading } from "./readings.ts";

export interface Readings {
  DN: Reading | null;
  CN: Reading | null;
  GN: Reading | null;
  PN: Reading | null;
  PC: Reading | null;
  CG: Reading | null;
  CNopus: Reading | null;
  CNsol: Reading | null;
}

export function readAll(cells: Cell[], seed: number, draws?: number): Readings {
  const three: E1Model[] = ["opus", "sol", "particle"];
  const two: E1Model[] = ["opus", "particle"];
  const o = { draws };
  return {
    DN: contrast(cells, "D", "N", three, seed, o),
    CN: contrast(cells, "C", "N", three, seed, o),
    GN: contrast(cells, "G", "N", three, seed, o),
    PN: contrast(cells, "P", "N", two, seed, o),
    PC: contrast(cells, "P", "C", two, seed, o),
    CG: contrast(cells, "C", "G", three, seed, o),
    CNopus: contrast(cells, "C", "N", ["opus"], seed, o),
    CNsol: contrast(cells, "C", "N", ["sol"], seed, o),
  };
}

export type Eval4 = "to Garry" | "dropped" | "waits for a repaired run" | "neither started nor dropped" | "not decided by these rows";

export interface Decision {
  rows: string[];
  eval4: Eval4;
  words: Partial<Record<E1Arm, string>>;
}

export interface DecideInput {
  cells: Cell[];
  r: Readings;
  stopped: ReadonlySet<E1Arm>;
  /** Comparison units drawn (64 at target). */
  units: number;
}

const ALL: E1Model[] = ["opus", "sol", "particle"];
const RAN_ON: Record<"C" | "P", E1Model[]> = { C: ALL, P: ["opus", "particle"] };

export function decide(i: DecideInput): Decision {
  const { r, stopped, cells } = i;
  const rows: string[] = [];
  const words: Partial<Record<E1Arm, string>> = {};
  const live = (a: E1Arm) => !stopped.has(a);
  const g = (x: Reading | null, a: E1Arm) => live(a) && gains(x);

  for (const m of ALL) for (const a of ["D", "C", "P", "G", "N"] as E1Arm[]) if (!isRead(cells, a, m) && cells.some((c) => c.arm === a && c.model === m)) rows.push("untested: " + a + " on " + m + " leaves every pooled contrast there; the cause goes to the Captain" + (a === "G" ? " and GStack Minder" : ""));

  const pGainsN = g(r.PN, "P");
  const pGainsC = g(r.PC, "P");
  if (pGainsN && pGainsC) rows.push("P gains over N and over C: GStack Minder gets a brief to port /statechart's idea into plan-eng-review, crediting Lauren Tan; the C rows are not read for that fold-in");
  else if (pGainsN) rows.push("P gains over N but not over C: no fold-in from pstack's text; the C rows decide; P is replicated against C on held-out units before any later P claim");
  else rows.push("P does not gain over N: nothing comes from pstack");

  const cGains = g(r.CN, "C");
  const beatsG = live("C") && r.CG !== null && r.CG.lo > 0;
  if (!(pGainsN && pGainsC) && r.CN && live("C")) {
    const opus = r.CNopus?.estimate ?? null;
    const sol = r.CNsol?.estimate ?? null;
    if (cGains && beatsG && opus !== null && sol !== null && opus >= 0 && sol >= 0) rows.push("C gains over N, beats G and holds on Opus and Sol: GStack Minder drafts C's step for plan-eng-review, shipped only after a before/after skill eval reads it no worse");
    else if (cGains && beatsG && (opus === null || sol === null)) rows.push("C gains over N and beats G, but " + (opus === null ? "Opus" : "Sol") + " has no C minus N estimate: no step yet; the draft waits for a valid reading on that host");
    else if (cGains && beatsG) rows.push("C gains over N and beats G, but C minus N is below 0 on " + (opus! < 0 ? "Opus" : "Sol") + ": no step yet; C is replicated against N on that model on fresh state units first");
    else if (cGains && g(r.GN, "G")) rows.push("C gains over N but does not beat G, and G gains over N: no new step; a KEEP lead for plan-eng-review's diagram and failure-mode sections on state bugs");
    else if (cGains) rows.push("C gains over N but does not beat G, and G does not gain over N: no step yet; next is a before/after skill eval of plan-eng-review with C's step");
    else if (r.CN.lo > 0) rows.push("C minus N's lower bound is above 0 but under +10: no step; reported as a small gain and kept as a lead");
    else if (r.CN.estimate >= E1.gain) rows.push("C minus N is +10 or more with a lower bound at 0 or below: not shown; no step, FIX-METHOD, MDD printed");
    else if (r.CN.hi >= E1.gain) rows.push("C minus N's interval holds both 0 and +10: not distinguished; no step, FIX-METHOD, MDD printed");
    else rows.push("C minus N's upper bound is under +10: no modeling step from C" + (r.CN.hi < 0 && i.units >= E1.units.target ? "; reported as a loss" : ""));
  } else if (stopped.has("C")) rows.push("C stopped for futility: no modeling step from C, and no loss is reported");

  if (r.DN) {
    if (r.DN.lo > 0) {
      rows.push("D minus N's lower bound is above 0: KEEP for the diagram lines" + (r.DN.estimate >= E1.gain ? "; users are told it helps, with the interval" : ""));
      words.D = "KEEP";
    } else if (r.DN.estimate >= E1.gain || r.DN.hi >= E1.gain) {
      rows.push("D minus N is not distinguished: the lines stay with no claim, FIX-METHOD, MDD printed");
      words.D = "FIX-METHOD";
    } else {
      rows.push("D minus N's upper bound is under +10, with D exposed on every model in its pool: after one Why-null cycle the lines become CUT-CANDIDATES for the before/after skill eval" + (r.DN.hi < 0 ? "; the diagram request measurably cost points" : ""));
      words.D = "CUT-CANDIDATE";
    }
  } else rows.push("D is untested on every model: FIX-METHOD on D");

  if (g(r.GN, "G")) rows.push("G gains over N: the report says plan-eng-review helps on state bugs; nothing in gstack changes");
  if (r.GN && r.GN.hi < 0) rows.push("G minus N's upper bound is under 0: GStack Minder gets a brief to find out why before the next stable cut");

  const cRead = readOnAny(cells, "C", RAN_ON.C);
  const pRead = readOnAny(cells, "P", RAN_ON.P);
  let eval4: Eval4 = "not decided by these rows";
  if ((live("C") && gains(r.CN)) || (live("P") && gains(r.PN))) {
    rows.push("C or P gains over N: eval 4 goes back to Garry for a go");
    eval4 = "to Garry";
  } else if (cRead && pRead) {
    rows.push("C and P were both read and neither gains over N: no modeling step; the design-time modeling question closes with a registry row; eval 4 is dropped");
    eval4 = "dropped";
  } else if (cRead && !pRead) {
    rows.push("C is read without a gain and P is untested on every model: no modeling step; eval 4 is dropped, because C carries the model check on all three models; P is reported as untested, FIX-METHOD on the instrument");
    eval4 = "dropped";
  } else if (pRead && !cRead) {
    rows.push("P is read without a gain and C is untested on every model: no modeling step; the question stays open as FIX-METHOD on C; eval 4 waits for a repaired C run, which the Captain decides");
    eval4 = "waits for a repaired run";
  } else {
    rows.push("C and P both read untested on every model: the question stays open as FIX-METHOD on the instrument; eval 4 is neither started nor dropped; the Captain decides");
    eval4 = "neither started nor dropped";
  }
  return { rows, eval4, words };
}
