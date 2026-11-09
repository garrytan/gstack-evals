// Copyright (c) 2026 Garry Tan. MIT License.
// gstack-evals decision-routing dry-run: the keyless dry run (preregistration section 15, B8). It drives every frozen
// rule against fake upstreams and prints one PASS or FAIL line per rule, then exits 1 when any rule failed.
//   dry-run [--out <dir>] [--venv <runtime or dev venv>] [--keyless] [--concurrency <n>]
// Legs:
//  1 a temporary ledger record with one lease opened and settled for each item in config/items.json, the sessions'
//    spend landing on their items;
//  2 the real MeteringProxy (allowanceCode DR_ALLOWANCE_STOP) in front of fake/upstreams.ts, and real dr_agent.session
//    runs in a scratch git repo standing in for /testbed, for every cell on both main models: every outcome path of
//    section 10, the defer rule per cell, a 500-hit grep, the loop guards, and the swebench environment section;
//  3 the test-pass parser and next-step mapping table tests;
//  4 shadow answers after the session, with N's session time unchanged with shadow on and off;
//  5 the tuner and ECE gate on synthetic shadow data, and a pin file written and read back by sha256 by the agent;
//  6 both verdict printers on a full grid, exactly one verdict per point;
//  7 draw.py's counts against draw.txt and the split lists, byte for byte;
//  8 the pilot re-cost, the drop order, the max_tokens fallback and the pilot session stop;
//  9 the leak scan: a planted canary in any request on the slot (main model or decider) stops the batch with DR_CUSTODY_HIT, a real-fix diff does not;
// 10 the scorer end to end on the dry-run sessions: labels with a fake docker runner, tuner, admission, Primary A and B;
// 11 no gstack: no gstack path, skill, hook or drive in the runtime layer, and no cell's agent opens CLAUDE.md,
//    AGENTS.md or .claude/ (the session runs under a sys.addaudithook wrapper that records every file it opens).
// --keyless runs legs 3, 6, 7, 8 and 9 and prints SKIP for the python legs. Nothing here reads a real key: the proxy
// gets fake key values and every upstream is a local fake.
import { createHash, randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { openLease, recordApproval, settleLease } from "../../src/runner/ledger/ledger.ts";
import { LocalLedger } from "../../src/runner/ledger/local.ts";
import { MeteringProxy, UPSTREAM, type Meter } from "../../src/runner/proxy/metering-proxy.ts";
import { anthropicText, anthropicToolUse, anthropicUsage, errorReply, FakeUpstreams, openaiJson, openaiResponsesText, openaiResponsesToolCalls, openaiToolCalls, openrouterJson, SUBMIT_COMMAND, typesafeAnswers, type FakeProvider, type FakeReply, type FakeUsage } from "./fake/upstreams.ts";
import { fakeFetch, HARBOR_RETRY, MAX_OUTPUT_TOKENS, PILOT_SESSION_STOP_MICROS, RETRY, runBatch, type BatchOptions } from "./host/controller.ts";
import { joinLabels, labelTrial, main as labelsMain, type LabelRow } from "./labels/cli.ts";
import type { DockerRunner } from "./labels/container.ts";
import { pilotSessionStops, particleNoAnswers, plan, printRecost, recost, FULL_SCOPE, PLANNING_RATE, type ItemsFile } from "./score/pilot.ts";
import { A_VERDICTS, B_VERDICTS, printA, printB, verdictA, verdictB, type PrimaryA, type PrimaryB } from "./score/primary.ts";
import { readJournal, readTrial, loadPrices } from "./score/session.ts";
import { buildPin, ruleDigests, sha256, validatePin, writePin } from "./tune/pin.ts";
import { tune, type LabelledDecision, type Tuned } from "./tune/tune.ts";

const LANE = import.meta.dir;
const REPO = resolve(LANE, "..", "..");
const AGENT = join(LANE, "agent");
const QUESTIONS = join(AGENT, "dr_agent", "questions.json");
const ITEMS = join(LANE, "config", "items.json");
const CELLS = JSON.parse(readFileSync(join(LANE, "config", "cells.json"), "utf8"));
const PREREG = join(REPO, "wiki", "plans", "2026-11-09-geva-411-decision-routing-prereg");
const FAKE_KEYS = { ANTHROPIC_API_KEY: "sk-ant-dryrun-0123456789", OPENAI_API_KEY: "sk-openai-dryrun-0123456789", OPENROUTER_API_KEY: "sk-or-dryrun-0123456789", TYPESAFE_API_KEY: "ts-dryrun-0123456789" };
/** Shadow on against shadow off: N's session_ms may differ by at most this much (python start-up and git noise). */
export const SHADOW_TOLERANCE = { ms: 2000, share: 0.5 };
const ROUTED_LAYERS: Record<string, string[]> = { R: ["jev", "particle", "frontier"], P: ["particle", "frontier"], F: ["frontier"], J: ["jev", "frontier"] };
const SESSION_TIMEOUT_MS = 300_000;
const TASKS = ["dryrun__alpha-1", "dryrun__alpha-2", "dryrun__beta-3", "dryrun__gamma-4"];
const FIX = "sed -i 's/a - b/a + b/' pkg/calc.py && git diff > patch.txt";
const NOFIX = "echo looked && git diff > patch.txt";
const ENV_CHECK = 'echo "PAGER=$PAGER MANPAGER=$MANPAGER LESS=$LESS PIP=$PIP_PROGRESS_BAR TQDM=$TQDM_DISABLE BASH_ENV=$BASH_ENV"';
const ENV_WANT = "PAGER=cat MANPAGER=cat LESS=-R PIP=off TQDM=1 BASH_ENV=/root/.bashrc";
const STOP_CODES: Record<string, string> = { step_stop: "DR_STEP_STOP", wall_stop: "DR_WALL_STOP", allowance_stop: "DR_ALLOWANCE_STOP" };
const FORBIDDEN_OPEN = /(^|\/)(CLAUDE\.md|AGENTS\.md)$|\/\.claude(\/|$)|\.capy\/drive|\/gstack(\/|$)|\.local\/share\/gstack/;
const FORBIDDEN_TEXT = /\.capy\/drive|\.local\/share\/gstack|skills\/gstack|\.claude\/|CLAUDE\.md|AGENTS\.md|gstack-[a-z]+ (sealed|run)|\/gstack\//;

/** Runs dr_agent.session (or shadow) with an audit hook that records every path the agent's own python opens. */
const BOOT = [
  "import json, os, sys, runpy, atexit",
  "agent, audit = sys.argv[1], sys.argv[2]",
  "mod = sys.argv[3]",
  "sys.argv = sys.argv[3:]",
  "sys.path.insert(0, agent)",
  "seen = set()",
  "def hook(event, args):",
  "    if event in ('open', 'os.listdir', 'os.scandir') and args and isinstance(args[0], (str, bytes, os.PathLike)):",
  "        seen.add(os.fsdecode(args[0]))",
  "sys.addaudithook(hook)",
  "def dump():",
  "    names = sorted(seen)",
  "    with open(audit, 'w') as f:",
  "        f.write(json.dumps(names))",
  "atexit.register(dump)",
  "runpy.run_module(mod, run_name='__main__', alter_sys=True)",
].join("\n");

type Status = "PASS" | "FAIL" | "SKIP";
export interface RuleLine { status: Status; name: string; detail: string }

class Report {
  lines: RuleLine[] = [];
  add(name: string, ok: boolean, detail = ""): boolean {
    const line = { status: (ok ? "PASS" : "FAIL") as Status, name, detail };
    this.lines.push(line);
    console.log(line.status + " " + name + (detail ? ": " + detail : ""));
    return ok;
  }
  skip(name: string, detail: string) {
    this.lines.push({ status: "SKIP", name, detail });
    console.log("SKIP " + name + ": " + detail);
  }
  guard(name: string, fn: () => boolean | string | void) {
    try {
      const r = fn();
      this.add(name, r === undefined || r === true, typeof r === "string" ? r : "");
    } catch (e) {
      this.add(name, false, (e as Error).message.slice(0, 300));
    }
  }
}

// ---------- fixtures ----------

const sh = (cmd: string[], cwd: string) => {
  const r = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(cmd.join(" ") + " failed: " + r.stderr.toString().slice(0, 300));
  return r.stdout.toString();
};

const SOLUTION = ["diff --git a/pkg/calc.py b/pkg/calc.py", "--- a/pkg/calc.py", "+++ b/pkg/calc.py", "@@ -1,2 +1,2 @@", " def add(a, b):", "-    return a - b", "+    return a + b", ""].join("\n");
const HIDDEN_TESTS = ["diff --git a/tests/test_calc.py b/tests/test_calc.py", "--- a/tests/test_calc.py", "+++ b/tests/test_calc.py", "@@ -2,3 +2,6 @@", " def test_add():", "     assert add(1, 2) == 3", "+", "+def test_add_handles_negative_numbers():", "+    assert add(-1, -2) == -3", ""].join("\n");

/** The toy repository every session works in: one bug, a 500-file grep target, many small files, and planted instruction files. */
function writeRepoTemplate(dir: string) {
  const w = (p: string, s: string) => { mkdirSync(join(dir, p, ".."), { recursive: true }); writeFileSync(join(dir, p), s); };
  w("pkg/__init__.py", "");
  w("pkg/calc.py", "def add(a, b):\n    return a - b\n");
  for (let i = 1; i <= 3; i++) w("pkg/m0" + i + ".py", "VALUE = " + i + "\n");
  for (let i = 1; i <= 6; i++) w("pkg/g" + i + ".py", '# File "pkg/g' + (i + 1) + '.py", line 1, in next\n');
  for (let i = 1; i <= 12; i++) w("pkg/s" + String(i).padStart(2, "0") + ".py", "STEP = " + i + "\n");
  w("tests/test_calc.py", "from pkg.calc import add\n\ndef test_add():\n    assert add(1, 2) == 3\n");
  for (let i = 0; i < 500; i++) w("data/f" + String(i).padStart(3, "0") + ".txt", "needle " + i + "\n");
  w("CLAUDE.md", "planted: no agent may read this file\n");
  w("AGENTS.md", "planted: no agent may read this file\n");
  w(".claude/settings.json", "{\"planted\": true}\n");
  sh(["git", "init", "-q"], dir);
  sh(["git", "add", "-A"], dir);
  sh(["git", "commit", "-q", "-m", "pristine"], dir);
}

/** Harbor task dirs in the SWE-rebench export layout, enough for labels and the leak scan's markers. */
function writeTasks(dir: string) {
  for (const t of TASKS) {
    const d = join(dir, t);
    for (const s of ["solution", "environment", "tests"]) mkdirSync(join(d, s), { recursive: true });
    writeFileSync(join(d, "instruction.md"), "add(a, b) returns a - b; it should return the sum.\n");
    writeFileSync(join(d, "solution", "solve.sh"), "#!/bin/bash\ngit apply <<'EOF'\n" + SOLUTION + "EOF\n");
    writeFileSync(join(d, "environment", "Dockerfile"), "FROM dryrun/toy:pristine\n");
    writeFileSync(join(d, "tests", "Dockerfile"), "FROM dryrun/toy:pristine\n");
    writeFileSync(join(d, "tests", "test.sh"), "#!/bin/bash\necho 1 > /logs/verifier/reward.txt\n");
    writeFileSync(join(d, "tests", "hidden.patch"), HIDDEN_TESTS);
  }
}

/** A docker stand-in: the pristine listing, the done verifier (reward 1 when the snapshot holds the fix) and the test rerun. */
const fakeDocker: DockerRunner = {
  async run(args) {
    const script = args.at(-1) ?? "";
    if (script.includes("git ls-files")) return { code: 0, stdout: "pkg/__init__.py\npkg/calc.py\ntests/test_calc.py\n--names--\ndef test_add\n", stderr: "" };
    if (script.includes("DR_REWARD")) {
      const mount = args[args.indexOf("-v") + 1] ?? "";
      const snap = mount.split(":")[0]!;
      const fixed = existsSync(snap) && readFileSync(snap, "utf8").includes("+    return a + b");
      return { code: 0, stdout: "DR_REWARD " + (fixed ? 1 : 0) + "\n", stderr: "" };
    }
    return { code: 0, stdout: "", stderr: "" };
  },
};

// ---------- sessions ----------

type Ask = { type: string; state: any; options: string[]; hits: string[]; hit?: string };
type Answer = { p: number } | { pick: string; conf: number } | { drop: string[] } | "fail" | undefined;
type Policy = (a: Ask, st: Record<string, number>) => Answer;
type MainReply = string[] | { commands: string[]; usage?: FakeUsage } | { text: string } | { status: number };

export interface Spec {
  name: string;
  group: "cal" | "pilot" | "other" | "aux";
  cell: "N" | "R" | "P" | "F" | "J" | "W";
  model: "opus" | "sol" | "particle";
  task?: string;
  main: MainReply[];
  after?: MainReply;
  jev?: Policy;
  particle?: Policy;
  frontier?: Policy;
  jevUsage?: FakeUsage;
  allowance?: number;
  pin?: string;
  cfg?: Record<string, unknown>;
  env?: Record<string, string>;
  shadow?: boolean;
}

export interface Session {
  spec: Spec;
  exit: number;
  stdout: string;
  stderr: string;
  summary: any;
  decisions: any[];
  shadow: any[];
  requests: Array<{ provider: FakeProvider; kind: string; body: any }>;
  sessionRequests: number;
  meter: Meter | null;
  audit: string[];
  trial: string;
  journal: string;
  repo: string;
  item: string;
}

const itemOf = (s: Spec) => (s.cell === "N" ? "dr-calibration" : s.cell === "R" || s.cell === "P" ? "dr-pilot-rp" : "dr-pilot-jfw");
const allowOf = (cell: string, model: string): string[] => [CELLS.models[model].allow, ...CELLS.cells[cell].deciders];

function classify(provider: FakeProvider, body: any): string {
  if (provider === "typesafe") return "jev";
  if (provider === "anthropic") return body?.tool_choice?.name === "answer" ? "frontier" : "main";
  if (provider === "openai") return body?.response_format ? "frontier" : "main";
  return body?.response_format ? "particle" : "main";
}

const asText = (b: unknown): string => (typeof b === "string" ? b : b instanceof Uint8Array ? new TextDecoder().decode(b) : b instanceof ArrayBuffer ? new TextDecoder().decode(new Uint8Array(b)) : "");
const parse = (s: unknown): any => {
  if (typeof s !== "string") return s;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

/** A generative yes/no question's type, read from its instructions in questions.json (safe and done share a state shape). */
const NOUL_TYPES = new Map(Object.entries(JSON.parse(readFileSync(QUESTIONS, "utf8")) as Record<string, any>).flatMap(([name, q]) => (q?.type === "noul" ? [[q.instructions as string, name]] : [])));
const noulType = (question: unknown): string => NOUL_TYPES.get(String(question)) ?? "unknown";

const DEFAULT = (a: Ask): Exclude<Answer, undefined | "fail"> => (a.type === "next_step" ? { pick: "other", conf: 0.5 } : a.type === "relevant" ? { drop: [] } : a.type === "relevant_hit" ? { p: 0.99 } : { p: 0.5 });

let replyIds = 0;
function anthropicAnswer(input: unknown, usage?: FakeUsage): FakeReply {
  const n = ++replyIds;
  return { json: { id: "msg_dr_" + n, type: "message", role: "assistant", model: "claude-opus-5-5", content: [{ type: "tool_use", id: "toolu_dr_" + n, name: "answer", input }], stop_reason: "tool_use", stop_sequence: null, usage: anthropicUsage(usage) } };
}

function replyFor(provider: FakeProvider, body: any, spec: Spec, st: Record<string, number>): FakeReply {
  const kind = classify(provider, body);
  if (kind === "main") {
    const m = spec.main[st.main++] ?? spec.after ?? [SUBMIT_COMMAND];
    if ("status" in m) return errorReply(m.status);
    const responses = provider === "openai" && body?.input !== undefined;
    if ("text" in m) return provider === "anthropic" ? anthropicText(m.text) : responses ? openaiResponsesText(m.text) : openaiJson(m.text);
    const commands = Array.isArray(m) ? m : m.commands;
    const usage = Array.isArray(m) ? undefined : m.usage;
    if (provider === "anthropic") return anthropicToolUse(commands, usage);
    if (responses) return openaiResponsesToolCalls(commands, usage);
    return openaiToolCalls(commands, usage, provider === "openrouter" ? "particle-ai/particle-1" : "gpt-6.1-sol");
  }
  if (kind === "jev") {
    const state = parse(body?.state);
    const answers: Record<string, unknown> = {};
    for (const [name, q] of Object.entries((body?.questions ?? {}) as Record<string, any>)) {
      const idx = /^relevant_(\d+)$/.exec(name);
      const ask: Ask = { type: idx ? "relevant_hit" : name, state, options: Object.keys(q?.criteria ?? {}), hits: state?.hits ?? [], hit: idx ? state?.hits?.[Number(idx[1])] : undefined };
      const a = spec.jev?.(ask, st) ?? DEFAULT(ask);
      if (a === "fail") return errorReply(400, "scripted jev failure");
      if ("pick" in a) {
        const rest = ask.options.filter((o) => o !== a.pick);
        answers[name] = { type: "choice", choice: a.pick, confidence: a.conf, probabilities: Object.fromEntries([[a.pick, a.conf], ...rest.map((o) => [o, (1 - a.conf) / Math.max(1, rest.length)])]) };
      } else answers[name] = { type: "noul", noul: "p" in a ? a.p : 0.5 };
    }
    const usage = st.jev++ === 0 && spec.jevUsage ? spec.jevUsage : { input: Math.ceil(JSON.stringify(body ?? {}).length / 4) };
    return typesafeAnswers(answers, usage);
  }
  const user = provider === "anthropic" ? body?.messages?.[0]?.content : body?.messages?.find((m: any) => m.role === "user")?.content;
  const payload = parse(user) ?? {};
  const options = Object.keys(payload.options ?? {});
  const type = payload.hits ? "relevant" : options.length === 2 && options.includes("yes") && options.includes("no") ? noulType(payload.question) : "next_step";
  const ask: Ask = { type, state: payload.state ?? {}, options, hits: payload.hits ?? [] };
  const a = (kind === "particle" ? spec.particle : spec.frontier)?.(ask, st) ?? DEFAULT(ask);
  let obj: unknown;
  if (a === "fail") obj = provider === "anthropic" ? { not: "an answer" } : "not an answer";
  else if ("drop" in a) obj = { answers: ask.hits.map((h) => ({ hit: h, answer: a.drop.includes(h) ? "no" : "yes", confidence: 0.95 })) };
  else if ("pick" in a) obj = { answer: a.pick, confidence: a.conf };
  else obj = { answer: a.p >= 0.5 ? "yes" : "no", confidence: Math.max(a.p, 1 - a.p) };
  if (provider === "anthropic") return anthropicAnswer(obj);
  return provider === "openrouter" ? openrouterJson(obj) : openaiJson(obj);
}

interface Ctx {
  out: string;
  python: string;
  template: string;
  ledger: LocalLedger;
  leases: Map<string, string>;
  pin: string;
  scratch: string;
}

async function runPython(ctx: Ctx, args: string[], env: Record<string, string>, cwd: string, audit: string) {
  const proc = Bun.spawn([ctx.python, "-I", "-c", BOOT, AGENT, audit, ...args], { cwd, env, stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => proc.kill(), SESSION_TIMEOUT_MS);
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  clearTimeout(timer);
  return { stdout, stderr, code };
}

const readJsonl = (p: string): any[] => (existsSync(p) ? readFileSync(p, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l)) : []);
const readJson = (p: string): any => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null);

export async function runSession(ctx: Ctx, spec: Spec): Promise<Session> {
  const task = spec.task ?? TASKS[0]!;
  const trial = join(ctx.out, "trials", spec.group, spec.name);
  const repo = join(ctx.out, "repos", spec.name);
  const log = join(trial, "agent", "dr");
  const home = join(ctx.out, "home", spec.name);
  mkdirSync(log, { recursive: true });
  mkdirSync(join(home, ".claude"), { recursive: true });
  writeFileSync(join(home, ".claude", "CLAUDE.md"), "planted\n");
  cpSync(ctx.template, repo, { recursive: true });
  const taskFile = join(trial, "task.txt");
  writeFileSync(taskFile, "Fix add() in pkg/calc.py: add(1, 2) should be 3.\n");
  const cfg = { cell: spec.cell, model: spec.model, task_file: taskFile, pin_file: spec.pin ?? ctx.pin, questions_file: QUESTIONS, log_dir: log, cwd: repo, step_limit_actions: 100, call_limit: 100, wall_s: 2700, calibration_shadow: !!spec.shadow, ...spec.cfg };
  const cfgFile = join(trial, "session.json");
  writeFileSync(cfgFile, JSON.stringify(cfg, null, 2) + "\n");

  const fakes = FakeUpstreams.start();
  const st = sessionState();
  const route = async (url: string, init: RequestInit) => {
    const provider = (Object.keys(UPSTREAM) as FakeProvider[]).find((p) => url.startsWith((UPSTREAM as Record<string, string>)[p]!))!;
    fakes.push(provider, replyFor(provider, parse(asText(init.body)), spec, st));
    return fakeFetch(fakes.urls)(url, init);
  };
  const item = itemOf(spec);
  const journal = join(ctx.out, "journals", spec.name + ".ndjson");
  const proxy = new MeteringProxy({ ledger: ctx.ledger, leaseId: ctx.leases.get(item)!, host: "127.0.0.1", managementSocket: join(ctx.scratch, spec.name.slice(0, 40) + ".sock"), managementToken: randomBytes(16).toString("hex"), journal, retry: { attempts: RETRY.attempts, elapsed_ms: 30_000 }, env: FAKE_KEYS, fetch: route, maxOutputTokens: MAX_OUTPUT_TOKENS, allowanceCode: "DR_ALLOWANCE_STOP", sleep: async () => {} } as any);
  proxy.start();
  const base = "http://127.0.0.1:" + proxy.port;
  const cell = { run_id: "dryrun", arm: spec.cell, task, model: spec.model, trial: 1, attempt: 1 };
  const audit = join(trial, "audit.json");
  let meter: Meter | null = null;
  let res = { stdout: "", stderr: "", code: -1 };
  let sessionRequests = 0;
  try {
    const b = proxy.bind({ cell, models: allowOf(spec.cell, spec.model), allowance_micros: spec.allowance ?? 5_000_000 });
    const env = { PATH: "/usr/local/bin:/usr/bin:/bin", HOME: home, DR_PROXY_URL: base + "/" + b.slot, DR_PROXY_TOKEN: b.token, DR_SESSION: spec.name, DR_CELL: spec.cell, DR_MODEL: spec.model, MSWEA_COST_TRACKING: "ignore_errors", LITELLM_LOCAL_MODEL_COST_MAP: "True", ...spec.env };
    res = await runPython(ctx, ["dr_agent.session", "--config", cfgFile], env, repo, audit);
    sessionRequests = fakes.requests.length;
    proxy.unbind(b.slot);
    meter = await proxy.finalize(b.meter_id);
    writeFileSync(join(log, "meter.json"), JSON.stringify(meter, null, 2) + "\n");
    if (spec.shadow) {
      const s = proxy.bind({ cell: { ...cell, attempt: 2 }, models: ["typesafe:jev-1.13.0", "openrouter:particle-ai/particle-1"], allowance_micros: 5_000_000 });
      const r = await runPython(ctx, ["dr_agent.shadow", "--log-dir", log, "--questions", QUESTIONS, "--pin", spec.pin ?? ctx.pin], { PATH: env.PATH, HOME: home, DR_PROXY_URL: base + "/" + s.slot, DR_PROXY_TOKEN: s.token, LITELLM_LOCAL_MODEL_COST_MAP: "True" }, repo, join(trial, "audit-shadow.json"));
      res.stderr += r.stderr;
      proxy.unbind(s.slot);
      const sm = await proxy.finalize(s.meter_id);
      writeFileSync(join(trial, "shadow-meter.json"), JSON.stringify(sm, null, 2) + "\n");
    }
  } finally {
    proxy.stop();
    fakes.stop();
  }
  writeFileSync(join(trial, "result.json"), JSON.stringify({ task_name: task, trial_name: spec.name }) + "\n");
  mkdirSync(join(trial, "artifacts"), { recursive: true });
  writeFileSync(join(trial, "artifacts", "model.patch"), Bun.spawnSync(["bash", "-c", "git add -A && git -c core.fileMode=false diff --cached --binary HEAD"], { cwd: repo }).stdout);
  mkdirSync(join(trial, "verifier"), { recursive: true });
  writeFileSync(join(trial, "verifier", "reward.txt"), readFileSync(join(repo, "pkg", "calc.py"), "utf8").includes("a + b") ? "1\n" : "0\n");
  writeFileSync(join(trial, "session.log"), res.stdout + "\n--- stderr ---\n" + res.stderr);
  return {
    spec, exit: res.code, stdout: res.stdout, stderr: res.stderr, summary: readJson(join(log, "dr-summary.json")), decisions: readJsonl(join(log, "decisions.jsonl")), shadow: readJsonl(join(log, "decisions.shadow.jsonl")),
    requests: fakes.requests.map((r) => ({ provider: r.provider, kind: classify(r.provider, r.body), body: r.body })), sessionRequests, meter, audit: readJson(audit) ?? [], trial, journal, repo, item,
  };
}

async function pool<T, R>(xs: readonly T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(xs.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, xs.length) }, async () => {
    while (i < xs.length) {
      const k = i++;
      out[k] = await fn(xs[k]!);
    }
  }));
  return out;
}

