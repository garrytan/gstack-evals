// How a task's check ended (U7, brief item 5): pass, fail, or an error that is never a fail. The seam U9's read-only check
// runner reports through; preflight's vacuity check uses it today.
//
// - Exit 0 passes. A check that did not run to an exit code (it timed out, could not start, or a signal ended it) is an
//   error: nothing graded the answer.
// - Exit 2 is an error. sh and bash exit 2 when they cannot parse the check, and test, grep and diff exit 2 on trouble,
//   so exit 2 says the check did not judge the answer.
// - Exit 126 and 127 depend on what was missing. When the command the shell could not find (127) or execute (126) is a
//   path inside the work dir, it is the artifact the answer was meant to create or make executable, so the check fails,
//   which is a valid failing control. Anything else (a tool missing from PATH, a path outside the work dir, a message
//   the rule cannot read) says the runner is broken, so it is an error.
// - Any other non-zero exit fails.
import { isAbsolute, relative, resolve } from "node:path";
import type { ShellResult } from "./vacuity.ts";

export type CheckVerdict = { kind: "pass" } | { kind: "fail" } | { kind: "error"; reason: string };

/** "sh: 1: ./bin/x: not found", "bash: ./x: Permission denied", "bash: line 1: x: command not found", "sh: 1: x: No such file or directory". */
const MISSING = /(?:^|\n)(?:[^\n:]*sh)?:?\s*(?:line )?\d*:?\s*([^\s:][^:\n]*): (?:not found|command not found|No such file or directory|Permission denied)\s*$/m;

export function judgeCheck(r: ShellResult, workDir: string): CheckVerdict {
  if (r.timedOut) return { kind: "error", reason: "check timed out" };
  if (r.exitCode === null) return { kind: "error", reason: "check did not run to an exit code: " + (r.error ?? "no exit status") };
  if (r.exitCode === 0) return { kind: "pass" };
  if (r.exitCode === 2) return { kind: "error", reason: "check exited 2, which says the shell could not parse it or a tool in it hit trouble, not that the answer failed" + (r.stderr.trim() ? ": " + r.stderr.trim().split("\n").slice(-1)[0]!.slice(0, 200) : "") };
  if (r.exitCode !== 126 && r.exitCode !== 127) return { kind: "fail" };
  const command = MISSING.exec(r.stderr)?.[1]?.trim();
  if (!command) return { kind: "error", reason: "check exited " + r.exitCode + " and its message does not name the missing command, so the runner may be broken" };
  const inside = command.includes("/") && !relative(workDir, resolve(workDir, command)).startsWith("..") && !(isAbsolute(command) && relative(workDir, command).startsWith(".."));
  if (inside) return { kind: "fail" };
  return { kind: "error", reason: "check exited " + r.exitCode + " because " + command + " is " + (r.exitCode === 127 ? "missing" : "not executable") + " outside the work dir, so the runner is broken, not the answer" };
}
