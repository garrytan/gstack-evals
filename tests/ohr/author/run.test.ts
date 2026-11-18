// Value: protects=the second attempt's authoring (its sections 4 and 5) as driven on a fake provider: each slot's fixed draw sequence, the top-up bound, the pilot, the projection stop pinned to sizing.txt and on planted yields that go and that stop, reserves last, the cap stop's two sides, the outcome log sealed draft by draft and batch by batch, a resume at another concurrency that requests no sealed draft again, and the reuse check on a planted bundle.
import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { authorRun, checkAnswers, countsOf, haltOf, kindOf, metaOf, SLOT_DRAWS, summaryOf, type AuthorDeps, type AuthorRun, type Checkpoint, type Journal, type LogEntry, type Reuse } from "../../../lanes/office-hours-rewrite/author/run.ts";
import { answersOf, fakeDecrypter, fakeMeter, fakeSealer, FIXTURE_SCREEN, fixtureParser, plantedFirstAttempt, runCaller, wordLabeller, writeFirstAttempt } from "../../../lanes/office-hours-rewrite/author/fixtures.ts";
import { drawOf, familyOf, schedule } from "../../../lanes/office-hours-rewrite/author/draws.ts";
import { ATTEMPT_1, projection, readProjection } from "../../../lanes/office-hours-rewrite/author/pilot.ts";
import { readJournal, readReuse, sealedJournal } from "../../../lanes/office-hours-rewrite/author/custody.ts";
import { CAPS, PAIRED_TYPES, PILOT, REUSED_SLOTS, TOP_UP_BOUND } from "../../../lanes/office-hours-rewrite/frozen.ts";
import { MeterError } from "../../../lanes/product-value/meter.ts";
import type { Outcome } from "../../../lanes/office-hours-rewrite/author/brief.ts";

const SLOTS = schedule();
const bySlot = new Map(SLOTS.map((s) => [s.slot, s]));
const made: string[] = [];
afterAll(() => made.forEach((d) => rmSync(d, { recursive: true, force: true })));
const temp = (prefix: string) => (made.push(mkdtempSync(prefix)), made.at(-1)!);
const mdd = () => 0.14;
const PLACED = await plantedFirstAttempt();
const REUSE: Reuse = { placed: PLACED, answers: answersOf(PLACED), failed: [] };
/** The slot a draft reference belongs to: draw 1000 * (p + 1) + k. */
const slotOfRef = (ref: string) => SLOTS.find((s) => s.p === Math.floor(Number(/^d(\d+)/.exec(ref)![1]) / 1000) - 1)!;
const twinOf = (ref: string) => /^d\d+b/.test(ref);
const firstOf = (ref: string) => /^d\d+a/.test(ref);
const unpairedOf = (ref: string) => /^d\d+(\.\d+)?$/.test(ref);
const hashed = (ref: string, below: number) => createHash("sha256").update(ref).digest()[0]! < below;
/** Planted yields that a run fills on: about one draft in five fails, by its reference alone. */
const SOME = (ref: string) => hashed(ref, 52);

function depsOf(o: { fails?: (ref: string) => boolean; hang?: (label: string) => boolean; label?: AuthorDeps["label"]; usd?: number } = {}) {
  const call = runCaller({ fails: o.fails, hang: o.hang });
  const m = fakeMeter(call, o.usd ? (r) => ({ first: 0.887, second: 0.093, unpaired: 0.545 })[r] * o.usd! : undefined);
  return { deps: { call: m.call, label: o.label ?? wordLabeller(), parse: fixtureParser, screen: FIXTURE_SCREEN, spent: m.spent, spentOn: m.spentOn } satisfies AuthorDeps, call };
}
const go = (o: Parameters<typeof depsOf>[0] & { cap?: number; concurrency?: number; reuse?: Reuse; journal?: Journal; resume?: Checkpoint } = {}) =>
  authorRun(depsOf(o).deps, { cap: o.cap ?? CAPS.authoring, concurrency: o.concurrency ?? 8, reuse: o.reuse ?? REUSE, journal: o.journal, resume: o.resume });
