// Keyless tests of the L1 ceiling check and final read (quick/laneb/l1/ceiling.ts, the L1 preregistration's section 9), on
// synthetic ledger rows, crew files and plans, through the functions and through the command line.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { check, finalRead, tally, UsageError, type Crew, type Plan } from "../l1/ceiling.ts";
import type { Row } from "../runner/ledger.ts";

const M = 1_000_000;
let n = 0;
const rows = (item: string, cap: number, settled: number[], open: number[] = []): Row[] => [
  { ts: "2026-11-05T00:00:00Z", item, kind: "approval", id: "approval-" + item, usd_micros: cap * M },
  ...settled.flatMap((u): Row[] => {
    const id = item + "-" + n++;
    return [{ ts: "t", item, kind: "reserve", id, usd_micros: u * M }, { ts: "t", item, kind: "settle", id, usd_micros: u * M }];
  }),
  ...open.map((u): Row => ({ ts: "t", item, kind: "reserve", id: item + "-" + n++, usd_micros: u * M })),
];
const opusPlan = (status: "done" | "planned" = "done") => [
  { item: "pilot-opus", cap_usd: 80, status },
  { item: "f1-opus", cap_usd: 680, status },
  { item: "tb2-opus", cap_usd: 180, status },
];
const solPlan = [
  { item: "pilot-sol", cap_usd: 100, status: "planned" as const },
  { item: "f1-sol", cap_usd: 730, status: "planned" as const },
];
const plan = (extra: Plan["items"] = solPlan, leftover: Plan["leftover"] = { sol: "pending", particle: "pending" }): Plan => ({ items: [...opusPlan(), ...extra], leftover });
const crew = (crewCredits: number, captain: number, more: Crew["threads"] = []): Crew => ({
  as_of: "2026-11-08T00:00:00Z",
  captain_credits: captain,
  threads: [{ code: "GEVA-1", line: "crew", credits: crewCredits, tokens: 800 * M, token_stop: 800 * M, status: "done" }, ...more],
});
const atCaps = () => [...rows("pilot-opus", 80, [80]), ...rows("f1-opus", 680, [340, 340]), ...rows("tb2-opus", 180, [180])];
const atExpected = () => [...rows("pilot-opus", 80, [26.08]), ...rows("f1-opus", 680, [211.9, 211.9]), ...rows("tb2-opus", 180, [102.79])];
const dollars = (m: number) => m / M;

