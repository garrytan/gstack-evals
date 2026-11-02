// Copyright (c) 2026 Garry Tan. MIT License.
// Repository sampling: language, permissive licence, recent activity and an offline-runnable test suite (a known
// runner and a lockfile), plus the gstack-family rule. gstack itself is the dev pool, never scored; other garrytan
// repositories shipped through gstack's own /ship form a labelled stratum, never the headline (plan section 2).
// A repository that holds a project-local .claude/ directory or .mcp.json is dropped, because the sandbox (B4) refuses
// a task whose base tree would hand the none arm project skills, plugins or MCP routes.
import { createHash } from "node:crypto";
import { gitLines, showFile } from "./git.ts";

export type Family = "gstack-dev" | "gstack-shipped" | "none";
export type Runner = "pytest" | "vitest" | "jest" | "go" | "cargo" | "unknown";

export const LANGUAGES = ["TypeScript", "JavaScript", "Python", "Go", "Rust"];
export const LICENCES = ["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause"];

export function familyOf(fullName: string): Family {
  const name = fullName.toLowerCase();
  if (name === "garrytan/gstack") return "gstack-dev";
  return name.startsWith("garrytan/") ? "gstack-shipped" : "none";
}

export interface Inspection {
  runner: Runner;
  lockfiles: string[];
  has_tests: boolean;
  package_names: string[];
  claude_config: string[];
}

const LOCKS = ["package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml", "bun.lock", "bun.lockb", "poetry.lock", "uv.lock", "Pipfile.lock", "pdm.lock", "go.sum", "Cargo.lock", "requirements.lock"];

/** Reads a tree's root files: its test runner, lockfiles, published package names and Claude project config. */
export function inspectTree(paths: string[], read: (path: string) => string | null): Inspection {
  const has = new Set(paths);
  const pkg = has.has("package.json") ? safeJson(read("package.json")) : null;
  const pyproject = has.has("pyproject.toml") ? safeToml(read("pyproject.toml")) : null;
  const cargo = has.has("Cargo.toml") ? safeToml(read("Cargo.toml")) : null;
  const gomod = has.has("go.mod") ? read("go.mod") ?? "" : null;
  const devs = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) } as Record<string, unknown>;
  const pyText = [read("pyproject.toml") ?? "", read("setup.cfg") ?? "", read("tox.ini") ?? "", ...paths.filter((p) => /^requirements[^/]*\.(txt|in|lock)$/.test(p)).map((p) => read(p) ?? "")].join("\n");
  let runner: Runner = "unknown";
  if (has.has("pytest.ini") || paths.some((p) => p.endsWith("conftest.py")) || /\[tool\.pytest|\[tool:pytest\]|\[pytest\]|\bpytest\b/.test(pyText)) runner = "pytest";
  else if ("vitest" in devs) runner = "vitest";
  else if ("jest" in devs) runner = "jest";
  else if (gomod !== null && paths.some((p) => p.endsWith("_test.go"))) runner = "go";
  else if (cargo !== null) runner = "cargo";
  const names: string[] = [];
  if (typeof pkg?.name === "string") names.push(pkg.name);
  const projectName = (pyproject?.project as Record<string, unknown> | undefined)?.name ?? ((pyproject?.tool as Record<string, Record<string, unknown>> | undefined)?.poetry?.name);
  if (typeof projectName === "string") names.push(projectName);
  const crate = (cargo?.package as Record<string, unknown> | undefined)?.name;
  if (typeof crate === "string") names.push(crate);
  const mod = gomod === null ? null : /^module\s+(\S+)/m.exec(gomod);
  if (mod) names.push(mod[1]);
  const goNoDeps = gomod !== null && !/^require\b/m.test(gomod);
  return {
    runner,
    lockfiles: LOCKS.filter((l) => has.has(l)).concat(goNoDeps && !has.has("go.sum") ? ["go.mod (no requirements)"] : []),
    has_tests: paths.some((p) => /(^|\/)(tests?|__tests__|testdata|spec)\/|_test\.(go|py)$|(^|\/)test_[^/]*\.py$|\.(test|spec)\.[cm]?[jt]sx?$/.test(p)),
    package_names: names,
    claude_config: paths.filter((p) => p === ".mcp.json" || p.startsWith(".claude/")),
  };
}

