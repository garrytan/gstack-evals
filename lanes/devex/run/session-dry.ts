// Copyright (c) 2026 Garry Tan. MIT License.
// The session part of the keyless dry run (prereg 2026-11-09-geva-417, section 15 rule 4), run as its own process for the
// reason tests/pv/pv-sdk.ts gives: the real Claude Code driver loads the real pinned Agent SDK, and a test process that
// mocks the SDK for its other files must not share it. session-checks.ts spawns this file and reads the lines it prints.
//
// It drives the stage 1 session path end to end with no key: run/session.ts runDxSessions with the real driver, the CLI
// the pinned Agent SDK bundles, the real MeteringProxy over a fake upstream fetch on loopback, the real parser and rows,
// and real leases from leases.ts openRun on a temporary ledger and approval record. Three batches, one per stage 1
// frozen run, each on its own lease, at one session at a time so the fake upstream's script order is fixed:
// - s1-none across Opus, Sol and particle-1: blocks, a no-block after the one follow-up, a lenient parse and a web
//   contaminated session;
// - s1-smoke: lens, plan-devex-review and autoplan (a persona answer), an arm stop and its retry, an infrastructure
//   failure and its retry, a per-model stop on Sol from the control file while the other models go on, and an arm stop
//   that leaves the lease open for the next lens session;
// - s1-resmoke with the Stop hook repair: the hook blocks at most twice, then a cap stop on the lease halts the batch.
// Usage: bun session-dry.ts. Prints {"lines": [...]} as JSON. Everything lives in one temporary dir, removed at the end.
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordApproval } from "../../../src/runner/ledger/ledger.ts";
import { LocalLedger } from "../../../src/runner/ledger/local.ts";
import { readItem } from "../../../src/runner/ledger/record.ts";
import { MeteringProxy } from "../../../src/runner/proxy/metering-proxy.ts";
import { DEFAULT_POLICY, loadPolicy, type LoadedPolicy } from "../../../src/skill-eval/cli/policy.ts";
import type { HostRig } from "../../../src/skill-eval/cli/run-host.ts";
import { hostDriver, type HostDriverOptions } from "../../../src/adapters/host.ts";
import { DISALLOWED_TOOLS } from "../../../src/adapters/claude-code/driver.ts";
import { buildDxTree, DX_PROMPT_SHA256, dxPrompt, dxTaskId } from "../../../src/trial/review/devex.ts";
import { recoverRun } from "../../../src/trial/proxy.ts";
import type { Sandbox } from "../../../src/trial/sandbox.ts";
import { STATE_ROOT_DIR } from "../../../src/trial/state-root.ts";
import { ITEMS, openRun } from "../leases.ts";
import { MODEL_STRINGS, type ArmId, type DryCheck } from "../types.ts";
import { standInPin } from "./checks.ts";
import { dxPlan, runDxSessions, type DxTree } from "./session.ts";
import type { DxRow } from "./rows.ts";

const REPO = join(import.meta.dir, "..", "..", "..");
const CLI = join(REPO, "node_modules", "@anthropic-ai", "claude-agent-sdk-" + process.platform + "-" + process.arch, "claude");
const KEYS = { ANTHROPIC_API_KEY: "dryrun-anthropic-not-a-key", OPENAI_API_KEY: "dryrun-openai-not-a-key", OPENROUTER_API_KEY: "dryrun-openrouter-not-a-key" };
const TOKEN = "management-token-0123456789abcdef";
const FENCE = "\u0060\u0060\u0060";
const BLOCK = FENCE + "plan-changes\n" + JSON.stringify({ changes: ["Print the missing runtime and its install command on first run.", "Add a dry-run flag to the migrate command."] }) + "\n" + FENCE;
const LENIENT = FENCE + "json\n[\"Name the config file in every error.\", \"Ship an upgrade note.\",]\n" + FENCE;
const T = (rule: string, parts: Array<[boolean, string]>): DryCheck => ({ rule, pass: parts.every(([ok]) => ok), detail: parts.map(([ok, what]) => (ok ? "ok: " : "FAILED: ") + what).join("; ") });

