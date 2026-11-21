// Copyright (c) 2026 Garry Tan. MIT License.
// Part C's blind judging (preregistration section 5.5): R2's pipeline (lanes/review-noloss/judge.ts) with one packet per
// state. Section 6, attack 12, has the first-stop and final states of one session reach the judge as separate packets in
// seeded order, so where R2 pooled a unit's arms into one packet, each packet here holds one state's counted findings,
// and nothing in it names the arm, the state or the pass. Packets, replies and severity follow R2: the same packet and
// reply shapes, R2's severity mask and leak rules, R2's reply checks (packetAnswers, packetRulings), and R2's join rule,
// where a third read decides wherever it read. There are three batches, in this order:
//
// 1. extract: the message of each state with no parseable json block, for the production judge to list its findings
//    key-blind (section 5.3). The packet holds no blocker. The rule it follows is EXTRACT_RULE, frozen here.
// 2. match: every state with at least one counted finding, plus the judge check's anchors in the pilot batch. A state
//    with no counted finding gets no packet: it matches nothing, and no judge reads it. A second judge reads every item
//    (a packet's blocker) in a bug-pass whose outcomes differ across the arms or states under the primary, plus a seeded
//    20% sample of the rest; a third reads every item where the two judges' matches differ.
// 3. adjudicate: each state's counted findings that map to CRITICAL and match no blocker, with the unit's known
//    informational cases and an evidence sheet. A second judge rules every finding the primary rules not-defect or
//    known-informational plus a seeded 20% sample of the rest; a third rules where the two differ.
//
// No model is called here. run.ts sends the packets; this file writes them, reads replies and names each read set.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { seededRandom } from "../../../../src/runner/stats/paired.ts";
import { parseFinalTurn, type ToldFinding } from "../../../../src/trial/review/findings.ts";
import type { Arm, Finding, Ruling } from "../../../review-noloss/contract.ts";
import { leakRules, masker, packetAnswers, packetRulings, type JudgeKey, type LoadedArm } from "../../../review-noloss/judge.ts";
import { sha256, suiteCases, type Suite, type Unit } from "../../../review-noloss/suite.ts";
import { ARMS, COUNTED_FINDINGS, SECOND_SAMPLE, type CArm } from "./frozen.ts";
import type { StateRef, StatesFile } from "./record.ts";
import { armJson, readerOf, severityOf, type SeverityEntry } from "./severity.ts";

export const JUDGING_VERSION = 1;
export type Stage = "extract" | "match" | "adjudicate";
export type Role = "primary" | "second" | "third";

/** The frozen rule for key-blind extraction. The preregistration names the step (section 5.3) but not its words, so these are the harness's. */
export const EXTRACT_RULE = [
  "Each packet holds the last message of one code review of the pull request the packet names. The review was asked to end with one fenced json block that lists its findings, and its message has no such block that parses.",
  "List the findings the message itself reports, in the order it reports them, in the shape that block would have had: \"file\" (the path relative to the repository root, or null), \"line\" (a whole number, or null), \"severity\" (the label the message gives the finding, word for word, or \"unlabelled\" when it gives none), \"claim\" (what is wrong, in one or two sentences, in the message's words) and \"evidence\" (what the message gives to show it, or an empty string).",
  "Report only what the message states. Do not add, merge, judge, rank or fix findings, and do not read any code. A message that reports no finding gets an empty list.",
].join("\n\n");
export const EXTRACT_RULE_SHA256 = sha256(EXTRACT_RULE);

/** Words that would tell a judge the state or the contract's hold, refused in any text a packet carries, beside R2's arm leak rules. */
export const STATE_WORDS = ["first_stop", "first-stop", "hook_prompt"] as const;

/** A finding the harness writes for the judge check (section 5.5): a known match from the bug's file, line and catalog summary, or a near miss in the same file at least 30 lines away with another case's claim. */
export interface Anchor {
  bug: string;
  kind: "match" | "near_miss";
  /** The catalog case whose summary the finding's claim is. */
  from_case: string;
}

export interface PacketRef {
  file: string;
  unit: string;
  sha256: string;
  /** The state the packet holds; null for an anchor. */
  state: string | null;
  anchor: Anchor | null;
  /** An adjudication packet's evidence sheet. */
  sheet?: { file: string; sha256: string };
}

export interface EntryRef {
  packet: string;
  opaque: string;
  /** The state's arm, or "anchor". */
  arm: string;
  pass: number;
  /** R2's finding id form, p<pass>-<n>. */
  finding: string;
  state: string | null;
  /** The finding's index in the state's counted findings. */
  index: number;
}

export interface Key {
  version: number;
  stage: Stage;
  batch: string;
  suite: { id: string; sha256: string };
  /** R2's JudgeKey field; empty, since this batch binds states, not arm trees. */
  arms: Array<{ id: string; tree_sha256: string }>;
  seed: number;
  states_sha256: string;
  mapping_sha256: string;
  packets: PacketRef[];
  entries: EntryRef[];
}