const all = (r: AuthorRun) => [...r.sets.calibration, ...r.sets.comparison, ...r.sets.reserve];
const placedSet = (r: AuthorRun) => all(r).map((m) => m.id + " " + m.digest).sort();
const throwsOn = (match: (label: string) => boolean, err: () => Error) => {
  const base = wordLabeller();
  return Object.assign(async (req: Parameters<typeof base>[0]) => {
    if (match(req.label)) throw err();
    return base(req);
  }, { calls: base.calls });
};

describe("each slot's draws follow a fixed sequence (section 5.1)", () => {
  test("the k-th first-twin or unpaired draft is draw 1000 * (p + 1) + k from the family p + k names, and a second twin takes its partner's draw and family", async () => {
    const r = await go({ fails: SOME });
    expect(r.stopped).toBe("quotas");
    for (const s of SLOTS) {
      const mine = r.outcomes.filter((x) => x.slot === s.slot);
      mine.filter((x) => x.role !== "second").forEach((x, i) => expect([x.draw, x.author]).toEqual([drawOf(s.p, i + 1), familyOf(s.p, i + 1)]));
      for (const x of mine.filter((y) => y.role === "second")) {
        const partner = mine.find((y) => y.id === x.id.replace(/b$/, "a"))!;
        expect([x.draw, x.author]).toEqual([partner.draw, partner.author]);
      }
    }
    expect(r.outcomes.every((x) => x.draw > 1000)).toBe(true);
    expect(new Set(all(r).map((m) => m.id)).size).toBe(96);
  });
  test("the same draws whatever the concurrency: 1, 3 and 8 place the same briefs", async () => {
    const sets = await Promise.all([1, 3, 8].map(async (c) => placedSet(await go({ fails: SOME, concurrency: c }))));
    expect(sets[0]).toHaveLength(96);
    expect(sets[1]).toEqual(sets[0]!);
    expect(sets[2]).toEqual(sets[0]!);
  });
});

describe("the top-up bound (section 5.3)", () => {
  const slot = SLOTS.find((s) => s.kind === "pair" && s.set === "comparison" && !REUSED_SLOTS.includes(s.slot))!;
  test("a partner gets 30 second twins, as the Captain ruled on 2026-11-18; when all fail it drops, unplaced, and its slot draws its next first twin", async () => {
    const first = "d" + drawOf(slot.p, 1);
    const r = await go({ fails: (ref) => ref.startsWith(first + "b") });
    const mine = r.outcomes.filter((x) => x.slot === slot.slot);
    expect(mine.map((x) => x.role + ":" + x.draw + ":" + x.attempt + ":" + x.status)).toEqual([
      "first:" + drawOf(slot.p, 1) + ":1:pass",
      ...Array.from({ length: 30 }, (_, i) => "second:" + drawOf(slot.p, 1) + ":" + (i + 1) + ":drop"),
      "first:" + drawOf(slot.p, 2) + ":1:pass",
      "second:" + drawOf(slot.p, 2) + ":1:pass",
    ]);
    expect(TOP_UP_BOUND).toBe(30);
    expect(all(r).some((m) => m.id === first + "a")).toBe(false);
    expect(summaryOf(r).second_twins.dropped_at_bound).toBe(1);
    expect(countsOf(r.outcomes).partners[slot.type]![1]).toBe(r.outcomes.filter((x) => x.role === "second" && bySlot.get(x.slot)!.type === slot.type && (x.status === "pass" || x.attempt === TOP_UP_BOUND)).length);
  });
});

