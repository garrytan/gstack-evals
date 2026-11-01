// Review units as Lane A trials (plan 2026-10-30-geva-59-stacks-round-1-plan, sections 4 to 9; build step 2). Each
// review of one unit by one arm on one model in one pass is a trial (runTrial), so it inherits the session cache key,
// resume, receipts and the rig's admission. This is the run loop for those trials, not a new runner.
//
// - Task id <repo name>-<pr>-<first 8 of head>: the agent sees only /work/<id>, seeded with the unit tree.
// - The prompt is the frozen told prompt (told.ts) with the arm's command and the unit's base branch.
// - The arm's cell (src/arms/cells.ts) sets the slot's models (slotModels), the driver's Codex voice (codexOption), the
//   gstack config in the state root and the session key's arm tree (armTree). The driver gets the arm's plugins and
//   namespaces as runOnHost gives them.
// - Session key: the unit tree's digest is fixture_tree, the told template's sha256 rides in task, and the parser's source
//   sha256 is verifier. Finished sessions go to <out>/cells.ndjson with their key; --resume reuses a cell whose key still
//   matches and refuses a changed key with E_CACHE_STALE before any spend, unless repair reruns it.
// - A round is the next units with every arm, one pass and one model, as many as the parallelism holds. It starts only
//   when its worst case (each session at its allowance) fits under the cap, so a cap stop keeps paired cells (CAP_STOP).
// - After the run, each arm and model is written as an arm in contract v1 under <out>/arms/<arm id>/ with no
//   judgments.tsv, so it is raw and judge-packet can read it. <out>/units.json, parses.tsv and refusals.tsv sit beside.
// - Receipts never sit on a volatile path (E_RECEIPTS_VOLATILE); with GSTACK_EVALS_EPHEMERAL=1 they are copied to
//   GSTACK_EVALS_RECEIPTS before the run returns.
// - Plan units (input.plan; plan.ts) change the prompt, the parser, the user and the failed-pass rule, and refuse a cell
//   that keeps a voice, since a plan arm runs no second model.
// - A plan session scores by planScore. After the model produced output (the record's model_output, never its turns), a
//   malformed or missing block, a timeout, the arm's CLI failing, or a session that completed with no text turn is a miss
//   with a diagnostic note; arm.json counts the last kind as completed_without_text, since the parser reads text turns
//   only. Before any model output, a timeout, a CLI failure or a completed session is a coverage gap that stops the arm, as
//   is an infra failure (E_INFRA_FAILURE) or any other incomplete session at any point, so the arm gets no verdict.
//   progress.json counts each plan session the way arm.json scores it: findings as passed, a miss as failed, a gap as
//   missing.
// - A sealed suite refuses a receipts sink inside the repo (E_USAGE), as review-units refuses an in-repo --out.
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, posix, relative, resolve, sep } from "node:path";
import { insideRepo } from "../../../lanes/review-noloss/suite.ts";
import { hostDriver } from "../../adapters/host.ts";
import type { ReasonCode } from "../../errors/codes.ts";
import { allowanceMicros, SESSION_ALLOWANCE } from "../../skill-eval/cli/dry-run.ts";
import { providerOf, type LoadedPolicy } from "../../skill-eval/cli/policy.ts";
import { armNamespaces, armTree, codexOption, slotModels, type HostRig } from "../../skill-eval/cli/run-host.ts";
import type { ContractTask } from "../../skill-eval/contract/tasks.ts";
import type { Host, TrialRecord } from "../../types.ts";
import { cacheStale, envValuesHash, newProgress, recordSession, sessionKey, staleParts, writeProgress, type CacheStop, type SessionKey } from "../cache.ts";
import { copyToSink, receiptsSink, sinkOverlapProblem, volatilePathProblem } from "../durable.ts";
import type { Retained } from "../image.ts";
import { runTrial } from "../trial.ts";
import { costTsv, meterCost, readJournalLines, refusalsTsv, type CellRefusals, type CostSession, type MeterCost } from "./cost.ts";
import { PARSER_SHA256, parseFindings, renderFindings, type ParseOutcome } from "./findings.ts";
import { ceoMode, CEO_MODES, GLOBAL_PREFERENCES, gstackAutoProblem, gstackDir, gstackVersion, neverAskPreferences, PLAN_PARSER_SHA256, planArmLine, parsePlanSession, planPrompt, planSkill, REC_USER, REC_USER_SHA256, recFreeform, renderPlanFindings, TOLD_PLAN_SHA256, type CeoMode, type PlanArm, type PlanLens, type PlanParse } from "./plan.ts";
import { TOLD_PREFIX, TOLD_SHA256, toldPrompt, toldSkill, type ToldArm } from "./told.ts";
import type { UnitRef } from "./unit.ts";

