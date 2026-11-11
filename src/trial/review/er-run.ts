// Copyright (c) 2026 Garry Tan. MIT License.
// The eng-review lens's session loop (prereg 2026-11-08-geva-405, sections 5, 6 and 16). It runs each planned review on
// the rig review-units builds, through runTrial and the Claude Code driver, with its own admission instead of run.ts's
// rounds, since the prereg's rule is per attempt. The rules, with the build-time choices this file makes:
//
// - Order: eng-review.ts's erOrder. Every attempt runs in a fresh directory, <session>/a1 and <session>/a2, where
//   <session> is run.ts's sessionDir.
// - Admission (eng-review.ts erAdmits): the head of the queue starts only when the spend settled in this launch plus
//   the $10 allowance of every attempt in flight plus its own fits under the cap, with at most --parallel attempts in
//   flight. When it doesn't fit, the loop waits for an attempt in flight to settle; with none in flight it is a cap
//   stop. Attempts start in queue order and a retry goes to the head of the queue. A proxy cap stop (cap_stop) stops the
//   launch too. Attempts in flight at a stop finish and are journaled; nothing a cap stop ended is retried.
// - Each attempt: the unit tree at /work (plan.md and repo/), the arm's prompt, the claude-code-preset system prompt,
//   200 turns, 5400 s, a $10 slot allowance, cap stops on, a 200,000-token window, the rec user (eng-review.ts), and
//   GSTACK_SESSION_KIND=unattended on skill arms. Skill arms get a seeded state root; none and lens get none. The eng
//   phase arm mounts its unit's rendered files read-only and writes host/er-opening.json for the detector. At the end
//   the state root goes to host/gstack-state and /work/repo/.gstack/plan-coverage to host/plan-coverage, for every arm.
// - Outcome: parse.ts's erOutcome, retries and endStateOf. An arm stop or an infrastructure failure on attempt 1 gets one
//   retry under its named reason. The journal (<out>/sessions.ndjson) gets one line per settled session with every
//   attempt and its spend, the last attempt's parse, the end state, web results, the Stop hook's blocks and, for a
//   skill arm, exposure.ts's erDecisions on the last attempt. E_ER_ARM_STOP, E_ER_INFRA_MISSING and
//   E_ER_WEB_CONTAMINATED lines go to the log.
// - --enforce <arm> (smoke rule 2) wires stophook.ts's erStopHook into that arm's sessions as the driver's SDK Stop
//   hook, on the live transcript, state root and plan-coverage folder; its blocks print per session.
// - Resume: a journaled session whose key still matches is reused with its spend (carried); a changed key stops the
//   launch with E_CACHE_STALE before any spend. Cells an earlier stops.json lists are carried with their spend and
//   never retried.
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, posix } from "node:path";
import { erDecisions, erExposure, sessionEvidence, type ErEvidence } from "../../../lanes/eng-review/exposure.ts";
import { ER_PARSER_SHA256, endStateOf, erOutcome, retries, type ErOutcome, type ErParse } from "../../../lanes/eng-review/parse.ts";
import { erStopHook } from "../../../lanes/eng-review/stophook.ts";
import type { ArmId, EndState } from "../../../lanes/eng-review/types.ts";
import { BACKGROUND_WAIT_MS } from "../../adapters/claude-code/driver.ts";
import { hostDriver } from "../../adapters/host.ts";
import { providerOf, type LoadedPolicy } from "../../skill-eval/cli/policy.ts";
import { armNamespaces, armTree, slotModels, type HostRig } from "../../skill-eval/cli/run-host.ts";
import type { ReadOnlyMount } from "../sandbox.ts";
import { STATE_ROOT_DIR } from "../state-root.ts";
import { runTrial } from "../trial.ts";
import { ER_ALLOWANCE_MICROS, ER_COVERAGE_DIR, ER_MAX_TURNS, ER_REC_USER, ER_REC_USER_SHA256, ER_SKILL, ER_SYSTEM_PROMPT, ER_TEMPLATE_SHA256, ER_TIMEOUT_S, erAdmits, erCellId, erFreeform, erOrder, erPrompt, isSkillArm, type ErCell, type ErSkillArm } from "./eng-review.ts";
import { sessionDir } from "./run.ts";

