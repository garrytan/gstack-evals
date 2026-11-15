// Copyright (c) 2026 Garry Tan. MIT License.
// From a frozen frame row to an oracled B unit (plan section 6). buildB fetches the fix and its parent into a partial
// clone, reads the repository facts, picks the ecosystem's recipe and builds the image at the parent. prepareB starts
// from the stored digest only: it reads the problem statement (B1: the closing issue, checked against the frozen
// sha256; B2: the advisory's summary and details with fix URLs and commit ids stripped, attributed under CC-BY-4.0),
// runs the told-mode screen, runs discovery in the image, then tries the candidate runners in their frozen order. The
// first runner whose test plan finds at least one fail-to-pass and one pass-to-pass test over the fix's test files (one
// base run with the fix's tests applied, one fixed run) is the unit's runner. B1 then takes the browser-engine check.
// The unit dir is written in the state machines' sm-unit.v1 format, and oracleB runs the state machines oracle on it:
// 5 base and 5 fixed runs with the browser conditions for B1, 3 and 3 for B2.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { toldScreen } from "../../pfchecks/told.ts";
import type { Lang } from "../../statemachines/langs.ts";
import { oracleUnit, type Pacer } from "../../statemachines/oracle.ts";
import { extraArgs, passed, type RunExtra } from "../../statemachines/testrun.ts";
import { added30, readUnit, type SmUnit } from "../../statemachines/unit.ts";
import { H2hError, h2hFail, readPrereg, type H2hPrereg } from "../prereg.ts";
import { BROWSER } from "../types.ts";
import { B1_SCHEMA, isBrowserTest, statementText, type B1Row, type Runner } from "./b1.ts";
import { ADVISORY_DB, B2_SCHEMA, type B2Row } from "./b2.ts";
import { browserCheck, type BrowserCheck } from "./browser.ts";
import { buildImage, dockerOn, WRAPPER, type BuilderHost } from "./build.ts";
import { discoveryScript, readDiscovery, type Collector } from "./discover.ts";
import { ECOSYSTEM_LANG, fileClass, sha256, writeJson, type Gql } from "./frame.ts";
import { parseLocal, REPO_ROOT_IN_IMAGE, unitParser, type ReportFormat } from "./parse.ts";
import { candidateRunners, chooseRecipe, deps, isDrop, testPlan, type Drop, type Ecosystem, type Recipe, type RepoFacts, type TestPlan, type TestRunner } from "./recipes.ts";
import { assertStored, type ImageStore } from "./store.ts";

export type BKind = "B1" | "B2";
export interface BCandidate {
  kind: BKind; id: string; repo: string; ecosystems: Ecosystem[]; month: string; created_at: string; pull: string;
  fix: { commit: string; parent: string }; licence: string | null; second_read_pending: boolean; runners: Runner[];
  issue_url?: string; statement_sha256?: string; ghsa?: string; advisory_path?: string;
}

export const unitId = (repo: string, tail: string): string => (repo.replace("/", "__") + "-" + tail).toLowerCase();
export const repoUrl = (repo: string): string => "https://github.com/" + repo + ".git";

export function candidateOf(kind: BKind, row: B1Row | B2Row): BCandidate {
  if (kind === "B1") {
    const r = row as B1Row;
    return { kind, id: unitId(r.repo, String(r.number)), repo: r.repo, ecosystems: ["npm"], month: r.month, created_at: r.merged, pull: String(r.number), fix: r.fix, licence: r.licence, second_read_pending: r.second_read_pending, runners: r.runners, issue_url: r.issue_url, statement_sha256: r.statement_sha256 };
  }
  const r = row as B2Row;
  return { kind, id: unitId(r.repo, r.ghsa), repo: r.repo, ecosystems: r.ecosystem.split("+") as Ecosystem[], month: r.month, created_at: r.published, pull: r.fix.kind === "pull" ? r.fix.ref : "", fix: { commit: r.fix.commit, parent: r.fix.parent }, licence: r.licence, second_read_pending: r.second_read_pending, runners: [], ghsa: r.ghsa, advisory_path: r.advisory_path };
}

