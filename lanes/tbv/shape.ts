// Copyright (c) 2026 Garry Tan. MIT License.
// Request-shape capture (prereg section 3): the pinned Claude Code against a scripted stub provider with no key, in an
// empty home; per-run fields become placeholders; forbidden content is refused. splice.ts reuses the stub and the session.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fail } from "./errors.ts";
import { ARM_MODELS, PLACEHOLDERS, type Arm, type Io, type Model, type Shape } from "./types.ts";

export const CLAUDE_CODE_VERSION = "2.1.312";
/** The model the capture asks for; its name and id become placeholders. */
export const CAPTURE_MODEL = "claude-opus-5-5";
export const MODEL_NAMES: Readonly<Record<Model, string>> = { opus: "Opus 5.5", sol: "GPT-6.1 Sol", particle: "particle-1" };
/** The per-run fields every request fills (prereg section 3: templated per model and frozen). */
export const FROZEN_FIELDS = { cwd: "/app", date: "2026-11-05" } as const;
/** How the capture's temp root reads in captured text, so a recapture gives the same bytes. */
export const CAPTURE_ROOT = "/tmp/tbv";
const DUMMY_KEY = "placeholder-not-a-key";
const REPO = resolve(import.meta.dir, "../..");
/** What src/arms/install.ts keeps of a gstack install under HOME. */
const KEEP = [".local/share/gstack", ".claude/skills", ".claude/settings.json"];

export interface CaptureOptions {
  arm: Arm;
  pin: string | null;
  /** The claude binary to run (Claude Code 2.1.312, or a stub CLI in tests). */
  claude: string;
  /** A gstack checkout at the pin, for gstack arms. */
  gstack: string | null;
  out: string;
  /** Every request the stub provider saw, for checks on the raw requests. */
  onRequests?: (requests: StubRequest[]) => void;
}

// ---------- the scripted stub provider ----------

export interface StubTurn {
  text?: string;
  tool?: { name: string; input: Record<string, unknown> };
}
export interface StubRequest {
  path: string;
  body: Record<string, any>;
}
export interface StubProvider {
  url: string;
  requests: StubRequest[];
  /** The agent-loop requests (the ones that carry tools). */
  main(): StubRequest[];
  stop(): void;
}
export const isMain = (body: Record<string, any>): boolean => Array.isArray(body.tools) && body.tools.length > 0;

/** Answers /v1/messages on 127.0.0.1 (streaming or not) from the script, one turn per agent-loop request, and records every body. */
export function startStubProvider(script: StubTurn[]): StubProvider {
  const requests: StubRequest[] = [];
  let next = 0;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const body = req.method === "POST" ? ((await req.json().catch(() => ({}))) as Record<string, any>) : {};
      requests.push({ path: url.pathname + url.search, body });
      if (url.pathname === "/v1/messages/count_tokens") return Response.json({ input_tokens: 1 });
      if (url.pathname !== "/v1/messages") return Response.json({ type: "error", error: { type: "not_found_error", message: "stub provider" } }, { status: 404 });
      const turn = isMain(body) ? (script[next++] ?? { text: "Done." }) : { text: "ok" };
      const id = "msg_tbv_" + requests.length;
      const content = turn.tool ? [{ type: "tool_use", id: "toolu_tbv_" + String(next).padStart(2, "0"), name: turn.tool.name, input: turn.tool.input }] : [{ type: "text", text: turn.text ?? "Done." }];
      const stop = turn.tool ? "tool_use" : "end_turn";
      const usage = { input_tokens: 1, output_tokens: 1 };
      if (!body.stream) return Response.json({ id, type: "message", role: "assistant", model: body.model, content, stop_reason: stop, stop_sequence: null, usage });
      const ev: Array<[string, unknown]> = [["message_start", { type: "message_start", message: { id, type: "message", role: "assistant", model: body.model, content: [], stop_reason: null, stop_sequence: null, usage } }]];
      content.forEach((b, index) => {
        const start = b.type === "text" ? { type: "text", text: "" } : { ...b, input: {} };
        const delta = b.type === "text" ? { type: "text_delta", text: (b as { text: string }).text } : { type: "input_json_delta", partial_json: JSON.stringify((b as { input: unknown }).input) };
        ev.push(["content_block_start", { type: "content_block_start", index, content_block: start }], ["content_block_delta", { type: "content_block_delta", index, delta }], ["content_block_stop", { type: "content_block_stop", index }]);
      });
      ev.push(["message_delta", { type: "message_delta", delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 1 } }], ["message_stop", { type: "message_stop" }]);
      return new Response(ev.map(([e, d]) => "event: " + e + "\ndata: " + JSON.stringify(d) + "\n\n").join(""), { headers: { "content-type": "text/event-stream" } });
    },
  });
  return { url: "http://127.0.0.1:" + server.port, requests, main: () => requests.filter((r) => isMain(r.body)), stop: () => server.stop(true) };
}

