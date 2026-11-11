// Copyright (c) 2026 Garry Tan. MIT License.
// The dry run's end-to-end case: one fixture unit through every pipeline stage (screen, unit build, statement note,
// the review stage for the four reviewed arms with their bundles, the build stage for all five arms, and grading) on a
// temporary ledger, with stub sessions and model calls. Each paid stage runs under one lease on its own item, and the
// case reads the ledger back: one lease per item, opened and settled. The keyless tests reuse the stubs.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { goRepo } from "../../tests/eng-build/fixture.ts";
import { recordApproval } from "../../src/runner/ledger/ledger.ts";
import { readItem } from "../../src/runner/ledger/record.ts";
import type { BuildSession, Grader } from "./build-stage.ts";
import { itemOf } from "./ledger.ts";
import { noteRequest, type ModelCall } from "./note.ts";
import { buildUnits, openingEvidence, paidItem, runBuilds, runReviews, screenAll, stubLauncher, underLease, writeNotes, type ReviewSession, type ReviewUnit } from "./pipeline.ts";
import type { Candidate, ScreenResult } from "./screen.ts";
import type { Arm, BuildUnit, CaseRuns } from "./types.ts";
import type { BuildOutcome } from "./unit.ts";

const git = (dir: string, args: string[]) => spawnSync("git", ["-C", dir, "-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", ...args], { encoding: "utf8" });

/** A one-commit tree as the review stage mounts it. */
export function oneCommitRepo(dir: string): string {
  mkdirSync(dir, { recursive: true });
  git(dir, ["init", "-q", "-b", "main"]);
  writeFileSync(join(dir, "calc.go"), "package calc\n");
  writeFileSync(join(dir, "CLAUDE.md"), "stripped before the session\n");
  git(dir, ["add", "calc.go"]);
  git(dir, ["commit", "-q", "-m", "base"]);
  return dir;
}

/** A temporary ledger record with each item's plan cap approved. */
export function tempLedger(dir: string, items: string[]): { record: string; ledger: string } {
  const record = join(dir, "record");
  const quote = { words: "dry run on a temporary ledger", by: "eb dryrun", source: "section 11" };
  for (const item of items) recordApproval(record, { action: "init", item, cap_micros: itemOf(item).capUsd * 1_000_000, quotes: [quote], admission: "warn" });
  return { record, ledger: join(dir, "ledger.sqlite") };
}

export const fixtureUnit = (id: string): BuildUnit => ({ id, repo: "r0fixture000", set: "comparison", type: "devtools", ecosystems: ["go"], keying: "first", mergedMonth: "2026-09", strictWindow: true, functional: [".::TestAdd"], aftermath: [{ item: "B1", cases: [".::TestMulZero"], anchors: [".::TestAdd"], base: { ".::TestMulZero": "fail" }, mentioned: false, generic: false, foreseeable: "yes" }], tCases: [] });

/** A review session stub: plan.md improved, an empty transcript, and the Stop hook taken for skill arms. */
export const stubReview = (seen: { hooks: Record<string, boolean>; prompts: string[] }): ReviewSession => async (s) => {
  const hook = s.hook((t) => ({ transcript: t, stateRoot: null, coverage: null, opening: s.arm === "engphase" ? openingEvidence(s.unit) : null }));
  seen.hooks[s.arm] = hook !== null;
  seen.prompts.push(s.prompt);
  return { end: "completed", costUsd: 0.5, result: { dir: s.dir, outputs: { plan: "# Plan\n\nImproved by the " + s.arm + " review.\n", transcript: "", stateRoot: null, coverage: null }, finalRepo: join(s.seed, "repo"), blocks: 0 } };
};

const runs = (id: string, c: CaseRuns["runs"][number]): CaseRuns => ({ id, runs: [c, c, c] });
export const stubBuild: BuildSession = async (s) => ({ outcome: "completed", tree: "/fixture/tree/" + s.cell, costUsd: 1 });
export const stubGrader: Grader = async () => ({ functional: [runs(".::TestAdd", "pass")], aftermath: { B1: [runs(".::TestMulZero", "pass")] }, anchors: { B1: [runs(".::TestAdd", "pass")] }, tCases: [], catches: { B1: null }, coverage: null, mutation: null, testLinesAdded: 4 });

