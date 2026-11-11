// Copyright (c) 2026 Garry Tan. MIT License.
// Grades one tree under test against a task's hidden tests (plan open item 2, adopting #102's verifier contract).
// The tree is a patch against the task image's starting tree. A prepare container (root, no network, empty
// environment) copies the pristine repository and its installed dependencies into a fresh volume, applies the patch,
// and restores gold's test files and runner config. Each run then mounts that volume read-only into a container from
// the same image as a non-root user, with no network, no capabilities, a read-only root filesystem and a CPU quota,
// and the verifier-owned entrypoint writes the per-test record to /out, a capped tmpfs volume a second container holds
// open for the host to read. The B6 scorer grades a shipped head the same way.
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { docker, dockerRun } from "./docker.ts";
import { regressionFrozen, sha256, TaskError, targetOf, type Runner, type TaskJson } from "./format.ts";
import { jsFailClass, parseCargo, parseGoTest, parseJestJson, parseMochaJson, parseNodeEvents, parsePytest, resultFor, type Parsed, type TestResult } from "./record.ts";
import { productText, splice } from "./region.ts";

export const RUN_UID = "10001:10001";

/** Each run's /out is a tmpfs volume this size, with this many inodes, so nothing a run writes there reaches the host
 * disk. A run that leaves it full fails. */
export const OUT_MIB = 256;
export const OUT_INODES = 1024;

/** The line each run's sh entrypoint prints on stdout before it execs python or go test, so it comes out before any
 * interpreter, start-up hook or code from the tree runs. Code from the tree can only add to stdout after it, never take it back. */
export const RUN_STARTED = "real-verifier: started";

/** The pytest run's sh entrypoint: $0 is the image's python, the rest are vrun.py's arguments. */
export const PYTEST_ENTRY = 'echo "' + RUN_STARTED + '"; exec "$0" -s /verifier/vrun.py "$@"';

export interface RunRecord {
  seed: number;
  wall_ms: number;
  timed_out: boolean;
  /** /out had no free block or inode after the run: the tree overran the verifier's output space, so the run fails. */
  out_full: boolean;
  /** The docker client died before the container (ENOBUFS once the run's output passed its buffer), so the verifier
   * killed and removed the run before it ended: the run fails. */
  killed: boolean;
  exit: number;
  parsed: Parsed;
}

/** The cold rebuild's record: ignored build outputs the tree brought (removed), the build's outcome, the tree's product
 * file hashes as given (test regions taken out), and product files the rebuild or the test move changed. */
export interface ColdRecord {
  removed: string[];
  build: "none" | "ok" | "failed" | "timeout";
  products: Record<string, string>;
  changed: string[];
}

export interface TreeResult {
  label: string;
  /** skipped: patch sections git apply left out because they sit in installed-dependency directories; restored:
   * dependency directories the tree still changed, created or replaced, reset to the image's copy. */
  prepare: { patch: string; deleted: string[]; unlinked: string[]; skipped: string[]; restored: string[]; error?: string; cold?: ColdRecord };
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
  /** The restore set mounted as /verifier: the task's tests/ by default, or another set (an aftermath group) laid out
   * the same way. */
  testsDir?: string;
  /** The ids this run reads, in place of the task's lists: a restore set run apart reads only its own ids. */
  ids?: string[];
  /** Cold rebuild (the eng-review build read): drop ignored build outputs the tree brought, run runner.build offline as
   * the run user, restore the hidden tests and installed dependencies again, move test regions, and hash the product
   * files before and after. */
  cold?: boolean;
  /** Called with the prepared tree before the first run; it throws to refuse the tree (a product hash mismatch). */
  beforeRuns?: (prepare: TreeResult["prepare"]) => void;
}

/** The most READ_OUT reads of one /out file: well under the docker client's 256 MiB output buffer and no larger than
 * /out. A sparse file takes no /out block, so the tree can give one any apparent size; a file past this cap is the
 * tree's doing and reads as absent, so the read never dies at the buffer or the timeout. */
export const OUT_READ_BYTES = 64 * 1024 * 1024;

/** Reads one /out file in the container holding /out; exit 3 when the tree left no regular file there it can read, or one
 * whose apparent size passes OUT_READ_BYTES. A stat the verifier could not make exits 1. */
export const READ_OUT = '[ -f "$1" ] && [ ! -L "$1" ] && [ -r "$1" ] || exit 3; s=$(stat -c %s -- "$1") || exit 1; [ "$s" -gt ' + OUT_READ_BYTES + " ] && exit 3; exec head -c " + OUT_READ_BYTES + ' -- "$1"';

