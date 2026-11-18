// Copyright (c) 2026 Garry Tan. MIT License.
// The rewrite eval's scorer (prereg section 5's R1 to R3, section 8's failure table, section 7's builder right call) and
// pre-run change 1's delivered-replies rule for R1.
import { afterAll, describe, expect, test } from "bun:test";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SEED } from "../../../lanes/office-hours-rewrite/frozen.ts";
import { BRIEFS, allRows, blockOf, row, stateRoot, stubCaller, transcript, turn } from "../../../lanes/office-hours-rewrite/score/fixtures.ts";
import { judgePackets, type JudgedLabel } from "../../../lanes/office-hours-rewrite/score/judge.ts";
import { buildLabelPackets } from "../../../lanes/office-hours-rewrite/score/packets.ts";
import { combine, r1, scoreSessions, stockCredits } from "../../../lanes/office-hours-rewrite/score/score.ts";
import type { SessionRow } from "../../../lanes/office-hours-rewrite/types.ts";

const roots: string[] = [];
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));
const D = (t: ReturnType<typeof turn>, delivered = true) => ({ ...t, delivered });

async function scored(rows: SessionRow[], call = stubCaller()) {
  const built = buildLabelPackets({ stage: 1, seed: SEED, briefs: BRIEFS, rows });
  const { labels } = await judgePackets({ map: built.map, packets: new Map(built.packets.map((p) => [p.id, p])), call, effort: "medium" });
  return { built, labels, out: scoreSessions({ rows, briefs: BRIEFS, maps: [built.map], labels }) };
}
const deliveredRow = (o: Partial<SessionRow> & Pick<SessionRow, "brief">) => {
  const k = BRIEFS.get(o.brief)!.key;
  return row({ founder_turns: [D(turn(1, k.decisive)), D(turn(2)), D(turn(3))], ...o });
};

describe("R1, found (section 5; pre-run change 1)", () => {
  test("a decisive fact revealed in a delivered reply finds it; a non-decisive one does not", () => {
    expect(r1([D(turn(1, ["x"])), D(turn(2, ["fa1"]))], BRIEFS.get("a")!.key)).toBe(1);
    expect(r1([D(turn(1, ["x"]))], BRIEFS.get("a")!.key)).toBe(0);
    expect(r1([D(turn(1, ["fb2"]))], BRIEFS.get("b")!.key)).toBe(1);
  });
  test("a decisive fact only in a reply the closing message replaced does not count", () => {
    expect(r1([D(turn(1)), D(turn(2, ["fa1"]), false)], BRIEFS.get("a")!.key)).toBe(0);
  });
  test("a decisive fact only in a draw the checks rejected does not count", () => {
    const rejected = { ...turn(1, ["fa1"]), attempts: 2, delivered: false };
    expect(r1([rejected, D(turn(1))], BRIEFS.get("a")!.key)).toBe(0);
  });
  test("a turn with no delivered mark does not count", () => {
    expect(r1([turn(1, ["fa1"])], BRIEFS.get("a")!.key)).toBe(0);
  });
});

describe("R = R1 and R2 and R3", () => {
  test("combine: any 0 gives 0, else any null gives null, else 1", () => {
    expect(combine([1, 1, 1])).toBe(1);
    expect(combine([1, 0, null])).toBe(0);
    expect(combine([1, null, 1])).toBeNull();
    expect(combine([0, 1, 1])).toBe(0);
  });
  test("the key's call and an acceptable action with the decisive fact found score R = 1, in every arm", async () => {
    const { out } = await scored(allRows("opus"));
    expect(out).toHaveLength(12);
    for (const s of out) expect([s.R1, s.R2, s.R3, s.R]).toEqual([1, 1, 1, 1]);
    expect(out.find((s) => s.brief === "d")!.kind).toBe("builder");
  });
  test("the contrast call loses R2; a stock action loses R3; no decisive fact loses R1", async () => {
    const twin = deliveredRow({ brief: "a", arm: "new", block: blockOf(BRIEFS.get("b")!.key.call, BRIEFS.get("a")!.key.actions[0]!) });
    const stock = deliveredRow({ brief: "a", arm: "current", block: blockOf(BRIEFS.get("a")!.key.call, "Talk to more customers this month.") });
    const blind = deliveredRow({ brief: "a", arm: "none", founder_turns: [D(turn(1, ["other"]))] });
    const { out } = await scored([twin, stock, blind]);
    const by = (arm: string) => out.find((s) => s.arm === arm)!;
    expect([by("new").R1, by("new").R2, by("new").R3, by("new").R]).toEqual([1, 0, 1, 0]);
    expect([by("current").R2, by("current").R3, by("current").R]).toEqual([1, 0, 0]);
    expect([by("none").R1, by("none").R2, by("none").R]).toEqual([0, 1, 0]);
  });
  test("an unlabelled cell leaves R null unless another part is 0", async () => {
    const rows = [deliveredRow({ brief: "a", arm: "new" }), deliveredRow({ brief: "a", arm: "none", founder_turns: [D(turn(1))] })];
    const k = BRIEFS.get("a")!.key;
    const call = stubCaller({ garble: 2 });
    const { out } = await scored(rows, call);
    expect(out.find((s) => s.arm === "new")!).toMatchObject({ R1: 1, R2: null, R3: null, R: null });
    expect(out.find((s) => s.arm === "none")!).toMatchObject({ R1: 0, R2: null, R: 0 });
    expect(k.call).toBeTruthy();
  });
});

