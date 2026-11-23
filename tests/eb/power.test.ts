import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");
const FROZEN_DIR = join(ROOT, "wiki/plans/2026-11-11-geva-522-eng-review-build-read-prereg");
const LANE = join(ROOT, "lanes/eng-build/power.py");
const START = "# --- parametric mode";
const END = "# --- end parametric mode ---\n";
const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const UV = spawnSync("uv", ["--version"], { encoding: "utf8" }).status === 0;
const py = (args: string[]) => spawnSync("uv", ["run", "-q", "--with", "numpy==2.5.4", "python", LANE, ...args], { encoding: "utf8", timeout: 290_000 });

describe("power.py", () => {
  test("is the prereg's frozen script with only the parametric block added", () => {
    const frozen = readFileSync(join(FROZEN_DIR, "power.py"), "utf8");
    expect(sha(frozen)).toBe("b4f6a1653058e809185eb2a9ecef08842cb1c3cf001b83f11d0afc050853c39b");
    const lane = readFileSync(LANE, "utf8");
    const s = lane.indexOf(START);
    const e = lane.indexOf(END);
    expect(s).toBeGreaterThan(0);
    expect(lane.slice(0, s) + lane.slice(e + END.length)).toBe(frozen);
  });
  test.skipIf(!UV)("with no arguments prints the attached power.txt byte for byte (needs uv and numpy 2.5.4)", () => {
    const r = py([]);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(readFileSync(join(FROZEN_DIR, "power.txt"), "utf8"));
  }, 300_000);
  test.skipIf(!UV)("the parametric mode is seeded and runs the frozen sim", () => {
    const a = py(["--n", "24", "--k", "2", "--json"]);
    expect(a.status).toBe(0);
    expect(a.stdout).toBe(py(["--n", "24", "--k", "2", "--json"]).stdout);
    const v = JSON.parse(a.stdout);
    expect(v.mdd).toBeGreaterThan(0.15);
    expect(v.mdd).toBeLessThan(0.2);
  }, 120_000);
});