const sha256 = (t: string) => createHash("sha256").update(t).digest("hex");

export interface ErOpening {
  text: string;
  sha256: string;
  mounts: ReadOnlyMount[];
  methodology: string;
  readRanges: Array<{ offset: number; limit: number }>;
}
export interface ErUnit {
  id: string;
  task: string;
  tree: string;
  tree_sha256: string;
  /** The eng phase arm's rendered opening; null when the run has no eng phase arm. */
  opening: ErOpening | null;
}
export interface ErRunInput {
  units: ErUnit[];
  arms: ArmId[];
  models: string[];
  passes: number;
  parallel: number;
  /** Micro-dollars: the lease this launch opened on the item. */
  cap: number;
  out: string;
  runId: string;
  policy: LoadedPolicy;
  enforce: ErSkillArm | null;
  /** Run only the first queued session of each arm and model that has none journaled, and hold the rest for --resume. */
  firstOnly?: boolean;
  /** The image, recipe and adapter the session key binds. */
  keyBase: Record<string, unknown>;
}
export interface ErAttempt {
  attempt: number;
  dir: string;
  termination: string;
  outcome: ErOutcome["state"];
  reason: string | null;
  detail: string | null;
  usd: number;
}
export interface ErEntry {
  cell: ErCell;
  key: string;
  prompt_sha256: string;
  opening_sha256: string | null;
  parser_sha256: string;
  attempts: ErAttempt[];
  end_state: EndState;
  arm_stop: boolean;
  parse: ErParse;
  web: number;
  usd: number;
  wall_s: number | null;
  enforced: boolean;
  blocks: number;
  decisions: ReturnType<typeof erDecisions> | null;
}
export interface ErStopped {
  cell: ErCell;
  how: "stopped" | "unstarted";
  usd: number;
}
export interface ErRun {
  entries: ErEntry[];
  stopped: ErStopped[];
  stops: Array<{ code: string; message: string }>;
  /** Settled in this launch, and carried from reused and earlier cap-stopped cells. */
  spent_usd: number;
  carried_usd: number;
  /** Sessions --first-only left queued: neither run nor stopped, so a --resume runs them. */
  held: number;
}

export const erJournal = (out: string) => join(out, "sessions.ndjson");
export const erStopsFile = (out: string) => join(out, "stops.json");

export function readErJournal(out: string): Map<string, ErEntry> {
  const m = new Map<string, ErEntry>();
  if (!existsSync(erJournal(out))) return m;
  for (const line of readFileSync(erJournal(out), "utf8").split("\n")) if (line.trim()) {
    const e = JSON.parse(line) as ErEntry;
    m.set(erCellId(e.cell), e);
  }
  return m;
}
export function readErStops(out: string): ErStopped[] {
  return existsSync(erStopsFile(out)) ? (JSON.parse(readFileSync(erStopsFile(out), "utf8")).stopped as ErStopped[]) : [];
}

const cellName = (c: ErCell) => c.arm + "/" + c.model + "/" + c.unit + "/p" + c.pass;

