// Copyright (c) 2026 Garry Tan. MIT License.
// The build-unit builder of the eng-review build read (plan section 3). From a keyed first-attempt unit and a full local
// clone it writes a sealed task directory in the real-outcome format (lanes/real-outcome/task/SPEC.md) extended with
// the aftermath group, builds the unit's image, and runs the verifier on the real trees to find the cases: functional
// cases from the merge's own tests, and for each primary B item the aftermath cases of its later fix, by the 3-run rule
// and the attribution rule, with anchors, T cases and the base split. Only test code moves into a graded tree (the
// test-region rule), and every graded tree's product file hashes are recorded and checked. The builder reads git objects
// only; the repository's code runs only inside the verifier's containers.
import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { git, gitRun, showFile } from "../real-outcome/mine/git.ts";
import { INSTALL_DIRS, isProtectedPath } from "../real-outcome/mine/paths.ts";
import { docker } from "../real-outcome/task/docker.ts";
import { BASE_BRANCH, detectLicence, fileDigests, LICENCES, PROTECT_ERE, REPO_DIR, renderTaskToml, SCHEMA, sha256, SOLVE_SH, VERIFIER_DIR, type Runner, type TaskJson } from "../real-outcome/task/format.ts";
import { classifyFile, regionText } from "../real-outcome/task/region.ts";
import { verifyTree, type TreeResult } from "../real-outcome/task/verify.ts";
import type { ReasonCode } from "../../src/errors/codes.ts";
import { EbError, fail } from "./errors.ts";
import { FROZEN } from "./frozen.ts";
import { ecoOfFile, findProject, hasRecipe, isDepFile, recipeFor, runClasses, runnable, verifierRunner, type Recipe } from "./recipes.ts";
import type { AftermathItem, BuildUnit, CaseClass, CaseRuns, Ecosystem, UnitSet, UnitType } from "./types.ts";

export const EB_SCHEMA = "eng-build.unit.v1";

/** Runner configs a tree must not swap, beside the real-outcome lane's protected paths: they are deleted when gold
 * lacks them and restored from gold, so the hidden run reads gold's. */
export const EB_PROTECT = ["(^|/)(jest|vitest)\\.config\\.[cm]?[jt]s$", "(^|/)vitest\\.workspace\\.[cm]?[jt]s$", "(^|/)\\.mocharc\\.(js|cjs|mjs|json|jsonc|ya?ml)$", "(^|/)\\.cargo/config(\\.toml)?$"];
export const EB_PROTECT_ERE = PROTECT_ERE + EB_PROTECT.join("\n") + "\n";
const EB_RES = EB_PROTECT.map((p) => new RegExp(p));
/** A path the eng-build restore sets protect. */
export const ebProtected = (path: string): boolean => isProtectedPath(path) || EB_RES.some((re) => re.test(path));

/** The verifier's own files every restore set carries, copied from lanes/real-outcome/task/verifier/. */
export const SET_FILES = ["prepare.sh", "vrun.py", "cold.sh", "node-reporter.mjs", "vitest.none.cjs", "vitest.none.mjs"];

export interface ItemSpec {
  item: string;
  /** B: a bug the later fix shows. T: a test-only follow-up, scored only as compatibility. */
  kind: "B" | "T";
  /** The fix commit (or the follow-up commit for a T item). */
  commit: string;
  mentioned: boolean;
  generic: boolean;
  foreseeable: AftermathItem["foreseeable"];
}

/** A keyed first-attempt unit, as the builder reads it (held under custody, never committed). */
export interface UnitSpec {
  id: string;
  /** owner/name: read for attribution and the leak check, never written into the BuildUnit. */
  repo: string;
  set: UnitSet;
  type: UnitType;
  keying: BuildUnit["keying"];
  mergedMonth: string;
  strictWindow: boolean;
  licence: string;
  /** Copyleft units are allowed only under custody (#276 section 17). */
  custody?: boolean;
  trust: "fixture" | "upstream";
  base: string;
  merge: string;
  items: ItemSpec[];
  /** Base images by tag, pinned by digest (name@sha256:...). A recipe's tag must appear here. */
  images: Record<string, string>;
  limits?: Partial<TaskJson["limits"]>;
}

/** One runner group of a set: the ids it may read are the ones in scope. */
export interface SetGroup {
  group: number;
  targets: string[];
  scopes: string[];
}

export interface RestoreSet {
  /** Directory relative to the task directory, laid out like tests/. */
  dir: string;
  role: "functional" | "base" | "B" | "T";
  item: string | null;
  groups: SetGroup[];
}

export interface Drop {
  code: ReasonCode;
  step: string;
  cls: string;
  cases: number;
}

/** eb.json: the build unit and everything the verifier needs to grade a tree against it. */
export interface EbTask {
  schema: typeof EB_SCHEMA;
  unit: BuildUnit;
  image: { tag: string; id: string };
  groups: { eco: Ecosystem; root: string; projdir: string; runner: Runner }[];
  sets: RestoreSet[];
  /** Product file hashes by tree label, then by set dir. */
  trees: Record<string, Record<string, Record<string, string>>>;
  drops: Drop[];
  seed: number;
}

const diff = (repo: string, a: string, b: string, paths: string[] = []): string => git(repo, ["diff", "--binary", "--full-index", "--no-renames", "--no-ext-diff", "--no-textconv", a, b, ...(paths.length ? ["--", ...paths] : [])]);

