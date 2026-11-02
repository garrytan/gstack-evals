// An untested arm end to end (panel v3 plan, section 5, N1): a none plan arm whose session read a file under the home's
// Capy drive is contaminated. runReviewUnits writes its arm.json as stopped with an untested block (E_ARM_CONTAMINATED:
// the sessions with their paths, the audit's sha256 and the arm's paid spend), the run stops with E_ARM_CONTAMINATED and
// the log prints the read audit's line; a clean arm beside it completes. Sessions run through the real run loop and
// runTrial on a stand-in driver that writes host/transcript.ndjson the way the Claude Code driver does, under the
// sandbox's own fake home. review-units maps an E_ARM_CONTAMINATED stop to exit 4 in reviewUnits, which only main
// reaches, after dockerRig's proxy container and trial network; those need real Docker, so the exit is read here from
// the reason-code table that docs/errors.md and the exit contract come from. Keyless.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { untestedProblem } from "../../../lanes/review-noloss/contract.ts";
import { REPO_ROOT } from "../../../src/cli.ts";
import { CODES } from "../../../src/errors/codes.ts";
import { DEFAULT_POLICY, loadPolicy, type LoadedPolicy } from "../../../src/skill-eval/cli/policy.ts";
import type { HostRig } from "../../../src/skill-eval/cli/run-host.ts";
import { removeTree } from "../../../src/trial/cleanup.ts";
import type { AgentOutcome } from "../../../src/trial/trial.ts";
import { AUDIT_SHA256 } from "../../../src/trial/review/audit.ts";
import { CLEAN_ROOM_COMMAND } from "../../../src/trial/review/clean-room.ts";
import { PLAN_SEVERITY_MAP } from "../../../src/trial/review/plan.ts";
import { readReviewJournal, runReviewUnits, type PreparedUnit, type ReviewRun } from "../../../src/trial/review/run.ts";
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
const DRIVE_SHOWN = "~/" + [".capy", "drive", "x"].join("/");
type Msg = Record<string, unknown>;
const transcript = (...messages: Msg[]) => messages.map((m) => JSON.stringify(m)).join("\n") + "\n";
const read = (id: string, path: string): Msg[] => [
  { type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id, name: "Read", input: { file_path: path } }] }, parent_tool_use_id: null, session_id: "s" },
  { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: "text", is_error: false }] }, parent_tool_use_id: null, session_id: "s" },
];

