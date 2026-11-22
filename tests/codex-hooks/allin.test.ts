import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openLease, recordApproval, settleLease } from "../../src/runner/ledger/ledger.ts";
import { openLocalLedger } from "../../src/runner/ledger/local.ts";
import { ledgerPath } from "../../src/runner/ledger/paths.ts";
import { ALL_IN_ITEMS, allIn, type Spend } from "../../lanes/codex-hooks/allin.ts";
import { cSpends, markDone } from "../../lanes/codex-hooks/c/plan.ts";
import { rSpends } from "../../lanes/codex-hooks/r/money.ts";

const M = 1_000_000;
const idle = (): Spend[] => ALL_IN_ITEMS.map((item) => ({ item, done: false, spent: 0, projection: 100 * M }));

describe("codex-hooks all-in stop", () => {
  test("a done item counts at its spend, a running one at the larger of its spend and its projection, and the crew is added", () => {
    const s = idle();
    s[0] = { ...s[0]!, done: true, spent: 20 * M };
    s[1] = { ...s[1]!, spent: 150 * M };
    const a = allIn(s, { as_of: "t", usd: 10 });
    expect(a.ok).toBe(true);
    expect(a.total).toBe((20 + 150 + 5 * 100 + 10) * M);
    expect(a.lines[0]).toBe("ALL_IN PASS: $680.00 of $1200.00");
    expect(a.lines).toContain("  r-pilot done: spent $20.00, counted $20.00");
    expect(allIn(s, { as_of: "t", usd: 530.01 }).why).toEqual(["all-in $1200.01 (items $670.00, crew $530.01 as of t) passes the $1200.00 stop"]);
  });

  test("every item of both parts and the judge item is counted once, and nothing else is", () => {
    const s = idle();
    expect(allIn([...s.slice(1), s[2]!, { item: "b1-opus", done: false, spent: 0, projection: 0 }], { as_of: "t", usd: 0 }).why).toEqual([
      "r-pilot is missing from the count",
      "c-pilot is counted 2 times",
      "b1-opus is not an item of this eval",
    ]);
    expect(() => allIn(s, { as_of: "t" } as never)).toThrow("E_USAGE");
  });

  test("part C's items read what settled and their VM share, and never an open lease's reservation", () => {
    const dir = mkdtempSync(join(tmpdir(), "codex-hooks-allin-"));
    try {
      const record = join(dir, "record");
      for (const item of ["c-main", "h-main"]) recordApproval(record, { action: "init", item, cap_micros: 300 * M, quotes: [{ words: "w", by: "b", source: "s" }], admission: "warn" });
      const local = openLocalLedger(ledgerPath(join(dir, "ledger.sqlite"), {}));
      const settled = openLease(record, local, { item: "c-main", run_id: "r1", amount_micros: 40 * M });
      settleLease(record, local, settled.lease_id, () => {});
      markDone(record, "c-main");
      openLease(record, local, { item: "h-main", run_id: "r2", amount_micros: 250 * M });
      local.close();
      const c = Object.fromEntries(cSpends(record).map((s) => [s.item, s]));
      expect(c["c-main"]).toEqual({ item: "c-main", done: true, spent: 9.6 * M, projection: 266 * M });
      expect(c["h-main"]).toEqual({ item: "h-main", done: false, spent: 3 * M, projection: 261 * M });
      expect(c["geva-562-judge"]).toEqual({ item: "geva-562-judge", done: false, spent: 0, projection: 55 * M });
      expect(rSpends({}).map((s) => s.projection)).toEqual([46.2 * M, 129 * M]);
      expect(() => cSpends(join(dir, "nowhere"))).toThrow("does not exist");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
