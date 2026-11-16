// Copyright (c) 2026 Garry Tan. MIT License.
// The planted-unit stages end to end through the ep commands, keyless: synthetic units, stub sessions, model calls and
// grader, and every lease on a temporary ledger. It walks section 14's order and reads back what each step left.
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { recordApproval } from "../../../src/runner/ledger/ledger.ts";
import { readItem } from "../../../src/runner/ledger/record.ts";
import { RESTORE_PIN, SIZE } from "../../../lanes/eng-planted/frozen.ts";
import { stockMount, STOCK_REVIEW } from "../../../lanes/eng-planted/stages/build.ts";
import { stagesCommands, type Seams } from "../../../lanes/eng-planted/stages/commands.ts";
import { ITEMS, stubLauncher } from "../../../lanes/eng-planted/stages/ledger.ts";
import { EP_RUN, readStep, writeStep } from "../../../lanes/eng-planted/stages/local.ts";
import { drawFile, unitFolders, type RunRecords } from "../../../lanes/eng-planted/stages/pipeline.ts";
import { authorStub, buildStub, graderStub, plantedUnits, reviewStub, unitId, type SeenBuild, type SeenReview } from "./fixture.ts";

const CHECKOUT = process.env.GSTACK_EVALS_RESTORE_CHECKOUT ?? join(homedir(), ".capy", "work", "wt-restore");
const haveCheckout = existsSync(join(CHECKOUT, "VERSION")) && readFileSync(join(CHECKOUT, "VERSION"), "utf8").trim() === RESTORE_PIN.version;

const N = 90;
const SEED = "5eed0000000000000000000000000001";
const SHARED = [20, 21, 22, 23];
let AUDIT: string[] = [];
let UNFORESEEABLE: string[] = [];
let UNWINNABLE: string[] = [];

let W = "";
let fx: { units: string; repos: string; ids: string[] };
const reviews: SeenReview[] = [];
const builds: SeenBuild[] = [];
const calls: string[] = [];
let t: ReturnType<typeof stagesCommands>;
const out: string[] = [];
const err: string[] = [];
const io = { out: (l: string) => void out.push(l), err: (l: string) => void err.push(l) };

const run = () => join(W, "run");
const record = () => join(W, "record");
const args = (flags: Record<string, string>) => ({ flags: new Map(Object.entries({ "--run": run(), "--units": fx.units, "--repos": fx.repos, ...flags })), bools: new Set<string>(), rest: [] });
const paid = (item: string, extra: Record<string, string> = {}) => args({ "--item": item, "--cap-usd": String(ITEMS.find((i) => i.item === item)!.capUsd), "--ledger-record": record(), "--ledger": join(W, "ledger.sqlite"), "--crew-usd": "450", "--hosts-usd": "90", "--work": join(W, "work"), "--cache": join(W, "cache"), ...extra });
const json = <T>(f: string) => JSON.parse(readFileSync(f, "utf8")) as T;

async function author(batch: 1 | 2) {
  for (let i = 0; i < 6; i++) {
    expect(await t.author!.run(paid("ep-authoring", { "--batch": String(batch), "--step": "calls" }), io)).toBe(0);
    expect(await t.author!.run(paid("ep-authoring", { "--batch": String(batch), "--step": "hinted" }), io)).toBe(0);
    expect(await t.author!.run(args({ "--batch": String(batch), "--step": "draw" }), io)).toBe(0);
    if (!out.at(-1)!.startsWith("draw open")) break;
  }
  expect(await t.author!.run(paid("ep-authoring", { "--batch": String(batch), "--step": "none" }), io)).toBe(0);
}

