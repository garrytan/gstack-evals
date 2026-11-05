import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { admitG, authPaidFromLedger, unknownFromRun, type AdmissionInput, type SliceTrial } from "../../src/runner/stats/g-admission.ts";
import { m1Decide, meteredPricer, renderResizeMetered } from "../../src/runner/stats/g-resize.ts";
import { openLease, recordApproval, settleLease } from "../../src/runner/ledger/ledger.ts";
import { LocalLedger } from "../../src/runner/ledger/local.ts";

const NONE = "none", PER = "told-plan-eng-review", AP = "told-autoplan";
const LABELS = Array.from({ length: 12 }, (_, i) => "t" + String(i).padStart(2, "0"));
const COST: Record<string, number> = { [NONE]: 0.955, [PER]: 2.101, [AP]: 4.775 };
const SAMPLE = LABELS.slice(0, 8).map((task) => ({ task, trial: 1 }));

/** The slice: 12 tasks x 2 trials per arm; none solves its first trial on every task (12 of 24). */
function slice(): SliceTrial[] {
  return [NONE, PER, AP].flatMap((arm) => LABELS.flatMap((task, i) => [1, 2].map((n): SliceTrial => ({
    task, repo: "repo" + Math.floor(i / 2), arm, trial: n, status: "scored", solved: arm === NONE ? n === 1 : true, truncated: false,
    cost_usd: COST[arm]!, exposed: arm === NONE ? null : true, mutation: "scored", verifier_ran: true, stop_explained: null,
  }))));
}
const edit = (trials: SliceTrial[], hit: (t: SliceTrial, index: number) => boolean, patch: Partial<SliceTrial>) => {
  const counts = new Map<string, number>();
  return trials.map((t) => {
    const i = counts.get(t.arm) ?? 0;
    counts.set(t.arm, i + 1);
    return hit(t, i) ? { ...t, ...patch } : t;
  });
};
const input = (trials: SliceTrial[], o: Partial<AdmissionInput> = {}): AdmissionInput => ({
  arms: { none: NONE, told: { "plan-eng-review": PER, autoplan: AP } }, trials, planned_trials: 24,
  exposure_sample: { "plan-eng-review": SAMPLE, autoplan: SAMPLE }, auth_paid_usd: 1.39, auth_extra_usd: 1.2,
  unknown_calls: { none: { calls: 0, micros: 0 }, "plan-eng-review": { calls: 0, micros: 0 }, autoplan: { calls: 0, micros: 0 } }, ...o,
});
const noneSolved = (k: number) => {
  let i = 0;
  return slice().map((t) => (t.arm === NONE ? { ...t, solved: i++ < k } : t));
};

