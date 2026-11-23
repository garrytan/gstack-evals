// Copyright (c) 2026 Garry Tan. MIT License.
// The paid path of part C's judging: a sender (run.ts's Send) that puts each judge request through an in-process
// metering proxy on a lease of the judge ledger item, the way R2's judge-run sends (lanes/review-noloss/judge-run.ts):
// no tools, no system prompt, at most 16,000 output tokens, OpenAI at JUDGE_REASONING_EFFORT, R2's retry budget of 3
// sends within 900 s for a 429 or 5xx, and any other refusal stopping the run. Every model must pass judge-policy.json.
// One run id spends from the judge item across every judge step, since a ledger item binds to one run (section 11 holds
// one judge item for the pilot check, the counted judging and the confirmation). The dry run prices each request's worst
// case and, on a temporary ledger, opens and settles one lease on the item. Tests drive it with a fake upstream.
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { JUDGE_REASONING_EFFORT, JUDGE_ROUTE, judgeAnswer, judgeRequest } from "../../../../src/adapters/judge.ts";
import { CODES, type ReasonCode } from "../../../../src/errors/codes.ts";
import { openLease, recordApproval, settleLease } from "../../../../src/runner/ledger/ledger.ts";
import { openLocalLedger } from "../../../../src/runner/ledger/local.ts";
import { usd } from "../../../../src/runner/ledger/money.ts";
import { ledgerPath } from "../../../../src/runner/ledger/paths.ts";
import { readItem } from "../../../../src/runner/ledger/record.ts";
import { chatPrice, openRouterRouting, priceRequest, reservationMicros, type Provider } from "../../../../src/runner/pricing/prices.ts";
import { MeteringProxy, reconcileJournal } from "../../../../src/runner/proxy/metering-proxy.ts";
import { rigAdmission } from "../../../../src/rig/admission.ts";
import { loadPolicy, modelProblem, providerOf } from "../../../../src/skill-eval/cli/policy.ts";
import { JUDGE_RETRY } from "../../../review-noloss/judge-run.ts";
import { JUDGE_ITEM } from "./frozen.ts";
import type { Send } from "./run.ts";

export const MAX_OUTPUT_TOKENS = 16000;
export const JUDGE_POLICY = join(import.meta.dir, "judge-policy.json");
const KEY_ENV: Record<Provider, string> = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY", openrouter: "OPENROUTER_API_KEY" };

export class JudgeStop extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(code + " " + message);
  }
}

export interface JudgeModel {
  id: string;
  provider: Provider;
  model: string;
}

/** A judge id, provider/model, checked against judge-policy.json for its role. */
export function judgeModel(id: string, role: "judge" | "adjudicator", policyPath = JUDGE_POLICY): JudgeModel {
  const provider = id.slice(0, id.indexOf("/")) as Provider;
  const model = id.slice(id.indexOf("/") + 1);
  if (!Object.hasOwn(KEY_ENV, provider) || !model) throw new JudgeStop("E_USAGE", "a judge is <provider>/<model> with provider anthropic, openai or openrouter, not " + JSON.stringify(id));
  const policy = loadPolicy(policyPath);
  if ("problem" in policy) throw new JudgeStop("E_MODEL_POLICY", policy.problem);
  const problem = modelProblem(policy, model, role, { smoke: false });
  if (problem) throw new JudgeStop("E_MODEL_POLICY", problem);
  if (providerOf(policy, model) !== provider) throw new JudgeStop("E_MODEL_POLICY", model + " runs on " + providerOf(policy, model) + " under the policy, not " + provider);
  return { id, provider, model };
}

export const requestBody = (m: JudgeModel, prompt: string) => judgeRequest(m.provider, m.model, prompt, MAX_OUTPUT_TOKENS, m.provider === "openai" ? JUDGE_REASONING_EFFORT : undefined);

/** The body the proxy prices: R2's asProxied, so the dry run's worst case is never under the proxy's. */
function asProxied(provider: Provider, body: Record<string, unknown>): Record<string, unknown> {
  if (provider === "anthropic") return { ...body, inference_geo: "global" };
  if (provider === "openai") return { ...body, service_tier: "default" };
  return { ...body, provider: openRouterRouting(chatPrice("openrouter:" + body.model)!) };
}

/** One request's worst case in micros: its reservation at every send the retry budget allows. */
export const worstCaseMicros = (m: JudgeModel, prompt: string) => reservationMicros(priceRequest(m.provider, asProxied(m.provider, requestBody(m, prompt)), MAX_OUTPUT_TOKENS)) * JUDGE_RETRY.attempts;

export interface MeterOptions {
  item: string;
  /** The one run id that spends from the item across every judge step. */
  runId: string;
  record: string;
  ledger: string;
  out: string;
  models: JudgeModel[];
  env: Record<string, string | undefined>;
  fetch?: (input: string, init: RequestInit) => Promise<Response>;
  sleep?: (ms: number) => Promise<void>;
  warn?: (code: ReasonCode, message: string) => void;
}

/**
 * Opens a lease of the item, starts the proxy and runs body with a metered sender; then stops the proxy, reconciles its
 * journal and settles the lease, whatever body did. Raw answers go to out/raw/<role>/<packet>.<model>.<attempt>.txt.
 */
