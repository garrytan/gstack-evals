// Copyright (c) 2026 Garry Tan. MIT License.
// Plan sections 4, 8 and 9 (harness plan 15.3): one /cso session under Harbor, built after the head-to-head's runCopy and
// run on its h2h_agent. The session image is one minimal image for every arm and model: the base h2h's install recipe pins
// by digest (CSO_BASE_IMAGE) with the unit's session tree at /work/repo, and h2h's read-only runtime volume (node, bun,
// python3, gh) after the image's own PATH; its digest goes into the run record. Each attempt writes its task dir, the
// h2h-config.json csoConfig writes, the one-row image manifest and the compose overlay, then runs Harbor. readEnd reads
// the end: an upstream end or an infra failure gets one whole-session retry with the full allowance while the spend cap
// above it covers one more allowance, and a second is a gap. A close whose proxy finalize failed, or an attempt that
// opened its slot and left no summary, halts with E_CSO_FINALIZE_HALT (the latter after POST /stop on the driver). The
// record takes exposure and the helper records from csoExposure over the SDK transcript and the unit's tree; loaded also
// reads Claude Code's own session log, the one place the expanded /cso command block is written. A stage 1 or re-pilot
// session needs the readout key (section 12): its session.json is one sealed row, and when it ends, halts or fails every
// other file in its dir (transcripts, Claude Code's session log, Harbor's logs and job dirs) becomes <file>.sealed.
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { INSTALL_IMAGE } from "../h2h/arms/recipes.ts";
import { homeTreeSha256 } from "../h2h/arms/hash.ts";
import { composeOverlay, H2H_CLAUDE, h2hBudget, OPENS, SUMMARY } from "../h2h/sessions/run.ts";
import { attemptUsage, retryCovered, type AttemptUsage } from "../h2h/sessions/session.ts";
import { buildRuntimeVolume, runtimePath } from "../h2h/sessions/runtimes.ts";
import { sessionManifest, type SessionImage } from "../statemachines/image.ts";
import { CSO_PREFIX, csoDriverModels } from "./driver.ts";
import { events } from "../h2h/sessions/exposure.ts";
import { csoExposure, loaded } from "./exposure.ts";
import { sealBytes, sealedStage, sealRow } from "./analysis/readout.ts";
import { csoFail, loadCsoPrereg, type CsoPrereg } from "./prereg.ts";
import { csoConfig, csoLimits, csoSessionRecord, harborModel, modelId, readEnd, withRefusalFallback, type EndRead } from "./sessions.ts";
import type { CsoArm, CsoModel, CsoStage, SessionRecord, UnitRecord } from "./types.ts";

const ROOT = join(import.meta.dir, "../../..");
/** The session base image: h2h's pinned install base, the same for every arm and model. */
export const CSO_BASE_IMAGE = INSTALL_IMAGE.base;
export const CSO_REPO_DIR = "/work/repo";
export const CSO_WORK_DIR = "/work";
/** The base image's own node, which runs the in-container egress probe. */
export const CSO_PROBE_NODE = "/usr/local/bin/node";
/** The whole-session retry's meta.rerun. */
export const CSO_RERUN = "upstream or infra end";
const KEYS = /^(ANTHROPIC|OPENAI|OPENROUTER|UBICLOUD|GEMINI|GOOGLE|XAI|DEEPSEEK|TYPESAFE|EXA|AGENTRUN)_[A-Z_]*KEY$|_TOKEN$/;
const KEEP = ["sdk-messages.jsonl", "claude-session.jsonl", SUMMARY];
type Rec = Record<string, any>;

/** Builds a unit's session image: CSO_BASE_IMAGE with the session tree (one commit) at /work/repo, pinned by image id. */
export function buildCsoImage(unit: UnitRecord, tree: string, base: string = CSO_BASE_IMAGE): SessionImage {
  const head = spawnSync("git", ["-C", tree, "rev-parse", "HEAD"], { encoding: "utf8" });
  if (head.status !== 0) csoFail("E_CSO_SESSION", tree + " is not the unit's session tree: " + head.stderr.trim());
  const ctx = mkdtempSync(join(tmpdir(), "cso-image-"));
  try {
    cpSync(tree, join(ctx, "repo"), { recursive: true, verbatimSymlinks: true });
    writeFileSync(join(ctx, "Dockerfile"), "FROM " + base + "\nCOPY repo " + CSO_REPO_DIR + "\nWORKDIR " + CSO_REPO_DIR + "\n");
    const tag = "gstack-evals-cso-session:" + unit.tree_sha256.slice(0, 16);
    const b = spawnSync("docker", ["build", "-q", "-t", tag, ctx], { encoding: "utf8", maxBuffer: 16 << 20 });
    if (b.status !== 0) csoFail("E_CSO_SESSION", "docker build of " + unit.unit + "'s session image failed: " + String(b.stderr).trim().slice(-500));
    return { image_id: b.stdout.trim(), tag, runtime_id: base, volume: "", commits: 1, head: head.stdout.trim(), home: "none", tree_patch_sha256: null, qa_home: null, removed: [] };
  } finally {
    rmSync(ctx, { recursive: true, force: true });
  }
}

