// Copyright (c) 2026 Garry Tan. MIT License.
// gstack-evals h2h rerun (plan section 12): runs any arm on any unit list under a spend cap. --dry-run prints the projected
// cost at items.ts's planning prices (a no-skills O session, the arm's multiplier, B at 1.5 times O) and runs nothing. The
// real path drives part S's session runner through RerunRunner, one session per unit in the file's order, and stops
// before any session whose allowance would take the spend past the cap. Exits: 0 done, 2 usage, 3 a refused precondition,
// 10 a cap stop, 12 a containment halt (cli.ts EXIT).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { B_FACTOR, MULTIPLIER, NO_SKILLS_O_USD } from "./items.ts";
import { h2hFail, readPrereg } from "./prereg.ts";
import { ALL_ARMS, type H2hArm, type H2hScore, type H2hSession, type H2hUnit, type UnitClass } from "./types.ts";

export interface RerunSession { arm: H2hArm; unit: H2hUnit; allowance_usd: number; out: string }
export type RerunOutcome =
  | { kind: "session"; session: H2hSession; score?: H2hScore | null }
  | { kind: "cap_stop"; detail: string }
  | { kind: "containment"; detail: string }
  | { kind: "refused"; detail: string };
/** What rerun calls on part S's session runner. preflight checks everything the real path needs before any paid call
 *  (Docker, network, the key by name, the arm's install and each unit's image) and returns why not, or null. */
export interface RerunRunner {
  preflight(arm: H2hArm, units: readonly H2hUnit[]): Promise<string | null>;
  run(s: RerunSession): Promise<RerunOutcome>;
}

const HELP = `Usage: gstack-evals h2h rerun --arm <arm> --units <file> --spend-cap <usd> [--dry-run] [--out <dir>]
Runs one arm on every unit in the file (a JSON list of units, an o-frame.json, or a draw file) under the spend cap.
--dry-run prints the projected cost at planning prices and runs nothing. Prerequisites for a real run: an Anthropic key,
Docker, network for installs and image builds, and room under Docker Hub's limit of 100 pulls an hour.
Arms: ${ALL_ARMS.join(", ")}. Exits: 0 done, 2 usage, 3 refused precondition, 10 cap stop, 12 containment halt.`;

/** A units file as units with a class and an entry: a list, an h2h-o-frame.v1 file (class O) or an h2h-draw.v1 file. */
export function readUnits(path: string): H2hUnit[] {
  let j: unknown;
  try {
    j = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    return h2hFail("E_H2H_RERUN_PRECONDITION", "--units " + path + " is not readable JSON: " + (e as Error).message);
  }
  const o = j as { schema?: string; kind?: string; units?: Record<string, unknown>[] };
  const list = (Array.isArray(j) ? j : o.units) as Record<string, unknown>[] | undefined;
  if (!Array.isArray(list) || !list.length) h2hFail("E_H2H_RERUN_PRECONDITION", "--units " + path + " holds no units");
  const fileKind = o.schema === "h2h-o-frame.v1" ? "O" : typeof o.kind === "string" ? o.kind : undefined;
  return list!.map((u) => {
    const kind = (u.kind ?? fileKind ?? u.class) as string | undefined;
    const cls = (u.class ?? (kind === "O" ? "O" : kind === "B1" || kind === "B2" ? "B" : undefined)) as UnitClass | undefined;
    const entry = (u.entry ?? (cls === "B" ? "bug" : undefined)) as string | undefined;
    if (typeof u.id !== "string" || (cls !== "O" && cls !== "B") || (entry !== "bug" && entry !== "feature")) h2hFail("E_H2H_RERUN_PRECONDITION", "--units " + path + ": unit " + JSON.stringify(u.id) + " has no id, class (O or B) or bug or feature entry");
    return { ...(u as object), id: u.id, class: cls, kind: (kind === "B1" || kind === "B2" ? kind : cls === "O" ? "O" : "B2") as H2hUnit["kind"], entry, image_digest: String(u.image_digest ?? u.digest ?? "") } as H2hUnit;
  });
}

/** The planning price of one session of an arm on a unit of a class. */
export const planningPrice = (arm: H2hArm, cls: UnitClass): number => NO_SKILLS_O_USD * MULTIPLIER[arm]! * (cls === "B" ? B_FACTOR : 1);

