import { afterEach, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NO_SKILL, withSentinel } from "../../src/adapters/calibration.ts";
import { judgeDriver } from "../../src/adapters/judge.ts";
import { SKILL_DIRS } from "../../src/adapters/host.ts";
import { DEFAULT_POLICY, loadPolicy, type LoadedPolicy } from "../../src/skill-eval/cli/policy.ts";
import { dockerRig, hostReadiness, readJournal, runOnHost, sentinels, type HostRig, type HostRunInput } from "../../src/skill-eval/cli/run-host.ts";
import { resolveCall, type Call } from "../../src/skill-eval/cli/call.ts";
import { parseFlags, SKILL_EVAL_FLAGS } from "../../src/skill-eval/cli/flags.ts";
import { preflight } from "../../src/skill-eval/cli/preflight.ts";
import { runOnRealHost } from "../../src/skill-eval/cli/skill-eval.ts";
import { collect } from "../cli/helpers.ts";
import { recordApproval } from "../../src/runner/ledger/ledger.ts";
import { buildTrialImage, stateRoot } from "../../src/trial/image.ts";
import { decide, DEFAULT_OPTIONS } from "../../src/skill-eval/verdict/gates.ts";
import type { ArmSpec, Host } from "../../src/types.ts";
import { HAS_CLAUDE_CLI, HAS_CODEX_CLI, harness, localSandbox, type Harness, type Item, type ResponsesScript, type Script } from "./harness.ts";

let open: Harness[] = [];
afterEach(() => {
  for (const h of open) h.close();
  open = [];
});

const policy = loadPolicy(DEFAULT_POLICY) as LoadedPolicy;
const SKILL = "demo";
const NONCE = "n0nce42";
const MODELS: Record<Host, string> = { claude: "claude-haiku-5-5", codex: "gpt-6.1-sol" };
/** The model the Claude Code script fails in the after arm, so its hello task goes red. */
const RED_MODEL = "claude-sonnet-5-5";

function armDir(root: string, name: string): string {
  const dir = join(root, "arms", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), "---\nname: demo\ndescription: Demo skill, arm " + name + ".\n---\n# Demo " + name + "\n");
  return dir;
}

/** The test rig: the harness's in-process proxy, local sandboxes that install each arm (or its calibration copy) in the trial HOME. */
function rig(h: Harness, host: Host, arms: ArmSpec[], o: { egressOpen?: boolean; leakInto?: string; nonce?: string } = {}): HostRig {
  const marks = sentinels(arms, o.nonce ?? NONCE);
  const copy = (arm: ArmSpec, home: string, calibration: boolean) => {
    if (arm.kind !== "overlay" || !arm.dir) return;
    const to = join(home, SKILL_DIRS[host], SKILL);
    cpSync(arm.dir, to, { recursive: true });
    if (calibration) writeFileSync(join(to, "SKILL.md"), withSentinel(readFileSync(join(arm.dir, "SKILL.md"), "utf8"), marks[arm.name]!));
  };
  return {
    baseUrl: h.baseUrl,
    network: null,
    imageDigest: null,
    bind: async (request) => h.proxy.bind(request),
    finalize: (meterId) => h.proxy.finalize(meterId),
    sandbox: (name, calibration) => localSandbox((home) => {
      copy(arms.find((a) => a.name === name)!, home, calibration);
      if (calibration && o.leakInto === name) copy(arms.find((a) => a.name === "after")!, home, true);
    }),
    judgeSandbox: () => localSandbox(() => {}),
    egress: () => ({ open: o.egressOpen ?? false, detail: "the test rig's probe" }),
    close: async () => ({ committed: 0, unknown: 0, lease_id: null }),
    recovery: null,
  };
}

const SENTINEL_RE = /gstack-evals-sentinel: [A-Za-z0-9-]+/;
const firstUser = (body: Record<string, any>): string => {
  for (const m of body.messages ?? body.input ?? []) {
    if (m.role !== "user") continue;
    const text = typeof m.content === "string" ? m.content : (m.content ?? []).map((b: any) => b.text ?? "").join("");
    if (text.includes("Calibration check") || text.includes("Say hello")) return text;
  }
  return "";
};

