import { describe, expect, test } from "bun:test";
import { emptyCount, jaccard, ngrams, outsideAgentNotes, overlap, PLACEHOLDER, prose, redact, scanPublic, syntheticCheck } from "../../lanes/ask-replay/privacy.ts";
import { contentWords } from "../../lanes/office-hours-founder/score/counters.ts";
import { generate } from "../../lanes/ask-replay/synthetic/generator.ts";

// Shapes are assembled at run time so no key-shaped literal sits in the repo.
const k = (...parts: string[]) => parts.join("");

describe("the secret and contact scan", () => {
  const hits: Array<[string, string]> = [
    ["anthropic_key", k("sk-", "ant-", "api03-abcdefghij1234567890")],
    ["sk_key", k("sk-", "proj-abcdefghijklmnop1234")],
    ["github_token", k("gh", "p_", "a".repeat(36))],
    ["github_token", k("gh", "o_", "b".repeat(36))],
    ["github_pat", k("github", "_pat_", "11AAAAAAA0", "x".repeat(20))],
    ["slack_token", k("xo", "xb-", "1234567890-abcdefghij")],
    ["aws_key", k("AK", "IA", "ABCDEFGHIJKLMNOP")],
    ["google_key", k("AI", "za", "S".repeat(35))],
    ["jwt", k("ey", "J", "hbGciOiJIUzI1NiJ9", ".", "ey", "J", "zdWIiOiIxMjM0NTY3ODkwIn0", ".", "abcdefghij1234")],
    ["pem_private_key", k("-----BEGIN ", "RSA PRIVATE KEY-----\nMIIabc\n-----END RSA ", "PRIVATE KEY-----")],
    ["bearer", k("Authorization: Bear", "er abcdefghijklmnop.qrstuv")],
    ["keyword_run", "the deploy token is " + "9f8e7d6c5b4a39281706f5e4d3c2b1a0"],
    ["keyword_run", "password: " + k("Zx9", "Qw8Er7Ty6Ui5Op4As3Df2Gh1Jk0Lm")],
    ["email", "write to someone.else@example.org today"],
    ["phone", "call 555-010-4477 or (555) 010-4477 or 555.010.4477"],
    ["phone", "or +44 20 7946 0958"],
  ];
  for (const [kind, text] of hits) {
    test("replaces a " + kind + " hit with the one placeholder", () => {
      const c = emptyCount();
      const out = redact(text, c);
      expect(out).toContain(PLACEHOLDER);
      expect(c.by_kind[kind]).toBeGreaterThan(0);
    });
  }
  test("leaves dates, versions, run ids, task words and digests far from a key word alone", () => {
    const text = "On 2026-10-29 at 14:03 we shipped 1.99.5.0; run autoplan-20261113233829 took 346 asks. The task-runner and risk-free plan stay. Commit 0326b144af36676d599dcf63a9fad9a870d22ed6 is pinned in the prereg.";
    const c = emptyCount();
    expect(redact(text, c)).toBe(text);
    expect(c.hits).toBe(0);
  });
});

describe("the public-text scan", () => {
  test("issue keys and thread codes count in prose, not in front matter, code or the allow list", () => {
    const md = "---\nauthor: AB-12\n---\nSee XY-123 and GPT-6 here.\n\n`CD-9`\n\n```\nEF-77\n```\n";
    expect(prose(md)).not.toContain("AB-12");
    expect(scanPublic(md).codes).toBe(1);
  });
  test("dollar figures count outside an Agent notes section only", () => {
    const md = "# Post\n\nIt cost $40.\n\n## Agent notes\n\nCaps: $400 and $800.\n\n### Detail\n\n$5 more.\n";
    expect(outsideAgentNotes(md)).not.toContain("$400");
    expect(scanPublic(md).dollars).toBe(1);
    expect(scanPublic(md + "\n## After\n\n$9\n").dollars).toBe(2);
  });
  test("denied names count as whole words, case-insensitive", () => {
    expect(scanPublic("Ada Quill met ada quill; adaquill is not her.", { deny: ["Ada Quill", ""] }).names).toBe(2);
  });
  test("6-gram hits and the largest content-word Jaccard against a corpus", () => {
    const corpus = ["the quick brown fox jumps over the lazy dog every morning"];
    expect(ngrams("a b c d e f g")).toEqual(new Set(["a b c d e f", "b c d e f g"]));
    expect(overlap(["we saw the quick brown fox jumps over things"], corpus).ngram_hits).toBe(1);
    expect(overlap(["nothing shared at all with that sentence here"], corpus).ngram_hits).toBe(0);
    expect(jaccard(contentWords("alpha bravo charlie delta echo"), contentWords("alpha bravo charlie delta foxtrot"))).toBeCloseTo(4 / 6, 5);
    expect(jaccard(contentWords("alpha bravo"), contentWords("alpha bravo"))).toBe(0);
  });
  test("the synthetic check fails on any 6-gram hit or a Jaccard above 0.5", () => {
    const items = generate().items.slice(0, 3);
    expect(syntheticCheck(items, ["an unrelated custody sentence about something else entirely"]).pass).toBe(true);
    expect(syntheticCheck(items, [items[0]!.draft]).pass).toBe(false);
  });
});
