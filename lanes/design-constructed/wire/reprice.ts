// Copyright (c) 2026 Garry Tan. MIT License.
// dc reprice: the step between stage 1 and stage 2 that writes PD-30's re-priced caps into the ledger. It reruns the
// projection on stage 1's measured costs (read/admission.ts projectionRerun) and, for each item whose measured need
// with its reserve passes its cap, records the re-priced cap as a raise in main's approval record, its quote the
// rerun's deviation line word for word. Start rule 7 holds it until stage 1 has passed (a tier admitted, the twins
// tracking, the Opus judge check, the smoke rules and the admission read) and until the re-priced projection is within
// $5,000. It runs before stage 2 is admitted: an item that already holds a lease or an admission refuses. A cap is never
// lowered: an item whose need fits its frozen cap keeps it, and a recorded re-pricing at or above the new need stays.
// The launch's ledger check (wire/start.ts) then admits stage 2's items against the re-priced cap and refuses any
// other recorded cap. No model is called.
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { LedgerError } from "../../../src/runner/ledger/record.ts";
import { DcError } from "../errors.ts";
import { LEDGER_ITEMS } from "../frozen.ts";
import { $, dollars } from "../money/book.ts";
import { projectionRerun, repricedLine, type ProjectionInput } from "../read/admission.ts";
import { readJson } from "./json.ts";
import { closeAll, need, repriced, REPRICE_BY, start, type Row } from "./start.ts";

/** Stage 1's passing records, as the run thread writes them from the rows that read each (start rule 7). */
export interface Stage1Passes {
  tierAdmitted: boolean;
  twinsTrack: boolean;
  judgeCheck: boolean;
  smoke: boolean;
  admissionRead: boolean;
}

const PASSES: Record<keyof Stage1Passes, string> = { tierAdmitted: "stage 1 admits a tier", twinsTrack: "the twins track", judgeCheck: "the Opus judge check passes", smoke: "the smoke rules pass after at most one repair", admissionRead: "the admission read passes" };

export const repriceRow: Row = async (a, io, env) => {
  const usage = "reprice --stage1 <stage1.json> --projection <projection input JSON> --out <new sink folder>";
  const stage1 = readJson<Partial<Stage1Passes>>(resolve(need(a, "--stage1", usage)), "--stage1");
  const input = readJson<ProjectionInput>(resolve(need(a, "--projection", usage)), "--projection");
  const sink = need(a, "--out", usage);
  const rerun = projectionRerun(input);
  const missing = (Object.keys(PASSES) as Array<keyof Stage1Passes>).filter((k) => stage1[k] !== true);
  const rule7 = (): [string, string] | null => {
    if (missing.length) return ["7", "stage 2's caps are re-priced only after stage 1 passes, and --stage1 records no pass for: " + missing.map((k) => PASSES[k]).join("; ")];
    if (rerun.outcome !== "fits") return ["7", "the re-priced all-in projection is $" + rerun.projection.allInUsd.toFixed(2) + ", past $5,000: stop for the Captain"];
    return null;
  };
  const launch = await start({ row: "reprice", sink, items: [], models: [], terms: [], rules: [rule7], record: { repriced: rerun.repriced.length } }, env);
  try {
    for (const l of [...launch.lines, ...rerun.lines]) io.out(l);
    const l = launch.ledger;
    const written: Array<{ item: string; fromMicros: number; toMicros: number }> = [];
    const kept: Array<{ item: string; capMicros: number; needMicros: number }> = [];
    for (const r of rerun.repriced) {
      const frozen = $(LEDGER_ITEMS[r.item].capUsd);
      const to = $(r.repricedCapUsd);
      const from = l.recordedCapMicros(r.item);
      const no = (why: string): never => {
        throw new DcError("E_DCW_LEDGER_REFUSED", r.item + " " + why + "; nothing was raised on it");
      };
      if (from === null) return no("has no recorded cap (start rule 1)");
      if (from !== frozen && !repriced(l, r.item, from)) no("has a recorded cap of " + dollars(from) + ", neither the frozen " + dollars(frozen) + " nor a PD-30 re-pricing; the difference goes to the Captain");
      if (l.controller.lease(r.item) || l.controller.subsOf(r.item).length) no("is admitted already; its cap is re-priced only before stage 2 is admitted");
      if (from >= to) {
        kept.push({ item: r.item, capMicros: from, needMicros: to });
        io.out("kept " + r.item + " at its recorded " + dollars(from) + ", at or above the measured need " + dollars(to) + "; a cap is never lowered");
        continue;
      }
      try {
        l.raise(r.item, to, { words: repricedLine(r.item, r.frozenCapUsd, r.repricedCapUsd), by: REPRICE_BY, source: "the reprice launch at " + launch.commit + ", its sink's repriced.json" });
      } catch (e) {
        if (e instanceof LedgerError) no("could not be raised in the approval record: " + e.message);
        throw e;
      }
      written.push({ item: r.item, fromMicros: from, toMicros: to });
      io.out("ledger: " + r.item + " cap recorded at " + dollars(to) + " from " + dollars(from) + " as a pre-data deviation (PD-30)");
    }
    writeFileSync(join(launch.sink, "repriced.json"), JSON.stringify({ stage1, input, outcome: rerun.outcome, allInUsd: rerun.projection.allInUsd, repriced: rerun.repriced, written, kept, lines: rerun.lines }, null, 2) + "\n");
    io.out("reprice: " + written.length + " caps written, " + kept.length + " kept at a recorded re-pricing; every other item keeps its frozen cap");
    return 0;
  } finally {
    await closeAll(launch.ledger);
  }
};
