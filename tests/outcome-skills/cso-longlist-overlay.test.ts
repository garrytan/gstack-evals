// Copyright (c) 2026 Garry Tan. MIT License.
// GEVA-589's dated plan change: the long-list try reads longlist.json under CSO_PLAN=longlist, the rerun's overlay at
// gstack dfeaed61, with its own cso3 items for the ledger, the driver and the judge.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { LONGLIST_ITEMS, LONGLIST_PATH, PREREG_PATH, RERUN_ITEMS, RERUN_PATH, loadCsoPrereg } from "../../lanes/outcome-skills/cso/prereg.ts";
import { CSO_STAGES, csoStages } from "../../lanes/outcome-skills/cso/driver.ts";
import { judgeItem, JUDGE_ITEM } from "../../lanes/outcome-skills/cso/judge/meter.ts";

const parent = loadCsoPrereg(PREREG_PATH, {});
const rerun = loadCsoPrereg(PREREG_PATH, { CSO_PLAN: "rerun" });
const longlist = loadCsoPrereg(PREREG_PATH, { CSO_PLAN: "longlist" });

test("CSO_PLAN=longlist pins gstack dfeaed61 and changes nothing else the rerun overlay sets", () => {
  expect(longlist.pins.gstack.sha).toBe("dfeaed615e6f63e7834a71df2f89b450660479e6");
  expect(Object.keys(longlist.items).sort()).toEqual([...LONGLIST_ITEMS].sort());
  expect(longlist.judge).toEqual(rerun.judge);
  expect(longlist.scoring).toEqual(parent.scoring);
  expect(longlist.limits).toEqual(rerun.limits);
  expect(longlist.models).toEqual(rerun.models);
  const a = JSON.parse(readFileSync(RERUN_PATH, "utf8"));
  const b = JSON.parse(readFileSync(LONGLIST_PATH, "utf8"));
  for (const k of ["schema", "parent", "parent_prereg_json_sha256", "gold_seed", "seeds_from_parent", "limits", "exposure", "yield", "analysis", "judge"]) expect(b[k]).toEqual(a[k]);
  expect(b.pins.old_cso_arm).toEqual(a.pins.old_cso_arm);
  expect(Object.keys(b.pins.gstack.files_sha256).sort()).toEqual(Object.keys(a.pins.gstack.files_sha256).sort());
});

test("the rerun plan still reads rerun.json with its cso2 items, and an unknown plan is refused", () => {
  expect(rerun.pins.gstack.sha).toStartWith("a3ecfd53");
  expect(Object.keys(rerun.items).sort()).toEqual([...RERUN_ITEMS].sort());
  expect(() => loadCsoPrereg(PREREG_PATH, { CSO_PLAN: "constructor" })).toThrow(/^E_CSO_PREREG /);
  expect(() => loadCsoPrereg(PREREG_PATH, { CSO_PLAN: "longlist2" })).toThrow(/^E_CSO_PREREG .*longlist/);
});

test("each plan's driver stages and judge item are its own", () => {
  expect(csoStages(parent)).toEqual(CSO_STAGES);
  const s = csoStages(longlist);
  expect(s["cso3-pilot"]).toEqual(["cso:cso"]);
  expect(s["cso3-main"]).toEqual(["cso:cso"]);
  expect(Object.keys(s)).not.toContain("cso2-main");
  expect(Object.keys(csoStages(rerun))).toEqual([...Object.keys(CSO_STAGES), "cso2-pilot", "cso2-main"]);
  expect([judgeItem(parent), judgeItem(rerun), judgeItem(longlist)]).toEqual([JUDGE_ITEM, "cso2-judge", "cso3-judge"]);
});