/** One /out file's text from READ_OUT: null when the tree left no regular file it can read (exit 3, the tree's
 * outcome), undefined when the verifier itself could not read it (any other exit), so the run has no verdict. */
export const outText = (f: { status: number; stdout: string }): string | null | undefined => (f.status === 0 ? f.stdout : f.status === 3 ? null : undefined);

/** A run that timed out, left /out full or was killed past the output buffer: it passes nothing. */
export const stopped = (r: RunRecord): boolean => r.timed_out || r.out_full || r.killed;

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
export function targets(t: TaskJson, only?: string[]): string[] {
  if (only) return [...new Set(only.map(targetOf))].sort();
  const ids = [...t.tests.functional, ...t.tests.escaped_defect, ...t.tests.regression];
  return [...new Set([...ids.map(targetOf), ...t.tests.regression_scope])].sort();
}

/** The sh entrypoint of a node runner: $0 is the project dir, the rest is the runner's argv, and the start line comes out
 * before node starts. Its stderr goes to /out/stderr.txt, read only when the record holds no result (a run that died
 * before its reporter wrote anything fails as a session collection failure). */
export const NODE_ENTRY = 'echo "' + RUN_STARTED + '"; cd "$0" && exec "$@" 2> /out/stderr.txt';

/** The directory a project-relative path lives in, under /testbed. */
const inRepo = (root: string, path = ""): string => ["/testbed", root, path].filter(Boolean).join("/");

/** cargo test's target selectors for target sources relative to the project dir. */
export function cargoSelectors(root: string, sources: string[]): string[] {
  const sel = new Set<string>();
  for (const s of sources) {
    const p = (root && s.startsWith(root + "/") ? s.slice(root.length + 1) : s).split("/");
    if (p[0] === "tests" && p.length === 2) sel.add("--test=" + p[1].replace(/\.rs$/, ""));
    else if (p[0] === "tests" && p.length === 3 && p[2] === "main.rs") sel.add("--test=" + p[1]);
    else if (p[0] === "src" && p[p.length - 1] === "main.rs" && p.length === 2) sel.add("--bins");
    else sel.add("--lib");
  }
  return [...sel].sort();
}

/** The docker run environment and the entrypoint arguments after the image for one hidden run of a node runner or cargo. */
export function runArgs(r: Exclude<Runner, { kind: "pytest" | "go" }>, files: string[]): { env: string[]; entry: string[] } {
  const rel = files.map((f) => (r.root && f.startsWith(r.root + "/") ? f.slice(r.root.length + 1) : f));
  if (r.kind === "cargo") {
    const script = [
      'echo "' + RUN_STARTED + '"',
      "export RUSTUP_TOOLCHAIN=$(ls /usr/local/rustup/toolchains 2>/dev/null | head -1 | sed 's/-x86_64.*//')",
      "mkdir -p /tmp/cargo",
      "for d in registry git; do [ -e /usr/local/cargo/$d ] && ln -s /usr/local/cargo/$d /tmp/cargo/$d; done",
      'cd "$0" && cargo test --offline ' + (r.package ? "-p " + r.package.replace(/[^\w.-]/g, "") + " " : "") + cargoSelectors(r.root, files).join(" ") + " --no-fail-fast -- --test-threads=1 > /out/record.txt 2>&1; echo $? > /out/exit",
    ].join("; ");
    return { env: ["-e", "CARGO_HOME=/tmp/cargo", "-e", "CARGO_TARGET_DIR=/tmp/target", "-e", "CARGO_INCREMENTAL=0", "-e", "CARGO_TERM_COLOR=never", "-e", "CARGO_BUILD_JOBS=2"], entry: ["-c", script, inRepo(r.root)] };
  }
  const node = ["node", ...r.node_args];
  const bin = inRepo("", r.bin);
  const cfg = r.config === null ? null : r.config.startsWith("{") ? r.config : inRepo("", r.config);
  const argv =
    r.kind === "jest"
      ? [...node, bin, ...r.args, "--ci", "--json", "--outputFile=/out/record.json", "--cacheDirectory=/tmp/jest", "--watchAll=false", "--rootDir=" + inRepo(r.root), "--config", cfg ?? JSON.stringify({ rootDir: inRepo(r.root) }), "--runTestsByPath", ...rel]
      : r.kind === "vitest"
        ? [...node, bin, "run", ...r.args, "--root", inRepo(r.root), "--config", cfg ?? (r.args.includes("--configLoader") ? "/verifier/vitest.none.mjs" : "/verifier/vitest.none.cjs"), "--reporter=json", "--outputFile=/out/record.json", "--watch=false", ...rel]
        : r.kind === "mocha"
          ? [...node, bin, ...r.args, "--no-config", "--no-package", ...(cfg ? ["--config", cfg] : []), "--reporter", "json", "--reporter-option", "output=/out/record.json", ...rel]
          : [...node, ...r.args, "--test", "--test-reporter=/verifier/node-reporter.mjs", "--test-reporter-destination=/out/record.jsonl", ...rel];
  return { env: ["-e", "NODE_OPTIONS=", "-e", "CI=true", "-e", "TZ=UTC", "-e", "NO_COLOR=1", "-e", "FORCE_COLOR=0", "-e", "npm_config_cache=/tmp/npm", "-e", "XDG_CACHE_HOME=/tmp/cache"], entry: ["-c", NODE_ENTRY, inRepo(r.root), ...argv] };
}

