// Copyright (c) 2026 Garry Tan. MIT License.
// Plan section 11's sealed stage 1 readout. It releases only the post's list: the no-skills rate and the pooled rate over
// the 7 primary arms per class, the gap rate per cell, per-arm session costs (mean, median, 95th percentile), the
// discordant share per contrast with no direction, piece G's log-ratio spread with no direction, and the full-size flag;
// then the frozen readings (FLOOR, CEILING, INFRA, COST) and the MDDs the discordance restates. Every per-arm outcome goes
// only into an AES-256-GCM file under a key kept outside the repository; the file's sha256 is for the run record.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { h2hFail, type H2hPrereg } from "../prereg.ts";
import { COMPARATORS, PIECE_G_ARMS, PRIMARY_ARMS, SECONDARY_ARMS, type H2hArm, type UnitClass } from "../types.ts";
import { cellOf, Data, type AnalysisInput } from "./analyze.ts";
import { reprice, type ArmCost, type Repricing } from "./cost.ts";
import { mdd } from "./power.ts";
import { logRatio } from "./stats.ts";

const REPO = join(import.meta.dir, "..", "..", "..", "..");
const SEALED = "h2h-sealed.v1";
export const FULL_SIZE_B = 80;

export interface Release {
  schema: "h2h-stage1-release.v1";
  classes: Record<UnitClass, { units: number; none: { fixes: number; scored: number; gaps: number }; pooled: { fixes: number; scored: number; rate: number | null } }>;
  /** Gap share per cell, "class arm". */
  gap_rate: Record<string, number | null>;
  costs: Record<string, Partial<Record<UnitClass, ArmCost>>>;
  /** Discordant share per primary contrast, "class gstack-vs-other", with no direction. */
  discordant_share: Record<string, number | null>;
  piece_g: { log_ratio_sd: number | null; units: number };
  full_size_flag: boolean;
  /** The MDDs at core n that the measured discordance restates, at alpha 0.05/12 and 0.05. */
  mdd_restated: Record<string, { n: number; d: number | null; strict: number | null; last: number | null }>;
  cost: Omit<Repricing, "costs">;
  readings: { reading: "FLOOR" | "CEILING" | "INFRA" | "COST"; where: string; response: string }[];
}

export interface Sealed { schema: "h2h-stage1-outcomes.v1"; outcomes: Record<string, unknown>[] }
export type ReadoutInput = Omit<AnalysisInput, "stage"> & { caps?: Record<string, number>; approved?: number };
type Texts = Record<"floor" | "ceiling" | "infra" | "cost", string>;

/** prereg.json's stage1_readings texts (not typed in H2hPrereg). */
export function readingTexts(p: H2hPrereg): Texts {
  const t = (p as H2hPrereg & { stage1_readings?: Partial<Texts> }).stage1_readings ?? {};
  for (const k of ["floor", "ceiling", "infra", "cost"] as const) if (typeof t[k] !== "string" || !t[k]) h2hFail("E_H2H_PREREG", "prereg.json has no stage1_readings." + k + " text");
  return t as Texts;
}

