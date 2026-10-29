#!/usr/bin/env bun
// The keyless full gate (U19). It runs gate/manifest.json's cases, writes the train record gstack's merge train reads, and
// routes and publishes train-gate.yml's runs. It imports only Node built-ins, so train-gate.yml can run the train base's copy
// from a bare worktree while the cases run in the train head.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export interface GateCase {
  id: string;
  kind: "command" | "junit";
  run: string;
  /** junit only: tests that must be in the report and pass; an absent or skipped one fails the case. */
  tests?: string[];
}
export interface GateManifest {
  schema: 1;
  stages: Record<string, GateCase[]>;
  /** Paths whose change alters the gate itself: a train of two or more PRs that touches one gets no green check. */
  gate_surface: string[];
}
export interface CasePanel {
  case: string;
  kind: string;
  status: "PASS" | "FAIL" | "INFRA";
  red_class: "VERDICT" | "INFRA" | null;
  cost_usd: number | null;
}
export interface Census {
  complete: boolean;
  planned: { rule: number; judge: number };
  executed: { rule: number; judge: number };
  unbound: number;
  partial_shards: number;
  cancelled_shards: number;
  killed_before_upload: number;
}
export interface TrainGateRecord {
  schema: 1;
  kind: "train-gate";
  nonce: string;
  head_sha: string;
  tree: string;
  verdict: "GREEN" | "RED";
  census: Census;
  panels: CasePanel[];
  stage: string;
  base_sha: string;
}
export interface BisectPrefixRecord {
  schema: 1;
  kind: "train-bisect-prefix";
  nonce: string;
  prefix_sha: string;
  checked_out_sha: string;
  panels: CasePanel[];
}

export const STAGE = "m0";
export const MAX_PREFIXES = 7;
export const MAX_BISECT_CASES = 40;
export const CASE_TIMEOUT_MS = 20 * 60 * 1000;
const SHA = /^[0-9a-f]{40}$/;
const CASE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const PREFIX_SUBJECT = /^train T(\d+): merge #(\d+) at [0-9a-f]{12}$/;
const NONCE = /^(?:pr|gate|periodic|release)\.(screen|train|bisect|backstop)(?:\.(?:narrow|broad))?-[0-9a-f]{1,12}-[A-Za-z0-9._-]*$/;

/** Synchronous, so the lines interleave with the cases' own output when stdout is a file. */
const say = (line: string) => void writeSync(1, line + "\n");

export type Git = (args: string[]) => { ok: boolean; out: string };
export const gitIn =
  (cwd: string): Git =>
  (args) => {
    const r = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    return r.status === 0 ? { ok: true, out: (r.stdout ?? "").replace(/\n$/, "") } : { ok: false, out: (r.stderr || String(r.error ?? "")).trim() };
  };

const list = (text: string) =>
  text
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

/** The purpose a gstack nonce was minted with (scripts/eval-bg.ts nonceScope), or null for any other string. */
export function noncePurpose(nonce: string): string | null {
  return NONCE.exec(nonce)?.[1] ?? null;
}

