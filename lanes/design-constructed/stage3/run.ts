// Copyright (c) 2026 Garry Tan. MIT License.
// Stage 3's controller (2026-11-14 prereg section 11; 2026-11-09 section 11; plan section 13). For each qualifying unit it
// runs the six build arms, 2 at a time, each round of 2 admitted on dc-stage3-builds with room for both at full allowance
// twice over ($60), the one retry inside the round's reservation; checks each tree in its own offline VM; runs DES-4; and
// prints the readout. Every VM is audited and a hit stops stage 3 (E_DC_SANDBOX_AUDIT).
import { LEDGER_ITEMS, STAGE3 } from "../frozen.ts";
import type { Arm } from "../types.ts";
import { armBlock, BUILD_ARMS, buildPrompt, checkBuild, runBuild, type BuildArm, type BuildDeps } from "./build.ts";
import { fail } from "../errors.ts";
import { buildValues, des4, des4Value, missingScenarios, instrument, keepFlags, readout, RENDER_READS, uninformative, winRates, type BuildRecord, type Paired, type PairRow, type Values } from "./measures.ts";
import { sandboxLine, type SandboxTally } from "./sandbox.ts";
import { CapStopSignal, type MoneySeam, type PairwiseJudge } from "./seams.ts";
import type { Stage3Selection } from "./units.ts";

export interface Stage3Deps {
  builds: BuildDeps;
  money: MoneySeam;
  /** The review arm's Opus block for the unit, from stage 2 pass 1 or pass 2, rendered; null when neither has one. */
  opusBlock: (unit: string, arm: Arm) => string | null;
  judge: PairwiseJudge;
  /** Every stage 3 unit's base app; the readout clusters on it. */
  baseAppOf: Readonly<Record<string, string>>;
}

export interface Stage3Result {
  builds: BuildRecord[];
  pairs: PairRow[];
  values: Map<string, Partial<Record<BuildArm, Values>>>;
  paired: Paired[];
  keep: ReturnType<typeof keepFlags>;
  instrument: ReturnType<typeof instrument>;
  capStop: { item: string; why: string } | null;
  /** Every build and check VM with its dropped connections, in the order they ran. */
  sandboxes: SandboxTally[];
  lines: string[];
}

const ITEM = "dc-stage3-builds" as const;
/** Room for every build in the round at full allowance, twice over for the one retry: $60. */
const roundReserve = (): number => {
  const a = LEDGER_ITEMS[ITEM].admission;
  return a.kind === "sessions" ? a.reserveUsd : fail("E_INTERNAL", ITEM + " admits sessions");
};

/** Runs stage 3 on the selected units. Builds go in unit order then arm order, 2 at a time. */
export async function runStage3(sel: Stage3Selection, d: Stage3Deps): Promise<Stage3Result> {
  const builds: BuildRecord[] = [];
  const sandboxes: SandboxTally[] = [];
  d = { ...d, builds: { ...d.builds, tally: sandboxes } };
  const jobs: Array<{ c: Stage3Selection["units"][number]; arm: BuildArm; block: string | null }> = [];
  for (const u of sel.units)
    for (const arm of BUILD_ARMS) {
      const a = armBlock(arm, (x) => d.opusBlock(u.candidate.unit.id, x));
      if (a.builds) jobs.push({ c: u, arm, block: a.block });
      else builds.push({ unit: u.candidate.unit.id, arm, state: "not-built", serves: null, reads: null, retried: null, ownLimit: false });
    }
  let capStop: Stage3Result["capStop"] = null;
  for (let i = 0; i < jobs.length; i += STAGE3.buildsAtOnce) {
    const round = jobs.slice(i, i + STAGE3.buildsAtOnce);
    const name = "stage 3 builds " + round.map((j) => j.c.candidate.unit.id + " " + j.arm).join(", ");
    const adm = await d.money.admit({ item: ITEM, run: name, reserveUsd: roundReserve() });
    if (!adm.ok) {
      await d.money.capStop(ITEM, adm.why);
      capStop = { item: ITEM, why: adm.why };
      for (const j of jobs.slice(i)) builds.push({ unit: j.c.candidate.unit.id, arm: j.arm, state: "incomplete", serves: null, reads: null, retried: null, ownLimit: false });
      break;
    }
    const spends: Array<number | null> = [];
    const settled = await Promise.allSettled(
      round.map(async (j): Promise<BuildRecord> => {
        const c = j.c.candidate;
        const label = "build " + c.unit.id + " " + j.arm;
        const b = await runBuild({ label, tree: c.tree, plan: c.plan, prompt: buildPrompt(j.block), sub: { item: ITEM, id: adm.id } }, d.builds, () => d.money.reconcile(adm.id));
        spends.push(b.spentUsd);
        const base = { unit: c.unit.id, arm: j.arm, retried: b.retried, ownLimit: b.end === "own-limit" };
        if (!b.tree) return { ...base, state: "missing", serves: null, reads: null };
        const v = j.c.validation;
        const check = await checkBuild(b.tree, c.recipe, { unit: c.unit, item: "dc-stage3-reads", routes: c.routes, keyChecks: v.validated, scenarios: v.scenarios, fixtures: v.accepted.fixtures ? j.c.authored.fixtures : null }, d.builds, "check " + c.unit.id + " " + j.arm);
        if (check.serves === null) return { ...base, state: "missing", serves: null, reads: null };
        return { ...base, state: "measured", serves: check.serves, reads: check.reads };
      }),
    );
    await d.money.settle(adm.id, spends.length === round.length && spends.every((s) => s !== null) ? spends.reduce((n: number, s) => n + s!, 0) : null);
    for (const s of settled) if (s.status === "rejected" && !(s.reason instanceof CapStopSignal)) throw s.reason;
    const stop = settled.find((s): s is PromiseRejectedResult => s.status === "rejected");
    settled.forEach((s, k) => builds.push(s.status === "fulfilled" ? s.value : { unit: round[k]!.c.candidate.unit.id, arm: round[k]!.arm, state: "incomplete", serves: null, reads: null, retried: null, ownLimit: false }));
    if (stop) {
      const e = stop.reason as CapStopSignal;
      await d.money.capStop(e.item, e.message);
      capStop = { item: e.item, why: e.message };
      for (const j of jobs.slice(i + STAGE3.buildsAtOnce)) builds.push({ unit: j.c.candidate.unit.id, arm: j.arm, state: "incomplete", serves: null, reads: null, retried: null, ownLimit: false });
      break;
    }
  }

  const pairs: PairRow[] = [];
  const values = new Map<string, Partial<Record<BuildArm, Values>>>();
  for (const u of sel.units) {
    const id = u.candidate.unit.id;
    const mine = builds.filter((b) => b.unit === id);
    try {
      pairs.push(...(await des4(u.candidate.unit, mine, d.judge)));
    } catch (e) {
      if (!(e instanceof CapStopSignal)) throw e;
      await d.money.capStop(e.item, e.message);
      capStop ??= { item: e.item, why: e.message };
    }
    const noReview = mine.find((b) => b.arm === "no-review");
    const row: Partial<Record<BuildArm, Values>> = {};
    for (const b of mine) row[b.arm] = { ...buildValues(b, u.validation.validated, noReview), des4: b.arm === "generic-look" ? null : des4Value(pairs, id, b.arm) };
    values.set(id, row);
  }
  const paired = readout(values, d.baseAppOf);
  const keep = keepFlags(paired);
  const inst = instrument(pairs);
  return { builds, pairs, values, paired, keep, instrument: inst, capStop, sandboxes, lines: [...printStage3(sel, builds, pairs, paired, keep, inst, capStop), ...[...(sel.sandboxes ?? []), ...sandboxes].map(sandboxLine)] };
}

