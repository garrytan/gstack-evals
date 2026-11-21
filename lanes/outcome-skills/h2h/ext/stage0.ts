// Copyright (c) 2026 Garry Tan. MIT License.
// Part S's keyless stage 0 check for one Codex home (wiki/plans/2026-11-21-geva-568-skill-pack-h2h-sol-particle-prereg
// sections 3 and 11). It runs the real session loop (ext/h2h_codex.py) in docker exec mode, as h2h_agent.py runs it,
// against the stub Responses API (ext/stub-responses.ts) twice, each in a fresh container from the install image with the
// arm's home copied to /root, part S's runtime volume mounted read-only and CI and GITHUB_ACTIONS set on the container:
// once through the runtime volume's sol-agent link and once through a link named codex. Each session runs one code-mode
// cell that prints gstack-session-kind (when the home holds gstack) and the two CI variables the command sees. The report
// holds what each run printed, the first request's tool list and question tools, whether the first request body and the
// rollout's session metadata are the same under both names once ids and timestamps are masked (and the paths that differ
// when not), whether AGENTS.md text reached the first request and Codex's own prompt-input render, and Codex's version.
// Usage: bun ext/stage0.ts --arm <s-arm> --home <dir> --out <dir> [--image <tag>] [--volume <ext runtime volume>]
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { h2hFail, readPrereg } from "../prereg.ts";
import { ensureImage } from "../arms/install.ts";
import { RUNTIMES_DIR } from "../sessions/runtimes.ts";
import { readExtPrereg, S_ARMS } from "./prereg.ts";
import { buildExtRuntimeVolume, solAgentPath } from "./runtimes.ts";
import { extHomeRule } from "./run.ts";

type SArm = (typeof S_ARMS)[number];
const fail = (why: string): never => h2hFail("E_H2HX_CODEX_RUNTIME", why);
const docker = (args: string[], timeout = 600_000) => spawnSync("docker", args, { encoding: "utf8", timeout, maxBuffer: 1 << 26 });
const HERE = import.meta.dir;
const PY = process.env.REAL_OUTCOME_PYTHON ?? join(homedir(), ".capy/work/real/venv/bin/python");
const SH = [join(HERE, "../../pfchecks/sh"), join(HERE, "../sessions/sh")];
const SH_DIR = "/opt/h2h-sh";
const REPO = "/w";
const PLAIN = "/opt/h2hx-plain/codex";
/** The one probe each session runs: the session kind gstack's preamble would read, and CI as the command sees it. */
export const PROBE = 'K=$HOME/gstack/bin/gstack-session-kind; if test -x "$K"; then echo "SESSION_KIND=$("$K")"; else echo SESSION_KIND=none; fi; echo "CI=@@{CI-unset} GITHUB_ACTIONS=@@{GITHUB_ACTIONS-unset}"'.replaceAll("@@{", "$" + "{");
const ID = /(?<![0-9a-f])[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![0-9a-f])/g;
const MS = /(unix_ms\\?":)\d{13}/g;
const TIME = /\b\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z?\b/g;
/** A JSON value with every UUID, ISO timestamp and unix_ms time masked, so two sessions compare on everything else. */
export const masked = (v: unknown): unknown => JSON.parse(JSON.stringify(v ?? null).replace(ID, "<id>").replace(TIME, "<time>").replace(MS, "$10"));
/** The leaf paths where two JSON values differ. */
export function diffPaths(a: unknown, b: unknown, at = ""): string[] {
  if (a === b) return [];
  if (a && b && typeof a === "object" && typeof b === "object" && Array.isArray(a) === Array.isArray(b)) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
    return keys.flatMap((k) => diffPaths((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], at + "/" + k));
  }
  return [at || "/"];
}
/** The tool names a Responses request offers: body.tools and every namespace in additional_tools input items. */
export function requestTools(body: any): string[] {
  const names = (tools: any[]): string[] => tools.flatMap((t) => (t?.type === "namespace" && Array.isArray(t.tools) ? t.tools.map((x: any) => t.name + "." + x.name) : t?.name ? [String(t.name)] : []));
  const extra = (Array.isArray(body?.input) ? body.input : []).filter((i: any) => i?.type === "additional_tools").flatMap((i: any) => names(i.tools ?? []));
  return [...names(Array.isArray(body?.tools) ? body.tools : []), ...extra];
}

