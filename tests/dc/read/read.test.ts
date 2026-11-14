// Copyright (c) 2026 Garry Tan. MIT License.
// The read area's tests: its dry-run cases pass, and the readings agree with main's paired statistics, round exactly,
// refuse what they must and write design.json with digests and counts only.
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clusteredPairedDelta, holmAdjusted } from "../../../src/runner/stats/paired.ts";
import { DcError } from "../../../lanes/design-constructed/errors.ts";
import { READS, SEED } from "../../../lanes/design-constructed/frozen.ts";
import { admissionRead, buildDesign, projectionRerun, resize, validateDesign } from "../../../lanes/design-constructed/read/admission.ts";
import { cases, cell, planningInputs } from "../../../lanes/design-constructed/read/dryrun-cases.ts";
import { atLeast, atMost, q4, show } from "../../../lanes/design-constructed/read/num.ts";
import { kMultiple, stage1Reading, twinCheck } from "../../../lanes/design-constructed/read/stage1.ts";
import { contrast, primaries, verdict } from "../../../lanes/design-constructed/read/stage2.ts";
import { seededRandom } from "../../../src/runner/stats/paired.ts";

const code = (f: () => unknown) => {
  try {
    f();
  } catch (e) {
    if (e instanceof DcError) return e.code;
    throw e;
  }
  return null;
};

describe("dc read dry-run cases", () => {
  test("every case passes and names a one-word rule", async () => {
    const list = cases();
    expect(list.length).toBeGreaterThan(80);
    for (const c of list) {
      expect(c.rule).toMatch(/^\S+$/);
      expect([c.rule + " " + c.name, await c.check()]).toEqual([c.rule + " " + c.name, null]);
    }
  });
});

describe("M12 rounding", () => {
  test("q4 rounds the decimal expansion half away from zero", () => {
    const vectors: [number, number][] = [[0, 0], [0.65, 6500], [0.65004, 6500], [0.65005, 6501], [0.6500499999, 6500], [-0.12345, -1235], [-0.00004, 0], [1 / 3, 3333], [2 / 3, 6667], [0.1 + 0.2, 3000], [1.00005, 10001], [12.34565, 123457]];
    for (const [x, want] of vectors) expect([x, q4(x)]).toEqual([x, want]);
    expect(Object.is(q4(-0.00004), -0)).toBe(false);
  });
  test("thresholds compare exactly at four decimals", () => {
    expect(atMost(0.65, 0.65)).toBe(true);
    expect(atMost(0.6501, 0.65)).toBe(false);
    expect(atLeast(0.29995, 0.3)).toBe(true);
    expect(atLeast(0.29994, 0.3)).toBe(false);
    expect(show(Infinity)).toBe("infinite");
  });
});

describe("contrasts against main's paired statistics", () => {
  const units = Array.from({ length: 12 }, (_, i) => "u" + i);
  const app = new Map(units.map((u, i) => [u, "app" + (i % 5)]));
  const rng = seededRandom(11);
  const cells = units.flatMap((u) => [
    cell(u, "none", 1, Math.round(rng() * 5) / 5),
    cell(u, "none", 2, Math.round(rng() * 5) / 5),
    cell(u, "plan-design-review", 1, Math.round(rng() * 5) / 5),
    ...(u === "u3" ? [] : [cell(u, "plan-design-review", 2, Math.round(rng() * 5) / 5)]),
  ]);
  test("the contrast is clusteredPairedDelta on per-arm unit means, clustered on the base app at seed 20261114", () => {
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const items = units.map((u) => ({
      id: u,
      cluster: app.get(u)!,
      a: mean(cells.filter((c) => c.unit === u && c.arm === "none").map((c) => c.a!)),
      b: mean(cells.filter((c) => c.unit === u && c.arm === "plan-design-review").map((c) => c.a!)),
    }));
    const want = clusteredPairedDelta(items, { seed: SEED, draws: READS.draws });
    const got = contrast({ cells, model: "opus", b: "plan-design-review", a: "none", tier: "base", baseAppOf: app });
    expect([got.delta, got.ci95, got.p, got.clusters, got.pMethod]).toEqual([want.delta, want.ci95, want.p_two_sided, 5, "exact-sign-flip"]);
  });
  test("Holm runs over exactly the two primaries", () => {
    const p = primaries({ cells, model: "opus", tier: "base", baseAppOf: app }, []);
    expect(p["plan-design-review"].holm).toBe(holmAdjusted([p["plan-design-review"].pIn, 1])[0]!);
  });
  test("a contrast with no unit in both arms is refused", () => {
    expect(code(() => contrast({ cells: [cell("u1", "lens", 1, 0.5)], model: "opus", b: "lens", a: "none", tier: "base", baseAppOf: app }))).toBe("E_USAGE");
  });
});