// ---------- one keyless Claude Code session ----------

/** Refuses an out directory inside this repo: captured text is never committed. */
export function outsideRepo(out: string): string {
  const rel = relative(REPO, resolve(out));
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) fail("E_TBV_INPUT", "out " + out + " is inside the repo; captured text stays outside it");
  return resolve(out);
}

function claudeVersion(claude: string, home: string): void {
  const r = spawnSync(claude, ["--version"], { encoding: "utf8", env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: home, LANG: "C.UTF-8" }, timeout: 120_000 });
  const v = /^(\d+\.\d+\.\d+)/.exec((r.stdout ?? "").trim())?.[1];
  if (v !== CLAUDE_CODE_VERSION) fail("E_TBV_SHAPE", claude + " reports " + (v ?? "no version") + ", not Claude Code " + CLAUDE_CODE_VERSION);
}

/** Installs the gstack checkout at the pin into home the way src/arms/install.ts does: its tree, ./setup --host claude --no-browser -q, then only the kept paths. */
export function installGstack(gstack: string, pin: string, home: string): void {
  const head = spawnSync("git", ["-C", gstack, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout?.trim();
  if (head !== pin) fail("E_TBV_SHAPE", gstack + " is at " + (head || "no commit") + ", not the pin " + pin);
  const dest = join(home, ".local/share/gstack");
  mkdirSync(dest, { recursive: true });
  const tree = spawnSync("sh", ["-c", 'git -C "$1" archive HEAD | tar -x -C "$2"', "sh", gstack, dest], { encoding: "utf8" });
  if (tree.status !== 0) fail("E_TBV_SHAPE", "git archive of " + gstack + " failed: " + (tree.stderr ?? "").slice(-300));
  const setup = spawnSync("sh", ["-c", "./setup --host claude --no-browser -q"], { cwd: dest, env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: home, LANG: "C.UTF-8" }, encoding: "utf8", timeout: 600_000 });
  if (setup.status !== 0) fail("E_TBV_SHAPE", "gstack's setup exited " + setup.status + ": " + ((setup.stdout ?? "") + (setup.stderr ?? "")).slice(-300));
  const prune = (dir: string, rel: string) => {
    for (const name of readdirSync(dir)) {
      const r = rel ? rel + "/" + name : name;
      if (KEEP.includes(r)) continue;
      if (KEEP.some((k) => k.startsWith(r + "/"))) prune(join(dir, name), r);
      else rmSync(join(dir, name), { recursive: true, force: true });
    }
  };
  prune(home, "");
}

/** Rewrites the capture's temp root: the working directory becomes PLACEHOLDERS.cwd, the rest CAPTURE_ROOT (also in Claude Code's dashed project-path form). */
function normalizer(root: string): (t: string) => string {
  const dash = (p: string) => p.replace(/[^A-Za-z0-9]/g, "-");
  return (t) => t.split(root + "/work").join(PLACEHOLDERS.cwd).split(root).join(CAPTURE_ROOT).split(dash(root)).join(dash(CAPTURE_ROOT));
}

export interface SessionResult {
  requests: StubRequest[];
  norm: (text: string) => string;
}
/** One session in a fresh temp root: an empty home (gstack installed at the pin when given) and an empty working directory. */
export async function captureSession(o: { claude: string; pin: string | null; gstack: string | null; prompt: string; script: StubTurn[]; env?: Record<string, string> }): Promise<SessionResult> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "tbv-cap-")));
  const stub = startStubProvider(o.script);
  try {
    const home = join(root, "home");
    const cwd = join(root, "work");
    for (const d of [home, cwd, join(root, "version-home")]) mkdirSync(d);
    claudeVersion(o.claude, join(root, "version-home"));
    if (o.pin !== null && o.gstack !== null) installGstack(o.gstack, o.pin, home);
    const env: Record<string, string> = {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: home,
      LANG: "C.UTF-8",
      ANTHROPIC_API_KEY: DUMMY_KEY,
      ANTHROPIC_BASE_URL: stub.url,
      ANTHROPIC_MODEL: CAPTURE_MODEL,
      CLAUDE_CONFIG_DIR: join(home, ".claude"),
      CLAUDE_CODE_DISABLE_BUNDLED_SKILLS: "1",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      DISABLE_AUTOUPDATER: "1",
      DISABLE_TELEMETRY: "1",
      DISABLE_ERROR_REPORTING: "1",
      IS_SANDBOX: "1",
      ...o.env,
    };
    const argv = [o.claude, "--print", "--verbose", "--output-format", "stream-json", "--input-format", "stream-json", "--model", CAPTURE_MODEL, "--permission-mode", "default", "--allowedTools", "Bash,Read", "--setting-sources", "user,project", "--max-turns", String(o.script.length + 2), "--disallowedTools", "WebSearch,WebFetch"];
    const proc = Bun.spawn(argv, { cwd, env, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    proc.stdin.write(JSON.stringify({ type: "user", message: { role: "user", content: o.prompt } }) + "\n");
    proc.stdin.end();
    const timer = setTimeout(() => proc.kill(), 600_000);
    const [, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    clearTimeout(timer);
    if (code !== 0) fail("E_TBV_SHAPE", "claude exited " + code + " against the stub provider: " + stderr.slice(-300));
    if (!stub.main().length) fail("E_TBV_SHAPE", "claude sent no /v1/messages request with tools to the stub provider");
    return { requests: stub.requests, norm: normalizer(root) };
  } finally {
    stub.stop();
    rmSync(root, { recursive: true, force: true });
  }
}

// ---------- shape ----------

const FORBIDDEN: Array<[RegExp, string]> = [
  [/\/\.capy\/drive\b/, "a drive path"],
  [/\bcaptain-[a-z0-9][a-z0-9-]*\//i, "a Captain drive folder"],
  [/\bCREW\.md\b/i, "a crew rules file name"],
  [/trust but verify, in every report/i, "the org rules' trust-but-verify wording"],
  [/open each report with a tl;dr/i, "the org rules' trust-but-verify wording"],
];
/** Refuses (E_TBV_SHAPE) text that holds a drive path, a Captain drive folder, a crew rules file name or the org rules' trust-but-verify wording; except names checks to skip. */
export function refuseForbidden(text: string, where: string, except: string[] = []): void {
  for (const [re, what] of FORBIDDEN.filter(([, w]) => !except.includes(w))) {
    const m = re.exec(text);
    if (m) fail("E_TBV_SHAPE", where + " holds " + what + ": " + JSON.stringify(text.slice(Math.max(0, m.index - 40), m.index + m[0].length + 40)));
  }
}

export const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");
/** Applies f to every string in a JSON value. */
export function mapStrings<T>(v: T, f: (s: string) => string): T {
  if (typeof v === "string") return f(v) as T;
  if (Array.isArray(v)) return v.map((x) => mapStrings(x, f)) as T;
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, mapStrings(x, f)])) as T;
  return v;
}
/** Fills the model and per-run placeholders (never PLACEHOLDERS.firstUser). */
export const fillText = (t: string, model: Model, fields: { cwd: string; date: string }): string =>
  t.split(PLACEHOLDERS.modelId).join(ARM_MODELS[model].id).split(PLACEHOLDERS.modelName).join(MODEL_NAMES[model]).split(PLACEHOLDERS.cwd).join(fields.cwd).split(PLACEHOLDERS.date).join(fields.date);
