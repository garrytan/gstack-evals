// The lock is the preregistration (interface v0.4, "The lock is the preregistration"). tasks.lock.json, beside the
// tasks file, records the tasks file's and sidecar's sha256, the policy's sha256, the before copy's files, and its
// contract lines, each with the ids of the tasks that cover it. A paid run needs it committed and clean at HEAD.
//
// Coverage claims come from the author: --lock lists every contract line with the tasks the author named for it, and a
// relock keeps those claims for every line whose file and text are unchanged. Nothing claims a line automatically: a
// claimed line that a passing task reaches can clear UNCOVERED_GATE_REMOVAL, so a guessed claim would weaken the gate.
//
// A line counts as covered only when an old-arm run of a claiming task reached it: the run passed, it read the line's
// file, and, for an ask line, it asked a question of the line's category (any question when the line names none). A
// claimed line that no run reached is unreached, a line nobody claimed is unclaimed, and both count as uncovered. So a
// line a diet moved into an on-demand section that no task's run read shows up uncovered.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import type { SidecarFile } from "../contract/sidecar.ts";
import type { TasksFile } from "../contract/tasks.ts";
import { CLASSIFIER_SHA256, classifyText, type Category } from "../../usersim/classifier.ts";
import { contractLines, EXTRACTOR_SHA256, EXTRACTOR_VERSION, type LineCategory, type LineFate, type Load, type SkillFile, type UnitKind } from "./contract-lines.ts";

export const LOCK_FILE = "tasks.lock.json";

export const COVERAGE_RULE =
  "A line counts as covered only when an old-arm run of a task in its tasks list reached it: the run passed, read the line's file, and, for an ask line, asked a question of the line's category (any question when it is \"any\"). Claimed lines no run reached, and unclaimed lines, are uncovered.";

export interface LockLine {
  id: string;
  file: string;
  line: number;
  end_line: number;
  heading: string;
  kind: UnitKind;
  categories: LineCategory[];
  load: Load;
  /** For an ask line, the question category a run must ask to reach it, or "any"; null for other lines. */
  ask: Category | "any" | null;
  /** The normalized text, clipped to 200 characters. */
  text: string;
  /** sha256 of the whole normalized text; a relock carries claims by file and this digest. */
  text_sha256: string;
  /** The tasks the author says cover this line. */
  tasks: string[];
}

export interface Lock {
  schema_version: 1;
  /** Paths are relative to the lock's directory. */
  tasks: { file: string; sha256: string };
  ext: { file: string; sha256: string } | null;
  policy: { file: string; sha256: string } | null;
  skill: { name: string; tree_sha256: string; files: { path: string; sha256: string; load: Load }[] };
  extractor: { version: number; sha256: string };
  classifier_sha256: string;
  coverage_rule: string;
  lines: LockLine[];
}

const sha256 = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
const clip = (s: string) => (s.length > 200 ? s.slice(0, 199) + "…" : s);

export const treeSha256 = (files: readonly SkillFile[]) => sha256(files.map((f) => f.sha256 + "  " + f.path + "\n").join(""));

export interface LockInput {
  /** Where the lock goes; tasks and sidecar paths are recorded relative to its directory. */
  lockPath: string;
  tasks: TasksFile;
  ext: SidecarFile | null;
  policy: { path: string; sha256: string } | null;
  skillName: string;
  before: readonly SkillFile[];
  /** The lock being replaced, whose claims carry over. */
  previous: Lock | null;
}

export interface LockBuild {
  lock: Lock;
  /** Claims kept from the previous lock. */
  carried: number;
  /** Claims dropped because their task left the tasks file, as "<line id> <task>". */
  dropped: string[];
}

