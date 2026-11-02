// GPT-6.1 Sol as a model under test in review-units, through OpenRouter's Anthropic-compatible Messages route (R54,
// GST-1019), keyless: the price row, the policy route, the judge defaults, the dry run, and a recorded session priced through
// the metering proxy into cost.tsv.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPO_ROOT } from "../../../src/cli.ts";
import { CHAT_PRICES, chatPrice, openRouterRouting, priceRequest, usageCost } from "../../../src/runner/pricing/prices.ts";
import { MeteringProxy, routable } from "../../../src/runner/proxy/metering-proxy.ts";
import { HOST_PROVIDERS } from "../../../src/skill-eval/cli/call.ts";
import { DEFAULT_POLICY, loadPolicy, modelProblem, providerOf, type LoadedPolicy } from "../../../src/skill-eval/cli/policy.ts";
import { removeTree } from "../../../src/trial/cleanup.ts";
import { main } from "../../../src/trial/review/cli.ts";
import { costTsv, meterCost, readJournalLines } from "../../../src/trial/review/cost.ts";
import { ARM_ID, armId } from "../../../src/trial/review/run.ts";
import type { CallOutcome, LedgerReply, Reservation, ReservationLedger } from "../../../src/types.ts";
import { collect } from "../../cli/helpers.ts";

const SOL = "openai/gpt-6.1-sol";
const policy = loadPolicy(DEFAULT_POLICY) as LoadedPolicy;
const SOL_ROW = { input: 2, output: 10, cache_read: 0.1, cache_write: 2.5, long: { above_input_tokens: 272_000, input: 4, output: 15, cache_read: 0.2, cache_write: 5 } };

describe("Sol's OpenRouter price row", () => {
  // Value: protects=the proxy prices Sol on OpenRouter at OpenRouter's list price for the openai endpoint, the record the row cites, and routes it only to that endpoint; fails_when=the row drifts from the cited record or the openai row, loses its provider pin, or is not routable; why_new=GST-1019 (no openrouter row for Sol, so review-units could not price a Sol session); seam=OPENROUTER_MODELS, chatPrice, openRouterRouting and routable; no_claim=OpenRouter's live price after the cited read
  test("is OpenRouter's recorded price for the openai endpoint, the openai row's tokens, pinned to openai", () => {
    const row = chatPrice("openrouter:" + SOL)!;
    expect(row).toEqual({ ...SOL_ROW, providers: ["openai"] });
    const { providers: _pin, ...tokens } = row;
    expect(tokens).toEqual(CHAT_PRICES["openai:gpt-6.1-sol"]!);
    const record = JSON.parse(readFileSync(join(REPO_ROOT, "wiki/plans/2026-11-02-geva-177-r3-amendment-3/openrouter-gpt-6.1-sol.json"), "utf8"));
    const perM = (s: string) => Math.round(Number(s) * 1e9) / 1000;
    const prices = (p: Record<string, string>) => ({ input: perM(p.prompt!), output: perM(p.completion!), cache_read: perM(p.input_cache_read!), cache_write: perM(p.input_cache_write!) });
    const openai = record.data.endpoints.filter((e: { tag: string }) => e.tag === "openai");
    expect(openai).toHaveLength(1);
    const { long, ...base } = SOL_ROW;
    expect(prices(openai[0].pricing)).toEqual(base);
    expect(openai[0].pricing.overrides.map((o: Record<string, string> & { min_prompt_tokens: number }) => ({ above_input_tokens: o.min_prompt_tokens, ...prices(o) }))).toEqual([long]);
    expect(openRouterRouting(row)).toEqual({ only: ["openai"], allow_fallbacks: false, data_collection: "deny", max_price: { prompt: 4, completion: 15, request: 0, image: 0 } });
    expect(routable("openrouter", SOL)).toBe(true);
  });

  // Value: protects=a Claude Code call on OpenRouter's Messages route reads Sol's usage in Anthropic's shape (cache reads beside input_tokens) at the row, and at the long rates past 272,000 prompt tokens; fails_when=cache reads are billed as fresh input, the long rate never applies, or the route reads OpenAI's shape; why_new=GST-1019; seam=priceRequest and usageCost; no_claim=the usage OpenRouter actually reports, which the recorded session covers
  test("prices a Messages-route call in Anthropic's usage shape, at long rates past 272,000 prompt tokens", () => {
    const price = priceRequest("openrouter", { model: SOL, max_tokens: 1000, messages: [{ role: "user", content: "hi" }] }, 1000, "/v1/messages");
    expect(price.format).toBe("anthropic");
    expect(usageCost(price, { input_tokens: 1000, cache_read_input_tokens: 9000, cache_creation_input_tokens: 0, output_tokens: 500 })).toEqual({ micros: 1000 * 2 + 900 + 500 * 10, usage: { input: 1000, output: 500, reasoning: 0, cache_read: 9000, cache_write: 0 } });
    expect(usageCost(price, { input_tokens: 280_000, output_tokens: 100 })!.micros).toBe(280_000 * 4 + 100 * 15);
  });
});

