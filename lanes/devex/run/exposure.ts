// Copyright (c) 2026 Garry Tan. MIT License.
// The devex eval's two procedure detectors (prereg 2026-11-09-geva-417, section 5, "Exposure"), frozen before any smoke
// output exists and built from the strings the pinned gstack (garrytan/gstack b6155921, VERSION 1.98.0.0) prints and
// writes. Exposure is read from these detectors on the final transcript and run directory, never from gstack's report.
// Every marker's reading is kept, so the results can show which intention's procedure ran.
//
// plan-devex-review reads the main agent's own words: its text blocks and the text of its own successful Write, Edit
// and MultiEdit calls (lanes/aftermath/exposure.ts). A block counts only inside one text.
// - review_sections (a): a successful Read, or a simple cat, head, sed -n or nl Bash read with a non-empty result, of
//   plan-devex-review/sections/review-sections.md.
// - persona (b, DX-1): "TARGET DEVELOPER PERSONA" with, in the 15 lines after it, Who, Context, Tolerance and Expects
//   lines, each with a value that is not a bracketed placeholder.
// - error_matrix (c, DX-5): "ERROR PATH MATRIX (agent-ready-v1)" followed by at least 3 path rows: table lines after it,
//   up to a blank line or a fence, less its header, separators and bracketed placeholder rows.
// - scorecard (d, DX-6): "DX Review Scorecard", then a table row with a digit in its score cell for each of the 8
//   dimensions (Getting Started, API/CLI/SDK, Error Messages, Documentation, Upgrade Path, Dev Environment, Community,
//   DX Measurement).
// - two_of (e): at least two of benchmark (DX-2: a table whose header names a time and an evidence column, with a data
//   row, and a recorded target tier: Champion, Competitive or Current trajectory named beside "target" or "tier"),
//   magical_moment (DX-3: a "Magical Moment Specification" heading with at least 20 characters of body before the next
//   heading) and journey (DX-4: a STAGE table with at least 2 numbered stage rows, or a FIRST-TIME DEVELOPER REPORT
//   with a T+m:ss log line).
// exposed is (a) and (b) and (c) and (d) and (e).
//
// autoplan reads the run directory under the session's copy of its gstack state root (host/gstack-state/): the newest
// run.json (by updated_at) that holds phases and plan_source, and the files beside it.
// - lean_dx: run.json records the lean run and a scope with dx and not docs_only, so its LEAN line names the dx lens.
//   dx_lens records the same scope reading whether or not the run was lean.
// - reviewer: exactly one native reviewer attempt dispatched across the phases, no outside attempt, the native voice
//   completed, run.json's native_model is the cell's model, and the attempt's result file (found beside run.json by
//   its name) holds a gstack-findings fence and a DRAFT: line in its first five non-empty lines.
// - gate: gate.json sits in the run directory, and the persona answered with every answer reaching the session as the
//   persona gave it (persona.ts answeredRec).
// - revision: plan-active.md differs from plan-source.md, or the run records no accepted change (no amendment that is
//   pending, incorporated or settled).
// exposed is all four. A session whose scope left out the dx lens is unexposed for this eval's question (AP-DX-1).
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { ownWords, skillFileRead } from "../../aftermath/exposure.ts";
import { answerCounts, answeredRec } from "./persona.ts";

export const PDR_REVIEW_SECTIONS = "plan-devex-review/sections/review-sections.md";
export const PDR_DIMENSIONS: ReadonlyArray<[string, RegExp]> = [
  ["Getting Started", /getting\s+started/i],
  ["API/CLI/SDK", /api\s*\/\s*cli\s*\/\s*sdk/i],
  ["Error Messages", /error\s+messages/i],
  ["Documentation", /documentation/i],
  ["Upgrade Path", /upgrade\s+path/i],
  ["Dev Environment", /dev(?:eloper)?\s+environment/i],
  ["Community", /community/i],
  ["DX Measurement", /dx\s+measurement/i],
];