describe("an untested plan arm through runReviewUnits (GEVA-203, keyless)", () => {
  const out = mkdtempSync(join(REPO_ROOT, ".untested-arm-test-"));
  roots.push(out);
  const log: string[] = [];
  const preflights: Record<string, unknown> = {};
  let run: ReviewRun;
  let unitId = "";
  const armJson = (id: string) => JSON.parse(readFileSync(join(out, "arms", id, "arm.json"), "utf8"));

  beforeAll(async () => {
    const panel = planPanel(scratch("untested-arm-"), { seeded: 1 }, { visibility: "public" });
    const u = panel.suite.units[0]!;
    const unit = { id: u.id, repo: PANEL_REPO, pr: u.pr, head: u.head, base: u.base };
    unitId = unit.id;
    const repo = buildUnitRepo({ unit, source: panel.clone, dest: join(scratch("untested-arm-unit-"), "repo"), baseBranch: "main" });
    const tree = buildUnitTree({ repo, task: unitTaskId(unit), dest: join(scratch("untested-arm-tree-"), "tree"), image: "unused", test: null, install: null, scratch: scratch("untested-arm-scratch-"), run: () => { throw new Error("a plan unit runs no container"); } });
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
          const name = slots.get(o.proxy.slot)!;
          preflights[name] = (o as { preflight?: unknown }).preflight ?? null;
          const home = join(dirname(o.out), "home");
          mkdirSync(o.out, { recursive: true });
          const path = name === "none" ? join(home, ".capy", "drive", "x") : "/work/" + prepared.task + "/plan.md";
          writeFileSync(join(o.out, "transcript.ndjson"), transcript(...read("toolu_read", path), { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: FINDINGS }] }, parent_tool_use_id: null, session_id: "s" }));
          return { turns: [FINDINGS], termination: { kind: "completed" }, model_output: true, text_output: true, opened: null, files_read: [], asked: [], usage: null, cost_micros: null, agent_turns: 1, loaded_bytes: null };
        },
      }),
    };
    try {
      run = await runReviewUnits({ host: "claude", suite: { id: panel.suite.id, sha256: null }, units: [prepared], arms: [{ name: "none", told: "none" }, { name: "control", told: "none" }], models: [OPUS], passes: 1, parallel: 2, timeoutS: 30, cap: null, runId: "untested-arm", out, date: "2026-11-02", policy, keyBase: { image_digest: null, recipe: "test", host_version: null, adapter_sha256: "test", isolation: "process" }, journal: null, plan: { lens: "ceo" }, severityMap: { none: PLAN_SEVERITY_MAP, control: PLAN_SEVERITY_MAP }, env: {} }, rig, (line) => log.push(line));
    } finally {
      h.proxy.stop();
    }
  }, 60_000);

  // Value: protects=a none plan arm whose session read a drive file is untested: arm.json is stopped with an untested block (code E_ARM_CONTAMINATED, the session and its path with HOME as ~, AUDIT_SHA256 and the arm's paid spend) even though its session scored findings, and the clean arm beside it completes; fails_when=the contaminated arm completes or reads as a coverage gap, the block misses a field, or the clean arm is stopped too; why_new=panel v3 section 5 (N1: a contaminated arm reads untested, never no effect); seam=runReviewUnits with a stand-in driver writing host/transcript.ndjson; no_claim=a real Claude Code session, which two-turn.test.ts drives on the pinned SDK
  test("arm.json is stopped with an untested block; the clean arm completes", () => {
    const paid = (readReviewJournal(out).get(JSON.stringify([OPUS, "none", unitId, 1]))!.record.cost_micros ?? 0) / 1_000_000;
    const none = armJson("none-opus");
    expect([none.status, none.coverage_gaps, none.parse_outcomes.findings]).toEqual(["stopped", undefined, 1]);
    expect(none.untested).toEqual({ code: "E_ARM_CONTAMINATED", reason: "the read audit found a contaminated read in 1 session", sessions: [{ session: unitId + " pass 1", paths: [DRIVE_SHOWN] }], audit_sha256: AUDIT_SHA256, paid_usd: paid });
    const control = armJson("control-opus");
    expect([control.status, control.untested, control.coverage_gaps]).toEqual(["complete", undefined, undefined]);
    expect(readReviewJournal(out).get(JSON.stringify([OPUS, "none", unitId, 1]))!.audit).toEqual([{ tool: "Read", class: "capy", target: DRIVE_SHOWN, error: false, contaminated: true }]);
    expect(preflights).toEqual({ none: { command: CLEAN_ROOM_COMMAND, code: "E_CLEAN_ROOM" }, control: { command: CLEAN_ROOM_COMMAND, code: "E_CLEAN_ROOM" } });
    expect(untestedProblem(new Map([["arm.json", readFileSync(join(out, "arms", "none-opus", "arm.json"))]]))).toBe("E_ARM_CONTAMINATED arm none-opus is untested (the read audit found a contaminated read in 1 session), so it gets no judge packet, join or score; rerun the arm clean");
  });

  // Value: protects=run.stops holds exactly one E_ARM_CONTAMINATED stop naming the arm, the session, the path and the paid spend, and the log prints the read audit's line for the session and that stop; fails_when=the stop is missing, carries another code, names the clean arm, or the audit line is not logged; why_new=panel v3 section 5 (the run prints the observed reads with home replaced, and the arm's paid spend); seam=runReviewUnits' stops and log; no_claim=the CLI's own printing of the stops, which goes through the same log
  test("run.stops holds E_ARM_CONTAMINATED and the log prints the read audit line", () => {
    const stop = { code: "E_ARM_CONTAMINATED" as const, message: "arm none-opus is untested: the read audit found " + unitId + " pass 1 read " + DRIVE_SHOWN + "; the arm's paid spend is $" + (armJson("none-opus").untested.paid_usd as number).toFixed(6) };
    expect(run.stops).toEqual([stop]);
    expect(log).toContain(OPUS + " none " + unitId + " pass 1: read audit: Read capy " + DRIVE_SHOWN + " (contamination)");
    expect(log).toContain(stop.code + " " + stop.message);
    expect(log.filter((l) => l.includes(" control ") && l.includes("read audit"))).toEqual([]);
  });

  // Value: protects=an E_ARM_CONTAMINATED stop carries exit 4 (an arm is untested, INCOMPLETE) in the reason-code table that review-units' exit contract and docs/errors.md follow; fails_when=the code is renamed, dropped or moved to another exit; why_new=panel v3 section 5 (exit 4 for an untested arm); seam=CODES, because reviewUnits' return (E_ARM_CONTAMINATED to 4, any other stop to 2) is reached only through main after dockerRig's proxy container and trial network, which need real Docker; no_claim=the CLI's return line itself, which no keyless test reaches without a module mock of dockerRig
  test("E_ARM_CONTAMINATED is exit 4 in the reason-code table", () => {
    expect(CODES.E_ARM_CONTAMINATED.exit).toBe(4);
  });
});
