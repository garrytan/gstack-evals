// Copyright (c) 2026 Garry Tan. MIT License.
// Source A (prereg section 4, amendment section 1): R3 none-arm sessions from run bundles, with the provenance gate,
// the first-message rebuild, block-type inference, the drops and the final-text cut.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { CLOSING_LINES } from "../../../quick/laneb/runner/grid.ts";
import { fail } from "../errors.ts";
import type { AssembleResult, History, HistoryEvent, Io } from "../types.ts";
import { historySha256, refuseOutsideRules } from "./events.ts";

const REPO = join(import.meta.dir, "../../..");
const WRAPPER_PATH = "quick/laneb/runner/prompt-wrapper.md";
const PERSONA_PATH = "quick/laneb/runner/agent/persona.json";
/** The trial files the assembler reads, relative to the trial directory. */
export const TRIAL_FILES = ["result.json", "lock.json", "verifier/report.json", "artifacts/logs/artifacts/model.patch", "evaluator/sdk-messages.jsonl", "evaluator/usersim-events.jsonl"];
/** Drop reasons in the order the first one is reported; parseSession returns every reason that applies. */
const DROP_ORDER = ["compaction", "continuation", "subagent", "no_result", "no_final_report", "unpaired_tool_use"];

const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
type Work = HistoryEvent extends infer E ? (E extends HistoryEvent ? Omit<E, "n"> : never) : never;
type Rec = Record<string, any>;

/** One trial's files, as read from a bundle (rel path to text), and the gate's inputs. */
export interface TrialFiles {
  files: Map<string, string>;
  /** sha256 of the task directory the trial ran (held tier) or rebuilt from the pinned export (rebuild tier), or null. */
  taskTreeDigest: string | null;
  instruction: string | null;
  wrapper: { text: string; sha256: string };
  persona: { sha256: string };
  manifest: { wrapper_sha256: string; persona_sha256: string } | null;
  /** The commit time of the last change to the wrapper and persona in the repo (B0's second basis). */
  runnerUnchangedSince: string | null;
}

function jsonFile(files: Map<string, string>, rel: string): Rec | null {
  const text = files.get(rel);
  if (text === undefined) return null;
  try {
    return JSON.parse(text);
  } catch {
    return fail("E_TBV_INPUT", rel + " is not JSON");
  }
}
function jsonLines(text: string, what: string): Rec[] {
  return text.split("\n").flatMap((line, i) => {
    if (!line.trim()) return [];
    try {
      return [JSON.parse(line)];
    } catch {
      return fail("E_TBV_INPUT", what + " line " + (i + 1) + " is not JSON");
    }
  });
}