/** One session as the runner runs it. home is the arm's installed home (null for none) with the hash its arm record pins. */
export interface CsoSessionInput {
  unit: UnitRecord; tree: string; image: SessionImage; arm: CsoArm; model: CsoModel; stage: CsoStage; index: number;
  home: { dir: string | null; home_tree_sha256: string }; control: string; proxy: string; out: string;
  allowance?: number; capLeftUsd?: number; harbor?: string; claude?: string; runtime?: { volume: string; path?: string }; jobName?: string;
  /** The readout key; stage 1 and re-pilot sessions need it. */
  seal?: Buffer | null;
}

const label = (i: Pick<CsoSessionInput, "unit" | "arm" | "model" | "stage" | "index">) => i.unit.unit + "/" + i.arm + "/" + i.model + "/" + i.stage + "/" + i.index;

/** One attempt's task dir, config, manifest and overlay under dir; returns Harbor's argv and env. */
export function csoRunCopy(i: CsoSessionInput, attempt: 1 | 2, dir: string, p: CsoPrereg = loadCsoPrereg()): { argv: string[]; env: Record<string, string>; config: ReturnType<typeof csoConfig> } {
  const upstream = modelId(i.model, p).replace(/^anthropic:/, "");
  if (!csoDriverModels(p).includes(upstream)) csoFail("E_CSO_SESSION", i.model + " (" + upstream + ") is not a model the driver serves");
  const config = csoConfig({ arm: i.arm, model: i.model, home: i.home.dir, allowance: i.allowance }, p);
  const task = join(dir, "task");
  mkdirSync(join(task, "environment"), { recursive: true });
  writeFileSync(join(task, "environment/Dockerfile"), "FROM " + i.image.tag + "\n");
  const budget = h2hBudget(config.limits.wall_sec, config.turns.length + config.continuation_cap);
  writeFileSync(join(task, "task.toml"), ["version = \"1.0\"", "", "[agent]", "timeout_sec = " + budget.agent_s, "", "[environment]", "docker_image = " + JSON.stringify(i.image.tag), "build_timeout_sec = 600", ""].join("\n"));
  writeFileSync(join(task, "instruction.md"), "The arm's turns carry the task.\n");
  const taskJson = join(dir, "task.json");
  writeFileSync(taskJson, JSON.stringify({ repo_dir: CSO_REPO_DIR, commits: 1, base_commit: i.image.head, kind: "H2H" }));
  const h2hJson = join(dir, "h2h-config.json");
  writeFileSync(h2hJson, JSON.stringify(config, null, 1) + "\n");
  const runtime = i.runtime ?? csoFail("E_CSO_SESSION", "csoRunCopy needs the runtime volume (runtimes.ts buildRuntimeVolume)");
  const compose = join(dir, "cso.compose.yaml");
  writeFileSync(compose, JSON.stringify(composeOverlay("O", i.claude ?? H2H_CLAUDE, "", { volume: runtime.volume, path: runtime.path ?? runtimePath(i.image.tag) }), null, 1) + "\n");
  const manifest = join(dir, "images.json");
  const manifestSha = sessionManifest(manifest, label(i), i.image);
  const armTar = join(dir, "arm.tar");
  writeFileSync(armTar, Buffer.alloc(10240));
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !KEYS.test(k))) as Record<string, string>;
  env.ANTHROPIC_API_KEY = "placeholder-not-a-key";
  env.HARBOR_TELEMETRY = "0";
  env.PYTHONPATH = [join(ROOT, "lanes/outcome-skills/h2h/sessions"), join(ROOT, "lanes/outcome-skills/pfchecks"), join(ROOT, "lanes/real-outcome/agent"), join(ROOT, "quick/laneb/runner/agent")].join(":");
  env.PYTHONDONTWRITEBYTECODE = "1";
  const ak: Record<string, string> = {
    skip_install: "true", task_json: taskJson, h2h_config: h2hJson, arm: CSO_PREFIX + i.arm, arm_tar: armTar, upstream_model: upstream, control_url: i.control, ledger: "u4", task_label: label(i), trial_n: "1",
    ...(attempt === 2 ? { rerun: CSO_RERUN } : {}), image_id: i.image.image_id, manifest, manifest_sha256: manifestSha, repo_dir: CSO_REPO_DIR, workdir: CSO_WORK_DIR, probe_node: CSO_PROBE_NODE, ...(i.home.dir ? { home_owner: "session" } : {}),
  };
  const argv = ["run", "-y", "-p", task, "-a", "h2h_agent:H2hAgent", "-m", harborModel(i.model, p), "--base-url", /^https?:\/\//.test(i.proxy) ? i.proxy : "http://" + i.proxy, ...Object.entries(ak).flatMap(([k, v]) => ["--ak", k + "=" + v]), "-e", "docker", "--extra-docker-compose", join(ROOT, "quick/laneb/runner/agent-caps.compose.yaml"), "--extra-docker-compose", compose, "-o", join(dir, "jobs"), "--job-name", (i.jobName ?? "cso-" + i.unit.unit + "-" + i.arm + "-" + i.model + "-" + i.index) + "-a" + attempt, "--disable-verification"];
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
    c.on("error", () => undefined);
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
    if (!statSync(p).isDirectory()) continue;
    if (e === name) return p;
    const q = find(p, name);
    if (q) return q;
  }
  return null;
}

