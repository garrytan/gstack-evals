// The review-models eval's keyless rig check (GEVA-590 prereg, "Pilots"): before any paid call it shows, for each cell
// in rm-cells.ts, that
//
// 1. the run gives the cell what it should: review-units' own run loop (runReviewUnits) on a 200-line toy unit, with the
//    cells armCells builds from --arm-voice and --voice-cli and a stand-in driver that records each session's options,
//    gives each cell its model, its voice (on the slot's allowlist and in the driver's codex option), Codex from the
//    voice CLI directory first on PATH, GSTACK_CODEX_NO_SANDBOX=1, and a session key no other cell has;
// 2. Claude Code resolves the cell's model for the session and for subagents: the real Claude Code CLI the Agent SDK
//    bundles runs a session with exactly those options against a stub Messages API, launches one foreground subagent,
//    and every request it sends names the cell's model;
// 3. in a voice cell, in that same session, gstack's probe (bin/gstack-codex-probe select-model exec at the pin) prints
//    CODEX_MODEL with the cell's voice read from the config.toml the driver wrote, and Codex reports its version;
// 4. both Codex calls fire on the 200-line toy diff: the session runs the pinned review/sections/adversarial.md blocks
//    (diff size, the Codex preflight, the adversarial challenge and the structured review) through the real Codex CLI
//    against a stub Responses API, each pass prints OUTSIDE_STATUS: completed, every request names the voice, the two
//    passes ask for effort high, and rm-exposure.ts reads both passes from the session's own records as exposed.
//
// Nothing calls a model: both APIs are stubs on loopback, and the sessions run as local processes, not in the trial
// image, with bun's directory added to PATH for gstack's scripts. It needs a gstack checkout at the pin and the Codex
// binary the voice runs (Codex 0.170.0 from the trial image's /opt/codex-0.170.0/bin, copied out with docker cp).
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { claudeCodeEnv } from "../../adapters/claude-code/driver.ts";
import { hostDriver, type HostDriverOptions } from "../../adapters/host.ts";
import type { ArmInstall } from "../../arms/install.ts";
import { recipeHash, recipeInputs } from "../../rig/recipe.ts";
import { adapterSha256, armCells, type HostRig } from "../../skill-eval/cli/run-host.ts";
import { DEFAULT_POLICY, loadPolicy, type LoadedPolicy } from "../../skill-eval/cli/policy.ts";
import { dirTreeSha256 } from "../cache.ts";
import { trialEnv } from "../env.ts";
import type { AgentSession, Sandbox } from "../sandbox.ts";
import { seedStateRoot, STATE_ROOT_DIR } from "../state-root.ts";
import type { AgentOutcome } from "../trial.ts";
import { loadReaderMap, type ReaderMap } from "./readers.ts";
import { exposure, readRollouts } from "./rm-exposure.ts";
import { RM_CELLS, RM_CODEX_DIR, RM_CODEX_VERSION, RM_GSTACK, RM_READER_MAP, type RmCell } from "./rm-cells.ts";
import { runReviewUnits, type PreparedUnit } from "./run.ts";
import { unitTaskId } from "./unit.ts";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
/** The Claude Code CLI the Agent SDK in package.json bundles (2.1.314). */
export const SDK_CLAUDE = join(REPO, "node_modules", "@anthropic-ai", "claude-agent-sdk-" + process.platform + "-" + process.arch, "claude");
export const TOY_LINES = 200;
const SUB_MARK = "RM_CHECK_SUBAGENT";
export const OUTSIDE_TEXT = "No findings.\nRecommendation: Ship as-is because no finding blocks a test, production or data.\nVERDICT: CLEAN";

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

export interface CellReport {
  cell: RmCell;
  checks: Check[];
}

export interface CellCheckOptions {
  /** A set-up gstack checkout at RM_GSTACK.sha. */
  gstack: string;
  /** The directory holding the codex the voice runs. */
  codexDir: string;
  /** The version codex --version must print; null accepts any (a test on another Codex). */
  codexVersion: string | null;
  /** The voice CLI directory the cells name (rm-cells' RM_CODEX_DIR in a run); the local sessions run codexDir in its place. */
  voiceCliDir?: string;
  claude?: string;
  /** Where the toy unit, the run loop's records and each session's records go: a fresh directory that outlives the machine, as review-units' out dir must. */
  work: string;
  policy?: LoadedPolicy;
  log?: (line: string) => void;
}

