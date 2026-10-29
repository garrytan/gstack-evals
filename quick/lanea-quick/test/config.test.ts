import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { lineItem } from "../src/config.ts";

describe("cap and line item", () => {
  test("have no default, so a fresh shell that sets neither or one refuses", () => {
    expect(() => lineItem({})).toThrow("E_CONFIG");
    expect(() => lineItem({ LANEA_CAP_USD: "35" })).toThrow("E_CONFIG: LANEA_LINE_ITEM");
    expect(() => lineItem({ LANEA_LINE_ITEM: "lanea-quick-rerun" })).toThrow("E_CONFIG: LANEA_CAP_USD");
  });
  test("refuse a cap that isn't a plain positive decimal and an empty or malformed item", () => {
    for (const cap of ["", " 35 ", "0x23", "1e6", "-1", "0", "0.00", "35.", "035", "Infinity"]) expect(() => lineItem({ LANEA_CAP_USD: cap, LANEA_LINE_ITEM: "lanea-quick" })).toThrow("E_CONFIG: LANEA_CAP_USD");
    for (const item of ["", " lanea-quick", "lanea-quick\n", "Lanea-quick", "../lanea-quick", "lanea/quick", "-lanea", "lanea--quick", "lanea_quick"]) expect(() => lineItem({ LANEA_CAP_USD: "35", LANEA_LINE_ITEM: item })).toThrow("E_CONFIG: LANEA_LINE_ITEM");
  });
  test("name the ledger after the line item unless LANEA_LEDGER is set", () => {
    expect(lineItem({ LANEA_CAP_USD: "35", LANEA_LINE_ITEM: "lanea-quick-rerun" })).toEqual({ cap: 35, item: "lanea-quick-rerun", ledger: join(homedir(), ".capy/drive/captain-gstack-evals/ledger/lanea-quick-rerun.jsonl") });
    expect(lineItem({ LANEA_CAP_USD: "20.44", LANEA_LINE_ITEM: "a1", LANEA_LEDGER: "/x/l.jsonl" })).toEqual({ cap: 20.44, item: "a1", ledger: "/x/l.jsonl" });
  });
});
