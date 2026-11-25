// Copyright (c) 2026 Garry Tan. MIT License.
// Eval 1's review launcher (prereg 2026-11-24-geva-587-design-time-state-modeling section 3): one lease on the item of an
// arm set and model, attempt 3's review container and settings on the Docker rig, and one session per call, as
// eng-build's reviewLauncher runs them, generalized to the eval's five arms and three models.
//
// - Hosts: Opus and particle-1 in Claude Code (attempt 3's settings: the claude-code-preset system prompt, a 200,000-token
//   window, bundled skills off, the turn and allowance caps recorded as their own ends); Sol in Codex CLI 0.170.0 at Part
//   S's settings (effort low, hook trust bypassed, run under the link name sol-agent so no process above the model's shell
//   is named codex), with Codex's own path dir on PATH. Every question gets "Go with your recommendation.".
// - Every session in every arm gets #358's tools volume read-only at /opt/pf-tools with TLA2TOOLS, JAVA and its bin on PATH.
// - Installs: e1ArmSpec's (N, D and C bare; P pstack's plugin; G gstack at the pin, ./setup --host codex on Sol with the
//   model seeded in config.toml for setup and removed after, as the head-to-head's Codex install did). Only G gets the
//   gstack state root and GSTACK_SESSION_KIND=unattended. No arm has a Stop hook.
// - /tmp: a start mark is written before the host CLI starts; after it ends, every regular file under /tmp newer than the
//   mark (less the launcher's marks) is copied into <work>/.e1-tmp, where bundle.ts reads it with the work dir.
// - Ends: erOutcome on the termination and the transcript (a Codex session's rollouts converted to Claude Code's shape),
//   read by eng-build's reviewEnd: a cap stop halts the stage, a web result or a crash is infra, an API error upstream, a
//   turn, time or allowance limit a limit, anything else completed.
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, posix } from "node:path";
import { ALLOWANCE_SPENT, BACKGROUND_WAIT_MS } from "../../../src/adapters/claude-code/driver.ts";
import { hostDriver } from "../../../src/adapters/host.ts";
import { ledgerPath, recordPath } from "../../../src/runner/ledger/paths.ts";
import type { ResolvedArms } from "../../../src/skill-eval/cli/arms.ts";
import { loadPolicy, providerOf, type LoadedPolicy } from "../../../src/skill-eval/cli/policy.ts";
import { armNamespaces, dockerRig, slotModels } from "../../../src/skill-eval/cli/run-host.ts";
import { ER_REC_USER, ER_SYSTEM_PROMPT, erFreeform } from "../../../src/trial/review/eng-review.ts";
import type { Sandbox } from "../../../src/trial/sandbox.ts";
import { STATE_ROOT_DIR } from "../../../src/trial/state-root.ts";
import { runTrial, type AgentDriver } from "../../../src/trial/trial.ts";
import { TOOLS_DIR, TOOLS_ENV, toolsVolume } from "../../outcome-skills/pfchecks/tools.ts";
import { REVIEW_SESSION } from "../../eng-build/arms.ts";
import { captureReview, finishTrial, reviewEnd, type ReviewCapture } from "../../eng-build/launch.ts";
import type { Launcher } from "../../eng-build/pipeline.ts";
import type { Attempt } from "../../eng-build/review-stage.ts";
import { spending } from "../../eng-build/spend.ts";
import { erOutcome } from "../../eng-review/parse.ts";
import { fail } from "../errors.ts";
import { e1ArmSpec, e1Env } from "./arms.ts";
import { TMP_COPY, TMP_MARK_PREFIX, writtenFiles, type Written } from "./bundle.ts";
import { codexAsClaude } from "./detect.ts";
import { E1_HOST, type E1Arm, type E1Model } from "./frozen.ts";
import type { Termination } from "../../../src/types.ts";

export const E1_POLICY = join(import.meta.dir, "policy.json");
/** Each model as the policy and the proxies name it. */
export const E1_POLICY_MODEL: Readonly<Record<E1Model, string>> = { opus: "claude-opus-5-5", sol: "gpt-6.2-sol", particle: "particle-ai/particle-1" };
/** Part S's Codex settings (wiki/plans/2026-11-21-geva-568-skill-pack-h2h-sol-particle-prereg prereg.json parts.S). */
export const SOL_CODEX = { version: "0.170.0", bin: "/opt/codex-0.170.0/bin/codex", pathDir: "/opt/codex-0.170.0/codex-path", link: "sol-agent", effort: "low", hookTrust: true } as const;
const LINK_DIR = "/tmp/" + TMP_MARK_PREFIX + "bin";
const TMP_MARK = "/tmp/" + TMP_MARK_PREFIX + "start";
const COPY_MS = 120_000;

