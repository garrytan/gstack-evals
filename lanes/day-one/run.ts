// Copyright (c) 2026 Garry Tan. MIT License.
// The day-one eval's stage runner (prereg sections 4 to 7), beside the office-hours founder lane's runSchedule and
// following its rules:
// - Stages: base (n writes the base plan), review (the review arms on that base plan), build (one Opus build per arm's
//   plan) and check (the checklist run on each build). Each launch runs one stage on one ledger item, under its own
//   rig, and writes <out>/<stage>/manifest.json before the rig opens; a launch whose manifest differs is refused.
// - A cell is one unit, replicate and arm. It takes at most two attempts: a retryable outcome (sessions.ts) on the first
//   attempt runs once more in a fresh container, and on the second it is a gap. Contaminated cells are reported, never
//   scored. A halt (a containment departure, rejected credentials) writes its row and stops the launch for the Captain.
// - A round of up to --parallel cells starts only when its worst case fits what the launch may still spend: twice each
//   session's allowance on the item (twice the voice's on a gstack arm) and twice the responder's on the responder
//   item. A round that does not fit is an admission stop (E_DAYONE_ADMISSION): nothing in it ran, stops.json lists the
//   cells left unrun, and a relaunch of the same stage with a smaller --parallel resumes it. A ledger cap stop inside a
//   session is a cap stop: the launch ends incomplete, nothing is retried, and a later launch on that dir is refused.
// - Plans and builds live in shared folders (<out>/plans, <out>/builds), so a cell whose plan or build is already there
//   from another launch is not run again; it is logged and left for that launch's rows.
// - With the owner channel dropped (a failed fidelity bar), no arm gets the owner notice, questions end the session,
//   and only /autoplan's waiting gate gets the fixed reply (owner.ts). The stage's manifest records the channel.
// - Every attempt writes attempt.json before it starts; a later launch that finds a marker with no row counts that
//   attempt as an infrastructure failure with the ledger's spend for its meters.
// - Plans: n with no plan is an arm stop that gets the one retry; on a review arm, or on the retry, the plan is empty
//   (E_DAYONE_NO_PLAN) and its build is scored as doing nothing. Checks: an app that never answers gets one more
//   attempt in a fresh browser container, and then scores no task done; an unparsable verdict gets one more attempt,
//   and then the build is unscored (E_DAYONE_VERDICT).
import { createHash } from "node:crypto";
import { appendFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ReasonCode } from "../../src/errors/codes.ts";
import { openLocalLedger } from "../../src/runner/ledger/local.ts";
import type { HostRig } from "../../src/skill-eval/cli/run-host.ts";
import type { LoadedPolicy } from "../../src/skill-eval/cli/policy.ts";
import { STATE_ROOT_DIR } from "../../src/trial/state-root.ts";
import type { CallRequest, CallResult } from "../product-value/meter.ts";
import { pool } from "../product-value/meter.ts";
import { meterSlot } from "../office-hours-founder/run/run.ts";
import type { Meter } from "../product-value/meter.ts";
import { startApp, stopApp, type AppRun, type AppWrite } from "./app.ts";
import { armPlan, loadedSkills, readExposure, type Exposure, type SkillLoad } from "./exposure.ts";
import { armPrompt, BUILD_PROMPT, GSTACK_ARMS, LIMITS, MODELS, type PlanArm } from "./frozen.ts";
import { ownerLoop, ownerPrompt, sourceCounts, type OwnerTurn } from "./owner.ts";
import { attemptOutcome, endLoop, launchSession, micros, settle, type AttemptRead, type LaunchInput, type Outcome } from "./sessions.ts";
import { buildSeed, copySamples, planSeed, type Unit } from "./units.ts";
import { checkPrompt, parseVerdicts, scoreBuild, type BuildScore, type VerdictParse } from "./verdict.ts";

export type Stage = "base" | "review" | "build" | "check";
export interface Cell {
  stage: Stage;
  unit: string;
  rep: number;
  arm: PlanArm;
}
export const cellId = (c: Cell): string => c.stage + "/" + c.unit + "/r" + c.rep + "/" + c.arm;

