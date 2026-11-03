#!/usr/bin/env bun
// CI carry (GST-1182): gstack's /ship and pregate reuse a green ci.yml run at the exact, clean tree instead of running the
// same lanes again (gstack docs/pregate.md#ci-carry). They accept a run only when its tested-tree artifact, tree.json,
// names the run, its head and its tree, and lists what it ran, and when that list covers each lane's inventory in
// .gstack/pregate.json's ship_lanes_from. ci.yml's checks job writes tree.json with record; list is the bun test lane's
// inventory.
//   bun scripts/ci-tree.ts list                                            the test files bun test runs in HEAD's tree
//   bun scripts/ci-tree.ts record --junit <report> --checks <file> --out <tree.json>
// record lists every test file in bun test's JUnit report, then one "check:<command>" entry per line of --checks. Each
// check step in ci.yml appends its command to that file only after the command passed, and a check lane's inventory prints
// the same entry, so typecheck, errors:check and wiki:check carry only from a run that recorded passing them.
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { junitCases } from "../src/rig/tier.ts";

export const CHECK = "check:";
const SHA = /^[0-9a-f]{40}$/;
const OSES = ["Linux", "macOS", "Windows"];

export interface TreeRecord {
  run_id: number;
  run_attempt: number;
  event: string;
  sha: string;
  head_sha: string;
  tree: string;
  os: string;
  files: string[];
  tests: number;
}

/** Whether bun test runs this path: a .test, _test, .spec or _spec JS or TS file outside node_modules and dot directories. */
export function isTestFile(path: string): boolean {
  const parts = path.split("/");
  if (parts.slice(0, -1).some((p) => p.startsWith(".") || p === "node_modules")) return false;
  return /[._](?:test|spec)\.(?:[cm]?[jt]s|[jt]sx)$/i.test(parts.at(-1)!);
}

/** The test files bun test runs in HEAD's committed tree, sorted. */
export function listTestFiles(cwd: string = process.cwd()): string[] {
  const r = spawnSync("git", ["ls-tree", "-r", "-z", "--name-only", "HEAD"], { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error("git ls-tree HEAD failed: " + (r.stderr ?? "").trim());
  return r.stdout.split("\0").filter((f) => f && isTestFile(f)).sort();
}

/**
 * tree.json for ci.yml's tested-tree artifact. It throws on any missing or malformed input, or a failing case in the
 * report, so a broken record fails the job instead of uploading. A pull_request run tests GitHub's merge commit (sha), so
 * its head is PR_HEAD_SHA; gstack accepts it only when that merge commit has the head's tree.
 */
export function treeRecord(env: Record<string, string | undefined>, o: { junit: string; checks: string; tree: string }): TreeRecord {
  const int = (name: string) => {
    const v = Number(env[name]);
    if (!Number.isSafeInteger(v) || v < 1) throw new Error(name + " is not a positive integer");
    return v;
  };
  const event = env.GITHUB_EVENT_NAME ?? "";
  const sha = env.GITHUB_SHA ?? "";
  const head = event === "pull_request" ? (env.PR_HEAD_SHA ?? "") : sha;
  if (!/^[a-z_]+$/.test(event)) throw new Error("GITHUB_EVENT_NAME " + JSON.stringify(event) + " is not an event name");
  if (!SHA.test(sha) || !SHA.test(head)) throw new Error("GITHUB_SHA " + JSON.stringify(sha) + " or the head " + JSON.stringify(head) + " is not a commit sha (a pull_request run needs PR_HEAD_SHA)");
  if (!/^[0-9a-f]{40,64}$/.test(o.tree)) throw new Error(JSON.stringify(o.tree) + " is not a tree id");
  const os = env.RUNNER_OS ?? "";
  if (!OSES.includes(os)) throw new Error("RUNNER_OS " + JSON.stringify(os) + " is not one of " + OSES.join(", "));
  const cases = junitCases(o.junit);
  const failed = cases.filter((c) => c.status === "fail");
  if (failed.length) throw new Error("the JUnit report holds " + failed.length + " failing case(s), the first " + failed[0]!.key);
  const tested = [...new Set(cases.map((c) => c.key.split(" > ")[0]!))].sort();
  if (!tested.length) throw new Error("the JUnit report lists no test file");
  const checks = [...new Set(o.checks.split("\n").map((l) => l.trim()).filter(Boolean))];
  return {
    run_id: int("GITHUB_RUN_ID"),
    run_attempt: int("GITHUB_RUN_ATTEMPT"),
    event,
    sha,
    head_sha: head,
    tree: o.tree,
    os,
    files: [...tested, ...checks.map((c) => CHECK + c)],
    tests: cases.filter((c) => c.status === "pass").length,
  };
}

function need(args: string[], name: string): string {
  const i = args.indexOf(name);
  const v = i >= 0 ? args[i + 1] : undefined;
  if (!v || v.startsWith("--")) throw new Error(name + " <value> is required");
  return v;
}

function record(args: string[]) {
  const git = (a: string[]) => spawnSync("git", a, { encoding: "utf8" }).stdout?.trim() ?? "";
  if (git(["rev-parse", "HEAD"]) !== process.env.GITHUB_SHA) throw new Error("HEAD is not GITHUB_SHA, the commit this run tested");
  const rec = treeRecord(process.env, { junit: readFileSync(need(args, "--junit"), "utf8"), checks: readFileSync(need(args, "--checks"), "utf8"), tree: git(["rev-parse", "HEAD^{tree}"]) });
  const out = need(args, "--out");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(rec, null, 2) + "\n");
  console.log("TESTED_TREE: run " + rec.run_id + "/" + rec.run_attempt + " " + rec.event + " head " + rec.head_sha.slice(0, 12) + " tree " + rec.tree.slice(0, 12) + " files=" + rec.files.length + " tests=" + rec.tests + " os=" + rec.os);
}

if (import.meta.main) {
  const [verb = "", ...args] = process.argv.slice(2);
  try {
    if (verb === "list") for (const f of listTestFiles()) console.log(f);
    else if (verb === "record") record(args);
    else {
      console.error("usage: bun scripts/ci-tree.ts list | record --junit <report> --checks <file> --out <tree.json>");
      process.exitCode = 2;
    }
  } catch (e) {
    console.error("ci-tree: " + (e as Error).message);
    process.exitCode = 1;
  }
}
