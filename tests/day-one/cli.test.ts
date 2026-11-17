import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../../lanes/day-one/cli.ts";
import { fixtureUnit } from "../../lanes/day-one/dryrun.ts";

const run = async (argv: string[]) => {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(argv, { out: (t) => out.push(t), err: (t) => err.push(t) });
  return { code, out: out.join("\n"), err: err.join("\n") };
};

const planRow = (stage: "base" | "review", unit: string, arm: "n" | "d", words: number) => ({ id: stage + "/" + unit + "/r1/" + arm, cell: { stage, unit, rep: 1, arm }, state: "scored", plan: { sha256: "x", words, from: "plan.md" } });
const checkRow = (unit: string, arm: "n" | "d", done: boolean[]) => ({ id: "check/" + unit + "/r1/" + arm, cell: { stage: "check", unit, rep: 1, arm }, state: "scored", check: { score: { done } } });

describe("day-one read", () => {
  test("a reading takes plans only from the units and reps of its check stages", async () => {
    const dir = mkdtempSync(join(tmpdir(), "day-one-read-"));
    try {
      const units = join(dir, "units");
      for (const id of ["cccccc", "pppppp"]) fixtureUnit(units, id, 2);
      const out = join(dir, "out");
      const stage = (name: string, rows: unknown[], manifest?: { units: string[]; reps: number[] }) => {
        mkdirSync(join(out, name), { recursive: true });
        writeFileSync(join(out, name, "rows.ndjson"), rows.map((r) => JSON.stringify(r) + "\n").join(""));
        if (manifest) writeFileSync(join(out, name, "manifest.json"), JSON.stringify(manifest));
      };
      stage("base-counted", [planRow("base", "cccccc", "n", 100)]);
      stage("review-counted", [planRow("review", "cccccc", "d", 100)]);
      stage("check-counted", [checkRow("cccccc", "n", [true, false, false, false, false]), checkRow("cccccc", "d", [true, true, false, false, false])], { units: ["cccccc"], reps: [1] });
      stage("base-smoke", [planRow("base", "pppppp", "n", 0)]);
      stage("review-smoke", [planRow("review", "pppppp", "d", 0)]);
      stage("check-smoke", [], { units: ["pppppp"], reps: [1] });

      const counted = await run(["read", "--out", out, "--units-dir", units, "--tag", "counted", "--arms", "n", "d"]);
      expect(counted.code).toBe(0);
      const c = JSON.parse(counted.out);
      expect(c.arms.n.briefs).toBe(1);
      expect(c.comparisons["d-n"].briefs).toBe(1);
      expect(c.arms.d.share).toBe(0.4);

      const smoke = JSON.parse((await run(["read", "--out", out, "--units-dir", units, "--tag", "smoke", "--arms", "n", "d"])).out);
      expect(smoke.arms.n.briefs).toBe(1);
      expect(smoke.arms.n.share).toBe(0);

      const missing = await run(["read", "--out", out, "--units-dir", units, "--tag", "nosuch", "--arms", "n", "d"]);
      expect(missing.code).toBe(2);
      expect(missing.err).toContain("no check stage manifest");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("day-one stage", () => {
  test("--parallel below 1 or not a whole number is refused before anything opens", async () => {
    for (const v of ["0", "-1", "1.5", "two"]) {
      const r = await run(["stage", "--parallel", v]);
      expect(r.code).toBe(2);
      expect(r.err).toContain("--parallel is a whole number from 1");
    }
  });
});
