// Copyright (c) 2026 Garry Tan. MIT License.
// The harness mechanics live judge wiring (lanes/harness-mechanics/README.md "Not built"): the arm-to-backend mapping
// carried into the launcher (piece 5), the byte-identical golden for L1 and the non-judge arms, the judge proxy's HTTP
// ReservationLedger (its cap stop), and the post-run judge check (journalCheck plus jevChanges, pieces 3 and 4). Keyless.
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ARMS, FOUR, JUDGE } from "../../lanes/harness-mechanics/pins.ts";
import { armSpec, jobConfig } from "../../quick/laneb/runner/grid.ts";
import { ARM_SPECS as L1_ARMS } from "../../quick/laneb/l1/l1.ts";
import { HttpReservations } from "../../lanes/harness-mechanics/judge/judge-proxy.ts";
import { judgeRunCheck, readJudgeSessions } from "../../lanes/harness-mechanics/judge-check.ts";
import { JEV_MODEL, type HookSession } from "../../lanes/harness-mechanics/judge.ts";
import { buildRunMarkers, judgePartTasks } from "../../lanes/harness-mechanics/judge-custody.ts";
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
function makeJudgeRun(dir: string, tasks: string[], judge = true) {
  const run = join(dir, "run");
  mkdirSync(run, { recursive: true });
  const kwargs = judge ? { arm: "judge-jev", judge_backend: "jev" } : { arm: "none" };
  writeFileSync(join(run, "job.json"), JSON.stringify({ agents: [{ name: "laneb-claude-code", kwargs }], tasks }));
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
  test("a within-cap reserve is granted and settled; a reserve beyond the item cap is refused CAP_STOP; unknown keeps open; reserves are idempotent", async () => {
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
      const ledger = new HttpReservations("http://127.0.0.1:" + srv.port, "judge");
      const cell = { run_id: "r", arm: "judge-jev", task: "t", model: "m", trial: 1, attempt: 1, meter_id: "m1" };
      const within = await ledger.reserve({ idempotency_key: "k1", lease_id: "L", cell, max_micros: 600_000 });
      expect(within.ok).toBe(true);
      expect(within.ok && within.reservation.reservation_id).toBe("judge:k1");
      const repeat = await ledger.reserve({ idempotency_key: "k1", lease_id: "L", cell, max_micros: 600_000 });
      expect(repeat.ok && repeat.reservation.reservation_id).toBe("judge:k1");
      expect(reqs.filter((r) => r.path === "/reserve").length).toBe(1); // idempotent: no second /reserve
      const beyond = await ledger.reserve({ idempotency_key: "k2", lease_id: "L", cell, max_micros: 600_000 });
      expect(beyond.ok).toBe(false);
      expect(!beyond.ok && beyond.code).toBe("CAP_STOP");
      const settled = await ledger.settle("judge:k1", { kind: "spent", spent_micros: 100_000, usage });
      expect(settled.ok).toBe(true);
      const settles = reqs.filter((r) => r.path === "/settle").length;
      const unknown = await ledger.settle("judge:k1", { kind: "unknown" });
      expect(unknown.ok).toBe(true);
      expect(reqs.filter((r) => r.path === "/settle").length).toBe(settles); // unknown posts nothing, stays open
      expect(reqs.find((r) => r.path === "/reserve")!.body).toMatchObject({ id: "judge:k1", usd_micros: 600_000 });
      expect(reqs.find((r) => r.path === "/settle")!.body).toMatchObject({ id: "judge:k1", usd_micros: 100_000 });
    } finally {
      srv.stop(true);
    }
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
    // The reusable canary store sits beside the run dir (launch.sh syncs only the run dir), so no canary reaches the VM.
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
