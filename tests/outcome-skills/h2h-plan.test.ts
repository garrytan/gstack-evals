// Copyright (c) 2026 Garry Tan. MIT License.
// The head-to-head's session plan (post sections 5, 6 and 11): the arms per unit kind, the item per stage and arm, and a
// seeded order from prereg.json's order_seed that keeps each unit's sessions together with its arms interleaved.
import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PREREG_PATH, readPrereg } from "../../lanes/outcome-skills/h2h/prereg.ts";
import { armsFor, itemOf, planStage, readPlan, writePlan } from "../../lanes/outcome-skills/h2h/sessions/plan.ts";
import type { H2hUnit, Stage, UnitKind } from "../../lanes/outcome-skills/h2h/types.ts";

const P = readPrereg();
const unit = (id: string, kind: UnitKind, stage: Stage | "reserve", entry: "bug" | "feature" = "bug"): H2hUnit => ({ id, class: kind === "O" ? "O" : "B", kind, repo: "o/" + id, month: "2026-07", language: "go", entry, image_digest: "sha256:" + "0".repeat(64), licence: "MIT", position: 1, stage });

test("stage 0's four units plan the post's 33 sessions on h2h-smoke", () => {
  const plan = planStage([unit("ob", "O", "stage0"), unit("of", "O", "stage0", "feature"), unit("b1", "B1", "stage0"), unit("b2", "B2", "stage0")], "stage0");
  expect(plan.sessions.length).toBe((JSON.parse(readFileSync(PREREG_PATH, "utf8")) as { stage0: { sessions: number } }).stage0.sessions);
  expect(new Set(plan.sessions.map((s) => s.item))).toEqual(new Set(["h2h-smoke"]));
  expect(plan.sessions.filter((s) => s.unit === "of").every((s) => s.entry === "feature")).toBe(true);
  expect(plan.sessions.filter((s) => s.unit === "b1").map((s) => s.entry)).toEqual(Array(8).fill("bug"));
  expect(plan.sessions.map((s) => s.index)).toEqual([...Array(33).keys()]);
});

test("arms per kind and items per stage", () => {
  expect(armsFor("O")).toEqual([...P.arms.primary, ...P.arms.piece_g]);
  expect(armsFor("B1")).toEqual([...P.arms.primary, ...P.arms.secondary]);
  expect(armsFor("B2")).toEqual([...P.arms.primary]);
  expect(itemOf("stage1", "gstack-qa")).toBe("h2h-pilot");
  expect(itemOf("stage2", "tstack")).toBe("h2h-opus");
  expect(itemOf("stage2", "gstack-oneline")).toBe("h2h-pony");
  expect(itemOf("stage2", "gstack-qa")).toBe("h2h-qa");
});

test("the order is seeded per stage, keeps a unit's sessions together and interleaves its arms", () => {
  const units = [unit("u1", "O", "stage2"), unit("u2", "O", "stage2"), unit("u3", "B1", "stage2")];
  const a = planStage(units, "stage2");
  expect(planStage(units, "stage2")).toEqual(a);
  expect(a.order_seed).toBe(P.order_seed);
  expect(a.sessions.map((s) => s.unit)).toEqual([...Array(9).fill("u1"), ...Array(9).fill("u2"), ...Array(8).fill("u3")]);
  const u1 = a.sessions.filter((s) => s.unit === "u1").map((s) => s.arm);
  const u2 = a.sessions.filter((s) => s.unit === "u2").map((s) => s.arm);
  expect(new Set(u1)).toEqual(new Set(armsFor("O")));
  expect(u1).not.toEqual(armsFor("O"));
  expect(u1).not.toEqual(u2);
  const other = planStage(units.map((u) => ({ ...u, stage: "stage1" as const })), "stage1");
  expect(other.sessions.map((s) => s.arm)).not.toEqual(a.sessions.map((s) => s.arm));
});

test("refuses a unit drawn for another stage, a duplicate, a kind outside its class, and a plan edited after writing", () => {
  expect(() => planStage([unit("u1", "O", "stage1")], "stage2")).toThrow(/^E_H2H_SESSION_INPUT /);
  expect(() => planStage([unit("u1", "O", "stage2"), unit("u1", "O", "stage2")], "stage2")).toThrow(/^E_H2H_SESSION_INPUT /);
  expect(() => planStage([{ ...unit("u1", "B1", "stage2"), class: "O" }], "stage2")).toThrow(/^E_H2H_SESSION_INPUT /);
  expect(planStage([unit("r1", "O", "reserve")], "stage2").sessions.length).toBe(9);
  const dir = mkdtempSync(join(tmpdir(), "h2h-plan-"));
  const file = join(dir, "plan.json");
  const plan = planStage([unit("u1", "B2", "stage2")], "stage2");
  writePlan(file, plan);
  expect(readPlan(file)).toEqual(plan);
  expect(() => writePlan(file, plan)).toThrow(/^E_H2H_SESSION_INPUT /);
  writeFileSync(file, JSON.stringify({ ...plan, sessions: [...plan.sessions].reverse() }));
  expect(() => readPlan(file)).toThrow(/^E_H2H_SESSION_INPUT /);
  rmSync(dir, { recursive: true, force: true });
});
