// route-check (plan 2026-11-02-geva-165-planning-panel-v3-plan, section 4), keyless: every exit path through main with an
// injected round, fetch and clock; the judges on fixture transcripts, records and journals; the bill reader's bounded wait;
// and the real session runner on a test rig whose driver records the options it gets.
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HostDriverOptions } from "../../../src/adapters/host.ts";
import { REPO_ROOT } from "../../../src/cli.ts";
import { openLease, reconcileLease, recordApproval } from "../../../src/runner/ledger/ledger.ts";
import { LedgerError } from "../../../src/runner/ledger/record.ts";
import { DEFAULT_POLICY, loadPolicy, type LoadedPolicy } from "../../../src/skill-eval/cli/policy.ts";
import type { HostRig } from "../../../src/skill-eval/cli/run-host.ts";
import { PLAN_ASK, PLAN_TURN2, REC_USER } from "../../../src/trial/review/plan.ts";
import { billedCosts, journalCalls, judgeBlock, judgeMetering, judgeTool, main, runSessions, sessionInfra, TOOL_PROMPT, type Deps, type RoundInput, type RoundResult } from "../../../src/trial/review/route-check.ts";
import type { AgentOutcome } from "../../../src/trial/trial.ts";
import type { TrialRecord } from "../../../src/types.ts";
import { harness, localSandbox } from "../../adapters/harness.ts";
import { collect } from "../../cli/helpers.ts";

const SOL = "openai/gpt-6.1-sol";
const UNIT = join(import.meta.dir, "fixtures", "route-check-unit");
const TOKEN = "0123456789abcdef01234567";
const KEY = "sk-or-v1-route-check-test-0123456789";
const BLOCK = "Done.\n\n```plan-findings\n[]\n```";
const policy = loadPolicy(DEFAULT_POLICY) as LoadedPolicy;
const roots: string[] = [];
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));
const outDir = () => {
  const d = mkdtempSync(join(tmpdir(), "route-check-"));
  roots.push(d);
  return join(d, "out");
};

const line = (m: unknown) => JSON.stringify(m) + "\n";
const assistant = (content: unknown[], parent: string | null = null) => line({ type: "assistant", parent_tool_use_id: parent, message: { content } });
const user = (content: unknown[], parent: string | null = null) => line({ type: "user", parent_tool_use_id: parent, message: { content } });
const roundTrip = (o: { error?: boolean; quote?: boolean; parent?: string } = {}) =>
  assistant([{ type: "tool_use", id: "tu1", name: "Read", input: { file_path: "token.txt" } }], o.parent ?? null) +
  user([{ type: "tool_result", tool_use_id: "tu1", content: o.error ? "File does not exist." : TOKEN + "\n", is_error: o.error === true }], o.parent ?? null) +
  assistant([{ type: "text", text: o.quote === false ? "I read the file." : "The token is " + TOKEN + "." }]);
const rec = (termination: TrialRecord["termination"], turns: string[] = [], model_output = true) => ({ termination, turns, model_output }) as unknown as TrialRecord;
const call = (meter: string, rid: string, o: { spent?: number; upstream?: string | null; status?: number; unknown?: boolean } = {}) => [
  { kind: "request", reservation_id: rid, cell: { meter_id: meter } },
  { kind: "outcome", reservation_id: rid, meter_id: meter, status: o.status ?? 200, outcome: o.unknown ? { kind: "unknown" } : { kind: "spent", spent_micros: o.spent ?? 100_000, usage: { input: 10, output: 5, cache_read: 0, cache_write: 0, reasoning: 0 } }, upstream_id: o.upstream === undefined ? "gen-" + rid : o.upstream },
];

