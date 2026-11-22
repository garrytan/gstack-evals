// Copyright (c) 2026 Garry Tan. MIT License.
// The reuse tests of B1b, B1c and B1d read each finished run's trees at its run commit. Their launch guards still read the live
// head, so on a head whose harness differs from B1's (part R of the Codex hooks eval changes quick/laneb) none of them launches.
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { b1bMain, reuseCheck } from "../../lanes/delivery-route/b1b.ts";
import { b1cMain } from "../../lanes/delivery-route/b1c.ts";
import { B1B_RUN } from "../../lanes/delivery-route/b1c-pins.ts";
import { b1dMain } from "../../lanes/delivery-route/b1d.ts";
import { B1C_RUN } from "../../lanes/delivery-route/b1d-pins.ts";

describe("the B1 launch guards on a head that changes B1's harness", () => {
  test("this head's quick/laneb differs from B1's run, and B1b's, B1c's and B1d's guards refuse it before reading a ledger", async () => {
    const live = reuseCheck("HEAD");
    expect(live.same).toBe(false);
    expect(live.lines.filter((l) => l.startsWith("DIFFERENT quick/laneb/")).length).toBeGreaterThan(0);
    const root = mkdtempSync(join(tmpdir(), "b1-reuse-guard-"));
    try {
      const cases = [["b1b-opus", b1bMain, B1B_RUN.commit], ["b1c-opus", b1cMain, B1C_RUN.commit], ["b1d-ho", b1dMain, "709dae5d50018c66cf3dba74ed19e0bc32295862"]] as const;
      for (const [item, main, runCommit] of cases) {
        const work = join(root, item);
        mkdirSync(work, { recursive: true });
        writeFileSync(join(work, "plan.json"), JSON.stringify({ item, git_head: runCommit, parts: [] }));
        await expect(main(["guard", work])).rejects.toThrow(new RegExp("^E_B1_LAUNCH " + item + ": (at HEAD the harness differs|the checkout's head differs from B1's harness)"));
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);
});
