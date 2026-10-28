import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { LIMITS, type ArmName } from "./config.ts";
import { gradePatterns, loadedBytes, parseTranscript, resultOutcome, skillUse, transcriptText, type PatternGrade, type Task } from "./grade.ts";
import type { MeteringProxy } from "./proxy.ts";
import { UserSim, type UserScript } from "./usersim.ts";
import type { Usage } from "./usage.ts";

export interface SessionSpec {
  id: string;
  suite: string;
  skill: string;
  task: Task;
  script?: UserScript;
  arm: ArmName;
  model: string;
  trial: number;
  image: string;
  checkImage: string;
  seedDir: string;
  fixturesDir: string;
  outDir: string;
  sizes: Record<string, number>;
  ceilingUsd: number;
  hardLimitUsd: number;
  fakeExecutable: string;
  agentUid: string;
}

export interface SessionResult {
  id: string;
  suite: string;
  task: string;
  safety: boolean;
  arm: ArmName;
  model: string;
  trial: number;
  status: "complete" | "infra_error" | "timeout";
  pass: boolean;
  pass_final: boolean;
  must_transcript: PatternGrade;
  must_final: PatternGrade;
  check: { cmd: string; exit: number; ok: boolean; output: string } | null;
  opened: boolean;
  open_how: string[];
  files_loaded: Record<string, number>;
  subagent_files_loaded: Record<string, number>;
  loaded_bytes_unique: number;
  loaded_bytes_total: number;
  usage: Usage;
  cost_usd: number;
  requests: number;
  budget_hit: boolean;
  refusals: { reason: string; detail: string }[];
  sdk: { result_subtypes: string[]; num_turns: number; total_cost_usd: number; duration_ms: number };
  usersim: { prose_replies: number; ask_answers: number; sequence: string[]; end_reason: string };
  init: Record<string, unknown> | null;
  wall_ms: number;
  errors: string[];
}

const SEED_STATE = [
  "mkdir -p /work/.tmp",
  "{ [ ! -d /work/.git ] || printf '.tmp/\n' >> /work/.git/info/exclude; }",
  'mkdir -p "$GSTACK_STATE_ROOT" && cd "$GSTACK_STATE_ROOT"',
  "touch .feature-prompted-model-overlay .completeness-intro-seen .telemetry-prompted .proactive-prompted .activated .first-loop-tip-shown .writing-style-prompted",
  "B=$HOME/.claude/skills/gstack/bin",
  '"$B/gstack-config" set telemetry off >/dev/null',
  '"$B/gstack-config" set update_check false >/dev/null',
  '"$B/gstack-config" set proactive core >/dev/null',
  '"$B/gstack-config" set cross_project_learnings false >/dev/null',
  '"$B/gstack-config" set routing_declined true >/dev/null',
].join(" && ");

const STATE_ENV = { GSTACK_STATE_ROOT: "/work/.gstack-home", GSTACK_HOME: "/work/.gstack-home" };

async function run(cmd: string[], opts: { env?: Record<string, string>; timeoutMs?: number; stdin?: string } = {}): Promise<{ code: number; out: string }> {
  const p = Bun.spawn(cmd, { env: { PATH: process.env.PATH ?? "", ...(opts.env ?? {}) }, stdout: "pipe", stderr: "pipe", stdin: opts.stdin ? new Blob([opts.stdin]) : "ignore" });
  const timer = setTimeout(() => p.kill("SIGKILL"), opts.timeoutMs ?? 120_000);
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  const code = await p.exited;
  clearTimeout(timer);
  return { code, out: (out + err).slice(-4000) };
}

function envFlags(env: Record<string, string>): string[] {
  return Object.keys(env).flatMap((k) => ["-e", k]);
}

class Inbox {
  private items: any[] = [];
  private wake: (() => void) | null = null;
  private closed = false;
  push(x: any) {
    this.items.push(x);
    this.wake?.();
  }
  close() {
    this.closed = true;
    this.wake?.();
  }
  async *stream() {
    while (true) {
      if (this.items.length) {
        yield this.items.shift();
        continue;
      }
      if (this.closed) return;
      await new Promise<void>((r) => (this.wake = r));
      this.wake = null;
    }
  }
}

const userMessage = (text: string) => ({ type: "user", message: { role: "user", content: text }, parent_tool_use_id: null, session_id: "" });

