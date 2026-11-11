// Copyright (c) 2026 Garry Tan. MIT License.
// The eng-review build read's build stage (prereg 2026-11-11-geva-522-eng-review-build-read-prereg, section 4): Opus 5.5
// in Claude Code, no gstack, on main's outcome-skills session driver (lanes/outcome-skills/driver/stage.ts) and the Lane B
// agent (lanes/real-outcome/agent/real_agent.py). This module holds what the stage freezes: the build prompt and its
// no-review variant with the statement note, the arms file the driver and real_agent read (H's no-gstack limits: 400
// turns, 3 hours, $16), the mounts (/work/repo, /work/plan.md read-only, /work/review read-only for reviewed arms and
// nothing else), the strip rule, the no-history and no-drive checks, and the session outcome rules (upstream: one retry
// from a fresh container, then E_EB_GAP; infra: one rerun, then a gap). real_agent sets CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1,
// denies WebSearch and WebFetch and sends every call through the item's metering proxy; agentGuards checks it still does.
// The session itself and the grader are seams (BuildSession, Grader): no session runs in tests.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { cleanRoomPreflight } from "../outcome-skills/arms/clean-room.ts";
import type { Registry } from "../outcome-skills/arms/registry.ts";
import { fail } from "./errors.ts";
import { FROZEN } from "./frozen.ts";
import type { Arm, BuildUnit, GradedBuild, Reviewer, ReviewRecord, SessionOutcome } from "./types.ts";

export const PREREG = "2026-11-11-geva-522-eng-review-build-read-prereg";
export const BUILD_MODEL = "claude-opus-5-5";
export const H_REGISTRY = join(import.meta.dir, "..", "outcome-skills", "arms", "h-registry.json");
export const REAL_AGENT = join(import.meta.dir, "..", "real-outcome", "agent", "real_agent.py");

export const REPO_DIR = "/work/repo";
export const PLAN_PATH = "/work/plan.md";
export const REVIEW_DIR = "/work/review";

export const BUILD_LINE = "Implement the plan in plan.md in /work/repo, with tests.";
export const REVIEW_LINE = "A reviewer's notes on the plan are in /work/review/; use them as you see fit.";

/** The driver's arm names: the no-review build and the build after any review (the review arm lives in the run record, not the prompt). */
export const BUILD_ARMS = { none: "eb-build:none", reviewed: "eb-build:reviewed" } as const;
export const armName = (arm: Arm) => (arm === "none" ? BUILD_ARMS.none : BUILD_ARMS.reviewed);

/** The build prompt: the build line, the review line for reviewed arms, then the statement note, identical across arms. */
export function buildPrompt(arm: Arm, note: string): string {
  const text = note.trim();
  if (!text) fail("E_USAGE", "the statement note is empty; every build prompt ends with the unit's note");
  return (arm === "none" ? BUILD_LINE : BUILD_LINE + " " + REVIEW_LINE) + "\n\n" + text;
}

type Limits = Registry["arms"][string]["limits"];

/** H's no-gstack session limits, read from H's arms file and checked against the frozen build limits. */
export function buildLimits(path: string = H_REGISTRY): Limits {
  const h = JSON.parse(readFileSync(path, "utf8")) as Registry;
  const l = h.arms.none?.limits;
  const B = FROZEN.sessions.build;
  if (!l || l.session_cap_usd !== B.usd || l.max_turns !== B.turns || l.wall_limit_sec !== B.minutes * 60) fail("E_USAGE", path + ": H's none arm limits " + JSON.stringify(l ?? null) + " are not the frozen build limits ($" + B.usd + ", " + B.turns + " turns, " + B.minutes + " minutes)");
  return { ...l! };
}

/**
 * The arms file the driver (ServeOptions.registry) and real_agent (arms_path) read. Both arms are kind none: no skill,
 * no install, the clean room. Turn 1 is the statement alone, and the run copy's instruction is buildPrompt's text, so
 * real_agent sends exactly that. registry.ts loadRegistry is G's validator and refuses a second none arm, so this file is
 * handed to the driver as an object, never loaded through it.
 */
