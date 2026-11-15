// Copyright (c) 2026 Garry Tan. MIT License.
// The office-hours founder eval's authoring runs (prereg section 3, "Sets and timing", start rules 8, 10 and 12, and
// section 15): the constructed pass from its pilot to the quotas, and the custody writes for both strata.
// authorConstructed runs the 4-unit pilot, projects supply from its measured spend (E_OF_SUPPLY_SHORT stops authoring
// there), then authors draw positions in order, a batch at a time, refilling the sets from every passing unit whose
// earlier positions have all settled, until the quotas fill, the spend reaches the cap or the schedule runs out.
// Calibration units get second skins in draw order as they are placed, until 8 pass: a skin that fails leaves its pair
// out of the twin check and passes its place to the next calibration unit (the Captain's pre-data ruling, 2026-11-12).
// The CEILING variant (section 10) redraws only the calibration and comparison sets, from new units under the harder
// prompt, with no pilot or reserve; its new calibration units get second skins the same way, because stage 1 reruns on
// them with its twin check. topUpTwins applies the same rule to a finished run, rebuilt from its sealed outcome log.
// The write functions put every file under an open custody sink and return counts and digests only, safe to print.
import { join } from "node:path";
import { QUOTA } from "../frozen.ts";
import type { UnitMeta } from "../types.ts";
import type { Deps } from "./checks.ts";
import { runConstructed, runTwin, type Outcome } from "./constructed.ts";
import { pilot, schedule, type Draw } from "./draws.ts";
import { AuthorError, keyJson, writeSealed, writeUnit } from "./files.ts";
import type { RealRun } from "./real.ts";
import { comparisonRecord, fillSets, projectSupply, setsFull, type Member, type Projection, type Quota, type Sets } from "./sets.ts";

/** More draw positions than any run can author: 20 rounds of the six shapes. */
export const MAX_DRAWS = 480;

export interface ConstructedRun {
  ceiling: boolean;
  projection: Projection | null;
  outcomes: Outcome[];
  twins: Outcome[];
  sets: Sets;
  /** pilot: --pilot asked for the pilot alone; supply: the pilot's projection did not fit (E_OF_SUPPLY_SHORT). */
  stopped: "quotas" | "cap" | "schedule" | "pilot" | "supply";
}

/** The passing units whose earlier draw positions have all settled, in draw order: the units the sets may take. */
function membersOf(draws: readonly Draw[], done: ReadonlyMap<number, Outcome>): Member[] {
  const out: Member[] = [];
  for (const d of draws) {
    const r = done.get(d.draw);
    if (!r) break;
    if (r.meta) out.push({ id: r.id, draw: d.draw, type: r.meta.type, shape: d.shape, author: d.author, digest: r.meta.digest });
  }
  return out;
}

/** Second skins for the calibration units in draw order until want pass or every placed unit has one; each batch is the shortfall, so no skin goes past the 8th pass. */
async function skinTwins(calibration: readonly Member[], first: (m: Member) => Outcome, twins: Map<string, Outcome>, deps: Deps, want: number): Promise<void> {
  for (;;) {
    const passed = [...twins.values()].filter((t) => t.status === "pass").length;
    const owed = calibration.filter((m) => !twins.has(m.id)).slice(0, Math.max(0, want - passed));
    if (!owed.length) return;
    (await Promise.all(owed.map((m) => runTwin(first(m), deps)))).forEach((t, k) => twins.set(owed[k]!.id, t));
  }
}

