// Copyright (c) 2026 Garry Tan. MIT License.
// The run area's commands (the parent assembles the lane's cli.ts from them; prereg sections 4, 12 and 13; pre-run
// change 1, items 4a and 5):
//   run   one launch (stage1, stage2 or stage2-particle) on the Docker rig, after every refusal below.
//   rows  checks a launch's rows.ndjson against its frozen manifest and prints the end-state counts.
//   e2e   the keyless end to end on this machine with Docker (e2e.ts).
// The run command refuses, before anything is built or spent: a briefs dir or out dir inside the repo; a launch without
// GSTACK_EVALS_EPHEMERAL=1 and a GSTACK_EVALS_RECEIPTS sink that does not exist yet (and sits outside the repo); any
// upstream override; a launch, model or arm the prereg does not name for that launch; an out dir that exists without
// --resume; and caps whose sum passes the launch's frozen ledger line. runLaunch then refuses a null pin, a T8 brief
// that cannot seed, a manifest that differs from the frozen one, an out dir that ended in a cap stop, a build whose
// tracked files differ from HEAD, and gstack trees that are not the pins.
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ledgerPath, recordPath } from "../../../src/runner/ledger/paths.ts";
import { newRunId } from "../../../src/skill-eval/cli/call.ts";
import { DEFAULT_POLICY, loadPolicy, type LoadedPolicy } from "../../../src/skill-eval/cli/policy.ts";
import { dockerRig } from "../../../src/skill-eval/cli/run-host.ts";
import { receiptsSink } from "../../../src/trial/durable.ts";
import { insideRepo } from "../../review-noloss/suite.ts";
import { openMeter } from "../../product-value/meter.ts";
import { ARMS, EMPTY_BOUND, HOSTS, MODEL_KEYS, PINS } from "../frozen.ts";
import { withCodex } from "./codex-rig.ts";
import { parseBlock } from "../score/block.ts";
import { simTurn } from "../sim/founder.ts";
import type { ArmId, ModelId } from "../types.ts";
import { runE2e } from "./e2e.ts";
import { buildCommit, capProblem, LAUNCH_NAMES, LAUNCHES, readManifest, type LaunchName } from "./manifest.ts";
import { armSpecs } from "./pins.ts";
import { readRows, rowsReport } from "./rows.ts";
import { ALLOWANCES, meterSim, receiptsAfter, runLaunch, today, type RunInput } from "./run.ts";

type Env = Record<string, string | undefined>;
interface Io {
  out: (text: string) => void;
  err: (text: string) => void;
}

export const RUN_HELP = [
  "gstack-evals ohr run --launch " + LAUNCH_NAMES.join("|") + " --briefs-dir <dir> --out <dir> --item <arms item> --spend-cap <usd>",
  "    --sim-item <simulator item> --sim-spend-cap <usd> [--models <ids>] [--arms " + ARMS.join(" ") + "] [--dropped <file>]",
  "    [--parallel <n>] [--ledger <path>] [--record <dir>] [--policy <file>] [--resume]",
  "A launch needs GSTACK_EVALS_EPHEMERAL=1 and a GSTACK_EVALS_RECEIPTS sink that does not exist yet. --spend-cap and",
  "--sim-spend-cap together may not pass the launch's frozen ledger line. --dropped names one brief id a line.",
].join("\n");

