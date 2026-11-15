// Copyright (c) 2026 Garry Tan. MIT License.
// The recipes row on the fake VM world (wire/recipes.ts): each session's failure line streams to the row log, the row
// stops at the third recipe session that ended before any model request, and the Captain's Node ruling excludes
// declared-range candidates at the draw, prints the count, the labels and the replacement line, and stops before any
// session when fewer than 16 stay eligible.
import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fakeEnv, fakeKit, fakeVm, type Kit } from "../../../lanes/design-constructed/wire/fakes.ts";
import { frameFixture, runRow, scratch } from "../../../lanes/design-constructed/wire/fixtures.ts";

const kits: Kit[] = [];
afterEach(() => kits.splice(0).forEach((k) => k.dispose()));
const kit = (end: "infra" | "completed") => {
  const k = fakeKit({ vm: fakeVm({ apps: () => ({ end }) }) });
  kits.push(k);
  return k;
};
const recipes = (frame: string, k: Kit) => runRow(["recipes", "--frame", frame, "--out", join(scratch("recipes-row"), "sink")], fakeEnv(k));

describe("the recipes row's stop at three early sessions", () => {
  // Value: protects=the Captain's stop rule for the fix pin; fails_when=the row runs on past 3 sessions that never reached the model, or their failure lines reach the row log only at the row's end; why_new=launch 10 burned 60 sessions on one fault with no line in the row log; seam=recipesRow, earlyStop, runScreen's log; no_claim=the real agent's journal count (tests/dc/stage3/agent.test.ts reads AgentRun from the fake sessions)
  test("streams each failure line and stops at the third session with E_DCW_EARLY_SESSIONS", async () => {
    const r = await recipes(frameFixture(5), kit("infra"));
    expect(r.code).toBe(2);
    expect(r.err[0]).toStartWith("E_DCW_EARLY_SESSIONS ");
    expect(r.err[0]).toContain("(recipe session c001, recipe session c001 retry, recipe session c003)");
    const lines = r.out.filter((l) => / failed outside the agent: |^candidate /.test(l));
    expect(lines.map((l) => l.split(":")[0])).toEqual(["recipe session c001", "recipe session c001 retry", "candidate c001", "recipe session c003"]);
    expect(r.out.some((l) => l.includes("c004"))).toBe(false);
  });
});

describe("the Captain's Node ruling at the draw", () => {
  const ranged = (positions: number[]) => (p: number) => (positions.includes(p) ? ">=18 <20" : null);

  // Value: protects=the ruling's floor; fails_when=a draw left under 16 eligible by exclusions starts a session; why_new=the ruling of 2026-11-15; seam=recipesRow, nodeEligible, start rule 7; no_claim=the frame's own draw
  test("prints the exclusions and the replacement line, and stops before any session when fewer than 16 stay eligible", async () => {
    const k = kit("completed");
    const r = await recipes(frameFixture(20, { engines: ranged([1, 3, 4, 5, 6]) }), k);
    expect(r.out).toContain("node eligibility: 5 excluded at the draw (c001, c003, c004, c005, c006), a declared Node range excludes pinned Node 24.22.3; 15 eligible");
    expect(r.out).toContain("node eligibility replacements: none in the sealed record");
    expect(r.code).toBe(2);
    expect(r.err[0]).toStartWith("E_DCW_START_RULE ");
    expect(r.err[0]).toContain("15 of 20 candidates are eligible after 5 Node exclusions (c001, c003, c004, c005, c006)");
    expect(k.built).not.toContain("vm");
  });

  // Value: protects=the ruling's other half; fails_when=an excluded candidate gets a session or counts toward E_DCW_NODE_DROPS; why_new=launch 10 counted 9 declared-range candidates as drops; seam=recipesRow, nodeEligible, nodeDrops; no_claim=an engine-mismatch qualification (tests/dc/wire/node.test.ts)
  test("an excluded candidate gets no session and never counts toward the Node drops", async () => {
    const sink = join(scratch("recipes-row"), "sink");
    const r = await runRow(["recipes", "--frame", frameFixture(17, { engines: ranged([1]) }), "--out", sink], fakeEnv(kit("completed")));
    expect(r.out).toContain("node eligibility: 1 excluded at the draw (c001), a declared Node range excludes pinned Node 24.22.3; 16 eligible");
    expect(r.out.some((l) => l.startsWith("candidate c001"))).toBe(false);
    expect(new Set(r.out.filter((l) => l.startsWith("candidate ")).map((l) => l.split(":")[0])).size).toBe(16);
    expect(r.out.some((l) => l.startsWith("recipe session c001"))).toBe(false);
    expect(r.out).toContain("node-version drops: 0 at pinned Node 24.22.3");
    expect(JSON.parse(readFileSync(join(sink, "node-drops.json"), "utf8")).count).toBe(0);
  }, 60_000);
});
