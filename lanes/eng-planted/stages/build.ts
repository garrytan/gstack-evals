// Copyright (c) 2026 Garry Tan. MIT License.
// The planted-unit read's builds (prereg 2026-11-15-geva-537 section 4): what each build arm mounts and is told, the
// review files a reviewed arm's build gets, whether the builder read them, and one build cell under the session outcome
// rule, graded through the PlantedGrader seam (types.ts). The session itself is a seam too: the real one is eng-build's
// build launcher (lanes/eng-build/launch.ts) through ebSession, so no test starts a session.
//
// - Mounts: a reviewed arm (plain, engphase, standalone) mounts the review's final plan.md at /work/plan.md and the
//   review's other files under /work/review/: its final reply as review.md, then the skill's written files (the test
//   plan artifacts, in path order), as eng-build's bundleParts orders them. A review that left no plan.md mounts the
//   authored plan, recorded as planMissing. Stock mounts the authored plan and lanes/eng-planted/stock-review.md as
//   /work/review/review.md. No review and hinted mount the authored plan and no /work/review/.
// - Cap: the plan and the review files, in that order, hold at most FROZEN.bundle.maxWords words. The part where the cap
//   falls keeps its first words and ends with " [cut]" (product-value's cut), every later part is left out, and the cut
//   is recorded (truncated, with the words before the cap). Words are runs of non-space characters in each file.
// - Edits a review made to repository files never reach the build: the build tree is the unit's base tree, and the review
//   stage counts the edits (eng-build bundle.ts repoEdits).
// - Prompt: "Implement the plan in plan.md in /work/repo, with tests." and, for arms with /work/review/, "A reviewer's
//   notes on the plan are in /work/review/; use them as you see fit." (eng-build's BUILD_LINE and REVIEW_LINE). Hinted
//   adds the hint as its own paragraph after those lines (a choice: the plan says "plan plus the hint"). Then the
//   statement note, identical across arms.
// - readReview: a build with /work/review/ read it when any tool call in its transcript (real_agent's sdk-messages.jsonl
//   beside final.patch) names a path under /work/review, or ../review from /work/repo. null for arms with no review files.
// - Outcomes: completed or limit is graded as is (limitStop marks a limit); an upstream or infrastructure end gets one
//   fresh retry, then the cell is a gap (eng-build's runSessionCell). A reviewed arm whose review ended in a gap is a gap
//   and never builds. A gap's catch is null with catchDrop "gap".
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { armName, BUILD_LINE, REVIEW_LINE, runSessionCell, type BuildSession } from "../../eng-build/build-stage.ts";
import { bundleParts, type ReviewOutputs } from "../../eng-build/bundle.ts";
import { testLinesAdded } from "../../eng-build/pipeline.ts";
import { cut } from "../../product-value/author/run.ts";
import { fail } from "../errors.ts";
import { FROZEN } from "../frozen.ts";
import type { BuildArm, GradedBuild, PlantedGrader, PlantedUnit, ReviewArm, ReviewRecord, Reviewer, SessionOutcome } from "../types.ts";
import { EB_ARM } from "./arms.ts";
import { countWords } from "./author.ts";

export const STOCK_REVIEW = join(import.meta.dir, "..", "stock-review.md");
export const REVIEWED: readonly BuildArm[] = ["plain", "engphase", "standalone"];
export const isReviewed = (arm: BuildArm): arm is ReviewArm => arm === "plain" || arm === "engphase" || arm === "standalone";
/** Arms whose build gets /work/review/. */
export const hasReview = (arm: BuildArm): boolean => isReviewed(arm) || arm === "stock";

/** The build prompt for an arm. */
export function plantedBuildPrompt(arm: BuildArm, note: string, hint: string | null = null): string {
  if ((arm === "hinted") !== (hint !== null)) fail("E_USAGE", arm === "hinted" ? "the hinted build needs its unit's hint" : "only the hinted build gets the hint");
  const lead = hasReview(arm) ? BUILD_LINE + " " + REVIEW_LINE : BUILD_LINE;
  return [lead, ...(hint !== null ? [hint.trim()] : []), ...(note.trim() ? [note.trim()] : [])].join("\n\n");
}

export interface ReviewMount {
  /** The plan the build mounts at /work/plan.md. */
  plan: string;
  /** The files under /work/review/, in order. */
  files: Array<{ name: string; text: string }>;
  /** Words the build gets (at most the cap), and before the cap. */
  words: number;
  fullWords: number;
  truncated: boolean;
  planMissing: boolean;
}

/** Caps parts in order at maxWords words: the part the cap falls in is cut, the rest are left out. */
export function capParts(parts: ReadonlyArray<{ name: string; text: string }>, maxWords: number = FROZEN.bundle.maxWords): { kept: Array<{ name: string; text: string }>; words: number; fullWords: number; truncated: boolean } {
  const fullWords = parts.reduce((s, p) => s + countWords(p.text), 0);
  const kept: Array<{ name: string; text: string }> = [];
  let left = maxWords;
  for (const p of parts) {
    const n = countWords(p.text);
    if (n <= left) {
      kept.push(p);
      left -= n;
    } else {
      if (left > 0) kept.push({ name: p.name, text: cut(p.text, left) });
      left = 0;
    }
  }
  return { kept, words: Math.min(fullWords, maxWords), fullWords, truncated: fullWords > maxWords };
}

