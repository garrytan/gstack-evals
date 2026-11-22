// Copyright (c) 2026 Garry Tan. MIT License.
// Part C's frozen values: the suite, the seed and the pilot draw (preregistration sections 5.1 and 9), the prefix and the
// four arms as review-units' codex-arms entries (section 5.2, pre-run change 1, section 5), the per-session limits
// (section 5.7) and the four ledger items with their sessions, central estimates, caps and allowances (section 11).
//
// - The seeded order is L1's shuffle (seeded in quick/laneb/l1/l1.ts) over the suite's 33 unit ids at seed 20261119; the
//   pilot is its first six units at one pass, the counted run all 33 at two.
// - Every gstack arm installs gstack at the pin with Codex 0.170.0 first on PATH, because gstack's setup registers its Codex
//   hooks only for codex 0.170.0 or later and the image's default codex is 0.166.0.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { seeded } from "../../../quick/laneb/l1/l1.ts";
import type { CodexArmSpec } from "../../../src/trial/review/codex.ts";
import { ARM_SETTINGS, CODEX, EFFORT, GSTACK, MODEL, REPO, SWITCHES } from "../pins.ts";

export const SUITE = { path: "wiki/plans/2026-10-31-geva-76-stacks-round-1-prereg/stacks-r1.json", sha256: "4f46bb17b7ef98a34db9bf4b03c69755c694eb17dfc7ca0e29e1049a1bcc9a1d", units: 33 } as const;
export const SEVERITY_MAP = "wiki/plans/2026-10-31-geva-76-stacks-round-1-prereg/severity-map.json";
export const SEED = 20261119;
export const PILOT_UNITS = 6;
export const PASSES = { pilot: 1, main: 2 } as const;

// Section 5.2's prefix, byte for byte; tests/codex-hooks/c/pins.test.ts pins its sha256.
export const PREFIX = "Report findings only; do not make Fix-First edits. Writes to gstack's own state (its learnings, timeline and review log) are allowed. If a stop hook blocks your reply, end your next reply again with the complete fenced json block.";
export const PREFIX_SHA256 = "cf473585a0c5d3df0f032d18c469845709d28978a7ed6d9c39de8609c987aa65";
export const TOLD_PREFIX = "$review " + PREFIX;

// gstack's markers that section 5.6's independent check reads.
export const MARKER = "Think like an attacker and a chaos engineer";
export const REPORT_HEADING = "Pre-Landing Review";
export const GATE_LABEL = "Gate edits";

export const CODEX_DIR = "/opt/codex-" + CODEX.version;
export const CODEX_BIN = CODEX_DIR + "/bin/codex";
export const INSTALL = "PATH=" + CODEX_DIR + "/bin:$PATH ./setup --host codex --no-browser -q";
export const TIMEOUT_S = 3600;
export const PARALLEL = 4;

export const ARM_NAMES = ["c-on", "c-off", "c-high", "c-none"] as const;
export type ArmName = (typeof ARM_NAMES)[number];
export const isArm = (s: string): s is ArmName => (ARM_NAMES as readonly string[]).includes(s);
/** The arms whose sessions the contract can block; their sessions get a first-stop state. */
export const CONTRACT_ARMS: readonly ArmName[] = ["c-on", "c-high"];

const gstackArm = (effort: string, config: Record<string, string>): CodexArmSpec => ({ effort, hook_trust: true, settings: { ...ARM_SETTINGS }, gstack_config: config, switches: [...SWITCHES], install: INSTALL, told_prefix: TOLD_PREFIX });
export const ARMS: Readonly<Record<ArmName, CodexArmSpec>> = {
  "c-on": gstackArm(EFFORT.low, {}),
  "c-off": gstackArm(EFFORT.low, { skill_contracts: "off" }),
  "c-high": gstackArm(EFFORT.high, {}),
  "c-none": { effort: EFFORT.low, hook_trust: false, settings: { ...ARM_SETTINGS }, gstack_config: {}, switches: [], install: null, told_prefix: null },
};
/** An arm as review-units' --arms names it. */
export const armRef = (arm: ArmName): string => (ARMS[arm].install === null ? arm + "=none" : arm + "=garrytan/gstack@" + GSTACK.sha);

/** The codex-arms file for the arms one review-units run names. */
export const codexArmsText = (arms: readonly ArmName[]): string => JSON.stringify({ schema_version: 1, bin: CODEX_BIN, arms: Object.fromEntries(arms.map((a) => [a, ARMS[a]])) }, null, 2) + "\n";

export const ITEM_NAMES = ["c-pilot", "h-pilot", "c-main", "h-main"] as const;
export type ItemName = (typeof ITEM_NAMES)[number];
export interface ItemPlan {
  arms: readonly ArmName[];
  phase: "pilot" | "main";
  sessions: number;
  central_usd: number;
  cap_usd: number;
  /** The per-session allowance in dollars (section 5.7). */
  allowance_usd: number;
  /** The VM share inside central_usd: what section 11's central leaves after the planned session prices. The pilots' items pay for sessions only. */
  vm_usd: number;
}
export const ITEMS: Readonly<Record<ItemName, ItemPlan>> = {
  "c-pilot": { arms: ["c-on", "c-off", "c-none"], phase: "pilot", sessions: 18, central_usd: 21, cap_usd: 60, allowance_usd: 8, vm_usd: 0 },
  "h-pilot": { arms: ["c-high"], phase: "pilot", sessions: 6, central_usd: 18, cap_usd: 85, allowance_usd: 15, vm_usd: 0 },
  "c-main": { arms: ["c-on", "c-off", "c-none"], phase: "main", sessions: 198, central_usd: 234, cap_usd: 345, allowance_usd: 8, vm_usd: 9.6 },
  "h-main": { arms: ["c-high"], phase: "main", sessions: 66, central_usd: 201, cap_usd: 330, allowance_usd: 15, vm_usd: 3 },
};
export const isItem = (s: string): s is ItemName => (ITEM_NAMES as readonly string[]).includes(s);

/** An arm with more than this many of its counted sessions not scored reads INCOMPLETE (section 5.8). */
export const INCOMPLETE_ABOVE = 7;

/** The suite's unit ids, checked against the frozen sha256. */
export function suiteUnits(repo = REPO): string[] {
  const text = readFileSync(join(repo, SUITE.path));
  const sha = createHash("sha256").update(text).digest("hex");
  if (sha !== SUITE.sha256) throw new Error("E_USAGE codex-hooks c: " + SUITE.path + " has sha256 " + sha + ", not the frozen " + SUITE.sha256);
  const ids = (JSON.parse(text.toString("utf8")).units as { id: string }[]).map((u) => u.id);
  if (ids.length !== SUITE.units) throw new Error("E_USAGE codex-hooks c: the suite holds " + ids.length + " units, not " + SUITE.units);
  return ids;
}

/** The units in the frozen seeded order. */
export const seededUnits = (ids: readonly string[]): string[] => seeded([{ tasks: [...ids], arms: [], attempts: 1 }], SEED)[0]!.tasks;

/** An item's units, in seeded order: the pilot's first six, or all of them. */
export const itemUnits = (item: ItemName, ids: readonly string[]): string[] => (ITEMS[item].phase === "pilot" ? seededUnits(ids).slice(0, PILOT_UNITS) : seededUnits(ids));

export { MODEL };
