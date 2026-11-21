// Value: protects=the second attempt's decision read of row 1's stops (its section 3, items 8 to 10): every CAP_STOP in a launch's stops.json and every ledger item's recorded cap stop count with no flag, an authoring cap stop counts unless the sealed authoring summary records it after all 88 calibration and comparison briefs were placed, a halt or the draft limit counts, and --cap-stop adds a stop but never removes one.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { authorToCustody } from "../../../lanes/office-hours-rewrite/author/custody.ts";
import { answersOf, fakeDecrypter, fakeMeter, fakeSealer, FIXTURE_SCREEN, fixtureParser, plantedFirstAttempt, runCaller, wordLabeller } from "../../../lanes/office-hours-rewrite/author/fixtures.ts";
import { authorRun } from "../../../lanes/office-hours-rewrite/author/run.ts";
import { schedule } from "../../../lanes/office-hours-rewrite/author/draws.ts";
import { CAPS } from "../../../lanes/office-hours-rewrite/frozen.ts";
import { MeterError } from "../../../lanes/product-value/meter.ts";
import { decide } from "../../../lanes/office-hours-rewrite/read/decision.ts";
import { ITEMS, plant, plantStops } from "../../../lanes/office-hours-rewrite/read/seams.ts";
import { AUTHOR_ITEM, authoringEnd, readStops, type AuthoringEnd } from "../../../lanes/office-hours-rewrite/read/stops.ts";

const made: (() => void)[] = [];
afterAll(() => made.forEach((f) => f()));
const FILLED: AuthoringEnd = { stopped: "quotas", full: true };
const planted = (o: Parameters<typeof plantStops>[0]) => {
  const p = plantStops(o);
  made.push(p.done);
  return p;
};
const read = (p: ReturnType<typeof plantStops>, authoring: AuthoringEnd = FILLED, flag = false) => readStops({ launches: [p.launch], record: p.record, items: ITEMS, authoring, flag });

describe("cap stops from the launches and the ledger (item 10)", () => {
  test("a CAP_STOP in a launch's stops.json reads row 1 with no flag, an earlier one too", () => {
    const p = planted({ launch: [{ code: "CAP_STOP", message: "s2-0042: the ledger refused the round" }], capped: [] });
    const stops = read(p);
    expect(stops).toEqual([join(p.launch, "stops.json") + ": CAP_STOP s2-0042: the ledger refused the round"]);
    expect(decide({ ...plant("merge"), stops }).row).toBe(1);
    expect(decide({ ...plant("merge"), stops: read(planted({ launch: [], capped: [] })) }).row).toBe(4);
    writeFileSync(join(p.launch, "stops.json"), JSON.stringify({ stops: [], earlier: [{ code: "CAP_STOP", message: "an earlier part" }] }));
    expect(read(p)).toHaveLength(1);
  });
  test("a launch's stop that is not about money adds none", () => {
    expect(read(planted({ launch: [{ code: "E_OHR_MODEL_DRIFT", message: "a reply named another model" }], capped: [] }))).toEqual([]);
  });
  test("a launch with no stops.json is refused, so a missing file never hides a stop", () => {
    const empty = mkdtempSync(join(tmpdir(), "ohr-nostops-"));
    made.push(() => rmSync(empty, { recursive: true, force: true }));
    const p = planted({ launch: [], capped: [] });
    expect(() => readStops({ launches: [p.launch, empty], record: p.record, items: ITEMS, authoring: FILLED, flag: false })).toThrow("E_OHR_READ_INPUT");
  });
  test("a ledger item's recorded cap stop reads row 1 with no flag, on every one of the lane's items", () => {
    const p = planted({ launch: [], capped: ITEMS.filter((i) => i !== AUTHOR_ITEM) });
    const stops = read(p);
    expect(stops).toHaveLength(ITEMS.length - 1);
    expect(stops.every((s) => s.startsWith("ledger item ") && s.includes("CAP_STOP"))).toBe(true);
    expect(decide({ ...plant("merge"), stops }).row).toBe(1);
  });
  test("--cap-stop adds a stop, and leaving it off removes none", () => {
    expect(read(planted({ launch: [], capped: [] }), FILLED, true)).toEqual(["--cap-stop: a cap stop named on the command line"]);
    expect(read(planted({ launch: [], capped: ["ohr-s2-arms"] }), FILLED, false)).toHaveLength(1);
  });
});

