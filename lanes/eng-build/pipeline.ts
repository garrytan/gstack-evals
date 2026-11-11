// Copyright (c) 2026 Garry Tan. MIT License.
// The eng-review build read's run pipeline (prereg 2026-11-11-geva-522-eng-review-build-read-prereg, sections 3 to 9):
// screen candidates, build units, write and audit statement notes, run the review stage per arm and reviewer, assemble
// bundles, run the build stage and grade it. Every stage takes its sessions and model calls through a seam, so the keyless
// tests and the dry run drive the same code the paid run does, with stub sessions.
//
// Paid stages run under one ledger lease each. paidItem refuses a stage without --item, --cap-usd, --ledger-record and
// --ledger, or with an item that is not the stage's, or with a cap above the item's plan cap. underLease asks the stage's
// launcher for the lease and refuses to run a cell without one, then has the launcher close and checks that the lease is
// settled on every exit path. The launchers own the lease because each real one settles only after its proxy journal is
// reconciled: notes through the product-value meter, reviews through the Docker rig, builds through the outcome driver,
// each on the item under run geva-522-eb. The stub launcher opens and settles through ledger.ts.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { readItem } from "../../src/runner/ledger/record.ts";
import { openLocalLedger } from "../../src/runner/ledger/local.ts";
import { ledgerPath } from "../../src/runner/ledger/paths.ts";
import type { ReadOnlyMount } from "../../src/trial/sandbox.ts";
import type { ErEvidence } from "../eng-review/exposure.ts";
import { isSkillArm, reviewPrompt, reviewStopHook } from "./arms.ts";
import { assertComplete, cellId, loadCell, runBuildCell, saveCell, type BuildSession, type Grader, type GraderResult } from "./build-stage.ts";
import { assembleBundle, bundleParts, repoEdits, writeBundle, type Bundle, type ReviewOutputs } from "./bundle.ts";
import { fail } from "./errors.ts";
import { itemOf, leaseItem, settleItem } from "./ledger.ts";
import { fixOnlyNames, noteRequest, writeNote, type ModelCall } from "./note.ts";
import { isGap, prepareReviewTree, reviewRecord, runSession, type Attempt } from "./review-stage.ts";
import type { Candidate, ScreenResult } from "./screen.ts";
import type { Arm, BuildUnit, GradedBuild, Reviewer, ReviewRecord } from "./types.ts";
import { caseRuns, gradeSet, readUnit, type BuildOutcome, type UnitSpec } from "./unit.ts";

const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
const safe = (key: string) => key.replace(/[^A-Za-z0-9._-]/g, "_");
const writeJson = (path: string, v: unknown) => {
  writeFileSync(path + ".tmp", JSON.stringify(v, null, 1) + "\n");
  renameSync(path + ".tmp", path);
};

// ---------------------------------------------------------------------------------------------------------------------
// Leases.

/** Which item each paid stage may spend from. */
export const STAGE_ITEMS = {
  notes: ["eb-build-units"],
  review: ["eb-reviews-opus", "eb-exposure-smoke", "eb-stage-sol", "eb-stage-particle"],
  build: ["eb-builds-opus", "eb-stage-sol", "eb-stage-particle"],
} as const;

export interface Paid {
  item: string;
  capUsd: number;
  record: string;
  ledger: string;
}

export function paidItem(stage: keyof typeof STAGE_ITEMS, o: { item?: string; capUsd?: string; record?: string; ledger?: string }): Paid {
  const missing = (["item", "capUsd", "record", "ledger"] as const).filter((k) => !o[k]);
  if (missing.length) fail("E_USAGE", "the paid " + stage + " stage runs only under a ledger lease; it needs " + missing.map((k) => ({ item: "--item", capUsd: "--cap-usd", record: "--ledger-record", ledger: "--ledger" })[k]).join(", ") + ", and nothing ran");
  const allowed: readonly string[] = STAGE_ITEMS[stage];
  if (!allowed.includes(o.item!)) fail("E_USAGE", "the " + stage + " stage spends from " + allowed.join(" or ") + ", not " + o.item);
  const capUsd = Number(o.capUsd);
  const plan = itemOf(o.item!).capUsd;
  if (!Number.isFinite(capUsd) || capUsd <= 0 || capUsd > plan) fail("E_USAGE", "--cap-usd " + o.capUsd + " is not a positive amount at or under item " + o.item + "'s plan cap of $" + plan);
  return { item: o.item!, capUsd, record: o.record!, ledger: o.ledger! };
}

