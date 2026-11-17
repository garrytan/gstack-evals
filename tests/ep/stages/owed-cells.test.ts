// Copyright (c) 2026 Garry Tan. MIT License.
// The planted stages' one retry and owed cells, second dated pre-run fix (2026-11-17), keyless. An upstream or infra end
// gets one fresh retry in all, whatever kind each end was, in builds and in reviews. An attempt that ended in a gap with
// no new driver open ran no session, so its cell is owed. `ep owed` sets a recorded gap aside only when the driver's log
// shows its retry never opened, checks every rename before it moves anything and moves the record last. A hinted cell
// whose record was saved before its verdict gets the verdict from that record, never a new session. A grader error after
// a completed session marks the cell and stops it, so no retry opens for it.
import { afterAll, describe, expect, test } from "bun:test";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ReviewSession } from "../../../lanes/eng-build/pipeline.ts";
import { takeSpend } from "../../../lanes/eng-build/spend.ts";
import { runPlantedBuild, type PlantedSession } from "../../../lanes/eng-planted/stages/build.ts";
import { buildDriver, stagesCommands } from "../../../lanes/eng-planted/stages/commands.ts";
import { ItemGate, itemOf, ITEMS, stubLauncher } from "../../../lanes/eng-planted/stages/ledger.ts";
import { EP_RUN } from "../../../lanes/eng-planted/stages/local.ts";
import { drawFile, hintedTodo, runPlantedReviews, saveBuild, unitFolders } from "../../../lanes/eng-planted/stages/pipeline.ts";
import { owedOnRefusal, setAsideRefusedGaps } from "../../../lanes/eng-planted/stages/rerun-log.ts";
import type { GradedBuild, PlantedGrader, PlantedUnit, SessionOutcome } from "../../../lanes/eng-planted/types.ts";
import { recordApproval } from "../../../src/runner/ledger/ledger.ts";
import { authorStub, buildStub, graderStub, plantedUnits, reviewStub, type SeenBuild } from "./fixture.ts";

const D = 1_000_000;
const quotes = [{ words: "keyless test on a temporary ledger", by: "ep owed-cells test", source: "tests/ep/stages/owed-cells.test.ts" }];
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const temp = () => {
  const d = mkdtempSync(join(tmpdir(), "ep-owed-"));
  dirs.push(d);
  return d;
};
const ARM = "eb-build:none";
const RERUN = "fresh container after an upstream or infra end";
const row = (driver: string, r: Record<string, unknown>) => {
  mkdirSync(driver, { recursive: true });
  appendFileSync(join(driver, "sessions.jsonl"), JSON.stringify({ at: new Date().toISOString(), run_id: EP_RUN, ...r }) + "\n");
};
const caught = async (f: () => unknown): Promise<{ code?: string; message: string } | null> => {
  try {
    await f();
  } catch (e) {
    return e as { code?: string; message: string };
  }
  return null;
};
const unitOf = (fx: { units: string }, id: string) => JSON.parse(readFileSync(join(fx.units, id, "ep-unit.json"), "utf8")) as PlantedUnit;

/** The authoring steps on three synthetic units, two authored, through the stub seams, with the given build session and grader. */
function authoring(W: string, session: PlantedSession, grader: PlantedGrader = graderStub()) {
  const fx = plantedUnits(W, 3);
  const record = join(W, "record");
  for (const i of ITEMS) recordApproval(record, { action: "init", item: i.item, cap_micros: i.capUsd * D, quotes, admission: "warn" });
  const run = join(W, "run");
  const unavailable = () => {
    throw new Error("not used by the authoring steps");
  };
  const t = stagesCommands({ author: () => stubLauncher(authorStub()), build: () => stubLauncher(session), grader: async () => grader, judge: unavailable, review: unavailable } as never);
  const item = ITEMS.find((i) => i.item === "ep-authoring")!;
  const step = (s: string) => t.author!.run({ flags: new Map(Object.entries({ "--run": run, "--units": fx.units, "--repos": fx.repos, "--item": item.item, "--cap-usd": String(item.capUsd), "--ledger-record": record, "--ledger": join(W, "ledger.sqlite"), "--crew-usd": "450", "--hosts-usd": "90", "--cache": join(W, "cache"), "--work": join(W, "work"), "--batch": "1", "--step": s, "--chunk": "2" })), bools: new Set<string>(), rest: [] }, { out: () => {}, err: () => {} });
  return { fx, run, step, todo: () => hintedTodo(run, drawFile(run, unitFolders(fx.units, fx.repos)).order) };
}