describe("the ceiling check before a launch", () => {
  test("refuses a Sol launch with the crew line already spent and every Opus item settled at its cap", () => {
    const r = check(atCaps(), crew(400_000, 40_000), plan(), "pilot-sol");
    expect(r.ok).toBe(false);
    expect(dollars(r.tally.itemsTotal)).toBeCloseTo(940 + 830, 6);
    expect(dollars(r.tally.crewSpent)).toBe(400);
    expect(dollars(r.tally.crewHold)).toBe(0);
    expect(dollars(r.tally.captainHold)).toBe(0);
    expect(dollars(r.tally.runWorkHold)).toBe(30);
    expect(dollars(r.tally.total)).toBeCloseTo(940 + 830 + 400 + 40 + 30, 6);
    expect(r.why).toContain("passes $2000.00");
  });
  test("refuses the same launch with the crew line past $400 even when the Opus items settled at their expected spend", () => {
    const r = check(atExpected(), crew(800_000, 40_000), plan(), "pilot-sol");
    expect(r.ok).toBe(false);
    expect(dollars(r.tally.total)).toBeCloseTo(552.67 + 830 + 800 + 40 + 30, 6);
  });
  test("passes a Sol launch when every item settled at its expected spend and the crew line at its plan", () => {
    const r = check(atExpected(), crew(288_000, 36_000), plan(), "pilot-sol");
    expect(r.ok).toBe(true);
    expect(dollars(r.tally.crewHold)).toBe(112);
    expect(dollars(r.tally.captainHold)).toBe(4);
    expect(dollars(r.tally.holdback)).toBe(112 + 4 + 30);
    expect(dollars(r.tally.total)).toBeCloseTo(552.67 + 830 + 288 + 36 + 146, 6);
    expect(r.why).toContain("at or under $2000.00");
  });
  test("an item still to run counts at its cap; a done item counts at what it settled and reserved", () => {
    const t = tally([...rows("pilot-opus", 80, [20], [6])], crew(0, 0), { items: opusPlan("planned"), leftover: { sol: "refused", particle: "refused" } });
    expect(t.items.map((i) => dollars(i.counted))).toEqual([80, 680, 180]);
    const done = tally([...rows("pilot-opus", 80, [20], [6])], crew(0, 0), { items: [{ item: "pilot-opus", cap_usd: 80, status: "done" }], leftover: { sol: "refused", particle: "refused" } });
    expect(dollars(done.items[0]!.counted)).toBe(26);
  });
  test("the crew holdback is the larger of the line's remainder and the unspent stops at the measured rate", () => {
    const open: Crew["threads"] = [
      { code: "GEVA-2", line: "crew", credits: 50_000, tokens: 100 * M, token_stop: 300 * M, status: "open" },
      { code: "GEVA-3", line: "crew", credits: 0, tokens: 0, token_stop: 200 * M, status: "planned" },
    ];
    const t = tally(atExpected(), crew(350_000, 0, open), plan());
    expect(t.perToken).toBeCloseTo(400 * M / (900 * M), 9);
    expect(dollars(t.stops)).toBeCloseTo((400 * M) * (400 / 900) / M, 5);
    expect(dollars(t.crewHold)).toBeCloseTo(177.78, 2);
    const small = tally(atExpected(), crew(100_000, 0, [{ ...open[0]!, credits: 10_000 }]), plan());
    expect(dollars(small.crewHold)).toBe(290);
  });
  test("with no token reading yet, unspent stops are held at the planning rate of $0.45 per million", () => {
    const t = tally([], { as_of: "x", captain_credits: 0, threads: [{ code: "GEVA-4", line: "crew", credits: 0, tokens: 0, token_stop: 1000 * M, status: "planned" }] }, { items: opusPlan("planned"), leftover: { sol: "pending", particle: "pending" } });
    expect(dollars(t.stops)).toBe(450);
    expect(dollars(t.crewHold)).toBe(450);
  });
  test("each leftover model's run-work remainder is held until that model is done or refused", () => {
    const sol: Crew["threads"] = [{ code: "GEVA-5", line: "sol", credits: 9_000, tokens: 20 * M, token_stop: 30 * M, status: "open" }];
    expect(dollars(tally(atExpected(), crew(288_000, 0, sol), plan()).runWorkHold)).toBe(6 + 15);
    expect(dollars(tally(atExpected(), crew(288_000, 0, sol), plan(solPlan, { sol: "done", particle: "pending" })).runWorkHold)).toBe(15);
    expect(dollars(tally(atExpected(), crew(288_000, 0, sol), plan(solPlan, { sol: "refused", particle: "refused" })).runWorkHold)).toBe(0);
    expect(dollars(tally(atExpected(), crew(288_000, 0, [{ ...sol[0]!, credits: 20_000 }]), plan()).runWorkHold)).toBe(15);
  });
  test("a run-work thread's unspent token stop is held too, beside its line's remainder", () => {
    const sol: Crew["threads"] = [{ code: "GEVA-5", line: "sol", credits: 15_000, tokens: 20 * M, token_stop: 120 * M, status: "open" }];
    const t = tally(atExpected(), crew(385_000, 0, sol), plan());
    expect(t.perToken).toBeCloseTo(400 / 820, 9);
    expect(dollars(t.stops)).toBeCloseTo(100 * (400 / 820), 5);
    expect(dollars(t.crewHold)).toBeCloseTo(100 * (400 / 820), 5);
    expect(dollars(t.runWorkHold)).toBe(15);
    expect(() => tally(atExpected(), crew(0, 0, [{ ...sol[0]!, token_stop: null }]), plan())).toThrow(/GEVA-5 has no token_stop/);
  });
  test("refuses a launch while another item holds open reservations, and an item not in the plan or already done", () => {
    const r = check([...atExpected(), ...rows("pilot-sol", 100, [], [5])], crew(0, 0), plan(), "f1-sol");
    expect(r.ok).toBe(false);
    expect(r.why).toContain("pilot-sol still holds open reservations");
    const second = check([...rows("pilot-opus", 80, [26.08]), ...rows("f1-opus", 680, [211.9], [40])], crew(0, 0), { items: [{ item: "pilot-opus", cap_usd: 80, status: "done" }, { item: "f1-opus", cap_usd: 680, status: "open" }], leftover: { sol: "pending", particle: "pending" } }, "f1-opus");
    expect(second.ok).toBe(false);
    expect(second.why).toContain("f1-opus still holds open reservations");
    expect(() => check(atExpected(), crew(0, 0), plan(), "f1-particle")).toThrow(UsageError);
    expect(() => check(atExpected(), crew(0, 0), plan(), "f1-opus")).toThrow(/not a planned or open item/);
  });
  test("fails closed on a ledger item missing from the plan, a cap that differs from the ledger, and an open thread without a stop", () => {
    expect(() => tally([...atExpected(), ...rows("laneb-quick", 50, [1])], crew(0, 0), plan())).toThrow(/laneb-quick is not in the plan/);
    expect(() => tally(rows("pilot-opus", 90, [1]), crew(0, 0), plan())).toThrow(/has cap \$80.00 in the plan and \$90.00 in the ledger/);
    expect(() => tally([], crew(0, 0, [{ code: "GEVA-6", line: "crew", credits: 0, tokens: 0, token_stop: null, status: "open" }]), plan())).toThrow(/GEVA-6 has no token_stop/);
    expect(() => tally([], {} as Crew, plan())).toThrow(UsageError);
    expect(() => tally([], crew(0, 0), {} as Plan)).toThrow(UsageError);
  });
});

