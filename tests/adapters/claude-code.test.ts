import { afterEach, describe, expect, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { join } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { claudeCodeDriver, claudeCodeEnv, refusalIn, type ClaudeCodeOptions } from "../../src/adapters/claude-code/driver.ts";
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

async function run(script: Script, o: { entry?: SidecarTask; skill?: (home: string) => ClaudeCodeOptions["skill"]; provider?: "anthropic" | "openrouter"; model?: string; capMicros?: number; env?: Record<string, string>; prompt?: string; setupHome?: (home: string) => void } = {}) {
  const h = harness(script, { ...(o.capMicros === undefined ? {} : { capMicros: o.capMicros }), ...(o.env ? { env: o.env } : {}) });
  open.push(h);
  const model = o.model ?? MODEL;
  const provider = o.provider ?? "anthropic";
  const binding = h.bind(model, provider);
  const home = join(h.dir, "home");
  o.setupHome?.(home);
  const driver = claudeCodeDriver({ model, provider, proxy: { baseUrl: h.baseUrl, slot: binding.slot, token: binding.token }, ...(o.entry ? { entry: o.entry } : {}), skill: o.skill?.(home) ?? null, out: join(h.dir, "host"), query: query as never });
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
