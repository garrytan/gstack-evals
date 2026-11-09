// Copyright (c) 2026 Garry Tan. MIT License.
// The oracle preflight (post section 3), per unit in seeded draw order: pull by digest under the pull pacing, the runtime
// layer and its smoke, the stripped one-commit tree, the scope, the leak scan, then three base and three fixed runs of the
// unit's own commands (base = base plus test.patch and, for a split fix, fix-tests.patch, the fix's in-source test hunks,
// since the fail-to-pass tests live in them; fixed = base plus test.patch plus fix.patch). A unit stays only when every fail-to-pass test fails in all three base runs and passes in all three
// fixed runs; its stable set is every id the parser reports passed in all six runs. A run over 900 s drops it.
import { appendFileSync, existsSync, readFileSync } from "node:fs";
const rf = readFileSync;
import { createHash } from "node:crypto";
import { docker, dockerRun } from "../../real-outcome/task/docker.ts";
import { withRuntime } from "../images/manifest.ts";
import { prepareBase, type Where } from "./history.ts";
import { classifyHits, leakCheck, needles, ownNames, scan, type LeakHit, type HitKind } from "./leak.ts";
import { needsBase, splitFix } from "./fixsplit.ts";
import { runBash } from "./history.ts";
import { scope } from "./scope.ts";
import { applyPatches, copyVolume, dropVolume, LIMIT_MS, passed, runName, runParser, runTests, type Mode } from "./testrun.ts";
import { addUnitFile, readUnit, saveUnit, smFail, type OracleRun, type SmUnit, type TargetReading } from "./unit.ts";
import { join } from "node:path";

export const CLAUDE_VERSION = "2.1.312";
export const RUNTIME_REPO = "gstack-evals-sm-runtime";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** A token bucket of perHour counted registry GETs per rolling hour, kept in a log file shared by every process on the host. */
export class Pacer {
  constructor(readonly log: string, readonly perHour = 60, readonly now: () => number = Date.now, readonly wait: (ms: number) => Promise<void> = sleep) {}
  times(): number[] {
    return existsSync(this.log) ? readFileSync(this.log, "utf8").split("\n").filter(Boolean).map(Number) : [];
  }
  async take(): Promise<void> {
    for (;;) {
      const t = this.now();
      const recent = this.times().filter((x) => x > t - 3_600_000).sort((a, b) => a - b);
      if (recent.length < this.perHour) {
        appendFileSync(this.log, t + "\n");
        return;
      }
      await this.wait(recent[0]! + 3_600_000 - t + 1000);
    }
  }
  /** A rate-limit refusal: wait out the window from the oldest counted pull. It is not a retry. */
  async windowWait(): Promise<void> {
    const recent = this.times().filter((x) => x > this.now() - 3_600_000).sort((a, b) => a - b);
    await this.wait(recent.length ? recent[0]! + 3_600_000 - this.now() + 1000 : 600_000);
  }
}

export const RATE_LIMITED = /toomanyrequests|rate limit|429/i;

/** docker pull by digest. A rate-limit refusal waits for the window and does not spend the one retry. */
export async function pull(ref: string, pacer: Pacer, dockerFn = docker): Promise<string> {
  const have = dockerFn(["image", "inspect", "--format", "{{.Id}}", ref], { timeoutMs: 30_000 });
  if (have.status === 0) return have.stdout.trim();
  let failures = 0;
  for (;;) {
    await pacer.take();
    const r = dockerFn(["pull", "-q", ref], { timeoutMs: 3_600_000 });
    if (r.status === 0) return dockerFn(["image", "inspect", "--format", "{{.Id}}", ref], { timeoutMs: 30_000 }).stdout.trim();
    if (RATE_LIMITED.test(r.stderr)) {
      await pacer.windowWait();
      continue;
    }
    if (++failures > 1) smFail("E_SM_PULL", ref + " did not pull twice: " + r.stderr.trim().slice(-300));
  }
}

const PROBE = "const n=require('net');const t=[['1.1.1.1',443],['8.8.8.8',53],['93.184.216.34',80]];const o={};let k=t.length;for(const [h,p] of t){const s=n.connect({host:h,port:p});const d=(v)=>{if(o[h+':'+p])return;o[h+':'+p]=v;s.destroy();if(--k===0)console.log(JSON.stringify(o));};s.setTimeout(3000,()=>d('timeout'));s.on('connect',()=>d('open'));s.on('error',(e)=>d(e.code||'error'));}";

