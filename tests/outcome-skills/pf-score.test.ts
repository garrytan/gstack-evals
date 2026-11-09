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
  return { fx, repo, cap, neutral, file };
}

/** Reads the tree a run gets: regress passes when flag.go holds the fix; pkg fails to compile on a fixed tree that still holds broken_test.go. */
const contentExec = (repo: string): Executor & { calls: string[] } => {
  const calls: string[] = [];
  return Object.assign(async (s: Parameters<Executor>[0]) => {
    calls.push(s.tree + ":" + s.command);
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
  }, { calls });
};

test.skipIf(!HAS_DOCKER)("scoreSession: catch, transplant, compile-blocked rerun and breaks on a fake unit dir", async () => {
  const f = fixture();
  const checks = f.file("CHECKS.json", [{ name: "pkg", command: "bash flag/pkg_test.go" }, { name: "r", command: "bash checks/regress_test.sh" }, { name: "n", command: "ls" }]);
  const session = f.file("session.json", { unit: "pf-score-flag", model: "claude-opus-5-5", arm: "N", gap: null, wrapup_end: "completed", forced: f.cap.forced });
  let ex: ReturnType<typeof contentExec> | null = null;
  const breaks = () => [{ t1: "pass", t2: "pass" }, { t1: "fail", t2: "pass" }, { t1: "fail", t2: "pass" }];
  const c: any = await scoreSession({ s: f.repo, unitDir: f.fx.dir, neutral: f.neutral, checks, session, exec: (repo) => (ex = contentExec(repo)), breaks });
  expect(c.score).toBe(1);
  expect(c.entries.map((e: any) => e.outcome)).toEqual(["no_catch", "catch"]);
  expect(c.manifest.names_nothing).toEqual([2]);
  expect(c.transplant.product_files).toEqual(["flag/flag.go"]);
  expect(c.force_captured).toBe(3);
  expect(c.compile_blocked).toEqual([{ index: 0, dropped: ["flag/broken_test.go", "flag/pkg_test.go", "flag/static_test.go"].filter((p) => p !== "flag/pkg_test.go"), outcome: "catch", why: expect.any(String) }]);
  expect(c.readings.compile_rerun).toBe(1);
  expect(c.secondaries.breaks).not.toBeNull();
  expect(JSON.stringify(c.secondaries.breaks)).toContain("t1");
  expect(JSON.stringify(c.secondaries.breaks)).not.toContain("t2");
  expect(ex!.calls.filter((x) => x === "parent:bash checks/regress_test.sh").length).toBe(3);
});

test.skipIf(!HAS_DOCKER)("scoreSession: a wrap-up limit with no manifest scores 0 without a run; a session gap scores null", async () => {
  const f = fixture();
  const limit = f.file("limit.json", { unit: "pf-score-flag", model: "claude-opus-5-5", arm: "P", gap: null, wrapup_end: "limit_turns", forced: [] });
  const none: any = await scoreSession({ s: f.repo, unitDir: f.fx.dir, neutral: f.neutral, checks: null, session: limit, exec: () => { throw new Error("no run expected"); } });
  expect(none.score).toBe(0);
  expect(none.manifest.none).toBe("wrapup_limit");
  const gap = f.file("gap.json", { unit: "pf-score-flag", model: "claude-opus-5-5", arm: "P", gap: "E_PF_UPSTREAM_GAP" });
  const g: any = await scoreSession({ s: f.repo, unitDir: f.fx.dir, neutral: f.neutral, checks: null, session: gap, exec: () => { throw new Error("no run expected"); } });
  expect(g.score).toBeNull();
  expect(g.gap).toBe("E_PF_UPSTREAM_GAP");
});
