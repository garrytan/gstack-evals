// Copyright (c) 2026 Garry Tan. MIT License.
// power.txt as the preregistration attaches it: its digest, and the numbers frozen.ts copies from it. When python3 is
// on the machine, power.py.txt reproduces power.txt byte for byte.
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sha256 } from "../../../../lanes/review-noloss/suite.ts";
import { REPO, PREREG } from "../../../../lanes/codex-hooks/pins.ts";
import { POWER, POWER_TXT } from "../../../../lanes/codex-hooks/c/analysis/frozen.ts";

const text = readFileSync(POWER_TXT.path, "utf8");
const section = (title: string) => text.split("\n== ").find((s) => s.replace(/^== /, "").startsWith(title))!;

describe("power.txt", () => {
  test("is the file the preregistration attaches", () => {
    expect(POWER_TXT.path).toBe(join(REPO, PREREG, "power.txt"));
    expect(sha256(text)).toBe(POWER_TXT.sha256);
  });

  test("the within-session MDDs match", () => {
    const s = section("Contract primary, within session");
    expect(s).toMatch(/84 blocker-passes, design effect 1\.2, effective n 70/);
    expect(POWER.design_effect).toBe(1.2);
    expect(POWER.effective_pairs).toBe(70);
    const rows = [...s.matchAll(/losses (\d+)% of blocker-passes -> net gain detectable at ([\d.]+) points/g)].map((m) => ({ losses_pct: Number(m[1]), mdd_points: Number(m[2]) }));
    expect(rows).toEqual(POWER.contract_within.map((x) => ({ ...x })));
  });

  test("the between-arm MDDs match, none fits included", () => {
    const s = section("Between arms");
    const rows = [...s.matchAll(/(\d+)% of blocker-passes disagree -> (none fits|([\d.]+) points)/g)].map((m) => ({ disagree_pct: Number(m[1]), mdd_points: m[3] === undefined ? null : Number(m[3]) }));
    expect(rows).toEqual(POWER.between_arms.map((x) => ({ ...x })));
  });

  test("the O'Brien-Fleming bounds match", () => {
    const m = /interim \|z\| >= ([\d.]+), final \|z\| >= ([\d.]+)/.exec(section("O'Brien-Fleming"))!;
    expect({ interim_z: Number(m[1]), final_z: Number(m[2]) }).toEqual({ ...POWER.obrien_fleming });
  });

  const python = spawnSync("python3", ["--version"]).status === 0;
  test.skipIf(!python)("power.py.txt reproduces power.txt", () => {
    const r = spawnSync("python3", [join(REPO, PREREG, "power.py.txt")], { encoding: "utf8", timeout: 60_000 });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(text);
  });
});
