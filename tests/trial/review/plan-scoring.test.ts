// The planning lane's failure rule (GST-737, the follow-up to #101), the sealed receipts sink and the seeded question
// preferences, keyless. The failure rule: the arm's own CLI crashing or timing out after the model produced output is a
// miss; the CLI crashing before any model output is a coverage gap that stops the arm; an infra failure (the evaluator's
// own code, the link to the CLI, the provider or the machine) is a gap at any point, never a miss; a stopped arm gets no
// verdict and its arm.json says why. Every session runs the real Claude Code driver on a stand-in for the Agent SDK's
// query, which spawns a stand-in CLI process through the driver the way the SDK does.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeCodeDriver } from "../../../src/adapters/claude-code/driver.ts";
import { REPO_ROOT } from "../../../src/cli.ts";
import { DEFAULT_POLICY, loadPolicy, type LoadedPolicy } from "../../../src/skill-eval/cli/policy.ts";
import type { HostRig } from "../../../src/skill-eval/cli/run-host.ts";
import { dirTreeSha256 } from "../../../src/trial/cache.ts";
import { removeTree } from "../../../src/trial/cleanup.ts";
import type { Sandbox } from "../../../src/trial/sandbox.ts";
import { seedStateRoot } from "../../../src/trial/state-root.ts";
import type { AgentOutcome } from "../../../src/trial/trial.ts";
import { GLOBAL_PREFERENCES, neverAskPreferences, PLAN_SEVERITY_MAP } from "../../../src/trial/review/plan.ts";
import { readReviewJournal, runReviewUnits, type PreparedUnit, type ReviewEntry, type ReviewRunInput } from "../../../src/trial/review/run.ts";
import { buildUnitRepo, buildUnitTree, unitTaskId } from "../../../src/trial/review/unit.ts";
import type { Termination } from "../../../src/types.ts";
import { harness, localSandbox } from "../../adapters/harness.ts";
import { PANEL_REPO, planPanel } from "../../noloss/plan-panel.ts";

const OPUS = "claude-opus-5-5";
const policy = loadPolicy(DEFAULT_POLICY) as LoadedPolicy;
const roots: string[] = [];
afterAll(() => roots.forEach((r) => removeTree(r)));
const scratch = (name: string) => {
  const d = mkdtempSync(join(tmpdir(), name));
  roots.push(d);
  return d;
};
const durable = () => {
  const d = mkdtempSync(join(REPO_ROOT, ".plan-scoring-test-"));
  roots.push(d);
  return d;
};
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const block = (items: unknown) => "```plan-findings\n" + JSON.stringify(items, null, 2) + "\n```";

function unitFixture() {
  const panel = planPanel(scratch("plan-scoring-"), { seeded: 1 });
  const u = panel.suite.units[0]!;
  const unit = { id: u.id, repo: PANEL_REPO, pr: u.pr, head: u.head, base: u.base };
  const repo = buildUnitRepo({ unit, source: panel.clone, dest: join(scratch("plan-scoring-unit-"), "repo"), baseBranch: "main" });
  const tree = buildUnitTree({ repo, task: unitTaskId(unit), dest: join(scratch("plan-scoring-tree-"), "tree"), image: "unused", test: null, install: null, scratch: scratch("plan-scoring-scratch-"), run: () => { throw new Error("a plan unit runs no container"); } });
  const prepared: PreparedUnit = { unit, task: unitTaskId(unit), base_branch: "main", merge_base: repo.merge_base, tree: tree.dir, tree_sha256: tree.tree_sha256, instructions: repo.instructions, check: null };
  return { panel, unit, prepared };
}

const bare = (name: string) => ({ tree_sha256: name + "-tree", skill: null, gstack: null, plugins: [] });
const baseInput = (prepared: PreparedUnit, suite: string, arms: string[], out: string, journal: string | null): ReviewRunInput => ({
  host: "claude", suite: { id: suite, sha256: null }, units: [prepared], arms: arms.map((name) => ({ name, told: name === "gstack" ? "gstack" : "none" })), models: [OPUS], passes: 1, parallel: arms.length, timeoutS: 3, cap: null,
  runId: "plan-scoring", out, date: "2026-10-31", policy, keyBase: { image_digest: null, recipe: "test", host_version: null, adapter_sha256: "test", isolation: "process" }, journal, plan: { lens: "ceo" },
  severityMap: Object.fromEntries(arms.map((a) => [a, PLAN_SEVERITY_MAP])), env: {},
});

