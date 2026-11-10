// Copyright (c) 2026 Garry Tan. MIT License.
// One run of a unit's own commands on a copy of its prepared tree (rebuild, test, then print, as published), and the
// dataset's log parser in its sandbox. Every run gets a fresh copy volume that is discarded after it. Two container modes:
// hardened (verify.ts's rules: uid 10001, read-only root, tmpfs /tmp, no capabilities, no new privileges, no network, CPU,
// memory and pid caps) and root (root, writable container filesystem, no network), which the sample uses to tell a
// hardening failure from a test failure. A hardened run also gets a fresh copy of the image's own home directory, owned by
// uid 10001 and mounted at the same path with HOME pointing at it, and a read-only copy of the image's /etc/passwd with a
// line naming that home for uid 10001 (Java takes its home from the passwd entry, not HOME), so the build tools find the
// caches the image ships (Maven, NuGet, pnpm) and can write their state. Both are discarded after the run. The parser is untrusted dataset code: it runs in the pinned python image with
// no network, no mount, a read-only root, uid 10001 and no capabilities, reading its input from stdin.
import { docker, dockerRun } from "../../real-outcome/task/docker.ts";
import { RUN_UID } from "../../real-outcome/task/verify.ts";
import { runBash } from "./history.ts";
import { listSrc, printReading, reportDirs } from "./reports.ts";
import { smFail } from "./unit.ts";

export const PY_IMAGE = "python:3.12-slim-bookworm@sha256:e697c81897302a4c4333bade000d98038fbb21eb064f8ee1fd42d02ebcd9d337";
/** Section 3: a test command over 15 minutes drops the unit. */
export const LIMIT_MS = 900_000;
export type Mode = "hardened" | "root";
export const PRINT_MARK = "===SM_PRINT_7f3a===";
const LIMITS = { cpus: "4", memory: "12g", pids: "8192" };

let seq = 0;
export const runName = (label: string) => "sm-" + label.replace(/[^a-zA-Z0-9_.-]/g, "-").slice(0, 60) + "-" + process.pid + "-" + ++seq;

/** A fresh copy of the prepared tree volume, owned by uid 10001 in hardened mode. */
export function copyVolume(image: string, src: string, dst: string, mode: Mode): void {
  const c = docker(["volume", "create", dst], { timeoutMs: 60_000 });
  if (c.status !== 0) smFail("E_SM_HISTORY", "docker volume create " + dst + " failed: " + c.stderr.slice(-200));
  const own = mode === "hardened" ? " && chown -R " + RUN_UID + " /d" : "";
  const r = dockerRun(runName("copy"), ["--rm", "--network", "none", "--user", "0:0", "-v", src + ":/s:ro", "-v", dst + ":/d", "--entrypoint", "sh", image, "-c", "cp -a /s/. /d/" + own], { timeoutMs: 1_800_000 });
  if (r.status !== 0) smFail("E_SM_HISTORY", "copying " + src + " to " + dst + " failed: " + r.stderr.slice(-200));
}

export const dropVolume = (v: string) => docker(["volume", "rm", "-f", v], { timeoutMs: 120_000 });

/** git apply of each patch in order, as root on the copy. Returns the failing patch's name, or null. */
export function applyPatches(image: string, volume: string, repoDir: string, patches: [string, string][], mode: Mode): string | null {
  for (const [name, body] of patches) {
    const r = runBash({ kind: "docker", image, volume, repoDir, name: runName("apply") }, 'cd "$1" && git apply --binary --whitespace=nowarn "$2/p"' + (mode === "hardened" ? " && chown -R " + RUN_UID + " ." : ""), { p: body });
    if (r.status !== 0) return name;
  }
  return null;
}

