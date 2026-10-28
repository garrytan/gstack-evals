import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseUsd, usd } from "../../src/runner/ledger/money.ts";
import { LedgerError, readItem, writeOnce, type ApprovalFile } from "../../src/runner/ledger/record.ts";

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
const scratch = () => {
  const d = mkdtempSync(join(tmpdir(), "ledger-tiers-"));
  dirs.push(d);
  return d;
};

const approval = (seq: number, cap_micros: number): ApprovalFile => ({
  schema: 1,
  kind: "approval",
  item: "lanea",
  seq,
  action: seq === 1 ? "init" : "raise",
  ...(seq === 1 ? { admission: "warn" as const } : {}),
  cap_micros,
  quotes: [{ words: "Rec", by: "Garry Tan", source: "gate 1" }],
  recorded_at: "2026-10-28T00:00:00.000Z",
});

describe("money in integer micro-dollars", () => {
  test("dollar text parses exactly and formats back", () => {
    expect(parseUsd("130")).toBe(130_000_000);
    expect(parseUsd("$12.5")).toBe(12_500_000);
    expect(parseUsd("0.000125")).toBe(125);
    expect(parseUsd("0.1")! + parseUsd("0.2")!).toBe(parseUsd("0.3")!);
    for (const bad of ["", "-1", "1.0000001", "1e3", "abc", "1234567890"]) expect(parseUsd(bad)).toBeNull();
    expect([usd(130_000_000), usd(12_500_000), usd(125), usd(0)]).toEqual(["$130.00", "$12.50", "$0.000125", "$0.00"]);
  });
});

describe("write-once record files", () => {
  test("a slot is written once: the same bytes again are present, other bytes are a conflict", () => {
    const record = scratch();
    expect(writeOnce(record, approval(1, 5))).toBe("written");
    expect(writeOnce(record, approval(1, 5))).toBe("present");
    expect(writeOnce(record, approval(1, 6))).toEqual({ conflict: approval(1, 5) });
    expect(readItem(record, "lanea").cap_micros).toBe(5);
  });

  test("a file that does not parse, or a gap in a sequence, is E_LEDGER_RECORD", () => {
    const code = (record: string) => {
      try {
        readItem(record, "lanea");
      } catch (error) {
        return (error as LedgerError).code;
      }
    };
    const torn = scratch();
    mkdirSync(join(torn, "items", "lanea"), { recursive: true });
    writeFileSync(join(torn, "items", "lanea", "approval-0001.json"), '{"schema": 1, "kind": "appr');
    expect(code(torn)).toBe("E_LEDGER_RECORD");
    const gap = scratch();
    writeOnce(gap, approval(2, 5));
    expect(code(gap)).toBe("E_LEDGER_RECORD");
  });
});
