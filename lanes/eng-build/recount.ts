// Copyright (c) 2026 Garry Tan. MIT License.
// The keyless recount of the eng-review build read (plan sections 3 and 12): every built unit is graded again on its
// real trees in the verifier's own sandbox (read-only root, uid 10001, no network) with 3 runs. A unit stays clean when
// its licence passes (permissive, or copyleft under custody), every functional case passes in every run on the merged
// tree (V1's gold check, on the functional group only), the product hashes of every real tree match those recorded at
// the build, and at least one aftermath case still holds the 3-run rule. It prints counts only, and refuses with
// E_EB_FEW_UNITS under FROZEN.recount.minClean so the question goes to the Captain before any spend.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { docker } from "../real-outcome/task/docker.ts";
import { LICENCES } from "../real-outcome/task/format.ts";
import { EbError } from "./errors.ts";
import { FROZEN } from "./frozen.ts";
import { aftermathCases, gradeSet, readUnit, treePatch, type EbTask, type Grid } from "./unit.ts";

export interface RecountRow {
  unit: string;
  clean: boolean;
  /** The first rule the unit failed, or null. */
  reason: string | null;
  functional: number;
  aftermath: number;
}

/** Recounts one built unit. custody says a copyleft unit is held under custody. */
export function recountUnit(dir: string, o: { work: string; runs?: number; seed?: number; custody?: boolean }): RecountRow {
  const runs = o.runs ?? FROZEN.runs;
  const { eb, task } = readUnit(dir);
  const row: RecountRow = { unit: eb.unit.id, clean: false, reason: null, functional: 0, aftermath: 0 };
  if (!LICENCES.includes(task.licence) && !o.custody) return { ...row, reason: "licence" };
  if (docker(["image", "inspect", eb.image.id]).status !== 0) return { ...row, reason: "image_missing" };
  const patch = (label: string) => readFileSync(join(dir, treePatch(label)), "utf8");
  const grade = (label: string, set: EbTask["sets"][number], want: string[]): Grid => gradeSet({ taskDir: dir, task, eb, set, label, patch: patch(label), runs, seed: o.seed ?? eb.seed + 1000, work: o.work, check: true, want });
  try {
    const functional = grade("merged", eb.sets[0], eb.unit.functional);
    row.functional = eb.unit.functional.filter((id) => functional[id]?.length === runs && functional[id].every((c) => c === "pass")).length;
    if (eb.unit.functional.length === 0 || row.functional < eb.unit.functional.length) return { ...row, reason: "v1_functional" };
    for (const a of eb.unit.aftermath) {
      if (a.cases.length === 0) continue;
      const set = eb.sets.find((s) => s.item === a.item)!;
      const merged = grade("merged", set, a.cases);
      const parentLabel = existsSync(join(dir, treePatch("parent:" + a.item))) ? "parent:" + a.item : "merged";
      const parent = parentLabel === "merged" ? merged : grade(parentLabel, set, a.cases);
      const fixed = grade("fix:" + a.item, set, a.cases);
      row.aftermath += aftermathCases(merged, parent, fixed, runs).filter((id) => a.cases.includes(id)).length;
    }
  } catch (error) {
    if (error instanceof EbError && error.code === "E_EB_PRODUCT_HASH") return { ...row, reason: "product_hash" };
    throw error;
  }
  if (row.aftermath === 0) return { ...row, reason: "no_aftermath" };
  return { ...row, clean: true };
}

/** gstack-evals eb recount --units <dir> --work <dir> [--runs 3] [--custody <unit,unit>]: counts only. */
export async function main(argv: string[]): Promise<number> {
  let v: { units?: string; work?: string; runs?: string; custody?: string };
  try {
    v = parseArgs({ args: argv, strict: true, options: { units: { type: "string" }, work: { type: "string" }, runs: { type: "string" }, custody: { type: "string" } } }).values;
  } catch (error) {
    console.error("E_USAGE " + (error as Error).message);
    return 2;
  }
  if (!v.units || !v.work) {
    console.error("E_USAGE eb recount needs --units <dir of unit dirs> and --work <scratch dir>");
    return 2;
  }
  const custody = new Set((v.custody ?? "").split(",").filter(Boolean));
  const dirs = readdirSync(v.units).filter((d) => existsSync(join(v.units!, d, "eb.json"))).sort();
  const rows = dirs.map((d) => recountUnit(join(v.units!, d), { work: v.work!, runs: v.runs ? Number(v.runs) : undefined, custody: custody.has(d) }));
  const clean = rows.filter((r) => r.clean).length;
  const reasons = new Map<string, number>();
  for (const r of rows) if (r.reason) reasons.set(r.reason, (reasons.get(r.reason) ?? 0) + 1);
  console.log("recount: " + rows.length + " units read, " + clean + " clean, threshold " + FROZEN.recount.minClean);
  for (const [reason, n] of [...reasons].sort()) console.log("  not clean, " + reason + ": " + n);
  if (clean < FROZEN.recount.minClean) {
    console.error("E_EB_FEW_UNITS " + clean + " clean build-read units against " + FROZEN.recount.minClean + "; no lease opened. Take the clean count to the Captain.");
    return 2;
  }
  return 0;
}
