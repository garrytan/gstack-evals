// Copyright (c) 2026 Garry Tan. MIT License.
// The planted-unit read's readout (prereg 2026-11-15-geva-537-eng-review-planted-units-prereg, sections 5, 6, 9 and 11)
// behind `gstack-evals ep analyze`. Each skill arm is its own family at alpha 0.05 on the primary, paired by unit and
// clustered by repository, with Holm across the two printed beside it as the public headline (the Captain's condition
// 2); every skill-arm line says the effect is measured given an explicit invocation, beside the arm's exposure counts
// (condition 4). It prints the verdict in its precedence, the decision row, the gaps-scored-0 reading, the catch
// sensitivity read, the limit-stop sensitivity, the clean check outside the pilot, standalone minus eng phase, the stock
// and no-review lines, every secondary and stratum section 9 lists, the judged secondary when reported, and the
// descriptives section 5 lists. No judge call and no key.
import { FROZEN } from "../frozen.ts";
import type { BuildArm, GradedBuild, PlantedUnit, Primary, Reviewer, ReviewRecord, SkillArm } from "../types.ts";
import { exposureCounts, interimCheck, smokeGate } from "./gates.ts";
import { genericRate, type JudgedSummary } from "./judge.ts";
import { REGION_BINS, SKILL_ARMS } from "./local.ts";
import { avoid, catchScore, Cells, functionalShare, isGap, measureOf, reach, solved, unitScore, type GapRule, type Measure } from "./score.ts";
import { fmt, holm, infer, lengthAdjusted, levelOf, lvl, pairUnits, readingLine, type HolmRow, type Reading } from "./stats.ts";
import { decisionRow, invocation, pairRow, pairWord, stockRow, stockWord, untestedWhy, verdictOf, whyNull, type VerdictOut } from "./verdicts.ts";

export interface AnalysisInput {
  /** The comparison units: every admitted unit, or the hard units only after the content raise. */
  units: PlantedUnit[];
  population: "all" | "hard";
  /** The primary the pilot's component rule picked. */
  primary: Primary;
  /** The pilot read HEADROOM, or the raise read in band. */
  admitted: boolean;
  builds: GradedBuild[];
  /** The comparison's review sessions in run order (not the smoke). */
  reviews: ReviewRecord[];
  /** The exposure smoke's sessions in run order. */
  smoke: ReviewRecord[];
  reviewer: Reviewer;
  /** Planned builds per arm, for coverage. */
  planned: Partial<Record<BuildArm, number>>;
  seed: number;
  draws?: number;
  /** The design MDD from power.py (frozen, or re-printed after the pilot). */
  designMdd?: number | null;
  judged?: JudgedSummary | null;
}

export interface ArmResult extends VerdictOut {
  reading: Reading | null;
  zero: Reading | null;
  functional: Reading | null;
  reachGuard: Reading | null;
  headline: VerdictOut;
  holm: HolmRow<SkillArm> | null;
  stock: "matches" | "not distinguished";
  row: string;
  exposure: ReturnType<typeof exposureCounts>;
}

export interface Analysis {
  arms: Record<SkillArm, ArmResult>;
  pair: string;
  lines: string[];
}