export interface Stage0Run { name: "link" | "plain"; bin: string; exit: number; session_kind: string | null; ci: string | null; github_actions: string | null; first_request: string; session_meta: Record<string, unknown> | null; summary_end: string | null }
export interface Stage0Report {
  schema: "h2hx-stage0.v1"; arm: SArm; codex_version: string | null; runs: Stage0Run[];
  tools: string[]; question_tools: string[]; same_request: boolean; request_diff: string[]; same_session_meta: boolean; session_meta_diff: string[];
  agents_md: { text_sha256: string | null; in_first_request: boolean; in_prompt_input: boolean }; prompt_input: string;
}

async function stub(logDir: string): Promise<{ port: number; kill: () => void }> {
  const p = Bun.spawn(["bun", join(HERE, "stub-responses.ts")], { env: { PATH: process.env.PATH!, LOG_DIR: logDir }, stdout: "pipe", stderr: "inherit" });
  const reader = p.stdout.getReader();
  let text = "";
  const until = Date.now() + 30_000;
  while (!/listening (\d+)/.test(text) && Date.now() < until) {
    const { value, done } = await reader.read();
    if (done) break;
    text += new TextDecoder().decode(value);
  }
  const m = text.match(/listening (\d+)/) ?? fail("the stub Responses API did not start: " + text.slice(0, 200));
  return { port: Number(m[1]), kill: () => p.kill() };
}