export async function rerun(argv: string[], runner: RerunRunner | null): Promise<number> {
  const { parseFlags } = await import("./cli.ts");
  const f = parseFlags(argv, ["--arm", "--units", "--spend-cap", "--out"], ["--dry-run"], HELP);
  if (!f) return 0;
  const arm = f.need("--arm") as H2hArm;
  if (!ALL_ARMS.includes(arm)) h2hFail("E_USAGE", "--arm " + JSON.stringify(arm) + " is not an arm; the arms are " + ALL_ARMS.join(", "));
  const cap = Number(f.need("--spend-cap"));
  if (!Number.isFinite(cap) || cap <= 0) h2hFail("E_USAGE", "--spend-cap must be a positive number of dollars");
  const p = readPrereg();
  const unitsPath = f.need("--units");
  if (!existsSync(unitsPath)) h2hFail("E_H2H_RERUN_PRECONDITION", "--units " + unitsPath + " does not exist");
  const units = readUnits(unitsPath);
  const noEntry = units.filter((u) => !p.entries[arm]?.[u.entry]);
  if (noEntry.length) h2hFail("E_H2H_RERUN_PRECONDITION", "arm " + arm + " has no " + noEntry[0]!.entry + " entry in prereg.json (unit " + noEntry[0]!.id + (noEntry.length > 1 ? " and " + (noEntry.length - 1) + " more" : "") + ")");
  const by = { O: units.filter((u) => u.class === "O").length, B: units.filter((u) => u.class === "B").length };
  const projected = by.O * planningPrice(arm, "O") + by.B * planningPrice(arm, "B");
  const allowance = p.limits.allowance_usd;
  if (f.has("--dry-run")) {
    console.log("rerun dry run: arm " + arm + ", " + units.length + " units (" + by.O + " O at $" + planningPrice(arm, "O").toFixed(2) + ", " + by.B + " B at $" + planningPrice(arm, "B").toFixed(2) + " a session, planning prices)");
    console.log("projected $" + projected.toFixed(2) + " against a spend cap of $" + cap.toFixed(2) + "; at most $" + (units.length * allowance).toFixed(2) + " if every session spent its $" + allowance + " allowance");
    if (projected > cap) console.log("the projection is above the cap: a real run would stop at the cap (exit 10)");
    console.log("nothing ran");
    return 0;
  }
  if (!runner) h2hFail("E_H2H_RERUN_UNWIRED", "no session runner is wired into gstack-evals h2h rerun yet; --dry-run prints the projection");
  const why = await runner!.preflight(arm, units);
  if (why) h2hFail("E_H2H_RERUN_PRECONDITION", why);
  const out = f.one("--out") ?? "h2h-rerun";
  mkdirSync(out, { recursive: true });
  let spent = 0;
  const done: { unit: string; cost_usd: number; gap: string | null; verified: boolean | null }[] = [];
  const summary = (stop: string | null) => writeFileSync(join(out, "rerun-summary.json"), JSON.stringify({ arm, units: units.length, spent_usd: spent, spend_cap_usd: cap, stop, sessions: done }, null, 1) + "\n");
  for (const unit of units) {
    if (spent + allowance > cap) {
      summary("cap_stop");
      h2hFail("E_H2H_RERUN_CAP_STOP", "spent $" + spent.toFixed(2) + " of $" + cap.toFixed(2) + "; the next session (" + unit.id + ") could spend its $" + allowance + " allowance; " + done.length + " of " + units.length + " sessions ran");
    }
    const r = await runner!.run({ arm, unit, allowance_usd: allowance, out: join(out, unit.id) });
    if (r.kind === "cap_stop") {
      summary("cap_stop");
      h2hFail("E_H2H_RERUN_CAP_STOP", unit.id + ": " + r.detail);
    }
    if (r.kind === "containment") {
      summary("containment");
      h2hFail("E_H2H_RERUN_CONTAINMENT", unit.id + ": " + r.detail);
    }
    if (r.kind === "refused") {
      summary("refused");
      h2hFail("E_H2H_RERUN_PRECONDITION", unit.id + ": " + r.detail);
    }
    if (r.kind !== "session") continue;
    spent += r.session.cost_usd;
    done.push({ unit: unit.id, cost_usd: r.session.cost_usd, gap: r.session.gap, verified: r.score ? r.score.verified : null });
  }
  summary(null);
  console.log("rerun done: " + done.length + " sessions, $" + spent.toFixed(2) + " spent of $" + cap.toFixed(2) + "; records in " + out);
  return 0;
}
