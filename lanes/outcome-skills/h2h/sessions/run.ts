// Copyright (c) 2026 Garry Tan. MIT License.
// One head-to-head session under Harbor (post sections 3, 4 and 7), as pfchecks' run.ts runs a PF session. run.ts writes
// the attempt's task dir (a Dockerfile FROM the unit's session image, a task.toml whose agent timeout is h2hBudget's), the
// h2h config h2h_agent.py reads (the arm's scripted turns from turns.ts, the frozen continuation, DONE rule, limits, env
// and question reply, and its home), the one-row image manifest and a compose overlay: the pinned Claude Code binary for
// every session, and on B1 units the browser conditions (BROWSER: shared memory, the Chromium wrapper at its container
// path, CHROME_BIN and PUPPETEER_EXECUTABLE_PATH). It runs Harbor, retries the whole session once from a fresh container
// when the session ends upstream or infra (session.ts), reads exposure and the read audit from the transcripts, copies the
// attempt's files beside the record and writes session.json. A close whose proxy finalize failed, or an attempt that
// opened its slot and left no summary, halts with E_H2H_FINALIZE_HALT (the latter after POST /stop on the driver); a cap
// stop writes its record and ends the part with CAP_STOP.
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { BOUNDS } from "../../pfchecks/run.ts";
import { sessionManifest, type SessionImage } from "../../statemachines/image.ts";
import { HARBOR_MODEL } from "../../statemachines/run.ts";
import { h2hFail, readPrereg, type H2hPrereg } from "../prereg.ts";
import { BROWSER, type ArmInstall, type H2hSession, type H2hUnit } from "../types.ts";
import { h2hLimits, H2H_PREFIX } from "./driver.ts";
import { exposure, readAudit, readEvents } from "./exposure.ts";
import type { ArmHome } from "./home.ts";
import type { H2hPlanned } from "./plan.ts";
import { endOf, retries, SESSION_RERUN, sessionRecord, writeSessionRecord } from "./session.ts";
import { turnPlan } from "./turns.ts";
import { buildRuntimeVolume, runtimePath, RUNTIMES_DIR } from "./runtimes.ts";

