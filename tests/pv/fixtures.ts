// Copyright (c) 2026 Garry Tan. MIT License.
// Synthetic fixtures for the product-value scoring tests: units, keys and rows written for these tests, from no unit.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordApproval } from "../../src/runner/ledger/ledger.ts";
import type { Io } from "../../lanes/product-value/cli.ts";
import type { LoadedUnit, Normalize } from "../../lanes/product-value/io.ts";
import type { Key, KeyItem, ModelId, Row, UnitMeta } from "../../lanes/product-value/types.ts";

export const tmp = () => mkdtempSync(join(tmpdir(), "pv-test-"));
export const identity: Normalize = (xs) => xs.slice(0, 5).map((s) => s.replace(/\s+/g, " ").trim());
export const ENV = { ANTHROPIC_API_KEY: "test", OPENAI_API_KEY: "test", OPENROUTER_API_KEY: "test" };

export const meta = (id: string, over: Partial<UnitMeta> = {}): UnitMeta => ({ id, set: "calibration", source: "public", source_kind: "plan", type: "other", plan_date: "2026-08-01", rank: 1, ...over });
export const item = (id: string, over: Partial<KeyItem> = {}): KeyItem => ({ id, kind: "U", statement: "People needed tag-" + id + " in daily use.", evidence: [], outside_users: 2, mentioned: false, generic: false, foreseeable: "yes", ...over });
export const keyOf = (unit: string, ids: string[], extra: KeyItem[] = []): Key => ({ unit, items: [...ids.map((i) => item(i)), ...extra], primary: ids, commitments: ["Build the first part.", "Build the second part.", "Build the third part."] });

export function unitsMap(specs: Array<{ meta: UnitMeta; key: Key | null }>): Map<string, LoadedUnit> {
  return new Map(specs.map((s) => [s.meta.id, { meta: s.meta, key: s.key, dir: "/nonexistent/" + s.meta.id }]));
}

export function writeUnits(dir: string, specs: Array<{ meta: UnitMeta; key: Key }>): void {
  for (const s of specs) {
    const u = join(dir, s.meta.id);
    mkdirSync(join(u, "context"), { recursive: true });
    writeFileSync(join(u, "unit.json"), JSON.stringify(s.meta));
    writeFileSync(join(u, "key.json"), JSON.stringify(s.key));
    writeFileSync(join(u, "plan.md"), "The team will build a small feature for " + s.meta.id + ".");
    writeFileSync(join(u, "brief.md"), "Users of " + s.meta.id + " asked for a small feature.");
    writeFileSync(join(u, "context", "about.md"), "A tool for testing.");
  }
}

export function row(over: Partial<Row> & { unit: string; session: string }): Row {
  const list = over.list === undefined ? ["Plan for tag-a"] : over.list;
  return { family: "plan", arm: "none", model: "opus", pass: 1, end: list ? "block" : "no-block", words: list ? list.join(" ").split(" ").length : 0, items: list?.length ?? 0, cut: 0, exposed: null, spend_micros: 0, list, ...over };
}

/** Rows for a stage 1 calibration slice: Opus none 3 passes, Sol and particle-1 none 2 passes, each list naming the first tag. */
export function stage1Rows(units: string[], tag: (u: string) => string): Row[] {
  const out: Row[] = [];
  for (const u of units)
    for (const [model, passes] of [["opus", 3], ["sol", 2], ["particle", 2]] as Array<[ModelId, number]>)
      for (let p = 1; p <= passes; p++) out.push(row({ unit: u, session: u + "-" + model + "-" + p, model, pass: p, list: ["Plan for " + tag(u) + " now", "Write more tests"] }));
  return out;
}

export function capture(): { io: Io; out: string[]; err: string[] } {
  const out: string[] = [], err: string[] = [];
  return { io: { out: (t) => out.push(t), err: (t) => err.push(t) }, out, err };
}

export function ledgerWith(dir: string, items: string[]): { record: string; ledger: string } {
  const record = join(dir, "record"), ledger = join(dir, "ledger.sqlite");
  for (const i of items) recordApproval(record, { action: "init", item: i, cap_micros: 50_000_000, quotes: [{ words: "test", by: "test", source: "test" }], admission: "warn" });
  return { record, ledger };
}