describe("G admission, plan v3 section 6 and the prereg's section 6", () => {
  test("a slice that passes every item goes to stage 4 at the design M1 prints", () => {
    const a = admitG(input(slice()));
    for (const s of ["plan-eng-review", "autoplan"] as const) {
      expect(a.skills[s].failed).toBeNull();
      expect(a.skills[s].items.map((x) => x.pass)).toEqual([true, true, true, true, true]);
    }
    const o = m1Decide(meteredPricer(a.metered.inputs), []);
    expect(a.skills["plan-eng-review"].design).toEqual(o.runs["plan-eng-review"]);
    expect(a.skills.autoplan.design).toEqual(o.runs.autoplan);
    expect(a.metered.inputs.MULT).toBeCloseTo(5, 12);
    expect(a.metered.inputs.M_PER).toBeCloseTo(2.2, 12);
    expect(a.metered.inputs.M_AP).toBeCloseTo(5, 12);
    expect(a.resize_text).toBe(renderResizeMetered(a.metered.inputs));
  });

  test("item 1, headroom: 5 to 19 of 24 pass; 4 stops both skills as floor, 20 as saturation", () => {
    expect(admitG(input(noneSolved(5))).skills.autoplan.items[0]!.pass).toBe(true);
    expect(admitG(input(noneSolved(19))).skills.autoplan.items[0]!.pass).toBe(true);
    const floor = admitG(input(noneSolved(4)));
    for (const s of ["plan-eng-review", "autoplan"] as const) expect([floor.skills[s].failed, floor.skills[s].route, floor.skills[s].design]).toEqual([1, "FIX-METHOD (floor)", null]);
    const sat = admitG(input(noneSolved(20)));
    expect(sat.skills["plan-eng-review"].route).toBe("FIX-METHOD (saturation)");
    expect(sat.skills.autoplan.route).toBe("FIX-METHOD (saturation)");
  });

  test("item 2, exposure: 7 of 8 sampled pass; 6 stops that skill, and the other re-sizes alone", () => {
    const seven = edit(slice(), (t) => t.arm === AP && t.task === "t00" && t.trial === 1, { exposed: false });
    expect(admitG(input(seven)).skills.autoplan.items[1]!.pass).toBe(true);
    const six = edit(seven, (t) => t.arm === AP && t.task === "t01" && t.trial === 1, { exposed: false });
    const a = admitG(input(six));
    expect([a.skills.autoplan.failed, a.skills.autoplan.route]).toEqual([2, "FIX-METHOD (exposure)"]);
    const alone = m1Decide(meteredPricer(a.metered.inputs), ["autoplan"]);
    expect(alone.runs["plan-eng-review"]).not.toBeNull();
    expect(a.skills["plan-eng-review"].design).toEqual(alone.runs["plan-eng-review"]);
    const per = admitG(input(edit(six, (t) => t.arm === PER && (t.task === "t00" || t.task === "t01") && t.trial === 1, { exposed: false })));
    expect(per.skills["plan-eng-review"].route).toBe("FIX-METHOD (exposure)");
    expect(per.skills["plan-eng-review"].design).toBeNull();
  });

  test("item 2's sample must be 8 told trials on 8 tasks, each scored and read by the detector", () => {
    expect(() => admitG(input(slice(), { exposure_sample: { "plan-eng-review": SAMPLE.slice(1), autoplan: SAMPLE } }))).toThrow(/8/);
    expect(() => admitG(input(slice(), { exposure_sample: { "plan-eng-review": [...SAMPLE.slice(1), { task: "t01", trial: 2 }], autoplan: SAMPLE } }))).toThrow(/twice/);
    const gap = edit(slice(), (t) => t.arm === PER && t.task === "t03" && t.trial === 1, { status: "gap", mutation: null });
    expect(() => admitG(input(gap))).toThrow(/not a scored/);
  });

  test("items read in order and stop at the first failure: an item 1 floor with a malformed or gap-holding sample prints its readings", () => {
    const gapped = edit(noneSolved(4), (t) => t.arm === PER && t.task === "t00" && t.trial === 1, { status: "gap" });
    for (const a of [admitG(input(gapped)), admitG(input(noneSolved(4), { exposure_sample: { "plan-eng-review": SAMPLE.slice(1), autoplan: SAMPLE } }))]) {
      for (const s of ["plan-eng-review", "autoplan"] as const) {
        expect([a.skills[s].failed, a.skills[s].route, a.skills[s].design]).toEqual([1, "FIX-METHOD (floor)", null]);
        expect(a.skills[s].items.map((x) => x.pass)).toEqual([false, null, null, null, null]);
      }
    }
  });

  test("an unreplaced gap in the exposure sample throws even when the told arm's gaps pass item 4's limit: admission never infers that section 5's replacement ran out", () => {
    const trials = edit(slice(), (t) => t.arm === PER && t.trial === 1 && ["t00", "t01", "t02"].includes(t.task), { status: "gap" });
    expect(() => admitG(input(trials))).toThrow(/replace it as prereg section 5 says/);
    const two = edit(slice(), (t) => t.arm === PER && t.trial === 1 && ["t00", "t11"].includes(t.task), { status: "gap" });
    expect(() => admitG(input(two))).toThrow(/replace it as prereg section 5 says/);
  });

  test("a sample repaired by section 5's replacement reads item 2 and routes by it, with the told arm's gaps past item 4's limit", () => {
    const gaps = edit(slice(), (t) => t.arm === PER && t.trial === 1 && ["t00", "t11"].includes(t.task), { status: "gap" });
    const trials = edit(gaps, (t) => t.arm === PER && t.trial === 1 && ["t01", "t02"].includes(t.task), { exposed: false });
    const repaired = [{ task: "t00", trial: 2 }, ...SAMPLE.slice(1)];
    const p = admitG(input(trials, { exposure_sample: { "plan-eng-review": repaired, autoplan: SAMPLE } })).skills["plan-eng-review"];
    expect([p.failed, p.route]).toEqual([2, "FIX-METHOD (exposure)"]);
    expect(p.items[1]!.reading).toMatch(/^6 of 8 sampled told trials exposed/);
    expect(p.items[3]!.pass).toBeNull();
  });

  for (const [skill, arm, key] of [["plan-eng-review", PER, "M_PER"], ["autoplan", AP, "M_AP"]] as const) {
    test("a told arm with no scored trial is refused instead of leaving " + key + " out of item 5, even when an earlier item already stopped it (GST-1374)", () => {
      const trials = edit(noneSolved(4), (t) => t.arm === arm, { status: "gap", cost_usd: null, mutation: null, exposed: null });
      expect(() => admitG(input(trials))).toThrow(new RegExp(skill + ":? .*no scored trial.*" + key));
    });
  }
  test("item 5's AUTH_PAID and AUTH_EXTRA are refused up front outside the (0, 1000) range resize.py reads", () => {
    expect(() => admitG(input(slice(), { auth_extra_usd: 0 }))).toThrow(/auth_extra_usd/);
    expect(() => admitG(input(slice(), { auth_paid_usd: 1000 }))).toThrow(/auth_paid_usd/);
    expect(admitG(input(slice(), { auth_extra_usd: 0.01 })).metered.inputs.AUTH_EXTRA).toBe(0.01);
  });

  test("item 3, instruments: 90% of trees scored without a tool error passes; less, or a tree without a verifier run, fails", () => {
    const four = edit(slice(), (t, i) => t.arm === AP && i < 4, { mutation: "tool_error" });
    expect(admitG(input(four)).skills.autoplan.items[2]!.pass).toBe(true);
    const five = edit(slice(), (t, i) => t.arm === AP && i < 5, { mutation: "tool_error" });
    expect(admitG(input(five)).skills.autoplan.route).toBe("FIX-METHOD (instrument)");
    expect(admitG(input(five)).skills["plan-eng-review"].items[2]!.pass).toBe(true);
    expect(admitG(input(edit(slice(), (t, i) => t.arm === PER && i < 10, { mutation: "no_tests" }))).skills["plan-eng-review"].items[2]!.pass).toBe(true);
    expect(admitG(input(edit(slice(), (t, i) => t.arm === PER && i === 3, { verifier_ran: false }))).skills["plan-eng-review"].failed).toBe(3);
  });

  test("item 4, rig: one gap per arm passes; two, or an unexplained arm stop, fail; none's gaps fail both", () => {
    const one = edit(slice(), (t, i) => t.arm === PER && i === 23, { status: "gap", mutation: null });
    expect(admitG(input(one)).skills["plan-eng-review"].items[3]!.pass).toBe(true);
    const two = edit(slice(), (t, i) => t.arm === PER && i >= 22, { status: "gap", mutation: null });
    expect(admitG(input(two)).skills["plan-eng-review"].route).toBe("FIX-METHOD (rig)");
    const none2 = edit(slice(), (t, i) => t.arm === NONE && i >= 22, { status: "gap", mutation: null });
    const b = admitG(input(none2));
    expect([b.skills["plan-eng-review"].failed, b.skills.autoplan.failed]).toEqual([4, 4]);
    const stop = edit(slice(), (t, i) => t.arm === AP && i === 20, { truncated: true, solved: false, stop_explained: false });
    expect(admitG(input(stop)).skills.autoplan.failed).toBe(4);
    const explained = edit(slice(), (t, i) => t.arm === AP && i === 20, { truncated: true, solved: false, stop_explained: true });
    expect(admitG(input(explained)).skills.autoplan.failed).toBeNull();
  });

  test("item 5, price and power: a told arm too dear for any design stops as FIX-METHOD (price), and the survivor re-sizes alone", () => {
    const dear = edit(slice(), (t) => t.arm === AP, { cost_usd: 0.955 * 30 });
    const a = admitG(input(dear));
    expect([a.skills.autoplan.failed, a.skills.autoplan.route]).toEqual([5, "FIX-METHOD (price)"]);
    expect(a.skills["plan-eng-review"].design).toEqual(m1Decide(meteredPricer(a.metered.inputs), []).runs["plan-eng-review"]);
    expect(a.skills["plan-eng-review"].design).not.toBeNull();
  });

  test("told means print exposed and unexposed apart, and a scored trial with no meter record is refused", () => {
    const mixed = edit(slice(), (t, i) => t.arm === PER && i >= 20, { exposed: false, cost_usd: 1.5 });
    const a = admitG(input(mixed));
    expect(a.metered.told["plan-eng-review"].unexposed_usd).toBeCloseTo(1.5, 12);
    expect(a.metered.told["plan-eng-review"].exposed_usd).toBeCloseTo(2.101, 12);
    expect(a.metered.told["plan-eng-review"].all_usd).toBeCloseTo((20 * 2.101 + 4 * 1.5) / 24, 12);
    expect(() => admitG(input(edit(slice(), (t, i) => t.arm === NONE && i === 0, { cost_usd: null })))).toThrow(/meter/);
  });

  test("item 5's means are settled spend, and calls of unknown cost on each arm's leases print beside them, counted", () => {
    const unknown = { none: { calls: 0, micros: 0 }, "plan-eng-review": { calls: 1, micros: 640_912 }, autoplan: { calls: 2, micros: 1_500_000 } };
    const a = admitG(input(slice(), { unknown_calls: unknown }));
    expect(a.metered.unknown_calls).toEqual(unknown);
    for (const [key, want] of [["MULT", 0.955 / 0.191], ["M_PER", 2.101 / 0.955], ["M_AP", 4.775 / 0.955]] as const) expect(a.metered.inputs[key]).toBeCloseTo(want, 12);
    expect(a.skills["plan-eng-review"].items[4]!.reading).toContain("calls of unknown cost, left out of the metered means: none 0 ($0.00 held), told 1 ($0.640912 held)");
    expect(a.skills.autoplan.items[4]!.reading).toContain("told 2 ($1.50 held)");
    expect(() => admitG(input(slice(), { unknown_calls: undefined as never }))).toThrow(/unknown cost/);
    expect(() => admitG(input(slice(), { unknown_calls: { ...unknown, autoplan: { calls: -1, micros: 0 } } }))).toThrow(/unknown cost/);
    expect(() => admitG(input(slice(), { unknown_calls: { ...unknown, none: { calls: 1, micros: 0.5 } } }))).toThrow(/unknown cost/);
  });
});

