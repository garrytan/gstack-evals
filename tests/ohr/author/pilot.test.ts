// Value: protects=pre-run change 1 item 4d's pilot gate: the Wilson interval against published worked examples, the line from pilot.py's formula, and the two-step read against pilot.txt's table.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CHANGE_1, PILOT } from "../../../lanes/office-hours-rewrite/frozen.ts";
import { PLANNING, line, pilotRead, readAt, wilson90 } from "../../../lanes/office-hours-rewrite/author/pilot.ts";
import { wilson } from "../../../lanes/autoplan-audit/stats.ts";

const pilotTxt = readFileSync(join(import.meta.dir, "..", "..", "..", CHANGE_1, "..", "pilot.txt"), "utf8");
const r3 = (x: number) => x.toFixed(3);

describe("Wilson score interval", () => {
  // Newcombe (1998), Statistics in Medicine 17:857-872, Table I, method 3 (score interval without continuity correction).
  test("matches Newcombe's 1998 worked examples at 95%", () => {
    const cases: [number, number, number, number][] = [[81, 263, 0.2553, 0.3662], [15, 148, 0.0624, 0.1605], [0, 20, 0, 0.1611], [1, 29, 0.0061, 0.1718]];
    for (const [k, n, lo, hi] of cases) {
      const [l, h] = wilson(k, n, 1.959964);
      expect(l).toBeCloseTo(lo, 4);
      expect(h).toBeCloseTo(hi, 4);
    }
  });
  test("the pilot's 90% interval gives pilot.txt's bounds at n = 4", () => {
    expect(PILOT.z).toBe(1.6448536269514722);
    expect(pilotTxt).toContain("Wilson bounds at n = 4: 0/4 upper " + r3(wilson90(0, 4)[1]) + "; 4/4 lower " + r3(wilson90(4, 4)[0]));
  });
});

describe("the yield line", () => {
  test("at the planning inputs it is pilot.txt's 0.244", () => {
    expect(pilotTxt).toContain("yield threshold: " + r3(line(PLANNING.draw_usd, PLANNING.first_pass)!) + " ");
    expect(r3(line(PLANNING.draw_usd, PLANNING.first_pass)!)).toBe("0.244");
  });
  test("is None when first twins and unpaired briefs alone use up the cap, as pilot.py prints", () => {
    expect(line(1.04, 0.3)).toBeNull();
    expect(pilotTxt).toContain("line at a measured 1.04 a draw and a first-pass rate of 0.30: None");
    expect(line(1.04, 0)).toBeNull();
  });
  test("a higher cost per draw raises the line", () => {
    expect(line(1.2, PLANNING.first_pass)!).toBeGreaterThan(line(PLANNING.draw_usd, PLANNING.first_pass)!);
  });
});

describe("the read", () => {
  const L = line(PLANNING.draw_usd, PLANNING.first_pass)!;
  test("planted counts at 16 draws: 1 stops, 2 to 6 are open, 7 goes", () => {
    expect(readAt(1, 16, L)).toBe("stop");
    for (const k of [2, 3, 4, 5, 6]) expect(readAt(k, 16, L)).toBe("open");
    expect(readAt(7, 16, L)).toBe("go");
  });
  test("a lower bound exactly at the line goes; an upper bound exactly at it does not stop", () => {
    const [lo, hi] = wilson90(7, 16);
    expect(readAt(7, 16, lo)).toBe("go");
    expect(readAt(1, 16, wilson90(1, 16)[1])).toBe("open");
    expect(hi).toBeGreaterThan(lo);
  });
  test("no line reads stop", () => {
    expect(readAt(16, 16, null)).toBe("stop");
  });
  test("the two-step pilot reproduces pilot.txt's part B at every yield", () => {
    const pmf = (k: number, n: number, p: number) => { let c = 1; for (let i = 0; i < k; i++) c = (c * (n - i)) / (i + 1); return c * p ** k * (1 - p) ** (n - k); };
    const rows = pilotTxt.split("B. Frozen two-step pilot")[1]!.trim().split("\n").slice(2).map((l) => l.trim().split(/\s+/).map(Number));
    expect(rows).toHaveLength(8);
    for (const [y, go, stop, open] of rows as number[][]) {
      let g = 0, s = 0, o = 0;
      for (let k1 = 0; k1 <= PILOT.first_read; k1++) {
        const p1 = pmf(k1, PILOT.first_read, y!);
        const first = pilotRead([{ k: k1, n: PILOT.first_read }], L);
        if (first.verdict === "go") g += p1;
        else if (first.verdict === "stop") s += p1;
        else for (let k2 = 0; k2 <= PILOT.second_read - PILOT.first_read; k2++) {
          const p2 = p1 * pmf(k2, PILOT.second_read - PILOT.first_read, y!);
          const v = pilotRead([{ k: k1, n: PILOT.first_read }, { k: k1 + k2, n: PILOT.second_read }], L).verdict;
          if (v === "go") g += p2; else if (v === "stop") s += p2; else o += p2;
        }
      }
      expect([r3(g), r3(s), r3(o)]).toEqual([r3(go!), r3(stop!), r3(open!)]);
    }
  });
  test("an open first read asks for the second; an open second read halts open", () => {
    expect(pilotRead([{ k: 4, n: 16 }], L).verdict).toBe("more");
    expect(pilotRead([{ k: 4, n: 16 }, { k: 8, n: 32 }], L).verdict).toBe("open");
  });
});
