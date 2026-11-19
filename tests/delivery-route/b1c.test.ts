// Copyright (c) 2026 Garry Tan. MIT License.
// B1c (lanes/delivery-route/b1c.ts): the placement script in a scratch repo, the arm's tree and spec, the decision bands
// against B1b's published hook rows, the power table, the caps and launch guard, the controls' reuse check, the session rows
// and the three scripted sessions' captures.
import { describe, expect, test } from "bun:test";
import { appendFileSync, chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { B1C_CASES, b1bControls, b1cApprove, b1cCap, b1cCaseProblems, b1cCheck, b1cDone, b1cGuard, b1cMain, b1cPlan, b1cReading, b1cReport, b1cRow, b1cStats, bandOdds, checkB1cRows, harnessDirty, loadB1cCaptured, placementReading, powerLines, READINGS, reuseB1b, whyNot, type B1cRow } from "../../lanes/delivery-route/b1c.ts";
import { B1C, B1C_CAPS_USD, B1C_SPEC, PLACEMENT } from "../../lanes/delivery-route/b1c-pins.ts";
import { B1B_ARMS } from "../../lanes/delivery-route/b1b-pins.ts";
import { paired, reuseCheck, type Load } from "../../lanes/delivery-route/b1b.ts";
import { ARM_SOURCES, drawnTasks, loadBundle, REPO, sha256 } from "../../lanes/delivery-route/pins.ts";
import { b1Row, type B1Row } from "../../lanes/delivery-route/table.ts";
import { b1bRow } from "../../lanes/delivery-route/b1b.ts";
import { armSpec, jobConfig } from "../../quick/laneb/runner/grid.ts";
import { readRows } from "../../quick/laneb/runner/ledger.ts";

const sh = (cwd: string, args: string[], env: Record<string, string> = {}) => spawnSync(args[0]!, args.slice(1), { cwd, encoding: "utf8", env: { PATH: process.env.PATH ?? "", ...env } });
const BLOCK = readFileSync(join(REPO, ARM_SOURCES, PLACEMENT.blockSource));

describe("the placement script", () => {
  const setup = (files: Record<string, string> = {}) => {
    const root = mkdtempSync(join(tmpdir(), "b1c-place-")), home = join(root, "home"), repo = join(root, "repo"), script = join(home, PLACEMENT.script);
    mkdirSync(join(home, ".b1c"), { recursive: true }); mkdirSync(join(script, ".."), { recursive: true }); mkdirSync(repo);
    copyFileSync(join(REPO, ARM_SOURCES, PLACEMENT.blockSource), join(home, PLACEMENT.block));
    copyFileSync(join(REPO, ARM_SOURCES, PLACEMENT.scriptSource), script); chmodSync(script, 0o755);
    writeFileSync(join(script, "../gstack-skill-start"), "stub\n");
    writeFileSync(join(repo, "calc.py"), "x = 1\n");
    for (const [f, t] of Object.entries(files)) writeFileSync(join(repo, f), t);
    for (const a of [["git", "init", "-q"], ["git", "add", "-A"], ["git", "-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-qm", "snapshot"]]) expect(sh(repo, a).status).toBe(0);
    return { root, home, repo, script, run: () => sh(repo, [script, "trust"], { HOME: home }) };
  };
  test("it creates the project CLAUDE.md as B1b's block, commits only that file with gstack's message, and removes itself", () => {
    const s = setup();
    try {
      writeFileSync(join(s.repo, "calc.py"), "x = 2\n");
      expect(sh(s.repo, ["git", "add", "calc.py"]).status).toBe(0);
      const r = s.run(), head = sh(s.repo, ["git", "rev-parse", "--short=12", "HEAD"]).stdout.trim();
      expect([r.status, r.stderr]).toEqual([0, ""]);
      expect(r.stdout).toBe("b1c: placed the routing block at " + s.repo + "/CLAUDE.md and committed it as " + head + "\n");
      expect(readFileSync(join(s.repo, "CLAUDE.md")).equals(BLOCK)).toBe(true);
      expect(sh(s.repo, ["git", "log", "-1", "--format=%s"]).stdout.trim()).toBe(PLACEMENT.message);
      expect(sh(s.repo, ["git", "show", "--name-only", "--format=", "HEAD"]).stdout.trim()).toBe("CLAUDE.md");
      expect(sh(s.repo, ["git", "status", "--porcelain"]).stdout).toBe("M  calc.py\n");
      expect([existsSync(join(s.home, ".b1c")), existsSync(s.script), existsSync(join(s.script, "../gstack-skill-start"))]).toEqual([false, false, true]);
    } finally { rmSync(s.root, { recursive: true, force: true }); }
  });
  test("a .gitignore that names CLAUDE.md does not stop the commit", () => {
    const s = setup({ ".gitignore": "CLAUDE.md\n" });
    try {
      expect(s.run().status).toBe(0);
      expect(sh(s.repo, ["git", "ls-files", "CLAUDE.md"]).stdout.trim()).toBe("CLAUDE.md");
    } finally { rmSync(s.root, { recursive: true, force: true }); }
  });
  test("a CLAUDE.md the strip left behind fails the placement, which the rig reads as an infrastructure failure", () => {
    const s = setup({ "CLAUDE.md": "repo notes\n" });
    try {
      const r = s.run();
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("is still there after the snapshot strip");
      expect(readFileSync(join(s.repo, "CLAUDE.md"), "utf8")).toBe("repo notes\n");
      expect(existsSync(s.script)).toBe(true);
    } finally { rmSync(s.root, { recursive: true, force: true }); }
  });
});

describe("the arm", () => {
  test("the spec is B1b's claude-md spec under the arm's name with checks_trust on, and the rig turns it into the pre-session command", () => {
    expect(B1C_SPEC).toBe(B1B_ARMS["claude-md"].spec.replaceAll("claude-md", "project-md") + ":checks_trust=true");
    const a = armSpec(B1C_SPEC);
    expect(a).toMatchObject({ name: "project-md", tar_name: "project-md", strip_snapshot: "true", checks_trust: "true", gstack_hooks: "copy" });
    const j = jobConfig({ job_name: "j", models: [{ id: "claude-opus-5-5", harbor_model: "m", session_cap_usd: 5 }], arms: [{ ...a, tar: "/a/project-md.tar", sha256: "x" }], tasks: ["t"], tasks_dir: "/t", runner_dir: "/r", agent_dir: "/g", base_url: "http://p", attempts: 1, n_concurrent: 6, verifier_timeout_multiplier: 1, max_output_tokens: 32000 } as any);
    expect(j.agents[0]!.kwargs).toMatchObject({ arm: "project-md", strip_snapshot: true, checks_trust: true });
    expect(j.agents[0]!.import_path).toBe("laneb_hooks:LanebHooksAgent");
  });
  test("the tree is B1's gstack-shaped tree byte for byte plus the block and the script, and the tar rebuilds against the manifest", () => {
    const r = b1cCheck();
    expect(r.lines.filter((l) => l.startsWith("PROBLEM"))).toEqual([]);
    expect(r.pass).toBe(true);
    expect(sha256(BLOCK)).toBe(PLACEMENT.blockSha256);
  });
});

const load = (over: Partial<Load> = {}): Load => ({ loaded: false, via: null, at_call: null, failed: 0, named: false, first_text: "", ...over });
const row = (task: string, loaded: boolean, outcome: B1Row["outcome"] = "graded", followed = loaded): B1cRow => ({
  schema: "b1-session/1", model: "claude-opus-5-5", part: "b1c-1", arm: "project-md", task, trial: task + "__p", outcome, reason: outcome, pass: false, reward: outcome === "graded" ? 0 : null,
  allowance_stop: false, turn_cap: false, cost_usd: 0.4, tokens: 1, steps_seen: loaded, skill_loads: loaded ? 1 : 0, safety_stop: false, audit_hits: [],
  detect: { followed, followed_tool_only: followed, followed_as_merged: followed, test_before_source: followed, failing_before_source: followed, passing_after_source: followed, source_changed: true, bash_only_source: false, source_write_unseen: false, unread_background: 0, unresolved_writes: 0, spec_folder_write: false, test_file: null, fix_files: [] },
  load: load(loaded ? { loaded: true, via: "Skill", at_call: 1 } : {}), placed: true, stripped: [], patch_names_claude_md: false, why_not: outcome === "graded" && !loaded ? "never named" : null,
});
const controls = b1bControls(), hook = controls.filter((r) => r.arm === "hook");
/** The 60 run tasks; the project block loads on k of the tasks where B1b's hook loaded and on none of the hook's misses. */
const rows = (k: number, gaps = 0) => { const hit = hook.filter((r) => r.load?.loaded).map((r) => r.task).slice(0, k); return drawnTasks(loadBundle()).run.map((t, i) => row(t, hit.includes(t), i >= 60 - gaps ? "infra" : "graded")); };
const read = (r: B1cRow[]) => b1cReading(b1cStats(r, 60), paired(r, hook, (x: any) => x.load?.loaded, (x: any) => x.load?.loaded)).key;

describe("the decision", () => {
  test("B1b's controls are its published rows: hook 58 of 60 loaded, claude-md 20 of 60", () => {
    expect(["hook", "claude-md"].map((a) => controls.filter((r) => r.arm === a && r.outcome === "graded" && r.load?.loaded).length)).toEqual([58, 20]);
  });
  test("every band at its edges: matches down to 55 of 60, middle from 54 to 42, clearly loses from 41", () => {
    expect([58, 55, 54, 42, 41, 20].map((k) => read(rows(k)))).toEqual(["matches", "matches", "middle", "middle", "clearly-loses", "clearly-loses"]);
    expect(read(rows(58, 7))).toBe("incomplete");
    const capped = rows(58);
    capped[3] = { ...capped[3]!, outcome: "cap_stop", why_not: null };
    expect(read(capped)).toBe("incomplete");
    expect(READINGS["clearly-loses"]).toContain("CUT-CANDIDATE");
    expect(READINGS.middle).toContain("FIX-METHOD");
  });
  test("the placement contrast against B1b's user-file arm, and the report's lines", () => {
    expect(placementReading({ lo: 0.1, hi: 0.5 })).toContain("loads more");
    expect(placementReading({ lo: -0.5, hi: -0.1 })).toContain("loads less");
    expect(placementReading({ lo: -0.1, hi: 0.1 })).toContain("not shown");
    const rep = b1cReport(rows(41));
    expect(rep.reading?.key).toBe("clearly-loses");
    expect(rep.lines.find((l) => l.includes("control, B1b hook"))).toBe("  control, B1b hook (the hook line): loaded 58/60, followed 36/60");
    expect(rep.lines.find((l) => l.includes("reference, B1 none"))).toBe("  reference, B1 none (reused no-gstack arm): followed 0/60");
    expect(rep.lines.find((l) => l.includes("(primary"))).toBe("  loaded, project-md - B1b hook (primary, margin -15): -28.3 points [-40.7, -16.4] on 60 paired tasks (0 vs 17 discordant)");
  });
  test("a smoke-only table prints its stats and no reading; the row check refuses a stray task, another model and a repeat", () => {
    const smoke = ["yt-project__unyt-628", "getmoto__moto-9590"].map((t) => row(t, true));
    expect(b1cReport(smoke, controls, undefined, 2, true).reading).toBeNull();
    const r = [row("t0", true), row("t0", false), { ...row("t1", true), model: "gpt-6.1-sol" }, row("zz", true)];
    expect(checkB1cRows(r, ["t0", "t1"]).sort()).toEqual(["t1__p ran gpt-6.1-sol, not claude-opus-5-5", "two graded rows for t0", "zz__p is task zz, not one of the planned tasks"]);
  });
  test("the reason a session didn't load, first that applies", () => {
    expect(whyNot("graded", load({ failed: 1, named: true }), false)).toBe("block not placed");
    expect(whyNot("graded", load({ failed: 1 }), true)).toBe("load failed");
    expect(whyNot("graded", load({ named: true }), true)).toBe("named, not loaded");
    expect(whyNot("graded", load(), true)).toBe("never named");
    expect(whyNot("graded", load({ loaded: true }), false)).toBeNull();
    expect(whyNot("infra", load(), true)).toBeNull();
  });
  test("power: each true rate's band odds sum to 1, and a block as good as the hook matches 96% of the time", () => {
    for (const p of [1, 0.9, 0.6]) { const o = bandOdds(58, 2, p); expect(o.matches + o.middle + o["clearly-loses"]).toBeCloseTo(1, 9); }
    expect(bandOdds(58, 2, 0.967).matches).toBeCloseTo(0.958, 3);
    expect(bandOdds(58, 2, 0.6)["clearly-loses"]).toBeCloseTo(0.907, 3);
  });
});

describe("money", () => {
  test("each cap is the recorded formula: 1.35 x expected, the open-session reserve and the VM share, rounded up to $10", () => {
    for (const i of ["b1c-smoke", "b1c-opus"] as const) expect(b1cCap(i).cap).toBe(B1C_CAPS_USD[i]);
    expect(b1cCap("b1c-opus")).toMatchObject({ expected: 24.6, parallel: 30 });
    expect(b1cCap("b1c-smoke")).toMatchObject({ expected: 0.82, parallel: 10 });
  });
  test("the approval row takes only the recorded cap, once, and a done item never launches again", () => {
    const dir = mkdtempSync(join(tmpdir(), "b1c-ledger-")), path = join(dir, "b1c-opus.jsonl");
    try {
      expect(() => b1cApprove(path, "b1c-opus", 70, "the Captain")).toThrow(/refused: b1c-opus's recorded cap is \$80/);
      expect(() => b1cApprove(path, "b1b-opus", 80, "the Captain")).toThrow(/unknown item/);
      b1cApprove(path, "b1c-opus", 80, "the Captain");
      expect(() => b1cApprove(path, "b1c-opus", 80, "the Captain")).toThrow(/already holds rows/);
      expect(b1cGuard("b1c-opus", { "b1c-opus": readRows(path) }, {}, 0).ok).toBe(true);
      b1cDone(path, "b1c-opus");
      expect(b1cGuard("b1c-opus", { "b1c-opus": readRows(path) }, {}, 0).why).toContain("b1c-opus is marked done; a done item never launches again");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  test("the launch guard counts both items' projections and this lane's counter against the $150 stop", () => {
    const g0 = b1cGuard("b1c-opus", {}, {}, 0), all = Number(/all-in \$([\d.]+)/.exec(g0.lines[0]!)![1]);
    expect(b1cGuard("b1c-opus", {}, {}, B1C.stopUsd - all).ok).toBe(true);
    const g = b1cGuard("b1c-opus", {}, {}, B1C.stopUsd - all + 0.01);
    expect(g.ok).toBe(false);
    expect(g.why[0]).toMatch(/^all-in \$150\.01 passes the \$150\.00 stop$/);
  });
  test("the launch command's guard reads the work dir's ledger mirror before B1C_LEDGERS, and refuses a bad or missing crew file", async () => {
    const root = mkdtempSync(join(tmpdir(), "b1c-guard-")), work = join(root, "work"), ledgers = join(root, "ledgers"), crew = join(root, "crew.json"), mirror = join(work, "host/ledger.jsonl");
    const saved = { B1C_LEDGERS: process.env.B1C_LEDGERS, B1C_CREW: process.env.B1C_CREW, LEDGER: process.env.LEDGER };
    const guard = () => b1cMain(["guard", work]);
    try {
      mkdirSync(join(work, "host"), { recursive: true }); mkdirSync(ledgers);
      writeFileSync(join(work, "plan.json"), JSON.stringify({ item: "b1c-opus", git_head: "HEAD", parts: b1cPlan("b1c-opus", drawnTasks(loadBundle()).run).parts }));
      b1cApprove(join(ledgers, "b1c-opus.jsonl"), "b1c-opus", 80, "the Captain");
      writeFileSync(crew, JSON.stringify({ as_of: "2026-11-18", usd: 0 }));
      Object.assign(process.env, { B1C_LEDGERS: ledgers, B1C_CREW: crew }); delete process.env.LEDGER;
      expect(await guard()).toBe(0);
      copyFileSync(join(ledgers, "b1c-opus.jsonl"), mirror);
      for (const kind of ["reserve", "settle"]) appendFileSync(mirror, JSON.stringify({ ts: "2026-11-18T00:00:00Z", item: "b1c-opus", kind, id: "model-1", usd_micros: 30_000_000 }) + "\n");
      await expect(guard()).rejects.toThrow(/^E_B1_LAUNCH b1c-opus: b1c-opus's projection \$[\d.]+ passes its cap \$80\.00/);
      writeFileSync(crew, JSON.stringify({ as_of: "2026-11-18", usd: -1 }));
      await expect(guard()).rejects.toThrow(/^E_USAGE b1c launch guard: the crew file needs/);
      delete process.env.B1C_CREW;
      await expect(guard()).rejects.toThrow(/^E_USAGE b1c launch guard: set B1C_LEDGERS/);
    } finally {
      for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
      rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);
});

describe("the controls' reuse", () => {
  test("every session-deciding tree is the same at this head as at B1b's run commit, and at B1's for the none arm", () => {
    const a = reuseB1b("HEAD"), b = reuseCheck("HEAD");
    expect(a.lines.filter((l) => !l.startsWith("SAME "))).toEqual([expect.stringMatching(/^REUSE PASS/)]);
    expect([a.same, b.same]).toEqual([true, true]);
  });
  test("the dirty check refuses an uncommitted change to a harness path or the arm's own files", () => {
    const repo = mkdtempSync(join(tmpdir(), "b1c-dirty-"));
    try {
      mkdirSync(join(repo, "lanes/delivery-route/arms/b1c"), { recursive: true });
      writeFileSync(join(repo, "lanes/delivery-route/arms/b1c/place-block"), "a\n");
      writeFileSync(join(repo, "notes.txt"), "a\n");
      for (const a of [["git", "init", "-q"], ["git", "add", "-A"], ["git", "-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-qm", "s"]]) expect(sh(repo, a).status).toBe(0);
      writeFileSync(join(repo, "notes.txt"), "b\n");
      expect(harnessDirty(repo)).toEqual([]);
      writeFileSync(join(repo, "lanes/delivery-route/arms/b1c/place-block"), "b\n");
      expect(harnessDirty(repo)).toEqual([" M lanes/delivery-route/arms/b1c/place-block"]);
    } finally { rmSync(repo, { recursive: true, force: true }); }
  });
});

describe("the table", () => {
  const FIX = join(import.meta.dir, "fixtures/b1c-sessions"), job = mkdtempSync(join(tmpdir(), "b1c-table-"));
  let n = 0;
  const trial = (arm: string, capture: string, info: object | null, patch = "diff --git a/calc.py b/calc.py\n") => {
    const name = "t1__" + ++n, dir = join(job, name);
    mkdirSync(join(dir, "evaluator"), { recursive: true }); mkdirSync(join(dir, "artifacts/logs/artifacts"), { recursive: true });
    writeFileSync(join(dir, "config.json"), JSON.stringify({ agent: { name: "laneb-claude-code", kwargs: { arm, upstream_model: "claude-opus-5-5" } }, task: { path: "tasks/t1" } }));
    writeFileSync(join(dir, "result.json"), JSON.stringify({ trial_name: name, verifier_result: { rewards: { reward: 0 } } }));
    copyFileSync(join(FIX, capture, "sdk-messages.jsonl"), join(dir, "evaluator", "sdk-messages.jsonl"));
    writeFileSync(join(dir, "artifacts/logs/artifacts/model.patch"), patch);
    if (info) writeFileSync(join(dir, "evaluator", "usersim-events.jsonl"), JSON.stringify({ event: "start" }) + "\n" + JSON.stringify({ event: "arm", ...info }) + "\n");
    const sessions = new Map([[name, [{ ok_responses: 3, refused_budget: 0, spent_micros: 410_000 } as any]]]);
    return { dir, ctx: { part: "b1c-1", sessions, home: "/root" } };
  };
  const placed = { stripped: ["AGENTS.md", "CLAUDE.md"], checks_trust: PLACEMENT.placed + "0123456789ab" };
  test("a session that loaded, with the block placed and what the strip removed", () => {
    const t = trial("project-md", "project-md-load", placed), r = b1cRow(t.dir, t.ctx)!;
    expect([r.arm, r.outcome, r.load.loaded, r.load.via, r.placed, r.stripped, r.patch_names_claude_md, r.why_not, r.cost_usd]).toEqual(["project-md", "graded", true, "Skill", true, ["AGENTS.md", "CLAUDE.md"], false, null, 0.41]);
  });
  test("a session with no placement line reads block not placed; a shipped diff that names CLAUDE.md is flagged", () => {
    const t = trial("project-md", "project-md-stop", { stripped: [] }), r = b1cRow(t.dir, t.ctx)!;
    expect([r.load.loaded, r.placed, r.why_not]).toEqual([false, false, "block not placed"]);
    const u = trial("project-md", "project-md-stop", placed, "diff --git a/CLAUDE.md b/CLAUDE.md\n"), s = b1cRow(u.dir, u.ctx)!;
    expect([s.placed, s.patch_names_claude_md, s.why_not]).toEqual([true, true, "never named"]);
  });
  test("B1c's table refuses other arms, and B1's and B1b's refuse B1c's", () => {
    const h = trial("hook", "project-md-stop", placed), p = trial("project-md", "project-md-stop", placed);
    expect(() => b1cRow(h.dir, h.ctx)).toThrow(/has arm "hook", not one of project-md/);
    expect(() => b1Row(p.dir, p.ctx)).toThrow(/has arm "project-md", not one of none/);
    expect(() => b1bRow(p.dir, p.ctx)).toThrow(/has arm "project-md", not one of claude-md, hook/);
  });
});

describe("scripted sessions", () => {
  const FIX = join(import.meta.dir, "fixtures/b1c-sessions"), cap = (n: string) => loadB1cCaptured(join(FIX, n));
  for (const c of B1C_CASES) test(c.name + " holds every assertion", () => expect(b1cCaseProblems(c, cap(c.name))).toEqual([]));
  test("the assertions fail when the arm delivers the wrong thing", () => {
    const stop = B1C_CASES[0]!, tracked = B1C_CASES[2]!, s = cap("project-md-stop"), has = (p: string[], w: string) => p.some((x) => x.includes(w));
    expect(has(b1cCaseProblems(stop, { ...s, user: [s.user.join("\n").replace(PLACEMENT.label, PLACEMENT.userLabel + " (user's private global instructions for all projects):")] }), "as the project's CLAUDE.md")).toBe(true);
    expect(has(b1cCaseProblems(stop, { ...s, probe: { ...s.probe!, gstack_files: 5 } }), "5 gstack files")).toBe(true);
    expect(has(b1cCaseProblems(stop, { ...s, probe: { ...s.probe!, b1c_dir: true } }), "left in /root")).toBe(true);
    expect(has(b1cCaseProblems(stop, { ...s, probe: { ...s.probe!, claude_md_sha256: "0".repeat(64) } }), "byte for byte")).toBe(true);
    expect(has(b1cCaseProblems(stop, { ...s, probe: { ...s.probe!, commits: 1 } }), "routing commit")).toBe(true);
    expect(has(b1cCaseProblems(stop, { ...s, probe: { ...s.probe!, patch_files: ["CLAUDE.md", "calc.py"] } }), "shipped diff")).toBe(true);
    expect(has(b1cCaseProblems(stop, { ...s, arm_info: { stripped: [] } }), "placement line")).toBe(true);
    expect(has(b1cCaseProblems(tracked, { ...s, arm_info: { ...s.arm_info!, stripped: [] } }), "strip did not remove")).toBe(true);
    expect(has(b1cCaseProblems({ ...stop, mode: "load" }, s), "Skill load")).toBe(true);
    expect(has(b1cCaseProblems(stop, cap("project-md-load")), "loadsOf reads a load")).toBe(true);
  });
});

describe("the preregistration's attachments", () => {
  const B = join(REPO, "wiki/plans/2026-11-18-capy-b1c-project-route-prereg"), body = (f: string) => readFileSync(join(B, f), "utf8").split("\n").slice(1).join("\n");
  test("power.txt is what b1c power prints on B1b's published hook rows", () => expect(body("power.txt")).toBe(powerLines().join("\n") + "\n"));
  test("plan.txt holds each item's recorded cap as its formula gives it", () => {
    for (const i of ["b1c-smoke", "b1c-opus"] as const) expect(body("plan.txt")).toContain(i + ": ");
    expect(body("plan.txt")).toContain("cap $" + B1C_CAPS_USD["b1c-smoke"] + " (recorded $" + B1C_CAPS_USD["b1c-smoke"] + ")");
    expect(body("plan.txt")).toContain("cap $" + B1C_CAPS_USD["b1c-opus"] + " (recorded $" + B1C_CAPS_USD["b1c-opus"] + ")");
  });
});