export class JudgingError extends Error {
  constructor(
    readonly code: "E_CH_C_BLIND" | "E_CH_C_REPLY" | "E_USAGE",
    message: string,
  ) {
    super(code + " " + message);
  }
}
const blind = (m: string): never => {
  throw new JudgingError("E_CH_C_BLIND", m);
};
const bad = (m: string): never => {
  throw new JudgingError("E_CH_C_REPLY", m);
};

/** One state's counted findings: the record's own, or the extraction's first 15. null when extraction left it unjudged. */
export type Counted = Map<string, ToldFinding[] | null>;
export const countedOf = (s: StateRef, extracted: Counted): ToldFinding[] | null | undefined => (s.record.no_block ? extracted.get(s.id) : s.record.findings!);

/** R2's view of this eval's arms, so R2's severity mask and leak rules read them: each arm's map entry and its findings' labels. */
export function r2Arms(maps: Record<CArm, SeverityEntry>, findings: Array<{ arm: CArm; unit: string; pass: number; f: ToldFinding }>): LoadedArm[] {
  return ARMS.map((arm) => {
    const byUnit = new Map<string, Finding[]>();
    for (const x of findings.filter((y) => y.arm === arm)) {
      const list = byUnit.get(x.unit) ?? [];
      list.push({ id: "f" + list.length, index: list.length, pass: x.pass, raw: x.f.severity.split(",")[0]!.trim(), reader: readerOf(x.f), path: x.f.file, line: x.f.line, summary: x.f.claim, fix: "", fields: { ...x.f } });
      byUnit.set(x.unit, list);
    }
    const a: Arm = { arm: armJson(arm, maps[arm]), provenance: "live", state: "raw", findings: byUnit, judgments: null, adjudications: null, cost: [] };
    return { arm: a, files: new Map(), treeSha256: "" };
  });
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** R2's leak rules for these arms, plus the state words. */
export function leaks(arms: LoadedArm[]): Array<{ rule: string; re: RegExp }> {
  return [...leakRules(arms), ...STATE_WORDS.map((w) => ({ rule: "a state or hold word (" + w + ")", re: new RegExp("(?<![A-Za-z0-9_])" + escape(w) + "(?![A-Za-z0-9_])", "i") }))];
}

function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}
export const seededShuffle = <T>(items: readonly T[], seed: number): T[] => shuffle(items, seededRandom(seed));

const unitOf = (u: Unit) => ({ repo: u.repo, pr: u.pr, head: u.head, base: u.base });
const pad = (n: number, width: number) => String(n).padStart(width, "0");
const inside = (child: string, dir: string) => resolve(child) === resolve(dir) || resolve(child).startsWith(resolve(dir) + sep);
export const mappingDigest = (k: Pick<Key, "packets" | "entries">) => sha256(JSON.stringify({ packets: k.packets.map((p) => [p.file, p.state, p.anchor, p.sheet ?? null]), entries: k.entries }));
export const batchDigest = (k: Omit<Key, "batch" | "entries" | "arms" | "version">) => sha256(JSON.stringify({ version: JUDGING_VERSION, stage: k.stage, suite: k.suite, seed: k.seed, states_sha256: k.states_sha256, mapping_sha256: k.mapping_sha256, packets: k.packets.map((p) => [p.file, p.unit, p.sha256]) }));

/** The suite's catalog cases, read once per suite: suiteCases reads the whole catalog each call. */
const casesBySuite = new WeakMap<Suite, ReturnType<typeof suiteCases>["cases"]>();
function casesOf(suite: Suite): ReturnType<typeof suiteCases>["cases"] {
  const cached = casesBySuite.get(suite);
  if (cached) return cached;
  const cases = suiteCases(suite).cases;
  casesBySuite.set(suite, cases);
  return cases;
}

/** A blocker as packets show it: R2's form, with the case's catalog summary as its cause. */
export function knownBlocker(suite: Suite, b: Unit["blockers"][number]): { id: string; paths: string[]; file: string; line: number; cause: string } {
  const c = casesOf(suite).get(b.case);
  return { id: b.id, paths: b.paths, file: b.file, line: b.line, cause: c?.defect.summary ?? "" };
}

