// Keyless tests of the L1 ceiling check and final read (quick/laneb/l1/ceiling.ts, the L1 preregistration's section 9), on
// synthetic ledger rows, crew files and plans, through the functions and through the command line.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { check, finalRead, tally, UsageError, type Crew, type Plan } from "../l1/ceiling.ts";
import { readRows, type Row } from "../runner/ledger.ts";

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
    const r = check(atCaps(), crew(700_000, 40_000), plan(), "pilot-sol");
    expect(r.ok).toBe(false);
    expect(dollars(r.tally.itemsTotal)).toBeCloseTo(940 + 830, 6);
    expect(dollars(r.tally.crewSpent)).toBe(700);
    expect(dollars(r.tally.crewHold)).toBe(0);
    expect(dollars(r.tally.captainHold)).toBe(0);
    expect(dollars(r.tally.runWorkHold)).toBe(30);
    expect(dollars(r.tally.total)).toBeCloseTo(940 + 830 + 700 + 40 + 30, 6);
    expect(r.why).toContain("passes $2000.00");
  });
  test("refuses the same launch with the crew line past $700 even when the Opus items settled at their expected spend", () => {
    const r = check(atExpected(), crew(800_000, 40_000), plan(), "pilot-sol");
    expect(r.ok).toBe(false);
    expect(dollars(r.tally.total)).toBeCloseTo(552.67 + 830 + 800 + 40 + 30, 6);
  });
  test("passes a Sol pilot launch when every item settled at its expected spend and the crew line holds its $700 remainder", () => {
    const r = check(atExpected(), crew(288_000, 36_000), plan([solPlan[0]!]), "pilot-sol");
    expect(r.ok).toBe(true);
    expect(dollars(r.tally.crewHold)).toBe(412);
    expect(dollars(r.tally.captainHold)).toBe(4);
    expect(dollars(r.tally.holdback)).toBe(412 + 4 + 30);
    expect(dollars(r.tally.total)).toBeCloseTo(552.67 + 100 + 288 + 36 + 446, 6);
    expect(r.why).toContain("at or under $2000.00");
  });
  test("at the $700 crew line, Sol's planned path at its caps does not fit even when every Opus item settled at its expected spend", () => {
    const r = check(atExpected(), crew(288_000, 36_000), plan(), "pilot-sol");
    expect(r.ok).toBe(false);
    expect(dollars(r.tally.crewHold)).toBe(412);
    expect(dollars(r.tally.total)).toBeCloseTo(552.67 + 830 + 700 + 40 + 30, 6);
    expect(r.why).toContain("passes $2000.00");
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
    const t = tally(atExpected(), crew(650_000, 0, open), plan());
    expect(t.perToken).toBeCloseTo(700 * M / (900 * M), 9);
    expect(dollars(t.stops)).toBeCloseTo(((300 - 100 + 200) * M) * (700 / 900) / M, 5);
    expect(dollars(t.crewHold)).toBeCloseTo(311.11, 2);
    const small = tally(atExpected(), crew(100_000, 0, [{ ...open[0]!, credits: 10_000 }]), plan());
    expect(dollars(small.crewHold)).toBe(590);
  });
  test("with no token reading yet, unspent stops are held at the planning rate of $0.45 per million", () => {
    const t = tally([], { as_of: "x", captain_credits: 0, threads: [{ code: "GEVA-4", line: "crew", credits: 0, tokens: 0, token_stop: 2000 * M, status: "planned" }] }, { items: opusPlan("planned"), leftover: { sol: "pending", particle: "pending" } });
    expect(dollars(t.stops)).toBe(900);
    expect(dollars(t.crewHold)).toBe(900);
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
    const t = tally(atExpected(), crew(685_000, 0, sol), plan());
    expect(t.perToken).toBeCloseTo(700 / 820, 9);
    expect(dollars(t.stops)).toBeCloseTo(100 * (700 / 820), 5);
    expect(dollars(t.crewHold)).toBeCloseTo(100 * (700 / 820), 5);
    expect(dollars(t.runWorkHold)).toBe(15);
    expect(() => tally(atExpected(), crew(0, 0, [{ ...sol[0]!, token_stop: null }]), plan())).toThrow(/GEVA-5 has no token_stop/);
  });
  test("refuses a launch while another item holds open reservations, and an item not in the plan or already done", () => {
    const r = check([...atExpected(), ...rows("pilot-sol", 100, [], [5])], crew(0, 0), plan([solPlan[0]!, { item: "f1-sol", cap_usd: 300, status: "planned" }]), "f1-sol");
    expect(r.ok).toBe(false);
    expect(r.why).toContain("pilot-sol still holds open reservations");
    const second = check([...rows("pilot-opus", 80, [26.08]), ...rows("f1-opus", 680, [211.9], [40])], crew(0, 0), { items: [{ item: "pilot-opus", cap_usd: 80, status: "done" }, { item: "f1-opus", cap_usd: 680, status: "open" }], leftover: { sol: "pending", particle: "pending" } }, "f1-opus");
    expect(second.ok).toBe(false);
    expect(second.why).toContain("f1-opus still holds open reservations");
    expect(() => check(atExpected(), crew(0, 0), plan(), "f1-particle")).toThrow(UsageError);
    expect(() => check(atExpected(), crew(0, 0), plan(), "f1-opus")).toThrow(/not a planned or open item/);
  });
  test("a dead part's relaunch: refused while its reserves are open, admitted once each is settled at its full reserved amount, which still counts against the cap", () => {
    const ledger = join(mkdtempSync(join(tmpdir(), "l1-relaunch-")), "f1-opus.jsonl");
    const dead: Row[] = [
      { ts: "t", item: "f1-opus", kind: "reserve", id: "f1-p2-vm", usd_micros: 2.4 * M },
      { ts: "t", item: "f1-opus", kind: "reserve", id: "f1-p2-s1", usd_micros: 5 * M },
      { ts: "t", item: "f1-opus", kind: "reserve", id: "f1-p2-s2", usd_micros: 5 * M },
    ];
    // pregate-literal: CREW_LINE_USD=400 a settled session spend in this ledger fixture, not the crew line
    writeFileSync(ledger, [...rows("f1-opus", 680, [400, 255]), ...dead].map((r) => JSON.stringify(r)).join("\n") + "\n");
    const p: Plan = { items: [{ item: "pilot-opus", cap_usd: 80, status: "done" }, { item: "f1-opus", cap_usd: 680, status: "open" }, { item: "tb2-opus", cap_usd: 180, status: "planned" }], leftover: { sol: "refused", particle: "refused" } };
    const all = () => [...rows("pilot-opus", 80, [26.08]), ...readRows(ledger)];
    const before = check(all(), crew(288_000, 36_000), p, "f1-opus");
    expect(before.ok).toBe(false);
    expect(before.why).toContain("f1-opus still holds open reservations");
    expect(before.why).toContain("settle each of its open reserves at its full reserved amount");
    const cli = (args: string[]) => Bun.spawnSync(["bun", join(import.meta.dir, "../runner/ledger.ts"), ...args, "--path", ledger, "--item", "f1-opus"]).exitCode;
    for (const r of dead) expect(cli(["settle", "--id", r.id, "--usd", String(r.usd_micros / M), "--detail", "VM l1-f1-p2 confirmed gone"])).toBe(0);
    const after = check(all(), crew(288_000, 36_000), p, "f1-opus");
    expect(after.ok).toBe(true);
    const f1 = after.tally.items.find((i) => i.item === "f1-opus")!;
    expect(dollars(f1.settled)).toBeCloseTo(655 + 12.4, 6);
    expect(f1.reserved).toBe(0);
    expect(after.tally.total).toBe(before.tally.total);
    expect(readRows(ledger).filter((r) => r.kind === "settle" && r.id.startsWith("f1-p2-")).every((r) => r.usd_micros === r.reserved_micros && r.kind_detail === "VM l1-f1-p2 confirmed gone")).toBe(true);
    expect(cli(["reserve", "--id", "f1-p2r-vm", "--usd", "12.7"])).toBe(3);
    expect(cli(["reserve", "--id", "f1-p2r-vm", "--usd", "12.6"])).toBe(0);
  });
  test("fails closed on a ledger item missing from the plan, a cap that differs from the ledger, and an open thread without a stop", () => {
    expect(() => tally([...atExpected(), ...rows("laneb-quick", 50, [1])], crew(0, 0), plan())).toThrow(/laneb-quick is not in the plan/);
    expect(() => tally(rows("pilot-opus", 90, [1]), crew(0, 0), plan())).toThrow(/has cap \$80.00 in the plan and \$90.00 in the ledger/);
    expect(() => tally([], crew(0, 0, [{ code: "GEVA-6", line: "crew", credits: 0, tokens: 0, token_stop: null, status: "open" }]), plan())).toThrow(/GEVA-6 has no token_stop/);
    expect(() => tally([], {} as Crew, plan())).toThrow(UsageError);
    expect(() => tally([], crew(0, 0), {} as Plan)).toThrow(UsageError);
  });
});

