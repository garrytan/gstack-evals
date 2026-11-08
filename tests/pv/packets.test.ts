// Copyright (c) 2026 Garry Tan. MIT License.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { oracleList } from "../../lanes/product-value/oracle.ts";
import { buildCheckPackets, buildLabelPackets, buildPairwisePackets, buildProbePackets, drawGold, goldCells, listKey, run, STOCK_ROWS, type GoldRef, type LabelRecord, type PacketFile } from "../../lanes/product-value/packets.ts";
import { seededRandom, SEED } from "../../lanes/product-value/stats.ts";
import type { ProjectType } from "../../lanes/product-value/types.ts";
import { capture, identity, keyOf, meta, row, stage1Rows, tmp, unitsMap, writeUnits } from "./fixtures.ts";

const TYPES: ProjectType[] = ["mobile", "mobile", "server", "server", "consumer", "consumer", "other", "other"];
const specs = TYPES.map((t, i) => ({ meta: meta("u" + i, { type: t }), key: keyOf("u" + i, ["a" + i, "b" + i]) }));
const units = unitsMap(specs);
const oracle = { version: 1 as const, units: Object.fromEntries(specs.map((s) => [s.meta.id, oracleList(s.key)])) };
const rows = stage1Rows(TYPES.map((_, i) => "u" + i), (u) => "tag-a" + u.slice(1));

describe("label packets (sections 7 and 8)", () => {
  const built = buildLabelPackets({ family: "plan", stage: 1, seed: SEED, units, rows, normalize: identity, oracle });
  const metas = Object.values(built.map.packets);

  test("one production packet per (unit, model) with that model's lists across passes, the three stock rows and the oracle list", () => {
    const prod = metas.filter((m) => m.role === "production");
    expect(prod).toHaveLength(24);
    const opus = prod.find((m) => m.unit === "u0" && m.model === "opus")!;
    const kinds = Object.values(opus.lists).map((l) => l.kind).sort();
    expect(kinds).toEqual(["arm", "arm", "arm", "oracle", "stock", "stock", "stock"]);
    expect(opus.judges).toEqual(["astra"]);
    expect(prod.find((m) => m.model === "sol")!.judges).toEqual(["opus"]);
    expect(prod.find((m) => m.model === "particle")!.judges).toEqual(["astra", "opus"]);
  });

  test("stock rows are section 8's text, verbatim", () => {
    const p = built.packets.find((x) => built.map.packets[x.id]!.role === "production")!;
    const m = built.map.packets[p.id]!;
    for (const l of p.lists) if (m.lists[l.id]!.kind === "stock") expect(l.changes).toEqual([...STOCK_ROWS[m.lists[l.id]!.stock! - 1]!]);
    expect(STOCK_ROWS[0]![2]).toBe("Make it work well on Windows, in containers and in CI environments.");
  });

  test("packets carry random ids and statements only: no unit id, arm, model or session", () => {
    for (const p of built.packets) {
      const text = JSON.stringify(p);
      expect(text).not.toMatch(/"u\d"|opus|sol|particle|none|skill|lens|session|-opus-/);
      expect(p.items.every((i) => /^[a-z2-9]{6}$/.test(i.id))).toBe(true);
    }
  });

  test("shuffled-key packets derange keys inside the project type where possible", () => {
    const sh = metas.filter((m) => m.role === "shuffled");
    expect(sh).toHaveLength(24);
    for (const m of sh) expect(m.unit).not.toBe(m.lists_unit);
    expect(sh.every((m) => units.get(m.unit)!.meta.type === units.get(m.lists_unit!)!.meta.type)).toBe(true);
  });

  test("the same seed builds the same packets; another seed does not", () => {
    const again = buildLabelPackets({ family: "plan", stage: 1, seed: SEED, units, rows, normalize: identity, oracle });
    expect(JSON.stringify(again.packets)).toBe(JSON.stringify(built.packets));
    const other = buildLabelPackets({ family: "plan", stage: 1, seed: SEED + 9, units, rows, normalize: identity, oracle });
    expect(JSON.stringify(other.packets)).not.toBe(JSON.stringify(built.packets));
  });

  test("brief-family packets add the plan's three commitments as items; stage 1 refuses a calibration unit with no oracle list", () => {
    const brief = buildLabelPackets({ family: "brief", stage: 1, seed: SEED, units, rows: rows.map((r) => ({ ...r, family: "brief" })), normalize: identity, oracle });
    const m = Object.values(brief.map.packets).find((x) => x.role === "production")!;
    expect(Object.values(m.items).filter((i) => i.kind === "C")).toHaveLength(3);
    expect(() => buildLabelPackets({ family: "plan", stage: 1, seed: SEED, units, rows, normalize: identity, oracle: { version: 1, units: {} } })).toThrow(/no oracle list/);
  });
});

