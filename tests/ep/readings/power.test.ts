import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(import.meta.dir, "../../../lanes/eng-planted/readings/power.py");
const UV = spawnSync("uv", ["--version"], { encoding: "utf8" }).status === 0;
const py = (args: string[]) => spawnSync("uv", ["run", "-q", "--with", "numpy==2.5.4", "python", SCRIPT, ...args], { encoding: "utf8", timeout: 900_000 });

describe("power.py (needs uv and numpy 2.5.4)", () => {
  test.skipIf(!UV)("with no arguments prints the attached power.txt byte for byte, inside the plan's table", () => {
    const r = py([]);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(readFileSync(join(import.meta.dir, "../../../lanes/eng-planted/readings/power.txt"), "utf8"));
    for (const row of ["40x3    composite  MDD 0.13 to 0.15", "64x3    composite  MDD 0.10 to 0.11", "80x3    composite  MDD 0.09 to 0.10", "96x3    composite  MDD 0.08 to 0.09", "64x3    avoid      MDD 0.11 to 0.12"]) expect(r.stdout).toContain(row);
  }, 900_000);
  test.skipIf(!UV)("one design's rows match the table's, and the single-MDD mode is seeded", () => {
    const rows = py(["--rows", "40x3"]).stdout.split("\n").filter((l) => l.startsWith("40x3"));
    const table = readFileSync(join(import.meta.dir, "../../../lanes/eng-planted/readings/power.txt"), "utf8").split("\n").filter((l) => l.startsWith("40x3"));
    expect(rows).toEqual(table);
    const a = py(["--n", "40", "--k", "2", "--json"]);
    expect(a.status).toBe(0);
    expect(a.stdout).toBe(py(["--n", "40", "--k", "2", "--json"]).stdout);
    expect(JSON.parse(a.stdout).mdd).toBeGreaterThan(0.14);
  }, 300_000);
  test.skipIf(!UV)("--fit refits the pilot's levels, build SD and mix and re-prints the MDD", () => {
    const builds = Array.from({ length: 40 }, (_, i) => ({ unit: "u" + (i >> 1), repo: "r" + (i >> 2), avoid: i % 3 ? 0.5 : 1, catch: i % 4 ? 0 : 1 }));
    const p = join(mkdtempSync(join(tmpdir(), "ep-power-")), "pilot.json");
    writeFileSync(p, JSON.stringify({ builds, unforeseeable: 0.2 }));
    const r = py(["--fit", p, "--json"]);
    expect(r.status).toBe(0);
    const v = JSON.parse(r.stdout);
    expect(v.fitted.mix).toEqual([0, 1, 0]);
    expect(v.fitted.unforeseeable).toBe(0.2);
    expect(Object.keys(v.mdd)).toEqual(["64x3", "40x3"]);
  }, 300_000);
});