describe("an upstream or infra end", () => {
  // Value: protects=prereg section 4's one fresh retry, then a gap; fails_when=an upstream end then an infra end (or
  // the reverse) opens a third attempt in a build or a review, as eng-build's per-kind count allows.
  test("gets one fresh retry in all in a build, whatever kind each end was", async () => {
    const W = temp();
    const fx = plantedUnits(W, 1);
    const seen: number[] = [];
    const ends: SessionOutcome[] = ["upstream_gap", "infra_gap", "completed"];
    const lines: string[] = [];
    const b = await runPlantedBuild({ unit: unitOf(fx, fx.ids[0]!), unitDir: join(fx.units, fx.ids[0]!), arm: "none", reviewer: null, rep: 1, note: "", mount: { plan: "p", review: null }, session: async (s) => (seen.push(s.attempt), { outcome: ends[s.attempt - 1]!, tree: null, costUsd: 1 }), grader: graderStub(), log: (l) => void lines.push(l) });
    expect([b.outcome, seen, b.costUsd]).toEqual(["infra_gap", [1, 2], 2]);
    expect(lines).toEqual(["E_EB_GAP cell " + fx.ids[0] + "_none_-_1: infra_gap after 1 retry; recorded as a gap"]);
  });

  test("gets one fresh retry in all in a review, whatever kind each end was", async () => {
    const W = temp();
    const fx = plantedUnits(W, 1);
    const id = fx.ids[0]!;
    const plan = join(W, "plan.md");
    writeFileSync(plan, "# Plan\n");
    const inner = reviewStub([]);
    const seen: number[] = [];
    const session: ReviewSession = async (s) => {
      seen.push(s.attempt);
      const a = await inner(s);
      return s.attempt === 1 ? { ...a, end: "infra" } : s.attempt === 2 ? { ...a, end: "upstream" } : a;
    };
    const gate = new ItemGate(itemOf("ep-comparison"), { capUsd: 40, planned: { "review:plain": 1, "review:standalone": 0, "review:engphase": 0, build: 0 } });
    const [r] = await runPlantedReviews({ cells: [{ unit: id, arm: "plain", rep: 1 }], units: new Map([[id, { unit: unitOf(fx, id), base: join(fx.repos, id), plan, opening: null }]]), reviewer: "opus", out: join(W, "out"), session, gate, interim: false });
    expect([r!.outcome, seen]).toEqual(["upstream_gap", [1, 2]]);
  });
});

describe("a review cell an earlier run left with no record", () => {
  // Value: protects=the one retry across runs and the earlier attempts' evidence; fails_when=a resumed review stage
  // starts the cell at attempt 1 again, deleting the earlier attempt's folder and opening more sessions than one retry.
  test("goes on from its next attempt, keeps the earlier folders, and opens nothing once both attempts started", async () => {
    const W = temp();
    const fx = plantedUnits(W, 2);
    const plan = join(W, "plan.md");
    writeFileSync(plan, "# Plan\n");
    const units = new Map(fx.ids.map((id) => [id, { unit: unitOf(fx, id), base: join(fx.repos, id), plan, opening: null }] as const));
    const inner = reviewStub([]);
    const seen: string[] = [];
    let stop = (_u: string, _n: number) => false;
    const session: ReviewSession = async (s) => {
      seen.push(s.unit.id + ":" + s.attempt);
      if (stop(s.unit.id, s.attempt)) throw new Error("stopped mid-cell");
      const a = await inner(s);
      return s.attempt === 1 ? { ...a, end: "infra" } : a;
    };
    const review = (id: string) => runPlantedReviews({ cells: [{ unit: id, arm: "plain", rep: 1 }], units, reviewer: "opus", out: join(W, "out"), session, gate: new ItemGate(itemOf("ep-comparison"), { capUsd: 40, planned: { "review:plain": 1, "review:standalone": 0, "review:engphase": 0, build: 0 } }), interim: false });
    const folder = (id: string, a: string) => existsSync(join(W, "out", "sessions", id + "_plain_opus_1", a));
    const [u0, u1] = [fx.ids[0]!, fx.ids[1]!];
    stop = (u, n) => u === u0 && n === 1;
    expect((await caught(() => review(u0)))?.message).toContain("stopped mid-cell");
    stop = () => false;
    const [r0] = await review(u0);
    expect([r0!.outcome, seen, folder(u0, "a1"), folder(u0, "a2")]).toEqual(["completed", [u0 + ":1", u0 + ":2"], true, true]);
    seen.length = 0;
    stop = (u, n) => u === u1 && n === 2;
    expect((await caught(() => review(u1)))?.message).toContain("stopped mid-cell");
    stop = () => false;
    expect((await caught(() => review(u1)))?.code).toBe("E_EB_CELL_INCOMPLETE");
    expect([seen, folder(u1, "a1"), folder(u1, "a2")]).toEqual([[u1 + ":1", u1 + ":2"], true, true]);
  });
});

