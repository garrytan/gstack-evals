// Copyright (c) 2026 Garry Tan. MIT License.
// The readings writer: driver records, the packet key and judge records into the readings file rule.ts reads.
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { heldOutputs } from "./custody.ts";
import { fail } from "./errors.ts";
import { parseFlags, readNdjson, readPacketKey, sha256 } from "./judge.ts";
import { readKeys, readRecords } from "./packet.ts";
import { boundary, CUT, words } from "./rule.ts";
import { type Arm, type ControlRow, type Family, type FactLabel, type Io, JUDGE_OF, type JudgeAnswer, type JudgeRecord, type Key, type Model, type PacketKeyEntry, type ReadingRecord, type ReadingRow, type ReadingsFile, type ReadingStatus, type SplitManifest } from "./types.ts";

const MARK = "^[ \\t>#*_+-]*(?:\\d+[.)][ \\t]*)?[*_]*";
const STATUS = new RegExp(MARK + "(?:(?:STATUS|[Ss]tatus)[*_]*:[*_ \\t]*)?(?:DONE_WITH_CONCERNS|DONE|BLOCKED|NEEDS_CONTEXT)(?![A-Za-z0-9_])", "m");
const DEBUG = new RegExp(MARK + "DEBUG REPORT(?![A-Za-z0-9_])", "m");
const UNVERIFIED = new RegExp(MARK + "Unverified", "m");

/** The procedure gate (section 5): current in the skill layer, current in capy, or principle by the pin post's detector. */
export function exposed(text: string, arm: Arm, family: Family, principle: RegExp[] | null): boolean | null {
  if (arm === "none" || arm === "lens") return null;
  if (arm === "principle") {
    if (!principle) return fail("E_TBV_INPUT", "a principle reading needs the detector the principle pin post freezes (--principle-detector)");
    return principle.some((r) => ((r.lastIndex = 0), r.test(text)));
  }
  return family === "capy" ? UNVERIFIED.test(text) : STATUS.test(text) || DEBUG.test(text);
}

/** The share of names that appear in the text, case-insensitive. */
export function listShare(text: string, names: string[]): number {
  const t = text.toLowerCase();
  return names.length ? names.filter((n) => t.includes(n.toLowerCase())).length / names.length : 0;
}

export interface PlanFlags {
  models: Model[];
  passes: Partial<Record<Model, number>>;
  capyPasses?: number;
  skillArms: Arm[];
  devGap?: { opusPrincipleMinusNone: number; devMdd: number };
}
const labels = (a: JudgeAnswer | null): FactLabel[] => (a ? a.facts.map((f) => ({ in: f.in, any: f.any })) : []);

