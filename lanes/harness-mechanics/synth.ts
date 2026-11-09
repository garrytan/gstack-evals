// Copyright (c) 2026 Garry Tan. MIT License.
// Synthetic session tables with known answers, for the analysis tests and dry-run steps 8-analysis, verdict-tables and
// h1-amendment. Four tasks share a repository, so every interval resamples whole repositories as the real tables do.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { HmArm, HmScore } from "../../src/types.ts";
import { admission, AMENDMENT, FIT_CLASSES, report, type Admission, type HmRowIn, type Iv, type ReportConfig } from "./analyze.ts";
import type { StepResult } from "./dryrun.ts";
import { MODELS, type ModelKey } from "./pins.ts";

export type SynthCell = {
  pass?: boolean; edited?: boolean; adherent?: boolean; loads?: number; record?: boolean; cost?: number;
  outcome?: HmRowIn["outcome"]; claims_done?: boolean; bo2?: boolean | null; parsed?: boolean; picker?: number;
  hook_time?: number; hook_log?: boolean; audit?: string[];
};
export type Arms = Partial<Record<HmArm, (i: number, m: ModelKey) => SynthCell | null>>;
export type SynthSpec = { models?: ModelKey[]; tasks: number; arms: Arms };

const COST: Record<HmArm, number> = { none: 0.4, "plain-2": 0.4, "verify-prose": 0.55, "verify-hook": 0.55, "judge-jev": 0.57, "judge-p1": 0.57 };
export const taskName = (i: number) => "org" + Math.floor(i / 4) + "__repo" + Math.floor(i / 4) + "-" + (1000 + i);

export function synth(s: SynthSpec): HmRowIn[] {
  const out: HmRowIn[] = [];
  for (const m of s.models ?? (Object.keys(MODELS) as ModelKey[])) for (const [arm, f] of Object.entries(s.arms) as [HmArm, NonNullable<Arms[HmArm]>][]) for (let i = 0; i < s.tasks; i++) {
    const c = f(i, m);
    if (!c) continue;
    const told = arm !== "none" && arm !== "plain-2";
    const pass = c.pass ?? false, edited = c.edited ?? true, claims = c.claims_done ?? true;
    const outcome = c.outcome ?? "graded";
    const adherent = edited ? (c.adherent ?? false) : null;
    const record = arm === "verify-hook" ? (c.record ?? true) : null;
    const score: HmScore = {
      scorer: "synthetic", edited, last_edit: edited ? "Edit" : null, adherent, adherent_strict: adherent, check: null, lint_only: edited ? false : null,
      claim: claims ? "FIXED" : "NOT FIXED", claims_done: claims, false_done: outcome === "graded" ? claims && !pass : null,
      verify_loads: c.loads ?? (told ? 1 : 0), edit_before_last_load: false, last_edit_before_last_load: false, blocked_exit: false,
      hook: { record, outcome: null, blocks: 0, waived: false },
      patterns: { redirected_read: 0, tox_no_tests: 0, combined_flags: 0 },
      probes: { collectonly: 0, cache_show: 0, tox_notest: 0, make_check_format: 0, skill_contract_waive: 0 },
    };
    out.push({
      schema: "hm-session/1", model: MODELS[m].id, part: null, arm, task: taskName(i), trial: m + "-" + arm + "-" + i, outcome,
      pass: outcome === "graded" && pass, reward: pass ? 1 : 0, allowance_stop: false, turn_cap: false, reason: "synthetic",
      cost_usd: c.cost ?? COST[arm], tokens: null, contract_record: record, contract_check_met: null, audit_hits: c.audit ?? [], score,
      ...(arm === "none" ? { bo2_pass: c.bo2 === undefined ? pass : c.bo2, picker_parsed: c.parsed ?? true, picker_cost_usd: c.picker ?? 0.06 } : {}),
      ...(arm.startsWith("judge") ? { hook_time_s: c.hook_time ?? 10, hook_log: c.hook_log ?? true, hook_cost_usd: 0.01, fail_open: 0, escalations: 0 } : {}),
    });
  }
  return out;
}

