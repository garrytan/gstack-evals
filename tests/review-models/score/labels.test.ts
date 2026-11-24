import { describe, expect, test } from "bun:test";
import type { Arm } from "../../../lanes/review-models/score/frozen.ts";
import type { Bug, ReviewFinding } from "../../../lanes/review-models/score/judge.ts";
import { adjudicated, adjudicationItems, ASTRA_FRAMING, checkRow, kappaCheck, labelItems, labellerRequest, parseLabel, pilotJudgeCheck, readLabel, type CheckRow, type Label } from "../../../lanes/review-models/score/labels.ts";
import type { Review } from "../../../lanes/review-models/score/score.ts";
import { seededRandom } from "../../../src/runner/stats/paired.ts";

const bug = (unit: string): Bug => ({ unit, pool: "P", evidence: "Evidence for " + unit, fix_diff: "--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n-a\n+b\n" });
const finding: ReviewFinding = { id: "f1", source: "voice", severity: "P0", path: "x.ts", line: 1, text: "[codex] GPT-6.2 Astra says a is wrong" };
const review = (unit: string, arm: Arm, ruling: "names" | "doesnt" | "cant_tell", o: Partial<Review> = {}): Review => ({ unit, arm, pool: "P", cluster: unit, outcome: "ok", contaminated: false, findings: [finding], judged: { rulings: { f1: ruling }, reasons: {}, attempts: 1, failures: [], failed: false }, usd: 5, wall_seconds: 10, ...o });
const yes: Label = { names_bug: true, findings: [1], reason: "same line" };
const no: Label = { names_bug: false, findings: [], reason: "other thing" };

describe("label items", () => {
  test("bug-unit reviews only, under opaque ids in a seeded order, normalised and blind to arm", () => {
    const reviews = [review("u1", "OS", "names"), review("u1", "FA", "doesnt"), review("u2", "OA", "names"), review("d1", "N", "doesnt", { pool: "decoy" }), review("u3", "OS", "names", { outcome: "gap", findings: [] })];
    const bugs = new Map(["u1", "u2", "u3"].map((u) => [u, bug(u)]));
    const a = labelItems(reviews, bugs, 42);
    expect(a.items).toHaveLength(3);
    expect(a.key.map((k) => k.unit + k.arm).sort()).toEqual(["u1FA", "u1OS", "u2OA"]);
    expect(labelItems(reviews, bugs, 42)).toEqual(a);
    for (const it of a.items) {
      expect(it.id).toMatch(/^L[0-9a-z]{6,}$/);
      expect(it.prompt).not.toMatch(/codex|astra|gpt|voice/i);
      expect(it.prompt).not.toMatch(/\b(?:OS|OA|FS|FA|N)\b/);
      expect(it.prompt).toContain("1. [blocking] x.ts:1\n   [model] [model] says a is wrong");
      expect(it.prompt).toContain('"names_bug"');
    }
    expect(() => labelItems(reviews, new Map(), 1)).toThrow(/^E_RM_LABELS no bug for unit/);
  });
  test("the labellers' requests: Opus on Messages, Astra on Responses at high effort with the read-only framing", () => {
    const opus = labellerRequest("opus", "P") as Record<string, any>;
    expect(opus).toEqual({ model: "claude-opus-5-5", messages: [{ role: "user", content: "P" }], max_tokens: 32000 });
    const astra = labellerRequest("astra", "P") as Record<string, any>;
    expect(astra).toEqual({ model: "gpt-6.2-astra", input: [{ role: "user", content: ASTRA_FRAMING + "\n\nP" }], store: false, max_output_tokens: 32000, reasoning: { effort: "high" } });
  });
});

describe("label replies", () => {
  test("names_bug and the findings agree, numbers in range", () => {
    expect(parseLabel('```json\n{"names_bug": true, "findings": [2], "reason": "r"}\n```', 2)).toEqual({ kind: "ok", value: { names_bug: true, findings: [2], reason: "r" } });
    expect(parseLabel('{"names_bug": false, "findings": []}', 2)).toEqual({ kind: "ok", value: { names_bug: false, findings: [], reason: "" } });
    expect(parseLabel('{"names_bug": true, "findings": []}', 2).kind).toBe("malformed");
    expect(parseLabel('{"names_bug": true, "findings": [3]}', 2).kind).toBe("malformed");
    expect(parseLabel('{"names_bug": "yes"}', 2).kind).toBe("malformed");
    expect(parseLabel("", 2).kind).toBe("empty");
    expect(readLabel("opus", { content: [{ type: "text", text: '{"names_bug": false, "findings": []}' }] }, 1).kind).toBe("ok");
    expect(readLabel("astra", { output: [{ type: "message", content: [{ type: "output_text", text: '{"names_bug": true, "findings": [1]}' }] }] }, 1).kind).toBe("ok");
  });
});

