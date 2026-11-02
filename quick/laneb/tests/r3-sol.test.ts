// GPT-6.1 Sol in R3a (R3 amendment section 6, Captain ruling A1), keyless: its route row and cell, its arms under the real
// pinned Agent SDK, the screen per model, the route check, #121's two notes, Sol's stops leaving Opus untouched, and Sol's
// planned layout against its real $140 cap and $4 allowance through the real proxy and ledger service.
import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { armSpec, jobConfig } from "../runner/grid.ts";
import { fromMicros, Ledger, readRows, toMicros, totals } from "../runner/ledger.ts";
import { priceFor, costMicros, startProxy, type ProxyConfig } from "../runner/proxy.ts";
import { loadR3Jobs, type R3Trial } from "../r3/exposure.ts";
import { admission, bandIds, bindCheck, coverage, OPUS, pilotTasks, R3A, routeRecordPath, SOL, vmBlock } from "../r3/screen.ts";
import { judge, next, toolResults, type RouteRecord } from "../r3/route-check.ts";

const here = import.meta.dir;
const laneb = join(here, "..");
const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));
const sha = (b: string | Buffer) => createHash("sha256").update(b).digest("hex");
const proxyConfig = JSON.parse(readFileSync(join(laneb, "config/proxy.json"), "utf8")) as ProxyConfig;
const cells = JSON.parse(readFileSync(join(laneb, "config/cells.r3.json"), "utf8"));
const solCell = cells.models.find((c: any) => c.id === SOL);
const opus = R3A[OPUS]!, sol = R3A[SOL]!;
function freePort() {
  const s = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
  const port = s.port;
  s.stop(true);
  return port;
}
const approve = (path: string, item: string, cap: number) => new Ledger(path, item).approve(cap, { words: "test", by: "test" });
const passRecord = (ledger: string, m = sol, verdict: "pass" | "drop" = "pass", reason = "smoke passed on try 1, told passed on try 1") =>
  writeFileSync(routeRecordPath(ledger), JSON.stringify({ item: m.item, model: m.id, verdict, reason, proxy_config_sha256: "x", sessions: [] }));
// A stub upstream that answers every request with the usage the test sets: output tokens at Sol's $10 a million.
let nextUsd = 0.01;
const upstream = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(req) {
    const body = (await req.json()) as any;
    received.push({ auth: req.headers.get("authorization"), body });
    return Response.json({ id: "msg_1", type: "message", role: "assistant", content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", usage: { input_tokens: 0, output_tokens: Math.round(nextUsd * 1e5) } });
  },
});
const received: any[] = [];
const stubConfig = (): ProxyConfig => ({ routes: { openrouter: { ...proxyConfig.routes.openrouter!, base_url: `http://127.0.0.1:${upstream.port}`, key_env: "FAKE_KEY" } }, models: { [SOL]: proxyConfig.models[SOL]! } });
afterAll(() => upstream.stop(true));

// Run D's row at tag laneb-discovery-3-runner (025135a), as it was committed there.
const RUN_D_ROW = { route: "openrouter", upstream_model: "openai/gpt-6.1-sol", price_per_mtok: { input: 2, output: 10, cache_write_5m: 2, cache_write_1h: 2, cache_read: 0.1 }, body_overrides: { provider: { only: ["openai"], allow_fallbacks: false } } };

describe("Sol's route row and cell", () => {
  test("the row sends what Run D's sends, and meters at OpenRouter's list price with the long-prompt row", () => {
    const row = proxyConfig.models[SOL]!;
    const { price_per_mtok: _p, long_prompt, ...sends } = row;
    const { price_per_mtok: _q, ...runD } = RUN_D_ROW;
    expect(sends).toEqual(runD);
    expect(row.price_per_mtok).toEqual({ input: 2, output: 10, cache_write_5m: 2.5, cache_write_1h: 2.5, cache_read: 0.1 });
    expect(long_prompt).toEqual({ over_tokens: 272000, price_per_mtok: { input: 4, output: 15, cache_write_5m: 5, cache_write_1h: 5, cache_read: 0.2 } });
    const u = (input: number) => ({ input_tokens: input, output_tokens: 1000, cache_creation_input_tokens: 0, cache_creation_1h_input_tokens: 0, cache_read_input_tokens: 0 });
    expect(costMicros(u(100000), priceFor(u(100000), row))).toBe(100000 * 2 + 1000 * 10);
    expect(costMicros(u(300000), priceFor(u(300000), row))).toBe(300000 * 4 + 1000 * 15);
  });

  test("the R3 cell is anthropic/gpt-6.1-sol at Opus's $4 allowance", () => {
    expect(solCell).toEqual({ id: SOL, harbor_model: "anthropic/gpt-6.1-sol", session_cap_usd: 4 });
    expect(solCell.session_cap_usd).toBe(cells.models.find((c: any) => c.id === OPUS).session_cap_usd);
  });

  test("the proxy sends a claude-code-preset request to openai/gpt-6.1-sol with the provider pin and its system blocks untouched", async () => {
    const dir = tmp("sol-route-");
    const proxy = startProxy({ dataHost: "127.0.0.1", dataPort: 0, controlPort: 0, env: { FAKE_KEY: "fake" }, closeWaitMs: 300, config: stubConfig(), logPath: join(dir, "log.jsonl"), sessionsPath: join(dir, "sessions.jsonl") });
    const control = `http://127.0.0.1:${proxy.control.port}`;
    const s = (await (await fetch(control + "/sessions", { method: "POST", body: JSON.stringify({ trial: "t__env", model: SOL, cap_usd: 4, meta: { system_prompt: "claude-code-preset" } }) })).json()) as any;
    const system = [
      { type: "text", text: "x-anthropic-billing-header: cc_version=2.1.312; cc_entrypoint=sdk-py;" },
      { type: "text", text: "Guidance line for the preset stand-in.\n".repeat(150), cache_control: { type: "ephemeral" } },
    ];
    nextUsd = 0.25;
    const res = await fetch(`http://127.0.0.1:${proxy.data.port}/v1/messages`, { method: "POST", headers: { authorization: "Bearer " + s.token, "content-type": "application/json" }, body: JSON.stringify({ model: SOL, max_tokens: 1000, system, messages: [{ role: "user", content: "hi" }], tools: [], stream: false }) });
    expect(res.status).toBe(200);
    await res.text();
    const closed = (await (await fetch(control + `/sessions/${s.id}/close`, { method: "POST", body: "{}" })).json()) as any;
    await proxy.stop();
    expect(closed.ok_responses).toBe(1);
    expect(closed.spent_micros).toBe(250000);
    const sent = received.at(-1);
    expect(sent.auth).toBe("Bearer fake");
    expect(sent.body.model).toBe("openai/gpt-6.1-sol");
    expect(sent.body.provider).toEqual({ only: ["openai"], allow_fallbacks: false });
    expect(sent.body.system).toEqual(system);
  });
});

// Sol's R3a agents: its two parts' arms in its cell.
function solAgents() {
  return jobConfig({
    job_name: "r3a-sol", tasks_dir: "/run/tasks", tasks: ["astropy__astropy-13033"], attempts: 1, n_concurrent: 1, agent_dir: "/r/agent", runner_dir: "/r", base_url: "http://g:8787",
    max_output_tokens: cells.max_output_tokens, verifier_timeout_multiplier: cells.verifier_timeout_multiplier, repo_dir: "/testbed",
    models: [solCell], arms: sol.parts.map((p) => ({ ...armSpec(p.arm), tar: "/run/arms/" + armSpec(p.arm).name + ".tar", sha256: "x" })),
  }).agents;
}

