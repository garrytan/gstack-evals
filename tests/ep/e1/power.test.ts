import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(import.meta.dir, "../../../lanes/eng-planted/e1/power.py");
const UV = spawnSync("uv", ["--version"], { encoding: "utf8" }).status === 0;
const py = (args: string[]) => spawnSync("uv", ["run", "-q", "--with", "numpy==2.5.4", "python", SCRIPT, ...args], { encoding: "utf8", timeout: 300_000 });

describe("e1 power.py (needs uv and numpy 2.5.4)", () => {
  const builds = Array.from({ length: 36 }, (_, i) => ({ unit: "u" + (i >> 1), repo: "r" + (i >> 2), model: ["opus", "sol", "p1"][i % 3], avoid: i % 3 ? 0.5 : 1, catch: i % 4 ? 0 : 1 }));
  const pilot = () => {
    const p = join(mkdtempSync(join(tmpdir(), "ep-e1-power-")), "pilot.json");
    writeFileSync(p, JSON.stringify({ builds, unforeseeable: 0.1 }));
    return p;
  };

  test.skipIf(!UV)("--fit prints one seeded row per design at both ends, and the larger MDD governs", () => {
    const p = pilot();
    const a = py(["--fit", p, "--design", "6:2", "--design", "6:3", "--json"]);
    expect(a.status).toBe(0);
    expect(a.stdout).toBe(py(["--fit", p, "--design", "6:2", "--design", "6:3", "--json"]).stdout);
    const v = JSON.parse(a.stdout);
    expect(v.fit.units).toBe(18);
    expect(v.fit.unforeseeable).toBe(0.1);
    expect(v.rows.map((r: { design: string }) => r.design)).toEqual(["6x2x2", "6x3x2"]);
    for (const r of v.rows) {
      expect(r.ends.map((e: { sd_mu: number; tau_mu: number }) => [e.sd_mu, e.tau_mu])).toEqual([[0, 0], [v.fit.sd_e, 0.5]]);
      expect(r.governs).toBe(Math.max(...r.ends.map((e: { mdd: number }) => e.mdd)));
    }
  }, 300_000);

  test.skipIf(!UV)("--design refuses more than 3 models or a malformed pair", () => {
    const p = pilot();
    for (const d of ["6:4", "6x2", "0:2"]) {
      const r = py(["--fit", p, "--design", d]);
      expect(r.status).toBe(2);
      expect(r.stderr).toContain("--design");
    }
  }, 300_000);
});
