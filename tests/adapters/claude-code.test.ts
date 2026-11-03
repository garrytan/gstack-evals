import { afterEach, describe, expect, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { join } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { ALLOWANCE_SPENT, BACKGROUND_WAIT_MS, claudeCodeDriver, claudeCodeEnv, refusalIn, type ClaudeCodeOptions } from "../../src/adapters/claude-code/driver.ts";
import { hostDriver } from "../../src/adapters/host.ts";
import { parseFindings } from "../../src/trial/review/findings.ts";
import { mainAgentTexts } from "../../src/trial/review/capped.ts";
import { codeParse, mainAgentTurns } from "../../src/trial/review/held.ts";
import { loadReaderMap, readerUsage, readTranscript } from "../../src/trial/review/readers.ts";
import { priceRequest, usageCost } from "../../src/runner/pricing/prices.ts";
import { DEFAULT_MAX_OUTPUT_TOKENS } from "../../src/runner/proxy/metering-proxy.ts";
import { trialEnv } from "../../src/trial/env.ts";
import { gradeTrial, type VerdictTask } from "../../src/skill-eval/verdict/grade.ts";
import type { SidecarTask } from "../../src/skill-eval/contract/sidecar.ts";
import type { TrialRecord } from "../../src/types.ts";
import { HAS_CLAUDE_CLI, harness, KEYS, type Harness, type Script } from "./harness.ts";

let open: Harness[] = [];
afterEach(() => {
  for (const h of open) h.close();
  open = [];
});

const MODEL = "claude-haiku-5-5";
const READER_MAP = join(import.meta.dir, "..", "..", "src", "trial", "review", "reader-maps", "gstack-77fe28c39796.json");

async function run(script: Script, o: { entry?: SidecarTask; skill?: (home: string) => ClaudeCodeOptions["skill"]; provider?: "anthropic" | "openrouter"; model?: string; capMicros?: number; env?: Record<string, string>; prompt?: string; setupHome?: (home: string) => void; options?: Pick<ClaudeCodeOptions, "systemPrompt" | "maxTurns" | "capStops" | "backgroundWaitMs"> } = {}) {
  const h = harness(script, { ...(o.capMicros === undefined ? {} : { capMicros: o.capMicros }), ...(o.env ? { env: o.env } : {}) });
  open.push(h);
  const model = o.model ?? MODEL;
  const provider = o.provider ?? "anthropic";
  const binding = h.bind(model, provider);
  const home = join(h.dir, "home");
  o.setupHome?.(home);
  const driver = claudeCodeDriver({ model, provider, proxy: { baseUrl: h.baseUrl, slot: binding.slot, token: binding.token }, ...(o.entry ? { entry: o.entry } : {}), skill: o.skill?.(home) ?? null, out: join(h.dir, "host"), query: query as never, ...o.options });
  const session = h.session(join(h.dir, "work", "t"), home, driver.env!);
  const outcome = await driver.run(session, { id: "t", prompt: o.prompt ?? "Help me think about my idea." }, 120_000);
  const meter = await h.proxy.finalize(binding.meter_id);
  const lines = (f: string) => readFileSync(join(h.dir, "host", f), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  return { h, home, outcome, meter, driver, lines };
}

const record = (o: Awaited<ReturnType<typeof run>>["outcome"]): TrialRecord => ({ model: MODEL, arm: "after", task: "t", round: 1, trial: 0, check: null, judge: null, metrics: {}, wall_ms: null, ...o });
const task = (over: Partial<VerdictTask>): VerdictTask => ({ id: "t", safety: false, interactive: true, judge: false, must: [], must_not: [], check: false, ...over });

const ASK = {
  questions: [
    { question: "Before we dig in, what's your goal with this?", header: "Goal", multiSelect: false, options: [{ label: "Building a startup", description: "" }, { label: "Having fun", description: "" }] },
    { question: "Shall I write the design doc to docs/plan.md now?", header: "Design doc", multiSelect: false, options: [{ label: "Yes, write it", description: "" }, { label: "Not yet", description: "" }] },
  ],
};

/** office-hours' shape: two AskUserQuestion questions, an offer mid-session, a prose question, then a short final answer. */
const interactive: Script = ({ results, users }) => {
  if (!results.has("toolu_ask")) return [{ type: "tool_use", id: "toolu_ask", name: "AskUserQuestion", input: ASK }];
  if (users.length < 2) return [{ type: "text", text: "Want a SECOND-OPINION-OFFER from an independent reviewer later.\n\nWhat's the strongest evidence you have that someone actually wants this?" }];
  return [{ type: "text", text: "FINAL: noted, thanks." }];
};

const ENTRY: SidecarTask = { user: { replies: { mode: "Building a startup", design_doc: "Yes, write the design doc.", demand: "PERSONA-ONLY-PHRASE: three dentists paid a deposit." } } };

describe.skipIf(!HAS_CLAUDE_CLI)("Claude Code adapter on the Agent SDK, against a fake upstream behind the metering proxy", () => {
  // Value: protects=the SDK path end to end: canUseTool answers AskUserQuestion from the sidecar by category, a prose question gets the scripted reply as the next user message, and turns hold only what the user saw; fails_when=answers do not reach the CLI, the prose reply is not sent, or persona text, tool input or the result leaks into turns; why_new=U10 scope (stream-json, canUseTool, replies by category) and GST-109; seam=claudeCodeDriver, harness; no_claim=how a real model behaves
  test("an interactive session: scripted answers by category, a prose reply, and user-visible turns only", async () => {
    const r = await run(interactive, { entry: ENTRY });
    expect(r.outcome.termination).toEqual({ kind: "completed" });
    expect(r.outcome.asked).toEqual(["mode", "design_doc", "demand"]);
    expect(r.outcome.turns).toHaveLength(3);
    expect(r.outcome.turns[0]).toContain("what's your goal with this?\n- Building a startup\n- Having fun");
    expect(r.outcome.turns[0]).toContain("Shall I write the design doc");
    expect(r.outcome.turns.at(-1)).toBe("FINAL: noted, thanks.");
    expect(r.outcome.turns.join("\n")).not.toContain("PERSONA-ONLY-PHRASE");
    const events = r.lines("usersim.ndjson");
    expect(events[0]).toMatchObject({ kind: "start", task: "t" });
    expect(events.filter((e) => e.kind === "ask").map((e) => [e.category, e.source, e.approves])).toEqual([["mode", "scripted", false], ["design_doc", "scripted", true]]);
    expect(events.find((e) => e.kind === "prose")).toMatchObject({ category: "demand", source: "scripted" });
    const answered = r.h.upstream.map((u) => JSON.stringify(u.body.messages ?? [])).find((m) => m.includes("toolu_ask") && m.includes("tool_result"));
    expect(answered).toContain("Yes, write the design doc.");
    expect(r.h.upstream.filter((u) => new URL(u.url).pathname.endsWith("/v1/messages")).every((u) => u.headers.get("x-api-key") === KEYS.ANTHROPIC_API_KEY && u.body.model === MODEL)).toBe(true);
    expect(r.meter.micros).toBeGreaterThan(0);
    const init = JSON.parse(readFileSync(join(r.h.dir, "host", "init.json"), "utf8"));
    expect(init.tools).toContain("AskUserQuestion");
    expect(init.tools).not.toContain("WebSearch");
  }, 180_000);

  // Value: protects=GST-109 over a real session: a must pattern seen only in the persona's reply does not pass, an offer made mid-session passes an interactive task and fails a final-answer task; fails_when=user or persona text is graded, or interactive grading falls back to the final answer; why_new=GST-109 decision 2; seam=parseClaudeCode via the adapter, gradeTrial; no_claim=none beyond protects
  test("GST-109: the offer mid-session passes, a phrase only the persona said does not", async () => {
    const r = await run(interactive, { entry: ENTRY });
    const rec = record(r.outcome);
    expect(gradeTrial(task({ must: ["second-opinion-offer"] }), rec).outcome).toBe("pass");
    expect(gradeTrial(task({ must: ["PERSONA-ONLY-PHRASE"] }), rec).outcome).toBe("fail");
    expect(gradeTrial(task({ must: ["dentists paid"] }), rec).outcome).toBe("fail");
    expect(gradeTrial(task({ interactive: false, must: ["second-opinion-offer"] }), rec).outcome).toBe("fail");
  }, 180_000);

  // Value: protects=the run-time catch: an AskUserQuestion in a task that declared no replies ends the trial as a missing cell naming the question, and nothing is answered for it; fails_when=the question gets an answer or the trial completes; why_new=interface v0.4 moved E_USER_TURNS_MISSING to run time; seam=canUseTool, UserSim.answerAsk; no_claim=none beyond protects
  test("an AskUserQuestion in a task with no replies is a missing cell, E_USER_TURNS_MISSING, naming the question", async () => {
    const r = await run(interactive, {});
    expect(r.outcome.termination).toEqual({ kind: "missing", code: "E_USER_TURNS_MISSING" });
    const calls = JSON.parse(readFileSync(join(r.h.dir, "host", "calls.json"), "utf8"));
    expect(calls.missing_question).toContain("what's your goal with this?");
    expect(r.lines("usersim.ndjson").find((e) => e.kind === "missing")).toMatchObject({ code: "E_USER_TURNS_MISSING" });
    expect(JSON.stringify(r.h.upstream.map((u) => u.body.messages))).not.toContain("Building a startup");
  }, 180_000);

  // Value: protects=skill-opened calls[]: a successful Skill call and a Read under the skill's root open it and count its files and bytes, and the none arm's failed Skill call does not; fails_when=a failed call counts, or reads are missed; why_new=U10 scope (skill-opened calls[]); seam=skillUse via the adapter; no_claim=none beyond protects
  test("a Skill call and a Read under the skill's root open it; a failed Skill call in the none arm does not", async () => {
    let root = "";
    const opener: Script = ({ results }) => {
      if (!results.has("toolu_skill")) return [{ type: "tool_use", id: "toolu_skill", name: "Skill", input: { skill: "demo" } }];
      if (!results.has("toolu_read")) return [{ type: "tool_use", id: "toolu_read", name: "Read", input: { file_path: join(root, "ref.md") } }];
      return [{ type: "text", text: "done" }];
    };
    const install = (home: string) => {
      root = join(home, ".claude", "skills", "demo");
      mkdirSync(root, { recursive: true });
      writeFileSync(join(root, "SKILL.md"), "---\nname: demo\ndescription: A demo skill for the adapter test.\n---\n# Demo\nRead ref.md.\n");
      writeFileSync(join(root, "ref.md"), "reference\n");
    };
    const skill = (home: string) => ({ name: "demo", roots: [join(home, ".claude", "skills", "demo")], dir: join(home, ".claude", "skills", "demo") });
    const arm = await run(opener, { setupHome: install, skill });
    expect(JSON.parse(readFileSync(join(arm.h.dir, "host", "calls.json"), "utf8")).calls.map((c: { tool: string; ok: boolean }) => [c.tool, c.ok])).toEqual([["Skill", true], ["Read", true]]);
    expect([arm.outcome.opened, arm.outcome.files_read, arm.outcome.loaded_bytes]).toEqual([true, ["SKILL.md", "ref.md"], statSync(join(root, "SKILL.md")).size + statSync(join(root, "ref.md")).size]);
    const none = await run(opener, { setupHome: (home) => (root = join(home, ".claude", "skills", "demo")), skill });
    expect(JSON.parse(readFileSync(join(none.h.dir, "host", "calls.json"), "utf8")).calls.map((c: { tool: string; ok: boolean }) => [c.tool, c.ok])).toEqual([["Skill", false], ["Read", false]]);
    expect([none.outcome.opened, none.outcome.files_read]).toEqual([false, []]);
  }, 300_000);

  // Value: protects=a ledger refusal on the proxy (CAP_STOP) ends the cell as a cap stop, never a pass, fail or crash; fails_when=the refusal is graded as the arm's failure; why_new=U10 conformance (cap stop) on the real CLI; seam=refusalIn, the adapter's API-error mapping; no_claim=none beyond protects
  test("a cap stop at the proxy ends the cell as cap_stop", async () => {
    const r = await run(interactive, { entry: ENTRY, capMicros: 1 });
    expect(r.outcome.termination).toEqual({ kind: "cap_stop" });
    expect(r.outcome.turns).toEqual([]);
  }, 180_000);

  // Value: protects=a host crash mid-run (the CLI killed after the session's first tool call) is an arm failure, harness_crash, with the turns seen so far kept, never a missing cell or a completed one; fails_when=the crash completes the trial or reads as a provider failure; why_new=U10 conformance (mid-run crash); seam=the adapter's catch and result mapping; no_claim=none beyond protects
  test("a CLI crash mid-run is an arm failure, harness_crash", async () => {
    const crashing: Script = ({ results }) => {
      if (!results.has("toolu_ls")) return [{ type: "text", text: "Looking around first." }, { type: "tool_use", id: "toolu_ls", name: "Bash", input: { command: "ls", description: "List files" } }];
      open.at(-1)!.crash();
      return [{ type: "text", text: "never seen" }];
    };
    const r = await run(crashing);
    expect(r.outcome.termination).toEqual({ kind: "arm_failure", failure: "harness_crash" });
    expect(r.outcome.turns).toEqual(["Looking around first."]);
  }, 180_000);

  // Value: protects=an ECONNRESET on the link from the CLI to the proxy after one text turn is a missing cell (UPSTREAM), an infra failure that never counts against the arm; fails_when=it reads as an arm failure or completes; why_new=GST-737 (#101's outside voice: an ECONNRESET after one text turn); seam=the adapter's API-error mapping; no_claim=a reset between the SDK and the CLI, which tests/trial/review/plan-scoring.test.ts covers
  test("a connection reset between the CLI and the proxy after one text turn is a missing cell, UPSTREAM", async () => {
    const h = harness(({ results }) => (results.size ? [{ type: "text", text: "never seen" }] : [{ type: "text", text: "Looking around first." }, { type: "tool_use", id: "toolu_ls", name: "Bash", input: { command: "ls", description: "List files" } }]));
    open.push(h);
    let main = 0;
    const front = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const body = Buffer.concat(chunks);
      const tools = (JSON.parse(body.toString() || "{}").tools ?? []) as { name: string }[];
      if (req.url!.split("?")[0]!.endsWith("/v1/messages") && tools.some((t) => t.name === "Bash") && ++main === 2) return req.socket.destroy();
      const r = await fetch(h.baseUrl + req.url, { method: req.method, headers: req.headers as Record<string, string>, ...(req.method === "GET" ? {} : { body }) });
      res.writeHead(r.status, Object.fromEntries(r.headers));
      res.end(Buffer.from(await r.arrayBuffer()));
    });
    await new Promise<void>((r) => front.listen(0, "127.0.0.1", () => r()));
    try {
      const binding = h.bind(MODEL);
      const driver = claudeCodeDriver({ model: MODEL, provider: "anthropic", proxy: { baseUrl: "http://127.0.0.1:" + (front.address() as { port: number }).port, slot: binding.slot, token: binding.token }, skill: null, out: join(h.dir, "host"), query: query as never });
      const outcome = await driver.run(h.session(join(h.dir, "work", "t"), join(h.dir, "home"), driver.env!), { id: "t", prompt: "Look around." }, 120_000);
      expect([main, outcome.termination, outcome.model_output, outcome.turns]).toEqual([2, { kind: "missing", code: "UPSTREAM" }, true, ["Looking around first."]]);
    } finally {
      front.close();
    }
  }, 180_000);

  // Value: protects=a subject key missing from the proxy's env leaves a missing cell naming E_KEY_MISSING, with nothing sent upstream or charged, and the CLI does not retry the refusal; fails_when=it reads as an arm failure, a pass or fail, or a generic UPSTREAM; why_new=U10 conformance (missing key); seam=refusalIn, CLAUDE_CODE_MAX_RETRIES; no_claim=preflight's own key check, which tests/cli covers
  test("a key missing from the proxy is a missing cell, E_KEY_MISSING", async () => {
    const { ANTHROPIC_API_KEY: _drop, ...rest } = KEYS;
    const started = Date.now();
    const r = await run(interactive, { entry: ENTRY, env: rest });
    expect(r.outcome.termination).toEqual({ kind: "missing", code: "E_KEY_MISSING" });
    expect(r.outcome.turns).toEqual([]);
    expect(r.h.upstream.filter((u) => new URL(u.url).pathname.endsWith("/v1/messages"))).toEqual([]);
    expect(r.meter.micros).toBe(0);
    // gstack-timing-ok: the bound only catches the CLI retrying the refusal, which backs off for minutes; one refused call takes seconds even on a slow machine
    expect(Date.now() - started).toBeLessThan(60_000);
  }, 180_000);

  // Value: protects=a Claude Code arm reaches an OpenRouter model through OpenRouter's Anthropic-compatible /v1/messages route: the proxy sends the OpenRouter key as a bearer, pins the row's routing and settles Anthropic-shaped usage at the row's price; fails_when=the route is refused, the key or routing is wrong, or cache tokens are priced as OpenAI counts them; why_new=particle-1 is a fixed rung in every lane (Garry's rule), on a Claude Code arm; seam=ROUTES.openrouter, priceRequest's format; no_claim=OpenRouter accepts provider routing on /v1/messages, which only a paid call can show
  test("particle-1 through OpenRouter's /v1/messages route: bearer key, pinned routing, usage priced in Anthropic's shape", async () => {
    const r = await run(({ results }) => (results.size ? [{ type: "text", text: "done" }] : [{ type: "text", text: "PARTICLE-OK" }]), { provider: "openrouter", model: "particle-ai/particle-1" });
    expect(r.outcome.termination).toEqual({ kind: "completed" });
    expect(r.outcome.turns).toEqual(["PARTICLE-OK"]);
    const sent = r.h.upstream.filter((u) => new URL(u.url).origin + new URL(u.url).pathname === "https://openrouter.ai/api/v1/messages");
    expect(sent.length).toBeGreaterThan(0);
    for (const u of sent) {
      expect(u.headers.get("authorization")).toBe("Bearer " + KEYS.OPENROUTER_API_KEY);
      expect(u.headers.get("x-api-key")).toBeNull();
      expect(u.body.model).toBe("particle-ai/particle-1");
      expect(u.body.provider).toEqual({ only: ["particle-ai"], allow_fallbacks: false, data_collection: "deny", max_price: { prompt: 0.1, completion: 1, request: 0, image: 0 } });
    }
    // 100 fresh input, 2000 cache read and 500 cache write tokens, 50 output, per call, at particle-1's row (cache reads at its cache-read rate; it has no write rate, so writes pay input).
    expect(r.meter.micros).toBe(r.meter.requests * Math.ceil(100 * 0.1 + 2000 * 0.003 + 500 * 0.1 + 50 * 1));
  }, 180_000);
});