describe("the pilot (section 5.4)", () => {
  const main = SLOTS.filter((s) => s.set !== "reserve" && !REUSED_SLOTS.includes(s.slot));
  const pilotPairs = PAIRED_TYPES.flatMap((t) => main.filter((s) => s.type === t).slice(0, PILOT.pair_slots).map((s) => s.slot));
  const prefix = (r: AuthorRun) => r.outcomes.slice(0, r.outcomes.findIndex((x) => !x.pilot));
  test("comes first, after the reused briefs: two open slots of each pair type, each settling one partner, and 8 drafts a kind or the kind's open slots", async () => {
    const r = await go();
    const p = prefix(r);
    expect(r.outcomes.slice(p.length).every((x) => !x.pilot)).toBe(true);
    expect([...new Set(p.filter((x) => x.role !== "unpaired").map((x) => x.slot))].sort()).toEqual([...pilotPairs].sort());
    for (const slot of pilotPairs) expect(p.filter((x) => x.slot === slot).map((x) => x.role)).toEqual(["first", "second"]);
    const kind = (u: string) => p.filter((x) => kindOf(bySlot.get(x.slot)!) === u);
    expect([kind("T7").length, kind("T8").length, kind("builder").length]).toEqual([3, 5, 8]);
    expect(kind("builder").map((x) => x.slot)).toEqual(main.filter((s) => s.kind === "builder").slice(0, 8).map((s) => s.slot));
    expect(r.outcomes.some((x) => REUSED_SLOTS.includes(x.slot))).toBe(false);
  });
  test("a slot that fails stops at 3 first twins, and a kind with fewer open slots than 8 drafts takes its slots in turn", async () => {
    const pairSlot = bySlot.get(pilotPairs[0]!)!;
    const r = await go({ fails: (ref) => (firstOf(ref) && slotOfRef(ref).slot === pairSlot.slot) || (unpairedOf(ref) && slotOfRef(ref).type === "T7") });
    const p = prefix(r);
    expect(p.filter((x) => x.slot === pairSlot.slot).map((x) => x.role + ":" + x.status)).toEqual(["first:drop", "first:drop", "first:drop"]);
    const t7 = main.filter((s) => s.type === "T7").map((s) => p.filter((x) => x.slot === s.slot).length);
    expect(t7).toEqual([3, 3, 2]);
    expect(r.outcomes.filter((x) => x.slot === pairSlot.slot && !x.pilot).length).toBeGreaterThan(0);
  });
});

describe("the projection stop (section 5.5)", () => {
  test("at the first attempt's counts alone, T8 at T7's counts and scale 1, the first projection is sizing.txt's $127.52", () => {
    const open = { pairs: { T1: 4, T2: 3, T3: 3, T4: 3, T5: 4, T6: 3 }, unpaired: { T7: 3, T8: 5, builder: 21 } };
    expect(projection({ ...ATTEMPT_1, unpaired: { ...ATTEMPT_1.unpaired, T8: ATTEMPT_1.unpaired.T7 } }, open, 1).toFixed(2)).toBe("127.52");
    const left = SLOTS.filter((s) => s.set !== "reserve" && !REUSED_SLOTS.includes(s.slot));
    expect(Object.fromEntries(PAIRED_TYPES.map((t) => [t, left.filter((s) => s.kind === "pair" && s.type === t).length]))).toEqual(open.pairs);
    expect(Object.fromEntries((["T7", "T8", "builder"] as const).map((u) => [u, left.filter((s) => kindOf(s) === u).length]))).toEqual(open.unpaired);
  });
  test("its room is the cap less the committed spend less 8 drafts at $3.50, and its costs scale by spend over what the first attempt's figures predict", () => {
    const counts = { first: [0, 0], partners: {}, matched_draws: [0, 0], unpaired: { T7: [0, 0], T8: [0, 0], builder: [0, 0] } } as const;
    const open = { pairs: { T1: 1 }, unpaired: { T7: 0, T8: 0, builder: 0 } };
    const one = readProjection({ counts, open, spend: 2, predicted: 1, cap: 409, committed: 31, drafts: 4 });
    expect(one.room).toBe(409 - 31 - 28);
    expect(one.scale).toBe(2);
    expect(one.projection).toBeCloseTo(2 * readProjection({ counts, open, spend: 1, predicted: 1, cap: 409, committed: 31, drafts: 4 }).projection, 10);
  });
  test("planted yields that go: every read fits, and calibration, comparison and then reserves fill", async () => {
    const r = await go({ fails: SOME });
    expect(r.reads.length).toBeGreaterThan(1);
    expect(r.reads.every((x) => !x.stop)).toBe(true);
    expect([r.stopped, r.full, all(r).length, haltOf(r, mdd)]).toEqual(["quotas", true, 96, null]);
  });
  test("planted yields that stop: T1 and T4 never match and unpaired briefs rarely pass, so the projection ends authoring INCOMPLETE before the cap", async () => {
    const r = await go({ fails: (ref) => (twinOf(ref) && ["T1", "T4"].includes(slotOfRef(ref).type)) || (unpairedOf(ref) && hashed(ref, 200)) });
    const last = r.reads.at(-1)!;
    expect([r.stopped, r.full, last.stop]).toEqual(["projection", false, true]);
    expect(last.projection).toBeGreaterThan(last.room);
    expect(r.reads.slice(0, -1).every((x) => !x.stop)).toBe(true);
    const e = haltOf(r, mdd)!;
    expect(e.code).toBe("E_OHR_PROJECTION_STOP");
    expect(e.message).toContain("partners matched T1 0/");
    expect(e.message).toContain(all(r).length + " of 96 briefs placed");
    expect(last.committed).toBeLessThan(CAPS.authoring - 28);
  });
});

