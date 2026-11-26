// Copyright (c) 2026 Garry Tan. MIT License.
// gstack-evals ep e1-* subcommands: eval 1's ledger lines, its review and build stages under one lease per item, the
// interim look, the pilot readout and the final readings (prereg 2026-11-24-geva-587-design-time-state-modeling). The
// lane's cli.ts merges this table. Launchers are seams, so the tests and the dry run drive the same code with stubs.
//
// Run folder (outside the repository; held-out material, sealed with the run):
//   author/<unit>/plan.md      the authored plan (attempt 3's authoring, or wave 2's at Sol 6.2)
//   e1/draw.json               the draw (supply.ts e1Draw), with its seed
//   e1/seeds.json              the bootstrap seed, minted from random bytes before the pilot is read
//   e1/reviews, e1/builds      records, mounts and sessions (pipeline.ts)
//   e1/look.json               the one interim look, written once
//   costs/<item>.jsonl, state/  the gates' journals and all-in states
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { buildLauncher } from "../../eng-build/launch.ts";
import { underLease, type Launcher } from "../../eng-build/pipeline.ts";
import { openLease, settleLease } from "../../../src/runner/ledger/ledger.ts";
import { openLocalLedger } from "../../../src/runner/ledger/local.ts";
import { ledgerPath } from "../../../src/runner/ledger/paths.ts";
import { readItem } from "../../../src/runner/ledger/record.ts";
import { plantedGrader } from "../construct/grade.ts";
import { fail } from "../errors.ts";
import { avoid, catchScore, isGap } from "../readings/score.ts";
import { ebSession, type MountTable, type PlantedSession } from "../stages/build.ts";
import { allInProjection, checkAllIn, ItemGate, runGated, settleThrown, type AllIn } from "../stages/ledger.ts";
import { owedOnRefusal, stagePlan, driverCells } from "../stages/rerun-log.ts";
import { unitFolders, type UnitSource } from "../stages/pipeline.ts";
import type { Command, Foresee, GradedBuild, PlantedGrader, PlantedUnit } from "../types.ts";
import { ALLOWANCE_USD } from "../stages/local.ts";
import { pMarker, P_COMMANDS, type PCommand } from "./arms.ts";
import { decide, readAll } from "./decide.ts";
import { E1, RUNS_ON, type E1Arm, type E1Model } from "./frozen.ts";
import { e1ReviewLauncher, rollouts, type E1ReviewSession } from "./launch.ts";
import { codexAsClaude } from "./detect.ts";
import { ownUses } from "../../eng-review/exposure.ts";
import { look } from "./look.ts";
import { cellKey, e1Builds, e1Cells, e1Item, E1_ITEMS, e1Reviews, itemName, reviewRecordPath, buildRecordPath, scoredCells, type CellKey, type E1Build, type E1ReviewRecord, type E1Unit } from "./pipeline.ts";
import { armState, holm, rng, type Cell } from "./readings.ts";
import { drawOrder, e1Draw, screenUnit, stateAgreement, SUPPLY_MODELS, type DrawUnit, type E1Draw, type ScreenRecord, type SupplyCall, type SupplyRole } from "./supply.ts";
import { meterLauncher } from "../stages/commands.ts";
import { AUTHOR_MAX_TOKENS, AUTHOR_MODELS, type AuthorRole } from "../stages/local.ts";
import { AUTHOR_ROUTES } from "../stages/commands.ts";
import { authorCalls, hintedVerdict, type AuthorCall } from "../stages/author.ts";
import { buildKey, runPlantedBuild } from "../stages/build.ts";
import { armName } from "../../eng-build/build-stage.ts";
import type { ModelKey } from "../../product-value/meter.ts";

type Args = Parameters<Command["run"]>[0];
type Io = Parameters<Command["run"]>[1];

export const E1_RUN = "geva-587-e1";
export const E1_PROGRAM = "geva-587-e1";
export const E1_SKILL = "e1-run";
/** The all-in pieces that are not ledger items (section 11). */
export const E1_NOT_ITEMS = { hosts: { capUsd: 200 }, crew: { capUsd: 700 }, reserve: { capUsd: 150 } } as const;
/** This run's authoring (pool units attempt 3 never finished, and wave 2's): attempt 3's roles, with GPT-6.2 Sol writing
 * the plan and the hint (prereg section 2, R116). */
export const WAVE2_AUTHOR_MODELS: Readonly<Record<AuthorRole, string>> = { ...AUTHOR_MODELS, writer: "openai/gpt-6.2-sol", hint: "openai/gpt-6.2-sol" };
export const WAVE2_AUTHOR_ROUTES: Readonly<Record<AuthorRole, ModelKey | null>> = { ...AUTHOR_ROUTES, writer: "sol-6.2", hint: "sol-6.2" };
/** The supply screens' meter routes, each at its model's default effort. */
export const SUPPLY_ROUTES: Readonly<Record<SupplyRole, ModelKey | null>> = { stateAstra: "astra-6.2", stateOpus: "opus", reachCarbon: "carbon", reachOpus: "opus" };

const need = (a: Args, flag: string): string => a.flags.get(flag) ?? fail("E_USAGE", "missing " + flag);
const whole = (a: Args, flag: string, dflt: number): number => {
  const v = a.flags.has(flag) ? Number(a.flags.get(flag)) : dflt;
  if (!Number.isSafeInteger(v) || v < 1) fail("E_USAGE", flag + " takes a whole number from 1");
  return v;
};
const logTo = (io: Io) => (l: string) => (/^E_[A-Z_0-9]+ /.test(l) ? io.err : io.out)(l);
const readJson = <T>(p: string): T | null => (existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as T) : null);
const REPO = resolve(import.meta.dir, "..", "..", "..");
const runDir = (a: Args): string => {
  const run = resolve(need(a, "--run"));
  const real = (p: string) => (existsSync(p) ? realpathSync(p) : resolve(p));
  const r = relative(real(REPO), real(run));
  if (r === "" || !r.startsWith("..")) fail("E_USAGE", "--run " + run + " is inside the gstack-evals repository; held-out material stays outside it");
  return run;
};

/** The ledger lines for eval 1's items, with the owner's words left to fill in. */
export function e1RunSteps(): string[] {
  const cap = E1_ITEMS.reduce((s, i) => s + i.capUsd, 0);
  const tail = " --words <owner's words> --by <who> --source <ref>";
  return [
    "gstack-evals ledger envelope --program " + E1_PROGRAM + " --cap " + Math.round(cap * 100) / 100 + " --skill-cap " + Math.round(cap * 100) / 100 + " --skills " + E1_SKILL + " --credit-rate 1" + tail,
    ...E1_ITEMS.map((i) => "gstack-evals ledger init --item " + i.item + " --cap " + i.capUsd + " --admission required --program " + E1_PROGRAM + " --skills " + E1_SKILL + tail),
    "# Hosts ($" + E1_NOT_ITEMS.hosts.capUsd + ") and crew ($" + E1_NOT_ITEMS.crew.capUsd + ") pass their running figures to every paid e1 command as --hosts-usd and --crew-usd; the $" + E1_NOT_ITEMS.reserve.capUsd + " reserve stays with the Captain.",
  ];
}

export interface E1Paid {
  item: string;
  capUsd: number;
  record: string;
  ledger: string;
  allIn: AllIn;
}

