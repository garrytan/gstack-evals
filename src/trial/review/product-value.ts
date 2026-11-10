// The product-value lens of review-units (prereg wiki/plans/2026-11-08-geva-403-product-value-prereg, sections 5, 6, 10
// and 17): its arms and their exact first lines, the frozen closing template, the smoke fallbacks, the per-family unit
// trees and the units digest. pv-cli.ts runs it and run.ts carries its sessions; lanes/product-value/parse.ts reads them.
//
// - Plan family: none, lens and plan-ceo-review, plus plan-ceo-review-gate, smoke rule 3's opt-in gate variant (the same
//   prompt and tree, with gstack-skill-gates settings --ceo-review). Brief family: none, lens and office-hours. Each
//   prompt is the arm's first line, a blank line and PV_TEMPLATE, byte for byte. --pv-fallback-sentence (smoke rule 2,
//   plan family only) puts PV_FALLBACK_SENTENCE on its own line right after the first line, on all three plan arms.
// - The gstack arms run PV_GSTACK only. The gate arm passes the settings its own gstack-skill-gates prints unchanged: at
//   the pin they register both ceo-review shims at gstack's own hook timeout (25 s), which outlives the 20 s deadline
//   the ceo-outcome lane froze (skill-gates.ts GATE_DEADLINE_MS), so nothing is raised.
// - The rec user is plan.ts's for the plan family, byte for byte. The brief family's has the same persona, replies and
//   rule with office-hours as the skill under test: a question that offers another skill, /plan-ceo-review or a CEO
//   review included, gets "No, not now.", and one about office hours gets the recommendation.
// - A unit tree holds the family's input (plan.md or brief.md) and context/, regular files only, nothing else: no
//   key.json, no unit.json and not the other family's input. mountProblems checks a tree's file list, and both the run
//   and the dry run refuse on any problem. Task ids are unit- and the first 12 hex of the unit id's sha256, so the path
//   the agent sees names no unit.
// - pvUnitsDigest is the sha256 over "<unit id>/<path> <sha256>" lines of every regular file in each unit's folder,
//   key.json and unit.json included, so rows and scoring can check that no input or key changed after the runs.
import { createHash } from "node:crypto";
import { copyFileSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ArmId, Family } from "../../../lanes/product-value/types.ts";
import type { PersonaAnswer } from "../../usersim/persona.ts";
import { dirTreeSha256 } from "../cache.ts";
import { REC_DECLINE, REC_PERSONA, REC_REPLY, REC_USER, REC_USER_SHA256, recFreeform } from "./plan.ts";
import { GATE_DEADLINE_MS } from "./skill-gates.ts";

const sha256 = (t: string | Buffer) => createHash("sha256").update(t).digest("hex");

/** The --plan value that runs this lens. */
export const PV_LENS = "product-value";
/** Section 6's template, byte for byte. */
export const PV_TEMPLATE = 'End your reply with one fenced block labelled plan-changes that holds a JSON object {"changes": [...]}: at most five changes you would make to what this team plans to build, most important first, each one string of at most 40 words. Only this block is scored.';
export const PV_TEMPLATE_SHA256 = sha256(PV_TEMPLATE);
/** Section 10, smoke rule 2's sentence. */
export const PV_FALLBACK_SENTENCE = "Take your recommended option at every decision, scope additions included.";
export const PV_GSTACK = { repo: "garrytan/gstack", sha: "23f9d07ce9e802ac148a8a353228f201655fc5b8", version: "1.98.0.0" } as const;
export const PV_GATE_ARM = "plan-ceo-review-gate";
/** The models under test, by their policy keys (R54, as in the ceo-outcome lane), and their row ids. */
export const PV_MODELS: Readonly<Record<string, "opus" | "sol" | "particle">> = { "claude-opus-5-5": "opus", "openai/gpt-6.1-sol": "sol", "particle-ai/particle-1": "particle" };
/** The ceo-outcome lane's limits (the CEO stage 2 pin's launch flags): 150 turns, 3600 s. */
export const PV_MAX_TURNS = 150;
export const PV_TIMEOUT_S = 3600;
export const PV_SYSTEM_PROMPT = "claude-code-preset" as const;