const VALUE = new Set(["--launch", "--briefs-dir", "--out", "--item", "--spend-cap", "--sim-item", "--sim-spend-cap", "--dropped", "--parallel", "--ledger", "--record", "--policy", "--upstream"]);
const LIST = new Set(["--models", "--arms"]);
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
  input: Pick<RunInput, "launch" | "briefsDir" | "out" | "models" | "arms" | "dropped" | "cap" | "simCap" | "parallel">;
  item: string;
  simItem: string;
  ledger: string | undefined;
  record: string | undefined;
  policy: string;
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
  for (const k of ["--launch", "--briefs-dir", "--out", "--item", "--spend-cap", "--sim-item", "--sim-spend-cap"]) if (!f.has(k)) refuse("ohr run needs " + k);
  const launch = one("--launch") as LaunchName;
  if (!LAUNCH_NAMES.includes(launch)) refuse("--launch takes " + LAUNCH_NAMES.join(", ") + ", not " + JSON.stringify(launch));
  if (f.has("--upstream")) refuse("--upstream overrides the proxy's provider URLs, which only the keyless end to end may do; a run never sets it");
  const briefsDir = resolve(one("--briefs-dir")!);
  const out = resolve(one("--out")!);
  if (insideRepo(briefsDir)) refuse("--briefs-dir " + briefsDir + " is inside the repo, and briefs stay sealed outside it");
  if (insideRepo(out)) refuse("--out " + out + " is inside the repo, and transcripts stay sealed outside it");
  if (!existsSync(briefsDir)) refuse("--briefs-dir " + briefsDir + " does not exist");
  if (existsSync(out) && !f.has("--resume")) refuse(out + " exists; pass --resume to continue that launch, or a new --out");
  const named = LAUNCHES[launch].models as readonly ModelId[];
  const models = (f.get("--models") ?? [...named]) as ModelId[];
  for (const m of models) if (!named.includes(m)) refuse("--models: " + m + " is not a model the prereg runs in " + launch + " (" + named.join(", ") + ")");
  const arms = (f.get("--arms") ?? [...ARMS]) as ArmId[];
  for (const a of arms) if (!ARMS.includes(a)) refuse("--arms: " + a + " is not an arm the prereg names (" + ARMS.join(", ") + ")");
  const dropped = one("--dropped") ? readFileSync(one("--dropped")!, "utf8").split("\n").map((l) => l.trim()).filter(Boolean) : [];
  const parallel = Number(one("--parallel") ?? "1");
  if (!Number.isSafeInteger(parallel) || parallel < 1) refuse("--parallel must be a whole number of at least 1");
  const cap = dollars(one("--spend-cap"), "--spend-cap");
  const simCap = dollars(one("--sim-spend-cap"), "--sim-spend-cap");
  const line = capProblem(launch, cap, simCap);
  if (line) refuse(line);
  const sink = receiptsSink(env);
  if ("problem" in sink) refuse(sink.problem);
  const path = "sink" in sink ? sink.sink : null;
  if (!path) return refuse("every launch uses a receipts sink that does not exist before it, and GSTACK_EVALS_EPHEMERAL=1 is not set; set it and GSTACK_EVALS_RECEIPTS to a new path");
  if (existsSync(path)) refuse("the receipts sink " + path + " already exists, and every launch uses a sink that does not exist before it");
  if (insideRepo(path)) refuse("the receipts sink " + path + " is inside the repo, and the receipts quote transcripts");
  return { input: { launch, briefsDir, out, models, arms, dropped, cap, simCap, parallel }, item: one("--item")!, simItem: one("--sim-item")!, ledger: one("--ledger"), record: one("--record"), policy: one("--policy") ?? DEFAULT_POLICY, sink: path };
}

