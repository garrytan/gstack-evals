// Copyright (c) 2026 Garry Tan. MIT License.
// noloss judge-packet and judge-join (plan section 7): blinded judging of arms that have findings. A packet per unit
// pools every arm's findings from every pass in a seeded shuffle under opaque ids, keeping only path, line and text with
// severity words masked; the key that maps ids back to arms is written outside the packet directory. The batch digest
// binds the suite, each arm's tree digest, the seed and the key's mapping, and every reply must name that batch and each
// packet's digest. judge-join applies severity mechanically (the highest mapped severity among a blocker's matches
// wins), requires the second judge on every blocker where the arms disagree plus a seeded 20% sample, and a third read
// wherever the two judges match different findings, before it writes judgments.tsv (saw_label no) for every arm at once. No model is
// called here; the judges are paid work under their own preregistration.
// judge-packet --adjudicate builds the same blinded packets from the blocking findings judgments.tsv leaves unmatched,
// with each unit's known informational case, and judge-join on its key writes adjudication.tsv: one ruling per finding
// per pass (defect, not-defect or known-informational), with a second judge on every finding that counts as a false
// blocker plus a seeded 20% sample of the rest, and a third read wherever the two judges differ.
// judge-run (judge-run.ts) sends the packets to the judges and computes the same sets with judgeSets; judge-join
// --unjudged takes its record of packets a judge's reply was refused twice for: those blockers are written with coverage
// incomplete, those findings get no adjudication row, and both leave the second and third sets.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { seededRandom } from "../../src/runner/stats/paired.ts";
import { ADJUDICATION_COLUMNS, ADJUDICATION_VERSION, JUDGMENT_COLUMNS, mapSeverity, matchedBlockers, parseArm, RULINGS, type Arm, type Finding, type Mapped, type Outcome, type Ruling } from "./contract.ts";
import { ScoreError } from "./score.ts";
import { insideRepo, sha256, suiteCases, unitRef, type Suite, type Unit } from "./suite.ts";

export const JUDGE_VERSION = 1;
export const SECOND_SAMPLE = 0.2;
const SEVERITY_WORDS = ["CRITICAL", "INFORMATIONAL", "HIGH", "MEDIUM", "LOW", "BLOCKER", "BLOCKING", "FIXABLE", "INVESTIGATE", "NIT", "MAJOR", "MINOR", "SEVERE", "P0", "P1", "P2", "P3"];

const blind = (message: string): never => {
  throw new ScoreError("E_NOLOSS_BLIND", message);
};

export interface LoadedArm {
  arm: Arm;
  files: Map<string, Buffer>;
  treeSha256: string;
}

export interface KeyEntry {
  packet: string;
  opaque: string;
  arm: string;
  pass: number;
  finding: string;
}

