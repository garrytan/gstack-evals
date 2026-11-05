// Binding item 2: ceo rows take issues, words, fixes and fix_words from the journal's one stored parse and never call
// the parser; ceo packets read the rows; every word count equals the scorer's wc (ceo-rule.ts.txt of the stop-label
// amendment).
import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ceoRowFields } from "../../../src/trial/review/ceo-outcome.ts";
import { ceo, entry, ROOT, runDir, SCORER, SMOKE, STAGE1_NONE, tmp, U1, unitsDir } from "./ceo-pipeline.ts";

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
const fresh = () => {
  const d = tmp("rows");
  dirs.push(d);
  unitsDir(d);
  return d;
};
// The scorer's own word rule, read from the frozen file rather than copied.
const wcSource = readFileSync(SCORER, "utf8").match(/^const wc = \(s: string\) => (.+);$/m)![1]!;
const wc = new Function("s", "return " + wcSource) as (s: string) => number;
const rowsOf = async (d: string, edit?: (e: Record<string, any>) => void) => {
  const run = runDir(d, "run", [...STAGE1_NONE, ...SMOKE], edit);
  const out = join(d, "rows.json");
  const r = await ceo(["rows", "--stage", "1", "--units", join(d, "units"), "--run", run, "--out", out]);
  expect(r.code).toBe(0);
  return { run, out, rows: JSON.parse(readFileSync(out, "utf8")).rows as any[] };
};
const idOf = (arm: string, model: string, unit: string, pass: number, smoke = false) => (smoke ? "smoke:" : "") + arm + ":" + model + ":" + unit + ":p" + pass;

