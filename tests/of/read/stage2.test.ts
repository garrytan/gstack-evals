// Value: protects=section 11's manifest, coverage, verdicts and reading rule, and AN-1's pitch-only cell: what decides each model's verdict and what never reaches a primary number.
import { describe, expect, test } from "bun:test";
import { COMPARISON, session, stage2Fixture } from "../../../lanes/office-hours-founder/read/seams.ts";
import { bandDecide } from "../../../lanes/office-hours-founder/read/stage1.ts";
import { CUTS, manifest, readStage2 } from "../../../lanes/office-hours-founder/read/stage2.ts";
import { rounds } from "../../../lanes/office-hours-founder/read/projection.ts";

const units64 = Array.from({ length: 64 }, (_, k) => "x" + String(k).padStart(2, "0"));
const helps = (e: { arm: string }) => (e.arm === "office-hours" ? 1 : 0) as 0 | 1;

describe("manifest", () => {
  test("Opus 3 arms at 2 passes, Sol and particle-1 at 1, in rounds of 4 units with every arm", () => {
    const m = manifest(units64, { kind: "arm", real: false, cuts: [] });
    expect(m.length).toBe(64 * 3 * 4);
    expect(m.filter((e) => e.model === "opus").length).toBe(64 * 3 * 2);
    const rs = rounds(m);
    expect(rs.length).toBe(16 * 4);
    expect(rs.every((r) => r.length === 12 && new Set(r.map((e) => e.unit)).size === 4 && new Set(r.map((e) => e.model + r[0]!.pass)).size === 1)).toBe(true);
    expect(manifest(units64, { kind: "arm", real: false, cuts: [] })).toEqual(m);
    expect(m.slice(0, 12).map((e) => e.unit)).not.toEqual(units64.slice(0, 4).flatMap((u) => [u, u, u]));
  });
  test("the cuts remove their cells only", () => {
    const m = manifest(units64, { kind: "arm", real: false, cuts: [...CUTS] });
    expect(m.some((e) => e.arm === "lens" && e.model !== "opus")).toBe(false);
    expect(m.filter((e) => e.model === "opus" && e.arm === "lens").every((e) => e.pass === 1)).toBe(true);
    expect(m.filter((e) => e.arm !== "lens").length).toBe(64 * 2 * 4);
    expect(manifest(["r1"], { kind: "arm", real: true, cuts: ["real sol and particle"] }).every((e) => e.model === "opus")).toBe(true);
    expect(manifest(["r1"], { kind: "arm", real: false, cuts: ["real sol and particle"] }).some((e) => e.model === "sol")).toBe(true);
  });
  test("the pitch-only cell: every arm, one pass on every model, never cut", () => {
    const m = manifest(units64, { kind: "pitch", real: false, cuts: [...CUTS] });
    expect(m.length).toBe(64 * 3 * 3);
    expect(m.every((e) => e.kind === "pitch" && e.pass === 1)).toBe(true);
  });
});

