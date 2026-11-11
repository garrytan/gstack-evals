import { describe, expect, test } from "bun:test";
import { agentGuards, buildLimits, buildMounts, buildPrompt, buildRegistry, checkMounts, runSessionCell } from "../../lanes/eng-build/build-stage.ts";
import { FROZEN } from "../../lanes/eng-build/frozen.ts";
import type { SessionOutcome } from "../../lanes/eng-build/types.ts";
import { mkdirSync, mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runBuildCell, saveCell, loadCell } from "../../lanes/eng-build/build-stage.ts";
import type { GradedBuild } from "../../lanes/eng-build/types.ts";

describe("build stage", () => {
  test("the no-review prompt drops the review line, and both end with the note", () => {
    expect(buildPrompt("none", "N")).toBe("Implement the plan in plan.md in /work/repo, with tests.\n\nN");
    expect(buildPrompt("plain", "N")).toContain("/work/review/");
  });
  // Value: protects=the build of a unit that adds no public names; fails_when=an empty note stops the build after its lease opened, or leaves a note paragraph in the prompt.
  test("an empty note leaves the note paragraph out: the fixed lines, then nothing", () => {
    expect(buildPrompt("none", "")).toBe("Implement the plan in plan.md in /work/repo, with tests.");
    expect(buildPrompt("plain", "  \n")).toBe("Implement the plan in plan.md in /work/repo, with tests. A reviewer's notes on the plan are in /work/review/; use them as you see fit.");
  });
  test("limits are H's and match the frozen build limits", () => {
    const l = buildLimits();
    expect([l.session_cap_usd, l.max_turns, l.wall_limit_sec]).toEqual([FROZEN.sessions.build.usd, FROZEN.sessions.build.turns, FROZEN.sessions.build.minutes * 60]);
    expect(Object.values(buildRegistry().arms).every((a) => a.install === "none" && a.clean_room && a.skill === null)).toBe(true);
  });
  test("the review bundle is mounted read-only for reviewed arms only", () => {
    expect(buildMounts({ arm: "none", repo: "/r", plan: "/p", review: null }).some((m) => m.includes("/work/review"))).toBe(false);
    expect(buildMounts({ arm: "precut", repo: "/r", plan: "/p", review: "/b" })).toContain("/b:/work/review:ro");
    expect(() => buildMounts({ arm: "precut", repo: "/r", plan: "/p", review: null })).toThrow();
    expect(() => checkMounts(["/task/hidden:/work/review:ro"], ["/task"])).toThrow();
  });
  test("real_agent still carries the session guards", () => {
    expect(agentGuards()).toEqual([]);
  });
  test("session outcomes: one retry each, a second of a kind is a gap", async () => {
    const run = (o: SessionOutcome[]) => runSessionCell("c", async (n) => o[n - 1]!);
    expect((await run(["upstream_gap", "completed"])).gap).toBe(false);
    expect((await run(["upstream_gap", "upstream_gap"])).line).toStartWith("E_EB_GAP cell c:");
    expect((await run(["infra_gap", "upstream_gap", "infra_gap"])).attempts.length).toBe(3);
  });
});

describe("a build cell with no review record", () => {
  // Value: protects=the build stage's gap counts; fails_when=a reviewed arm's missing review record is built as an infra gap and cached, so a resume never runs the review.
  test("stops before any session or cache instead of recording a gap", async () => {
    let ran = 0;
    const cell = runBuildCell({ unit: { id: "u1" } as never, arm: "precut", reviewer: "opus", rep: 1, pilot: false, note: "", review: null, session: async () => (ran++, { outcome: "completed", tree: null, costUsd: 0 }), grader: async () => { throw new Error("graded"); } });
    expect(await cell.then(() => "ok", (e: Error & { code?: string }) => e.code + " " + e.message)).toStartWith("E_USAGE cell u1:precut:opus:1: its review record is missing");
    expect(ran).toBe(0);
  });
});

describe("the cell cache's write order", () => {
  // Value: protects=--resume after a crash mid-write; fails_when=a cell lands before its digest, so a crash between them leaves a cell every resume refuses as stale.
  test("the digest lands before the cell, so a failed digest write leaves no cell", () => {
    const dir = mkdtempSync(join(tmpdir(), "eb-cell-"));
    try {
      const b = { unit: "u1", arm: "none", reviewer: null, rep: 1, pilot: false, outcome: "completed" } as unknown as GradedBuild;
      mkdirSync(join(dir, "u1_none_-_1.sha256"));
      expect(() => saveCell(dir, b)).toThrow();
      expect(existsSync(join(dir, "u1_none_-_1.json"))).toBe(false);
      rmSync(join(dir, "u1_none_-_1.sha256"), { recursive: true });
      expect(loadCell(dir, "u1_none_-_1")).toBeNull();
      expect(loadCell(dir, saveCell(dir, b))).toEqual(b);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