export function buildLock(input: LockInput): LockBuild {
  const dir = dirname(input.lockPath);
  const ids = new Set(input.tasks.tasks.map((t) => t.id));
  const claims = new Map<string, Set<string>>();
  for (const l of input.previous?.lines ?? []) {
    const key = l.file + "\n" + l.text_sha256;
    claims.set(key, new Set([...(claims.get(key) ?? []), ...l.tasks]));
  }
  let carried = 0;
  const dropped: string[] = [];
  const loads = new Map(input.before.map((f) => [f.path, f.load]));
  const lines = contractLines(input.before).map((l): LockLine => {
    const text_sha256 = sha256(l.norm);
    const tasks = [...(claims.get(l.file + "\n" + text_sha256) ?? [])].sort();
    for (const t of tasks.filter((t) => !ids.has(t))) dropped.push(l.id + " " + t);
    const kept = tasks.filter((t) => ids.has(t));
    carried += kept.length;
    return {
      id: l.id,
      file: l.file,
      line: l.line,
      end_line: l.end_line,
      heading: l.heading,
      kind: l.kind,
      categories: l.categories,
      load: loads.get(l.file) ?? "on-demand",
      ask: l.categories.includes("ask") ? (classifyText(l.norm).category ?? "any") : null,
      text: clip(l.norm),
      text_sha256,
      tasks: kept,
    };
  });
  const rel = (p: string) => relative(dir, p).split("\\").join("/");
  const lock: Lock = {
    schema_version: 1,
    tasks: { file: rel(input.tasks.path), sha256: input.tasks.sha256! },
    ext: input.ext && { file: rel(input.ext.path), sha256: input.ext.sha256! },
    policy: input.policy && { file: basename(input.policy.path), sha256: input.policy.sha256 },
    skill: { name: input.skillName, tree_sha256: treeSha256(input.before), files: input.before.map((f) => ({ path: f.path, sha256: f.sha256, load: f.load })) },
    extractor: { version: EXTRACTOR_VERSION, sha256: EXTRACTOR_SHA256 },
    classifier_sha256: CLASSIFIER_SHA256,
    coverage_rule: COVERAGE_RULE,
    lines,
  };
  return { lock, carried, dropped };
}

/** The lock as JSON, one line object per row so a claim is a one-line edit and a one-line diff. */
export function renderLock(lock: Lock): string {
  const { lines, ...head } = lock;
  const top = JSON.stringify(head, null, 2).replace(/\n}$/, "");
  return top + ',\n  "lines": [\n' + lines.map((l) => "    " + JSON.stringify(l)).join(",\n") + (lines.length ? "\n" : "") + "  ]\n}\n";
}

/** Writes the lock through a temporary file and a rename, so a reader never sees half a lock. */
export function writeLock(path: string, lock: Lock): void {
  const tmp = path + ".tmp-" + process.pid;
  writeFileSync(tmp, renderLock(lock));
  renameSync(tmp, path);
}

export function readLock(path: string): { lock: Lock | null; problem: string | null } {
  let parsed: Lock;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return { lock: null, problem: "cannot read the lock " + path + ": " + (error as Error).message };
  }
  const ok = parsed?.schema_version === 1 && typeof parsed.tasks?.sha256 === "string" && Array.isArray(parsed.lines) && parsed.lines.every((l) => typeof l?.id === "string" && typeof l.text_sha256 === "string" && Array.isArray(l.tasks));
  return ok ? { lock: parsed, problem: null } : { lock: null, problem: "the lock " + path + " is not a schema_version 1 tasks lock" };
}

export interface LockState {
  tasks: TasksFile;
  ext: SidecarFile | null;
  policySha256: string | null;
  /** The before copy now, when the run has it. */
  before?: readonly SkillFile[];
}

/** What changed since the lock: each entry is one LOCK_DRIFT line. Empty when the lock still holds. */
export function lockDrift(lock: Lock, now: LockState): string[] {
  const drift: string[] = [];
  const short = (s: string | null | undefined) => (s ? s.slice(0, 12) : "none");
  if (lock.tasks.sha256 !== now.tasks.sha256) drift.push("tasks file changed: sha256 " + short(lock.tasks.sha256) + " in the lock, " + short(now.tasks.sha256) + " now");
  if ((lock.ext?.sha256 ?? null) !== (now.ext?.sha256 ?? null)) drift.push("tasks.ext.json changed: sha256 " + short(lock.ext?.sha256) + " in the lock, " + short(now.ext?.sha256) + " now");
  if ((lock.policy?.sha256 ?? null) !== now.policySha256) drift.push("policy changed: sha256 " + short(lock.policy?.sha256) + " in the lock, " + short(now.policySha256) + " now");
  if (lock.extractor.version !== EXTRACTOR_VERSION || lock.extractor.sha256 !== EXTRACTOR_SHA256) drift.push("the contract-line rules changed since the lock (extractor " + lock.extractor.version + ", " + short(lock.extractor.sha256) + ")");
  if (now.before && treeSha256(now.before) !== lock.skill.tree_sha256) {
    const was = new Map(lock.skill.files.map((f) => [f.path, f.sha256]));
    const changed = now.before.filter((f) => was.get(f.path) !== f.sha256).map((f) => f.path);
    const gone = lock.skill.files.filter((f) => !now.before!.some((b) => b.path === f.path)).map((f) => f.path);
    drift.push("the before copy differs from the locked one: " + [...changed.map((p) => p + " changed or added"), ...gone.map((p) => p + " gone")].join(", "));
  }
  return drift;
}

