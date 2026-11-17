// Copyright (c) 2026 Garry Tan. MIT License.
// One session attempt of the day-one eval on the Docker rig (prereg section 7), beside the office-hours founder lane's
// launch and reusing the same parts: the rig's metered slots (dockerRig), one trial per attempt (runTrial) and the
// Claude Code driver.
// - Every session: the claude-code-preset system prompt, a 200,000-token window, cap stops on, WebSearch, WebFetch and
//   AskUserQuestion denied, CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1 (the driver's), and the stage's minutes, turns and
//   allowance (frozen.ts LIMITS). The work dir is a fresh git repository seeded for the stage (units.ts), seen at
//   /work/app; the checker's is empty.
// - Planning sessions take the owner loop (owner.ts) as nextUser. Builds and checks take a loop that ends the session
//   at its first reply.
// - Planning sessions of every arm hold (pin change 2, item B): when a turn ends with background work the session started
//   still running, the driver keeps the session open for it, in all at most the session's minutes. A session that
//   reaches that limit while held is a gap row, E_DAYONE_BACKGROUND, with no retry. Builds and checks do not hold.
// - gstack arms: the arm's gstack at its pin, a fresh state root copied out to host/gstack-state, GSTACK_SESSION_KIND
//   unattended, and GPT-6 Astra as the Codex voice on its own slot (C2): its own meter and allowance, OPENAI_API_KEY in the
//   container set to that slot's bearer and never the provider key, and GSTACK_CODEX_NO_SANDBOX=1. Every other arm has
//   no state root, no gstack and no voice.
// - Builds see the node volume at NODE_DIR with node on PATH. Checks get the browser container's MCP server as their one
//   MCP server and may call only BROWSER_TOOLS.
// - Containment: each container is probed just before it stops (the founder lane's probe). A departure is a key-like
//   env name other than the session's bearers (ANTHROPIC_AUTH_TOKEN, and OPENAI_API_KEY on a gstack arm, whose value
//   must equal the voice slot's bearer), or a mount other than the work dir, HOME and, on builds, the node volume. The
//   bearer reaches that comparison on the exec's stdin, never in its arguments.
// - The work tree is copied out to out/ after the session, and plan.md is read from there.
// - The gstack-read check (section 8) runs on N, D and R planning sessions only, and counts their skill loads (exposure.ts
//   loadedSkills) with their gstack reads: a build or check session that names gstack while it reads an /autoplan plan
//   has not read gstack.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, posix } from "node:path";
import { claudeCodeDriver, type ClaudeProvider, type NextUser } from "../../src/adapters/claude-code/driver.ts";
import type { ReasonCode } from "../../src/errors/codes.ts";
import { armNamespaces, type HostRig } from "../../src/skill-eval/cli/run-host.ts";
import { providerOf, type LoadedPolicy } from "../../src/skill-eval/cli/policy.ts";
import { STATE_ROOT_DIR } from "../../src/trial/state-root.ts";
import type { ReadOnlyMount, Sandbox } from "../../src/trial/sandbox.ts";
import { runTrial } from "../../src/trial/trial.ts";
import type { Termination } from "../../src/types.ts";
import { webUses } from "../product-value/parse.ts";
import { readTranscript } from "../../src/trial/review/readers.ts";
import { gstackReads, probe, type Probe } from "../office-hours-founder/run/contain.ts";
import { NODE_BIN, NODE_DIR, RAM_SIZE } from "./app.ts";
import { loadedSkills } from "./exposure.ts";
import { PLAN_ARMS, SYSTEM_PROMPT } from "./frozen.ts";

/** The gstack arms' state root config: readers on the session's model, the Codex voice on. */
export const GSTACK_CONFIG: Readonly<Record<string, string>> = { agent_model: "host", codex_reviews: "enabled" };

/** The task id every session runs under, so the path the agent sees (/work/app) names no unit, arm or model. */
export const TASK = "app";
const PATH = "/usr/local/bin:/usr/bin:/bin";

