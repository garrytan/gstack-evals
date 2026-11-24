// Copyright (c) 2026 Garry Tan. MIT License.
// gstack-evals ep subcommands from the stages part (authoring, the review arms, the builds, the ledger and the driven launch). The lane's cli.ts merges every part's table.
//
// Every paid command runs under one lease on its line item (eng-build's underLease) and every session passes the item's
// gate (ledger.ts). A paid command needs the item, the lease's amount (at most the plan's cap for the item), the ledger
// record and file, and the running crew and host figures for the all-in projection; it refuses before any lease opens
// when one is missing. The launchers are seams (Seams below): the real ones are the product-value meter for authoring
// calls, eng-build's review launcher with both skill arms at the restore pin, and eng-build's build launcher with each
// cell's mounts; the dry run and the tests pass stub launchers on a temporary ledger.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { EbError } from "../../eng-build/errors.ts";
import { armName } from "../../eng-build/build-stage.ts";
import { buildLauncher, reviewLauncher } from "../../eng-build/launch.ts";
import { underLease, type Launcher, type Paid, type ReviewSession } from "../../eng-build/pipeline.ts";
import { addSpend } from "../../eng-build/spend.ts";
import { claudePin } from "../../eng-build/session-image.ts";
import { MeterError, MODELS, openMeter, type ModelKey } from "../../product-value/meter.ts";
import { LedgerError, readItem } from "../../../src/runner/ledger/record.ts";
import type { DigestPin } from "../../../src/trial/review/eng-review.ts";
import { plantedGrader } from "../construct/grade.ts";
import { EpError, fail, notBuilt } from "../errors.ts";
import { FROZEN, SIZE } from "../frozen.ts";
import type { Command, PlantedGrader, ReviewArm } from "../types.ts";
import { armCheckoutProblems, EB_ARM, plainArmProblems, plantedArmSpec, SKILL_ARMS, skillPin } from "./arms.ts";
import { judgeAll, loadPrompts, NAMED_PROMPT, NAMED_PROMPT_R1, ROLE_EFFORT, ROLE_MODEL, type JudgeCall, type JudgeRole } from "../readings/judge.ts";
import type { AuthorCall } from "./author.ts";
import { buildKey, ebSession, type MountTable, type PlantedSession } from "./build.ts";
import { allInProjection, checkAllIn, ITEMS, itemOf, ItemGate, runSteps, settleThrown, type AllIn, type Kind } from "./ledger.ts";
import { ALLOWANCE_USD, AUTHOR_MAX_TOKENS, AUTHOR_MODELS, CARBON_MAX_TOKENS, EP_PROGRAM, EP_RUN, EP_SKILL, JUDGE_MAX_TOKENS, readStep, type AuthorRole } from "./local.ts";
import { PIN_COMMAND } from "./pin.ts";
import { driverCells, owedOnRefusal, setAsideRefusedGaps, stagePlan } from "./rerun-log.ts";
import { authorStep, batchDraw, buildCells, buildsStage, bundleInput, comparisonPlanned, comparisonUnits, gateArms, goldBundles, hintedTodo, poolOrder, reviewsStage, runRecords, smokeStage, unitFolders, type AuthorStep, type BundleRef, type UnitSource } from "./pipeline.ts";
import { bundleSet } from "../readings/judge.ts";

export { CASES as DRY_CASES } from "./cases.ts";

type Args = Parameters<Command["run"]>[0];
type Io = Parameters<Command["run"]>[1];

const need = (a: Args, flag: string): string => a.flags.get(flag) ?? fail("E_USAGE", "missing " + flag);
const whole = (a: Args, flag: string, dflt: number): number => {
  const v = a.flags.has(flag) ? Number(a.flags.get(flag)) : dflt;
  if (!Number.isSafeInteger(v) || v < 1) fail("E_USAGE", flag + " takes a whole number from 1");
  return v;
};
const logTo = (io: Io) => (l: string) => (/^E_[A-Z_]+ /.test(l) ? io.err : io.out)(l);

// ---------------------------------------------------------------------------------------------------------------------
// Paid flags and the item gate.

/** The items each paid command may spend from. */
export const STAGE_ITEMS = { author: ["ep-authoring"], smoke: ["ep-smoke"], reviews: ["ep-comparison"], builds: ["ep-comparison", "ep-stock"], judge: ["ep-judge"] } as const;
export const PAID = "--item <item> --cap-usd <usd> --ledger-record <dir> --ledger <file> --crew-usd <usd> --hosts-usd <usd>";

export interface PlantedPaid extends Paid {
  allIn: AllIn;
}

/** A paid command's flags, refused before any lease opens: the item must be the stage's, the lease's amount at most the
 * plan's cap for the item, and the crew and host figures present for the all-in projection. */