/** A paid command's flags, refused before any lease opens. */
export function e1Paid(a: Args, run: string, allowed: (item: string) => boolean): E1Paid {
  const missing = ["--item", "--cap-usd", "--ledger-record", "--ledger", "--crew-usd", "--hosts-usd"].filter((f) => !a.flags.get(f));
  if (missing.length) fail("E_USAGE", "a paid e1 stage runs only under a ledger lease with the all-in figures; it needs " + missing.join(", ") + ", and nothing ran");
  const item = a.flags.get("--item")!;
  if (!allowed(item)) fail("E_USAGE", "this stage does not spend from " + item);
  const plan = e1Item(item).capUsd;
  const capUsd = Number(a.flags.get("--cap-usd"));
  if (!Number.isFinite(capUsd) || capUsd <= 0 || capUsd > plan) fail("E_USAGE", "--cap-usd " + a.flags.get("--cap-usd") + " is not a positive amount at or under item " + item + "'s plan cap of $" + plan);
  const fig = (f: string) => {
    const v = Number(a.flags.get(f));
    return Number.isFinite(v) && v >= 0 ? v : fail("E_USAGE", f + " takes the running figure in dollars, not " + a.flags.get(f));
  };
  return { item, capUsd, record: a.flags.get("--ledger-record")!, ledger: a.flags.get("--ledger")!, allIn: { stateDir: join(run, "state"), crewUsd: fig("--crew-usd"), hostsUsd: fig("--hosts-usd") } };
}

export function e1Gate(p: E1Paid, run: string, planned?: number): ItemGate {
  const cap = readItem(p.record, p.item).cap_micros;
  if (!cap) return fail("E_USAGE", "line item " + p.item + " has no recorded cap in " + p.record + "; ep e1-ledger prints the init lines");
  return new ItemGate(e1Item(p.item), { capUsd: cap / 1_000_000, ...(planned !== undefined ? { planned: { "review:plain": planned, build: planned } } : {}), journal: join(run, "costs", p.item + ".jsonl"), allIn: p.allIn, items: E1_ITEMS });
}

/** A launcher for stub backends (the dry run and the tests): one lease on an e1 item for run E1_RUN, settled on close. */
export const e1StubLauncher = <B>(backend: B): Launcher<B> => async (p) => {
  e1Item(p.item);
  const local = openLocalLedger(ledgerPath(p.ledger));
  try {
    const lease = openLease(p.record, local, { item: p.item, run_id: E1_RUN, amount_micros: Math.round(p.capUsd * 1_000_000), requireAdmission: () => null });
    return {
      lease_id: lease.lease_id,
      backend,
      close: async () => {
        try {
          settleLease(p.record, local, lease.lease_id);
        } finally {
          local.close();
        }
      },
    };
  } catch (e) {
    local.close();
    throw e;
  }
};

/** One lease for one stage group. Several groups share an item (the pilot's 14 pairs, the supply item's screens, authoring
 * and hinted builds), so each lease asks for the smaller of --cap-usd and what the item has left; an item with nothing
 * left still refuses at the ledger. */
const paidStage = async <B, T>(p: E1Paid, launch: Launcher<B>, body: (b: B) => Promise<T>): Promise<T> => {
  checkAllIn(p.allIn, E1_ITEMS);
  const it = readItem(p.record, p.item);
  const left = Math.max(0, (it.cap_micros ?? 0) - it.committed_micros);
  return underLease({ ...p, capUsd: Math.min(Math.round(p.capUsd * 1_000_000), left) / 1_000_000 }, launch, body);
};

export const parseItem = (item: string): { arm: E1Arm; model: E1Model } | null => {
  const m = /^e1-([ndcpg])-(opus|sol|particle)$/.exec(item);
  const arm = m?.[1]!.toUpperCase() as E1Arm;
  return m && RUNS_ON[arm].includes(m[2] as E1Model) ? { arm, model: m[2] as E1Model } : null;
};

export interface E1Comparison {
  /** The comparison units, frozen from draw.json after the pilot: 48 to 64. */
  units: string[];
  /** Arm and model pairs the pilot left out (R111); none of their cells runs or is owed. */
  leftOut: Array<{ arm: E1Arm; model: E1Model }>;
  digest: string;
  at: string;
}
export const comparisonPath = (run: string) => join(run, "e1", "comparison.json");
export const comparisonOf = (run: string): E1Comparison => readJson<E1Comparison>(comparisonPath(run)) ?? fail("E_USAGE", comparisonPath(run) + " is missing; ep e1-freeze fixes the comparison units after the pilot");
export const leftOut = (f: E1Comparison, arm: E1Arm, model: E1Model) => f.leftOut.some((x) => x.arm === arm && x.model === model);
export const comparisonDigest = (units: readonly string[], out: E1Comparison["leftOut"]) => createHash("sha256").update(JSON.stringify({ units, leftOut: out })).digest("hex");

export const drawOf = (run: string): E1Draw => readJson<E1Draw>(join(run, "e1", "draw.json")) ?? fail("E_USAGE", run + "/e1/draw.json is missing; the draw comes first");

/** The units a phase and half name, and each one's cells for an arm and model. */
export function phaseCells(run: string, phase: "pilot" | "comparison", half: 1 | 2 | null, arm: E1Arm | null, model: E1Model | null): { units: string[]; cells: CellKey[] } {
  const d = drawOf(run);
  const f = phase === "pilot" ? null : comparisonOf(run);
  const all = f ? f.units : d.calibration;
  const cut = Math.floor(all.length * E1.look.fraction);
  const units = phase === "pilot" || half === null ? all : half === 1 ? all.slice(0, cut) : all.slice(cut);
  const cells = e1Cells(d.seed, units, phase === "pilot" ? 1 : E1.cells).filter((c) => (arm === null || c.arm === arm) && (model === null || c.model === model) && !(f && leftOut(f, c.arm, c.model)));
  return { units, cells };
}

export interface LookFile {
  stop: boolean;
  units: string[];
  CN: unknown;
  PN: unknown;
  exposedOn: { C: E1Model[]; P: E1Model[] };
  at: string;
}
export const lookPath = (run: string) => join(run, "e1", "look.json");
export const capStopPath = (run: string, item: string) => join(run, "e1", "cap-stops", item + ".json");

/** Runs a paid stage body, refusing an item a cap stopped before: a cap stop leaves e1/cap-stops/<item>.json, and the
 * item stays an incomplete run until the Captain rules (prereg section 5: never retried to change a verdict). */
export async function capGuarded<T>(run: string, item: string, body: () => Promise<T>): Promise<T> {
  const p = capStopPath(run, item);
  if (existsSync(p)) fail("E_USAGE", item + " stopped at its cap (" + p + "); it is an incomplete run and does not restart until the Captain rules; nothing ran");
  try {
    return await body();
  } catch (e) {
    const code = (e as { code?: string }).code;
    const msg = e instanceof Error ? e.message : String(e);
    if (code === "E_EP_REPROJECT" || (code === "E_EB_CELL_INCOMPLETE" && /\bcap\b|cap_stop/.test(msg))) {
      mkdirSync(dirname(p), { recursive: true });
      if (!existsSync(p)) writeFileSync(p, JSON.stringify({ item, code, message: msg, at: new Date().toISOString() }) + "\n", { flag: "wx" });
    }
    throw e;
  }
}

