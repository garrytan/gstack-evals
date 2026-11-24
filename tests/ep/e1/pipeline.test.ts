import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { E1ReviewSession } from "../../../lanes/eng-planted/e1/launch.ts";
import { cellKey, codexConfigLeft, e1Builds, e1Cells, e1Item, E1_ITEMS, e1Reviews, scoredCells, type CellKey } from "../../../lanes/eng-planted/e1/pipeline.ts";
import { ItemGate } from "../../../lanes/eng-planted/stages/ledger.ts";
import type { PlantedUnit } from "../../../lanes/eng-planted/types.ts";

const git = (cwd: string, ...a: string[]) => spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...a], { cwd, encoding: "utf8" });
function base(): string {
  const d = mkdtempSync(join(tmpdir(), "e1-b-"));
  writeFileSync(join(d, "a.ts"), "export const a = 1;\n");
  git(d, "init", "-q");
  git(d, "add", "-A");
  git(d, "commit", "-q", "-m", "B");
  return d;
}
const unit = (id: string): PlantedUnit => ({ id, repo: "r-" + id, set: "comparison", ecosystem: "node", stars: "1k-9.9k", publicMonth: "2026-06", strictWindow: true, regionLines: 10, planted: ["t1", "t2"], plantedClass: { t1: "assert", t2: "crash" }, functional: [], foresee: null, winnable: null, hard: null, pilot: false });

describe("items", () => {
  test("14 counted items and the pilot; sums match section 11", () => {
    const c = E1_ITEMS.filter((i) => i.item !== "e1-pilot" && i.item !== "e1-supply");
    expect(c.length).toBe(14);
    expect(Math.round(c.reduce((s, i) => s + i.projectionUsd, 0))).toBe(2898);
    expect(Math.round(c.reduce((s, i) => s + i.capUsd, 0))).toBe(3478);
    expect(e1Item("e1-pilot").capUsd).toBe(165);
    expect(e1Item("e1-supply").capUsd).toBe(220);
    expect(() => e1Item("e1-p-sol")).toThrow(/no line item/);
  });
  test("cells: every arm on its models, two a unit, units in order, a unit's cells seeded", () => {
    const cs = e1Cells("s1", ["u1", "u2"]);
    expect(cs.length).toBe(2 * 14 * 2);
    expect(cs.slice(0, 28).every((c) => c.unit === "u1")).toBe(true);
    expect(cs.some((c) => c.arm === "P" && c.model === "sol")).toBe(false);
    expect(e1Cells("s1", ["u1"])).toEqual(e1Cells("s1", ["u1"]));
    expect(e1Cells("s2", ["u1"])).not.toEqual(e1Cells("s1", ["u1"]));
  });
  test("Codex instruction paths left in B are found", () => {
    const d = mkdtempSync(join(tmpdir(), "e1-cx-"));
    mkdirSync(join(d, "x", ".codex"), { recursive: true });
    writeFileSync(join(d, "AGENTS.override.md"), "x");
    expect(codexConfigLeft(d)).toEqual(["AGENTS.override.md", "x/.codex"]);
  });
});

describe("reviews then builds, scored", () => {
  test("a retry, a gap, a mount, exposure, a graded build and the composite", async () => {
    const run = mkdtempSync(join(tmpdir(), "e1-run-"));
    const b = base();
    const planPath = join(run, "plan.md");
    writeFileSync(planPath, "# Plan\nAdd a state.\n");
    const u = unit("u1");
    const units = new Map([["u1", { unit: u, base: b, plan: planPath }]]);
    const cells: CellKey[] = [{ unit: "u1", arm: "D", model: "opus", rep: 0 }, { unit: "u1", arm: "D", model: "opus", rep: 1 }];
    const calls: string[] = [];
    const session: E1ReviewSession = async (s) => {
      calls.push(s.cell + "/a" + s.attempt);
      expect(existsSync(join(s.seed, "repo", "a.ts"))).toBe(true);
      const upstream = s.rep === 1 || s.attempt === 1;
      const plan = "# Plan\nAdd a state.\nidle -> running\nrunning -> done\ndone -> idle\n";
      return { end: upstream ? "upstream" : "completed", costUsd: 0.2, result: { dir: s.dir, host: "claude", plan, transcript: JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "ok" }] } }) + "\n", stateRoot: null, written: { files: [{ path: "/tmp/m.tla", text: "MODULE" }], binary: 1, large: 0 }, repoEdits: 0 } };
    };
    const gate = new ItemGate(e1Item("e1-d-opus"));
    const recs = await e1Reviews({ run, cells, units, session, gate });
    expect(calls).toEqual(["u1_D_opus_0/a1", "u1_D_opus_0/a2", "u1_D_opus_1/a1", "u1_D_opus_1/a2"]);
    expect(recs.map((r) => [r.rep, r.outcome, r.exposed, r.writtenFiles, r.binaryLeftOut])).toEqual([[0, "completed", true, 1, 1], [1, "upstream_gap", null, 0, 0]]);
    expect(existsSync(join(run, "e1", "reviews", "mounts", cellKey(cells[0]!), "review", "m.tla"))).toBe(true);
    const again = await e1Reviews({ run, cells, units, session, gate });
    expect([again.length, calls.length]).toEqual([2, 4]);
    const tree = mkdtempSync(join(tmpdir(), "e1-t-"));
    writeFileSync(join(tree, "final.patch"), "");
    writeFileSync(join(tree, "sdk-messages.jsonl"), JSON.stringify({ type: "tool_use", input: { file_path: "/work/review/m.tla" } }) + "\n");
    let built = 0;
    const builds = await e1Builds({
      run,
      cells,
      units: new Map([["u1", { unit: u, base: b, plan: planPath, dir: run, note: "" }]]),
      session: async (s) => {
        built++;
        expect(s.prompt.startsWith("Implement the plan in plan.md")).toBe(true);
        expect(s.arm).toBe("plain");
        return { outcome: "completed", tree, costUsd: 0.3 };
      },
      grader: { grade: async () => ({ planted: [{ id: "t1", runs: ["pass", "pass", "assert"] }, { id: "t2", runs: ["assert", "crash", "pass"] }], functional: [] }), catchOf: async () => ({ catch: true, drop: null }) },
      gate: new ItemGate(e1Item("e1-d-opus")),
    });
    expect(built).toBe(1);
    expect(builds.map((x) => [x.rep, x.outcome, x.readReview])).toEqual([[0, "completed", true], [1, "upstream_gap", null]]);
    const scored = scoredCells(run, cells, new Map([["u1", { unit: u, repo: "r1" }]]));
    expect(scored.map((c) => [c.rep, c.composite, c.exposed])).toEqual([[0, 0.75, true], [1, null, null]]);
  });
});