describe("Claude Code adapter pieces", () => {
  // Value: protects=the agent env passes U9's allowlist and pins every model variable to the cell's model, with the bearer as ANTHROPIC_AUTH_TOKEN and the slot's provider path; fails_when=a name falls off the allowlist, a model variable is missing, or a provider key could ride in; why_new=U10 scope (model purity, CLAUDE_CODE_DISABLE_BUNDLED_SKILLS); seam=claudeCodeEnv; no_claim=none beyond protects
  test("the agent env pins the model, disables bundled skills and names the slot's provider path", () => {
    const env = claudeCodeEnv({ model: "particle-ai/particle-1", provider: "openrouter", proxy: { baseUrl: "http://10.231.7.2:8080/", slot: "s_abc", token: "gse_" + "x".repeat(43) } });
    expect(env.ANTHROPIC_BASE_URL).toBe("http://10.231.7.2:8080/s_abc/openrouter");
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe("gse_" + "x".repeat(43));
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    for (const k of ["ANTHROPIC_MODEL", "ANTHROPIC_SMALL_FAST_MODEL", "ANTHROPIC_DEFAULT_OPUS_MODEL", "ANTHROPIC_DEFAULT_SONNET_MODEL", "ANTHROPIC_DEFAULT_HAIKU_MODEL", "CLAUDE_CODE_SUBAGENT_MODEL"]) expect(env[k]).toBe("particle-ai/particle-1");
    expect(env.CLAUDE_CODE_DISABLE_BUNDLED_SKILLS).toBe("1");
    expect([env.CLAUDE_CODE_MAX_OUTPUT_TOKENS, env.CLAUDE_CODE_MAX_RETRIES]).toEqual([String(DEFAULT_MAX_OUTPUT_TOKENS), "0"]);
    expect(Object.keys(trialEnv("agent", env, [], {})).sort()).toEqual(Object.keys(env).sort());
  });

  // Value: protects=OpenRouter's Messages route is priced in Anthropic's usage shape, where its chat route keeps OpenAI's; fails_when=cache reads are dropped from the Messages cost or double-counted on chat; why_new=the OpenRouter /v1/messages route; seam=priceRequest's route argument, usageCost; no_claim=none beyond protects
  test("OpenRouter's Messages route reads usage in Anthropic's shape; its chat route keeps OpenAI's", () => {
    const body = { model: "particle-ai/particle-1", messages: [{ role: "user", content: "hi" }] };
    const usage = { input_tokens: 100, cache_read_input_tokens: 2000, cache_creation_input_tokens: 0, output_tokens: 50 };
    expect(usageCost(priceRequest("openrouter", body, 100, "/v1/messages"), usage)).toEqual({ micros: Math.ceil(100 * 0.1 + 2000 * 0.003 + 50), usage: { input: 100, output: 50, reasoning: 0, cache_read: 2000, cache_write: 0 } });
    expect(usageCost(priceRequest("openrouter", body, 100, "/v1/chat/completions"), { prompt_tokens: 2100, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 2000 } })!.micros).toBe(Math.ceil(100 * 0.1 + 2000 * 0.003 + 50));
  });

  // Value: protects=the proxy's refusal codes read out of an API error's text; fails_when=a code is missed or a substring of another word matches; why_new=U10 (cap stop, rejected keys, missing cells from the proxy); seam=refusalIn; no_claim=none beyond protects
  test("refusal codes come out of API error text", () => {
    expect(refusalIn('API Error: 402 {"code":"CAP_STOP","detail":"CAP_STOP: metering proxy: the lease is spent"}')).toBe("CAP_STOP");
    expect(refusalIn("API Error: 502 E_KEY_REJECTED: metering proxy: anthropic answered 401")).toBe("E_KEY_REJECTED");
    expect(refusalIn("API Error: 403 E_ALLOWANCE: route refused")).toBe("E_ALLOWANCE");
    expect(refusalIn("API Error: 500 something else")).toBeNull();
  });
});