/** The constructed pass. spent reads the authoring lease's metered spend so far, in the cap's unit. */
export async function authorConstructed(deps: Deps & { spent: () => number }, o: { cap: number; concurrency: number; mdd: (comparisonUnits: number) => number | null; ceiling: boolean; pilotOnly?: boolean }): Promise<ConstructedRun> {
  const quota: Quota = o.ceiling ? { ...QUOTA, reserve: 0 } : QUOTA;
  const draws = schedule(MAX_DRAWS);
  const done = new Map<number, Outcome>();
  const twins = new Map<string, Outcome>();
  const runBatch = async (ds: readonly Draw[]) => (await Promise.all(ds.map((d) => runConstructed(d, deps, { ceiling: o.ceiling })))).forEach((out, k) => done.set(ds[k]!.draw, out));
  let projection: Projection | null = null;
  const finish = (sets: Sets, stopped: ConstructedRun["stopped"]): ConstructedRun => ({ ceiling: o.ceiling, projection, outcomes: [...done.entries()].sort(([a], [b]) => a - b).map(([, x]) => x), twins: [...twins.values()], sets, stopped });
  if (!o.ceiling) {
    const p = pilot(draws);
    await runBatch(p);
    try {
      projection = projectSupply({ spent: deps.spent(), passing: p.filter((d) => done.get(d.draw)!.status === "pass").length, cap: o.cap, mdd: o.mdd });
    } catch (e) {
      if (!(e instanceof AuthorError && e.code === "E_OF_SUPPLY_SHORT")) throw e;
      projection = (e as AuthorError & { projection: Projection }).projection;
      return finish(fillSets([], quota), "supply");
    }
    if (o.pilotOnly) return finish(fillSets([], quota), "pilot");
  }
  for (let next = 0; ; ) {
    const sets = fillSets(membersOf(draws, done), quota);
    await skinTwins(sets.calibration, (m) => done.get(m.draw)!, twins, deps, quota.twins);
    if (setsFull(sets, quota)) return finish(sets, "quotas");
    if (deps.spent() >= o.cap) return finish(sets, "cap");
    const batch: Draw[] = [];
    for (; batch.length < o.concurrency && next < draws.length; next++) if (!done.has(draws[next]!.draw)) batch.push(draws[next]!);
    if (!batch.length) return finish(sets, "schedule");
    await runBatch(batch);
  }
}

/**
 * --twins: a finished constructed run rebuilt from its sealed outcome log, with second skins given under the same rule and
 * no other call. The rebuilt sets must be full and give the logged comparison digest, and the logged skins must be the
 * first of the rebuilt calibration set, or it refuses before any call.
 */
export async function topUpTwins(log: readonly Outcome[], deps: Deps, o: { ceiling: boolean; projection: Projection | null; digest: string }): Promise<ConstructedRun> {
  const quota: Quota = o.ceiling ? { ...QUOTA, reserve: 0 } : QUOTA;
  const firsts = log.filter((x) => !x.id.endsWith("t"));
  const done = new Map(firsts.map((x) => [Number(x.id.slice(1)), x]));
  const twins = new Map(log.filter((x) => x.id.endsWith("t")).map((t) => [t.id.slice(0, -1), t]));
  const sets = fillSets(membersOf(schedule(MAX_DRAWS), done), quota);
  if (!setsFull(sets, quota)) throw new AuthorError("E_USAGE", "--twins needs a run that stopped at its quotas, and the outcome log rebuilds unfilled sets");
  if (comparisonRecord(sets.comparison).digest !== o.digest) throw new AuthorError("E_USAGE", "--twins: the outcome log rebuilds a comparison set whose digest is not the summary's");
  const skinned = sets.calibration.slice(0, twins.size).map((m) => m.id);
  if (skinned.length !== twins.size || !skinned.every((id) => twins.has(id))) throw new AuthorError("E_USAGE", "--twins: the logged second skins are not the first calibration units in draw order");
  await skinTwins(sets.calibration, (m) => done.get(m.draw)!, twins, deps, quota.twins);
  return { ceiling: o.ceiling, projection: o.projection, outcomes: [...done.entries()].sort(([a], [b]) => a - b).map(([, x]) => x), twins: [...twins.values()], sets, stopped: "quotas" };
}

const countBy = (xs: readonly Outcome[], key: (o: Outcome) => string) => Object.fromEntries([...new Set(xs.map(key))].sort().map((k) => [k, xs.filter((x) => key(x) === k).length]));