export async function runErUnits(o: ErRunInput, rig: HostRig, log: (line: string) => void = () => {}): Promise<ErRun> {
  const units = new Map(o.units.map((u) => [u.id, u]));
  const promptOf = (c: ErCell) => erPrompt(c.arm, c.arm === "engphase" ? units.get(c.unit)!.opening?.text ?? null : null);
  const keyOf = (c: ErCell) => sha256(JSON.stringify({ lens: "eng-review", ...o.keyBase, arm_tree: armTree(rig, c.arm, c.model), prompt: sha256(promptOf(c)), template: ER_TEMPLATE_SHA256, tree: units.get(c.unit)!.tree_sha256, model: c.model, max_turns: ER_MAX_TURNS, timeout_s: ER_TIMEOUT_S, allowance: ER_ALLOWANCE_MICROS, parser: ER_PARSER_SHA256, rec_user: ER_REC_USER_SHA256, enforced: o.enforce === c.arm, policy: o.policy.sha256 }));
  const plan = erOrder(o.units.map((u) => u.id), o.arms, o.models, o.passes);
  const prior = readErJournal(o.out);
  const priorStops = readErStops(o.out);
  const stops: ErRun["stops"] = [];
  const stale = plan.filter((c) => prior.has(erCellId(c)) && prior.get(erCellId(c))!.key !== keyOf(c));
  if (stale.length) {
    stops.push({ code: "E_CACHE_STALE", message: stale.length + " journaled session" + (stale.length === 1 ? "" : "s") + " no longer match their key (" + stale.slice(0, 3).map(cellName).join(", ") + "); start a new run in a new --out" });
    for (const s of stops) log(s.code + " " + s.message);
    return { entries: [], stopped: [], stops, spent_usd: 0, carried_usd: 0, held: 0 };
  }
  const entries: ErEntry[] = plan.flatMap((c) => (prior.has(erCellId(c)) ? [prior.get(erCellId(c))!] : []));
  const stoppedBefore = new Set(priorStops.map((s) => erCellId(s.cell)));
  const stopped: ErStopped[] = priorStops.filter((s) => !prior.has(erCellId(s.cell)));
  const carried_usd = entries.reduce((s, e) => s + e.usd, 0) + stopped.reduce((s, x) => s + x.usd, 0);
  if (stopped.length) stops.push({ code: "CAP_STOP", message: stopped.length + " cell" + (stopped.length === 1 ? "" : "s") + " a cap stop ended before this resume, carried with their settled spend and never retried" });
  mkdirSync(o.out, { recursive: true });
  const empty = join(o.out, "fixtures");
  mkdirSync(empty, { recursive: true });
  let settled = 0;

  const attemptOnce = async (cell: ErCell, attempt: number) => {
    const unit = units.get(cell.unit)!;
    const provider = providerOf(o.policy, cell.model);
    if (!provider) throw new Error("E_MODEL_POLICY: " + cell.model + " has no provider in the policy");
    const skillArm = isSkillArm(cell.arm);
    const binding = await rig.bind({ cell: { run_id: o.runId, arm: cell.arm, task: unit.task, model: cell.model, trial: cell.pass, attempt }, models: slotModels(o.policy, cell.model, null), allowance_micros: ER_ALLOWANCE_MICROS });
    const sandbox = rig.sandbox(cell.arm, false, cell.model);
    const dir = join(sessionDir(o.out, cell.model, cell.arm, unit.task, cell.pass), "a" + attempt);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(join(dir, "host"), { recursive: true });
    const home = sandbox.homePath(dir);
    const install = rig.arms[cell.arm]!;
    const name = ER_SKILL[cell.arm];
    const skill = install.skill && name ? { name, roots: install.skill.roots.map((r) => posix.join(home, r)), home, dir: install.skill.dir, namespaces: armNamespaces(install) } : null;
    const work = join(dir, "work", unit.task);
    const opening = cell.arm === "engphase" && unit.opening ? { methodology: unit.opening.methodology, readRanges: unit.opening.readRanges } : null;
    if (opening) writeFileSync(join(dir, "host", "er-opening.json"), JSON.stringify({ sha256: unit.opening!.sha256, ...opening }, null, 2) + "\n");
    const hook = o.enforce === cell.arm && skillArm ? erStopHook(cell.arm, (t): ErEvidence => ({ transcript: t, stateRoot: join(work, STATE_ROOT_DIR), coverage: join(work, ER_COVERAGE_DIR), opening })) : null;
    const agent = (rig.driver ?? hostDriver)({ host: "claude", model: cell.model, provider, proxy: { baseUrl: rig.baseUrl, slot: binding.slot, token: binding.token }, interactive: true, skill, out: join(dir, "host"), entry: { user: ER_REC_USER }, freeform: erFreeform, systemPrompt: ER_SYSTEM_PROMPT, maxTurns: ER_MAX_TURNS, ...(skillArm ? { sessionKind: "unattended" as const } : {}), disable1mContext: true, capStops: true, backgroundWaitMs: BACKGROUND_WAIT_MS, ...(hook ? { stopHook: hook.onStop } : {}) });
    const trial = await runTrial({ cell: { model: cell.model, arm: cell.arm, round: 1, trial: cell.pass }, task: { id: unit.task, prompt: promptOf(cell) }, tasksDir: empty, sandbox, agent, dir, timeoutS: ER_TIMEOUT_S, network: rig.network, seed: unit.tree, root: true, copyDirs: [{ from: STATE_ROOT_DIR, to: join(dir, "host", "gstack-state") }, { from: ER_COVERAGE_DIR, to: join(dir, "host", "plan-coverage") }], ...(skillArm ? {} : { stateRoot: false as const }), ...(cell.arm === "engphase" && unit.opening ? { mounts: unit.opening.mounts } : {}) });
    const meter = await rig.finalize(binding.meter_id);
    let transcript: string | null = null;
    try {
      transcript = readFileSync(join(dir, "host", "transcript.ndjson"), "utf8");
    } catch {
      transcript = null;
    }
    let wall: number | null = null;
    try {
      const clock = JSON.parse(readFileSync(join(dir, "host", "session.json"), "utf8"));
      wall = typeof clock.session_ms === "number" ? clock.session_ms / 1000 : null;
    } catch {
      wall = null;
    }
    const termination = trial.record.termination;
    const read = erOutcome(termination, transcript);
    if (hook) log(cellName(cell) + " a" + attempt + ": the Stop hook blocked " + hook.blocks() + " stop" + (hook.blocks() === 1 ? "" : "s"));
    const outcome = read.outcome;
    const a: ErAttempt = { attempt, dir, termination: termination.kind, outcome: outcome.state, reason: outcome.state === "arm-stop" || outcome.state === "infra" ? outcome.reason : null, detail: outcome.state === "arm-stop" || outcome.state === "infra" ? outcome.detail : null, usd: meter.micros / 1_000_000 };
    return { micros: meter.micros, attempt: a, outcome, parse: read.parse, wall, blocks: hook?.blocks() ?? 0 };
  };

  type Job = { cell: ErCell; attempt: number; before: ErAttempt[] };
  const pending: Job[] = plan.filter((c) => !prior.has(erCellId(c)) && !stoppedBefore.has(erCellId(c))).map((cell) => ({ cell, attempt: 1, before: [] }));
  const started = new Set(entries.map((e) => e.cell.arm + "/" + e.cell.model));
  const queue = o.firstOnly
    ? pending.filter((j) => {
        const k = j.cell.arm + "/" + j.cell.model;
        if (started.has(k)) return false;
        started.add(k);
        return true;
      })
    : pending;
  const held = pending.length - queue.length;
  const running = new Set<Promise<void>>();
  let inFlight = 0;
  let stoppedAt: string | null = null;
  const settle = (job: Job, r: Awaited<ReturnType<typeof attemptOnce>>) => {
    const attempts = [...job.before, r.attempt];
    const usd = attempts.reduce((s, x) => s + x.usd, 0);
    if (r.outcome.state === "cap") {
      stoppedAt ??= "the proxy stopped a session at the cap";
      stopped.push({ cell: job.cell, how: "stopped", usd });
      return;
    }
    if (retries(r.outcome, job.attempt)) {
      log(cellName(job.cell) + ": " + r.attempt.reason + " (" + r.attempt.detail + "); its one retry runs under that reason");
      queue.unshift({ cell: job.cell, attempt: job.attempt + 1, before: attempts });
      return;
    }
    const end = endStateOf(r.outcome)!;
    if (end.arm_stop) log("E_ER_ARM_STOP " + cellName(job.cell) + ": " + attempts.map((x) => x.reason + " (" + x.detail + ")").join(", then ") + "; the session scores 0 as no-block");
    if (end.end === "missing") log("E_ER_INFRA_MISSING " + cellName(job.cell) + ": " + attempts.map((x) => x.reason + " (" + x.detail + ")").join(", then ") + "; the session is missing, never 0");
    const web = r.outcome.state === "contaminated" ? r.outcome.web.length : 0;
    if (end.end === "contaminated") log("E_ER_WEB_CONTAMINATED " + cellName(job.cell) + ": " + web + " successful web result" + (web === 1 ? "" : "s") + "; the session is excluded as missing");
    const skillArm = isSkillArm(job.cell.arm);
    const entry: ErEntry = { cell: job.cell, key: keyOf(job.cell), prompt_sha256: sha256(promptOf(job.cell)), opening_sha256: job.cell.arm === "engphase" ? units.get(job.cell.unit)!.opening?.sha256 ?? null : null, parser_sha256: ER_PARSER_SHA256, attempts, end_state: end.end, arm_stop: end.arm_stop, parse: r.parse, web, usd, wall_s: r.wall, enforced: o.enforce === job.cell.arm, blocks: r.blocks, decisions: skillArm ? erDecisions(job.cell.arm as ErSkillArm, sessionEvidence(r.attempt.dir)) : null };
    entries.push(entry);
    appendFileSync(erJournal(o.out), JSON.stringify(entry) + "\n");
  };
  while (queue.length && stoppedAt === null) {
    if (inFlight < o.parallel && erAdmits(settled, inFlight, ER_ALLOWANCE_MICROS, o.cap)) {
      const job = queue.shift()!;
      inFlight++;
      const p: Promise<void> = attemptOnce(job.cell, job.attempt).then((r) => {
        settled += r.micros;
        settle(job, r);
      }).finally(() => {
        inFlight--;
        running.delete(p);
      });
      running.add(p);
      continue;
    }
    if (inFlight === 0) {
      stoppedAt = "the next attempt (" + cellName(queue[0]!.cell) + " a" + queue[0]!.attempt + ") does not fit: $" + (settled / 1e6).toFixed(2) + " settled plus its $" + (ER_ALLOWANCE_MICROS / 1e6).toFixed(2) + " allowance passes the $" + (o.cap / 1e6).toFixed(2) + " cap";
      break;
    }
    await Promise.race(running);
  }
  await Promise.all(running);
  if (stoppedAt !== null) {
    for (const job of queue) stopped.push({ cell: job.cell, how: job.before.length ? "stopped" : "unstarted", usd: job.before.reduce((s, x) => s + x.usd, 0) });
    stops.push({ code: "CAP_STOP", message: stoppedAt });
  }
  writeFileSync(erStopsFile(o.out), JSON.stringify({ stopped }, null, 2) + "\n");
  for (const s of stops) log(s.code + " " + s.message);
  return { entries, stopped, stops, spent_usd: settled / 1_000_000, carried_usd, held };
}

/** Exposure from a session's last attempt, for rows: only a skill session that ended block or no-block has one. */
export function entryExposure(e: Pick<ErEntry, "cell" | "end_state" | "attempts">): { exposed: boolean; loaded: boolean } | null {
  if (!isSkillArm(e.cell.arm) || (e.end_state !== "block" && e.end_state !== "no-block")) return null;
  const x = erExposure(e.cell.arm, sessionEvidence(e.attempts.at(-1)!.dir));
  return { exposed: x.exposed, loaded: x.loaded };
}