describe("stage 1 readings", () => {
  test("the twin check is deterministic at its seed", () => {
    const pairs = Array.from({ length: 7 }, (_, n) => ({ pair: "p" + n, first: [0.2, 0.4, 0.6].map((a, i) => cell("p" + n + "a", "none", i + 1, a)), second: [0.4, 0.4, 0.2 + n / 20].map((a, i) => cell("p" + n + "b", "none", i + 1, a)) }));
    expect(twinCheck(pairs)).toEqual(twinCheck([...pairs].reverse()));
  });
  test("k's interval brackets k on varied units", () => {
    const k = kMultiple(Array.from({ length: 12 }, (_, i) => ({ unit: "c" + i, base: 0.6 + (i % 3) / 10, x2: 0.3 + (i % 4) / 20 })));
    expect(k.ci95[0]).toBeLessThanOrEqual(k.k);
    expect(k.ci95[1]).toBeGreaterThanOrEqual(k.k);
  });
  test("a CEILING with no 2x reads given is refused, not guessed", () => {
    const twin = twinCheck(Array.from({ length: 6 }, (_, n) => ({ pair: "p" + n, first: [0.4, 0.4, 0.4].map((a, i) => cell("a" + n, "none", i + 1, a)), second: [0.4, 0.4, 0.4].map((a, i) => cell("b" + n, "none", i + 1, a)) })));
    expect(code(() => stage1Reading({ twin, opusJudge: { kappa: 0.8, goldShort: false }, stockFailOpus: false, opusNoneParse: { parsed: 48, replies: 48 }, base: { none: 0.7, reference: 0.9 } }))).toBe("E_USAGE");
  });
});

describe("the admission read", () => {
  test("design.json is written beside nothing else and holds digests and counts", () => {
    const dir = mkdtempSync(join(tmpdir(), "dc-read-test-"));
    try {
      const d = buildDesign(Array.from({ length: 6 }, (_, i) => ({ unit: "u" + i, baseApp: "owner/app-" + (i % 2), items: 3 + (i % 3) })), { p0Measured: 0.0412, passesArm: 2, passesNone: 2 });
      const r = admissionRead(d, { dir, run: () => ({ code: 0, stdout: "ADMIT x power 0.912 se 0.004 -> pass\nMDD x MDD over 0.40\n", stderr: "" }) });
      expect(existsSync(r.designPath)).toBe(true);
      const text = readFileSync(r.designPath, "utf8");
      expect(text).not.toContain("owner/app");
      expect(JSON.parse(text).p0).toBe(0.05);
      expect([r.pass, r.power, r.se, r.mdd]).toEqual([true, 0.912, 0.004, null]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  test("a power.py failure or an unreadable print is never read as a pass", () => {
    const dir = mkdtempSync(join(tmpdir(), "dc-read-test-"));
    try {
      const d = validateDesign({ p0: 0.2, rho: 0.5, passes_arm: 2, passes_none: 2, units: [{ repo: "a".repeat(64), items: 4 }] });
      expect(code(() => admissionRead(d, { dir, run: () => ({ code: 2, stdout: "", stderr: "E_USAGE items must be 1 to 6" }) }))).toBe("E_USAGE");
      expect(code(() => admissionRead(d, { dir, run: () => ({ code: 0, stdout: "power 0.9", stderr: "" }) }))).toBe("E_INTERNAL");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  test("a unit outside the frozen 3 to 5 items and a non-frozen ICC are refused", () => {
    expect(code(() => validateDesign({ p0: 0.2, rho: 0.5, passes_arm: 2, passes_none: 2, units: [{ repo: "x", items: 6 }] }))).toBe("E_USAGE");
    expect(code(() => validateDesign({ p0: 0.2, rho: 0.4, passes_arm: 2, passes_none: 2, units: [{ repo: "x", items: 4 }] }))).toBe("E_USAGE");
  });
});

describe("the projection and the re-sizing", () => {
  test("cuts never raise the projection and particle-1 stays", () => {
    const o = projectionRerun(planningInputs(3.5));
    expect(o.design.passes.particle).toEqual({ none: 1, lens: 1, "plan-design-review": 1, autoplan: 1 });
    const alls = o.lines.map((l) => Number(/all-in \$(\d+\.\d+)/.exec(l)?.[1] ?? NaN)).filter(Number.isFinite);
    for (let i = 1; i < alls.length; i++) expect(alls[i]!).toBeLessThanOrEqual(alls[i - 1]!);
  });
  test("re-sizing caps the set at 64 and refuses a non-integer count", () => {
    expect(resize(80).units).toBe(64);
    expect(resize(48).units).toBe(48);
    expect(code(() => resize(50.5))).toBe("E_USAGE");
  });
});

describe("verdicts", () => {
  test("a verdict never reads before its arm's re-smoke", () => {
    const twin = twinCheck(Array.from({ length: 6 }, (_, n) => ({ pair: "p" + n, first: [0.4, 0.4, 0.4].map((a, i) => cell("a" + n, "none", i + 1, a)), second: [0.4, 0.4, 0.4].map((a, i) => cell("b" + n, "none", i + 1, a)) })));
    const stage1 = stage1Reading({ twin, opusJudge: { kappa: 0.8, goldShort: false }, stockFailOpus: false, opusNoneParse: { parsed: 48, replies: 48 }, base: { none: 0.3, reference: 0.7 } });
    const smoke = { arm: "autoplan" as const, model: "opus" as const, outcome: "repair" as const, label: null, untested: [], code: null, holmP1: false, meanUsd: 2, lines: [] };
    expect(code(() => verdict({ stage1, incomplete: null, smoke, untested: { judgeOk: true, stockFail: false, exposure: 1, interimStopped: false, missing: { arm: 0, none: 0 }, contamination: 0 }, primary: { arm: "autoplan", contrast: null, pIn: 1, holm: 1 }, mdd: null }))).toBe("E_USAGE");
  });
});
