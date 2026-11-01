// Copyright (c) 2026 Garry Tan. MIT License.
// Grades one tree under test against a task's hidden tests (plan open item 2, adopting #102's verifier contract).
// The tree is a patch against the task image's starting tree. A prepare container (root, no network, empty
// environment) copies the pristine repository and its installed dependencies into a fresh volume, applies the patch,
// and restores gold's test files and runner config. Each run then mounts that volume read-only into a container from
// the same image as a non-root user, with no network, no capabilities, a read-only root filesystem and a CPU quota,
// and the verifier-owned entrypoint writes the per-test record. The B6 scorer grades a shipped head the same way.
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { docker } from "./docker.ts";
import { regressionFrozen, TaskError, targetOf, type TaskJson } from "./format.ts";
import { parseGoTest, parsePytest, resultFor, type Parsed, type TestResult } from "./record.ts";

export const RUN_UID = "10001:10001";

/** The line each run's sh entrypoint prints on stdout before it execs python or go test, so it comes out before any
 * interpreter, start-up hook or code from the tree runs. Code from the tree can only add to stdout after it, never take it back. */
export const RUN_STARTED = "real-verifier: started";

/** The pytest run's sh entrypoint: $0 is the image's python, the rest are vrun.py's arguments. */
export const PYTEST_ENTRY = 'echo "' + RUN_STARTED + '"; exec "$0" -s /verifier/vrun.py "$@"';

export interface RunRecord {
  seed: number;
  wall_ms: number;
  timed_out: boolean;
  exit: number;
  parsed: Parsed;
}

export interface TreeResult {
  label: string;
  /** skipped: patch sections git apply left out because they sit in installed-dependency directories; restored:
   * dependency directories the tree still changed, created or replaced, reset to the image's copy. */
  prepare: { patch: string; deleted: string[]; unlinked: string[]; skipped: string[]; restored: string[]; error?: string };
  runs: RunRecord[];
}

export interface VerifyOptions {
  taskDir: string;
  task: TaskJson;
  image: string;
  label: string;
  patch: string;
  runs: number;
  seed: number;
  /** Scratch directory on the host; each tree gets its own subdirectory. */
  work: string;
  releaseEdits?: boolean;
  cpus?: number;
}

/** Why a run has no verdict for the tree, or null when it has one. A run that never printed RUN_STARTED and did not
 * time out was never graded: Docker could not start the container or its sh entrypoint (exit 125 to 127). The
 * entrypoint prints RUN_STARTED before it execs python or go, so no interpreter, start-up hook (site.py, a .pth, a
 * sitecustomize in any form) or code from the tree (same user, can write /out and pick its own exit status) runs before
 * it, and every exit status, crash, missing record or missing /out/exit is the tree's outcome, a runner that fails to
 * start included. Every timeout is the tree's outcome too, with or without the line. */
export function runInfra(res: { status: number; stdout: string; timed_out: boolean }): string | null {
  if (res.timed_out || res.stdout.split("\n").includes(RUN_STARTED)) return null;
  return "the verifier never started (docker exited " + res.status + ")";
}

/** The ids a tree must pass: functional, escaped_defect and the frozen regression list. Refuses a task whose
 * regression list check --freeze-regression did not derive from regression_scope, or that changed since, so a grader
 * never drops the regression tests. */
export function requiredTests(t: TaskJson): string[] {
  if (!regressionFrozen(t)) throw new TaskError("E_REAL_TASK_FORMAT", t.id + ": tests.regression is not frozen from regression_scope, or changed since; run gstack-evals real task check --freeze-regression before grading");
  return [...t.tests.functional, ...t.tests.escaped_defect, ...t.tests.regression];
}

/** Where prepare.sh puts gold's pytest config in the tree, keeping the suffix pytest reads its format from. */
export const configName = (config: string): string => ".real-verifier-config." + (config.endsWith(".toml") ? "toml" : config.endsWith(".cfg") ? "cfg" : "ini");

/** Runner targets: test files for pytest, package dirs for go. Every required id's target, plus the regression scope. */
export function targets(t: TaskJson): string[] {
  const ids = [...t.tests.functional, ...t.tests.escaped_defect, ...t.tests.regression];
  return [...new Set([...ids.map(targetOf), ...t.tests.regression_scope])].sort();
}

