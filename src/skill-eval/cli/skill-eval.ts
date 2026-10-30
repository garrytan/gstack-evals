// gstack-evals skill-eval: the Lane A command (interface v0.5, v0.4 where v0.5 is silent). It routes init and --lock to
// U5's commands and --example to the keyless examples, resolves the call with its effective defaults, prints --dry-run's
// plan, runs preflight before any spend, then runs the trials and writes U6's verdict. gstack-evals preflight runs the
// same steps and stops after preflight.
//
// The host: GSTACK_EVALS_FAKE_HOST selects the keyless fake host (src/adapters/_fake/), which makes no model call, so a
// literal call (diet.md's) runs in tests. The real Claude Code and Codex adapters are U10's and the trial module U9's;
// until they land, a call on a real host stops after preflight's own checks.
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { FakeHostError, loadScript } from "../../adapters/_fake/host.ts";
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
import { FAKE_ADAPTER_SHA256, finishRun, runFake } from "./run.ts";
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
  return () => ({ code: "E_USAGE", message: "the " + call.host + " host adapter (U10) and the trial module (U9) are not built yet, so nothing can run on a real host" });
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
 * controls run as this user with the env allowlist: the lock is the author's own step on their own committed tasks, and
 * U9's container runner takes the same runner seam when it lands. Preflight, which honors --isolation, refuses to run
 * them under docker until then.
 */
async function lockWithChecks(argv: string[], io: Io): Promise<number> {
  const parsed = parseLockFlags(argv, ["--tasks", "--ext", "--before", "--policy"], ["--help", "-h"]);
  if (typeof parsed !== "string" && parsed.values.has("--tasks") && !parsed.set.size) {
    const contract = loadContract(parsed.values.get("--tasks")!, parsed.values.get("--ext"));
    if (contract.ok) {
      const vacuity = checkVacuity({ tasks: contract.tasks.tasks, dir: contract.tasks.dir, sidecar: contract.ext?.sidecar?.tasks ?? {} });
      for (const w of vacuity.warnings) io.err(w.code + " " + w.message);
      if (vacuity.stops.length) {
        for (const s of vacuity.stops) io.err(codeLines(s.code, [s.message, "--lock refuses a task set that fails the vacuity check, so a fix never needs a post-hoc relock."]));
        return 2;
      }
      io.out("vacuity: " + vacuity.results.filter((r) => r.status === "ok").length + " tasks bite on their control (the controls ran as this user with the env allowlist)");
    }
  }
  return lockCommand(argv, io);
}

function printStops(io: Io, stops: readonly Stop[]): void {
  for (const s of stops) io.err(codeLines(s.code, [s.message], s.fix));
}

export async function skillEvalCommand(argv: string[], io: Io = consoleIo, env: Env = process.env, mode: "run" | "preflight" = "run"): Promise<number> {
  if (mode === "run" && argv[0] === "init") return initCommand(argv.slice(1), io);
  if (mode === "run" && argv.includes("--lock")) return lockWithChecks(argv.filter((a) => a !== "--lock"), io);
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
    report = preflight(call, { env, dryRun: call.dryRun, host: hostCheck(call, env) });
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
    return runOnFakeHost(call, report, io, env, json);
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
    run = runFake({ models: call.models, arms: call.arms.arms.map((a) => a.name), tasks, trials: call.trials, cap: call.spendCap, ...(report.lock?.gate ? { gate: report.lock.gate } : {}) }, loadScript(env.GSTACK_EVALS_FAKE_HOST!));
  } catch (error) {
    if (!(error instanceof FakeHostError)) throw error;
    io.err(codeLines("E_USAGE", ["skill-eval: " + error.message], HINT));
    return 2;
  }
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
