// Copyright (c) 2026 Garry Tan. MIT License.
// Plan section 3, gate 6, and deviation (a): the id scan's needle file. With no units there are no needles, and the file
// is empty, so scan-ids.sh exits before grep; a lone newline would be an empty pattern that matches every line of every
// file (a 2 GB installed home then took over 40 minutes). With needles, one pattern a line, CVE ids with their right edge.
import { expect, test } from "bun:test";
import { needleFile, scanIds, unitNeedles } from "../../lanes/outcome-skills/cso/units/ids.ts";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("no units give an empty needle file and a scan with no hits; units give one pattern a line", () => {
  expect(needleFile([])).toBe("");
  const ns = unitNeedles({ unit: "u1", ghsa: "GHSA-2222-3333-4444", cves: ["CVE-2026-1111"], fix_commit: "a".repeat(40) });
  expect(needleFile([...ns, ...ns]).split("\n").filter(Boolean)).toEqual(["ghsa-2222-3333-4444", "cve-2026-1111([^0-9]|$)", ns[2]!.needle]);
  const root = mkdtempSync(join(tmpdir(), "cso-needles-"));
  try {
    writeFileSync(join(root, "a.txt"), "GHSA-2222-3333-4444\nnothing\n");
    expect(scanIds(root, []).hits).toEqual([]);
    expect(scanIds(root, [{ unit: "u1", ghsa: "GHSA-2222-3333-4444", cves: [], fix_commit: "b".repeat(40) }]).hits.map((h) => h.unit)).toEqual(["u1"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
