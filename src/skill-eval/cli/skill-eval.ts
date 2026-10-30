// gstack-evals skill-eval: the Lane A command (interface v0.5, v0.4 where v0.5 is silent). It routes init and --lock to
// U5's commands and --example to the keyless examples, resolves the call with its effective defaults, prints --dry-run's
// plan, runs preflight before any spend, then runs the trials and writes U6's verdict. gstack-evals preflight runs the
// same steps and stops after preflight.
//
// The host: GSTACK_EVALS_FAKE_HOST selects the keyless fake host (src/adapters/_fake/), which makes no model call, so a
// literal call (diet.md's) runs in tests. The real Claude Code and Codex adapters are U10's and the trial module U9's;
// until they land, a call on a real host stops after preflight's own checks.
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { FakeHostError, loadScript } from "../../adapters/_fake/host.ts";
import { containerRunner } from "../../trial/sandbox.ts";
import { REPO_ROOT, type Io } from "../../cli.ts";
import type { ErrorContext } from "../../types.ts";
import { codeLines, consoleIo, parseFlags as parseLockFlags } from "../contract/cli-io.ts";
import { loadContract } from "../contract/sidecar.ts";
import { checkVacuity } from "../contract/vacuity.ts";
import { readSkillFiles } from "../lock/contract-lines.ts";
import { initCommand, lockCommand } from "../lock/cli.ts";
import { treeSha256 } from "../lock/lock.ts";
import { errorLines, errorRecord, scrubSecrets, writeErrorRecord } from "../verdict/error-record.ts";
import { DEFAULT_OPTIONS } from "../verdict/gates.ts";
import { verdictTasks } from "../verdict/grade.ts";
import type { VerdictContext } from "../verdict/verdict.ts";
import { effectiveLines, resolveCall, SKILL_EVAL_HELP, type Call } from "./call.ts";
import { planLines } from "./dry-run.ts";
import { runExample, type ExampleMode } from "./example.ts";
import { FAKE_ADAPTER_SHA256, finishCalibration, finishRun, runFake } from "./run.ts";
import { adapterSha256, dockerRig, hostReadiness, readJournal, runOnHost, verifierSha256, type HostRig } from "./run-host.ts";
import { recipeHash } from "../../rig/recipe.ts";
import { openLocalLedger } from "../../runner/ledger/local.ts";
import { settleLease } from "../../runner/ledger/ledger.ts";
import { recoverRun } from "../../trial/proxy.ts";
import { spawnSync } from "node:child_process";
import { skillName } from "./arms.ts";
import { isReasonCode } from "../../errors/codes.ts";
import { flagHelp, parseFlags, SKILL_EVAL_FLAGS } from "./flags.ts";
import { preflight, type PreflightReport, type Stop } from "./preflight.ts";

type Env = Record<string, string | undefined>;
const HINT = "gstack-evals skill-eval --help shows the call and every flag.";

export const version = (): string => {
  try {
    return readFileSync(join(REPO_ROOT, "VERSION"), "utf8").trim();
  } catch {
    return "unknown";
  }
};

export const isFakeHost = (env: Env): boolean => !!env.GSTACK_EVALS_FAKE_HOST;

function hostCheck(call: Call, env: Env): () => Stop | null {
  if (isFakeHost(env)) {
    return () => {
      try {
        loadScript(env.GSTACK_EVALS_FAKE_HOST!);
        return null;
      } catch (error) {
        if (error instanceof FakeHostError) return { code: "E_USAGE", message: error.message };
        throw error;
      }
    };
  }
  return () => hostReadiness(call, []);
}

export function errorContext(call: Call | null, env_names: string[], env: Env): ErrorContext {
  return {
    resource_ids: call ? { tasks: call.tasks, out: call.out.path, run_id: call.runId } : {},
    gstack_evals_version: version(),
    host: call?.host ?? null,
    host_version: call && isFakeHost(env) ? "fake" : null,
    image_digest: null,
    policy_sha256: call?.policy.sha256 ?? null,
    ledger: call?.ledger.path ?? null,
    ledger_record: call?.record.path ?? null,
    env_names,
  };
}

/**
 * --lock runs the contract and vacuity checks first and refuses to lock a set that fails them (GST-109 decision 1). The
 * controls run in containers on the pinned trial image when Docker answers (U9's container runner); otherwise as this
 * user with the env allowlist, since the lock is the author's own step on their own committed tasks, and the line says
 * which. Preflight, which honors --isolation, never falls back.
 */
