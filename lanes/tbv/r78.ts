// Copyright (c) 2026 Garry Tan. MIT License.
// The R78 addendum (wiki/plans/2026-11-22-geva-401-tbv-r78-addendum.md). r78-key writes the Astra run's packet key:
// every packet the frozen routing sent to Sol, judged once by Astra. r78 prints the judge check, Astra's controls and the
// tasks that got worse under each reading, and writes the Astra readings file, which tbv compare reads with Astra standing
// in for Sol. Counted readings, judge records and scoring are untouched. It calls no model and needs no key.
import { basename } from "node:path";
import { heldOutputs, writePlain } from "./custody.ts";
import { fail } from "./errors.ts";
import { parseFlags, readNdjson, readPacketKey } from "./judge.ts";
import { buildReadings, joinBatches, readingsInput, type ReadingsInput } from "./readings.ts";
import { ORACLE_MIN, pairedRows, recall, SKILL, STOCK_MAX } from "./rule.ts";
import type { Arm, Family, Io, JudgeRecord, Model, PacketKeyEntry, ReadingsFile } from "./types.ts";

export const R78_SEED = 20261122, R78_DRAWS = 2000, KAPPA_MIN = 0.6;
/** tbv's preregistration was frozen on 2026-11-05. */
export const TBV_FROZEN = "2026-11-05";
/** R78's floor of labelled outputs: 40 for a preregistration frozen before 2026-11-22, 100 from that date on. */
export const r78Floor = (frozen: string) => (frozen < "2026-11-22" ? 40 : 100);

const f3 = (x: number) => (Number.isNaN(x) ? "n/a" : x.toFixed(3));
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const inShare = (r: JudgeRecord) => (r.answer!.facts.length ? r.answer!.facts.filter((f) => f.in).length / r.answer!.facts.length : 0);

/** The Astra run's packet key: every packet Sol read as primary or as the seeded second read, judged once by Astra. */
export function astraKey(entries: PacketKeyEntry[]): PacketKeyEntry[] {
  return entries.filter((e) => e.primary === "sol" || e.second === "sol").map((e) => ({ ...e, primary: "astra", second: null }));
}

/** A packet key lists each packet once and each output's first packet once, so no judged output counts twice. Checked
 * before anything is written. */
export function uniqueKey(entries: PacketKeyEntry[]): PacketKeyEntry[] {
  const packets = new Set<string>(), firsts = new Set<string>();
  for (const e of entries) {
    if (packets.has(e.packet)) fail("E_TBV_INPUT", "the packet key lists one packet twice; give each packet once");
    packets.add(e.packet);
    if (e.kind !== "first") continue;
    if (firsts.has(e.label)) fail("E_TBV_INPUT", "the packet key lists one output's first packet twice; give each output once");
    firsts.add(e.label);
  }
  return entries;
}

/** Astra's records by packet: one primary record per packet, refused if a record is not Astra's or a packet repeats. */
export function astraRecords(records: JudgeRecord[]): Map<string, JudgeRecord> {
  const m = new Map<string, JudgeRecord>();
  for (const r of records) {
    if (r.judge !== "astra" || r.role !== "primary") fail("E_TBV_INPUT", "an Astra judge file holds a " + r.judge + " " + r.role + " record; give the Astra run's judges.ndjson files only");
    if (m.has(r.packet)) fail("E_TBV_INPUT", "an Astra record repeats a packet; give each Astra batch once");
    m.set(r.packet, r);
  }
  return m;
}