export function e1Units(src: UnitSource, run: string, ids: readonly string[]): Map<string, E1Unit & { dir: string; note: string }> {
  const all = new Map(src.units().map((u) => [u.id, u]));
  return new Map(
    ids.map((id) => {
      const unit = all.get(id) ?? fail("E_USAGE", "unit " + id + " is not in the units folder");
      const plan = join(run, "author", id, "plan.md");
      if (!existsSync(plan)) fail("E_USAGE", "unit " + id + " has no authored plan at " + plan);
      return [id, { unit, base: src.base(id), plan, dir: src.dir(id), note: src.note(id) }];
    }),
  );
}

export interface E1Seams {
  review(o: { out: string; arm: E1Arm; model: E1Model; log: (l: string) => void }): Launcher<E1ReviewSession>;
  /** reviewed is false for wave 2's hinted authoring builds (attempt 3's "none" stage), true for eval 1's builds. */
  build(o: { out: string; driver: string; src: UnitSource; units: string; repos: string; ids: string[]; cells: string[]; a: Args; reviewed?: boolean }): Launcher<PlantedSession>;
  author(o: { out: string; cacheDir: string }): Launcher<AuthorCall>;
  grader(o: { work: string; log: (l: string) => void }): Promise<PlantedGrader>;
  marker(harness: string): string;
  supply(o: { out: string; cacheDir: string }): Launcher<SupplyCall>;
  /** Bootstrap draws for the look and the readings; unset is the frozen 10,000. Only test seams set it. */
  draws?: number;
  /** No paid command runs before its instant: pilot preparation (the supply screens, authoring and hinted builds) and the
   * pilot from pilot, counted cells from counted (pre-run change 3). Unset in test seams and the driven launch. */
  notBefore?: { pilot: string; counted: string };
  /** The clock the guard reads; only tests set it. */
  now?: () => number;
}

/** Pre-run change 3: the owner's go of 2026-11-26 opens pilot preparation and the pilot; counted cells keep the prereg's
 * 2026-11-28 06:00Z and still wait for the Captain's ruling on the pilot readout. */
export const E1_NOT_BEFORE = { pilot: "2026-11-26T21:08:58Z", counted: "2026-11-28T06:00:00Z" } as const;

export const E1_REAL: E1Seams = {
  review: (o) => e1ReviewLauncher({ arms: [o.arm], model: o.model, out: o.out, env: process.env, runId: E1_RUN, log: o.log }),
  build: (o) => {
    const table: MountTable = new Map();
    const mountOf = (cell: string) => table.get(cell) ?? fail("E_USAGE", "cell " + cell + " has no mounts filed; only ebSession starts an e1 build");
    const arm = o.reviewed === false ? "none" : "plain";
    const plan = stagePlan(o.driver, E1_RUN, armName(arm), o.cells);
    const inner = buildLauncher({
      arm,
      units: new Map(o.ids.map((id) => [id, { dir: o.src.dir(id) }])),
      repos: o.repos,
      plans: o.out,
      bundles: null,
      out: o.out,
      host: need(o.a, "--host"),
      envelopeHost: need(o.a, "--envelope-host"),
      sidecar: need(o.a, "--sidecar"),
      forbidden: [o.units, join(homedir(), ".capy", "drive")],
      planned: plan.planned,
      planFor: (cell) => mountOf(cell).plan,
      reviewFor: (cell) => mountOf(cell).review,
      runId: E1_RUN,
      skill: E1_SKILL,
      serve: { dir: o.driver, unheld_ok: true, reruns: plan.reruns },
      stripBase: true,
      ...(o.a.flags.has("--harbor") ? { harbor: o.a.flags.get("--harbor")! } : {}),
    });
    return async (p) => {
      const h = await inner(p);
      return { ...h, backend: owedOnRefusal(ebSession(h.backend, table), o.driver, E1_RUN, join(o.out, "sessions")) };
    };
  },
  grader: async (o) => plantedGrader({ work: o.work }),
  marker: pMarker,
  author: (o) => meterLauncher({ ...o, maxTokens: AUTHOR_MAX_TOKENS, effort: null, label: "e1-author", models: WAVE2_AUTHOR_MODELS, routes: WAVE2_AUTHOR_ROUTES, roles: Object.keys(WAVE2_AUTHOR_MODELS) as AuthorRole[], runId: E1_RUN }),
  supply: (o) => meterLauncher({ ...o, maxTokens: AUTHOR_MAX_TOKENS, effort: null, label: "e1-supply", models: SUPPLY_MODELS, routes: SUPPLY_ROUTES, roles: Object.keys(SUPPLY_MODELS) as SupplyRole[], runId: E1_RUN }),
  notBefore: E1_NOT_BEFORE,
};

/** An authoring call under the supply gate that settles every call of a unit's authoring under one cell (change 2 section
 * 6: a unit's authoring calls are one call cell). */
export function unitCall(gate: ItemGate, call: AuthorCall, unit: string): AuthorCall {
  return async (role, prompt, attempt) => {
    await gate.acquire("call");
    let r: { text: string; costUsd: number };
    try {
      r = await call(role, prompt, attempt);
    } catch (e) {
      throw settleThrown(gate, "call", e, "author:" + unit);
    }
    gate.settle("call", r.costUsd, "author:" + unit);
    return r;
  };
}

/** A stand-in screen that lets e1-screen walk the draw's order before the screens exist. */
const SCREEN_OWED: ScreenRecord = { state: { astra: null, opus: null, eligible: true, packet: "" }, reach: ["yes", "yes"], drop: null, bothYes: true, costUsd: 0 };
const screenPath = (run: string, id: string) => join(run, "e1", "screen", id + ".json");
const segmentsPath = (run: string) => join(run, "e1", "segments.json");

/** The draw's seed: 16 random bytes, minted once. */
export function drawSeed(run: string): string {
  const p = join(run, "e1", "draw-seed.json");
  const have = readJson<{ seed: string }>(p);
  if (have) return have.seed;
  const seed = randomBytes(16).toString("hex");
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify({ seed, minted_at: new Date().toISOString(), rule: "crypto random bytes, minted once" }) + "\n", { flag: "wx" });
  return seed;
}

export const wave2Path = (run: string) => join(run, "e1", "wave2.json");

/** Each unit's authoring state from the records in the run, and its segment of the walk. The segments freeze the first
 * time they are read (e1/segments.json): attempt 3's are the units whose authoring had a record then, and wave 2's are
 * e1/wave2.json's ids (written when the pool is rebuilt from custody), which must exist by then. Every other unit is
 * the pool's. */
