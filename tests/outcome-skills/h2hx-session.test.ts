// Copyright (c) 2026 Garry Tan. MIT License.
// The extension's sessions (ext/session.ts), tests-added records (ext/tests.ts) and stage runner (ext/runner.ts). Harbor is a
// stub script that writes each attempt's evaluator files; part P's generation records are planted; part S reads a pinned
// Codex rollout fixture. No Docker, no key, no paid call.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { homeTreeSha256 } from "../../lanes/outcome-skills/h2h/arms/hash.ts";
import { recordPath } from "../../lanes/outcome-skills/h2h/arms/layer.ts";
import { codexExposure, readCodexEvents } from "../../lanes/outcome-skills/h2h/ext/exposure.ts";
import type { LookStop } from "../../lanes/outcome-skills/h2h/ext/look.ts";
import type { ExtPlanned } from "../../lanes/outcome-skills/h2h/ext/plan.ts";
import { analyzeExt, type ExtScore, type ExtSession, type ExtTests } from "../../lanes/outcome-skills/h2h/ext/analysis.ts";
import { readExtPrereg } from "../../lanes/outcome-skills/h2h/ext/prereg.ts";
import { runExtStage, type ExtRunnerDeps } from "../../lanes/outcome-skills/h2h/ext/runner.ts";
import { checkExtHome, extClaudeConfig, extClaudeRunCopy, extHome, firstInput, rolloutVersion, runExtSession, type ExtHome, type ExtSessionInput, type ExtSessionRecord } from "../../lanes/outcome-skills/h2h/ext/session.ts";
import { extTests } from "../../lanes/outcome-skills/h2h/ext/tests.ts";
import { readRecords } from "../../lanes/outcome-skills/h2h/analysis/commands.ts";
import { readPrereg } from "../../lanes/outcome-skills/h2h/prereg.ts";
import { scoreSession } from "../../lanes/outcome-skills/h2h/score/score.ts";
import type { ArmInstall, H2hScore, H2hUnit } from "../../lanes/outcome-skills/h2h/types.ts";

const X = readExtPrereg();
const BASE = readPrereg();
const W = mkdtempSync(join(tmpdir(), "h2hx-session-"));
afterAll(() => rmSync(W, { recursive: true, force: true }));
const FX = join(import.meta.dir, "fixtures", "h2hx-codex");
const put = (root: string, files: Record<string, string>) => {
  for (const [p, b] of Object.entries(files)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), b);
  }
};

const HARBOR = join(W, "harbor");
writeFileSync(HARBOR, `#!/usr/bin/env bun
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
const a = process.argv.slice(2);
const val = (k) => a[a.indexOf(k) + 1];
const job = val("--job-name");
const step = JSON.parse(process.env.H2HX_FAKE_PLAN)[job.endsWith("-a2") ? 1 : 0];
const ev = val("-o") + "/" + job + "/trial/evaluator";
mkdirSync(ev, { recursive: true });
for (const [p, body] of Object.entries(step.files ?? {})) {
  mkdirSync(dirname(ev + "/" + p), { recursive: true });
  writeFileSync(ev + "/" + p, typeof body === "string" ? body : JSON.stringify(body));
}
for (const [p, from] of Object.entries(step.copies ?? {})) {
  mkdirSync(dirname(ev + "/" + p), { recursive: true });
  copyFileSync(from, ev + "/" + p);
}
`);
chmodSync(HARBOR, 0o755);

const close = (usd: number, end: string) => ({ finalized: true, allowance_stops: 0, refusals: end === "error_result" ? ["UPSTREAM 529"] : [], spent_micros: usd * 1e6, usage: { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 10, cache_creation_input_tokens: 5 }, reservation_bound: 0 });
const summary = (usd: number, end: string, extra: Record<string, unknown> = {}) => ({ turns: [{ phase: "t1", termination: end, drive: {}, refusal: false }], continuations: 0, done: end === "completed", slot: { id: "slot-1", close: close(usd, end) }, ...extra });
const plan = (steps: unknown[]) => (process.env.H2HX_FAKE_PLAN = JSON.stringify(steps));