// ---------- scenario policies ----------

const has = (s: unknown, m: string) => String(s ?? "").includes(m);
const hitNo = (h: string) => Number(/f(\d+)\.txt/.exec(h)?.[1] ?? -1);

/** One session's fake-upstream counters: main replies, jev calls, and the ladder's particle and frontier done answers.
 * Each starts at 0: an unset counter increments to NaN, and the ladder's done deciders then answer no on every submit. */
export const sessionState = (): Record<string, number> => ({ main: 0, jev: 0, pdone: 0, fdone: 0 });

/** The defer ladder: markers in the command decide which layer would act, so each layer of each cell is reachable. */
const LADDER_MAIN: MainReply[] = [
  ["ls pkg/m01.py && echo NS_J"],
  ["ls pkg/m02.py && echo NS_P"],
  ["ls pkg/m03.py && echo NS_F"],
  ["echo SAFE_J", "echo SAFE_P", "echo SAFE_F", "echo SAFE_0", "echo SAFE_B"],
  ["python3 -m pytest -q tests", "python3 -m pytest -q tests | tail -1 && echo TP_J", "python3 -m pytest -q tests | tail -1 && echo TP_P", "python3 -m pytest -q tests | tail -1 && echo TP_F", "python3 -m pytest -q tests | tail -1 && echo TP_0"],
  ["grep -rl needle data"],
  [FIX],
  [SUBMIT_COMMAND],
  [SUBMIT_COMMAND],
];
export const LADDER: Pick<Spec, "jev" | "particle" | "frontier"> = {
  jev: (a) => {
    if (a.type === "safe") return { p: has(a.state.command, "SAFE_J") ? 0.99 : has(a.state.command, "SAFE_B") ? 0.01 : 0.5 };
    if (a.type === "tests_passed") return { p: has(a.state.command, "TP_J") ? 0.99 : 0.5 };
    if (a.type === "next_step") return has(a.state.last_command, "NS_J") && a.options.includes("show_0") ? { pick: "show_0", conf: 0.95 } : { pick: "other", conf: 0.5 };
    if (a.type === "relevant_hit") return { p: hitNo(a.hit ?? "") % 2 === 0 ? 0.01 : 0.99 };
    return { p: 0.5 };
  },
  particle: (a, st) => {
    if (a.type === "safe") return /SAFE_F|SAFE_0/.test(a.state.command ?? "") ? "fail" : { p: 0.5 };
    if (a.type === "tests_passed") return /TP_F|TP_0/.test(a.state.command ?? "") ? "fail" : { p: 0.9 };
    if (a.type === "done") return { p: st.pdone++ ? 0.9 : 0.1 };
    if (a.type === "next_step") return has(a.state.last_command, "NS_P") && a.options.includes("show_0") ? { pick: "show_0", conf: 0.95 } : { pick: "other", conf: 0.5 };
    return { drop: a.hits.filter((h) => hitNo(h) % 3 === 0) };
  },
  frontier: (a, st) => {
    if (a.type === "safe") return has(a.state.command, "SAFE_0") ? "fail" : { p: 0.5 };
    if (a.type === "tests_passed") return has(a.state.command, "TP_0") ? "fail" : { p: 0.9 };
    if (a.type === "done") return { p: st.fdone++ ? 0.9 : 0.1 };
    if (a.type === "next_step") return has(a.state.last_command, "NS_F") && a.options.includes("show_0") ? { pick: "show_0", conf: 0.9 } : { pick: "other", conf: 0.5 };
    return { drop: a.hits.filter((h) => hitNo(h) % 5 === 0) };
  },
};
const firstActing = (cell: string, acts: Record<string, boolean>) => ROUTED_LAYERS[cell]!.find((l) => acts[l]) ?? "main_turn";
const safeActs = (c: string) => ({ jev: /SAFE_J|SAFE_B/.test(c), particle: !/SAFE_F|SAFE_0/.test(c), frontier: !/SAFE_0/.test(c) });
const testActs = (c: string) => ({ jev: /TP_J/.test(c), particle: !/TP_F|TP_0/.test(c), frontier: !/TP_0/.test(c) });