interface Script { tool?: Partial<{ record: TrialRecord; transcript: string }>; block?: TrialRecord; journal?: Record<string, unknown>[]; throws?: Error; lease?: string; spent?: number }
function fakeRound(script: Script, seen: RoundInput[]): Deps["round"] {
  return async (input) => {
    seen.push(input);
    if (script.throws) throw script.throws;
    const sessions: RoundResult["sessions"] = {};
    if (input.sessions.includes("tool")) sessions.tool = { meter_id: "m-tool", record: script.tool?.record ?? rec({ kind: "completed" }, ["ok"]), transcript: script.tool?.transcript ?? roundTrip(), claude_code_version: "2.9.0" };
    if (input.sessions.includes("block")) sessions.block = { meter_id: "m-block", record: script.block ?? rec({ kind: "completed" }, [BLOCK]), transcript: "", claude_code_version: "2.9.0" };
    const journal = script.journal ?? [...(sessions.tool ? call("m-tool", "r1") : []), ...(sessions.block ? call("m-block", "r2") : [])];
    return { lease_id: script.lease ?? "e1-route-sol.0001.abc123", spent_micros: script.spent ?? 200_000, sessions, journal };
  };
}
const bills = (costs: Record<string, number>) => (async (url: string) => {
  const id = new URL(url).searchParams.get("id")!;
  return id in costs ? Response.json({ data: { id, total_cost: costs[id], native_tokens_reasoning: 12 } }) : new Response("{}", { status: 404 });
}) as Deps["fetch"];
async function run(args: string[], deps: Partial<Deps> = {}, env: Record<string, string> = { OPENROUTER_API_KEY: KEY }) {
  const io = collect();
  let clock = 0;
  const code = await main(args, io, env, { token: () => TOKEN, now: () => (clock += 1000), sleep: async () => {}, fetch: bills({ "gen-r1": 0.1, "gen-r2": 0.1 }), ...deps });
  const text = io.text();
  return { code, out: text.out, err: text.err, lines: text.err.split("\n") };
}
const argv = (out: string, ...more: string[]) => ["--model", SOL, "--unit", UNIT, "--item", "e1-route-sol", "--out", out, "--record", join(out, "..", "record"), ...more];
const state = (out: string) => JSON.parse(readFileSync(join(out, "route-check.json"), "utf8"));

