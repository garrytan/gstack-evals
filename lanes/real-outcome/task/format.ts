// Copyright (c) 2026 Garry Tan. MIT License.
// The real-outcome task directory (SPEC.md beside this file): task.json's shape, the files every task holds, the
// generated Dockerfile and task.toml, the frozen-install policy and the static checks the checker runs before Docker.
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { INSTALL_DIRS, RUNNER_CONFIG_PATTERNS, TEST_PATTERNS } from "../mine/paths.ts";

export const SCHEMA = "real-outcome.task.v1";
export const REPO_DIR = "/testbed";
export const BASE_BRANCH = "main";
export const REPLAY_BRANCH = "change";
export const VERIFIER_DIR = join(import.meta.dir, "verifier");
export const VERIFIER_FILES = ["prepare.sh", "vrun.py"];
export const LICENCES = ["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause"];
export const PROTECT_ERE = [...TEST_PATTERNS, ...RUNNER_CONFIG_PATTERNS].join("\n") + "\n";

export type Kind = "K1" | "K2" | "K3" | "K4";
export type Runner = { kind: "pytest"; python: string; config: string } | { kind: "go"; module: string };

export interface Audit {
  pass: boolean;
  by: string;
  at: string;
  note: string;
}

export interface TaskJson {
  schema: typeof SCHEMA;
  id: string;
  kind: Kind;
  /** fixture: written by this repo's tests. upstream: a public repository's code, built and run only on keyless hosts. */
  trust: "fixture" | "upstream";
  repo: string;
  licence: string;
  attribution: string;
  upstream: {
    base: string;
    change: string;
    fix: string | null;
    revert: string | null;
    pr: number | null;
    gold_from: "change" | "fix-onto-introducing" | "reland-onto-base" | "hand-ported" | "replay-as-given";
  };
  exposure: { at: string; source: string; ref: string } | null;
  stratum: "window" | "strict" | null;
  repo_dir: typeof REPO_DIR;
  base_branch: typeof BASE_BRANCH;
  base_commit: string;
  /** The ref the agent image has checked out: main for K1 to K3, the replay branch for K4. */
  start_ref: string;
  replay: { role: "replay" | "decoy"; branch: typeof REPLAY_BRANCH; commit: string; description: string; change_sha256: string } | null;
  image: { from: string; apt: string[] };
  install: { lockfile: string | null; command: string | null; exclude: string[] };
  runner: Runner;
  tests: {
    functional: string[];
    escaped_defect: string[];
    regression: string[];
    /** Test files (pytest) or package dirs (go) whose tests passing at base and gold become regression tests. */
    regression_scope: string[];
    quarantine: string[];
    /** sha256 over regression_scope, regression and quarantine, written by check --freeze-regression. */
    regression_frozen?: string | null;
  };
  /** Restored test files that are new at gold: absent from the agent image. */
  new_test_files: string[];
  limits: { agent_sec: number; verifier_sec: number; cpus: number; memory: string };
  audit: { v4: Audit | null; v5: Audit | null };
  /** sha256 of every other file in the task directory, by relative path. */
  files: Record<string, string>;
}

export class TaskError extends Error {
  constructor(readonly code: "E_REAL_TASK_FORMAT" | "E_REAL_TASK_LOCKFILE" | "E_REAL_TASK_KEYED_HOST" | "E_REAL_TASK_GOLD_CONFLICT" | "E_REAL_TASK_DOCKER", message: string) {
    super(message);
  }
}

export const sha256 = (data: string | Uint8Array): string => createHash("sha256").update(data).digest("hex");

/** Frozen installs only: each lockfile type with the command shapes that hold to it. */
export const FROZEN_INSTALLS: [RegExp, RegExp][] = [
  [/^requirements[^/]*\.(txt|lock)$/, /^pip install( --no-cache-dir)? --no-deps --require-hashes -r (\S+)$/],
  [/^uv\.lock$/, /^uv sync --frozen( --no-dev| --all-extras| --no-install-project)*$/],
  [/^poetry\.lock$/, /^poetry install --no-interaction( --no-root| --sync| --all-extras)*$/],
  [/^package-lock\.json$/, /^npm ci( --ignore-scripts)?$/],
  [/^yarn\.lock$/, /^yarn install --(frozen-lockfile|immutable)$/],
  [/^pnpm-lock\.yaml$/, /^pnpm install --frozen-lockfile$/],
  [/^bun\.lockb?$/, /^bun install --frozen-lockfile$/],
  [/^go\.sum$/, /^go mod download$/],
  [/^Cargo\.lock$/, /^cargo fetch --locked$/],
];