describe.skipIf(!HAS_CLAUDE_CLI)("the PreToolUse hook on the real CLI, with a fixture's allow rules", () => {
  // Value: protects=every tool call reaches canUseTool even when the fixture's .claude/settings.json allows it, adds a settings hook that answers allow, and asks for bypassPermissions, so an allow rule cannot make AskUserQuestion skip the simulator and canUseTool stays the one approval path; fails_when=a call the fixture allows skips canUseTool (without the hook, Bash and Write do on CLI 2.1.314), or the question is answered by anything but the simulator; why_new=GST-273 (U10b; GSTA-35's open item on allow rules); seam=claudeCodeDriver's PreToolUse hook and canUseTool, with the SDK's query wrapped only to record canUseTool's calls; no_claim=settings the agent writes mid-session
  test("a fixture allow rule, settings hook and permission mode cannot route a tool call around canUseTool", async () => {
    const script: Script = ({ results }) => {
      if (!results.has("toolu_ask")) return [{ type: "tool_use", id: "toolu_ask", name: "AskUserQuestion", input: { questions: [{ question: "Which approach should we take?", header: "Approach", multiSelect: false, options: [{ label: "Approach A", description: "" }, { label: "Approach B", description: "" }] }] } }];
      if (!results.has("toolu_bash")) return [{ type: "tool_use", id: "toolu_bash", name: "Bash", input: { command: "echo routed", description: "Echo" } }];
      if (!results.has("toolu_write")) return [{ type: "tool_use", id: "toolu_write", name: "Write", input: { file_path: "notes.txt", content: "x" } }];
      return [{ type: "text", text: "FINAL: done." }];
    };
    const h = harness(script);
    open.push(h);
    const binding = h.bind(MODEL);
    const work = join(h.dir, "work", "t");
    mkdirSync(join(work, ".claude"), { recursive: true });
    const allow = 'echo \'{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}\'';
    writeFileSync(join(work, ".claude", "settings.json"), JSON.stringify({ permissions: { allow: ["AskUserQuestion", "Bash", "Write"], defaultMode: "bypassPermissions" }, hooks: { PreToolUse: [{ matcher: "*", hooks: [{ type: "command", command: allow }] }] } }));
    const seen: string[] = [];
    const recorded = (args: { prompt: unknown; options: Record<string, any> }) => {
      const can = args.options.canUseTool;
      return (query as any)({ ...args, options: { ...args.options, canUseTool: (name: string, input: unknown, opts: { toolUseID?: string }) => (seen.push(name + " " + opts?.toolUseID), can(name, input, opts)) } });
    };
    const driver = claudeCodeDriver({ model: MODEL, provider: "anthropic", proxy: { baseUrl: h.baseUrl, slot: binding.slot, token: binding.token }, entry: { user: { replies: { approach: "Approach B" } } }, skill: null, out: join(h.dir, "host"), query: recorded as never });
    const outcome = await driver.run(h.session(work, join(h.dir, "home"), driver.env!), { id: "t", prompt: "Go." }, 120_000);
    expect(outcome.termination).toEqual({ kind: "completed" });
    expect(seen).toEqual(["AskUserQuestion toolu_ask", "Bash toolu_bash", "Write toolu_write"]);
    const ask = readFileSync(join(h.dir, "host", "usersim.ndjson"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).find((e) => e.kind === "ask");
    expect(ask).toMatchObject({ category: "approach", source: "scripted", reply: "Approach B" });
    const answered = h.upstream.map((u) => JSON.stringify(u.body.messages ?? [])).find((m) => m.includes("toolu_ask") && m.includes("tool_result"));
    expect(answered).toContain("Approach B");
  }, 180_000);
});

describe.skipIf(!HAS_CLAUDE_CLI)("a settings hook that denies AskUserQuestion, on the real CLI", () => {
  // Value: protects=a fixture hook that denies AskUserQuestion with a reason cannot answer the question in the simulator's place: the CLI hands the reason to the model as the tool result without calling canUseTool, and the adapter voids the cell as E_APPROVAL_BYPASS; fails_when=the cell counts with an answer the simulator never gave; why_new=the read-only review of #69 (deny wins over the hook's ask on CLI 2.1.314); seam=claudeCodeDriver's hooked and approved sets, unapprovedAsks; no_claim=hooks on other events
  test("a deny reason in place of the simulator's answer voids the cell", async () => {
    const script: Script = ({ results }) => {
      if (!results.has("toolu_ask")) return [{ type: "tool_use", id: "toolu_ask", name: "AskUserQuestion", input: { questions: [{ question: "Which approach should we take?", header: "Approach", multiSelect: false, options: [{ label: "Approach A", description: "" }, { label: "Approach B", description: "" }] }] } }];
      return [{ type: "text", text: "FINAL: done." }];
    };
    const h = harness(script);
    open.push(h);
    const binding = h.bind(MODEL);
    const work = join(h.dir, "work", "t");
    mkdirSync(join(work, ".claude"), { recursive: true });
    const deny = 'echo \'{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"The user chose Approach A."}}\'';
    writeFileSync(join(work, ".claude", "settings.json"), JSON.stringify({ hooks: { PreToolUse: [{ matcher: "AskUserQuestion", hooks: [{ type: "command", command: deny }] }] } }));
    const driver = claudeCodeDriver({ model: MODEL, provider: "anthropic", proxy: { baseUrl: h.baseUrl, slot: binding.slot, token: binding.token }, entry: { user: { replies: { approach: "Approach B" } } }, skill: null, out: join(h.dir, "host"), query: query as never });
    const outcome = await driver.run(h.session(work, join(h.dir, "home"), driver.env!), { id: "t", prompt: "Go." }, 120_000);
    expect(outcome.termination).toEqual({ kind: "missing", code: "E_APPROVAL_BYPASS" });
    expect(JSON.stringify(h.upstream.map((u) => u.body.messages ?? []))).toContain("The user chose Approach A.");
  }, 180_000);
});

// Value: protects=the Captain's R1 ruling (#106 /ship): on the pinned Agent SDK, a CLI that exits 0 mid-turn ends the stream with no error and no result, which is infra (E_INFRA_FAILURE), in turn 1 and after a first result; fails_when=the stream's end reads as completed and scores a miss; why_new=#106 /ship pass 2 red team R1; seam=the driver's loop end and awaitingResult, the real SDK's ProcessTransport; no_claim=a real Claude Code CLI or Docker
describe("the pinned Agent SDK against a stub CLI that exits 0 mid-turn (keyless)", () => {
  const STUB = join(import.meta.dir, "fixtures", "stub-cli.cjs");
  for (const [mode, turns] of [["turn1", 0], ["turn2", 1]] as const) {
    test("an exit 0 with the turn's result still awaited is E_INFRA_FAILURE (" + mode + ")", async () => {
      const out = mkdtempSync(join(tmpdir(), "stub-cli-"));
      const session = {
        exec: () => ({ exitCode: 0, timedOut: false, stdout: "", stderr: "" }),
        spawn: (argv: string[], env: Record<string, string>) => spawn(process.execPath, [STUB, ...argv.slice(1)], { env: { ...env, PATH: process.env.PATH ?? "", STUB_MODE: mode }, stdio: ["pipe", "pipe", "pipe"] }),
        stop: () => {},
      };
      const driver = claudeCodeDriver({ model: MODEL, provider: "anthropic", proxy: { baseUrl: "http://127.0.0.1:9", slot: "s", token: "t" }, skill: null, out, freeform: async () => ({ text: "Go with your recommendation." }), entry: { user: { persona: "p" } } as never });
      const outcome = await driver.run(session as never, { id: "t", prompt: "Review the plan." }, 20_000);
      expect([outcome.termination, outcome.model_output, outcome.exit_code, outcome.signal, outcome.turns.length]).toEqual([{ kind: "missing", code: "E_INFRA_FAILURE" }, true, 0, null, turns]);
      expect(readFileSync(join(out, "cli-stderr.log"), "utf8")).toContain("adapter: infra failure, not the arm's: the SDK stream ended with no result for the turn (CLI exit code 0, signal null)\n");
    }, 30_000);
  }
});

// The failure rule's holes from #106's /ship, each driven through the real pinned Agent SDK against the stub CLI, keyless.
// The session spawns the stub for the CLI and the real `true` for the adapter's liveness probe, and counts both.
describe("GST-748: the failure rule on the pinned Agent SDK against a stub CLI (keyless)", () => {
  const STUB = join(import.meta.dir, "fixtures", "stub-cli.cjs");
  const INFRA = { kind: "missing", code: "E_INFRA_FAILURE" } as const;
  const stubRun = async (stub: Record<string, string>, o: { timeoutMs?: number; reset?: true; missing?: true; stderrDir?: true; stall?: number; clockStep?: number; persona?: number; stallOn?: { text: string; ms: number }; stderrError?: true } = {}) => {
    const out = mkdtempSync(join(tmpdir(), "stub-cli-"));
    if (o.stderrDir) mkdirSync(join(out, "cli-stderr.log"));
    const calls = { exec: 0, probe: 0 };
    const session = {
      exec: () => {
        calls.exec++;
        return { exitCode: 0, timedOut: false, stdout: "", stderr: "" };
      },
      spawn: (argv: string[], env: Record<string, string>) => {
        if (argv[0] === "true") {
          calls.probe++;
          return spawn("true", [], { stdio: ["pipe", "pipe", "pipe"] });
        }
        const child = o.missing ? spawn(join(out, "no-such-cli"), [], { stdio: ["pipe", "pipe", "pipe"] }) : spawn(process.execPath, [STUB, ...argv.slice(1)], { env: { ...env, PATH: process.env.PATH ?? "", ...stub }, stdio: ["pipe", "pipe", "pipe"] });
        if (o.reset) child.stdout!.once("data", () => setTimeout(() => child.stdout!.destroy(Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" })), 50));
        if (o.stderrError) child.stderr!.once("data", () => setTimeout(() => child.stderr!.destroy(new Error("synthetic stderr read error")), 20));
        const { stallOn } = o;
        let stalledOnce = false;
        if (stallOn) child.stdout!.on("data", (chunk) => {
          if (stalledOnce || !String(chunk).includes(stallOn.text)) return;
          stalledOnce = true;
          spawnSync("sleep", [String(stallOn.ms / 1000)]);
        });
        return child;
      },
      stop: () => {},
    };
    const driver = claudeCodeDriver({ model: MODEL, provider: "anthropic", proxy: { baseUrl: "http://127.0.0.1:9", slot: "s", token: "t" }, skill: null, out, freeform: async () => {
      if (o.persona) await new Promise((r) => setTimeout(r, o.persona));
      return { text: "Go with your recommendation." };
    }, entry: { user: { persona: "p" } } as never });
    const run = driver.run(session as never, { id: "t", prompt: "Review the plan." }, o.timeoutMs ?? 10_000);
    const { stall, clockStep } = o;
    if (stall) setTimeout(() => spawnSync("sleep", [String(stall / 1000)]), 100);
    const wall = Date.now;
    if (clockStep) setTimeout(() => (Date.now = () => wall() + clockStep), 100);
    const outcome = await Promise.race([run, new Promise<"hung">((r) => setTimeout(() => r("hung"), 15_000))]);
    Date.now = wall;
    const log = () => {
      try {
        return readFileSync(join(out, "cli-stderr.log"), "utf8");
      } catch {
        return null;
      }
    };
    return { outcome, calls, log };
  };
  const content = (blocks: unknown[], extra: Record<string, string> = {}) => ({ STUB_MODE: "content", STUB_CONTENT: JSON.stringify(blocks), ...extra });
  const scored = (o: Awaited<ReturnType<typeof stubRun>>["outcome"]) => (o === "hung" ? o : { termination: o.termination, model_output: o.model_output, exit_code: o.exit_code });

  // Value: protects=rule 2 (OV5): a text or thinking block with nothing in it is no model output, so a session that completes after it is a gap, not a miss; fails_when=an empty or whitespace text block, or an empty unsigned thinking block (which the pinned CLI passes through), sets model_output; why_new=#106 /ship fix-check 2 outside voice OV5; seam=the driver's producedOutput on the real SDK's messages; no_claim=a real provider's empty response
  test("OV5: empty text, whitespace text and empty thinking are no model output", async () => {
    for (const blocks of [[{ type: "text", text: "" }], [{ type: "text", text: " \n" }], [{ type: "thinking", thinking: "" }]]) {
      const r = await stubRun(content(blocks, { STUB_OUTPUT_TOKENS: "0" }));
      expect([blocks, scored(r.outcome)]).toEqual([blocks, { termination: { kind: "completed" }, model_output: false, exit_code: null }]);
    }
  }, 60_000);

  // Value: protects=rule 2 (adversarial 3): redacted thinking is thinking with something in it, so it is model output like a thinking block; fails_when=a session whose model produced only redacted thinking reads as no output and stops the arm; why_new=#106 /ship Step 11 adversarial 3; seam=producedOutput; no_claim=none beyond protects
  test("adversarial 3: redacted thinking, like thinking, is model output", async () => {
    for (const blocks of [[{ type: "redacted_thinking", data: "ENCRYPTED" }], [{ type: "thinking", thinking: "Read the plan first.", signature: "sig" }]]) {
      const r = await stubRun(content(blocks));
      expect([blocks, scored(r.outcome)]).toEqual([blocks, { termination: { kind: "completed" }, model_output: true, exit_code: null }]);
    }
  }, 60_000);

  // Value: protects=rule 4 (#106 Step 11 outside voice 2): a reset on the link to a running CLI is infra, though the SDK then closes the CLI's stdin and the CLI exits 1; fails_when=the exit that follows the SDK's own teardown reads as the CLI crashing on its own, harness_crash and a miss; why_new=#106 /ship Step 11 outside voice 2; seam=the driver's exit listener and catch, the real SDK's Query cleanup; no_claim=a real Claude Code CLI or docker exec
  test("outside voice 2: a reset, then a nonzero exit once the SDK closes stdin, is infra", async () => {
    const r = await stubRun({ STUB_MODE: "exit", STUB_EXIT: "1", STUB_ON_EOF: "1" }, { reset: true });
    expect(scored(r.outcome)).toEqual({ termination: INFRA, model_output: true, exit_code: null });
    expect(r.log()).toContain("adapter: infra failure, not the arm's: read ECONNRESET\n");
  }, 30_000);

  // Value: protects=rule 1 and adversarial 5: the CLI exiting 1 on its own after model output stays the arm's crash, and the liveness probe runs as a spawned process, never the session's synchronous exec; fails_when=the crash reads as infra, or the probe blocks the event loop through exec; why_new=#106 /ship Step 11 adversarial 5, outside voice 1; seam=answers(); no_claim=a real docker daemon
  test("control: a CLI that exits 1 on its own is the arm's crash, probed without exec", async () => {
    const r = await stubRun({ STUB_MODE: "exit", STUB_EXIT: "1" });
    expect(scored(r.outcome)).toEqual({ termination: { kind: "arm_failure", failure: "harness_crash" }, model_output: true, exit_code: 1 });
    expect(r.calls).toEqual({ exec: 0, probe: 1 });
  }, 30_000);

  // Value: protects=rule 4 (adversarial 2): docker exec's own exit codes 125, 126 and 127 name the launcher (the daemon, a CLI that cannot run or is missing), so they are infra; fails_when=they read as the CLI's crash, harness_crash and a miss; why_new=#106 /ship Step 11 adversarial 2; seam=LAUNCHER_EXITS in the driver's catch; no_claim=a real docker exec
  test("adversarial 2: an exit of 125, 126 or 127 is the launcher's, so infra", async () => {
    for (const code of ["125", "126", "127"]) {
      const r = await stubRun({ STUB_MODE: "exit", STUB_EXIT: code });
      expect([code, scored(r.outcome)]).toEqual([code, { termination: INFRA, model_output: true, exit_code: Number(code) }]);
    }
  }, 60_000);

  // Value: protects=rule 4 (OV4): a log the adapter cannot write (cli-stderr.log is a directory) never escapes the child's error handler, so a CLI that cannot spawn still settles as infra; fails_when=an unhandled EISDIR leaves driver.run unresolved; why_new=#106 /ship fix-check 2 outside voice OV4; seam=the driver's best-effort log; no_claim=a full disk
  test("OV4: an unwritable cli-stderr.log never hangs a session whose CLI cannot spawn", async () => {
    const r = await stubRun({}, { missing: true, stderrDir: true, timeoutMs: 1_500 });
    expect(scored(r.outcome)).toEqual({ termination: INFRA, model_output: false, exit_code: null });
  }, 30_000);

  // Value: protects=rule 4 and the adapter's records: the CLI's stderr lands in cli-stderr.log (the SDK reads none from a process it did not spawn), and a stderr log that cannot be written is the evaluator's failure, infra, not an uncaught error; fails_when=cli-stderr.log never holds the CLI's stderr, or a failed append throws out of the stream handler; why_new=GST-748 audit; seam=the driver's stderr drain; no_claim=a real Claude Code CLI's stderr
  test("the CLI's stderr is recorded, and an unwritable stderr log is infra", async () => {
    const ok = await stubRun(content([{ type: "text", text: "Done." }], { STUB_STDERR: "WARN-FROM-STUB\n", STUB_DELAY: "200" }));
    expect(scored(ok.outcome)).toEqual({ termination: { kind: "completed" }, model_output: true, exit_code: null });
    expect(ok.log()).toContain("WARN-FROM-STUB\n");
    const bad = await stubRun(content([{ type: "text", text: "Done." }], { STUB_STDERR: "WARN-FROM-STUB\n", STUB_DELAY: "200" }), { stderrDir: true });
    expect(scored(bad.outcome)).toEqual({ termination: INFRA, model_output: true, exit_code: null });
  }, 30_000);

  // Value: protects=rule 4 (#107 /ship outside voice OV2): a read error on the CLI's stderr stream is the evaluator's failure, infra, never an uncaught exception that ends every session in the process; fails_when=cli.stderr has no error listener
  test("OV2: a read error on the CLI's stderr stream is infra, never an uncaught exception", async () => {
    const r = await stubRun(content([{ type: "text", text: "Done." }], { STUB_STDERR: "WARN-FROM-STUB\n", STUB_DELAY: "300" }), { stderrError: true });
    expect(r.outcome === "hung" ? r.outcome : r.outcome.termination).toEqual(INFRA);
  }, 30_000);

  // Value: protects=rule 4 (adversarial 5, outside voice 1, B1): the evaluator's own event loop stalling (another session's synchronous docker step) never times the arm out: a CLI that answers at 300 ms under a 600 ms limit, while the loop stalls 700 ms, past the 60 ms credit cap, ends as infra (E_INFRA_FAILURE), never the arm's timeout; fails_when=the timer fires first after the stall and the healthy session scores a timeout, a miss; why_new=#106 /ship Step 11 outside voice 1, #107 /ship B1; seam=the driver's stall-compensated clock; no_claim=a real docker step
  // gstack-timing-ok: the stall and the delays are the repro; the assertion is on the outcome, never on elapsed time
  test("outside voice 1: an evaluator stall never times out a session that answered in time", async () => {
    const r = await stubRun(content([{ type: "text", text: "Done." }], { STUB_DELAY: "300" }), { timeoutMs: 600, stall: 700 });
    expect(r.outcome === "hung" ? r.outcome : [r.outcome.termination, r.outcome.credited_stall_ms]).toEqual([INFRA, 60]);
  }, 30_000);

  // Value: protects=rule 2 as amended by GSTA-2 (2026-11-01, #107 /ship red team RT2): a thinking block with a non-empty signature is model output whatever the display mode, and an empty unsigned one is not; fails_when=producedOutput reads only the thinking text, so a Claude 5 model's omitted or "updates" thinking scores a gap; why_new=#107 /ship red team RT2; seam=producedOutput on the real SDK's messages; no_claim=a real provider's signature
  test("A1: a signed empty thinking block is model output, an unsigned empty one is not", async () => {
    const signed = await stubRun(content([{ type: "thinking", thinking: "", signature: "EosnCkYICxIMMb3LzNrMu" }], { STUB_OUTPUT_TOKENS: "120" }));
    expect(scored(signed.outcome)).toEqual({ termination: { kind: "completed" }, model_output: true, exit_code: null });
    const unsigned = await stubRun(content([{ type: "thinking", thinking: "", signature: "" }], { STUB_OUTPUT_TOKENS: "0" }));
    expect(scored(unsigned.outcome)).toEqual({ termination: { kind: "completed" }, model_output: false, exit_code: null });
  }, 30_000);

  // Value: protects=rule 1 under amended rule 2 (#107 /ship red team RT2): a session whose only output is a signed empty thinking block and that then times out is the arm's timeout after model output, a miss, never a gap that stops the arm; fails_when=the signed block is not model output, so the timeout reads as before any output; why_new=#107 /ship red team RT2; seam=producedOutput and the session clock; no_claim=planScore itself, which plan-scoring.test.ts covers for a timeout after model output
  test("A1: a signed empty thinking block, then a timeout, is a timeout after model output (a miss)", async () => {
    const r = await stubRun(content([{ type: "thinking", thinking: "", signature: "EosnCkYICxIMMb3LzNrMu" }], { STUB_OUTPUT_TOKENS: "120", STUB_HANG: "1" }), { timeoutMs: 1_500 });
    expect(scored(r.outcome)).toEqual({ termination: { kind: "timeout" }, model_output: true, exit_code: null });
  }, 30_000);

  // Value: protects=B1 (GSTA-2 ruling on #107 /ship red team RT4): a stall within the cap, a tenth of the timeout, is credited to the session and recorded as credited_stall_ms, so an audit can see it; fails_when=the credit is not recorded; why_new=#107 /ship red team RT4; seam=the driver's stall-compensated clock; no_claim=a real docker step
  // gstack-timing-ok: the stall and the delays are the repro; the assertions are on the outcome and the recorded credit
  test("B1: a stall within the cap is credited and recorded", async () => {
    const r = await stubRun(content([{ type: "text", text: "Done." }], { STUB_DELAY: "1500" }), { timeoutMs: 8_000, stall: 700 });
    if (r.outcome === "hung") throw new Error("the session hung");
    expect(r.outcome.termination).toEqual({ kind: "completed" });
    expect(r.outcome.credited_stall_ms).toBeGreaterThan(0);
    expect(r.outcome.credited_stall_ms).toBeLessThan(800);
  }, 30_000);

  // Value: protects=B1 and rule 4 (GSTA-2 ruling on #107 /ship red team RT4): once the stall credit reaches its cap, a timeout is the evaluator's, infra (E_INFRA_FAILURE), never the arm's timeout, and the credit stops at the cap; fails_when=the credit is uncapped, or a timeout past the cap scores as the arm's; why_new=#107 /ship red team RT4; seam=the driver's stall-compensated clock; no_claim=a real docker step
  // gstack-timing-ok: the stall and the delays are the repro; the assertions are on the outcome and the recorded credit
  test("B1: a stall past the cap, then a timeout, is E_INFRA_FAILURE", async () => {
    const r = await stubRun(content([{ type: "text", text: "Done." }], { STUB_DELAY: "5000" }), { timeoutMs: 2_000, stall: 1_000 });
    if (r.outcome === "hung") throw new Error("the session hung");
    expect([r.outcome.termination, r.outcome.credited_stall_ms]).toEqual([INFRA, 200]);
    expect(r.log()).toContain("adapter: infra failure, not the arm's: the evaluator's event loop stalled past");
  }, 30_000);

  // Value: protects=B1 (GSTA-2 ruling on #107 /ship red team RT4): the session clock reads performance.now, so a wall-clock step either way neither extends nor shortens a session; fails_when=the clock reads Date.now and a backward step lets a late answer complete; why_new=#107 /ship red team RT4; seam=the driver's session clock; no_claim=a real NTP step
  // gstack-timing-ok: the step and the delays are the repro; the assertions are on the outcome and the recorded credit
  test("B1: a wall-clock step has no effect on the session clock", async () => {
    for (const clockStep of [-3_000, 3_000]) {
      const r = await stubRun(content([{ type: "text", text: "Done." }], { STUB_DELAY: "1500" }), { timeoutMs: 600, clockStep });
      if (r.outcome === "hung") throw new Error("the session hung");
      expect([clockStep, r.outcome.termination, r.outcome.credited_stall_ms]).toEqual([clockStep, { kind: "timeout" }, 0]);
    }
  }, 30_000);

  // Value: protects=B1 (#107 /ship pass 2 red team 1): an evaluator stall that ends just as the CLI's question arrives is measured before the persona's pause starts, so it is credited and never charged to the arm; fails_when=the pause starts first and the next tick drops the stall, so a session that answered in time can time out, a miss; why_new=#107 /ship pass 2 red team 1, ruled by GSTA-2; seam=the driver's stall-compensated clock and the persona pause, on the real SDK; no_claim=a real docker step
  // gstack-timing-ok: the stall and the persona's latency are the repro; the assertions are on the outcome and the recorded credit
  test("B1: a stall just before a persona pause is credited, not charged to the arm", async () => {
    const r = await stubRun(content([{ type: "text", text: "Shall I proceed with the plan?" }], { STUB_DELAY: "300", STUB_CONTENT_LATER: JSON.stringify([{ type: "text", text: "Done." }]) }), { timeoutMs: 20_000, persona: 300, stallOn: { text: '"type":"result"', ms: 1_200 } });
    if (r.outcome === "hung") throw new Error("the session hung");
    expect(r.outcome.termination).toEqual({ kind: "completed" });
    expect(r.outcome.credited_stall_ms).toBeGreaterThan(500);
  }, 60_000);

  // Value: protects=rule 1 and B1: with no stall, a CLI that answers past the limit is the arm's own timeout and nothing is credited; fails_when=the clock credits time it did not lose, or the timeout reads as infra; why_new=#107 /ship red team RT4; seam=the driver's session clock; no_claim=none beyond protects
  // gstack-timing-ok: the delay is the repro; the assertion is on the outcome and the recorded credit
  test("B1: with no stall, a CLI that answers past the limit is the arm's timeout", async () => {
    const r = await stubRun(content([{ type: "text", text: "Done." }], { STUB_DELAY: "1500" }), { timeoutMs: 600 });
    if (r.outcome === "hung") throw new Error("the session hung");
    expect([r.outcome.termination, r.outcome.credited_stall_ms]).toEqual([{ kind: "timeout" }, 0]);
  }, 30_000);
});

// What the pinned Claude Code CLI itself emits for these responses, keyless, behind the metering proxy and a fake upstream.
describe.skipIf(!HAS_CLAUDE_CLI)("GST-748: model output on the real pinned CLI (keyless)", () => {
  const cliRun = async (script: Script, stop?: (turn: { users: string[]; results: Map<string, unknown> }) => string | undefined) => {
    const h = harness(script, stop ? { stop } : {});
    open.push(h);
    const binding = h.bind(MODEL);
    const driver = claudeCodeDriver({ model: MODEL, provider: "anthropic", proxy: { baseUrl: h.baseUrl, slot: binding.slot, token: binding.token }, skill: null, out: join(h.dir, "host"), query: query as never });
    const outcome = await driver.run(h.session(join(h.dir, "work", "t"), join(h.dir, "home"), driver.env!), { id: "t", prompt: "Review the plan." }, 120_000);
    return { termination: outcome.termination, model_output: outcome.model_output, turns: outcome.turns };
  };

  // Value: protects=rule 2 on the real CLI (OV5, adversarial 3): the pinned CLI passes an empty thinking block through, which is no model output, and a redacted thinking block, which is; fails_when=empty thinking scores a miss, or redacted thinking a gap; why_new=#106 /ship OV5 and Step 11 adversarial 3; seam=the CLI's stream-json output and producedOutput; no_claim=a real provider
  test("empty thinking is no model output, redacted thinking is", async () => {
    expect(await cliRun(() => [{ type: "thinking", thinking: "" }])).toEqual({ termination: { kind: "completed" }, model_output: false, turns: [] });
    expect(await cliRun(() => [{ type: "redacted_thinking", data: "ENCRYPTED" }])).toEqual({ termination: { kind: "completed" }, model_output: true, turns: [] });
  }, 180_000);

  // Value: protects=rule 2 as amended by GSTA-2 on the real CLI (#107 /ship red team RT2): the pinned CLI asks for thinking with display "updates", so a Claude 5 model's reasoning arrives as a thinking block with empty text and a signature, which is model output; an unsigned empty block is not; fails_when=producedOutput reads only the thinking text; why_new=#107 /ship red team RT2; seam=the CLI's stream-json output and producedOutput; no_claim=a real provider's signature
  test("A1: a signed empty thinking block is model output on the real CLI, an unsigned one is not", async () => {
    expect(await cliRun(() => [{ type: "thinking", thinking: "", signature: "EosnCkYICxIMMb3LzNrMu" }])).toEqual({ termination: { kind: "completed" }, model_output: true, turns: [] });
    expect(await cliRun(() => [{ type: "thinking", thinking: "" }])).toEqual({ termination: { kind: "completed" }, model_output: false, turns: [] });
  }, 180_000);

  // Value: protects=rule 2 (adversarial 3, investigate): a response cut at max_tokens reaches the driver as an ordinary assistant message with its text, never only as a max_output_tokens error, so it counts as model output; fails_when=the pinned CLI moves the truncated text onto an error message the driver skips; why_new=#106 /ship Step 11 adversarial 3; seam=the pinned CLI's max_tokens recovery; no_claim=a real provider's truncation
  test("a response cut at max_tokens is model output on an ordinary message", async () => {
    let calls = 0;
    const r = await cliRun(() => [{ type: "text", text: ++calls === 1 ? "Partial review of the pl" : "Done." }], () => (calls === 1 ? "max_tokens" : undefined));
    expect(r).toEqual({ termination: { kind: "completed" }, model_output: true, turns: ["Partial review of the pl", "Done."] });
  }, 180_000);
});

// Value: protects=GEVA-109's per-arm system prompt and the run's turn cap on the pinned Agent SDK: sdk-default sends what no option sends (the SDK's initialize systemPrompt [""]), claude-code-preset sends the SDK's preset, and the cap reaches the CLI's argv; fails_when=sdk-default passes any systemPrompt option, the preset is dropped, or --max-turns is not the configured number; why_new=GEVA-108 runs control-preset and control-sdk-default in one invocation; seam=the driver's query options, the real SDK's initialize request
describe("GEVA-109: system prompt and turn cap on the pinned Agent SDK against a stub CLI (keyless)", () => {
  const STUB = join(import.meta.dir, "fixtures", "stub-cli.cjs");
  const record = async (o: { systemPrompt?: "sdk-default" | "claude-code-preset"; maxTurns?: number }) => {
    const out = mkdtempSync(join(tmpdir(), "stub-cli-"));
    const file = join(out, "record.ndjson");
    const session = {
      exec: () => ({ exitCode: 0, timedOut: false, stdout: "", stderr: "" }),
      spawn: (argv: string[], env: Record<string, string>) => (argv[0] === "true" ? spawn("true", [], { stdio: ["pipe", "pipe", "pipe"] }) : spawn(process.execPath, [STUB, ...argv.slice(1)], { env: { ...env, PATH: process.env.PATH ?? "", STUB_MODE: "content", STUB_CONTENT: JSON.stringify([{ type: "text", text: "done" }]), STUB_RECORD: file }, stdio: ["pipe", "pipe", "pipe"] })),
      stop: () => {},
    };
    const driver = claudeCodeDriver({ model: MODEL, provider: "anthropic", proxy: { baseUrl: "http://127.0.0.1:9", slot: "s", token: "t" }, skill: null, out, ...o });
    const outcome = await driver.run(session as never, { id: "t", prompt: "Go." }, 20_000);
    const lines = readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const { request_id: _id, ...init } = lines.find((l) => l.request?.subtype === "initialize")!;
    return { outcome, argv: lines[0].argv as string[], init, recorded: JSON.parse(readFileSync(join(out, "init.json"), "utf8")).system_prompt };
  };
  test("sdk-default sends the SDK's empty system prompt, the preset sends claude_code, and the cap reaches the CLI", async () => {
    const plain = await record({});
    const explicit = await record({ systemPrompt: "sdk-default" });
    const preset = await record({ systemPrompt: "claude-code-preset", maxTurns: 7 });
    expect(plain.outcome.termination).toEqual({ kind: "completed" });
    expect(plain.init.request.systemPrompt).toEqual([""]);
    expect([explicit.argv, explicit.init]).toEqual([plain.argv, plain.init]);
    expect([plain.recorded, explicit.recorded, preset.recorded]).toEqual(["sdk-default", "sdk-default", "claude-code-preset"]);
    expect([plain.argv.filter((a) => a.startsWith("--max-turns")), preset.argv.filter((a) => a.startsWith("--max-turns"))]).toEqual([["--max-turns=60"], ["--max-turns=7"]]);
    expect(preset.argv.filter((a) => !plain.argv.includes(a))).toEqual(["--max-turns=7"]);
    const { systemPrompt: _empty, ...rest } = plain.init.request;
    expect(preset.init.request).toEqual(rest);
  }, 60_000);
  test("sessionKind unattended adds GSTACK_SESSION_KIND to the agent env, and unset adds none", () => {
    const base = { model: MODEL, provider: "anthropic" as const, proxy: { baseUrl: "http://p", slot: "s", token: "t" } };
    expect(claudeCodeEnv(base).GSTACK_SESSION_KIND).toBeUndefined();
    expect(claudeCodeEnv({ ...base, sessionKind: "unattended" }).GSTACK_SESSION_KIND).toBe("unattended");
  });
});

// Value: protects=GEVA-109 on the real CLI: under claude-code-preset the first model request carries Claude Code's system guidance, under sdk-default only the SDK's short blocks, and a configured turn cap ends a session the way an error_max_turns result does; fails_when=the preset never reaches the request, sdk-default grows a system prompt, or the cap is ignored; why_new=GEVA-108 runs both system prompts in one invocation; seam=the driver's options through the pinned SDK into CLI 2.1.314
describe.skipIf(!HAS_CLAUDE_CLI)("GEVA-109: system prompt and turn cap on the real CLI", () => {
  const text: Script = () => [{ type: "text", text: "FINAL: done." }];
  const system = (r: Awaited<ReturnType<typeof run>>) => {
    const first = r.h.upstream.find((u) => new URL(u.url).pathname.endsWith("/v1/messages") && JSON.stringify(u.body.messages ?? []).includes("Go."))!;
    return (first.body.system as { text: string }[]).map((b) => b.text);
  };
  test("claude-code-preset sends Claude Code's guidance; sdk-default sends only the SDK's two short blocks", async () => {
    const plain = system(await run(text, { prompt: "Go.", options: { systemPrompt: "sdk-default" } }));
    const preset = system(await run(text, { prompt: "Go.", options: { systemPrompt: "claude-code-preset" } }));
    expect(plain.length).toBe(2);
    expect(plain[1]).toBe("You are a Claude agent, built on Anthropic's Claude Agent SDK.");
    expect(plain.join("").length).toBeLessThan(500);
    expect(preset.join("").length).toBeGreaterThan(5000);
  }, 240_000);
  test("a configured turn cap reaches the CLI and ends the session as error_max_turns", async () => {
    let n = 0;
    const loop: Script = () => [{ type: "tool_use", id: "toolu_loop" + n++, name: "Bash", input: { command: "true" } }];
    const r = await run(loop, { prompt: "Go.", options: { maxTurns: 2 } });
    const result = r.lines("transcript.ndjson").filter((m) => m.type === "result").at(-1);
    const asked = r.h.upstream.filter((u) => new URL(u.url).pathname.endsWith("/v1/messages") && JSON.stringify(u.body.messages ?? []).includes("toolu_loop") === false && JSON.stringify(u.body.messages ?? []).includes("Go.")).length;
    const calls = r.h.upstream.filter((u) => new URL(u.url).pathname.endsWith("/v1/messages") && JSON.stringify(u.body.messages ?? []).includes("Go.")).length;
    expect([result.subtype, asked, calls]).toEqual(["error_max_turns", 1, 2]);
    expect(r.outcome.termination).toEqual({ kind: "completed" });
  }, 240_000);
});

// Value: protects=the R2 build's cap stops and reader rows on the pinned Agent SDK (R48 follow-ups prereg, section 3.6; GEVA-116's note on #119): with capStops a session the turn cap ends is turn_cap and one the slot's allowance stops is allowance_stop, without it both keep today's records (completed, and a missing E_ALLOWANCE cell), another E_ALLOWANCE refusal stays a missing cell, and the transcript the driver writes names each subagent launch for readerUsage; fails_when=error_max_turns stays completed under capStops, a default run's record changes, a model-allowlist refusal reads as an allowance stop, or the SDK drops the launch, task_started or task_notification messages; why_new=R2 runs --max-turns 200 and a $40 allowance; seam=the driver's result and API error branches through the real SDK 0.3.314, and the real metering proxy's refusal text; no_claim=the real CLI, which the describe below covers
describe("R2 build: cap stops and reader launches on the pinned Agent SDK against a stub CLI (keyless)", () => {
  const STUB = join(import.meta.dir, "fixtures", "stub-cli.cjs");
  const stub = async (env: Record<string, string>, o: Partial<Pick<ClaudeCodeOptions, "maxTurns" | "capStops">> = {}) => {
    const out = mkdtempSync(join(tmpdir(), "stub-cli-"));
    const file = join(out, "record.ndjson");
    const session = {
      exec: () => ({ exitCode: 0, timedOut: false, stdout: "", stderr: "" }),
      spawn: (argv: string[], e: Record<string, string>) => (argv[0] === "true" ? spawn("true", [], { stdio: ["pipe", "pipe", "pipe"] }) : spawn(process.execPath, [STUB, ...argv.slice(1)], { env: { ...e, PATH: process.env.PATH ?? "", STUB_RECORD: file, ...env }, stdio: ["pipe", "pipe", "pipe"] })),
      stop: () => {},
    };
    const driver = claudeCodeDriver({ model: MODEL, provider: "anthropic", proxy: { baseUrl: "http://127.0.0.1:9", slot: "s", token: "t" }, skill: null, out, ...o });
    const outcome = await driver.run(session as never, { id: "t", prompt: "Go." }, 20_000);
    const argv = JSON.parse(readFileSync(file, "utf8").split("\n")[0]!).argv as string[];
    return { outcome, argv, transcript: readTranscript(readFileSync(join(out, "transcript.ndjson"), "utf8")) };
  };
  /** The metering proxy's own refusal for a call, as the CLI prints it: "API Error: <status> <problem body>". */
  const refusal = async (o: { allowance: number; model?: string }) => {
    const h = harness(() => [{ type: "text", text: "ok" }]);
    open.push(h);
    const b = h.proxy.bind({ cell: { run_id: "run-test", arm: "after", task: "t", model: MODEL, trial: 0, attempt: 1 }, models: ["anthropic:" + MODEL], allowance_micros: o.allowance });
    const res = await fetch(h.baseUrl + "/" + b.slot + "/anthropic/v1/messages", { method: "POST", headers: { "content-type": "application/json", "anthropic-version": "2023-06-01", authorization: "Bearer " + b.token }, body: JSON.stringify({ model: o.model ?? MODEL, max_tokens: 1024, messages: [{ role: "user", content: "hi" }] }) });
    return { status: res.status, text: "API Error: " + res.status + " " + (await res.text()) };
  };

  test("the turn cap ends a capStops session as turn_cap and a default one as completed, as today", async () => {
    const capped = await stub({ STUB_MODE: "turns" }, { maxTurns: 3, capStops: true });
    const today = await stub({ STUB_MODE: "turns" }, { maxTurns: 3 });
    expect(capped.argv.filter((a) => a.startsWith("--max-turns"))).toEqual(["--max-turns=3"]);
    expect(capped.transcript.filter((m) => m.type === "assistant").length).toBe(3);
    expect(capped.transcript.at(-1)).toMatchObject({ type: "result", subtype: "error_max_turns" });
    expect(capped.outcome.termination).toEqual({ kind: "turn_cap" });
    expect(today.outcome.termination).toEqual({ kind: "completed" });
    const { termination: _a, ...rest } = capped.outcome;
    const { termination: _b, ...base } = today.outcome;
    expect(rest).toEqual(base);
  }, 60_000);

  test("the slot's allowance stops a capStops session as allowance_stop; a default one stays a missing E_ALLOWANCE cell, and so does any other E_ALLOWANCE refusal", async () => {
    const spent = await refusal({ allowance: 100 });
    expect(spent.status).toBe(402);
    expect(spent.text).toMatch(ALLOWANCE_SPENT);
    const allowlist = await refusal({ allowance: 50_000_000, model: "claude-opus-5-5" });
    expect(allowlist.status).toBe(403);
    expect(allowlist.text).toContain("E_ALLOWANCE");
    const run = (r: { status: number; text: string }, capStops?: boolean) => stub({ STUB_MODE: "apierror", STUB_API_ERROR: r.text, STUB_API_STATUS: String(r.status) }, capStops ? { capStops } : {});
    const capped = await run(spent, true);
    const today = await run(spent);
    expect(capped.outcome.termination).toEqual({ kind: "allowance_stop" });
    expect(today.outcome.termination).toEqual({ kind: "missing", code: "E_ALLOWANCE" });
    expect((await run(allowlist, true)).outcome.termination).toEqual({ kind: "missing", code: "E_ALLOWANCE" });
    const { termination: _a, ...rest } = capped.outcome;
    const { termination: _b, ...base } = today.outcome;
    expect(rest).toEqual(base);
  }, 60_000);

  test("the SDK passes each Agent launch, task_started and task_notification into the transcript, so readerUsage names the readers", async () => {
    const map = loadReaderMap(READER_MAP) as Exclude<ReturnType<typeof loadReaderMap>, { problem: string }>;
    const specialist = (name: string) => "You are a specialist code reviewer. Read the checklist at ~/.claude/skills/gstack/review/specialists/" + name + ".md, then run the diff.";
    const agents = [
      { id: "tu_test", prompt: specialist("testing"), started: true, tokens: 1200 },
      { id: "tu_api", prompt: specialist("api-contract"), started: true, tokens: 900 },
      { id: "tu_state", prompt: specialist("state-machines"), started: true },
      { id: "tu_adv", prompt: "Read the diff for this branch. Think like an attacker and a chaos engineer. Your job is to find ways this code will fail in production.", started: true, tokens: 700 },
      { id: "tu_refused", prompt: specialist("security"), started: false },
    ];
    const r = await stub({ STUB_MODE: "agents", STUB_AGENTS: JSON.stringify(agents), STUB_FINAL: "done" });
    expect(r.outcome.termination).toEqual({ kind: "completed" });
    expect(readerUsage(r.transcript, map.map)).toEqual([
      { reader: "adversarial-native", launches: 1, total_tokens: 700 },
      { reader: "api-contract", launches: 1, total_tokens: 900 },
      { reader: "state-machines", launches: 1, total_tokens: null },
      { reader: "testing", launches: 1, total_tokens: 1200 },
    ]);
    const none = await stub({ STUB_MODE: "agents", STUB_AGENTS: "[]", STUB_FINAL: "done" });
    expect(readerUsage(none.transcript, map.map)).toEqual([]);
  }, 60_000);
});

// Value: protects=the same cap stops and reader launches on the real CLI 2.1.314 behind the real metering proxy: the slot's allowance refuses a call and the session ends as allowance_stop under capStops; Agent launches stream task_started, subagent messages and task_notification usage that readerUsage reads; fails_when=the CLI rewords the refusal past ALLOWANCE_SPENT, retries it, or stops streaming subagent messages; why_new=the #101 and #106 lesson (test against the real pinned binaries); seam=CLI 2.1.314 and MeteringProxy; no_claim=a real model
describe.skipIf(!HAS_CLAUDE_CLI)("R2 build: cap stops and reader launches on the real CLI", () => {
  test("the turn cap ends a capStops session as turn_cap", async () => {
    let n = 0;
    const loop: Script = () => [{ type: "tool_use", id: "toolu_cap" + n++, name: "Bash", input: { command: "true" } }];
    const r = await run(loop, { prompt: "Go.", options: { maxTurns: 2, capStops: true } });
    expect(r.lines("transcript.ndjson").filter((m) => m.type === "result").at(-1).subtype).toBe("error_max_turns");
    expect(r.outcome.termination).toEqual({ kind: "turn_cap" });
  }, 240_000);

  test("the slot's allowance ends a capStops session as allowance_stop", async () => {
    let n = 0;
    const loop: Script = () => [{ type: "tool_use", id: "toolu_spend" + n++, name: "Bash", input: { command: "true" } }];
    const h = harness(loop);
    open.push(h);
    const model = "claude-opus-5-5";
    const b = h.proxy.bind({ cell: { run_id: "run-test", arm: "after", task: "t", model, trial: 0, attempt: 1 }, models: ["anthropic:" + model], allowance_micros: 1_000_000 });
    const driver = claudeCodeDriver({ model, provider: "anthropic", proxy: { baseUrl: h.baseUrl, slot: b.slot, token: b.token }, skill: null, out: join(h.dir, "host"), query: query as never, capStops: true });
    const outcome = await driver.run(h.session(join(h.dir, "work", "t"), join(h.dir, "home"), driver.env!), { id: "t", prompt: "Go." }, 120_000);
    expect(outcome.termination).toEqual({ kind: "allowance_stop" });
    expect(outcome.agent_turns).toBeLessThan(60);
    const refusals = readFileSync(join(h.dir, "journal.ndjson"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((l) => l.kind === "refusal");
    expect(refusals.map((l) => l.code)).toEqual(["E_ALLOWANCE"]);
    expect(refusals[0].reason).toMatch(ALLOWANCE_SPENT);
  }, 240_000);

  test("Agent launches reach the transcript with their task usage, and readerUsage names them", async () => {
    const map = loadReaderMap(READER_MAP) as Exclude<ReturnType<typeof loadReaderMap>, { problem: string }>;
    const script: Script = (t) => {
      const first = t.users[0] ?? "";
      if (first.includes("specialist code reviewer")) return [{ type: "text", text: "NO FINDINGS" }];
      if (first.includes("chaos engineer")) return [{ type: "text", text: "Recommendation: Ship as-is because nothing fails." }];
      if (first.includes("Explore")) return [{ type: "text", text: "Found it." }];
      if (!t.results.has("toolu_t")) return [
        { type: "tool_use", id: "toolu_t", name: "Agent", input: { description: "testing specialist", prompt: "You are a specialist code reviewer. Read the checklist at ~/.claude/skills/gstack/review/specialists/testing.md", subagent_type: "general-purpose" } },
        { type: "tool_use", id: "toolu_a", name: "Agent", input: { description: "adversarial", prompt: "Think like an attacker and a chaos engineer. Your job is to find ways this code will fail in production.", subagent_type: "general-purpose" } },
        { type: "tool_use", id: "toolu_o", name: "Agent", input: { description: "look around", prompt: "Explore the repository layout.", subagent_type: "general-purpose" } },
      ];
      return [{ type: "text", text: "FINAL: done." }];
    };
    const r = await run(script, { model: "claude-opus-5-5", prompt: "Go." });
    expect(r.outcome.termination).toEqual({ kind: "completed" });
    const readers = readerUsage(r.lines("transcript.ndjson"), map.map);
    expect(readers.map((u) => [u.reader, u.launches])).toEqual([["adversarial-native", 1], ["other", 1], ["testing", 1]]);
    expect(readers.every((u) => typeof u.total_tokens === "number" && u.total_tokens > 0)).toBe(true);
  }, 240_000);
});


// GST-734: Claude Code 2.1.314 backgrounds Agent calls by default, and while its input stays open it takes a turn of its own
// when a background task finishes or a ScheduleWakeup fires. The stub copies those messages (fixtures/stub-cli.cjs,
// STUB_MODE=background); the real CLI tests below drive the same rules through CLI 2.1.314 and the metering proxy.
const REPORT = "Report.\n\n```json\n[{\"file\": \"src/a.ts\", \"line\": 3, \"severity\": \"high\", \"claim\": \"off by one\", \"evidence\": \"reader a\"}]\n```";

describe("GST-734: background work on the pinned Agent SDK against a stub CLI (keyless)", () => {
  const STUB = join(import.meta.dir, "fixtures", "stub-cli.cjs");
  const bg = async (spec: Record<string, unknown>, o: { waitMs?: number | null; timeoutMs?: number; capStops?: boolean; host?: boolean } = {}) => {
    const out = mkdtempSync(join(tmpdir(), "stub-bg-"));
    const session = {
      exec: () => ({ exitCode: 0, timedOut: false, stdout: "", stderr: "" }),
      spawn: (argv: string[], e: Record<string, string>) => (argv[0] === "true" ? spawn("true", [], { stdio: ["pipe", "pipe", "pipe"] }) : spawn(process.execPath, [STUB, ...argv.slice(1)], { env: { ...e, PATH: process.env.PATH ?? "", STUB_MODE: "background", STUB_BG: JSON.stringify(spec), STUB_FINAL: REPORT }, stdio: ["pipe", "pipe", "pipe"] })),
      stop: () => {},
    };
    const wait = o.waitMs === null ? {} : { backgroundWaitMs: o.waitMs ?? BACKGROUND_WAIT_MS };
    const proxy = { baseUrl: "http://127.0.0.1:9", slot: "s", token: "t" };
    const driver = o.host ? hostDriver({ host: "claude", model: MODEL, provider: "anthropic", proxy, interactive: false, skill: null, out, ...wait, ...(o.capStops ? { capStops: true } : {}) }) : claudeCodeDriver({ model: MODEL, provider: "anthropic", proxy, skill: null, out, ...wait, ...(o.capStops ? { capStops: true } : {}) });
    const outcome = await driver.run(session as never, { id: "t", prompt: "Review the branch." }, o.timeoutMs ?? 20_000);
    const log = existsSync(join(out, "cli-stderr.log")) ? readFileSync(join(out, "cli-stderr.log"), "utf8") : "";
    const read = readFileSync(join(out, "transcript.ndjson"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
    // What the session read, in order, up to where it stopped reading: each result, each reader landing and each wakeup firing.
    const events = read.flatMap((m) => (m.type === "result" ? ["result"] : m.subtype === "task_notification" ? ["landed " + m.tool_use_id] : m.type === "command_lifecycle" && m.state === "started" ? ["wakeup"] : []));
    return { outcome, log, out, events, last: read.at(-1) };
  };
  const agent = (id: string, delay: number | null, extra: Record<string, unknown> = {}) => ({ id, delay, ...extra });

  // Value: protects=the canary: a session that backgrounds two readers and ends its turn stays open, the CLI's own turns deliver each reader, and the report it writes last is the session's final turn; fails_when=the driver ends the session at the first result (R2's 7 missing gstack-full sessions, GEVA-151) or scores a turn written before the readers landed; why_new=GST-734; seam=the driver's result handling on the real SDK; no_claim=a real model
  test("canary: two background readers and an ended turn still produce the report, a clean end", async () => {
    const r = await bg({ readers: [agent("tu_a", 300), agent("tu_b", 800)] });
    expect(r.outcome.termination).toEqual({ kind: "completed" });
    expect(r.outcome.turns).toEqual(["Waiting.", "Still waiting.", REPORT]);
    expect(parseFindings(r.outcome)).toMatchObject({ kind: "findings", findings: [{ file: "src/a.ts", claim: "off by one" }] });
    expect(r.outcome.session_end).toMatchObject({ cause: "clean", pending: [], released_wakeups: [] });
    expect(r.outcome.session_end!.waited_ms).toBeGreaterThanOrEqual(700);
  }, 30_000);

  // Value: protects=GSTA-2's C1 ruling on #141: the hold is opt-in, so a runner that sets no wait (skill-eval's run-host.ts and every runner but review-units, which reach the driver through hostDriver) ends at the turn's result as before and records no session_end; fails_when=a session with no wait set waits on its background work or records session_end; why_new=the red team on #141 (skill-eval sessions held with no setting or record); seam=hostDriver and the driver's backgroundWaitMs; no_claim=a real model
  test("with no wait set, the session ends at the turn's result as before, through hostDriver too", async () => {
    for (const host of [false, true]) {
      const r = await bg({ readers: [agent("tu_a", 300)] }, { waitMs: null, host });
      expect([r.outcome.termination, r.outcome.turns, "session_end" in r.outcome]).toEqual([{ kind: "completed" }, ["Waiting."], false]);
      expect(r.log).toContain('background work still out (local_agent "reader tu_a"); this run sets no background wait, so nothing held it');
      expect(r.events).toEqual(["result"]);
    }
  }, 30_000);

  // Value: protects=a background Bash task holds the session like an Agent task, and a level that arrives after its turn (the SDK leaves its order open) never strands a session that has nothing left to wait for; fails_when=only Agent tasks are waited on, or a stale level holds a finished task until the deadline; why_new=GST-734 (tstack and a local_bash in stacks round 1); seam=the level and task_notification handling; no_claim=a real model
  test("a background Bash task holds the session too, and a late level never strands it", async () => {
    const bash = await bg({ readers: [agent("tu_sh", 300, { kind: "local_bash" })] });
    expect([bash.outcome.termination, bash.outcome.turns.at(-1), bash.outcome.session_end?.cause]).toEqual([{ kind: "completed" }, REPORT, "clean"]);
    const late = await bg({ readers: [agent("tu_a", 300), agent("tu_b", 600)], late_level: true }, { waitMs: 10_000 });
    expect([late.outcome.termination, late.outcome.turns.at(-1), late.outcome.session_end?.cause]).toEqual([{ kind: "completed" }, REPORT, "clean"]);
    expect(late.last).toMatchObject({ type: "result", result: REPORT });
  }, 30_000);

  // Value: protects=a reader that never returns hits the configured deadline, which is a missing cell (E_BACKGROUND_DEADLINE), so review-units scores it as a coverage gap and never as the arm finding nothing; fails_when=the session hangs to its timeout, completes on its last waiting turn, or the record misses the cause; why_new=GST-734; seam=the driver's background deadline; no_claim=a real model
  test("a reader that never returns ends at the deadline as a missing cell, never as finding nothing", async () => {
    const r = await bg({ readers: [agent("tu_a", 300), agent("tu_b", null)] }, { waitMs: 1_500 });
    expect(r.outcome.termination).toEqual({ kind: "missing", code: "E_BACKGROUND_DEADLINE" });
    expect(r.outcome.session_end).toMatchObject({ cause: "deadline", pending: ['local_agent "reader tu_b"'], released_wakeups: [] });
    expect(r.outcome.session_end!.waited_ms).toBeGreaterThanOrEqual(1_500);
    expect(r.log).toContain("the session sat idle 1500 ms in all waiting on its background work");
    expect(r.log).toContain("E_BACKGROUND_DEADLINE, not the arm's");
    expect(parseFindings(r.outcome)).toEqual({ kind: "incomplete", reason: "the session ended missing (E_BACKGROUND_DEADLINE)" });
  }, 30_000);

  // Value: protects=GSTA-2's B1 condition on #141 round 2: the idle clock stops at the system init the CLI sends when it starts a turn of its own (2.1.314 sends one on every task-notification turn, checked on the real CLI), so the model's time before its first message never counts toward the background deadline; fails_when=the clock runs on to the first assistant message, so a slow first message pushes a session past the deadline; why_new=the round-2 specialist on #141; seam=the driver's init handling; no_claim=a real model
  test("the idle clock stops at the CLI's turn init, not at the first assistant message", async () => {
    const r = await bg({ readers: [agent("tu_a", 300, { think: 1_500 })] }, { waitMs: 1_000 });
    expect([r.outcome.termination, r.outcome.turns.at(-1), r.outcome.session_end?.cause]).toEqual([{ kind: "completed" }, REPORT, "clean"]);
    expect(r.outcome.session_end!.waited_ms).toBeLessThan(1_000);
  }, 30_000);

  // Value: protects=GSTA-2's ruling A on the #141 fix-check: a held session whose result, task notification and next turn's init reach the driver in one write still records a wait, so it scores from its report and not from the acknowledgement after it; fails_when=waited_ms rounds that sub-millisecond idle down to 0 and the held rule never applies
  test("a held session whose result, notification and init arrive in one write still counts as waited", async () => {
    const ack = "The background check finished; my findings above stand.";
    const r = await bg({ readers: [agent("tu_a", 0, { at_result: true })], first: REPORT, final: ack });
    expect([r.outcome.termination, r.outcome.turns, r.outcome.session_end?.cause]).toEqual([{ kind: "completed" }, [REPORT, ack], "clean"]);
    expect(r.outcome.session_end!.waited_ms).toBeGreaterThan(0);
    const transcript = readFileSync(join(r.out, "transcript.ndjson"), "utf8");
    expect(mainAgentTurns(transcript)).toEqual([0, 1]);
    expect(codeParse(r.outcome, mainAgentTexts(transcript), mainAgentTurns(transcript))).toMatchObject({ parse: { kind: "findings" }, scored_turn: { rule: "held", index: 0, of: 2 } });
  }, 30_000);

  // Value: protects=ruling A's one risk: rounding the wait up never turns a session that never sat idle on held work into a waited one; fails_when=such a session records waited_ms above 0
  test("a session that never sat idle on held work records waited_ms 0 exactly", async () => {
    for (const r of [await bg({ readers: [] }), await bg({ readers: [agent("tu_a", 300, { ambient: true })] })]) expect(r.outcome.session_end?.waited_ms).toBe(0);
  }, 30_000);

  // Value: protects=ruling B (GEVA-2, 2026-11-02): a ScheduleWakeup set while nothing ran holds the session until it fires, one set while readers ran is their fallback and is released once they finish, with when it was set, its delay and what ran recorded, and a stopped wakeup holds nothing; fails_when=a fallback wakeup keeps the session open past the report (R2's 3 fallback sessions would end on a later turn), a lone wakeup is not waited for, or a released one goes unrecorded; why_new=GST-734 ruling B; seam=the driver's wakeup tracking; no_claim=a real model
  test("a wakeup set while nothing ran holds the session; a fallback set while readers ran is released and recorded", async () => {
    const alone = await bg({ readers: [], wakeup: { delay: 1_000, text: REPORT } });
    expect([alone.outcome.termination, alone.outcome.turns, alone.outcome.session_end?.cause, alone.outcome.session_end?.released_wakeups]).toEqual([{ kind: "completed" }, ["Waiting.", REPORT], "clean", []]);
    expect(alone.events).toEqual(["result", "wakeup", "result"]);
    const fallback = await bg({ readers: [agent("tu_a", 300)], wakeup: { delay: 8_000, text: "WAKE: nothing left." } });
    expect([fallback.outcome.termination, fallback.outcome.turns.at(-1), fallback.outcome.session_end?.cause, fallback.outcome.session_end?.pending]).toEqual([{ kind: "completed" }, REPORT, "clean", []]);
    expect(fallback.events).toEqual(["result", "landed tu_a", "result"]);
    const [released] = fallback.outcome.session_end!.released_wakeups;
    expect(fallback.outcome.session_end!.released_wakeups).toHaveLength(1);
    expect(released).toMatchObject({ delay_s: 60, running: ['local_agent "reader tu_a"'] });
    expect(Date.parse(released!.fires_at) - Date.parse(released!.set_at)).toBeGreaterThan(7_000);
    const stopped = await bg({ readers: [], wakeup: { delay: 8_000, text: REPORT, stop: true } });
    expect([stopped.outcome.turns, stopped.outcome.session_end?.cause]).toEqual([["Waiting."], "clean"]);
    expect(stopped.outcome.session_end?.waited_ms).toBe(0);
  }, 30_000);

  // Value: protects=ambient tasks (not activity) and tasks a subagent launched (its own business) never hold the session, so they cannot push a finished session into the deadline; fails_when=either is waited on; why_new=GST-734 (the SDK's ambient flag and parent_task_id); seam=the level filter; no_claim=a real model
  test("ambient tasks and tasks a subagent launched never hold the session", async () => {
    const r = await bg({ readers: [agent("tu_amb", null, { ambient: true }), agent("tu_nest", null, { nested: true })] }, { waitMs: 10_000 });
    expect([r.outcome.termination, r.outcome.turns, r.outcome.session_end?.cause]).toEqual([{ kind: "completed" }, ["Waiting."], "clean"]);
    expect(r.outcome.session_end?.waited_ms).toBe(0);
  }, 30_000);

  // Value: protects=spend and cap rules during the wait: a refusal on a turn the CLI takes while readers are out still ends the session as a cap stop, as allowance_stop under capStops, or as a missing E_ALLOWANCE cell without it, and the record says tasks were pending; a session timeout while the session sits idle on held work ends it at the deadline (E_BACKGROUND_DEADLINE, GSTA-2's B1 ruling on #141), and one during an active turn stays the arm's timeout; fails_when=a longer session escapes its allowance, a cap stop becomes a deadline or a completion, or the timeout is swallowed; why_new=GST-734 brief (spend and cap rules still hold); seam=the refusal and timeout paths with a wait open; no_claim=the proxy, which the real CLI test drives
  test("a cap stop and an allowance stop keep their terminations while readers are out; a timeout is the arm's mid-turn and the deadline while idle", async () => {
    const out = [agent("tu_a", 300), agent("tu_b", null)];
    const cap = await bg({ readers: out, wake_error: "API Error: 402 {\"code\":\"CAP_STOP\",\"message\":\"the lease is spent\"}" });
    expect([cap.outcome.termination, cap.outcome.session_end?.cause, cap.outcome.session_end?.pending]).toEqual([{ kind: "cap_stop" }, "tasks_pending", ['local_agent "reader tu_b"']]);
    const spent = "API Error: 402 {\"code\":\"E_ALLOWANCE\",\"message\":\"the slot's allowance of $1.00 cannot hold this call's worst case\"}";
    expect(spent).toMatch(ALLOWANCE_SPENT);
    const capped = await bg({ readers: out, wake_error: spent }, { capStops: true });
    expect([capped.outcome.termination, capped.outcome.session_end?.cause]).toEqual([{ kind: "allowance_stop" }, "tasks_pending"]);
    const today = await bg({ readers: out, wake_error: spent });
    expect(today.outcome.termination).toEqual({ kind: "missing", code: "E_ALLOWANCE" });
    const late = await bg({ readers: [agent("tu_b", null)] }, { waitMs: 60_000, timeoutMs: 1_500 });
    expect([late.outcome.termination, late.outcome.session_end?.cause, late.outcome.session_end?.pending]).toEqual([{ kind: "missing", code: "E_BACKGROUND_DEADLINE" }, "deadline", ['local_agent "reader tu_b"']]);
    expect(late.log).toContain("the session's timeout came while it sat idle");
    const busy = await bg({ readers: [agent("tu_a", 300, { stall: true }), agent("tu_b", null)] }, { waitMs: 60_000, timeoutMs: 1_500 });
    expect([busy.outcome.termination, busy.outcome.session_end?.cause, busy.outcome.session_end?.pending]).toEqual([{ kind: "timeout" }, "tasks_pending", ['local_agent "reader tu_b"']]);
    const opening = await bg({ readers: [agent("tu_a", 300, { stall: "init" }), agent("tu_b", null)] }, { waitMs: 60_000, timeoutMs: 1_500 });
    expect([opening.outcome.termination, opening.outcome.session_end?.cause]).toEqual([{ kind: "timeout" }, "tasks_pending"]);
  }, 60_000);
});

// Value: protects=the same background rules on the real CLI 2.1.314 behind the real metering proxy: the CLI takes a turn of its own when a background Agent or Bash task lands, so the canary's report is the final turn; a reader that never returns hits the deadline; a reader that spends the slot's allowance still ends the session as allowance_stop; fails_when=the CLI stops re-entering the turn on a task notification, renames the level or notification messages, or the driver ends the session at the first result; why_new=GST-734 and the #101/#106 lesson (test against the real pinned binaries); seam=CLI 2.1.314 and MeteringProxy; no_claim=a real model
describe.skipIf(!HAS_CLAUDE_CLI)("GST-734: background work on the real CLI", () => {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const launch = (id: string, name: string) => ({ type: "tool_use" as const, id, name: "Agent", input: { description: "reader " + name, prompt: "READER-" + name + ": review the diff.", subagent_type: "general-purpose", run_in_background: true } });
  const readers = (wait: Record<string, () => Promise<unknown>>): Script => async (t) => {
    const first = t.users[0] ?? "";
    for (const [name, hold] of Object.entries(wait)) if (first.includes("READER-" + name)) return (await hold(), [{ type: "text", text: "FINDING-" + name }]);
    if (!t.results.has("toolu_r" + Object.keys(wait)[0])) return Object.keys(wait).map((name) => launch("toolu_r" + name, name));
    const all = JSON.stringify(t.body.messages);
    return [{ type: "text", text: Object.keys(wait).every((name) => all.includes("FINDING-" + name)) ? REPORT : "The readers are running in the background. I will write the report when they return." }];
  };

  test("canary: two background readers and an ended turn still produce the report", async () => {
    const r = await run(readers({ A: () => sleep(1_000), B: () => sleep(2_500) }), { prompt: "Review the branch.", options: { backgroundWaitMs: BACKGROUND_WAIT_MS } });
    expect(r.outcome.termination).toEqual({ kind: "completed" });
    expect(r.outcome.turns.at(-1)).toBe(REPORT);
    expect(parseFindings(r.outcome)).toMatchObject({ kind: "findings", findings: [{ claim: "off by one" }] });
    expect(r.outcome.session_end).toMatchObject({ cause: "clean", pending: [], released_wakeups: [] });
    const results = r.lines("transcript.ndjson").filter((m) => m.type === "result");
    expect(results.length).toBeGreaterThanOrEqual(3);
    expect(results.slice(1).every((m) => m.origin?.kind === "task-notification")).toBe(true);
  }, 240_000);

  test("a background Bash task holds the session until its output lands", async () => {
    const script: Script = (t) => {
      if (!t.results.has("toolu_sh")) return [{ type: "tool_use", id: "toolu_sh", name: "Bash", input: { command: "sleep 2", description: "slow check", run_in_background: true } }];
      const all = JSON.stringify(t.body.messages);
      return [{ type: "text", text: all.includes("<task-notification>") && all.includes("toolu_sh</tool-use-id>") && all.includes("<status>completed</status>") ? REPORT : "Waiting on the background command." }];
    };
    const r = await run(script, { prompt: "Review the branch.", options: { backgroundWaitMs: BACKGROUND_WAIT_MS } });
    expect([r.outcome.termination, r.outcome.turns.at(-1), r.outcome.session_end?.cause]).toEqual([{ kind: "completed" }, REPORT, "clean"]);
  }, 240_000);

  test("a reader that never returns ends at the deadline as a missing cell, E_BACKGROUND_DEADLINE", async () => {
    let release = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const h = harness(readers({ A: () => sleep(500), B: () => gate }));
    open.push(h);
    const b = h.bind(MODEL);
    const driver = claudeCodeDriver({ model: MODEL, provider: "anthropic", proxy: { baseUrl: h.baseUrl, slot: b.slot, token: b.token }, skill: null, out: join(h.dir, "host"), query: query as never, backgroundWaitMs: 4_000 });
    const outcome = await driver.run(h.session(join(h.dir, "work", "t"), join(h.dir, "home"), driver.env!), { id: "t", prompt: "Review the branch." }, 120_000).finally(release);
    expect(outcome.termination).toEqual({ kind: "missing", code: "E_BACKGROUND_DEADLINE" });
    expect(readFileSync(join(h.dir, "host", "cli-stderr.log"), "utf8")).toContain("the session sat idle 4000 ms in all waiting on its background work");
    expect(outcome.session_end).toMatchObject({ cause: "deadline", pending: ['local_agent "reader B"'] });
    expect(outcome.session_end!.waited_ms).toBeGreaterThanOrEqual(4_000);
    expect(parseFindings(outcome).kind).toBe("incomplete");
  }, 240_000);

  test("a ScheduleWakeup set while a reader ran is its fallback: released once the reader lands, and recorded", async () => {
    const script: Script = async (t) => {
      if ((t.users[0] ?? "").includes("READER-")) return (await sleep(1_000), [{ type: "text", text: "FINDING-A" }]);
      if (!t.results.has("toolu_rA")) return [launch("toolu_rA", "A")];
      if (!t.results.has("toolu_wake")) return [{ type: "tool_use", id: "toolu_wake", name: "ScheduleWakeup", input: { delaySeconds: 1200, reason: "fallback in case the reader hangs", prompt: "continue the review", noop: true } }];
      return [{ type: "text", text: JSON.stringify(t.body.messages).includes("FINDING-A") ? REPORT : "The reader is running in the background." }];
    };
    const r = await run(script, { prompt: "Review the branch.", options: { backgroundWaitMs: BACKGROUND_WAIT_MS } });
    const read = r.lines("transcript.ndjson");
    expect([read.at(-1)?.type, read.some((m) => m.wakeup_source === "loop_wakeup")]).toEqual(["result", false]);
    expect([r.outcome.termination, r.outcome.turns.at(-1), r.outcome.session_end?.cause, r.outcome.session_end?.pending]).toEqual([{ kind: "completed" }, REPORT, "clean", []]);
    expect(r.outcome.session_end!.released_wakeups).toHaveLength(1);
    expect(r.outcome.session_end!.released_wakeups[0]).toMatchObject({ delay_s: 1200, running: ['local_agent "reader A"'] });
  }, 240_000);

  // The CLI fires a wakeup on a minute boundary, 60 to 120 s out, which CI's 10-minute job cannot spare; set GSE_SLOW_CLI=1 to run it.
  test.skipIf(!process.env.GSE_SLOW_CLI)("a ScheduleWakeup set while nothing ran holds the session until the CLI fires it", async () => {
    const script: Script = (t) => {
      if (t.users.some((u) => u.includes("WAKE-PROMPT"))) return [{ type: "text", text: REPORT }];
      if (!t.results.has("toolu_wake")) return [{ type: "tool_use", id: "toolu_wake", name: "ScheduleWakeup", input: { delaySeconds: 60, reason: "check the build again", prompt: "WAKE-PROMPT: check the build", noop: false } }];
      return [{ type: "text", text: "I will check back when the wakeup fires." }];
    };
    const r = await run(script, { prompt: "Review the branch.", options: { backgroundWaitMs: BACKGROUND_WAIT_MS } });
    expect([r.outcome.termination, r.outcome.turns.at(-1), r.outcome.session_end?.cause, r.outcome.session_end?.released_wakeups]).toEqual([{ kind: "completed" }, REPORT, "clean", []]);
    expect(r.lines("transcript.ndjson").some((m) => m.type === "command_lifecycle" && m.state === "started" && m.wakeup_source === "loop_wakeup")).toBe(true);
  }, 240_000);

  test("a reader that spends the slot's allowance while the main agent waits still ends the session as allowance_stop", async () => {
    let n = 0;
    const script: Script = (t) => {
      if ((t.users[0] ?? "").includes("READER-")) return [{ type: "tool_use", id: "toolu_spend" + n++, name: "Bash", input: { command: "true" } }];
      if (!t.results.has("toolu_rA")) return [launch("toolu_rA", "A")];
      return [{ type: "text", text: "The reader is running in the background. I will write the report when it returns." }];
    };
    const h = harness(script);
    open.push(h);
    const model = "claude-opus-5-5";
    const b = h.proxy.bind({ cell: { run_id: "run-test", arm: "after", task: "t", model, trial: 0, attempt: 1 }, models: ["anthropic:" + model], allowance_micros: 1_000_000 });
    const driver = claudeCodeDriver({ model, provider: "anthropic", proxy: { baseUrl: h.baseUrl, slot: b.slot, token: b.token }, skill: null, out: join(h.dir, "host"), query: query as never, capStops: true, backgroundWaitMs: BACKGROUND_WAIT_MS });
    const outcome = await driver.run(h.session(join(h.dir, "work", "t"), join(h.dir, "home"), driver.env!), { id: "t", prompt: "Review the branch." }, 120_000);
    expect(outcome.termination).toEqual({ kind: "allowance_stop" });
    const refusals = readFileSync(join(h.dir, "journal.ndjson"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((l) => l.kind === "refusal");
    expect(refusals.length).toBeGreaterThan(0);
    expect(refusals.every((l) => l.code === "E_ALLOWANCE")).toBe(true);
    expect(readFileSync(join(h.dir, "host", "transcript.ndjson"), "utf8")).toContain('"parent_tool_use_id":"toolu_rA"');
  }, 240_000);
});
