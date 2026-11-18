// Value: protects=section 3's supply and pre-run change 1 item 4d's pilot as driven: the pilot's planted outcomes at both reads, a missing line, the cap, top-up twins, pairs placed whole, unmatched partners, 110 briefs placed, and pilot briefs placed only under unchanged inputs.
import { describe, expect, test } from "bun:test";
import { authorRun, checkAnswers, haltOf, inputsDigest, summaryOf, type AuthorRun } from "../../../lanes/office-hours-rewrite/author/run.ts";
import { FIXTURE_SCREEN, fixtureParser, runCaller, wordLabeller } from "../../../lanes/office-hours-rewrite/author/fixtures.ts";
import { buildScreen } from "../../../lanes/office-hours-rewrite/author/screens.ts";
import { CAPS, QUOTA } from "../../../lanes/office-hours-rewrite/frozen.ts";
import { line, pilotRead } from "../../../lanes/office-hours-rewrite/author/pilot.ts";

const mdd = () => 0.13;
function go(o: { secondFails?: (n: number) => boolean; usd?: number; cap?: number; screen?: typeof FIXTURE_SCREEN; pilotOnly?: boolean; pilot?: AuthorRun["pilot"] } = {}) {
  const call = runCaller({ secondFails: o.secondFails });
  const deps = { call, label: wordLabeller(), parse: fixtureParser, screen: o.screen ?? FIXTURE_SCREEN, spent: () => call.state.drafts * (o.usd ?? 1.04) };
  return authorRun(deps, { cap: o.cap ?? CAPS.authoring, concurrency: 8, pilotOnly: o.pilotOnly, pilot: o.pilot });
}
const total = (r: AuthorRun) => r.sets.calibration.length + r.sets.comparison.length + r.sets.reserve.length;
const L = line(1.04, 1)!;

describe("the pilot gate, driven", () => {
  test("16 of 16 second twins passing reads go at the first read, then all 110 briefs place", async () => {
    const r = await go();
    expect(r.pilot.verdict).toBe("go");
    expect(r.pilot.reads.map((x) => [x.k, x.n])).toEqual([[16, 16]]);
    expect(r.pilot.second_draws).toBe(16);
    expect(r.pilot.line).toBeCloseTo(L, 10);
    expect(r.stopped).toBe("quotas");
    expect(total(r)).toBe(110);
    expect(haltOf(r, mdd)).toBeNull();
  });
  test("0 of 16 reads stop and halts with E_OHR_PILOT_STOP and the numbers", async () => {
    const r = await go({ secondFails: () => true });
    expect([r.pilot.verdict, r.stopped]).toEqual(["stop", "pilot"]);
    expect(pilotRead([{ k: 0, n: 16 }], L).verdict).toBe("stop");
    const e = haltOf(r, mdd)!;
    expect(e.code).toBe("E_OHR_PILOT_STOP");
    expect(e.message).toContain("0/16");
  });
  test("1 of 16 is open, so it draws on to 32; 17 of 32 then reads go", async () => {
    const r = await go({ secondFails: (n) => n <= 15 });
    expect(r.pilot.reads.map((x) => [x.k, x.n, x.read])).toEqual([[1, 16, "open"], [17, 32, "go"]]);
    expect(r.pilot.verdict).toBe("go");
  });
  test("4 of 16 then 8 of 32 stays open and halts with E_OHR_PILOT_OPEN", async () => {
    const r = await go({ secondFails: (n) => n % 4 !== 0 });
    expect(r.pilot.reads.map((x) => [x.k, x.n])).toEqual([[4, 16], [8, 32]]);
    expect(r.pilot.verdict).toBe("open");
    expect(haltOf(r, mdd)!.code).toBe("E_OHR_PILOT_OPEN");
  });
  test("a cost per draw that leaves no room for second twins has no line and halts", async () => {
    const r = await go({ usd: 4 });
    expect([r.pilot.verdict, r.pilot.line]).toEqual(["no-line", null]);
    expect(haltOf(r, mdd)!.code).toBe("E_OHR_PILOT_STOP");
    expect(haltOf(r, mdd)!.message).toContain("no line");
  });
  test("a top-up twin comes from the pair's family, and every second-twin draft counts", async () => {
    const r = await go({ secondFails: (n) => n === 1 });
    const seconds = r.pilot.outcomes.filter((x) => x.role === "second");
    expect(seconds).toHaveLength(16);
    const topUp = seconds.find((x) => x.attempt === 2)!;
    const partner = r.pilot.outcomes.find((x) => x.id === topUp.id.replace(/b$/, "a"))!;
    expect(topUp.author).toBe(partner.author);
    expect(r.pilot.reads[0]).toMatchObject({ k: 15, n: 16 });
  });
});