describe("Sol's policy route", () => {
  // Value: protects=review-units can run Sol as a subject on the Claude Code host through OpenRouter, and only as a subject; fails_when=the default policy refuses openai/gpt-6.1-sol as a subject, lets it judge, adjudicate or simulate the user, or its arm ids leave contract v1; why_new=GST-1019 (R54 makes Sol a model under test, and review-units drives Claude Code with anthropic or openrouter models only); seam=policy/models.json, modelProblem and armId; no_claim=a live OpenRouter session, which sol-review-smoke covers
  test("routes openai/gpt-6.1-sol through OpenRouter as a subject only", () => {
    expect(policy.policy.models[SOL]).toEqual({ provider: "openrouter", roles: ["subject"] });
    expect(providerOf(policy, SOL)).toBe("openrouter");
    expect(HOST_PROVIDERS.claude).toContain("openrouter");
    expect(modelProblem(policy, SOL, "subject", { smoke: false })).toBeNull();
    for (const role of ["judge", "adjudicator", "usersim"] as const) expect(modelProblem(policy, SOL, role, { smoke: false })).toContain("allows it only as subject");
    for (const arm of ["none", "gstack", "pstack", "tstack"]) expect(armId(arm, SOL)).toMatch(ARM_ID);
    expect(armId("none", SOL)).toBe("none-gpt-6-1-sol");
  });

  // Value: protects=adding Sol's OpenRouter route leaves the judge and adjudicator defaults, gpt-6.1-sol's own openai row, and other projects' policy files as they were; fails_when=a default or the openai row changes, or a policy that does not list the route gains it; why_new=GST-1019 (the brief bars any change to a default another project reads); seam=policy/models.json and loadPolicy; no_claim=which judge a preregistration picks
  test("leaves the judge and adjudicator defaults, gpt-6.1-sol's openai row and other policies as they were", () => {
    const byProvider = { anthropic: "gpt-6.1-sol", openai: "claude-opus-5-5", openrouter: "claude-opus-5-5" };
    expect(policy.policy.defaults).toEqual({ judge: byProvider, adjudicator: byProvider, usersim: "gpt-6-luna" });
    expect(policy.policy.models["gpt-6.1-sol"]).toEqual({ provider: "openai", roles: ["subject", "judge", "adjudicator"] });
    for (const role of ["subject", "judge", "adjudicator"] as const) expect(modelProblem(policy, "gpt-6.1-sol", role, { smoke: false })).toBeNull();
    const gbrain = loadPolicy(join(REPO_ROOT, "policy/examples/gbrain.json")) as LoadedPolicy;
    expect("problem" in gbrain).toBe(false);
    expect(modelProblem(gbrain, SOL, "subject", { smoke: false })).toContain("not in the policy");
  });
});

