// Copyright (c) 2026 Garry Tan. MIT License.
// The paid seams' dry-run cases (plan section 5, L1 to L7; addendum R2-4, R2-8; PD-9; start rule 9). Each runs the real
// callers and session proxies on main's ledger and the real metering proxy in a temporary directory, behind a scripted
// upstream that answers like each provider. Nothing reads a key or reaches a network: the proxies get invented key
// strings by name and a fetch that answers from memory.
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readItem } from "../../../src/runner/ledger/record.ts";
import { LocalLedger } from "../../../src/runner/ledger/local.ts";
import { reconcileJournal } from "../../../src/runner/proxy/metering-proxy.ts";
import { DcError } from "../errors.ts";
import { $ } from "../money/book.ts";
import { DirTarget, latestSnapshot, ownerReconcile, recover, replayReserves, restoreLedgerFile, takeSnapshot } from "../money/durability.ts";
import { QUOTE, withRig, expectations, admitted, type Rig } from "../money/dryrun-fixture.ts";
import { mainLeases } from "../money/ledger-main.ts";
import { DIRECT_MODELS, requestBody, worstCaseMicros } from "../money/price.ts";
import { renew } from "../money/renewal.ts";
import { ProviderWatch } from "../money/served.ts";
import type { OffHostTarget } from "../money/types.ts";
import { startRule9 } from "../read/start.ts";
import { CapStopSignal } from "../stage3/seams.ts";
import type { AnyModel, DryRunCase, LedgerItemId } from "../types.ts";
import { DirectCallers, PaidCallFailed } from "./direct.ts";
import { datedTermsOf, firstCallOf, pinRecord, probePlan, termsRecordsOf } from "./pin.ts";
import { scripted, type Reply, type Scripted } from "./scripted.ts";
import { generationResolver, inProcessLauncher, SessionProxies, type SessionBinding } from "./sessions.ts";

export const FAKE_KEYS = { ANTHROPIC_API_KEY: "dry-run-not-a-key-anthropic", OPENAI_API_KEY: "dry-run-not-a-key-openai", OPENROUTER_API_KEY: "dry-run-not-a-key-openrouter" };
const RETRY = { attempts: 2, elapsed_ms: 60_000 };
const noSleep = async () => {};
/** The provider names the scripted OpenRouter upstream gives each pin. */
export const SERVED: Record<string, string> = { "openai/gpt-6.1-sol": "OpenAI", "particle-ai/particle-1": "Particle", "google/gemini-4-argon": "Google Vertex" };
const pinnedReply = (o: Partial<Extract<Reply, { kind: "ok" }>> = {}) => (_url: string, body: any): Reply => ({ kind: "ok", provider: SERVED[String(body?.model)] ?? "OpenAI", ...o });

export interface PaidRig {
  r: Rig;
  up: Scripted;
  watch: ProviderWatch;
  direct: DirectCallers;
  sessions: SessionProxies;
}

/** A money rig with its write-ahead copy, one watch, the real callers and session proxies on one scripted upstream. */
export async function withPaid(o: { script?: Parameters<typeof scripted>[0]; generation?: (id: string) => string | null; resolveVia?: LedgerItemId; target?: OffHostTarget; caps?: Partial<Record<LedgerItemId, number>> }, fn: (p: PaidRig) => Promise<string | null>): Promise<string | null> {
  return withRig({ wal: true, target: o.target, caps: o.caps }, async (r) => {
    const up = scripted(o.script ?? pinnedReply(), { generation: o.generation });
    const watch = new ProviderWatch({ controller: r.c, out: join(r.dir, "out") });
    const upstream = (u: string, i: RequestInit) => up.fetch(u, i);
    const direct = new DirectCallers({ controller: r.c, local: r.local, wal: r.wal!, watch, dir: join(r.dir, "proxies"), cacheDir: join(r.dir, "cache"), retry: RETRY, env: FAKE_KEYS, fetch: upstream, sleep: noSleep });
    const resolve = o.resolveVia ? (id: string) => generationResolver(direct.proxy(o.resolveVia!), r.c.runId)(id) : undefined;
    const sessions = new SessionProxies({ controller: r.c, local: r.local, wal: r.wal!, watch, dir: join(r.dir, "sessions"), launcher: inProcessLauncher({ local: r.local, retry: RETRY, env: FAKE_KEYS, fetch: upstream, sleep: noSleep }), resolve });
    try {
      return await fn({ r, up, watch, direct, sessions });
    } finally {
      direct.stopAll();
      await sessions.stopAll();
    }
  });
}

