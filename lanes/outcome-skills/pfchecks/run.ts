// Copyright (c) 2026 Garry Tan. MIT License.
// One PF session through the real path (plan sections 4 and 5), modeled on statemachines/run.ts: the session image
// (statemachines/image.ts) from the unit's prepared tree, a Harbor run copy naming it as its prebuilt docker_image, a
// compose overlay that mounts the tools volume read-only at /opt/pf-tools for every arm and the pstack volume at
// /opt/pf-pstack for P and blind (with the tools env) and the pinned Claude Code read-only, then pf_agent:PfAgent on the
// driver's control plane (ledger u4, one slot per turn), then the pf-session.v1 record. A task turn that ends upstream or
// infra retries the whole session once as attempt 2 from a fresh container, naming meta.rerun; a task open the driver
// refuses with 409 CAP_STOP (LedgerCapStop) ends the part as a cap stop, never retried. Every provider key is
// unset for Harbor and HARBOR_TELEMETRY is 0; the only credential the session holds is the driver's slot token.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { buildSessionImage, sessionManifest, type SessionImage } from "../statemachines/image.ts";
import { HARBOR_MODEL } from "../statemachines/run.ts";
import { CLAUDE_BIN } from "../statemachines/stub-claude.ts";
import { readUnit } from "../statemachines/unit.ts";
import { ARM_ENV, DISALLOWED_TOOLS, NO_ANSWER, WRAPUP, loadsPlugin, sessionLimits, taskTurn, type Names, type PfArm } from "./arms.ts";
import { readCapture } from "./capture.ts";
import { readSession, subagentUse } from "./exposure.ts";
import { containUnit, treeDigest } from "./containment.ts";
import type { Arm } from "./items.ts";
import { pfFail } from "./prereg.ts";
import { PSTACK_DIR, pstackVolume } from "./pstack.ts";
import { effortFields, effortHolds, effortProblem, endKind, readWrapup, taskStep, wrapupStep, writeSessionRecord, type EndKind, type PfPlanned, type PfPostTurn, type PfSessionRecord } from "./session.ts";
import { TOOLS_DIR, toolsEnv, toolsVolume } from "./tools.ts";

const ROOT = join(import.meta.dir, "../../..");
const KEYS = /^(ANTHROPIC|OPENAI|OPENROUTER|UBICLOUD|GEMINI|GOOGLE|XAI|DEEPSEEK|TYPESAFE)_[A-Z_]*KEY$|_TOKEN$/;
/** Claude Code's env block in every arm's session (section 4). The tools env is added per image. */
export const CLAUDE_ENV = { CLAUDE_CONFIG_DIR: "/root/.claude", HOME: "/root", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1", ...ARM_ENV, CLAUDE_CODE_MAX_OUTPUT_TOKENS: "32000", DISABLE_AUTOUPDATER: "1", DISABLE_TELEMETRY: "1", DISABLE_ERROR_REPORTING: "1", IS_SANDBOX: "1" } as const;
/** meta.rerun on attempt 2's task slot: the whole-session retry after a task turn's upstream or infra end. */
export const TASK_RERUN = "task_upstream_or_infra";

export interface PfRunInput {
  unitDir: string; session: PfPlanned; names: Names; control: string; proxy: string; out: string;
  /** The tree volume the session image copies (the unit's prepared, stripped tree). */
  volume: string;
  /** The bug report; the unit's issue.md by default. */
  issue?: string;
  /** The blind probe's one-line scope (section 4's {scope}); only the blind arm's task turn uses it. */
  scope?: string; allowance?: Record<Arm, Record<string, number>>; harbor?: string; claude?: string;
  /** real_agent's in-container egress probe node; "" skips the probe (an image with no node). */
  probeNode?: string; jobName?: string;
  /** The dry run's effort record per model (effort.json). With it, a session whose task slot has no proxy-recorded effort
   *  fields, or fields that differ from its model's record, is gap E_PF_INFRA_GAP (section 3). Every paid session passes
   *  it; null only for the dry run's own sessions that write the record. */
  effort: Record<string, Record<string, unknown>> | null;
}
export interface PfRun { record: PfSessionRecord; file: string; image: SessionImage; attempts: Array<{ dir: string; harbor_exit: number; summary: Record<string, any> | null; evaluator: string | null }> }

const sha = (b: string | Buffer) => createHash("sha256").update(b).digest("hex");
const sum = (xs: Array<number | null | undefined>) => xs.reduce<number>((a, x) => a + (x ?? 0), 0);
function find(dir: string, name: string): string | null {
  if (!existsSync(dir)) return null;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const p = join(dir, e.name);
    if (e.name === name) return p;
    const q = find(p, name);
    if (q) return q;
  }
  return null;
}

