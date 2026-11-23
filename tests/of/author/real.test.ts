// Value: protects=the real-history stratum: the frame, the two-check terms gate, the serial miner, the notes, the writers' rewrites, fame terciles and cutoff marks.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FIXTURE_ASKS, REAL_FILES, REAL_NOTES, REAL_PAGE, authorReply, happy, stubCaller, wordLabeller } from "../../../lanes/office-hours-founder/author/fixtures.ts";
import { cutoffMarks, excluded, forbiddingClause, frame, pageviews, readNotes, robotsAllows, robotsRules, runReal, serial, terciles, type Fetch, type Notes, type Page } from "../../../lanes/office-hours-founder/author/real.ts";
import { vocabulary } from "../../../lanes/office-hours-founder/author/screens.ts";
import type { CallRequest } from "../../../lanes/product-value/meter.ts";

const deps = (over: (r: CallRequest) => string | null | undefined = () => undefined) => {
  const route = happy(REAL_FILES, true);
  return { call: stubCaller((r) => over(r) ?? route(r)), label: wordLabeller(), screen: vocabulary(FIXTURE_ASKS) };
};
const PAGES: Page[] = [{ url: "https://fixture.invalid/story", date: "2026-11-12", status: 200, sha256: "", html: REAL_PAGE, text: REAL_PAGE, founder_account: true }];

describe("frame", () => {
  test("takes the first 10 results of each query, drops left-out hosts and groups by site", async () => {
    const urls = ["https://a.invalid/1", "https://blog.medium.com/x", "https://www.reddit.com/r", "https://a.invalid/2", ...Array.from({ length: 8 }, (_, k) => "https://b.invalid/" + k)];
    const f = await frame(async () => urls.map((url) => ({ url })));
    expect(f.results).toHaveLength(40);
    expect(f.results[0]!.urls).toHaveLength(10);
    expect([...f.sources.keys()]).toEqual(["https://a.invalid", "https://b.invalid"]);
    expect(f.sources.get("https://b.invalid")).toHaveLength(6);
    expect(excluded("https://x.com/a")).toBe(true);
    expect(excluded("https://box.com/a")).toBe(false);
  });
});

describe("robots.txt", () => {
  test("our agent's group wins over *, the longest rule decides and Allow wins a tie", () => {
    const text = "User-agent: *\nDisallow: /\n\nUser-agent: other\nUser-agent: gstack-evals\nDisallow: /blog/\nAllow: /blog/story$\n";
    const rules = robotsRules(text, "gstack-evals");
    expect(robotsAllows(rules, "/blog/story").allowed).toBe(true);
    expect(robotsAllows(rules, "/blog/story2")).toEqual({ allowed: false, rule: "Disallow: /blog/" });
    expect(robotsAllows(robotsRules(text, "someone"), "/about").allowed).toBe(false);
    expect(robotsAllows(robotsRules("User-agent: *\nDisallow: /*.pdf$", "x"), "/a.pdf").allowed).toBe(false);
  });
});

describe("forbiddingClause", () => {
  test("names the use a clause forbids and quotes it", () => {
    expect(forbiddingClause("Welcome. You may not reproduce any content without our written permission.")).toEqual({ kind: "keeping a copy", clause: "You may not reproduce any content without our written permission." });
    expect(forbiddingClause("Content may not be used to train AI models.")!.kind).toBe("sending text to an outside model");
    expect(forbiddingClause("We love readers. Comments are moderated.")).toBeNull();
  });
});

describe("serial", () => {
  test("runs one request at a time", async () => {
    let open = 0, most = 0;
    const f = serial(async () => {
      most = Math.max(most, ++open);
      await new Promise((r) => setTimeout(r, 2));
      open--;
      return { status: 200, text: "" };
    });
    await Promise.all([f("a"), f("b"), f("c")]);
    expect(most).toBe(1);
  });
});

describe("readNotes", () => {
  test("splits the notes and the Names line into entries", () => {
    const n = readNotes(REAL_NOTES) as Notes;
    expect(n.names).toEqual(["Fernwick Labs", "Fernwick Ledger", "Ada Quill"]);
    expect(n.a).toContain("booking site");
    expect(n.b).toContain("paid first");
    expect((readNotes("Note A\nx\nNote B\ny\nNames: A and B & C") as Notes).names).toEqual(["A", "B", "C"]);
  });
  test("reads INELIGIBLE and its reason, and names a missing part", () => {
    expect(readNotes("INELIGIBLE: no first customer is named.")).toEqual({ ineligible: "no first customer is named." });
    expect(readNotes("Note A\nx")).toMatch(/lack/);
  });
});