const sq = (s: string) => "'" + s.replace(/'/g, "'\\''") + "'";

/** The run script: rebuild and test output to stderr, then the mark, then the print commands' output. When the print
 *  command reads report paths (reports.ts), the script first deletes every file they name under repoDir that git does not
 *  track, then marks the start; after the test commands it moves aside every file they name that is not newer than the
 *  mark (file times tick coarsely, so a file as new as the mark is fresh), so the print command reads only reports this run wrote, and writes the counts on an SM_REPORTS line.
 *  Between the deletion and the mark it creates, as the run user, each report directory the test commands write into
 *  (reports.ts reportDirs) that is missing, only where its nearest existing parent resolves inside repoDir, and writes an
 *  SM_MKDIR line for each one it created. A run that cannot make its mark dir (a /tmp the run user cannot write) writes
 *  SM_INFRA no_mark_dir and stops before any command runs, an infra error rather than a run that built nothing. Every rebuild, test and print command reads its stdin from /dev/null, because the
 *  script itself reaches bash -s on stdin and a command that reads stdin (ant, mvn, gradle, npx) would swallow the rest. */
export function runScript(c: { rebuild: string[]; test: string[]; print: string[] }, repoDir: string, workDir = repoDir): string {
  const cmd = (x: string) => "( " + x + " ) </dev/null\necho \"SM_EXIT $?\" >&2";
  const paths = printReading(c).paths;
  const mk = reportDirs(c, { repoDir, workDir }).map((d) => '( cd "$SM_WD"' + (d.cwd ? " && cd " + sq(d.cwd) : "") + ' 2>/dev/null && sm_d="$(pwd -P)"/' + sq(d.dir) + ' && ! [ -e "$sm_d" ] && ! [ -L "$sm_d" ] && sm_a=$sm_d && while [ -n "$sm_a" ] && ! [ -e "$sm_a" ] && ! [ -L "$sm_a" ]; do sm_a=${sm_a%/*}; done && sm_a=$(cd "${sm_a:-/}" 2>/dev/null && pwd -P) && [ -n "$SM_REPOP" ] && case $sm_a/ in "$SM_REPOP"/*) mkdir -p -- "$sm_d" && printf "SM_MKDIR %s\\n" "${sm_d#"$SM_REPOP"/}";; esac ) || true');
  const start = paths.length
    ? [
        "SM_WD=$PWD; SM_REPO=" + sq(repoDir) + "; SM_T=$(mktemp -d 2>/dev/null || { mkdir -p /tmp/.sm-$$ && echo /tmp/.sm-$$; })",
        'sm_infra() { echo "SM_INFRA no_mark_dir" >&2; exit 97; }',
        '[ -n "$SM_T" ] && [ -d "$SM_T" ] && [ -w "$SM_T" ] || sm_infra',
        'sm_abs() { case $1 in /*) printf "%s\\n" "$1";; *) printf "%s\\n" "$PWD/${1#./}";; esac; }',
        "sm_list() {\n" + paths.map(listSrc).join("\n") + "\n}",
        'SM_DEL=0; SM_KEPT=0; sm_git=0; git -C "$SM_REPO" rev-parse --git-dir >/dev/null 2>&1 && sm_git=1',
        'sm_list | sort -u > "$SM_T/start"',
        'while IFS= read -r f; do case $f in "$SM_REPO"/*) git -C "$SM_REPO" ls-files --error-unmatch -- ":(literal)$f" >/dev/null 2>&1; sm_rc=$?; if [ $sm_git = 1 ] && [ $sm_rc = 1 ] && rm -f -- "$f"; then SM_DEL=$((SM_DEL+1)); else SM_KEPT=$((SM_KEPT+1)); fi;; *) SM_KEPT=$((SM_KEPT+1));; esac; done < "$SM_T/start"; unset f',
        ...(mk.length ? ['SM_REPOP=$(cd "$SM_REPO" 2>/dev/null && pwd -P)', ...mk] : []),
        'touch "$SM_T/mark" || sm_infra',
      ]
    : [];
  const end = paths.length
    ? [
        'sm_list | sort -u > "$SM_T/end"; SM_FRESH=0; SM_REF=0; SM_UNHID=0; mkdir -p "$SM_T/stale"',
        'while IFS= read -r f; do if ! [ "$SM_T/mark" -nt "$f" ]; then SM_FRESH=$((SM_FRESH+1)); elif mv -f -- "$f" "$SM_T/stale/$SM_REF" 2>/dev/null; then SM_REF=$((SM_REF+1)); else SM_UNHID=$((SM_UNHID+1)); fi; done < "$SM_T/end"; unset f',
        'echo "SM_REPORTS deleted=$SM_DEL kept=$SM_KEPT refused=$SM_REF unhidden=$SM_UNHID fresh=$SM_FRESH" >&2',
      ]
    : [];
  return ["exec 3>&1 1>&2", ...start, ...c.rebuild.map(cmd), ...c.test.map(cmd), ...end, "exec 1>&3", "echo " + PRINT_MARK, ...c.print.map((x) => "( " + x + " ) </dev/null"), ""].join("\n");
}

/** The stale report counts: untracked report files deleted at the start, report files kept there (tracked, or outside the
 *  tree), and after the tests the files refused as not written by this run (moved aside), the ones that could not be moved
 *  aside, and the fresh ones. null when the print command reads no report path (reports.ts). */
export interface Reports { deleted: number; kept: number; refused: number; unhidden: number; fresh: number }
/** Why a run built nothing: a separate rebuild step exited non-zero (only where the unit's rebuild rule applies), no report
 *  the run wrote is left for the print command, or a stale report could not be moved aside. A test command's own exit is
 *  never one. */
export type BuiltNothing = "rebuild_failed" | "no_fresh_report" | "stale_unhidden";
/** The unit's rebuild rule (unit.ts OracleRecord rebuild_rule): "applies" where the rebuild exits 0 on every fixed oracle
 *  run, so a rebuild that exits non-zero means the run built nothing; "exempt" otherwise. */
export type RebuildRule = "applies" | "exempt";

/** exits: each rebuild and test command's exit status, in order (the SM_EXIT lines the run script writes); created_dirs:
 *  the report directories the run created at its start, relative to repoDir (the SM_MKDIR lines); infra: the run stopped
 *  at its start because it could not make its mark dir (the SM_INFRA line), so it counts as neither a keep nor a drop. */
export interface TestRun { wall_ms: number; exit: number; stopped: boolean; log: string; stderr: string; stderr_tail: string; exits: number[]; reports: Reports | null; built_nothing: BuiltNothing | null; created_dirs: string[]; infra: "no_mark_dir" | null }

/** A finished run script's result read into a TestRun, with the stale report counts and the built-nothing reason. */
export function settleRun(r: { stdout: string; stderr: string; status: number; wall_ms: number; timed_out?: boolean; error?: unknown }, commands: { rebuild: string[] }, limit: number, rule: RebuildRule = "applies"): TestRun {
  const stopped = !!r.timed_out || r.error !== undefined || r.wall_ms >= limit;
  const i = r.stdout.indexOf(PRINT_MARK);
  const print = i < 0 ? "" : r.stdout.slice(i + PRINT_MARK.length + 1);
  const exits = [...r.stderr.matchAll(/^SM_EXIT (\d+)$/gm)].map((m) => Number(m[1]));
  const m = r.stderr.match(/^SM_REPORTS deleted=(\d+) kept=(\d+) refused=(\d+) unhidden=(\d+) fresh=(\d+)$/m);
  const reports = m ? { deleted: +m[1]!, kept: +m[2]!, refused: +m[3]!, unhidden: +m[4]!, fresh: +m[5]! } : null;
  const n = commands.rebuild.length;
  const infra = /^SM_INFRA no_mark_dir$/m.test(r.stderr) ? "no_mark_dir" : null;
  const built_nothing: BuiltNothing | null = infra ? null : rule === "applies" && n && exits.slice(0, n).some((x) => x !== 0) ? "rebuild_failed" : reports?.unhidden ? "stale_unhidden" : reports && !reports.fresh ? "no_fresh_report" : null;
  const created_dirs = [...r.stderr.matchAll(/^SM_MKDIR (.+)$/gm)].map((m) => m[1]!);
  return { wall_ms: r.wall_ms, exit: r.status, stopped, log: print.trim() ? print : r.stderr, stderr: r.stderr, stderr_tail: r.stderr.slice(-2000), exits, reports, built_nothing, created_dirs, infra };
}

/** The dataset's parser over a run's log, or nothing when the run built nothing or hit an infra error (the parser does not run). */
export function parseRun(t: TestRun, src: string, label: string, parse: (src: string, log: string, label: string) => Record<string, string> = runParser): Record<string, string> {
  return t.built_nothing || t.infra ? {} : parse(src, t.log, label);
}

/** A fresh volume holding a copy of the image's home directory (root's HOME in the image) under home/, owned by uid
 *  10001, and passwd: the image's /etc/passwd with uid 10001's line naming that home. Returns the home path. */
export function homeVolume(image: string, dst: string): string {
  const uid = RUN_UID.split(":")[0]!;
  const c = docker(["volume", "create", dst], { timeoutMs: 60_000 });
  if (c.status !== 0) smFail("E_SM_HISTORY", "docker volume create " + dst + " failed: " + c.stderr.slice(-200));
  const r = dockerRun(runName("home"), ["--rm", "--network", "none", "--user", "0:0", "-v", dst + ":/sm", "--entrypoint", "sh", image, "-c", 'h="${HOME:-/root}"; mkdir /sm/home && if [ -d "$h" ]; then cp -a "$h"/. /sm/home/; fi && chown -R ' + RUN_UID + ' /sm/home && { grep -v "^[^:]*:[^:]*:' + uid + ':" /etc/passwd; echo "sm:x:' + uid + ':' + uid + '::$h:/bin/sh"; } > /sm/passwd && chmod 644 /sm/passwd && printf "SM_HOME %s\\n" "$h"'], { timeoutMs: 1_800_000 });
  const path = r.stdout.match(/^SM_HOME (\/\S*)$/m)?.[1];
  if (r.status !== 0 || !path || path === "/") smFail("E_SM_HISTORY", "copying the image's home to " + dst + " failed: " + r.stderr.slice(-200));
  return path!;
}

/** The test container's docker run arguments. The home copy applies to hardened mode only. */
export function runArgs(o: { image: string; volume: string; repoDir: string; workDir?: string; mode: Mode; name: string; home?: { volume: string; path: string } }): string[] {
  const hard = o.mode === "hardened"
    ? ["--user", RUN_UID, "--read-only", "--tmpfs", "/tmp:rw,exec,size=4g,mode=1777", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", ...(o.home ? ["--mount", "type=volume,src=" + o.home.volume + ",dst=" + o.home.path + ",volume-subpath=home", "--mount", "type=volume,src=" + o.home.volume + ",dst=/etc/passwd,volume-subpath=passwd,readonly", "-e", "HOME=" + o.home.path] : ["-e", "HOME=/tmp"])]
    : ["--user", "0:0", "--security-opt", "no-new-privileges"];
  return ["--rm", "-i", "--network", "none", ...hard, "--cpus", LIMITS.cpus, "--memory", LIMITS.memory, "--pids-limit", LIMITS.pids, "-v", o.volume + ":" + o.repoDir, "-w", o.workDir || o.repoDir, "--entrypoint", "bash", o.image, "-s"];
}

export function runTests(o: { image: string; volume: string; repoDir: string; workDir?: string; commands: { rebuild: string[]; test: string[]; print: string[] }; mode: Mode; limitMs?: number; label: string; rule?: RebuildRule }): TestRun {
  const limit = o.limitMs ?? LIMIT_MS;
  const name = runName(o.label);
  const homeVol = o.mode === "hardened" ? name + "-home" : null;
  let r;
  try {
    const home = homeVol ? { volume: homeVol, path: homeVolume(o.image, homeVol) } : undefined;
    r = dockerRun(name, runArgs({ ...o, name, home }), { timeoutMs: limit, input: runScript(o.commands, o.repoDir, o.workDir || o.repoDir) });
  } finally {
    if (homeVol) dropVolume(homeVol);
  }
  return settleRun(r, o.commands, limit, o.rule);
}

const RUNNER = [
  "import json, sys",
  "d = json.load(sys.stdin)",
  "g = {'__name__': 'dataset_parser'}",
  "exec(compile(d['src'], 'parser.py', 'exec'), g)",
  "r = g['parser'](d['log'])",
  "assert isinstance(r, dict), 'parser returned ' + type(r).__name__",
  "print('SM_PARSED ' + json.dumps({str(k): str(v) for k, v in r.items()}, sort_keys=True))",
].join("\n");

/** The dataset's parser over one log. Refuses (E_SM_PARSER) on a crash, a timeout or no dict. */
export function runParser(src: string, log: string, label: string): Record<string, string> {
  const r = dockerRun(runName("parser-" + label), ["--rm", "-i", "--network", "none", "--read-only", "--user", RUN_UID, "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--memory", "2g", "--pids-limit", "64", "--entrypoint", "python3", PY_IMAGE, "-c", RUNNER], { timeoutMs: 300_000, input: JSON.stringify({ src, log }) });
  const line = r.stdout.split("\n").find((l) => l.startsWith("SM_PARSED "));
  if (r.status !== 0 || !line) smFail("E_SM_PARSER", label + ": the dataset parser failed (exit " + r.status + (r.timed_out ? ", timed out" : "") + "): " + r.stderr.trim().slice(-400));
  return JSON.parse(line!.slice(10));
}

/** The dataset's status for a passing test: 1,076 of the 1,077 pinned parsers write "pass", "fail" and "skip", and the
 *  last lowercases its own (pass|fail|skip). Only "pass" counts as a pass; every other status, or none, does not. */
export const PASS = "pass";
export const passed = (res: Record<string, string>, id: string): boolean => res[id] === PASS;
