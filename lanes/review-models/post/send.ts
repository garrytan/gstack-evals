// Copyright (c) 2026 Garry Tan. MIT License.
// The pilot's paid post-run calls (wiki/plans/2026-11-24-geva-590-review-models-prereg, section 4's judge, the Judge
// check's labels and section 5's second read, with pre-run changes 1 and 2). Each command is one batch: it opens one lease on the
// ledger item the Captain recorded for it, through the cso lane's metered transport (lanes/outcome-skills/cso/judge/
// meter.ts, as src/trial/review/supply/visibility.ts uses it), sends what is not yet settled and settles the lease.
// - judgeSend: one Carbon call per bug-unit review that parsed with findings, built and read by score/judge.ts, whose
//   judgeReview sends an empty, cut-off, refused or unreadable reply once more as attempt 2 and then rules every finding
//   can't tell. A reply that is not HTTP 200 stops the batch (E_RM_JUDGE) with nothing ruled.
// - The judge check's labels: people make them (pre-run changes 5 and 6), through desk.ts. No batch here asks a model
//   for a label.
// - secondReadSend: contamination.ts's blind second-read cases, each to the reader the case names (GPT-6.2 Astra for
//   Claude Code's searches, Opus 5.5 for the voice's), answering contaminated or clean, with the same one retry.
// Every reply goes to a jsonl file before the next send, and the meter keeps every answered request by digest, so a
// stopped batch reruns from where it stopped without paying twice. Nothing here holds a key: openJudgeMeter reads them by
// name and refuses before any lease when one is unset.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { judgeAnswer, JUDGE_ROUTE } from "../../../src/adapters/judge.ts";
import type { Provider } from "../../../src/runner/pricing/prices.ts";
import type { SecondReadCase } from "../../../src/trial/review/contamination.ts";
import { openJudgeMeter, type MeterOptions } from "../../outcome-skills/cso/judge/meter.ts";
import type { Transport } from "../../outcome-skills/cso/judge/client.ts";
import { LABELLERS, rmFail, type Arm } from "../score/frozen.ts";
import { CARBON_ROUTE, judgeReview, replyJson, type Parsed } from "../score/judge.ts";
import { labellerRequest, type Labeller } from "../score/labels.ts";
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