/** Joins records, the packet key and judge records into the readings file. */
export function buildReadings(o: { manifest: SplitManifest; manifestSha256: string; records: ReadingRecord[]; entries: PacketKeyEntry[]; judges: JudgeRecord[]; keys: Record<string, Key>; flags: PlanFlags; principle: RegExp[] | null }): ReadingsFile {
  const tasks = new Map(o.manifest.tasks.map((t) => [t.id, t]));
  const judged = new Map(o.judges.map((j) => [j.packet + ":" + j.role, j]));
  const firstOf = new Map(o.entries.filter((e) => e.kind === "first").map((e) => [e.label, e]));
  const d2Of = new Map(o.entries.filter((e) => e.kind === "d2").map((e) => [e.label, e]));
  const readings = o.records.map((r): ReadingRow => {
    const t = tasks.get(r.task) ?? fail("E_TBV_INPUT", "reading " + r.label + " names a task the split manifest does not hold");
    const key = o.keys[r.task] ?? fail("E_TBV_INPUT", "no key for task " + r.task);
    if (key.facts.length !== t.nfacts) fail("E_TBV_INPUT", "the key for task " + r.task + " has " + key.facts.length + " facts and the split manifest says " + t.nfacts);
    const report = r.texts.report ?? "";
    let status: ReadingStatus = r.cls;
    let judge = JUDGE_OF[r.model];
    let answer: JudgeAnswer | null = null;
    let second: ReadingRow["second"];
    if (r.cls === "scored") {
      const e = firstOf.get(r.label) ?? fail("E_TBV_INPUT", "scored reading " + r.label + " has no first packet in the packet key");
      judge = e.primary;
      const p = judged.get(e.packet + ":primary") ?? fail("E_TBV_INPUT", "first packet " + e.packet + " has no primary judge record");
      if (p.status === "judged" && p.answer) answer = p.answer;
      else status = "unjudged";
      const s = e.second ? judged.get(e.packet + ":second") : undefined;
      if (s) second = { judge: s.judge, status: s.status, facts: s.status === "judged" ? labels(s.answer) : [], responseIds: s.responseIds };
    }
    const names = (key.list ?? []).map((i) => i.name);
    const row: ReadingRow = {
      id: r.label,
      task: r.task,
      family: r.family,
      arm: r.arm,
      model: r.model,
      pass: r.pass,
      status,
      judge,
      facts: labels(answer),
      unsupported: answer ? answer.unsupported.length : 0,
      exposed: exposed(report, r.arm, r.family, o.principle),
      words: words(report),
      usd: r.usd,
      ...(r.cacheRead !== null ? { cacheRead: r.cacheRead } : {}),
      responseIds: r.responseIds,
      maxTokens: r.maxTokens,
    };
    if (t.stratum === "long" && answer?.list) row.list = answer.list;
    if (t.stratum === "short" && names.length) row.shortShare = listShare(report.slice(0, boundary(report, CUT)), names);
    if (names.length) row.d1 = r.texts.d1 === null ? null : listShare(r.texts.d1, names);
    if (second) row.second = second;
    if (answer?.d1) row.d1States = answer.d1;
    if (answer) row.traps = answer.traps;
    const d2 = d2Of.get(r.label);
    if (d2) {
      const j = judged.get(d2.packet + ":primary");
      row.d2 = j?.status === "judged" && j.answer ? { status: "judged", unsupported: j.answer.unsupported } : { status: "unjudged", unsupported: [] };
    }
    return row;
  });
  const controls: ControlRow[] = [];
  for (const e of o.entries) {
    if (e.kind !== "control") continue;
    for (const role of ["primary", "second"] as const) {
      const rec = (role === "primary" || e.second) && judged.get(e.packet + ":" + role);
      if (rec) controls.push({ task: e.task, kind: e.label.startsWith("stock:") ? "stock" : "oracle", judge: rec.judge, status: rec.status, facts: rec.status === "judged" ? labels(rec.answer) : [], responseIds: rec.responseIds });
    }
  }
  const f = o.flags;
  return {
    stage: o.manifest.stage,
    tasks: o.manifest.tasks,
    readings,
    controls,
    plan: {
      models: f.models,
      passes: f.passes,
      ...(f.capyPasses !== undefined ? { capyPasses: f.capyPasses } : {}),
      skillArms: f.skillArms,
      taskIds: o.manifest.tasks.map((t) => t.id),
      controlTaskIds: o.manifest.controlTaskIds,
      manifestSha256: o.manifestSha256,
      ...(f.devGap ? { devGap: f.devGap } : {}),
    },
  };
}

const MODELS: Model[] = ["opus", "sol", "particle"];
const ARMS: Arm[] = ["none", "current", "principle", "lens"];
const oneOf = <T extends string>(v: string, all: T[], what: string): T => (all.includes(v as T) ? (v as T) : fail("E_TBV_INPUT", what + " " + JSON.stringify(v) + " is not one of " + all.join(", ")));
const count = (v: string, what: string) => (/^[1-9]\d*$/.test(v) ? Number(v) : fail("E_TBV_INPUT", what + " must be a positive integer"));

/** Several packet keys and judge files, comma-separated, read as one (tbv-held and tbv-held-p3 judge their own batches). A
 * packet, a judge record or a reading's packet of one kind in two of them refuses, so no batch is joined twice. The
 * refusal prints counts only, since a label carries a held-out task id. */
