// Copyright (c) 2026 Garry Tan. MIT License.
// The office-hours rewrite eval's launches, their order and their frozen manifests (prereg sections 3, 12 and 13;
// pre-run change 1, items 4a and 5). A launch is one paid line's schedule:
//   stage1           the 8 calibration briefs, on none, current and new, with Opus, Sol and particle-1 (ledger line 3).
//   stage2           every comparison brief once per arm on Opus and Sol (line 5).
//   stage2-particle  every comparison brief once per arm on particle-1, on its own ledger line (line 6).
// Stage 1 runs in draw order. Stage 2 takes the comparison briefs in one order shuffled with frozen.SEED, then each
// brief's models in frozen.MODELS order, and puts a brief's three arms for one model next to each other in a seeded
// order from the same stream. A round is one brief and model with its arms.
// The reserve rule (section 3): a dropped comparison brief is replaced, in draw order, by the first unused reserve of
// the same kind before any stage 2 session runs on it. A paired brief's twin drops with it and the pair is replaced by
// a reserve pair, so pairs stay whole; an unpaired founder brief takes an unpaired founder reserve, a builder brief a
// builder reserve. A drop after a stage 2 row exists for the brief, or with no reserve left, refuses (E_OHR_RESERVE).
// Before the first lease, the manifest freezes to <out>/manifest.json: every entry, each brief's content digest read
// from its files on disk, both pins, both simulator rules digests (checked against the files), the build commit and the
// drops and their replacements. A relaunch on the same out dir must match it byte for byte (E_OHR_MANIFEST).
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { seededRandom } from "../../../src/runner/stats/paired.ts";
import { shuffle } from "../../product-value/stats.ts";
import { ARMS, CAPS, MODELS, PRIMARY_MODELS, QUOTA, SEED, SIM_RULES_SHA256, type Pin } from "../frozen.ts";
import { REPO_ROOT, simRules } from "../sim/founder.ts";
import type { ArmId, BriefMeta, ManifestEntry, ModelId } from "../types.ts";
import type { Pins } from "./pins.ts";

export const LAUNCHES = {
  stage1: { stage: 1, set: "calibration", models: MODELS, line: "stage1" },
  stage2: { stage: 2, set: "comparison", models: PRIMARY_MODELS, line: "stage2" },
  "stage2-particle": { stage: 2, set: "comparison", models: ["particle"] as readonly ModelId[], line: "stage2_particle" },
} as const satisfies Record<string, { stage: 1 | 2; set: "calibration" | "comparison"; models: readonly ModelId[]; line: keyof typeof CAPS }>;
export type LaunchName = keyof typeof LAUNCHES;
export const LAUNCH_NAMES = Object.keys(LAUNCHES) as LaunchName[];

/** Ledger lines as section 13 numbers them, with their frozen caps in dollars (frozen.CAPS). Authoring and the judge check belong to other areas. */
export const LEDGER_LINES: Readonly<Record<"simulator_audit" | "stage1" | "stage2" | "stage2_particle" | "hosts", { line: number; cap: number }>> = {
  simulator_audit: { line: 2, cap: CAPS.simulator_audit },
  stage1: { line: 3, cap: CAPS.stage1 },
  stage2: { line: 5, cap: CAPS.stage2 },
  stage2_particle: { line: 6, cap: CAPS.stage2_particle },
  hosts: { line: 7, cap: CAPS.hosts },
};

/** Why a launch's arm and simulator caps (micro-dollars) do not fit its line, or null. */
export function capProblem(launch: LaunchName, capMicros: number, simCapMicros: number): string | null {
  const line = LEDGER_LINES[LAUNCHES[launch].line];
  return capMicros + simCapMicros > line.cap * 1_000_000 ? "E_OHR_CAP_LINE the launch's caps of $" + (capMicros / 1e6).toFixed(2) + " (arms) and $" + (simCapMicros / 1e6).toFixed(2) + " (simulator) pass line " + line.line + "'s frozen cap of $" + line.cap : null;
}

const sha256 = (t: string) => createHash("sha256").update(t).digest("hex");

/** Every brief.json under a briefs directory, by brief id. */
export function loadBriefs(dir: string): BriefMeta[] {
  return readdirSync(dir).filter((id) => existsSync(join(dir, id, "brief.json"))).sort().map((id) => JSON.parse(readFileSync(join(dir, id, "brief.json"), "utf8")) as BriefMeta);
}

