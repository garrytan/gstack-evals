// Plan units in review-units (planning lane plan 2026-10-31-geva-79-planning-lane-plan, B2 to B4; panel v3 plan
// 2026-11-02-geva-165-planning-panel-v3-plan, sections 4 and 5). A plan unit's tree holds plan.md and the context it was
// written in. Every arm reviews it in two turns, with the same rec user and the same driver model and no second model.
//
// - Turn 1 holds no format words (GST-925). Arms: none (PLAN_ASK), lens (the lens line, then PLAN_ASK), gstack and
//   placebo (the lens's command and plan.md, on Lane B's placebo tree for placebo) and gstack-auto (GST-537's CEO-only
//   /autoplan and plan.md, a frozen placeholder until a gstack release ships it).
// - Turn 2 is PLAN_TURN2_TEXT, sent once in the same session after turn 1 completes, with its own turn cap and clock
//   (PLAN_TURN2); a test pins PLAN_TURN2_SHA256. Findings go in a fence whose info word is plan-findings, so a stray json
//   block in a review never parses as the findings list.
// - Lenses: ceo, eng, devex and design. Each has its skill, its command, its lens line (the CEO pattern on the skill's
//   frontmatter description at gstack v1.93.17.0, 68410828fd85) and the review phrases it owns.
// - The rec user (B4) answers every question "Go with your recommendation.". A question about a review mode or a Step 0
//   choice (MODE, built from each lens's Step 0 and mode names in the pinned skills) gets that answer before any other
//   rule (GSTA-2's ruling on GST-925). Otherwise it answers "No, not now." to a question that names another skill or
//   review (a slash command other than the lens's own, or a review phrase the lens does not own), or asks to promote or
//   commit docs. It needs no model. src/usersim's binding rules still hold, so a question that names a gated effect
//   (write, commit, run, ship, ...) gets the simulator's non-approving answer.
//   An arm that installs gstack also gets every question its registry lists set to never-ask (auto-decide) in the
//   trial's throwaway state root, through gstack's global preference file.
// - parsePlanSession reads the last plan-findings block in any assistant turn of a completed session. A plan run scores
//   a malformed, missing or incomplete pass as finding nothing, with a diagnostic note (open item 2).
// - ceoMode reads the review mode gstack's mode handoff line names, so each session's mode is recorded (open item 6).
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import type { UserScript } from "../../skill-eval/contract/sidecar.ts";
import type { ArmSpec, Termination } from "../../types.ts";
import type { PersonaAnswer } from "../../usersim/persona.ts";
import { fencedBlocks } from "./findings.ts";

const sha256 = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");

export type PlanArm = "none" | "gstack" | "gstack-auto" | "lens" | "placebo";
export const PLAN_ARMS: readonly PlanArm[] = ["none", "gstack", "gstack-auto", "lens", "placebo"];

/** Each lens's skill, its told command, its lens line (the skill's own description, frozen in the prereg) and the review phrases it owns. */
export const PLAN_LENSES = {
  ceo: { skill: "plan-ceo-review", command: "/plan-ceo-review", line: "Do a CEO/founder-mode review of this plan.", phrases: ["ceo review"] },
  eng: { skill: "plan-eng-review", command: "/plan-eng-review", line: "Do an eng manager-mode review of this plan.", phrases: ["eng review", "engineering review"] },
  devex: { skill: "plan-devex-review", command: "/plan-devex-review", line: "Do a developer experience review of this plan.", phrases: ["devex review", "dx review", "developer experience review"] },
  design: { skill: "plan-design-review", command: "/plan-design-review", line: "Do a designer's eye review of this plan.", phrases: ["design review", "designer's eye review"] },
} as const satisfies Record<string, { skill: string; command: string; line: string; phrases: readonly string[] }>;
export type PlanLens = keyof typeof PLAN_LENSES;
export const isPlanLens = (v: string): v is PlanLens => Object.hasOwn(PLAN_LENSES, v);

/** The none arm's whole turn 1, and the end of the lens arm's. */
export const PLAN_ASK = "Review plan.md for problems.";

/**
 * gstack-auto (GST-537): /autoplan's CEO-only phase with no questions and the native voice only. Not released: the
 * command is a frozen placeholder and min_version is null, so every gstack is refused until the release sets both.
 */
export const GSTACK_AUTO: { readonly issue: string; readonly command: string; readonly min_version: string | null } = { issue: "GST-537", command: "/autoplan --ceo-only", min_version: null };

