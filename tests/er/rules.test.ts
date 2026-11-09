// Copyright (c) 2026 Garry Tan. MIT License.
import { describe, expect, test } from "bun:test";
import { icc, itemMix, judgeScore, leakReading, loadCutoffs, sessionCost, stockReading } from "../../lanes/eng-review/rules.ts";
import { meta, row, rv } from "./fixtures.ts";

describe("readings the dry run doesn't print", () => {
  test("ICC: identical passes read high, unrelated low; the item mix splits at 2.25", () => {
    const same = ["a", "b", "c", "d"].flatMap((u, i) => [1, 2, 3].map((p) => rv(u, "none", p, i / 4)));
    const noise = ["a", "b", "c", "d"].flatMap((u) => [0, 0.5, 1].map((v, p) => rv(u, "none", p + 1, v)));
    expect(icc(same)).toBe(0.99);
    expect(icc(noise)).toBe(0.01);
    expect(itemMix(2.25)).toBe("1-2");
    expect(itemMix(2.26)).toBe("2-4");
  });
  test("session cost: measured, else Opus's measured times the model ratio, else the planning figure", () => {
    const rs = [row({ unit: "u", session: "a", arm: "precut", spend_micros: 3_000_000 }), row({ unit: "u", session: "b", arm: "precut", spend_micros: 1_000_000 })];
    expect(sessionCost(rs, "opus", "precut")).toEqual({ dollars: 2, source: "measured" });
    expect(sessionCost(rs, "sol", "precut").source).toBe("opus ratio");
    expect(sessionCost(rs, "particle", "candidate")).toEqual({ dollars: 0.2, source: "planning" });
  });
  test("stock credits count a unit once across its passes", () => {
    const c = [1, 2, 3].map((p) => ({ unit: "u1", model: "opus" as const, pass: p, row: 1, credited: true }));
    expect(stockReading(c, 16).rows[0]!.credited).toBe(1);
  });
  test("leak: exposure on the cutoff's last day is exposed, the day after is not", () => {
    const c = loadCutoffs();
    expect(leakReading([meta("a", { exposed_at: "2026-06-30T23:00:00Z" })], "opus", c).exposed).toEqual(["a"]);
    expect(leakReading([meta("a", { exposed_at: "2026-07-01T00:00:00Z" })], "opus", c).exposed).toEqual([]);
  });
  test("the judge check prints by stratum and on real lists alone", () => {
    const cells = Array.from({ length: 10 }, (_, i) => ({ gold: i < 5, judged: i < 4, anchor: i === 0, real: i !== 0, list: "l" + i, stratum: i === 0 ? "oracle/B" : "none/B" }));
    const j = judgeScore("opus", "j", cells, { minimum: 0 });
    expect(j.by_stratum["oracle/B"]).toEqual({ anticipated: 1, not: 0 });
    expect(j.real_only.false_fail).toBe(0.25);
  });
});