export function joinBatches(keys: PacketKeyEntry[][], judges: JudgeRecord[][]): { entries: PacketKeyEntry[]; judges: JudgeRecord[] } {
  const once = (what: string, ids: string[][]) => {
    const seen = new Set<string>();
    let twice = 0;
    for (const batch of ids) {
      const mine = new Set(batch);
      for (const id of mine) if (seen.has(id)) twice++;
      for (const id of mine) seen.add(id);
    }
    if (twice) fail("E_TBV_INPUT", twice + " " + what + " in two of the files given; give each batch once");
  };
  once("packets are", keys.map((es) => es.map((e) => e.packet)));
  once("packets of one kind and label are", keys.map((es) => es.map((e) => e.kind + " " + e.label)));
  once("judge records of one packet and role are", judges.map((js) => js.map((j) => j.packet + " " + j.role)));
  return { entries: keys.flat(), judges: judges.flat() };
}

/** tbv readings --records PATH --keys DIR --split FILE --packet-key FILE[,FILE] --judges FILE[,FILE] --out FILE --models a,b --passes m=n,...
 * --skill-arms a,b [--capy-passes N] [--principle-detector FILE (one regex per line, # comments)] [--dev-gap GAP,MDD]
 * [--held SEALED_DIR --seal-cmd CMD] */
export async function run(argv: string[], io: Io): Promise<number> {
  const a = parseFlags(argv.slice(1), ["records", "keys", "split", "packet-key", "judges", "out", "models", "passes", "skill-arms"], ["capy-passes", "principle-detector", "dev-gap", "held", "seal-cmd"]);
  const seal = heldOutputs(a, ["out"], undefined, [basename(a.out!)]);
  const bytes = readFileSync(a.split!);
  let manifest: SplitManifest;
  try {
    manifest = JSON.parse(bytes.toString("utf8")) as SplitManifest;
  } catch {
    return fail("E_TBV_INPUT", a.split + " is not JSON");
  }
  if (manifest.schema !== "tbv-split.v1" || !Array.isArray(manifest.tasks) || !Array.isArray(manifest.controlTaskIds)) fail("E_TBV_INPUT", a.split + " is not a tbv-split.v1 manifest");
  const passes: Partial<Record<Model, number>> = {};
  for (const p of a.passes!.split(",")) {
    const [m, n] = p.split("=");
    passes[oneOf(m ?? "", MODELS, "--passes model")] = count(n ?? "", "--passes " + m);
  }
  const gap = a["dev-gap"]?.split(",").map(Number);
  if (gap && (gap.length !== 2 || !gap.every(Number.isFinite))) fail("E_TBV_INPUT", "--dev-gap takes GAP,MDD");
  const principle = a["principle-detector"]
    ? readFileSync(a["principle-detector"], "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#")).map((l) => {
        try {
          return new RegExp(l, "mu");
        } catch {
          return fail("E_TBV_INPUT", "the principle detector line " + JSON.stringify(l) + " is not a regex");
        }
      })
    : null;
  if (principle && !principle.length) fail("E_TBV_INPUT", "the principle detector holds no regex");
  const batches = joinBatches(a["packet-key"]!.split(",").map(readPacketKey), a.judges!.split(",").map((f) => readNdjson<JudgeRecord>(f)));
  const rd = buildReadings({
    manifest,
    manifestSha256: sha256(bytes),
    records: readRecords(a.records!),
    entries: batches.entries,
    judges: batches.judges,
    keys: readKeys(a.keys!),
    flags: {
      models: a.models!.split(",").map((m) => oneOf(m, MODELS, "--models")),
      passes,
      ...(a["capy-passes"] ? { capyPasses: count(a["capy-passes"], "--capy-passes") } : {}),
      skillArms: a["skill-arms"]!.split(",").map((m) => oneOf(m, ARMS, "--skill-arms")),
      ...(gap ? { devGap: { opusPrincipleMinusNone: gap[0]!, devMdd: gap[1]! } } : {}),
    },
    principle,
  });
  writeFileSync(a.out!, JSON.stringify(rd, null, 2) + "\n");
  seal?.(a.out!);
  io.out("readings: " + rd.readings.length + " rows, " + (rd.controls?.length ?? 0) + " control rows");
  return 0;
}