describe("judge-check packets, gold cells and stage 2", () => {
  const check = buildCheckPackets({ family: "plan", stage: 1, seed: SEED, units, rows, normalize: identity, oracle });

  test("check packets mirror the label packets for Astra and Opus at the audit prompt, and need 48 change lists", () => {
    const metas = Object.values(check.map.packets);
    expect(metas).toHaveLength(24);
    expect(metas.every((m) => m.role === "check" && m.judges.join() === "astra,opus")).toBe(true);
    expect(check.packets.every((p) => p.prompt === "audit")).toBe(true);
    expect(() => buildCheckPackets({ family: "plan", stage: 1, seed: SEED, units, rows: rows.slice(0, 40), normalize: identity, oracle })).toThrow(/at least 48/);
  });

  test("gold cells are the cells where Astra and Opus agree", () => {
    const labels: LabelRecord[] = [];
    for (const p of check.packets)
      for (const l of p.lists)
        for (const i of p.items) {
          const yes = l.changes.some((c) => c.includes(i.statement.match(/tag-\w+/)![0]));
          for (const judge of ["astra", "opus"] as const) labels.push({ packet: p.id, judge, model_id: judge, version: null, effort: "max", list: l.id, item: i.id, label: { anticipated: judge === "opus" && i.statement.includes("tag-b0") ? !yes : yes, changes: yes ? [1] : judge === "opus" && i.statement.includes("tag-b0") ? [1] : [] } });
        }
    const gold = goldCells(check.map, labels);
    const total = check.packets.reduce((s, p) => s + p.lists.length * p.items.length, 0);
    expect(gold.length).toBeLessThan(total);
    expect(gold.some((g) => g.gold && g.ref.kind === "oracle")).toBe(true);
    expect(gold.some((g) => g.gold && g.ref.kind === "arm")).toBe(true);
  });

  test("drawGold takes 20 anticipated with oracle cells never above the real ones, then not-anticipated cells to 40", () => {
    const mk = (n: number, gold: boolean, kind: "arm" | "oracle"): GoldRef[] => Array.from({ length: n }, (_, i) => ({ packet: "p", list: kind + i, item: "i", gold, ref: { kind, unit: "u", model: "opus", words: 1 }, itemRef: { unit: "u", item: "i" + i, kind: "U" }, model: "opus", unit: "u" }));
    const d = drawGold([...mk(7, true, "arm"), ...mk(30, true, "oracle"), ...mk(50, false, "arm")], seededRandom(SEED));
    expect(d.filter((g) => g.gold && g.ref.kind === "arm")).toHaveLength(7);
    expect(d.filter((g) => g.ref.kind === "oracle")).toHaveLength(7);
    expect(d).toHaveLength(40);
    const full = drawGold([...mk(25, true, "arm"), ...mk(30, true, "oracle"), ...mk(50, false, "arm")], seededRandom(SEED));
    expect(full.filter((g) => g.gold)).toHaveLength(20);
    expect(full.filter((g) => !g.gold)).toHaveLength(20);
  });

  test("stage 2 label packets carry blind gold packets per production judge and a plain rendering of 40 gold cells", () => {
    const labels: LabelRecord[] = [];
    for (const p of check.packets) for (const l of p.lists) for (const i of p.items) for (const judge of ["astra", "opus"] as const) labels.push({ packet: p.id, judge, model_id: judge, version: null, effort: "max", list: l.id, item: i.id, label: { anticipated: l.changes.some((c) => c.includes(i.statement.match(/tag-\w+/)![0])), changes: [1] } });
    const s2units = unitsMap([...specs.map((s) => ({ meta: { ...s.meta, set: "comparison" as const }, key: s.key }))]);
    const s2rows = TYPES.flatMap((_, i) => (["none", "lens", "skill"] as const).flatMap((arm) => [1, 2].map((pass) => row({ unit: "u" + i, session: "s2-u" + i + arm + pass, arm, pass, list: ["Plan for tag-a" + i] }))));
    const checkFiles = new Map<string, PacketFile>(check.packets.map((p) => [p.id, p]));
    const built = buildLabelPackets({ family: "plan", stage: 2, seed: SEED, units: s2units, rows: s2rows, normalize: identity, check: { map: check.map, packets: checkFiles, labels } });
    const gold = Object.values(built.map.packets).filter((m) => m.role === "gold");
    expect(gold.length).toBeGreaterThan(0);
    const perModel = (m: string) => gold.filter((g) => g.model === m).reduce((s, g) => s + g.gold!.length, 0);
    expect(perModel("opus")).toBeLessThanOrEqual(40);
    expect(gold.every((g) => g.gold!.filter((c) => c.oracle).length <= g.gold!.filter((c) => c.gold).length)).toBe(true);
    expect(built.plain!.answers.length).toBeLessThanOrEqual(40);
    expect(built.plain!.text).not.toMatch(/"gold"/);
    expect(() => buildLabelPackets({ family: "plan", stage: 2, seed: SEED, units: s2units, rows: s2rows, normalize: identity })).toThrow(/gold cells/);
  });
});

