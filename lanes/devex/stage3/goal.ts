// Copyright (c) 2026 Garry Tan. MIT License.
// Stage 3's sealed goal records and their audit (prereg 2026-11-09-geva-417, section 12 "Build units"). For each build
// unit the key writer writes, before stage 3, from plan.md and the real merged change and blind to every arm: one frozen
// first-success goal ("use the new <surface> to <outcome>") with a checker script that decides it, and 3 frozen misuse
// probes. An auditor runs the goal and the probes against the real merged tree, inside the sandbox: the goal must pass
// and each probe must reach the new surface's error path. A unit that fails its audit twice is replaced in seeded order
// (build.ts drawBuildUnits). Records live sealed outside the repo; this file holds only their shape and the audit.
import type { ExecResult } from "./sandbox.ts";

export type ProbeKind = "cli" | "api";

export interface Probe {
  id: string;
  /** A CLI command, or for an API a request the sandbox sends to the running server. */
  kind: ProbeKind;
  /** The misuse, for example a required argument missing, a bad config value or a missing credential. */
  misuse: string;
  /** The shell command that runs the probe inside the sandbox. */
  command: string;
  /** Text the merged change's error path for this misuse prints, read by the key writer from the real merged change. */
  error_path: string;
}

/** How a unit's project builds its artifact and installs it, the same recipe at base, at the merge and on a built tree. */
export interface Recipe {
  /** Builds the artifact from /work/repo and prints its path on the last line. */
  build: string;
  /** Installs the artifact found at $ARTIFACT. */
  install: string;
  /** Prints the installed artifact's help output. */
  help: string;
}

export interface GoalRecord {
  unit: string;
  surface: string;
  goal: string;
  /** The checker script; exit 0 means the goal is met. */
  checker: string;
  probes: [Probe, Probe, Probe];
  recipe: Recipe;
}

export const GOAL_SHAPE = /^use the new \S.* to \S.*/i;

export function goalProblems(r: GoalRecord): string[] {
  const out: string[] = [];
  if (!GOAL_SHAPE.test(r.goal.trim())) out.push("the goal is not of the form \"use the new <surface> to <outcome>\"");
  if (!r.checker.trim()) out.push("the checker script is empty");
  if (!Array.isArray(r.probes) || r.probes.length !== 3) out.push("a goal record needs exactly 3 misuse probes");
  else if (new Set(r.probes.map((p) => p.id)).size !== 3) out.push("probe ids repeat");
  for (const p of r.probes ?? []) if (!p.error_path.trim()) out.push("probe " + p.id + " names no error path");
  return out;
}

export interface AuditResult {
  pass: boolean;
  goal: boolean;
  probes: boolean[];
  problems: string[];
}

/** Runs commands against the real merged tree inside the sandbox. */
export type TreeRunner = (command: string) => Promise<ExecResult>;

/** One audit attempt: the record's shape, then the checker passing and each probe reaching its error path. */
export async function audit(r: GoalRecord, run: TreeRunner): Promise<AuditResult> {
  const problems = goalProblems(r);
  if (problems.length) return { pass: false, goal: false, probes: [], problems };
  const goal = (await run(r.checker)).exit === 0;
  const probes: boolean[] = [];
  for (const p of r.probes) {
    const x = await run(p.command);
    probes.push((x.stdout + "\n" + x.stderr).includes(p.error_path));
  }
  if (!goal) problems.push("the goal's checker fails on the merged tree");
  probes.forEach((ok, i) => ok || problems.push("probe " + r.probes[i]!.id + " does not reach its error path"));
  return { pass: goal && probes.every(Boolean), goal, probes, problems };
}
