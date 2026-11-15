// Copyright (c) 2026 Garry Tan. MIT License.
// The head-to-head session's end rules and record (sessions/session.ts), its config and compose overlay (sessions/run.ts),
// the arm homes (sessions/home.ts), the session check's home rules (h2h_turns.py) and part S's commands. Keyless.
import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { readPrereg } from "../../lanes/outcome-skills/h2h/prereg.ts";
import { commands } from "../../lanes/outcome-skills/h2h/sessions/commands.ts";
import { armHome, homeRule } from "../../lanes/outcome-skills/h2h/sessions/home.ts";
import type { H2hPlanned } from "../../lanes/outcome-skills/h2h/sessions/plan.ts";
import { composeOverlay, h2hBudget, h2hConfig } from "../../lanes/outcome-skills/h2h/sessions/run.ts";
import { endOf, gapOf, retries, sessionRecord } from "../../lanes/outcome-skills/h2h/sessions/session.ts";
import { BROWSER, type ArmInstall, type H2hArm } from "../../lanes/outcome-skills/h2h/types.ts";

const P = readPrereg();
const turn = (phase: string, termination: string, extra: Record<string, unknown> = {}) => ({ phase, termination, drive: {}, refusal: false, ...extra });
const summary = (turns: unknown[], close: Record<string, unknown> = { finalized: true, allowance_stops: 0, refusals: [] }, extra: Record<string, unknown> = {}) => ({ turns, slot: { id: "s1", close }, ...extra });
const planned = (arm: H2hArm, entry: "bug" | "feature" = "bug"): H2hPlanned => ({ unit: "u1", kind: "O", entry, stage: "stage1", index: 3, arm, item: "h2h-pilot" });

test("endOf reads the session's end from its summary", () => {
  expect(endOf(null)).toBe("infra");
  expect(endOf({ cap_stop: true, turns: [] })).toBe("cap_stop");
  expect(endOf(summary([turn("t1", "completed")]))).toBe("completed");
  expect(endOf(summary([turn("t1", "completed"), turn("c1", "bg_wait_expired")]))).toBe("completed");
  expect(endOf(summary([turn("t1", "wall_limit")]))).toBe("limit_wall");
  expect(endOf(summary([turn("t1", "turn_ceiling")]))).toBe("limit_turns");
  expect(endOf(summary([turn("t1", "error_result")], { finalized: true, allowance_stops: 1 }))).toBe("limit_allowance");
  expect(endOf(summary([turn("t1", "completed", { refusal: true })]))).toBe("safety_stop");
  expect(endOf(summary([turn("t1", "error_result")]))).toBe("upstream");
  expect(endOf(summary([turn("t1", "cli_exit")], { finalized: true, refusals: ["E_UPSTREAM 529"] }))).toBe("upstream");
  expect(endOf(summary([turn("t1", "cli_exit")]))).toBe("infra");
  expect(endOf(summary([turn("t1", "error")]))).toBe("infra");
  expect(endOf(summary([turn("t1", "completed")], { finalized: false, allowance_stops: 0 }))).toBe("infra");
  expect(endOf(summary([]))).toBe("infra");
});

test("one whole-session retry on upstream or infra, then a gap; a capture refusal and a cap stop are gaps at once", () => {
  const up = summary([turn("t1", "error_result")]);
  expect(retries("upstream", 1, up)).toBe(true);
  expect(retries("infra", 1, null)).toBe(true);
  expect(retries("upstream", 2, up)).toBe(false);
  expect(retries("limit_wall", 1, up)).toBe(false);
  expect([gapOf("upstream", 1, up), gapOf("upstream", 2, up), gapOf("infra", 2, null), gapOf("completed", 2, up)]).toEqual([null, "E_H2H_UPSTREAM_GAP", "E_H2H_INFRA_GAP", null]);
  const cap = summary([turn("t1", "completed")], { finalized: true }, { refused: "E_H2H_CAPTURE E_PF_CAPTURE bundle timed out" });
  expect(retries("completed", 1, cap)).toBe(false);
  expect(gapOf("completed", 1, cap)).toBe("E_H2H_CAPTURE");
  expect(gapOf("cap_stop", 1, { cap_stop: true })).toBe("CAP_STOP");
});

