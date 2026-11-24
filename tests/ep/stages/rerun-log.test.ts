// Copyright (c) 2026 Garry Tan. MIT License.
// The planted build stages' retry rule across leases (dated pre-run fix, 2026-11-17), keyless. Each planned session gets
// one fresh retry across every lease: the driver's rerun budget is one per planned session, counted with the cells
// earlier leases opened, and a cell an earlier lease opened with no record starts at its retry. A retry the driver
// refused ran no session, so the cell is left owed rather than recorded as a gap, and the gaps recorded that way before
// this fix are set aside by code from the driver's log.
import { afterAll, describe, expect, test } from "bun:test";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildRegistry } from "../../../lanes/eng-build/build-stage.ts";
import type { PlantedSession } from "../../../lanes/eng-planted/stages/build.ts";
import { buildDriver, stagesCommands } from "../../../lanes/eng-planted/stages/commands.ts";
import { ITEMS, stubLauncher } from "../../../lanes/eng-planted/stages/ledger.ts";
import { EP_PROGRAM, EP_RUN, EP_SKILL } from "../../../lanes/eng-planted/stages/local.ts";
import { drawFile, hintedTodo, saveBuild, unitFolders } from "../../../lanes/eng-planted/stages/pipeline.ts";
import { owedOnRefusal, setAsideRefusedGaps, stagePlan } from "../../../lanes/eng-planted/stages/rerun-log.ts";
import type { GradedBuild } from "../../../lanes/eng-planted/types.ts";
import { serveStages } from "../../../lanes/outcome-skills/driver/stage.ts";
import { recordProgram } from "../../../src/runner/ledger/envelope.ts";
import { recordApproval } from "../../../src/runner/ledger/ledger.ts";
import { LocalLedger } from "../../../src/runner/ledger/local.ts";
import { authorStub, buildStub, graderStub, plantedUnits, type SeenBuild } from "./fixture.ts";

const D = 1_000_000;
const quotes = [{ words: "keyless test on a temporary ledger", by: "ep rerun test", source: "tests/ep/stages/rerun-log.test.ts" }];
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const temp = () => {
  const d = mkdtempSync(join(tmpdir(), "ep-rerun-"));
  dirs.push(d);
  return d;
};
const ARM = "eb-build:none";
const row = (driver: string, r: Record<string, unknown>) => {
  mkdirSync(driver, { recursive: true });
  appendFileSync(join(driver, "sessions.jsonl"), JSON.stringify({ at: new Date().toISOString(), run_id: EP_RUN, ...r }) + "\n");
};

describe("the rerun budget on the planted build stages", () => {
  // Value: protects=the prereg's one fresh retry per planned session; fails_when=the driver's stage-wide budget of two
  // reruns refuses a planned session's retry, or a resumed stage counts only its own cells and refuses its owed retries
  // and first opens, or a session gets a second retry in a later lease.
  test("is one rerun per planned session, counted across leases with the cells earlier leases opened", async () => {
    const dir = temp();
    const record = join(dir, "record");
    recordProgram(record, { program: EP_PROGRAM, cap_micros: 10_000 * D, skill_cap_micros: 10_000 * D, skills: [EP_SKILL], credit_rate_micros: D, quotes });
    recordApproval(record, { action: "init", item: "ep-authoring", cap_micros: 1_000 * D, quotes, admission: "warn", program: EP_PROGRAM, skills: [EP_SKILL] });
    const local = LocalLedger.open(join(dir, "ledger.sqlite"));
    const driver = join(dir, "driver");
    mkdirSync(driver, { recursive: true });
    const launch = (cells: string[]) => serveStages({ record, local, run_id: EP_RUN, envelope_host: "m1", machine: "m1", stages: [{ item: "ep-authoring", arm: ARM, skills: [EP_SKILL] }], host: "127.0.0.1", dir: driver, registry: buildRegistry(), fetch: async () => new Response("{}"), env: { ANTHROPIC_API_KEY: "test-not-a-key" }, requireAdmission: () => null, log: () => {}, ...stagePlan(driver, EP_RUN, ARM, cells) });
    let n = 0;
    const open = async (control: string, task: string, rerun = false) => {
      const body = { trial: "t-" + task, model: "claude-opus-5-5", cap_usd: 16, meta: { arm: ARM, task, trial_n: 1, ...(rerun ? { rerun: "fresh container after an upstream or infra end" } : {}) }, open_key: "k" + n++, ledger: "u4" };
      return (await fetch(control + "/sessions", { method: "POST", body: JSON.stringify(body) })).status;
    };
    const first = await launch(["a", "b", "c", "d"]);
    expect(await Promise.all(["a", "b", "c", "d"].map((t) => open(first.control, t)))).toEqual([200, 200, 200, 200]);
    expect([await open(first.control, "a", true), await open(first.control, "b", true), await open(first.control, "c", true)]).toEqual([200, 200, 200]);
    expect(await open(first.control, "a", true)).toBe(422);
    await first.stop();
    const again = await launch(["d", "e", "f"]);
    expect([await open(again.control, "d", true), await open(again.control, "e"), await open(again.control, "f")]).toEqual([200, 200, 200]);
    expect([await open(again.control, "a", true), await open(again.control, "d", true), await open(again.control, "g")]).toEqual([422, 422, 422]);
    await again.stop();
    local.close();
  });
});

