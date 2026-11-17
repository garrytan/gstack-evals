// Copyright (c) 2026 Garry Tan. MIT License.
// The planted-unit read's paid stages in section 14's order (prereg 2026-11-15-geva-537): authoring (batch 1, then
// batch 2 after admission), the exposure smoke, the pilot's plain reviews and builds, the comparison reviews and builds,
// and the stock builds. Each stage runs under one lease on its item (the launcher opens and settles it) and each session
// passes its item's gate (ledger.ts). A stage refuses to start while a step it needs has no passing record in
// <run>/steps (local.ts). Every session and model call goes through a seam, so the tests drive this code with stubs.
//
// Run folder (outside the repository; held-out material, sealed with the run):
//   draw.json                 the seed (minted from random bytes, recorded before any draw) and the seeded order
//   draw-batch1.json, -2      each batch's draw
//   author/<unit>/            calls.json, plan.md, hint.txt and hinted.json
//   reviews/<smoke|comparison>/records, mounts, sessions, stops
//   builds/<authoring|comparison|stock>/cells
//   costs/<item>.jsonl        every settled session's cost (the gate's journal); state/<item>.json for the projection
//   openings/<unit>/          the eng phase opening rendered at the pin
//   lost.json                 comparison units lost to infrastructure
//   steps/<step>.json         section 14's step records
// Choices where the plan is silent: cells run in units' draw order, each unit's cells in a seeded order (sha256 of
// "<seed>/<unit>/<arm>/<rep>"); the pilot's plain reviews and builds are the comparison item's first cells and count in
// the plain cells; the interim exposure stop counts an arm's records in that order, stopping at its first unrecorded
// cell.
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stripBase } from "../../eng-build/build-stage.ts";
import { prepareReviewTree, type Attempt } from "../../eng-build/review-stage.ts";
import { addSpend } from "../../eng-build/spend.ts";
import type { ReviewLeft, ReviewSession, ReviewUnit } from "../../eng-build/pipeline.ts";
import { erExposure } from "../../eng-review/exposure.ts";
import type { DigestPin } from "../../../src/trial/review/eng-review.ts";
import { fail } from "../errors.ts";
import { FROZEN, SIZE } from "../frozen.ts";
import type { BuildArm, GradedBuild, PlantedGrader, PlantedUnit, ReviewArm, ReviewRecord, Reviewer, SessionOutcome, SkillArm } from "../types.ts";
import { DETECTOR, EB_ARM, isSkillArm, plantedOpening, plantedPrompt, plantedStopHook, SKILL_ARMS, type Opening } from "./arms.ts";
import { authorCalls, BATCH_1, BATCH_2, drawSets, hintedVerdict, mintSeed, replaceLost, seededOrder, supplyLine, unforeseeable, type AuthorCall, type AuthorMaterial, type Authored, type Candidate, type CallsRecord, type Draw, type HintedVerdict, type Want } from "./author.ts";
import { buildKey, hasReview, isReviewed, oneRetry, readMount, reviewMount, runPlantedBuild, stockMount, writeMount, type PlantedSession } from "./build.ts";
import { runGated, settleThrown, type ItemGate, type Kind } from "./ledger.ts";
import { readStep, requireSteps, writeStep, type Step } from "./local.ts";

const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
const writeJson = (path: string, v: unknown) => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path + ".tmp", JSON.stringify(v, null, 1) + "\n");
  renameSync(path + ".tmp", path);
};
const readJson = <T>(path: string): T | null => (existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : null);

// ---------------------------------------------------------------------------------------------------------------------
// Units.

/** What the stages read for one unit, from the construct part's folders. */
export interface UnitSource {
  /** Every qualified unit, in any order; the draw orders them. */
  units(): PlantedUnit[];
  /** The unit's folder: eb.json, its image, hidden tests (never mounted to a session). */
  dir(id: string): string;
  /** B: the one-commit base tree the review mounts at /work/repo and the build starts from. */
  base(id: string): string;
  material(id: string): AuthorMaterial;
  /** The keyless signature note (section 2 rule 4) the build prompt ends with. */
  note(id: string): string;
}

/** The construct part's layout: <units>/<id>/ holds ep-unit.json (PlantedUnit), ep-author.json (AuthorMaterial) and
 * ep-note.md beside eb.json; <repos>/<id>/ is B. */
