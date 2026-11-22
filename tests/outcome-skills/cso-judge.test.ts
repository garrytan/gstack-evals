// Copyright (c) 2026 Garry Tan. MIT License.
// Plan section 7 and section 15's judge fixtures, on fake transports only: the Carbon route body, Astra's id map and
// framing, the retry rule, the pass B packet (excerpts, insert-only hunks, the 400-line cap and the frozen over-cap trim
// order), gold extracted on its own against pass A, anchors that lift kappa while non-anchor gold sits below 0.6, the
// over-cap gold-drop limit above and at 5%, undefined kappa, the per-arm gate, the format variants and the refusal limit.
import { describe, expect, test } from "bun:test";
import { CHAT_PRICES, OPENROUTER_MODELS } from "../../src/runner/pricing/prices.ts";
import { judgeEffort, judgeMaxOutput, loadCsoPrereg } from "../../lanes/outcome-skills/cso/prereg.ts";
import type { UnitRecord } from "../../lanes/outcome-skills/cso/types.ts";
import { judgeRelease } from "../../lanes/outcome-skills/cso/analysis/release.ts";
import { treeIndex } from "../../lanes/outcome-skills/cso/score/checks.ts";
import { scoredText } from "../../lanes/outcome-skills/cso/score/text.ts";
import { askParsed, judgeBody, judgeClient, JUDGE_MODELS, judgeRoutes, routeClients, type Transport } from "../../lanes/outcome-skills/cso/judge/client.ts";
import { excerpts, passBPacket, renderHunks } from "../../lanes/outcome-skills/cso/judge/packets.ts";
import { parsePassB, type Finding } from "../../lanes/outcome-skills/cso/judge/schema.ts";
import { checkSetOrder, extraAnchorsAllowed, FORMAT, formatVariants, goldNamed, judgeCheck, judgeSession, kappa, oracleReport, runReport, stockReport, type FormatResult, type GoldResult, type ReportResult } from "../../lanes/outcome-skills/cso/judge/check.ts";

const p = loadCsoPrereg();
const lines = (n: number, tag: string) => Array.from({ length: n }, (_, i) => tag + " line " + (i + 1)).join("\n") + "\n";
const TREE = treeIndex({ "src/parse.js": lines(120, "parse"), "src/big.js": lines(3000, "big"), "src/other.js": lines(50, "other") });
const UNIT: UnitRecord = {
  schema: "cso-unit.v1", unit: "u1", position: 7, part: "part1", index: 0, repo: "acme/lib", ghsa: "GHSA-2222-3333-4444", cves: [], fix_commit: "f".repeat(40), parent: "e".repeat(40),
  ecosystem: "npm", published: "2026-08-01", month: "2026-08", cwe_ids: ["CWE-22"], cwe_families: ["path-traversal"], fix_files: ["src/parse.js"],
  hunks: [{ file: "src/parse.js", start: 40, end: 44, insert_only: false, text: "a\nb\nc\nd\ne" }], advisory: { summary: "Path traversal in parse", details: "The path is joined without normalizing." },
  source_files: 3, kind: "library", known_open: [], tree_sha256: "0".repeat(64),
};
const HELPER = { snapshot_root: null, handles: {} };
const promptOf = (b: Record<string, any>): string => (b.messages ?? b.input)[0].content;
const reply = (provider: string, text: string, extra: Record<string, unknown> = {}) =>
  provider === "openai" ? { output: [{ type: "message", content: [{ type: "output_text", text }] }], ...extra } : provider === "anthropic" ? { content: [{ type: "text", text }], stop_reason: "end_turn", ...extra } : { choices: [{ message: { content: text }, finish_reason: "stop" }], ...extra };