describe("route-check exits", () => {
  // Value: protects=a route that does every part passes in one try, both sessions on one lease of their worst case at the model's full allowance; fails_when=a passing try exits other than 0, runs a session twice or leases another amount; why_new=GEVA-203 (route check, plan section 4); seam=main with an injected round; no_claim=a live OpenRouter session
  test("every part passes in one try: exit 0", async () => {
    const out = outDir();
    const seen: RoundInput[] = [];
    const r = await run(argv(out), { round: fakeRound({}, seen) });
    expect(r.code).toBe(0);
    expect(r.out).toContain("every part passed");
    expect(seen.map((s) => [s.sessions, s.allowanceMicros, s.leaseMicros])).toEqual([[["tool", "block"], 6_880_000, 13_760_000]]);
    expect(state(out).tries[0].parts).toEqual({ tool: { result: "pass" }, block: { result: "pass" }, metering: { result: "pass" } });
  });

  // Value: protects=a tool round trip that fails twice takes the model out of E1 with its code and refuses a third try; fails_when=the code, the endpoint, the Claude Code version or the fix line is missing, a retry reruns passed parts, or a third try spends; why_new=GEVA-203; seam=main, judgeTool and route-check.json; no_claim=which repair fixes a route
  test("E_ROUTE_TOOL_ROUNDTRIP exits 1 twice, then a third try is refused", async () => {
    const out = outDir();
    const seen: RoundInput[] = [];
    const round = fakeRound({ tool: { transcript: roundTrip({ error: true }) } }, seen);
    const first = await run(argv(out), { round });
    expect(first.code).toBe(1);
    expect(first.lines[0]).toBe("E_ROUTE_TOOL_ROUNDTRIP route-check: openai/gpt-6.1-sol on https://openrouter.ai/api/v1/messages (Claude Code 2.9.0), part tool, try 1 of 2: no main-agent tool call got a non-error result holding the token");
    expect(first.lines.at(-1)).toStartWith("  fix: apply a named repair from the frozen list");
    const second = await run(argv(out), { round });
    expect(second.code).toBe(1);
    expect(seen[1]!.sessions).toEqual(["tool"]);
    expect(second.lines.at(-1)).toBe("  fix: none in this check: part tool failed both tries, so openai/gpt-6.1-sol leaves E1 with E_ROUTE_TOOL_ROUNDTRIP; the results name the code");
    const third = await run(argv(out), { round });
    expect(third.code).toBe(2);
    expect(third.lines[0]).toBe("E_USAGE route-check: part tool failed both tries (E_ROUTE_TOOL_ROUNDTRIP), so openai/gpt-6.1-sol leaves E1 with that code; a third try is refused");
    expect(seen).toHaveLength(2);
  });

  // Value: protects=a missing block exits 1 with E_ROUTE_NO_BLOCK and the output-allowance repair raises the next try's allowance and is recorded; fails_when=the block failure is scored otherwise, the repair is not applied or not recorded; why_new=GEVA-203; seam=main, judgeBlock and parseRepairs; no_claim=that a larger allowance gives a block
  test("E_ROUTE_NO_BLOCK exits 1, and a retry under --repair output-allowance runs at the raised allowance", async () => {
    const out = outDir();
    const seen: RoundInput[] = [];
    const first = await run(argv(out), { round: fakeRound({ block: rec({ kind: "completed" }, ["No block here."]) }, seen) });
    expect(first.code).toBe(1);
    expect(first.lines[0]).toEndWith("part block, try 1 of 2: the session completed with no plan-findings block");
    expect(first.lines.at(-1)).toContain("--repair output-allowance=<tokens>");
    const second = await run(argv(out, "--repair", "output-allowance=64000"), { round: fakeRound({}, seen) });
    expect(second.code).toBe(0);
    expect([seen[1]!.sessions, seen[1]!.allowanceMicros]).toEqual([["block"], 1_600_000 * 4 + 64_000 * 15]);
    expect(state(out).tries[1].repairs).toEqual({ "output-allowance": "64000" });
  });

  // Value: protects=a metering failure writes the per-call comparison, names the ledger reconcile command for the try's lease, and refuses a retry until the approval record holds that lease reconciled from that file; fails_when=the file lacks a column, the fix names another lease or file, or a retry spends before the reconcile; why_new=GEVA-203 (plan section 4's code table); seam=main, judgeMetering, reconcileProblem and the ledger's record; no_claim=OpenRouter's real bill
  test("E_ROUTE_METERING exits 1, writes metering-1.json, and a retry waits for the ledger reconcile", async () => {
    const out = outDir();
    const record = join(out, "..", "record");
    const quotes = [{ words: "approve the route check", by: "test", source: "test" }];
    recordApproval(record, { action: "init", item: "e1-route-sol", cap_micros: 30_000_000, quotes, admission: "warn" });
    const lease = openLease(record, null, { item: "e1-route-sol", run_id: "route-check-test", amount_micros: 13_760_000 }).lease_id;
    const seen: RoundInput[] = [];
    const first = await run(argv(out), { round: fakeRound({ lease }, seen), fetch: bills({ "gen-r1": 0.1, "gen-r2": 0.08 }) });
    expect(first.code).toBe(1);
    expect(first.lines[0]).toEndWith("part metering, try 1 of 2: the block session metered $0.100000 and OpenRouter billed $0.080000, more than 10% apart");
    const source = join(out, "metering-1.json");
    expect(first.lines.at(-1)).toEndWith("gstack-evals ledger reconcile --lease " + lease + " --spent 0.180000 --words <the owner's words> --by <who> --source " + source + " --ledger-record " + record);
    expect(JSON.parse(readFileSync(source, "utf8")).calls).toEqual([
      { session: "tool", reservation_id: "r1", upstream_id: "gen-r1", status: 200, metered_micros: 100_000, billed_micros: 100_000, reasoning_tokens: { metered: 0, billed: 12 } },
      { session: "block", reservation_id: "r2", upstream_id: "gen-r2", status: 200, metered_micros: 100_000, billed_micros: 80_000, reasoning_tokens: { metered: 0, billed: 12 } },
    ]);
    const early = await run(argv(out), { round: fakeRound({}, seen) });
    expect(early.code).toBe(2);
    expect(early.lines[0]).toStartWith("E_USAGE route-check: metering failed on try 1, and lease " + lease + " has no reconcile from " + source);
    expect(seen).toHaveLength(1);
    reconcileLease(record, { lease_id: lease, spent_micros: 180_000, quotes, source, now: new Date(Date.now() + 25 * 3_600_000) });
    const retry = await run(argv(out), { round: fakeRound({}, seen) });
    expect(retry.code).toBe(0);
    expect(seen[1]!.sessions).toEqual(["tool", "block"]);
  });

  // Value: protects=an endpoint or proxy failure exits 2 with E_ROUTE_INFRA, uses no try, prints what the proxy said with the key scrubbed, and two of them stop the check; fails_when=an infra stop counts as a try, the key reaches stderr, or a third run spends; why_new=GEVA-203; seam=main, sessionInfra and proxyErrors; no_claim=which infra failures a live route shows
  test("E_ROUTE_INFRA exits 2 with no try used, and a second one stops the check", async () => {
    const out = outDir();
    const seen: RoundInput[] = [];
    const journal = [...call("m-tool", "r1"), { kind: "refusal", meter_id: "m-block", code: "UPSTREAM", reason: "openrouter answered 503; sent with Bearer " + KEY }];
    const round = fakeRound({ block: rec({ kind: "missing", code: "UPSTREAM" }, [], false), journal }, seen);
    const first = await run(argv(out), { round });
    expect(first.code).toBe(2);
    expect(first.lines[0]).toEndWith("part block, try 1 (no try used): the session ended missing (UPSTREAM)");
    expect(first.err).toContain("  proxy: refused UPSTREAM: openrouter answered 503");
    expect(first.err).not.toContain(KEY);
    expect(first.lines.at(-1)).toBe("  fix: check the endpoint, credential or proxy named above, then rerun route-check with the same --out");
    expect(state(out).tries[0].parts.block).toEqual({ result: "infra", reason: "the session ended missing (UPSTREAM)" });
    const second = await run(argv(out), { round });
    expect(second.lines.at(-1)).toStartWith("  fix: this is the second infra failure, so the check stops for the Captain");
    const third = await run(argv(out), { round });
    expect(third.code).toBe(2);
    expect(third.lines[0]).toStartWith("E_ROUTE_INFRA route-check: openai/gpt-6.1-sol has had 2 infra failures");
    expect(seen).toHaveLength(2);
  });

  // Value: protects=a ledger, proxy or budget cap stop leaves the check incomplete (CAP_STOP, exit 2) and uses no try; fails_when=a cap stop reads as a pass or a failure, or a try past the check's cap starts; why_new=GEVA-203; seam=main's cap handling; no_claim=the ledger's own cap arithmetic
  test("CAP_STOP from the ledger, the proxy or the check's cap is incomplete: exit 2", async () => {
    const ledger = outDir();
    const r1 = await run(argv(ledger), { round: fakeRound({ throws: new LedgerError("CAP_STOP", "line item e1-route-sol has $1.00 left") }, []) });
    expect([r1.code, r1.lines[0]!.split(":")[0]]).toEqual([2, "CAP_STOP route-check"]);
    expect(state(ledger).tries[0]).toMatchObject({ stop: "CAP_STOP", parts: {} });
    const proxy = await run(argv(outDir()), { round: fakeRound({ block: rec({ kind: "cap_stop" }) }, []) });
    expect([proxy.code, proxy.err]).toEqual([2, expect.stringContaining("the proxy stopped a session at the lease's cap")]);
    const out = outDir();
    const seen: RoundInput[] = [];
    await run(argv(out), { round: fakeRound({ tool: { transcript: roundTrip({ quote: false }) }, spent: 21_000_000 }, seen) });
    const capped = await run(argv(out), { round: fakeRound({}, seen) });
    expect(capped.code).toBe(2);
    expect(capped.lines[0]).toContain("does not fit under the check's cap of 4 sessions ($27.52, $21.00 spent)");
    expect(seen).toHaveLength(1);
  });

  // Value: protects=route-check refuses before any spend a unit outside tests/, a repair off the frozen list or out of turn, a pin the proxy cannot apply, a non-OpenRouter model and a missing key, and a dry run writes nothing; fails_when=any of these spends or exits other than 2, or the dry run writes; why_new=GEVA-203 (public fixture only, frozen repairs); seam=main's checks; no_claim=a sealed unit's path
  test("usage refusals exit 2 before any spend, and a dry run writes nothing", async () => {
    const seen: RoundInput[] = [];
    const round = fakeRound({}, seen);
    const refused = async (args: string[], text: string, env?: Record<string, string>) => {
      const r = await run(args, { round }, env);
      expect(r.code).toBe(2);
      expect(r.lines[0]).toStartWith("E_USAGE route-check: ");
      expect(r.lines[0]).toContain(text);
    };
    const out = outDir();
    const elsewhere = mkdtempSync(join(tmpdir(), "route-unit-"));
    roots.push(elsewhere);
    writeFileSync(join(elsewhere, "plan.md"), "# Plan\n");
    for (const unit of [join(REPO_ROOT, "src"), elsewhere]) await refused(argv(out).map((a) => (a === UNIT ? unit : a)), "is outside the repo's tests/ tree");
    await refused(argv(out, "--repair", "bogus=1"), "is not on the frozen list");
    await refused(argv(out, "--repair", "output-allowance=1000"), "above 32000");
    await refused(argv(out, "--repair", "output-allowance=64000"), "a repair applies between tries");
    await refused(argv(out).map((a) => (a === SOL ? "claude-opus-5-5" : a)), "has no OpenRouter route");
    await refused(argv(out).map((a) => (a === "e1-route-sol" ? "sol-route" : a)), "--item takes the model's e1-route line item");
    await refused(argv(out), "OPENROUTER_API_KEY", {});
    const dry = await run(argv(out, "--dry-run"), { round });
    expect(dry.code).toBe(0);
    expect(dry.out).toContain("allowance $6.88 a session; cap 4 x $6.88 = $27.52; spent $0.00; this try's lease $13.76");
    expect(existsSync(out)).toBe(false);
    await run(argv(out), { round: fakeRound({ tool: { transcript: roundTrip({ error: true }) } }, seen) });
    await refused(argv(out, "--repair", "provider-pin=deepinfra"), "has no per-run pin");
    expect((await run(argv(out, "--repair", "provider-pin=openai"), { round })).code).toBe(0);
    expect(seen).toHaveLength(2);
  });
});

