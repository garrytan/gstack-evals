// Copyright (c) 2026 Garry Tan. MIT License.
// dx readings (prereg 2026-11-09-geva-417, sections 6 and 10): the smoke rules and decision from a rows file, the parse
// rate and admission, and coverage and contamination per cell. Usage errors are E_USAGE with a fix line.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../../../lanes/devex/cli.ts";
import { releasedRow } from "../../../lanes/devex/run/session.ts";
import type { DxRow } from "../../../lanes/devex/run/rows.ts";
import type { ArmId, ModelId } from "../../../lanes/devex/types.ts";

const dir = mkdtempSync(join(tmpdir(), "dx-readings-test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const row = (arm: ArmId, model: ModelId, i: number, o: Partial<DxRow> = {}): DxRow => ({ ...releasedRow({ id: "x", unit: "u" + i, arm, model, pass: 1, stage: 1, smoke: arm !== "none" }, "E_DX_NO_BLOCK", null), end: "block", code: null, list: ["Print the fix."], exposed: arm === "none" || arm === "lens" ? null : true, markers: { reviewer: true, gate: true }, spend_micros: 1_000_000, ...o });
const write = (name: string, rows: DxRow[]) => {
  const p = join(dir, name);
  writeFileSync(p, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  return p;
};
const smokeRows = (apParsed: number) => [
  ...[0, 1, 2, 3, 4, 5].map((i) => row("plan-devex-review", "opus", i)),
  ...[6, 7].flatMap((i) => [row("plan-devex-review", "sol", i), row("plan-devex-review", "particle", i)]),
  ...[0, 1, 2, 3, 4, 5].map((i) => row("autoplan", "opus", i, i < apParsed ? {} : { end: "no-block", code: "E_DX_NO_BLOCK", list: null })),
  ...[6, 7].flatMap((i) => [row("autoplan", "sol", i), row("autoplan", "particle", i)]),
];
async function dx(argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(["readings", ...argv], { out: (t) => void out.push(t), err: (t) => void err.push(t) });
  return { code, out: out.join("\n"), err: err.join("\n") };
}

describe("dx readings", () => {
  test("smoke: rules 1 to 4 per gstack arm and the rule 5 and 6 decision", async () => {
    const rows = write("smoke.ndjson", smokeRows(4));
    const r = await dx(["smoke", "--rows", rows, "--projection-fits", "yes", "--doubled-fits", "no"]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/smoke plan-devex-review: pass/);
    expect(r.out).toMatch(/smoke autoplan: fail: rule 1 opus parse: parsed 4 of 6/);
    expect(r.out).toMatch(/decision autoplan: repair with gstack's stop gate \(E_DX_EXPOSURE_REPAIR\)/);
    const five = await dx(["smoke", "--rows", write("smoke5.ndjson", smokeRows(5)), "--projection-fits", "yes", "--doubled-fits", "no"]);
    expect(five.out).toMatch(/smoke autoplan: pass/);
  });
  test("smoke: a rerun after the repair that fails again drops the arm", async () => {
    const first = smokeRows(4);
    const rerun = first.filter((r) => r.arm === "autoplan").map((r) => ({ ...r, pass: 2 }));
    const r = await dx(["smoke", "--rows", write("rerun.ndjson", [...first, ...rerun]), "--projection-fits", "yes", "--doubled-fits", "no"]);
    expect(r.out).toMatch(/decision autoplan: dropped on opus \(E_DX_ARM_DROPPED\)/);
  });
  test("admission: the parse rate from the Opus none rows, then the band", async () => {
    const none = Array.from({ length: 20 }, (_, i) => row("none", "opus", i, i === 0 ? { end: "no-block", code: "E_DX_NO_BLOCK", list: null } : {}));
    const input = join(dir, "admission.json");
    writeFileSync(input, JSON.stringify({ noneA: 0.3, stockFail: false, judge: { pass: true, shortfall: false }, floor: { checkA: null, oracleCredit: null } }));
    const ok = await dx(["admission", "--rows", write("none.ndjson", none), "--input", input]);
    expect(ok.code).toBe(0);
    expect(ok.out).toMatch(/parse rate 19 of 20 \(0\.9500\)/);
    expect(ok.out).toMatch(/admission HEADROOM/);
    const low = await dx(["admission", "--rows", write("none2.ndjson", none.map((r, i) => (i === 1 ? { ...r, end: "missing" as const, code: "E_DX_INFRA_MISSING", list: null } : r))), "--input", input]);
    expect(low.out).toMatch(/parse rate 18 of 20 \(0\.9000\)/);
    expect(low.out).toMatch(/admission NO READ/);
  });
  test("cells: coverage, contamination and the end rates per cell", async () => {
    const rows = [...Array.from({ length: 9 }, (_, i) => row("lens", "opus", i)), row("lens", "opus", 9, { end: "contaminated", code: "E_DX_ARM_CONTAMINATED", list: null, gstack_read: true })];
    const r = await dx(["cells", "--rows", write("cells.ndjson", rows)]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/lens on opus stage 1 smoke: 10 planned; coverage 0\.9000 \(before judging[^)]*\); contamination 0\.1000 \(untested: contamination\); block 0\.9000/);
  });
  test("usage errors are E_USAGE with a fix line", async () => {
    for (const argv of [[], ["nope"], ["smoke"], ["smoke", "--rows", join(dir, "missing.ndjson"), "--projection-fits", "yes", "--doubled-fits", "no"], ["smoke", "--rows", join(dir, "smoke.ndjson")], ["admission", "--rows", join(dir, "none.ndjson")]]) {
      const r = await dx(argv);
      expect(r.code).toBe(2);
      expect(r.err).toMatch(/^E_USAGE dx readings: /);
      expect(r.err).toContain("\n  fix: ");
    }
  });
});
