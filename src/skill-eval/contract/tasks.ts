// The contract reader: gstack's skill eval tasks file, read unchanged (gstack docs/designs/SKILL_EVAL_CONTRACT.md).
//
// A tasks file is a bare JSON array of {id, prompt, setup?, must?, must_not?, check?, safety?}, with the contract's
// meanings: setup and check run in the session's work dir with SKILL_EVAL_FIXTURES set to the tasks file's directory,
// must matches the final answer, must_not matches its code blocks, and safety: true marks a task whose failure fails
// the edit on its own. Everything gstack-evals adds lives in the tasks.ext.json sidecar (sidecar.ts).
//
// checkTasks applies the rules of gstack's checkEvalTasks (lib/skill-bill.ts at v1.91.295.0) in the same order and
// with the same problem text, so a file gstack's free test accepts is accepted here and one it refuses is refused with
// the same lines. tests/contract/tasks.test.ts holds the parity. The rules are reimplemented; no gstack code is copied.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export interface ContractTask {
  id: string;
  prompt: string;
  setup?: string;
  must?: string[];
  must_not?: string[];
  check?: string;
  safety?: boolean;
}

export const TASK_KEYS: readonly string[] = ["id", "prompt", "setup", "must", "must_not", "check", "safety"];

/** Set to the tasks file's directory for setup and check. */
export const FIXTURES_VAR = "SKILL_EVAL_FIXTURES";

export const KEBAB_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export interface TasksFile {
  /** Absolute path of the tasks file. */
  path: string;
  /** The tasks file's directory: SKILL_EVAL_FIXTURES for setup and check. */
  dir: string;
  /** sha256 of the file's bytes; null when it could not be read. */
  sha256: string | null;
  /** Entries in the array, valid or not, as gstack counts them. */
  count: number;
  problems: string[];
  /** The tasks, only when problems is empty. */
  tasks: ContractTask[];
  /** Every object entry of the array, valid or not, so the sidecar can be checked against a broken tasks file; null when the file could not be read or is not a JSON array. */
  entries: Record<string, unknown>[] | null;
}

/** Problems in a parsed tasks file, in checkEvalTasks's order and words. dir is the tasks file's directory. */
export function checkTasks(parsed: unknown, dir: string): string[] {
  if (!Array.isArray(parsed)) return ["must be a JSON array of tasks"];
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      problems.push("?: task must be an object, got " + JSON.stringify(entry));
      continue;
    }
    const t = entry as Record<string, unknown>;
    let where: string;
    try {
      where = String(t.id ?? "?");
    } catch {
      where = "?";
    }
    for (const key of Object.keys(t)) if (!TASK_KEYS.includes(key)) problems.push(where + ": unknown key " + key);
    if (typeof t.id !== "string" || !KEBAB_ID.test(t.id)) problems.push(where + ": id must be kebab-case");
    else if (ids.has(t.id)) problems.push(where + ": duplicate id");
    else ids.add(t.id);
    if (typeof t.prompt !== "string" || !t.prompt.trim()) problems.push(where + ": prompt must be a non-empty string");
    for (const key of ["setup", "check"]) if (key in t && typeof t[key] !== "string") problems.push(where + ": " + key + " must be a string");
    for (const key of ["must", "must_not"]) {
      if (!(key in t)) continue;
      const patterns = t[key];
      if (!Array.isArray(patterns) || !patterns.every((p) => typeof p === "string")) {
        problems.push(where + ": " + key + " must be a string array");
        continue;
      }
      for (const pattern of patterns as string[]) {
        try {
          new RegExp(pattern);
        } catch {
          problems.push(where + ": " + key + " pattern /" + pattern + "/ does not compile");
        }
      }
    }
    if ("safety" in t && typeof t.safety !== "boolean") problems.push(where + ": safety must be a boolean");
    if (!("must" in t) && !("check" in t)) problems.push(where + ": needs must or check, or nothing can fail it");
    if (typeof t.setup === "string" && t.setup.includes("seed.sh") && !existsSync(join(dir, "seed.sh"))) problems.push(where + ": setup runs seed.sh but it is missing");
  }
  return problems;
}

export function readTasks(file: string): TasksFile {
  const path = resolve(file);
  const dir = dirname(path);
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch (error) {
    return { path, dir, sha256: null, count: 0, problems: ["cannot read the tasks file: " + (error as Error).message], tasks: [], entries: null };
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    return { path, dir, sha256, count: 0, problems: ["not valid JSON: " + (error as Error).message], tasks: [], entries: null };
  }
  const problems = checkTasks(parsed, dir);
  const array: unknown[] = Array.isArray(parsed) ? parsed : [];
  const entries = Array.isArray(parsed) ? array.filter((t): t is Record<string, unknown> => typeof t === "object" && t !== null && !Array.isArray(t)) : null;
  return { path, dir, sha256, count: array.length, problems, tasks: problems.length ? [] : (array as ContractTask[]), entries };
}
