// Copyright (c) 2026 Garry Tan. MIT License.
// The analysis (sections 9, 13, 14, 16, 17): every verdict rule with a table that must fire it and tables that must not,
// Stage 1's A1 to A6, the missing-pair and infrastructure rules, the exposure gate and H1's pre-data reporting amendment.
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { admission, AMENDMENT, h1Verdict, h2Verdict, h3Verdict, powerPy, repoOf, report, type Admission, type HmRowIn } from "../../lanes/harness-mechanics/analyze.ts";
import { REPO } from "../../lanes/harness-mechanics/pins.ts";
import { KNOWN, stage1, stage4 } from "../../lanes/harness-mechanics/synth.ts";

const SIMS = 40;
setDefaultTimeout(60_000);
const s1 = new Map<string, Admission>();
const adm = (name: string) => s1.get(name) ?? s1.set(name, admission(stage1(name), { sims: SIMS })).get(name)!;
const rep = (rows: HmRowIn[], s1name = "keep-in", extra = {}) => report(rows, { stage1: adm(s1name), ...extra }, { sims: SIMS });
const none = (i: number) => i % 3 !== 0;

describe("verdict rules", () => {
  test("H1, first rule that matches", () => {
    expect(h1Verdict([-0.02, 0.01], [-0.1, -0.01], true)).toBe("HOOK COSTS PASSES");
    expect(h1Verdict([-0.02, 0.01], [-0.1, -0.01], false)).toBe("NO MEASURABLE DIFFERENCE");
    expect(h1Verdict([0.01, 0.1], [-0.07, 0.03], true)).toBe("HOOK FOLLOWED MORE");
    expect(h1Verdict([0.01, 0.1], [-0.075, 0.03], true)).toBe("HOOK FOLLOWED MORE, SHIPPING UNTESTED");
    expect(h1Verdict([0.01, 0.1], [-0.07, 0.03], false)).toBe("HOOK FOLLOWED MORE, SHIPPING UNTESTED");
    expect(h1Verdict([0, 0.1], [-0.07, 0.03], true)).toBe("NO MEASURABLE DIFFERENCE");
    expect(h1Verdict([-0.1, -0.01], [-0.07, 0.03], true)).toBe("PROSE FOLLOWED MORE");
    expect(h1Verdict([-0.1, 0], [-0.07, 0.03], true)).toBe("NO MEASURABLE DIFFERENCE");
    expect(h1Verdict([0.01, 0.1], [-0.1, -0.01], true)).toBe("HOOK COSTS PASSES");
  });
  test("H2", () => {
    expect(h2Verdict([0.001, 0.04])).toBe("VERIFIER COMPUTE WINS");
    expect(h2Verdict([0, 0.04])).toBe("EQUAL AT EQUAL SPEND");
    expect(h2Verdict([-0.04, -0.001])).toBe("GSTACK WINS");
    expect(h2Verdict([-0.05, 0.05])).toBe("EQUAL AT EQUAL SPEND");
    expect(h2Verdict([-0.051, 0.03])).toBe("NO MEASURABLE DIFFERENCE");
    expect(h2Verdict([-0.03, 0.06])).toBe("NO MEASURABLE DIFFERENCE");
    expect(h2Verdict(null)).toBe("NO MEASURABLE DIFFERENCE");
  });
  test("H3", () => {
    expect(h3Verdict([-0.1, -0.01], 0.2)).toBe("JEV COSTS PASSES");
    expect(h3Verdict([-0.07, 0.02], 0.49)).toBe("JEV MATCHES AND IS FASTER");
    expect(h3Verdict([-0.07, 0.02], 0.5)).toBe("NO CLEAR SPEED GAIN");
    expect(h3Verdict([-0.075, 0.02], 0.49)).toBe("JEV FASTER, SHIPPING UNTESTED");
    expect(h3Verdict([-0.075, 0.02], 0.9)).toBe("NO CLEAR SPEED GAIN");
  });
});