const sh = (s: string) => "'" + s.replace(/'/g, "'\\''") + "'";
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const git = (cwd: string, ...args: string[]) => {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: cwd, GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "rm-check", GIT_AUTHOR_EMAIL: "rm-check@example.invalid", GIT_COMMITTER_NAME: "rm-check", GIT_COMMITTER_EMAIL: "rm-check@example.invalid", GIT_AUTHOR_DATE: "2026-11-24T00:00:00Z", GIT_COMMITTER_DATE: "2026-11-24T00:00:00Z" } });
  if (r.status !== 0) throw new Error("E_CELL_CHECK: git " + args.join(" ") + " failed: " + (r.stderr || r.stdout).trim());
  return r.stdout.trim();
};

/** A toy repository whose branch adds TOY_LINES lines on top of main, with origin/main at main, as a unit repo has. */
export function toyRepo(dir: string): { head: string; base: string } {
  mkdirSync(join(dir, "src"), { recursive: true });
  git(dir, "init", "-q", "-b", "main");
  writeFileSync(join(dir, "src", "app.ts"), "export const app = 1;\n");
  git(dir, "add", "src");
  git(dir, "commit", "-q", "-m", "base");
  const base = git(dir, "rev-parse", "HEAD");
  git(dir, "checkout", "-q", "-b", "pr-1");
  writeFileSync(join(dir, "src", "feature.ts"), Array.from({ length: TOY_LINES }, (_, i) => "export const f" + i + " = " + i + ";").join("\n") + "\n");
  git(dir, "add", "src");
  git(dir, "commit", "-q", "-m", "feature");
  git(dir, "update-ref", "refs/remotes/origin/main", base);
  writeFileSync(join(dir, ".git", "info", "exclude"), STATE_ROOT_DIR + "/\n");
  return { head: git(dir, "rev-parse", "HEAD"), base };
}

/** The bash block after a marker in a skill section, with <base> and the prompt file filled in. */
export function blockAfter(md: string, marker: string, fill: { base: string; prompt?: string }): string {
  const at = md.indexOf(marker);
  if (at < 0) throw new Error("E_CELL_CHECK: the pinned adversarial.md has no " + JSON.stringify(marker));
  const open = md.indexOf("```bash\n", at);
  const close = md.indexOf("\n```", open + 8);
  if (open < 0 || close < 0) throw new Error("E_CELL_CHECK: no bash block follows " + JSON.stringify(marker) + " in the pinned adversarial.md");
  let block = md.slice(open + 8, close + 1).replaceAll("<base>", fill.base);
  if (fill.prompt !== undefined) block = block.replaceAll("'<prepared-prompt-file>'", sh(fill.prompt));
  if (block.includes("<prepared-prompt-file>")) throw new Error("E_CELL_CHECK: the block after " + JSON.stringify(marker) + " needs a prompt file");
  return block;
}