export async function withMeteredJudges<T>(o: MeterOptions, body: (send: Send) => Promise<T>): Promise<{ value: T; requests: number; lease_id: string }> {
  const missing = [...new Set(o.models.map((m) => KEY_ENV[m.provider]))].filter((k) => !o.env[k]);
  if (missing.length) throw new JudgeStop("E_KEY_MISSING", "the judges need " + missing.join(" and ") + ", which " + (missing.length > 1 ? "are" : "is") + " not set");
  const warn = o.warn ?? (() => {});
  const local = openLocalLedger(ledgerPath(o.ledger, o.env));
  let lease: { lease_id: string; reserved_micros: number };
  try {
    lease = openLease(o.record, local, { item: o.item, run_id: o.runId, warn, requireAdmission: rigAdmission({ proof: "direct" }) });
  } catch (e) {
    local.close();
    throw e;
  }
  mkdirSync(o.out, { recursive: true });
  const journal = join(o.out, "journal-" + randomBytes(4).toString("hex") + ".ndjson");
  let proxy: MeteringProxy | undefined;
  let requests = 0;
  const byId = new Map(o.models.map((m) => [m.id, m]));
  const send: Send = async (r) => {
    const m = byId.get(r.model) ?? (() => {
      throw new JudgeStop("E_USAGE", "judge " + r.model + " is not one this run opened its lease for");
    })();
    const binding = proxy!.bind({ cell: { run_id: o.runId, arm: r.role, task: r.file, model: m.model, trial: 1, attempt: r.attempt }, models: [m.provider + ":" + m.model], allowance_micros: lease.reserved_micros });
    let res: Response;
    let text: string;
    try {
      requests++;
      res = await fetch("http://127.0.0.1:" + proxy!.port + "/" + binding.slot + "/" + m.provider + JUDGE_ROUTE[m.provider], { method: "POST", headers: { authorization: "Bearer " + binding.token, "content-type": "application/json" }, body: JSON.stringify(requestBody(m, r.prompt)), timeout: false } as RequestInit);
      text = await res.text();
    } finally {
      await proxy!.finalize(binding.meter_id);
      proxy!.unbind(binding.slot);
    }
    let answer: string | null = null;
    try {
      answer = judgeAnswer(m.provider, JSON.parse(text));
    } catch {
      answer = null;
    }
    const raw = join(o.out, "raw", r.role, basename(r.file, ".json") + "." + m.id.replace(/[^A-Za-z0-9.-]+/g, "_") + "." + r.attempt + ".txt");
    mkdirSync(dirname(raw), { recursive: true });
    writeFileSync(raw, res.status === 200 && answer !== null ? answer : text);
    if (res.status !== 200) {
      const problem = (res.headers.get("content-type") ?? "").includes("application/problem+json") ? (JSON.parse(text) as { code?: string; detail?: string }) : null;
      const code = problem?.code && Object.hasOwn(CODES, problem.code) ? problem.code : "UPSTREAM";
      throw new JudgeStop(code, "the " + r.role + " judge (" + m.id + ") on " + r.file + ": " + (problem?.detail ?? "the provider answered HTTP " + res.status) + "; the judge step stops, so start it again with a fresh --out");
    }
    return answer ?? "";
  };
  try {
    proxy = new MeteringProxy({ ledger: local, leaseId: lease.lease_id, host: "127.0.0.1", managementSocket: join(tmpdir(), "gse-chc-" + randomBytes(6).toString("hex") + ".sock"), managementToken: randomBytes(24).toString("hex"), journal, retry: JUDGE_RETRY, env: o.env, fetch: o.fetch, sleep: o.sleep, maxOutputTokens: MAX_OUTPUT_TOKENS });
    proxy.start();
    const value = await body(send);
    return { value, requests, lease_id: lease.lease_id };
  } finally {
    proxy?.stop();
    try {
      try {
        const reconciled = await reconcileJournal(journal, local);
        for (const r of reconciled.refused) warn(r.code as ReasonCode, "reconciling reservation " + (r.reservation_id ?? "(a lost reserve)") + " was refused: " + r.message);
      } finally {
        settleLease(o.record, local, lease.lease_id, warn);
      }
    } finally {
      local.close();
    }
  }
}

/** The dry run of the judge item: on a temporary ledger, record the item at its cap, open one lease under the run id and settle it at $0. */
export function judgeItemDryRun(runId: string): { item: string; cap: string; lease_id: string; settled: string; committed: string } {
  const dir = mkdtempSync(join(tmpdir(), "chc-judge-dry-"));
  try {
    const record = join(dir, "record");
    recordApproval(record, { action: "init", item: JUDGE_ITEM.item, cap_micros: JUDGE_ITEM.cap_usd * 1_000_000, quotes: [{ words: "dry run of the judge item at its planned cap", by: "codex-hooks c analysis judge-item", source: "lanes/codex-hooks/c/analysis/meter.ts" }], admission: "warn" });
    const local = openLocalLedger(ledgerPath(join(dir, "ledger.sqlite")));
    try {
      const lease = openLease(record, local, { item: JUDGE_ITEM.item, run_id: runId, warn: () => {}, requireAdmission: rigAdmission({ proof: "direct" }) });
      const close = settleLease(record, local, lease.lease_id, () => {});
      const state = readItem(record, JUDGE_ITEM.item);
      return { item: JUDGE_ITEM.item, cap: usd(state.cap_micros!), lease_id: lease.lease_id, settled: close.how + " at " + usd(close.spent_micros), committed: usd(state.committed_micros) };
    } finally {
      local.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