/** The finalize-halt rules after an attempt: a close whose proxy finalize failed with no allowance stop, or an attempt
 *  that wrote an open line and left no summary, halts the session with no retry and no record. */
export async function csoHaltCheck(i: Pick<CsoSessionInput, "unit" | "arm" | "model" | "stage" | "index" | "control">, attempt: 1 | 2, summary: Rec | null, ev: string | null, dir: string): Promise<void> {
  const at = label(i) + " attempt " + attempt;
  const close = summary?.slot?.close;
  if (close?.finalized === false && !((close.allowance_stops ?? 0) > 0)) csoFail("E_CSO_FINALIZE_HALT", at + ": the proxy's finalize failed at the close of slot " + summary?.slot?.id + ", so its counts are unknown; the session halts with no retry and no record, and the driver's journal names it; " + dir);
  const opened = !summary && ev !== null && existsSync(join(ev, OPENS)) && readFileSync(join(ev, OPENS), "utf8").trim() !== "";
  if (!opened) return;
  const stop = await fetch(i.control + "/stop", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: "E_CSO_FINALIZE_HALT", session: at }), signal: AbortSignal.timeout(10_000) }).then((r) => (r.ok ? null : "it answered " + r.status), (e: Error) => e.message);
  csoFail("E_CSO_FINALIZE_HALT", at + ": the attempt wrote an open line (" + join(ev!, OPENS) + ") and left no summary, so its slot may have spent; the session halts with no retry and no record, and " + (stop ? "POST " + i.control + "/stop failed (" + stop + "): stop the driver by hand; " : "the driver was stopped through POST /stop; ") + dir);
}

const readJsonl = (f: string): Rec[] => (existsSync(f) ? readFileSync(f, "utf8").split("\n").filter((l) => l.trim()).flatMap((l) => { try { return [JSON.parse(l) as Rec]; } catch { return []; } }) : []);
/** The session tree's tracked paths, which resolve the helper's handles. */
export function treePaths(tree: string): string[] {
  const r = spawnSync("git", ["-C", tree, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 64 << 20 });
  if (r.status !== 0) csoFail("E_CSO_SESSION", tree + " does not list its files: " + String(r.stderr).trim());
  return r.stdout.split("\0").filter(Boolean);
}

/** The run record beside session.json: the session image, its base digest and the arm's home hash. */
export interface CsoRunRecord { schema: "cso-run.v1"; session: string; image_id: string; image_tag: string; base_image: string; home_tree_sha256: string; attempts: Array<{ attempt: 1 | 2; harbor_exit: number; killed: boolean; end: EndRead["end"]; reason: string | null }> }

/** Runs one session: the home's bytes against its arm record, Harbor, the retry rule within the one allowance, the halt
 *  rules, exposure and the helper records, then out/session.json and out/run.json. */
