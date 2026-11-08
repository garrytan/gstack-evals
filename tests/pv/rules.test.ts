// Copyright (c) 2026 Garry Tan. MIT License.
import { describe, expect, test } from "bun:test";
import { readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { refuseAliases } from "../../lanes/product-value/io.ts";
import { admission, ceilingFlag, cutoffEnd, designMdd, interimStop, ittSwitch, judgeScore, leakReading, loadCutoffs, parsePower, readingRule, run, signsMatch, stockReading, twinCheck, twinDecide, untestedReasons, verdict, type CheckCell, type ReadingInput } from "../../lanes/product-value/rules.ts";
import { SEED } from "../../lanes/product-value/stats.ts";
import { capture, meta, row, tmp } from "./fixtures.ts";

describe("the twin check (section 4)", () => {
  test("part (a) fails only when the 90% interval lies wholly outside -0.10 to 0.10", () => {
    expect(twinDecide([0.1, 0.4], 0, 1).a_fail).toBe(false);
    expect(twinDecide([0.1001, 0.4], 0, 1).a_fail).toBe(true);
    expect(twinDecide([-0.4, -0.1], 0, 1).a_fail).toBe(false);
    expect(twinDecide([-0.4, -0.1001], 0, 1).a_fail).toBe(true);
  });
  test("part (b) fails only above its re-split 95th percentile", () => {
    expect(twinDecide([0, 0], 0.2, 0.2).track).toBe(true);
    expect(twinDecide([0, 0], 0.2001, 0.2).b_fail).toBe(true);
  });
  test("identical twins track; twins that miss in both directions fail part (b) though their signed mean cancels", () => {
    const same = Array.from({ length: 8 }, (_, i) => ({ unit: "o" + i, twin: "t" + i, a: [0.5, 0, (i % 2) / 2], b: [0, 0.5, (i % 2) / 2] }));
    expect(twinCheck(same).track).toBe(true);
    const opposite = Array.from({ length: 8 }, (_, i) => ({ unit: "o" + i, twin: "t" + i, a: i % 2 ? [1, 1, 1] : [0, 0, 0], b: i % 2 ? [0, 0, 0] : [1, 1, 1] }));
    const r = twinCheck(opposite);
    expect(r.a_fail).toBe(false);
    expect(r.b_fail).toBe(true);
    expect(r.track).toBe(false);
  });
});

describe("admission, stock and the judge check (sections 7, 8 and 10)", () => {
  const adm = (path: "pooled" | "public", a: number, extra = {}) => admission({ path, noneA: a, stockFail: false, astraOnOpus: true, parsed: 72, completed: 72, ...extra }).reading;
  test("band edges at four decimals on both paths", () => {
    expect([adm("pooled", 0.09), adm("pooled", 0.1), adm("pooled", 0.6), adm("pooled", 0.61)]).toEqual(["FLOOR", "HEADROOM", "HEADROOM", "CEILING"]);
    expect([adm("public", 0.5), adm("public", 0.51), adm("public", 0.50004)]).toEqual(["HEADROOM", "CEILING", "HEADROOM"]);
    expect(adm("pooled", 0.3, { stockFail: true })).toBe("STOCK FAIL");
    expect(adm("pooled", 0.3, { parsed: 68 })).toBe("NO READ");
  });
  test("STOCK FAIL above floor(n/8) units for one judge and one row", () => {
    const c = (n: number, of: number) => Array.from({ length: of }, (_, i) => ({ unit: "u" + i, model: "sol" as const, row: 3, credited: i < n }));
    expect(stockReading(c(3, 24), 24).fail).toBe(false);
    expect(stockReading(c(4, 24), 24).fail).toBe(true);
    expect(stockReading(c(6, 48), 48).fail).toBe(false);
    expect(stockReading(c(7, 48), 48).fail).toBe(true);
  });
  test("the judge check needs 40 gold cells a class from 40 lists, caps oracle cells, and gates on both kappas", () => {
    const cells = (realAnt: number, oracle: number, not: number, wrongReal = 0): CheckCell[] => [
      ...Array.from({ length: realAnt }, (_, i) => ({ gold: true, judged: i >= wrongReal, kind: "arm" as const, list: "r" + i })),
      ...Array.from({ length: oracle }, (_, i) => ({ gold: true, judged: true, kind: "oracle" as const, list: "o" + i })),
      ...Array.from({ length: not }, (_, i) => ({ gold: false, judged: false, kind: "arm" as const, list: "n" + i })),
    ];
    expect(judgeScore("opus", "j", cells(40, 0, 40), { seed: SEED, minimum: 40 }).pass).toBe(true);
    expect(judgeScore("opus", "j", cells(40, 0, 39), { seed: SEED, minimum: 40 }).reading).toBe("NO READ (judge)");
    const capped = judgeScore("opus", "j", cells(25, 30, 40), { seed: SEED, minimum: 40 });
    expect(capped.oracle_used).toBe(25);
    expect(capped.anticipated).toBe(50);
    const bad = judgeScore("opus", "j", cells(40, 0, 40, 20), { seed: SEED, minimum: 40 });
    expect(bad.false_fail).toBeCloseTo(20 / 40);
    expect(bad.kappa).toBeCloseTo(0.5);
    expect(bad.catch_rate).toBe(1);
    expect(bad.reading).toBe("kappa under 0.6");
  });
});

describe("verdicts and the reading rule (section 11)", () => {
  const base: ReadingInput = { none: { verdict: "no measurable difference", ci95: [-0.02, 0.03] }, lens: { verdict: "no measurable difference", ci95: [-0.02, 0.03] }, exposure: 0.85, headroom: true, stockPass: true, judgePass: true, coverage: 0.95, ceiling: false, pairwise: null, rItems: 31 };
  test("helps needs Holm, the interval and the specificity contrast in the same direction", () => {
    expect(verdict({ delta: 0.1, ci95: [0.02, 0.18], holm: 0.04, spec_ci95: [0.01, 0.1], sign_ok: true, untested: [] }).verdict).toBe("helps");
    expect(verdict({ delta: 0.1, ci95: [0.02, 0.18], holm: 0.04, spec_ci95: [-0.01, 0.1], sign_ok: true, untested: [] }).verdict).toBe("not shown");
    expect(verdict({ delta: 0.1, ci95: [0, 0.18], holm: 0.04, spec_ci95: [0.01, 0.1], sign_ok: true, untested: [] }).verdict).toBe("no measurable difference");
    expect(verdict({ delta: 0.1, ci95: [0.02, 0.18], holm: 0.01, spec_ci95: [0.01, 0.1], sign_ok: true, untested: ["untested (leak)"] }).verdict).toBe("untested");
  });
  test("CUT-CANDIDATE needs the bound under +0.05 and every gate; an untested primary never cuts", () => {
    expect(readingRule(base).cut).toBe(true);
    expect(readingRule({ ...base, exposure: 0.79 }).cut).toBe(false);
    expect(readingRule({ ...base, coverage: 0.89 }).cut).toBe(false);
    expect(readingRule({ ...base, headroom: false }).cut).toBe(false);
    expect(readingRule({ ...base, none: { verdict: "untested", ci95: [-0.02, 0.03] } }).cut).toBe(false);
    expect(readingRule({ ...base, none: { verdict: "no measurable difference", ci95: [-0.02, 0.05] } }).fix_method_power).toBe(true);
  });
  test("untested reasons, the ITT switch, signs and the CEILING flag", () => {
    expect(untestedReasons({ exposure: 0.8, coverage: [0.9, 0.9], stockFail: true, judgePass: true, leak: false })).toEqual(["untested (stock)"]);
    expect(ittSwitch(0.15, 0.1)).toBe(false);
    expect(ittSwitch(0.1501, 0.1)).toBe(true);
    expect(signsMatch(0, -1) && signsMatch(1, 0) && !signsMatch(1, -1)).toBe(true);
    expect(ceilingFlag(0.60004, "pooled")).toBe(false);
    expect(ceilingFlag(0.50005, "public")).toBe(true);
  });
});

describe("leaks, the MDD and the interim stop", () => {
  test("cutoffs.json records each model's stated cutoff with its provider source", () => {
    const c = loadCutoffs();
    expect(c.models.opus.cutoff).toBe("2026-06");
    expect(c.models.sol.cutoff).toBe("2026-04-30");
    expect(c.models.particle.cutoff).toBeNull();
    for (const m of Object.values(c.models)) expect(m.source).toMatch(/^https:\/\/(platform\.claude\.com|developers\.openai\.com|docs\.particle\.ai)\//);
    expect(cutoffEnd("2026-02")).toBe("2026-02-28");
    const units = [meta("a", { plan_date: "2026-06-30" }), meta("b", { plan_date: "2026-07-01" })];
    expect(leakReading(units, "opus", c).exposed).toEqual([]);
    expect(leakReading([meta("c", { plan_date: "2026-06-29" }), ...units], "opus", c)).toMatchObject({ exposed: ["c"], untested: true });
  });
  test("designMdd reads power.txt", () => {
    const rows = parsePower(readFileSync(join(import.meta.dir, "../../wiki/plans/2026-11-08-geva-403-product-value-prereg/power.txt"), "utf8"));
    expect(rows.length).toBe(80);
    expect(designMdd(rows, { meanItems: 1.5, n: 80, passes: 1 }).mdd).toBe(0.16);
    expect(designMdd(rows, { meanItems: 3.4, n: 64, passes: 2 }).mdd).toBe(0.09);
    expect(designMdd(rows, { meanItems: 1.5, n: 70, passes: 2 }).n).toBe(64);
  });
  test("the interim stop waits for 32 completed Opus skill sessions", () => {
    const rows = Array.from({ length: 31 }, (_, i) => row({ unit: "u", session: "s" + i, arm: "skill", exposed: false }));
    expect(interimStop(rows)).toMatchObject({ ready: false, stop: false });
    expect(interimStop([...rows, row({ unit: "u", session: "x", arm: "skill", exposed: false })]).stop).toBe(true);
  });
});

describe("the four-paths alias guard", () => {
  test("refuses two paths that resolve to the same real file, through a symlink or a dot path", () => {
    const dir = tmp();
    const f = join(dir, "labels.ndjson");
    require("node:fs").writeFileSync(f, "");
    symlinkSync(f, join(dir, "link.ndjson"));
    expect(() => refuseAliases([["--labels", f], ["--out", join(dir, "link.ndjson")]])).toThrow(/--labels and --out resolve to the same path/);
    expect(() => refuseAliases([["--a", join(dir, "new", "x.json")], ["--b", join(dir, "new", ".", "x.json")]])).toThrow(/same path/);
    expect(() => refuseAliases([["--a", f], ["--b", join(dir, "other.json")]])).not.toThrow();
  });
  test("pv readings refuses aliased paths before reading anything", () => {
    const dir = tmp();
    expect(() => run(["--stage", "2", "--family", "plan", "--units", dir, "--scores", join(dir, "s.json"), "--map", join(dir, "m.json"), "--labels", join(dir, "l.ndjson"), "--rows", join(dir, "r.ndjson"), "--out", join(dir, "s.json")], capture().io)).toThrow(/same path/);
  });
});