export function plantedPaid(stage: keyof typeof STAGE_ITEMS, a: Args, run: string): PlantedPaid {
  const missing = ["--item", "--cap-usd", "--ledger-record", "--ledger", "--crew-usd", "--hosts-usd"].filter((f) => !a.flags.get(f));
  if (missing.length) fail("E_USAGE", "the paid " + stage + " stage runs only under a ledger lease with the all-in figures; it needs " + missing.join(", ") + ", and nothing ran");
  const item = a.flags.get("--item")!;
  const allowed: readonly string[] = STAGE_ITEMS[stage];
  if (!allowed.includes(item)) fail("E_USAGE", "the " + stage + " stage spends from " + allowed.join(" or ") + ", not " + item);
  const capUsd = Number(a.flags.get("--cap-usd"));
  const plan = itemOf(item).capUsd;
  if (!Number.isFinite(capUsd) || capUsd <= 0 || capUsd > plan) fail("E_USAGE", "--cap-usd " + a.flags.get("--cap-usd") + " is not a positive amount at or under item " + item + "'s plan cap of $" + plan);
  const figure = (f: string) => {
    const v = Number(a.flags.get(f));
    return Number.isFinite(v) && v >= 0 ? v : fail("E_USAGE", f + " takes the running figure in dollars, not " + a.flags.get(f));
  };
  return { item, capUsd, record: a.flags.get("--ledger-record")!, ledger: a.flags.get("--ledger")!, allIn: { stateDir: join(run, "state"), crewUsd: figure("--crew-usd"), hostsUsd: figure("--hosts-usd") } };
}

/** The item's gate over the run: the item's recorded cap, its cost journal in the run, and the all-in figures. */
export function itemGate(p: PlantedPaid, run: string, planned?: Partial<Record<Kind, number>>): ItemGate {
  const cap = readItem(p.record, p.item).cap_micros;
  if (!cap) return fail("E_USAGE", "line item " + p.item + " has no recorded cap in " + p.record + "; ep ledger prints the init lines");
  return new ItemGate(itemOf(p.item), { capUsd: cap / 1_000_000, planned, journal: join(run, "costs", p.item + ".jsonl"), allIn: p.allIn });
}

/** Runs body under one lease on the item, after the all-in check. */
async function paidStage<B, T>(p: PlantedPaid, launch: Launcher<B>, body: (backend: B) => Promise<T>): Promise<T> {
  checkAllIn(p.allIn);
  return underLease(p, launch, (b) => body(b));
}

// ---------------------------------------------------------------------------------------------------------------------
// Seams: the real launchers.

/** A model call by role through the meter, with what it cost. */
export type Metered<R extends string> = (role: R, prompt: string, attempt?: number) => Promise<{ text: string; costUsd: number }>;

/** The outcome driver's run directory for every build stage of a run. The ledger binds a run to the directory of its first
 * driver lease, so the authoring, comparison and stock builds share one (dated pre-run fix, 2026-11-17). */
export const buildDriver = (run: string): string => join(run, "builds", "driver");

/** The meter route each authoring role calls; null where the product-value meter has no route yet. */
export const AUTHOR_ROUTES: Readonly<Record<AuthorRole, ModelKey | null>> = { writer: "sol", audit: "opus", hint: "sol", hintAudit: "opus", raterCarbon: "carbon", raterOpus: "opus" };
/** The meter route each judge role calls (readings/judge.ts ROLE_MODEL). */
export const JUDGE_ROUTES: Readonly<Record<JudgeRole, ModelKey | null>> = { judge: "astra", "gold-opus": "opus", "gold-gemini": "carbon" };

/** Why a role cannot call its model through the meter, one line each. */
export function routeProblems<R extends string>(models: Readonly<Record<R, string>>, routes: Readonly<Record<R, ModelKey | null>>, roles: readonly R[] = Object.keys(models) as R[]): string[] {
  return roles.flatMap((role) => {
    const k = routes[role];
    if (k === null) return [role + ": the product-value meter has no route for " + models[role]];
    const m = MODELS[k];
    const id = (m.provider === "anthropic" ? "anthropic/" : m.provider === "openai" ? "openai/" : "") + m.id;
    return id === models[role] ? [] : [role + ": meter route " + k + " calls " + id + ", not " + models[role]];
  });
}
export const authorRouteProblems = (routes: Readonly<Record<AuthorRole, ModelKey | null>> = AUTHOR_ROUTES): string[] => routeProblems(AUTHOR_MODELS, routes);
const CARBON_FIX = "add a carbon ModelKey (google/gemini-4-carbon on OpenRouter, pinned to Google) to lanes/product-value/meter.ts, its price row to src/runner/pricing/prices.ts, and its route here";