describe("failure table (section 8)", () => {
  test("missing and contaminated score null everywhere; safety stops, refusals and no-block score R = 0 with R1 from the log", async () => {
    const ends = (["missing", "contaminated", "safety-stop", "refusal", "no-block"] as const).map((end, i) => deliveredRow({ brief: "a", arm: (["none", "current", "new", "none", "current"] as const)[i]!, model: i < 3 ? "opus" : "sol", end, block: null, code: "E_X" }));
    const { out } = await scored(ends);
    const got = Object.fromEntries(out.map((s) => [s.end, [s.R1, s.R2, s.R3, s.R]]));
    expect(got).toEqual({ missing: [null, null, null, null], contaminated: [null, null, null, null], "safety-stop": [1, 0, 0, 0], refusal: [1, 0, 0, 0], "no-block": [1, 0, 0, 0] });
  });
  test("a block row with no label map entry is refused", () => {
    expect(() => scoreSessions({ rows: [deliveredRow({ brief: "a" })], briefs: BRIEFS, maps: [], labels: [] })).toThrow(/^E_OHR_SCORE_INPUT/);
  });
  test("labels from a judge other than the routed one, or at max effort, are refused", async () => {
    const rows = [deliveredRow({ brief: "a" })];
    const { built, labels } = await scored(rows);
    const swap = (l: JudgedLabel): JudgedLabel => ({ ...l, judge: "opus" });
    expect(() => scoreSessions({ rows, briefs: BRIEFS, maps: [built.map], labels: labels.map(swap) })).toThrow(/^E_OHR_SCORE_INPUT/);
    expect(() => scoreSessions({ rows, briefs: BRIEFS, maps: [built.map], labels: labels.map((l) => ({ ...l, effort: "max" as const })) })).toThrow(/^E_OHR_SCORE_INPUT/);
  });
});

describe("detectors in the scored row", () => {
  test("skill arms get exposure, builder skill sessions kept-whole, every session with a transcript compliance; G2 and G3 counts", async () => {
    const dir = stateRoot({ "projects/map/u-main-design-1.md": "# Design: Map\nStatus: APPROVED\nMode: Builder\n" });
    roots.push(dir);
    const tpath = join(dir, "transcript.ndjson");
    writeFileSync(tpath, transcript([[{ tool: "Read", input: { file_path: "/s/office-hours/SKILL.md" }, result: "x" }, { tool: "Read", input: { file_path: "/s/office-hours/sections/phase-2b-builder-brainstorm.md" }, result: "x" }, "What's the coolest version of this?"], ["Who would you show this to?"], ["Doc written."], ["DECISION: a\nNEXT ACTION: b\nWHY: c"]]));
    const rows = [deliveredRow({ brief: "d", arm: "new", transcript: tpath, state_root: dir, session_kind: "interactive", closings: 1 }), deliveredRow({ brief: "d", arm: "none", transcript: tpath, state_root: dir })];
    const { out } = await scored(rows);
    const skill = out.find((s) => s.arm === "new")!, none = out.find((s) => s.arm === "none")!;
    expect(skill.exposure).toEqual({ read_skill: true, interactive: true, questions_one_at_a_time: 2, wrote_deliverable: true, exposed: true });
    expect(skill.kept_whole).toMatchObject({ kept: true });
    expect(skill.compliance).toMatchObject({ deliverable: "design", approved_on_disk: true, commitment: null });
    expect(skill.questions).toBe(2);
    expect(skill.founder_replies).toBe(3);
    expect(none.exposure).toBeNull();
    expect(none.kept_whole).toBeNull();
    expect(none.compliance).not.toBeNull();
    const noTranscript = (await scored([deliveredRow({ brief: "a", arm: "new" })])).out[0]!;
    expect([noTranscript.exposure, noTranscript.compliance]).toEqual([null, null]);
  });
});

describe("stock credits", () => {
  test("counts stock rows the production judge credited on either cell, and unlabelled ones apart", async () => {
    const rows = allRows("opus");
    const { built, labels } = await scored(rows);
    expect(stockCredits([built.map], labels)).toEqual({ rows: 12, credited: 0, unlabelled: 0 });
    const stockIds = new Set(Object.values(built.map.packets).flatMap((p) => Object.entries(p.blocks).filter(([, r]) => r.kind === "stock").map(([id]) => id)));
    const bent = labels.map((l, i) => (stockIds.has(l.block) && i % 2 ? { ...l, action: true } : l));
    expect(stockCredits([built.map], bent).credited).toBeGreaterThan(0);
  });
});
