import { describe, expect, test } from "bun:test";
import type { Arm } from "../../../lanes/review-models/score/frozen.ts";
import type { ReviewFinding } from "../../../lanes/review-models/score/judge.ts";
import { ASTRA_FRAMING, checkRow, kappaCheck, labellerRequest, pilotJudgeCheck, type CheckRow } from "../../../lanes/review-models/score/labels.ts";
import type { Review } from "../../../lanes/review-models/score/score.ts";
import { seededRandom } from "../../../src/runner/stats/paired.ts";

const finding: ReviewFinding = { id: "f1", source: "voice", severity: "P0", path: "x.ts", line: 1, text: "[codex] GPT-6.2 Astra says a is wrong" };
const review = (unit: string, arm: Arm, ruling: "names" | "doesnt" | "cant_tell", o: Partial<Review> = {}): Review => ({ unit, arm, pool: "P", cluster: unit, outcome: "ok", contaminated: false, findings: [finding], judged: { rulings: { f1: ruling }, reasons: {}, attempts: 1, failures: [], failed: false }, usd: 5, wall_seconds: 10, ...o });

describe("the second read's requests", () => {
  test("Opus on Messages, Astra on Responses at high effort with the read-only framing", () => {
    const opus = labellerRequest("opus", "P") as Record<string, any>;
    expect(opus).toEqual({ model: "claude-opus-5-5", messages: [{ role: "user", content: "P" }], max_tokens: 32000 });
    const astra = labellerRequest("astra", "P") as Record<string, any>;
    expect(astra).toEqual({ model: "gpt-6.2-astra", input: [{ role: "user", content: ASTRA_FRAMING + "\n\nP" }], store: false, max_output_tokens: 32000, reasoning: { effort: "high" } });
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