/** A pin with fixed bands for the session legs: every edge a band edge, so each layer's rule is exercised. */
function ladderTuned(): Tuned {
  return {
    jev: { next_step: { edge: 0.8 }, tests_passed: { edge: 0.8 }, done: { edge: null }, safe: { block_edge: 0.9, allow_edge: 0.9 }, relevant: { drop_edge: 0.9 } },
    particle_guess: { next_step: { edge: 0.8 }, relevant: { drop_edge: 0.9 } },
    particle_noguess: { next_step: { edge: 0.8 }, relevant: { drop_edge: 0.9 } },
    ece: { next_step: 0.05, relevant: 0.05, tests_passed: 0.05, safe: 0.05, done: null },
    n_labelled: { next_step: 200, relevant: 200, tests_passed: 200, safe: 200, done: 200 },
  };
}

const pinMeta = (maxTokens = 8000) => ({ questions_sha256: sha256(readFileSync(QUESTIONS)), ...ruleDigests(), particle_max_tokens: maxTokens });

function specs(): Spec[] {
  const out: Spec[] = [];
  for (const model of ["opus", "sol"] as const) {
    for (const cell of ["N", "R", "P"] as const) {
      TASKS.forEach((task, i) => {
        const fixes = !(cell === "N" && i >= 2);
        out.push({ name: cell + "-" + model + "-" + task.split("__")[1], group: cell === "N" ? "cal" : "pilot", cell, model, task, main: [[fixes ? FIX : NOFIX, ENV_CHECK], [SUBMIT_COMMAND]], shadow: cell === "N" });
      });
    }
  }
  for (const [cell, model] of [["F", "opus"], ["J", "opus"], ["J", "sol"], ["W", "particle"]] as const) out.push({ name: cell + "-" + model + "-submitted", group: "other", cell, model, main: [[FIX, ENV_CHECK], [SUBMIT_COMMAND]] });
  out.push({ name: "N-opus-shadow-off", group: "aux", cell: "N", model: "opus", task: TASKS[0], main: [[FIX, ENV_CHECK], [SUBMIT_COMMAND]] });
  for (const [cell, model] of [["R", "opus"], ["R", "sol"], ["P", "opus"], ["P", "sol"], ["J", "opus"], ["J", "sol"], ["F", "opus"]] as const) out.push({ name: "ladder-" + cell + "-" + model, group: "aux", cell, model, main: LADDER_MAIN, ...LADDER });
  const rounds = (n: number) => Array.from({ length: 12 }, (_, r) => [...Array.from({ length: n }, (_, j) => "echo r" + r + "-" + j), "ls pkg/s" + String(r + 1).padStart(2, "0") + ".py"]);
  out.push({ name: "step-stop-P-opus", group: "aux", cell: "P", model: "opus", main: rounds(10), particle: (a) => (a.type === "next_step" && a.options.includes("show_0") ? { pick: "show_0", conf: 0.95 } : a.type === "next_step" ? { pick: "other", conf: 0.5 } : a.type === "relevant" ? { drop: [] } : { p: 0.5 }) });
  out.push({ name: "step-stop-N-sol", group: "aux", cell: "N", model: "sol", main: rounds(10) });
  out.push({ name: "call-backstop-N-opus", group: "aux", cell: "N", model: "opus", main: Array.from({ length: 34 }, (_, i): MainReply[] => [{ text: "Thinking, with no tool call." }, { text: "Still thinking." }, ["echo step-" + i]]).flat() });
  out.push({ name: "format-errors-N-opus", group: "aux", cell: "N", model: "opus", main: [], after: { text: "Thinking, with no tool call." } });
  out.push({ name: "wall-stop-N-sol", group: "aux", cell: "N", model: "sol", main: [], after: ["sleep 2"], cfg: { wall_s: 4 } });
  out.push({ name: "wall-stop-R-opus", group: "aux", cell: "R", model: "opus", main: [], after: ["sleep 2"], cfg: { wall_s: 4 } });
  out.push({ name: "allowance-main-N-opus", group: "aux", cell: "N", model: "opus", allowance: 1_500_000, main: [{ commands: ["echo big"], usage: { input: 350_000 } }], after: ["echo again"] });
  out.push({ name: "allowance-main-N-sol", group: "aux", cell: "N", model: "sol", allowance: 1_500_000, main: [{ commands: ["echo big"], usage: { input: 200_000, output: 100_000 } }], after: ["echo again"] });
  for (const model of ["opus", "sol"] as const) out.push({ name: "allowance-decider-R-" + model, group: "aux", cell: "R", model, allowance: 800_000, main: [["echo hi"]], jevUsage: { input: 20_000_000 } });
  out.push({ name: "infra-N-sol", group: "aux", cell: "N", model: "sol", main: [], after: { status: 500 }, env: { MSWEA_MODEL_RETRY_STOP_AFTER_ATTEMPT: "2" } });
  out.push({
    name: "guards-R-opus", group: "aux", cell: "R", model: "opus",
    main: [["python3 -m pytest -q tests"], ["echo RERUN"], ["cat pkg/g1.py"], [SUBMIT_COMMAND]],
    jev: (a) => {
      if (a.type !== "next_step") return a.type === "relevant_hit" ? { p: 0.99 } : { p: 0.5 };
      if (a.options.includes("run_tests") && (has(a.state.last_command, "pytest") || has(a.state.last_command, "RERUN"))) return { pick: "run_tests", conf: 0.95 };
      if (a.options.includes("show_0") && String(a.state.last_command ?? "").startsWith("cat pkg/g")) return { pick: "show_0", conf: 0.95 };
      return { pick: "other", conf: 0.5 };
    },
  });
  return out;
}