describe("review-units with Sol", () => {
  const run = async (argv: string[]) => {
    const io = collect();
    const code = await main(argv, io, {});
    return { code, ...io.text() };
  };

  // Value: protects=a review-units plan resolves openai/gpt-6.1-sol to its OpenRouter route and sizes its worst case at the OpenRouter row, while gpt-6.1-sol on the openai route stays refused for Claude Code; fails_when=the dry run refuses Sol, prints no route, or sizes the session at another price; why_new=GST-1019; seam=review-units main's dry run and allowanceMicros; no_claim=the Docker rig
  test("a dry run resolves Sol to the OpenRouter route and sizes it at the row", async () => {
    const out = join(mkdtempSync(join(REPO_ROOT, ".review-units-sol-")), "out");
    try {
      const argv = ["--suite", "gsta167-14pr", "--units", "3593", "--arms", "none", "--out", out, "--source", "garrytan/gstack=/nowhere", "--dry-run"];
      const dry = await run([...argv, "--models", SOL]);
      expect(dry.code).toBe(0);
      expect(dry.out).toContain("models: openai/gpt-6.1-sol (openrouter); passes 1; sessions 1");
      expect(dry.out).toContain("worst case at the allowance: $6.88; spend cap none");
      const capped = await run([...argv, "--models", SOL, "--allowance", "4", "--spend-cap", "5"]);
      expect(capped.out).toContain("worst case at the allowance: $4.00; spend cap $5.00");
      expect((await run([...argv, "--models", "gpt-6.1-sol"])).err).toMatch(/^E_USAGE review-units: --models: gpt-6.1-sol has no Claude Code route/);
    } finally {
      removeTree(join(out, ".."));
    }
  });

  // Value: protects=a recorded Sol session replays through the proxy to the same reservations, settlements and cost.tsv row it got live, and its tokens equal what Claude Code reported; fails_when=a call reserves or settles at another price, cost.tsv's usd or tokens drift from the live row, or the meter's tokens differ from Claude Code's; why_new=GST-1019 (sol-review-smoke recorded the session); seam=MeteringProxy on /openrouter/v1/messages, meterCost and costTsv; no_claim=OpenRouter's own billing, which its message ids do not let us look up
  test("a recorded session replays to its live reservations, settlements and cost.tsv row, at Claude Code's reported usage", async () => {
    const fixture = JSON.parse(readFileSync(join(import.meta.dir, "fixtures/sol-openrouter-session.json"), "utf8"));
    const calls = fixture.calls as Array<{ max_micros: number; usage: Record<string, number>; spent_micros: number }>;
    const dir = mkdtempSync(join(tmpdir(), "sol-session-"));
    const reserved: number[] = [];
    const settled: CallOutcome[] = [];
    const cell = { run_id: "r", arm: "none", task: "t", model: SOL, trial: 1, attempt: 1 };
    const ledger: ReservationLedger = {
      async reserve(r): Promise<LedgerReply> {
        reserved.push(r.max_micros);
        const reservation: Reservation = { reservation_id: "res_" + reserved.length, idempotency_key: r.idempotency_key, lease_id: r.lease_id, cell: r.cell, max_micros: r.max_micros, state: "reserved", spent_micros: null, usage: null };
        return { ok: true, reservation };
      },
      async settle(id, outcome): Promise<LedgerReply> {
        settled.push(outcome);
        return { ok: true, reservation: { reservation_id: id, idempotency_key: id, lease_id: "l1", cell: { ...cell, meter_id: "m" }, max_micros: 0, state: "settled", spent_micros: outcome.kind === "spent" ? outcome.spent_micros : null, usage: outcome.kind === "spent" ? outcome.usage : null } };
      },
    };
    const replies = calls.map((c) => c.usage);
    const sent: string[] = [];
    const proxy = new MeteringProxy({
      ledger,
      leaseId: "l1",
      host: "127.0.0.1",
      managementSocket: join(dir, "management.sock"),
      managementToken: "management-token-0123456789abcdef",
      journal: join(dir, "journal.ndjson"),
      retry: { attempts: 3, elapsed_ms: 60_000 },
      env: { OPENROUTER_API_KEY: "sk-or-v1-test" },
      fetch: async (url) => {
        sent.push(url);
        const { output_tokens, ...input } = replies.shift()!;
        const events = [{ type: "message_start", message: { usage: { ...input, output_tokens: 1 } } }, { type: "message_delta", usage: { output_tokens } }, { type: "message_stop" }];
        return new Response(events.map((e) => "event: " + e.type + "\ndata: " + JSON.stringify(e) + "\n\n").join(""), { headers: { "content-type": "text/event-stream" } });
      },
    });
    proxy.start();
    try {
      const a = proxy.bind({ cell, models: ["openrouter:" + SOL], allowance_micros: 4_000_000 });
      const row = chatPrice("openrouter:" + SOL)!;
      const shell = (content: string) => ({ model: SOL, max_tokens: fixture.max_output_tokens, stream: true, system: [{ type: "text", text: "s", cache_control: { type: "ephemeral" } }], messages: [{ role: "user", content }], tools: [{ name: "Read", input_schema: { type: "object" } }] });
      for (const c of calls) {
        // The live reservation is the request's bytes (with the proxy's provider object), 64 framing and 1,000 tool tokens at the $2.50 write rate, plus 32,000 output tokens at $10.
        const bytes = Math.floor((c.max_micros - fixture.max_output_tokens * row.output) / row.cache_write!) - 1064;
        const body = shell("x".repeat(bytes - Buffer.byteLength(JSON.stringify({ ...shell(""), provider: openRouterRouting(row) }))));
        const res = await fetch("http://127.0.0.1:" + proxy.port + "/" + a.slot + "/openrouter/v1/messages", { method: "POST", headers: { "content-type": "application/json", "x-api-key": a.token }, body: JSON.stringify(body) });
        expect(res.status).toBe(200);
        await res.text();
      }
      await proxy.finalize(a.meter_id);
      expect(sent).toEqual(calls.map(() => "https://openrouter.ai/api/v1/messages"));
      expect(reserved).toEqual(calls.map((c) => c.max_micros));
      expect(settled.map((o) => (o.kind === "spent" ? o.spent_micros : null))).toEqual(calls.map((c) => c.spent_micros));
      const cost = meterCost(readJournalLines(join(dir, "journal.ndjson")), a.meter_id, null);
      const [header, line] = costTsv([{ pr: "smoke", pass: 1, wall_ms: null, cost }]).trim().split("\n").map((l) => l.split("\t"));
      expect(Object.fromEntries(Object.keys(fixture.cost_tsv).map((k) => [k, line![header!.indexOf(k)]]))).toEqual(fixture.cost_tsv);
      const reported = fixture.claude_code_result_usage;
      expect([cost.all.input, cost.all.cache_write, cost.all.cache_read, cost.all.output + cost.all.reasoning]).toEqual([reported.input_tokens, reported.cache_creation_input_tokens, reported.cache_read_input_tokens, reported.output_tokens]);
    } finally {
      proxy.stop();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
