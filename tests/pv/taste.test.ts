// Copyright (c) 2026 Garry Tan. MIT License.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fakeUpstream } from "../../lanes/product-value/dryrun.ts";
import { capWords, candidates, draw, run, SUMMARY_WORDS } from "../../lanes/product-value/taste.ts";
import type { Row } from "../../lanes/product-value/types.ts";
import { capture, ENV, keyOf, ledgerWith, meta, row, tmp, writeUnits } from "./fixtures.ts";

const UNITS = ["u1", "u2", "u3", "u4", "u5", "u6", "u7"];
function rows(): Row[] {
  const out: Row[] = [];
  for (const family of ["plan", "brief"] as const)
    for (const [i, u] of UNITS.entries()) {
      if (i < 6) out.push(row({ unit: u, family, arm: "skill", session: family + "-" + u + "-skill", list: ["Skill change for " + u] }));
      for (const p of [1, 2, 3]) out.push(row({ unit: u, family, arm: "none", pass: p, session: family + "-" + u + "-none-" + p, list: p === 1 && u === "u2" ? null : ["None change " + p + " for " + u] }));
      if (i < 2) out.push(row({ unit: u, family, arm: "lens", session: family + "-" + u + "-lens", list: ["Lens change for " + u] }));
      out.push(row({ unit: u, family, model: "sol", arm: "skill", session: family + "-" + u + "-sol", list: ["Sol change"] }));
    }
  return out;
}

describe("pv taste (section 15)", () => {
  test("candidates pair each Opus skill list with the Opus none list (its lowest pass with a block) and the lens list on the same unit", () => {
    const c = candidates("plan", rows());
    expect(c.length).toBe(8);
    expect(c.every((x) => x.skill.unit === x.other.unit && x.skill.model === "opus" && x.other.model === "opus" && x.skill.arm === "skill" && x.other.arm === x.partner)).toBe(true);
    expect(c.find((x) => x.unit === "u2" && x.partner === "none")!.other.pass).toBe(2);
    expect(c.some((x) => x.unit === "u7")).toBe(false);
  });

  test("the draw takes 7 plan and 3 brief pairs in seeded order, with a seeded side for the skill list, and refuses a shortfall", () => {
    const d = draw(rows());
    expect(d.map((x) => x.family)).toEqual([...Array(7).fill("plan"), ...Array(3).fill("brief")]);
    expect(d.map((x) => x.pair)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(new Set(d.map((x) => x.family + x.unit + x.partner)).size).toBe(10);
    expect(draw(rows())).toEqual(d);
    expect(draw(rows(), 1)).not.toEqual(d);
    expect(d.some((x) => x.skillIsA) && d.some((x) => !x.skillIsA)).toBe(true);
    expect(() => draw(rows().filter((r) => !(r.family === "brief" && r.arm === "skill" && r.unit !== "u1")))).toThrow(/brief family has 2 Opus skill pairs/);
  });

  test("summaries are cut at the word cap", () => {
    expect(capWords("a ".repeat(SUMMARY_WORDS)).cut).toBe(false);
    const long = capWords("a ".repeat(SUMMARY_WORDS + 1));
    expect(long.cut).toBe(true);
    expect(long.text.split(" ").length).toBe(SUMMARY_WORDS + 1);
  });

  test("run writes the blind pairs and keeps arms and units in the answers file outside the packet folder", async () => {
    const dir = tmp();
    writeUnits(join(dir, "units"), UNITS.map((u) => ({ meta: meta(u), key: keyOf(u, ["a"]) })));
    const all = rows();
    await Bun.write(join(dir, "plan.jsonl"), all.filter((r) => r.family === "plan").map((r) => JSON.stringify(r)).join("\n") + "\n");
    await Bun.write(join(dir, "brief.jsonl"), all.filter((r) => r.family === "brief").map((r) => JSON.stringify(r)).join("\n") + "\n");
    const { record, ledger } = ledgerWith(dir, ["pv-o1-render"]);
    let calls = 0;
    const c = capture();
    const args = ["--units", join(dir, "units"), "--plan-rows", join(dir, "plan.jsonl"), "--brief-rows", join(dir, "brief.jsonl"), "--out", join(dir, "out"), "--answers", join(dir, "answers.json"), "--item", "pv-o1-render", "--run-id", "r1", "--cache", join(dir, "cache"), "--record", record, "--ledger", ledger];
    expect(await run(args, c.io, { fetch: fakeUpstream(() => (calls++, "A product summary. ".repeat(60))), env: ENV })).toBe(0);
    const pairs = readFileSync(join(dir, "out", "pairs.md"), "utf8");
    expect(pairs.match(/^## Pair \d+$/gm)!.length).toBe(10);
    expect(/\bu\d\b|skill|none|lens|Sol/i.test(pairs.replace(/Skill change for u\d|None change \d for u\d|Lens change for u\d/g, ""))).toBe(false);
    const ans = JSON.parse(readFileSync(join(dir, "answers.json"), "utf8"));
    expect(ans.pairs.length).toBe(10);
    expect(ans.pairs.every((p: { A: string; B: string; summary_cut: boolean }) => [p.A, p.B].includes("skill") && p.summary_cut)).toBe(true);
    expect(calls).toBe(new Set(ans.pairs.map((p: { family: string; unit: string }) => p.family + p.unit)).size);
    await expect(run([...args.slice(0, 8), "--answers", join(dir, "out", "a.json"), ...args.slice(10)], capture().io, { fetch: fakeUpstream(() => "x"), env: ENV })).rejects.toThrow(/outside --out/);
  });
});