// The base pattern: none passes two tasks in three, plain-2 differs on one in ten, the told arms pass as none does and
// run the rule on even tasks. A repository holds tasks 4k to 4k+3, so half(i) splits repositories in two halves.
const none = (i: number) => i % 3 !== 0;
const plain = (i: number) => none(i) !== (i % 10 === 0);
const half = (i: number) => i % 8 < 4;
const wide = (i: number) => (i % 2 === 0 ? !half(i) : half(i));
export const BASE: Arms = {
  none: (i) => ({ pass: none(i), bo2: none(i) || plain(i) }),
  "plain-2": (i) => ({ pass: plain(i) }),
  "verify-prose": (i) => ({ pass: none(i), adherent: i % 2 === 0 }),
  "verify-hook": (i) => ({ pass: none(i), adherent: i % 2 === 0 }),
};
const JUDGE: Arms = {
  "judge-jev": (i) => (i < 60 ? { pass: none(i), hook_time: 1 } : null),
  "judge-p1": (i) => (i < 60 ? { pass: none(i), hook_time: 10 } : null),
};
export const stage4 = (over: Arms, models?: ModelKey[]) => synth({ tasks: 200, models, arms: { ...BASE, ...JUDGE, ...over } });

// Stage 1 on 40 calibration tasks. keep-in: verify-prose and verify-hook differ on one task in twenty (d 0.05);
// keep-out: on one in three (d about 0.35, its 80% upper end past 0.20).
const hookIn: Arms = { "verify-hook": (i) => ({ pass: none(i) !== (i % 20 === 0), adherent: true }) };
export const STAGE1: Record<string, Arms> = {
  "keep-in": { ...BASE, ...hookIn },
  "keep-out": { ...BASE, "verify-hook": (i) => ({ pass: none(i) !== (i % 3 === 0), adherent: true }) },
  "a3-fail": { ...BASE, ...hookIn, "verify-prose": (i) => ({ pass: none(i), edited: i % 4 !== 0, adherent: i % 2 === 0 }) },
  saturated: { ...BASE, ...hookIn, "verify-prose": (i) => ({ pass: none(i), adherent: i % 20 !== 0 }) },
  "a1-fail": { ...BASE, ...hookIn, none: (i) => ({ pass: i % 20 !== 0 }) },
  "likely-null": { ...BASE, "verify-hook": (i) => ({ pass: none(i) !== (i % 20 === 0), adherent: (i % 2 === 0) !== (i % 5 === 0) }) },
  "a5-fail": { ...BASE, ...hookIn, none: (i) => ({ pass: none(i), parsed: i % 10 !== 0 }) },
  "over-line": { ...BASE, ...hookIn, "verify-prose": (i) => ({ pass: none(i), adherent: i % 2 === 0, cost: 3 }) },
};
export const stage1 = (name: string) => synth({ tasks: 40, arms: STAGE1[name]! });

export type Known = { name: string; q: "H1" | "H2" | "H3"; stage1: string; rows: () => HmRowIn[]; config?: Omit<ReportConfig, "stage1" | "stage1_table">; rule: string; end: string };
const ADMITTED: ReportConfig["h3_admission"] = { points: [{ point: "done", result: "admitted" }, { point: "risky", result: "not beaten" }] };

