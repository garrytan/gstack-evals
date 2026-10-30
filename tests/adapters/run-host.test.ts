import { afterEach, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NO_SKILL, withSentinel } from "../../src/adapters/calibration.ts";
import { SKILL_DIRS } from "../../src/adapters/host.ts";
import { DEFAULT_POLICY, loadPolicy, type LoadedPolicy } from "../../src/skill-eval/cli/policy.ts";
import { dockerRig, runOnHost, sentinels, type HostRig } from "../../src/skill-eval/cli/run-host.ts";
import type { Call } from "../../src/skill-eval/cli/call.ts";
import { recordApproval } from "../../src/runner/ledger/ledger.ts";
import { buildTrialImage, stateRoot } from "../../src/trial/image.ts";
import { decide, DEFAULT_OPTIONS } from "../../src/skill-eval/verdict/gates.ts";
import type { ArmSpec, Host } from "../../src/types.ts";
import { HAS_CLAUDE_CLI, HAS_CODEX_CLI, harness, localSandbox, type Harness, type ResponsesScript, type Script } from "./harness.ts";

let open: Harness[] = [];
afterEach(() => {
  for (const h of open) h.close();
  open = [];
});

const policy = loadPolicy(DEFAULT_POLICY) as LoadedPolicy;
const SKILL = "demo";
const NONCE = "n0nce42";
const MODELS: Record<Host, string> = { claude: "claude-haiku-5-5", codex: "gpt-6.1-sol" };

function armDir(root: string, name: string): string {
  const dir = join(root, "arms", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), "---\nname: demo\ndescription: Demo skill, arm " + name + ".\n---\n# Demo " + name + "\n");
  return dir;
}

/** The test rig: the harness's in-process proxy, local sandboxes that install each arm (or its calibration copy) in the trial HOME. */
function rig(h: Harness, host: Host, arms: ArmSpec[], o: { egressOpen?: boolean; leakInto?: string } = {}): HostRig {
  const marks = sentinels(arms, NONCE);
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
    egress: () => ({ open: o.egressOpen ?? false, detail: "the test rig's probe" }),
    close: async () => ({ committed: 0, unknown: 0, lease_id: null }),
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
    return [{ type: "message", text: all.match(/n0nce42-\d+/)?.[0] ?? "no output" }];
  }
  return [{ type: "message", text: "HELLO from the task." }];
};

async function runHost(host: Host, o: { interactive?: boolean; egressOpen?: boolean; leakInto?: string; cap?: number | null; calibrateOnly?: boolean } = {}) {
  const h = host === "claude" ? harness(claudeModel) : harness(() => [], { responses: codexModel });
  open.push(h);
  const root = mkdtempSync(join(tmpdir(), "gse-runhost-"));
  const arms: ArmSpec[] = [
    { name: "before", kind: "overlay", base: null, skill: SKILL, dir: armDir(root, "before") },
    { name: "after", kind: "overlay", base: null, skill: SKILL, dir: armDir(root, "after") },
    { name: "none", kind: "overlay", base: null, skill: SKILL, dir: null },
  ];
  const tasksDir = join(root, "tasks");
  mkdirSync(tasksDir, { recursive: true });
  const interactive = o.interactive ?? false;
  const run = await runOnHost({
    host, models: [MODELS[host]], trials: 1, parallel: 2, timeoutS: 120, cap: o.cap === undefined ? null : o.cap, runId: "run-test", out: join(root, "out"), tasksDir, policy, arms, skill: SKILL, nonce: NONCE,
    tasks: [{ id: "hello", prompt: "Say hello." }],
    verdict: [{ id: "hello", safety: false, interactive, judge: false, must: ["hello"], must_not: [], check: false }],
    entries: interactive ? { hello: { interactive: true, user: { replies: { mode: "Building a startup" } } } } : {},
    ...(o.calibrateOnly ? { calibrateOnly: true } : {}),
  }, rig(h, host, arms, o));
  return { run, root, h };
}

describe.skipIf(!HAS_CLAUDE_CLI || !HAS_CODEX_CLI)("the run loop on a real host's adapter, against a fake upstream behind the metering proxy", () => {
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

  // Value: protects=a round whose worst case passes the cap is not started, so a cap stop keeps only complete paired cells and the run stops with CAP_STOP; fails_when=a partial round runs or the stop is lost; why_new=U10 conformance (cap stop) in the real-host loop; seam=runOnHost's round guard; no_claim=none beyond protects
  test("a round past the cap is not started: CAP_STOP with no partial cells", async () => {
    const { run } = await runHost("codex", { cap: 1 });
    expect(run.calibrationFailures).toEqual([]);
    expect(run.input.records).toEqual([]);
    expect(run.input.stops).toEqual([{ code: "CAP_STOP", model: null, subject: null }]);
    expect(run.stopped).toBe(true);
  }, 300_000);
});

const DOCKER = process.env.GSTACK_EVALS_DOCKER === "1";

describe.skipIf(!DOCKER)("the Docker rig (Docker tier, GSTACK_EVALS_DOCKER=1)", () => {
  // Value: protects=the Docker rig's wiring for a real run: the arm image holds the skill where the host reads it and the calibration copy holds its sentinel, the lease opens and settles, the proxy container binds slots over its management socket, and the evaluator's egress probe fails from the trial network; fails_when=an arm lands at the wrong path, the calibration copy reaches the trial image, a slot cannot bind, or egress is open; why_new=U10 wires U9's Docker pieces into the real-host run; seam=dockerRig; no_claim=a model call, which needs a key
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
    const r = dockerRig(call, { env: process.env, skill: SKILL, nonce: NONCE });
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
      expect((await r.finalize(binding.meter_id)).micros).toBe(0);
    } finally {
      const closed = await r.close();
      expect(closed).toMatchObject({ committed: 0, unknown: 0 });
    }
  }, 600_000);
});