describe("Sol's arms", () => {
  test("none is told nothing and gstack is told /investigate, both on claude-code-preset at $4 on gpt-6.1-sol", () => {
    const agents = solAgents();
    expect(agents.map((a) => [a.model_name, a.kwargs.upstream_model, a.kwargs.arm, (a.kwargs as any).told_skill ?? null, (a.kwargs as any).system_prompt, a.kwargs.session_cap_usd, (a.kwargs as any).repo_dir])).toEqual([
      ["anthropic/gpt-6.1-sol", SOL, "none", null, "claude-code-preset", 4, "/testbed"],
      ["anthropic/gpt-6.1-sol", SOL, "gstack", "investigate", "claude-code-preset", 4, "/testbed"],
    ]);
  });

  // agent_r3_sdk_test.py drives each agent's kwargs through LanebAgent.run under the real pinned Agent SDK with a stub
  // CLI: the exact prompt, CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1 and the preset (as r3.test.ts does for Opus).
  test("both Sol arms, under the real pinned Agent SDK, send their prompt with CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1 and the preset", () => {
    const pin = readFileSync(join(laneb, "runner/vm-bootstrap.sh"), "utf8").match(/^SDK_PIN=(\S+)$/m)![1];
    const venv = join(tmpdir(), "laneb-claude-agent-sdk-" + pin);
    const python = join(venv, "bin/python");
    if (!existsSync(python) || Bun.spawnSync([python, "-c", 'import claude_agent_sdk as s; assert s.__version__ == "' + pin + '"']).exitCode !== 0) {
      const install = Bun.spawnSync(["sh", "-c", 'python3 -m venv --clear "$1" && "$1/bin/pip" install -q "claude-agent-sdk==$2"', "sh", venv, pin]);
      if (install.exitCode !== 0) console.log(install.stdout.toString() + install.stderr.toString());
      expect(install.exitCode).toBe(0);
    }
    const agents = join(tmp("sol-agents-"), "agents.json");
    writeFileSync(agents, JSON.stringify(solAgents().map((a) => a.kwargs)));
    const r = Bun.spawnSync([python, join(here, "agent_r3_sdk_test.py")], { env: { ...process.env, PYTHONPATH: [join(laneb, "runner/agent"), here].join(":"), R3_AGENTS: agents } });
    const out = r.stdout.toString() + r.stderr.toString();
    if (r.exitCode !== 0) console.log(out);
    expect(out).not.toContain("FAIL");
    expect(out.match(/^pass arm gpt-6\.1-sol (none|gstack)$/gm)).toHaveLength(2);
    expect(r.exitCode).toBe(0);
  }, 600_000);
});

type T = { task: string; arm?: string; model?: string; reward?: number | null; ok?: number | null; spent?: number; told?: string; cmdNames?: string[]; lines?: unknown[] };
function writeTrial(jobs: string, sessions: string, t: T, i: number) {
  const name = t.task.slice(0, 20) + "__" + i;
  const d = join(jobs, "job", name);
  mkdirSync(join(d, "evaluator"), { recursive: true });
  const model = t.model ?? SOL;
  writeFileSync(join(d, "config.json"), JSON.stringify({ task: { path: "/vm/run/tasks/" + t.task }, agent: { name: "laneb-claude-code", kwargs: { arm: t.arm ?? "none", upstream_model: model, ...(t.told ? { told_skill: t.told } : {}) } } }));
  const reward = t.reward === undefined ? 0 : t.reward;
  writeFileSync(join(d, "result.json"), JSON.stringify({ trial_name: name, verifier_result: reward === null ? null : { rewards: { reward } }, exception_info: null }));
  writeFileSync(join(d, "evaluator/sdk-messages.jsonl"), (t.lines ?? [{ type: "AssistantMessage", content: [{ text: "Fixed the bug." }] }]).map((l) => JSON.stringify(l)).join("\n") + "\n");
  if (t.ok !== null) writeFileSync(sessions, JSON.stringify({ id: "s" + i, trial: name + "__env", model, spent_micros: toMicros(t.spent ?? 0.5), ok_responses: t.ok ?? 3, requests: 4, refused: 0, refused_budget: 0, opened_at: "2026-11-01T00:00:00Z", closed_at: "2026-11-01T01:00:00Z", cmd_expanded: (t.cmdNames ?? []).length > 0, cmd_names: t.cmdNames ?? [] }) + "\n", { flag: "a" });
}
function load(trials: T[]): R3Trial[] {
  const d = tmp("sol-trials-");
  const sessions = join(d, "proxy-sessions.jsonl");
  writeFileSync(sessions, "");
  trials.forEach((t, i) => writeTrial(join(d, "jobs"), sessions, t, i));
  return loadR3Jobs(join(d, "jobs"), readFileSync(sessions, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)), proxyConfig);
}
const say = (s: string) => ({ type: "AssistantMessage", content: [{ text: s }] });
const toldTrial = (task: string, model = SOL, shown = true): T => ({ task, model, arm: "gstack", told: "investigate", spent: 1.1, cmdNames: ["investigate"], lines: [say(shown ? "Phase 1" : "done")] });

// A prepared and pulled R3a work dir for one model: one none trial per band task (the first fails are failed) and one
// told trial per pilot task, on that model's item.
function work(m = sol, opts: { fails?: number; edit?: (parts: Record<string, T[]>) => void; after?: (w: string) => void; ledger?: string } = {}) {
  const w = tmp("sol-work-");
  const ledger = opts.ledger ?? join(w, m.item + ".jsonl");
  if (!opts.ledger) { approve(ledger, m.item, m.capUsd); if (m.routePrefix) passRecord(ledger, m); }
  const band = bandIds();
  const pilotIds = pilotTasks(band);
  writeFileSync(join(w, "plan.json"), JSON.stringify({ item: m.item, pilot_tasks: pilotIds }));
  const parts: Record<string, T[]> = {
    screen: band.map((task, i) => ({ task, model: m.id, reward: i < (opts.fails ?? 35) ? 0 : 1, spent: 0.6 })),
    pilot: pilotIds.map((task) => toldTrial(task, m.id)),
  };
  opts.edit?.(parts);
  for (const [name, trials] of Object.entries(parts)) {
    const dir = join(w, name);
    mkdirSync(join(dir, "pulled/out"), { recursive: true });
    writeFileSync(join(dir, "proxy.json"), JSON.stringify(proxyConfig));
    writeFileSync(join(dir, "pulled/out/proxy-sessions.jsonl"), "");
    trials.forEach((t, i) => writeTrial(join(dir, "pulled/jobs"), join(dir, "pulled/out/proxy-sessions.jsonl"), t, i));
    writeFileSync(join(w, name + ".launch-exit"), "0\n");
  }
  opts.after?.(w);
  return { w, ledger };
}
function analyzeCli(w: string, ledger: string, model?: string) {
  const r = Bun.spawnSync([process.execPath, join(laneb, "r3/screen.ts"), "analyze", w, ...(model ? ["--model", model] : [])], { env: { ...process.env, LEDGER: ledger } });
  return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
}