// Every rule of H1, H2 and H3 and every end-state branch, each with the verdict and end state it must read.
export const KNOWN: Known[] = [
  { name: "h1-hook-followed-more", q: "H1", stage1: "keep-in", rows: () => stage4({ "verify-hook": (i) => ({ pass: none(i), adherent: true }) }), rule: "HOOK FOLLOWED MORE", end: "KEEP" },
  { name: "h1-untested-wide-p", q: "H1", stage1: "keep-in", rows: () => stage4({ "verify-prose": (i) => ({ pass: half(i), adherent: i % 2 === 0 }), "verify-hook": (i) => ({ pass: wide(i), adherent: true }) }), rule: "HOOK FOLLOWED MORE, SHIPPING UNTESTED", end: "FIX-METHOD (power on passes)" },
  { name: "h1-untested-keep-out", q: "H1", stage1: "keep-out", rows: () => stage4({ "verify-hook": (i) => ({ pass: none(i), adherent: true }) }), rule: "HOOK FOLLOWED MORE, SHIPPING UNTESTED", end: "FIX-METHOD (power on passes)" },
  { name: "h1-costs-keep-in", q: "H1", stage1: "keep-in", rows: () => stage4({ "verify-hook": (i) => ({ pass: none(i) && i % 5 !== 1, adherent: i % 2 === 0 }) }), rule: "HOOK COSTS PASSES", end: "CUT-CANDIDATE" },
  { name: "h1-costs-keep-out", q: "H1", stage1: "keep-out", rows: () => stage4({ "verify-hook": (i) => ({ pass: none(i) && i % 5 !== 1, adherent: i % 2 === 0 }) }), rule: "NO MEASURABLE DIFFERENCE", end: "CUT-CANDIDATE" },
  { name: "h1-prose-followed-more", q: "H1", stage1: "keep-in", rows: () => stage4({ "verify-prose": (i) => ({ pass: none(i), adherent: true }) }), rule: "PROSE FOLLOWED MORE", end: "CUT-CANDIDATE" },
  { name: "h1-null", q: "H1", stage1: "keep-in", rows: () => stage4({}), rule: "NO MEASURABLE DIFFERENCE", end: "CUT-CANDIDATE" },
  { name: "h1-null-task-fit", q: "H1", stage1: "a3-fail", rows: () => stage4({}), rule: "NO MEASURABLE DIFFERENCE", end: "FIX-METHOD (task fit)" },
  { name: "h1-exposure", q: "H1", stage1: "keep-in", rows: () => stage4({ "verify-hook": (i) => ({ pass: none(i), adherent: true, record: i % 5 !== 0 }) }), rule: "HOOK FOLLOWED MORE", end: "FIX-METHOD (exposure)" },
  { name: "h1-incomplete", q: "H1", stage1: "keep-in", rows: () => stage4({ "verify-hook": (i) => ({ pass: none(i), adherent: true, outcome: i % 10 === 0 ? "infra" : "graded" }) }), rule: "INCOMPLETE", end: "FIX-METHOD (incomplete)" },
  { name: "h1-saturated", q: "H1", stage1: "saturated", rows: () => stage4({ "verify-hook": (i) => ({ pass: none(i), adherent: true }) }), rule: "HOOK FOLLOWED MORE", end: "FIX-METHOD (saturation)" },
  { name: "h2-verifier-compute-wins", q: "H2", stage1: "keep-in", rows: () => stage4({ none: (i) => ({ pass: none(i), bo2: true }) }), rule: "VERIFIER COMPUTE WINS", end: "CUT-CANDIDATE" },
  { name: "h2-gstack-wins", q: "H2", stage1: "keep-in", rows: () => stage4({ none: (i) => ({ pass: none(i), bo2: none(i) }), "verify-prose": () => ({ pass: true, adherent: true }) }), rule: "GSTACK WINS", end: "KEEP" },
  { name: "h2-equal", q: "H2", stage1: "keep-in", rows: () => stage4({ none: (i) => ({ pass: none(i), bo2: none(i) }) }), rule: "EQUAL AT EQUAL SPEND", end: "KEEP" },
  { name: "h2-null", q: "H2", stage1: "keep-in", rows: () => stage4({ none: (i) => ({ pass: half(i), bo2: half(i) }), "plain-2": (i) => ({ pass: half(i) }), "verify-prose": (i) => ({ pass: wide(i), adherent: true }) }), rule: "NO MEASURABLE DIFFERENCE", end: "FIX-METHOD (power)" },
  { name: "h2-incomplete", q: "H2", stage1: "keep-in", rows: () => stage4({ none: (i) => ({ pass: none(i), bo2: i % 10 === 0 ? null : none(i) }) }), rule: "INCOMPLETE", end: "FIX-METHOD (incomplete)" },
  { name: "h2-exposure", q: "H2", stage1: "keep-in", rows: () => stage4({ none: (i) => ({ pass: none(i), bo2: none(i), outcome: i % 5 === 0 ? "contaminated" : "graded", audit: i % 5 === 0 ? ["/root/.claude/skills/gstack/SKILL.md"] : [] }) }), rule: "INCOMPLETE", end: "FIX-METHOD (exposure)" },
  { name: "h2-saturated", q: "H2", stage1: "a1-fail", rows: () => stage4({ none: (i) => ({ pass: none(i), bo2: none(i) }) }), rule: "EQUAL AT EQUAL SPEND", end: "FIX-METHOD (saturation)" },
  { name: "h3-jev-matches-faster", q: "H3", stage1: "keep-in", rows: () => stage4({}), config: { h3_admission: ADMITTED }, rule: "JEV MATCHES AND IS FASTER", end: "KEEP" },
  { name: "h3-jev-faster-untested", q: "H3", stage1: "keep-in", rows: () => stage4({ "judge-jev": (i) => (i < 60 ? { pass: wide(i), hook_time: 1 } : null), "judge-p1": (i) => (i < 60 ? { pass: half(i), hook_time: 10 } : null) }), config: { h3_admission: ADMITTED }, rule: "JEV FASTER, SHIPPING UNTESTED", end: "FIX-METHOD (power on passes)" },
  { name: "h3-jev-costs-passes", q: "H3", stage1: "keep-in", rows: () => stage4({ "judge-jev": (i) => (i < 60 ? { pass: none(i) && i % 4 !== 1, hook_time: 1 } : null) }), config: { h3_admission: ADMITTED }, rule: "JEV COSTS PASSES", end: "CUT-CANDIDATE" },
  { name: "h3-no-speed-gain", q: "H3", stage1: "keep-in", rows: () => stage4({ "judge-jev": (i) => (i < 60 ? { pass: none(i), hook_time: 9 } : null) }), config: { h3_admission: ADMITTED }, rule: "NO CLEAR SPEED GAIN", end: "CUT-CANDIDATE" },
  { name: "h3-not-admitted", q: "H3", stage1: "keep-in", rows: () => stage4({}), config: { h3_admission: { points: [{ point: "done", result: "not beaten" }, { point: "risky", result: "no read" }] } }, rule: "NOT ADMITTED", end: "CUT-CANDIDATE" },
  { name: "h3-after-drop-1", q: "H3", stage1: "keep-in", rows: () => [...stage4({}, ["opus", "sol"]), ...stage4({ "judge-jev": () => null, "judge-p1": () => null }, ["p1"])], config: { h3_admission: ADMITTED, drop_step: 1 }, rule: "JEV MATCHES AND IS FASTER", end: "KEEP" },
  { name: "h3-exposure", q: "H3", stage1: "keep-in", rows: () => stage4({ "judge-jev": (i) => (i < 60 ? { pass: none(i), hook_time: 1, hook_log: i % 5 !== 0 } : null) }), config: { h3_admission: ADMITTED }, rule: "JEV MATCHES AND IS FASTER", end: "FIX-METHOD (exposure)" },
  { name: "h3-saturated", q: "H3", stage1: "a1-fail", rows: () => stage4({}), config: { h3_admission: ADMITTED }, rule: "JEV MATCHES AND IS FASTER", end: "FIX-METHOD (saturation)" },
];