/** The browser tools a checker may call: what a person does in a browser, never page scripts or network reads. */
export const BROWSER_SERVER = "browser";
/** Prints each RAM-backed mount with under 1 MiB free; any output means it filled. */
export const RAM_FULL_CHECK = "df -Pk /home/agent /tmp | awk 'NR > 1 && $4 < 1024 { print $6 }'";
/** Reads the voice slot's bearer from stdin and compares it with the container's OPENAI_API_KEY, so no form of it is in an exec argument. */
export const VOICE_BEARER_CHECK = 'IFS= read -r t && [ -n "$t" ] && [ "$OPENAI_API_KEY" = "$t" ] && echo voice-bearer';
export const BROWSER_TOOLS: readonly string[] = ["browser_navigate", "browser_navigate_back", "browser_snapshot", "browser_click", "browser_type", "browser_fill_form", "browser_select_option", "browser_press_key", "browser_hover", "browser_drag", "browser_drop", "browser_file_upload", "browser_handle_dialog", "browser_tabs", "browser_wait_for", "browser_take_screenshot", "browser_resize", "browser_find"].map((t) => "mcp__" + BROWSER_SERVER + "__" + t);

export interface LaunchInput {
  rig: HostRig;
  policy: LoadedPolicy;
  docker: string;
  runId: string;
  /** The rig's arm name: a planning arm, "build" or "check". */
  arm: string;
  /** The cell's task label: unit, replicate and stage, never shown to the agent. */
  cell: string;
  rep: number;
  attempt: number;
  model: string;
  dir: string;
  /** The work repository to seed, or null for an empty work dir. */
  seed: string | null;
  prompt: string;
  minutes: number;
  turns: number;
  allowanceMicros: number;
  nextUser: (texts: string[]) => Promise<NextUser>;
  /** gstack arms: the skill, the voice model and its slot's allowance; the state root gets agent_model host and codex_reviews enabled. */
  gstack?: { skill: string; voiceModel: string; voiceMicros: number };
  /** Builds: the node volume's name. */
  nodeVolume?: string;
  /** Checks: the browser container's MCP URL. */
  mcpUrl?: string;
  /** Planning sessions: held open while background work the session started still runs, up to the session's minutes. */
  hold?: true;
}

export interface AttemptRead {
  termination: Termination;
  web: number;
  /** N, D and R planning sessions: each gstack read and each skill load (section 8); empty on every other session. */
  gstack_reads: string[];
  /** Containment departures; null when the probe could not run. */
  contained: string[] | null;
  micros: number;
  voice: { micros: number; requests: number; refused: number } | null;
  /** The copied work tree, or null when the copy failed. */
  out: string | null;
}

const D = 1_000_000;

