// Copyright (c) 2026 Garry Tan. MIT License.
// Adapted from lanes/aftermath/meter.ts at 5ee7f764232b196a1d0cec5b144a287b792f9c94 (build-devex-review-eval), itself generalized from lanes/product-value/meter.ts.
// The lane's metered client for direct model calls (authoring, audits, validators, judges, probes): one item's lease,
// held by the money controller, and that item's one metering proxy, one slot per call. Every call is admitted by the
// controller at the proxy's own worst case before it is bound, and settled from the local ledger's figures for its
// meter. Replies are cached on disk by model and request digest, so a resend or resumed run never pays twice for the
// same request (L3). An OpenRouter reply names its serving provider: the first call per model records it with the
// routing and data terms sent, and a provider other than the pin, or terms other than the dated record, is
// E_DC_PROVIDER_DRIFT, which stops every call on that model in every role for the Captain (PD-9).
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { judgeAnswer } from "../../../src/adapters/judge.ts";
import type { LocalLedger } from "../../../src/runner/ledger/local.ts";
import { chatPrice, openRouterRouting } from "../../../src/runner/pricing/prices.ts";
import type { BindRequest, Binding } from "../../../src/runner/proxy/metering-proxy.ts";
import { DcError } from "../errors.ts";
import type { AnyModel, LedgerItemId, Model } from "../types.ts";
import type { MoneyController } from "./book.ts";
import { DIRECT_MODELS, requestBody, ROUTE, worstCaseMicros } from "./price.ts";
import { applyStop, stopPlan } from "./stops.ts";
import type { Admission } from "./types.ts";
import { sha256 } from "./wal.ts";

/** The proxy seam: MeteringProxy from main satisfies it. */
export interface MeterProxy {
  readonly port: number;
  bind(request: BindRequest): Binding;
  finalize(meterId: string): Promise<unknown>;
  unbind(slot: string): void;
}

export interface CallRequest {
  model: AnyModel;
  prompt: string;
  maxTokens: number;
  effort?: string | null;
  /** A label for the journal's cell (never prompt text). */
  label: string;
  /** The model under test whose lists this call labels, if any. */
  subject?: Model | null;
  arm?: string | null;
  stage?: string | null;
  tag?: string | null;
}

export interface CallResult {
  text: string | null;
  status: number;
  micros: number | null;
  cached: boolean;
  problem: string | null;
  servedBy: string | null;
  /** Set when the controller did not admit the call; nothing was sent. */
  refused: Admission | null;
}

/** What the first call on a model records: its serving provider and the routing and data terms the proxy sends. */
export interface TermsLine {
  model: AnyModel;
  id: string;
  servedBy: string | null;
  routing: Record<string, unknown> | null;
  at: string;
}

export interface MeterOptions {
  controller: MoneyController;
  item: LedgerItemId;
  runId: string;
  /** The item's running proxy; renewal replaces it, so it is read per call. */
  proxy: () => MeterProxy;
  /** Spend and unknown charge per meter id on the item's open lease, from the local ledger. */
  figures: (meterId: string) => { spentMicros: number; unknownMicros: number };
  /** Holds the reply cache; it carries model output, so it sits on tmpfs for sealed work. */
  cacheDir: string;
  /** Holds terms.ndjson, the first call's provider and terms per model. */
  out: string;
  /** The dated terms record: the provider name each OpenRouter model must be served by, when it pins one. */
  datedTerms?: Partial<Record<AnyModel, string>>;
  fetch?: typeof fetch;
  now?: () => Date;
}

export const cacheKey = (model: AnyModel, body: Record<string, unknown>) => sha256(model + "\n" + JSON.stringify(body));

/** The local ledger's figures for one meter on the item's open lease. */
export const ledgerFigures = (local: LocalLedger, leaseId: () => string | null) => (meterId: string) => {
  const id = leaseId();
  const m = id ? local.meters(id).get(meterId) : undefined;
  return { spentMicros: m?.spent_micros ?? 0, unknownMicros: m?.unknown_micros ?? 0 };
};

export interface Meter {
  call(req: CallRequest): Promise<CallResult>;
  /** The terms each model's first call recorded. */
  terms(): TermsLine[];
}