/** The files a brief's content digest reads: what sessions, seeding and the scorer read. prior.json only when present. */
export const BRIEF_FILES = ["opening.md", "sheet.json", "key.json", "brief.json", "prior.json"] as const;

/** sha256 over a brief's files as they are on disk, each named, so a changed file changes it; a declared digest is never copied. */
export const briefDigest = (dir: string, id: string): string =>
  sha256(BRIEF_FILES.filter((f) => f !== "prior.json" || existsSync(join(dir, id, f))).map((f) => f + "\0" + readFileSync(join(dir, id, f), "utf8")).join("\0"));

const byDraw = (a: BriefMeta, b: BriefMeta) => a.draw - b.draw;

export interface Replacement {
  dropped: string[];
  by: string[];
}

/** The comparison set after the reserve rule. ran names briefs that already have a stage 2 session. */
export function comparisonSet(briefs: readonly BriefMeta[], dropped: readonly string[], ran: ReadonlySet<string> = new Set()): { ids: string[]; replaced: Replacement[] } {
  const byId = new Map(briefs.map((b) => [b.id, b]));
  const drops = new Set<string>();
  for (const id of dropped) {
    const b = byId.get(id);
    if (!b || b.set !== "comparison") throw new Error("E_OHR_RESERVE " + id + " is not a comparison brief");
    drops.add(id);
    if (b.twin_of) drops.add(b.twin_of);
    for (const t of briefs) if (t.twin_of === id) drops.add(t.id);
  }
  for (const id of drops) if (ran.has(id)) throw new Error("E_OHR_RESERVE " + id + " already has a stage 2 session, so it cannot be replaced");
  const reserves = briefs.filter((b) => b.set === "reserve").sort(byDraw);
  const used = new Set<string>();
  const replaced: Replacement[] = [];
  const done = new Set<string>();
  for (const b of briefs.filter((x) => drops.has(x.id)).sort(byDraw)) {
    if (done.has(b.id)) continue;
    const pair = b.twin_of ? [b.id, b.twin_of] : briefs.filter((t) => t.twin_of === b.id).length ? [b.id, ...briefs.filter((t) => t.twin_of === b.id).map((t) => t.id)] : [b.id];
    pair.forEach((id) => done.add(id));
    const paired = pair.length > 1;
    const r = reserves.find((x) => !used.has(x.id) && x.kind === b.kind && (paired ? x.twin_of !== null || reserves.some((y) => y.twin_of === x.id) : x.twin_of === null && !reserves.some((y) => y.twin_of === x.id)));
    if (!r) throw new Error("E_OHR_RESERVE no unused " + (paired ? "reserve pair" : "unpaired " + b.kind + " reserve") + " is left for " + pair.join(" and "));
    const by = r.twin_of ? [r.id, r.twin_of] : [r.id, ...reserves.filter((y) => y.twin_of === r.id).map((y) => y.id)];
    by.forEach((id) => used.add(id));
    replaced.push({ dropped: pair, by });
  }
  const ids = [...briefs.filter((b) => b.set === "comparison" && !drops.has(b.id)), ...briefs.filter((b) => used.has(b.id))].map((b) => b.id);
  return { ids, replaced };
}

/** Why the briefs cannot fill the launch's set, or null. */
export function launchProblem(launch: LaunchName, briefs: readonly BriefMeta[], ids: readonly string[]): string | null {
  const want = LAUNCHES[launch].set === "calibration" ? QUOTA.calibration : QUOTA.founder + QUOTA.builder;
  if (ids.length !== want) return launch + " needs " + want + " " + LAUNCHES[launch].set + " briefs, and the briefs dir gives " + ids.length;
  const kinds = new Set(briefs.filter((b) => ids.includes(b.id)).map((b) => b.kind));
  if (LAUNCHES[launch].set === "comparison" && briefs.filter((b) => ids.includes(b.id) && b.kind === "builder").length !== QUOTA.builder) return launch + " needs " + QUOTA.builder + " builder briefs";
  return kinds.size ? null : launch + " has no briefs";
}