const placeholder = (v: string) => /^\[[^\]]*\]$/.test(v.trim()) || v.trim() === "";
const cells = (line: string) => line.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());
const separator = (line: string) => /^[\s|:+=-]+$/.test(line);

export function personaBlock(text: string): boolean {
  const lines = text.split("\n");
  return lines.some((l, i) => {
    if (!/TARGET DEVELOPER PERSONA/.test(l)) return false;
    const after = lines.slice(i + 1, i + 16);
    return ["Who", "Context", "Tolerance", "Expects"].every((k) => after.some((x) => {
      const m = new RegExp("^[\\s>*_-]*\\**" + k + "\\**\\s*:\\**\\s*(.*)$", "i").exec(x);
      return !!m && !placeholder(m[1]!.replace(/\*+/g, ""));
    }));
  });
}

export function errorMatrixRows(text: string): number {
  const lines = text.split("\n");
  let best = 0;
  lines.forEach((l, i) => {
    if (!/ERROR PATH MATRIX\s*\(agent-ready-v1\)/i.test(l)) return;
    let rows = 0;
    let header = false;
    for (const x of lines.slice(i + 1)) {
      if (!x.trim() || x.trim().startsWith("```")) break;
      if (!x.includes("|") || separator(x)) continue;
      if (!header && /\bpath\b/i.test(x)) {
        header = true;
        continue;
      }
      if (placeholder(cells(x)[0] ?? "")) continue;
      rows++;
    }
    best = Math.max(best, rows);
  });
  return best;
}

export function scorecard(text: string): boolean {
  const at = text.search(/DX Review Scorecard/i);
  if (at < 0) return false;
  const rows = text.slice(at).split("\n").filter((l) => l.includes("|"));
  return PDR_DIMENSIONS.every(([, re]) => rows.some((l) => {
    const c = cells(l);
    const i = c.findIndex((x) => re.test(x));
    return i >= 0 && i + 1 < c.length && /\d/.test(c[i + 1]!);
  }));
}

export function benchmarkTable(text: string): boolean {
  const lines = text.split("\n");
  return lines.some((l, i) => l.includes("|") && /time/i.test(l) && /evidence/i.test(l) && lines.slice(i + 1).some((x, j) => j < 30 && x.includes("|") && !separator(x) && !placeholder(cells(x)[0] ?? "")));
}
const TIER = /\b(?:target|tier)\b[^\n]{0,80}\b(?:champion|competitive|current trajectory)\b|\b(?:champion|competitive|current trajectory)\b[^\n]{0,40}\b(?:target|tier)\b/i;
export const targetTier = (text: string): boolean => TIER.test(text);

