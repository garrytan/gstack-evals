// Copyright (c) 2026 Garry Tan. MIT License.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SEVERITY_ENTRY } from "../../../../lanes/codex-hooks/c/analysis/frozen.ts";
import { loadSeverityMaps, readerOf, severityOf, UNLABELLED } from "../../../../lanes/codex-hooks/c/analysis/severity.ts";

const maps = loadSeverityMaps();
const sev = (arm: "c-on" | "c-none", label: string) => severityOf(arm, maps[arm], label);

describe("severity maps", () => {
  test("the gstack arms read R2's gstack-full entry and c-none reads its none entry", () => {
    expect(SEVERITY_ENTRY).toEqual({ "c-on": "gstack-full", "c-off": "gstack-full", "c-high": "gstack-full", "c-none": "none" });
    expect(maps["c-on"]).toEqual(maps["c-high"]);
    expect(maps["c-on"]).toEqual(maps["c-off"]);
    expect(maps["c-on"].default).toMatchObject({ Critical: "CRITICAL", Informational: "INFORMATIONAL" });
    expect(maps["c-none"].default).toMatchObject({ BLOCKER: "CRITICAL", P1: "CRITICAL", Major: "CRITICAL", Minor: "INFORMATIONAL" });
  });

  test("refuses a map that is not R2's", () => {
    const d = mkdtempSync(join(tmpdir(), "chc-sev-"));
    try {
      writeFileSync(join(d, "map.json"), "{}");
      expect(() => loadSeverityMaps(join(d, "map.json"))).toThrow(/^E_CH_C_FROZEN /);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  const rows: Array<["c-on" | "c-none", string, string | null, string]> = [
    ["c-on", "Critical", "CRITICAL", "an exact row"],
    ["c-on", "CRITICAL", "CRITICAL", "R2's own CRITICAL"],
    ["c-on", "INFORMATIONAL", "INFORMATIONAL", "R2's own INFORMATIONAL"],
    ["c-on", "cRiTiCaL", "CRITICAL", "a case twin"],
    ["c-on", "Critical, confirmed", "CRITICAL", "a label cut at its first comma"],
    ["c-on", "critical-path", "CRITICAL", "a compound label by its first word"],
    ["c-on", "HIGH", null, "a none-entry label under gstack-full: unmapped"],
    ["c-on", "Medium", null, "an unmapped label"],
    ["c-none", "high", "CRITICAL", "a case twin of HIGH"],
    ["c-none", "P1", "CRITICAL", "a P label"],
    ["c-none", "P3", "INFORMATIONAL", "a P label below the line"],
    ["c-none", "Major issue", "CRITICAL", "a compound label by its first word"],
    ["c-none", "nit", "INFORMATIONAL", "a case twin of NIT"],
    ["c-none", "Severe", null, "a label no row names"],
    ["c-none", "unlabelled", UNLABELLED, "extraction's sentinel"],
    ["c-on", "UNLABELLED", UNLABELLED, "extraction's sentinel in capitals"],
  ];
  for (const [arm, label, want, why] of rows) test(arm + " " + JSON.stringify(label) + " maps to " + want + " (" + why + ")", () => expect(sev(arm, label)).toBe(want as never));

  test("the unlabelled sentinel is never blocking and never unmapped", () => {
    expect(sev("c-on", "unlabelled")).not.toBe("CRITICAL");
    expect(sev("c-on", "unlabelled")).not.toBeNull();
  });

  test("readerOf follows renderFindings: confirmed, unconfirmed or none", () => {
    expect(readerOf({})).toBeNull();
    expect(readerOf({ confirmed: true })).toBe("confirmed");
    expect(readerOf({ confirmed: false })).toBe("unconfirmed");
  });
});
