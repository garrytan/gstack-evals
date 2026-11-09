// Copyright (c) 2026 Garry Tan. MIT License.
// The devex lens of review-units (prereg wiki/plans/2026-11-09-geva-417-devex-review-intentions-prereg, sections 5, 6
// and 10, section 15 rules 3, 4, 6 and 7): its four arms and their exact first lines, the forced sentences, the common
// line and the frozen template, the gstack pin, the session limits, the per-arm env, the unit trees and their mount
// checks, the units digest and the per-session kind check. dx-cli.ts runs it; lanes/devex/run reads its sessions.
//
// - Every prompt is the arm's lines before the common line, then the common line, a blank line and DX_TEMPLATE, byte
//   for byte. Each line before the common line sits on its own line: the slash line, then the forced sentence.
// - The gstack arms run DX_GSTACK only, as a default Claude Code install. plan-devex-review runs with
//   GSTACK_SESSION_KIND=unattended and autoplan with GSTACK_SESSION_KIND=interactive, passed to each session by the
//   harness. none and lens have no gstack install, no skills folder and no drive mount.
// - Every arm: the claude-code-preset system prompt, CLAUDE_CODE_DISABLE_1M_CONTEXT=1, CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1,
//   WebSearch and WebFetch denied (the driver's DISALLOWED_TOOLS), and the limits $12, 200 turns and 120 minutes,
//   doubled on every arm and model only under the cost repair (smoke rule 5). The reviewer subagent runs on the cell's
//   model (the driver sets CLAUDE_CODE_SUBAGENT_MODEL to it). gstack arms get plan-tune's question-preference state
//   pinned empty.
// - A unit tree holds plan.md and repo/ only (the aliased snapshot, its one-commit .git included), seeded in the work
//   dir that run.ts's workMount mounts at /work with cwd /work, so the session sees /work/plan.md and /work/repo. autoplan's plan.md is the unit's plan wrapped under
//   "## Implementation plan" and "## Review record". dxMountProblems checks a tree's file list; the run and the dry run
//   both refuse on any problem. key.json, alias.json and unit.json are never mounted, and no repository instruction file
//   (CLAUDE.md, CLAUDE.local.md, AGENTS.md, .claude/AGENTS.md at any depth) may sit in repo/.
// - dxUnitsDigest is the sha256 over "<unit id>/<path> <sha256>" lines of every regular file in each unit's folder,
//   key.json and alias.json included, so rows and scoring can check that no input or key changed after the runs.
// - dxPinProblem checks the checkout a paid run records session kinds from: a git checkout whose HEAD is DX_GSTACK.sha
//   and that holds bin/gstack-session-kind. dx-cli.ts refuses a paid run on any problem; only keyless and dry runs use
//   a stand-in (lanes/devex/run/checks.ts).
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ArmId } from "../../../lanes/devex/types.ts";
import { dirTreeSha256 } from "../cache.ts";
import { GLOBAL_PREFERENCES, PROJECT_PREFERENCES } from "./plan.ts";
import { pvUnitsDigest } from "./product-value.ts";

const sha256 = (t: string | Buffer) => createHash("sha256").update(t).digest("hex");

/** The --plan value that runs this lens. */
export const DX_LENS = "devex";
/** Section 6's template, byte for byte. */
export const DX_TEMPLATE = 'End your reply with one fenced block labelled plan-changes that holds a JSON object {"changes": [...]}: at most eight changes you would make to this plan before anyone builds it, most important first, each one string of at most 40 words. Only this block is scored.';
export const DX_TEMPLATE_SHA256 = sha256(DX_TEMPLATE);
/** Section 5's common line. */
export const DX_COMMON = "Review the plan in plan.md for the code in /work/repo, and make it better before anyone builds it.";
export const DX_COMMON_SHA256 = sha256(DX_COMMON);
export const DX_GSTACK = { repo: "garrytan/gstack", sha: "b6155921a564ba9ec2470fd2cb3894c05e2c2d13", version: "1.98.0.0" } as const;
export const DX_SYSTEM_PROMPT = "claude-code-preset" as const;
/** Section 5's session limits, the same for every arm. */
export const DX_LIMITS = { usd: 12, turns: 200, minutes: 120 } as const;
/** The limits a session runs under: section 5's, or doubled on every arm and model under smoke rule 5's cost repair. */
export const dxLimits = (doubled: boolean) => ({ usd: DX_LIMITS.usd * (doubled ? 2 : 1), turns: DX_LIMITS.turns * (doubled ? 2 : 1), minutes: DX_LIMITS.minutes * (doubled ? 2 : 1) });
/** The work root the tree is seeded at, and the two paths a session sees. */
export const DX_WORK_ROOT = "/work";
export const DX_MOUNTS = { repo: "/work/repo", plan: "/work/plan.md" } as const;