describe("runReal", () => {
  test("a clean source passes with the T1 and T2 families, source dates and industry", async () => {
    const d = deps();
    const o = await runReal("r1", 1, PAGES, d);
    expect(o.status).toBe("pass");
    expect(o.checks.map((c) => c.step)).toEqual(["copy", "trace", "audit", "vocabulary", "probe", "generic", "type"]);
    expect(o.meta).toMatchObject({ stratum: "real", author: "sol", shape: null, industry: "pottery studios", source_dates: { opening: "2014", first_sale: "2015" } });
    expect(d.call.calls.find((c) => /:t1:/.test(c.label))!.model).toBe("sol");
    expect(d.call.calls.find((c) => /:t2:/.test(c.label))!.model).toBe("gemini");
    expect(d.call.calls.filter((c) => /:audit:/.test(c.label)).map((c) => c.model)).toEqual(["opus", "gemini"]);
    expect(d.call.calls.find((c) => /:t1:/.test(c.label))!.prompt).not.toContain("paid first");
  });
  test("a copy found only in key.json is rewritten from T2", async () => {
    let first = true;
    const copied = { ...REAL_FILES.key, first_move: "a route setter paid first, for the hold inventory export" };
    const d = deps((r) => (/:t2:/.test(r.label) && first ? ((first = false), authorReply({ key: copied })) : undefined));
    const o = await runReal("r1", 1, PAGES, d);
    expect(o).toMatchObject({ status: "pass", rewrites: 1 });
    expect(d.call.calls.some((c) => /:rewrite:t2:/.test(c.label))).toBe(true);
    expect(d.call.calls.some((c) => /:rewrite:t1:/.test(c.label))).toBe(false);
  });
  test("both auditors rating every W item unforeseeable drops the unit with no rewrite", async () => {
    const o = await runReal("r1", 1, PAGES, deps((r) => (/:audit:/.test(r.label) ? JSON.stringify({ r1: "pass", r2: "pass", r3: "pass", foreseeable: { customer: "no", wedge: "no" } }) : undefined)));
    expect(o).toMatchObject({ status: "drop", step: "foreseeable", rewrites: 0 });
  });
  test("an INELIGIBLE note drops the source before any writer call", async () => {
    const d = deps((r) => (/:notes/.test(r.label) ? "INELIGIBLE: fewer than 4 facts." : undefined));
    expect(await runReal("r2", 2, PAGES, d)).toMatchObject({ status: "drop", step: "ineligible" });
    expect(d.call.calls).toHaveLength(1);
  });
});

describe("fame and cutoffs", () => {
  test("pageviews sums the months and reads a 404 as no article", async () => {
    const f: Fetch = async (url) => (url.includes("Fernwick_Labs/monthly/20251001/20260930") ? { status: 200, text: JSON.stringify({ items: [{ views: 5 }, { views: 7 }] }) } : { status: 404, text: "" });
    expect(await pageviews("Fernwick Labs", f)).toBe(12);
    expect(await pageviews("Nobody", f)).toBeNull();
  });
  test("terciles rank by views, with no article always lowest", () => {
    const t = terciles([{ id: "a", views: 900 }, { id: "b", views: null }, { id: "c", views: 50 }, { id: "d", views: 10 }, { id: "e", views: 400 }, { id: "f", views: 5000 }]);
    expect(Object.fromEntries(t)).toEqual({ b: 1, d: 1, c: 2, e: 2, a: 3, f: 3 });
  });
  test("marks each model's cutoff against the first sale", () => {
    const file = join(mkdtempSync(join(tmpdir(), "of-cut-")), "cutoffs.json");
    writeFileSync(file, JSON.stringify({ models: { a: { cutoff: "2026-06" }, b: { cutoff: null }, c: { cutoff: "2015-03-31" } } }));
    expect(cutoffMarks("first sale in 2015", file)).toEqual({ a: "predates", b: "unknown", c: "after" });
    expect(cutoffMarks("seed stage", file).a).toBe("unknown");
    expect(Object.keys(cutoffMarks("2015"))).toEqual(["opus", "sol", "particle"]);
  });
});
