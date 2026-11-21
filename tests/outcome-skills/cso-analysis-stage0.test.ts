// Copyright (c) 2026 Garry Tan. MIT License.
// Plan section 12's stage 0 readout, tested every way an arm can fail: install not verified, no session, the skill not
// loaded, the procedure not run, no report in assistant text, an infra gap, a judge gap, an unresolved handle, a missing
// tree, and a passing arm on every count.
import { describe, expect, test } from "bun:test";
import { loadCsoPrereg } from "../../lanes/outcome-skills/cso/prereg.ts";
import type { CsoArm, CsoModel, SessionRecord } from "../../lanes/outcome-skills/cso/types.ts";
import type { CsoArmRecord } from "../../lanes/outcome-skills/cso/arms.ts";
import type { CsoScore } from "../../lanes/outcome-skills/cso/score/outcomes.ts";
import { treeIndex } from "../../lanes/outcome-skills/cso/score/checks.ts";
import { stage0Readout, type Stage0Input } from "../../lanes/outcome-skills/cso/analysis/stage0.ts";

const p = loadCsoPrereg();
const H = "@cso-path//" + "a".repeat(32), H2 = "@cso-path//" + "b".repeat(32);
const units = ["u1", "u2"];
const cells: [CsoModel, CsoArm][] = [["opus", "none"], ["opus", "cso"], ["opus", "untold"], ["particle", "none"], ["particle", "cso"]];
const sess = (unit: string, model: CsoModel, arm: CsoArm): SessionRecord => ({ schema: "cso-session.v1", unit, arm, model, stage: "stage0", end: "completed", reason: null, texts: ["Report: src/a.js:3 and " + H + "\nDONE"], helper: { snapshot_root: "/snap", handles: { [H]: "/snap/src/a.js" } }, exposure: { loaded: arm !== "none", procedure_ran: arm === "cso", run_id: arm === "cso" ? "r" : null, completeness: "complete", findings_submitted: 1, tooling_errors: 0, host_reads_after_start: 0 } } as SessionRecord);
const scr = (unit: string, model: CsoModel, arm: CsoArm): CsoScore => ({ schema: "cso-score.v1", unit, arm, model, stage: "stage0", gap: null, gap_reason: null } as CsoScore);
const armRec = (arm: CsoArm) => ({ schema: "cso-arm.v1", arm, home: arm === "none" ? "none" : "gstack" } as CsoArmRecord);
const base = (): Stage0Input => ({
  units, sessions: units.flatMap((u) => cells.map(([m, a]) => sess(u, m, a))), scores: units.flatMap((u) => cells.map(([m, a]) => scr(u, m, a))),
  arms: { none: armRec("none"), cso: armRec("cso"), untold: armRec("untold") }, trees: { u1: treeIndex({ "src/a.js": "a\nb\nc\n" }), u2: treeIndex({ "src/a.js": "a\nb\nc\n" }) },
});
const cell = (i: Stage0Input, m: CsoModel, a: CsoArm) => stage0Readout(i, p).find((c) => c.model === m && c.arm === a)!;
const edit = (f: (i: Stage0Input) => void) => {
  const i = base();
  f(i);
  return i;
};
const s = (i: Stage0Input, m: CsoModel, a: CsoArm, u = "u1") => i.sessions.find((x) => x.model === m && x.arm === a && x.unit === u)!;

describe("section 12: the stage 0 readout", () => {
  test("the five planned cells, each passing on every count", () => {
    const r = stage0Readout(base(), p);
    expect(r.map((c) => c.model + " " + c.arm)).toEqual(cells.map(([m, a]) => m + " " + a));
    expect(r.every((c) => c.pass && c.reasons.length === 0)).toBe(true);
  });
  test("install not verified", () => {
    expect(cell(edit((i) => delete i.arms.cso), "opus", "cso").reasons[0]!.reason).toStartWith("install not verified");
    expect(cell(edit((i) => (i.arms.untold = armRec("none"))), "opus", "untold").pass).toBe(false);
  });
  test("no session", () => {
    expect(cell(edit((i) => (i.sessions = i.sessions.filter((x) => !(x.arm === "none" && x.model === "particle" && x.unit === "u2")))), "particle", "none").reasons).toEqual([{ unit: "u2", reason: "no session" }]);
  });
  test("entry not resolved: the skill did not load, or the procedure did not run", () => {
    expect(cell(edit((i) => (s(i, "opus", "cso").exposure.loaded = false)), "opus", "cso").reasons.map((r) => r.reason)).toEqual(["entry not resolved: the cso skill did not load"]);
    expect(cell(edit((i) => (s(i, "particle", "cso").exposure.procedure_ran = false)), "particle", "cso").reasons.map((r) => r.reason)).toEqual(["entry not resolved: the helper procedure did not run"]);
  });
  test("no report in assistant text", () => {
    expect(cell(edit((i) => (s(i, "opus", "none").texts = ["", " "])), "opus", "none").reasons.map((r) => r.reason)).toEqual(["no report in assistant text"]);
  });
  test("an infra gap, and a session that ended but was not scored", () => {
    const g = edit((i) => Object.assign(s(i, "opus", "untold"), { end: "gap", reason: "infra twice" }));
    expect(cell(g, "opus", "untold").reasons.map((r) => r.reason)).toEqual(["infra gap: infra twice"]);
    const j = edit((i) => Object.assign(i.scores.find((x) => x.arm === "none" && x.model === "opus" && x.unit === "u1")!, { gap: "judge", gap_reason: "malformed twice" }));
    expect(cell(j, "opus", "none").reasons.map((r) => r.reason)).toEqual(["not scored: judge gap (malformed twice)"]);
    expect(cell(edit((i) => (i.scores = i.scores.filter((x) => !(x.arm === "none" && x.model === "opus")))), "opus", "none").reasons.length).toBe(2);
  });
  test("the citation gate: an unresolved handle, a handle outside the tree, and no tree", () => {
    const h = edit((i) => s(i, "opus", "cso").texts.push("see " + H2));
    expect(cell(h, "opus", "cso").reasons.map((r) => r.reason)).toEqual(["citation gate: " + H2 + " (no record)"]);
    const o = edit((i) => (s(i, "opus", "cso").helper.handles[H] = "/snap/gone.js"));
    expect(cell(o, "opus", "cso").reasons.map((r) => r.reason)).toEqual(["citation gate: " + H + " (outside the tree)"]);
    expect(cell(edit((i) => delete i.trees.u2), "opus", "cso").reasons).toEqual([{ unit: "u2", reason: "citation gate not run: no audited tree" }]);
    expect(cell(h, "opus", "none").pass).toBe(true);
  });
});