/** Blobs of a tree: path to object id, regular files only. */
export function listing(repo: string, rev: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const entry of git(repo, ["ls-tree", "-r", "-z", "--full-tree", rev]).split("\0").filter(Boolean)) {
    const [meta, path] = entry.split("\t");
    const [mode, type, sha] = meta.split(" ");
    if (type === "blob" && (mode === "100644" || mode === "100755")) out.set(path, sha);
  }
  return out;
}

/** Files a commit range changes: path to status letter. */
export function changed(repo: string, a: string, b: string): Map<string, string> {
  const out = new Map<string, string>();
  const parts = git(repo, ["diff", "--name-status", "-z", "--no-renames", a, b]).split("\0").filter(Boolean);
  for (let i = 0; i + 1 < parts.length; i += 2) out.set(parts[i + 1], parts[i][0]);
  return out;
}

const blob = (repo: string, oid: string): Buffer => Bun.spawnSync(["git", "cat-file", "blob", oid], { cwd: repo }).stdout as Buffer;
const inInstall = (p: string): boolean => p.split("/").some((x) => INSTALL_DIRS.includes(x));

/** What a range's changed files hold under the test-region rule: whole test files, files with a movable test region,
 * and mixed files whose cases drop. */
export function testChanges(repo: string, a: string, b: string): { whole: string[]; regions: string[]; mixed: { path: string; why: string }[]; deleted: string[] } {
  const whole: string[] = [];
  const regions: string[] = [];
  const mixed: { path: string; why: string }[] = [];
  const deleted: string[] = [];
  for (const [path, st] of changed(repo, a, b)) {
    if (inInstall(path)) continue;
    if (ebProtected(path)) {
      (st === "D" ? deleted : whole).push(path);
      continue;
    }
    if (st === "D") continue;
    const text = showFile(repo, b, path);
    if (text === null) continue;
    const c = classifyFile(path, text);
    if (c.kind === "region") regions.push(path);
    else if (c.kind === "mixed") mixed.push({ path, why: c.why });
  }
  return { whole: whole.sort(), regions: regions.sort(), mixed, deleted: deleted.sort() };
}

/** Writes one restore set: the protected files of a tree (gold's whole test tree and runner configs), overlaid with a
 * later commit's test changes, and the region sources whose test modules move. */
export function writeSet(repo: string, dir: string, tree: string, overlay: { rev: string; whole: string[]; deleted: string[]; regions: string[] } | null, regions: { rev: string; paths: string[] }[]): void {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, "restore"), { recursive: true });
  const files = new Map<string, string>();
  for (const [p, oid] of listing(repo, tree)) if (ebProtected(p) && !inInstall(p)) files.set(p, oid);
  if (overlay) {
    const at = listing(repo, overlay.rev);
    for (const p of overlay.deleted) files.delete(p);
    for (const p of overlay.whole) if (at.has(p)) files.set(p, at.get(p)!);
  }
  const list = [...files.keys()].sort();
  for (const p of list) {
    mkdirSync(dirname(join(dir, "restore", p)), { recursive: true });
    writeFileSync(join(dir, "restore", p), blob(repo, files.get(p)!));
  }
  writeFileSync(join(dir, "restore.list"), list.join("\n") + (list.length ? "\n" : ""));
  writeFileSync(join(dir, "protect.ere"), EB_PROTECT_ERE);
  const moved = new Map<string, string>();
  for (const r of regions) for (const p of r.paths) moved.set(p, showFile(repo, r.rev, p)!);
  for (const [p, text] of moved) {
    mkdirSync(dirname(join(dir, "regions", p)), { recursive: true });
    writeFileSync(join(dir, "regions", p), text);
  }
  writeFileSync(join(dir, "regions.list"), [...moved.keys()].sort().join("\n") + (moved.size ? "\n" : ""));
  for (const f of SET_FILES) copyFileSync(join(VERIFIER_DIR, f), join(dir, f));
}

/** A Rust source file's module path in its crate: src/a/b.rs and src/a/b/mod.rs are a::b, the crate roots are empty. */
export function rustModule(projdir: string, path: string): { target: string; module: string } {
  const rel = projdir && path.startsWith(projdir + "/") ? path.slice(projdir.length + 1) : path;
  const prefix = projdir ? projdir + "/" : "";
  const parts = rel.replace(/\.rs$/, "").split("/");
  if (parts[0] !== "src") return { target: path, module: "" };
  const mods = parts.slice(1);
  if (mods.at(-1) === "mod") mods.pop();
  const root = mods.length === 1 && (mods[0] === "lib" || mods[0] === "main") ? mods.pop()! : null;
  return { target: prefix + "src/" + (root ?? "lib") + ".rs", module: mods.join("::") };
}

/** The scope of a test file or region file for a runner: ids in scope start with it (Go: name exactly). */
export function scopesOf(runner: Runner, path: string, text: string, projdir: string): string[] {
  if (runner.kind === "go") {
    const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ".";
    return [...text.matchAll(/^func\s+(Test\w*)\s*\(\s*\w+\s+\*testing\.T\s*\)/gm)].map((m) => dir + "::" + m[1]);
  }
  if (runner.kind !== "cargo") return [path + "::"];
  if (!path.endsWith(".rs") || (projdir ? path.slice(projdir.length + 1) : path).startsWith("tests/")) return [path + "::"];
  const region = regionText(path, text);
  const mod = region ? /mod\s+(\w+)/.exec(region)?.[1] : null;
  if (!mod) return [];
  const m = rustModule(projdir, path);
  return [m.target + "::" + (m.module ? m.module + "::" : "") + mod + "::"];
}