/** The candidate a frame file holds under id (the B1 or B2 frame the miners wrote). */
export function findCandidate(framePath: string, id: string): BCandidate {
  const f = JSON.parse(readFileSync(framePath, "utf8"));
  const kind: BKind = f.schema === B1_SCHEMA ? "B1" : f.schema === B2_SCHEMA ? "B2" : h2hFail("E_H2H_B_MINE", framePath + " is not a B1 or B2 frame");
  const rows: (B1Row | B2Row)[] = kind === "B1" ? f.pull_requests : f.advisories;
  const c = rows.map((r) => candidateOf(kind, r)).find((c) => c.id === id);
  return c ?? h2hFail("E_H2H_B_MINE", id + " is not in " + framePath);
}

const git = (dir: string, args: string[]) => {
  const r = spawnSync("git", ["-C", dir, "-c", "core.quotepath=off", ...args], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024, timeout: 900_000, env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", GIT_TERMINAL_PROMPT: "0" } });
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
};

/** A bare partial clone under work/git holding the fix commit and its parent (blobs fetched on demand). */
export function fetchFix(work: string, c: BCandidate): string | Drop {
  const dir = join(work, "git", c.repo.replace("/", "__") + ".git");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    git(dir, ["init", "-q", "--bare"]);
    git(dir, ["remote", "add", "origin", repoUrl(c.repo)]);
  }
  const have = (sha: string) => git(dir, ["cat-file", "-e", sha + "^{commit}"]).status === 0;
  if (!have(c.fix.commit) || !have(c.fix.parent)) git(dir, ["fetch", "-q", "--filter=blob:none", "--depth=2", "origin", c.fix.commit]);
  return have(c.fix.commit) && have(c.fix.parent) ? dir : { code: "E_H2H_B_MINE", rule: "fix_fetch_failed" };
}

const ROOT_TEXTS = ["package.json", ".nvmrc", ".node-version", "go.mod", "pom.xml", "global.json", ".yarnrc.yml"] as const;

/** What the recipe rules read at the parent: every tracked path and the root files they name. */
export function repoFacts(dir: string, parent: string): RepoFacts {
  const files = git(dir, ["ls-tree", "-r", "--name-only", "-z", parent]).stdout.split("\0").filter(Boolean);
  const texts: RepoFacts["texts"] = {};
  for (const p of ROOT_TEXTS) if (files.includes(p)) texts[p] = git(dir, ["show", parent + ":" + p]).stdout;
  return { files, texts };
}

export interface Patches { fix: string; test: string; all: string[]; testFiles: string[]; fixFiles: string[]; sourceFiles: string[] }

/** The fix split by file: test.patch holds its test files (B1 adds the browser-test path rule), fix.patch the rest. */
export function fixPatches(dir: string, c: BCandidate): Patches {
  const langs = c.ecosystems.map((e) => ECOSYSTEM_LANG[e]!);
  const all = git(dir, ["diff", "--name-only", "-z", "--no-renames", c.fix.parent, c.fix.commit]).stdout.split("\0").filter(Boolean);
  const isTest = (p: string) => (c.kind === "B1" && isBrowserTest(p)) || fileClass(langs, p) === "test";
  const testFiles = all.filter(isTest), fixFiles = all.filter((p) => !isTest(p));
  const diff = (paths: string[]) => (paths.length ? git(dir, ["diff", "--binary", "--full-index", "--no-renames", c.fix.parent, c.fix.commit, "--", ...paths.map((p) => ":(literal)" + p)]).stdout : "");
  return { fix: diff(fixFiles), test: diff(testFiles), all, testFiles, fixFiles, sourceFiles: fixFiles.filter((p) => fileClass(langs, p) === "source") };
}

export const ATTRIBUTION = (ghsa: string) => "Adapted from GitHub Advisory Database advisory " + ghsa + " (" + ADVISORY_DB.licence + ").";

