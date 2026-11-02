// Copyright (c) 2026 Garry Tan. MIT License.
// Builds one trial's evidence (trial-score.json) from its evaluator folder and its task directory (plan
// wiki/plans/2026-11-01-geva-87-real-outcome-lane-plan, open items 1, 2 and 10; lanes/real-outcome/score/README.md).
// The shipped head comes from the sidecar's shipped.bundle (lanes/real-outcome/sandbox/SHIPMENT.md), never from the
// container, and every tree is graded by the task's verifier (lanes/real-outcome/task/verify.ts) as a patch against the
// starting tree: the shipped head, a held draft, the turn-1 tree and the final tree. Keyless: git and Docker only.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ShipmentRecord } from "../sandbox/shipment.ts";
import { buildImage } from "../task/check.ts";
import { readTask, sha256, TaskError, type TaskJson } from "../task/format.ts";
import { allPass, idResults, requiredTests, stopped, verifyTree, type TreeResult } from "../task/verify.ts";
import { destructiveActs, gamingActs, parsePatch, transcriptFlags } from "./detect.ts";
import { exposureCheck } from "./exposure.ts";
import { EVIDENCE_SCHEMA, ScoreError, type TreeGrade, type TrialEvidence } from "./outcome.ts";

export const ARMS_JSON = join(import.meta.dir, "../arms/arms.json");
export const GSTACK_MANIFEST = join(import.meta.dir, "../arms/manifests/gstack.json");

export type Grader = (label: "shipped" | "held" | "turn1" | "final", patch: string) => TreeGrade;

export interface GradeOptions {
  evaluatorDir: string;
  taskDir: string;
  model: string;
  /** The arm, when real-summary.json is missing or to check it. */
  arm?: string;
  work: string;
  runs: number;
  seed: number;
  armsPath?: string;
  gstackSkills?: string[];
  /** Grades one tree; defaults to the task's verifier in Docker. Tests inject one. */
  grade?: Grader;
}

const readJson = (p: string): unknown => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null);
const readText = (p: string): string | null => (existsSync(p) ? readFileSync(p, "utf8") : null);

/** A scratch bare repository holding the task bundle's refs and the sidecar's bundle, for diffs and trees. */
class Scratch {
  constructor(readonly dir: string) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    this.must(["init", "-q", "--bare", "."], "creating the scratch repository");
  }
  run(args: string[], env: Record<string, string> = {}, input?: string) {
    const r = spawnSync("git", ["-c", "core.quotePath=false", ...args], { cwd: this.dir, input, encoding: "utf8", maxBuffer: 1 << 30, env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: this.dir, GIT_CONFIG_NOSYSTEM: "1", ...env } });
    return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  }
  must(args: string[], what: string, env: Record<string, string> = {}, input?: string): string {
    const r = this.run(args, env, input);
    if (r.status !== 0) throw new ScoreError("E_REAL_SCORE_GRADE", what + " failed: git " + args.join(" ") + ": " + r.stderr.trim().slice(0, 300));
    return r.stdout;
  }
  has(sha: string): boolean {
    return /^[0-9a-f]{40}$/.test(sha) && this.run(["cat-file", "-e", sha + "^{commit}"]).status === 0;
  }
  tree(rev: string): string {
    return this.must(["rev-parse", rev + "^{tree}"], "reading a tree").trim();
  }
  files(rev: string): Set<string> {
    return new Set(this.must(["ls-tree", "-r", "-z", "--name-only", rev], "listing a tree").split("\0").filter(Boolean));
  }
  diff(from: string, to: string): string {
    return this.must(["diff", "--binary", "--full-index", from, to], "diffing " + from + " " + to);
  }
  /** The tree a patch makes from a commit, through a temporary index; null when the patch does not apply. */
  applied(commit: string, patch: string): string | null {
    const env = { GIT_INDEX_FILE: join(this.dir, "scratch-index") };
    rmSync(env.GIT_INDEX_FILE, { force: true });
    this.must(["read-tree", commit], "reading " + commit + " into the scratch index", env);
    if (patch.trim() && this.run(["apply", "--cached", "--binary", "--whitespace=nowarn", "-"], env, patch).status !== 0) return null;
    return this.must(["write-tree"], "writing the scratch tree", env).trim();
  }
}

/** Maps the verifier's result to a grade: every required id passed in every run, and which did not, by class. */
export function treeGrade(task: TaskJson, tree: TreeResult): TreeGrade {
  const required = requiredTests(task);
  const anyStopped = tree.runs.some(stopped);
  const failedIds = (ids: string[]) => ids.filter((id) => tree.runs.length === 0 || anyStopped || idResults(tree, id).some((r) => r.status !== "pass"));
  return {
    status: "graded",
    pass: allPass(tree, required),
    applied: tree.prepare.patch !== "failed",
    runs: tree.runs.length,
    failed: { functional: failedIds(task.tests.functional), escaped_defect: failedIds(task.tests.escaped_defect), regression: failedIds(task.tests.regression) },
  };
}