export const PLAN_FENCE = "plan-findings";
export const PLAN_SEVERITIES = ["Critical", "High", "Medium", "Low"] as const;
export type PlanSeverity = (typeof PLAN_SEVERITIES)[number];
/** Critical and High are must-fix (the scorer's CRITICAL), Medium and Low noted only; arm.json carries it. */
export const PLAN_SEVERITY_MAP = { default: { Critical: "CRITICAL", High: "CRITICAL", Medium: "INFORMATIONAL", Low: "INFORMATIONAL" } } as const;

/** Turn 2, sent once in the same session after turn 1 completes. */
export const PLAN_TURN2_TEXT = [
  "List every problem you found in plan.md.",
  "",
  "End your reply with one fenced block whose info string is " + PLAN_FENCE + ". It holds a JSON array with one object per finding, or [] when you have none. Each object has these fields:",
  '- "severity": Critical, High, Medium or Low',
  '- "section": the heading in plan.md the finding is about, as written there',
  '- "line": the line number in plan.md, or null',
  '- "claim": what is wrong with the plan, in one or two sentences',
  '- "evidence": what in plan.md or its context shows it',
  '- "fix": what the plan should change',
].join("\n");

export const PLAN_TURN2_SHA256 = sha256(PLAN_TURN2_TEXT);
/** Turn 2's text, its own turn cap and its own clock in seconds, frozen in the prereg. */
export const PLAN_TURN2 = { text: PLAN_TURN2_TEXT, maxTurns: 5, timeoutS: 300 } as const;

/** The arm's turn 1: its whole first message, with no format words. */
export function planArmLine(arm: PlanArm, lens: PlanLens): string {
  const l = PLAN_LENSES[lens];
  if (arm === "none") return PLAN_ASK;
  if (arm === "lens") return l.line + " " + PLAN_ASK;
  return (arm === "gstack-auto" ? GSTACK_AUTO.command : l.command) + " plan.md";
}

/** The skill the arm's told command names; null for none and lens, which install no skill. */
export const planSkill = (arm: PlanArm, lens: PlanLens): string | null => (arm === "gstack" || arm === "placebo" ? PLAN_LENSES[lens].skill : arm === "gstack-auto" ? "autoplan" : null);

const isGstackRepo = (repo: string) => repo === "gstack" || repo.endsWith("/gstack");

/** The plan arm an arm spec runs, by its name and kind: none and lens are bare, placebo is a placebo arm, gstack and gstack-auto are the whole gstack tree. */
export function planArmOf(spec: ArmSpec): PlanArm | null {
  if (spec.kind === "bare") return spec.name === "none" || spec.name === "lens" ? spec.name : null;
  if (spec.kind === "placebo") return spec.name === "placebo" ? "placebo" : null;
  if (spec.kind === "stack" && isGstackRepo(spec.stack.repo) && !spec.stack.path) return spec.name === "gstack" || spec.name === "gstack-auto" ? spec.name : null;
  return null;
}

