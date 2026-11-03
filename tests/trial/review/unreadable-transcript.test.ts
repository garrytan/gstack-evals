// A plan session whose transcript cannot be read, end to end (PR #166 review, T3): runReviewUnits drives a none arm whose
// stand-in driver returns a completed session with a findings block but writes no host/transcript.ndjson. With no
// transcript the read audit cannot run, so the cell is a missing cell (E_INFRA_FAILURE), journaled, a coverage gap that
// stops its arm with E_COVERAGE_GAP and leaves it no verdict; a control arm beside it that writes its transcript
// completes. Same rig as untested-arm.test.ts. Keyless.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPO_ROOT } from "../../../src/cli.ts";
import { DEFAULT_POLICY, loadPolicy, type LoadedPolicy } from "../../../src/skill-eval/cli/policy.ts";
import type { HostRig } from "../../../src/skill-eval/cli/run-host.ts";
import { removeTree } from "../../../src/trial/cleanup.ts";
import type { AgentOutcome } from "../../../src/trial/trial.ts";
import { PLAN_SEVERITY_MAP } from "../../../src/trial/review/plan.ts";
import { planScore, readReviewJournal, runReviewUnits, type PreparedUnit, type ReviewRun } from "../../../src/trial/review/run.ts";
import { buildUnitRepo, buildUnitTree, unitTaskId } from "../../../src/trial/review/unit.ts";
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
const FINDINGS = "```plan-findings\n" + JSON.stringify([{ severity: "Critical", section: "Problem", line: 3, claim: "The plan solves the wrong problem.", evidence: "context/goals.md", fix: "Plan offline reading." }], null, 2) + "\n```";
const said = { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: FINDINGS }] }, parent_tool_use_id: null, session_id: "s" };

describe("a plan session with no readable transcript through runReviewUnits (keyless)", () => {
  const out = mkdtempSync(join(REPO_ROOT, ".unreadable-transcript-test-"));
  roots.push(out);
  const log: string[] = [];
  let run: ReviewRun;
  let unitId = "";
  const armJson = (id: string) => JSON.parse(readFileSync(join(out, "arms", id, "arm.json"), "utf8"));

  beforeAll(async () => {
    const panel = planPanel(scratch("unreadable-transcript-"), { seeded: 1 }, { visibility: "public" });
    const u = panel.suite.units[0]!;
    const unit = { id: u.id, repo: PANEL_REPO, pr: u.pr, head: u.head, base: u.base };
    unitId = unit.id;
    const repo = buildUnitRepo({ unit, source: panel.clone, dest: join(scratch("unreadable-transcript-unit-"), "repo"), baseBranch: "main" });
    const tree = buildUnitTree({ repo, task: unitTaskId(unit), dest: join(scratch("unreadable-transcript-tree-"), "tree"), image: "unused", test: null, install: null, scratch: scratch("unreadable-transcript-scratch-"), run: () => { throw new Error("a plan unit runs no container"); } });
    const prepared: PreparedUnit = { unit, task: unitTaskId(unit), base_branch: "main", merge_base: repo.merge_base, tree: tree.dir, tree_sha256: tree.tree_sha256, instructions: repo.instructions, check: null };
    const h = harness(() => [{ type: "text", text: "ok" } as never]);
    roots.push(h.dir);
    const slots = new Map<string, string>();
    const bare = (name: string) => ({ tree_sha256: name + "-tree", skill: null, gstack: null, plugins: [] });
    const rig: HostRig = {
      baseUrl: h.baseUrl, network: null, imageDigest: null,
      bind: async (request) => {
        const b = h.proxy.bind(request);
        slots.set(b.slot, request.cell.arm);
        return b;
      },
      finalize: (m) => h.proxy.finalize(m),
      arms: { none: bare("none"), control: bare("control") } as unknown as HostRig["arms"],
      sandbox: () => localSandbox(() => {}),
      judgeSandbox: () => localSandbox(() => {}),
      egress: () => ({ open: false, detail: "test rig" }),
      close: async () => ({ committed: 0, unknown: 0, lease_id: null }),
      recovery: null,
      driver: (o) => ({
        env: {},
        run: async (): Promise<AgentOutcome> => {
          mkdirSync(o.out, { recursive: true });
          if (slots.get(o.proxy.slot) === "control") writeFileSync(join(o.out, "transcript.ndjson"), JSON.stringify(said) + "\n");
          return { turns: [FINDINGS], termination: { kind: "completed" }, model_output: true, text_output: true, opened: null, files_read: [], asked: [], usage: null, cost_micros: null, agent_turns: 1, loaded_bytes: null };
        },
      }),
    };
    try {
      run = await runReviewUnits({ host: "claude", suite: { id: panel.suite.id, sha256: null }, units: [prepared], arms: [{ name: "none", told: "none" }, { name: "control", told: "none" }], models: [OPUS], passes: 1, parallel: 2, timeoutS: 30, cap: null, runId: "unreadable-transcript", out, date: "2026-11-02", policy, keyBase: { image_digest: null, recipe: "test", host_version: null, adapter_sha256: "test", isolation: "process" }, journal: null, plan: { lens: "ceo" }, severityMap: { none: PLAN_SEVERITY_MAP, control: PLAN_SEVERITY_MAP }, env: {} }, rig, (line) => log.push(line));
    } finally {
      h.proxy.stop();
    }
  }, 60_000);

  // Value: protects=a plan session whose transcript cannot be read never reaches a verdict: it is journaled as a missing cell (E_INFRA_FAILURE) that planScore calls a gap, its arm is stopped with one coverage gap and an E_COVERAGE_GAP stop, the log says why, and the control arm that wrote its transcript completes; fails_when=the session scores its findings with an empty read audit, the cell is left out of the journal, or the control arm is stopped too; why_new=PR #166 review (T3); seam=runReviewUnits with a stand-in driver that writes no transcript; no_claim=why a real transcript would be unreadable
  test("the session is a journaled E_INFRA_FAILURE gap that stops its arm; the control arm completes", () => {
    const entry = readReviewJournal(out).get(JSON.stringify([OPUS, "none", unitId, 1]))!;
    expect([entry.record.termination, planScore(entry), entry.audit]).toEqual([{ kind: "missing", code: "E_INFRA_FAILURE" }, "gap", []]);
    const none = armJson("none-opus");
    expect([none.status, none.coverage_gaps?.length, none.parse_outcomes.findings, none.parse_outcomes.incomplete]).toEqual(["stopped", 1, 0, 1]);
    const control = armJson("control-opus");
    expect([control.status, control.coverage_gaps, control.parse_outcomes.findings]).toEqual(["complete", undefined, 1]);
    expect(run.stops.map((s) => [s.code, s.message.startsWith("arm none-opus stopped with 1 coverage gap")])).toEqual([["E_COVERAGE_GAP", true]]);
    expect(log).toContain(OPUS + " none " + unitId + " pass 1: host/transcript.ndjson is unreadable, so the read audit cannot run and the session, which ended completed, is a missing cell (E_INFRA_FAILURE), a coverage gap that stops its arm");
  });
});
