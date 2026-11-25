// Copyright (c) 2026 Garry Tan. MIT License.
// The pilot readout the Captain gets before any counted unit (wiki/plans/2026-11-24-geva-590-review-models-prereg,
// Pilots and section 7, with pre-run change 1 items 2 and 3 and pre-run change 2 sections 2 and 4). From a finished pilot
// and the post dir's judge, label and contamination results it reads, keylessly:
// - per arm, against the Pilots table: part ran (a gstack cell is exposed, rm-exposure.ts, with every answering model the
//   cell's own, in at least 9 of 10 bug-unit reviews; N's read audit finds no gstack file and no drive path in any of its
//   11 sessions), the judge check (every bug-unit review the check takes has a person label, and Carbon makes at most 2
//   errors, an unresolved label counting as one; until the person labels are in, it reads as waiting and fails no arm,
//   as pre-run change 5 section 2 says), supply (10 bug units built, run and parsed), cost per review and wall time,
//   pilot spend against the arm's pilot cap, reruns and contamination;
// - the retry reserve against the rerun rate the pilot measured, projected over the counted reviews of each proceed set
//   (change 2, section 2);
// - the staged rule (score/staged.ts) on the pilot's costs and catches, the drawn counted set's P and B shares and Harness
//   Evals' per-pass stage 1 CSV, read by path and never committed;
// - the frozen proceed set the run would take (change 1 item 2), or that it stops.
// An arm passes its pilot on part ran, the judge check and supply, the plan's three columns. The Markdown names units by
// their opaque labels only, and renderReadout refuses to return text that names any unit id, cluster, fix commit, PR,
// advisory or CVE id from the key, so the file is safe for the Captain's drive.
import { unitMatcher } from "../../../src/trial/review/contamination.ts";
import { ARMS, JUDGE_CHECK, RmError, rmFail, VALUE_PER_CATCH, type Arm } from "../score/frozen.ts";
import { checkRow, kappaCheck, pilotJudgeCheck, type CheckRow, type FinalRow, type KappaCheck } from "../score/labels.ts";
import { costGap, pilotCatches, proceedSet, readHistory, SET_ARMS, stagedRule, type ProceedSet, type Staged, type Tally } from "../score/staged.ts";
import type { MeanSe } from "../score/stats.ts";
import type { Pilot, PilotReview } from "./pilot.ts";

/** Pilots table: each arm's pilot cap, a tenth of its counted budget. */
export const PILOT_CAP: Record<Arm, number> = { OS: 120, OA: 224, FS: 310, FA: 414, N: 11 };
/** Section 11's per-review central cost and cap by cell. */
export const CENTRAL: Record<Arm, number> = { OS: 6.5, OA: 11, FS: 14, FA: 18.5, N: 0.6 };
export const PER_REVIEW_CAP: Record<Arm, number> = { OS: 10.5, OA: 19.5, FS: 27, FA: 36, N: 1 };
/** Exposure in at least 9 of 10 bug-unit reviews, and 10 units built, run and parsed. */
export const PART_RAN_MIN = 9;
export const PILOT_BUG_UNITS = 10;
/** Change 2, section 2: the retry reserve after the validation batch's move, by proceed set. Change 2 states no reserve
 *  for the Sol-only set, which sits under the full path's cap, so it reads the full path's. */
export const RESERVE: Record<Exclude<ProceedSet, "stop">, { central: number; cap: number; note?: string }> = {
  all: { central: 531, cap: 987 },
  OS_OA_N: { central: 172, cap: 295 },
  OS_FS_N: { central: 531, cap: 987, note: "change 2 names no reserve for this set; the full path's is used" },
};
const VOICE_OF: Record<Arm, string | null> = { OS: "gpt-6.2-sol", OA: "gpt-6.2-astra", FS: "gpt-6.2-sol", FA: "gpt-6.2-astra", N: null };
const MODEL_OF: Record<Arm, string> = { OS: "claude-opus-5-5", OA: "claude-opus-5-5", FS: "claude-fable-5-2", FA: "claude-fable-5-2", N: "claude-opus-5-5" };

export interface Check {
  pass: boolean;
  measured: string;
  /** Opaque labels with the first reason each failed. */
  misses: string[];
}