/** One attempt on the Docker rig; deps swap the driver and the trial for keyless tests of the session's setup. */
export async function launchSession(o: LaunchInput, deps: { driver?: typeof claudeCodeDriver; trial?: typeof runTrial } = {}): Promise<AttemptRead> {
  const provider = providerOf(o.policy, o.model) as ClaudeProvider;
  const none: AttemptRead = { termination: { kind: "infra", incident: "" }, web: 0, gstack_reads: [], contained: [], micros: 0, voice: null, out: null };
  const cell = { run_id: o.runId, arm: o.arm, task: o.cell, model: o.model, trial: o.rep, attempt: o.attempt };
  let binding: Awaited<ReturnType<HostRig["bind"]>>;
  let voice: Awaited<ReturnType<HostRig["bind"]>> | null = null;
  try {
    binding = await o.rig.bind({ cell, models: [provider + ":" + o.model], allowance_micros: o.allowanceMicros });
    if (o.gstack) voice = await o.rig.bind({ cell: { ...cell, arm: o.arm + "-voice" }, models: ["openai:" + o.gstack.voiceModel], allowance_micros: o.gstack.voiceMicros });
  } catch (e) {
    return { ...none, termination: { kind: "infra", incident: "the proxy refused a slot: " + (e as Error).message } };
  }
  writeFileSync(join(o.dir, "meter.json"), JSON.stringify({ meter_id: binding.meter_id, voice_meter_id: voice?.meter_id ?? null, lease_id: o.rig.recovery?.lease_id ?? null, journal: o.rig.recovery?.journal ?? null }) + "\n");
  const base = o.rig.sandbox(o.arm, false, o.model);
  const home = base.homePath(o.dir);
  const mounts: ReadOnlyMount[] = o.nodeVolume ? [{ host: o.nodeVolume, path: NODE_DIR }] : [];
  let found: Probe | null = null;
  let tokenOk: boolean | null = null;
  let ramFull: string | null = null;
  const sandbox: Sandbox = {
    ...base,
    agent(task, opts) {
      const session = base.agent(task, { ...opts, ram: { size: RAM_SIZE } });
      let done = false;
      return {
        ...session,
        stop() {
          if (!done) {
            done = true;
            const full = session.exec(RAM_FULL_CHECK, 30_000).stdout.trim();
            if (full) ramFull = full.split("\n").join(", ");
            found = probe(session, o.docker, [base.workPath(opts.work, task, opts.root), home, ...mounts.map((m) => m.path)]);
            if (voice) {
              const r = session.exec(VOICE_BEARER_CHECK, 30_000, voice.token + "\n");
              tokenOk = r.exitCode === 0 && !r.timedOut && r.stdout.trim() === "voice-bearer";
            }
          }
          session.stop();
        },
      };
    },
  };
  const install = o.rig.arms[o.arm]!;
  const skill = o.gstack && install.skill ? { name: o.gstack.skill, roots: install.skill.roots.map((r) => posix.join(home, r)), home, dir: install.skill.dir, namespaces: armNamespaces(install) } : null;
  const agent = (deps.driver ?? claudeCodeDriver)({
    model: o.model,
    provider,
    proxy: { baseUrl: o.rig.baseUrl, slot: binding.slot, token: binding.token },
    skill,
    out: join(o.dir, "host"),
    systemPrompt: SYSTEM_PROMPT,
    maxTurns: o.turns,
    capStops: true,
    disable1mContext: true,
    denyAsk: true,
    nextUser: o.nextUser,
    ...(o.hold ? { backgroundWaitMs: o.minutes * 60_000 } : {}),
    ...(o.gstack && voice ? { sessionKind: "unattended" as const, codex: { provider: "openai" as const, model: o.gstack.voiceModel, proxy: { slot: voice.slot, token: voice.token } }, codexNoSandbox: true } : {}),
    ...(o.mcpUrl ? { mcpServers: { [BROWSER_SERVER]: { type: "http" as const, url: o.mcpUrl } }, onlyTools: BROWSER_TOOLS } : {}),
  });
  if (o.nodeVolume) agent.env = { ...agent.env, PATH: PATH + ":" + NODE_BIN };
  mkdirSync(join(o.dir, "tasks"), { recursive: true });
  const out = join(o.dir, "out");
  let termination: Termination;
  let copyFailed = false;
  try {
    const trial = await (deps.trial ?? runTrial)({
      cell: { model: o.model, arm: o.arm, round: 1, trial: o.rep },
      task: { id: TASK, prompt: o.prompt },
      tasksDir: join(o.dir, "tasks"),
      sandbox,
      agent,
      dir: o.dir,
      timeoutS: o.minutes * 60,
      network: o.rig.network,
      ...(o.seed ? { seed: o.seed } : {}),
      ...(mounts.length ? { mounts } : {}),
      ...(o.gstack ? { copyDir: { from: STATE_ROOT_DIR, to: join(o.dir, "host", "gstack-state") }, stateConfig: GSTACK_CONFIG } : { stateRoot: false as const }),
      copyDirs: [{ from: ".", to: out }],
    });
    termination = trial.record.termination;
    const trialJson = join(o.dir, "trial.json");
    const copyOut = existsSync(trialJson) ? JSON.parse(readFileSync(trialJson, "utf8")).logs?.copy_out : null;
    copyFailed = Array.isArray(copyOut) && copyOut.some((f) => String(f).startsWith(".: "));
  } catch (e) {
    termination = { kind: "infra", incident: "the trial failed: " + (e as Error).message };
  }
  if (ramFull) termination = { kind: "infra", incident: "the session's RAM-backed " + ramFull + " filled (" + RAM_SIZE + ")" };
  const meter = await o.rig.finalize(binding.meter_id);
  const vmeter = voice ? await o.rig.finalize(voice.meter_id) : null;
  let transcript = "";
  try {
    transcript = readFileSync(join(o.dir, "host", "transcript.ndjson"), "utf8");
  } catch {
    transcript = "";
  }
  const p = found as Probe | null;
  const departures = p ? [...p.keys.filter((k) => !(voice && k === "OPENAI_API_KEY")).map((k) => "env name " + k), ...p.mounts.map((m) => "mount " + m), ...(p.egress.open ? ["open egress (" + p.egress.detail + ")"] : []), ...(voice && tokenOk === false ? ["OPENAI_API_KEY is not the voice slot's bearer"] : [])] : null;
  return {
    termination,
    web: webUses(transcript).length,
    gstack_reads: (PLAN_ARMS as readonly string[]).includes(o.arm) && !o.gstack ? [...new Set([...gstackReads(transcript), ...loadedSkills(transcript).map((s) => s.tool + " " + s.target)])] : [],
    contained: departures,
    micros: meter.micros,
    voice: vmeter ? { micros: vmeter.micros, requests: vmeter.requests, refused: vmeter.refused } : null,
    out: existsSync(out) && !copyFailed ? out : null,
  };
}