export async function runSession(spec: SessionSpec, proxy: MeteringProxy): Promise<SessionResult> {
  const { query } = await import("@anthropic-ai/claude-agent-sdk");
  const t0 = Date.now();
  mkdirSync(spec.outDir, { recursive: true });
  const errors: string[] = [];
  const container = `lanea-${createHash("sha256").update(resolve(spec.outDir)).digest("hex").slice(0, 8)}-${spec.id}`.replace(/[^a-zA-Z0-9_.-]/g, "-").slice(0, 120);
  const transcriptPath = join(spec.outDir, "transcript.jsonl");
  const stderrPath = join(spec.outDir, "cli-stderr.log");
  const { token, session } = proxy.register(spec.id, spec.model, spec.ceilingUsd, spec.hardLimitUsd, join(spec.outDir, "proxy.jsonl"));
  const sim = new UserSim(spec.script, join(spec.outDir, "usersim.jsonl"));
  const messages: any[] = [];
  let init: Record<string, unknown> | null = null;
  let status = "complete" as SessionResult["status"];
  let endReason = "";
  const subtypes: string[] = [];
  let numTurns = 0;
  let sdkCost = 0;
  let sdkMs = 0;
  try {
    await run(["docker", "rm", "-f", container]);
    const started = await run(["docker", "run", "-d", "--name", container, "--user", "agent", "-w", "/work", "--memory", "3g", "--cpus", "2", spec.image, "sleep", "infinity"]);
    if (started.code !== 0) throw new Error(`E_CONTAINER: ${started.out}`);
    const cp = await run(["docker", "cp", `${spec.seedDir}/.`, `${container}:/tmp/fx`]);
    if (cp.code !== 0) throw new Error(`E_SEED_COPY: ${cp.out}`);
    if (spec.task.setup) {
      const setup = await run(["docker", "exec", "-u", "agent", "-w", "/work", ...envFlags({ ...STATE_ENV, SKILL_EVAL_FIXTURES: "/tmp/fx" }), container, "sh", "-c", spec.task.setup], {
        env: { ...STATE_ENV, SKILL_EVAL_FIXTURES: "/tmp/fx" },
      });
      if (setup.code !== 0) throw new Error(`E_SETUP: ${setup.out}`);
    }
    const seeded = await run(["docker", "exec", "-u", "agent", "-w", "/work", ...envFlags(STATE_ENV), container, "sh", "-c", `rm -rf /tmp/fx && ${SEED_STATE}`], { env: STATE_ENV });
    if (seeded.code !== 0) throw new Error(`E_SEED_STATE: ${seeded.out}`);

    const agentEnv: Record<string, string> = {
      ...STATE_ENV,
      TMPDIR: "/work/.tmp",
      ANTHROPIC_BASE_URL: proxy.url,
      ANTHROPIC_API_KEY: token,
      ANTHROPIC_MODEL: spec.model,
      ANTHROPIC_DEFAULT_OPUS_MODEL: spec.model,
      ANTHROPIC_DEFAULT_SONNET_MODEL: spec.model,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: spec.model,
      ANTHROPIC_SMALL_FAST_MODEL: spec.model,
      CLAUDE_CODE_SUBAGENT_MODEL: spec.model,
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      CLAUDE_CODE_DISABLE_BUNDLED_SKILLS: "1",
      DISABLE_AUTOUPDATER: "1",
      DISABLE_TELEMETRY: "1",
      DISABLE_ERROR_REPORTING: "1",
    };
    const inbox = new Inbox();
    inbox.push(userMessage(spec.task.prompt));
    const abort = new AbortController();
    const wall = setTimeout(() => {
      status = "timeout";
      abort.abort();
    }, LIMITS.sessionWallSeconds * 1000);
    const q = query({
      prompt: inbox.stream() as any,
      options: {
        model: spec.model,
        cwd: spec.outDir,
        pathToClaudeCodeExecutable: spec.fakeExecutable,
        env: agentEnv,
        permissionMode: "default",
        settingSources: ["user", "project", "local"],
        maxTurns: LIMITS.maxAgentTurns,
        abortController: abort,
        stderr: (d: string) => appendFileSync(stderrPath, d),
        canUseTool: async (name: string, input: Record<string, unknown>) => {
          if (name === "AskUserQuestion") {
            const answers = sim.answerAsk((input.questions as any[]) ?? []);
            return { behavior: "allow", updatedInput: { ...input, answers } };
          }
          return { behavior: "allow", updatedInput: input };
        },
        spawnClaudeCodeProcess: (o: any) => {
          const fromSdk: Record<string, string> = {};
          for (const k of ["CLAUDE_CODE_ENTRYPOINT", "CLAUDE_AGENT_SDK_VERSION"]) if (o.env?.[k]) fromSdk[k] = String(o.env[k]);
          const env = { ...agentEnv, ...fromSdk };
          const args = ["exec", "-i", "-u", "agent", "-w", "/work", ...envFlags(env), container, "claude", ...o.args];
          return spawn("docker", args, { env: { PATH: process.env.PATH ?? "", ...env }, stdio: ["pipe", "pipe", "pipe"], signal: o.signal }) as any;
        },
      } as any,
    });
    let turnText = "";
    try {
      for await (const m of q as AsyncIterable<any>) {
        messages.push(m);
        appendFileSync(transcriptPath, JSON.stringify(m) + "\n");
        if (m.type === "system" && m.subtype === "init") {
          init = { model: m.model, claude_code_version: m.claude_code_version, permissionMode: m.permissionMode, apiKeySource: m.apiKeySource, skills: m.skills, tools: m.tools, cwd: m.cwd };
        } else if (m.type === "assistant" && !m.parent_tool_use_id) {
          for (const b of m.message?.content ?? []) if (b.type === "text" && b.text?.trim()) turnText = b.text;
        } else if (m.type === "result") {
          subtypes.push(m.subtype);
          numTurns += m.num_turns ?? 0;
          sdkCost = Math.max(sdkCost, m.total_cost_usd ?? 0);
          sdkMs += m.duration_ms ?? 0;
          const outcome = resultOutcome(m, session.budgetHit);
          if (outcome.stop) {
            endReason = outcome.reason;
            if (outcome.infra) {
              status = "infra_error";
              errors.push(`E_RESULT: ${m.subtype} ${String(m.result ?? JSON.stringify(m.errors ?? "")).slice(0, 300)}`);
            }
            inbox.close();
          } else {
            const d = sim.afterTurn(turnText);
            if (d.kind === "reply") inbox.push(userMessage(d.text));
            else {
              endReason = d.reason;
              inbox.close();
            }
          }
          turnText = "";
        }
      }
    } catch (e) {
      const msg = String((e as Error)?.message ?? e).slice(0, 500);
      if (session.budgetHit) {
        endReason = "budget";
        errors.push(`W_BUDGET: ${msg}`);
      } else if (status !== "timeout") {
        status = "infra_error";
        errors.push(`E_SDK: ${msg}`);
      }
      inbox.close();
    } finally {
      clearTimeout(wall);
    }
    const copied = await run(["bash", "-c", `set -o pipefail; rm -rf "${spec.outDir}/work" && docker cp ${container}:/work - | tar -x -C "${spec.outDir}"`], { timeoutMs: 120_000 });
    if (copied.code !== 0) {
      if (status === "complete") status = "infra_error";
      errors.push(`E_COPY: ${copied.out}`);
    }
  } catch (e) {
    status = "infra_error";
    errors.push(String((e as Error)?.message ?? e).slice(0, 1000));
  } finally {
    proxy.revoke(token);
    await run(["docker", "rm", "-f", container]);
    await proxy.drain(session, 30_000);
  }

  const t = parseTranscript(messages);
  const mustT = gradePatterns(spec.task, transcriptText(t));
  const mustF = gradePatterns(spec.task, t.finalAnswer);
  let check: SessionResult["check"] = null;
  if (spec.task.check && status !== "infra_error") {
    const env = { ...STATE_ENV, SKILL_EVAL_FIXTURES: "/fx", HOME: "/tmp", GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "safe.directory", GIT_CONFIG_VALUE_0: "*" };
    const r = await run(
      ["docker", "run", "--rm", "--network", "none", "--user", spec.agentUid, ...envFlags(env), "-v", `${spec.outDir}/work:/work`, "--mount", `type=bind,src=${spec.fixturesDir},dst=/fx,readonly`, "-w", "/work", spec.checkImage, "sh", "-c", spec.task.check],
      { env, timeoutMs: 120_000 },
    );
    if (r.code === 125) {
      status = "infra_error";
      errors.push(`E_CHECK: docker could not start the check: ${r.out.slice(-500)}`);
    } else check = { cmd: spec.task.check, exit: r.code, ok: r.code === 0, output: r.out.slice(-1000) };
  }
  const use = skillUse(t, spec.skill);
  const bytes = loadedBytes(use.files, spec.sizes);
  const checkOk = check ? check.ok : true;
  const hasMust = (spec.task.must ?? []).length + (spec.task.must_not ?? []).length > 0;
  const result: SessionResult = {
    id: spec.id,
    suite: spec.suite,
    task: spec.task.id,
    safety: spec.task.safety === true,
    arm: spec.arm,
    model: spec.model,
    trial: spec.trial,
    status,
    pass: status !== "infra_error" && checkOk && (!hasMust || mustT.ok),
    pass_final: status !== "infra_error" && checkOk && (!hasMust || mustF.ok),
    must_transcript: mustT,
    must_final: mustF,
    check,
    opened: use.opened,
    open_how: use.how,
    files_loaded: use.files,
    subagent_files_loaded: skillUse({ toolUses: t.subagentToolUses }, spec.skill).files,
    loaded_bytes_unique: bytes.unique,
    loaded_bytes_total: bytes.total,
    usage: session.usage,
    cost_usd: session.spentUsd,
    requests: session.requests,
    budget_hit: session.budgetHit,
    refusals: session.refusals,
    sdk: { result_subtypes: subtypes, num_turns: numTurns, total_cost_usd: sdkCost, duration_ms: sdkMs },
    usersim: { prose_replies: sim.proseReplies, ask_answers: sim.askAnswers, sequence: sim.sequence, end_reason: endReason },
    init,
    wall_ms: Date.now() - t0,
    errors: [...errors, ...(bytes.unknown.length ? [`W_UNSIZED: ${bytes.unknown.join(",")}`] : [])],
  };
  writeFileSync(join(spec.outDir, "result.json"), JSON.stringify(result, null, 2) + "\n");
  return result;
}