describe("AUTH_PAID from the slice's U4 leases", () => {
  const dirs: string[] = [];
  afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
  const quote = { words: "Approved", by: "Captain", source: "approvals/test" };
  const usage = { input: 10, output: 5, reasoning: 0, cache_read: 0, cache_write: 0 };
  async function record(spends: number[], closeAll = true) {
    const dir = mkdtempSync(join(tmpdir(), "g-admission-"));
    dirs.push(dir);
    const rec = join(dir, "record"), local = LocalLedger.open(join(dir, "local.sqlite"));
    recordApproval(rec, { action: "init", item: "g-slice-author", cap_micros: 60_000_000, quotes: [quote], admission: "warn" });
    for (const [i, spend] of spends.entries()) {
      const l = openLease(rec, local, { item: "g-slice-author", run_id: "slice", amount_micros: 30_000_000, requireAdmission: () => null });
      const r = await local.reserve({ idempotency_key: "k" + i, lease_id: l.lease_id, cell: { run_id: "slice", arm: "author", task: "t", model: "m", trial: 1, attempt: 1, meter_id: "m" }, max_micros: spend });
      if (!r.ok) throw new Error(r.message);
      await local.settle(r.reservation.reservation_id, { kind: "spent", spent_micros: spend, usage });
      if (closeAll || i < spends.length - 1) settleLease(rec, local, l.lease_id);
    }
    return rec;
  }
  test("settled spend over valid tasks", async () => {
    expect(authPaidFromLedger(await record([10_000_000, 6_680_000]), ["g-slice-author"], 12)).toBeCloseTo(1.39, 12);
  });
  test("an open lease or an item with no lease is refused", async () => {
    const rec = await record([5_000_000, 1_000_000], false);
    expect(() => authPaidFromLedger(rec, ["g-slice-author"], 12)).toThrow(/open/);
    expect(() => authPaidFromLedger(rec, ["g-nothing"], 12)).toThrow(/no lease/);
  });
});

