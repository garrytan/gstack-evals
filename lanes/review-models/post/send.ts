// Copyright (c) 2026 Garry Tan. MIT License.
// The pilot's paid post-run calls (wiki/plans/2026-11-24-geva-590-review-models-prereg, section 4's judge, the Judge
// check's labels and section 5's second read, with pre-run changes 1 and 2). Each command is one batch: it opens one lease on the
// ledger item the Captain recorded for it, through the cso lane's metered transport (lanes/outcome-skills/cso/judge/
// meter.ts, as src/trial/review/supply/visibility.ts uses it), sends what is not yet settled and settles the lease.
// - judgeSend: one Carbon call per bug-unit review that parsed with findings, built and read by score/judge.ts, whose
//   judgeReview sends an empty, cut-off, refused or unreadable reply once more as attempt 2 and then rules every finding
//   can't tell. A reply that is not HTTP 200 stops the batch (E_RM_JUDGE) with nothing ruled.
// - labelSend: the judge check's labels under pre-run change 9. Grok 4.7 reads each bug-unit review the check takes once,
//   in a seeded shuffle across arms, on the judge's own input for it, and answers change 6's question (score/labels.ts
//   labelPrompt). An empty, cut-off or unreadable reply is sent once more as attempt 2. A review Grok still can't label,
//   because it refused, the call failed (any reply that is not HTTP 200, or a transport error that is not a coded stop)
//   or both attempts failed to read, goes once to Kimi K3.1 Pro. A review neither labels is can't tell, with both
//   reasons kept. A review with no findings names nothing, so it is labelled no with no call. The labels land in
//   <post>/labels/final.json (final-<batch>.json for a batch other than the pilot) once every review has one.
// - secondReadSend: contamination.ts's blind second-read cases, each to the reader the case names (GPT-6.2 Astra for
//   Claude Code's searches, Opus 5.5 for the voice's), answering contaminated or clean, with the same one retry.
// Every reply goes to a jsonl file before the next send, and the meter keeps every answered request by digest, so a
// stopped batch reruns from where it stopped without paying twice. Nothing here holds a key: openJudgeMeter reads them by
// name and refuses before any lease when one is unset.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { judgeAnswer, JUDGE_ROUTE } from "../../../src/adapters/judge.ts";
import { isReasonCode } from "../../../src/errors/codes.ts";
import type { Provider } from "../../../src/runner/pricing/prices.ts";
import type { SecondReadCase } from "../../../src/trial/review/contamination.ts";
import { openJudgeMeter, type MeterOptions } from "../../outcome-skills/cso/judge/meter.ts";
import type { Transport } from "../../outcome-skills/cso/judge/client.ts";
import { seededShuffle } from "../../../src/trial/review/supply/b-units.ts";
import { ARMS, LABEL_SEED, LABELLERS, rmFail, type Arm } from "../score/frozen.ts";
import { CARBON_ROUTE, judgeReview, replyJson, type Bug, type Parsed, type ReviewFinding } from "../score/judge.ts";
import { labelPrompt, labellerRequest, labelRequest, parseLabel, type FinalRow, type LabelKey, type LabelModel, type Labeller } from "../score/labels.ts";
import type { Pilot } from "./pilot.ts";

export type SendOptions = Omit<MeterOptions, "out" | "item"> & { item: string };
export interface BatchResult {
  sent: number;
  spent_usd: number;
  unknown_usd: number;
}

const jsonl = <T>(path: string): T[] => (existsSync(path) ? readFileSync(path, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as T) : []);
const append = (path: string, v: unknown) => appendFileSync(path, JSON.stringify(v) + "\n");

/** One lease for one batch: the work runs on the meter's transport, and the lease settles whether the work ends or stops. */
async function batch<T>(dir: string, o: SendOptions, work: (t: Transport) => Promise<T>): Promise<T & BatchResult> {
  mkdirSync(dir, { recursive: true });
  const meter = await openJudgeMeter({ ...o, out: dir });
  let value: T | undefined, stopped: unknown = null;
  try {
    value = await work(meter.transport);
  } catch (e) {
    stopped = e;
  }
  const sent = meter.sent();
  const settled = await meter.close();
  if (stopped) throw stopped;
  return { ...value!, sent, spent_usd: settled.spent_micros / 1e6, unknown_usd: settled.unknown_micros / 1e6 };
}

