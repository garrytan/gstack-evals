// gstack-evals validate: checks a tasks file with the same rules as gstack's checkEvalTasks, and its tasks.ext.json
// sidecar when --ext names one or one sits beside the tasks file. Exit 0 when both are clean, 2 with E_TASKS_INVALID
// when either has a problem. The vacuity check needs the fixture, so preflight runs it, not validate.
import { relative } from "node:path";
import type { Io } from "../../cli.ts";
import { codeLines, consoleIo, parseFlags, usage } from "./cli-io.ts";
import { isInteractive, loadContract } from "./sidecar.ts";

const HELP = "gstack-evals validate --tasks <tasks.json> [--ext <tasks.ext.json>] [--json]";

export async function validateCommand(argv: string[], io: Io = consoleIo): Promise<number> {
  const parsed = parseFlags(argv, ["--tasks", "--ext"], ["--json", "--help", "-h"]);
  if (typeof parsed === "string") return usage(io, "validate: " + parsed, HELP);
  if (parsed.set.has("--help") || parsed.set.has("-h")) {
    io.out("Usage: " + HELP);
    return 0;
  }
  const tasksFile = parsed.values.get("--tasks");
  if (!tasksFile) return usage(io, "validate: --tasks is required", HELP);
  const contract = loadContract(tasksFile, parsed.values.get("--ext"));
  const { tasks, ext } = contract;
  const entries = Object.entries(ext?.sidecar?.tasks ?? {});
  if (parsed.set.has("--json")) {
    io.out(JSON.stringify({
      schema_version: 1,
      ok: contract.ok,
      tasks: { path: tasks.path, sha256: tasks.sha256, count: tasks.count, safety: tasks.tasks.filter((t) => t.safety === true).length, problems: tasks.problems },
      ext: ext && { path: ext.path, sha256: ext.sha256, entries: entries.length, problems: ext.problems },
    }, null, 2));
  }
  const show = (path: string) => {
    const rel = relative(process.cwd(), path);
    return rel && !rel.startsWith("..") ? rel : path;
  };
  if (!contract.ok) {
    const lines = [...tasks.problems.map((p) => show(tasks.path) + ": " + p), ...(ext?.problems ?? []).map((p) => show(ext!.path) + ": " + p)];
    io.err(codeLines("E_TASKS_INVALID", lines));
    return 2;
  }
  if (parsed.set.has("--json")) return 0;
  const safety = tasks.tasks.filter((t) => t.safety === true).length;
  const sidecar = ext
    ? show(ext.path) + ": " + entries.length + " entries (" + entries.filter(([, e]) => isInteractive(e)).length + " interactive, " + entries.filter(([, e]) => e.mutant).length + " with a mutant)"
    : "no tasks.ext.json";
  io.out("OK " + show(tasks.path) + ": " + tasks.count + " tasks (" + safety + " safety); " + sidecar);
  return 0;
}

export const main = (argv: string[]): Promise<number> => validateCommand(argv);
