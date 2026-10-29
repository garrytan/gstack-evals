// gstack-evals skill-eval: the Lane A command (interface v0.5, v0.4 where v0.5 is silent). It routes init and --lock to
// U5's commands, resolves the call with its effective defaults, prints --dry-run's plan, and runs preflight before any
// spend. gstack-evals preflight runs the same steps and stops there. The fake-host run lands in U7's next pull request.
//
// The host: GSTACK_EVALS_FAKE_HOST selects the keyless fake host (src/adapters/_fake/), which makes no model call, so a
// literal call (diet.md's) runs in tests. The real Claude Code and Codex adapters are U10's and the trial module U9's;
// until they land, a call on a real host stops after preflight's own checks.
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT, type Io } from "../../cli.ts";
import type { ErrorContext } from "../../types.ts";
import { codeLines, consoleIo, parseFlags as parseLockFlags } from "../contract/cli-io.ts";
import { loadContract } from "../contract/sidecar.ts";
import { checkVacuity } from "../contract/vacuity.ts";
import { initCommand, lockCommand } from "../lock/cli.ts";
import { errorLines, errorRecord, scrubSecrets, writeErrorRecord } from "../verdict/error-record.ts";
import { effectiveLines, resolveCall, SKILL_EVAL_HELP, type Call } from "./call.ts";
import { planLines } from "./dry-run.ts";
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
  if (isFakeHost(env)) return () => null;
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

/** --lock runs the contract and vacuity checks first and refuses to lock a set that fails them (GST-109 decision 1). */
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
  const call = resolveCall(parsed, env);
  if ("code" in call) {
    io.err(codeLines(call.code, ["skill-eval: " + call.message], call.fix ?? (call.code === "E_USAGE" ? HINT : undefined)));
    if (json) writeErrorRecord(null, errorRecord({ code: call.code, operation: "call", message: call.message, context: errorContext(null, [], env) }, env), io.out);
    return 2;
  }
  io.out(effectiveLines(call).join("\n"));
  let report: PreflightReport | null = null;
  try {
    report = preflight(call, { env, dryRun: call.dryRun, host: hostCheck(call, env) });
    for (const w of report.warnings) io.err(w.code + " " + w.message);
    if (call.dryRun) {
      if (report.stops.length) return (printStops(io, report.stops), 2);
      io.out(planLines(report.plan!, call.parallel).join("\n"));
      return 0;
    }
    for (const line of report.passed) io.out("ok " + line);
    if (report.stops.length) {
      printStops(io, report.stops);
      if (report.plan && report.stops.some((s) => s.code === "E_USAGE" && s.message.startsWith("--spend-cap"))) io.out(planLines(report.plan, call.parallel).join("\n"));
      if (json) {
        const first = report.stops[0]!;
        writeErrorRecord(call.out.path, errorRecord({ code: first.code, operation: "preflight", message: report.stops.map((s) => s.code + " " + s.message).join("\n"), context: errorContext(call, report.env_names, env) }, env), io.out);
      }
      return 2;
    }
    if (mode === "preflight") {
      io.out("PREFLIGHT: pass (" + report.passed.length + " steps; nothing was spent)");
      return 0;
    }
    io.err(codeLines("E_USAGE", ["skill-eval: preflight passed, but the fake-host run lands in U7's next pull request"], HINT));
    return 2;
  } catch (error) {
    return internal(io, call, error, report?.env_names ?? [], env, json, mode);
  }
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
