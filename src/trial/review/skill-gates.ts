// The hook-enforced /plan-ceo-review arm (gstack-enforced, analysis name enforced; the CEO outcome eval's stage 2
// amendment, section 3.3, with the Captain's ruling B1). gstack 4743132 installed by its own setup, the gate switched on in
// the arm's gstack config, and these parts beside it:
// - Hooks: at session start the Claude Code driver runs the session's own gstack-skill-gates settings --ceo-review inside
//   the session sandbox, so the hook paths are the ones the session sees, and gateSettings raises the two ceo-review shims'
//   timeout from 10 to 30 seconds and changes nothing else (B1: under a 10 s shim timeout the frozen 20,000 ms gate
//   deadline could never govern). The settings reach the session as the Agent SDK's settings option. setup registers no
//   gate hook of its own: the switch lives in the trial's state root config, which setup never reads at install.
// - Env: GSTACK_SKILL_GATE_DEADLINE_MS=20000 in the agent env, frozen with the arm. GSTACK_CEO_REVIEW_OUTPUT stays unset.
// - Key and provenance: GATE_KEY (the settings command, the 30 s shim timeout as a named deviation and the deadline) joins
//   the session key and arm.json's arm_provenance. The printed settings' sha256 is known only once the session prints them,
//   after the key is computed, so it is recorded in trial.json's gate, not in the key.
// - Record (gateRecord): before the work dir is removed, $GSTACK_STATE_ROOT/skill-gates/<session id>/ is copied byte for
//   byte to <session dir>/host/skill-gates/<session id>/, failures in logs.copy_out prefixed "skill-gates: ". Then
//   gstack-skill-gates report --session <id> --expect armed --json runs from the arm's 4743132 tree with GSTACK_STATE_ROOT
//   at a scratch root holding a second copy, so the stored copy is never touched. trial.json's gate holds the session id
//   (the transcript's system init message's session_id), the report's exit, JSON and stderr, the deadline, the shim timeout
//   and the printed settings' sha256. No session id, or a failed copy, leaves exit null.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { STATE_ROOT_DIR } from "../state-root.ts";

export const ENFORCED_ARM = "gstack-enforced";
export const ENFORCED_GSTACK_SHA = "4743132ca027d487fb02bb5f8ce94f2816ff8e7c";
/** The enforced arm's gstack config, beside the cell's agent_model and codex_reviews: the /plan-ceo-review gate on. */
export const GATE_CONFIG: Readonly<Record<string, string>> = { ceo_review_gate: "on" };
export const GATE_HOOK_TIMEOUT_S = 30;
export const GATE_DEADLINE_MS = 20_000;
export const GATE_SETTINGS_ARGS = ["settings", "--ceo-review"] as const;
const SHIMS = ["ceo-review-gate-stop", "ceo-review-gate-subagent-stop"] as const;
/** What the enforced arm freezes beside its tree, in the session key and arm_provenance. */
export const GATE_KEY = { settings: "gstack-skill-gates " + GATE_SETTINGS_ARGS.join(" "), hook_timeout_s: GATE_HOOK_TIMEOUT_S, deadline_ms: GATE_DEADLINE_MS } as const;

export interface Gate {
  session_id: string | null;
  exit: number | null;
  json: unknown;
  stderr: string;
  deadline_ms: number;
  hook_timeout_s: number;
  settings_sha256: string | null;
}

export const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