async function lockWithChecks(argv: string[], io: Io, env: Env): Promise<number> {
  const parsed = parseLockFlags(argv, ["--tasks", "--ext", "--before", "--policy"], ["--help", "-h"]);
  if (typeof parsed !== "string" && parsed.values.has("--tasks") && !parsed.set.size) {
    const contract = loadContract(parsed.values.get("--tasks")!, parsed.values.get("--ext"));
    if (contract.ok) {
      const isolated = containerRunner(contract.tasks.dir, env);
      const vacuity = checkVacuity({ tasks: contract.tasks.tasks, dir: contract.tasks.dir, sidecar: contract.ext?.sidecar?.tasks ?? {} }, "runner" in isolated ? { runner: isolated.runner } : {});
      for (const w of vacuity.warnings) io.err(w.code + " " + w.message);
      if (vacuity.stops.length) {
        for (const s of vacuity.stops) io.err(codeLines(s.code, [s.message, "--lock refuses a task set that fails the vacuity check, so a fix never needs a post-hoc relock."]));
        return 2;
      }
      io.out("vacuity: " + vacuity.results.filter((r) => r.status === "ok").length + " tasks bite on their control (" + ("runner" in isolated ? "the controls ran in containers on " + isolated.image : "the controls ran as this user with the env allowlist; " + isolated.stop.code + ": " + isolated.stop.message) + ")");
    }
  }
  return lockCommand(argv, io);
}

function printStops(io: Io, stops: readonly Stop[]): void {
  for (const s of stops) io.err(codeLines(s.code, [s.message], s.fix));
}

export async function skillEvalCommand(argv: string[], io: Io = consoleIo, env: Env = process.env, mode: "run" | "preflight" = "run"): Promise<number> {
  if (mode === "run" && argv[0] === "init") return initCommand(argv.slice(1), io);
  if (mode === "run" && argv.includes("--lock")) return lockWithChecks(argv.filter((a) => a !== "--lock"), io, env);
  const parsed = parseFlags(argv, SKILL_EVAL_FLAGS, env);
  if (typeof parsed === "string") {
    io.err(codeLines("E_USAGE", ["skill-eval: " + parsed], HINT));
    return 2;
  }
  if (parsed.values.has("--help")) {
    io.out(SKILL_EVAL_HELP + "\n" + flagHelp(SKILL_EVAL_FLAGS));
    return 0;
  }
  const json = parsed.values.has("--json");
  if (parsed.values.has("--example")) {
    const others = [...parsed.from].filter(([name, source]) => source === "flag" && !["--example", "--out", "--json"].includes(name)).map(([name]) => name);
    if (others.length) {
      io.err(codeLines("E_USAGE", ["skill-eval: --example takes only --out and --json; drop " + others.join(", ")], HINT));
      return 2;
    }
    const value = parsed.values.get("--example");
    return runExample((value === true ? "pass" : value) as ExampleMode, parsed.values.has("--out") ? resolve(parsed.values.get("--out") as string) : null, json, io, version(), env);
  }
  const call = resolveCall(parsed, env);
  if ("code" in call) {
    io.err(codeLines(call.code, ["skill-eval: " + call.message], call.fix ?? (call.code === "E_USAGE" ? HINT : undefined)));
    if (json) writeErrorRecord(null, errorRecord({ code: call.code, operation: "call", message: call.message, context: errorContext(null, [], env) }, env), io.out);
    return 2;
  }
  if (!json) io.out(effectiveLines(call).join("\n"));
  let report: PreflightReport | null = null;
  try {
    const isolated = call.isolation === "docker" && !call.dryRun ? containerRunner(dirname(resolve(call.tasks)), env) : null;
    report = preflight(call, { env, dryRun: call.dryRun, host: hostCheck(call, env), ...(isolated ? ("runner" in isolated ? { runner: isolated.runner } : { isolationStop: isolated.stop }) : {}) });
    for (const w of report.warnings) io.err(w.code + " " + w.message);
    const refuse = (stops: readonly Stop[], names: string[]): number => {
      printStops(io, stops);
      if (json) writeErrorRecord(call.out.path, errorRecord({ code: stops[0]!.code, operation: "preflight", message: stops.map((s) => s.code + " " + s.message).join("\n"), context: errorContext(call, names, env) }, env), io.out);
      return 2;
    };
    if (call.dryRun) {
      if (report.stops.length) return refuse(report.stops, report.env_names);
      io.out(json ? JSON.stringify(report.plan) : planLines(report.plan!, call.parallel).join("\n"));
      return 0;
    }
    if (!json) for (const line of report.passed) io.out("ok " + line);
    if (report.stops.length) {
      if (report.plan && report.stops.some((s) => s.code === "E_USAGE" && s.message.startsWith("--spend-cap"))) io.out(planLines(report.plan, call.parallel).join("\n"));
      return refuse(report.stops, report.env_names);
    }
    if (mode === "preflight") {
      io.out(json ? JSON.stringify({ preflight: "pass", steps: report.passed, warnings: report.warnings.map((w) => w.code + " " + w.message) }) : "PREFLIGHT: pass (" + report.passed.length + " steps; nothing was spent)");
      return 0;
    }
    if (isFakeHost(env) && call.resume) {
      io.err(codeLines("E_USAGE", ["skill-eval: --resume continues a run on Claude Code or Codex; the fake host keeps no journal to resume"], HINT));
      return 2;
    }
    return isFakeHost(env) ? runOnFakeHost(call, report, io, env, json) : await runOnRealHost(call, report, io, env, json);
  } catch (error) {
    return internal(io, call, error, report?.env_names ?? [], env, json, mode);
  }
}