describe("authoring's stops (items 8 and 9)", () => {
  const slots = new Map(schedule().map((s) => [s.slot, s]));
  const setOf = (label: string) => schedule().find((s) => s.p === Math.floor(Number(/^d(\d+)/.exec(label)![1]) / 1000) - 1)!.set;
  async function sealedAfter(set: "reserve" | "comparison") {
    const placed = await plantedFirstAttempt();
    const base = wordLabeller();
    const label = Object.assign(async (req: Parameters<typeof base>[0]) => {
      if (/^d\d+/.test(req.label) && setOf(req.label) === set) throw new MeterError("CAP_STOP", "brief label: the ledger refused the call");
      return base(req);
    }, { calls: base.calls });
    const m = fakeMeter(runCaller());
    const run = await authorRun({ call: m.call, label, parse: fixtureParser, screen: FIXTURE_SCREEN, spent: m.spent, spentOn: m.spentOn }, { cap: CAPS.authoring, concurrency: 8, reuse: { placed, answers: answersOf(placed), failed: [] } });
    const dir = mkdtempSync(join(tmpdir(), "ohr-sealed-")), shm = mkdtempSync("/dev/shm/ohr-sealed-");
    made.push(() => (rmSync(dir, { recursive: true, force: true }), rmSync(shm, { recursive: true, force: true })));
    const out = join(dir, "authoring.tar.age");
    authorToCustody(run, { work: join(shm, "work"), out, sealer: fakeSealer });
    return { out, run };
  }
  test("an authoring cap stop the sealed summary records after all 88 calibration and comparison briefs were placed does not count", async () => {
    const { out, run } = await sealedAfter("reserve");
    const end = authoringEnd(out, fakeDecrypter);
    expect(end).toEqual({ stopped: "cap", full: true });
    expect(run.sets.calibration.length + run.sets.comparison.length).toBe(88);
    const stops = read(planted({ launch: [], capped: [AUTHOR_ITEM] }), end);
    expect(stops).toEqual([]);
    expect(decide({ ...plant("merge"), stops }).row).toBe(4);
  });
  test("an authoring cap stop the sealed summary records before they were placed reads row 1, from the ledger and from authoring's end", async () => {
    const { out, run } = await sealedAfter("comparison");
    const end = authoringEnd(out, fakeDecrypter);
    expect(end).toEqual({ stopped: "cap", full: false });
    expect(run.sets.comparison.filter((m) => slots.get(m.slot)!.set === "comparison").length).toBeLessThan(80);
    const stops = read(planted({ launch: [], capped: [AUTHOR_ITEM] }), end);
    expect(stops).toHaveLength(2);
    expect(stops[0]).toStartWith("ledger item ohr-author: CAP_STOP line item ohr-author cap-stopped");
    expect(stops[1]).toBe("authoring stopped at cap before calibration and comparison were full");
    expect(decide({ ...plant("merge"), stops }).row).toBe(1);
  });
  test("with no summary to say otherwise, a cap stop on the authoring item counts", () => {
    expect(read(planted({ launch: [], capped: [AUTHOR_ITEM] }))).toHaveLength(1);
  });
  test("a halt and the draft limit read row 1", () => {
    for (const authoring of [{ stopped: "halt", full: false }, { stopped: "halt", full: true }, { stopped: "schedule", full: false }] as const) {
      const stops = read(planted({ launch: [], capped: [] }), authoring);
      expect(stops).toHaveLength(1);
      expect(decide({ ...plant("merge"), stops }).row).toBe(1);
    }
  });
  test("a summary with no stopped and full, like the first attempt's, is refused", () => {
    const dir = mkdtempSync(join(tmpdir(), "ohr-old-"));
    made.push(() => rmSync(dir, { recursive: true, force: true }));
    const plain = join(dir, "plain");
    plantFiles(plain, { "authoring/summary.json": JSON.stringify({ placed: 19 }) });
    fakeSealer(plain, join(dir, "old.age"));
    expect(() => authoringEnd(join(dir, "old.age"), fakeDecrypter)).toThrow("E_OHR_READ_INPUT");
  });
});

function plantFiles(dir: string, files: Record<string, string>) {
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
}