// The Agent SDK's side of a session, standing in for query(): it spawns the CLI through the driver's
// spawnClaudeCodeProcess first, kills it on abort, and throws once the driver has aborted, as the SDK does.
type Sdk = { abortController: AbortController; canUseTool: (name: string, input: Record<string, unknown>, o: { toolUseID: string }) => Promise<unknown>; spawnClaudeCodeProcess: (s: { args: string[]; env: Record<string, string | undefined> }) => ChildProcess };
type Msg = Record<string, unknown>;
type Script = (sdk: Sdk, cli: ChildProcess) => AsyncGenerator<Msg>;
const standIn = (script: Script) => ({ options }: { prompt: AsyncIterable<Msg>; options: Record<string, unknown> }) => (async function* () {
  const sdk = options as unknown as Sdk;
  const cli = sdk.spawnClaudeCodeProcess({ args: [], env: {} });
  const kill = () => cli.kill("SIGKILL");
  sdk.abortController.signal.addEventListener("abort", kill);
  try {
    for await (const m of script(sdk, cli)) {
      if (sdk.abortController.signal.aborted) throw new Error("Claude Code process aborted by user");
      yield m;
    }
    if (sdk.abortController.signal.aborted) throw new Error("Claude Code process aborted by user");
  } finally {
    sdk.abortController.signal.removeEventListener("abort", kill);
    if (cli.exitCode === null && cli.signalCode === null) cli.kill("SIGKILL");
  }
})();

const init: Msg = { type: "system", subtype: "init", model: OPUS, tools: ["Skill", "Read", "AskUserQuestion"], skills: [], cwd: "/work" };
const assistant = (...content: Msg[]): Msg => ({ type: "assistant", message: { role: "assistant", content }, parent_tool_use_id: null, session_id: "s" });
const text = (t: string): Msg => ({ type: "text", text: t });
const result: Msg = { type: "result", subtype: "success", num_turns: 1, usage: { input_tokens: 10, output_tokens: 10 } };
/** The repro: one assistant message with a thinking block plus Skill and Read calls, which parses to no turns and two calls. */
const toolsOnly = assistant({ type: "thinking", thinking: "I should load the review skill and read the plan.", signature: "sig" }, { type: "tool_use", id: "toolu_skill", name: "Skill", input: { skill: "plan-ceo-review" } }, { type: "tool_use", id: "toolu_read", name: "Read", input: { file_path: "/work/plan.md" } });
/** The CLI process dies on its own (SIGKILL, as the adapter conformance test kills it), and the SDK reports the exit. */
async function crash(cli: ChildProcess): Promise<never> {
  const exited = once(cli, "exit");
  cli.kill("SIGKILL");
  await exited;
  throw new Error("Claude Code process terminated by signal SIGKILL");
}
const ASK = { questions: [{ question: "Which review mode should I use?", header: "Mode", multiSelect: false, options: [{ label: "HOLD SCOPE", description: "" }, { label: "SCOPE EXPANSION", description: "" }] }] };
const personaDown = async (): Promise<never> => {
  throw new Error("the persona's free-form model did not answer");
};

