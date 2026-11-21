// Copyright (c) 2026 Garry Tan. MIT License.
// The call plan for part C's judges (preregistration section 5.5), run against any sender: meter.ts's metered sender for
// a paid run, or a fake model in tests. It follows R2's judge-run (lanes/review-noloss/judge-run.ts): the brief, the
// batch's batch.json and one packet per request, and for adjudication the packet's evidence sheet; the primary reads
// every packet, the second and third read the packets that hold an item of the sets readSets names, and their replies
// keep only those items; the runner writes each reply's batch, judge, file and digest itself and takes only the answers
// from the model; an answer that its check refuses is asked again once, and a second refusal leaves the packet unjudged
// for that role. Extraction requests carry batch.json's extraction rule and the packet, without #108's brief, which is
// about matching and adjudication. Gold labellers read the packets of the judge check the same way the primary does.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ToldFinding } from "../../../../src/trial/review/findings.ts";
import type { Ruling } from "../../../review-noloss/contract.ts";
import { sha256, type Suite } from "../../../review-noloss/suite.ts";
import type { CArm } from "./frozen.ts";
import { extractAnswer, matchAnswer, packetItems, readSets, ruleAnswer, type Counted, type Key, type PacketRef, type ReadSets, type Role, type Unjudged } from "./judging.ts";
import type { StatesFile } from "./record.ts";
import type { SeverityEntry } from "./severity.ts";

/** One request to a judge model; it returns the model's answer text, or throws to stop the run. */
export type Send = (r: { role: string; model: string; file: string; prompt: string; attempt: number }) => Promise<string>;

/** The first JSON object in a model's answer, inside a markdown fence or not (as R2's judge-run reads it). */
export function firstObject(text: string): unknown {
  const start = text.indexOf("{");
  if (start < 0) throw new Error("the answer holds no JSON object");
  let depth = 0;
  let str = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (str) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') str = false;
    } else if (c === '"') str = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return JSON.parse(text.slice(start, i + 1));
  }
  throw new Error("the answer's first JSON object never closes");
}

export interface Batch {
  key: Key;
  dir: string;
  batchText: string;
  texts: Map<string, string>;
  sheets: Map<string, string>;
}

/** Reads a batch's packets and sheets, each checked against the key's digest. */
export function readBatch(dir: string, key: Key): Batch {
  const batchText = readFileSync(join(dir, "batch.json"), "utf8");
  if ((JSON.parse(batchText) as { batch?: unknown }).batch !== key.batch) throw new Error("E_CH_C_BLIND " + join(dir, "batch.json") + " is not the instructions of batch " + key.batch);
  const texts = new Map<string, string>();
  const sheets = new Map<string, string>();
  for (const p of key.packets) {
    const text = readFileSync(join(dir, p.file), "utf8");
    if (sha256(text) !== p.sha256) throw new Error("E_CH_C_BLIND " + join(dir, p.file) + " has changed since its batch was written");
    texts.set(p.file, text);
    if (p.sheet) {
      const s = readFileSync(join(dir, p.sheet.file), "utf8");
      if (sha256(s) !== p.sheet.sha256) throw new Error("E_CH_C_BLIND " + join(dir, p.sheet.file) + " has changed since its batch was written");
      sheets.set(p.file, s);
    }
  }
  return { key, dir, batchText, texts, sheets };
}

/** The prompt of one request, in R2's layout. */
export function promptFor(b: Batch, ref: PacketRef, brief: string): string {
  const head = b.key.stage === "extract" ? [] : ["=== Judge brief ===", brief];
  const sheet = b.sheets.get(ref.file);
  return [...head, "=== Instructions: batch.json ===", b.batchText, "=== Packet: " + ref.file + " ===", b.texts.get(ref.file)!, ...(sheet ? ["=== Evidence sheet: " + ref.file + " ===", sheet] : [])].join("\n");
}

type Got = Map<string, Set<string>> | Map<string, Ruling> | ToldFinding[];

