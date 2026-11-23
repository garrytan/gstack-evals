// Copyright (c) 2026 Garry Tan. MIT License.
// The reading area's dry-run seams for the office-hours rewrite eval (prereg
// wiki/plans/2026-11-17-geva-552-office-hours-rewrite-prereg, section 12 stage 1's dry run: every row of section 10 on
// planted data, and every gate on planted known-good and known-bad cases). Each seam drives one frozen rule on one side
// of its edge through this area's code, on invented rows that are never eval briefs. The fixture builders are exported
// for tests/ohr/read. The second attempt adds the stops.json read (its section 3, items 9 and 10): planted launch stops
// and ledger records, read with no flag. Its pre-run change 3 adds A8, the full-load check: planted host files read through
// read/load.ts, a whole body and a cut one on each host, and a particle-1 arm left out.
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openLease, recordApproval, recordStop } from "../../../src/runner/ledger/ledger.ts";
import { ARMS, CONTAINER_HOME, MODELS, PRIMARY_MODELS } from "../frozen.ts";
import { SPLIT } from "../ledger.ts";
import type { ArmId, EndState, KeptWhole, ModelId, ScoredSession, Seam, SessionRow, SkillArm } from "../types.ts";
import { admission, admissionState, type AdmissionId } from "./admission.ts";
import { builderRightCall, keptWhole, type State } from "./builder.ts";
import { decide, type Decision, type DecisionInput } from "./decision.ts";
import { g1, g2, g3, missingLimits, type HandRead } from "./guards.ts";
import { CLAUDE_SESSION, skillLoad, type Bodies, type LoadRead } from "./load.ts";
import { correctedNewcombe, newcombe, tInterval, type KeptPair } from "./stats.ts";
import { readStops, type AuthoringEnd } from "./stops.ts";

// ---- Fixtures ----

/** One scored session: a stage 2 founder block on brief f01 that made the right call. */
export const row = (o: Partial<ScoredSession>): ScoredSession => ({
  stage: 2, brief: "f01", model: "opus", arm: "none", kind: "founder", cluster: "f01", set: "comparison", traction: false, end: "block",
  R1: 1, R2: 1, R3: 1, R: 1, exposure: null, kept_whole: null, compliance: null, founder_replies: 5, questions: 5, usd: 1, sim_usd: 0.1, ...o,
});

const pad = (k: number) => String(k).padStart(2, "0");
const kept = (k: boolean, startup_only: string[] = []): KeptWhole => ({ builder_mode: true, startup_only, builder_doc_approved: k, before_cap: true, kept: k });

/**
 * 24 builder briefs b01 to b24, each its own cluster, on every arm and model of stage 2. Every skill session is kept
 * whole and every session makes the right call, except: new loses kept-whole on the lost briefs, new loses the right
 * call on the wrong briefs, and the leak briefs' new sessions carry a detector hit for a startup-only question.
 */
export function builderRows(o: { lost?: string[]; wrong?: string[]; leak?: string[]; models?: readonly ModelId[] }): ScoredSession[] {
  const out: ScoredSession[] = [];
  for (let k = 1; k <= 24; k++) {
    const brief = "b" + pad(k);
    for (const model of o.models ?? MODELS) for (const arm of ARMS) {
      const isNew = arm === "new";
      const R = isNew && o.wrong?.includes(brief) ? 0 : 1;
      out.push(row({ brief, cluster: brief, kind: "builder", model, arm, R, R2: R, kept_whole: arm === "none" ? null : kept(!(isNew && o.lost?.includes(brief)), isNew && o.leak?.includes(brief) ? ["the payment test"] : []) }));
    }
  }
  return out;
}

type Bit = 0 | 1;
export interface FounderPlan {
  /** R per arm, brief index j (0 to 39; twins j and j+1 for even j share cluster c = floor(j / 2)) and model. Defaults to 1. */
  R?: (arm: ArmId, j: number, model: ModelId) => Bit;
  questions?: (arm: ArmId, j: number) => number;
  replies?: (arm: ArmId, j: number) => number;
  traction?: (j: number) => boolean;
  /** An end other than block; missing and contaminated rows carry no bits. */
  end?: (arm: ArmId, j: number, model: ModelId) => EndState | undefined;
  stage?: 1 | 2;
}

