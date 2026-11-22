// Copyright (c) 2026 Garry Tan. MIT License.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