/** Writes the packets, batch.json and the key the way R2's judge-packet does: through a staging directory, with the key outside the packets. */
function writeBatch(out: string, keyPath: string, files: Map<string, Buffer>, key: Key): void {
  if (inside(keyPath, out)) blind("--key " + keyPath + " is inside --out " + out + "; the key maps packets back to states and must never travel with them");
  if (existsSync(keyPath)) blind("--key " + keyPath + " already exists; give each batch a new key path");
  if (existsSync(out) && readdirSync(out).length) blind("--out " + out + " is not empty; write each batch to a new directory");
  const staging = resolve(out) + ".staging-" + process.pid;
  rmSync(staging, { recursive: true, force: true });
  for (const [name, bytes] of files) {
    mkdirSync(dirname(join(staging, name)), { recursive: true });
    writeFileSync(join(staging, name), bytes);
  }
  mkdirSync(dirname(resolve(keyPath)), { recursive: true });
  writeFileSync(keyPath, JSON.stringify(key, null, 2) + "\n", { mode: 0o600 });
  mkdirSync(resolve(out, ".."), { recursive: true });
  rmSync(out, { recursive: true, force: true });
  renameSync(staging, out);
}

const json = (v: unknown) => Buffer.from(JSON.stringify(v, null, 2) + "\n");

interface BatchInput {
  suite: Suite;
  suiteSha256: string;
  states: StatesFile;
  statesSha256: string;
  maps: Record<CArm, SeverityEntry>;
  seed: number;
  out: string;
  key: string;
}

/** Batch 1: one packet per state with no parseable block, holding its message for key-blind extraction. */
export function writeExtract(o: BatchInput): Key {
  const todo = o.states.states.filter((s) => s.record.no_block);
  const rules = leaks(r2Arms(o.maps, []));
  const problems = todo.flatMap((s) => rules.filter(({ re }) => re.test(s.record.message!)).map(({ rule }) => "state " + s.id + ": its message names " + rule));
  if (problems.length) blind("the extraction packets would leak what blinding hides:\n" + problems.join("\n") + "\nthe Captain decides how the message is masked");
  const order = seededShuffle(todo, o.seed);
  const width = String(order.length).length;
  const files = new Map<string, Buffer>();
  const packets: PacketRef[] = order.map((s, i) => {
    const file = "packets/E" + pad(i + 1, width) + ".json";
    const unit = o.suite.units.find((u) => u.id === s.record.unit)!;
    const bytes = json({ version: JUDGING_VERSION, stage: "extract", suite: o.suite.id, unit: unitOf(unit), message: s.record.message });
    files.set(file, bytes);
    return { file, unit: unit.id, sha256: sha256(bytes), state: s.id, anchor: null };
  });
  const head = { stage: "extract" as const, suite: { id: o.suite.id, sha256: o.suiteSha256 }, seed: o.seed, states_sha256: o.statesSha256, mapping_sha256: mappingDigest({ packets, entries: [] }), packets };
  const batch = batchDigest(head);
  files.set("batch.json", json({ version: JUDGING_VERSION, stage: "extract", batch, suite: head.suite, packets: packets.map((p) => ({ file: p.file, unit: p.unit, sha256: p.sha256 })), extract_rule: EXTRACT_RULE, extract_rule_sha256: EXTRACT_RULE_SHA256, reply_format: { batch, judge: "<judge name and model>", packets: [{ file: packets[0]?.file ?? "packets/E1.json", sha256: packets[0]?.sha256 ?? "<sha256>", findings: [{ file: "lib/example.ts", line: 12, severity: "<label as written>", claim: "<what is wrong>", evidence: "<what shows it>" }] }] }, reply_rules: "One JSON reply per judge: batch, judge, and for each packet its file, its sha256 and its findings list, in the order the message reports them (an empty list when it reports none)." }));
  const key: Key = { version: JUDGING_VERSION, ...head, batch, arms: [], entries: [] };
  writeBatch(o.out, o.key, files, key);
  return key;
}

/** A finding the judge check writes from the catalog (section 5.5), placed in the pilot's matching batch as its own packet. */
export interface AnchorFinding {
  unit: Unit;
  anchor: Anchor;
  finding: ToldFinding;
}

/**
 * The judge check's anchors for the pilot units (section 5.5): for each blocking bug, a known match from its file, line
 * and catalog summary, and a near miss in the same file, CHECK.near_miss_offset lines away, whose claim is another
 * bug's catalog summary drawn by seed from another unit. Pairs drop by seed until anchors are at most maxShare of the set.
 */
export function anchorsFor(suite: Suite, units: readonly Unit[], nonAnchorItems: number, o: { seed: number; offset: number; maxShare: number }): AnchorFinding[] {
  const cases = casesOf(suite);
  const rng = seededRandom(o.seed + 2);
  const others = suite.units.flatMap((u) => u.blockers.filter((b) => b.counts === "blocking").map((b) => ({ u, b })));
  const pairs = units.flatMap((u) =>
    u.blockers
      .filter((b) => b.counts === "blocking")
      .map((b) => {
        const pool = others.filter((x) => x.u.id !== u.id);
        const other = pool[Math.floor(rng() * pool.length)]!;
        const line = b.line > o.offset ? b.line - o.offset : b.line + o.offset;
        return [
          { unit: u, anchor: { bug: b.id, kind: "match" as const, from_case: b.case }, finding: { file: b.file, line: b.line, severity: "CRITICAL", claim: cases.get(b.case)?.defect.summary ?? "", evidence: "" } },
          { unit: u, anchor: { bug: b.id, kind: "near_miss" as const, from_case: other.b.case }, finding: { file: b.file, line, severity: "CRITICAL", claim: cases.get(other.b.case)?.defect.summary ?? "", evidence: "" } },
        ];
      }),
  );
  const keep = Math.floor((o.maxShare * nonAnchorItems) / (1 - o.maxShare) / 2);
  return shuffle(pairs, rng).slice(0, Math.min(keep, pairs.length)).flat();
}

