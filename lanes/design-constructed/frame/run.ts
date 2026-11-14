// Copyright (c) 2026 Garry Tan. MIT License.
// The frame command (prereg section 3; plan section 8; addendum R2-1 and the Captain's A1 and C1 rulings): the 50
// searches, the entry filters, the frame order and the owner dedupe, then clones and the file check down the frame
// order. It writes the frame, the clone list and the file-check results to a sealed folder outside the repository and
// prints only counts and digests. It refuses a dirty tree, records the lane's commit, and on a rerun after a crash reuses
// every cached search reply and every finished clone, and never retries a clone that failed.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve, isAbsolute } from "node:path";
import { FRAME, RECIPES } from "../frozen.ts";
import { fail } from "../errors.ts";
import { fileCheck, type FileCheck } from "./filecheck.ts";
import { buildFrame, type FrameEntry } from "./filters.ts";
import { assertGitHub, ghCli, openGitHub, type GhExec, type RateLimit } from "./gh.ts";
import { fetchAt, headOf } from "./git.ts";
import { runSearch } from "./search.ts";

/** What the frame command reaches outside itself; the dry run and tests pass fakes. */
export interface FrameSeams {
  /** The gh CLI. */
  gh: GhExec;
  sleep: (ms: number) => void;
  now: () => number;
  /** Fetches nameWithOwner's commit oid into dest, which doesn't exist; throws when it can't. */
  clone: (nameWithOwner: string, oid: string, dest: string) => void;
  /** The lane's own checkout: its commit, whether its tree is dirty, and its root folder. */
  lane: () => { commit: string; dirty: boolean; root: string };
  /** Runs the file check on a clone. */
  check: (dir: string) => FileCheck;
}

/** R2-1: what "at most 30" bounds. A1 settled it as recipe sessions; "clones" is the other reading. */
export type Bound = "sessions" | "clones";

/** How far down the frame the clones go: a hard cap on clone attempts and the file-check passes that end the walk. */
export const cloneLimits = (bound: Bound) => (bound === "clones" ? { attempts: RECIPES.maxSessions, passes: Infinity } : { attempts: RECIPES.maxClones, passes: RECIPES.maxSessions });

/** BT: the GraphQL quota floor the frame never takes the shared quota under. */
export const QUOTA_FLOOR = 1000;

const NAME = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export const realSeams = (): FrameSeams => ({
  gh: ghCli,
  sleep: (ms) => Bun.sleepSync(ms),
  now: () => Date.now(),
  clone: (name, oid, dest) => {
    if (!NAME.test(name) || name.split("/").some((p) => p === "." || p === "..")) throw new Error("not a repository name");
    fetchAt(assertGitHub("https://github.com/" + name + ".git").toString(), oid, dest);
  },
  lane: () => {
    const root = resolve(import.meta.dir, "../../..");
    const g = (args: string[]) => spawnSync("git", args, { cwd: root, encoding: "utf8" });
    const commit = g(["rev-parse", "HEAD"]).stdout.trim();
    const status = g(["status", "--porcelain"]);
    return { commit, dirty: status.status !== 0 || status.stdout.trim() !== "", root };
  },
  check: fileCheck,
});

export interface CloneRecord {
  position: number;
  nameWithOwner: string;
  oid: string | null;
  /** The clone is on disk at the oid. */
  fetched: boolean;
  /** The clone came from an earlier launch of this run. */
  reused: boolean;
  /** Why the clone failed; the repository leaves the frame. */
  reason: string | null;
  path: string | null;
}