/** The runner target a file runs under: the file, its package dir for Go, its crate root for a Rust source file. */
export function targetOfFile(runner: Runner, path: string, projdir: string): string {
  if (runner.kind === "go") return path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ".";
  if (runner.kind === "cargo" && !(projdir ? path.slice(projdir.length + 1) : path).startsWith("tests/")) return rustModule(projdir, path).target;
  return path;
}

/** A Go subtest: a "/" in the test name after "::", never in the package path before it. */
export const goSubtest = (id: string): boolean => id.slice(id.indexOf("::") + 2).includes("/");

export const inScope = (runner: Runner["kind"], id: string, scopes: string[]): boolean =>
  !id.startsWith("collect:") && (runner === "go" ? scopes.includes(id) : scopes.some((s) => id.startsWith(s)));

/** Whether the fix's product changes touch lines the merge added or changed: git blame at the fix's parent, over the
 * lines each product hunk removes or changes, or the lines beside an insertion, names a commit of the change (base..merge).
 * Lines inside a file's test region, and protected paths, are not product. */
export function attributed(repo: string, base: string, merge: string, fix: string): { touched: number; ofChange: number } {
  const ours = new Set(git(repo, ["rev-list", base + ".." + merge]).split("\n").filter(Boolean));
  const parent = git(repo, ["rev-parse", fix + "^1"]).trim();
  let touched = 0;
  let ofChange = 0;
  for (const [path, st] of changed(repo, parent, fix)) {
    if (st === "A" || ebProtected(path) || inInstall(path)) continue;
    const before = showFile(repo, parent, path);
    if (before === null) continue;
    const c = classifyFile(path, before);
    const lineOf = (off: number) => before.slice(0, off).split("\n").length;
    const region = c.kind === "region" ? [lineOf(c.start), lineOf(c.end)] : null;
    const total = before.split("\n").length - (before.endsWith("\n") ? 1 : 0);
    const lines = new Set<number>();
    for (const h of git(repo, ["diff", "-U0", "--no-renames", parent, fix, "--", path]).matchAll(/^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/gm)) {
      const a = Number(h[1]);
      const n = h[2] === undefined ? 1 : Number(h[2]);
      if (n > 0) for (let i = a; i < a + n; i++) lines.add(i);
      else for (const i of [a, a + 1]) lines.add(i);
    }
    for (const l of lines) {
      if (l < 1 || l > total || (region && l >= region[0] && l <= region[1])) continue;
      touched++;
      const b = gitRun(repo, ["blame", "--porcelain", "-L", l + "," + l, parent, "--", path]);
      const sha = b.status === 0 ? b.stdout.split(" ")[0] : "";
      if (ours.has(sha)) ofChange++;
    }
  }
  return { touched, ofChange };
}

/** Every run's class of every case, across the trees a rule reads. */
export type Grid = Record<string, CaseClass[]>;

const all = (runs: CaseClass[] | undefined, c: CaseClass): boolean => !!runs && runs.length > 0 && runs.every((r) => r === c);

/** The 3-run rule: an aftermath case fails at assertion level in every run on the merged tree and on the fix's parent
 * with the fix's tests in place, and passes in every run on the fix. */
export const aftermathCases = (merged: Grid, parent: Grid, fixed: Grid, runs: number): string[] =>
  Object.keys(fixed)
    .filter((id) => [merged[id], parent[id]].every((g) => all(g, "assert") && g!.length === runs) && all(fixed[id], "pass") && fixed[id].length === runs)
    .sort();

/** Anchors: cases in the same fix test files that pass in every run on the merged tree and on the fix. */
export const anchorCases = (merged: Grid, fixed: Grid, runs: number): string[] => Object.keys(fixed).filter((id) => all(merged[id], "pass") && merged[id].length === runs && all(fixed[id], "pass") && fixed[id].length === runs).sort();

/** A case's outcome on base with the fix's tests in place, by the most common of pass, fail and no result over the runs
 * (a tie reads fail). Descriptive only. */
export function baseOutcome(runs: CaseClass[] | undefined): "pass" | "fail" | "no_result" {
  const n = { pass: 0, fail: 0, no_result: 0 };
  for (const r of runs ?? []) n[r === "pass" ? "pass" : r === "no_result" || r === "timeout" ? "no_result" : "fail"]++;
  if (n.pass > n.fail && n.pass > n.no_result) return "pass";
  if (n.no_result > n.fail && n.no_result > n.pass) return "no_result";
  return (runs ?? []).length === 0 ? "no_result" : "fail";
}

/** A repository's label: minted from random bytes the first time the build sees the repository, never derived from
 * its name, and kept in a custody file so every unit of a repository shares it. */
export function repoLabel(file: string, repo: string): string {
  const labels: Record<string, string> = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  if (!labels[repo]) {
    labels[repo] = "r" + randomBytes(6).toString("hex");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(labels, null, 2) + "\n", { mode: 0o600 });
  }
  return labels[repo];
}

/** The unit image's Dockerfile: the pinned base image, the toolchains of any further ecosystem copied from their pinned
 * images, the base-only bundle, each group's frozen install (with per-unit caches inside the build, removed with it)
 * and .git rebuilt from the bundle. */