describe("adjudication", () => {
  test("only disagreements, with both answers as reader A and reader B", () => {
    const items = [{ id: "a", prompt: "PA" }, { id: "b", prompt: "PB" }];
    const adj = adjudicationItems(items, new Map([["a", yes], ["b", no]]), new Map([["a", yes], ["b", yes]]), 9);
    expect(adj.map((i) => i.id)).toEqual(["b"]);
    expect(adj[0]!.prompt.startsWith("PB\n\nTwo readers labelled this review and disagreed.\nReader A: ")).toBe(true);
    expect(adj[0]!.prompt).toContain("names the bug (finding 1). Reason: same line");
    expect(adj[0]!.prompt).toContain("no finding names the bug. Reason: other thing");
    expect(adj[0]!.prompt).not.toMatch(/opus|astra/i);
    expect(() => adjudicationItems(items, new Map([["a", yes]]), new Map([["a", yes], ["b", yes]]), 9)).toThrow(/^E_RM_LABELS item b lacks a first read from opus/);
  });
  test("the final label", () => {
    expect(adjudicated([yes, yes])).toBe(true);
    expect(adjudicated([yes, no], [no, no])).toBe(false);
    expect(adjudicated([yes, no], [yes, no])).toBe("unresolved");
    expect(() => adjudicated([yes, no])).toThrow(/^E_RM_LABELS/);
  });
});

describe("the kappa gate", () => {
  /** n labelled reviews per arm; Carbon errs on the first errs of each arm. */
  const rows = (perArm: Partial<Record<Arm, number>>, errs: number, seed = 1): CheckRow[] => {
    const rng = seededRandom(seed);
    return (Object.entries(perArm) as Array<[Arm, number]>).flatMap(([arm, n]) =>
      Array.from({ length: n }, (_, i) => {
        const label = rng() < 0.5;
        return { unit: arm + i, arm, pool: i % 3 ? "P" : "B", label, carbon: i < errs ? !label : label, abstained: i === 0, empty_reply: i === 1 } as CheckRow;
      }),
    );
  };
  test("passes at kappa 0.6 or more on 100 labels with every counted arm at 20; prints errors per arm and pool", () => {
    const k = kappaCheck(rows({ OS: 20, OA: 20, FS: 20, FA: 20, N: 20 }, 1), ["OS", "OA", "FS", "FA", "N"]);
    expect(k.labels).toBe(100);
    expect(k.kappa!).toBeGreaterThan(0.85);
    expect(k.pass).toBe(true);
    expect(k.per_arm.OS).toMatchObject({ labels: 20, errors: 1, abstentions: 1, empty_replies: 1, unresolved: 0 });
    expect(k.per_pool.P.labels + k.per_pool.B.labels).toBe(100);
    expect(k.per_pool.B.errors).toBe(5);
    expect(k.line).toMatch(/^Carbon judge check: 100 labelled reviews, kappa 0\.\d{3}, errors 5, abstentions 5, empty replies 5; gate kappa 0\.6 on 100 labels: passes$/);
  });
  test("fails under 100 labels, under kappa 0.6, or with a counted arm under 20", () => {
    expect(kappaCheck(rows({ OS: 20, OA: 20, FS: 20, FA: 19, N: 20 }, 0), ["OS", "OA", "FS", "FA", "N"])).toMatchObject({ pass: false, short_arms: ["FA"] });
    expect(kappaCheck(rows({ OS: 25, OA: 25, N: 25, FS: 15, FA: 10 }, 0), ["OS", "OA", "N"])).toMatchObject({ pass: true, short_arms: [] });
    expect(kappaCheck(rows({ OS: 50, OA: 49 }, 0), ["OS", "OA"]).pass).toBe(false);
    const bad = kappaCheck(rows({ OS: 50, OA: 50 }, 12), ["OS", "OA"]);
    expect(bad.kappa!).toBeLessThan(0.6);
    expect(bad.pass).toBe(false);
  });
  test("an unresolved label stays in, read both ways, and the lower kappa stands", () => {
    const r = rows({ OS: 50, OA: 50 }, 0);
    r[5] = { ...r[5]!, label: "unresolved" };
    const k = kappaCheck(r, ["OS", "OA"]);
    expect(k.labels).toBe(100);
    expect(k.kappa).toBe(Math.min(k.kappa_unresolved_as_yes!, k.kappa_unresolved_as_no!));
    expect(k.kappa!).toBeLessThan(1);
    expect(k.per_arm.OS!.unresolved).toBe(1);
  });
  test("check rows from scored reviews; decoys refused; the pilot's per-arm judge column", () => {
    expect(checkRow(review("u1", "OS", "cant_tell"), true)).toEqual({ unit: "u1", arm: "OS", pool: "P", label: true, carbon: false, abstained: true, empty_reply: false });
    expect(() => checkRow(review("d", "OS", "doesnt", { pool: "decoy" }), false)).toThrow(/^E_RM_LABELS d is a decoy/);
    const pilot = rows({ OS: 10 }, 2);
    expect(pilotJudgeCheck(pilot, "OS", 10)).toEqual({ pass: true, errors: 2, labels: 10 });
    expect(pilotJudgeCheck(rows({ OS: 10 }, 3), "OS", 10).pass).toBe(false);
    expect(pilotJudgeCheck(pilot.slice(1), "OS", 10).pass).toBe(false);
  });
});