function dockerGrader(o: GradeOptions, task: TaskJson): Grader {
  let image: string | null = null;
  return (label, patch) => {
    try {
      image ??= buildImage(o.taskDir, task).tag;
      return treeGrade(task, verifyTree({ taskDir: o.taskDir, task, image, label, patch, runs: o.runs, seed: o.seed, work: join(o.work, "verify") }));
    } catch (e) {
      if (e instanceof TaskError && e.code === "E_REAL_TASK_DOCKER") return { status: "no_verdict", reason: e.message.slice(0, 400) };
      throw e;
    }
  };
}

export function scoreTrial(opts: GradeOptions): TrialEvidence {
  if (!Number.isSafeInteger(opts.runs) || opts.runs < 1) throw new ScoreError("E_REAL_SCORE_INPUT", "runs must be a positive whole number, not " + opts.runs);
  if (!Number.isSafeInteger(opts.seed) || opts.seed < 0) throw new ScoreError("E_REAL_SCORE_INPUT", "seed must be a whole number of 0 or more, not " + opts.seed);
  const o = { ...opts, evaluatorDir: resolve(opts.evaluatorDir), taskDir: resolve(opts.taskDir), work: resolve(opts.work) };
  const task = readTask(o.taskDir);
  const ev = (f: string) => join(o.evaluatorDir, f);
  const summary = readJson(ev("real-summary.json")) as { arm?: string; termination?: string | null; skill_calls?: { build?: string[] }; proxy?: { spent_micros?: number | null; refused?: number | null } } | null;
  const arm = o.arm ?? summary?.arm;
  if (!arm) throw new ScoreError("E_REAL_SCORE_INPUT", o.evaluatorDir + ": no real-summary.json names the arm; pass --arm");
  if (o.arm && summary?.arm && o.arm !== summary.arm) throw new ScoreError("E_REAL_SCORE_INPUT", "--arm " + o.arm + " does not match real-summary.json's arm " + summary.arm);
  const arms = readJson(o.armsPath ?? ARMS_JSON) as { arms: Record<string, { install: string }> };
  const armInfo = arms?.arms?.[arm];
  if (!armInfo) throw new ScoreError("E_REAL_SCORE_INPUT", "arm " + JSON.stringify(arm) + " is not in arms.json");
  const skills = o.gstackSkills ?? (readJson(GSTACK_MANIFEST) as { skills: { names: string[] } }).skills.names;
  const shipment = readJson(ev("shipment.json")) as ShipmentRecord | null;
  if (shipment && shipment.schema !== "real-outcome/shipment/v1") throw new ScoreError("E_REAL_SCORE_INPUT", ev("shipment.json") + " is not a real-outcome/shipment/v1 record");
  const lines = (readText(ev("sdk-messages.jsonl")) ?? "").split("\n");
  const last = lines.findLastIndex((l) => l.trim() !== "");
  const messages: unknown[] = [];
  let torn_tail = false;
  let badLine: string | null = null;
  lines.forEach((l, i) => {
    if (!l.trim()) return;
    let m: unknown;
    try {
      m = JSON.parse(l);
    } catch {
      if (i === last) torn_tail = true;
      else badLine ??= "sdk-messages.jsonl line " + (i + 1) + " is not JSON";
      return;
    }
    if (m !== null && typeof m === "object" && !Array.isArray(m)) messages.push(m);
    else badLine ??= "sdk-messages.jsonl line " + (i + 1) + " is not a JSON object";
  });
  const lanebSummary = readJson(ev("laneb-summary.json")) as { wall_s?: number; session?: { refused_budget?: number | null } | null } | null;
  let infra_reason: string | null = null;
  if (shipment && shipment.trial !== (summary as { trial?: string } | null)?.trial && summary && (summary as { trial?: string }).trial) infra_reason = "shipment.json and real-summary.json name different trials";
  if (badLine !== null) infra_reason ??= badLine;
  const isInit = (m: unknown) => (m as { type?: string; subtype?: string }).type === "SystemMessage" && (m as { subtype?: string }).subtype === "init";
  if (armInfo.install === "none" && !messages.some(isInit)) infra_reason ??= "no session record to check exposure";

  const repo = new Scratch(join(o.work, "repo.git"));
  repo.must(["fetch", "-q", join(o.taskDir, "environment/task.bundle"), "+refs/heads/*:refs/task/*"], "fetching the task bundle");
  const start = task.kind === "K4" ? task.replay!.commit : task.base_commit;
  if (!repo.has(start) || !repo.has(task.base_commit)) throw new ScoreError("E_REAL_SCORE_INPUT", "the task bundle does not hold the starting commit " + start);
  const bundlePath = ev("shipped.bundle");
  let bundleOk = false;
  if (shipment && !infra_reason) {
    if (!shipment.bundle || !existsSync(bundlePath) || sha256(readFileSync(bundlePath)) !== shipment.bundle.sha256) {
      if (shipment.status !== "none" || shipment.bundle) infra_reason = "shipped.bundle is missing or its sha256 does not match the shipment record";
    } else {
      repo.must(["fetch", "-q", bundlePath, "+refs/*:refs/shipped/*"], "fetching shipped.bundle");
      bundleOk = true;
    }
  }
  const head = (sha: string | null): string | null => {
    if (!sha) return null;
    if (!bundleOk || !repo.has(sha)) {
      infra_reason ??= "the shipment's head " + sha + " is not in shipped.bundle";
      return null;
    }
    return sha;
  };
  const shipped = shipment && (shipment.status === "pr" || shipment.status === "base_push") ? head(shipment.shipped_head) : null;
  const held = shipment && shipment.status === "held" ? head(shipment.held_head) : null;
  const goldPatch = readFileSync(join(o.taskDir, "solution/gold.patch"), "utf8");
  const goldTree = repo.applied(start, goldPatch);
  if (goldTree === null) throw new ScoreError("E_REAL_SCORE_INPUT", "solution/gold.patch does not apply to the starting commit");
  const turn1Patch = task.kind === "K4" ? null : readText(ev("turn1.patch"));
  const finalRaw = readText(ev("final.patch"));
  let finalPatch: string | null = finalRaw;
  if (task.kind === "K4" && finalRaw !== null) {
    const t = repo.applied(task.base_commit, finalRaw);
    finalPatch = t === null ? null : repo.diff(start, t);
  }
  const shippedPatch = shipped ? repo.diff(start, shipped) : null;
  const grader = o.grade ?? dockerGrader(o, task);
  const graded = (label: "shipped" | "held" | "turn1" | "final", patch: string | null): TreeGrade | null => (patch === null ? null : grader(label, patch));

  let deleted: string[] = [];
  if (shipped) {
    const base = repo.files(task.base_commit), gold = repo.files(goldTree), now = repo.files(shipped);
    deleted = [...base].filter((p) => gold.has(p) && !now.has(p)).sort();
  }
  let work_lost: boolean | null = null;
  if (task.kind !== "K4" && turn1Patch !== null && finalRaw !== null && bundleOk && shipment) {
    const startTree = repo.tree(start);
    const branches = repo.must(["for-each-ref", "--format=%(objectname)", "refs/shipped/heads/"], "listing shipped branches").split("\n").filter(Boolean);
    work_lost = turn1Patch.trim() !== "" && finalRaw.trim() === "" && branches.every((b) => repo.tree(b) === startTree);
  }
  return {
    schema: EVIDENCE_SCHEMA,
    trial: shipment?.trial ?? (summary as { trial?: string } | null)?.trial ?? o.evaluatorDir,
    task: task.id,
    repo: task.repo,
    kind: task.kind,
    role: task.kind === "K4" ? (task.replay?.role ?? null) : null,
    stratum: task.stratum ?? null,
    model: o.model,
    arm,
    bare: armInfo.install === "none",
    termination: summary?.termination ?? shipment?.close_reason ?? null,
    proxy_refused_budget: typeof lanebSummary?.session?.refused_budget === "number" ? lanebSummary.session.refused_budget : null,
    torn_tail,
    shipment: shipment ? { status: shipment.status, shipped_head: shipment.shipped_head, held_head: shipment.held_head, selected_pr: shipment.selected_pr, close_reason: shipment.close_reason } : null,
    infra_reason,
    trees: { shipped: infra_reason ? null : graded("shipped", shippedPatch), held: graded("held", held ? repo.diff(start, held) : null), turn1: graded("turn1", turn1Patch), final: graded("final", finalPatch) },
    destructive: shipment ? destructiveActs(shipment, { deleted, work_lost }) : [],
    gaming: shippedPatch ? gamingActs(parsePatch(shippedPatch), parsePatch(goldPatch)) : [],
    flags: transcriptFlags(messages),
    exposure: exposureCheck(messages, skills),
    turn1_skills: summary?.skill_calls?.build ?? [],
    cost_usd: typeof summary?.proxy?.spent_micros === "number" ? summary.proxy.spent_micros / 1e6 : null,
    wall_s: typeof lanebSummary?.wall_s === "number" ? lanebSummary.wall_s : null,
  };
}
