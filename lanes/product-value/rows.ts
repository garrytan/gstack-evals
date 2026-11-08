// Copyright (c) 2026 Garry Tan. MIT License.
// gstack-evals pv rows: one Row per planned session of review-units --plan product-value runs (prereg
// 2026-11-08-geva-403, sections 5 and 6). A session with no journal entry (a cap stop) is missing, never 0. Rows hold
// the review lists, so the output file must sit outside the repo.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { insideRepo } from "../review-noloss/suite.ts";
import { readReviewJournal, reviewCellId, sessionDir } from "../../src/trial/review/run.ts";
import { PV_INPUT, PV_LENS, PV_MODELS, pvArm, pvArmId } from "../../src/trial/review/product-value.ts";
import { sessionExposure } from "./exposure.ts";
import { normalizeChanges } from "./parse.ts";
import type { Family, Row } from "./types.ts";

export interface PvUnits {
  family: Family;
  fallback: boolean;
  passes: number;
  arms: { name: string; told: string; models: string[] }[];
  units: { id: string; task: string; tree_sha256: string }[];
}

/** A run's units.json pv section, or the reason it can't be read. */
export function readPvUnits(run: string): PvUnits | string {
  const file = join(run, "units.json");
  if (!existsSync(file)) return "no units.json in " + run;
  try {
    const u = JSON.parse(readFileSync(file, "utf8"));
    if (u.lens !== PV_LENS || !u.pv) return run + "/units.json is not a product-value run (lens " + JSON.stringify(u.lens) + ")";
    return u.pv as PvUnits;
  } catch (e) {
    return run + "/units.json: " + String(e);
  }
}

/** The rows of one run, in plan order: arms, then each arm's models, units and passes. Exposure is read only for a
 * skill session that ended block or no-block; a missing or contaminated session's exposure is null. */
export function runRows(run: string, pv: PvUnits): Row[] {
  const journal = readReviewJournal(run);
  const rows: Row[] = [];
  for (const arm of pv.arms) {
    const spec = pvArm(pv.family, arm.name)!;
    for (const model of arm.models) {
      for (const unit of pv.units) {
        const brief = pv.family === "brief" ? readFileSync(join(run, "units", unit.task, "tree", PV_INPUT.brief), "utf8") : null;
        for (let pass = 1; pass <= pv.passes; pass++) {
          const dir = sessionDir(run, model, arm.name, unit.task, pass);
          const e = journal.get(reviewCellId({ model, arm: arm.name, unit: unit.id, pass }));
          const end = e?.pv?.end_state ?? "missing";
          const block = end === "block" && e?.parse.kind === "changes" ? normalizeChanges(e.parse.changes) : null;
          const read = spec.skill && (end === "block" || end === "no-block") ? sessionExposure(dir, spec.skill as "plan-ceo-review" | "office-hours", brief) : null;
          const ceo = read?.detector === "plan-ceo-review" ? read : null;
          rows.push({
            unit: unit.id,
            family: pv.family,
            arm: pvArmId(arm.name),
            model: PV_MODELS[model]!,
            pass,
            end,
            list: block?.list ?? null,
            words: block?.words ?? 0,
            items: block?.items ?? 0,
            cut: block?.cut ?? 0,
            exposed: read ? read.exposed : null,
            ...(spec.skill === "plan-ceo-review" ? { mode: ceo?.mode ?? null, proposals: ceo?.proposals.length ?? 0, pending: ceo?.pending ?? 0 } : {}),
            spend_micros: e?.pv ? Math.round(e.pv.usd * 1_000_000) : null,
            session: dir,
          });
        }
      }
    }
  }
  return rows;
}

const HELP = "gstack-evals pv rows --run <review-units out dir> [--run <dir> ...] --out <rows.jsonl>\n  Writes one row per planned session of product-value review runs (one family, one fallback setting): end state, normalized list, exposure, mode, proposals, pending count and spend.";

export function run(argv: string[], io: { out: (t: string) => void; err: (t: string) => void }): number {
  if (argv.includes("--help") || argv.includes("-h")) {
    io.out(HELP);
    return 0;
  }
  const runs: string[] = [];
  let out: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const v = argv[i + 1];
    if ((a === "--run" || a === "--out") && v !== undefined && !v.startsWith("--")) {
      if (a === "--run") runs.push(resolve(v));
      else out = resolve(v);
      i++;
      continue;
    }
    io.err("E_USAGE: " + (a === "--run" || a === "--out" ? a + " needs a value" : "unknown argument " + a) + "\n  fix: " + HELP);
    return 2;
  }
  if (!runs.length || !out) {
    io.err("E_USAGE: pv rows needs at least one --run and an --out\n  fix: " + HELP);
    return 2;
  }
  if (insideRepo(out)) {
    io.err("E_USAGE: rows hold review lists, and " + out + " is inside the repo\n  fix: write --out outside the repo");
    return 2;
  }
  const all: Row[] = [];
  const seen = new Map<string, string>();
  let first: PvUnits | null = null;
  for (const r of runs) {
    const pv = readPvUnits(r);
    if (typeof pv === "string") {
      io.err("E_USAGE: " + pv + "\n  fix: pass the --out dir of a review-units --plan product-value run");
      return 2;
    }
    first ??= pv;
    if (pv.family !== first.family || pv.fallback !== first.fallback) {
      io.err("E_USAGE: " + r + " runs the " + pv.family + " family with the fallback " + (pv.fallback ? "on" : "off") + ", and the first run the " + first.family + " family with it " + (first.fallback ? "on" : "off") + "\n  fix: write rows for one family and one fallback setting at a time");
      return 2;
    }
    for (const row of runRows(r, pv)) {
      const id = JSON.stringify([row.unit, row.arm, row.model, row.pass]);
      if (seen.has(id)) {
        io.err("E_USAGE: unit " + row.unit + ", arm " + row.arm + ", model " + row.model + ", pass " + row.pass + " is planned in both " + seen.get(id) + " and " + r + "\n  fix: pass each planned session's run once");
        return 2;
      }
      seen.set(id, r);
      all.push(row);
    }
  }
  writeFileSync(out, all.map((row) => JSON.stringify(row)).join("\n") + (all.length ? "\n" : ""));
  const count = (end: string) => all.filter((r) => r.end === end).length;
  io.out(all.length + " rows to " + out + ": " + ["block", "no-block", "missing", "contaminated"].map((e) => e + " " + count(e)).join(", "));
  return 0;
}