const image = { image_id: "sha256:" + "1".repeat(64), tag: "h2h-test-image:none", runtime_id: "sha256:" + "2".repeat(64), volume: "v", commits: 1, head: "a".repeat(40), home: "none", tree_patch_sha256: null, qa_home: null, removed: [] };
const unitInput = { unit: { id: "u1", class: "O", kind: "O", entry: "bug" } as H2hUnit, statement: "The flag is never reset.", repo_dir: "/testbed", work_dir: "/testbed", image } as unknown as ExtSessionInput["unit"];
const planned = (arm: ExtPlanned["arm"], item: string): ExtPlanned => ({ part: arm.startsWith("s-") ? "S" : arm.startsWith("p-") ? "P" : "L", unit: "u1", kind: "O", entry: "bug", stage: "stage1", index: 0, arm, item });
const nullHome = (arm: ExtPlanned["arm"], o: Partial<ExtHome> = {}): ExtHome => ({ arm, part: arm.startsWith("s-") ? "S" : arm.startsWith("p-") ? "P" : "L", dir: null, home_rule: "none", home_tree_sha256: null, pin: arm, ...o });
const input = (session: ExtPlanned, home: ExtHome, out: string, runtime = "h2h-runtimes-test"): ExtSessionInput => ({ session, unit: unitInput, home, control: "http://127.0.0.1:9", proxy: "http://127.0.0.1:9", out, harbor: HARBOR, claude: "/bin/true", runtime: { volume: runtime } });

