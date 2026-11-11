// Copyright (c) 2026 Garry Tan. MIT License.
// The build read's review stage (prereg 2026-11-11-geva-522 section 4): the session outcome rule on stub attempts, and
// the ReviewRecord's exposure, exposure before any block and blocks. Keyless; no session runs.
import { describe, expect, test } from "bun:test";
import type { ErEvidence } from "../../lanes/eng-review/exposure.ts";
import { type AttemptEnd, isGap, reviewRecord, runSession } from "../../lanes/eng-build/review-stage.ts";
import { ARTIFACT, nd, review, say, tree } from "../er/transcripts.ts";

async function play(ends: AttemptEnd[]) {
  const started: number[] = [];
  const log: string[] = [];
  const run = await runSession("precut/opus/u1/r1", async (n) => {
    started.push(n);
    return { end: ends[n - 1]!, costUsd: 1, result: "a" + n };
  }, (l) => log.push(l));
  return { outcome: run.outcome, retries: run.retries, results: run.attempts.map((a) => a.result), started, log };
}

describe("session outcome rule", () => {
  test("completed and limit are scored as is, from the first attempt", async () => {
    expect(await play(["completed"])).toMatchObject({ outcome: "completed", retries: 0, started: [1], log: [] });
    expect(await play(["limit"])).toMatchObject({ outcome: "limit", retries: 0, started: [1], log: [] });
  });

  test("one upstream error gets one retry from a fresh container; a second is an upstream gap", async () => {
    expect(await play(["upstream", "completed"])).toMatchObject({ outcome: "completed", retries: 1, started: [1, 2], results: ["a1", "a2"] });
    const gap = await play(["upstream", "upstream"]);
    expect(gap).toMatchObject({ outcome: "upstream_gap", retries: 1, started: [1, 2] });
    expect(gap.log).toEqual(["E_EB_GAP precut/opus/u1/r1: upstream_gap after 1 retry; the cell is a recorded gap and its build is not run"]);
  });

  test("one infra failure gets one rerun; a second is an infra gap", async () => {
    expect(await play(["infra", "limit"])).toMatchObject({ outcome: "limit", retries: 1 });
    expect(await play(["infra", "infra"])).toMatchObject({ outcome: "infra_gap", retries: 1, started: [1, 2] });
  });

  test("the two budgets are separate: at most three attempts, and the second of either kind is the gap", async () => {
    expect(await play(["upstream", "infra", "completed"])).toMatchObject({ outcome: "completed", retries: 2, started: [1, 2, 3] });
    const gap = await play(["infra", "upstream", "infra"]);
    expect(gap).toMatchObject({ outcome: "infra_gap", retries: 2, started: [1, 2, 3] });
    expect(gap.log).toEqual(["E_EB_GAP precut/opus/u1/r1: infra_gap after 2 retries; the cell is a recorded gap and its build is not run"]);
  });

  test("isGap reads only the two gap outcomes", () => {
    expect((["completed", "limit", "upstream_gap", "infra_gap"] as const).map(isGap)).toEqual([false, false, true, true]);
  });
});

describe("review record", () => {
  const root = tree(ARTIFACT);
  const ev = (t: string): ErEvidence => ({ transcript: t, stateRoot: root, coverage: null, opening: null });
  const base = { unit: "u1", reviewer: "opus" as const, rep: 1, outcome: "completed" as const, bundle: { words: 900, truncated: false }, repoEditsDiscarded: 2, costUsd: 3.5 };

  test("a skill arm exposed with no block, exposed after a block, and never exposed", () => {
    const exposed = ev(nd(say(review())));
    expect(reviewRecord({ ...base, arm: "precut", evidence: exposed, blocks: 0 })).toEqual({ unit: "u1", arm: "precut", reviewer: "opus", rep: 1, outcome: "completed", exposed: true, exposedBeforeBlock: true, blocks: 0, bundleWords: 900, truncated: false, repoEditsDiscarded: 2, costUsd: 3.5 });
    expect(reviewRecord({ ...base, arm: "precut", evidence: exposed, blocks: 1 })).toMatchObject({ exposed: true, exposedBeforeBlock: false, blocks: 1 });
    expect(reviewRecord({ ...base, arm: "precut", evidence: ev(nd(say("No review."))), blocks: 2 })).toMatchObject({ exposed: false, exposedBeforeBlock: false, blocks: 2 });
  });

  test("the plain arm has no detector", () => {
    expect(reviewRecord({ ...base, arm: "plain", evidence: ev(nd(say(review()))), blocks: 0 })).toMatchObject({ arm: "plain", exposed: null, exposedBeforeBlock: null });
  });
});
