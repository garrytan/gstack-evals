// Copyright (c) 2026 Garry Tan. MIT License.
// The run area's commands for gstack-evals of (the parent assembles lanes/office-hours-founder/cli.ts from them):
//   run   one cell's sessions on the Docker rig (run.ts), after every refusal below.
//   rows  checks a launch's rows.ndjson against its frozen manifest and prints the end-state counts.
//   e2e   the keyless end to end on this machine with Docker (e2e.ts).
// The run command refuses, before anything is built or spent: a units dir or out dir inside the repo; a launch without
// GSTACK_EVALS_EPHEMERAL=1 and a GSTACK_EVALS_RECEIPTS sink that does not exist yet (and sits outside the repo); a gstack
// other than the prereg's pin, and a gstack tree whose VERSION is not the pin's once the rig installs it; any upstream
// override; a model, arm, cell or repair the prereg does not name; an out dir that exists without --resume. The simulator
// comes in through wire, so the run command holds no simulator of its own.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { stackKind } from "../../../src/arms/stacks.ts";
import { ledgerPath, recordPath } from "../../../src/runner/ledger/paths.ts";
import { parseStackRef } from "../../../src/skill-eval/cli/arms.ts";
import { newRunId } from "../../../src/skill-eval/cli/call.ts";
import { DEFAULT_POLICY, loadPolicy, type LoadedPolicy } from "../../../src/skill-eval/cli/policy.ts";
import { dockerRig } from "../../../src/skill-eval/cli/run-host.ts";
import { receiptsSink } from "../../../src/trial/durable.ts";
import { gstackDir, gstackVersion } from "../../../src/trial/review/plan.ts";
import type { ArmSpec } from "../../../src/types.ts";
import { insideRepo } from "../../review-noloss/suite.ts";
import { openMeter, type CallRequest, type CallResult } from "../../product-value/meter.ts";
import { ARMS, GSTACK, MODEL_KEYS, MODELS } from "../frozen.ts";
import type { ArmId, ModelId } from "../types.ts";
import { runE2e, type E2eOptions } from "./e2e.ts";
import { CELLS, readManifest, type Cell } from "./manifest.ts";
import { readRows, rowsReport } from "./rows.ts";
import { meterSlot, PRE_SMOKE, receiptsAfter, runCells, type Allowances, type RunDeps, type RunInput } from "./run.ts";
import { REPAIRS, type FounderTurnFn, type PersonSheet, type Repair } from "./session.ts";

type Env = Record<string, string | undefined>;
interface Io {
  out: (text: string) => void;
  err: (text: string) => void;
}
type Call = (req: CallRequest) => Promise<CallResult>;

export const RUN_HELP = [
  "gstack-evals of run --cell " + CELLS.join("|") + " --units-dir <dir> --out <dir> --item <runs item> --spend-cap <usd>",
  "    --sim-item <simulator item> --sim-spend-cap <usd> [--models opus sol particle] [--arms none lens office-hours]",
  "    [--repairs " + REPAIRS.join(" ") + "] [--allowances <file>] [--gstack " + GSTACK.repo + "@" + GSTACK.sha + "]",
  "    [--parallel <n>] [--ledger <path>] [--record <dir>] [--policy <file>] [--resume]",
  "A launch needs GSTACK_EVALS_EPHEMERAL=1 and a GSTACK_EVALS_RECEIPTS sink that does not exist yet.",
].join("\n");

const VALUE = new Set(["--cell", "--units-dir", "--out", "--item", "--spend-cap", "--sim-item", "--sim-spend-cap", "--allowances", "--gstack", "--parallel", "--ledger", "--record", "--policy", "--upstream"]);
const LIST = new Set(["--models", "--arms", "--repairs"]);
const BOOL = new Set(["--resume"]);

class Usage extends Error {}
const refuse = (why: string): never => {
  throw new Usage(why);
};

function parse(argv: readonly string[]): Map<string, string[]> {
  const flags = new Map<string, string[]>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (BOOL.has(a)) flags.set(a, []);
    else if (VALUE.has(a)) {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--") || flags.has(a)) refuse(a + " needs one value, given once");
      flags.set(a, [v!]);
    } else if (LIST.has(a)) {
      const vals: string[] = [];
      while (i + 1 < argv.length && !argv[i + 1]!.startsWith("--")) vals.push(argv[++i]!);
      if (!vals.length) refuse(a + " needs at least one value");
      flags.set(a, vals);
    } else refuse("unknown argument " + JSON.stringify(a));
  }
  return flags;
}

/** A launch's settings after every refusal that needs no Docker. */
export interface RunPlan {
  input: Omit<RunInput, "log" | "policy" | "runId" | "ledger" | "docker">;
  item: string;
  simItem: string;
  ledger: string | undefined;
  record: string | undefined;
  policy: string;
  resume: boolean;
  sink: string;
}