/** Why an install breaks the policy, or null. A task with no install is allowed only for a Go module with no requirements. */
export function installProblem(install: TaskJson["install"], runner: Runner, readBase: (path: string) => string | null): string | null {
  if (install.lockfile === null || install.command === null) {
    if (install.lockfile !== null || install.command !== null) return "install needs both lockfile and command, or neither";
    if (runner.kind === "go" && !/^require\b/m.test(readBase("go.mod") ?? "require")) return null;
    return "no lockfile: installs without a lockfile are refused";
  }
  const text = readBase(install.lockfile);
  if (text === null) return "lockfile " + install.lockfile + " is not in the base tree";
  const rule = FROZEN_INSTALLS.find(([file]) => file.test(install.lockfile!.slice(install.lockfile!.lastIndexOf("/") + 1)));
  if (!rule) return "no frozen install is known for " + install.lockfile;
  const m = rule[1].exec(install.command);
  if (!m) return "command " + JSON.stringify(install.command) + " does not hold to " + install.lockfile;
  if (rule[0].source.startsWith("^requirements")) {
    if (m[2] !== install.lockfile) return "the pip command must install " + install.lockfile;
    const reqs = text.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
    if (reqs.some((l) => !/--hash=sha256:[0-9a-f]{64}/.test(l))) return install.lockfile + " has a requirement without a sha256 hash";
  }
  return null;
}

const shellQuote = (s: string): string => "'" + s.replaceAll("'", "'\\''") + "'";

/** The agent image. Installs run in build containers with no build args or secrets; .git is rebuilt from the bundle after. */
export function renderDockerfile(t: Pick<TaskJson, "image" | "install" | "kind">): string {
  const lines = ["# syntax=docker/dockerfile:1", "# Generated by gstack-evals real task build (lanes/real-outcome/task/SPEC.md). Do not edit.", "FROM " + t.image.from];
  if (t.image.apt.length > 0) lines.push("RUN apt-get update && apt-get install -y --no-install-recommends " + t.image.apt.join(" ") + " && rm -rf /var/lib/apt/lists/*");
  lines.push("RUN --mount=type=bind,source=task.bundle,target=/mnt/task.bundle git clone -q --branch " + BASE_BRANCH + " /mnt/task.bundle " + REPO_DIR);
  lines.push("WORKDIR " + REPO_DIR);
  if (t.install.command) lines.push("RUN " + t.install.command);
  const rebuild = [
    "rm -rf .git",
    "git init -q -b " + BASE_BRANCH,
    "git fetch -q --update-head-ok /mnt/task.bundle 'refs/heads/*:refs/heads/*'",
    "git reset -q",
    ...(t.kind === "K4" ? ["git checkout -q " + REPLAY_BRANCH] : []),
    ...t.install.exclude.map((p) => "echo " + shellQuote(p) + " >> .git/info/exclude"),
    "rm -rf .git/logs .git/FETCH_HEAD .git/ORIG_HEAD",
    "git gc -q --prune=now",
  ];
  lines.push("RUN --mount=type=bind,source=task.bundle,target=/mnt/task.bundle " + rebuild.join(" && "));
  return lines.join("\n") + "\n";
}

export function renderTaskToml(t: Pick<TaskJson, "id" | "limits">): string {
  return [
    'schema_version = "1.4"',
    "",
    "[metadata]",
    'lane = "real-outcome"',
    "task_id = " + JSON.stringify(t.id),
    "",
    "[verifier]",
    "timeout_sec = " + t.limits.verifier_sec.toFixed(1),
    'environment_mode = "separate"',
    "",
    "[agent]",
    "timeout_sec = " + t.limits.agent_sec.toFixed(1),
    'network_mode = "allowlist"',
    "",
    "[environment]",
    'network_mode = "no-network"',
    "build_timeout_sec = 1800.0",
    'os = "linux"',
    "",
  ].join("\n");
}

export const SOLVE_SH = "#!/bin/sh\n# The oracle: apply gold to the starting tree.\nset -eu\ncd " + REPO_DIR + "\ngit apply --whitespace=nowarn /solution/gold.patch\n";

