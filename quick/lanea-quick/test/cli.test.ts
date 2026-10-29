import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const work = mkdtempSync(join(tmpdir(), "cli-"));
writeFileSync(join(work, "prepared.json"), JSON.stringify({ suites: { "office-hours": { tasks: [{ id: "a", prompt: "p" }] }, learn: { tasks: [{ id: "b", prompt: "p" }] } }, sizes: {}, images: {} }));
const shell = { PATH: process.env.PATH ?? "", HOME: work, LANEA_WORK: work };
const spawn = (env: Record<string, string>, args: string[]) => {
  const p = Bun.spawnSync([process.execPath, "src/run.ts", ...args], { cwd: root, env });
  return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() };
};
const cli = (...args: string[]) => spawn({ ...shell, LANEA_LEDGER: join(work, "ledger.jsonl"), LANEA_CAP_USD: "10", LANEA_LINE_ITEM: "t" }, args);
const approveArgs = ["approve", "--words", "Rec", "--by", "x", "--source", "y"];

describe("run.ts arguments", () => {
  test("project is read-only and needs no --prereg", () => {
    const r = cli("project", "--stage", "S2");
    expect(r.err).not.toContain("E_PREREG");
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out)).toMatchObject({ stage: "S2", ledger: { settled: 0, open: 0 } });
  });
  test("a fresh shell without LANEA_CAP_USD and LANEA_LINE_ITEM refuses approve, run and project and writes no ledger", () => {
    const home = mkdtempSync(join(tmpdir(), "cli-home-"));
    for (const args of [approveArgs, ["run", "--stage", "S1", "--prereg", "a".repeat(40)], ["project"]]) {
      const r = spawn({ ...shell, HOME: home }, args);
      expect(r.code).not.toBe(0);
      expect(r.err).toContain("E_CONFIG");
    }
    expect(existsSync(join(home, ".capy"))).toBe(false);
  });
  test("approve writes the runner's cap and item as the first row of the ledger named after the item", () => {
    const home = mkdtempSync(join(tmpdir(), "cli-home-"));
    expect(spawn({ ...shell, HOME: home, LANEA_CAP_USD: "35", LANEA_LINE_ITEM: "lanea-cli" }, approveArgs).code).toBe(0);
    const row = JSON.parse(readFileSync(join(home, ".capy/drive/captain-gstack-evals/ledger/lanea-cli.jsonl"), "utf8"));
    expect(row).toMatchObject({ type: "approval", item: "lanea-cli", cap_usd: 35 });
  });
  test("a paid run still needs --prereg", () => {
    expect(cli("run", "--stage", "S1").err).toContain("E_PREREG");
  });
  test("a fake run refuses a ledger outside its --out", () => {
    const r = cli("run", "--stage", "S1", "--fake", "--out", join(work, "runs-fake"), "--ledger", join(work, "ledger.jsonl"));
    expect(r.code).not.toBe(0);
    expect(r.err).toContain("E_LEDGER_FAKE");
  });
  test("a run with an unknown model or no matching cells stops before it writes anything", () => {
    const out = join(work, "runs-plan");
    const model = cli("run", "--stage", "S1", "--fake", "--out", out, "--models", "claude-nope");
    expect(model.code).not.toBe(0);
    expect(model.err).toContain("E_TASKS: unknown model claude-nope");
    const none = cli("run", "--stage", "S1", "--fake", "--out", out, "--tasks", "no-such-task");
    expect(none.code).not.toBe(0);
    expect(none.err).toContain("E_TASKS: no cells");
    expect(existsSync(join(out, "stages"))).toBe(false);
  });
  test("a stage that stopped is never resumed for a model it stopped", () => {
    const out = join(work, "runs-stopped");
    mkdirSync(join(out, "stages"), { recursive: true });
    writeFileSync(join(out, "stages", "S1.1.json"), JSON.stringify({ stage: "S1", models: ["claude-haiku-5-5"], status: "done", cap_stop: "STOP: reason=budget_exhausted" }));
    const r = cli("run", "--stage", "S1", "--fake", "--out", out, "--models", "claude-haiku-5-5");
    expect(r.code).not.toBe(0);
    expect(r.err).toContain("E_STAGE_STOPPED");
    expect(readdirSync(join(out, "stages"))).toEqual(["S1.1.json"]);
  });
  test("a stop in one stage refuses every later run into that --out", () => {
    const out = join(work, "runs-stopped-any");
    mkdirSync(join(out, "stages"), { recursive: true });
    writeFileSync(join(out, "stages", "S1.1.json"), JSON.stringify({ stage: "S1", suite: "office-hours", models: ["claude-haiku-5-5", "claude-opus-5-5"], status: "done", cap_stop: "STOP: reason=reservation_exceeded" }));
    for (const stage of ["S2", "S3"]) {
      const r = cli("run", "--stage", stage, "--fake", "--out", out);
      expect(r.code).not.toBe(0);
      expect(r.err).toContain("E_STAGE_STOPPED: RESERVATION_EXCEEDED S1");
    }
    expect(readdirSync(join(out, "stages"))).toEqual(["S1.1.json"]);
  });
  test("a result that cost more than its reservation refuses later runs with no stage stop on file", () => {
    const out = join(work, "runs-past-reserve");
    const cell = join(out, "office-hours", "claude-haiku-5-5", "a", "before", "t1");
    mkdirSync(cell, { recursive: true });
    writeFileSync(join(cell, "result.json"), JSON.stringify({ suite: "office-hours", model: "claude-haiku-5-5", task: "a", arm: "before", trial: 1, status: "complete", cost_usd: 2 }));
    const r = cli("run", "--stage", "S2", "--fake", "--out", out);
    expect(r.code).not.toBe(0);
    expect(r.err).toContain("E_STAGE_STOPPED: RESERVATION_EXCEEDED S1");
    expect(existsSync(join(out, "stages"))).toBe(false);
  });
  test("prepare refuses while a runner holds WORK", () => {
    writeFileSync(join(work, "runner.lock"), JSON.stringify({ pid: process.pid, token: "t" }));
    try {
      const r = cli("prepare");
      expect(r.code).not.toBe(0);
      expect(r.err).toContain("E_LOCK");
    } finally {
      rmSync(join(work, "runner.lock"), { force: true });
    }
  });
});