/** G's install on Codex: gstack's ./setup --host codex with the model seeded in config.toml for setup, removed after. */
export function codexGstackInstall(model: string = E1_POLICY_MODEL.sol): string {
  const line = "model = " + JSON.stringify(model);
  return [
    'mkdir -p "$HOME/.codex"',
    "printf '%s\\n' '" + line + "' > \"$HOME/.codex/config.toml\"",
    "./setup --host codex",
    "grep -qxF '" + line + "' \"$HOME/.codex/config.toml\"",
    "sed -i '\\#^" + line.replace(/[.\\]/g, "\\$&") + "$#d' \"$HOME/.codex/config.toml\"",
    '{ [ -s "$HOME/.codex/config.toml" ] || rm -f "$HOME/.codex/config.toml"; }',
    'test ! -e "$HOME/.codex/AGENTS.md"',
  ].join(" && ");
}

/** The shell step that copies the session's /tmp files, newer than the start mark, into the work dir. */
export const TMP_COPY_STEP = 'set -e; d="$PWD/' + TMP_COPY + '"; mkdir -p "$d"; cd /tmp; if [ -e ' + TMP_MARK + ' ]; then find . -xdev -type f -newer ' + TMP_MARK + ' ! -path "./' + TMP_MARK_PREFIX + '*" -print0; else find . -xdev -type f ! -path "./' + TMP_MARK_PREFIX + '*" -print0; fi | tar --null -T - -cf - | tar -C "$d" -xf -';

/** Claude Code's own session file: the SDK stream never carries a slash command's expanded body, and this file does. */
export const CLAUDE_SESSION = "claude-session.jsonl";

/** The start mark and, on Sol, the sol-agent link, before the host CLI starts; the /tmp copy after it ends and, on Claude
 * Code, a copy of its own session file to session (home is the container's HOME). copied hears whether the /tmp copy
 * succeeded; a failed copy fails the attempt as infra, since the bundle would miss what the session wrote there. */
export function withTmpCapture(inner: AgentDriver, sol: boolean, keep: { home: string; session: string } | null = null, copied: (ok: boolean) => void = () => {}): AgentDriver {
  return {
    ...(inner.env ? { env: inner.env } : {}),
    run: async (session, task, timeoutMs) => {
      const start = session.exec("touch " + TMP_MARK + (sol ? " && mkdir -p " + LINK_DIR + " && ln -sf " + SOL_CODEX.bin + " " + LINK_DIR + "/" + SOL_CODEX.link : ""), COPY_MS);
      if (start.exitCode !== 0) throw new Error("the session's start mark could not be written: " + start.stderr.trim());
      try {
        return await inner.run(session, task, timeoutMs);
      } finally {
        copied(session.exec(TMP_COPY_STEP, COPY_MS).exitCode === 0);
        if (keep && !sol) {
          const kept = session.exec("cat " + JSON.stringify(keep.home) + "/.claude/projects/*/*.jsonl", COPY_MS);
          if (kept.exitCode === 0 && kept.stdout) writeFileSync(keep.session, kept.stdout);
        }
      }
    },
  };
}

/** The rig's sandbox with the tools volume, its environment and, on Sol, Codex's path dir. */
export function withTools(base: Sandbox, sol: boolean): Sandbox {
  return {
    ...base,
    agent: (task, o) => {
      const path = [TOOLS_DIR + "/bin", ...(sol ? [SOL_CODEX.pathDir] : []), o.env.PATH ?? "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"].join(":");
      return base.agent(task, { ...o, env: { ...o.env, ...TOOLS_ENV, PATH: path }, mounts: [...(o.mounts ?? []), { host: toolsVolume(), path: TOOLS_DIR }] });
    },
  };
}

export interface E1ReviewUnit {
  id: string;
  /** The unit's stripped one-commit base tree as the review mounts it at /work/repo. */
  repo: string;
  /** The authored plan. */
  plan: string;
}

export interface E1ReviewLeft {
  dir: string;
  host: "claude" | "codex";
  plan: string | null;
  /** The transcript in Claude Code's shape (a Codex session's rollouts converted). */
  transcript: string;
  /** Claude Code's own session file (host/claude-session.jsonl), where a slash command's expanded body lands; absent on Codex. */
  claudeSession?: string;
  stateRoot: string | null;
  written: Written;
  repoEdits: number;
  /** A model's refusal or a provider's safety-filter stop: a result, never a gap (prereg section 5). */
  stop?: "refusal" | "safety";
}

/** A provider's safety-filter words in a failed turn's error. */
export const SAFETY_FILTER = /cyber_policy|content_policy|content_filter|invalid_prompt/i;