/** Batch 2: one packet per state with counted findings, plus any anchors, in one seeded order. */
export function writeMatch(o: BatchInput & { counted: Counted; anchors: AnchorFinding[] }): { key: Key; mechanical: string[]; gaps: string[] } {
  const mechanical: string[] = [];
  const gaps: string[] = [];
  const work: Array<{ unit: Unit; state: StateRef | null; anchor: Anchor | null; findings: ToldFinding[] }> = [];
  for (const s of o.states.states) {
    const c = countedOf(s, o.counted);
    if (c === undefined) blind("state " + s.id + " has no parseable block and no extraction reply; run the extraction batch first");
    if (c === null) {
      gaps.push(s.id);
      continue;
    }
    if (!c!.length) {
      mechanical.push(s.id);
      continue;
    }
    work.push({ unit: o.suite.units.find((u) => u.id === s.record.unit)!, state: s, anchor: null, findings: c!.slice(0, COUNTED_FINDINGS) });
  }
  for (const a of o.anchors) work.push({ unit: a.unit, state: null, anchor: a.anchor, findings: [a.finding] });
  const arms = r2Arms(o.maps, work.flatMap((w) => w.findings.map((f) => ({ arm: (w.state?.record.arm ?? "c-on") as CArm, unit: w.unit.id, pass: w.state?.record.pass ?? 1, f }))));
  const mask = masker(arms);
  const rules = leaks(arms);
  const rng = seededRandom(o.seed);
  const order = shuffle(work, rng);
  const width = String(order.length).length;
  const files = new Map<string, Buffer>();
  const packets: PacketRef[] = [];
  const entries: EntryRef[] = [];
  const problems: string[] = [];
  order.forEach((w, i) => {
    const file = "packets/P" + pad(i + 1, width) + ".json";
    const shuffled = shuffle(w.findings.map((f, index) => ({ f, index })), rng);
    const fw = String(shuffled.length).length;
    const findings = shuffled.map(({ f, index }, j) => {
      const opaque = "F" + pad(j + 1, fw);
      const pass = w.state?.record.pass ?? 0;
      entries.push({ packet: file, opaque, arm: w.state?.record.arm ?? "anchor", pass, finding: "p" + pass + "-" + (index + 1), state: w.state?.id ?? null, index });
      const text = mask(f.claim);
      for (const { rule, re } of rules) if (re.test(text) || (f.file && re.test(f.file))) problems.push((w.state ? "state " + w.state.id : "anchor " + w.unit.id + " " + w.anchor!.bug) + ", finding " + (index + 1) + ": its text names " + rule);
      return { id: opaque, path: f.file, line: f.line, text };
    });
    const bytes = json({ version: JUDGING_VERSION, suite: o.suite.id, unit: unitOf(w.unit), blockers: w.unit.blockers.map((b) => knownBlocker(o.suite, b)), findings });
    files.set(file, bytes);
    packets.push({ file, unit: w.unit.id, sha256: sha256(bytes), state: w.state?.id ?? null, anchor: w.anchor });
  });
  if (problems.length) blind("the packets would leak what blinding hides:\n" + problems.join("\n") + "\nthe Captain decides how the finding is masked");
  const head = { stage: "match" as const, suite: { id: o.suite.id, sha256: o.suiteSha256 }, seed: o.seed, states_sha256: o.statesSha256, mapping_sha256: mappingDigest({ packets, entries }), packets };
  const batch = batchDigest(head);
  const first = packets[0];
  files.set("batch.json", json({ version: JUDGING_VERSION, batch, suite: head.suite, judging_rule: o.suite.judging_rule, packets: packets.map((p) => ({ file: p.file, unit: p.unit, sha256: p.sha256 })), adjudication: "A second judge reads every blocker where the reviews' outcomes differ, plus a seeded " + SECOND_SAMPLE * 100 + "% sample of the rest; a third read answers every blocker where the two judges differ.", reply_format: { batch, judge: "<judge name and model>", packets: first ? [{ file: first.file, sha256: first.sha256, blockers: [{ id: "B1", matches: entries.filter((e) => e.packet === first.file).slice(0, 1).map((e) => e.opaque) }] }] : [] }, reply_rules: "One JSON reply per judge: batch, judge, and for each packet its file, its sha256 and every blocker you answer with the ids of the findings that name the same defect (an empty list when none does). Judge the defect, not the severity: severity is applied mechanically." }));
  const key: Key = { version: JUDGING_VERSION, ...head, batch, arms: [], entries };
  writeBatch(o.out, o.key, files, key);
  return { key, mechanical, gaps };
}

