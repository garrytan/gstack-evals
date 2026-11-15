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
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { EbError } from "../../eng-build/errors.ts";
import { buildLauncher, reviewLauncher } from "../../eng-build/launch.ts";
import { underLease, type Launcher, type Paid, type ReviewSession } from "../../eng-build/pipeline.ts";
import { claudePin } from "../../eng-build/session-image.ts";
import { MeterError, MODELS, openMeter, type ModelKey } from "../../product-value/meter.ts";
import { LedgerError, readItem } from "../../../src/runner/ledger/record.ts";
import type { DigestPin } from "../../../src/trial/review/eng-review.ts";
import { EpError, fail, notBuilt } from "../errors.ts";
import { FROZEN, SIZE } from "../frozen.ts";
import type { Command, PlantedGrader, ReviewArm } from "../types.ts";
import { armCheckoutProblems, EB_ARM, plainArmProblems, plantedArmSpec, SKILL_ARMS, skillPin } from "./arms.ts";
import type { AuthorCall } from "./author.ts";
import { ebSession, type MountTable, type PlantedSession } from "./build.ts";
import { allInProjection, checkAllIn, ITEMS, itemOf, ItemGate, runSteps, type AllIn, type Kind } from "./ledger.ts";
import { ALLOWANCE_USD, AUTHOR_MAX_TOKENS, AUTHOR_MODELS, EP_PROGRAM, EP_RUN, EP_SKILL, readStep, type AuthorRole } from "./local.ts";
import { PIN_COMMAND } from "./pin.ts";
import { authorStep, batchDraw, buildCells, buildsStage, comparisonPlanned, comparisonUnits, drawFile, gateArms, hintedTodo, reviewsStage, smokeStage, unitFolders, type AuthorStep, type UnitSource } from "./pipeline.ts";

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
export const STAGE_ITEMS = { author: ["ep-authoring"], smoke: ["ep-smoke"], reviews: ["ep-comparison"], builds: ["ep-comparison", "ep-stock"] } as const;
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

/** The meter route each authoring role calls; null where the product-value meter has no route yet. */
export const AUTHOR_ROUTES: Readonly<Record<AuthorRole, ModelKey | null>> = { writer: "sol", audit: "opus", hint: "sol", hintAudit: "opus", raterCarbon: null, raterOpus: "opus" };

/** Why an authoring role cannot call its model through the meter, one line each. */
export function authorRouteProblems(routes: Readonly<Record<AuthorRole, ModelKey | null>> = AUTHOR_ROUTES): string[] {
  return (Object.keys(AUTHOR_MODELS) as AuthorRole[]).flatMap((role) => {
    const k = routes[role];
    if (k === null) return [role + ": the product-value meter has no route for " + AUTHOR_MODELS[role]];
    const m = MODELS[k];
    const id = (m.provider === "anthropic" ? "anthropic/" : m.provider === "openai" ? "openai/" : "") + m.id;
    return id === AUTHOR_MODELS[role] ? [] : [role + ": meter route " + k + " calls " + id + ", not " + AUTHOR_MODELS[role]];
  });
}

export interface Seams {
  author(o: { out: string; cacheDir: string }): Launcher<AuthorCall>;
  /** pin is null when no skill arm runs (the pilot). */
  review(o: { out: string; arms: ReviewArm[]; pin: DigestPin | null; policy?: string; log: (l: string) => void }): Launcher<ReviewSession>;
  build(o: { out: string; src: UnitSource; units: string; repos: string; ids: string[]; reviewed: boolean; planned: number; a: Args }): Launcher<PlantedSession>;
  grader(o: { work: string; log: (l: string) => void }): Promise<PlantedGrader>;
}

/** The construct part's grader: construct/grader.ts exports plantedGrader({ work, log }), a PlantedGrader. */
export const GRADER_MODULE = join(import.meta.dir, "..", "construct", "grader.ts");

