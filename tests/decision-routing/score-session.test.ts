// Copyright (c) 2026 Garry Tan. MIT License.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { trialDirs } from "../../lanes/decision-routing/score/cli.ts";
import { callUsd, coverage, infraAttempts, pairOnTasks, readJournal, readTrial, rerunRows, taskRepo, type PriceTable } from "../../lanes/decision-routing/score/session.ts";

const roots: string[] = [];
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));
const tmp = () => { const d = mkdtempSync(join(tmpdir(), "dr-score-")); roots.push(d); return d; };

const prices: PriceTable = { date: "2026-11-08", models: {
  "anthropic:claude-opus-5-5": { input: 4, output: 20, cache_read: 0.2, cache_write: 5 },
  "typesafe:jev-1.13.0": { input: 0.042, output: 0 },
  "openrouter:particle-ai/particle-1": { input: 0.1, output: 1, cache_read: 0.003 },
} };

function journal(dir: string): string {
  const lines = [
    { kind: "request", reservation_id: "r1", provider: "anthropic", model: "claude-opus-5-5", cell: { meter_id: "m1" } },
    { kind: "outcome", reservation_id: "r1", meter_id: "m1", status: 200, outcome: { kind: "spent", spent_micros: 11000, usage: { input: 1000, output: 200, reasoning: 50, cache_read: 10000, cache_write: 0 } }, latency_ms: 900 },
    { kind: "request", reservation_id: "r2", provider: "typesafe", model: "jev-1.13.0", cell: { meter_id: "m1" } },
    { kind: "outcome", reservation_id: "r2", meter_id: "m1", status: 200, outcome: { kind: "spent", spent_micros: 210, usage: { input: 5000, output: 7, reasoning: 0, cache_read: 0, cache_write: 0 } }, latency_ms: 80 },
    { kind: "refusal", code: "DR_ALLOWANCE_STOP", meter_id: "m1" },
    { kind: "request", reservation_id: "r3", provider: "anthropic", model: "claude-opus-5-5", cell: { meter_id: "m2" } },
    { kind: "outcome", reservation_id: "r3", meter_id: "m2", status: 500, outcome: { kind: "spent", spent_micros: 0, usage: { input: 0, output: 0, reasoning: 0, cache_read: 0, cache_write: 0 } } },
  ];
  const p = join(dir, "journal.ndjson");
  writeFileSync(p, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  return p;
}

function trial(root: string, name: string, o: { exit?: string | null; reward?: string | null; resultReward?: number; meter?: string; agent?: boolean; exception?: string }): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  if (o.agent !== false) {
    mkdirSync(join(dir, "agent", "dr"), { recursive: true });
    if (o.exit !== null) writeFileSync(join(dir, "agent", "dr", "dr-summary.json"), JSON.stringify({ v: 1, session: name, cell: "R", model: "opus", exit_status: o.exit ?? "submitted", session_ms: 120000 }));
    writeFileSync(join(dir, "agent", "dr", "meter.json"), JSON.stringify({ meter_id: o.meter ?? "m1" }));
  }
  if (o.reward !== null && o.reward !== undefined) { mkdirSync(join(dir, "verifier"), { recursive: true }); writeFileSync(join(dir, "verifier", "reward.txt"), o.reward); }
  writeFileSync(join(dir, "result.json"), JSON.stringify({ task_name: "django__django-11099", ...(o.resultReward !== undefined ? { verifier_result: { rewards: { reward: o.resultReward } } } : {}), exception_info: o.exception ? { exception_type: o.exception } : null }));
  return dir;
}

describe("bill from the proxy journal and the dated price table", () => {
  test("prices fresh input, cache reads, and output with reasoning; TypeSafe bills input only", () => {
    const calls = readJournal([journal(tmp())]);
    const m1 = calls.get("m1")!;
    expect(m1).toHaveLength(2);
    expect(callUsd(m1[0]!, prices)).toBeCloseTo(0.004 + 0.005 + 0.002, 12);
    expect(callUsd(m1[1]!, prices)).toBeCloseTo(0.00021, 12);
  });
  test("a call with no price row is refused, never priced at zero", () => {
    expect(() => callUsd({ reservation_id: "x", provider: "openai", model: "gpt-9", status: 200, usage: { input: 1, output: 1, reasoning: 0, cache_read: 0, cache_write: 0 }, latency_ms: null }, prices)).toThrow(/price/);
  });
});