export function magicalMoment(text: string): boolean {
  const m = /^[ \t]*(?:#{1,6}[ \t]*|\*\*)?Magical Moment Specification\**[^\n]*\n([\s\S]*?)(?=^[ \t]*#{1,6}[ \t]|(?![\s\S]))/im.exec(text);
  return !!m && m[1]!.replace(/\s+/g, "").length >= 20;
}

export function journey(text: string): boolean {
  const lines = text.split("\n");
  const table = lines.some((l, i) => /\bSTAGE\b/i.test(l) && /developer does|friction/i.test(l) && lines.slice(i + 1, i + 12).filter((x) => /^\s*\|?\s*\d+\.\s*(discover|install|hello world|real usage|debug|upgrade)\b[^\n]*\|/i.test(x)).length >= 2);
  const report = /FIRST-TIME DEVELOPER REPORT/.test(text) && /T\+\d+:\d\d/.test(text.slice(text.indexOf("FIRST-TIME DEVELOPER REPORT")));
  return table || report;
}

export interface PdrMarkers {
  review_sections: boolean;
  persona: boolean;
  error_matrix: boolean;
  scorecard: boolean;
  benchmark: boolean;
  magical_moment: boolean;
  journey: boolean;
  two_of: boolean;
}
export interface PdrExposure {
  exposed: boolean;
  markers: PdrMarkers;
  /** The outputs a stop hook would name: the required markers that did not show. */
  missing: string[];
}

export const PDR_OUTPUTS: Readonly<Record<"review_sections" | "persona" | "error_matrix" | "scorecard" | "two_of", string>> = {
  review_sections: "a Read of " + PDR_REVIEW_SECTIONS,
  persona: "the TARGET DEVELOPER PERSONA block (Who, Context, Tolerance, Expects)",
  error_matrix: "the ERROR PATH MATRIX (agent-ready-v1) with at least 3 path rows",
  scorecard: "the DX Review Scorecard with all 8 dimension rows",
  two_of: "two of: the Competitive DX Benchmark table with its target tier, the Magical Moment Specification, the Developer Journey Map or FIRST-TIME DEVELOPER REPORT",
};

export function pdrExposure(transcript: string): PdrExposure {
  const words = ownWords(transcript);
  const any = (f: (t: string) => boolean) => words.some(f);
  const benchmark = any(benchmarkTable) && targetTier(words.join("\n"));
  const magical = any(magicalMoment);
  const journeyed = any(journey);
  const markers: PdrMarkers = {
    review_sections: skillFileRead(transcript, PDR_REVIEW_SECTIONS),
    persona: any(personaBlock),
    error_matrix: words.some((t) => errorMatrixRows(t) >= 3),
    scorecard: any(scorecard),
    benchmark,
    magical_moment: magical,
    journey: journeyed,
    two_of: [benchmark, magical, journeyed].filter(Boolean).length >= 2,
  };
  const missing = (Object.keys(PDR_OUTPUTS) as Array<keyof typeof PDR_OUTPUTS>).filter((k) => !markers[k]).map((k) => PDR_OUTPUTS[k]);
  return { exposed: missing.length === 0, markers, missing };
}

type Rec = Record<string, any>;
const readJson = (path: string): Rec | null => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
};
const readText = (path: string): string | null => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
};

/** Every run.json under root (a gstack state root copy) that holds an autoplan run, newest first by updated_at. */
export function autoplanRuns(root: string | null, depth = 8): Array<{ dir: string; state: Rec }> {
  const out: Array<{ dir: string; state: Rec }> = [];
  const walk = (dir: string, d: number) => {
    let names: string[];
    try {
      names = readdirSync(dir).sort();
    } catch {
      return;
    }
    for (const n of names) {
      const p = join(dir, n);
      const st = lstatSync(p);
      if (st.isDirectory() && d > 0) walk(p, d - 1);
      else if (st.isFile() && n === "run.json") {
        const state = readJson(p);
        if (state && typeof state.phases === "object" && state.phases && typeof state.plan_source === "string") out.push({ dir, state });
      }
    }
  };
  if (root && existsSync(root)) walk(root, depth);
  return out.sort((a, b) => String(b.state.updated_at ?? "").localeCompare(String(a.state.updated_at ?? "")));
}

/** A file named by a run record (absolute in the container, or relative), found beside run.json by its path's tail. */
function beside(dir: string, ref: unknown): string | null {
  if (typeof ref !== "string" || !ref) return null;
  const parts = ref.split("/").filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    const p = join(dir, ...parts.slice(i));
    if (existsSync(p) && lstatSync(p).isFile()) return p;
  }
  return null;
}

export interface AutoplanMarkers {
  lean_dx: boolean;
  reviewer: boolean;
  gate: boolean;
  revision: boolean;
}
export interface AutoplanExposure {
  exposed: boolean;
  markers: AutoplanMarkers;
  /** Whether the DX lens was in the reviewer's brief (the run's scope put dx in); null without a run directory. */
  dx_lens: boolean | null;
  run_dir: string | null;
}

