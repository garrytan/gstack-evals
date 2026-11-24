// Copyright (c) 2026 Garry Tan. MIT License.
// Eval 1's cells (prereg 2026-11-24-geva-587-design-time-state-modeling sections 3 to 5, 9 and 11): the ledger items, the
// cells in seeded order, the review stage and the build stage of one item, and the scored cells the readings take.
//
// - Items: one per arm and model (14), each projected at 128 cells of its section 11 figure and capped at 1.2 times that
//   (3,478 / 2,898), plus the pilot (84 cells on the 6 calibration units, $136, cap $165). Section 11 gives one figure per
//   review and build; the gate splits it as a build at $0.61 (the middle of attempt 3's $0.45 to $0.77 builds) and the rest
//   for the review, so an item's projection is unchanged. Allowances, the in-flight hold, the first-session rule and the
//   10-session halt are attempt 3's gate (stages/ledger.ts), with this eval's items in the all-in projection.
// - Cells: every arm on every model it runs on, 2 cells a unit; units in the draw's seeded order, a unit's cells in a
//   seeded order (stages/pipeline.ts cellOrder). The review stage and the build stage each run one item's cells under one
//   lease, half the units at a time, so the look has every arm's cells on its units.
// - Review: attempt 3's seed (B copied, stripped to one commit, the authored plan), one fresh retry for an upstream or
//   infrastructure end, then a gap; the arm's detector reads the session; the mount is e1Mount's. A gap builds nothing.
// - Build: attempt 3's build stage unchanged: the reviewed prompt, the mount, one fresh retry, the grader, catch.
// - A unit whose stripped B still tracks .codex, .agents or AGENTS.override.md is left out before any outcome, as attempt 3
//   leaves out a B that tracks project-local Claude Code config (pre-run change 2).
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { BUILD_LINE, REVIEW_LINE, stripBase } from "../../eng-build/build-stage.ts";
import { testLinesAdded } from "../../eng-build/pipeline.ts";
import type { Attempt } from "../../eng-build/review-stage.ts";
import { addSpend } from "../../eng-build/spend.ts";
import { fail } from "../errors.ts";
import { isGap, score } from "../readings/score.ts";
import { oneRetry, readReview, writeMount, type PlantedSession } from "../stages/build.ts";
import { cellOrder } from "../stages/pipeline.ts";
import { runGated, type ItemGate, type ItemPlan } from "../stages/ledger.ts";
import type { CaseRuns, PlantedGrader, PlantedUnit, SessionOutcome } from "../types.ts";
import { e1Prompt, type PCommand } from "./arms.ts";
import { e1Mount } from "./bundle.ts";
import { exposure } from "./detect.ts";
import { E1, RUNS_ON, type E1Arm, type E1Model } from "./frozen.ts";
import type { E1ReviewLeft, E1ReviewSession } from "./launch.ts";
import type { Cell } from "./readings.ts";

/** Section 11's figure per review and build cell. */
export const FIGURE: Readonly<Record<E1Model, Partial<Record<E1Arm, number>>>> = {
  opus: { N: 0.93, D: 1.05, C: 2.15, P: 2.65, G: 2.63 },
  sol: { N: 1.72, D: 1.95, C: 2.85, G: 2.71 },
  particle: { N: 0.56, D: 0.62, C: 0.85, P: 0.95, G: 1.02 },
};
export const BUILD_FIGURE = 0.61;
export const CAP_RATIO = 1.2;
/** A cell's figure split between its review and its build: the build takes $0.61 (attempt 3's builds ran $0.45 to
 * $0.77), and where that leaves the review under a quarter of the cell, the review keeps a quarter. */
export const reviewShare = (figure: number) => Math.max(figure - BUILD_FIGURE, figure / 4);
export const itemName = (arm: E1Arm, model: E1Model) => "e1-" + arm.toLowerCase() + "-" + model;
const plan = (item: string, row: string, cells: number, figure: number, projection: number, cap: number): ItemPlan => ({ item, row, projectionUsd: projection, capUsd: cap, kinds: { "review:plain": { planned: cells, usd: reviewShare(figure) }, build: { planned: cells, usd: figure - reviewShare(figure) } } });
const pairs = (Object.keys(RUNS_ON) as E1Arm[]).flatMap((a) => RUNS_ON[a].map((m) => [a, m] as const));
const COUNTED = E1.units.target * E1.cells;
export const E1_ITEMS: readonly ItemPlan[] = [
  ...pairs.map(([a, m]) => {
    const f = FIGURE[m][a]!;
    const p = Math.round(COUNTED * f * 100) / 100;
    return plan(itemName(a, m), "Counted cells, " + a + " on " + m + ": " + COUNTED + " x $" + f.toFixed(2), COUNTED, f, p, Math.round(p * CAP_RATIO * 100) / 100);
  }),
  plan("e1-pilot", "Pilot: 84 cells on the 6 calibration units", E1.units.calibration * pairs.length, 136 / (E1.units.calibration * pairs.length), 136, 165),
  { item: "e1-supply", row: "Supply: state labels and reach ratings on the pool and wave 2 (one call cell a unit screened), wave 2's authoring (calls and a hinted build a unit)", projectionUsd: 180, capUsd: 220, kinds: { call: { planned: 500, usd: (180 - 60 * BUILD_FIGURE) / 500 }, build: { planned: 60, usd: BUILD_FIGURE } } },
];
export const e1Item = (name: string): ItemPlan => E1_ITEMS.find((i) => i.item === name) ?? fail("E_USAGE", "eval 1 has no line item " + name);

