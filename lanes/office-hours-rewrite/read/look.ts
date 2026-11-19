// Copyright (c) 2026 Garry Tan. MIT License.
// Stage 2's one interim look (pre-run change 3 to the second attempt, rule R113). Stage 2 on Opus 5.5 and Sol is
// planned above $500 paid, so it reads its primary comparison, pooled new minus current on founder briefs, once at its
// preregistered half (run/half.ts) and once at the end, and at no other time.
// The bounds are R113's O'Brien-Fleming two-look bounds for the plan's two-sided test at 0.05, 2.80 at the half and
// 1.98 at the end. They enter as their two-sided nominal levels, 0.00511 and 0.0477, and each look reads its level on
// the plan's own statistic, the paired t over founder clusters with C - 1 degrees of freedom: 3.2754 at 16 clusters and
// 2.0617 at 32. The interim read's four actions, in order:
//   stop-new       the estimate over its standard error is past the interim bound: stop, and read MERGE if the plan's
//                  bar is met, marked possibly overstated;
//   stop-current   past the interim bound the other way: stop, and read no MERGE;
//   stop-futility  conditional power under the plan's 15-point lift is below 10%: stop, and read no MERGE;
//   continue       run the second half, and read the end at the final level.
// Conditional power takes the half's estimate and spread as known and the second half's true difference as 0.15; it is
// the chance that the pooled estimate over both halves lands past the final bound. A half whose clusters all differ by
// the same amount reads by the sign of its estimate. The interim command writes the read to its record and prints only
// the action when it continues; the record's numbers stay there until the final read.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DECISION, PRIMARY_MODELS } from "../frozen.ts";
import type { Action, Half } from "../run/half.ts";
import { entryId, manifestSha256, readManifest, type Manifest } from "../run/manifest.ts";
import { readRows } from "../run/rows.ts";
import type { ScoredSession } from "../types.ts";
import { estimate } from "./estimate.ts";
import { gt, lt, tQuantile } from "./stats.ts";

const fail = (why: string): never => {
  throw new Error("E_OHR_READ_INPUT " + why);
};

/** The standard normal distribution function: erf's Taylor series below 3, erfc's continued fraction from 3 on. */
export function normalCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  let upper: number;
  if (Math.abs(z) < 3) {
    let term = x, sum = x;
    for (let n = 1; n < 200 && Math.abs(term) > 1e-17 * Math.abs(sum); n++) {
      term *= (-x * x) / n;
      sum += term / (2 * n + 1);
    }
    upper = 0.5 * (1 - (2 / Math.sqrt(Math.PI)) * sum);
  } else {
    let f = x;
    for (let k = 120; k >= 1; k--) f = x + k / 2 / f;
    upper = (0.5 * Math.exp(-x * x)) / (Math.sqrt(Math.PI) * f);
  }
  return z >= 0 ? 1 - upper : upper;
}

const twoSided = (z: number) => 2 * (1 - normalCdf(z));

export const LOOK = {
  interim_z: 2.8,
  final_z: 1.98,
  interim_level: twoSided(2.8),
  final_level: twoSided(1.98),
  futility: 0.1,
  planned_effect: DECISION.bar,
} as const;

/** The bound a two-sided level gives on the paired t over C clusters. */
export const bound = (level: number, C: number): number => tQuantile(1 - level / 2, C - 1);

export interface InterimRead {
  /** Founder clusters with a new-minus-current difference in the half, and the clusters the second half schedules. */
  C: number;
  C2: number;
  estimate: number;
  sd: number;
  /** The estimate over its standard error; null when every cluster differs by the same amount. */
  z: number | null;
  /** The interim bound at C clusters, and the final bound at C + C2. */
  bound: number;
  final_bound: number;
  /** Conditional power under the planned effect. */
  cp: number;
  action: Action;
}

/** The interim read on the half's scored rows. */
export function interimRead(rows: readonly ScoredSession[], half: Half): InterimRead {
  const e = estimate(rows, { a: "new", b: "current", kind: "founder" });
  if (e.C < 2 || e.estimate === null || e.sd === null) return fail("the interim read needs at least two founder clusters with a new-minus-current difference, and the half gives " + e.C);
  const C = e.C, C2 = half.second.clusters, m = e.estimate, sd = e.sd, d = LOOK.planned_effect;
  if (!(C2 >= 1)) fail("the half's second part schedules no founder cluster");
  const b1 = bound(LOOK.interim_level, C), b2 = bound(LOOK.final_level, C + C2);
  const z = sd > 0 ? m / (sd / Math.sqrt(C)) : null;
  const cp = sd > 0 ? normalCdf(((C * m + C2 * d) / C2 - (b2 * sd * Math.sqrt(C + C2)) / C2) / (sd / Math.sqrt(C2))) : gt(C * m + C2 * d, 0) ? 1 : 0;
  const past = z === null ? (gt(m, 0) ? 1 : lt(m, 0) ? -1 : 0) : gt(z, b1) ? 1 : lt(z, -b1) ? -1 : 0;
  const action: Action = past === 1 ? "stop-new" : past === -1 ? "stop-current" : lt(cp, LOOK.futility) ? "stop-futility" : "continue";
  return { C, C2, estimate: m, sd, z, bound: b1, final_bound: b2, cp, action };
}

export interface LookRecord {
  schema: 1;
  /** sha256 of the first part's frozen manifest, whose half the read covers. */
  part1_manifest_sha256: string;
  half: Half;
  read: InterimRead;
}

const ACTIONS: readonly Action[] = ["continue", "stop-new", "stop-current", "stop-futility"];
const primary = (rows: readonly ScoredSession[]) => rows.filter((r) => r.stage === 2 && PRIMARY_MODELS.includes(r.model));