export interface DxArmSpec {
  /** The lines before the common line, each on its own line; empty for none. */
  lines: readonly string[];
  gstack: boolean;
  skill: "plan-devex-review" | "autoplan" | null;
  /** GSTACK_SESSION_KIND the harness passes; null outside the gstack arms. */
  session_kind: "unattended" | "interactive" | null;
}
export const DX_FORCED = {
  "plan-devex-review": "Run its whole procedure unattended, taking your recommended option at every decision.",
  autoplan: "Run its whole procedure, taking your recommended option at every decision.",
} as const;
export const DX_ARMS: Readonly<Record<ArmId, DxArmSpec>> = {
  none: { lines: [], gstack: false, skill: null, session_kind: null },
  lens: { lines: ["Do a developer-experience lead's review of this plan."], gstack: false, skill: null, session_kind: null },
  "plan-devex-review": { lines: ["/plan-devex-review plan.md", DX_FORCED["plan-devex-review"]], gstack: true, skill: "plan-devex-review", session_kind: "unattended" },
  autoplan: { lines: ["/autoplan --kind feature plan.md", DX_FORCED.autoplan], gstack: true, skill: "autoplan", session_kind: "interactive" },
};
export const isDxArm = (name: string): name is ArmId => Object.hasOwn(DX_ARMS, name);
export const dxPrompt = (arm: ArmId): string => [...DX_ARMS[arm].lines, DX_COMMON].join("\n") + "\n\n" + DX_TEMPLATE;
export const DX_PROMPT_SHA256: Readonly<Record<ArmId, string>> = Object.fromEntries((Object.keys(DX_ARMS) as ArmId[]).map((a) => [a, sha256(dxPrompt(a))])) as Record<ArmId, string>;

/** The agent env the lens adds per arm, beside the driver's own. */
export function dxArmEnv(arm: ArmId): Record<string, string> {
  const kind = DX_ARMS[arm].session_kind;
  return { CLAUDE_CODE_DISABLE_1M_CONTEXT: "1", CLAUDE_CODE_DISABLE_BUNDLED_SKILLS: "1", ...(kind ? { GSTACK_SESSION_KIND: kind } : {}) };
}
/** plan-tune's question-preference state, pinned empty in every gstack arm: the state root's global file and each project's. */
export const DX_PLAN_TUNE_EMPTY = "{}\n";
export const dxPlanTuneState = (arm: ArmId) => (DX_ARMS[arm].gstack ? { stateFiles: { [GLOBAL_PREFERENCES]: DX_PLAN_TUNE_EMPTY }, stateProjectFiles: { [PROJECT_PREFERENCES]: DX_PLAN_TUNE_EMPTY } } : {});