/** Section 4's judge on every pilot bug-unit review that parsed. Reviews already in judged.jsonl are skipped. */
export async function judgeSend(pilot: Pilot, post: string, o: SendOptions): Promise<BatchResult & { judged: number; failed: number }> {
  const dir = join(post, "judge");
  const file = join(dir, "judged.jsonl");
  return batch(dir, o, async (transport) => {
    const done = new Set(jsonl<{ unit: string; arm: Arm }>(file).map((j) => j.arm + " " + j.unit));
    let judged = 0, failed = 0;
    for (const r of pilot.reviews) {
      if (r.pool === "decoy" || r.outcome !== "ok" || done.has(r.arm + " " + r.unit)) continue;
      const bug = pilot.bugs.get(r.unit) ?? rmFail("E_RM_POST_INPUT", "no bug in the key for unit " + r.label);
      const j = await judgeReview(bug, r.findings, (body, attempt) => transport({ provider: "openrouter", route: CARBON_ROUTE, body, attempt }));
      append(file, { unit: r.unit, arm: r.arm, label: r.label, judged: j });
      judged++;
      if (j.failed) failed++;
    }
    return { judged, failed };
  });
}

/** One review to label: the batch's own review with its bug, from the pilot now and the validation batch later. */
export interface BatchReview {
  id: string;
  /** The unit's opaque label, which reports name the review by. */
  label: string;
  unit: string;
  arm: Arm;
  pool: "P" | "B";
  bug: Bug;
  findings: readonly ReviewFinding[];
}

/** The reviews the check takes: bug units whose session ended ok, not contaminated, once contamination is settled. */
export function pilotBatch(pilot: Pilot): BatchReview[] {
  if (!pilot.contamination.read) rmFail("E_RM_POST_INPUT", "no contamination report in the post dir; run rm-post contamination first, since the check leaves contaminated reviews out");
  if (pilot.contamination.pending_cases) rmFail("E_RM_POST_INPUT", pilot.contamination.pending_cases + " doubtful search cases still wait on the second read; run rm-post second-read-send first");
  return pilot.reviews.filter((r) => r.pool !== "decoy" && r.outcome === "ok" && !r.contaminated).map((r) => ({ id: r.id, label: r.label, unit: r.unit, arm: r.arm, pool: r.pool as "P" | "B", bug: pilot.bugs.get(r.unit) ?? rmFail("E_RM_POST_INPUT", "no bug in the key for unit " + r.label), findings: r.findings }));
}

export const finalPath = (post: string, batch = "pilot") => join(post, "labels", batch === "pilot" ? "final.json" : "final-" + batch + ".json");

/** Change 9 item 2: the reviews sorted by arm and unit, then shuffled with the frozen seed, so the arms interleave. */
export const labelOrder = <T extends { arm: Arm; unit: string }>(reviews: readonly T[]): T[] =>
  seededShuffle([...reviews].sort((a, b) => ARMS.indexOf(a.arm) - ARMS.indexOf(b.arm) || (a.unit < b.unit ? -1 : a.unit > b.unit ? 1 : 0)), LABEL_SEED);

export interface LabelReply {
  id: string;
  who: LabelModel;
  attempt: number;
  /** 0 when the transport threw before any reply. */
  status: number;
  body: unknown;
  error?: string;
}

/** Why a label reply gives no label: a harness failure, refused, cut off, empty or unreadable. Null when it reads. */
export function labelProblem(r: LabelReply, n: number): string | null {
  const body = r.body as { error?: { message?: unknown }; choices?: Array<{ finish_reason?: string; message?: { refusal?: unknown } }> } | null;
  if (r.status !== 200) return "harness failure (" + (r.error ?? "HTTP " + r.status) + ")";
  if (body?.error) return "harness failure (" + String(body.error.message ?? "an error reply") + ")";
  const choice = body?.choices?.[0];
  if (choice?.finish_reason === "content_filter" || choice?.message?.refusal) return "refused";
  if (choice?.finish_reason === "length") return "cut off";
  const p = parseLabel(judgeAnswer("openrouter", r.body), n);
  return p.kind === "ok" ? null : p.kind === "empty" ? "empty" : "malformed: " + p.reason;
}

