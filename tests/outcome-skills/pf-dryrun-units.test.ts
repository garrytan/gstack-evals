// Copyright (c) 2026 Garry Tan. MIT License.
// The real-unit dry run's breaks line (section 9, the F1 change): N's three breaks runs must all finish, apply every fix
// test patch and break no stable test, and the line counts the stable tests a run's parser lost that the reading before
// F1 counted as breaks.
import { expect, test } from "bun:test";
import { breaksLine } from "../../lanes/outcome-skills/pfchecks/dryrun-units.ts";

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