export async function runCsoSession(i: CsoSessionInput): Promise<{ record: SessionRecord; file: string }> {
  if (existsSync(i.out)) csoFail("E_CSO_SESSION", i.out + " exists; each session writes a new run dir");
  if ((i.arm === "none") !== (i.home.dir === null)) csoFail("E_CSO_ARM", i.arm + (i.arm === "none" ? " runs with no home" : " needs its installed home"));
  if (i.home.dir !== null && homeTreeSha256(i.home.dir) !== i.home.home_tree_sha256) csoFail("E_CSO_ARM", i.arm + "'s home " + i.home.dir + " no longer hashes to its arm record's " + i.home.home_tree_sha256);
  const key = sealedStage(i.stage) ? (i.seal ?? csoFail("E_CSO_SESSION", label(i) + ": stage 1 and re-pilot sessions are sealed to the readout key (section 12), and none was given")) : null;
  mkdirSync(i.out, { recursive: true });
  try {
    return await session(i, key);
  } finally {
    if (key) sealDir(i.out, key);
  }
}

function sealDir(dir: string, key: Buffer): void {
  for (const e of readdirSync(dir)) {
    const f = join(dir, e), st = lstatSync(f);
    if (st.isDirectory()) sealDir(f, key);
    else if (st.isFile() && e !== "session.json" && !e.endsWith(".sealed")) {
      writeFileSync(f + ".sealed", sealBytes(readFileSync(f), key), { flag: "wx", mode: 0o600 });
      rmSync(f);
    }
  }
}

async function session(i: CsoSessionInput, key: Buffer | null): Promise<{ record: SessionRecord; file: string }> {
  const p = loadCsoPrereg();
  const allowance = csoLimits(i.model, p, i.allowance).allowance_usd;
  const runtime = i.runtime ?? { volume: (await buildRuntimeVolume()).volume };
  const tree = treePaths(i.tree);
  const started = Date.now();
  const usage: AttemptUsage[] = [];
  const run: CsoRunRecord = { schema: "cso-run.v1", session: label(i), image_id: i.image.image_id, image_tag: i.image.tag, base_image: i.image.runtime_id, home_tree_sha256: i.home.home_tree_sha256, attempts: [] };
  let last: { attempt: 1 | 2; end: EndRead; summary: Rec | null; records: Rec[]; log: Rec[] } | null = null;
  for (const attempt of [1, 2] as const) {
    const dir = join(i.out, "a" + attempt);
    mkdirSync(dir, { recursive: true });
    const { argv, env, config } = csoRunCopy({ ...i, runtime }, attempt, dir, p);
    const { exit, killed } = await harbor(i.harbor ?? "harbor", argv, env, h2hBudget(config.limits.wall_sec, config.turns.length + config.continuation_cap).timer_ms, join(dir, "harbor.log"));
    const ev = find(join(dir, "jobs"), "evaluator");
    const summary = ev && existsSync(join(ev, SUMMARY)) ? (withRefusalFallback(JSON.parse(readFileSync(join(ev, SUMMARY), "utf8")) as Rec, join(ev, "sdk-messages.jsonl")) as Rec) : null;
    await csoHaltCheck(i, attempt, summary, ev, dir);
    if (ev) for (const f of KEEP) if (existsSync(join(ev, f))) copyFileSync(join(ev, f), join(i.out, f));
    const records = ev ? [...readJsonl(join(ev, "sdk-messages.jsonl"))] : [];
    usage.push(attemptUsage(attempt, summary as never, allowance));
    const end = readEnd(summary, attempt, records);
    run.attempts.push({ attempt, harbor_exit: exit, killed, end: end.end, reason: end.reason });
    last = { attempt, end, summary, records, log: ev ? readJsonl(join(ev, "claude-session.jsonl")) : [] };
    if (!end.retry) break;
    if (!retryCovered(i.capLeftUsd, allowance, usage)) {
      last = { ...last, end: { end: "gap", reason: "E_CSO_GAP_UPSTREAM the retry needs a full $" + allowance + " allowance and the spend cap had $" + (i.capLeftUsd ?? 0).toFixed(2) + " left", retry: false } };
      break;
    }
  }
  const read = csoExposure(last!.records, tree);
  const exposure = { ...read.exposure, loaded: read.exposure.loaded || loaded(events(last!.log as never)) };
  const helper = read.helper;
  const record = csoSessionRecord({ unit: i.unit.unit, arm: i.arm, model: i.model, stage: i.stage, attempts: last!.attempt, end: last!.end, summary: last!.summary, records: last!.records, repoDir: CSO_REPO_DIR, exposure, helper, usage, wall_sec: Math.round((Date.now() - started) / 1000) });
  const file = join(i.out, "session.json");
  writeFileSync(file, (key ? sealRow(record, key) : JSON.stringify(record, null, 1)) + "\n", { flag: "wx" });
  writeFileSync(join(i.out, "run.json"), JSON.stringify(run, null, 1) + "\n", { flag: "wx" });
  return { record, file };
}
