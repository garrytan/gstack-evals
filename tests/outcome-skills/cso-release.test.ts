// Copyright (c) 2026 Garry Tan. MIT License.
// Deviation (b): stage 1's judge-check release carries only met or not met per gold minimum and pass or fail per gate,
// tested both ways: a passing and a failing route each read right, and no count, kappa or rate from the check leaves.
import { describe, expect, test } from "bun:test";
import { GATES, GOLD_MINIMUMS, judgeRelease, RELEASE_ITEMS, type JudgeCheck } from "../../lanes/outcome-skills/cso/analysis/release.ts";
import { loadCsoPrereg } from "../../lanes/outcome-skills/cso/prereg.ts";

const all = <K extends string>(ks: readonly K[], v: boolean) => Object.fromEntries(ks.map((k) => [k, v])) as Record<K, boolean>;
const detail = { gold_counts: { named: 37, not_named: 23 }, kappa: { named_all: 0.8123, non_anchor: 0.6417 }, refusal_rate: 0.0213, per_arm: { cso: 0.0731, none: 0.0412 } };
const passing: JudgeCheck = { route: "carbon", minimums: all(GOLD_MINIMUMS, true), gates: all(GATES, true), detail };

describe("deviation (b): the judge-check release", () => {
  test("a route that meets every minimum and passes every gate reads met, pass, validated", () => {
    const [r] = judgeRelease([passing]);
    expect(Object.values(r.minimums)).toEqual(GOLD_MINIMUMS.map(() => "met"));
    expect(Object.values(r.gates)).toEqual(GATES.map(() => "pass"));
    expect(r.named_route).toBe("pass");
    expect(r.validity).toBe("validated");
  });

  test("the other way: a missed class minimum fails the named route; a failed validity kappa only closes validity", () => {
    const [short] = judgeRelease([{ ...passing, minimums: { ...passing.minimums, named_class: false } }]);
    expect(short.minimums.named_class).toBe("not met");
    expect(short.named_route).toBe("fail");
    const [v] = judgeRelease([{ ...passing, gates: { ...passing.gates, validity_kappa: false } }]);
    expect(v.named_route).toBe("pass");
    expect(v.validity).toBe("not validated");
    const [o] = judgeRelease([{ ...passing, gates: { ...passing.gates, gold_overcap: false } }]);
    expect(o.gates.gold_overcap).toBe("fail");
    expect(o.named_route).toBe("fail");
  });

  test("no count, kappa or rate leaves: the release holds no digit and no detail key", () => {
    const text = JSON.stringify(judgeRelease([passing, { ...passing, route: "astra", gates: all(GATES, false) }]));
    expect(text).not.toMatch(/[0-9]/);
    for (const k of ["gold_counts", "refusal_rate", "per_arm", "named_all", "non_anchor", "not_named", "cso", "none"]) expect(text).not.toContain('"' + k + '"');
  });

  test("a check missing a gate, carrying a count where a boolean goes, or adding a field is refused", () => {
    const { refusals: _, ...lack } = passing.gates;
    expect(() => judgeRelease([{ ...passing, gates: lack as JudgeCheck["gates"] }])).toThrow("E_CSO_RELEASE");
    expect(() => judgeRelease([{ ...passing, minimums: { ...passing.minimums, named_class: 23 as unknown as boolean } }])).toThrow("E_CSO_RELEASE");
    expect(() => judgeRelease([{ ...passing, gates: { ...passing.gates, gold_named_count: true } as JudgeCheck["gates"] }])).toThrow("E_CSO_RELEASE");
  });

  test("item 6 of the frozen release list asked for gold counts; deviation (b) replaces only that item", () => {
    const frozen = loadCsoPrereg().stage1_release;
    expect(frozen[5]).toContain("gold counts");
    expect(RELEASE_ITEMS[5]).not.toContain("counts");
    expect([...RELEASE_ITEMS.slice(0, 5)] as string[]).toEqual(frozen.slice(0, 5));
  });
});