/** One arm per case, each running one session on the stand-in. */
const CASES: Record<string, { script: (out: string) => Script; persona?: "down"; spawn?: "fails"; machine?: "gone" }> = {
  ok: { script: () => async function* () { yield init; yield assistant(text("Mode: HOLD SCOPE.\n\n" + block([{ severity: "Critical", section: "Problem", line: 3, claim: "Wrong problem.", evidence: "context/goals.md", fix: "Plan offline reading." }]))); yield result; } },
  toolcrash: { script: () => async function* (_sdk, cli) { yield init; yield toolsOnly; await crash(cli); } },
  tooltimeout: { script: () => async function* (sdk) { yield init; yield toolsOnly; await new Promise((r) => sdk.abortController.signal.addEventListener("abort", r)); } },
  early: { script: () => async function* (_sdk, cli) { yield init; await crash(cli); } },
  transcript: { script: (out) => async function* () { yield init; yield assistant(text("Reading the plan.")); rmSync(join(out, "transcript.ndjson")); mkdirSync(join(out, "transcript.ndjson")); yield result; } },
  afterturn: { persona: "down", script: () => async function* () { yield init; yield assistant(text("I have read the plan. Should I also review the rollout section?")); yield result; } },
  ask: { persona: "down", script: () => async function* (sdk) {
    yield init;
    yield assistant({ type: "tool_use", id: "toolu_ask", name: "AskUserQuestion", input: ASK });
    let denied = true;
    try {
      await sdk.canUseTool("AskUserQuestion", ASK, { toolUseID: "toolu_ask" });
      denied = false;
    } catch {
      // the SDK answers the CLI with an error control response and the session goes on
    }
    yield { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_ask", content: denied ? "Error: permission check failed" : "answered", is_error: denied }] }, parent_tool_use_id: null };
    yield assistant(text(block([])));
    yield result;
  } },
  reset: { script: () => async function* () { yield init; yield assistant(text("Reading the plan.")); throw Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET", errno: -104, syscall: "read" }); } },
  upstream: { script: () => async function* () { yield init; yield assistant(text("Reading the plan.")); yield { type: "assistant", error: "server_error", is_api_error_message: true, message: { role: "assistant", content: [text("API Error: 500 Internal server error")] }, parent_tool_use_id: null }; yield { ...result, is_error: true }; } },
  machine: { machine: "gone", script: () => async function* (_sdk, cli) { yield init; yield assistant(text("Reading the plan.")); await crash(cli); } },
  nospawn: { spawn: "fails", script: () => async function* () { yield init; } },
};

describe("the planning lane's failure rule, end to end through the Claude Code driver (keyless)", () => {
  const out = durable();
  const sink = scratch("plan-scoring-sink-");
  const arms = Object.keys(CASES);
  let fx: ReturnType<typeof unitFixture>;
  let journal: Map<string, ReviewEntry>;
  let stops: { code: string; message: string }[];
  const entry = (arm: string) => [...journal.values()].find((e) => e.cell.arm === arm)!;
  const armJson = (arm: string) => JSON.parse(readFileSync(join(out, "arms", arm + "-opus", "arm.json"), "utf8"));
  const calls = (arm: string) => JSON.parse(readFileSync(join(out, "runs", OPUS, arm, fx.prepared.task, "p1", "host", "calls.json"), "utf8")).calls.map((c: { tool: string }) => c.tool);
  const note = (rest: string) => fx.unit.id + " pass 1: " + rest;
  const record = (arm: string) => { const r = entry(arm).record; return { termination: r.termination, model_output: r.model_output, turns: r.turns.length }; };
  const INFRA: Termination = { kind: "missing", code: "E_INFRA_FAILURE" };

  beforeAll(async () => {
    fx = unitFixture();
    const h = harness(() => [text("ok") as never]);
    roots.push(h.dir);
    const slots = new Map<string, string>();
    const sandbox = (arm: string): Sandbox => {
      const base = localSandbox(() => {});
      return {
        ...base,
        agent: (task, o) => ({
          ...base.agent(task, o),
          spawn: () => {
            if (CASES[arm]!.spawn === "fails") throw new Error("spawn docker ENOENT");
            return spawn("sleep", ["30"], { stdio: ["pipe", "pipe", "pipe"] });
          },
          ...(CASES[arm]!.machine === "gone" ? { exec: () => ({ exitCode: 1, timedOut: false, stdout: "", stderr: "Error response from daemon: No such container" }) } : {}),
        }),
      };
    };
    const rig: HostRig = {
      baseUrl: h.baseUrl, network: null, imageDigest: null,
      bind: async (request) => {
        const b = h.proxy.bind(request);
        slots.set(b.slot, request.cell.arm);
        return b;
      },
      finalize: (m) => h.proxy.finalize(m),
      arms: Object.fromEntries(arms.map((a) => [a, bare(a)])),
      sandbox: (arm) => sandbox(arm),
      judgeSandbox: () => localSandbox(() => {}),
      egress: () => ({ open: false, detail: "test rig" }),
      close: async () => ({ committed: 0, unknown: 0, lease_id: null }),
      recovery: null,
      driver: (o) => {
        const c = CASES[slots.get(o.proxy.slot)!]!;
        return claudeCodeDriver({ model: o.model, provider: "anthropic", proxy: o.proxy, skill: o.skill, out: o.out, ...(o.entry ? { entry: o.entry } : {}), ...(c.persona === "down" ? { freeform: personaDown } : o.freeform ? { freeform: o.freeform } : {}), query: standIn(c.script(o.out)) as never });
      },
    };
    const input = baseInput(fx.prepared, fx.panel.suite.id, arms, out, null);
    try {
      const run = await runReviewUnits({ ...input, suite: { ...input.suite, sealed: true }, env: { GSTACK_EVALS_EPHEMERAL: "1", GSTACK_EVALS_RECEIPTS: sink } }, rig);
      stops = run.stops;
    } finally {
      h.proxy.stop();
    }
    journal = readReviewJournal(out);
  }, 120_000);

  // Value: protects=a complete session still scores its findings and its arm completes; fails_when=the failure rule leaks into a clean session; why_new=GST-737 control case; seam=claudeCodeDriver, runReviewUnits; no_claim=a real model or CLI
  test("control: a clean session scores its findings, records model output and completes its arm", () => {
    expect(stops).toEqual([]);
    expect(record("ok")).toEqual({ termination: { kind: "completed" }, model_output: true, turns: 1 });
    expect([armJson("ok").status, armJson("ok").coverage_gaps, armJson("ok").diagnostics]).toEqual(["complete", undefined, undefined]);
  });

  // Value: protects=rule 1 and 2's repro: a session whose model produced only thinking and tool calls (0 turns, 2 calls), then whose CLI crashed, is a miss for the arm, read from the record's explicit model_output flag; fails_when=model output is inferred from turns, so the crash reads as a crash before output and stops the arm; why_new=GST-737 rule 1 and 2; seam=the driver's modelOutput, TrialRecord.model_output, planScore; no_claim=none beyond protects
  test("rule 1 and 2: a tool-call-only session whose CLI then crashes is a miss, from model_output, not turns", () => {
    expect(record("toolcrash")).toEqual({ termination: { kind: "arm_failure", failure: "harness_crash" }, model_output: true, turns: 0 });
    expect(calls("toolcrash")).toEqual(["Skill", "Read"]);
    expect([armJson("toolcrash").status, armJson("toolcrash").coverage_gaps, armJson("toolcrash").diagnostics]).toEqual(["complete", undefined, [note("incomplete, the session ended arm_failure; scored as finding nothing")]]);
  });

  // Value: protects=rule 1: the wall-clock limit after tool-call-only output is a miss; fails_when=the timeout stops the arm or completes it; why_new=GST-737 rule 1; seam=the driver's timer, planScore; no_claim=none beyond protects
  test("rule 1: a tool-call-only session that times out is a miss", () => {
    expect(record("tooltimeout")).toEqual({ termination: { kind: "timeout" }, model_output: true, turns: 0 });
    expect([armJson("tooltimeout").status, armJson("tooltimeout").diagnostics]).toEqual(["complete", [note("incomplete, the session ended timeout; scored as finding nothing")]]);
  });

  // Value: protects=rule 3: the CLI crashing before any model output is a coverage gap that stops the arm, and the gap says so; fails_when=it scores as a miss; why_new=GST-737 rule 3; seam=planScore; no_claim=none beyond protects
  test("rule 3: a CLI crash before any model output is a gap that stops the arm", () => {
    expect(record("early")).toEqual({ termination: { kind: "arm_failure", failure: "harness_crash" }, model_output: false, turns: 0 });
    expect([armJson("early").status, armJson("early").coverage_gaps, armJson("early").diagnostics]).toEqual(["stopped", [note("incomplete, the session ended arm_failure before any model output")], undefined]);
  });

  // Value: protects=rule 4's repro: the evaluator's own transcript append failing after one text turn is an infra failure, a gap that stops the arm, never the arm's crash or miss; fails_when=the driver's catch tags it arm_failure harness_crash and the turn makes it a miss; why_new=GST-737 rule 4 (driver.ts:275 at 1a6f747); seam=the driver's message loop; no_claim=none beyond protects
  test("rule 4: the transcript append failing after one text turn is infra, a gap that stops the arm", () => {
    expect(record("transcript")).toEqual({ termination: INFRA, model_output: true, turns: 1 });
    expect([armJson("transcript").status, armJson("transcript").coverage_gaps, armJson("transcript").diagnostics]).toEqual(["stopped", [note("incomplete, the session ended missing (E_INFRA_FAILURE)")], undefined]);
  });

  // Value: protects=rule 4: the user simulator failing in afterTurn (here its persona) is infra; fails_when=it reads as the arm's crash or a miss; why_new=GST-737 rule 4 (driver.ts:297 at 1a6f747); seam=the driver's message loop, sim.afterTurn; no_claim=none beyond protects
  test("rule 4: the user simulator failing after a turn is infra, a gap that stops the arm", () => {
    expect(record("afterturn")).toEqual({ termination: INFRA, model_output: true, turns: 1 });
    expect([armJson("afterturn").status, armJson("afterturn").coverage_gaps]).toEqual(["stopped", [note("incomplete, the session ended missing (E_INFRA_FAILURE)")]]);
  });

  // Value: protects=rule 4: the user simulator failing while answering AskUserQuestion is infra, though the SDK swallows a canUseTool rejection and the session would go on to score; fails_when=the session completes and scores as if nothing failed; why_new=GST-737 rule 4 (driver.ts:246 at 1a6f747); seam=the driver's canUseTool; no_claim=none beyond protects
  test("rule 4: the user simulator failing on an AskUserQuestion is infra, not a scored session", () => {
    expect(record("ask")).toEqual({ termination: INFRA, model_output: true, turns: 1 });
    expect([armJson("ask").status, armJson("ask").coverage_gaps]).toEqual(["stopped", [note("incomplete, the session ended missing (E_INFRA_FAILURE)")]]);
  });

  // Value: protects=rule 4, #101's outside voice: an ECONNRESET on the link to a CLI that still runs, after one text turn, is infra; fails_when=the catch tags it arm_failure harness_crash and run.ts scores it as the arm's miss; why_new=GST-737 (outside voice at 1a6f747); seam=the driver's catch, which reads whether the CLI process ended; no_claim=none beyond protects
  test("rule 4: an ECONNRESET after one text turn, with the CLI still running, is infra, not the arm's miss", () => {
    expect(record("reset")).toEqual({ termination: INFRA, model_output: true, turns: 1 });
    expect([armJson("reset").status, armJson("reset").coverage_gaps, armJson("reset").diagnostics]).toEqual(["stopped", [note("incomplete, the session ended missing (E_INFRA_FAILURE)")], undefined]);
  });

  // Value: protects=rule 4: a provider error after model output is a missing cell, never a miss; fails_when=it scores as the arm's failure; why_new=GST-737 rule 4; seam=the driver's API-error mapping; no_claim=a real provider's error shape
  test("rule 4: a provider error after model output is a gap, never a miss", () => {
    expect(record("upstream")).toEqual({ termination: { kind: "missing", code: "UPSTREAM" }, model_output: true, turns: 1 });
    expect([armJson("upstream").status, armJson("upstream").coverage_gaps]).toEqual(["stopped", [note("incomplete, the session ended missing (UPSTREAM)")]]);
  });

  // Value: protects=rule 4: the machine failing (the CLI ends and the agent's session no longer answers, or the CLI cannot be spawned) is infra; fails_when=a dead container after one turn reads as the arm's crash and a miss; why_new=GST-737 rule 4; seam=the driver's catch and spawnClaudeCodeProcess; no_claim=a real Docker daemon
  test("rule 4: a machine that stops answering, or cannot spawn the CLI, is infra", () => {
    expect(record("machine")).toEqual({ termination: INFRA, model_output: true, turns: 1 });
    expect(record("nospawn")).toEqual({ termination: INFRA, model_output: false, turns: 0 });
    for (const arm of ["machine", "nospawn"]) expect([armJson(arm).status, armJson(arm).coverage_gaps]).toEqual(["stopped", [note("incomplete, the session ended missing (E_INFRA_FAILURE)")]]);
  });

  // Value: protects=rule 5 and #101's p3 fix-check 2: progress.json counts each session the way arm.json scores it, so an arm failure scored as a miss is a fail and every gap is missing; fails_when=progress counts the miss as missing; why_new=GST-737; seam=recordSession's outcome, planScore; no_claim=none beyond protects
  test("rule 5: progress.json agrees with arm.json, and every stopped arm's arm.json says why", () => {
    const progress = JSON.parse(readFileSync(join(out, "progress.json"), "utf8"));
    expect([progress.passed, progress.failed, progress.timeouts, progress.missing]).toEqual([1, 1, 1, 8]);
    for (const arm of arms) {
      const a = armJson(arm);
      expect([arm, a.status === "stopped", (a.coverage_gaps ?? []).length === 1]).toEqual([arm, a.status === "stopped", a.status === "stopped"]);
    }
  });

  // Value: protects=a sealed run with a receipts sink outside the repo still copies its receipts there; fails_when=the sealed-sink guard refuses an outside sink; why_new=GST-737 receipts sink; seam=runReviewUnits; no_claim=none beyond protects
  test("a sealed run copies its receipts to a sink outside the repo", () => {
    expect(readFileSync(join(sink, "cells.ndjson"), "utf8")).toBe(readFileSync(join(out, "cells.ndjson"), "utf8"));
  });
});

describe("the receipts sink of a sealed suite (keyless)", () => {
  // Value: protects=a sealed suite never copies its receipts (cells.ndjson quotes held-out material) into the public repo, including the default <repo>/receipts and a symlink that resolves inside it; fails_when=GSTACK_EVALS_RECEIPTS inside the repo is accepted for a sealed suite; why_new=GST-737 (#101 p2 red team 2); seam=runReviewUnits beside sinkOverlapProblem; no_claim=an unsealed suite over sealed catalogs, which #101 leaves as a review note
  test("a sealed suite refuses a receipts sink inside the repo with E_USAGE, before any session", async () => {
    const fx = unitFixture();
    const bound: string[] = [];
    const rig = { bind: async () => { bound.push("bound"); throw new Error("no session may start"); }, arms: { none: bare("none") }, cells: {} } as unknown as HostRig;
    const link = join(scratch("plan-scoring-link-"), "receipts");
    symlinkSync(join(REPO_ROOT, "receipts"), link);
    const input = baseInput(fx.prepared, fx.panel.suite.id, ["none"], durable(), null);
    for (const sink of [join(REPO_ROOT, "receipts"), join(REPO_ROOT, ".plan-scoring-test-sink", "deep"), link]) {
      await expect(runReviewUnits({ ...input, suite: { ...input.suite, sealed: true }, env: { GSTACK_EVALS_EPHEMERAL: "1", GSTACK_EVALS_RECEIPTS: sink } }, rig)).rejects.toThrow("E_USAGE: suite " + fx.panel.suite.id + " is sealed, and the receipts sink ");
    }
    expect(bound).toEqual([]);
    await expect(runReviewUnits({ ...input, env: { GSTACK_EVALS_EPHEMERAL: "1", GSTACK_EVALS_RECEIPTS: join(REPO_ROOT, "receipts") } }, rig)).rejects.toThrow("no session may start");
    expect(readFileSync(join(REPO_ROOT, ".gitignore"), "utf8").split("\n")).toContain("receipts/");
  });
});

describe("the seeded question preferences (keyless)", () => {
  // Value: protects=a plan arm's gstack state root holds the never-ask preferences arm.json reports, even when the unit's tree ships its own global-question-preferences.json, and arm.json records the sha256 of the file written; fails_when=the fixture's always-ask file is kept while arm.json says never-ask; why_new=GST-737 (#101 outside voice, state-root.ts:35 at 1a6f747); seam=seedStateRoot, runReviewUnits; no_claim=how gstack reads the file
  test("never-ask wins over a unit's own preferences file, and arm.json records what was written", async () => {
    const fx = unitFixture();
    const tree = join(scratch("plan-scoring-own-prefs-"), "tree");
    cpSync(fx.prepared.tree, tree, { recursive: true, verbatimSymlinks: true });
    mkdirSync(join(tree, ".gstack-home"), { recursive: true });
    writeFileSync(join(tree, ".gstack-home", GLOBAL_PREFERENCES), JSON.stringify({ "plan-ceo-review-mode": "always-ask" }) + "\n");
    const prepared = { ...fx.prepared, tree, tree_sha256: dirTreeSha256(tree) };
    const home = scratch("plan-scoring-gstack-");
    const gdir = join(home, ".claude", "skills", "gstack");
    mkdirSync(join(gdir, "bin"), { recursive: true });
    mkdirSync(join(gdir, "scripts"), { recursive: true });
    writeFileSync(join(gdir, "scripts", "question-registry.ts"), "  'plan-ceo-review-mode': { id: 'plan-ceo-review-mode' },\n");
    const expected = neverAskPreferences(gdir)!;
    const h = harness(() => [text("ok") as never]);
    roots.push(h.dir);
    const seen: { prefs?: string } = {};
    const rig: HostRig = {
      baseUrl: h.baseUrl, network: null, imageDigest: null,
      bind: async (request) => h.proxy.bind(request),
      finalize: (m) => h.proxy.finalize(m),
      arms: { gstack: { tree_sha256: "gstack-tree", skill: null, gstack: ".claude/skills/gstack/bin/gstack-skill-start", plugins: [], layers: [{ src: home, dest: "" }] } },
      cells: { gstack: { [OPUS]: { cell: { model: OPUS, voice: null }, layer: null, gstack_config: { agent_model: "host", codex_reviews: "disabled" }, codex: null, tree_sha256: "gstack-opus" } } },
      sandbox: () => localSandbox(() => {}),
      judgeSandbox: () => localSandbox(() => {}),
      egress: () => ({ open: false, detail: "test rig" }),
      close: async () => ({ committed: 0, unknown: 0, lease_id: null }),
      recovery: null,
      driver: () => ({
        async run(session): Promise<AgentOutcome> {
          seen.prefs = session.exec('cat "$GSTACK_STATE_ROOT/' + GLOBAL_PREFERENCES + '"', 10_000).stdout;
          return { turns: [block([])], termination: { kind: "completed" }, model_output: true, opened: null, files_read: [], asked: [], usage: null, cost_micros: null, agent_turns: 1, loaded_bytes: null };
        },
      }),
    };
    const out = durable();
    try {
      expect((await runReviewUnits(baseInput(prepared, fx.panel.suite.id, ["gstack"], out, null), rig)).stops).toEqual([]);
    } finally {
      h.proxy.stop();
    }
    expect(JSON.parse(seen.prefs!)).toEqual({ "plan-ceo-review-mode": "never-ask" });
    expect(seen.prefs).toBe(expected);
    const arm = JSON.parse(readFileSync(join(out, "arms", "gstack-opus", "arm.json"), "utf8"));
    expect(arm.question_preferences).toBe("every registered question never-ask (auto-decide) in " + GLOBAL_PREFERENCES + ", written over any the unit ships");
    expect(arm.question_preferences_sha256).toBe(sha256(seen.prefs!));
  }, 60_000);

  // Value: protects=seeding writes a regular file in the state root, replacing a fixture's file, directory or symlink without writing through the symlink; fails_when=the fixture's file is kept or its symlink's target is overwritten; why_new=GST-737; seam=seedStateRoot; no_claim=a .gstack-home that is itself a symlink
  test("seedStateRoot replaces a fixture's file or symlink at a seeded name", () => {
    const outside = join(scratch("plan-scoring-outside-"), "target.json");
    writeFileSync(outside, "outside\n");
    for (const kind of ["file", "symlink", "dir"] as const) {
      const work = scratch("plan-scoring-seed-");
      mkdirSync(join(work, ".gstack-home"), { recursive: true });
      const at = join(work, ".gstack-home", GLOBAL_PREFERENCES);
      if (kind === "file") writeFileSync(at, "{}\n");
      else if (kind === "symlink") symlinkSync(outside, at);
      else mkdirSync(at);
      seedStateRoot(work, "/work/t", "core", {}, { [GLOBAL_PREFERENCES]: "never\n" });
      expect([kind, readFileSync(at, "utf8")]).toEqual([kind, "never\n"]);
    }
    expect(readFileSync(outside, "utf8")).toBe("outside\n");
  });
});