/** The printed settings with both ceo-review shims' timeout at GATE_HOOK_TIMEOUT_S and nothing else changed, or why they can't be used. */
export function gateSettings(printed: string): Record<string, unknown> | string {
  let settings: { hooks?: Record<string, unknown> };
  try {
    settings = JSON.parse(printed);
  } catch {
    return "the printed settings are not JSON";
  }
  const raised: string[] = [];
  for (const groups of Object.values(settings?.hooks ?? {})) {
    for (const group of Array.isArray(groups) ? groups : []) {
      for (const hook of Array.isArray(group?.hooks) ? group.hooks : []) {
        const command = typeof hook?.command === "string" ? hook.command.replace(/"$/, "") : "";
        const shim = SHIMS.find((s) => command.endsWith("/" + s));
        if (!shim) continue;
        hook.timeout = GATE_HOOK_TIMEOUT_S;
        raised.push(shim);
      }
    }
  }
  if (raised.length !== SHIMS.length || SHIMS.some((s) => !raised.includes(s))) return "the printed settings register " + (raised.join(", ") || "no ceo-review shim") + ", not one " + SHIMS.join(" and one ") + " hook";
  return settings as Record<string, unknown>;
}

/** The session_id of the transcript's first main-agent system init message, or null. */
export function initSessionId(transcript: string): string | null {
  for (const line of transcript.split("\n")) {
    let m: { type?: unknown; subtype?: unknown; parent_tool_use_id?: unknown; session_id?: unknown };
    try {
      m = JSON.parse(line);
    } catch {
      continue;
    }
    if (m?.type === "system" && m.subtype === "init" && !m.parent_tool_use_id) return typeof m.session_id === "string" && m.session_id ? m.session_id : null;
  }
  return null;
}

/** Copies the tree at from to to, regular files and directories only; returns one line per entry it could not copy. */
function copyTree(from: string, to: string, rel = ""): string[] {
  let entries;
  try {
    mkdirSync(join(to, rel), { recursive: true });
    entries = readdirSync(join(from, rel), { withFileTypes: true });
  } catch (e) {
    return [String(e)];
  }
  return entries.flatMap((e) => {
    const path = join(rel, e.name);
    if (e.isDirectory()) return copyTree(from, to, path);
    if (!e.isFile()) return [join(from, path) + " is not a regular file or directory, so it was not copied"];
    try {
      copyFileSync(join(from, path), join(to, path));
      return [];
    } catch (err) {
      return [String(err)];
    }
  });
}

/**
 * Copies the session's gate record out of the work dir to <host>/skill-gates/<session id>/ and runs the report from the
 * gstack tree at gstack against a scratch copy. A record directory that does not exist is no failure (the gate never
 * fired, and the report says so); a symlink on the way to it, or an entry that cannot be copied, is.
 */
export function gateRecord(o: { work: string; host: string; gstack: string; settingsSha256: string | null }): { copy_out: string[]; gate: Gate } {
  const gate: Gate = { session_id: null, exit: null, json: null, stderr: "", deadline_ms: GATE_DEADLINE_MS, hook_timeout_s: GATE_HOOK_TIMEOUT_S, settings_sha256: o.settingsSha256 };
  let transcript = "";
  try {
    transcript = readFileSync(join(o.host, "transcript.ndjson"), "utf8");
  } catch {
    transcript = "";
  }
  const id = initSessionId(transcript);
  gate.session_id = id;
  if (id === null) return { copy_out: [], gate };
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return { copy_out: ["skill-gates: session id " + JSON.stringify(id) + " is not a record directory name"], gate };
  let from: string | null = o.work;
  for (const part of [STATE_ROOT_DIR, "skill-gates", id]) {
    const at: string = join(from!, part);
    const st = lstatSync(at, { throwIfNoEntry: false });
    if (!st) {
      from = null;
      break;
    }
    if (!st.isDirectory()) return { copy_out: ["skill-gates: " + at + " is not a directory" + (st.isSymbolicLink() ? " (a symlink)" : "") + ", so the record was not copied"], gate };
    from = at;
  }
  const failures = from ? copyTree(from, join(o.host, "skill-gates", id)) : [];
  if (failures.length) return { copy_out: failures.map((f) => "skill-gates: " + f), gate };
  const scratch = mkdtempSync(join(tmpdir(), "gse-gates-"));
  try {
    const copied = from ? copyTree(join(o.host, "skill-gates", id), join(scratch, "skill-gates", id)) : [];
    if (copied.length) return { copy_out: copied.map((f) => "skill-gates: scratch copy: " + f), gate };
    const r = spawnSync(process.execPath, ["--no-env-file", "--config=/dev/null", join(o.gstack, "bin", "gstack-skill-gates"), "report", "--session", id, "--expect", "armed", "--json"], { cwd: scratch, env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: scratch, LANG: "C.UTF-8", GSTACK_STATE_ROOT: scratch }, encoding: "utf8", timeout: 60_000 });
    gate.exit = r.status;
    gate.stderr = (r.stderr ?? "") + (r.error ? String(r.error.message) : "");
    try {
      gate.json = JSON.parse(r.stdout ?? "");
    } catch {
      gate.json = null;
    }
    return { copy_out: [], gate };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