/** Whether the lock and the files it pins are committed and clean at HEAD, and the commit a paid run records. */
export function lockCommit(lockPath: string, pinned: readonly string[]): { ok: true; commit: string } | { ok: false; reason: string } {
  if (!existsSync(lockPath)) return { ok: false, reason: "no lock at " + lockPath };
  const cwd = dirname(lockPath);
  const git = (args: string[]) => spawnSync("git", args, { cwd, encoding: "utf8" });
  const head = git(["rev-parse", "HEAD"]);
  if (head.status !== 0) return { ok: false, reason: "the lock is not in a git repository with a commit" };
  const files = [lockPath, ...pinned];
  const untracked = files.filter((f) => git(["ls-files", "--error-unmatch", "--", f]).status !== 0);
  if (untracked.length) return { ok: false, reason: "not committed: " + untracked.map((f) => relative(cwd, f) || f).join(", ") };
  const dirty = git(["status", "--porcelain", "--", ...files]).stdout.split("\n").map((s) => s.trim()).filter(Boolean);
  if (dirty.length) return { ok: false, reason: "uncommitted changes: " + dirty.join("; ") };
  return { ok: true, commit: head.stdout.trim() };
}

/** One old-arm (before or before2) run of a task, as the trial module observed it. */
export interface OldArmRun {
  task: string;
  passed: boolean;
  /** Skill files the run read, relative to the skill directory; SKILL.md when the run opened the skill. */
  files_read: string[];
  /** The categories of the questions the run asked. */
  asked: Category[];
}

export type LineStatus = "covered" | "unreached" | "unclaimed";

export interface LineCoverage {
  id: string;
  status: LineStatus;
  /** The claiming tasks. */
  tasks: string[];
  /** The claiming tasks with an old-arm run that reached the line. */
  reached_by: string[];
}

export function reached(line: LockLine, run: OldArmRun): boolean {
  if (!run.passed || !run.files_read.includes(line.file)) return false;
  if (line.ask === null) return true;
  return line.ask === "any" ? run.asked.length > 0 : run.asked.includes(line.ask);
}

export function lineCoverage(lines: readonly LockLine[], runs: readonly OldArmRun[]): LineCoverage[] {
  return lines.map((line) => {
    const reachedBy = line.tasks.filter((t) => runs.some((r) => r.task === t && reached(line, r)));
    const status: LineStatus = !line.tasks.length ? "unclaimed" : reachedBy.length ? "covered" : "unreached";
    return { id: line.id, status, tasks: line.tasks, reached_by: reachedBy };
  });
}

/** A line the edit touched (GSTA-13's diet change): rewritten, removed, or moved out of SKILL.md into an on-demand file. */
export const touched = (line: Pick<LockLine, "file">, fate: LineFate) => fate.class === "rewritten" || fate.class === "removed" || (fate.class === "moved" && line.file === "SKILL.md");

/** The lines the edit touched that no task covers: the gap the verdict lists, whatever the gates decide. */
export function coverageGaps(lines: readonly LockLine[], fates: readonly LineFate[], coverage: readonly LineCoverage[]): { id: string; class: LineFate["class"]; status: LineStatus }[] {
  const lineById = new Map(lines.map((l) => [l.id, l]));
  const covById = new Map(coverage.map((c) => [c.id, c.status]));
  return fates.flatMap((f) => {
    const line = lineById.get(f.id);
    const status = covById.get(f.id) ?? "unclaimed";
    return line && touched(line, f) && status !== "covered" ? [{ id: f.id, class: f.class, status }] : [];
  });
}

export interface GateRemoval {
  id: string;
  class: "rewritten" | "removed";
  /** unclaimed, unreached, or every reaching task failed in after. */
  why: LineStatus | "fails-in-after";
  tasks: string[];
}

/**
 * The contract lines an after copy rewrote or removed that no covering task still passes in after: each one is an
 * UNCOVERED_GATE_REMOVAL. A moved line is not a removal; its coverage still shows whether any run read its new file.
 */
export function uncoveredRemovals(fates: readonly LineFate[], coverage: readonly LineCoverage[], passesInAfter: (task: string) => boolean): GateRemoval[] {
  const byId = new Map(coverage.map((c) => [c.id, c]));
  return fates.flatMap((f): GateRemoval[] => {
    if (f.class !== "rewritten" && f.class !== "removed") return [];
    const c = byId.get(f.id) ?? { status: "unclaimed" as const, tasks: [], reached_by: [] };
    if (c.status === "covered" && c.reached_by.some(passesInAfter)) return [];
    return [{ id: f.id, class: f.class, why: c.status === "covered" ? "fails-in-after" : c.status, tasks: c.tasks }];
  });
}