type Block = Record<string, unknown>;
type Reply = { blocks: Block[] } | { status: number; error: string };
/** One session's script: its reply at each main-agent turn (the last one repeats). */
type Script = (turn: number) => Reply;
const say = (text: string): Reply => ({ blocks: [{ type: "text", text }] });
const always = (r: Reply): Script => () => r;
const SCRIPTS: Record<string, Script[]> = {
  "none@opus": [always(say("Review.\n\n" + BLOCK)), always(say("A review with no closing block."))],
  "none@sol": [always(say("Review.\n\n" + BLOCK)), always(say("Review.\n\n" + LENIENT))],
  "none@particle": [always(say("Review.\n\n" + BLOCK)), always({ blocks: [{ type: "server_tool_use", id: "srvtoolu_dx1", name: "web_search", input: { query: "cli init" } }, { type: "web_search_tool_result", tool_use_id: "srvtoolu_dx1", content: [{ type: "web_search_result", url: "https://example.com", title: "x", encrypted_content: "x" }] }, { type: "text", text: "Looked it up.\n\n" + BLOCK }] })],
  "lens@opus": [always(say("Review.\n\n" + BLOCK)), always(say("Review.\n\n" + BLOCK))],
  "plan-devex-review@opus": [always(say("Review.\n\n" + BLOCK)), always({ status: 400, error: "prompt is too long: 210000 tokens > 200000 maximum" }), always(say("Review.\n\n" + BLOCK)), always(say("No procedure shown yet.\n\n" + BLOCK)), always(say("Review.\n\n" + BLOCK))],
  "autoplan@opus": [(t) => (t === 0 ? { blocks: [{ type: "tool_use", id: "toolu_gate1", name: "AskUserQuestion", input: { questions: [{ question: "Approve the revised plan?", header: "Gate", multiSelect: false, options: [{ label: "Hold", description: "Stop here" }, { label: "Approve", description: "Accept every change (recommended)" }] }] } }] } : say("Applied.\n\n" + BLOCK)), always({ status: 529, error: "Overloaded" }), always(say("Review.\n\n" + BLOCK))],
  "plan-devex-review@sol": [always(say("Review.\n\n" + BLOCK))],
  "plan-devex-review@particle": [always(say("Review.\n\n" + BLOCK))],
};

function sse(body: Record<string, any>, blocks: Block[]): Response {
  const usage = { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  const stop = blocks.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn";
  const msg = { id: "msg_dx_" + Math.random().toString(36).slice(2), type: "message", role: "assistant", model: body.model, content: [] as unknown[], stop_reason: null, stop_sequence: null, usage };
  if (!body.stream) return Response.json({ ...msg, content: blocks, stop_reason: stop });
  const ev: [string, unknown][] = [["message_start", { type: "message_start", message: msg }]];
  blocks.forEach((b, index) => {
    if (b.type === "text") {
      ev.push(["content_block_start", { type: "content_block_start", index, content_block: { type: "text", text: "" } }]);
      ev.push(["content_block_delta", { type: "content_block_delta", index, delta: { type: "text_delta", text: b.text } }]);
    } else if (b.type === "tool_use") {
      ev.push(["content_block_start", { type: "content_block_start", index, content_block: { ...b, input: {} } }]);
      ev.push(["content_block_delta", { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: JSON.stringify(b.input) } }]);
    } else ev.push(["content_block_start", { type: "content_block_start", index, content_block: b }]);
    ev.push(["content_block_stop", { type: "content_block_stop", index }]);
  });
  ev.push(["message_delta", { type: "message_delta", delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 50 } }]);
  ev.push(["message_stop", { type: "message_stop" }]);
  return new Response(ev.map(([n, e]) => "event: " + n + "\ndata: " + JSON.stringify(e) + "\n\n").join(""), { headers: { "content-type": "text/event-stream" } });
}