describe("the final read before the results post", () => {
  const post: Crew["threads"][number] = { code: "GEVA-9", line: "crew", credits: 0, tokens: 0, token_stop: null, status: "planned" };
  test("gives the all-in figure and the largest post token stop that keeps it with the open holds at or under $2,000", () => {
    const f = finalRead(atExpected(), crew(300_000, 30_000, [post]), plan([], { sol: "refused", particle: "refused" }), "GEVA-9");
    expect(dollars(f.all_in)).toBeCloseTo(552.67 + 300 + 30, 6);
    expect(dollars(f.holds)).toBe(10);
    expect(f.tally.perToken).toBeCloseTo(300_000_000 / (800 * M), 9);
    expect(f.max_post_token_stop).toBe(Math.floor((2000 - 552.67 - 300 - 30 - 10) * M / (300 / 800)));
    expect(f.open_items).toEqual([]);
  });
  test("items not done count at their caps and other open threads' stops stay held", () => {
    const other: Crew["threads"][number] = { code: "GEVA-8", line: "crew", credits: 0, tokens: 0, token_stop: 80 * M, status: "open" };
    const f = finalRead(atExpected(), crew(300_000, 40_000, [post, other]), plan(), "GEVA-9");
    expect(f.open_items).toEqual(["pilot-sol", "f1-sol"]);
    expect(dollars(f.all_in)).toBeCloseTo(552.67 + 830 + 300 + 40, 6);
    expect(dollars(f.holds)).toBeCloseTo(30 + 80 * (300 / 800), 6);
    expect(f.max_post_token_stop).toBe(Math.floor(f.room / f.tally.perToken));
  });
  test("no room left gives a stop of 0", () => {
    expect(finalRead(atCaps(), crew(1_100_000, 40_000, [post]), plan(), "GEVA-9").max_post_token_stop).toBe(0);
  });
});

describe("the command line", () => {
  const dir = mkdtempSync(join(tmpdir(), "l1-ceiling-"));
  const files = (ledger: Row[], c: Crew, p: Plan) => {
    const id = String(n++);
    writeFileSync(join(dir, id + ".jsonl"), ledger.map((r) => JSON.stringify(r)).join("\n") + "\n");
    writeFileSync(join(dir, id + "-crew.json"), JSON.stringify(c));
    writeFileSync(join(dir, id + "-plan.json"), JSON.stringify(p));
    return ["--ledger", join(dir, id + ".jsonl"), "--crew", join(dir, id + "-crew.json"), "--plan", join(dir, id + "-plan.json")];
  };
  const run = (args: string[]) => {
    const p = Bun.spawnSync(["bun", join(import.meta.dir, "../l1/ceiling.ts"), ...args]);
    return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() };
  };
  test("REFUSE exits 1 and PASS exits 0", () => {
    const refuse = run(["check", ...files(atCaps(), crew(400_000, 40_000), plan()), "--launch", "pilot-sol"]);
    expect(refuse.code).toBe(1);
    expect(refuse.out).toStartWith("CEILING REFUSE pilot-sol: the sum $2240.00");
    const pass = run(["check", ...files(atExpected(), crew(288_000, 36_000), plan()), "--launch", "pilot-sol"]);
    expect(pass.code).toBe(0);
    expect(pass.out).toStartWith("CEILING PASS pilot-sol");
    expect(pass.out).toContain("holdback $146.00");
  });
  test("final prints the all-in figure and the post stop; bad input exits 2 with E_USAGE first", () => {
    const f = run(["final", ...files(atExpected(), crew(300_000, 30_000), plan([], { sol: "refused", particle: "refused" })), "--post", "GEVA-9"]);
    expect(f.code).toBe(0);
    expect(f.out).toStartWith("FINAL all-in $882.67, holds $10.00");
    const bad = run(["check", "--crew", "x"]);
    expect(bad.code).toBe(2);
    expect(bad.err).toStartWith("E_USAGE");
    const missing = run(["check", ...files(atExpected(), crew(0, 0), plan())]);
    expect(missing.code).toBe(2);
    expect(missing.err).toStartWith("E_USAGE l1 ceiling: check needs --launch");
  });
});