/** -1, 0 or 1 for dotted numeric versions, such as gstack's 1.91.379.0. */
export function compareVersions(a: string, b: string): number {
  const x = a.split(".").map(Number);
  const y = b.split(".").map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** Why a gstack tree cannot run the gstack-auto arm, or null when it can. */
export function gstackAutoProblem(version: string | null, min: string | null = GSTACK_AUTO.min_version): string | null {
  if (min === null) return "gstack-auto (" + GSTACK_AUTO.issue + ") is not released; its told command " + JSON.stringify(GSTACK_AUTO.command) + " is a placeholder until a gstack release sets GSTACK_AUTO in src/trial/review/plan.ts";
  if (version === null || !/^\d+(\.\d+)*$/.test(version)) return "the gstack tree has no readable VERSION, so it cannot be checked against " + min + ", the release that ships gstack-auto (" + GSTACK_AUTO.issue + ")";
  return compareVersions(version, min) < 0 ? "gstack " + version + " is older than " + min + ", the release that ships gstack-auto (" + GSTACK_AUTO.issue + ")" : null;
}

/** The host path of the gstack tree an arm installs (the folder above its bin/), or null. */
export function gstackDir(install: { gstack: string | null; layers?: readonly { src: string; dest: string }[] }): string | null {
  if (!install.gstack) return null;
  const rel = posix.dirname(posix.dirname(install.gstack));
  for (const layer of install.layers ?? []) {
    const dir = layer.dest ? (rel.startsWith(layer.dest + "/") ? join(layer.src, rel.slice(layer.dest.length + 1)) : null) : join(layer.src, rel);
    if (dir && existsSync(join(dir, "bin"))) return dir;
  }
  return null;
}

export const gstackVersion = (dir: string | null): string | null => (dir && existsSync(join(dir, "VERSION")) ? readFileSync(join(dir, "VERSION"), "utf8").trim() : null);

/** The global preference file that sets every question gstack's registry lists to never-ask, which gstack reads as auto-decide (one-way doors still ask). */
export const GLOBAL_PREFERENCES = "global-question-preferences.json";
/** gstack's project-level preferences file, <state root>/projects/<slug>/question-preferences.json; its entry for an id wins over the global file. */
export const PROJECT_PREFERENCES = "question-preferences.json";
export function neverAskPreferences(dir: string | null): string | null {
  const registry = dir ? join(dir, "scripts", "question-registry.ts") : null;
  if (!registry || !existsSync(registry)) return null;
  const ids = [...new Set([...readFileSync(registry, "utf8").matchAll(/\bid:\s*'([a-z0-9][a-z0-9-]*)'/g)].map((m) => m[1]!))].sort();
  return ids.length ? JSON.stringify(Object.fromEntries(ids.map((id) => [id, "never-ask"])), null, 2) + "\n" : null;
}

export const REC_REPLY = "Go with your recommendation.";
export const REC_DECLINE = "No, not now.";
export const REC_PERSONA = "You take every recommendation. To each question you answer exactly " + JSON.stringify(REC_REPLY) + " That includes a question about a review mode or a Step 0 choice. To any other question that offers to run another skill or review, or to promote or commit docs, you answer exactly " + JSON.stringify(REC_DECLINE);
const OTHER_REVIEWS = ["ceo review", "eng review", "engineering review", "design review", "designer's eye review", "devex review", "dx review", "developer experience review", "security review", "security audit", "code review", "autoplan", "office hours"];
const OTHER_SKILL = Object.fromEntries(Object.entries(PLAN_LENSES).map(([lens, l]) => [lens, new RegExp(["(^|[\\s(\"'`])\\/(?!" + l.command.slice(1) + "(?![\\w-]))[a-z][a-z0-9-]*(:[a-z0-9-]+)?(?=$|[\\s.,;:!?)\"'`])", ...OTHER_REVIEWS.filter((p) => !(l.phrases as readonly string[]).includes(p)).map((p) => "\\b" + p.replace(" ", "[ -]") + "\\b")].join("|"), "i")])) as Record<PlanLens, RegExp>;
const DOCS = /\bpromot(e|es|ed|ing)\b|\bcommit(s|ted|ting)?\b|\bdocs\//i;
const MODE = /\b(SCOPE EXPANSION|SELECTIVE EXPANSION|HOLD SCOPE|SCOPE REDUCTION|DX EXPANSION|DX POLISH|DX TRIAGE)\b|\breview mode\b|\bmode selection\b|\bStep 0[A-I]?\b|\bscope (gate|challenge)\b|\bWhat should I review\?|\b(original|smaller) arrangement\b|\bdesign completeness\b|\bfocus on specific areas\b|\bHow deep should this DX review go\b/i;

const SHIP = /(^|[\s("'`])\/ship(?![\w-])/gi;
const MODE_WORDS = new RegExp(MODE.source, "gi");

/** The rec user's answer to one question under one lens, as the user simulator's free-form source. */
export const recAnswer = (question: string, lens: PlanLens): string => (MODE.test(question) ? (OTHER_SKILL[lens].test(question.replace(MODE_WORDS, " ").replace(SHIP, "$1")) ? REC_DECLINE : REC_REPLY) : OTHER_SKILL[lens].test(question) || DOCS.test(question) ? REC_DECLINE : REC_REPLY);
/** The driver's free-form source for one lens. */
export const recFreeformFor = (lens: PlanLens) => async (_persona: string, question: string): Promise<PersonaAnswer> => {
  const text = recAnswer(question, lens);
  return { text, ...(MODE.test(question) && text === REC_REPLY ? { choice: true as const } : {}) };
};
/** The sidecar entry every plan arm runs with: a persona and no scripted replies, so every question reaches recAnswer. */
export const REC_USER: UserScript = { persona: REC_PERSONA };
export const REC_USER_SHA256 = sha256(JSON.stringify({ persona: REC_PERSONA, reply: REC_REPLY, decline: REC_DECLINE, other_skill: Object.fromEntries(Object.entries(OTHER_SKILL).map(([lens, r]) => [lens, r.source])), docs: DOCS.source, mode: MODE.source, ship: SHIP.source }));

export interface PlanFinding {
  severity: PlanSeverity;
  section: string;
  line: number | null;
  claim: string;
  evidence: string;
  fix: string;
}

export type PlanParse = { kind: "findings"; findings: PlanFinding[] } | { kind: "missing" } | { kind: "malformed"; reason: string } | { kind: "incomplete"; reason: string };

/** sha256 of this file: the plan session key's verifier, so a parser change invalidates cached plan sessions. */
export const PLAN_PARSER_SHA256 = sha256(readFileSync(fileURLToPath(import.meta.url)));

function planItem(item: unknown, i: number): PlanFinding | string {
  const at = "item " + i;
  if (item === null || typeof item !== "object" || Array.isArray(item)) return at + " is not an object";
  const f = item as Record<string, unknown>;
  const severity = typeof f.severity === "string" ? PLAN_SEVERITIES.find((s) => s.toLowerCase() === (f.severity as string).trim().toLowerCase()) : undefined;
  if (!severity) return at + ": severity is not Critical, High, Medium or Low";
  if (typeof f.section !== "string" || !f.section.trim()) return at + ": section is not a heading";
  if ("line" in f && !(f.line === null || (Number.isSafeInteger(f.line) && (f.line as number) >= 1))) return at + ": line is not a whole number from 1, or null";
  if (typeof f.claim !== "string" || !f.claim.trim()) return at + ": claim is not text";
  for (const k of ["evidence", "fix"] as const) if (typeof f[k] !== "string") return at + ": " + k + " is not text";
  return { severity, section: (f.section as string).trim(), line: (f.line ?? null) as number | null, claim: (f.claim as string).trim(), evidence: f.evidence as string, fix: (f.fix as string).trim() };
}

/** Parses one plan-findings block's body. */
export function parsePlanBlock(body: string): PlanParse {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch (e) {
    return { kind: "malformed", reason: "the " + PLAN_FENCE + " block does not parse: " + (e as Error).message };
  }
  if (!Array.isArray(value)) return { kind: "malformed", reason: "the " + PLAN_FENCE + " block is not an array" };
  const findings: PlanFinding[] = [];
  for (const [i, item] of value.entries()) {
    const f = planItem(item, i);
    if (typeof f === "string") return { kind: "malformed", reason: f };
    findings.push(f);
  }
  return { kind: "findings", findings };
}

/** A session's plan findings: the last plan-findings block in its assistant turns, latest turn first. */
export function parsePlanSession(record: { termination: Termination; turns: readonly string[] }): PlanParse {
  if (record.termination.kind !== "completed") return { kind: "incomplete", reason: "the session ended " + record.termination.kind + ("code" in record.termination && record.termination.code ? " (" + record.termination.code + ")" : "") };
  for (let t = record.turns.length - 1; t >= 0; t--) {
    const block = fencedBlocks(record.turns[t]!).filter((b) => b.info.toLowerCase() === PLAN_FENCE).at(-1);
    if (block) return parsePlanBlock(block.body);
  }
  return record.turns.length ? { kind: "missing" } : { kind: "incomplete", reason: "the session completed with no assistant turn" };
}

/** Arm contract v1 lines for one pass: severity (native), path plan.md, line, summary (the claim), section, evidence, fix, pass and id. */
export const renderPlanFindings = (findings: readonly PlanFinding[], pass: number): Record<string, unknown>[] => findings.map((f, i) => ({ severity: f.severity, path: "plan.md", line: f.line, summary: f.claim, section: f.section, evidence: f.evidence, fix: f.fix, pass, id: "p" + pass + "-" + (i + 1) }));

export const CEO_MODES = ["SCOPE EXPANSION", "SELECTIVE EXPANSION", "HOLD SCOPE", "SCOPE REDUCTION"] as const;
export type CeoMode = (typeof CEO_MODES)[number];
const HANDOFF = /(?:Auto-decided review mode \u2192 |Mode: )(SCOPE EXPANSION|SELECTIVE EXPANSION|HOLD SCOPE|SCOPE REDUCTION)\b/;

/** The review mode named by the first mode handoff line in the session's turns (gstack's gstack-ceo-mode-handoff), or null. */
export function ceoMode(turns: readonly string[]): CeoMode | null {
  for (const t of turns) {
    const m = HANDOFF.exec(t);
    if (m) return m[1] as CeoMode;
  }
  return null;
}