const shapeSha = (s: Omit<Shape, "sha256">): string => sha256(JSON.stringify({ schema: s.schema, arm: s.arm, pin: s.pin, claude_code: s.claude_code, system: s.system, tools: s.tools, max_tokens: s.max_tokens }));
const textOf = (c: unknown): string[] => (typeof c === "string" ? [c] : Array.isArray(c) ? c.flatMap((b) => (typeof b?.text === "string" ? [b.text] : [])) : []);

export async function captureShape(o: CaptureOptions): Promise<Shape> {
  const gstackArm = o.arm === "current" || o.arm === "principle";
  if (gstackArm && (o.pin === null || o.gstack === null)) fail("E_TBV_INPUT", "the " + o.arm + " arm needs --pin and --gstack");
  if (!gstackArm && (o.pin !== null || o.gstack !== null)) fail("E_TBV_INPUT", "the " + o.arm + " arm runs with no gstack, so it takes no pin");
  const out = outsideRepo(o.out);
  const { requests, norm } = await captureSession({ claude: o.claude, pin: o.pin, gstack: o.gstack, prompt: PLACEHOLDERS.firstUser, script: [] });
  o.onRequests?.(requests);
  const body = requests.find((r) => isMain(r.body))!.body;
  const sessionSystem = (body.messages as Array<{ role: string; content: unknown }>).filter((m) => m.role === "system").flatMap((m) => textOf(m.content));
  const model = new RegExp("You are powered by the model named (.+?)\\. The exact model ID is " + CAPTURE_MODEL.replace(/[.-]/g, "\\$&") + "\\.", "g");
  let found = 0;
  const system = [...textOf(body.system).filter((t) => !t.startsWith("x-anthropic-billing-header:")), ...sessionSystem].map((raw) => {
    const text = norm(raw)
      .replace(model, () => (found++, "You are powered by the model named " + PLACEHOLDERS.modelName + ". The exact model ID is " + PLACEHOLDERS.modelId + "."))
      .replace(/Today's date is \d{4}-\d{2}-\d{2}\./g, "Today's date is " + PLACEHOLDERS.date + ".");
    return { type: "text" as const, text };
  });
  if (found !== 1) fail("E_TBV_SHAPE", "the captured system prompt names the model " + found + " times, not once, so it cannot be templated");
  const tools = (body.tools as Array<Record<string, unknown>>).map(({ cache_control: _, ...t }) => mapStrings(t, norm));
  const s = { schema: "tbv-shape.v1" as const, arm: o.arm, pin: o.pin, claude_code: CLAUDE_CODE_VERSION, system, tools, max_tokens: Number(body.max_tokens) };
  refuseForbidden(JSON.stringify([system, tools]), "the " + o.arm + " shape");
  const shape: Shape = { ...s, sha256: shapeSha(s) };
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "shape-" + o.arm + "-" + (o.pin ?? "none") + ".json"), JSON.stringify(shape, null, 2) + "\n");
  return shape;
}

