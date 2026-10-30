// The lock is the preregistration (interface v0.4, "The lock is the preregistration"). tasks.lock.json, beside the
// tasks file, records the tasks file's and sidecar's sha256, the policy's sha256, the before copy's files, and its
// contract lines, each with the ids of the tasks that cover it. A paid run needs it committed and clean at HEAD.
//
// Coverage claims come from the author: --lock lists every contract line with the tasks the author named for it, and a
// relock keeps those claims for every line whose file and text are unchanged. When a file repeats a line, each copy
// keeps its own claims, in order, and only while the file holds as many copies as before. Nothing claims a line
// automatically: a claimed line that a passing task reaches can clear UNCOVERED_GATE_REMOVAL, so a guessed claim would
// weaken the gate.
//
// A line counts as covered only when an old-arm run of a claiming task reached it: the run passed, it read the line's
// file, and, for an ask line, it asked a question of the line's category (any question when the line names none). A
// claimed line that no run reached is unreached, a line nobody claimed is unclaimed, and both count as uncovered. So a
// line a diet moved into an on-demand section that no task's run read shows up uncovered.
//
// The transcript shows only the questions a run asked. For every other line, the claiming task's check observes the
// gated event or required output: a claim says that check tests the line, so a passing run is that observation. A claim
// whose check does not test its line is a wrong claim, the same as a guessed one.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, sep } from "node:path";
import { spawnSync } from "node:child_process";
import type { SidecarFile } from "../contract/sidecar.ts";
import { KEBAB_ID, type TasksFile } from "../contract/tasks.ts";
import { CATEGORY_NAMES, CLASSIFIER_SHA256, classifyText, type Category } from "../../usersim/classifier.ts";
import { CATEGORY_RULES, contractLines, EXTRACTOR_SHA256, EXTRACTOR_VERSION, type LineCategory, type LineFate, type Load, type SkillFile, type UnitKind } from "./contract-lines.ts";

export const LOCK_FILE = "tasks.lock.json";

export const COVERAGE_RULE =
  "A line counts as covered only when an old-arm run of a task in its tasks list reached it: the run passed, read the line's file, and, for an ask line, asked a question of the line's category (any question when it is \"any\"). For other lines the claiming task's check observes the line's gated event or required output, so a passing run is that observation. Claimed lines no run reached, and unclaimed lines, are uncovered.";

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
  /** The policy's file name, never a path: the default policy lives in the gstack-evals package, outside the tasks repo. Its sha256 pins it. */
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
  /**
   * Claims dropped because their line's text no longer appears in its file as many times as the previous lock lists it
   * (claims follow a line's copies in order, so they cannot be carried), as "<previous line id> <task> (<n> copies in the
   * lock, <m> now)".
   */
  unmatched: string[];
}

/** buildLock refuses a tasks file or sidecar with problems: a lock pins files that the contract accepts. */
export class LockInputError extends Error {}