export async function pipelineCase(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "eb-pipeline-"));
  try {
    const fx = goRepo(join(dir, "fixture"));
    const items = ["eb-build-units", "eb-reviews-opus", "eb-builds-opus"];
    const l = tempLedger(dir, items);
    const pay = (stage: "notes" | "review" | "build", item: string) => paidItem(stage, { item, capUsd: "10", record: l.record, ledger: l.ledger });
    const cand: Candidate = { id: fx.spec.id, base: fx.sha.base!, merge: fx.sha.merge!, fixes: [{ commit: fx.sha.fix!, kind: "fix" }] };
    const screened = screenAll({ candidates: [cand], repo: fx.repo, work: dir, screen: (c): ScreenResult => ({ id: c.id, qualifies: true, code: null, step: null, cls: null, ecosystems: ["go"], functionalPass: 1, f2p: [1], base: { pass: 0, fail: 1, no_result: 0 }, steps: [] }) });
    const unit = fixtureUnit(fx.spec.id);
    const built = buildUnits({ specs: [{ spec: fx.spec, repo: fx.repo }], out: join(dir, "units"), work: dir, labels: join(dir, "labels.json"), seed: 7, build: (spec, _repo, out) => ({ qualifies: true, dir: out, eb: { unit, drops: [] } }) as unknown as BuildOutcome });
    const names = noteRequest(fx.repo, fx.spec.base, fx.spec.merge).names.map((n) => n.name);
    const call: ModelCall = async (role) => (role === "writer" ? "The change adds " + names.join(" and ") + " to the calculator." : "PASS");
    const notes = await underLease(pay("notes", "eb-build-units"), stubLauncher(call), (c) => writeNotes({ units: built, out: join(dir, "notes"), call: c }));
    const ru: ReviewUnit[] = [{ id: unit.id, repo: oneCommitRepo(join(dir, "base")), plan: join(dir, "plan.md") }];
    writeFileSync(ru[0]!.plan, "# Plan\n\nAdd Mul.\n");
    const seen = { hooks: {} as Record<string, boolean>, prompts: [] as string[] };
    const reviewed = ["plain", "precut", "candidate"] as const;
    const recs = await underLease(pay("review", "eb-reviews-opus"), stubLauncher(stubReview(seen)), async (s) => {
      const out = [];
      for (const arm of reviewed) out.push(...(await runReviews({ units: ru, arm, reviewer: "opus", reps: [1], out: join(dir, "reviews"), session: s })));
      out.push(...(await runReviews({ units: [{ ...ru[0]!, opening: { text: "/autoplan's eng phase, rendered for the unit", methodology: "autoplan/SKILL.md", readRanges: [{ offset: 1, limit: 200 }] } }], arm: "engphase", reviewer: "opus", reps: [1], out: join(dir, "reviews"), session: s })));
      return out;
    });
    const bundles = recs.filter((r) => existsSync(join(dir, "reviews", "bundles", (unit.id + ":" + r.arm + ":opus:1").replace(/[^A-Za-z0-9._-]/g, "_"), "bundle.md"))).length;
    const note = { unit, note: "The change adds Mul." };
    const builds = await underLease(pay("build", "eb-builds-opus"), stubLauncher(stubBuild), async (s) => {
      const out = [...(await runBuilds({ units: [note], arm: "none", reviewer: null, reps: [1], pilot: false, reviews: [], out: join(dir, "builds"), session: s, grader: stubGrader }))];
      for (const arm of ["plain", "precut", "engphase", "candidate"] as Arm[]) out.push(...(await runBuilds({ units: [note], arm, reviewer: "opus", reps: [1], pilot: false, reviews: recs, out: join(dir, "builds"), session: s, grader: stubGrader })));
      return out;
    });
    const graded = builds.filter((b) => b.outcome === "completed" && b.aftermath.B1?.[0]?.runs.length === 3).length;
    const leases = items.map((i) => {
      const st = readItem(l.record, i);
      return i + " " + st.leases.length + " opened, " + st.leases.filter((x) => x.close !== null).length + " settled";
    });
    const hooks = Object.entries(seen.hooks).filter(([, on]) => on).map(([a]) => a).sort().join(" ");
    return screened.filter((x) => x.qualifies).length + " screened, " + built.length + " built, " + notes.written.length + " noted; " + recs.length + " reviews, " + bundles + " bundles, Stop hook on " + hooks + "; " + builds.length + " builds, " + graded + " graded; " + leases.join("; ");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