/** The head's code around a finding's line for an evidence sheet, or why there is none (R2's judge-run builds the same). */
export type CodeAt = (unit: Unit, path: string | null, line: number | null) => { code: { path: string; from: number; to: number; text: string } | null; code_note: string | null };

/** Batch 3: per state, its counted findings that map to CRITICAL and match no blocker, with an evidence sheet. */
export function writeAdjudicate(o: BatchInput & { judged: Judged; codeAt: CodeAt }): Key | null {
  const work: Array<{ unit: Unit; state: StateRef; items: Array<{ f: ToldFinding; index: number }> }> = [];
  for (const j of o.judged.states) {
    if (j.gap || j.mechanical) continue;
    const s = o.states.states.find((x) => x.id === j.id)!;
    const matched = new Set(Object.values(j.matches).flat());
    const items = j.findings.map((f, index) => ({ f, index })).filter(({ f, index }) => !matched.has(index) && severityOf(s.record.arm, o.maps[s.record.arm], f.severity, readerOf(f)) === "CRITICAL");
    if (items.length) work.push({ unit: o.suite.units.find((u) => u.id === s.record.unit)!, state: s, items });
  }
  if (!work.length) return null;
  const arms = r2Arms(o.maps, work.flatMap((w) => w.items.map(({ f }) => ({ arm: w.state.record.arm, unit: w.unit.id, pass: w.state.record.pass, f }))));
  const mask = masker(arms);
  const rules = leaks(arms);
  const rng = seededRandom(o.seed);
  const order = shuffle(work, rng);
  const width = String(order.length).length;
  const files = new Map<string, Buffer>();
  const packets: PacketRef[] = [];
  const entries: EntryRef[] = [];
  const problems: string[] = [];
  order.forEach((w, i) => {
    const name = "A" + pad(i + 1, width) + ".json";
    const file = "packets/" + name;
    const shuffled = shuffle(w.items, rng);
    const fw = String(shuffled.length).length;
    const shown = shuffled.map(({ f, index }, j) => {
      const opaque = "F" + pad(j + 1, fw);
      entries.push({ packet: file, opaque, arm: w.state.record.arm, pass: w.state.record.pass, finding: "p" + w.state.record.pass + "-" + (index + 1), state: w.state.id, index });
      const text = mask(f.claim);
      const evidence = mask(f.evidence);
      for (const { rule, re } of rules) if (re.test(text) || re.test(evidence) || (f.file && re.test(f.file))) problems.push("state " + w.state.id + ", finding " + (index + 1) + ": its text or evidence names " + rule);
      return { packet: { id: opaque, path: f.file, line: f.line, text }, sheet: { id: opaque, evidence, ...o.codeAt(w.unit, f.file, f.line) } };
    });
    const bytes = json({ version: JUDGING_VERSION, kind: "adjudicate", suite: o.suite.id, unit: unitOf(w.unit), known_informational: w.unit.blockers.filter((b) => b.counts === "over-blocking").map((b) => knownBlocker(o.suite, b)), findings: shown.map((x) => x.packet) });
    const sheet = json({ version: 1, packet: file, packet_sha256: sha256(bytes), findings: shown.map((x) => x.sheet) });
    files.set(file, bytes);
    files.set("sheets/" + name, sheet);
    packets.push({ file, unit: w.unit.id, sha256: sha256(bytes), state: w.state.id, anchor: null, sheet: { file: "sheets/" + name, sha256: sha256(sheet) } });
  });
  if (problems.length) blind("the adjudication packets would leak what blinding hides:\n" + problems.join("\n") + "\nthe Captain decides how the finding is masked");
  const head = { stage: "adjudicate" as const, suite: { id: o.suite.id, sha256: o.suiteSha256 }, seed: o.seed, states_sha256: o.statesSha256, mapping_sha256: mappingDigest({ packets, entries }), packets };
  const batch = batchDigest(head);
  files.set("batch.json", json({ version: JUDGING_VERSION, kind: "adjudicate", batch, suite: head.suite, packets: packets.map((p) => ({ file: p.file, unit: p.unit, sha256: p.sha256 })), adjudication: "A second judge rules every finding the primary rules not-defect or known-informational plus a seeded " + SECOND_SAMPLE * 100 + "% sample of the rest; a third read rules every finding where the two judges differ.", reply_format: { batch, judge: "<judge name and model>", packets: [{ file: packets[0]!.file, sha256: packets[0]!.sha256, findings: [{ id: "F1", ruling: "not-defect" }] }] }, reply_rules: "One JSON reply per judge: batch, judge, and for each packet its file, its sha256 and a ruling for every finding you rule: defect when it names a real defect at the PR head, not-defect when it does not, known-informational when it raises the unit's known informational case (known_informational) as a blocker. Judge the defect, not the severity: every finding here was raised as blocking." }));
  const key: Key = { version: JUDGING_VERSION, ...head, batch, arms: [], entries };
  writeBatch(o.out, o.key, files, key);
  return key;
}