describe("a refused retry", () => {
  // Value: protects=the gap rule's inputs; fails_when=a retry the driver refused, which ran no session, is recorded as a
  // gap after one retry, or the owed cell's next run opens it as a first attempt, or gives it more than its one retry.
  test("leaves the cell owed, and the next run gives it its one retry", async () => {
    const W = temp();
    const fx = plantedUnits(W, 6);
    const record = join(W, "record");
    for (const i of ITEMS) recordApproval(record, { action: "init", item: i.item, cap_micros: i.capUsd * D, quotes, admission: "warn" });
    const run = join(W, "run");
    const driver = buildDriver(run);
    const builds: SeenBuild[] = [];
    const calls: string[] = [];
    let target = "";
    let refuse = true;
    const inner = buildStub(W, builds);
    const session: PlantedSession = async (s) => {
      calls.push(s.unit.id + ":" + s.attempt);
      if (s.unit.id === target && s.attempt === 2 && refuse) {
        row(driver, { event: "refuse", code: "E_USAGE", status: 422, arm: ARM, task: s.cell, trial_n: 1, rerun: "fresh container", detail: "E_USAGE: outcome driver: stage ep-authoring has used its 2 reruns" });
        return { outcome: "infra_gap", tree: null, costUsd: 0 };
      }
      row(driver, { event: "open", arm: ARM, task: s.cell, trial_n: 1 });
      if (s.unit.id === target && s.attempt === 1) return { outcome: "infra_gap", tree: null, costUsd: 0.5 };
      return inner(s);
    };
    const unavailable = () => {
      throw new Error("not used by the authoring steps");
    };
    const t = stagesCommands({ author: () => stubLauncher(authorStub()), build: (o: { driver: string }) => stubLauncher(owedOnRefusal(session, o.driver, EP_RUN)), grader: async () => graderStub(), judge: unavailable, review: unavailable } as never);
    const item = ITEMS.find((i) => i.item === "ep-authoring")!;
    const step = (s: string) => t.author!.run({ flags: new Map(Object.entries({ "--run": run, "--units": fx.units, "--repos": fx.repos, "--item": item.item, "--cap-usd": String(item.capUsd), "--ledger-record": record, "--ledger": join(W, "ledger.sqlite"), "--crew-usd": "450", "--hosts-usd": "90", "--cache": join(W, "cache"), "--work": join(W, "work"), "--batch": "1", "--step": s, "--chunk": "3" })), bools: new Set<string>(), rest: [] }, { out: () => {}, err: () => {} });
    expect(await step("calls")).toBe(0);
    const src = unitFolders(fx.units, fx.repos);
    const todo = hintedTodo(run, drawFile(run, src).order);
    expect(todo).toHaveLength(3);
    target = todo[1]!;
    const cell = target + "_hinted_-_1";
    const stopped = await Promise.resolve()
      .then(() => step("hinted"))
      .then(() => null, (e: unknown) => e as { code: string; message: string });
    expect(stopped?.code).toBe("E_EB_CELL_INCOMPLETE");
    expect(stopped?.message).toContain("cell " + cell + ": the driver refused attempt 2's open");
    expect(existsSync(join(run, "builds", "authoring", "cells", cell + ".json"))).toBe(false);
    expect(existsSync(join(run, "author", target, "hinted.json"))).toBe(false);
    expect(existsSync(join(run, "author", todo[0]!, "hinted.json"))).toBe(true);
    expect(hintedTodo(run, drawFile(run, src).order)).toEqual([target, todo[2]!]);
    refuse = false;
    calls.length = 0;
    expect(await step("hinted")).toBe(0);
    expect(calls).toEqual([target + ":2", todo[2]! + ":1"]);
    const b = JSON.parse(readFileSync(join(run, "builds", "authoring", "cells", cell + ".json"), "utf8")) as GradedBuild;
    expect(b.outcome).toBe("completed");
    expect(hintedTodo(run, drawFile(run, src).order)).toEqual([]);
  });

  test("whose retry then fails is a gap after one retry, with no third attempt", async () => {
    const W = temp();
    const fx = plantedUnits(W, 3);
    const record = join(W, "record");
    for (const i of ITEMS) recordApproval(record, { action: "init", item: i.item, cap_micros: i.capUsd * D, quotes, admission: "warn" });
    const run = join(W, "run");
    const driver = buildDriver(run);
    const calls: number[] = [];
    let refuse = true;
    const session: PlantedSession = async (s) => {
      calls.push(s.attempt);
      if (s.attempt === 2 && refuse) {
        row(driver, { event: "refuse", code: "E_USAGE", status: 422, arm: ARM, task: s.cell, trial_n: 1, detail: "E_USAGE: outcome driver: stage ep-authoring has used its 2 reruns" });
        return { outcome: "infra_gap", tree: null, costUsd: 0 };
      }
      row(driver, { event: "open", arm: ARM, task: s.cell, trial_n: 1 });
      return { outcome: s.attempt === 1 ? "infra_gap" : "upstream_gap", tree: null, costUsd: 0.25 };
    };
    const unavailable = () => {
      throw new Error("not used by the authoring steps");
    };
    const lines: string[] = [];
    const t = stagesCommands({ author: () => stubLauncher(authorStub()), build: (o: { driver: string }) => stubLauncher(owedOnRefusal(session, o.driver, EP_RUN)), grader: async () => graderStub(), judge: unavailable, review: unavailable } as never);
    const item = ITEMS.find((i) => i.item === "ep-authoring")!;
    const step = (s: string) => t.author!.run({ flags: new Map(Object.entries({ "--run": run, "--units": fx.units, "--repos": fx.repos, "--item": item.item, "--cap-usd": String(item.capUsd), "--ledger-record": record, "--ledger": join(W, "ledger.sqlite"), "--crew-usd": "450", "--hosts-usd": "90", "--cache": join(W, "cache"), "--work": join(W, "work"), "--batch": "1", "--step": s, "--chunk": "1" })), bools: new Set<string>(), rest: [] }, { out: (l: string) => void lines.push(l), err: (l: string) => void lines.push(l) });
    expect(await step("calls")).toBe(0);
    const [id] = hintedTodo(run, drawFile(run, unitFolders(fx.units, fx.repos)).order);
    expect(
      await Promise.resolve()
        .then(() => step("hinted"))
        .then(() => "ok", (e: unknown) => (e as { code: string }).code),
    ).toBe("E_EB_CELL_INCOMPLETE");
    refuse = false;
    expect(await step("hinted")).toBe(0);
    expect(calls).toEqual([1, 2, 2]);
    expect(lines).toContain("E_EB_GAP cell " + id + "_hinted_-_1: upstream_gap after 1 retry; recorded as a gap");
    expect((JSON.parse(readFileSync(join(run, "author", id, "hinted.json"), "utf8")) as { drop: string }).drop).toBe("hinted-gap");
  });
});