export function assembleA(trial: TrialFiles): AssembleResult {
  if (sha(trial.wrapper.text) !== trial.wrapper.sha256) fail("E_TBV_INPUT", "the wrapper text does not match its sha256 " + trial.wrapper.sha256);
  const result = jsonFile(trial.files, "result.json");
  if (!result || typeof result.task_name !== "string") return fail("E_TBV_INPUT", "the trial has no result.json with a task_name");
  if (typeof result.trial_name !== "string" || !result.trial_name.includes("__")) return fail("E_TBV_INPUT", "the trial's result.json has no trial_name (<task>__<trial id>) to tell its session from another of the same task");
  const task: string = result.task_name + "__" + result.trial_name.split("__").at(-1);
  const kwargs: Rec = result.config?.agent?.kwargs ?? {};
  const drop = (reason: string, detail: string): AssembleResult => ({ ok: false, drop: reason, detail: task + ": " + detail });

  if (kwargs.arm !== "none" || kwargs.told_skill) return drop("not_none_arm", "arm " + JSON.stringify(kwargs.arm) + (kwargs.told_skill ? " told " + kwargs.told_skill : ""));
  const digest = jsonFile(trial.files, "lock.json")?.task?.digest ?? null;
  if (trial.taskTreeDigest === null || trial.instruction === null) return drop("task_dir_missing", "no task directory to check against lock.json's digest");
  if (digest !== trial.taskTreeDigest) return drop("task_digest", "the task directory's digest does not equal lock.json's");
  if (trial.manifest) {
    if (trial.manifest.wrapper_sha256 !== trial.wrapper.sha256 || trial.manifest.persona_sha256 !== trial.persona.sha256) return drop("wrapper_persona", "the part manifest's wrapper or persona sha256 differs from the repo's");
  } else {
    const since = trial.runnerUnchangedSince === null ? Number.NaN : Date.parse(trial.runnerUnchangedSince);
    if (!(Date.parse(result.started_at) > since)) return drop("wrapper_persona", "no manifest, and the wrapper and persona did not stand unchanged in the repo before the trial started");
  }
  const instructionSha = sha(trial.instruction);
  for (const p of jsonLines(trial.files.get("evaluator/usersim-events.jsonl") ?? "", "usersim-events.jsonl")) {
    if (p.event !== "prompt") continue;
    if (p.wrapper_sha256 !== trial.wrapper.sha256 || p.instruction_sha256 !== instructionSha || (p.told_skill ?? "") !== "" || (p.closing_line ?? "") !== (kwargs.closing_line ?? ""))
      return drop("prompt_mismatch", "the trial's prompt record does not match the wrapper, the instruction or the arm");
  }

  const log = trial.files.get("evaluator/sdk-messages.jsonl");
  if (log === undefined) return drop("no_sdk_log", "no evaluator/sdk-messages.jsonl");
  const session = parseSession(log);
  if (session.drops.length) return drop(session.drops[0], "drops " + session.drops.join(", "));

  const events: HistoryEvent[] = [{ n: 1, kind: "user-text", text: buildFirstMessage(trial.wrapper.text, trial.instruction, kwargs) }, ...session.work.map((w, i) => ({ n: i + 2, ...w }) as HistoryEvent)];
  for (const e of events) {
    const text = e.kind === "tool-use" ? e.name + " " + JSON.stringify(e.input) : e.kind === "tool-result" ? e.content : e.text;
    refuseOutsideRules(text, task + " event " + e.n);
  }
  const patch = trial.files.get("artifacts/logs/artifacts/model.patch") ?? null;
  const report = jsonFile(trial.files, "verifier/report.json");
  const verdict = report && Object.keys(report).length === 1 ? Object.values(report)[0] : report;
  const history: History = {
    schema: "tbv-history.v1",
    source: "A",
    task,
    cluster: result.task_name,
    family: "investigate",
    events,
    sha256: historySha256(events),
    side: { files: [...new Set([...(patch ?? "").matchAll(/^diff --git a\/(\S+) b\//gm)].map((m) => m[1]))], resolved: report === null ? null : Boolean(verdict?.resolved), patch },
  };
  return { ok: true, history };
}

/** The first user message as quick/laneb/runner/agent/prompt_builder.py's build_prompt composes it for a none arm. */
export function buildFirstMessage(wrapper: string, instruction: string, kwargs: Record<string, unknown>): string {
  if (kwargs.told_skill || kwargs.procedure_line) fail("E_TBV_INPUT", "a none arm's prompt has no told skill and no procedure line");
  let prompt = wrapper.split("{instruction}").join(instruction);
  const key = kwargs.closing_line;
  if (key) {
    if (typeof key !== "string" || !Object.hasOwn(CLOSING_LINES, key)) return fail("E_TBV_INPUT", "closing_line " + JSON.stringify(key) + " is not one of " + Object.keys(CLOSING_LINES).join(", "));
    prompt += (prompt.endsWith("\n") ? "\n" : "\n\n") + CLOSING_LINES[key as keyof typeof CLOSING_LINES] + "\n";
  }
  return prompt;
}

function textOf(c: unknown): string {
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map(textOf).join("\n");
  if (c && typeof c === "object") return textOf((c as Rec).text || (c as Rec).content || "");
  return "";
}

/** One SDK log (evaluator/sdk-messages.jsonl): every drop reason, the work up to the last tool result, and the session's own report. */
export function parseSession(lines: string): { drops: string[]; work: Work[]; report: string } {
  const msgs = jsonLines(lines, "sdk-messages.jsonl");
  const drops = new Set<string>();
  if (msgs.some((m) => m.type === "SystemMessage" && String(m.subtype ?? "").includes("compact"))) drops.add("compaction");
  const results = msgs.filter((m) => m.type === "ResultMessage");
  if (results.length !== 1) drops.add(results.length ? "continuation" : "no_result");
  const turns = msgs.filter((m) => m.type === "AssistantMessage" || m.type === "UserMessage");
  const tagged = turns.length > 0 && turns.every((m) => "parent_tool_use_id" in m);
  const work: Work[] = [];
  const paired = new Map<string, boolean>();
  let seenAssistant = false;
  for (const m of tagged ? turns.filter((t) => t.parent_tool_use_id == null) : turns) {
    if (m.type === "AssistantMessage") {
      seenAssistant = true;
      for (const b of Array.isArray(m.content) ? m.content : []) {
        if (!b || typeof b !== "object") continue;
        if (b.type === "tool_use" || ("id" in b && "name" in b)) {
          work.push({ kind: "tool-use", id: b.id, name: b.name, input: b.input ?? {} });
          paired.set(b.id, false);
          if ((b.name === "Agent" || b.name === "Task") && !tagged) drops.add("subagent");
        } else if (b.type === "thinking" || b.type === "redacted_thinking" || "thinking" in b || "signature" in b) continue;
        else if (typeof b.text === "string") work.push({ kind: "assistant-text", text: b.text });
      }
      continue;
    }
    if (!Array.isArray(m.content)) {
      if (seenAssistant) drops.add("continuation");
      continue;
    }
    for (const b of m.content) {
      if (b && typeof b === "object" && "tool_use_id" in b) {
        if (paired.has(b.tool_use_id)) paired.set(b.tool_use_id, true);
        else drops.add("unpaired_tool_use");
        work.push({ kind: "tool-result", tool_use_id: b.tool_use_id, content: textOf(b.content), is_error: b.is_error === true });
      } else if (seenAssistant) drops.add("continuation");
    }
  }
  if ([...paired.values()].includes(false)) drops.add("unpaired_tool_use");
  const report = String(results[results.length - 1]?.result ?? "");
  if (!report.trim()) drops.add("no_final_report");
  const lastResult = work.findLastIndex((w) => w.kind === "tool-result");
  return { drops: DROP_ORDER.filter((d) => drops.has(d)), work: work.slice(0, lastResult + 1), report };
}

/** B0's tree(): sha256 over "rel\0sha256(file)\n" lines, rel paths in byte order. */
export function treeDigestOf(files: Map<string, string>): string {
  const h = createHash("sha256");
  for (const rel of [...files.keys()].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))) h.update(rel + "\0" + files.get(rel) + "\n");
  return "sha256:" + h.digest("hex");
}
export function taskDirDigest(dir: string): string {
  const files = new Map<string, string>();
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else files.set(relative(dir, p).split(sep).join("/"), sha(readFileSync(p)));
    }
  };
  walk(dir);
  return treeDigestOf(files);
}
/** The rebuild tier's check: a task directory rebuilt from the pinned public export (the pinned Harbor's datasets download, then
 * quick/laneb/runner/materialize.ts) must have lock.json's digest. The rebuild itself needs that export and runs outside this lane. */
export function checkTaskDir(dir: string, digest: string): boolean {
  return existsSync(dir) && taskDirDigest(dir) === digest;
}

function flags(argv: string[], names: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!names.includes(argv[i]) || argv[i + 1] === undefined) fail("E_USAGE", "unknown flag or missing value: " + argv[i] + "; flags are " + names.join(" "));
    out[argv[i]] = argv[i + 1];
  }
  return out;
}