export function buildRegistry(limits: Limits = buildLimits()): Registry {
  const arm = { family: "EB", skill: null, kind: "none" as const, install: "none" as const, clean_room: true, turns: [{ phase: "t1", text: "{statement}" }], limits };
  return {
    schema: 1,
    prereg: PREREG,
    pins: { gstack: { repo: "none", sha: "none", version: "none", install: "none" }, model: BUILD_MODEL },
    families: { EB: { skills: [], built: true } },
    arms: { [BUILD_ARMS.none]: { ...arm }, [BUILD_ARMS.reviewed]: { ...arm } },
    not_run: {},
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Mounts, the strip rule and the isolation checks.

/** docker -v specs: the build tree, the unit's plan read-only, and the review bundle read-only for reviewed arms only. */
export function buildMounts(o: { arm: Arm; repo: string; plan: string; review: string | null }): string[] {
  if ((o.arm === "none") !== (o.review === null)) fail("E_USAGE", "arm " + o.arm + (o.arm === "none" ? " has no review bundle" : " needs its review bundle"));
  return [resolve(o.repo) + ":" + REPO_DIR, resolve(o.plan) + ":" + PLAN_PATH + ":ro", ...(o.review ? [resolve(o.review) + ":" + REVIEW_DIR + ":ro"] : [])];
}

const under = (path: string, root: string) => {
  const p = resolve(path);
  const r = resolve(root);
  return p === r || p.startsWith(r + sep) || r.startsWith(p + sep);
};

/**
 * Refuses a mount whose host path is, holds or sits inside a forbidden root: the unit's task directory (hidden tests and
 * key), its later history, any drive, any other arm's output. Also refuses any container path but the three above.
 */
export function checkMounts(specs: string[], forbidden: string[]): void {
  const allowed = new Set([REPO_DIR, PLAN_PATH, REVIEW_DIR]);
  for (const spec of specs) {
    const [host, at] = spec.split(":");
    if (!allowed.has(at!)) fail("E_USAGE", "build mount " + spec + " targets " + at + "; a build sees only " + [...allowed].join(", "));
    const hit = forbidden.find((f) => under(host!, f));
    if (hit) fail("E_USAGE", "build mount " + spec + " would show " + hit + " to the builder (hidden tests, key, later history or a drive); nothing started");
  }
}

const STRIP = new Set(["CLAUDE.md", "CLAUDE.local.md", "AGENTS.md", ".claude"]);

/** The strip rule: CLAUDE.md, CLAUDE.local.md, AGENTS.md and .claude removed at any depth outside .git, before arm setup. Returns what it removed. */
export function stripTree(root: string): string[] {
  const removed: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === ".git") continue;
      const p = join(dir, e.name);
      if (STRIP.has(e.name)) {
        rmSync(p, { recursive: true, force: true });
        removed.push(p.slice(root.length + 1));
      } else if (e.isDirectory() && !e.isSymbolicLink()) walk(p);
    }
  };
  walk(root);
  return removed.sort();
}

const git = (repo: string, args: string[]) => spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } });

/** The build tree holds base only: one commit, no remote, no other ref and no stash, so no later history is visible. */
export function assertNoHistory(repo: string): void {
  const count = git(repo, ["rev-list", "--all", "--count"]);
  const remotes = git(repo, ["remote"]);
  const refs = git(repo, ["for-each-ref", "--format=%(refname)"]);
  if (count.status !== 0 || remotes.status !== 0 || refs.status !== 0) fail("E_USAGE", repo + ": git could not read the build tree (" + (count.stderr || remotes.stderr || refs.stderr).trim() + ")");
  const n = Number(count.stdout.trim());
  const extra = refs.stdout.split("\n").filter((r) => r && !r.startsWith("refs/heads/"));
  if (n !== 1 || remotes.stdout.trim() || extra.length) fail("E_USAGE", repo + ": the build tree must hold base alone (1 commit, no remote, no other ref); it holds " + n + " commit(s)" + (remotes.stdout.trim() ? ", remote " + remotes.stdout.trim().split("\n").join(", ") : "") + (extra.length ? ", refs " + extra.join(", ") : ""));
}

