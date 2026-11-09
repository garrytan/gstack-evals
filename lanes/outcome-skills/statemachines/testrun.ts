// Copyright (c) 2026 Garry Tan. MIT License.
// One run of a unit's own commands on a copy of its prepared tree (rebuild, test, then print, as published), and the
// dataset's log parser in its sandbox. Every run gets a fresh copy volume that is discarded after it. Two container modes:
// hardened (verify.ts's rules: uid 10001, read-only root, tmpfs /tmp, no capabilities, no new privileges, no network, CPU,
// memory and pid caps) and root (root, writable container filesystem, no network), which the sample uses to tell a
// hardening failure from a test failure. The parser is untrusted dataset code: it runs in the pinned python image with
// no network, no mount, a read-only root, uid 10001 and no capabilities, reading its input from stdin.
import { docker, dockerRun } from "../../real-outcome/task/docker.ts";
import { RUN_UID } from "../../real-outcome/task/verify.ts";
import { runBash } from "./history.ts";
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

/** The run script: rebuild and test output to stderr, then the mark, then the print commands' output. */
export function runScript(c: { rebuild: string[]; test: string[]; print: string[] }): string {
  const cmd = (x: string) => "( " + x + " )\necho \"SM_EXIT $?\" >&2";
  return ["exec 3>&1 1>&2", ...c.rebuild.map(cmd), ...c.test.map(cmd), "exec 1>&3", "echo " + PRINT_MARK, ...c.print.map((x) => "( " + x + " )"), ""].join("\n");
}

export interface TestRun { wall_ms: number; exit: number; stopped: boolean; log: string; stderr_tail: string }

export function runTests(o: { image: string; volume: string; repoDir: string; workDir?: string; commands: { rebuild: string[]; test: string[]; print: string[] }; mode: Mode; limitMs?: number; label: string }): TestRun {
  const limit = o.limitMs ?? LIMIT_MS;
  const name = runName(o.label);
  const hard = o.mode === "hardened"
    ? ["--user", RUN_UID, "--read-only", "--tmpfs", "/tmp:rw,exec,size=4g", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "-e", "HOME=/tmp"]
    : ["--user", "0:0", "--security-opt", "no-new-privileges"];
  const r = dockerRun(name, ["--rm", "-i", "--network", "none", ...hard, "--cpus", LIMITS.cpus, "--memory", LIMITS.memory, "--pids-limit", LIMITS.pids, "-v", o.volume + ":" + o.repoDir, "-w", o.workDir || o.repoDir, "--entrypoint", "bash", o.image, "-s"], { timeoutMs: limit, input: runScript(o.commands) });
  const stopped = r.timed_out || r.error !== undefined || r.wall_ms >= limit;
  const i = r.stdout.indexOf(PRINT_MARK);
  const print = i < 0 ? "" : r.stdout.slice(i + PRINT_MARK.length + 1);
  return { wall_ms: r.wall_ms, exit: r.status, stopped, log: print.trim() ? print : r.stderr, stderr_tail: r.stderr.slice(-2000) };
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
