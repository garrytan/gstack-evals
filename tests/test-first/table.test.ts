// Copyright (c) 2026 Garry Tan. MIT License.
// B2's session table (lanes/test-first/table.ts) on real host output: a Claude Code row from B1's scripted none-prove session
// (Claude Code 2.1.312's own SDK log) and a Codex row from the scorer's Codex 0.170.0 fixture (a root thread and a sub-agent
// on gpt-6.2-sol at low effort), graded both ways, and every infrastructure rule each host has: no result, no model
// response, no reward, a cap stop, a session on another model, Claude Code version or Codex effort, and no rollout.
import { afterAll, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { b2Row, meteredEfforts, regression } from "../../lanes/test-first/table.ts";

const root = mkdtempSync(join(tmpdir(), "b2-table-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const CLAUDE_SDK = join(import.meta.dir, "../delivery-route/fixtures/sessions/none-prove/sdk-messages.jsonl");
const CODEX = join(import.meta.dir, "../scoring/fixtures/codex/sub");
const PATCH = "diff --git a/calc.py b/calc.py\n--- a/calc.py\n+++ b/calc.py\n@@ -1,2 +1,2 @@\n def add(a, b):\n-    return a - b\n+    return a + b\ndiff --git a/tests/test_calc.py b/tests/test_calc.py\nnew file mode 100644\n--- /dev/null\n+++ b/tests/test_calc.py\n@@ -0,0 +1 @@\n+import calc\n";
const TASK = "koxudaxi__datamodel-code-generator-3071";
let n = 0;
type Trial = { arm: string; agent?: string; upstream?: string; reward?: number | null; exc?: string; result?: boolean; responses?: number; patch?: string; sdk?: string | null; rollouts?: ((t: string) => string) | null };
function trial(t: Trial): string {
  const dir = join(root, "t" + ++n), ev = join(dir, "evaluator");
  mkdirSync(join(dir, "artifacts/logs/artifacts"), { recursive: true }); mkdirSync(ev, { recursive: true });
  writeFileSync(join(dir, "config.json"), JSON.stringify({ agent: { name: t.agent ?? (t.arm.startsWith("cx-") ? "laneb-b2-codex" : "laneb-claude-code"), kwargs: { arm: t.arm, upstream_model: t.upstream ?? (t.arm.startsWith("cx-") ? "gpt-6.2-sol" : "claude-opus-5-5") } }, task: { path: "tasks/" + TASK } }));
  if (t.result !== false) writeFileSync(join(dir, "result.json"), JSON.stringify({ trial_name: TASK + "__" + n, verifier_result: t.reward === null ? null : { rewards: { reward: t.reward ?? 1 } }, ...(t.exc ? { exception_info: { exception_type: t.exc } } : {}) }));
  writeFileSync(join(ev, "laneb-summary.json"), JSON.stringify({ session: { ok_responses: t.responses ?? 1, usage: { input_tokens: 10, output_tokens: 5 } }, wall_s: 42 }));
  writeFileSync(join(dir, "artifacts/logs/artifacts/model.patch"), t.patch ?? PATCH);
  if (t.arm.startsWith("cx-")) {
    if (t.rollouts !== null) {
      const src = join(CODEX, "codex-sessions/2026/11/21"), dst = join(ev, "codex-sessions/2026/11/21");
      mkdirSync(dst, { recursive: true });
      for (const f of readdirSync(src)) writeFileSync(join(dst, f), (t.rollouts ?? ((x: string) => x))(readFileSync(join(src, f), "utf8")));
    }
  } else if (t.sdk !== null) writeFileSync(join(ev, "sdk-messages.jsonl"), t.sdk ?? readFileSync(CLAUDE_SDK, "utf8"));
  return dir;
}
const row = (t: Trial) => b2Row(trial(t), { part: "b2-1", sessions: new Map(), home: "/root" })!;

describe("Claude Code rows", () => {
  test("a graded session: the model and CLI from its own record, the detector's readings, the regression rule and the repository", () => {
    const r = row({ arm: "none" });
    expect([r.host, r.label, r.arm, r.outcome, r.model, r.cli_version, r.sdk_version]).toEqual(["claude", "none", "none", "graded", "claude-opus-5-5", "2.1.312", null]);
    expect([r.pass, r.regression_test, r.test_files, r.root_only]).toEqual([true, true, ["tests/test_calc.py"], false]);
    expect(r.followed).toBe(true);
    expect(typeof r.followed_b2).toBe("boolean");
    expect(r.repo).toBe("koxudaxi/datamodel-code-generator");
    expect([r.line_seen, r.audit, r.routing_named]).toEqual([false, 0, null]);
  });
  test("a failed graded session passes nothing and ships no regression test", () => {
    const r = row({ arm: "line", reward: 0 });
    expect([r.outcome, r.pass, r.regression_test, r.touches_test]).toEqual(["graded", false, false, true]);
  });
  test("infrastructure: no result, no reward, another model in the record, and a cap stop", () => {
    expect(row({ arm: "none", result: false }).reason).toBe("no result.json");
    expect(row({ arm: "none", reward: null }).outcome).toBe("infra");
    const other = row({ arm: "none", upstream: "particle-1" });
    expect([other.outcome, other.reason]).toEqual(["infra", "the session record names model claude-opus-5-5, not particle-1"]);
    expect(row({ arm: "none", sdk: readFileSync(CLAUDE_SDK, "utf8").replaceAll("2.1.312", "2.1.313") }).reason).toBe("Claude Code 2.1.313, not 2.1.312");
    expect(row({ arm: "none", exc: "LedgerCapStop" }).outcome).toBe("cap_stop");
  });
});

describe("Codex rows", () => {
  test("a graded session: the root rollout's model, CLI and effort, the reader's records, and nothing unreadable", () => {
    const r = row({ arm: "cx-prove-it", patch: readFileSync(join(CODEX, "final.patch"), "utf8") });
    expect([r.host, r.label, r.arm, r.outcome, r.model, r.cli_version]).toEqual(["codex", "cx-prove-it", "prove-it", "graded", "gpt-6.2-sol", "0.170.0"]);
    expect(r.effort).toEqual(["low"]);
    expect(r.unreadable_items).toBe(0);
    expect(typeof r.followed).toBe("boolean");
    expect(r.detect).not.toBeNull();
  });
  test("infrastructure: another model, another effort, another Codex, no rollout, and no model response", () => {
    expect(row({ arm: "cx-none", rollouts: (x) => x.replaceAll('"model":"gpt-6.2-sol"', '"model":"gpt-6.1-sol"') }).reason).toContain("not gpt-6.2-sol");
    expect(row({ arm: "cx-none", rollouts: (x) => x.replaceAll('"effort":"low"', '"effort":"medium"') }).reason).toBe("a thread ran at effort medium, not low");
    expect(row({ arm: "cx-none", rollouts: (x) => x.replaceAll('"cli_version":"0.170.0"', '"cli_version":"0.171.0"') }).reason).toBe("the root rollout's Codex is 0.171.0, not 0.170.0");
    expect(row({ arm: "cx-none", rollouts: null }).reason).toBe("no rollout copied out for the root thread");
    expect(row({ arm: "cx-none", responses: 0 }).reason).toStartWith("no model response");
  });
  test("the proxy's metered requests give each trial's efforts; refused and other events don't count", () => {
    const log = join(root, "proxy-requests.jsonl"), t = TASK + "__x";
    writeFileSync(log, [{ event: "session_open", session: "s1", trial: t + "__env" }, { event: "request", session: "s1", trial: t + "__env", wire: "responses", reasoning_effort: "low" }, { event: "late_usage", session: "s1", trial: t + "__env", wire: "responses", reasoning_effort: null }, { event: "refused", session: "s1", trial: t + "__env", wire: "responses", reasoning_effort: "high" }, { event: "request", session: "s2", trial: "other", route_mark: false }].map((e) => JSON.stringify(e)).join("\n") + "\n");
    const m = meteredEfforts([log]);
    expect([...m.get(t)!]).toEqual(["low", "none"]);
    expect(m.has("other")).toBe(false);
    const dir = trial({ arm: "cx-none" }), name = JSON.parse(readFileSync(join(dir, "result.json"), "utf8")).trial_name;
    expect(b2Row(dir, { part: null, sessions: new Map(), home: "/root", metered: new Map([[name, new Set(["low"])]]) })!.metered_effort).toEqual(["low"]);
    expect(row({ arm: "cx-none" }).metered_effort).toBeNull();
    expect(row({ arm: "none" }).metered_effort).toBeNull();
  });
  test("a Codex arm under the Claude Code agent is refused, and another agent's trial is left out", () => {
    expect(() => row({ arm: "cx-none", agent: "laneb-claude-code" })).toThrow("E_B2_TABLE");
    expect(b2Row(trial({ arm: "none", agent: "laneb-codex" }), { part: null, sessions: new Map(), home: "/root" })).toBeNull();
  });
});

describe("the regression-test rule (section 6.2)", () => {
  test("only a test file the diff adds or changes counts, and a root-level one is flagged", () => {
    expect(regression(PATCH, true)).toEqual({ test_files: ["tests/test_calc.py"], touches_test: true, regression_test: true, root_only: false });
    const root = "diff --git a/test_calc.py b/test_calc.py\nnew file mode 100644\n--- /dev/null\n+++ b/test_calc.py\n@@ -0,0 +1 @@\n+x\n";
    expect(regression(root, true).root_only).toBe(true);
    expect(regression(PATCH.split("diff --git a/tests")[0]!, true).regression_test).toBe(false);
  });
});
