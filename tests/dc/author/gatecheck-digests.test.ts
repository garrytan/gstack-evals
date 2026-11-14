// Copyright (c) 2026 Garry Tan. MIT License.
// The gate check reads only the sealed planted units: the committed digest table's shape, and the refusal of units
// that differ from it, on invented units built from the author area's fixture.
import { describe, expect, test } from "bun:test";
import { CONTEXT, EVIDENCE, FIXTURE_APP, ITEMS, PLAN, WRONG_WAY } from "../../../lanes/design-constructed/author/fixture.ts";
import { checkPlantedDigests, loadPlantedTable, runGateCheck, tableOf, type PlantedName, type PlantedUnit } from "../../../lanes/design-constructed/author/gatecheck.ts";
import type { Deps } from "../../../lanes/design-constructed/author/seams.ts";
import { intake } from "../../../lanes/design-constructed/author/unit.ts";
import { DcError } from "../../../lanes/design-constructed/errors.ts";
import type { ItemClass } from "../../../lanes/design-constructed/types.ts";

const CLASSES: Record<PlantedName, ItemClass | null> = { G1: null, G2: null, B1: null, B2: "A", B3: null, B4: "R", B5: "S", B6: "Y" };

const invented = (): PlantedUnit[] =>
  (Object.keys(CLASSES) as PlantedName[]).map((name) => ({
    name,
    unitId: "invented-" + name,
    files: { plan: PLAN, context: CONTEXT, evidence: structuredClone(EVIDENCE), key: { items: intake("invented-" + name, ITEMS, []), wrongWay: WRONG_WAY, decoy: null } },
    app: FIXTURE_APP,
    author: "sol",
    bundle: "BUNDLE",
    plantedClass: CLASSES[name],
  }));

const refusal = (f: () => unknown): string | null => {
  try {
    f();
    return null;
  } catch (e) {
    return e instanceof DcError && e.code === "E_PLANTED_DIGEST" ? e.message : "other error: " + String(e);
  }
};

describe("the planted units' digest table", () => {
  test("the committed table names the eight planted units with sha256 values only", () => {
    const t = loadPlantedTable();
    const hex = /^[0-9a-f]{64}$/;
    expect(t.sealed_tar_sha256).toMatch(hex);
    expect(Object.keys(t.units).sort()).toEqual(Object.keys(CLASSES).sort());
    for (const u of Object.values(t.units)) {
      expect(u!.digest).toMatch(hex);
      const roles = Object.keys(u!.files);
      expect(roles.filter((r) => !/^(plan\.md|context\/project\.md|evidence\/[1-8]|key\.json|unit\.json)$/.test(r))).toEqual([]);
      expect(roles.filter((r) => r.startsWith("evidence/")).length).toBeGreaterThanOrEqual(5);
      for (const v of Object.values(u!.files)) expect(v).toMatch(hex);
    }
  });

  test("units that match their table pass, and a flag change alone moves nothing", () => {
    const units = invented();
    const table = tableOf(units);
    units[2]!.files.key.items[0]!.drop = "audit";
    units[2]!.files.key.items[1]!.generic = true;
    expect(refusal(() => checkPlantedDigests(units, table))).toBeNull();
  });

  test("a changed evidence file is refused with E_PLANTED_DIGEST, naming the unit and the part", () => {
    const units = invented();
    const table = tableOf(units);
    units[4]!.files.evidence[1]!.text += " ";
    const m = refusal(() => checkPlantedDigests(units, table));
    expect(m).toContain(units[4]!.name + ": evidence/2, digest");
    expect(m).not.toContain(units[3]!.name + ":");
  });

  test("a changed item wording, a dropped evidence file or a missing unit is refused", () => {
    const base = invented();
    const table = tableOf(base);
    const reworded = invented();
    reworded[0]!.files.key.items[0]!.statement += " now";
    expect(refusal(() => checkPlantedDigests(reworded, table))).toContain(reworded[0]!.name + ": digest");
    const fewer = invented();
    fewer[1]!.files.evidence.pop();
    expect(refusal(() => checkPlantedDigests(fewer, table))).toContain("evidence files, table");
    const partial = { ...table, units: { ...table.units, B6: undefined } };
    expect(refusal(() => checkPlantedDigests(base, partial))).toContain("B6: not in the table");
  });

  test("the gate check refuses differing units before any model call", async () => {
    const units = invented();
    const table = tableOf(units);
    units[7]!.files.plan += "\n";
    let calls = 0;
    const deps: Deps = { call: async () => { calls++; throw new Error("no call expected"); }, parseBlock: () => null, vocabulary: new Set(), today: "2026-11-14" };
    const got = await runGateCheck(units, deps, table).then(() => "ran", (e) => (e instanceof DcError ? e.code + " " + e.message : String(e)));
    expect(got).toStartWith("E_PLANTED_DIGEST");
    expect(got).toContain(units[7]!.name + ": plan.md, digest");
    expect(calls).toBe(0);
  });

  test("the invented units are refused by the committed table", () => {
    expect(refusal(() => checkPlantedDigests(invented(), loadPlantedTable()))).toContain("G1: ");
  });
});
