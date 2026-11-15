// Copyright (c) 2026 Garry Tan. MIT License.
// The head-to-head session's retry within one allowance and the home pin check before any slot opens (sessions/run.ts,
// session.ts, home.ts, rerunner.ts). Harbor is a stub script that writes each attempt's summary; no Docker, no key.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { homeTreeSha256 } from "../../lanes/outcome-skills/h2h/arms/hash.ts";
import { refusal } from "../../lanes/outcome-skills/h2h/cli.ts";
import { readPrereg } from "../../lanes/outcome-skills/h2h/prereg.ts";
import { rerun } from "../../lanes/outcome-skills/h2h/rerun.ts";
import { commands } from "../../lanes/outcome-skills/h2h/sessions/commands.ts";
import type { H2hPlanned } from "../../lanes/outcome-skills/h2h/sessions/plan.ts";
import { sessionRunner } from "../../lanes/outcome-skills/h2h/sessions/rerunner.ts";
import { runH2hSession, type H2hRunInput } from "../../lanes/outcome-skills/h2h/sessions/run.ts";
import { attemptUsage, gapOf, retryAllowance, sessionRecord } from "../../lanes/outcome-skills/h2h/sessions/session.ts";
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
const spent = Math.min(step.usd, cap);
appendFileSync(process.env.H2H_FAKE_LOG, JSON.stringify({ job, cap, rerun: ak.rerun ?? null }) + "\\n");
const ev = val("-o") + "/" + job + "/trial/evaluator";
mkdirSync(ev, { recursive: true });
writeFileSync(ev + "/h2h-summary.json", JSON.stringify({ turns: [{ phase: "t1", termination: step.end, drive: {}, refusal: false }], continuations: 0, slot: { id: "slot-" + job, close: { finalized: true, allowance_stops: 0, refusals: step.end === "error_result" ? ["UPSTREAM 529"] : [], spent_micros: Math.round(spent * 1e6), usage: { input: 1000, output: 100, cache_read: 0, cache_write: 0 }, reservation_bound: 0 } } }));
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
const fake = async (plan: Array<{ usd: number; end: string }>, name: string) => {
  const log = join(W, name + ".log");
  writeFileSync(log, "");
  process.env.H2H_FAKE_PLAN = JSON.stringify(plan);
  process.env.H2H_FAKE_LOG = log;
  try {
    const r = await runH2hSession(input(join(W, name)));
    return { ...r, calls: readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as { job: string; cap: number; rerun: string | null }) };
  } finally {
    delete process.env.H2H_FAKE_PLAN;
    delete process.env.H2H_FAKE_LOG;
  }
};

let control: ReturnType<typeof Bun.serve>;
const hits: string[] = [];
beforeAll(() => {
  control = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (req) => (hits.push(req.method + " " + new URL(req.url).pathname), Response.json({ ok: true })) });
});
afterAll(() => control.stop(true));

describe("the retry stays inside the one session allowance", () => {
  test("a retry gets what the first attempt left, and opens only while half the allowance is left", () => {
    const used = (usd: number) => [attemptUsage(1, summary(usd, "error_result", "s1"), 25)];
    expect(retryAllowance(25, used(0))).toBe(25);
    expect(retryAllowance(25, used(5))).toBe(20);
    expect(retryAllowance(25, used(12.5))).toBe(12.5);
    expect(retryAllowance(25, used(20))).toBeNull();
    expect(retryAllowance(25, used(26))).toBeNull();
    expect([gapOf("upstream", 1, null, true), gapOf("infra", 1, null, true), gapOf("upstream", 1, null)]).toEqual(["E_H2H_UPSTREAM_GAP", "E_H2H_INFRA_GAP", null]);
  });

  test("the record sums every attempt's spend and tokens and keeps each attempt's own usage", () => {
    const usage = [attemptUsage(1, summary(5, "error_result", "s1"), 25), attemptUsage(2, summary(20, "completed", "s2"), 20)];
    const r = sessionRecord(planned, summary(20, "completed", "s2"), { model: P.model, attempt: 2, exposure: null, wall_ms: 1, home_tree_sha256: null, usage });
    expect(r).toMatchObject({ end: "completed", gap: null, attempts: 2, cost_usd: 25, tokens: { input: 2000, output: 200, cache_read: 20, cache_write: 10 } });
    expect(r.attempt_usage!.map((a) => [a.slot, a.allowance_usd, a.spent_micros, a.end])).toEqual([["s1", 25, 5_000_000, "upstream"], ["s2", 20, 20_000_000, "completed"]]);
  });

  test("$20 spent then an upstream end under a $25 allowance: no retry slot opens, the record keeps the $20 and ends as the gap", async () => {
    const { record, calls } = await fake([{ usd: 20, end: "error_result" }, { usd: 20, end: "completed" }], "s20-20");
    expect(calls.map((c) => c.cap)).toEqual([P.limits.allowance_usd]);
    expect(record).toMatchObject({ end: "upstream", gap: "E_H2H_UPSTREAM_GAP", attempts: 1, cost_usd: 20 });
    expect(record.retry_withheld).toContain("$20.00 of the $25");
    expect(record.attempt_usage!.length).toBe(1);
    expect(JSON.parse(readFileSync(join(W, "s20-20/session.json"), "utf8")).cost_usd).toBe(20);
  });

  test("$5 spent then an upstream end: the retry's slot is capped at the $20 left and the record sums both attempts", async () => {
    const { record, calls } = await fake([{ usd: 5, end: "error_result" }, { usd: 40, end: "completed" }], "s5-40");
    expect(calls.map((c) => [c.cap, c.rerun])).toEqual([[25, null], [20, "session_upstream_or_infra"]]);
    expect(record).toMatchObject({ end: "completed", gap: null, attempts: 2, cost_usd: 25 });
    expect(record.cost_usd).toBeLessThanOrEqual(P.limits.allowance_usd);
    expect(record.attempt_usage!.map((a) => a.spent_micros)).toEqual([5_000_000, 20_000_000]);
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