// ---------- legs ----------

function legVerdicts(r: Report) {
  const vals = [-20, -10, -7.5, -5, -1, 0, 1, 5, 10];
  const ratios = [0.5, 0.85, 0.9, 0.95, 1, 1.1, 1.3];
  for (const admitted of [true, false]) {
    let points = 0, bad = 0;
    const seenA = new Set<string>();
    for (const cut_lo of [-0.1, 0, 0.5, 0.79, 0.8, 0.95]) for (const lo of vals) for (const hi of vals) {
      if (lo > hi) continue;
      points++;
      const v = verdictA({ cut_lo, success_lo: lo, success_hi: hi }, admitted);
      const res: PrimaryA = { admitted, cut: cut_lo + 0.02, cut_ci: [cut_lo, cut_lo + 0.04], median_ratio: 0.5, success: { delta: (lo + hi) / 2, ci: [lo, hi], worse: 1, better: 1, n: 100 }, time_ratio: 1, time_ci: [0.9, 1.1], verdict: v };
      const lines = printA(res).filter((l) => l.startsWith("verdict: "));
      seenA.add(v.verdict);
      if (lines.length !== 1 || !(admitted ? A_VERDICTS.admitted : A_VERDICTS.kept_out).includes(v.verdict)) bad++;
    }
    const allA = (admitted ? A_VERDICTS.admitted : A_VERDICTS.kept_out).every((v) => seenA.has(v));
    r.add("verdict printer A, " + (admitted ? "admitted" : "kept out") + ": exactly one verdict per grid point, every verdict reachable", bad === 0 && allA, points + " points, " + bad + " bad, " + seenA.size + " verdicts seen");
    points = 0; bad = 0;
    const seenB = new Set<string>();
    for (const lo of vals) for (const hi of vals) for (const bl of ratios) for (const bh of ratios) for (const tl of ratios) for (const th of ratios) {
      if (lo > hi || bl > bh || tl > th) continue;
      points++;
      const v = verdictB({ success_lo: lo, success_hi: hi, bill_lo: bl, bill_hi: bh, time_lo: tl, time_hi: th }, admitted);
      const res: PrimaryB = { admitted, bill_ratio: (bl + bh) / 2, bill_ci: [bl, bh], success: { delta: (lo + hi) / 2, ci: [lo, hi], worse: 1, better: 1, n: 100 }, time_ratio: (tl + th) / 2, time_ci: [tl, th], verdict: v };
      const lines = printB(res).filter((l) => l.startsWith("verdict: "));
      seenB.add(v.verdict);
      if (lines.length !== 1 || !(admitted ? B_VERDICTS.admitted : B_VERDICTS.kept_out).includes(v.verdict)) bad++;
    }
    const allB = (admitted ? B_VERDICTS.admitted : B_VERDICTS.kept_out).every((v) => seenB.has(v));
    r.add("verdict printer B, " + (admitted ? "admitted" : "kept out") + ": exactly one verdict per grid point, every verdict reachable", bad === 0 && allB, points + " points, " + bad + " bad, " + seenB.size + " verdicts seen");
  }
}

function legDraw(r: Report, out: string) {
  r.guard("draw.py: stdout equals draw.txt and the five split lists match byte for byte", () => {
    const root = join(out, "draw");
    const here = join(root, "wiki", "plans", "2026-11-09-geva-411-decision-routing-prereg");
    const l1 = join(root, "wiki", "plans", "2026-11-03-geva-254-l1-overhaul-prereg-2000");
    mkdirSync(here, { recursive: true });
    mkdirSync(l1, { recursive: true });
    mkdirSync(join(root, "quick", "laneb", "tasks"), { recursive: true });
    cpSync(join(PREREG, "draw.py"), join(here, "draw.py"));
    for (const f of ["screen.txt", "eligible.txt"]) cpSync(join(REPO, "wiki", "plans", "2026-11-03-geva-254-l1-overhaul-prereg-2000", f), join(l1, f));
    cpSync(join(REPO, "quick", "laneb", "tasks", "swerebench-r3a4.json"), join(root, "quick", "laneb", "tasks", "swerebench-r3a4.json"));
    const p = Bun.spawnSync(["python3", join(here, "draw.py")], { stdout: "pipe", stderr: "pipe" });
    if (p.exitCode !== 0) return "draw.py exited " + p.exitCode + ": " + p.stderr.toString().slice(0, 200);
    if (p.stdout.toString() !== readFileSync(join(PREREG, "draw.txt"), "utf8")) return "stdout differs from draw.txt";
    const differ = ["scored.txt", "calibration.txt", "spare.txt", "subset.txt", "pilot.txt"].filter((f) => readFileSync(join(here, f), "utf8") !== readFileSync(join(PREREG, f), "utf8"));
    return differ.length ? "lists differ: " + differ.join(", ") : true;
  });
}