const PLAN_ASK = "Review the plan in plan.md and make it better.";
const BRIEF_ASK = "Here is what a team wants to build, in brief.md. Help them make it better.";
export interface PvArmSpec {
  line: string;
  told: "none" | "lens" | "gstack";
  skill: "plan-ceo-review" | "office-hours" | null;
}
export const PV_ARMS: Readonly<Record<Family, Readonly<Record<string, PvArmSpec>>>> = {
  plan: {
    none: { line: PLAN_ASK, told: "none", skill: null },
    lens: { line: "Do a CEO/founder-mode review of this plan. " + PLAN_ASK, told: "lens", skill: null },
    "plan-ceo-review": { line: "/plan-ceo-review " + PLAN_ASK, told: "gstack", skill: "plan-ceo-review" },
    [PV_GATE_ARM]: { line: "/plan-ceo-review " + PLAN_ASK, told: "gstack", skill: "plan-ceo-review" },
  },
  brief: {
    none: { line: BRIEF_ASK, told: "none", skill: null },
    lens: { line: "Do a YC office-hours review of this idea. " + BRIEF_ASK, told: "lens", skill: null },
    "office-hours": { line: "/office-hours " + BRIEF_ASK, told: "gstack", skill: "office-hours" },
  },
};
export const pvArm = (family: Family, name: string): PvArmSpec | null => (Object.hasOwn(PV_ARMS[family], name) ? PV_ARMS[family][name]! : null);
/** The row's arm: none, lens, or skill for the gstack arm (the gate variant included). */
export const pvArmId = (name: string): ArmId => (name === "none" || name === "lens" ? name : "skill");
/** The arm's first line, with the fallback sentence on the next line when it is on. */
export const pvArmLine = (family: Family, name: string, fallback: boolean): string => pvArm(family, name)!.line + (fallback ? "\n" + PV_FALLBACK_SENTENCE : "");
export const pvPrompt = (family: Family, name: string, fallback: boolean): string => pvArmLine(family, name, fallback) + "\n\n" + PV_TEMPLATE;