/** autoplan's repair (smoke rule 5): gstack's own stop gate at the pin, as its install's autoplan gate option prints it. */
export const DX_AUTOPLAN_GATE = { settings: "gstack-skill-gates settings --autoplan", shims: ["autoplan-stop-gate-stop", "autoplan-stop-gate-publish"] } as const;
/** The printed settings unchanged once both autoplan gate shims are registered; otherwise why they can't be used. */
export function dxAutoplanGateSettings(printed: string): Record<string, unknown> | string {
  let settings: { hooks?: Record<string, unknown> };
  try {
    settings = JSON.parse(printed);
  } catch {
    return "the printed settings are not JSON";
  }
  const commands = Object.values(settings?.hooks ?? {}).flatMap((groups) => (Array.isArray(groups) ? groups : []).flatMap((g) => (Array.isArray(g?.hooks) ? g.hooks : []).map((h: { command?: unknown }) => (typeof h?.command === "string" ? h.command.replace(/"$/, "") : ""))));
  const missing = DX_AUTOPLAN_GATE.shims.filter((s) => !commands.some((c) => c.endsWith("/" + s)));
  return missing.length ? "the printed settings register no " + missing.join(" or ") + " hook" : (settings as Record<string, unknown>);
}

/** autoplan's input: the unit's plan under "## Implementation plan", then an empty "## Review record". */
export const autoplanPlan = (plan: string): string => "## Implementation plan\n\n" + plan.replace(/\s+$/, "") + "\n\n## Review record\n";

export const DX_UNIT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const dxTaskId = (unitId: string): string => "unit-" + sha256(unitId).slice(0, 12);
const INSTRUCTION = /(^|\/)(CLAUDE\.md|CLAUDE\.local\.md|AGENTS\.md)$/;

/** Every entry under dir that is not a directory, relative and sorted; a symlink is listed as an entry. */
function entries(dir: string, rel = ""): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(dir, rel)).sort()) {
    const path = rel ? rel + "/" + name : name;
    if (lstatSync(join(dir, path)).isDirectory()) out.push(...entries(dir, path));
    else out.push(path);
  }
  return out;
}

/** Why a unit folder can't run, one line each; empty when it can. */
export function dxUnitProblems(unitsDir: string, id: string): string[] {
  if (!DX_UNIT_ID.test(id)) return [id + ": a unit id is letters, digits, dot, dash and underscore, up to 64 characters"];
  const dir = join(unitsDir, id);
  const p: string[] = [];
  try {
    const meta = JSON.parse(readFileSync(join(dir, "unit.json"), "utf8"));
    if (meta?.id !== id) p.push(id + ": unit.json names id " + JSON.stringify(meta?.id) + ", not its folder's");
  } catch (e) {
    p.push(id + ": unit.json does not read as JSON (" + (e as Error).message + ")");
  }
  const plan = lstatSync(join(dir, "plan.md"), { throwIfNoEntry: false });
  if (!plan?.isFile() || plan.size === 0) p.push(id + ": plan.md is not a non-empty regular file");
  if (!lstatSync(join(dir, "repo"), { throwIfNoEntry: false })?.isDirectory()) p.push(id + ": repo/ is not a directory");
  else if (!entries(join(dir, "repo")).length) p.push(id + ": repo/ holds no file");
  return p;
}

/** Why a tree's file list is not a devex mount: plan.md and repo/ only, no key or alias, no repository instruction file. */
export function dxMountProblems(files: readonly string[]): string[] {
  const p: string[] = [];
  if (!files.includes("plan.md")) p.push("the tree has no plan.md");
  if (!files.some((f) => f.startsWith("repo/"))) p.push("the tree has no repo/ file");
  for (const f of files) {
    if (/(^|\/)(key|alias|unit)\.json$/.test(f) && !f.startsWith("repo/")) p.push("the tree holds " + f + ", which is never mounted");
    else if (f !== "plan.md" && !f.startsWith("repo/")) p.push("the tree holds " + f + ", which no session sees");
    else if (f.startsWith("repo/") && !f.startsWith("repo/.git/") && INSTRUCTION.test(f)) p.push("the tree holds " + f + ", a repository instruction file the snapshot strips");
  }
  return p;
}

/** Copies a unit's plan.md (wrapped for autoplan) and repo/ into dest (emptied first) and checks the mount. */
export function buildDxTree(unitsDir: string, id: string, arm: ArmId, dest: string): { files: string[]; tree_sha256: string; problems: string[] } {
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  const src = join(unitsDir, id);
  const plan = readFileSync(join(src, "plan.md"), "utf8");
  writeFileSync(join(dest, "plan.md"), arm === "autoplan" ? autoplanPlan(plan) : plan);
  cpSync(join(src, "repo"), join(dest, "repo"), { recursive: true, verbatimSymlinks: true });
  const files = entries(dest);
  return { files, tree_sha256: dirTreeSha256(dest), problems: dxMountProblems(files).map((x) => id + ": " + x) };
}

/** sha256 over every regular file of each unit folder, key.json and alias.json included, by unit id and path. */
export const dxUnitsDigest = pvUnitsDigest;

/**
 * What the pin's own bin/gstack-session-kind prints in a session's env, and, for autoplan, whether the pin's leanMode
 * turns the lean run on for --kind feature. Run on the evaluator side with the session's env, as the earlier autoplan
 * arm checks it (lanes/outcome-skills/arms/autoplan.ts). lean is null outside autoplan.
 */
export function dxSessionKind(gstackDir: string, arm: ArmId, env: Record<string, string>): { session_kind: string | null; lean: boolean | null; problem: string | null } {
  const sk = spawnSync("bash", [join(gstackDir, "bin", "gstack-session-kind")], { env, encoding: "utf8", timeout: 10_000 });
  const kind = sk.status === 0 ? sk.stdout.trim() || null : null;
  if (kind === null) return { session_kind: null, lean: null, problem: "the pin's bin/gstack-session-kind did not run (exit " + sk.status + ")" };
  if (arm !== "autoplan") return { session_kind: kind, lean: null, problem: null };
  const lean = spawnSync(process.execPath, ["-e", "const { leanMode } = await import(process.argv[1]); const [sessionKind, env] = JSON.parse(process.argv[2]); console.log(JSON.stringify(leanMode({ kind: 'feature', sessionKind, env }) ?? null));", join(gstackDir, "lib", "autoplan-lean.ts"), JSON.stringify([kind, env])], { encoding: "utf8", timeout: 30_000 });
  if (lean.status !== 0) return { session_kind: kind, lean: null, problem: "the pin's leanMode did not run: " + lean.stderr.trim().slice(-300) };
  const mode = JSON.parse(lean.stdout.trim()) as { kind?: string } | null;
  return { session_kind: kind, lean: mode?.kind === "feature", problem: null };
}
/** Why a session's recorded kind and lean mode are not its arm's: unattended for plan-devex-review, interactive with lean mode for autoplan. */
export function dxSessionKindProblem(arm: ArmId, got: { session_kind: string | null; lean: boolean | null }): string | null {
  const want = DX_ARMS[arm].session_kind;
  if (want === null) return null;
  if (got.session_kind !== want) return arm + " runs with session kind " + want + ", and the pin reports " + JSON.stringify(got.session_kind);
  if (arm === "autoplan" && got.lean !== true) return "autoplan runs its lean feature kind, and the pin's leanMode reports " + JSON.stringify(got.lean);
  return null;
}

/** Why dir is not the pinned gstack checkout a paid run needs, or null when it is. git runs with PATH set to path when given. */
export function dxPinProblem(dir: string | undefined, path: string | undefined, sha: string = DX_GSTACK.sha): string | null {
  if (!dir) return "GSTACK_EVALS_DX_PIN is not set, so no pinned gstack checkout is named";
  if (!lstatSync(join(dir, ".git"), { throwIfNoEntry: false })) return "GSTACK_EVALS_DX_PIN " + dir + " is not a git checkout";
  const head = spawnSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8", env: { ...process.env, ...(path ? { PATH: path } : {}) } }).stdout?.trim() || "no commit";
  if (head !== sha) return "GSTACK_EVALS_DX_PIN " + dir + " is at " + head + ", not the pin " + sha;
  if (!lstatSync(join(dir, "bin", "gstack-session-kind"), { throwIfNoEntry: false })?.isFile()) return "GSTACK_EVALS_DX_PIN " + dir + " holds no bin/gstack-session-kind";
  return null;
}
