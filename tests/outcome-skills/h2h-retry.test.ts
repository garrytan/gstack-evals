// Copyright (c) 2026 Garry Tan. MIT License.
// The head-to-head session's full-allowance retry under the cap above it and the home pin check before any slot opens (sessions/run.ts,
// session.ts, home.ts, rerunner.ts). Harbor is a stub script that writes each attempt's summary; no Docker, no key.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { homeTreeSha256 } from "../../lanes/outcome-skills/h2h/arms/hash.ts";
import { EXIT, refusal } from "../../lanes/outcome-skills/h2h/cli.ts";
import { readPrereg } from "../../lanes/outcome-skills/h2h/prereg.ts";
import { rerun, type RerunRunner } from "../../lanes/outcome-skills/h2h/rerun.ts";
import { commands } from "../../lanes/outcome-skills/h2h/sessions/commands.ts";
import type { H2hPlanned } from "../../lanes/outcome-skills/h2h/sessions/plan.ts";
import { refusedOutcome, sessionRunner } from "../../lanes/outcome-skills/h2h/sessions/rerunner.ts";
import { runH2hSession, type H2hRunInput } from "../../lanes/outcome-skills/h2h/sessions/run.ts";
import { attemptUsage, retryCovered, sessionRecord, type H2hSessionRecord } from "../../lanes/outcome-skills/h2h/sessions/session.ts";
import type { H2hUnit } from "../../lanes/outcome-skills/h2h/types.ts";

const P = readPrereg();
const W = mkdtempSync(join(tmpdir(), "h2h-retry-"));
const close = (usd: number, end: "error_result" | "completed") => ({ finalized: true, allowance_stops: 0, refusals: end === "error_result" ? ["UPSTREAM 529"] : [], spent_micros: usd * 1_000_000, usage: { input: 1000, output: 100, cache_read: 10, cache_write: 5 }, reservation_bound: 0 });
const summary = (usd: number, end: "error_result" | "completed", id: string) => ({ turns: [{ phase: "t1", termination: end, drive: {}, refusal: false }], continuations: 0, slot: { id, close: close(usd, end) } });
const planned: H2hPlanned = { unit: "u1", kind: "O", entry: "bug", stage: "stage1", index: 0, arm: "gstack", item: "h2h-pilot" };

const HARBOR = join(W, "harbor");
writeFileSync(HARBOR, `#!/usr/bin/env bun
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
const a = process.argv.slice(2);
const val = (k) => a[a.indexOf(k) + 1];
const ak = Object.fromEntries(a.flatMap((x, i) => (a[i - 1] === "--ak" ? [[x.slice(0, x.indexOf("=")), x.slice(x.indexOf("=") + 1)]] : [])));
const cap = JSON.parse(readFileSync(ak.h2h_config, "utf8")).limits.allowance_usd;
const job = val("--job-name");
const step = JSON.parse(process.env.H2H_FAKE_PLAN)[job.endsWith("-a2") ? 1 : 0];
const spent = Math.min(step.usd ?? 0, cap);
appendFileSync(process.env.H2H_FAKE_LOG, JSON.stringify({ job, cap, rerun: ak.rerun ?? null }) + "\\n");
const ev = val("-o") + "/" + job + "/trial/evaluator";
mkdirSync(ev, { recursive: true });
writeFileSync(ev + "/h2h-summary.json", JSON.stringify(step.cap_stop ? { cap_stop: true, turns: [], slot: null } : { turns: [{ phase: "t1", termination: step.end, drive: {}, refusal: false }], continuations: 0, slot: { id: "slot-" + job, close: { finalized: true, allowance_stops: 0, refusals: step.end === "error_result" ? ["UPSTREAM 529"] : [], spent_micros: Math.round(spent * 1e6), usage: { input: 1000, output: 100, cache_read: 0, cache_write: 0 }, reservation_bound: 0 } } }));
`);
chmodSync(HARBOR, 0o755);

