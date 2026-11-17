// Copyright (c) 2026 Garry Tan. MIT License.
// The planted-unit qualifier and grader (plan sections 2 and 5). qualify takes one constructed unit through the region
// size, the body check on B's tree, the lane's screen with rule 2's crash class and the recipe fixes, the unit build in
// the frozen grading sandbox with rule 1's functional set and the keyless signature note, the one-commit check, the
// leak check and the body check on the unit image; every drop is a record with a reason. plantedGrader is the
// PlantedGrader seam the build stage calls: one tree's planted and functional cases, and one build's catch, null with a
// reason when the transplant drops or the build's own tests don't compile. Prints nothing.
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { catchBuild } from "../../eng-build/catch.ts";
import { keepEvidence } from "../../eng-build/evidence.ts";
import { EbError } from "../../eng-build/errors.ts";
import { leakCheck, leakNeedles } from "../../eng-build/leak.ts";
import { plantedNote } from "../../eng-build/note.ts";
import { ecoOfFile, findProject, hasRecipe, recipeFor, runnable, type RecipeOptions } from "../../eng-build/recipes.ts";
import { recountUnit } from "../../eng-build/recount.ts";
import { screenCandidate } from "../../eng-build/screen.ts";
import { buildUnit, caseRuns, gradeSet, listing, readUnit, testChanges } from "../../eng-build/unit.ts";
import { showFile } from "../../real-outcome/mine/git.ts";
import { isProtectedPath } from "../../real-outcome/mine/paths.ts";
import { docker } from "../../real-outcome/task/docker.ts";
import { BASE_BRANCH } from "../../real-outcome/task/format.ts";
import * as verify from "../../real-outcome/task/verify.ts";
import { notBuilt } from "../errors.ts";
import { FROZEN } from "../frozen.ts";
import type { Ecosystem, PlantedGrader } from "../types.ts";
import { unitSpec, type Constructed } from "./build.ts";
import { bundleHistory, imageHistory, judge, needlesOf, scanImage, scanTexts, treeTexts } from "./checks.ts";
import { frameLicence, SANDBOX, starStratum, type DropRecord, type MinedFix } from "./local.ts";

/** The recipe fixes the probe found (section 13). */
export const RECIPE: RecipeOptions = { goToolchain: true, cargoVolumes: true };
export const LICENCE_OPTS = { allowed: FROZEN.frame.licences, detect: frameLicence };

/** Grading needs the frozen sandbox in the lane's verifier; until verify.ts takes the sandbox option, it refuses. */
export function requireSandbox(): void {
  if (!("SANDBOX_OPTION" in verify)) notBuilt("the frozen grading sandbox (verify.ts's sandbox option)");
}

/** One candidate's outcome. Held on the screening host; supply prints counts only. */
export interface Outcome {
  id: string;
  repo: string;
  eco: Ecosystem;
  stars: ReturnType<typeof starStratum>;
  strict: boolean;
  /** The step it dropped at, or "qualified" (built and passed every check), or "clean" (recount held). */
  step: DropRecord["step"] | "qualified" | "clean";
  reason: string | null;
  regionLines: number;
  planted: number;
  crash: number;
  functional: number;
}

/** Pins every image the unit's recipes can ask for by digest, pulling each tag once. */
export function pinImages(mirror: string, base: string, merge: string, fix: string, recipe: RecipeOptions = RECIPE): Record<string, string> {
  const names = new Set(listing(mirror, base).keys());
  const tags = new Set<string>();
  for (const [a, b] of [[base, merge], [merge, fix]]) {
    const tc = testChanges(mirror, a, b);
    const at = new Set(listing(mirror, b).keys());
    for (const path of [...tc.whole, ...tc.regions]) {
      const eco = ecoOfFile(path);
      const p = eco && hasRecipe(eco) ? findProject(eco, path, at) : null;
      if (eco && hasRecipe(eco) && p) for (const t of recipeFor(eco, (q) => showFile(mirror, base, q), p.root, names, recipe).images) tags.add(t);
    }
  }
  const pinned: Record<string, string> = {};
  for (const tag of tags) {
    if (docker(["pull", "-q", tag], { timeoutMs: 1800000 }).status !== 0) continue;
    const d = docker(["image", "inspect", "-f", "{{index .RepoDigests 0}}", tag]).stdout.trim();
    if (d.includes("@sha256:")) pinned[tag] = d;
  }
  return pinned;
}

