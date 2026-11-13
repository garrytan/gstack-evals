// Copyright (c) 2026 Garry Tan. MIT License.
// The harness mechanics live judge wiring (lanes/harness-mechanics/README.md "Not built"): the arm-to-backend mapping
// carried into the launcher (piece 5), the byte-identical golden for L1 and the non-judge arms, the judge proxy's HTTP
// ReservationLedger (its cap stop), and the post-run judge check (journalCheck plus jevChanges, pieces 3 and 4). Keyless.
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ARMS, FOUR, JUDGE, REPO, SMOKE_PART } from "../../lanes/harness-mechanics/pins.ts";
import { HM_PROFILE, itemPlan } from "../../lanes/harness-mechanics/plans.ts";
import { armSpec, jobConfig } from "../../quick/laneb/runner/grid.ts";
import { ARM_SPECS as L1_ARMS, hostSecretKeys, jobFile, relaunchRects, splitJobs, type Plan, type Rect } from "../../quick/laneb/l1/l1.ts";
import { HttpReservations } from "../../lanes/harness-mechanics/judge/judge-proxy.ts";
import { journalSpend, judgePartsCheck, judgeRunCheck, readJudgeSessions } from "../../lanes/harness-mechanics/judge-check.ts";
import { JEV_MODEL, type HookSession } from "../../lanes/harness-mechanics/judge.ts";
import { buildRunMarkers, checkJudgeCustody, judgePartTasks, prepareJudgeCustody } from "../../lanes/harness-mechanics/judge-custody.ts";
import { report, type HmRowIn, type ReportConfig } from "../../lanes/harness-mechanics/analyze.ts";
import { MeteringProxy } from "../../src/runner/proxy/metering-proxy.ts";
import type { CallOutcome, CellAttempt, LedgerReply, Reservation, ReservationLedger } from "../../src/types.ts";

// The two judge deciders every judge slot binds (laneb_hooks.JUDGE_DECIDERS). particle-1 rides OpenRouter, jev TypeSafe.
const JUDGE_DECIDERS = ["typesafe:jev-1.13.0", "openrouter:particle-ai/particle-1"];
// A fake pristine listing (the pristine /testbed has an old test and file, so the task's new ones read as runner-only).
const FAKE_LISTING = { run: async () => ({ code: 0, stdout: "src/app.py\ntests/test_old.py\n--names--\ndef test_old_behavior\n", stderr: "" }) };
const FAILING_DOCKER = { run: async () => ({ code: 1, stdout: "", stderr: "no such image" }) };
// A hidden-test patch: one new test name and one new test path, both runner-only and over MIN_MARKER_CHARS.
const TEST_PATCH = ["diff --git a/tests/test_regression.py b/tests/test_regression.py", "new file mode 100644", "--- /dev/null", "+++ b/tests/test_regression.py", "@@ -0,0 +1,2 @@", "+def test_hidden_regression_case():", "+    assert fixed()"].join("\n");
function makeTaskSource(tasksDir: string, id: string) {
  const t = join(tasksDir, id);
  mkdirSync(join(t, "environment"), { recursive: true });
  mkdirSync(join(t, "tests"), { recursive: true });
  writeFileSync(join(t, "environment", "Dockerfile"), "FROM registry.example/" + id + ":pin\nRUN echo build\n");
  writeFileSync(join(t, "tests", "patch.diff"), TEST_PATCH);
  writeFileSync(join(t, "instruction.md"), "fix the parser");
}
// An arm as prepare-run hands it to jobConfig: a judge arm gets the run dir's markers_dir.
const jobArm = (name: keyof typeof ARMS) => ({ ...armSpec(ARMS[name].spec), ...(name.startsWith("judge") ? { markers_dir: "/vm/run/judge-markers" } : {}), tar: "/vm/run/arms/x.tar", sha256: "a" });
// A run dir's job.json as prepare-run writes it (grid.ts jobConfig): each task a {path} under the VM's tasks dir, and a job
// name that is no task's.
function makeJudgeRun(dir: string, tasks: string[], judge = true, name = "run") {
  const run = join(dir, name);
  mkdirSync(run, { recursive: true });
  writeFileSync(join(run, "job.json"), JSON.stringify(jobConfig({ ...JOB_BASE, job_name: "pilot-opus", tasks, arms: [jobArm(judge ? "judge-jev" : "none")] })));
  return run;
}

class InMemoryLedger implements ReservationLedger {
  reservations = new Map<string, Reservation>();
  async reserve(r: { idempotency_key: string; lease_id: string; cell: CellAttempt; max_micros: number }): Promise<LedgerReply> {
    const reservation: Reservation = { reservation_id: `res_${this.reservations.size + 1}`, ...r, state: "reserved", spent_micros: null, usage: null };
    this.reservations.set(reservation.reservation_id, reservation);
    return { ok: true, reservation };
  }
  async settle(id: string, outcome: CallOutcome): Promise<LedgerReply> {
    const r = this.reservations.get(id)!;
    Object.assign(r, outcome.kind === "spent" ? { state: "settled", spent_micros: outcome.spent_micros, usage: outcome.usage } : { state: "unknown" });
    return { ok: true, reservation: r };
  }
}

let cleanup: Array<() => void> = [];
afterEach(() => {
  for (const c of cleanup) c();
  cleanup = [];
});
const tempDir = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

const JOB_BASE = {
  job_name: "hm", tasks_dir: "/vm/run/tasks", tasks: ["a"], attempts: 1, n_concurrent: 1, agent_dir: "/vm/runner/agent", runner_dir: "/vm/runner",
  base_url: "http://__GATEWAY__:8787", max_output_tokens: 32000, verifier_timeout_multiplier: 2,
  models: [{ id: "claude-opus-5-5", harbor_model: "anthropic/claude-opus-5-5", session_cap_usd: 5 }],
};
const JUDGE_CONFIG = (b: string) => "/root/.hm/judge/judge-" + b + ".json";
const usage = { input: 1, output: 1, reasoning: 0, cache_read: 0, cache_write: 0 };

describe("arm-to-backend mapping (piece 5)", () => {
  test("only the judge specs carry a backend; judge-jev is jev, judge-p1 is p1, and their configs differ", () => {
    for (const [name, a] of Object.entries(ARMS)) {
      const s = armSpec(a.spec);
      expect(s.backend).toBe(a.backend);
      if ((JUDGE as string[]).includes(name)) expect(["jev", "p1"]).toContain(s.backend!);
      else expect(s.backend).toBeUndefined();
    }
    expect(armSpec(ARMS["judge-jev"].spec).backend).toBe("jev");
    expect(armSpec(ARMS["judge-p1"].spec).backend).toBe("p1");
    expect(JUDGE_CONFIG("jev")).not.toBe(JUDGE_CONFIG("p1"));
  });

  test("a judge arm's job.json carries judge_backend and runs on the hooks agent; different backends, different config path", () => {
    const build = (name: string) => jobConfig({ ...JOB_BASE, arms: [{ ...armSpec(ARMS[name as keyof typeof ARMS].spec), tar: "/vm/run/arms/judge.tar", sha256: "a" }] }).agents[0];
    const jev = build("judge-jev"), p1 = build("judge-p1");
    expect([jev.import_path, jev.kwargs.judge_backend]).toEqual(["laneb_hooks:LanebHooksAgent", "jev"]);
    expect([p1.import_path, p1.kwargs.judge_backend]).toEqual(["laneb_hooks:LanebHooksAgent", "p1"]);
    expect(JUDGE_CONFIG(jev.kwargs.judge_backend!)).not.toBe(JUDGE_CONFIG(p1.kwargs.judge_backend!));
  });

  test("markers_dir rides a judge arm's kwargs only when set (prepare-run injects it; one dir serves every task in the rectangle)", () => {
    const withDir = jobConfig({ ...JOB_BASE, arms: [{ ...armSpec(ARMS["judge-jev"].spec), markers_dir: "/vm/run/judge-markers", tar: "/vm/run/arms/judge.tar", sha256: "a" }] }).agents[0];
    expect(withDir.kwargs.markers_dir).toBe("/vm/run/judge-markers");
    const without = jobConfig({ ...JOB_BASE, arms: [{ ...armSpec(ARMS["judge-jev"].spec), tar: "/vm/run/arms/judge.tar", sha256: "a" }] }).agents[0];
    expect("markers_dir" in without.kwargs).toBe(false);
  });
});

