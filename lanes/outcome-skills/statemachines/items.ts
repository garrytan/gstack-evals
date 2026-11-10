// Copyright (c) 2026 Garry Tan. MIT License.
// The state machines family's ledger items and caps, fixed in code (the post's sections 16 and 17). This file records
// nothing and opens nothing: the cap is recorded on the ledger with gstack-evals ledger init, and the driver's stage
// (lanes/outcome-skills/driver/stage.ts) reads the cap from that record, refuses an item in no program, and needs the
// item's skills to be the skill its arm spends for ("sm" for every SM arm, "qa" for qa:told). Each item names its line as
// its program for that reason. Two /qa caps sit above section 17's $50, a deviation recorded before any outcome data: an
// item opens a session only while its remaining cap covers the allowance, so n sessions at mean m with k concurrent need
// (n - k) * m + k * allowance. At twice section 16's first-stage price (VMs included) with k = 1 and E1's doubled
// allowance, sm-qa-admit needs 4 * 6.16 + 30 = $54.64 and sm-qa-particle 59 * 0.76 + 6 = $50.84. The $6 comes from the
// line's reserve, so the line stays $1,100.

const M = 1_000_000;

export const LINES = {
  "state-machines": { cap_micros: 4000 * M, crew_counted_micros: 250 * M },
  "state-machines-qa": { cap_micros: 1100 * M, crew_counted_micros: 60 * M },
} as const;
export type Line = keyof typeof LINES;

export interface ItemDef { item: string; program: Line; skills: string[]; cap_micros: number; model: string | null; what: string }

const OPUS = "claude-opus-5-5", SOL = "openai/gpt-6.1-sol", P1 = "particle-ai/particle-1";
const sm = (item: string, usd: number, model: string | null, what: string): ItemDef => ({ item, program: "state-machines", skills: ["sm"], cap_micros: usd * M, model, what });
const qa = (item: string, usd: number, model: string, what: string): ItemDef => ({ item, program: "state-machines-qa", skills: ["qa"], cap_micros: usd * M, model, what });

export const ITEMS: Record<string, ItemDef> = Object.fromEntries([
  sm("sm-labels", 150, null, "GPT-6 Astra and Opus 5.5 eligibility labels, about 450 candidates"),
  sm("sm-oracle", 60, null, "VMs only: three base and three fixed runs per candidate"),
  sm("sm-admit", 270, OPUS, "15 admission units on Opus: A0 and A1, 3 untouched-tree follow-ons; covers the file-scope retry and the ceiling-raise attempt"),
  sm("sm-opus", 1400, OPUS, "60 units on Opus: A0, A1, A2, S2; 3 follow-ons on S0, A1 and S2"),
  sm("sm-sol", 1460, SOL, "the same on GPT-6.1 Sol"),
  sm("sm-particle", 230, P1, "the same on particle-1"),
  sm("sm-judges", 180, null, "R78 check, UX/DX/AX on 720 first-stage diffs, stock diffs"),
  qa("sm-qa-admit", 55, OPUS, "5 Opus /qa admission sessions that check exposure"),
  qa("sm-qa-opus", 440, OPUS, "A3 (gstack /qa told) on the 60 test units, Opus"),
  qa("sm-qa-sol", 440, SOL, "A3 on the 60 test units, GPT-6.1 Sol"),
  qa("sm-qa-particle", 51, P1, "A3 on the 60 test units, particle-1"),
].map((d) => [d.item, d]));

export const itemsOf = (line: Line): ItemDef[] => Object.values(ITEMS).filter((d) => d.program === line);
export const lineSum = (line: Line): number => itemsOf(line).reduce((a, d) => a + d.cap_micros, 0);

/** One line per item for the CLI: name, program, skills, cap in micros. */
export function itemsTable(): string[] {
  const out: string[] = [];
  for (const line of Object.keys(LINES) as Line[]) {
    out.push("line " + line + " cap_micros=" + LINES[line].cap_micros + " items_micros=" + lineSum(line) + " crew_counted_micros=" + LINES[line].crew_counted_micros);
    for (const d of itemsOf(line)) out.push("  " + d.item + " program=" + d.program + " skills=" + d.skills.join(",") + " cap_micros=" + d.cap_micros + " model=" + (d.model ?? "-") + "  " + d.what);
  }
  return out;
}