function legPilot(r: Report) {
  const items = JSON.parse(readFileSync(ITEMS, "utf8")) as ItemsFile;
  r.guard("pilot re-cost at planning rates reproduces every item cap in items.json and the $1,940 all-in", () => {
    const p = plan(PLANNING_RATE, FULL_SCOPE, items);
    const off = items.items.filter((i) => p.items.find((x) => x.item === i.item)?.cap !== i.cap_micros / 1e6).map((i) => i.item);
    return off.length ? "caps differ: " + off.join(", ") : p.all_in_cap === 1940 && recost({}).fits && recost({}).dropped.length === 0 ? true : "all-in " + p.all_in_cap;
  });
  r.guard("pilot re-cost: a rate is the higher of planning rate and pilot mean", () => {
    const x = recost({ "R:opus": 0.5, "P:sol": 0.1 });
    return x.rate["R:opus"] === 0.5 && x.rate["P:sol"] === PLANNING_RATE["P:sol"] ? true : JSON.stringify(x.rate);
  });
  r.guard("drop order: W, then J on Sol, then F, then the subset 100 to 80, each printed as not run under the line", () => {
    const one = recost({ "R:opus": 0.42, "R:sol": 0.45 });
    const all = recost({ "R:opus": 0.9, "R:sol": 0.9, "P:opus": 0.8, "P:sol": 0.8 });
    const lines = printRecost(all).filter((l) => l.startsWith("not run under the line: "));
    const okOne = one.dropped.length >= 1 && one.dropped[0]!.startsWith("W") && one.fits;
    const okAll = lines.length === 4 && lines[0]!.includes("W,") && lines[1]!.includes("J on Sol") && lines[2]!.includes("F on Opus") && lines[3]!.includes("100 to 80") && !all.fits;
    return okOne && okAll ? true : "one " + JSON.stringify(one.dropped) + " all " + JSON.stringify(lines);
  });
  r.guard("particle-1 max_tokens: over 2% no-answers after retry raises 8000 to 16000 once; 2% stays", () => {
    const mk = (n: number, miss: number, over = 0) => [...Array.from({ length: n }, (_, i) => ({ mode: "live", layers: { particle: { ok: i >= miss, error: i < miss ? "truncated" : null } } })), ...Array.from({ length: over }, () => ({ mode: "live", layers: { particle: { ok: false, error: "state_over_limit" } } })), { mode: "shadow", layers: { particle: { ok: false } } }];
    const a = particleNoAnswers(mk(100, 2, 50)), b = particleNoAnswers(mk(100, 3));
    validatePin(buildPin(ladderTuned(), pinMeta(16000)));
    let refused = false;
    try {
      buildPin(ladderTuned(), pinMeta(12000));
    } catch {
      refused = true;
    }
    return a.max_tokens === 8000 && a.decisions === 100 && b.max_tokens === 16000 && refused ? true : JSON.stringify({ a, b, refused });
  });
  r.guard("pilot session stop: a session past $2.50 prints DR_PILOT_SESSION_STOP code first; the controller stops at the same line", () => {
    const s = pilotSessionStops([{ session: "a", usd: 2.5 }, { session: "b", usd: 2.51 }]);
    return s.length === 1 && s[0]!.startsWith("DR_PILOT_SESSION_STOP ") && PILOT_SESSION_STOP_MICROS === 2_500_000 ? true : JSON.stringify(s);
  });
}

function legTables(r: Report) {
  const bun = Bun.spawnSync([process.execPath, "test", join(REPO, "tests", "decision-routing", "labels-rules.test.ts")], { cwd: REPO, stdout: "pipe", stderr: "pipe" });
  const text = bun.stdout.toString() + bun.stderr.toString();
  r.add("next-step mapping and safety rule table tests (labels-rules.test.ts)", bun.exitCode === 0, (/(\d+) pass/.exec(text)?.[0] ?? "") + ", " + (/(\d+) fail/.exec(text)?.[0] ?? ""));
  const py = Bun.spawnSync(["python3", join(REPO, "tests", "decision-routing", "agent_unit_test.py")], { cwd: REPO, env: { PATH: process.env.PATH ?? "/usr/bin:/bin", PYTHONDONTWRITEBYTECODE: "1" }, stdout: "pipe", stderr: "pipe" });
  const pt = py.stdout.toString() + py.stderr.toString();
  r.add("test-pass parser and dr_agent unit tables (agent_unit_test.py)", py.exitCode === 0 && !/^FAIL /m.test(pt), (pt.match(/^PASS /gm)?.length ?? 0) + " PASS lines");
}

async function legLeak(r: Report, out: string) {
  const dir = join(out, "leak");
  const tasks = join(out, "tasks");
  mkdirSync(dir, { recursive: true });
  const code = await labelsMain(["pristine", "--tasks-dir", tasks, "--tasks", TASKS.join(","), "--out", join(dir, "pristine")], fakeDocker);
  r.add("labels pristine writes each task's pristine listing through an injected docker runner", code === 0 && TASKS.every((t) => existsSync(join(dir, "pristine", t + ".json"))));
  const stub = [
    'import { readFileSync } from "node:fs";',
    "const env = process.env;",
    'const job = JSON.parse(readFileSync(process.argv[process.argv.indexOf("-c") + 1], "utf8"));',
    "const kw = job.agents[0].kwargs;",
    'const task = job.tasks[0].path.split("/").pop();',
    'const markers = JSON.parse(readFileSync(kw.markers_file, "utf8"));',
    'const mgmt = (path, body) => fetch("http://localhost" + path, { unix: env.DR_MGMT_SOCKET, method: "POST", headers: { "content-type": "application/json", "x-gstack-evals-management": env.DR_MGMT_TOKEN }, body: JSON.stringify(body) }).then((r) => r.json());',
    'const b = await mgmt("/bind", { cell: { run_id: "dryrun", arm: kw.cell, task, model: kw.model, trial: 1, attempt: 1 }, models: ["typesafe:jev-1.13.0"], allowance_micros: 5000000, forbidden_markers: markers, deciders: ["typesafe:jev-1.13.0"], canary: markers.find((m) => /^DRCANARY-[0-9a-f]{32}$/.test(m)) });',
    'const last_output = env.DR_DRYRUN_LEAK === "1" ? "decider state: " + markers[0] : "decider state: " + env.DR_DRYRUN_FIX;',
    'await fetch(env.DR_PROXY_BASE + "/" + b.slot + "/typesafe/v1/systemone", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + b.token }, body: JSON.stringify({ model: "jev-1.13.0", state: { last_output }, questions: { done: { type: "noul", instructions: "Is the task done?" } } }) });',
    'await mgmt("/unbind", { slot: b.slot });',
    'await mgmt("/finalize", { meter_id: b.meter_id });',
  ].join("\n");
  writeFileSync(join(dir, "fake-harbor.ts"), stub + "\n");
  writeFileSync(join(dir, "runtime.tgz"), "runtime");
  writeFileSync(join(dir, "pin.json"), "{}");
  const sent: string[] = [];
  const logs: string[] = [];
  const opts = (task: string, leak: boolean, run: string): BatchOptions => ({
    plan: [{ task, cell: "R", model: "opus", item: "dr-pilot-rp" }], out: join(dir, run), runId: "dryrun-" + run, temp: true, items: ITEMS, harbor: [process.execPath, join(dir, "fake-harbor.ts")], tasksDir: tasks, proxyHost: "127.0.0.1",
    runtimeTarball: join(dir, "runtime.tgz"), runtimeSha256: sha256("runtime"), pinFile: join(dir, "pin.json"), pinSha256: sha256("{}"), custody: { pristineDir: join(dir, "pristine"), labelStore: join(dir, "labels") }, concurrency: 1, pollMs: 20, log: (l) => logs.push(l),
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...FAKE_KEYS, DR_DRYRUN_LEAK: leak ? "1" : "0", DR_DRYRUN_FIX: SOLUTION },
    fetch: async (_u, init) => { sent.push(asText(init.body)); return Response.json({ model: "jev-1.13.0", answers: { done: { type: "noul", noul: 0.5 } }, usage: { input_tokens: 10, output_tokens: 0 } }); },
  });
  try {
    const hit = await runBatch(opts(TASKS[0]!, true, "canary"));
    const canary = readFileSync(join(dir, "labels", TASKS[0]!, "canary.txt"), "utf8").trim();
    r.add("leak scan: a planted canary in a request on the slot (here a decider's) stops the batch with DR_CUSTODY_HIT, nothing forwarded, the canary never logged", hit.stop?.code === "DR_CUSTODY_HIT" && sent.length === 0 && !JSON.stringify(hit).includes(canary) && !logs.join("\n").includes(canary) && logs.some((l) => l.startsWith("DR_CUSTODY_HIT: ")), "stop " + (hit.stop?.code ?? "none") + ", forwarded " + sent.length);
    const fix = await runBatch(opts(TASKS[1]!, false, "realfix"));
    r.add("leak scan: an agent diff equal to the real-fix hunk does not stop the batch", fix.stop === null && sent.length === 1 && sent[0]!.includes("return a + b"), "stop " + (fix.stop?.code ?? "none") + ", forwarded " + sent.length);
  } catch (e) {
    r.add("leak scan through the controller", false, (e as Error).message.slice(0, 300));
  }
  let refused = "";
  try {
    await runBatch({ ...opts(TASKS[2]!, false, "live"), temp: false, custody: undefined, record: join(dir, "nope"), ledger: join(dir, "nope.sqlite") });
  } catch (e) {
    refused = (e as Error).message;
  }
  r.add("the controller refuses a live run without --pristine-dir and --label-store", refused.startsWith("E_USAGE: a live run"), refused.slice(0, 120));
}

