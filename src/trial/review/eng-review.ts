// Copyright (c) 2026 Garry Tan. MIT License.
// The eng-review lens of review-units (prereg wiki/plans/2026-11-08-geva-405-eng-review-intentions-prereg, sections 5,
// 6, 15 and 16): its five arms, their exact prompts, the frozen session settings, the unit trees, the gstack pins and the
// candidate's digests, the seeded order and the admission rule. er-run.ts runs the sessions and er-cli.ts is the command.
//
// - Prompts: the arm's prefix lines, then the common line, a blank line and ER_TEMPLATE, byte for byte. none has no
//   prefix; lens has ER_LENS_LINE; precut has "/plan-eng-review plan.md", candidate "/plan-coverage plan.md" and engphase
//   the unit's rendered opening, each skill prefix followed by ER_FORCED. Build-time choice: each part sits on its own
//   line (joined by one newline), since the prereg names the parts and their order but not what joins them.
// - Settings, frozen for every arm and model: the claude-code-preset system prompt, 200 turns, 90 minutes (5400 s) and a
//   $10 allowance per attempt, CLAUDE_CODE_DISABLE_1M_CONTEXT=1, CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1 (the driver sets it
//   for every session), WebSearch and WebFetch denied (the driver's DISALLOWED_TOOLS), cap stops on, and
//   GSTACK_SESSION_KIND=unattended on the three skill arms only. Harbor does not run in review-units, so there is no
//   HARBOR_TELEMETRY to set.
// - Mounts: the work dir is the container's /work and holds plan.md and repo/ only. Skill arms add the gstack state root
//   at /work/.gstack-home (where the pre-cut and eng phase test plan artifacts land); none and lens get no state root,
//   no gstack install and no skills. The eng phase arm adds its rendered inputs read-only under /work/autoplan/.
// - A unit tree is plan.md and repo/ copied from the unit folder: never key.json or unit.json. erTreeProblems refuses a
//   tree whose top level is anything else, a file byte-identical to the unit's key.json anywhere in it, and a repo/ that
//   is not one commit with no parent, no remote and no unreachable or reflog-only commit (git runs with hooks off).
// - Pins: each arm's full sha, resolved from a clone of garrytan/gstack, and its VERSION; the candidate's SKILL.md and
//   SKILL.md.tmpl digests are checked in the clone and again in the installed tree, and a mismatch refuses the run.
// - The rec user: plan.ts's mechanism (a persona and a free-form source, no scripted replies) with one fixed reply,
//   REC_REPLY ("Go with your recommendation."), to every question, including one that offers another skill.
// - Order (seed 20261108): units in the order given; within a unit, its cells (arm, model, pass) sorted by the sha256 of
//   "20261108/<unit>/<arm>/<model>/<pass>", so the arms interleave and the order does not depend on which other cells
//   run.
// - Admission: an attempt starts only when the settled spend plus the allowance of every attempt in flight plus its own
//   allowance fits under the cap (--spend-cap, the lease this launch opens on the item). A retry is a new attempt
//   admitted the same way. The proxy's own cap stop stays.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, lstatSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { ArmId, ModelId } from "../../../lanes/eng-review/types.ts";
import type { PersonaAnswer } from "../../usersim/persona.ts";
import { dirTreeSha256 } from "../cache.ts";
import { REC_REPLY } from "./plan.ts";

const sha256 = (t: string | Buffer) => createHash("sha256").update(t).digest("hex");

export const ER_LENS = "eng-review";
export const ER_COMMON = "Review the plan in plan.md for the code in /work/repo, and make it better before anyone builds it.";
export const ER_TEMPLATE = 'End your reply with one fenced block labelled eng-plan that holds a JSON object {"paths": [...], "checks": [...]}. "paths": at most 15 code paths this change touches, most important first, each one string of at most 25 words naming the file and the function, component or user flow. "checks": at most 8 checks this change should ship with, most important first, each one string of at most 40 words naming what it exercises, the failure it would catch, and whether it is a unit test, an end-to-end test, a CI job or an eval.';
export const ER_TEMPLATE_SHA256 = sha256(ER_TEMPLATE);
export const ER_LENS_LINE = "Do an engineering-manager review of this plan.";
export const ER_FORCED = "Run its whole procedure unattended, taking your recommended option at every decision.";

