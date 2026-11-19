import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { NextUser } from "../../src/adapters/claude-code/driver.ts";
import { catalogEffort, codexArgs, codexConfig, codexDriver, codexEnv, type CodexOptions } from "../../src/adapters/codex/driver.ts";
import { hostDriver } from "../../src/adapters/host.ts";
import type { SidecarTask } from "../../src/skill-eval/contract/sidecar.ts";
import { trialEnv } from "../../src/trial/env.ts";
import { seedStateRoot } from "../../src/trial/state-root.ts";
import type { PersonaAnswer } from "../../src/usersim/persona.ts";
import { HAS_CODEX_CLI, harness, KEYS, type Harness, type ResponsesScript } from "./harness.ts";

let open: Harness[] = [];
afterEach(() => {
  for (const h of open) h.close();
  open = [];
});

const MODEL = "gpt-6.1-sol";

async function run(script: ResponsesScript, o: { skill?: (home: string) => CodexOptions["skill"]; provider?: "openai" | "openrouter"; model?: string; capMicros?: number; env?: Record<string, string>; setupHome?: (home: string) => void; effort?: string | null; entry?: SidecarTask; nextUser?: (texts: string[]) => Promise<NextUser>; freeform?: (persona: string, question: string) => Promise<PersonaAnswer>; sessionKind?: "unattended"; stateRoot?: boolean } = {}) {
  const h = harness(() => [], { responses: script, ...(o.capMicros === undefined ? {} : { capMicros: o.capMicros }), ...(o.env ? { env: o.env } : {}) });
  open.push(h);
  const model = o.model ?? MODEL;
  const provider = o.provider ?? "openai";
  const binding = h.bind(model, provider);
  const home = join(h.dir, "home");
  const work = join(h.dir, "work", "t");
  o.setupHome?.(home);
  const proxy = { baseUrl: h.baseUrl, slot: binding.slot, token: binding.token };
  const effort = o.effort === undefined ? "low" : o.effort;
  const extra = { ...(o.entry ? { entry: o.entry } : {}), ...(o.nextUser ? { nextUser: o.nextUser } : {}), ...(o.freeform ? { freeform: o.freeform } : {}), ...(o.sessionKind ? { sessionKind: o.sessionKind } : {}) };
  const driver = o.sessionKind
    ? hostDriver({ host: "codex", model, provider, proxy, interactive: false, effort, skill: o.skill?.(home) ?? null, out: join(h.dir, "host"), ...extra })
    : codexDriver({ model, provider, proxy, effort, skill: o.skill?.(home) ?? null, out: join(h.dir, "host"), ...extra });
  mkdirSync(work, { recursive: true });
  const state = o.stateRoot ? seedStateRoot(work, work) : {};
  const session = h.session(work, home, { ...state, ...driver.env });
  const outcome = await driver.run(session, { id: "t", prompt: "Summarize the skill." }, 120_000);
  const meter = await h.proxy.finalize(binding.meter_id);
  const read = (name: string) => JSON.parse(readFileSync(join(h.dir, "host", name), "utf8"));
  const calls = () => read("calls.json");
  const responses = () => h.upstream.filter((u) => new URL(u.url).pathname.endsWith("/v1/responses"));
  return { h, home, work, outcome, meter, calls, read, responses };
}

/** The user's own message texts a request carries, Codex's injected context left out. */
const userTexts = (body: Record<string, any>): string[] => (body.input ?? []).filter((it: any) => it.type === "message" && it.role === "user").map((it: any) => (it.content ?? []).map((c: any) => c.text ?? "").join("")).filter((t: string) => t && !t.startsWith("<"));

const QUESTION = { title: "Which approach should we take?", options: ["Approach A", "Approach B"] };

/** A model that asks QUESTION through request_user_input_async, ends its turn waiting, and answers with what the user said. */
const asking: ResponsesScript = ({ outputs, users }) => {
  if (users.length === 1 && !outputs.has("call_q")) return [{ type: "call", id: "call_q", name: "request_user_input_async", args: { questions: [QUESTION] } }];
  if (users.length === 1) return [{ type: "message", text: "I asked which approach you want; I will wait for your answer." }];
  return [{ type: "message", text: "FINAL: going with " + users.at(-1) }];
};