describe("known tables: every rule and end state", () => {
  for (const k of KNOWN) test(k.name + " reads " + k.rule + " and ends " + k.end, () => {
    const r = report(k.rows(), { stage1: adm(k.stage1), ...k.config }, { sims: SIMS });
    const v = r.json.verdicts[k.q];
    expect(v.rule).toBe(k.rule);
    expect(v.end).toStartWith(k.end);
    const nulls = ["NO MEASURABLE DIFFERENCE", "PROSE FOLLOWED MORE", "HOOK COSTS PASSES", "VERIFIER COMPUTE WINS", "NO CLEAR SPEED GAIN", "JEV COSTS PASSES", "NOT ADMITTED"];
    if (nulls.includes(k.rule) || v.end.startsWith("FIX-METHOD")) expect(Object.keys(v.why ?? {})).toEqual(["exposure", "task_fit", "power", "frontier"]);
    if (k.rule === "HOOK FOLLOWED MORE" && v.end === "KEEP") expect(v.why).toBeUndefined();
  });
  test("NOT ADMITTED names a CUT-CANDIDATE per point not beaten and FIX-METHOD (labels) per NO READ point", () => {
    const k = KNOWN.find((x) => x.name === "h3-not-admitted")!;
    const v = report(k.rows(), { stage1: adm("keep-in"), ...k.config }, { sims: SIMS }).json.verdicts.H3;
    expect(v.end).toContain("CUT-CANDIDATE: the done judgment hook");
    expect(v.end).toContain("FIX-METHOD (labels): risky");
  });
  test("after drop step 1, H3 pools Opus and Sol and prints the power line", () => {
    const k = KNOWN.find((x) => x.name === "h3-after-drop-1")!;
    const r = report(k.rows(), { stage1: adm("keep-in"), ...k.config }, { sims: SIMS });
    expect(r.json.verdicts.H3.models).toEqual(["opus", "sol"]);
    expect(r.lines.some((l) => l.startsWith("H3 power after drop step 1: 120 pairs"))).toBe(true);
    const full = KNOWN.find((x) => x.name === "h3-jev-matches-faster")!;
    expect(report(full.rows(), { stage1: adm("keep-in"), ...full.config }, { sims: SIMS }).lines.some((l) => l.startsWith("H3 power after drop"))).toBe(false);
  });
});

describe("H1 pre-data reporting amendment", () => {
  const costs = (i: number) => ({ pass: none(i) && i % 5 !== 1, adherent: i % 2 === 0 });
  test("A4 keeps the shipping test out and P's upper bound is below 0: P's interval and the pass-loss sentence print", () => {
    const r = rep(stage4({ "verify-hook": costs }), "keep-out");
    const v = r.lines.find((l) => l.startsWith("H1 VERDICT"))!;
    expect(v).toContain("NO MEASURABLE DIFFERENCE");
    expect(v).toMatch(/P \(verify-hook minus verify-prose pass\) -?\d+\.\d points, 95% \[-?\d+\.\d, -\d+\.\d\]/);
    expect(r.lines.some((l) => l.startsWith("The hook arm lost passes on that interval") && l.includes("discordance passed the planned 0.20"))).toBe(true);
    for (const l of r.lines.filter((x) => x.includes("NO MEASURABLE DIFFERENCE") && x.startsWith("H1"))) expect(l).toContain("95% [");
  });
  test("A4 keeps it in: HOOK COSTS PASSES and no amendment sentence", () => {
    const r = rep(stage4({ "verify-hook": costs }), "keep-in");
    expect(r.json.verdicts.H1.rule).toBe("HOOK COSTS PASSES");
    expect(r.lines.some((l) => l.startsWith("The hook arm lost passes"))).toBe(false);
  });
  test("A4 keeps it out with P's upper bound at or above 0: P's interval prints, no pass-loss sentence", () => {
    const r = rep(stage4({}), "keep-out");
    expect(r.lines.find((l) => l.startsWith("H1 VERDICT"))).toContain("P (verify-hook minus verify-prose pass)");
    expect(r.lines.some((l) => l.startsWith("The hook arm lost passes"))).toBe(false);
  });
  test("the report states the amendment as recorded", () => {
    expect(AMENDMENT).toStartWith("Pre-data reporting amendment for H1 (before any data). The H1 verdict rules stand as written;");
    expect(rep(stage4({})).lines.join("\n")).toContain(AMENDMENT);
  });
});