export function openMeter(o: MeterOptions): Meter {
  const send = o.fetch ?? fetch;
  const now = o.now ?? (() => new Date());
  mkdirSync(o.cacheDir, { recursive: true, mode: 0o700 });
  mkdirSync(o.out, { recursive: true });
  const termsFile = join(o.out, "terms.ndjson");
  const terms = (): TermsLine[] => (existsSync(termsFile) ? readFileSync(termsFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as TermsLine) : []);
  const drift = async (model: AnyModel, why: string): Promise<never> => {
    await applyStop(o.controller, stopPlan("E_DC_PROVIDER_DRIFT", { model }));
    throw new DcError("E_DC_PROVIDER_DRIFT", why);
  };
  return {
    terms,
    async call(req) {
      const m = DIRECT_MODELS[req.model];
      const body = requestBody(req.model, req.prompt, req.maxTokens, req.effort);
      const file = join(o.cacheDir, cacheKey(req.model, body) + ".json");
      if (existsSync(file)) return { ...(JSON.parse(readFileSync(file, "utf8")) as CallResult), cached: true, micros: 0, refused: null };
      const worst = worstCaseMicros(m.provider, body);
      const admission = await o.controller.admitWhenReady(o.item, () => o.controller.admitCall(o.item, { run: req.label, model: req.model, worstCaseMicros: worst, subject: req.subject, arm: req.arm, stage: req.stage, tag: req.tag }));
      if (admission.kind !== "admitted") return { text: null, status: 0, micros: null, cached: false, problem: admission.kind + ": " + admission.why, servedBy: null, refused: admission };
      const sub = admission.sub;
      const p = o.proxy();
      const b = p.bind({ cell: { run_id: o.runId, arm: req.subject ? "dc:" + req.subject : "dc", task: req.label, model: m.id, trial: 1, attempt: 1 }, models: [m.provider + ":" + m.id], allowance_micros: worst });
      let status = 0;
      let text = "";
      try {
        const res = await send("http://127.0.0.1:" + p.port + "/" + b.slot + "/" + m.provider + ROUTE[m.provider], { method: "POST", headers: { authorization: "Bearer " + b.token, "content-type": "application/json", "anthropic-version": "2023-06-01" }, body: JSON.stringify(body) });
        status = res.status;
        text = await res.text();
      } finally {
        await p.finalize(b.meter_id);
        p.unbind(b.slot);
        const f = o.figures(b.meter_id);
        await o.controller.settle(sub.id, f);
      }
      const micros = o.figures(b.meter_id).spentMicros;
      let parsed: any = null;
      try {
        parsed = JSON.parse(text);
      } catch {}
      if (status !== 200) return { text: null, status, micros, cached: false, problem: typeof parsed?.code === "string" ? parsed.code + ": " + (parsed.detail ?? "") : "HTTP " + status, servedBy: null, refused: null };
      const servedBy = m.provider === "openrouter" ? (typeof parsed?.provider === "string" ? parsed.provider : null) : m.provider;
      const listed = chatPrice(m.provider + ":" + m.id);
      const routing = m.provider === "openrouter" && listed ? (openRouterRouting(listed) as Record<string, unknown>) : null;
      if (!terms().some((t) => t.model === req.model)) appendFileSync(termsFile, JSON.stringify({ model: req.model, id: m.id, servedBy, routing, at: now().toISOString() } satisfies TermsLine) + "\n");
      if (m.served_by && (servedBy === null || !m.served_by.test(servedBy))) await drift(req.model, m.id + " was served by " + (servedBy ?? "an unnamed provider") + ", not its pinned provider; every call on " + req.model + " stops for the Captain");
      const dated = o.datedTerms?.[req.model];
      if (dated !== undefined && servedBy !== dated) await drift(req.model, m.id + " was served by " + servedBy + ", but the dated terms record names " + dated + "; every call on " + req.model + " stops for the Captain");
      const result: CallResult = { text: parsed ? judgeAnswer(m.provider, parsed) : null, status, micros, cached: false, problem: parsed ? null : "the reply is not JSON", servedBy, refused: null };
      if (result.text !== null) {
        writeFileSync(file + ".tmp", JSON.stringify(result), { mode: 0o600 });
        renameSync(file + ".tmp", file);
      }
      return result;
    },
  };
}
