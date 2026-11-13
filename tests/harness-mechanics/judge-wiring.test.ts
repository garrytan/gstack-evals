// Copyright (c) 2026 Garry Tan. MIT License.
// The harness mechanics live judge wiring (lanes/harness-mechanics/README.md "Not built"): the arm-to-backend mapping
// carried into the launcher (piece 5), the byte-identical golden for L1 and the non-judge arms, the judge proxy's HTTP
// ReservationLedger (its cap stop), and the post-run judge check (journalCheck plus jevChanges, pieces 3 and 4). Keyless.
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ARMS, FOUR, JUDGE } from "../../lanes/harness-mechanics/pins.ts";
import { armSpec, jobConfig } from "../../quick/laneb/runner/grid.ts";
import { ARM_SPECS as L1_ARMS } from "../../quick/laneb/l1/l1.ts";
import { HttpReservations } from "../../lanes/harness-mechanics/judge/judge-proxy.ts";
import { judgeRunCheck, readJudgeSessions } from "../../lanes/harness-mechanics/judge-check.ts";
import { JEV_MODEL, type HookSession } from "../../lanes/harness-mechanics/judge.ts";

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
});

describe("byte-identical golden (piece 'additive, gated on backend')", () => {
  test("every L1 arm's job.json has no judge_backend and no HM_JUDGE_*", () => {
    const text = JSON.stringify(jobConfig({ ...JOB_BASE, arms: Object.values(L1_ARMS).map((e) => ({ ...armSpec(e as string), tar: "/vm/run/arms/x.tar", sha256: "a" })) }));
    expect(text).not.toContain("judge_backend");
    expect(text).not.toContain("HM_JUDGE");
  });

  test("the four non-judge HM arms (none, plain-2, verify-prose, verify-hook) carry no judge_backend", () => {
    const text = JSON.stringify(jobConfig({ ...JOB_BASE, arms: FOUR.map((name) => ({ ...armSpec(ARMS[name].spec), tar: "/vm/run/arms/x.tar", sha256: "a" })) }));
    expect(text).not.toContain("judge_backend");
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