const ROOT = join(import.meta.dir, "../../../..");
/** The Claude Code binary every session mounts: the pinned 2.1.325 native build (part A installs the same version). */
export const H2H_CLAUDE = process.env.H2H_CLAUDE_BIN ?? join(homedir(), ".capy/work/h2h-s/claude/claude-2.1.325/package/claude");
const KEYS = /^(ANTHROPIC|OPENAI|OPENROUTER|UBICLOUD|GEMINI|GOOGLE|XAI|DEEPSEEK|TYPESAFE)_[A-Z_]*KEY$|_TOKEN$/;
/** Claude Code's environment in every arm: pfchecks' fixed block and prereg.json's env. */
export const claudeEnv = (p: H2hPrereg = readPrereg()): Record<string, string> => ({ CLAUDE_CONFIG_DIR: "/root/.claude", HOME: "/root", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1", CLAUDE_CODE_MAX_OUTPUT_TOKENS: "32000", DISABLE_AUTOUPDATER: "1", DISABLE_TELEMETRY: "1", DISABLE_ERROR_REPORTING: "1", IS_SANDBOX: "1", ...p.env });
/** _drive's quiet rule, as pfchecks runs it. */
export const QUIET = { quiet_sec: 30, bg_wait_sec: 600 } as const;
export const SUMMARY = "h2h-summary.json";
export const OPENS = "h2h-opens.jsonl";
const KEEP = ["sdk-messages.jsonl", "claude-session.jsonl", "usersim-events.jsonl", "tree.tar", SUMMARY];

/** A unit as part S runs it: its record, its problem statement, its session image (the stripped tree at base, one
 *  commit), and the repository and work dirs inside the image. Parts B and C build these. */
export interface H2hUnitInput { unit: H2hUnit; statement: string; image: SessionImage; repo_dir: string; work_dir: string }
export interface H2hRunInput {
  session: H2hPlanned; unit: H2hUnitInput; home: ArmHome; control: string; proxy: string; out: string;
  allowance?: number; harbor?: string; claude?: string; probeNode?: string; jobName?: string; gsdOnboard?: boolean;
  /** arms-pins.json's records, for the read audit; without them foreign_reads stays empty. */
  installs?: ArmInstall[];
  /** The Chromium wrapper B1 sessions mount; part B's file by default. */
  browserWrapper?: string;
  /** The runtime volume; runH2hSession builds or reuses it when not given. */
  runtime?: { volume: string };
}

/** The h2h config h2h_agent.py reads. */
export function h2hConfig(i: Pick<H2hRunInput, "session" | "home" | "allowance" | "gsdOnboard">, statement: string, kind: H2hUnit["kind"], p: H2hPrereg = readPrereg()) {
  const t = turnPlan(i.session.arm, i.session.entry, statement, { prereg: p, gsdOnboard: i.gsdOnboard });
  const l = h2hLimits(i.allowance);
  return {
    schema: "h2h-config.v1", arm: i.session.arm, turns: t.scripted, continuation: t.continuation, done_rule: p.done_rule, continuation_cap: t.continuation_cap, no_answer: t.question_reply,
    limits: { allowance_usd: l.session_cap_usd, wall_sec: l.wall_limit_sec, max_turns: l.max_turns, ...QUIET }, disallowed_tools: [...p.disallowed_tools],
    env: { ...claudeEnv(p), ...(kind === "B1" ? BROWSER.env : {}) }, home: i.home.dir, home_rule: i.home.home_rule,
  };
}

/** The compose overlay: the pinned Claude Code, the runtime volume read-only at /opt/h2h-runtimes with its bin dir after
 *  the image's own PATH (path: runtimes.ts runtimePath), and the browser conditions on B1 units. */
export function composeOverlay(kind: H2hUnit["kind"], claude: string, wrapper: string, runtime: { volume: string; path: string }) {
  const b1 = kind === "B1";
  const volumes = [{ type: "bind", source: claude, target: "/usr/local/bin/claude", read_only: true }, { type: "volume", source: runtime.volume, target: RUNTIMES_DIR, read_only: true }, ...(b1 ? [{ type: "bind", source: wrapper, target: BROWSER.wrapper_container_path, read_only: true }] : [])];
  return { services: { main: { volumes, environment: { PATH: runtime.path, ...(b1 ? BROWSER.env : {}) }, ...(b1 ? { shm_size: BROWSER.shm_size } : {}) } }, volumes: { [runtime.volume]: { external: true as const } } };
}

/** The longest path one attempt can take inside Harbor's agent phase, from pfchecks' BOUNDS: the pre-open calls, the
 *  home copy, the slot open and close with every retry, the wall, each turn's disconnect and tree hash, the capture, the
 *  bundle and the last step's kill and state read. */
export function h2hBudget(wallSec: number, maxTurnsRun: number): { agent_s: number; timer_ms: number } {
  const b = BOUNDS;
  const agent_s = 2 * b.probe_s + 3 * b.egress_s + b.egress_probe_s + 3 * b.copy_s + 600 + 4 * b.step_s + b.tries * b.open_s + (b.tries - 1) * b.sleep_s + wallSec + maxTurnsRun * (b.disconnect_s + b.step_s) + b.tries * b.close_s + (b.tries - 1) * b.sleep_s + 3 * b.step_s + b.kill_s + b.step_s + b.margin_s;
  return { agent_s, timer_ms: (agent_s + b.setup_s + b.build_s + b.margin_s) * 1000 };
}

/** One attempt's task dir, config, manifest and overlay under dir; returns Harbor's argv and env. */
export function runCopy(i: H2hRunInput, attempt: 1 | 2, dir: string, p: H2hPrereg = readPrereg()): { argv: string[]; env: Record<string, string>; config: ReturnType<typeof h2hConfig> } {
  const s = i.session;
  const u = i.unit;
  const model = HARBOR_MODEL[p.model] ?? h2hFail("E_H2H_SESSION_INPUT", "no Harbor model for " + p.model);
  const config = h2hConfig(i, u.statement, u.unit.kind, p);
  const task = join(dir, "task");
  mkdirSync(join(task, "environment"), { recursive: true });
  writeFileSync(join(task, "environment/Dockerfile"), "FROM " + u.image.tag + "\n");
  const budget = h2hBudget(config.limits.wall_sec, config.turns.length + config.continuation_cap);
  writeFileSync(join(task, "task.toml"), ["version = \"1.0\"", "", "[agent]", "timeout_sec = " + budget.agent_s, "", "[environment]", "docker_image = " + JSON.stringify(u.image.tag), "build_timeout_sec = " + BOUNDS.build_s, ""].join("\n"));
  writeFileSync(join(task, "instruction.md"), "The arm's turns carry the task.\n");
  const label = s.unit + "/" + s.arm + "/" + s.stage + "/" + s.index;
  const taskJson = join(dir, "task.json");
  writeFileSync(taskJson, JSON.stringify({ repo_dir: u.repo_dir, commits: u.image.commits, base_commit: u.image.head, kind: "H2H" }));
  const wrapper = i.browserWrapper ?? join(ROOT, BROWSER.wrapper_repo_path);
  if (u.unit.kind === "B1" && !existsSync(wrapper)) h2hFail("E_H2H_SESSION_INPUT", "B1 unit " + u.unit.id + " needs the Chromium wrapper at " + wrapper);
  const h2hJson = join(dir, "h2h-config.json");
  writeFileSync(h2hJson, JSON.stringify(config, null, 1) + "\n");
  const compose = join(dir, "h2h.compose.yaml");
  const runtime = i.runtime ?? h2hFail("E_H2H_SESSION_INPUT", "runCopy needs the runtime volume (runtimes.ts buildRuntimeVolume)");
  writeFileSync(compose, JSON.stringify(composeOverlay(u.unit.kind, i.claude ?? H2H_CLAUDE, wrapper, { volume: runtime.volume, path: runtimePath(u.image.tag) }), null, 1) + "\n");
  const manifest = join(dir, "images.json");
  const manifestSha = sessionManifest(manifest, label, u.image);
  const armTar = join(dir, "arm.tar");
  writeFileSync(armTar, Buffer.alloc(10240));
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !KEYS.test(k))) as Record<string, string>;
  env.ANTHROPIC_API_KEY = "placeholder-not-a-key";
  env.HARBOR_TELEMETRY = "0";
  env.PYTHONPATH = [import.meta.dir, join(ROOT, "lanes/outcome-skills/pfchecks"), join(ROOT, "lanes/real-outcome/agent"), join(ROOT, "quick/laneb/runner/agent")].join(":");
  env.PYTHONDONTWRITEBYTECODE = "1";
  const ak: Record<string, string> = {
    skip_install: "true", task_json: taskJson, h2h_config: h2hJson, arm: H2H_PREFIX + s.arm, arm_tar: armTar, upstream_model: p.model, control_url: i.control, ledger: "u4", task_label: label, trial_n: "1",
    ...(attempt === 2 ? { rerun: SESSION_RERUN } : {}), image_id: u.image.image_id, manifest, manifest_sha256: manifestSha, repo_dir: u.repo_dir, workdir: u.work_dir, ...(i.probeNode !== undefined ? { probe_node: i.probeNode } : {}),
  };
  const argv = ["run", "-y", "-p", task, "-a", "h2h_agent:H2hAgent", "-m", model, "--base-url", /^https?:\/\//.test(i.proxy) ? i.proxy : "http://" + i.proxy, ...Object.entries(ak).flatMap(([k, v]) => ["--ak", k + "=" + v]), "-e", "docker", "--extra-docker-compose", join(ROOT, "quick/laneb/runner/agent-caps.compose.yaml"), "--extra-docker-compose", compose, "-o", join(dir, "jobs"), "--job-name", (i.jobName ?? "h2h-" + s.unit + "-" + s.index) + "-a" + attempt, "--disable-verification"];
  return { argv, env, config };
}

function harbor(bin: string, argv: string[], env: Record<string, string>, timeoutMs: number, log: string): Promise<{ exit: number; killed: boolean }> {
  return new Promise((done) => {
    const c = spawn(bin, argv, { env, stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    c.stdout.on("data", (d) => chunks.push(d));
    c.stderr.on("data", (d) => chunks.push(d));
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      c.kill("SIGTERM");
    }, timeoutMs);
    c.on("close", (n) => {
      clearTimeout(timer);
      writeFileSync(log, Buffer.concat(chunks));
      done({ exit: n ?? 1, killed });
    });
  });
}

function find(dir: string, name: string): string | null {
  if (!existsSync(dir)) return null;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (e === name && statSync(p).isDirectory()) return p;
    if (statSync(p).isDirectory()) {
      const q = find(p, name);
      if (q) return q;
    }
  }
  return null;
}