export interface Row {
  id: string;
  cell: Cell;
  state: "scored" | "contaminated" | "missing" | "halt";
  code: ReasonCode | null;
  why: string;
  attempts: { attempt: number; outcome: string; why: string; usd: number; voice_usd: number; owner_usd: number }[];
  usd: number;
  owner_usd: number;
  voice_usd: number;
  owner: { turns: OwnerTurn[]; counts: ReturnType<typeof sourceCounts> } | null;
  plan: { sha256: string; words: number; from: string } | null;
  exposure: Exposure | null;
  skills: SkillLoad[];
  check: { started: boolean; start_s: number | null; parse: VerdictParse | null; score: BuildScore; app_writes: AppWrite[] } | null;
  transcript: string | null;
}

export interface StageInput {
  stage: Stage;
  /** Names the stage's dir (<out>/<stage>-<tag>), so the strengthened arms run as their own launch on their own item. */
  tag: string;
  units: Unit[];
  reps: number[];
  arms: PlanArm[];
  /** The eval's out dir; each stage writes under <out>/<stage>, and reads plans and builds from <out>/plans and <out>/builds. */
  out: string;
  runId: string;
  /** Micro-dollars this launch may spend on its item, and on the responder item (planning stages). */
  cap: number;
  ownerCap: number;
  /** Micro-dollars the gstack arms' Astra voice slots may spend in this launch, inside cap (C2's own capped line). */
  voiceCap: number;
  parallel: number;
  /** False when the fidelity bar dropped the owner channel. */
  ownerChannel: boolean;
  policy: LoadedPolicy;
  ledger: string | null;
  docker: string;
  /** Scratch for browser containers' copies of builds. */
  scratch: string;
  /** The node volume (build and check stages). */
  nodeVolume: string | null;
  log: (line: string) => void;
}

export interface StageDeps {
  openRig: () => HostRig | Promise<HostRig>;
  /** The responder's meter (planning stages). */
  ownerMeter?: Meter;
  launch?: (o: LaunchInput) => Promise<AttemptRead>;
  app?: { start: typeof startApp; stop: typeof stopApp };
}

export interface StageResult {
  manifest_sha256: string;
  rows: Row[];
  stops: { code: ReasonCode; message: string }[];
  unrun: { id: string; how: "stopped" | "unstarted" }[];
  spent_micros: number;
  owner_micros: number;
  voice_micros: number;
  closed: { committed: number; unknown: number; lease_id: string | null } | null;
}

const D = 1_000_000;
const usd = (m: number) => "$" + (m / D).toFixed(2);
const sha = (t: string) => createHash("sha256").update(t).digest("hex");
const isGstack = (arm: PlanArm) => GSTACK_ARMS.includes(arm);

export const planFile = (out: string, unit: string, rep: number, arm: PlanArm) => join(out, "plans", unit, "r" + rep, arm + ".md");
export const buildDir = (out: string, unit: string, rep: number, arm: PlanArm) => join(out, "builds", unit, "r" + rep, arm);

/** The session limits and model of a cell. */
export function cellLimits(c: Cell): { minutes: number; turns: number; usd: number; voice_usd: number; owner_usd: number; model: string } {
  if (c.stage === "build") return { ...LIMITS.build, voice_usd: 0, owner_usd: 0, model: MODELS.builder };
  if (c.stage === "check") return { ...LIMITS.check, voice_usd: 0, owner_usd: 0, model: MODELS.checker };
  if (isGstack(c.arm)) return { ...LIMITS.gstack, owner_usd: LIMITS.owner.usd, model: MODELS.planner };
  return { ...(c.arm === "n" ? LIMITS.n : LIMITS.d), voice_usd: 0, owner_usd: LIMITS.owner.usd, model: MODELS.planner };
}

/** The stage's cells, in run order: by replicate, then unit, then arm. */
export function stageCells(stage: Stage, units: readonly Unit[], reps: readonly number[], arms: readonly PlanArm[]): Cell[] {
  const pick = stage === "base" ? ["n" as PlanArm] : stage === "review" ? arms.filter((a) => a !== "n") : arms;
  const us = stage === "build" || stage === "check" ? units.filter((u) => u.category === 2) : units;
  return reps.flatMap((rep) => us.flatMap((u) => pick.map((arm) => ({ stage, unit: u.id, rep, arm }))));
}

