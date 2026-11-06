// Copyright (c) 2026 Garry Tan. MIT License.
// The mechanical extractor (prereg section 4, plan 6.4): candidates with cited events, lists in record order, strata
// and the size check. Synthetic histories only.
import { expect, test } from "bun:test";
import { admitsSize, extract, run } from "../../lanes/tbv/extract.ts";
import { historySha256 } from "../../lanes/tbv/history/events.ts";
import { assembleB } from "../../lanes/tbv/history/source-b.ts";
import type { History, HistoryEvent } from "../../lanes/tbv/types.ts";
import { codeOf, pr } from "./history-helpers.ts";

type Step = [cmd: string, out: string, isError?: boolean, name?: string];
function histA(steps: Step[], side: Partial<History["side"]> = {}): History {
  const events: HistoryEvent[] = [{ n: 1, kind: "user-text", text: "Fix it." }];
  steps.forEach(([cmd, out, isError, name], i) => {
    const id = "toolu_" + i;
    events.push({ n: events.length + 1, kind: "tool-use", id, name: name ?? "Bash", input: name ? { file_path: cmd } : { command: cmd } });
    events.push({ n: events.length + 1, kind: "tool-result", tool_use_id: id, content: out, is_error: isError ?? false });
  });
  return { schema: "tbv-history.v1", source: "A", task: "demo", cluster: "demo", family: "investigate", events, sha256: historySha256(events), side: { files: [], resolved: false, patch: null, ...side } };
}
const lines = (n: number, flagAt: number[], st = "FAILED") => Array.from({ length: n }, (_, i) => "tests/test_m.py::test_" + (i + 1) + " " + (flagAt.includes(i + 1) ? st : "PASSED")).join("\n");

test("pytest and unittest lines become test candidates citing their result event, with node id, base and last names", () => {
  const h = histA([
    ["pytest -q", "tests/test_a.py::TestX::test_one[p1] FAILED\ntests/test_a.py::TestX::test_two PASSED\nSKIPPED tests/test_b.py::test_three"],
    ["python -m unittest", "test_four (pkg.tests.TestY) ... ERROR\ntest_five (pkg.tests.TestY) ... ok"],
  ]);
  const x = extract(h);
  expect(x.candidates.filter((c) => c.kind === "test").map((c) => [c.name, c.state, c.events])).toEqual([
    ["tests/test_a.py::TestX::test_one[p1]", "FAILED", [3]],
    ["tests/test_b.py::test_three", "SKIPPED", [3]],
    ["pkg.tests.TestY.test_four", "ERROR", [5]],
  ]);
  expect(x.candidates[0].names).toEqual(["tests/test_a.py::testx::test_one[p1]", "tests/test_a.py::testx::test_one", "test_one"]);
  expect(x.lists.map((l) => l.map((i) => [i.name, i.flagged]))).toEqual([
    [["tests/test_a.py::TestX::test_one[p1]", true], ["tests/test_a.py::TestX::test_two", false], ["tests/test_b.py::test_three", true]],
    [["pkg.tests.TestY.test_four", true], ["pkg.tests.TestY.test_five", false]],
  ]);
  expect(x).toMatchObject({ schema: "tbv-extract.v1", task: "demo", history_sha256: h.sha256 });
});

test("summaries without item lines, missing modules and commands, nonzero exits outside routine probes, config paths", () => {
  const h = histA([
    ["cd /testbed && pytest tests/test_c.py", "===== 2 failed, 5 passed in 1.2s ====="],
    ["python run.py", "ModuleNotFoundError: No module named 'yaml'"],
    ["make build", "make: *** [build] Error 2", true],
    ["grep -r foo src", "", true],
    ["git diff HEAD", "fatal", true],
    ["setup.cfg", "edited", false, "Edit"],
    ["tox -e py", "tox: command not found", true],
  ], { files: ["setup.cfg", "src/m.py"] });
  const c = extract(h).candidates.map((x) => [x.kind, x.name, x.state, x.events, x.material]);
  expect(c).toEqual([
    ["test-summary", "tests/test_c.py", "summary", [3], true],
    ["env", "yaml", "missing", [5], true],
    ["exit", "make", "nonzero", [6, 7], false],
    ["env", "tox", "missing", [15], true],
    ["exit", "tox", "nonzero", [14, 15], true],
    ["config", "setup.cfg", "changed", [12], true],
  ]);
});