test("the session record counts turns, continuations, questions, refusals, spend and tokens", () => {
  const s = summary([turn("t1", "completed"), turn("t2", "completed"), turn("c1", "completed"), turn("c2", "completed")], { finalized: true, allowance_stops: 0, reservation_bound: 3, spent_micros: 4_250_000, usage: { input: 10, output: 20, reasoning: 0, cache_read: 30, cache_write: 40 } }, { continuations: 2, spurious_continuations: 1, done: true, claude_version: "2.1.325 (Claude Code)", questions: { t1: { questions: 2 }, c1: { questions: 1 } } });
  const r = sessionRecord(planned("gsd", "feature"), s, { model: P.model, attempt: 2, exposure: null, wall_ms: 5, home_tree_sha256: "a".repeat(64) });
  expect(r).toMatchObject({ schema: "h2h-session.v1", unit: "u1", arm: "gsd", item: "h2h-pilot", stage: "stage1", index: 3, end: "completed", gap: null, turns: 4, scripted_turns: 2, continuations: 2, spurious_continuations: 1, done_seen: true, questions: 3, reservation_refusals: 3, cost_usd: 4.25, attempts: 2, allowance_stops: 0 });
  expect(r.tokens).toEqual({ input: 10, output: 20, cache_read: 30, cache_write: 40 });
});

test("the h2h config carries the arm's scripted turns and the frozen texts, rules, limits and env", () => {
  const home = { arm: "gsd" as H2hArm, dir: "/h/gsd", home_rule: "pack" as const, home_tree_sha256: null };
  const c = h2hConfig({ session: planned("gsd", "feature"), home }, "Add a flag.", "O");
  expect(c.turns).toEqual(["/gsd-onboard", "/gsd-quick " + P.texts.task.replace("{problem statement}", "Add a flag.")]);
  expect([c.continuation, c.no_answer, c.continuation_cap, c.done_rule]).toEqual([P.texts.continuation, P.texts.question_reply, P.continuation_cap, P.done_rule]);
  expect(c.limits).toEqual({ allowance_usd: P.limits.allowance_usd, wall_sec: P.limits.wall_sec, max_turns: P.limits.max_turns, quiet_sec: 30, bg_wait_sec: 600 });
  expect(c.env).toMatchObject({ ...P.env, HOME: "/root", CLAUDE_CONFIG_DIR: "/root/.claude" });
  expect(c.env).not.toHaveProperty("CHROME_BIN");
  expect(c.disallowed_tools).toEqual(P.disallowed_tools);
  expect([c.home, c.home_rule]).toEqual(["/h/gsd", "pack"]);
  const qa = h2hConfig({ session: { ...planned("gstack-qa"), kind: "B1" }, home: { ...home, arm: "gstack-qa", home_rule: "gstack" }, allowance: 2 * P.limits.allowance_usd }, "Broken page.", "B1");
  expect(qa.env).toMatchObject(BROWSER.env);
  expect(qa.limits.allowance_usd).toBe(2 * P.limits.allowance_usd);
  expect(() => h2hConfig({ session: planned("none"), home: { ...home, arm: "none" }, allowance: 30 }, "x", "O")).toThrow(/^E_H2H_SESSION_INPUT/);
});

test("the compose overlay mounts the pinned Claude Code and the runtime volume everywhere and the browser conditions on B1 only", () => {
  const rt = { volume: "h2h-runtimes-x", path: "/usr/bin:/bin:/opt/h2h-runtimes/bin" };
  expect(composeOverlay("O", "/c/claude", "/w/chromium", rt)).toEqual({
    services: { main: { volumes: [{ type: "bind", source: "/c/claude", target: "/usr/local/bin/claude", read_only: true }, { type: "volume", source: "h2h-runtimes-x", target: "/opt/h2h-runtimes", read_only: true }], environment: { PATH: rt.path } } },
    volumes: { "h2h-runtimes-x": { external: true } },
  });
  const b1 = composeOverlay("B1", "/c/claude", "/w/chromium", rt).services.main as Record<string, any>;
  expect(b1.shm_size).toBe(BROWSER.shm_size);
  expect(b1.volumes[2]).toEqual({ type: "bind", source: "/w/chromium", target: BROWSER.wrapper_container_path, read_only: true });
  expect(b1.environment).toEqual({ PATH: rt.path, ...BROWSER.env });
  // gstack-timing-ok: compares two configured limits, no elapsed time
  expect(h2hBudget(P.limits.wall_sec, 8).agent_s).toBeGreaterThan(P.limits.wall_sec);
});

