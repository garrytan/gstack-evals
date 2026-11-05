#!/usr/bin/env bun
// The outcome-skills driver's keyless dry run (GST-1381, plan wiki/plans/2026-11-04-geva-286-u4-session-driver, section
// 5). It runs the driver (stage.ts) in child processes on a temporary ledger record, with a stub Anthropic upstream in
// this process, the real sandbox sidecar, and real_agent on the real pinned claude-agent-sdk 0.2.174 and Harbor f3a5a92
// with the stub Claude Code. No key, no VM: Docker runs only for Z1's busybox container and volume. Each check prints one
// PASS or FAIL line and the run stops at the first miss; Z1 always runs, in the top-level finally, after every child is
// reaped. --seed <name> plants one fault that a named check must catch. Usage: bun dryrun.ts [--seed <name>]
import { Database } from "bun:sqlite";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { CHAT_PRICES } from "../../../src/runner/pricing/prices.ts";
import { envelopeStatus } from "../../../src/runner/ledger/envelope.ts";
import { ledgerStatus, machineId } from "../../../src/runner/ledger/ledger.ts";
import { openLocalLedger } from "../../../src/runner/ledger/local.ts";
import { ledgerPath } from "../../../src/runner/ledger/paths.ts";
import { LedgerError, readItem } from "../../../src/runner/ledger/record.ts";
import { meteredPricer } from "../../../src/runner/stats/g-resize.ts";
import { loadRegistry, REGISTRY_PATH } from "../arms/registry.ts";
import type { StageSpec } from "./stage.ts";

const ROOT = join(import.meta.dir, "../../..");
const BIN = join(ROOT, "bin/gstack-evals");
const PYTHON = process.env.REAL_OUTCOME_PYTHON ?? join(homedir(), ".capy/work/real/venv/bin/python");
const KEYS = /^(ANTHROPIC|OPENAI|OPENROUTER|UBICLOUD|GEMINI|GOOGLE|XAI|DEEPSEEK)_[A-Z_]*KEY$|_TOKEN$/;
export const SEEDS = ["u1", "u2", "u3", "u4", "u5", "u6", "u7", "l7-extra", "l7-missing", "l7-swap", "l7-cache-rate", "z1-container", "z1-volume", "z1-lease", "z1-after-fail"] as const;
const PROGRAM = "g-dryrun";
const RUN = "dryrun-g";
const SKILLS = "plan-eng-review,autoplan,plan-devex-review,devex-review,plan-design-review,design-review";
const WORDS = "dry-run fixture words on a temporary ledger, not an approval";
const Z1_PREFIXES = ["gstack-evals-", "gstack-mutation-prepare-", "gstack-mutation-run-"];
const STAGES: StageSpec[] = [
  { item: "g-none", arm: "none" },
  { item: "g-pe", arm: "plan-eng-review:told" },
  { item: "g-ap", arm: "autoplan:told" },
];

interface ChildConfig {
  record: string;
  ledger: string;
  run: string;
  stages: StageSpec[];
  dir: string;
  stub: string;
  markers: string;
  seed: string | null;
}

async function child(c: ChildConfig): Promise<number> {
  const { serveStages } = await import("./stage.ts");
  const local = openLocalLedger(ledgerPath(c.ledger));
  if (c.seed === "l7-cache-rate") {
    const settle = local.settle.bind(local);
    local.settle = (rid, outcome) => settle(rid, outcome.kind === "spent" ? { ...outcome, spent_micros: outcome.spent_micros - outcome.usage.cache_write } : outcome);
  }
  try {
    const served = await serveStages({
      record: c.record,
      local,
      run_id: c.run,
      envelope_host: machineId(),
      stages: c.stages,
      host: "127.0.0.1",
      dir: c.dir,
      env: { ANTHROPIC_API_KEY: "dryrun-placeholder-not-a-key" },
      fetch: (input, init) => fetch(input.replace("https://api.anthropic.com", c.stub), init),
      requireAdmission: (_record, lease) => (existsSync(join(c.markers, lease.item + "." + lease.seq)) ? null : "no dry-run admission marker for slot " + lease.seq),
    });
    let control = served.control;
    if (c.seed === "u3") {
      const front = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch: async (req) => {
          const url = new URL(req.url);
          const res = await fetch(served.control + url.pathname, { method: req.method, headers: req.headers, body: req.method === "GET" ? undefined : await req.text() });
          if (url.pathname !== "/sessions" || !res.ok) return res;
          const a = (await res.json()) as { base_url: string };
          return Response.json({ ...a, base_url: a.base_url.replace(/\/s_[^/]+\/anthropic$/, "") });
        },
      });
      control = "http://127.0.0.1:" + front.port;
    }
    console.log("control=" + control);
    for (const s of served.stages) console.log("stage=" + s.item + " lease=" + s.lease_id + " proxy=" + s.proxy);
    process.on("SIGTERM", () => void served.stop());
    return await served.done;
  } catch (e) {
    if (!(e instanceof LedgerError)) throw e;
    console.error(e.code + " " + e.message);
    return 2;
  }
}

class Miss extends Error {}

interface Driver {
  control: string;
  stages: Map<string, { lease: string; proxy: string }>;
  exit: () => number | null;
  exited: Promise<number>;
  err: () => string;
  kill: (signal: NodeJS.Signals) => void;
}

interface StubEntry {
  kind: "received" | "answered";
  label: string;
  n: number;
  usage?: Record<string, number>;
  stream?: boolean;
}