const dollars = (v: string | undefined, what: string): number => {
  const n = Math.round(Number(v) * 1_000_000);
  if (!(n > 0)) refuse(what + " must be a positive number of dollars");
  return n;
};

/** Every refusal of the run command that needs no Docker, in order. */
export function planRun(argv: readonly string[], env: Env): RunPlan {
  const f = parse(argv);
  const one = (k: string) => f.get(k)?.[0];
  for (const k of ["--cell", "--units-dir", "--out", "--item", "--spend-cap", "--sim-item", "--sim-spend-cap"]) if (!f.has(k)) refuse("of run needs " + k);
  const cell = one("--cell") as Cell;
  if (!CELLS.includes(cell)) refuse("--cell takes " + CELLS.join(", ") + ", not " + JSON.stringify(cell));
  if (f.has("--upstream")) refuse("--upstream overrides the proxy's provider URLs, which only the keyless end to end may do; a run never sets it");
  const unitsDir = resolve(one("--units-dir")!);
  const out = resolve(one("--out")!);
  if (insideRepo(unitsDir)) refuse("--units-dir " + unitsDir + " is inside the repo, and units stay sealed outside it");
  if (insideRepo(out)) refuse("--out " + out + " is inside the repo, and transcripts stay sealed outside it");
  if (!existsSync(unitsDir)) refuse("--units-dir " + unitsDir + " does not exist");
  const resume = f.has("--resume");
  if (existsSync(out) && !resume) refuse(out + " exists; pass --resume to continue that launch's cell, or a new --out");
  const models = (f.get("--models") ?? [...MODELS]) as ModelId[];
  for (const m of models) if (!MODELS.includes(m)) refuse("--models: " + m + " is not a model the prereg names (" + MODELS.join(", ") + ")");
  const arms = (f.get("--arms") ?? [...ARMS]) as ArmId[];
  for (const a of arms) if (!ARMS.includes(a)) refuse("--arms: " + a + " is not an arm the prereg names (" + ARMS.join(", ") + ")");
  const repairs = (f.get("--repairs") ?? []) as Repair[];
  for (const r of repairs) if (!REPAIRS.includes(r)) refuse("--repairs: " + r + " is not a repair the prereg names (" + REPAIRS.join(", ") + ")");
  const gstack = one("--gstack");
  if (gstack !== undefined && gstack !== GSTACK.repo + "@" + GSTACK.sha) refuse("--gstack " + gstack + ": the prereg pins " + GSTACK.repo + "@" + GSTACK.sha + " (VERSION " + GSTACK.version + ") whole");
  const allowances: Allowances = one("--allowances") ? JSON.parse(readFileSync(one("--allowances")!, "utf8")) : PRE_SMOKE;
  for (const a of ARMS) for (const m of MODELS) if (!(allowances.arm?.[a]?.[m]! > 0)) refuse("--allowances: arm " + a + " on " + m + " needs a positive dollar allowance");
  if (!(allowances.sim > 0)) refuse("--allowances: sim needs a positive dollar allowance");
  const parallel = Number(one("--parallel") ?? "1");
  if (!Number.isSafeInteger(parallel) || parallel < 1) refuse("--parallel must be a whole number of at least 1");
  const sink = receiptsSink(env);
  if ("problem" in sink) refuse(sink.problem);
  const path = "sink" in sink ? sink.sink : null;
  if (!path) return refuse("every launch uses a receipts sink that does not exist before it, and GSTACK_EVALS_EPHEMERAL=1 is not set; set it and GSTACK_EVALS_RECEIPTS to a new path");
  if (existsSync(path)) refuse("the receipts sink " + path + " already exists, and every launch uses a sink that does not exist before it");
  if (insideRepo(path)) refuse("the receipts sink " + path + " is inside the repo, and the receipts quote transcripts");
  return { input: { cell, unitsDir, out, models, arms, repairs, allowances, cap: dollars(one("--spend-cap"), "--spend-cap"), simCap: dollars(one("--sim-spend-cap"), "--sim-spend-cap"), parallel }, item: one("--item")!, simItem: one("--sim-item")!, ledger: one("--ledger"), record: one("--record"), policy: one("--policy") ?? DEFAULT_POLICY, resume, sink: path };
}