/** 40 founder briefs f01 to f40 in 20 twin clusters c01 to c20, on every arm and model, 5 questions and 5 founder replies each. */
export function founderRows(p: FounderPlan): ScoredSession[] {
  const out: ScoredSession[] = [];
  for (let j = 0; j < 40; j++) for (const model of MODELS) for (const arm of ARMS) {
    const end = p.end?.(arm, j, model) ?? "block";
    const gone = end === "missing" || end === "contaminated";
    const R = gone ? null : (p.R?.(arm, j, model) ?? 1);
    out.push(row({
      stage: p.stage ?? 2, brief: "f" + pad(j + 1), cluster: "c" + pad(Math.floor(j / 2) + 1), model, arm, end, traction: p.traction?.(j) ?? false,
      R, R1: gone ? null : 1, R2: R, R3: gone ? null : 1, questions: 5 + (p.questions?.(arm, j) ?? 0), founder_replies: 5 + (p.replies?.(arm, j) ?? 0),
    }));
  }
  return out;
}

/** One run row as the run side hands it in, a block in an interactive skill session (or a clean none session). */
export const sessionRow = (o: Partial<SessionRow>): SessionRow => ({
  stage: 1, brief: "k01", model: "opus", arm: "none", end: "block", code: null, block: null, founder_turns: [], closings: 1, founder_done: true, replies: 6,
  session_kind: (o.arm ?? "none") === "none" ? null : "interactive", served_model: null, cli_version: null, guard_failures: 0, gstack_reads: [], usd: 1, sim_usd: 0.1, attempts: 1, transcript: null, state_root: null, ...o,
});

/** Stage 1's calibration briefs: twins k01 and k02, twins k03 and k04, unpaired founders k05 and k06, builders k07 and k08. */
export const CALIBRATION = ["k01", "k02", "k03", "k04", "k05", "k06", "k07", "k08"] as const;
const CAL_CLUSTER: Record<string, string> = { k01: "kp1", k02: "kp1", k03: "kp2", k04: "kp2" };
const PLANNED_USD: Record<"none" | "skill", Record<ModelId, number>> = { none: { opus: 1, sol: 1, particle: 0.05 }, skill: { opus: 1, sol: 1, particle: 0.3 } };

export interface Stage1Plan {
  /** Exposed sessions of 8 in one skill cell; every other skill session is exposed. */
  exposed?: { arm: ArmId; model: ModelId; count: number };
  /** Every founder session of one cell gets this many founder replies; the rest get 5. */
  replies?: { arm: ArmId; model: ModelId; value: number };
  /** Current-arm right calls among the 12 Opus and Sol calibration founder sessions; defaults to 8. */
  currentRight?: number;
  /** Measured dollars per session in one cell. */
  usd?: { arm: ArmId; model: ModelId; value: number };
  /** One skill session's printed session kind; missing makes the session end missing. */
  kind?: { brief: string; arm: ArmId; model: ModelId; value: string | null; missing?: boolean };
  /** One none-arm session that read a gstack file. */
  read?: { brief: string; model: ModelId };
  /** One skill session whose body did not arrive whole (A8). */
  short?: { brief: string; arm: SkillArm; model: ModelId };
  /** One skill session's A8 read in place of the planted whole one, matched by brief, model and arm. */
  load?: LoadRead;
}