/** A launcher's open lease and the backend the stage runs its sessions or calls through. */
export interface Held<B> {
  lease_id: string;
  backend: B;
  close: () => Promise<void>;
}
export type Launcher<B> = (p: Paid) => Promise<Held<B>>;

export async function underLease<B, T>(p: Paid, launch: Launcher<B>, body: (backend: B, lease_id: string) => Promise<T>): Promise<T> {
  const held = await launch(p);
  let out: T;
  try {
    if (!held.lease_id) fail("E_USAGE", "the " + p.item + " launcher opened no lease, so no session ran");
    const open = readItem(p.record, p.item).open;
    if (!open || open.lease_id !== held.lease_id) fail("E_USAGE", "lease " + held.lease_id + " is not the open lease on " + p.item + ", so no session ran");
    out = await body(held.backend, held.lease_id);
  } finally {
    await held.close();
    const still = readItem(p.record, p.item).open;
    if (still && still.lease_id === held.lease_id) fail("E_USAGE", "lease " + held.lease_id + " on " + p.item + " is still open after its launcher closed; settle it before any further spend");
  }
  return out!;
}

/** A launcher for stub backends: one lease through ledger.ts, settled on close. */
export const stubLauncher = <B>(backend: B): Launcher<B> => async (p) => {
  const local = openLocalLedger(ledgerPath(p.ledger));
  const lease = leaseItem(p.record, local, p.item, { amount_micros: Math.round(p.capUsd * 1_000_000), requireAdmission: () => null });
  return {
    lease_id: lease.lease_id,
    backend,
    close: async () => {
      try {
        settleItem(p.record, local, lease.lease_id);
      } finally {
        local.close();
      }
    },
  };
};

// ---------------------------------------------------------------------------------------------------------------------
// Screen and build units (keyless: Docker only, no model call).

export function screenAll(o: { candidates: Candidate[]; repo: string; work: string; screen: (c: Candidate, repo: string, o: { work: string }) => ScreenResult; log?: (l: string) => void }): ScreenResult[] {
  return o.candidates.map((c) => {
    const r = o.screen(c, o.repo, { work: o.work });
    o.log?.(r.qualifies ? "screen " + c.id + ": qualifies (" + r.ecosystems.join(", ") + ")" : (r.code ?? "E_EB_NO_AFTERMATH") + " screen " + c.id + ": dropped at " + r.step + " (" + r.cls + ")");
    return r;
  });
}

export interface BuiltUnit {
  dir: string;
  repo: string;
  spec: UnitSpec;
  unit: BuildUnit;
}

/** Builds every spec's unit into <out>/<id> and returns the ones that qualify; a drop prints its code. A unit already in
 * <out> is read back, never rebuilt. */
export function buildUnits(o: { specs: { spec: UnitSpec; repo: string }[]; out: string; work: string; labels: string; seed: number; build: (spec: UnitSpec, repo: string, out: string, o: { work: string; labels: string; seed: number }) => BuildOutcome; log?: (l: string) => void }): BuiltUnit[] {
  const kept: BuiltUnit[] = [];
  for (const { spec, repo } of o.specs) {
    const dir = join(o.out, safe(spec.id));
    if (existsSync(join(dir, "eb.json"))) {
      kept.push({ dir, repo, spec, unit: readUnit(dir).eb.unit });
      o.log?.("unit " + spec.id + ": read back from " + dir);
      continue;
    }
    const r = o.build(spec, repo, dir, { work: o.work, labels: o.labels, seed: o.seed });
    if (!r.qualifies) {
      for (const d of r.eb.drops) o.log?.(d.code + " unit " + spec.id + ": " + d.step + " (" + d.cls + ")");
      continue;
    }
    kept.push({ dir: r.dir, repo, spec, unit: r.eb.unit });
    o.log?.("unit " + spec.id + ": built, " + r.eb.unit.functional.length + " functional, " + r.eb.unit.aftermath.reduce((s, a) => s + a.cases.length, 0) + " aftermath cases");
  }
  return kept;
}