export const ER_REPO = "garrytan/gstack";
export const ER_GSTACK_URL = "https://github.com/garrytan/gstack";
export const ER_PINS = {
  precut: { sha: "b493d4e31ac9619ef7e52e176d590ad4f454cd66", version: "1.97.0.0" },
  engphase: { sha: "199931029e9fe9808554a4863c960d4b9b663a60", version: "1.98.0.0" },
  candidate: { sha: "57295cbc510fcafc4d404d4ba70afc463b01e341", version: "1.98.0.0", branch: "eng-review-intentions-candidate" },
} as const;
export const ER_CANDIDATE_DIGESTS: Readonly<Record<string, string>> = {
  "plan-coverage/SKILL.md": "4778462dbff92da7b5df3088c7b96b6dc1a16e35d063cbb2322a34457dcd9882",
  "plan-coverage/SKILL.md.tmpl": "079b2966e9b6695abe3f86a0585f5a515a72175dc70cb9bfeba503c035e86135",
};

export type ErSkillArm = "precut" | "engphase" | "candidate";
export const isSkillArm = (arm: string): arm is ErSkillArm => arm === "precut" || arm === "engphase" || arm === "candidate";
/** The skill each arm invokes by name, for the driver's opened signal; engphase pastes autoplan's phase and invokes none. */
export const ER_SKILL: Readonly<Record<ArmId, string | null>> = { none: null, lens: null, precut: "plan-eng-review", engphase: null, candidate: "plan-coverage" };
/** The skill the arm install checks for in each skill arm's default install; engphase's is autoplan, whose phase it pastes. */
export const ER_INSTALL_SKILL: Readonly<Record<ErSkillArm, string>> = { precut: "plan-eng-review", engphase: "autoplan", candidate: "plan-coverage" };

export const ER_MODELS: Readonly<Record<string, ModelId>> = { "claude-opus-5-5": "opus", "openai/gpt-6.1-sol": "sol", "particle-ai/particle-1": "particle" };
export const ER_SYSTEM_PROMPT = "claude-code-preset" as const;
export const ER_MAX_TURNS = 200;
export const ER_TIMEOUT_S = 5400;
export const ER_ALLOWANCE_MICROS = 10_000_000;
export const ER_SEED = 20261108;
export const ER_STATE_ROOT_MOUNT = "/work/.gstack-home";
export const ER_INPUT_MOUNT = "/work/autoplan";
export const ER_COVERAGE_DIR = "repo/.gstack/plan-coverage";

/** The arm's prefix lines before the common line; engphase needs its unit's rendered opening. */
export function erPrefix(arm: ArmId, opening: string | null = null): string[] {
  if (arm === "none") return [];
  if (arm === "lens") return [ER_LENS_LINE];
  if (arm === "precut") return ["/plan-eng-review plan.md", ER_FORCED];
  if (arm === "candidate") return ["/plan-coverage plan.md", ER_FORCED];
  if (opening === null || !opening.trim()) throw new Error("E_USAGE: the eng phase arm's prompt needs its unit's rendered opening");
  return [opening.replace(/\s+$/, ""), ER_FORCED];
}
export const erPrompt = (arm: ArmId, opening: string | null = null): string => [...erPrefix(arm, opening), ER_COMMON].join("\n") + "\n\n" + ER_TEMPLATE;

const ER_REC_PERSONA = "You take every recommendation. To each question you answer exactly " + JSON.stringify(REC_REPLY);
/** The sidecar entry every arm runs with: a persona and no scripted replies, so every question reaches erFreeform. */
export const ER_REC_USER = { persona: ER_REC_PERSONA };
export const erFreeform = async (_persona: string, _question: string): Promise<PersonaAnswer> => ({ text: REC_REPLY });
export const ER_REC_USER_SHA256 = sha256(JSON.stringify({ persona: ER_REC_PERSONA, reply: REC_REPLY }));

export const ER_UNIT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
/** The task id in records and paths; the agent sees /work, so it never sees this. */
export const erTaskId = (unitId: string): string => "unit-" + sha256(unitId).slice(0, 12);

/** git with hooks, filters and LFS smudge off, on a repository that never runs its own code here. */
export const safeGit = (repo: string, args: string[]) => spawnSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-c", "filter.lfs.smudge=", "-c", "filter.lfs.process=", "-c", "filter.lfs.required=false", "-c", "safe.directory=*", "-C", repo, ...args], { encoding: "utf8", timeout: 120_000, env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: "/nonexistent", GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0", LANG: "C" } });

