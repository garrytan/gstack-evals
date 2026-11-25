// Copyright (c) 2026 Garry Tan. MIT License.
// Eval 1's keyless dry-run cases (prereg 2026-11-24-geva-587-design-time-state-modeling section 10): each drives one
// frozen rule on synthetic cells or stub sessions and prints what it saw. The driven launch needs Docker, so it prints
// SKIP without GSTACK_EVALS_DOCKER=1, which is never a pass.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordApproval } from "../../../src/runner/ledger/ledger.ts";
import { readItem } from "../../../src/runner/ledger/record.ts";
import { ItemGate } from "../stages/ledger.ts";
import type { DryCase, PlantedUnit } from "../types.ts";
import { e1StubLauncher } from "./commands.ts";
import { decide, type Readings } from "./decide.ts";
import { dExposure } from "./detect.ts";
import { RUNS_ON, type E1Arm, type E1Model } from "./frozen.ts";
import type { E1ReviewSession } from "./launch.ts";
import { look } from "./look.ts";
import { e1Builds, e1Item, E1_ITEMS, e1Reviews, type CellKey } from "./pipeline.ts";
import { contrast, isRead, type Cell, type Reading } from "./readings.ts";

const cell = (unit: string, repo: string, arm: E1Arm, model: E1Model, rep: number, composite: number | null, exposed: boolean | null = arm === "N" ? null : true): Cell => ({ unit, repo, arm, model, rep, composite, exposed });
function grid(n: number, comp: (arm: E1Arm, model: E1Model) => number, exposed: (arm: E1Arm, model: E1Model) => boolean = () => true): Cell[] {
  const out: Cell[] = [];
  for (let i = 0; i < n; i++) for (const a of Object.keys(RUNS_ON) as E1Arm[]) for (const m of RUNS_ON[a]) for (const k of [0, 1]) out.push(cell("u" + i, "r" + Math.floor(i / 2), a, m, k, comp(a, m), a === "N" ? null : exposed(a, m)));
  return out;
}
const R = (estimate: number, lo: number, hi: number): Reading => ({ estimate, lo, hi, p: 0.5, pairs: 64, repos: 30, worse: 10, models: ["opus"] });
const none = R(0, -5, 5);
const rows = (o: Partial<Readings>) => decide({ cells: grid(2, () => 0.5), r: { DN: none, CN: none, GN: none, PN: none, PC: none, CG: none, CNopus: none, CNsol: none, ...o }, stopped: new Set(), units: 64 }).rows;
const has = (rs: string[], s: string) => rs.some((r) => r.includes(s));
const win = { CG: R(3, 0.1, 6), CNopus: R(0, -5, 5), CNsol: R(0, -5, 5) };