export function buildLock(input: LockInput): LockBuild {
  const problems = [...input.tasks.problems.map((p) => "tasks file: " + p), ...(input.ext?.problems ?? []).map((p) => "sidecar: " + p)];
  if (input.tasks.sha256 === null && !problems.length) problems.push("tasks file: it could not be read");
  if (input.ext && input.ext.sha256 === null && !problems.length) problems.push("sidecar: it could not be read");
  if (problems.length) throw new LockInputError("cannot lock a tasks file the contract refuses: " + problems.slice(0, 5).join("; "));
  const dir = dirname(input.lockPath);
  const ids = new Set(input.tasks.tasks.map((t) => t.id));
  const previous = new Map<string, LockLine[]>();
  for (const l of input.previous?.lines ?? []) {
    const key = l.file + "\n" + l.text_sha256;
    previous.set(key, [...(previous.get(key) ?? []), l]);
  }
  const found = contractLines(input.before).map((l) => {
    const text_sha256 = sha256(l.norm);
    return { l, text_sha256, key: l.file + "\n" + text_sha256 };
  });
  const copies = new Map<string, number>();
  for (const { key } of found) copies.set(key, (copies.get(key) ?? 0) + 1);
  const claims = new Map<string, string[][]>();
  const unmatched: string[] = [];
  for (const [key, rows] of previous) {
    const now = copies.get(key) ?? 0;
    if (rows.length === now) claims.set(key, rows.map((r) => r.tasks));
    else for (const r of rows) for (const t of r.tasks) unmatched.push(r.id + " " + t + " (" + rows.length + " copies in the lock, " + now + " now)");
  }
  let carried = 0;
  const dropped: string[] = [];
  const loads = new Map(input.before.map((f) => [f.path, f.load]));
  const lines = found.map(({ l, text_sha256, key }): LockLine => {
    const tasks = [...(claims.get(key)?.shift() ?? [])].sort();
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
  return { lock, carried, dropped, unmatched };
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

const LOCK_KEYS = ["schema_version", "tasks", "ext", "policy", "skill", "extractor", "classifier_sha256", "coverage_rule", "lines"];
const LINE_KEYS = ["id", "file", "line", "end_line", "heading", "kind", "categories", "load", "ask", "text", "text_sha256", "tasks"];
const UNIT_KINDS: readonly string[] = ["prose", "heading", "table", "format"] satisfies UnitKind[];

/** The first part of a parsed lock that breaks the lock schema (#/$defs/lock), or null when the lock fits it. */
export function lockShapeProblem(v: any): string | null {
  const object = (x: any, keys: string[]) => typeof x === "object" && x !== null && !Array.isArray(x) && Object.keys(x).every((k) => keys.includes(k));
  const sha = (x: unknown) => typeof x === "string" && /^[0-9a-f]{64}$/.test(x);
  const str = (x: unknown) => typeof x === "string" && x.length > 0;
  const int = (x: unknown) => Number.isInteger(x) && (x as number) >= 1;
  const pin = (x: any) => object(x, ["file", "sha256"]) && str(x.file) && sha(x.sha256);
  const set = (x: unknown, ok: (s: any) => boolean) => Array.isArray(x) && new Set(x).size === x.length && x.every(ok);
  const load = (x: unknown) => x === "always" || x === "on-demand";
  if (!object(v, LOCK_KEYS)) return "it is not an object holding only " + LOCK_KEYS.join(", ");
  const fields: [string, boolean][] = [
    ["schema_version", v.schema_version === 1],
    ["tasks", pin(v.tasks)],
    ["ext", v.ext === null || pin(v.ext)],
    ["policy", v.policy === null || pin(v.policy)],
    ["skill", object(v.skill, ["name", "tree_sha256", "files"]) && str(v.skill.name) && sha(v.skill.tree_sha256) && Array.isArray(v.skill.files) && v.skill.files.every((f: any) => object(f, ["path", "sha256", "load"]) && str(f.path) && sha(f.sha256) && load(f.load))],
    ["extractor", object(v.extractor, ["version", "sha256"]) && int(v.extractor.version) && sha(v.extractor.sha256)],
    ["classifier_sha256", sha(v.classifier_sha256)],
    ["coverage_rule", str(v.coverage_rule)],
    ["lines", Array.isArray(v.lines)],
  ];
  const bad = fields.find(([, ok]) => !ok);
  if (bad) return bad[0] + " is missing or malformed";
  const i = v.lines.findIndex(
    (l: any) =>
      !(
        object(l, LINE_KEYS) &&
        typeof l.id === "string" && /^B:.+:[0-9]{4,}$/.test(l.id) &&
        str(l.file) && int(l.line) && int(l.end_line) && typeof l.heading === "string" &&
        UNIT_KINDS.includes(l.kind) &&
        set(l.categories, (c) => Object.hasOwn(CATEGORY_RULES, c)) && l.categories.length > 0 &&
        load(l.load) &&
        (l.ask === null || l.ask === "any" || CATEGORY_NAMES.includes(l.ask)) &&
        typeof l.text === "string" && sha(l.text_sha256) &&
        set(l.tasks, (t) => typeof t === "string" && KEBAB_ID.test(t))
      ),
  );
  return i < 0 ? null : "lines[" + i + "] (" + (v.lines[i]?.id ?? "no id") + ") has a missing, unknown or malformed field";
}

export function readLock(path: string): { lock: Lock | null; problem: string | null } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return { lock: null, problem: "cannot read the lock " + path + ": " + (error as Error).message };
  }
  const problem = lockShapeProblem(parsed);
  return problem ? { lock: null, problem: "the lock " + path + " is not a schema_version 1 tasks lock: " + problem } : { lock: parsed as Lock, problem: null };
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
  if (lock.classifier_sha256 !== CLASSIFIER_SHA256) drift.push("the question classifier changed since the lock (" + short(lock.classifier_sha256) + " in the lock, " + short(CLASSIFIER_SHA256) + " now)");
  if (now.before && treeSha256(now.before) !== lock.skill.tree_sha256) {
    const was = new Map(lock.skill.files.map((f) => [f.path, f.sha256]));
    const changed = now.before.filter((f) => was.get(f.path) !== f.sha256).map((f) => f.path);
    const gone = lock.skill.files.filter((f) => !now.before!.some((b) => b.path === f.path)).map((f) => f.path);
    drift.push("the before copy differs from the locked one: " + [...changed.map((p) => p + " changed or added"), ...gone.map((p) => p + " gone")].join(", "));
  }
  return drift;
}

/**
 * Whether the lock and the files it pins are committed and clean at HEAD, and the commit a paid run records. git status is
 * not trusted alone: each file's bytes must hash to its blob in HEAD, which an assume-unchanged or skip-worktree flag
 * cannot fake (U9, Captain brief item 6).
 */
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
  const differs = files.filter((f) => {
    const committed = git(["rev-parse", "--verify", "--quiet", "HEAD:./" + relative(cwd, f).split(sep).join("/")]);
    const working = git(["hash-object", "--no-filters", "--", f]);
    return committed.status !== 0 || working.status !== 0 || committed.stdout.trim() !== working.stdout.trim();
  });
  if (differs.length) return { ok: false, reason: "the working copy differs from the commit at HEAD, though git status reports it clean (assume-unchanged or skip-worktree hides it): " + differs.map((f) => relative(cwd, f) || f).join(", ") };
  return { ok: true, commit: head.stdout.trim() };
}