/** Rule 1's candidate files: P's runnable test files in the directories of the region's files and of the test files F
 * changes, at most 20, so a fix that only adds a test file still has a functional set. */
export function functionalFiles(mirror: string, m: MinedFix, c: Constructed): string[] {
  const dirs = new Set([...m.functions.map((f) => dirname(f.file)), ...m.testFiles.map((p) => dirname(p))]);
  return [...listing(mirror, c.merge).keys()].filter((p) => dirs.has(dirname(p)) && isProtectedPath(p) && ecoOfFile(p) === m.eco && runnable(m.eco, p)).sort().slice(0, 20);
}

/** Takes one constructed unit to qualified or a drop. The one-commit check refuses with E_EP_TESTBED_HISTORY. */
export function qualify(o: { mirror: string; fix: MinedFix; unit: Constructed; out: string; work: string; labels: string; images?: Record<string, string> }): Outcome {
  const { fix: m, unit: c } = o;
  const res: Outcome = { id: m.id, repo: m.repo, eco: m.eco, stars: starStratum(m.stars), strict: m.earliestPublic.slice(0, 10) >= FROZEN.window.strictFrom, step: "region", reason: null, regionLines: c.regionLines, planted: 0, crash: 0, functional: 0 };
  const drop = (step: DropRecord["step"], reason: string, detail: unknown = null): Outcome => {
    keepEvidence(m.id, "drop.json", { step, reason, detail });
    return Object.assign(res, { step, reason });
  };
  if (c.regionLines < FROZEN.region.minLines || c.regionLines > FROZEN.region.maxLines) return drop("region", "region_lines", { regionLines: c.regionLines, min: FROZEN.region.minLines, max: FROZEN.region.maxLines });
  const needles = needlesOf(c.removed);
  const tree = treeTexts(o.mirror, c.base);
  for (const n of needles) {
    const hits = scanTexts(n, tree);
    if (!judge(n, hits).passes) return drop("body", "body_in_base_tree", { needle: n, hits });
  }
  requireSandbox();
  const extra = functionalFiles(o.mirror, m, c);
  const screened = screenCandidate({ id: m.id, base: c.base, merge: c.merge, fixes: [{ commit: c.fix, kind: "fix" }] }, o.mirror, { work: o.work, recipe: RECIPE, crash: true, functionalFiles: extra, ownTestsAtBase: true });
  if (!screened.qualifies) return drop("screen", [screened.step, screened.cls].join(":"), screened);
  const images = o.images ?? pinImages(o.mirror, c.base, c.merge, c.fix);
  let built;
  try {
    built = buildUnit(unitSpec(m, c, images, FROZEN.window.strictFrom), o.mirror, o.out, { work: o.work, labels: o.labels, planted: true, recipe: RECIPE, sandbox: SANDBOX, licences: LICENCE_OPTS, note: plantedNote(c.signatures), functionalFiles: extra });
  } catch (error) {
    if (error instanceof EbError) return drop("build", error.code + ":" + (/step=(\S+) class=(\S+)/.exec(error.message)?.slice(1).join(":") ?? "error"), error.message);
    throw error;
  }
  const planted = built.eb.unit.aftermath.flatMap((a) => a.cases);
  Object.assign(res, { planted: planted.length, crash: built.eb.planted?.crash.length ?? 0, functional: built.eb.unit.functional.length });
  if (!built.qualifies) return drop("build", built.drop!.step + ":" + built.drop!.cls, { drop: built.drop, unit: built.eb.unit });
  bundleHistory(m.id, join(o.out, "environment/task.bundle"));
  imageHistory(m.id, built.eb.image.id);
  try {
    leakCheck({ unit: m.id, image: built.eb.image.id, repo: m.repo, runner: built.eb.groups[0].runner, needles: leakNeedles(o.mirror, c.base, c.merge, [c.fix]) });
  } catch (error) {
    if (error instanceof EbError && error.code === "E_EB_LEAK") return drop("leak", /class=(\S+)/.exec(error.message)?.[1] ?? "leak", error.message);
    throw error;
  }
  for (const n of needles) {
    const hits = scanImage(built.eb.image.id, n);
    if (!judge(n, hits).passes) return drop("body", "body_in_unit_image", { needle: n, hits });
  }
  return Object.assign(res, { step: "qualified" as const, reason: null });
}