export function parseManifest(text: string): GateManifest | { error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { error: "gate/manifest.json is not JSON (" + (e as Error).message + ")" };
  }
  const m = raw as Partial<GateManifest>;
  if (m?.schema !== 1) return { error: "gate/manifest.json needs schema 1" };
  if (!m.stages || typeof m.stages !== "object" || !Array.isArray(m.stages[STAGE])) return { error: "gate/manifest.json has no " + STAGE + " stage" };
  if (!Array.isArray(m.gate_surface) || !m.gate_surface.length || m.gate_surface.some((g) => typeof g !== "string" || !g)) {
    return { error: "gate/manifest.json needs a non-empty gate_surface list of globs" };
  }
  for (const [stage, cases] of Object.entries(m.stages)) {
    if (!Array.isArray(cases) || !cases.length) return { error: "stage " + stage + " lists no cases" };
    const seen = new Set<string>();
    for (const c of cases as GateCase[]) {
      if (typeof c?.id !== "string" || !CASE_ID.test(c.id)) return { error: "stage " + stage + ": case id " + JSON.stringify(c?.id) + " is not lowercase letters, digits and dashes" };
      if (seen.has(c.id)) return { error: "stage " + stage + ": case " + c.id + " is listed twice" };
      seen.add(c.id);
      if (c.kind !== "command" && c.kind !== "junit") return { error: "case " + c.id + ": kind must be command or junit" };
      if (typeof c.run !== "string" || !c.run.trim()) return { error: "case " + c.id + ": run must be a command" };
      if (c.kind === "junit" && (!Array.isArray(c.tests) || !c.tests.length || c.tests.some((t) => typeof t !== "string" || !t))) {
        return { error: "case " + c.id + ": a junit case names the tests it needs" };
      }
      if (c.kind === "command" && c.tests !== undefined) return { error: "case " + c.id + ": only a junit case names tests" };
    }
  }
  return m as GateManifest;
}

/** The train's base and slot count from its head: first parents over gstack's "train T<i>: merge #<pr> at <sha12>" commits. */
export function trainBase(git: Git, head: string): { base: string; slots: number } | { error: string } | null {
  const log = git(["log", "--first-parent", "--max-count=" + (MAX_PREFIXES + 1), "--format=%H%x00%P%x00%s", head]);
  if (!log.ok) return { error: "cannot walk " + head.slice(0, 12) + "'s first parents (" + log.out.split("\n")[0] + ")" };
  let last: { index: number; parents: string[] } | null = null;
  let slots = 0;
  for (const line of log.out.split("\n")) {
    const [, parents = "", subject = ""] = line.split("\0");
    const m = PREFIX_SUBJECT.exec(subject);
    const ps = parents.split(" ").filter(Boolean);
    if (!m || ps.length !== 2) break;
    const index = Number(m[1]);
    if (last && index !== last.index - 1) return { error: "train T" + index + " follows T" + last.index };
    if (!last) slots = index;
    last = { index, parents: ps };
  }
  if (!last) return null;
  if (last.index !== 1) return { error: head.slice(0, 12) + " has no T1 within " + MAX_PREFIXES + " first parents" };
  return { base: last.parents[0]!, slots };
}

export interface TrainPolicy {
  record_artifact: string;
  full_gate_check: string;
}

/** The train block of .gstack/ship-policy.json at a commit, or null when it has none. */
export function trainPolicy(git: Git, commit: string): TrainPolicy | null {
  const r = git(["show", commit + ":.gstack/ship-policy.json"]);
  if (!r.ok) return null;
  try {
    const train = (JSON.parse(r.out) as { train?: Partial<TrainPolicy> | null }).train;
    const ok = (s: unknown) => typeof s === "string" && /^[A-Za-z0-9._/-]{1,100}$/.test(s);
    return train && ok(train.record_artifact) && ok(train.full_gate_check) ? { record_artifact: train.record_artifact!, full_gate_check: train.full_gate_check! } : null;
  } catch {
    return null;
  }
}

export interface RouteInput {
  refName: string;
  head: string;
  expectedSha: string;
  nonce: string;
  evalsAll: boolean;
  cases: string;
  prefixShas: string;
}
export type RunMode = "train" | "bisect" | "dispatch";
export interface Route {
  mode: RunMode;
  cases: string[];
  prefixes: string[];
}

/**
 * The run's mode from a dispatch's inputs, or why it is refused (modeled on gstack's scripts/train-gate.ts routeDispatch).
 * Trains and bisects run only on train/<nonce> under a train policy at the train's base; a bisect's cases must be in the base's
 * gate and each prefix an ancestor of the head. Any other dispatch runs the gate and publishes nothing.
 */
