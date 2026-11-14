// Copyright (c) 2026 Garry Tan. MIT License.
// Value: protects=the driver options the founder loop needs on the real pinned SDK and CLI: maxTurns counts per user message, nextUser gets each reply's main-agent texts and its answer goes in as the next user message, the session clock stops while nextUser runs, a stop from nextUser is the session's termination, and a driver without nextUser still ends after its first result; fails_when=the pinned CLI counts maxTurns across the whole session, a founder turn's wait counts against 120 minutes, or the default driver changes; why_new=the run area's driver options; seam=claudeCodeDriver nextUser, maxTurns; no_claim=Docker containment, which the run seams cover under GSTACK_EVALS_DOCKER=1
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { HAS_CLAUDE_CLI } from "../../adapters/harness.ts";

describe.skipIf(!HAS_CLAUDE_CLI)("the driver's founder-loop options on the real SDK", () => {
  let ran: ReturnType<typeof spawnSync> | undefined;
  const result = () => {
    ran ??= spawnSync(process.execPath, [join(import.meta.dir, "driver-sdk.ts")], { encoding: "utf8", timeout: 170_000 });
    expect(ran.status).toBe(0);
    return JSON.parse(String(ran.stdout).trim().split("\n").at(-1)!);
  };

  test("maxTurns 2 holds three replies of two turns each, so the cap is per reply", () => {
    const r = result().maxTurns;
    expect(r.termination).toEqual({ kind: "completed" });
    expect(r.requests).toBe(6);
    expect(r.texts).toEqual([["Reply 1."], ["Reply 2."], ["Reply 3."]]);
    expect(r.users).toBe(3);
  }, 180_000);

  test("two 4-second founder turns inside a 6-second session clock end completed", () => {
    const r = result().clock;
    expect(r.termination).toEqual({ kind: "completed" });
    expect(r.texts).toHaveLength(3);
  }, 180_000);

  test("a stop from nextUser is the termination", () => {
    expect(result().stopped.termination).toEqual({ kind: "missing", code: "E_OF_SIM_TURN" });
  }, 180_000);

  test("without nextUser the session ends after one reply", () => {
    const r = result().plain;
    expect(r.termination).toEqual({ kind: "completed" });
    expect(r.requests).toBe(1);
  }, 180_000);
});