/** The stage 1 release and the sealed per-arm outcomes. */
export function readout(i: ReadoutInput, p: H2hPrereg): { release: Release; sealed: Sealed } {
  const d = new Data({ ...i, stage: "stage1" });
  const texts = readingTexts(p);
  const memo = new Map<string, number | null>();
  const mddAt = (n: number, share: number | null, alpha: number) => {
    if (share === null || n === 0) return null;
    const k = n + "|" + share + "|" + alpha;
    if (!memo.has(k)) memo.set(k, mdd(n, share, alpha));
    return memo.get(k)!;
  };
  const classes = {} as Release["classes"];
  const gap_rate: Release["gap_rate"] = {};
  const discordant_share: Release["discordant_share"] = {};
  const mdd_restated: Release["mdd_restated"] = {};
  const readings: Release["readings"] = [];
  let fullSize = false;
  for (const cls of ["O", "B"] as const) {
    const us = d.units.filter((u) => u.class === cls);
    const vals = (arm: H2hArm) => us.map((u) => d.value(u, arm));
    const none = vals("none");
    const pooled = PRIMARY_ARMS.flatMap((arm) => vals(arm)).filter((v) => v !== null);
    classes[cls] = {
      units: us.length, none: { fixes: none.filter((v) => v === 1).length, scored: none.filter((v) => v !== null).length, gaps: none.filter((v) => v === null).length },
      pooled: { fixes: pooled.filter((v) => v === 1).length, scored: pooled.length, rate: pooled.length ? pooled.filter((v) => v === 1).length / pooled.length : null },
    };
    for (const arm of [...PRIMARY_ARMS, ...PIECE_G_ARMS, ...SECONDARY_ARMS]) {
      const c = cellOf(d, p, cls, arm);
      if (!c.units) continue;
      gap_rate[cls + " " + arm] = c.gap_share;
      if (c.incomplete) readings.push({ reading: "INFRA", where: cls + " " + arm, response: texts.infra });
    }
    const coreN = cls === "O" ? p.classes.O.n : p.classes.B.n;
    for (const other of COMPARATORS) {
      const pairs = us.flatMap((u) => {
        const a = d.value(u, other), b = d.value(u, "gstack");
        return a === null || b === null ? [] : [{ a, b }];
      });
      const disc = pairs.filter((x) => x.a !== x.b).length;
      const share = pairs.length ? disc / pairs.length : null;
      const key = cls + " gstack-vs-" + other;
      discordant_share[key] = share;
      mdd_restated[key] = { n: coreN, d: share, strict: mddAt(coreN, share, 0.05 / 12), last: mddAt(coreN, share, 0.05) };
      if (cls === "B" && pairs.length) {
        const diff = Math.abs(pairs.reduce((s, x) => s + x.b - x.a, 0) / pairs.length);
        const full = mddAt(FULL_SIZE_B, share, 0.05 / 12);
        if (full !== null && diff >= full) fullSize = true;
      }
    }
    const fixes = classes[cls].none.fixes;
    if (fixes < 2) readings.push({ reading: "FLOOR", where: cls, response: texts.floor });
    if (fixes >= 11) readings.push({ reading: "CEILING", where: cls, response: texts.ceiling });
  }
  const ou = d.units.filter((u) => u.class === "O");
  const lr = logRatio(ou.filter((u) => d.value(u, "gstack-pony") === 1 && d.value(u, "gstack") === 1).map((u) => ({ repo: u.repo, x: d.score(u, "gstack")!.lines_changed, y: d.score(u, "gstack-pony")!.lines_changed })), p.bootstrap_seed);
  const sessions = d.units.flatMap((u) => [...PRIMARY_ARMS, ...PIECE_G_ARMS, ...SECONDARY_ARMS].map((arm) => d.session(u, arm)).filter((s) => s !== null).map((s) => ({ s: s!, cls: u.class })));
  const { costs, ...cost } = reprice(p, sessions, { caps: i.caps, approved: i.approved });
  if (cost.above) readings.push({ reading: "COST", where: "program", response: texts.cost });
  const release: Release = {
    schema: "h2h-stage1-release.v1", classes, gap_rate, costs, discordant_share, piece_g: { log_ratio_sd: lr.sd_log, units: lr.n }, full_size_flag: fullSize, mdd_restated, cost, readings,
  };
  const outcomes = d.units.flatMap((u) => [...PRIMARY_ARMS, ...PIECE_G_ARMS, ...SECONDARY_ARMS].map((arm) => d.score(u, arm)).filter((s) => s !== null)).map((s) => ({
    unit: s!.unit, arm: s!.arm, outcome: s!.outcome, verified: s!.verified, verified_without_new_test_rule: s!.verified_without_new_test_rule, adapted_verified: s!.adapted_verified,
    gap: s!.gap, lines_changed: s!.lines_changed, planning_lines: s!.planning_lines, worktree_pass: s!.worktree_pass,
  }));
  outcomes.sort((a, b) => (a.unit + "\t" + a.arm < b.unit + "\t" + b.arm ? -1 : 1));
  return { release, sealed: { schema: "h2h-stage1-outcomes.v1", outcomes } };
}

/** The readout key: a file outside any git work tree, mode 0600, holding 32 raw bytes or 64 hex characters. */
export function readKey(path: string): Buffer {
  if (!existsSync(path)) h2hFail("E_H2H_READOUT_KEY", path + " does not exist");
  const real = realpathSync(path);
  const repo = realpathSync(REPO);
  if (real === repo || real.startsWith(repo + "/")) h2hFail("E_H2H_READOUT_KEY", "the key is inside this repository");
  for (let dir = dirname(real); ; dir = dirname(dir)) {
    if (existsSync(join(dir, ".git"))) h2hFail("E_H2H_READOUT_KEY", "the key is inside the git work tree at " + dir);
    if (dirname(dir) === dir) break;
  }
  if ((statSync(real).mode & 0o077) !== 0) h2hFail("E_H2H_READOUT_KEY", "the key file must be mode 0600 (no group or other access)");
  const raw = readFileSync(real);
  if (raw.length === 32) return raw;
  const text = raw.toString("utf8").trim();
  if (/^[0-9a-fA-F]{64}$/.test(text)) return Buffer.from(text, "hex");
  return h2hFail("E_H2H_READOUT_KEY", "the key file must hold 32 raw bytes or 64 hex characters");
}

/** Encrypts the sealed outcomes to a new file (mode 0600) and returns the file's sha256. */
export function seal(sealed: Sealed, key: Buffer, out: string): string {
  if (existsSync(out)) h2hFail("E_H2H_READOUT_OUT", out + " already exists; a sealed file is never overwritten");
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(Buffer.from(SEALED));
  const ciphertext = Buffer.concat([c.update(JSON.stringify(sealed), "utf8"), c.final()]);
  const text = JSON.stringify({ schema: SEALED, alg: "aes-256-gcm", iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") }) + "\n";
  try {
    writeFileSync(out, text, { flag: "wx", mode: 0o600 });
  } catch (e) {
    h2hFail("E_H2H_READOUT_OUT", out + " cannot be written: " + (e as Error).message);
  }
  return createHash("sha256").update(text).digest("hex");
}

/** Opens a sealed file (stage 2's step after scoring). */
export function unseal(file: string, key: Buffer): Sealed {
  const env = JSON.parse(readFileSync(file, "utf8")) as { schema: string; iv: string; tag: string; ciphertext: string };
  if (env.schema !== SEALED) h2hFail("E_H2H_READOUT_OUT", file + " is not an " + SEALED + " file");
  const dc = createDecipheriv("aes-256-gcm", key, Buffer.from(env.iv, "base64"));
  dc.setAAD(Buffer.from(SEALED));
  dc.setAuthTag(Buffer.from(env.tag, "base64"));
  try {
    return JSON.parse(Buffer.concat([dc.update(Buffer.from(env.ciphertext, "base64")), dc.final()]).toString("utf8")) as Sealed;
  } catch (e) {
    return h2hFail("E_H2H_READOUT_KEY", file + " does not open with this key: " + (e as Error).message);
  }
}
