// Copyright (c) 2026 Garry Tan. MIT License.
import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { entryScript, entryTimeout, LOG_TAIL, readRun, scoreEntries, unitScore, type Executor, type RunSpec } from "../../lanes/outcome-skills/pfchecks/runner.ts";

const trees = { parent: "P", fix: "F", neutral: "N" };
const run = (rule: (s: RunSpec) => number, rebuild: (s: RunSpec) => number = () => 0): Executor & { calls: RunSpec[]; peak: number } => {
  let live = 0;
  const calls: RunSpec[] = [];
  const ex = Object.assign(async (s: RunSpec) => {
    calls.push(s);
    ex.peak = Math.max(ex.peak, ++live);
    await new Promise((r) => setTimeout(r, 1));
    live--;
    return { exit: rule(s), timed_out: false, wall_ms: 1, rebuild_exits: [rebuild(s)], log: "" };
  }, { calls, peak: 0 });
  return ex;
};
const o = { trees, timeout_s: 300, exempt: false };
test("the catch rule, run order and early stops", async () => {
  const ex = run((s) => (s.command === "catch" ? (s.tree === "fix" ? 0 : 1) : s.command === "pass" ? 0 : s.command === "fail" ? 1 : s.tree === "neutral" ? 0 : s.tree === "fix" ? 0 : 1));
  const r = await scoreEntries([{ index: 0, command: "catch" }, { index: 1, command: "pass" }, { index: 2, command: "fail" }, { index: 3, command: "detector" }], ex, o);
  expect(r.results.map((x) => x.outcome)).toEqual(["catch", "no_catch", "no_catch", "no_catch"]);
  expect(r.results[1]!.runs.length).toBe(1);
  expect(r.results[2]!.runs.map((x) => x.tree + x.run)).toEqual(["parent1", "parent2", "parent3", "fix1"]);
  expect(r.results[3]!.why).toBe("passed on neutral run 1");
  expect(r.results[0]!.runs.length).toBe(9);
  expect(ex.calls.slice(0, 4).every((c) => c.tree === "parent" && c.run === 1)).toBe(true);
  expect(unitScore(r.results, null)).toEqual({ score: 1, gap: null });
});
test("a fix-tree rebuild failure is a gap unless the unit is rebuild-exempt; parent rebuild failures count the entry's result", async () => {
  const rule = (s: RunSpec) => (s.tree === "fix" ? 0 : 1);
  const rb = (s: RunSpec) => (s.tree === "fix" || s.tree === "parent" ? 1 : 0);
  const g = await scoreEntries([{ index: 0, command: "x" }], run(rule, rb), o);
  expect(g.results[0]!.outcome).toBe("gap");
  expect(unitScore(g.results, null)).toEqual({ score: null, gap: "E_PF_REBUILD_FIX" });
  const e = await scoreEntries([{ index: 0, command: "x" }], run(rule, rb), { ...o, exempt: true });
  expect(e.results[0]!.outcome).toBe("catch");
  expect(unitScore([], "E_PF_FIX_CONFLICT")).toEqual({ score: null, gap: "E_PF_FIX_CONFLICT" });
  expect(unitScore([], null)).toEqual({ score: 0, gap: null });
});
test("at most 4 runs at once, and the ceiling leaves entries unreached", async () => {
  const ex = run((s) => (s.tree === "fix" ? 0 : 1));
  await scoreEntries(Array.from({ length: 9 }, (_, i) => ({ index: i, command: "c" + i })), ex, o);
  expect(ex.peak).toBe(4);
  let t = 0;
  const r = await scoreEntries([{ index: 0, command: "a" }, { index: 1, command: "b" }], run(() => 1), { ...o, ceiling_ms: 2, now: () => t++ });
  expect(r.ceiling_hit).toBe(true);
  expect(r.results.some((x) => x.outcome === "unreached")).toBe(true);
});
test("the entry timeout clamp and the run script markers", () => {
  const u = (ms: number[]) => ({ oracle: { runs: ms.map((wall_ms) => ({ tree: "fixed" as const, n: 1, wall_ms, exit: 0, parsed_sha256: null, stopped: false })) } as any });
  expect(entryTimeout(u([10_000]))).toBe(300);
  expect(entryTimeout(u([200_000, 150_000]))).toBe(600);
  expect(entryTimeout(u([900_000]))).toBe(1800);
  expect(entryScript(["make"], "/r", "/w", 300, "n1")).toContain("timeout -k 10 300");
  const out = readRun("PF_REBUILD_n1 2\nPF_ENTRY_n1 0\nPF_ENTRY_n1 0\nPF_ENTRY_n1 1\n", false, 5, "n1");
  expect(out).toMatchObject({ exit: 1, rebuild_exits: [2], timed_out: false });
  expect(readRun("PF_ENTRY_n1 0\n", true, 5, "n1")).toMatchObject({ exit: -1, timed_out: true });
});

test("a fix-tree rebuild failure followed by more than 80,000 characters of entry output is still gap E_PF_REBUILD_FIX", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pf-tail-"));
  const p = spawnSync("bash", [], { input: entryScript(["exit 3"], dir, dir, 30, "n9"), env: { ...process.env, PF_CMD: "yes x | head -c 90000; echo; exit 1" }, encoding: "utf8", maxBuffer: 1 << 24 });
  expect(p.stdout.length).toBeGreaterThan(4 * LOG_TAIL);
  const out = readRun(p.stdout.slice(-4 * LOG_TAIL), false, 1, "n9");
  expect(out.rebuild_exits).toEqual([3]);
  const r = await scoreEntries([{ index: 0, command: "x" }], async () => out, { trees: { parent: "p", fix: "f", neutral: "n" }, timeout_s: 30, exempt: false });
  expect(r.results[0]!.outcome).toBe("gap");
  expect(unitScore(r.results, null)).toEqual({ score: null, gap: "E_PF_REBUILD_FIX" });
});
