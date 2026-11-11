// Copyright (c) 2026 Garry Tan. MIT License.
// Keyless tests of the eng-review lane's unit readers (lanes/eng-review/units.ts): the key rules and the unit, plan and
// rows readers' refusals.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { keyProblem, loadUnits, readPlan, readRows } from "../../lanes/eng-review/units.ts";
import type { Key, KeyItem } from "../../lanes/eng-review/types.ts";
import { tempDir } from "../real/fixture.ts";

const tmp = tempDir("er-units-test-");
afterAll(() => tmp.cleanup());

const item = (id: string, o: Partial<KeyItem> = {}): KeyItem => ({ id, kind: "B", statement: "s", file: "a.py", evidence: [], dated: "2026-01-01", mentioned: false, generic: false, ...o }) as KeyItem;
const key = (unit: string, items: KeyItem[], primary: string[]): Key => ({ unit, items, primary, own: [], touched: { files: [], functions: [] }, diffstat: [] });
const message = (f: () => unknown) => {
  try {
    f();
    return "no stop";
  } catch (e) {
    return (e as Error).message;
  }
};

describe("eng-review unit readers", () => {
  // Value: protects=the section 3 key rules the lane's units carry; fails_when=a key with a repeated id, too many primary items, or a mentioned, generic or missing primary item reads as clean.
  test("a key's primary items exist, are B, T or C, are neither mentioned nor generic, and number at most 6", () => {
    expect(keyProblem(key("u", [item("a"), item("b", { kind: "T" })], ["a", "b"]))).toBeNull();
    expect(keyProblem(key("u", [item("a"), item("a")], []))).toBe("key u repeats an item id");
    expect(keyProblem(key("u", Array.from({ length: 7 }, (_, i) => item("i" + i)), Array.from({ length: 7 }, (_, i) => "i" + i)))).toBe("key u holds 7 primary items; section 3 keeps at most 6");
    expect(keyProblem(key("u", [item("a")], ["z"]))).toBe("key u names primary item z, which is not among its items");
    expect(keyProblem(key("u", [item("a", { mentioned: true })], ["a"]))).toBe("key u lists item a as primary, but it is mentioned");
    expect(keyProblem(key("u", [item("a", { generic: true })], ["a"]))).toBe("key u lists item a as primary, but it is generic");
  });

  // Value: protects=the lane's unit folders; fails_when=a key naming another unit, a mismatched unit.json, a missing plan or an unknown arm in the rows is read without a stop.
  test("units, plans and rows: each reader refuses what doesn't fit", () => {
    const dir = join(tmp.dir, "units");
    mkdirSync(join(dir, "u1"), { recursive: true });
    writeFileSync(join(dir, "u1", "unit.json"), JSON.stringify({ id: "u1" }));
    writeFileSync(join(dir, "u1", "key.json"), JSON.stringify(key("u1", [item("a")], ["a"])));
    const units = loadUnits(dir, { keys: true });
    expect([...units.keys()]).toEqual(["u1"]);
    expect(units.get("u1")!.key!.primary).toEqual(["a"]);
    expect(message(() => readPlan(units.get("u1")!))).toBe("E_USAGE unit u1 has no plan.md");
    writeFileSync(join(dir, "u1", "plan.md"), "# Plan\n");
    expect(readPlan(units.get("u1")!)).toBe("# Plan\n");
    writeFileSync(join(dir, "u1", "key.json"), JSON.stringify(key("u2", [], [])));
    expect(message(() => loadUnits(dir, { keys: true }))).toBe("E_USAGE key.json in u1 names unit \"u2\"");
    expect(loadUnits(dir, { keys: false }).get("u1")!.key).toBeNull();
    expect(message(() => loadUnits(join(tmp.dir, "empty-missing"), { keys: false }))).toStartWith("E_USAGE units directory ");
    const rows = join(tmp.dir, "rows.jsonl");
    writeFileSync(rows, JSON.stringify({ unit: "u1", session: "s1", pass: 1, end: "no-block", arm: "none", model: "opus" }) + "\n");
    expect(readRows(rows).length).toBe(1);
    writeFileSync(rows, JSON.stringify({ unit: "u1", session: "s1", pass: 1, end: "no-block", arm: "other", model: "opus" }) + "\n");
    expect(message(() => readRows(rows))).toBe("E_USAGE rows file " + rows + " row 1 names an unknown arm or model");
  });
});
