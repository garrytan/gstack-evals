import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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