/** Empty, cut off and unreadable replies earn Grok one more attempt; a refusal or a harness failure goes to Kimi. */
const retried = (why: string) => why === "empty" || why === "cut off" || why.startsWith("malformed");

type LabelOutcome = Omit<FinalRow, keyof LabelKey>;

function answered(who: LabelModel, r: LabelReply, n: number): LabelOutcome {
  const p = parseLabel(judgeAnswer("openrouter", r.body), n);
  if (p.kind !== "ok") return rmFail("E_RM_LABELS", "a reply that read no longer reads");
  const { answer, reason } = p.value;
  return { label: Array.isArray(answer), ...(answer === "cant_tell" ? { cant_tell: true as const } : {}), answer, labeller: who, reason };
}

/** One review's next call, or its label, from the replies kept for it: Grok, Grok's one retry, Kimi once, then can't tell. */
export function labelStep(replies: readonly LabelReply[], n: number): { send: LabelModel; attempt: number } | { outcome: LabelOutcome } {
  const of = (who: LabelModel, attempt: number) => replies.find((r) => r.who === who && r.attempt === attempt);
  const g1 = of("grok", 1);
  if (!g1) return { send: "grok", attempt: 1 };
  const why1 = labelProblem(g1, n);
  if (!why1) return { outcome: answered("grok", g1, n) };
  let grok = why1;
  if (retried(why1)) {
    const g2 = of("grok", 2);
    if (!g2) return { send: "grok", attempt: 2 };
    const why2 = labelProblem(g2, n);
    if (!why2) return { outcome: answered("grok", g2, n) };
    grok = why1 + ", then " + why2;
  }
  const k = of("kimi", 1);
  if (!k) return { send: "kimi", attempt: 1 };
  const kimi = labelProblem(k, n);
  if (!kimi) return { outcome: { ...answered("kimi", k, n), fallback: "Grok: " + grok } };
  return { outcome: { label: false, cant_tell: true, answer: "cant_tell", labeller: "none", reason: "neither model labelled it", fallback: "Grok: " + grok + "; Kimi: " + kimi } };
}

export interface LabelTally {
  reviews: number;
  by: Record<LabelModel | "none", number>;
  cant_tell: number;
  per_arm: Partial<Record<Arm, { reviews: number; kimi: number; cant_tell: number; unlabelled: number }>>;
}

/** Labels counted by labeller, and per arm the Kimi fallbacks, the can't tells and the reviews neither model labelled. */
export function labelTally(rows: readonly FinalRow[]): LabelTally {
  const unlabelled = (r: FinalRow) => r.labeller === "none" && r.answer === "cant_tell";
  const per_arm: LabelTally["per_arm"] = {};
  for (const a of ARMS) {
    const xs = rows.filter((r) => r.arm === a);
    if (xs.length) per_arm[a] = { reviews: xs.length, kimi: xs.filter((r) => r.labeller === "kimi").length, cant_tell: xs.filter((r) => r.cant_tell).length, unlabelled: xs.filter(unlabelled).length };
  }
  return { reviews: rows.length, by: { grok: rows.filter((r) => r.labeller === "grok").length, kimi: rows.filter((r) => r.labeller === "kimi").length, none: rows.filter((r) => r.labeller === "none").length }, cant_tell: rows.filter((r) => r.cant_tell).length, per_arm };
}

/** Change 9's labels for one batch's reviews. Replies go to <post>/labels/<batch>/replies.jsonl before the next send, so a
 *  stopped batch resumes from them; a coded stop from the meter (a cap stop, provider drift) ends the batch with no labels
 *  written. */
