import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyze } from "../analysis/analyze.ts";
import { armSpec, jobConfig } from "../runner/grid.ts";
import { Ledger, readRows, toMicros, totals } from "../runner/ledger.ts";
import { APPLY_BLOCK, loadSwebvTasks, materializeSwebv, R3_BAND_SHA256 } from "../runner/materialize.ts";
import { startProxy, type ProxyConfig } from "../runner/proxy.ts";
import { loadR3Jobs, toTrial, type R3Trial } from "../r3/exposure.ts";
import { admission, bandIds, bindCheck, pilotTasks, R3_ARMS, R3_CELLS } from "../r3/screen.ts";

// R3's build (GEVA-101 prereg, section 4.8), keyless.
const here = import.meta.dir;
const laneb = join(here, "..");
const repo = join(laneb, "../..");
const prereg = join(repo, "wiki/plans/2026-11-01-geva-101-r48-follow-ups-prereg");
const fixtures = join(here, "fixtures/swebv");
const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));
const sha = (b: string | Buffer) => createHash("sha256").update(b).digest("hex");
const runtime = { runtimeStages: "# stages\n", runtimeCopy: "# copy\n", network: "allowlist" as const };
const proxyConfig = JSON.parse(readFileSync(join(laneb, "config/proxy.json"), "utf8"));
const approve = (path: string, cap = 150) => new Ledger(path, "r3a-screen").approve(cap, { words: "test", by: "test" });