export interface FrameRun {
  lines: string[];
  files: Record<string, string>;
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const iso = (ms: number) => new Date(ms).toISOString();

/** The whole frame run into out. Throws DcError E_USAGE on a dirty tree, an out folder inside the repository or a finished run. */
export function runFrame(out: string, seams: FrameSeams, bound: Bound = "sessions"): FrameRun {
  const lane = seams.lane();
  if (!lane.commit) fail("E_USAGE", "the lane's commit can't be read");
  if (lane.dirty) fail("E_USAGE", "refuses to run from a dirty tree; commit first so the run names its exact code");
  const dir = resolve(out);
  const rel = relative(resolve(lane.root), dir);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) fail("E_USAGE", "--out must be a sealed folder outside the repository");
  if (existsSync(join(dir, "run.json"))) fail("E_USAGE", "a finished frame run is already in --out; the frame runs once (C1)");
  mkdirSync(join(dir, "clones"), { recursive: true });
  const launches = join(dir, "launches.jsonl");
  const prior = existsSync(launches) ? readFileSync(launches, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  if (prior.some((p) => p.commit !== lane.commit)) fail("E_USAGE", "--out holds a launch from another commit; a frame run uses one commit");
  const started = seams.now();
  appendFileSync(launches, JSON.stringify({ commit: lane.commit, at: iso(started) }) + "\n");

  const gh = openGitHub({ floor: QUOTA_FLOOR, tries: 3, backoffMs: (n) => n * 5000, paceMs: FRAME.requestGapMs, exec: seams.gh, sleep: seams.sleep, now: seams.now });
  const before: RateLimit = gh.rateLimit();
  const search = runSearch(gh, join(dir, "search-cache"));
  const framed = buildFrame(search.repos);

  const limits = cloneLimits(bound);
  const attemptsFile = join(dir, "clone-attempts.jsonl");
  const failed = new Map<string, string>();
  for (const l of existsSync(attemptsFile) ? readFileSync(attemptsFile, "utf8").split("\n").filter(Boolean) : []) {
    const a = JSON.parse(l);
    if (a.outcome === "failed") failed.set(a.nameWithOwner, a.reason);
  }
  const clones: CloneRecord[] = [];
  const checks: { position: number; nameWithOwner: string; check: FileCheck }[] = [];
  let passes = 0, lastClone = -Infinity;
  for (const e of framed.frame as FrameEntry[]) {
    if (clones.length >= limits.attempts || passes >= limits.passes) break;
    const path = join(dir, "clones", e.nameWithOwner.replace("/", "__"));
    const rec: CloneRecord = { position: e.position, nameWithOwner: e.nameWithOwner, oid: e.headOid, fetched: false, reused: false, reason: null, path: null };
    clones.push(rec);
    if (e.headOid !== null && headOf(path) === e.headOid) {
      rec.fetched = rec.reused = true;
    } else if (failed.has(e.nameWithOwner)) {
      rec.reason = failed.get(e.nameWithOwner)!;
    } else {
      if (e.headOid === null) rec.reason = "the search recorded no default-branch head oid";
      else {
        const wait = lastClone + FRAME.requestGapMs - seams.now();
        if (wait > 0) seams.sleep(wait);
        lastClone = seams.now();
        appendFileSync(attemptsFile, JSON.stringify({ nameWithOwner: e.nameWithOwner, oid: e.headOid, at: iso(lastClone) }) + "\n");
        try {
          seams.clone(e.nameWithOwner, e.headOid, path);
          rec.fetched = true;
        } catch (err) {
          rec.reason = "the oid can't be fetched: " + String((err as Error).message).split("\n")[0]!.slice(0, 200);
        }
      }
      appendFileSync(attemptsFile, JSON.stringify({ nameWithOwner: e.nameWithOwner, outcome: rec.fetched ? "fetched" : "failed", reason: rec.reason }) + "\n");
    }
    if (!rec.fetched) continue;
    rec.path = relative(dir, path);
    const check = seams.check(path);
    checks.push({ position: e.position, nameWithOwner: e.nameWithOwner, check });
    if (check.pass) passes++;
  }
  const after: RateLimit = gh.rateLimit();
  const finished = seams.now();

  const fetched = search.queries.filter((q) => !q.cached);
  const pointsUsed = before.reset === after.reset ? before.remaining - after.remaining : null;
  const count = (f: (c: FileCheck) => boolean) => checks.filter((c) => f(c.check)).length;
  const counts = {
    queries: search.queries.length,
    queries_cached: search.queries.length - fetched.length,
    cost_recorded: fetched.reduce((a, q) => a + q.cost, 0),
    returned: search.returned,
    unique: search.repos.length,
    after_filter: framed.afterFilter,
    ordered: framed.ordered,
    frame: framed.frame.length,
    clone_attempts: clones.length,
    clones: clones.filter((c) => c.fetched).length,
    unfetchable: clones.filter((c) => !c.fetched).map((c) => c.position),
    filecheck: { front_end: count((c) => c.frontEnd), components: count((c) => c.components), design_system: count((c) => c.designSystem), routes: count((c) => c.routes), all: passes },
  };
  const files: Record<string, string> = {};
  const write = (name: string, value: unknown) => {
    const text = JSON.stringify(value, null, 2) + "\n";
    writeFileSync(join(dir, name), text);
    files[name] = sha(text);
  };
  write("search.json", search.queries);
  write("entry.json", framed.outcome);
  write("frame.json", framed.frame);
  write("clones.json", clones);
  write("filecheck.json", checks);
  write("run.json", { kind: "dc frame", lane_commit: lane.commit, bound, limits: { attempts: limits.attempts, passes: limits.passes === Infinity ? null : limits.passes }, started_at: iso(started), finished_at: iso(finished), launches: prior.length + 1, rate_limit_before: before, rate_limit_after: after, points_used: pointsUsed, counts, files: { ...files } });

  const lines = [
    "frame: lane commit " + lane.commit + "; the 30 bounds " + (bound === "sessions" ? "recipe sessions (A1)" : "clones"),
    "rate_limit before: " + before.remaining + " of " + before.limit + " points left",
    "queries: " + counts.queries + " (" + counts.queries_cached + " from cache, " + fetched.length + " from GitHub); cost recorded: " + counts.cost_recorded + " points",
    "repositories returned: " + counts.returned + " (" + counts.unique + " distinct)",
    ...framed.afterFilter.map((f) => "after " + f.name + ": " + f.left),
    "frame order: " + framed.ordered + "; after the owner dedupe: " + counts.frame + " (frame size)",
    "clone attempts: " + counts.clone_attempts + " (limit " + limits.attempts + "); clones: " + counts.clones + "; unfetchable: " + counts.unfetchable.length,
    ...counts.unfetchable.map((p) => "unfetchable: frame position " + p + " leaves the frame"),
    "file check passes: test 1 " + counts.filecheck.front_end + ", test 2 " + counts.filecheck.components + ", test 3 " + counts.filecheck.design_system + ", test 4 " + counts.filecheck.routes + ", all four " + passes,
    "rate_limit after: " + after.remaining + " of " + after.limit + " points left; points used: " + (pointsUsed === null ? "unknown (the quota reset between reads)" : pointsUsed),
    ...Object.entries(files).map(([n, h]) => "sha256 " + n + " " + h),
  ];
  return { lines, files };
}

/** The file check on one local folder, printed as pass or fail per test with counts only. */
export function checkLines(dir: string, check: (d: string) => FileCheck = fileCheck): string[] {
  const c = check(dir);
  const pf = (b: boolean) => (b ? "pass" : "fail");
  return [
    "test 1 front end: " + pf(c.frontEnd) + " (" + c.frameworks.length + " frameworks named)",
    "test 2 components: " + pf(c.components) + " (" + (c.componentFolder?.count ?? 0) + " in the fullest folder)",
    "test 3 design system: " + pf(c.designSystem) + (c.designSource ? " (" + c.designSource.kind + ")" : ""),
    "test 4 routes: " + pf(c.routes) + " (" + c.routeCount + " distinct routes in " + c.routeSets.length + " route sets)",
    "file check: " + pf(c.pass),
  ];
}
