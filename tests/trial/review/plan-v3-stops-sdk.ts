// The run loop half of plan-v3-stops.test.ts, run as its own process: bun test runs every file in one process, and
// quick/lanea-quick/test/session.test.ts mocks @anthropic-ai/claude-agent-sdk for the rest of it, so a session started in
// the test file itself could reach that mock instead of the pinned SDK. Here runReviewUnits drives the real Claude Code
// driver on the real pinned SDK, which spawns the stub CLI through the sandbox's agent spawn. Each arm is told none and
// named for the stop it plays (panel v3 plan, section 5's stop table): its stub script ends turn 1 or turn 2 at the turn
// cap, the allowance or the wall clock, or never starts because the clean-room backstop finds a drive.
//
// - Every arm runs the clean-room preflight with CLEAN_ROOM_ROOT set, so the script never sees this machine's own drive.
//   The backstop arm's root holds a Capy drive directory under home/<owner>, built here at runtime.
// - The rig's driver records the options run.ts hands it, then gives hostDriver the same options with turn 2's clock
//   (followUp.timeoutMs, PLAN_TURN2.timeoutS in run.ts) cut to TURN2_TIMEOUT_MS, so the turn-2 timeout case stays fast.
// - cap1-block runs the stub's turns mode, the one mode that writes text before a turn-1 error_max_turns (script mode's
//   {turns} writes none); every other arm runs script mode.
// - The allowance arm replays the metering proxy's own refusal for a slot whose allowance cannot hold one call, as
//   tests/adapters/two-turn.test.ts does.
// - After the first run the out dir is copied to <root>/run1, the drive is removed and runReviewUnits runs again with
//   reuse: readReviewJournal(out) and repair, as review-units --resume --repair would.
//
// Usage: bun plan-v3-stops-sdk.ts <scratch root> <out dir>. It prints one JSON line: the unit, the drive path, the
// proxy's refusal text, each run's stops, the CLI spawns per arm per run and the driver options each session got.
import { spawn } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { hostDriver, type HostDriverOptions } from "../../../src/adapters/host.ts";
import { DEFAULT_POLICY, loadPolicy, type LoadedPolicy } from "../../../src/skill-eval/cli/policy.ts";
import type { HostRig } from "../../../src/skill-eval/cli/run-host.ts";
import { removeTree } from "../../../src/trial/cleanup.ts";
import type { Sandbox } from "../../../src/trial/sandbox.ts";
import { PLAN_SEVERITY_MAP, PLAN_TURN2 } from "../../../src/trial/review/plan.ts";
import { readReviewJournal, runReviewUnits, type ReviewArm, type ReviewRunInput } from "../../../src/trial/review/run.ts";
import { buildUnitRepo, buildUnitTree, unitTaskId } from "../../../src/trial/review/unit.ts";
import { harness, localSandbox } from "../../adapters/harness.ts";
import { PANEL_REPO, planPanel } from "../../noloss/plan-panel.ts";

export const MODEL = "claude-opus-5-5";
/** The run's maxTurns: each user message's turn cap at the CLI. */
export const RUN_MAX_TURNS = 6;
/** The run's timeoutS: turn 1's clock. */
export const TIMEOUT_S = 8;
/** Turn 2's clock as the rig hands it to the driver, in place of PLAN_TURN2.timeoutS. */
export const TURN2_TIMEOUT_MS = 4_000;
export const DRIVE_OWNER = "reviewer";
export const ARMS = ["cap1-block", "cap1-noblock", "cap2", "timeout2", "timeout0", "allowance2", "backstop"] as const;

const finding = (line: number, claim: string) => ({ severity: "High", section: "Rollout", line, claim, evidence: "The rollout section names no step for it.", fix: "Add the step to the rollout section." });
export const ONE = [finding(4, "The plan drops the old index before the new one is built.")];
export const TWO = [...ONE, finding(9, "The plan sends the notice after the cutover, not before it.")];
export const block = (findings: readonly object[]): string => "Findings.\n\n\x60\x60\x60plan-findings\n" + JSON.stringify(findings) + "\n\x60\x60\x60";
const text = (t: string) => [{ type: "text", text: t }];
const script = (entries: object[]) => ({ STUB_MODE: "script", STUB_SCRIPT: JSON.stringify(entries) });