/** The runtime smoke: the runtime layer builds on the image, claude --version prints the pinned version, node runs and the
 *  egress probe opens no denied target (in P1's prep container no target is allowed; the proxy route is checked in the
 *  session's own preflight). pinned is the unit's recorded runtime id: smoke reuses it while it is on the host and refuses a
 *  rebuild that gives another id, so a unit's runtime never changes unnoticed. Every runtime is tagged
 *  RUNTIME_REPO:<label>, so removing a session image built on it never prunes it. */
export function smoke(imageId: string, label: string, pinned?: string): { runtime_id: string; claude_version: string; egress_probe: string; verdict: string } {
  let runtime_id: string;
  try {
    runtime_id = pinned && docker(["image", "inspect", pinned], { timeoutMs: 30_000 }).status === 0 ? pinned : withRuntime(imageId);
  } catch (e) {
    return smFail("E_SM_SMOKE", label + ": the runtime layer did not build: " + (e as Error).message.slice(-400));
  }
  if (pinned && runtime_id !== pinned) smFail("E_SM_SMOKE", label + ": the runtime rebuild is " + runtime_id + ", not the unit's runtime " + pinned + "; clear image.runtime_id in unit.json to accept a new runtime");
  const tag = docker(["tag", runtime_id, RUNTIME_REPO + ":" + label.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 128)], { timeoutMs: 30_000 });
  if (tag.status !== 0) smFail("E_SM_SMOKE", label + ": tagging the runtime " + runtime_id + " failed: " + tag.stderr.slice(-200));
  const r = dockerRun(runName("smoke"), ["--rm", "--network", "none", "--entrypoint", "sh", runtime_id, "-c", 'export PATH="$PATH:/opt/laneb/bin:/usr/local/bin"; claude --version; node -e "$0"', PROBE], { timeoutMs: 120_000 });
  const version = (r.stdout.match(/(\d+\.\d+\.\d+)/) ?? [])[1] ?? "";
  const probe = r.stdout.split("\n").reverse().find((l) => l.startsWith("{")) ?? "";
  let opened = true;
  try {
    opened = Object.values(JSON.parse(probe) as Record<string, string>).some((v) => v === "open");
  } catch {}
  if (version !== CLAUDE_VERSION || opened) smFail("E_SM_SMOKE", label + ": claude --version printed " + JSON.stringify(version) + " (want " + CLAUDE_VERSION + "), probe " + (probe || "none") + ": " + r.stderr.slice(-300));
  return { runtime_id, claude_version: version, egress_probe: probe, verdict: "ok" };
}

export const treeVolume = (id: string) => "sm-tree-" + id.toLowerCase().replace(/[^a-z0-9_.-]/g, "-");

/** Copies the image's repo_dir into the unit's tree volume, then strips and rewrites history there, then scope and leak. */
/** With record, a leak hit is returned, not thrown (the sample measures units the scan would drop). volume names the tree
 *  volume when it is not the unit's own (the hidden-test count prepares its trees beside the units'). */
export function prepare(u: SmUnit, runtimeId: string, fixPatch: string, record = false, dir?: string, volume = treeVolume(u.id)): { volume: string; removed: string[]; restored: string[]; preflight: string; scope: SmUnit["scope"]; leak: { needles: number; hits: LeakHit[]; kinds?: Record<HitKind, number> } } {
  const p = docker(["run", "--rm", "--network", "none", "--entrypoint", "sh", u.image.image_id!, "-c", 'w=$(pwd); echo "WD $w"; for d in "$w" /testbed /testbed/repo; do if [ -d "$d/.git" ]; then echo "REPO $d"; break; fi; done'], { timeoutMs: 120_000 });
  u.work_dir = (p.stdout.match(/^WD (\S+)$/m) ?? [])[1] ?? "";
  u.repo_dir = (p.stdout.match(/^REPO (\S+)$/m) ?? [])[1] ?? "";
  if (!u.repo_dir) smFail("E_SM_HISTORY", u.id + ": no git repository at the image's work dir, /testbed or /testbed/repo");
  dropVolume(volume);
  docker(["volume", "create", volume], { timeoutMs: 60_000 });
  const c = dockerRun(runName("seed"), ["--rm", "--network", "none", "--user", "0:0", "-v", volume + ":/sm-tree", "--entrypoint", "sh", u.image.image_id!, "-c", "cp -a " + u.repo_dir + "/. /sm-tree/"], { timeoutMs: 1_800_000 });
  if (c.status !== 0) smFail("E_SM_HISTORY", u.id + ": copying " + u.repo_dir + " out of the image failed: " + c.stderr.slice(-300));
  const where: Where = { kind: "docker", image: runtimeId, volume, repoDir: u.repo_dir, name: runName("prep") };
  const h = prepareBase(where, u.base_commit, u.repo_dir, u.id);
  const testFiles = u.test_patch.files;
  if (dir) splitUnit(dir, u, where);
  const sc = scope({ ...where, name: runName("scope") }, u.lang, u.split?.source_files ?? u.fix.files, testFiles);
  const lw = { ...where, name: runName("leak") };
  const own = ownNames(lw, u.repo);
  const leak = record ? classifyHits(scan(lw, needles(lw, fixPatch), "/"), own) : leakCheck(lw, fixPatch, u.id, "/", own);
  return { volume, removed: h.removed, restored: h.restored, preflight: h.preflight, scope: sc, leak: { needles: leak.needles, hits: leak.hits, kinds: leak.kinds } };
}