describe("the screen per model", () => {
  test("coverage counts the other model's trial as stray, in either model's part", () => {
    const solTrial = load([{ task: "a", model: SOL }]), opusTrial = load([{ task: "a", model: OPUS }]);
    expect(coverage(solTrial, ["a"], "none", SOL)).toBeNull();
    expect(coverage(opusTrial, ["a"], "none", SOL)).toContain("1 trials outside the plan");
    expect(coverage(solTrial, ["a"], "none", OPUS)).toContain("1 trials outside the plan");
    expect(coverage(solTrial, ["a"], "none")).toContain("1 trials outside the plan");
    expect(coverage(opusTrial, ["a"], "none")).toBeNull();
  });

  test("Sol's admission names Sol and projects r3b-sol; saturation and the pilot stop end Sol's line only", () => {
    const screen = (fails: number, passes: number) => load([
      ...Array.from({ length: fails }, (_, i) => ({ task: "f" + i, reward: 0, spent: 0.6 })),
      ...Array.from({ length: passes }, (_, i) => ({ task: "p" + i, reward: 1, spent: 0.4 })),
    ]);
    const pilot = (shown: number) => load(Array.from({ length: 10 }, (_, i) => toldTrial("t" + i, SOL, i < shown)));
    const ok = admission(screen(40, 50), pilot(8), sol);
    expect(ok.exit).toBe(0);
    expect(ok.lines[0]).toBe("admission: 40 of 90 graded in-band tasks unsolved by GPT-6.1 Sol none (0 infra); pilot exposure 8 of 10 graded told trials");
    const cNone = (40 * 0.6 + 50 * 0.4) / 90;
    expect(ok.lines[1]).toBe("R3b start for GPT-6.1 Sol: 40 tasks; measured cost per trial none $" + cNone.toFixed(2) + ", told $1.10; projection r3b-sol $" + (40 * 3 * (cNone + 1.1)).toFixed(0) + "; Garry records r3b-sol's cap before Sol's R3b starts");
    expect((ok.record.projection_usd as Record<string, number>)["r3b-sol"]).toBeCloseTo(40 * 3 * (cNone + 1.1), 9);
    expect([...ok.r3bTasks].sort()).toEqual(ok.admitted);
    const sat = admission(screen(29, 61), pilot(10), sol);
    expect(sat.exit).toBe(5);
    expect(sat.lines[1]).toBe("R3 outcome for GPT-6.1 Sol: STOP (saturation). Only 29 in-band tasks are unsolved by GPT-6.1 Sol with no skill, fewer than 30, so told /investigate can't be tested on GPT-6.1 Sol on SWE-bench Verified. This report is the finding; Sol's R3b does not start, and Opus's R3 is unaffected.");
    const fix = admission(screen(40, 50), pilot(6), sol);
    expect(fix.exit).toBe(6);
    expect(fix.lines[1]).toBe("R3 outcome for GPT-6.1 Sol: STOP (FIX-METHOD). Told /investigate ran its procedure in 6 of 10 pilot trials, under 7; Sol's R3b does not start, and Opus's R3 is unaffected.");
  });

  test("analyze --model gpt-6.1-sol admits from Sol's own screen and writes Sol's record", () => {
    const { w, ledger } = work();
    const r = analyzeCli(w, ledger, SOL);
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
    expect(r.out).toContain("r3a-sol: 93 screen trials, 10 pilot trials, settled $0.00 of $140, open reserves 0");
    expect(r.out).toContain("admission: 35 of 93 graded in-band tasks unsolved by GPT-6.1 Sol none (0 infra); pilot exposure 10 of 10 graded told trials");
    expect(r.out).toContain("R3b start for GPT-6.1 Sol: 35 tasks; measured cost per trial none $0.60, told $1.10; projection r3b-sol $179; Garry records r3b-sol's cap before Sol's R3b starts");
    const rec = JSON.parse(readFileSync(join(w, "record.json"), "utf8"));
    expect(rec).toMatchObject({ item: "r3a-sol", model: SOL, route_check: { verdict: "pass" }, outcome: "admitted", n: 35 });
    expect(readFileSync(join(w, "admitted.txt"), "utf8").trim().split("\n")).toHaveLength(35);
  });

  test("an Opus trial in a Sol part makes Sol's R3a incomplete, and the line keeps Opus's outcome out of it", () => {
    const { w, ledger } = work(sol, { edit: (p) => { p.pilot![4] = toldTrial(p.pilot![4]!.task, OPUS); } });
    const r = analyzeCli(w, ledger, SOL);
    expect(r.code).toBe(4);
    expect(r.out).toContain("R3 outcome for GPT-6.1 Sol: none (incomplete: pilot: 1 trials outside the plan");
    expect(r.out).toContain("Sol's R3a stopped, so Sol's R3b does not start; Opus's R3a and its outcome are untouched, and the Captain gets the record.");
    expect(existsSync(join(w, "admitted.txt"))).toBe(false);
  });

  test("Sol trials in Opus's work dir are stray, and a work dir is analyzed only as its own item", () => {
    const { w, ledger } = work(sol);
    expect(analyzeCli(w, ledger).err).toContain("E_USAGE " + w + "/plan.json is item r3a-sol's, not Opus 5.5's r3a-screen");
    const o = work(opus, { edit: (p) => { p.screen![7] = { ...p.screen![7]!, model: SOL }; } });
    const r = analyzeCli(o.w, o.ledger);
    expect(r.code).toBe(4);
    expect(r.out).toContain("R3 outcome: none (incomplete: screen: 1 trials outside the plan");
    expect(analyzeCli(w, ledger, "particle-1").code).toBe(2);
  });

  test("r3a-sol binds at $140 with its route check passed and settled, and is refused otherwise", () => {
    const d = tmp("sol-bind-");
    const at = (name: string, cap = 140) => { const p = join(d, name + ".jsonl"); approve(p, "r3a-sol", cap); return p; };
    const fresh = at("fresh");
    expect(() => bindCheck(fresh, sol)).toThrow("GPT-6.1 Sol has not passed its route check on r3a-sol");
    passRecord(fresh);
    expect(() => bindCheck(fresh, sol)).not.toThrow();
    const routed = at("routed");
    passRecord(routed);
    const L = new Ledger(routed, "r3a-sol");
    L.reserve("r3a-sol-route/s1", toMicros(4));
    expect(() => bindCheck(routed, sol)).toThrow("1 route check reserves are still open on r3a-sol");
    L.settle("r3a-sol-route/s1", toMicros(0.3));
    expect(() => bindCheck(routed, sol)).not.toThrow();
    L.reserve("r3a-sol-screen/s1", toMicros(4));
    expect(() => bindCheck(routed, sol)).toThrow("an item serves one run");
    const cap = at("cap", 150);
    passRecord(cap);
    expect(() => bindCheck(cap, sol)).toThrow("r3a-sol's cap is $150, not the R3 amendment's $140");
    expect(() => bindCheck(fresh, opus)).toThrow("no approval row for item r3a-screen");
    const dropped = at("dropped");
    passRecord(dropped, sol, "drop", "the told part failed twice: try 1: Harbor exited 1 | try 2: Harbor exited 1");
    expect(() => bindCheck(dropped, sol)).toThrow("GPT-6.1 Sol dropped out of R3a at its route check: the told part failed twice");
    const other = at("other");
    writeFileSync(routeRecordPath(other), JSON.stringify({ item: "r3a-sol", model: OPUS, verdict: "pass", reason: "x" }));
    expect(() => bindCheck(other, sol)).toThrow("is for claude-opus-5-5 on r3a-sol, not gpt-6.1-sol on r3a-sol");
  });

  test("run refuses Sol before it binds the item when the route check hasn't passed", () => {
    const w = tmp("sol-run-");
    const ledger = join(w, "r3a-sol.jsonl");
    approve(ledger, "r3a-sol", 140);
    writeFileSync(join(w, "plan.json"), "{}");
    const r = Bun.spawnSync([process.execPath, join(laneb, "r3/screen.ts"), "run", w, "--model", SOL], { env: { ...process.env, LEDGER: ledger, VM_USD_PER_HOUR: "0.60", UBI_RUNNER: "/bin/false", UBI_OWNER: "test", ANTHROPIC_API_KEY: "", OPENROUTER_API_KEY: "" } });
    expect(r.exitCode).toBe(1);
    expect(r.stderr.toString()).toContain("GPT-6.1 Sol has not passed its route check on r3a-sol");
    expect(existsSync(ledger + ".bound")).toBe(false);
    expect(readRows(ledger).filter((x) => x.kind === "reserve")).toEqual([]);
  });
});