export function drawUnits(run: string, src: UnitSource): DrawUnit[] {
  const state = (id: string): DrawUnit["authoring"] => {
    const calls = readJson<{ drop: string | null }>(join(run, "author", id, "calls.json"));
    const hinted = readJson<{ drop: string | null }>(join(run, "author", id, "hinted.json"));
    return calls?.drop || hinted?.drop ? "dropped" : calls && hinted ? "passed" : "owed";
  };
  const units = src.units().map((u) => ({ u, authoring: state(u.id) }));
  let seg = readJson<{ attempt3: string[]; wave2?: string[] }>(segmentsPath(run));
  if (!seg) {
    const w2 = readJson<{ units: string[] }>(wave2Path(run)) ?? fail("E_USAGE", wave2Path(run) + " (wave 2's unit ids) must exist before the walk's segments freeze; nothing was read");
    const ids = new Set(units.map((x) => x.u.id));
    const stray = w2.units.filter((id) => !ids.has(id));
    if (stray.length) fail("E_USAGE", wave2Path(run) + " names " + stray.length + " units the units folder lacks (first " + stray[0] + "); nothing was read");
    seg = { attempt3: units.filter((x) => x.authoring !== "owed" && !w2.units.includes(x.u.id)).map((x) => x.u.id), wave2: w2.units };
    mkdirSync(dirname(segmentsPath(run)), { recursive: true });
    writeFileSync(segmentsPath(run), JSON.stringify(seg) + "\n", { flag: "wx" });
  }
  const a3 = new Set(seg.attempt3);
  const w2 = new Set(seg.wave2 ?? []);
  return units.map(({ u, authoring }) => ({ id: u.id, repo: u.repo, authoring, by: a3.has(u.id) ? "attempt3" : w2.has(u.id) ? "wave2" : "pool", foresee: readJson<{ foresee: [Foresee, Foresee] | null }>(join(run, "author", u.id, "calls.json"))?.foresee ?? null, screen: readJson<ScreenRecord>(screenPath(run, u.id)) }));
}

/** The bootstrap seed, minted from random bytes once and recorded before anything reads a contrast. */
export function bootstrapSeed(run: string): number {
  const p = join(run, "e1", "seeds.json");
  const have = readJson<{ bootstrap: number }>(p);
  if (have) return have.bootstrap;
  const bootstrap = randomBytes(4).readUInt32BE(0);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify({ bootstrap, minted_at: new Date().toISOString(), rule: "crypto random bytes, minted once before any contrast is read" }) + "\n", { flag: "wx" });
  return bootstrap;
}

/** Scored cells for a set of units, with the stopped arms' unrun cells marked. */
export function cellsFor(run: string, src: UnitSource, units: readonly string[], unrunArms: ReadonlySet<E1Arm> = new Set(), reps: number = E1.cells): Cell[] {
  const d = drawOf(run);
  const by = new Map(src.units().map((u) => [u.id, u]));
  const cells = e1Cells(d.seed, units, reps);
  const m = new Map(units.map((id) => [id, { unit: by.get(id) ?? fail("E_USAGE", "no unit " + id), repo: (by.get(id) as PlantedUnit).repo }]));
  const unrun = new Set(cells.filter((c) => unrunArms.has(c.arm) && !existsSync(buildRecordPath(run, c))).map(cellKey));
  return scoredCells(run, cells, m, unrun);
}

const fmt = (r: { estimate: number; lo: number; hi: number; p: number; pairs: number; repos: number; worse: number } | null) => (r ? (r.estimate >= 0 ? "+" : "") + r.estimate.toFixed(1) + " [" + r.lo.toFixed(1) + ", " + r.hi.toFixed(1) + "], p " + r.p.toFixed(3) + ", " + r.pairs + " pairs, " + r.repos + " repositories, " + r.worse + " worse" : "not read (no pool)");

/** A build record as the lane's scorers read one. */
export const asGraded = (b: E1Build): GradedBuild => ({ ...b, arm: "plain", reviewer: b.model, pilot: true, coverage: null });

/** The pilot's gates (prereg, the Pilots section): exposure in 5 of 6 sessions per arm and model (P on Opus and
 * particle-1 only), the builder opening /work/review/ in 5 of 6 for D and C, N's pooled composite in band, and the limit
 * and cost lines that double the allowance. ok is false when any gate fails or a cell is missing. */
/** Each arm's pilot spend limit: a tenth of its counted budget (prereg section 9's pilot table). */
export const PILOT_ARM_CAP_USD: Readonly<Record<E1Arm, number>> = { N: 41, D: 46, C: 74, P: 46, G: 81 };
/** A gstack, pstack or drive path in a tool call's input. */
export const AUDIT_PATH = /\.capy\/drive|(?:^|[^\w-])[gp]stack(?!-evals)(?:[^\w]|$)/;

/** The tool calls in an N review cell's sessions (every attempt) that name a gstack, pstack or drive path. */
export function readAudit(run: string, c: CellKey): number {
  const base = join(run, "e1", "reviews", "sessions", cellKey(c));
  if (!existsSync(base)) return 0;
  let hits = 0;
  for (const a of readdirSync(base).filter((n) => /^a\d+$/.test(n))) {
    const host = join(base, a, "run", "host");
    const t = existsSync(join(host, "codex-sessions")) ? codexAsClaude(rollouts(join(host, "codex-sessions"))) : existsSync(join(host, "transcript.ndjson")) ? readFileSync(join(host, "transcript.ndjson"), "utf8") : "";
    hits += ownUses(t).filter((u) => AUDIT_PATH.test(JSON.stringify(u.input))).length;
  }
  return hits;
}

export interface PilotFacts {
  /** Calibration units drawn (6 needed). */
  calibration: number;
  /** Comparison units in hand (48 needed). */
  supply: number;
  /** N's read audit hits per model. */
  nAudit: Partial<Record<E1Model, number>>;
}