/** After preflight, which stops a real host until U9 and U10 land: the trials on the fake host, then U6's verdict. */
function runOnFakeHost(call: Call, report: PreflightReport, io: Io, env: Env, json: boolean): number {
  const started = Date.now();
  const ids = new Set(report.tasks.map((t) => t.id));
  const tasks = verdictTasks(report.contract!).filter((t) => ids.has(t.id));
  let run;
  try {
    run = runFake({ models: call.models, arms: call.arms.arms.map((a) => a.name), tasks, trials: call.trials, cap: call.spendCap, calibrateOnly: call.calibrate, ...(report.lock?.gate ? { gate: report.lock.gate } : {}) }, loadScript(env.GSTACK_EVALS_FAKE_HOST!));
  } catch (error) {
    if (!(error instanceof FakeHostError)) throw error;
    io.err(codeLines("E_USAGE", ["skill-eval: " + error.message], HINT));
    return 2;
  }
  if (call.calibrate) return finishCalibration(run, [], { committed: run.spent, unknown: 0, lease_id: null, cap: call.spendCap! }, call.out.path, io, json);
  const judged = tasks.some((t) => t.judge);
  const base = call.arms.base ? call.arms.base.ref.repo + "@" + call.arms.base.ref.sha : null;
  const context: VerdictContext = {
    verdict_id: call.runId,
    harness_version: version(),
    trials: call.trials,
    effective: { noise_floor: call.noiseFloor, parallel: call.parallel, timeout_s: call.timeoutS, judge_model: judged ? call.judgeModel : null, isolation: call.isolation, policy_sha256: call.policy.sha256, base, skill: call.arms.skill?.name ?? null },
    harness: { host: call.host, host_version: "fake", gstack_evals_version: version(), adapter_sha256: FAKE_ADAPTER_SHA256, image_digest: null, base },
    arm_trees: Object.fromEntries(call.arms.arms.flatMap((a) => (a.kind === "overlay" && a.dir ? [[a.name, treeSha256(readSkillFiles(a.dir))]] : []))),
    lock: report.lock ? { tasks_sha256: report.lock.lock.tasks.sha256, ext_sha256: report.lock.lock.ext?.sha256 ?? null, commit: report.lock.commit, post_hoc: false } : null,
    levels: null,
    spend: { ledger: call.ledger.path, ledger_record: call.record.path, committed: run.spent, reserved: 0, unknown: 0, cap: call.spendCap!, line_item: call.item, lease_id: null, approval: null, caps_history: [call.spendCap!] },
    adjudication: { blinded: true, judge_model: judged ? call.judgeModel : null },
    resumed_from: null,
    wall_s: (Date.now() - started) / 1000,
    rig: null,
  };
  return finishRun(run, context, call.out.path, io, json, { ...DEFAULT_OPTIONS, margin_points: call.margin });
}

/** Stop codes after which --resume refuses (E_NOT_RESUMABLE): the run cannot get further by continuing. */
const TERMINAL = ["NOT_MEASURABLE", "MARGIN_NOT_ATTEMPTED", "VACUOUS_CHECK", "LOCK_MISSING", "LOCK_DRIFT", "E_USER_TURNS_MISSING", "E_INTERACTIVE_HOST", "E_LOOSE_GSTACK"];

