// Copyright (c) 2026 Garry Tan. MIT License.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { latestHold, main, recordInput, type GhRun, type WeekFile } from "../../lanes/weekly-stable/cli.ts";
import { weekBase, weekSeed } from "../../lanes/weekly-stable/plan.ts";
import { byWeekDesc, decide, stableTag, standingHold, type ShimOut } from "../../lanes/weekly-stable/resolve.ts";

// The resolver's real output against gstack on 2026-11-22 at 04:13 UTC (resolve-shim.ts on a full clone of garrytan/gstack).
const REAL: ShimOut = JSON.parse(readFileSync(join(import.meta.dir, "fixtures/resolve-2026-11-22.json"), "utf8"));
const MAIN = REAL.gstack_main!, STABLE = REAL.stable!;
const variant = (edit: (o: ShimOut) => void): ShimOut => { const o = structuredClone(REAL); edit(o); return o; };
const newer = variant((o) => { o.candidate = { ...o.candidate!, sha: MAIN, contains_stable: true, first_parent_commits_since_stable: 9, version: "1.102.3.0" }; o.walked = [{ sha: MAIN, green: true, via: "release gate run 123" }]; });

describe("the candidate, from gstack's release gate", () => {
  test("the real walk on 2026-11-22 found stable itself the newest green commit: no candidate, the week runs nothing", () => {
    expect(REAL.walked!.length).toBe(10);
    expect(REAL.walked!.at(-1)).toEqual({ sha: STABLE, green: true, via: REAL.walked!.at(-1)!.via });
    expect(REAL.walked!.slice(0, -1).every((w) => !w.green && w.why === "no main-backstop check run")).toBe(true);
    const d = decide(REAL);
    expect(d.kind).toBe("no-candidate");
    expect(d.stable).toEqual({ sha: STABLE, tag: "v1.102.2.0" });
  });
  test("a newer green commit that contains stable runs, with its gate evidence and the commit count", () => {
    const d = decide(newer);
    expect(d.kind).toBe("run");
    if (d.kind === "run") expect([d.candidate.sha, d.candidate.via, d.stable.tag, d.commits]).toEqual([MAIN, "release gate run 123", "v1.102.2.0", 9]);
  });
  test("a held candidate is never measured again; a later candidate runs", () => {
    expect(decide(newer, { sha: MAIN, week: "2026-W48" }).kind).toBe("held");
    expect(decide(newer, { sha: STABLE, week: "2026-W47" }).kind).toBe("run");
  });
  test("each failure the resolver can meet makes the week INCOMPLETE with its reason", () => {
    const why = (o: ShimOut) => { const d = decide(o); return d.kind === "run" ? "run" : d.kind + ": " + d.reason; };
    expect(why(variant((o) => { o.stable_tags = []; }))).toBe("incomplete: no v-tag points at stable dd611038ca41");
    expect(why(variant((o) => { o.notes_error = "cannot fetch"; }))).toMatch(/^incomplete: resolver: gstack's release-gate notes/);
    expect(why({ schema: 1, error: "gstack's release-cut.ts no longer exports gateVerdict" })).toBe("incomplete: resolver: gstack's release-cut.ts no longer exports gateVerdict");
    expect(why(variant((o) => { o.candidate = { ...newer.candidate!, contains_stable: false }; }))).toMatch(/^incomplete: the candidate .* does not contain stable/);
    expect(why(variant((o) => { o.candidate = null; }))).toMatch(/^no-candidate: no candidate: no commit/);
  });
  test("stable's tag is the newest v-tag by version", () => {
    expect(stableTag(["v1.9.0.0", "v1.10.0.0", "latest", "v1.10.0"])).toBe("v1.10.0.0");
    expect(stableTag(["nightly"])).toBeNull();
  });
});

describe("the HOLD that stands", () => {
  const rec = (week: string, verdict: string, sha = "a".repeat(40)) => ({ week, verdict, candidate: { sha } });
  test("an INCOMPLETE week never clears a HOLD, and a HOLD never goes stale; a later non-HOLD record replaces it", () => {
    expect(standingHold([rec("2027-W05", "INCOMPLETE", "b".repeat(40)), rec("2027-W04", "INCOMPLETE"), rec("2026-W48", "HOLD")])).toEqual({ sha: "a".repeat(40), week: "2026-W48" });
    expect(standingHold([rec("2026-W49", "NO_CHANGE", "b".repeat(40)), rec("2026-W48", "HOLD")])).toBeNull();
    expect(standingHold([])).toBeNull();
  });
  test("weekly tags sort newest week first, a correction before the week's earlier records", () => {
    expect(["weekly-2026-w48", "weekly-2026-w49", "weekly-2026-w48-r2", "weekly-2026-w48-r10", "weekly-2026-w48-r1"].sort(byWeekDesc)).toEqual(["weekly-2026-w49", "weekly-2026-w48-r10", "weekly-2026-w48-r2", "weekly-2026-w48-r1", "weekly-2026-w48"]);
  });
});

describe("a re-measure keeps the week it re-measures", () => {
  const w: WeekFile = { date: "2026-11-30", week_of: "2026-11-28", base: weekBase("2026-11-30", 1), seed: weekSeed("2026-11-30"), start: "2026-11-30T12:00:00.000Z", decision: decide(newer, null), held: null, candidate: MAIN, stable: STABLE, stable_tag: "v1.102.2.0", dropped: [], setup_failed: [], contamination: null, smoke: null };
  test("a re-measure run on a Monday keeps the earlier week's tag", () => {
    const r = recordInput(w, "pass");
    expect([r.tag, r.input.week, r.input.supersedes]).toEqual(["weekly-2026-w48-r1", "2026-W48", "weekly-2026-w48"]);
    expect(recordInput({ ...w, week_of: null, base: weekBase("2026-11-30") }, "pass").tag).toBe("weekly-2026-w49");
  });
  test("resolve refuses a re-measure without --week, --week without --remeasure, a --week after the run date and a date that does not exist, before reading any record", async () => {
    const dir = mkdtempSync(join(tmpdir(), "weekly-resolve-"));
    try {
      expect(await main(["resolve", dir, "--remeasure", "1"])).toBe(2);
      expect(await main(["resolve", dir, "--week", "2026-11-28"])).toBe(2);
      expect(await main(["resolve", dir, "--remeasure", "1", "--week", "2026-12-05", "--now", "2026-11-30T12:00:00Z"])).toBe(2);
      for (const bad of ["2026-02-30", "2026-11-31", "2026-13-01"]) expect(await main(["resolve", dir, "--remeasure", "1", "--week", bad, "--now", "2026-11-30T12:00:00Z"])).toBe(2);
      writeFileSync(join(dir, "week.json"), "{}");
      expect(await main(["resolve", dir])).toBe(2);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("the HOLD lookup through gh, ordered by run start (gh's list and failure output and a weekly.json the CLI wrote, recorded on 2026-11-22)", () => {
  const FIX = join(import.meta.dir, "fixtures"), listed: { tagName: string }[] = JSON.parse(readFileSync(join(FIX, "gh-release-list.json"), "utf8"));
  const table = readFileSync(join(FIX, "gh-release-list-table.txt"), "utf8"), missing = readFileSync(join(FIX, "gh-release-download-missing.txt"), "utf8");
  const REC = JSON.parse(readFileSync(join(FIX, "weekly-record.json"), "utf8"));
  const rec = (week: string, verdict: string, start: string, sha = "a".repeat(40)) => ({ ...REC, week, verdict, candidate: { sha }, window: { start, end: start } });
  const fake = (recs: Record<string, object>, stdout = JSON.stringify([...listed, ...Object.keys(recs).map((tagName) => ({ tagName }))])): GhRun => (args) => {
    if (args[1] === "list") return { status: 0, stdout, stderr: "" };
    const r = recs[args[2]!];
    return r ? { status: 0, stdout: JSON.stringify(r), stderr: "" } : { status: 1, stdout: "", stderr: missing };
  };
  const B = "b".repeat(40), C = "c".repeat(40);
  test("gh's real list is objects with a tagName", () => expect(Object.keys(listed[0]!)).toEqual(["tagName"]));
  test("pass 1's order: an earlier re-measure that is NO_CHANGE does not hide the later regular HOLD of the same week", () => {
    const recs = { "weekly-2026-w48": rec("2026-W48", "HOLD", "2026-11-28T10:00:00.000Z"), "weekly-2026-w49-r1": rec("2026-W49", "NO_CHANGE", "2026-11-30T12:00:00.000Z", C), "weekly-2026-w49": rec("2026-W49", "HOLD", "2026-12-05T10:00:00.000Z", B) };
    expect(latestHold(fake(recs))).toEqual({ held: { sha: B, week: "2026-W49" } });
  });
  test("pass 2's order: a re-measure HOLD that started after a later week's regular non-HOLD stands", () => {
    const recs = { "weekly-2026-w48": rec("2026-W48", "HOLD", "2026-11-28T10:00:00.000Z"), "weekly-2026-w49": rec("2026-W49", "NO_CHANGE", "2026-12-05T10:00:00.000Z", B), "weekly-2026-w48-r1": rec("2026-W48", "HOLD", "2026-12-07T12:00:00.000Z", C) };
    expect(latestHold(fake(recs))).toEqual({ held: { sha: C, week: "2026-W48" } });
  });
  test("an INCOMPLETE record published after a HOLD does not hide it, whatever its tag", () => {
    const recs = { "weekly-2026-w49": rec("2026-W49", "HOLD", "2026-12-05T10:00:00.000Z", B), "weekly-2026-w48-r1": rec("2026-W48", "INCOMPLETE", "2026-12-07T12:00:00.000Z", C), "weekly-2026-w50": rec("2026-W50", "INCOMPLETE", "2026-12-12T10:00:00.000Z", C) };
    expect(latestHold(fake(recs))).toEqual({ held: { sha: B, week: "2026-W49" } });
  });
  test("a failed download, a list that is not JSON or a record whose window.start does not parse is an error, so the week is INCOMPLETE", () => {
    const recs = { "weekly-2026-w48": rec("2026-W48", "HOLD", "2026-11-28T10:00:00.000Z"), "weekly-2026-w49": rec("2026-W49", "NO_CHANGE", "2026-12-05T10:00:00.000Z", B) };
    const gone = fake(recs, JSON.stringify([...listed, { tagName: "weekly-2026-w49" }, { tagName: "weekly-2026-w49-r1" }]));
    expect(latestHold(gone)).toEqual({ error: "gh release download weekly-2026-w49-r1 failed: release not found" });
    const r = latestHold(fake(recs, table));
    expect("error" in r && r.error.startsWith("gh release list did not return JSON: gstack v1.102.2.0")).toBe(true);
    expect(latestHold(fake({ ...recs, "weekly-2026-w50": { ...rec("2026-W50", "NO_CHANGE", "x"), window: { end: "2026-12-12T10:00:00.000Z" } } }))).toEqual({ error: "weekly-2026-w50's window.start is not a time" });
  });
  test("a record whose verdict is missing or unknown is an error, never a record that clears a HOLD", () => {
    const recs = { "weekly-2026-w48": rec("2026-W48", "HOLD", "2026-11-28T10:00:00.000Z"), "weekly-2026-w49": rec("2026-W49", "MAYBE", "2026-12-05T10:00:00.000Z", B) };
    expect(latestHold(fake(recs))).toEqual({ error: "weekly-2026-w49's verdict MAYBE is not HOLD, GAIN, NO_CHANGE or INCOMPLETE" });
  });
  test("no weekly record is no HOLD", () => expect(latestHold(fake({}))).toEqual({ held: null }));
});
