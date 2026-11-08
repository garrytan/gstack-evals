import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decide, PROMPT as CLASSIFY, RULE } from "../../lanes/product-value/author/classify.ts";
import { FRAME, LICENCES, MIN_STARS, MIN_WORDS, SEED, WINDOW_DAYS } from "../../lanes/product-value/author/mine.ts";
import { REWRITE, T1, T2 } from "../../lanes/product-value/author/prompts.ts";
import { applyNames, cut, firstVersion, labelled, lastJson, rankPrimary } from "../../lanes/product-value/author/run.ts";
import { SUMMARY_PROMPT_SHA256 } from "../../lanes/product-value/author/transpose.ts";
import type { KeyItem } from "../../lanes/product-value/types.ts";

const PREREG = readFileSync(join(import.meta.dir, "../../wiki/plans/2026-11-08-geva-403-product-value-prereg/README.md"), "utf8");
const quotes = PREREG.split("\n").filter((l) => l.startsWith("> ")).map((l) => l.slice(2));

describe("frozen authoring prompts match the prereg byte for byte", () => {
  test("REWRITE, T1 and T2 are quoted in section 4", () => {
    expect(quotes).toContain(REWRITE);
    expect(quotes).toContain(T1);
    expect(quotes).toContain(T2);
  });
  test("the type rule is section 4's text", () => {
    for (const line of RULE.split("\n").filter(Boolean)) {
      const plain = line.replace(/^- (\w[\w -]*):/, (_m, t) => "- **" + t + ":**");
      expect(PREREG.includes(plain)).toBe(true);
    }
    expect(CLASSIFY.startsWith("Give this project one type")).toBe(true);
  });
  test("the summary prompt digest is committed before any summary", () => {
    expect(SUMMARY_PROMPT_SHA256).toMatch(/^[0-9a-f]{64}$/);
  });
  test("the frame is section 4's", () => {
    expect(SEED).toBe("20261108");
    expect([...LICENCES].sort()).toEqual(["Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "CC0-1.0", "MIT", "MPL-2.0"]);
    expect(FRAME).toEqual({ from: "2026-07-01", plansTo: "2026-09-30", shippedBy: "2026-10-09", closedBy: "2026-09-27" });
    expect([MIN_STARS, MIN_WORDS, WINDOW_DAYS]).toEqual([500, 300, 42]);
  });
});

describe("classifier decision", () => {
  test("agreement stands, a disagreement takes the third label", () => {
    expect(decide("mobile", "mobile", null)).toBe("mobile");
    expect(decide("mobile", "consumer", "consumer")).toBe("consumer");
    expect(decide(null, "server", "other")).toBe("other");
    expect(decide("server", "other", null)).toBeNull();
  });
});

const item = (id: string, kind: KeyItem["kind"], users: number, extra: Partial<KeyItem> = {}): KeyItem => ({ id, kind, statement: id, evidence: [], outside_users: users, mentioned: false, generic: false, foreseeable: "maybe", ...extra });

describe("primary ranking", () => {
  test("U and E only, mentioned and generic out, at most 6, ranked by outside users", () => {
    const items = [item("a", "U", 1), item("b", "U", 5), item("c", "E", 3), item("d", "R", 9), item("e", "U", 7, { mentioned: true }), item("f", "E", 8, { generic: true }), item("g", "U", 2), item("h", "U", 2), item("i", "E", 0), item("j", "U", 4)];
    const p = rankPrimary("pv-x", items);
    expect(p.length).toBe(6);
    expect(p).not.toContain("d");
    expect(p).not.toContain("e");
    expect(p).not.toContain("f");
    expect(p.slice(0, 3)).toEqual(["b", "j", "c"]);
  });
  test("the tie-break is seeded and stable", () => {
    const items = [item("a", "U", 1), item("b", "U", 1), item("c", "U", 1)];
    expect(rankPrimary("pv-x", items)).toEqual(rankPrimary("pv-x", [...items].reverse()));
  });
});

describe("text helpers", () => {
  test("lastJson reads the last fenced json block", () => {
    expect(lastJson("x\n~~~json\n{\"a\":1}\n~~~\ny\n```json\n{\"a\":2}\n```")).toEqual({ a: 2 });
    expect(lastJson("no json here")).toBeNull();
  });
  test("labelled splits the three T1 files", () => {
    const t = "```plan.md\nP\n```\n```brief.md\nB\n```\n```context/project.md\nC\n```";
    const l = labelled(t);
    expect([l["plan.md"]?.trim(), l["brief.md"]?.trim(), l["context/project.md"]?.trim()]).toEqual(["P", "B", "C"]);
  });
  test("applyNames replaces whole names, longest first", () => {
    expect(applyNames("Acme and AcmeDB use acme.io", [{ original: "Acme", replacement: "Northwind" }, { original: "AcmeDB", replacement: "the store" }, { original: "acme.io", replacement: "example.org" }])).toBe("Northwind and the store use example.org");
  });
  test("cut stops at the word limit", () => {
    expect(cut("a b c d", 2)).toBe("a b [cut]");
    expect(cut("a b", 2)).toBe("a b");
  });
  test("firstVersion takes the body when never edited and refuses an incomplete history", () => {
    expect(firstVersion("body", { totalCount: 0, nodes: [] })?.text).toBe("body");
    expect(firstVersion("body", { totalCount: 101, nodes: [] })).toBeNull();
  });
});
