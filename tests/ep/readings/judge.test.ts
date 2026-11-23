import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fxReview, fxUnit } from "../../../lanes/eng-planted/readings/fixtures.ts";
import { bundleSet, bundleText, genericList, genericRate, goldOf, judgeAll, judgeCheck, kappaOf, keywordHit, NAMED_PROMPT, parseNamed, parseQuotes, QUOTES_PROMPT, ROLE_EFFORT, ROLE_MODEL, sectionOf, stripNames, type GoldRow, type JudgeCall } from "../../../lanes/eng-planted/readings/judge.ts";

describe("the judge's reading", () => {
  test("strips arm and package names", () => {
    expect(stripNames("Ran /plan-eng-review and autoplan's eng phase (Phase 3) under gstack, GSTACK_SESSION_KIND set; standalone notes")).not.toMatch(/plan-eng-review|autoplan|gstack|GSTACK_|eng phase|standalone/i);
  });
  test("the prompts carry their placeholders and no arm name, and the judge is GPT-6 Astra", () => {
    const q = readFileSync(QUOTES_PROMPT, "utf8");
    const n = readFileSync(NAMED_PROMPT, "utf8");
    expect(q).toContain("{{BUNDLE}}");
    expect(q).toContain("{{MAX}}");
    expect(q).not.toContain("{{HINT}}");
    expect(n).toContain("{{HINT}}");
    expect(n).toContain("{{QUOTES}}");
    expect(n).not.toContain("{{BUNDLE}}");
    expect(stripNames(q + n)).toBe(q + n);
    expect(ROLE_MODEL.judge).toBe("openai/gpt-6-astra");
  });
  test("bundle text keeps the file order and stops at 12,000 words", () => {
    const t = bundleText([{ path: "plan.md", text: "alpha" }, { path: "review/review.md", text: "beta" }]);
    expect(t.text.indexOf("plan.md")).toBeLessThan(t.text.indexOf("review/review.md"));
    expect(t.truncated).toBe(false);
    expect(bundleText([{ path: "plan.md", text: "w ".repeat(12000) }]).truncated).toBe(false);
    expect(bundleText([{ path: "plan.md", text: "w ".repeat(12001) }]).truncated).toBe(true);
  });
  test("quotes parse from a JSON array, keep the first 12 and drop what the bundle doesn't hold", () => {
    const text = "When the input is empty, return zero.\nOn a timeout, retry once.";
    const q = parseQuotes("Here: [\"when the input is empty,  return zero.\", \"\u201cOn a timeout, retry once.\u201d\", \"made up\"]", text);
    expect(q.quotes).toHaveLength(2);
    expect(q.dropped).toBe(1);
    expect(parseQuotes("no list", text).error).toBe("call 1 gave no JSON array");
    expect(parseQuotes(JSON.stringify(Array.from({ length: 14 }, () => "On a timeout, retry once.")), text).over).toBe(2);
  });
  test("call 2 reads MATCH n or NONE", () => {
    expect(parseNamed("MATCH 2\nbecause", 3)).toBe(1);
    expect(parseNamed("match 4", 3)).toBeNull();
    expect(parseNamed("NONE", 3)).toBeNull();
  });
  test("an empty reply to either call is the bundle's error, never a reading (plan change 2026-11-23)", async () => {
    expect(parseQuotes("", "text").error).toBe("call 1 gave an empty reply");
    expect(parseQuotes(" \n", "text").error).toBe("call 1 gave an empty reply");
    const files = [{ path: "plan.md", text: "Return zero on empty input." }];
    const quotes = JSON.stringify(["Return zero on empty input."]);
    const read = async (named: string) => (await judgeAll([{ unit: "u1", source: "plain", files, hint: "h" }], async (_role, prompt) => (prompt.includes("Hint:") ? named : quotes)))[0]!;
    const empty = await read("");
    expect([empty.named, empty.matched, empty.error]).toEqual([false, null, "call 2 gave an empty reply"]);
    const none = await read("NONE");
    expect([none.named, none.matched, none.error]).toEqual([false, null, null]);
    const hit = await read("MATCH 1");
    expect([hit.named, hit.matched, hit.error]).toEqual([true, 0, null]);
  });
  test("the Carbon labeller runs at its default effort; the judge and the Opus labeller stay at high", () => {
    expect(ROLE_EFFORT).toEqual({ judge: "high", "gold-opus": "high", "gold-gemini": null });
  });
  test("a credited quote maps to its heading", () => {
    const t = "=== file: plan.md ===\n## Coverage diagram\nA covers B.\n## Architecture\nKeep the parser pure.\n=== file: review/test-plan.md ===\nTest a negative count.";
    expect(sectionOf(t, "A covers B.")).toBe("coverage diagram");
    expect(sectionOf(t, "Keep the parser pure.")).toBe("architecture");
    expect(sectionOf(t, "Test a negative count.")).toBe("test plan");
  });
  test("identical bundles are read once and every call is in order", async () => {
    const calls: string[] = [];
    const call: JudgeCall = async (role, prompt) => {
      calls.push(role + ":" + (prompt.includes("Hint:") ? "named" : "quotes"));
      return prompt.includes("Hint:") ? "NONE" : JSON.stringify(["Return zero on empty input."]);
    };
    const files = [{ path: "plan.md", text: "Return zero on empty input." }];
    const r = await judgeAll([{ unit: "u1", source: "none", files, hint: "h" }, { unit: "u1", source: "plan", files, hint: "h" }, { unit: "u1", source: "stock", files: [{ path: "plan.md", text: "Nothing." }], hint: "h" }], call);
    expect(calls).toEqual(["judge:quotes", "judge:named", "judge:quotes"]);
    expect(r.map((x) => x.source)).toEqual(["none", "plan", "stock"]);
  });
  test("the bundle set takes each arm's first review in the seeded order, skipping a gap, plus the three controls", () => {
    const rs = [fxReview("u0", "plain", 2, null), fxReview("u0", "plain", 1, null, "upstream_gap"), fxReview("u0", "standalone", 3, true), fxReview("u0", "standalone", 1, true)];
    expect(bundleSet([fxUnit(0)], rs)).toEqual([
      { unit: "u0", source: "plain", rep: 2 },
      { unit: "u0", source: "standalone", rep: 3 },
      { unit: "u0", source: "stock", rep: null },
      { unit: "u0", source: "none", rep: null },
      { unit: "u0", source: "plan", rep: null },
    ]);
  });
});

