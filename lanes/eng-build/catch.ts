// Copyright (c) 2026 Garry Tan. MIT License.
// Real-bug catch, a build-side secondary of the eng-review build read (prereg 2026-11-11-geva-522, sections 6 and 11).
// A build's own new and changed test files move onto the unit's real merged tree and its real fixed tree, with every
// product file at the real content. The move uses the pfchecks transplant (planTransplant) to split a file's test
// hunks from its product hunks, under the verifier's test-region rule: only a Rust inline test module's region moves,
// and a file the rule cannot split drops. A build catches a B item when one of its own cases fails at assertion level
// in every merged run and passes in every fixed run. A missing name or a compile error on the merged tree is not a
// catch: the test has to run against the real code and see the bug. The share of real trees on which the build's own
// tests compiled and ran prints beside it.
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { planTransplant, type Change } from "../outcome-skills/pfchecks/transplant.ts";
import { isProtected, type Lang } from "../outcome-skills/statemachines/langs.ts";
import { git, gitRun } from "../real-outcome/mine/git.ts";
import { inInstallDir, isRunnerConfigPath, isTestPath } from "../real-outcome/mine/paths.ts";
import { BASE_BRANCH } from "../real-outcome/task/format.ts";
import { classifyFile } from "../real-outcome/task/region.ts";
import { verifyTree } from "../real-outcome/task/verify.ts";
import { EbError } from "./errors.ts";
import { FROZEN } from "./frozen.ts";
import { ecoOfFile } from "./recipes.ts";
import type { CaseClass, Ecosystem } from "./types.ts";
import { buildUnit, EB_PROTECT, readUnit, scopesOf, targetOfFile, treeGrid, treePatch, type EbTask, type Grid, type UnitSpec } from "./unit.ts";

const EB_CONFIG = EB_PROTECT.map((p) => new RegExp(p));

/** A transplant the test-region rule or the real tree could not take: the case drops and is recorded. */
export interface TransplantDrop {
  code: "E_EB_TRANSPLANT";
  unit: string;
  step: string;
  cls: string;
}

/** A build's tree split for the transplant: its own test files, the Rust files whose test region it changed, and its
 * changed product files (paths only; their content stays real on the real trees). */
export interface BuildSplit {
  /** The build's tree: the unit's base with the build's patch applied, in a scratch git checkout. */
  dir: string;
  changes: Change[];
  tests: { path: string; text: string; group: number }[];
  regions: { path: string; text: string; group: number }[];
  product: { path: string; group: number | null }[];
  drops: TransplantDrop[];
  cleanup: () => void;
}

/** The test files a build may move: test code that is neither a runner or build config nor an installed dependency. */
export const movesWhole = (path: string): boolean => isTestPath(path) && !isRunnerConfigPath(path) && !isProtected(path) && !EB_CONFIG.some((re) => re.test(path)) && !inInstallDir(path);

const langOf = (eco: Ecosystem, path: string): Lang => (eco === "node" ? (/\.[cm]?tsx?$/.test(path) ? "ts" : "js") : eco);

/** The unit's runner group a file runs under: its ecosystem's group with the longest matching project dir. */
export function groupOf(eb: EbTask, path: string): number | null {
  const eco = ecoOfFile(path);
  let best: number | null = null;
  eb.groups.forEach((g, i) => {
    if (g.eco !== eco || !(g.projdir === "" || path.startsWith(g.projdir + "/"))) return;
    if (best === null || g.projdir.length > eb.groups[best].projdir.length) best = i;
  });
  return best;
}