describe("byte-identical golden (piece 'additive, gated on backend')", () => {
  test("every L1 arm's job.json has no judge_backend, no markers_dir and no HM_JUDGE_*", () => {
    const text = JSON.stringify(jobConfig({ ...JOB_BASE, arms: Object.values(L1_ARMS).map((e) => ({ ...armSpec(e as string), tar: "/vm/run/arms/x.tar", sha256: "a" })) }));
    expect(text).not.toContain("judge_backend");
    expect(text).not.toContain("markers_dir");
    expect(text).not.toContain("HM_JUDGE");
  });

  test("the four non-judge HM arms (none, plain-2, verify-prose, verify-hook) carry no judge_backend and no markers_dir", () => {
    const text = JSON.stringify(jobConfig({ ...JOB_BASE, arms: FOUR.map((name) => ({ ...armSpec(ARMS[name].spec), tar: "/vm/run/arms/x.tar", sha256: "a" })) }));
    expect(text).not.toContain("judge_backend");
    expect(text).not.toContain("markers_dir");
    expect(text).not.toContain("HM_JUDGE");
  });
});

describe("judge proxy ReservationLedger over the ledger service (piece 1 ledger)", () => {
  test("a within-cap reserve is granted under the part's judge prefix; a reserve beyond the item cap is refused CAP_STOP; reserves are idempotent; a spent call settles at its metered cost and an unknown one at its reserved maximum, marked unknown", async () => {
    let total = 0;
    const cap = 1_000_000;
    const reqs: { path: string; body: any }[] = [];
    const srv = Bun.serve({
      port: 0,
      async fetch(req) {
        const path = new URL(req.url).pathname, body = (await req.json()) as any;
        reqs.push({ path, body });
        if (path === "/reserve") {
          if (total + body.usd_micros > cap) return Response.json({ ok: false, reason: "cap" }, { status: 409 });
          total += body.usd_micros;
          return Response.json({ ok: true });
        }
        if (path === "/settle") return Response.json({ ok: true });
        return new Response("no route", { status: 404 });
      },
    });
    try {
      // vm-run.sh passes --ledger-prefix "judge:$prefix", the part's ledger prefix (E1).
      const prefix = "judge:stage3-pilot/smoke-opus/", ledger = new HttpReservations("http://127.0.0.1:" + srv.port, prefix);
      const cell = { run_id: "r", arm: "judge-jev", task: "t", model: "m", trial: 1, attempt: 1, meter_id: "m1" };
      const within = await ledger.reserve({ idempotency_key: "m1:0:1", lease_id: "L", cell, max_micros: 300_000 });
      expect(within.ok && within.reservation.reservation_id).toBe(prefix + "m1:0:1");
      const repeat = await ledger.reserve({ idempotency_key: "m1:0:1", lease_id: "L", cell, max_micros: 300_000 });
      expect(repeat.ok && repeat.reservation.reservation_id).toBe(prefix + "m1:0:1");
      expect(reqs.filter((r) => r.path === "/reserve").length).toBe(1); // idempotent: no second /reserve
      const lost = await ledger.reserve({ idempotency_key: "m1:1:1", lease_id: "L", cell, max_micros: 250_000 });
      expect(lost.ok).toBe(true);
      const beyond = await ledger.reserve({ idempotency_key: "m1:2:1", lease_id: "L", cell, max_micros: 600_000 });
      expect(!beyond.ok && beyond.code).toBe("CAP_STOP");
      expect(reqs.find((r) => r.path === "/reserve")!.body).toEqual({ id: prefix + "m1:0:1", usd_micros: 300_000, meta: { cell, lease_id: "L" } });
      // Spent: the metered cost, with its usage. Unknown: the reserved maximum, marked unknown (D1), so nothing stays open.
      const settled = await ledger.settle(prefix + "m1:0:1", { kind: "spent", spent_micros: 100_000, usage });
      expect(settled.ok && settled.reservation.state).toBe("settled");
      const unknown = await ledger.settle(prefix + "m1:1:1", { kind: "unknown" });
      expect(unknown.ok && unknown.reservation.state).toBe("unknown");
      expect(reqs.filter((r) => r.path === "/settle").map((r) => r.body)).toEqual([
        { id: prefix + "m1:0:1", usd_micros: 100_000, meta: { usage } },
        { id: prefix + "m1:1:1", usd_micros: 250_000, meta: { unknown: true } },
      ]);
    } finally {
      srv.stop(true);
    }
  });
});