const final: ResponsesScript = () => [{ type: "message", text: "FINAL: summarized." }];

describe.skipIf(!HAS_CODEX_CLI)("Codex adapter on codex exec --json, against a fake upstream behind the metering proxy", () => {
  // Value: protects=the Codex path end to end: exec --json through the proxy, a shell read under the skill's root opens it, agent messages are the turns and the last is the final answer, no bundled system skill or web search reaches the model; fails_when=the provider definition misses the proxy, the key or model is wrong, bundled skills load, or a shell read is missed; why_new=U10 scope (the Codex adapter on codex exec --json); seam=codexDriver, parseCodex, skillUse; no_claim=how a real model behaves
  test("a non-interactive session: a shell read opens the skill, agent messages are the turns", async () => {
    let root = "";
    const script: ResponsesScript = ({ outputs }) => {
      if (!outputs.has("call_read")) return [{ type: "message", text: "Reading the skill." }, { type: "shell", id: "call_read", cmd: "cat " + join(root, "SKILL.md") }];
      return [{ type: "message", text: "FINAL: it says demo." }];
    };
    const install = (home: string) => {
      root = join(home, ".codex", "skills", "demo");
      mkdirSync(root, { recursive: true });
      writeFileSync(join(root, "SKILL.md"), "---\nname: demo\ndescription: A demo skill for the adapter test.\n---\n# Demo\n");
    };
    const r = await run(script, { setupHome: install, skill: (home) => ({ name: "demo", roots: [join(home, ".codex", "skills", "demo")], dir: join(home, ".codex", "skills", "demo") }) });
    expect(r.outcome.termination).toEqual({ kind: "completed" });
    expect(r.outcome.turns).toEqual(["Reading the skill.", "FINAL: it says demo."]);
    expect(r.calls().calls.map((c: { tool: string; ok: boolean }) => [c.tool, c.ok])).toEqual([["shell", true]]);
    expect([r.outcome.opened, r.outcome.files_read, r.outcome.loaded_bytes]).toEqual([true, ["SKILL.md"], statSync(join(root, "SKILL.md")).size]);
    expect(r.outcome.usage).toEqual({ input: 200, output: 80, reasoning: 20, cache_read: 4000, cache_write: 0 });
    const sent = r.responses();
    expect(sent.length).toBe(2);
    for (const u of sent) {
      expect(new URL(u.url).origin + new URL(u.url).pathname).toBe("https://api.openai.com/v1/responses");
      expect(u.headers.get("authorization")).toBe("Bearer " + KEYS.OPENAI_API_KEY);
      expect(u.body.model).toBe(MODEL);
    }
    const body = JSON.stringify(sent[0]!.body);
    expect(body).toContain("demo: A demo skill for the adapter test.");
    expect(body).not.toContain("skills/.system");
    expect(body).not.toContain('"type":"web_search');
    expect(r.meter.micros).toBeGreaterThan(0);
  }, 180_000);

  // Value: protects=a question the model asks through request_user_input_async reaches the user simulator, its scripted answer goes back as the next user message by codex exec resume on the same thread, and the session runs on to a completed end with the question in asked and questions.json; fails_when=the question is missed, answered by nobody, answered in a new thread, or the session ends at the question; why_new=interactive tasks on Codex (E_INTERACTIVE_HOST lifted); seam=codexDriver's question loop, UserSim.answerAsk, codexArgs resume; no_claim=how a real model asks
  test("a request_user_input_async question gets the simulated answer as the next user message, by exec resume", async () => {
    const r = await run(asking, { entry: { user: { replies: { approach: "Approach B" } } } });
    expect(r.outcome.termination).toEqual({ kind: "completed" });
    expect(r.outcome.asked).toEqual(["approach"]);
    expect(r.outcome.turns.at(-1)).toBe("FINAL: going with Approach B");
    const sent = r.responses();
    const answered = sent.findIndex((u) => userTexts(u.body).includes("Approach B"));
    expect(answered).toBeGreaterThan(0);
    expect(userTexts(sent[answered]!.body)).toEqual(["Summarize the skill.", "Approach B"]);
    expect(sent.slice(0, answered).some((u) => JSON.stringify(u.body.input).includes('"call_id":"call_q"'))).toBe(true);
    const init = r.read("init.json");
    expect(init.argv).not.toContain("--ephemeral");
    expect(init.resume_argv.length).toBe(1);
    expect(init.resume_argv[0].slice(-3, -1)).toEqual(["resume", init.thread_id]);
    expect(r.read("questions.json")).toEqual([{ call_id: "call_q", turn: 1, questions: [QUESTION], answer: "Approach B" }]);
    const events = readFileSync(join(r.h.dir, "host", "usersim.ndjson"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(events.filter((e) => e.kind === "ask").map((e) => [e.question, e.reply, e.source])).toEqual([["Which approach should we take?", "Approach B", "scripted"]]);
  }, 180_000);

  // Value: protects=a session whose model asks nothing runs one exec, ends completed and asks nothing, with an empty questions.json; fails_when=the driver resumes a session with nothing to answer or records a question; why_new=interactive tasks on Codex (the other direction); seam=codexDriver's question loop; no_claim=none beyond protects
  test("a session with no question ends after one exec, completed, asking nothing", async () => {
    const r = await run(final, { entry: { user: { replies: { approach: "Approach B" } } } });
    expect(r.outcome.termination).toEqual({ kind: "completed" });
    expect(r.outcome.asked).toEqual([]);
    expect(r.outcome.turns).toEqual(["FINAL: summarized."]);
    expect(r.read("init.json").resume_argv).toEqual([]);
    expect(r.read("questions.json")).toEqual([]);
    expect(r.responses().length).toBe(1);
  }, 180_000);

  // Value: protects=a question in a task that declared no user replies ends the cell as a missing cell, E_USER_TURNS_MISSING, naming the question, as an AskUserQuestion does on Claude Code, and nothing resumes; fails_when=the question is answered with a fallback or the session reads as completed; why_new=the same simulated-user path as Claude Code; seam=UserSim.answerAsk; no_claim=none beyond protects
  test("a question in a task with no user replies is a missing cell, E_USER_TURNS_MISSING", async () => {
    const r = await run(asking);
    expect(r.outcome.termination).toEqual({ kind: "missing", code: "E_USER_TURNS_MISSING" });
    expect(r.outcome.asked).toEqual(["approach"]);
    expect(r.calls().missing_question).toBe("Which approach should we take?");
    expect(r.read("init.json").resume_argv).toEqual([]);
    expect(r.responses().every((u) => !userTexts(u.body).includes("Approach B"))).toBe(true);
  }, 180_000);

  // Value: protects=nextUser runs after every turn with that turn's agent texts, as on Claude Code, and its reply goes back by exec resume; a tool question still lands in asked and questions.json while the hook gives the answer; fails_when=the hook is skipped, gets the wrong texts, or the simulator answers in its place; why_new=a lane runs its own simulated user after every turn; seam=codexDriver nextUser; no_claim=none beyond protects
  test("nextUser answers after every turn and its reply is the next user message", async () => {
    const seen: string[][] = [];
    const nextUser = async (texts: string[]): Promise<NextUser> => {
      seen.push(texts);
      return seen.length === 1 ? { reply: "Approach A, please." } : { end: true };
    };
    const r = await run(asking, { nextUser, entry: { user: { replies: { approach: "Approach B" } } } });
    expect(r.outcome.termination).toEqual({ kind: "completed" });
    expect(seen.length).toBe(2);
    expect(seen[0]!.at(-1)).toBe("I asked which approach you want; I will wait for your answer.");
    expect(seen[1]).toEqual(["FINAL: going with Approach A, please."]);
    expect(r.outcome.asked).toEqual(["approach"]);
    expect(r.read("questions.json")).toEqual([{ call_id: "call_q", turn: 1, questions: [QUESTION], answer: "Approach A, please." }]);
    expect(existsSync(join(r.h.dir, "host", "usersim.ndjson"))).toBe(false);
  }, 180_000);

  // Value: protects=a question the task's script does not answer goes to the persona's free-form source, whose answer is the next user message; a source that cannot answer ends the cell with its termination; fails_when=the persona is skipped or its stop is ignored; why_new=the freeform persona path on Codex; seam=codexDriver freeform, UserSim.reply; no_claim=the persona model's own answers
  test("an unscripted question goes to the persona, and a persona stop ends the cell", async () => {
    const city: ResponsesScript = ({ outputs, users }) => {
      if (users.length === 1 && !outputs.has("call_city")) return [{ type: "call", id: "call_city", name: "request_user_input_async", args: { questions: [{ title: "What city is your bakery in?" }] } }];
      if (users.length === 1) return [{ type: "message", text: "Waiting for your answer." }];
      return [{ type: "message", text: "FINAL: noted " + users.at(-1) }];
    };
    const asked: string[] = [];
    const r = await run(city, { entry: { user: { persona: "A bakery owner in Lisbon." } }, freeform: async (persona, question) => (asked.push(persona + " | " + question), { text: "Lisbon." }) });
    expect(r.outcome.termination).toEqual({ kind: "completed" });
    expect(asked).toEqual(["A bakery owner in Lisbon. | What city is your bakery in?"]);
    expect(r.outcome.turns.at(-1)).toBe("FINAL: noted Lisbon.");
    const stopped = await run(city, { entry: { user: { persona: "A bakery owner in Lisbon." } }, freeform: async () => ({ stop: { kind: "missing", code: "E_USERSIM" } }) });
    expect(stopped.outcome.termination).toEqual({ kind: "missing", code: "E_USERSIM" });
    expect(stopped.read("init.json").resume_argv).toEqual([]);
  }, 240_000);

  // Value: protects=the caller's reasoning effort is written as -c model_reasoning_effort, recorded in init.json and sent on every request, so a session never runs on Codex's own default; a null effort writes nothing, as Codex sends no effort for a model its catalog lacks; fails_when=the setting is dropped, not recorded, or Codex's default reaches the request; why_new=the effort pin; seam=codexArgs, init.json; no_claim=which effort a preregistration should pick
  test("the effort is written as model_reasoning_effort, recorded in init.json and sent upstream", async () => {
    const r = await run(final, { effort: "medium" });
    const init = r.read("init.json");
    expect(init.reasoning_effort).toBe("medium");
    expect(init.argv).toContain('model_reasoning_effort="medium"');
    expect(r.responses().map((u) => u.body.reasoning?.effort)).toEqual(["medium"]);
    const none = await run(final, { effort: null, provider: "openrouter", model: "particle-ai/particle-1" });
    expect(none.read("init.json").reasoning_effort).toBeNull();
    expect(none.read("init.json").argv.some((a: string) => a.startsWith("model_reasoning_effort="))).toBe(false);
    expect(none.responses().map((u) => u.body.reasoning?.effort)).toEqual([undefined]);
  }, 180_000);

  // Value: protects=a Codex session gets GSTACK_SESSION_KIND from sessionKind through hostDriver, and the trial's seeded gstack state root (GSTACK_STATE_ROOT, GSTACK_HOME and its config) reaches the model's shell commands, as on Claude Code; fails_when=hostDriver drops sessionKind for Codex or Codex's shell env drops the variables; why_new=parity with the Claude Code arm; seam=codexEnv, hostDriver, the session env; no_claim=how gstack reads them
  test("sessionKind and the seeded state root reach the model's shell on Codex", async () => {
    const probe: ResponsesScript = ({ outputs }) => {
      if (!outputs.has("call_env")) return [{ type: "shell", id: "call_env", cmd: 'printf "%s|%s|%s\\n" "$GSTACK_SESSION_KIND" "$GSTACK_STATE_ROOT" "$GSTACK_HOME"; grep -c "^proactive: core$" "$GSTACK_STATE_ROOT/config.yaml"' }];
      return [{ type: "message", text: "FINAL: " + outputs.get("call_env") }];
    };
    const r = await run(probe, { sessionKind: "unattended", stateRoot: true });
    expect(r.outcome.termination).toEqual({ kind: "completed" });
    const root = join(r.work, ".gstack-home");
    expect(r.outcome.turns.at(-1)).toContain("unattended|" + root + "|" + root);
    expect(r.outcome.turns.at(-1)).toMatch(/\b1\b/);
  }, 180_000);

  // Value: protects=a ledger refusal (CAP_STOP) ends the cell as a cap stop, and a key missing from the proxy as a missing cell naming E_KEY_MISSING, with nothing sent upstream and no retry; fails_when=either reads as an arm failure, a pass or fail, or a generic UPSTREAM; why_new=U10 conformance (cap stop, missing key) on Codex; seam=refusalIn, request_max_retries; no_claim=none beyond protects
  test("a cap stop is cap_stop; a key missing from the proxy is a missing cell, E_KEY_MISSING", async () => {
    const cap = await run(final, { capMicros: 1 });
    expect(cap.outcome.termination).toEqual({ kind: "cap_stop" });
    expect(cap.responses()).toEqual([]);
    const { OPENAI_API_KEY: _drop, ...rest } = KEYS;
    const started = Date.now();
    const key = await run(final, { env: rest });
    expect(key.outcome.termination).toEqual({ kind: "missing", code: "E_KEY_MISSING" });
    expect(key.responses()).toEqual([]);
    // gstack-timing-ok: the bound only catches the CLI retrying the refusal, which backs off for minutes; one refused call takes seconds even on a slow machine
    expect(Date.now() - started).toBeLessThan(60_000);
  }, 180_000);

  // Value: protects=a host crash mid-run (the CLI killed after its first command) is an arm failure, harness_crash, with the turns so far kept; fails_when=the crash completes the trial or reads as a provider failure; why_new=U10 conformance (mid-run crash) on Codex; seam=the adapter's exit mapping; no_claim=none beyond protects
  test("a CLI crash mid-run is an arm failure, harness_crash", async () => {
    const crashing: ResponsesScript = ({ outputs }) => {
      if (!outputs.has("call_ls")) return [{ type: "message", text: "Looking around first." }, { type: "shell", id: "call_ls", cmd: "ls" }];
      open.at(-1)!.crash();
      return [{ type: "message", text: "never seen" }];
    };
    const r = await run(crashing);
    expect(r.outcome.termination).toEqual({ kind: "arm_failure", failure: "harness_crash" });
    expect(r.outcome.turns).toEqual(["Looking around first."]);
  }, 180_000);

  // Value: protects=particle-1 runs on a Codex arm through OpenRouter's Responses route with the OpenRouter key and the row's routing; fails_when=the provider path or key is wrong; why_new=particle-1 is a fixed rung in every lane (Garry's rule); seam=codexConfig's base_url; no_claim=OpenRouter accepts Codex's request shape, which only a paid call shows
  test("particle-1 through OpenRouter's Responses route", async () => {
    const r = await run(final, { provider: "openrouter", model: "particle-ai/particle-1" });
    expect(r.outcome.termination).toEqual({ kind: "completed" });
    expect(r.outcome.turns).toEqual(["FINAL: summarized."]);
    const sent = r.responses();
    expect(sent.length).toBeGreaterThan(0);
    for (const u of sent) {
      expect(new URL(u.url).origin + new URL(u.url).pathname).toBe("https://openrouter.ai/api/v1/responses");
      expect(u.headers.get("authorization")).toBe("Bearer " + KEYS.OPENROUTER_API_KEY);
      expect(u.body.provider).toEqual({ only: ["particle-ai"], allow_fallbacks: false, data_collection: "deny", max_price: { prompt: 0.1, completion: 1, request: 0, image: 0 } });
    }
  }, 180_000);
});

describe("Codex adapter pieces", () => {
  // Value: protects=the command line and env the adapter hands Codex: the proxy provider on the slot's path, retries off, bundled skills, web search, update checks and analytics off, the bearer by the name the provider reads, and only names on U9's agent allowlist; fails_when=a setting drops out or the env carries a name trialEnv refuses; why_new=U10 scope; seam=codexArgs, codexEnv; no_claim=none beyond protects
  test("the provider names the slot's path, retries and bundled skills are off, and the env is on the allowlist", () => {
    const o = { model: "gpt-6.1-sol", provider: "openai" as const, proxy: { baseUrl: "http://10.231.7.2:8080/", slot: "s_abc", token: "gse_" + "x".repeat(43) }, effort: "low" };
    expect(codexConfig(o)).toMatchObject({ model_provider: "gstack_evals_proxy", "model_providers.gstack_evals_proxy.base_url": "http://10.231.7.2:8080/s_abc/openai/v1", "model_providers.gstack_evals_proxy.wire_api": "responses", "model_providers.gstack_evals_proxy.env_key": "OPENAI_API_KEY", "model_providers.gstack_evals_proxy.request_max_retries": 0, "model_providers.gstack_evals_proxy.stream_max_retries": 0, "skills.bundled.enabled": false, web_search: "disabled" });
    const argv = codexArgs(o);
    expect(argv.slice(0, 3)).toEqual(["exec", "--json", "--strict-config"]);
    expect(argv).toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(argv.at(-1)).toBe("-");
    expect(argv).toContain('model_providers.gstack_evals_proxy.base_url="http://10.231.7.2:8080/s_abc/openai/v1"');
    const env = codexEnv(o);
    expect(env).toEqual({ OPENAI_API_KEY: o.proxy.token });
    expect(Object.keys(trialEnv("agent", env, [], {}))).toEqual(["OPENAI_API_KEY"]);
  });

  // Value: protects=sessionKind adds GSTACK_SESSION_KIND to the Codex agent env and unset adds none, so calibration's "no adapter sets GSTACK_SESSION_KIND" still holds; the names stay on U9's allowlist; fails_when=unset sets a kind or the name falls off the allowlist; why_new=parity with the Claude Code arm; seam=codexEnv; no_claim=none beyond protects
  test("sessionKind adds GSTACK_SESSION_KIND to the agent env, and unset adds none", () => {
    const proxy = { baseUrl: "http://10.231.7.2:8080", slot: "s_abc", token: "gse_" + "x".repeat(43) };
    expect(codexEnv({ proxy }).GSTACK_SESSION_KIND).toBeUndefined();
    const env = codexEnv({ proxy, sessionKind: "unattended" });
    expect(env.GSTACK_SESSION_KIND).toBe("unattended");
    expect(Object.keys(trialEnv("agent", env, [], {})).toSorted()).toEqual(["GSTACK_SESSION_KIND", "OPENAI_API_KEY"]);
  });

  // Value: protects=the effort and extra settings land as -c pairs, resume puts "resume <thread>" before the stdin dash, and an extra setting may not replace the adapter's own (the proxy provider, retries, the effort); fails_when=a setting drops out, resume lands in the wrong place, or an extra setting overrides the proxy; why_new=the effort pin and the optional extra settings; seam=codexArgs; no_claim=none beyond protects
  test("codexArgs writes the effort and extra settings, resumes a thread, and refuses to replace its own settings", () => {
    const o = { model: "gpt-6.1-sol", provider: "openai" as const, proxy: { baseUrl: "http://10.231.7.2:8080", slot: "s_abc", token: "t" }, effort: "low", settings: { "features.sleep_tool": false } };
    const argv = codexArgs(o);
    expect(argv).toContain('model_reasoning_effort="low"');
    expect(argv).toContain("features.sleep_tool=false");
    expect(argv).not.toContain("--ephemeral");
    expect(argv).not.toContain("resume");
    expect(codexArgs(o, "th_1").slice(-3)).toEqual(["resume", "th_1", "-"]);
    expect(codexArgs({ ...o, effort: null }).some((a) => a.startsWith("model_reasoning_effort="))).toBe(false);
    expect(() => codexArgs({ ...o, settings: { model_reasoning_effort: "high" } })).toThrow("E_INTERNAL");
    expect(() => codexArgs({ ...o, settings: { "model_providers.gstack_evals_proxy.base_url": "http://elsewhere" } })).toThrow("E_INTERNAL");
  });

  // Value: protects=skill-eval's explicit effort for each model it runs on Codex is the default_reasoning_level of codex 0.166.0's own catalog (codex debug models), and null for a model the catalog lacks, where Codex sends no effort; fails_when=a value drifts from the pinned catalog or a catalog-less model gets an effort it never had; why_new=the effort pin keeps skill-eval's behaviour; seam=catalogEffort; no_claim=that these efforts suit any eval
  test("catalogEffort gives codex 0.166.0's default effort per model, and null off the catalog", () => {
    expect(["gpt-6.1-sol", "gpt-6-astra", "gpt-6-luna", "openai/gpt-6.1-sol", "x-ai/gpt-6-luna", "particle-ai/particle-1", "deepseek/deepseek-v4.1-flash-1017"].map(catalogEffort)).toEqual(["low", "low", "medium", "low", "medium", null, null]);
  });
});