describe("order and the end of authoring (section 5.6)", () => {
  test("reserves draw only after calibration and comparison are full", async () => {
    const r = await go({ fails: SOME });
    const last = r.outcomes.map((x) => bySlot.get(x.slot)!.set !== "reserve").lastIndexOf(true);
    const first = r.outcomes.findIndex((x) => bySlot.get(x.slot)!.set === "reserve");
    expect(first).toBeGreaterThan(last);
    expect(r.sets.reserve).toHaveLength(8);
  });
  test("a slot that never passes stops before its 1,000th first twin, so its draw numbers never reach the next slot's, and authoring ends short", async () => {
    const slot = SLOTS.find((s) => s.kind === "pair" && s.set === "comparison" && !REUSED_SLOTS.includes(s.slot))!;
    const r = await go({ fails: (ref) => firstOf(ref) && slotOfRef(ref).slot === slot.slot, usd: 0.001 });
    const mine = r.outcomes.filter((x) => x.slot === slot.slot);
    expect([r.stopped, r.full, mine.length, mine.at(-1)!.draw, SLOT_DRAWS]).toEqual(["schedule", false, 999, drawOf(slot.p, 999), 999]);
    expect(haltOf(r, mdd)!.code).toBe("E_OHR_SUPPLY_SHORT");
  });
  const reserveDraft = (label: string) => /^d\d+/.test(label) && slotOfRef(label).set === "reserve";
  test("a cap stop after calibration and comparison are full ends authoring without a halt, with the reserves it placed", async () => {
    const r = await go({ label: throwsOn((l) => reserveDraft(l) && l.includes(":unanimous:"), () => new MeterError("CAP_STOP", "brief label: the ledger refused the call")) });
    expect([r.stopped, r.full, r.halt?.code]).toEqual(["cap", true, "CAP_STOP"]);
    expect(haltOf(r, mdd)).toBeNull();
    expect(r.sets.reserve.length).toBeLessThan(8);
    expect(r.sets.calibration.length + r.sets.comparison.length).toBe(88);
  });
  test("a cap stop before they are full halts as before, and so does a batch the cap cannot cover", async () => {
    const r = await go({ label: throwsOn((l) => /^d\d+/.test(l) && slotOfRef(l).set === "comparison" && !r0.has(l.split(":")[0]!), () => new MeterError("CAP_STOP", "brief label: the ledger refused the call")) });
    expect([r.stopped, r.full, haltOf(r, mdd)!.code]).toEqual(["cap", false, "CAP_STOP"]);
    const small = await go({ cap: 3 });
    expect([small.stopped, haltOf(small, mdd)!.code]).toEqual(["cap", "E_OHR_SUPPLY_SHORT"]);
    expect(haltOf(small, mdd)!.message).toContain("of 96 briefs placed");
  });
  test("a stop that is not about money halts the run even after calibration and comparison are full", async () => {
    const r = await go({ label: throwsOn((l) => reserveDraft(l) && l.includes(":unanimous:"), () => new MeterError("E_OHR_MODEL_DRIFT", "brief label: the reply names another model")) });
    expect([r.stopped, r.full, haltOf(r, mdd)!.code]).toEqual(["halt", true, "E_OHR_MODEL_DRIFT"]);
    await expect(go({ label: throwsOn((l) => reserveDraft(l), () => new TypeError("not a stop")) })).rejects.toThrow("not a stop");
  });
});
const r0 = new Set<string>();