/** One old-arm (before or before2) run of a task, as the trial module observed it. */
export interface OldArmRun {
  task: string;
  passed: boolean;
  /** Skill files the run read, relative to the skill directory; SKILL.md when the run opened the skill. */
  files_read: string[];
  /** One entry per question the run asked: its classifier category, or null when the classifier names none. */
  asked: (Category | null)[];
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

/**
 * Each line's id mapped to the ids of every copy of its text, in any file. lineFates pairs the copies of one line
 * across all files, by file and position, so it cannot tell which copy an edit touched: an edit to any copy counts
 * against them all.
 */
function copiesOf(lines: readonly LockLine[]): Map<string, string[]> {
  const byText = new Map<string, string[]>();
  for (const l of lines) byText.set(l.text_sha256, [...(byText.get(l.text_sha256) ?? []), l.id]);
  return new Map(lines.map((l) => [l.id, byText.get(l.text_sha256)!]));
}

/** The lines the edit touched that no task covers: the gap the verdict lists, whatever the gates decide. */
export function coverageGaps(lines: readonly LockLine[], fates: readonly LineFate[], coverage: readonly LineCoverage[]): { id: string; class: LineFate["class"]; status: LineStatus }[] {
  const lineById = new Map(lines.map((l) => [l.id, l]));
  const covById = new Map(coverage.map((c) => [c.id, c.status]));
  const copies = copiesOf(lines);
  const gaps = new Map<string, { id: string; class: LineFate["class"]; status: LineStatus }>();
  for (const f of fates) {
    const line = lineById.get(f.id);
    if (!line || !touched(line, f)) continue;
    for (const id of copies.get(f.id)!) {
      const status = covById.get(id) ?? "unclaimed";
      if (status !== "covered" && !gaps.has(id)) gaps.set(id, { id, class: f.class, status });
    }
  }
  return [...gaps.values()];
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
 * UNCOVERED_GATE_REMOVAL. A rewrite or removal of one copy of a repeated line counts against every copy, so it clears
 * only when each copy has such a task. A moved line is not a removal; its coverage still shows whether any run read
 * its new file.
 */
export function uncoveredRemovals(lines: readonly LockLine[], fates: readonly LineFate[], coverage: readonly LineCoverage[], passesInAfter: (task: string) => boolean): GateRemoval[] {
  const byId = new Map(coverage.map((c) => [c.id, c]));
  const copies = copiesOf(lines);
  const removals = new Map<string, GateRemoval>();
  for (const f of fates) {
    if (f.class !== "rewritten" && f.class !== "removed") continue;
    for (const id of copies.get(f.id) ?? [f.id]) {
      const c = byId.get(id) ?? { status: "unclaimed" as const, tasks: [], reached_by: [] };
      if (removals.has(id) || (c.status === "covered" && c.reached_by.some(passesInAfter))) continue;
      removals.set(id, { id, class: f.class, why: c.status === "covered" ? "fails-in-after" : c.status, tasks: c.tasks });
    }
  }
  return [...removals.values()];
}