/** The scored stage 2 rows on Opus and Sol must be exactly the sessions the manifests schedule. */
function sameSessions(rows: readonly ScoredSession[], manifests: readonly Manifest[], what: string): void {
  const want = new Set(manifests.flatMap((m) => m.entries.map(entryId)));
  const have = new Set(primary(rows).map(entryId));
  const extra = [...have].filter((id) => !want.has(id)), short = [...want].filter((id) => !have.has(id));
  if (extra.length) fail("the scored stage 2 rows on Opus and Sol hold " + extra.length + " sessions " + what + " does not schedule, such as " + extra.slice(0, 3).join(", "));
  if (short.length) fail("the scored stage 2 rows on Opus and Sol lack " + short.length + " sessions " + what + " schedules, such as " + short.slice(0, 3).join(", "));
}

/** The interim read on stage 2's first part: its launch must be the half, ended without a cap stop, with a row for every session. */
export function interimLook(o: { launch: string; rows: readonly ScoredSession[] }): LookRecord {
  const file = join(o.launch, "manifest.json");
  if (!existsSync(file)) fail(o.launch + " has no manifest.json");
  const m = readManifest(file);
  if (m.launch !== "stage2" || m.part !== "first" || !m.half) return fail(o.launch + " is not stage 2's first part (its manifest names " + m.launch + ", " + (m.part ? "part " + m.part : "no part") + "), and the interim read takes the half alone");
  const stopsFile = join(o.launch, "stops.json");
  if (!existsSync(stopsFile)) fail(o.launch + " has no stops.json, so the half may not have ended");
  const s = JSON.parse(readFileSync(stopsFile, "utf8")) as { stops: { code: string; message: string }[]; earlier?: { code: string; message: string }[] };
  const capped = [...(s.earlier ?? []), ...s.stops].find((x) => x.code === "CAP_STOP");
  if (capped) fail(o.launch + " ended on a cap stop (" + capped.message + "), so stage 2 is incomplete and takes no interim look");
  const logged = readRows(o.launch);
  const unrun = m.entries.filter((e) => !logged.has(entryId(e)));
  if (unrun.length) fail(o.launch + " has no row for " + unrun.length + " of the half's sessions, such as " + unrun.slice(0, 3).map(entryId).join(", ") + "; the half is read only once every session ran");
  sameSessions(o.rows, [m], "the half");
  return { schema: 1, part1_manifest_sha256: manifestSha256(m), half: m.half, read: interimRead(primary(o.rows), m.half) };
}

/** An interim read record, and the sha256 of its bytes that the second part and the final read name it by. */
export function readLook(path: string): { record: LookRecord; sha256: string } {
  if (!existsSync(path)) fail(path + " does not exist");
  const bytes = readFileSync(path);
  let record: LookRecord | null = null;
  try {
    record = JSON.parse(bytes.toString("utf8")) as LookRecord;
  } catch {
    fail(path + " is not JSON");
  }
  if (record?.schema !== 1 || !/^[0-9a-f]{64}$/.test(String(record.part1_manifest_sha256)) || !record.half?.first || !record.half?.second || !ACTIONS.includes(record.read?.action)) fail(path + " is not an interim read record: schema 1, the first part's manifest digest, the half and the read's action");
  return { record: record!, sha256: createHash("sha256").update(bytes).digest("hex") };
}

/** Every launch's frozen manifest. */
export const launchManifests = (dirs: readonly string[]): Manifest[] =>
  dirs.map((d) => {
    const file = join(d, "manifest.json");
    if (!existsSync(file)) fail(d + " has no manifest.json, so its sessions cannot be matched to a part of stage 2");
    return readManifest(file);
  });

/** What the final read takes from the interim read: its action, whether stage 2 stopped at its half, and the level the pooled primary is read at. */
export interface Look {
  action: Action;
  early: boolean;
  level: number;
}

/** The final read's gate: the parts that ran are exactly the ones the interim read's action calls for, and the scored rows are exactly their sessions. */
export function lookGate(o: { look: LookRecord; lookSha: string; manifests: readonly Manifest[]; rows: readonly ScoredSession[] }): Look {
  const s2 = o.manifests.filter((m) => m.launch === "stage2");
  if (s2.some((m) => !m.part)) fail("a stage 2 launch ran without parts, so its rows cannot be read under the interim look");
  const firsts = s2.filter((m) => m.part === "first"), seconds = s2.filter((m) => m.part === "second");
  if (firsts.length !== 1) fail("the final read takes one stage 2 first part, and the launches give " + firsts.length);
  const first = firsts[0]!;
  if (manifestSha256(first) !== o.look.part1_manifest_sha256) fail("the interim read covered first part " + o.look.part1_manifest_sha256 + ", and the launch's first part froze " + manifestSha256(first));
  if (JSON.stringify(first.half) !== JSON.stringify(o.look.half)) fail("the interim read's half is not the one the first part froze");
  const action = o.look.read.action;
  if (action === "stop-current" || action === "stop-futility") {
    if (seconds.length) fail("the interim read stopped stage 2 at its half (" + action + "), and a second part ran");
  } else {
    if (seconds.length !== 1) fail("the interim read's action is " + action + ", so the final read takes one second part, and the launches give " + seconds.length);
    const s = seconds[0]!;
    if (s.interim_sha256 !== o.lookSha || s.action !== action) fail("the second part ran after interim read " + s.interim_sha256 + " (" + s.action + "), not after this one, " + o.lookSha + " (" + action + ")");
  }
  sameSessions(o.rows, [first, ...seconds], "the parts that ran");
  const early = action !== "continue";
  return { action, early, level: early ? LOOK.interim_level : LOOK.final_level };
}