// #121's notes (R3 amendment 6.6 item 5), for both models: launch.sh against the fake ubi-runner and ssh of
// launch.test.ts, whose batch leaves a trial directory no config.json attributes, so the screen comes back incomplete.
describe("#121's notes", () => {
  for (const m of [opus, sol]) {
    test(`run doesn't launch ${m.label}'s pilot after its screen came back incomplete`, () => {
      const root = tmp("sol-skip-");
      const [vm, bin, state, w] = ["vm", "bin", "state", "work"].map((d) => join(root, d));
      for (const d of [vm, bin, state, join(w!, "screen"), join(w!, "pilot")]) mkdirSync(d!, { recursive: true });
      for (const f of ["ubi", "ssh"]) { copyFileSync(join(here, "fixtures/launch", f), join(bin!, f)); chmodSync(join(bin!, f), 0o755); }
      for (const part of ["screen", "pilot"]) writeFileSync(join(w!, part, "proxy.json"), JSON.stringify(proxyConfig));
      writeFileSync(join(w!, "plan.json"), JSON.stringify({ item: m.item, pilot_tasks: pilotTasks(bandIds()) }));
      const ledger = join(root, m.item + ".jsonl");
      approve(ledger, m.item, m.capUsd);
      if (m.routePrefix) passRecord(ledger, m);
      const events = join(root, "events.log");
      const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, UBI_RUNNER: join(bin!, "ubi"), UBI_RUNNER_STATE: state!, UBI_OWNER: "test", LEDGER: ledger, LEDGER_PORT: String(freePort()), EVENTS: events, VM: vm!, STATE: state!, PULL_RETRY_SEC: "0", FINISH: "0", VM_USD_PER_HOUR: "0.60", ANTHROPIC_API_KEY: "", OPENROUTER_API_KEY: "" };
      const r = Bun.spawnSync([process.execPath, join(laneb, "r3/screen.ts"), "run", w!, ...(m.id === OPUS ? [] : ["--model", m.id])], { env });
      const out = r.stdout.toString();
      expect(r.exitCode).toBe(0);
      expect(readFileSync(join(w!, "screen.launch-exit"), "utf8")).toBe("0\n");
      expect(out).toContain("screen is incomplete (screen: 93 of 93 planned tasks have no trial");
      expect(existsSync(join(w!, "pilot.launch-exit"))).toBe(false);
      expect(readFileSync(events, "utf8").split("\n").filter((e) => e.startsWith("up "))).toHaveLength(1);
      expect(readRows(ledger).filter((x) => x.kind === "reserve").map((x) => x.id)).toEqual([m.parts[0]!.prefix + "vm"]);
    }, 60_000);

    test(`analyze removes ${m.label}'s earlier admitted.txt and r3b-tasks.txt before it reads plan.json`, () => {
      const { w, ledger } = work(m);
      writeFileSync(join(w, "admitted.txt"), "old\n");
      writeFileSync(join(w, "r3b-tasks.txt"), "old\n");
      writeFileSync(join(w, "plan.json"), JSON.stringify({ item: m.item, pilot_tasks: ["not-the-draw"] }));
      const r = analyzeCli(w, ledger, m.id === OPUS ? undefined : m.id);
      expect(r.code).toBe(1);
      expect(r.err).toContain("pilot tasks are not the seed 20261101 draw");
      expect(existsSync(join(w, "admitted.txt"))).toBe(false);
      expect(existsSync(join(w, "r3b-tasks.txt"))).toBe(false);
      rmSync(join(w, "plan.json"));
      writeFileSync(join(w, "admitted.txt"), "old\n");
      expect(analyzeCli(w, ledger, m.id === OPUS ? undefined : m.id).code).toBe(2);
      expect(existsSync(join(w, "admitted.txt"))).toBe(false);
    });
  }
});

// Stub harbor for the route check: it reads the one-task JobConfig, opens a real session at the proxy's control port,
// sends one request through the proxy to the stub upstream (with /investigate's expansion in a told session), closes the
// session and writes the trial. STUB_PLAN sets a session's mode by part and try, as in told2=noexpand: harbor (exit 1,
// no trial), noexpand, noresponse (no request reaches the model), notool, latefail (a passing trial, then exit 1).
const STUB = `import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const args = process.argv.slice(2);
const job = JSON.parse(readFileSync(args[args.indexOf("-c") + 1], "utf8"));
const a = job.agents[0], k = a.kwargs;
const kind = job.job_name.includes("-told-") ? "told" : "smoke";
const log = process.env.STUB_LOG;
const n = (existsSync(log) ? readFileSync(log, "utf8").trim().split("\\n").filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.kind === kind).length : 0) + 1;
const task = job.tasks[0].path;
appendFileSync(log, JSON.stringify({ kind, n, job: job.job_name, model_name: a.model_name, base_url: a.base_url, kwargs: k, overlay: job.environment.extra_docker_compose, toml: readFileSync(join(task, "task.toml"), "utf8"), keys: ["ANTHROPIC_API_KEY", "OPENROUTER_API_KEY", "OPENAI_API_KEY", "UBICLOUD_API_KEY", "GH_TOKEN"].map((x) => process.env[x] ?? null) }) + "\\n");
const mode = (process.env.STUB_PLAN ?? "").split(",").find((p) => p.startsWith(kind + n + "="))?.split("=")[1] ?? "ok";
if (mode === "harbor") process.exit(1);
const trial = "smoke-task__" + kind + n;
const control = k.control_url ?? "http://127.0.0.1:8788";
const s = await (await fetch(control + "/sessions", { method: "POST", body: JSON.stringify({ trial: trial + "__env", model: k.upstream_model, cap_usd: k.session_cap_usd, meta: { arm: k.arm } }) })).json();
if (mode !== "noresponse") {
  const content = kind === "told" && mode !== "noexpand" ? "<command-name>/investigate</command-name>\\nFix calc." : "Fix calc.";
  await (await fetch(a.base_url + "/v1/messages", { method: "POST", headers: { authorization: "Bearer " + s.token, "content-type": "application/json" }, body: JSON.stringify({ model: k.upstream_model, max_tokens: 100, messages: [{ role: "user", content }] }) })).text();
}
await fetch(control + "/sessions/" + s.id + "/close", { method: "POST", body: "{}" });
const d = join(process.cwd(), "jobs", job.job_name, trial);
mkdirSync(join(d, "evaluator"), { recursive: true });
writeFileSync(join(d, "config.json"), JSON.stringify({ task: { path: task }, agent: { name: a.name, kwargs: k } }));
writeFileSync(join(d, "result.json"), JSON.stringify({ trial_name: trial, verifier_result: { rewards: { reward: 1 } }, exception_info: null }));
const msgs = mode === "notool" ? [{ type: "AssistantMessage", content: [{ text: "done" }] }] : [{ type: "AssistantMessage", content: [{ id: "t1", name: "Bash", input: { command: "cat calc.py" } }] }, { type: "UserMessage", content: [{ tool_use_id: "t1", content: "def add" }] }];
writeFileSync(join(d, "evaluator", "sdk-messages.jsonl"), msgs.map((m) => JSON.stringify(m)).join("\\n") + "\\n");
process.exit(mode === "latefail" ? 1 : 0);
`;