describe("pairwise and probe packets", () => {
  const s2rows = [0, 1, 2].flatMap((i) => (["none", "lens", "skill"] as const).map((arm) => row({ unit: "u" + i, session: "p-u" + i + arm, arm, pass: 1, list: [arm + " change for u" + i] })));
  test("pass 1 pairs skill with none and with lens in random order, the plan and context shown, no key", () => {
    const dir = tmp();
    writeUnits(dir, specs.slice(0, 3));
    const u = new Map([...unitsMap(specs.slice(0, 3))].map(([k, v]) => [k, { ...v, dir: join(dir, k) }]));
    const b = buildPairwisePackets({ family: "plan", stage: 2, seed: SEED, units: u, rows: s2rows, normalize: identity });
    expect(b.packets).toHaveLength(6);
    for (const p of b.packets) {
      expect(p.input).toContain("PLAN\nThe team will build");
      expect(p.input).toContain("CONTEXT");
      expect(p.items).toHaveLength(0);
      expect(p.lists.map((l) => l.id)).toEqual(["A", "B"]);
    }
    const firsts = b.packets.map((p) => b.map.packets[p.id]!.lists.A!.arm);
    expect(new Set(firsts).size).toBeGreaterThan(1);
  });

  test("the probe draws 30 seeded lists, one a packet, for Astra", () => {
    const many = Array.from({ length: 40 }, (_, i) => row({ unit: "u" + (i % 8), session: "pr" + i, arm: (["none", "lens", "skill"] as const)[i % 3], pass: 1 + Math.floor(i / 8) }));
    const b = buildProbePackets({ family: "plan", stage: 2, seed: SEED, units, rows: many, normalize: identity });
    expect(b.packets).toHaveLength(30);
    expect(Object.values(b.map.packets).every((m) => m.judges.join() === "astra" && m.lists.L!.arm)).toBe(true);
  });
});

describe("pv packets command", () => {
  test("writes packets and a map outside the packets directory; refuses a map inside it and aliased paths", async () => {
    const dir = tmp();
    writeUnits(join(dir, "units"), specs);
    await Bun.write(join(dir, "rows.ndjson"), rows.map((r) => JSON.stringify(r)).join("\n"));
    await Bun.write(join(dir, "oracle.json"), JSON.stringify(oracle));
    const c = capture();
    const args = ["--kind", "label", "--family", "plan", "--stage", "1", "--units", join(dir, "units"), "--rows", join(dir, "rows.ndjson"), "--oracle", join(dir, "oracle.json"), "--out", join(dir, "packets")];
    expect(await run([...args, "--map", join(dir, "map.json")], c.io, { normalize: identity })).toBe(0);
    expect(readdirSync(join(dir, "packets"))).toHaveLength(48);
    expect(JSON.parse(readFileSync(join(dir, "map.json"), "utf8")).kind).toBe("label");
    await expect(run([...args, "--map", join(dir, "packets", "map.json")], c.io, { normalize: identity })).rejects.toThrow(/outside the packets/);
    await expect(run([...args.slice(0, -2), "--out", join(dir, "rows.ndjson"), "--map", join(dir, "m2.json")], c.io, { normalize: identity })).rejects.toThrow(/same path/);
    expect(listKey({ kind: "stock", unit: "u", model: "opus", stock: 2, words: 1 })).toBe("stock:u:opus:row2");
  });
});
