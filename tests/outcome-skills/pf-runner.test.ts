// Copyright (c) 2026 Garry Tan. MIT License.
import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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

// Real run scripts on local directories, one per tree: state reads bug on parent, fixed on fix and neutral on neutral.
const treeDirs = (files: Record<string, string> = {}) => {
  const root = mkdtempSync(join(tmpdir(), "pf-trees-"));
  const out = { parent: "", fix: "", neutral: "" };
  for (const [tree, state] of [["parent", "bug"], ["fix", "fixed"], ["neutral", "neutral"]] as const) {
    out[tree] = join(root, tree);
    for (const [p, text] of Object.entries({ state: state + "\n", ...files })) {
      mkdirSync(dirname(join(out[tree], p)), { recursive: true });
      writeFileSync(join(out[tree], p), text);
    }
  }
  return out;
};
const local = (rebuild: string[], nonce = () => "n" + randomUUID().replace(/-/g, "")): Executor => async (s) => {
  const dir = mkdtempSync(join(tmpdir(), "pf-run-"));
  cpSync(s.commit, dir, { recursive: true });
  const n = nonce();
  try {
    const p = spawnSync("bash", [], { input: entryScript(rebuild, dir, dir, 30, n, s.aside), env: { ...process.env, PF_CMD: s.command }, encoding: "utf8" });
    return readRun(p.stdout, false, 1, n);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

test("a check whose output ends without a newline scores by its exit code", async () => {
  const r = await scoreEntries([
    { index: 0, command: 'test "$(cat state)" = fixed && printf ok' },
    { index: 1, command: "grep -q fixed state && echo ok || printf ok; exit 0" },
    { index: 2, command: 'test "$(cat state)" = fixed && echo ok' },
  ], local([]), { trees: treeDirs(), timeout_s: 30, exempt: false });
  expect(r.results.map((x) => x.outcome)).toEqual(["catch", "no_catch", "catch"]);
  expect(r.results[0]!.runs.filter((x) => x.tree === "fix").map((x) => x.exit)).toEqual([0, 0, 0]);
  expect(r.results[1]!.runs.map((x) => x.tree + x.run + " " + x.exit)).toEqual(["parent1 0"]);
});

// The rebuild stands in for a build that compiles every test file, as mvn install -DskipTests does.
const COMPILES_TESTS = "! grep -rqs BROKEN t";
test("a broken file the agent added fails only the checks that compile it: the rebuild runs without it and it is back before the check", async () => {
  const entries = [{ index: 0, command: '! grep -qs BROKEN t/agent_test.x && test "$(cat state)" = fixed' }, { index: 1, command: 'test "$(cat state)" = fixed' }];
  const r = await scoreEntries(entries, local([COMPILES_TESTS]), { trees: treeDirs({ "t/agent_test.x": "BROKEN\n", "t/old_test.x": "ok\n" }), timeout_s: 30, exempt: false, aside: ["t/agent_test.x"] });
  expect(r.results.map((x) => x.outcome)).toEqual(["no_catch", "catch"]);
  expect(r.results.flatMap((x) => x.runs).some((x) => x.rebuild_failed)).toBe(false);
  expect(unitScore(r.results, null)).toEqual({ score: 1, gap: null });
});
test("a clean rebuild is unchanged by the move, and a rebuild that fails without the agent's files is still a gap", async () => {
  const trees = treeDirs({ "t/agent_test.x": "fine\n", "t/old_test.x": "ok\n" });
  const entries = [{ index: 0, command: 'test "$(cat state)" = fixed' }, { index: 1, command: "true" }];
  const read = (r: Awaited<ReturnType<typeof scoreEntries>>) => r.results.map((x) => x.outcome + " " + x.runs.map((y) => y.tree + y.run + ":" + y.exit + (y.rebuild_failed ? "!" : "")).join(","));
  const moved = await scoreEntries(entries, local([COMPILES_TESTS]), { trees, timeout_s: 30, exempt: false, aside: ["t/agent_test.x"] });
  const plain = await scoreEntries(entries, local([COMPILES_TESTS]), { trees, timeout_s: 30, exempt: false });
  expect(read(moved)).toEqual(read(plain));
  expect(moved.results.map((x) => x.outcome)).toEqual(["catch", "no_catch"]);
  const own = await scoreEntries([entries[0]!], local(["! grep -qs fixed state"]), { trees, timeout_s: 30, exempt: false, aside: ["t/agent_test.x"] });
  expect(own.results[0]!.outcome).toBe("gap");
});
test("an agent edit to one of the unit's existing test files stays in place, so the rebuild still sees it", async () => {
  const r = await scoreEntries([{ index: 0, command: 'test "$(cat state)" = fixed' }], local([COMPILES_TESTS]), { trees: treeDirs({ "t/agent_test.x": "fine\n", "t/old_test.x": "BROKEN\n" }), timeout_s: 30, exempt: false, aside: ["t/agent_test.x"] });
  expect(r.results[0]!.outcome).toBe("gap");
  expect(unitScore(r.results, null)).toEqual({ score: null, gap: "E_PF_REBUILD_FIX" });
});

const HASH = 'find . -type f | LC_ALL=C sort | while IFS= read -r f; do printf "%s %s %s\\n" "$(stat -c %a "$f")" "$f" "$(sha256sum < "$f" | cut -c1-64)"; done | sha256sum | cut -c1-64';
test("the moved files come back byte for byte, with their modes, before the check runs: the check's tree hash equals the tree's hash before the move", async () => {
  const src = mkdtempSync(join(tmpdir(), "pf-hash-"));
  const files: Record<string, string> = { state: "fixed\n", "t/agent test.x": "BROKEN\nno final newline", "t/new pkg/deep/a_test.x": "BROKEN\n", "t/run_check.sh": "#!/bin/sh\nexit 0\n", "t/old_test.x": "ok\n" };
  for (const [p, text] of Object.entries(files)) {
    mkdirSync(dirname(join(src, p)), { recursive: true });
    writeFileSync(join(src, p), text);
  }
  chmodSync(join(src, "t/run_check.sh"), 0o755);
  const before = spawnSync("bash", ["-c", HASH], { cwd: src, encoding: "utf8" }).stdout.trim();
  const aside = ["t/agent test.x", "t/new pkg/deep/a_test.x", "t/run_check.sh", "t/never_written_test.x"];
  const absent = "test ! -e 't/agent test.x' && test ! -e 't/new pkg/deep/a_test.x' && test ! -e t/run_check.sh && test -f t/old_test.x";
  const out = await local([absent])({ entry: 0, tree: "fix", run: 1, command: HASH, timeout_s: 30, commit: src, label: "hash", aside });
  expect(out.rebuild_exits).toEqual([0]);
  expect(out.exit).toBe(0);
  expect(before).toMatch(/^[0-9a-f]{64}$/);
  expect(out.log.match(/^[0-9a-f]{64}$/m)?.[0]).toBe(before);
});
test("a moved file that cannot be put back stops scoring with E_PF_INFRA_GAP before the check runs", async () => {
  const n = "nlost" + randomUUID().replace(/-/g, "");
  const ex = local(["rm -rf /tmp/pf-aside-" + n], () => n);
  const spec = { entry: 0, tree: "fix" as const, run: 1, command: "true", timeout_s: 30, commit: treeDirs({ "t/agent_test.x": "x\n" }).fix, label: "lost", aside: ["t/agent_test.x"] };
  await expect(ex(spec)).rejects.toThrow(/E_PF_INFRA_GAP/);
});
