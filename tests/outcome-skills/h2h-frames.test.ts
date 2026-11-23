// Copyright (c) 2026 Garry Tan. MIT License.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readAnalysisUnits } from "../../lanes/outcome-skills/h2h/analysis/commands.ts";
import type { B1Row } from "../../lanes/outcome-skills/h2h/breadth/b1.ts";
import type { B2Row } from "../../lanes/outcome-skills/h2h/breadth/b2.ts";
import { ECOSYSTEM_LANG } from "../../lanes/outcome-skills/h2h/breadth/frame.ts";
import { candidateOf } from "../../lanes/outcome-skills/h2h/breadth/oracle-b.ts";
import { readFrameFile, type FrameUnit } from "../../lanes/outcome-skills/h2h/frames.ts";
import { BUNDLE, commands, readFrame } from "../../lanes/outcome-skills/h2h/ordinary/commands.ts";
import type { OFrame } from "../../lanes/outcome-skills/h2h/ordinary/frame.ts";
import { readPrereg } from "../../lanes/outcome-skills/h2h/prereg.ts";

const p = readPrereg();
const temp = () => mkdtempSync(join(tmpdir(), "h2h-frames-"));
const at = (name: string) => join(BUNDLE, name);
const raw = (name: string) => JSON.parse(readFileSync(at(name), "utf8"));
const post = readFileSync(at("README.md"), "utf8");
const fmt = (n: number) => n.toLocaleString("en-US");
const sum = (xs: number[]) => xs.reduce((s, v) => s + v, 0);
const tally = (units: readonly FrameUnit[], key: (u: FrameUnit) => string) => {
  const out: Record<string, number> = {};
  for (const u of units) out[key(u)] = (out[key(u)] ?? 0) + 1;
  return out;
};
const atThree = (units: readonly FrameUnit[], key: (u: FrameUnit) => string) => {
  const per = tally(units, key);
  return { units: sum(Object.values(per).map((v) => Math.min(3, v))), repos: Object.keys(per).length };
};
const unitOf = (kind: "B1" | "B2", r: B1Row | B2Row, language: string) => {
  const c = candidateOf(kind, r);
  return { id: c.id, kind, repo: c.repo, month: c.month, window: r.window, language, licence: c.licence };
};

