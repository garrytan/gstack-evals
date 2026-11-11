// Copyright (c) 2026 Garry Tan. MIT License.
// F11: a resume whose journaled sessions no longer match their key prints its E_CACHE_STALE stop line and returns the
// stop, so review-units exits 2, instead of returning before the stop lines print. Keyless; no session runs.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LoadedPolicy } from "../../src/skill-eval/cli/policy.ts";
import type { HostRig } from "../../src/skill-eval/cli/run-host.ts";
import { removeTree } from "../../src/trial/cleanup.ts";
import type { ErCell } from "../../src/trial/review/eng-review.ts";
import { erJournal, runErUnits } from "../../src/trial/review/er-run.ts";

const root = mkdtempSync(join(tmpdir(), "er-stale-test-"));
afterAll(() => removeTree(root));

describe("er-run on a stale journal (F11)", () => {
  test("prints the E_CACHE_STALE line and returns the stop, with no session run", async () => {
    const out = join(root, "out");
    mkdirSync(out, { recursive: true });
    const cell: ErCell = { unit: "unit-a", arm: "none", model: "claude-opus-5-5", pass: 1 };
    writeFileSync(erJournal(out), JSON.stringify({ cell, key: "a key from an earlier build" }) + "\n");
    const rig = { arms: { none: { tree_sha256: "none-tree" } } } as unknown as HostRig;
    const lines: string[] = [];
    const run = await runErUnits(
      { units: [{ id: "unit-a", task: "er-unit-a", tree: join(root, "tree"), tree_sha256: "t", opening: null }], arms: ["none"], models: ["claude-opus-5-5"], passes: 1, parallel: 1, cap: 1_000_000, out, runId: "r", policy: { sha256: "p" } as unknown as LoadedPolicy, enforce: null, keyBase: {} },
      rig,
      (l) => lines.push(l),
    );
    expect(run.stops.map((s) => s.code)).toEqual(["E_CACHE_STALE"]);
    expect(run.entries).toEqual([]);
    expect(lines).toEqual(["E_CACHE_STALE 1 journaled session no longer match their key (none/claude-opus-5-5/unit-a/p1); start a new run in a new --out"]);
  });
});