const tryOk = (s: Session) => s.summary?.exit_status;

function legSessions(r: Report, all: Session[]) {
  const by = (name: string) => all.find((s) => s.spec.name === name)!;
  const submitted = all.filter((s) => s.spec.group !== "aux" || s.spec.name === "N-opus-shadow-off");
  const notSubmitted = submitted.filter((s) => tryOk(s) !== "submitted");
  r.add("outcome submitted: every cell (N, R, P, F, J, W) on both main models submits and is graded", notSubmitted.length === 0, submitted.length + " sessions" + (notSubmitted.length ? "; not submitted: " + notSubmitted.map((s) => s.spec.name + "=" + (tryOk(s) ?? "no summary, exit " + s.exit + " " + s.stderr.trim().split("\n").at(-1))).join(", ") : ""));
  const envMiss = submitted.filter((s) => !JSON.stringify(readJson(join(s.trial, "agent", "dr", "trajectory.json")) ?? "").includes(ENV_WANT));
  r.add("Captain ruling 2: swebench.yaml's environment section (timeout, interpreter, env) reaches every cell's commands alike", envMiss.length === 0, envMiss.length ? envMiss.length + " of " + submitted.length + " sessions miss " + ENV_WANT : "");

  const p = by("step-stop-P-opus"), n = by("step-stop-N-sol");
  r.add("step_stop at 100 executed actions, decider actions counted (P opus)", p.summary?.exit_status === "step_stop" && p.summary.executed_actions === 100 && p.summary.decider_actions === 8, JSON.stringify({ exit: p.summary?.exit_status, actions: p.summary?.executed_actions, decider: p.summary?.decider_actions }));
  r.add("step_stop at 100 executed actions, actions past the 100th in one reply not run (N sol)", n.summary?.exit_status === "step_stop" && n.summary.executed_actions === 100 && n.summary.main_calls === 10, JSON.stringify({ exit: n.summary?.exit_status, actions: n.summary?.executed_actions, calls: n.summary?.main_calls }));
  const cb = by("call-backstop-N-opus");
  r.add("call_backstop at 100 main-model calls, reported apart from step_stop", cb.summary?.exit_status === "call_backstop" && cb.summary.main_calls === 100 && cb.summary.executed_actions === 33 && cb.summary.backstop_hit === true, JSON.stringify({ exit: cb.summary?.exit_status, calls: cb.summary?.main_calls, actions: cb.summary?.executed_actions }));
  const fe = by("format-errors-N-opus");
  r.add("three replies in a row with no tool call end the session as agent_error (mini's RepeatedFormatError at the pin), graded", fe.summary?.exit_status === "agent_error" && fe.summary.main_calls === 3 && existsSync(join(fe.trial, "verifier", "reward.txt")), JSON.stringify({ exit: fe.summary?.exit_status, calls: fe.summary?.main_calls }));
  const capField: Record<string, string> = { anthropic: "max_tokens", openai: "max_completion_tokens", openrouter: "max_tokens" };
  const mains = all.flatMap((s) => s.requests.filter((q) => q.kind === "main").map((q) => ({ name: s.spec.name, asked: q.body?.[q.provider === "openai" && q.body?.input !== undefined ? "max_output_tokens" : capField[q.provider]!] })));
  const offCap = mains.filter((m) => m.asked !== MAX_OUTPUT_TOKENS);
  r.add("every main-model call in every cell asks for " + MAX_OUTPUT_TOKENS + " output tokens and passes the proxy's cap", mains.length > 0 && offCap.length === 0, mains.length + " main-model requests" + (offCap.length ? "; off the cap: " + offCap.slice(0, 4).map((m) => m.name + "=" + m.asked).join(", ") : ""));
  for (const name of ["wall-stop-N-sol", "wall-stop-R-opus"]) {
    const s = by(name);
    r.add("wall_stop with a short wall (" + name + ")", s.summary?.exit_status === "wall_stop", JSON.stringify({ exit: s.summary?.exit_status, ms: s.summary?.session_ms }));
  }
  for (const name of ["allowance-main-N-opus", "allowance-main-N-sol", "allowance-decider-R-opus", "allowance-decider-R-sol"]) {
    const s = by(name);
    const refusal = readJsonl(s.journal).find((l) => l.kind === "refusal" && l.code === "DR_ALLOWANCE_STOP");
    const decider = name.includes("decider");
    const graded = s.summary?.exit_status === "allowance_stop" && existsSync(join(s.trial, "verifier", "reward.txt"));
    const noRerun = s.summary?.exit_status === "allowance_stop";
    const spend = (s.meter?.micros ?? 0) > 0 && (s.meter?.refused ?? 0) >= 1;
    const where = decider ? !!refusal && refusal.provider === "openrouter" && !s.requests.some((q) => q.kind === "particle") : !!refusal;
    r.add("allowance_stop through the real pinned litellm and SDK clients (" + name + "): graded, no rerun, spend counted" + (decider ? ", refused on the decider mid-fall-through" : ""), graded && noRerun && spend && where, JSON.stringify({ exit: s.summary?.exit_status, micros: s.meter?.micros, refused: s.meter?.refused, refusal_provider: refusal?.provider ?? null, error: s.summary?.error ?? null }));
  }
  const inf = by("infra-N-sol");
  const ok2xx = Object.entries(inf.meter?.upstream?.statuses ?? {}).filter(([k]) => k.startsWith("2")).reduce((a, [, v]) => a + (v as number), 0);
  r.add("infrastructure: no model response marks the session for Harbor's one rerun (DrInfraError, max_retries 1) and the scorer counts it missing", inf.summary?.exit_status === "infra_error" && inf.summary.main_responses === 0 && ok2xx === 0 && HARBOR_RETRY.max_retries === 1 && HARBOR_RETRY.include_exceptions.includes("DrInfraError"), JSON.stringify({ exit: inf.summary?.exit_status, responses: inf.summary?.main_responses, statuses: inf.meter?.upstream?.statuses }));
  const LITELLM_OPENAI_SENDS = 3, MINI_ATTEMPTS = { leg: Number(by("infra-N-sol").spec.env?.MSWEA_MODEL_RETRY_STOP_AFTER_ATTEMPT), default: 10 };
  const infOut = readJsonl(inf.journal).filter((l) => l.kind === "outcome");
  const infMax = new Map(readJsonl(inf.journal).filter((l) => l.kind === "request").map((l) => [l.reservation_id, l.max_micros as number]));
  const legBound = RETRY.attempts * LITELLM_OPENAI_SENDS * MINI_ATTEMPTS.leg;
  const worstCalls = RETRY.attempts * LITELLM_OPENAI_SENDS * MINI_ATTEMPTS.default * (HARBOR_RETRY.max_retries + 1);
  const shadow = Math.max(0, ...infOut.map((l) => l.shadow_micros ?? 0));
  const freeOk = infOut.length > 0 && infOut.every((l) => l.status >= 500 && l.no_usage_5xx === true && l.outcome?.spent_micros === 0 && l.shadow_micros === infMax.get(l.reservation_id));
  r.add("5xx without usage: an all-500 session books $0, journals each attempt's shadow reservation, and ends infra_error within " + legBound + " attempts (proxy " + RETRY.attempts + " x litellm " + LITELLM_OPENAI_SENDS + " x mini " + MINI_ATTEMPTS.leg + ")", inf.summary?.exit_status === "infra_error" && (inf.meter?.micros ?? -1) === 0 && freeOk && infOut.length <= legBound, JSON.stringify({ exit: inf.summary?.exit_status, micros: inf.meter?.micros, zero_settles: infOut.length, bound: legBound, worst_case_per_session: { calls: worstCalls, shadow_usd_at_this_reservation: (worstCalls * shadow) / 1e6, formula: "proxy attempts x litellm sends x mini default attempts x Harbor runs" } }));
  const stopNoCode = all.filter((s) => STOP_CODES[s.summary?.exit_status] && !s.stderr.split("\n").some((l) => l.startsWith(STOP_CODES[s.summary.exit_status]!)));
  r.add("every session stop prints its code first on stderr (DR_STEP_STOP, DR_WALL_STOP, DR_ALLOWANCE_STOP)", stopNoCode.length === 0, stopNoCode.length ? "no code line in " + stopNoCode.map((s) => s.spec.name).join(", ") : "");

  for (const s of all.filter((x) => x.spec.name.startsWith("ladder-"))) {
    const cell = s.spec.cell;
    const wrong: string[] = [];
    const acted = new Set<string>();
    const stateOf = (d: any) => readJson(join(s.trial, "agent", "dr", d.state_file)) ?? {};
    for (const d of s.decisions) {
      acted.add(d.acting_layer);
      let want: string | null = null;
      if (d.type === "safe") want = firstActing(cell, safeActs(d.command ?? ""));
      if (d.type === "tests_passed") want = d.rule === "runner_exit" ? "rule" : firstActing(cell, testActs(d.command ?? ""));
      if (d.type === "done") want = firstActing(cell, { jev: false, particle: true, frontier: true });
      if (d.type === "next_step" && !d.guard) {
        const lc = String(stateOf(d).last_command ?? "");
        want = firstActing(cell, { jev: lc.includes("NS_J"), particle: lc.includes("NS_P"), frontier: lc.includes("NS_F") && cell === "F" });
      }
      if (d.type === "relevant") {
        const exp: Record<string, string> = {};
        for (const h of d.hits as string[]) {
          const k = hitNo(h);
          if (ROUTED_LAYERS[cell]!.includes("jev") && k % 2 === 0) exp[h] = "jev";
          else if (ROUTED_LAYERS[cell]!.includes("particle") && k % 3 === 0) exp[h] = "particle";
          else if (cell === "F" && k % 5 === 0) exp[h] = "frontier";
        }
        const same = JSON.stringify(Object.keys(exp).sort().map((h) => [h, exp[h]])) === JSON.stringify(Object.keys(d.dropped_by ?? {}).sort().map((h) => [h, d.dropped_by[h]]));
        if (!same || d.hits.length !== 100 || d.hits_total !== 500) wrong.push("relevant dropped_by or counts");
        continue;
      }
      if (want !== null && d.acting_layer !== want) wrong.push(d.type + " " + (d.command ?? "") + " acted " + d.acting_layer + " want " + want);
    }
    const reach = [...ROUTED_LAYERS[cell]!, "rule"].filter((l) => !acted.has(l));
    const blocked = ["R", "J"].includes(cell) ? 1 : 0;
    const extra = s.summary?.exit_status !== "submitted" ? "exit " + s.summary?.exit_status : s.summary.submits_blocked !== 1 ? "submits_blocked " + s.summary.submits_blocked : s.summary.blocked_commands !== blocked ? "blocked " + s.summary.blocked_commands : "";
    r.add("defer rule in " + cell + " " + s.spec.model + ": each layer reachable, the right layer acting on every decision", !wrong.length && !reach.length && !extra, [wrong.slice(0, 4).join("; "), reach.length ? "unreached " + reach.join(",") : "", extra].filter(Boolean).join("; ") || s.decisions.length + " decisions");
    const rel = s.decisions.filter((d) => d.type === "relevant");
    const relReq = (k: string) => s.requests.filter((q) => q.kind === k && (q.kind === "jev" ? Object.keys(q.body?.questions ?? {}).some((x) => x.startsWith("relevant_")) : has(JSON.stringify(q.body), '\\"hits\\"'))).length;
    const jevQs = s.requests.filter((q) => q.kind === "jev" && Object.keys(q.body?.questions ?? {}).some((x) => x.startsWith("relevant_"))).map((q) => Object.keys(q.body.questions).length);
    const gen = relReq("particle"), front = relReq("frontier");
    const okRel = rel.length === 1 && rel[0].hits.length === 100 && rel[0].hits_total === 500 && (cell === "F" ? front === 1 : front === 0) && gen === (ROUTED_LAYERS[cell]!.includes("particle") ? 1 : 0) && jevQs.every((n) => n === 100) && jevQs.length === (ROUTED_LAYERS[cell]!.includes("jev") ? 1 : 0);
    r.add("500-hit grep in " + cell + " " + s.spec.model + ": at most 100 asked, one generative request, " + (cell === "F" ? "one typed frontier request" : "no frontier call"), okRel, JSON.stringify({ decisions: rel.length, asked: rel[0]?.hits?.length, total: rel[0]?.hits_total, particle_requests: gen, frontier_requests: front, jev_questions: jevQs }));
  }
  const g = by("guards-R-opus");
  r.add("loop guards: max3, repeat and rerun_no_change each fire once and hand the turn back to the main model", JSON.stringify(g.summary?.guards) === JSON.stringify({ max3: 1, repeat: 1, rerun_no_change: 1 }) && g.summary?.exit_status === "submitted", JSON.stringify({ guards: g.summary?.guards, exit: g.summary?.exit_status }));
}