describe("route-check judges", () => {
  // Value: protects=the tool judge passes only a main-agent round trip whose non-error result holds the token and whose last text quotes it; fails_when=an error result, a subagent's call, a missing quote or an unfinished session passes; why_new=GEVA-203; seam=judgeTool; no_claim=how a model words its reply
  test("judgeTool", () => {
    const done = rec({ kind: "completed" });
    expect(judgeTool(done, roundTrip(), TOKEN)).toBeNull();
    expect(judgeTool(done, roundTrip({ error: true }), TOKEN)).toBe("no main-agent tool call got a non-error result holding the token");
    expect(judgeTool(done, roundTrip({ parent: "task1" }), TOKEN)).toBe("the main agent made no tool call");
    expect(judgeTool(done, roundTrip({ quote: false }), TOKEN)).toBe("the main agent's last text does not quote the token");
    expect(judgeTool(rec({ kind: "timeout" }), roundTrip(), TOKEN)).toBe("the session ended timeout");
  });

  // Value: protects=the block judge passes any parsed block, [] included, and reports why a session fails; the infra rule tells endpoint failures from route results; fails_when=[] fails, a malformed block passes, or a stop before model output counts as a route failure; why_new=GEVA-203; seam=judgeBlock and sessionInfra; no_claim=C's scoring of capped plan sessions
  test("judgeBlock and sessionInfra", () => {
    expect(judgeBlock(rec({ kind: "completed" }, [BLOCK]))).toBeNull();
    expect(judgeBlock(rec({ kind: "completed" }, [BLOCK.replace("[]", "{}")]))).toBe("the plan-findings block is not an array");
    expect(judgeBlock(rec({ kind: "turn_cap" } as never, [BLOCK]))).toBe("the session ended turn_cap");
    expect(sessionInfra(rec({ kind: "credentials_rejected" }))).toContain("E_KEY_REJECTED");
    expect(sessionInfra(rec({ kind: "timeout" }, [], false))).toBe("the session ended timeout before any model output");
    expect(sessionInfra(rec({ kind: "timeout" }))).toBeNull();
  });

  // Value: protects=metering passes within 10% and fails outside it, with no upstream id, with an unknown outcome or with no call, while a refused call settled at nothing needs no id; fails_when=any of these flips; why_new=GEVA-203; seam=journalCalls and judgeMetering; no_claim=OpenRouter's rounding
  test("judgeMetering", () => {
    const meters = { tool: "m-tool", block: "m-block" };
    const bill = (b: number) => new Map([["gen-r1", { micros: 95_000, reasoning: 0 }], ["gen-r2", { micros: b, reasoning: 3 }]]);
    const lines = [...call("m-tool", "r1"), ...call("m-block", "r2"), ...call("m-block", "r3", { spent: 0, status: 429, upstream: null })];
    expect(judgeMetering(journalCalls(lines, meters), bill(105_000), ["tool", "block"]).problems).toEqual([]);
    expect(judgeMetering(journalCalls(lines, meters), bill(80_000), ["tool", "block"]).problems).toEqual(["the block session metered $0.100000 and OpenRouter billed $0.080000, more than 10% apart"]);
    expect(judgeMetering(journalCalls([...call("m-tool", "r1"), ...call("m-block", "r2", { upstream: null })], meters), bill(100_000), ["tool", "block"]).problems).toEqual(["call r2 (block session) has no upstream id, so its billed cost cannot be read"]);
    expect(judgeMetering(journalCalls([...call("m-block", "r2", { unknown: true })], meters), bill(100_000), ["tool", "block"]).problems).toEqual(["call r2 (block session) has no spent outcome with its spend and reasoning tokens in the proxy journal", "the tool session has no paid call in the proxy journal"]);
  });

  // Value: protects=the bill reader waits a bounded time: it finds a generation that appears after two polls, gives up on one that never does at the deadline, and calls a refused key infra; fails_when=it stops early, polls past the deadline or reads a 401 as a missing bill; why_new=GEVA-203; seam=billedCosts with an injected fetch and clock; no_claim=OpenRouter's real lag
  test("billedCosts' bounded wait", async () => {
    let clock = 0;
    const sleeps: number[] = [];
    const deps = (statuses: number[]) => ({ key: KEY, waitMs: 20_000, pollMs: 5_000, now: () => clock, sleep: async (ms: number) => void sleeps.push((clock += ms)), fetch: (async (_url: string, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer " + KEY);
      const status = statuses.shift() ?? 404;
      return status === 200 ? Response.json({ data: { total_cost: 0.0123, native_tokens_reasoning: 7 } }) : new Response("{}", { status });
    }) as Deps["fetch"] });
    expect(await billedCosts(["gen-1"], deps([404, 404, 200]))).toEqual({ billed: new Map([["gen-1", { micros: 12_300, reasoning: 7 }]]) });
    expect(sleeps).toHaveLength(2);
    clock = 0;
    sleeps.length = 0;
    expect(await billedCosts(["gen-2"], deps([]))).toEqual({ billed: new Map() });
    expect(sleeps).toEqual([5_000, 10_000, 15_000, 20_000]);
    expect(await billedCosts(["gen-3"], deps([401]))).toEqual({ infra: "OpenRouter answered 401 to the generation lookup's key" });
  });
});