describe("h2h shared frame reader", () => {
  test("reads the three frozen schemas as units under candidateOf's ids and refuses anything else", () => {
    const d = temp();
    const put = (name: string, v: unknown) => {
      const f = join(d, name);
      writeFileSync(f, typeof v === "string" ? v : JSON.stringify(v));
      return f;
    };
    const b1: B1Row[] = raw("b1-frame.json").pull_requests.slice(0, 2), b2: B2Row[] = raw("b2-frame.json").advisories.slice(0, 2);
    const f1 = put("b1.json", { schema: "h2h-b1-frame.v1", pull_requests: b1 });
    expect(readFrameFile(f1, "E_H2H_DRAW_INPUT")).toMatchObject({ kind: "B1", units: b1.map((r) => unitOf("B1", r, "ts")) });
    expect(readFrameFile(put("b2.json", { schema: "h2h-b2-frame.v1", advisories: b2 }), "E_H2H_DRAW_INPUT").units).toEqual(b2.map((r) => unitOf("B2", r, ECOSYSTEM_LANG[r.ecosystem]!)));
    const o = { id: "a__b-1", repo: "a/b", month: "2026-04", entry: "bug", digest: "sha256:" + "0".repeat(64) };
    expect(readFrameFile(put("o.json", { schema: "h2h-o-frame.v1", units: [o] }), "E_H2H_DRAW_INPUT")).toMatchObject({ kind: "O", units: [{ ...o, kind: "O" }] });
    expect(() => readFrameFile(put("o2.json", { schema: "h2h-o-frame.v1", units: [{ ...o, entry: "chore" }] }), "E_H2H_DRAW_INPUT")).toThrow(/^E_H2H_DRAW_INPUT a__b-1 has no bug or feature tag/);
    expect(() => readFrameFile(put("u.json", { schema: "h2h-b1-frame.v1", units: [] }), "E_H2H_DRAW_INPUT")).toThrow(/^E_H2H_DRAW_INPUT .*has no pull_requests list/);
    expect(() => readFrameFile(put("w.json", { schema: "h2h-b2-frame.v1", advisories: [{ ...b2[0], window: "outside" }] }), "E_H2H_ANALYSIS_INPUT")).toThrow(/^E_H2H_ANALYSIS_INPUT .*not primary or widened/);
    expect(() => readFrameFile(put("x.json", { schema: "h2h-x.v1", units: [] }), "E_H2H_DRAW_INPUT")).toThrow(/^E_H2H_DRAW_INPUT .*is not an h2h-o-frame\.v1, h2h-b1-frame\.v1, h2h-b2-frame\.v1 file/);
    expect(() => readFrameFile(put("bad.json", "{"), "E_H2H_ANALYSIS_INPUT")).toThrow(/^E_H2H_ANALYSIS_INPUT .*not readable JSON/);
    expect(() => readFrame(f1, "B2")).toThrow(/^E_H2H_DRAW_INPUT .*h2h-b1-frame\.v1 file, not the B2 frame/);
  });

  test("draw --class B gets past input reading on the committed B1 and B2 frames, under candidateOf's ids, over primary rows", async () => {
    const d = temp();
    const rows = [...raw("b1-frame.json").pull_requests.map((r: B1Row) => ({ id: candidateOf("B1", r).id, window: r.window, kind: "B1" })), ...raw("b2-frame.json").advisories.map((r: B2Row) => ({ id: candidateOf("B2", r).id, window: r.window, kind: "B2" }))];
    const gates = (kind: string) => {
      const f = join(d, kind + "-gates.json");
      writeFileSync(f, JSON.stringify({ schema: "h2h-gates.v1", gates: ["image"], results: Object.fromEntries(rows.filter((r) => r.kind === kind).map((r) => [r.id, { image: "ok" }])) }));
      return f;
    };
    const g1 = gates("B1"), g2 = gates("B2");
    const run = async (name: string, extra: string[]) => {
      const out = join(d, name);
      const code = await commands.draw!(["--class", "B", "--b1-frame", at("b1-frame.json"), "--b2-frame", at("b2-frame.json"), "--b1-gates", g1, "--b2-gates", g2, "--out", out, ...extra]);
      return { code, out: JSON.parse(readFileSync(out, "utf8")) };
    };
    const window = new Map(rows.map((r) => [r.id, r.window]));
    const counts = raw("b1-frame.json").counts;
    const primary = await run("primary.json", []);
    expect(primary.code).toBe(0);
    expect(primary.out).toMatchObject({ b1_status: "usable", b1: { kind: "B1", draw_seed: p.draw_seed, usable: counts.cap3_primary.units }, b2: { kind: "B2", draw_seed: p.draw_seed } });
    const drawn = [...primary.out.b1.units, ...primary.out.b2.units] as { id: string }[];
    expect(drawn.length).toBeGreaterThan(0);
    for (const u of drawn) expect(window.get(u.id)).toBe("primary");
    const widened = await run("widened.json", ["--b1-fallbacks-done", "--b2-widened"]);
    expect(widened.code).toBe(0);
    expect(widened.out.b1.usable).toBe(counts.cap3_with_widened.units);
  });

  test("analysis --frame fills units from each of the three committed frames", () => {
    const [o, b1, b2] = ["o-frame.json", "b1-frame.json", "b2-frame.json"].map((n) => readFrameFile(at(n), "E_H2H_ANALYSIS_INPUT").units[0]!);
    const list = join(temp(), "units.json");
    writeFileSync(list, JSON.stringify([o!, b1!, b2!].map((u, k) => ({ id: u.id, kind: u.kind, position: k + 1, stage: "stage2" }))));
    const units = readAnalysisUnits([list], ["o-frame.json", "b1-frame.json", "b2-frame.json"].map(at));
    expect(units.map((u): unknown[] => [u.id, u.class, u.kind, u.repo, u.month, u.language, u.licence, u.entry])).toEqual([
      [o!.id, "O", "O", o!.repo, o!.month, o!.language, o!.licence, o!.entry],
      [b1!.id, "B", "B1", b1!.repo, b1!.month, "ts", b1!.licence, "bug"],
      [b2!.id, "B", "B2", b2!.repo, b2!.month, b2!.language, b2!.licence, "bug"],
    ]);
  });
});

interface B1Counts { repos_searched: number; repos_kept: number; eligible_primary: number; eligible_widened: number; cap3_primary: { units: number; repos: number }; cap3_with_widened: { units: number; repos: number } }
interface B2Counts { eligible_primary: number; eligible_widened: number; cap3_primary: number; cap3_with_widened: number; eligible_primary_by_ecosystem: Record<string, number> }

