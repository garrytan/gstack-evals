// Copyright (c) 2026 Garry Tan. MIT License.
// The keyless dry run (B8). The keyless legs run everywhere; the python session legs run only where a venv holding
// mini-swe-agent 2.4.6 and the pinned SDKs exists (DR_RUNTIME_VENV, the dev venv, or /opt/dr/venv) and are skipped in CI.
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { LADDER, main, sessionState } from "../../lanes/decision-routing/dryrun.ts";

const venv = [process.env.DR_RUNTIME_VENV, join(homedir(), ".cache", "decision-routing", "venv-dev"), "/opt/dr/venv"].find((v) => v && existsSync(join(v, "bin", "python")));

test("the defer ladder's particle and frontier deciders answer a session's first submit no and every later one yes", () => {
  const done = { type: "done", state: {}, options: ["yes", "no"], hits: [] };
  for (const decide of [LADDER.particle!, LADDER.frontier!]) {
    const st = sessionState();
    expect([decide(done, st), decide(done, st), decide(done, st)]).toEqual([{ p: 0.1 }, { p: 0.9 }, { p: 0.9 }]);
    expect(decide(done, sessionState())).toEqual({ p: 0.1 });
  }
});

test("keyless legs: verdict grids, draw.py, pilot rules, table tests and the leak scan all pass", async () => {
  const out = mkdtempSync(join(tmpdir(), "dr-dryrun-test-"));
  const code = await main(["--keyless", "--out", out]);
  const lines = JSON.parse(readFileSync(join(out, "dryrun.json"), "utf8")) as Array<{ status: string; name: string }>;
  expect(lines.filter((l) => l.status === "FAIL")).toEqual([]);
  expect(lines.filter((l) => l.status === "PASS").length).toBeGreaterThanOrEqual(15);
  expect(code).toBe(0);
}, 900_000);

describe.skipIf(!venv)("python legs (real dr_agent sessions behind the real metering proxy)", () => {
  test("every frozen rule passes", async () => {
    const out = mkdtempSync(join(tmpdir(), "dr-dryrun-full-"));
    const code = await main(["--venv", venv!, "--out", out]);
    const lines = JSON.parse(readFileSync(join(out, "dryrun.json"), "utf8")) as Array<{ status: string; name: string }>;
    expect(lines.filter((l) => l.status === "FAIL").map((l) => l.name)).toEqual([]);
    expect(code).toBe(0);
  }, 1_800_000);
});
