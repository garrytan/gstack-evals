// Copyright (c) 2026 Garry Tan. MIT License.
// The eng-review run loop through the real Claude Code driver, the real pinned Agent SDK and a stub CLI
// (tests/er/stub-er-cli.cjs), run as its own process for the reason tests/pv/pv-sdk.ts gives. Each arm answers through
// the stub's env, one answer per attempt in spawn order. Usage: bun er-sdk.ts <records dir> <out dir> <scratch dir>
// <cap usd> <parallel>. Prints the run's stops, the most attempts in flight at once and the spawn counts as JSON.
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_POLICY, loadPolicy, type LoadedPolicy } from "../../src/skill-eval/cli/policy.ts";
import type { HostRig } from "../../src/skill-eval/cli/run-host.ts";
import { removeTree } from "../../src/trial/cleanup.ts";
import type { Sandbox } from "../../src/trial/sandbox.ts";
import { buildErTree, erTaskId } from "../../src/trial/review/eng-review.ts";
import { runErUnits } from "../../src/trial/review/er-run.ts";
import type { ArmId } from "../../lanes/eng-review/types.ts";
import { harness, localSandbox } from "../adapters/harness.ts";

export const OPUS = "claude-opus-5-5";
export const UNIT = "unit-a";
export const ARMS: ArmId[] = ["none", "lens", "precut", "candidate"];
const tick = "\u0060\u0060\u0060";
export const BLOCK = tick + "eng-plan\n" + JSON.stringify({ paths: ["**app/export.py** export_ledger", "app/cli.py main"], checks: ["1. Unit test that export_ledger writes an empty file when the ledger has no rows"] }) + "\n" + tick;
export const LENIENT = tick + "json\n{\"paths\": [\"app/export.py export_ledger\"], \"checks\": [\"An end-to-end test of the nightly export\"],}\n" + tick;
const text = (t: string) => ({ content: [{ type: "text", text: t }] });
const turns = (...t: unknown[]) => ({ ER_STUB_TURNS: JSON.stringify(t) });
const apiError = turns({ apierror: "API Error: 529 UPSTREAM overloaded" });
const maxTurns = turns({ maxturns: true });
const web = turns({ content: [{ type: "text", text: "Looked it up.\n\n" + BLOCK }, { type: "web_search_tool_result", tool_use_id: "srvtoolu_1", content: [{ type: "web_search_result", url: "https://example.com", title: "x", encrypted_content: "x" }] }] });
/** Each arm's answers, one per attempt across its passes, in spawn order. */
export const ANSWERS: Record<string, Record<string, string>[]> = {
  none: [turns(text("Review.\n\n" + BLOCK)), turns(text("Review.\n\n" + BLOCK))],
  lens: [turns(text("A thoughtful review with no block.")), turns(text("Review.\n\n" + LENIENT))],
  precut: [maxTurns, maxTurns, web],
  candidate: [apiError, apiError, turns(text("First pass.\n\n" + BLOCK), text("Second pass.\n\n" + BLOCK), text("Third pass.\n\n" + BLOCK))],
};

if (import.meta.main) {
  const [records, out, root, capUsd, parallel] = process.argv.slice(2) as [string, string, string, string, string];
  const scratch = (name: string) => mkdtempSync(join(root, name));
  const units = scratch("units-");
  const repo = join(units, UNIT, "repo");
  mkdirSync(repo, { recursive: true });
  writeFileSync(join(units, UNIT, "unit.json"), JSON.stringify({ id: UNIT }));
  writeFileSync(join(units, UNIT, "key.json"), JSON.stringify({ items: ["never mounted"] }));
  writeFileSync(join(units, UNIT, "plan.md"), "Add a nightly export of the ledger to CSV.\n");
  writeFileSync(join(repo, "export.py"), "def export_ledger(rows):\n    return rows\n");
  const git = (...a: string[]) => spawnSync("git", ["-c", "user.name=Test Writer", "-c", "user.email=test@example.invalid", "-C", repo, ...a]);
  git("init", "-q");
  git("add", ".");
  git("commit", "-q", "-m", "base");
  const task = erTaskId(UNIT);
  const treeDir = join(out, "units", task, "tree");
  const tree = buildErTree(units, UNIT, treeDir);
  if (tree.problems.length) throw new Error(tree.problems.join("; "));
  const stub = join(import.meta.dir, "stub-er-cli.cjs");
  const spawned: Record<string, number> = {};
  let live = 0;
  let most = 0;
  const sandbox = (arm: string): Sandbox => {
    const base = localSandbox(() => {});
    return {
      ...base,
      agent: (t, o) => ({
        ...base.agent(t, o),
        spawn: (argv: string[], env: Record<string, string> = {}) => {
          if (argv[0] === "true") return spawn("true", [], { stdio: ["pipe", "pipe", "pipe"] });
          const answer = ANSWERS[arm]![Math.min(spawned[arm] ?? 0, ANSWERS[arm]!.length - 1)]!;
          spawned[arm] = (spawned[arm] ?? 0) + 1;
          const child = spawn(process.execPath, [stub, ...argv.slice(1)], { cwd: o.work, env: { ...env, PATH: process.env.PATH ?? "", ...answer, ER_STUB_DELAY: "300", STUB_RECORD: join(records, arm + ".ndjson") }, stdio: ["pipe", "pipe", "pipe"] });
          live++;
          most = Math.max(most, live);
          child.on("exit", () => live--);
          return child;
        },
      }),
    };
  };
  const h = harness(() => [{ type: "text", text: "unused" }]);
  const bare = (name: string) => ({ tree_sha256: name + "-tree", skill: null, gstack: null, plugins: [] });
  const rig: HostRig = {
    baseUrl: h.baseUrl, network: null, imageDigest: null,
    bind: async (request) => h.proxy.bind(request),
    finalize: (m) => h.proxy.finalize(m),
    arms: { none: bare("none"), lens: bare("lens"), precut: bare("precut"), candidate: bare("candidate") },
    sandbox: (arm) => sandbox(arm),
    judgeSandbox: () => localSandbox(() => {}),
    egress: () => ({ open: false, detail: "test rig" }),
    close: async () => ({ committed: 0, unknown: 0, lease_id: null }),
    recovery: null,
  };
  try {
    const run = await runErUnits({ units: [{ id: UNIT, task, tree: treeDir, tree_sha256: tree.tree_sha256, opening: null }], arms: ARMS, models: [OPUS], passes: 2, parallel: Number(parallel), cap: Math.round(Number(capUsd) * 1e6), out, runId: "er", policy: loadPolicy(DEFAULT_POLICY) as LoadedPolicy, enforce: "candidate", keyBase: { image_digest: null, recipe: "test", adapter_sha256: "test" } }, rig, (line) => console.error(line));
    console.log(JSON.stringify({ stops: run.stops, most, spawned, stopped: run.stopped.length }));
  } finally {
    h.proxy.stop();
    removeTree(h.dir);
  }
}