type Filter = (b: GradedBuild) => boolean;
interface Opts {
  units?: PlantedUnit[];
  gaps?: GapRule;
  /** Applies to every arm's builds (the limit-stop sensitivity). */
  all?: Filter;
  /** Applies to the plus arm's builds only (the exposure split). */
  plus?: Filter;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const brief = (r: Reading | null) => (r ? fmt(r.estimate) + " [" + fmt(r.lo) + ", " + fmt(r.hi) + "] units " + r.units + ", repos " + r.repos : "n/a");

export function analyze(inp: AnalysisInput): Analysis {
  const draws = inp.draws ?? FROZEN.bootstrapDraws;
  const cells = new Cells(inp.builds);
  const R = inp.reviewer;
  const pass: Filter = () => true;
  const scoreOf = (u: PlantedUnit, arm: BuildArm, m: Measure, gaps: GapRule, f: Filter = pass) => unitScore(cells.get(u.id, arm, R).filter(f), u, m, gaps);
  const contrast = (plus: BuildArm, minus: BuildArm, m: Measure, o: Opts = {}) => {
    const all = o.all ?? pass;
    const pf = o.plus ?? pass;
    return infer(pairUnits(o.units ?? inp.units, (u) => scoreOf(u, plus, m, o.gaps ?? "missing", (b) => all(b) && pf(b)), (u) => scoreOf(u, minus, m, o.gaps ?? "missing", all)), inp.seed, draws);
  };
  const level = (arm: BuildArm, m: Measure, o: Opts = {}) => levelOf(o.units ?? inp.units, (u) => scoreOf(u, arm, m, o.gaps ?? "missing", o.all ?? pass), inp.seed, draws);
  const prim = measureOf(inp.primary);
  const armBuilds = (arm: BuildArm) => inp.builds.filter((b) => b.arm === arm && (arm === "plain" || arm === "engphase" || arm === "standalone" ? b.reviewer === R : b.reviewer === null));
  const coverage = (arm: BuildArm) => ((inp.planned[arm] ?? 0) > 0 ? armBuilds(arm).filter((b) => !isGap(b)).length / inp.planned[arm]! : 0);
  const smoke = smokeGate(inp.smoke, R);
  const L: string[] = [];

  L.push("reviewer " + R + ", population " + (inp.population === "hard" ? "hard units only (foreseeable units whose no-review build missed at the ceiling); every claim names that population" : "every admitted unit") + ", primary " + inp.primary + (inp.primary === "composite" ? " ((avoid + catch) / 2)" : " alone") + ", units " + inp.units.length + ", repos " + new Set(inp.units.map((u) => u.repo)).size + (inp.admitted ? "" : "; admission not passed, so every skill arm reads untested"));
  L.push("MDD: design " + lvl(inp.designMdd ?? null) + " (power.py); each reading also prints its own (2.80 x its bootstrap SD); smallest effect worth acting on " + FROZEN.worthActing.toFixed(2));
  for (const line of smoke.lines) L.push(line);

  const judged = inp.judged && inp.judged.reported ? inp.judged : null;
  const leak = new Set(judged?.leaks ?? []);
  const named = (unit: string, source: string) => {
    const r = judged?.bundles.find((b) => b.unit === unit && b.source === source);
    return r && !leak.has(unit) ? (r.named ? 1 : 0) : null;
  };
  const judgedUnits = inp.units.filter((u) => !leak.has(u.id));
  const findContrast = (plus: string, minus: string) => (judged ? infer(pairUnits(judgedUnits, (u) => named(u.id, plus), (u) => named(u.id, minus)), inp.seed, draws) : null);

  const plainCoverage = coverage("plain");
  const facts = {} as Record<SkillArm, { untested: ReturnType<typeof untestedWhy>; reading: Reading | null; functional: Reading | null; reachGuard: Reading | null; exposure: ReturnType<typeof exposureCounts> }>;
  for (const arm of SKILL_ARMS) {
    const rs = inp.reviews.filter((r) => r.arm === arm && r.reviewer === R);
    const exposure = exposureCounts(rs);
    const reachGuard = contrast(arm, "plain", reach);
    const untested = untestedWhy({ admitted: inp.admitted, gatePassed: smoke.through.includes(arm), stopped: interimCheck(arm, R, inp.reviews).stop, exposure: exposure.share, coverage: coverage(arm), plainCoverage, reachGuard });
    facts[arm] = { untested, reading: contrast(arm, "plain", prim), functional: contrast(arm, "plain", functionalShare), reachGuard, exposure };
  }
  const holmRows = holm(SKILL_ARMS.filter((a) => !facts[a].untested && facts[a].reading).map((a) => ({ arm: a, p: facts[a].reading!.p })));

  const arms = {} as Record<SkillArm, ArmResult>;
  for (const arm of SKILL_ARMS) {
    const f = facts[arm];
    const v = verdictOf({ untested: f.untested, reading: f.reading, functional: f.functional });
    const h = holmRows.find((x) => x.arm === arm) ?? null;
    const headline = verdictOf({ untested: f.untested, reading: f.reading, functional: f.functional, p: h?.adjusted });
    const zero = contrast(arm, "plain", prim, { gaps: "zero" });
    const minusStock = contrast(arm, "stock", prim);
    const stock = stockWord(v.verdict, minusStock);
    const av = contrast(arm, "plain", avoid);
    const ca = contrast(arm, "plain", (b) => catchScore(b));
    const lead = v.verdict === "KEEP" && av && ca ? (av.estimate >= ca.estimate ? "avoid" : "catch") : null;
    const row = decisionRow(arm, v.verdict, { untested: f.untested?.kind ?? null, why: f.untested?.why ?? "", judged: findContrast(arm, "plain"), judgedReported: judged !== null, lead, mdd: inp.designMdd ?? f.reading?.mdd ?? null });
    arms[arm] = { ...v, reading: f.reading, zero, functional: f.functional, reachGuard: f.reachGuard, headline, holm: h, stock, row, exposure: f.exposure };

    L.push("arm " + arm + ": " + v.verdict + " (" + v.why + "); " + readingLine(f.reading) + "; " + invocation(arm, f.exposure));
    L.push("arm " + arm + " decision row (its own test at alpha " + FROZEN.alpha + "): " + row);
    L.push("arm " + arm + " public headline (Holm across " + holmRows.length + " famil" + (holmRows.length === 1 ? "y" : "ies") + (h ? ", adjusted p " + h.adjusted.toFixed(4) : "") + "): " + headline.verdict + "; " + invocation(arm, f.exposure));
    L.push("arm " + arm + " gaps scored 0: " + readingLine(zero) + "; catch transplant drops left out: " + (inp.primary === "avoid" ? "n/a (primary avoid)" : readingLine(contrast(arm, "plain", measureOf(inp.primary, "sensitivity")))) + "; limit stops left out: " + readingLine(contrast(arm, "plain", prim, { all: (b) => !b.limitStop })));
    L.push("arm " + arm + " functional share - plain: " + readingLine(f.functional) + "; reach - plain: " + readingLine(f.reachGuard) + "; coverage " + lvl(coverage(arm), 2) + " (plain " + lvl(plainCoverage, 2) + "); exposure " + lvl(f.exposure.share, 2));
    L.push("arm " + arm + " avoid - plain: " + readingLine(av) + "; catch - plain: " + readingLine(ca));
    L.push("arm " + arm + " - stock: " + readingLine(minusStock) + "; stock line: " + stock + " (" + stockRow(stock, arm) + ")");
    L.push("arm " + arm + " - none: " + readingLine(contrast(arm, "none", prim)));
    const words = (unit: string, a: SkillArm | "plain") => mean(inp.reviews.filter((r) => r.unit === unit && r.arm === a && r.reviewer === R && !isGap(r)).map((r) => r.bundleWords));
    const pts: Array<[number, number]> = [];
    for (const p of pairUnits(inp.units, (u) => scoreOf(u, arm, prim, "missing"), (u) => scoreOf(u, "plain", prim, "missing"))) {
      const a = words(p.unit, arm);
      const b = words(p.unit, "plain");
      if (a !== null && b !== null) pts.push([a - b, p.d]);
    }
    const la = lengthAdjusted(pts);
    L.push("arm " + arm + " review words " + lvl(mean(pts.map(([w]) => w)), 0) + " more than plain a unit; length-adjusted: " + (la ? fmt(la.intercept) + " at equal words (slope " + fmt(la.slopePer1000) + " per 1,000 words, units " + la.units + ")" : "n/a"));
    const review = (b: GradedBuild) => inp.reviews.find((r) => r.unit === b.unit && r.arm === b.arm && r.reviewer === b.reviewer && r.rep === b.rep);
    L.push("arm " + arm + " exposed before any block: " + brief(contrast(arm, "plain", prim, { plus: (b) => review(b)?.exposedBeforeBlock === true })) + "; exposed only after a block or not at all: " + brief(contrast(arm, "plain", prim, { plus: (b) => review(b)?.exposedBeforeBlock !== true })));
    L.push("arm " + arm + " clean check, units outside the pilot: " + readingLine(contrast(arm, "plain", prim, { units: inp.units.filter((u) => !u.pilot) })));
    if (v.r48 === "FIX-METHOD" && v.verdict !== "helps without KEEP") L.push(whyNull(arm, f.exposure.share, f.reading?.mdd ?? inp.designMdd ?? null, level("plain", prim)?.estimate ?? null));
  }
  for (const h of holmRows) L.push("holm " + h.arm + ": p " + h.p.toFixed(4) + ", adjusted " + h.adjusted.toFixed(4) + (h.rejects ? ", rejects" : ", does not reject"));

  const pr = contrast("standalone", "engphase", prim);
  const pair = pairWord(pr, SKILL_ARMS.some((a) => facts[a].untested !== null));
  L.push("secondary standalone - engphase: " + pair + "; " + readingLine(pr) + "; " + pairRow(pair));
  L.push("secondary standalone - engphase, clean check outside the pilot: " + readingLine(contrast("standalone", "engphase", prim, { units: inp.units.filter((u) => !u.pilot) })));
  L.push("secondary plain - none: " + readingLine(contrast("plain", "none", prim)));

  if (inp.judged && !inp.judged.reported) L.push("judged secondary: not reported as judged (" + (inp.judged.why ?? "the judge check failed") + ")");
  if (judged) {
    const sources = ["plain", "engphase", "standalone", "stock", "none", "plan"] as const;
    const gen = genericRate(judged.bundles.filter((b) => !leak.has(b.unit)), inp.units);
    L.push("judged secondary: plan leaks dropped " + leak.size + "; find rate per source: " + sources.map((s) => s + " " + lvl(mean(judgedUnits.map((u) => named(u.id, s)).filter((x): x is 0 | 1 => x !== null)))).join(", "));
    L.push("judged words per source: " + sources.map((s) => s + " " + lvl(mean(judged.bundles.filter((b) => b.source === s && !leak.has(b.unit)).map((b) => b.words)), 0)).join(", "));
    L.push("judged generic-specific rate (credited quotes a generic list entry matches): " + sources.map((s) => s + " " + (gen[s] ? gen[s]!.generic + " of " + gen[s]!.credited : "0 of 0")).join(", "));
    for (const arm of SKILL_ARMS) {
      const pts: Array<[number, number]> = [];
      for (const u of judgedUnits) {
        const a = judged.bundles.find((b) => b.unit === u.id && b.source === arm);
        const b = judged.bundles.find((x) => x.unit === u.id && x.source === "plain");
        if (a && b) pts.push([a.words - b.words, (a.named ? 1 : 0) - (b.named ? 1 : 0)]);
      }
      const la = lengthAdjusted(pts);
      L.push("judged find rate " + arm + " - plain: " + readingLine(findContrast(arm, "plain")) + "; length-adjusted " + (la ? fmt(la.intercept) + " at equal words" : "n/a") + "; " + arm + " - plan alone: " + brief(findContrast(arm, "plan")));
    }
    for (const s of sources) {
      const secs = judged.bundles.filter((b) => b.source === s && b.named && !leak.has(b.unit)).flatMap((b) => b.sections);
      if (secs.length) L.push("judged section map " + s + " (a lead for the rewrite brief, never a finding): " + [...new Set(secs)].sort().map((k) => k + " " + secs.filter((x) => x === k).length).join(", "));
    }
  }

  const strata: Array<[string, PlantedUnit[]]> = [];
  const groups = <T extends string>(key: (u: PlantedUnit) => T) => [...new Set(inp.units.map(key))].sort();
  for (const e of groups((u) => u.ecosystem)) strata.push(["ecosystem " + e, inp.units.filter((u) => u.ecosystem === e)]);
  for (const [name, lo, hi] of REGION_BINS) strata.push([name, inp.units.filter((u) => u.regionLines >= lo && u.regionLines <= hi)]);
  strata.push(["foreseeable yes-only (both raters yes)", inp.units.filter((u) => u.foresee?.[0] === "yes" && u.foresee?.[1] === "yes")]);
  strata.push(["foreseeable otherwise", inp.units.filter((u) => !(u.foresee?.[0] === "yes" && u.foresee?.[1] === "yes"))]);
  if (inp.units.some((u) => u.hard !== null)) {
    strata.push(["hard", inp.units.filter((u) => u.hard === true)]);
    strata.push(["not hard", inp.units.filter((u) => u.hard === false)]);
  }
  strata.push(["strict window", inp.units.filter((u) => u.strictWindow)]);
  strata.push(["outside the strict window", inp.units.filter((u) => !u.strictWindow)]);
  for (const s of groups((u) => u.stars)) strata.push(["stars " + s, inp.units.filter((u) => u.stars === s)]);
  strata.push(["pilot units", inp.units.filter((u) => u.pilot)]);
  strata.push(["units outside the pilot", inp.units.filter((u) => !u.pilot)]);
  for (const [name, us] of strata) L.push("stratum " + name + ": " + SKILL_ARMS.map((a) => a + " " + brief(contrast(a, "plain", prim, { units: us }))).join("; "));
  L.push("stratum plain pilot vs later builds: " + lvl(level("plain", prim, { all: (b) => b.pilot })?.estimate ?? null) + " vs " + lvl(level("plain", prim, { all: (b) => !b.pilot })?.estimate ?? null));

  const classes = ["assert", "crash"] as const;
  const byClass = (cls: (typeof classes)[number]): Measure => (b, u) => {
    const ids = u.planted.filter((p) => u.plantedClass[p] === cls);
    return ids.length ? avoid({ ...b, planted: b.planted.filter((r) => ids.includes(r.id)) }, { ...u, planted: ids }) : null;
  };
  L.push("planted cases by failure class: " + classes.map((cls) => cls + " " + inp.units.reduce((s, u) => s + u.planted.filter((p) => u.plantedClass[p] === cls).length, 0)).join(", ") + "; avoid by class: " + (["plain", ...SKILL_ARMS] as const).map((arm) => arm + " " + classes.map((cls) => cls + " " + lvl(level(arm, byClass(cls))?.estimate ?? null)).join(" ")).join(", "));
  const scored = inp.builds.filter((b) => !isGap(b));
  const toolShare = scored.length ? scored.filter((b) => b.coverage !== null).length / scored.length : 0;
  L.push("changed-line coverage: the tool scored " + lvl(toolShare, 2) + " of trees, " + (toolShare >= FROZEN.toolTreesMin ? "reported" : "not reported (under " + FROZEN.toolTreesMin.toFixed(2) + ")"));
  for (const arm of ["plain", "engphase", "standalone", "stock", "none"] as const) {
    const bs = armBuilds(arm);
    const ok = bs.filter((b) => !isGap(b));
    const v = (m: Measure) => lvl(level(arm, m)?.estimate ?? null);
    const drops = [...new Set(ok.map((b) => b.catchDrop).filter((x): x is string => x !== null))].sort();
    const read = ok.filter((b) => b.readReview !== null);
    L.push(
      "measures " + arm + ": builds " + bs.length + " (gaps " + (bs.length - ok.length) + ", coverage of planned " + lvl(coverage(arm), 2) + "), avoid " + v(avoid) + ", catch " + v((b) => catchScore(b)) + " (drops left out " + v((b) => catchScore(b, "sensitivity")) + "), composite " + v(measureOf("composite")) +
        ", functional share " + v(functionalShare) + ", solved " + v(solved) + ", reach " + v(reach) + (toolShare >= FROZEN.toolTreesMin ? ", changed-line coverage " + v((b) => b.coverage) : "") +
        ", test lines added " + lvl(mean(ok.map((b) => b.testLinesAdded)), 1) + ", limit stops " + ok.filter((b) => b.limitStop).length + " of " + ok.length + ", read /work/review/ " + (read.length ? read.filter((b) => b.readReview).length + " of " + read.length : "n/a") +
        ", catch compile rate " + lvl(ok.length ? ok.filter((b) => b.catch !== null).length / ok.length : null, 2) + (drops.length ? " (drops " + drops.map((d) => d + " " + ok.filter((b) => b.catchDrop === d).length).join(", ") + ")" : "") + ", cost per build $" + lvl(mean(ok.map((b) => b.costUsd)), 2),
    );
  }
  for (const arm of ["plain", "engphase", "standalone"] as const) {
    const rs = inp.reviews.filter((r) => r.arm === arm && r.reviewer === R);
    const ok = rs.filter((r) => !isGap(r));
    const c = exposureCounts(rs);
    L.push("reviews " + arm + ": sessions " + rs.length + " (gaps " + c.gaps + "), review words " + lvl(mean(ok.map((r) => r.bundleWords)), 0) + ", truncated " + ok.filter((r) => r.truncated).length + ", repo edits discarded " + ok.reduce((s, r) => s + r.repoEditsDiscarded, 0) + ", Stop hook blocks " + lvl(mean(ok.map((r) => r.blocks)), 2) + ", cost per review $" + lvl(mean(ok.map((r) => r.costUsd)), 2) + (arm === "plain" ? "" : ", exposed " + c.exposed + ", unexposed " + c.unexposed + ", exposed before any block " + ok.filter((r) => r.exposedBeforeBlock === true).length));
  }
  return { arms, pair, lines: L };
}
