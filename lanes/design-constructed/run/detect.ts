// Copyright (c) 2026 Garry Tan. MIT License.
// The two exposure detectors (2026-11-09-geva-420 section 4, plan section 10), read from the strings gstack b6155921
// (VERSION 1.98.0.0) itself writes: plan-design-review/SKILL.md and sections/review-sections.md, lib/autoplan-lean.ts's
// LEAN line and the run directory's files. Exposure is read from these detectors on the final transcript, the final
// plan.md and the run directory, never from a gate's own report. The pattern follows D's lanes/devex/run/exposure.ts at
// 5ee7f764232b196a1d0cec5b144a287b792f9c94.
//
// plan-design-review is exposed when all four show: (a) at least five of the seven pass names in the skill's order
// (the longest run of names whose first appearances keep the skill's order, case and spacing ignored; BT) in the
// main agent's own words or the final plan.md; (b) a table line whose cells hold LOADING, EMPTY, ERROR, SUCCESS and
// PARTIAL; (c) a Design Review Completion Summary (the heading the skill writes, or its boxed title) followed by a
// pass row with a score out of 10, or a GSTACK REVIEW REPORT section holding a Design Review row; (d) plan.md changed
// by the session. Reading plan-design-review/sections/review-sections.md is the load check, printed as a secondary.
//
// autoplan is exposed when the run directory shows: the LEAN line naming the design lens (run.json records a lean run
// whose scope puts ui in and docs_only out, which is how leanLine renders the lenses), exactly one bound native result
// (one native attempt in all and no outside one, its bound file starting with its INPUT receipt and holding a
// gstack-findings fence), a gate answered rec by the harness (agent:harness), and a run that reached APPROVED and
// exported (status complete, plan.md and review-record.md written) with gstack-artifact validate passing on run.json.
import { DETECTOR, DETECTOR_PASS_NAMES, STATE_TABLE_HEADER } from "../frozen.ts";
import { ownWords, skillFileRead } from "./transcript.ts";

export const PDR_REVIEW_SECTIONS = "plan-design-review/sections/review-sections.md";
/** The skill's early exit at the pin (SKILL.md, UI Scope Detection). */
export const PDR_NO_UI = "This plan has no UI scope. A design review isn't applicable.";