describe("the gaps recorded when the driver refused a retry", () => {
  // Value: protects=the owed cells' one retry; fails_when=a gap recorded after a refused retry stays a gap, a cell whose
  // retry ran is reopened, or setting aside deletes or overwrites a record, a verdict or a session folder.
  test("are set aside by code from the driver's log, and nothing else is", () => {
    const run = temp();
    const driver = buildDriver(run);
    const cells = join(run, "builds", "authoring", "cells");
    const build = (unit: string, outcome: GradedBuild["outcome"]) => ({ unit, arm: "hinted", reviewer: null, rep: 1, pilot: false, outcome, limitStop: false, planted: [], functional: [], catch: null, catchDrop: "gap", readReview: null, coverage: null, testLinesAdded: 0, costUsd: 0 }) as unknown as GradedBuild;
    for (const [unit, outcome] of [["u1", "infra_gap"], ["u2", "infra_gap"], ["u3", "completed"], ["u4", "upstream_gap"]] as const) {
      saveBuild(cells, build(unit, outcome));
      mkdirSync(join(run, "author", unit), { recursive: true });
      writeFileSync(join(run, "author", unit, "hinted.json"), JSON.stringify({ drop: outcome === "completed" ? null : "hinted-gap" }) + "\n");
      for (const a of ["a1", "a2"]) mkdirSync(join(run, "builds", "authoring", "rig", "sessions", unit + "_hinted_-_1", a), { recursive: true });
    }
    const refuse = (task: string) => row(driver, { event: "refuse", code: "E_USAGE", status: 422, arm: ARM, task, trial_n: 1, trial: "task__x", rerun: "fresh container after an upstream or infra end", detail: "E_USAGE: outcome driver: stage ep-authoring has used its 2 reruns" });
    row(driver, { event: "open", arm: ARM, task: "u1_hinted_-_1", trial_n: 1 });
    refuse("u1_hinted_-_1");
    for (const u of ["u2", "u2"]) row(driver, { event: "open", arm: ARM, task: u + "_hinted_-_1", trial_n: 1 });
    row(driver, { event: "open", arm: ARM, task: "u3_hinted_-_1", trial_n: 1 });
    row(driver, { event: "open", arm: ARM, task: "u4_hinted_-_1", trial_n: 1 });
    row(driver, { event: "open", arm: ARM, task: "u4_hinted_-_1", trial_n: 1, run_id: "another-run" });
    refuse("u4_hinted_-_1");
    const rows = setAsideRefusedGaps(run, driver, EP_RUN);
    expect(rows.map((r) => [r.cell, r.outcome, r.opens, r.refusals.length])).toEqual([
      ["u1_hinted_-_1", "infra_gap", 1, 1],
      ["u4_hinted_-_1", "upstream_gap", 1, 1],
    ]);
    expect(rows[0]!.moved).toEqual([join(run, "author", "u1", "hinted.refused-gap.json"), join(run, "builds", "authoring", "rig", "sessions", "u1_hinted_-_1", "a2.refused-gap"), join(cells, "u1_hinted_-_1.refused-gap.sha256"), join(cells, "u1_hinted_-_1.refused-gap.json")]);
    for (const p of rows[0]!.moved) expect(existsSync(p)).toBe(true);
    expect(existsSync(join(cells, "u1_hinted_-_1.json"))).toBe(false);
    expect(existsSync(join(run, "builds", "authoring", "rig", "sessions", "u1_hinted_-_1", "a1"))).toBe(true);
    for (const u of ["u2", "u3"]) {
      expect(existsSync(join(cells, u + "_hinted_-_1.json"))).toBe(true);
      expect(existsSync(join(run, "author", u, "hinted.json"))).toBe(true);
    }
    expect(setAsideRefusedGaps(run, driver, EP_RUN)).toEqual([]);
  });
});