// Dry-run steps 8-analysis, verdict-tables and h1-amendment, at power.py's Monte Carlo cut to SIMS runs (MDD text only;
// no verdict reads it). Each writes its tables' expected and actual readings under <out>/<step>/.
const SIMS = 200;
const admitted = new Map<string, Admission>();
const FIT = Object.fromEntries([...Array(40).keys()].map((i) => [taskName(i), FIT_CLASSES[i % FIT_CLASSES.length]!.code]));
const adm = (name: string) => admitted.get(name) ?? admitted.set(name, admission(stage1(name), { sims: SIMS, fit: FIT })).get(name)!;
const COSTS: Arms = { "verify-hook": (i) => ({ pass: none(i) && i % 5 !== 1, adherent: i % 2 === 0 }) };
const save = (out: string, step: string, lines: string[]) => { mkdirSync(join(out, step), { recursive: true }); writeFileSync(join(out, step, "tables.txt"), lines.join("\n") + "\n"); };
const upper = (v: { detail: Record<string, unknown> }) => ((v.detail.P as { ci: Iv }).ci ?? [NaN, NaN])[1];

/** Section 18 step 8: Stage 1's printout, then the two H1 tables where P's upper bound is below 0, through the whole report. */
export function stepAnalysis(out: string): StepResult {
  const lines: string[] = [], bad: string[] = [];
  const a = adm("keep-in");
  const missing = ["A1", "A2", "A3", "A4", "A5", "A6"].filter((k) => !a.lines.some((l) => l.startsWith("STAGE1 " + k + " ")));
  if (missing.length) bad.push("Stage 1 printout lacks " + missing.join(", "));
  for (const mk of Object.keys(MODELS)) {
    const at = a.lines.findIndex((l) => l.startsWith("STAGE1 A4 " + mk + ":"));
    const split = at < 0 ? [] : a.lines.slice(at + 1, at + 3 + FIT_CLASSES.length);
    if (split.length !== FIT_CLASSES.length + 2 || !split.every((l) => l.startsWith("STAGE1 FIT " + mk + " "))) bad.push("Stage 1 printout lacks ruling C's split print after A4 for " + mk);
  }
  for (const [name, keep, want] of [["keep-out", "OUT", "NO MEASURABLE DIFFERENCE"], ["keep-in", "IN", "HOOK COSTS PASSES"]] as const) {
    const r = report(stage4(COSTS), { stage1: adm(name) }, { out: join(out, "8-analysis", name), sims: SIMS });
    const v = r.json.verdicts.H1, vl = r.lines.find((l) => l.startsWith("H1 VERDICT"))!;
    const sentence = r.lines.some((l) => l.startsWith("The hook arm lost passes on that interval"));
    const okKeep = name === "keep-out" ? v.rule === want && sentence && vl.includes("95% [") : v.rule === want && !sentence;
    lines.push("TABLE h1-p-below-0-" + name + " shipping test " + keep + ", P upper " + (100 * upper(v)).toFixed(1) + ": expected " + want + (name === "keep-out" ? " with P's interval and the pass-loss sentence" : "") + "; actual " + v.rule + " -> " + v.end + (sentence ? " with the pass-loss sentence" : ""));
    if (!(upper(v) < 0) || !okKeep) bad.push(name);
    for (const s of ["## Verdicts", "## H1", "## H2", "## H3", "## Per model", "## Exposure", "## Patterns 1 to 3", "## Stage 1 admission"]) if (!r.lines.includes(s) && !r.lines.some((l) => l.startsWith(s))) bad.push(name + " lacks " + s);
    if (!existsSync(join(out, "8-analysis", name, "report.json")) || !existsSync(join(out, "8-analysis", name, "report.md"))) bad.push(name + " wrote no report files");
  }
  save(out, "8-analysis", lines);
  return bad.length ? { pass: false, detail: bad.join("; ") } : { pass: true, detail: "Stage 1 prints A1 to A6 and ruling C's split print by fit class; P below 0 with A4 out reads NO MEASURABLE DIFFERENCE beside P's interval and the pass-loss sentence, with A4 in HOOK COSTS PASSES; report.md and report.json written" };
}