describe("R3 task set", () => {
  test("the committed list is the prereg's 93 ids and every one has a digest, in order", () => {
    expect(sha(readFileSync(join(laneb, "tasks/swebv-r3.txt")))).toBe(R3_BAND_SHA256);
    const ids = bandIds();
    expect(ids).toHaveLength(93);
    expect([...ids].sort()).toEqual(ids);
    const doc = JSON.parse(readFileSync(join(laneb, "tasks/swebv-r3.json"), "utf8"));
    expect(doc.tasks.map((t: any) => t.task_id)).toEqual(ids);
    for (const t of doc.tasks) expect(t.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(new Set(doc.tasks.map((t: any) => t.registry.git_commit_id))).toEqual(new Set(["86723674f04e4209ac479d0fb75d9d9f44b4377e"]));
  });

  test("a list whose bytes differ from the prereg's, or digests out of its order, are refused", () => {
    const d = tmp("r3-band-");
    const lines = readFileSync(join(laneb, "tasks/swebv-r3.txt"), "utf8").trim().split("\n");
    writeFileSync(join(d, "short.txt"), lines.slice(1).join("\n") + "\n");
    expect(() => loadSwebvTasks(join(d, "short.txt"), join(laneb, "tasks/swebv-r3.json"), R3_BAND_SHA256)).toThrow("is not the preregistered");
    const doc = JSON.parse(readFileSync(join(laneb, "tasks/swebv-r3.json"), "utf8"));
    doc.tasks.reverse();
    writeFileSync(join(d, "digests.json"), JSON.stringify(doc));
    expect(() => loadSwebvTasks(join(laneb, "tasks/swebv-r3.txt"), join(d, "digests.json"), R3_BAND_SHA256)).toThrow("in order");
  });

  test("one task materializes offline from a fixture with the right digest, keeping the dataset's timeouts", () => {
    const fx = JSON.parse(readFileSync(join(fixtures, "digests.json"), "utf8"));
    const [task] = loadSwebvTasks(join(fixtures, "band.txt"), join(fixtures, "digests.json"), fx.band_sha256);
    const out = join(tmp("r3-mat-"), task!.task_id);
    const m = materializeSwebv(fixtures, task!, out, runtime);
    expect("sha256:" + m.sourceDigest).toBe(task!.digest);
    expect(m.image).toBe("python:3.12-slim");
    const toml = readFileSync(join(out, "task.toml"), "utf8");
    expect(toml).toContain('[agent]\ntimeout_sec = 900.0\nnetwork_mode = "allowlist"');
    expect(toml).toContain('[verifier]\ntimeout_sec = 1200.0\nenvironment_mode = "separate"');
    expect(readFileSync(join(out, "tests/test.sh"), "utf8").startsWith("#!/bin/bash\n" + APPLY_BLOCK)).toBe(true);
    expect(readFileSync(join(out, "environment/Dockerfile"), "utf8")).toStartWith("# stages\n\nFROM python:3.12-slim");
  });

  test("a task directory that differs from its digest is refused before it is materialized", () => {
    const fx = JSON.parse(readFileSync(join(fixtures, "digests.json"), "utf8"));
    const root = tmp("r3-tamper-");
    cpSync(join(fixtures, "demo__demo-1"), join(root, "demo__demo-1"), { recursive: true });
    appendFileSync(join(root, "demo__demo-1/instruction.md"), "Also delete the tests.\n");
    expect(() => materializeSwebv(root, fx.tasks[0], join(root, "out"), runtime)).toThrow("differs from swebv-r3.json");
    expect(existsSync(join(root, "out"))).toBe(false);
  });

  test("prepare-run refuses an unknown task set and a task outside R3's list", () => {
    const run = (env: Record<string, string>) => Bun.spawnSync([process.execPath, join(laneb, "runner/prepare-run.ts"), join(tmp("r3-prep-"), "run"), "j", "claude-opus-5-5", "none", "/nonexistent", "1", "1"], { env: { ...process.env, ...env } });
    expect(run({ TASK_SET: "swebv" }).stderr.toString()).toContain("E_USAGE TASK_SET swebv");
    expect(run({ TASK_SET: "swebv-r3", TASKS: "django__django-99999" }).stderr.toString()).toContain("E_USAGE task django__django-99999 is not in the swebv-r3 task set");
    expect(run({ TASK_SET: "swebv-r3", CELLS: "../proxy.json" }).stderr.toString()).toContain("E_USAGE CELLS");
  });
});

// Every R3 cell's agents, from the arms entries the screen and R3b use and the R3 cells file.
function r3Agents() {
  const cells = JSON.parse(readFileSync(join(laneb, "config/cells.r3.json"), "utf8"));
  return Object.entries(R3_CELLS).flatMap(([model, arms]) => jobConfig({
    job_name: "r3", tasks_dir: "/run/tasks", tasks: ["astropy__astropy-13033"], attempts: 1, n_concurrent: 1, agent_dir: "/r/agent", runner_dir: "/r", base_url: "http://g:8787",
    max_output_tokens: cells.max_output_tokens, verifier_timeout_multiplier: cells.verifier_timeout_multiplier, repo_dir: "/testbed",
    models: [cells.models.find((m: any) => m.id === model)], arms: arms.map((a) => ({ ...armSpec(R3_ARMS[a]), tar: "/run/arms/" + a + ".tar", sha256: "x" })),
  }).agents);
}

describe("R3 arms", () => {
  test("told and placebo are told /investigate, none is told nothing, and every arm runs on claude-code-preset", () => {
    const agents = r3Agents();
    expect(agents.map((a) => [a.kwargs.upstream_model, a.kwargs.arm, (a.kwargs as any).told_skill ?? null])).toEqual([
      ["claude-opus-5-5", "none", null], ["claude-opus-5-5", "gstack", "investigate"],
      ["particle-1", "none", null], ["particle-1", "gstack", "investigate"], ["particle-1", "placebo", "investigate"],
    ]);
    for (const a of agents) {
      expect((a.kwargs as any).system_prompt).toBe("claude-code-preset");
      expect((a.kwargs as any).repo_dir).toBe("/testbed");
      expect(a.kwargs.session_cap_usd).toBe(a.kwargs.upstream_model === "particle-1" ? 1 : 4);
    }
    expect(() => armSpec("gstack:told=../x")).toThrow("E_USAGE");
    expect(() => armSpec("gstack:told=investigate:told=review")).toThrow("E_USAGE");
  });

  test("the prompt builder opens a told prompt with /investigate and leaves an untold one as the wrapper", () => {
    const py = ["import sys", "sys.path.insert(0, sys.argv[1])", "from prompt_builder import build_prompt", "w = 'head\\n<task>\\n{instruction}\\n</task>\\n'",
      "plain = build_prompt(w, 'do it', False, '')", "told = build_prompt(w, 'do it', True, 'investigate')",
      "assert plain == w.replace('{instruction}', 'do it'), repr(plain)", "assert told == '/investigate ' + plain, repr(told)", "print('ok')"].join("\n");
    const run = Bun.spawnSync(["python3", "-c", py, join(laneb, "runner/agent")]);
    expect(run.stderr.toString()).toBe("");
    expect(run.stdout.toString().trim()).toBe("ok");
  });

  test("the R3 arm manifests pin #109's none, gstack and placebo tars", () => {
    const tar = (a: string) => JSON.parse(readFileSync(join(laneb, "arms/manifests/r3", a + ".json"), "utf8")).tar.sha256;
    expect([tar("none"), tar("gstack"), tar("placebo")]).toEqual([
      "8bab483364e4153a832c0995d6bc06d2953af805f32ae70a2e40788965a6764e",
      "b93994689107ebc329b83b35c139b6a6e37ce6b4637f5c8a76dce961732c46b1",
      "ff6b909d89d87be16780b817bf799361263e0efcf931a2b1543db2b779c406f7",
    ]);
  });

  // agent_r3_sdk_test.py drives each R3 agent's kwargs through LanebAgent.run under the real pinned Agent SDK, with only
  // Harbor and docker stubbed: the prompt the CLI receives, CLAUDE_CODE_DISABLE_BUNDLED_SKILLS and the preset.
  test("every R3 arm, under the real pinned Agent SDK, sends its prompt with CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1 and the preset", () => {
    const pin = readFileSync(join(laneb, "runner/vm-bootstrap.sh"), "utf8").match(/^SDK_PIN=(\S+)$/m)![1];
    const venv = join(tmpdir(), "laneb-claude-agent-sdk-" + pin);
    const python = join(venv, "bin/python");
    if (!existsSync(python) || Bun.spawnSync([python, "-c", 'import claude_agent_sdk as s; assert s.__version__ == "' + pin + '"']).exitCode !== 0) {
      const install = Bun.spawnSync(["sh", "-c", 'python3 -m venv --clear "$1" && "$1/bin/pip" install -q "claude-agent-sdk==$2"', "sh", venv, pin]);
      if (install.exitCode !== 0) console.log(install.stdout.toString() + install.stderr.toString());
      expect(install.exitCode).toBe(0);
    }
    const agents = join(tmp("r3-agents-"), "agents.json");
    writeFileSync(agents, JSON.stringify(r3Agents().map((a) => a.kwargs)));
    const r = Bun.spawnSync([python, join(here, "agent_r3_sdk_test.py")], { env: { ...process.env, PYTHONPATH: [join(laneb, "runner/agent"), here].join(":"), R3_AGENTS: agents } });
    const out = r.stdout.toString() + r.stderr.toString();
    if (r.exitCode !== 0) console.log(out);
    expect(out).not.toContain("FAIL");
    expect(out.match(/^pass arm /gm)).toHaveLength(5);
    expect(r.exitCode).toBe(0);
  }, 600_000);
});

describe("R3 ledger", () => {
  test("a reserve per trial at its allowance, a settle at metered cost, VM hours on the same item, and a refusal at the cap", () => {
    const path = join(tmp("r3-ledger-"), "r3a-screen.jsonl");
    approve(path);
    const cli = (...args: string[]) => Bun.spawnSync([process.execPath, join(laneb, "runner/ledger.ts"), ...args, "--path", path, "--item", "r3a-screen"]);
    expect(cli("reserve", "--id", "r3a-screen/vm", "--usd", "30", "--detail", "VM hours").exitCode).toBe(0);
    expect(cli("reserve", "--id", "r3a-screen/vm", "--usd", "30").exitCode).toBe(3);
    const L = new Ledger(path, "r3a-screen");
    let n = 0;
    for (; ; n++) {
      const r = L.reserve("r3a-screen/s-" + n, toMicros(4));
      if (!r.ok) { expect(r.reason).toBe("cap"); break; }
      expect(L.settle("r3a-screen/s-" + n, toMicros(0.75)).ok).toBe(true);
    }
    // $30 of VM hours open, $0.75 a settled trial: the reserve that would pass $150 is the first refused.
    expect(30 + n * 0.75 + 4).toBeGreaterThan(150);
    expect(30 + (n - 1) * 0.75 + 4).toBeLessThanOrEqual(150);
    expect(cli("settle", "--id", "r3a-screen/vm", "--usd", "11.5", "--detail", "VM hours: 5.75 h at $2/h").exitCode).toBe(0);
    const t = totals(readRows(path));
    expect(t.openIds).toEqual([]);
    expect(t.settledMicros).toBe(toMicros(n * 0.75 + 11.5));
    expect(cli("reserve", "--id", "r3a-screen/too-much", "--usd", "100").exitCode).toBe(3);
    expect(cli("settle", "--id", "r3a-screen/vm", "--usd", "1").exitCode).toBe(3);
  });

  test("the screen binds its item: a ledger with any reserve, or a cap other than $150, is refused", () => {
    const d = tmp("r3-bind-");
    approve(join(d, "fresh.jsonl"));
    expect(() => bindCheck(join(d, "fresh.jsonl"))).not.toThrow();
    approve(join(d, "used.jsonl"));
    new Ledger(join(d, "used.jsonl"), "r3a-screen").reserve("earlier-run/s-1", toMicros(4));
    expect(() => bindCheck(join(d, "used.jsonl"))).toThrow("an item serves one run");
    approve(join(d, "cap.jsonl"), 200);
    expect(() => bindCheck(join(d, "cap.jsonl"))).toThrow("not the prereg's $150");
  });
});

type T = { task: string; arm?: string; model?: string; reward?: number | null; ok?: number | null; spent?: number; told?: string; cmdNames?: string[]; lines?: unknown[]; exc?: string; noResult?: boolean; noConfig?: boolean };
// One Harbor trial directory plus its proxy session row, as the agent and proxy write them.
function writeTrial(jobs: string, sessions: string, t: T, i: number) {
  const name = t.task.slice(0, 20) + "__" + i;
  const d = join(jobs, "job", name);
  mkdirSync(join(d, "evaluator"), { recursive: true });
  mkdirSync(join(d, "agent"), { recursive: true });
  const kwargs = { arm: t.arm ?? "none", upstream_model: t.model ?? "claude-opus-5-5", ...(t.told ? { told_skill: t.told } : {}) };
  if (!t.noConfig) writeFileSync(join(d, "config.json"), JSON.stringify({ task: { path: "/vm/run/tasks/" + t.task }, agent: { name: "laneb-claude-code", kwargs } }));
  const reward = t.reward === undefined ? 0 : t.reward;
  if (!t.noResult) writeFileSync(join(d, "result.json"), JSON.stringify({ trial_name: name, verifier_result: reward === null ? null : { rewards: { reward } }, exception_info: t.exc ? { exception_type: t.exc, exception_message: "x" } : null }));
  writeFileSync(join(d, "evaluator/sdk-messages.jsonl"), (t.lines ?? [{ type: "AssistantMessage", content: [{ text: "Fixed the bug." }] }]).map((l) => JSON.stringify(l)).join("\n") + "\n");
  if (t.ok !== null) appendFileSync(sessions, JSON.stringify({ id: "s" + i, trial: name + "__env", model: kwargs.upstream_model, spent_micros: toMicros(t.spent ?? 0.5), ok_responses: t.ok ?? 3, requests: 4, refused: 0, refused_budget: 0, opened_at: "2026-11-01T00:00:0" + (i % 10) + "Z", closed_at: "2026-11-01T01:00:00Z", cmd_expanded: (t.cmdNames ?? []).length > 0, cmd_names: t.cmdNames ?? [] }) + "\n");
}

function load(trials: T[]): R3Trial[] {
  const d = tmp("r3-trials-");
  const sessions = join(d, "proxy-sessions.jsonl");
  writeFileSync(sessions, "");
  trials.forEach((t, i) => writeTrial(join(d, "jobs"), sessions, t, i));
  return loadR3Jobs(join(d, "jobs"), readFileSync(sessions, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)), proxyConfig);
}