/** Reads one answer for one packet: the packets entry for its file (or the only one), checked as the stage requires; a string is why it is refused. */
function check(b: Batch, suite: Suite, ref: PacketRef, answer: string, need: readonly string[], role: string): Got | string {
  let body: Record<string, unknown> | undefined;
  try {
    const list = (firstObject(answer) as { packets?: unknown } | null)?.packets;
    const entries = (Array.isArray(list) ? list : []) as Array<Record<string, unknown>>;
    body = entries.find((x) => x?.file === ref.file) ?? (entries.length === 1 ? entries[0] : undefined);
  } catch (e) {
    return (e as Error).message;
  }
  if (!body || typeof body !== "object") return "the answer has no packets entry for " + ref.file;
  try {
    if (b.key.stage === "extract") return extractAnswer(body);
    const got = b.key.stage === "adjudicate" ? ruleAnswer(b.key, suite, ref, body, role) : matchAnswer(b.key, suite, ref, body, role);
    const short = need.filter((k) => !got.has(k));
    return short.length ? "the answer leaves " + short.length + " of the " + need.length + " items it must answer unanswered: " + short.join(", ") : got;
  } catch (e) {
    return (e as Error).message;
  }
}

export interface RoleRun {
  model: string;
  /** Per packet, what the model answered, as checked. */
  got: Map<string, Got>;
}

/** Asks one model about a list of packets, with one retry each on a refused answer. */
async function askAll(o: { b: Batch; suite: Suite; brief: string; send: Send; role: string; model: string; jobs: Array<{ ref: PacketRef; need: string[] }>; concurrency: number; unjudged: Unjudged[] }): Promise<RoleRun> {
  const got = new Map<string, Got>();
  const queue = [...o.jobs];
  const one = async ({ ref, need }: { ref: PacketRef; need: string[] }) => {
    let reason = "";
    for (let attempt = 1; attempt <= 2; attempt++) {
      const answer = await o.send({ role: o.role, model: o.model, file: ref.file, prompt: promptFor(o.b, ref, o.brief), attempt });
      const r = check(o.b, o.suite, ref, answer, need, o.role);
      if (typeof r !== "string") {
        got.set(ref.file, r);
        return;
      }
      reason = r;
    }
    if (o.role === "primary" || o.role === "second" || o.role === "third") o.unjudged.push({ role: o.role, packet: ref.file, reason });
  };
  await Promise.all(Array.from({ length: Math.min(o.concurrency, queue.length) }, async () => {
    while (queue.length) await one(queue.shift()!);
  }));
  return { model: o.model, got };
}

const merged = (r: RoleRun) => new Map<string, Set<string> | Ruling>([...r.got.values()].flatMap((g): Array<[string, Set<string> | Ruling]> => (Array.isArray(g) ? [] : [...(g as Map<string, Set<string> | Ruling>)])));

/** A reply file as judge-join reads it: the runner writes batch, judge, file and digest; set limits the items kept. */
export function replyText(b: Batch, r: RoleRun, set: Set<string> | null): string {
  const id = (k: string) => k.slice(k.indexOf(" ") + 1);
  const packets = b.key.packets.flatMap((p): Array<Record<string, unknown>> => {
    const g = r.got.get(p.file);
    if (!g) return [];
    if (Array.isArray(g)) return [{ file: p.file, sha256: p.sha256, findings: g }];
    const ks = [...g.keys()].filter((k) => !set || set.has(k));
    if (!ks.length) return [];
    return [{ file: p.file, sha256: p.sha256, ...(b.key.stage === "adjudicate" ? { findings: ks.map((k) => ({ id: id(k), ruling: (g as Map<string, Ruling>).get(k) })) } : { blockers: ks.map((k) => ({ id: id(k), matches: [...(g as Map<string, Set<string>>).get(k)!] })) }) }];
  });
  return JSON.stringify({ batch: b.key.batch, judge: r.model, packets }, null, 2) + "\n";
}

