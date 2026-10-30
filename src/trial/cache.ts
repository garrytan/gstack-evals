// The session cache key and progress.json (plan v3.2, "Execution, isolation and secrets").
//
// Each cached session is keyed by a sha256 over named parts: the arm's installed tree, the task object and its sidecar
// entry, the fixture directory's tree, the check runner and verifier code, the trial image digest, the rig recipe hash
// (CI plan v5: the same hash the verdict's rig block takes), model, host version, adapter sha256, isolation, --timeout,
// the passthrough env values (hashed), judge model and policy. A resumed or reused session whose key differs refuses
// before any spend (E_CACHE_STALE), names the parts that changed, and points at --repair.
//
// <out>/progress.json is rewritten atomically after every session, so a thread that waits on a background run can read
// how far it got.
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ReasonCode } from "../errors/codes.ts";

export const SESSION_KEY_PARTS = [
  "arm_tree", "task", "sidecar_entry", "fixture_tree", "verifier", "image_digest", "recipe", "model", "host_version", "adapter_sha256", "isolation", "timeout_s", "env_values", "judge_model", "policy",
] as const;
export type SessionKeyPart = (typeof SESSION_KEY_PARTS)[number];
export type SessionKeyInput = Record<SessionKeyPart, unknown>;

export interface SessionKey {
  sha256: string;
  /** Each part's own sha256, so a mismatch can name what changed. */
  parts: Record<SessionKeyPart, string>;
}

const sha = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");

/** JSON with object keys sorted, so equal values hash equally. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.keys(value).sort().map((k) => JSON.stringify(k) + ":" + canonical((value as Record<string, unknown>)[k])).join(",") + "}";
  return JSON.stringify(value ?? null);
}

export function sessionKey(input: SessionKeyInput): SessionKey {
  const parts = Object.fromEntries(SESSION_KEY_PARTS.map((name) => [name, sha(canonical(input[name]))])) as Record<SessionKeyPart, string>;
  return { sha256: sha(SESSION_KEY_PARTS.map((name) => name + "=" + parts[name]).join("\n")), parts };
}

/** The passthrough env part: the declared names with their values, hashed so no value is stored. */
export const envValuesHash = (declared: readonly string[], source: Record<string, string | undefined>): string => sha(canonical(Object.fromEntries([...declared].sort().map((n) => [n, source[n] ?? null]))));

/** The parts whose hashes differ between a stored key and the current one. */
export function staleParts(stored: SessionKey, current: SessionKey): SessionKeyPart[] {
  return SESSION_KEY_PARTS.filter((name) => stored.parts?.[name] !== current.parts[name]);
}

export interface CacheStop {
  code: ReasonCode;
  message: string;
  fix: string;
}

/** E_CACHE_STALE for one cell, naming the parts that changed. */
export function cacheStale(cell: string, changed: readonly SessionKeyPart[]): CacheStop {
  return {
    code: "E_CACHE_STALE",
    message: cell + ": the cached session's key no longer matches; changed: " + changed.join(", "),
    fix: "Nothing was spent. Rerun the affected cells with --repair \"<named repair>\", which writes a new verdict id; never --resume over a changed key.",
  };
}

/**
 * A directory's tree hash: every entry's relative path, type, executable bit and content (a symlink's target), sorted.
 * Directories with no files still count. Each entry is one JSON array, so a space or newline in a name or target cannot
 * make two trees serialize alike. Used for the fixture tree and an arm's installed tree.
 */
export function dirTreeSha256(root: string): string {
  const lines: string[] = [];
  const walk = (dir: string, rel: string) => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      const relPath = rel ? rel + "/" + name : name;
      const st = lstatSync(path);
      if (st.isSymbolicLink()) lines.push(JSON.stringify(["l", relPath, readlinkSync(path)]));
      else if (st.isDirectory()) {
        lines.push(JSON.stringify(["d", relPath]));
        walk(path, relPath);
      } else if (st.isFile()) lines.push(JSON.stringify(["f", relPath, st.mode & 0o111 ? "x" : "-", sha(readFileSync(path))]));
      else lines.push(JSON.stringify(["o", relPath]));
    }
  };
  walk(root, "");
  return sha(lines.join("\n"));
}

export interface Progress {
  schema_version: 1;
  run_id: string;
  updated_at: string;
  /** Sessions the run plans, the rerun stage included once it starts. */
  total: number;
  done: number;
  passed: number;
  failed: number;
  timeouts: number;
  /** Missing cells: a session with no outcome to count. */
  missing: number;
  /** Cells still running, as model/arm/task/round-trial. */
  running: string[];
  /** Seconds left at the mean session time so far and the run's parallelism; null before the first session ends. */
  eta_s: number | null;
  last: { cell: string; outcome: "pass" | "fail" | "timeout" | "missing" } | null;
}

export function newProgress(runId: string, total: number, now = new Date()): Progress {
  return { schema_version: 1, run_id: runId, updated_at: now.toISOString(), total, done: 0, passed: 0, failed: 0, timeouts: 0, missing: 0, running: [], eta_s: null, last: null };
}

/** The progress after one session ends, with the ETA from the mean session wall time so far. */
export function recordSession(p: Progress, cell: string, outcome: "pass" | "fail" | "timeout" | "missing", meanWallS: number | null, parallel: number, now = new Date()): Progress {
  const next: Progress = { ...p, updated_at: now.toISOString(), done: p.done + 1, running: p.running.filter((c) => c !== cell), last: { cell, outcome } };
  if (outcome === "pass") next.passed++;
  else if (outcome === "fail") next.failed++;
  else if (outcome === "timeout") next.timeouts++;
  else next.missing++;
  next.eta_s = meanWallS === null ? null : Math.ceil((Math.max(0, next.total - next.done) * meanWallS) / Math.max(1, parallel));
  return next;
}

/** Writes <out>/progress.json through a temp file and a rename, so a reader never sees half a file. */
export function writeProgress(out: string, progress: Progress): string {
  mkdirSync(out, { recursive: true });
  const path = join(out, "progress.json");
  const tmp = path + "." + process.pid + ".tmp";
  writeFileSync(tmp, JSON.stringify(progress, null, 2) + "\n");
  renameSync(tmp, path);
  return path;
}