const text = (s: string) => ({ type: "AssistantMessage", content: [{ text: s }] });
const read = (path: string) => ({ type: "AssistantMessage", content: [{ id: "t1", name: "Read", input: { file_path: path } }] });

describe("R3 procedure gate and classification", () => {
  test("the gate's patterns on transcripts that pass and fail", () => {
    const [expanded, opened, noProcedure, notOpened, lowercase, none] = load([
      { task: "a", arm: "gstack", told: "investigate", cmdNames: ["investigate"], lines: [text("## Phase 1: Root cause investigation\nfound it")] },
      { task: "b", arm: "gstack", told: "investigate", lines: [read("/root/.claude/skills/investigate/SKILL.md"), { type: "ResultMessage", result: "DEBUG REPORT\nStatus: DONE" }] },
      { task: "c", arm: "gstack", told: "investigate", cmdNames: ["investigate"], lines: [text("Fixed the bug.")] },
      { task: "d", arm: "gstack", told: "investigate", lines: [text("Phase 2: analysis")] },
      { task: "e", arm: "gstack", told: "investigate", cmdNames: ["investigate"], lines: [text("phase 1 done, debug report below; Phase 6")] },
      { task: "f", arm: "none", lines: [text("Phase 1")] },
    ]);
    expect([expanded, opened, noProcedure, notOpened, lowercase, none].map((t) => t!.exposed)).toEqual([true, true, false, false, false, false]);
    expect(expanded).toMatchObject({ body_loaded: true, investigate_opened: true, skill_opens: [], gate: { debug_report: false, phase: true } });
    expect(opened).toMatchObject({ body_loaded: false, investigate_opened: true, skill_opens: ["investigate"], gate: { debug_report: true, phase: false } });
    expect(notOpened).toMatchObject({ investigate_opened: false, procedure_shown: true });
    expect(none).toMatchObject({ told_skill: null, body_loaded: false, investigate_opened: false });
    expect(JSON.stringify([expanded, opened])).not.toContain("Root cause investigation");
  });

  test("graded needs a reward and a model response; anything else is infra (GSTA-2 ruling)", () => {
    const [fail, noResponse, fallback, noReward, capped, pass, noResult] = load([
      { task: "a", reward: 0 },
      { task: "b", reward: 0, ok: 0 },
      { task: "c", reward: 1, ok: null },
      { task: "d", reward: null },
      { task: "e", reward: 0, ok: null, lines: [], exc: "LedgerCapStop" },
      { task: "f", reward: 1, model: "particle-1", spent: 0.12 },
      { task: "g", noResult: true },
      { task: "h", noConfig: true },
    ]);
    expect([fail, noResponse, fallback, noReward, capped, pass, noResult].map((t) => t!.outcome)).toEqual(["fail", "infra", "pass", "infra", "infra", "pass", "infra"]);
    expect(noResult).toMatchObject({ task: "g", reason: "no result.json", reward: null });
    expect(noResponse!.reason).toContain("no model response reached the agent");
    expect(fallback).toMatchObject({ model_responded: true, cost_usd: null, attempts: 0 });
    expect(capped).toMatchObject({ cap_stop: true, model_responded: false });
    expect(pass).toMatchObject({ model: "particle-1", route: "openrouter", upstream_model: "particle-ai/particle-1", cost_usd: 0.12 });
    expect(fail).toMatchObject({ route: "anthropic", upstream_model: "claude-opus-5-5" });
    const rep = analyze([fail, pass, noResponse].map((t) => toTrial(t!)), { models: ["claude-opus-5-5", "particle-1"], arms: ["none"], reference: "claude-opus-5-5", seed: 1, b: 100 });
    expect(rep.passRates.map((c) => [c.model, c.trials, c.passes])).toEqual([["claude-opus-5-5", 1, 0], ["particle-1", 1, 1]]);
    expect(rep.infra.map((x) => x.task)).toEqual(["b"]);
  });
});