function safeJson(text: string | null): Record<string, any> | null {
  try {
    return text === null ? null : JSON.parse(text);
  } catch {
    return null;
  }
}

function safeToml(text: string | null): Record<string, unknown> | null {
  try {
    return text === null ? null : (Bun.TOML.parse(text) as Record<string, unknown>);
  } catch {
    return null;
  }
}

export function inspectCheckout(repoDir: string, rev: string): Inspection {
  return inspectTree(gitLines(repoDir, ["ls-tree", "-r", "--name-only", rev]), (p) => showFile(repoDir, rev, p));
}

export interface RepoCandidate {
  full_name: string;
  language: string | null;
  license: string | null;
  archived: boolean;
  fork: boolean;
  pushed_at: string;
  default_branch: string;
  /** First-parent commits on the default branch since the window start, when counted. */
  window_commits?: number | null;
  /** inspectCheckout at the default branch's head, when a clone was read. */
  inspection?: Inspection | null;
}

export interface SampleOptions {
  mined_at: string;
  active_days?: number;
  min_window_commits?: number;
  excluded_packages?: string[];
}

export interface SampledRepo {
  full_name: string;
  language: string;
  license: string;
  default_branch: string;
  family: Family;
  runner: Runner;
  lockfiles: string[];
}

export interface Sample {
  schema: "real-outcome.sample.v1";
  mined_at: string;
  rules: Required<SampleOptions>;
  kept: SampledRepo[];
  dev_pool: SampledRepo[];
  dropped: { full_name: string; reasons: string[] }[];
  /** sha256 over the kept list's canonical JSON; B3 freezes the list and this digest before screening. */
  digest: string;
}

export function sampleRepos(cands: RepoCandidate[], opts: SampleOptions): Sample {
  const rules = { active_days: 30, min_window_commits: 20, excluded_packages: [], ...opts };
  const kept: SampledRepo[] = [];
  const devPool: SampledRepo[] = [];
  const dropped: Sample["dropped"] = [];
  for (const c of [...cands].sort((a, b) => a.full_name.localeCompare(b.full_name))) {
    const reasons: string[] = [];
    if (!c.language || !LANGUAGES.includes(c.language)) reasons.push("language");
    if (!c.license || !LICENCES.includes(c.license)) reasons.push("licence");
    if (c.archived) reasons.push("archived");
    if (c.fork) reasons.push("fork");
    if (Date.parse(c.pushed_at) < Date.parse(rules.mined_at) - rules.active_days * 86400000) reasons.push("inactive");
    if (typeof c.window_commits === "number" && c.window_commits < rules.min_window_commits) reasons.push("few_commits");
    const ins = c.inspection ?? null;
    if (ins === null) reasons.push("not_inspected");
    else {
      if (ins.runner === "unknown" || !ins.has_tests) reasons.push("no_test_suite");
      if (ins.lockfiles.length === 0) reasons.push("no_lockfile");
      if (ins.claude_config.length > 0) reasons.push("claude_config");
      if (ins.package_names.some((n) => rules.excluded_packages.includes(n))) reasons.push("runtime_package");
    }
    const family = familyOf(c.full_name);
    if (reasons.length > 0) {
      dropped.push({ full_name: c.full_name, reasons });
      continue;
    }
    const row: SampledRepo = { full_name: c.full_name, language: c.language!, license: c.license!, default_branch: c.default_branch, family, runner: ins!.runner, lockfiles: ins!.lockfiles };
    (family === "gstack-dev" ? devPool : kept).push(row);
  }
  const digest = createHash("sha256").update(JSON.stringify(kept)).digest("hex");
  return { schema: "real-outcome.sample.v1", mined_at: rules.mined_at, rules, kept, dev_pool: devPool, dropped, digest };
}