/** gstack-evals of run: one cell's launch, with the simulator the parent wires in. */
export async function runCommand(argv: string[], io: Io, env: Env, wire: { founderTurn: FounderTurnFn<PersonSheet, Call>; exposed: RunDeps<Call>["exposed"] }): Promise<number> {
  if (argv.includes("--help")) {
    io.out(RUN_HELP);
    return 0;
  }
  let plan: RunPlan;
  try {
    plan = planRun(argv, env);
  } catch (e) {
    if (!(e instanceof Usage)) throw e;
    io.err("E_USAGE of run: " + e.message + "\nE_USAGE fix: see gstack-evals of run --help");
    return 2;
  }
  const policy = loadPolicy(plan.policy);
  if ("problem" in policy) {
    io.err("E_USAGE of run: --policy " + plan.policy + ": " + policy.problem);
    return 2;
  }
  const out = plan.input.out;
  mkdirSync(join(out, "fixtures"), { recursive: true });
  const runFile = join(out, "run.json");
  const runId = existsSync(runFile) ? (JSON.parse(readFileSync(runFile, "utf8")) as { run_id: string }).run_id : newRunId("of-" + plan.input.cell);
  writeFileSync(runFile, JSON.stringify({ run_id: runId, sink: plan.sink, sink_existed: false, checked_at: new Date().toISOString() }, null, 2) + "\n");
  writeFileSync(join(out, "fixtures", "tasks.json"), "[]\n");
  const stack = parseStackRef(GSTACK.repo + "@" + GSTACK.sha);
  if (typeof stack === "string") throw new Error("E_INTERNAL " + stack);
  const specs: ArmSpec[] = plan.input.arms.map((a) => (a === "office-hours" ? { name: a, kind: "stack", stack, install: { ...stackKind(stack)?.install } } : { name: a, kind: "bare" }));
  if (!specs.some((s) => s.name === "none")) specs.unshift({ name: "none", kind: "bare" });
  const ledger = ledgerPath(plan.ledger, env);
  const record = recordPath(plan.record, env);
  const meter = await openMeter({ item: plan.simItem, runId, out: join(out, "sim-meter"), cacheDir: join(out, "sim-cache"), maxOutputTokens: 1200, amountMicros: plan.input.simCap, record: record.path, ledger: ledger.path, env });
  let failed = false;
  try {
    const run = await runCells({ ...plan.input, runId, policy: policy as LoadedPolicy, ledger: ledger.path, docker: env.GSTACK_EVALS_DOCKER_BIN || "docker", log: (l) => io.err(l) }, {
      openRig: async () => {
        const rig = dockerRig({ host: "claude", arms: { arms: specs, base: null, skill: null, notes: [] }, tasks: join(out, "fixtures", "tasks.json"), out: { path: out, rule: "--out" }, ledger, record, item: plan.item, runId, models: plan.input.models.map((m) => MODEL_KEYS[m]), policy: policy as LoadedPolicy }, { env, skill: null, skills: { "office-hours": "office-hours" }, nonce: randomBytes(6).toString("hex"), cap: plan.input.cap, voice: false });
        const version = rig.arms["office-hours"] ? gstackVersion(gstackDir(rig.arms["office-hours"])) : GSTACK.version;
        if (version !== GSTACK.version) {
          await rig.close();
          throw new Error("E_USAGE the office-hours arm's gstack tree reads VERSION " + version + ", and the prereg pins " + GSTACK.version);
        }
        return rig;
      },
      simSlot: meterSlot(meter),
      founderTurn: wire.founderTurn,
      exposed: wire.exposed,
    });
    io.out("cell " + plan.input.cell + ": manifest " + run.manifest_sha256 + ", " + run.rows.length + " sessions ended, " + run.unrun.length + " unrun, arm spend $" + (run.spent_micros / 1e6).toFixed(2) + ", simulator $" + (run.sim_micros / 1e6).toFixed(2));
    for (const s of run.stops) io.err(s.code + " of run: " + s.message);
    return run.stops.length ? 2 : 0;
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    await meter.close();
    receiptsAfter(out, plan.sink, failed, (line) => io.err(line));
  }
}

/** gstack-evals of rows --out <dir>: the rows against the frozen manifest. */
export async function rowsCommand(argv: string[], io: Io): Promise<number> {
  const at = argv.indexOf("--out");
  if (at < 0 || !argv[at + 1]) {
    io.err("E_USAGE of rows: pass --out <launch dir>");
    return 2;
  }
  const out = resolve(argv[at + 1]!);
  const report = rowsReport(readManifest(join(out, "manifest.json")), readRows(out));
  for (const [k, v] of Object.entries(report.counts)) io.out(k + ": " + Object.entries(v).map(([e, n]) => e + " " + n).join(", "));
  io.out(report.unrun.length + " scheduled sessions have no row");
  for (const p of report.problems) io.err("E_USAGE of rows: " + p);
  return report.problems.length ? 2 : 0;
}

/** gstack-evals of e2e [--keep]: the keyless end to end, one PASS or FAIL line per check. */
export async function e2eCommand(argv: string[], io: Io, _env: Env, wire: Omit<E2eOptions, "keep"> = {}): Promise<number> {
  const { checks } = await runE2e({ ...wire, keep: argv.includes("--keep"), log: (l) => io.err(l) });
  const failed = checks.filter((c) => !c.ok);
  if (failed.length) io.err("E_OF_DRYRUN_FAIL of e2e: " + failed.map((c) => c.check).join("; "));
  return failed.length ? 2 : 0;
}