/** A local process sandbox: no isolation, HOME under the trial dir. The run loop's records need one; the check's sessions never reach it. */
function localSandbox(): Sandbox {
  return {
    isolation: "process",
    workPath: (work) => work,
    fixturesPath: (fixtures) => fixtures,
    homePath: (dir) => join(dir, "home"),
    step(_role, command, _task, o) {
      const r = spawnSync("sh", ["-c", command], { cwd: o.work, env: o.env, timeout: o.timeoutMs, encoding: "utf8" });
      return { exitCode: r.status ?? 1, timedOut: false, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
    },
    agent(_task, o) {
      mkdirSync(o.env.HOME!, { recursive: true });
      return localSession(o.work, o.env, SDK_CLAUDE);
    },
  };
}

function localSession(work: string, env: Record<string, string>, claude: string): AgentSession {
  return {
    exec: (command, timeoutMs, input) => {
      const r = spawnSync("sh", ["-c", command], { cwd: work, env, timeout: timeoutMs, encoding: "utf8", ...(input !== undefined ? { input } : {}) });
      return { exitCode: r.status ?? 1, timedOut: r.error?.message.includes("ETIMEDOUT") ?? false, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
    },
    spawn: (argv, extra = {}) => spawn(argv[0] === "claude" ? claude : argv[0]!, argv.slice(1), { cwd: work, env: { ...env, ...extra }, stdio: ["pipe", "pipe", "pipe"] }),
    stop() {},
  };
}

export interface Recorded {
  options: HostDriverOptions;
  models: string[];
  gstack_config: Record<string, string>;
  key: string;
  parts: Record<string, string>;
}

/** Step 1: the five cells through review-units' run loop with a recording driver, by "<arm> <model>". */
export async function cellRunLoop(o: CellCheckOptions & { policy: LoadedPolicy }, toy: { dir: string; head: string; base: string }): Promise<Map<string, Recorded>> {
  const tree = spawnSync("git", ["-C", o.gstack, "rev-parse", "HEAD^{tree}"], { encoding: "utf8" }).stdout.trim();
  const stack = (name: string): ArmInstall => ({ name, layers: [], tree_sha256: sha256("gstack tree " + tree), skill: null, gstack: ".claude/skills/gstack/bin/gstack-skill-start", plugins: [], provenance: { kind: "stack", stack: { repo: RM_GSTACK.repo, sha: RM_GSTACK.sha } } });
  const installs = [stack("gstack-sol"), stack("gstack-astra")];
  const models = [...new Set(RM_CELLS.map((c) => c.model))];
  const voices = Object.fromEntries(RM_CELLS.filter((c) => c.voice).map((c) => [c.arm, c.voice!]));
  const cells = armCells(installs, models, o.policy, join(o.work, "cells"), { voices, voiceCli: { bin_dir: o.voiceCliDir ?? RM_CODEX_DIR } });
  const slots = new Map<string, { arm: string; model: string; models: string[] }>();
  const seen = new Map<string, HostDriverOptions>();
  let n = 0;
  const rig: HostRig = {
    baseUrl: "http://127.0.0.1:9", network: null, imageDigest: null,
    bind: async (request) => {
      const slot = "slot" + ++n;
      slots.set(slot, { arm: request.cell.arm, model: request.cell.model, models: [...request.models] });
      return { slot, token: "gse_" + randomBytes(32).toString("base64url"), meter_id: "meter" + n };
    },
    finalize: async (meter_id) => ({ meter_id, micros: 0 }) as never,
    arms: { none: { tree_sha256: "bare:none", skill: null, gstack: null, plugins: [] }, ...Object.fromEntries(installs.map((i) => [i.name, { tree_sha256: i.tree_sha256, skill: null, gstack: i.gstack, plugins: [] }])) },
    cells,
    sandbox: () => localSandbox(),
    judgeSandbox: () => localSandbox(),
    egress: () => ({ open: false, detail: "rig check" }),
    close: async () => ({ committed: 0, unknown: 0, lease_id: null }),
    recovery: null,
    driver: (d) => ({
      async run(): Promise<AgentOutcome> {
        const s = slots.get(d.proxy.slot)!;
        seen.set(s.arm + " " + s.model, d);
        return { turns: ["```json\n[]\n```"], termination: { kind: "completed" }, opened: null, files_read: [], asked: [], usage: null, cost_micros: null, agent_turns: 1, loaded_bytes: null };
      },
    }),
  };
  const unit = { id: "rm-check/toy#1@" + toy.head.slice(0, 12), repo: "rm-check/toy", pr: 1, head: toy.head, base: toy.base };
  const prepared: PreparedUnit = { unit, task: unitTaskId(unit), base_branch: "main", merge_base: toy.base, tree: toy.dir, tree_sha256: dirTreeSha256(toy.dir), instructions: {} };
  const out = join(o.work, "run");
  mkdirSync(out, { recursive: true });
  const arms = [{ name: "none", told: "none" as const }, ...installs.map((i) => ({ name: i.name, told: "gstack" as const }))];
  const none = RM_CELLS.filter((c) => c.arm === "none").map((c) => c.model);
  await runReviewUnits({ host: "claude", suite: { id: "rm-check", sha256: null }, units: [prepared], arms, models, armModels: { none }, passes: 1, parallel: 1, timeoutS: 3600, cap: null, runId: "rm-check", out, date: "2026-11-24", policy: o.policy, keyBase: { image_digest: null, recipe: recipeHash(recipeInputs()), host_version: null, adapter_sha256: adapterSha256("claude"), isolation: "docker" }, journal: null, env: {} }, rig, o.log ?? (() => {}));
  const entries = readFileSync(join(out, "cells.ndjson"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as { cell: { arm: string; model: string }; key: { sha256: string; parts: Record<string, string> } });
  const got = new Map<string, Recorded>();
  for (const e of entries) {
    const id = e.cell.arm + " " + e.cell.model;
    const options = seen.get(id);
    const slot = [...slots.values()].find((s) => s.arm === e.cell.arm && s.model === e.cell.model);
    if (options && slot) got.set(id, { options, models: slot.models, gstack_config: cells[e.cell.arm]?.[e.cell.model]?.gstack_config ?? {}, key: e.key.sha256, parts: e.key.parts });
  }
  return got;
}

interface StubRequest {
  api: "messages" | "responses";
  slot: string;
  model: string;
  kind: "main" | "subagent" | "side" | "probe" | "adversarial" | "structured" | "other";
  effort: string | null;
}

const textOf = (v: unknown): string => (typeof v === "string" ? v : Array.isArray(v) ? v.map((b) => (typeof b?.text === "string" ? b.text : "")).join("") : "");

function sse(events: [string, unknown][]): string {
  return events.map(([n, e]) => "event: " + n + "\ndata: " + JSON.stringify(e) + "\n\n").join("");
}

export type Block = { type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };

export function messagesAnswer(body: Record<string, any>, blocks: Block[]): { type: string; body: string } {
  const usage = { input_tokens: 100, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  const stop = blocks.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn";
  const msg = { id: "msg_rm_" + randomBytes(6).toString("hex"), type: "message", role: "assistant", model: body.model, content: [] as unknown[], stop_reason: null, stop_sequence: null, usage };
  if (!body.stream) return { type: "application/json", body: JSON.stringify({ ...msg, content: blocks, stop_reason: stop, usage: { ...usage, output_tokens: 20 } }) };
  const events: [string, unknown][] = [["message_start", { type: "message_start", message: msg }]];
  blocks.forEach((b, index) => {
    if (b.type === "text") {
      events.push(["content_block_start", { type: "content_block_start", index, content_block: { type: "text", text: "" } }]);
      events.push(["content_block_delta", { type: "content_block_delta", index, delta: { type: "text_delta", text: b.text } }]);
    } else {
      events.push(["content_block_start", { type: "content_block_start", index, content_block: { type: "tool_use", id: b.id, name: b.name, input: {} } }]);
      events.push(["content_block_delta", { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: JSON.stringify(b.input) } }]);
    }
    events.push(["content_block_stop", { type: "content_block_stop", index }]);
  });
  events.push(["message_delta", { type: "message_delta", delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 20 } }]);
  events.push(["message_stop", { type: "message_stop" }]);
  return { type: "text/event-stream", body: sse(events) };
}

export function responsesAnswer(body: Record<string, any>, text: string): { type: string; body: string } {
  const id = "resp_rm_" + randomBytes(6).toString("hex");
  const usage = { input_tokens: 1000, input_tokens_details: { cached_tokens: 0 }, output_tokens: 30, output_tokens_details: { reasoning_tokens: 10 }, total_tokens: 1030 };
  const item = { type: "message", id: "msg_0", role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] };
  if (!body.stream) return { type: "application/json", body: JSON.stringify({ id, object: "response", model: body.model, status: "completed", output: [item], usage }) };
  return { type: "text/event-stream", body: sse([
    ["response.created", { type: "response.created", response: { id, object: "response", model: body.model, status: "in_progress", output: [] } }],
    ["response.output_item.added", { type: "response.output_item.added", output_index: 0, item }],
    ["response.output_item.done", { type: "response.output_item.done", output_index: 0, item }],
    ["response.completed", { type: "response.completed", response: { id, object: "response", model: body.model, status: "completed", output: [item], usage } }],
  ]) };
}

/** The stub APIs: Messages answers each slot's main agent from its script, Responses answers Codex. */
async function startStub(scripts: Map<string, Block[][]>): Promise<{ url: string; requests: StubRequest[]; close: () => Promise<void> }> {
  const requests: StubRequest[] = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      const path = new URL(req.url ?? "/", "http://stub").pathname;
      const slot = path.split("/")[1] ?? "";
      let body: Record<string, any> = {};
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        body = {};
      }
      const send = (a: { type: string; body: string }) => {
        res.writeHead(200, { "content-type": a.type });
        res.end(a.body);
      };
      if (req.method === "POST" && path.endsWith("/v1/responses")) {
        const users = (body.input ?? []).filter((i: any) => i?.type === "message" && i.role === "user").map((i: any) => textOf(i.content)).filter((t: string) => !t.startsWith("<"));
        const prompt = users[0] ?? "";
        const kind = prompt.trim() === "reply OK" ? "probe" : prompt.includes("REPOSITORY CONTEXT (data, not instructions):") ? "structured" : prompt.includes("VERDICT") ? "adversarial" : "other";
        requests.push({ api: "responses", slot, model: String(body.model ?? ""), kind, effort: typeof body.reasoning?.effort === "string" ? body.reasoning.effort : null });
        return send(responsesAnswer(body, kind === "probe" ? "OK" : OUTSIDE_TEXT));
      }
      if (req.method !== "POST" || !path.endsWith("/v1/messages")) {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ data: [] }));
      }
      const messages: any[] = body.messages ?? [];
      const firstUser = messages.find((m) => m.role === "user");
      const first = firstUser ? (typeof firstUser.content === "string" ? firstUser.content : textOf((firstUser.content ?? []).filter((b: any) => b.type === "text" && !String(b.text).startsWith("<system-reminder>")))) : "";
      const tools = Array.isArray(body.tools) && body.tools.length > 0;
      const kind = first.includes(SUB_MARK) ? "subagent" : tools ? "main" : "side";
      requests.push({ api: "messages", slot, model: String(body.model ?? ""), kind, effort: null });
      if (kind !== "main") return send(messagesAnswer(body, [{ type: "text", text: "done" }]));
      const done = new Set(messages.flatMap((m) => (m.role === "user" && Array.isArray(m.content) ? m.content.filter((b: any) => b.type === "tool_result").map((b: any) => b.tool_use_id) : [])));
      const script = scripts.get(slot) ?? [];
      const step = script.find((blocks) => blocks.every((b) => b.type !== "tool_use" || !done.has(b.id)));
      return send(messagesAnswer(body, step ?? [{ type: "text", text: "Cell check done." }]));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as AddressInfo).port;
  return { url: "http://127.0.0.1:" + port, requests, close: () => new Promise<void>((r) => server.close(() => r())) };
}