/** A stage 1 that admits: every condition passes, 0.3 to 1 dollars a session, 6 cents of labels a session. */
export function stage1Input(p: Stage1Plan): { rows: ScoredSession[]; sessions: SessionRow[]; loads: LoadRead[]; audit: { pass: boolean }; judges: { astra: boolean; opus: boolean }; label_usd: number } {
  const rows: ScoredSession[] = [], sessions: SessionRow[] = [], loads: LoadRead[] = [];
  const right = p.currentRight ?? 8;
  let k = 0;
  for (const model of MODELS) for (const arm of ARMS) CALIBRATION.forEach((brief, j) => {
    const founder = j < 6;
    const is = <T extends { arm: ArmId; model: ModelId }>(c: T | undefined) => c !== undefined && c.arm === arm && c.model === model;
    const usd = is(p.usd) ? p.usd!.value : PLANNED_USD[arm === "none" ? "none" : "skill"][model];
    const exposed = arm !== "none" && (!is(p.exposed) || j < p.exposed!.count);
    let R: 0 | 1 = 1;
    if (arm === "current" && founder && PRIMARY_MODELS.includes(model)) R = k++ < right ? 1 : 0;
    const kindHere = p.kind && p.kind.brief === brief && is(p.kind);
    const readHere = arm === "none" && p.read?.brief === brief && p.read.model === model;
    rows.push(row({
      stage: 1, set: "calibration", brief, cluster: CAL_CLUSTER[brief] ?? brief, kind: founder ? "founder" : "builder", model, arm, R, R2: R, usd,
      founder_replies: founder && is(p.replies) ? p.replies!.value : 5,
      exposure: arm === "none" ? null : { read_skill: true, interactive: true, questions_one_at_a_time: exposed ? 3 : 0, wrote_deliverable: exposed, exposed },
      end: readHere ? "contaminated" : kindHere && p.kind!.missing ? "missing" : "block",
    }));
    sessions.push(sessionRow({ brief, model, arm, usd, gstack_reads: readHere ? ["/root/.claude/skills/gstack/office-hours/SKILL.md"] : [], ...(kindHere ? { session_kind: p.kind!.value, end: p.kind!.missing ? "missing" : "block" } : {}) }));
    if (arm === "none") return;
    const short = p.short?.brief === brief && is(p.short);
    const planted: LoadRead = { brief, model, arm, file: "planted", pass: !short, sha256: short ? null : "planted", why: short ? "a planted cut body" : "a planted whole body" };
    loads.push(p.load && p.load.brief === brief && p.load.model === model && p.load.arm === arm ? p.load : planted);
  });
  return { rows, sessions, loads, audit: { pass: true }, judges: { astra: true, opus: true }, label_usd: 0.06 };
}

/** One planted host dir for A8's reader: the transcript and, on Claude Code, its session file, around a planted body. */
export interface LoadPlant {
  host: "claude" | "codex";
  arm: SkillArm;
  /** Whose body arrives; the arm's own by default. */
  body?: SkillArm;
  /** Characters cut off the body's end. */
  cut?: number;
  /** Claude Code's start-step output between the head and the tail; PLANTED_START by default. */
  start?: string;
  /** Claude Code's head in place of the planted one. */
  head?: string;
  /** What follows the body: Claude Code's ARGUMENTS line, or Codex's closing tag, by default. */
  tail?: string;
  /** The record the body rides in; a user record by default. */
  role?: "user" | "assistant";
  /** The file A8 reads: written (the default), missing, a directory, or text with no skill block. */
  copy?: "written" | "missing" | "dir" | "junk";
}
/** A planted body per pin; each shows an ARGUMENTS line inside itself, so the boundary is read by length, not by the first such line. Codex's <skill> item carries it whole; on Claude Code it is the tail. */
const plantedBody = (arm: SkillArm) => "# The planted office-hours body, " + arm + " pin\n\n" + Array.from({ length: 40 }, (_, k) => "Line " + (k + 1) + " of the planted " + arm + " body, caf\u00e9 included.").join("\n") + "\n\nARGUMENTS: an example inside the body\n\nThe end of the planted " + arm + " body.\n";
/** Claude Code's planted head, the same at both pins; like the real one it names other session kinds. */
const PLANTED_HEAD = "# The planted office-hours head\n\nThe preamble's own text names SESSION_KIND: spawned and SESSION_KIND: headless.\n" + Array.from({ length: 20 }, (_, k) => "Head line " + (k + 1) + ", caf\u00e9 included.").join("\n") + "\n";
/** Claude Code's planted start-step output, what the skill's load-time start line printed. */
export const PLANTED_START = "SESSION_KIND: interactive\nREPO_MODE: solo";
const plantedTail = (arm: SkillArm) => "\n" + plantedBody(arm);
export function plantLoad(o: LoadPlant): { row: SessionRow; bodies: Bodies; want: string; done: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "ohr-a8-"));
  const host = join(dir, "host");
  mkdirSync(host);
  const claudeWhole = (arm: SkillArm) => (o.head ?? PLANTED_HEAD) + (o.start ?? PLANTED_START) + plantedTail(arm);
  const whole = o.host === "claude" ? claudeWhole(o.body ?? o.arm) : plantedBody(o.body ?? o.arm);
  const body = whole.slice(0, whole.length - (o.cut ?? 0));
  const text = o.host === "claude"
    ? "Base directory for this skill: " + CONTAINER_HOME + "/.claude/skills/office-hours\n\n" + body + (o.tail ?? "\n\nARGUMENTS: the founder's first message")
    : "<skill>\n<name>office-hours</name>\n<path>" + CONTAINER_HOME + "/.local/share/gstack/.agents/skills/gstack-office-hours/SKILL.md</path>\n" + body + (o.tail ?? "\n</skill>");
  const opening = JSON.stringify({ type: "user", message: { role: "user", content: "/office-hours the founder's first message" } });
  const record = JSON.stringify({ type: o.role ?? "user", message: { role: o.role ?? "user", content: [{ type: "text", text }] } });
  const file = join(host, o.host === "claude" ? CLAUDE_SESSION : "transcript.ndjson");
  if (o.host === "claude") writeFileSync(join(host, "transcript.ndjson"), opening + "\n");
  const copy = o.copy ?? "written";
  if (copy === "written") writeFileSync(file, opening + "\n" + record + "\n");
  else if (copy === "dir") mkdirSync(file);
  else if (copy === "junk") writeFileSync(file, opening + "\nnot a json line\n");
  const sum = (x: string) => createHash("sha256").update(x).digest("hex");
  const part = (x: string) => ({ sha256: sum(x), chars: x.length });
  const [current, next] = [plantedBody("current"), plantedBody("new")];
  const bodies: Bodies = {
    claude: { current: { head: part(PLANTED_HEAD), tail: part(plantedTail("current")) }, new: { head: part(PLANTED_HEAD), tail: part(plantedTail("new")) } },
    codex: { current: { sha256: sum(current), bytes: Buffer.byteLength(current) }, new: { sha256: sum(next), bytes: Buffer.byteLength(next) } },
  };
  const want = sum(o.host === "claude" ? claudeWhole(o.arm) : plantedBody(o.arm));
  return { row: sessionRow({ brief: "k01", model: o.host === "codex" ? "sol" : "opus", arm: o.arm, transcript: join(host, "transcript.ndjson") }), bodies, want, done: () => rmSync(dir, { recursive: true, force: true }) };
}

