import { describe, expect, test } from "bun:test";
import { analyze } from "../../../lanes/eng-planted/readings/analysis.ts";
import { fxWorld } from "../../../lanes/eng-planted/readings/fixtures.ts";
import type { JudgeResult } from "../../../lanes/eng-planted/readings/judge.ts";

const world = () => fxWorld(20, 1, 1, { standalone: () => ({ pass: 1 }), engphase: () => ({ pass: 0 }), stock: () => ({ pass: 0 }), none: () => ({ pass: 0 }) }, { draws: 2000 });

describe("the readout", () => {
  test("prints both the per-arm decision row and the Holm headline, each beside the invocation clause", () => {
    const a = analyze(world());
    const s = a.lines.filter((l) => l.startsWith("arm standalone"));
    expect(s.some((l) => l.startsWith("arm standalone decision row (its own test at alpha 0.05)"))).toBe(true);
    expect(s.some((l) => l.startsWith("arm standalone public headline (Holm across 2 families"))).toBe(true);
    expect(a.lines.filter((l) => l.includes("measured given an explicit invocation"))).toHaveLength(4);
    expect(a.arms.standalone.verdict).toBe("KEEP");
    expect(a.lines.some((l) => l.startsWith("secondary plain - none:"))).toBe(true);
    expect(a.lines.some((l) => l.startsWith("stratum ecosystem go"))).toBe(true);
    expect(a.lines.some((l) => l.startsWith("measures stock: builds 20"))).toBe(true);
    expect(a.lines.join("\n")).not.toContain("undefined");
  });
  test("an untested arm leaves Holm to the other family alone", () => {
    const w = world();
    w.smoke = w.smoke.map((r) => (r.arm === "engphase" ? { ...r, exposed: false } : r));
    const a = analyze(w);
    expect(a.arms.engphase.verdict).toBe("untested");
    expect(a.arms.standalone.holm?.adjusted).toBe(a.arms.standalone.reading?.p);
    expect(a.pair).toStartWith("untested");
  });
  test("the hard population is named and the judged secondary prints find rates, leaks, words, the generic rate and the section map", () => {
    const w = { ...world(), population: "hard" as const };
    const bundles: JudgeResult[] = [];
    for (const u of w.units)
      for (const source of ["plain", "engphase", "standalone", "stock", "none", "plan"] as const) {
        const named = source === "standalone" || (u.id === "u0" && (source === "stock" || source === "plan"));
        bundles.push({ unit: u.id, source, words: source === "standalone" ? 2000 : 800, quotes: named ? ["Return an error on a send to a closed channel."] : [], named, sections: named ? ["failure modes"] : [], role: "judge", matched: named ? 0 : null, dropped: 0, over: 0, truncated: false, error: null, digest: "d" });
      }
    const a = analyze({ ...w, judged: { reported: true, why: null, bundles, leaks: ["u0"] } });
    const text = a.lines.join("\n");
    expect(a.lines[0]).toContain("hard units only");
    expect(text).toContain("plan leaks dropped 1");
    expect(text).toContain("standalone 1.000, stock 0.000");
    expect(text).toMatch(/judged find rate standalone - plain: \+1\.000 .* units 19/);
    expect(text).toContain("judged section map standalone (a lead for the rewrite brief, never a finding): failure modes 19");
    expect(text).toContain("standalone 19 of 19");
    expect(analyze({ ...w, judged: { reported: false, why: "kappa 0.41 is under 0.60", bundles: [], leaks: [] } }).lines.join("\n")).toContain("judged secondary: not reported as judged (kappa 0.41 is under 0.60)");
  });
  test("gaps scored 0, limit stops left out and the clean check outside the pilot print for every skill arm", () => {
    const w = world();
    w.units = w.units.map((u, i) => ({ ...u, pilot: i < 5 }));
    w.builds = w.builds.map((b, i) => (b.arm === "standalone" && i % 7 === 0 ? { ...b, limitStop: true } : b));
    const a = analyze(w);
    expect(a.lines.find((l) => l.startsWith("arm standalone gaps scored 0"))).toContain("limit stops left out");
    expect(a.lines.find((l) => l.startsWith("arm engphase clean check"))).toContain("units 15");
  });
});