/** What instruction.md must not name: upstream commit ids, GitHub references and links to pull requests or commits. */
export function statementLeaks(text: string, shas: string[]): string[] {
  const out: string[] = [];
  for (const sha of shas) for (const m of text.matchAll(/\b[0-9a-f]{7,40}\b/g)) if (sha.startsWith(m[0])) out.push("names commit " + m[0]);
  for (const m of text.matchAll(/(?:^|[\s(])#(\d+)\b/g)) out.push("names #" + m[1]);
  for (const m of text.matchAll(/github\.com\/\S+\/(?:pull|issues|commit)\/\S+/g)) out.push("links " + m[0]);
  return out;
}

export function detectLicence(text: string): string | null {
  if (/Permission is hereby granted, free of charge/.test(text)) return "MIT";
  if (/Apache License,?\s+Version 2\.0/.test(text)) return "Apache-2.0";
  if (/Redistribution and use in source and binary forms/.test(text)) return /Neither the name/.test(text) ? "BSD-3-Clause" : "BSD-2-Clause";
  return null;
}

/** Every file under dir, relative, with symlinks reported apart. */
export function walk(dir: string): { files: string[]; links: string[] } {
  const files: string[] = [];
  const links: string[] = [];
  const go = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      const st = lstatSync(p);
      if (st.isSymbolicLink()) links.push(relative(dir, p));
      else if (st.isDirectory()) go(p);
      else files.push(relative(dir, p));
    }
  };
  go(dir);
  return { files, links };
}

export function fileDigests(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of walk(dir).files) if (f !== "task.json") out[f] = sha256(readFileSync(join(dir, f)));
  return out;
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SHA = /^[0-9a-f]{40}$/;

const required = (t: TaskJson): string[] => [
  "task.toml",
  "instruction.md",
  "environment/Dockerfile",
  "environment/task.bundle",
  "tests/protect.ere",
  "tests/restore.list",
  "tests/leak-needles.txt",
  ...VERIFIER_FILES.map((f) => "tests/" + f),
  ...(t.runner.kind === "pytest" ? ["tests/config/" + t.runner.config] : []),
  "solution/solve.sh",
  "solution/gold.patch",
  ...(t.kind === "K1" ? ["solution/introducing.patch"] : []),
  "upstream/LICENSE",
];

/** The test file (pytest) or package dir (go) an id runs in. */
export const targetOf = (id: string): string => id.split("::")[0];

/** A test id the task may list: <file>.py::<name> for pytest, <package dir>::<TopLevelTest> for Go (no subtests). */
export const validTestId = (runner: "pytest" | "go", id: string): boolean => (runner === "go" ? /^[^:]+::Test[A-Za-z0-9_]*$/ : /^[^:]+\.py::\S+$/).test(id);

/** sha256 over the regression scope and the regression and quarantine lists check derived from it. */
export const regressionDigest = (t: TaskJson): string => sha256(JSON.stringify([t.tests.regression_scope, t.tests.regression, t.tests.quarantine]));

/** Whether tests.regression is the list check --freeze-regression derived from regression_scope, unchanged since. A task
 * with no regression_scope has nothing to derive. */
export const regressionFrozen = (t: TaskJson): boolean => t.tests.regression_scope.length === 0 || t.tests.regression_frozen === regressionDigest(t);

/** Static checks, no Docker: structure, digests, generated files, verifier scripts, ids, statement, licence, install. */
export function readTask(dir: string): TaskJson {
  const fail = (m: string): never => {
    throw new TaskError("E_REAL_TASK_FORMAT", dir + ": " + m);
  };
  if (!existsSync(join(dir, "task.json"))) fail("no task.json");
  let t: TaskJson;
  try {
    t = JSON.parse(readFileSync(join(dir, "task.json"), "utf8"));
  } catch (error) {
    return fail("task.json is not JSON: " + (error as Error).message);
  }
  if (t.schema !== SCHEMA) fail("schema is not " + SCHEMA);
  if (!ID.test(t.id ?? "")) fail("id must match " + ID.source);
  if (!["K1", "K2", "K3", "K4"].includes(t.kind)) fail("kind must be K1, K2, K3 or K4");
  if (t.trust !== "fixture" && t.trust !== "upstream") fail("trust must be fixture or upstream");
  if (t.repo_dir !== REPO_DIR || t.base_branch !== BASE_BRANCH) fail("repo_dir and base_branch are fixed at " + REPO_DIR + " and " + BASE_BRANCH);
  if (!SHA.test(t.base_commit) || !SHA.test(t.upstream?.change ?? "")) fail("base_commit and upstream.change must be full shas");
  if (!LICENCES.includes(t.licence)) fail("licence " + JSON.stringify(t.licence) + " is not permissive (" + LICENCES.join(", ") + ")");
  if (!t.attribution || t.attribution.length < 10) fail("attribution is missing");
  if (!/^[^\s@]+@sha256:[0-9a-f]{64}$/.test(t.image?.from ?? "")) fail("image.from must be pinned by digest (<name>@sha256:<64 hex>)");
  if (t.kind === "K4") {
    if (!t.replay || !SHA.test(t.replay.commit) || !["replay", "decoy"].includes(t.replay.role) || t.start_ref !== REPLAY_BRANCH) fail("K4 needs replay.role, replay.commit and start_ref " + REPLAY_BRANCH);
    if (t.replay!.description.includes("\n") || t.replay!.description.trim().length === 0) fail("replay.description must be one line");
  } else if (t.replay !== null || t.start_ref !== BASE_BRANCH) fail("K1 to K3 have no replay and start_ref " + BASE_BRANCH);
  const { functional, escaped_defect: escaped } = t.tests;
  if ((t.kind === "K1" || (t.kind === "K4" && t.replay?.role === "replay")) && escaped.length === 0) fail(t.kind + " needs escaped_defect tests");
  if (t.kind !== "K4" && functional.length === 0) fail(t.kind + " needs functional tests");
  if (t.kind === "K4" && t.replay?.role === "decoy" && functional.length + t.tests.regression.length + t.tests.regression_scope.length === 0) fail("a decoy needs tests to pass");
  const ids = [...functional, ...escaped, ...t.tests.regression];
  if (new Set(ids).size !== ids.length) fail("a test id is listed twice across functional, escaped_defect and regression");
  if (ids.some((id) => !validTestId(t.runner.kind, id))) fail(t.runner.kind === "go" ? "go ids are <package dir>::<TopLevelTest>" : "pytest ids are <file>.py::<name>");
  const { files, links } = walk(dir);
  if (links.length > 0) fail("symlinks are not allowed: " + links.join(", "));
  for (const f of required(t)) if (!files.includes(f)) fail("missing " + f);
  const want = fileDigests(dir);
  const extra = Object.keys(want).filter((f) => !(f in (t.files ?? {})));
  const missing = Object.keys(t.files ?? {}).filter((f) => !(f in want));
  if (extra.length + missing.length > 0) fail("files differ from task.json: extra " + JSON.stringify(extra) + ", missing " + JSON.stringify(missing));
  for (const [f, d] of Object.entries(want)) if (t.files[f] !== d) fail(f + " does not match its digest in task.json");
  for (const f of VERIFIER_FILES) if (readFileSync(join(dir, "tests", f), "utf8") !== readFileSync(join(VERIFIER_DIR, f), "utf8")) fail("tests/" + f + " is not the verifier's own copy");
  if (readFileSync(join(dir, "tests/protect.ere"), "utf8") !== PROTECT_ERE) fail("tests/protect.ere is not the verifier's pattern list");
  if (readFileSync(join(dir, "environment/Dockerfile"), "utf8") !== renderDockerfile(t)) fail("environment/Dockerfile is not the generated one");
  if (readFileSync(join(dir, "task.toml"), "utf8") !== renderTaskToml(t)) fail("task.toml is not the generated one");
  if (readFileSync(join(dir, "solution/solve.sh"), "utf8") !== SOLVE_SH) fail("solution/solve.sh is not the generated one");
  const restored = new Set(readFileSync(join(dir, "tests/restore.list"), "utf8").split("\n").filter(Boolean));
  for (const p of restored) if (!files.includes("tests/restore/" + p) || INSTALL_DIRS.some((d) => p.split("/").includes(d))) fail("restore.list names " + p + " without its file");
  for (const id of ids) {
    const target = targetOf(id);
    const ok = t.runner.kind === "pytest" ? restored.has(target) : [...restored].some((p) => p.endsWith("_test.go") && (target === "." ? !p.includes("/") : p.startsWith(target + "/") && !p.slice(target.length + 1).includes("/")));
    if (!ok) fail("test id " + id + " has no restored test file");
  }
  const statement = readFileSync(join(dir, "instruction.md"), "utf8");
  const leaks = statementLeaks(statement, [t.upstream.change, t.upstream.fix, t.upstream.revert].filter((s): s is string => !!s));
  if (leaks.length > 0) fail("instruction.md " + leaks.join("; "));
  const licence = detectLicence(readFileSync(join(dir, "upstream/LICENSE"), "utf8"));
  if (licence !== t.licence) fail("upstream/LICENSE reads as " + licence + ", not " + t.licence);
  return t;
}

/** Provider or GitHub credentials in this process's environment, by name only. */
export function keysInEnv(env: Record<string, string | undefined> = process.env): string[] {
  return Object.keys(env)
    .filter((k) => (env[k] ?? "").length > 0 && /(^|_)(API_KEY|TOKEN|SECRET)$|^(ANTHROPIC|OPENAI|OPENROUTER|UBICLOUD|GEMINI|GOOGLE_API|AWS_SECRET|GH|GITHUB)_/.test(k))
    .sort();
}