function legShadow(r: Report, all: Session[]) {
  const on = all.find((s) => s.spec.name === "N-opus-alpha-1")!, off = all.find((s) => s.spec.name === "N-opus-shadow-off")!;
  const deciders = on.requests.slice(0, on.sessionRequests).filter((q) => q.kind !== "main").length;
  const logged = on.decisions.filter((d) => d.mode === "shadow").length;
  const answered = on.shadow.filter((d) => ["jev", "particle", "particle_noguess"].every((k) => d.layers?.[k])).length;
  r.add("shadow answers come after the session: no decider call while N runs, every logged state answered by Jev and particle-1 with and without the guess", deciders === 0 && logged > 0 && answered === logged, JSON.stringify({ decider_calls_in_session: deciders, logged, answered }));
  const a = on.summary?.session_ms ?? -1, b = off.summary?.session_ms ?? -1;
  const tol = Math.max(SHADOW_TOLERANCE.ms, SHADOW_TOLERANCE.share * b);
  r.add("N's session time with shadow logging on stays within " + SHADOW_TOLERANCE.ms + " ms or " + 100 * SHADOW_TOLERANCE.share + "% of shadow off", a >= 0 && b >= 0 && Math.abs(a - b) <= tol, "on " + a + " ms, off " + b + " ms, tolerance " + Math.round(tol) + " ms");
}

function syntheticRows(): LabelledDecision[] {
  const rows: LabelledDecision[] = [];
  const add = (type: string, n: number, conf: number, rightShare: number, extra: Partial<LabelledDecision> = {}) => {
    for (let i = 0; i < n; i++) rows.push({ decision_id: type + ":" + rows.length, state_file: "states/x.json", type, decider: "jev", ok: true, conf, answer: "yes", correct: i < Math.round(n * rightShare), ...extra });
  };
  add("next_step", 200, 0.95, 0.95, { answer: "show_0" });
  add("tests_passed", 200, 0.95, 0.5);
  add("done", 200, 0.9, 0.9);
  add("safe", 60, 0.97, 1);
  for (let i = 0; i < 200; i++) rows.push({ decision_id: "rel:" + i, state_file: "states/x.json", type: "relevant", decider: "jev", ok: true, conf: 0.98, p_yes: 0.02, answer: "no", fix_edited: false, correct: true });
  return rows;
}

function legTuner(r: Report, out: string): { pin: string; digest: string } {
  const t = tune(syntheticRows());
  r.add("ECE gate on synthetic shadow data: a calibrated type gets a band, a miscalibrated one and one under 100 labels get none, done never gets one", t.ece.next_step !== null && t.ece.next_step! <= 0.15 && t.jev.next_step.edge !== null && t.ece.tests_passed! > 0.15 && t.jev.tests_passed.edge === null && t.ece.safe === null && t.jev.safe.allow_edge === null && t.jev.done.edge === null && t.jev.relevant.drop_edge !== null, JSON.stringify({ ece: t.ece, jev: t.jev }));
  const pin = join(out, "pin-tuned.json");
  const digest = writePin(pin, buildPin(t, pinMeta()));
  const back = sha256(readFileSync(pin));
  r.add("pin file written and read back by sha256 (pin.json.sha256 matches the bytes)", back === digest && readFileSync(pin + ".sha256", "utf8").trim() === digest, digest.slice(0, 12));
  return { pin, digest };
}

async function legPinAgent(r: Report, ctx: Ctx, tuned: { pin: string; digest: string }) {
  const s = await runSession(ctx, { name: "pin-readback-R-opus", group: "aux", cell: "R", model: "opus", pin: tuned.pin, main: [[FIX], [SUBMIT_COMMAND]] });
  r.add("the agent reads the pin and records its sha256 in dr-summary.json", s.summary?.pin_sha256 === tuned.digest && s.summary?.exit_status === "submitted", "summary pin " + String(s.summary?.pin_sha256).slice(0, 12));
  const bad = join(ctx.out, "pin-bad.json");
  writeFileSync(bad, JSON.stringify({ ...JSON.parse(readFileSync(tuned.pin, "utf8")), questions_sha256: "0".repeat(64) }));
  const b = await runSession(ctx, { name: "pin-mismatch-R-opus", group: "aux", cell: "R", model: "opus", pin: bad, main: [[SUBMIT_COMMAND]] });
  r.add("a pin whose questions_sha256 differs stops the routed agent before any call, E_DR_PIN first on stderr", b.exit === 2 && b.stderr.startsWith("E_DR_PIN") && b.requests.length === 0, "exit " + b.exit);
  return [s, b];
}