// ---- Section 10 on planted data ----

type ByArm = Partial<Record<ArmId, (c: number, j: number, model: ModelId) => boolean>>;
/** R from one predicate per arm over cluster c (0 to 19), brief index j and model; an arm with no predicate scores 0. */
const by = (f: ByArm) => (arm: ArmId, j: number, model: ModelId): Bit => (f[arm]?.(Math.floor(j / 2), j, model) ? 1 : 0);
/** New-arm extras of 2 or 3 on alternate clusters (breaks G2 and G3), or 0 or 1 (holds). */
export const extra = (step: number) => (arm: ArmId, j: number) => (arm === "new" ? step + (Math.floor(j / 2) % 2) : 0);

const MERGE: ByArm = { current: (c) => c < 8, new: (c) => c < 14 };

export interface Planted {
  row: 1 | 2 | 3 | 4 | 5 | 6;
  /** Lower rows whose conditions also hold, so the order decides. */
  also?: Array<1 | 2 | 3 | 4 | 5 | 6>;
  founder: FounderPlan;
  builder?: Parameters<typeof builderRows>[0];
  reads?: HandRead[];
  admission?: DecisionInput["admission"];
  stops?: string[];
  judge_checks?: DecisionInput["judge_checks"];
}

/**
 * Founder rows are 20 twin clusters; builders are 24 briefs kept whole and right unless named. MERGE plants current right
 * on 8 clusters and new on 14 (+0.30, lower bound above 0), with none never right.
 */
