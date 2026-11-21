// Copyright (c) 2026 Garry Tan. MIT License.
// Plan section 12's sealed stage 1 readout, with section 4's allowance doubling, the n2 re-pricing rule and the headroom
// readings read on Opus (FLOOR, CEILING, MOST, EXPOSURE, INFRA, COST, JUDGE; every reading that holds is reported, in no
// order of its own). The release carries exactly analysis/release.ts's RELEASE_ITEMS, the judge item through judgeRelease
// (deviation (b)); the readings, the re-pricing and the doubling derive only from released items. Every per-arm outcome
// and the judge check's detail go only into an AES-256-GCM file under a key kept outside the repository, on the
// head-to-head's seal pattern; the file's sha256 is for the run record.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { mean, percentile } from "../../h2h/analysis/stats.ts";
import { csoFail, type CsoPrereg } from "../prereg.ts";
import type { CsoArm, CsoModel, SessionRecord } from "../types.ts";
import type { CsoScore } from "../score/outcomes.ts";
import { judgeRelease, RELEASE_ITEMS, type JudgeCheck, type JudgeRelease } from "./release.ts";
import { interimApplies } from "./verdicts.ts";

const REPO = join(import.meta.dir, "..", "..", "..", "..");
const SEALED = "cso-sealed.v1";
const STAGE1_CELLS: [CsoModel, CsoArm][] = [["opus", "none"], ["opus", "cso"], ["opus", "untold"], ["particle", "none"], ["particle", "cso"]];
const STAGE2_CELLS: [CsoModel, CsoArm][] = [["opus", "none"], ["opus", "cso"], ["particle", "none"], ["particle", "cso"]];
const N2 = { min: 48, max: 100, step: 4 } as const;
const MOST = { min: 7, max: 9 } as const;
const EXPOSURE_MIN_OF_12 = 10;
const INFRA_GAP_SHARE = 0.1;

export interface ReadoutInput {
  /** Stage 1's unit ids (12), or the re-pilot's. */
  units: string[];
  sessions: SessionRecord[];
  scores: CsoScore[];
  checks: JudgeCheck[];
  /** Actual paid spend of stage 0 and stage 1, judging included. */
  spent_usd: number;
  /** Stage 1's measured central judging cost per stage 2 session (passes A and B). */
  judging_per_session_usd: number;
  /** The VM's cost in the re-priced program, and the part of it that counts toward stage 2's planned paid total. The plan
   *  names "part of the $40 VM" without a rule, so the caller states it. */
  vm_usd: number;
  vm_stage2_usd: number;
}

export interface ArmCost { n: number; mean: number | null; median: number | null; p95: number | null }
export interface Repricing { per_unit_usd: number; n2: number | null; program_usd: number | null; stage2_paid_usd: number | null; to_captain: boolean; interim_look: boolean }
export type ReadingName = "FLOOR" | "CEILING" | "MOST" | "EXPOSURE" | "INFRA" | "COST" | "JUDGE";
export interface Release {
  schema: "cso-stage1-release.v1";
  items: { item: (typeof RELEASE_ITEMS)[number]; value: unknown }[];
  readings: { reading: ReadingName; where: string; response: string }[];
  repricing: Repricing;
  allowance_doubled: Record<string, boolean>;
}
export interface Sealed { schema: "cso-stage1-outcomes.v1"; outcomes: Record<string, unknown>[]; judge_detail: { route: string; detail: unknown }[] }

const allowanceKey = (m: CsoModel) => (m === "particle" ? "particle-1" : m);