export function pilotReadout(reviews: readonly E1ReviewRecord[], builds: readonly E1Build[], units: Map<string, PlantedUnit>, planned: number, seed: number, f: PilotFacts = { calibration: E1.units.calibration, supply: E1.units.target, nAudit: {} }): { lines: string[]; ok: boolean; doubleAllowance: boolean } {
  const lines: string[] = [];
  let ok = reviews.length === planned && builds.length === planned;
  if (!ok) lines.push("MISSING: " + reviews.length + " reviews and " + builds.length + " builds of " + planned + " cells recorded");
  const supplyOk = f.calibration === E1.units.calibration && f.supply >= E1.units.floor;
  ok &&= supplyOk;
  lines.push((supplyOk ? "PASS " : "FAIL ") + "supply: " + f.calibration + " of " + E1.units.calibration + " calibration units; " + f.supply + " comparison units in hand (at least " + E1.units.floor + ", target " + E1.units.target + ")");
  for (const arm of Object.keys(RUNS_ON) as E1Arm[]) {
    const usd = reviews.filter((r) => r.arm === arm).reduce((s, r) => s + r.costUsd, 0) + builds.filter((b) => b.arm === arm).reduce((s, b) => s + b.costUsd, 0);
    const within = usd <= PILOT_ARM_CAP_USD[arm] + 1e-9;
    ok &&= within;
    lines.push((within ? "PASS " : "FAIL ") + arm + "'s pilot spend $" + usd.toFixed(2) + " against its $" + PILOT_ARM_CAP_USD[arm] + " (a tenth of its counted budget)");
  }
  const audit = RUNS_ON.N.map((m) => [m, f.nAudit[m] ?? 0] as const);
  const clean = audit.every(([, n]) => n === 0);
  ok &&= clean;
  lines.push((clean ? "PASS " : "FAIL ") + "N's read audit: " + audit.map(([m, n]) => m + " " + n + " gstack, pstack or drive path" + (n === 1 ? "" : "s")).join(", "));
  let doubleAllowance = false;
  const need = E1.exposure.pilot.min;
  for (const arm of Object.keys(RUNS_ON) as E1Arm[]) for (const m of RUNS_ON[arm]) {
    const rs = reviews.filter((r) => r.arm === arm && r.model === m);
    const bs = builds.filter((b) => b.arm === arm && b.model === m);
    const exposed = rs.filter((r) => r.exposed === true).length;
    const opened = bs.filter((b) => b.readReview === true).length;
    const limits = rs.filter((r) => r.outcome === "limit").length;
    const costs = rs.map((r) => r.costUsd).sort((x, y) => x - y);
    const p95 = costs.length ? costs[Math.min(costs.length - 1, Math.ceil(0.95 * costs.length) - 1)]! : 0;
    const exposureOk = arm === "N" || exposed >= need;
    const openedOk = !(arm === "D" || arm === "C") || opened >= need;
    if (limits > 1 || p95 > ALLOWANCE_USD.review / 2) doubleAllowance = true;
    ok &&= exposureOk && openedOk;
    lines.push((exposureOk && openedOk ? "PASS " : "FAIL ") + arm + " on " + m + ": exposed " + exposed + " of " + rs.length + ", builder opened /work/review/ in " + opened + " of " + bs.length + ", limit stops " + limits + ", refusals " + rs.filter((r) => r.stop === "refusal").length + ", safety stops " + rs.filter((r) => r.stop === "safety").length + ", plan left unchanged " + rs.filter((r) => r.planUnchanged === true).length + ", gaps " + rs.filter(isGap).length + ", review cost p95 $" + p95.toFixed(2));
  }
  const n = builds.filter((b) => b.arm === "N" && !isGap(b));
  const comp = n.map((b) => ({ repo: units.get(b.unit)!.repo, x: (avoid(asGraded(b), units.get(b.unit)!) ?? 0) / 2 + catchScore(asGraded(b))! / 2 }));
  const repos = [...new Set(comp.map((c) => c.repo))];
  const mean = comp.length ? comp.reduce((s, c) => s + c.x, 0) / comp.length : null;
  const rand = rng(seed);
  const boots: number[] = [];
  for (let i = 0; i < 10000 && repos.length; i++) {
    const xs = Array.from({ length: repos.length }, () => repos[Math.floor(rand() * repos.length)]!).flatMap((r) => comp.filter((c) => c.repo === r).map((c) => c.x));
    boots.push(xs.reduce((s, x) => s + x, 0) / xs.length);
  }
  boots.sort((x, y) => x - y);
  const lo = boots.length ? boots[Math.floor(0.025 * (boots.length - 1))]! : null;
  const band = mean !== null && lo !== null && mean >= 0.15 && mean <= 0.75 && lo <= 0.65;
  ok &&= band;
  lines.push((band ? "PASS " : "FAIL ") + "N's composite over " + comp.length + " builds: " + (mean === null ? "none" : mean.toFixed(3) + ", lower bound " + lo!.toFixed(3)) + " (band 0.15 to 0.75, lower bound at most 0.65; out of band stops for the Captain as FLOOR or CEILING)");
  if (doubleAllowance) lines.push("ALLOWANCE: more than 1 of 6 limit stops or a p95 review cost past half the allowance; every review allowance doubles through a dated change");
  return { lines, ok, doubleAllowance };
}

