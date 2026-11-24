// Copyright (c) 2026 Garry Tan. MIT License.
// The build stage (section 4): each arm's prompt and mounts, whether the builder read the review, and one cell under
// the session outcome rule.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUILD_LINE, REVIEW_LINE } from "../../../lanes/eng-build/build-stage.ts";
import { takeSpend } from "../../../lanes/eng-build/spend.ts";
import { codeOf, runsOf } from "../../../lanes/eng-planted/stages/cases.ts";
import { plantedBuildPrompt, readMount, readReview, reviewMount, runPlantedBuild, writeMount, type PlantedSession } from "../../../lanes/eng-planted/stages/build.ts";
import type { PlantedGrader, PlantedUnit, ReviewRecord, SessionOutcome } from "../../../lanes/eng-planted/types.ts";

const unit: PlantedUnit = { id: "u1", repo: "r1", set: "comparison", ecosystem: "go", stars: "300-999", publicMonth: "2026-10", strictWindow: true, regionLines: 3, planted: ["p1"], plantedClass: { p1: "assert" }, functional: ["f1"], foresee: ["yes", "no"], winnable: true, hard: null, pilot: true };
const line = (input: Record<string, unknown>) => JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "t", name: "Bash", input }] } });

describe("prompts", () => {
  test("arms with review files get the review line, no review drops it, hinted adds the hint as its own paragraph", () => {
    expect(plantedBuildPrompt("plain", "Note.")).toBe(BUILD_LINE + " " + REVIEW_LINE + "\n\nNote.");
    expect(plantedBuildPrompt("stock", "Note.")).toBe(BUILD_LINE + " " + REVIEW_LINE + "\n\nNote.");
    expect(plantedBuildPrompt("none", "Note.")).toBe(BUILD_LINE + "\n\nNote.");
    expect(plantedBuildPrompt("hinted", "Note.", "Accept either order.")).toBe(BUILD_LINE + "\n\nAccept either order.\n\nNote.");
  });
  test("only the hinted build takes a hint, and it must have one", async () => {
    expect(await codeOf(() => plantedBuildPrompt("plain", "", "A hint."))).toBe("E_USAGE");
    expect(await codeOf(() => plantedBuildPrompt("hinted", ""))).toBe("E_USAGE");
  });
});

describe("readReview", () => {
  test("a tool call naming /work/review or ../review reads it; anything else does not", () => {
    expect(readReview(line({ command: "cat /work/review/review.md" }))).toBe(true);
    expect(readReview(line({ file_path: "/work/review/test-plan.md" }))).toBe(true);
    expect(readReview(line({ command: "ls ../review" }))).toBe(true);
    expect(readReview(line({ command: "cat /work/plan.md" }) + "\n" + JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "see /work/review" }] } }))).toBe(false);
    expect(readReview(line({ command: "cat ./review/notes.md" }))).toBe(false);
    expect(readReview("not json\n")).toBe(false);
  });
});

