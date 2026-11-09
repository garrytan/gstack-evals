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
const row = (arm: ArmId, model: ModelId, i: number, o: Partial<DxRow> = {}): DxRow => ({ ...releasedRow({ id: "x", unit: "u" + i, arm, model, pass: 1, stage: 1, smoke: arm !== "none" }, "E_DX_NO_BLOCK", null), end: "block", code: null, list: ["Print the fix."], exposed: arm === "none" || arm === "lens" ? null : true, markers: { reviewer: true, gate: true }, spend_micros: 1_000_000, launched: true, ...o });
/** The s1-none run's planned Opus none slots: 16 units x 3 passes, in order. */
const planned = (rows: DxRow[]) => rows.map((r, i) => ({ ...r, unit: "u" + (i % 16), pass: Math.floor(i / 16) + 1 }));
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
  test("smoke: pass 1 is judged at the plain limits, and a rerun at the limits its rows' repair names", async () => {
    const at = (rows: DxRow[], arm: ArmId, pass: number, o: Partial<DxRow>) => rows.filter((r) => r.arm === arm).map((r) => ({ ...r, pass, ...o }));
    const base = smokeRows(6);
    const dear = base.map((r) => (r.arm === "plan-devex-review" && r.model === "opus" ? { ...r, spend_micros: 8_000_000 } : r));
    const first = await dx(["smoke", "--rows", write("dear.ndjson", [...dear, ...at(base, "plan-devex-review", 2, { repair: "double limits" })]), "--projection-fits", "yes", "--doubled-fits", "yes"]);
    expect(first.code).toBe(0);
    expect(first.out).toMatch(/smoke plan-devex-review: fail: rule 4 opus cost-median/);
    expect(first.out).toMatch(/rerun plan-devex-review: pass/);
    const rerun = await dx(["smoke", "--rows", write("doubled.ndjson", [...dear, ...at(base, "plan-devex-review", 2, { repair: "double limits", spend_micros: 10_000_000 })]), "--projection-fits", "yes", "--doubled-fits", "yes"]);
    expect(rerun.out).toMatch(/rerun plan-devex-review: pass/);
    const plain = await dx(["smoke", "--rows", write("plain.ndjson", [...dear, ...at(base, "plan-devex-review", 2, { repair: "stop hook", spend_micros: 10_000_000 })]), "--projection-fits", "yes", "--doubled-fits", "yes"]);
    expect(plain.out).toMatch(/rerun plan-devex-review: fail: rule 4 opus cost-median/);
    const unfit = await dx(["smoke", "--rows", write("unfit.ndjson", [...base, ...at(base, "plan-devex-review", 2, { repair: "double limits" })]), "--projection-fits", "yes", "--doubled-fits", "no"]);
    expect(unfit.out).toMatch(/smoke plan-devex-review: pass/);
    expect(unfit.out).toMatch(/rerun plan-devex-review: fail: rule 4 opus cost-projection/);
    const mixed = at(base, "plan-devex-review", 2, { repair: "double limits" }).map((r, i) => (i === 0 ? { ...r, repair: "stop hook" } : r));
    const refused = await dx(["smoke", "--rows", write("mixed.ndjson", [...base, ...mixed]), "--projection-fits", "yes", "--doubled-fits", "yes"]);
    expect(refused.code).toBe(2);
    expect(refused.err).toMatch(/^E_USAGE dx readings: plan-devex-review smoke pass 2 rows name repairs/);
    expect(refused.err).toContain("\n  fix: ");
  });
  test("admission: the parse rate from the Opus none rows, then the band", async () => {
    const none = planned(Array.from({ length: 48 }, (_, i) => row("none", "opus", i, i < 8 ? { end: "missing", code: "E_DX_INFRA_MISSING", list: null } : i < 10 ? { end: "no-block", code: "E_DX_NO_BLOCK", list: null } : {})));
    const input = join(dir, "admission.json");
    writeFileSync(input, JSON.stringify({ noneA: 0.3, stockFail: false, judge: { pass: true, shortfall: false }, floor: { checkA: null, oracleCredit: null } }));
    const ok = await dx(["admission", "--rows", write("none.ndjson", none), "--input", input]);
    expect(ok.code).toBe(0);
    expect(ok.out).toMatch(/parse rate 38 of 40 \(0\.9500\)/);
    expect(ok.out).toMatch(/admission HEADROOM/);
    const low = await dx(["admission", "--rows", write("none2.ndjson", none.map((r, i) => (i === 10 ? { ...r, end: "missing" as const, code: "E_DX_INFRA_MISSING", list: null } : r))), "--input", input]);
    expect(low.out).toMatch(/parse rate 37 of 39 \(0\.9487\) Opus none replies; the bar is 0\.95; left out 9 infrastructure misses and contaminated rows \(E_DX_INFRA_MISSING 9\)/);
    expect(low.out).toMatch(/admission NO READ/);
  });
  test("admission refuses a floor that does not read and an s1-none run that is not complete (ruling 3)", async () => {
    const full = planned(Array.from({ length: 48 }, (_, i) => row("none", "opus", i)));
    const rows = write("none-full.ndjson", full);
    let n = 0;
    for (const floor of [{}, { checkA: 0.1 }, { checkA: "0.1", oracleCredit: 0.95 }, { checkA: 0.1, oracleCredit: true }, [0.1, 0.95], null]) {
      const input = join(dir, "floor-bad-" + n++ + ".json");
      writeFileSync(input, JSON.stringify({ noneA: 0.05, stockFail: false, judge: { pass: true, shortfall: false }, floor }));
      const r = await dx(["admission", "--rows", rows, "--input", input]);
      expect(r.code).toBe(2);
      expect(r.err).toMatch(/E_USAGE/);
      expect(r.err).toMatch(/floor must hold checkA and oracleCredit, each a number or null|lacks/);
      expect(r.out).not.toMatch(/admission (FLOOR|NO READ|HEADROOM)/);
    }
    const input = join(dir, "floor-ok.json");
    writeFileSync(input, JSON.stringify({ noneA: 0.3, stockFail: false, judge: { pass: true, shortfall: false }, floor: { checkA: null, oracleCredit: null } }));
    const cases: Array<[string, DxRow[]]> = [["short", full.slice(0, 47)], ["twice", [...full.slice(0, 47), full[0]!]], ["pass4", full.map((r, i) => (i === 47 ? { ...r, pass: 4 } : r))], ["held", full.slice(0, 20)]];
    for (const [name, rs] of cases) {
      const r = await dx(["admission", "--rows", write("none-" + name + ".ndjson", rs), "--input", input]);
      expect(r.code).toBe(2);
      expect(r.err).toMatch(/E_USAGE/);
      expect(r.err).toMatch(/admission reads every planned Opus none session of the s1-none run \(16 units x 3 passes, 48 rows/);
    }
    expect((await dx(["admission", "--rows", rows, "--input", input])).code).toBe(0);
  });
  test("rule 4's cost median leaves out cost_unknown Opus sessions and prints how many (ruling 6)", async () => {
    const dear = smokeRows(6).map((r, i) => (i >= 3 && i <= 5 ? { ...r, spend_micros: 10_000_000_000 } : r));
    const counted = await dx(["smoke", "--rows", write("smoke-dear.ndjson", dear), "--projection-fits", "yes", "--doubled-fits", "no"]);
    expect(counted.out).toMatch(/smoke plan-devex-review: fail: .*rule 4/);
    const left = await dx(["smoke", "--rows", write("smoke-unknown.ndjson", dear.map((r, i) => (i === 5 ? { ...r, cost_unknown: true } : r))), "--projection-fits", "yes", "--doubled-fits", "no"]);
    expect(left.out).toMatch(/smoke plan-devex-review: pass/);
    expect(left.out).toMatch(/rule 4's cost median left out 1 cost_unknown Opus session(?!s)/);
  });
  test("an arm with smoke pass 2 rows and no pass 1 rows is refused under E_USAGE, not a TypeError (ruling 10)", async () => {
    const rows = [...smokeRows(6).filter((r) => r.arm !== "autoplan"), ...smokeRows(6).filter((r) => r.arm === "autoplan").map((r) => ({ ...r, pass: 2 }))];
    const r = await dx(["smoke", "--rows", write("smoke-pass2.ndjson", rows), "--projection-fits", "yes", "--doubled-fits", "no"]);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/E_USAGE.*autoplan has smoke pass 2 rows and no pass 1 rows/);
    expect(r.err).not.toMatch(/TypeError/);
  });
  test("admission: infrastructure misses and contaminated rows leave the denominator, and model-caused stops stay in it", async () => {
    const input = join(dir, "admission48.json");
    writeFileSync(input, JSON.stringify({ noneA: 0.3, stockFail: false, judge: { pass: true, shortfall: false }, floor: { checkA: null, oracleCredit: null } }));
    const blocks = Array.from({ length: 45 }, (_, i) => row("none", "opus", i));
    const infra = [row("none", "opus", 45, { end: "missing", code: "E_DX_INFRA_MISSING", list: null }), row("none", "opus", 46, { end: "missing", code: "CAP_STOP", list: null }), row("none", "opus", 47, { end: "missing", code: "E_DX_PROVIDER_DRIFT", list: null, launched: false })];
    const ok = await dx(["admission", "--rows", write("none48-infra.ndjson", planned([...blocks, ...infra])), "--input", input]);
    expect(ok.out).toMatch(/parse rate 45 of 45 \(1\.0000\) Opus none replies; the bar is 0\.95; left out 3 infrastructure misses and contaminated rows \(E_DX_INFRA_MISSING 1, CAP_STOP 1, E_DX_PROVIDER_DRIFT 1\)/);
    expect(ok.out).toMatch(/admission HEADROOM/);
    const stops = [45, 46, 47].map((i) => row("none", "opus", i, { end: "session-stop", code: "E_DX_ARM_STOP", list: null }));
    const low = await dx(["admission", "--rows", write("none48-stops.ndjson", planned([...blocks, ...stops])), "--input", input]);
    expect(low.out).toMatch(/parse rate 45 of 48 \(0\.9375\) Opus none replies; the bar is 0\.95; left out 0 infrastructure misses/);
    expect(low.out).toMatch(/admission NO READ/);
    const web = await dx(["admission", "--rows", write("none48-web.ndjson", planned([...blocks, ...[45, 46, 47].map((i) => row("none", "opus", i, { end: "contaminated", code: "E_DX_WEB_CONTAMINATED", list: null }))])), "--input", input]);
    expect(web.out).toMatch(/parse rate 45 of 45 .*\(E_DX_WEB_CONTAMINATED 3\)/);
  });
  test("smoke rule 4: the cost median leaves out sessions released before any attempt and keeps a launched session at its spend", async () => {
    const pdr = (spend: number[], o: Partial<DxRow>[]) => smokeRows(6).map((r) => r).filter((r) => !(r.arm === "plan-devex-review" && r.model === "opus")).concat(spend.map((s, i) => row("plan-devex-review", "opus", i, { spend_micros: s, ...o[i] })));
    const gone = { end: "missing" as const, code: "CAP_STOP", list: null };
    const released = await dx(["smoke", "--rows", write("released.ndjson", pdr([7e6, 7e6, 7e6, 0, 0, 0], [{}, {}, {}, { ...gone, launched: false }, { ...gone, launched: false }, { ...gone, launched: false }])), "--projection-fits", "yes", "--doubled-fits", "yes"]);
    expect(released.out).toMatch(/smoke plan-devex-review: fail: .*rule 4 opus cost-median: Opus smoke median 7000000 micros/);
    expect(released.out).toMatch(/rule 1 opus parse/);
    const spent = await dx(["smoke", "--rows", write("spent.ndjson", pdr([1e6, 1e6, 8e6, 8e6, 8e6, 8e6], [{}, {}, gone, gone, gone, gone])), "--projection-fits", "yes", "--doubled-fits", "yes"]);
    expect(spent.out).toMatch(/rule 4 opus cost-median: Opus smoke median 8000000 micros/);
  });
  test("cells: coverage, contamination and the end rates per cell", async () => {
    const rows = [...Array.from({ length: 9 }, (_, i) => row("lens", "opus", i)), row("lens", "opus", 9, { end: "contaminated", code: "E_DX_ARM_CONTAMINATED", list: null, gstack_read: true })];
    const r = await dx(["cells", "--rows", write("cells.ndjson", rows)]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/lens on opus stage 1 smoke: 10 planned; coverage 0\.9000 \(before judging[^)]*\); contamination 0\.1000 \(untested: contamination\); block 0\.9000/);
  });
  test("cells: coverage with --reviews counts distinct sessions, so a duplicate review lifts nothing", async () => {
    const rows = Array.from({ length: 10 }, (_, i) => row("lens", "opus", i, { session: "u" + i + ":opus:lens:1" }));
    const review = (i: number) => ({ unit: "u" + i, model: "opus", arm: "lens", stage: 1, pass: 1, smoke: true, session: "u" + i + ":opus:lens:1", status: "scored", A: 0.5 });
    const reviews = join(dir, "reviews.ndjson");
    writeFileSync(reviews, [0, 1, 2, 3, 4, 5, 6, 7, 8, 0, 0].map((i) => JSON.stringify(review(i))).join("\n") + "\n");
    const r = await dx(["cells", "--rows", write("cells-reviews.ndjson", rows), "--reviews", reviews]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/lens on opus stage 1 smoke: 10 planned; coverage 0\.9000;/);
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