/** The messages of a Codex session's failed turns and errors, read from its exec event stream. */
export function codexFailures(events: string): string {
  const out: string[] = [];
  for (const raw of events.split("\n")) {
    if (!raw.trim()) continue;
    try {
      const e = JSON.parse(raw) as { type?: string; message?: unknown; error?: { message?: unknown } };
      if (e.type === "turn.failed" && typeof e.error?.message === "string") out.push(e.error.message);
      else if (e.type === "error" && typeof e.message === "string") out.push(e.message);
    } catch {}
  }
  return out.join("\n");
}

/** The ends eval 1 reads before the shared mapping: the proxy's allowance refusal on Codex is a limit stop, scored as it
 * stands (the Claude driver maps it the same way under capStops), and a refusal or safety-filter stop is a result. */
export function e1Stop(t: Termination, failures: string): { end: "limit" } | { end: "completed"; stop: "refusal" | "safety" } | null {
  if (t.kind === "missing" && t.code === "E_ALLOWANCE" && ALLOWANCE_SPENT.test(failures)) return { end: "limit" };
  if (t.kind === "arm_failure" && t.failure === "refusal") return { end: "completed", stop: "refusal" };
  if (t.kind !== "completed" && t.kind !== "cap_stop" && SAFETY_FILTER.test(failures)) return { end: "completed", stop: "safety" };
  return null;
}

export type E1ReviewSession = (o: { cell: string; unit: E1ReviewUnit; arm: E1Arm; rep: number; attempt: number; prompt: string; seed: string; dir: string }) => Promise<Attempt<E1ReviewLeft>>;

/** The path of every rollout file a Codex session's driver copied out, in path order. */
export function rollouts(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d).sort()) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (n.endsWith(".jsonl")) out.push(p);
    }
  };
  walk(dir);
  return out;
}

