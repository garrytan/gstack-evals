// Copyright (c) 2026 Garry Tan. MIT License.
import { describe, expect, test } from "bun:test";
import { baselineRecall, checkType, grepBaseline, namesFile, namesFunction, nameWords, pairwiseSummary, guessTally, repoFunctions, terciles, isTestPath } from "../../lanes/eng-review/score.ts";
import type { PacketMap } from "../../lanes/eng-review/packets.ts";
import { item, keyOf, meta, tmp, writeUnits } from "./fixtures.ts";
import { join } from "node:path";

describe("the frozen mechanical rules (section 8)", () => {
  test("a list names a file by its path or its base name as a whole token", () => {
    expect(namesFile(["Test src/api/export.go for empty tags"], "src/api/export.go")).toBe(true);
    expect(namesFile(["export.go returns 500"], "src/api/export.go")).toBe(true);
    expect(namesFile(["export.go."], "src/api/export.go")).toBe(true);
    expect(namesFile(["myexport.go returns 500"], "src/api/export.go")).toBe(false);
    expect(namesFile(["export.gox"], "src/api/export.go")).toBe(false);
  });
  test("a list names a function as a whole identifier of at least 3 characters, the last part of a.b", () => {
    expect(namesFunction(["readRows skips empty rows"], "Importer.readRows")).toBe(true);
    expect(namesFunction(["readRowsFast"], "readRows")).toBe(false);
    expect(namesFunction(["call do()"], "do")).toBe(false);
  });
  test("check type is the earliest named type; none named is other", () => {
    expect(checkType("Unit test that the CI config parser rejects tabs")).toBe("unit");
    expect(checkType("A CI job that runs the unit tests on Windows")).toBe("ci");
    expect(checkType("An end-to-end test of sign-up")).toBe("e2e");
    expect(checkType("A golden-output eval of the summary prompt")).toBe("eval");
    expect(checkType("Check the importer")).toBe("other");
  });
  test("the grep baseline: base functions ranked by shared words with plan.md; test files and vendored folders skipped", () => {
    const d = tmp();
    writeUnits(d, [{ meta: meta("u1"), key: keyOf("u1", [item("a")]) }]);
    const fns = repoFunctions(join(d, "u1", "repo"));
    expect(fns.map((f) => f.name).sort()).toEqual(["parseDate", "readRows"]);
    expect(nameWords("readRowsFromCSV2")).toEqual(["read", "rows", "from", "csv"]);
    const top = grepBaseline(fns, "The importer will read rows.");
    expect(top[0]!.name).toBe("readRows");
    expect(baselineRecall(keyOf("u1", [item("a")]), top.slice(0, 1))).toEqual({ files: 1, functions: 1 });
    expect(baselineRecall(keyOf("u1", [item("a")]), [{ file: "src/import.ts", name: "parseDate" }])).toEqual({ files: 1, functions: 0 });
    expect(isTestPath("src/__tests__/a.ts") && isTestPath("pkg/a_test.go") && isTestPath("a.spec.ts") && !isTestPath("src/contest.ts")).toBe(true);
  });
  test("change-size terciles split by added lines then id, larger groups first", () => {
    const t = terciles([10, 50, 20, 40, 30, 60, 70].map((n, i) => meta("u" + i, { source_added: n })));
    expect([...t].filter(([, v]) => v === 1).length).toBe(3);
    expect(t.get("u0")).toBe(1);
    expect(t.get("u6")).toBe(3);
  });
});

describe("pairwise and arm-guess tallies", () => {
  const map = (contrast: string, arms: [string, string]): PacketMap => ({ version: 1, kind: "pairwise", stage: 2, seed: 1, order: [], packets: Object.fromEntries(Array.from({ length: 10 }, (_, i) => ["p" + i, { id: "p" + i, role: "pairwise", stage: 2, unit: "u" + i, model: "opus", pass: 1, judges: ["astra"], items: {}, pair: { contrast, arms }, lists: { A: arms[0] === "stock" ? { kind: "stock", unit: "u", model: "opus", pass: 1, words: 50 } : { kind: "arm", arm: arms[0] as "precut", unit: "u", model: "opus", pass: 1, words: 50 }, B: { kind: "arm", arm: "none", unit: "u", model: "opus", pass: 1, words: 40 } } }])) });
  test("ties leave the raw rate; the stock block's share counts ties as not won", () => {
    const recs = Array.from({ length: 10 }, (_, i) => ({ packet: "p" + i, judge: "astra" as const, model_id: "", version: null, effort: "medium", choice: (i < 2 ? "A" : i < 4 ? "tie" : "B") as "A" | "B" | "tie", why: "" }));
    const s = pairwiseSummary(map("stock-none", ["stock", "none"]), recs, { seed: 1, draws: 200 })[0]!;
    expect([s.wins, s.ties, s.losses]).toEqual([2, 2, 6]);
    expect(s.raw).toBe(0.25);
    expect(s.win_share).toBe(0.2);
  });
  test("an arm guess is correct when it names the arm's class; above 70% flags", () => {
    const m = { version: 1, kind: "armguess", stage: 2, seed: 1, order: [], packets: { a: { lists: { L: { arm: "precut" } } }, b: { lists: { L: { arm: "none" } } } } } as unknown as PacketMap;
    const g = (packet: string, guess: "skill" | "none" | "lens") => ({ packet, judge: "astra" as const, model_id: "", version: null, effort: "medium", guess });
    expect(guessTally(m, [g("a", "skill"), g("b", "none")]).flag).toBe(true);
    expect(guessTally(m, [g("a", "skill"), g("b", "lens")]).rate).toBe(0.5);
  });
});