export interface CellKey {
  unit: string;
  arm: E1Arm;
  model: E1Model;
  rep: number;
}
export const cellKey = (c: CellKey) => (c.unit + ":" + c.arm + ":" + c.model + ":" + c.rep).replace(/[^A-Za-z0-9._-]/g, "_");

/** Every cell of the units, in the units' order, each unit's cells in the seeded order. */
export function e1Cells(seed: string, units: readonly string[], reps: number = E1.cells): CellKey[] {
  const all = units.flatMap((unit) => pairs.flatMap(([arm, model]) => Array.from({ length: reps }, (_, rep) => ({ unit, arm, model, rep }))));
  return cellOrder(seed, units, all.map((c) => ({ ...c, arm: c.arm + "/" + c.model, key: c }))).map((c) => c.key);
}

/** The paths a stripped B still tracks that Codex would read as instructions. */
export function codexConfigLeft(repo: string): string[] {
  const out: string[] = [];
  const walk = (d: string, rel: string) => {
    for (const n of readdirSync(d)) {
      if (n === ".git") continue;
      const r = rel ? rel + "/" + n : n;
      if (n === ".codex" || n === ".agents" || n === "AGENTS.override.md") out.push(r);
      else if (lstatSync(join(d, n)).isDirectory()) walk(join(d, n), r);
    }
  };
  walk(repo, "");
  return out.sort();
}

export interface E1ReviewRecord extends CellKey {
  outcome: SessionOutcome;
  exposed: boolean | null;
  bundleWords: number;
  truncated: boolean;
  writtenFiles: number;
  binaryLeftOut: number;
  repoEditsDiscarded: number;
  costUsd: number;
}

const readJson = <T>(p: string): T | null => (existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as T) : null);
const writeJson = (p: string, v: unknown) => {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p + ".tmp", JSON.stringify(v, null, 1) + "\n");
  renameSync(p + ".tmp", p);
};
export const reviewRecordPath = (run: string, c: CellKey) => join(run, "e1", "reviews", "records", cellKey(c) + ".json");
export const mountDir = (run: string, c: CellKey) => join(run, "e1", "reviews", "mounts", cellKey(c));
export const buildRecordPath = (run: string, c: CellKey) => join(run, "e1", "builds", "records", cellKey(c) + ".json");

export interface E1Unit {
  unit: PlantedUnit;
  /** B, the unit's base tree. */
  base: string;
  /** The authored plan's path. */
  plan: string;
}