/** The launch's rounds in run order: each one brief and one model, with its arms next to each other. */
export function launchRounds(launch: LaunchName, briefs: readonly BriefMeta[], ids: readonly string[], arms: readonly ArmId[] = ARMS, models: readonly ModelId[] = LAUNCHES[launch].models): ManifestEntry[][] {
  const L = LAUNCHES[launch];
  const draw = new Map(briefs.map((b) => [b.id, b.draw]));
  const rng = seededRandom(SEED);
  const order = L.stage === 1 ? [...ids].sort((a, b) => draw.get(a)! - draw.get(b)!) : shuffle([...ids].sort(), rng);
  const keptModels = L.models.filter((m) => models.includes(m));
  const keptArms = ARMS.filter((a) => arms.includes(a));
  return order.flatMap((brief) => keptModels.map((model) => (L.stage === 1 ? keptArms : shuffle(keptArms, rng)).map((arm) => ({ stage: L.stage, brief, model, arm }))));
}

export interface Manifest {
  schema: 1;
  launch: LaunchName;
  stage: 1 | 2;
  models: ModelId[];
  arms: ArmId[];
  /** Each brief's content digest at freeze time. */
  briefs: Record<string, string>;
  pins: Record<"current" | "new", Pin | null>;
  /** The simulator rules digests, checked against change 1's attachments before the freeze. */
  sim_rules: typeof SIM_RULES_SHA256;
  build_commit: string;
  dropped: string[];
  replaced: Replacement[];
  entries: ManifestEntry[];
}

export const manifestText = (m: Manifest): string => JSON.stringify(m, null, 2) + "\n";
export const manifestSha256 = (m: Manifest): string => sha256(manifestText(m));

/** The build commit a launch runs: HEAD of this checkout, refused when tracked files differ from it. */
export function buildCommit(root: string = REPO_ROOT): string {
  const head = spawnSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" });
  if (head.status !== 0) throw new Error("E_OHR_BUILD_COMMIT " + root + " is not a git checkout: " + head.stderr.trim());
  const dirty = spawnSync("git", ["-C", root, "diff", "--quiet", "HEAD", "--"], { encoding: "utf8" });
  if (dirty.status !== 0) throw new Error("E_OHR_BUILD_COMMIT tracked files in " + root + " differ from " + head.stdout.trim());
  return head.stdout.trim();
}

/** The launch's manifest, after every check that needs no rig. */
export function makeManifest(o: { launch: LaunchName; briefsDir: string; models: readonly ModelId[]; arms: readonly ArmId[]; pins: Pins; buildCommit: string; dropped: readonly string[]; ran?: ReadonlySet<string> }): Manifest {
  const briefs = loadBriefs(o.briefsDir);
  const L = LAUNCHES[o.launch];
  const set = L.set === "calibration" ? { ids: briefs.filter((b) => b.set === "calibration").map((b) => b.id), replaced: [] } : comparisonSet(briefs, o.dropped, o.ran);
  if (L.set === "calibration" && o.dropped.length) throw new Error("E_OHR_RESERVE stage 1 takes no drops; reserves replace comparison briefs only");
  const problem = launchProblem(o.launch, briefs, set.ids);
  if (problem) throw new Error("E_OHR_MANIFEST " + problem);
  for (const k of ["founder", "builder"] as const) simRules(k);
  const entries = launchRounds(o.launch, briefs, set.ids, o.arms, o.models).flat();
  return {
    schema: 1, launch: o.launch, stage: L.stage, models: L.models.filter((m) => o.models.includes(m)), arms: ARMS.filter((a) => o.arms.includes(a)),
    briefs: Object.fromEntries([...set.ids].sort().map((id) => [id, briefDigest(o.briefsDir, id)])),
    pins: { current: o.pins.current, new: o.pins.new }, sim_rules: SIM_RULES_SHA256, build_commit: o.buildCommit,
    dropped: [...o.dropped].sort(), replaced: set.replaced, entries,
  };
}

/** Freezes the manifest at path, or checks the one frozen there byte for byte. */
export function freezeManifest(path: string, m: Manifest): { sha256: string; wrote: boolean } | { problem: string } {
  const text = manifestText(m);
  if (!existsSync(path)) {
    writeFileSync(path, text, { flag: "wx" });
    return { sha256: sha256(text), wrote: true };
  }
  const frozen = readFileSync(path, "utf8");
  if (frozen !== text) return { problem: path + " froze manifest " + sha256(frozen) + ", and this launch schedules " + sha256(text) + " (stage, models, arms, brief digests, pins, simulator rules, build commit, drops or entries differ)" };
  return { sha256: sha256(text), wrote: false };
}

export const readManifest = (path: string): Manifest => JSON.parse(readFileSync(path, "utf8")) as Manifest;

/** A session's id in rows, logs and session dirs. */
export const entryId = (e: ManifestEntry): string => ["s" + e.stage, e.model, e.arm, e.brief].join("/");