export function routeDispatch(
  i: RouteInput,
  deps: { isAncestor(commit: string, head: string): boolean; caseIds: Set<string>; train: { base: string; slots: number } | null; policy: TrainPolicy | null },
): Route | { error: string } {
  const purpose = i.nonce ? noncePurpose(i.nonce) : null;
  const needsTrain = (mode: string) => {
    if (!i.refName.startsWith("train/")) return { error: "a " + mode + " runs on train/<nonce>, not " + i.refName };
    if (i.expectedSha !== i.head) return { error: "expected_sha " + (i.expectedSha.slice(0, 12) || "(empty)") + " is not the train head " + i.head.slice(0, 12) };
    if (!deps.train) return { error: i.head.slice(0, 12) + " is not a train head (no T1..Tk merge chain)" };
    if (!deps.policy) return { error: "a " + mode + " needs a train block in .gstack/ship-policy.json at the train's base " + deps.train.base.slice(0, 12) };
    return null;
  };
  if (i.cases || i.prefixShas || purpose === "bisect") {
    if (purpose !== "bisect") return { error: "a bisect needs a bisect nonce (got " + JSON.stringify(i.nonce) + ")" };
    const refused = needsTrain("bisect");
    if (refused) return refused;
    const cases = list(i.cases);
    const prefixes = list(i.prefixShas);
    if (!cases.length || cases.length > MAX_BISECT_CASES || new Set(cases).size !== cases.length) return { error: "cases must name 1 to " + MAX_BISECT_CASES + " distinct case ids" };
    if (!prefixes.length || prefixes.length > MAX_PREFIXES || new Set(prefixes).size !== prefixes.length) return { error: "prefix_shas must name 1 to " + MAX_PREFIXES + " distinct commits" };
    const bad = prefixes.find((sha) => !SHA.test(sha));
    if (bad) return { error: "prefix " + JSON.stringify(bad) + " is not a full commit SHA" };
    const outside = prefixes.find((sha) => !deps.isAncestor(sha, i.head));
    if (outside) return { error: "prefix " + outside.slice(0, 12) + " is not an ancestor of the train head " + i.head.slice(0, 12) };
    const unknown = cases.filter((id) => !deps.caseIds.has(id));
    if (unknown.length) return { error: "case(s) not in the base's " + STAGE + " gate: " + unknown.slice(0, 5).join(", ") };
    return { mode: "bisect", cases, prefixes };
  }
  if (purpose === "train") {
    if (!i.evalsAll) return { error: "a train gate is the full gate: dispatch it with evals_all=true" };
    return needsTrain("train gate") ?? { mode: "train", cases: [], prefixes: [] };
  }
  if (i.nonce) return { error: "nonce " + JSON.stringify(i.nonce) + " is not a train or bisect nonce" };
  if (i.expectedSha && i.expectedSha !== i.head) return { error: "expected_sha " + i.expectedSha.slice(0, 12) + " is not the checked-out head " + i.head.slice(0, 12) };
  return { mode: "dispatch", cases: [], prefixes: [] };
}

const unescapeXml = (s: string) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** Names of the passing tests in a JUnit report; a test with a failure, error or skipped element is not passing. */
export function passingTests(xml: string): Set<string> {
  const passing = new Set<string>();
  for (const m of xml.matchAll(/<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g)) {
    const name = /\bname="([^"]*)"/.exec(m[1] ?? "")?.[1];
    if (name !== undefined && !/<(failure|error|skipped)\b/.test(m[2] ?? "")) passing.add(unescapeXml(name));
  }
  return passing;
}

export interface RunOptions {
  root: string;
  env: Record<string, string>;
  only?: string[];
  timeoutMs?: number;
  log?: (line: string) => void;
}

