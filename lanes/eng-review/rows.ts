// Copyright (c) 2026 Garry Tan. MIT License.
// gstack-evals er rows: one Row (types.ts) per planned session of review-units --plan eng-review runs (prereg
// 2026-11-08-geva-405, sections 5 and 6). The rules, with the build-time choices this file makes:
//
// - The plan is each run's units.json order. A session with a journal line takes its end state from it; its lists are
//   the last attempt's parse, normalized with parse.ts, and only a block has lists. A planned session with no journal
//   line (a cap stop, or never started) is missing, never 0, with the spend stops.json carries or null.
// - Exposure and the load check come from exposure.ts's detector on the last attempt's files, only for a skill session
//   that ended block or no-block; every other row has null.
// - session is the last attempt's directory, or the cell id when no attempt settled.
// - Refused: a run whose units.json is not an eng-review run, a session planned twice across the runs, and an --out
//   inside the repo (rows hold review text).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { erCellId, ER_LENS, ER_MODELS, type ErCell } from "../../src/trial/review/eng-review.ts";
import { entryExposure, readErJournal, readErStops } from "../../src/trial/review/er-run.ts";
import { insideRepo } from "../review-noloss/suite.ts";
import { normalizeEngPlan } from "./parse.ts";
import type { ArmId, Row } from "./types.ts";

interface ErUnitsJson {
  lens: string;
  er: { enforce: string | null };
  order: string[];
}

export function readErUnits(run: string): ErUnitsJson | string {
  const file = join(run, "units.json");
  if (!existsSync(file)) return "no units.json in " + run;
  try {
    const u = JSON.parse(readFileSync(file, "utf8"));
    if (u.lens !== ER_LENS || !Array.isArray(u.order)) return run + "/units.json is not an eng-review run (lens " + JSON.stringify(u.lens) + ")";
    return u as ErUnitsJson;
  } catch (e) {
    return run + "/units.json: " + String(e);
  }
}

const cellOf = (id: string): ErCell => {
  const [model, arm, unit, pass] = JSON.parse(id) as [string, ArmId, string, number];
  return { model, arm, unit, pass };
};

/** One run's rows, in its planned order. */
export function runRows(run: string, u: ErUnitsJson): Row[] {
  const journal = readErJournal(run);
  const stops = new Map(readErStops(run).map((s) => [erCellId(s.cell), s]));
  return u.order.map((id): Row => {
    const cell = cellOf(id);
    const e = journal.get(id);
    const base = { unit: cell.unit, arm: cell.arm, model: ER_MODELS[cell.model] ?? (cell.model as Row["model"]), pass: cell.pass };
    if (!e) return { ...base, end: "missing", arm_stop: false, paths: null, checks: null, words: 0, items: 0, cut: 0, check_words: 0, exposed: null, loaded: null, enforced: u.er.enforce === cell.arm, blocks: 0, spend_micros: stops.has(id) ? Math.round(stops.get(id)!.usd * 1e6) : null, session: id };
    const n = e.end_state === "block" && e.parse.kind === "block" ? normalizeEngPlan(e.parse.paths, e.parse.checks) : null;
    const x = entryExposure(e);
    return { ...base, end: e.end_state, arm_stop: e.arm_stop, paths: n?.paths ?? null, checks: n?.checks ?? null, words: n?.words ?? 0, items: n?.items ?? 0, cut: n?.cut ?? 0, check_words: n?.check_words ?? 0, exposed: x?.exposed ?? null, loaded: x?.loaded ?? null, enforced: e.enforced, blocks: e.blocks, spend_micros: Math.round(e.usd * 1e6), session: e.attempts.at(-1)?.dir ?? id };
  });
}

const HELP = "gstack-evals er rows --run <dir> [--run <dir> ...] --out <rows.jsonl>\n  Writes one row per planned session of review-units --plan eng-review runs. The out file must sit outside the repo.";

export function run(argv: string[], io: { out: (t: string) => void; err: (t: string) => void }): number {
  const runs: string[] = [];
  let out: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--run" && argv[i + 1]) runs.push(resolve(argv[++i]!));
    else if (argv[i] === "--out" && argv[i + 1] && out === null) out = resolve(argv[++i]!);
    else {
      io.out(HELP);
      return argv[i] === "--help" || argv[i] === "-h" ? 0 : 2;
    }
  }
  if (!runs.length || out === null) {
    io.out(HELP);
    return 2;
  }
  if (insideRepo(out)) {
    io.err("E_USAGE er rows: --out " + out + " is inside the repo, and rows hold review text\nE_USAGE fix: write the rows outside the repo");
    return 2;
  }
  const rows: Row[] = [];
  const seen = new Map<string, string>();
  for (const dir of runs) {
    const u = readErUnits(dir);
    if (typeof u === "string") {
      io.err("E_USAGE er rows: " + u + "\nE_USAGE fix: pass review-units --plan eng-review out dirs");
      return 2;
    }
    for (const id of u.order) {
      if (seen.has(id)) {
        io.err("E_USAGE er rows: session " + id + " is planned in both " + seen.get(id) + " and " + dir + "\nE_USAGE fix: pass each planned session's run once");
        return 2;
      }
      seen.set(id, dir);
    }
    rows.push(...runRows(dir, u));
  }
  writeFileSync(out, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""));
  io.out("er rows: " + rows.length + " rows from " + runs.length + " run" + (runs.length === 1 ? "" : "s") + " to " + out);
  return 0;
}