export function unitFolders(units: string, repos: string): UnitSource {
  let read: PlantedUnit[] | null = null;
  return {
    units: () => (read ??= readdirSync(units).filter((d) => existsSync(join(units, d, "ep-unit.json"))).sort().map((d) => JSON.parse(readFileSync(join(units, d, "ep-unit.json"), "utf8")) as PlantedUnit)),
    dir: (id) => join(units, id),
    base: (id) => join(repos, id),
    material: (id) => JSON.parse(readFileSync(join(units, id, "ep-author.json"), "utf8")) as AuthorMaterial,
    note: (id) => (existsSync(join(units, id, "ep-note.md")) ? readFileSync(join(units, id, "ep-note.md"), "utf8") : ""),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// The draw.

export interface DrawFile {
  seed: string;
  order: Candidate[];
}

/** The run's seed and seeded order: written once, before the first draw, then only read. */
export function drawFile(run: string, src: UnitSource, seed: string = mintSeed()): DrawFile {
  const file = join(run, "draw.json");
  const found = readJson<DrawFile>(file);
  if (found) return found;
  const d: DrawFile = { seed, order: seededOrder(src.units().map((u) => ({ id: u.id, repo: u.repo })), seed) };
  writeJson(file, d);
  return d;
}

const authorDir = (run: string, id: string) => join(run, "author", id);

/** Each unit's authoring outcome as the draw reads it; a unit whose calls passed but has no hinted build has none yet. */
export function authoredMap(run: string, order: readonly Candidate[]): Map<string, Authored> {
  const out = new Map<string, Authored>();
  for (const c of order) {
    const calls = readJson<CallsRecord>(join(authorDir(run, c.id), "calls.json"));
    if (!calls) continue;
    if (calls.drop) {
      out.set(c.id, { admitted: false, reason: calls.drop, unforeseeable: false });
      continue;
    }
    const hinted = readJson<HintedVerdict>(join(authorDir(run, c.id), "hinted.json"));
    if (!hinted) continue;
    out.set(c.id, { admitted: hinted.drop === null, reason: hinted.drop, unforeseeable: unforeseeable(calls.foresee) });
  }
  return out;
}

export const wantOf = (batch: 1 | 2): Want => (batch === 1 ? BATCH_1 : BATCH_2);
export const batchDraw = (run: string, batch: 1 | 2): Draw | null => readJson<Draw>(join(run, "draw-batch" + batch + ".json"));

/** The comparison units after reserve swaps for units lost to infrastructure (<run>/lost.json). */
export function comparisonUnits(run: string): { units: string[]; pilot: string[]; swaps: Array<{ lost: string; reason: string; by: string }> } {
  const d = batchDraw(run, 2) ?? fail("E_USAGE", "no batch 2 draw in " + run + "; run ep author --batch 2 first");
  const lost = readJson<Array<{ id: string; reason: string }>>(join(run, "lost.json")) ?? [];
  const r = replaceLost(d, lost);
  return { units: r.comparison, pilot: d.pilot.filter((p) => r.comparison.includes(p)), swaps: r.swaps };
}

/** The unit with its set and pilot flag from the draw. */
/** The unit as the readings take it: its set and pilot flag from the latest draw (a reserve unit that replaced a lost
 * one serves the comparison), and its two ratings and hinted outcome from authoring. */
export function drawnUnit(src: UnitSource, run: string, id: string): PlantedUnit {
  const u = src.units().find((x) => x.id === id) ?? fail("E_USAGE", "unit " + id + " is not in the units folder");
  const d2 = batchDraw(run, 2);
  const d = d2 ?? batchDraw(run, 1);
  const swapped = d2 !== null && d2.reserve.includes(id) && comparisonUnits(run).units.includes(id);
  const set = d?.calibration.includes(id) ? "calibration" : d?.reserve.includes(id) && !swapped ? "reserve" : "comparison";
  const calls = readJson<CallsRecord>(join(authorDir(run, id), "calls.json"));
  const hinted = readJson<HintedVerdict>(join(authorDir(run, id), "hinted.json"));
  return { ...u, set, pilot: (d?.pilot ?? []).includes(id), foresee: calls?.foresee ?? null, winnable: hinted?.winnable ?? null };
}

// ---------------------------------------------------------------------------------------------------------------------
// Authoring.

/** A model call that waits for its item's gate and settles its cost there. A call that spent and threw settles as a
 * failed line (spend.ts). */
export function gatedCall(gate: ItemGate, call: AuthorCall, unit: string): AuthorCall {
  return async (role, prompt, attempt) => {
    await gate.acquire("call");
    let r: { text: string; costUsd: number };
    try {
      r = await call(role, prompt, attempt);
    } catch (e) {
      throw settleThrown(gate, "call", e, unit + ":" + role);
    }
    gate.settle("call", r.costUsd, unit + ":" + role);
    return r;
  };
}

/** The next units to author in seeded order: from where the draw stopped, those with no authoring record yet. */
export function nextToAuthor(run: string, order: readonly Candidate[], d: Draw, chunk: number): string[] {
  if (d.next === null) return [];
  const from = order.findIndex((c) => c.id === d.next);
  return order.slice(from).filter((c) => !existsSync(join(authorDir(run, c.id), "calls.json"))).slice(0, chunk).map((c) => c.id);
}

/** Units whose authoring calls passed and that have no hinted build yet, in seeded order. */
export const hintedTodo = (run: string, order: readonly Candidate[]): string[] => order.filter((c) => readJson<CallsRecord>(join(authorDir(run, c.id), "calls.json"))?.drop === null && !existsSync(join(authorDir(run, c.id), "hinted.json"))).map((c) => c.id);

const missing = (want: Want, d: Draw) => Math.max(0, want.calibration - d.calibration.length) + Math.max(0, want.comparison - d.comparison.length) + Math.max(0, want.reserve - d.reserve.length);

export type AuthorStep = "calls" | "hinted" | "draw" | "none";

/**
 * One authoring step for a batch. calls: plan, audits, hint and ratings for the next chunk in seeded order (default:
 * one and a half times the units the draw still needs); first names units of that chunk to start ahead of the rest,
 * and never adds a unit to it. hinted: the hinted build for every unit whose calls passed.
 * draw: the batch's draw from the outcomes so far. none: the no-review build for every drawn unit, then the batch's step
 * record once its draw is filled (or the order ran out at or above the floor).
 */
export async function authorStep(o: { run: string; src: UnitSource; batch: 1 | 2; step: AuthorStep; seed?: string; chunk?: number; first?: readonly string[]; call?: AuthorCall; session?: PlantedSession; grader?: PlantedGrader; gate?: ItemGate; parallel?: number; earlier?: (cell: string) => number; log?: (line: string) => void }): Promise<{ draw: Draw; line: string }> {
  const log = o.log ?? (() => {});
  if (o.batch === 2) requireSteps(o.run, "authoring batch 2", ["author-batch1", "exposure-gate", "admission", "start-rule"]);
  const df = drawFile(o.run, o.src, o.seed);
  const want = wantOf(o.batch);
  const draw = () => drawSets(df.order, authoredMap(o.run, df.order), want);
  if (o.step === "calls") {
    const gate = o.gate ?? fail("E_USAGE", "the calls step runs under the authoring item's gate");
    const call = o.call ?? fail("E_USAGE", "the calls step needs its model calls");
    const d = draw();
    const chunk = nextToAuthor(o.run, df.order, d, o.chunk ?? Math.max(1, Math.ceil(1.5 * missing(want, d))));
    const lead = o.first ?? [];
    const outside = lead.filter((id) => !chunk.includes(id));
    if (outside.length) fail("E_USAGE", "--first orders the chunk and never adds to it: " + outside.join(", ") + " is not among the next " + chunk.length + " units to author");
    const ids = [...lead, ...chunk.filter((id) => !lead.includes(id))];
    let first: unknown = null;
    let next = 0;
    const worker = async () => {
      while (first === null && next < ids.length) {
        const id = ids[next++]!;
        try {
          const r = await authorCalls(o.src.material(id), gatedCall(gate, call, id));
          const dir = authorDir(o.run, id);
          mkdirSync(dir, { recursive: true });
          if (r.plan !== null) writeFileSync(join(dir, "plan.md"), r.plan + "\n");
          if (r.hint !== null) writeFileSync(join(dir, "hint.txt"), r.hint + "\n");
          writeJson(join(dir, "calls.json"), r.record);
          log("author " + id + ": " + (r.record.drop ? "dropped (" + r.record.drop + ")" : "plan, hint and ratings " + r.record.foresee!.join(", ")) + ", $" + r.record.costUsd.toFixed(2));
        } catch (e) {
          first ??= e;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, o.parallel ?? 1) }, worker));
    if (first !== null) throw first;
  }
  if (o.step === "hinted") {
    const gate = o.gate ?? fail("E_USAGE", "the hinted step runs under the authoring item's gate");
    await runAuthoringBuilds({ ...o, gate, arm: "hinted", ids: hintedTodo(o.run, df.order), log });
  }
  const d = draw();
  writeJson(join(o.run, "draw-batch" + o.batch + ".json"), d);
  const line = supplyLine(d, want);
  if (o.step === "none") {
    const gate = o.gate ?? fail("E_USAGE", "the no-review step runs under the authoring item's gate");
    if (!d.filled && !d.exhausted) fail("E_USAGE", "batch " + o.batch + "'s draw is still open (" + line + "); run the calls and hinted steps on the next chunk first");
    const drawn = [...d.calibration, ...d.comparison, ...d.reserve];
    await runAuthoringBuilds({ ...o, gate, arm: "none", ids: drawn.filter((id) => !existsSync(join(o.run, "builds", "authoring", "cells", buildKey(id, "none", null, 1) + ".json"))), log });
    writeStep(o.run, { step: o.batch === 1 ? "author-batch1" : "author-batch2", ok: true, detail: line });
  }
  return { draw: d, line };
}

async function runAuthoringBuilds(o: { run: string; src: UnitSource; arm: "hinted" | "none"; ids: string[]; session?: PlantedSession; grader?: PlantedGrader; gate: ItemGate; parallel?: number; earlier?: (cell: string) => number; log: (line: string) => void }): Promise<void> {
  const session = o.session ?? fail("E_USAGE", "the " + o.arm + " builds need their session");
  const grader = o.grader ?? fail("E_USAGE", "the " + o.arm + " builds need the grader");
  const cells = join(o.run, "builds", "authoring", "cells");
  const verdict = (id: string, b: GradedBuild) => {
    const v = hintedVerdict(b.outcome, b.planted);
    writeJson(join(authorDir(o.run, id), "hinted.json"), { ...v, costUsd: b.costUsd });
    o.log("hinted " + id + ": " + (v.drop ? "dropped (" + v.drop + ")" : "winnable") + ", passing runs per planted case " + Object.values(v.passes).join(", "));
  };
  const saved = o.arm === "hinted" ? o.ids.filter((id) => loadBuild(cells, buildKey(id, "hinted", null, 1)) !== null) : [];
  for (const id of saved) {
    if (existsSync(join(authorDir(o.run, id), "hinted.refused-gap.json"))) fail("E_USAGE", "hinted " + id + ": ep owed stopped halfway while setting this cell aside (hinted.refused-gap.json is there and the record is not set aside); run ep owed --run again first");
    o.log("hinted " + id + ": its record was saved before its verdict, so the verdict comes from that record and no session opens");
    verdict(id, loadBuild(cells, buildKey(id, "hinted", null, 1))!);
  }
  await runGated(o.ids.filter((id) => !saved.includes(id)), {
    gate: o.gate,
    parallel: o.parallel,
    kind: () => "build",
    key: (id) => buildKey(id, o.arm, null, 1),
    run: async (id) => {
      const dir = authorDir(o.run, id);
      const hint = o.arm === "hinted" ? readFileSync(join(dir, "hint.txt"), "utf8").trim() : null;
      const b = await runPlantedBuild({ unit: drawnUnit(o.src, o.run, id), unitDir: o.src.dir(id), arm: o.arm, reviewer: null, rep: 1, note: o.src.note(id), hint, mount: { plan: join(dir, "plan.md"), review: null }, session, grader, earlier: o.earlier?.(buildKey(id, o.arm, null, 1)), marker: join(cells, buildKey(id, o.arm, null, 1) + ".grade-error"), log: o.log });
      return {
        costUsd: b.costUsd,
        commit: () => {
          saveBuild(cells, b);
          if (o.arm === "hinted") verdict(id, b);
        },
      };
    },
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Records.

/** Writes a graded build with its digest, each through a rename. */
export function saveBuild(dir: string, b: GradedBuild): string {
  mkdirSync(dir, { recursive: true });
  const key = buildKey(b.unit, b.arm, b.reviewer, b.rep);
  const text = JSON.stringify(b);
  writeFileSync(join(dir, key + ".sha256.tmp"), sha(text) + "\n");
  renameSync(join(dir, key + ".sha256.tmp"), join(dir, key + ".sha256"));
  writeFileSync(join(dir, key + ".json.tmp"), text);
  renameSync(join(dir, key + ".json.tmp"), join(dir, key + ".json"));
  return key;
}

/** Reads a graded build, or null; one whose bytes no longer match its digest stops with E_EB_CACHE_STALE. */
export function loadBuild(dir: string, key: string): GradedBuild | null {
  const file = join(dir, key + ".json");
  if (!existsSync(file)) return null;
  const text = readFileSync(file, "utf8");
  const want = existsSync(join(dir, key + ".sha256")) ? readFileSync(join(dir, key + ".sha256"), "utf8").trim() : "(none)";
  if (sha(text) !== want) fail("E_EB_CACHE_STALE", "build " + key + ": expected digest " + want + ", found " + sha(text) + "; nothing is scored from it, rebuild it from its sealed source and --resume");
  return JSON.parse(text) as GradedBuild;
}

// ---------------------------------------------------------------------------------------------------------------------
// Reviews.

export interface ReviewCell {
  unit: string;
  arm: ReviewArm;
  rep: number;
}

/** Each unit's cells in draw order, a unit's own cells in the seeded order. */
export function cellOrder<T extends { unit: string; arm: string; rep: number }>(seed: string, units: readonly string[], cells: readonly T[]): T[] {
  const k = (c: T) => sha(seed + "/" + c.unit + "/" + c.arm + "/" + c.rep);
  return units.flatMap((u) => cells.filter((c) => c.unit === u).sort((a, b) => (k(a) < k(b) ? -1 : 1)));
}

export const reviewKey = (unit: string, arm: ReviewArm, reviewer: Reviewer, rep: number) => buildKey(unit, arm, reviewer, rep);

/** The interim exposure stop (section 6): the arm's first 24 non-gap comparison sessions in run order, counted only
 * once every earlier cell of the arm is recorded; under 0.70 exposed stops the arm. Returns the stop line, or null. */
export function interimStop(arm: SkillArm, ordered: ReadonlyArray<ReviewRecord | null>): string | null {
  const I = FROZEN.exposure.interim;
  const firsts: ReviewRecord[] = [];
  for (const r of ordered) {
    if (r === null) break;
    if (r.exposed === null) continue;
    firsts.push(r);
    if (firsts.length === I.after) break;
  }
  if (firsts.length < I.after) return null;
  const share = firsts.filter((r) => r.exposed).length / I.after;
  return share < I.min ? "E_EP_EXPOSURE_STOP arm " + arm + ": " + firsts.filter((r) => r.exposed).length + " of its first " + I.after + " non-gap sessions exposed (" + share.toFixed(3) + "), under " + I.min.toFixed(2) + "; the arm stops and reads untested, the other arms go on" : null;
}

/**
 * Runs review cells through the item's gate. A cell with a record is kept. Each attempt gets a fresh seed folder (B
 * stripped, one commit, and the authored plan); a finished session's mount (reviewMount) is written to mounts/<key>
 * before its record. A throw after any attempt spent (a launcher's cap stop, the mount or the exposure reading failing)
 * carries every attempt's spend (spend.ts), which runGated settles. With interim on, a skill arm's exposure stop is written to stops/<arm>.json and its later cells are
 * left out, now and on a resume.
 */
export async function runPlantedReviews(o: { cells: ReviewCell[]; units: Map<string, { unit: PlantedUnit; base: string; plan: string; opening: Opening | null }>; reviewer: Reviewer; out: string; session: ReviewSession; gate: ItemGate; interim: boolean; parallel?: number; log?: (line: string) => void }): Promise<ReviewRecord[]> {
  const records = join(o.out, "records");
  mkdirSync(records, { recursive: true });
  const key = (c: ReviewCell) => reviewKey(c.unit, c.arm, o.reviewer, c.rep);
  const read = (c: ReviewCell) => readJson<ReviewRecord>(join(records, key(c) + ".json"));
  const stopFile = (arm: ReviewArm) => join(o.out, "stops", arm + ".json");
  const stopped = (arm: ReviewArm) => existsSync(stopFile(arm));
  for (const arm of new Set(o.cells.map((c) => c.arm))) if (stopped(arm)) o.log?.(readJson<{ line: string }>(stopFile(arm))!.line);
  const check = (arm: ReviewArm) => {
    if (!o.interim || !isSkillArm(arm) || stopped(arm)) return;
    const line = interimStop(arm, o.cells.filter((c) => c.arm === arm).map(read));
    if (!line) return;
    writeJson(stopFile(arm), { arm, line });
    o.log?.(line);
  };
  await runGated(o.cells, {
    gate: o.gate,
    parallel: o.parallel,
    kind: (c) => ("review:" + c.arm) as Kind,
    key,
    skip: (c) => existsSync(join(records, key(c) + ".json")) || stopped(c.arm),
    run: async (c) => {
      const u = o.units.get(c.unit) ?? fail("E_USAGE", "no review unit " + c.unit);
      if (c.arm === "engphase" && !u.opening) fail("E_USAGE", "unit " + c.unit + " has no eng phase opening rendered at the pin");
      const cell = key(c);
      const ru: ReviewUnit = { id: c.unit, repo: u.base, plan: u.plan, opening: c.arm === "engphase" ? u.opening : null };
      const prompt = plantedPrompt(c.arm, u.opening?.text ?? null);
      const base = join(o.out, "sessions", cell);
      let spent = 0;
      let rec: ReviewRecord;
      let mount: ReturnType<typeof reviewMount> | null;
      try {
        const tries = await oneRetry(async (attempt): Promise<Attempt<ReviewLeft>> => {
          const dir = join(base, "a" + attempt);
          rmSync(dir, { recursive: true, force: true });
          const seed = join(dir, "seed");
          mkdirSync(seed, { recursive: true });
          cpSync(u.base, join(seed, "repo"), { recursive: true });
          stripBase(join(seed, "repo"));
          prepareReviewTree(join(seed, "repo"));
          cpSync(u.plan, join(seed, "plan.md"));
          const a = await o.session({ cell, unit: ru, arm: EB_ARM[c.arm], reviewer: o.reviewer, rep: c.rep, attempt, prompt, seed, dir, hook: (evidence) => plantedStopHook(c.arm, evidence) });
          spent += a.costUsd;
          return a;
        }, (a) => a.end === "completed" || a.end === "limit");
        const last = tries.at(-1)!;
        const outcome: SessionOutcome = last.end === "upstream" ? "upstream_gap" : last.end === "infra" ? "infra_gap" : last.end;
        const gap = outcome === "upstream_gap" || outcome === "infra_gap";
        if (gap) o.log?.("E_EB_GAP " + cell + ": " + outcome + " after 1 retry; the cell is a recorded gap and its build is not run");
        const left = last.result;
        mount = gap ? null : reviewMount(c.arm, left.outputs, readFileSync(u.plan, "utf8"));
        const exposed = isSkillArm(c.arm) && !gap ? erExposure(DETECTOR[c.arm], { transcript: left.outputs.transcript, stateRoot: left.outputs.stateRoot, coverage: left.outputs.coverage, opening: c.arm === "engphase" && u.opening ? { methodology: u.opening.methodology, readRanges: u.opening.readRanges } : null }).exposed : null;
        rec = { unit: c.unit, arm: c.arm, reviewer: o.reviewer, rep: c.rep, outcome, exposed, exposedBeforeBlock: exposed === null ? null : exposed && left.blocks === 0, blocks: left.blocks, bundleWords: mount?.words ?? 0, truncated: mount?.truncated ?? false, repoEditsDiscarded: gap ? 0 : left.repoEdits, costUsd: spent };
      } catch (e) {
        throw addSpend(e, spent);
      }
      return {
        costUsd: spent,
        commit: () => {
          if (mount) writeMount(join(o.out, "mounts", cell), mount);
          writeJson(join(records, cell + ".json"), rec);
          check(c.arm);
        },
      };
    },
  });
  return o.cells.map(read).filter((r): r is ReviewRecord => r !== null);
}

// ---------------------------------------------------------------------------------------------------------------------
// The stages.

export interface StageIo {
  run: string;
  src: UnitSource;
  gate: ItemGate;
  parallel?: number;
  log?: (line: string) => void;
}

/** The review units for a set of unit ids: B, the authored plan, and the eng phase opening when the arms need it. */
function reviewUnits(o: StageIo & { ids: string[]; arms: readonly ReviewArm[]; gstack?: string; pin?: DigestPin }): Map<string, { unit: PlantedUnit; base: string; plan: string; opening: Opening | null }> {
  const out = new Map<string, { unit: PlantedUnit; base: string; plan: string; opening: Opening | null }>();
  for (const id of o.ids) {
    const plan = join(authorDir(o.run, id), "plan.md");
    if (!existsSync(plan)) fail("E_USAGE", "unit " + id + " has no authored plan in " + plan);
    let opening: Opening | null = null;
    if (o.arms.includes("engphase")) {
      const gstack = o.gstack ?? fail("E_USAGE", "the eng phase arm renders its opening from a gstack checkout at the pin; pass --gstack");
      const pin = o.pin ?? fail("E_USAGE", "the eng phase arm needs the skill arms' pin");
      const saved = join(o.run, "openings", id + ".json");
      opening = readJson<Opening>(saved);
      if (opening === null || opening.mounts.some((m) => !existsSync(m.host))) {
        rmSync(join(o.run, "openings", id), { recursive: true, force: true });
        opening = plantedOpening({ gstack, plan: readFileSync(plan, "utf8"), out: join(o.run, "openings", id), pin });
        writeJson(saved, opening);
      }
    }
    out.set(id, { unit: drawnUnit(o.src, o.run, id), base: o.src.base(id), plan, opening });
  }
  return out;
}

/** The exposure smoke (section 6): one Opus session per skill arm on each calibration unit, with the Stop hook. */
export async function smokeStage(o: StageIo & { session: ReviewSession; gstack: string; pin: DigestPin }): Promise<ReviewRecord[]> {
  requireSteps(o.run, "the exposure smoke", ["author-batch1"]);
  const df = readJson<DrawFile>(join(o.run, "draw.json"))!;
  const ids = batchDraw(o.run, 1)!.calibration;
  const cells = cellOrder(df.seed, ids, ids.flatMap((unit) => SKILL_ARMS.map((arm): ReviewCell => ({ unit, arm, rep: 1 }))));
  const recs = await runPlantedReviews({ cells, units: reviewUnits({ ...o, ids, arms: SKILL_ARMS }), reviewer: "opus", out: join(o.run, "reviews", "smoke"), session: o.session, gate: o.gate, interim: false, parallel: o.parallel, log: o.log });
  if (recs.length === cells.length) {
    o.gate.finish();
    writeStep(o.run, { step: "smoke", ok: true, detail: SKILL_ARMS.map((a) => a + " " + recs.filter((r) => r.arm === a && r.exposed).length + " of " + recs.filter((r) => r.arm === a).length + " exposed").join(", ") });
  }
  return recs;
}

/** The skill arms the exposure gate passed, from the readings part's step record. */
export function gateArms(run: string): SkillArm[] {
  const r = readStep(run, "exposure-gate");
  return (r?.arms ?? []).filter((a): a is SkillArm => (SKILL_ARMS as readonly string[]).includes(a));
}

/** The comparison item's planned sessions for n units and the arms that run. */
export function comparisonPlanned(n: number, arms: readonly SkillArm[]): Partial<Record<Kind, number>> {
  const k = SIZE.k;
  return { "review:plain": n * k, "review:engphase": arms.includes("engphase") ? n * k : 0, "review:standalone": arms.includes("standalone") ? n * k : 0, build: n * k * (1 + arms.length) };
}

/** The comparison item's review cells for a phase: the pilot's plain cells, or every comparison cell. */
export function reviewCells(run: string, phase: "pilot" | "comparison"): ReviewCell[] {
  const df = readJson<DrawFile>(join(run, "draw.json")) ?? fail("E_USAGE", "no draw in " + run);
  if (phase === "pilot") {
    const ids = batchDraw(run, 1)?.pilot ?? fail("E_USAGE", "no batch 1 draw in " + run);
    return cellOrder(df.seed, ids, ids.flatMap((unit) => Array.from({ length: SIZE.pilotK }, (_, i): ReviewCell => ({ unit, arm: "plain", rep: i + 1 }))));
  }
  const ids = comparisonUnits(run).units;
  const arms: ReviewArm[] = ["plain", ...gateArms(run)];
  return cellOrder(df.seed, ids, ids.flatMap((unit) => arms.flatMap((arm) => Array.from({ length: SIZE.k }, (_, i): ReviewCell => ({ unit, arm, rep: i + 1 })))));
}

/** The pilot's or the comparison's reviews on the comparison item. */
export async function reviewsStage(o: StageIo & { phase: "pilot" | "comparison"; session: ReviewSession; gstack?: string; pin?: DigestPin }): Promise<ReviewRecord[]> {
  if (o.phase === "pilot") requireSteps(o.run, "the pilot's reviews", ["author-batch1", "smoke"]);
  else {
    requireSteps(o.run, "the comparison reviews", ["author-batch2", "exposure-gate", "pilot-builds", "admission", "start-rule"]);
    if (gateArms(o.run).length === 0) fail("E_USAGE", "no Opus skill arm passed the exposure gate, so the comparison does not start (section 14 line 4)");
  }
  const cells = reviewCells(o.run, o.phase);
  const ids = [...new Set(cells.map((c) => c.unit))];
  const arms = [...new Set(cells.map((c) => c.arm))];
  const recs = await runPlantedReviews({ cells, units: reviewUnits({ ...o, ids, arms }), reviewer: "opus", out: join(o.run, "reviews", "comparison"), session: o.session, gate: o.gate, interim: o.phase === "comparison", parallel: o.parallel, log: o.log });
  const stoppedArms = arms.filter((a) => existsSync(join(o.run, "reviews", "comparison", "stops", a + ".json")));
  const open = cells.filter((c) => !stoppedArms.includes(c.arm) && !recs.some((r) => r.unit === c.unit && r.arm === c.arm && r.rep === c.rep));
  if (open.length === 0) writeStep(o.run, { step: o.phase === "pilot" ? "pilot-reviews" : "comparison-reviews", ok: true, detail: recs.length + " reviews recorded" + (stoppedArms.length ? "; stopped arms " + stoppedArms.join(", ") : "") });
  return recs;
}

export interface BuildCell {
  unit: string;
  arm: BuildArm;
  reviewer: Reviewer | null;
  rep: number;
}

/** A phase's build cells: one stock build per comparison unit, or one build per recorded review (an arm the interim
 * exposure stop ended builds only the cells it reviewed). */
export function buildCells(run: string, phase: "pilot" | "comparison" | "stock"): BuildCell[] {
  if (phase === "stock") return comparisonUnits(run).units.map((unit): BuildCell => ({ unit, arm: "stock", reviewer: null, rep: 1 }));
  const reviewsDir = join(run, "reviews", "comparison");
  return reviewCells(run, phase).map((c): BuildCell => ({ unit: c.unit, arm: c.arm, reviewer: "opus", rep: c.rep })).filter((c) => {
    if (existsSync(join(reviewsDir, "records", reviewKey(c.unit, c.arm as ReviewArm, "opus", c.rep) + ".json"))) return true;
    if (existsSync(join(reviewsDir, "stops", c.arm + ".json"))) return false;
    return fail("E_USAGE", "build cell " + buildKey(c.unit, c.arm, c.reviewer, c.rep) + " has no review record; run ep reviews --phase " + phase + " first");
  });
}

/**
 * Builds on the comparison item (pilot or comparison: one build per recorded review) or the stock item (one stock build
 * per comparison unit). A reviewed cell whose review ended in a gap is recorded as a gap without a session.
 */
export async function buildsStage(o: StageIo & { phase: "pilot" | "comparison" | "stock"; session: PlantedSession; grader: PlantedGrader; earlier?: (cell: string) => number }): Promise<GradedBuild[]> {
  if (o.phase === "pilot") requireSteps(o.run, "the pilot's builds", ["pilot-reviews"]);
  if (o.phase === "comparison") requireSteps(o.run, "the comparison builds", ["comparison-reviews"]);
  if (o.phase === "stock") requireSteps(o.run, "the stock builds", ["author-batch2"]);
  const df = readJson<DrawFile>(join(o.run, "draw.json"))!;
  const reviewsDir = join(o.run, "reviews", "comparison");
  const reviewOf = (c: BuildCell) => readJson<ReviewRecord>(join(reviewsDir, "records", reviewKey(c.unit, c.arm as ReviewArm, "opus", c.rep) + ".json"));
  const cells = buildCells(o.run, o.phase);
  const outDir = join(o.run, "builds", o.phase === "stock" ? "stock" : "comparison", "cells");
  const done = (c: BuildCell) => loadBuild(outDir, buildKey(c.unit, c.arm, c.reviewer, c.rep));
  const unitOf = new Map<string, PlantedUnit>();
  const unit = (id: string) => unitOf.get(id) ?? unitOf.set(id, drawnUnit(o.src, o.run, id)).get(id)!;
  for (const c of cells) {
    const r = isReviewed(c.arm) ? reviewOf(c) : null;
    if (done(c) || !r || (r.outcome !== "upstream_gap" && r.outcome !== "infra_gap")) continue;
    const b = await runPlantedBuild({ unit: unit(c.unit), unitDir: o.src.dir(c.unit), arm: c.arm, reviewer: c.reviewer, rep: c.rep, note: "", mount: { plan: "", review: "" }, review: r, session: o.session, grader: { grade: () => fail("E_INTERNAL", "a gap is never graded"), catchOf: () => fail("E_INTERNAL", "a gap is never graded") }, log: o.log });
    saveBuild(outDir, b);
  }
  await runGated(cellOrder(df.seed, [...new Set(cells.map((c) => c.unit))], cells), {
    gate: o.gate,
    parallel: o.parallel,
    kind: () => "build",
    key: (c) => buildKey(c.unit, c.arm, c.reviewer, c.rep),
    skip: (c) => done(c) !== null,
    run: async (c) => {
      const plan = join(authorDir(o.run, c.unit), "plan.md");
      let mount: { plan: string; review: string | null };
      if (isReviewed(c.arm)) mount = { plan: join(reviewsDir, "mounts", reviewKey(c.unit, c.arm, "opus", c.rep), "plan.md"), review: join(reviewsDir, "mounts", reviewKey(c.unit, c.arm, "opus", c.rep), "review") };
      else if (c.arm === "stock") mount = writeMount(join(o.run, "builds", "stock", "mounts", c.unit), stockMount(readFileSync(plan, "utf8")));
      else mount = { plan, review: null };
      if (hasReview(c.arm) && !existsSync(mount.review!)) fail("E_USAGE", "build cell " + buildKey(c.unit, c.arm, c.reviewer, c.rep) + ": its review mount " + mount.review + " is missing");
      const b = await runPlantedBuild({ unit: unit(c.unit), unitDir: o.src.dir(c.unit), arm: c.arm, reviewer: c.reviewer, rep: c.rep, note: o.src.note(c.unit), mount, review: isReviewed(c.arm) ? reviewOf(c) : null, session: o.session, grader: o.grader, earlier: o.earlier?.(buildKey(c.unit, c.arm, c.reviewer, c.rep)), marker: join(outDir, buildKey(c.unit, c.arm, c.reviewer, c.rep) + ".grade-error"), log: o.log });
      return { costUsd: b.costUsd, commit: () => void saveBuild(outDir, b) };
    },
  });
  const all = cells.map(done).filter((b): b is GradedBuild => b !== null);
  if (all.length === cells.length) {
    const step: Step = o.phase === "pilot" ? "pilot-builds" : o.phase === "comparison" ? "comparison-builds" : "stock-builds";
    writeStep(o.run, { step, ok: true, detail: all.length + " builds recorded, " + all.filter((b) => b.outcome === "upstream_gap" || b.outcome === "infra_gap").length + " gaps" });
    if (o.phase !== "pilot") o.gate.finish();
  }
  return all;
}

// ---------------------------------------------------------------------------------------------------------------------
// The records the readings read, in run order.

export interface RunRecords {
  /** Calibration, the comparison after reserve swaps, and the reserve left; the lost units are listed apart. */
  units: PlantedUnit[];
  lost: Array<{ id: string; reason: string }>;
  /** The exposure smoke's sessions in run order. */
  smoke: ReviewRecord[];
  /** The comparison item's reviews in run order: the pilot's plain cells, then the comparison's. */
  reviews: ReviewRecord[];
  /** Every scored build in run order: authoring's no-review builds, the pilot's, the comparison's, then stock. A reviewed
   * cell whose review ended in a gap is here as a gap build. */
  builds: GradedBuild[];
  /** Authoring's hinted builds, in the seeded order. */
  hintedBuilds: GradedBuild[];
  /** Admitted units both raters called no. */
  unforeseeable: number;
  /** Authored units admitted (calls and hinted build passed): the unforeseeable share's denominator. */
  admitted: number;
  /** Every screened unit's hinted outcome so far, a hinted gap left out; at the pilot, batch 1's screened units. */
  hinted: { passed: number; screened: number };
}

/** Every record the run wrote, in the order its sessions started (each stage's seeded cell order). */
export function runRecords(run: string, src: UnitSource): RunRecords {
  const df = readJson<DrawFile>(join(run, "draw.json")) ?? fail("E_USAGE", "no draw in " + run);
  const d1 = batchDraw(run, 1);
  const d = batchDraw(run, 2) ?? d1 ?? fail("E_USAGE", "no batch draw in " + run);
  const lost = readJson<Array<{ id: string; reason: string }>>(join(run, "lost.json")) ?? [];
  const comparison = batchDraw(run, 2) ? comparisonUnits(run).units : d.comparison;
  const ids = [...d.calibration, ...comparison, ...d.reserve.filter((r) => !comparison.includes(r))];
  const recordsIn = (dir: string, cells: Array<{ unit: string; arm: ReviewArm; rep: number }>) => cells.map((c) => readJson<ReviewRecord>(join(dir, "records", reviewKey(c.unit, c.arm, "opus", c.rep) + ".json"))).filter((r): r is ReviewRecord => r !== null);
  const smokeIds = d1?.calibration ?? [];
  const smoke = recordsIn(join(run, "reviews", "smoke"), cellOrder(df.seed, smokeIds, smokeIds.flatMap((unit) => SKILL_ARMS.map((arm) => ({ unit, arm, rep: 1 })))));
  const seen = new Set<string>();
  const once = <T extends { unit: string; arm: string; rep: number }>(cells: T[]) => cells.filter((c) => !seen.has(c.unit + "/" + c.arm + "/" + c.rep) && seen.add(c.unit + "/" + c.arm + "/" + c.rep));
  const tryCells = (phase: "pilot" | "comparison") => {
    try {
      return reviewCells(run, phase);
    } catch {
      return [];
    }
  };
  const reviewOrder = once([...tryCells("pilot"), ...(batchDraw(run, 2) ? tryCells("comparison") : [])]);
  const reviews = recordsIn(join(run, "reviews", "comparison"), reviewOrder);
  const builtIn = (dir: string, keys: string[]) => keys.map((k) => loadBuild(dir, k)).filter((b): b is GradedBuild => b !== null);
  const authoring = join(run, "builds", "authoring", "cells");
  const builds = [
    ...builtIn(authoring, ids.map((id) => buildKey(id, "none", null, 1))),
    ...builtIn(join(run, "builds", "comparison", "cells"), reviewOrder.map((c) => buildKey(c.unit, c.arm, "opus", c.rep))),
    ...builtIn(join(run, "builds", "stock", "cells"), comparison.map((id) => buildKey(id, "stock", null, 1))),
  ];
  const hintedBuilds = builtIn(authoring, df.order.map((c) => buildKey(c.id, "hinted", null, 1)));
  const authored = [...authoredMap(run, df.order).values()].filter((a) => a.admitted);
  const screened = df.order.map((c) => readJson<HintedVerdict>(join(authorDir(run, c.id), "hinted.json"))).filter((h): h is HintedVerdict => h !== null && h.winnable !== null);
  const hinted = { passed: screened.filter((h) => h.winnable).length, screened: screened.length };
  return { units: ids.map((id) => drawnUnit(src, run, id)), lost, smoke, reviews, builds, hintedBuilds, unforeseeable: authored.filter((a) => a.unforeseeable).length, admitted: authored.length, hinted };
}

/** The judge's bundle for one unit and source: what that builder saw (a review's mount, the stock mount, or the
 * authored plan alone for none and plan), with the unit's hint. */
export function bundleInput(run: string, b: { unit: string; source: ReviewArm | "stock" | "none" | "plan"; rep: number | null }): { unit: string; source: ReviewArm | "stock" | "none" | "plan"; files: Array<{ path: string; text: string }>; hint: string } {
  const dir = authorDir(run, b.unit);
  const hint = existsSync(join(dir, "hint.txt")) ? readFileSync(join(dir, "hint.txt"), "utf8").trim() : fail("E_USAGE", "unit " + b.unit + " has no hint in " + dir);
  let files: Array<{ path: string; text: string }>;
  if (b.source === "none" || b.source === "plan") files = [{ path: "plan.md", text: readFileSync(join(dir, "plan.md"), "utf8") }];
  else if (b.source === "stock") files = readMount(join(run, "builds", "stock", "mounts", b.unit));
  else files = readMount(join(run, "reviews", "comparison", "mounts", reviewKey(b.unit, b.source, "opus", b.rep ?? fail("E_USAGE", "a review bundle names its rep"))));
  return { unit: b.unit, source: b.source, files, hint };
}

