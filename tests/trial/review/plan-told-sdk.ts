// The run loop half of plan-told.test.ts, run as its own process: bun test runs every file in one process, and
// quick/lanea-quick/test/session.test.ts mocks @anthropic-ai/claude-agent-sdk for the rest of it, so a session started in
// the test file itself could reach that mock instead of the pinned SDK. Here the real Claude Code driver loads the real
// pinned SDK, which spawns the stub CLI; the stub records each user message the SDK hands it. Usage: bun plan-told-sdk.ts
// <records dir> <out dir> <scratch dir>. It prints the run's stops as JSON; the test reads the records and arm.json.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_POLICY, loadPolicy, type LoadedPolicy } from "../../../src/skill-eval/cli/policy.ts";
import type { HostRig } from "../../../src/skill-eval/cli/run-host.ts";
import { removeTree } from "../../../src/trial/cleanup.ts";
import type { Sandbox } from "../../../src/trial/sandbox.ts";
import { PLAN_SEVERITY_MAP } from "../../../src/trial/review/plan.ts";
import { runReviewUnits, type ReviewArm, type ReviewRunInput } from "../../../src/trial/review/run.ts";
import { buildUnitRepo, buildUnitTree, unitTaskId } from "../../../src/trial/review/unit.ts";
import { harness, localSandbox } from "../../adapters/harness.ts";
import { PANEL_REPO, planPanel } from "../../noloss/plan-panel.ts";

export const FORCED = "/plan-ceo-review plan.md Run every section of the review procedure in order and show each section's output before your findings.";
export const ARMS: ReviewArm[] = [{ name: "none", told: "none" }, { name: "lens", told: "lens" }, { name: "placebo", told: "placebo" }, { name: "gstack", told: "gstack" }, { name: "gstack-forced", told: "gstack", toldPrefix: FORCED }];

if (import.meta.main) {
  const [records, out, root] = process.argv.slice(2) as [string, string, string];
  const scratch = (name: string) => mkdtempSync(join(root, name));
  const panel = planPanel(scratch("panel-"), { seeded: 1 });
  const u = panel.suite.units[0]!;
  const unit = { id: u.id, repo: PANEL_REPO, pr: u.pr, head: u.head, base: u.base };
  const repo = buildUnitRepo({ unit, source: panel.clone, dest: join(scratch("unit-"), "repo"), baseBranch: "main" });
  const tree = buildUnitTree({ repo, task: unitTaskId(unit), dest: join(scratch("tree-"), "tree"), image: "unused", test: null, install: null, scratch: scratch("build-"), run: () => { throw new Error("a plan unit runs no container"); } });
  const home = scratch("gstack-");
  const cleanRoot = scratch("clean-root-");
  const gdir = join(home, ".claude", "skills", "gstack");
  mkdirSync(join(gdir, "bin"), { recursive: true });
  mkdirSync(join(gdir, "scripts"), { recursive: true });
  writeFileSync(join(gdir, "scripts", "question-registry.ts"), "  'plan-ceo-review-mode': { id: 'plan-ceo-review-mode' },\n");
  const stub = join(import.meta.dir, "..", "..", "adapters", "fixtures", "stub-cli.cjs");
  const reply = JSON.stringify([{ type: "text", text: "```plan-findings\n[]\n```" }]);
  const sandbox = (arm: string): Sandbox => {
    const base = localSandbox(() => {});
    return {
      ...base,
      agent: (task, o) => ((a) => ({
        ...a,
        exec: (command: string, timeoutMs: number) => a.exec("export CLEAN_ROOM_ROOT=" + cleanRoot + "; " + command, timeoutMs),
        spawn: (argv: string[], env: Record<string, string> = {}) => (argv[0] === "true" ? spawn("true", [], { stdio: ["pipe", "pipe", "pipe"] }) : spawn(process.execPath, [stub, ...argv.slice(1)], { cwd: o.work, env: { ...env, PATH: process.env.PATH ?? "", STUB_MODE: "content", STUB_CONTENT: reply, STUB_RECORD: join(records, arm + ".ndjson") }, stdio: ["pipe", "pipe", "pipe"] })),
      }))(base.agent(task, o)),
    };
  };
  const h = harness(() => [{ type: "text", text: "unused" }]);
  const gstack = { tree_sha256: "gstack-tree", skill: null, gstack: ".claude/skills/gstack/bin/gstack-skill-start", plugins: [], layers: [{ src: home, dest: "" }] };
  const bare = (name: string) => ({ tree_sha256: name + "-tree", skill: null, gstack: null, plugins: [] });
  const rig: HostRig = {
    baseUrl: h.baseUrl, network: null, imageDigest: null,
    bind: async (request) => h.proxy.bind(request),
    finalize: (m) => h.proxy.finalize(m),
    arms: { none: bare("none"), lens: bare("lens"), placebo: bare("placebo"), gstack, "gstack-forced": gstack },
    sandbox: (arm) => sandbox(arm),
    judgeSandbox: () => localSandbox(() => {}),
    egress: () => ({ open: false, detail: "test rig" }),
    close: async () => ({ committed: 0, unknown: 0, lease_id: null }),
    recovery: null,
  };
  const input: ReviewRunInput = { host: "claude", suite: { id: "plan-told-test", sha256: null }, units: [{ unit, task: unitTaskId(unit), base_branch: "main", merge_base: repo.merge_base, tree: tree.dir, tree_sha256: tree.tree_sha256, instructions: repo.instructions, check: null }], arms: ARMS, models: ["claude-opus-5-5"], passes: 1, parallel: 1, timeoutS: 60, cap: 50_000_000, runId: "plan-told", out, date: "2026-11-01", policy: loadPolicy(DEFAULT_POLICY) as LoadedPolicy, keyBase: { image_digest: null, recipe: "test", host_version: null, adapter_sha256: "test", isolation: "process" }, journal: null, plan: { lens: "ceo" }, severityMap: Object.fromEntries(ARMS.map((a) => [a.name, PLAN_SEVERITY_MAP])), env: {} };
  try {
    const run = await runReviewUnits(input, rig);
    console.log(JSON.stringify(run.stops));
  } finally {
    h.proxy.stop();
    removeTree(h.dir);
  }
}