describe("R3 screen and admission", () => {
  const screen = (fails: number, passes: number, infra = 0) => load([
    ...Array.from({ length: fails }, (_, i) => ({ task: "f" + String(i).padStart(2, "0"), reward: 0, spent: 0.8 })),
    ...Array.from({ length: passes }, (_, i) => ({ task: "p" + i, reward: 1, spent: 0.6 })),
    ...Array.from({ length: infra }, (_, i) => ({ task: "i" + i, reward: null, ok: 0 })),
  ]);
  const pilot = (exposed: number) => load(Array.from({ length: 10 }, (_, i) => ({ task: "t" + i, arm: "gstack", told: "investigate", spent: 1.4, cmdNames: ["investigate"], lines: [text(i < exposed ? "DEBUG REPORT" : "done")] })));

  test("the pilot draw is r3-dry.ts's: 10 band tasks, seed 20261101", () => {
    const p = pilotTasks(bandIds());
    expect(p).toHaveLength(10);
    expect(new Set(p).size).toBe(10);
    expect(pilotTasks([...bandIds()].reverse())).toEqual(p);
    for (const t of p) expect(bandIds()).toContain(t);
  });

  test("admission passes, stops at saturation, and stops when the pilot shows the procedure in under 7", () => {
    const ok = admission(screen(40, 50, 3), pilot(8));
    expect(ok.exit).toBe(0);
    expect(ok.lines[0]).toBe("admission: 40 of 90 graded in-band tasks unsolved by Opus 5.5 none (3 infra); pilot exposure 8 of 10 graded told trials");
    const cNone = (40 * 0.8 + 50 * 0.6) / 90;
    expect(ok.lines[1]).toBe("R3b start: 40 tasks; measured cost per trial none $" + cNone.toFixed(2) + ", told $1.40; projection r3b-opus $" + (40 * 3 * (cNone + 1.4)).toFixed(0) + ", r3b-particle $54 (planning estimate $0.15 a trial); Garry records both caps before R3b starts");
    expect(ok.r3bTasks).toHaveLength(40);
    expect([...ok.r3bTasks].sort()).toEqual(ok.admitted);
    expect(admission(screen(40, 50, 3), pilot(8)).r3bTasks).toEqual(ok.r3bTasks);
    const many = admission(screen(80, 10), pilot(10));
    expect(many.r3bTasks).toHaveLength(70);
    expect(admission(screen(29, 60), pilot(10)).exit).toBe(5);
    const fix = admission(screen(40, 50), pilot(6));
    expect(fix.exit).toBe(6);
    expect(fix.lines[1]).toContain("STOP (FIX-METHOD)");
  });

  // A prepared and pulled R3a work dir: one none trial per band task (the first 35 fail) and one told trial per pilot task.
  function work(opts: { capStop?: "status" | "trial" | "vm" | "vm-block"; edit?: (parts: Record<string, T[]>) => void; after?: (w: string) => void } = {}) {
    const w = tmp("r3-work-");
    const ledger = join(w, "r3a-screen.jsonl");
    approve(ledger);
    const band = bandIds();
    const pilotIds = pilotTasks(band);
    writeFileSync(join(w, "plan.json"), JSON.stringify({ item: "r3a-screen", pilot_tasks: pilotIds }));
    const parts: Record<string, T[]> = {
      screen: band.map((task, i) => ({ task, reward: i < 35 ? 0 : 1 })),
      pilot: pilotIds.map((task) => ({ task, arm: "gstack", told: "investigate", cmdNames: ["investigate"], lines: [text("Phase 1")] })),
    };
    if (opts.capStop === "trial") parts.screen![92] = { task: band[92]!, reward: 0, ok: null, lines: [], exc: "LedgerCapStop" };
    opts.edit?.(parts);
    for (const [name, trials] of Object.entries(parts)) {
      const dir = join(w, name);
      mkdirSync(join(dir, "pulled/out"), { recursive: true });
      writeFileSync(join(dir, "proxy.json"), JSON.stringify(proxyConfig));
      writeFileSync(join(dir, "pulled/out/proxy-sessions.jsonl"), "");
      trials.forEach((t, i) => writeTrial(join(dir, "pulled/jobs"), join(dir, "pulled/out/proxy-sessions.jsonl"), t, i));
      writeFileSync(join(w, name + ".launch-exit"), name === "screen" && opts.capStop === "vm" ? "9\n" : "0\n");
    }
    if (opts.capStop === "status") writeFileSync(join(w, "screen/pulled/out/cap-stop.json"), JSON.stringify({ cap_stop: "ledger refused a reserve for t__1 at x" }));
    if (opts.capStop === "vm-block") writeFileSync(join(w, "screen/vm-cap-stop"), "the ledger refused VM block 3 (r3a-screen/vm-3, $4.000000) for r3a-screen\n");
    opts.after?.(w);
    const r = Bun.spawnSync([process.execPath, join(laneb, "r3/screen.ts"), "analyze", w], { env: { ...process.env, LEDGER: ledger } });
    return { w, code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
  }

  test("the screen writes the admitted list, the pilot exposure, the measured costs and the projection", () => {
    const r = work();
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
    expect(r.out).toContain("r3a-screen: 93 screen trials, 10 pilot trials, settled $0.00 of $150, open reserves 0");
    expect(r.out).toContain("admission: 35 of 93 graded in-band tasks unsolved by Opus 5.5 none (0 infra); pilot exposure 10 of 10 graded told trials");
    expect(r.out).toContain("R3b start: 35 tasks; measured cost per trial none $0.50, told $0.50; projection r3b-opus $105, r3b-particle $47");
    expect(readFileSync(join(r.w, "admitted.txt"), "utf8").trim().split("\n")).toHaveLength(35);
    const rec = JSON.parse(readFileSync(join(r.w, "record.json"), "utf8"));
    expect(rec.pilot).toMatchObject({ graded: 10, exposed: 10, body_loaded: 10, investigate_opened: 10, procedure_shown: 10 });
    expect(rec.measured_cost_per_trial_usd).toMatchObject({ none: 0.5, told: 0.5 });
    const exported = readFileSync(join(r.w, "trials.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(exported).toHaveLength(103);
    expect(exported.filter((t) => t.part === "pilot").every((t) => t.exposed && t.route === "anthropic")).toBe(true);
  });

  test("a trial with no result.json is infra, and admission counts it as one", () => {
    const r = work({ edit: (p) => { p.screen![92]!.noResult = true; } });
    expect(r.code).toBe(0);
    expect(r.out).toContain("admission: 35 of 92 graded in-band tasks unsolved by Opus 5.5 none (1 infra)");
  });

  const gaps: [string, (p: Record<string, T[]>) => void, string][] = [
    ["a planned task with no trial", (p) => { p.screen!.pop(); }, "screen: 1 of 93 planned tasks have no trial"],
    ["a trial directory that can't be attributed", (p) => { p.pilot![3]!.noConfig = true; }, "pilot: 1 of 10 planned tasks have no trial"],
    ["a second trial for a task", (p) => { p.screen!.push({ ...p.screen![0]! }); }, "screen: 1 tasks with more than one trial"],
    ["a trial outside the band", (p) => { p.screen!.push({ task: "astropy__astropy-00000", reward: 0 }); }, "screen: 1 trials outside the plan"],
    ["a screen trial in the wrong arm", (p) => { p.screen![5] = { ...p.screen![5]!, arm: "gstack", told: "investigate" }; }, "screen: 1 trials outside the plan"],
  ];
  for (const [what, edit, reason] of gaps) {
    test(`${what} makes R3a incomplete and admits nothing`, () => {
      const r = work({ edit });
      expect(r.code).toBe(4);
      expect(r.out).toContain(`R3 outcome: none (incomplete: ${reason}`);
      expect(existsSync(join(r.w, "admitted.txt"))).toBe(false);
    });
  }

  // GSTA-2 ruling A1: more than 10% infra trials in a part (10 or more of 93 screen trials, 2 or more of 10 pilot trials)
  // makes R3a incomplete before admission, so broken infrastructure can't end R3 as saturation or FIX-METHOD.
  const infra = (t: T): T => ({ ...t, reward: null, ok: 0 });
  const lastScreen = (n: number) => (p: Record<string, T[]>) => { for (let i = 93 - n; i < 93; i++) p.screen![i] = infra(p.screen![i]!); };
  const overInfra: [string, (p: Record<string, T[]>) => void, string][] = [
    ["an all-infra screen", lastScreen(93), "screen: 93 of 93 trials are infra, over 10%"],
    ["10 infra screen trials of 93", lastScreen(10), "screen: 10 of 93 trials are infra, over 10%"],
    ["2 infra pilot trials of 10", (p) => { p.pilot![0] = infra(p.pilot![0]!); p.pilot![1] = infra(p.pilot![1]!); }, "pilot: 2 of 10 trials are infra, over 10%"],
  ];
  for (const [what, edit, reason] of overInfra) {
    test(`${what} makes R3a incomplete and admits nothing`, () => {
      const r = work({ edit });
      expect(r.code).toBe(4);
      expect(r.out).toContain(`R3 outcome: none (incomplete: ${reason}`);
      expect(existsSync(join(r.w, "admitted.txt"))).toBe(false);
      expect(JSON.parse(readFileSync(join(r.w, "record.json"), "utf8")).outcome).toBe("incomplete");
    });
  }

  test("9 infra screen trials of 93 and 1 infra pilot trial of 10 go on to admission", () => {
    const r = work({ edit: (p) => { lastScreen(9)(p); p.pilot![0] = infra(p.pilot![0]!); } });
    expect(r.code).toBe(0);
    expect(r.out).toContain("admission: 35 of 84 graded in-band tasks unsolved by Opus 5.5 none (9 infra); pilot exposure 9 of 9 graded told trials");
  });

  // GSTA-2 ruling B1: a pulled proxy file that is empty or can't be parsed means the proxy failed at the end, so a cap stop
  // can't be ruled out; the part is incomplete and the reason names the file.
  const unreadable: [string, string, string | null][] = [
    ["screen", "cap-stop.json", ""],
    ["screen", "proxy-status-end.json", ""],
    ["pilot", "proxy-status-end.json", '{"cap_stop":'],
    ["screen", "proxy-sessions.jsonl", null],
    ["pilot", "proxy-sessions.jsonl", ""],
  ];
  for (const [part, file, content] of unreadable) {
    test(`${content === null ? "a truncated last line in" : content ? "an unparseable" : "an empty"} ${part} ${file} makes R3a incomplete and admits nothing`, () => {
      const r = work({ after: (w) => {
        const p = join(w, part, "pulled/out", file);
        if (content === null) appendFileSync(p, '{"id":"s99","trial":');
        else writeFileSync(p, content);
      } });
      expect(r.err).toBe("");
      expect(r.code).toBe(4);
      expect(r.out).toContain(`R3 outcome: none (incomplete: ${part}: pulled/out/${file} is empty or unparseable`);
      expect(existsSync(join(r.w, "admitted.txt"))).toBe(false);
      expect(JSON.parse(readFileSync(join(r.w, "record.json"), "utf8")).outcome).toBe("incomplete");
    });
  }

  for (const [part, content] of [["screen", ""], ["pilot", "x\n"]] as const) {
    test(`${content ? "a non-integer" : "an empty"} ${part}.launch-exit makes R3a incomplete and admits nothing`, () => {
      const r = work({ after: (w) => writeFileSync(join(w, part + ".launch-exit"), content) });
      expect(r.code).toBe(4);
      expect(r.out).toContain(`R3 outcome: none (incomplete: ${part}: launch exit unreadable`);
      expect(existsSync(join(r.w, "admitted.txt"))).toBe(false);
    });
  }

  test("a reanalysis that ends incomplete leaves no admitted.txt or r3b-tasks.txt from an earlier analysis", () => {
    const r = work();
    expect(r.code).toBe(0);
    expect(existsSync(join(r.w, "r3b-tasks.txt"))).toBe(true);
    writeFileSync(join(r.w, "screen/pulled/out/cap-stop.json"), JSON.stringify({ cap_stop: "ledger refused a reserve for t__1 at x" }));
    const again = Bun.spawnSync([process.execPath, join(laneb, "r3/screen.ts"), "analyze", r.w], { env: { ...process.env, LEDGER: join(r.w, "r3a-screen.jsonl") } });
    expect(again.exitCode).toBe(4);
    expect(existsSync(join(r.w, "admitted.txt"))).toBe(false);
    expect(existsSync(join(r.w, "r3b-tasks.txt"))).toBe(false);
  });

  test("run binds the item before its first spend: a second run, from this work dir or another, is refused", () => {
    const w = tmp("r3-bindrun-");
    const ledger = join(w, "r3a-screen.jsonl");
    approve(ledger);
    const prep = (name: string) => {
      mkdirSync(join(w, name, "screen"), { recursive: true });
      writeFileSync(join(w, name, "plan.json"), "{}");
      return join(w, name);
    };
    const env = { ...process.env, LEDGER: ledger, VM_USD_PER_HOUR: "1", UBI_RUNNER: "/bin/false", UBI_OWNER: "test", LEDGER_PORT: String(20000 + Math.floor(Math.random() * 20000)), ANTHROPIC_API_KEY: "", OPENROUTER_API_KEY: "" };
    const run = (d: string) => Bun.spawnSync([process.execPath, join(laneb, "r3/screen.ts"), "run", d], { env });
    run(prep("a"));
    expect(readFileSync(join(w, "a", "screen.launch-exit"), "utf8").trim()).toBe("1");
    expect(readRows(ledger).filter((x) => x.id === "r3a-screen/vm").map((x) => x.kind)).toEqual(["reserve", "settle"]);
    for (const d of [join(w, "a"), prep("b")]) {
      const again = run(d);
      expect(again.exitCode).toBe(1);
      expect(again.stderr.toString()).toContain("r3a-screen is already bound to a run");
    }
    expect(existsSync(join(w, "b", "screen.launch-exit"))).toBe(false);
    expect(readRows(ledger).filter((x) => x.kind === "reserve")).toHaveLength(1);
  });

  const badVm: [string, string | undefined, string][] = [
    ["0,6", undefined, "E_USAGE VM_USD_PER_HOUR and VM_RESERVE_HOURS must be positive numbers"],
    ["$0.60", undefined, "E_USAGE VM_USD_PER_HOUR and VM_RESERVE_HOURS must be positive numbers"],
    ["0", undefined, "E_USAGE VM_USD_PER_HOUR and VM_RESERVE_HOURS must be positive numbers"],
    ["2", "4h", "E_USAGE VM_USD_PER_HOUR and VM_RESERVE_HOURS must be positive numbers"],
    ["0.0000001", "4", "E_USAGE the VM block (0.0000001 $/h for 4 h) must come to more than $0, at most the $150 cap, and at least 2 seconds"],
    ["2", "0.0005", "E_USAGE the VM block (2 $/h for 0.0005 h) must come to more than $0, at most the $150 cap, and at least 2 seconds"],
    ["2", "100", "E_USAGE the VM block (2 $/h for 100 h) must come to more than $0, at most the $150 cap, and at least 2 seconds"],
  ];
  for (const [rate, hours, message] of badVm) {
    test(`run refuses a VM rate or block it can't reserve (${rate} $/h, ${hours ?? "default"} h) before it binds the item`, () => {
      const w = tmp("r3-vmrate-");
      const ledger = join(w, "r3a-screen.jsonl");
      approve(ledger);
      writeFileSync(join(w, "plan.json"), "{}");
      const env = { ...process.env, LEDGER: ledger, VM_USD_PER_HOUR: rate, VM_RESERVE_HOURS: hours, UBI_RUNNER: "/bin/false", UBI_OWNER: "test", ANTHROPIC_API_KEY: "", OPENROUTER_API_KEY: "" };
      const r = Bun.spawnSync([process.execPath, join(laneb, "r3/screen.ts"), "run", w], { env: env as Record<string, string> });
      expect(r.stderr.toString()).toContain(message);
      expect(r.exitCode).toBe(2);
      expect(existsSync(ledger + ".bound")).toBe(false);
      expect(existsSync(join(w, "screen.launch-exit"))).toBe(false);
      expect(readRows(ledger).filter((x) => x.kind === "reserve")).toEqual([]);
    });
  }

  for (const capStop of ["status", "trial", "vm", "vm-block"] as const) {
    test("a cap refusal (" + capStop + ") makes R3a incomplete and admits nothing", () => {
      const r = work({ capStop });
      expect(r.code).toBe(4);
      expect(r.out).toContain("R3 outcome: none (incomplete: ");
      expect(existsSync(join(r.w, "admitted.txt"))).toBe(false);
      expect(JSON.parse(readFileSync(join(r.w, "record.json"), "utf8")).outcome).toBe("incomplete");
    });
  }
});

describe("R3 body-load probe", () => {
  let upstream: ReturnType<typeof Bun.serve>;
  let proxy: ReturnType<typeof startProxy>;
  const dir = tmp("r3-probe-");
  const sessionsPath = join(dir, "sessions.jsonl");
  beforeAll(() => {
    upstream = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => Response.json({ id: "m", type: "message", role: "assistant", content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 2 } }) });
    const price = { input: 1, output: 1, cache_write_5m: 1, cache_write_1h: 1, cache_read: 1 };
    const config = { routes: { stub: { base_url: "http://127.0.0.1:" + upstream.port, key_env: "FAKE_KEY", auth: "x-api-key", count_tokens: "estimate" } }, models: { m: { route: "stub", upstream_model: "claude-opus-5-5", price_per_mtok: price } } } as unknown as ProxyConfig;
    proxy = startProxy({ config, dataHost: "127.0.0.1", dataPort: 0, controlPort: 0, env: { FAKE_KEY: "fake" }, logPath: join(dir, "req.jsonl"), sessionsPath });
  });
  afterAll(async () => {
    await proxy.stop();
    upstream.stop(true);
    rmSync(dir, { recursive: true, force: true });
  });
  const control = () => "http://127.0.0.1:" + proxy.control.port;
  async function session(body: Record<string, unknown>) {
    const s = (await (await fetch(control() + "/sessions", { method: "POST", body: JSON.stringify({ trial: "t__x", model: "m", cap_usd: 4, meta: { arm: "gstack" } }) })).json()) as any;
    const res = await fetch("http://127.0.0.1:" + proxy.data.port + "/v1/messages", { method: "POST", headers: { "x-api-key": s.token, "content-type": "application/json" }, body: JSON.stringify({ model: "m", max_tokens: 1000, stream: false, ...body }) });
    expect(res.status).toBe(200);
    await fetch("http://127.0.0.1:" + proxy.data.port + "/v1/messages", { method: "POST", headers: { "x-api-key": s.token, "content-type": "application/json" }, body: JSON.stringify({ model: "m", max_tokens: 1000, stream: false, messages: [{ role: "user", content: "<command-name>/review</command-name>" }] }) });
    await fetch(control() + "/sessions/" + s.id + "/close", { method: "POST", body: "{}" });
    return readFileSync(sessionsPath, "utf8").trim().split("\n").map((l) => JSON.parse(l)).find((r) => r.id === s.id);
  }

  test("the first request's slash-command expansion lands in the session row with the command's name", async () => {
    const row = await session({ messages: [{ role: "user", content: [{ type: "text", text: "<command-message>investigate is running</command-message>\n<command-name>/investigate</command-name>" }, { type: "text", text: "Base directory for this skill: /root/.claude/skills/investigate" }] }] });
    expect(row).toMatchObject({ cmd_expanded: true, cmd_names: ["investigate"] });
    expect(typeof row.first_req_prompt_tokens).toBe("number");
  });

  test("<command-name> outside the messages, as in the Skill tool's description, is not an expansion", async () => {
    const tools = [{ name: "Skill", description: "If you see a <command-name>x</command-name> tag, the skill is loaded.", input_schema: { type: "object" } }];
    const row = await session({ tools, messages: [{ role: "user", content: "do the task" }] });
    expect(row).toMatchObject({ cmd_expanded: false, cmd_names: [] });
  });
});

