// Copyright (c) 2026 Garry Tan. MIT License.
// score.ts scoreSession end to end on a fake unit dir (the state machines fixtures helper) with an executor that reads
// each scoring tree's content: the catch rule, the transplant, a compile-blocked rerun, the breaks secondary, the
// wrap-up-limit manifest rule and a session gap. Docker builds the fixture's volume, so the test needs a local image.
import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { patchOf, scoreUnit } from "../../lanes/outcome-skills/statemachines/fixtures.ts";
import { commitLocal, inventoryLocal } from "../../lanes/outcome-skills/pfchecks/capture.ts";
import { BASE_FLAG, FIX_FLAG, agentFiles } from "../../lanes/outcome-skills/pfchecks/dryrun.ts";
import type { Executor } from "../../lanes/outcome-skills/pfchecks/runner.ts";
import { scoreSession } from "../../lanes/outcome-skills/pfchecks/score.ts";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const IMAGE = "debian:bookworm-slim";
const HAS_DOCKER = spawnSync("docker", ["image", "inspect", IMAGE]).status === 0;
const sha = (b: string) => createHash("sha256").update(b).digest("hex");

function fixture() {
  const fx = scoreUnit({ id: "pf-score-flag", lang: "go", image: IMAGE, files: { "flag/flag.go": BASE_FLAG, ".gitignore": "gen/\n" }, tests: {}, commands: { rebuild: ["true"], test: ["true"], print: ["true"] }, f2p: ["t0"], stable: ["t1", "t2"], known: ["t0", "t1", "t2"] });
  spawnSync("docker", ["volume", "rm", "-f", fx.volume]);
  const fix = patchOf(fx.repo, { "flag/flag.go": FIX_FLAG });
  writeFileSync(join(fx.dir, "fix.patch"), fix);
  const u = JSON.parse(readFileSync(join(fx.dir, "unit.json"), "utf8"));
  u.files["fix.patch"] = sha(fix);
  writeFileSync(join(fx.dir, "unit.json"), JSON.stringify(u, null, 1) + "\n");
  const s = mkdtempSync(join(tmpdir(), "pf-score-s-"));
  spawnSync("git", ["clone", "-q", fx.repo, join(s, "r")]);
  const repo = join(s, "r");
  const inv = join(s, "inv");
  writeFileSync(inv, inventoryLocal(repo));
  for (const [p, t] of Object.entries(agentFiles(sha(BASE_FLAG)))) {
    mkdirSync(dirname(join(repo, p)), { recursive: true });
    writeFileSync(join(repo, p), t);
  }
  const cap = commitLocal(repo, inv);
  const neutral = join(s, "neutral.json");
  writeFileSync(neutral, JSON.stringify({ schema: "pf-neutral.v1", id: "pf-score-flag", verdict: "kept", mode: "both", files: ["flag/flag.go"], tried: [], patch_sha256: null }));
  const file = (name: string, body: unknown) => { const p = join(s, name); writeFileSync(p, typeof body === "string" ? body : JSON.stringify(body)); return p; };
  const base = spawnSync("git", ["-C", repo, "rev-list", "--max-parents=0", "HEAD"], { encoding: "utf8" }).stdout.trim();
  return { fx, repo, cap, neutral, file, base };
}

/** Reads the tree a run gets: regress passes when flag.go holds the fix; pkg fails to compile on a fixed tree that still holds broken_test.go. */
const contentExec = (repo: string): Executor & { calls: string[]; asides: string[][] } => {
  const calls: string[] = [], asides: string[][] = [];
  return Object.assign(async (s: Parameters<Executor>[0]) => {
    calls.push(s.tree + ":" + s.command);
    asides.push(s.aside ?? []);
    const show = (p: string) => spawnSync("git", ["-C", repo, "show", s.commit + ":" + p], { encoding: "utf8" });
    const fixed = show("flag/flag.go").stdout.includes("RESET=true");
    const broken = show("flag/broken_test.go").status === 0;
    let exit = 1, log = "";
    if (s.command === "bash checks/regress_test.sh") exit = fixed ? 0 : 1;
    if (s.command === "bash flag/pkg_test.go") {
      if (broken && fixed) { exit = 2; log = "# flag\nflag/broken_test.go:2:1: error: undefined: OldName\n"; }
      else exit = fixed ? 0 : 1;
    }
    return { exit, timed_out: false, wall_ms: 1, rebuild_exits: [0], log };
  }, { calls, asides });
};