/** One run's record, parsed by the runner's own parser. */
export function parseRecord(r: Runner, read: (file: string) => string | null): Parsed {
  if (r.kind === "pytest") return parsePytest(read("record.jsonl") ?? "");
  if (r.kind === "go") return parseGoTest(read("record.jsonl") ?? "", read("stderr.txt") ?? "", r.module);
  if (r.kind === "cargo") return parseCargo(read("record.txt") ?? "", r.root);
  const p = r.kind === "nodetest" ? parseNodeEvents(read("record.jsonl") ?? "") : r.kind === "mocha" ? parseMochaJson(read("record.json") ?? "") : parseJestJson(read("record.json") ?? "");
  if (p.seen.length > 0 || Object.keys(p.results).length > 0) return p;
  const err = (read("stderr.txt") ?? "").slice(-4000);
  if (!err.trim()) return p;
  const c = jsFailClass(err);
  return { ...p, results: { "collect:<session>": { status: "fail", cls: c.cls === "assert" ? "load" : c.cls, ...(c.name ? { name: c.name } : {}), msg: err.slice(-300) } } };
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
  const tests = o.testsDir ?? join(o.taskDir, "tests");
  const limits = o.task.limits;
  try {
    if (docker(["volume", "create", volume]).status !== 0) throw new TaskError("E_REAL_TASK_DOCKER", "docker volume create failed");
    const prep = dockerRun(
      "real-prepare-" + randomBytes(6).toString("hex"),
      ["--rm", "--network", "none", "--user", "0:0", "--entrypoint", "sh", "-e", "RELEASE_EDITS=" + (o.releaseEdits ? "1" : "0"), "-v", volume + ":/work", "-v", tests + ":/verifier:ro", "-v", join(dir, "input") + ":/input:ro", "-v", join(dir, "status") + ":/status", o.image, "/verifier/prepare.sh"],
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
    const prepared: TreeResult["prepare"] = { patch: prepState[0] ?? "", deleted: status("deleted.txt"), unlinked: status("unlinked.txt"), skipped: status("skipped.txt"), restored: status("restored.txt") };
    if (o.cold) prepared.cold = coldRebuild(o, volume, tests, join(dir, "status"));
    o.beforeRuns?.(prepared);
    const runs: RunRecord[] = [];
    for (let i = 0; i < o.runs; i++) {
      const seed = o.seed + i;
      const name = "real-run-" + randomBytes(6).toString("hex");
      const out = name + "-out";
      const noVerdict = (what: string, r: { status: number; stderr: string }) => new TaskError("E_REAL_TASK_DOCKER", o.label + ": run " + (i + 1) + " of " + o.runs + " has no verdict: " + what + " (docker exited " + r.status + "): " + r.stderr.trim().slice(0, 400));
      try {
        const vol = docker(["volume", "create", "--driver", "local", "--opt", "type=tmpfs", "--opt", "device=tmpfs", "--opt", "o=size=" + OUT_MIB + "m,nr_inodes=" + OUT_INODES + ",uid=10001,gid=10001,mode=0700", out]);
        if (vol.status !== 0) throw noVerdict("the /out volume was not created", vol);
        const holder = dockerRun(out, ["-d", "--rm", "--network", "none", "--user", RUN_UID, "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "-v", out + ":/out", "--entrypoint", "sleep", o.image, "infinity"], { timeoutMs: 120000 });
        if (holder.status !== 0) throw noVerdict("the container holding /out did not start", holder);
        const order = shuffled(targets(o.task, o.ids), seed);
        const put = docker(["exec", "-i", out, "sh", "-c", "cat > /out/targets.txt"], { input: order.join("\n") + "\n", timeoutMs: 120000 });
        if (put.status !== 0) throw noVerdict("the targets were not written to /out", put);
        const base = ["--rm", "--network", "none", "--user", RUN_UID, "--read-only", "--tmpfs", "/tmp:rw,exec,size=2g", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--cpus", String(o.cpus ?? limits.cpus), "--memory", limits.memory, "--pids-limit", "2048", "-e", "HOME=/tmp", "-v", volume + ":/testbed:ro", "-v", tests + ":/verifier:ro", "-v", out + ":/out", "--workdir", "/testbed"];
        const r = o.task.runner;
        const other = r.kind !== "pytest" && r.kind !== "go" ? runArgs(r, order) : null;
        const cmd =
          r.kind === "pytest"
            ? [...base, "-e", "PYTHONDONTWRITEBYTECODE=1", "-e", "PYTHONPYCACHEPREFIX=/tmp/pycache", "--entrypoint", "sh", o.image, "-c", PYTEST_ENTRY, r.python, "/out/record.jsonl", "/testbed/" + configName(r.config), "/out/targets.txt", String(seed)]
            : r.kind === "go"
              ? [...base, "-e", "GOFLAGS=-mod=readonly", "-e", "GOPROXY=off", "-e", "GOTOOLCHAIN=local", "-e", "GOCACHE=/tmp/gocache", "-e", "GOTMPDIR=/tmp", "--entrypoint", "sh", o.image, "-c", 'echo "' + RUN_STARTED + '"; go test -json -count=1 -shuffle=' + seed + ' $(sed "s|^|./|" /out/targets.txt) > /out/record.jsonl 2> /out/stderr.txt; echo $? > /out/exit']
              : [...base, ...other!.env, "--entrypoint", "sh", o.image, ...other!.entry];
        const res = dockerRun(name, cmd, { timeoutMs: limits.verifier_sec * 1000 });
        const infra = runInfra(res);
        if (infra) throw new TaskError("E_REAL_TASK_DOCKER", o.label + ": run " + (i + 1) + " of " + o.runs + " has no verdict: " + infra + ": " + res.stderr.trim().slice(0, 400));
        const space = docker(["exec", out, "stat", "-f", "-c", "%a %d", "/out"], { timeoutMs: 120000 });
        if (space.status !== 0) throw noVerdict("/out could not be read", space);
        const [blocks, inodes] = space.stdout.trim().split(" ").map(Number);
        const read = (file: string): string | null => {
          const f = docker(["exec", out, "sh", "-c", READ_OUT, "sh", "/out/" + file], { timeoutMs: 120000 });
          const text = outText(f);
          if (text === undefined) throw noVerdict("/out/" + file + " could not be read", f);
          return text;
        };
        const parsed = parseRecord(r, read);
        const exitLine = r.kind === "go" || r.kind === "cargo" ? (read("exit") ?? "").split("\n").filter(Boolean)[0] : undefined;
        runs.push({ seed, wall_ms: res.wall_ms, timed_out: res.timed_out, out_full: blocks === 0 || inodes === 0, killed: res.error !== undefined && !res.timed_out, exit: Number(exitLine ?? res.status), parsed });
      } finally {
        docker(["rm", "-f", out]);
        docker(["volume", "rm", "-f", out]);
      }
    }
    return { label: o.label, prepare: prepared, runs };
  } finally {
    docker(["volume", "rm", "-f", volume]);
  }
}

/** One id's result in each run. */
export const idResults = (tree: TreeResult, id: string): TestResult[] => tree.runs.map((r) => resultFor(r.parsed, id));

/** Whether every required id passed in every run. Nothing required passes nothing, and a run that timed out, left /out
 * full or was killed past the output buffer fails whatever its record says. */
export function allPass(tree: TreeResult, ids: string[]): boolean {
  return tree.runs.length > 0 && ids.length > 0 && tree.runs.every((r) => !stopped(r)) && ids.every((id) => idResults(tree, id).every((r) => r.status === "pass"));
}


/** Reads one tree file in the prepared volume: exit 3 when it is not a regular file. */
const READ_TREE = '[ -f "$1" ] && [ ! -L "$1" ] || exit 3; exec cat -- "$1"';
/** Writes one tree file in the prepared volume from stdin, clearing any symlink at or above it first. */
const WRITE_TREE = 'set -f; acc=/work; IFS=/; for c in $2; do acc=$acc/$c; [ -L "$acc" ] && rm -f "$acc"; done; mkdir -p "$(dirname "$1")" && rm -rf "$1" && cat > "$1" && chmod a+r "$1"';

/** The cold rebuild between prepare and the first run (VerifyOptions.cold): every step but the rebuild itself runs as
 * root with no network and never runs tree code; the rebuild runs as the run user with no network, fresh caches in
 * /tmp and a read-only root. */
function coldRebuild(o: VerifyOptions, volume: string, tests: string, status: string): ColdRecord {
  const r = o.task.runner;
  const build = r.kind !== "pytest" && r.kind !== "go" ? r.build : null;
  const root = r.kind !== "pytest" && r.kind !== "go" ? r.root : "";
  const asRoot = (what: string, args: string[], input?: string) => {
    const res = dockerRun("real-cold-" + randomBytes(6).toString("hex"), ["--rm", "-i", "--network", "none", "--user", "0:0", "--entrypoint", "sh", "-v", volume + ":/work", ...args], { timeoutMs: 600000, input });
    if (res.status !== 0 && res.status !== 3) throw new TaskError("E_REAL_TASK_DOCKER", o.label + ": cold rebuild " + what + " failed (docker exited " + res.status + "): " + res.stderr.trim().slice(0, 400));
    return res;
  };
  const step = (mode: string) => asRoot(mode, ["-e", "MODE=" + mode, "-e", "BUILD=" + (build ? "1" : "0"), "-v", tests + ":/verifier:ro", "-v", status + ":/status", o.image, "/verifier/cold.sh"]);
  const readTree = (path: string): string | null => {
    const res = asRoot("read of " + path, [o.image, "-c", READ_TREE, "sh", "/work/" + path]);
    return res.status === 0 ? res.stdout : null;
  };
  step("clean");
  const regions = readLines(join(tests, "regions.list"));
  const before = new Map(regions.map((p) => [p, readTree(p)]));
  let state: ColdRecord["build"] = "none";
  if (build) {
    const limits = o.task.limits;
    const res = dockerRun("real-build-" + randomBytes(6).toString("hex"), ["--rm", "--network", "none", "--user", RUN_UID, "--read-only", "--tmpfs", "/tmp:rw,exec,size=2g", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--cpus", String(o.cpus ?? limits.cpus), "--memory", limits.memory, "--pids-limit", "2048", "-e", "HOME=/tmp", "-e", "CI=true", "-e", "npm_config_cache=/tmp/npm", "-e", "XDG_CACHE_HOME=/tmp/cache", "-e", "NODE_OPTIONS=", "-v", volume + ":/testbed", "--workdir", inRepo(root), "--entrypoint", "sh", o.image, "-c", build], { timeoutMs: limits.verifier_sec * 1000 });
    state = res.timed_out ? "timeout" : res.status === 0 ? "ok" : "failed";
  }
  step("seal");
  const restored = new Set(readLines(join(tests, "restore.list")));
  const protect = readLines(join(tests, "protect.ere")).map((s) => new RegExp(s));
  const isProduct = (p: string) => !restored.has(p) && !regions.includes(p) && !protect.some((re) => re.test(p)) && !p.startsWith(".real-verifier-config.");
  const hashes = (file: string): Record<string, string> => Object.fromEntries(readLines(join(status, file)).map((l) => [l.slice(66), l.slice(0, 64)] as const).filter(([p]) => isProduct(p)));
  const a = hashes("hash-a.txt");
  const b = hashes("hash-b.txt");
  const changed = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((p) => a[p] !== b[p]);
  const products: Record<string, string> = { ...a };
  for (const p of regions) {
    const was = before.get(p) ?? null;
    const now = readTree(p);
    const product = (t: string | null) => (t === null ? "absent" : sha256(productText(p, t)));
    products[p] = product(was);
    if (product(was) !== product(now)) changed.push(p);
    const moved = splice(p, now, readFileSync(join(tests, "regions", p), "utf8"));
    asRoot("write of " + p, [o.image, "-c", WRITE_TREE, "sh", "/work/" + p, p], moved);
    const after = readTree(p);
    if (after === null || (now === null ? productText(p, after).trim() !== "" : product(after) !== product(now))) changed.push(p);
  }
  return { removed: readLines(join(status, "cold-removed.txt")), build: state, products: Object.fromEntries(Object.entries(products).sort(([x], [y]) => x.localeCompare(y))), changed: [...new Set(changed)].sort() };
}