export const PLANTED: Record<string, Planted> = {
  "merge": { row: 4, founder: { R: by(MERGE) } },
  "merge-at-bar": { row: 4, founder: { R: by({ current: (c) => c < 8, new: (c, j) => c < 8 || (c < 14 && j % 2 === 0) }) } },
  "below-bar-lo": { row: 5, founder: { R: by({ current: (c) => c < 8, new: (c, j) => c < 8 || (c < 13 && j % 2 === 0) }) } },
  "below-bar-hi": { row: 5, founder: { R: by({ current: (c) => c < 8, new: (c) => c < 8, none: (c) => c < 8 }) } },
  "inconclusive": { row: 6, founder: { R: by({ current: (c) => c < 8, new: (c) => c < 10 }) } },
  "cut": { row: 3, also: [5], founder: { R: by({ none: () => true }) } },
  "harm-pooled": { row: 2, founder: { R: by({ current: (c) => c < 8, new: (c) => c < 3 }) } },
  "harm-opus": { row: 2, founder: { R: by({ current: (c) => c < 8, new: (c, _j, m) => (m === "opus" ? c < 3 : c < 13) }) } },
  "harm-sol": { row: 2, founder: { R: by({ current: (c) => c < 8, new: (c, _j, m) => (m === "sol" ? c < 3 : c < 13) }) } },
  "harm-kept-whole": { row: 2, also: [4], founder: { R: by(MERGE) }, builder: { lost: ["b01"] } },
  "harm-builder-right-call": { row: 2, also: [4], founder: { R: by(MERGE) }, builder: { wrong: ["b01", "b02", "b03", "b04", "b05", "b06", "b07", "b08"] } },
  "harm-g1": { row: 2, also: [4], founder: { R: by(MERGE) }, builder: { leak: ["b03"] }, reads: [{ brief: "b03", model: "opus", confirmed: true }, { brief: "b03", model: "sol", confirmed: false }, { brief: "b03", model: "particle", confirmed: false }] },
  "harm-g2": { row: 2, also: [4], founder: { R: by(MERGE), traction: (j) => j % 2 === 0, questions: extra(2) } },
  "harm-g3": { row: 2, also: [4], founder: { R: by(MERGE), replies: extra(2) } },
  "harm-over-cut": { row: 2, also: [3, 5], founder: { R: by({ current: () => true, none: () => true }) } },
  "incomplete-unrepaired": { row: 1, also: [4], founder: { R: by(MERGE) }, admission: "repair" },
  "incomplete-fix-method": { row: 1, also: [4], founder: { R: by(MERGE) }, admission: "fix-method" },
  "incomplete-cap-stop": { row: 1, also: [4], founder: { R: by(MERGE) }, stops: ["ledger item ohr-s2-arms: CAP_STOP planted"] },
  "incomplete-missing-limit": { row: 1, also: [4], founder: { R: by(MERGE), end: (arm, j, m) => (arm === "none" && m === "opus" && j < 3 ? "contaminated" : undefined) } },
  "incomplete-judge-check": { row: 1, also: [4], founder: { R: by(MERGE) }, judge_checks: { astra: true, opus: false } },
  "incomplete-over-harm": { row: 1, also: [2], founder: { R: by({ current: (c) => c < 8, new: (c) => c < 3 }) }, stops: ["ledger item ohr-s2-arms: CAP_STOP planted"] },
};

export function plant(name: string): DecisionInput {
  const p = PLANTED[name];
  if (!p) throw new Error("E_OHR_READ_INPUT no planted case named " + name);
  return {
    rows: [...founderRows(p.founder), ...builderRows(p.builder ?? {})],
    admission: p.admission ?? "admitted",
    stops: p.stops ?? [],
    judge_checks: p.judge_checks ?? { astra: true, opus: true },
    hand_reads: p.reads ?? [],
  };
}

// ---- Seams ----

const seam = (name: string, check: () => [boolean, string]): Seam => ({ name, run: () => { const [ok, detail] = check(); return { ok, detail }; } });
const f4 = (x: number | null) => (x === null ? "none" : x.toFixed(4));

const SLEEP = { g1: [0.7, -1.6, -0.2, -1.2, -0.1, 3.4, 3.7, 0.8, 0.0, 2.0], g2: [1.9, 0.8, 1.1, 0.1, -0.1, 4.4, 5.5, 1.6, 4.6, 3.4] };
const sameBriefLost = (): KeptPair[] => Array.from({ length: 48 }, (_, k) => ({ cluster: "b" + Math.floor(k / 2), model: k % 2 ? "sol" : "opus", y1: k >= 2, y0: true }));