/** Why repo is not one commit with no parent, no remote and no later history. */
export function gitHistoryProblems(repo: string): string[] {
  if (!lstatSync(join(repo, ".git"), { throwIfNoEntry: false })?.isDirectory()) return ["repo/ holds no .git directory"];
  const p: string[] = [];
  const count = safeGit(repo, ["rev-list", "--all", "--count"]);
  if (count.status !== 0) return ["git rev-list failed in repo/: " + count.stderr.trim()];
  if (count.stdout.trim() !== "1") p.push("repo/ holds " + count.stdout.trim() + " commits on its refs, not 1");
  const parents = safeGit(repo, ["rev-list", "--all", "--parents", "--max-count=1"]).stdout.trim().split(/\s+/);
  if (parents.length > 1) p.push("repo/'s commit has a parent");
  const remotes = safeGit(repo, ["remote"]).stdout.trim();
  if (remotes) p.push("repo/ has a remote (" + remotes.split("\n").join(", ") + ")");
  const fsck = safeGit(repo, ["fsck", "--unreachable", "--no-reflogs", "--no-progress"]);
  const loose = fsck.stdout.split("\n").filter((l) => /^unreachable (commit|tag)\b/.test(l));
  if (loose.length) p.push("repo/ holds " + loose.length + " unreachable or reflog-only commit" + (loose.length === 1 ? "" : "s"));
  if (existsSync(join(repo, ".git", "shallow"))) p.push("repo/ is a shallow clone");
  return p;
}

function walkFiles(dir: string, rel = ""): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(dir, rel)).sort()) {
    const path = rel ? rel + "/" + name : name;
    const st = lstatSync(join(dir, path));
    if (st.isDirectory()) out.push(...walkFiles(dir, path));
    else if (st.isFile()) out.push(path);
  }
  return out;
}

/** Why a built tree is not an eng-review mount: plan.md and repo/ only, no copy of key.json, and repo/ one commit. */
export function erTreeProblems(tree: string, keySha256: string | null): string[] {
  const p: string[] = [];
  const top = readdirSync(tree).sort();
  if (top.join(",") !== "plan.md,repo") p.push("the tree's top level holds " + JSON.stringify(top) + ", not plan.md and repo/ only");
  if (!lstatSync(join(tree, "plan.md"), { throwIfNoEntry: false })?.isFile()) p.push("the tree's plan.md is not a regular file");
  if (!lstatSync(join(tree, "repo"), { throwIfNoEntry: false })?.isDirectory()) return [...p, "the tree has no repo/ directory"];
  if (keySha256) for (const f of walkFiles(tree)) if (sha256(readFileSync(join(tree, f))) === keySha256) p.push("the tree holds " + f + ", a copy of the unit's key.json");
  return [...p, ...gitHistoryProblems(join(tree, "repo"))];
}

/** Why a unit folder can't run, one line each; empty when it can. */
export function erUnitProblems(unitsDir: string, id: string): string[] {
  if (!ER_UNIT_ID.test(id)) return [id + ": a unit id is letters, digits, dot, dash and underscore, up to 64 characters"];
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
  else p.push(...gitHistoryProblems(join(dir, "repo")).map((x) => id + ": " + x));
  return p;
}

/** Copies a unit's plan.md and repo/ into dest (emptied first) and checks the mount; returns the tree's digest. */
export function buildErTree(unitsDir: string, id: string, dest: string): { tree_sha256: string; problems: string[] } {
  rmSync(dest, { recursive: true, force: true });
  const src = join(unitsDir, id);
  cpSync(join(src, "plan.md"), join(dest, "plan.md"));
  cpSync(join(src, "repo"), join(dest, "repo"), { recursive: true, verbatimSymlinks: true });
  const key = existsSync(join(src, "key.json")) ? sha256(readFileSync(join(src, "key.json"))) : null;
  return { tree_sha256: dirTreeSha256(dest), problems: erTreeProblems(dest, key).map((x) => id + ": " + x) };
}

/** sha256 over "<unit id> <tree digest of its whole folder>" lines, key.json and unit.json included. */
export function erUnitsDigest(unitsDir: string, ids: readonly string[]): string {
  return sha256([...ids].sort((a, b) => (a < b ? -1 : 1)).map((id) => id + " " + dirTreeSha256(join(unitsDir, id))).join("\n"));
}

