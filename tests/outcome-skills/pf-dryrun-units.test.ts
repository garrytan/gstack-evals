// Copyright (c) 2026 Garry Tan. MIT License.
// The real-unit dry run's breaks line (section 9, the F1 change): N's three breaks runs must all finish, apply every fix
// test patch and break no stable test, and the line counts the stable tests a run's parser lost that the reading before
// F1 counted as breaks.
import { expect, test } from "bun:test";
import { breaksLine, hangReading } from "../../lanes/outcome-skills/pfchecks/dryrun-units.ts";

const stable = ["a", "b", "c", "d"];
const all = { a: "pass", b: "pass", c: "pass", d: "pass" };
const ran = (runs: (Record<string, string> | null)[], skipped: string[] = [], unmeasured: string | null = null) => ({ runs, skipped, unmeasured });

test("breaksLine passes when tests lost from one or two runs are dropped, and names how many the old reading counted", () => {
  const runs: Record<string, string>[] = [{ a: "pass", b: "pass" }, { a: "pass", c: "pass", d: "pass" }, { a: "pass", b: "pass", d: "pass" }];
  const l = breaksLine(stable, ran(runs), []);
  expect(l.ok).toBe(true);
  expect(l.detail).toContain("ids lost per run [2,1,1]");
  expect(l.detail).toContain("breaks under the reading before F1 1");
  expect(l.detail).toContain("skipped none");
  expect(l.detail).toContain("breaks 0");
});

test("breaksLine fails on a stopped run, a missing run, a real break, no breaks record, a skipped patch or breaks not measured", () => {
  expect(breaksLine(stable, ran([all, null, all]), []).ok).toBe(false);
  expect(breaksLine(stable, ran([all, all]), []).ok).toBe(false);
  expect(breaksLine(stable, null, null).ok).toBe(false);
  const failing = { ...all, b: "fail" };
  const l = breaksLine(stable, ran([failing, failing, all]), ["b"]);
  expect(l.ok).toBe(false);
  expect(l.detail).toContain("breaks 1 (b)");
  expect(breaksLine(stable, ran([all, all, all], ["test.patch"]), []).ok).toBe(false);
  const u = breaksLine(stable, ran([all, {}, all], ["test.patch"], "run 2 built nothing (rebuild_failed) after skipping test.patch"), null);
  expect(u.ok).toBe(false);
  expect(u.detail).toContain("not measured: run 2 built nothing");
});

