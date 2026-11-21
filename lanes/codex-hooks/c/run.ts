// Copyright (c) 2026 Garry Tan. MIT License.
// Part C's run controller: one phase's steps (plan.ts) as review-units runs, the one rerun, and the final collect pass.
//
// - Before each step the guard reads the item's ledger and refuses a done item, an open lease or a projection past what is
//   left; a refusal stops that item and the phase goes on with the others. The all-in stop (../allin.ts) reads every item of
//   both parts, the judge item and the crew file first, and a refusal stops the item the same way. Each step is review-units --resume over the
//   item's --out with one unit, so a relaunch after a crash runs only the cells cells.ndjson lacks. A step whose cells are
//   all in cells.ndjson is skipped.
// - A step that exits with a CAP_STOP stops its item for good (<root>/<item>/CAP_STOP); its part reads INCOMPLETE and it
//   never reruns. Any other failed step stops the phase, so a broken rig never runs on.
// - When every step of an item has run, a collect pass runs review-units --resume once over all of the item's units, which
//   writes the arm files over every cell and starts no session that cells.ndjson holds.
// - rerun moves each session whose outcome owes its one rerun (an infra failure on attempt 1) aside: its line goes from
//   cells.ndjson to cells-attempt1.ndjson and its session dir to <dir>-attempt1, so the next run of the phase runs it again
//   as attempt 2. A second infra failure is a gap.
import { existsSync, readFileSync, renameSync, writeFileSync, appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { REPO } from "../pins.ts";
import { sessionDir } from "../../../src/trial/review/run.ts";
import { unitTaskId } from "../../../src/trial/review/unit.ts";
import { codexArmsText, ITEM_NAMES, ITEMS, MODEL, PASSES, type ItemName } from "./pins.ts";
import { allIn, readCrew } from "../allin.ts";
import { readLedgers, rSpends } from "../r/money.ts";
import { cSpends, guard, itemOut, reviewArgv, schedule } from "./plan.ts";
import { readItem, type UnitRef } from "./readout.ts";
import { blindKey } from "./states.ts";

export type Exec = (argv: string[]) => Promise<{ code: number; stderr: string }>;

/** Runs bin/gstack-evals with argv, its output shown as it comes, and keeps its stderr. */
export const execGstackEvals: Exec = async (argv) => {
  const child = Bun.spawn(["bun", join(REPO, "bin", "gstack-evals"), ...argv], { cwd: REPO, stdout: "inherit", stderr: "pipe" });
  let stderr = "";
  const dec = new TextDecoder();
  for await (const chunk of child.stderr) {
    const s = dec.decode(chunk);
    stderr += s;
    process.stderr.write(s);
  }
  return { code: await child.exited, stderr };
};

const cellKeys = (out: string): Set<string> => {
  const f = join(out, "cells.ndjson");
  if (!existsSync(f)) return new Set();
  return new Set(readFileSync(f, "utf8").split("\n").filter((l) => l.trim()).map((l) => {
    const c = JSON.parse(l).cell;
    return [c.model, c.arm, c.unit, c.pass].join("\t");
  }));
};
const unitCells = (item: ItemName, unit: string) => ITEMS[item].arms.flatMap((arm) => Array.from({ length: PASSES[ITEMS[item].phase] }, (_, i) => [MODEL, arm, unit, i + 1].join("\t")));

export interface RunOptions {
  root: string;
  phase: "pilot" | "main";
  record: string;
  ledger: string;
  /** Part R's item ledgers (<item>.jsonl) and the crew file, for the all-in stop. */
  rLedgers: string;
  crew: string;
  sources: Readonly<Record<string, string>>;
  upstream?: string | null;
  ids: readonly string[];
  exec: Exec;
  log: (line: string) => void;
}

/** Runs a phase's steps and each finished item's collect pass; returns the items that stopped and why. */
export async function runPhase(o: RunOptions): Promise<{ ok: boolean; stopped: Record<string, string> }> {
  const items = ITEM_NAMES.filter((i) => ITEMS[i].phase === o.phase);
  const stopped: Record<string, string> = {};
  for (const item of items) {
    const out = itemOut(o.root, item);
    mkdirSync(out, { recursive: true });
    const file = join(out, "codex-arms.json");
    const text = codexArmsText(ITEMS[item].arms);
    if (existsSync(file) && readFileSync(file, "utf8") !== text) throw new Error("E_USAGE codex-hooks c run: " + file + " differs from the frozen arms; restore it or start a new root");
    if (!existsSync(file)) writeFileSync(file, text);
    if (existsSync(join(out, "CAP_STOP"))) stopped[item] = "a cap stop ended it before this run";
  }
  const steps = schedule(o.phase, o.ids);
  const args = (item: ItemName, units: string[], cap: number) => reviewArgv({ item, units, out: itemOut(o.root, item), codexArms: join(itemOut(o.root, item), "codex-arms.json"), ledger: o.ledger, record: o.record, spendCapUsd: cap, sources: o.sources, upstream: o.upstream ?? null });
  const step = async (item: ItemName, units: string[]): Promise<boolean> => {
    const have = cellKeys(itemOut(o.root, item));
    const planned = ITEMS[item].sessions;
    const a = allIn([...cSpends(o.record), ...rSpends(readLedgers(o.rLedgers))], readCrew(o.crew));
    o.log(a.ok ? a.lines[0]! : a.lines.join("\n"));
    if (!a.ok) {
      stopped[item] = "E_CH_ALL_IN " + a.why.join("; ") + "; take it to the Captain";
      return true;
    }
    const g = guard(o.record, item, Math.max(0, planned - have.size));
    o.log(g.line);
    if (!g.ok) {
      stopped[item] = g.why.join("; ");
      return true;
    }
    const r = await o.exec(args(item, units, g.spend_cap_usd));
    if (r.code === 0) return true;
    if (/\bCAP_STOP\b/.test(r.stderr)) {
      writeFileSync(join(itemOut(o.root, item), "CAP_STOP"), new Date().toISOString() + " review-units stopped " + item + " at its cap on " + units.join(" ") + "\n");
      stopped[item] = "CAP_STOP on " + units.join(" ");
      return true;
    }
    o.log("E_USAGE codex-hooks c run: review-units exited " + r.code + " on " + item + " " + units.join(" ") + "; the phase stops so a broken rig does not run on");
    return false;
  };
  for (const s of steps) {
    if (stopped[s.item]) continue;
    const have = cellKeys(itemOut(o.root, s.item));
    if (unitCells(s.item, s.unit).every((k) => have.has(k))) continue;
    if (!(await step(s.item, [s.unit]))) return { ok: false, stopped };
  }
  for (const item of items) {
    if (stopped[item]) continue;
    if (!(await step(item, [...new Set(steps.filter((s) => s.item === item).map((s) => s.unit))]))) return { ok: false, stopped };
  }
  return { ok: true, stopped };
}

/** Moves each session that owes its one rerun aside, so the next run of its phase runs it again; returns the cells moved. */
export function moveForRerun(root: string, item: ItemName, units: readonly UnitRef[]): string[] {
  const out = itemOut(root, item);
  const { sessions } = readItem(root, item, units, blindKey(join(out, "readout")));
  const owed = sessions.filter((s) => !s.moved && s.attempt === 1 && s.outcome.rerun);
  if (!owed.length) return [];
  const key = (c: { model: string; arm: string; unit: string; pass: number }) => [c.model, c.arm, c.unit, c.pass].join("\t");
  const owedKeys = new Set(owed.map((s) => key(s.cell)));
  const file = join(out, "cells.ndjson");
  const lines = readFileSync(file, "utf8").split("\n").filter((l) => l.trim());
  const moved = lines.filter((l) => owedKeys.has(key(JSON.parse(l).cell)));
  appendFileSync(join(out, "cells-attempt1.ndjson"), moved.map((l) => l + "\n").join(""));
  writeFileSync(file + ".tmp", lines.filter((l) => !owedKeys.has(key(JSON.parse(l).cell))).map((l) => l + "\n").join(""));
  renameSync(file + ".tmp", file);
  const byId = new Map(units.map((u) => [u.id, u]));
  for (const s of owed) renameSync(sessionDir(out, s.cell.model, s.cell.arm, unitTaskId(byId.get(s.cell.unit)!), s.cell.pass), s.dir + "-attempt1");
  return owed.map((s) => key(s.cell).replaceAll("\t", " "));
}