/** A well-behaved model for Claude Code: it reads the skill through the shell, runs the echo, asks the approach question, and answers each task with HELLO. */
const claudeModel: Script = ({ results, body }) => {
  const prompt = firstUser(body);
  const all = [...results.values()].map((r) => r.text).join("\n");
  if (prompt.includes("gstack-evals-sentinel")) {
    if (!results.has("toolu_cat")) return [{ type: "tool_use", id: "toolu_cat", name: "Bash", input: { command: "cat ~/.claude/skills/" + SKILL + "/SKILL.md", description: "Read the skill" } }];
    return [{ type: "text", text: all.match(SENTINEL_RE)?.[0] ?? NO_SKILL }];
  }
  if (prompt.includes("Run this shell command")) {
    if (!results.has("toolu_echo")) return [{ type: "tool_use", id: "toolu_echo", name: "Bash", input: { command: prompt.split("prints: ")[1]!, description: "Echo" } }];
    return [{ type: "text", text: results.get("toolu_echo")!.text.trim() }];
  }
  if (prompt.includes("AskUserQuestion")) {
    if (!results.has("toolu_ask")) return [{ type: "tool_use", id: "toolu_ask", name: "AskUserQuestion", input: { questions: [{ question: "Which approach should we take?", header: "Approach", multiSelect: false, options: [{ label: "Approach A", description: "" }, { label: "Approach B", description: "" }] }] } }];
    return [{ type: "text", text: results.get("toolu_ask")!.text.includes("Approach B") ? "Approach B" : "unknown" }];
  }
  if (body.model === RED_MODEL && JSON.stringify(body).includes("arm after")) return [{ type: "text", text: "Goodbye." }];
  return [{ type: "text", text: "HELLO from the task." }];
};

/** The same model for Codex, through exec_command. */
const codexModel: ResponsesScript = ({ outputs, body }) => {
  const prompt = firstUser(body);
  const all = [...outputs.values()].join("\n");
  if (prompt.includes("gstack-evals-sentinel")) {
    if (!outputs.has("call_cat")) return [{ type: "shell", id: "call_cat", cmd: "cat ~/.codex/skills/" + SKILL + "/SKILL.md" }];
    return [{ type: "message", text: all.match(SENTINEL_RE)?.[0] ?? NO_SKILL }];
  }
  if (prompt.includes("Run this shell command")) {
    if (!outputs.has("call_echo")) return [{ type: "shell", id: "call_echo", cmd: prompt.split("prints: ")[1]! }];
    return [{ type: "message", text: all.match(/[A-Za-z0-9]+-\d+/)?.[0] ?? "no output" }];
  }
  return [{ type: "message", text: "HELLO from the task." }];
};

async function runHost(host: Host, o: { interactive?: boolean; egressOpen?: boolean; leakInto?: string; cap?: number | null; root?: string; judge?: boolean; responses?: ResponsesScript; extra?: Partial<HostRunInput>; calibrateOnly?: boolean; models?: string[] } = {}) {
  const h = harness(host === "claude" ? claudeModel : () => [], { responses: o.responses ?? codexModel });
  open.push(h);
  const root = o.root ?? mkdtempSync(join(tmpdir(), "gse-runhost-"));
  const arms: ArmSpec[] = [
    { name: "before", kind: "overlay", base: null, skill: SKILL, dir: armDir(root, "before") },
    { name: "after", kind: "overlay", base: null, skill: SKILL, dir: armDir(root, "after") },
    { name: "none", kind: "overlay", base: null, skill: SKILL, dir: null },
  ];
  const tasksDir = join(root, "tasks");
  mkdirSync(tasksDir, { recursive: true });
  const interactive = o.interactive ?? false;
  const run = await runOnHost({
    host, models: o.models ?? [MODELS[host]], trials: 1, parallel: 2, timeoutS: 120, cap: o.cap === undefined ? null : o.cap, runId: "run-test", out: join(root, "out"), tasksDir, policy, arms, skill: SKILL, nonce: NONCE,
    judgeModel: host === "claude" ? "gpt-6.1-sol" : "claude-opus-5-5", keyBase: { image_digest: null, recipe: "test", host_version: "test", adapter_sha256: "test", isolation: "process", verifier: "test" },
    tasks: [{ id: "hello", prompt: "Say hello." }],
    verdict: [{ id: "hello", safety: false, interactive, judge: o.judge ?? false, must: ["hello"], must_not: [], check: false }],
    entries: interactive ? { hello: { interactive: true, user: { replies: { mode: "Building a startup" } } } } : o.judge ? { hello: { judge: "The answer greets the user." } } : {},
    ...(o.calibrateOnly ? { calibrateOnly: true } : {}),
    ...o.extra,
  }, rig(h, host, arms, o));
  return { run, root, h };
}