/** One call as Claude Code makes it through its slot: Anthropic Messages on the provider the slot names. */
export async function sessionCall(b: SessionBinding, o: { stream?: boolean; maxTokens?: number } = {}): Promise<Response> {
  const model = b.model.slice(b.model.indexOf(":") + 1);
  const res = await fetch(b.baseUrl + "/v1/messages", { method: "POST", headers: { authorization: "Bearer " + b.token, "content-type": "application/json", "anthropic-version": "2023-06-01" }, body: JSON.stringify({ model, max_tokens: o.maxTokens ?? 4000, stream: o.stream ?? false, messages: [{ role: "user", content: "review the plan" }] }) });
  await res.text();
  return res;
}

export const journalLines = (path: string | null) => (path && existsSync(path) ? readFileSync(path, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, any>) : []);
const codeOf = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
    return "no error";
  } catch (e) {
    return e instanceof DcError ? e.code : e instanceof CapStopSignal ? "cap-stop" : e instanceof PaidCallFailed ? "failed" : (e as Error).message;
  }
};
const HOST: Record<string, string> = { anthropic: "https://api.anthropic.com/v1/messages", openai: "https://api.openai.com/v1/responses", openrouter: "https://openrouter.ai/api/v1/chat/completions" };

/** Fixture endpoints reads, shaped like OpenRouter's endpoints API (invented prices at each row's list price). */
export function endpointsFixture(model: AnyModel, o: { extra?: Array<{ tag: string; provider_name: string; prompt: string; completion: string }>; drop?: boolean } = {}): string {
  const rows: Record<string, Array<{ tag: string; provider_name: string; prompt: string; completion: string }>> = {
    sol: [{ tag: "openai", provider_name: "OpenAI", prompt: "0.000002", completion: "0.00001" }, { tag: "azure", provider_name: "Azure", prompt: "0.000002", completion: "0.00001" }],
    particle: [{ tag: "particle-ai", provider_name: "Particle", prompt: "0.0000001", completion: "0.000001" }],
    argon: [{ tag: "google-vertex/global", provider_name: "Google Vertex", prompt: "0.000002", completion: "0.00001" }, { tag: "google-vertex/us", provider_name: "Google Vertex", prompt: "0.0000025", completion: "0.000015" }, { tag: "google-ai-studio", provider_name: "Google AI Studio", prompt: "0.000002", completion: "0.00001" }],
  };
  const list = [...(o.drop ? [] : rows[model] ?? []), ...(o.extra ?? [])];
  return JSON.stringify({ data: { id: DIRECT_MODELS[model].id, endpoints: list.map((e) => ({ name: e.provider_name + " | " + DIRECT_MODELS[model].id, tag: e.tag, provider_name: e.provider_name, pricing: { prompt: e.prompt, completion: e.completion }, status: 0 })) } });
}

const COMMIT = "0".repeat(40);
const goodReads = () => ({ sol: endpointsFixture("sol"), particle: endpointsFixture("particle"), argon: endpointsFixture("argon") });