/** The finalize-halt rules after an attempt: a close whose proxy finalize failed with no allowance stop, or an attempt
 *  that wrote an open line and left no summary, halts the session with no retry and no record. */
export async function haltCheck(i: H2hRunInput, attempt: 1 | 2, summary: Record<string, any> | null, ev: string | null, dir: string): Promise<void> {
  const label = i.session.unit + "/" + i.session.arm + "/" + i.session.stage + "/" + i.session.index + " attempt " + attempt;
  const close = summary?.slot?.close;
  if (close?.finalized === false && !((close.allowance_stops ?? 0) > 0)) h2hFail("E_H2H_FINALIZE_HALT", label + ": the proxy's finalize failed at the close of slot " + summary?.slot?.id + ", so its counts are unknown; the session halts with no retry and no record, and the driver's E_H2H_FINALIZE_HALT line names the journal; " + dir);
  const opened = !summary && ev !== null && existsSync(join(ev, OPENS)) && readFileSync(join(ev, OPENS), "utf8").trim() !== "";
  if (!opened) return;
  const stop = await fetch(i.control + "/stop", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: "E_H2H_FINALIZE_HALT", session: label }), signal: AbortSignal.timeout(10_000) }).then((r) => (r.ok ? null : "it answered " + r.status), (e: Error) => e.message);
  h2hFail("E_H2H_FINALIZE_HALT", label + ": the attempt wrote an open line (" + join(ev!, OPENS) + ") and left no summary, so its slot may have spent; the session halts with no retry and no record, and " + (stop ? "POST " + i.control + "/stop failed (" + stop + "): stop the driver by hand; " : "the driver was stopped through POST /stop; ") + dir);
}