/** Splits fix.patch on the prepared base tree (fixsplit.ts) into fix-source.patch and fix-tests.patch. A mixed hunk drops
 *  the unit (E_SM_MIXED_TEST_HUNK); a non-test source file count outside 1 to 6 drops it (E_SM_INELIGIBLE). */
export function splitUnit(dir: string, u: SmUnit, where: Where): void {
  const patch = rf(join(dir, "fix.patch"), "utf8");
  const tf = new Set(u.test_patch.files);
  const texts: Record<string, string> = {};
  const paths = needsBase(u.lang, patch, tf);
  if (paths.length) {
    const r = runBash(where.kind === "docker" ? { ...where, name: runName("base-files") } : where, 'cd "$1" && while IFS= read -r -d "" p; do printf "%s\\0" "$p"; git show "HEAD:$p" | base64 -w0; printf "\\0"; done < "$2/paths"', { paths: paths.map((p) => p + "\0").join("") });
    const parts = r.stdout.split("\0");
    for (let i = 0; i + 1 < parts.length; i += 2) texts[parts[i]!] = Buffer.from(parts[i + 1]!, "base64").toString("utf8");
  }
  const s = splitFix(u.lang, patch, tf, (p) => texts[p] ?? smFail("E_SM_UNIT", u.id + ": no base text for " + p), u.id);
  if (s.mixed.length) smFail("E_SM_MIXED_TEST_HUNK", u.id + " (" + u.lang + "): " + s.mixed.map((m) => m.path + " hunk " + m.hunk).join(", ") + " is partly inside and partly outside a test module");
  if (s.source_files.length < 1 || s.source_files.length > 6) smFail("E_SM_INELIGIBLE", u.id + ": fix_source_files_1_to_6 after the in-source test split: " + s.source_files.length);
  addUnitFile(dir, u, "fix-source.patch", s.fix);
  addUnitFile(dir, u, "fix-tests.patch", s.tests);
  u.split = { in_source_tests: s.tests !== "", test_hunks: s.test_hunks, source_files: s.source_files };
}

/** log: the run's stderr and print output, read for cargo's targets. */
export interface RunResult { run: OracleRun; parsed: Record<string, string> | null; log: string }

/** cargo's test targets in one run log: its "Running <path>" lines, and under --verbose its "Running `<test binary>`" lines
 *  (the first word that is not an env setting, when it is a binary in a deps dir; rustc, rustdoc and build scripts are
 *  not targets), a target's hash written as * so builds compare; its "Doc-tests <crate>" lines; and whether cargo printed
 *  its fail-fast stop line. */