export interface ArmReadout {
  arm: Arm;
  part_ran: Check;
  /** waiting: no person labels yet, so the column fails no arm. */
  judge: Check & { waiting: boolean; labelled: number; taken: number; errors: number; unresolved: number; left_out: string[] };
  supply: Check;
  usd_per_review: number | null;
  costed: number;
  median_wall_s: number | null;
  mean_wall_s: number | null;
  pilot_spend: number;
  unknown_cost: number;
  within_cap: boolean;
  reruns: number;
  rerun_usd: number | null;
  contaminated: number;
  pass: boolean;
}

export interface ReserveReadout {
  pilot_reviews: number;
  reruns: number;
  rate: number;
  rerun_usd: number | null;
  sets: Array<{ set: Exclude<ProceedSet, "stop">; counted_reviews: number; projected_reruns: number; mean_cap: number; projected_usd: number; reserve_cap: number; reserve_central: number; left: number | null; holds: boolean | null; note?: string }>;
}

export interface Readout {
  arms: ArmReadout[];
  reserve: ReserveReadout;
  /** gap is null when no unit holds a paired Fable and Opus cost. */
  staged: { gap: (MeanSe & { lower: number | null; pairs: number; unpaired: string[] }) | null; history: Tally & { sha256: string }; pilot_p: Tally; pilot_b: Tally; p_share: number; b_share: number; rule: Staged | null };
  proceed: { set: ProceedSet; arms: Arm[]; reason: string };
  kappa: KappaCheck;
  /** Change 6's second reading: the kappa with every person no that rests on a can't tell read as naming. */
  kappa_cant_as_yes: number | null;
  cant_tell_labels: number;
  /** No person labels yet (final.json absent). */
  labels_waiting: boolean;
  check_rows: CheckRow[];
  contamination: Pilot["contamination"];
  counted: { p: number; b: number; decoys: number };
}