test.skipIf(!HAS_DOCKER)("scoreSession: catch, transplant, compile-blocked rerun and breaks on a fake unit dir", async () => {
  const f = fixture();
  const checks = f.file("CHECKS.json", [{ name: "pkg", command: "bash flag/pkg_test.go" }, { name: "r", command: "bash checks/regress_test.sh" }, { name: "n", command: "ls" }]);
  const session = f.file("session.json", { unit: "pf-score-flag", model: "claude-opus-5-5", arm: "N", base_commit: f.base, gap: null, wrapup_end: "completed", forced: f.cap.forced });
  let ex: ReturnType<typeof contentExec> | null = null;
  const breaks = () => ({ runs: [{ t1: "pass", t2: "pass" }, { t1: "fail", t2: "pass" }, { t1: "fail", t2: "pass" }], skipped: [], unmeasured: null });
  const c: any = await scoreSession({ s: f.repo, unitDir: f.fx.dir, neutral: f.neutral, checks, session, exec: (repo) => (ex = contentExec(repo)), breaks });
  expect(c.score).toBe(1);
  expect(c.entries.map((e: any) => e.outcome)).toEqual(["no_catch", "catch"]);
  expect(c.manifest.names_nothing).toEqual([2]);
  expect(c.transplant.product_files).toEqual(["flag/flag.go"]);
  expect(c.force_captured).toBe(3);
  expect(c.compile_blocked).toEqual([{ index: 0, dropped: ["flag/broken_test.go", "flag/pkg_test.go", "flag/static_test.go"].filter((p) => p !== "flag/pkg_test.go"), outcome: "catch", why: expect.any(String) }]);
  expect(c.readings.compile_rerun).toBe(1);
  expect(new Set(ex!.asides.map((a) => a.join(","))).size).toBe(1);
  expect(ex!.asides[0]).toEqual(expect.arrayContaining(["flag/broken_test.go", "flag/pkg_test.go", "checks/regress_test.sh"]));
  expect(ex!.asides[0]).not.toContain("flag/flag.go");
  expect(c.secondaries.breaks).not.toBeNull();
  expect(JSON.stringify(c.secondaries.breaks)).toContain("t1");
  expect(JSON.stringify(c.secondaries.breaks)).not.toContain("t2");
  expect(c.secondaries).toMatchObject({ breaks_skipped: [], breaks_unmeasured: null });
  expect(ex!.calls.filter((x) => x === "parent:bash checks/regress_test.sh").length).toBe(3);
});

test.skipIf(!HAS_DOCKER)("scoreSession: breaks not measured is null with its reason, and a skipped fix test patch is named and its missing tests count neither way", async () => {
  const f = fixture();
  const checks = f.file("CHECKS.json", [{ name: "r", command: "bash checks/regress_test.sh" }]);
  const session = f.file("session.json", { unit: "pf-score-flag", model: "claude-opus-5-5", arm: "N", base_commit: f.base, gap: null, wrapup_end: "completed", forced: f.cap.forced });
  const run = (b: any): Promise<any> => scoreSession({ s: f.repo, unitDir: f.fx.dir, neutral: f.neutral, checks, session, exec: (repo) => contentExec(repo), breaks: () => b });
  const stopped = await run({ runs: [{ t1: "pass" }, null, { t1: "pass" }], skipped: ["test.patch"], unmeasured: "run 2 stopped after skipping test.patch" });
  expect(stopped.secondaries).toMatchObject({ breaks: null, breaks_skipped: ["test.patch"], breaks_unmeasured: "run 2 stopped after skipping test.patch" });
  const skipped = await run({ runs: [{ t1: "pass" }, { t1: "pass" }, { t1: "pass" }], skipped: ["test.patch"], unmeasured: null });
  expect(skipped.secondaries).toMatchObject({ breaks: [], breaks_skipped: ["test.patch"], breaks_unmeasured: null });
  const applied = await run({ runs: [{ t1: "pass" }, { t1: "pass" }, { t1: "pass" }], skipped: [], unmeasured: null });
  expect(applied.secondaries).toMatchObject({ breaks: ["t2"], breaks_skipped: [], breaks_unmeasured: null });
}, 60_000);

test.skipIf(!HAS_DOCKER)("scoreSession: P's exposure reads the skill body from the session's claude-session.jsonl", async () => {
  const f = fixture();
  const sdk = f.file("sdk-messages.jsonl", JSON.stringify({ type: "AssistantMessage", phase: "task", content: [{ type: "tool_use", name: "Read", input: { file_path: "/opt/pf-pstack/skills/statechart/SKILL.md" } }] }) + "\n");
  const cc = (name: string, text: string) => f.file(name, JSON.stringify({ type: "user", message: { role: "user", content: text } }) + "\n");
  const rec = (name: string, claude_session: string) => f.file(name, { unit: "pf-score-flag", model: "claude-opus-5-5", arm: "P", base_commit: f.base, gap: null, wrapup_end: "limit_turns", forced: [], transcript: sdk, claude_session });
  const run = (session: string): Promise<any> => scoreSession({ s: f.repo, unitDir: f.fx.dir, neutral: f.neutral, checks: null, session, exec: () => { throw new Error("no run expected"); } });
  const loaded = await run(rec("p-body.json", cc("claude-session.jsonl", "# Create a formal verification skill\nSteps")));
  expect(loaded.exposure).toMatchObject({ body: true, statechart_read: true, loaded: true });
  const none = await run(rec("p-none.json", cc("claude-session-none.jsonl", "/create-formal-verification-skill model the state machine behind this bug report")));
  expect(none.exposure).toMatchObject({ body: false, statechart_read: true, loaded: false });
});