// ---------------------------------------------------------------------------------------------------------------------
// Statement notes (paid: eb-build-units).

/** Writes and audits each unit's note into <out>/<id>.md; a refused note is written nowhere and prints its reason. A unit
 * with a note already on disk is skipped. */
export async function writeNotes(o: { units: BuiltUnit[]; out: string; call: ModelCall; log?: (l: string) => void }): Promise<{ written: string[]; refused: string[] }> {
  mkdirSync(o.out, { recursive: true });
  const written: string[] = [];
  const refused: string[] = [];
  for (const u of o.units) {
    const file = join(o.out, safe(u.unit.id) + ".md");
    if (existsSync(file)) {
      written.push(u.unit.id);
      continue;
    }
    const fixes = u.spec.items.map((i) => i.commit);
    const r = await writeNote(noteRequest(u.repo, u.spec.base, u.spec.merge), fixOnlyNames(u.repo, u.spec.merge, fixes), o.call);
    if (r.refused !== null) {
      refused.push(u.unit.id);
      o.log?.("note " + u.unit.id + ": the audit refused it (" + r.refused + "), so the unit has no note and builds only once a rewrite passes");
      continue;
    }
    writeFileSync(file, r.note + (r.note ? "\n" : ""));
    written.push(u.unit.id);
  }
  return { written, refused };
}

// ---------------------------------------------------------------------------------------------------------------------
// The review stage (paid: eb-reviews-opus, eb-exposure-smoke or a conditional stage's item).

export interface ReviewUnit {
  id: string;
  /** The unit's base tree as the review mounts it at /work/repo. */
  repo: string;
  /** The original plan; every arm reads it at /work/plan.md. */
  plan: string;
  /** engphase only: the unit's rendered opening (lanes/eng-review/render.ts), the methodology file and chunks its
   * load check reads, and the read-only mounts that hold the methodology. */
  opening?: { text: string; methodology: string; readRanges: Array<{ offset: number; limit: number }>; mounts?: ReadOnlyMount[] } | null;
}

/** The exposure detector's view of the opening: the methodology and its chunks. */
export const openingEvidence = (u: ReviewUnit): ErEvidence["opening"] => (u.opening ? { methodology: u.opening.methodology, readRanges: u.opening.readRanges } : null);

/** What one review attempt left on the host. */
export interface ReviewLeft {
  dir: string;
  outputs: ReviewOutputs;
  /** The review's repo/ at the end, for the discarded-edits count. */
  finalRepo: string;
  blocks: number;
}

/** One review attempt from a fresh container. seed holds repo/ (stripped, one commit) and plan.md, the session's work
 * folder; dir is the attempt's own folder. hook(evidence) gives the arm's Stop hook (null for plain), which the backend
 * passes to the session's driver. */
export type ReviewSession = (o: { cell: string; unit: ReviewUnit; arm: Exclude<Arm, "none">; reviewer: Reviewer; rep: number; attempt: number; prompt: string; seed: string; dir: string; hook: (evidence: (transcript: string) => ErEvidence) => ReturnType<typeof reviewStopHook> }) => Promise<Attempt<ReviewLeft>>;

export const reviewKey = (unit: string, arm: Arm, reviewer: Reviewer, rep: number) => safe(cellId(unit, arm, reviewer, rep));

/** The bundle a finished session's outputs give, written to <reviewDir>/bundle.md (a resume refuses other bytes). */
export function bundleFor(arm: Exclude<Arm, "none">, outputs: ReviewOutputs, reviewDir: string): Bundle {
  const b = assembleBundle(bundleParts(arm, outputs));
  writeBundle(reviewDir, b);
  return b;
}