describe("h2h frame recount", () => {
  test("the O frame's units reproduce its counts, and the counts are the numbers the post states", () => {
    const f = readFrameFile(at("o-frame.json"), "E_H2H_DRAW_INPUT");
    const c = f.counts as unknown as OFrame["counts"];
    expect(f.units.length).toBe(c.eligible);
    expect(f.units.filter((u) => u.month >= p.classes.O.window_from.slice(0, 7)).length).toBe(c.eligible_from_window_start);
    expect(tally(f.units, (u) => String(u.language))).toEqual(c.by_language);
    expect(tally(f.units, (u) => u.month)).toEqual(c.by_month);
    expect({ bug: 0, feature: 0, ...tally(f.units, (u) => String(u.entry)) }).toEqual(c.by_entry);
    expect(c.in_window - sum(Object.values(c.drops_by_gate))).toBe(c.eligible);
    expect({ rows: c.rows, eligible: c.eligible, from: c.eligible_from_window_start }).toEqual({ rows: 1077, eligible: 642, from: 394 });
    expect(post).toContain(fmt(c.rows) + " rows, " + fmt(c.eligible) + " eligible before the oracle, " + fmt(c.eligible_from_window_start) + " of them from " + p.classes.O.window_from);
    const words: Record<string, string> = { exclusion: "exclusion list", licence: "licence", harness_screen: "the harness's own screen", told: "told-mode screen", image_digest: "image digest" };
    expect(post).toContain("drops by gate: " + Object.entries(c.drops_by_gate).map(([g, n]) => words[g] + " " + fmt(n)).join(", ") + ".");
    const licences = Object.entries(tally(f.units, (u) => String(u.licence))).sort(([a, x], [b, y]) => y - x || (a < b ? -1 : 1));
    expect(post).toContain("Licences of the eligible units: " + licences.map(([l, n]) => l + " " + fmt(n)).join(", ") + ".");
  });

  test("the B1 frame's rows reproduce its counts, and the counts are the numbers the post states", () => {
    const f = readFrameFile(at("b1-frame.json"), "E_H2H_DRAW_INPUT");
    const c = f.counts as unknown as B1Counts;
    const primary = f.units.filter((u) => u.window === "primary");
    expect([primary.length, f.units.length - primary.length]).toEqual([c.eligible_primary, c.eligible_widened]);
    expect(atThree(primary, (u) => u.repo)).toEqual(c.cap3_primary);
    expect(atThree(f.units, (u) => u.repo)).toEqual(c.cap3_with_widened);
    expect(raw("b1-repos.json").repos.length).toBe(c.repos_searched);
    expect(c.repos_searched - sum(Object.values(raw("b1-frame.json").drops.repos as Record<string, number>))).toBe(c.repos_kept);
    expect({ kept: c.repos_kept, primary: c.eligible_primary, widened: c.eligible_widened, cap3_primary: c.cap3_primary, cap3_with_widened: c.cap3_with_widened.units }).toEqual({ kept: 397, primary: 1441, widened: 381, cap3_primary: { units: 280, repos: 116 }, cap3_with_widened: 309 });
    expect(post).toContain(fmt(c.repos_kept) + " repositories kept from " + fmt(c.repos_searched) + " searched, and " + fmt(c.eligible_primary) + " eligible pull requests in " + fmt(c.cap3_primary.repos) + " repositories, " + fmt(c.cap3_primary.units) + " at 3 a repository");
  });

  test("the B2 frame's rows reproduce its counts, and the counts are the numbers the post states", () => {
    const f = readFrameFile(at("b2-frame.json"), "E_H2H_DRAW_INPUT");
    const c = f.counts as unknown as B2Counts;
    const primary = f.units.filter((u) => u.window === "primary");
    expect([primary.length, f.units.length - primary.length]).toEqual([c.eligible_primary, c.eligible_widened]);
    expect(atThree(primary, (u) => u.repo.toLowerCase()).units).toBe(c.cap3_primary);
    expect(atThree(f.units, (u) => u.repo.toLowerCase()).units).toBe(c.cap3_with_widened);
    expect(tally(primary, (u) => String(u.language))).toEqual(Object.fromEntries(Object.entries(c.eligible_primary_by_ecosystem).map(([e, n]) => [ECOSYSTEM_LANG[e], n])));
    expect({ primary: c.eligible_primary, widened: c.eligible_widened, cap3_primary: c.cap3_primary, cap3_with_widened: c.cap3_with_widened }).toEqual({ primary: 1575, widened: 448, cap3_primary: 878, cap3_with_widened: 1138 });
    const eco = Object.entries(c.eligible_primary_by_ecosystem).sort(([, x], [, y]) => y - x).map(([e, n]) => e + " " + fmt(n));
    expect(post).toContain(fmt(c.eligible_primary) + " eligible advisories, " + fmt(c.cap3_primary) + " at 3 a repository (" + eco.slice(0, -1).join(", ") + " and " + eco.at(-1) + " before the cap)");
    expect(post).toContain("(the frozen frame then holds " + fmt(c.cap3_with_widened) + " at 3 a repository)");
  });
});