describe("an attempt that ended in a gap with no new driver open", () => {
  // Value: protects=ruling A's owed cells; fails_when=an attempt whose harbor run never reached the driver is counted
  // as the cell's retry and recorded as a gap, though no session ran.
  test("leaves the cell owed and keeps its attempt folder; one the driver opened stands", async () => {
    const W = temp();
    const driver = join(W, "driver");
    const sessions = join(W, "rig", "sessions");
    row(driver, { event: "open", arm: ARM, task: "c1", trial_n: 1 });
    const s = { cell: "c1", attempt: 2 } as Parameters<PlantedSession>[0];
    mkdirSync(join(sessions, "c1", "a2"), { recursive: true });
    writeFileSync(join(sessions, "c1", "a2", "harbor.log"), "log\n");
    const never = owedOnRefusal(async () => ({ outcome: "infra_gap", tree: null, costUsd: 0 }), driver, EP_RUN, sessions);
    const e = await caught(() => never(s));
    expect(e?.code).toBe("E_EB_CELL_INCOMPLETE");
    expect(e?.message).toContain("cell c1: attempt 2 never reached the driver, so no session ran; the cell is owed");
    expect([existsSync(join(sessions, "c1", "a2")), readFileSync(join(sessions, "c1", "a2.owed", "harbor.log"), "utf8")]).toEqual([false, "log\n"]);
    mkdirSync(join(sessions, "c1", "a2"));
    expect((await caught(() => never(s)))?.message).toContain("its attempt folder is kept as " + join(sessions, "c1", "a2.owed-2"));
    expect(existsSync(join(sessions, "c1", "a2.owed", "harbor.log"))).toBe(true);
    const opened = owedOnRefusal(async () => (row(driver, { event: "open", arm: ARM, task: "c1", trial_n: 1, rerun: RERUN }), { outcome: "infra_gap", tree: null, costUsd: 0.25 }), driver, EP_RUN);
    expect((await opened(s)).outcome).toBe("infra_gap");
  });
});