/** B2's problem statement body: summary, a blank line, details; URLs to commits, pull requests and compares, every
 *  reference the advisory marks FIX, and any 40-hex id or prefix of the fix commit or its parent are removed. The
 *  told-mode screen reads this body; the statement adds the attribution line after it. */
export function b2Body(adv: { summary?: string; details?: string; references?: { type?: string; url?: string }[] }, fix: { commit: string; parent: string }): string {
  const fixUrls = (adv.references ?? []).filter((r) => r.type === "FIX" && r.url).map((r) => r.url!);
  const strip = (s: string) => {
    let t = s;
    for (const u of fixUrls) t = t.split(u).join("");
    return t.replace(/https?:\/\/\S*?\/(commit|commits|pull|compare)\/[^\s)\]>]*/gi, "").replace(/\b[0-9a-f]{7,40}\b/gi, (m) => (m.length === 40 || fix.commit.startsWith(m.toLowerCase()) || fix.parent.startsWith(m.toLowerCase()) ? "" : m));
  };
  return (strip(adv.summary ?? "").trim() + "\n\n" + strip(adv.details ?? "").trim()).trim();
}

/** B1's statement: the closing issue read again and checked against the frozen sha256. */
export async function b1Statement(gql: Gql, c: BCandidate): Promise<string | Drop> {
  const r = await gql("{ resource(url: " + JSON.stringify(c.issue_url) + ") { ... on Issue { title body } } }");
  const i = r.data?.resource;
  if (!i?.title) return { code: "E_H2H_B_MINE", rule: "issue_unreadable" };
  const text = statementText(i.title, i.body);
  return sha256(text) === c.statement_sha256 ? text : { code: "E_H2H_B_MINE", rule: "statement_changed_since_freeze" };
}

/** Section 3's browser conditions for the test container: a 2 GB /dev/shm, the launcher wrapper and its environment. */
export const browserExtra = (): RunExtra => ({ shmSize: BROWSER.shm_size, mounts: [{ src: WRAPPER, dst: BROWSER.wrapper_container_path }], env: { ...BROWSER.env } });

export interface BuildRecord { schema: "h2h-b-build.v1"; id: string; kind: BKind; verdict: "built" | string; rule: string | null; ecosystem?: Ecosystem; recipe?: Recipe; tag?: string; image_id?: string; wall_ms?: number; dockerfile_sha256?: string; log_tail?: string }

/** Builds a candidate's image. B2 tries its advisory's ecosystems in order and takes the first recipe that applies. */
export function buildB(o: { c: BCandidate; work: string; host?: BuilderHost; limitMs?: number }): BuildRecord {
  const rec: BuildRecord = { schema: "h2h-b-build.v1", id: o.c.id, kind: o.c.kind, verdict: "", rule: null };
  const out = (r: Partial<BuildRecord>) => {
    Object.assign(rec, r);
    writeJson(join(o.work, "builds", o.c.id + ".json"), rec);
    return rec;
  };
  const dir = fetchFix(o.work, o.c);
  if (isDrop(dir)) return out({ verdict: dir.code, rule: dir.rule });
  const facts = repoFacts(dir, o.c.fix.parent);
  let first: Drop | null = null;
  for (const e of o.c.ecosystems) {
    const recipe = chooseRecipe(o.c.kind, e, facts);
    if (isDrop(recipe)) {
      first ??= recipe;
      continue;
    }
    const b = buildImage({ recipe, repoUrl: repoUrl(o.c.repo), parent: o.c.fix.parent, tag: "h2h-b/" + o.c.id, host: o.host, limitMs: o.limitMs });
    if (isDrop(b)) return out({ verdict: b.code, rule: b.rule, ecosystem: e, recipe, log_tail: b.log_tail });
    return out({ verdict: "built", ecosystem: e, recipe, tag: b.tag, image_id: b.image_id, wall_ms: b.wall_ms, dockerfile_sha256: sha256(b.dockerfile) });
  }
  return out({ verdict: first!.code, rule: first!.rule });
}