describe("missing pairs, reruns and exposure bars", () => {
  test("5% missing is complete; more than 5% is INCOMPLETE", () => {
    expect(rep(stage4({ "verify-hook": (i) => ({ pass: none(i), adherent: true, outcome: i % 20 === 0 ? "infra" : "graded" }) })).json.verdicts.H1.rule).toBe("HOOK FOLLOWED MORE");
    expect(rep(stage4({ "verify-hook": (i) => ({ pass: none(i), adherent: true, outcome: i % 20 === 0 || i === 1 ? "infra" : "graded" }) })).json.verdicts.H1.rule).toBe("INCOMPLETE");
  });
  test("an infrastructure failure rerun as attempt 2 fills the pair; a second failure stays missing", () => {
    const rows = stage4({ "verify-hook": (i) => ({ pass: none(i), adherent: true, outcome: i % 10 === 0 ? "infra" : "graded" }) });
    const again = stage4({ "verify-hook": (i) => (i % 10 === 0 ? { pass: none(i), adherent: true } : null) }).filter((r) => r.arm === "verify-hook").map((r) => ({ ...r, trial: r.trial + "-attempt-2" }));
    expect(rep([...rows, ...again]).json.verdicts.H1.rule).toBe("HOOK FOLLOWED MORE");
    expect(rep(rows).json.verdicts.H1.rule).toBe("INCOMPLETE");
  });
  test("an exposure rate of exactly 90% passes the bar; under it is FIX-METHOD (exposure)", () => {
    expect(rep(stage4({ "verify-hook": (i) => ({ pass: none(i), adherent: true, record: i % 10 !== 0 }) })).json.verdicts.H1.end).toStartWith("KEEP");
    expect(rep(stage4({ "verify-hook": (i) => ({ pass: none(i), adherent: true, record: i % 10 !== 0 && i !== 1 }) })).json.verdicts.H1.end).toStartWith("FIX-METHOD (exposure)");
    expect(rep(stage4({ "verify-prose": (i) => ({ pass: none(i), adherent: i % 2 === 0, loads: i % 5 === 0 ? 0 : 1 }) })).json.verdicts.H2.end).toStartWith("FIX-METHOD (exposure)");
  });
  test("per-model lines print their MDD and carry no verdict; Opus comes first", () => {
    const r = rep(stage4({ "verify-hook": (i) => ({ pass: none(i), adherent: true }) }));
    const per = r.lines.filter((l) => /^(H1|H2|H3) (opus|sol|p1):/.test(l));
    expect(per.length).toBe(9);
    for (const l of per) { expect(l).toContain("MDD"); expect(l).not.toMatch(/VERDICT|KEEP|CUT-CANDIDATE|FIX-METHOD/); }
    const heads = r.lines.filter((l) => l.startsWith("### Model "));
    expect(heads[0]).toContain("claude-opus-5-5");
  });
  test("a task with more false done counts as worse, a task with more passes as better", () => {
    const r = rep(stage4({ "verify-hook": (i) => ({ pass: none(i) && i % 5 !== 1, adherent: i % 2 === 0 }) }));
    expect(r.lines.find((l) => l.startsWith("H1 secondary false done verify-hook minus verify-prose"))).toMatch(/worse [1-9]\d*, better 0;/);
    expect(r.lines.find((l) => l.startsWith("H1 pooled P"))).toMatch(/worse [1-9]\d*, better 0;/);
  });
  test("every comparison prints tasks worse and better with none's numbers beside it", () => {
    const r = rep(stage4({}));
    for (const l of r.lines.filter((x) => x.includes(" pairs; worse "))) expect(l).toMatch(/worse \d+, better \d+; none (passed|n\/a)/);
  });
});