export function cases(): DryRunCase[] {
  return [
    {
      rule: "L1",
      name: "each direct route is admitted at the proxy's own reserve before anything is sent, reaches its provider with its key by name, and settles from the proxy's figures",
      check: () =>
        withPaid({}, async ({ r, up, direct }) => {
          const e = expectations();
          const item: LedgerItemId = "dc-authoring-1";
          await r.c.openItem(item);
          const held: number[] = [];
          const send = up.fetch;
          up.fetch = async (url, init) => {
            held.push(r.c.figures(item).inFlightMicros);
            return send(url, init);
          };
          for (const [i, model] of (["opus", "astra", "sol", "particle", "argon"] as AnyModel[]).entries()) {
            const m = DIRECT_MODELS[model];
            const worst = worstCaseMicros(m.provider, requestBody(model, "write unit " + i, 8000, "high"));
            const text = await direct.author(item)({ model: model as never, effort: "high", maxTokens: 8000, prompt: "write unit " + i, label: "u" + i + ":author:" + model + ":1" });
            const sub = r.c.subsOf(item).at(-1)!;
            const sent = up.sent.at(-1)!;
            const meter = journalLines(direct.journal(item)).filter((l) => l.kind === "reserve").at(-1)!;
            const spent = r.local.meters(r.c.lease(item)!.leaseId).get(meter.cell.meter_id)!.spent_micros;
            e.want(text.text === "ok", model + " read " + JSON.stringify(text));
            e.want(sub.reserveMicros === worst && meter.max_micros <= worst && held.at(-1)! >= worst, model + ": reserve " + sub.reserveMicros + ", proxy " + meter.max_micros + ", held at send " + held.at(-1));
            e.want(sub.state === "settled" && sub.spentMicros === spent && spent > 0, model + ": settled " + sub.spentMicros + " against the proxy's " + spent);
            e.want(sent.url === HOST[m.provider], model + " reached " + sent.url);
            const key = m.provider === "anthropic" ? sent.headers["x-api-key"] : sent.headers["authorization"];
            e.want(key !== undefined && key.endsWith(FAKE_KEYS[(m.provider.toUpperCase() + "_API_KEY") as keyof typeof FAKE_KEYS]), model + " carried no key by name");
            if (m.provider === "openrouter") e.want(sent.body.provider?.allow_fallbacks === false && sent.body.provider?.data_collection === "deny" && Array.isArray(sent.body.provider?.only), model + " was sent without its pinned routing");
          }
          e.want(r.c.figures(item).inFlightCount === 0, "a call is still in flight");
          return e.result();
        }),
    },
    {
      rule: "L1",
      name: "provider errors settle as the proxy records them: a 400 at $0, a 429 paused and resent, a 5xx with no usage at its full reservation",
      check: () =>
        withPaid({ script: [{ kind: "status", status: 400 }, { kind: "status", status: 429, retryAfterS: 1 }, { kind: "ok", provider: "OpenAI" }, { kind: "status", status: 503 }] }, async ({ r, up, direct }) => {
          const e = expectations();
          const item: LedgerItemId = "dc-judges";
          await r.c.openItem(item);
          const judge = direct.judge(item);
          const call = (label: string) => judge({ judge: "opus", prompt: "label packet " + label, effort: "medium", maxTokens: 16000, label, subject: "sol", cacheKey: label });
          const bad = await call("p1");
          const s1 = r.c.subsOf(item)[0]!;
          e.want(bad.text === null && /400/.test(bad.problem ?? "") && s1.state === "settled" && s1.spentMicros === 0, "a 400 read " + JSON.stringify(bad) + " and settled " + s1.spentMicros);
          const ok = await call("p2");
          const s2 = r.c.subsOf(item)[1]!;
          e.want(ok.text === "ok" && up.sent.length === 3 && s2.spentMicros > 0, "the 429 was not resent once and answered: " + up.sent.length + " sent");
          const lost = await call("p3");
          const s3 = r.c.subsOf(item)[2]!;
          e.want(lost.text === null && s3.state === "settled" && s3.spentMicros === s3.reserveMicros, "a 5xx with no usage settled " + s3.spentMicros + " of " + s3.reserveMicros);
          e.want(up.sent.length === 4, "the 5xx was resent past its allowance: " + up.sent.length + " sent");
          return e.result();
        }),
    },
    {
      rule: "R2-8",
      name: "a call refused near the cap with nothing in flight is a cap stop: the item closes and nothing reaches the upstream",
      check: () =>
        withPaid({ caps: { "dc-gate-check": $(0.01) } }, async ({ r, up, direct }) => {
          await r.c.openItem("dc-gate-check");
          const code = await codeOf(direct.author("dc-gate-check")({ model: "astra", effort: "medium", maxTokens: 8000, prompt: "validator block", label: "g:validator:astra:1" }));
          const f = r.c.figures("dc-gate-check");
          const second = await codeOf(direct.author("dc-gate-check")({ model: "opus", effort: "medium", maxTokens: 10, prompt: "x", label: "g2" }));
          return code === "cap-stop" && f.closed && second === "cap-stop" && up.sent.length === 0 ? null : "read " + code + ", closed " + f.closed + ", then " + second + ", " + up.sent.length + " sent";
        }),
    },
    {
      rule: "PD-9",
      name: "a direct call served by a provider other than its first call's is drift: every call on that model stops in every role, and the next is refused unsent",
      check: () =>
        withPaid({ script: (_u, body, n) => ({ kind: "ok", provider: body?.model === "particle-ai/particle-1" ? (n === 1 ? "Particle" : "Particle AI") : SERVED[String(body?.model)] }) }, async ({ r, up, watch, direct }) => {
          const e = expectations();
          await r.c.openItem("dc-authoring-2");
          await r.c.openItem("dc-judges");
          const a = direct.author("dc-authoring-2");
          const req = (label: string) => ({ model: "particle" as const, effort: "high" as const, maxTokens: 4000, prompt: "audit " + label, label });
          e.want((await a(req("one"))).text === "ok", "the first particle-1 call failed");
          const two = await codeOf(a(req("two")));
          e.want(two === "E_DC_PROVIDER_DRIFT", "a changed provider read " + two);
          const judge = await codeOf(direct.judge("dc-judges")({ judge: "argon" as never, prompt: "x", effort: "medium", maxTokens: 1000, label: "j", subject: "particle", cacheKey: "j" }));
          const sent = up.sent.length;
          const third = await codeOf(a(req("three")));
          e.want(third === "E_DC_PROVIDER_DRIFT" && up.sent.length === sent, "a later particle-1 call read " + third + " with " + (up.sent.length - sent) + " sent");
          e.want(judge === "no error", "an Argon judge call stopped too: " + judge);
          const t = watch.terms().filter((l) => l.model === "particle");
          e.want(t.length === 1 && t[0]!.servedBy === "Particle" && (t[0]!.routing as any)?.data_collection === "deny", "terms " + JSON.stringify(t));
          return e.result();
        }),
    },
    {
      rule: "L2",
      name: "a round's sessions bind their item's one proxy at the frozen allowance and settle from the proxy's own meters, the retry included",
      check: () =>
        withPaid({}, async ({ r, up, sessions }) => {
          const e = expectations();
          const item: LedgerItemId = "dc-stage1-opus";
          await r.c.openItem(item);
          const sub = admitted(await r.c.admitRound(item, { run: "smoke u1", model: "opus", arms: ["none"] }), "the round");
          const spent: number[] = [];
          for (const attempt of [1, 2] as const) {
            const b = await sessions.bind(item, { sub, session: sub.sessions[0]!.id, attempt, arm: "none" });
            e.want(b.baseUrl.endsWith("/anthropic") && b.model === "anthropic:claude-opus-5-5", "the slot reads " + b.baseUrl + " " + b.model);
            for (const stream of [false, true]) e.want((await sessionCall(b, { stream })).status === 200, "a session call failed");
            spent.push((await sessions.end(b)).spentMicros);
          }
          const reserve = journalLines(sessions.journal(item)).filter((l) => l.kind === "reserve");
          e.want(reserve.length === 4 && reserve.every((l) => l.lease_id === r.c.lease(item)!.leaseId), "the session proxy reserved " + reserve.length + " on its lease");
          const f = await sessions.settle(item, sub.id);
          const settled = r.c.sub(sub.id)!;
          e.want(f.spentMicros === spent[0]! + spent[1]! && f.spentMicros > 0 && settled.state === "settled" && settled.spentMicros === f.spentMicros, "the round settled " + settled.spentMicros + " against meters " + spent.join(", "));
          e.want(up.sent.every((s) => s.url === "https://api.anthropic.com/v1/messages"), "a session reached " + up.sent.map((s) => s.url).join(", "));
          e.want(r.c.figures(item).inFlightMicros === 0, "the round still holds its reserve");
          return e.result();
        }),
    },
    {
      rule: "PD-9",
      name: "session traffic gets the direct calls' check: a Sol session served by another provider stops Sol in every role and cuts its session proxy",
      check: () =>
        withPaid({ script: (url, body, n) => ({ kind: "ok", provider: url.endsWith("/v1/messages") && n > 2 ? "Azure" : SERVED[String(body?.model)] }) }, async ({ r, up, watch, direct, sessions }) => {
          const e = expectations();
          const item: LedgerItemId = "dc-stage2-sol";
          for (const i of [item, "dc-authoring-1"] as LedgerItemId[]) await r.c.openItem(i);
          const sub = admitted(await r.c.admitRound(item, { run: "u1 pass 1", model: "sol", arms: ["none", "lens", "plan-design-review", "autoplan"] }), "the round");
          const b1 = await sessions.bind(item, { sub, session: sub.sessions[0]!.id, attempt: 1 });
          e.want(b1.baseUrl.endsWith("/openrouter") && b1.model === "openrouter:openai/gpt-6.1-sol", "the Sol slot reads " + b1.baseUrl);
          for (const stream of [false, true]) await sessionCall(b1, { stream });
          await sessions.end(b1);
          e.want(watch.terms().some((t) => t.model === "sol" && t.servedBy === "OpenAI"), "the first Sol session call recorded no provider");
          const b2 = await sessions.bind(item, { sub, session: sub.sessions[1]!.id, attempt: 1 });
          await sessionCall(b2);
          const outcome = journalLines(sessions.journal(item)).filter((l) => l.kind === "outcome").at(-1)!;
          e.want(outcome.served_provider === "Azure" && typeof outcome.generation_id === "string", "the journal read " + JSON.stringify(outcome));
          const drift = await codeOf(sessions.scan(item));
          e.want(drift === "E_DC_PROVIDER_DRIFT", "the session drift read " + drift);
          e.want(sessions.journal(item) === null, "Sol's session proxy still runs");
          const sent = up.sent.length;
          const direct1 = await codeOf(direct.author("dc-authoring-1")({ model: "sol", effort: "high", maxTokens: 4000, prompt: "author", label: "u9:author:sol:1" }));
          const next = await codeOf(sessions.bind(item, { sub, session: sub.sessions[2]!.id, attempt: 1 }));
          e.want(direct1 === "E_DC_PROVIDER_DRIFT" && next === "E_DC_PROVIDER_DRIFT" && up.sent.length === sent, "after the drift a direct Sol call read " + direct1 + ", a new session " + next + ", " + (up.sent.length - sent) + " sent");
          e.want((await direct.author("dc-authoring-1")({ model: "opus", effort: "high", maxTokens: 4000, prompt: "author", label: "u9:author:opus:1" })).text === "ok", "an Opus call stopped too");
          return e.result();
        }),
    },
    {
      rule: "PD-9",
      name: "a session reply that names no provider is read from OpenRouter's generation record, and drifts when the record names another provider",
      check: () =>
        withPaid({ script: (url, body) => ({ kind: "ok", provider: url.endsWith("/v1/messages") ? null : SERVED[String(body?.model)] }), generation: (id) => (id === "gen-1" ? "OpenAI" : "Azure"), resolveVia: "dc-judges" }, async ({ r, sessions }) => {
          const e = expectations();
          const item: LedgerItemId = "dc-stage1-sol";
          for (const i of [item, "dc-judges"] as LedgerItemId[]) await r.c.openItem(i);
          const sub = admitted(await r.c.admitRound(item, { run: "twins", model: "sol", arms: ["none", "none"] }), "the round");
          const b = await sessions.bind(item, { sub, session: sub.sessions[0]!.id, attempt: 1 });
          await sessionCall(b);
          e.want((await codeOf(sessions.scan(item))) === "no error", "the generation record's OpenAI did not pass");
          await sessionCall(b);
          const code = await codeOf(sessions.end(b));
          e.want(code === "E_DC_PROVIDER_DRIFT", "an Azure generation record read " + code);
          return e.result();
        }),
    },
    {
      rule: "R2-4",
      name: "a session proxy's reserve is copied off host through its relay before the call is sent; an unacknowledged copy refuses the call unsent and main's reconciler releases it at $0",
      check: async () => {
        let refuse = false;
        const inner = { t: null as DirTarget | null };
        const target: OffHostTarget = {
          append: async (line) => {
            if (refuse && line.includes('"kind":"reserve"')) throw new Error("the off-host target did not answer");
            return inner.t!.append(line);
          },
          lines: () => inner.t!.lines(),
          putSnapshot: (n, b) => inner.t!.putSnapshot(n, b),
          getSnapshot: (n) => inner.t!.getSnapshot(n),
          latestSnapshot: () => inner.t!.latestSnapshot(),
        };
        return withPaid({ target }, async ({ r, up, sessions }) => {
          inner.t = new DirTarget(join(r.dir, "offhost-relay"));
          const e = expectations();
          const item: LedgerItemId = "dc-base-apps";
          await r.c.openItem(item);
          const copied: number[] = [];
          const send = up.fetch;
          up.fetch = async (url, init) => {
            copied.push((await inner.t!.lines()).filter((l) => l.includes('"kind":"reserve"') && l.includes(r.c.lease(item)!.leaseId)).length);
            return send(url, init);
          };
          const sub = admitted(await r.c.admitRecipe({ run: "recipe c01" }), "the recipe session");
          const b = await sessions.bind(item, { sub, session: sub.run, attempt: 1 });
          e.want((await sessionCall(b)).status === 200 && copied[0] === 1, "the reserve was not off host before the send: " + copied.join(","));
          refuse = true;
          const res = await sessionCall(b);
          e.want(res.status === 503 && up.sent.length === 1, "an unacknowledged copy read " + res.status + " with " + up.sent.length + " sent");
          const journal = sessions.journal(item)!;
          await sessions.stopAll();
          const rec = await reconcileJournal(journal, r.local);
          e.want(rec.released.length === 1, "main's reconciler released " + rec.released.length);
          return e.result();
        });
      },
    },
    {
      rule: "R2-4",
      name: "a lost controller host is reconciled from the off-host copy: the session proxy's reserves after the watermark are held unknown until the owner's reconcile",
      check: () =>
        withPaid({}, async ({ r, sessions }) => {
          const e = expectations();
          const item: LedgerItemId = "dc-stage1-opus";
          await r.c.openItem(item);
          const snap = await takeSnapshot(r.c, r.wal!, r.target, { ledgerPath: r.ledgerPath });
          const sub = admitted(await r.c.admitRound(item, { run: "smoke u2", model: "opus", arms: ["none", "lens"] }), "the round");
          const b = await sessions.bind(item, { sub, session: sub.sessions[0]!.id, attempt: 1 });
          for (let i = 0; i < 2; i++) await sessionCall(b);
          const spent = sessions.figures(item, b.meterId).spentMicros;
          await sessions.stopAll();
          r.local.close();
          rmSync(join(r.dir, "host"), { recursive: true, force: true });
          const copy = await latestSnapshot(r.target);
          e.want(copy?.watermark === snap.watermark, "the newest snapshot is not the one taken");
          restoreLedgerFile(copy!, r.ledgerPath);
          const local2 = LocalLedger.open(r.ledgerPath);
          try {
            const rec = await recover(r.target, { runId: r.c.runId, holder: r.holder, leases: mainLeases({ record: r.record, local: local2, requireAdmission: () => null }) });
            if (rec.kind !== "recovered") return "recovery stopped: " + rec.why;
            e.want(rec.held.length === 1 && rec.held[0]!.id === sub.id && rec.uncertainMicros === sub.reserveMicros, "held " + rec.held.map((s) => s.id + " " + s.reserveMicros).join(","));
            const leaseId = rec.controller.lease(item)!.leaseId;
            e.want(rec.reserves.length === 2 && rec.reserves.every((x) => x.lease_id === leaseId && x.cell.meter_id === b.meterId), "the copy holds " + rec.reserves.length + " session reserves");
            e.want(rec.evidence.filter((x) => x.kind === "outcome").length === 2, "the session's outcomes are not kept as evidence");
            const replay = await replayReserves(local2, rec.reserves, join(r.dir, "host", "recovered-journal.ndjson"));
            e.want(replay.unknown.length === 2, "main's ledger holds " + replay.unknown.length + " unknown session calls");
            const usage = join(r.dir, "provider-usage.json");
            writeFileSync(usage, JSON.stringify({ invented: true, sessions: 1 }));
            await ownerReconcile(r.record, rec.controller, item, { spentMicros: spent, quotes: QUOTE, source: usage, now: new Date(Date.now() + 2 * 86_400_000) });
            const after = rec.controller.figures(item);
            e.want(after.unknownMicros === 0 && after.settledMicros === spent && readItem(r.record, item).leases[0]!.close?.how === "reconciled", "after the owner's reconcile: " + JSON.stringify(after));
            return e.result();
          } finally {
            local2.close();
          }
        }),
    },
    {
      rule: "L7",
      name: "renewal drains the item, reconciles the old proxy's journal and starts a new proxy on the continuation lease, for direct calls and sessions alike",
      check: () =>
        withPaid({}, async ({ r, direct, sessions }) => {
          const e = expectations();
          for (const [item, life] of [["dc-judges", direct.proxyLife("dc-judges")], ["dc-stage1-particle", sessions.proxyLife("dc-stage1-particle")]] as const) {
            const first = await r.c.openItem(item);
            if (item === "dc-judges") await direct.judge(item)({ judge: "astra", prompt: "packet", effort: "medium", maxTokens: 4000, label: "p", subject: "opus", cacheKey: "p" });
            else {
              const sub = admitted(await r.c.admitRound(item, { run: "smoke", model: "particle", arms: ["none"] }), "the round");
              const b = await sessions.bind(item, { sub, session: sub.sessions[0]!.id, attempt: 1 });
              await sessionCall(b);
              await sessions.end(b);
              await sessions.settle(item, sub.id);
            }
            const old = item === "dc-judges" ? direct.journal(item) : sessions.journal(item);
            const next = await renew(r.c, item, life);
            const now = item === "dc-judges" ? (direct.proxy(item), direct.journal(item)) : sessions.journal(item);
            e.want(next.leaseId !== first.leaseId && now !== null && now !== old, item + ": the continuation " + next.leaseId + " runs journal " + now);
          }
          return e.result();
        }),
    },
    {
      rule: "SR9",
      name: "the probe plan is keyless HTTPS reads of OpenRouter's endpoints API, and its parse pins each route to one provider within its max price",
      check: () => {
        const e = expectations();
        const plan = probePlan("/probe");
        e.want(plan.commands.length === 3 && plan.commands.every((c) => c.url.startsWith("https://openrouter.ai/api/v1/models/") && c.url.endsWith("/endpoints") && !c.argv.some((a) => /^-H$|header|authorization|_KEY/i.test(a)) && c.argv.includes("=https")), "the plan reads " + JSON.stringify(plan.commands.map((c) => c.argv)));
        const rec = pinRecord({ runId: "dc-dryrun", commit: COMMIT, dated: "2026-11-14T00:00:00Z", reads: goodReads() });
        e.want(rec.ok, "the record has problems: " + rec.routes.flatMap((x) => x.problems).join("; "));
        e.want(rec.routes.length === 5 && JSON.stringify(datedTermsOf(rec)) === JSON.stringify({ sol: "OpenAI", particle: "Particle", argon: "Google Vertex" }), "dated terms " + JSON.stringify(rec.ok ? datedTermsOf(rec) : null));
        const opus = rec.routes.find((x) => x.model === "opus")!;
        e.want(opus.served === "anthropic" && opus.sessionRoute === "/v1/messages" && rec.routes.find((x) => x.model === "astra")!.sessionRoute === null, "the direct routes read " + JSON.stringify(opus));
        const argon = rec.routes.find((x) => x.model === "argon")!;
        e.want(argon.endpoints?.length === 1 && argon.endpoints[0]!.tag === "google-vertex/global", "Argon's admitted endpoints " + JSON.stringify(argon.endpoints));
        const records = termsRecordsOf(rec);
        const line = { model: "sol" as const, id: "openai/gpt-6.1-sol", servedBy: "OpenAI", routing: argon.model === "argon" ? rec.routes.find((x) => x.model === "sol")!.routing : null, at: "2026-11-14T01:00:00Z" };
        e.want(startRule9(records.find((x) => x.model === "sol")!, firstCallOf(line)).ok, "start rule 9 refused a first call under the pin");
        e.want(!startRule9(records.find((x) => x.model === "sol")!, firstCallOf({ ...line, servedBy: "Azure" })).ok, "start rule 9 passed another provider");
        return e.result();
      },
    },
    {
      rule: "SR9",
      name: "a read with no endpoint on the pin, two providers on it, a missing read or a bad body leaves the record unpinned, and no call runs on it",
      check: () => {
        const e = expectations();
        const variants: Array<[string, Partial<Record<AnyModel, string | null>>]> = [
          ["no pinned endpoint", { ...goodReads(), sol: endpointsFixture("sol", { drop: true }) }],
          ["two providers", { ...goodReads(), particle: endpointsFixture("particle", { extra: [{ tag: "particle-ai/eu", provider_name: "Particle EU", prompt: "0.0000001", completion: "0.000001" }] }) }],
          ["over max price", { ...goodReads(), argon: endpointsFixture("argon", { drop: true, extra: [{ tag: "google-vertex", provider_name: "Google Vertex", prompt: "0.000003", completion: "0.00001" }] }) }],
          ["a missing read", { ...goodReads(), argon: null }],
          ["a bad body", { ...goodReads(), sol: "<html>" }],
        ];
        for (const [what, reads] of variants) {
          const rec = pinRecord({ runId: "dc-dryrun", commit: COMMIT, dated: "2026-11-14T00:00:00Z", reads });
          let refused = false;
          try {
            datedTermsOf(rec);
          } catch (x) {
            refused = x instanceof DcError && x.code === "E_USAGE";
          }
          e.want(!rec.ok && refused, what + " left the record ok");
        }
        return e.result();
      },
    },
  ];
}