/** The arm a conversation runs, from its user text: the CLI expands a gstack arm's slash line, so its skill name stands in. */
const ARM_OF = (text: string): ArmId | null => (!text.includes(dxPrompt("none")) && !/plan-devex-review|autoplan/.test(text) ? null : /\bautoplan\b/.test(text) ? "autoplan" : /plan-devex-review/.test(text) ? "plan-devex-review" : text.includes(dxPrompt("lens")) ? "lens" : "none");
const MODEL_OF = (m: string) => (Object.entries(MODEL_STRINGS).find(([, s]) => m === s || m.endsWith(s))?.[0] ?? null);
const flat = (c: unknown): string => (typeof c === "string" ? c : Array.isArray(c) ? c.map((b) => (typeof b?.text === "string" ? b.text : typeof b?.content === "string" ? b.content : "")).join("\n") : "");

interface Seen {
  workTop: string[];
  planHead: string;
  root: string | null;
  homeSkills: string[];
  /** Files under the harness's gstack state root in the work dir. */
  state: string[];
  gstackEnv: string[];
}
const walk = (d: string, rel = ""): string[] => (existsSync(join(d, rel)) ? readdirSync(join(d, rel), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(d, rel ? rel + "/" + e.name : e.name) : [rel ? rel + "/" + e.name : e.name])) : []);