const home = (name: string) => {
  const d = join(W, name, "gstack");
  mkdirSync(join(d, ".claude/skills/gstack"), { recursive: true });
  writeFileSync(join(d, ".claude/skills/gstack/SKILL.md"), "installed\n");
  return d;
};
const goodHome = home("homes-good");
const input = (out: string): H2hRunInput => ({
  session: planned, out, harbor: HARBOR, claude: "/bin/true", control: "http://127.0.0.1:9", proxy: "http://127.0.0.1:9", runtime: { volume: "h2h-runtimes-test" },
  unit: { unit: { id: "u1", class: "O", kind: "O", entry: "bug" } as H2hUnit, statement: "The flag is never reset.", repo_dir: "/testbed", work_dir: "/testbed", image: { image_id: "sha256:" + "1".repeat(64), tag: "h2h-test-image:none", runtime_id: "sha256:" + "2".repeat(64), volume: "v", commits: 1, head: "a".repeat(40), home: "none", tree_patch_sha256: null, qa_home: null } },
  home: { arm: "gstack", dir: goodHome, home_rule: "gstack", home_tree_sha256: homeTreeSha256(goodHome) },
});
const calls = (log: string) => readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as { job: string; cap: number; rerun: string | null });

let control: ReturnType<typeof Bun.serve>;
const hits: string[] = [];
beforeAll(() => {
  control = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (req) => (hits.push(req.method + " " + new URL(req.url).pathname), Response.json({ ok: true })) });
});
afterAll(() => control.stop(true));

describe("a retry is the whole session again, on a full allowance the cap above it must cover", () => {
  const units = join(W, "rr-units.json");
  writeFileSync(units, JSON.stringify([{ id: "u1", kind: "O", repo: "r", month: "2026-07", entry: "bug" }]));
  const viaRerun = async (plan: Array<Record<string, unknown>>, name: string, cap: number) => {
    const log = join(W, name + ".log");
    writeFileSync(log, "");
    process.env.H2H_FAKE_PLAN = JSON.stringify(plan);
    process.env.H2H_FAKE_LOG = log;
    const out = join(W, name);
    const runner: RerunRunner = { preflight: async () => null, run: (s) => runH2hSession({ ...input(s.out), allowance: s.allowance_usd, capLeftUsd: s.cap_left_usd }).then(({ record }) => ({ kind: "session" as const, session: record, score: null }), (e) => refusedOutcome(e, s.out)) };
    const log0 = console.log;
    console.log = () => {};
    try {
      const code = await rerun(["--arm", "gstack", "--units", units, "--spend-cap", String(cap), "--out", out], runner).then(() => 0, (e) => EXIT[refusal(e).code] ?? 2);
      return { code, calls: calls(log), summary: JSON.parse(readFileSync(join(out, "rerun-summary.json"), "utf8")), record: JSON.parse(readFileSync(join(out, "u1/session.json"), "utf8")) as H2hSessionRecord };
    } finally {
      console.log = log0;
      delete process.env.H2H_FAKE_PLAN;
      delete process.env.H2H_FAKE_LOG;
    }
  };

  test("the retry opens only while the cap left covers one more full allowance", () => {
    const used = (usd: number) => [attemptUsage(1, summary(usd, "error_result", "s1"), 25)];
    expect([retryCovered(undefined, 25, used(20)), retryCovered(25, 25, used(20)), retryCovered(44.99, 25, used(20)), retryCovered(45, 25, used(20)), retryCovered(50, 25, used(20))]).toEqual([true, false, false, true, true]);
  });

  test("the record sums every attempt's spend and tokens, keeps each attempt's own usage, and the doubling input reads the scored attempt", () => {
    const usage = [attemptUsage(1, summary(20, "error_result", "s1"), 25), attemptUsage(2, summary(10, "completed", "s2"), 25)];
    const r = sessionRecord(planned, summary(10, "completed", "s2"), { model: P.model, attempt: 2, exposure: null, wall_ms: 1, home_tree_sha256: null, usage });
    expect(r).toMatchObject({ end: "completed", gap: null, attempts: 2, cost_usd: 30, tokens: { input: 2000, output: 200, cache_read: 20, cache_write: 10 } });
    expect(r.attempt_usage!.map((a) => [a.slot, a.allowance_usd, a.spent_micros, a.end])).toEqual([["s1", 25, 20_000_000, "upstream"], ["s2", 25, 10_000_000, "completed"]]);
  });

  test("$20 then an upstream end under rerun --spend-cap 25: a cap stop (exit 10) before the retry opens, and the record keeps the $20", async () => {
    const r = await viaRerun([{ usd: 20, end: "error_result" }, { usd: 10, end: "completed" }], "rr25", 25);
    expect(r.code).toBe(10);
    expect(r.calls.map((c) => c.cap)).toEqual([25]);
    expect(r.record).toMatchObject({ end: "cap_stop", gap: "CAP_STOP", attempts: 1, cost_usd: 20 });
    expect(r.record.retry_cap_stop).toContain("full $25 allowance");
    expect(r.summary).toMatchObject({ stop: "cap_stop", spent_usd: 20, sessions: [{ unit: "u1", cost_usd: 20, attempts: 1 }] });
  });

  test("the same under rerun --spend-cap 50: the retry opens on a full $25 slot and the record sums both attempts", async () => {
    const r = await viaRerun([{ usd: 20, end: "error_result" }, { usd: 10, end: "completed" }], "rr50", 50);
    expect(r.code).toBe(0);
    expect(r.calls.map((c) => [c.cap, c.rerun])).toEqual([[25, null], [25, "session_upstream_or_infra"]]);
    expect(r.record).toMatchObject({ end: "completed", gap: null, attempts: 2, cost_usd: 30 });
    expect(r.summary).toMatchObject({ stop: null, spent_usd: 30, sessions: [{ unit: "u1", cost_usd: 30, attempts: 2 }] });
  });

  test("on the ledger path the item lease refuses the retry's slot: a cap stop whose record keeps the first attempt's spend", async () => {
    const log = join(W, "lease.log");
    writeFileSync(log, "");
    process.env.H2H_FAKE_PLAN = JSON.stringify([{ usd: 20, end: "error_result" }, { cap_stop: true }]);
    process.env.H2H_FAKE_LOG = log;
    try {
      await expect(runH2hSession(input(join(W, "lease")))).rejects.toThrow(/^CAP_STOP .*the driver refused its slot/);
    } finally {
      delete process.env.H2H_FAKE_PLAN;
      delete process.env.H2H_FAKE_LOG;
    }
    expect(calls(log).map((c) => [c.cap, c.rerun])).toEqual([[25, null], [25, "session_upstream_or_infra"]]);
    expect(JSON.parse(readFileSync(join(W, "lease/session.json"), "utf8"))).toMatchObject({ end: "cap_stop", gap: "CAP_STOP", attempts: 2, cost_usd: 20 });
  });
});

