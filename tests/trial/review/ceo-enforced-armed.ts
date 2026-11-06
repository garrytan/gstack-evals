// The armed-and-blocked test's sessions (the CEO stage 2 amendment, section 3.3, with ruling B1), run as their own process
// for the reason ceo-outcome-sdk.ts gives. Each case is one review-units run through the harness's own runReviewUnits, the
// real Claude Code driver, the real pinned Agent SDK and its pinned CLI, against tests/adapters/harness.ts's scripted
// Messages stand-in behind the real metering proxy. The arms are installed from a checkout of gstack 4743132 by its own
// ./setup (installArms with the local installer), the cells carry the gate switch as the Docker rig's do, and each
// enforced session's record is copied out and reported through skill-gates.ts's gateRecord, as a real run does.
// A last run reads section 5's context window: arm none on all three models, the driver's Agent SDK query wrapped so the
// CLI's own getContextUsage() answers at session start, once as runReviewUnits builds every ceo-outcome session (with
// CLAUDE_CODE_DISABLE_1M_CONTEXT=1, the Captain's ruling D1) and once on Opus with that option taken off.
// Usage: bun ceo-enforced-armed.ts <gstack 4743132 checkout> <scratch dir>. Prints one JSON object: cases, then context.
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, posix } from "node:path";
import { hostDriver } from "../../../src/adapters/host.ts";
import { copyLayers, installArms, localInstaller, type ArmInstall } from "../../../src/arms/install.ts";
import { DEFAULT_POLICY, loadPolicy, type LoadedPolicy } from "../../../src/skill-eval/cli/policy.ts";
import { armCells, type HostRig } from "../../../src/skill-eval/cli/run-host.ts";
import type { Sandbox } from "../../../src/trial/sandbox.ts";
import { gateReport } from "../../../src/trial/review/ceo-cli.ts";
import { enforcedExposure } from "../../../src/trial/review/ceo-exposure.ts";
import { CEO_LENS, FOLLOW_UP } from "../../../src/trial/review/ceo-outcome.ts";
import { gstackDir } from "../../../src/trial/review/plan.ts";
import { runReviewUnits, type ReviewArm, type ReviewRunInput } from "../../../src/trial/review/run.ts";
import { ENFORCED_GSTACK_SHA, GATE_CONFIG, gateRecord } from "../../../src/trial/review/skill-gates.ts";
import { buildUnitRepo, buildUnitTree, unitTaskId } from "../../../src/trial/review/unit.ts";
import { harness, localSandbox, type Block, type Turn } from "../../adapters/harness.ts";
import { PANEL_REPO, planPanel } from "../../noloss/plan-panel.ts";

export const OPUS = "claude-opus-5-5";
/** Section 5's three models, by the policy keys review-units runs them as. */
export const MODELS = [OPUS, "openai/gpt-6.1-sol", "particle-ai/particle-1"] as const;
export const FINDINGS = "## Findings\n\n1. The rollout ships the whole sync engine at once, with no opt-out for current users.\n2. Nothing bounds the retry queue, so one bad upstream can fill the disk.\n";
const BODY = JSON.stringify({ top: [{ issue: "The rollout ships the whole sync engine at once, with no opt-out for current users.", evidence: "plan.md, Rollout", fix: "Ship the read-only mode first behind a flag." }], forecast: 35 });
export const BLOCK = "\x60\x60\x60ceo-outcome\n" + BODY + "\n\x60\x60\x60";
export const QUESTION = "Would you like me to go deeper on either risk?";
/** The slow-scan case's git: the first git call a ceo-review-gate hook makes ignores SIGTERM and sleeps 15 s, so the gate's scan outlasts the 3 s git cap; every other call is the real git. */
export const SLOW_S = 15;

type Case = { name: string; arm: "gstack-enforced" | "gstack-forced"; kind: boolean; script: "blocked" | "question" | "slow"; shim?: boolean; hookTimeoutS?: number };
export const CASES: Case[] = [
  { name: "blocked-released", arm: "gstack-enforced", kind: true, script: "blocked" },
  { name: "blocked-no-gate", arm: "gstack-forced", kind: true, script: "blocked" },
  { name: "question-unattended", arm: "gstack-enforced", kind: true, script: "question" },
  { name: "question-kind-unset", arm: "gstack-enforced", kind: false, script: "question" },
  { name: "slow-scan-30", arm: "gstack-enforced", kind: true, script: "slow", shim: true },
  { name: "slow-scan-10", arm: "gstack-enforced", kind: true, script: "slow", shim: true, hookTimeoutS: 10 },
];