export async function labelSend(reviews: readonly BatchReview[], post: string, batchName: string, o: SendOptions): Promise<BatchResult & LabelTally> {
  const dir = join(post, "labels", batchName);
  const file = join(dir, "replies.jsonl");
  return batch(dir, o, async (transport) => {
    const kept = jsonl<LabelReply>(file);
    const rows: FinalRow[] = [];
    for (const r of labelOrder(reviews)) {
      const key: LabelKey = { id: r.id, unit: r.unit, arm: r.arm, pool: r.pool };
      if (!r.findings.length) {
        rows.push({ ...key, label: false, answer: "none", labeller: "none", reason: "the review has no findings, so none names the bug" });
        continue;
      }
      const mine = kept.filter((x) => x.id === r.id);
      const prompt = labelPrompt(r.bug, r.findings);
      for (;;) {
        const step = labelStep(mine, r.findings.length);
        if ("outcome" in step) {
          rows.push({ ...key, ...step.outcome });
          break;
        }
        let reply: LabelReply;
        try {
          const res = await transport({ provider: "openrouter", route: JUDGE_ROUTE.openrouter, body: labelRequest(step.send, prompt), attempt: step.attempt });
          reply = { id: r.id, who: step.send, attempt: step.attempt, status: res.status, body: res.body };
        } catch (e) {
          const code = (e as { code?: unknown }).code;
          if (typeof code === "string" && isReasonCode(code)) throw e;
          reply = { id: r.id, who: step.send, attempt: step.attempt, status: 0, body: null, error: String((e as Error)?.message ?? e).slice(0, 300) };
        }
        append(file, reply);
        mine.push(reply);
      }
    }
    writeFileSync(finalPath(post, batchName), JSON.stringify(rows, null, 1) + "\n");
    return labelTally(rows);
  });
}

export interface Reply {
  phase: string;
  id: string;
  who: Labeller;
  attempt: number;
  status: number;
  body: unknown;
}

/** Why a 200 reply settles nothing: empty, cut off at its output cap, refused, or unreadable. Null when it reads. */
export function replyProblem(provider: Provider, body: any, read: (text: string) => Parsed<unknown>): string | null {
  if (provider === "anthropic" ? body?.stop_reason === "refusal" : (body?.output ?? []).some((i: any) => (i?.content ?? []).some((c: any) => c?.type === "refusal")) || body?.incomplete_details?.reason === "content_filter") return "refused";
  if (provider === "anthropic" ? body?.stop_reason === "max_tokens" : body?.incomplete_details?.reason === "max_output_tokens") return "cut off";
  const p = read(judgeAnswer(provider, body));
  return p.kind === "ok" ? null : p.kind === "empty" ? "empty" : "malformed: " + p.reason;
}

interface Job {
  phase: string;
  id: string;
  who: Labeller;
  body: Record<string, unknown>;
  read: (text: string) => Parsed<unknown>;
}

const replyKey = (r: { phase: string; id: string; who: string }) => r.phase + " " + r.id + " " + r.who;

/** The latest reply per job. */
function latest(replies: readonly Reply[]): Map<string, Reply> {
  const m = new Map<string, Reply>();
  for (const r of replies) if (!m.has(replyKey(r)) || m.get(replyKey(r))!.attempt <= r.attempt) m.set(replyKey(r), r);
  return m;
}

/** A job is settled once a reply reads, or once attempt 2 failed to. */
const settledReply = (j: Job, r: Reply | undefined) => !!r && r.status === 200 && (replyProblem(LABELLERS[j.who].provider, r.body, j.read) === null || r.attempt >= 2);

/** Sends every job with no settled reply: attempt 1, then attempt 2 once after a reply that does not read. A reply that is
 *  not HTTP 200 is recorded and stops the batch, so a rerun asks the same attempt again. */
