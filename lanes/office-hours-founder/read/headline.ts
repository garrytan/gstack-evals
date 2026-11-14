// Copyright (c) 2026 Garry Tan. MIT License.
// Section 16's opening bullets for the office-hours founder eval (prereg
// wiki/plans/2026-11-09-geva-418-office-hours-founder-evidence-prereg). Each bullet's shape is fixed by its model's
// verdict, so the reading can't pick its story: helps (with the Captain's AN-1 condition, when the gain also appears
// in the pitch-only cell, and the Captain's pre-data completion rule: when the model's pitch-only cell ended incomplete,
// the bullet says the check didn't complete and credits neither reading), no measurable difference, hurts, and untested
// or not shown. Every bullet names its
// population and the repairs that ran; helps prints the specificity interval and says the guard is the weaker rule;
// Opus's bullet says so when the real stratum's sign is opposite the primary's.
import { MODELS } from "../frozen.ts";
import type { ModelId } from "../types.ts";
import { MODEL_NAME } from "./stage1.ts";
import { LIMIT, type Stage2Reading } from "./stage2.ts";
import { r4, type Comparison } from "./stats.ts";

export const POPULATION = "The population is invented founders whose hidden evidence points to one answer that three models agree on and that the pitch doesn't give away.";
const ORDER = ["helps", "no measurable difference", "hurts", "not shown", "untested"] as const;

const points = (d: number) => String(r4(d * 100));
const ci = (c: Comparison | null) => (c?.ci95 ? "95% interval " + c.ci95[0] + " to " + c.ci95[1] : "no interval");
const said = (c: Comparison | null) => (c ? c.delta + " (" + ci(c) + ")" : "n/a");

/** One bullet per model in section 16's order (what works first, then any null); next says what the next attempt changes for an untested or not-shown model. */
export function headlines(r: Stage2Reading, next: Readonly<Partial<Record<ModelId, string>>>): string[] {
  const out = MODELS.map((m) => {
    const read = r.models[m];
    const p = read.contrasts["office-hours-none"];
    const w = p.w;
    const name = MODEL_NAME[m];
    let text: string;
    if (p.verdict === "helps") {
      const tail = " by " + points(w!.delta) + " points (" + ci(w) + ", p " + w!.p + "); the real stratum then says whether the same held where the outcome is known (office-hours minus none there " + said(read.real.W) + "). The specificity interval is " + (p.specificity?.ci95 ? p.specificity.ci95.join(" to ") : "n/a") + "; the helps rule's specificity part is a guard, weaker than requiring that interval to exclude zero.";
      text = !read.pitch.complete
        ? "helps on " + name + ": office-hours moved " + name + "'s first-move advice toward the customer or offering the founder's own evidence supported, but the pitch-only check didn't complete (" + read.pitch.scored + " of " + read.pitch.scheduled + " sessions scored), so this eval does not credit the gain to drawing out evidence;" + tail
        : read.pitch.condition
        ? "helps on " + name + ": office-hours moved " + name + "'s first-move advice toward the customer or offering the founder's own evidence supported, and the gain also appears when the founder reveals nothing (pitch-only office-hours minus none " + said(read.pitch.diff) + "), so this eval does not credit it to drawing out evidence;" + tail
        : "helps on " + name + ": asking a founder for the evidence before advising (who uses it, who paid, what they did before) moved " + name + "'s first-move advice toward the customer or offering the founder's own evidence supported, so an advisor agent should draw that evidence out before it recommends;" + tail;
    } else if (p.verdict === "no measurable difference") {
      const hi = w!.ci95![1];
      const e = read.secondaries.find((s) => s.name === "E" && s.contrast === "office-hours-none")!.cmp;
      text = "no measurable difference on " + name + ": we did not find a difference: office-hours minus none was " + w!.delta + " (" + ci(w) + "), with a control rate of " + w!.mean_a + ", an MDD of " + (read.mdd ?? "over 0.50") + " and a largest gain the interval leaves open of " + hi + ". " + (r4(hi) < LIMIT.margin ? "A builder doesn't need the procedure for this part." : "The test couldn't tell.") + " E then says whether the skill still drew out more of the evidence: office-hours minus none on E was " + said(e) + ".";
    } else if (p.verdict === "hurts") {
      text = "hurts on " + name + ": the skill moved the first move away from what the evidence supported, by " + points(-w!.delta) + " points (" + ci(w) + ", p " + w!.p + ").";
    } else {
      if (!next[m]) throw new Error("the " + name + " headline needs what the next attempt changes");
      text = p.verdict + " on " + name + ": " + p.why + ". The next attempt changes: " + next[m] + ".";
    }
    if (m === "opus" && r.real_opposite) text += " On the real-history units, office-hours minus none on Opus had the opposite sign: " + said(read.real.W) + ".";
    if (r.repairs.length) text += " Repairs that ran: " + r.repairs.join(", ") + ".";
    return { verdict: p.verdict, text: text + " " + POPULATION };
  });
  return out.sort((a, b) => ORDER.indexOf(a.verdict) - ORDER.indexOf(b.verdict)).map((x) => x.text);
}