/** The compose overlay: the tools volume for every arm, pstack for P and blind, the pinned Claude Code, the tools env. */
export function composeOverlay(arm: PfArm, image: string, claude: string): { services: { main: { volumes: Array<Record<string, unknown>>; environment: Record<string, string> } }; volumes: Record<string, { external: true }> } {
  const named = [toolsVolume(), ...(loadsPlugin(arm) ? [pstackVolume()] : [])];
  const volumes = [...named.map((source, n) => ({ type: "volume", source, target: n ? PSTACK_DIR : TOOLS_DIR, read_only: true })), { type: "bind", source: claude, target: "/usr/local/bin/claude", read_only: true }];
  const environment = Object.fromEntries(toolsEnv(image).map((e) => [e.slice(0, e.indexOf("=")), e.slice(e.indexOf("=") + 1)]));
  return { services: { main: { volumes, environment } }, volumes: Object.fromEntries(named.map((v) => [v, { external: true as const }])) };
}

/** The code's own bounds on one attempt, in seconds, each from the file and constant its key names: laneb_agent.py
 *  PROBE_TIMEOUT_S (docker ps, docker inspect), OPEN_ATTEMPTS, OPEN_RETRY_S, post_json's timeout (a slot open) and
 *  DEFAULT_SETUP_TIMEOUT_SEC (Harbor's agent setup); egress.py _helper (each nft call) and probe; pf_agent.py's docker cp
 *  and CLOSE_TIMEOUT_S; pf_turns.py Session.sh's default timeout, KILL_TIMEOUT_S and the client.disconnect wait; Harbor's
 *  default environment build_timeout_sec. The budget's test reads each one from its source file. */
export const BOUNDS = { probe_s: 60, tries: 3, sleep_s: 2, open_s: 30, setup_s: 900, egress_s: 120, egress_probe_s: 60, copy_s: 120, close_s: 120, step_s: 600, kill_s: 60, disconnect_s: 30, build_s: 600, margin_s: 600 } as const;

/** Section 4's session along the longest path an attempt can take inside Harbor's agent phase: every pre-open call and
 *  every post-turn container call at its timeout, each turn's slot open and close with every retry, each turn at its
 *  wall (the SDK connect counts inside it), and the last step timing out, killed, then read by state.sh. Harbor's agent
 *  timeout (agent_s) is that sum plus a margin; run.ts's own timer (timer_ms) adds Harbor's agent setup and image
 *  build and another margin on top. */
