// Copyright (c) 2026 Garry Tan. MIT License.
// The office-hours founder eval's cells, rounds and frozen manifests (prereg sections 10, 11 and 13, and the Captain's AN-1
// ruling). A cell is one launch's schedule:
//   stage1  Opus none 3 passes on the 16 calibration units and the pinned twins; Sol and particle-1 none 2 passes on the 16;
//           the full-information reference with Opus 3 passes and Sol and particle-1 2 passes on the 16.
//   smoke   6 office-hours sessions per model on the first 6 calibration units in draw order, and 2 lens sessions on
//           Opus, on the first 2 calibration units in draw order (the build's pick).
//   stage2  the 64 comparison units, none, lens and office-hours, Opus at 2 passes, Sol and particle-1 at 1.
//   pitch   the pitch-only cell: the 64 units, three arms, three models, one pass, founder-reply limit 0. It has its own
//           manifest and its own ledger item and stays outside the primary manifest.
//   real    the real stratum's units on stage 2's arms, models and passes, its own manifest too.
// A round is up to 4 units with every arm of the cell on one model, one pass and one kind. Stage 1 and the smoke take
// units in draw order; stage 2, the pitch cell and the real stratum take them in one seeded order (seed 20261109). Rounds
// run pass by pass, then 4-unit group by group, then model by model (Opus, Sol, particle-1), then kind.
// Before a cell's first lease its manifest is frozen to <out>/manifest.json with the sha256 of its body: every entry, the
// models and arms the launch kept, the repairs in force and each unit's digest. A later launch on the same out dir must
// match it byte for byte, or it is refused before any lease.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { seededRandom } from "../../../src/runner/stats/paired.ts";
import { shuffle } from "../../product-value/stats.ts";
import { ARMS, MODELS, QUOTA, SEED, TWINS } from "../frozen.ts";
import type { ArmId, ManifestEntry, ModelId, SessionKind, UnitMeta } from "../types.ts";
import type { Repair } from "./session.ts";

export const CELLS = ["stage1", "smoke", "stage2", "pitch", "real"] as const;
export type Cell = (typeof CELLS)[number];

const sha256 = (t: string) => createHash("sha256").update(t).digest("hex");

/** Every unit.json under a units directory, by unit id. */
export function loadUnits(dir: string): UnitMeta[] {
  return readdirSync(dir).filter((id) => existsSync(join(dir, id, "unit.json"))).sort().map((id) => JSON.parse(readFileSync(join(dir, id, "unit.json"), "utf8")) as UnitMeta);
}

const inSet = (units: readonly UnitMeta[], set: UnitMeta["set"]): string[] => units.filter((u) => u.set === set).sort((a, b) => a.draw - b.draw).map((u) => u.id);

/** The files a unit's content digest reads: what the sessions and the scorer read, and unit.json with twin_of. */
const UNIT_FILES = ["opening.md", "sheet.json", "key.json", "unit.json"] as const;

/** sha256 over a unit's files as they are on disk, so a changed opening, sheet, key or unit.json changes it. */
export const contentDigest = (dir: string, id: string): string => sha256(UNIT_FILES.map((f) => readFileSync(join(dir, id, f), "utf8")).join("\0"));

/** The twin set's digest: sha256 over "id twin_of content" lines in draw order, each content digest read from the unit's files. */
export const twinDigest = (dir: string, units: readonly UnitMeta[]): string =>
  sha256(units.filter((u) => u.set === "twin").sort((a, b) => a.draw - b.draw).map((u) => u.id + " " + u.twin_of + " " + contentDigest(dir, u.id)).join("\n") + "\n");

/** Why the units under dir cannot fill the cell's quotas, or null. */
export function cellProblem(cell: Cell, units: readonly UnitMeta[], dir: string, twins: { min: number; max: number; digest: string } = TWINS): string | null {
  const count = (set: UnitMeta["set"]) => inSet(units, set).length;
  if ((cell === "stage1" || cell === "smoke") && count("calibration") !== QUOTA.calibration) return cell + " needs " + QUOTA.calibration + " calibration units, and the units dir holds " + count("calibration");
  if (cell === "stage1" && (count("twin") < twins.min || count("twin") > twins.max)) return "stage1 needs " + twins.min + " to " + twins.max + " twins, and the units dir holds " + count("twin");
  if (cell === "stage1") {
    let digest: string;
    try {
      digest = twinDigest(dir, units);
    } catch (error) {
      return "stage1 cannot read a twin's files: " + (error as Error).message;
    }
    if (digest !== twins.digest) return "stage1 takes only the pinned twins (digest " + twins.digest.slice(0, 12) + "), and the units dir's " + count("twin") + " twins have digest " + digest.slice(0, 12);
  }
  if ((cell === "stage2" || cell === "pitch") && count("comparison") !== QUOTA.comparison) return cell + " needs " + QUOTA.comparison + " comparison units, and the units dir holds " + count("comparison");
  if (cell === "real" && count("real") === 0) return "the real cell needs real-stratum units, and the units dir holds none";
  return null;
}