describe("parts P and L on the Claude Code path", () => {
  test("a part P config takes its base arm's entries and part P's limits, and asks for the generation records", () => {
    const home = nullHome("p-gstack-oneline", { home_rule: "gstack", base_arm: "gstack-oneline" });
    const c = extClaudeConfig({ session: planned("p-gstack-oneline", "h2hx-p-pilot"), home }, "The flag is never reset.", "O");
    expect(c.turns.at(-1)).toContain(BASE.texts.oneline);
    expect(c.turns.length).toBe((BASE.entries["gstack-oneline"]?.bug ?? []).length);
    expect(c.limits).toMatchObject({ allowance_usd: 5, wall_sec: 5400, max_turns: 300 });
    expect(c.generations).toBe(true);
    expect(c.env).toMatchObject({ ...X.gstack_config.env, CLAUDE_CONFIG_DIR: "/root/.claude" });
    expect(c.home_rule).toBe("gstack");
    expect(() => extClaudeConfig({ session: planned("p-gstack", "h2hx-p-pilot"), home }, "x", "O")).toThrow(/^E_H2H_SESSION_INPUT the home is arm p-gstack-oneline's/);
    expect(() => extClaudeConfig({ session: planned("s-none", "h2hx-s-pilot"), home: nullHome("s-none") }, "x", "O")).toThrow(/^E_H2HX_INPUT arm s-none runs in Codex/);
  });

  test("a part L config carries l-gstack-task's suffix and part L's limits; the run copy sends h2hx:<arm> with the route's model", () => {
    const c = extClaudeConfig({ session: planned("l-gstack-task", "h2hx-l-main"), home: nullHome("l-gstack-task", { home_rule: "gstack" }) }, "The flag is never reset.", "O");
    expect(c.turns.join("\n")).toContain(X.parts.L.task_suffix["l-gstack-task"]!);
    expect(c.limits.allowance_usd).toBe(25);
    expect("generations" in c).toBe(false);
    const dir = join(W, "copy-l");
    mkdirSync(dir);
    const { argv } = extClaudeRunCopy(input(planned("l-gstack-task", "h2hx-l-main"), nullHome("l-gstack-task", { home_rule: "gstack" }), join(W, "x")), 1, dir);
    const ak = (k: string) => argv[argv.indexOf("--ak") + argv.filter((_, i) => argv[i - 1] === "--ak").findIndex((v) => v.startsWith(k + "=")) * 2 + 1]!.slice(k.length + 1);
    expect(argv[argv.indexOf("-m") + 1]).toBe("anthropic/claude-opus-5-5");
    expect(ak("arm")).toBe("h2hx:l-gstack-task");
    expect(ak("upstream_model")).toBe("claude-opus-5-5");
    const p = extClaudeRunCopy(input(planned("p-gsd", "h2hx-p-main"), nullHome("p-gsd", { home_rule: "pack", base_arm: "gsd" }), join(W, "y")), 2, join(W, "copy-p"));
    expect(p.argv[p.argv.indexOf("-m") + 1]).toBe("anthropic/particle-ai/particle-1");
    expect(p.argv).toContain("arm=h2hx:p-gsd");
    expect(p.argv).toContain("upstream_model=particle-ai/particle-1");
    expect(p.argv).toContain("rerun=session_upstream_or_infra");
    expect(() => extClaudeRunCopy(input(planned("p-gsd", "h2hx-l-main"), nullHome("p-gsd", { base_arm: "gsd" }), join(W, "z")), 1, join(W, "copy-z"))).toThrow(/^E_H2HX_INPUT item h2hx-l-main runs claude-opus-5-5, but arm p-gsd's route runs particle-ai\/particle-1/);
  });

  test("homes: part P copies its base arm's pinned home, part L its install record's (l-gstack's for l-gstack-task), and none copy nothing", () => {
    const homes = join(W, "homes");
    put(join(homes, "gsd"), { ".claude/commands/gsd.md": "x\n" });
    const installs = [{ arm: "gsd", home_tree_sha256: homeTreeSha256(join(homes, "gsd")) }, { arm: "none", home_tree_sha256: null }] as unknown as ArmInstall[];
    expect(extHome("p-gsd", { homes, installs })).toMatchObject({ dir: join(homes, "gsd"), home_rule: "pack", base_arm: "gsd", pin: "gsd", home_tree_sha256: installs[0]!.home_tree_sha256 });
    expect(extHome("p-none", { homes, installs })).toMatchObject({ dir: null, home_rule: "none", base_arm: "none" });
    const l = join(W, "lhomes");
    put(join(l, "l-gstack"), { ".claude/CLAUDE.md": "md\n" });
    const lrec = (sha: string) => JSON.stringify({ schema: "h2hx-arm-install.v1", home: "l-gstack", exit: 0, home_tree_sha256: homeTreeSha256(join(l, "l-gstack")), sources: [{ name: "gstack", repo: X.gstack.L.repo, sha, kind: "clone" }] });
    writeFileSync(recordPath(join(l, "l-gstack")), lrec("0".repeat(40)));
    expect(() => extHome("l-gstack-task", { lHomes: l })).toThrow(/^E_H2H_SESSION_INPUT .* installed gstack 0{40}, not the plan's pin /);
    writeFileSync(recordPath(join(l, "l-gstack")), lrec(X.gstack.L.sha));
    expect(extHome("l-gstack-task", { lHomes: l })).toMatchObject({ dir: join(l, "l-gstack"), home_rule: "gstack", pin: "l-gstack" });
    expect(extHome("l-none", {})).toMatchObject({ dir: null, home_rule: "none" });
    expect(() => extHome("l-gstack-md", { lHomes: l })).toThrow(/^E_H2H_SESSION_INPUT arm l-gstack-md's home .* has no install record/);
    expect(() => extHome("l-gstack", {})).toThrow(/^E_H2H_SESSION_INPUT arm l-gstack needs part L's installed homes/);
    expect(extHome("s-none", {})).toMatchObject({ dir: null, home_rule: "none" });
    expect(() => extHome("s-gstack", {})).toThrow(/needs the installed Codex homes/);
  });

  const pSession = (gens: Record<string, string>, ids: string[]) => ({
    "h2h-summary.json": summary(1.25, "completed", { questions: { t1: { questions: 1 } } }),
    "sdk-messages.jsonl": "",
    "claude-session.jsonl": ids.map((id) => JSON.stringify({ type: "assistant", message: { id } })).join("\n") + "\n",
    "generations.jsonl": Object.entries(gens).map(([id, p]) => JSON.stringify({ id, status: 200, text: JSON.stringify({ data: { id, provider_name: p } }) })).join("\n") + "\n",
  });

  test("a part P session checks every answer's provider and records its base arm and the providers that served it", async () => {
    plan([{ files: pSession({ "gen-1": "Particle AI", "gen-2": "Particle AI", "gen-sub": "Particle AI" }, ["gen-1", "gen-2"]) }]);
    const { record, file } = await runExtSession(input(planned("p-none", "h2hx-p-pilot"), nullHome("p-none", { base_arm: "none" }), join(W, "p-ok")));
    expect(record).toMatchObject({ schema: "h2h-session.v1", arm: "p-none", part: "P", host: "claude-code", base_arm: "none", served_by: ["Particle AI"], model: "particle-ai/particle-1", end: "completed", cost_usd: 1.25, attempts: 1, questions: 1 });
    expect(JSON.parse(readFileSync(file, "utf8")).served_by).toEqual(["Particle AI"]);
    expect(existsSync(join(W, "p-ok", "generations.jsonl"))).toBe(true);
  });

  test("a part P answer served by another provider, or with no record, refuses and leaves no session record", async () => {
    plan([{ files: pSession({ "gen-1": "Particle AI", "gen-2": "SomeoneElse" }, ["gen-1", "gen-2"]) }]);
    await expect(runExtSession(input(planned("p-none", "h2hx-p-pilot"), nullHome("p-none", { base_arm: "none" }), join(W, "p-other")))).rejects.toThrow(/^E_H2HX_ROUTE_PROVIDER answer gen-2 .* "SomeoneElse"/);
    expect(existsSync(join(W, "p-other", "session.json"))).toBe(false);
    plan([{ files: pSession({ "gen-1": "Particle AI" }, ["gen-1", "gen-9"]) }]);
    await expect(runExtSession(input(planned("p-none", "h2hx-p-pilot"), nullHome("p-none", { base_arm: "none" }), join(W, "p-missing")))).rejects.toThrow(/^E_H2HX_ROUTE_RECORD no generation record for answer gen-9/);
  });

  test("part P refuses when the generation lookup failed, or when a slot that spent money checked no answer; a slot that checked its answers still passes", async () => {
    plan([{ files: pSession({ "gen-1": "Particle AI" }, ["gen-1"]) }]);
    expect((await runExtSession(input(planned("p-none", "h2hx-p-pilot"), nullHome("p-none", { base_arm: "none" }), join(W, "p-clean")))).record).toMatchObject({ served_by: ["Particle AI"], end: "completed" });
    plan([{ files: { ...pSession({ "gen-1": "Particle AI" }, ["gen-1"]), "h2h-summary.json": summary(1.25, "completed", { generations_error: "OSError: disk full" }) } }]);
    await expect(runExtSession(input(planned("p-none", "h2hx-p-pilot"), nullHome("p-none", { base_arm: "none" }), join(W, "p-generr")))).rejects.toThrow(/^E_H2HX_ROUTE_RECORD the generation lookup failed \(OSError: disk full\)/);
    expect(existsSync(join(W, "p-generr", "session.json"))).toBe(false);
    plan([{ files: pSession({}, []) }]);
    await expect(runExtSession(input(planned("p-none", "h2hx-p-pilot"), nullHome("p-none", { base_arm: "none" }), join(W, "p-none-checked")))).rejects.toThrow(/^E_H2HX_ROUTE_RECORD the slot spent \$1\.25 and no answer had a generation record to check/);
    plan([{ files: { ...pSession({}, []), "h2h-summary.json": summary(0, "completed") } }]);
    expect((await runExtSession(input(planned("p-none", "h2hx-p-pilot"), nullHome("p-none", { base_arm: "none" }), join(W, "p-free")))).record).toMatchObject({ served_by: [] });
  });

  test("a part L session retries once on an upstream end at the full allowance and reads its sentence from the recorded first request", async () => {
    const md = X.parts.L.claude_md["l-gstack-md"]!;
    const first = { system: [{ type: "text", text: "s" }], messages: [{ role: "user", content: [{ type: "text", text: md }] }] };
    const withFirst = (s: ReturnType<typeof summary>) => ({ ...s, slot: { ...s.slot, close: { ...s.slot.close, first_request: first } } });
    plan([{ files: { "h2h-summary.json": summary(3, "error_result"), "sdk-messages.jsonl": "" } }, { files: { "h2h-summary.json": withFirst(summary(4, "completed")), "sdk-messages.jsonl": "" } }]);
    const { record } = await runExtSession(input(planned("l-gstack-md", "h2hx-l-pilot"), nullHome("l-gstack-md", { home_rule: "gstack" }), join(W, "l-retry")));
    expect(record).toMatchObject({ arm: "l-gstack-md", part: "L", end: "completed", attempts: 2, cost_usd: 7, model: "claude-opus-5-5" });
    expect(record.attempt_usage!.map((a) => a.allowance_usd)).toEqual([25, 25]);
    expect(record.exposure).toMatchObject({ sentence: "claude_md" });
  });
});

describe("part S on the Codex path", () => {
  test("the line arm's AGENTS.md text reads from the root rollout's first input; s-gstack's does not carry it", () => {
    const line = join(FX, "s-gstack-line-bug.rollout.jsonl.gz"), plain = join(FX, "s-gstack-bug.rollout.jsonl.gz");
    const agentsMd = X.parts.S.agents_md["s-gstack-line"]!;
    expect(firstInput([line])).toContain(JSON.stringify(agentsMd.trim()).slice(1, -1));
    expect(firstInput([plain])!.includes(JSON.stringify(agentsMd.trim()).slice(1, -1))).toBe(false);
    expect(codexExposure("s-gstack-line", "bug", readCodexEvents([line]), { firstRequest: firstInput([line]), agentsMd })).toMatchObject({ loaded: true });
    expect(rolloutVersion([line])).toBe(X.parts.S.codex.version);
    expect(firstInput([])).toBeUndefined();
  });

  test("an s-none session's record carries the rollout's Codex version, unanswered questions and the rollout as its transcript", async () => {
    plan([{ files: { "h2h-summary.json": summary(2, "completed", { codex_version: "codex-cli 9.9.9", codex_sessions: ["2026/root.jsonl.gz"], questions: { t1: { questions: 3, async_questions: 2, sync_questions: 1, unanswered: 2 } } }), "codex-events.jsonl": "" }, copies: { "codex-sessions/2026/root.jsonl.gz": join(FX, "s-none-done.rollout.jsonl.gz") } }]);
    const { record } = await runExtSession(input(planned("s-none", "h2hx-s-pilot"), nullHome("s-none"), join(W, "s-none"), "h2hx-runtimes-0123456789abcdef"));
    expect(record).toMatchObject({ arm: "s-none", part: "S", host: "codex", model: "gpt-6.2-sol", codex_version: "0.170.0", questions: 3, unanswered_questions: 2, transcript: "codex-sessions/2026/root.jsonl.gz", end: "completed" });
    expect(record.exposure).not.toBeNull();
    expect(existsSync(join(W, "s-none", "codex-sessions/2026/root.jsonl.gz"))).toBe(true);
  });
});

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const git = (d: string, ...a: string[]) => {
  const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...a], { cwd: d, encoding: "utf8" });
  if (r.status !== 0) throw new Error("git " + a.join(" ") + ": " + r.stderr);
  return r.stdout.trim();
};
const TEST_PATCH = "diff --git a/tests/new_test.go b/tests/new_test.go\nnew file mode 100644\n--- /dev/null\n+++ b/tests/new_test.go\n@@ -0,0 +1 @@\n+package tests\n";
function unitDir(id: string) {
  const dir = mkdtempSync(join(W, "unit-"));
  const body: Record<string, string> = { "fix.patch": "diff --git a/src/a.go b/src/a.go\n", "test.patch": TEST_PATCH, "issue.md": "x\n", "parser.py": "def parser(log):\n  return {}\n", "harbor/task.toml": "x\n", "harbor/environment/Dockerfile": "FROM x\n", "harbor/instruction.md": "x\n" };
  put(dir, body);
  writeFileSync(join(dir, "unit.json"), JSON.stringify({ schema: "sm-unit.v1", id, lang: "go", base_commit: "b".repeat(40), repo_dir: "/testbed", work_dir: "/testbed", image: { ref: "example/fixture@sha256:" + "c".repeat(64), image_id: null, runtime_id: null }, test_patch: { files: ["tests/new_test.go"], sha256: sha(TEST_PATCH) }, tests: { f2p: ["t1"], p2p: ["t2"] }, files: Object.fromEntries(Object.entries(body).map(([p, b]) => [p, sha(b)])) }));
  return dir;
}
/** A record dir whose tree.tar holds a repository at base with the given edits; returns it and the base. */
function recordDir(edits: Record<string, string>) {
  const repo = mkdtempSync(join(W, "repo-"));
  git(repo, "init", "-q", "-b", "main");
  put(repo, { "src/a.go": "package a\n\nfunc A() int { return 1 }\n", "a_test.go": "package a\n" });
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "base");
  const base = git(repo, "rev-parse", "HEAD");
  put(repo, edits);
  const rec = mkdtempSync(join(W, "rec-"));
  if (spawnSync("tar", ["-cf", join(rec, "tree.tar"), "-C", repo, "."]).status !== 0) throw new Error("tar");
  return { rec, base };
}

describe("tests-added records", () => {
  const unit = unitDir("o__unit-1");
  const rec = (o: Partial<ExtSessionRecord>) => ({ unit: "o__unit-1", arm: "p-gstack", stage: "stage1", index: 0, end: "completed", tree_bundle: "tree.tar", ...o }) as ExtSessionRecord;
  const scored = { gap: null } as H2hScore;

  test("a change that adds a test line counts under both rules; a source-only change under neither", () => {
    const a = recordDir({ "src/a.go": "package a\n\nfunc A() int { return 2 }\n", "a_test.go": "package a\n\nfunc TestA() {}\n" });
    expect(extTests(rec({ base_head: a.base }), scored, a.rec, unit)).toEqual({ schema: "h2hx-tests.v1", unit: "o__unit-1", arm: "p-gstack", stage: "stage1", added: true, recount: true, lines: 1 });
    const b = recordDir({ "src/a.go": "package a\n\nfunc A() int { return 3 }\n" });
    expect(extTests(rec({ arm: "l-none", base_head: b.base }), scored, b.rec, unit)).toMatchObject({ arm: "l-none", added: false, recount: false, lines: 0 });
  });

  test("a gap has no record, a safety stop with no tree added nothing, and any other scored session needs its tree", () => {
    expect(extTests(rec({}), { gap: "E_H2H_UPSTREAM_GAP" } as H2hScore, W, unit)).toBeNull();
    expect(extTests(rec({ end: "safety_stop" }), scored, join(W, "nowhere"), unit)).toMatchObject({ added: false, recount: false, lines: 0 });
    expect(() => extTests(rec({}), scored, join(W, "nowhere"), unit)).toThrow(/^E_H2H_SCORE_INPUT o__unit-1\/p-gstack\/stage1\/0 is scored but has no tree/);
  });

  test("the scorer takes the extension's arms", () => {
    const s = scoreSession({ schema: "h2h-session.v1", unit: "o__unit-1", arm: "s-gstack-line", model: "gpt-6.2-sol", item: "h2hx-s-pilot", stage: "stage1", index: 0, end: "safety_stop", gap: null } as never, W, unit);
    expect(s.score).toMatchObject({ arm: "s-gstack-line", outcome: "no_fix" });
  });
});

describe("x-run's stage runner", () => {
  const units = ["o__a", "o__b"].map((id, k) => ({ id, class: "O", kind: "O", entry: "bug", repo: "r", month: "2026-07", language: "go", image_digest: "", licence: "", position: k + 1, stage: "stage1" })) as H2hUnit[];
  const lHomes = join(W, "runner-lhomes");
  for (const h of ["l-gstack", "l-gstack-md"]) {
    put(join(lHomes, h), { ".claude/CLAUDE.md": h + "\n" });
    writeFileSync(recordPath(join(lHomes, h)), JSON.stringify({ schema: "h2hx-arm-install.v1", home: h, exit: 0, home_tree_sha256: homeTreeSha256(join(lHomes, h)), sources: [{ name: "gstack", repo: X.gstack.L.repo, sha: X.gstack.L.sha, kind: "clone" }] }));
  }
  const env = { H2H_CONTROL: "http://127.0.0.1:9", H2H_PROXY: "http://127.0.0.1:9", H2H_UNITS: W, H2HX_L_HOMES: lHomes };
  type Plant = { cost?: (arm: string) => number; gap?: (arm: string) => string | null; stop?: LookStop; looks?: number[]; capAt?: number };
  const deps = (log: string[], hit: string | null = null, p: Plant = {}): ExtRunnerDeps => ({
    unit: (id, u) => ({ dir: join(W, id), input: { ...unitInput, unit: u } }),
    home: (arm, installs) => {
      if (arm.startsWith("s-")) return { arm, part: "S", dir: null, home_rule: "none", home_tree_sha256: null, pin: arm } as ExtHome;
      const h = extHome(arm, { lHomes, installs });
      checkExtHome(h);
      return h;
    },
    look: (i) => {
      p.looks?.push(i.sessions.length);
      return { half: { O: 0, B: 0 }, contrasts: [{ label: "planted", crossed: p.stop === "efficacy" }], stop: p.stop ?? "continue" };
    },
    runtime: async () => ({ volume: "h2h-runtimes-test" }),
    contain: () => hit,
    session: async (i) => {
      log.push(i.session.index + " " + i.session.arm + " " + i.home.pin);
      mkdirSync(i.out, { recursive: true });
      const cap = p.capAt === i.session.index;
      const record = { schema: "h2h-session.v1", unit: i.session.unit, arm: i.session.arm, stage: i.session.stage, index: i.session.index, end: cap ? "cap_stop" : "completed", gap: cap ? "CAP_STOP" : (p.gap?.(i.session.arm) ?? null), cost_usd: p.cost?.(i.session.arm) ?? 0.5, wall_ms: 1000, continuations: 0, questions: 0, exposure: null, tokens: { input: 0, output: 0, cache_read: 0, cache_write: 0 } } as unknown as ExtSessionRecord;
      writeFileSync(join(i.out, "session.json"), JSON.stringify(record));
      if (cap) throw new Error("CAP_STOP " + i.session.unit + "/" + i.session.arm + " stopped at the cap");
      return { record, file: join(i.out, "session.json") };
    },
    score: (r) => ({ score: { schema: "h2h-score.v1", unit: r.unit, arm: r.arm, stage: r.stage, gap: r.gap, verified: r.gap === null } as unknown as H2hScore, warnings: [], main: null, candidates: [] }),
    tests: (r) => ({ schema: "h2hx-tests.v1", unit: r.unit, arm: r.arm, stage: r.stage, added: false, recount: false, lines: 0 }),
  });

  test("plans part L's stage, runs each session in plan order with its arm's home, and keeps written sessions on a relaunch", async () => {
    const out = join(W, "stage-l");
    const log: string[] = [];
    const r = await runExtStage({ part: "L", stage: "stage1", units, out, env, deps: deps(log), log: () => {} });
    expect(r.plan.sessions.length).toBe(8);
    expect(r).toMatchObject({ ran: 8, kept: 0 });
    expect(log.map((l) => l.split(" ")[0])).toEqual(["0", "1", "2", "3", "4", "5", "6", "7"]);
    expect(log.filter((l) => l.includes("l-gstack-task")).every((l) => l.endsWith(" l-gstack"))).toBe(true);
    const dirs = r.plan.sessions.map((s) => join(out, String(s.index).padStart(4, "0") + "-" + s.unit + "-" + s.arm));
    for (const d of dirs) for (const f of ["session.json", "score.json", "tests.json"]) expect(existsSync(join(d, f))).toBe(true);
    const again = await runExtStage({ part: "L", stage: "stage1", units, out, env, deps: deps(log), log: () => {} });
    expect(again).toMatchObject({ ran: 0, kept: 8 });
    rmSync(join(dirs[3]!, "session.json"));
    await expect(runExtStage({ part: "L", stage: "stage1", units, out, env, deps: deps(log), log: () => {} })).rejects.toThrow(/^E_H2HX_RUN .* exists with no session.json/);
    await expect(runExtStage({ part: "L", stage: "stage1", units: units.slice(0, 1), out, env, deps: deps(log), log: () => {} })).rejects.toThrow(/^E_H2HX_RUN .*plan.json holds another plan/);
  });

  test("stage 1 opens an arm's next pilot session only under its cap, leaves out an arm that reached it, and keeps that on a relaunch", async () => {
    const out = join(W, "stage-pilot-cap");
    const log: string[] = [];
    const plant = { cost: (arm: string) => (arm === "l-gstack-md" ? X.pilot_caps_usd["l-gstack-md"]! + 1 : 0.5) };
    const r = await runExtStage({ part: "L", stage: "stage1", units, out, env, deps: deps(log, null, plant), log: () => {} });
    expect(r).toMatchObject({ ran: 7, kept: 0, left_out: ["l-gstack-md"], stopped: null });
    expect(log.filter((l) => l.includes(" l-gstack-md "))).toHaveLength(1);
    expect(JSON.parse(readFileSync(join(out, "left-out.json"), "utf8")).arms).toEqual([{ arm: "l-gstack-md", settled_usd: X.pilot_caps_usd["l-gstack-md"]! + 1, sessions_run: 1, cap_usd: X.pilot_caps_usd["l-gstack-md"] }]);
    const again = await runExtStage({ part: "L", stage: "stage1", units, out, env, deps: deps(log, null, plant), log: () => {} });
    expect(again).toMatchObject({ ran: 0, kept: 7, left_out: ["l-gstack-md"] });
  });

  test("a session that stops at the cap and throws leaves no score, and x-analyze over the stage's out dir still reads the part incomplete", async () => {
    const s2 = units.map((u) => ({ ...u, stage: "stage2" as const }));
    const read = (out: string) => ({ units: s2, stage: "stage2" as const, sessions: readRecords<ExtSession>(out, "h2h-session.v1"), scores: readRecords<ExtScore>(out, "h2h-score.v1"), tests: readRecords<ExtTests>(out, "h2hx-tests.v1") });
    const clean = await runExtStage({ part: "L", stage: "stage2", units: s2, out: join(W, "stage-cap-clean"), env, deps: deps([]), log: () => {} });
    expect(clean).toMatchObject({ ran: clean.plan.sessions.length, stopped: null });
    const ok = analyzeExt("L", read(join(W, "stage-cap-clean")), { x: X, base: BASE });
    expect(ok.cap_stop).toBe(false);
    expect(ok.sentence.some((s) => s.reading !== "incomplete")).toBe(true);
    const last = clean.plan.sessions.at(-1)!;
    const out = join(W, "stage-cap-stop");
    await expect(runExtStage({ part: "L", stage: "stage2", units: s2, out, env, deps: deps([], null, { capAt: last.index }), log: () => {} })).rejects.toThrow(/^CAP_STOP /);
    const dir = join(out, String(last.index).padStart(4, "0") + "-" + last.unit + "-" + last.arm);
    expect(existsSync(join(dir, "session.json"))).toBe(true);
    expect(existsSync(join(dir, "score.json"))).toBe(false);
    const i = read(out);
    expect(i.scores).toHaveLength(i.sessions.length - 1);
    const a = analyzeExt("L", i, { x: X, base: BASE });
    expect(a.cap_stop).toBe(true);
    expect(a.sentence.every((s) => s.reading === "incomplete")).toBe(true);
    expect(a.rows).toEqual(["Part L incomplete: a session stopped at the cap, and the part is not retried"]);
  });

  test("parts P and L's stage 2 stop once a cell's gaps pass the incomplete share of its planned sessions", async () => {
    const s2 = units.map((u) => ({ ...u, stage: "stage2" as const }));
    const r = await runExtStage({ part: "L", stage: "stage2", units: s2, out: join(W, "stage-gaps"), env, deps: deps([], null, { gap: (arm) => (arm === "l-gstack-task" ? "E_PF_UPSTREAM" : null) }), log: () => {} });
    expect(r.stopped).toMatch(/^gaps: cell O l-gstack-task has 1 gaps of 2 planned sessions/);
    expect(r.ran).toBeLessThan(r.plan.sessions.length);
    expect(r.records.at(-1)!.session.arm).toBe("l-gstack-task");
  });

  test("part S's stage 2 runs the first half, takes the one look, and runs the rest only when it says continue", async () => {
    const s2 = ["o__s0", "o__s1", "o__s2", "o__s3"].map((id, k) => ({ ...units[0]!, id, position: k + 1, stage: "stage2" as const }));
    const looks: number[] = [];
    const stop = await runExtStage({ part: "S", stage: "stage2", units: s2, out: join(W, "stage-look-stop"), env, deps: deps([], null, { stop: "efficacy", looks }), log: () => {} });
    const halfN = stop.plan.sessions.length / 2;
    expect(stop).toMatchObject({ ran: halfN, stopped: "interim look: efficacy" });
    expect(looks).toEqual([halfN]);
    expect(JSON.parse(readFileSync(join(W, "stage-look-stop", "look.json"), "utf8")).stop).toBe("efficacy");
    expect((await runExtStage({ part: "S", stage: "stage2", units: s2, out: join(W, "stage-look-stop"), env, deps: deps([], null, { stop: "continue", looks }), log: () => {} })).stopped).toBe("interim look: efficacy");
    expect(looks).toEqual([halfN]);
    const go = await runExtStage({ part: "S", stage: "stage2", units: s2, out: join(W, "stage-look-go"), env, deps: deps([], null, { stop: "continue" }), log: () => {} });
    expect(go).toMatchObject({ ran: go.plan.sessions.length, stopped: null });
    const firstUnits = new Set(go.records.slice(0, halfN).map((r) => r.session.unit));
    expect(firstUnits.size).toBe(2);
    expect(go.records.slice(halfN).every((r) => !firstUnits.has(r.session.unit))).toBe(true);
  });

  test("an answer-key hit in a home refuses before its session; a stage with no units refuses", async () => {
    const log: string[] = [];
    await expect(runExtStage({ part: "L", stage: "stage1", units, out: join(W, "stage-hit"), env, deps: deps(log, "1 confirmed answer-key hit(s)"), log: () => {} })).rejects.toThrow(/^E_H2HX_RUN unit o__[ab]: 1 confirmed/);
    await expect(runExtStage({ part: "L", stage: "stage2", units, out: join(W, "stage-none"), env, deps: deps(log), log: () => {} })).rejects.toThrow(/^E_H2HX_INPUT the units file holds no stage2 unit/);
  });
});

const PY = process.env.REAL_OUTCOME_PYTHON ?? join(homedir(), ".capy/work/real/venv/bin/python");
test.skipIf(!existsSync(PY))("h2h_turns.py reads every answer's generation record through the slot before it closes, sub-agents' included", async () => {
  const d = mkdtempSync(join(W, "gen-"));
  put(join(d, "home"), {
    ".claude/projects/p/s1.jsonl": [{ type: "assistant", message: { id: "gen-1" } }, { type: "user" }, { type: "assistant", message: { id: "gen-1" } }, { type: "assistant", message: { id: "synth-1", model: "<synthetic>" } }].map((x) => JSON.stringify(x)).join("\n") + "\n",
    ".claude/projects/p/s1/subagents/a.jsonl": JSON.stringify({ type: "assistant", message: { id: "gen-2" } }) + "\n",
  });
  const seen: string[] = [];
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (req) => {
    const u = new URL(req.url);
    seen.push(u.pathname + u.search + " " + req.headers.get("authorization"));
    const id = u.searchParams.get("id");
    return id === "gen-2" ? new Response("not yet", { status: 404 }) : Response.json({ data: { id, provider_name: "Particle AI" } });
  } });
  try {
    const script = [
      "import json, sys",
      "sys.path.insert(0, sys.argv[1])",
      "import h2h_turns",
      "h2h_turns.GEN_WAIT_S = 0",
      "t = object.__new__(h2h_turns.Turns)",
      "from pathlib import Path",
      "t.cfg = {'home': sys.argv[2] + '/home', 'exec_prefix': []}",
      "t.out = Path(sys.argv[2])",
      "t.summary = {}",
      "t.generations({'base_url': sys.argv[3], 'token': 'slot-token'})",
    ].join("\n");
    const p = Bun.spawn([PY, "-c", script, join(import.meta.dir, "../../lanes/outcome-skills/h2h/sessions"), d, "http://127.0.0.1:" + server.port + "/slot1/openrouter"], { env: { PATH: process.env.PATH!, PYTHONDONTWRITEBYTECODE: "1" }, stdout: "pipe", stderr: "pipe" });
    expect(await p.exited, await new Response(p.stderr).text()).toBe(0);
  } finally {
    server.stop(true);
  }
  const rows = readFileSync(join(d, "generations.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  expect(rows.map((r) => [r.id, r.status])).toEqual([["gen-1", 200], ["gen-2", 404]]);
  expect(seen.filter((s) => s.includes("gen-2")).length).toBe(5);
  expect(seen[0]).toBe("/slot1/openrouter/v1/generation?id=gen-1 Bearer slot-token");
  expect(seen.some((s) => s.includes("synth-1"))).toBe(false);
});
