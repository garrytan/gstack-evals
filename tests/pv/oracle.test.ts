// Copyright (c) 2026 Garry Tan. MIT License.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { main as cli } from "../../lanes/product-value/cli.ts";
import { ORACLE_PREFIX, oracleList, run } from "../../lanes/product-value/oracle.ts";
import { capture, keyOf, meta, tmp, writeUnits } from "./fixtures.ts";

describe("pv oracle", () => {
  test("one change per primary item in rank order, each naming the item's need", () => {
    const o = oracleList(keyOf("u", ["a", "b"]));
    expect(o.items).toEqual(["a", "b"]);
    expect(o.changes).toEqual([ORACLE_PREFIX + "People needed tag-a in daily use.", ORACLE_PREFIX + "People needed tag-b in daily use."]);
    expect(o.changes.every((c) => c.split(/\s+/).length <= 40)).toBe(true);
  });

  test("a unit with six primary items gets five changes, the sixth left out", () => {
    const o = oracleList(keyOf("u", ["a", "b", "c", "d", "e", "f"]));
    expect(o.changes).toHaveLength(5);
    expect(o.items).toEqual(["a", "b", "c", "d", "e"]);
  });

  test("writes lists for calibration units only, outside the repo, and refuses aliased or in-repo paths", () => {
    const dir = tmp();
    writeUnits(join(dir, "units"), [{ meta: meta("c1"), key: keyOf("c1", ["a"]) }, { meta: meta("x1", { set: "comparison" }), key: keyOf("x1", ["b"]) }]);
    const c = capture();
    expect(run(["--units", join(dir, "units"), "--out", join(dir, "oracle.json")], c.io)).toBe(0);
    expect(Object.keys(JSON.parse(readFileSync(join(dir, "oracle.json"), "utf8")).units)).toEqual(["c1"]);
    expect(() => run(["--units", join(dir, "units"), "--out", join(import.meta.dir, "oracle.json")], c.io)).toThrow(/inside the repository/);
    symlinkSync(join(dir, "units"), join(dir, "alias"));
    expect(() => run(["--units", join(dir, "units"), "--out", join(dir, "alias")], c.io)).toThrow(/resolve to the same path/);
    expect(existsSync(join(import.meta.dir, "oracle.json"))).toBe(false);
  });

  test("the pv entry routes oracle and maps a refusal to its reason code", async () => {
    const c = capture();
    expect(await cli(["oracle", "--units", "/nonexistent-pv-units", "--out", join(tmp(), "o.json")], c.io)).toBe(2);
    expect(c.err.every((l) => l.startsWith("E_USAGE "))).toBe(true);
  });
});