const KEPT = { text: "src/parse.js:41 joins the request path without normalizing it, so ../ escapes the root", source: "final", citations: [{ path: "src/parse.js", start: 41, end: 42, symbol: null }] };
const OTHER = { text: "src/other.js:3 logs a token", source: "final", citations: [{ path: "src/other.js", start: 3, end: 3, symbol: null }] };
const LAB = (hit: boolean) => ({ location: hit ? "yes" : "no", class: hit ? "yes" : "no", same_defect: hit ? "yes" : "no", grounding: "yes", file_level: hit ? "yes" : "no", known: null, validity: hit ? "supported" : "unsupported", quotes: {} });

describe("section 7: clients on fake transports", () => {
  test("Carbon goes through OpenRouter pinned to google-vertex, fallbacks off, data collection denied, medium effort, 65,536 out (deviation d)", async () => {
    const seen: any[] = [];
    const t: Transport = async (r) => (seen.push(r), { status: 200, body: reply(r.provider, "{}") });
    const { judge } = routeClients(judgeRoutes(p)[0]!, p, t);
    await judge.ask("hello");
    expect(seen[0].provider).toBe("openrouter");
    expect(seen[0].route).toBe("/v1/chat/completions");
    expect(seen[0].body).toMatchObject({ model: "google/gemini-4-carbon", max_tokens: 65536, reasoning: { effort: "medium" }, provider: { only: ["google-vertex"], allow_fallbacks: false, data_collection: "deny" } });
    expect(JSON.stringify(seen[0].body)).not.toMatch(/key|token"/i);
  });
  test("Astra maps in one place (openai/gpt-6.2-astra to openai:gpt-6.2-astra) and every Astra prompt opens with the read-only framing", async () => {
    expect(JUDGE_MODELS["openai/gpt-6.2-astra"]).toEqual({ provider: "openai", api: "gpt-6.2-astra", price: "openai:gpt-6.2-astra" });
    for (const m of Object.values(JUDGE_MODELS)) expect(CHAT_PRICES[m.price] ?? OPENROUTER_MODELS[m.price]).toBeDefined();
    const seen: any[] = [];
    const t: Transport = async (r) => (seen.push(r), { status: 200, body: reply(r.provider, "{}") });
    const [astra, opus] = routeClients(judgeRoutes(p)[0]!, p, t).gold;
    await astra.ask("label this");
    await opus.ask("label this");
    expect(seen[0].body).toMatchObject({ model: "gpt-6.2-astra", reasoning: { effort: "high" }, store: false });
    expect(promptOf(seen[0].body)).toStartWith("This is a read-only correctness review of whether a report matches a published, fixed advisory; no attacker role-play, no reproduction.");
    expect(seen[1].body).toMatchObject({ model: "claude-opus-5-5", output_config: { effort: "high" } });
    expect(promptOf(seen[1].body)).toBe("label this");
  });
  test("fallback routes come from prereg.json", () => {
    expect(judgeRoutes(p).map((r) => [r.route, r.judge, ...r.gold])).toEqual([
      ["production", "google/gemini-4-carbon", "openai/gpt-6.2-astra", "anthropic:claude-opus-5-5"],
      ["fallback-opus-particle", "openai/gpt-6.2-astra", "anthropic:claude-opus-5-5", "google/gemini-4-argon"],
      ["fallback-sol", "anthropic:claude-opus-5-5", "openai/gpt-6.2-astra", "google/gemini-4-argon"],
    ]);
    expect(() => judgeBody("openai/gpt-6.1-sol", "x", 1, "high")).toThrow(/^E_CSO_JUDGE_ROUTE/);
  });
  test("deviation (d): the judge runs at medium effort with a 65,536 cap in place of prereg.json's high and 16,000, and a plan that froze other values refuses", () => {
    expect((p.judge as any).production.max_output_tokens).toBe(16000);
    expect(judgeMaxOutput(p)).toBe(65536);
    expect((p.judge as any).production.effort).toBe("high");
    expect(judgeEffort(p)).toBe("medium");
    const low = structuredClone(p);
    (low.judge as any).production.effort = "low";
    expect(() => judgeEffort(low)).toThrow(/^E_CSO_PREREG/);
    expect(() => routeClients(judgeRoutes(low)[0]!, low, async () => ({ status: 200, body: {} }))).toThrow(/^E_CSO_PREREG/);
    const other = structuredClone(p);
    (other.judge as any).production.max_output_tokens = 20000;
    expect(() => judgeMaxOutput(other)).toThrow(/^E_CSO_PREREG/);
    expect(() => routeClients(judgeRoutes(other)[0]!, other, async () => ({ status: 200, body: {} }))).toThrow(/^E_CSO_PREREG/);
  });
  test("a reply cut off at its output cap is labelled truncated, not malformed, and the retry asks as attempt 2", async () => {
    const cut = { choices: [{ message: { content: null }, finish_reason: "length", native_finish_reason: "MAX_TOKENS" }] };
    const asked: unknown[] = [];
    const both = judgeClient("google/gemini-4-carbon", "judge", async (r) => (asked.push(r.attempt), { status: 200, body: cut }), { maxOutputTokens: 1, effort: "high" });
    expect(await askParsed(both, "x", () => 1)).toEqual({ gap: "google/gemini-4-carbon gave a truncated reply twice", refused: false, attempts: 2 });
    expect(asked).toEqual([1, 2]);
    const replies: unknown[] = [cut, reply("openrouter", "nope")];
    const mixed = judgeClient("google/gemini-4-carbon", "judge", async () => ({ status: 200, body: replies.shift() }), { maxOutputTokens: 1, effort: "high" });
    expect(await askParsed(mixed, "x", (t) => (t.startsWith("{") ? 1 : null))).toMatchObject({ gap: "google/gemini-4-carbon gave a truncated reply, then a malformed one", attempts: 2 });
  });
  test("a malformed reply gets one retry, a second is a judge gap; a refusal is counted; a non-200 refuses", async () => {
    const replies = ["nope", '{"ok":1}'];
    const c = judgeClient("google/gemini-4-carbon", "judge", async (r) => ({ status: 200, body: reply(r.provider, replies.shift() ?? "nope") }), { maxOutputTokens: 1, effort: "high" });
    expect(await askParsed(c, "x", (t) => (t.startsWith("{") ? 1 : null))).toEqual({ value: 1, refused: false, attempts: 2 });
    expect(await askParsed(c, "x", (t) => (t.startsWith("{") ? 1 : null))).toMatchObject({ gap: expect.stringContaining("malformed reply twice"), attempts: 2 });
    const r = judgeClient("anthropic:claude-opus-5-5", "judge", async (q) => ({ status: 200, body: reply(q.provider, "", { stop_reason: "refusal" }) }), { maxOutputTokens: 1, effort: "high" });
    expect(await askParsed(r, "x", () => 1)).toMatchObject({ refused: true, attempts: 1 });
    const bad = judgeClient("google/gemini-4-carbon", "judge", async () => ({ status: 502, body: {} }), { maxOutputTokens: 1, effort: "high" });
    await expect(bad.ask("x")).rejects.toThrow(/^E_CSO_JUDGE_TRANSPORT/);
  });
});

describe("section 7: the pass B packet", () => {
  test("two 41-line excerpts per finding from the audited tree", () => {
    const ex = excerpts({ text: "x", source: "final", citations: [{ path: "src/parse.js", start: 60, end: 60, symbol: null }, { path: "src/other.js", start: 2, end: 2, symbol: null }, { path: "src/big.js", start: 5, end: 5, symbol: null }] }, HELPER, TREE, 20);
    expect(ex.length).toBe(2);
    expect(ex[0]!.split("\n").length).toBe(42);
    expect(ex[0]).toStartWith("src/parse.js lines 40-80");
    expect(ex[1]).toStartWith("src/other.js lines 1-22");
  });
  test("an insert-only hunk shows its anchors and its added lines, marked; hunks stop at 400 lines", () => {
    const ins = renderHunks([{ file: "a.js", start: 9, end: 10, insert_only: true, added: ["if (!ok) throw e;"], text: "line9\nline10" }]);
    expect(ins).toContain("insert-only hunk; anchor lines 9-10");
    expect(ins).toContain("line9\nline10\n+ if (!ok) throw e;");
    const big = renderHunks([{ file: "a.js", start: 1, end: 300, insert_only: false, text: lines(300, "a").trimEnd() }, { file: "b.js", start: 1, end: 300, insert_only: false, text: lines(300, "b").trimEnd() }]);
    expect(big.split("\n").filter((l) => / line \d+$/.test(l)).length).toBe(400);
    expect(big).toContain("(200 hunk lines left out in all)");
  });
  const unit = (hunks: UnitRecord["hunks"]): UnitRecord => ({ ...UNIT, hunks });
  const h = (file: string, n: number) => ({ file, start: 1, end: n, insert_only: false, text: lines(n, file).trimEnd() });
  const input = (u: UnitRecord) => ({ unit: u, helper: HELPER, tree: TREE, label: [KEPT as any] });
  test("an under-cap packet is untouched", () => {
    const pk = passBPacket(input(unit([h("src/parse.js", 150)])), p);
    expect([pk.trimmed, pk.over_cap]).toEqual([[], false]);
    expect(pk.text).toContain("src/parse.js line 150");
  });
  test("an over-cap packet is trimmed in the frozen order: known open advisories first, then hunks past 100 lines, largest file first", () => {
    const u = unit([h("src/parse.js", 150), h("src/big.js", 250)]);
    const full = passBPacket(input(u), p, (s) => s.length).tokens;
    const pk = passBPacket(input(u), p, (s) => (s.length > full - 2000 ? 40001 : 1));
    expect(pk.trimmed).toEqual(["known_open_to_summaries_and_files", "hunk src/big.js:1"]);
    expect(pk.over_cap).toBe(false);
    expect(pk.text).toContain("src/parse.js line 150");
    expect(pk.text).not.toContain("src/big.js line 101");
  });
  test("a packet that can't fit is a judge gap in production, and the findings and excerpts are never trimmed", async () => {
    const pk = passBPacket(input(unit([h("src/parse.js", 150)])), p, () => 50000);
    expect(pk.over_cap).toBe(true);
    expect(pk.text).toContain(KEPT.text);
    expect(pk.text).toContain("src/parse.js lines 21-61");
    const calls: string[] = [];
    const judge = judgeClient("google/gemini-4-carbon", "judge", async (r) => {
      calls.push(promptOf(r.body));
      return { status: 200, body: reply(r.provider, JSON.stringify({ findings: [KEPT] })) };
    }, { maxOutputTokens: 1, effort: "high" });
    const wide = treeIndex({ "src/parse.js": Array.from({ length: 120 }, () => "x".repeat(4000)).join("\n") });
    const s = { texts: ["report"], helper: HELPER };
    const run = await judgeSession(judge, UNIT, scoredText(s, p), s, wide, p);
    expect(run.over_cap).toBe(true);
    expect(run.judged!.labels).toEqual({ gap: "pass B packet over the input cap after trimming" });
    expect(calls.length).toBe(1);
  });
});

describe("section 7: gold extracted on its own against pass A", () => {
  const transport = (passA: unknown[]): Transport => async (r) => {
    const t = promptOf(r.body);
    const isLabel = t.includes("You label findings");
    const body = r.provider === "openrouter"
      ? (isLabel ? { labels: (JSON.parse(JSON.stringify(passA)) as any[]).map((f, i) => ({ finding: i + 1, ...LAB(f.text === KEPT.text) })) } : { findings: passA })
      : isLabel ? { own: [{ finding: 1, ...LAB(true) }], pass_a: passA.map((_, i) => ({ finding: i + 1, validity: "supported" })) } : { findings: [KEPT] };
    return { status: 200, body: reply(r.provider, JSON.stringify(body)) };
  };
  const run = (passA: unknown[]) => runReport("r1", { arm: "none", model: "opus", anchor: null }, routeClients(judgeRoutes(p)[0]!, p, transport(passA)), UNIT, { texts: ["the report"], helper: HELPER }, TREE, p);
  test("gold disagrees with a pass A that dropped the advisory's finding", async () => {
    const r = await run([OTHER]);
    expect(r.production.named).toBe(false);
    expect(goldNamed(r)).toBe(true);
  });
  test("gold agrees with a pass A that kept it", async () => {
    const r = await run([OTHER, KEPT]);
    expect(r.production.named).toBe(true);
    expect(goldNamed(r)).toBe(true);
  });
});

const g = (named: boolean | null, o: Partial<GoldResult> = {}): GoldResult => ({ named, validity: [], refused: false, over_cap: false, ...o });
const rep = (id: string, prod: boolean, gold: boolean, o: Partial<ReportResult> = {}): ReportResult => ({ id, arm: id.startsWith("c") ? "cso" : "none", model: "opus", anchor: null, production: { named: prod, validity: [], refused: false }, gold: [g(gold), g(gold)], ...o });
const FORMATS: FormatResult[] = Array.from({ length: 10 }, (_, i) => ({ unit: "u" + i, table: true, prose: true, near_class: false, near_lines: false }));
const anchor = (id: string, kind: "oracle" | "stock") => rep(id, kind === "oracle", kind === "oracle", { anchor: kind, arm: null, model: null });

describe("section 7: the route check", () => {
  test("anchors that lift kappa over 0.6 while non-anchor gold sits below it fail the route", () => {
    const reps: ReportResult[] = [];
    for (let i = 0; i < 24; i++) reps.push(rep((i % 2 ? "c" : "n") + i, i < 6, i < 3 || (i >= 6 && i < 9)));
    for (let i = 0; i < 12; i++) reps.push(anchor("o" + i, "oracle"), anchor("s" + i, "stock"));
    const c = judgeCheck("production", reps, FORMATS, p);
    const d = c.detail as { kappa_named_all: number; kappa_named_non_anchor: number };
    expect(d.kappa_named_all).toBeGreaterThanOrEqual(0.6);
    expect(d.kappa_named_non_anchor).toBeLessThan(0.6);
    expect(c.gates.named_kappa_all).toBe(true);
    expect(c.gates.named_kappa_non_anchor).toBe(false);
    expect(judgeRelease([c])[0]!.named_route).toBe("fail");
  });
  const base = () => Array.from({ length: 60 }, (_, i) => rep((i % 2 ? "c" : "n") + i, i < 30, i < 30));
  test("over-cap gold drops above 5% of the check set fail the route; at 5% they pass on that count", () => {
    const at = base().map((r, i) => (i < 3 ? { ...r, gold: [g(null, { over_cap: true }), r.gold[1]] as [GoldResult, GoldResult] } : r));
    const c = judgeCheck("production", at, FORMATS, p);
    expect(c.gates.gold_overcap).toBe(true);
    expect((c.detail as any).overcap_by_cell).toEqual({ "none opus": 2, "cso opus": 1 });
    const above = base().map((r, i) => (i < 4 ? { ...r, gold: [g(true, { over_cap: true }), r.gold[1]] as [GoldResult, GoldResult] } : r));
    expect(judgeCheck("production", above, FORMATS, p).gates.gold_overcap).toBe(false);
  });
  test("a route meeting every count passes; an undefined kappa fails closed", () => {
    const c = judgeCheck("production", base(), FORMATS, p);
    expect(c.gates).toMatchObject({ named_kappa_all: true, named_kappa_non_anchor: true, per_arm_gate: true, format_pairs: true, format_near_misses: true, refusals: true, gold_overcap: true });
    expect(c.minimums).toMatchObject({ named_reports: true, named_class: true, anchor_share: true });
    expect(kappa([[true, true], [true, true]])).toBeNull();
    const flat = judgeCheck("production", base().map((r) => rep(r.id, true, true)), FORMATS, p);
    expect([flat.gates.named_kappa_all, flat.minimums.named_class]).toEqual([false, false]);
  });
  test("the per-arm gate: disagreement in cso and none reports differs by at most 10 points", () => {
    const skew = base().map((r, i) => (r.arm === "cso" && i < 8 ? rep(r.id, !r.production.named, r.production.named!) : r));
    const c = judgeCheck("production", skew, FORMATS, p);
    expect((c.detail as any).per_arm_disagreement.none).toBe(0);
    expect(c.gates.per_arm_gate).toBe(false);
    const ok = base().map((r, i) => (r.arm === "cso" && i < 6 ? rep(r.id, !r.production.named, r.production.named!) : r));
    expect(judgeCheck("production", ok, FORMATS, p).gates.per_arm_gate).toBe(true);
  });
  test("format variants: 9 of 10 pairs and 18 of 20 near misses pass, one fewer fails; the thresholds match prereg.json", () => {
    const text = (p.judge as any).format_variants as string;
    expect(text).toContain("at least " + FORMAT.same_min + " of " + FORMAT.units + " pairs");
    expect(text).toContain("at least " + FORMAT.not_hit_min + " of " + FORMAT.near_misses);
    const f = (pairsOff: number, nearHits: number) => FORMATS.map((x, i) => ({ ...x, prose: i < pairsOff ? false : true, near_class: i < nearHits ? true : false }));
    expect(judgeCheck("production", base(), f(1, 2), p).gates).toMatchObject({ format_pairs: true, format_near_misses: true });
    expect(judgeCheck("production", base(), f(2, 3), p).gates).toMatchObject({ format_pairs: false, format_near_misses: false });
  });
  test("the refusal limit is 5% of check-set reports", () => {
    const refuse = (k: number) => base().map((r, i) => (i < k ? { ...r, production: { ...r.production, refused: true } } : r));
    expect(judgeCheck("production", refuse(3), FORMATS, p).gates.refusals).toBe(true);
    expect(judgeCheck("production", refuse(4), FORMATS, p).gates.refusals).toBe(false);
  });
  test("validity kappa on agreed gold findings, can't tell excluded", () => {
    const v = base().map((r, i) => ({ ...r, production: { ...r.production, validity: [i % 2 ? "supported" : "unsupported"] as any }, gold: [g(r.gold[0].named, { validity: [i % 2 ? "supported" : "unsupported"] }), g(r.gold[1].named, { validity: [i % 3 === 0 ? "cant_tell" : i % 2 ? "supported" : "unsupported"] })] as [GoldResult, GoldResult] }));
    const c = judgeCheck("production", v, FORMATS, p);
    expect((c.detail as any).gold_findings).toBe(40);
    expect(c.minimums.validity_findings && c.minimums.validity_class && c.gates.validity_kappa).toBe(true);
  });
  test("anchors stay under 30% of the check set as sent, in a seeded order; extra anchors fill only under that cap", () => {
    const items = [...base(), ...Array.from({ length: 30 }, (_, i) => anchor("a" + i, "oracle"))];
    expect(() => checkSetOrder(items, p)).toThrow(/^E_CSO_CHECK_INPUT/);
    const ok = items.slice(0, 84);
    expect(checkSetOrder(ok, p).map((x) => x.id)).toEqual(checkSetOrder([...ok].reverse(), p).map((x) => x.id));
    expect(extraAnchorsAllowed(70, 24, p)).toBe(6);
    expect(extraAnchorsAllowed(70, 30, p)).toBe(0);
  });
});

describe("section 7: anchors and format variants", () => {
  test("the oracle cites the hunk in at most 40 lines; the stock list cites no line", () => {
    expect(oracleReport(UNIT, TREE, p)).toContain("Location: src/parse.js:40-44");
    expect(stockReport(UNIT, TREE, p)).not.toMatch(/\.js:\d/);
  });
  test("near misses: a family that shares no CWE with the advisory, and a line 30 from every hunk", () => {
    const v = formatVariants(UNIT, TREE, p);
    expect(v.table).toContain("| F1 | src/parse.js | 40-44 | CWE-22 path-traversal |");
    expect(v.prose).toContain("In src/parse.js at lines 40-44");
    expect(v.near_class).toContain("CWE-77 command-injection");
    expect(v.near_lines).toContain("| 74-74 |");
    const tight = { ...UNIT, hunks: [{ ...UNIT.hunks[0]!, start: 20, end: 100 }] };
    expect(() => formatVariants(tight, TREE, p)).toThrow(/^E_CSO_ANCHOR/);
  });
});

describe("deviation (e): the check's own items and pass B's known field", () => {
  const SRC = ['import fs from "node:fs";', "", "// joins paths", ...Array.from({ length: 117 }, (_, i) => "parse line " + (i + 4))].join("\n") + "\n";
  const T2 = treeIndex({ "src/parse.js": SRC });
  const U2: UnitRecord = {
    ...UNIT,
    hunks: [{ file: "src/parse.js", start: 1, end: 2, insert_only: true, text: "" }, { file: "src/parse.js", start: 40, end: 44, insert_only: false, text: "a\nb\nc\nd\ne" }],
    advisory: { summary: "Path traversal in `parse()`", details: "### Summary\nThe `parse()` function in src/parse.js joins the request path without normalizing it.\n\n### Impact\n\nFiles outside the root can be read." },
  };
  test("the oracle skips a hunk that only touches imports, blank lines or comments, and keeps the first hunk when every hunk does", () => {
    expect(oracleReport(U2, T2, p)).toContain("Location: src/parse.js:40-44");
    expect(formatVariants(U2, T2, p).table).toContain("| F1 | src/parse.js | 40-44 |");
    expect(oracleReport({ ...U2, hunks: [U2.hunks[0]!] }, T2, p)).toContain("Location: src/parse.js:1-2");
  });
  test("the mechanism is the first paragraph of the advisory details that is not a heading", () => {
    const o = oracleReport(U2, T2, p);
    expect(o).toContain("joins the request path without normalizing it");
    expect(o).not.toContain("###");
    expect(formatVariants(U2, T2, p).prose).toContain("joins the request path without normalizing it");
  });
  test("the near-lines near miss keeps the right class at a line 30 from every hunk and names nothing from the advisory", () => {
    const v = formatVariants(U2, T2, p);
    expect(v.near_lines).toContain("| F1 | src/parse.js | 74-74 | CWE-22 path-traversal |");
    expect(v.near_lines).not.toContain("parse()");
    expect(v.near_lines).not.toContain("normalizing");
    expect(v.near_lines).not.toContain("Path traversal in");
  });
  test("pass B shows known as null or an object with the ghsa and its four labels; the parser takes that object and still refuses a bare id", () => {
    const pk = passBPacket({ unit: UNIT, helper: HELPER, tree: TREE, label: [KEPT as Finding] }, p);
    expect(pk.text).toContain('"known":{"ghsa":"GHSA-');
    const known = { ghsa: "GHSA-aaaa-bbbb-cccc", location: "yes", class: "yes", same_defect: "no", grounding: "yes" };
    expect(parsePassB(JSON.stringify({ labels: [{ finding: 1, ...LAB(false), known }] }), 1)?.[0]?.known).toEqual(known as never);
    expect(parsePassB(JSON.stringify({ labels: [{ finding: 1, ...LAB(false), known: "GHSA-aaaa-bbbb-cccc" }] }), 1)).toBeNull();
  });
});