export function sessionBudget(limits: { task: { wall_limit_sec: number }; wrapup: { wall_limit_sec: number } }): { terms: Array<[string, number]>; agent_s: number; timer_ms: number } {
  const b = BOUNDS;
  const turn = (wall: number) => b.tries * b.open_s + (b.tries - 1) * b.sleep_s + wall + b.disconnect_s + b.tries * b.close_s + (b.tries - 1) * b.sleep_s;
  const terms: Array<[string, number]> = [
    ["pre-open: docker ps and docker inspect, 2 x probe_s", 2 * b.probe_s],
    ["pre-open: the egress write and its two reads, 3 x egress_s", 3 * b.egress_s],
    ["pre-open: the egress probe, egress_probe_s", b.egress_probe_s],
    ["pre-open: docker cp of the pf scripts, copy_s", b.copy_s],
    ["pre-open: the tree check, claude --version and the start inventory, 3 x step_s", 3 * b.step_s],
    ["task turn: open, wall, disconnect, close with retries", turn(limits.task.wall_limit_sec)],
    ["wrap-up turns: 2 x (open, wall, disconnect, close with retries)", 2 * turn(limits.wrapup.wall_limit_sec)],
    ["post-turn steps: capture, reset, keep and bundle, each a stamp and its command, 8 x step_s", 8 * b.step_s],
    ["post-turn copies: CHECKS.json and the transcript, 2 x step_s", 2 * b.step_s],
    ["the last step's timeout: its kill and state.sh, kill_s + step_s", b.kill_s + b.step_s],
    ["margin, margin_s", b.margin_s],
  ];
  const agent_s = terms.reduce((n, t) => n + t[1], 0);
  return { terms, agent_s, timer_ms: (agent_s + b.setup_s + b.build_s + b.margin_s) * 1000 };
}

/** One attempt's run copy, pf_config, task.json and image manifest under dir; returns Harbor's argv and env. Its task.toml
 *  sets Harbor's agent timeout to the session's budget (sessionBudget), in place of the unit's. */
export function runCopy(i: PfRunInput, image: SessionImage, attempt: 1 | 2, dir: string): { argv: string[]; env: Record<string, string>; config: Record<string, any> } {
  const u = readUnit(i.unitDir);
  const s = i.session;
  const model = HARBOR_MODEL[s.model] ?? pfFail("E_PF_ARM", "pf session run has no Harbor model for " + s.model);
  const task = join(dir, "task");
  mkdirSync(join(task, "environment"), { recursive: true });
  writeFileSync(join(task, "environment/Dockerfile"), "FROM " + image.tag + "\n");
  const toml = readFileSync(join(i.unitDir, "harbor/task.toml"), "utf8").replace(/^\s*docker_image\s*=.*\n?/m, "");
  if (!/^\[environment\]$/m.test(toml)) pfFail("E_PF_ARM", "unit " + u.id + "'s harbor/task.toml has no [environment] section");
  const agentS = sessionBudget(sessionLimits(s.arm, s.model, i.allowance)).agent_s;
  let section = "";
  const lines = toml.replace(/^\[environment\]$/m, "[environment]\ndocker_image = " + JSON.stringify(image.tag)).split("\n").flatMap((l) => {
    const h = l.match(/^\s*\[([^\]]+)\]\s*$/);
    if (h) section = h[1]!;
    if (section === "agent" && !h && /^\s*timeout_sec\s*=/.test(l)) return [];
    return h && section === "agent" ? [l, "timeout_sec = " + agentS] : [l];
  });
  writeFileSync(join(task, "task.toml"), (lines.some((l) => /^\s*\[agent\]\s*$/.test(l)) ? lines : [...lines, "[agent]", "timeout_sec = " + agentS, ""]).join("\n"));
  writeFileSync(join(task, "instruction.md"), "The arm's turn carries the task.\n");
  const label = u.id + "/" + s.model + "/" + s.arm + "/" + s.index;
  const taskJson = join(dir, "task.json");
  writeFileSync(taskJson, JSON.stringify({ repo_dir: u.repo_dir, commits: image.commits, base_commit: image.head, kind: "PF" }));
  const overlay = composeOverlay(s.arm, image.tag, i.claude ?? CLAUDE_BIN);
  const config = {
    schema: "pf-config.v1", arm: s.arm, names: i.names, task_text: taskTurn(s.arm, { issue: i.issue ?? readFileSync(join(i.unitDir, "issue.md"), "utf8"), scope: i.scope, names: i.names }), wrapup_text: WRAPUP,
    limits: sessionLimits(s.arm, s.model, i.allowance), no_answer: NO_ANSWER, plugin: loadsPlugin(s.arm) ? PSTACK_DIR : null, env: { ...CLAUDE_ENV, ...overlay.services.main.environment },
  };
  const pfConfig = join(dir, "pf-config.json");
  writeFileSync(pfConfig, JSON.stringify(config, null, 1) + "\n");
  const compose = join(dir, "pf.compose.yaml");
  writeFileSync(compose, JSON.stringify(overlay, null, 1) + "\n");
  const manifest = join(dir, "images.json");
  const manifestSha = sessionManifest(manifest, label, image);
  const armTar = join(dir, "arm.tar");
  writeFileSync(armTar, Buffer.alloc(10240));
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !KEYS.test(k))) as Record<string, string>;
  env.ANTHROPIC_API_KEY = "placeholder-not-a-key";
  env.HARBOR_TELEMETRY = "0";
  env.PYTHONPATH = [import.meta.dir, join(ROOT, "lanes/real-outcome/agent"), join(ROOT, "quick/laneb/runner/agent")].join(":");
  env.PYTHONDONTWRITEBYTECODE = "1";
  const ak: Record<string, string> = {
    skip_install: "true", task_json: taskJson, pf_config: pfConfig, arm: "pf:" + s.arm, arm_tar: armTar, upstream_model: s.model, control_url: i.control, ledger: "u4", task_label: label, trial_n: "1",
    ...(attempt === 2 ? { rerun: TASK_RERUN } : {}), image_id: image.image_id, manifest, manifest_sha256: manifestSha, repo_dir: u.repo_dir, workdir: u.work_dir, ...(i.probeNode !== undefined ? { probe_node: i.probeNode } : {}),
  };
  const argv = ["run", "-y", "-p", task, "-a", "pf_agent:PfAgent", "-m", model, "--base-url", /^https?:\/\//.test(i.proxy) ? i.proxy : "http://" + i.proxy, ...Object.entries(ak).flatMap(([k, v]) => ["--ak", k + "=" + v]), "-e", "docker", "--extra-docker-compose", join(ROOT, "quick/laneb/runner/agent-caps.compose.yaml"), "--extra-docker-compose", compose, "-o", join(dir, "jobs"), "--job-name", (i.jobName ?? "pf-" + sha(label + dir).slice(0, 12)) + "-a" + attempt, "--disable-verification"];
  return { argv, env, config };
}