/** A meter launcher for one set of role routes: it refuses before any lease opens when a role it will call has no
 * route. A call costs what its meter holds, spent plus unknown; an answered call whose cost the meter could not read
 * counts at the call allowance, so the gate never undercounts, and a refusal the proxy answered before it reserved
 * anything costs nothing. A call that billed and then failed (a non-200 answer, no text, a provider drift stop, a stream
 * that ended with an error event) throws
 * with that cost on its error (spend.ts), which the gated callers settle. A role routed to Carbon asks for
 * CARBON_MAX_TOKENS; every other role asks for maxTokens. effort is one setting for every role, or one per role. fetch
 * and env reach the meter for the keyless tests. */
export function meterLauncher<R extends string>(o: { out: string; cacheDir: string; maxTokens: number; effort: string | null | Readonly<Record<R, string | null>>; label: string; models: Readonly<Record<R, string>>; routes: Readonly<Record<R, ModelKey | null>>; roles: readonly R[]; fetch?: typeof fetch; env?: Record<string, string | undefined>; runId?: string }): Launcher<Metered<R>> {
  return async (p) => {
    const problems = routeProblems(o.models, o.routes, o.roles);
    if (problems.length) return fail("E_EP_NOT_BUILT", "the " + o.label + " routes are not all built, so no lease opened:\n" + problems.join("\n") + "\n" + CARBON_FIX);
    const capOf = (role: R) => (o.routes[role] === "carbon" ? CARBON_MAX_TOKENS : o.maxTokens);
    const meter = await openMeter({ item: p.item, runId: o.runId ?? EP_RUN, out: o.out, cacheDir: o.cacheDir, maxOutputTokens: Math.max(...o.roles.map(capOf)), amountMicros: Math.round(p.capUsd * 1_000_000), record: p.record, ledger: p.ledger, ...(o.fetch ? { fetch: o.fetch } : {}), ...(o.env ? { env: o.env } : {}) });
    const call: Metered<R> = async (role, prompt, attempt) => {
      if (!o.roles.includes(role)) return fail("E_USAGE", "this launch did not check the route for " + role);
      let r: Awaited<ReturnType<typeof meter.call>>;
      try {
        r = await meter.call({ model: o.routes[role]!, prompt, maxTokens: capOf(role), effort: typeof o.effort === "string" || o.effort === null ? o.effort : o.effort[role], label: o.label + ":" + role, ...(attempt ? { attempt } : {}) });
      } catch (e) {
        throw e instanceof MeterError && (e.code === "E_PV_PROVIDER_DRIFT" || e.code === "E_PV_STREAM_ERROR") ? addSpend(e, ALLOWANCE_USD.call) : e;
      }
      const costUsd = r.cached ? 0 : r.micros === null ? (r.status === 200 ? ALLOWANCE_USD.call : 0) : (r.micros + (r.unknown_micros ?? 0)) / 1_000_000;
      if (r.status !== 200 || r.text === null) throw addSpend(new EpError("E_USAGE", "the " + o.label + " " + role + " call ended " + r.status + (r.problem ? " (" + r.problem + ")" : "") + "; rerun the step, which reuses the meter's cached replies"), costUsd);
      return { text: r.text, costUsd };
    };
    return { lease_id: meter.leaseId, backend: call, close: async () => void (await meter.close()) };
  };
}

/** A judge call that waits for the judge item's gate and settles its cost there, under the role and the prompt's digest,
 * so a resume that repeats a cached call counts one cell. A call that spent and threw settles as a failed line. An empty
 * reply is a failed call too: it settles as a failed line and is asked once more as attempt 2, a fresh call the meter
 * caches apart; a second empty reply is returned empty, and the judge records it as the bundle's error. */
export function gatedJudge(gate: ItemGate, call: Metered<JudgeRole>): JudgeCall {
  return async (role, prompt) => {
    const cell = role + ":" + createHash("sha256").update(prompt).digest("hex").slice(0, 16);
    const ask = async (attempt?: number) => {
      await gate.acquire("call");
      let r: { text: string; costUsd: number };
      try {
        r = await call(role, prompt, attempt);
      } catch (e) {
        throw settleThrown(gate, "call", e, cell);
      }
      gate.settle("call", r.costUsd, cell, !r.text.trim());
      return r.text;
    };
    const first = await ask();
    return first.trim() ? first : ask(2);
  };
}