function inImage(host: BuilderHost, image: string, script: string, extra: RunExtra | undefined, limitMs: number) {
  return dockerOn(host, ["run", "--rm", "-i", "--network", "none", ...extraArgs(extra), "--entrypoint", "bash", image, "-s"], { input: script, timeoutMs: limitMs });
}

const applyLine = (name: string, patch: string) => (patch ? "printf '%s' '" + Buffer.from(patch).toString("base64") + "' | base64 -d > /tmp/" + name + " && git apply --whitespace=nowarn /tmp/" + name + " || { echo H2H_APPLY_FAILED " + name + "; exit 0; }" : "");

/** One base run (the fix's tests applied) and one fixed run (tests and fix). Fail-to-pass: passes fixed, not base.
 *  Pass-to-pass: passes on both. */
export function deriveTests(o: { host: BuilderHost; image: string; plan: TestPlan; test: string; fix: string; extra?: RunExtra; limitMs?: number }): { f2p: string[]; p2p: string[]; base_ids: number; fixed_ids: number } | Drop {
  const run = (withFix: boolean): Record<string, string> | Drop => {
    const script = ["cd " + REPO_ROOT_IN_IMAGE, applyLine("h2h-test.patch", o.test), withFix ? applyLine("h2h-fix.patch", o.fix) : "", ...o.plan.commands.rebuild, ...o.plan.commands.test.map((c) => "(" + c + ") || true"), ...o.plan.commands.print].filter(Boolean).join("\n") + "\n";
    const r = inImage(o.host, o.image, script, o.extra, o.limitMs ?? 1_800_000);
    if (r.stdout.includes("H2H_APPLY_FAILED")) return { code: "E_H2H_B_NO_TESTS", rule: (withFix ? "fix" : "test") + "_patch_does_not_apply" };
    if (r.timed_out) return { code: "E_H2H_B_NO_TESTS", rule: "discovery_run_time_limit" };
    return parseLocal(o.plan.format, r.stdout);
  };
  const base = run(false);
  if (isDrop(base)) return base;
  const fixed = run(true);
  if (isDrop(fixed)) return fixed;
  const ids = Object.keys(fixed).sort();
  return { f2p: ids.filter((id) => passed(fixed, id) && !passed(base, id)), p2p: ids.filter((id) => passed(fixed, id) && passed(base, id)), base_ids: Object.keys(base).length, fixed_ids: ids.length };
}

const PAYLOAD = ["fix.patch", "test.patch", "issue.md", "parser.py", "harbor/task.toml", "harbor/environment/Dockerfile", "harbor/instruction.md"];

export interface BUnitExtra { kind: BKind; image_ref: string; runner: TestRunner; format: ReportFormat; ecosystem: Ecosystem; licence: string | null; second_read_pending: boolean; issue_url?: string; statement_sha256: string; ghsa?: string; browser?: BrowserCheck; build: { image_id: string; dockerfile_sha256: string } }