describe("calls of unknown cost from the run directory's close lines", () => {
  const dirs: string[] = [];
  afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
  const run = (lines: object[]) => {
    const dir = mkdtempSync(join(tmpdir(), "g-admission-"));
    dirs.push(dir);
    writeFileSync(join(dir, "sessions.jsonl"), lines.map((l) => JSON.stringify(l) + "\n").join(""));
    return dir;
  };
  const open = (id: string, item: string) => ({ event: "open", id, item, lease_id: item + ".0001.000000" });
  const close = (id: string, item: string, unknown_calls: number, unknown_micros: number) => ({ event: "close", id, item, spent_micros: 300_000, unknown_micros, unknown_calls });
  test("sums the unknown calls and their reservations from each session's close on the arm's items, as counted at the close", () => {
    const dir = run([open("s1", "g-adm-pe"), close("s1", "g-adm-pe", 1, 640_912), open("s2", "g-adm-pe"), close("s2", "g-adm-pe", 2, 1_281_824), open("s3", "g-adm-ap"), close("s3", "g-adm-ap", 5, 9_000_000)]);
    expect(unknownFromRun(dir, ["g-adm-pe"])).toEqual({ calls: 3, micros: 1_922_736 });
    expect(unknownFromRun(dir, ["g-adm-pe", "g-adm-ap"])).toEqual({ calls: 8, micros: 10_922_736 });
  });
  test("refuses a session with an open line and no close line, an item with no session, no items and a close line without its counts", () => {
    expect(() => unknownFromRun(run([open("s1", "g-adm-pe"), close("s1", "g-adm-pe", 0, 0), open("s2", "g-adm-pe")]), ["g-adm-pe"])).toThrow(/s2.*open/);
    expect(() => unknownFromRun(run([open("s1", "g-adm-pe"), close("s1", "g-adm-pe", 0, 0)]), ["g-nothing"])).toThrow(/no session/);
    expect(() => unknownFromRun(run([]), [])).toThrow(/name the line items/);
    expect(() => unknownFromRun(run([open("s1", "g-adm-pe"), { event: "close", id: "s1", item: "g-adm-pe", unknown_micros: 5 }]), ["g-adm-pe"])).toThrow(/whole/);
  });
});