export interface StageRun {
  replies: Partial<Record<Role, string>>;
  unjudged: Unjudged[];
  sets: ReadSets | null;
  requests: number;
}

/** Extraction: the production judge reads every packet. */
export async function runExtract(o: { b: Batch; suite: Suite; model: string; send: Send; concurrency?: number }): Promise<StageRun> {
  const unjudged: Unjudged[] = [];
  let requests = 0;
  const send: Send = (r) => (requests++, o.send(r));
  const primary = await askAll({ b: o.b, suite: o.suite, brief: "", send, role: "primary", model: o.model, jobs: o.b.key.packets.map((ref) => ({ ref, need: [] })), concurrency: o.concurrency ?? 4, unjudged });
  return { replies: { primary: replyText(o.b, primary, null) }, unjudged, sets: null, requests };
}

/** Matching or adjudication: primary on every packet, then the second set, then the third. */
export async function runJudged(o: { b: Batch; suite: Suite; brief: string; states: StatesFile; counted: Counted; maps: Record<CArm, SeverityEntry>; mechanical: readonly string[]; route: { primary: string; second: string; third: string }; send: Send; concurrency?: number }): Promise<StageRun> {
  const unjudged: Unjudged[] = [];
  let requests = 0;
  const send: Send = (r) => (requests++, o.send(r));
  const base = { b: o.b, suite: o.suite, brief: o.brief, send, concurrency: o.concurrency ?? 4, unjudged };
  const primary = await askAll({ ...base, role: "primary", model: o.route.primary, jobs: o.b.key.packets.map((ref) => ({ ref, need: packetItems(o.b.key, o.suite, ref) })) });
  const setsArgs = { key: o.b.key, suite: o.suite, states: o.states, counted: o.counted, maps: o.maps, mechanical: o.mechanical, unjudged };
  const jobsFor = (set: Set<string>) => o.b.key.packets.map((ref) => ({ ref, need: packetItems(o.b.key, o.suite, ref).filter((k) => set.has(k)) })).filter((j) => j.need.length);
  const first = readSets({ ...setsArgs, primary: merged(primary), second: null });
  const second = await askAll({ ...base, role: "second", model: o.route.second, jobs: jobsFor(first.second) });
  const mid = readSets({ ...setsArgs, primary: merged(primary), second: merged(second) });
  const third = await askAll({ ...base, role: "third", model: o.route.third, jobs: jobsFor(mid.third!) });
  const sets = readSets({ ...setsArgs, primary: merged(primary), second: merged(second) });
  const replies: StageRun["replies"] = { primary: replyText(o.b, primary, null), second: replyText(o.b, second, sets.second) };
  if (sets.third!.size) replies.third = replyText(o.b, third, sets.third);
  return { replies, unjudged, sets, requests };
}

/** Gold labels for the judge check: each labeller reads the named packets and answers every blocker. */
export async function runGold(o: { b: Batch; suite: Suite; brief: string; models: readonly string[]; files: readonly string[]; send: Send; concurrency?: number }): Promise<{ replies: Map<string, string>; unjudged: Array<Unjudged & { model: string }>; requests: number }> {
  const replies = new Map<string, string>();
  const missed: Array<Unjudged & { model: string }> = [];
  let requests = 0;
  const send: Send = (r) => (requests++, o.send(r));
  for (const model of o.models) {
    const unjudged: Unjudged[] = [];
    const jobs = o.b.key.packets.filter((p) => o.files.includes(p.file)).map((ref) => ({ ref, need: packetItems(o.b.key, o.suite, ref) }));
    const run = await askAll({ b: o.b, suite: o.suite, brief: o.brief, send, role: "primary", model, jobs, concurrency: o.concurrency ?? 4, unjudged });
    replies.set(model, replyText(o.b, run, null));
    missed.push(...unjudged.map((u) => ({ ...u, model })));
  }
  return { replies, unjudged: missed, requests };
}
