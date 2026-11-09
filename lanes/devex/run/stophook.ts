// Copyright (c) 2026 Garry Tan. MIT License.
// The Stop hook repair for plan-devex-review (prereg 2026-11-09-geva-417, section 10, smoke rule 5): gstack-evals code
// that runs the arm's detector (exposure.ts pdrExposure) when the session tries to stop and, while the procedure hasn't
// shown, blocks the stop with one fixed message naming the missing outputs, at most twice. The arm is then named "with
// an enforced procedure" in every headline. autoplan's repair is gstack's own stop gate at the pin (the install's
// autoplan gate option, src/trial/review/devex.ts DX_AUTOPLAN_GATE), named "with gstack's stop gate". Each arm records
// the repair it runs under. The hook is handed to the Claude Code driver as its stopHook option; each decision goes to
// stop-hook.ndjson in the session's host directory.
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { ArmId } from "../types.ts";
import { pdrExposure } from "./exposure.ts";

export const STOP_HOOK_MAX = 2;
export const STOP_HOOK_PREFIX = "Before you stop, finish the plan-devex-review procedure. These outputs have not shown yet: ";
/** The one fixed message, with the missing outputs named. */
export const stopMessage = (missing: readonly string[]): string => STOP_HOOK_PREFIX + missing.join("; ") + ". Then end your reply with the plan-changes block.";

export type Repair = "none" | "stop hook" | "gstack stop gate" | "double limits";
export const REPAIR_NAME: Readonly<Record<Repair, string | null>> = { none: null, "stop hook": "with an enforced procedure", "gstack stop gate": "with gstack's stop gate", "double limits": null };
/** The repair an arm's sessions run under; a smoke decision's repair applies to that arm on every model. */
export function armRepair(arm: ArmId, repaired: { kind: "stop hook" | "gstack stop gate" | "double limits" } | null): Repair {
  if (!repaired) return "none";
  if (repaired.kind === "double limits") return "double limits";
  if (repaired.kind === "stop hook" && arm !== "plan-devex-review") throw new Error("E_USAGE: the Stop hook repairs plan-devex-review only, not " + arm);
  if (repaired.kind === "gstack stop gate" && arm !== "autoplan") throw new Error("E_USAGE: gstack's stop gate repairs autoplan only, not " + arm);
  return repaired.kind;
}

/** A Stop hook for one session: blocks while the detector reads unexposed, at most STOP_HOOK_MAX times. */
export function makeStopHook(o: { log?: string | null; detect?: (transcript: string) => { exposed: boolean; missing: string[] } } = {}): ((transcript: string) => string | null) & { blocks: () => number } {
  const detect = o.detect ?? pdrExposure;
  let blocks = 0;
  const hook = (transcript: string): string | null => {
    const read = detect(transcript);
    const block = !read.exposed && blocks < STOP_HOOK_MAX;
    if (block) blocks++;
    if (o.log) {
      mkdirSync(dirname(o.log), { recursive: true });
      appendFileSync(o.log, JSON.stringify({ exposed: read.exposed, missing: read.missing, blocked: block, blocks }) + "\n");
    }
    return block ? stopMessage(read.missing) : null;
  };
  return Object.assign(hook, { blocks: () => blocks });
}