describe("ep owed's recovery", () => {
  // Value: protects=the recorded results and the owed cells' one retry; fails_when=recovery reopens a cell whose retry
  // ran (a refused first attempt, then a retry that opened), misses a gap whose retry never reached the driver, trusts
  // a refusal that came before the open or carries no rerun tag, or stops halfway with a record and its verdict apart.
  const gaps = (units: string[]) => {
    const run = temp();
    const cells = join(run, "builds", "authoring", "cells");
    for (const unit of units) {
      saveBuild(cells, { unit, arm: "hinted", reviewer: null, rep: 1, pilot: false, outcome: "infra_gap", limitStop: false, planted: [], functional: [], catch: null, catchDrop: "gap", readReview: null, coverage: null, testLinesAdded: 0, costUsd: 0 } as unknown as GradedBuild);
      mkdirSync(join(run, "author", unit), { recursive: true });
      writeFileSync(join(run, "author", unit, "hinted.json"), JSON.stringify({ drop: "hinted-gap" }) + "\n");
      for (const a of ["a1", "a2"]) mkdirSync(join(run, "builds", "authoring", "rig", "sessions", unit + "_hinted_-_1", a), { recursive: true });
    }
    return { run, driver: buildDriver(run), cells, sessions: join(run, "builds", "authoring", "rig", "sessions") };
  };
  const at = (s: number) => "2026-11-17T19:00:" + String(s).padStart(2, "0") + ".000Z";
  const refusal = { event: "refuse", code: "E_USAGE", status: 422, arm: ARM, trial_n: 1, trial: "task__x", detail: "E_USAGE: outcome driver: stage ep-authoring has used its 2 reruns" };

  test("sets aside exactly the gaps whose retry never opened", () => {
    const g = gaps(["u1", "u2", "u3", "u4", "u5"]);
    row(g.driver, { event: "open", arm: ARM, task: "u1_hinted_-_1", trial_n: 1, at: at(1) });
    row(g.driver, { ...refusal, task: "u2_hinted_-_1", at: at(2) });
    row(g.driver, { event: "open", arm: ARM, task: "u2_hinted_-_1", trial_n: 1, rerun: RERUN, at: at(3) });
    row(g.driver, { ...refusal, task: "u3_hinted_-_1", rerun: RERUN, at: at(4) });
    row(g.driver, { event: "open", arm: ARM, task: "u3_hinted_-_1", trial_n: 1, at: at(5) });
    row(g.driver, { event: "open", arm: ARM, task: "u4_hinted_-_1", trial_n: 1, at: at(6) });
    row(g.driver, { ...refusal, task: "u4_hinted_-_1", rerun: RERUN, at: at(7) });
    const rows = setAsideRefusedGaps(g.run, g.driver, EP_RUN);
    expect(rows.map((r) => [r.cell, r.opens, r.refusals.length])).toEqual([
      ["u1_hinted_-_1", 1, 0],
      ["u4_hinted_-_1", 1, 1],
      ["u5_hinted_-_1", 0, 0],
    ]);
    expect(rows[0]!.moved).toEqual([join(g.run, "author", "u1", "hinted.refused-gap.json"), join(g.sessions, "u1_hinted_-_1", "a2.refused-gap"), join(g.cells, "u1_hinted_-_1.refused-gap.sha256"), join(g.cells, "u1_hinted_-_1.refused-gap.json")]);
    expect(rows[2]!.moved).toContain(join(g.sessions, "u5_hinted_-_1", "a1.refused-gap"));
    expect(existsSync(join(g.sessions, "u1_hinted_-_1", "a1"))).toBe(true);
    for (const u of ["u2", "u3"]) {
      expect(existsSync(join(g.cells, u + "_hinted_-_1.json"))).toBe(true);
      expect(existsSync(join(g.run, "author", u, "hinted.json"))).toBe(true);
      expect(existsSync(join(g.sessions, u + "_hinted_-_1", "a2"))).toBe(true);
    }
    expect(setAsideRefusedGaps(g.run, g.driver, EP_RUN)).toEqual([]);
  });

  test("checks every rename before it moves anything, and a second run finishes a recovery a crash left halfway", async () => {
    const g = gaps(["u1"]);
    row(g.driver, { event: "open", arm: ARM, task: "u1_hinted_-_1", trial_n: 1, at: at(1) });
    row(g.driver, { ...refusal, task: "u1_hinted_-_1", rerun: RERUN, at: at(2) });
    const clash = join(g.cells, "u1_hinted_-_1.refused-gap.sha256");
    writeFileSync(clash, "x\n");
    expect((await caught(async () => setAsideRefusedGaps(g.run, g.driver, EP_RUN)))?.code).toBe("E_USAGE");
    for (const p of [join(g.cells, "u1_hinted_-_1.json"), join(g.cells, "u1_hinted_-_1.sha256"), join(g.run, "author", "u1", "hinted.json"), join(g.sessions, "u1_hinted_-_1", "a2")]) expect(existsSync(p)).toBe(true);
    rmSync(clash);
    renameSync(join(g.run, "author", "u1", "hinted.json"), join(g.run, "author", "u1", "hinted.refused-gap.json"));
    renameSync(join(g.sessions, "u1_hinted_-_1", "a2"), join(g.sessions, "u1_hinted_-_1", "a2.refused-gap"));
    const rows = setAsideRefusedGaps(g.run, g.driver, EP_RUN);
    expect(rows.map((r) => r.cell)).toEqual(["u1_hinted_-_1"]);
    for (const p of rows[0]!.moved) expect(existsSync(p)).toBe(true);
    expect(existsSync(join(g.cells, "u1_hinted_-_1.json"))).toBe(false);
    expect(setAsideRefusedGaps(g.run, g.driver, EP_RUN)).toEqual([]);
  });
});