export function renderEbDockerfile(o: { from: string; addons: { eco: Ecosystem; from: string }[]; installs: { root: string; env: Record<string, string>; command: string }[]; merged?: { atBase: string[]; added: string[] } }): string {
  const lines = ["# syntax=docker/dockerfile:1", "# Generated by gstack-evals eb (lanes/eng-build/unit.ts). Do not edit.", "FROM " + o.from];
  for (const a of o.addons) {
    if (a.eco === "rust") lines.push("COPY --from=" + a.from + " /usr/local/rustup /usr/local/rustup", "COPY --from=" + a.from + " /usr/local/cargo /usr/local/cargo", "ENV RUSTUP_HOME=/usr/local/rustup CARGO_HOME=/usr/local/cargo PATH=/usr/local/cargo/bin:$PATH");
    if (a.eco === "node") lines.push("COPY --from=" + a.from + " /usr/local/bin/node /usr/local/bin/node", "COPY --from=" + a.from + " /usr/local/lib/node_modules /usr/local/lib/node_modules", "RUN ln -sf ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm && ln -sf ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx && ln -sf ../lib/node_modules/corepack/dist/corepack.js /usr/local/bin/corepack");
  }
  lines.push("RUN --mount=type=bind,source=task.bundle,target=/mnt/task.bundle git clone -q --branch " + BASE_BRANCH + " /mnt/task.bundle " + REPO_DIR);
  lines.push("WORKDIR " + REPO_DIR);
  for (const i of o.installs) {
    const env = Object.entries(i.env).map(([k, v]) => k + "=" + JSON.stringify(v)).join(" ");
    lines.push("RUN cd " + [REPO_DIR, i.root].filter(Boolean).join("/") + " && export " + env + " && (" + i.command + ") && rm -rf /opt/eb-cache");
  }
  if (o.merged && o.merged.atBase.length + o.merged.added.length > 0) {
    const q = (p: string) => JSON.stringify(p);
    const again = o.installs.map((i) => "(cd " + [REPO_DIR, i.root].filter(Boolean).join("/") + " && export " + Object.entries(i.env).map(([k, v]) => k + "=" + JSON.stringify(v)).join(" ") + " && (" + i.command + ") && rm -rf /opt/eb-cache)");
    const restore = o.merged.atBase.length ? "git checkout -q -- " + o.merged.atBase.map(q).join(" ") : "true";
    const remove = o.merged.added.length ? "rm -f -- " + o.merged.added.map(q).join(" ") : "true";
    lines.push("RUN --mount=type=bind,source=merged-deps,target=/mnt/md cd " + REPO_DIR + " && cp -a /mnt/md/. ./ && " + again.join(" && ") + " && cd " + REPO_DIR + " && " + restore + " && " + remove);
  }
  const rebuild = ["rm -rf .git", "git init -q -b " + BASE_BRANCH, "git fetch -q --update-head-ok /mnt/task.bundle 'refs/heads/*:refs/heads/*'", "git reset -q", "rm -rf .git/logs .git/FETCH_HEAD .git/ORIG_HEAD", "git gc -q --prune=now"];
  lines.push("RUN --mount=type=bind,source=task.bundle,target=/mnt/task.bundle " + rebuild.join(" && "));
  return lines.join("\n") + "\n";
}

/** A recipe's install environment inside the unit image: caches move under /opt/eb-cache, which the same step removes;
 * Go's module cache and the Python venv stay, because they are the installed dependencies. */
export function imageEnv(recipe: Recipe): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(recipe.env)) {
    if (k === "GOMODCACHE") continue;
    env[k] = v.replace(/^\/cache\//, "/opt/eb-cache/").replace(/^\/target$/, "/opt/eb-cache/target");
  }
  return env;
}

/** gold's pytest config, as the real-outcome builder finds it. */
const PYTEST_CONFIGS: [string, RegExp][] = [
  ["pytest.ini", /^/],
  [".pytest.ini", /^/],
  ["pyproject.toml", /^\[tool\.pytest\.ini_options\]/m],
  ["tox.ini", /^\[pytest\]/m],
  ["setup.cfg", /^\[tool:pytest\]/m],
];

const LICENCE_FILES = ["LICENSE", "LICENSE.md", "LICENSE.txt", "LICENCE", "LICENCE.md", "COPYING"];

export interface BuildOptions {
  /** Scratch directory for verifier runs. */
  work: string;
  /** The custody file of repository labels. */
  labels: string;
  runs?: number;
  seed?: number;
  cpus?: number;
}

export interface BuildOutcome {
  dir: string;
  eb: EbTask;
  qualifies: boolean;
  /** Why it does not qualify: a reason code with its step and class. */
  drop: Drop | null;
}

const reject = (code: ReasonCode, unit: string, step: string, cls: string): never => fail(code, unit + " step=" + step + " class=" + cls);

/** The test files a range changes that a recipe runs, grouped by ecosystem, install root and project dir. */
function groupsOf(unit: string, repo: string, rev: string, files: string[], noRecipe: Set<string>): Map<string, { eco: Ecosystem; root: string; projdir: string; files: string[] }> {
  const names = new Set(listing(repo, rev).keys());
  const groups = new Map<string, { eco: Ecosystem; root: string; projdir: string; files: string[] }>();
  for (const f of files) {
    const eco = ecoOfFile(f);
    if (eco === null) continue;
    if (!hasRecipe(eco)) {
      noRecipe.add(eco);
      continue;
    }
    if (!runnable(eco, f)) continue;
    const p = findProject(eco, f, names);
    if (!p) continue;
    const key = eco + "|" + p.root + "|" + p.projdir;
    if (!groups.has(key)) groups.set(key, { eco, root: p.root, projdir: p.projdir, files: [] });
    groups.get(key)!.files.push(f);
  }
  return groups;
}