describe("mounts", () => {
  test("a written mount reads back in its fixed order", () => {
    const dir = mkdtempSync(join(tmpdir(), "ep-mount-"));
    const state = mkdtempSync(join(tmpdir(), "ep-state-"));
    const m = reviewMount("plain", { plan: "Reviewed.", transcript: JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Final." }] } }) + "\n", stateRoot: state, coverage: null }, "Authored.");
    writeMount(join(dir, "c"), m);
    expect(readMount(join(dir, "c"))).toEqual([{ path: "plan.md", text: "Reviewed." }, { path: "review/review.md", text: "Final." }]);
  });
});

describe("runPlantedBuild", () => {
  const dir = mkdtempSync(join(tmpdir(), "ep-build-"));
  const tree = mkdtempSync(join(dir, "t-"));
  writeFileSync(join(tree, "final.patch"), "diff --git a/x_test.go b/x_test.go\n+++ b/x_test.go\n+func TestX(t *testing.T) {}\n");
  writeFileSync(join(tree, "sdk-messages.jsonl"), line({ command: "cat /work/review/review.md" }) + "\n");
  const grader: PlantedGrader = { grade: async () => ({ planted: runsOf(3), functional: runsOf(3) }), catchOf: async () => ({ catch: true, drop: null }) };
  const session = (ends: SessionOutcome[], seen: string[] = []): PlantedSession => async (s) => {
    seen.push(s.cell + "#" + s.attempt);
    const outcome = ends[s.attempt - 1]!;
    return { outcome, tree: outcome === "completed" || outcome === "limit" ? tree : null, costUsd: 1 };
  };
  const review = (outcome: SessionOutcome): ReviewRecord => ({ unit: "u1", arm: "standalone", reviewer: "opus", rep: 2, outcome, exposed: true, exposedBeforeBlock: true, blocks: 0, bundleWords: 10, truncated: false, repoEditsDiscarded: 0, costUsd: 1 });
  const base = { unit, unitDir: dir, arm: "standalone" as const, reviewer: "opus" as const, rep: 2, note: "", mount: { plan: "p", review: "r" }, grader };

  test("a completed reviewed build is graded, with readReview and the test lines from its tree", async () => {
    const b = await runPlantedBuild({ ...base, review: review("completed"), session: session(["completed"]) });
    expect([b.outcome, b.readReview, b.catch, b.testLinesAdded, b.pilot, b.costUsd]).toEqual(["completed", true, true, 1, true, 1]);
    expect(b.planted).toEqual(runsOf(3));
  });
  test("a grading failure after a paid session rethrows with that session's spend on the error; a throw before any spend carries none", async () => {
    const caught = async (f: () => Promise<unknown>) => {
      try {
        await f();
      } catch (e) {
        return e as Error;
      }
      return null;
    };
    const failing: PlantedGrader = { ...grader, grade: async () => { throw new Error("noVerdict"); } };
    const graded = await caught(() => runPlantedBuild({ ...base, grader: failing, review: review("completed"), session: session(["completed"]) }));
    expect([graded?.message, takeSpend(graded)]).toEqual(["noVerdict", 1]);
    const early = await caught(() => runPlantedBuild({ ...base, review: review("completed"), session: async () => { throw new Error("launch"); } }));
    expect([early?.message, takeSpend(early)]).toEqual(["launch", 0]);
  });
  test("a review that ended in a gap leaves a gap build with no session, empty cases and catch null", async () => {
    const seen: string[] = [];
    const b = await runPlantedBuild({ ...base, review: review("upstream_gap"), session: session(["completed"], seen) });
    expect(seen).toEqual([]);
    expect([b.outcome, b.catch, b.catchDrop, b.planted.length, b.functional.length, b.readReview]).toEqual(["upstream_gap", null, "gap", 0, 0, null]);
  });
  test("an upstream end gets one fresh retry, then the cell is a gap; a limit is scored as is", async () => {
    const seen: string[] = [];
    const gap = await runPlantedBuild({ ...base, review: review("completed"), session: session(["upstream_gap", "upstream_gap"], seen) });
    expect(gap.outcome).toBe("upstream_gap");
    expect(seen).toHaveLength(2);
    expect(gap.costUsd).toBe(2);
    const limit = await runPlantedBuild({ ...base, review: review("completed"), session: session(["limit"]) });
    expect([limit.outcome, limit.limitStop]).toEqual(["limit", true]);
  });
  test("mounts and reviewers must fit the arm, and a review record must be the cell's own", async () => {
    expect(await codeOf(() => runPlantedBuild({ ...base, review: null, session: session(["completed"]) }))).toBe("E_USAGE");
    expect(await codeOf(() => runPlantedBuild({ ...base, review: { ...review("completed"), rep: 1 }, session: session(["completed"]) }))).toBe("E_USAGE");
    expect(await codeOf(() => runPlantedBuild({ ...base, arm: "none", reviewer: null, session: session(["completed"]) }))).toBe("E_USAGE");
    expect(await codeOf(() => runPlantedBuild({ ...base, arm: "none", reviewer: "opus", mount: { plan: "p", review: null }, session: session(["completed"]) }))).toBe("E_USAGE");
    const none = await runPlantedBuild({ ...base, arm: "none", reviewer: null, mount: { plan: "p", review: null }, session: session(["completed"]) });
    expect(none.readReview).toBeNull();
  });
});
