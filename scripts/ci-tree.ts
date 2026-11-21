#!/usr/bin/env bun
// CI carry (GST-1182): gstack's /ship and pregate reuse a green ci.yml run at the exact, clean tree instead of running the
// same lanes again (gstack docs/pregate.md#ci-carry). They accept a run only when its tested-tree artifact, tree.json,
// names the run, its head and its tree, and lists what it ran, and when that list covers each lane's inventory in
// .gstack/pregate.json's ship_lanes_from. ci.yml's checks job writes tree.json with this script:
//   bun scripts/ci-tree.ts record --junit <report> --checks <file> --out <tree.json>
// It lists every test file in bun test's JUnit report, then one "check:<command>" entry per line of --checks. Each check
// step in ci.yml appends its command to that file only after the command passed, and a check lane's inventory prints the
// same entry, so typecheck, errors:check and wiki:check carry only from a run that recorded passing them.
// ci.yml runs bun test in parallel shards. Before the record, the checks job joins their JUnit reports with
//   bun scripts/ci-tree.ts merge --shards <n> --dir <dir> --out <junit.xml> --timings-out <timings.json>
// which reads <dir>/junit-<i>/junit.xml for every shard and refuses unless each file the bun test lane's inventory
// (.gstack/pregate.json) lists ran in exactly one shard. It also writes each file's time in bun's --timings format, so a
// run's measured times can refresh .github/test-timings.json, which balances the shards.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
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

export interface ShardMerge {
  junit: string;
  timings: { version: 1; files: Record<string, number> };
  files: number;
  tests: number;
}

/**
 * One JUnit report from the shards' reports, in shard order. It throws unless every inventory file ran in exactly one shard:
 * a file in two shards, a file the inventory lists that no shard reported (a file with no test case counts as not run), or a
 * reported file the inventory does not list.
 */
export function mergeShards(reports: readonly string[], inventory: readonly string[]): ShardMerge {
  if (!reports.length) throw new Error("no shard report to merge");
  const shardOf = new Map<string, number>();
  const timings: Record<string, number> = {};
  const bodies: string[] = [];
  let tests = 0;
  for (const [i, xml] of reports.entries()) {
    const open = /<testsuites\b[^>]*>/.exec(xml);
    const close = xml.lastIndexOf("</testsuites>");
    if (!open || close < open.index) throw new Error("shard " + (i + 1) + "'s report is not a JUnit testsuites document");
    const body = xml.slice(open.index + open[0].length, close);
    let depth = 0;
    for (const m of body.matchAll(/<testsuite\b([^>]*?)(\/?)>|<\/testsuite>/g)) {
      if (m[0] === "</testsuite>") depth--;
      else if (m[2] === "/") continue;
      else if (depth++ === 0) {
        const file = /\bname="([^"]*)"/.exec(m[1]!)?.[1] ?? "";
        const seen = shardOf.get(file);
        if (seen !== undefined) throw new Error(file + " ran in shard " + seen + " and shard " + (i + 1));
        shardOf.set(file, i + 1);
        timings[file] = Math.round(Number(/\btime="([0-9.]+)"/.exec(m[1]!)?.[1] ?? 0) * 1000);
      }
    }
    tests += junitCases(xml).length;
    bodies.push(body.trim());
  }
  const listed = new Set(inventory);
  const missing = inventory.filter((f) => !shardOf.has(f));
  const extra = [...shardOf.keys()].filter((f) => !listed.has(f));
  if (missing.length) throw new Error(missing.length + " test file(s) ran in no shard or registered no test case, the first " + missing[0]);
  if (extra.length) throw new Error(extra.length + " reported test file(s) are not in the bun test lane's inventory, the first " + extra[0]);
  return {
    junit: '<?xml version="1.0" encoding="UTF-8"?>\n<testsuites name="bun test">\n' + bodies.join("\n") + "\n</testsuites>\n",
    timings: { version: 1, files: Object.fromEntries(Object.entries(timings).sort(([a], [b]) => a.localeCompare(b))) },
    files: shardOf.size,
    tests,
  };
}

function need(args: string[], name: string): string {
  const i = args.indexOf(name);
  const v = i >= 0 ? args[i + 1] : undefined;
  if (!v || v.startsWith("--")) throw new Error(name + " <value> is required");
  return v;
}

function record(args: string[]) {
  const git = (a: string[]) => {
    const r = spawnSync("git", a, { encoding: "utf8" });
    if (r.status !== 0) throw new Error("git " + a.join(" ") + " exited " + r.status + ": " + (r.error?.message ?? r.stderr?.trim()));
    return r.stdout.trim();
  };
  if (git(["rev-parse", "HEAD"]) !== process.env.GITHUB_SHA) throw new Error("HEAD is not GITHUB_SHA, the commit this run tested");
  const rec = treeRecord(process.env, { junit: readFileSync(need(args, "--junit"), "utf8"), checks: readFileSync(need(args, "--checks"), "utf8"), tree: git(["rev-parse", "HEAD^{tree}"]) });
  if (git(["status", "--porcelain", "--untracked-files=all"])) throw new Error("the checkout changed after checkout, so the checks did not read HEAD's tree");
  const out = need(args, "--out");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(rec, null, 2) + "\n");
  console.log("TESTED_TREE: run " + rec.run_id + "/" + rec.run_attempt + " " + rec.event + " head " + rec.head_sha.slice(0, 12) + " tree " + rec.tree.slice(0, 12) + " files=" + rec.files.length + " tests=" + rec.tests + " os=" + rec.os);
}

function merge(args: string[]) {
  const shards = Number(need(args, "--shards"));
  if (!Number.isSafeInteger(shards) || shards < 1) throw new Error("--shards must be a positive integer");
  const dir = need(args, "--dir");
  const reports = Array.from({ length: shards }, (_, i) => {
    const path = join(dir, "junit-" + (i + 1), "junit.xml");
    if (!existsSync(path)) throw new Error("shard " + (i + 1) + " uploaded no report (" + path + ")");
    return readFileSync(path, "utf8");
  });
  const policy = JSON.parse(readFileSync(".gstack/pregate.json", "utf8")) as { ship_lanes_from: Record<string, { inventory: string }> };
  const inv = spawnSync("bash", ["-eo", "pipefail", "-c", policy.ship_lanes_from["bun test"]!.inventory], { encoding: "utf8" });
  if (inv.status !== 0) throw new Error("the bun test lane's inventory exited " + inv.status + ": " + inv.stderr.trim());
  const m = mergeShards(reports, inv.stdout.split("\n").filter(Boolean));
  for (const [flag, body] of [["--out", m.junit], ["--timings-out", JSON.stringify(m.timings, null, 2) + "\n"]] as const) {
    const out = need(args, flag);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, body);
  }
  console.log("SHARDS: " + shards + " reports, " + m.files + " test files, each in exactly one shard, " + m.tests + " cases");
}

if (import.meta.main) {
  const [verb = "", ...args] = process.argv.slice(2);
  try {
    if (verb === "record") record(args);
    else if (verb === "merge") merge(args);
    else {
      console.error("usage: bun scripts/ci-tree.ts record --junit <report> --checks <file> --out <tree.json>\n       bun scripts/ci-tree.ts merge --shards <n> --dir <dir> --out <junit.xml> --timings-out <timings.json>");
      process.exitCode = 2;
    }
  } catch (e) {
    console.error("ci-tree: " + (e as Error).message);
    process.exitCode = 1;
  }
}
