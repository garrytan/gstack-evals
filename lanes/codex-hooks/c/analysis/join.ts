// Copyright (c) 2026 Garry Tan. MIT License.
// Reads the judges' reply files for part C's batches and joins them, the way R2's judge-join does: every reply is bound
// to the batch and each packet's digest; the second reply must answer exactly the items readSets names, and the third
// exactly the items where the two judges differ; a third read from a judge that already read is refused; the joined
// label is the third read's where it read, else the primary's. Extraction has one reply, the production judge's.
import type { ToldFinding } from "../../../../src/trial/review/findings.ts";
import type { Ruling } from "../../../review-noloss/contract.ts";
import type { Suite } from "../../../review-noloss/suite.ts";
import type { CArm } from "./frozen.ts";
import { extractAnswer, joinLabels, JudgingError, kappa, matchAnswer, readReplyText, readSets, ruleAnswer, type Counted, type Key, type ReadSets, type Unjudged } from "./judging.ts";
import type { StatesFile } from "./record.ts";
import type { SeverityEntry } from "./severity.ts";

const bad = (m: string): never => {
  throw new JudgingError("E_CH_C_REPLY", m);
};

/** Each extraction state's counted findings from the production judge's reply; a packet left unjudged maps to null. */
export function readExtraction(key: Key, text: string | null, unjudged: readonly Unjudged[]): Counted {
  const out: Counted = new Map();
  if (key.packets.length && text === null) bad("the extraction batch " + key.batch + " has " + key.packets.length + " packets and no reply");
  const r = text === null ? { packets: [] } : readReplyText(text, key, "extraction");
  for (const ref of key.packets) {
    const body = r.packets.find((p) => p.ref.file === ref.file)?.body;
    const left = unjudged.some((u) => u.packet === ref.file);
    if (!body && !left) bad("the extraction reply leaves " + ref.file + " unanswered and it is not recorded as unjudged");
    out.set(ref.state!, body ? (extractAnswer(body) as ToldFinding[]) : null);
  }
  return out;
}

type Labels<T> = Map<string, T>;

function readAll<T>(key: Key, suite: Suite, text: string, role: string, answer: (key: Key, suite: Suite, ref: Key["packets"][number], body: Record<string, unknown>, role: string) => Map<string, T>): { judge: string; labels: Labels<T> } {
  const r = readReplyText(text, key, role);
  const labels: Labels<T> = new Map();
  for (const { ref, body } of r.packets) for (const [k, v] of answer(key, suite, ref, body, role)) labels.set(k, v);
  return { judge: r.judge, labels };
}

function exactly(set: Set<string>, got: Labels<unknown>, role: string) {
  const extra = [...got.keys()].filter((k) => !set.has(k)).length;
  const short = [...set].filter((k) => !got.has(k));
  if (extra || short.length) bad("the " + role + " reply must answer exactly the " + set.size + " items the join names (" + short.length + " missing, " + extra + " extra): " + [...set].slice(0, 12).join(", "));
}

export interface Joined<T> {
  sets: ReadSets;
  primary: Labels<T>;
  labels: Labels<T>;
  judges: { primary: string; second: string; third: string | null };
  kappa_primary_second: number | null;
}

/** Joins a matching or adjudication batch's replies. */
export function joinReplies<T extends Set<string> | Ruling>(o: { key: Key; suite: Suite; states: StatesFile; counted: Counted; maps: Record<CArm, SeverityEntry>; mechanical: readonly string[]; primary: string; second: string; third: string | null; unjudged: readonly Unjudged[] }): Joined<T> {
  const answer = (o.key.stage === "adjudicate" ? ruleAnswer : matchAnswer) as unknown as (key: Key, suite: Suite, ref: Key["packets"][number], body: Record<string, unknown>, role: string) => Map<string, T>;
  const p = readAll<T>(o.key, o.suite, o.primary, "primary", answer);
  const args = { key: o.key, suite: o.suite, states: o.states, counted: o.counted, maps: o.maps, mechanical: o.mechanical, unjudged: o.unjudged };
  const first = readSets({ ...args, primary: p.labels as Map<string, Set<string> | Ruling>, second: null });
  const s = readAll<T>(o.key, o.suite, o.second, "second", answer);
  if (s.judge === p.judge) bad("the second reply is from " + s.judge + ", the primary judge; a second read needs another judge");
  exactly(first.second, s.labels, "second");
  const sets = readSets({ ...args, primary: p.labels as Map<string, Set<string> | Ruling>, second: s.labels as Map<string, Set<string> | Ruling> });
  let third: { judge: string; labels: Labels<T> } | null = null;
  if (sets.third!.size) {
    if (o.third === null) bad("the join waits for a third read on " + sets.third!.size + " items where the two judges differ");
    third = readAll<T>(o.key, o.suite, o.third!, "third", answer);
    if (third.judge === p.judge || third.judge === s.judge) bad("the third read is from " + third.judge + ", who already read these items; a third read needs a third judge");
    exactly(sets.third!, third.labels, "third");
  } else if (o.third !== null) bad("the two judges agree on every item, so there is no third read to join");
  const found = (v: T) => (v instanceof Set ? (v.size ? "match" : "none") : String(v));
  const k = kappa([...sets.second].map((x) => [found(p.labels.get(x)!), found(s.labels.get(x)!)] as const));
  return { sets, primary: p.labels, labels: joinLabels(sets, p.labels, third?.labels ?? null), judges: { primary: p.judge, second: s.judge, third: third?.judge ?? null }, kappa_primary_second: k };
}
