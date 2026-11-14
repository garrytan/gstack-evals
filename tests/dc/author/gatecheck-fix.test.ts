// Copyright (c) 2026 Garry Tan. MIT License.
// PD-35's keyless defect checks for the gate check's fix step, on the author area's fixture unit: B2's check reads
// whether a cited evidence line supports the item's detail, and B6's whether the item's named component is in the
// base-app file it cites. The runner's use of them is driven by author/dryrun-cases.ts's PD-35 cases.
import { describe, expect, test } from "bun:test";
import { CONTEXT, EVIDENCE, FIXTURE_APP, ITEMS, PLAN, WRONG_WAY } from "../../../lanes/design-constructed/author/fixture.ts";
import { componentProblem, DEFECT_CHECKS, defectProblem, supportProblem } from "../../../lanes/design-constructed/author/gatecheck.ts";
import { intake, type UnitFiles } from "../../../lanes/design-constructed/author/unit.ts";
import type { ItemClass, KeyItem } from "../../../lanes/design-constructed/types.ts";

const files = (): UnitFiles => ({ plan: PLAN, context: CONTEXT, evidence: structuredClone(EVIDENCE), key: { items: intake("fix", ITEMS, []), wrongWay: [...WRONG_WAY], decoy: null } });
const itemOf = (u: UnitFiles, c: ItemClass): KeyItem => u.key.items.find((i) => i.class === c)!;
const releases = EVIDENCE.find((e) => e.path.includes("releases"))!;
const lineOf = (start: string) => releases.text.split("\n").findIndex((l) => l.startsWith(start)) + 1;

describe("PD-35: B2's support check", () => {
  // Value: protects=PD-35's B2 reading, a pointer resolving to a supporting evidence line; fails_when=an item whose cited lines hold no word of its detail passes, a supported item fails, or an item citing only base-app files passes; why_new=WIRING item 27's stricter read of "the defect gone"; seam=supportProblem; no_claim=what a model auditor reads as support
  test("a cited line holding a word of the detail passes; an unrelated line, or no evidence line at all, fails", () => {
    const u = files();
    const s = itemOf(u, "S");
    expect(supportProblem(s, u)).toBeNull();
    const moved = { ...s, evidence: [{ file: releases.path, line: lineOf("- The dashboard shows cash") }] };
    expect(supportProblem(moved, u)).toContain("hold no word of its detail");
    expect(supportProblem({ ...moved, statement: s.statement + " today" }, u)).toContain("hold no word of its detail");
    expect(supportProblem({ ...moved, detail: "cash received shown as two numbers" }, u)).toBeNull();
    const y = itemOf(u, "Y");
    expect(supportProblem({ ...y, evidence: y.evidence.filter((p) => p.file.startsWith("src/")) }, u)).toContain("cites no evidence file line");
  });
});

describe("PD-35: B6's component check", () => {
  // Value: protects=PD-35's B6 reading, the Y item citing the right component; fails_when=an item naming a component its cited base-app file doesn't hold passes, the fixture's correct Y item fails, or an item naming a component only inside a file path passes; why_new=WIRING item 27's stricter read of "the defect gone"; seam=componentProblem, defectProblem, DEFECT_CHECKS; no_claim=tokens and patterns, which the check doesn't read
  test("a named component the cited file holds passes; one it doesn't hold, or a name only inside a path, fails", () => {
    const u = files();
    const y = itemOf(u, "Y");
    expect(componentProblem(y, u, FIXTURE_APP)).toBeNull();
    const wrong = { ...y, statement: y.statement.replace("shared DataTable in", "shared StatusPill in") };
    expect(componentProblem(wrong, u, FIXTURE_APP)).toContain("names StatusPill");
    expect(componentProblem({ ...wrong, statement: wrong.statement.replace("sortable columns", "fully sortable columns") }, u, FIXTURE_APP)).toContain("names StatusPill");
    expect(componentProblem({ ...y, statement: "The payments table needs sortable columns, as in src/components/DataTable.tsx.", detail: "reuse its sortable header row" }, u, FIXTURE_APP)).toContain("names no component");
    expect(componentProblem({ ...y, evidence: y.evidence.filter((p) => p.file.startsWith("docs/")) }, u, FIXTURE_APP)).toContain("cites no base-app file");
    expect(DEFECT_CHECKS).toEqual({ B2: "support", B6: "component" });
    expect(defectProblem("component", wrong, u, FIXTURE_APP)).toBe(componentProblem(wrong, u, FIXTURE_APP));
  });
});