/** autoplan's detector over a session's gstack state root copy and its persona records, for the cell's model string. */
export function autoplanExposure(stateRoot: string | null, o: { model: string; usersim: string | null; persona: string | null; session: string | null }): AutoplanExposure {
  const run = autoplanRuns(stateRoot)[0] ?? null;
  const none: AutoplanMarkers = { lean_dx: false, reviewer: false, gate: false, revision: false };
  if (!run) return { exposed: false, markers: none, dx_lens: null, run_dir: null };
  const { dir, state } = run;
  const dx = state.scope?.dx === true && state.scope?.docs_only !== true;
  const phases = Object.values(state.phases as Record<string, Rec>);
  const native = phases.flatMap((p) => (Array.isArray(p?.native?.attempts) ? p.native.attempts : []));
  const outside = phases.flatMap((p) => (Array.isArray(p?.outside?.attempts) ? p.outside.attempts : []));
  const voice = phases.find((p) => Array.isArray(p?.native?.attempts) && p.native.attempts.length)?.native;
  const result = native.length === 1 ? readText(beside(dir, native[0].result) ?? "") : null;
  const draft = result !== null && result.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 5).some((l) => /^DRAFT:/i.test(l));
  const reviewer = native.length === 1 && outside.length === 0 && native[0].state === "submitted" && voice?.status === "completed" && state.native_model === o.model && result !== null && /```gstack-findings\b/.test(result) && draft;
  const gate = existsSync(join(dir, "gate.json")) && answeredRec(answerCounts(o.usersim, o.persona, o.session));
  const active = readText(join(dir, "plan-active.md"));
  const source = readText(join(dir, "plan-source.md"));
  const accepted = (Array.isArray(state.amendments) ? state.amendments : []).some((a: Rec) => ["pending", "incorporated", "settled"].includes(a?.status));
  const revision = (active !== null && source !== null && active !== source) || !accepted;
  const markers: AutoplanMarkers = { lean_dx: !!state.lean && dx, reviewer, gate, revision };
  return { exposed: Object.values(markers).every(Boolean), markers, dx_lens: dx, run_dir: dir };
}

/** One session's exposure from its session directory (host/transcript.ndjson, host/gstack-state, host/usersim.ndjson). */
export function sessionExposure(sessionDir: string, arm: "plan-devex-review" | "autoplan", model: string): PdrExposure | AutoplanExposure | null {
  const host = join(sessionDir, "host");
  if (arm === "plan-devex-review") {
    const t = readText(join(host, "transcript.ndjson"));
    return t === null ? null : pdrExposure(t);
  }
  return autoplanExposure(join(host, "gstack-state"), { model, usersim: readText(join(host, "usersim.ndjson")), persona: readText(join(host, "persona.ndjson")), session: readText(join(host, "session.json")) });
}

/** dx exposure --arm plan-devex-review|autoplan --session <dir> [--model <model string>]: prints the reading as JSON. */
export function run(argv: string[], io: { out: (t: string) => void; err: (t: string) => void }): number {
  const flag = (n: string) => (argv.indexOf(n) >= 0 ? argv[argv.indexOf(n) + 1] : undefined);
  const arm = flag("--arm");
  const dir = flag("--session");
  if ((arm !== "plan-devex-review" && arm !== "autoplan") || !dir) {
    io.err("E_USAGE dx exposure: usage: dx exposure --arm plan-devex-review|autoplan --session <dir> [--model <model>]");
    return 2;
  }
  const reading = sessionExposure(dir, arm, flag("--model") ?? "claude-opus-5-5");
  if (!reading) {
    io.err("E_USAGE dx exposure: " + join(dir, "host", "transcript.ndjson") + " does not read");
    return 2;
  }
  io.out(JSON.stringify({ arm, session: basename(dirname(join(dir, "x"))), ...reading }, null, 2));
  return 0;
}