/** Applies a build's patch to the unit's base (from the unit's own bundle) and splits its changes. */
export function splitBuild(unitDir: string, eb: EbTask, patch: string): BuildSplit {
  const scratch = mkdtempSync(join(tmpdir(), "eb-build-"));
  const dir = join(scratch, "repo");
  const cleanup = () => rmSync(scratch, { recursive: true, force: true });
  const out: BuildSplit = { dir, changes: [], tests: [], regions: [], product: [], drops: [], cleanup };
  try {
    git(scratch, ["clone", "-q", "--branch", BASE_BRANCH, join(unitDir, "environment/task.bundle"), dir]);
    writeFileSync(join(scratch, "build.patch"), patch);
    if (patch.trim()) {
      const applied = gitRun(dir, ["apply", "--whitespace=nowarn", join(scratch, "build.patch")]);
      if (applied.status !== 0) throw new EbError("E_EB_TRANSPLANT", eb.unit.id + " step=apply class=patch_does_not_apply: " + applied.stderr.trim().slice(0, 200));
    }
    git(dir, ["add", "-A"]);
    const parts = git(dir, ["diff", "--cached", "--name-status", "-z", "--no-renames", "HEAD"]).split("\0").filter(Boolean);
    for (let i = 0; i + 1 < parts.length; i += 2) out.changes.push({ status: parts[i][0] as Change["status"], path: parts[i + 1] });
    const tests = new Set(out.changes.filter((c) => c.status !== "D" && movesWhole(c.path)).map((c) => c.path));
    for (const c of out.changes) {
      if (c.status === "D" || inInstallDir(c.path)) continue;
      const group = groupOf(eb, c.path);
      if (!lstatSync(join(dir, c.path)).isFile()) {
        out.drops.push({ code: "E_EB_TRANSPLANT", unit: eb.unit.id, step: "split:" + c.path, cls: "not_a_regular_file" });
        continue;
      }
      const text = readFileSync(join(dir, c.path), "utf8");
      if (tests.has(c.path)) {
        if (group !== null) out.tests.push({ path: c.path, text, group });
        else out.drops.push({ code: "E_EB_TRANSPLANT", unit: eb.unit.id, step: "split:" + c.path, cls: "no_runner_group" });
        continue;
      }
      const eco = ecoOfFile(c.path);
      if (!eco || isProtected(c.path) || isRunnerConfigPath(c.path) || EB_CONFIG.some((re) => re.test(c.path))) continue;
      if (c.status === "A") {
        out.product.push({ path: c.path, group });
        continue;
      }
      let plan;
      try {
        plan = planTransplant(langOf(eco as Ecosystem, c.path), tests, [c], (p) => ({ base: git(dir, ["show", "HEAD:" + p]), diff: git(dir, ["diff", "--cached", "--no-renames", "HEAD", "--", p]) }));
      } catch {
        out.drops.push({ code: "E_EB_TRANSPLANT", unit: eb.unit.id, step: "split:" + c.path, cls: "hunks_do_not_apply" });
        continue;
      }
      if (plan.product_files.includes(c.path)) out.product.push({ path: c.path, group });
      const cls = classifyFile(c.path, text);
      if (cls.kind === "mixed") {
        out.drops.push({ code: "E_EB_TRANSPLANT", unit: eb.unit.id, step: "region:" + c.path, cls: cls.why });
        continue;
      }
      if (plan.kept_test_hunks === 0 && plan.mixed_hunks === 0) continue;
      if (cls.kind !== "region" || group === null) {
        out.drops.push({ code: "E_EB_TRANSPLANT", unit: eb.unit.id, step: "region:" + c.path, cls: group === null ? "no_runner_group" : "no_test_region" });
        continue;
      }
      out.regions.push({ path: c.path, text, group });
    }
    return out;
  } catch (error) {
    cleanup();
    throw error;
  }
}

/** A restore set for one real tree: the unit's own set, with the build's test files and test regions laid over it. */
function overlaySet(unitDir: string, setDir: string, to: string, split: BuildSplit): void {
  rmSync(to, { recursive: true, force: true });
  cpSync(join(unitDir, setDir), to, { recursive: true });
  const listed = (name: string) => (existsSync(join(to, name)) ? readFileSync(join(to, name), "utf8").split("\n").filter(Boolean) : []);
  const put = (sub: string, f: { path: string; text: string }) => {
    mkdirSync(dirname(join(to, sub, f.path)), { recursive: true });
    writeFileSync(join(to, sub, f.path), f.text);
  };
  for (const f of split.tests) put("restore", f);
  for (const f of split.regions) put("regions", f);
  const restore = [...new Set([...listed("restore.list"), ...split.tests.map((f) => f.path)])].sort();
  writeFileSync(join(to, "restore.list"), restore.join("\n") + (restore.length ? "\n" : ""));
  const regions = [...new Set([...listed("regions.list"), ...split.regions.map((f) => f.path)])].sort();
  writeFileSync(join(to, "regions.list"), regions.join("\n") + (regions.length ? "\n" : ""));
}