if (import.meta.main) {
  const [root, out] = process.argv.slice(2) as [string, string];
  const scratch = (name: string) => mkdtempSync(join(root, name));
  const panel = planPanel(scratch("panel-"), { seeded: 1 });
  const u = panel.suite.units[0]!;
  const unit = { id: u.id, repo: PANEL_REPO, pr: u.pr, head: u.head, base: u.base };
  const repo = buildUnitRepo({ unit, source: panel.clone, dest: join(scratch("unit-"), "repo"), baseBranch: "main" });
  const tree = buildUnitTree({ repo, task: unitTaskId(unit), dest: join(scratch("tree-"), "tree"), image: "unused", test: null, install: null, scratch: scratch("build-"), run: () => { throw new Error("a plan unit runs no container"); } });
  const clean = scratch("clean-root-");
  const dirty = scratch("dirty-root-");
  const drive = join(dirty, "home", DRIVE_OWNER, ".capy", "drive");
  mkdirSync(drive, { recursive: true });
  const h = harness(() => [{ type: "text", text: "unused" }]);
  const slot = h.proxy.bind({ cell: { run_id: "plan-v3-stops-refusal", arm: "allowance2", task: "t", model: MODEL, trial: 0, attempt: 1 }, models: ["anthropic:" + MODEL], allowance_micros: 100 });
  const res = await fetch(h.baseUrl + "/" + slot.slot + "/anthropic/v1/messages", { method: "POST", headers: { "content-type": "application/json", "anthropic-version": "2023-06-01", authorization: "Bearer " + slot.token }, body: JSON.stringify({ model: MODEL, max_tokens: 1024, tools: [{ name: "Bash", input_schema: { type: "object" } }], messages: [{ role: "user", content: "hi" }] }) });
  const refusal = { apierror: "API Error: " + res.status + " " + (await res.text()), status: res.status };
  const stubs: Record<string, Record<string, string>> = {
    "cap1-block": { STUB_MODE: "turns", STUB_TURN_TEXTS: JSON.stringify({ 2: block(ONE) }) },
    "cap1-noblock": script([{ turns: RUN_MAX_TURNS }]),
    cap2: script([{ content: text(block(ONE)) }, { turns: PLAN_TURN2.maxTurns + 1 }]),
    timeout2: script([{ content: text(block(ONE)) }, { content: text(block(TWO)), hang: true }]),
    timeout0: script([{ hang: true }]),
    allowance2: script([{ content: text(block(ONE)) }, refusal]),
    backstop: script([{ content: text(block(ONE)) }, { content: text(block(TWO)) }]),
  };
  let phase = 0;
  const spawned: Record<string, number>[] = [{}, {}];
  const drivers: { phase: number; out: string; followUp: unknown; preflight: unknown; maxTurns: unknown; capStops: unknown }[] = [];
  const sandbox = (arm: string): Sandbox => {
    const base = localSandbox(() => {});
    const records = join(root, "records-" + (phase + 1));
    mkdirSync(records, { recursive: true });
    return {
      ...base,
      agent: (task, o) => ((a) => ({
        ...a,
        exec: (command: string, timeoutMs: number) => a.exec("export CLEAN_ROOM_ROOT=" + (arm === "backstop" ? dirty : clean) + "; " + command, timeoutMs),
        spawn: (argv: string[], env: Record<string, string> = {}) => {
          if (argv[0] === "true") return spawn("true", [], { stdio: ["pipe", "pipe", "pipe"] });
          spawned[phase]![arm] = (spawned[phase]![arm] ?? 0) + 1;
          return spawn(process.execPath, [join(import.meta.dir, "..", "..", "adapters", "fixtures", "stub-cli.cjs"), ...argv.slice(1)], { cwd: o.work, env: { ...env, PATH: process.env.PATH ?? "", ...stubs[arm], STUB_RECORD: join(records, arm + ".ndjson") }, stdio: ["pipe", "pipe", "pipe"] });
        },
      }))(base.agent(task, o)),
    };
  };
  const rig: HostRig = {
    baseUrl: h.baseUrl, network: null, imageDigest: null,
    bind: async (request) => h.proxy.bind(request),
    finalize: (m) => h.proxy.finalize(m),
    arms: Object.fromEntries(ARMS.map((name) => [name, { tree_sha256: name + "-tree", skill: null, gstack: null, plugins: [] }])),
    sandbox: (arm) => sandbox(arm),
    judgeSandbox: () => localSandbox(() => {}),
    egress: () => ({ open: false, detail: "test rig" }),
    close: async () => ({ committed: 0, unknown: 0, lease_id: null }),
    recovery: null,
    driver: (o: HostDriverOptions) => {
      drivers.push({ phase: phase + 1, out: o.out, followUp: o.followUp ?? null, preflight: o.preflight ?? null, maxTurns: o.maxTurns ?? null, capStops: o.capStops ?? null });
      return hostDriver({ ...o, ...(o.followUp ? { followUp: { ...o.followUp, timeoutMs: TURN2_TIMEOUT_MS } } : {}) });
    },
  };
  const arms: ReviewArm[] = ARMS.map((name) => ({ name, told: "none" }));
  const input: ReviewRunInput = { host: "claude", suite: { id: "plan-v3-stops-test", sha256: null }, units: [{ unit, task: unitTaskId(unit), base_branch: "main", merge_base: repo.merge_base, tree: tree.dir, tree_sha256: tree.tree_sha256, instructions: repo.instructions, check: null }], arms, models: [MODEL], passes: 1, parallel: 1, timeoutS: TIMEOUT_S, cap: null, runId: "plan-v3-stops", out, date: "2026-11-02", policy: loadPolicy(DEFAULT_POLICY) as LoadedPolicy, keyBase: { image_digest: null, recipe: "test", host_version: null, adapter_sha256: "test", isolation: "process" }, journal: null, plan: { lens: "ceo" }, maxTurns: RUN_MAX_TURNS, severityMap: Object.fromEntries(ARMS.map((a) => [a, PLAN_SEVERITY_MAP])), env: {} };
  try {
    const first = await runReviewUnits(input, rig);
    cpSync(out, join(root, "run1"), { recursive: true });
    rmSync(join(dirty, "home"), { recursive: true, force: true });
    phase = 1;
    const second = await runReviewUnits({ ...input, reuse: readReviewJournal(out), repair: true }, rig);
    console.log(JSON.stringify({ unit: u.id, task: unitTaskId(unit), drive, refusal: refusal.apierror, stops: [first.stops, second.stops], spawned, drivers }));
  } finally {
    h.proxy.stop();
    removeTree(h.dir);
  }
}