/** Stage 2's passes per model. */
export const STAGE2_PASSES: Readonly<Record<ModelId, number>> = { opus: 2, sol: 1, particle: 1 };

/** Every session a cell schedules, before any model or arm filter. */
export function cellEntries(cell: Cell, units: readonly UnitMeta[]): ManifestEntry[] {
  const out: ManifestEntry[] = [];
  const add = (stage: 1 | 2, kind: SessionKind, ids: readonly string[], model: ModelId, arm: ArmId, passes: number) => {
    for (let pass = 1; pass <= passes; pass++) for (const unit of ids) out.push({ stage, kind, unit, model, arm, pass });
  };
  const cal = inSet(units, "calibration");
  if (cell === "stage1") {
    add(1, "arm", [...cal, ...inSet(units, "twin")], "opus", "none", 3);
    for (const m of ["sol", "particle"] as const) add(1, "arm", cal, m, "none", 2);
    for (const m of MODELS) add(1, "reference", cal, m, "none", m === "opus" ? 3 : 2);
  }
  if (cell === "smoke") {
    for (const m of MODELS) add(1, "arm", cal.slice(0, 6), m, "office-hours", 1);
    add(1, "arm", cal.slice(0, 2), "opus", "lens", 1);
  }
  if (cell === "stage2" || cell === "real") for (const m of MODELS) for (const a of ARMS) add(2, "arm", inSet(units, cell === "real" ? "real" : "comparison"), m, a, STAGE2_PASSES[m]);
  if (cell === "pitch") for (const m of MODELS) for (const a of ARMS) add(2, "pitch", inSet(units, "comparison"), m, a, 1);
  return out;
}

/** The cell's rounds in run order. */
export function cellRounds(cell: Cell, entries: readonly ManifestEntry[]): ManifestEntry[][] {
  const ids = [...new Set(entries.map((e) => e.unit))];
  const order = cell === "stage1" || cell === "smoke" ? ids : shuffle([...ids].sort(), seededRandom(SEED));
  const pos = new Map(order.map((id, i) => [id, i]));
  const key = (e: ManifestEntry) => [e.pass, Math.floor(pos.get(e.unit)! / 4), MODELS.indexOf(e.model), e.kind === "reference" ? 1 : 0];
  const groups = new Map<string, ManifestEntry[]>();
  const sorted = [...entries].sort((a, b) => {
    const [ka, kb] = [key(a), key(b)];
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i]! - kb[i]!;
    return pos.get(a.unit)! - pos.get(b.unit)! || ARMS.indexOf(a.arm) - ARMS.indexOf(b.arm);
  });
  for (const e of sorted) {
    const k = key(e).join(":");
    groups.set(k, [...(groups.get(k) ?? []), e]);
  }
  return [...groups.values()];
}

export interface Manifest {
  schema: 1;
  cell: Cell;
  models: ModelId[];
  arms: ArmId[];
  repairs: Repair[];
  /** Each unit's digest (UnitMeta.digest) at freeze time. */
  units: Record<string, string>;
  entries: ManifestEntry[];
}

export const manifestSha256 = (m: Manifest): string => sha256(JSON.stringify(m));

/** Freezes the manifest at path, or checks the one already frozen there; a problem refuses the launch before any lease. */
export function freezeManifest(path: string, m: Manifest): { sha256: string; wrote: boolean } | { problem: string } {
  const sha = manifestSha256(m);
  if (!existsSync(path)) {
    writeFileSync(path, JSON.stringify({ sha256: sha, manifest: m }, null, 2) + "\n", { flag: "wx" });
    return { sha256: sha, wrote: true };
  }
  let frozen: { sha256?: unknown; manifest?: Manifest };
  try {
    frozen = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return { problem: path + " is not JSON" };
  }
  if (!frozen.manifest || frozen.sha256 !== manifestSha256(frozen.manifest)) return { problem: path + "'s sha256 does not match its body, so the frozen manifest was changed after it froze" };
  if (frozen.sha256 !== sha) return { problem: path + " froze manifest " + frozen.sha256 + ", and this launch schedules " + sha + " (cell, models, arms, repairs, unit digests or entries differ)" };
  return { sha256: sha, wrote: false };
}

/** The frozen manifest at path, already checked against its sha256. */
export function readManifest(path: string): Manifest {
  const frozen = JSON.parse(readFileSync(path, "utf8")) as { sha256: string; manifest: Manifest };
  if (frozen.sha256 !== manifestSha256(frozen.manifest)) throw new Error("E_USAGE " + path + "'s sha256 does not match its body");
  return frozen.manifest;
}

/** A session's id in rows, the journal and session dirs. */
export const entryId = (e: ManifestEntry): string => [e.kind, e.model, e.arm, e.unit, "p" + e.pass].join("/");