const SHIMS = ["ceo-review-gate-stop", "ceo-review-gate-subagent-stop"] as const;
/** What the gate arm freezes beside its tree, in the session key and arm_provenance. */
export const PV_GATE_KEY = { settings: "gstack-skill-gates settings --ceo-review", hook_timeout_s: "as printed", deadline_ms: GATE_DEADLINE_MS } as const;
/** The printed settings unchanged, once both ceo-review shims are registered; otherwise why they can't be used. */
export function pvGateSettings(printed: string): Record<string, unknown> | string {
  let settings: { hooks?: Record<string, unknown> };
  try {
    settings = JSON.parse(printed);
  } catch {
    return "the printed settings are not JSON";
  }
  const commands = Object.values(settings?.hooks ?? {}).flatMap((groups) => (Array.isArray(groups) ? groups : []).flatMap((g) => (Array.isArray(g?.hooks) ? g.hooks : []).map((h: { command?: unknown }) => (typeof h?.command === "string" ? h.command.replace(/"$/, "") : ""))));
  const missing = SHIMS.filter((s) => !commands.some((c) => c.endsWith("/" + s)));
  return missing.length ? "the printed settings register no " + missing.join(" or ") + " hook" : (settings as Record<string, unknown>);
}

const OTHER_SKILL_BRIEF = /(^|[\s("'`])\/(?!office-hours(?![\w-]))[a-z][a-z0-9-]*(:[a-z0-9-]+)?(?=$|[\s.,;:!?)"'`])|\b(eng|design|devex|dx|security|code|ceo) review\b|\bautoplan\b|\bplan[ -]ceo[ -]review\b/i;
const DOCS = /\bpromot(e|es|ed|ing)\b|\bcommit(s|ted|ting)?\b|\bdocs\//i;
/** The brief family's rec user answer to one question. */
export const briefRecAnswer = (question: string): string => (OTHER_SKILL_BRIEF.test(question) || DOCS.test(question) ? REC_DECLINE : REC_REPLY);
const briefFreeform = async (_persona: string, question: string): Promise<PersonaAnswer> => ({ text: briefRecAnswer(question) });
export const PV_BRIEF_REC_USER_SHA256 = sha256(JSON.stringify({ persona: REC_PERSONA, reply: REC_REPLY, decline: REC_DECLINE, other_skill: OTHER_SKILL_BRIEF.source, docs: DOCS.source }));
/** The family's rec user: plan.ts's for the plan family, its office-hours twin for the brief family. */
export const pvRecUser = (family: Family) => (family === "plan" ? { user: REC_USER, freeform: recFreeform, sha256: REC_USER_SHA256 } : { user: REC_USER, freeform: briefFreeform, sha256: PV_BRIEF_REC_USER_SHA256 });

export const PV_INPUT: Readonly<Record<Family, string>> = { plan: "plan.md", brief: "brief.md" };
export const PV_UNIT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const pvTaskId = (unitId: string): string => "unit-" + sha256(unitId).slice(0, 12);

/** Every regular file under dir, relative and sorted, and one problem per entry that is neither a file nor a directory. */
function walk(dir: string, rel = ""): { files: string[]; problems: string[] } {
  const files: string[] = [];
  const problems: string[] = [];
  let names: string[];
  try {
    names = readdirSync(join(dir, rel)).sort();
  } catch (e) {
    return { files, problems: [String((e as Error).message)] };
  }
  for (const name of names) {
    const path = rel ? rel + "/" + name : name;
    const st = lstatSync(join(dir, path));
    if (st.isDirectory()) {
      const sub = walk(dir, path);
      files.push(...sub.files);
      problems.push(...sub.problems);
    } else if (st.isFile()) files.push(path);
    else problems.push(path + " is not a regular file or directory" + (st.isSymbolicLink() ? " (a symlink)" : ""));
  }
  return { files, problems };
}

/** Why a unit folder can't run in a family, one line each; empty when it can. */
export function pvUnitProblems(unitsDir: string, id: string, family: Family): string[] {
  if (!PV_UNIT_ID.test(id)) return [id + ": a unit id is letters, digits, dot, dash and underscore, up to 64 characters"];
  const dir = join(unitsDir, id);
  const p: string[] = [];
  try {
    const meta = JSON.parse(readFileSync(join(dir, "unit.json"), "utf8"));
    if (meta?.id !== id) p.push(id + ": unit.json names id " + JSON.stringify(meta?.id) + ", not its folder's");
  } catch (e) {
    p.push(id + ": unit.json does not read as JSON (" + (e as Error).message + ")");
  }
  const input = lstatSync(join(dir, PV_INPUT[family]), { throwIfNoEntry: false });
  if (!input?.isFile() || input.size === 0) p.push(id + ": " + PV_INPUT[family] + " is not a non-empty regular file");
  if (!lstatSync(join(dir, "context"), { throwIfNoEntry: false })?.isDirectory()) p.push(id + ": context/ is not a directory");
  else {
    const ctx = walk(join(dir, "context"));
    p.push(...ctx.problems.map((x) => id + ": context/" + x));
    if (!ctx.files.length) p.push(id + ": context/ holds no file");
  }
  return p;
}

/** Why a unit tree's file list is not the family's mount: its input and context/ files only. */
export function mountProblems(files: readonly string[], family: Family): string[] {
  const p: string[] = [];
  if (!files.includes(PV_INPUT[family])) p.push("the tree has no " + PV_INPUT[family]);
  if (!files.some((f) => f.startsWith("context/"))) p.push("the tree has no context/ file");
  for (const f of files) {
    if (/(^|\/)(key|unit)\.json$/.test(f)) p.push("the tree holds " + f + ", which is never mounted");
    else if (f !== PV_INPUT[family] && !f.startsWith("context/")) p.push("the tree holds " + f + ", which the " + family + " family never sees");
  }
  return p;
}

/** Copies a unit's family input and context/ into dest (emptied first) and checks the mount; returns its files and digest. */
export function buildPvTree(unitsDir: string, id: string, family: Family, dest: string): { files: string[]; tree_sha256: string; problems: string[] } {
  rmSync(dest, { recursive: true, force: true });
  const src = join(unitsDir, id);
  const ctx = walk(join(src, "context"));
  const files = [PV_INPUT[family], ...ctx.files.map((f) => "context/" + f)];
  for (const f of files) {
    mkdirSync(dirname(join(dest, f)), { recursive: true });
    copyFileSync(join(src, f), join(dest, f));
  }
  const built = walk(dest);
  return { files: built.files, tree_sha256: dirTreeSha256(dest), problems: [...ctx.problems, ...built.problems, ...mountProblems(built.files, family)].map((x) => id + ": " + x) };
}

/** sha256 over every regular file of each unit folder, key.json included, by unit id and path. */
export function pvUnitsDigest(unitsDir: string, ids: readonly string[]): { sha256: string; files: number } {
  const lines = [...ids].sort((a, b) => (a < b ? -1 : 1)).flatMap((id) => walk(join(unitsDir, id)).files.map((f) => id + "/" + f + " " + sha256(readFileSync(join(unitsDir, id, f)))));
  return { sha256: sha256(lines.join("\n")), files: lines.length };
}

/** Contract v1 lines for one pass: one per change, in rank order, on the family's input with no line. */
export const renderPvChanges = (changes: readonly string[], pass: number, family: Family): Record<string, unknown>[] => changes.map((c, i) => ({ severity: i < 5 ? "change" : "extra", path: PV_INPUT[family], line: null, summary: c, rank: i + 1, pass, id: "p" + pass + "-" + (i + 1) }));
export const PV_SEVERITY_MAP = { default: { change: "CRITICAL", extra: "INFORMATIONAL" } } as const;