const nameRe = (n: string) => new RegExp(n.split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+"), "i");

/** How many pass names show in the skill's order: the longest subsequence of names whose first positions increase. */
export function passNamesInOrder(text: string): number {
  const pos = DETECTOR_PASS_NAMES.map((n) => text.search(nameRe(n))).filter((p) => p >= 0);
  const best: number[] = [];
  for (let i = 0; i < pos.length; i++) best[i] = 1 + Math.max(0, ...pos.slice(0, i).map((p, j) => (p < pos[i]! ? best[j]! : 0)));
  return Math.max(0, ...best);
}

export function stateTable(text: string): boolean {
  return text.split("\n").some((l) => l.includes("|") && STATE_TABLE_HEADER.every((h) => new RegExp("(?:^|[\\s|])" + h + "(?:[\\s|]|$)").test(l)));
}

export function completionSummary(text: string): boolean {
  const summary = /Design Review Completion Summary|DESIGN PLAN REVIEW\s*[\u2014-]+\s*COMPLETION SUMMARY/i.exec(text);
  if (summary && /Pass\s*[1-7][^\n]*?\b\d{1,2}\s*\/\s*10\b/i.test(text.slice(summary.index))) return true;
  const report = /^#{1,6}\s*GSTACK REVIEW REPORT\s*$/m.exec(text);
  return !!report && /^\s*\|\s*Design Review\s*\|/m.test(text.slice(report.index));
}

export interface PdrReading {
  exposed: boolean;
  passNames: number;
  stateTable: boolean;
  summary: boolean;
  planChanged: boolean;
  /** The load check (a secondary): review-sections.md was read. */
  loaded: boolean;
  /** The session exited on the skill's "no UI scope" line. */
  noUiExit: boolean;
  /** The outputs a D1 hook names: the required markers that did not show. */
  missing: string[];
}

export const PDR_OUTPUTS = {
  passNames: "at least " + DETECTOR.minPassNames + " of the seven review pass names, in order",
  stateTable: "the interaction state table (LOADING, EMPTY, ERROR, SUCCESS, PARTIAL)",
  summary: "the Design Review Completion Summary with pass scores, or the GSTACK REVIEW REPORT with a Design Review row",
  planChanged: "plan.md edited with the review's changes",
} as const;

/** The plan-design-review detector on the final transcript and plan.md before and after the session. */
export function pdrExposure(o: { transcript: string; planBefore: string; planAfter: string | null }): PdrReading {
  const words = ownWords(o.transcript);
  const texts = [...words, ...(o.planAfter === null ? [] : [o.planAfter])];
  const passNames = passNamesInOrder(texts.join("\n\n"));
  const marks = {
    passNames: passNames >= DETECTOR.minPassNames,
    stateTable: texts.some(stateTable),
    summary: texts.some(completionSummary),
    planChanged: o.planAfter !== null && o.planAfter !== o.planBefore,
  };
  const missing = (Object.keys(PDR_OUTPUTS) as Array<keyof typeof PDR_OUTPUTS>).filter((k) => !marks[k]).map((k) => PDR_OUTPUTS[k]);
  return { exposed: !missing.length, passNames, stateTable: marks.stateTable, summary: marks.summary, planChanged: marks.planChanged, loaded: skillFileRead(o.transcript, PDR_REVIEW_SECTIONS), noUiExit: words.some((w) => w.includes(PDR_NO_UI)), missing };
}

type Rec = Record<string, any>;

/** What the autoplan detector reads from a run directory copy (the sink's, or the container's during the session). */
export interface RunFiles {
  /** Every run directory under the root with its parsed run.json, newest updated_at first. */
  runs(): Array<{ dir: string; state: Rec }>;
  read(path: string): string | null;
  /** gstack-artifact validate on run.json at the pin: true only on exit 0 with an ARTIFACT_VALID line. */
  validate(runJson: string): boolean;
}

export interface AutoplanReading {
  exposed: boolean;
  leanDesign: boolean;
  bound: boolean;
  gateRec: boolean;
  approved: boolean;
  /** Whether the reviewer's brief carried the design lens; null with no run directory. */
  designLens: boolean | null;
  runDir: string | null;
  missing: string[];
}

export const AUTOPLAN_OUTPUTS = {
  leanDesign: "a lean run whose LEAN line names the design lens",
  bound: "one bound native reviewer result (INPUT receipt and gstack-findings fence)",
  gateRec: "the gate answered rec by the harness",
  approved: "a run that reached APPROVED and exported, passing gstack-artifact validate",
} as const;

export function autoplanExposure(files: RunFiles): AutoplanReading {
  const run = files.runs().find((r) => r.state && typeof r.state.phases === "object" && typeof r.state.plan_source === "string") ?? null;
  const none = { leanDesign: false, bound: false, gateRec: false, approved: false };
  if (!run) return { exposed: false, ...none, designLens: null, runDir: null, missing: Object.values(AUTOPLAN_OUTPUTS) };
  const { dir, state } = run;
  const design = state.scope?.ui === true && state.scope?.docs_only !== true;
  const phases = Object.values(state.phases as Record<string, Rec>);
  const native = phases.flatMap((p) => (Array.isArray(p?.native?.attempts) ? p.native.attempts.map((a: Rec) => ({ a, p })) : []));
  const outside = phases.flatMap((p) => (Array.isArray(p?.outside?.attempts) ? p.outside.attempts : []));
  const one = native.length === 1 ? native[0]! : null;
  const boundText = one && typeof one.p.native?.output === "string" ? files.read(dir + "/" + one.p.native.output) : null;
  const marks = {
    leanDesign: !!state.lean && design,
    bound: !!one && outside.length === 0 && one.a.state === "submitted" && boundText !== null && /^INPUT: \S+ [0-9a-f]{64}\s*$/m.test(boundText.split("\n")[0] ?? "") && /^```gstack-findings\b/m.test(boundText),
    gateRec: state.gate?.reply === "rec" && state.gate?.answered_by === "agent:harness",
    approved: state.status === "complete" && files.read(dir + "/plan.md") !== null && files.read(dir + "/review-record.md") !== null && files.validate(dir + "/run.json"),
  };
  const missing = (Object.keys(AUTOPLAN_OUTPUTS) as Array<keyof typeof AUTOPLAN_OUTPUTS>).filter((k) => !marks[k]).map((k) => AUTOPLAN_OUTPUTS[k]);
  return { exposed: !missing.length, ...marks, designLens: design, runDir: dir, missing };
}