/** Runs Harbor and kills it at timeoutMs; killed says whether that timer fired. */
export function harbor(bin: string, argv: string[], env: Record<string, string>, timeoutMs: number, log: string): Promise<{ exit: number; killed: boolean }> {
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

/** pf_turns' line per slot open, written before the open request, in the evaluator dir. */
export const OPENS = "pf-opens.jsonl";

/** pf_turns' refusal of a post-turn step whose cause lies in what the agent wrote (Session.step). */
const POST_TURN = /^E_PF_ARM post_turn /;
/** The tree or home check's refusal before any open. */
const armRefusal = (summary: Record<string, any> | null) => typeof summary?.refused === "string" && /^E_PF_ARM/.test(summary.refused) && !POST_TURN.test(summary.refused);
/** The commit an S bundle's HEAD names, or null when git cannot read the bundle. */
function bundleHead(file: string): string | null {
  const r = spawnSync("git", ["bundle", "list-heads", file], { encoding: "utf8" });
  return r.status === 0 ? (/^([0-9a-f]{40}) HEAD$/m.exec(r.stdout)?.[1] ?? null) : null;
}
/** Whether an attempt's end retries the whole session from a fresh container: a task turn's upstream or infra end does,
 *  a tree or home refusal before any open or a cap stop never does. */
export const retriesSession = (summary: Record<string, any> | null, record: PfSessionRecord): boolean => !record.cap_stop && !armRefusal(summary) && taskStep([record.task.end]).action === "retry_session";

/** The pf-session.v1 record from one attempt's pf-summary.json (none: an infra end). A tree or home refusal before any
 *  open is gap E_PF_ARM and takes no retry. A wrap-up turn refused for its allowance (an allowance stop on its slot, as
 *  the close answer's allowance_stops counts it, or the driver's 409 CAP_STOP on its open) is gap E_PF_WRAPUP_ALLOWANCE. A
 *  turn whose close answer says the proxy's finalize failed (finalized false) has unknown counts and ends as infra, but
 *  an allowance stop reads first, so a turn that also counts one stays an allowance end. The effort fields are the task slot's, as the driver's
 *  proxy recorded them; with i.effort, missing or different fields make the session gap E_PF_INFRA_GAP. exception is
 *  Harbor's exception type for the trial: LedgerCapStop (the driver refused the task open with 409 CAP_STOP) is a cap stop,
 *  which ends the part with no gap and no retry, as the other lanes read it. An S bundle whose HEAD is not the head the
 *  session-end commit printed (PF_CAPTURE head=) is gap E_PF_ARM with reason head_mismatch, with no retry. base is the
 *  unit's base commit (the session image's head), carried in the record for scoring's root check. A post-turn step that
 *  fails (the capture, a wrap-up reset or keep, the S bundle) takes no retry, and the session still writes its
 *  session.json: when its cause lies in what the agent wrote (pf_turns' E_PF_ARM post_turn refusal) it is gap E_PF_ARM with
 *  reason post_turn, and otherwise (E_PF_CAPTURE) gap E_PF_INFRA_GAP. Neither masks a wrap-up turn refused for its
 *  allowance, which stays E_PF_WRAPUP_ALLOWANCE. */
export function pfRecord(i: PfRunInput, attempt: 1 | 2, summary: Record<string, any> | null, ev: string | null, exception: string | null = null, base: string | null = null): PfSessionRecord {
  const capStop = exception === "LedgerCapStop";
  const s = i.session;
  const slots = (summary?.slots ?? []) as Array<Record<string, any>>;
  const spent = (phase: string) => sum(slots.filter((x) => x.phase === phase).map((x) => x.close?.spent_micros));
  const t = summary?.task as Record<string, any> | null | undefined;
  const unfinalized = (x: Record<string, any>) => x.finalized === false && !((x.allowance_stops ?? 0) > 0);
  const tEnd = endKind({ termination: t && t.termination !== "error" ? t.termination : null, refusals: t?.refused ?? [], allowance_stop: (t?.allowance_stops ?? 0) > 0, harness: !t || t.termination === "error" || unfinalized(t) });
  const ends: EndKind[] = ((summary?.wrapup ?? []) as Array<Record<string, any>>).map((w) => ((w.refused ?? []).includes("CAP_STOP") ? "limit_allowance" : endKind({ termination: w.termination === "error" ? null : w.termination, refusals: w.refused ?? [], allowance_stop: (w.allowance_stops ?? 0) > 0, harness: w.termination === "error" || unfinalized(w) })));
  const ts = armRefusal(summary) ? null : taskStep(attempt === 2 ? ["infra", tEnd] : [tEnd]);
  const ws = ts?.action === "wrapup" && ends.length ? wrapupStep(ends) : null;
  const first = slots.find((x) => x.phase === "task")?.close?.first_request as Record<string, unknown> | null | undefined;
  const effort = first ? effortFields(first) : null;
  const cap = summary?.capture ? readCapture(summary.capture) : null;
  const keep = summary?.keep ? readWrapup(summary.keep) : { checks: false, discarded: [] as string[] };
  const cs = ev ? join(ev, "claude-session.jsonl") : "";
  const sdk = ev ? join(ev, "sdk-messages.jsonl") : "";
  const bundle = ev ? join(ev, "s.bundle") : "";
  const hasS = !!bundle && existsSync(bundle) && statSync(bundle).size > 0;
  const refused = typeof summary?.refused === "string" ? summary.refused : "";
  const wrapAllowance = ws?.action === "gap" && ws.code === "E_PF_WRAPUP_ALLOWANCE";
  const reason = capStop ? null : !ts ? "tree_check" : cap && hasS && bundleHead(bundle) !== cap.head ? "head_mismatch" : POST_TURN.test(refused) && !wrapAllowance ? "post_turn" : null;
  const scriptFailed = /^E_PF_CAPTURE /.test(refused) && !wrapAllowance;
  const gap = capStop ? null : reason ? "E_PF_ARM" : scriptFailed ? "E_PF_INFRA_GAP" : i.effort && !effortHolds(effort, i.effort[s.model]) ? "E_PF_INFRA_GAP" : ts!.action === "gap" ? ts!.code : ts!.action === "retry_session" ? "E_PF_INFRA_GAP" : !ws ? "E_PF_INFRA_GAP" : ws.action === "gap" ? ws.code : ws.action === "rerun_wrapup" ? "E_PF_INFRA_GAP" : null;
  const q = Object.values((summary?.questions ?? {}) as Record<string, { ask_user_question?: number; prose_questions?: number }>);
  return {
    schema: "pf-session.v1", unit: s.unit, part: s.part, index: s.index, model: s.model, arm: s.arm, item: s.item, attempt, names: i.names,
    lease_id: ((summary?.events ?? []) as Array<Record<string, any>>).find((e) => e.event === "u4_slot")?.lease_id ?? "",
    task: { end: tEnd, turns: null, wall_ms: Math.round((t?.wall_s ?? 0) * 1000), spent_micros: spent("task") }, wrapup: ends.length ? { ends, turns: null, spent_micros: spent("wrapup") } : null,
    wrapup_end: ws?.action === "score" ? ws.wrapup_end : null, gap, gap_reason: reason, post_turn: (summary?.post_turn as PfPostTurn | undefined) ?? null, base_commit: base, capture: cap, forced: cap?.forced ?? [], discarded: keep.discarded,
    checks: keep.checks && ev ? join(ev, "CHECKS.json") : null, s: hasS ? { repo: bundle, ref: "HEAD" } : null,
    transcript: ev ? join(ev, "sdk-messages.jsonl") : null, claude_session: cs && existsSync(cs) && statSync(cs).size > 0 ? cs : null, effort,
    questions: { ask_user_question: sum(q.map((x) => x.ask_user_question)), prose: sum(q.map((x) => x.prose_questions)) }, cap_stop: capStop, env: { ...ARM_ENV },
    disallowed_tools: [...DISALLOWED_TOOLS], plugin: loadsPlugin(s.arm) ? PSTACK_DIR : null, tools: toolsVolume(),
    in_flight: { reservation_bound: sum(slots.map((x) => x.close?.reservation_bound)), ...(sdk && existsSync(sdk) ? subagentUse(readSession(sdk)) : { subagents: 0, subagent_cap_refused: 0 }) },
  };
}

/** After one attempt, whether the whole session retries from a fresh container. A slot whose close answer says the proxy's
 *  finalize failed (finalized false), with no allowance stop counted, first halts the session with E_PF_FINALIZE_HALT:
 *  no retry and no session record, while the driver halts the item's stage and names the lease's journal, which the
 *  Captain reads before ruling on a retry. So does any attempt that left no summary after pf_turns recorded a slot open
 *  in ev's pf-opens.jsonl, whatever ended it (ended names it for the halt line: run.ts's kill, Harbor's exception, its
 *  exit): that slot's counts are unknown, and it may have spent. */
export function retryAfter(i: PfRunInput, attempt: 1 | 2, summary: Record<string, any> | null, record: PfSessionRecord, dir: string, ended: string | null = null, ev: string | null = null): boolean {
  const lost = ((summary?.slots ?? []) as Array<Record<string, any>>).filter((x) => x.close?.finalized === false && !((x.close?.allowance_stops ?? 0) > 0)).map((x) => String(x.id));
  const s = i.session;
  const label = s.unit + "/" + s.model + "/" + s.arm + "/" + s.index + " attempt " + attempt;
  if (lost.length) pfFail("E_PF_FINALIZE_HALT", label + ": the proxy's finalize failed at the close of session " + lost.join(", ") + " on lease " + record.lease_id + ", so its counts are unknown; the session halts with no retry and no session record, and the driver's E_PF_FINALIZE_HALT line names the journal (" + record.lease_id + ".journal.ndjson in its run dir); " + dir);
  if (!summary && ev && existsSync(join(ev, OPENS)) && readFileSync(join(ev, OPENS), "utf8").trim()) pfFail("E_PF_FINALIZE_HALT", label + ": " + (ended ?? "the attempt ended") + " after pf_turns opened a slot (" + join(ev, OPENS) + "), and no summary names that slot's counts, so it may have spent; the session halts with no retry and no session record, and the driver's E_PF_FINALIZE_HALT line names the lease's journal; " + dir);
  return attempt === 1 && retriesSession(summary, record);
}

/** Writes out/session.json. A cap stop then ends the part (CAP_STOP): it is incomplete, and nothing is retried. */
export function finishSession(file: string, record: PfSessionRecord): void {
  writeSessionRecord(file, record);
  if (record.cap_stop) pfFail("CAP_STOP", record.unit + "/" + record.model + "/" + record.arm + "/" + record.index + " stopped at the cap (LedgerCapStop): the driver refused its task open, so the part ends incomplete and is not retried; " + file);
}

/** Builds the image, runs the containment gate on it (containUnit with the tree volume's digest from before the build: the
 *  unit's first session runs the check, later ones reuse its passing record, and a failure halts the unit with
 *  E_PF_CONTAINMENT), runs Harbor (and the whole-session retry
 *  from a fresh container when the task turn ends upstream or infra, unless a failed proxy finalize, or an attempt that
 *  left no summary after a slot opened, halts it first), and
 *  writes out/session.json. Async, so a caller serving the control plane in this process keeps serving it. */
export async function runPfSession(i: PfRunInput): Promise<PfRun> {
  if (existsSync(i.out)) pfFail("E_PF_ARM", i.out + " exists; each session writes a new run dir");
  const badEffort = i.effort && effortProblem(i.effort);
  if (badEffort) pfFail("E_PF_INPUT", "the effort record is not the dry run's effort.json: " + badEffort);
  if (i.effort && !i.effort[i.session.model]) pfFail("E_PF_INPUT", "the effort record has no entry for " + i.session.model + "; the dry run's effort.json names every model");
  mkdirSync(i.out, { recursive: true });
  const u = readUnit(i.unitDir);
  const before = treeDigest({ runtime_id: u.image.runtime_id ?? "", volume: i.volume });
  const image = buildSessionImage(u, { volume: i.volume, stage: "first" });
  containUnit(i.unitDir, u, image, before);
  const limits = sessionLimits(i.session.arm, i.session.model, i.allowance);
  const timeout = sessionBudget(limits).timer_ms;
  const attempts: PfRun["attempts"] = [];
  let record: PfSessionRecord | null = null;
  for (const attempt of [1, 2] as const) {
    const dir = join(i.out, "a" + attempt);
    mkdirSync(dir, { recursive: true });
    const { argv, env } = runCopy(i, image, attempt, dir);
    const { exit, killed } = await harbor(i.harbor ?? "harbor", argv, env, timeout, join(dir, "harbor.log"));
    const ev = find(join(dir, "jobs"), "evaluator");
    const summary = ev && existsSync(join(ev, "pf-summary.json")) ? (JSON.parse(readFileSync(join(ev, "pf-summary.json"), "utf8")) as Record<string, any>) : null;
    const result = ev && existsSync(join(dirname(ev), "result.json")) ? (JSON.parse(readFileSync(join(dirname(ev), "result.json"), "utf8")) as Record<string, any>) : null;
    attempts.push({ dir, harbor_exit: exit, summary, evaluator: ev });
    const exception: string | null = result?.exception_info?.exception_type ?? null;
    record = pfRecord(i, attempt, summary, ev, exception, image.head);
    if (!retryAfter(i, attempt, summary, record, dir, killed ? "Harbor was killed at its timeout" : exception ? "Harbor ended on " + exception : "Harbor exited " + exit, ev)) break;
  }
  const file = join(i.out, "session.json");
  finishSession(file, record!);
  return { record: record!, file, image, attempts };
}
