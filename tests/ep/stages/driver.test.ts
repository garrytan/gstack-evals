// Copyright (c) 2026 Garry Tan. MIT License.
// eng-planted's build stages on the outcome driver, keyless (dated pre-run fixes, 2026-11-17). An item that already holds
// the run's metered-call or review leases, which name no holder, is refused by default and served once the lane says so
// (unheld_ok), while an open one is still refused. The ledger binds a run to its first driver directory, so a build
// stage from another directory is refused, and every build stage of a run asks for the one buildDriver(run).
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildRegistry } from "../../../lanes/eng-build/build-stage.ts";
import { buildDriver, stagesCommands } from "../../../lanes/eng-planted/stages/commands.ts";
import { ITEMS, stubLauncher } from "../../../lanes/eng-planted/stages/ledger.ts";
import { EP_PROGRAM, EP_RUN, EP_SKILL } from "../../../lanes/eng-planted/stages/local.ts";
import { serveStages } from "../../../lanes/outcome-skills/driver/stage.ts";
import { recordProgram } from "../../../src/runner/ledger/envelope.ts";
import { openLease, recordApproval, settleLease } from "../../../src/runner/ledger/ledger.ts";
import { LocalLedger } from "../../../src/runner/ledger/local.ts";
import { readItem } from "../../../src/runner/ledger/record.ts";
import { authorStub, buildStub, graderStub, plantedUnits, type SeenBuild } from "./fixture.ts";

const D = 1_000_000;
const quotes = [{ words: "keyless test on a temporary ledger", by: "ep driver test", source: "tests/ep/stages/driver.test.ts" }];
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const temp = () => {
  const d = mkdtempSync(join(tmpdir(), "ep-driver-"));
  dirs.push(d);
  return d;
};

/** A temporary ledger whose items join the run's program, as the run's are inited. */
function ledger(items: string[]) {
  const dir = temp();
  const record = join(dir, "record");
  recordProgram(record, { program: EP_PROGRAM, cap_micros: 100 * D, skill_cap_micros: 100 * D, skills: [EP_SKILL], credit_rate_micros: D, quotes });
  for (const item of items) recordApproval(record, { action: "init", item, cap_micros: 10 * D, quotes, admission: "warn", program: EP_PROGRAM, skills: [EP_SKILL] });
  return { dir, record, local: LocalLedger.open(join(dir, "ledger.sqlite")) };
}

/** One build stage served and stopped: whether it opened a lease and settled it, or the refusal. */
async function serve(l: ReturnType<typeof ledger>, item: string, dir: string, unheld_ok?: boolean) {
  mkdirSync(dir, { recursive: true });
  try {
    const served = await serveStages({ record: l.record, local: l.local, run_id: EP_RUN, envelope_host: "m1", machine: "m1", stages: [{ item, arm: "eb-build:none", skills: [EP_SKILL] }], host: "127.0.0.1", dir, registry: buildRegistry(), fetch: async () => new Response("{}"), env: { ANTHROPIC_API_KEY: "test-not-a-key" }, requireAdmission: () => null, ...(unheld_ok ? { unheld_ok } : {}) });
    const opened = readItem(l.record, item).open !== null;
    await served.stop();
    return { opened, settled: readItem(l.record, item).open === null };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

describe("an item that also holds the run's metered calls", () => {
  test("is refused by default and served with unheld_ok, which still refuses an open lease", async () => {
    const l = ledger(["ep-authoring"]);
    const calls = openLease(l.record, l.local, { item: "ep-authoring", run_id: EP_RUN, requireAdmission: () => null });
    expect((await serve(l, "ep-authoring", join(l.dir, "run"), true)).error).toContain("is still open");
    settleLease(l.record, l.local, calls.lease_id);
    expect((await serve(l, "ep-authoring", join(l.dir, "run"))).error).toContain("which name no holder");
    expect(await serve(l, "ep-authoring", join(l.dir, "run"), true)).toEqual({ opened: true, settled: true });
    l.local.close();
  });
});

describe("one driver directory serves every build stage of a run", () => {
  test("a second build stage from another directory is refused, and one from the same directory is served", async () => {
    const l = ledger(["ep-authoring", "ep-comparison"]);
    const shared = join(l.dir, "builds", "driver");
    expect(await serve(l, "ep-authoring", shared)).toEqual({ opened: true, settled: true });
    expect((await serve(l, "ep-comparison", join(l.dir, "builds", "comparison", "rig", "driver"))).error).toContain("is bound to run directory");
    expect(await serve(l, "ep-comparison", shared)).toEqual({ opened: true, settled: true });
    l.local.close();
  });
  test("the hinted builds ask for buildDriver(run), the directory the comparison and stock builds ask for too", async () => {
    const W = temp();
    const fx = plantedUnits(W, 6);
    const record = join(W, "record");
    for (const i of ITEMS) recordApproval(record, { action: "init", item: i.item, cap_micros: i.capUsd * D, quotes, admission: "warn" });
    const drivers: string[] = [];
    const builds: SeenBuild[] = [];
    const unavailable = () => {
      throw new Error("not used by the authoring steps");
    };
    const t = stagesCommands({ author: () => stubLauncher(authorStub()), build: (o: { driver: string }) => (drivers.push(o.driver), stubLauncher(buildStub(W, builds))), grader: async () => graderStub(), judge: unavailable, review: unavailable } as never);
    const item = ITEMS.find((i) => i.item === "ep-authoring")!;
    const run = (step: string) => t.author!.run({ flags: new Map(Object.entries({ "--run": join(W, "run"), "--units": fx.units, "--repos": fx.repos, "--item": item.item, "--cap-usd": String(item.capUsd), "--ledger-record": record, "--ledger": join(W, "ledger.sqlite"), "--crew-usd": "450", "--hosts-usd": "90", "--cache": join(W, "cache"), "--work": join(W, "work"), "--batch": "1", "--step": step, "--chunk": "3" })), bools: new Set<string>(), rest: [] }, { out: () => {}, err: () => {} });
    expect(await run("calls")).toBe(0);
    expect(await run("hinted")).toBe(0);
    expect(builds.length).toBeGreaterThan(0);
    expect(drivers).toEqual([buildDriver(join(W, "run"))]);
    expect(buildDriver(join(W, "run"))).toBe(join(W, "run", "builds", "driver"));
  });
});
