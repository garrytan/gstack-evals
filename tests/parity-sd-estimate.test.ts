import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CONFIGS, type Counts, countsJson, extractCounts, moments, pairTerms, pairVariance, PATHS, readCounts, readSource, reportFiles, type TrialRow,
} from "../scripts/parity-sd-estimate.ts";

const counts = (tasks: Counts["tasks"]): Counts => ({ source_sha256: "", rule: "", configs: ["c", "f"], tasks });
const idx = (c: Counts) => [...Object.keys(c.tasks).keys()];

describe("parity SD estimate (U15)", () => {
  test("results.json and the note's generated block reproduce byte for byte from counts.json", () => {
    for (const [path, text] of Object.entries(reportFiles(readSource(), readCounts()))) expect(readFileSync(path, "utf8")).toBe(text);
  });

  test("counts.json is canonical, names the recorded file and covers every DeepSWE v1.1 task", () => {
    const c = readCounts();
    expect(countsJson(c)).toBe(readFileSync(PATHS.counts, "utf8"));
    expect(c.source_sha256).toBe(readSource().sha256);
    expect(c.configs).toEqual(CONFIGS);
    expect(Object.keys(c.tasks)).toHaveLength(113);
  });

  test("extractCounts keeps the scored trials of the named configs", () => {
    const row = (task: string, model: string, effort: string | null, passed: boolean, scored = true): TrialRow =>
      ({ task_name: task, model, reasoning_effort: effort, passed, included_in_score: scored });
    const rows = [row("b", "m", "max", true), row("b", "m", "max", false), row("b", "m", "max", true, false), row("a", "m", "max", false), row("a", "n", null, true), row("a", "x", "low", true)];
    const c = extractCounts(rows, "f".repeat(64), ["m [max]", "n [default]"]);
    expect(Object.keys(c.tasks)).toEqual(["a", "b"]);
    expect(c.tasks).toEqual({ a: [[0, 1], [1, 1]], b: [[1, 2], [0, 0]] });
    expect(() => extractCounts(rows, "f".repeat(64), ["m [max]", "y [max]"])).toThrow("no scored trials for y [max]");
  });

  test("no true difference leaves trial noise alone, with p(1-p) estimated without bias", () => {
    const flat = counts(Object.fromEntries(Array.from({ length: 10 }, (_, i) => ["t" + i, [[2, 4], [2, 4]] as Array<[number, number]>])));
    const m = moments(pairTerms(flat, "c", "f"), idx(flat));
    expect(m.between).toBe(0);
    expect(m.wc).toBeCloseTo(1 / 3, 12);
    expect(pairVariance(m)).toBeCloseTo(1 / 15 + 1 / 9, 12);
  });

  test("tasks without trial noise give the spread of the differences, and thin cells are left out", () => {
    const split = counts({ a: [[4, 4], [0, 4]], b: [[0, 4], [4, 4]], c: [[4, 4], [4, 4]], d: [[0, 4], [0, 4]], e: [[1, 1], [0, 4]] });
    const m = moments(pairTerms(split, "c", "f"), idx(split));
    expect(m.tasks).toBe(4);
    expect(m.between).toBeCloseTo(2 / 3, 12);
    expect(pairVariance(m)).toBeCloseTo(2 / 3, 12);
  });

  test("every error line starts with its reason code", () => {
    const dir = mkdtempSync(join(tmpdir(), "parity-sd-"));
    try {
      writeFileSync(join(dir, "trials.json"), "{\"rows\": []}");
      const script = join(import.meta.dir, "..", "scripts", "parity-sd-estimate.ts");
      for (const [args, code] of [[["nope"], "E_USAGE"], [["build", join(dir, "trials.json")], "E_PARITY_SOURCE"], [["build", join(dir, "absent.json")], "E_PARITY_SOURCE"]] as const) {
        const run = spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
        expect(run.status).toBe(2);
        const lines = run.stderr.trimEnd().split("\n");
        expect(lines.length).toBeGreaterThan(2);
        for (const line of lines) expect(line).toStartWith(code + " ");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a resample counts a repeated task each time it is drawn", () => {
    const split = counts({ a: [[4, 4], [0, 4]], b: [[0, 4], [4, 4]] });
    expect(moments(pairTerms(split, "c", "f"), [0, 0, 1]).gap).toBeCloseTo(1 / 3, 12);
  });
});