describe("route-check sessions", () => {
  // Value: protects=the real session runner seeds the tool session with token.txt alone and the block session with the unit, and hands the driver the follow-up (PLAN_TURN2), the rec user and cap stops on the block session only; fails_when=a session gets the other's tree, prompt or options; why_new=GEVA-203 (Contract 1 and 2 callers); seam=runSessions on a test rig with a recording driver; no_claim=A's driver behavior for followUp, which A's tests cover
  test("runSessions builds both sessions", async () => {
    const h = harness(() => [{ type: "text", text: "unused" }]);
    const seen: { o: HostDriverOptions; prompt: string; token: string; plan: boolean }[] = [];
    const rig: HostRig = {
      baseUrl: h.baseUrl, network: null, imageDigest: null,
      bind: async (request) => h.proxy.bind(request),
      finalize: (m) => h.proxy.finalize(m),
      arms: { none: { tree_sha256: "none-tree", skill: null, gstack: null, plugins: [] } },
      sandbox: () => localSandbox(() => {}),
      judgeSandbox: () => localSandbox(() => {}),
      egress: () => ({ open: false, detail: "test rig" }),
      close: async () => ({ committed: 0, unknown: 0, lease_id: null }),
      recovery: null,
      driver: (o) => ({
        async run(session, task): Promise<AgentOutcome> {
          seen.push({ o, prompt: task.prompt, token: session.exec("cat token.txt 2>/dev/null", 10_000).stdout.trim(), plan: session.exec("test -f plan.md && echo yes", 10_000).stdout.trim() === "yes" });
          mkdirSync(o.out, { recursive: true });
          writeFileSync(join(o.out, "init.json"), JSON.stringify({ claude_code_version: "2.9.0" }));
          writeFileSync(join(o.out, "transcript.ndjson"), roundTrip());
          return { turns: ["ok"], termination: { kind: "completed" }, model_output: true, opened: null, files_read: [], asked: [], usage: null, cost_micros: null, agent_turns: 1, loaded_bytes: null };
        },
      }),
    };
    try {
      const sessions = await runSessions({ model: SOL, item: "e1-route-sol", runId: "r", out: outDir(), unit: UNIT, try: 1, sessions: ["tool", "block"], token: TOKEN, allowanceMicros: 6_880_000, leaseMicros: 13_760_000, ledger: null, record: null, policy, env: {} }, rig);
      expect(seen.map((s) => [s.prompt, s.token, s.plan])).toEqual([[TOOL_PROMPT, TOKEN, false], [PLAN_ASK, "", true]]);
      const [tool, block] = seen.map((s) => s.o);
      expect([tool!.followUp, tool!.capStops, tool!.interactive, tool!.provider, tool!.entry]).toEqual([undefined, true, false, "openrouter", undefined]);
      expect([block!.followUp, block!.capStops, block!.interactive, block!.entry, typeof block!.freeform]).toEqual([{ text: PLAN_TURN2.text, maxTurns: 5, timeoutMs: 300_000 }, true, true, { user: REC_USER }, "function"]);
      expect([sessions.tool!.claude_code_version, sessions.tool!.transcript.includes(TOKEN), sessions.tool!.meter_id === sessions.block!.meter_id]).toEqual(["2.9.0", true, false]);
    } finally {
      h.proxy.stop();
      rmSync(h.dir, { recursive: true, force: true });
    }
  });
});
