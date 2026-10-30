import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { codexArgs, codexConfig, codexDriver, codexEnv, type CodexOptions } from "../../src/adapters/codex/driver.ts";
import { trialEnv } from "../../src/trial/env.ts";
import { HAS_CODEX_CLI, harness, KEYS, type Harness, type ResponsesScript } from "./harness.ts";

let open: Harness[] = [];
afterEach(() => {
  for (const h of open) h.close();
  open = [];
});

const MODEL = "gpt-6.1-sol";

async function run(script: ResponsesScript, o: { interactive?: boolean; skill?: (home: string) => CodexOptions["skill"]; provider?: "openai" | "openrouter"; model?: string; capMicros?: number; env?: Record<string, string>; setupHome?: (home: string) => void } = {}) {
  const h = harness(() => [], { responses: script, ...(o.capMicros === undefined ? {} : { capMicros: o.capMicros }), ...(o.env ? { env: o.env } : {}) });
  open.push(h);
  const model = o.model ?? MODEL;
  const provider = o.provider ?? "openai";
  const binding = h.bind(model, provider);
  const home = join(h.dir, "home");
  o.setupHome?.(home);
  const driver = codexDriver({ model, provider, proxy: { baseUrl: h.baseUrl, slot: binding.slot, token: binding.token }, interactive: o.interactive ?? false, skill: o.skill?.(home) ?? null, out: join(h.dir, "host") });
  const session = h.session(join(h.dir, "work", "t"), home, driver.env);
  const outcome = await driver.run(session, { id: "t", prompt: "Summarize the skill." }, 120_000);
  const meter = await h.proxy.finalize(binding.meter_id);
  const calls = () => JSON.parse(readFileSync(join(h.dir, "host", "calls.json"), "utf8"));
  const responses = () => h.upstream.filter((u) => new URL(u.url).pathname.endsWith("/v1/responses"));
  return { h, home, outcome, meter, calls, responses };
}

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

  // Value: protects=a task declared interactive never starts on Codex and leaves a missing cell, E_INTERACTIVE_HOST; fails_when=Codex runs it or the trial completes; why_new=U10 scope (E_INTERACTIVE_HOST for declared interactive tasks); seam=codexDriver; no_claim=preflight's own refusal, which tests/cli covers
  test("a task declared interactive is a missing cell, E_INTERACTIVE_HOST, and nothing runs", async () => {
    const r = await run(final, { interactive: true });
    expect(r.outcome.termination).toEqual({ kind: "missing", code: "E_INTERACTIVE_HOST" });
    expect(r.responses()).toEqual([]);
  }, 60_000);

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
      expect(u.body.provider).toEqual({ max_price: { prompt: 0.1, completion: 1, request: 0, image: 0 } });
    }
  }, 180_000);
});

describe("Codex adapter pieces", () => {
  // Value: protects=the command line and env the adapter hands Codex: the proxy provider on the slot's path, retries off, bundled skills, web search, update checks and analytics off, the bearer by the name the provider reads, and only names on U9's agent allowlist; fails_when=a setting drops out or the env carries a name trialEnv refuses; why_new=U10 scope; seam=codexArgs, codexEnv; no_claim=none beyond protects
  test("the provider names the slot's path, retries and bundled skills are off, and the env is on the allowlist", () => {
    const o = { model: "gpt-6.1-sol", provider: "openai" as const, proxy: { baseUrl: "http://10.231.7.2:8080/", slot: "s_abc", token: "gse_" + "x".repeat(43) } };
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
});