function shuffled<T>(xs: T[], seed: number): T[] {
  const out = [...xs];
  let s = seed >>> 0 || 1;
  for (let i = out.length - 1; i > 0; i--) {
    s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const readLines = (p: string): string[] => (existsSync(p) ? readFileSync(p, "utf8").split("\n").filter(Boolean) : []);

export function verifyTree(o: VerifyOptions): TreeResult {
  const dir = join(o.work, o.label);
  rmSync(dir, { recursive: true, force: true });
  for (const d of ["input", "status"]) mkdirSync(join(dir, d), { recursive: true });
  chmodSync(join(dir, "status"), 0o777);
  writeFileSync(join(dir, "input/tree.patch"), o.patch);
  const volume = "real-verify-" + randomBytes(6).toString("hex");
  const tests = join(o.taskDir, "tests");
  const limits = o.task.limits;
  try {
    if (docker(["volume", "create", volume]).status !== 0) throw new TaskError("E_REAL_TASK_DOCKER", "docker volume create failed");
    const prep = docker(
      ["run", "--rm", "--network", "none", "--user", "0:0", "--entrypoint", "sh", "-e", "RELEASE_EDITS=" + (o.releaseEdits ? "1" : "0"), "-v", volume + ":/work", "-v", tests + ":/verifier:ro", "-v", join(dir, "input") + ":/input:ro", "-v", join(dir, "status") + ":/status", o.image, "/verifier/prepare.sh"],
      { timeoutMs: 600000 },
    );
    const prepState = readLines(join(dir, "status/prepare.txt"));
    const status = (name: string) => readLines(join(dir, "status", name));
    if (prepState[0] === "patch=failed") {
      return { label: o.label, prepare: { patch: "failed", deleted: [], unlinked: [], skipped: [], restored: [], error: status("apply.err").join(" ").slice(0, 400) }, runs: [] };
    }
    if (prep.status !== 0 || !prepState.includes("done")) {
      throw new TaskError("E_REAL_TASK_DOCKER", o.label + ": prepare failed (" + (prepState[0] ?? "exit " + prep.status) + "): " + (prep.stderr + readLines(join(dir, "status/apply.err")).join(" ")).trim().slice(0, 400));
    }
    const runs: RunRecord[] = [];
    for (let i = 0; i < o.runs; i++) {
      const seed = o.seed + i;
      const out = join(dir, "out-" + i);
      mkdirSync(out, { recursive: true });
      chmodSync(out, 0o777);
      writeFileSync(join(out, "targets.txt"), shuffled(targets(o.task), seed).join("\n") + "\n");
      const name = "real-run-" + randomBytes(6).toString("hex");
      const base = ["run", "--rm", "--name", name, "--network", "none", "--user", RUN_UID, "--read-only", "--tmpfs", "/tmp:rw,exec,size=2g", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--cpus", String(o.cpus ?? limits.cpus), "--memory", limits.memory, "--pids-limit", "2048", "-e", "HOME=/tmp", "-v", volume + ":/testbed:ro", "-v", tests + ":/verifier:ro", "-v", out + ":/out", "--workdir", "/testbed"];
      const r = o.task.runner;
      const cmd =
        r.kind === "pytest"
          ? [...base, "-e", "PYTHONDONTWRITEBYTECODE=1", "-e", "PYTHONPYCACHEPREFIX=/tmp/pycache", "--entrypoint", "sh", o.image, "-c", PYTEST_ENTRY, r.python, "/out/record.jsonl", "/testbed/" + configName(r.config), "/out/targets.txt", String(seed)]
          : [...base, "-e", "GOFLAGS=-mod=readonly", "-e", "GOPROXY=off", "-e", "GOTOOLCHAIN=local", "-e", "GOCACHE=/tmp/gocache", "-e", "GOTMPDIR=/tmp", "--entrypoint", "sh", o.image, "-c", 'echo "' + RUN_STARTED + '"; go test -json -count=1 -shuffle=' + seed + ' $(sed "s|^|./|" /out/targets.txt) > /out/record.jsonl 2> /out/stderr.txt; echo $? > /out/exit'];
      const res = docker(cmd, { timeoutMs: limits.verifier_sec * 1000 });
      if (res.timed_out) docker(["kill", name]);
      const infra = runInfra(res);
      if (infra) throw new TaskError("E_REAL_TASK_DOCKER", o.label + ": run " + (i + 1) + " of " + o.runs + " has no verdict: " + infra + ": " + res.stderr.trim().slice(0, 400));
      const record = existsSync(join(out, "record.jsonl")) ? readFileSync(join(out, "record.jsonl"), "utf8") : "";
      const parsed = r.kind === "pytest" ? parsePytest(record) : parseGoTest(record, existsSync(join(out, "stderr.txt")) ? readFileSync(join(out, "stderr.txt"), "utf8") : "", r.module);
      runs.push({ seed, wall_ms: res.wall_ms, timed_out: res.timed_out, exit: r.kind === "pytest" ? res.status : Number(readLines(join(out, "exit"))[0] ?? res.status), parsed });
    }
    return { label: o.label, prepare: { patch: prepState[0] ?? "", deleted: status("deleted.txt"), unlinked: status("unlinked.txt"), skipped: status("skipped.txt"), restored: status("restored.txt") }, runs };
  } finally {
    docker(["volume", "rm", "-f", volume]);
  }
}

/** One id's result in each run. */
export const idResults = (tree: TreeResult, id: string): TestResult[] => tree.runs.map((r) => resultFor(r.parsed, id));

/** Whether every required id passed in every run. */
export function allPass(tree: TreeResult, ids: string[]): boolean {
  return tree.runs.length > 0 && ids.every((id) => idResults(tree, id).every((r) => r.status === "pass"));
}
