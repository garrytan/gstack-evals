// Copyright (c) 2026 Garry Tan. MIT License.
// The pstack-checks preregistration's seeds (prereg.json in the post bundle, schema pf-prereg.v1) and the lane's
// refusal helper. Every refusal message starts with its reason code.
import { existsSync, readFileSync } from "node:fs";
import type { ReasonCode } from "../../../src/errors/codes.ts";
import { MULTILANG } from "../statemachines/source.ts";

export class PfError extends Error {
  constructor(readonly code: ReasonCode, message: string) {
    super(code + " " + message);
  }
}
export const pfFail = (code: ReasonCode, message: string): never => {
  throw new PfError(code, message);
};

export interface PfPrereg { draw_seed: number; order_seed: number; bootstrap_seed: number }
const KEYS = ["draw_seed", "order_seed", "bootstrap_seed"] as const;
const u32 = (v: unknown) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 0xffffffff;

/** Reads prereg.json. Refuses (E_PF_SEED) on a missing file, bad JSON, another schema, a seed that is not an unsigned
 *  32-bit integer, or a MultiLang pin other than the revision the state machines harness reads. */
export function readPrereg(path: string): PfPrereg {
  if (!existsSync(path)) pfFail("E_PF_SEED", path + " does not exist; the seeds are frozen in the post bundle's prereg.json");
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    return pfFail("E_PF_SEED", path + " is not JSON: " + (e as Error).message);
  }
  if (j.schema !== "pf-prereg.v1") pfFail("E_PF_SEED", path + " is not a pf-prereg.v1 file");
  for (const k of KEYS) if (!u32(j[k])) pfFail("E_PF_SEED", path + " has no unsigned 32-bit integer " + k);
  const rev = (j.pins as { swe_bench_live_multilang?: { revision?: string } } | undefined)?.swe_bench_live_multilang?.revision;
  if (rev !== undefined && rev !== MULTILANG.revision) pfFail("E_PF_SEED", path + " pins MultiLang revision " + rev + ", not " + MULTILANG.revision);
  return { draw_seed: j.draw_seed as number, order_seed: j.order_seed as number, bootstrap_seed: j.bootstrap_seed as number };
}