type Env = Record<string, string | undefined>;

/** A unit ready to run: its tree built and checked, and what units.json records about it. */
export interface PreparedUnit {
  unit: UnitRef;
  /** unitTaskId(unit). */
  task: string;
  base_branch: string;
  merge_base: string;
  /** The unit tree, copied into each trial's work dir. */
  tree: string;
  tree_sha256: string;
  instructions: Record<string, string>;
  retained?: Retained | null;
  check?: { install: string; test: string; passed: boolean } | null;
}

export interface ReviewArm {
  name: string;
  /** A told arm for code units, a plan arm for plan units. */
  told: ToldArm | PlanArm;
}

export interface ReviewRunInput {
  host: Host;
  suite: { id: string; sha256: string | null; sealed?: boolean };
  units: PreparedUnit[];
  arms: ReviewArm[];
  models: string[];
  passes: number;
  parallel: number;
  timeoutS: number;
  /** Micro-dollars; null for no cap. */
  cap: number | null;
  /** Each session's allowance in micro-dollars; null takes SESSION_ALLOWANCE at the model's price. */
  allowanceMicros?: number | null;
  runId: string;
  out: string;
  /** The arms' date, YYYY-MM-DD. */
  date: string;
  policy: LoadedPolicy;
  /** The session key parts that do not vary by cell; verifier is the parser's sha256. */
  keyBase: { image_digest: string | null; recipe: string; host_version: string | null; adapter_sha256: string; isolation: string };
  /** The proxy journal that cost.tsv is read from; null leaves the cost columns unavailable. */
  journal: string | null;
  /** Journaled cells of the run being resumed (readReviewJournal). */
  reuse?: Map<string, ReviewEntry>;
  /** Rerun journaled cells whose key changed instead of refusing. */
  repair?: boolean;
  /** The preregistration's severity map per arm name, written to arm.json. */
  severityMap?: Readonly<Record<string, unknown>>;
  /**
   * Plan units (planning lane B2 to B4): the plan prompt and parser, the rec user, no second model, gstack's questions
   * set to auto-decide, and a failed pass scored as finding nothing with a diagnostic note instead of stopping the arm.
   */
  plan?: { lens: PlanLens };
  /** The models each named arm runs on; an arm not named runs on every model. */
  armModels?: Readonly<Record<string, readonly string[]>>;
  env?: Env;
}

export interface ReviewCell {
  model: string;
  arm: string;
  unit: string;
  pass: number;
}

export interface ReviewEntry {
  cell: ReviewCell;
  key: SessionKey;
  meter_id: string;
  record: TrialRecord;
  parse: ParseOutcome | PlanParse;
  cost: MeterCost | null;
  /** Plan units: the review mode the session's gstack mode handoff named, or null. */
  ceo_mode?: CeoMode | null;
}

export interface ReviewRun {
  spent: number;
  stopped: boolean;
  stops: { code: ReasonCode; message: string }[];
  /** Journaled cells whose key changed, refused before any spend. */
  stale: CacheStop[];
  /** Parse outcomes by arm id. */
  outcomes: Record<string, Record<string, number>>;
  armDirs: string[];
  /** Receipts copied to GSTACK_EVALS_RECEIPTS. */
  copied: string[];
}

export const reviewCellId = (c: ReviewCell): string => JSON.stringify([c.model, c.arm, c.unit, c.pass]);
const cellName = (c: ReviewCell): string => c.model + " " + c.arm + " " + c.unit + " pass " + c.pass;

