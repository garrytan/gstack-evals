// Keyless tests of the L1 analysis (quick/laneb/l1/analyze.ts) on synthetic tables: the frozen power.txt reading, the behavior
// admission, Holm, both intervals, the gate reading, O5's descriptive line and every behavior verdict branch, through decide()
// and through the whole entry.
import { describe, expect, test } from "bun:test";
import { writeFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { admit, analyze, auditResult, auditSample, decide, holm, interp, markdown, readPowerTable, signFlipP, wilsonUpper, POWER_TXT, type DecideIn } from "../l1/analyze.ts";
import { config, passingAudit, row, table, TASKS } from "./fixtures/l1/synthetic.ts";

const power = readPowerTable();
const SLOW = 60_000;

describe("power.txt, read as frozen", () => {
  test("rows parse, read linearly between rows and at the nearest end row outside them", () => {
    expect(interp(power.holm2, 0.01)).toBeCloseTo(0.123, 6);
    expect(interp(power.holm2, 0)).toBeCloseTo(0.123, 6);
    expect(interp(power.holm2, 0.02)).toBeCloseTo(0.129, 6);
    expect(interp(power.holm2, 0.15)).toBeCloseTo(0.19, 6);
    expect(interp(power.holm2, 0.8)).toBeCloseTo(0.142, 6);
    expect(interp(power.holm2, 0.85)).toBeNull();
    expect(interp(power.holm2, 0.99)).toBeNull();
    expect(interp(power.o5, 0.67)).toBeCloseTo(0.1826, 6);
    expect(interp(power.o5, 0.95)).toBeCloseTo(0.098, 6);
  });
  test("a power.txt that is not the merged file is refused", () => {
    const dir = mkdtempSync(join(tmpdir(), "l1-power-"));
    writeFileSync(join(dir, "power.txt"), readFileSync(POWER_TXT, "utf8").replace("12.3", "12.4"));
    expect(() => readPowerTable(join(dir, "power.txt"))).toThrow(/not the merged power.txt/);
  });
});

describe("admission, Holm and the tests", () => {
  test("0 or 1 of 10 admits, 2 or more does not", () => {
    expect(Array.from({ length: 11 }, (_, x) => admit(x, 10, power).admitted)).toEqual([true, true, false, false, false, false, false, false, false, false, false]);
    expect(admit(0, 10, power)).toMatchObject({ mdd: expect.closeTo(0.129, 6), u: expect.closeTo(0.2775, 3) });
    expect(admit(1, 10, power).mdd).toBeCloseTo(0.177, 6);
  });
  test("Wilson upper bounds", () => {
    expect(wilsonUpper(0, 10)).toBeCloseTo(0.27753, 4);
    expect(wilsonUpper(1, 10)).toBeCloseTo(0.40415, 4);
    expect(wilsonUpper(5, 10)).toBeCloseTo(0.76336, 4);
  });
  test("Holm over two members, with a missing member at p = 1", () => {
    expect(holm([0.01, 0.04])).toEqual([0.02, 0.04]);
    expect(holm([0.03, 0.01])).toEqual([0.03, 0.02]);
    expect(holm([0.01, null])).toEqual([0.02, 1]);
  });
  test("sign-flip p is near 1 with no differences and small for a large one-sided shift", () => {
    expect(signFlipP([0, 0, 0])).toBe(1);
    expect(signFlipP(Array(12).fill(1))!).toBeLessThan(0.001);
    expect(signFlipP([1, -1, 1, -1])!).toBeGreaterThan(0.5);
    expect(signFlipP([])).toBeNull();
  });
  test("the probe audit: kappa at 0.7 with both classes of 10 or more, else 95% agreement; missing fails", () => {
    expect(auditResult(passingAudit(), "L", "opus")).toMatchObject({ rule: "kappa", pass: true, kappa: 1 });
    const off = passingAudit().map((l, i) => (l.probe === "L" && i % 5 === 0 ? { ...l, reader_value: !l.reader_value } : l));
    expect(auditResult(off, "L", "opus")).toMatchObject({ rule: "kappa", pass: false });
    const few = Array.from({ length: 25 }, (_, i) => ({ probe: "I" as const, model: "opus", trial: "t" + i, probe_value: i < 5, reader_value: i < 5 || i === 24 }));
    expect(auditResult(few, "I", "opus")).toMatchObject({ rule: "agreement", agreement: 0.96, pass: true });
    expect(auditResult([], "I", "opus")).toMatchObject({ rule: "missing", pass: false });
  });
  test("the audit sample takes up to 20 passed and 20 failed sessions per probe from F1", () => {
    const s = auditSample(table({ f1: { "after-u": { load: 30 }, "before-t": { complete: 5 } } }), "opus");
    expect(s.filter((x) => x.probe === "L").length).toBe(40);
    expect(s.filter((x) => x.probe === "I").length).toBe(25);
  });
});

const base: DecideIn = { member: "B1", notRun: false, admission: "admitted", coverageOk: true, est: 0, lo: -0.05, hi: 0.05, holmP: 0.5, auditPassed: true, droppedByDesign: false, constructionOk: true, exposureRate: 0.9, capStopOver: false, backgroundOver: false, mdd: 0.125, beforeUpper: 0.04 };
const keep = { est: 0.5, lo: 0.4, hi: 0.6, holmP: 0.001 };
const loss = { est: -0.5, lo: -0.6, hi: -0.4, holmP: 0.001 };
const v = (d: Partial<DecideIn>) => {
  const r = decide({ ...base, ...d });
  return r.reading + " " + r.verdict + (r.kind ? " (" + r.kind + ")" : "");
};

describe("every behavior verdict branch (decide)", () => {
  test("KEEP, and a KEEP whose probe failed its audit or that is not powered", () => {
    expect(v(keep)).toBe("KEEP KEEP");
    expect(v({ ...keep, auditPassed: false })).toBe("KEEP FIX-METHOD (method)");
    expect(v({ ...keep, mdd: 0.212 })).toBe("KEEP FIX-METHOD (saturation)");
  });
  test("LOSS: CUT-CANDIDATE only when audit, exposure and cap stops hold, else the first that fails", () => {
    expect(v({ ...loss, member: "B3" })).toBe("LOSS CUT-CANDIDATE");
    expect(v({ ...loss, auditPassed: false, exposureRate: 0.1, capStopOver: true })).toBe("LOSS FIX-METHOD (method)");
    expect(v({ ...loss, exposureRate: 0.1, capStopOver: true })).toBe("LOSS FIX-METHOD (exposure)");
    expect(v({ ...loss, constructionOk: false })).toBe("LOSS FIX-METHOD (exposure)");
    expect(v({ ...loss, capStopOver: true })).toBe("LOSS FIX-METHOD (harness limit)");
    expect(v({ ...loss, backgroundOver: true })).toBe("LOSS CUT-CANDIDATE");
    expect(v({ ...loss, mdd: null })).toBe("LOSS FIX-METHOD (saturation)");
  });
  test("a null runs harness limit, method, exposure, saturation, then CUT-CANDIDATE, in that order", () => {
    expect(v({ capStopOver: true, auditPassed: false })).toBe("NULL FIX-METHOD (harness limit)");
    expect(v({ backgroundOver: true })).toBe("NULL FIX-METHOD (harness limit)");
    expect(v({ auditPassed: false, exposureRate: 0 })).toBe("NULL FIX-METHOD (method)");
    expect(v({ droppedByDesign: true })).toBe("NULL FIX-METHOD (method)");
    expect(v({ exposureRate: 0.79, mdd: 0.3 })).toBe("NULL FIX-METHOD (exposure)");
    expect(v({ constructionOk: false })).toBe("NULL FIX-METHOD (exposure)");
    expect(v({ exposureRate: null })).toBe("NULL FIX-METHOD (exposure)");
    expect(v({ mdd: 0.215 })).toBe("NULL FIX-METHOD (saturation)");
    expect(v({ mdd: null })).toBe("NULL FIX-METHOD (saturation)");
    expect(v({ beforeUpper: 0.8 })).toBe("NULL FIX-METHOD (saturation)");
    expect(v({})).toBe("NULL CUT-CANDIDATE");
    expect(v({ holmP: 0.04, lo: -0.01 })).toBe("NULL CUT-CANDIDATE");
  });
  test("not run, not admitted, no admission and no outcome", () => {
    expect(v({ notRun: true, ...keep })).toBe("NOT_RUN NONE");
    expect(v({ admission: "not_admitted", ...keep })).toBe("NOT_ADMITTED FIX-METHOD (saturation)");
    expect(v({ admission: "incomplete" })).toBe("NO_ADMISSION NONE");
    expect(v({ admission: "no_pilot" })).toBe("NO_ADMISSION NONE");
    expect(v({ coverageOk: false, ...keep })).toBe("NO_OUTCOME FIX-METHOD (harness limit)");
  });
});

const verdicts = (rep: ReturnType<typeof analyze>, model = "opus") => rep.models.find((m) => m.model === model)!.primaries.map((p) => p.member + " " + p.decision.reading + " " + p.decision.verdict + (p.decision.kind ? " (" + p.decision.kind + ")" : ""));

describe("the whole entry on synthetic tables", () => {
  test("refuses a table scored by another probes.ts", () => {
    const rows = table();
    rows[3] = { ...rows[3]!, probes_sha256: "0".repeat(64) };
    expect(() => analyze(rows, config())).toThrow(/tabled by probes.ts 000000000000, not the current/);
  });
  test("KEEP on both members, the gate met, and a model the ceiling refused printed as not run with its MDD", () => {
    const rep = analyze(table({ f1: { "before-u": { load: 1 }, "after-u": { load: 60 }, "off-u": { load: 1 }, "before-t": { complete: 2 }, "after-t": { complete: 50 }, "off-t": { complete: 40 } } }), config({ models: [{ id: "opus", status: "run" }, { id: "sol", status: "not_run" }] }));
    expect(verdicts(rep)).toEqual(["B1 KEEP KEEP", "B3 KEEP KEEP"]);
    const opus = rep.models[0]!;
    expect(opus.gate).toMatchObject({ n: 80, complete: 50, met: true });
    expect(opus.gate.probes_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(opus.primaries[0]!.contrast.est).toBeCloseTo(59 / 80, 6);
    expect(opus.primaries[0]!.contrast.task_ci.lo).toBeGreaterThan(0.6);
    expect(opus.secondary.S6[0]!.est).toBeCloseTo(59 / 80, 6);
    expect(verdicts(rep, "sol")).toEqual(["B1 NOT_RUN NONE", "B3 NOT_RUN NONE"]);
    expect(rep.models[1]!.primaries[0]!.not_run_mdd).toBeCloseTo(0.129, 6);
    expect(markdown(rep)).toContain("not run under the $2,000 ceiling");
  }, SLOW);
  test("a powered loss is CUT-CANDIDATE, and a clean null on a low before rate is CUT-CANDIDATE", () => {
    const rep = analyze(table({ f1: { "before-u": { load: 1 }, "after-u": { load: 1 }, "before-t": { complete: 56 }, "after-t": { complete: 8 } } }), config());
    expect(verdicts(rep)).toEqual(["B1 NULL CUT-CANDIDATE", "B3 LOSS CUT-CANDIDATE"]);
    expect(rep.models[0]!.gate.met).toBe(false);
  }, SLOW);
  test("not admitted at 2 of 10, Holm keeps two members, and O5 prints with no verdict at a 67% before-t rate", () => {
    const tasks = Array.from({ length: 100 }, (_, i) => "o" + (i % 30) + "__r" + (i % 30) + "-" + i);
    const rep = analyze(table({ tasks, pilot: { load: 2 }, f1: { "before-u": { load: 1 }, "after-u": { load: 70 }, "before-t": { complete: 1, pass: 67 }, "after-t": { complete: 60, pass: 70 } } }), config({ f1_tasks: tasks, routed_stratum: tasks.slice(0, 50) }));
    expect(verdicts(rep)).toEqual(["B1 NOT_ADMITTED FIX-METHOD (saturation)", "B3 KEEP KEEP"]);
    const [b1, b3] = rep.models[0]!.primaries;
    expect(b1!.admission).toMatchObject({ status: "not_admitted", x: 2, n: 10 });
    expect(b3!.holm_p).toBeCloseTo(Math.min(1, 2 * b3!.contrast.p!), 9);
    const o5 = rep.models[0]!.o5;
    expect(o5.before_t_rate).toBeCloseTo(0.67, 9);
    expect(o5.mdd).toBeCloseTo(0.1826, 6);
    expect(o5.contrast.est).toBeCloseTo(0.03, 9);
    expect(o5.verdict).toMatch(/^none/);
    const md = markdown(rep);
    expect(md).toContain("before-t 67.0%, power.txt MDD@0.05 there +18.3. Unpowered: no verdict.");
    expect(md).toMatch(/\| O5 \(descriptive\) \|[^\n]*\| - \|/);
  }, SLOW);
  test("cap stops over 10% in a contrast arm and background work over 10% send nulls to harness limit", () => {
    const rep = analyze(table({ f1: { "before-u": { load: 1 }, "after-u": { load: 2 }, "before-t": { complete: 1 }, "after-t": { complete: 2 } }, extra: (arm, i) => (arm === "after-u" && i < 9 ? { allowance_stop: true } : arm === "after-t" && i < 9 ? { background_at_result: true } : {}) }), config());
    expect(verdicts(rep)).toEqual(["B1 NULL FIX-METHOD (harness limit)", "B3 NULL FIX-METHOD (harness limit)"]);
    expect(rep.models[0]!.secondary.S13.f1["after-t"]).toEqual({ sessions: 80, background: 9, over: true });
  }, SLOW);
  test("a missing audit sends nulls to method; unrecorded hooks send them to exposure", () => {
    const counts = { "before-u": { load: 1 }, "after-u": { load: 2 }, "before-t": { complete: 1 }, "after-t": { complete: 2 } };
    expect(verdicts(analyze(table({ f1: counts }), config({ audit: [] })))).toEqual(["B1 NULL FIX-METHOD (method)", "B3 NULL FIX-METHOD (method)"]);
    const rep = analyze(table({ f1: counts, extra: () => ({ route_hook: null, contract_record: null }) }), config());
    expect(verdicts(rep)).toEqual(["B1 NULL FIX-METHOD (exposure)", "B3 NULL FIX-METHOD (exposure)"]);
    expect(rep.models[0]!.secondary.S11.route_hook_after_u).toMatchObject({ n: 80, fired: 0, unrecorded: 80, routed_n: 40 });
  }, SLOW);
  test("coverage under 90% gives no outcome; a before rate of 30% is not powered, for a null and for a rise", () => {
    const rep = analyze(table({ f1: { "before-u": { load: 24 }, "after-u": { load: 24 }, "before-t": { complete: 1 }, "after-t": { complete: 40 } }, extra: (arm, i) => (arm === "after-t" && i >= 71 ? { outcome: "infra" } : {}) }), config());
    expect(verdicts(rep)).toEqual(["B1 NULL FIX-METHOD (saturation)", "B3 NO_OUTCOME FIX-METHOD (harness limit)"]);
    const rise = analyze(table({ f1: { "before-u": { load: 24 }, "after-u": { load: 70 }, "before-t": { complete: 1 }, "after-t": { complete: 1 } } }), config());
    expect(verdicts(rise)[0]).toBe("B1 KEEP FIX-METHOD (saturation)");
  }, SLOW);
  test("descriptive contrasts and O5 follow the coverage rule: under 90% graded in an arm gives no outcome", () => {
    const rep = analyze(table({ f1: { "before-u": { load: 1, pass: 10 }, "after-u": { load: 2, pass: 20 }, "before-t": { complete: 1 }, "after-t": { complete: 2 } }, extra: (arm, i) => (arm === "none" && i > 0 ? { outcome: "infra" } : arm === "after-t" && i >= 70 ? { outcome: "infra" } : {}) }), config());
    const m = rep.models[0]!;
    expect(m.secondary.S1.map((c) => c.coverage!.ok)).toEqual([false, false]);
    expect(m.secondary.S5.map((c) => c.coverage!.ok)).toEqual([false, false]);
    expect(m.secondary.S3[0]!.coverage).toMatchObject({ ok: true, clusters_missing: 0 });
    expect(m.o5.outcome).toBe(false);
    expect(m.o5.contrast.coverage).toMatchObject({ ok: false, per: [{ arm: "after-t", graded: 70, planned: 80 }, { arm: "before-t", graded: 80, planned: 80 }] });
    const md = markdown(rep);
    expect(md).toMatch(/\| S1 pass \| after-t [^\n]*\| no outcome \(coverage\) \| - \| - \| - \|/);
    expect(md).toMatch(/\| S3 pass \| after-u 25\.0% \(80\) \| before-u 12\.5% \(80\) \| 80 \| \+12\.5 \|/);
    expect(md).toContain("O5: no outcome under the coverage rule");
    expect(md).not.toContain("O5: +");
  }, SLOW);
  test("B1 also prints on the routed stratum", () => {
    const rep = analyze(table({ f1: { "after-u": { load: 30 } } }), config({ routed_stratum: TASKS.slice(0, 40) }));
    const m = rep.models[0]!;
    expect(m.primaries[0]!.contrast.est).toBeCloseTo(30 / 80, 9);
    expect(m.b1_routed).toMatchObject({ a: "after-u", b: "before-u", metric: "load", tasks: 40, a_n: 40, coverage: { ok: true, clusters_planned: 40 } });
    expect(m.b1_routed.est).toBeCloseTo(30 / 40, 9);
    expect(markdown(rep)).toMatch(/\| B1 routed stratum \| after-u 75\.0% \(40\) \| before-u 0\.0% \(40\) \| 40 \| \+75\.0 \|[^\n]*\| - \|/);
  }, SLOW);
  test("the repository interval resamples repositories, so clustered gains widen it", () => {
    const tasks = Array.from({ length: 80 }, (_, i) => "o" + Math.floor(i / 8) + "__r" + Math.floor(i / 8) + "-" + i);
    const rep = analyze(table({ tasks, f1: { "before-u": { load: 0 }, "after-u": { load: 24 } } }), config({ f1_tasks: tasks, routed_stratum: tasks }));
    const c = rep.models[0]!.primaries[0]!.contrast;
    expect(c.repo_ci.hi - c.repo_ci.lo).toBeGreaterThan(c.task_ci.hi - c.task_ci.lo);
  }, SLOW);
  test("a config without routed_stratum or construction_checks is refused", () => {
    const { routed_stratum: _r, ...noRouted } = config();
    expect(() => analyze([row("opus", "f1", "none", TASKS[0]!)], noRouted as any)).toThrow(/routed_stratum/);
    const { construction_checks: _c, ...noChecks } = config();
    expect(() => analyze([row("opus", "f1", "none", TASKS[0]!)], noChecks as any)).toThrow(/construction_checks/);
  });
});