describe("the outcome log and resume (section 5.2)", () => {
  const journalTo = (dir: string) => sealedJournal({ dir, work: join(temp("/dev/shm/ohr-journal-"), "w"), sealer: fakeSealer });
  test("every settled draft is sealed with its spend before the run counts it, and the log and placed briefs after every batch", async () => {
    const dir = temp(join(tmpdir(), "ohr-ckpt-"));
    const sealed: number[] = [];
    const j = journalTo(dir);
    const r = await go({ fails: SOME, journal: { record: (e) => (sealed.push(e.seq), j.record(e)), checkpoint: j.checkpoint } });
    expect(sealed).toEqual(r.outcomes.map((x) => x.seq));
    for (const x of r.outcomes) expect(x.spend).toBeCloseTo({ first: 0.887, second: 0.093, unpaired: 0.545 }[x.role], 9);
    const names = readdirSync(dir);
    expect(names.filter((n) => n.startsWith("draft-"))).toHaveLength(r.outcomes.length);
    expect(names).toContain("checkpoint-000000.age");
    expect(names).toContain("checkpoint-" + String(r.outcomes.length).padStart(6, "0") + ".age");
    const back = readJournal(join(dir, "checkpoint-000000.age"), fakeDecrypter, join(temp("/dev/shm/ohr-open-"), "w"));
    expect(back.log.map((x) => x.id)).toEqual(r.outcomes.map((x) => x.id));
    expect(back.reuse.placed).toHaveLength(19);
    expect(readdirSync("/dev/shm").some((n) => n.includes(".open-"))).toBe(false);
  });
  test("a run stopped between a draft's completion and its batch's seal, resumed at another concurrency, requests no sealed draft again and places what an uninterrupted run places", async () => {
    const whole = await go({ fails: SOME, concurrency: 8 });
    const dir = temp(join(tmpdir(), "ohr-ckpt-"));
    const target = whole.outcomes[60]!;
    const hungRef = target.id + (target.attempt > 1 ? "." + target.attempt : "");
    let hung = false;
    const first = depsOf({ fails: SOME, hang: (l) => l === hungRef + ":author:1" && (hung = true) });
    void authorRun(first.deps, { cap: CAPS.authoring, concurrency: 8, reuse: REUSE, journal: journalTo(dir) });
    while (!hung) await new Promise((r) => setTimeout(r, 1));
    await new Promise((r) => setTimeout(r, 50));
    const names = readdirSync(dir);
    const records = names.filter((n) => n.startsWith("draft-")).length;
    const checkpoints = names.filter((n) => n.startsWith("checkpoint-")).sort();
    const newest = Number(/(\d{6})/.exec(checkpoints.at(-1)!)![1]);
    expect(records).toBeGreaterThan(newest);
    const resumed = readJournal(join(dir, checkpoints.at(-1)!), fakeDecrypter, join(temp("/dev/shm/ohr-open-"), "w"));
    expect(resumed.log).toHaveLength(records);
    const sealedRefs = new Set(resumed.log.map((x) => x.id + (x.attempt > 1 ? "." + x.attempt : "")));
    expect(sealedRefs.has(hungRef)).toBe(false);
    const second = depsOf({ fails: SOME });
    const r = await authorRun(second.deps, { cap: CAPS.authoring, concurrency: 3, resume: resumed, journal: journalTo(dir) });
    const asked = second.call.calls.filter((c) => /:author:1$/.test(c.label)).map((c) => c.label.split(":")[0]!);
    expect(asked.filter((ref) => sealedRefs.has(ref))).toEqual([]);
    expect(asked).toContain(hungRef);
    expect(r.stopped).toBe("quotas");
    expect(placedSet(r)).toEqual(placedSet(whole));
    expect(r.outcomes.slice(0, records).map((x) => x.id)).toEqual(resumed.log.map((x) => x.id));
  });
  test("a resume refuses a gap in the sealed draft records", async () => {
    const dir = temp(join(tmpdir(), "ohr-ckpt-"));
    await go({ fails: SOME, journal: journalTo(dir) });
    unlinkSync(join(dir, "draft-000005.age"));
    expect(() => readJournal(join(dir, "checkpoint-000000.age"), fakeDecrypter, join(temp("/dev/shm/ohr-open-"), "w"))).toThrow("E_OHR_RESUME");
  });
});