async function oneRun(name: "link" | "plain", o: { arm: SArm; home: string; out: string; image: string; volume: string; pathEnv: string; turns?: string[] }): Promise<Stage0Run & { body: any; meta_raw: any; container: string }> {
  const x = readExtPrereg();
  const p = readPrereg();
  const dir = join(o.out, name);
  mkdirSync(dir, { recursive: true });
  const s = await stub(join(dir, "requests"));
  const container = "h2hx-stage0-" + name + "-" + crypto.randomUUID().slice(0, 8);
  try {
    const up = docker(["run", "-d", "--name", container, "--network", "host", "-e", "CI=true", "-e", "GITHUB_ACTIONS=true", "-e", "PATH=" + o.pathEnv, "-v", o.volume + ":" + RUNTIMES_DIR + ":ro", "--entrypoint", "sleep", o.image, "infinity"]);
    if (up.status !== 0) fail("the stage 0 container did not start: " + up.stderr.trim().slice(-300));
    for (const [src, dest] of [...SH.map((d) => [d, SH_DIR] as const), ...(existsSync(o.home) && readdirSync(o.home).length ? [[o.home, "/root"] as const] : [])]) {
      docker(["exec", container, "mkdir", "-p", dest]);
      const cp = docker(["cp", src + "/.", container + ":" + dest]);
      if (cp.status !== 0) fail("could not copy " + src + " into the stage 0 container: " + cp.stderr.trim().slice(-300));
    }
    const init = docker(["exec", container, "sh", "-c", 'set -e; chown -R 0:0 /root; mkdir -p "$1" && cd "$1" && git init -q && echo a > a.txt && git add -A && GIT_AUTHOR_NAME=f GIT_AUTHOR_EMAIL=f@x.invalid GIT_COMMITTER_NAME=f GIT_COMMITTER_EMAIL=f@x.invalid GIT_AUTHOR_DATE=2026-11-21T00:00:00Z GIT_COMMITTER_DATE=2026-11-21T00:00:00Z git -c init.defaultBranch=main commit -qm base && mkdir -p "$(dirname "$2")" && ln -s "$3/codex/codex" "$2"', "sh", REPO, PLAIN, RUNTIMES_DIR]);
    if (init.status !== 0) fail("the stage 0 container did not set up its repository: " + init.stderr.trim().slice(-300));
    const head = docker(["exec", container, "git", "-C", REPO, "rev-parse", "HEAD"]).stdout.trim();
    const bin = name === "link" ? solAgentPath(x) : PLAIN;
    const l = x.parts.S.limits;
    const cfg = {
      repo: REPO, work: "/tmp/h2h-work", sh_dir: SH_DIR, home: "/root", exec_prefix: ["docker", "exec", "-i", "-w", REPO, container], container, out: join(dir, "out"),
      no_answer: p.texts.question_reply, env: { HOME: "/root", GSTACK_TELEMETRY_SOURCE: "eval" }, turns: o.turns ?? ["[fx:cmd] " + PROBE], continuation: p.texts.continuation, done_rule: p.done_rule, continuation_cap: 1,
      limits: { allowance_usd: l.allowance_usd, wall_sec: 300, max_turns: l.max_turns, quiet_sec: 30, bg_wait_sec: 600 }, home_rule: extHomeRule(o.arm), rerun: null, commits: 1, head,
      base_url: "http://127.0.0.1:" + s.port, token: "stub-not-a-key", codex: { bin, home: "/root/.codex", model: x.parts.S.model, effort: x.parts.S.reasoning_effort, version: x.parts.S.codex.version },
    };
    writeFileSync(join(dir, "cfg.json"), JSON.stringify(cfg, null, 1));
    const py = Bun.spawn([PY, join(HERE, "h2h_codex.py"), join(dir, "cfg.json")], { env: { PATH: process.env.PATH!, HOME: process.env.HOME!, PYTHONDONTWRITEBYTECODE: "1" }, stdout: "pipe", stderr: "pipe" });
    const exit = await py.exited;
    writeFileSync(join(dir, "loop-stderr.log"), await new Response(py.stderr).text());
    const evLines = existsSync(join(dir, "out", "codex-events.jsonl")) ? readFileSync(join(dir, "out", "codex-events.jsonl"), "utf8").split("\n").filter(Boolean) : [];
    const printed = evLines.map((l) => JSON.parse(l)).filter((e) => e.type === "item.completed" && e.item?.type === "command_execution").map((e) => String(e.item.aggregated_output ?? "")).join("\n");
    const pick = (re: RegExp) => printed.match(re)?.[1] ?? null;
    const reqs = existsSync(join(dir, "requests")) ? readdirSync(join(dir, "requests")).filter((f) => f.endsWith(".json")).sort() : [];
    const first = reqs.map((f) => JSON.parse(readFileSync(join(dir, "requests", f), "utf8"))).find((r) => r.method === "POST") ?? null;
    const summary = existsSync(join(dir, "out", "h2h-summary.json")) ? JSON.parse(readFileSync(join(dir, "out", "h2h-summary.json"), "utf8")) : null;
    const rollouts = (summary?.codex_sessions ?? []) as string[];
    const metaLine = rollouts.length ? readFileSync(join(dir, "out", "codex-sessions", rollouts[0]!), "utf8").split("\n").find((l) => l.includes('"session_meta"')) : undefined;
    const meta = metaLine ? JSON.parse(metaLine).payload : null;
    return { name, bin, exit, session_kind: pick(/SESSION_KIND=([a-z]+)/), ci: pick(/^CI=(\S+)/m), github_actions: pick(/GITHUB_ACTIONS=(\S+)/), first_request: first ? join(name, "requests", reqs.find((f) => JSON.parse(readFileSync(join(dir, "requests", f), "utf8")).method === "POST")!) : "", session_meta: meta ? { originator: meta.originator, cli_version: meta.cli_version } : null, summary_end: summary?.turns?.[0]?.termination ?? null, body: first?.body ?? null, meta_raw: meta, container };
  } finally {
    s.kill();
  }
}

async function runEnv(image?: string, volume?: string): Promise<{ image: string; volume: string; pathEnv: string }> {
  const img = image ?? ensureImage().tag;
  const vol = volume ?? (await buildExtRuntimeVolume()).volume;
  const imagePath = docker(["image", "inspect", "-f", "{{range .Config.Env}}{{println .}}{{end}}", img]).stdout.split("\n").find((l) => l.startsWith("PATH="))?.slice(5) ?? "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
  return { image: img, volume: vol, pathEnv: imagePath + ":" + RUNTIMES_DIR + "/bin" };
}

/** One real Codex session through sol-agent in docker exec mode against the stub, with the given scripted turns: the
 *  rollout fixtures the exposure detectors are tested on come from here. Returns the run's out dir. */