export function cargoTargets(log: string): { targets: string[]; stop: boolean } {
  const text = log.replace(/\x1b\[[0-9;]*m/g, "");
  const t = new Set<string>();
  const hash = (s: string) => s.replace(/-[0-9a-f]{16}\b/g, "-*");
  for (const m of text.matchAll(/^[ \t]*(Running|Doc-tests) ([^`\s].*?)[ \t]*$/gm)) t.add(m[1] + " " + hash(m[2]!));
  for (const m of text.matchAll(/^[ \t]*Running `([^`]*)`/gm)) {
    const bin = m[1]!.split(/\s+/).find((w) => w && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) ?? "";
    if (/\/deps\/[^/]+-[0-9a-f]{16}$/.test(bin)) t.add("Running " + hash(bin));
  }
  return { targets: [...t].sort(), stop: /error: test failed, to rerun pass/.test(text) };
}

/** The base-run target reading for a cargo unit: cargo_stopped_early is true when a target the fixed runs reached appears in
 *  no base run. */
export function targetReading(base: string[], fixed: string[]): TargetReading {
  const b = base.map(cargoTargets), f = fixed.map(cargoTargets);
  const reached = new Set(b.flatMap((x) => x.targets));
  const not_on_base = [...new Set(f.flatMap((x) => x.targets))].filter((t) => !reached.has(t)).sort();
  return { base: b.map((x) => x.targets), fixed: f.map((x) => x.targets), not_on_base, fail_fast_stop: b.some((x) => x.stop), cargo_stopped_early: not_on_base.length > 0 };
}

/** The patches a base run applies over a tree, in order: test.patch, then fix-tests.patch (the fix's in-source test hunks,
 *  section 7 step 3) when the fix was split and the file is not empty. The oracle's base runs (the stable set) and the
 *  follow-on start-set runs both use this. fixTests false gives the run without the fix's in-source tests, which only the
 *  hidden-test count (hidden.ts) asks for. */
export function basePatches(dir: string, fixTests = true): [string, string][] {
  const out: [string, string][] = [["test.patch", rf(join(dir, "test.patch"), "utf8")]];
  const t = fixTests && existsSync(join(dir, "fix-source.patch")) ? rf(join(dir, "fix-tests.patch"), "utf8") : "";
  if (t) out.push(["fix-tests.patch", t]);
  return out;
}

/** One oracle run on a fresh copy of the tree volume. baseFixTests false leaves fix-tests.patch off a base run (hidden.ts only). */
export function oneRun(dir: string, u: SmUnit, volume: string, image: string, tree: "base" | "fixed", n: number, mode: Mode, limitMs = LIMIT_MS, baseFixTests = true): RunResult {
  const copy = volume + "-" + tree + n + "-" + process.pid;
  copyVolume(image, volume, copy, mode);
  try {
    const patches: [string, string][] = tree === "base" ? basePatches(dir, baseFixTests) : [["test.patch", rf(join(dir, "test.patch"), "utf8")]];
    if (tree === "fixed") {
      const split = existsSync(join(dir, "fix-source.patch"));
      patches.push(["fix-source.patch", rf(join(dir, split ? "fix-source.patch" : "fix.patch"), "utf8")]);
      const t = split ? rf(join(dir, "fix-tests.patch"), "utf8") : "";
      if (t) patches.push(["fix-tests.patch", t]);
    }
    const bad = applyPatches(image, copy, u.repo_dir, patches, mode);
    if (bad) return { run: { tree, n, wall_ms: 0, exit: -1, parsed_sha256: null, stopped: false, exits: [] }, parsed: null, log: "" };
    const t = runTests({ image, volume: copy, repoDir: u.repo_dir, workDir: u.work_dir, commands: u.commands, mode, limitMs, label: u.id + "-" + tree + n });
    const log = t.log === t.stderr ? t.stderr : t.stderr + "\n" + t.log;
    if (t.stopped) return { run: { tree, n, wall_ms: t.wall_ms, exit: t.exit, parsed_sha256: null, stopped: true, exits: t.exits }, parsed: null, log };
    const parsed = runParser(rf(join(dir, "parser.py"), "utf8"), t.log, u.id + "-" + tree + n);
    return { run: { tree, n, wall_ms: t.wall_ms, exit: t.exit, parsed_sha256: sha(JSON.stringify(parsed)), stopped: false, exits: t.exits }, parsed, log };
  } finally {
    dropVolume(copy);
  }
}

/** The keep rule over six parsed runs (three base, three fixed). A dataset fail-to-pass id that passes on every base run
 *  is not fail-to-pass: it leaves the unit's set (removed). One that passes on some base runs and fails on others leaves it
 *  as flaky on base (flaky), never a reason for instability. The unit's set is the ids that fail on every base run; one of
 *  them that does not pass on every fixed run makes the unit unstable. */
export function judge(f2p: string[], base: (Record<string, string> | null)[], fixed: (Record<string, string> | null)[]): { kept: boolean; stable: string[]; failing: string[]; f2p: string[]; removed: string[]; flaky: string[]; reason: string } {
  const all = [...base, ...fixed];
  if (all.some((r) => r === null)) return { kept: false, stable: [], failing: [], f2p: [], removed: [], flaky: [], reason: "a run did not produce a parsed log" };
  const passes = (id: string) => base.filter((r) => passed(r!, id)).length;
  const removed = f2p.filter((id) => passes(id) === base.length);
  const flaky = f2p.filter((id) => passes(id) > 0 && passes(id) < base.length);
  const kept = f2p.filter((id) => passes(id) === 0);
  const failing = kept.filter((id) => fixed.some((r) => !passed(r!, id)));
  const stable = Object.keys(all[0]!).filter((id) => all.every((r) => passed(r!, id))).sort();
  const out = { stable, failing, f2p: kept, removed, flaky };
  if (failing.length) return { kept: false, ...out, reason: "fail-to-pass tests failing on base but not passing on every fixed run" };
  if (!kept.length) return { kept: false, ...out, reason: "no fail-to-pass test" };
  if (!stable.length) return { kept: false, ...out, reason: "no stable test" };
  return { kept: true, ...out, reason: "kept" };
}

/** The whole oracle on one unit dir. Writes unit.json's oracle, image, strip and scope fields and returns the verdict. */
export async function oracleUnit(dir: string, pacer: Pacer, opts: { mode?: Mode; limitMs?: number; runs?: number } = {}): Promise<{ id: string; verdict: string; detail: string }> {
  const u = readUnit(dir);
  const done = (verdict: string, detail: string) => {
    saveUnit(dir, u);
    return { id: u.id, verdict, detail };
  };
  const codeOf = (e: unknown) => ((e as Error).message.match(/^(E_[A-Z_]+)/) ?? [])[1] ?? "E_SM_ORACLE_UNSTABLE";
  try {
    u.image.image_id = await pull(u.image.ref, pacer);
    const s = smoke(u.image.image_id, u.id, u.image.runtime_id ?? undefined);
    u.image.runtime_id = s.runtime_id;
    const p = prepare(u, s.runtime_id, rf(join(dir, "fix.patch"), "utf8"), false, dir);
    u.strip = { removed: p.removed, restored: p.restored };
    u.scope = p.scope;
    u.oracle = { runs: [], stable: [], stable_sha256: "", f2p_ok: false, max_wall_ms: 0, verdict: "running", smoke: { claude_version: s.claude_version, egress_probe: s.egress_probe, verdict: s.verdict }, leak: p.leak, history: p.preflight };
    const base: (Record<string, string> | null)[] = [], fixed: (Record<string, string> | null)[] = [];
    const logs = { base: [] as string[], fixed: [] as string[] };
    for (let n = 1; n <= (opts.runs ?? 3); n++) {
      for (const tree of ["base", "fixed"] as const) {
        const r = oneRun(dir, u, p.volume, s.runtime_id, tree, n, opts.mode ?? "hardened", opts.limitMs);
        u.oracle.runs.push(r.run);
        u.oracle.max_wall_ms = Math.max(u.oracle.max_wall_ms, r.run.wall_ms);
        if (r.run.stopped) {
          u.oracle.verdict = "E_SM_SLOW_TEST";
          return done("E_SM_SLOW_TEST", tree + " run " + n + " passed " + (opts.limitMs ?? LIMIT_MS) + " ms (wall " + r.run.wall_ms + " ms)");
        }
        (tree === "base" ? base : fixed).push(r.parsed);
        logs[tree].push(r.log);
      }
    }
    const j = judge(u.tests.f2p, base, fixed);
    u.oracle.stable = j.stable;
    u.oracle.stable_sha256 = sha(j.stable.join("\n"));
    u.oracle.f2p = j.f2p;
    u.oracle.f2p_removed = { count: j.removed.length, ids: j.removed, reason: "passes on every base run with the fix's tests applied" };
    u.oracle.f2p_flaky = { count: j.flaky.length, ids: j.flaky, reason: "passes on some base runs with the fix's tests applied and fails on others" };
    if (u.lang === "rust") u.oracle.targets = targetReading(logs.base, logs.fixed);
    u.oracle.reason = j.reason;
    u.oracle.f2p_ok = !j.failing.length && base.every(Boolean) && fixed.every(Boolean);
    u.oracle.verdict = j.kept ? "kept" : "E_SM_ORACLE_UNSTABLE";
    return done(u.oracle.verdict, j.reason + (j.failing.length ? ": " + j.failing.slice(0, 20).join(", ") : "") + "; fail-to-pass kept " + j.f2p.length + " removed " + j.removed.length + " flaky " + j.flaky.length + "; stable " + j.stable.length + (u.oracle.targets ? "; cargo stopped early " + u.oracle.targets.cargo_stopped_early : ""));
  } catch (e) {
    const code = codeOf(e);
    if (u.oracle) u.oracle.verdict = code;
    return done(code, (e as Error).message.slice(0, 600));
  }
}