export function e1Commands(seams: E1Seams = E1_REAL): Record<string, Command> {
  const source = (a: Args): UnitSource => unitFolders(need(a, "--units"), need(a, "--repos"));
  const paid = (a: Args, run: string, when: "pilot" | "counted", allowed: (item: string) => boolean): E1Paid => {
    const at = seams.notBefore?.[when];
    if (at && (seams.now ?? Date.now)() < Date.parse(at)) fail("E_USAGE", "no " + (when === "pilot" ? "pilot or pilot-preparation" : "counted") + " e1 stage runs before " + at + "; nothing ran");
    return e1Paid(a, run, allowed);
  };
  const phaseOf = (a: Args) => {
    const phase = need(a, "--phase");
    if (phase !== "pilot" && phase !== "comparison") fail("E_USAGE", "--phase is pilot or comparison");
    const half = phase === "pilot" ? null : Number(need(a, "--half"));
    if (half !== null && half !== 1 && half !== 2) fail("E_USAGE", "--half is 1 or 2");
    return { phase: phase as "pilot" | "comparison", half: half as 1 | 2 | null };
  };
  const stagePlanFor = (a: Args, run: string) => {
    const { phase, half } = phaseOf(a);
    const p = paid(a, run, phase === "pilot" ? "pilot" : "counted", (item) => (phase === "pilot" ? item === "e1-pilot" : parseItem(item) !== null));
    const which = phase === "pilot" ? null : parseItem(p.item)!;
    let planned: number | undefined;
    if (phase === "comparison") {
      const f = comparisonOf(run);
      if (leftOut(f, which!.arm, which!.model)) fail("E_USAGE", which!.arm + " on " + which!.model + " was left out after the pilot (" + comparisonPath(run) + "); nothing ran");
      const stopped = (which!.arm === "C" || which!.arm === "P") && readJson<LookFile>(lookPath(run))?.stop === true;
      planned = (stopped ? Math.floor(f.units.length * E1.look.fraction) : f.units.length) * E1.cells;
    }
    if (phase === "comparison" && half === 2 && (which!.arm === "C" || which!.arm === "P")) {
      const l = readJson<LookFile>(lookPath(run)) ?? fail("E_USAGE", "C and P's second half waits for the interim look (ep e1-look); nothing ran");
      if (l.stop) fail("E_USAGE", "the interim look stopped C and P for futility; their second half is never run");
    }
    return { p, phase, half, which, planned };
  };

  const reviews: Command["run"] = async (a, io) => {
    const run = runDir(a);
    const { p, phase, half, which, planned } = stagePlanFor(a, run);
    const src = source(a);
    const log = logTo(io);
    const pCommand = (a.flags.get("--p-command") ?? "/statechart") as PCommand;
    if (!P_COMMANDS.includes(pCommand)) fail("E_USAGE", "--p-command is " + P_COMMANDS.join(" or "));
    const groups = which ? [which] : (Object.keys(RUNS_ON) as E1Arm[]).flatMap((arm) => RUNS_ON[arm].map((model) => ({ arm, model })));
    for (const g of groups) {
      const { units, cells } = phaseCells(run, phase, half, g.arm, g.model);
      const marker = g.arm === "P" ? seams.marker(need(a, "--pstack")) : undefined;
      const gate = e1Gate(p, run, planned);
      const recs = await capGuarded(run, p.item, () => paidStage(p, seams.review({ out: join(run, "e1", "reviews", "rig", itemName(g.arm, g.model)), arm: g.arm, model: g.model, log }), (session) => e1Reviews({ run, cells, units: e1Units(src, run, units), session, gate, pCommand, ...(marker ? { statechartMarker: marker } : {}), parallel: whole(a, "--parallel", 1), log })));
      io.out("reviews " + g.arm + " on " + g.model + ": " + recs.length + " of " + cells.length + " recorded, " + recs.filter(isGap).length + " gaps, $" + recs.reduce((s, r) => s + r.costUsd, 0).toFixed(2));
    }
    return 0;
  };

  const builds: Command["run"] = async (a, io) => {
    const run = runDir(a);
    const { p, phase, half, which, planned } = stagePlanFor(a, run);
    const src = source(a);
    const log = logTo(io);
    const grader = await seams.grader({ work: need(a, "--work"), log });
    const driver = join(run, "e1", "builds", "driver");
    const opened = driverCells(driver, E1_RUN);
    const groups = which ? [which] : (Object.keys(RUNS_ON) as E1Arm[]).flatMap((arm) => RUNS_ON[arm].map((model) => ({ arm, model })));
    const all = groups.flatMap((g) => phaseCells(run, phase, half, g.arm, g.model).cells);
    const units = [...new Set(all.map((c) => c.unit))];
    const gate = e1Gate(p, run, planned);
    const done = await capGuarded(run, p.item, () => paidStage(p, seams.build({ out: join(run, "e1", "builds", "rig"), driver, src, units: need(a, "--units"), repos: need(a, "--repos"), ids: units, cells: all.map(cellKey), a }), (session) => e1Builds({ run, cells: all, units: e1Units(src, run, units), session, grader, gate, parallel: whole(a, "--parallel", 1), earlier: (cell) => opened.get(cell)?.opens ?? 0, log })));
    io.out("builds: " + done.length + " of " + all.length + " cells recorded, " + done.filter(isGap).length + " gaps, $" + done.reduce((s, b) => s + b.costUsd, 0).toFixed(2));
    return 0;
  };

  const ledger: Command["run"] = (a, io) => {
    if (!a.bools.has("--projection")) {
      for (const l of e1RunSteps()) io.out(l);
      for (const i of E1_ITEMS) io.out("# " + i.item + ": " + i.row + "; projection $" + i.projectionUsd + ", cap $" + i.capUsd);
      return 0;
    }
    const run = runDir(a);
    const allIn: AllIn = { stateDir: join(run, "state"), crewUsd: Number(need(a, "--crew-usd")), hostsUsd: Number(need(a, "--hosts-usd")) };
    if (![allIn.crewUsd, allIn.hostsUsd].every((v) => Number.isFinite(v) && v >= 0)) fail("E_USAGE", "--crew-usd and --hosts-usd take dollars");
    const r = allInProjection(allIn, E1_ITEMS);
    for (const l of r.lines) io.out(l);
    io.out("all-in projection $" + r.usd.toFixed(2) + " against the $5000 stop");
    checkAllIn(allIn, E1_ITEMS);
    return 0;
  };

  const lookCmd: Command["run"] = (a, io) => {
    const run = runDir(a);
    if (existsSync(lookPath(run))) fail("E_USAGE", "the interim look was already taken (" + lookPath(run) + "); it is taken once");
    const src = source(a);
    const d = drawOf(run);
    const f = comparisonOf(run);
    const order = f.units;
    const half = order.slice(0, Math.floor(order.length * E1.look.fraction));
    const cells = cellsFor(run, src, half);
    const want = e1Cells(d.seed, half).filter((c) => !leftOut(f, c.arm, c.model) && (!existsSync(reviewRecordPath(run, c)) || !existsSync(buildRecordPath(run, c))));
    if (want.length) fail("E_USAGE", "the look waits on " + want.length + " cells of its units that are not terminal yet (first " + cellKey(want[0]!) + ")");
    const l = look(order, cells, bootstrapSeed(run), seams.draws, f.leftOut);
    if (!l.ready) fail("E_USAGE", "the look is not ready: " + l.missing.length + " cells missing");
    const file: LookFile = { stop: l.stop, units: l.units, CN: l.CN, PN: l.PN, exposedOn: l.exposedOn, at: new Date().toISOString() };
    mkdirSync(dirname(lookPath(run)), { recursive: true });
    writeFileSync(lookPath(run), JSON.stringify(file, null, 1) + "\n", { flag: "wx" });
    const upper = (x: typeof l.CN) => (x ? "upper bound " + x.hi.toFixed(1) : "no reading");
    io.out("look on " + l.units.length + " units: C minus N " + (l.stop ? fmt(l.CN) : upper(l.CN)) + "; P minus N " + (l.stop ? fmt(l.PN) : upper(l.PN)) + "; C exposed on " + (l.exposedOn.C.join(", ") || "no model") + ", P on " + (l.exposedOn.P.join(", ") || "no model"));
    for (const arm of ["C", "P"] as E1Arm[]) io.out(arm + " at the look: " + RUNS_ON[arm].map((m) => {
      const s = armState(cells, arm, m);
      return m + " exposure " + (s.scoredExposure ?? 0).toFixed(2) + ", gaps " + s.gapShare.toFixed(2);
    }).join("; "));
    if (l.stop)
      for (const i of E1_ITEMS.filter((x) => /^e1-[cp]-/.test(x.item))) {
        const sp = join(run, "state", i.item + ".json");
        const s = readJson<{ finished: boolean }>(sp);
        if (s && !s.finished) writeFileSync(sp, JSON.stringify({ ...s, finished: true }) + "\n");
      }
    io.out(l.stop ? "STOP: C and P stop their remaining cells for futility; their figures above print as description only" : "CONTINUE: every arm runs its second half; the look prints only the two upper bounds and exposure, and keeps its full readings in " + lookPath(run));
    return 0;
  };

  const read: Command["run"] = (a, io) => {
    const run = runDir(a);
    const src = source(a);
    const d = drawOf(run);
    const f = comparisonOf(run);
    const l = readJson<LookFile>(lookPath(run));
    const stopped = new Set<E1Arm>(l?.stop ? ["C", "P"] : []);
    const owed = e1Cells(d.seed, f.units).filter((c) => !leftOut(f, c.arm, c.model) && !(stopped.has(c.arm) && !existsSync(reviewRecordPath(run, c)) && !existsSync(buildRecordPath(run, c))) && (!existsSync(reviewRecordPath(run, c)) || !existsSync(buildRecordPath(run, c))));
    if (owed.length) fail("E_USAGE", "the readings wait on " + owed.length + " comparison cells with no review or build record yet (first " + cellKey(owed[0]!) + "); nothing was read");
    const cells = cellsFor(run, src, f.units, stopped);
    const seed = bootstrapSeed(run);
    io.out("comparison: " + f.units.length + " units, digest " + f.digest + (f.leftOut.length ? "; left out after the pilot: " + f.leftOut.map((x) => x.arm + " on " + x.model).join(", ") : ""));
    const draws = seams.draws;
    const r = readAll(cells, seed, draws);
    const r0 = readAll(cells, seed, draws, true);
    for (const m of ["opus", "sol", "particle"] as E1Model[]) for (const arm of Object.keys(RUNS_ON) as E1Arm[]) {
      if (!RUNS_ON[arm].includes(m)) continue;
      const s = armState(cells, arm, m);
      const recs = e1Cells(d.seed, f.units).filter((c) => c.arm === arm && c.model === m).map((c) => readJson<E1ReviewRecord>(reviewRecordPath(run, c))).filter((x): x is E1ReviewRecord => x !== null);
      const stops = ", refusals " + recs.filter((x) => x.stop === "refusal").length + ", safety stops " + recs.filter((x) => x.stop === "safety").length + ", plan left unchanged " + recs.filter((x) => x.planUnchanged === true).length;
      io.out("arm " + arm + " on " + m + ": " + (leftOut(f, arm, m) ? "left out after the pilot" : s.cells + " cells, " + s.gaps + " gaps, exposure " + (s.exposure === null ? "n/a" : s.exposure.toFixed(2)) + stops + (s.untested ? ", UNTESTED" : "")));
    }
    for (const [k, v] of Object.entries(r)) io.out(k + ": " + fmt(v) + "; gaps scored 0: " + fmt(r0[k as keyof typeof r0]));
    const h = holm((["DN", "CN", "PN", "GN"] as const).map((k) => ({ key: k, p: r[k]?.p ?? null, held: stopped.has(k[0] as E1Arm) })));
    for (const x of h) io.out("Holm " + x.key + ": adjusted p " + x.adjusted.toFixed(3) + (x.missing ? ", no reading (kept at p 1)" : "") + (stopped.has(x.key[0] as E1Arm) ? ", stopped for futility" : "") + (x.rejects ? ", rejects" : ""));
    const dec = decide({ cells, r, stopped, units: f.units.length });
    for (const row of dec.rows) io.out("ROW " + row);
    io.out("eval 4: " + dec.eval4);
    return 0;
  };

  const screen: Command["run"] = async (a, io) => {
    const run = runDir(a);
    const src = source(a);
    const p = paid(a, run, "pilot", (item) => item === "e1-supply");
    const units = drawUnits(run, src);
    const seed = drawSeed(run);
    const walk = e1Draw(seed, units.map((u) => (u.authoring === "passed" ? { ...u, screen: u.screen ?? SCREEN_OWED } : u)));
    const order = [...walk.calibration, ...walk.comparison, ...walk.reserve, ...walk.skipped.map((s) => s.id)];
    const todo = order.filter((id) => units.find((u) => u.id === id)!.authoring === "passed" && !existsSync(screenPath(run, id))).slice(0, a.flags.has("--limit") ? whole(a, "--limit", 1) : undefined);
    const gate = e1Gate(p, run);
    await paidStage(p, seams.supply({ out: join(run, "e1", "screen", "meter"), cacheDir: need(a, "--cache") }), (call) =>
      runGated(todo, {
        gate,
        parallel: whole(a, "--parallel", 1),
        kind: () => "call",
        key: (id) => "screen:" + id,
        run: async (id) => {
          const m = src.material(id);
          const dir = join(run, "author", id);
          const r = await screenUnit(call, { message: m.fix.message, diff: m.fix.diff, hint: readFileSync(join(dir, "hint.txt"), "utf8").trim(), plan: readFileSync(join(dir, "plan.md"), "utf8"), stubbed: m.stubbed, callers: m.callers });
          return { costUsd: r.costUsd, commit: () => {
            mkdirSync(dirname(screenPath(run, id)), { recursive: true });
            writeFileSync(screenPath(run, id), JSON.stringify(r) + "\n");
          } };
        },
      }),
    );
    const done = drawUnits(run, src).flatMap((u) => (u.screen ? [u.screen] : []));
    const k = stateAgreement(done);
    io.out("screened " + todo.length + " now, " + done.length + " in all: " + done.filter((s) => s.state.eligible).length + " state-shaped, " + done.filter((s) => s.drop === null).length + " passing both screens; kappa defect " + (k.defect?.toFixed(2) ?? "n/a") + ", state-shaped " + (k.stateShaped?.toFixed(2) ?? "n/a") + " over " + k.n);
    return 0;
  };

  const author: Command["run"] = async (a, io) => {
    const run = runDir(a);
    const src = source(a);
    const step = need(a, "--step");
    if (step !== "calls" && step !== "hinted") fail("E_USAGE", "--step is calls or hinted");
    const p = paid(a, run, "pilot", (item) => item === "e1-supply");
    const log = logTo(io);
    const dirOf = (id: string) => join(run, "author", id);
    const all = drawUnits(run, src);
    const standIn = e1Draw(drawSeed(run), all.map((u) => (u.authoring === "owed" ? { ...u, authoring: "passed" as const, screen: u.screen ?? SCREEN_OWED } : u.authoring === "passed" ? { ...u, screen: u.screen ?? SCREEN_OWED } : u)));
    const isOwed = new Set(all.filter((u) => u.by !== "attempt3" && u.authoring !== "dropped").map((u) => u.id));
    const owed = [...standIn.calibration, ...standIn.comparison, ...standIn.reserve].filter((id) => isOwed.has(id));
    const limit = a.flags.has("--limit") ? whole(a, "--limit", 1) : undefined;
    const gate = e1Gate(p, run);
    if (step === "calls") {
      const todo = owed.filter((id) => !existsSync(join(dirOf(id), "calls.json"))).slice(0, limit);
      await paidStage(p, seams.author({ out: join(run, "e1", "author", "meter"), cacheDir: need(a, "--cache") }), async (call) => {
        for (const id of todo) {
          const r = await authorCalls(src.material(id), unitCall(gate, call, id));
          mkdirSync(dirOf(id), { recursive: true });
          if (r.plan !== null) writeFileSync(join(dirOf(id), "plan.md"), r.plan + "\n");
          if (r.hint !== null) writeFileSync(join(dirOf(id), "hint.txt"), r.hint + "\n");
          writeFileSync(join(dirOf(id), "calls.json"), JSON.stringify({ ...r.record, writer: WAVE2_AUTHOR_MODELS.writer }) + "\n");
          log("author " + id + ": " + (r.record.drop ? "dropped (" + r.record.drop + ")" : "plan, hint and ratings " + r.record.foresee!.join(", ")) + ", $" + r.record.costUsd.toFixed(2));
        }
      });
      io.out("authoring calls on " + todo.length + " units, " + owed.filter((id) => !existsSync(join(dirOf(id), "calls.json"))).length + " still owed");
      return 0;
    }
    const todo = owed.filter((id) => readJson<{ drop: string | null }>(join(dirOf(id), "calls.json"))?.drop === null && !existsSync(join(dirOf(id), "hinted.json"))).slice(0, limit);
    const units = new Map(src.units().map((u) => [u.id, u]));
    const grader = await seams.grader({ work: need(a, "--work"), log });
    const driver = join(run, "e1", "author", "driver");
    const opened = driverCells(driver, E1_RUN);
    const key = (id: string) => buildKey(id, "hinted", null, 1);
    await paidStage(p, seams.build({ out: join(run, "e1", "author", "rig"), driver, src, units: need(a, "--units"), repos: need(a, "--repos"), ids: todo, cells: todo.map(key), a, reviewed: false }), (session) =>
      runGated(todo, {
        gate,
        parallel: whole(a, "--parallel", 1),
        kind: () => "build",
        key,
        run: async (id) => {
          const b = await runPlantedBuild({ unit: units.get(id)!, unitDir: src.dir(id), arm: "hinted", reviewer: null, rep: 1, note: src.note(id), hint: readFileSync(join(dirOf(id), "hint.txt"), "utf8").trim(), mount: { plan: join(dirOf(id), "plan.md"), review: null }, session, grader, earlier: opened.get(key(id))?.opens ?? 0, marker: join(dirOf(id), "hinted.grade-error"), log });
          return {
            costUsd: b.costUsd,
            commit: () => {
              mkdirSync(join(run, "e1", "author", "builds"), { recursive: true });
              writeFileSync(join(run, "e1", "author", "builds", key(id) + ".json"), JSON.stringify(b) + "\n");
              const v = hintedVerdict(b.outcome, b.planted);
              writeFileSync(join(dirOf(id), "hinted.json"), JSON.stringify({ ...v, costUsd: b.costUsd }) + "\n");
              log("hinted " + id + ": " + (v.drop ? "dropped (" + v.drop + ")" : "winnable"));
            },
          };
        },
      }),
    );
    io.out("hinted builds on " + todo.length + " units");
    return 0;
  };

  const draw: Command["run"] = (a, io) => {
    const run = runDir(a);
    const d = e1Draw(drawSeed(run), drawUnits(run, source(a)));
    const old = readJson<E1Draw>(join(run, "e1", "draw.json"));
    for (const set of ["calibration", "comparison", "reserve"] as const)
      if (old && old[set].some((id, i) => d[set][i] !== id)) fail("E_USAGE", "the draw would change its " + set + " set, which only grows; nothing written");
    const frozen = readJson<E1Comparison>(comparisonPath(run));
    if (frozen && d.comparison.join("\n") !== frozen.units.join("\n")) fail("E_USAGE", "the comparison was frozen (" + comparisonPath(run) + ") and the draw would change it; nothing written");
    mkdirSync(join(run, "e1"), { recursive: true });
    writeFileSync(join(run, "e1", "draw.json"), JSON.stringify(d, null, 1) + "\n");
    const why = new Map<string, number>();
    for (const s of d.skipped) why.set(s.reason, (why.get(s.reason) ?? 0) + 1);
    io.out("draw: calibration " + d.calibration.length + " of " + E1.units.calibration + ", comparison " + d.comparison.length + " of " + E1.units.target + " (floor " + E1.units.floor + "), reserve " + d.reserve.length + " of " + E1.units.reserve + "; skipped " + ([...why].map(([r, n]) => r + " " + n).join(", ") || "none") + (d.waiting ? "; the walk waits on a unit owed its authoring or screen" : "; the walk is complete"));
    return 0;
  };

  const freeze: Command["run"] = (a, io) => {
    const run = runDir(a);
    if (existsSync(comparisonPath(run))) fail("E_USAGE", "the comparison is already frozen (" + comparisonPath(run) + "); it is frozen once");
    const d = drawOf(run);
    if (d.comparison.length < E1.units.floor || d.comparison.length > E1.units.target) fail("E_USAGE", "the draw holds " + d.comparison.length + " comparison units; the freeze needs " + E1.units.floor + " to " + E1.units.target + "; nothing written");
    const out: E1Comparison["leftOut"] = [];
    for (const x of (a.flags.get("--leave-out") ?? "").split(",").filter(Boolean)) {
      const q = parseItem("e1-" + x.toLowerCase()) ?? fail("E_USAGE", "--leave-out takes arm-model pairs such as p-particle, not " + x);
      out.push(q);
    }
    const file: E1Comparison = { units: d.comparison, leftOut: out, digest: comparisonDigest(d.comparison, out), at: new Date().toISOString() };
    mkdirSync(dirname(comparisonPath(run)), { recursive: true });
    writeFileSync(comparisonPath(run), JSON.stringify(file, null, 1) + "\n", { flag: "wx" });
    io.out("comparison frozen: " + file.units.length + " units, digest " + file.digest + (out.length ? ", left out " + out.map((x) => x.arm + " on " + x.model).join(", ") : ", no pair left out"));
    return 0;
  };

  const pilot: Command["run"] = (a, io) => {
    const run = runDir(a);
    const src = source(a);
    const d = drawOf(run);
    const byId = new Map(src.units().map((u) => [u.id, u]));
    const keys = e1Cells(d.seed, d.calibration, 1);
    const reviewsOf = keys.map((c) => readJson<E1ReviewRecord>(reviewRecordPath(run, c))).filter((x): x is E1ReviewRecord => x !== null);
    const buildsOf = keys.map((c) => readJson<E1Build>(buildRecordPath(run, c))).filter((x): x is E1Build => x !== null);
    const nAudit: Partial<Record<E1Model, number>> = {};
    for (const c of keys.filter((k) => k.arm === "N")) nAudit[c.model] = (nAudit[c.model] ?? 0) + readAudit(run, c);
    const lines = pilotReadout(reviewsOf, buildsOf, byId, keys.length, bootstrapSeed(run), { calibration: d.calibration.length, supply: d.comparison.length, nAudit });
    for (const l of lines.lines) io.out(l);
    const pj = { builds: buildsOf.filter((b) => b.arm === "N" && !isGap(b)).map((b) => ({ unit: b.unit, repo: byId.get(b.unit)!.repo, model: b.model, avoid: avoid(asGraded(b), byId.get(b.unit)!), catch: catchScore(asGraded(b)) })), unforeseeable: 0 };
    writeFileSync(join(run, "e1", "pilot.json"), JSON.stringify(pj) + "\n");
    io.out("power.py's input: " + join(run, "e1", "pilot.json") + " (uv run -q --with numpy python lanes/eng-planted/e1/power.py --fit it --design " + d.comparison.length + ":3 --design " + d.comparison.length + ":2, with the model counts each contrast still pools after the pilot)");
    return lines.ok ? 0 : 3;
  };

  return {
    "e1-ledger": { bools: ["--projection"], usage: "[--projection --run <dir> --crew-usd <usd> --hosts-usd <usd>]", summary: "eval 1's ledger lines, or its all-in projection", run: ledger },
    "e1-reviews": { bools: [], usage: "--run <dir> --units <dir> --repos <dir> --phase pilot|comparison [--half 1|2] --item <item> --cap-usd <usd> --ledger-record <dir> --ledger <file> --crew-usd <usd> --hosts-usd <usd> [--pstack <harness dir>] [--p-command /statechart|/pstack:statechart] [--parallel <n>]", summary: "eval 1's review cells of one item (or every pair in the pilot) under one lease each", run: reviews },
    "e1-builds": { bools: [], usage: "--run <dir> --units <dir> --repos <dir> --phase pilot|comparison [--half 1|2] --item <item> <paid flags> --work <dir> --host <ip> --envelope-host <id> --sidecar <url> [--harbor <bin>] [--parallel <n>]", summary: "eval 1's build cells of one item under one lease", run: builds },
    "e1-look": { bools: [], usage: "--run <dir> --units <dir> --repos <dir>", summary: "eval 1's one interim look (futility only), written once", run: lookCmd },
    "e1-read": { bools: [], usage: "--run <dir> --units <dir> --repos <dir>", summary: "eval 1's readings: arm states, the pooled contrasts, Holm and the Decision rows", run: read },
    "e1-screen": { bools: [], usage: "--run <dir> --units <dir> --repos <dir> --cache <dir> --item e1-supply <paid flags> [--limit <n>] [--parallel <n>]", summary: "eval 1's state and reach screens on authored units, in the walk's order, under the supply item", run: screen },
    "e1-author": { bools: [], usage: "--run <dir> --units <dir> --repos <dir> --step calls|hinted --item e1-supply <paid flags> [--cache <dir>] [--work <dir> --host <ip> --envelope-host <id> --sidecar <url>] [--limit <n>] [--parallel <n>]", summary: "this run's authoring at GPT-6.2 Sol, in seeded order, under the supply item: the calls, then the hinted builds", run: author },
    "e1-draw": { bools: [], usage: "--run <dir> --units <dir> --repos <dir>", summary: "eval 1's draw from the screens: calibration, comparison and reserve, each only growing", run: draw },
    "e1-freeze": { bools: [], usage: "--run <dir> [--leave-out <arm>-<model>,...]", summary: "eval 1's comparison units and the pairs the pilot left out, frozen once before any counted cell", run: freeze },
    "e1-pilot": { bools: [], usage: "--run <dir> --units <dir> --repos <dir>", summary: "eval 1's pilot readout per arm and model", run: pilot },
  };
}

export const E1_COMMANDS = e1Commands();