/** Runs every unit by rep cell for one arm and reviewer. A cell with a record in <out>/records is kept, never rerun. */
export async function runReviews(o: { units: ReviewUnit[]; arm: Exclude<Arm, "none">; reviewer: Reviewer; reps: number[]; out: string; session: ReviewSession; log?: (l: string) => void }): Promise<ReviewRecord[]> {
  const records = join(o.out, "records");
  mkdirSync(records, { recursive: true });
  const done: ReviewRecord[] = [];
  const planned: string[] = [];
  const closed = new Set<string>();
  for (const u of o.units) {
    for (const rep of o.reps) {
      const key = reviewKey(u.id, o.arm, o.reviewer, rep);
      planned.push(key);
      const file = join(records, key + ".json");
      if (existsSync(file)) {
        done.push(JSON.parse(readFileSync(file, "utf8")) as ReviewRecord);
        closed.add(key);
        continue;
      }
      const cell = cellId(u.id, o.arm, o.reviewer, rep);
      const prompt = reviewPrompt(o.arm, o.arm === "engphase" ? u.opening?.text ?? null : null);
      const base = join(o.out, "sessions", key);
      const run = await runSession<ReviewLeft>(cell, async (attempt) => {
        const dir = join(base, "a" + attempt);
        rmSync(dir, { recursive: true, force: true });
        const seed = join(dir, "seed");
        mkdirSync(seed, { recursive: true });
        cpSync(u.repo, join(seed, "repo"), { recursive: true });
        prepareReviewTree(join(seed, "repo"));
        cpSync(u.plan, join(seed, "plan.md"));
        return o.session({ cell, unit: u, arm: o.arm, reviewer: o.reviewer, rep, attempt, prompt, seed, dir, hook: (evidence) => reviewStopHook(o.arm, evidence) });
      }, o.log);
      const last = run.attempts.at(-1)!;
      const left = last.result;
      const gap = isGap(run.outcome);
      const bundle = gap ? { words: 0, truncated: false } : bundleFor(o.arm, left.outputs, join(o.out, "bundles", key));
      const rec = reviewRecord({ unit: u.id, arm: o.arm, reviewer: o.reviewer, rep, outcome: run.outcome, evidence: { transcript: left.outputs.transcript, stateRoot: left.outputs.stateRoot, coverage: left.outputs.coverage, opening: o.arm === "engphase" ? openingEvidence(u) : null }, blocks: left.blocks, bundle, repoEditsDiscarded: gap ? 0 : repoEdits(u.repo, left.finalRepo), costUsd: run.attempts.reduce((s, a) => s + a.costUsd, 0) });
      writeJson(file, rec);
      done.push(rec);
      closed.add(key);
    }
  }
  assertComplete("review " + o.arm + " on " + o.reviewer, planned, closed);
  return done;
}

// ---------------------------------------------------------------------------------------------------------------------
// The build stage (paid: eb-builds-opus or a conditional stage's item) and its grader.

/** Runs every unit by rep build cell for one arm, reading each reviewed arm's record from reviews. A cell already in
 * <out>/cells is read back through its digest (E_EB_CACHE_STALE on a mismatch), never rerun. */