test("arm homes: none copies nothing, home_of reuses the owner's dir, and a missing home refuses", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2h-homes-"));
  try {
    mkdirSync(join(dir, "gstack"));
    const installs = [{ arm: "gstack", home_of: null, roots: [], home_tree_sha256: "b".repeat(64) }, { arm: "gstack-qa", home_of: "gstack", roots: [], home_tree_sha256: "c".repeat(64) }, { arm: "superpowers", home_of: null, roots: [], home_tree_sha256: "d".repeat(64) }] as unknown as ArmInstall[];
    expect(armHome("none", { installs, homes: dir })).toEqual({ arm: "none", dir: null, home_rule: "none", home_tree_sha256: null });
    expect(armHome("gstack-qa", { installs, homes: dir })).toEqual({ arm: "gstack-qa", dir: join(dir, "gstack"), home_rule: "gstack", home_tree_sha256: "b".repeat(64) });
    expect(() => armHome("superpowers", { installs, homes: dir })).toThrow(/^E_H2H_SESSION_INPUT .*superpowers's home/);
    expect(() => armHome("tstack", { installs, homes: dir })).toThrow(/^E_H2H_SESSION_INPUT arms-pins.json has no record for arm tstack/);
    expect(["none", "gstack-pony", "gstack-oneline", "pstack"].map((a) => homeRule(a as H2hArm))).toEqual(["none", "gstack", "gstack", "pack"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("part S's commands refuse with their code and read transcripts", async () => {
  const dir = mkdtempSync(join(tmpdir(), "h2h-cmd-"));
  const err: string[] = [];
  const log: string[] = [];
  const [e0, l0] = [console.error, console.log];
  console.error = (m: string) => err.push(String(m));
  console.log = (m: string) => log.push(String(m));
  try {
    const t = join(dir, "t.jsonl");
    writeFileSync(t, JSON.stringify({ type: "UserMessage", content: "<command-name>/gsd-debug</command-name>" }) + "\n");
    expect(await commands.exposure!(["--arm", "gsd", "--entry", "bug", "--transcript", t])).toBe(0);
    expect(JSON.parse(log.at(-1)!)).toMatchObject({ loaded: true, procedure: false });
    expect(await commands.exposure!(["--arm", "nobody", "--entry", "bug", "--transcript", t])).toBe(2);
    expect(err.at(-1)).toMatch(/^E_USAGE nobody is not an h2h arm/);
    expect(await commands.audit!(["--transcript", t])).toBe(2);
    expect(await commands["session-run"]!(["--plan", join(dir, "none.json")])).toBe(1);
  } finally {
    console.error = e0;
    console.log = l0;
    rmSync(dir, { recursive: true, force: true });
  }
});

const PY = process.env.REAL_OUTCOME_PYTHON ?? join(homedir(), ".capy/work/real/venv/bin/python");
test.skipIf(!existsSync(PY))("the session check refuses instruction files, a drive, a pack in the none arm's home and gstack outside gstack's arms", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2h-check-"));
  try {
    const script = String.raw`
import json, os, subprocess, sys
sys.path.insert(0, sys.argv[1])
from h2h_turns import Turns
d = sys.argv[2]
repo, home = os.path.join(d, "repo"), os.path.join(d, "home")
os.makedirs(repo); os.makedirs(home)
subprocess.run(["git", "init", "-q", repo]); open(os.path.join(repo, "a"), "w").write("a")
env = dict(os.environ, GIT_AUTHOR_NAME="f", GIT_AUTHOR_EMAIL="f@x.invalid", GIT_COMMITTER_NAME="f", GIT_COMMITTER_EMAIL="f@x.invalid")
subprocess.run(["git", "-C", repo, "add", "-A"], env=env); subprocess.run(["git", "-C", repo, "commit", "-qm", "b"], env=env)
def check(rule):
    t = Turns({"out": os.path.join(d, "out"), "no_answer": "x", "limits": {}, "repo": repo, "home": home, "home_rule": rule, "exec_prefix": []})
    try:
        t.check()
        return "ok"
    except RuntimeError as e:
        return str(e).split(":")[0] + ":" + ",".join(x for x in ("INSTR", "HOME .capy", "HOME .claude/skills", "GSTACK") if x in str(e))
out = {"clean_none": check("none")}
os.makedirs(os.path.join(home, ".claude/skills/gstack"))
out["gstack_in_none"] = check("none"); out["gstack_in_pack"] = check("pack"); out["gstack_in_gstack"] = check("gstack")
os.makedirs(os.path.join(home, ".capy/drive"))
out["drive_in_gstack"] = check("gstack")
os.makedirs(os.path.join(repo, ".claude"))
out["instr"] = check("gstack")
print(json.dumps(out))
`;
    const r = Bun.spawnSync([PY, "-c", script, join(import.meta.dir, "../../lanes/outcome-skills/h2h/sessions"), dir]);
    expect(r.exitCode).toBe(0);
    expect(JSON.parse(r.stdout.toString())).toEqual({
      clean_none: "ok",
      gstack_in_none: "E_H2H_SESSION_ARM the session tree holds an instruction file, or the none home holds a path its rule refuses:HOME .claude/skills,GSTACK",
      gstack_in_pack: "E_H2H_SESSION_ARM the session tree holds an instruction file, or the pack home holds a path its rule refuses:GSTACK",
      gstack_in_gstack: "ok",
      drive_in_gstack: "E_H2H_SESSION_ARM the session tree holds an instruction file, or the gstack home holds a path its rule refuses:HOME .capy",
      instr: "E_H2H_SESSION_ARM the session tree holds an instruction file, or the gstack home holds a path its rule refuses:INSTR,HOME .capy",
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