/** The guards the Lane B agent must still carry, read from its source: bundled skills off, web tools denied, MCP config strict. */
export function agentGuards(path: string = REAL_AGENT): string[] {
  const src = readFileSync(path, "utf8");
  const need: Array<[string, RegExp]> = [
    ["CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1", /"CLAUDE_CODE_DISABLE_BUNDLED_SKILLS":\s*"1"/],
    ["WebSearch and WebFetch denied", /disallowed_tools=\["WebSearch",\s*"WebFetch"\]/],
    ["strict MCP config", /"strict-mcp-config"/],
    ["the claude_code system prompt preset", /"preset":\s*"claude_code"/],
  ];
  return need.filter(([, re]) => !re.test(src)).map(([name]) => name);
}

/** The clean-room scans (no gstack, no drive, no skills folder) in the unit's image with the session's own mounts, before any lease. */
export function preflight(o: { docker: string; image: string; digest: string; mounts: string[] }): void {
  cleanRoomPreflight({ docker: o.docker, image: o.image, digest: o.digest, home: "/root", workdirs: ["/work"], mounts: o.mounts });
}

// ---------------------------------------------------------------------------------------------------------------------
// Session outcomes and the build cell.

export interface CellRun {
  outcome: SessionOutcome;
  attempts: SessionOutcome[];
  gap: boolean;
  /** The E_EB_GAP line for a gap, else null. */
  line: string | null;
}

/** Completed or limit: scored as is. Upstream: one retry from a fresh container; a second is a gap. Infra: one rerun; a second is a gap. */
export async function runSessionCell(cell: string, attempt: (n: number) => Promise<SessionOutcome>): Promise<CellRun> {
  const attempts: SessionOutcome[] = [];
  const seen = { upstream_gap: 0, infra_gap: 0 };
  for (;;) {
    const o = await attempt(attempts.length + 1);
    attempts.push(o);
    if (o === "completed" || o === "limit") return { outcome: o, attempts, gap: false, line: null };
    if (o !== "upstream_gap" && o !== "infra_gap") fail("E_USAGE", "cell " + cell + ": unknown session outcome " + JSON.stringify(o));
    if (++seen[o] >= 2) return { outcome: o, attempts, gap: true, line: "E_EB_GAP cell " + cell + ": " + o + " again after " + (attempts.length - 1) + " retr" + (attempts.length === 2 ? "y" : "ies") + "; recorded as a gap" };
  }
}

export interface SessionRun {
  outcome: SessionOutcome;
  /** The final tree's host path; null when the session left none. */
  tree: string | null;
  costUsd: number;
}

/** The seam the driver and real_agent fill: one session attempt from a fresh container. */
export type BuildSession = (o: { cell: string; unit: BuildUnit; arm: Arm; armName: string; prompt: string; attempt: number }) => Promise<SessionRun>;
export type GraderResult = Pick<GradedBuild, "functional" | "aftermath" | "anchors" | "tCases" | "catches" | "coverage" | "mutation" | "testLinesAdded">;
/** The seam the verifier fills: grade one final tree in the unit's pinned image, 3 runs. */
export type Grader = (o: { unit: BuildUnit; tree: string }) => Promise<GraderResult>;

export const cellId = (unit: string, arm: Arm, reviewer: Reviewer | null, rep: number) => unit + ":" + arm + ":" + (reviewer ?? "-") + ":" + rep;

const empty = (): GraderResult => ({ functional: [], aftermath: {}, anchors: {}, tCases: [], catches: {}, coverage: null, mutation: null, testLinesAdded: 0 });

