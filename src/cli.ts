// The gstack-evals command table and dispatcher. bin/gstack-evals calls run().
//
// A command runs once its module exists at the path below and exports main (CommandMain in src/types.ts). Until
// then it exits 2 with E_USAGE "not built yet". A unit that builds a command creates its module; it edits its row
// here only to move the path or the summary.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CODES, docAnchor } from "./errors/codes.ts";
import { scrubSecrets } from "./skill-eval/verdict/error-record.ts";
import type { CommandMain } from "./types.ts";

export const REPO_ROOT = join(import.meta.dir, "..");

export interface Command {
  name: string;
  summary: string;
  /** Repo-relative path of the module that exports main. */
  module: string;
  /** The unit that builds it, and its milestone; v1.1 commands have no unit yet. */
  owner: string;
}

export const COMMANDS: Command[] = [
  { name: "skill-eval", summary: "Before/after skill eval (Lane A): did an edited skill lose anything? Also init, --lock and --example.", module: "src/skill-eval/cli/skill-eval.ts", owner: "U7, M1a" },
  { name: "validate", summary: "Check a tasks file with the same rules as gstack's checkEvalTasks.", module: "src/skill-eval/contract/validate-cli.ts", owner: "U5, M1a" },
  { name: "doctor", summary: "Check Bun, Docker, the trial image, the host CLI, keys by name and both ledger paths.", module: "src/skill-eval/cli/doctor.ts", owner: "U7, M1a" },
  { name: "preflight", summary: "Run the free checks every paid command runs first: keys, host, policy, lock, ledger, vacuity.", module: "src/skill-eval/cli/preflight.ts", owner: "U7, M1a" },
  { name: "explain", summary: "Print a reason code's meaning, fix, side effects, retry safety and resumability.", module: "src/skill-eval/cli/explain.ts", owner: "U7, M1a" },
  { name: "ledger", summary: "Record approved caps and line items with the owner's words; settle and reconcile leases.", module: "src/runner/ledger/cli.ts", owner: "U4, M0" },
  { name: "rig", summary: "Run the Docker tier, run the keyless rig probes, and admit a line item's next lease (docs/rig.md).", module: "src/rig/cli.ts", owner: "U20, M1b" },
  { name: "tokens", summary: "Export the review token table for gstack's review-dispatch-compare.", module: "lanes/review-replay/tokens-cli.ts", owner: "U13, M1c" },
  { name: "noloss", summary: "Review no-loss category: suites, arm ingest, paired scoring, export, power and blinded judge packets.", module: "lanes/review-noloss/cli.ts", owner: "U13, GSTA-43, GSTA-45" },
  { name: "review-units", summary: "Run review units as Lane A trials: unit repos from head-only fetches, the told prompt, the findings parser and cost.tsv.", module: "src/trial/review/cli.ts", owner: "U9, GST-381" },
  { name: "route-check", summary: "Check a model's OpenRouter route before E1: a tool round trip, a plan-findings block and metering within 10% of the bill.", module: "src/trial/review/route-check.ts", owner: "GEVA-203, C1" },
  { name: "waste", summary: "Count wasted work in crew logs: re-runs, polls and waits in thread exports, review rounds past the cap in /ship receipts, per-PR replay data.", module: "src/waste/crewlog.ts", owner: "GST-1114" },
  { name: "real", summary: "Real-world outcome lane: mining, task format, ship sandbox, arms and scoring (plan 2026-11-01-geva-87).", module: "lanes/real-outcome/cli.ts", owner: "RO-B1 to RO-B7, GST-690" },
  { name: "plan", summary: "Check a preregistration and its commit order before a counted run.", module: "src/runner/prereg/cli.ts", owner: "v1.1" },
  { name: "run", summary: "Run a preregistered Lane B matrix.", module: "src/runner/run.ts", owner: "v1.1" },
  { name: "score", summary: "Grade finished trials from their receipts.", module: "src/grade/cli.ts", owner: "v1.1" },
  { name: "report", summary: "Write a run's report from its receipts.", module: "src/runner/report.ts", owner: "v1.1" },
  { name: "compare", summary: "Keep or revert a candidate for the factory loop.", module: "src/runner/compare.ts", owner: "later" },
  { name: "seal", summary: "Seal a held-out set: digests and metadata into sealed/<set>/MANIFEST.json.", module: "src/runner/seal.ts", owner: "v1.1" },
];

export interface Io {
  out: (text: string) => void;
  err: (text: string) => void;
}

const built = (root: string, c: Command) => existsSync(join(root, c.module));

function version(root: string): string {
  try {
    return readFileSync(join(root, "VERSION"), "utf8").trim();
  } catch {
    return "unknown";
  }
}

export function helpText(root = REPO_ROOT): string {
  const width = Math.max(...COMMANDS.map((c) => c.name.length));
  const lines = [
    "gstack-evals " + version(root) + ": an outcome-graded eval rig for gstack",
    "",
    "Usage: gstack-evals <command> [options]",
    "",
    "Commands:",
  ];
  for (const c of COMMANDS) {
    lines.push("  " + c.name.padEnd(width) + "  " + c.summary + (built(root, c) ? "" : " [not built yet: " + c.owner + "]"));
  }
  lines.push("", "Reason codes: docs/errors.md. Every error line on stderr starts with its code.");
  return lines.join("\n");
}

function errorLines(code: "E_USAGE" | "E_INTERNAL", message: string, fix: string = CODES[code].fix): string {
  return [message, "fix: " + fix, "docs: " + docAnchor(code)]
    .flatMap((text) => text.split(/\r\n|\r|\n/))
    .map((line) => code + " " + line)
    .join("\n");
}

function usageError(io: Io, message: string): number {
  io.err(errorLines("E_USAGE", message));
  return 2;
}

function internalError(io: Io, command: Command, message: string): number {
  io.err(errorLines("E_INTERNAL", "gstack-evals " + command.name + ": " + scrubSecrets(message), "this is a defect in " + command.module + ", not in your input. File an issue with these lines."));
  return 2;
}

export async function run(argv: string[], io: Io = { out: console.log, err: console.error }, root = REPO_ROOT): Promise<number> {
  const [name, ...rest] = argv;
  if (name === "--help" || name === "-h" || name === "help") {
    io.out(helpText(root));
    return 0;
  }
  if (name === "--version" || name === "-V") {
    io.out(version(root));
    return 0;
  }
  if (name === undefined) return usageError(io, "no command given; gstack-evals --help lists them");
  const command = COMMANDS.find((c) => c.name === name);
  if (!command) return usageError(io, "unknown command " + JSON.stringify(name) + "; gstack-evals --help lists the commands");
  if (!built(root, command)) return usageError(io, "gstack-evals " + command.name + " is not built yet (" + command.owner + "; it will live at " + command.module + ")");
  let code: unknown;
  try {
    const mod = (await import(join(root, command.module))) as { main?: CommandMain };
    if (typeof mod.main !== "function") throw new Error(command.module + " does not export main");
    code = await mod.main(rest);
  } catch (error) {
    return internalError(io, command, error instanceof Error ? error.message : String(error));
  }
  if (code === 0 || code === 1 || code === 2 || code === 3) return code;
  return internalError(io, command, "main returned " + String(code) + ", not an exit code from 0 to 3");
}