/** The main agent's script for a cell: one foreground subagent, then in a voice cell the probe and the four adversarial.md blocks. */
function scriptFor(voice: boolean, md: string, promptFile: string): Block[][] {
  const bash = (i: number, command: string): Block[] => [{ type: "tool_use", id: "toolu_rm_" + i, name: "Bash", input: { command, description: "rig check step " + i, timeout: 600_000 } }];
  const steps: Block[][] = [[{ type: "tool_use", id: "toolu_rm_0", name: "Agent", input: { description: "rig check subagent", prompt: SUB_MARK + ": reply with the word done.", subagent_type: "general-purpose", run_in_background: false } }]];
  if (!voice) return steps;
  const prompt = "Review the changes on this branch against the base branch. Find ways this code will fail in production. End each finding with Severity and Blocks lines, then a Recommendation line, and end with exactly VERDICT: CLEAN or VERDICT: FINDINGS as the last line.";
  steps.push(bash(1, "codex --version; ~/.claude/skills/gstack/bin/gstack-codex-probe select-model exec"));
  steps.push(bash(2, blockAfter(md, "**Detect diff size:**", { base: "main" })));
  steps.push(bash(3, blockAfter(md, "**Detect the Codex master switch + tool availability:**", { base: "main" })));
  steps.push(bash(4, "cat > " + sh(promptFile) + " <<'RM_PROMPT'\n" + prompt + "\nRM_PROMPT\n" + blockAfter(md, "### Codex adversarial challenge", { base: "main", prompt: promptFile })));
  steps.push(bash(5, blockAfter(md, "### Codex structured review", { base: "main", prompt: promptFile })));
  return steps;
}

