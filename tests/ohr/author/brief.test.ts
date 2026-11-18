// Value: protects=section 3's validation of one draft: the unanimous key with cross-family judges, the give-away screen for unpaired briefs only, the blind audit, the probe, the generic screen, the one rewrite, digest binding and twins from the pair's family.
import { describe, expect, test } from "bun:test";
import type { CallRequest } from "../../../lanes/product-value/meter.ts";
import { runDraft, type Partner } from "../../../lanes/office-hours-rewrite/author/brief.ts";
import { schedule, type Slot } from "../../../lanes/office-hours-rewrite/author/draws.ts";
import { digestOf, type BriefFiles } from "../../../lanes/office-hours-rewrite/author/files.ts";
import { BUILDER, FIRST, FIRST_TWIN_CALL, FIXTURE_SCREEN, SECOND, T7, T8, blockReply, builderFor, fixtureParser, happy, stubCaller, wordLabeller } from "../../../lanes/office-hours-rewrite/author/fixtures.ts";
import { ANSWER_NOW, FACTS_LINE, PROBE_REWRITE, REQUEST, fullInformation, openingOnly, priorLine } from "../../../lanes/office-hours-rewrite/author/prompts.ts";
import { firstMessage } from "../../../lanes/office-hours-rewrite/frozen.ts";
import type { Labeller } from "../../../lanes/office-hours-rewrite/types.ts";

const slots = schedule();
const pairSlot = slots.find((s) => s.kind === "pair")!;
const t7Slot = slots.find((s) => s.type === "T7")!;
const t8Slot = slots.find((s) => s.type === "T8")!;
const builderSlot = slots.find((s) => s.kind === "builder")!;

type Route = (req: CallRequest) => string | null | undefined;
function deps(briefs: Record<string, BriefFiles>, over: Route = () => undefined, label: Labeller = wordLabeller()) {
  const route = happy(briefs, { d1a: FIRST_TWIN_CALL });
  const call = stubCaller((req) => {
    const o = over(req);
    return o === undefined ? route(req) : o;
  });
  return { call, label, parse: fixtureParser, screen: FIXTURE_SCREEN };
}
const run = (slot: Slot, b: BriefFiles, d = deps({ d1: b, d1a: b }), draw = 1) => runDraft(slot, slot.kind === "pair" ? "first" : "unpaired", { draw, attempt: 1, author: draw % 2 ? "sol" : "argon", pilot: false, partner: null }, d);
const partner: Partner = { id: "d1a", files: FIRST, twin_call: FIRST_TWIN_CALL };
const runSecond = (d: ReturnType<typeof deps>, attempt = 1, author: "sol" | "argon" = "sol") => runDraft(pairSlot, "second", { draw: 1, attempt, author, pilot: false, partner }, d);

describe("prompts", () => {
  test("full information is the none arm's first message, the facts, the closing request and the answer-now line", () => {
    const p = fullInformation(T7.opening, ["a", "b"], null);
    expect(p.startsWith(firstMessage("none", T7.opening) + "\n\n" + FACTS_LINE + "\n- a\n- b\n\n")).toBe(true);
    expect(p.endsWith(REQUEST + "\n" + ANSWER_NOW)).toBe(true);
    expect(REQUEST.split("\n")).toHaveLength(4);
    expect(openingOnly(T7.opening, null)).toBe(firstMessage("none", T7.opening) + "\n\n" + REQUEST + "\n" + ANSWER_NOW);
  });
  test("T8's prior session reaches both validator prompts", () => {
    expect(fullInformation(T8.opening, ["a"], T8.prior)).toContain(priorLine(T8.prior!));
    expect(openingOnly(T8.opening, T8.prior)).toContain(priorLine(T8.prior!));
  });
  test("every author prompt ends with the draft's reference line, so no two drafts send one request", async () => {
    const d = deps({ d1: T7, d3: T7 });
    await run(t7Slot, T7, d, 1);
    await run(t7Slot, T7, d, 3);
    const authors = d.call.calls.filter((c) => /:author:1$/.test(c.label));
    expect(authors.map((c) => c.prompt.split("\n").at(-1))).toEqual(["Brief reference: d1.", "Brief reference: d3."]);
  });
});

describe("unanimous key", () => {
  test("3 of 3 make the call and name an action: pass; judges come from the other family", async () => {
    const lab = wordLabeller();
    const o = await run(pairSlot, FIRST, deps({ d1a: FIRST }, undefined, lab));
    expect(o.status).toBe("pass");
    const u = lab.calls.filter((c) => c.label.includes(":unanimous:"));
    expect(Object.fromEntries(u.map((c) => [c.label.split(":")[2], c.judge]))).toEqual({ opus: "astra", sol: "opus", astra: "opus" });
    expect(u[0]!.items).toEqual({ call: FIRST.key.call, actions: FIRST.key.actions, contrast: FIRST_TWIN_CALL });
  });
  test("one validator missing the call drops the brief as not unanimous", async () => {
    const o = await run(t7Slot, T7, deps({ d1: T7 }, undefined, wordLabeller((req) => (req.judge === "astra" && req.label.includes(":unanimous:") ? { decision: false } : undefined))));
    expect([o.status, o.reason]).toEqual(["drop", "not unanimous"]);
  });
  test("one validator naming no acceptable action drops it too", async () => {
    const o = await run(t7Slot, T7, deps({ d1: T7 }, undefined, wordLabeller((req) => (req.label.includes(":unanimous:sol") ? { action: false } : undefined))));
    expect(o.reason).toBe("not unanimous");
  });
  test("a validator with no block is asked once more; a second miss drops the brief", async () => {
    const once = await run(t7Slot, T7, deps({ d1: T7 }, (r) => (r.label === "d1:unanimous:sol:1" ? "no block here" : undefined)));
    expect(once.status).toBe("pass");
    const twice = await run(t7Slot, T7, deps({ d1: T7 }, (r) => (r.label.startsWith("d1:unanimous:sol") ? "no block here" : undefined)));
    expect([twice.status, twice.step]).toEqual(["drop", "unanimous"]);
  });
});