export const CASES: DryCase[] = [
  {
    name: "C's step needs +10.0 with a lower bound above 0",
    run: () => {
      const at10 = has(rows({ CN: R(10, 0.1, 20), ...win }), "GStack Minder drafts C's step");
      const at99 = has(rows({ CN: R(9.9, 0.1, 20), ...win }), "small gain");
      const lo0 = has(rows({ CN: R(10, 0, 20), ...win }), "not shown");
      return { ok: at10 && at99 && lo0, detail: "+10.0 with 0.1 drafts " + at10 + ", +9.9 is a small gain " + at99 + ", a lower bound of 0.0 is not shown " + lo0 };
    },
  },
  {
    name: "a per-model point at -0.1 holds C's step, at 0.0 it doesn't",
    run: () => {
      const sol = has(rows({ CN: R(12, 1, 20), ...win, CNsol: R(-0.1, -9, 9) }), "below 0 on Sol");
      const opus = has(rows({ CN: R(12, 1, 20), ...win, CNopus: R(-0.1, -9, 9) }), "below 0 on Opus");
      const zero = has(rows({ CN: R(12, 1, 20), ...win, CNsol: R(0, -9, 9) }), "drafts C's step");
      return { ok: sol && opus && zero, detail: "Sol -0.1 holds " + sol + ", Opus -0.1 holds " + opus + ", 0.0 drafts " + zero };
    },
  },
  {
    name: "the look stops C and P at upper bounds of +4.9, not +5.0",
    run: () => {
      const order = Array.from({ length: 8 }, (_, i) => "u" + i);
      const at = (c: number, p: number) => grid(8, (a) => (a === "C" ? c : a === "P" ? p : 0.5));
      const stop = look(order, at(0.549, 0.549), 1, 200).stop;
      const cGo = look(order, at(0.55, 0.549), 1, 200).stop;
      const pGo = look(order, at(0.549, 0.55), 1, 200).stop;
      return { ok: stop && !cGo && !pGo, detail: "both at +4.9 stop " + stop + ", C at +5.0 stops " + cGo + ", P at +5.0 stops " + pGo };
    },
  },
  {
    name: "exposure at 0.80 reads and under it is untested; gaps at 10% read and over it are untested",
    run: () => {
      const mk = (n: number, exposedN: number, gaps: number) => [...Array.from({ length: n }, (_, i) => cell("u" + i, "r", "C", "opus", 0, 0.5, i < exposedN)), ...Array.from({ length: gaps }, (_, i) => cell("g" + i, "r", "C", "opus", 0, null, null))];
      const got = [isRead(mk(5, 4, 0), "C", "opus"), isRead(mk(4, 3, 0), "C", "opus"), isRead(mk(9, 9, 1), "C", "opus"), isRead(mk(17, 17, 2), "C", "opus")];
      return { ok: got.join() === "true,false,true,false", detail: "4 of 5, 3 of 4, 1 gap in 10, 2 gaps in 19: " + got.join(", ") };
    },
  },
  {
    name: "an untested model leaves the pooled contrast",
    run: () => {
      const cs = grid(4, (a, m) => (a === "C" ? (m === "sol" ? 0.1 : 0.7) : 0.5), (a, m) => !(a === "C" && m === "sol"));
      const r = contrast(cs, "C", "N", ["opus", "sol", "particle"], 1, { draws: 200 });
      const models = [...(r?.models ?? [])].sort().join(",");
      return { ok: models === "opus,particle" && Math.abs((r?.estimate ?? 0) - 20) < 1e-9, detail: "pooled over " + models + ", C minus N " + (r?.estimate ?? "none") + " points" };
    },
  },
  {
    name: "D's diagram needs 3 arrow lines with two labels joined",
    run: () => {
      const three = dExposure("# Plan\n", "# Plan\nidle -> running\nrunning -> done\ndone -> idle\n").exposed;
      const two = dExposure("# Plan\n", "# Plan\nidle -> running\nrunning -> done\n").exposed;
      return { ok: three && !two, detail: "3 lines exposed " + three + ", 2 lines exposed " + two };
    },
  },
  {
    name: "an upstream end is retried once, then the cell is a gap and its build is not run",
    run: async () => {
      const run = mkdtempSync(join(tmpdir(), "e1-dry-"));
      try {
        const base = join(run, "base");
        mkdirSync(base);
        writeFileSync(join(base, "a.ts"), "export const a = 1;\n");
        const git = (...a: string[]) => spawnSync("git", ["-c", "user.email=d@d", "-c", "user.name=d", ...a], { cwd: base });
        git("init", "-q");
        git("add", "-A");
        git("commit", "-q", "-m", "B");
        writeFileSync(join(run, "plan.md"), "# Plan\nAdd a state.\n");
        const unit: PlantedUnit = { id: "u1", repo: "r1", set: "comparison", ecosystem: "node", stars: "1k-9.9k", publicMonth: "2026-06", strictWindow: true, regionLines: 10, planted: ["t1"], plantedClass: { t1: "assert" }, functional: [], foresee: null, winnable: null, hard: null, pilot: false };
        const cells: CellKey[] = [{ unit: "u1", arm: "N", model: "opus", rep: 0 }];
        const tries: number[] = [];
        const session: E1ReviewSession = async (s) => {
          tries.push(s.attempt);
          return { end: "upstream", costUsd: 0.1, result: { dir: s.dir, host: "claude", plan: null, transcript: "", stateRoot: null, written: { files: [], binary: 0, large: 0 }, repoEdits: 0 } };
        };
        const recs = await e1Reviews({ run, cells, units: new Map([["u1", { unit, base, plan: join(run, "plan.md") }]]), session, gate: new ItemGate(e1Item("e1-n-opus")) });
        let built = 0;
        const builds = await e1Builds({ run, cells, units: new Map([["u1", { unit, base, plan: join(run, "plan.md"), dir: run, note: "" }]]), session: async () => (built++, { outcome: "completed", tree: run, costUsd: 0 }), grader: { grade: async () => ({ planted: [], functional: [] }), catchOf: async () => ({ catch: null, drop: null }) }, gate: new ItemGate(e1Item("e1-n-opus")) });
        const ok = tries.join() === "1,2" && recs[0]?.outcome === "upstream_gap" && builds[0]?.outcome === "upstream_gap" && built === 0;
        return { ok, detail: "attempts " + tries.join(", ") + ", review " + (recs[0]?.outcome ?? "none") + ", build " + (builds[0]?.outcome ?? "none") + " with " + built + " sessions" };
      } finally {
        rmSync(run, { recursive: true, force: true });
      }
    },
  },
  {
    name: "one lease opens and settles on every eval 1 item, on a temporary ledger",
    run: async () => {
      const dir = mkdtempSync(join(tmpdir(), "e1-dry-"));
      try {
        const record = join(dir, "record");
        const quote = { words: "dry run", by: "e1 dry run", source: "lanes/eng-planted/e1/cases.ts" };
        for (const i of E1_ITEMS) recordApproval(record, { action: "init", item: i.item, cap_micros: Math.round(i.capUsd * 1_000_000), quotes: [quote], admission: "warn" });
        let settled = 0;
        for (const i of E1_ITEMS) {
          const h = await e1StubLauncher(null)({ item: i.item, capUsd: i.capUsd, record, ledger: join(dir, "l.sqlite") });
          await h.close();
          const it = readItem(record, i.item);
          if (it.leases.length === 1 && it.open === null && it.leases[0]!.close !== null) settled++;
        }
        return { ok: settled === E1_ITEMS.length, detail: settled + " of " + E1_ITEMS.length + " items opened and settled one lease" };
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  },
  {
    name: "driven launch of the pilot's reviews and builds on each model through the real launchers",
    docker: true,
    run: async () => {
      const { drivenLaunch } = await import("./e2e.ts");
      return drivenLaunch();
    },
  },
];