/** Exposure and the read audit from an attempt's transcripts. */
export function readExposure(i: Pick<H2hRunInput, "session" | "installs">, dir: string): H2hSession["exposure"] {
  const files = ["sdk-messages.jsonl", "claude-session.jsonl"].map((f) => join(dir, f)).filter(existsSync);
  if (!files.length) return null;
  const evs = readEvents(files);
  const e = exposure(i.session.arm, i.session.entry, evs);
  return { ...e, foreign_reads: i.installs ? readAudit(evs, i.installs, i.session.arm).foreign_reads : [] };
}

/** Runs one planned session: Harbor, the retry rule, the halt rules, exposure, and out/session.json. */
export async function runH2hSession(i: H2hRunInput): Promise<{ record: H2hSession; file: string }> {
  if (existsSync(i.out)) h2hFail("E_H2H_SESSION_INPUT", i.out + " exists; each session writes a new run dir");
  if (i.home.arm !== i.session.arm) h2hFail("E_H2H_SESSION_INPUT", "the home is arm " + i.home.arm + "'s, not " + i.session.arm + "'s");
  mkdirSync(i.out, { recursive: true });
  const p = readPrereg();
  const runtime = i.runtime ?? (await buildRuntimeVolume());
  const started = Date.now();
  let record: H2hSession | null = null;
  for (const attempt of [1, 2] as const) {
    const dir = join(i.out, "a" + attempt);
    mkdirSync(dir, { recursive: true });
    const { argv, env, config } = runCopy({ ...i, runtime }, attempt, dir, p);
    const { exit, killed } = await harbor(i.harbor ?? "harbor", argv, env, h2hBudget(config.limits.wall_sec, config.turns.length + config.continuation_cap).timer_ms, join(dir, "harbor.log"));
    const ev = find(join(dir, "jobs"), "evaluator");
    const summary = ev && existsSync(join(ev, SUMMARY)) ? (JSON.parse(readFileSync(join(ev, SUMMARY), "utf8")) as Record<string, any>) : null;
    if (!summary) writeFileSync(join(dir, "attempt.json"), JSON.stringify({ harbor_exit: exit, killed }) + "\n");
    await haltCheck(i, attempt, summary, ev, dir);
    if (typeof summary?.refused === "string" && summary.refused.startsWith("E_H2H_SESSION_ARM")) h2hFail("E_H2H_SESSION_ARM", summary.refused.slice("E_H2H_SESSION_ARM ".length) + "; " + dir);
    if (ev) for (const f of KEEP) if (existsSync(join(ev, f))) copyFileSync(join(ev, f), join(i.out, f));
    record = sessionRecord(i.session, summary, { model: p.model, attempt, exposure: ev ? readExposure(i, ev) : null, wall_ms: Date.now() - started, home_tree_sha256: i.home.home_tree_sha256 });
    if (!retries(endOf(summary), attempt, summary)) break;
  }
  const file = join(i.out, "session.json");
  writeSessionRecord(file, record!);
  if (record!.end === "cap_stop") h2hFail("CAP_STOP", i.session.unit + "/" + i.session.arm + " stopped at the cap: the driver refused its slot, so the part ends incomplete and is not retried; " + file);
  return { record: record!, file };
}