describe("readStage2", () => {
  test("a clean gain reads helps and KEEP on every model, with the side reads", () => {
    const r = readStage2(stage2Fixture({ w: helps }));
    for (const m of ["opus", "sol", "particle"] as const) {
      const c = r.models[m].contrasts["office-hours-none"];
      expect(c.verdict).toBe("helps");
      expect(c.w).toMatchObject({ units: 10, delta: 1, worse: 0 });
      expect(r.models[m].reading.keep).toBe(true);
      expect(r.models[m].contrasts["lens-none"].verdict).toBe("no measurable difference");
    }
    expect(r.models.opus.effective_units).toBe(10);
    expect(r.models.opus.mdd).toBe(0.13);
    expect(r.models.opus.interim).toMatchObject({ ready: false, stop: false });
    expect(r.models.sol.interim).toBeNull();
    expect(r.models.opus.secondaries.length).toBe(45);
    expect(r.models.opus.splits.map((s) => s.split + ":" + s.group)).toEqual(["shape:other shapes", "type:B2B", "author:sol", "founder stage:pre-product"]);
  });
  test("intention to treat scores missing sessions 0; the sensitivity read treats C1 zeros as missing", () => {
    const r = readStage2(stage2Fixture({ w: helps, edit: (s) => (s.model === "sol" && s.arm === "office-hours" && s.unit === "u01" ? { ...s, W: null, end: "missing" } : s.model === "sol" && s.arm === "office-hours" && s.unit === "u02" ? { ...s, W: 0, end: "no-block" } : s) }));
    const c = r.models.sol.contrasts["office-hours-none"];
    expect(c.w).toMatchObject({ units: 9, delta: 0.8889 });
    expect(c.itt).toMatchObject({ units: 10, delta: 0.8 });
    expect(c.sensitivity).toMatchObject({ units: 8, delta: 1 });
  });
  test("stage 1 not HEADROOM, a voided stage and a failed gold re-check read untested and name each condition", () => {
    const i = stage2Fixture({ w: helps });
    const r = readStage2({ ...i, voided: true, stage1: { ...i.stage1, band: bandDecide(0.7, 0.9, false) }, gold: { ...i.gold, sol: i.gold.sol.map((g) => ({ ...g, judged: !g.gold })) } });
    expect(r.models.opus.contrasts["office-hours-none"].why).toBe("stage 1 did not read HEADROOM; simulator: the stage 2 fidelity audit voided the stage");
    expect(r.models.sol.contrasts["office-hours-none"].why).toContain("gold re-check kappa -1 under 0.6");
    expect(r.models.opus.reading.fix_method).toStartWith("untested (");
    expect(r.codes).toEqual(["E_OF_SIM_AUDIT", "E_OF_JUDGE_KAPPA"]);
  });
  test("a smoke drop binds office-hours contrasts only; stage 1 stock binds every contrast of its model", () => {
    const i = stage2Fixture({ w: helps });
    const r = readStage2({ ...i, stage1: { ...i.stage1, smoke_drop: { ...i.stage1.smoke_drop, sol: true }, untested: { ...i.stage1.untested, particle: ["stock"] } } });
    expect(r.models.sol.contrasts["office-hours-none"].why).toContain("smoke");
    expect(r.models.sol.contrasts["lens-none"].verdict).toBe("no measurable difference");
    expect(r.models.particle.contrasts["lens-none"].why).toBe("stock");
  });
  test("the interim stop: its arm's unrun cells don't make the run incomplete, and lens minus none still reads", () => {
    const i = stage2Fixture({ w: helps, stopped: true, edit: (s) => (s.model === "opus" && s.arm === "office-hours" && s.pass === 2 ? null : s.model === "opus" && s.arm === "office-hours" ? { ...s, exposed: false } : s) });
    const extra = manifest(Array.from({ length: 14 }, (_, k) => "v" + k), { kind: "arm", real: false, cuts: [] });
    const man = [...i.manifest, ...extra];
    const sessions = [...i.sessions, ...extra.filter((e) => e.pass === 1 || e.arm !== "office-hours" || e.model !== "opus").map((e) => session({ ...e, W: helps(e), exposed: e.arm === "office-hours" ? false : null }))];
    const r = readStage2({ ...i, manifest: man, sessions });
    expect(r.models.opus.interim).toMatchObject({ ready: true, stop: true });
    expect(r.models.opus.contrasts["office-hours-none"].why).toContain("the interim exposure stop");
    expect(r.models.opus.contrasts["office-hours-none"].why).not.toContain("incomplete");
    expect(r.models.opus.contrasts["lens-none"].why).not.toContain("incomplete");
    expect(r.codes).toContain("E_OF_EXPOSURE_STOP");
  });
  test("KEEP is flagged when E moves the other way with an interval that excludes zero", () => {
    const r = readStage2(stage2Fixture({ w: helps, edit: (s) => (s.arm === "office-hours" ? { ...s, E: 0.1 } : s) }));
    expect(r.models.opus.reading).toMatchObject({ keep: true, flagged: true });
  });
  test("AN-1: W_pitch per arm, the pitch difference and the conversation's part", () => {
    const pitch = manifest(COMPARISON, { kind: "pitch", real: false, cuts: [] }).map((e) => session({ ...e, W: e.arm === "office-hours" && Number(e.unit.slice(1)) <= 3 ? 1 : 0 }));
    const r = readStage2(stage2Fixture({ w: helps, extra: pitch }));
    const p = r.models.particle.pitch;
    expect(p.W_pitch).toEqual({ none: { units: 10, mean: 0 }, lens: { units: 10, mean: 0 }, "office-hours": { units: 10, mean: 0.3 } });
    expect(p.diff?.delta).toBe(0.3);
    expect(p.part).toMatchObject({ units: 10, mean_a: 0.3, mean_b: 1, delta: 0.7 });
    expect(p.condition).toBe(false);
    expect(r.models.opus.cells.every((c) => c.scheduled === 20)).toBe(true);
  });
});

describe("real stratum", () => {
  test("a unit whose session named the source leaves that model's real readout in every arm", () => {
    const real = ["r01", "r02", "r03"];
    const extra = manifest(real, { kind: "arm", real: true, cuts: [] }).map((e) => session({ ...e, stratum: "real", set: "real", W: e.arm === "none" ? 1 : 0, named_source: e.unit === "r01" && e.model === "opus" && e.arm === "office-hours" && e.pass === 1 }));
    const r = readStage2(stage2Fixture({ w: helps, extra, real }));
    expect(r.models.opus.real.W).toMatchObject({ units: 2, delta: -1 });
    expect(r.models.sol.real.W).toMatchObject({ units: 3, delta: -1 });
  });
});