export const REAL: Seams = {
  author: (o) => async (p) => {
    const problems = authorRouteProblems();
    if (problems.length) return fail("E_EP_NOT_BUILT", "the authoring routes are not all built, so no lease opened:\n" + problems.join("\n") + "\nadd a carbon ModelKey (google/gemini-4-carbon on OpenRouter, pinned to Google) to lanes/product-value/meter.ts, its price row to src/runner/pricing/prices.ts, and its route to AUTHOR_ROUTES");
    const meter = await openMeter({ item: p.item, runId: EP_RUN, out: o.out, cacheDir: o.cacheDir, maxOutputTokens: AUTHOR_MAX_TOKENS, amountMicros: Math.round(p.capUsd * 1_000_000), record: p.record, ledger: p.ledger });
    const call: AuthorCall = async (role, prompt) => {
      const r = await meter.call({ model: AUTHOR_ROUTES[role]!, prompt, maxTokens: AUTHOR_MAX_TOKENS, effort: null, label: "ep-author:" + role });
      if (r.status !== 200 || r.text === null) return fail("E_USAGE", "the authoring " + role + " call ended " + r.status + (r.problem ? " (" + r.problem + ")" : "") + "; rerun the calls step, which skips units already authored");
      return { text: r.text, costUsd: r.cached ? 0 : r.micros === null ? ALLOWANCE_USD.call : r.micros / 1_000_000 };
    };
    return { lease_id: meter.leaseId, backend: call, close: async () => void (await meter.close()) };
  },
  review: (o) => reviewLauncher({ arms: o.arms.map((a) => EB_ARM[a]), reviewer: "opus", out: o.out, env: process.env, log: o.log, ...(o.pin ? { pins: { precut: o.pin, engphase: o.pin } } : {}), runId: EP_RUN, ...(o.policy ? { policy: o.policy } : {}) }),
  build: (o) => {
    const table: MountTable = new Map();
    const mountOf = (cell: string) => table.get(cell) ?? fail("E_USAGE", "cell " + cell + " has no mounts filed; only ebSession starts a planted build");
    const inner = buildLauncher({
      arm: o.reviewed ? "plain" : "none",
      units: new Map(o.ids.map((id) => [id, { dir: o.src.dir(id) }])),
      repos: o.repos,
      plans: o.out,
      bundles: null,
      out: o.out,
      host: need(o.a, "--host"),
      envelopeHost: need(o.a, "--envelope-host"),
      sidecar: need(o.a, "--sidecar"),
      forbidden: [o.units, join(homedir(), ".capy", "drive")],
      planned: Math.max(1, o.planned),
      planFor: (cell) => mountOf(cell).plan,
      reviewFor: (cell) => mountOf(cell).review,
      runId: EP_RUN,
      skill: EP_SKILL,
      ...(o.a.flags.has("--harbor") ? { harbor: o.a.flags.get("--harbor")! } : {}),
    });
    return async (p) => {
      const h = await inner(p);
      return { ...h, backend: ebSession(h.backend, table) };
    };
  },
  grader: async (o) => {
    const m = existsSync(GRADER_MODULE) ? ((await import(GRADER_MODULE)) as { plantedGrader?: (o: { work: string; log: (l: string) => void }) => PlantedGrader }) : null;
    return m?.plantedGrader ? m.plantedGrader(o) : notBuilt("the grading seam (" + GRADER_MODULE + " exporting plantedGrader)");
  },
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
    const o = { run, src, batch: batch as 1 | 2, step, chunk: a.flags.has("--chunk") ? whole(a, "--chunk", 1) : undefined, parallel: whole(a, "--parallel", 1), log };
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
    const ids = step === "hinted" ? hintedTodo(run, drawFile(run, src).order) : d ? [...d.calibration, ...d.comparison, ...d.reserve] : [];
    io.out((await paidStage(p, seams.build({ out: join(run, "builds", "authoring", "rig"), src, units: need(a, "--units"), repos: need(a, "--repos"), ids, reviewed: false, planned: ids.length, a }), (session) => authorStep({ ...o, session, grader, gate }))).line);
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
    const done = await paidStage(p, seams.build({ out: join(run, "builds", phase === "stock" ? "stock" : "comparison", "rig"), src, units: need(a, "--units"), repos: need(a, "--repos"), ids: [...new Set(cells.map((c) => c.unit))], reviewed: true, planned: cells.length, a }), (session) => buildsStage({ run, src, gate, session, grader, phase, parallel: whole(a, "--parallel", 1), log }));
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

  const preflight: Command["run"] = (a, io) => {
    const rows = preflightRows({ run: need(a, "--run"), units: need(a, "--units"), repos: need(a, "--repos"), gstack: need(a, "--gstack"), record: need(a, "--ledger-record"), harbor: a.flags.get("--harbor") ?? "harbor", docker: a.flags.get("--docker") ?? "docker" });
    for (const r of rows) (r.ok ? io.out : io.err)((r.ok ? "ok   " : "FAIL ") + r.name + ": " + r.detail);
    return rows.every((r) => r.ok) ? 0 : 2;
  };

  return {
    pin: PIN_COMMAND,
    ledger: { run: ep(ledger), bools: ["--projection"], usage: "[--projection --run <dir> --crew-usd <usd> --hosts-usd <usd>]", summary: "the program and item init lines, or the running all-in projection against the $5,000 stop" },
    preflight: { run: ep(preflight), bools: [], usage: RUN + " --gstack <checkout at the pin> --ledger-record <dir> [--harbor <bin>] [--docker <bin>]", summary: "the no-model preflight on the run host: Docker, Harbor, the pins, the plain arm, the routes, the items, the units and the run dir" },
    author: { run: ep(author), bools: [], usage: RUN + " --batch 1|2 --step calls|hinted|draw|none [--chunk n] [--parallel n] [--cache <dir> for calls] [" + BUILD + " for hinted and none] " + PAID, summary: "authoring in seeded order: plan, audits, hint and ratings; the hinted builds; the draw; the no-review builds (paid: ep-authoring)" },
    smoke: { run: ep(smoke), bools: [], usage: RUN + " --gstack <checkout at the pin> [--parallel n] [--policy <file>] " + PAID, summary: "the exposure smoke: one Opus session per skill arm on each calibration unit (paid: ep-smoke)" },
    reviews: { run: ep(reviews), bools: [], usage: RUN + " --phase pilot|comparison [--gstack <checkout at the pin>] [--parallel n] [--policy <file>] " + PAID, summary: "the pilot's plain reviews or the comparison reviews, with the interim exposure stop (paid: ep-comparison)" },
    builds: { run: ep(builds), bools: [], usage: RUN + " --phase pilot|comparison|stock " + BUILD + " [--parallel n] " + PAID, summary: "the reviewed builds of a phase, or the stock control's (paid: ep-comparison, ep-stock)" },
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
