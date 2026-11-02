// Panel v3's plan-session stops and the clean-room backstop, end to end (wiki/plans/2026-11-02-geva-165-planning-panel-v3-plan,
// section 5's stop table and section 4's clean room). runReviewUnits drives the real Claude Code driver on the real pinned
// Agent SDK 0.3.314 against the stub CLI, one none arm per stop, in its own process (plan-v3-stops-sdk.ts). The rule: a
// turn cap or allowance stop in either turn, or a timeout after model output, scores the plan-findings block the main
// agent wrote before it, else a miss; a turn-1 stop sends no turn 2; a timeout before any model output is a coverage gap
// that stops the arm with E_COVERAGE_GAP; and a clean-room hit in the session's preflight ends the session as a missing
// cell (E_CLEAN_ROOM) before the CLI starts, stops the arm, is never journaled, and reruns under --resume --repair while
// every other scored session is reused. Each case checks the record (termination, follow_up, model_output), the parse,
// planScore, the terminations.tsv row and arm.json.
import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ALLOWANCE_SPENT } from "../../../src/adapters/claude-code/driver.ts";
import { REPO_ROOT } from "../../../src/cli.ts";
import { removeTree } from "../../../src/trial/cleanup.ts";
import { CAPPED_PARSER_SHA256 } from "../../../src/trial/review/capped.ts";
import { CLEAN_ROOM_COMMAND } from "../../../src/trial/review/clean-room.ts";
import { PLAN_TURN2 } from "../../../src/trial/review/plan.ts";
import { armId, planScore, readReviewJournal, reviewCellId, unitFile, type ReviewEntry } from "../../../src/trial/review/run.ts";
import { ARMS, DRIVE_OWNER, MODEL, ONE, RUN_MAX_TURNS, TURN2_TIMEOUT_MS, TWO } from "./plan-v3-stops-sdk.ts";

const roots: string[] = [];
afterAll(() => roots.forEach((r) => removeTree(r)));
const scratch = (name: string) => {
  const d = mkdtempSync(join(tmpdir(), name));
  roots.push(d);
  return d;
};
const durable = () => {
  const d = mkdtempSync(join(REPO_ROOT, ".plan-v3-stops-test-"));
  roots.push(d);
  return d;
};

interface Ran {
  unit: string;
  task: string;
  drive: string;
  refusal: string;
  stops: { code: string; message: string }[][];
  spawned: Record<string, number>[];
  drivers: { phase: number; out: string; followUp: unknown; preflight: unknown; maxTurns: unknown; capStops: unknown }[];
  root: string;
  out: string;
  /** The out dir as the first run left it. */
  first: string;
}
let memo: { child: SpawnSyncReturns<string>; root: string; out: string } | null = null;
const run = (): Ran => {
  memo ??= ((root, out) => ({ child: spawnSync(process.execPath, [join(import.meta.dir, "plan-v3-stops-sdk.ts"), root, out], { encoding: "utf8", timeout: 170_000 }), root, out }))(scratch("plan-v3-stops-"), durable());
  expect([memo.child.status, memo.child.stderr]).toEqual([0, ""]);
  return { ...JSON.parse(memo.child.stdout.trim().split("\n").at(-1)!), root: memo.root, out: memo.out, first: join(memo.root, "run1") };
};