/** Builds a unit's task directory and image, then derives its cases on the real trees in the verifier. */
export function buildUnit(spec: UnitSpec, repo: string, out: string, o: BuildOptions): BuildOutcome {
  const runs = o.runs ?? FROZEN.runs;
  const seed = o.seed ?? randomBytes(4).readUInt32BE(0);
  const id = spec.id;
  const commit = (rev: string) => git(repo, ["rev-parse", "--verify", rev + "^{commit}"]).trim();
  const base = commit(spec.base);
  const merge = commit(spec.merge);
  const items = spec.items.map((i) => ({ ...i, commit: commit(i.commit), parent: commit(i.commit + "^1") }));
  if (!LICENCES.includes(spec.licence) && !spec.custody) reject("E_EB_IMAGE", id, "licence", "copyleft_without_custody");
  const licenceFile = LICENCE_FILES.find((f) => showFile(repo, base, f) !== null);
  if (!licenceFile) reject("E_EB_IMAGE", id, "licence", "no_licence_file");
  const licenceText = showFile(repo, base, licenceFile!)!;
  if (LICENCES.includes(spec.licence) && detectLicence(licenceText) !== spec.licence) reject("E_EB_IMAGE", id, "licence", "licence_mismatch");

  const own = testChanges(repo, base, merge);
  const noRecipe = new Set<string>();
  const groupMap = groupsOf(id, repo, merge, [...own.whole, ...own.regions], noRecipe);
  for (const it of items) {
    const tc = testChanges(repo, it.parent, it.commit);
    for (const [k, g] of groupsOf(id, repo, it.commit, [...tc.whole, ...tc.regions], noRecipe)) if (!groupMap.has(k)) groupMap.set(k, { ...g, files: [] });
  }
  if (groupMap.size === 0) reject("E_EB_NO_RECIPE", id, "recipe", noRecipe.size ? [...noRecipe].sort().join(",") : "no_test_source");

  rmSync(out, { recursive: true, force: true });
  for (const d of ["environment", "solution", "upstream"]) mkdirSync(join(out, d), { recursive: true });
  const scratch = mkdtempSync(join(tmpdir(), "eb-unit-"));
  try {
    const bare = join(scratch, "bundle.git");
    git(scratch, ["init", "-q", "--bare", bare]);
    git(repo, ["push", "-q", bare, base + ":refs/heads/" + BASE_BRANCH]);
    git(bare, ["bundle", "create", "-q", join(out, "environment/task.bundle"), "--all"]);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  const readBase = (p: string) => showFile(repo, base, p);
  const baseNames = new Set(listing(repo, base).keys());
  const recipes = [...groupMap.values()].map((g) => ({ ...g, recipe: recipeFor(g.eco, readBase, g.root, baseNames) }));
  const pin = (tags: string[]) => {
    const tag = tags.find((t) => spec.images[t]);
    if (!tag) return reject("E_EB_IMAGE", id, "pull", "no_pinned_image:" + tags[0]);
    return spec.images[tag];
  };
  const primary = recipes[0];
  const addons = [...new Set(recipes.map((r) => r.eco).filter((e) => e !== primary.eco))].map((eco) => {
    if (eco !== "rust" && eco !== "node") return reject("E_EB_NO_RECIPE", id, "recipe", primary.eco + "+" + eco);
    return { eco, from: pin(recipes.find((r) => r.eco === eco)!.recipe.images) };
  });
  const installs = [...new Map(recipes.map((r) => [r.eco + "|" + r.root, r])).values()].map((r) => ({
    root: r.root,
    env: imageEnv(r.recipe),
    command: r.recipe.install(REPO_DIR) + (r.eco === "rust" ? " && (cargo test --no-run --offline || true)" : ""),
  }));
  const mergedDeps = git(repo, ["diff", "--name-only", "-z", "--no-renames", base, merge]).split("\0").filter((p) => p && isDepFile(p) && installs.some((i) => i.root === "" || p.startsWith(i.root + "/")) && showFile(repo, merge, p) !== null);
  for (const p of mergedDeps) {
    mkdirSync(dirname(join(out, "environment/merged-deps", p)), { recursive: true });
    writeFileSync(join(out, "environment/merged-deps", p), showFile(repo, merge, p)!);
  }
  const merged = { atBase: mergedDeps.filter((p) => showFile(repo, base, p) !== null), added: mergedDeps.filter((p) => showFile(repo, base, p) === null) };
  writeFileSync(join(out, "explore-merged-deps.txt"), mergedDeps.length + "\n");
  writeFileSync(join(out, "environment/Dockerfile"), renderEbDockerfile({ from: pin(primary.recipe.images), addons, installs, merged }));

  const tag = "eb-unit-" + id.toLowerCase().replace(/[^a-z0-9_.-]/g, "-") + ":" + randomBytes(4).toString("hex");
  const built = docker(["build", "-q", "--label", "gstack-evals.eb=unit", "--label", "gstack-evals.eb.unit=" + id, "-t", tag, join(out, "environment")], { timeoutMs: 3600000 });
  if (built.status !== 0) reject("E_EB_IMAGE", id, "image", "docker_build_failed");
  const imageId = docker(["image", "inspect", "-f", "{{.Id}}", tag]).stdout.trim();
  const installed = (p: string): string | null => {
    const r = docker(["run", "--rm", "--network", "none", "--entrypoint", "sh", imageId, "-c", '[ -f "$1" ] && cat -- "$1"', "sh", join(REPO_DIR, p)], { timeoutMs: 120000 });
    return r.status === 0 ? r.stdout : null;
  };
  const groups = recipes.map((g) => {
    const files = g.files.map((path) => ({ path, text: showFile(repo, merge, path) ?? "" }));
    const runner = verifierRunner(id, g.recipe, g.projdir, files, (p) => showFile(repo, merge, p), installed);
    return { eco: g.eco, root: g.root, projdir: g.projdir, runner: withConfig(runner, repo, merge, g.projdir) };
  });
  const pyConfig = PYTEST_CONFIGS.find(([name, re]) => {
    const text = showFile(repo, merge, name);
    return text !== null && re.test(text);
  }) ?? null;
  for (const g of groups) if (g.runner.kind === "pytest") g.runner = { ...g.runner, config: pyConfig ? pyConfig[0] : "pytest.ini" };
  const withPyConfig = (dir: string) => {
    if (!groups.some((g) => g.runner.kind === "pytest")) return;
    mkdirSync(join(dir, "config"), { recursive: true });
    writeFileSync(join(dir, "config", pyConfig ? pyConfig[0] : "pytest.ini"), pyConfig ? showFile(repo, merge, pyConfig[0])! : "[pytest]\n");
  };

  const scoped = (rev: string, paths: string[]): SetGroup[] =>
    groups
      .map((g, i) => {
        const mine = paths.filter((p) => {
          const eco = ecoOfFile(p);
          const pr = eco && hasRecipe(eco) ? findProject(eco, p, new Set(listing(repo, rev).keys())) : null;
          return pr !== null && eco === g.eco && pr.projdir === g.projdir;
        });
        const scopes = mine.flatMap((p) => scopesOf(g.runner, p, showFile(repo, rev, p) ?? "", g.projdir));
        return { group: i, targets: [...new Set(mine.map((p) => targetOfFile(g.runner, p, g.projdir)))].sort(), scopes: [...new Set(scopes)].sort() };
      })
      .filter((s) => s.targets.length > 0 && s.scopes.length > 0);

  const drops: Drop[] = own.mixed.map((m) => ({ code: "E_EB_TRANSPLANT" as ReasonCode, step: "functional", cls: m.why, cases: 0 }));
  const sets: RestoreSet[] = [];
  writeSet(repo, join(out, "tests"), merge, null, [{ rev: merge, paths: own.regions }]);
  withPyConfig(join(out, "tests"));
  sets.push({ dir: "tests", role: "functional", item: null, groups: scoped(merge, [...own.whole, ...own.regions].filter((p) => runnableIn(p))) });
  const ownRunnable = [...own.whole, ...own.regions].filter((p) => runnableIn(p));
  const near = (keep: (p: string) => boolean) => [...baseNames].filter((p) => keep(p) && runnableIn(p)).sort().slice(0, 20);
  let baseOwn = ownRunnable.filter((p) => baseNames.has(p));
  if (baseOwn.length === 0) baseOwn = near((p) => ownRunnable.some((q) => dirname(q) === dirname(p)));
  if (baseOwn.length === 0) baseOwn = near((p) => groups.some((g) => g.projdir === "" || p.startsWith(g.projdir + "/")));
  writeSet(repo, join(out, "base"), base, null, []);
  withPyConfig(join(out, "base"));
  sets.push({ dir: "base", role: "base", item: null, groups: scoped(base, baseOwn) });
  for (const it of items) {
    const tc = testChanges(repo, it.parent, it.commit);
    for (const m of tc.mixed) drops.push({ code: "E_EB_TRANSPLANT", step: "aftermath:" + it.item, cls: m.why, cases: 0 });
    const dir = "aftermath/" + it.item.replace(/[^A-Za-z0-9._-]/g, "_");
    writeSet(repo, join(out, dir), merge, { rev: it.commit, ...tc }, [{ rev: merge, paths: own.regions }, { rev: it.commit, paths: tc.regions }]);
    withPyConfig(join(out, dir));
    sets.push({ dir, role: it.kind, item: it.item, groups: scoped(it.commit, [...tc.whole, ...tc.regions].filter((p) => runnableIn(p))) });
  }

  writeFileSync(join(out, "solution/gold.patch"), diff(repo, base, merge));
  writeFileSync(join(out, "solution/solve.sh"), SOLVE_SH);
  writeFileSync(join(out, "upstream/LICENSE"), licenceText);
  writeFileSync(join(out, "instruction.md"), "The statement note for this unit is written by lanes/eng-build/note.ts.\n");
  const task: TaskJson = {
    schema: SCHEMA,
    id,
    kind: "K3",
    trust: spec.trust,
    repo: spec.repo,
    licence: spec.licence,
    attribution: "Code from " + spec.repo + " (" + spec.licence + ", " + licenceFile + " copied to upstream/LICENSE), at upstream commits " + [base, merge, ...items.map((i) => i.commit)].map((s) => s.slice(0, 12)).join(", ") + ".",
    upstream: { base, change: merge, fix: null, revert: null, pr: null, gold_from: "change" },
    exposure: null,
    stratum: spec.strictWindow ? "strict" : "window",
    repo_dir: REPO_DIR,
    base_branch: BASE_BRANCH,
    base_commit: base,
    start_ref: BASE_BRANCH,
    replay: null,
    image: { from: pin(primary.recipe.images), apt: [] },
    install: { lockfile: null, command: installs.map((i) => i.command).join(" && "), exclude: [] },
    runner: groups[0].runner,
    tests: { functional: [], escaped_defect: [], regression: [], regression_scope: [], quarantine: [] },
    new_test_files: [],
    limits: { agent_sec: FROZEN.sessions.build.minutes * 60, verifier_sec: 900, cpus: 2, memory: "4g", ...spec.limits },
    audit: { v4: null, v5: null },
    files: {},
  };
  writeFileSync(join(out, "task.toml"), renderTaskToml(task));

  const eb: EbTask = {
    schema: EB_SCHEMA,
    unit: { id, repo: repoLabel(o.labels, spec.repo), set: spec.set, type: spec.type, ecosystems: [...new Set(groups.map((g) => g.eco))].sort(), keying: spec.keying, mergedMonth: spec.mergedMonth, strictWindow: spec.strictWindow, functional: [], aftermath: [], tCases: [] },
    image: { tag, id: imageId },
    groups,
    sets,
    trees: {},
    drops,
    seed,
  };
  mkdirSync(join(out, "trees"), { recursive: true });
  const grid = (label: string, rev: string, set: RestoreSet, want?: string[]) => {
    const patch = rev === base ? "" : diff(repo, base, rev);
    writeFileSync(join(out, treePatch(label)), patch);
    return gradeSet({ taskDir: out, task, eb, set, label, patch, runs, seed, work: o.work, cpus: o.cpus, want });
  };
  const functional = grid("merged", merge, sets[0]);
  eb.unit.functional = Object.keys(functional).filter((k) => all(functional[k], "pass") && functional[k].length === runs).sort();
  const atBase = grid("base", base, sets[1]);
  const baseResults = Object.values(atBase).some((r) => r.some((c) => c === "pass" || c === "assert" || c === "missing_name"));

  for (const [i, it] of items.entries()) {
    const set = sets[2 + i];
    if (set.groups.length === 0) {
      drops.push({ code: "E_EB_NO_AFTERMATH", step: "aftermath:" + it.item, cls: "no_runnable_test_files", cases: 0 });
      continue;
    }
    const merged = grid("merged", merge, set);
    const fixed = grid("fix:" + it.item, it.commit, set);
    if (it.kind === "T") {
      eb.unit.tCases.push(...anchorCases(merged, fixed, runs));
      continue;
    }
    const parent = it.parent === merge ? merged : grid("parent:" + it.item, it.parent, set);
    const att = attributed(repo, base, merge, it.commit);
    const cases = att.ofChange > 0 ? aftermathCases(merged, parent, fixed, runs) : [];
    if (att.ofChange === 0) drops.push({ code: "E_EB_NO_AFTERMATH", step: "attribution:" + it.item, cls: att.touched === 0 ? "no_product_change" : "not_attributed", cases: aftermathCases(merged, parent, fixed, runs).length });
    const atBaseT = cases.length ? grid("base", base, set, cases) : {};
    eb.unit.aftermath.push({
      item: it.item,
      cases,
      anchors: anchorCases(merged, fixed, runs),
      base: Object.fromEntries(cases.map((c) => [c, baseOutcome(atBaseT[c])])),
      mentioned: it.mentioned,
      generic: it.generic,
      foreseeable: it.foreseeable,
    });
  }
  eb.unit.tCases = [...new Set(eb.unit.tCases)].sort();
  task.tests.functional = eb.unit.functional;
  let drop: Drop | null = null;
  if (eb.unit.functional.length === 0) drop = { code: "E_EB_IMAGE", step: "merged", cls: "no_functional_pass", cases: 0 };
  else if (!baseResults) drop = { code: "E_EB_IMAGE", step: "base", cls: "no_per_case_result", cases: 0 };
  else if (!eb.unit.aftermath.some((a) => a.cases.length > 0)) drop = { code: "E_EB_NO_AFTERMATH", step: "aftermath", cls: "no_case_passed_the_rule", cases: 0 };
  writeFileSync(join(out, "eb.json"), JSON.stringify(eb, null, 2) + "\n");
  task.files = fileDigests(out);
  writeFileSync(join(out, "task.json"), JSON.stringify(task, null, 2) + "\n");
  return { dir: out, eb, qualifies: drop === null, drop };
}

const runnableIn = (p: string): boolean => {
  const eco = ecoOfFile(p);
  return eco !== null && hasRecipe(eco) && runnable(eco, p);
};

/** Pins gold's runner config: a restored config file in the project dir, or jest's package.json key as inline JSON. */
function withConfig(runner: Runner, repo: string, gold: string, projdir: string): Runner {
  if (runner.kind !== "jest" && runner.kind !== "vitest" && runner.kind !== "mocha") return runner;
  const names = listing(repo, gold);
  const at = (p: string) => (projdir ? projdir + "/" + p : p);
  const pick = (re: RegExp) => [...names.keys()].filter((p) => p.startsWith(projdir ? projdir + "/" : "") && re.test(p.slice(projdir ? projdir.length + 1 : 0))).sort()[0] ?? null;
  if (runner.kind === "vitest") return { ...runner, config: pick(/^vitest\.config\.[cm]?[jt]s$/) };
  if (runner.kind === "mocha") return { ...runner, config: pick(/^\.mocharc\.(js|cjs|mjs|json|jsonc|ya?ml)$/) };
  const file = pick(/^jest\.config\.[cm]?[jt]s$/);
  if (file) return { ...runner, config: file };
  try {
    const key = JSON.parse(showFile(repo, gold, at("package.json")) ?? "{}").jest;
    if (key && typeof key === "object") return { ...runner, config: JSON.stringify({ ...key, rootDir: join(REPO_DIR, projdir) }) };
  } catch {}
  return runner;
}

export interface GradeOptions {
  taskDir: string;
  task: TaskJson;
  eb: EbTask;
  set: RestoreSet;
  /** A real tree's label (merged, base, fix:<item>, parent:<item>) records or checks its product hashes; a build's tree
   * is checked only against itself. */
  label: string;
  patch: string;
  runs: number;
  seed: number;
  work: string;
  cpus?: number;
  /** Check a real tree's product hashes against those recorded at the build, instead of recording them. */
  check?: boolean;
  /** Ids to classify even when no run reported them (a case on a tree that does not compile). */
  want?: string[];
}

/** Grades one tree on one restore set: each runner group in its own verifier call, reading only the ids in the set's
 * scopes. Before the first run, a product file the cold rebuild or the test move changed, or a real tree whose product
 * files differ from the hashes recorded for it, refuses the tree with E_EB_PRODUCT_HASH. */
export function gradeSet(o: GradeOptions): Grid {
  const grid: Grid = {};
  for (const sg of o.set.groups) {
    const g = o.eb.groups[sg.group];
    const tree = verifyTree({
      taskDir: o.taskDir,
      task: { ...o.task, runner: g.runner },
      image: o.eb.image.id,
      label: (o.label + "-" + o.set.dir + "-" + sg.group).replace(/[^A-Za-z0-9._-]/g, "_"),
      patch: o.patch,
      runs: o.runs,
      seed: o.seed,
      work: o.work,
      cpus: o.cpus,
      testsDir: join(o.taskDir, o.set.dir),
      ids: sg.targets,
      cold: true,
      beforeRuns: (p) => productCheck(o, sg.group, p),
    });
    for (const [id, runs] of Object.entries(treeGrid(tree, g.runner.kind, sg.scopes, o.want))) grid[id] = runs;
  }
  return grid;
}

function productCheck(o: GradeOptions, group: number, p: TreeResult["prepare"]): void {
  const cold = p.cold!;
  if (p.patch === "failed") return;
  if (cold.changed.length > 0) fail("E_EB_PRODUCT_HASH", o.eb.unit.id + " " + o.label + " set=" + o.set.dir + ": the rebuild or the test move changed product files " + cold.changed.slice(0, 5).join(", "));
  if (["merged", "base"].includes(o.label) || /^(fix|parent):/.test(o.label)) {
    const key = o.set.dir + "#" + group;
    const rec = (o.eb.trees[o.label] ??= {});
    if (!o.check && !rec[key]) rec[key] = cold.products;
    else if (!rec[key]) fail("E_EB_PRODUCT_HASH", o.eb.unit.id + " " + o.label + " set=" + o.set.dir + ": no product hashes were recorded for this tree at the build");
    else {
      const want = rec[key];
      const diffs = [...new Set([...Object.keys(want), ...Object.keys(cold.products)])].filter((k) => want[k] !== cold.products[k]);
      if (diffs.length > 0) fail("E_EB_PRODUCT_HASH", o.eb.unit.id + " " + o.label + " set=" + o.set.dir + ": product files differ from the hashes recorded for this tree: " + diffs.slice(0, 5).join(", "));
    }
  }
}

/** Every in-scope id's class in each run of a tree. */
export function treeGrid(tree: TreeResult, runner: Runner["kind"], scopes: string[], want: string[] = []): Grid {
  const ids = new Set<string>(want.filter((id) => inScope(runner, id, scopes)));
  for (const r of tree.runs) for (const id of [...r.parsed.seen, ...Object.keys(r.parsed.results)]) if (inScope(runner, id, scopes) && !(runner === "go" && goSubtest(id))) ids.add(id);
  const grid: Grid = {};
  for (const id of [...ids].sort()) grid[id] = tree.runs.map((r) => runClasses(runner, r.parsed, [id], { timed_out: r.timed_out, stopped: r.out_full || r.killed })[id]);
  return grid;
}

/** Where a unit keeps a real tree's patch against base, by tree label, so a recount needs no clone. */
export const treePatch = (label: string): string => "trees/" + label.replace(/[^A-Za-z0-9._-]/g, "_") + ".patch";

/** Reads a built unit's eb.json and task.json. */
export function readUnit(dir: string): { eb: EbTask; task: TaskJson } {
  const eb = JSON.parse(readFileSync(join(dir, "eb.json"), "utf8")) as EbTask;
  if (eb.schema !== EB_SCHEMA) throw new EbError("E_EB_IMAGE", dir + ": eb.json is not " + EB_SCHEMA);
  return { eb, task: JSON.parse(readFileSync(join(dir, "task.json"), "utf8")) as TaskJson };
}

/** One case's runs, for a graded build. */
export const caseRuns = (grid: Grid, ids: string[]): CaseRuns[] => ids.map((id) => ({ id, runs: grid[id] ?? [] }));