interface RunFile {
  schema_version: 1;
  run_id: string;
  verdict_id: string;
  started_at: string;
  /** Micro-dollars committed by earlier attempts of this run, before this one started. */
  committed_before: number;
  repair: string | null;
  recovery: { lease_id: string; proxy_container: string; journal: string } | null;
  ended?: { exit_code: number; reasons: string[]; committed: number };
}

/** After preflight on Claude Code or Codex: the Docker rig, calibration, the trials, then U6's verdict. makeRig is the Docker rig except in tests. --resume continues the run in its out directory; --repair reruns the cells whose key changed under a new verdict id. */
export async function runOnRealHost(call: Call, report: PreflightReport, io: Io, env: Env, json: boolean, makeRig: typeof dockerRig = dockerRig): Promise<number> {
  const resume = call.resume;
  const started = Date.now();
  const ids = new Set(report.tasks.map((t) => t.id));
  const tasks = verdictTasks(report.contract!).filter((t) => ids.has(t.id));
  const notReady = hostReadiness(call, tasks, report.contract!.ext?.sidecar?.tasks ?? {});
  if (notReady) {
    printStops(io, [notReady]);
    return 2;
  }
  const out = resume?.dir ?? call.out.path;
  const runFile = join(out, "run.json");
  let prior: RunFile | null = null;
  if (resume) {
    if (!existsSync(runFile)) {
      printStops(io, [{ code: "E_NOT_RESUMABLE", message: out + " holds no run.json, so there is no real-host run to resume", fix: "Point --resume at the out directory of a run on --host claude or codex." }]);
      return 2;
    }
    prior = JSON.parse(readFileSync(runFile, "utf8")) as RunFile;
    const terminal = (prior.ended?.reasons ?? []).map((r) => r.split(" ")[0]!).filter((c) => TERMINAL.includes(c));
    if (terminal.length) {
      printStops(io, [{ code: "E_NOT_RESUMABLE", message: "the run ended on " + terminal.join(", ") + ", which continuing cannot change" }]);
      return 2;
    }
    if (prior.recovery && !prior.ended) {
      const bin = env.GSTACK_EVALS_DOCKER_BIN || "docker";
      const local = openLocalLedger(call.ledger);
      const recovery = prior.recovery;
      const { settled } = await recoverRun({ stopProxy: () => void spawnSync(bin, ["rm", "-f", recovery.proxy_container], { stdio: "ignore" }), journal: recovery.journal, ledger: local, settle: () => settleLease(call.record.path, local, recovery.lease_id) });
      prior.ended = { exit_code: 2, reasons: [], committed: settled.spent_micros };
    }
  }
  const committedBefore = prior ? prior.committed_before + (prior.ended?.committed ?? 0) : 0;
  const runId = prior?.run_id ?? call.runId;
  const verdictId = prior && !resume?.repair ? prior.verdict_id : call.runId;
  const cap = Math.max(0, call.spendCap! - committedBefore);
  const holder = call.arms.arms.find((a) => a.kind === "overlay" && a.dir !== null);
  const skill = call.arms.skill?.name ?? (holder && holder.kind === "overlay" && holder.dir ? skillName(holder.dir) : null);
  const nonce = randomUUID().slice(0, 8);
  let rig: HostRig;
  try {
    rig = makeRig({ ...call, runId, out: { ...call.out, path: out } }, { env, skill, nonce, cap });
  } catch (error) {
    const message = String((error as Error)?.message ?? error);
    const code = message.split(":")[0]!;
    if (!isReasonCode(code)) throw error;
    printStops(io, [{ code, message: message.slice(code.length + 1).trim() }]);
    return 2;
  }
  const record: RunFile = { schema_version: 1, run_id: runId, verdict_id: verdictId, started_at: new Date(started).toISOString(), committed_before: committedBefore, repair: resume?.repair ?? null, recovery: rig.recovery };
  mkdirSync(out, { recursive: true });
  writeFileSync(runFile, JSON.stringify(record, null, 2) + "\n");
  const pins = JSON.parse(readFileSync(join(REPO_ROOT, "docker", "host-cli.json"), "utf8")) as Record<string, string | null>;
  let run;
  let spend: Awaited<ReturnType<HostRig["close"]>>;
  try {
    run = await runOnHost({ host: call.host, models: call.models, trials: call.trials, parallel: call.parallel, timeoutS: call.timeoutS, cap, runId, out, tasksDir: dirname(resolve(call.tasks)), policy: call.policy, arms: call.arms.arms, skill, tasks: report.tasks, verdict: tasks, entries: report.contract!.ext?.sidecar?.tasks ?? {}, nonce, calibrateOnly: call.calibrate, judgeModel: call.judgeModel, keyBase: { image_digest: rig.imageDigest, recipe: recipeHash(), host_version: pins[call.host] ?? null, adapter_sha256: adapterSha256(call.host), isolation: call.isolation, verifier: verifierSha256() }, ...(resume ? { reuse: readJournal(out), repair: resume.repair !== null } : {}), ...(report.lock?.gate ? { gate: report.lock.gate } : {}) }, rig, (line) => io.err(line));
  } finally {
    spend = await rig.close();
  }
  if (run.stale.length) {
    printStops(io, run.stale);
    writeFileSync(runFile, JSON.stringify({ ...record, ended: { exit_code: 2, reasons: ["E_CACHE_STALE"], committed: spend.committed } }, null, 2) + "\n");
    return 2;
  }
  for (const f of run.calibrationFailures) io.err(codeLines(f.code, [f.message], f.fix));
  if (call.calibrate) {
    const exit = finishCalibration(run, run.calibrationFailures, { committed: committedBefore + spend.committed, unknown: spend.unknown, lease_id: spend.lease_id, cap: call.spendCap! }, out, io, json);
    writeFileSync(runFile, JSON.stringify({ ...record, ended: { exit_code: exit, reasons: run.calibrationFailures.map((f) => f.code), committed: spend.committed } }, null, 2) + "\n");
    return exit;
  }
  const judged = tasks.some((t) => t.judge);
  const base = call.arms.base ? call.arms.base.ref.repo + "@" + call.arms.base.ref.sha : null;
  const context: VerdictContext = {
    verdict_id: verdictId,
    harness_version: version(),
    trials: call.trials,
    effective: { noise_floor: call.noiseFloor, parallel: call.parallel, timeout_s: call.timeoutS, judge_model: judged ? call.judgeModel : null, isolation: call.isolation, policy_sha256: call.policy.sha256, base, skill },
    harness: { host: call.host, host_version: pins[call.host] ?? "unpinned", gstack_evals_version: version(), adapter_sha256: adapterSha256(call.host), image_digest: rig.imageDigest, base },
    arm_trees: Object.fromEntries(call.arms.arms.flatMap((a) => (a.kind === "overlay" && a.dir ? [[a.name, treeSha256(readSkillFiles(a.dir))]] : []))),
    lock: report.lock ? { tasks_sha256: report.lock.lock.tasks.sha256, ext_sha256: report.lock.lock.ext?.sha256 ?? null, commit: report.lock.commit, post_hoc: false } : null,
    levels: null,
    spend: { ledger: call.ledger.path, ledger_record: call.record.path, committed: committedBefore + spend.committed, reserved: 0, unknown: spend.unknown, cap: call.spendCap!, line_item: call.item, lease_id: spend.lease_id, approval: null, caps_history: [call.spendCap!] },
    adjudication: { blinded: true, judge_model: judged ? call.judgeModel : null },
    resumed_from: prior ? prior.verdict_id : null,
    wall_s: (Date.now() - started) / 1000,
    rig: null,
  };
  const exit = finishRun(run, context, out, io, json, { ...DEFAULT_OPTIONS, margin_points: call.margin });
  const verdict = JSON.parse(readFileSync(join(out, "verdict.json"), "utf8")) as { reasons?: string[] };
  writeFileSync(runFile, JSON.stringify({ ...record, ended: { exit_code: exit, reasons: verdict.reasons ?? [], committed: spend.committed } }, null, 2) + "\n");
  return exit;
}

/** An unexpected error: an E_INTERNAL record with secrets scrubbed, a correlation id and a trace file in <out>. */
export function internal(io: Io, call: Call, error: unknown, envNames: string[], env: Env, json: boolean, operation: string): number {
  const correlation = randomUUID();
  let trace: string | null = join(call.out.path, "trace-" + correlation + ".txt");
  try {
    mkdirSync(call.out.path, { recursive: true });
    writeFileSync(trace, scrubSecrets(String((error as Error)?.stack ?? error), env) + "\n");
  } catch {
    trace = null;
  }
  const record = errorRecord({ code: "E_INTERNAL", operation, message: "skill-eval " + operation + " hit an unexpected error; nothing was spent before preflight passed", cause: error, context: errorContext(call, envNames, env), correlation_id: correlation, trace }, env);
  io.err(errorLines(record).join("\n"));
  if (json) writeErrorRecord(call.out.path, record, io.out);
  return 2;
}

export const main = (argv: string[]): Promise<number> => skillEvalCommand(argv);