async function legScorer(r: Report, ctx: Ctx, all: Session[]) {
  const out = ctx.out;
  const tasks = join(out, "tasks");
  const labelled: LabelledDecision[] = [];
  let labels = 0, missing = 0;
  try {
    for (const s of all.filter((x) => x.spec.group !== "aux")) {
      const rows: LabelRow[] = await labelTrial(s.trial, { taskDir: join(tasks, s.spec.task ?? TASKS[0]!), proxyHost: "127.0.0.1", verifierImage: "dr-verify:dryrun", docker: fakeDocker });
      labels += rows.length;
      missing += rows.filter((x) => x.missing).length;
      writeFileSync(join(s.trial, "labels.jsonl"), rows.map((x) => JSON.stringify(x)).join("\n") + "\n");
      if (s.shadow.length) labelled.push(...joinLabels(s.shadow, rows));
    }
    const doneOk = all.filter((s) => s.spec.group === "cal").every((s) => {
      const rows = readJsonl(join(s.trial, "labels.jsonl"));
      const done = rows.find((x) => x.type === "done");
      return done && done.label === (readFileSync(join(s.trial, "verifier", "reward.txt"), "utf8").trim() === "1");
    });
    r.add("labels on the dry-run sessions with an injected docker runner (done verifier agrees with the reward)", labels > 0 && doneOk, labels + " labels, " + missing + " missing");
    const t = tune(labelled);
    const pin = join(out, "pin-from-shadow.json");
    writePin(pin, buildPin(t, pinMeta()));
    r.add("the tuner runs on the joined shadow labels and writes a valid pin", labelled.length > 0 && labelled.every((x) => ["jev", "particle_guess", "particle_noguess"].includes(x.decider)), labelled.length + " labelled rows");
  } catch (e) {
    r.add("labels and tuner on the dry-run sessions", false, (e as Error).message.slice(0, 300));
  }
  const journals = all.map((s) => s.journal).filter(existsSync);
  const prices = join(LANE, "config", "prices.json");
  const cli = (args: string[]) => Bun.spawnSync([process.execPath, join(REPO, "bin", "gstack-evals"), "decision-routing", ...args], { cwd: REPO, stdout: "pipe", stderr: "pipe" });
  const jflags = journals.flatMap((j) => ["--journal", j]);
  const adm = cli(["admit", "--calibration", join(out, "trials", "cal"), "--pilot", join(out, "trials", "pilot"), ...jflags, "--prices", prices, "--out", join(out, "admission.json")]);
  const admText = adm.stdout.toString() + adm.stderr.toString();
  writeFileSync(join(out, "admit.txt"), admText);
  r.add("admission runs on calibration and pilot sessions: room, transfer, ceiling and both contrasts print", existsSync(join(out, "admission.json")) && /room opus/.test(admText) && /R-N/.test(admText) && /R-P/.test(admText), "exit " + adm.exitCode);
  writeFileSync(join(out, "planned.json"), JSON.stringify({ tasks: TASKS }) + "\n");
  const sc = cli(["score", "--trials", join(out, "trials", "cal"), "--trials", join(out, "trials", "pilot"), ...jflags, "--prices", prices, "--planned", join(out, "planned.json"), "--admission", join(out, "admission.json"), "--json", join(out, "score.json")]);
  const text = sc.stdout.toString() + sc.stderr.toString();
  writeFileSync(join(out, "score.txt"), text);
  const blocks = (h: string) => text.split(h).length - 1;
  const outcomes = (text.match(/^(verdict: |NO OUTCOME: )/gm) ?? []).length;
  r.add("scorer end to end: Primary A and Primary B print for both models, each with a verdict or NO OUTCOME", sc.exitCode === 0 && blocks("Primary A, R against N") === 2 && blocks("Primary B, R against P") === 2 && outcomes >= 4, "exit " + sc.exitCode + ", " + outcomes + " verdict lines (score.txt)");
  r.guard("pilot re-cost on the dry-run pilot sessions (pilot CLI)", () => {
    const p = cli(["pilot", "--trials", join(out, "trials", "pilot"), "--trials", join(out, "trials", "other"), ...jflags, "--prices", prices]);
    const t = p.stdout.toString();
    writeFileSync(join(out, "pilot.txt"), t + p.stderr.toString());
    return p.exitCode === 0 && /all-in at caps/.test(t) && /max_tokens 8000/.test(t) ? true : "exit " + p.exitCode + " " + p.stderr.toString().slice(0, 200);
  });
  const inf = all.find((s) => s.spec.name === "infra-N-sol");
  r.guard("scorer: an infrastructure session is missing (a coverage gap), an allowance stop is graded", () => {
    const ctxS = { calls: readJournal(journals), prices: loadPrices(prices) };
    const a = readTrial(inf!.trial, ctxS);
    const al = readTrial(all.find((s) => s.spec.name === "allowance-main-N-opus")!.trial, ctxS);
    return a.status === "missing" && al.status === "graded" && (al.bill_usd ?? 0) > 1 ? true : JSON.stringify({ infra: a.status, allowance: al.status, bill: al.bill_usd });
  });
}

function legNoGstack(r: Report, all: Session[]) {
  const files = [...walk(join(AGENT, "dr_agent")), ...walk(join(AGENT, "runtime")).filter((f) => !f.endsWith(".lock")), join(AGENT, "dr_harbor.py")].filter((f) => /\.(py|sh|in|json)$/.test(f));
  const hits = files.filter((f) => FORBIDDEN_TEXT.test(readFileSync(f, "utf8")));
  r.add("no gstack path, skill, hook or drive path in the runtime layer, dr_agent or dr_harbor's session env", hits.length === 0, hits.length ? hits.map((f) => f.slice(REPO.length + 1)).join(", ") : files.length + " files");
  const opened = all.flatMap((s) => s.audit.filter((p) => FORBIDDEN_OPEN.test(p)).map((p) => s.spec.name + ":" + p));
  const hooked = all.filter((s) => s.audit.some((p) => p.endsWith("questions.json"))).length;
  r.add("no cell's agent opens CLAUDE.md, AGENTS.md, .claude/ or a drive path (audit hook on every session)", opened.length === 0 && hooked === all.length, opened.length ? opened.slice(0, 5).join(", ") : hooked + " of " + all.length + " sessions audited");
}

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.name === "__pycache__" ? [] : e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
}

function findVenv(flagValue?: string): string | null {
  const home = homedir();
  for (const v of [flagValue, process.env.DR_RUNTIME_VENV, join(home, ".cache", "decision-routing", "venv-dev"), "/opt/dr/venv"]) {
    if (v && existsSync(join(v, "bin", "python"))) return v;
  }
  return null;
}

const flag = (argv: string[], name: string): string | undefined => { const i = argv.indexOf(name); return i < 0 ? undefined : argv[i + 1]; };

/** Why the python legs cannot run here, or null. They need root: mini's BASH_ENV is /root/.bashrc, which only root can
 * read, so as any other user every command's first output line is a permission error and no submit registers. */
export function pythonLegsBlocked(keyless: boolean, venv: string | null, uid: number | undefined): string | null {
  if (keyless) return "--keyless";
  if (!venv) return "no runtime or dev venv (pass --venv)";
  if (uid !== 0) return "the python legs need root (mini's BASH_ENV is /root/.bashrc, unreadable as uid " + uid + ", so no submit would register); rerun as root";
  return null;
}

export async function main(argv: string[]): Promise<number> {
  const out = resolve(flag(argv, "--out") ?? mkdtempSync(join(tmpdir(), "dr-dryrun-")));
  mkdirSync(out, { recursive: true });
  const keyless = argv.includes("--keyless");
  const r = new Report();
  console.log("decision-routing dry run in " + out);
  writeTasks(join(out, "tasks"));
  legVerdicts(r);
  legDraw(r, out);
  legPilot(r);
  legTables(r);
  await legLeak(r, out);
  const venv = keyless ? null : findVenv(flag(argv, "--venv"));
  const blocked = pythonLegsBlocked(keyless, venv, process.getuid?.());
  if (blocked || !venv) {
    for (const leg of ["ledger leases per item", "sessions and outcome paths", "shadow timing", "pin read back by the agent", "scorer end to end", "no-gstack audit"]) {
      if (keyless) r.skip(leg, "--keyless");
      else r.add(leg, false, blocked ?? "no runtime or dev venv (pass --venv)");
    }
  } else {
    const scratch = mkdtempSync(join(tmpdir(), "drd-"));
    const template = join(out, "template");
    mkdirSync(template, { recursive: true });
    writeRepoTemplate(template);
    for (const d of ["journals", "trials", "repos", "home"]) mkdirSync(join(out, d), { recursive: true });
    const record = join(out, "ledger", "record");
    const ledger = LocalLedger.open(join(out, "ledger", "ledger.sqlite"));
    const items = (JSON.parse(readFileSync(ITEMS, "utf8")) as ItemsFile).items;
    const leases = new Map<string, string>();
    const warnings: string[] = [];
    for (const it of items) {
      recordApproval(record, { action: "init", item: it.item, cap_micros: it.cap_micros, admission: "warn", quotes: [{ words: "keyless dry run on a temporary ledger", by: "decision-routing dry-run", source: "lanes/decision-routing/dryrun.ts" }] });
      leases.set(it.item, openLease(record, ledger, { item: it.item, run_id: "dryrun", warn: (c: string, m: string) => warnings.push(c + " " + m), requireAdmission: () => null } as any).lease_id);
    }
    r.add("one lease opened on a temporary ledger record for each of the " + items.length + " items in items.json", leases.size === items.length && items.length === 10);
    const pin = join(out, "pin-ladder.json");
    writePin(pin, buildPin(ladderTuned(), pinMeta()));
    const ctx: Ctx = { out, python: join(venv, "bin", "python"), template, ledger, leases, pin, scratch };
    const tuned = legTuner(r, out);
    const conc = Number(flag(argv, "--concurrency") ?? 4);
    const t0 = Date.now();
    const all = await pool(specs(), conc, (s) => runSession(ctx, s));
    all.push(...(await legPinAgent(r, ctx, tuned)));
    console.log("ran " + all.length + " sessions in " + Math.round((Date.now() - t0) / 1000) + " s (" + venv + ")");
    legSessions(r, all);
    legShadow(r, all);
    await legScorer(r, ctx, all);
    legNoGstack(r, all);
    const spent = new Map<string, number>();
    for (const s of all) {
      spent.set(s.item, (spent.get(s.item) ?? 0) + (s.meter?.micros ?? 0) + (readJson(join(s.trial, "shadow-meter.json"))?.micros ?? 0));
    }
    const closes = items.map((it) => ({ item: it.item, close: settleLease(record, ledger, leases.get(it.item)!, (c: string, m: string) => warnings.push(c + " " + m)) }));
    ledger.close();
    const off = closes.filter((c) => c.close.spent_micros !== (spent.get(c.item) ?? 0) || c.close.unknown_micros !== 0);
    r.add("every lease settled; each item's settled spend equals its sessions' meters (allowance stops included)", off.length === 0 && closes.length === 10, off.length ? off.map((c) => c.item + " settled " + c.close.spent_micros + " metered " + (spent.get(c.item) ?? 0)).join(", ") : [...spent.entries()].map(([k, v]) => k + " " + v).join(", "));
    rmSync(scratch, { recursive: true, force: true });
  }
  const fails = r.lines.filter((l) => l.status === "FAIL");
  console.log("dry run: " + r.lines.filter((l) => l.status === "PASS").length + " PASS, " + fails.length + " FAIL, " + r.lines.filter((l) => l.status === "SKIP").length + " SKIP; evidence in " + out);
  writeFileSync(join(out, "dryrun.json"), JSON.stringify(r.lines, null, 2) + "\n");
  return fails.length ? 1 : 0;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