const sh = (s: string) => "'" + s.replace(/'/g, "'\\''") + "'";

/** The scripted model: read review-sections.md, name a mode and run gstack-session-kind; then each case's own turns. */
function script(c: Case, gstackBin: string): (turn: Turn) => Block[] {
  return (turn) => {
    const said = JSON.stringify(turn.body.messages ?? []);
    const nudged = said.includes("ceo-review-gate blocked") || turn.users.some((u) => u.includes(FOLLOW_UP));
    if (!turn.results.has("toolu_read")) return [
      { type: "text", text: "Mode: HOLD SCOPE. Reading the review sections first." },
      { type: "tool_use", id: "toolu_read", name: "Bash", input: { command: "cat \"$HOME/.claude/skills/gstack/plan-ceo-review/sections/review-sections.md\"", description: "Read the review sections" } },
      { type: "tool_use", id: "toolu_kind", name: "Bash", input: { command: sh(posix.join("$HOME", gstackBin, "gstack-session-kind")).replace("'$HOME", "\"$HOME\"'"), description: "Print the session kind" } },
    ];
    const write: Block = { type: "tool_use", id: "toolu_write", name: "Bash", input: { command: "cat > ceo-review.md <<'EOF'\n" + FINDINGS + "EOF", description: "Write the ranked findings" } };
    if (c.script === "blocked") {
      if (!nudged) return [{ type: "text", text: "Review complete." }];
      if (!turn.results.has("toolu_write")) return [write];
      return [{ type: "text", text: "Findings written to ceo-review.md.\n\n" + BLOCK }];
    }
    if (!turn.results.has("toolu_write")) return [write];
    return [{ type: "text", text: "Findings written to ceo-review.md.\n\n" + BLOCK + (c.script === "question" ? "\n\n" + QUESTION : "") }];
  };
}

/** The git the slow-scan case puts first on the CLI's PATH. */
function gitShim(dir: string): string {
  const real = spawnSync("bash", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
  mkdirSync(dir, { recursive: true });
  const mark = join(dir, "slowed");
  writeFileSync(join(dir, "git"), "#!/usr/bin/env bash\nif grep -qa ceo-review-gate.ts /proc/$PPID/cmdline 2>/dev/null && mkdir " + sh(mark) + " 2>/dev/null; then trap '' TERM; sleep " + SLOW_S + "; exit 1; fi\nexec " + sh(real) + " \"$@\"\n");
  chmodSync(join(dir, "git"), 0o755);
  return mark;
}

/** The --settings value the SDK hands the CLI, with both ceo-review shims' timeout set to s when s is given. */
function settingsArg(argv: string[], seen: { timeouts: number[] | null }, s?: number): string[] {
  const i = argv.indexOf("--settings");
  if (i < 0 || i + 1 >= argv.length) return argv;
  let raw = argv[i + 1]!;
  const fromFile = !raw.trimStart().startsWith("{");
  if (fromFile) raw = readFileSync(raw, "utf8");
  const settings = JSON.parse(raw);
  const shims = Object.values(settings.hooks ?? {}).flatMap((groups: any) => groups.flatMap((g: any) => g.hooks ?? [])).filter((h: any) => /ceo-review-gate-(subagent-)?stop"?$/.test(String(h.command)));
  seen.timeouts = shims.map((h: any) => h.timeout);
  if (s === undefined) return argv;
  for (const h of shims) h.timeout = s;
  const out = [...argv];
  out[i + 1] = JSON.stringify(settings);
  return out;
}

const files = (dir: string, name: string): string[] => (existsSync(dir) ? readdirSync(dir, { recursive: true }).map(String).filter((f) => f.endsWith(name)).map((f) => join(dir, f)) : []);

if (import.meta.main) {
  const [pin, root] = process.argv.slice(2) as [string, string];
  const scratch = (name: string) => mkdtempSync(join(root, name));
  const policy = loadPolicy(DEFAULT_POLICY) as LoadedPolicy;
  const installs = installArms({ host: "claude", arms: (["gstack-enforced", "gstack-forced"] as const).map((name) => ({ name, kind: "stack" as const, stack: { repo: "gstack", sha: ENFORCED_GSTACK_SHA }, install: {} })), skill: null, skills: { "gstack-enforced": "plan-ceo-review", "gstack-forced": "plan-ceo-review" }, base: null, sources: [pin], runner: localInstaller(scratch("runner-")), state: scratch("state-") });
  const byName: Record<string, ArmInstall> = Object.fromEntries(installs.map((i) => [i.name, i]));
  const cells = armCells(installs, [OPUS], policy, scratch("cells-"), { voice: false, gstackConfig: { "gstack-enforced": GATE_CONFIG } });
  const panel = planPanel(scratch("panel-"), { seeded: 1 });
  const u = panel.suite.units[0]!;
  const unit = { id: u.id, repo: PANEL_REPO, pr: u.pr, head: u.head, base: u.base };
  const repo = buildUnitRepo({ unit, source: panel.clone, dest: join(scratch("unit-"), "repo"), baseBranch: "main" });
  const tree = buildUnitTree({ repo, task: unitTaskId(unit), dest: join(scratch("tree-"), "tree"), image: "unused", test: null, install: null, scratch: scratch("build-"), run: () => { throw new Error("a plan unit runs no container"); } });
  const results: Record<string, unknown> = {};
  for (const c of CASES) {
    const seen = { timeouts: null as number[] | null };
    const shimDir = c.shim ? join(scratch("git-"), "bin") : null;
    const mark = shimDir ? gitShim(shimDir) : null;
    const install = byName[c.arm]!;
    const h = harness(script(c, posix.dirname(install.gstack!)));
    const sandbox = (): Sandbox => {
      const base = localSandbox((home) => copyLayers(install.layers, home));
      return { ...base, agent: (task, o) => { const a = base.agent(task, o); return { ...a, spawn: (argv, extra = {}) => a.spawn(settingsArg(argv, seen, c.hookTimeoutS), { ...extra, ...(shimDir ? { PATH: shimDir + ":" + (process.env.PATH ?? "") } : {}) }) }; } };
    };
    const rig: HostRig = {
      baseUrl: h.baseUrl, network: null, imageDigest: null,
      bind: async (request) => h.proxy.bind(request), finalize: (m) => h.proxy.finalize(m),
      arms: byName, cells, sandbox, judgeSandbox: () => localSandbox(() => {}),
      egress: () => ({ open: false, detail: "test rig" }), close: async () => ({ committed: 0, unknown: 0, lease_id: null }), recovery: null,
    };
    const arms: ReviewArm[] = [{ name: c.arm, told: "gstack", ...(c.kind ? { sessionKind: "unattended" as const } : {}) }];
    const out = join(scratch("out-"), "out");
    const input: ReviewRunInput = { host: "claude", suite: { id: "ceo-enforced-armed", sha256: null }, units: [{ unit, task: unitTaskId(unit), base_branch: "main", merge_base: repo.merge_base, tree: tree.dir, tree_sha256: tree.tree_sha256, instructions: repo.instructions, check: null }], arms, models: [OPUS], passes: 1, parallel: 1, timeoutS: 240, cap: 50_000_000, runId: "armed-" + c.name, out, date: "2026-11-06", policy, keyBase: { image_digest: null, recipe: "test", host_version: null, adapter_sha256: "test", isolation: "process" }, journal: null, plan: { lens: CEO_LENS }, env: {} };
    const t0 = Date.now();
    let stops: unknown[] = [];
    try {
      stops = (await runReviewUnits(input, rig)).stops;
    } finally {
      h.proxy.stop();
    }
    const trialJson = files(join(out, "runs"), "trial.json")[0] ?? null;
    const dir = trialJson ? join(trialJson, "..") : null;
    const host = dir ? join(dir, "host") : null;
    const transcript = host && existsSync(join(host, "transcript.ndjson")) ? readFileSync(join(host, "transcript.ndjson"), "utf8") : "";
    const trial = trialJson ? JSON.parse(readFileSync(trialJson, "utf8")) : null;
    const records = host ? files(join(host, "skill-gates"), "record.json").map((f) => JSON.parse(readFileSync(f, "utf8"))) : [];
    const requests = h.upstream.map((r) => JSON.stringify(r.body.messages ?? []));
    const toolResult = (id: string): string | null => {
      for (const r of h.upstream) for (const m of r.body.messages ?? []) for (const b of Array.isArray(m.content) ? m.content : []) if (b.type === "tool_result" && b.tool_use_id === id) return Array.isArray(b.content) ? b.content.map((x: { text?: string }) => x.text ?? "").join("") : String(b.content ?? "");
      return null;
    };
    const contrast = c.arm === "gstack-forced" && host ? gateRecord({ work: scratch("no-gate-work-"), host, gstack: gstackDir(install) ?? "", settingsSha256: null }) : null;
    const gate = contrast ? { session_id: contrast.gate.session_id, exit: contrast.gate.exit, json: contrast.gate.json, copy_failed: contrast.copy_out.length > 0 } : dir ? gateReport(dir) : null;
    results[c.name] = {
      wall_ms: Date.now() - t0, stops, termination: trial?.record?.termination ?? null,
      gate: contrast ? { ...gate, stderr: contrast.gate.stderr } : trial?.gate ?? null, copy_out: trial?.logs?.copy_out ?? [],
      exposure: transcript && gate ? enforcedExposure(transcript, gate) : null,
      records, settings_timeouts: seen.timeouts, slowed: mark ? existsSync(mark) : null,
      session_kind: toolResult("toolu_kind")?.trim() ?? null, review_sections_bytes: (toolResult("toolu_read") ?? "").length,
      model_saw_block: requests.some((r) => r.includes("ceo-review-gate blocked")), model_saw_fired: requests.some((r) => /ceo-review-gate (fired|released)/.test(r)),
      main_requests: h.upstream.filter((r) => (r.body.tools ?? []).length).length,
      fired_markers: (transcript.match(/GSTACK_GATE ceo-review-gate fired/g) ?? []).length,
    };
  }
  const { query: sdkQuery } = (await import("@anthropic-ai/claude-agent-sdk")) as unknown as { query: (args: unknown) => AsyncIterable<Record<string, any>> & { getContextUsage(o: { detail: "summary" }): Promise<Record<string, any>> } };
  const context = async (models: readonly string[], strip: boolean): Promise<Record<string, unknown>> => {
    const readings: Record<string, unknown> = {};
    const h = harness(() => [{ type: "text", text: BLOCK }]);
    const bare = { tree_sha256: "none-tree", skill: null, gstack: null, plugins: [] };
    const rig: HostRig = {
      baseUrl: h.baseUrl, network: null, imageDigest: null,
      bind: async (request) => h.proxy.bind(request), finalize: (m) => h.proxy.finalize(m),
      arms: { none: bare }, sandbox: () => localSandbox(() => {}), judgeSandbox: () => localSandbox(() => {}),
      egress: () => ({ open: false, detail: "test rig" }), close: async () => ({ committed: 0, unknown: 0, lease_id: null }), recovery: null,
      driver: (o) => {
        const query = (args: unknown) => {
          const q = sdkQuery(args);
          let asked = false;
          return (async function* () {
            for await (const m of q) {
              if (!asked && m.type === "system" && m.subtype === "init") {
                asked = true;
                const u = await q.getContextUsage({ detail: "summary" }).catch((e: unknown): Record<string, any> => ({ error: String(e) }));
                readings[o.model] = { env: o.disable1mContext === true && !strip, maxTokens: u.maxTokens ?? null, rawMaxTokens: u.rawMaxTokens ?? null, autoCompactThreshold: u.autoCompactThreshold ?? null, isAutoCompactEnabled: u.isAutoCompactEnabled ?? null, ...(u.error ? { error: u.error } : {}) };
              }
              yield m;
            }
          })();
        };
        return hostDriver({ ...o, ...(strip ? { disable1mContext: false } : {}), query: query as never });
      },
    };
    const input: ReviewRunInput = { host: "claude", suite: { id: "ceo-enforced-context", sha256: null }, units: [{ unit, task: unitTaskId(unit), base_branch: "main", merge_base: repo.merge_base, tree: tree.dir, tree_sha256: tree.tree_sha256, instructions: repo.instructions, check: null }], arms: [{ name: "none", told: "none" }], models: [...models], passes: 1, parallel: 3, timeoutS: 240, cap: 50_000_000, runId: "context", out: join(scratch("context-"), "out"), date: "2026-11-06", policy, keyBase: { image_digest: null, recipe: "test", host_version: null, adapter_sha256: "test", isolation: "process" }, journal: null, plan: { lens: CEO_LENS }, env: {} };
    try {
      const stops = (await runReviewUnits(input, rig)).stops;
      if (stops.length) readings.stops = stops;
    } finally {
      h.proxy.stop();
    }
    return readings;
  };
  console.log(JSON.stringify({ cases: results, context: { built: await context(MODELS, false), without: await context([OPUS], true) } }));
}
