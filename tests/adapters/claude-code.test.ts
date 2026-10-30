import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
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
      expect(u.body.provider).toEqual({ max_price: { prompt: 0.25, completion: 1, request: 0, image: 0 } });
    }
    // 100 fresh input, 2000 cache read and 500 cache write tokens, 50 output, per call, at particle-1's row (no cache rates: input price).
    expect(r.meter.micros).toBe(r.meter.requests * Math.ceil(2600 * 0.25 + 50 * 1));
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
    expect(usageCost(priceRequest("openrouter", body, 100, "/v1/messages"), usage)).toEqual({ micros: Math.ceil(2100 * 0.25 + 50), usage: { input: 100, output: 50, reasoning: 0, cache_read: 2000, cache_write: 0 } });
    expect(usageCost(priceRequest("openrouter", body, 100, "/v1/chat/completions"), { prompt_tokens: 2100, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 2000 } })!.micros).toBe(Math.ceil(2100 * 0.25 + 50));
  });

  // Value: protects=the proxy's refusal codes read out of an API error's text; fails_when=a code is missed or a substring of another word matches; why_new=U10 (cap stop, rejected keys, missing cells from the proxy); seam=refusalIn; no_claim=none beyond protects
  test("refusal codes come out of API error text", () => {
    expect(refusalIn('API Error: 402 {"code":"CAP_STOP","detail":"CAP_STOP: metering proxy: the lease is spent"}')).toBe("CAP_STOP");
    expect(refusalIn("API Error: 502 E_KEY_REJECTED: metering proxy: anthropic answered 401")).toBe("E_KEY_REJECTED");
    expect(refusalIn("API Error: 403 E_ALLOWANCE: route refused")).toBe("E_ALLOWANCE");
    expect(refusalIn("API Error: 500 something else")).toBeNull();
  });
});
