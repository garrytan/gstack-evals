// Copyright (c) 2026 Garry Tan. MIT License.
// Batch plans (lanes/decision-routing/host/plans.ts) from the frozen draw lists: counts match draw.txt and each ledger
// item's session count in config/items.json, and the controller's parsePlan accepts every plan.

import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parsePlan } from "../../lanes/decision-routing/host/controller.ts";
import { buildPlans, main } from "../../lanes/decision-routing/host/plans.ts";

const PREREG = join(import.meta.dir, "../../wiki/plans/2026-11-09-geva-411-decision-routing-prereg");
const draw = readFileSync(join(PREREG, "draw.txt"), "utf8");
const count = (list: string) => Number(new RegExp("^" + list + " (\\d+) ", "m").exec(draw)![1]);
const small = /^pilot small \(first 12\) (.+)$/m.exec(draw)![1]!.split(" ");
const items = JSON.parse(readFileSync(join(import.meta.dir, "../../lanes/decision-routing/config/items.json"), "utf8")).items as Array<{ item: string; what: string }>;
const plans = buildPlans(PREREG);
const tasks = (rows: Array<{ task: string }>) => new Set(rows.map((r) => r.task));

test("each item's session count is the one config/items.json states", () => {
  const all = Object.values(plans).flat();
  for (const i of items.filter((x) => /\((\d+) sessions\)/.test(x.what))) {
    expect([i.item, all.filter((r) => r.item === i.item).length]).toEqual([i.item, Number(/\((\d+) sessions\)/.exec(i.what)![1])]);
  }
});

test("task counts follow draw.txt: 40 calibration, 20 and 12 pilot, 280 scored, 100 subset", () => {
  expect(tasks(plans.calibration).size).toBe(count("calibration.txt"));
  expect(tasks(plans.pilot.filter((r) => r.item === "dr-pilot-rp")).size).toBe(count("pilot.txt"));
  expect([...tasks(plans.pilot.filter((r) => r.item === "dr-pilot-jfw"))].sort()).toEqual([...small].sort());
  expect(tasks(plans.scored).size).toBe(count("scored.txt"));
  expect(tasks(plans.subset).size).toBe(count("subset.txt"));
});

test("cells and models per stage", () => {
  const cells = (rows: Array<{ cell: string; model: string; item: string }>) => [...new Set(rows.map((r) => r.item + " " + r.cell + " " + r.model))].sort();
  expect(cells(plans.calibration)).toEqual(["dr-calibration-r2 N opus", "dr-calibration-r2 N sol"]);
  expect(cells(plans.pilot)).toEqual(["dr-pilot-jfw F opus", "dr-pilot-jfw J opus", "dr-pilot-jfw J sol", "dr-pilot-jfw W particle", "dr-pilot-rp P opus", "dr-pilot-rp P sol", "dr-pilot-rp R opus", "dr-pilot-rp R sol"]);
  expect(cells(plans.scored)).toEqual(["dr-scored-opus N opus", "dr-scored-opus P opus", "dr-scored-opus R opus", "dr-scored-sol N sol", "dr-scored-sol P sol", "dr-scored-sol R sol"]);
  expect(cells(plans.subset)).toEqual(["dr-subset F opus", "dr-subset J opus", "dr-subset J sol", "dr-w-reference W particle"]);
});

test("main writes one plan per stage that the controller accepts", async () => {
  const out = mkdtempSync(join(tmpdir(), "dr-plans-"));
  try {
    expect(await main(["--out", out])).toBe(0);
    for (const stage of ["calibration", "pilot", "scored", "subset"]) expect(parsePlan(readFileSync(join(out, stage + ".json"), "utf8")).length).toBe(plans[stage as keyof typeof plans].length);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