const D11_CANARY = "hm-d11-canary-0123456789abcdef0123456789abcdef";
describe("D11: the judge proxy writes the ledger's own 409 reason into its journal, and still maps every 409 to CAP_STOP", () => {
  test("a 409 for a reused id and a 409 at the cap are both CAP_STOP, each journaled with the ledger's reason", async () => {
    const srv = Bun.serve({
      port: 0,
      async fetch(req) {
        const body = (await req.json()) as any;
        if (new URL(req.url).pathname !== "/reserve") return Response.json({ ok: true });
        return Response.json({ ok: false, reason: body.id.endsWith("m1:1:1") ? "reserve id reused with a different amount" : "cap" }, { status: 409 });
      },
    });
    try {
      const prefix = "judge:stage3-pilot-2/smoke-opus/", ledger = new HttpReservations("http://127.0.0.1:" + srv.port, prefix);
      const cell = { run_id: "r", arm: "judge-p1", task: "t", model: "m", trial: 1, attempt: 1, meter_id: "m1" };
      const reused = await ledger.reserve({ idempotency_key: "m1:1:1", lease_id: "L", cell, max_micros: 300_000 });
      const capped = await ledger.reserve({ idempotency_key: "m1:2:1", lease_id: "L", cell, max_micros: 300_000 });
      expect([!reused.ok && reused.code, !capped.ok && capped.code]).toEqual(["CAP_STOP", "CAP_STOP"]);
      expect(!reused.ok && reused.message).toContain("the ledger's reason: reserve id reused with a different amount");
      expect(!capped.ok && capped.message).toContain("the ledger's reason: cap");
      const dir = tempDir("hm-judge-409-");
      const proxy = new MeteringProxy({
        ledger, leaseId: "hm-judge-409.0001.abcdef", host: "127.0.0.1", managementSocket: join(dir, "m.sock"), managementToken: "management-token-0123456789",
        journal: join(dir, "judge-journal.ndjson"), retry: { attempts: 5, elapsed_ms: 300_000 }, env: { OPENROUTER_API_KEY: "sk-or-hm-0123456789" },
        maxOutputTokens: 32_000, sleep: async () => {}, fetch: async () => Response.json({ id: "x", choices: [], usage: { prompt_tokens: 1, completion_tokens: 1 } }), allowanceCode: "DR_ALLOWANCE_STOP",
      });
      proxy.start();
      cleanup.push(() => proxy.stop());
      const b = proxy.bind({ cell: { run_id: "hm", arm: "judge-p1", task: "t1", model: "particle-ai/particle-1", trial: 1, attempt: 1 }, models: JUDGE_DECIDERS, deciders: JUDGE_DECIDERS, allowance_micros: 2_000_000, forbidden_markers: [D11_CANARY], canary: D11_CANARY });
      const res = await fetch("http://127.0.0.1:" + proxy.port + "/" + b.slot + "/openrouter/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + b.token }, body: JSON.stringify({ model: "particle-ai/particle-1", max_tokens: 100, messages: [{ role: "user", content: "was the change made?" }] }) });
      expect(res.status).toBe(402);
      const refusal = readFileSync(join(dir, "judge-journal.ndjson"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).find((l) => l.kind === "refusal");
      expect([refusal.code, refusal.reason]).toEqual(["CAP_STOP", expect.stringContaining("the ledger's reason: cap")]);
    } finally {
      srv.stop(true);
    }
  });
});

// The hook's own particle-1 path in Python: hm_judge.judge over dr_agent.deciders' one retry, unchanged. Only the SDK's HTTP
// call is a stand-in, the same request the pinned openai SDK makes with max_retries 0, raising on an error status as it does.
const D11_DRIVER = [
  "import json, os, sys, types, urllib.request, urllib.error",
  "sys.path[:0] = sys.argv[1:3]",
  "try:",
  "    import minisweagent.exceptions",
  "except ImportError:",
  "    m, e = types.ModuleType('minisweagent'), types.ModuleType('minisweagent.exceptions')",
  "    for n in ('InterruptAgentFlow', 'LimitsExceeded', 'Submitted'): setattr(e, n, type(n, (Exception,), {}))",
  "    m.exceptions = e",
  "    sys.modules.update({'minisweagent': m, 'minisweagent.exceptions': e})",
  "import hm_judge as H",
  "spec = json.load(sys.stdin)",
  "def post(system, user, schema):",
  "    body = {'model': H.PARTICLE_MODEL, 'messages': [{'role': 'system', 'content': system}, {'role': 'user', 'content': user}],",
  "            'response_format': {'type': 'json_schema', 'json_schema': {'name': 'answer', 'strict': True, 'schema': schema}},",
  "            'max_tokens': spec['max_tokens'], 'provider': H.PROVIDER}",
  "    req = urllib.request.Request(spec['base'] + '/chat/completions', data=json.dumps(body).encode(), method='POST',",
  "                                 headers={'content-type': 'application/json', 'authorization': 'Bearer ' + spec['token']})",
  "    try:",
  "        r = json.load(urllib.request.urlopen(req, timeout=600))",
  "    except urllib.error.HTTPError as e:",
  "        raise RuntimeError('Error code: %d - %s' % (e.code, e.read().decode(errors='replace')[:300])) from None",
  "    ch, u = r['choices'][0], r.get('usage') or {}",
  "    return {'content': ch['message']['content'], 'truncated': ch.get('finish_reason') == 'length', 'usage': {'input': u.get('prompt_tokens', 0), 'output': u.get('completion_tokens', 0)}}",
  "particle = H.PinnedParticle('openai', spec['base'], spec['token'], H.PARTICLE_MODEL, spec['max_tokens'], call=post)",
  "out = H.judge({'command': 'cat calc.py > b.py'}, H.RISKY_Q, 'p1', {'lo': 0.3, 'hi': 0.7}, None, particle)",
  "sys.stdout.write(json.dumps(out)); sys.stdout.flush(); os._exit(0)",
].join("\n");

describe("D11: particle-1 429s end to end, through the hook's 30 s limit, the decider's one retry and the judge proxy's provider pause", () => {
  // OpenRouter's 429s for particle-1 in stage3-pilot's smoke came from provider "Particle AI" with no Retry-After header.
  // The proxy backs off 1, 2, 4, 8 s between a call's attempts and, after the call's last 429, pauses the provider for the
  // next step; the decider then retries the call once, at once, and that retry waits out the pause. At vm-run.sh's
  // --retry-attempts 4 a judgment gets 8 attempts by about 22 s (0, 1, 3, 7, then 15, 16, 18, 22); at 5 the retry could
  // only start at 31 s, past the hook's 30 s, so its answer would be paid and never read.
  const ATTEMPTS = Number(/--retry-attempts (\d+)/.exec(readFileSync(join(import.meta.dir, "../../quick/laneb/runner/vm-run.sh"), "utf8"))?.[1]);
  async function judgment(n429: number) {
    const dir = tempDir("hm-judge-e2e-");
    const sent: { at: number; status: number }[] = [];
    const t0 = Date.now();
    const proxy = new MeteringProxy({
      ledger: new InMemoryLedger(), leaseId: "hm-judge-e2e.0001.abcdef", host: "127.0.0.1",
      managementSocket: join(dir, "m.sock"), managementToken: "management-token-0123456789",
      journal: join(dir, "judge-journal.ndjson"), retry: { attempts: ATTEMPTS, elapsed_ms: 300_000 },
      env: { OPENROUTER_API_KEY: "sk-or-hm-0123456789", TYPESAFE_API_KEY: "ts-hm-key-0123456789" }, maxOutputTokens: 32_000,
      fetch: async () => {
        const status = sent.length < n429 ? 429 : 200;
        sent.push({ at: Date.now() - t0, status });
        if (status === 429) return Response.json({ error: { code: 429, message: "Rate limit exceeded", metadata: { provider_name: "Particle AI" } } }, { status: 429 });
        return Response.json({ id: "gen-1", object: "chat.completion", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify({ answer: "no", confidence: 0.8 }) } }], usage: { prompt_tokens: 100, completion_tokens: 20 } });
      },
      allowanceCode: "DR_ALLOWANCE_STOP",
    });
    proxy.start();
    cleanup.push(() => proxy.stop());
    const b = proxy.bind({ cell: { run_id: "hm", arm: "judge-p1", task: "t1", model: "claude-opus-5-5", trial: 1, attempt: 1 }, models: JUDGE_DECIDERS, deciders: JUDGE_DECIDERS, allowance_micros: 2_000_000, forbidden_markers: [D11_CANARY], canary: D11_CANARY });
    const py = Bun.spawn(["python3", "-c", D11_DRIVER, join(import.meta.dir, "../../lanes/decision-routing/agent"), join(import.meta.dir, "../../lanes/harness-mechanics/judge")], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    py.stdin.write(JSON.stringify({ base: "http://127.0.0.1:" + proxy.port + "/" + b.slot + "/openrouter/v1", token: b.token, max_tokens: 100 }));
    py.stdin.end();
    const text = await new Response(py.stdout).text();
    await py.exited;
    const out = (() => { try { return JSON.parse(text); } catch { return { driver_error: text.slice(-500) }; } })();
    return { out, sent, t0 };
  }
  const late = (at: number[], want: number[]) => at.length === want.length && at.every((t, i) => t >= want[i]! * 1000 - 200 && t <= want[i]! * 1000 + 2500);

  test("runs of 4, 5 and 7 429s are answered inside 30 s; a run of 8 fails open on the proxy's 502 inside 30 s, and no answer is paid after the hook stops", async () => {
    const runs = await Promise.all([4, 5, 7, 8].map(judgment));
    // A retry the proxy holds past the hook's limit is sent when the pause ends (31 s at five attempts), so wait past that before counting what was paid.
    const settle = Math.max(...runs.map((r) => r.t0)) + 34_000 - Date.now();
    if (settle > 0) await Bun.sleep(settle);
    const [four, five, seven, eight] = runs.map((r) => ({ ...r.out, sends: r.sent.length, paid: r.sent.filter((s) => s.status === 200).length, at: r.sent.map((s) => s.at) }));
    // Each answered run spends the decider's retry: the first call ends in the proxy's 502 after four 429s.
    for (const [r, sends] of [[four, 5], [five, 6], [seven, 8]] as const) {
      expect([r.fail_open, r.error, r.answer, r.calls]).toEqual([false, null, "no", 2]);
      expect(r.latency_ms).toBeLessThan(30_000);
      expect([r.sends, r.paid]).toEqual([sends, 1]);
    }
    expect(eight.fail_open).toBe(true);
    expect(eight.error).toStartWith("particle-1: RuntimeError: Error code: 502 - ");
    expect(eight.error).toContain("UPSTREAM");
    expect(eight.calls).toBe(2);
    expect(eight.latency_ms).toBeLessThan(30_000);
    expect([eight.sends, eight.paid]).toEqual([8, 0]);
    expect(late(eight.at, [0, 1, 3, 7, 15, 16, 18, 22])).toBe(true);
  }, 90_000);

  function world(attempts: number, answers: Array<{ status: number; headers?: Record<string, string> }>) {
    const dir = tempDir("hm-judge-429-");
    const waits: number[] = [];
    let sent = 0;
    const proxy = new MeteringProxy({
      ledger: new InMemoryLedger(), leaseId: "hm-judge-429.0001.abcdef", host: "127.0.0.1",
      managementSocket: join(dir, "m.sock"), managementToken: "management-token-0123456789",
      journal: join(dir, "judge-journal.ndjson"), retry: { attempts, elapsed_ms: 300_000 },
      env: { OPENROUTER_API_KEY: "sk-or-hm-0123456789", TYPESAFE_API_KEY: "ts-hm-key-0123456789" },
      maxOutputTokens: 32_000, sleep: async (ms: number) => { waits.push(ms); },
      fetch: async () => {
        const a = answers[Math.min(sent++, answers.length - 1)]!;
        if (a.status === 200) return Response.json({ id: "x", choices: [], usage: { prompt_tokens: 100, completion_tokens: 20 } });
        return Response.json({ error: { code: a.status, message: "Rate limit exceeded", metadata: { provider_name: "Particle AI" } } }, { status: a.status, headers: a.headers });
      },
      allowanceCode: "DR_ALLOWANCE_STOP",
    });
    proxy.start();
    cleanup.push(() => proxy.stop());
    const b = proxy.bind({ cell: { run_id: "hm", arm: "judge-p1", task: "t1", model: "particle-ai/particle-1", trial: 1, attempt: 1 }, models: JUDGE_DECIDERS, deciders: JUDGE_DECIDERS, allowance_micros: 2_000_000, forbidden_markers: [D11_CANARY], canary: D11_CANARY });
    const ask = () => fetch("http://127.0.0.1:" + proxy.port + "/" + b.slot + "/openrouter/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + b.token }, body: JSON.stringify({ model: "particle-ai/particle-1", max_tokens: 100, messages: [{ role: "user", content: "was the change made?" }] }) });
    return { ask, waits, sent: () => sent };
  }
  const near = (waits: number[], want: number[]) => waits.length === want.length && waits.every((w, i) => w <= want[i]! && w > want[i]! - 500);
  const ok = { status: 200 };

  test("a Retry-After the provider sends still sets the wait", async () => {
    const w = world(ATTEMPTS, [{ status: 429, headers: { "retry-after-ms": "2500" } }, ok]);
    expect((await w.ask()).status).toBe(200);
    expect(near(w.waits, [2500])).toBe(true);
  });
});

describe("the launcher's judge constants stay in lockstep with the judge tar", () => {
  test("laneb_hooks.py JEV_MODEL equals judge.ts JEV_MODEL, and the judge deciders are the two backends' ids", () => {
    const hooks = readFileSync(join(import.meta.dir, "../../quick/laneb/runner/agent/laneb_hooks.py"), "utf8");
    expect(hooks).toContain('JEV_MODEL = "' + JEV_MODEL + '"');
    expect(hooks).toContain('JUDGE_DECIDERS = ["typesafe:' + JEV_MODEL + '", "openrouter:particle-ai/particle-1"]');
    expect(hooks).toContain('JUDGE_CONFIG = "/root/.hm/judge/judge-{backend}.json"');
  });
});

describe("post-run judge check (pieces 3 and 4)", () => {
  const session = (over: Partial<HookSession>): HookSession => ({ arm: "judge-jev", model: "claude-opus-5-5", task: "t1", trial: "1", log: null, journal: "", meter_id: "m1", ...over });
  const line = (over: object) => JSON.stringify({ point: "done", rule: null, backend: "jev", jev_version: "jev-1.13.0", stopped: false, ...over });

  test("a clean journal and clean hook logs pass; marker hits are counted", () => {
    const d = mkdtempSync(join(tmpdir(), "hm-jc-"));
    try {
      const journal = join(d, "judge-journal.ndjson");
      writeFileSync(journal, [JSON.stringify({ kind: "request", code: null }), JSON.stringify({ kind: "marker_hit" })].join("\n") + "\n");
      const c = judgeRunCheck(journal, [session({ log: line({}) + "\n" + line({ rule: "status_not_done", backend: null }) })]);
      expect([c.pass, c.custody_hits, c.marker_hits, c.jev_changes.length]).toEqual([true, 0, 1, 0]);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  test("a DR_CUSTODY_HIT refusal in the journal fails the check", () => {
    const d = mkdtempSync(join(tmpdir(), "hm-jc-"));
    try {
      const journal = join(d, "judge-journal.ndjson");
      writeFileSync(journal, JSON.stringify({ kind: "refusal", code: "DR_CUSTODY_HIT" }) + "\n");
      const c = judgeRunCheck(journal, [session({ log: line({}) })]);
      expect([c.pass, c.custody_hits]).toEqual([false, 1]);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  test("a jevChanges line (stopped, or a Jev version off the pin) fails the check and is reported", () => {
    const d = mkdtempSync(join(tmpdir(), "hm-jc-"));
    try {
      const journal = join(d, "judge-journal.ndjson");
      writeFileSync(journal, JSON.stringify({ kind: "request" }) + "\n");
      const stopped = judgeRunCheck(journal, [session({ trial: "1", log: line({ stopped: true, jev_version: null }) })]);
      expect([stopped.pass, stopped.jev_changes.length]).toEqual([false, 1]);
      const drifted = judgeRunCheck(journal, [session({ trial: "2", log: line({ jev_version: "jev-9.9.9" }) })]);
      expect([drifted.pass, drifted.jev_changes[0]?.trial]).toEqual([false, "2"]);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  test("readJudgeSessions reads only judge trials and their copied-out hook logs", () => {
    const d = mkdtempSync(join(tmpdir(), "hm-js-"));
    try {
      const jobs = join(d, "jobs");
      const trial = (name: string, arm: string, log: string | null) => {
        const t = join(jobs, name);
        mkdirSync(join(t, "evaluator"), { recursive: true });
        writeFileSync(join(t, "config.json"), JSON.stringify({ agent: { name: "laneb-claude-code", kwargs: { arm, upstream_model: "claude-opus-5-5" } }, task: { path: "/vm/run/tasks/" + name } }));
        if (log !== null) writeFileSync(join(t, "evaluator", "judge-hooks.jsonl"), log);
      };
      trial("t1__a", "judge-jev", line({}));
      trial("t2__b", "none", null);
      const sessions = readJudgeSessions([jobs], join(d, "judge-journal.ndjson"));
      expect(sessions.map((s) => s.arm)).toEqual(["judge-jev"]);
      expect(sessions[0]!.log).toContain("jev-1.13.0");
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});

describe("the host-side custody producer (hm judge-custody)", () => {
  test("builds per-task markers from each task's pristine listing, owner-only, with a distinct canary per task", async () => {
    const d = tempDir("hm-cust-");
    const tasksDir = join(d, "src");
    mkdirSync(tasksDir, { recursive: true });
    makeTaskSource(tasksDir, "task-a");
    makeTaskSource(tasksDir, "task-b");
    const run = makeJudgeRun(d, ["task-a", "task-b"]);
    const built = await buildRunMarkers(run, { tasksDir, labelStore: join(d, "judge-labels"), docker: FAKE_LISTING as never });
    expect([...built].sort()).toEqual(["task-a", "task-b"]);
    const a = JSON.parse(readFileSync(join(run, "judge-markers", "task-a.json"), "utf8")) as string[];
    const b = JSON.parse(readFileSync(join(run, "judge-markers", "task-b.json"), "utf8")) as string[];
    expect(a.slice(1)).toEqual(["test_hidden_regression_case", "tests/test_regression.py"]);
    expect(/^DRCANARY-[0-9a-f]{32}$/.test(a[0]!)).toBe(true);
    expect(a[0]).not.toBe(b[0]); // a distinct canary per task
    // The label store sits beside the run dir and is never synced; the canary reaches the host and the part VM only inside
    // the markers file, which no task container mounts.
    expect(readFileSync(join(d, "judge-labels", "task-a", "canary.txt"), "utf8").trim()).toBe(a[0]);
    expect(statSync(join(run, "judge-markers", "task-a.json")).mode & 0o777).toBe(0o600);
  });

  test("a task whose pristine image will not list stops with DR_LABEL_MISSING and writes no markers", async () => {
    const d = tempDir("hm-cust-");
    const tasksDir = join(d, "src");
    mkdirSync(tasksDir, { recursive: true });
    makeTaskSource(tasksDir, "task-a");
    const run = makeJudgeRun(d, ["task-a"]);
    await expect(buildRunMarkers(run, { tasksDir, labelStore: join(d, "judge-labels"), docker: FAILING_DOCKER as never })).rejects.toThrow(/^DR_LABEL_MISSING/);
    expect(existsSync(join(run, "judge-markers"))).toBe(false);
  });

  test("a non-judge run dir is a no-op: nothing listed, no markers folder", async () => {
    const d = tempDir("hm-cust-");
    const run = makeJudgeRun(d, ["task-a"], false);
    let listed = false;
    const spy = { run: async () => ((listed = true), { code: 0, stdout: "", stderr: "" }) };
    expect(await buildRunMarkers(run, { tasksDir: join(d, "src"), labelStore: join(d, "judge-labels"), docker: spy as never })).toEqual([]);
    expect(listed).toBe(false);
    expect(existsSync(join(run, "judge-markers"))).toBe(false);
    expect(judgePartTasks(run)).toEqual([]);
  });
});

describe("judge custody through the metering proxy (pieces 1, 2 and 3)", () => {
  async function producedMarkers(): Promise<string[]> {
    const d = tempDir("hm-markers-");
    const tasksDir = join(d, "src");
    mkdirSync(tasksDir, { recursive: true });
    makeTaskSource(tasksDir, "t1");
    const run = makeJudgeRun(d, ["t1"]);
    await buildRunMarkers(run, { tasksDir, labelStore: join(d, "judge-labels"), docker: FAKE_LISTING as never });
    return JSON.parse(readFileSync(join(run, "judge-markers", "t1.json"), "utf8"));
  }
  function judgeProxyWorld() {
    const dir = tempDir("hm-judge-proxy-");
    const sent: string[] = [];
    const proxy = new MeteringProxy({
      ledger: new InMemoryLedger(), leaseId: "hm-judge-rp.0001.abcdef", host: "127.0.0.1",
      managementSocket: join(dir, "m.sock"), managementToken: "management-token-0123456789",
      journal: join(dir, "judge-journal.ndjson"), retry: { attempts: 3, elapsed_ms: 60_000 },
      env: { OPENROUTER_API_KEY: "sk-or-hm-0123456789", TYPESAFE_API_KEY: "ts-hm-key-0123456789" },
      maxOutputTokens: 32_000, sleep: async () => {},
      fetch: async (_url, init) => { sent.push(String(init.body ?? "")); return Response.json({ id: "x", choices: [], usage: { prompt_tokens: 100, completion_tokens: 20 } }); },
      allowanceCode: "DR_ALLOWANCE_STOP",
    });
    proxy.start();
    cleanup.push(() => proxy.stop());
    const bind = (markers: string[]) => proxy.bind({ cell: { run_id: "hm", arm: "judge-p1", task: "t1", model: "particle-ai/particle-1", trial: 1, attempt: 1 }, models: JUDGE_DECIDERS, deciders: JUDGE_DECIDERS, allowance_micros: 2_000_000, forbidden_markers: markers, canary: markers[0] });
    const ask = (b: { slot: string; token: string }, content: string) =>
      fetch(`http://127.0.0.1:${proxy.port}/${b.slot}/openrouter/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${b.token}` }, body: JSON.stringify({ model: "particle-ai/particle-1", max_tokens: 100, messages: [{ role: "user", content }] }) });
    return { proxy, sent, bind, ask, journalPath: join(dir, "judge-journal.ndjson") };
  }
  const cleanSession = (journalPath: string): HookSession => ({ arm: "judge-p1", model: "particle-ai/particle-1", task: "t1", trial: "1", log: JSON.stringify({ point: "done", backend: "p1", jev_version: null, stopped: false }) + "\n", journal: journalPath, meter_id: "m1" });

  test("a judge decider request carrying the task's canary is refused DR_CUSTODY_HIT and fails the post-run check", async () => {
    const w = judgeProxyWorld();
    const markers = await producedMarkers();
    const b = w.bind(markers);
    const res = await w.ask(b, "the runner's label store holds " + markers[0]);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe("DR_CUSTODY_HIT");
    expect(w.sent).toHaveLength(0); // the canary is never forwarded upstream
    const c = judgeRunCheck(w.journalPath, [cleanSession(w.journalPath)]);
    expect([c.pass, c.custody_hits]).toEqual([false, 1]);
    expect(readFileSync(w.journalPath, "utf8")).not.toContain(markers[0]); // the canary is never written to the journal
  });

  test("a clean judge decider request is forwarded and the post-run check passes with no custody or marker hit", async () => {
    const w = judgeProxyWorld();
    const markers = await producedMarkers();
    const b = w.bind(markers);
    const res = await w.ask(b, "the agent ran the suite and three cases passed");
    expect(res.status).toBe(200);
    expect(w.sent).toHaveLength(1);
    const c = judgeRunCheck(w.journalPath, [cleanSession(w.journalPath)]);
    expect([c.pass, c.custody_hits, c.marker_hits]).toEqual([true, 0, 0]);
  });
});

describe("a judge-bearing host ships the judge proxy keys, a non-judge host does not (Amendment E)", () => {
  // Real plans from the frozen splits: stage3-pilot and stage4 carry judge arms, stage1 does not. proxyKeys reads the plan's
  // arms, so it ships the judge keys exactly for the items whose part VMs run a judge metering proxy.
  const scored = Array.from({ length: 5 }, (_, i) => "scored-" + i);
  const calibration = Array.from({ length: 40 }, (_, i) => "calib-" + i);
  const planFor = (name: string): Plan => ({ parts: itemPlan(name, { scored, calibration }).parts } as unknown as Plan);
  const keys = (name: string) => HM_PROFILE.proxyKeys!(planFor(name));

  test("a judge item's plan carries a judge arm and ships TYPESAFE and OPENROUTER for the judge proxy", () => {
    for (const name of ["stage3-pilot", "stage3-pilot-2", "stage3-pilot-3", "stage3-pilot-4", "stage4-opus", "stage4-sol", "stage4-p1"]) {
      const hasJudge = planFor(name).parts.some((p) => p.rects.some((r) => r.arms.some((a) => (JUDGE as string[]).includes(a))));
      expect([name, hasJudge]).toEqual([name, true]);
      expect([name, keys(name)]).toEqual([name, ["TYPESAFE_API_KEY", "OPENROUTER_API_KEY"]]);
    }
  });

  test("a non-judge item's plan carries no judge arm and ships no proxy key", () => {
    for (const name of ["stage1-opus", "stage1-sol", "stage1-p1"]) {
      const hasJudge = planFor(name).parts.some((p) => p.rects.some((r) => r.arms.some((a) => (JUDGE as string[]).includes(a))));
      expect([name, hasJudge]).toEqual([name, false]);
      expect([name, keys(name)]).toEqual([name, []]);
    }
  });

  test("hostSecretKeys ships the route key plus any judge keys plus UBICLOUD, deduped, both directions", () => {
    // A non-judge host: exactly the item model's route key and UBICLOUD (the frozen Amendment E list).
    expect(hostSecretKeys("OPENROUTER_API_KEY", [])).toEqual(["OPENROUTER_API_KEY", "UBICLOUD_API_KEY"]);
    expect(hostSecretKeys("ANTHROPIC_API_KEY", [])).toEqual(["ANTHROPIC_API_KEY", "UBICLOUD_API_KEY"]);
    // A judge Opus host (stage3-pilot): its route key, then the judge keys, then UBICLOUD.
    expect(hostSecretKeys("ANTHROPIC_API_KEY", ["TYPESAFE_API_KEY", "OPENROUTER_API_KEY"])).toEqual(["ANTHROPIC_API_KEY", "TYPESAFE_API_KEY", "OPENROUTER_API_KEY", "UBICLOUD_API_KEY"]);
    // A judge particle-1 host (stage4-p1): OPENROUTER is both the route key and a judge key, so it appears once.
    expect(hostSecretKeys("OPENROUTER_API_KEY", ["TYPESAFE_API_KEY", "OPENROUTER_API_KEY"])).toEqual(["OPENROUTER_API_KEY", "TYPESAFE_API_KEY", "UBICLOUD_API_KEY"]);
  });
});

const CLI = join(REPO, "lanes/harness-mechanics/cli.ts");
const hm = (args: string[]) => {
  const p = Bun.spawnSync([process.execPath, CLI, ...args], { env: { ...process.env }, cwd: REPO });
  return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() };
};

describe("judge custody on every prepare path (B and C1)", () => {
  const isJudge = (r: Rect) => r.arms.some((a) => a.startsWith("judge"));
  // A prepared part dir as the launcher leaves it: prepare-run writes the unsplit job.json and builds the judge custody
  // (prepareJudgeCustody), then l1.ts preparePart splits the job into job.json and job-<n>.json and writes l1-part.json.
  async function preparedPart(work: string, tasksDir: string, name: string, rects: Rect[], custody = true) {
    const run = join(work, name);
    mkdirSync(run, { recursive: true });
    const tasks = [...new Set(rects.flatMap((r) => r.tasks))], arms = [...new Set(rects.flatMap((r) => r.arms))] as (keyof typeof ARMS)[];
    writeFileSync(join(run, "job.json"), JSON.stringify(jobConfig({ ...JOB_BASE, job_name: name, tasks, arms: arms.map(jobArm) })));
    if (custody) await prepareJudgeCustody(run, tasksDir, FAKE_LISTING as never);
    splitJobs(JSON.parse(readFileSync(join(run, "job.json"), "utf8")), rects).forEach((j, i) => writeFileSync(join(run, jobFile(i)), JSON.stringify(j)));
    writeFileSync(join(run, "l1-part.json"), JSON.stringify({ name, prefix: "stage3-pilot/" + name + "/", rects }));
    return run;
  }

  test("judgePartTasks reads every job file splitJobs writes, each task by its {path} basename, wherever the judge rectangle lands", () => {
    const rects = relaunchRects([
      { task: "owner__alpha-1", arm: "none", replicates: 1 }, { task: "owner__alpha-1", arm: "plain-2", replicates: 1 },
      { task: "owner__beta-2", arm: "judge-jev", replicates: 1 }, { task: "owner__gamma-3", arm: "judge-p1", replicates: 1 }, { task: "owner__gamma-3", arm: "judge-jev", replicates: 1 },
    ]);
    expect(rects.length).toBe(3);
    const plainFirst = [...rects.filter((r) => !isJudge(r)), ...rects.filter(isJudge)];
    for (const order of [plainFirst, [...plainFirst].reverse()]) {
      const d = tempDir("hm-split-");
      const tasks = [...new Set(order.flatMap((r) => r.tasks))], arms = [...new Set(order.flatMap((r) => r.arms))] as (keyof typeof ARMS)[];
      splitJobs(jobConfig({ ...JOB_BASE, job_name: "s4-1-relaunch", tasks, arms: arms.map(jobArm) }), order).forEach((j, i) => writeFileSync(join(d, jobFile(i)), JSON.stringify(j)));
      expect(judgePartTasks(d).sort()).toEqual(["owner__beta-2", "owner__gamma-3"]);
    }
    // With the plain rectangle first, job.json holds no judge agent, so a reader of job.json alone built no custody.
    const d = tempDir("hm-split-");
    splitJobs(jobConfig({ ...JOB_BASE, job_name: "x", tasks: ["owner__alpha-1", "owner__beta-2", "owner__gamma-3"], arms: (["none", "plain-2", "judge-jev", "judge-p1"] as const).map(jobArm) }), plainFirst).forEach((j, i) => writeFileSync(join(d, jobFile(i)), JSON.stringify(j)));
    expect(JSON.parse(readFileSync(join(d, "job.json"), "utf8")).agents.some((a: any) => a.kwargs.judge_backend)).toBe(false);
  });

  test("a judge job's task with no path fails closed, so custody is never built for a guessed name", () => {
    const d = tempDir("hm-nopath-");
    const job = jobConfig({ ...JOB_BASE, tasks: ["t1"], arms: [jobArm("judge-jev")] });
    writeFileSync(join(d, "job.json"), JSON.stringify({ ...job, tasks: [{ git_url: "x" }] }));
    expect(() => judgePartTasks(d)).toThrow(/^E_HM_INPUT judge-custody: .*has a judge task with no path/);
  });

  test("a part, its <part>-relaunch and its <part>-a2 each bind with their task's custody, from one label store; hm judge-custody checks it without Docker", async () => {
    const d = tempDir("hm-paths-"), tasksDir = join(d, "src"), work = join(d, "work");
    mkdirSync(tasksDir, { recursive: true });
    for (const t of ["owner__alpha-1", "owner__beta-2"]) makeTaskSource(tasksDir, t);
    await preparedPart(work, tasksDir, "pilot-opus", [{ tasks: ["owner__alpha-1", "owner__beta-2"], arms: JUDGE, attempts: 1 }]);
    await preparedPart(work, tasksDir, "pilot-opus-relaunch", relaunchRects([{ task: "owner__alpha-1", arm: "judge-p1", replicates: 1 }]));
    await preparedPart(work, tasksDir, "pilot-opus-a2", relaunchRects([{ task: "owner__beta-2", arm: "judge-jev", replicates: 1 }, { task: "owner__beta-2", arm: "judge-p1", replicates: 1 }]));
    const canary = (t: string) => readFileSync(join(work, "judge-labels", t, "canary.txt"), "utf8").trim();
    for (const part of ["pilot-opus", "pilot-opus-relaunch", "pilot-opus-a2"]) {
      // Each judge trial's task, as the agent reads it (config.json's task.path), finds its markers file under markers_dir.
      for (const t of judgePartTasks(join(work, part))) {
        const markers = JSON.parse(readFileSync(join(work, part, "judge-markers", t + ".json"), "utf8")) as string[];
        expect([part, t, markers[0]]).toEqual([part, t, canary(t)]);
      }
    }
    expect(canary("owner__alpha-1")).not.toBe(canary("owner__beta-2"));
    expect(checkJudgeCustody(work)).toEqual({ pass: true, parts: ["pilot-opus", "pilot-opus-a2", "pilot-opus-relaunch"], tasks: 4, problems: [] });
    const ok = hm(["judge-custody", work]);
    expect([ok.code, ok.out]).toEqual([0, expect.stringContaining("judge-custody pass: 4 judge task(s) across 3 prepared judge part(s)")]);
  });

  test("hm judge-custody fails a relaunch prepared with no custody, and a markers file whose canary is not the label store's", async () => {
    const d = tempDir("hm-paths-"), tasksDir = join(d, "src"), work = join(d, "work");
    mkdirSync(tasksDir, { recursive: true });
    makeTaskSource(tasksDir, "owner__alpha-1");
    await preparedPart(work, tasksDir, "pilot-opus", [{ tasks: ["owner__alpha-1"], arms: JUDGE, attempts: 1 }]);
    await preparedPart(work, tasksDir, "pilot-opus-relaunch", [{ tasks: ["owner__alpha-1"], arms: ["judge-p1"], attempts: 1 }], false);
    const missing = checkJudgeCustody(work);
    expect([missing.pass, missing.problems]).toEqual([false, [expect.stringMatching(/^pilot-opus-relaunch\/owner__alpha-1: no markers file /)]]);
    const bad = hm(["judge-custody", work]);
    expect([bad.code, bad.out, bad.err]).toEqual([2, expect.stringContaining("judge-custody FAIL"), expect.stringMatching(/^E_HM_INPUT judge-custody/)]);
    rmSync(join(work, "pilot-opus-relaunch"), { recursive: true });
    writeFileSync(join(work, "judge-labels", "owner__alpha-1", "canary.txt"), "DRCANARY-" + "0".repeat(32) + "\n");
    expect(checkJudgeCustody(work).problems).toEqual(["pilot-opus/owner__alpha-1: the markers file's canary is not the label store's"]);
  });
});

describe("judge-check per part: fail closed, judge spend and the smoke part (D1, E1, S1)", () => {
  const hookLine = JSON.stringify({ point: "done", rule: null, backend: "jev", jev_version: "jev-1.13.0", stopped: false });
  const rid = (part: string, n: number) => "judge:stage3-pilot/" + part + "/m1:" + n + ":1";
  // A spent call ($0.12 of a $0.30 reserve), an unknown one ($0.25 reserved) and a request with no outcome ($0.20 reserved).
  const spendJournal = (part: string) => [
    { kind: "request", reservation_id: rid(part, 0), max_micros: 300_000 }, { kind: "outcome", reservation_id: rid(part, 0), meter_id: "m1", outcome: { kind: "spent", spent_micros: 120_000, usage } },
    { kind: "request", reservation_id: rid(part, 1), max_micros: 250_000 }, { kind: "outcome", reservation_id: rid(part, 1), meter_id: "m1", outcome: { kind: "unknown" } },
    { kind: "request", reservation_id: rid(part, 2), max_micros: 200_000 },
  ].map((l) => JSON.stringify(l)).join("\n") + "\n";
  function part(work: string, name: string, o: { launched?: boolean; jobs?: boolean; log?: string | null; journal?: string } = {}) {
    const dir = join(work, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "l1-part.json"), JSON.stringify({ name, rects: [{ tasks: ["t1"], arms: JUDGE, attempts: 1 }] }));
    if (o.launched === false) return;
    writeFileSync(join(work, name + ".launch.json"), JSON.stringify({ part: name }));
    if (o.jobs === false) return;
    const trial = join(dir, "pulled/jobs", name, "t1__Ab3dE9x");
    mkdirSync(join(trial, "evaluator"), { recursive: true });
    writeFileSync(join(trial, "config.json"), JSON.stringify({ agent: { name: "laneb-claude-code", kwargs: { arm: "judge-jev", upstream_model: "claude-opus-5-5" } }, task: { path: "/vm/run/tasks/t1" } }));
    if (o.log !== null) writeFileSync(join(trial, "evaluator/judge-hooks.jsonl"), (o.log ?? hookLine) + "\n");
    mkdirSync(join(dir, "pulled/out"), { recursive: true });
    writeFileSync(join(dir, "pulled/out/judge-journal.ndjson"), o.journal ?? spendJournal(name));
  }
  function workDir() {
    const work = tempDir("hm-jcw-");
    writeFileSync(join(work, "plan.json"), JSON.stringify({ item: "stage3-pilot", parts: [{ name: SMOKE_PART }, { name: "pilot-opus" }, { name: "pilot-sol" }] }));
    return work;
  }

  test("journalSpend: spent outcomes are measured; unknown outcomes and unanswered requests count at their reserved maximum", () => {
    const d = tempDir("hm-spend-");
    writeFileSync(join(d, "j.ndjson"), spendJournal("pilot-opus") + "a torn line\n");
    expect(journalSpend(join(d, "j.ndjson"))).toEqual({ measured_usd: 0.12, unknown_count: 2, unknown_usd: 0.45 });
  });

  test("judgeRunCheck fails closed with its reason: no judge session, or a judge session with a missing or unreadable hook log", () => {
    const d = tempDir("hm-jcf-"), journal = join(d, "j.ndjson");
    writeFileSync(journal, "");
    const s = (log: string | null): HookSession => ({ arm: "judge-jev", model: "claude-opus-5-5", task: "t1", trial: "1", log, journal, meter_id: "m1" });
    const none = judgeRunCheck(journal, []);
    expect([none.pass, none.detail]).toEqual([false, expect.stringContaining("no judge session")]);
    for (const log of [null, "not json\n"]) {
      const c = judgeRunCheck(journal, [s(log)]);
      expect([c.pass, c.missing_logs, c.detail]).toEqual([false, 1, expect.stringContaining("1 judge session(s) with no readable hook log")]);
    }
    expect(judgeRunCheck(journal, [s(hookLine + "\n")]).pass).toBe(true);
  });

  test("judgeRunCheck: a judge session's hook log with lines passes, and an empty one fails like a missing one", () => {
    const d = tempDir("hm-jce-"), journal = join(d, "j.ndjson");
    writeFileSync(journal, "");
    const s = (log: string | null): HookSession => ({ arm: "judge-p1", model: "claude-opus-5-5", task: "t1", trial: "1", log, journal, meter_id: "m1" });
    for (const log of ["", "\n", " \n\n"]) {
      const c = judgeRunCheck(journal, [s(log)]);
      expect([c.pass, c.missing_logs, c.detail]).toEqual([false, 1, expect.stringContaining("1 judge session(s) with no readable hook log")]);
    }
    expect(judgeRunCheck(journal, [s(null)]).pass).toBe(false);
    const lines = judgeRunCheck(journal, [s(hookLine + "\n")]);
    expect([lines.pass, lines.missing_logs]).toEqual([true, 0]);
  });

  test("per part: the smoke part is checked and named apart from section 11's inputs, an unlaunched part is listed, and each part reports its judge spend", () => {
    const work = workDir();
    part(work, SMOKE_PART);
    part(work, "pilot-opus");
    part(work, "pilot-sol", { launched: false });
    const r = judgePartsCheck(work);
    expect([r.pass, r.unlaunched, r.parts.map((p) => [p.part, p.section11, p.sessions, p.measured_usd, p.unknown_count, p.unknown_usd])]).toEqual([true, ["pilot-sol"], [[SMOKE_PART, false, 1, 0.12, 2, 0.45], ["pilot-opus", true, 1, 0.12, 2, 0.45]]]);
    const cli = hm(["judge-check", work]);
    expect(cli.code).toBe(0);
    expect(cli.out).toContain("JUDGE CHECK pilot-opus pass: custody_hits 0 (must be 0), marker_hits 0, jevChanges in 0 of 1 judge session(s); judge spend measured $0.12, unknown 2 ($0.45 at their reserved maximum); ");
    expect(cli.out).toContain("JUDGE CHECK " + SMOKE_PART + " pass: ");
    expect(cli.out).toContain(SMOKE_PART + " is the smoke part, never a section 11 input");
    expect(cli.out).toContain("JUDGE CHECK not launched: pilot-sol\n");
    expect(cli.out).toContain("JUDGE CHECK section 11 inputs: pilot-opus (left out: " + SMOKE_PART + ")\n");
  });

  test("per part it fails closed: a custody hit in the smoke part, a launched part with no pulled jobs dir, a missing hook log, or no launched judge part", () => {
    const hit = workDir();
    part(hit, SMOKE_PART, { journal: JSON.stringify({ kind: "refusal", code: "DR_CUSTODY_HIT", meter_id: "m1" }) + "\n" });
    part(hit, "pilot-opus");
    expect([judgePartsCheck(hit).pass, judgePartsCheck(hit).detail]).toEqual([false, SMOKE_PART + " failed"]);
    const nojobs = workDir();
    part(nojobs, SMOKE_PART, { jobs: false });
    const r = judgePartsCheck(nojobs);
    expect([r.pass, r.parts[0]!.detail]).toEqual([false, expect.stringMatching(/^no pulled jobs dir at /)]);
    const nolog = workDir();
    part(nolog, SMOKE_PART, { log: null });
    expect(judgePartsCheck(nolog).pass).toBe(false);
    const idle = workDir();
    part(idle, SMOKE_PART, { launched: false });
    expect(judgePartsCheck(idle)).toMatchObject({ pass: false, detail: "no launched judge part to check", unlaunched: [SMOKE_PART] });
    const cli = hm(["judge-check", idle]);
    expect([cli.code, cli.out]).toEqual([2, expect.stringContaining("JUDGE CHECK: FAIL (no launched judge part to check)")]);
  });

  test("hm table leaves the smoke part's rows out and says so; hm report refuses a table that holds one", () => {
    const work = workDir();
    part(work, SMOKE_PART);
    part(work, "pilot-opus");
    const cfg = join(work, "table.json"), out = join(work, "table.jsonl");
    writeFileSync(cfg, JSON.stringify({ jobs: [{ dir: join(work, SMOKE_PART, "pulled/jobs", SMOKE_PART), part: SMOKE_PART }, { dir: join(work, "pilot-opus/pulled/jobs/pilot-opus"), part: "pilot-opus" }], sessions: [] }));
    const t = hm(["table", cfg, out]);
    expect([t.code, t.out.trim()]).toEqual([0, "wrote 1 rows to " + out + "; left out 1 row(s) from the smoke part " + SMOKE_PART + ", which are not pilot cells and never a section 11 input"]);
    const rows = readFileSync(out, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(rows.map((x) => x.part)).toEqual(["pilot-opus"]);
    for (const p of [SMOKE_PART, SMOKE_PART + "-relaunch", SMOKE_PART + "-a2"]) expect(() => report([{ ...rows[0], part: p } as HmRowIn], {} as ReportConfig)).toThrow("E_USAGE hm report: the table holds 1 row(s) from the smoke part " + SMOKE_PART);
    expect(() => report(rows as HmRowIn[], {} as ReportConfig)).toThrow("the config needs stage1");
  });
});