describe("give-away screen", () => {
  test("an unpaired brief no validator can call from the opening passes", async () => {
    for (const [slot, b] of [[t7Slot, T7], [t8Slot, T8], [builderSlot, builderFor(builderSlot.type as never)]] as const) {
      const o = await run(slot, b, deps({ d1: b }));
      expect([o.id, o.status]).toEqual(["d1", "pass"]);
    }
  });
  test("one validator making the call from the opening alone drops it", async () => {
    const o = await run(t7Slot, T7, deps({ d1: T7 }, (r) => (r.label === "d1:give-away:astra:1" ? blockReply(T7.key.call, "x") : undefined)));
    expect([o.status, o.reason]).toEqual(["drop", "given away"]);
  });
  test("twins pass by construction: a pair's first twin sends no opening-only prompt", async () => {
    const d = deps({ d1a: FIRST });
    await run(pairSlot, FIRST, d);
    expect(d.call.calls.some((c) => c.label.includes(":give-away:"))).toBe(false);
  });
});

describe("the one rewrite", () => {
  test("a vocabulary hit goes back once with the hit words, and the rewrite passes", async () => {
    let n = 0;
    const bad = { ...T7, opening: T7.opening + " Which neighbor would lend you a hand?\n" };
    const o = await run(t7Slot, T7, deps({ d1: T7 }, (r) => (/:author:1$/.test(r.label) && n++ === 0 ? happy({ d1: bad })(r) : undefined)));
    expect([o.status, o.rewrites]).toEqual(["pass", 1]);
    expect(o.checks.filter((c) => c.void).map((c) => c.step)).toEqual(["vocabulary"]);
    expect(o.checks.filter((c) => !c.void).every((c) => c.digest === digestOf(o.files!))).toBe(true);
  });
  test("an audit failure after the rewrite drops: one rewrite in all", async () => {
    const fail = '{"a": "pass", "b": "fail", "c": "pass", "d": "pass", "e": "pass", "f": "pass"}';
    const o = await run(t7Slot, T7, deps({ d1: T7 }, (r) => (r.label.includes(":audit:") ? fail : undefined)));
    expect([o.status, o.step, o.rewrites]).toEqual(["drop", "audit", 1]);
  });
  test("an unreadable audit (Argon's, for a Sol-written brief) fails every check", async () => {
    const o = await run(t7Slot, T7, deps({ d1: T7 }, (r) => (r.label.includes(":audit:gemini") ? "hmm" : undefined)));
    expect(o.checks.find((c) => c.step === "audit")!.detail).toBe("failed checks a, b, c, d, e, f");
  });
  test("a recognition hit goes back with the probe line and the slot's industry", async () => {
    const d = deps({ d1: T7 }, (r) => (r.label.includes(":probe:opus:opening") && !r.label.includes("judge") ? "Maybe Acme Upholstery." : r.label.includes(":judge:") && r.label.includes("probe:opus:opening") ? '{"matches": ["Acme Upholstery"]}' : undefined));
    const o = await run(t7Slot, T7, d);
    expect([o.status, o.step]).toEqual(["drop", "probe"]);
    expect(d.call.calls.find((c) => c.label.endsWith(":rewrite:1"))!.prompt.endsWith(PROBE_REWRITE.replace("<industry>", t7Slot.industry))).toBe(true);
  });
});

describe("generic screen", () => {
  test("no stock row credited passes; a credited stock row drops the brief", async () => {
    expect((await run(t7Slot, T7)).status).toBe("pass");
    const o = await run(t7Slot, T7, deps({ d1: T7 }, undefined, wordLabeller((req, id) => (req.label.includes(":generic:opus") && id === "b2" ? { action: true } : undefined))));
    expect([o.status, o.step]).toEqual(["drop", "generic"]);
  });
});

describe("second twins", () => {
  test("pass against the partner, keep its opening, and are written by the pair's family", async () => {
    const d = deps({ d1b: SECOND });
    const o = await runSecond(d, 2, "argon");
    expect([o.id, o.status, o.files!.opening === FIRST.opening]).toEqual(["d1b", "pass", true]);
    expect(d.call.calls.find((c) => c.label === "d1b.2:author:1")!.model).toBe("gemini");
    expect(o.files!.key.twin).toBe("d1a");
  });
  test("a second twin that changes a non-decisive fact drops at the twin check", async () => {
    const bad = { ...SECOND, sheet: { ...SECOND.sheet, facts: SECOND.sheet.facts.map((f) => (f.id === "F9" ? { ...f, text: "It runs on paper." } : f)) } };
    const o = await runSecond(deps({ d1b: bad }));
    expect([o.status, o.step]).toEqual(["drop", "twin"]);
  });
  test("a second twin's contrast is its partner's call", async () => {
    const lab = wordLabeller();
    await runSecond(deps({ d1b: SECOND }, undefined, lab));
    expect(lab.calls.find((c) => c.label.includes(":unanimous:"))!.items.contrast).toBe(FIRST.key.call);
  });
});

test("the builder fixture passes for its own goal", async () => {
  expect((await run(builderSlot, builderFor(builderSlot.type as never), deps({ d1: builderFor(builderSlot.type as never) }))).status).toBe("pass");
  expect(BUILDER.key.traction).toBe(false);
});