/** Reads a key and checks it against its own digests and the suite. */
export function loadKey(path: string, suite: { id: string; sha256: string }, stage: Stage): Key {
  let key: Key;
  try {
    key = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    return blind("--key " + path + " is not readable JSON: " + (e as Error).message);
  }
  if (key.version !== JUDGING_VERSION || key.stage !== stage || !Array.isArray(key.packets) || !Array.isArray(key.entries)) blind("--key " + path + " is not a part C " + stage + " key of version " + JUDGING_VERSION);
  if (mappingDigest(key) !== key.mapping_sha256 || batchDigest(key) !== key.batch) blind("--key " + path + " does not hash to its own batch digest; it was edited or swapped");
  if (key.suite.id !== suite.id || key.suite.sha256 !== suite.sha256) blind("the batch was built on suite " + key.suite.id + " at " + key.suite.sha256 + ", not " + suite.id + " at " + suite.sha256);
  return key;
}

/** R2's JudgeKey view of a key, for R2's reply checks. */
const r2Key = (key: Key): JudgeKey => ({ version: key.version, batch: key.batch, suite: key.suite, arms: key.arms, seed: key.seed, mapping_sha256: key.mapping_sha256, packets: key.packets, entries: key.entries });

/** A reply file's packets, checked for batch, judge and digests (R2's readReplyFile). */
export function readReplyText(text: string, key: Key, role: string): { judge: string; digest: string; packets: Array<{ ref: PacketRef; body: Record<string, unknown> }> } {
  let r: { batch?: unknown; judge?: unknown; packets?: unknown };
  try {
    r = JSON.parse(text);
  } catch (e) {
    return bad("the " + role + " reply is not readable JSON: " + (e as Error).message);
  }
  if (r.batch !== key.batch) bad("the " + role + " reply names batch " + JSON.stringify(r.batch) + ", not " + key.batch);
  if (typeof r.judge !== "string" || !r.judge.trim() || /[\t\r\n]/.test(r.judge)) bad("the " + role + " reply needs a judge name on one line");
  if (!Array.isArray(r.packets)) bad("the " + role + " reply needs a packets list");
  const seen = new Set<string>();
  const packets = (r.packets as Array<Record<string, unknown>>).map((p) => {
    const ref = key.packets.find((k) => k.file === p.file) ?? bad("the " + role + " reply answers packet " + JSON.stringify(p.file) + ", which this batch does not have");
    if (p.sha256 !== ref.sha256) bad("the " + role + " reply's " + ref.file + " has digest " + JSON.stringify(p.sha256) + ", not " + ref.sha256);
    if (seen.has(ref.file)) bad("the " + role + " reply answers " + ref.file + " twice");
    seen.add(ref.file);
    return { ref, body: p };
  });
  return { judge: (r.judge as string).trim(), digest: sha256(text), packets };
}

/** One extraction answer: review-units' finding shape, cut to the first 15. */
export function extractAnswer(body: Record<string, unknown>): ToldFinding[] {
  if (!Array.isArray(body.findings)) bad("an extraction answer needs a findings list");
  const parsed = parseFinalTurn("~~~json\n" + JSON.stringify(body.findings) + "\n~~~");
  if (parsed.kind !== "findings") return bad("the extracted findings do not have review-units' finding shape: " + ("reason" in parsed ? parsed.reason : parsed.kind));
  return parsed.findings.slice(0, COUNTED_FINDINGS);
}

/** One matching answer, checked by R2's packetAnswers, keyed "<packet> <blocker id>". */
export function matchAnswer(key: Key, suite: Suite, ref: PacketRef, body: Record<string, unknown>, role: string): Map<string, Set<string>> {
  try {
    const got = packetAnswers(ref, { blockers: body.blockers }, r2Key(key), suite, role);
    return new Map([...got].map(([k, v]) => [ref.file + " " + k.slice(k.lastIndexOf(" ") + 1), v]));
  } catch (e) {
    return bad((e as Error).message);
  }
}

/** One adjudication answer, checked by R2's packetRulings, keyed "<packet> <opaque id>". */
export function ruleAnswer(key: Key, suite: Suite, ref: PacketRef, body: Record<string, unknown>, role: string): Map<string, Ruling> {
  try {
    return packetRulings(ref, { findings: body.findings }, r2Key(key), suite, role);
  } catch (e) {
    return bad((e as Error).message);
  }
}