/** Whether a build's own cases catch a bug: some case fails at assertion level in every merged run and passes in every
 * fixed run, with all runs present. */
export function caught(merged: Grid, fixed: Grid, runs: number): boolean {
  return Object.keys(merged).some((id) => merged[id].length === runs && merged[id].every((c) => c === "assert") && fixed[id]?.length === runs && fixed[id].every((c) => c === "pass"));
}

/** Whether the build's own tests compiled and ran on a tree: some own case reached a result in every run. */
const RAN: CaseClass[] = ["pass", "assert", "missing_name"];
export const compiledOn = (grid: Grid, runs: number): boolean =>
  Array.from({ length: runs }, (_, i) => i).every((i) => Object.values(grid).some((r) => RAN.includes(r[i])));

export interface CatchResult {
  /** Per B item: true when the build caught it, false when not (a build with no tests of its own catches nothing), null
   * when its transplant dropped and no own test was left to read. */
  catches: Record<string, boolean | null>;
  /** Real trees the build's own tests were placed on, and how many of them they compiled and ran on. */
  trees: number;
  compiled: number;
  /** The build's own case ids seen on the real trees. */
  cases: string[];
  drops: TransplantDrop[];
}

export interface CatchOptions {
  unitDir: string;
  /** The build's diff from the unit's base. */
  patch: string;
  work: string;
  runs?: number;
  seed?: number;
  cpus?: number;
}