export const ARM_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;
/** The model's short name in an arm id: a Claude model's family (opus, haiku), else the id's last path segment with other
 * characters as -. A tag past 24 characters keeps 17 and adds a hash of the id, so a 7-character arm name still fits ARM_ID. */
export const modelTag = (model: string): string => {
  const tag = (/^claude-([a-z]+)-/.exec(model)?.[1] ?? model.slice(model.lastIndexOf("/") + 1)).replace(/[^A-Za-z0-9_-]+/g, "-");
  return tag.length <= 24 ? tag : tag.slice(0, 17) + "-" + createHash("sha256").update(model).digest("hex").slice(0, 6);
};
/** <arm>-<model tag>, such as pstack-opus: the arm's id in contract v1 and its directory under <out>/arms. */
export const armId = (arm: string, model: string): string => arm + "-" + modelTag(model);
/** A unit id as a findings file name: / written __. */
export const unitFile = (unitId: string): string => unitId.replaceAll("/", "__");

/**
 * How a plan session scores: findings; a miss, scored as finding nothing with a diagnostic note (a malformed or missing
 * block, or, after model output, a timeout, the arm's CLI failing or a session that completed with no text turn); or a
 * coverage gap that stops the arm (a timeout, a CLI failure or a completed session before any model output, an infra
 * failure, or any other incomplete session).
 */
export function planScore(e: Pick<ReviewEntry, "record" | "parse">): "findings" | "miss" | "gap" {
  if (e.parse.kind === "findings") return "findings";
  if (e.parse.kind !== "incomplete") return "miss";
  const kind = e.record.termination.kind;
  return e.record.model_output === true && (kind === "timeout" || kind === "arm_failure" || kind === "completed") ? "miss" : "gap";
}

const PROGRESS = { findings: "pass", miss: "fail", gap: "missing" } as const;

/** The journal of finished review sessions in an out directory, by cell. */
export function readReviewJournal(out: string): Map<string, ReviewEntry> {
  const file = join(out, "cells.ndjson");
  const map = new Map<string, ReviewEntry>();
  if (!existsSync(file)) return map;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as ReviewEntry;
      map.set(reviewCellId(e.cell), e);
    } catch {
      continue;
    }
  }
  return map;
}

async function pool<T, R>(items: readonly T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  }));
  return out;
}

interface Planned {
  cell: ReviewCell;
  arm: ReviewArm;
  unit: PreparedUnit;
}