/** Whether a checker transcript holds at least one browser tool call that came back without an error. */
export function browserAnswered(transcript: string): boolean {
  const calls = new Set<string>();
  const answered = new Set<string>();
  for (const m of readTranscript(transcript)) {
    const content = Array.isArray(m.message?.content) ? (m.message.content as Record<string, any>[]) : [];
    for (const b of content) {
      if (m.type === "assistant" && b?.type === "tool_use" && String(b.name ?? "").startsWith("mcp__" + BROWSER_SERVER + "__")) calls.add(String(b.id));
      if (m.type === "user" && b?.type === "tool_result" && b.is_error !== true) answered.add(String(b.tool_use_id));
    }
  }
  return [...calls].some((id) => answered.has(id));
}

/** One attempt's outcome under section 7's rule. */
export type Outcome =
  | { state: "ended"; how: Termination["kind"] }
  | { state: "contaminated"; code: ReasonCode; why: string }
  | { state: "missing"; code: ReasonCode; why: string }
  | { state: "retry"; why: string }
  | { state: "cap"; why: string }
  | { state: "halt"; code: ReasonCode; why: string };

/** What the owner loop reports into the outcome: a responder failure, if any. */
export type OwnerFailure = { reason: "allowance" | "provider"; detail: string } | null;

export function attemptOutcome(a: AttemptRead, owner: OwnerFailure): Outcome {
  const t = a.termination;
  if (t.kind === "cap_stop") return { state: "cap", why: "the ledger item's cap stopped the session" };
  if (a.contained?.length) return { state: "halt", code: "E_DAYONE_LEAK", why: "the containment probe found " + a.contained.join("; ") };
  if (t.kind === "credentials_rejected") return { state: "halt", code: "E_KEY_REJECTED", why: "the provider rejected the proxy's credentials" };
  if (owner?.reason === "allowance") return { state: "missing", code: "E_DAYONE_OWNER", why: "the responder's allowance refused a call: " + owner.detail };
  if (a.web > 0) return { state: "contaminated", code: "E_DAYONE_CONTAMINATED", why: a.web + " web tool result(s)" };
  if (a.gstack_reads.length) return { state: "contaminated", code: "E_DAYONE_CONTAMINATED", why: "read " + a.gstack_reads.slice(0, 3).join(", ") };
  if (t.kind === "missing" && t.code === "E_BACKGROUND_DEADLINE") return { state: "missing", code: "E_DAYONE_BACKGROUND", why: "background work the session started still ran at its time limit" };
  if (a.contained === null) return { state: "retry", why: "the containment probe could not run" + (t.kind === "infra" && t.incident ? ": " + t.incident : "") };
  if (owner?.reason === "provider") return { state: "retry", why: "a responder provider failure: " + owner.detail };
  if (t.kind === "completed" || t.kind === "turn_cap" || t.kind === "timeout" || t.kind === "allowance_stop") return { state: "ended", how: t.kind };
  return { state: "retry", why: "an upstream or infrastructure failure: " + t.kind + ("code" in t ? " " + t.code : "incident" in t ? " " + t.incident : "") };
}

/** One retry in all: a retryable outcome on the first attempt retries; on the second it is a gap. */
export function settle(o: Outcome, attempt: number): Outcome {
  if (o.state !== "retry" || attempt < 2) return o;
  return { state: "missing", code: "E_DAYONE_GAP", why: o.why + ", on the retry" };
}

/** The loop for sessions with no owner: the first reply ends the session; its texts are kept. */
export function endLoop(): { last: string[]; nextUser: (texts: string[]) => Promise<NextUser> } {
  const state = { last: [] as string[] };
  return Object.assign(state, { nextUser: async (texts: string[]): Promise<NextUser> => ((state.last = texts), { end: true }) });
}

/** micro-dollars from dollars. */
export const micros = (usd: number): number => Math.round(usd * D);
