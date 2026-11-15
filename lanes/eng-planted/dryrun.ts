// Copyright (c) 2026 Garry Tan. MIT License.
// gstack-evals ep dryrun: every part's keyless dry-run cases (prereg 2026-11-15-geva-537 section 13). A case that needs
// Docker runs only under GSTACK_EVALS_DOCKER=1 and otherwise prints SKIP, which is never a pass: the run is ok only
// when every case passed.
import { DRY_CASES as CONSTRUCT } from "./construct/commands.ts";
import { DRY_CASES as READINGS } from "./readings/commands.ts";
import { DRY_CASES as STAGES } from "./stages/commands.ts";
import type { DryCase } from "./types.ts";

export const PARTS: Readonly<Record<string, readonly DryCase[]>> = { construct: CONSTRUCT, stages: STAGES, readings: READINGS };

export interface DryRunResult {
  ok: boolean;
  lines: string[];
  passed: number;
  failed: number;
  skipped: number;
}

/** Run the named parts' cases in order, one line per case. */
export async function dryRun(parts: readonly string[] = Object.keys(PARTS), docker = process.env.GSTACK_EVALS_DOCKER === "1"): Promise<DryRunResult> {
  const lines: string[] = [];
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  for (const part of parts) {
    const cases = PARTS[part];
    if (!cases) throw new Error("unknown dry-run part " + part);
    if (!cases.length) {
      lines.push("FAIL " + part + ": no dry-run cases");
      failed++;
      continue;
    }
    for (const c of cases) {
      const name = part + "/" + c.name;
      if (c.docker && !docker) {
        lines.push("SKIP " + name + ": needs Docker (GSTACK_EVALS_DOCKER=1); not a pass");
        skipped++;
        continue;
      }
      try {
        const r = await c.run();
        lines.push((r.ok ? "PASS " : "FAIL ") + name + ": " + r.detail);
        if (r.ok) passed++;
        else failed++;
      } catch (e) {
        lines.push("FAIL " + name + ": threw " + (e as Error).message);
        failed++;
      }
    }
  }
  return { ok: failed === 0 && skipped === 0, lines, passed, failed, skipped };
}