describe("supply", () => {
  test("a cap too small for one draft stops the pilot and reports a shortfall", async () => {
    const r = await go({ cap: 3 });
    expect(r.pilot.verdict).toBe("cap");
    expect(haltOf(r, mdd)!.code).toBe("E_OHR_SUPPLY_SHORT");
  });
  test("when twins stop passing after the pilot, the cap stops authoring, partners left unmatched drop, and pairs stay whole", async () => {
    const r = await go({ secondFails: (n) => n > 16 });
    expect(r.stopped).toBe("cap");
    expect(r.unmatched.length).toBeGreaterThan(0);
    const ids = new Set([...r.sets.calibration, ...r.sets.comparison, ...r.sets.reserve].map((m) => m.id));
    for (const id of r.unmatched) expect(ids.has(id)).toBe(false);
    for (const m of [...r.sets.calibration, ...r.sets.comparison, ...r.sets.reserve]) if (m.twin) expect(ids.has(m.twin)).toBe(true);
    const e = haltOf(r, mdd)!;
    expect(e.code).toBe("E_OHR_SUPPLY_SHORT");
    expect(e.message).toContain("of 110 briefs");
    expect(summaryOf(r).placed).toBeLessThan(110);
  });
});

describe("placement", () => {
  test("the sets hold the frozen make-up, skins and clusters", async () => {
    const r = await go();
    expect(r.sets.calibration).toHaveLength(QUOTA.calibration);
    expect(r.sets.reserve).toHaveLength(QUOTA.reserve);
    expect(r.sets.comparison).toHaveLength(QUOTA.founder + QUOTA.builder);
    for (let skin = 1; skin <= 5; skin++) {
      const f = r.sets.comparison.filter((m) => m.skin === skin && m.kind !== "builder");
      expect([f.length, new Set(f.map((m) => m.cluster)).size]).toEqual([14, 8]);
    }
    expect(r.sets.comparison.filter((m) => m.kind === "pair")).toHaveLength(60);
    const s = summaryOf(r);
    expect(s.sets.comparison.clusters).toBe(40 + 24);
    expect(JSON.stringify(s)).not.toContain("bridal");
  });
  test("pilot briefs are placed through the same checks, bound to their digests", async () => {
    const r = await go();
    const pilots = [...r.sets.calibration, ...r.sets.comparison, ...r.sets.reserve].filter((m) => m.pilot);
    expect(pilots.length).toBeGreaterThan(0);
    for (const m of pilots) {
      const o = r.outcomes.find((x) => x.id === m.id && x.status === "pass")!;
      const steps = o.checks.filter((c) => c.ok && !c.void && c.digest === m.digest).map((c) => c.step);
      expect(steps).toEqual(expect.arrayContaining(["vocabulary", "unanimous", "audit", "probe", "generic"]));
      expect(m.kind).toBe("pair");
    }
  });
  test("a continuation from a pilot with the same inputs places its briefs; changed inputs place none of them", async () => {
    const p = await go({ pilotOnly: true });
    expect(p.stopped).toBe("pilot");
    const same = await go({ pilot: p.pilot });
    expect(same.pilot_placed).toBe(true);
    expect(total(same)).toBe(110);
    const changed = await go({ pilot: p.pilot, screen: buildScreen(["an entirely different source line for the screen"]) });
    expect(changed.pilot_placed).toBe(false);
    const placed = new Set([...changed.sets.calibration, ...changed.sets.comparison, ...changed.sets.reserve].map((m) => m.id));
    for (const x of p.pilot.outcomes) expect(placed.has(x.id)).toBe(false);
    expect(inputsDigest(FIXTURE_SCREEN)).toBe(p.pilot.digest);
  });
  test("a continuation refuses a pilot that did not read go", async () => {
    const p = await go({ secondFails: () => true });
    await expect(go({ pilot: p.pilot })).rejects.toThrow("read stop");
  });
});

describe("answers for the judge check", () => {
  test("every placed brief hands over its three full-information blocks, and unpaired briefs their three opening-only blocks", async () => {
    const r = await go();
    const a = checkAnswers(r);
    const unpaired = [...r.sets.calibration, ...r.sets.comparison, ...r.sets.reserve].filter((m) => m.kind !== "pair").length;
    expect(a.filter((x) => x.source === "full")).toHaveLength(110 * 3);
    expect(a.filter((x) => x.source === "opening")).toHaveLength(unpaired * 3);
    expect(new Set(a.map((x) => x.author))).toEqual(new Set(["opus", "sol", "astra"]));
    expect(Object.keys(a[0]!.block).sort()).toEqual(["decision", "next_action", "why"]);
  });
});