/** The 3-run recount of a qualified unit in the frozen sandbox, under the planted rules. */
export function recount(res: Outcome, unitDir: string, work: string): Outcome {
  requireSandbox();
  process.env.EP_EVIDENCE_TAG = "recount";
  let row;
  try {
    row = recountUnit(unitDir, { work, planted: true, sandbox: SANDBOX, licences: FROZEN.frame.licences });
  } finally {
    delete process.env.EP_EVIDENCE_TAG;
  }
  keepEvidence(res.id, "recount.json", row);
  return row.clean ? { ...res, step: "clean", reason: null } : { ...res, step: "recount", reason: row.reason };
}

function gitIn(gitDir: string, args: string[], index?: string): string {
  const r = spawnSync("git", ["--git-dir", gitDir, ...args], { encoding: "utf8", maxBuffer: 1 << 30, env: { ...process.env, ...(index ? { GIT_INDEX_FILE: index } : {}) } });
  if (r.status !== 0) throw new Error("git " + args[0] + " failed: " + (r.stderr ?? "").slice(0, 200));
  return r.stdout;
}

/** A tree's diff from a base: the base as a directory, or, when it is null, the unit's base commit from its bundle. Build
 * outputs a tree's .gitignore names are left out, as git leaves them out. The dry run writes a fixture build's final.patch
 * with it. */
export function treeDiff(unitDir: string, baseTree: string | null, tree: string): string {
  const dir = mkdtempSync(join(tmpdir(), "ep-diff-"));
  const g = join(dir, "g.git");
  const snap = (work: string) => {
    const index = join(dir, "index-" + randomBytes(4).toString("hex"));
    gitIn(g, ["--work-tree", work, "add", "-A"], index);
    return gitIn(g, ["write-tree"], index).trim();
  };
  try {
    gitIn(g, ["init", "-q", "--bare"]);
    let a: string;
    if (baseTree) a = snap(baseTree);
    else {
      gitIn(g, ["fetch", "-q", join(unitDir, "environment/task.bundle"), "refs/heads/" + BASE_BRANCH + ":refs/heads/" + BASE_BRANCH]);
      a = gitIn(g, ["rev-parse", BASE_BRANCH + "^{tree}"]).trim();
    }
    return gitIn(g, ["diff", "--binary", "--full-index", "--no-renames", a, snap(tree)]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The PlantedGrader seam (types.ts). A build's tree is the session's output folder, and its final.patch (the build's diff
 * from B) is what both reads grade, as eng-build's grader does. */
export function plantedGrader(o: { work: string; runs?: number }): PlantedGrader {
  const runs = o.runs ?? FROZEN.runs;
  const patchOf = (tree: string) => readFileSync(join(tree, "final.patch"), "utf8");
  return {
    async grade(unit, unitDir, tree) {
      requireSandbox();
      const { eb, task } = readUnit(unitDir);
      const patch = patchOf(tree);
      const grid = (set: (typeof eb.sets)[number] | undefined, want: string[]) => (set && want.length ? gradeSet({ taskDir: unitDir, task, eb, set, label: "build", patch, runs, seed: eb.seed + 3000, work: o.work, want, crash: true, sandbox: SANDBOX }) : {});
      return {
        planted: caseRuns(grid(eb.sets.find((s) => s.role === "B"), unit.planted), unit.planted),
        functional: caseRuns(grid(eb.sets[0], unit.functional), unit.functional),
      };
    },
    async catchOf(_unit, unitDir, buildTree) {
      requireSandbox();
      const r = catchBuild({ unitDir, patch: patchOf(buildTree), work: o.work, runs, crash: true, sandbox: SANDBOX });
      const drop = r.drops[0]?.cls ?? (r.compiled < r.trees ? "own_tests_do_not_compile" : null);
      if (drop) return { catch: null, drop };
      const c = Object.values(r.catches)[0] ?? null;
      return { catch: c, drop: c === null ? "no_result" : null };
    },
  };
}
