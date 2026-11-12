// Value: protects=the constructed run from the pilot to the quotas and the cap, the real run end to end, and what both write under custody.
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { schedule } from "../../../lanes/office-hours-founder/author/draws.ts";
import { openSink } from "../../../lanes/office-hours-founder/author/files.ts";
import { FIXTURE, FIXTURE_ASKS, REAL_FILES, REAL_PAGE, happy, stubCaller, wordLabeller } from "../../../lanes/office-hours-founder/author/fixtures.ts";
import { authorReal, type Fetch } from "../../../lanes/office-hours-founder/author/real.ts";
import { MAX_DRAWS, authorConstructed, writeConstructed, writeReal } from "../../../lanes/office-hours-founder/author/run.ts";
import { vocabulary } from "../../../lanes/office-hours-founder/author/screens.ts";
import type { CallRequest } from "../../../lanes/product-value/meter.ts";

const DRAWS = schedule(MAX_DRAWS);
const screen = vocabulary(FIXTURE_ASKS);
/** Answers the type label with the draw's own type, so the quotas' type minimums can fill. */
const typed = (over: (r: CallRequest) => string | null | undefined = () => undefined) => {
  const route = happy(FIXTURE);
  return stubCaller((r) => {
    const o = over(r);
    if (o !== undefined) return o;
    const m = /^[ch](\d+)t?:type:/.exec(r.label);
    return m ? JSON.stringify({ type: DRAWS[Number(m[1]) - 1]!.type, stage: "pre-product" }) : route(r);
  });
};
const sink = () => openSink(join(mkdtempSync(join(tmpdir(), "of-run-")), "sink"));

describe("authorConstructed", () => {
  test("runs the pilot, fills every quota with its minimums and gives the first 8 calibration units their skins", async () => {
    const call = typed();
    const run = await authorConstructed({ call, label: wordLabeller(), screen, spent: () => 1 }, { cap: 100, concurrency: 8, mdd: () => 0.12, ceiling: false });
    expect(run.stopped).toBe("quotas");
    expect(run.projection).toMatchObject({ passing: 4, fits: true });
    expect(run.sets.calibration).toHaveLength(16);
    expect(run.sets.comparison).toHaveLength(64);
    expect(run.sets.reserve).toHaveLength(6);
    expect(run.twins.map((t) => t.id)).toEqual(run.sets.calibration.slice(0, 8).map((m) => m.id + "t"));
    const s = sink();
    const summary = writeConstructed(s, run);
    expect(summary.comparison.size).toBe(64);
    expect(Object.values(summary.comparison.shapes).every((n) => n >= 6)).toBe(true);
    expect(summary.twins.passed).toBe(8);
    expect(readdirSync(join(s, "units"))).toHaveLength(16 + 64 + 6 + 8);
    expect(existsSync(join(s, "constructed", "outcomes.jsonl"))).toBe(true);
  });
  test("stops at the cap after the pilot", async () => {
    let calls = 0;
    const call = typed(() => (calls++, undefined));
    const run = await authorConstructed({ call, label: wordLabeller(), screen, spent: () => (calls > 200 ? 30 : 1) }, { cap: 30, concurrency: 4, mdd: () => 0.12, ceiling: false });
    expect(run.stopped).toBe("cap");
    expect(run.sets.comparison.length).toBeLessThan(64);
  });
  test("a pilot whose projection passes the cap stops authoring at the pilot, keeping the pilot's outcomes", async () => {
    const run = await authorConstructed({ call: typed(), label: wordLabeller(), screen, spent: () => 4 }, { cap: 50, concurrency: 4, mdd: () => null, ceiling: false });
    expect(run).toMatchObject({ stopped: "supply", projection: { fits: false, passing: 4, mdd: null } });
    expect(run.outcomes).toHaveLength(4);
  });
  test("--pilot stops after the pilot's projection", async () => {
    const run = await authorConstructed({ call: typed(), label: wordLabeller(), screen, spent: () => 1 }, { cap: 50, concurrency: 4, mdd: () => 0.2, ceiling: false, pilotOnly: true });
    expect(run).toMatchObject({ stopped: "pilot", projection: { fits: true } });
    expect(run.outcomes).toHaveLength(4);
  });
  test("the CEILING variant redraws calibration and comparison only, with no pilot", async () => {
    const call = typed();
    const run = await authorConstructed({ call, label: wordLabeller(), screen, spent: () => 0 }, { cap: 100, concurrency: 8, mdd: () => 0.12, ceiling: true });
    expect(run.projection).toBeNull();
    expect(run.twins).toHaveLength(0);
    expect(run.sets.reserve).toHaveLength(0);
    expect(run.sets.comparison).toHaveLength(64);
    expect(call.calls[0]!.label.startsWith("h")).toBe(true);
  });
});

describe("authorReal", () => {
  test("mines, gates, authors and writes the stratum with every fetch one at a time", async () => {
    const site: Record<string, { status: number; text: string }> = {
      "https://a.invalid/robots.txt": { status: 404, text: "" },
      "https://a.invalid/terms": { status: 200, text: "<p>Be kind.</p>" },
      "https://a.invalid/story": { status: 200, text: "<html><script>alert(1)</script><p>" + REAL_PAGE + "</p></html>" },
      "https://b.invalid/robots.txt": { status: 200, text: "User-agent: *\nAllow: /" },
      "https://b.invalid/terms": { status: 200, text: "You agree not to crawl this site." },
    };
    let open = 0, most = 0;
    const fetch: Fetch = async (url) => {
      most = Math.max(most, ++open);
      await Promise.resolve();
      open--;
      return site[url] ?? { status: 404, text: "" };
    };
    const route = happy(REAL_FILES, true);
    const call = stubCaller(route);
    const run = await authorReal({ call, label: wordLabeller(), screen, search: async (q) => (q.includes("first paying customer") ? [{ url: "https://a.invalid/story" }, { url: "https://b.invalid/post" }, { url: "https://medium.com/x" }] : []), fetch, today: "2026-11-12" });
    expect(most).toBe(1);
    expect(run.gates.map((g) => g.fetch.length).sort()).toEqual([0, 1]);
    expect(run.sources.find((s) => s.origin === "https://a.invalid")!.pages[0]!.text).not.toContain("alert");
    const passed = run.outcomes.filter((o) => o.status === "pass");
    expect(passed).toHaveLength(1);
    expect(passed[0]!.meta!.fame_tercile).toBe(1);
    const s = sink();
    const summary = writeReal(s, run);
    expect(summary).toMatchObject({ queries: 40, sources: 2, passed: 1, gate: { fetched: 1, refused: 1 } });
    const id = passed[0]!.id;
    for (const f of ["note-a.md", "note-b.md", "names.txt", "pages.json", "pages/1.html"]) expect(existsSync(join(s, "real", id, f))).toBe(true);
    expect(existsSync(join(s, "units", id, "unit.json"))).toBe(true);
  });
});
