// Copyright (c) 2026 Garry Tan. MIT License.
// SR's preregistration seeds (prereg.json in the post bundle, schema sr-prereg.v1). The pins it names must be the ones
// this code runs: the gstack pin and arm commits, and the SWE-rebench-V2.1 revision.
import { existsSync, readFileSync } from "node:fs";
import { GSTACK } from "./arms.ts";
import { srFail } from "./errors.ts";
import { V21 } from "./v21.ts";

export interface SrPrereg { draw_seed: number; order_seed: number; bootstrap_seed: number }
const KEYS = ["draw_seed", "order_seed", "bootstrap_seed"] as const;
const u32 = (v: unknown) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 0xffffffff;

export function readSrPrereg(path: string): SrPrereg {
  if (!existsSync(path)) srFail("E_SR_INPUT", path + " does not exist; the seeds are frozen in the post bundle's prereg.json");
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    return srFail("E_SR_INPUT", path + " is not JSON: " + (e as Error).message);
  }
  if (j.schema !== "sr-prereg.v1") srFail("E_SR_INPUT", path + " is not an sr-prereg.v1 file");
  for (const k of KEYS) if (!u32(j[k])) srFail("E_SR_INPUT", path + " has no unsigned 32-bit integer " + k);
  const pins = (j.pins ?? {}) as { gstack?: Record<string, unknown>; swe_rebench_v21?: { revision?: unknown } };
  for (const k of ["pin", "G+", "G0"] as const) if (pins.gstack?.[k] !== undefined && pins.gstack[k] !== GSTACK[k]) srFail("E_SR_INPUT", path + " pins gstack " + k + " " + String(pins.gstack[k]) + ", not " + GSTACK[k]);
  if (pins.swe_rebench_v21?.revision !== undefined && pins.swe_rebench_v21.revision !== V21.revision) srFail("E_SR_INPUT", path + " pins SWE-rebench-V2.1 " + String(pins.swe_rebench_v21.revision) + ", not " + V21.revision);
  return { draw_seed: j.draw_seed as number, order_seed: j.order_seed as number, bootstrap_seed: j.bootstrap_seed as number };
}
