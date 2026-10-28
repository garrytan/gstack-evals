// The tasks.ext.json sidecar: everything gstack-evals adds to a contract task, keyed by task id and kept beside the
// tasks file, so gstack's free test never sees an unknown key (interface v0.4, "Sidecar"). No part of it enters the
// agent container.
//
// {schema_version: 1, tasks: {<id>: {user?, interactive?, judge?, timeout_s?, env?, paths?, mutant?, hidden?}}}
// - user: {persona?, replies?: {<category>: text}}, replies keyed by the classifier's categories; user implies interactive.
// - interactive: the task expects questions. Interactivity is declared here, never inferred from the skill text.
// - judge: a rubric that sends the task's runs to blinded adjudication.
// - timeout_s: a positive whole number of seconds. env: names of fixture variables passed through to the trial.
// - paths: relative paths that narrow the grader's import of the agent's filesystem delta.
// - mutant: {setup, answer?}, a violating control for a safety task: setup runs after the task's setup and commits the
//   violation, answer is a violating final answer (empty when absent). Preflight's vacuity check reads it.
// - hidden: the task runs evaluator-side only.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { CATEGORY_NAMES, isCategory, type Category } from "../../usersim/classifier.ts";
import { FIXTURES_VAR, readTasks, type TasksFile } from "./tasks.ts";

export const SIDECAR_FILE = "tasks.ext.json";
export const SIDECAR_SCHEMA_VERSION = 1;
export const SIDECAR_KEYS: readonly string[] = ["user", "interactive", "judge", "timeout_s", "env", "paths", "mutant", "hidden"];

export interface UserScript {
  persona?: string;
  replies?: Partial<Record<Category, string>>;
}

export interface Mutant {
  setup: string;
  answer?: string;
}

export interface SidecarTask {
  user?: UserScript;
  interactive?: boolean;
  judge?: string;
  timeout_s?: number;
  env?: string[];
  paths?: string[];
  mutant?: Mutant;
  hidden?: boolean;
}

export interface Sidecar {
  schema_version: 1;
  tasks: Record<string, SidecarTask>;
}

export interface SidecarFile {
  path: string;
  sha256: string | null;
  problems: string[];
  /** The sidecar, only when problems is empty. */
  sidecar: Sidecar | null;
}

/** Variables the trial sets itself; a task's env may not pass its own value for them. */
export const HARNESS_ENV: readonly string[] = ["PATH", "HOME", "LANG", "TERM", "GSTACK_STATE_ROOT", "GSTACK_HOME", FIXTURES_VAR];

/** Credentials and host or provider settings stay with the harness: the provider key lives only in the metering proxy. */
const HARNESS_OWNED = /API_?KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|^(ANTHROPIC|OPENAI|OPENROUTER|CLAUDE|CODEX)_/i;

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const isInteractive = (entry: SidecarTask | undefined): boolean => entry?.interactive === true || entry?.user !== undefined;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

function unknownKeys(where: string, value: Record<string, unknown>, keys: readonly string[]): string[] {
  return Object.keys(value).filter((k) => !keys.includes(k)).map((k) => where + ": unknown key " + k);
}

function checkUser(where: string, user: unknown): string[] {
  if (!isObject(user)) return [where + ": user must be an object with persona and replies"];
  const problems = unknownKeys(where + " user", user, ["persona", "replies"]);
  if (!("persona" in user) && !("replies" in user)) problems.push(where + ": user needs a persona or replies");
  if ("persona" in user && !nonEmpty(user.persona)) problems.push(where + ": user.persona must be a non-empty string");
  if (!("replies" in user)) return problems;
  if (!isObject(user.replies)) return [...problems, where + ": user.replies must be an object keyed by question category"];
  for (const [category, reply] of Object.entries(user.replies)) {
    if (!isCategory(category)) problems.push(where + ": user.replies has unknown category " + category + " (categories: " + CATEGORY_NAMES.join(", ") + ")");
    else if (!nonEmpty(reply)) problems.push(where + ": user.replies." + category + " must be a non-empty string");
  }
  return problems;
}

function checkNames(where: string, key: "env" | "paths", value: unknown): string[] {
  if (!Array.isArray(value) || !value.every(nonEmpty)) return [where + ": " + key + " must be an array of non-empty strings"];
  const problems: string[] = [];
  if (new Set(value).size !== value.length) problems.push(where + ": " + key + " repeats an entry");
  for (const item of value) {
    if (key === "env") {
      if (!ENV_NAME.test(item)) problems.push(where + ": env name " + item + " is not a variable name");
      else if (HARNESS_ENV.includes(item)) problems.push(where + ": env name " + item + " is set by the trial itself");
      else if (HARNESS_OWNED.test(item)) problems.push(where + ": env name " + item + " looks like a credential or a host setting; those stay with the harness and the metering proxy");
    } else if (isAbsolute(item) || item.split(/[\\/]/).includes("..")) problems.push(where + ": path " + item + " must be relative to the work dir, without ..");
  }
  return problems;
}