/** Runs each case in the repo root and judges it: a command by its exit code, a junit case also by its named tests. */
export function runCases(cases: GateCase[], o: RunOptions): CasePanel[] {
  const log = o.log ?? say;
  const panels: CasePanel[] = [];
  for (const c of o.only ? cases.filter((x) => o.only!.includes(x.id)) : cases) {
    const scratch = mkdtempSync(join(tmpdir(), "gate-"));
    const junit = join(scratch, "junit.xml");
    const started = Date.now();
    if (process.env.GITHUB_ACTIONS) log("::group::" + c.id);
    const r = spawnSync("bash", ["--noprofile", "--norc", "-o", "pipefail", "-c", c.run], {
      cwd: o.root,
      env: { ...process.env, ...o.env, GATE_JUNIT: junit },
      stdio: ["ignore", "inherit", "inherit"],
      timeout: o.timeoutMs ?? CASE_TIMEOUT_MS,
    });
    if (process.env.GITHUB_ACTIONS) log("::endgroup::");
    let status: CasePanel["status"] = r.status === 0 ? "PASS" : "FAIL";
    let note = r.status === 0 ? "" : " (exit " + r.status + ")";
    if (r.error || r.signal) {
      status = "INFRA";
      note = " (" + (r.error ? r.error.message : "killed by " + r.signal) + ")";
    } else if (c.kind === "junit" && status === "PASS") {
      let xml = "";
      try {
        xml = readFileSync(junit, "utf8");
      } catch {
        xml = "";
      }
      const passing = passingTests(xml);
      const missing = c.tests!.filter((t) => !passing.has(t));
      if (missing.length) {
        status = "FAIL";
        note = " (absent, skipped or failing: " + missing.join("; ") + ")";
      }
    }
    rmSync(scratch, { recursive: true, force: true });
    panels.push({ case: c.id, kind: c.kind, status, red_class: status === "PASS" ? null : status === "INFRA" ? "INFRA" : "VERDICT", cost_usd: 0 });
    log("GATE: " + c.id + " " + status + note + " " + Math.round((Date.now() - started) / 1000) + "s");
  }
  return panels;
}

/** The census of a gate run: every planned case must have run and passed for a GREEN verdict. */
export function census(planned: GateCase[], panels: CasePanel[]): Census {
  const executed = panels.filter((p) => p.status === "PASS" || p.status === "FAIL").length;
  const complete = planned.length > 0 && panels.length === planned.length && panels.every((p, n) => p.case === planned[n]!.id && p.status === "PASS");
  return {
    complete,
    planned: { rule: planned.length, judge: 0 },
    executed: { rule: executed, judge: 0 },
    unbound: 0,
    partial_shards: 0,
    cancelled_shards: 0,
    killed_before_upload: 0,
  };
}

export function trainRecord(o: { nonce: string; head: string; tree: string; base: string; planned: GateCase[]; panels: CasePanel[] }): TrainGateRecord {
  const c = census(o.planned, o.panels);
  return { schema: 1, kind: "train-gate", nonce: o.nonce, head_sha: o.head, tree: o.tree, verdict: c.complete ? "GREEN" : "RED", census: c, panels: o.panels, stage: STAGE, base_sha: o.base };
}

/**
 * Whether a record earns the full-gate check on the head: a complete GREEN census of the base's whole stage, bound to this
 * run's nonce, head and tree, and no gate surface change in a train of two or more PRs.
 */
export function publishable(
  raw: unknown,
  expect: { nonce: string; head: string; tree: string; planned: GateCase[]; slots: number; touched: string[]; surface: string[] },
): { ok: true; summary: string } | { error: string } {
  const rec = raw as TrainGateRecord | null;
  if (!rec || rec.schema !== 1 || rec.kind !== "train-gate" || !Array.isArray(rec.panels) || !rec.census) return { error: "no train-gate record" };
  if (rec.nonce !== expect.nonce || rec.head_sha !== expect.head || rec.tree !== expect.tree) {
    return { error: "the record is bound to nonce " + rec.nonce + " head " + String(rec.head_sha).slice(0, 12) + " tree " + String(rec.tree).slice(0, 12) + ", not this run's" };
  }
  const want = census(expect.planned, rec.panels);
  if (rec.verdict !== "GREEN" || !rec.census.complete || !want.complete) {
    const gaps = rec.panels.filter((p) => p.status !== "PASS").map((p) => p.case + " " + p.status);
    return { error: "not a complete green census of the base's " + STAGE + " gate (" + (gaps.join(", ") || rec.panels.length + "/" + expect.planned.length + " cases") + ")" };
  }
  if (expect.slots > 1) {
    const globs = expect.surface.map((g) => new Bun.Glob(g));
    const hit = expect.touched.filter((f) => globs.some((g) => g.match(f)));
    if (hit.length) return { error: "a " + expect.slots + "-PR train touches the gate surface (" + hit.slice(0, 5).join(", ") + "); a gate surface PR rides alone" };
  }
  return { ok: true, summary: "rule " + want.executed.rule + "/" + want.planned.rule + " passed at " + expect.head.slice(0, 12) + " (tree " + expect.tree.slice(0, 12) + ")" };
}