describe("a voided run's ledger", () => {
  test("adds its settled and open reserved spend to the sum and places no item", () => {
    const base = check(atExpected(), crew(288_000, 36_000), plan([solPlan[0]!]), "pilot-sol");
    const r = check(atExpected(), crew(288_000, 36_000), plan([solPlan[0]!]), "pilot-sol", [rows("pilot-opus", 80, [0.07], [0.5])]);
    expect(dollars(r.tally.voidedSpent)).toBeCloseTo(0.57, 6);
    expect(dollars(r.tally.total - base.tally.total)).toBeCloseTo(0.57, 6);
    expect(r.tally.items.find((i) => i.item === "pilot-opus")!.counted).toBe(base.tally.items.find((i) => i.item === "pilot-opus")!.counted);
    expect(r.ok).toBe(true);
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
    const refuse = run(["check", ...files(atCaps(), crew(700_000, 40_000), plan()), "--launch", "pilot-sol"]);
    expect(refuse.code).toBe(1);
    expect(refuse.out).toStartWith("CEILING REFUSE pilot-sol: the sum $2540.00");
    const pass = run(["check", ...files(atExpected(), crew(288_000, 36_000), plan([solPlan[0]!])), "--launch", "pilot-sol"]);
    expect(pass.code).toBe(0);
    expect(pass.out).toStartWith("CEILING PASS pilot-sol");
    expect(pass.out).toContain("holdback $446.00");
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
  test("a voided run's ledger counts in the sum through --void-ledger, and never as an item's ledger too", () => {
    const voided = rows("pilot-opus", 80, [0.07]);
    const v = files(voided, crew(0, 0), plan());
    const args = [...files(atExpected(), crew(288_000, 36_000), plan([solPlan[0]!])), "--void-ledger", v[1]!];
    const r = run(["check", ...args, "--launch", "pilot-sol"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("voided runs: $0.07");
    expect(r.out).toStartWith("CEILING PASS pilot-sol: the sum $1422.74");
    const both = run(["check", ...args, "--ledger", v[1]!, "--launch", "pilot-sol"]);
    expect(both.code).toBe(2);
    expect(both.err).toStartWith("E_USAGE l1 ceiling: a ledger can't be both");
    const f = run(["final", ...files(atExpected(), crew(300_000, 30_000), plan([], { sol: "refused", particle: "refused" })), "--void-ledger", v[1]!, "--post", "GEVA-9"]);
    expect(f.out).toStartWith("FINAL all-in $882.74");
  });
  test("a malformed crew file or plan exits 2, never PASS", () => {
    const typo = { ...crew(288_000, 36_000), threads: [{ code: "GEVA-1", line: "crew", credit: 288_000, tokens: 800 * M, token_stop: 800 * M, status: "done" }] } as unknown as Crew;
    const r = run(["check", ...files(atExpected(), typo, plan()), "--launch", "pilot-sol"]);
    expect(r.code).toBe(2);
    expect(r.err).toStartWith("E_USAGE l1 ceiling: thread GEVA-1 needs credits and tokens");
    expect(r.out).toBe("");
    const args = files(atExpected(), crew(288_000, 36_000), plan());
    args[1] = join(dir, "no-such-ledger.jsonl");
    const gone = run(["check", ...args, "--launch", "pilot-sol"]);
    expect(gone.code).toBe(2);
    expect(gone.err).toStartWith("E_USAGE l1 ceiling: no ledger at");
  });
});

describe("malformed input is refused", () => {
  test("a missing or non-numeric credits, tokens, token_stop or captain_credits", () => {
    const bad = (t: Record<string, unknown>) => crew(288_000, 36_000, [{ code: "GEVA-7", line: "crew", credits: 1000, tokens: M, token_stop: 2 * M, status: "open", ...t } as Crew["threads"][number]]);
    expect(() => tally(atExpected(), bad({ credits: undefined }), plan())).toThrow(/GEVA-7 needs credits and tokens/);
    expect(() => tally(atExpected(), bad({ tokens: "5" }), plan())).toThrow(/GEVA-7 needs credits and tokens/);
    expect(() => tally(atExpected(), bad({ credits: -1 }), plan())).toThrow(/GEVA-7 needs credits and tokens/);
    expect(() => tally(atExpected(), bad({ token_stop: Number.NaN }), plan())).toThrow(/GEVA-7 has no token_stop/);
    expect(() => tally(atExpected(), { ...crew(288_000, 36_000), captain_credits: Number.NaN }, plan())).toThrow(/captain_credits/);
  });
  test("an unknown line or status", () => {
    const t = (x: Record<string, unknown>) => crew(288_000, 36_000, [{ code: "GEVA-7", line: "crew", credits: 900_000, tokens: M, token_stop: null, status: "done", ...x } as Crew["threads"][number]]);
    expect(() => check(atExpected(), t({ line: "Crew" }), plan(), "pilot-sol")).toThrow(/GEVA-7 has line "Crew", not crew, sol or particle/);
    expect(() => check(atExpected(), t({ status: "closed" }), plan(), "pilot-sol")).toThrow(/GEVA-7 has status "closed"/);
  });
  test("a plan item with no cap_usd, even with no ledger rows yet, or an unknown leftover state", () => {
    const typo = { ...plan(), items: [...opusPlan(), { item: "pilot-sol", cap: 100, status: "planned" }] } as unknown as Plan;
    expect(() => check(atExpected(), crew(288_000, 36_000), typo, "pilot-sol")).toThrow(/plan item "pilot-sol" needs cap_usd/);
    expect(() => tally(atExpected(), crew(288_000, 36_000), plan(solPlan, { sol: "pending", particle: "skipped" } as unknown as Plan["leftover"]))).toThrow(/leftover.particle is "skipped"/);
  });
  test("check refuses tokens with no credits instead of holding open stops at zero", () => {
    const open: Crew["threads"][number] = { code: "GEVA-8", line: "sol", credits: 0, tokens: 0, token_stop: 2000 * M, status: "open" };
    expect(() => check(atExpected(), crew(0, 0, [open]), plan(), "pilot-sol")).toThrow(/no measured rate/);
  });
  test("a done item with no ledger rows is refused, not counted at $0", () => {
    expect(() => check(atExpected().filter((r) => r.item !== "tb2-opus"), crew(288_000, 36_000), plan(), "pilot-sol")).toThrow(/tb2-opus is done but has no ledger rows/);
  });
  test("the final read refuses tokens with no credits instead of an unbounded post stop", () => {
    const post: Crew["threads"][number] = { code: "GEVA-9", line: "crew", credits: 0, tokens: 0, token_stop: null, status: "planned" };
    expect(() => finalRead(atExpected(), crew(0, 0, [post]), plan([], { sol: "refused", particle: "refused" }), "GEVA-9")).toThrow(/no measured rate/);
  });
});