describe("rows read the journal's one stored parse", () => {
  test("every scored row's issues, words, fixes and fix_words equal ceoRowFields of its stored parse", async () => {
    const d = fresh();
    const { run, rows } = await rowsOf(d);
    const stored = readFileSync(join(run, "cells.ndjson"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const scored = rows.filter((r) => r.status === "scored");
    expect(scored.length).toBeGreaterThan(20);
    for (const r of scored) {
      const e = stored.find((s) => r.id === idOf(s.cell.arm === "gstack-auto" ? "autoplan-ceo" : s.cell.arm === "gstack-forced" ? "standalone" : s.cell.arm, s.cell.model.includes("opus") ? "opus" : s.cell.model.includes("sol") ? "sol" : "particle", s.cell.unit, s.cell.pass, s.cell.arm.startsWith("gstack")));
      expect(e).toBeDefined();
      const f = ceoRowFields(e.parse);
      expect({ issues: r.issues, words: r.words, fixes: r.fixes, fix_words: r.fix_words }).toEqual(f);
    }
    for (const r of rows.filter((x) => x.status !== "scored")) expect([r.issues, r.words, r.fixes, r.fix_words]).toEqual([[], [], [], []]);
  });

  test("a mutation of the stored parse moves the row with it", async () => {
    const d = fresh();
    const { rows } = await rowsOf(d, (e) => {
      if (e.cell.arm === "none" && e.cell.unit === U1 && e.cell.pass === 2 && e.cell.model.includes("opus")) {
        e.parse.top[0].issue = "MUTATEDPARSE one two three";
        e.parse.top[1].fix = "MUTATEDFIX four five";
      }
    });
    const r = rows.find((x) => x.id === idOf("none", "opus", U1, 2))!;
    expect(r.issues[0]).toBe("MUTATEDPARSE one two three");
    expect(r.words[0]).toBe(4);
    expect(r.fixes[1]).toBe("MUTATEDFIX four five");
    expect(r.fix_words[1]).toBe(3);
  });

  test("rows never call the parser: the transcript's own block never reaches a row, and ceo-cli.ts imports no parser", async () => {
    const d = fresh();
    const { out } = await rowsOf(d);
    expect(readFileSync(out, "utf8")).not.toContain("TRANSCRIPTONLY");
    const src = readFileSync(join(ROOT, "src/trial/review/ceo-cli.ts"), "utf8");
    for (const f of ["parseCeoBlock", "lastCeoBlock", "ceoTranscriptParse", "needsFollowUp", "mainAgentTexts"]) expect(src).not.toContain(f);
  });

  test("a journal from another parser is refused, with a fix line", async () => {
    const d = fresh();
    const run = runDir(d, "run", [...STAGE1_NONE, ...SMOKE], (e) => (e.ceo_outcome.parser_sha256 = "f".repeat(64)));
    const r = await ceo(["rows", "--stage", "1", "--units", join(d, "units"), "--run", run, "--out", join(d, "rows.json")]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("parser");
    expect(r.err.trim().split("\n").at(-1)).toMatch(/^E_USAGE fix: \S/);
  });
});

describe("packets read the rows", () => {
  const build = async () => {
    const d = fresh();
    const { out } = await rowsOf(d);
    const rows = JSON.parse(readFileSync(out, "utf8"));
    const r = rows.rows.find((x: any) => x.id === idOf("none", "opus", U1, 1));
    r.issues[0] = "ROWEDIT issue one two";
    r.words[0] = 4;
    r.fixes[0] = "ROWEDIT fix three";
    r.fix_words[0] = 3;
    writeFileSync(out, JSON.stringify(rows));
    const res = await ceo(["packets", "--rows", out, "--units", join(d, "units"), "--seed", "3", "--out", join(d, "packets"), "--key", join(d, "key.json")]);
    expect(res.code).toBe(0);
    const files = readdirSync(join(d, "packets")).sort();
    return { d, files, read: (f: string) => JSON.parse(readFileSync(join(d, "packets", f), "utf8")) };
  };

  test("a row's edited issue and fix show in the packets, so packets follow the rows and never reparse", async () => {
    const { files, read } = await build();
    const all = files.map(read);
    const d = all.filter((p) => p.read === "D").flatMap((p) => p.reviews.flatMap((r: any) => r.issues));
    expect(d).toContain("ROWEDIT issue one two");
    const rem = all.filter((p) => p.read === "rem").flatMap((p) => p.reviews.flatMap((r: any) => r.issues));
    expect(rem).toContainEqual({ issue: "ROWEDIT issue one two", fix: "ROWEDIT fix three" });
    expect(JSON.stringify(all)).not.toContain("TRANSCRIPTONLY");
  });

  test("D packets carry no fix text and three stock issues per stock row; remedy packets show every fix or 'no fix'", async () => {
    const { d, files, read } = await build();
    const key = JSON.parse(readFileSync(join(d, "key.json"), "utf8"));
    for (const f of files) {
      const p = read(f);
      const unit = key.units.find((u: any) => u.d_packet.file === f || u.rem_packet?.file === f);
      if (p.read === "D") {
        expect(JSON.stringify(p)).not.toContain("fix");
        for (const r of p.reviews) for (const t of r.issues) expect(typeof t).toBe("string");
        for (const s of unit.stock) expect(p.reviews.find((r: any) => r.review === s.id).issues.length).toBe(3);
      } else {
        for (const r of p.reviews) for (const x of r.issues) expect(x.fix.length).toBeGreaterThan(0);
        expect(p.reviews.some((r: any) => r.issues.some((x: any) => x.fix === "no fix"))).toBe(true);
      }
    }
  });

  test("every word count equals the scorer's wc: words before the cut, and each cut issue and fix in rows and packets has min(40, n) words", async () => {
    expect(wc("a\tb\nc\u00a0d  e")).toBe(5);
    const d = fresh();
    const { run, out, rows } = await rowsOf(d);
    const stored = readFileSync(join(run, "cells.ndjson"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const texts = stored.filter((e) => e.parse.kind === "block").flatMap((e) => e.parse.top);
    const byIssue = new Map(texts.map((t: any) => [t.issue.split(/\s+/).filter(Boolean).slice(0, 40).join(" "), t]));
    for (const r of rows.filter((x) => x.status === "scored")) r.issues.forEach((s: string, i: number) => {
      expect(wc(s)).toBe(Math.min(40, r.words[i]));
      expect(wc(r.fixes[i])).toBe(Math.min(40, r.fix_words[i]));
      const t: any = byIssue.get(s);
      expect(r.words[i]).toBe(wc(t.issue));
      expect(r.fix_words[i]).toBe(wc(t.fix));
    });
    expect(rows.some((r) => r.words.some((n: number) => n > 40))).toBe(true);
    const res = await ceo(["packets", "--rows", out, "--units", join(d, "units"), "--seed", "3", "--out", join(d, "packets"), "--key", join(d, "key.json")]);
    expect(res.code).toBe(0);
    const key = JSON.parse(readFileSync(join(d, "key.json"), "utf8"));
    for (const f of readdirSync(join(d, "packets"))) {
      const p = JSON.parse(readFileSync(join(d, "packets", f), "utf8"));
      const unit = key.units.find((u: any) => u.d_packet.file === f || u.rem_packet?.file === f);
      for (const r of p.reviews) {
        const k = unit.reviews.find((x: any) => x.id === r.review);
        if (!k) continue;
        const row = rows.find((x) => x.id === k.row);
        r.issues.forEach((x: any, i: number) => {
          expect(wc(p.read === "D" ? x : x.issue)).toBe(Math.min(40, row.words[i]));
          if (p.read === "rem") expect(x.fix === "no fix" ? 0 : wc(x.fix)).toBe(Math.min(40, row.fix_words[i]));
        });
      }
    }
  });
});