const statSeams: Seam[] = [
  seam("stats: paired t over clusters reproduces Student's sleep data", () => {
    const t = tInterval(SLEEP.g2.map((v, k) => v - SLEEP.g1[k]!));
    return [Math.abs(t.mean! - 1.58) < 1e-12 && Math.abs(t.lo! - 0.7001142) < 1e-7 && Math.abs(t.hi! - 2.4598858) < 1e-7, "mean " + t.mean!.toFixed(7) + ", " + t.lo!.toFixed(7) + " to " + t.hi!.toFixed(7)];
  }),
  seam("stats: method 10 reproduces Altman's worked example", () => {
    const r = newcombe(14, 5, 0, 22);
    const s = [r.diff, r.lo, r.hi].map((x) => x.toFixed(4)).join(" ");
    return [s === "0.1220 0.0115 0.2265", s];
  }),
  seam("stats: section 7's example reads -0.140 uncorrected and -0.202 corrected", () => {
    const r = correctedNewcombe(sameBriefLost());
    return [r.naive.lo.toFixed(3) === "-0.140" && r.lo.toFixed(3) === "-0.202" && r.design_effect === 2, "naive " + f4(r.naive.lo) + ", corrected " + f4(r.lo) + ", design effect " + r.design_effect];
  }),
];

const rowSeams: Seam[] = Object.entries(PLANTED).map(([name, p]) => seam("section 10: " + name + " reads row " + p.row + (p.also?.length ? " over rows " + p.also.join(" and ") : ""), () => {
  const d = decide(plant(name));
  const others = (p.also ?? []).every((r) => d.conditions[("row" + r) as keyof Decision["conditions"]].holds);
  return [d.row === p.row && others, "row " + d.row + " " + d.outcome + "; new minus current " + f4(d.conditions.row4.estimate) + " (" + f4(d.conditions.row4.lo) + " to " + f4(d.conditions.row5.hi) + ")"];
}));

const both = (name: string, held: () => State, broken: () => State): Seam[] => [
  seam(name + ": known-good holds", () => { const s = held(); return [s === "held", s]; }),
  seam(name + ": known-bad breaks", () => { const s = broken(); return [s === "broken", s]; }),
];
const leakReads = (confirmed: boolean): HandRead[] => [{ brief: "b03", model: "opus", confirmed }, { brief: "b03", model: "sol", confirmed: false }];
const lim = (end: FounderPlan["end"]) => missingLimits(founderRows({ end }));
const dropRange = (arm: ArmId, model: ModelId, from: number, to: number, e: EndState = "missing") => (a: ArmId, j: number, m: ModelId): EndState | undefined => (a === arm && m === model && j >= from && j < to ? e : undefined);
const anyOf = (...fs: Array<ReturnType<typeof dropRange>>) => (a: ArmId, j: number, m: ModelId) => fs.map((f) => f(a, j, m)).find((x) => x !== undefined);
const EIGHT = [dropRange("new", "opus", 0, 3), dropRange("new", "sol", 0, 3), dropRange("current", "opus", 3, 5)];

const gateSeams: Seam[] = [
  ...both("G1 hand-confirmed startup-only question", () => g1(builderRows({ leak: ["b03"], models: PRIMARY_MODELS }), leakReads(false)).state, () => g1(builderRows({ leak: ["b03"], models: PRIMARY_MODELS }), leakReads(true)).state),
  ...both("G2 questions on traction briefs", () => g2(founderRows({ traction: (j) => j % 2 === 0, questions: extra(0) })).state, () => g2(founderRows({ traction: (j) => j % 2 === 0, questions: extra(2) })).state),
  ...both("G3 founder replies", () => g3(founderRows({ replies: extra(0) })).state, () => g3(founderRows({ replies: extra(2) })).state),
  ...both("builder kept-whole non-inferiority", () => keptWhole(builderRows({})).state, () => keptWhole(builderRows({ lost: ["b01"] })).state),
  ...both("builder right call", () => builderRightCall(builderRows({ wrong: ["b01"] })).state, () => builderRightCall(builderRows({ wrong: ["b01", "b02", "b03", "b04", "b05", "b06", "b07", "b08"] })).state),
  ...both("missing limit: founder differences (8 of 80, 9 of 80)", () => lim(anyOf(...EIGHT)).founder_differences.state, () => lim(anyOf(...EIGHT, dropRange("current", "sol", 39, 40))).founder_differences.state),
  ...both("missing limit: an arm-and-model cell (4 of 40, 5 of 40)", () => lim(dropRange("none", "opus", 0, 4)).cells_state, () => lim(dropRange("none", "opus", 0, 5)).cells_state),
  ...both("missing limit: none-arm contamination (1 of 80, 2 of 80)", () => lim(dropRange("none", "opus", 0, 1, "contaminated")).contamination.state, () => lim(dropRange("none", "opus", 0, 2, "contaminated")).contamination.state),
];