type Tally = { tp: number; fn: number; tn: number; fp: number };
const add = (x: Tally, y: Tally): Tally => ({ tp: x.tp + y.tp, fn: x.fn + y.fn, tn: x.tn + y.tn, fp: x.fp + y.fp });
/** Cohen's kappa of a judge against labels: tp and fn are labelled-covered facts the judge marks covered and missed, tn and fp labelled-missed facts it marks missed and covered. */
export function kappaOf(t: Tally): number {
  const n = t.tp + t.fn + t.tn + t.fp;
  if (!n) return NaN;
  const po = (t.tp + t.tn) / n;
  const pe = ((t.tp + t.fp) / n) * ((t.tp + t.fn) / n) + ((t.tn + t.fn) / n) * ((t.tn + t.fp) / n);
  return pe < 1 ? (po - pe) / (1 - pe) : NaN;
}
/** mulberry32: the bootstrap's seeded draws. */
function draws(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** A 95% percentile interval for kappa, resampling tasks with replacement R78_DRAWS times from R78_SEED. */
export function kappaInterval(byTask: Tally[]): [number, number] | null {
  if (!byTask.length) return null;
  const rnd = draws(R78_SEED);
  const ks: number[] = [];
  for (let d = 0; d < R78_DRAWS; d++) {
    let t: Tally = { tp: 0, fn: 0, tn: 0, fp: 0 };
    for (let i = 0; i < byTask.length; i++) t = add(t, byTask[Math.floor(rnd() * byTask.length)]!);
    const k = kappaOf(t);
    if (!Number.isNaN(k)) ks.push(k);
  }
  if (!ks.length) return null;
  ks.sort((a, b) => a - b);
  const q = (p: number) => ks[Math.min(ks.length - 1, Math.max(0, Math.round(p * (ks.length - 1))))]!;
  return [q(0.025), q(0.975)];
}

/** The judge check for one frozen judge (addendum section 2): the first packets it read as primary with the other frozen
 * judge as the seeded second read. A fact is labelled where Astra and that second judge agree on in; the checked judge,
 * which made no label, is compared with it. A packet with a missing or unjudged read leaves the check and is counted.
 * The check passes only with R78's floor of labelled outputs and kappa at or over KAPPA_MIN. */
export function judgeCheck(judge: "sol" | "opus", entries: PacketKeyEntry[], frozen: Map<string, JudgeRecord>, astra: Map<string, JudgeRecord>) {
  const partner = judge === "sol" ? "opus" : "sol";
  const byTask = new Map<string, Tally>();
  let packets = 0, outputs = 0, excluded = 0, labelled = 0, unlabelled = 0;
  for (const e of uniqueKey(entries)) {
    if (e.kind !== "first" || e.primary !== judge || e.second !== partner) continue;
    const c = frozen.get(e.packet + ":primary"), p = frozen.get(e.packet + ":second"), a = astra.get(e.packet);
    if (c?.status !== "judged" || p?.status !== "judged" || a?.status !== "judged" || !c.answer || !p.answer || !a.answer) { excluded++; continue; }
    if (c.judge !== judge || p.judge !== partner) fail("E_TBV_INPUT", "a judge record does not match its packet key entry's judges");
    const n = c.answer.facts.length;
    if (p.answer.facts.length !== n || a.answer.facts.length !== n) fail("E_TBV_INPUT", "three reads of one packet carry different fact counts");
    packets++;
    const t = byTask.get(e.task) ?? { tp: 0, fn: 0, tn: 0, fp: 0 };
    let mine = 0;
    c.answer.facts.forEach((f, i) => {
      const label = a.answer!.facts[i]!.in;
      if (label !== p.answer!.facts[i]!.in) { unlabelled++; return; }
      labelled++;
      mine++;
      if (label) { if (f.in) t.tp++; else t.fn++; } else if (f.in) t.fp++; else t.tn++;
    });
    if (mine) outputs++;
    byTask.set(e.task, t);
  }
  const tasks = [...byTask.values()];
  const all = tasks.reduce(add, { tp: 0, fn: 0, tn: 0, fp: 0 });
  const kappa = kappaOf(all);
  const ci = kappaInterval(tasks);
  const floor = r78Floor(TBV_FROZEN);
  const pass = outputs >= floor && kappa >= KAPPA_MIN;
  const line = "judge check " + judge + ": " + packets + " first packets read by " + judge + " and " + partner + " (left out " + excluded + " with a missing or unjudged read); labels where astra and " + partner + " agree: " + labelled + " facts in " + outputs + " outputs (" + unlabelled + " facts unlabelled); catch rate " + f3(all.tn / (all.tn + all.fp)) + " (" + all.tn + "/" + (all.tn + all.fp) + "), false-fail rate " + f3(all.fn / (all.tp + all.fn)) + " (" + all.fn + "/" + (all.tp + all.fn) + "), kappa " + f3(kappa) + ", 95% CI " + (ci ? "[" + f3(ci[0]) + ", " + f3(ci[1]) + "]" : "n/a") + " (" + R78_DRAWS + " resamples over " + tasks.length + " tasks); R78 gate " + KAPPA_MIN + ": " + (pass ? "passes the R78 judge check" : "failed the R78 judge check") + (outputs < floor ? " (" + outputs + " labelled outputs, under R78's floor of " + floor + ")" : "");
  return { packets, outputs, excluded, labelled, unlabelled, kappa, ci, floor, pass, line };
}

/** Astra's controls against the frozen bounds: every planned control task's stock and oracle packets, read by Astra. */
export function astraControls(entries: PacketKeyEntry[], astra: Map<string, JudgeRecord>, planned: string[]) {
  const cs = entries.filter((e) => e.kind === "control" && planned.includes(e.task));
  const rec = (kind: string) => cs.filter((e) => e.label.startsWith(kind + ":")).map((e) => astra.get(e.packet));
  const absent = planned.flatMap((t) => ["stock", "oracle"].filter((kind) => !cs.some((e) => e.task === t && e.label.startsWith(kind + ":") && astra.has(e.packet)))).length;
  const unjudged = cs.filter((e) => astra.get(e.packet)?.status === "unjudged").length;
  const rate = (kind: string) => mean(rec(kind).filter((r): r is JudgeRecord => r?.status === "judged" && !!r.answer).map(inShare));
  const s = rate("stock"), o = rate("oracle");
  const ok = !absent && planned.length > 0 && s <= STOCK_MAX && o >= ORACLE_MIN;
  return { ok, line: "controls (astra): stock " + f3(s) + " (max " + STOCK_MAX + "), oracle " + f3(o) + " (min " + ORACLE_MIN + "); planned on " + planned.length + " tasks, never attempted " + absent + ", unjudged " + unjudged + "; " + (ok ? "within bounds" : "out of bounds or incomplete") };
}

/** The Astra reading's readings file (addendum section 3): Astra's record in place of Sol's primary record on every packet
 * Sol read first, so each reading Sol judged takes Astra's labels and names Astra as its judge. Second reads, Opus's reads
 * and controls stay as judged. A Sol packet with no Astra record refuses: the Astra run must be complete. */
export function astraReadings(input: ReadingsInput, astra: Map<string, JudgeRecord>): ReadingsFile {
  const sol = input.judges.filter((j) => j.judge === "sol" && j.role === "primary");
  const missing = sol.filter((j) => !astra.has(j.packet)).length;
  if (missing) fail("E_TBV_INPUT", missing + " packets Sol read have no Astra record; the Astra run is incomplete");
  const judges = input.judges.map((j) => (j.judge === "sol" && j.role === "primary" ? astra.get(j.packet)! : j));
  const rd = buildReadings({ ...input, judges });
  return { ...rd, readings: rd.readings.map((r) => (r.judge === "sol" ? { ...r, judge: "astra" as const } : r)), plan: { ...rd.plan, standIn: { for: "sol", by: "astra" } } };
}

/** For each contrast compare prints, the tasks whose mean recall over the matched passes went down, went up or stayed. */
export function tasksWorse(rd: ReadingsFile): string[] {
  const lines: string[] = [];
  const blocks: [string, Model[], Family[]][] = [["skill layer", rd.plan.models, SKILL], ["capy", ["opus"], ["capy"]]];
  const arms: [Arm, Arm][] = [["principle", "none"], ["principle", "current"], ["current", "none"]];
  for (const [name, models, fams] of blocks)
    for (const m of models) {
      if (name === "capy" && !rd.readings.some((r) => r.family === "capy")) continue;
      for (const [b, a] of arms) {
        const { ra, rb } = pairedRows(rd, m, fams, b, a);
        const byTask = new Map<string, { a: number[]; b: number[] }>();
        ra.forEach((x, i) => { const t = byTask.get(x.task) ?? { a: [], b: [] }; t.a.push(recall(x)); t.b.push(recall(rb[i]!)); byTask.set(x.task, t); });
        let worse = 0, better = 0, same = 0;
        for (const t of byTask.values()) { const d = mean(t.b) - mean(t.a); if (d < -1e-9) worse++; else if (d > 1e-9) better++; else same++; }
        lines.push(name + " " + m + " " + b + " - " + a + ": tasks worse " + worse + ", better " + better + ", same " + same + " of " + byTask.size);
      }
    }
  return lines;
}

const READINGS_FLAGS = ["records", "keys", "split", "packet-key", "judges", "out", "models", "passes", "skill-arms"];
const READINGS_OPTIONAL = ["capy-passes", "principle-detector", "dev-gap", "held", "seal-cmd"];

/** Both R78 commands read held-out material only, so each needs --held and --seal-cmd before it reads anything. */
function needsHeld(cmd: string, a: Record<string, string>) {
  if (a.held === undefined || a["seal-cmd"] === undefined) fail("E_USAGE", "tbv " + cmd + " reads held-out material and seals what it writes: pass --held <sealed dir> and --seal-cmd <cmd>");
}

/** tbv r78-key --key FILE --out FILE --held SEALED_DIR --seal-cmd CMD
 * tbv r78 --astra FILE[,FILE] and tbv readings's flags, with --held and --seal-cmd (--out is the Astra readings file) */
export async function run(argv: string[], io: Io): Promise<number> {
  if (argv[0] === "r78-key") {
    const a = parseFlags(argv.slice(1), ["key", "out"], ["held", "seal-cmd"]);
    needsHeld("r78-key", a);
    const seal = heldOutputs(a, ["out"], undefined, [basename(a.out!)]);
    const entries = uniqueKey(readPacketKey(a.key!));
    const out = astraKey(entries);
    writePlain(a.out!, JSON.stringify({ schema: "tbv-packet-key.v1", entries: out }, null, 2) + "\n");
    seal?.(a.out!);
    const n = (k: string) => out.filter((e) => e.kind === k).length;
    io.out("r78-key: " + out.length + " of " + entries.length + " packets for Astra (first " + n("first") + ", d2 " + n("d2") + ", control " + n("control") + ")");
    return 0;
  }
  const a = parseFlags(argv.slice(1), [...READINGS_FLAGS, "astra"], READINGS_OPTIONAL);
  needsHeld("r78", a);
  const seal = heldOutputs(a, ["out"], undefined, [basename(a.out!)]);
  const input = readingsInput(a);
  uniqueKey(input.entries);
  const astra = astraRecords(joinBatches([], a.astra!.split(",").map((f) => readNdjson<JudgeRecord>(f))).judges);
  const labels = new Set(input.records.map((r) => r.label));
  const planned = input.manifest.controlTaskIds;
  const line = input.entries.filter((e) => (e.kind === "control" ? planned.includes(e.task) : labels.has(e.label)));
  const frozen = new Map(input.judges.map((j) => [j.packet + ":" + j.role, j]));
  const astraRd = astraReadings(input, astra);
  writePlain(a.out!, JSON.stringify(astraRd, null, 2) + "\n");
  seal?.(a.out!);
  const mine = astraKey(line);
  const lines = [
    "r78: astra records for " + mine.filter((e) => astra.has(e.packet)).length + " of the " + mine.length + " packets sol read in this line (unjudged " + mine.filter((e) => astra.get(e.packet)?.status === "unjudged").length + "); astra readings " + astraRd.readings.filter((r) => r.judge === "astra").length + " of " + astraRd.readings.length,
    judgeCheck("sol", line, frozen, astra).line,
    judgeCheck("opus", line, frozen, astra).line,
    astraControls(line, astra, planned).line,
    ...tasksWorse(buildReadings(input)).map((l) => "sol reading: " + l),
    ...tasksWorse(astraRd).map((l) => "astra reading: " + l),
  ];
  io.out(lines.join("\n"));
  return 0;
}