describe("gold and the check", () => {
  const row = (judge: boolean, labels: [boolean, boolean], settled: boolean | null = null, source: GoldRow["source"] = "plain"): GoldRow => ({ key: "k" + Math.random(), unit: "u", source, judge, labels, settled: settled === null ? null : { named: settled, by: "run thread", note: "read the fix blind to arm" } });
  test("the keyword match needs half of the probe's content words", () => {
    expect(keywordHit("A negative timeout closes the socket", "closes the socket when the timeout is negative")).toBe(true);
    expect(keywordHit("A negative timeout closes the socket", "the socket stays open")).toBe(false);
  });
  test("gold is the shared label or the settlement; kappa, sensitivity and specificity", () => {
    expect(goldOf(row(true, [true, false], false))).toBe(false);
    expect(goldOf(row(true, [true, false]))).toBeNull();
    const k = kappaOf([[true, true], [true, false], [false, false], [false, false]]);
    expect(k.kappa).toBeCloseTo(0.5, 12);
    expect([k.sensitivity, k.specificity, k.prevalence]).toEqual([1, 2 / 3, 0.25]);
  });
  test("refuses with unsettled disagreements, fails under 48 bundles or with a credited stock bundle", () => {
    expect(judgeCheck([row(true, [true, false])]).code).toBe("E_USAGE");
    const agree = Array.from({ length: 48 }, (_, i) => row(i % 2 === 0, [i % 2 === 0, i % 2 === 0]));
    expect(judgeCheck(agree).pass).toBe(true);
    expect(judgeCheck(agree.slice(0, 47)).code).toBe("E_EP_JUDGE_CHECK");
    expect(judgeCheck([...agree, row(true, [true, true], null, "stock")]).message).toContain("the stock control must score 0");
  });
  test("the generic lists hold 30 entries per ecosystem and the rate counts credited quotes they match", () => {
    for (const e of ["go", "node", "python", "rust"] as const) expect(genericList(e)).toHaveLength(30);
    const b = (unit: string, quote: string, named: boolean) => ({ unit, source: "standalone" as const, words: 10, quotes: [quote], named, sections: [], matched: named ? 0 : null });
    const r = genericRate([b("u0", "Handle a send on a closed channel by returning an error.", true), b("u1", "Reject a config whose port field is 70000.", true), b("u2", "nil map access", false)], [fxUnit(0), fxUnit(1), fxUnit(2)]);
    expect(r.standalone).toEqual({ credited: 2, generic: 1, rate: 0.5 });
  });
  test("the generic lists were written before any unit and name no repository", () => {
    for (const e of ["go", "node", "python", "rust"]) expect(readFileSync(join(import.meta.dir, "../../../lanes/eng-planted/readings/generic/" + e + ".txt"), "utf8")).toStartWith("# Common ");
  });
});