/** The shape with per-run fields filled for a model. */
export function fillShape(shape: Shape, model: Model, fields: { cwd: string; date: string }): Shape {
  const f = (t: string) => fillText(t, model, fields);
  return { ...shape, system: shape.system.map((b) => ({ type: "text", text: f(b.text) })), tools: mapStrings(shape.tools, f) };
}

/** --flag value pairs after the subcommand; an unknown flag or a missing value is refused. */
export function flags(argv: string[], known: string[]): Record<string, string> {
  const got: Record<string, string> = {};
  for (let i = 1; i < argv.length; i += 2) {
    const k = argv[i]!;
    if (!known.includes(k)) fail("E_TBV_INPUT", "unknown flag " + JSON.stringify(k) + "; known: " + known.join(" "));
    if (argv[i + 1] === undefined) fail("E_TBV_INPUT", k + " needs a value");
    got[k] = argv[i + 1]!;
  }
  return got;
}
export const need = (f: Record<string, string>, k: string): string => f[k] ?? fail("E_TBV_INPUT", "missing " + k);

/** gstack-evals tbv shape --arm <arm> --claude <bin> --out <dir> [--pin <sha> --gstack <dir>] */
export async function run(argv: string[], io: Io): Promise<number> {
  const f = flags(argv, ["--arm", "--pin", "--gstack", "--claude", "--out"]);
  const arm = need(f, "--arm") as Arm;
  if (!["none", "current", "principle", "lens"].includes(arm)) fail("E_TBV_INPUT", "unknown arm " + JSON.stringify(arm));
  const s = await captureShape({ arm, pin: f["--pin"] ?? null, claude: need(f, "--claude"), gstack: f["--gstack"] ?? null, out: need(f, "--out") });
  const chars = JSON.stringify([s.system, s.tools]).length;
  io.out("shape " + arm + " " + (s.pin ?? "none") + " template " + s.sha256 + " chars " + chars + " est " + Math.ceil(chars / 3) + " max_tokens " + s.max_tokens);
  for (const m of ["opus", "sol", "particle"] as const) io.out("shape " + arm + " " + (s.pin ?? "none") + " " + m + " " + shapeSha(fillShape(s, m, FROZEN_FIELDS)));
  return 0;
}