export interface Seams {
  author(o: { out: string; cacheDir: string }): Launcher<AuthorCall>;
  /** The judged secondary's calls (readings/judge.ts): GPT-6 Astra and the two gold labellers, each at its ROLE_EFFORT. */
  judge(o: { out: string; cacheDir: string; roles: JudgeRole[] }): Launcher<Metered<JudgeRole>>;
  /** pin is null when no skill arm runs (the pilot). */
  review(o: { out: string; arms: ReviewArm[]; pin: DigestPin | null; policy?: string; log: (l: string) => void }): Launcher<ReviewSession>;
  /** driver is the outcome driver's run directory, one for every build stage of the run (buildDriver); cells are the keys
   * of the cells the stage may open, which the driver's planned sessions and reruns count (rerun-log.ts stagePlan). */
  build(o: { out: string; driver: string; src: UnitSource; units: string; repos: string; ids: string[]; reviewed: boolean; cells: string[]; a: Args }): Launcher<PlantedSession>;
  grader(o: { work: string; log: (l: string) => void }): Promise<PlantedGrader>;
}

export const REAL: Seams = {
  author: (o) => meterLauncher({ ...o, maxTokens: AUTHOR_MAX_TOKENS, effort: null, label: "ep-author", models: AUTHOR_MODELS, routes: AUTHOR_ROUTES, roles: Object.keys(AUTHOR_MODELS) as AuthorRole[] }),
  judge: (o) => meterLauncher({ ...o, maxTokens: JUDGE_MAX_TOKENS, effort: ROLE_EFFORT, label: "ep-judge", models: ROLE_MODEL, routes: JUDGE_ROUTES }),
  review: (o) => reviewLauncher({ arms: o.arms.map((a) => EB_ARM[a]), reviewer: "opus", out: o.out, env: process.env, log: o.log, ...(o.pin ? { pins: { precut: o.pin, engphase: o.pin } } : {}), runId: EP_RUN, ...(o.policy ? { policy: o.policy } : {}) }),
  build: (o) => {
    const table: MountTable = new Map();
    const mountOf = (cell: string) => table.get(cell) ?? fail("E_USAGE", "cell " + cell + " has no mounts filed; only ebSession starts a planted build");
    const arm = o.reviewed ? "plain" : "none";
    const plan = stagePlan(o.driver, EP_RUN, armName(arm), o.cells);
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
      runId: EP_RUN,
      skill: EP_SKILL,
      serve: { dir: o.driver, unheld_ok: true, reruns: plan.reruns },
      stripBase: true,
      ...(o.a.flags.has("--harbor") ? { harbor: o.a.flags.get("--harbor")! } : {}),
    });
    return async (p) => {
      const h = await inner(p);
      return { ...h, backend: owedOnRefusal(ebSession(h.backend, table), o.driver, EP_RUN, join(o.out, "sessions")) };
    };
  },
  grader: async (o) => plantedGrader({ work: o.work }),
};

// ---------------------------------------------------------------------------------------------------------------------
// Commands.

const RUN = "--run <dir outside the repository> --units <units dir> --repos <B trees dir>";
const BUILD = "--work <dir> --host <ip> --envelope-host <id> --sidecar <url> [--harbor <bin>]";
const REPO = resolve(import.meta.dir, "..", "..", "..");
const source = (a: Args): UnitSource => unitFolders(need(a, "--units"), need(a, "--repos"));
const inside = (dir: string, path: string) => {
  const r = relative(existsSync(dir) ? realpathSync(dir) : resolve(dir), existsSync(path) ? realpathSync(path) : resolve(path));
  return r === "" || !r.startsWith("..");
};
const runDir = (a: Args): string => {
  const run = resolve(need(a, "--run"));
  if (inside(REPO, run)) fail("E_USAGE", "--run " + run + " is inside the gstack-evals repository; held-out material stays outside it");
  return run;
};

/** Converts the reused lanes' refusals (eng-build, the meter, the ledger) into the ep command's, so each prints its code. */
const ep = (run: Command["run"]): Command["run"] => async (a, io) => {
  try {
    return await run(a, io);
  } catch (e) {
    if (e instanceof EbError || e instanceof MeterError || e instanceof LedgerError) throw new EpError(e.code, e.message);
    throw e;
  }
};