async function main(): Promise<DryCheck[]> {
  const root = mkdtempSync(join(tmpdir(), "dx-session-dry-"));
  const lines: DryCheck[] = [];
  const procs: { kill: () => void }[] = [];
  try {
    if (!existsSync(CLI)) return [T("the session path runs the CLI the pinned Agent SDK bundles", [[false, CLI + " is not installed (bun install)"]])];
    const units = join(root, "units");
    const ids = Array.from({ length: 16 }, (_, i) => "c" + String(i + 1).padStart(2, "0"));
    for (const id of ids) {
      mkdirSync(join(units, id, "repo", "src"), { recursive: true });
      writeFileSync(join(units, id, "unit.json"), JSON.stringify({ id }));
      writeFileSync(join(units, id, "key.json"), JSON.stringify({ items: ["never mounted"] }));
      writeFileSync(join(units, id, "alias.json"), JSON.stringify({ entries: [] }));
      writeFileSync(join(units, id, "plan.md"), "# Plan " + id + "\n\nAdd an init command to the CLI.\n");
      writeFileSync(join(units, id, "repo", "src", "cli.ts"), "export {};\n");
    }
    const trees: Record<string, DxTree> = {};
    for (const id of ids) {
      const task = dxTaskId(id);
      buildDxTree(units, id, "none", join(root, "trees", task, "plain"));
      buildDxTree(units, id, "autoplan", join(root, "trees", task, "autoplan"));
      trees[id] = { task, plain: join(root, "trees", task, "plain"), autoplan: join(root, "trees", task, "autoplan") };
    }
    const pin = join(root, "pin");
    standInPin(pin);
    const record = join(root, "record");
    for (const i of ITEMS) if (i.run_id) recordApproval(record, { action: "init", item: i.id, cap_micros: i.cap_micros, quotes: [{ words: "dry run on a temporary ledger", by: "dx dryrun", source: "devex prereg section 15 rule 4" }], admission: "warn" });
    const local = LocalLedger.open(join(root, "ledger.sqlite"));
    const policy = loadPolicy(DEFAULT_POLICY) as LoadedPolicy;
    const plan = (run: "s1-none" | "s1-smoke" | "s1-resmoke", pick: string[], resmoke: ArmId[] = []) => {
      const p = dxPlan(run, ids, resmoke);
      if ("problem" in p) throw new Error(p.problem);
      return pick.map((id) => p.sessions.find((s) => s.id === id) ?? (() => { throw new Error("no planned session " + id); })());
    };
    const ordinal: Record<string, number> = {};
    const captured: HostDriverOptions[] = [];
    const seen = new Map<string, Seen>();
    let onFirst: (key: string) => void = () => {};
    let beforeBind: (task: string) => void | Promise<void> = () => {};

    const batch = async (run: "s1-none" | "s1-smoke" | "s1-resmoke", sessions: ReturnType<typeof plan>, repairs: Map<ArmId, "stop hook"> = new Map()) => {
      const opened = openRun(record, local, { run, opened: [], mdd: () => Number.POSITIVE_INFINITY });
      if (!opened.admission.ok || !opened.lease_id) throw new Error(run + " was not admitted: " + (opened.admission.ok ? "no lease" : opened.admission.stop));
      const lease = opened.lease_id;
      const out = join(root, "out", run);
      const control = join(out, "control.ndjson");
      const dir = join(root, "proxy-" + run);
      mkdirSync(dir, { recursive: true });
      const proxy = new MeteringProxy({
        ledger: local, leaseId: lease, host: "127.0.0.1", managementSocket: join(dir, "m.sock"), managementToken: TOKEN, journal: join(dir, "journal.ndjson"), retry: { attempts: 1, elapsed_ms: 10_000 }, env: KEYS,
        fetch: async (url: string, init: RequestInit) => {
          const body = JSON.parse(String(init.body ?? "{}"));
          if (!new URL(url).pathname.endsWith("/v1/messages")) return Response.json({ data: [] });
          if (!(body.tools ?? []).some((t: { name: string }) => t.name === "Bash")) return sse(body, [{ type: "text", text: "ok" }]);
          const messages = body.messages ?? [];
          const arm = ARM_OF(messages.filter((m: { role: string }) => m.role === "user").map((m: { content: unknown }) => flat(m.content)).join("\n"));
          const model = MODEL_OF(String(body.model));
          const key = arm + "@" + model;
          const turn = messages.filter((m: { role: string }) => m.role === "assistant").length;
          if (turn === 0) {
            ordinal[key] = (ordinal[key] ?? -1) + 1;
            onFirst(key);
          }
          const script = SCRIPTS[key]?.[ordinal[key] ?? 0];
          const reply = script ? script(turn) : say("Unscripted " + key + ".\n\n" + BLOCK);
          if ("status" in reply) return new Response(JSON.stringify({ type: "error", error: { type: reply.status === 529 ? "overloaded_error" : "invalid_request_error", message: reply.error } }), { status: reply.status, headers: { "content-type": "application/json" } });
          return sse(body, reply.blocks);
        },
      } as ConstructorParameters<typeof MeteringProxy>[0]);
      proxy.start();
      procs.push({ kill: () => proxy.stop() });
      const install = (arm: ArmId) => (home: string) => {
        if (arm !== "plan-devex-review" && arm !== "autoplan") return;
        for (const d of ["gstack/bin", arm]) mkdirSync(join(home, ".claude", "skills", d), { recursive: true });
        writeFileSync(join(home, ".claude", "skills", "gstack", "VERSION"), "1.98.0.0\n");
        writeFileSync(join(home, ".claude", "skills", arm, "SKILL.md"), "---\nname: " + arm + "\ndescription: stand-in\n---\nStand-in.\n");
      };
      const sandbox = (arm: ArmId): Sandbox => {
        let atRoot: string | null = null;
        const box: Sandbox = {
          isolation: "process",
          workPath: (w) => w,
          fixturesPath: (f) => f,
          homePath: (d) => join(d, "home"),
          atWorkRoot: (r) => ((atRoot = r), box),
          step(_role, command, _task, o) {
            const r = spawnSync("sh", ["-c", command], { cwd: o.work, env: o.env, timeout: o.timeoutMs, encoding: "utf8" });
            return { exitCode: r.status ?? 1, timedOut: false, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
          },
          agent(task, o) {
            mkdirSync(o.env.HOME!, { recursive: true });
            install(arm)(o.env.HOME!);
            const skills = existsSync(join(o.env.HOME!, ".claude", "skills")) ? readdirSync(join(o.env.HOME!, ".claude", "skills")).sort() : [];
            seen.set(o.work, { workTop: readdirSync(o.work).sort(), planHead: existsSync(join(o.work, "plan.md")) ? readFileSync(join(o.work, "plan.md"), "utf8").split("\n")[0]! : "", root: atRoot, homeSkills: skills, state: walk(join(o.work, STATE_ROOT_DIR)).sort(), gstackEnv: Object.keys(o.env).filter((k) => k.startsWith("GSTACK_")).sort() });
            return {
              exec: (command, timeoutMs) => {
                const r = spawnSync("sh", ["-c", command], { cwd: o.work, env: o.env, timeout: timeoutMs, encoding: "utf8" });
                return { exitCode: r.status ?? 1, timedOut: false, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
              },
              spawn: (argv, extra = {}) => spawn(argv[0] === "claude" ? CLI : argv[0]!, argv.slice(1), { cwd: o.work, env: { ...o.env, PATH: process.env.PATH ?? o.env.PATH!, ...extra }, stdio: ["pipe", "pipe", "pipe"] }),
              stop() {},
            };
          },
        };
        return box;
      };
      const gstackArm = (arm: string) => ({ tree_sha256: arm + "-tree", skill: { roots: [".claude/skills/" + arm], skillMd: ".claude/skills/" + arm + "/SKILL.md", dir: null as unknown as string, file: "" }, gstack: ".claude/skills/gstack/bin/gstack-skill-start", plugins: [] });
      const bare = (arm: string) => ({ tree_sha256: arm + "-tree", skill: null, gstack: null, plugins: [] });
      const rig: HostRig = {
        baseUrl: "http://127.0.0.1:" + proxy.port, network: null, imageDigest: null,
        bind: async (request) => {
          await beforeBind(request.cell.task);
          return proxy.bind(request);
        },
        finalize: (m) => proxy.finalize(m),
        arms: { none: bare("none"), lens: bare("lens"), "plan-devex-review": gstackArm("plan-devex-review"), autoplan: gstackArm("autoplan") } as HostRig["arms"],
        sandbox: (arm) => sandbox(arm as ArmId),
        judgeSandbox: () => sandbox("none"),
        egress: () => ({ open: false, detail: "dry run" }),
        close: async () => ({ committed: 0, unknown: 0, lease_id: lease }),
        recovery: null,
        driver: (o) => {
          captured.push(o);
          return hostDriver(o);
        },
      };
      const live = await runDxSessions({ run, runId: "dx-s1-runs", sessions, trees, rig, ledger: local, record, lease, policy, out, parallel: 1, doubled: false, repairs, pin, control, log: () => {} });
      const leaseOpenBefore = local.getLease(lease)?.state === "open";
      const { settled: done } = await recoverRun({ stopProxy: () => proxy.stop(), journal: join(dir, "journal.ndjson"), ledger: local, settle: () => live.settle() });
      return { live, done, lease, out, control, leaseOpenBefore, settledState: local.getLease(lease)?.state ?? null, rows: live.rows };
    };
    const row = (rows: readonly DxRow[], id: string) => rows.find((r) => r.session === id);
    const sessionsOf = (out: string) => readFileSync(join(out, "sessions.ndjson"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));

    // ---- s1-none ----
    const nonePick = ["c01:opus:none:1", "c01:sol:none:1", "c01:particle:none:1", "c02:opus:none:1", "c02:sol:none:1", "c02:particle:none:1"];
    const before = readItem(record, "dx-s1-runs").committed_micros;
    const n = await batch("s1-none", plan("s1-none", nonePick));
    const nItem = readItem(record, "dx-s1-runs");
    const nIds = nonePick;
    const nRows = n.rows;
    const noneSessions = sessionsOf(n.out);
    lines.push(T("session path: an s1-none batch across Opus, Sol and particle-1 runs the real driver behind the metering proxy on one lease, opened by openRun and settled at the end", [
      [nRows.length === 6 && nIds.every((id) => !!row(nRows, id)), "one row per planned session (" + nRows.length + " of 6)"],
      [["c01:opus:none:1", "c01:sol:none:1", "c01:particle:none:1"].every((id) => row(nRows, id)?.end === "block" && (row(nRows, id)?.spend_micros ?? 0) > 0), "each model's first session is a block, metered on the lease"],
      [n.leaseOpenBefore && n.settledState === "settled" && !!n.done.close && nItem.committed_micros > before && nItem.open === null, "the lease stayed open until the batch settled, then settled at " + (n.done.close ? "$" + (n.done.close.spent_micros / 1e6).toFixed(4) : "nothing") + " on dx-s1-runs"],
      [noneSessions.every((s) => s.prompt_sha256 === DX_PROMPT_SHA256.none), "every none session ran dxPrompt(none) byte for byte"],
    ]));
    const nb = row(nRows, "c02:opus:none:1");
    const len = row(nRows, "c02:sol:none:1");
    const web = row(nRows, "c02:particle:none:1");
    lines.push(T("session path: a no-block after the one follow-up, a lenient parse and a web-contaminated session each end in their section 6 row", [
      [nb?.end === "no-block" && nb.code === "E_DX_NO_BLOCK" && nb.answers?.finish === true && !nb.retried, "a completed reply with no block got the follow-up once, then reads no-block, E_DX_NO_BLOCK, never retried"],
      [len?.end === "block" && (len.list?.length ?? 0) === 2, "a json fence holding a bare array with a trailing comma parses leniently and is scored"],
      [web?.end === "contaminated" && web.code === "E_DX_WEB_CONTAMINATED" && !web.retried, "a successful web tool result reads contaminated, E_DX_WEB_CONTAMINATED, never retried"],
    ]));

    // ---- s1-smoke ----
    let wrote = false;
    let wrote2 = false;
    onFirst = (key) => {
      const ctl = join(root, "out", "s1-smoke", "control.ndjson");
      if (key === "plan-devex-review@sol" && !wrote) {
        wrote = true;
        appendFileSync(ctl, JSON.stringify({ code: "E_DX_PROVIDER_DRIFT", model: "sol", why: "dry run: Sol served by another provider" }) + "\n");
      }
      if (key === "plan-devex-review@particle" && !wrote2) {
        wrote2 = true;
        appendFileSync(ctl, JSON.stringify({ code: "E_DX_ARM_DROPPED", arm: "autoplan", why: "dry run: autoplan dropped after a failed repair" }) + "\n");
      }
    };
    const smokePick = ["c09:opus:lens:1", "c01:opus:plan-devex-review:1", "c01:opus:autoplan:1", "c02:opus:plan-devex-review:1", "c02:opus:autoplan:1", "c07:sol:plan-devex-review:1", "c07:sol:autoplan:1", "c07:particle:plan-devex-review:1", "c07:particle:autoplan:1", "c08:sol:plan-devex-review:1", "c10:opus:lens:1"];
    const capBefore = captured.length;
    const s = await batch("s1-smoke", plan("s1-smoke", smokePick));
    const sRows = s.rows;
    const smokeOpts = captured.slice(capBefore);
    const smokeSessions = sessionsOf(s.out);
    const armOpts = (arm: ArmId) => smokeOpts.filter((o) => (arm === "lens" ? o.skill === null : o.skill?.name === arm));
    const works = [...seen.entries()].filter(([w]) => w.includes(join("out", "s1-smoke")));
    const workOf = (arm: ArmId) => works.filter(([w]) => w.includes(join("/", arm, "/")) || w.includes("/" + arm + "/"));
    const pdr = row(sRows, "c01:opus:plan-devex-review:1");
    const ap = row(sRows, "c01:opus:autoplan:1");
    lines.push(T("session path: an s1-smoke batch reaches lens, plan-devex-review and autoplan (none ran in s1-none) with each arm's prompt sha, env, session kind record and mounts", [
      [(["lens", "plan-devex-review", "autoplan"] as ArmId[]).every((a) => smokeSessions.some((x) => x.session.endsWith(":" + a + ":1") && x.prompt_sha256 === DX_PROMPT_SHA256[a])), "each arm ran dxPrompt(arm) byte for byte"],
      [armOpts("lens").every((o) => o.sessionKind === undefined && o.skill === null) && armOpts("plan-devex-review").every((o) => o.sessionKind === "unattended") && armOpts("autoplan").every((o) => o.sessionKind === "interactive") && smokeOpts.every((o) => o.disable1mContext === true && o.systemPrompt === "claude-code-preset" && o.maxTurns === 200 && o.capStops === true && o.memoryLog === true), "GSTACK_SESSION_KIND unattended for plan-devex-review, interactive for autoplan and unset for lens; the 1M context off, the preset system prompt, 200 turns and cap stops in every arm"],
      [pdr?.session_kind === "unattended" && pdr.lean === null && ap?.session_kind === "interactive" && ap.lean === true && row(sRows, "c09:opus:lens:1")?.session_kind === null, "the rows record unattended for plan-devex-review and interactive with lean mode for autoplan, from the pin's own script in the session's env"],
      [works.length > 0 && works.every(([, v]) => v.root === "/work" && v.workTop.join(",") === (v.homeSkills.length ? STATE_ROOT_DIR + ",plan.md,repo" : "plan.md,repo") && v.state.every((f) => /^\.[a-z-]+$|^config\.yaml$|^global-question-preferences\.json$/.test(f))) && workOf("autoplan").length > 0 && workOf("autoplan").every(([, v]) => v.planHead === "## Implementation plan" && v.state.includes("global-question-preferences.json")) && workOf("lens").every(([, v]) => v.planHead.startsWith("# Plan") && v.homeSkills.length === 0 && !v.state.includes("global-question-preferences.json")), "every session's work dir is mounted at /work; a gstack arm's holds plan.md, repo/ and the harness's " + STATE_ROOT_DIR + " state root (onboarding markers and config.yaml, no skill, bin or instruction file), and lens's holds plan.md and repo/ only; key.json, alias.json and unit.json are absent; autoplan sees the wrapped plan and the plan-tune state pinned empty; lens has no skills folder and no plan-tune file"],
      [DISALLOWED_TOOLS.includes("WebSearch") && DISALLOWED_TOOLS.includes("WebFetch"), "the driver denies WebSearch and WebFetch"],
      [[...seen.entries()].some(([w]) => w.includes("/none/")) && [...seen.entries()].filter(([w]) => /\/(none|lens)\//.test(w)).every(([, v]) => v.workTop.join(",") === "plan.md,repo" && v.state.length === 0 && v.gstackEnv.length === 0) && [...seen.entries()].filter(([w]) => /\/(plan-devex-review|autoplan)\//.test(w)).every(([, v]) => v.gstackEnv.includes("GSTACK_STATE_ROOT") && v.gstackEnv.includes("GSTACK_HOME")), "none and lens sessions in both batches see plan.md and repo/ only, with no gstack state root and no GSTACK_STATE_ROOT or GSTACK_HOME in their env; the gstack arms keep both"],
      [ap?.answers !== null && (ap?.answers?.asks ?? 0) >= 1 && (ap?.answers?.recommended ?? 0) >= 1 && ap?.end === "block", "autoplan's gate question got the option marked recommended from the rec persona, counted on its row"],
    ]));
    const stopRow = row(sRows, "c02:opus:plan-devex-review:1");
    const infraRow = row(sRows, "c02:opus:autoplan:1");
    const recoveries = existsSync(join(s.out, "recoveries.ndjson")) ? readFileSync(join(s.out, "recoveries.ndjson"), "utf8").split("\n").filter(Boolean) : [];
    lines.push(T("session path: an arm stop and its retry, and an infrastructure failure and its retry, each end in their section 6 row", [
      [stopRow?.retried === true && stopRow.reasons[0] === "context overflow" && stopRow.end === "block", "a context overflow is an arm stop retried once under its reason, and the retry's block is scored (" + (stopRow?.reasons.join(", ") ?? "no row") + ")"],
      [infraRow?.retried === true && (infraRow.reasons[0] === "API error" || infraRow.reasons[0] === "crash") && infraRow.end === "block" && recoveries.length === 1, "a provider error is infra, logged to recoveries.ndjson before its one retry on the same lease, and the retry's block is scored (" + (infraRow?.reasons.join(", ") ?? "no row") + ")"],
    ]));
    const sol7 = row(sRows, "c07:sol:autoplan:1");
    const sol8 = row(sRows, "c08:sol:plan-devex-review:1");
    const par = row(sRows, "c07:particle:plan-devex-review:1");
    const apPar = row(sRows, "c07:particle:autoplan:1");
    const lens10 = row(sRows, "c10:opus:lens:1");
    const log = s.live.batch.log;
    const armStopAt = log.findIndex((l) => l.event === "arm-stop");
    const lensStart = log.findIndex((l) => l.event === "start" && l.detail === "c10:opus:lens:1");
    lines.push(T("session path: a per-model stop on the shared smoke lease stops Sol while Opus and particle-1 go on; an arm stop leaves the lease open for the other arms", [
      [sol7?.end === "missing" && sol7.code === "E_DX_PROVIDER_DRIFT" && sol8?.code === "E_DX_PROVIDER_DRIFT" && s.live.batch.modelSettled.has("sol"), "Sol's scope is stopped and settled once its sends ended; its unrun sessions are released as missing"],
      [par?.end === "block" && lens10?.end === "block", "particle-1 and Opus sessions run after Sol's stop"],
      [apPar?.end === "missing" && apPar.code === "E_DX_ARM_DROPPED" && armStopAt >= 0 && lensStart > armStopAt, "after autoplan's arm stop, its unrun session is released and a lens session still runs on the open lease"],
      [s.settledState === "settled" && s.done.released.length === 3, "the lease settles at the end and releases the 3 stopped sessions"],
    ]));

    // ---- s1-resmoke: the Stop hook, then a cap stop ----
    onFirst = () => {};
    const rPick = ["c04:opus:plan-devex-review:2", "c05:opus:plan-devex-review:2", "c06:opus:plan-devex-review:2"];
    let spentDown = false;
    beforeBind = async (task) => {
      if (task !== dxTaskId("c05") || spentDown) return;
      spentDown = true;
      const leaseId = readItem(record, "dx-s1-runs").open!.lease_id;
      for (let i = 0; i < 400; i++) {
        const r = await local.reserve({ idempotency_key: "dry-spend-" + i, lease_id: leaseId, cell: { run_id: "dx-s1-runs", arm: "dry", task: "spend-down", model: MODEL_STRINGS.opus, trial: 1, attempt: 1, meter_id: "dry" }, max_micros: 1_000_000 });
        if (!r.ok) break;
        await local.settle(r.reservation.reservation_id, { kind: "spent", spent_micros: 1_000_000, usage: { input: 1, output: 1, reasoning: 0, cache_read: 0, cache_write: 0 } });
      }
    };
    const r = await batch("s1-resmoke", plan("s1-resmoke", rPick, ["plan-devex-review"]), new Map([["plan-devex-review", "stop hook"]]));
    const hooked = row(r.rows, "c04:opus:plan-devex-review:2");
    const hookDir = readFileSync(join(r.out, "sessions.ndjson"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).find((x) => x.session === "c04:opus:plan-devex-review:2")?.dir;
    const hookLog = hookDir && existsSync(join(hookDir, "host", "stop-hook.ndjson")) ? readFileSync(join(hookDir, "host", "stop-hook.ndjson"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
    const capRow = row(r.rows, "c05:opus:plan-devex-review:2");
    const released = row(r.rows, "c06:opus:plan-devex-review:2");
    lines.push(T("session path: under --repair plan-devex-review=stop-hook the Stop hook blocks an unexposed stop at most twice, and the row names the repair", [
      [hookLog.filter((h) => h.blocked).length === 2 && hookLog.length >= 3 && hookLog.at(-1)?.blocked === false, "stop-hook.ndjson shows 2 blocks, then the stop goes through (" + hookLog.length + " decisions)"],
      [hooked?.end === "block" && hooked.repair === "with an enforced procedure", "the session is scored on its block and its row carries \"with an enforced procedure\""],
    ]));
    lines.push(T("session path: a cap stop on the lease is missing under the ledger's CAP_STOP, halts the batch and is never retried", [
      [capRow?.end === "missing" && capRow.code === "CAP_STOP" && !capRow.retried, "the capped session reads missing, CAP_STOP, no retry"],
      [released?.end === "missing" && released.code === "CAP_STOP" && r.done.released.includes("c06:opus:plan-devex-review:2"), "the session after it never starts and is released at settle"],
      [r.settledState === "settled", "the lease settles"],
    ]));
    local.close();
  } catch (e) {
    lines.push(T("session path: the end-to-end batches ran", [[false, ((e as Error).stack ?? String(e)).split("\n").slice(0, 3).join(" | ")]]));
  } finally {
    for (const p of procs) {
      try {
        p.kill();
      } catch {}
    }
    rmSync(root, { recursive: true, force: true });
  }
  return lines;
}

if (import.meta.main) {
  const lines = await main();
  process.stdout.write(JSON.stringify({ lines }) + "\n");
  process.exit(0);
}