describe("reuse (section 4)", () => {
  const tampered = PLACED.find((x) => x.role === "unpaired" && bySlot.get(x.slot)!.kind === "builder")!;
  const planted = () => {
    const dir = join(temp(join(tmpdir(), "ohr-first-")), "plain");
    const stray: Outcome = { ...PLACED.find((x) => x.role === "unpaired" && bySlot.get(x.slot)!.type === "T7")!, id: "d90", slot: "com1-T7" };
    writeFirstAttempt(dir, [...PLACED, stray], (x) => metaOf(bySlot.get(x.slot) ?? SLOTS.find((s) => s.type === "T7")!, x), [{ ...PLACED[0]!, id: "d91a", status: "drop", step: "audit" }]);
    writeFileSync(join(dir, "briefs", tampered.id, "opening.md"), tampered.files!.opening + "One more line.\n");
    const sealed = join(dir, "..", "authoring.tar.age");
    fakeSealer(dir, sealed);
    return sealed;
  };
  test("places each brief whose files match its recorded digest in a reused slot, and lists the rest", () => {
    const r = readReuse(planted(), fakeDecrypter, join(temp("/dev/shm/ohr-reuse-"), "w"));
    expect(r.placed.map((x) => x.id).sort()).toEqual(PLACED.filter((x) => x.id !== tampered.id).map((x) => x.id).sort());
    expect(r.failed.map((f) => f.id + " " + f.why).sort()).toEqual(["d90 its slot com1-T7 is not one of the reused slots", tampered.id + " its files do not match its recorded digest"].sort());
    expect(new Set(r.answers.map((a) => a.brief))).toEqual(new Set(r.placed.map((x) => x.id)));
    expect(readdirSync("/dev/shm").some((n) => n.includes(".open-reuse"))).toBe(false);
  });
  test("the 18 that pass are placed before the pilot, and the brief that failed is drafted again in its slot", async () => {
    const reuse = readReuse(planted(), fakeDecrypter, join(temp("/dev/shm/ohr-reuse-"), "w"));
    const r = await go({ reuse });
    const kept = new Set(reuse.placed.map((x) => x.slot));
    expect(r.outcomes.some((x) => kept.has(x.slot))).toBe(false);
    const again = r.outcomes.filter((x) => x.slot === tampered.slot);
    expect(again[0]!.draw).toBe(drawOf(bySlot.get(tampered.slot)!.p, 1));
    expect(all(r).filter((m) => reuse.placed.some((x) => x.id === m.id))).toHaveLength(18);
    expect([r.stopped, all(r).length, summaryOf(r).reused.placed]).toEqual(["quotas", 96, 18]);
    expect(summaryOf(r).reused.failed.map((f) => f.id).sort()).toEqual(["d90", tampered.id].sort());
  });
});

describe("answers for the judge check", () => {
  test("every placed brief hands over its three full-information blocks, and unpaired briefs their three opening-only blocks, reused briefs from their recorded answers", async () => {
    const r = await go();
    const a = checkAnswers(r);
    const unpaired = all(r).filter((m) => m.kind !== "pair").length;
    expect(a.filter((x) => x.source === "full")).toHaveLength(96 * 3);
    expect(a.filter((x) => x.source === "opening")).toHaveLength(unpaired * 3);
    expect(a.filter((x) => REUSE.placed.some((y) => y.id === x.brief))).toEqual(REUSE.answers);
    expect(new Set(a.map((x) => x.author))).toEqual(new Set(["opus", "sol", "astra"]));
  });
  test("the summary holds counts and digests only", async () => {
    const s = summaryOf(await go());
    expect(s.placed).toBe(96);
    expect(JSON.stringify(s)).not.toContain("bridal");
  });
});