/** The items a judge must answer in a packet: every blocker of a matching packet, every finding of an adjudication packet. */
export function packetItems(key: Key, suite: Suite, ref: PacketRef): string[] {
  if (key.stage === "adjudicate") return key.entries.filter((e) => e.packet === ref.file).map((e) => ref.file + " " + e.opaque);
  return suite.units.find((u) => u.id === ref.unit)!.blockers.map((b) => ref.file + " " + b.id);
}

/** A packet a judge's reply was refused twice for. */
export interface Unjudged {
  role: Role;
  packet: string;
  reason: string;
}

type Outcome = "F" | "D" | "M";

/** R2's outcome of one matching item: F when a matched finding maps to CRITICAL, D when it matched any other, M when none matched. */
function outcomeOf(key: Key, maps: Record<CArm, SeverityEntry>, counted: Counted, states: StatesFile, item: string, matches: Set<string>): Outcome {
  if (!matches.size) return "M";
  const file = item.slice(0, item.indexOf(" "));
  const ref = key.packets.find((p) => p.file === file)!;
  if (!ref.state) return "D";
  const s = states.states.find((x) => x.id === ref.state)!;
  const c = countedOf(s, counted)!;
  const sev = key.entries.filter((e) => e.packet === file && matches.has(e.opaque)).map((e) => severityOf(s.record.arm, maps[s.record.arm], c[e.index]!.severity, readerOf(c[e.index]!)));
  return sev.includes("CRITICAL") ? "F" : "D";
}

const sameSet = (a: Set<string> | undefined, b: Set<string> | undefined) => [...(a ?? [])].sort().join(",") === [...(b ?? [])].sort().join(",");

export interface ReadSets {
  /** Items the primary judged: every item of a packet it was not left unjudged on. */
  judged: string[];
  /** Items whose bug-pass differs under the primary. */
  differ: number;
  second: Set<string>;
  third: Set<string> | null;
  /** Items a role left unjudged, with the entry that left them. */
  dropped: Map<string, Unjudged>;
}

/**
 * The reads a batch needs. Matching: the second reads every item in a bug-pass (a unit's blocker at one pass) whose
 * outcomes differ across arms and states under the primary, counting a state with no counted finding as M, plus a seeded
 * 20% sample of the rest; an anchor is its own group. Adjudication: every finding the primary rules not-defect or
 * known-informational plus a seeded 20% sample of the rest. The third reads every item of the second set where the two differ.
 */
export function readSets(o: { key: Key; suite: Suite; states: StatesFile; counted: Counted; maps: Record<CArm, SeverityEntry>; mechanical: readonly string[]; primary: Map<string, Set<string> | Ruling>; second: Map<string, Set<string> | Ruling> | null; unjudged: readonly Unjudged[] }): ReadSets {
  const { key } = o;
  const dropped = new Map<string, Unjudged>();
  const left = (role: Role, item: string) => {
    const e = o.unjudged.find((x) => x.role === role && item.startsWith(x.packet + " "));
    if (e) dropped.set(item, e);
    return e !== undefined;
  };
  const all = key.packets.flatMap((p) => packetItems(key, o.suite, p));
  const judged = all.filter((k) => !left("primary", k));
  const missing = judged.filter((k) => !o.primary.has(k));
  if (missing.length) bad("the primary reply leaves " + missing.length + " items unanswered: " + missing.slice(0, 10).join(", "));
  let must: string[];
  if (key.stage === "adjudicate") must = judged.filter((k) => o.primary.get(k) !== "defect");
  else {
    const groupOf = (k: string) => {
      const file = k.slice(0, k.indexOf(" "));
      const ref = key.packets.find((p) => p.file === file)!;
      if (!ref.state) return k;
      const s = o.states.states.find((x) => x.id === ref.state)!;
      return s.record.unit + " " + k.slice(k.indexOf(" ") + 1) + " " + s.record.pass;
    };
    const outcomes = new Map<string, Set<Outcome>>();
    const add = (g: string, x: Outcome) => outcomes.set(g, new Set([...(outcomes.get(g) ?? []), x]));
    for (const k of judged) add(groupOf(k), outcomeOf(key, o.maps, o.counted, o.states, k, o.primary.get(k) as Set<string>));
    for (const id of o.mechanical) {
      const s = o.states.states.find((x) => x.id === id)!;
      for (const b of o.suite.units.find((u) => u.id === s.record.unit)!.blockers) add(s.record.unit + " " + b.id + " " + s.record.pass, "M");
    }
    must = judged.filter((k) => outcomes.get(groupOf(k))!.size > 1);
  }
  const mustSet = new Set(must);
  const rest = judged.filter((k) => !mustSet.has(k));
  const second = new Set([...must, ...seededShuffle(rest, key.seed + 1).slice(0, Math.ceil(SECOND_SAMPLE * rest.length))]);
  for (const k of [...second]) if (left("second", k)) second.delete(k);
  if (!o.second) return { judged, differ: must.length, second, third: null, dropped };
  const same = (k: string) => (key.stage === "adjudicate" ? o.second!.get(k) === o.primary.get(k) : sameSet(o.primary.get(k) as Set<string>, o.second!.get(k) as Set<string>));
  const third = new Set([...second].filter((k) => !same(k)));
  for (const k of [...third]) if (left("third", k)) third.delete(k);
  return { judged, differ: must.length, second, third, dropped };
}

