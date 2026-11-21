// Copyright (c) 2026 Garry Tan. MIT License.
// Plan sections 12 and 15.7: the cso command row, rerun's checks and its ledger dry run (one lease opened and settled per
// frozen item on a temporary ledger), the draw command, and the home read audit the VM preflight runs.
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { COMMANDS as TABLE } from "../../src/cli.ts";
import { homeAudit, ledgerDryRun, main, readUnitIds, rerun } from "../../lanes/outcome-skills/cso/cli.ts";
import { loadCsoPrereg } from "../../lanes/outcome-skills/cso/prereg.ts";

const p = loadCsoPrereg();
const tmp = () => mkdtempSync(join(tmpdir(), "cso-cli-"));
const unitsFile = (ids: unknown) => {
  const f = join(tmp(), "units.json");
  writeFileSync(f, JSON.stringify(ids));
  return f;
};
const capture = async (fn: () => Promise<number>) => {
  const out: string[] = [], err: string[] = [];
  const [l, e] = [console.log, console.error];
  console.log = (...a: unknown[]) => void out.push(a.join(" "));
  console.error = (...a: unknown[]) => void err.push(a.join(" "));
  try {
    return { code: await fn(), out: out.join("\n"), err: err.join("\n") };
  } finally {
    console.log = l;
    console.error = e;
  }
};

describe("cso cli", () => {
  test("the cso row points at this module", () => {
    const row = (TABLE as Array<{ name: string; module: string }>).find((c) => c.name === "cso");
    expect(row?.module).toBe("lanes/outcome-skills/cso/cli.ts");
  });
  test("the ledger dry run opens and settles one lease per frozen item at prereg.json's caps", () => {
    const d = ledgerDryRun(p);
    expect(d.checks.map((c) => c.name)).toEqual(Object.keys(p.items).map((i) => "ledger lease " + i));
    expect(d.checks.every((c) => c.ok)).toBe(true);
  });
  test("rerun --dry-run checks its inputs, prints the allowance bound and settles every lease, running nothing", async () => {
    const r = await capture(() => main(["rerun", "--arm", "cso", "--model", "opus", "--units", unitsFile(["a", { unit: "b" }]), "--spend-cap", "10", "--dry-run"]));
    expect(r.code).toBe(0);
    expect(r.out).toContain("2 units; at most $16.00 if every session spent its $8 allowance");
    expect(r.out).toContain("exit 10");
    expect(r.out.match(/^PASS ledger lease /gm)?.length).toBe(Object.keys(p.items).length);
    expect(r.out).toContain("nothing ran");
  });
  test("rerun refuses a bad arm, an arm that never runs on the model, a bad units file, and a real run with no runner", async () => {
    const u = unitsFile(["a"]);
    expect((await capture(() => main(["rerun", "--arm", "gstack", "--model", "opus", "--units", u, "--spend-cap", "5"]))).err).toMatch(/^E_USAGE /);
    const untold = await capture(() => main(["rerun", "--arm", "untold", "--model", "particle", "--units", u, "--spend-cap", "5", "--dry-run"]));
    expect(untold.code).toBe(3);
    expect(untold.err).toMatch(/^E_CSO_RERUN_PRECONDITION /);
    expect((await capture(() => main(["rerun", "--arm", "none", "--model", "opus", "--units", unitsFile({ units: [] }), "--spend-cap", "5"]))).code).toBe(3);
    const real = await capture(() => main(["rerun", "--arm", "none", "--model", "opus", "--units", u, "--spend-cap", "5"]));
    expect(real.code).toBe(3);
    expect(real.err).toMatch(/^E_CSO_RERUN_UNWIRED /);
  });
  test("a wired runner stops before the session whose allowance would pass the cap", async () => {
    const ran: string[] = [];
    const runner = { run: async (o: { unit: string }) => (ran.push(o.unit), { cost_usd: 1 }) };
    await expect(rerun(["--arm", "none", "--model", "particle", "--units", unitsFile(["a", "b", "c"]), "--spend-cap", "4.5"], runner)).rejects.toThrow(/^E_CSO_CAP_STOP /);
    expect(ran).toEqual(["a", "b"]);
  });
  test("units files: ids, records and draw files", () => {
    expect(readUnitIds(unitsFile({ schema: "cso-draw.v1", units: [{ unit: "x", position: 1 }] }))).toEqual(["x"]);
    expect(() => readUnitIds(unitsFile([1]))).toThrow(/^E_CSO_RERUN_PRECONDITION /);
  });
  test("draw writes positions from built unit records once", async () => {
    const work = tmp();
    mkdirSync(join(work, "units"));
    for (let i = 1; i <= 134; i++) writeFileSync(join(work, "units", "u" + i + ".json"), JSON.stringify({ unit: "u" + i, position: i, source_files: 10 }));
    const r = await capture(() => main(["draw", "--work", work, "--n2", "60"]));
    expect(r.code).toBe(0);
    const d = JSON.parse(readFileSync(join(work, "draw-60.json"), "utf8"));
    expect(d.units.filter((u: { role: string }) => u.role === "stage2").length).toBe(60);
    expect((await capture(() => main(["draw", "--work", work, "--n2", "60"]))).code).toBe(2);
  });
  test("the read audit: the clean room holds no gstack path and no drive; a gstack home holds no drive", () => {
    const home = tmp();
    expect(homeAudit("none", home)).toEqual([]);
    mkdirSync(join(home, ".claude/skills"), { recursive: true });
    expect(homeAudit("none", home)).toEqual([".claude/skills"]);
    expect(homeAudit("cso", home)).toEqual([]);
    mkdirSync(join(home, ".capy"));
    expect(homeAudit("cso", home)).toEqual([".capy"]);
  });
  test("no subcommand prints help and exits 2; an unknown one refuses", async () => {
    expect((await capture(() => main([]))).code).toBe(2);
    expect((await capture(() => main(["nope"]))).err).toMatch(/^E_USAGE /);
  });
});