/** Why a gstack clone does not hold each pin at its VERSION, with the candidate's two digests. */
export function clonePinProblems(clone: string): string[] {
  const p: string[] = [];
  for (const [arm, pin] of Object.entries(ER_PINS)) {
    const full = safeGit(clone, ["rev-parse", "--verify", "--quiet", pin.sha + "^{commit}"]).stdout.trim();
    if (full !== pin.sha) {
      p.push(arm + ": the clone does not hold commit " + pin.sha);
      continue;
    }
    const version = safeGit(clone, ["show", pin.sha + ":VERSION"]).stdout.trim();
    if (version !== pin.version) p.push(arm + ": VERSION at " + pin.sha.slice(0, 9) + " reads " + JSON.stringify(version) + ", not " + pin.version);
  }
  for (const [path, want] of Object.entries(ER_CANDIDATE_DIGESTS)) {
    const r = spawnSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "safe.directory=*", "-C", clone, "show", ER_PINS.candidate.sha + ":" + path], { timeout: 60_000 });
    const got = r.status === 0 ? sha256(r.stdout) : null;
    if (got !== want) p.push("candidate: " + path + " at " + ER_PINS.candidate.sha.slice(0, 9) + " has sha256 " + (got ?? "none") + ", not " + want);
  }
  return p;
}

/** Why an installed gstack tree is not the arm's pin: its VERSION, and for the candidate both digests and the installed skill. */
export function installPinProblems(arm: ErSkillArm, gstack: string | null, home: string | null): string[] {
  if (!gstack) return [arm + ": the arm installs no gstack tree"];
  const p: string[] = [];
  const version = existsSync(join(gstack, "VERSION")) ? readFileSync(join(gstack, "VERSION"), "utf8").trim() : null;
  if (version !== ER_PINS[arm].version) p.push(arm + ": the installed tree reads VERSION " + (version ?? "none") + ", not " + ER_PINS[arm].version);
  if (arm !== "candidate") return p;
  for (const [path, want] of Object.entries(ER_CANDIDATE_DIGESTS)) {
    const got = existsSync(join(gstack, path)) ? sha256(readFileSync(join(gstack, path))) : null;
    if (got !== want) p.push("candidate: the installed " + path + " has sha256 " + (got ?? "none") + ", not " + want);
  }
  const skill = home ? join(home, ".claude", "skills", "plan-coverage", "SKILL.md") : null;
  const got = skill && existsSync(skill) ? sha256(readFileSync(skill)) : null;
  if (got !== ER_CANDIDATE_DIGESTS["plan-coverage/SKILL.md"]) p.push("candidate: ~/.claude/skills/plan-coverage/SKILL.md " + (got ? "has sha256 " + got + ", not the pinned digest" : "is not installed"));
  return p;
}

export interface ErCell {
  unit: string;
  arm: ArmId;
  model: string;
  pass: number;
}
export const erCellId = (c: ErCell): string => JSON.stringify([c.model, c.arm, c.unit, c.pass]);
const orderKey = (c: ErCell) => sha256(ER_SEED + "/" + c.unit + "/" + c.arm + "/" + c.model + "/" + c.pass);

/** Every planned cell in run order: units as given, each unit's cells in its seeded order. */
export function erOrder(units: readonly string[], arms: readonly ArmId[], models: readonly string[], passes: number): ErCell[] {
  return units.flatMap((unit) => arms.flatMap((arm) => models.flatMap((model) => Array.from({ length: passes }, (_, i): ErCell => ({ unit, arm, model, pass: i + 1 })))).sort((a, b) => (orderKey(a) < orderKey(b) ? -1 : 1)));
}

/** The admission rule: settled spend, plus every in-flight attempt's allowance, plus this attempt's, fits under the cap. */
export const erAdmits = (settled: number, inFlight: number, allowance: number, cap: number): boolean => settled + inFlight * allowance + allowance <= cap;
export const ER_ADMISSION_RULE = "an attempt starts only when the settled spend plus the $10 allowance of every attempt in flight plus its own $10 allowance fits under --spend-cap; a retry is a new attempt admitted the same way, and one that doesn't fit is a cap stop; the proxy's own cap stop stays";