type Plan1 = Stage1Plan & { audit?: boolean; judges?: { astra: boolean; opus: boolean } };
const admit = (p: Plan1, id: AdmissionId) => {
  const x = stage1Input(p);
  return admission({ ...x, audit: { pass: p.audit ?? true }, judges: p.judges ?? x.judges }).conditions.find((c) => c.id === id)!.pass;
};
const ADMIT: Array<[AdmissionId, string, Plan1, Plan1]> = [
  ["A1", "6 of 8 exposed, 5 of 8", { exposed: { arm: "new", model: "opus", count: 6 } }, { exposed: { arm: "new", model: "opus", count: 5 } }],
  ["A2", "founder median of 3 replies, 2", { replies: { arm: "new", model: "sol", value: 3 } }, { replies: { arm: "new", model: "sol", value: 2 } }],
  ["A3", "simulator audit passed, failed", { audit: true }, { audit: false }],
  ["A4", "both judge checks passed, Astra failed", {}, { judges: { astra: false, opus: true } }],
  ["A5", "current right on 9 of 12, 10 of 12", { currentRight: 9 }, { currentRight: 10 }],
  ["A6", "Opus new at $1 a session, $12", { usd: { arm: "new", model: "opus", value: 1 } }, { usd: { arm: "new", model: "opus", value: 12 } }],
  ["A7", "interactive and clean, a headless skill session", {}, { kind: { brief: "k02", arm: "new", model: "opus", value: "headless" } }],
  ["A7", "interactive and clean, a none-arm gstack read", {}, { read: { brief: "k02", model: "sol" } }],
];
const admissionSeams: Seam[] = [
  ...ADMIT.flatMap(([id, what, good, bad]) => [
    seam("admission " + id + " (" + what + "): known-good passes", () => { const ok = admit(good, id); return [ok, ok ? "pass" : "fail"]; }),
    seam("admission " + id + " (" + what + "): known-bad fails", () => { const ok = admit(bad, id); return [!ok, ok ? "pass" : "fail"]; }),
  ]),
  ...(["claude", "codex"] as const).flatMap((host) => {
    const model: ModelId = host === "claude" ? "opus" : "sol";
    const on = host === "claude" ? "Claude Code's session file" : "Codex's <skill> item";
    const a8 = (o: Omit<LoadPlant, "host" | "arm">) => {
      const p = plantLoad({ host, arm: "new", ...o });
      try {
        const read = skillLoad({ ...p.row, brief: "k02", model }, p.bodies);
        const c = admission(stage1Input({ load: read })).conditions.find((x) => x.id === "A8")!;
        return { pass: c.pass, why: read.why };
      } finally {
        p.done();
      }
    };
    return [
      seam("admission A8 (" + model + " new's body whole in " + on + "): known-good passes", () => { const r = a8({}); return [r.pass, r.why]; }),
      seam("admission A8 (" + model + " new's body one character short in " + on + "): known-bad fails", () => { const r = a8({ cut: 1 }); return [!r.pass, r.why]; }),
      seam("admission A8 (" + model + " new's copy missing): known-bad fails", () => { const r = a8({ copy: "missing" }); return [!r.pass, r.why]; }),
      seam("admission A8 (" + model + " new's copy unreadable): known-bad fails", () => { const r = a8({ copy: "dir" }); return [!r.pass, r.why]; }),
    ];
  }),
  seam("admission A8: a particle-1 skill body cut short leaves that arm out of particle-1's stage 2, and admission holds", () => {
    const c = admission(stage1Input({ short: { brief: "k05", arm: "current", model: "particle" } })).conditions.find((x) => x.id === "A8")!;
    return [c.pass && JSON.stringify(c.values.stage2_particle_arms) === JSON.stringify(["none", "new"]), JSON.stringify({ left_out: c.values.left_out, stage2_particle_arms: c.values.stage2_particle_arms })];
  }),
  seam("admission A8: a skill session with no read fails", () => {
    const x = stage1Input({});
    const c = admission({ ...x, loads: x.loads.slice(1) }).conditions.find((y) => y.id === "A8")!;
    return [!c.pass, JSON.stringify(c.values.short)];
  }),
  seam("admission: one repair, then FIX-METHOD", () => {
    const bad = admission(stage1Input({ currentRight: 12 })), ok = admission(stage1Input({}));
    const s = [admissionState([bad]), admissionState([bad, ok]), admissionState([bad, bad])];
    return [s.join(" ") === "repair admitted fix-method", s.join(", ")];
  }),
];

