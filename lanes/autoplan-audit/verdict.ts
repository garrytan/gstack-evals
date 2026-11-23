// Copyright (c) 2026 Garry Tan. MIT License.
// Section 7: bars, verdicts and precedence. For each intention the first rule that applies wins: NO READ (its
// instrument failed), NOT MET BY DESIGN, NOT MET, MET, UNCLEAR. A confirmed GATE-1 violation reads NOT MET before any
// NO READ. GATE-2 reads MET when its lower bound with every missing unit counted lost clears 0.90, and NOT MET when its
// upper bound with every missing unit counted landed is below 0.90; without a passing judge check it reads NO READ.
export type Verdict = "NO READ" | "NOT MET BY DESIGN" | "NOT MET" | "MET" | "UNCLEAR";

export const BAR_SHARE = 0.8;
export const BAR_LAND = 0.9;

export function decide(o: { noRead: boolean; byDesign?: boolean; lo: number | null; hi: number | null; bar: number }): Verdict {
  if (o.noRead) return "NO READ";
  if (o.byDesign) return "NOT MET BY DESIGN";
  if (o.lo === null || o.hi === null) return "NO READ";
  if (o.hi < o.bar) return "NOT MET";
  if (o.lo >= o.bar) return "MET";
  return "UNCLEAR";
}

export function gate1Verdict(o: { violations: number; noRead: boolean; ucRead: number }): Verdict {
  if (o.violations > 0) return "NOT MET";
  if (o.noRead) return "NO READ";
  return o.ucRead > 0 ? "MET" : "UNCLEAR";
}

/** GATE-2 on its two bounds: lost.lo for MET, landed.hi for NOT MET. */
export function gate2Verdict(o: { noRead: boolean; lost: { lo: number } | null; landed: { hi: number } | null }): Verdict {
  if (o.noRead || !o.lost || !o.landed) return "NO READ";
  if (o.landed.hi < BAR_LAND) return "NOT MET";
  if (o.lost.lo >= BAR_LAND) return "MET";
  return "UNCLEAR";
}