/** Real-bug catch for one build on one unit. */
export function catchBuild(o: CatchOptions): CatchResult {
  const { eb, task } = readUnit(o.unitDir);
  const runs = o.runs ?? FROZEN.runs;
  const items = eb.unit.aftermath.map((a) => a.item);
  const result: CatchResult = { catches: Object.fromEntries(items.map((i) => [i, null])), trees: 0, compiled: 0, cases: [], drops: [] };
  let split: BuildSplit;
  try {
    split = splitBuild(o.unitDir, eb, o.patch);
  } catch (error) {
    if (!(error instanceof EbError) || error.code !== "E_EB_TRANSPLANT") throw error;
    result.drops.push({ code: "E_EB_TRANSPLANT", unit: eb.unit.id, step: "apply", cls: "patch_does_not_apply" });
    return result;
  }
  try {
    result.drops.push(...split.drops);
    const groups = [...new Set([...split.tests, ...split.regions].map((f) => f.group))].sort();
    if (groups.length === 0) {
      if (split.drops.length === 0) for (const i of items) result.catches[i] = false;
      return result;
    }
    const seen = new Set<string>();
    const grade = (label: string, setDir: string): Grid | null => {
      const patchFile = join(o.unitDir, treePatch(label));
      if (!existsSync(patchFile)) {
        result.drops.push({ code: "E_EB_TRANSPLANT", unit: eb.unit.id, step: label, cls: "no_real_tree" });
        return null;
      }
      const tag = label.replace(/[^A-Za-z0-9._-]/g, "_");
      const set = join(o.work, "catch-" + tag + "-set");
      overlaySet(o.unitDir, setDir, set, split);
      const grid: Grid = {};
      for (const gi of groups) {
        const g = eb.groups[gi];
        const files = [...split.tests, ...split.regions].filter((f) => f.group === gi);
        const scopes = files.flatMap((f) => scopesOf(g.runner, f.path, f.text, g.projdir));
        let why: string | null = null;
        let tree;
        try {
          tree = verifyTree({
            taskDir: o.unitDir,
            task: { ...task, runner: g.runner },
            image: eb.image.id,
            label: "catch-" + tag + "-" + gi,
            patch: readFileSync(patchFile, "utf8"),
            runs,
            seed: o.seed ?? eb.seed + 2000,
            work: o.work,
            cpus: o.cpus,
            testsDir: set,
            ids: [...new Set(files.map((f) => targetOfFile(g.runner, f.path, g.projdir)))].sort(),
            cold: true,
            beforeRuns: (p) => {
              if (p.patch !== "failed" && p.cold && p.cold.changed.length > 0) throw new EbError("E_EB_TRANSPLANT", "product_changed");
            },
          });
          if (tree.prepare.patch === "failed") why = "real_tree_patch_failed";
        } catch (error) {
          if (error instanceof EbError && error.code === "E_EB_TRANSPLANT") why = error.message;
          else if (error instanceof Error && /test region/.test(error.message)) why = "region_not_placed";
          else throw error;
        }
        if (why || !tree) {
          result.drops.push({ code: "E_EB_TRANSPLANT", unit: eb.unit.id, step: label + "#" + gi, cls: why ?? "no_result" });
          return null;
        }
        for (const [id, r] of Object.entries(treeGrid(tree, g.runner.kind, scopes))) {
          grid[id] = r;
          seen.add(id);
        }
      }
      result.trees++;
      if (compiledOn(grid, runs)) result.compiled++;
      return grid;
    };
    const merged = grade("merged", eb.sets[0].dir);
    for (const a of eb.unit.aftermath) {
      const set = eb.sets.find((s) => s.item === a.item);
      if (!merged || !set) continue;
      const fixed = grade("fix:" + a.item, set.dir);
      if (fixed) result.catches[a.item] = caught(merged, fixed, runs);
    }
    result.cases = [...seen].sort();
    return result;
  } finally {
    split.cleanup();
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// The dry run's seams "transplant catch" and "transplant no-catch": a Go unit built from a synthetic repository, and a
// build whose own test is red in every merged run, or red only in the runs where go test's shuffle puts it before the
// test it depends on.

const SEAM_CALC = "package calc\n\nfunc Add(a, b int) int {\n\treturn a + b\n}\n";
const SEAM_BUGGY = "\nfunc Mul(a, b int) int {\n\tif a == 0 {\n\t\treturn b\n\t}\n\treturn a * b\n}\n";
const SEAM_FIXED = "\nfunc Mul(a, b int) int {\n\treturn a * b\n}\n";
const seamTest = (names: string[]) => "package calc\n\nimport \"testing\"\n" + names.map((n) => "\nfunc " + n + "(t *testing.T) {\n\tif " + ({ TestAdd: "Add(1, 2) != 3", TestMul: "Mul(2, 3) != 6", TestMulZero: "Mul(0, 5) != 0" } as Record<string, string>)[n] + " {\n\t\tt.Fatal(\"" + n + "\")\n\t}\n}\n").join("");
/** The build's own test: red on the merge's Mul(0, 5); with flaky, red only when it runs before TestBuildMark. */
const seamBuildTest = (flaky: boolean) =>
  "package calc\n\nimport \"testing\"\n\nvar marked bool\n\nfunc TestBuildMark(t *testing.T) { marked = true }\n\nfunc TestBuildZero(t *testing.T) {\n\tif " + (flaky ? "!marked && " : "") + "Mul(0, 5) != 0 {\n\t\tt.Fatal(\"zero\")\n\t}\n}\n";
/** go test -shuffle seeds 2, 3 and 4 put TestBuildZero before TestBuildMark in runs 1 and 3 only (checked on Go 1.23). */
export const SEAM_FLAKY_SEED = 2;
export const SEAM_GO_IMAGE = "golang:1.23-bookworm@sha256:167053a2bb901972bf2c1611f8f52c44d5fe7e762e5cab213708d82c421614db";

function seamCommit(repo: string, files: Record<string, string>, message: string, day: number): string {
  for (const [p, t] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, p)), { recursive: true });
    writeFileSync(join(repo, p), t);
  }
  git(repo, ["add", "-A"]);
  const when = "2026-03-0" + day + "T00:00:00Z";
  const r = gitRun(repo, ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-q", "-m", message], undefined);
  if (r.status !== 0) throw new Error("seam fixture commit failed: " + r.stderr);
  git(repo, ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-q", "--amend", "--no-edit", "--date", when]);
  return git(repo, ["rev-parse", "HEAD"]).trim();
}

let seamUnit: { root: string; unitDir: string; repo: string; base: string } | null = null;

/** The seams' Go unit, built once per process in a scratch directory. */
export function seamGoUnit(): { root: string; unitDir: string; repo: string; base: string } {
  if (seamUnit && existsSync(join(seamUnit.unitDir, "eb.json"))) return seamUnit;
  const root = mkdtempSync(join(tmpdir(), "eb-catch-seam-"));
  const repo = join(root, "repo");
  mkdirSync(repo, { recursive: true });
  git(repo, ["init", "-q", "-b", "main"]);
  const license = "MIT License\n\nCopyright (c) 2026 Fixture Authors\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software.\n";
  const base = seamCommit(repo, { LICENSE: license, "go.mod": "module example.invalid/calc\n\ngo 1.23\n", "calc.go": SEAM_CALC, "calc_test.go": seamTest(["TestAdd"]) }, "base", 1);
  const merge = seamCommit(repo, { "calc.go": SEAM_CALC + SEAM_BUGGY, "calc_test.go": seamTest(["TestAdd", "TestMul"]) }, "add Mul", 2);
  const fix = seamCommit(repo, { "calc.go": SEAM_CALC + SEAM_FIXED, "calc_test.go": seamTest(["TestAdd", "TestMul", "TestMulZero"]) }, "fix Mul of zero", 3);
  const spec: UnitSpec = { id: "ebcatchseam", repo: "fixture/ebcatch-seam", set: "comparison", type: "devtools", keying: "first", mergedMonth: "2026-03", strictWindow: true, licence: "MIT", trust: "fixture", base, merge, items: [{ item: "B1", kind: "B", commit: fix, mentioned: false, generic: false, foreseeable: "maybe" }], images: { "golang:1.23": SEAM_GO_IMAGE } };
  const out = buildUnit(spec, repo, join(root, "unit"), { work: join(root, "work"), labels: join(root, "labels.json"), seed: 7 });
  if (!out.qualifies) throw new EbError("E_EB_IMAGE", "the catch seam's Go unit did not qualify: " + JSON.stringify(out.drop));
  seamUnit = { root, unitDir: out.dir, repo, base };
  return seamUnit;
}

/** The seams' build: Mul fixed, and its own test file (red on the merge's Mul, or red only when shuffled first). */
export function seamBuildPatch(flaky: boolean): string {
  const u = seamGoUnit();
  const branch = "seam-build-" + (flaky ? "flaky" : "red");
  git(u.repo, ["checkout", "-q", "-B", branch, u.base]);
  writeFileSync(join(u.repo, "calc.go"), SEAM_CALC + SEAM_FIXED);
  writeFileSync(join(u.repo, "calc_build_test.go"), seamBuildTest(flaky));
  git(u.repo, ["add", "-A"]);
  const patch = git(u.repo, ["diff", "--cached", "--binary", "--full-index", "--no-renames", u.base]);
  git(u.repo, ["reset", "-q", "--hard", u.base]);
  return patch;
}

const seamWord = (flaky: boolean): string => {
  const u = seamGoUnit();
  const r = catchBuild({ unitDir: u.unitDir, patch: seamBuildPatch(flaky), work: join(u.root, "work-catch-" + (flaky ? "flaky" : "red")), seed: SEAM_FLAKY_SEED });
  const c = r.catches.B1;
  return c === true ? "catch" : c === false ? "no catch" : "dropped " + r.drops.map((d) => d.step + ":" + d.cls).join(",");
};

/** The dry run's "transplant catch" seam: a build test red in 3 merged runs and green in 3 fixed runs reads "catch". */
export async function seamTransplantCatch(): Promise<string> {
  return seamWord(false);
}

/** The dry run's "transplant no-catch" seam: a build test red in 2 of 3 merged runs reads "no catch". */
export async function seamTransplantNoCatch(): Promise<string> {
  return seamWord(true);
}

/** Removes the seams' scratch unit and its image. */
export function seamCleanup(): void {
  if (!seamUnit) return;
  rmSync(seamUnit.root, { recursive: true, force: true });
  seamUnit = null;
}