/** Every verdict rule of H1, H2 and H3 and every end-state branch on a table with a known answer. */
export function stepVerdictTables(out: string): StepResult {
  const lines: string[] = [], bad: string[] = [];
  for (const k of KNOWN) {
    const v = report(k.rows(), { stage1: adm(k.stage1), ...k.config }, { sims: SIMS }).json.verdicts[k.q];
    const ok = v.rule === k.rule && v.end.startsWith(k.end);
    lines.push("TABLE " + k.name + " " + (ok ? "PASS" : "FAIL") + ": expected " + k.rule + " -> " + k.end + "; actual " + v.rule + " -> " + v.end.split(":")[0]);
    if (!ok) bad.push(k.name);
  }
  save(out, "verdict-tables", lines);
  return { pass: !bad.length, detail: (KNOWN.length - bad.length) + " of " + KNOWN.length + " tables read as expected" + (bad.length ? "; wrong: " + bad.join(", ") : "") + " (each table's expected and actual verdict in verdict-tables/tables.txt)" };
}

/** H1's pre-data reporting amendment as recorded: the text, P's interval under keep-out, the pass-loss sentence, never a bare null. */
export function stepAmendment(out: string): StepResult {
  const lines: string[] = [], bad: string[] = [];
  const cases = [["keep-out", COSTS, true, true], ["keep-out", {}, true, false], ["keep-in", COSTS, false, false]] as const;
  for (const [s1, arms, interval, sentence] of cases) {
    const r = report(stage4(arms), { stage1: adm(s1) }, { sims: SIMS });
    const vl = r.lines.find((l) => l.startsWith("H1 VERDICT"))!;
    const hasI = vl.includes("P (verify-hook minus verify-prose pass)"), hasS = r.lines.some((l) => l.startsWith("The hook arm lost passes on that interval") && l.includes("discordance passed the planned 0.20"));
    const bare = r.lines.some((l) => l.startsWith("H1") && l.includes("NO MEASURABLE DIFFERENCE") && !l.includes("95% ["));
    const text = r.lines.includes(AMENDMENT);
    lines.push("TABLE amendment " + s1 + (arms === COSTS ? " P below 0" : " P holds 0") + ": expected P interval " + interval + ", sentence " + sentence + "; actual " + hasI + ", " + hasS + ", bare null " + bare + ", amendment text " + text);
    if (hasI !== interval || hasS !== sentence || bare || !text) bad.push(s1 + (arms === COSTS ? " P below 0" : " P holds 0"));
  }
  save(out, "h1-amendment", lines);
  return bad.length ? { pass: false, detail: "wrong: " + bad.join(", ") } : { pass: true, detail: "the amendment prints as recorded; under keep-out P's interval sits beside the H1 verdict, the pass-loss sentence prints when P's upper bound is below 0, and NO MEASURABLE DIFFERENCE never stands alone; under keep-in neither prints" };
}