test("strata: long needs 15 to 40 items with a flag at position 11 or later; short a longest list of 2 to 8 with a flag", () => {
  expect(extract(histA([["pytest", lines(20, [12])]])).stratum).toBe("long");
  expect(extract(histA([["pytest", lines(20, [11])]])).stratum).toBe("long");
  expect(extract(histA([["pytest", lines(20, [10])]])).stratum).toBe("other");
  expect(extract(histA([["pytest", lines(41, [30])]])).stratum).toBe("other");
  expect(extract(histA([["pytest", lines(5, [2], "SKIPPED")]])).stratum).toBe("short");
  expect(extract(histA([["pytest", lines(9, [2])]])).stratum).toBe("other");
  const x = extract(histA([["pytest", lines(3, [])], ["pytest", lines(5, [5])]]));
  expect([x.stratum, x.longest.length]).toEqual(["short", 5]);
});

test("clean needs no flag, every test passed and, for source A, the verifier resolved", () => {
  expect(extract(histA([["pytest", lines(4, []) + "\n=== 4 passed in 0.1s ==="]], { resolved: true })).stratum).toBe("clean");
  expect(extract(histA([["pytest", lines(4, [])]], { resolved: false })).stratum).toBe("none");
  expect(extract(histA([["pytest", "=== 4 passed, 1 skipped in 0.1s ==="]], { resolved: true })).stratum).not.toBe("clean");
});

test("source B: failed checks, not-passed checks at the head, unresolved findings and changed config paths, each cited", () => {
  const r = assembleB(pr(), "pr-12");
  if (!r.ok) throw new Error(r.drop);
  const x = extract(r.history);
  expect(x.candidates.map((c) => [c.kind, c.name, c.state, c.events])).toEqual([
    ["check", "test", "FAILURE", [5]],
    ["finding", "The parser drops trailing commas.", "unresolved", [13]],
    ["config", ".github/workflows/ci.yml", "changed", [11]],
  ]);
  expect(x.lists.map((l) => l.map((i) => [i.name, i.state, i.flagged]))).toEqual([[["test", "FAILURE", true], ["test", "SUCCESS", false]], [["The parser drops trailing commas.", "unresolved", true]]]);
  expect(x.stratum).toBe("short");
  const head = (conclusion: string) => pr({ files: [{ path: "src/a.ts", additions: 1, deletions: 0 }], reviewThreads: [], commits: [{ ...pr().commits[1], checks: [{ name: "test", conclusion, status: "COMPLETED", title: null, summary: null, text: null }] }] });
  const hb = (p: ReturnType<typeof pr>) => {
    const a = assembleB(p, "pr-12");
    if (!a.ok) throw new Error(a.drop);
    return extract(a.history);
  };
  expect(hb(head("SUCCESS")).stratum).toBe("clean");
  expect(hb(head("CANCELLED")).candidates.map((c) => c.state)).toEqual(["CANCELLED"]);
  expect(hb(head("SKIPPED")).candidates).toEqual([]);
  expect(hb(head("SKIPPED")).stratum).toBe("none");
});

test("tokens are history characters / 3, the history's sha256 is checked, and admitsSize uses the larger overhead", () => {
  const h = histA([["ls", "a"]]);
  const chars = "Fix it.".length + JSON.stringify({ command: "ls" }).length + 1;
  expect(extract(h).tokens).toBe(Math.ceil(chars / 3));
  expect(codeOf(() => extract({ ...h, sha256: "0".repeat(64) }))).toBe("E_TBV_HISTORY");
  expect(admitsSize(90_000, 30_000)).toBe(true);
  expect(admitsSize(90_001, 40_000)).toBe(false);
  expect(admitsSize(80_000, 50_000)).toBe(true);
  expect(admitsSize(80_001, 50_000)).toBe(false);
});

test("extract command reads a history file and prints the extract", async () => {
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join((await import("node:os")).tmpdir(), "tbv-extract-"));
  writeFileSync(join(dir, "h.json"), JSON.stringify(histA([["pytest", lines(3, [1])]])));
  const out: string[] = [];
  expect(await run(["extract", "--history", join(dir, "h.json")], { out: (s) => out.push(s), err: (s) => out.push(s) })).toBe(0);
  expect(JSON.parse(out.join("")).stratum).toBe("short");
});
