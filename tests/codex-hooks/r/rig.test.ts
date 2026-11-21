import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { armSpec, jobConfig } from "../../../quick/laneb/runner/grid.ts";
import { drawnTasks, loadBundle } from "../../../lanes/delivery-route/pins.ts";
import { armProblems, MANIFESTS, normalizePromptInput, skillsListed, type ArmManifest } from "../../../lanes/codex-hooks/r/arms.ts";
import { approve, capRule, dryRun, launchGuard, needsRerun, planLines } from "../../../lanes/codex-hooks/r/money.ts";
import { ITEMS, itemPlan, R_PROFILE } from "../../../lanes/codex-hooks/r/plans.ts";
import { ARM_NAMES, ARMS, CODEX_BIN, ITEMS_USD, PILOT_TASKS, PROXY_CONFIG, QUESTION_REPLY, REPO, TASK_SETUP, sha256 } from "../../../lanes/codex-hooks/r/pins.ts";
import { codexAgent } from "../../../lanes/codex-hooks/r/prepare-run.ts";
import { buildRTable } from "../../../lanes/codex-hooks/r/table.ts";

const run = drawnTasks(loadBundle()).run;
const manifest = (arm: string) => JSON.parse(readFileSync(join(MANIFESTS, arm + ".json"), "utf8")) as ArmManifest;

describe("part R plan and money", () => {
  test("the items plan section 11's sessions and the cap rule gives the recorded caps", () => {
    expect(planLines(run).bad).toEqual([]);
    expect(itemPlan("r-pilot", run).parts.map((p) => p.name)).toEqual(["r-pilot"]);
    expect(new Set(itemPlan("r-pilot", run).parts[0]!.rects.flatMap((r) => r.tasks))).toEqual(new Set(PILOT_TASKS));
    expect(itemPlan("r-main", run).parts.map((p) => p.name)).toEqual(["r-1", "r-2", "r-3"]);
    expect([capRule("r-pilot"), capRule("r-main")]).toEqual([45, 165]);
    expect(ITEMS["r-main"]).toMatchObject({ capUsd: 165, allowanceUsd: 5, model: "gpt-6.1-sol", cells: "cells.codex-hooks-r.json", taskSet: "swerebench-r3a4" });
  });
  test("the dry run opens and settles one lease per item on a temporary ledger", () => {
    expect(dryRun()).toEqual(["dry run r-pilot: approval $45, one lease of $5 opened and settled, done", "dry run r-main: approval $165, one lease of $5 opened and settled, done"]);
  });
  test("an approval at any amount but the recorded cap is refused", () => {
    const d = mkdtempSync(join(tmpdir(), "r-approve-"));
    expect(() => approve(join(d, "r-main.jsonl"), "r-main", 170, "x")).toThrow("E_CODEX_R_MONEY");
    approve(join(d, "r-main.jsonl"), "r-main", 165, "x");
    expect(() => approve(join(d, "r-main.jsonl"), "r-main", 165, "x")).toThrow("already holds rows");
  });
  test("the guard reads the Captain's $1,200 all-in stop, holds r-main until r-pilot is done, and reads r-pilot's projection against its cap", () => {
    expect(() => launchGuard("r-pilot", {}, {}, { as_of: "now" } as any)).toThrow("usd");
    const main = launchGuard("r-main", {}, {}, { as_of: "now", usd: 0 });
    expect(main.ok).toBe(false);
    expect(main.why.join()).toContain("r-pilot is not marked done");
    // The pilot's projection: $9.30 planned, the $30 parallel reserve and a $7.20 VM share (host TTL and one part VM block)
    // come to $46.50, over its recorded $45 cap; that is a decision for the Captain, not a bug in the guard.
    const pilot = launchGuard("r-pilot", {}, {}, { as_of: "now", usd: 0 });
    expect(pilot.lines[0]).toContain("r-pilot $46.50 of cap $45.00");
    expect(pilot.lines[0]).toContain("all-in $184.38 of $1200.00");
    expect(launchGuard("r-pilot", {}, {}, { as_of: "now", usd: 1016 }).why.join()).toContain("passes the $1200.00 stop");
    expect(launchGuard("r-pilot", {}, {}, { as_of: "now", usd: 1015 }).why.join()).not.toContain("stop");
  });
});