/** What a reviewed arm's build mounts, from its review session's outputs. */
export function reviewMount(arm: ReviewArm, outputs: ReviewOutputs, authoredPlan: string, maxWords: number = FROZEN.bundle.maxWords): ReviewMount {
  const parts = bundleParts(EB_ARM[arm], outputs);
  const planMissing = outputs.plan === null;
  const all = planMissing ? [{ name: "plan.md", text: authoredPlan }, ...parts] : parts;
  const seen = new Map<string, number>();
  const named = all.map((p, i) => {
    if (i === 0) return p;
    const n = (seen.get(p.name) ?? 0) + 1;
    seen.set(p.name, n);
    return n === 1 ? p : { name: n + "-" + p.name, text: p.text };
  });
  const c = capParts(named, maxWords);
  return { plan: c.kept[0]?.text ?? "", files: c.kept.slice(1), words: c.words, fullWords: c.fullWords, truncated: c.truncated, planMissing };
}

/** The stock control's mount: the authored plan and the fixed review, under the same cap. */
export function stockMount(authoredPlan: string, stock: string = readFileSync(STOCK_REVIEW, "utf8"), maxWords: number = FROZEN.bundle.maxWords): ReviewMount {
  const c = capParts([{ name: "plan.md", text: authoredPlan }, { name: "review.md", text: stock }], maxWords);
  return { plan: c.kept[0]!.text, files: c.kept.slice(1), words: c.words, fullWords: c.fullWords, truncated: c.truncated, planMissing: false };
}

const sameOrWrite = (path: string, text: string) => {
  if (existsSync(path) && readFileSync(path, "utf8") !== text) fail("E_EB_CACHE_STALE", path + " holds other bytes than the mount assembled from its review; rebuild it from the review's session, then --resume");
  writeFileSync(path, text);
};

/** Writes a mount as <dir>/plan.md and <dir>/review/<file>, the host paths the build mounts at /work/plan.md and
 * /work/review/, with <dir>/files.json naming the review files in their fixed order. A resume reuses identical files and
 * refuses others. */
export function writeMount(dir: string, m: ReviewMount): { plan: string; review: string } {
  mkdirSync(join(dir, "review"), { recursive: true });
  sameOrWrite(join(dir, "plan.md"), m.plan);
  sameOrWrite(join(dir, "files.json"), JSON.stringify(m.files.map((f) => f.name)) + "\n");
  const names = new Set(m.files.map((f) => f.name));
  for (const f of readdirSync(join(dir, "review"))) if (!names.has(f)) fail("E_EB_CACHE_STALE", join(dir, "review", f) + " is not part of the assembled mount; rebuild it, then --resume");
  for (const f of m.files) sameOrWrite(join(dir, "review", f.name), f.text);
  return { plan: join(dir, "plan.md"), review: join(dir, "review") };
}

/** What a builder saw from a written mount, in order: plan.md, then review/<file> in the mount's fixed order. */
export function readMount(dir: string): Array<{ path: string; text: string }> {
  const names = JSON.parse(readFileSync(join(dir, "files.json"), "utf8")) as string[];
  return [{ path: "plan.md", text: readFileSync(join(dir, "plan.md"), "utf8") }, ...names.map((n) => ({ path: "review/" + n, text: readFileSync(join(dir, "review", n), "utf8") }))];
}

const REVIEW_PATH = /\/work\/review\b|(?:^|[^\w./-])\.\.\/review\b/;
type Rec = Record<string, unknown>;
const toolUses = (v: unknown, out: Rec[] = []): Rec[] => {
  if (Array.isArray(v)) for (const x of v) toolUses(x, out);
  else if (v && typeof v === "object") {
    const r = v as Rec;
    if (r.type === "tool_use" && "input" in r) out.push(r);
    for (const x of Object.values(r)) if (x && typeof x === "object") toolUses(x, out);
  }
  return out;
};

/** Whether any tool call in a build's transcript names a path under /work/review/. */
export function readReview(transcript: string): boolean {
  for (const line of transcript.split("\n")) {
    if (!line.trim()) continue;
    let rec: unknown;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    if (toolUses(rec).some((u) => REVIEW_PATH.test(JSON.stringify(u.input)))) return true;
  }
  return false;
}

export interface PlantedSessionRun {
  outcome: SessionOutcome;
  /** The folder holding final.patch and sdk-messages.jsonl, or null when the session left none. */
  tree: string | null;
  costUsd: number;
}

/** One build attempt from a fresh container, with the cell's plan and review mounts. */
export type PlantedSession = (o: { cell: string; unit: PlantedUnit; arm: BuildArm; prompt: string; plan: string; review: string | null; attempt: number }) => Promise<PlantedSessionRun>;