const mean = (xs: readonly number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const median = (xs: readonly number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};

/** The first reason a review fails its arm's part-ran check, or null when it passes. */
export function partRanMiss(r: PilotReview): string | null {
  if (r.arm === "N") {
    if (!r.audit) return "no session record";
    if (!r.audit.readable) return "transcript unreadable or empty";
    return r.audit.hits.length ? "read audit: " + r.audit.hits.map((h) => h.where + " named " + h.pattern).join(", ") : null;
  }
  if (r.termination === "not run") return "not run";
  if (!r.exposed) return "not exposed: " + (r.exposure?.failures[0] ?? "no exposure read").replaceAll(r.host, "the session's host dir");
  if (!r.model_ok) return "answering models " + (r.models.join(", ") || "none recorded") + ", not " + MODEL_OF[r.arm] + " alone";
  return null;
}

function armReadout(arm: Arm, pilot: Pilot, rows: readonly CheckRow[], waiting: boolean): ArmReadout {
  const all = pilot.reviews.filter((r) => r.arm === arm);
  const bug = all.filter((r) => r.pool !== "decoy");
  const partSet = arm === "N" ? all : bug;
  const partMisses = partSet.flatMap((r) => {
    const why = partRanMiss(r);
    return why ? [r.label + " (" + why + ")"] : [];
  });
  const partOk = partSet.length - partMisses.length;
  const part_ran: Check = arm === "N"
    ? { pass: partMisses.length === 0 && partSet.length === PILOT_BUG_UNITS + 1, measured: partOk + " of " + partSet.length + " sessions clean", misses: partMisses }
    : { pass: partOk >= PART_RAN_MIN, measured: partOk + " of " + partSet.length + " bug-unit reviews exposed on " + MODEL_OF[arm] + " with Codex on " + VOICE_OF[arm], misses: partMisses };
  const taken = bug.filter((r) => r.outcome === "ok" && !r.contaminated);
  const left_out = bug.filter((r) => !(r.outcome === "ok" && !r.contaminated)).map((r) => r.label + " (" + (r.contaminated ? "contaminated" : r.outcome === "safety_stop" ? "safety stop" : "gap") + ")");
  const armRows = rows.filter((r) => r.arm === arm);
  const pj = pilotJudgeCheck(rows, arm, taken.length);
  const unresolved = armRows.filter((r) => r.label === "unresolved").length;
  const errorLabels = armRows.flatMap((row) => (row.label !== "unresolved" && row.carbon !== row.label) || row.label === "unresolved" ? [taken.find((r) => r.unit === row.unit)!.label + " (" + (row.label === "unresolved" ? "labellers unresolved" : row.carbon ? "Carbon names, labels say no" : "Carbon misses, labels say names") + ")"] : []);
  const judge = waiting
    ? { pass: false, waiting, measured: "waiting on person labels", misses: [], labelled: 0, taken: taken.length, errors: 0, unresolved: 0, left_out }
    : { pass: pj.pass, waiting, measured: pj.labels + " of " + taken.length + " labelled, " + pj.errors + " Carbon error" + (pj.errors === 1 ? "" : "s") + ", " + unresolved + " unresolved", misses: errorLabels, labelled: pj.labels, taken: taken.length, errors: pj.errors, unresolved, left_out };
  const built = bug.filter((r) => pilot.built.has(r.unit));
  const ran = bug.filter((r) => r.termination !== "not run");
  const parsed = bug.filter((r) => r.parse === "findings");
  const supplyMisses = bug.flatMap((r) => (!pilot.built.has(r.unit) ? [r.label + " (not built)"] : r.termination === "not run" ? [r.label + " (not run)"] : r.parse !== "findings" ? [r.label + " (" + (r.parse === "missing" ? "no findings block" : "parse " + r.parse + ", " + r.termination) + ")"] : []));
  const supply: Check = { pass: built.length === PILOT_BUG_UNITS && ran.length === PILOT_BUG_UNITS && parsed.length === PILOT_BUG_UNITS && bug.length === PILOT_BUG_UNITS, measured: built.length + " built, " + ran.length + " run, " + parsed.length + " parsed of " + bug.length + " bug units", misses: supplyMisses };
  const costed = all.filter((r) => r.usd !== null);
  const walls = all.flatMap((r) => (r.wall_seconds === null ? [] : [r.wall_seconds]));
  const spend = costed.reduce((s, r) => s + r.usd!, 0);
  return {
    arm,
    part_ran,
    judge,
    supply,
    usd_per_review: mean(costed.map((r) => r.usd!)),
    costed: costed.length,
    median_wall_s: median(walls),
    mean_wall_s: mean(walls),
    pilot_spend: spend,
    unknown_cost: all.filter((r) => r.termination !== "not run" && r.usd === null).length,
    within_cap: spend <= PILOT_CAP[arm],
    reruns: all.reduce((s, r) => s + r.reruns, 0),
    rerun_usd: all.some((r) => r.rerun_usd === null) ? null : all.reduce((s, r) => s + (r.rerun_usd ?? 0), 0),
    contaminated: all.filter((r) => r.contaminated).length,
    pass: part_ran.pass && (judge.waiting || judge.pass) && supply.pass,
  };
}

/** Change 2, section 2: the reserve left after the pilot's reruns against the rerun rate projected over each set's counted reviews. */
export function reserveReadout(pilot: Pilot, counted: { p: number; b: number; decoys: number }): ReserveReadout {
  const reviews = pilot.reviews.length;
  const reruns = pilot.reviews.reduce((s, r) => s + r.reruns, 0);
  const rerun_usd = pilot.reviews.some((r) => r.rerun_usd === null) ? null : pilot.reviews.reduce((s, r) => s + (r.rerun_usd ?? 0), 0);
  const rate = reviews ? reruns / reviews : 0;
  const perArm = counted.p + counted.b + counted.decoys;
  const sets = (Object.keys(RESERVE) as Array<Exclude<ProceedSet, "stop">>).map((set) => {
    const arms = SET_ARMS[set];
    const counted_reviews = perArm * arms.length;
    const mean_cap = arms.reduce((s, a) => s + PER_REVIEW_CAP[a], 0) / arms.length;
    const projected_reruns = rate * counted_reviews;
    const projected_usd = projected_reruns * mean_cap;
    const left = rerun_usd === null ? null : RESERVE[set].cap - rerun_usd;
    return { set, counted_reviews, projected_reruns, mean_cap, projected_usd, reserve_cap: RESERVE[set].cap, reserve_central: RESERVE[set].central, left, holds: left === null ? null : projected_usd <= left, ...(RESERVE[set].note ? { note: RESERVE[set].note } : {}) };
  });
  return { pilot_reviews: reviews, reruns, rate, rerun_usd, sets };
}

/** Every read the readout makes. final is the person labels' final.json, or null while they are not in; historyPath is
 *  Harness Evals' per-pass stage 1 CSV. */
export function pilotReadout(pilot: Pilot, final: readonly FinalRow[] | null, historyPath: string, historySha256?: string): Readout {
  const missingJudge = pilot.reviews.filter((r) => r.pool !== "decoy" && r.outcome === "ok" && r.findings.length && !r.judged);
  if (missingJudge.length) rmFail("E_RM_POST_INPUT", missingJudge.length + " pilot bug-unit reviews with findings have no Carbon result; run rm-post judge-send first");
  const byKey = new Map(pilot.reviews.map((r) => [r.arm + " " + r.unit, r]));
  const review = (f: FinalRow) => byKey.get(f.arm + " " + f.unit) ?? rmFail("E_RM_POST_INPUT", "a label names a review the pilot does not hold");
  const rows = (final ?? []).map((f) => checkRow(review(f), f.label));
  const cantAsYes = (final ?? []).map((f) => checkRow(review(f), f.cant_tell ? true : f.label));
  const arms = ARMS.map((a) => armReadout(a, pilot, rows, final === null));
  const counted = pilot.key.counted;
  const total = counted.p + counted.b;
  if (!total) rmFail("E_RM_POST_INPUT", "the key's counted set holds no bug units");
  let gap: ReturnType<typeof costGap> | null = null;
  try {
    gap = costGap(pilot.reviews);
  } catch (e) {
    if (!(e instanceof RmError)) throw e;
  }
  const history = readHistory(historyPath, historySha256);
  const pilot_p = pilotCatches(pilot.reviews, "P"), pilot_b = pilotCatches(pilot.reviews, "B");
  const p_share = counted.p / total, b_share = counted.b / total;
  const rule = gap?.lower == null ? null : stagedRule({ gap_lower: gap.lower, p_share, b_share, history, pilot_p, pilot_b });
  const passed = Object.fromEntries(arms.map((a) => [a.arm, a.pass])) as Record<Arm, boolean>;
  const proceed = proceedSet(passed, rule?.drop_fable ?? false);
  const countedArms = proceed.arms.length ? proceed.arms : [...ARMS];
  return { arms, reserve: reserveReadout(pilot, counted), staged: { gap, history, pilot_p, pilot_b, p_share, b_share, rule }, proceed, kappa: kappaCheck(rows, countedArms), kappa_cant_as_yes: kappaCheck(cantAsYes, countedArms).kappa, cant_tell_labels: (final ?? []).filter((f) => f.cant_tell).length, labels_waiting: final === null, check_rows: rows, contamination: pilot.contamination, counted };
}

const usd = (x: number | null) => (x === null ? "unknown" : "$" + x.toFixed(2));
const pct = (x: number) => (100 * x).toFixed(1) + "%";
const yes = (b: boolean) => (b ? "passes" : "fails");
const list = (xs: readonly string[]) => (xs.length ? xs.join("; ") : "none");

export function renderReadout(r: Readout, pilot: Pilot): string {
  const L: string[] = [];
  const failing = r.arms.filter((a) => !a.pass).map((a) => a.arm);
  L.push("# Review-models pilot readout (GEVA-590)", "");
  L.push("Proceed set: **" + r.proceed.set + "** (" + (r.proceed.arms.join(", ") || "no arm") + "): " + r.proceed.reason + ".");
  L.push("Arms that pass their pilot: " + (r.arms.filter((a) => a.pass).map((a) => a.arm).join(", ") || "none") + "; arms that fail: " + (failing.join(", ") || "none") + ". Staged rule: " + (r.staged.rule ? (r.staged.rule.drop_fable ? "Fable leaves" : "Fable stays") : "not read (no paired cost gap)") + ". Retry reserve: " + r.reserve.reruns + " pilot rerun" + (r.reserve.reruns === 1 ? "" : "s") + ".");
  L.push("", "Units are named by opaque label only. No counted review has run, and no catch rate here is a result.", "");
  for (const a of r.arms) {
    L.push("## " + a.arm + ": " + (a.pass ? "passes its pilot" : "fails its pilot"), "");
    L.push("| Check | Plan | Pilot | Result |", "|---|---|---|---|");
    L.push("| Part ran | " + (a.arm === "N" ? "the read audit finds no gstack file and no drive path in its sessions" : "exposure in at least " + PART_RAN_MIN + " of 10 bug-unit reviews, " + MODEL_OF[a.arm] + " for the session and every specialist, Codex events on " + VOICE_OF[a.arm]) + " | " + a.part_ran.measured + " | " + yes(a.part_ran.pass) + " |");
    L.push("| Judge check | every bug-unit review labelled by two people; at most " + JUDGE_CHECK.pilot_errors_max + " Carbon errors | " + a.judge.measured + (a.judge.left_out.length ? "; left out of the check: " + a.judge.left_out.join(", ") : "") + " | " + (a.judge.waiting ? "waiting" : yes(a.judge.pass)) + " |");
    L.push("| Supply | " + PILOT_BUG_UNITS + " units built, run and parsed | " + a.supply.measured + " | " + yes(a.supply.pass) + " |");
    L.push("| Cost per review | central " + usd(CENTRAL[a.arm]) + ", cap " + usd(PER_REVIEW_CAP[a.arm]) + " | " + usd(a.usd_per_review) + " over " + a.costed + " reviews" + (a.unknown_cost ? ", " + a.unknown_cost + " with no settled cost" : "") + " | descriptive |");
    L.push("| Wall time per review | | median " + (a.median_wall_s === null ? "unknown" : a.median_wall_s.toFixed(0) + " s") + ", mean " + (a.mean_wall_s === null ? "unknown" : a.mean_wall_s.toFixed(0) + " s") + " | descriptive |");
    L.push("| Pilot spend | at most " + usd(PILOT_CAP[a.arm]) + " | " + usd(a.pilot_spend) + " | " + (a.within_cap ? "within cap" : "over cap") + " |");
    L.push("| Reruns | drawn on the retry reserve | " + a.reruns + (a.reruns ? ", " + usd(a.rerun_usd) : "") + " | descriptive |");
    L.push("| Contaminated reviews | | " + a.contaminated + " of 11 | descriptive |");
    L.push("");
    if (a.judge.waiting) L.push("- Judge check: waiting on person labels.");
    const misses = [["Part ran", a.part_ran.misses], ["Judge check", a.judge.misses], ["Supply", a.supply.misses]].filter(([, m]) => (m as string[]).length);
    for (const [name, m] of misses) L.push("- " + name + " misses: " + list(m as string[]));
    if (misses.length || a.judge.waiting) L.push("");
  }
  const rs = r.reserve;
  L.push("## Retry reserve (pre-run change 2, section 2)", "");
  L.push("The pilot reran " + rs.reruns + " of " + rs.pilot_reviews + " reviews (" + pct(rs.rate) + "), spending " + usd(rs.rerun_usd) + " from the reserve. Projected over the counted reviews at each set's mean per-review cap:", "");
  L.push("| Set | Counted reviews | Projected reruns | Mean cap | Projected spend | Reserve (cap, central) | Left after the pilot | Holds |", "|---|---|---|---|---|---|---|---|");
  for (const s of rs.sets) L.push("| " + s.set + " | " + s.counted_reviews + " | " + s.projected_reruns.toFixed(1) + " | " + usd(s.mean_cap) + " | " + usd(s.projected_usd) + " | " + usd(s.reserve_cap) + ", " + usd(s.reserve_central) + " | " + usd(s.left) + " | " + (s.holds === null ? "unknown" : s.holds ? "yes" : "no: cap ask to the Captain before the counted run") + " |");
  for (const s of rs.sets) if (s.note) L.push("", s.set + ": " + s.note + ".");
  const take = rs.sets.find((s) => s.set === r.proceed.set);
  if (take && take.holds === false) L.push("", "The proceed set's projection passes its reserve, so a cap ask goes to the Captain before the counted run.");
  L.push("");
  const st = r.staged;
  L.push("## Staged rule (section 7, change 1 item 3)", "");
  L.push(st.gap ? "- Cost gap, Fable cell minus Opus cell per review, paired by unit and voice: mean " + usd(st.gap.mean) + ", SE " + (st.gap.se === null ? "unknown" : usd(st.gap.se)) + ", lower bound (mean minus 1.96 SE) " + usd(st.gap.lower) + " over " + st.gap.pairs + " pairs" + (st.gap.unpaired.length ? " (" + st.gap.unpaired.length + " unpaired)" : "") + "." : "- Cost gap: no unit holds a paired Fable and Opus cost.");
  L.push("- Counted set: " + r.counted.p + " P and " + r.counted.b + " B bug units (P share " + pct(st.p_share) + "), " + r.counted.decoys + " decoys.");
  L.push("- History: " + st.history.caught + " of " + st.history.units + " outside bugs caught by Opus /review (CSV sha256 " + st.history.sha256.slice(0, 12) + "). Pilot: " + st.pilot_p.caught + " of " + st.pilot_p.units + " P units and " + st.pilot_b.caught + " of " + st.pilot_b.units + " B units caught by the mean of OS and OA.");
  if (st.rule) {
    L.push("- One-sided 95% lower bounds: P pooled " + pct(st.rule.p_bound_pooled) + ", P pilot alone " + (st.rule.p_bound_pilot === null ? "none" : pct(st.rule.p_bound_pilot)) + ", P used " + pct(st.rule.p_bound) + ", B " + pct(st.rule.b_bound) + ".");
    L.push("- Headroom " + pct(st.rule.headroom) + "; break-even gap at " + usd(VALUE_PER_CATCH) + " a catch " + usd(st.rule.break_even_gap) + " per review. Gap lower bound / $25 = " + pct((st.gap?.lower ?? 0) / VALUE_PER_CATCH) + ": **" + (st.rule.drop_fable ? "Fable leaves the counted run (\"Fable leaves at the pilot\" row)" : "Fable stays") + "**.");
  } else L.push("- No paired Fable and Opus costs, so the rule could not be read.");
  L.push("");
  L.push("## Proceed set (change 1 item 2)", "");
  L.push("**" + r.proceed.set + "**: " + r.proceed.reason + "." + (r.proceed.set === "stop" ? " The run stops before any counted spend, and the failure is reported under R111." : " Counted arms: " + r.proceed.arms.join(", ") + "."));
  L.push("");
  L.push("## Judge check inputs", "");
  L.push("The pilot's labels go into the gate with the validation batch's (change 1 item 1, change 2 section 2); the gate needs " + JUDGE_CHECK.labels_min + " bug-unit labels, so this pilot-only line is not the gate.", "");
  if (r.labels_waiting) L.push("- Carbon judge check: waiting on person labels. Carbon's numbers count only once the person labels pass R78 (pre-run change 5), and the counted run waits for them.");
  else {
    L.push("- " + r.kappa.line);
    if (r.cant_tell_labels) L.push("- " + r.cant_tell_labels + " person label" + (r.cant_tell_labels === 1 ? "" : "s") + " rest on can't tell, read as not naming; read as naming (change 6's second reading), kappa is " + (r.kappa_cant_as_yes === null ? "n/a" : r.kappa_cant_as_yes.toFixed(3)) + ".");
  }
  const pool = (k: "P" | "B") => k + " " + r.kappa.per_pool[k].labels + " labels, " + r.kappa.per_pool[k].errors + " error" + (r.kappa.per_pool[k].errors === 1 ? "" : "s") + ", " + r.kappa.per_pool[k].abstentions + " abstaining, " + r.kappa.per_pool[k].empty_replies + " empty replies";
  if (!r.labels_waiting) L.push("- Per pool: " + pool("P") + "; " + pool("B") + ".");
  L.push("- Decoy reviews go to the false-alarm read and are not labelled. The labels are two people's, made through the labelling desk; no model makes one.");
  L.push("");
  L.push("## Contamination (section 5)", "");
  if (!r.contamination.read) L.push("No contamination report was found, so every review reads as clean here.");
  else {
    L.push("Read for every session that ran; " + r.contamination.pending_cases + " doubtful cases wait on the blind second read. An arm over 10% contaminated reads untested for its contrasts.", "");
    L.push("| Arm | Sessions | Attempted searches | Removed web_search tools | Contaminated | Doubtful | Voice rollouts missing |", "|---|---|---|---|---|---|---|");
    for (const a of r.contamination.arms) L.push("| " + a.arm + " | " + a.reviews + " | " + a.attempted_searches + (Object.keys(a.by_tool).length ? " (" + Object.entries(a.by_tool).map(([t, k]) => t + " " + k).join(", ") + ")" : "") + " | " + a.removed_web_search_tools + " | " + a.contaminated_reviews + (a.untested ? " (untested)" : "") + " | " + a.doubtful_reviews + " | " + a.voice_sessions_missing + " |");
  }
  L.push("");
  const text = L.join("\n");
  assertSafe(text, pilot);
  return text;
}

/** Refuses text that names any unit id, cluster, PR, fix commit, advisory or CVE id the key holds. */
export function assertSafe(text: string, pilot: Pilot): void {
  const named: string[] = [];
  for (const u of pilot.key.pilot) {
    const shas = (u.unit.match(/[0-9a-f]{7,40}/gi) ?? []).filter((s) => s.length >= 7);
    const hits = [...unitMatcher({ ...u.markers, unit: u.unit, commits: [...u.markers.commits, ...shas] })(text).filter((h) => !h.startsWith("suite ")), ...[u.unit, u.cluster].filter((s) => text.includes(s))];
    if (hits.length) named.push(u.label + ": " + hits.join(", "));
  }
  if (named.length) rmFail("E_RM_POST_INPUT", "the readout would name what the key holds (" + named.join("; ") + "); it is not written");
}