/** Problems in a parsed sidecar, checked against the entries of the tasks file it extends. */
export function checkSidecar(parsed: unknown, tasks: readonly Record<string, unknown>[]): string[] {
  if (!isObject(parsed)) return ["must be a JSON object {schema_version, tasks}"];
  const problems = unknownKeys("sidecar", parsed, ["schema_version", "tasks"]);
  if (parsed.schema_version !== SIDECAR_SCHEMA_VERSION) problems.push("schema_version must be " + SIDECAR_SCHEMA_VERSION);
  if (!isObject(parsed.tasks)) return [...problems, "tasks must be an object keyed by task id"];
  const byId = new Map(tasks.flatMap((t) => (typeof t.id === "string" ? [[t.id, t] as const] : [])));
  for (const [id, entry] of Object.entries(parsed.tasks)) {
    const task = byId.get(id);
    if (!task) problems.push(id + ": no task with this id in the tasks file");
    if (!isObject(entry)) {
      problems.push(id + ": entry must be an object");
      continue;
    }
    problems.push(...unknownKeys(id, entry, SIDECAR_KEYS));
    if ("user" in entry) problems.push(...checkUser(id, entry.user));
    if ("interactive" in entry && typeof entry.interactive !== "boolean") problems.push(id + ": interactive must be a boolean");
    if (entry.interactive === false && "user" in entry) problems.push(id + ": user implies interactive; drop interactive: false");
    if ("judge" in entry && !nonEmpty(entry.judge)) problems.push(id + ": judge must be a non-empty rubric");
    if ("timeout_s" in entry && !(Number.isInteger(entry.timeout_s) && (entry.timeout_s as number) > 0)) problems.push(id + ": timeout_s must be a positive whole number");
    if ("env" in entry) problems.push(...checkNames(id, "env", entry.env));
    if ("paths" in entry) problems.push(...checkNames(id, "paths", entry.paths));
    if ("hidden" in entry && typeof entry.hidden !== "boolean") problems.push(id + ": hidden must be a boolean");
    if (!("mutant" in entry)) continue;
    const mutant = entry.mutant;
    if (!isObject(mutant)) {
      problems.push(id + ": mutant must be an object {setup, answer}");
      continue;
    }
    problems.push(...unknownKeys(id + " mutant", mutant, ["setup", "answer"]));
    if (!nonEmpty(mutant.setup)) problems.push(id + ": mutant.setup must be a non-empty shell step");
    if ("answer" in mutant && typeof mutant.answer !== "string") problems.push(id + ": mutant.answer must be a string");
    if (task && task.safety !== true) problems.push(id + ": mutant is read only for safety tasks; mark the task safety: true or drop the mutant");
  }
  return problems;
}

export function readSidecar(file: string, tasks: readonly Record<string, unknown>[]): SidecarFile {
  const path = resolve(file);
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch (error) {
    return { path, sha256: null, problems: ["cannot read the sidecar: " + (error as Error).message], sidecar: null };
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    return { path, sha256, problems: ["not valid JSON: " + (error as Error).message], sidecar: null };
  }
  const problems = checkSidecar(parsed, tasks);
  return { path, sha256, problems, sidecar: problems.length ? null : (parsed as Sidecar) };
}

export interface Contract {
  tasks: TasksFile;
  /** null when no sidecar was named and none sits beside the tasks file. */
  ext: SidecarFile | null;
  ok: boolean;
}

/**
 * Reads a tasks file and its sidecar: the one extFile names, or tasks.ext.json beside the tasks file when it exists.
 * The sidecar is checked against every entry of the tasks file, so a broken tasks file still gets its sidecar checked.
 */
export function loadContract(tasksFile: string, extFile?: string): Contract {
  const tasks = readTasks(tasksFile);
  const sibling = join(dirname(tasks.path), SIDECAR_FILE);
  const extPath = extFile ?? (existsSync(sibling) ? sibling : null);
  const ext = extPath === null ? null : readSidecar(extPath, tasks.entries);
  return { tasks, ext, ok: tasks.problems.length === 0 && (ext === null || ext.problems.length === 0) };
}