/** Writes one B unit dir in sm-unit.v1 format (exclusive: an existing dir refuses). unit.json carries an h2h block. */
export function writeBUnit(dir: string, o: { c: BCandidate; lang: Lang; plan: TestPlan; patches: Patches; statement: string; tests: { f2p: string[]; p2p: string[] }; h2h: BUnitExtra }): SmUnit & { h2h: BUnitExtra } {
  if (existsSync(dir)) h2hFail("E_H2H_B_STORE", dir + " exists; a B unit dir is written once");
  const ref = o.h2h.image_ref;
  const body: Record<string, string> = {
    "fix.patch": o.patches.fix, "test.patch": o.patches.test, "issue.md": o.statement, "parser.py": unitParser(o.plan.format),
    "harbor/task.toml": ["version = \"1.0\"", "", "[metadata]", "id = " + JSON.stringify(o.c.id), "", "[agent]", "timeout_sec = 5400", "", "[verifier]", "timeout_sec = 900", "", "[environment]", "docker_image = " + JSON.stringify(ref), ""].join("\n"),
    "harbor/environment/Dockerfile": "FROM " + ref + "\n",
    "harbor/instruction.md": o.statement,
  };
  mkdirSync(dir, { recursive: true });
  for (const p of PAYLOAD) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), body[p]!, { flag: "wx" });
  }
  const u = {
    schema: "sm-unit.v1", id: o.c.id, source: ("h2h-" + o.c.kind.toLowerCase()) as unknown as SmUnit["source"], revision: o.c.kind === "B2" ? ADVISORY_DB.commit : "h2h-b1-frame.v1", repo: o.c.repo, pull_number: o.c.pull,
    created_at: o.c.created_at, month: o.c.month, lang: o.lang, base_commit: o.c.fix.parent, repo_dir: "", work_dir: "",
    image: { ref, image_id: null, runtime_id: null }, commands: o.plan.commands, parser_sha256: sha256(body["parser.py"]!),
    fix: { files: o.patches.sourceFiles, all_files: o.patches.all, added_lines_30: added30(o.patches.fix).length, sha256: sha256(o.patches.fix) },
    test_patch: { files: o.patches.testFiles, sha256: sha256(o.patches.test) }, tests: o.tests,
    scope: null, file_scope: o.patches.all, strip: null, labels: null, oracle: null,
    files: Object.fromEntries(PAYLOAD.map((p) => [p, sha256(body[p]!)])), h2h: o.h2h,
  } satisfies SmUnit & { h2h: BUnitExtra };
  writeFileSync(join(dir, "unit.json"), JSON.stringify(u, null, 1) + "\n", { flag: "wx" });
  return u;
}

export interface PrepRecord { schema: "h2h-b-prep.v1"; id: string; kind: BKind; verdict: "ready" | string; rule: string | null; ref: string; runner?: TestRunner; tried: { runner: string; code: string; rule: string }[]; tests?: { f2p: number; p2p: number }; told?: string | null; browser?: BrowserCheck; unit_dir?: string }