export function e1ReviewLauncher(o: { arms: E1Arm[]; model: E1Model; out: string; env: Record<string, string | undefined>; runId: string; policy?: string; log?: (line: string) => void; upstream?: string }): Launcher<E1ReviewSession> {
  return async (p) => {
    const loaded = loadPolicy(o.policy ?? E1_POLICY);
    if ("problem" in loaded) return fail("E_USAGE", "model policy: " + loaded.problem);
    const policy = loaded as LoadedPolicy;
    const model = E1_POLICY_MODEL[o.model];
    const host = E1_HOST[o.model];
    const sol = host === "codex";
    const specs = o.arms.map((arm) => {
      const s = e1ArmSpec(arm, o.model);
      return s.kind === "stack" && sol && arm === "G" ? { ...s, install: { codex: codexGstackInstall(model) } } : s;
    });
    const tasks = join(o.out, "fixtures", "tasks.json");
    mkdirSync(join(o.out, "fixtures"), { recursive: true });
    writeFileSync(tasks, "[]\n");
    const arms: ResolvedArms = { arms: specs, base: null, skill: null, notes: [] };
    const env = o.env as Record<string, string>;
    const call = { host, arms, tasks, out: { path: o.out, rule: "--out" }, ledger: ledgerPath(p.ledger), record: recordPath(p.record, env), item: p.item, runId: o.runId, models: [model], policy };
    const skills: Record<string, string> = { ...(o.arms.includes("G") ? { "e1-G": "plan-eng-review" } : {}), ...(o.arms.includes("P") ? { "e1-P": "statechart" } : {}) };
    const rig = dockerRig(call, { env, skill: null, skills, nonce: randomBytes(6).toString("hex"), cap: Math.round(p.capUsd * 1_000_000), voice: false, ...(o.upstream ? { upstream: o.upstream } : {}) });
    const empty = join(o.out, "fixtures");
    const session: E1ReviewSession = async (s) => {
      const provider = providerOf(policy, model) ?? fail("E_USAGE", model + " has no provider in the policy");
      const name = "e1-" + s.arm;
      const g = s.arm === "G";
      const binding = await rig.bind({ cell: { run_id: o.runId, arm: name, task: s.unit.id, model, trial: s.rep, attempt: s.attempt }, models: slotModels(policy, model, null), allowance_micros: REVIEW_SESSION.allowanceMicros });
      const sandbox = withTools(rig.sandbox(name, false, model), sol);
      const run = join(s.dir, "run");
      mkdirSync(join(run, "host"), { recursive: true });
      const home = sandbox.homePath(run);
      const install = rig.arms[name]!;
      const skill = g && install.skill ? { name: "plan-eng-review", roots: install.skill.roots.map((r) => posix.join(home, r)), home, dir: install.skill.dir, namespaces: armNamespaces(install) } : null;
      const plugins = (install.plugins ?? []).map((pl) => posix.join(home, pl));
      let captured: ReviewCapture | null = null;
      let written: Written = { files: [], binary: 0, large: 0 };
      const gate = (w: string) => {
        captured = captureReview(w, join(s.seed, "repo"), join(run, "host"));
        written = writtenFiles(w);
        return { copy_out: [], gate: { plan: captured.plan !== null, repo_edits: captured.repoEdits } };
      };
      const inner = (rig.driver ?? hostDriver)({
        host,
        model,
        provider,
        proxy: { baseUrl: rig.baseUrl, slot: binding.slot, token: binding.token },
        interactive: true,
        skill,
        out: join(run, "host"),
        entry: { user: ER_REC_USER },
        freeform: erFreeform,
        ...(g ? { sessionKind: "unattended" as const } : {}),
        ...(sol
          ? { effort: SOL_CODEX.effort, codexSession: { hookTrust: SOL_CODEX.hookTrust, bin: LINK_DIR + "/" + SOL_CODEX.link } }
          : { systemPrompt: ER_SYSTEM_PROMPT, maxTurns: REVIEW_SESSION.maxTurns, disable1mContext: true, capStops: true, backgroundWaitMs: BACKGROUND_WAIT_MS, ...(plugins.length ? { plugins } : {}) }),
      });
      let tmpCopied = true;
      const agent = withTmpCapture({ ...inner, env: { ...(inner.env ?? {}), ...e1Env(s.arm) } }, sol, { home, session: join(run, "host", CLAUDE_SESSION) }, (ok) => void (tmpCopied = ok));
      const ran = await finishTrial(() => runTrial({ cell: { model, arm: name, round: 1, trial: s.rep }, task: { id: s.unit.id, prompt: s.prompt }, tasksDir: empty, sandbox, agent, dir: run, timeoutS: REVIEW_SESSION.timeoutS, network: rig.network, seed: s.seed, root: true, gate, ...(g ? { copyDirs: [{ from: STATE_ROOT_DIR, to: join(run, "host", "gstack-state") }] } : { stateRoot: false as const }) }), () => rig.finalize(binding.meter_id));
      const blank = (): E1ReviewLeft => ({ dir: run, host, plan: null, transcript: "", stateRoot: null, written, repoEdits: 0 });
      if (ran.trial === null) {
        o.log?.("cell " + s.cell + " a" + s.attempt + ": the trial threw " + ran.error + ", so the attempt ends infra (one rerun, then a gap)");
        return { end: "infra", costUsd: ran.micros / 1_000_000, result: blank() };
      }
      if (!tmpCopied) {
        o.log?.("cell " + s.cell + " a" + s.attempt + ": the /tmp copy failed after the session, so the attempt ends infra (one rerun, then a gap)");
        return { end: "infra", costUsd: ran.micros / 1_000_000, result: blank() };
      }
      const trial = ran.trial;
      return spending(ran.micros / 1_000_000, () => {
        const file = join(run, "host", "transcript.ndjson");
        const transcript = sol ? codexAsClaude(rollouts(join(run, "host", "codex-sessions"))) : existsSync(file) ? readFileSync(file, "utf8") : null;
        const special = e1Stop(trial.record.termination, sol && existsSync(file) ? codexFailures(readFileSync(file, "utf8")) : "");
        const { end, why } = special ? { end: special.end, why: special.end === "limit" ? "the slot's allowance was spent, a limit stop scored as it stands" : "a " + ("stop" in special ? special.stop : "") + " stop, a result with plan.md as the review left it" } : reviewEnd(erOutcome(trial.record.termination, sol ? transcript || null : transcript).outcome, s.cell);
        if (why) o.log?.("cell " + s.cell + " a" + s.attempt + ": " + why);
        const kept = (captured as ReviewCapture | null) ?? fail("E_USAGE", "cell " + s.cell + " a" + s.attempt + ": the trial ended before its work tree was read");
        const state = join(run, "host", "gstack-state");
        const claude = join(run, "host", CLAUDE_SESSION);
        return { end, costUsd: ran.micros / 1_000_000, result: { dir: run, host, plan: kept.plan, transcript: transcript ?? "", ...(existsSync(claude) ? { claudeSession: readFileSync(claude, "utf8") } : {}), stateRoot: g && existsSync(state) ? state : null, written, repoEdits: kept.repoEdits, ...(special && "stop" in special ? { stop: special.stop } : {}) } };
      });
    };
    return { lease_id: rig.recovery?.lease_id ?? "", backend: session, close: async () => void (await rig.close()) };
  };
}