// A route check rig: stub harbor and docker on PATH, a stub upstream behind the real proxy and ledger service, small
// arm tars with their own manifests, and r3a-sol's ledger approved at $140.
function rig(ledger?: string) {
  const dir = tmp("sol-route-check-");
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "stub-harbor.ts"), STUB);
  writeFileSync(join(dir, "bin", "harbor"), `#!/usr/bin/env bash\nexec "$STUB_BUN" "$STUB_JS" "$@"\n`);
  writeFileSync(join(dir, "bin", "docker"), "#!/usr/bin/env bash\necho 127.0.0.1\n");
  for (const f of ["harbor", "docker"]) chmodSync(join(dir, "bin", f), 0o755);
  for (const d of ["arms", "manifests"]) mkdirSync(join(dir, d));
  for (const name of ["none", "gstack"]) {
    writeFileSync(join(dir, "arms", name + ".tar"), name + " arm");
    writeFileSync(join(dir, "manifests", name + ".json"), JSON.stringify({ tar: { sha256: sha(name + " arm") } }));
  }
  writeFileSync(join(dir, "proxy.json"), JSON.stringify({ ...proxyConfig, routes: { ...proxyConfig.routes, openrouter: { ...proxyConfig.routes.openrouter!, base_url: `http://127.0.0.1:${upstream.port}` } } }));
  const path = ledger ?? join(dir, "r3a-sol.jsonl");
  if (!ledger) approve(path, "r3a-sol", 140);
  return { dir, ledger: path };
}
async function routeCheck(r: ReturnType<typeof rig>, env: Record<string, string> = {}, args: string[] = []) {
  nextUsd = 0.05;
  const p = Bun.spawn([process.execPath, join(laneb, "r3/route-check.ts"), ...args], {
    env: { PATH: join(r.dir, "bin") + ":" + process.env.PATH, HOME: r.dir, LEDGER: r.ledger, ARMS: join(r.dir, "arms"), ARM_MANIFESTS: join(r.dir, "manifests"), PROXY_CONFIG: join(r.dir, "proxy.json"),
      OPENROUTER_API_KEY: "fake-openrouter", ANTHROPIC_API_KEY: "fake-anthropic", UBICLOUD_API_KEY: "fake-ubicloud", GH_TOKEN: "fake-gh", OUT: join(r.dir, "out"), LEDGER_PORT: String(freePort()), PROXY_DATA_PORT: String(freePort()), PROXY_CONTROL_PORT: String(freePort()),
      STUB_LOG: join(r.dir, "calls.jsonl"), STUB_BUN: process.execPath, STUB_JS: join(r.dir, "stub-harbor.ts"), ...env },
    stdout: "pipe", stderr: "pipe",
  });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  const code = await p.exited;
  const calls = existsSync(join(r.dir, "calls.jsonl")) ? readFileSync(join(r.dir, "calls.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)) : [];
  const rec = existsSync(routeRecordPath(r.ledger)) ? (JSON.parse(readFileSync(routeRecordPath(r.ledger), "utf8")) as RouteRecord) : null;
  return { code, out: out + err, calls, rec };
}

describe("the route check's verdicts", () => {
  test("smoke counts tool results; told needs the expansion and a model response; Harbor's exit and a cap stop fail either", () => {
    const d = tmp("sol-judge-");
    const job = join(d, "job");
    const sessions: any[] = [];
    writeTrial(job, join(d, "s.jsonl"), toldTrial("smoke-task"), 0);
    sessions.push(...readFileSync(join(d, "s.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)));
    const jobDir = join(job, "job");
    expect(toolResults([{ type: "AssistantMessage", content: [{ id: "a", name: "Bash", input: {} }] }, { type: "UserMessage", content: [{ tool_use_id: "a" }] }])).toBe(1);
    expect(judge("told", 0, jobDir, sessions, proxyConfig, null)).toMatchObject({ pass: true, body_loaded: true, model_responded: true });
    expect(judge("smoke", 0, jobDir, sessions, proxyConfig, null)).toMatchObject({ pass: false, reasons: ["no tool call got its result back"] });
    expect(judge("told", 1, jobDir, sessions, proxyConfig, null).reasons).toEqual(["Harbor exited 1"]);
    expect(judge("told", 0, jobDir, sessions, proxyConfig, "ledger refused a reserve").reasons).toEqual(["the proxy latched a cap stop: ledger refused a reserve"]);
    expect(judge("told", 0, join(d, "nothing"), [], proxyConfig, null).reasons).toEqual(["no trial directory with a readable config.json"]);
    const bare = sessions.map((s) => ({ ...s, cmd_names: [], ok_responses: 0 }));
    expect(judge("told", 0, jobDir, bare, proxyConfig, null).reasons).toEqual([
      "the proxy's body-load probe did not record /investigate's expansion in the first request (cmd_names [])",
      "no model response reached the agent (4 requests, 0 refused, 0 ok)",
    ]);
  });

  test("a part gets one retry, a second failure drops the model, and a session cut short counts as failed", () => {
    const s = (kind: "smoke" | "told", t: number, pass: boolean, finished = true) => ({ kind, try: t, pass, finished_at: finished ? "x" : null, reasons: pass ? [] : ["Harbor exited 1"] }) as any;
    const rec = (sessions: any[]) => ({ item: "r3a-sol", model: SOL, verdict: null, reason: null, proxy_config_sha256: "x", sessions }) as RouteRecord;
    expect(next(rec([]))).toEqual({ kind: "smoke", try: 1 });
    expect(next(rec([s("smoke", 1, false)]))).toEqual({ kind: "smoke", try: 2 });
    expect(next(rec([s("smoke", 1, true)]))).toEqual({ kind: "told", try: 1 });
    expect(next(rec([s("smoke", 1, false), s("smoke", 2, true), s("told", 1, false), s("told", 2, true)]))).toEqual({ verdict: "pass", reason: "smoke passed on try 2, told passed on try 2" });
    expect(next(rec([s("smoke", 1, true), s("told", 1, false), s("told", 2, false)]))).toEqual({ verdict: "drop", reason: "the told part failed twice: try 1: Harbor exited 1 | try 2: Harbor exited 1" });
    const cut = rec([s("smoke", 1, false, false)]);
    expect(next(cut)).toEqual({ kind: "smoke", try: 2 });
    expect(cut.sessions[0]!.reasons).toEqual(["Harbor exited 1"]);
    expect(next(rec([{ kind: "smoke", try: 1, pass: false, finished_at: null, reasons: [] }, s("smoke", 2, false)]))).toMatchObject({ verdict: "drop", reason: "the smoke part failed twice: try 1: the session did not finish (cut short) | try 2: Harbor exited 1" });
  });
});

describe("route-check.ts", () => {
  test("both parts pass on r3a-sol: Sol's R3a arms and cell through the real proxy and ledger, keys kept from Harbor, every reserve settled", async () => {
    const r = rig();
    const { code, out, calls, rec } = await routeCheck(r);
    expect(out).toContain("route check: gpt-6.1-sol passed on r3a-sol (smoke passed on try 1, told passed on try 1)");
    expect(code).toBe(0);
    expect(calls.map((c) => [c.kind, c.model_name, c.kwargs.upstream_model, c.kwargs.arm, c.kwargs.told_skill ?? null, c.kwargs.system_prompt, c.kwargs.session_cap_usd, c.kwargs.arm_sha256])).toEqual([
      ["smoke", "anthropic/gpt-6.1-sol", SOL, "none", null, "claude-code-preset", 4, sha("none arm")],
      ["told", "anthropic/gpt-6.1-sol", SOL, "gstack", "investigate", "claude-code-preset", 4, sha("gstack arm")],
    ]);
    for (const c of calls) {
      expect(c.keys).toEqual(["placeholder-not-a-key", null, null, null, null]);
      expect(c.overlay).toEqual([join(laneb, "runner/agent-caps.compose.yaml")]);
      expect(c.toml).not.toContain("allowlist");
      expect(c.toml).not.toContain("no-network");
    }
    expect(rec).toMatchObject({ item: "r3a-sol", model: SOL, verdict: "pass", open_route_reserves: [], proxy_config_sha256: sha(readFileSync(join(r.dir, "proxy.json"))) });
    expect(rec!.sessions.map((s) => [s.kind, s.try, s.harbor_exit, s.pass, s.tool_results, s.body_loaded, s.model_responded])).toEqual([["smoke", 1, 0, true, 1, false, true], ["told", 1, 0, true, 1, true, true]]);
    expect(rec!.sessions[1]!.proxy_session).toMatchObject({ model: SOL, ok_responses: 1, refused: 0, cmd_names: ["investigate"] });
    const rows = readRows(r.ledger).filter((x) => x.kind !== "approval");
    expect(rows.map((x) => x.kind)).toEqual(["reserve", "settle", "reserve", "settle"]);
    expect(rows.every((x) => x.id.startsWith("r3a-sol-route/"))).toBe(true);
    expect(rows.filter((x) => x.kind === "reserve").every((x) => x.usd_micros === 4_000_000)).toBe(true);
    expect(() => bindCheck(r.ledger, sol)).not.toThrow();
    const again = await routeCheck(r);
    expect(again.code).toBe(0);
    expect(again.out).toContain("route check: gpt-6.1-sol already passed on r3a-sol");
    expect(again.calls).toHaveLength(2);
    expect(readRows(r.ledger)).toHaveLength(5);
  }, 60_000);

  test("a failed part is retried once and the record keeps the failure", async () => {
    const r = rig();
    const { code, rec } = await routeCheck(r, { STUB_PLAN: "smoke1=harbor,told1=latefail" });
    expect(code).toBe(0);
    expect(rec!.sessions.map((s) => [s.kind, s.try, s.pass, s.reasons])).toEqual([
      ["smoke", 1, false, ["Harbor exited 1", "no trial directory with a readable config.json"]], ["smoke", 2, true, []],
      ["told", 1, false, ["Harbor exited 1"]], ["told", 2, true, []],
    ]);
    expect(rec!.reason).toBe("smoke passed on try 2, told passed on try 2");
  }, 60_000);

  test("a told part that fails twice drops Sol, the record says why, and the screen and a rerun are refused", async () => {
    const r = rig();
    const { code, out, calls, rec } = await routeCheck(r, { STUB_PLAN: "told1=noexpand,told2=noresponse" });
    expect(code).toBe(1);
    expect(out).toContain("route check: gpt-6.1-sol dropped out of R3a: the told part failed twice: try 1: the proxy's body-load probe did not record /investigate's expansion in the first request (cmd_names []) | try 2: the proxy's body-load probe did not record /investigate's expansion in the first request (cmd_names null); no model response reached the agent (0 requests, 0 refused, 0 ok)");
    expect(rec).toMatchObject({ verdict: "drop", open_route_reserves: [] });
    expect(calls).toHaveLength(3);
    expect(() => bindCheck(r.ledger, sol)).toThrow("GPT-6.1 Sol dropped out of R3a at its route check: the told part failed twice");
    const again = await routeCheck(r);
    expect(again.code).toBe(1);
    expect(again.calls).toHaveLength(3);
  }, 60_000);

  test("a smoke part that fails twice drops Sol before its told session", async () => {
    const r = rig();
    const { code, calls, rec } = await routeCheck(r, { STUB_PLAN: "smoke1=harbor,smoke2=notool" });
    expect(code).toBe(1);
    expect(calls.map((c) => c.kind)).toEqual(["smoke", "smoke"]);
    expect(rec!.reason).toBe("the smoke part failed twice: try 1: Harbor exited 1; no trial directory with a readable config.json | try 2: no tool call got its result back");
  }, 60_000);

  test("a session cut short counts as a failed try on the next run", async () => {
    const r = rig();
    writeFileSync(routeRecordPath(r.ledger), JSON.stringify({ item: "r3a-sol", model: SOL, verdict: null, reason: null, proxy_config_sha256: "x", sessions: [{ kind: "smoke", try: 1, job: "j", started_at: "x", finished_at: null, reasons: [] }] }));
    const { code, calls, rec } = await routeCheck(r, { STUB_PLAN: "smoke1=harbor" });
    expect(code).toBe(1);
    expect(calls).toHaveLength(1);
    expect(rec!.reason).toBe("the smoke part failed twice: try 1: the session did not finish (cut short) | try 2: Harbor exited 1; no trial directory with a readable config.json");
  }, 60_000);

  test("it refuses Opus, another cap, a bound item and arm tars off their manifests, before any session", async () => {
    const r = rig();
    expect((await routeCheck(r, {}, ["--model", OPUS])).out).toContain("E_USAGE claude-opus-5-5 has no route check in R3a (route-checked models: gpt-6.1-sol)");
    writeFileSync(join(r.dir, "arms", "gstack.tar"), "other bytes");
    const offManifest = await routeCheck(r);
    expect(offManifest.code).toBe(1);
    expect(offManifest.out).toContain("arm gstack: tar sha256 " + sha("other bytes") + " is not the preregistered");
    writeFileSync(r.ledger + ".bound", "{}");
    expect((await routeCheck(r)).out).toContain("r3a-sol is already bound to its screen");
    const cap = rig(join(tmp("sol-cap-"), "r3a-sol.jsonl"));
    approve(cap.ledger, "r3a-sol", 150);
    expect((await routeCheck(cap)).out).toContain("r3a-sol's cap is $150, not the R3 amendment's $140");
    for (const x of [r, cap]) expect(existsSync(join(x.dir, "calls.jsonl"))).toBe(false);
    expect(readRows(r.ledger).filter((x) => x.kind !== "approval")).toEqual([]);
  }, 60_000);
});

// Opus's work dir and ledger, analyzed before and after Sol's line stops at its route check and at its cap.
describe("Sol's stops and Opus", () => {
  test("a Sol route-check drop and a Sol cap stop leave Opus's ledger, files and outcome as they were", async () => {
    const o = work(opus);
    const before = analyzeCli(o.w, o.ledger);
    expect(before.code).toBe(0);
    const files = ["record.json", "admitted.txt", "r3b-tasks.txt", "trials.jsonl"];
    const snap = () => [readFileSync(o.ledger, "utf8"), ...files.map((f) => readFileSync(join(o.w, f), "utf8").replace(/"ts":"[^"]*"/g, ""))];
    const was = snap();
    const r = rig();
    expect((await routeCheck(r, { STUB_PLAN: "smoke1=harbor,smoke2=harbor" })).code).toBe(1);
    const run = Bun.spawnSync([process.execPath, join(laneb, "r3/screen.ts"), "run", o.w, "--model", SOL], { env: { ...process.env, LEDGER: r.ledger, VM_USD_PER_HOUR: "0.60", UBI_RUNNER: "/bin/false", UBI_OWNER: "test" } });
    expect(run.stderr.toString()).toContain("GPT-6.1 Sol dropped out of R3a at its route check");
    const s = work(sol, { after: (w) => writeFileSync(join(w, "screen/pulled/out/cap-stop.json"), JSON.stringify({ cap_stop: "ledger refused a reserve for t__1 at x" })) });
    const stopped = analyzeCli(s.w, s.ledger, SOL);
    expect(stopped.code).toBe(4);
    expect(stopped.out).toContain("R3 outcome for GPT-6.1 Sol: none (incomplete: screen: ledger refused a reserve for t__1 at x). Sol's R3a stopped");
    const after = analyzeCli(o.w, o.ledger);
    expect(after).toEqual(before);
    expect(snap()).toEqual(was);
    expect(readRows(o.ledger).every((x) => x.item === "r3a-screen")).toBe(true);
    expect(existsSync(o.ledger + ".bound")).toBe(false);
  }, 60_000);
});

// Sol's planned r3a-sol layout against its real $140 cap and $4 allowance (R3 amendment section 7, and the Captain's ask
// after R2's frozen caps couldn't admit their own allowance). Every rule that can refuse a start runs for real: the ledger
// service's reserve per session at the cell's allowance (ledger.ts serve), the proxy's batch cap per part at the item's cap
// (proxy.ts, started as vm-run.sh starts it), and each VM block reserved on the item, the first through the ledger CLI and
// the rest through the service, as launch.sh does, at the amendment's $0.60 an hour in 4-hour blocks (vmBlock). As in the
// amendment's r3a-caps.ts, a part's blocks are all reserved when it starts and settled when it ends (earlier than
// launch.sh, so a pass is conservative), 8 sessions run at a time, a told trial costs 1.9 times a none trial and a route
// check session costs a none trial. The stub upstream bills each session that cost. "plan" is 12 VM hours ($7.20) and
// "wide" 13 blocks ($31.20), one of them for the route check.
const VM = { plan: { route: 0, screen: 2, pilot: 1 }, wide: { route: 1, screen: 8, pilot: 4 } };
async function layout(c: number, vm: keyof typeof VM, routeSessions = 2, flat?: number) {
  const dir = tmp("sol-caps-");
  const ledger = join(dir, "r3a-sol.jsonl");
  approve(ledger, sol.item, sol.capUsd);
  const port = freePort();
  const svc = Bun.spawn([process.execPath, join(laneb, "runner/ledger.ts"), "serve", "--path", ledger, "--item", sol.item, "--port", String(port)], { stdout: "ignore", stderr: "ignore" });
  const ledgerUrl = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100 && !(await fetch(ledgerUrl + "/status").then((r) => r.ok, () => false)); i++) await Bun.sleep(100);
  const block = vmBlock("0.60", "4", sol.capUsd);
  const allowance = solCell.session_cap_usd as number;
  const usd = (m: number) => "$" + fromMicros(m).toFixed(2);
  const parts = [
    { name: "route", prefix: sol.routePrefix!, n: routeSessions, cost: c, blocks: VM[vm].route, batchCap: undefined as number | undefined },
    { name: "screen", prefix: sol.parts[0]!.prefix, n: 93, cost: c, blocks: VM[vm].screen, batchCap: sol.capUsd },
    { name: "pilot", prefix: sol.parts[1]!.prefix, n: 10, cost: c * 1.9, blocks: VM[vm].pilot, batchCap: sol.capUsd },
  ];
  const cli = (cmd: string, id: string) => Bun.spawnSync([process.execPath, join(laneb, "runner/ledger.ts"), cmd, "--path", ledger, "--item", sol.item, "--id", id, "--usd", String(block), "--detail", "VM hours"]).exitCode;
  let ran = 0, peak = 0, peakAt = "", stop: string | null = null;
  try {
    for (const p of parts) {
      const ids = Array.from({ length: p.blocks }, (_, b) => p.prefix + (b === 0 ? "vm" : `vm-${b + 1}`));
      for (const [b, id] of ids.entries()) {
        const ok = b === 0 ? cli("reserve", id) === 0 : (await fetch(ledgerUrl + "/reserve", { method: "POST", body: JSON.stringify({ id, usd_micros: toMicros(block) }) })).status === 200;
        if (!ok) { stop = `${p.name}'s VM block ${b + 1} refused`; break; }
      }
      if (stop) break;
      const proxy = startProxy({ config: stubConfig(), dataHost: "127.0.0.1", dataPort: 0, controlPort: 0, env: { FAKE_KEY: "fake" }, closeWaitMs: 300, logPath: join(dir, p.name + "-log.jsonl"), sessionsPath: join(dir, p.name + "-sessions.jsonl"), ledgerUrl, ledgerPrefix: p.prefix, globalCapMicros: p.batchCap === undefined ? undefined : toMicros(p.batchCap) });
      const control = `http://127.0.0.1:${proxy.control.port}`;
      const open: string[] = [];
      const close = (id: string) => fetch(control + `/sessions/${id}/close`, { method: "POST", body: "{}" }).then((r) => r.json());
      for (let i = 0; i < p.n; i++) {
        if (open.length === 8) await close(open.shift()!);
        const t = totals(readRows(ledger));
        const res = await fetch(control + "/sessions", { method: "POST", body: JSON.stringify({ trial: `${p.name}-${i + 1}__env`, model: SOL, cap_usd: allowance }) });
        const body = (await res.json()) as any;
        if (res.status !== 200) { stop = `${p.name} trial ${i + 1} of ${p.n}: settled ${usd(t.settledMicros)} + open ${usd(t.openReservedMicros)} + $${allowance} > $${sol.capUsd} (${body.error})`; break; }
        const committed = t.settledMicros + t.openReservedMicros + toMicros(allowance);
        if (committed > peak) { peak = committed; peakAt = `${p.name} trial ${i + 1}`; }
        nextUsd = flat ?? p.cost;
        const m = await fetch(`http://127.0.0.1:${proxy.data.port}/v1/messages`, { method: "POST", headers: { authorization: "Bearer " + body.token, "content-type": "application/json" }, body: JSON.stringify({ model: SOL, max_tokens: 100, messages: [{ role: "user", content: "fix it" }] }) });
        expect(m.status).toBe(200);
        await m.text();
        open.push(body.id);
        ran++;
      }
      for (const id of open) await close(id);
      await proxy.stop();
      if (stop) break;
      for (const id of ids) expect(cli("settle", id)).toBe(0);
    }
  } finally {
    svc.kill();
    await svc.exited;
  }
  const t = totals(readRows(ledger));
  return { ran, planned: routeSessions + 103, stop, peak: fromMicros(peak), peakAt, settled: fromMicros(t.settledMicros), openIds: t.openIds };
}

describe("r3a-sol's cap against its own rules", () => {
  test("at every planning figure with VM hours near plan, every planned session runs, the route check retried too", async () => {
    for (const [c, peak, settled] of [[0.41, 79.71, 53.94], [0.6, 98.48, 75.6], [0.85, 123.18, 104.1]] as const) {
      const r = await layout(c, "plan");
      expect(r).toMatchObject({ ran: 105, planned: 105, stop: null, peakAt: "pilot trial 10", openIds: [] });
      expect(r.peak).toBeCloseTo(peak, 2);
      expect(r.settled).toBeCloseTo(settled, 6);
    }
    expect(await layout(0.85, "plan", 4)).toMatchObject({ ran: 107, planned: 107, stop: null });
  }, 120_000);

  test("with VM hours at #112's $30 allowance, the low and central figures run every session and the high figure stops in its pilot", async () => {
    for (const [c, peak] of [[0.41, 103.71], [0.6, 122.48]] as const) {
      const r = await layout(c, "wide");
      expect(r).toMatchObject({ ran: 105, stop: null, openIds: [] });
      expect(r.peak).toBeCloseTo(peak, 2);
    }
    const high = await layout(0.85, "wide");
    expect(high.ran).toBe(102);
    expect(high.stop).toBe("pilot trial 8 of 10: settled $102.35 + open $37.60 + $4 > $140 (ledger refused the reserve)");
  }, 120_000);

  test("no cap of this size holds every session at its full allowance: at $4 a session, Sol stops at screen trial 32", async () => {
    const r = await layout(4 / 1.9, "plan", 2, 4);
    expect(r.ran).toBe(33);
    expect(r.stop).toStartWith("screen trial 32 of 93: ");
  }, 120_000);
});

describe("isolation from other runs", () => {
  for (const v of ["LEDGER_PORT", "PROXY_CONTROL_PORT", "PROXY_DATA_PORT"]) {
    test(`route-check refuses a ${v} another service already answers on, before any service starts or session runs`, async () => {
      const r = rig();
      const other = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => Response.json({ settledMicros: 0 }) });
      try {
        const before = readFileSync(r.ledger, "utf8");
        const { code, out, calls, rec } = await routeCheck(r, { [v]: String(other.port) });
        expect(code).toBe(2);
        expect(out).toContain(`E_USAGE something already answers on 127.0.0.1:${other.port} (another run's ledger service or proxy?)`);
        expect(calls).toEqual([]);
        expect(rec).toBeNull();
        expect(readFileSync(r.ledger, "utf8")).toBe(before);
        expect(existsSync(join(r.dir, "out", "ledger-service.log"))).toBe(false);
      } finally {
        other.stop(true);
      }
    });
  }

  test("route-check turns Harbor's own retries off, so each try is one session", async () => {
    const r = rig();
    expect((await routeCheck(r)).code).toBe(0);
    const jobs = readdirSync(join(r.dir, "out")).filter((f) => /^route-.*\.json$/.test(f)).map((f) => JSON.parse(readFileSync(join(r.dir, "out", f), "utf8")));
    expect(jobs.map((j) => j.retry.max_retries)).toEqual([0, 0]);
  });

  test("each model's ledger service has its own default port", () => {
    expect([opus.ledgerPort, sol.ledgerPort]).toEqual(["9911", "9912"]);
  });

  for (const [m, other] of [[opus, sol], [sol, opus]] as const) {
    test(`run with ${m.label} refuses a work dir prepared for ${other.label}'s item before it binds or launches anything`, () => {
      const root = tmp("sol-plan-item-");
      const w = join(root, "work");
      mkdirSync(w);
      writeFileSync(join(w, "plan.json"), JSON.stringify({ item: other.item, pilot_tasks: pilotTasks(bandIds()) }));
      const ledger = join(root, m.item + ".jsonl");
      approve(ledger, m.item, m.capUsd);
      if (m.routePrefix) passRecord(ledger, m);
      const before = readFileSync(ledger, "utf8");
      const env = { ...process.env, LEDGER: ledger, VM_USD_PER_HOUR: "0.60", LEDGER_PORT: String(freePort()), UBI_RUNNER: "/bin/false", UBI_OWNER: "test", ANTHROPIC_API_KEY: "", OPENROUTER_API_KEY: "" };
      const r = Bun.spawnSync([process.execPath, join(laneb, "r3/screen.ts"), "run", w, ...(m.id === OPUS ? [] : ["--model", m.id])], { env });
      expect(r.exitCode).toBe(2);
      expect(r.stderr.toString()).toContain(`E_USAGE ${w}/plan.json is item ${other.item}'s, not ${m.label}'s ${m.item}; nothing was bound or launched`);
      expect(existsSync(ledger + ".bound")).toBe(false);
      expect(existsSync(join(w, "screen.launch-exit"))).toBe(false);
      expect(readFileSync(ledger, "utf8")).toBe(before);
    });
  }

  test("run refuses a ledger port another service already answers on and leaves r3a-sol unbound", () => {
    const root = tmp("sol-port-");
    const w = join(root, "work");
    mkdirSync(w);
    writeFileSync(join(w, "plan.json"), JSON.stringify({ item: sol.item, pilot_tasks: pilotTasks(bandIds()) }));
    const ledger = join(root, "r3a-sol.jsonl");
    approve(ledger, sol.item, sol.capUsd);
    passRecord(ledger, sol);
    const before = readFileSync(ledger, "utf8");
    const other = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => Response.json({}) });
    try {
      const env = { ...process.env, LEDGER: ledger, VM_USD_PER_HOUR: "0.60", LEDGER_PORT: String(other.port), UBI_RUNNER: "/bin/false", UBI_OWNER: "test", ANTHROPIC_API_KEY: "", OPENROUTER_API_KEY: "" };
      const r = Bun.spawnSync([process.execPath, join(laneb, "r3/screen.ts"), "run", w, "--model", SOL], { env });
      expect(r.exitCode).toBe(2);
      expect(r.stderr.toString()).toContain(`E_USAGE something already answers on 127.0.0.1:${other.port} (another run's ledger service?); set LEDGER_PORT to a free port; r3a-sol is still unbound`);
      expect(existsSync(ledger + ".bound")).toBe(false);
      expect(readFileSync(ledger, "utf8")).toBe(before);
    } finally {
      other.stop(true);
    }
  });
});
