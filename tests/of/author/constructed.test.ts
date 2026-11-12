// Value: protects=the constructed-unit pipeline of section 3: author output, the order of checks, rewrites, the twin skin and the type labels.
import { describe, expect, test } from "bun:test";
import { typeLabels } from "../../../lanes/office-hours-founder/author/checks.ts";
import { nextIndustry, runConstructed, runTwin } from "../../../lanes/office-hours-founder/author/constructed.ts";
import { schedule } from "../../../lanes/office-hours-founder/author/draws.ts";
import { FIXTURE, FIXTURE_ASKS, authorReply, happy, stubCaller, wordLabeller } from "../../../lanes/office-hours-founder/author/fixtures.ts";
import { CEILING_LINE, TWIN_NOTE } from "../../../lanes/office-hours-founder/author/prompts.ts";
import { vocabulary } from "../../../lanes/office-hours-founder/author/screens.ts";
import type { CallRequest } from "../../../lanes/product-value/meter.ts";

const screen = vocabulary(FIXTURE_ASKS);
const DRAW = schedule(1)[0]!;
const deps = (over: (r: CallRequest) => string | null | undefined = () => undefined, label = wordLabeller()) => {
  const route = happy(FIXTURE);
  return { call: stubCaller((r) => over(r) ?? route(r)), label, screen };
};

describe("runConstructed", () => {
  test("a clean unit passes every step in order, with the meta and the check record", async () => {
    const d = deps();
    const o = await runConstructed(DRAW, d, { ceiling: false });
    expect(o.status).toBe("pass");
    expect(o.checks.map((c) => c.step)).toEqual(["vocabulary", "unanimous", "give-away", "audit", "probe", "generic", "type"]);
    expect(o.meta).toMatchObject({ id: "c1", stratum: "constructed", draw: 1, author: "sol", shape: DRAW.shape, industry: DRAW.industry, type: "B2B", founder_stage: "has users", primary: ["customer", "wedge"], generic: [] });
    expect(Object.keys(o.record)).toEqual(["validators", "audit", "probe", "generic_unlabelled", "type_votes"]);
    const audits = d.call.calls.filter((c) => /:audit:/.test(c.label));
    expect(audits.map((c) => [c.model, c.effort])).toEqual([["opus", "high"], ["gemini", "high"]]);
    const validators = d.call.calls.filter((c) => /:unanimous:/.test(c.label));
    expect(validators.map((c) => c.model).sort()).toEqual(["astra", "opus", "sol"]);
    expect(validators.every((c) => c.effort === "medium" && c.prompt.includes("Here is everything else I know:"))).toBe(true);
    expect(d.label.calls.filter((c) => /:unanimous:/.test(c.label)).map((c) => c.judge + "<" + c.blocks[0]!.id).sort()).toEqual(["astra<opus", "opus<astra", "opus<sol"]);
    expect(d.call.calls.filter((c) => /:probe:[a-z]+:(opening|full):\d$/.test(c.label))).toHaveLength(10);
  });
  test("an author reply without the three files is asked once more, then the draw drops", async () => {
    const d = deps((r) => (/:author:/.test(r.label) ? authorReply({ opening: FIXTURE.opening }) : undefined));
    const o = await runConstructed(DRAW, d, { ceiling: false });
    expect(o).toMatchObject({ status: "drop", step: "author" });
    expect(d.call.calls.map((c) => c.label)).toEqual(["c1:author:1", "c1:author:2"]);
  });
  test("an audit reply that cannot be read fails every check", async () => {
    const o = await runConstructed(DRAW, deps((r) => (/:audit:opus/.test(r.label) ? "Looks fine to me." : undefined)), { ceiling: false });
    expect(o).toMatchObject({ status: "drop", step: "audit", reason: "failed checks a, b, c, d, e", rewrites: 1 });
  });
  test("an unlabelled W cell is retried with a fresh validator call", async () => {
    let n = 0;
    const label = wordLabeller((judge, id) => (id === "sol" && n++ === 0 ? { wedge: null } : undefined));
    const o = await runConstructed(DRAW, deps(undefined, label), { ceiling: false });
    expect(o.status).toBe("pass");
    expect(label.calls.filter((c) => /:unanimous:sol:/.test(c.label))).toHaveLength(2);
  });
  test("the CEILING variant writes under the harder prompt with h ids", async () => {
    const d = deps();
    const o = await runConstructed(DRAW, d, { ceiling: true });
    expect(o.id).toBe("h1");
    expect(d.call.calls[0]!.prompt.endsWith(" " + CEILING_LINE)).toBe(true);
  });
});

describe("runTwin", () => {
  test("the other family translates into the next industry with the twin note and the skin passes the checks", async () => {
    const first = await runConstructed(DRAW, deps(), { ceiling: false });
    const d = deps();
    const t = await runTwin(first, d);
    expect(d.call.calls[0]!.model).toBe("gemini");
    expect(d.call.calls[0]!.prompt).toContain(nextIndustry(DRAW.industry) + ". " + TWIN_NOTE);
    expect(t.meta).toMatchObject({ id: "c1t", author: "argon", industry: nextIndustry(DRAW.industry), twin_of: "c1", draw: 1 });
  });
  test("a skin that changes the fact ids leaves the twin check, with no rewrite", async () => {
    const first = await runConstructed(DRAW, deps(), { ceiling: false });
    const moved = { ...FIXTURE, sheet: { ...FIXTURE.sheet, facts: FIXTURE.sheet.facts.map((f, k) => (k === 9 ? { ...f, id: "F11" } : f)) } };
    const t = await runTwin(first, deps((r) => (/:twin/.test(r.label) ? authorReply(moved) : undefined)));
    expect(t).toMatchObject({ status: "drop", step: "twin", rewrites: 0 });
  });
  test("the last industry wraps to the first", () => {
    expect(nextIndustry("film production")).toBe("dental practices");
  });
});

describe("typeLabels", () => {
  test("Argon settles a split between Opus and Sol", async () => {
    const d = deps((r) => (/:type:sol/.test(r.label) ? '{"type": "consumer", "stage": "has users"}' : /:type:gemini/.test(r.label) ? '{"type": "marketplace", "stage": "pre-product"}' : undefined));
    expect(await typeLabels("c1", FIXTURE, d)).toMatchObject({ type: "marketplace", stage: "has users" });
  });
  test("agreement needs no settling call", async () => {
    const d = deps();
    await typeLabels("c1", FIXTURE, d);
    expect(d.call.calls.some((c) => /:type:gemini/.test(c.label))).toBe(false);
  });
});
