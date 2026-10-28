import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const work = mkdtempSync(join(tmpdir(), "cli-"));
writeFileSync(join(work, "prepared.json"), JSON.stringify({ suites: { "office-hours": { tasks: [{ id: "a", prompt: "p" }] }, learn: { tasks: [{ id: "b", prompt: "p" }] } }, sizes: {}, images: {} }));
const cli = (...args: string[]) => {
  const p = Bun.spawnSync([process.execPath, "src/run.ts", ...args], { cwd: root, env: { PATH: process.env.PATH ?? "", HOME: work, LANEA_WORK: work, LANEA_LEDGER: join(work, "ledger.jsonl") } });
  return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() };
};

describe("run.ts arguments", () => {
  test("project is read-only and needs no --prereg", () => {
    const r = cli("project", "--stage", "S2");
    expect(r.err).not.toContain("E_PREREG");
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out)).toMatchObject({ stage: "S2", ledger: { settled: 0, open: 0 } });
  });
  test("a paid run still needs --prereg", () => {
    expect(cli("run", "--stage", "S1").err).toContain("E_PREREG");
  });
  test("a fake run refuses a ledger outside its --out", () => {
    const r = cli("run", "--stage", "S1", "--fake", "--out", join(work, "runs-fake"), "--ledger", join(work, "ledger.jsonl"));
    expect(r.code).not.toBe(0);
    expect(r.err).toContain("E_LEDGER_FAKE");
  });
});