// The agentscope-java-2257 dry run's P scoring: per entry its outcome, why, and runs as [tree, run, wall_ms, timed out, exit].
const AGENTSCOPE: Array<{ i: number; o: string; w: string; r: Array<[string, number, number, number, number]> }> = [
  {"i": 0, "o": "catch", "w": "caught", "r": [["p", 1, 282442, 0, 1], ["p", 2, 250861, 0, 1], ["p", 3, 189783, 0, 1], ["f", 1, 253373, 0, 0], ["f", 2, 184902, 0, 0], ["f", 3, 187002, 0, 0], ["n", 1, 182666, 0, 1], ["n", 2, 183292, 0, 1], ["n", 3, 187343, 0, 1]]},
  {"i": 1, "o": "no_catch", "w": "failed on fix run 1", "r": [["p", 1, 298609, 0, 1], ["p", 2, 224933, 0, 1], ["p", 3, 188770, 0, 1], ["f", 1, 227142, 0, 1]]},
  {"i": 2, "o": "no_catch", "w": "passed on parent run 1", "r": [["p", 1, 273952, 0, 0]]},
  {"i": 3, "o": "no_catch", "w": "passed on parent run 1", "r": [["p", 1, 289461, 0, 0]]},
  {"i": 4, "o": "no_catch", "w": "passed on neutral run 1", "r": [["p", 1, 189358, 0, 1], ["p", 2, 188566, 0, 1], ["p", 3, 181058, 0, 1], ["f", 1, 190390, 0, 0], ["f", 2, 179035, 0, 0], ["f", 3, 179359, 0, 0], ["n", 1, 178478, 0, 0]]},
  {"i": 5, "o": "no_catch", "w": "passed on neutral run 1", "r": [["p", 1, 191363, 0, 1], ["p", 2, 188549, 0, 1], ["p", 3, 184445, 0, 1], ["f", 1, 191630, 0, 0], ["f", 2, 180822, 0, 0], ["f", 3, 188629, 0, 0], ["n", 1, 179500, 0, 0]]},
  {"i": 6, "o": "no_catch", "w": "failed on fix run 1", "r": [["p", 1, 193393, 0, 1], ["p", 2, 186366, 0, 1], ["p", 3, 183864, 0, 1], ["f", 1, 185272, 0, 1]]},
  {"i": 7, "o": "no_catch", "w": "failed on fix run 1", "r": [["p", 1, 193496, 0, 127], ["p", 2, 186110, 0, 127], ["p", 3, 184391, 0, 127], ["f", 1, 186018, 0, 127]]},
  {"i": 8, "o": "no_catch", "w": "passed on parent run 1", "r": [["p", 1, 201985, 0, 0]]},
  {"i": 9, "o": "unreached", "w": "ceiling before neutral run 3", "r": [["p", 1, 1955935, 1, 124], ["p", 2, 1949878, 1, 124], ["p", 3, 1931078, 1, 124], ["f", 1, 183520, 0, 0], ["f", 2, 183115, 0, 0], ["f", 3, 187104, 0, 0], ["n", 1, 1945295, 1, 124], ["n", 2, 1928903, 1, 124]]},
  {"i": 10, "o": "catch", "w": "caught", "r": [["p", 1, 195918, 0, 1], ["p", 2, 186809, 0, 1], ["p", 3, 180081, 0, 1], ["f", 1, 183892, 0, 0], ["f", 2, 183140, 0, 0], ["f", 3, 183268, 0, 0], ["n", 1, 175807, 0, 1], ["n", 2, 174235, 0, 1], ["n", 3, 174361, 0, 1]]},
  {"i": 13, "o": "catch", "w": "caught", "r": [["p", 1, 195882, 0, 1], ["p", 2, 182866, 0, 1], ["p", 3, 178560, 0, 1], ["f", 1, 185609, 0, 0], ["f", 2, 184794, 0, 0], ["f", 3, 186486, 0, 0], ["n", 1, 176177, 0, 1], ["n", 2, 174649, 0, 1], ["n", 3, 168828, 0, 1]]},
  {"i": 14, "o": "no_catch", "w": "failed on fix run 1", "r": [["p", 1, 192178, 0, 1], ["p", 2, 184230, 0, 1], ["p", 3, 178217, 0, 1], ["f", 1, 177056, 0, 1]]},
  {"i": 16, "o": "no_catch", "w": "failed on fix run 1", "r": [["p", 1, 175214, 0, 12], ["p", 2, 176270, 0, 12], ["p", 3, 171762, 0, 12], ["f", 1, 175318, 0, 12]]},
];
const TREE: Record<string, "parent" | "fix" | "neutral"> = { p: "parent", f: "fix", n: "neutral" };
const entries = () => AGENTSCOPE.map((e) => ({ index: e.i, outcome: e.o, why: e.w, runs: e.r.map(([t, run, wall_ms, to, exit]) => ({ tree: TREE[t]!, run, wall_ms, timed_out: to === 1, exit, pass: exit === 0 && to === 0 })) }));

test("the hang line is N/A when the replayed scheduler with no setup time still starts the hang's next run after the ceiling", () => {
  const h = hangReading(entries(), 9);
  expect(h.state).toBe("N/A");
  expect(h.detail).toContain("starts neutral run 3 at 11751 s, against the 10800 s ceiling: its own runs before it take 10265 s and it waits 1486 s");
});

test("the hang line fails when the replayed start is inside the ceiling, or a run does not match a catch, and passes on a catch", () => {
  expect(hangReading(entries(), 9, 12_000_000).state).toBe("FAIL");
  const broken = entries();
  broken.find((e) => e.index === 9)!.runs[3]!.pass = false;
  expect(hangReading(broken, 9).state).toBe("FAIL");
  const caught = entries();
  const h = caught.find((e) => e.index === 9)!;
  Object.assign(h, { outcome: "catch", why: "caught" });
  h.runs.push({ tree: "neutral", run: 3, wall_ms: 1_930_000, timed_out: true, exit: 124, pass: false });
  expect(hangReading(caught, 9).state).toBe("PASS");
  h.runs[0]!.timed_out = false;
  expect(hangReading(caught, 9).state).toBe("FAIL");
  expect(hangReading(entries(), 99).state).toBe("FAIL");
});