describe.skipIf(!HAS_CLAUDE_CLI || !HAS_CODEX_CLI)("the run loop on a real host's adapter, against a fake upstream behind the metering proxy", () => {
  // Value: protects=a task with a judge rubric sends each run to a fresh judge session of the other family, blinded to the arm, the skill, the model and the host, as one request with no tools and no host CLI (so the judge cannot read the arm), and every judgment lands in adjudication.ndjson; a judge that cannot answer leaves the run unjudged, unjournaled (so --resume judges it again) and stops the verdict with JUDGE_UNAVAILABLE; fails_when=the judge prompt names the arm, skill, model or host, a judged run keeps judge null, or a broken judge passes silently; why_new=U10 done criterion (adjudication blinding and JUDGE_UNAVAILABLE); seam=runOnHost's adjudication, judgePrompt, parseJudgment; no_claim=a real judge model's accuracy
  test("adjudication is blinded and cross-family, and a judge that cannot answer stops with JUDGE_UNAVAILABLE", async () => {
    const prompts: string[] = [];
    const judge = (answer: Item[] | null): ResponsesScript => (turn) => {
      const prompt = firstUser(turn.body);
      if (!prompt.includes("You are grading one answer")) return codexModel(turn);
      prompts.push(prompt);
      if (!answer) throw new Error("the judge's upstream is down");
      return answer;
    };
    const { run, root, h } = await runHost("claude", { judge: true, responses: judge([{ type: "message", text: "VERDICT: done" }]) });
    expect(run.input.records.map((r) => [r.arm, r.judge])).toEqual([["before", "done"], ["after", "done"], ["none", "done"]]);
    expect(prompts).toHaveLength(3);
    for (const p of prompts) {
      expect(p).toContain("The answer greets the user.");
      expect(p).toContain("HELLO from the task.");
      for (const leak of ["before", "after", SKILL, MODELS.claude, "claude", "Claude"]) expect(p).not.toContain(leak);
    }
    const lines = readFileSync(join(root, "out", "adjudication.ndjson"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    for (const l of lines) {
      expect(l.dir.startsWith(join(root, "out", "judge") + "/")).toBe(true);
      for (const leak of ["before", "after", MODELS.claude]) expect(l.dir).not.toContain(leak);
      expect(l.redacted).toBe(0);
    }
    expect(lines.map((l) => [l.cell.arm, l.judge_route, l.judge_model, l.judgment])).toEqual(expect.arrayContaining([["before", "openai /v1/responses", "gpt-6.1-sol", "done"], ["after", "openai /v1/responses", "gpt-6.1-sol", "done"], ["none", "openai /v1/responses", "gpt-6.1-sol", "done"]]));
    const judged = h.upstream.filter((u) => JSON.stringify(u.body).includes("You are grading one answer"));
    expect(judged).toHaveLength(3);
    for (const u of judged) expect([Object.keys(u.body).sort(), u.body.input.length, u.body.stream ?? false]).toEqual([["input", "max_output_tokens", "model", "service_tier", "store"], 1, false]);
    for (const l of lines) expect(existsSync(join(l.dir, "host"))).toBe(false);
    expect(run.input.stops).toEqual([]);

    prompts.length = 0;
    const down = await runHost("claude", { judge: true, responses: judge(null) });
    expect(prompts.length).toBeGreaterThan(0);
    expect(down.run.input.records.every((r) => r.judge === null)).toBe(true);
    expect(down.run.input.stops).toEqual([{ code: "JUDGE_UNAVAILABLE", model: MODELS.claude, subject: "hello" }]);
    const journal = join(down.root, "out", "cells.ndjson");
    expect(existsSync(journal) ? readFileSync(journal, "utf8").trim() : "").toBe("");
    expect(decide(down.run.input, DEFAULT_OPTIONS).reasons).toContain("JUDGE_UNAVAILABLE hello");
  }, 300_000);

  // Value: protects=--resume reuses every journaled session whose key still matches and spends nothing on it; a changed key stops with E_CACHE_STALE naming the changed part before any session runs; --repair reruns exactly the stale cells and journals them; fails_when=resume reruns a finished cell, runs over a changed key, or repair skips a stale cell; why_new=U10 done criterion (stale-cache conformance, --resume and --repair); seam=runOnHost's reuse and staleParts, readJournal, cells.ndjson; no_claim=the CLI's proxy recovery order, which recoverRun's own tests cover
  test("--resume reuses matching cells, a changed key stops with E_CACHE_STALE, and --repair reruns the stale cells", async () => {
    let sessions = 0;
    const responses: ResponsesScript = (turn) => {
      if (firstUser(turn.body) === "Say hello." && turn.outputs.size === 0) sessions++;
      return codexModel(turn);
    };
    const first = await runHost("codex", { responses });
    const out = join(first.root, "out");
    const journal = () => readFileSync(join(out, "cells.ndjson"), "utf8").trim().split("\n");
    expect(journal()).toHaveLength(3);

    expect(sessions).toBeGreaterThanOrEqual(3);
    sessions = 0;
    const resumed = await runHost("codex", { root: first.root, responses, extra: { reuse: readJournal(out) } });
    expect(resumed.run.stale).toEqual([]);
    expect(resumed.run.input.records.map((r) => [r.arm, r.termination.kind])).toEqual(first.run.input.records.map((r) => [r.arm, r.termination.kind]));
    expect(sessions).toBe(0);
    expect(journal()).toHaveLength(3);

    const changed = { image_digest: null, recipe: "test", host_version: "test", adapter_sha256: "changed", isolation: "process", verifier: "test" } as const;
    const stale = await runHost("codex", { root: first.root, responses, extra: { reuse: readJournal(out), keyBase: changed } });
    expect(stale.run.stale.map((s) => s.code)).toEqual(["E_CACHE_STALE", "E_CACHE_STALE", "E_CACHE_STALE"]);
    expect(stale.run.stale[0]!.message).toContain("changed: adapter_sha256");
    expect(stale.run.spent).toBe(0);
    expect(stale.run.input.records).toEqual([]);

    const repaired = await runHost("codex", { root: first.root, responses, extra: { reuse: readJournal(out), keyBase: changed, repair: true } });
    expect(repaired.run.stale).toEqual([]);
    expect(repaired.run.input.records.map((r) => r.arm)).toEqual(["before", "after", "none"]);
    expect(sessions).toBeGreaterThanOrEqual(3);
    expect(journal()).toHaveLength(6);
    expect([...readJournal(out).values()].every((e) => e.key.parts.adapter_sha256 !== undefined)).toBe(true);
  }, 300_000);

  // Value: protects=calibration passes on both hosts against the fake upstream (each skill arm quotes its own sentinel and shows the read, none answers NO-SKILL, the shell output comes back, the user simulator round trip completes on Claude Code), then the trials run in every arm, each metered, and U6's verdict reads them; fails_when=a check passes without its evidence, a session's cost is not metered, or the loop skips an arm; why_new=U10 done criterion (calibration passes on both hosts against the fake upstream); seam=runOnHost, calibrationProbes, judgeCalibration, the adapters; no_claim=a real model, Docker isolation or the egress lock, which the Docker rig covers
  for (const host of ["claude", "codex"] as const) {
    test("calibration passes and the trials run on " + host, async () => {
      const { run, root } = await runHost(host, { interactive: host === "claude" });
      expect(run.calibrationFailures).toEqual([]);
      expect(run.input.calibration[MODELS[host]]).toEqual({ skill: true, none: true, shell: true, config: null, usersim: host === "claude" ? true : null, egress: true });
      expect(run.input.records.map((r) => [r.arm, r.termination.kind, r.opened])).toEqual([["before", "completed", false], ["after", "completed", false], ["none", "completed", null]]);
      expect(run.input.records.every((r) => (r.cost_micros ?? 0) > 0)).toBe(true);
      expect(run.spent).toBeGreaterThan(0);
      expect(decide(run.input, DEFAULT_OPTIONS).exit_code).not.toBe(3);
      expect(existsSync(join(root, "out", "progress.json"))).toBe(true);
    }, 300_000);
  }

  // Value: protects=a leak into the none arm's HOME and an open egress path each stop the run with exit 3 and the check's code, naming the arm, host and model, and no trial runs; fails_when=a leak or open egress still runs trials or exits anything but 3; why_new=U10 scope (calibration checks and their CALIBRATION_* codes); seam=judgeCalibration, runOnHost; no_claim=none beyond protects
  test("a leak into none and an open egress path stop the run with exit 3 before any trial", async () => {
    const { run } = await runHost("codex", { leakInto: "none", egressOpen: true });
    expect(run.calibrationFailures.map((f) => f.code)).toEqual(["CALIBRATION_NONE_LEAK", "CALIBRATION_EGRESS"]);
    expect(run.calibrationFailures[0]!.message).toContain("arm none on codex, model gpt-6.1-sol: the answer quoted the sentinel of after");
    expect(run.input.records).toEqual([]);
    expect(decide(run.input, DEFAULT_OPTIONS).exit_code).toBe(3);
  }, 300_000);

  // Value: protects=--calibrate's run stops after calibration on both hosts: every check passes and no trial runs; fails_when=a trial runs after calibration or the result is lost; why_new=--calibrate (U10's unbuilt flag); seam=runOnHost's calibrateOnly; no_claim=the CLI's calibration.json, which tests/cli/fake-host.test.ts covers
  test("calibrateOnly runs calibration on both hosts and no trial", async () => {
    for (const host of ["claude", "codex"] as const) {
      const { run, root } = await runHost(host, { interactive: host === "claude", calibrateOnly: true });
      expect(run.calibrationFailures).toEqual([]);
      expect(run.input.calibration[MODELS[host]]).toEqual({ skill: true, none: true, shell: true, config: null, usersim: host === "claude" ? true : null, egress: true });
      expect([run.input.records, run.stopped, existsSync(join(root, "out", "runs"))]).toEqual([[], false, false]);
      expect(run.spent).toBeGreaterThan(0);
    }
  }, 300_000);

  // Value: protects=the rerun stage runs only for the models with a red task, so a multi-model run where one model goes red reruns that model alone and U6 still decides; fails_when=round 2 reruns every model, which spends on cells no rerun is owed for and makes decide throw; why_new=Capy's review of #67; seam=runOnHost's round(2, red models), rerunPlan; no_claim=none beyond protects
  test("only the model with a red task reruns", async () => {
    const { run } = await runHost("claude", { models: [MODELS.claude, RED_MODEL] });
    expect(run.calibrationFailures).toEqual([]);
    const second = run.input.records.filter((r) => r.round === 2);
    expect([second.length, [...new Set(second.map((r) => r.model))]]).toEqual([3, [RED_MODEL]]);
    expect(decide(run.input, DEFAULT_OPTIONS).models.map((m) => [m.model, m.rerun?.red ?? []])).toEqual([[MODELS.claude, []], [RED_MODEL, ["hello"]]]);
  }, 300_000);

  // Value: protects=a round whose worst case passes the cap is not started, so a cap stop keeps only complete paired cells and the run stops with CAP_STOP; fails_when=a partial round runs or the stop is lost; why_new=U10 conformance (cap stop) in the real-host loop; seam=runOnHost's round guard; no_claim=none beyond protects
  test("a round past the cap is not started: CAP_STOP with no partial cells", async () => {
    const { run } = await runHost("codex", { cap: 1 });
    expect(run.calibrationFailures).toEqual([]);
    expect(run.input.records).toEqual([]);
    expect(run.input.stops).toEqual([{ code: "CAP_STOP", model: null, subject: null }]);
    expect(run.stopped).toBe(true);
  }, 300_000);
});

describe("real-host readiness", () => {
  // Value: protects=a call a real host cannot run as asked is refused before the rig opens: a loadout arm (no installer, so it would run as an empty arm and pass calibration on NO-SKILL) and a task with a user persona (no free-form source until GST-272, so the simulator would answer with its fallback); fails_when=either reaches the rig; why_new=Capy's review of #67; seam=hostReadiness; no_claim=the base, stack and placebo refusals, which tests/cli/preflight.test.ts covers
  test("a loadout arm and a persona task are refused with E_USAGE", () => {
    const call = (arms: ArmSpec[]) => ({ host: "claude" as const, arms: { arms, base: null, skill: null, notes: [] }, isolation: "docker" as const, item: "x", spendCap: 1 }) as unknown as Parameters<typeof hostReadiness>[0];
    const loose: ArmSpec = { name: "after", kind: "overlay", base: null, skill: SKILL, dir: "/tmp/after" };
    const loadout: ArmSpec = { name: "kit", kind: "loadout", manifest: { name: "kit", base: "gstack@" + "a".repeat(40), modules: [] } } as unknown as ArmSpec;
    expect(hostReadiness(call([loose, loadout]), [])?.message).toBe("loadout arm kit: a real host has no loadout install yet; use loose skill folders, none and bare");
    const tasks = [{ id: "ask", judge: false }, { id: "plain", judge: false }];
    expect(hostReadiness(call([loose]), tasks, { ask: { interactive: true, user: { persona: "A founder in a hurry." } } })?.message).toBe("task ask declares a user persona, whose free-form answers land with GST-272; a real host runs scripted replies only");
    expect(hostReadiness(call([loose]), tasks, { ask: { interactive: true, user: { replies: { approach: "Approach B" } } } })).toBeNull();
  });
});

describe.skipIf(!HAS_CODEX_CLI)("--resume through the CLI's run layer, on Codex against a fake upstream", () => {
  // Value: protects=the CLI's --resume layer (run.json, the journal and the verdict), after an operation that died before writing the run's end: E_NOT_RESUMABLE for a directory with no run.json and for a run that ended on a terminal reason; a resumed run reuses every journaled cell, sends no task session upstream and names the run it resumed; a changed arm stops with E_CACHE_STALE before any trial, and --repair reruns only that arm's cell under a new verdict id while the run the line item funds keeps its id; a terminal reason in the verdict's own format (code, then detail) is E_NOT_RESUMABLE; --repair without --resume is E_USAGE; fails_when=resume reruns a finished cell, runs over a changed arm, loses the verdict's resumed_from, or accepts a terminal run; why_new=the Captain's brief for GST-271 (the --resume CLI path was tested only at runOnHost); seam=resolveCall's resume, runOnRealHost with the keyless rig in the Docker rig's place; no_claim=preflight on a real host and the Docker rig (the Docker tier), and proxy recovery after a crash (recoverRun's own tests)
  test("--resume reuses the journal, refuses stale and terminal runs, and --repair reruns the changed arm", async () => {
    const h = harness(() => [], { responses: codexModel });
    open.push(h);
    const root = mkdtempSync(join(tmpdir(), "gse-resume-cli-"));
    const after = armDir(root, "after");
    const tasks = join(root, "tasks", "tasks.json");
    mkdirSync(join(root, "tasks"), { recursive: true });
    writeFileSync(tasks, JSON.stringify([{ id: "hello", prompt: "Say hello.", must: ["hello"] }]));
    const out = join(root, "out");
    const env = { OPENAI_API_KEY: "fake-openai-value" };
    const argv = (extra: string[]) => ["--arms", "before=" + armDir(root, "before") + ",after=" + after + ",none", "--tasks", tasks, "--host", "codex", "--model", MODELS.codex, "--trials", "1", "--spend-cap", "5", "--item", "resume-test", "--isolation", "docker", "--no-noise-floor", "--out", out, ...extra];
    const call = (extra: string[]) => {
      const parsed = parseFlags(argv(extra), SKILL_EVAL_FLAGS, env);
      if (typeof parsed === "string") throw new Error(parsed);
      const c = resolveCall(parsed, env);
      if ("code" in c) throw new Error(c.code + " " + c.message);
      return c;
    };
    const report = preflight(call([]), { env, dryRun: true, host: () => null });
    const go = async (extra: string[]) => {
      const io = collect();
      const code = await runOnRealHost(call(extra), report, io, env, false, (c, o) => rig(h, "codex", c.arms.arms, { nonce: o.nonce }));
      return { code, ...io.text() };
    };
    const asked = () => h.upstream.filter((u) => JSON.stringify(u.body).includes("Say hello.")).length;
    const runFile = join(out, "run.json");
    const died = () => {
      const { ended: _, ...live } = JSON.parse(readFileSync(runFile, "utf8"));
      writeFileSync(runFile, JSON.stringify(live));
    };
    const verdict = () => JSON.parse(readFileSync(join(out, "verdict.json"), "utf8"));

    const empty = await go(["--resume", join(root, "nothing")]);
    expect([empty.code, empty.err]).toEqual([2, expect.stringContaining("E_NOT_RESUMABLE")]);
    expect(empty.err).toContain("holds no run.json");

    const first = await go([]);
    const v1 = verdict();
    expect([asked(), readFileSync(join(out, "cells.ndjson"), "utf8").trim().split("\n").length, v1.resumed_from]).toEqual([3, 3, null]);

    died();
    const again = await go(["--resume", out]);
    const v2 = verdict();
    expect([again.code, asked(), v2.resumed_from, v2.verdict_id]).toEqual([first.code, 3, v1.verdict_id, v1.verdict_id]);

    writeFileSync(join(after, "SKILL.md"), readFileSync(join(after, "SKILL.md"), "utf8") + "One more line.\n");
    died();
    const stale = await go(["--resume", out]);
    expect([stale.code, stale.err, asked()]).toEqual([2, expect.stringContaining("E_CACHE_STALE"), 3]);
    died();
    const repaired = await go(["--resume", out, "--repair", "after gained a line"]);
    const v3 = verdict();
    expect([repaired.code, asked(), v3.resumed_from, v3.verdict_id === v1.verdict_id, JSON.parse(readFileSync(runFile, "utf8")).run_id]).toEqual([first.code, 4, v1.verdict_id, false, v1.verdict_id]);

    writeFileSync(runFile, JSON.stringify({ ...JSON.parse(readFileSync(runFile, "utf8")), ended: { exit_code: 2, reasons: ["NOT_MEASURABLE 0 informative tasks"], committed: 0 } }));
    const terminal = await go(["--resume", out]);
    expect([terminal.code, terminal.err]).toEqual([2, expect.stringContaining("E_NOT_RESUMABLE the run ended on NOT_MEASURABLE")]);
    const loneFlags = parseFlags(argv(["--repair", "x"]), SKILL_EVAL_FLAGS, env);
    const lone = typeof loneFlags === "string" ? loneFlags : resolveCall(loneFlags, env);
    expect(lone).toMatchObject({ code: "E_USAGE", message: expect.stringContaining("give that run's out directory with --resume <out>") });
  }, 300_000);
});

const DOCKER = process.env.GSTACK_EVALS_DOCKER === "1";

describe.skipIf(!DOCKER)("the Docker rig (Docker tier, GSTACK_EVALS_DOCKER=1)", () => {
  // Value: protects=the Docker rig's wiring for a real run: the arm image holds the skill where the host reads it and the calibration copy holds its sentinel, the lease opens and settles, the proxy container binds slots over its management socket, the evaluator's egress probe fails from the trial network, and the judge's one request leaves its container through the trial image's bun and reaches the proxy, which refuses a bearer that is not the slot's; fails_when=an arm lands at the wrong path, the calibration copy reaches the trial image, a slot cannot bind, or egress is open; why_new=U10 wires U9's Docker pieces into the real-host run; seam=dockerRig; no_claim=a model call, which needs a key
  test("arm images, lease, proxy slots and a closed egress path", async () => {
    const root = mkdtempSync(join(tmpdir(), "gse-dockerrig-"));
    const after = armDir(root, "after");
    mkdirSync(join(root, "tasks"), { recursive: true });
    writeFileSync(join(root, "tasks", "tasks.json"), "[]\n");
    const record = mkdtempSync(join(tmpdir(), "gse-record-"));
    recordApproval(record, { action: "init", item: "rig-test", cap_micros: 5_000_000, quotes: [{ words: "keyless Docker-tier test, no model call", by: "tests/adapters", source: "tests/adapters/run-host.test.ts" }], admission: "warn" });
    const call = { host: "claude", tasks: join(root, "tasks", "tasks.json"), arms: { arms: [{ name: "after", kind: "overlay", base: null, skill: SKILL, dir: after }, { name: "none", kind: "overlay", base: null, skill: SKILL, dir: null }], base: null, skill: null, notes: [] }, out: { path: join(root, "out"), rule: "test" }, ledger: { path: join(root, "ledger.sqlite"), rule: "test" }, record: { path: record, rule: "test" }, item: "rig-test", runId: "rig-run", spendCap: 1_000_000 } as unknown as Call;
    const built = buildTrialImage({ state: stateRoot() });
    expect(built.ok).toBe(true);
    const r = dockerRig(call, { env: process.env, skill: SKILL, nonce: NONCE, cap: 1_000_000 });
    try {
      expect(r.egress().open).toBe(false);
      const marks = sentinels(call.arms.arms, NONCE);
      const read = (arm: string, calibration: boolean) => {
        const work = join(root, "work-" + arm + String(calibration));
        mkdirSync(work, { recursive: true });
        const sandbox = r.sandbox(arm, calibration);
        const home = sandbox.homePath("");
        const s = sandbox.agent("t", { work, env: { PATH: "/usr/local/bin:/usr/bin:/bin", HOME: home }, network: r.network });
        try {
          return s.exec("cat " + home + "/.claude/skills/demo/SKILL.md 2>&1; claude --version", 60_000).stdout;
        } finally {
          s.stop();
        }
      };
      expect(read("after", true)).toContain(marks.after!);
      expect(read("after", false)).toContain("# Demo after");
      expect(read("after", false)).not.toContain("gstack-evals-sentinel");
      expect(read("none", false)).toContain("No such file");
      expect(read("none", false)).toContain("(Claude Code)");
      const binding = await r.bind({ cell: { run_id: "rig-run", arm: "after", task: "t", model: MODELS.claude, trial: 0, attempt: 1 }, models: ["anthropic:" + MODELS.claude], allowance_micros: 100_000 });
      expect(binding.token.length).toBeGreaterThan(20);
      const judgeWork = join(root, "work-judge");
      mkdirSync(judgeWork, { recursive: true });
      const judge = judgeDriver({ provider: "anthropic", model: MODELS.claude, proxy: { baseUrl: r.baseUrl, slot: binding.slot, token: "gse_not_this_slots_bearer" } });
      const judgeBox = r.judgeSandbox();
      const js = judgeBox.agent("judge", { work: judgeWork, env: { PATH: "/usr/local/bin:/usr/bin:/bin", HOME: judgeBox.homePath(judgeWork), ...judge.env }, network: r.network });
      try {
        expect((await judge.run(js, { id: "judge", prompt: "Grade this." }, 60_000)).termination).toEqual({ kind: "missing", code: "E_SLOT_DENIED" });
      } finally {
        js.stop();
      }
      expect((await r.finalize(binding.meter_id)).micros).toBe(0);
    } finally {
      const closed = await r.close();
      expect(closed).toMatchObject({ committed: 0, unknown: 0 });
    }
  }, 600_000);
});