/** The cell table the real launcher's planFor and reviewFor read: each cell's host plan and review folder. */
export type MountTable = Map<string, { plan: string; review: string | null }>;

/** The real build session: eng-build's launcher session. ebSession files each cell's mounts in the table the launcher's
 * planFor and reviewFor read, and runs arms with review files on the launcher's reviewed stage. */
export function ebSession(eb: BuildSession, table: MountTable): PlantedSession {
  return (s) => {
    table.set(s.cell, { plan: s.plan, review: s.review });
    const ebArm = s.review === null ? ("none" as const) : ("plain" as const);
    return eb({ cell: s.cell, unit: { id: s.unit.id }, arm: ebArm, armName: armName(ebArm), prompt: s.prompt, attempt: s.attempt });
  };
}

export const buildKey = (unit: string, arm: BuildArm, reviewer: Reviewer | null, rep: number) => (unit + ":" + arm + ":" + (reviewer ?? "-") + ":" + rep).replace(/[^A-Za-z0-9._-]/g, "_");

/** One build cell: the session under the outcome rule, then the grader and catch. An error after the session spent
 * carries that spend as spentUsd, which runGated settles. */
export async function runPlantedBuild(o: { unit: PlantedUnit; unitDir: string; arm: BuildArm; reviewer: Reviewer | null; rep: number; note: string; hint?: string | null; mount: { plan: string; review: string | null }; review?: ReviewRecord | null; session: PlantedSession; grader: PlantedGrader; coverage?: (unitDir: string, tree: string) => Promise<number | null>; log?: (line: string) => void }): Promise<GradedBuild> {
  const cell = buildKey(o.unit.id, o.arm, o.reviewer, o.rep);
  if (isReviewed(o.arm) !== (o.reviewer !== null)) fail("E_USAGE", "cell " + cell + ": a reviewed arm names its reviewer, and no other arm does");
  if (hasReview(o.arm) !== (o.mount.review !== null)) fail("E_USAGE", "cell " + cell + ": arm " + o.arm + (hasReview(o.arm) ? " needs its /work/review/ mount" : " gets no /work/review/"));
  const meta = { unit: o.unit.id, arm: o.arm, reviewer: o.reviewer, rep: o.rep, pilot: o.unit.pilot };
  const gap = (outcome: SessionOutcome, costUsd: number): GradedBuild => ({ ...meta, outcome, limitStop: false, planted: [], functional: [], catch: null, catchDrop: "gap", readReview: null, coverage: null, testLinesAdded: 0, costUsd });
  if (isReviewed(o.arm)) {
    const r = o.review ?? fail("E_USAGE", "cell " + cell + ": its review record is missing, so nothing is built; run the review stage for this cell first");
    if (r.unit !== o.unit.id || r.arm !== o.arm || r.reviewer !== o.reviewer || r.rep !== o.rep) fail("E_USAGE", "cell " + cell + ": the review record given is another cell's");
    if (r.outcome === "upstream_gap" || r.outcome === "infra_gap") {
      o.log?.("E_EB_GAP cell " + cell + ": its review ended " + r.outcome + ", so the build is not run; recorded as a gap");
      return gap(r.outcome, 0);
    }
  }
  const prompt = plantedBuildPrompt(o.arm, o.note, o.arm === "hinted" ? (o.hint ?? null) : null);
  let cost = 0;
  let tree: string | null = null;
  try {
    const run = await runSessionCell(cell, async (attempt) => {
      const s = await o.session({ cell, unit: o.unit, arm: o.arm, prompt, plan: o.mount.plan, review: o.mount.review, attempt });
      cost += s.costUsd;
      tree = s.tree;
      return s.outcome;
    });
    if (run.gap) {
      o.log?.(run.line!);
      return gap(run.outcome, cost);
    }
    const t: string = tree ?? fail("E_USAGE", "cell " + cell + ": the session ended " + run.outcome + " but left no tree to grade");
    const g = await o.grader.grade(o.unit, o.unitDir, t);
    const c = await o.grader.catchOf(o.unit, o.unitDir, t);
    const file = (n: string) => (lstatSync(join(t, n), { throwIfNoEntry: false })?.isFile() ? readFileSync(join(t, n), "utf8") : "");
    return {
      ...meta,
      outcome: run.outcome,
      limitStop: run.outcome === "limit",
      planted: g.planted,
      functional: g.functional,
      catch: c.catch,
      catchDrop: c.drop,
      readReview: hasReview(o.arm) ? readReview(file("sdk-messages.jsonl")) : null,
      coverage: o.coverage ? await o.coverage(o.unitDir, t) : null,
      testLinesAdded: testLinesAdded(file("final.patch")),
      costUsd: cost,
    };
  } catch (e) {
    if (cost > 0 && typeof e === "object" && e !== null) Object.assign(e, { spentUsd: cost });
    throw e;
  }
}