beforeAll(() => {
  W = mkdtempSync(join(tmpdir(), "ep-stages-"));
  fx = plantedUnits(W, N, SHARED);
  const order = drawFile(run(), unitFolders(fx.units, fx.repos), SEED).order.map((c) => c.id);
  AUDIT = [order[2]!, order[40]!];
  UNFORESEEABLE = [order[12]!];
  UNWINNABLE = [order[15]!];
  const quote = { words: "keyless test on a temporary ledger", by: "ep stages test", source: "tests/ep/stages/pipeline.test.ts" };
  for (const i of ITEMS) recordApproval(record(), { action: "init", item: i.item, cap_micros: i.capUsd * 1_000_000, quotes: [quote], admission: "warn" });
  const seams: Seams = {
    author: () => stubLauncher(authorStub({ audit: AUDIT, unforeseeable: UNFORESEEABLE, seen: calls })),
    judge: () => stubLauncher(async (role: string) => ({ text: role === "judge" ? "1. Parse must reject a reversed range." : "none", costUsd: 0.01 })),
    review: () => stubLauncher(reviewStub(reviews)),
    build: () => stubLauncher(buildStub(W, builds)),
    grader: async () => graderStub(UNWINNABLE),
  };
  t = stagesCommands(seams);
}, 180_000);
afterAll(() => rmSync(W, { recursive: true, force: true }));