/** One build cell: a reviewed arm whose review ended in a gap is a gap and never builds; otherwise the session rules, then the grader. */
export async function runBuildCell(o: { unit: BuildUnit; arm: Arm; reviewer: Reviewer | null; rep: number; pilot: boolean; note: string; review: ReviewRecord | null; session: BuildSession; grader: Grader; log?: (line: string) => void }): Promise<GradedBuild> {
  const cell = cellId(o.unit.id, o.arm, o.reviewer, o.rep);
  const meta = { unit: o.unit.id, arm: o.arm, reviewer: o.reviewer, rep: o.rep, pilot: o.pilot };
  if (o.arm !== "none" && (o.review === null || o.review.outcome === "upstream_gap" || o.review.outcome === "infra_gap")) {
    o.log?.("E_EB_GAP cell " + cell + ": its review ended " + (o.review?.outcome ?? "missing") + ", so the build is not run; recorded as a gap");
    return { ...meta, outcome: o.review?.outcome ?? "infra_gap", ...empty(), costUsd: 0 };
  }
  const prompt = buildPrompt(o.arm, o.note);
  let cost = 0;
  let tree: string | null = null;
  const run = await runSessionCell(cell, async (attempt) => {
    const s = await o.session({ cell, unit: o.unit, arm: o.arm, armName: armName(o.arm), prompt, attempt });
    cost += s.costUsd;
    tree = s.tree;
    return s.outcome;
  });
  if (run.gap) {
    o.log?.(run.line!);
    return { ...meta, outcome: run.outcome, ...empty(), costUsd: cost };
  }
  if (tree === null) fail("E_USAGE", "cell " + cell + ": the session ended " + run.outcome + " but left no tree to grade");
  return { ...meta, outcome: run.outcome, ...(await o.grader({ unit: o.unit, tree: tree! })), costUsd: cost };
}

// ---------------------------------------------------------------------------------------------------------------------
// The run record's cell cache, for --resume.

const digest = (text: string) => createHash("sha256").update(text).digest("hex");

/** Writes a finished cell and its digest. */
export function saveCell(dir: string, b: GradedBuild): string {
  mkdirSync(dir, { recursive: true });
  const key = cellId(b.unit, b.arm, b.reviewer, b.rep).replace(/[^A-Za-z0-9._-]/g, "_");
  const text = JSON.stringify(b);
  writeFileSync(join(dir, key + ".json.tmp"), text);
  renameSync(join(dir, key + ".json.tmp"), join(dir, key + ".json"));
  writeFileSync(join(dir, key + ".sha256"), digest(text) + "\n");
  return key;
}

/** Reads a finished cell, or null when it has none. A cell whose bytes no longer match its digest stops with E_EB_CACHE_STALE. */
export function loadCell(dir: string, key: string): GradedBuild | null {
  const file = join(dir, key + ".json");
  if (!existsSync(file)) return null;
  const text = readFileSync(file, "utf8");
  const want = existsSync(join(dir, key + ".sha256")) ? readFileSync(join(dir, key + ".sha256"), "utf8").trim() : "(none)";
  const got = digest(text);
  if (want !== got) fail("E_EB_CACHE_STALE", "cache key " + key + ": expected digest " + want + ", found " + got + "; nothing scored from it, rebuild the entry from its sealed source and --resume");
  return JSON.parse(text) as GradedBuild;
}

/** A batch with cells neither scored nor recorded as gaps prints no reading. */
export function assertComplete(stage: string, planned: string[], done: Set<string>): void {
  const open = planned.filter((k) => !done.has(k));
  if (open.length) fail("E_EB_CELL_INCOMPLETE", "stage " + stage + ": " + open.length + " of " + planned.length + " cells neither scored nor recorded as gaps (first " + open.slice(0, 3).join(", ") + "); --resume runs only the open cells");
}