const NOT_SENT = { sent: false, model_turns: 0 };
const findings = (f: readonly object[]) => ({ kind: "findings", findings: f });
const entryOf = (dir: string, r: Ran, arm: string): ReviewEntry | undefined => readReviewJournal(dir).get(reviewCellId({ model: MODEL, arm, unit: r.unit, pass: 1 }));
const tsv = (dir: string, file: string, arm: string) => readFileSync(join(dir, file), "utf8").split("\n").filter(Boolean).map((l) => l.split("\t")).filter((c) => c[1] === arm).map((c) => c.slice(5));
const armJson = (dir: string, arm: string) => JSON.parse(readFileSync(join(dir, "arms", armId(arm, MODEL), "arm.json"), "utf8"));
const records = (r: Ran, phase: number, arm: string): Record<string, unknown>[] => {
  const f = join(r.root, "records-" + phase, arm + ".ndjson");
  return existsSync(f) ? readFileSync(f, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : [];
};
const users = (r: Ran, phase: number, arm: string) => records(r, phase, arm).filter((m) => m.type === "user").length;
const stopCounts = (r: Ran, kind: "turn_cap" | "allowance_stop" | "timeout" | null, turn2: boolean) => ({ turn_cap: kind === "turn_cap" ? 1 : 0, allowance_stop: kind === "allowance_stop" ? 1 : 0, timeout: kind === "timeout" ? 1 : 0, turn_2: turn2 ? 1 : 0, units: kind ? [r.unit] : [], parser_sha256: CAPPED_PARSER_SHA256 });
const stopNote = (r: Ran, outcome: string, kind: string, turn: number, scored: boolean) => r.unit + " pass 1: " + outcome + "; ended " + kind + " in turn " + turn + ", settled spend $0.000000, " + (scored ? "scored on the findings it wrote before the stop" : "scored as finding nothing");
const gapStop = (arm: string, gap: string) => ({ code: "E_COVERAGE_GAP", message: "arm " + armId(arm, MODEL) + " stopped with 1 coverage gap, so it gets no verdict: " + gap });
const sessionDir = (dir: string, r: Ran, arm: string) => join(dir, "runs", MODEL, arm, r.task, "p1");

interface Case {
  record: { termination: unknown; follow_up: unknown; model_output: boolean };
  parse: unknown;
  score: "findings" | "miss" | "gap";
  row: string[];
  arm: Record<string, unknown>;
  users: number;
  lines: number;
}
const check = (dir: string, r: Ran, arm: string, x: Case, phase = 1) => {
  const e = entryOf(dir, r, arm)!;
  expect<unknown[]>([arm, e.record.termination, e.record.follow_up, e.record.model_output]).toEqual([arm, x.record.termination, x.record.follow_up, x.record.model_output]);
  expect<unknown[]>([arm, e.parse, planScore(e)]).toEqual([arm, x.parse, x.score]);
  expect([arm, tsv(dir, "terminations.tsv", arm)]).toEqual([arm, [x.row]]);
  const j = armJson(dir, arm);
  expect<unknown[]>([arm, { status: j.status, stops: j.stops, diagnostics: j.diagnostics, coverage_gaps: j.coverage_gaps }]).toEqual([arm, x.arm]);
  expect([arm, users(r, phase, arm)]).toEqual([arm, x.users]);
  const lines = readFileSync(join(dir, "arms", armId(arm, MODEL), "findings", unitFile(r.unit) + ".jsonl"), "utf8").split("\n").filter(Boolean);
  expect([arm, lines.length]).toEqual([arm, x.lines]);
};

describe("GEVA-203: plan-session stops and the clean-room backstop through runReviewUnits on the pinned Agent SDK (keyless)", () => {
  // Value: protects=the options every case below rests on reach the driver from run.ts: turn 2 is PLAN_TURN2 with its 5-turn cap and 300 s clock, the run's turn cap, cap stops, and the none arm's clean-room preflight; fails_when=run.ts drops or changes any of them for a plan session; why_new=the turn-2 timeout case shortens turn 2's clock through the rig's driver seam, so this pins what it shortened; seam=runReviewUnits' hostDriver options through HostRig.driver; no_claim=the driver's own handling, which the cases below and tests/adapters/two-turn.test.ts cover
  test("run.ts hands every none session PLAN_TURN2, the run's turn cap, cap stops and the clean-room preflight", () => {
    const r = run();
    expect(r.drivers.filter((d) => d.phase === 1).length).toBe(ARMS.length);
    expect(r.drivers.filter((d) => d.phase === 2).map((d) => d.out)).toEqual([join(sessionDir(r.out, r, "backstop"), "host")]);
    for (const d of r.drivers) expect([d.out, d.followUp, d.preflight, d.maxTurns, d.capStops]).toEqual([d.out, { text: PLAN_TURN2.text, maxTurns: PLAN_TURN2.maxTurns, timeoutMs: PLAN_TURN2.timeoutS * 1000 }, { command: CLEAN_ROOM_COMMAND, code: "E_CLEAN_ROOM" }, RUN_MAX_TURNS, true]);
  }, 180_000);

  // Value: protects=section 5's turn-cap row in turn 1: no turn 2 goes to the CLI, a block written before the cap scores its findings, and with none the session is a miss that arm.json counts as a turn-1 turn_cap with its diagnostic, never a gap; fails_when=a turn-1 cap still sends turn 2, drops a block written before it, or turns a cap with no block into a gap; why_new=panel v3 C1; seam=runReviewUnits, cappedPlanParse, planScore, the driver's capStops on SDK 0.3.314 and the stub CLI (turns mode for the block, script mode without); no_claim=the real CLI or a model
  test("a turn cap in turn 1 sends no turn 2 and scores the block written before it, or a miss with none", () => {
    const r = run();
    expect(records(r, 1, "cap1-noblock")[0]!.argv).toContain("--max-turns=" + RUN_MAX_TURNS);
    check(r.first, r, "cap1-block", { record: { termination: { kind: "turn_cap" }, follow_up: NOT_SENT, model_output: true }, parse: findings(ONE), score: "findings", row: ["turn_cap", "1", "true", "findings", "1"], arm: { status: "complete", stops: stopCounts(r, "turn_cap", false), diagnostics: [stopNote(r, "findings", "turn_cap", 1, true)] }, users: 1, lines: 1 });
    check(r.first, r, "cap1-noblock", { record: { termination: { kind: "turn_cap" }, follow_up: NOT_SENT, model_output: true }, parse: { kind: "missing" }, score: "miss", row: ["turn_cap", "1", "true", "miss", ""], arm: { status: "complete", stops: stopCounts(r, "turn_cap", false), diagnostics: [stopNote(r, "missing", "turn_cap", 1, false)] }, users: 1, lines: 0 });
  }, 180_000);

  // Value: protects=section 5's turn-cap row in turn 2: the adapter's own cap ends turn 2 at PLAN_TURN2.maxTurns model turns, and the session scores the block turn 1 wrote, counted in arm.json as a turn-2 turn_cap; fails_when=the turn-2 cap is missed or late, the stop loses turn 1's block, or terminations.tsv names turn 1; why_new=panel v3 C1; seam=runReviewUnits and the driver's followUp count on SDK 0.3.314 and the stub CLI's script mode; no_claim=the real CLI, which two-turn.test.ts covers
  test("a turn cap in turn 2 sends turn 2 and scores the block written before the stop", () => {
    const r = run();
    check(r.first, r, "cap2", { record: { termination: { kind: "turn_cap" }, follow_up: { sent: true, model_turns: PLAN_TURN2.maxTurns }, model_output: true }, parse: findings(ONE), score: "findings", row: ["turn_cap", "2", "true", "findings", "1"], arm: { status: "complete", stops: stopCounts(r, "turn_cap", true), diagnostics: [stopNote(r, "findings", "turn_cap", 2, true)] }, users: 2, lines: 1 });
  }, 180_000);

  // Value: protects=section 5's timeout row (C1, J1): a turn-2 timeout after model output, on turn 2's own clock, scores as a turn cap from the latest block written before it (turn 2's, not turn 1's) and is counted in arm.json as a turn-2 timeout; fails_when=a timeout after output becomes a gap, scores an older block, or turn 2 runs on the session's clock; why_new=panel v3 C1; seam=runReviewUnits, planStop, cappedPlanParse and the driver's turn-2 clock on SDK 0.3.314, with the clock shortened from PLAN_TURN2.timeoutS through the rig's driver seam; no_claim=the 300 s clock itself, which the first test pins as run.ts passes it
  test("a timeout after model output in turn 2 scores the latest block written before it", () => {
    const r = run();
    check(r.first, r, "timeout2", { record: { termination: { kind: "timeout" }, follow_up: { sent: true, model_turns: 1 }, model_output: true }, parse: findings(TWO), score: "findings", row: ["timeout", "2", "true", "findings", "2"], arm: { status: "complete", stops: stopCounts(r, "timeout", true), diagnostics: [stopNote(r, "findings", "timeout", 2, true)] }, users: 2, lines: 2 });
    expect(entryOf(r.first, r, "timeout2")!.record.wall_ms!).toBeGreaterThanOrEqual(TURN2_TIMEOUT_MS);
  }, 180_000);

  // Value: protects=section 5's coverage-gap row: a timeout before any model output is a gap that stops the arm with E_COVERAGE_GAP and gets no verdict, and no turn 2 goes in; fails_when=it scores as a miss, the arm reads complete, or the run's stops omit it; why_new=panel v3 C1; seam=runReviewUnits, planScore and arm.json's coverage_gaps on SDK 0.3.314 and the stub CLI's script mode; no_claim=an infra failure, which run.test.ts covers
  test("a timeout before any model output is a coverage gap that stops the arm with E_COVERAGE_GAP", () => {
    const r = run();
    const gap = r.unit + " pass 1: incomplete, the session ended timeout before any model output";
    check(r.first, r, "timeout0", { record: { termination: { kind: "timeout" }, follow_up: NOT_SENT, model_output: false }, parse: { kind: "incomplete", reason: "the session ended timeout" }, score: "gap", row: ["timeout", "1", "false", "gap", ""], arm: { status: "stopped", stops: stopCounts(r, null, false), coverage_gaps: [gap] }, users: 1, lines: 0 });
    expect(r.stops[0]).toContainEqual(gapStop("timeout0", gap));
  }, 180_000);

  // Value: protects=section 5's allowance row in turn 2: the metering proxy's own refusal for a spent allowance ends the session as allowance_stop, scored from the block turn 1 wrote and counted in arm.json as a turn-2 allowance stop; fails_when=the proxy rewords the refusal past ALLOWANCE_SPENT, the stop becomes a missing cell, or it loses turn 1's block; why_new=panel v3 C1; seam=MeteringProxy's refusal text replayed by the stub CLI's script mode, the driver's capStops and runReviewUnits on SDK 0.3.314; no_claim=the real CLI's retry behavior, which claude-code.test.ts covers
  test("an allowance stop in turn 2 scores the block written before it", () => {
    const r = run();
    expect(r.refusal).toMatch(ALLOWANCE_SPENT);
    check(r.first, r, "allowance2", { record: { termination: { kind: "allowance_stop" }, follow_up: { sent: true, model_turns: 1 }, model_output: true }, parse: findings(ONE), score: "findings", row: ["allowance_stop", "2", "true", "findings", "1"], arm: { status: "complete", stops: stopCounts(r, "allowance_stop", true), diagnostics: [stopNote(r, "findings", "allowance_stop", 2, true)] }, users: 2, lines: 1 });
  }, 180_000);

  // Value: protects=section 4's backstop: a drive the session's clean-room preflight can see ends the none session as a missing cell (E_CLEAN_ROOM) before the CLI spawns, logs the hit, stops the arm with E_COVERAGE_GAP and leaves no journal entry; fails_when=the CLI still starts, the refusal is scored, journaled or logged without its path, or the arm reads complete; why_new=GGST-6's no-gstack rule in panel v3; seam=CLEAN_ROOM_COMMAND under CLEAN_ROOM_ROOT, the driver's preflight and runReviewUnits on SDK 0.3.314; no_claim=the per-image preflight before the lease, which clean-room tests cover
  test("a clean-room hit ends the none session before the CLI starts, stops the arm and is not journaled", () => {
    const r = run();
    expect(r.drive.startsWith(r.root) && r.drive.endsWith(join("home", DRIVE_OWNER, ".capy", "drive"))).toBe(true);
    const dir = sessionDir(r.first, r, "backstop");
    const record = JSON.parse(readFileSync(join(dir, "trial.json"), "utf8")).record;
    expect([record.termination, record.follow_up, record.model_output]).toEqual([{ kind: "missing", code: "E_CLEAN_ROOM" }, NOT_SENT, false]);
    expect([r.spawned[0]!.backstop ?? 0, records(r, 1, "backstop")]).toEqual([0, []]);
    expect(readFileSync(join(dir, "host", "cli-stderr.log"), "utf8")).toBe("adapter: preflight refused: found " + r.drive + "\n");
    expect(entryOf(r.first, r, "backstop")).toBeUndefined();
    expect([...readReviewJournal(r.first).values()].map((e) => e.cell.arm).sort()).toEqual(ARMS.filter((a) => a !== "backstop").sort());
    const gap = r.unit + " pass 1: incomplete, the session ended missing (E_CLEAN_ROOM)";
    expect(tsv(r.first, "parses.tsv", "backstop")).toEqual([["incomplete", "", "the session ended missing (E_CLEAN_ROOM)"]]);
    expect(tsv(r.first, "terminations.tsv", "backstop")).toEqual([["missing:E_CLEAN_ROOM", "1", "false", "gap", ""]]);
    const j = armJson(r.first, "backstop");
    expect<unknown>({ status: j.status, stops: j.stops, diagnostics: j.diagnostics, coverage_gaps: j.coverage_gaps }).toEqual({ status: "stopped", stops: stopCounts(r, null, false), coverage_gaps: [gap] });
    expect(r.stops[0]).toEqual([gapStop("timeout0", r.unit + " pass 1: incomplete, the session ended timeout before any model output"), gapStop("backstop", gap)]);
  }, 180_000);

  // Value: protects=section 4's resume: with the drive gone, a second runReviewUnits with reuse from the journal (review-units --resume --repair) reruns only the refused cell, which now scores, and reuses every other arm's scored session unchanged; fails_when=the refusal was journaled and is reused, another cell reruns or its key drifts, or the rerun cell is not scored; why_new=GGST-6's backstop must cost one session, not a run; seam=readReviewJournal, runReviewUnits' reuse and the session key on SDK 0.3.314; no_claim=the CLI's --resume flag parsing
  test("a second run with the journal and the drive removed reruns only the refused cell and reuses the rest", () => {
    const r = run();
    expect(r.spawned[1]).toEqual({ backstop: 1 });
    for (const arm of ARMS.filter((a) => a !== "backstop")) expect([arm, records(r, 2, arm)]).toEqual([arm, []]);
    check(r.out, r, "backstop", { record: { termination: { kind: "completed" }, follow_up: { sent: true, model_turns: 1 }, model_output: true }, parse: findings(TWO), score: "findings", row: ["completed", "2", "true", "findings", "2"], arm: { status: "complete", stops: stopCounts(r, null, false) }, users: 2, lines: 2 }, 2);
    expect(readFileSync(join(r.out, "cells.ndjson"), "utf8").trim().split("\n").length).toBe(ARMS.length);
    for (const arm of ARMS.filter((a) => a !== "backstop")) {
      expect([arm, entryOf(r.out, r, arm)]).toEqual([arm, entryOf(r.first, r, arm)]);
      expect([arm, tsv(r.out, "terminations.tsv", arm)]).toEqual([arm, tsv(r.first, "terminations.tsv", arm)]);
    }
    expect(r.stops[1]).toEqual([gapStop("timeout0", r.unit + " pass 1: incomplete, the session ended timeout before any model output")]);
  }, 180_000);
});