export async function runBuilds(o: { units: { unit: BuildUnit; note: string }[]; arm: Arm; reviewer: Reviewer | null; reps: number[]; pilot: boolean; reviews: ReviewRecord[]; out: string; session: BuildSession; grader: Grader; log?: (l: string) => void }): Promise<GradedBuild[]> {
  if ((o.arm === "none") !== (o.reviewer === null)) fail("E_USAGE", "the none arm builds with no reviewer, and every other arm names one");
  const cells = join(o.out, "cells");
  const done: GradedBuild[] = [];
  const planned: string[] = [];
  const closed = new Set<string>();
  for (const { unit, note } of o.units) {
    for (const rep of o.reps) {
      const key = safe(cellId(unit.id, o.arm, o.reviewer, rep));
      planned.push(key);
      const cached = loadCell(cells, key);
      if (cached) {
        done.push(cached);
        closed.add(key);
        continue;
      }
      const review = o.arm === "none" ? null : o.reviews.find((r) => r.unit === unit.id && r.arm === o.arm && r.reviewer === o.reviewer && r.rep === rep) ?? null;
      const b = await runBuildCell({ unit, arm: o.arm, reviewer: o.reviewer, rep, pilot: o.pilot, note, review, session: o.session, grader: o.grader, ...(o.log ? { log: o.log } : {}) });
      saveCell(cells, b);
      done.push(b);
      closed.add(key);
    }
  }
  assertComplete("build " + o.arm + (o.reviewer ? " on " + o.reviewer : ""), planned, closed);
  return done;
}

/** Lines the patch adds to test files: files under a test folder or named as a test by the runners the units use. */
export function testLinesAdded(patch: string): number {
  const testPath = (p: string) => /(^|\/)(tests?|__tests__|spec)\//.test(p) || /([._-](test|spec)\.[cm]?[jt]sx?|_test\.go|(^|\/)test_[^/]*\.py|_test\.py)$/.test(p);
  let on = false;
  let n = 0;
  for (const line of patch.split("\n")) {
    if (line.startsWith("+++ ")) on = testPath(line.slice(4).replace(/^b\//, ""));
    else if (on && line.startsWith("+")) n++;
  }
  return n;
}

/** The verifier's grader: the build's final.patch (in the tree folder the session returns) graded in the unit's pinned
 * image, 3 runs, on the functional set and each aftermath item's set. Real-bug catches, coverage and mutation are left
 * null until the catch and coverage modules plug in. */
export function unitGrader(o: { dirs: Map<string, string>; work: string; runs?: number; seed?: number }): Grader {
  return async ({ unit, tree }): Promise<GraderResult> => {
    const dir = o.dirs.get(unit.id) ?? fail("E_USAGE", "no unit folder for " + unit.id);
    const patch = readFileSync(join(tree, "final.patch"), "utf8");
    const { eb, task } = readUnit(dir);
    const runs = o.runs ?? 3;
    const seed = o.seed ?? Number.parseInt(sha(unit.id + tree).slice(0, 8), 16);
    const on = (set: (typeof eb.sets)[number], want: string[]) => gradeSet({ taskDir: dir, task, eb, set, label: "build", patch, runs, seed, work: o.work, want });
    const functional = caseRuns(on(eb.sets[0]!, unit.functional), unit.functional);
    const aftermath: GraderResult["aftermath"] = {};
    const anchors: GraderResult["anchors"] = {};
    const catches: GraderResult["catches"] = {};
    for (const a of unit.aftermath) {
      const set = eb.sets.find((s) => s.item === a.item);
      if (!set || a.cases.length === 0) continue;
      const g = on(set, [...a.cases, ...a.anchors]);
      aftermath[a.item] = caseRuns(g, a.cases);
      anchors[a.item] = caseRuns(g, a.anchors);
      catches[a.item] = null;
    }
    const tSets = eb.sets.filter((s) => s.role === "T");
    const tGrid = Object.assign({}, ...tSets.map((s) => on(s, unit.tCases)));
    return { functional, aftermath, anchors, tCases: caseRuns(tGrid, unit.tCases), catches, coverage: null, mutation: null, testLinesAdded: testLinesAdded(patch) };
  };
}

/** Reads a folder of built units (one subfolder each, as buildUnits writes them). */
export function readUnits(dir: string): Map<string, { dir: string; unit: BuildUnit }> {
  const out = new Map<string, { dir: string; unit: BuildUnit }>();
  for (const name of readdirSync(dir).sort()) {
    const d = join(dir, name);
    if (!existsSync(join(d, "eb.json"))) continue;
    const unit = readUnit(d).eb.unit;
    out.set(unit.id, { dir: d, unit });
  }
  return out;
}
