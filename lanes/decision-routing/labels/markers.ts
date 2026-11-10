// Copyright (c) 2026 Garry Tan. MIT License.
// Runner-only markers for the live leak scan (prereg section 2 "Leak scan", section 15 B8). A task's markers are strings
// that exist only on the runner, so a decider request that carries one shows a custody hit:
// - each test function or class name (def test_x, async def test_x, class TestX) that the hidden test patch in the task's
//   tests/ adds and that the pristine repo at /testbed does not have;
// - each file path the test side adds that the pristine image does not have;
// - one random canary per task, planted in the label store beside the labels (canary.txt, owner-only, never committed).
// No marker is shorter than MIN_MARKER_CHARS, is an existing test name or path or part of one, or appears anywhere in the
// task's solution (the real fix) or its public instruction, so an agent diff equal to the real fix never hits.
// The pristine listing is an input; pristineListing reads it from the task's pristine image with no network.

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DockerRunner } from "./container.ts";

export const MIN_MARKER_CHARS = 12;
const CANARY = /^DRCANARY-[0-9a-f]{32}$/;
const NAMES = /(?:def|class)\s+(\w+)/;

export interface Pristine {
  /** Every path in the pristine repo at /testbed (git ls-files). */
  files: string[];
  /** Every def test* and class Test* name in the pristine repo. */
  testNames: string[];
}

export interface MarkerSources {
  /** The text of the task's tests/ files, which hold the hidden test patch. */
  testSide: string;
  /** The text of the task's solution/ files, which hold the real fix. */
  fixSide: string;
  /** Text the agent is shown anyway, such as instruction.md. */
  publicText: string;
  pristine: Pristine;
  canary: string;
}

/** The canary first, then the new test names and the new test-side paths, each sorted. */
export function runnerOnlyMarkers(s: MarkerSources): string[] {
  if (!CANARY.test(s.canary)) throw new Error("E_USAGE: markers: the canary is not a DRCANARY- string of 32 hex digits");
  const names = new Set<string>();
  const removed = new Set<string>();
  const paths = new Set<string>();
  let path: string | null = null;
  for (const line of s.testSide.split("\n")) {
    const git = /^diff --git a\/\S+ b\/(\S+)\s*$/.exec(line);
    if (git) { path = git[1]!; continue; }
    if (path && (line.startsWith("new file mode") || line === "--- /dev/null")) { paths.add(path); continue; }
    if (line.startsWith("+++ ") || line.startsWith("--- ")) continue;
    const added = /^\+\s*(?:async\s+)?def\s+(test\w*)\s*\(|^\+\s*class\s+(Test\w*)\b/.exec(line);
    if (added) names.add((added[1] ?? added[2])!);
    const gone = /^-\s*(?:async\s+)?def\s+(test\w*)\s*\(|^-\s*class\s+(Test\w*)\b/.exec(line);
    if (gone) removed.add((gone[1] ?? gone[2])!);
  }
  const existing = [...s.pristine.testNames, ...s.pristine.files, ...removed];
  const runnerOnly = (m: string) => m.length >= MIN_MARKER_CHARS && !existing.some((e) => e.includes(m)) && !s.fixSide.includes(m) && !s.publicText.includes(m);
  return [s.canary, ...[...names].filter(runnerOnly).sort(), ...[...paths].filter(runnerOnly).sort()];
}

const filesText = (dir: string) => (existsSync(dir) ? readdirSync(dir).sort().filter((f) => statSync(join(dir, f)).isFile()).map((f) => readFileSync(join(dir, f), "utf8")).join("\n") : "");

/** A Harbor task dir in the SWE-rebench export layout (tests/, solution/, instruction.md), as quick/laneb/runner/materialize.ts reads it. */
export function taskMarkers(taskDir: string, pristine: Pristine, canary: string): string[] {
  if (!existsSync(join(taskDir, "tests"))) throw new Error("E_USAGE: markers: " + taskDir + " has no tests/ directory");
  const instruction = join(taskDir, "instruction.md");
  return runnerOnlyMarkers({ testSide: filesText(join(taskDir, "tests")), fixSide: filesText(join(taskDir, "solution")), publicText: existsSync(instruction) ? readFileSync(instruction, "utf8") : "", pristine, canary });
}

/** The task's canary in <dir>/canary.txt, planted from crypto.getRandomValues on first use and read back after. */
export function plantCanary(dir: string): string {
  const file = join(dir, "canary.txt");
  if (existsSync(file)) {
    const canary = readFileSync(file, "utf8").trim();
    if (!CANARY.test(canary)) throw new Error("E_USAGE: markers: " + file + " does not hold a canary");
    return canary;
  }
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const canary = "DRCANARY-" + Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("hex");
  writeFileSync(file, canary + "\n", { mode: 0o600, flag: "wx" });
  return canary;
}

const LISTING = "cd /testbed && git ls-files && echo --names-- && (git grep -h -o -E '^[[:space:]]*(async[[:space:]]+)?(def[[:space:]]+test[A-Za-z0-9_]*|class[[:space:]]+Test[A-Za-z0-9_]*)' -- '*.py' || true)";

/** The pristine image's /testbed file list and test names, read in a container with no network. */
export async function pristineListing(docker: DockerRunner, image: string): Promise<Pristine> {
  const r = await docker.run(["run", "--rm", "--network", "none", "--entrypoint", "sh", image, "-c", LISTING], { timeoutMs: 300_000 });
  const [files, names] = r.stdout.split("--names--\n");
  if (r.code !== 0 || names === undefined) throw new Error("DR_LABEL_MISSING: markers: listing /testbed in " + image + " failed (exit " + r.code + "): " + r.stderr.trim().slice(0, 200));
  return { files: files!.split("\n").filter(Boolean), testNames: [...new Set(names.split("\n").flatMap((l) => NAMES.exec(l)?.[1] ?? []))].sort() };
}