// The frozen r3-dry.ts (the prereg's attachment), run against this checkout's ledger.ts and analyze.ts instead of tag
// laneb-stacks-1-runner's, prints every R3 line of the prereg's dry-run.txt byte for byte: the same Ledger and analyze()
// results in all ten scenarios.
test("analyze() and the Ledger on r3-dry.ts's fixture trials print the contrasts the prereg's dry run printed at the tag", () => {
  const w = tmp("r3-dry-");
  writeFileSync(join(w, "r3-dry.ts"), readFileSync(join(prereg, "r3-dry.ts.txt")));
  mkdirSync(join(w, "laneb"));
  for (const [item, cap] of [["r3a-screen", 150], ["r3b-opus", 450], ["r3b-particle", 100]] as const) {
    writeFileSync(join(w, "laneb", item + ".jsonl"), JSON.stringify({ ts: new Date(0).toISOString(), item, kind: "approval", id: item + "-approval", usd_micros: cap * 1_000_000, cap_micros: cap * 1_000_000, words: "Dry run: keyless items at the frozen caps, no spend", by: "GEVA-101" }) + "\n");
  }
  const keep = /^(r3|admission|R3|particle|cell|contrast|procedure|contamination|gap)/;
  const want = readFileSync(join(prereg, "dry-run.txt"), "utf8").split("## R3:")[1]!.split("\n").filter((l) => keep.test(l));
  const got: string[] = [];
  for (const s of ["lift", "small", "nolift", "gatefail", "saturated", "pilotfail", "screenstop", "opusstop", "partstop", "infra"]) {
    const r = Bun.spawnSync([process.execPath, join(w, "r3-dry.ts"), join(laneb, "tasks/swebv-r3.txt"), join(w, "laneb"), join(w, s), s], { env: { ...process.env, TAG: repo } });
    expect(r.stderr.toString()).toBe("");
    got.push(...r.stdout.toString().split("\n").filter((l) => keep.test(l)));
  }
  expect(want).toHaveLength(135);
  expect(got).toEqual(want);
}, 300_000);