/** Each Bash step's result text in a transcript, by tool_use id. */
function results(messages: Record<string, any>[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of messages) for (const b of Array.isArray(m.message?.content) ? m.message.content : []) if (m.type === "user" && b?.type === "tool_result") out.set(b.tool_use_id, textOf(b.content));
  return out;
}

/** Runs the check; every cell gets its checks, and ok is true only when every check passed. */
export async function cellCheck(o: CellCheckOptions): Promise<{ ok: boolean; cells: CellReport[] }> {
  const policy = o.policy ?? (loadPolicy(DEFAULT_POLICY) as LoadedPolicy);
  const claude = o.claude ?? SDK_CLAUDE;
  const head = spawnSync("git", ["-C", o.gstack, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
  if (head !== RM_GSTACK.sha) throw new Error("E_CELL_CHECK: --gstack " + o.gstack + " is at " + (head || "no commit") + ", not the pin " + RM_GSTACK.sha);
  if (!existsSync(claude)) throw new Error("E_CELL_CHECK: no Claude Code CLI at " + claude + "; run bun install --frozen-lockfile");
  if (!existsSync(join(o.codexDir, "codex"))) throw new Error("E_CELL_CHECK: no codex in " + o.codexDir);
  const mapFile = join(dirname(fileURLToPath(import.meta.url)), "reader-maps", RM_READER_MAP);
  const map = (loadReaderMap(mapFile) as { map: ReaderMap }).map;
  const md = readFileSync(join(o.gstack, "review", "sections", "adversarial.md"), "utf8");
  const toyDir = join(o.work, "toy");
  const toy = { dir: toyDir, ...toyRepo(toyDir) };
  const recorded = await cellRunLoop({ ...o, policy }, toy);
  const keys = new Map(RM_CELLS.map((c) => [c.id, recorded.get(c.arm + " " + c.model)?.key ?? null]));
  const scripts = new Map<string, Block[][]>();
  const stub = await startStub(scripts);
  const reports: CellReport[] = [];
  try {
    for (const cell of RM_CELLS) {
      const checks: Check[] = [];
      const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });
      reports.push({ cell, checks });
      const rec = recorded.get(cell.arm + " " + cell.model);
      if (!rec) {
        add("run loop", false, "the run loop ran no session for " + cell.arm + " on " + cell.model);
        continue;
      }
      const d = rec.options;
      const env = claudeCodeEnv({ ...d, provider: d.provider === "openrouter" ? "openrouter" : "anthropic" });
      const voiceOk = cell.voice === null ? !d.codex : d.codex?.model === cell.voice && d.codex.binDir === (o.voiceCliDir ?? RM_CODEX_DIR) && d.codexNoSandbox === true && d.codexRollouts === true;
      add("run loop options", d.model === cell.model && voiceOk, "model " + d.model + "; voice " + (d.codex ? d.codex.model + " from " + d.codex.binDir + (d.codexNoSandbox ? ", no Codex sandbox" : "") + (d.codexRollouts ? ", rollouts copied" : "") : "none"));
      add("slot allowlist", JSON.stringify(rec.models) === JSON.stringify(["anthropic:" + cell.model, ...(cell.voice ? ["openai:" + cell.voice] : [])]), rec.models.join(", "));
      const envModels = ["ANTHROPIC_MODEL", "ANTHROPIC_SMALL_FAST_MODEL", "ANTHROPIC_DEFAULT_OPUS_MODEL", "ANTHROPIC_DEFAULT_SONNET_MODEL", "ANTHROPIC_DEFAULT_HAIKU_MODEL", "CLAUDE_CODE_SUBAGENT_MODEL"];
      add("agent env", envModels.every((k) => env[k] === cell.model) && (cell.voice === null || (env.GSTACK_CODEX_NO_SANDBOX === "1" && env.PATH?.startsWith((o.voiceCliDir ?? RM_CODEX_DIR) + ":") === true)), envModels.map((k) => k + "=" + env[k]).join(" ") + (cell.voice ? " GSTACK_CODEX_NO_SANDBOX=" + env.GSTACK_CODEX_NO_SANDBOX + " PATH=" + env.PATH : ""));
      const others = RM_CELLS.filter((c) => c.id !== cell.id).map((c) => c.id + " " + (keys.get(c.id) ?? "none"));
      add("session key", rec.key !== null && [...keys.entries()].every(([id, k]) => id === cell.id || k !== rec.key), rec.key + " (others: " + others.join("; ") + ")");
      const dir = join(o.work, "sessions", cell.id);
      const work = join(dir, "work");
      const home = join(dir, "home");
      mkdirSync(home, { recursive: true });
      spawnSync("cp", ["-a", toyDir, work]);
      const gstack = cell.arm !== "none";
      if (gstack) {
        mkdirSync(join(home, ".claude", "skills"), { recursive: true });
        symlinkSync(resolve(o.gstack), join(home, ".claude", "skills", "gstack"));
      }
      const stateEnv = gstack ? seedStateRoot(work, work, "core", rec.gstack_config) : {};
      const slot = "cell-" + cell.id;
      const token = "gse_" + randomBytes(32).toString("base64url");
      scripts.set(slot, scriptFor(cell.voice !== null, md, join(home, "rm-check-prompt.txt")));
      const options: HostDriverOptions = { ...d, proxy: { baseUrl: stub.url, slot, token }, out: join(dir, "host"), ...(d.codex ? { codex: { ...d.codex, binDir: o.codexDir } } : {}), backgroundWaitMs: 120_000, maxTurns: 20 };
      const driver = hostDriver(options) as ReturnType<typeof hostDriver> & { env: Record<string, string> };
      const sessionEnv = trialEnv("agent", { PATH: "/usr/local/bin:/usr/bin:/bin", HOME: home, LANG: "C.UTF-8", TERM: "dumb", ...stateEnv, ...driver.env }, [], {});
      sessionEnv.PATH += ":" + dirname(process.execPath);
      const outcome = await driver.run(localSession(work, sessionEnv, claude), { id: "rm-check-" + cell.id, prompt: "Run the rig check." }, 900_000);
      add("session ended", outcome.termination.kind === "completed", JSON.stringify(outcome.termination));
      let init: { model?: string } = {};
      try {
        init = JSON.parse(readFileSync(join(dir, "host", "init.json"), "utf8"));
      } catch {
        init = {};
      }
      const mine = stub.requests.filter((r) => r.slot === slot);
      const main = mine.filter((r) => r.api === "messages" && r.kind !== "subagent");
      const sub = mine.filter((r) => r.api === "messages" && r.kind === "subagent");
      add("Claude Code session model", init.model === cell.model && main.length > 0 && main.every((r) => r.model === cell.model), "init.json model " + (init.model ?? "none") + "; " + main.length + " session requests on " + [...new Set(main.map((r) => r.model))].join(", "));
      add("Claude Code subagent model", sub.length > 0 && sub.every((r) => r.model === cell.model), sub.length + " subagent requests on " + ([...new Set(sub.map((r) => r.model))].join(", ") || "nothing"));
      if (!cell.voice) {
        add("no voice", mine.every((r) => r.api === "messages") && !existsSync(join(home, ".codex", "config.toml")), "no Codex config and no Responses request");
        continue;
      }
      const transcript = readFileSync(join(dir, "host", "transcript.ndjson"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
      const out = results(transcript);
      const step = (i: number) => out.get("toolu_rm_" + i) ?? "";
      const version = /codex-cli \S+/.exec(step(1))?.[0] ?? null;
      add("Codex version", o.codexVersion === null ? version !== null : version === o.codexVersion, (version ?? "not printed") + (o.codexVersion ? " (want " + o.codexVersion + ")" : ""));
      const probe = /^CODEX_MODEL: (\S+) \(exec; source: ([^)]*)\)/m.exec(step(1));
      add("gstack probe CODEX_MODEL", probe?.[1] === cell.voice && /config\.toml model$/.test(probe?.[2] ?? "") && /^CODEX_SANDBOX: danger-full-access$/m.test(step(1)), probe ? probe[0] : "no CODEX_MODEL line: " + step(1).slice(0, 300));
      const size = Number(/^DIFF_SIZE: (\d+)/m.exec(step(2))?.[1] ?? NaN);
      const mode = /^CODEX_MODE: (.*)$/m.exec(step(3))?.[1] ?? null;
      add("diff size and Codex mode", size >= TOY_LINES && (mode === "ready" || mode === "unverified"), "DIFF_SIZE " + size + "; CODEX_MODE " + (mode ?? "not printed: " + step(3).slice(-300)));
      const status = (i: number) => /^OUTSIDE_STATUS: (\S+)/m.exec(step(i))?.[1] ?? null;
      const voiceReq = mine.filter((r) => r.api === "responses");
      const passes = voiceReq.filter((r) => r.kind === "adversarial" || r.kind === "structured");
      add("both Codex calls fire", status(4) === "completed" && status(5) === "completed" && passes.some((r) => r.kind === "adversarial") && passes.some((r) => r.kind === "structured"), "adversarial " + (status(4) ?? "no status: " + step(4).slice(-300)) + "; structured " + (status(5) ?? "no status: " + step(5).slice(-300)) + "; " + voiceReq.length + " Responses requests (" + voiceReq.map((r) => r.kind).join(", ") + ")");
      add("voice requests", voiceReq.length > 0 && voiceReq.every((r) => r.model === cell.voice) && passes.every((r) => r.effort === "high"), [...new Set(voiceReq.map((r) => r.model + " effort " + (r.effort ?? "none")))].join("; "));
      const e = exposure({ messages: transcript, map, voice: cell.voice, diffLines: size, rollouts: readRollouts(join(dir, "host")) });
      const voiceFailures = e.failures.filter((f) => f.includes("voice") || f.includes("rollout"));
      add("exposure reads both voice passes", voiceFailures.length === 0 && e.voice.adversarial.rollouts.length > 0 && e.voice.structured.rollouts.length > 0, voiceFailures.join("; ") || "adversarial prompt " + e.voice.adversarial.rollouts.map((r) => r.prompt_sha256?.slice(0, 12) + " on " + r.models.join(",") + " effort " + r.efforts.join(",") + " cli " + r.cli_version).join("; ") + "; structured " + e.voice.structured.rollouts.map((r) => r.prompt_sha256?.slice(0, 12) + " on " + r.models.join(",")).join("; "));
    }
  } finally {
    await stub.close();
  }
  return { ok: reports.every((r) => r.checks.every((c) => c.ok)), cells: reports };
}

const CHECK_HELP = [
  "gstack-evals review-units cell-check --gstack <dir> --out <dir> [--codex-dir <dir>] [--any-codex]",
  "",
  "The review-models eval's keyless rig check (src/trial/review/rm-check.ts). For each cell (OS, OA, FS, FA and N) it runs",
  "review-units' run loop with a recording driver, then a local Claude Code session against stub APIs: the cell's model for",
  "the session and its subagent, gstack's probe printing the cell's CODEX_MODEL, both Codex calls on a 200-line toy diff,",
  "and a session key no other cell has. Nothing calls a model.",
  "--gstack: a set-up gstack checkout at " + RM_GSTACK.sha + ".",
  "--codex-dir: the directory holding the voice's codex, default " + RM_CODEX_DIR + "; on a host without it, copy it out",
  "of the trial image with docker cp. It must print " + RM_CODEX_VERSION + " unless --any-codex is given.",
  "--out: where the records go, kept as the check's evidence: not under a temp dir, as review-units' out dir. Exits 0 when",
  "every check passes, 1 when one fails and 2 when the check cannot run.",
].join("\n");

export async function cellCheckMain(argv: string[], io: { out: (t: string) => void; err: (t: string) => void }): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    io.out(CHECK_HELP);
    return 0;
  }
  const flags = new Map<string, string>();
  let anyCodex = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--any-codex") anyCodex = true;
    else if ((a === "--gstack" || a === "--codex-dir" || a === "--out") && argv[i + 1] !== undefined && !flags.has(a)) flags.set(a, argv[++i]!);
    else {
      io.err("E_USAGE review-units cell-check: unknown or repeated argument " + JSON.stringify(a) + "\n" + CHECK_HELP);
      return 2;
    }
  }
  if (!flags.has("--gstack") || !flags.has("--out")) {
    io.err("E_USAGE review-units cell-check: needs --gstack <dir> and --out <dir>\n" + CHECK_HELP);
    return 2;
  }
  const work = join(resolve(flags.get("--out")!), "check-" + new Date().toISOString().replace(/[:.]/g, "-"));
  try {
    const r = await cellCheck({ gstack: resolve(flags.get("--gstack")!), codexDir: resolve(flags.get("--codex-dir") ?? RM_CODEX_DIR), codexVersion: anyCodex ? null : RM_CODEX_VERSION, work, log: (l) => io.err(l) });
    for (const c of r.cells) {
      io.out(c.cell.id + " (" + c.cell.arm + " on " + c.cell.model + ", voice " + (c.cell.voice ?? "none") + ")");
      for (const k of c.checks) io.out("  " + (k.ok ? "ok  " : "FAIL") + " " + k.name + ": " + k.detail);
    }
    io.out(r.ok ? "cell check: every check passed" : "cell check: a check failed");
    return r.ok ? 0 : 1;
  } catch (e) {
    const message = (e as Error).message;
    io.err(/^E_[A-Z_]+/.test(message) ? message : "E_CELL_CHECK review-units cell-check: " + message);
    return 2;
  }
}
