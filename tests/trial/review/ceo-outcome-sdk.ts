// The run loop half of ceo-outcome-run.test.ts, run as its own process for the reason plan-told-sdk.ts gives (another
// test file mocks @anthropic-ai/claude-agent-sdk for the rest of bun's one process). The real Claude Code driver loads the
// real pinned Agent SDK, which spawns the stub CLI; the stub records each user message the SDK hands it. Each arm and
// model answers its own way through the stub's env, so one run covers the follow-up turn's cases and a cap stop.
// A third call resumes the first run with another allowance, which every cached session's key must refuse.
// Usage: bun ceo-outcome-sdk.ts <records dir> <out dir> <cap out dir> <scratch dir>. Prints the runs' stops as JSON.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_POLICY, loadPolicy, type LoadedPolicy } from "../../../src/skill-eval/cli/policy.ts";
import type { HostRig } from "../../../src/skill-eval/cli/run-host.ts";
import { removeTree } from "../../../src/trial/cleanup.ts";
import type { Sandbox } from "../../../src/trial/sandbox.ts";
import { readReviewJournal, runReviewUnits, type ReviewArm, type ReviewRunInput } from "../../../src/trial/review/run.ts";
import { buildUnitRepo, buildUnitTree, unitTaskId } from "../../../src/trial/review/unit.ts";
import { harness, localSandbox } from "../../adapters/harness.ts";
import { PANEL_REPO, planPanel } from "../../noloss/plan-panel.ts";

export const OPUS = "claude-opus-5-5";
export const SONNET = "claude-sonnet-5-5";
export const ARMS: ReviewArm[] = [{ name: "none", told: "none" }, { name: "lens", told: "lens" }, { name: "gstack-auto", told: "gstack-auto" }, { name: "gstack-forced", told: "gstack" }];
export const ISSUE = "Maintainers asked for a smaller first step, and the plan ships the whole sync engine at once with no opt-out for existing users.";
export const FIX = "Ship the read-only mode first behind a flag and keep current behavior as the default.";
export const BODY = JSON.stringify({ top: [{ issue: ISSUE, evidence: "plan.md, Rollout", fix: FIX }], forecast: 35 });
const BLOCK = "```ceo-outcome\n" + BODY + "\n```";
const text = (t: string) => JSON.stringify([{ type: "text", text: t }]);
/** How each arm on each model answers. */
export const CASES: Record<string, Record<string, string>> = {
  ["none " + OPUS]: { STUB_MODE: "content", STUB_CONTENT: text("Review done."), STUB_CONTENT_LATER: text("Here it is.\n\n" + BLOCK) },
  ["lens " + OPUS]: { STUB_MODE: "content", STUB_CONTENT: text("Findings.\n\n" + BLOCK) },
  ["gstack-auto " + OPUS]: { STUB_MODE: "content", STUB_CONTENT: text("GSTACK_RESULT: skill=autoplan status=reviewed run=/tmp/state/autoplan-1"), STUB_CONTENT_LATER: text("Nothing more to add.") },
  ["gstack-forced " + OPUS]: { STUB_MODE: "turns", STUB_TURN_TEXTS: JSON.stringify({ 1: BLOCK }) },
  ["none " + SONNET]: { STUB_MODE: "apierror", STUB_API_ERROR: "API Error: 529 UPSTREAM overloaded", STUB_API_STATUS: "529" },
  ["lens " + SONNET]: { STUB_MODE: "content", STUB_CONTENT: text(BLOCK + "\n\nRevised:\n\n```ceo-outcome\n{\"top\": [\n```"), STUB_CONTENT_LATER: text("Done.") },
};