export async function runReviewUnits(o: ReviewRunInput, rig: HostRig, log: (line: string) => void = () => {}): Promise<ReviewRun> {
  const env = o.env ?? process.env;
  const stops: ReviewRun["stops"] = [];
  const stale: CacheStop[] = [];
  const outcomes: ReviewRun["outcomes"] = {};
  let spent = 0;
  const result = (armDirs: string[] = [], copied: string[] = []): ReviewRun => ({ spent, stopped: stops.some((s) => s.code === "CAP_STOP"), stops, stale, outcomes, armDirs, copied });
  const sink = receiptsSink(env);
  const volatile = volatilePathProblem(o.out) ?? ("problem" in sink ? sink.problem : null);
  if (volatile) {
    stops.push({ code: "E_RECEIPTS_VOLATILE", message: volatile });
    return result();
  }
  const overlap = "sink" in sink && sink.sink ? sinkOverlapProblem(o.out, sink.sink) : null;
  if (overlap) throw new Error("E_USAGE: " + overlap);
  if (o.suite.sealed && "sink" in sink && sink.sink && insideRepo(sink.sink)) throw new Error("E_USAGE: suite " + o.suite.id + " is sealed, and the receipts sink " + sink.sink + " (GSTACK_EVALS_RECEIPTS) is inside the repo; copy sealed receipts outside it");
  const plan = o.plan ?? null;
  const modelsOf = (arm: string): readonly string[] => o.armModels?.[arm] ?? o.models;
  const ids = new Set<string>();
  for (const arm of o.arms) for (const model of modelsOf(arm.name)) {
    const id = armId(arm.name, model);
    if (!ARM_ID.test(id)) throw new Error("E_USAGE: arm id " + JSON.stringify(id) + " (arm " + arm.name + ", model " + model + ") does not match " + ARM_ID + "; use a shorter arm name");
    if (ids.has(id)) throw new Error("E_USAGE: arm id " + JSON.stringify(id) + " names two arm and model pairs (arm " + arm.name + ", model " + model + "); rename an arm or drop one of the models");
    ids.add(id);
  }
  const allowance = (model: string): number => {
    const micros = o.allowanceMicros ?? allowanceMicros({ policy: o.policy }, model, SESSION_ALLOWANCE);
    if (micros === null) throw new Error("E_MODEL_POLICY: " + model + " has no price row, so its session allowance is unknown");
    return micros;
  };
  const prefs = new Map<string, string | null>();
  if (plan) for (const arm of o.arms) for (const model of modelsOf(arm.name)) {
    const voice = rig.cells?.[arm.name]?.[model]?.codex?.model;
    if (voice) throw new Error("E_USAGE: plan units run no second model, but arm " + arm.name + "'s cell on " + model + " keeps the voice " + voice + "; build the rig's cells without voices");
  }
  for (const arm of plan ? o.arms : []) {
    const install = rig.arms[arm.name]!;
    if (arm.told !== "gstack" && arm.told !== "gstack-auto") continue;
    const dir = gstackDir(install);
    if (arm.told === "gstack-auto") {
      const problem = gstackAutoProblem(gstackVersion(dir));
      if (problem) throw new Error("E_USAGE: arm " + arm.name + ": " + problem);
    }
    const text = neverAskPreferences(dir);
    if (text === null) throw new Error("E_USAGE: arm " + arm.name + "'s gstack tree has no question registry (scripts/question-registry.ts), so its questions cannot be set to auto-decide");
    prefs.set(arm.name, text);
  }
  const taskOf = (arm: ReviewArm, unit: PreparedUnit): ContractTask => ({ id: unit.task, prompt: plan ? planPrompt(arm.told as PlanArm, plan.lens) : toldPrompt(arm.told as ToldArm, unit.base_branch) });
  const planKey = (arm: ReviewArm) => (plan ? { plan: { lens: plan.lens, rec_user_sha256: REC_USER_SHA256, preferences_sha256: prefs.has(arm.name) ? createHash("sha256").update(prefs.get(arm.name)!).digest("hex") : null } } : {});
  const keyOf = (model: string, arm: ReviewArm, unit: PreparedUnit): SessionKey =>
    sessionKey({ ...o.keyBase, arm_tree: armTree(rig, arm.name, model), task: { ...taskOf(arm, unit), told_sha256: plan ? TOLD_PLAN_SHA256 : TOLD_SHA256, unit: unit.unit.id, head: unit.unit.head, merge_base: unit.merge_base, ...planKey(arm) }, sidecar_entry: null, fixture_tree: unit.tree_sha256, verifier: plan ? PLAN_PARSER_SHA256 : PARSER_SHA256, model, timeout_s: o.timeoutS, env_values: envValuesHash([], env), judge_model: null, policy: o.policy.sha256 });

  const groups: Planned[][] = [];
  for (let pass = 1; pass <= o.passes; pass++) for (const model of o.models) for (const unit of o.units) {
    const arms = o.arms.filter((arm) => modelsOf(arm.name).includes(model));
    if (arms.length) groups.push(arms.map((arm) => ({ cell: { model, arm: arm.name, unit: unit.unit.id, pass }, arm, unit })));
  }
  const planned = new Map(groups.flat().map((p) => [reviewCellId(p.cell), p]));
  const entries = new Map<string, ReviewEntry>();
  for (const [id, e] of o.reuse ?? []) {
    const p = planned.get(id);
    if (!p) continue;
    const changed = staleParts(e.key, keyOf(p.cell.model, p.arm, p.unit));
    if (!changed.length) entries.set(id, e);
    else if (!o.repair) stale.push(cacheStale(cellName(p.cell), changed));
  }
  if (stale.length) {
    for (const s of stale) stops.push({ code: s.code, message: s.message });
    return result();
  }
  const reused = new Set(entries.keys());

  mkdirSync(o.out, { recursive: true });
  const empty = join(o.out, "fixtures");
  mkdirSync(empty, { recursive: true });
  const journal = join(o.out, "cells.ndjson");
  let progress = newProgress(o.runId, planned.size - reused.size);
  let wall = 0;
  let ran = 0;

  const session = async (p: Planned): Promise<ReviewEntry> => {
    const { cell, arm, unit } = p;
    const provider = providerOf(o.policy, cell.model);
    if (!provider) throw new Error("E_MODEL_POLICY: " + cell.model + " has no provider in the policy");
    const settings = rig.cells?.[arm.name]?.[cell.model] ?? null;
    const codex = o.host === "claude" ? codexOption(o.policy, settings) : null;
    const binding = await rig.bind({ cell: { run_id: o.runId, arm: arm.name, task: unit.task, model: cell.model, trial: cell.pass, attempt: 1 }, models: slotModels(o.policy, cell.model, codex ? settings : null), allowance_micros: allowance(cell.model) });
    const sandbox = rig.sandbox(arm.name, false, cell.model);
    const dir = join(o.out, "runs", cell.model.replaceAll("/", "_"), arm.name, unit.task, "p" + cell.pass);
    rmSync(dir, { recursive: true, force: true });
    const home = sandbox.homePath(dir);
    const install = rig.arms[arm.name]!;
    const plugins = (install.plugins ?? []).map((pl) => posix.join(home, pl));
    const name = plan ? planSkill(arm.told as PlanArm, plan.lens) : toldSkill(arm.told as ToldArm);
    const skill = install.skill && name ? { name, roots: install.skill.roots.map((r) => posix.join(home, r)), home, dir: install.skill.dir, namespaces: armNamespaces(install) } : null;
    const agent = (rig.driver ?? hostDriver)({ host: o.host, model: cell.model, provider, proxy: { baseUrl: rig.baseUrl, slot: binding.slot, token: binding.token }, interactive: plan !== null, skill, out: join(dir, "host"), ...(plan ? { entry: { user: REC_USER }, freeform: recFreeform } : {}), ...(plugins.length ? { plugins } : {}), ...(codex ? { codex } : {}) });
    const config = settings && Object.keys(settings.gstack_config).length ? settings.gstack_config : null;
    const state = { ...(config ? { stateConfig: config } : {}), ...(prefs.has(arm.name) ? { stateFiles: { [GLOBAL_PREFERENCES]: prefs.get(arm.name)! } } : {}) };
    const trial = await runTrial({ cell: { model: cell.model, arm: arm.name, round: 1, trial: cell.pass }, task: taskOf(arm, unit), tasksDir: empty, sandbox, agent, dir, timeoutS: o.timeoutS, network: rig.network, seed: unit.tree, ...state });
    const meter = await rig.finalize(binding.meter_id);
    spent += meter.micros;
    trial.record.cost_micros = meter.micros;
    const parse = plan ? parsePlanSession(trial.record) : parseFindings(trial.record);
    const entry: ReviewEntry = { cell, key: keyOf(cell.model, arm, unit), meter_id: binding.meter_id, record: trial.record, parse, cost: o.journal ? meterCost(readJournalLines(o.journal), binding.meter_id, codex?.model ?? null) : null, ...(plan ? { ceo_mode: ceoMode(trial.record.turns) } : {}) };
    entries.set(reviewCellId(cell), entry);
    const kind = trial.record.termination.kind;
    wall += trial.record.wall_ms ?? 0;
    ran++;
    progress = recordSession(progress, cellName(cell), plan ? PROGRESS[planScore(entry)] : kind === "timeout" ? "timeout" : parse.kind === "findings" ? "pass" : parse.kind === "incomplete" ? "missing" : "fail", wall / 1000 / ran, o.parallel);
    writeProgress(o.out, progress);
    if (kind !== "cap_stop") appendFileSync(journal, JSON.stringify(entry) + "\n");
    return entry;
  };

  const per = Math.max(1, Math.floor(o.parallel / Math.max(1, o.arms.length)));
  for (let i = 0; i < groups.length; i += per) {
    const fresh = groups.slice(i, i + per).flat().filter((p) => !reused.has(reviewCellId(p.cell)));
    if (!fresh.length) continue;
    const worst = fresh.reduce((s, p) => s + allowance(p.cell.model), 0);
    if (o.cap !== null && spent + worst > o.cap) {
      stops.push({ code: "CAP_STOP", message: "the next round's worst case (" + fresh.length + " sessions at their allowance) does not fit under the cap" });
      break;
    }
    const done = await pool(fresh, o.parallel, session);
    if (done.some((e) => e.record.termination.kind === "cap_stop")) {
      stops.push({ code: "CAP_STOP", message: "the proxy stopped a session at the cap" });
      break;
    }
  }
  for (const s of stops) log(s.code + " " + s.message);

  const parseRows = [["arm_id", "arm", "model", "unit", "pass", "outcome", "findings", "reason"].join("\t")];
  const modeRows = [["arm_id", "arm", "model", "unit", "pass", "mode"].join("\t")];
  const label = (p: ParseOutcome | PlanParse) => (p.kind === "findings" ? (p.findings.length ? "findings" : "empty") : p.kind);
  const refusals: CellRefusals[] = [];
  const armDirs: string[] = [];
  rmSync(join(o.out, "arms"), { recursive: true, force: true });
  for (const arm of o.arms) for (const model of modelsOf(arm.name)) {
    const id = armId(arm.name, model);
    const dir = join(o.out, "arms", id);
    mkdirSync(join(dir, "findings"), { recursive: true });
    const counts: Record<string, number> = { findings: 0, empty: 0, missing: 0, malformed: 0, incomplete: 0, not_run: 0 };
    const gaps: string[] = [];
    const diagnostics: string[] = [];
    const modes: Record<string, number> = {};
    let withoutText = 0;
    const sessions: CostSession[] = [];
    const refused: CellRefusals = { arm_id: id, arm: arm.name, model, sessions: 0, requests: 0, refused: 0 };
    for (const unit of o.units) {
      const lines: string[] = [];
      for (let pass = 1; pass <= o.passes; pass++) {
        const e = entries.get(reviewCellId({ model, arm: arm.name, unit: unit.unit.id, pass }));
        if (!e) {
          counts.not_run!++;
          continue;
        }
        const outcome = label(e.parse);
        counts[outcome]!++;
        const note = unit.unit.id + " pass " + pass + ": " + outcome + ("reason" in e.parse ? ", " + e.parse.reason.replace(/\s+/g, " ") : "");
        const score = plan ? planScore(e) : outcome === "malformed" || outcome === "incomplete" ? "gap" : null;
        const ended = e.record.termination.kind;
        if (score === "miss" && e.parse.kind === "incomplete" && ended === "completed") withoutText++;
        if (score === "miss") diagnostics.push(note + "; scored as finding nothing");
        else if (score === "gap") gaps.push(note + (!plan ? "" : ended === "arm_failure" || ended === "timeout" ? " before any model output" : ended === "completed" ? " and no model output" : ""));
        parseRows.push([id, arm.name, model, unit.unit.id, String(pass), outcome, e.parse.kind === "findings" ? String(e.parse.findings.length) : "", "reason" in e.parse ? e.parse.reason.replace(/\s+/g, " ") : ""].join("\t"));
        if (plan) {
          modes[e.ceo_mode ?? "unstated"] = (modes[e.ceo_mode ?? "unstated"] ?? 0) + 1;
          modeRows.push([id, arm.name, model, unit.unit.id, String(pass), e.ceo_mode ?? "unstated"].join("\t"));
        }
        if (e.parse.kind === "findings") for (const f of plan ? renderPlanFindings((e.parse as Extract<PlanParse, { kind: "findings" }>).findings, pass) : renderFindings((e.parse as Extract<ParseOutcome, { kind: "findings" }>).findings, pass, "/work/" + unit.task)) lines.push(JSON.stringify(f));
        sessions.push({ pr: unit.unit.id, pass, wall_ms: e.record.wall_ms, cost: e.cost });
        refused.sessions++;
        refused.requests += e.cost?.all.requests ?? 0;
        refused.refused += e.cost?.refused ?? 0;
      }
      writeFileSync(join(dir, "findings", unitFile(unit.unit.id) + ".jsonl"), lines.map((l) => l + "\n").join(""));
    }
    refusals.push(refused);
    outcomes[id] = counts;
    writeFileSync(join(dir, "cost.tsv"), costTsv(sessions));
    const settings = rig.cells?.[arm.name]?.[model] ?? null;
    const voice = o.host === "claude" ? (codexOption(o.policy, settings)?.model ?? null) : null;
    const provenance = (rig.arms[arm.name] as { provenance?: Record<string, unknown> }).provenance ?? null;
    const source = provenance && typeof provenance.repo === "string" && typeof provenance.sha === "string" ? { repo: provenance.repo, sha: provenance.sha } : null;
    const armJson = {
      contract_version: 1, id, label: arm.name + " on " + model, suite: o.suite.id, ...(o.suite.sha256 ? { suite_sha256: o.suite.sha256 } : {}), date: o.date, passes: o.passes, provenance: "live",
      status: counts.not_run || stops.length || gaps.length ? "stopped" : "complete", ...(gaps.length ? { coverage_gaps: gaps } : {}), ...(diagnostics.length ? { diagnostics } : {}), ...(source ? { source } : {}),
      models: [{ role: "driver", model }, ...(voice ? [{ role: "voice", model: voice }] : [])], run_by: o.runId,
      ...(o.severityMap?.[arm.name] ? { severity_map: o.severityMap[arm.name] } : {}),
      told: plan ? { arm: arm.told, lens: plan.lens, line: planArmLine(arm.told as PlanArm, plan.lens), template_sha256: TOLD_PLAN_SHA256, rec_user_sha256: REC_USER_SHA256 } : { arm: arm.told, prefix: TOLD_PREFIX[arm.told as ToldArm], template_sha256: TOLD_SHA256 }, parser_sha256: plan ? PLAN_PARSER_SHA256 : PARSER_SHA256,
      ...(plan && prefs.has(arm.name) ? { question_preferences: "every registered question never-ask (auto-decide) in " + GLOBAL_PREFERENCES + ", written over any the unit ships", question_preferences_sha256: createHash("sha256").update(prefs.get(arm.name)!).digest("hex") } : {}), ...(plan ? { completed_without_text: withoutText, ceo_modes: Object.fromEntries([...CEO_MODES, "unstated"].filter((m) => modes[m]).map((m) => [m, modes[m]])) } : {}),
      arm_provenance: provenance, cell_tree_sha256: armTree(rig, arm.name, model), parse_outcomes: counts,
    };
    writeFileSync(join(dir, "arm.json"), JSON.stringify(armJson, null, 2) + "\n");
    armDirs.push(dir);
  }
  writeFileSync(join(o.out, "parses.tsv"), parseRows.join("\n") + "\n");
  if (plan) writeFileSync(join(o.out, "modes.tsv"), modeRows.join("\n") + "\n");
  writeFileSync(join(o.out, "refusals.tsv"), refusalsTsv(refusals));
  writeFileSync(join(o.out, "units.json"), JSON.stringify({ schema_version: 1, suite: o.suite, told_sha256: plan ? TOLD_PLAN_SHA256 : TOLD_SHA256, parser_sha256: plan ? PLAN_PARSER_SHA256 : PARSER_SHA256, units: o.units.map((u) => ({ id: u.unit.id, repo: u.unit.repo, pr: u.unit.pr, task: u.task, head: u.unit.head, base: u.unit.base, base_branch: u.base_branch, merge_base: u.merge_base, tree_sha256: u.tree_sha256, retained: u.retained ?? null, instructions: u.instructions, check: u.check ?? null })) }, null, 2) + "\n");

  const inside = (f: string) => !relative(resolve(o.out), resolve(f)).startsWith("..") && !relative(resolve(o.out), resolve(f)).startsWith(sep);
  const receipts = [journal, join(o.out, "progress.json"), join(o.out, "units.json"), join(o.out, "parses.tsv"), join(o.out, "refusals.tsv"), join(o.out, "arms"), ...(plan ? [join(o.out, "modes.tsv")] : []), ...(o.journal && inside(o.journal) ? [o.journal] : [])];
  const copied = "sink" in sink && sink.sink ? copyToSink(o.out, receipts, sink.sink) : [];
  return result(armDirs, copied);
}