/** One item's review cells under its gate. */
export async function e1Reviews(o: { run: string; cells: readonly CellKey[]; units: Map<string, E1Unit>; session: E1ReviewSession; gate: ItemGate; pCommand?: PCommand; statechartMarker?: string; parallel?: number; log?: (line: string) => void }): Promise<E1ReviewRecord[]> {
  const sessions = join(o.run, "e1", "reviews", "sessions");
  await runGated(o.cells, {
    gate: o.gate,
    parallel: o.parallel,
    kind: () => "review:plain",
    key: cellKey,
    skip: (c) => existsSync(reviewRecordPath(o.run, c)),
    run: async (c) => {
      const u = o.units.get(c.unit) ?? fail("E_USAGE", "no review unit " + c.unit);
      if (c.arm === "P" && !o.statechartMarker) fail("E_USAGE", "P's cells need statechart's marker line from the pinned pstack checkout (arms.ts pMarker)");
      const cell = cellKey(c);
      const base = join(sessions, cell);
      const earlier = Math.max(0, ...(existsSync(base) ? readdirSync(base) : []).map((n) => Number(/^a(\d+)$/.exec(n)?.[1] ?? 0)));
      if (earlier >= 2) fail("E_EB_CELL_INCOMPLETE", "review cell " + cell + ": earlier runs started attempts up to a" + earlier + " and left no record, so its one retry is spent and nothing opens; bring it to the Captain");
      const authored = readFileSync(u.plan, "utf8");
      let spent = 0;
      let rec: E1ReviewRecord;
      let mount: ReturnType<typeof e1Mount> | null;
      try {
        const tries = await oneRetry(
          async (attempt): Promise<Attempt<E1ReviewLeft>> => {
            const dir = join(base, "a" + attempt);
            const seed = join(dir, "seed");
            mkdirSync(seed, { recursive: true });
            cpSync(u.base, join(seed, "repo"), { recursive: true });
            stripBase(join(seed, "repo"));
            const left = codexConfigLeft(join(seed, "repo"));
            if (left.length) fail("E_USAGE", "unit " + c.unit + ": its stripped B still tracks " + left.join(", ") + "; it should have been left out before the draw");
            cpSync(u.plan, join(seed, "plan.md"));
            const a = await o.session({ cell, unit: { id: c.unit, repo: u.base, plan: u.plan }, arm: c.arm, rep: c.rep, attempt, prompt: e1Prompt(c.arm, c.model, o.pCommand), seed, dir });
            spent += a.costUsd;
            return a;
          },
          (a) => a.end === "completed" || a.end === "limit",
          earlier,
        );
        const last = tries.at(-1)!;
        const outcome: SessionOutcome = last.end === "upstream" ? "upstream_gap" : last.end === "infra" ? "infra_gap" : last.end;
        const gap = outcome === "upstream_gap" || outcome === "infra_gap";
        if (gap) o.log?.("E_EB_GAP " + cell + ": " + outcome + " after 1 retry; the cell is a recorded gap and its build is not run");
        const l = last.result;
        mount = gap ? null : e1Mount(c.arm, { plan: l.plan, transcript: l.transcript, stateRoot: l.stateRoot, written: l.written.files }, authored);
        const exposed = gap ? null : exposure({ arm: c.arm, authored, final: l.plan, transcript: l.transcript, stateRoot: l.stateRoot, ...(o.statechartMarker ? { statechartMarker: o.statechartMarker } : {}) });
        rec = { ...c, outcome, exposed, bundleWords: mount?.words ?? 0, truncated: mount?.truncated ?? false, writtenFiles: gap ? 0 : l.written.files.length, binaryLeftOut: gap ? 0 : l.written.binary + l.written.large, repoEditsDiscarded: gap ? 0 : l.repoEdits, costUsd: spent };
      } catch (e) {
        throw addSpend(e, spent);
      }
      return {
        costUsd: spent,
        commit: () => {
          if (mount) writeMount(mountDir(o.run, c), mount);
          writeJson(reviewRecordPath(o.run, c), rec);
        },
      };
    },
  });
  return o.cells.map((c) => readJson<E1ReviewRecord>(reviewRecordPath(o.run, c))).filter((r): r is E1ReviewRecord => r !== null);
}

export interface E1Build extends CellKey {
  outcome: SessionOutcome;
  limitStop: boolean;
  planted: CaseRuns[];
  functional: CaseRuns[];
  catch: boolean | null;
  catchDrop: string | null;
  readReview: boolean | null;
  testLinesAdded: number;
  costUsd: number;
}

/** The build prompt every reviewed cell gets (attempt 3's reviewed arms), then the statement note. */
export const e1BuildPrompt = (note: string) => [BUILD_LINE + " " + REVIEW_LINE, ...(note.trim() ? [note.trim()] : [])].join("\n\n");