const price = (u: Record<string, number>) => {
  const row = CHAT_PRICES["anthropic:claude-opus-5-5"]!;
  const tenths = (rate: number) => Math.round(rate * 10);
  const total = u.input_tokens! * tenths(row.input) + u.output_tokens! * tenths(row.output) + u.cache_read_input_tokens! * tenths(row.cache_read!) + u.cache_creation_input_tokens! * tenths(row.cache_write!);
  return Math.floor((total + 9) / 10);
};

async function main(argv: string[]): Promise<number> {
  const seed = argv[0] === "--seed" ? (argv[1] ?? "") : null;
  if (seed !== null && !(SEEDS as readonly string[]).includes(seed)) {
    console.error("E_USAGE dryrun: --seed takes one of " + SEEDS.join(", "));
    return 2;
  }
  for (const k of Object.keys(process.env)) if (KEYS.test(k)) delete process.env[k];
  const W = mkdtempSync(join(tmpdir(), "u4-dryrun-"));
  const LD = join(W, "ledger");
  mkdirSync(join(W, "markers"), { recursive: true });
  mkdirSync(LD, { recursive: true });
  writeFileSync(join(LD, "approvals-stub"), '#!/bin/sh\nprintf "%s\\n" "$*" >> "' + LD + '/approvals-stub.log"\n', { mode: 0o755 });
  const record = join(LD, "record");
  const ledger = join(LD, "ledger.sqlite");
  const ENV = { ...process.env, GSTACK_EVALS_APPROVALS_BIN: join(LD, "approvals-stub"), GSTACK_EVALS_LEDGER: ledger, GSTACK_EVALS_LEDGER_RECORD: record, PYTHONDONTWRITEBYTECODE: "1" } as Record<string, string>;
  console.log("dry run in " + W + (seed ? ", seed " + seed : "") + "; gstack-approvals is a stub, every key variable is unset, and the upstream is a stub in this process");

  let ok = true;
  const rule = (name: string, expected: string, got: string, pass: boolean) => {
    console.log((pass ? "PASS " : "FAIL ") + name + ": expected " + expected + "; got " + got);
    if (!pass) throw new Miss(name);
  };
  const LG = (...args: string[]) => {
    const r = spawnSync(process.execPath, [BIN, "ledger", ...args], { env: ENV, encoding: "utf8" });
    return { code: r.status ?? -1, out: r.stdout, err: r.stderr };
  };
  const mark = (item: string, seq: number) => writeFileSync(join(W, "markers", item + "." + seq), "");
  const init = (item: string, cap: number, skills: string, admission: "required" | "warn") => {
    const r = LG("init", "--cap", String(cap), "--item", item, "--admission", admission, "--words", WORDS, "--by", "GEVA-286", "--source", "dryrun.ts", "--program", PROGRAM, "--skills", skills);
    if (r.code !== 0) throw new Error("ledger init " + item + " failed: " + r.err.slice(0, 300));
  };
  const docker = (...args: string[]) => spawnSync("docker", args, { encoding: "utf8" });
  const procs: Array<ReturnType<typeof spawn>> = [];
  const drivers: Driver[] = [];

  const stubLog: StubEntry[] = [];
  let hold: string | null = null;
  const release: Array<() => void> = [];
  let k = 0;
  const stub = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    idleTimeout: 0,
    fetch: async (req) => {
      const body = (await req.json()) as { model: string; max_tokens: number; stream?: boolean; messages: unknown };
      const m = /dryrun-call (\S+) (\d+)/.exec(JSON.stringify(body.messages));
      const label = m?.[1] ?? "?";
      const n = Number(m?.[2] ?? 0);
      stubLog.push({ kind: "received", label, n });
      if (hold === label + " " + n) {
        await new Promise<void>((r) => release.push(r));
        return new Response("held", { status: 500 });
      }
      k++;
      const usage = { input_tokens: 2 + (k % 17), cache_creation_input_tokens: 3 + (k % 11), cache_read_input_tokens: 5 * (k % 9) + 1 + (k % 4), output_tokens: seed === "u4" ? body.max_tokens + 1000 + k : 20000 + k };
      stubLog.push({ kind: "answered", label, n, usage, stream: !!body.stream });
      if (!body.stream) return Response.json({ id: "msg_" + k, type: "message", role: "assistant", model: body.model, content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", stop_sequence: null, usage });
      const ev = (type: string, data: object) => "event: " + type + "\ndata: " + JSON.stringify({ type, ...data }) + "\n\n";
      const { output_tokens, ...input } = usage;
      const sse =
        ev("message_start", { message: { id: "msg_" + k, type: "message", role: "assistant", model: body.model, content: [], stop_reason: null, usage: { ...input, output_tokens: 1 } } }) +
        ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } }) +
        ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: "ok" } }) +
        ev("content_block_stop", { index: 0 }) +
        ev("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens } }) +
        ev("message_stop", {});
      return new Response(sse, { headers: { "content-type": "text/event-stream" } });
    },
  });
  const lbCalls: Array<{ path: string; body: unknown }> = [];
  const laneb = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (req) => {
      const path = new URL(req.url).pathname;
      lbCalls.push({ path, body: await req.json().catch(() => null) });
      return Response.json(path === "/sessions" ? { id: "lb-1", token: "lb-token" } : { id: "lb-1", ok_responses: 0 });
    },
  });

  const lines = (stream: NodeJS.ReadableStream, sink: (line: string) => void) => {
    let buf = "";
    stream.on("data", (d: Buffer) => {
      buf += d.toString();
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        sink(buf.slice(0, i));
        buf = buf.slice(i + 1);
      }
    });
  };
  const driver = async (name: string, run: string, stages: StageSpec[]): Promise<Driver> => {
    const dir = join(W, "run-" + run);
    const cfg = join(W, name + ".json");
    writeFileSync(cfg, JSON.stringify({ record, ledger, run, stages, dir, stub: "http://127.0.0.1:" + stub.port, markers: join(W, "markers"), seed } satisfies ChildConfig));
    const p = spawn(process.execPath, [import.meta.path, "--child", cfg], { env: ENV, stdio: ["ignore", "pipe", "pipe"] });
    procs.push(p);
    let err = "";
    let control = "";
    const got = new Map<string, { lease: string; proxy: string }>();
    let wake = () => {};
    lines(p.stderr!, (l) => (err += l + "\n"));
    lines(p.stdout!, (l) => {
      const c = /^control=(\S+)/.exec(l);
      const s = /^stage=(\S+) lease=(\S+) proxy=(\S+)/.exec(l);
      if (c) control = c[1]!;
      if (s) got.set(s[1]!, { lease: s[2]!, proxy: s[3]! });
      wake();
    });
    let code: number | null = null;
    const exited = new Promise<number>((r) => p.on("exit", (c) => r((code = c ?? -1))));
    exited.then(() => wake());
    await new Promise<void>((resolve) => {
      wake = () => (code !== null || (control && got.size === stages.length) ? resolve() : undefined);
      wake();
    });
    const d: Driver = { control, stages: got, exit: () => code, exited, err: () => err, kill: (sig) => p.kill(sig) };
    drivers.push(d);
    return d;
  };
  const within = <T>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]);
  const sessionsOf = (run: string) => {
    const f = join(W, "run-" + run, "sessions.jsonl");
    return existsSync(f) ? readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, any>) : [];
  };

  const lane = JSON.parse(readFileSync(join(ROOT, "lanes/real-outcome/arms/arms.json"), "utf8"));
  const reg = loadRegistry();
  const arms = { ...lane, arms: Object.fromEntries(Object.entries(reg.arms).map(([name, a]) => [name, { ...lane.arms[a.kind === "none" ? "none" : "gstack"], limits: { ...a.limits, quiet_sec: 1 } }])) };
  const armsPath = join(W, "stand-in-arms.json");
  writeFileSync(armsPath, JSON.stringify(arms, null, 2));
  const sidecar = spawn(process.execPath, [BIN, "real", "sandbox", "serve", "--root", join(W, "sidecar"), "--agent-host", "127.0.0.1", "--agent-port", "0", "--control-port", "0"], { env: ENV, stdio: ["ignore", "pipe", "inherit"] });
  procs.push(sidecar);
  const sidecarUrl = await new Promise<string>((r) => lines(sidecar.stdout!, (l) => /control=(\S+)/.test(l) && r(/control=(\S+)/.exec(l)![1]!)));

  type SessionResult = { error: { type: string; message: string } | null; stub: Array<Record<string, any>>; summary: Record<string, any> | null; events: string[] };
  let sessionN = 0;
  const session = (a: Record<string, unknown>): Promise<SessionResult> =>
    new Promise((resolve, reject) => {
      const dir = join(W, "sessions", String(++sessionN));
      mkdirSync(dir, { recursive: true });
      const p = spawn(PYTHON, [join(import.meta.dir, "dryrun_session.py"), JSON.stringify({ dir, sidecar: sidecarUrl, node: process.execPath, arms_path: armsPath, ledger: "u4", ...a })], { env: ENV, stdio: ["ignore", "pipe", "pipe"] });
      procs.push(p);
      let out = "";
      let err = "";
      p.stdout!.on("data", (d: Buffer) => (out += d));
      p.stderr!.on("data", (d: Buffer) => (err += d));
      p.on("exit", () => {
        try {
          resolve(JSON.parse(out.trim().split("\n").at(-1) ?? ""));
        } catch {
          reject(new Error("the session helper printed no result: " + err.slice(-600)));
        }
      });
    });
  const label = (run: string, arm: string, task: string, trial: number) => run + "/" + arm + "/" + task + "/" + trial;
  const proxyRoot = (d: Driver, item: string) => "http://" + d.stages.get(item)!.proxy;

  const tag = randomBytes(3).toString("hex");
  const box = "gstack-evals-dryrun-" + tag;
  const vol = "gstack-mutation-dryrun-" + tag;
  const leaks = { containers: Z1_PREFIXES.map((p) => p + "dryrun-leak-" + tag), volume: "gstack-mutation-dryrun-leak-" + tag };
  const leased: string[] = [];
  try {
    if (spawnSync("docker", ["image", "inspect", "busybox"]).status !== 0 && docker("pull", "-q", "busybox").status !== 0) throw new Error("docker could not pull busybox");
    if (docker("volume", "create", vol).status !== 0 || docker("run", "-d", "--name", box, "-v", vol + ":/v", "busybox", "sleep", "600").status !== 0) throw new Error("docker could not start the busybox container and volume");
    if (seed === "z1-container") for (const c of leaks.containers) docker("run", "-d", "--name", c, "busybox", "sleep", "600");
    if (seed === "z1-volume") docker("volume", "create", leaks.volume);
    if (seed === "z1-after-fail") rule("Z1 seed: an earlier check", "a pass", "a planted failure, so Z1 must still run", false);

    // U1: the three stage leases through O6 at their caps.
    const env = LG("envelope", "--program", PROGRAM, "--cap", "10000", "--skill-cap", seed === "u1" ? "1000" : "2000", "--skills", SKILLS, "--credit-rate", "1", "--words", WORDS, "--by", "GEVA-286", "--source", "dryrun.ts");
    if (env.code !== 0) throw new Error("ledger envelope failed: " + env.err.slice(0, 300));
    init("g-tg", 60, "plan-eng-review,autoplan", "warn");
    init("g-none", 229, "plan-eng-review,autoplan", "required");
    init("g-pe", 572, "plan-eng-review", "required");
    init("g-ap", 1287, "autoplan", "required");
    init("g-vm", 24, "plan-eng-review,autoplan", "warn");
    for (const item of ["g-tg", "g-vm"]) {
      const r = LG("lease", "--item", item, "--run", RUN, "--json");
      if (r.code !== 0) throw new Error("ledger lease " + item + " failed: " + r.err.slice(0, 300));
      leased.push(JSON.parse(r.out).lease_id);
    }
    for (const item of ["g-none", "g-pe", "g-ap"]) mark(item, 1);
    const A = await driver("a", RUN, STAGES);
    const caps: Record<string, number> = { "g-none": 229, "g-pe": 572, "g-ap": 1287 };
    const status = ledgerStatus(record);
    const reserved = STAGES.map((s) => status.find((i) => i.item === s.item)?.open_lease?.reserved_micros ?? 0);
    const st = envelopeStatus(record, PROGRAM);
    const pe = st.skills["plan-eng-review"]!.committed_micros / 1e6;
    const ap = st.skills.autoplan!.committed_micros / 1e6;
    rule("U1 the driver opens the three stage leases through O6 at their caps", "$229, $572, $1287 open; envelope $728.5 on plan-eng-review and $1443.5 on autoplan", (A.exit() === null ? "" : "driver exited " + A.exit() + " (" + A.err().split("\n")[0]!.slice(0, 160) + "); ") + "$" + reserved.map((v) => v / 1e6).join(", $") + " open; envelope $" + pe + " and $" + ap, A.exit() === null && STAGES.every((s, i) => reserved[i] === caps[s.item]! * 1e6) && pe === 728.5 && ap === 1443.5);

    // U2: refused at preflight, with no lease written.
    init("g-u2-pe", 50, "plan-eng-review", "required");
    init("g-u2-ap", seed === "u2" ? 500 : 600, "autoplan", "required");
    mark("g-u2-pe", 1);
    mark("g-u2-ap", 1);
    const B = await driver("b", "dryrun-u2", [{ item: "g-u2-pe", arm: "plan-eng-review:told" }, { item: "g-u2-ap", arm: "autoplan:told" }]);
    const bCode = await within(B.exited, 20_000);
    const bLeases = ["g-u2-pe", "g-u2-ap"].map((i) => readItem(record, i).leases.length);
    init("g-u2-rig", 10, "plan-eng-review", "required");
    const C = await driver("c", "dryrun-u2r", [{ item: "g-u2-rig", arm: "plan-eng-review:told" }]);
    const cCode = await within(C.exited, 20_000);
    const cLeases = readItem(record, "g-u2-rig").leases.length;
    rule("U2 a batch the envelope can't hold, and a batch with no admission record, are refused at preflight", "exit 2 with ENVELOPE_SKILL_STOP and 0 leases; exit 2 with E_RIG_UNPROVEN and 0 leases", "exit " + bCode + " " + (B.err().match(/^[A-Z_]+/)?.[0] ?? "no code") + " and " + bLeases.join("+") + " leases; exit " + cCode + " " + (C.err().match(/^[A-Z_]+/)?.[0] ?? "no code") + " and " + cLeases + " leases", bCode === 2 && B.err().startsWith("ENVELOPE_SKILL_STOP") && bLeases.every((n) => n === 0) && cCode === 2 && C.err().startsWith("E_RIG_UNPROVEN") && cLeases === 0);

    // U3: one real_agent session per arm through its slot.
    const u3: string[] = [];
    let u3ok = true;
    for (const s of STAGES) {
      const r = await session({ arm: s.arm, control_url: A.control, base_url: proxyRoot(A, s.item), task: "t-u3", trial_n: 1, calls: 5, label: label(RUN, s.arm, "t-u3", 1) });
      const base = r.stub.find((e) => e.event === "start")?.base_url ?? "";
      const api = r.stub.filter((e) => e.event === "api");
      const open = sessionsOf(RUN).find((e) => e.event === "open" && e.arm === s.arm && e.task === "t-u3");
      const close = open && sessionsOf(RUN).find((e) => e.event === "close" && e.id === open.id);
      const good = r.error === null && new RegExp("^" + proxyRoot(A, s.item).replaceAll(".", "\\.") + "/s_[A-Za-z0-9_-]+/anthropic$").test(base) && api.length === 5 && api.every((e) => e.status === 200) && api.filter((e) => e.sse).length === 4 && r.summary?.proxy?.ok_responses === 5 && r.summary?.proxy?.spent_micros > 0 && !!close && close.spent_micros === r.summary?.proxy?.spent_micros;
      u3ok &&= good;
      u3.push(s.arm + ": " + (r.error ? r.error.type + " " + r.error.message.slice(0, 160) : api.length + " calls (" + api.filter((e) => e.sse).length + " streamed) at " + base.replace(/s_[^/]+/, "<slot>") + ", spent $" + (r.summary?.proxy?.spent_micros ?? 0) / 1e6 + ", close " + (close ? "recorded" : "missing")));
    }
    rule("U3 a real_agent session per arm runs through its U4 slot", "the slot URL as ANTHROPIC_BASE_URL, 4 streamed and 1 JSON call answered, the meter in real-summary.json and sessions.jsonl", u3.join("; "), u3ok);

    // U4: a session per arm that calls until refused stops at its allowance.
    const db = new Database(ledger, { readonly: true });
    const rows = (meter: string) => (db.query("SELECT idempotency_key, cell, state, max_micros, spent_micros, usage FROM reservations").all() as Array<Record<string, any>>).filter((r) => JSON.parse(r.cell).meter_id === meter);
    const u4: string[] = [];
    let u4ok = true;
    for (const s of STAGES) {
      const r = await session({ arm: s.arm, control_url: A.control, base_url: proxyRoot(A, s.item), task: "t-u4", trial_n: 1, calls: "until_refused", label: label(RUN, s.arm, "t-u4", 1) });
      const api = r.stub.filter((e) => e.event === "api");
      const last = api.at(-1);
      const cap = reg.arms[s.arm]!.limits.session_cap_usd * 1e6;
      const meter = sessionsOf(RUN).find((e) => e.event === "open" && e.arm === s.arm && e.task === "t-u4")?.meter_id ?? "";
      const over = rows(meter).filter((x) => x.state === "settled" && x.spent_micros > x.max_micros).length;
      const spent = r.summary?.proxy?.spent_micros ?? Infinity;
      const good = r.error === null && last?.code === "E_ALLOWANCE" && spent <= cap && over === 0;
      u4ok &&= good;
      u4.push(s.arm + ": " + api.length + " calls, last " + (last?.status ?? "none") + " " + (last?.code ?? "") + ", spent $" + spent / 1e6 + " of $" + cap / 1e6 + " (overshoot " + Math.max(0, ((spent - cap) / cap) * 100).toFixed(1) + "%), " + over + " calls above their reservation" + (r.error ? ", " + r.error.type : ""));
    }
    rule("U4 a session that calls until refused is refused with E_ALLOWANCE before its limit", "E_ALLOWANCE, spend at most $8, $20, $45, overshoot 0% (prereg allows 10%), no call above its reservation", u4.join("; "), u4ok);

    // U5: a none cap stop ends both skills.
    init("g-u5-none", seed === "u5" ? 100 : 10, "plan-eng-review,autoplan", "required");
    init("g-u5-pe", 30, "plan-eng-review", "required");
    mark("g-u5-none", 1);
    mark("g-u5-pe", 1);
    const D = await driver("d", "dryrun-u5", [{ item: "g-u5-none", arm: "none" }, { item: "g-u5-pe", arm: "plan-eng-review:told" }]);
    const toldOpen = (n: number) => fetch(D.control + "/sessions", { method: "POST", body: JSON.stringify({ trial: "u5-told-" + n, model: "claude-opus-5-5", cap_usd: 20, meta: { arm: "plan-eng-review:told", task: "t-u5", trial_n: n }, open_key: "u5-told-" + n, ledger: "u4" }) }).catch(() => null);
    const live = (await (await toldOpen(1))?.json()) as { id?: string } | undefined;
    const s1 = await session({ arm: "none", control_url: D.control, base_url: proxyRoot(D, "g-u5-none"), task: "t-u5", trial_n: 1, calls: 8, label: label("dryrun-u5", "none", "t-u5", 1) });
    const s2 = await session({ arm: "none", control_url: D.control, base_url: proxyRoot(D, "g-u5-none"), task: "t-u5", trial_n: 2, calls: 3, label: label("dryrun-u5", "none", "t-u5", 2) });
    const told = await toldOpen(2);
    if (live?.id) await fetch(D.control + "/sessions/" + live.id + "/close", { method: "POST", body: JSON.stringify({ reason: "agent_finished" }) }).catch(() => null);
    const dCode = await within(D.exited, 60_000);
    const refusals = sessionsOf("dryrun-u5").filter((e) => e.event === "refuse" && e.arm === "none" && e.trial_n === 2);
    const settled = D.err().split("\n").filter((l) => l.startsWith("STAGE_SETTLED"));
    const capped = ["g-u5-none", "g-u5-pe"].every((i) => settled.some((l) => l.includes("item=" + i + " ") && l.includes("ended=cap_stop scope=all")));
    rule("U5 a none cap stop is not retried and ends both skills", "real_agent's LedgerCapStop with no model call and one refusal, a told open behind it refused 409, both stages settled with ended=cap_stop scope=all, exit 0", "first session " + (s1.error ? s1.error.type : "ran") + ", second " + (s2.error?.type ?? "ran") + " with " + (s2.stub.some((e) => e.event === "start") ? "Claude Code started" : "no model call") + " and " + refusals.length + " refusal, told open " + (told?.status ?? "failed") + ", " + settled.length + " STAGE_SETTLED (" + (capped ? "both cap_stop scope=all" : settled.join(" | ").slice(0, 300)) + "), exit " + dCode, s1.error === null && s2.error?.type === "LedgerCapStop" && !s2.stub.some((e) => e.event === "start") && refusals.length === 1 && told?.status === 409 && capped && dCode === 0);

    // U6: real_agent refuses an answer that is not a U4 slot, and registry arms without U4.
    const a6 = await session({ arm: "none", ledger: seed === "u6" ? "laneb" : "u4", control_url: "http://127.0.0.1:" + laneb.port, base_url: "http://127.0.0.1:9", task: "t-u6", trial_n: 1, calls: 1, label: "u6-a" });
    const closedLb = lbCalls.find((c) => c.path === "/sessions/lb-1/close");
    const opensBefore = lbCalls.filter((c) => c.path === "/sessions").length;
    const b6 = await session({ arm: "none", ledger: "laneb", arms_path: REGISTRY_PATH, control_url: "http://127.0.0.1:" + laneb.port, base_url: "http://127.0.0.1:9", label: "u6-b" });
    const opensAfter = lbCalls.filter((c) => c.path === "/sessions").length;
    rule("U6 real_agent refuses a Lane B answer in u4 mode, and registry arms on laneb", "E_REAL_SANDBOX_SETUP before any model call with the Lane B session closed; E_REAL_SANDBOX_SETUP before the sandbox opens", (a6.error ? a6.error.type + " " + a6.error.message.slice(0, 90) : "no error") + ", " + (a6.stub.some((e) => e.event === "start") ? "Claude Code started" : "no model call") + ", close " + ((closedLb?.body as { reason?: string })?.reason ?? "not sent") + "; " + (b6.error ? b6.error.type + " " + b6.error.message.slice(0, 90) : "no error") + ", " + (b6.events.includes("sandbox_open") ? "sandbox opened" : "no sandbox") + ", " + (opensAfter - opensBefore) + " opens", !!a6.error?.message.includes("E_REAL_SANDBOX_SETUP") && a6.error.message.includes("not a U4 slot") && !a6.stub.some((e) => e.event === "start") && (closedLb?.body as { reason?: string })?.reason === "not_u4" && !!b6.error?.message.includes("E_REAL_SANDBOX_SETUP") && b6.error.message.includes("registry") && !b6.events.includes("sandbox_open") && opensAfter === opensBefore);

    // U7: a driver killed mid-call, then relaunched for the same run.
    init("g-u7", 20, "plan-eng-review", "required");
    mark("g-u7", 1);
    mark("g-u7", 2);
    const E = await driver("e", "dryrun-u7", [{ item: "g-u7", arm: "plan-eng-review:told" }]);
    const step = async <T>(name: string, p: Promise<T>): Promise<T> => {
      try {
        return await p;
      } catch (e) {
        throw new Error("U7 " + name + ": " + (e as Error).message);
      }
    };
    const answer = (await step("open", fetch(E.control + "/sessions", { method: "POST", body: JSON.stringify({ trial: "u7", model: "claude-opus-5-5", cap_usd: 20, meta: { arm: "plan-eng-review:told", task: "t-u7", trial_n: 1 }, open_key: "u7", ledger: "u4" }) }).then((r) => r.json()))) as { base_url: string; token: string };
    const lab = label("dryrun-u7", "plan-eng-review:told", "t-u7", 1);
    const call = (n: number) => fetch(answer.base_url + "/v1/messages", { method: "POST", headers: { "content-type": "application/json", "x-api-key": answer.token, "anthropic-version": "2023-06-01" }, body: JSON.stringify({ model: "claude-opus-5-5", max_tokens: 32000, messages: [{ role: "user", content: "dryrun-call " + lab + " " + n }] }) });
    const first = await step("first call", call(1));
    hold = lab + " 2";
    void call(2).catch(() => null);
    for (let i = 0; i < 100 && !stubLog.some((e) => e.label === lab && e.n === 2); i++) await Bun.sleep(100);
    E.kill("SIGKILL");
    await E.exited;
    const E2 = await driver("e2", seed === "u7" ? "dryrun-u7b" : "dryrun-u7", [{ item: "g-u7", arm: "plan-eng-review:told" }]);
    const u7 = readItem(record, "g-u7");
    const c1 = u7.leases[0]?.close;
    const journal = join(W, "run-dryrun-u7", (u7.leases[0]?.lease.lease_id ?? "") + ".journal.ndjson");
    const requests = existsSync(journal) ? readFileSync(journal, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((e) => e.kind === "request") : [];
    const heldMax = requests[1]?.max_micros;
    const l2 = u7.leases[1]?.lease;
    if (E2.exit() === null) {
      await step("stop", fetch(E2.control + "/stop", { method: "POST" }));
      await within(E2.exited, 60_000);
    }
    rule("U7 a driver killed mid-call is recovered on relaunch for the same run", "STAGE_RECOVERED, lease 1 closed with the held call unknown at its full reservation, slot 2 opened on what is left", "first call " + first.status + ", " + (E2.err().includes("STAGE_RECOVERED item=g-u7") ? "STAGE_RECOVERED" : "no recovery (" + E2.err().split("\n")[0]!.slice(0, 120) + ")") + ", lease 1 " + (c1 ? "closed spent $" + c1.spent_micros / 1e6 + " unknown " + c1.unknown_calls + " at $" + c1.unknown_micros / 1e6 + " (held call reserved $" + (heldMax ?? 0) / 1e6 + ")" : "open") + ", lease 2 " + (l2 ? "$" + l2.reserved_micros / 1e6 : "none"), first.status === 200 && E2.err().includes("STAGE_RECOVERED item=g-u7") && !!c1 && c1.unknown_calls === 1 && c1.unknown_micros === heldMax && l2?.seq === 2 && l2.reserved_micros === 20e6 - c1.spent_micros - c1.unknown_micros);

    await fetch(A.control + "/stop", { method: "POST" });
    const aCode = await within(A.exited, 120_000);
    rule("U1b the batch driver stops and settles its three stages", "exit 0 and three STAGE_SETTLED lines", "exit " + aCode + ", " + A.err().split("\n").filter((l) => l.startsWith("STAGE_SETTLED")).length + " STAGE_SETTLED", aCode === 0 && A.err().split("\n").filter((l) => l.startsWith("STAGE_SETTLED")).length === 3);
    for (const id of leased.splice(0)) LG("settle", "--lease", id);
    db.close();

    // L7: every proxy lease, call by call, against the stub's own record.
    if (seed === "l7-extra" || seed === "l7-swap") {
      const rw = new Database(ledger);
      const lease = readItem(record, "g-pe").leases[0]!.lease.lease_id;
      const mine = (rw.query("SELECT rowid, * FROM reservations WHERE lease_id = ? AND state = 'settled' ORDER BY rowid").all(lease) as Array<Record<string, any>>).filter((r) => r.spent_micros > 0);
      if (seed === "l7-extra") rw.run("INSERT INTO reservations (reservation_id, idempotency_key, lease_id, cell, max_micros, state, spent_micros, usage, created_at) VALUES (?, ?, ?, ?, ?, 'settled', ?, ?, ?)", ["rsv_seed", "seed:1:1", lease, mine[0]!.cell, 700000, 412345, mine[0]!.usage, new Date().toISOString()]);
      else {
        rw.run("UPDATE reservations SET spent_micros = ?, usage = ? WHERE rowid = ?", [mine[1]!.spent_micros, mine[1]!.usage, mine[0]!.rowid]);
        rw.run("UPDATE reservations SET spent_micros = ?, usage = ? WHERE rowid = ?", [mine[0]!.spent_micros, mine[0]!.usage, mine[1]!.rowid]);
      }
      rw.close();
    }
    if (seed === "l7-missing") stubLog.splice(stubLog.findIndex((e) => e.kind === "answered" && e.label.startsWith(RUN + "/plan-eng-review:told/t-u3")), 1);
    const ro = new Database(ledger, { readonly: true });
    const labels = new Map<string, string>();
    for (const run of [RUN, "dryrun-u5", "dryrun-u7"]) for (const e of sessionsOf(run)) if (e.event === "open") labels.set(e.meter_id, label(run, e.arm, e.task, e.trial_n));
    const misses: string[] = [];
    let calls = 0;
    let streamed = 0;
    let unknowns = 0;
    let leases = 0;
    for (const item of ["g-none", "g-pe", "g-ap", "g-u5-none", "g-u5-pe", "g-u7"]) {
      for (const { lease, close } of readItem(record, item).leases) {
        leases++;
        const all = ro.query("SELECT idempotency_key, cell, state, max_micros, spent_micros, usage FROM reservations WHERE lease_id = ?").all(lease.lease_id) as Array<Record<string, any>>;
        const released = (r: Record<string, any>) => r.state === "settled" && r.spent_micros === 0 && Object.values(JSON.parse(r.usage ?? "{}") as Record<string, number>).every((v) => v === 0);
        let priced = 0;
        let unknownMicros = 0;
        const byMeter = new Map<string, Array<Record<string, any>>>();
        for (const r of all.filter((r) => !released(r))) {
          const m = JSON.parse(r.cell).meter_id as string;
          byMeter.set(m, [...(byMeter.get(m) ?? []), r]);
        }
        for (const [meter, list] of byMeter) {
          const lab = labels.get(meter);
          if (!lab) {
            misses.push(lease.lease_id + ": meter " + meter + " has no session open in sessions.jsonl");
            continue;
          }
          const order = (r: Record<string, any>) => Number(String(r.idempotency_key).split(":")[1]);
          const settledRows = list.filter((r) => r.state === "settled").sort((a, b) => order(a) - order(b));
          const answers = stubLog.filter((e) => e.kind === "answered" && e.label === lab).sort((a, b) => a.n - b.n);
          if (settledRows.length !== answers.length) misses.push(lab + ": the ledger settled " + settledRows.length + " calls and the stub answered " + answers.length);
          settledRows.forEach((r, i) => {
            const a = answers[i];
            const u = JSON.parse(r.usage) as Record<string, number>;
            if (!a) return;
            const want = price(a.usage!);
            if (u.input !== a.usage!.input_tokens || u.output !== a.usage!.output_tokens || u.reasoning !== 0 || u.cache_read !== a.usage!.cache_read_input_tokens || u.cache_write !== a.usage!.cache_creation_input_tokens) misses.push(lab + " call " + a.n + ": the ledger's usage " + r.usage + " is not the stub's " + JSON.stringify(a.usage));
            else if (r.spent_micros !== want) misses.push(lab + " call " + a.n + ": the ledger charged " + r.spent_micros + " micro-dollars, the frozen row prices " + want);
            priced += want;
            calls++;
            if (a.stream) streamed++;
          });
          for (const r of list.filter((r) => r.state === "unknown")) {
            const received = stubLog.filter((e) => e.kind === "received" && e.label === lab && e.n === order(r));
            const answered = stubLog.some((e) => e.kind === "answered" && e.label === lab && e.n === order(r));
            if (!received.length || answered) misses.push(lab + " call " + order(r) + ": held as unknown, but the stub " + (answered ? "answered it" : "never received it"));
            unknownMicros += r.max_micros;
            unknowns++;
          }
        }
        if (!close) misses.push(lease.lease_id + " is not closed");
        else if (close.spent_micros !== priced || close.unknown_micros !== unknownMicros) misses.push(lease.lease_id + " closed at $" + close.spent_micros / 1e6 + " spent and $" + close.unknown_micros / 1e6 + " unknown; the priced calls total $" + priced / 1e6 + " and the unknown reservations $" + unknownMicros / 1e6);
      }
    }
    ro.close();
    rule("L7 every proxy lease matches the stub's record call by call, priced from the frozen row", "each settled call's usage and charge equal the stub's answer, each unknown call a request the stub never answered, each close their sum", leases + " leases, " + calls + " calls (" + streamed + " streamed, " + (calls - streamed) + " JSON), " + unknowns + " unknown" + (misses.length ? "; " + misses.length + " misses: " + misses.slice(0, 3).join("; ") : ""), misses.length === 0 && calls > 0 && streamed > 0 && streamed < calls && unknowns === 1);

    // R1 to R4: GST-1374's refusals.
    const refused = (fn: () => unknown, text: string) => {
      try {
        fn();
        return false;
      } catch (e) {
        return (e as Error).message.includes(text);
      }
    };
    const good = { MULT: 5, M_PER: 2.2, M_AP: 5, AUTH_PAID: 1.39 };
    const without = (k: keyof typeof good) => Object.fromEntries(Object.entries(good).filter(([key]) => key !== k)) as typeof good;
    rule("R1 a missing M_PER, M_AP or AUTH_PAID is refused", "three refusals naming the missing value", (["M_PER", "M_AP", "AUTH_PAID"] as const).map((k) => k + (refused(() => meteredPricer(without(k)), k + " is missing") ? " refused" : " accepted")).join(", "), (["M_PER", "M_AP", "AUTH_PAID"] as const).every((k) => refused(() => meteredPricer(without(k)), k + " is missing")));
    const agent = (v: string) => {
      process.env.AGENT_USER = v;
      try {
        return refused(() => meteredPricer(good), "AGENT_USER is set");
      } finally {
        delete process.env.AGENT_USER;
      }
    };
    rule("R2 AGENT_USER set to 9.99 is refused", "refused", agent("9.99") ? "refused" : "accepted", agent("9.99"));
    rule("R3 AGENT_USER set but empty is refused", "refused", agent("") ? "refused" : "accepted", agent(""));
    const t = spawnSync(process.execPath, ["test", join(ROOT, "tests/stats/g-admission.test.ts"), "-t", "no scored trial"], { cwd: ROOT, env: ENV, encoding: "utf8" });
    const passN = Number(/(\d+) pass/.exec(t.stderr + t.stdout)?.[1] ?? 0);
    rule("R4 admitG refuses a told arm with no scored trial (GST-1374's tests)", "2 pass, 0 fail", passN + " pass, exit " + t.status, t.status === 0 && passN === 2);
    if (seed === "z1-lease") {
      init("g-z1", 5, "plan-eng-review", "warn");
      LG("lease", "--item", "g-z1", "--run", "dryrun-z1");
    }
  } catch (e) {
    ok = false;
    if (!(e instanceof Miss)) console.log("FAIL dry run: " + (e as Error).message);
  } finally {
    for (const r of release.splice(0)) r();
    for (const d of drivers) if (d.exit() === null) d.kill("SIGTERM");
    for (const d of drivers) if ((await within(d.exited, 60_000)) === null) d.kill("SIGKILL");
    for (const p of procs) if (p.exitCode === null && p.signalCode === null) p.kill("SIGKILL");
    for (const id of leased) LG("settle", "--lease", id);
    stub.stop(true);
    laneb.stop(true);
    docker("rm", "-f", box);
    docker("volume", "rm", vol);
    const names = docker("ps", "-a", "--format", "{{.Names}}");
    const vols = docker("volume", "ls", "--format", "{{.Name}}");
    const containers = names.status === 0 ? names.stdout.split("\n").filter((n) => Z1_PREFIXES.some((p) => n.startsWith(p))) : null;
    const volumes = vols.status === 0 ? vols.stdout.split("\n").filter((n) => n.startsWith("gstack-mutation-")) : null;
    let open: string[] | null = null;
    try {
      open = ledgerStatus(record).flatMap((i) => (i.open_lease ? [i.open_lease.lease_id] : []));
    } catch {}
    const z1 = containers !== null && volumes !== null && open !== null && containers.length + volumes.length + open.length === 0;
    console.log((z1 ? "PASS " : "FAIL ") + "Z1 no leftovers after every child is reaped: expected 0 containers named " + Z1_PREFIXES.map((p) => p + "*").join(", ") + ", 0 volumes named gstack-mutation-*, 0 open leases; got " + (containers === null ? "docker unavailable" : containers.length + " containers" + (containers.length ? " (" + containers.join(", ") + ")" : "")) + ", " + (volumes === null ? "docker unavailable" : volumes.length + " volumes" + (volumes.length ? " (" + volumes.join(", ") + ")" : "")) + ", " + (open === null ? "unreadable record" : open.length + " open leases" + (open.length ? " (" + open.join(", ") + ")" : "")));
    ok &&= z1;
    for (const c of leaks.containers) docker("rm", "-f", c);
    docker("volume", "rm", leaks.volume);
    if (ok) rmSync(W, { recursive: true, force: true });
  }
  console.log("DRYRUN: " + (ok ? "ok" : "fail"));
  return ok ? 0 : 1;
}

if (process.argv[2] === "--child") process.exit(await child(JSON.parse(readFileSync(process.argv[3]!, "utf8")) as ChildConfig));
else if (import.meta.main) process.exit(await main(process.argv.slice(2)));