/** The stages part's subcommands over a set of seams. */
export function stagesCommands(seams: Seams = REAL): Record<string, Command> {
  const author: Command["run"] = async (a, io) => {
    const run = runDir(a);
    const batch = Number(need(a, "--batch"));
    if (batch !== 1 && batch !== 2) fail("E_USAGE", "--batch is 1 or 2");
    const step = need(a, "--step") as AuthorStep;
    if (!["calls", "hinted", "draw", "none"].includes(step)) fail("E_USAGE", "--step is calls, hinted, draw or none");
    const src = source(a);
    const log = logTo(io);
    const o = { run, src, batch: batch as 1 | 2, step, chunk: a.flags.has("--chunk") ? whole(a, "--chunk", 1) : undefined, first: a.flags.get("--first")?.split(","), parallel: whole(a, "--parallel", 1), log };
    if (step === "draw") {
      io.out((await authorStep(o)).line);
      return 0;
    }
    const p = plantedPaid("author", a, run);
    const gate = itemGate(p, run);
    if (step === "calls") {
      io.out((await paidStage(p, seams.author({ out: join(run, "author", "meter"), cacheDir: need(a, "--cache") }), (call) => authorStep({ ...o, call, gate }))).line);
      return 0;
    }
    const grader = await seams.grader({ work: need(a, "--work"), log });
    const d = step === "none" ? batchDraw(run, o.batch) : null;
    const ids = step === "hinted" ? hintedTodo(run, poolOrder(run, src)) : d ? [...d.calibration, ...d.comparison, ...d.reserve] : [];
    const opened = driverCells(buildDriver(run), EP_RUN);
    const cells = ids.map((id) => buildKey(id, step === "hinted" ? "hinted" : "none", null, 1));
    io.out((await paidStage(p, seams.build({ out: join(run, "builds", "authoring", "rig"), driver: buildDriver(run), src, units: need(a, "--units"), repos: need(a, "--repos"), ids, reviewed: false, cells, a }), (session) => authorStep({ ...o, session, grader, gate, earlier: (cell) => opened.get(cell)?.opens ?? 0 }))).line);
    return 0;
  };

  const smoke: Command["run"] = async (a, io) => {
    const run = runDir(a);
    const pin = skillPin();
    const p = plantedPaid("smoke", a, run);
    const gate = itemGate(p, run);
    const recs = await paidStage(p, seams.review({ out: join(run, "reviews", "smoke", "rig"), arms: [...SKILL_ARMS], pin, policy: a.flags.get("--policy"), log: logTo(io) }), (session) => smokeStage({ run, src: source(a), gate, session, gstack: need(a, "--gstack"), pin, parallel: whole(a, "--parallel", 1), log: logTo(io) }));
    for (const arm of SKILL_ARMS) io.out("smoke " + arm + ": " + recs.filter((r) => r.arm === arm && r.exposed).length + " of " + recs.filter((r) => r.arm === arm).length + " exposed, " + recs.filter((r) => r.arm === arm && r.exposedBeforeBlock).length + " before any block");
    return 0;
  };

  const reviews: Command["run"] = async (a, io) => {
    const run = runDir(a);
    const phase = need(a, "--phase") as "pilot" | "comparison";
    if (phase !== "pilot" && phase !== "comparison") fail("E_USAGE", "--phase is pilot or comparison");
    const arms: ReviewArm[] = phase === "pilot" ? ["plain"] : ["plain", ...gateArms(run)];
    const pin = arms.length > 1 ? skillPin() : null;
    const p = plantedPaid("reviews", a, run);
    const planned = phase === "comparison" ? comparisonPlanned(comparisonUnits(run).units.length, gateArms(run)) : readStep(run, "exposure-gate") ? comparisonPlanned(SIZE.units, gateArms(run)) : undefined;
    const gate = itemGate(p, run, planned);
    const recs = await paidStage(p, seams.review({ out: join(run, "reviews", "comparison", "rig"), arms, pin, policy: a.flags.get("--policy"), log: logTo(io) }), (session) => reviewsStage({ run, src: source(a), gate, session, phase, gstack: a.flags.get("--gstack"), pin: pin ?? undefined, parallel: whole(a, "--parallel", 1), log: logTo(io) }));
    for (const arm of arms) {
      const mine = recs.filter((r) => r.arm === arm);
      io.out("reviews " + arm + ": " + mine.length + " recorded, " + mine.filter((r) => r.outcome === "upstream_gap" || r.outcome === "infra_gap").length + " gaps, $" + mine.reduce((s, r) => s + r.costUsd, 0).toFixed(2));
    }
    return 0;
  };

  const builds: Command["run"] = async (a, io) => {
    const run = runDir(a);
    const phase = need(a, "--phase") as "pilot" | "comparison" | "stock";
    if (phase !== "pilot" && phase !== "comparison" && phase !== "stock") fail("E_USAGE", "--phase is pilot, comparison or stock");
    const p = plantedPaid("builds", a, run);
    if ((phase === "stock") !== (p.item === "ep-stock")) fail("E_USAGE", "the " + phase + " builds spend from " + (phase === "stock" ? "ep-stock" : "ep-comparison") + ", not " + p.item);
    const src = source(a);
    const log = logTo(io);
    const cells = buildCells(run, phase);
    const planned = phase === "stock" || !readStep(run, "exposure-gate") ? undefined : comparisonPlanned(phase === "comparison" ? comparisonUnits(run).units.length : SIZE.units, gateArms(run));
    const gate = itemGate(p, run, planned);
    const grader = await seams.grader({ work: need(a, "--work"), log });
    const opened = driverCells(buildDriver(run), EP_RUN);
    const done = await paidStage(p, seams.build({ out: join(run, "builds", phase === "stock" ? "stock" : "comparison", "rig"), driver: buildDriver(run), src, units: need(a, "--units"), repos: need(a, "--repos"), ids: [...new Set(cells.map((c) => c.unit))], reviewed: true, cells: cells.map((c) => buildKey(c.unit, c.arm, c.reviewer, c.rep)), a }), (session) => buildsStage({ run, src, gate, session, grader, phase, parallel: whole(a, "--parallel", 1), log, earlier: (cell) => opened.get(cell)?.opens ?? 0 }));
    io.out("builds " + phase + ": " + done.length + " of " + cells.length + " cells recorded, $" + done.reduce((s, b) => s + b.costUsd, 0).toFixed(2));
    return 0;
  };

  const ledger: Command["run"] = (a, io) => {
    if (!a.bools.has("--projection")) {
      for (const l of runSteps()) io.out(l);
      for (const i of ITEMS) io.out("# " + i.item + ": " + i.row + "; projection $" + i.projectionUsd + ", cap $" + i.capUsd);
      return 0;
    }
    const run = runDir(a);
    const allIn: AllIn = { stateDir: join(run, "state"), crewUsd: Number(need(a, "--crew-usd")), hostsUsd: Number(need(a, "--hosts-usd")) };
    if (![allIn.crewUsd, allIn.hostsUsd].every((v) => Number.isFinite(v) && v >= 0)) fail("E_USAGE", "--crew-usd and --hosts-usd take dollars");
    const r = allInProjection(allIn);
    for (const l of r.lines) io.out(l);
    io.out("all-in projection $" + r.usd.toFixed(2) + " against the $" + FROZEN.money.allInStopUsd + " stop");
    checkAllIn(allIn);
    return 0;
  };

  const lost: Command["run"] = (a, io) => {
    const run = runDir(a);
    const id = need(a, "--unit");
    const reason = need(a, "--reason").trim();
    if (!reason) fail("E_USAGE", "--reason says what was lost (an image that no longer builds)");
    const file = join(run, "lost.json");
    const list = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Array<{ id: string; reason: string }>) : [];
    if (list.some((l) => l.id === id)) fail("E_USAGE", "unit " + id + " is already recorded lost");
    const d = batchDraw(run, 2) ?? fail("E_USAGE", "no batch 2 draw in " + run);
    if (!d.comparison.includes(id)) fail("E_USAGE", "unit " + id + " is not a comparison unit of the batch 2 draw");
    writeFileSync(file, JSON.stringify([...list, { id, reason }], null, 1) + "\n");
    const r = comparisonUnits(run);
    for (const s of r.swaps) io.out("lost " + s.lost + " (" + s.reason + "), replaced by reserve " + s.by);
    io.out("comparison: " + r.units.length + " units");
    return 0;
  };

  const owed: Command["run"] = (a, io) => {
    const run = runDir(a);
    const rows = setAsideRefusedGaps(run, buildDriver(run), EP_RUN);
    for (const r of rows) io.out("owed " + r.cell + ": recorded " + r.outcome + " as a gap, but the driver opened it " + r.opens + " time" + (r.opens === 1 ? "" : "s") + (r.refusals.length ? " and refused " + r.refusals.map((x) => x.at + " " + x.code + " " + x.status + " (" + x.detail + "; trial " + x.trial + ")").join(", ") : ", and its retry never reached the driver") + "; set aside " + r.moved.join(", "));
    io.out("owed: " + rows.length + " cell" + (rows.length === 1 ? "" : "s") + " set aside; the step's next run gives each its one retry");
    return 0;
  };

  const records: Command["run"] = (a, io) => {
    const run = runDir(a);
    const r = runRecords(run, source(a));
    writeFileSync(need(a, "--out"), JSON.stringify(r, null, 1) + "\n");
    io.out("records: " + r.units.length + " units, " + r.smoke.length + " smoke sessions, " + r.reviews.length + " reviews, " + r.builds.length + " builds, " + r.hintedBuilds.length + " hinted builds, in run order");
    return 0;
  };

  const judge: Command["run"] = async (a, io) => {
    const run = runDir(a);
    const role = need(a, "--role") as JudgeRole;
    if (!(role in ROLE_MODEL)) fail("E_USAGE", "--role is " + Object.keys(ROLE_MODEL).join(", "));
    const revision = a.flags.get("--revision") ?? "0";
    if (revision !== "0" && revision !== "1") fail("E_USAGE", "--revision is 0 or 1: section 5 allows one rubric revision");
    const r = runRecords(run, source(a));
    const picked = a.flags.has("--bundles") ? (JSON.parse(readFileSync(a.flags.get("--bundles")!, "utf8")) as BundleRef[]) : bundleSet(r.units.filter((u) => u.set === "comparison"), r.reviews);
    const inputs = picked.map((b) => bundleInput(run, b));
    const p = plantedPaid("judge", a, run);
    const gate = itemGate(p, run);
    const results = await paidStage(p, seams.judge({ out: join(run, "judge", "meter"), cacheDir: need(a, "--cache"), roles: [role] }), (call) => judgeAll(inputs, gatedJudge(gate, call), role, loadPrompts(revision === "1" ? NAMED_PROMPT_R1 : NAMED_PROMPT)));
    const out = join(run, "judge", role + (revision === "1" ? "-r1" : "") + ".json");
    mkdirSync(join(run, "judge"), { recursive: true });
    writeFileSync(out, JSON.stringify(results, null, 1) + "\n");
    io.out("judge " + role + ": " + results.length + " bundles, " + results.filter((x) => x.named).length + " name the planted condition, " + results.filter((x) => x.error).length + " with an error; " + out);
    return 0;
  };

  const gold: Command["run"] = (a, io) => {
    const g = goldBundles(runDir(a), source(a));
    writeFileSync(need(a, "--out"), JSON.stringify(g.picked, null, 1) + "\n");
    const n = (f: (b: BundleRef) => boolean) => g.picked.filter(f).length;
    io.out("gold: " + g.picked.length + " bundles (smoke " + n((b) => b.smoke === true) + ", " + (["standalone", "engphase", "plain", "stock", "plan"] as const).map((s) => s + " " + n((b) => b.source === s && !b.smoke)).join(", ") + "), keyword proxy " + g.proxy.toFixed(2) + (g.short.length ? "; short: " + g.short.join(", ") : ""));
    return 0;
  };

  const preflight: Command["run"] = (a, io) => {
    const rows = preflightRows({ run: need(a, "--run"), units: need(a, "--units"), repos: need(a, "--repos"), gstack: need(a, "--gstack"), record: need(a, "--ledger-record"), harbor: a.flags.get("--harbor") ?? "harbor", docker: a.flags.get("--docker") ?? "docker" });
    for (const r of rows) (r.ok ? io.out : io.err)((r.ok ? "ok   " : "FAIL ") + r.name + ": " + r.detail);
    return rows.every((r) => r.ok) ? 0 : 2;
  };

  return {
    pin: PIN_COMMAND,
    ledger: { run: ep(ledger), bools: ["--projection"], usage: "[--projection --run <dir> --crew-usd <usd> --hosts-usd <usd>]", summary: "the program and item init lines, or the running all-in projection against the $5,000 stop" },
    preflight: { run: ep(preflight), bools: [], usage: RUN + " --gstack <checkout at the pin> --ledger-record <dir> [--harbor <bin>] [--docker <bin>]", summary: "the no-model preflight on the run host: Docker, Harbor, the pins, the plain arm, the routes, the items, the units and the run dir" },
    author: { run: ep(author), bools: [], usage: RUN + " --batch 1|2 --step calls|hinted|draw|none [--chunk n] [--first <unit,...> for calls] [--parallel n] [--cache <dir> for calls] [" + BUILD + " for hinted and none] " + PAID, summary: "authoring in seeded order: plan, audits, hint and ratings; the hinted builds; the draw; the no-review builds (paid: ep-authoring)" },
    smoke: { run: ep(smoke), bools: [], usage: RUN + " --gstack <checkout at the pin> [--parallel n] [--policy <file>] " + PAID, summary: "the exposure smoke: one Opus session per skill arm on each calibration unit (paid: ep-smoke)" },
    reviews: { run: ep(reviews), bools: [], usage: RUN + " --phase pilot|comparison [--gstack <checkout at the pin>] [--parallel n] [--policy <file>] " + PAID, summary: "the pilot's plain reviews or the comparison reviews, with the interim exposure stop (paid: ep-comparison)" },
    builds: { run: ep(builds), bools: [], usage: RUN + " --phase pilot|comparison|stock " + BUILD + " [--parallel n] " + PAID, summary: "the reviewed builds of a phase, or the stock control's (paid: ep-comparison, ep-stock)" },
    records: { run: ep(records), bools: [], usage: RUN + " --out <json>", summary: "every unit, review and build record of the run, in run order, as the readings read them" },
    judge: { run: ep(judge), bools: [], usage: RUN + " --role judge|gold-opus|gold-gemini [--bundles <json of {unit, source, rep, smoke?}>] [--revision 0|1] --cache <dir> " + PAID, summary: "the judged secondary's calls over the bundle set, or over the gold set given; --revision 1 reads section 5's revised call-2 rubric and writes <role>-r1.json (paid: ep-judge)" },
    gold: { run: ep(gold), bools: [], usage: RUN + " --out <json>", summary: "section 8's gold set over the run, with no model call: the bundles ep judge --bundles reads for the judge check" },
    owed: { run: ep(owed), bools: [], usage: "--run <dir>", summary: "set aside each build cell recorded as a gap whose retry never opened (refused, or never reaching the driver), read from the driver's log; the step's next run retries it" },
    lost: { run: ep(lost), bools: [], usage: "--run <dir> --unit <id> --reason <text>", summary: "record a comparison unit lost to infrastructure; the next reserve unit in seeded order replaces it" },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Preflight.

export interface Row {
  name: string;
  ok: boolean;
  detail: string;
}

/** The no-model preflight rows. Each runs on its own, so one failure never hides another. */
export function preflightRows(o: { run: string; units: string; repos: string; gstack: string; record: string; harbor: string; docker: string }): Row[] {
  const row = (name: string, f: () => string): Row => {
    try {
      return { name, ok: true, detail: f() };
    } catch (e) {
      return { name, ok: false, detail: (e as Error).message };
    }
  };
  const problems = (p: string[]) => {
    if (p.length) throw new Error(p.join("; "));
  };
  const tool = (bin: string, args: string[]) => {
    const r = spawnSync(bin, args, { encoding: "utf8", timeout: 60_000 });
    if (r.status !== 0) throw new Error(bin + " " + args.join(" ") + " exited " + (r.status ?? r.signal ?? r.error?.message) + (r.stderr ? ": " + r.stderr.trim().split("\n").at(-1) : ""));
    return r.stdout.trim();
  };
  return [
    row("docker", () => "server " + tool(o.docker, ["version", "--format", "{{.Server.Version}}"])),
    row("harbor", () => tool(o.harbor, ["--version"]).split("\n")[0]!),
    row("claude pin", () => JSON.stringify(claudePin())),
    row("restore pin", () => {
      const pin = skillPin();
      return pin.sha.slice(0, 9) + " VERSION " + pin.version + ", " + Object.keys(pin.digests).length + " digests";
    }),
    row("gstack checkout", () => {
      const pin = skillPin();
      const head = tool("git", ["-C", o.gstack, "rev-parse", "HEAD"]);
      if (head !== pin.sha) throw new Error(o.gstack + " is at " + head + ", not the pin " + pin.sha);
      const version = readFileSync(join(o.gstack, "VERSION"), "utf8").trim();
      if (version !== pin.version) throw new Error(o.gstack + " reads VERSION " + version + ", not " + pin.version);
      problems(SKILL_ARMS.flatMap((arm) => armCheckoutProblems(arm, o.gstack, pin)));
      return "at the pin; digests and detector strings hold for " + SKILL_ARMS.join(" and ");
    }),
    row("plain arm", () => {
      problems(plainArmProblems(plantedArmSpec("plain", null)));
      return "bare install: no gstack, no drive";
    }),
    row("authoring routes", () => {
      problems(authorRouteProblems());
      return "every role has its meter route";
    }),
    row("ledger items", () => {
      problems(
        ITEMS.flatMap((i) => {
          const s = readItem(o.record, i.item);
          if (!s.cap_micros) return [i.item + " has no recorded cap"];
          const p: string[] = [];
          if (s.cap_micros > i.capUsd * 1_000_000) p.push(i.item + " is capped at $" + s.cap_micros / 1_000_000 + ", above the plan's $" + i.capUsd);
          if (s.program !== EP_PROGRAM) p.push(i.item + " is in program " + s.program + ", not " + EP_PROGRAM);
          if (s.run_id !== null && s.run_id !== EP_RUN) p.push(i.item + " is bound to run " + s.run_id + ", not " + EP_RUN);
          if (s.open) p.push(i.item + " has an open lease " + s.open.lease_id);
          return p;
        }),
      );
      return ITEMS.length + " items inited in " + EP_PROGRAM + " at or under their plan caps, none with an open lease";
    }),
    row("units", () => {
      const src = unitFolders(o.units, o.repos);
      const list = src.units();
      if (!list.length) throw new Error(o.units + " holds no unit with ep-unit.json");
      problems(list.flatMap((u) => [...["eb.json", "ep-author.json"].filter((f) => !existsSync(join(src.dir(u.id), f))).map((f) => u.id + " has no " + f), ...(existsSync(join(src.base(u.id), ".git")) ? [] : [u.id + " has no B tree at " + src.base(u.id)])]));
      return list.length + " units with eb.json, ep-author.json and a B tree";
    }),
    row("run dir", () => {
      const run = resolve(o.run);
      if (inside(REPO, run)) throw new Error(run + " is inside the gstack-evals repository");
      if (inside(o.units, run)) throw new Error(run + " is inside the units dir, which no session may mount");
      if (!existsSync(dirname(run))) throw new Error(dirname(run) + " does not exist");
      return run;
    }),
  ];
}

export const COMMANDS: Record<string, Command> = stagesCommands();