const fmt = (x: number | null) => (x === null ? "unavailable" : String(x));

/** The readout's lines: counts first, then every paired measure, the DES-4 rates, the instrument check and the KEEP flags. */
export function printStage3(sel: Stage3Selection, builds: readonly BuildRecord[], pairs: readonly PairRow[], paired: readonly Paired[], keep: Stage3Result["keep"], inst: Stage3Result["instrument"], capStop: Stage3Result["capStop"]): string[] {
  const lines: string[] = [];
  const count = (f: (b: BuildRecord) => boolean) => builds.filter(f).length;
  lines.push("stage 3: " + sel.units.length + " units, " + builds.length + " build slots; measured " + count((b) => b.state === "measured") + ", missing " + count((b) => b.state === "missing") + ", not built (no Opus block) " + count((b) => b.state === "not-built") + ", incomplete " + count((b) => b.state === "incomplete"));
  for (const arm of BUILD_ARMS) {
    const nb = count((b) => b.arm === arm && b.state === "not-built");
    if (nb) lines.push("arm " + arm + ": no build on " + nb + " units; its readouts pair only units where both builds exist");
  }
  lines.push("render reads unavailable (the build never serves): " + count((b) => b.state === "measured" && b.serves === false) + " builds, " + RENDER_READS.join(", "));
  lines.push("forced states unavailable (the screen doesn't read the data source plan.md names): " + count((b) => b.state === "measured" && !!b.serves && !!b.reads && !b.reads.readsDataSource) + " builds");
  lines.push("agent-user scenarios with no result, counted as not completed: " + builds.reduce((n, b) => n + missingScenarios(b), 0) + " over " + count((b) => b.state === "measured" && !!b.serves && !!b.reads) + " served builds");
  lines.push("builds retried after an own-limit stop " + count((b) => b.retried === "own-limit") + ", after a failure outside the agent " + count((b) => b.retried === "infra"));
  for (const u of sel.units) {
    const un = uninformative(u.validation.validated, builds.filter((b) => b.unit === u.candidate.unit.id));
    if (un.length) lines.push("unit " + u.candidate.unit.id + ": uninformative key checks (pass on every arm's build): " + un.join(", "));
  }
  lines.push("comparator\tarm\tmeasure\tunits\tdelta\tci95\tworse");
  for (const p of paired) lines.push([p.comparator, p.arm, p.measure, p.units, fmt(p.delta), p.ci95 ? "[" + p.ci95[0] + ", " + p.ci95[1] + "]" : "unavailable", p.worse].join("\t"));
  for (const w of winRates(pairs)) lines.push("DES-4 " + w.arm + " against the generic-look control, " + w.judge + ": " + fmt(w.rate) + " over " + w.pairs + " pairs");
  lines.push(inst.flagged ? "E_DC_BUILD_INSTRUMENT DES-4 is flagged (instrument): the no-review build beat the control in " + fmt(inst.rate) + " of its pairs, under " + STAGE3.des4InstrumentMin : "DES-4 instrument check passes: the no-review build beat the control in " + fmt(inst.rate) + " of its pairs");
  for (const k of keep) lines.push("KEEP flag " + k.arm + ": " + (k.flagged ? "flagged" : "not flagged") + " (key-check recurrence minus none " + fmt(k.delta) + ", ci95 " + (k.ci95 ? "[" + k.ci95[0] + ", " + k.ci95[1] + "]" : "unavailable") + ")");
  if (capStop) lines.push("cap stop on " + capStop.item + ": stage 3 is incomplete (" + capStop.why + ")");
  return lines;
}