describe("a hinted cell whose record was saved before its verdict", () => {
  // Value: protects=a completed hinted build; fails_when=a stage that stopped between saving the record and writing
  // hinted.json builds the cell again as its retry and replaces the record, or a verdict is written back from a record
  // that ep owed was halfway through setting aside.
  test("gets its verdict from the saved record, with no session, unless ep owed stopped halfway setting it aside", async () => {
    const W = temp();
    const calls: string[] = [];
    const inner = buildStub(W, [] as SeenBuild[]);
    const a = authoring(W, async (s) => (calls.push(s.unit.id + ":" + s.attempt), inner(s)));
    expect(await a.step("calls")).toBe(0);
    const [id] = a.todo();
    expect(await a.step("hinted")).toBe(0);
    const verdict = join(a.run, "author", id!, "hinted.json");
    const record = join(a.run, "builds", "authoring", "cells", id + "_hinted_-_1.json");
    const [v, r] = [readFileSync(verdict, "utf8"), readFileSync(record, "utf8")];
    rmSync(verdict);
    calls.length = 0;
    expect(await a.step("hinted")).toBe(0);
    expect(calls).toEqual([]);
    expect([readFileSync(verdict, "utf8"), readFileSync(record, "utf8")]).toEqual([v, r]);
    renameSync(verdict, join(a.run, "author", id!, "hinted.refused-gap.json"));
    expect((await caught(() => a.step("hinted")))?.code).toBe("E_USAGE");
    expect([existsSync(verdict), calls]).toEqual([false, []]);
  });
});

describe("a grader error after a completed session", () => {
  // Value: protects=the cell's one retry; fails_when=a grader error after a completed, paid session leaves the cell to
  // be built again as its retry instead of stopping it for the Captain, or drops the session's spend.
  test("marks the cell and stops it, and the next run opens no session for it", async () => {
    const W = temp();
    const calls: string[] = [];
    let target = "";
    const inner = buildStub(W, [] as SeenBuild[]);
    const base = graderStub();
    const grader: PlantedGrader = { ...base, grade: async (u, d, t) => (u.id === target ? Promise.reject(new Error("grader: no verdict in 3 runs\nmore detail")) : base.grade(u, d, t)) };
    const a = authoring(W, async (s) => (calls.push(s.unit.id + ":" + s.attempt), inner(s)), grader);
    expect(await a.step("calls")).toBe(0);
    target = a.todo()[0]!;
    const cell = target + "_hinted_-_1";
    const first = await caught(() => a.step("hinted"));
    expect(first?.code).toBe("E_EB_CELL_INCOMPLETE");
    expect(first?.message).toContain("cell " + cell + ": its grader failed after a completed session (grader: no verdict in 3 runs)");
    const marker = join(a.run, "builds", "authoring", "cells", cell + ".grade-error");
    expect(readFileSync(marker, "utf8")).toBe("grader: no verdict in 3 runs\n");
    expect(existsSync(join(a.run, "builds", "authoring", "cells", cell + ".json"))).toBe(false);
    expect(existsSync(join(a.run, "author", target, "hinted.json"))).toBe(false);
    calls.length = 0;
    const again = await caught(() => a.step("hinted"));
    expect(again?.code).toBe("E_EB_CELL_INCOMPLETE");
    expect(again?.message).toContain("cell " + cell + ": its grader failed after a completed session (grader: no verdict in 3 runs), so no retry opens; bring it to the Captain");
    expect(calls.filter((c) => c.startsWith(target))).toEqual([]);
  });

  test("carries the session's spend on the stop", async () => {
    const W = temp();
    const fx = plantedUnits(W, 1);
    const id = fx.ids[0]!;
    const marker = join(W, "cells", id + "_none_-_1.grade-error");
    const e = await caught(() => runPlantedBuild({ unit: unitOf(fx, id), unitDir: join(fx.units, id), arm: "none", reviewer: null, rep: 1, note: "", mount: { plan: "p", review: null }, session: buildStub(W, []), grader: { ...graderStub(), catchOf: async () => Promise.reject(new Error("catch: no reading")) }, marker }));
    expect([e?.code, takeSpend(e), readFileSync(marker, "utf8")]).toEqual(["E_EB_CELL_INCOMPLETE", 2, "catch: no reading\n"]);
  });
});