describe("ep stages in section 14's order", () => {
  setDefaultTimeout(180_000);
  test("batch 1: authoring fills 6 calibration and 20 pilot units in seeded order, with every drop recorded", async () => {
    await author(1);
    const step = readStep(run(), "author-batch1")!;
    expect(step.ok).toBe(true);
    const d = json<{ calibration: string[]; comparison: string[]; pilot: string[]; skipped: Array<{ id: string; reason: string }> }>(join(run(), "draw-batch1.json"));
    expect(d.calibration).toHaveLength(SIZE.calibration);
    expect(d.pilot).toHaveLength(SIZE.pilotUnits);
    const drawn = [...d.calibration, ...d.comparison];
    for (const id of [...AUDIT, ...UNWINNABLE]) expect(drawn).not.toContain(id);
    expect(d.comparison).not.toContain(UNFORESEEABLE[0]);
    expect(drawn.filter((id) => SHARED.map(unitId).includes(id)).length).toBeLessThanOrEqual(3);
    for (const id of drawn) expect(existsSync(join(run(), "builds", "authoring", "cells", id + "_none_-_1.json"))).toBe(true);
    const writes = new Map<string, number>();
    for (const c of calls.filter((c) => c.startsWith("writer:"))) writes.set(c.slice(7), (writes.get(c.slice(7)) ?? 0) + 1);
    expect([...writes].filter(([, n]) => n > 1).every(([id, n]) => AUDIT.includes(id) && n === 2)).toBe(true);
    expect([...writes].filter(([, n]) => n > 1).length).toBeGreaterThan(0);
    const hinted = builds.filter((b) => b.arm === "hinted");
    expect(hinted.every((b) => b.prompt.includes("written in either order") && !b.prompt.includes("/work/review/") && b.review === null)).toBe(true);
    const none = builds.filter((b) => b.arm === "none");
    expect(none.every((b) => !b.prompt.includes("either order") && b.review === null && b.plan === join(run(), "author", b.unit, "plan.md"))).toBe(true);
  });

  test.skipIf(!haveCheckout)("the exposure smoke runs both skill arms at the pin on each calibration unit", async () => {
    const before = reviews.length;
    expect(await t.smoke!.run(paid("ep-smoke", { "--gstack": CHECKOUT }), io)).toBe(0);
    const smoke = reviews.slice(before);
    expect(smoke).toHaveLength(2 * SIZE.calibration);
    expect(smoke.filter((r) => r.arm === "engphase").every((r) => r.prompt.includes("Review the plan in plan.md"))).toBe(true);
    expect(smoke.every((r) => r.repoFiles.length === 1 && !r.plan.includes("## Review"))).toBe(true);
    expect(readStep(run(), "smoke")!.ok).toBe(true);
  });

  test("the pilot's plain reviews and builds run on the comparison item after the smoke and the gate", async () => {
    if (!readStep(run(), "smoke")) writeStep(run(), { step: "smoke", ok: true, detail: "written by the test: no gstack checkout at the pin here" });
    writeStep(run(), { step: "exposure-gate", ok: true, detail: "readings: standalone 5 of 6", arms: ["standalone"] });
    const before = reviews.length;
    expect(await t.reviews!.run(paid("ep-comparison", { "--phase": "pilot" }), io)).toBe(0);
    expect(reviews.length - before).toBe(SIZE.pilotUnits * SIZE.pilotK);
    expect(reviews.slice(before).every((r) => r.arm === "plain" && !/plan-eng-review|autoplan/.test(r.prompt))).toBe(true);
    const b0 = builds.length;
    expect(await t.builds!.run(paid("ep-comparison", { "--phase": "pilot" }), io)).toBe(0);
    const pilot = builds.slice(b0);
    expect(pilot).toHaveLength(SIZE.pilotUnits * SIZE.pilotK);
    for (const b of pilot) {
      expect(b.plan).toContain(join("reviews", "comparison", "mounts"));
      expect(readFileSync(b.plan, "utf8")).toContain("## Review");
      expect(readdirSync(b.review!)).toEqual(["review.md"]);
      expect(b.prompt).toContain("A reviewer's notes on the plan are in /work/review/");
    }
    expect(readStep(run(), "pilot-builds")!.ok).toBe(true);
  });

  test("batch 2 waits for admission and the start rule, then fills the comparison and the reserve", async () => {
    await expect(t.author!.run(paid("ep-authoring", { "--batch": "2", "--step": "calls" }), io)).rejects.toThrow(/admission/);
    writeStep(run(), { step: "admission", ok: true, detail: "readings: HEADROOM" });
    writeStep(run(), { step: "start-rule", ok: true, detail: "readings: MDD 0.11" });
    await author(2);
    const d = json<{ calibration: string[]; comparison: string[]; reserve: string[]; pilot: string[]; filled: boolean }>(join(run(), "draw-batch2.json"));
    expect(d.filled).toBe(true);
    expect([d.calibration.length, d.comparison.length, d.reserve.length]).toEqual([SIZE.calibration, SIZE.units, SIZE.reserve]);
    const d1 = json<{ calibration: string[]; pilot: string[] }>(join(run(), "draw-batch1.json"));
    expect(d.calibration).toEqual(d1.calibration);
    expect(d.pilot).toEqual(d1.pilot);
  });

  test("a comparison unit lost to infrastructure is replaced by the first reserve unit", async () => {
    const d = json<{ comparison: string[]; reserve: string[]; pilot: string[] }>(join(run(), "draw-batch2.json"));
    const gone = d.comparison.find((id) => !d.pilot.includes(id))!;
    expect(await t.lost!.run(args({ "--unit": gone, "--reason": "the unit image no longer builds" }), io)).toBe(0);
    expect(out.at(-2)).toBe("lost " + gone + " (the unit image no longer builds), replaced by reserve " + d.reserve[0]);
  });

  test("the comparison reviews skip the pilot's cells and stop the unexposed skill arm after its first 24 sessions", async () => {
    const before = reviews.length;
    expect(await t.reviews!.run(paid("ep-comparison", { "--phase": "comparison" }), io)).toBe(0);
    const ran = reviews.slice(before);
    expect(ran.filter((r) => r.arm === "plain")).toHaveLength(SIZE.units * SIZE.k - SIZE.pilotUnits * SIZE.pilotK);
    expect(ran.filter((r) => r.arm === "precut")).toHaveLength(24);
    expect(err.some((l) => l.startsWith("E_EP_EXPOSURE_STOP arm standalone"))).toBe(true);
    expect(readStep(run(), "comparison-reviews")!.detail).toContain("stopped arms standalone");
  });

  test("the comparison and stock builds mount what each arm's builder should see", async () => {
    const b0 = builds.length;
    expect(await t.builds!.run(paid("ep-comparison", { "--phase": "comparison" }), io)).toBe(0);
    const ran = builds.slice(b0);
    expect(ran.filter((b) => b.arm === "plain")).toHaveLength(SIZE.units * SIZE.k - SIZE.pilotUnits * SIZE.pilotK);
    expect(ran.filter((b) => b.arm === "standalone")).toHaveLength(24);
    const s0 = builds.length;
    await expect(t.builds!.run(paid("ep-comparison", { "--phase": "stock" }), io)).rejects.toThrow(/ep-stock/);
    expect(await t.builds!.run(paid("ep-stock", { "--phase": "stock" }), io)).toBe(0);
    const stock = builds.slice(s0);
    expect(stock).toHaveLength(SIZE.units);
    const one = stock[0]!;
    expect(readFileSync(join(one.review!, "review.md"), "utf8")).toBe(stockMount(readFileSync(join(run(), "author", one.unit, "plan.md"), "utf8"), readFileSync(STOCK_REVIEW, "utf8")).files[0]!.text);
    expect(readFileSync(one.plan, "utf8")).toBe(readFileSync(join(run(), "author", one.unit, "plan.md"), "utf8"));
    const s1 = builds.length;
    expect(await t.builds!.run(paid("ep-stock", { "--phase": "stock" }), io)).toBe(0);
    expect(builds.length).toBe(s1);
    expect(readStep(run(), "stock-builds")!.ok).toBe(true);
  });

  test("the records come back in run order with the units' ratings and hinted outcomes", async () => {
    const file = join(W, "records.json");
    expect(await t.records!.run(args({ "--out": file }), io)).toBe(0);
    const r = json<RunRecords>(file);
    expect(r.units.filter((u) => u.set === "comparison")).toHaveLength(SIZE.units);
    expect(r.units.filter((u) => u.pilot)).toHaveLength(SIZE.pilotUnits);
    expect(r.units.every((u) => u.foresee !== null && u.winnable === true)).toBe(true);
    expect(r.lost).toHaveLength(1);
    expect(r.reviews.slice(0, SIZE.pilotUnits * SIZE.pilotK).every((x) => x.arm === "plain" && x.rep <= SIZE.pilotK)).toBe(true);
    expect(r.reviews.filter((x) => x.arm === "standalone").every((x) => x.exposed === false)).toBe(true);
    expect(r.builds.filter((b) => b.arm === "none")).toHaveLength(r.units.length);
    expect(r.builds.filter((b) => b.arm === "stock")).toHaveLength(SIZE.units);
    expect(r.builds.filter((b) => b.arm === "plain" || b.arm === "standalone").every((b) => b.readReview === true && b.reviewer === "opus")).toBe(true);
    expect(r.hintedBuilds.some((b) => b.unit === UNWINNABLE[0])).toBe(true);
    expect(r.unforeseeable).toBe(1);
    expect(r.hinted.screened - r.hinted.passed).toBe(UNWINNABLE.length);
    expect(r.admitted).toBe(r.hinted.passed);
  });

  test("the judge reads each comparison unit's bundles under the judge item", async () => {
    expect(await t.judge!.run(paid("ep-judge", { "--role": "judge" }), io)).toBe(0);
    const res = json<Array<{ unit: string; source: string; quotes: string[] }>>(join(run(), "judge", "judge.json"));
    expect(new Set(res.map((x) => x.source))).toEqual(new Set(["plain", "standalone", "stock", "none", "plan"]));
  });

  test("every lease opened on the run settled, and each item's journal holds its sessions", () => {
    for (const i of ITEMS) {
      const s = readItem(record(), i.item);
      expect(s.open).toBeNull();
      if (s.leases.length) expect(s.run_id).toBe(EP_RUN);
    }
    expect(readItem(record(), "ep-comparison").leases).toHaveLength(4);
    expect(readItem(record(), "ep-stock").leases).toHaveLength(2);
    const journal = readFileSync(join(run(), "costs", "ep-comparison.jsonl"), "utf8").trim().split("\n");
    expect(journal).toHaveLength(2 * (SIZE.units * SIZE.k + 24));
    expect(json<{ finished: boolean }>(join(run(), "state", "ep-comparison.json")).finished).toBe(true);
  });
});