/** The lane's ledger items, each read for a recorded cap stop. */
export const ITEMS = [...new Set(SPLIT.map((p) => p.item))];
/** A planted stop record in a fresh temp folder: one launch's stops.json, and a ledger record whose named items each hold a cap stop. */
export function plantStops(o: { launch: { code: string; message: string }[]; capped: readonly string[] }): { launch: string; record: string; done: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "ohr-stops-"));
  const launch = join(dir, "launch");
  mkdirSync(launch);
  writeFileSync(join(launch, "stops.json"), JSON.stringify({ stops: o.launch, unrun: [] }) + "\n");
  const record = join(dir, "record");
  for (const item of o.capped) {
    recordApproval(record, { action: "init", item, cap_micros: 1_000_000, quotes: [{ words: "a planted stop on a temporary ledger, not an approval", by: "lanes/office-hours-rewrite/read/seams.ts", source: "the second attempt's section 3, item 10" }], admission: "warn" });
    recordStop(record, openLease(record, null, { item, run_id: "ohr-seam-" + item, amount_micros: 1_000_000 }).lease_id, item + ":planted");
  }
  return { launch, record, done: () => rmSync(dir, { recursive: true, force: true }) };
}
const FILLED: AuthoringEnd = { stopped: "quotas", full: true };
const stopSeam = (name: string, o: { launch?: { code: string; message: string }[]; capped?: string[]; authoring?: AuthoringEnd; flag?: boolean }, want: { stops: number; row: 1 | 4 }) =>
  seam("stops: " + name, () => {
    const p = plantStops({ launch: o.launch ?? [], capped: o.capped ?? [] });
    try {
      const stops = readStops({ launches: [p.launch], record: p.record, items: ITEMS, authoring: o.authoring ?? FILLED, flag: o.flag ?? false });
      const d = decide({ ...plant("merge"), stops });
      return [stops.length === want.stops && d.row === want.row, "row " + d.row + "; " + (stops.join("; ") || "no stops")];
    } finally {
      p.done();
    }
  });
const stopSeams: Seam[] = [
  stopSeam("a CAP_STOP in a launch's stops.json reads row 1 with no flag", { launch: [{ code: "CAP_STOP", message: "s2-0042: the ledger refused the round" }] }, { stops: 1, row: 1 }),
  stopSeam("a launch's stop that is not about money adds none, and MERGE stands", { launch: [{ code: "E_OHR_MODEL_DRIFT", message: "s2-0042: a reply named another model" }] }, { stops: 0, row: 4 }),
  stopSeam("a ledger item's recorded cap stop reads row 1 with no flag", { capped: ["ohr-s2-arms"] }, { stops: 1, row: 1 }),
  stopSeam("authoring's cap stop after all 88 calibration and comparison briefs were placed does not count", { capped: ["ohr-author"], authoring: { stopped: "cap", full: true } }, { stops: 0, row: 4 }),
  stopSeam("authoring's cap stop before they were placed counts, from the ledger and from authoring's end", { capped: ["ohr-author"], authoring: { stopped: "cap", full: false } }, { stops: 2, row: 1 }),
  stopSeam("authoring that ended on a halt reads row 1, even with calibration and comparison full", { authoring: { stopped: "halt", full: true } }, { stops: 1, row: 1 }),
  stopSeam("--cap-stop adds a stop", { flag: true }, { stops: 1, row: 1 }),
];

export const seams: Seam[] = [...statSeams, ...rowSeams, ...gateSeams, ...admissionSeams, ...stopSeams];