describe("part R's prepare step and profile", () => {
  const job = jobConfig({ job_name: "t", tasks_dir: "/t", tasks: ["a"], models: [{ id: "gpt-6.1-sol", harbor_model: "openai/gpt-6.1-sol", session_cap_usd: 5 }], arms: ARM_NAMES.map((a) => { const { name, tar_name, ...o } = armSpec(ARMS[a].spec); return { name, tar: "/run/arms/" + a + ".tar", sha256: "x", ...o }; }) as any,
    attempts: 1, n_concurrent: 6, agent_dir: "/vm/runner/agent", runner_dir: "/vm/runner", base_url: "http://__GATEWAY__:8787", max_output_tokens: 32000, verifier_timeout_multiplier: 2, repo_dir: "/testbed" } as any);
  const agents = job.agents.map((a: any) => codexAgent(a, manifest(String(a.kwargs.arm))));
  test("each arm's agent is the Codex agent with the driver's argv and env and no Claude Code kwargs", () => {
    for (const a of agents) {
      const k = a.kwargs as Record<string, any>, gstack = ARMS[k.arm as keyof typeof ARMS].gstack;
      expect([a.name, a.import_path]).toEqual(["laneb-codex", "laneb_codex:LanebCodexAgent"]);
      expect(k.max_output_tokens).toBeUndefined();
      expect(k.codex_bin).toBe(CODEX_BIN);
      expect(k.codex_argv).toContain('model_providers.gstack_evals_proxy.base_url="http://__GATEWAY__:8787/laneb/openai/v1"');
      expect(k.codex_argv).toContain('model_reasoning_effort="low"');
      expect(k.codex_argv).toContain("features.sleep_tool=false");
      expect(k.codex_argv.slice(k.codex_argv.indexOf("-m"), k.codex_argv.indexOf("-m") + 2)).toEqual(["-m", "gpt-6.1-sol"]);
      expect(k.codex_argv.includes("--dangerously-bypass-hook-trust")).toBe(gstack);
      expect(k.codex_resume_argv.slice(-3)).toEqual(["resume", "__THREAD__", "-"]);
      expect(k.codex_env).toEqual({ OPENAI_API_KEY: "__SESSION_TOKEN__", GSTACK_SESSION_KIND: "unattended" });
      expect([k.hook_trust, k.gstack_config !== "", k.session_kind, k.closing_line, k.strip_snapshot, k.question_reply]).toEqual([gstack, gstack, "unattended", "hm-status", true, QUESTION_REPLY]);
      expect(k.prompt_input_sha256).toBe(manifest(k.arm).prompt_input.sha256);
    }
  });
  test("every kwarg is a field the Python agent's options take", () => {
    const fields = new Set(["skip_install"]);
    for (const f of ["laneb_agent.py", "laneb_hooks.py", "laneb_codex.py"]) for (const m of readFileSync(join(REPO, "quick/laneb/runner/agent", f), "utf8").matchAll(/^    (\w+): [\w\[\], |.]+ = Field\(/gm)) fields.add(m[1]!);
    for (const a of agents) expect(Object.keys(a.kwargs).filter((k) => !fields.has(k))).toEqual([]);
  });
  test("a job agent from another lane is refused", () => {
    expect(() => codexAgent({ name: "laneb-claude-code", import_path: "x", kwargs: { arm: "gstack" } }, manifest("r-on"))).toThrow("E_CODEX_R_PREPARE");
    expect(() => codexAgent({ name: "laneb-claude-code", import_path: "x", kwargs: { arm: "r-on", told_skill: "prove-it" } }, manifest("r-on"))).toThrow("told_skill");
  });
  test("the profile names part R's prepare step, proxy route, task setup and arms", () => {
    const proxy = JSON.parse(readFileSync(PROXY_CONFIG, "utf8"));
    expect(proxy.routes[proxy.models["gpt-6.1-sol"].route].key_env).toBe("OPENAI_API_KEY");
    expect(R_PROFILE.proxyConfig).toBe(PROXY_CONFIG);
    expect(R_PROFILE.prepareRun).toBe(join(REPO, "lanes/codex-hooks/r/prepare-run.ts"));
    expect(sha256(readFileSync(TASK_SETUP.file))).toBe(TASK_SETUP.sha256);
    expect(readFileSync(TASK_SETUP.file, "utf8").startsWith(readFileSync(TASK_SETUP.b1.file, "utf8"))).toBe(true);
    expect(R_PROFILE.armSpecs).toEqual(Object.fromEntries(ARM_NAMES.map((a) => [a, ARMS[a].spec])));
    expect(readFileSync(join(REPO, "quick/laneb/runner/launch.sh"), "utf8")).toContain(String.raw`if grep -q '"key_env": *"OPENAI_API_KEY"' "$run/proxy.json"`);
  });
});

describe("part R's arms", () => {
  test("the committed manifests hold prove-it, its listing and the switches, and r-on and r-off start alike", () => {
    for (const a of ARM_NAMES) expect(armProblems(manifest(a))).toEqual([]);
    expect(manifest("r-on").prompt_input.sha256).toBe(manifest("r-off").prompt_input.sha256);
    expect(manifest("r-on").prompt_input.prove_it_line).toStartWith("- prove-it: Use when fixing a bug");
    const on = readFileSync(join(MANIFESTS, "r-on.files.tsv"), "utf8").split("\n"), off = readFileSync(join(MANIFESTS, "r-off.files.tsv"), "utf8").split("\n");
    expect([...new Set(on.filter((l) => !off.includes(l)).map((l) => l.split("\t")[1]))]).toEqual([".gstack/config.yaml"]);
    expect(manifest("r-none").gstack).toBeNull();
  });
  test("the start capture's digest drops ids, create times and the date, and its skills list is read", () => {
    const cap = (id: string, t: number, date: string) => JSON.stringify([{ type: "message", id, content: [{ type: "input_text", text: "<skills_instructions>\n- prove-it: Fix bugs test first. (file: r0/prove-it/SKILL.md)\n- gstack-verify: Verify. (file: r0/gstack-verify/SKILL.md)" }], internal_chat_message_metadata_passthrough: { create_time: t } }, { type: "message", content: [{ type: "input_text", text: "<current_date>" + date + "</current_date>" }] }]);
    expect(normalizePromptInput(cap("a", 1, "2026-11-20"))).toBe(normalizePromptInput(cap("b", 2, "2026-11-21")));
    expect(skillsListed(cap("a", 1, "x"))).toEqual({ skills: ["prove-it", "gstack-verify"], proveIt: "- prove-it: Fix bugs test first. (file: r0/prove-it/SKILL.md)" });
  });
});

describe("part R's session table", () => {
  const root = "019a0000-0000-7000-8000-000000000001";
  function trial(jobs: string, name: string, o: { arm?: string; reward?: number | null; exc?: string; rollout?: boolean; model?: string; version?: string; ok?: number; refusedBudget?: number }) {
    const d = join(jobs, name), ev = join(d, "evaluator");
    mkdirSync(join(ev, "codex-sessions/2026/11/20"), { recursive: true });
    writeFileSync(join(d, "config.json"), JSON.stringify({ agent: { name: "laneb-codex", kwargs: { arm: o.arm ?? "r-on" } }, task: { path: "/t/" + name.split("__x")[0] } }));
    writeFileSync(join(d, "result.json"), JSON.stringify({ trial_name: name, ...(o.exc ? { exception_info: { exception_type: o.exc } } : {}), ...(o.reward === null ? {} : { verifier_result: { rewards: { reward: o.reward ?? 1 } } }) }));
    writeFileSync(join(ev, "laneb-summary.json"), JSON.stringify({ result: { thread_id: root, questions: 1, resumes: 1 }, session: { ok_responses: o.ok ?? 2, usage: { input_tokens: 10, output_tokens: 5 } }, wall_s: 12.5 }));
    if (o.rollout !== false) writeFileSync(join(ev, "codex-sessions/2026/11/20/rollout-x-" + root + ".jsonl"), [{ type: "session_meta", payload: { id: root, cli_version: o.version ?? "0.170.0" } }, { type: "turn_context", payload: { model: o.model ?? "gpt-6.1-sol", effort: "low" } }].map((x) => JSON.stringify(x)).join("\n") + "\n");
    return { id: "s-" + name, trial: name, spent_micros: 120000, ok_responses: o.ok ?? 2, requests: 3, refused: 0, refused_budget: o.refusedBudget ?? 0, opened_at: "2026-11-20T00:00:00Z" };
  }
  test("graded, limit stops, cap stops and the infrastructure reasons follow section 4.7 and change 1 section 10", () => {
    const d = mkdtempSync(join(tmpdir(), "r-table-")), jobs = join(d, "jobs/j1");
    mkdirSync(jobs, { recursive: true });
    const sess = [
      trial(jobs, "a__x1", {}), trial(jobs, "b__x2", { arm: "r-off", reward: 0, refusedBudget: 1 }), trial(jobs, "c__x3", { exc: "LedgerCapStop", reward: null }),
      trial(jobs, "d__x4", { rollout: false }), trial(jobs, "e__x5", { model: "gpt-6.2-sol" }), trial(jobs, "f__x6", { ok: 0 }), trial(jobs, "g__x7", { exc: "AgentTimeoutError" }), trial(jobs, "h__x8", { reward: null }),
    ];
    writeFileSync(join(d, "sessions.jsonl"), sess.map((s) => JSON.stringify(s)).join("\n") + "\n");
    const rows = buildRTable({ jobs: [{ dir: jobs, part: "r-1" }], sessions: [join(d, "sessions.jsonl")] });
    expect(rows.map((r) => [r.task, r.outcome, r.reason])).toEqual([
      ["a", "graded", "graded"], ["b", "graded", "allowance limit stop, graded on what it left"], ["c", "cap_stop", "ledger cap stop"],
      ["d", "infra", "no rollout copied out for the root thread"], ["e", "infra", "root thread on gpt-6.2-sol at low in Codex 0.170.0, not gpt-6.1-sol at low in 0.170.0"],
      ["f", "infra", "no model response reached the agent"], ["g", "graded", "time limit stop, graded on what it left"], ["h", "infra", "no verifier reward, verifier infrastructure error"],
    ]);
    expect(rows.filter(needsRerun).map((r) => r.task)).toEqual(["d", "f", "h"]);
    expect(rows[0]).toMatchObject({ pass: true, questions: 1, resumes: 1, wall_s: 12.5, cost_usd: 0.12, tokens: 15 });
  });
});