describe("a home whose installed bytes are not its pin refuses before any slot opens", () => {
  const stale = home("homes-stale");
  const pins = join(W, "pins.json");
  writeFileSync(pins, JSON.stringify([{ arm: "gstack", roots: [".claude/skills/gstack"], home_tree_sha256: homeTreeSha256(goodHome), home_of: null }]));
  writeFileSync(join(stale, ".claude/skills/gstack/SKILL.md"), "stale\n");
  const homes = join(W, "homes-stale");

  test("on the session-run path", async () => {
    const plan = join(W, "plan.json");
    writeFileSync(plan, JSON.stringify({ schema: "h2h-plan.v1", stage: "stage1", order_seed: 1, sessions: [planned] }));
    const unit = join(W, "unit.json");
    writeFileSync(unit, JSON.stringify(input(join(W, "unused")).unit));
    const out = join(W, "sr-out");
    const before = hits.length;
    const errs: string[] = [];
    const orig = console.error;
    console.error = (m: unknown) => errs.push(String(m));
    try {
      const code = await commands["session-run"]!(["--plan", plan, "--index", "0", "--unit", unit, "--control", control.url.origin, "--proxy", control.url.origin, "--out", out, "--homes", homes, "--pins", pins]);
      expect(code).toBe(1);
    } finally {
      console.error = orig;
    }
    expect(errs.join("\n")).toStartWith("E_H2H_HOME_DRIFT ");
    expect(hits.length).toBe(before);
    expect(existsSync(join(out, "a1"))).toBe(false);
  });

  test("on the rerun path", async () => {
    const units = join(W, "units.json");
    writeFileSync(units, JSON.stringify([{ id: "u1", kind: "O", repo: "r", month: "2026-07", entry: "bug" }]));
    const out = join(W, "rr-out");
    const before = hits.length;
    const r = await rerun(["--arm", "gstack", "--units", units, "--spend-cap", "100", "--out", out], sessionRunner({ H2H_CONTROL: control.url.origin, H2H_PROXY: control.url.origin, H2H_HOMES: homes, H2H_UNITS: W, H2H_PINS: pins })).then(() => null, (e) => refusal(e));
    expect(r?.code).toBe("E_H2H_RERUN_PRECONDITION");
    expect(r?.text).toContain("E_H2H_HOME_DRIFT");
    expect(hits.length).toBe(before);
    expect(existsSync(join(out, "u1"))).toBe(false);
  });
});