/** A cell's missing input, or null: a review needs its base plan, a build its arm's plan row, a check its build. */
export function inputProblem(out: string, c: Cell): string | null {
  if (c.stage === "review" && !existsSync(planFile(out, c.unit, c.rep, "n"))) return "no base plan for " + c.unit + " r" + c.rep;
  if (c.stage === "build" && !existsSync(planFile(out, c.unit, c.rep, c.arm))) return "no " + c.arm + " plan for " + c.unit + " r" + c.rep;
  if (c.stage === "build" && !readFileSync(planFile(out, c.unit, c.rep, c.arm), "utf8").trim()) return "the " + c.arm + " plan for " + c.unit + " r" + c.rep + " is empty (E_DAYONE_NO_PLAN), so it scores no task done and runs no build";
  if (c.stage === "check" && !existsSync(join(buildDir(out, c.unit, c.rep, c.arm), "tree"))) return "no build for " + c.unit + " r" + c.rep + " " + c.arm;
  return null;
}

/** The manifest, written once; a later launch whose manifest differs is refused. */
function freeze(path: string, body: unknown): { sha256: string } | { problem: string } {
  const text = JSON.stringify(body, null, 2) + "\n";
  if (existsSync(path)) {
    const have = readFileSync(path, "utf8");
    return have === text ? { sha256: sha(text) } : { problem: path + " holds another manifest; a stage's cells, units and caps are fixed at its first launch" };
  }
  writeFileSync(path, text);
  return { sha256: sha(text) };
}

function readRows(dir: string): Map<string, Row> {
  const rows = new Map<string, Row>();
  const f = join(dir, "rows.ndjson");
  if (!existsSync(f)) return rows;
  for (const l of readFileSync(f, "utf8").split("\n")) {
    if (!l.trim()) continue;
    try {
      const r = JSON.parse(l) as Row;
      rows.set(r.id, r);
    } catch {
      continue;
    }
  }
  return rows;
}

/** An attempt a crash left with a marker and no row: an infrastructure failure, charged what the ledger holds for each meter, the voice meter's on the voice. */
function reconcile(dir: string, ledger: string | null): AttemptRead {
  const meter = existsSync(join(dir, "meter.json")) ? (JSON.parse(readFileSync(join(dir, "meter.json"), "utf8")) as { meter_id: string; voice_meter_id: string | null; lease_id: string | null }) : null;
  let planner = 0;
  let voice = 0;
  if (meter?.lease_id && ledger && existsSync(ledger)) {
    const local = openLocalLedger({ path: ledger, rule: "the run's local ledger" });
    try {
      const ms = local.meters(meter.lease_id);
      planner = ms.get(meter.meter_id)?.held_micros ?? 0;
      voice = meter.voice_meter_id ? (ms.get(meter.voice_meter_id)?.held_micros ?? 0) : 0;
    } finally {
      local.close();
    }
  }
  writeFileSync(join(dir, "reconcile.json"), JSON.stringify({ meter, planner_micros: planner, voice_micros: voice }, null, 2) + "\n");
  return { termination: { kind: "infra", incident: "an attempt a crash left unfinished, reconciled" }, web: 0, gstack_reads: [], contained: [], micros: planner, voice: meter?.voice_meter_id ? { micros: voice, requests: 0, refused: 0 } : null, out: null };
}