/** Everything between the stored image and the unit dir. Works only from the stored digest (assertStored first). */
export async function prepareB(o: { c: BCandidate; work: string; ref: string; store: ImageStore; build: BuildRecord; host?: BuilderHost; gql?: Gql; db?: string }): Promise<PrepRecord> {
  const c = o.c;
  const rec: PrepRecord = { schema: "h2h-b-prep.v1", id: c.id, kind: c.kind, verdict: "", rule: null, ref: o.ref, tried: [] };
  const out = (r: Partial<PrepRecord>) => {
    Object.assign(rec, r);
    writeJson(join(o.work, "prep", c.id + ".json"), rec);
    return rec;
  };
  try {
    assertStored(o.store, o.ref);
    if (o.build.verdict !== "built" || !o.build.ecosystem || !o.build.image_id) return out({ verdict: "E_H2H_B_BUILD", rule: "no_built_image" });
    const dir = fetchFix(o.work, c);
    if (isDrop(dir)) return out({ verdict: dir.code, rule: dir.rule });
    const patches = fixPatches(dir, c);
    let statement: string, toldText: string;
    if (c.kind === "B1") {
      const s = await b1Statement(o.gql ?? h2hFail("E_H2H_B_MINE", "B1 needs a GitHub GraphQL client for the issue text"), c);
      if (isDrop(s)) return out({ verdict: s.code, rule: s.rule });
      statement = toldText = s;
    } else {
      const adv = JSON.parse(readFileSync(join(o.db ?? h2hFail("E_H2H_B_MINE", "B2 needs the pinned advisory database dir"), c.advisory_path!), "utf8"));
      toldText = b2Body(adv, c.fix);
      statement = toldText + "\n\n" + ATTRIBUTION(c.ghsa!) + "\n";
    }
    const told = toldScreen(toldText, patches.fix);
    if (told) return out({ verdict: "E_H2H_B_TOLD", rule: told.rule, told: told.rule });
    const facts = repoFacts(dir, c.fix.parent);
    const runners = candidateRunners(c.kind, o.build.ecosystem, facts, c.runners);
    if (isDrop(runners)) return out({ verdict: runners.code, rule: runners.rule });
    const host = o.host ?? {};
    const image = o.store.pull(o.ref);
    const extra = c.kind === "B1" ? browserExtra() : undefined;
    const dp = deps(facts);
    const collectors: Collector[] = [...(dp.has("vitest") ? ["vitest" as const] : []), ...(runners.includes("playwright") ? ["playwright" as const] : []), ...(dp.has("jest") ? ["jest" as const] : []), ...(runners.includes("cargo") ? ["cargo" as const] : [])];
    const dlog = inImage(host, image, discoveryScript(collectors, patches.testFiles), extra, 900_000).stdout;
    mkdirSync(join(o.work, "prep"), { recursive: true });
    writeFileSync(join(o.work, "prep", c.id + ".discovery.txt"), dlog);
    const d = readDiscovery(dlog);
    facts.retries = d.retries;
    for (const runner of runners) {
      const plan = testPlan(runner, patches.testFiles, facts, d.discovered);
      if (isDrop(plan)) {
        rec.tried.push({ runner, code: plan.code, rule: plan.rule });
        continue;
      }
      const t = deriveTests({ host, image, plan, test: patches.test, fix: patches.fix, extra });
      if (isDrop(t)) {
        rec.tried.push({ runner, code: t.code, rule: t.rule });
        continue;
      }
      if (!t.f2p.length || !t.p2p.length) {
        rec.tried.push({ runner, code: "E_H2H_B_NO_TESTS", rule: !t.f2p.length ? "no_fail_to_pass" : "no_pass_to_pass" });
        continue;
      }
      let browser: BrowserCheck | undefined;
      if (c.kind === "B1") {
        browser = browserCheck({ runner, format: plan.format, f2p: t.f2p, testFiles: patches.testFiles, discovery: d });
        if (!browser.ok) return out({ verdict: "E_H2H_B_BROWSER", rule: browser.rule, runner, tests: { f2p: t.f2p.length, p2p: t.p2p.length }, browser });
      }
      const unitDir = join(o.work, "units", c.id);
      writeBUnit(unitDir, {
        c, lang: ECOSYSTEM_LANG[o.build.ecosystem]!, plan, patches, statement, tests: { f2p: t.f2p, p2p: t.p2p },
        h2h: { kind: c.kind, image_ref: o.ref, runner, format: plan.format, ecosystem: o.build.ecosystem, licence: c.licence, second_read_pending: c.second_read_pending, issue_url: c.issue_url, statement_sha256: sha256(statement), ghsa: c.ghsa, browser, build: { image_id: o.build.image_id, dockerfile_sha256: o.build.dockerfile_sha256 ?? "" } },
      });
      return out({ verdict: "ready", runner, tests: { f2p: t.f2p.length, p2p: t.p2p.length }, browser, unit_dir: unitDir });
    }
    const last = rec.tried[rec.tried.length - 1];
    return out({ verdict: last?.code ?? "E_H2H_B_NO_RUNNER", rule: last?.rule ?? "no_runner_tried" });
  } catch (e) {
    if (e instanceof H2hError) return out({ verdict: e.code, rule: e.message.slice(0, 600) });
    throw e;
  }
}

/** The state machines oracle on a B unit, from its stored digest only. */
export async function oracleB(dir: string, store: ImageStore, pacer: Pacer, p: H2hPrereg = readPrereg()): Promise<{ id: string; verdict: string; detail: string }> {
  const u = readUnit(dir) as SmUnit & { h2h?: BUnitExtra };
  if (!u.h2h) return h2hFail("E_H2H_B_STORE", dir + " is not a B unit: unit.json has no h2h block with its stored digest");
  assertStored(store, u.image.ref, u.h2h.image_ref);
  return oracleUnit(dir, pacer, u.h2h.kind === "B1" ? { runs: p.classes.B.browser_oracle_runs, extra: browserExtra() } : { runs: 3 });
}