describe("Stage 1 admission", () => {
  test("A4's keep-out rule fires past 0.20 and not below it", () => {
    expect(adm("keep-out").pooled.keep_out).toBe(true);
    expect(adm("keep-in").pooled.keep_out).toBe(false);
    expect(adm("keep-out").lines.some((l) => l.includes("shipping test OUT"))).toBe(true);
  });
  test("A1, A2, A3 and A5 fire on their tables and not on keep-in", () => {
    for (const mk of ["opus", "sol", "p1"]) {
      expect(adm("keep-in").models[mk]!.a1.ok).toBe(true);
      expect(adm("a1-fail").models[mk]!.a1.ok).toBe(false);
      expect(adm("keep-in").models[mk]!.a2.saturated).toBe(false);
      expect(adm("saturated").models[mk]!.a2.saturated).toBe(true);
      expect(adm("keep-in").models[mk]!.a3.ok).toBe(true);
      expect(adm("a3-fail").models[mk]!.a3.ok).toBe(false);
      expect(adm("keep-in").models[mk]!.a5.ok).toBe(true);
      expect(adm("a5-fail").models[mk]!.a5.ok).toBe(false);
    }
  });
  test("the likely-null line prints when the adherence gap is under power.py's MDD, and not otherwise", () => {
    expect(adm("likely-null").pooled.likely_null).toBe(true);
    expect(adm("likely-null").lines.some((l) => l.startsWith("STAGE1 A4 likely null"))).toBe(true);
    expect(adm("keep-in").pooled.likely_null).toBe(false);
    expect(adm("keep-in").lines.some((l) => l.startsWith("STAGE1 A4 likely null"))).toBe(false);
  });
  test("H2's MDD is re-read from power.py at the measured d0", () => {
    const p = adm("keep-in").pooled;
    expect(p.d0.x).toBeCloseTo(0.1, 5);
    expect(p.h2_mdd.map((x) => x.q)).toEqual([0.6, 0.8]);
    for (const x of p.h2_mdd) expect(x.mdd).toBeGreaterThan(0);
  });
  test("A6 applies section 22's drop order only past the line", () => {
    expect(adm("keep-in").a6.drop_step).toBe(0);
    expect(adm("keep-in").a6.inside).toBe(true);
    const over = adm("over-line").a6;
    expect(over.drop_step).toBeGreaterThan(0);
    expect(over.projections.map((x) => x.drop)).toEqual([...Array(over.drop_step + 1).keys()]);
    for (let i = 1; i < over.projections.length; i++) expect(over.projections[i]!.all_in_usd).toBeLessThan(over.projections[i - 1]!.all_in_usd);
  });
});

describe("power.py and repositories", () => {
  test("power.py's mdd at d 0.25 over 570 is section 16's 5.9 points", () => {
    expect(100 * (powerPy([["mdd", 0.25, 570]])[0] as number)).toBeCloseTo(5.87, 1);
  });
  test("a task's repository drops its issue number", () => {
    expect(repoOf("aws__bedrock-agentcore-sdk-python-279_interface")).toBe("aws__bedrock-agentcore-sdk-python");
    expect(repoOf("tobymao__sqlglot-6413")).toBe("tobymao__sqlglot");
  });
});

describe("cli", () => {
  const CLI = join(REPO, "lanes/harness-mechanics/cli.ts");
  const run = (args: string[]) => Bun.spawnSync([process.execPath, CLI, ...args], { cwd: REPO, env: { ...process.env, HM_SIMS: String(SIMS) } });
  test("admission prints A1 to A6; report writes report.md and report.json", () => {
    const d = mkdtempSync(join(tmpdir(), "hm-an-"));
    writeFileSync(join(d, "s1.jsonl"), stage1("keep-in").map((r) => JSON.stringify(r)).join("\n") + "\n");
    writeFileSync(join(d, "s4.jsonl"), stage4({ none: (i) => ({ pass: none(i), bo2: none(i) }) }).map((r) => JSON.stringify(r)).join("\n") + "\n");
    writeFileSync(join(d, "cfg.json"), JSON.stringify({ stage1_table: join(d, "s1.jsonl"), h3_admission: { points: [{ point: "done", result: "admitted" }] } }));
    const a = run(["admission", join(d, "s1.jsonl")]);
    expect(a.exitCode).toBe(0);
    for (const k of ["A1", "A2", "A3", "A4", "A5", "A6"]) expect(a.stdout.toString()).toContain("STAGE1 " + k + " ");
    const r = run(["report", join(d, "s4.jsonl"), join(d, "cfg.json"), join(d, "out")]);
    expect(r.exitCode).toBe(0);
    expect(readFileSync(join(d, "out", "report.md"), "utf8")).toContain("H1 VERDICT");
    expect(JSON.parse(readFileSync(join(d, "out", "report.json"), "utf8")).verdicts.H2.rule).toBe("EQUAL AT EQUAL SPEND");
    const bad = run(["report", join(d, "s4.jsonl")]);
    expect(bad.exitCode).toBe(2);
    expect(bad.stderr.toString()).toStartWith("E_USAGE");
  });
});