describe("session outcomes, section 10", () => {
  const root = tmp();
  const calls = readJournal([journal(root)]);
  const ctx = { calls, prices };
  test("a submitted session is graded with its reward, bill and time", () => {
    const s = readTrial(trial(root, "a", { reward: "1" }), ctx);
    expect(s).toMatchObject({ status: "graded", success: 1, cell: "R", model: "opus", task: "django__django-11099", repo: "django/django", time_ms: 120000 });
    expect(s.bill_usd).toBeCloseTo(0.01121, 10);
  });
  test("an allowance stop is graded and never a gap, spend counted", () => {
    const s = readTrial(trial(root, "b", { exit: "allowance_stop", reward: "0" }), ctx);
    expect(s.status).toBe("graded");
    expect(s.success).toBe(0);
    expect(s.bill_usd).toBeGreaterThan(0);
  });
  test("step and wall stops are graded", () => {
    expect(readTrial(trial(root, "c", { exit: "step_stop", reward: "1" }), ctx).status).toBe("graded");
    expect(readTrial(trial(root, "d", { exit: "wall_stop", reward: "0" }), ctx).status).toBe("graded");
  });
  test("infrastructure is missing, never a fail", () => {
    const s = readTrial(trial(root, "e", { exit: "infra_error", reward: "0", meter: "m2", exception: "DrInfraError" }), ctx);
    expect(s.status).toBe("missing");
    expect(s.success).toBeNull();
  });
  test("a Harbor exception without an allowance stop is missing; no reward is missing; no agent dir did not enter", () => {
    expect(readTrial(trial(root, "f", { exit: "submitted", reward: "1", exception: "EnvironmentStartTimeoutError" }), ctx).status).toBe("missing");
    expect(readTrial(trial(root, "g", { exit: "submitted", reward: null }), ctx).reason).toContain("reward");
    const s = readTrial(trial(root, "h", { agent: false, reward: null }), ctx);
    expect(s.status).toBe("missing");
    expect(s.entered).toBe(false);
  });
  test("reward falls back to result.json", () => {
    expect(readTrial(trial(root, "i", { reward: null, resultReward: 1 }), ctx).success).toBe(1);
  });
  test("task to repository cluster", () => {
    expect(taskRepo("django__django-11099")).toBe("django/django");
    expect(taskRepo("scikit-learn__scikit-learn-25747")).toBe("scikit-learn/scikit-learn");
    expect(() => taskRepo("nonsense")).toThrow();
  });
});

describe("coverage and pairing", () => {
  const s = (task: string, status: "graded" | "missing", entered = true) => ({ session: task, cell: "R", model: "opus" as const, task, repo: "x/y", status, reason: null, success: status === "graded" ? 1 as const : null, bill_usd: 1, time_ms: 1, exit_status: "submitted", entered, dir: "" });
  const planned = Array.from({ length: 10 }, (_, i) => "t" + i);
  test("90% graded holds, 80% voids", () => {
    expect(coverage(planned.map((t, i) => s(t, i < 9 ? "graded" : "missing")), planned).ok).toBe(true);
    expect(coverage(planned.map((t, i) => s(t, i < 8 ? "graded" : "missing")), planned).ok).toBe(false);
  });
  test("over 10% failing to enter voids even when enough are graded", () => {
    const c = coverage([...planned.map((t) => s(t, "graded")), s("t0", "missing", false), s("t1", "missing", false)], planned);
    expect(c.not_entered).toBe(2);
    expect(c.ok).toBe(false);
  });
  test("pairs only tasks graded in both cells", () => {
    const a = [s("t0", "graded"), s("t1", "graded"), s("t2", "missing")];
    const b = [s("t0", "graded"), s("t1", "missing"), s("t2", "graded")];
    expect(pairOnTasks(a, b).map((p) => p.task)).toEqual(["t0"]);
  });
});


describe("infrastructure reruns, prereg line 206", () => {
  const kept = (job: string, name: string, model = "opus", cell = "R") => {
    const dir = join(job, "dr-infra-attempts", name);
    mkdirSync(join(dir, "agent", "dr"), { recursive: true });
    writeFileSync(join(dir, "agent", "dr", "dr-summary.json"), JSON.stringify({ v: 1, session: name, cell, model, exit_status: "infra_error", session_ms: 1000 }));
    writeFileSync(join(dir, "attempt.json"), JSON.stringify({ trial: name, attempt: 1, cell, model, exit_status: "infra_error", successful_responses: 4, meter_id: "m-first", micros: 1500000 }));
  };
  test("a rerun after a mid-session provider error is scored once and the kept first attempt never is", () => {
    const job = join(tmp(), "job");
    const ctx = { calls: readJournal([journal(tmp())]), prices };
    kept(job, "t1__a");
    trial(job, "t1__a", { exit: "submitted", reward: "1" });
    const dirs = trialDirs(job);
    expect(dirs).toEqual([join(job, "t1__a")]);
    const sessions = dirs.map((d) => readTrial(d, ctx));
    expect(sessions.map((s) => [s.status, s.success])).toEqual([["graded", 1]]);
    expect(rerunRows(infraAttempts(job), sessions)).toEqual([{ model: "opus", cell: "R", reruns: 1, rerun_graded: 1, rerun_missing: 0, missing: 0 }]);
  });
  test("a second infrastructure failure is missing, and it counts as a rerun and a missing session in its cell", () => {
    const job = join(tmp(), "job");
    const ctx = { calls: readJournal([journal(tmp())]), prices };
    kept(job, "t2__b");
    trial(job, "t2__b", { exit: "infra_error", reward: "0", exception: "DrInfraError" });
    trial(job, "t3__c", { exit: "step_stop", reward: "0" });
    const sessions = trialDirs(job).map((d) => readTrial(d, ctx));
    expect(sessions.map((s) => s.status)).toEqual(["missing", "graded"]);
    expect(rerunRows(infraAttempts(job), sessions)).toEqual([{ model: "opus", cell: "R", reruns: 1, rerun_graded: 0, rerun_missing: 1, missing: 1 }]);
  });
});