/** Whether autoplan's run in the live work dir waits at its gate. */
function gatePending(work: string): boolean {
  const root = join(work, STATE_ROOT_DIR);
  if (!existsSync(root)) return false;
  try {
    const found = Bun.spawnSync(["find", root, "-name", "run.json", "-newer", join(work, "plan.md")]).stdout.toString().trim().split("\n").filter(Boolean);
    return found.some((f) => {
      try {
        return JSON.parse(readFileSync(f, "utf8"))?.status === "gate_pending";
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

/** Runs one stage round by round until its cells end or a stop. */
export async function runStage(o: StageInput, deps: StageDeps): Promise<StageResult> {
  const dir = join(o.out, o.stage + "-" + o.tag);
  mkdirSync(dir, { recursive: true });
  const cells = stageCells(o.stage, o.units, o.reps, o.arms);
  const byUnit = new Map(o.units.map((u) => [u.id, u]));
  const stopsFile = join(dir, "stops.json");
  const before = existsSync(stopsFile) ? (JSON.parse(readFileSync(stopsFile, "utf8")) as { stops: StageResult["stops"] }) : null;
  if (before?.stops.some((s) => s.code === "CAP_STOP")) throw new Error("E_USAGE " + dir + " ended in a cap stop, an incomplete run that is never resumed; its stops.json stands");
  const frozen = freeze(join(dir, "manifest.json"), { schema: "day-one.stage.v1", stage: o.stage, units: o.units.map((u) => u.id).sort(), reps: o.reps, arms: o.arms, cells: cells.map(cellId), cap_micros: o.cap, owner_cap_micros: o.ownerCap, voice_cap_micros: o.voiceCap, owner_channel: o.ownerChannel, limits: LIMITS, models: MODELS });
  if ("problem" in frozen) throw new Error("E_USAGE " + frozen.problem);
  const done = readRows(dir);
  const result: StageResult = { manifest_sha256: frozen.sha256, rows: [], stops: [], unrun: [], spent_micros: 0, owner_micros: 0, voice_micros: 0, closed: null };
  for (const r of done.values()) {
    result.spent_micros += Math.round((r.usd + r.voice_usd) * D);
    result.voice_micros += Math.round(r.voice_usd * D);
    result.owner_micros += Math.round(r.owner_usd * D);
  }
  const launch = deps.launch ?? launchSession;
  const app = deps.app ?? { start: startApp, stop: stopApp };
  const slotOf = deps.ownerMeter ? meterSlot(deps.ownerMeter) : null;
  const rig = await deps.openRig();
  if (rig.recovery) writeFileSync(join(dir, "rig.json"), JSON.stringify(rig.recovery, null, 2) + "\n");
  let halted = false;

  const runCell = async (c: Cell): Promise<void> => {
    const id = cellId(c);
    if (halted) return;
    const u = byUnit.get(c.unit)!;
    const lim = cellLimits(c);
    const base = c.stage === "review" ? readFileSync(planFile(o.out, c.unit, c.rep, "n"), "utf8") : null;
    const planning = c.stage === "base" || c.stage === "review";
    const records: Row["attempts"] = [];
    let end: Outcome | null = null;
    let owner: Row["owner"] = null;
    let plan: Row["plan"] = null;
    let exposure: Exposure | null = null;
    let skills: SkillLoad[] = [];
    let check: Row["check"] = null;
    let lastHost: string | null = null;
    let usdArm = 0;
    let usdVoice = 0;
    let usdOwner = 0;
    let planText: string | null = null;
    let partialTree: string | null = null;
    for (let attempt = 1; attempt <= 2 && !end; attempt++) {
      if (attempt > 1 && halted) {
        result.unrun.push({ id, how: "stopped" });
        return;
      }
      const sdir = join(dir, "sessions", c.unit, "r" + c.rep, c.arm, "a" + attempt);
      let read: AttemptRead;
      let loopFailed: ReturnType<typeof ownerLoop>["state"]["failed"] = null;
      let texts: string[] = [];
      let appRun: AppRun | null = null;
      if (existsSync(join(sdir, "attempt.json"))) {
        read = reconcile(sdir, o.ledger);
        o.log(id + ": attempt " + attempt + " has a marker and no row; reconciled it as an infrastructure failure");
      } else {
        mkdirSync(sdir, { recursive: true });
        writeFileSync(join(sdir, "attempt.json"), JSON.stringify({ id, attempt, started_at: new Date().toISOString() }) + "\n");
        let prompt: string;
        let seed: string | null = null;
        let nextUser: LaunchInput["nextUser"];
        let ownerState: ReturnType<typeof ownerLoop>["state"] | null = null;
        let slot: { call: (req: CallRequest) => Promise<CallResult>; spent: () => number } | null = null;
        if (planning) {
          prompt = armPrompt(c.arm, o.ownerChannel);
          seed = planSeed(u, join(sdir, "seed"), base);
          slot = slotOf && o.ownerChannel ? slotOf(id + "/a" + attempt, micros(lim.owner_usd)) : null;
          const loop = ownerLoop({
            dropped: !o.ownerChannel,
            ask: async (question) => {
              if (!slot) return { failed: "provider", detail: "no responder meter" };
              const r = await slot.call({ model: MODELS.owner, prompt: ownerPrompt(u.profile, question), maxTokens: 1024, effort: "low", label: id + "/owner" });
              if (r.text !== null) return { text: r.text };
              return { failed: r.status === 402 || /E_ALLOWANCE/.test(r.problem ?? "") ? "allowance" : "provider", detail: (r.problem ?? "status " + r.status).slice(0, 300) };
            },
            ...(isGstack(c.arm) ? { gatePending: () => gatePending(join(sdir, "work", "app")) } : {}),
          });
          ownerState = loop.state;
          nextUser = loop.nextUser;
        } else if (c.stage === "build") {
          prompt = BUILD_PROMPT;
          seed = buildSeed(readFileSync(planFile(o.out, c.unit, c.rep, c.arm), "utf8"), join(sdir, "seed"));
          const loop = endLoop();
          nextUser = loop.nextUser;
        } else {
          prompt = checkPrompt(u.list!);
          const samples = join(sdir, "samples");
          copySamples(u, samples);
          try {
            appRun = await app.start({ docker: o.docker, network: rig.network ?? "none", build: join(buildDir(o.out, c.unit, c.rep, c.arm), "tree"), samples, scratch: o.scratch, volume: o.nodeVolume ?? "", label: c.unit });
          } catch (e) {
            appRun = null;
            o.log(id + ": the browser container failed: " + (e as Error).message);
          }
          const loop = endLoop();
          nextUser = loop.nextUser;
          texts = loop.last;
          if (!appRun || !appRun.started) {
            const writes = appRun ? app.stop(appRun, o.docker, join(sdir, "browser")) : [];
            const infra = !appRun || /MCP server never answered|docker run failed/.test(appRun.detail);
            read = { termination: infra ? { kind: "infra", incident: "E_DAYONE_APP " + (appRun?.detail ?? "the browser container failed") } : { kind: "completed" }, web: 0, gstack_reads: [], contained: [], micros: 0, voice: null, out: null };
            records.push({ attempt, outcome: infra ? "retry" : "app-not-started", why: appRun?.detail ?? "no container", usd: 0, voice_usd: 0, owner_usd: 0 });
            if (!infra && attempt === 2) {
              check = { started: false, start_s: null, parse: null, score: scoreBuild(u.list!, false, null), app_writes: writes };
              end = { state: "ended", how: "completed" };
            }
            if (infra && attempt === 2) end = { state: "missing", code: "E_DAYONE_APP", why: appRun?.detail ?? "the browser container failed twice" };
            continue;
          }
          const ran = await launch({ rig, policy: o.policy, docker: o.docker, runId: o.runId, arm: "check", cell: c.unit + "-r" + c.rep + "-" + c.arm, rep: c.rep, attempt, model: lim.model, dir: sdir, seed: null, prompt, minutes: lim.minutes, turns: lim.turns, allowanceMicros: micros(lim.usd), nextUser, mcpUrl: appRun.mcpUrl });
          const writes = app.stop(appRun, o.docker, join(sdir, "browser"));
          read = ran;
          const outcome0 = settle(attemptOutcome(read, null), attempt);
          if (outcome0.state === "ended") {
            const parse = parseVerdicts(loop.last, u.list!.tasks.map((t) => t.id));
            if (parse.kind === "bad" && attempt === 1) {
              records.push({ attempt, outcome: "retry", why: "unparsable verdicts: " + parse.reason, usd: read.micros / D, voice_usd: 0, owner_usd: 0 });
              usdArm += read.micros / D;
              result.spent_micros += read.micros;
              continue;
            }
            check = { started: true, start_s: appRun.start_s, parse, score: scoreBuild(u.list!, true, parse.kind === "ok" ? parse : null), app_writes: writes };
            if (parse.kind === "bad") {
              records.push({ attempt, outcome: "missing", why: "unparsable verdicts: " + parse.reason, usd: read.micros / D, voice_usd: 0, owner_usd: 0 });
              usdArm += read.micros / D;
              result.spent_micros += read.micros;
              end = { state: "missing", code: "E_DAYONE_VERDICT", why: "unparsable verdicts on both attempts: " + parse.reason };
              lastHost = join(sdir, "host");
              continue;
            }
          }
          lastHost = join(sdir, "host");
          usdArm += read.micros / D;
          result.spent_micros += read.micros;
          records.push({ attempt, outcome: outcome0.state, why: "why" in outcome0 ? outcome0.why : outcome0.how, usd: read.micros / D, voice_usd: 0, owner_usd: 0 });
          if (outcome0.state === "cap") {
            halted = true;
            result.stops.push({ code: "CAP_STOP", message: id + ": " + outcome0.why });
            result.unrun.push({ id, how: "stopped" });
            return;
          }
          if (outcome0.state !== "retry") end = outcome0;
          continue;
        }
        read = await launch({ rig, policy: o.policy, docker: o.docker, runId: o.runId, arm: c.stage === "build" ? "build" : c.arm, cell: c.unit + "-r" + c.rep + "-" + c.stage + "-" + c.arm, rep: c.rep, attempt, model: lim.model, dir: sdir, seed, prompt, minutes: lim.minutes, turns: lim.turns, allowanceMicros: micros(lim.usd), nextUser, ...(c.stage === "build" && o.nodeVolume ? { nodeVolume: o.nodeVolume } : {}), ...(planning && isGstack(c.arm) ? { gstack: { skill: "autoplan", voiceModel: MODELS.voice, voiceMicros: micros(lim.voice_usd) } } : {}) });
        if (ownerState) {
          loopFailed = ownerState.failed;
          owner = { turns: ownerState.turns, counts: sourceCounts(ownerState.turns) };
        }
        if (slot) {
          usdOwner += slot.spent() / D;
          result.owner_micros += slot.spent();
        }
      }
      lastHost = join(sdir, "host");
      usdArm += read.micros / D;
      usdVoice += (read.voice?.micros ?? 0) / D;
      result.spent_micros += read.micros + (read.voice?.micros ?? 0);
      result.voice_micros += read.voice?.micros ?? 0;
      let outcome = settle(attemptOutcome(read, loopFailed), attempt);
      if (outcome.state === "ended" && planning && read.out) {
        const p = armPlan(read.out, base, isGstack(c.arm) ? join(sdir, "host", "gstack-state") : null);
        if (!p.text.trim() && c.arm === "n" && attempt === 1) outcome = { state: "retry", why: "no plan.md (an arm stop)" };
        else {
          plan = { sha256: sha(p.text), words: p.text.split(/\s+/).filter(Boolean).length, from: p.from };
          planText = p.text;
        }
        if (isGstack(c.arm)) exposure = readExposure(join(sdir, "host", "gstack-state"), read.voice?.requests ?? 0);
      }
      if (outcome.state === "ended" && c.stage === "build" && read.out) {
        partialTree = join(buildDir(o.out, c.unit, c.rep, c.arm), "tree.partial");
        rmSync(partialTree, { recursive: true, force: true });
        mkdirSync(partialTree, { recursive: true });
        cpSync(read.out, partialTree, { recursive: true, verbatimSymlinks: true, filter: (src) => !src.split("/").includes(".git") });
      }
      if (outcome.state === "ended" && !read.out) outcome = settle({ state: "retry", why: "the work tree was not copied out" }, attempt);
      records.push({ attempt, outcome: outcome.state, why: "why" in outcome ? outcome.why : outcome.how, usd: read.micros / D, voice_usd: (read.voice?.micros ?? 0) / D, owner_usd: usdOwner });
      if (outcome.state === "cap") {
        halted = true;
        result.stops.push({ code: "CAP_STOP", message: id + ": " + outcome.why });
        result.unrun.push({ id, how: "stopped" });
        return;
      }
      if (outcome.state !== "retry") end = outcome;
      else o.log(id + ": attempt " + attempt + ": " + outcome.why + "; its one retry runs");
    }
    if (planning && end?.state === "ended" && !plan) plan = { sha256: sha(""), words: 0, from: "none" };
    if (planning && plan && plan.words === 0) planText = "";
    const e = end!;
    const state: Row["state"] = e.state === "ended" ? "scored" : e.state === "contaminated" ? "contaminated" : e.state === "halt" ? "halt" : "missing";
    const code: ReasonCode | null = "code" in e ? e.code : planning && plan?.words === 0 ? "E_DAYONE_NO_PLAN" : null;
    const transcript = lastHost ? join(lastHost, "transcript.ndjson") : null;
    if (transcript && existsSync(transcript)) skills = loadedSkills(readFileSync(transcript, "utf8"));
    const row: Row = { id, cell: c, state, code, why: "why" in e ? e.why : "ended: " + e.how, attempts: records, usd: usdArm, owner_usd: usdOwner, voice_usd: usdVoice, owner, plan, exposure, skills, check, transcript };
    appendFileSync(join(dir, "rows.ndjson"), JSON.stringify(row) + "\n");
    if (planning && plan && planText !== null) {
      mkdirSync(join(o.out, "plans", c.unit, "r" + c.rep), { recursive: true });
      writeFileSync(planFile(o.out, c.unit, c.rep, c.arm), planText);
    }
    if (partialTree && e.state === "ended") renameSync(partialTree, join(buildDir(o.out, c.unit, c.rep, c.arm), "tree"));
    result.rows.push(row);
    o.log(id + ": " + state + (code ? " " + code : "") + " (" + row.why + "), " + usd(Math.round((usdArm + usdVoice) * D)) + (usdOwner ? ", responder " + usd(Math.round(usdOwner * D)) : ""));
    if (e.state === "halt") {
      halted = true;
      result.stops.push({ code: e.code, message: id + ": " + e.why + "; the launch stops for the Captain" });
    }
  };

  try {
    const todo = cells.filter((c) => !done.has(cellId(c)));
    const elsewhereRows = new Set(readdirSync(o.out).filter((d) => d.startsWith(o.stage + "-") && join(o.out, d) !== dir).flatMap((d) => [...readRows(join(o.out, d)).keys()]));
    for (let i = 0; i < todo.length && !halted; i += o.parallel) {
      const round = todo.slice(i, i + o.parallel).filter((c) => {
        const elsewhere = elsewhereRows.has(cellId(c)) ? "its row" : (c.stage === "base" || c.stage === "review") && existsSync(planFile(o.out, c.unit, c.rep, c.arm)) ? "its plan" : c.stage === "build" && existsSync(join(buildDir(o.out, c.unit, c.rep, c.arm), "tree")) ? "its build" : null;
        const p = elsewhere ? elsewhere + " is already in the shared folder from another launch, so it is not run again" : inputProblem(o.out, c);
        if (p) o.log(cellId(c) + ": not run, " + p);
        return !p;
      });
      if (!round.length) continue;
      const worst = round.reduce((s, c) => s + 2 * micros(cellLimits(c).usd + cellLimits(c).voice_usd), 0);
      const ownerWorst = o.ownerChannel ? round.reduce((s, c) => s + 2 * micros(cellLimits(c).owner_usd), 0) : 0;
      const voiceWorst = round.reduce((s, c) => s + 2 * micros(cellLimits(c).voice_usd), 0);
      if (result.spent_micros + worst > o.cap || result.owner_micros + ownerWorst > o.ownerCap || result.voice_micros + voiceWorst > o.voiceCap) {
        result.stops.push({ code: "E_DAYONE_ADMISSION", message: "the round from cell " + (i + 1) + " has a worst case of " + usd(worst) + " on the item (" + usd(voiceWorst) + " of it on the voice) and " + usd(ownerWorst) + " on the responder, more than this launch may still spend (" + usd(o.cap - result.spent_micros) + ", " + usd(o.voiceCap - result.voice_micros) + " and " + usd(o.ownerCap - result.owner_micros) + "); nothing in it ran. Fix: relaunch this stage with a smaller --parallel (ended cells stay ended); if a single cell does not fit, the line is short and goes to the Captain" });
        break;
      }
      await pool(o.parallel, round.map((c) => () => runCell(c)));
    }
    const ran = new Set([...done.keys(), ...result.rows.map((r) => r.id), ...result.unrun.map((u) => u.id)]);
    result.unrun.push(...cells.map(cellId).filter((id) => !ran.has(id)).map((id) => ({ id, how: "unstarted" as const })));
  } finally {
    result.closed = await rig.close();
    writeFileSync(stopsFile, JSON.stringify({ stops: result.stops, unrun: result.unrun }, null, 2) + "\n");
  }
  return result;
}
