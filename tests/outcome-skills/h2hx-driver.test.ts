// Copyright (c) 2026 Garry Tan. MIT License.
// The outcome driver's stages for the extension's part S (ext/driver.ts through driver/stage.ts): h2hx-s-pilot and
// h2hx-s-main serve the s-* arms only, run gpt-6.2-sol on the metering proxy's openai route at the part's 15-dollar
// allowance (or twice it), and price a Responses call from its own usage, so the close answer's usage carries the session's
// tokens. The head-to-head's own items are unchanged. The last test runs ext/h2h_codex.py with the real pinned Codex CLI
// through the driver, the proxy's Responses route and a stub upstream, with a question reply on the same thread, when the SDK Python and the Codex binary are on this machine. On a temporary ledger; no key, no paid call.
import { afterAll, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { recordProgram } from "../../src/runner/ledger/envelope.ts";
import { recordApproval } from "../../src/runner/ledger/ledger.ts";
import { LocalLedger } from "../../src/runner/ledger/local.ts";
import { serveStages, type ServeOptions, type StageSpec } from "../../lanes/outcome-skills/driver/stage.ts";
import { EXT_STAGES, h2hStageLimits, h2hStageModel } from "../../lanes/outcome-skills/h2h/ext/driver.ts";
import { readExtPrereg } from "../../lanes/outcome-skills/h2h/ext/prereg.ts";
import { next } from "../../lanes/outcome-skills/h2h/ext/stub-responses.ts";
import { closeTokens } from "../../lanes/outcome-skills/h2h/sessions/session.ts";
import { H2H_STAGES } from "../../lanes/outcome-skills/h2h/sessions/driver.ts";
import { readPrereg } from "../../lanes/outcome-skills/h2h/prereg.ts";

const D = 1_000_000;
const X = readExtPrereg();
const BASE = readPrereg();
const SOL = X.parts.S.model;
const CAP = X.parts.S.limits.allowance_usd;
const quote = { words: "test words", by: "test", source: "h2hx-driver.test.ts" };
const roots: string[] = [];
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

type Upstream = (url: string, init: RequestInit) => Promise<Response>;
const usage = { input_tokens: 1000, input_tokens_details: { cached_tokens: 200 }, output_tokens: 50, output_tokens_details: { reasoning_tokens: 10 }, total_tokens: 1050 };
const sse = (events: object[]) => new Response(events.map((e: any) => "event: " + e.type + "\ndata: " + JSON.stringify(e) + "\n\n").join(""), { headers: { "content-type": "text/event-stream" } });
/** An OpenAI upstream that plays stub-responses.ts's scripts and answers 404 to the input-token counter. */
const scripted: Upstream = async (url, init) => {
  if (!url.endsWith("/v1/responses")) return new Response("not here", { status: 404 });
  const item = next(JSON.parse(String(init.body)));
  if (item === null || item === "fail") return new Response("no", { status: 500 });
  return sse([{ type: "response.created", response: { id: "r1" } }, { type: "response.output_item.done", output_index: 0, item }, { type: "response.completed", response: { id: "r1", status: "completed", usage } }]);
};

function ledger(items: Record<string, number>, upstream: Upstream = scripted) {
  const root = mkdtempSync(join(tmpdir(), "h2hx-driver-test-"));
  roots.push(root);
  const record = join(root, "record");
  recordProgram(record, { program: "w", cap_micros: 5_000 * D, skill_cap_micros: 5_000 * D, skills: ["h2h"], credit_rate_micros: D, quotes: [quote] });
  for (const [item, cap] of Object.entries(items)) recordApproval(record, { action: "init", item, cap_micros: cap * D, quotes: [quote], admission: "required", program: "w", skills: ["h2h"] });
  const local = LocalLedger.open(join(root, "ledger.sqlite"));
  const serve = (stages: StageSpec[], extra: Partial<ServeOptions> = {}) => serveStages({ record, local, run_id: "r1", envelope_host: "m1", machine: "m1", stages, host: "127.0.0.1", dir: join(root, "run"), fetch: upstream, requireAdmission: () => null, env: { ANTHROPIC_API_KEY: "upstream-key", OPENAI_API_KEY: "upstream-openai-key" }, log: () => {}, ...extra });
  return { root, local, serve };
}

function client(control: string) {
  const open = async (o: { arm: string; cap?: number; model?: string; task?: string }) => {
    const res = await fetch(control + "/sessions", { method: "POST", body: JSON.stringify({ trial: "t", model: o.model ?? SOL, cap_usd: o.cap ?? CAP, ledger: "u4", open_key: crypto.randomUUID(), meta: { arm: o.arm, task: o.task ?? "u1", trial_n: 1 } }) });
    return { status: res.status, json: (await res.json()) as Record<string, any> };
  };
  const close = async (id: string) => (await (await fetch(control + "/sessions/" + id + "/close", { method: "POST", body: JSON.stringify({ reason: "agent_finished" }) })).json()) as Record<string, any>;
  return { open, close };
}

test("the extension's part S items serve the s-* arms on gpt-6.2-sol at the part's allowance; base items keep their own", async () => {
  expect(Object.keys(EXT_STAGES)).toEqual(["h2hx-s-pilot", "h2hx-s-main"]);
  expect(EXT_STAGES["h2hx-s-pilot"]!.arms).toEqual(X.parts.S.arms.map((a) => "h2h:" + a));
  expect(h2hStageModel("h2hx-s-main")).toBe("gpt-6.2-sol");
  expect(h2hStageLimits("h2hx-s-main")).toEqual({ session_cap_usd: 15, wall_limit_sec: 5400, max_turns: 300 });
  expect(h2hStageLimits("h2hx-s-main", 30).session_cap_usd).toBe(30);
  expect(() => h2hStageLimits("h2hx-s-main", 25)).toThrow(/^E_H2H_SESSION_INPUT a part S session allowance is the extension's \$15/);
  for (const item of Object.keys(H2H_STAGES)) {
    expect(h2hStageModel(item)).toBe(BASE.model);
    expect(h2hStageLimits(item).session_cap_usd).toBe(BASE.limits.allowance_usd);
  }
  for (const item of ["h2hx-s-pilot", "h2hx-s-main"]) {
    const { serve, local } = ledger({ [item]: 100 });
    const served = await serve([{ item, arm: item, arms: EXT_STAGES[item]!.arms }]);
    expect(served.stages.map((s) => s.item)).toEqual([item]);
    expect(await served.stop()).toBe(0);
    local.close?.();
  }
  const refused = async (items: Record<string, number>, stages: StageSpec[], text: string, extra: Partial<ServeOptions> = {}) => {
    const { serve, local } = ledger(items);
    await expect(serve(stages, extra)).rejects.toThrow(text);
    local.close?.();
  };
  await refused({ "h2hx-s-main": 100 }, [{ item: "h2hx-s-main", arm: "h2hx-s-main", arms: ["h2h:none"] }], "not h2h:none");
  await refused({ "h2h-opus": 100 }, [{ item: "h2h-opus", arm: "h2h-opus", arms: ["h2h:s-none"] }], "not h2h:s-none");
  await refused({ "h2hx-s-main": 100 }, [{ item: "h2hx-s-main", arm: "h2hx-s-main", arms: ["h2h:s-none"] }], "not $25", { h2h_allowance_usd: 25 });
  await refused({ "h2hx-q": 100 }, [{ item: "h2hx-q", arm: "h2hx-q", arms: ["h2h:s-none"] }], "h2hx-s-pilot, h2hx-s-main");
});

test("an s-* session opens on the openai route at $15, a Responses call is priced from its usage, and the close answer's usage carries the tokens", async () => {
  const seen: string[] = [];
  const { serve, local } = ledger({ "h2hx-s-pilot": 100 }, async (url, init) => {
    seen.push(url);
    return scripted(url, init);
  });
  const served = await serve([{ item: "h2hx-s-pilot", arm: "h2hx-s-pilot", arms: EXT_STAGES["h2hx-s-pilot"]!.arms }]);
  const { open, close } = client(served.control);
  expect((await open({ arm: "h2h:s-gstack", model: BASE.model })).status).toBe(400);
  expect((await open({ arm: "h2h:s-gstack", cap: 25 })).json.detail).toContain("session_cap_usd of 15");
  const s = await open({ arm: "h2h:s-gstack" });
  expect(s.status).toBe(200);
  expect(s.json).toMatchObject({ item: "h2hx-s-pilot", allowance_micros: CAP * D });
  expect(s.json.base_url).toEndWith("/openai");
  const body = { model: SOL, stream: true, store: false, include: ["reasoning.encrypted_content"], reasoning: { effort: "low", context: "all_turns" }, text: { verbosity: "low" }, tool_choice: "auto", parallel_tool_calls: false, prompt_cache_key: "k", client_metadata: { thread_id: "x" }, input: [{ type: "additional_tools", role: "developer", tools: [{ type: "namespace", name: "functions", tools: [{ type: "custom", name: "exec" }, { type: "function", name: "request_user_input_async" }] }] }, { type: "message", role: "user", content: [{ type: "input_text", text: "[fx:done] fix it" }] }] };
  const res = await fetch(s.json.base_url + "/v1/responses", { method: "POST", headers: { authorization: "Bearer " + s.json.token, "content-type": "application/json" }, body: JSON.stringify(body) });
  expect(res.status).toBe(200);
  expect(await res.text()).toContain("response.completed");
  expect(seen.filter((u) => u.endsWith("/v1/responses"))).toEqual(["https://api.openai.com/v1/responses"]);
  const answer = await close(s.json.id);
  expect(answer).toMatchObject({ finalized: true, allowance_stops: 0 });
  expect(closeTokens(answer)).toEqual({ input: 800, output: 50, cache_read: 200, cache_write: 0 });
  expect(answer.spent_micros).toBe(Math.round(800 * 2 + 200 * 0.1 + 50 * 10));
  expect(await served.stop()).toBe(0);
  local.close?.();
});

const PY = process.env.REAL_OUTCOME_PYTHON ?? join(homedir(), ".capy/work/real/venv/bin/python");
const CODEX_DIR = process.env.H2HX_CODEX_DIR ?? join(homedir(), ".cache/h2h-runtimes/codex-0.170.0");
const HAS = existsSync(PY) && existsSync(join(CODEX_DIR, "codex"));
test.skipIf(!HAS)("a real Codex session runs through the driver and the proxy's Responses route: a question reply on the same thread, tokens and spend in the close answer", async () => {
  const { serve, local, root } = ledger({ "h2hx-s-pilot": 100 });
  const served = await serve([{ item: "h2hx-s-pilot", arm: "h2hx-s-pilot", arms: EXT_STAGES["h2hx-s-pilot"]!.arms }]);
  const d = join(root, "s");
  for (const p of ["repo", "home", "sh", "bin"]) mkdirSync(join(d, p), { recursive: true });
  const git = (...a: string[]) => spawnSync("git", ["-C", join(d, "repo"), ...a], { encoding: "utf8", env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "f", GIT_AUTHOR_EMAIL: "f@x.invalid", GIT_COMMITTER_NAME: "f", GIT_COMMITTER_EMAIL: "f@x.invalid" } });
  git("init", "-q");
  writeFileSync(join(d, "repo", "a.txt"), "a\n");
  git("add", "-A");
  git("commit", "-qm", "base");
  for (const src of ["lanes/outcome-skills/pfchecks/sh", "lanes/outcome-skills/h2h/sessions/sh"]) for (const f of readdirSync(join(import.meta.dir, "../..", src))) cpSync(join(import.meta.dir, "../..", src, f), join(d, "sh", f));
  symlinkSync(join(CODEX_DIR, "codex"), join(d, "bin", "sol-agent"));
  const l = X.parts.S.limits;
  const cfg = {
    out: join(d, "out"), no_answer: BASE.texts.question_reply, limits: { allowance_usd: l.allowance_usd, wall_sec: 300, max_turns: l.max_turns, quiet_sec: 30, bg_wait_sec: 600 }, repo: join(d, "repo"), home: join(d, "home"), home_rule: "none", exec_prefix: [], sh_dir: join(d, "sh"), work: join(d, "work"),
    turns: ["[fx:ask] Fix the parser."], continuation: BASE.texts.continuation, done_rule: BASE.done_rule, continuation_cap: 1, env: { GSTACK_TELEMETRY_SOURCE: "eval" }, control: served.control, arm: "h2h:s-none", task: "u1/s-none/stage0/0", model: SOL,
    codex: { bin: join(d, "bin", "sol-agent"), home: join(d, "home", ".codex"), model: SOL, effort: X.parts.S.reasoning_effort, version: X.parts.S.codex.version },
  };
  writeFileSync(join(d, "cfg.json"), JSON.stringify(cfg));
  const p = Bun.spawn([PY, join(import.meta.dir, "../../lanes/outcome-skills/h2h/ext/h2h_codex.py"), join(d, "cfg.json")], { env: { PATH: process.env.PATH!, HOME: process.env.HOME!, PYTHONDONTWRITEBYTECODE: "1" }, stdout: "pipe", stderr: "pipe", timeout: 240_000 });
  const code = await p.exited;
  if (code !== 0) console.log(await new Response(p.stderr).text());
  expect(code).toBe(0);
  const s = JSON.parse(readFileSync(join(d, "out", "h2h-summary.json"), "utf8"));
  expect(s.refused).toBeUndefined();
  expect(s.done).toBe(true);
  expect(s.turns[0].drive.execs.map((e: any) => e.kind)).toEqual(["turn", "reply"]);
  expect(s.questions.t1.async_questions).toBe(1);
  expect(s.slot.close).toMatchObject({ finalized: true, allowance_stops: 0 });
  expect(closeTokens(s.slot.close).input).toBeGreaterThan(0);
  expect(s.slot.close.spent_micros).toBeGreaterThan(0);
  const cfgText = readFileSync(join(d, "out", "codex-config.toml"), "utf8");
  expect(cfgText).toMatch(/base_url = "http:\/\/127\.0\.0\.1:\d+\/[A-Za-z0-9_-]+\/openai\/v1"/);
  expect(await served.stop()).toBe(0);
  local.close?.();
}, 300_000);