function flag(args: string[], name: string, fallback = ""): string {
  const at = args.indexOf("--" + name);
  return at >= 0 ? (args[at + 1] ?? "") : fallback;
}

function fail(message: string): never {
  console.error("gate: " + message);
  process.exit(1);
}

function loadManifest(file: string): GateManifest {
  let text = "";
  try {
    text = readFileSync(file, "utf8");
  } catch {
    fail("cannot read " + file);
  }
  const m = parseManifest(text);
  if ("error" in m) fail(m.error);
  return m;
}

function rev(git: Git, spec: string): string {
  const r = git(["rev-parse", "--verify", "--quiet", spec]);
  if (!r.ok || !r.out) fail("cannot resolve " + spec);
  return r.out;
}

function defaultBranch(git: Git): string {
  const r = git(["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
  return process.env.GATE_DEFAULT_BRANCH || (r.ok && r.out.startsWith("origin/") ? r.out.slice("origin/".length) : "main");
}

function writeJson(file: string, value: unknown) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

const USAGE = [
  "usage: bun scripts/gate.ts run [--root <dir>] [--base <commit>] [--nonce <nonce>] [--out <file>]",
  "       bun scripts/gate.ts bisect [--root <dir>] [--base <commit>] --cases <id,...> --nonce <nonce> --out <file>",
  "       bun scripts/gate.ts route --repo <dir> --base <commit> [--github-output <file>]",
  "       bun scripts/gate.ts publish --repo <dir> --record <file> --nonce <nonce> --head <sha>",
].join("\n");

if (import.meta.main) {
  const [command = "", ...args] = process.argv.slice(2);
  const manifestFile = flag(args, "manifest", join(import.meta.dir, "..", "gate", "manifest.json"));
  if (command === "run" || command === "bisect") {
    const manifest = loadManifest(manifestFile);
    const planned = manifest.stages[STAGE]!;
    const root = gitIn(flag(args, "root") || process.cwd())(["rev-parse", "--show-toplevel"]).out || fail("not inside a git work tree");
    const git = gitIn(root);
    const head = rev(git, "HEAD");
    const branch = defaultBranch(git);
    const train = trainBase(git, head);
    const base =
      flag(args, "base") ||
      (train && !("error" in train) ? train.base : "") ||
      git(["merge-base", "HEAD", "origin/" + branch]).out ||
      head;
    const env = { GATE_BASE: rev(git, base + "^{commit}"), GATE_HEAD: head, GATE_DEFAULT_BRANCH: branch };
    const out = flag(args, "out");
    const nonce = flag(args, "nonce");
    if (command === "bisect") {
      const cases = list(flag(args, "cases"));
      const unknown = cases.filter((id) => !planned.some((c) => c.id === id));
      if (!cases.length || unknown.length) fail("--cases must name cases of the " + STAGE + " gate" + (unknown.length ? " (unknown: " + unknown.join(", ") + ")" : ""));
      if (!out || !nonce) fail("bisect needs --nonce and --out");
      const panels = runCases(planned, { root, env, only: cases });
      const record: BisectPrefixRecord = { schema: 1, kind: "train-bisect-prefix", nonce, prefix_sha: head, checked_out_sha: head, panels };
      writeJson(out, record);
      say("GATE: bisect prefix " + head.slice(0, 12) + ": " + panels.map((p) => p.case + "=" + p.status).join(" "));
      process.exit(0);
    }
    say("GATE: stage " + STAGE + " at " + head.slice(0, 12) + ", base " + env.GATE_BASE.slice(0, 12) + ", " + planned.length + " cases");
    const panels = runCases(planned, { root, env });
    const record = trainRecord({ nonce, head, tree: rev(git, "HEAD^{tree}"), base: env.GATE_BASE, planned, panels });
    if (out) writeJson(out, record);
    say("GATE: " + record.verdict + " rule " + record.census.executed.rule + "/" + record.census.planned.rule + (out ? " (record " + out + ")" : ""));
    process.exit(record.verdict === "GREEN" ? 0 : 1);
  } else if (command === "route") {
    const git = gitIn(flag(args, "repo") || fail("route needs --repo"));
    const head = rev(git, "HEAD");
    const found = trainBase(git, head);
    if (found && "error" in found) fail("route refused: " + found.error);
    const base = found?.base ?? head;
    if (flag(args, "base") !== base) fail("route refused: the workflow's base " + (flag(args, "base") || "(none)") + " is not the train's base " + base);
    const manifest = loadManifest(manifestFile);
    const policy = trainPolicy(git, base);
    const e = process.env;
    const route = routeDispatch(
      { refName: e.GITHUB_REF_NAME ?? "", head, expectedSha: e.EXPECTED_SHA ?? "", nonce: e.NONCE ?? "", evalsAll: e.EVALS_ALL === "true", cases: e.CASES ?? "", prefixShas: e.PREFIX_SHAS ?? "" },
      {
        isAncestor: (commit, h) => spawnSync("git", ["merge-base", "--is-ancestor", commit, h], { cwd: flag(args, "repo") }).status === 0,
        caseIds: new Set(manifest.stages[STAGE]!.map((c) => c.id)),
        train: found,
        policy,
      },
    );
    if ("error" in route) fail("route refused: " + route.error);
    const outputs = {
      mode: route.mode,
      base,
      slots: String(found?.slots ?? 0),
      cases: route.cases.join(","),
      prefixes: JSON.stringify(route.prefixes),
      record_artifact: policy?.record_artifact ?? "gate-record",
      full_gate_check: policy?.full_gate_check ?? "",
    };
    const lines = Object.entries(outputs).map(([k, v]) => k + "=" + v);
    if (flag(args, "github-output")) writeFileSync(flag(args, "github-output"), lines.join("\n") + "\n", { flag: "a" });
    for (const line of lines) say("ROUTE: " + line);
  } else if (command === "publish") {
    const git = gitIn(flag(args, "repo") || fail("publish needs --repo"));
    const head = flag(args, "head");
    if (!SHA.test(head)) fail("publish needs --head <full sha>");
    const found = trainBase(git, head);
    if (!found || "error" in found) fail("publish refused: " + (found ? found.error : head.slice(0, 12) + " is not a train head"));
    const manifest = loadManifest(manifestFile);
    let raw: unknown = null;
    try {
      raw = JSON.parse(readFileSync(flag(args, "record") || fail("publish needs --record"), "utf8"));
    } catch {
      raw = null;
    }
    const touched = git(["diff", "--name-only", "--no-renames", found.base, head]);
    if (!touched.ok) fail("publish refused: cannot diff the train (" + touched.out + ")");
    const verdict = publishable(raw, {
      nonce: flag(args, "nonce"),
      head,
      tree: rev(git, head + "^{tree}"),
      planned: manifest.stages[STAGE]!,
      slots: found.slots,
      touched: touched.out.split("\n").filter(Boolean),
      surface: manifest.gate_surface,
    });
    if ("error" in verdict) fail("publish refused: " + verdict.error);
    say("PUBLISH: green " + verdict.summary);
  } else {
    console.error(USAGE);
    process.exit(2);
  }
}
