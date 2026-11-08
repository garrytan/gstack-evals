// Copyright (c) 2026 Garry Tan. MIT License.
// The run loop half of tests/pv/run.test.ts, run as its own process for the reason plan-told-sdk.ts gives (another test
// file mocks @anthropic-ai/claude-agent-sdk for the rest of bun's one process). The real Claude Code driver loads the real
// pinned Agent SDK, which spawns the stub CLI. Each arm answers through the stub's env, one answer per attempt in order, so
// one run covers a block, a no-block, web contamination, a retry that recovers and a retry that fails (missing).
// Usage: bun pv-sdk.ts <records dir> <out dir> <scratch dir>. Prints the run's stops as JSON.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_POLICY, loadPolicy, type LoadedPolicy } from "../../src/skill-eval/cli/policy.ts";
import type { HostRig } from "../../src/skill-eval/cli/run-host.ts";
import { removeTree } from "../../src/trial/cleanup.ts";
import type { Sandbox } from "../../src/trial/sandbox.ts";
import { buildPvTree, pvTaskId } from "../../src/trial/review/product-value.ts";
import { runReviewUnits, type ReviewArm, type ReviewRunInput } from "../../src/trial/review/run.ts";
import { harness, localSandbox } from "../adapters/harness.ts";

export const OPUS = "claude-opus-5-5";
export const UNIT = "unit-a";
export const ARMS: ReviewArm[] = [{ name: "none", told: "none" }, { name: "lens", told: "lens" }, { name: "plan-ceo-review", told: "gstack" }];
const tick = "\u0060\u0060\u0060";
export const CHANGES = ["1. **Ship** the importer before the sync engine", "Add a rollback plan for the nightly job"];
export const BLOCK = tick + "plan-changes\n" + JSON.stringify({ changes: CHANGES }) + "\n" + tick;
export const LENIENT = tick + "json\n[\"Cut the admin console\", \"Keep CSV export\",]\n" + tick;
const content = (blocks: unknown[]) => ({ STUB_MODE: "content", STUB_CONTENT: JSON.stringify(blocks) });
const text = (t: string) => content([{ type: "text", text: t }]);
const apiError = { STUB_MODE: "apierror", STUB_API_ERROR: "API Error: 529 UPSTREAM overloaded", STUB_API_STATUS: "529" };
const web = content([{ type: "text", text: "Looked it up.\n\n" + BLOCK }, { type: "web_search_tool_result", tool_use_id: "srvtoolu_1", content: [{ type: "web_search_result", url: "https://example.com", title: "x", encrypted_content: "x" }] }]);
/** Each arm's answers, one per attempt across its passes, in run order. */
export const ANSWERS: Record<string, Record<string, string>[]> = {
  none: [text("Review.\n\n" + BLOCK), web],
  lens: [text("A thoughtful review with no block."), apiError, apiError],
  "plan-ceo-review": [apiError, text("Review.\n\n" + BLOCK), text("Review.\n\n" + LENIENT)],
};

if (import.meta.main) {
  const [records, out, root] = process.argv.slice(2) as [string, string, string];
  const scratch = (name: string) => mkdtempSync(join(root, name));
  const units = scratch("units-");
  mkdirSync(join(units, UNIT, "context"), { recursive: true });
  writeFileSync(join(units, UNIT, "unit.json"), JSON.stringify({ id: UNIT }));
  writeFileSync(join(units, UNIT, "key.json"), JSON.stringify({ items: ["never mounted"] }));
  writeFileSync(join(units, UNIT, "plan.md"), "# Plan\n\nShip the sync engine to every user at once.\n");
  writeFileSync(join(units, UNIT, "context", "readme.md"), "# Project\n\nA notes app.\n");
  const task = pvTaskId(UNIT);
  const treeDir = join(out, "units", task, "tree");
  const tree = buildPvTree(units, UNIT, "plan", treeDir);
  if (tree.problems.length) throw new Error(tree.problems.join("; "));
  const home = scratch("gstack-");
  const gdir = join(home, ".claude", "skills", "gstack");
  mkdirSync(join(gdir, "bin"), { recursive: true });
  mkdirSync(join(gdir, "scripts"), { recursive: true });
  writeFileSync(join(gdir, "VERSION"), "1.98.0.0\n");
  writeFileSync(join(gdir, "scripts", "question-registry.ts"), "  'plan-ceo-review-mode': { id: 'plan-ceo-review-mode' },\n");
  const stub = join(import.meta.dir, "..", "adapters", "fixtures", "stub-cli.cjs");
  const spawned: Record<string, number> = {};
  const sandbox = (arm: string): Sandbox => {
    const base = localSandbox(() => {});
    return {
      ...base,
      agent: (t, o) => ({
        ...base.agent(t, o),
        spawn: (argv: string[], env: Record<string, string> = {}) => {
          if (argv[0] === "true") return spawn("true", [], { stdio: ["pipe", "pipe", "pipe"] });
          const answer = ANSWERS[arm]![spawned[arm] ?? 0]!;
          spawned[arm] = (spawned[arm] ?? 0) + 1;
          return spawn(process.execPath, [stub, ...argv.slice(1)], { cwd: o.work, env: { ...env, PATH: process.env.PATH ?? "", ...answer, STUB_RECORD: join(records, arm + ".ndjson") }, stdio: ["pipe", "pipe", "pipe"] });
        },
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
    arms: { none: bare("none"), lens: bare("lens"), "plan-ceo-review": gstack },
    sandbox: (arm) => sandbox(arm),
    judgeSandbox: () => localSandbox(() => {}),
    egress: () => ({ open: false, detail: "test rig" }),
    close: async () => ({ committed: 0, unknown: 0, lease_id: null }),
    recovery: null,
  };
  const unit = { id: UNIT, repo: "product-value/plan", pr: 0, head: tree.tree_sha256, base: "" };
  const input: ReviewRunInput = { host: "claude", suite: { id: "pv-test", sha256: null }, units: [{ unit, task, base_branch: "", merge_base: "", tree: treeDir, tree_sha256: tree.tree_sha256, instructions: {}, check: null }], arms: ARMS, models: [OPUS], passes: 2, parallel: 1, timeoutS: 60, cap: 50_000_000, maxTurns: 3, runId: "pv", out, date: "2026-11-08", policy: loadPolicy(DEFAULT_POLICY) as LoadedPolicy, keyBase: { image_digest: null, recipe: "test", host_version: null, adapter_sha256: "test", isolation: "process" }, journal: null, plan: { lens: "product-value" }, pv: { family: "plan", fallback: false }, env: {} };
  try {
    const run = await runReviewUnits(input, rig);
    console.log(JSON.stringify({ stops: run.stops, spawned }));
  } finally {
    h.proxy.stop();
    removeTree(h.dir);
  }
}