export async function captureCodexSession(o: { arm: SArm; home: string; out: string; turns: string[]; image?: string; volume?: string }): Promise<{ out: string; exit: number; rollouts: string[] }> {
  const env = await runEnv(o.image, o.volume);
  const r = await oneRun("link", { arm: o.arm, home: o.home, out: o.out, turns: o.turns, ...env });
  docker(["rm", "-f", r.container], 60_000);
  const out = join(o.out, "link", "out");
  const summary = existsSync(join(out, "h2h-summary.json")) ? JSON.parse(readFileSync(join(out, "h2h-summary.json"), "utf8")) : null;
  return { out, exit: r.exit, rollouts: ((summary?.codex_sessions ?? []) as string[]).map((p) => join(out, "codex-sessions", p)) };
}

/** Runs the stage 0 check for one arm's installed home and writes stage0.json under out. */
export async function codexStage0(o: { arm: SArm; home: string; out: string; image?: string; volume?: string }): Promise<Stage0Report> {
  if (!(S_ARMS as readonly string[]).includes(o.arm)) fail(o.arm + " is not a part S arm");
  if (existsSync(o.out) && readdirSync(o.out).length) fail(o.out + " is not empty; each check writes a new dir");
  mkdirSync(o.out, { recursive: true });
  const { image, volume, pathEnv } = await runEnv(o.image, o.volume);
  const runs: Array<Awaited<ReturnType<typeof oneRun>>> = [];
  try {
    for (const name of ["link", "plain"] as const) runs.push(await oneRun(name, { arm: o.arm, home: o.home, out: o.out, image, volume, pathEnv }));
    const [a, b] = runs as [(typeof runs)[0], (typeof runs)[0]];
    const reqDiff = diffPaths(masked(a.body), masked(b.body));
    const metaDiff = diffPaths(masked(a.meta_raw), masked(b.meta_raw));
    const pi = docker(["exec", "-w", REPO, "-e", "HOME=/root", "-e", "CODEX_HOME=/root/.codex", a.container, "env", "-u", "CI", "-u", "GITHUB_ACTIONS", solAgentPath(), "debug", "prompt-input", "probe"], 120_000);
    writeFileSync(join(o.out, "prompt-input.json"), pi.stdout);
    const agentsPath = join(o.home, ".codex", "AGENTS.md");
    const agents = existsSync(agentsPath) ? readFileSync(agentsPath, "utf8") : null;
    const needle = agents?.trim() ?? null;
    const tools = requestTools(a.body);
    const report: Stage0Report = {
      schema: "h2hx-stage0.v1", arm: o.arm, codex_version: (a.meta_raw?.cli_version as string) ?? null, runs: runs.map(({ body, meta_raw, container, ...r }) => r),
      tools, question_tools: tools.filter((t) => /request_user_input/.test(t)), same_request: reqDiff.length === 0, request_diff: reqDiff, same_session_meta: metaDiff.length === 0, session_meta_diff: metaDiff,
      agents_md: { text_sha256: agents === null ? null : new Bun.CryptoHasher("sha256").update(agents).digest("hex"), in_first_request: needle !== null && JSON.stringify(a.body).includes(JSON.stringify(needle).slice(1, -1)), in_prompt_input: needle !== null && pi.stdout.includes(JSON.stringify(needle).slice(1, -1)) },
      prompt_input: "prompt-input.json",
    };
    writeFileSync(join(o.out, "stage0.json"), JSON.stringify(report, null, 1) + "\n");
    return report;
  } finally {
    for (const r of runs) docker(["rm", "-f", r.container], 60_000);
    docker(["ps", "-aq", "--filter", "name=h2hx-stage0-"]).stdout.split("\n").filter(Boolean).forEach(() => undefined);
  }
}

export async function main(argv: string[]): Promise<number> {
  const arg = (k: string) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : undefined);
  const arm = arg("--arm") as SArm | undefined;
  const home = arg("--home");
  const out = arg("--out");
  if (!arm || !home || !out) {
    process.stderr.write("E_USAGE bun ext/stage0.ts --arm <s-arm> --home <dir> --out <dir> [--image <tag>] [--volume <volume>]\n");
    return 2;
  }
  const r = await codexStage0({ arm, home, out, image: arg("--image"), volume: arg("--volume") });
  process.stdout.write(JSON.stringify(r, null, 1) + "\n");
  return 0;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
