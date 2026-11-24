// Copyright (c) 2026 Garry Tan. MIT License.
// GEVA-583 prereg section 9 item 1: the rerun overlay read under CSO_PLAN=rerun, the rerun's session items, and the
// helper run records a session saves out.
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { PREREG_PATH, RERUN_ITEMS, RERUN_PATH, loadCsoPrereg, withRerun } from "../../lanes/outcome-skills/cso/prereg.ts";
import { CSO_STAGES, csoStages } from "../../lanes/outcome-skills/cso/driver.ts";
import { readRunRecords } from "../../lanes/outcome-skills/cso/run.ts";

const parent = loadCsoPrereg(PREREG_PATH, {});
const rerun = JSON.parse(readFileSync(RERUN_PATH, "utf8"));
const sha = createHash("sha256").update(readFileSync(PREREG_PATH)).digest("hex");

test("CSO_PLAN=rerun pins the new gstack, keeps only the rerun's items and sets the pooled judge check's rules", () => {
  const p = loadCsoPrereg(PREREG_PATH, { CSO_PLAN: "rerun" });
  expect(p.pins.gstack.sha).toStartWith("a3ecfd53");
  expect(Object.keys(p.items).sort()).toEqual([...RERUN_ITEMS].sort());
  expect(p.judge.check_reports_min).toBe(100);
  expect(p.judge.anchor_fill).toBe(false);
  expect(p.rerun?.schema).toBe("cso-rerun-prereg.v1");
  expect(p.models).toEqual(parent.models);
  expect(p.limits).toEqual(parent.limits);
  expect(parent.rerun).toBeUndefined();
  expect(parent.pins.gstack.sha).not.toBe(p.pins.gstack.sha);
});

test("the overlay refuses another plan name, another parent prereg.json, another schema and a missing item", () => {
  expect(() => loadCsoPrereg(PREREG_PATH, { CSO_PLAN: "rerun2" })).toThrow(/^E_CSO_PREREG /);
  expect(() => withRerun(parent, rerun, "0".repeat(64))).toThrow(/^E_CSO_PREREG .*parent prereg\.json/);
  expect(() => withRerun(parent, { ...rerun, schema: "cso-rerun-prereg.v0" }, sha)).toThrow(/^E_CSO_PREREG .*schema/);
  const { ["cso2-main"]: _, ...items } = rerun.items;
  expect(() => withRerun(parent, { ...rerun, items }, sha)).toThrow(/^E_CSO_PREREG .*cso2-main/);
  expect(() => withRerun(parent, { ...rerun, pins: { gstack: { sha: "a3ecfd53" } } }, sha)).toThrow(/^E_CSO_PREREG .*gstack pin/);
});

test("the rerun's session items serve the cso arm only, and only under the overlay", () => {
  expect(csoStages(parent)).toEqual(CSO_STAGES);
  expect(Object.keys(csoStages(parent))).not.toContain("cso2-main");
  const s = csoStages(loadCsoPrereg(PREREG_PATH, { CSO_PLAN: "rerun" }));
  expect(s["cso2-pilot"]).toEqual(["cso:cso"]);
  expect(s["cso2-main"]).toEqual(["cso:cso"]);
  expect(s["cso-main"]).toEqual(CSO_STAGES["cso-main"]!);
});

test("readRunRecords reads each saved report.json in path order and leaves out unreadable ones", () => {
  const d = mkdtempSync(join(tmpdir(), "cso-records-"));
  expect(readRunRecords(join(d, "missing"))).toEqual([]);
  const put = (repo: string, run: string, body: string) => {
    mkdirSync(join(d, repo, run), { recursive: true });
    writeFileSync(join(d, repo, run, "report.json"), body);
  };
  put("repo-b", "2", JSON.stringify({ runId: "2", status: "finished" }));
  put("repo-a", "1", JSON.stringify({ runId: "1", status: "running" }));
  put("repo-a", "3", "{not json");
  mkdirSync(join(d, "repo-a", "4"), { recursive: true });
  expect(readRunRecords(d)).toEqual([{ runId: "1", status: "running" }, { runId: "2", status: "finished" }]);
});