async function sendJobs(jobs: readonly Job[], file: string, transport: Transport): Promise<number> {
  const last = latest(jsonl<Reply>(file));
  let sent = 0;
  for (const j of jobs) {
    let prev = last.get(replyKey(j));
    while (!settledReply(j, prev)) {
      const attempt = !prev ? 1 : prev.status !== 200 ? prev.attempt : prev.attempt + 1;
      const provider = LABELLERS[j.who].provider;
      const res = await transport({ provider, route: JUDGE_ROUTE[provider], body: j.body, attempt });
      prev = { phase: j.phase, id: j.id, who: j.who, attempt, status: res.status, body: res.body };
      append(file, prev);
      sent++;
      if (res.status !== 200) rmFail("E_RM_POST_SEND", j.phase + " read " + j.id + " by " + j.who + " answered HTTP " + res.status + "; the batch stopped with every reply so far kept, and a rerun resumes it");
    }
  }
  return sent;
}

/** The value a settled job's reply reads as, or null when both attempts failed. */
function valueOf<T>(j: Job, r: Reply | undefined): T | null {
  if (!r || r.status !== 200) return null;
  const p = j.read(judgeAnswer(LABELLERS[j.who].provider, r.body));
  return p.kind === "ok" ? (p.value as T) : null;
}

/** The prompt for one blind second-read case: the case's question, the markers and the logged attempt, as data. */
export function secondReadPrompt(c: SecondReadCase): string {
  const data = JSON.stringify({ markers: c.markers, attempt: c.attempt }, null, 2);
  return [c.question, "The markers and the logged search or fetch, as data:", "~~~json\n" + data + "\n~~~", 'Answer with one fenced json block and nothing after it:\n{"verdict": "contaminated", "reason": "one line"}\nverdict is "contaminated" or "clean".'].join("\n\n");
}

export function parseSecondRead(text: string): Parsed<{ verdict: "contaminated" | "clean"; reason: string }> {
  const j = replyJson(text);
  if (j.kind !== "ok") return j;
  const v = j.value as Record<string, unknown>;
  if (v?.verdict !== "contaminated" && v?.verdict !== "clean") return { kind: "malformed", reason: "verdict is not contaminated or clean" };
  return { kind: "ok", value: { verdict: v.verdict, reason: typeof v.reason === "string" ? v.reason : "" } };
}

const readerOf = (model: string): Labeller => (Object.keys(LABELLERS) as Labeller[]).find((w) => LABELLERS[w].model === model) ?? rmFail("E_RM_POST_INPUT", "no second reader route for " + model);

export function secondReadRequest(c: SecondReadCase): { who: Labeller; body: Record<string, unknown> } {
  const who = readerOf(c.reader);
  const prompt = secondReadPrompt(c);
  return { who, body: labellerRequest(who, prompt) };
}

/** Section 5's blind second read over second-read.jsonl; verdicts go to second-read-verdicts.jsonl (null when both attempts failed). */
export async function secondReadSend(post: string, o: SendOptions): Promise<BatchResult & { cases: number; contaminated: number; clean: number; failed: number }> {
  const dir = join(post, "contamination");
  const cases = jsonl<SecondReadCase>(join(dir, "second-read.jsonl"));
  if (!existsSync(join(dir, "second-read.jsonl"))) rmFail("E_RM_POST_INPUT", "no second-read.jsonl in " + dir + "; run rm-post contamination first");
  const file = join(dir, "second-read-replies.jsonl");
  return batch(dir, o, async (transport) => {
    const jobs = cases.map((c): Job => ({ phase: "second-read", id: c.case_id, ...secondReadRequest(c), read: parseSecondRead }));
    await sendJobs(jobs, file, transport);
    const last = latest(jsonl<Reply>(file));
    const verdicts = jobs.map((j) => {
      const v = valueOf<{ verdict: "contaminated" | "clean"; reason: string }>(j, last.get(replyKey(j)));
      return { case_id: j.id, verdict: v?.verdict ?? null, reason: v?.reason ?? "both attempts failed to read" };
    });
    writeFileSync(join(dir, "second-read-verdicts.jsonl"), verdicts.map((v) => JSON.stringify(v) + "\n").join(""));
    return { cases: cases.length, contaminated: verdicts.filter((v) => v.verdict === "contaminated").length, clean: verdicts.filter((v) => v.verdict === "clean").length, failed: verdicts.filter((v) => v.verdict === null).length };
  });
}