export interface JudgeKey {
  version: number;
  /** Present on an adjudication batch. */
  kind?: "adjudicate";
  batch: string;
  suite: { id: string; sha256: string };
  arms: Array<{ id: string; tree_sha256: string }>;
  seed: number;
  mapping_sha256: string;
  packets: Array<{ file: string; unit: string; sha256: string }>;
  entries: KeyEntry[];
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wholeWord = (s: string, flags = "i") => new RegExp("(?<![A-Za-z0-9_])" + escape(s) + "(?![A-Za-z0-9_])", flags);
const fileName = (suite: Suite, u: Unit) => "packets/" + unitRef(suite, u).replace(/\//g, "__") + ".json";
const batchDigest = (k: Pick<JudgeKey, "kind" | "suite" | "arms" | "seed" | "mapping_sha256" | "packets">) => sha256(JSON.stringify({ version: JUDGE_VERSION, ...(k.kind ? { kind: k.kind } : {}), suite: k.suite, arms: k.arms, seed: k.seed, mapping_sha256: k.mapping_sha256, packets: k.packets.map((p) => [p.file, p.unit, p.sha256]) }));
const inside = (child: string, dir: string) => resolve(child) === resolve(dir) || resolve(child).startsWith(resolve(dir) + sep);

/** Texts a packet must never carry: arm ids and labels (3 or more characters), "arm <id>", model ids, and reader names with a hyphen or digit. */
export function leakRules(arms: LoadedArm[]): Array<{ rule: string; re: RegExp }> {
  const rules = new Map<string, { rule: string; re: RegExp }>();
  const add = (rule: string, re: RegExp) => rules.set(re.source, { rule, re });
  for (const { arm } of arms) {
    for (const s of [arm.arm.id, arm.arm.label]) if (s.length >= 3) add("an arm id or label", wholeWord(s));
    add("arm <id>", new RegExp("(?<![A-Za-z0-9_])arm\\s+" + escape(arm.arm.id) + "(?![A-Za-z0-9_-])", "i"));
    for (const m of arm.arm.models ?? []) for (const s of new Set([m.model, m.model.split("/").pop()!])) add("a model id", new RegExp(escape(s), "i"));
    for (const list of arm.findings?.values() ?? []) for (const f of list) if (f.reader && /[-0-9]/.test(f.reader)) add("a reader name", wholeWord(f.reader));
  }
  return [...rules.values()];
}

/** Severity words, the standard ones and every raw label the arms use, masked as whole words. */
export function masker(arms: LoadedArm[]): (text: string) => string {
  const words = new Set(SEVERITY_WORDS);
  for (const { arm } of arms) {
    const maps = [arm.arm.severity_map?.default ?? {}, ...Object.values(arm.arm.severity_map?.by_reader ?? {})];
    for (const m of maps) for (const k of Object.keys(m)) words.add(k);
    for (const list of arm.findings?.values() ?? []) for (const f of list) if (f.raw) words.add(f.raw);
  }
  const res = [...words].filter(Boolean).sort((a, b) => b.length - a.length).map((w) => wholeWord(w, "gi"));
  return (text) => res.reduce((t, re) => t.replace(re, "[severity]"), text);
}

function shuffle<T>(items: T[], rng: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/**
 * Writes one packet per unit and batch.json under out, and the key file at key, which must sit outside out. With
 * adjudicate, a packet holds only the blocking findings judgments.tsv leaves unmatched, and units with none get no packet.
 */
export function judgePacket(o: { suite: Suite; suiteSha256: string; arms: LoadedArm[]; seed: number; out: string; key: string; adjudicate?: boolean }): { batch: string; packets: number; findings: number } {
  const { suite, arms } = o;
  const adjudicate = o.adjudicate === true;
  if (suite.sealed && (insideRepo(o.out) || insideRepo(o.key))) blind("suite " + suite.id + " is sealed, so its packets and key must be written outside the repo");
  if (inside(o.key, o.out)) blind("--key " + o.key + " is inside --out " + o.out + "; the key maps opaque ids back to arms and must never travel with the packets");
  if (existsSync(o.key)) blind("--key " + o.key + " already exists; give each batch a new key path");
  if (existsSync(o.out) && readdirSync(o.out).length) blind("--out " + o.out + " is not empty; write each batch to a new directory");
  if (!arms.length) blind("judge-packet needs at least one arm");
  const ids = arms.map((a) => a.arm.arm.id);
  if (new Set(ids).size !== ids.length) blind("an arm is given twice: " + ids.join(", "));
  for (const a of arms) if (!a.arm.findings) blind("arm " + a.arm.arm.id + " is transcribed: it has no findings to judge");
  if (adjudicate) for (const a of arms) if (!a.arm.judgments) blind("arm " + a.arm.arm.id + " has no judgments.tsv: adjudication rules on the blocking findings its judgments leave unmatched, so join them first");
  const unmatched = new Map(arms.map((a) => [a.arm.arm.id, adjudicate ? matchedBlockers(a.arm.judgments!) : null]));
  const pick = (a: LoadedArm, u: Unit) => (a.arm.findings!.get(u.id) ?? []).filter((f) => !adjudicate || (mapSeverity(a.arm.arm, f.raw, f.reader) === "CRITICAL" && !unmatched.get(a.arm.arm.id)!.has(f)));
  const rng = seededRandom(o.seed);
  const mask = masker(arms);
  const leaks = leakRules(arms);
  const cases = suiteCases(suite).cases;
  const problems: string[] = [];
  const entries: KeyEntry[] = [];
  const bodies: Array<{ file: string; unit: Unit; findings: Array<{ id: string; path: string | null; line: number | null; text: string }> }> = [];
  for (const u of suite.units) {
    const file = fileName(suite, u);
    const pooled = shuffle(
      arms.flatMap((a) => pick(a, u).map((f) => ({ arm: a.arm.arm.id, f }))),
      rng,
    );
    if (adjudicate && !pooled.length) continue;
    const width = String(pooled.length).length;
    const findings = pooled.map(({ arm, f }, i) => {
      const opaque = "F" + String(i + 1).padStart(width, "0");
      entries.push({ packet: file, opaque, arm, pass: f.pass, finding: f.id });
      const text = mask(f.summary + (f.fix ? "\nFix: " + f.fix : ""));
      for (const { rule, re } of leaks) if (re.test(text) || (f.path && re.test(f.path))) problems.push(unitRef(suite, u) + ", arm " + arm + ", finding " + JSON.stringify(f.id) + ": its text names " + rule);
      return { id: opaque, path: f.path, line: f.line, text };
    });
    bodies.push({ file, unit: u, findings });
  }
  if (problems.length) blind("the packets would leak what blinding hides:\n" + problems.join("\n") + "\nremove it from the source arm's findings and ingest it again");
  if (adjudicate && !entries.length) blind("no arm has a blocking finding that judgments.tsv leaves unmatched, so there is nothing to adjudicate");
  const head = { ...(adjudicate ? { kind: "adjudicate" as const } : {}), suite: { id: suite.id, sha256: o.suiteSha256 }, arms: arms.map((a) => ({ id: a.arm.arm.id, tree_sha256: a.treeSha256 })).sort((x, y) => (x.id < y.id ? -1 : 1)), seed: o.seed, mapping_sha256: sha256(JSON.stringify(entries)) };
  const staging = resolve(o.out) + ".staging-" + process.pid;
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(join(staging, "packets"), { recursive: true });
  const packets: JudgeKey["packets"] = [];
  for (const b of bodies) {
    const unit = { repo: b.unit.repo, pr: b.unit.pr, head: b.unit.head, base: b.unit.base };
    const known = (x: Unit["blockers"][number]) => ({ id: x.id, paths: x.paths, file: x.file, line: x.line, cause: cases.get(x.case)?.defect.summary ?? "" });
    const packet = adjudicate
      ? { version: JUDGE_VERSION, kind: "adjudicate", suite: head.suite.id, unit, known_informational: b.unit.blockers.filter((x) => x.counts === "over-blocking").map(known), findings: b.findings }
      : { version: JUDGE_VERSION, suite: head.suite.id, unit, blockers: b.unit.blockers.map(known), findings: b.findings };
    const bytes = Buffer.from(JSON.stringify(packet, null, 2) + "\n");
    writeFileSync(join(staging, b.file), bytes);
    packets.push({ file: b.file, unit: b.unit.id, sha256: sha256(bytes) });
  }
  const batch = batchDigest({ ...head, packets });
  const reply = { batch, judge: "<judge name and model>", packets: packets.slice(0, 1).map((p) => ({ file: p.file, sha256: p.sha256, blockers: [{ id: "B1", matches: bodies[0]!.findings.slice(0, 1).map((f) => f.id) }] })) };
  const first = bodies.find((b) => b.findings.length);
  if (adjudicate)
    writeFileSync(
      join(staging, "batch.json"),
      JSON.stringify({ version: JUDGE_VERSION, kind: "adjudicate", batch, suite: head.suite, packets, adjudication: "A second judge rules every finding the primary rules not-defect or known-informational plus a seeded " + SECOND_SAMPLE * 100 + "% sample of the rest; a third read rules every finding where the two judges differ. judge-join names each set.", reply_format: { batch, judge: "<judge name and model>", packets: [{ file: packets[0]!.file, sha256: packets[0]!.sha256, findings: [{ id: first!.findings[0]!.id, ruling: "not-defect" }] }] }, reply_rules: "One JSON reply per judge: batch, judge, and for each packet its file, its sha256 and a ruling for every finding you rule: defect when it names a real defect at the PR head, not-defect when it does not, known-informational when it raises the unit's known informational case (known_informational) as a blocker. Judge the defect, not the severity: every finding here was raised as blocking." }, null, 2) + "\n",
    );
  else writeFileSync(
    join(staging, "batch.json"),
    JSON.stringify({ version: JUDGE_VERSION, batch, suite: head.suite, judging_rule: suite.judging_rule, packets, adjudication: "A second judge answers every blocker where the arms' outcomes differ plus a seeded " + SECOND_SAMPLE * 100 + "% sample of the rest; a third read answers every blocker where the two judges differ. judge-join names each set.", reply_format: reply, reply_rules: "One JSON reply per judge: batch, judge, and for each packet its file, its sha256 and every blocker you answer with the ids of the findings that name the same defect (an empty list when none does). Judge the defect, not the severity: severity is applied mechanically." }, null, 2) + "\n",
  );
  writeFileSync(o.key, JSON.stringify({ version: JUDGE_VERSION, batch, ...head, packets, entries } satisfies JudgeKey, null, 2) + "\n", { mode: 0o600 });
  mkdirSync(resolve(o.out, ".."), { recursive: true });
  rmSync(o.out, { recursive: true, force: true });
  renameSync(staging, o.out);
  return { batch, packets: packets.length, findings: entries.length };
}

interface Reply {
  judge: string;
  answers: Map<string, Set<string>>;
  digest: string;
}

/** Reads a reply file and checks its batch, judge and each packet's digest; returns each packet body with its key entry. */
function readReplyFile(path: string, key: JudgeKey, role: string): { judge: string; digest: string; packets: Array<{ known: JudgeKey["packets"][number]; body: Record<string, unknown> }> } {
  let bytes: Buffer;
  let r: { batch?: unknown; judge?: unknown; packets?: unknown };
  try {
    bytes = readFileSync(path);
    r = JSON.parse(bytes.toString("utf8"));
  } catch (e) {
    return blind("the " + role + " reply " + path + " is not readable JSON: " + (e as Error).message);
  }
  if (r.batch !== key.batch) blind("the " + role + " reply names batch " + JSON.stringify(r.batch) + ", not this key's batch " + key.batch + "; a reply only joins the batch whose packets it judged");
  if (typeof r.judge !== "string" || !r.judge.trim() || /[\t\r\n]/.test(r.judge)) blind("the " + role + " reply needs a judge name on one line");
  if (!Array.isArray(r.packets)) blind("the " + role + " reply needs a packets list");
  const packets = (r.packets as Array<Record<string, unknown>>).map((p) => {
    const known = key.packets.find((k) => k.file === p.file);
    if (!known) blind("the " + role + " reply answers packet " + JSON.stringify(p.file) + ", which this batch does not have");
    if (p.sha256 !== known!.sha256) blind("the " + role + " reply's " + known!.file + " has digest " + JSON.stringify(p.sha256) + ", not " + known!.sha256 + "; it judged a stale or swapped packet");
    return { known: known!, body: p };
  });
  return { judge: (r.judge as string).trim(), digest: sha256(bytes!), packets };
}

/** Validates one packet's answers: known blockers, each once, matched to finding ids from that packet; adds them to answers under "<unit id> <blocker id>". */
export function packetAnswers(known: JudgeKey["packets"][number], body: Record<string, unknown>, key: JudgeKey, suite: Suite, role: string, answers = new Map<string, Set<string>>()): Map<string, Set<string>> {
  const unit = suite.units.find((u) => u.id === known.unit)!;
  const opaques = new Set(key.entries.filter((e) => e.packet === known.file).map((e) => e.opaque));
  for (const b of (Array.isArray(body.blockers) ? body.blockers : []) as Array<{ id?: unknown; matches?: unknown }>) {
    const blocker = unit.blockers.find((x) => x.id === b.id);
    if (!blocker) blind("the " + role + " reply answers blocker " + JSON.stringify(b.id) + " in " + known.file + ", which has " + unit.blockers.map((x) => x.id).join(", "));
    const k = unit.id + " " + blocker!.id;
    if (answers.has(k)) blind("the " + role + " reply answers " + known.file + " " + blocker!.id + " twice");
    if (!Array.isArray(b.matches) || !b.matches.every((m) => typeof m === "string" && opaques.has(m))) blind("the " + role + " reply's matches for " + known.file + " " + blocker!.id + " must be finding ids from that packet");
    answers.set(k, new Set(b.matches as string[]));
  }
  return answers;
}

/** Validates one packet's rulings: opaque ids of that packet, each once, a known ruling, known-informational only where the unit has that case; adds them under "<packet> <opaque id>". */
export function packetRulings(known: JudgeKey["packets"][number], body: Record<string, unknown>, key: JudgeKey, suite: Suite, role: string, rulings = new Map<string, Ruling>()): Map<string, Ruling> {
  const unit = suite.units.find((u) => u.id === known.unit)!;
  const opaques = new Set(key.entries.filter((e) => e.packet === known.file).map((e) => e.opaque));
  for (const f of (Array.isArray(body.findings) ? body.findings : []) as Array<{ id?: unknown; ruling?: unknown }>) {
    const k = known.file + " " + String(f.id);
    if (typeof f.id !== "string" || !opaques.has(f.id)) blind("the " + role + " reply rules finding " + JSON.stringify(f.id) + " in " + known.file + ", which that packet does not have");
    if (rulings.has(k)) blind("the " + role + " reply rules " + k + " twice");
    if (!RULINGS.includes(f.ruling as Ruling)) blind("the " + role + " reply's ruling for " + k + " is " + JSON.stringify(f.ruling) + ", not " + RULINGS.join(", "));
    if (f.ruling === "known-informational" && !unit.blockers.some((b) => b.counts === "over-blocking")) blind("the " + role + " reply rules " + k + " known-informational, but that unit has no known informational case");
    rulings.set(k, f.ruling as Ruling);
  }
  return rulings;
}

/** Validates a reply against the key: its batch, each packet's digest, known blockers and opaque ids. */
function readReply(path: string, key: JudgeKey, suite: Suite, role: string): Reply {
  const file = readReplyFile(path, key, role);
  const answers = new Map<string, Set<string>>();
  for (const { known, body } of file.packets) packetAnswers(known, body, key, suite, role, answers);
  return { judge: file.judge, answers, digest: file.digest };
}

/** Validates an adjudication reply: a known ruling for opaque ids of each packet, known-informational only where the unit has that case. */
function readRulings(path: string, key: JudgeKey, suite: Suite, role: string): { judge: string; rulings: Map<string, Ruling>; digest: string } {
  const file = readReplyFile(path, key, role);
  const rulings = new Map<string, Ruling>();
  for (const { known, body } of file.packets) packetRulings(known, body, key, suite, role, rulings);
  return { judge: file.judge, rulings, digest: file.digest };
}

export type JudgeRole = "primary" | "second" | "third";
/** A packet a judge's reply was refused twice for (judge-run's unjudged.json). */
export interface Unjudged {
  role: JudgeRole;
  packet: string;
  reason: string;
}

/**
 * The reads judge-join requires, keyed "<unit id> <blocker id>" (matching) or "<packet> <opaque id>" (adjudication).
 * From the primary's answers: the second set, every blocker where the arms' outcomes differ (every finding the primary
 * rules not-defect or known-informational) plus a seeded sample of the rest. With the second's answers too: the third
 * set, every one where the two judges differ. A packet a judge left unjudged takes its blockers or findings out of the
 * judged list or the sets that judge reads; they come back in dropped with the entry that left them.
 */
export function judgeSets(key: JudgeKey, suite: Suite, arms: Map<string, Arm>, primary: Map<string, Set<string> | Ruling>, second: Map<string, Set<string> | Ruling> | null, unjudged: Unjudged[] = []): { judged: Array<{ k: string; packet: string }>; differ: number; second: Set<string>; third: Set<string> | null; dropped: Map<string, Unjudged> } {
  const adjudicate = key.kind === "adjudicate";
  const dropped = new Map<string, Unjudged>();
  const left = (role: JudgeRole, c: { k: string; packet: string }) => {
    const e = unjudged.find((x) => x.role === role && x.packet === c.packet);
    if (e) dropped.set(c.k, e);
    return e !== undefined;
  };
  const all: Array<{ k: string; packet: string; label: string; u?: Unit }> = adjudicate
    ? key.entries.map((e) => ({ k: e.packet + " " + e.opaque, packet: e.packet, label: e.packet + " " + e.opaque }))
    : suite.units.flatMap((u) => u.blockers.map((b) => ({ k: u.id + " " + b.id, packet: fileName(suite, u), label: unitRef(suite, u) + " " + b.id, u })));
  const judged = all.filter((c) => !left("primary", c));
  const missing = judged.filter((c) => !primary.has(c.k));
  if (missing.length) blind("the primary reply leaves " + missing.length + (adjudicate ? " findings unruled: " : " blockers unanswered: ") + missing.map((c) => c.label).join(", "));
  const differs = (c: (typeof all)[number]) => (adjudicate ? primary.get(c.k) !== "defect" : new Set([...cellsFor(key, arms, c.u!, primary.get(c.k) as Set<string>, c.packet).values()].map((x) => x.outcome)).size > 1);
  const must = judged.filter(differs);
  const rest = judged.filter((c) => !must.includes(c));
  const secondSet = new Set([...must, ...shuffle(rest, seededRandom(key.seed + 1)).slice(0, Math.ceil(SECOND_SAMPLE * rest.length))].map((c) => c.k));
  for (const c of judged) if (secondSet.has(c.k) && left("second", c)) secondSet.delete(c.k);
  if (!second) return { judged, differ: must.length, second: secondSet, third: null, dropped };
  const same = (k: string) => (adjudicate ? second.get(k) === primary.get(k) : [...(primary.get(k) as Set<string>)].sort().join(",") === [...(second.get(k) as Set<string>)].sort().join(","));
  const thirdSet = new Set([...secondSet].filter((k) => !same(k)));
  for (const c of judged) if (thirdSet.has(c.k) && left("third", c)) thirdSet.delete(c.k);
  return { judged, differ: must.length, second: secondSet, third: thirdSet, dropped };
}

/** Reads judge-run's unjudged.json, bound to this key's batch. */
function readUnjudged(path: string, key: JudgeKey): { entries: Unjudged[]; digest: string } {
  let bytes: Buffer;
  let u: { batch?: unknown; entries?: unknown };
  try {
    bytes = readFileSync(path);
    u = JSON.parse(bytes.toString("utf8"));
  } catch (e) {
    return blind("--unjudged " + path + " is not readable JSON: " + (e as Error).message);
  }
  if (u.batch !== key.batch) blind("--unjudged " + path + " names batch " + JSON.stringify(u.batch) + ", not this key's batch " + key.batch + "; it only joins the batch its judge run read");
  const entries = Array.isArray(u.entries) ? (u.entries as Unjudged[]) : blind("--unjudged " + path + " needs an entries list");
  for (const e of entries) if (!["primary", "second", "third"].includes(e?.role) || !key.packets.some((p) => p.file === e.packet) || typeof e.reason !== "string") blind("--unjudged " + path + " has an entry that does not name a role (primary, second or third), a packet of this batch and a reason: " + JSON.stringify(e));
  return { entries, digest: sha256(bytes!) };
}

interface Cell {
  outcome: Outcome;
  matched: Finding[];
  mapped: Mapped | null;
}

/** Outcome per arm and pass for one blocker: the highest mapped severity among the matched findings wins. */
function cellsFor(key: JudgeKey, arms: Map<string, Arm>, unit: Unit, matches: Set<string>, packet: string): Map<string, Cell> {
  const cells = new Map<string, Cell>();
  for (const [id, arm] of arms)
    for (let p = 1; p <= arm.arm.passes; p++) {
      const findings = key.entries.filter((e) => e.packet === packet && e.arm === id && e.pass === p && matches.has(e.opaque)).map((e) => arm.findings!.get(unit.id)!.find((f) => f.id === e.finding && f.pass === p)!);
      const maps = findings.map((f) => mapSeverity(arm.arm, f.raw, f.reader));
      const mapped: Mapped | null = maps.includes("CRITICAL") ? "CRITICAL" : maps.includes("INFORMATIONAL") ? "INFORMATIONAL" : null;
      cells.set(id + " " + p, { outcome: mapped === "CRITICAL" ? "F" : mapped === "INFORMATIONAL" ? "D" : "M", matched: findings, mapped });
    }
  return cells;
}

function kappa<T extends string>(pairs: Array<[T, T]>, categories: readonly T[]): number | null {
  if (!pairs.length) return null;
  const po = pairs.filter(([x, y]) => x === y).length / pairs.length;
  const pe = categories.reduce((s, o) => s + (pairs.filter(([x]) => x === o).length / pairs.length) * (pairs.filter(([, y]) => y === o).length / pairs.length), 0);
  return pe < 1 ? Math.round(((po - pe) / (1 - pe)) * 1e4) / 1e4 : null;
}

export interface JoinResult {
  kind: "judgments" | "adjudication";
  batch: string;
  arms: string[];
  second_required: number;
  third_required: number;
  kappa_primary_second: number | null;
  out: string;
}

/** Writes out/<arm id>/ for every arm and the join record through a staging directory, replacing what was there. */
function writeJoined(out: string, written: Map<string, Map<string, Buffer>>, recordName: string, record: unknown): void {
  const staging = resolve(out) + ".join-" + process.pid;
  rmSync(staging, { recursive: true, force: true });
  for (const [id, files] of written) for (const [name, bytes] of files) {
    mkdirSync(join(staging, id, name.includes("/") ? name.slice(0, name.lastIndexOf("/")) : ""), { recursive: true });
    writeFileSync(join(staging, id, name), bytes);
  }
  writeFileSync(join(staging, recordName), JSON.stringify(record, null, 2) + "\n");
  mkdirSync(out, { recursive: true });
  for (const name of readdirSync(staging)) {
    const dest = join(out, name);
    const old = join(out, "." + name + ".old-" + process.pid);
    if (existsSync(dest)) renameSync(dest, old);
    renameSync(join(staging, name), dest);
    rmSync(old, { recursive: true, force: true });
  }
  rmSync(staging, { recursive: true, force: true });
}

type JoinInput = { suite: Suite; suiteSha256: string; key: string; primary: string; second: string | null; third: string | null; unjudged?: string | null; arms: LoadedArm[]; out: string; replace: string | null };

/** Reads the key and checks it against its own digests, the suite and the arms' trees. */
export function loadKey(o: Pick<JoinInput, "suite" | "suiteSha256" | "key" | "arms">): JudgeKey {
  const { suite } = o;
  let key: JudgeKey;
  try {
    key = JSON.parse(readFileSync(o.key, "utf8"));
  } catch (e) {
    return blind("--key " + o.key + " is not readable JSON: " + (e as Error).message);
  }
  if (key.version !== JUDGE_VERSION || !Array.isArray(key.entries) || !Array.isArray(key.packets) || !Array.isArray(key.arms)) blind("--key " + o.key + " is not a judge key of version " + JUDGE_VERSION);
  if (sha256(JSON.stringify(key.entries)) !== key.mapping_sha256 || batchDigest(key) !== key.batch) blind("--key " + o.key + " does not hash to its own batch digest; it was edited or swapped");
  if (key.suite.id !== suite.id || key.suite.sha256 !== o.suiteSha256) blind("the batch was built on suite " + key.suite.id + " at " + key.suite.sha256 + ", not " + suite.id + " at " + o.suiteSha256);
  const given = o.arms.map((a) => a.arm.arm.id).sort();
  const bound = key.arms.map((a) => a.id);
  if (given.join(",") !== bound.join(",")) blind("the batch judged arms " + bound.join(", ") + "; --arm gave " + given.join(", "));
  for (const a of o.arms) {
    const t = key.arms.find((x) => x.id === a.arm.arm.id)!.tree_sha256;
    if (t !== a.treeSha256) blind("arm " + a.arm.arm.id + " changed since the packets were built (tree " + t + ", now " + a.treeSha256 + "); build a new batch");
  }
  return key;
}

/** Joins adjudication replies into adjudication.tsv for every arm of the batch, under out/<arm id>/, ready for noloss ingest. */
function adjudicationJoin(o: JoinInput, key: JudgeKey, unjudged: ReturnType<typeof readUnjudged> | null): JoinResult {
  const { suite } = o;
  const arms = new Map(o.arms.map((a) => [a.arm.arm.id, a.arm]));
  const ids = key.entries.map((e) => e.packet + " " + e.opaque);
  const list = (ks: Set<string>) => ids.filter((k) => ks.has(k)).join(", ");
  const primary = readRulings(o.primary, key, suite, "primary");
  const secondSet = judgeSets(key, suite, arms, primary.rulings, null, unjudged?.entries).second;
  if (!o.second) blind("scoring waits for the second judge: send these " + secondSet.size + " findings (every one the primary ruled not-defect or known-informational, plus a seeded " + SECOND_SAMPLE * 100 + "% sample of the rest) with the same packets, then pass --second: " + list(secondSet));
  const second = readRulings(o.second!, key, suite, "second");
  if (second.judge === primary.judge) blind("the second reply is from " + second.judge + ", the primary judge; a second read needs another judge");
  const extra = [...second.rulings.keys()].filter((k) => !secondSet.has(k)).length;
  const short = [...secondSet].filter((k) => !second.rulings.has(k)).length;
  if (extra || short) blind("the second reply must rule exactly the " + secondSet.size + " findings judge-join named (" + short + " missing, " + extra + " extra): " + list(secondSet));
  const reads = judgeSets(key, suite, arms, primary.rulings, second.rulings, unjudged?.entries);
  const thirdSet = reads.third!;
  let third: ReturnType<typeof readRulings> | null = null;
  if (thirdSet.size) {
    if (!o.third) blind("scoring waits for a third read: the two judges differ on these " + thirdSet.size + " findings; send them with the same packets, then pass --third: " + list(thirdSet));
    third = readRulings(o.third!, key, suite, "third");
    if (third.judge === primary.judge || third.judge === second.judge) blind("the third read is from " + third.judge + ", who already ruled these findings; a third read needs a third judge");
    const x = [...third.rulings.keys()].filter((k) => !thirdSet.has(k)).length;
    const s = [...thirdSet].filter((k) => !third!.rulings.has(k)).length;
    if (x || s) blind("the third reply must rule exactly the " + thirdSet.size + " findings judge-join named (" + s + " missing, " + x + " extra): " + list(thirdSet));
  } else if (o.third) blind("the two judges agree on every finding, so there is no third read to join; drop --third");
  for (const a of o.arms) if (a.arm.adjudications && o.replace === null) blind("arm " + a.arm.arm.id + " already has adjudication.tsv; pass --replace \"<reason>\" to replace it");
  for (const id of arms.keys()) if (existsSync(join(o.out, id)) && o.replace === null) blind(join(o.out, id) + " already exists; pass --replace \"<reason>\" to overwrite it");
  const written = new Map<string, Map<string, Buffer>>();
  for (const a of o.arms) {
    const rows = [ADJUDICATION_COLUMNS.join("\t")];
    for (const e of key.entries.filter((x) => x.arm === a.arm.arm.id)) {
      const k = e.packet + " " + e.opaque;
      if (reads.dropped.has(k)) continue;
      const unit = suite.units.find((u) => u.id === key.packets.find((p) => p.file === e.packet)!.unit)!;
      const f = a.arm.findings!.get(unit.id)!.find((x) => x.id === e.finding && x.pass === e.pass)!;
      const adjudicated = thirdSet.has(k);
      rows.push([unitRef(suite, unit), /[;\s]/.test(f.id) ? "#" + f.index : f.id, String(e.pass), (adjudicated ? third! : primary).rulings.get(k)!, adjudicated ? third!.judge + " (third read)" : primary.judge, "no", String(ADJUDICATION_VERSION), key.batch, adjudicated ? "the primary and second judges differed; the third read decides" : ""].join("\t"));
    }
    const files = new Map(a.files);
    files.delete("ingest.json");
    files.set("adjudication.tsv", Buffer.from(rows.join("\n") + "\n"));
    parseArm(files, suite, o.suiteSha256);
    written.set(a.arm.arm.id, files);
  }
  const k = kappa([...secondSet].map((s) => [primary.rulings.get(s)!, second.rulings.get(s)!] as [Ruling, Ruling]), RULINGS);
  const record = { version: JUDGE_VERSION, kind: "adjudicate", batch: key.batch, suite: key.suite, arms: key.arms, judges: { primary: primary.judge, second: second.judge, third: third?.judge ?? null }, replies_sha256: { primary: primary.digest, second: second.digest, third: third?.digest ?? null }, second_required: secondSet.size, third_required: thirdSet.size, kappa_primary_second: k, replaced: o.replace, unjudged: unjudged ? { sha256: unjudged.digest, findings: reads.dropped.size } : null };
  writeJoined(o.out, written, "adjudication-" + key.batch.slice(0, 12) + ".json", record);
  return { kind: "adjudication", batch: key.batch, arms: [...arms.keys()], second_required: secondSet.size, third_required: thirdSet.size, kappa_primary_second: k, out: o.out };
}

/**
 * Joins the judges' replies into judgments.tsv for every arm of the batch, written under out/<arm id>/ with the arm's
 * other contract files, ready for noloss ingest. Refuses until the second and third reads the batch requires are given.
 */
export function judgeJoin(o: JoinInput): JoinResult {
  const { suite } = o;
  if (suite.sealed && insideRepo(o.out)) blind("suite " + suite.id + " is sealed, so judged arms must be written outside the repo");
  const key = loadKey(o);
  const unjudged = o.unjudged ? readUnjudged(o.unjudged, key) : null;
  if (key.kind === "adjudicate") return adjudicationJoin(o, key, unjudged);
  const arms = new Map(o.arms.map((a) => [a.arm.arm.id, a.arm]));
  const cellKeys = suite.units.flatMap((u) => u.blockers.map((b) => ({ u, b, k: u.id + " " + b.id, packet: fileName(suite, u) })));
  const primary = readReply(o.primary, key, suite, "primary");
  const firstRead = judgeSets(key, suite, arms, primary.answers, null, unjudged?.entries);
  const secondSet = firstRead.second;
  const first = new Map(cellKeys.filter((c) => primary.answers.has(c.k)).map((c) => [c.k, cellsFor(key, arms, c.u, primary.answers.get(c.k)!, c.packet)]));
  const list = (ks: Set<string>) => cellKeys.filter((c) => ks.has(c.k)).map((c) => fileName(suite, c.u) + " " + c.b.id).join(", ");
  if (!o.second) blind("scoring waits for the second judge: send these " + secondSet.size + " blockers (every one where the arms differ, plus a seeded " + SECOND_SAMPLE * 100 + "% sample) with the same packets, then pass --second: " + list(secondSet));
  const second = readReply(o.second!, key, suite, "second");
  if (second.judge === primary.judge) blind("the second reply is from " + second.judge + ", the primary judge; a second read needs another judge");
  const extra = [...second.answers.keys()].filter((k) => !secondSet.has(k)).length;
  const short = [...secondSet].filter((k) => !second.answers.has(k)).length;
  if (extra || short) blind("the second reply must answer exactly the " + secondSet.size + " blockers judge-join named (" + short + " missing, " + extra + " extra): " + list(secondSet));
  const secondCells = new Map([...secondSet].map((k) => { const c = cellKeys.find((x) => x.k === k)!; return [k, cellsFor(key, arms, c.u, second.answers.get(k)!, c.packet)]; }));
  const reads = judgeSets(key, suite, arms, primary.answers, second.answers, unjudged?.entries);
  const thirdSet = reads.third!;
  const incomplete = reads.dropped.size > 0;
  let third: Reply | null = null;
  if (thirdSet.size) {
    if (!o.third) blind("scoring waits for a third read: the two judges differ on these " + thirdSet.size + " blockers; send them with the same packets, then pass --third: " + list(thirdSet));
    third = readReply(o.third!, key, suite, "third");
    if (third.judge === primary.judge || third.judge === second.judge) blind("the third read is from " + third.judge + ", who already judged these blockers; a third read needs a third judge");
    const x = [...third.answers.keys()].filter((k) => !thirdSet.has(k)).length;
    const s = [...thirdSet].filter((k) => !third!.answers.has(k)).length;
    if (x || s) blind("the third reply must answer exactly the " + thirdSet.size + " blockers judge-join named (" + s + " missing, " + x + " extra): " + list(thirdSet));
  } else if (o.third) blind("the two judges agree on every blocker, so there is no third read to join; drop --third");
  for (const a of o.arms) if (a.arm.judgments && o.replace === null) blind("arm " + a.arm.arm.id + " already has judgments; pass --replace \"<reason>\" to replace them");
  for (const id of arms.keys()) if (existsSync(join(o.out, id)) && o.replace === null) blind(join(o.out, id) + " already exists; pass --replace \"<reason>\" to overwrite it");
  const written = new Map<string, Map<string, Buffer>>();
  for (const a of o.arms) {
    const arm = a.arm;
    const rows = [[...JUDGMENT_COLUMNS, "pass", ...(incomplete ? ["coverage"] : [])].join("\t")];
    for (const c of cellKeys)
      for (let p = 1; p <= arm.arm.passes; p++) {
        const gap = reads.dropped.get(c.k);
        if (gap) {
          rows.push([unitRef(suite, c.u), c.b.id, "M", "", "", "", "judge-run", "no", "no judgment: the " + gap.role + " judge's reply for " + gap.packet + " was refused twice", String(p), "incomplete"].join("\t"));
          continue;
        }
        const adjudicated = thirdSet.has(c.k);
        const cell = adjudicated ? cellsFor(key, arms, c.u, third!.answers.get(c.k)!, c.packet).get(arm.arm.id + " " + p)! : first.get(c.k)!.get(arm.arm.id + " " + p)!;
        const ref = (f: Finding) => (/[;\s]/.test(f.id) ? "#" + f.index : f.id);
        const raw = cell.matched.find((f) => mapSeverity(arm.arm, f.raw, f.reader) === cell.mapped)?.raw ?? "";
        rows.push([unitRef(suite, c.u), c.b.id, cell.outcome, cell.matched.map(ref).join(";"), raw, cell.mapped ?? "", adjudicated ? third!.judge + " (third read)" : primary.judge, "no", adjudicated ? "the primary and second judges differed; the third read decides" : "", String(p), ...(incomplete ? [""] : [])].join("\t"));
      }
    const files = new Map(a.files);
    files.delete("ingest.json");
    files.set("judgments.tsv", Buffer.from(rows.join("\n") + "\n"));
    parseArm(files, suite, o.suiteSha256);
    written.set(arm.arm.id, files);
  }
  const k = kappa([...secondSet].flatMap((s) => [...first.get(s)!].map(([ck, c]) => [c.outcome, secondCells.get(s)!.get(ck)!.outcome] as [Outcome, Outcome])), ["F", "D", "M"]);
  const record = { version: JUDGE_VERSION, batch: key.batch, suite: key.suite, arms: key.arms, judges: { primary: primary.judge, second: second.judge, third: third?.judge ?? null }, replies_sha256: { primary: primary.digest, second: second.digest, third: third?.digest ?? null }, second_required: secondSet.size, arms_differed: firstRead.differ, third_required: thirdSet.size, kappa_primary_second: k, replaced: o.replace, unjudged: unjudged ? { sha256: unjudged.digest, blockers: reads.dropped.size } : null };
  writeJoined(o.out, written, "join-" + key.batch.slice(0, 12) + ".json", record);
  return { kind: "judgments", batch: key.batch, arms: [...arms.keys()], second_required: secondSet.size, third_required: thirdSet.size, kappa_primary_second: k, out: o.out };
}