/** assemble-a --trial DIR --task-dir DIR --out FILE [--manifest FILE] [--runner-unchanged-since ISO] */
export async function run(argv: string[], io: Io): Promise<number> {
  const f = flags(argv.slice(1), ["--trial", "--task-dir", "--manifest", "--out", "--runner-unchanged-since"]);
  if (!f["--trial"] || !f["--task-dir"] || !f["--out"]) fail("E_USAGE", "assemble-a needs --trial, --task-dir and --out");
  const files = new Map<string, string>();
  for (const rel of TRIAL_FILES) if (existsSync(join(f["--trial"], rel))) files.set(rel, readFileSync(join(f["--trial"], rel), "utf8"));
  const taskDir = f["--task-dir"];
  const held = existsSync(join(taskDir, "instruction.md"));
  const wrapper = readFileSync(join(REPO, WRAPPER_PATH), "utf8");
  let since: string | null = f["--runner-unchanged-since"] ?? null;
  if (!f["--manifest"] && since === null) {
    if (Bun.spawnSync(["git", "-C", REPO, "rev-parse", "--is-shallow-repository"]).stdout.toString().trim() !== "false") fail("E_USAGE", "the repo is a shallow clone, so its history cannot date the wrapper and persona; pass --manifest or --runner-unchanged-since");
    const git = Bun.spawnSync(["git", "-C", REPO, "log", "-1", "--format=%cI", "--", WRAPPER_PATH, PERSONA_PATH]);
    since = git.exitCode === 0 && git.stdout.toString().trim() ? git.stdout.toString().trim() : null;
  }
  const r = assembleA({
    files,
    taskTreeDigest: held ? taskDirDigest(taskDir) : null,
    instruction: held ? readFileSync(join(taskDir, "instruction.md"), "utf8") : null,
    wrapper: { text: wrapper, sha256: sha(wrapper) },
    persona: { sha256: sha(readFileSync(join(REPO, PERSONA_PATH))) },
    manifest: f["--manifest"] ? JSON.parse(readFileSync(f["--manifest"], "utf8")) : null,
    runnerUnchangedSince: since,
  });
  if (!r.ok) {
    io.out("dropped " + r.drop + ": " + r.detail);
    return 0;
  }
  mkdirSync(dirname(f["--out"]), { recursive: true });
  writeFileSync(f["--out"], JSON.stringify(r.history) + "\n");
  io.out("kept " + r.history.task + " " + r.history.events.length + " events sha256 " + r.history.sha256);
  return 0;
}