test.skipIf(!HAS_DOCKER)("scoreSession: a wrap-up limit with no manifest scores 0 without a run; a session gap scores null", async () => {
  const f = fixture();
  const limit = f.file("limit.json", { unit: "pf-score-flag", model: "claude-opus-5-5", arm: "P", base_commit: f.base, gap: null, wrapup_end: "limit_turns", forced: [] });
  const none: any = await scoreSession({ s: f.repo, unitDir: f.fx.dir, neutral: f.neutral, checks: null, session: limit, exec: () => { throw new Error("no run expected"); } });
  expect(none.score).toBe(0);
  expect(none.manifest.none).toBe("wrapup_limit");
  const gap = f.file("gap.json", { unit: "pf-score-flag", model: "claude-opus-5-5", arm: "P", gap: "E_PF_UPSTREAM_GAP" });
  const g: any = await scoreSession({ s: f.repo, unitDir: f.fx.dir, neutral: f.neutral, checks: null, session: gap, exec: () => { throw new Error("no run expected"); } });
  expect(g.score).toBeNull();
  expect(g.gap).toBe("E_PF_UPSTREAM_GAP");
});

// Value: protects=section 6.8's rule that S sits on the unit's base commit; fails_when=an S whose root is not the session record's base commit (a rewritten base, a second root) builds scoring trees or stops the scorer, or a record with no base commit scores; why_new=the scorer took S's root as the base whatever it was; seam=score.ts scoreSession before trees.ts buildTrees; no_claim=the bundle's HEAD against the capture (pf-run.test.ts)
test.skipIf(!HAS_DOCKER)("scoreSession: an S whose root is not the unit's base commit is gap E_PF_ARM (base_mismatch) with no run, and a record with no base commit is refused", async () => {
  const f = fixture();
  const none = () => { throw new Error("no run expected"); };
  const rec = (name: string, base: unknown) => f.file(name, { unit: "pf-score-flag", model: "claude-opus-5-5", arm: "N", base_commit: base, gap: null, wrapup_end: "limit_turns", forced: [] });
  const ok: any = await scoreSession({ s: f.repo, unitDir: f.fx.dir, neutral: f.neutral, checks: null, session: rec("ok.json", f.base), exec: none });
  expect(ok).toMatchObject({ score: 0, gap: null });
  const wrong: any = await scoreSession({ s: f.repo, unitDir: f.fx.dir, neutral: f.neutral, checks: null, session: rec("wrong.json", "0".repeat(40)), exec: none });
  expect(wrong).toMatchObject({ score: null, gap: "E_PF_ARM", gap_reason: "base_mismatch", readings: { no_static: null, no_api_guess: null, compile_rerun: null } });
  const g = (...a: string[]) => spawnSync("git", ["-C", f.repo, "-c", "user.name=t", "-c", "user.email=t@t", ...a], { encoding: "utf8" });
  const empty = spawnSync("git", ["-C", f.repo, "mktree"], { input: "", encoding: "utf8" }).stdout.trim();
  const orphan = g("commit-tree", empty, "-m", "other root").stdout.trim();
  g("merge", "-q", "--allow-unrelated-histories", "-m", "join", orphan);
  const two: any = await scoreSession({ s: f.repo, unitDir: f.fx.dir, neutral: f.neutral, checks: null, session: rec("two.json", f.base), exec: none });
  expect(two).toMatchObject({ score: null, gap: "E_PF_ARM", gap_reason: "base_mismatch" });
  await expect(scoreSession({ s: f.repo, unitDir: f.fx.dir, neutral: f.neutral, checks: null, session: rec("nobase.json", null), exec: none })).rejects.toThrow(/^E_PF_INPUT .*base_commit/);
  const passed: any = await scoreSession({ s: f.repo, unitDir: f.fx.dir, neutral: f.neutral, checks: null, session: f.file("gap.json", { unit: "pf-score-flag", model: "claude-opus-5-5", arm: "P", gap: "E_PF_ARM", gap_reason: "head_mismatch" }), exec: none });
  expect(passed).toMatchObject({ score: null, gap: "E_PF_ARM", gap_reason: "head_mismatch" });
});