/** The joined label of each judged item: the third read's where it read, else the primary's (R2's join). An item a required
 *  second or third read left unjudged gets no label, never the primary's: its state is a judging gap, its finding unadjudicated. */
export function joinLabels<T>(sets: ReadSets, primary: Map<string, T>, third: Map<string, T> | null): Map<string, T> {
  return new Map(sets.judged.filter((k) => !sets.dropped.has(k)).map((k) => [k, sets.third?.has(k) ? third!.get(k)! : primary.get(k)!]));
}

/** Cohen's kappa over paired labels; null when chance agreement is 1 or there are no pairs. */
export function kappa<T>(pairs: ReadonlyArray<readonly [T, T]>): number | null {
  if (!pairs.length) return null;
  const cats = [...new Set(pairs.flat())];
  const n = pairs.length;
  const po = pairs.filter(([x, y]) => x === y).length / n;
  const pe = cats.reduce((s, c) => s + (pairs.filter(([x]) => x === c).length / n) * (pairs.filter(([, y]) => y === c).length / n), 0);
  return pe < 1 ? Math.round(((po - pe) / (1 - pe)) * 1e4) / 1e4 : null;
}

/** One state's judgment after the joins. */
export interface JudgedState {
  id: string;
  findings: ToldFinding[];
  extracted: boolean;
  /** No counted finding: no packet, every blocker missed. */
  mechanical: boolean;
  /** Why the state has no judgment (a reply refused twice), or null. */
  gap: string | null;
  /** Per blocker id, the indices of the counted findings the joined matching label names. */
  matches: Record<string, number[]>;
  /** Per counted finding index, the joined ruling of an unmatched blocking finding; null until adjudication joins. */
  rulings: Record<string, Ruling> | null;
}

export interface Judged {
  version: number;
  route: string;
  batches: { extract: string | null; match: string; adjudicate: string | null };
  states: JudgedState[];
}

/** Builds each state's judgment from the joined matching labels. */
export function judgedStates(o: { key: Key; states: StatesFile; counted: Counted; mechanical: readonly string[]; gaps: readonly string[]; labels: Map<string, Set<string>>; dropped: Map<string, Unjudged>; route: string; extractBatch: string | null }): Judged {
  const out: JudgedState[] = [];
  for (const s of o.states.states) {
    const c = countedOf(s, o.counted);
    const base = { id: s.id, findings: c ?? [], extracted: s.record.no_block, mechanical: o.mechanical.includes(s.id), gap: null as string | null, matches: {} as Record<string, number[]>, rulings: null };
    if (o.gaps.includes(s.id)) {
      out.push({ ...base, gap: "the extraction reply was refused twice" });
      continue;
    }
    if (base.mechanical) {
      out.push(base);
      continue;
    }
    const ref = o.key.packets.find((p) => p.state === s.id)!;
    const drop = [...o.dropped].find(([k]) => k.startsWith(ref.file + " "));
    if (drop) {
      out.push({ ...base, gap: "the " + drop[1].role + " judge's matching reply for its packet was refused twice: " + drop[1].reason });
      continue;
    }
    const matches: Record<string, number[]> = {};
    for (const [k, set] of o.labels) {
      if (!k.startsWith(ref.file + " ")) continue;
      matches[k.slice(ref.file.length + 1)] = o.key.entries.filter((e) => e.packet === ref.file && set.has(e.opaque)).map((e) => e.index).sort((a, b) => a - b);
    }
    out.push({ ...base, matches });
  }
  return { version: JUDGING_VERSION, route: o.route, batches: { extract: o.extractBatch, match: o.key.batch, adjudicate: null }, states: out };
}

/** Adds the joined adjudication rulings to each state's judgment. A finding whose packet the primary left unjudged gets no ruling. */
export function addRulings(judged: Judged, key: Key | null, rulings: Map<string, Ruling>): Judged {
  const states = judged.states.map((j) => {
    if (j.gap || j.mechanical) return j;
    const r: Record<string, Ruling> = {};
    if (key) for (const e of key.entries.filter((x) => x.state === j.id)) {
      const v = rulings.get(e.packet + " " + e.opaque);
      if (v) r[String(e.index)] = v;
    }
    return { ...j, rulings: r };
  });
  return { ...judged, batches: { ...judged.batches, adjudicate: key?.batch ?? null }, states };
}