/** The stage 1 release and the sealed per-arm outcomes (E_CSO_ANALYSIS_INPUT on a duplicate score). */
export function readout(i: ReadoutInput, p: CsoPrereg): { release: Release; sealed: Sealed } {
  const ids = new Set(i.units);
  const ses = i.sessions.filter((s) => ids.has(s.unit) && (s.stage === "stage1" || s.stage === "repilot"));
  const scores = new Map<string, CsoScore>();
  for (const s of i.scores) {
    if (!ids.has(s.unit) || (s.stage !== "stage1" && s.stage !== "repilot")) continue;
    const k = s.unit + "\t" + s.arm + "\t" + s.model;
    if (scores.has(k)) csoFail("E_CSO_ANALYSIS_INPUT", "two stage 1 scores for " + k.replace(/\t/g, " "));
    scores.set(k, s);
  }
  const cellKey = (m: CsoModel, a: CsoArm) => m + " " + a;
  const scoreOf = (u: string, a: CsoArm, m: CsoModel) => {
    const s = scores.get(u + "\t" + a + "\t" + m);
    return s && s.gap === null ? s : null;
  };
  const noneNamed = Object.fromEntries((["opus", "particle"] as const).map((m) => {
    const v = i.units.map((u) => scoreOf(u, "none", m));
    return [m, { named: v.filter((s) => s?.named).length, scored: v.filter((s) => s).length, gaps: v.filter((s) => !s).length }];
  })) as Record<"opus" | "particle", { named: number; scored: number; gaps: number }>;
  const counts: Record<string, { units: number; gaps: number; limits: number; safety_stops: number }> = {};
  const costs: Record<string, ArmCost> = {};
  for (const [m, a] of STAGE1_CELLS) {
    const cs = ses.filter((s) => s.model === m && s.arm === a);
    counts[cellKey(m, a)] = { units: i.units.length, gaps: i.units.filter((u) => !scoreOf(u, a, m)).length, limits: cs.filter((s) => s.end.startsWith("limit_")).length, safety_stops: cs.filter((s) => s.end === "safety_stop").length };
    const c = cs.map((s) => s.cost_usd);
    costs[cellKey(m, a)] = { n: c.length, mean: mean(c), median: percentile(c, 50), p95: percentile(c, 95) };
  }
  const procedure = Object.fromEntries((["opus", "particle"] as const).map((m) => {
    const cs = ses.filter((s) => s.model === m && s.arm === "cso" && s.end !== "gap");
    return [m, { ran: cs.filter((s) => s.exposure.procedure_ran).length, of: cs.length }];
  })) as Record<"opus" | "particle", { ran: number; of: number }>;
  const untold = ses.filter((s) => s.model === "opus" && s.arm === "untold" && s.end !== "gap");
  const untoldRate = { loaded: untold.filter((s) => s.exposure.loaded || s.exposure.run_id !== null).length, of: untold.length };
  const judge: JudgeRelease[] = judgeRelease(i.checks);
  const items: Release["items"] = [
    { item: RELEASE_ITEMS[0], value: noneNamed },
    { item: RELEASE_ITEMS[1], value: counts },
    { item: RELEASE_ITEMS[2], value: costs },
    { item: RELEASE_ITEMS[3], value: procedure },
    { item: RELEASE_ITEMS[4], value: untoldRate },
    { item: RELEASE_ITEMS[5], value: judge },
  ];

  const limits = (p as { limits?: { allowance_usd?: Record<string, number> } }).limits?.allowance_usd ?? csoFail("E_CSO_ANALYSIS_INPUT", "prereg.json limits.allowance_usd is missing");
  const allowance_doubled = Object.fromEntries((["opus", "particle"] as const).map((m) => [m, STAGE1_CELLS.some(([cm, a]) => cm === m && (costs[cellKey(cm, a)]!.p95 ?? 0) > limits[allowanceKey(m)]! / 2)]));
  const repricing = reprice(costs, i, p);

  const texts = readingTexts(p);
  const readings: Release["readings"] = [];
  const add = (reading: ReadingName, where: string, response: string) => readings.push({ reading, where, response });
  const of = i.units.length, n = noneNamed.opus.named;
  if (n <= texts.floor_max) add("FLOOR", "opus none " + n + " of " + of, texts.floor_raise);
  if (n >= texts.ceiling_min) add("CEILING", "opus none " + n + " of " + of, texts.ceiling_raise);
  if (n >= MOST.min && n <= MOST.max) add("MOST", "opus none " + n + " of " + of, "Plain Opus already names most advisories; stage 2 goes ahead unless the Captain stops it for headroom.");
  if (procedure.opus.ran < EXPOSURE_MIN_OF_12) add("EXPOSURE", "opus cso " + procedure.opus.ran + " of " + procedure.opus.of, "A harness cause gets a named repair and a re-pilot of the cso cells; a skill cause goes to the Captain before stage 2.");
  for (const [k, c] of Object.entries(counts)) if (c.units && c.gaps / c.units > INFRA_GAP_SHARE) add("INFRA", k, "Named harness repairs, then a re-pilot of that cell.");
  add("COST", "program", repricing.to_captain ? "n2 would fall below 48: the Captain chooses a raised line, a smaller n2 with the MDDs restated, or stopping." : "n2 is " + repricing.n2 + (repricing.interim_look ? "; stage 2 is planned above $500 paid, so it takes R113's one interim look with deviation CV5's bounds." : "; no interim look."));
  if (!judge.some((r) => r.named_route === "pass")) add("JUDGE", "every route", "No judge route passes section 7's check: stage 2 doesn't start and the Captain decides.");

  const outcomes = [...scores.values()].map((s) => ({ unit: s.unit, arm: s.arm, model: s.model, gap: s.gap, named: s.named, named_final: s.named_final, file_level: s.file_level, findings_total: s.findings_total, counted: s.counted, hits: s.hits, known_real: s.known_real, supported: s.supported, unsupported: s.unsupported, cant_tell: s.cant_tell, phantoms: s.phantoms.paths + s.phantoms.lines }));
  outcomes.sort((a, b) => (a.unit + a.arm + a.model < b.unit + b.arm + b.model ? -1 : 1));
  return {
    release: { schema: "cso-stage1-release.v1", items, readings, repricing, allowance_doubled },
    sealed: { schema: "cso-stage1-outcomes.v1", outcomes, judge_detail: i.checks.map((c) => ({ route: c.route, detail: c.detail })) },
  };
}

