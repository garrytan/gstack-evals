// Copyright (c) 2026 Garry Tan. MIT License.
// Pilot rules (preregistration section 8): re-cost, drop order, particle-1 max_tokens fallback, pilot session stop.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { DROPS, FULL_SCOPE, ITEMS_FILE, particleNoAnswers, pilotSessionStops, plan, PLANNING_RATE, printRecost, recost, type ItemsFile } from "../../lanes/decision-routing/score/pilot.ts";

const items = JSON.parse(readFileSync(ITEMS_FILE, "utf8")) as ItemsFile;

test("planning rates reproduce every cap in items.json, a closed item at what it settled, and the all-in", () => {
  const p = plan(PLANNING_RATE, FULL_SCOPE, items);
  for (const it of items.items) expect(p.items.find((x) => x.item === it.item)?.cap).toBe((it.closed_micros ?? it.cap_micros) / 1e6);
  expect(p.items.find((x) => x.item === "dr-calibration")).toEqual({ item: "dr-calibration", sessions: 0, expected: 1.144225, cap: 1.144225 });
  expect(p.items.find((x) => x.item === "dr-calibration-r2")).toEqual({ item: "dr-calibration-r2", sessions: 0, expected: 1.923524, cap: 1.923524 });
  expect(p.items.find((x) => x.item === "dr-calibration-r3")).toMatchObject({ sessions: 80, cap: 86.93 });
  expect(Math.round(p.all_in_cap * 1e6)).toBe(2_139_997_749);
  expect(items.line_micros).toBe(2_140_000_000);
  expect(p.sessions).toBe(2288);
  expect(recost({}).dropped).toEqual([]);
});

test("each rate is the higher of planning rate and pilot mean", () => {
  const r = recost({ "R:opus": 0.5, "P:sol": 0.1 });
  expect(r.rate["R:opus"]).toBe(0.5);
  expect(r.rate["P:sol"]).toBe(0.33);
});

test("drops follow W, J on Sol, F, subset 100 to 80, and stop once the caps fit", () => {
  const one = recost({ "R:opus": 0.38, "R:sol": 0.4 });
  expect(one.dropped).toEqual([DROPS[0]!.label]);
  expect(one.fits).toBe(true);
  const all = recost({ "R:opus": 0.9, "R:sol": 0.9, "P:opus": 0.8, "P:sol": 0.8 });
  expect(all.dropped).toEqual(DROPS.map((d) => d.label));
  expect(printRecost(all).filter((l) => l.startsWith("not run under the line: "))).toHaveLength(4);
  expect(all.fits).toBe(false);
});

test("particle-1 max_tokens rises to 16000 only past 2% no-answers; states over the limit and shadow rows do not count", () => {
  const rows = (n: number, miss: number) => Array.from({ length: n }, (_, i) => ({ mode: "live", layers: { particle: { ok: i >= miss, error: i < miss ? "missing" : null } } }));
  expect(particleNoAnswers([...rows(100, 2), { mode: "live", layers: { particle: { ok: false, error: "state_over_limit" } } }, { mode: "shadow", layers: { particle: { ok: false } } }]).max_tokens).toBe(8000);
  expect(particleNoAnswers(rows(100, 3)).max_tokens).toBe(16000);
});

test("a pilot session past $2.50 prints DR_PILOT_SESSION_STOP first", () => {
  const s = pilotSessionStops([{ session: "a", usd: 2.5 }, { session: "b", usd: 2.51 }]);
  expect(s).toHaveLength(1);
  expect(s[0]!.startsWith("DR_PILOT_SESSION_STOP ")).toBe(true);
});