/** gstack-evals ohr run: one launch on the Docker rig. */
export async function runCommand(argv: string[], io: Io, env: Env): Promise<number> {
  if (argv.includes("--help")) {
    io.out(RUN_HELP);
    return 0;
  }
  let plan: RunPlan;
  try {
    plan = planRun(argv, env);
  } catch (e) {
    if (!(e instanceof Usage)) throw e;
    io.err((/^E_OHR_/.test(e.message) ? "" : "E_USAGE ohr run: ") + e.message + "\nE_USAGE fix: see gstack-evals ohr run --help");
    return 2;
  }
  const policy = loadPolicy(plan.policy);
  if ("problem" in policy) {
    io.err("E_USAGE ohr run: --policy " + plan.policy + ": " + policy.problem);
    return 2;
  }
  const out = plan.input.out;
  const commit = buildCommit();
  mkdirSync(join(out, "fixtures"), { recursive: true });
  const runFile = join(out, "run.json");
  const runId = existsSync(runFile) ? (JSON.parse(readFileSync(runFile, "utf8")) as { run_id: string }).run_id : newRunId("ohr-" + plan.input.launch);
  writeFileSync(runFile, JSON.stringify({ run_id: runId, sink: plan.sink, sink_existed: false, build_commit: commit, checked_at: new Date().toISOString() }, null, 2) + "\n");
  writeFileSync(join(out, "fixtures", "tasks.json"), "[]\n");
  const arms = plan.input.arms;
  const specs = armSpecs(arms.includes("none") ? arms : ["none", ...arms]);
  const ledger = ledgerPath(plan.ledger, env);
  const record = recordPath(plan.record, env);
  const meter = await openMeter({ item: plan.simItem, runId, out: join(out, "sim-meter"), cacheDir: join(out, "sim-cache"), maxOutputTokens: 1200, amountMicros: plan.input.simCap, emptyBound: EMPTY_BOUND, record: record.path, ledger: ledger.path, env });
  let failed = false;
  try {
    const run = await runLaunch({ ...plan.input, runId, pins: PINS, buildCommit: commit, allowances: ALLOWANCES, policy: policy as LoadedPolicy, docker: env.GSTACK_EVALS_DOCKER_BIN || "docker", day: today(), ledger: ledger.path, log: (l) => io.err(l) }, {
      openRig: () => {
        const nonce = randomBytes(6).toString("hex");
        const rig = dockerRig({ host: "claude", arms: { arms: specs, base: null, skill: null, notes: [] }, tasks: join(out, "fixtures", "tasks.json"), out: { path: out, rule: "--out" }, ledger, record, item: plan.item, runId, models: plan.input.models.map((m) => MODEL_KEYS[m]), policy: policy as LoadedPolicy }, { env, skill: null, skills: { current: "office-hours", new: "office-hours" }, nonce, cap: plan.input.cap, voice: false });
        return plan.input.models.some((m) => HOSTS[m] === "codex") ? withCodex(rig, { arms: specs, env, out, tasks: join(out, "fixtures", "tasks.json"), runId, nonce }) : rig;
      },
      simSlot: meterSim(meter),
      simTurn,
      parse: parseBlock,
    });
    io.out(plan.input.launch + ": manifest " + run.manifest_sha256 + ", " + run.rows.length + " sessions ended, " + run.unrun.length + " unrun, arm spend $" + (run.spent_micros / 1e6).toFixed(2) + ", simulator $" + (run.sim_micros / 1e6).toFixed(2));
    for (const s of run.stops) io.err(s.code + " ohr run: " + s.message);
    return run.stops.length ? 2 : 0;
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    await meter.close();
    receiptsAfter(out, plan.sink, failed, (line) => io.err(line));
  }
}

/** gstack-evals ohr rows --out <dir>: the rows against the frozen manifest. */
export async function rowsCommand(argv: string[], io: Io): Promise<number> {
  const at = argv.indexOf("--out");
  if (at < 0 || !argv[at + 1]) {
    io.err("E_USAGE ohr rows: pass --out <launch dir>");
    return 2;
  }
  const out = resolve(argv[at + 1]!);
  const report = rowsReport(readManifest(join(out, "manifest.json")), readRows(out));
  for (const [k, v] of Object.entries(report.counts)) io.out(k + ": " + Object.entries(v).map(([e, n]) => e + " " + n).join(", "));
  io.out(report.unrun.length + " scheduled sessions have no row");
  for (const p of report.problems) io.err("E_USAGE ohr rows: " + p);
  return report.problems.length ? 2 : 0;
}

/** gstack-evals ohr e2e [--keep]: the keyless end to end, one PASS or FAIL line per check, or SKIP without Docker. */
export async function e2eCommand(argv: string[], io: Io): Promise<number> {
  const { checks, skipped } = await runE2e({ keep: argv.includes("--keep"), log: (l) => io.err(l) });
  if (skipped) return 0;
  const failed = checks.filter((c) => !c.ok);
  if (failed.length) io.err("E_OHR_E2E_FAIL ohr e2e: " + failed.map((c) => c.check).join("; "));
  return failed.length ? 2 : 0;
}