if (import.meta.main) {
  const [records, out, capOut, root] = process.argv.slice(2) as [string, string, string, string];
  const scratch = (name: string) => mkdtempSync(join(root, name));
  const panel = planPanel(scratch("panel-"), { seeded: 1 });
  const u = panel.suite.units[0]!;
  const unit = { id: u.id, repo: PANEL_REPO, pr: u.pr, head: u.head, base: u.base };
  const repo = buildUnitRepo({ unit, source: panel.clone, dest: join(scratch("unit-"), "repo"), baseBranch: "main" });
  const tree = buildUnitTree({ repo, task: unitTaskId(unit), dest: join(scratch("tree-"), "tree"), image: "unused", test: null, install: null, scratch: scratch("build-"), run: () => { throw new Error("a plan unit runs no container"); } });
  const home = scratch("gstack-");
  const gdir = join(home, ".claude", "skills", "gstack");
  mkdirSync(join(gdir, "bin"), { recursive: true });
  mkdirSync(join(gdir, "scripts"), { recursive: true });
  writeFileSync(join(gdir, "VERSION"), "1.94.39.0\n");
  writeFileSync(join(gdir, "scripts", "question-registry.ts"), "  'plan-ceo-review-mode': { id: 'plan-ceo-review-mode' },\n");
  const stub = join(import.meta.dir, "..", "..", "adapters", "fixtures", "stub-cli.cjs");
  const sandbox = (arm: string, model: string): Sandbox => {
    const base = localSandbox(() => {});
    return {
      ...base,
      agent: (task, o) => ({
        ...base.agent(task, o),
        spawn: (argv: string[], env: Record<string, string> = {}) => (argv[0] === "true" ? spawn("true", [], { stdio: ["pipe", "pipe", "pipe"] }) : spawn(process.execPath, [stub, ...argv.slice(1)], { cwd: o.work, env: { ...env, PATH: process.env.PATH ?? "", ...CASES[arm + " " + model], STUB_RECORD: join(records, arm + "-" + model + ".ndjson") }, stdio: ["pipe", "pipe", "pipe"] })),
      }),
    };
  };
  const h = harness(() => [{ type: "text", text: "unused" }]);
  const gstack = { tree_sha256: "gstack-tree", skill: null, gstack: ".claude/skills/gstack/bin/gstack-skill-start", plugins: [], layers: [{ src: home, dest: "" }] };
  const bare = (name: string) => ({ tree_sha256: name + "-tree", skill: null, gstack: null, plugins: [] });
  const rig: HostRig = {
    baseUrl: h.baseUrl, network: null, imageDigest: null,
    bind: async (request) => h.proxy.bind(request),
    finalize: (m) => h.proxy.finalize(m),
    arms: { none: bare("none"), lens: bare("lens"), "gstack-auto": gstack, "gstack-forced": gstack },
    sandbox: (arm, _judge, model) => sandbox(arm, model!),
    judgeSandbox: () => localSandbox(() => {}),
    egress: () => ({ open: false, detail: "test rig" }),
    close: async () => ({ committed: 0, unknown: 0, lease_id: null }),
    recovery: null,
  };
  const input: ReviewRunInput = { host: "claude", suite: { id: "ceo-outcome-test", sha256: null }, units: [{ unit, task: unitTaskId(unit), base_branch: "main", merge_base: repo.merge_base, tree: tree.dir, tree_sha256: tree.tree_sha256, instructions: repo.instructions, check: null }], arms: ARMS, models: [OPUS, SONNET], armModels: { "gstack-auto": [OPUS], "gstack-forced": [OPUS] }, passes: 1, parallel: 4, timeoutS: 60, cap: 50_000_000, maxTurns: 3, runId: "ceo-outcome", out, date: "2026-11-05", policy: loadPolicy(DEFAULT_POLICY) as LoadedPolicy, keyBase: { image_digest: null, recipe: "test", host_version: null, adapter_sha256: "test", isolation: "process" }, journal: null, plan: { lens: "ceo-outcome" }, env: {} };
  try {
    const run = await runReviewUnits(input, rig);
    const capped = await runReviewUnits({ ...input, out: capOut, runId: "ceo-outcome-cap", cap: 1 }, rig);
    const stale = await runReviewUnits({ ...input, reuse: readReviewJournal(out), allowanceMicros: 1_234_567 }, rig);
    console.log(JSON.stringify({ stops: run.stops, cap: capped.stops, stale: stale.stale.map((s) => s.message) }));
  } finally {
    h.proxy.stop();
    removeTree(h.dir);
  }
}