/** One item's build cells under its gate: each needs its review record; a review gap is a gap with no session. */
export async function e1Builds(o: { run: string; cells: readonly CellKey[]; units: Map<string, E1Unit & { dir: string; note: string }>; session: PlantedSession; grader: PlantedGrader; gate: ItemGate; parallel?: number; earlier?: (cell: string) => number; log?: (line: string) => void }): Promise<E1Build[]> {
  await runGated(o.cells, {
    gate: o.gate,
    parallel: o.parallel,
    kind: () => "build",
    key: cellKey,
    skip: (c) => existsSync(buildRecordPath(o.run, c)),
    run: async (c) => {
      const cell = cellKey(c);
      const u = o.units.get(c.unit) ?? fail("E_USAGE", "no build unit " + c.unit);
      const r = readJson<E1ReviewRecord>(reviewRecordPath(o.run, c)) ?? fail("E_USAGE", "cell " + cell + ": its review record is missing, so nothing is built; run the review stage for this cell first");
      const meta = { unit: c.unit, arm: c.arm, model: c.model, rep: c.rep };
      const gap = (outcome: SessionOutcome, costUsd: number): E1Build => ({ ...meta, outcome, limitStop: false, planted: [], functional: [], catch: null, catchDrop: "gap", readReview: null, testLinesAdded: 0, costUsd });
      if (isGap(r)) {
        o.log?.("E_EB_GAP cell " + cell + ": its review ended " + r.outcome + ", so the build is not run; recorded as a gap");
        const b = gap(r.outcome, 0);
        return { costUsd: 0, commit: () => writeJson(buildRecordPath(o.run, c), b) };
      }
      const m = mountDir(o.run, c);
      if (!existsSync(join(m, "plan.md"))) fail("E_USAGE", "cell " + cell + ": its review mount is missing under " + m);
      const marker = join(o.run, "e1", "builds", "markers", cell);
      if (existsSync(marker)) fail("E_EB_CELL_INCOMPLETE", "cell " + cell + ": its grader failed after a completed session (" + readFileSync(marker, "utf8").trim() + "), so no retry opens; bring it to the Captain");
      const earlier = o.earlier?.(cell) ?? 0;
      if (earlier >= 2) fail("E_EB_CELL_INCOMPLETE", "cell " + cell + ": earlier leases opened it " + earlier + " times and left no record, so its one retry is spent and nothing opens; bring it to the Captain");
      let cost = 0;
      let tree: string | null = null;
      let b: E1Build;
      try {
        const ends = await oneRetry(
          async (attempt) => {
            const s = await o.session({ cell, unit: u.unit, arm: "plain", prompt: e1BuildPrompt(u.note), plan: join(m, "plan.md"), review: join(m, "review"), attempt });
            cost += s.costUsd;
            tree = s.tree;
            return s.outcome;
          },
          (x) => x === "completed" || x === "limit",
          earlier,
        );
        const outcome = ends.at(-1)!;
        if (outcome === "upstream_gap" || outcome === "infra_gap") {
          o.log?.("E_EB_GAP cell " + cell + ": " + outcome + " after 1 retry; recorded as a gap");
          b = gap(outcome, cost);
        } else {
          const t: string = tree ?? fail("E_USAGE", "cell " + cell + ": the session ended " + outcome + " but left no tree to grade");
          try {
            const g = await o.grader.grade(u.unit, u.dir, t);
            const k = await o.grader.catchOf(u.unit, u.dir, t);
            const file = (n: string) => (lstatSync(join(t, n), { throwIfNoEntry: false })?.isFile() ? readFileSync(join(t, n), "utf8") : "");
            b = { ...meta, outcome, limitStop: outcome === "limit", planted: g.planted, functional: g.functional, catch: k.catch, catchDrop: k.drop, readReview: readReview(file("sdk-messages.jsonl")), testLinesAdded: testLinesAdded(file("final.patch")), costUsd: cost };
          } catch (e) {
            const line = String(e instanceof Error ? e.message : e).split("\n")[0]!;
            mkdirSync(dirname(marker), { recursive: true });
            writeFileSync(marker, line + "\n", { flag: "wx" });
            return fail("E_EB_CELL_INCOMPLETE", "cell " + cell + ": its grader failed after a completed session (" + line + "); its marker holds that line, so no retry opens; bring it to the Captain");
          }
        }
      } catch (e) {
        throw addSpend(e, cost);
      }
      return { costUsd: cost, commit: () => writeJson(buildRecordPath(o.run, c), b) };
    },
  });
  return o.cells.map((c) => readJson<E1Build>(buildRecordPath(o.run, c))).filter((r): r is E1Build => r !== null);
}

/** The scored cells the readings take: each build's composite (null for a gap), with its review's exposure and repository. */
export function scoredCells(run: string, cells: readonly CellKey[], units: Map<string, { unit: PlantedUnit; repo: string }>, unrun: ReadonlySet<string> = new Set()): Cell[] {
  const out: Cell[] = [];
  for (const c of cells) {
    const u = units.get(c.unit) ?? fail("E_USAGE", "no unit " + c.unit);
    if (unrun.has(cellKey(c))) {
      out.push({ unit: c.unit, repo: u.repo, arm: c.arm, model: c.model, rep: c.rep, composite: null, exposed: null, unrun: true });
      continue;
    }
    const r = readJson<E1ReviewRecord>(reviewRecordPath(run, c));
    const b = readJson<E1Build>(buildRecordPath(run, c));
    if (!r || !b) continue;
    const composite = isGap(b) ? null : score({ ...b, arm: "plain", reviewer: c.model, pilot: false, coverage: null }, u.unit, "composite");
    out.push({ unit: c.unit, repo: u.repo, arm: c.arm, model: c.model, rep: c.rep, composite, exposed: isGap(r) ? null : r.exposed });
  }
  return out;
}