/** Writes the constructed sets and every outcome under custody; returns counts and digests. */
export function writeConstructed(sink: string, run: ConstructedRun) {
  const byId = new Map(run.outcomes.map((x) => [x.id, x]));
  const write = (x: Outcome, set: UnitMeta["set"]) => writeUnit(sink, x.files!, { ...x.meta!, set }, x.record);
  for (const set of ["calibration", "comparison", "reserve"] as const) for (const m of run.sets[set]) write(byId.get(m.id)!, set);
  for (const t of run.twins) if (t.status === "pass") write(t, "twin");
  const dir = run.ceiling ? "ceiling" : "constructed";
  writeSealed(sink, join(dir, "outcomes.jsonl"), [...run.outcomes, ...run.twins].map((x) => JSON.stringify(x)).join("\n") + "\n");
  const dropped = run.outcomes.filter((x) => x.status === "drop");
  const summary = {
    stopped: run.stopped,
    projection: run.projection,
    drawn: run.outcomes.length,
    passed: run.outcomes.length - dropped.length,
    rewritten: run.outcomes.filter((x) => x.rewrites).length,
    drops: countBy(dropped, (x) => x.step!),
    not_unanimous: dropped.filter((x) => x.reason === "not unanimous").length,
    given_away: dropped.filter((x) => x.reason === "given away").length,
    sets: { calibration: run.sets.calibration.length, comparison: run.sets.comparison.length, reserve: run.sets.reserve.length },
    twins: { passed: run.twins.filter((t) => t.status === "pass").length, out_of_twin_check: run.twins.filter((t) => t.status === "drop").map((t) => t.id.slice(0, -1)) },
    comparison: comparisonRecord(run.sets.comparison),
  };
  writeSealed(sink, join(dir, "summary.json"), keyJson(summary));
  return summary;
}

/** Writes the real stratum under custody: units, notes, Names lines, pages and their records, the frame and the gate log. */
export function writeReal(sink: string, run: RealRun) {
  writeSealed(sink, "real/frame.json", keyJson(run.results));
  writeSealed(sink, "real/gates.jsonl", run.gates.map((g) => JSON.stringify(g)).join("\n") + "\n");
  for (const s of run.sources) {
    s.pages.forEach((p, k) => writeSealed(sink, join("real", s.id, "pages", k + 1 + ".html"), p.html));
    writeSealed(sink, join("real", s.id, "pages.json"), keyJson(s.pages.map(({ html, text, ...rest }) => rest)));
  }
  for (const x of run.outcomes) {
    if (x.notes) {
      writeSealed(sink, join("real", x.id, "note-a.md"), x.notes.a + "\n");
      writeSealed(sink, join("real", x.id, "note-b.md"), x.notes.b + "\n");
      writeSealed(sink, join("real", x.id, "names.txt"), x.notes.names.join("\n") + "\n");
    }
    if (x.status !== "pass") continue;
    writeUnit(sink, x.files!, { ...x.meta!, set: "real" }, { ...x.record, cutoffs: run.cutoffs[x.id] });
    writeSealed(sink, join("units", x.id, "names.txt"), x.notes!.names.join("\n") + "\n");
  }
  writeSealed(sink, "real/outcomes.jsonl", run.outcomes.map(({ notes, ...rest }) => JSON.stringify(rest)).join("\n") + "\n");
  const dropped = run.outcomes.filter((x) => x.status === "drop");
  const summary = {
    queries: run.results.length,
    results: run.results.reduce((s, r) => s + r.urls.length, 0),
    sources: run.sources.length,
    gate: { fetched: run.gates.filter((g) => g.fetch.length).length, refused: run.gates.length - run.gates.filter((g) => g.fetch.length).length, terms_unreadable: run.gates.filter((g) => g.terms.kind === "unreadable").length },
    pages: run.sources.reduce((s, x) => s + x.pages.length, 0),
    founder_pages: run.sources.reduce((s, x) => s + x.pages.filter((p) => p.founder_account).length, 0),
    authored: run.outcomes.length,
    passed: run.outcomes.length - dropped.length,
    drops: countBy(dropped, (x) => x.step!),
    terciles: countBy(run.outcomes.filter((x) => x.status === "pass"), (x) => String(run.fame[x.id]?.tercile)),
  };
  writeSealed(sink, "real/summary.json", keyJson(summary));
  return summary;
}