function readingTexts(p: CsoPrereg) {
  const h = (p as { headroom?: { floor_max: number; ceiling_min: number; floor_raise: string; ceiling_raise: string } }).headroom;
  if (!h || !Number.isInteger(h.floor_max) || !Number.isInteger(h.ceiling_min) || !h.floor_raise || !h.ceiling_raise) return csoFail("E_CSO_ANALYSIS_INPUT", "prereg.json headroom is incomplete");
  return h;
}

/** Section 12's COST rule: n2 is the largest multiple of 4 from 48 to 100 whose re-priced program (stage 0 and 1 at actual
 *  spend, stage 2 sessions and judging at stage 1's measured central costs, the VM) is at most program_target_central_usd.
 *  Stage 2 planned above $500 paid takes the interim look. */
export function reprice(costs: Record<string, ArmCost>, i: Pick<ReadoutInput, "spent_usd" | "judging_per_session_usd" | "vm_usd" | "vm_stage2_usd">, p: CsoPrereg): Repricing {
  const target = (p as { program_target_central_usd?: number }).program_target_central_usd ?? csoFail("E_CSO_ANALYSIS_INPUT", "prereg.json program_target_central_usd is missing");
  const per = STAGE2_CELLS.map(([m, a]) => costs[m + " " + a]?.mean ?? csoFail("E_CSO_ANALYSIS_INPUT", m + " " + a + " has no stage 1 cost"));
  const per_unit_usd = per.reduce((s, c) => s + c + i.judging_per_session_usd, 0);
  let n2: number | null = null;
  for (let n = N2.max; n >= N2.min; n -= N2.step) if (i.spent_usd + n * per_unit_usd + i.vm_usd <= target + 1e-9) {
    n2 = n;
    break;
  }
  const stage2 = n2 === null ? null : n2 * per_unit_usd + i.vm_stage2_usd;
  return { per_unit_usd, n2, program_usd: n2 === null ? null : i.spent_usd + n2 * per_unit_usd + i.vm_usd, stage2_paid_usd: stage2, to_captain: n2 === null, interim_look: stage2 !== null && interimApplies(stage2) };
}

/** The readout key: a file outside any git work tree, mode 0600, holding 32 raw bytes or 64 hex characters. */
export function readKey(path: string): Buffer {
  if (!existsSync(path)) csoFail("E_CSO_READOUT_KEY", path + " does not exist");
  const real = realpathSync(path), repo = realpathSync(REPO);
  if (real === repo || real.startsWith(repo + "/")) csoFail("E_CSO_READOUT_KEY", "the key is inside this repository");
  for (let dir = dirname(real); ; dir = dirname(dir)) {
    if (existsSync(join(dir, ".git"))) csoFail("E_CSO_READOUT_KEY", "the key is inside the git work tree at " + dir);
    if (dirname(dir) === dir) break;
  }
  if ((statSync(real).mode & 0o077) !== 0) csoFail("E_CSO_READOUT_KEY", "the key file must be mode 0600 (no group or other access)");
  const raw = readFileSync(real);
  if (raw.length === 32) return raw;
  const text = raw.toString("utf8").trim();
  if (/^[0-9a-fA-F]{64}$/.test(text)) return Buffer.from(text, "hex");
  return csoFail("E_CSO_READOUT_KEY", "the key file must hold 32 raw bytes or 64 hex characters");
}

/** Encrypts the sealed outcomes to a new file (mode 0600) and returns the file's sha256. */
export function seal(sealed: Sealed, key: Buffer, out: string): string {
  if (existsSync(out)) csoFail("E_CSO_READOUT_OUT", out + " already exists; a sealed file is never overwritten");
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(Buffer.from(SEALED));
  const ciphertext = Buffer.concat([c.update(JSON.stringify(sealed), "utf8"), c.final()]);
  const text = JSON.stringify({ schema: SEALED, alg: "aes-256-gcm", iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") }) + "\n";
  try {
    writeFileSync(out, text, { flag: "wx", mode: 0o600 });
  } catch (e) {
    csoFail("E_CSO_READOUT_OUT", out + " cannot be written: " + (e as Error).message);
  }
  return createHash("sha256").update(text).digest("hex");
}

/** Opens a sealed file after stage 2's analysis, checking its sha256 against the run record first. */
export function unseal(file: string, key: Buffer, sha256: string): Sealed {
  const text = readFileSync(file, "utf8");
  if (createHash("sha256").update(text).digest("hex") !== sha256) csoFail("E_CSO_READOUT_OUT", file + " does not match the recorded sha256");
  const env = JSON.parse(text) as { schema: string; iv: string; tag: string; ciphertext: string };
  if (env.schema !== SEALED) csoFail("E_CSO_READOUT_OUT", file + " is not a " + SEALED + " file");
  const dc = createDecipheriv("aes-256-gcm", key, Buffer.from(env.iv, "base64"));
  dc.setAAD(Buffer.from(SEALED));
  dc.setAuthTag(Buffer.from(env.tag, "base64"));
  try {
    return JSON.parse(Buffer.concat([dc.update(Buffer.from(env.ciphertext, "base64")), dc.final()]).toString("utf8")) as Sealed;
  } catch (e) {
    return csoFail("E_CSO_READOUT_KEY", file + " does not open with this key: " + (e as Error).message);
  }
}
