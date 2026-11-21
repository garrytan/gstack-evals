// Copyright (c) 2026 Garry Tan. MIT License.
// One extension session under Harbor (plan sections 3, 4 and 7), the extension's twin of sessions/run.ts runH2hSession.
// Part S's s-* arms run in Codex (ext/run.ts extRunCopy, h2h_codex.py); parts P and L run Claude Code through
// h2h_agent.py's Claude path on route.ts's h2hx: arms. Part P runs particle-1 on its pinned OpenRouter route with its base
// arm's installed home (sessions/home.ts armHome, arms-pins.json) and entries (ext/prereg.ts extScriptedTurns); part L
// runs Opus with ext/homes.ts's homes, checked against the install record beside each. Every part keeps the base's rules:
// the whole-session retry once on an upstream or infra end within the cap above it, the gap rules, the finalize halts and
// the record's usage sums (sessions/session.ts). Exposure is ext/exposure.ts's for part S (from the Codex rollouts, the tree's
// paths and the first request's input as the root rollout records it), the base arm's for part P, and ext/lexposure.ts's
// for part L (with the first request's prompt fields the driver's proxy recorded). Part S's record adds
// the Codex CLI version from the root rollout's session_meta and the unanswered questions; part P's adds its base arm and
// the providers that served it. After each part P attempt every answer's OpenRouter generation record (h2h_turns.py writes
// them to generations.jsonl before the slot closes) must name a provider the route pins; one that does not, or an answer
// with no record, refuses with E_H2HX_ROUTE_PROVIDER or E_H2HX_ROUTE_RECORD and stops part P's items for the Captain.
import { gunzipSync } from "node:zlib";
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BOUNDS } from "../../pfchecks/run.ts";
import { sessionManifest } from "../../statemachines/image.ts";
import { checkHome, recordPath } from "../arms/layer.ts";
import { h2hFail, readPrereg, type H2hPrereg } from "../prereg.ts";
import { readEvents } from "../sessions/exposure.ts";
import { armHome, checkArmHome, type HomeRule } from "../sessions/home.ts";
import { readMarkers } from "../sessions/markers.ts";
import type { H2hPlanned } from "../sessions/plan.ts";
import { claudeEnv, composeOverlay, find, H2H_CLAUDE, h2hBudget, haltCheck, harbor, QUIET, readExposure, sessionFiles, SUMMARY, type H2hUnitInput } from "../sessions/run.ts";
import { runtimePath } from "../sessions/runtimes.ts";
import { attemptUsage, endOf, retries, retryCovered, SESSION_RERUN, sessionRecord, withRefusalFallback, writeSessionRecord, type AttemptUsage, type H2hSessionRecord } from "../sessions/session.ts";
import { BROWSER, type ArmInstall, type H2hArm, type H2hUnit } from "../types.ts";
import { readCodexPin, checkCodexHome } from "./codex-arms.ts";
import { h2hStageLimits, h2hStageModel } from "./driver.ts";
import { codexExposure, readCodexEvents } from "./exposure.ts";
import { extSessionEnv, lHomeArm } from "./homes.ts";
import { lExposure } from "./lexposure.ts";
import type { ExtPlanned } from "./plan.ts";
import { extScriptedTurns, partOf, readExtPrereg, type ExtArm, type ExtPrereg, type Part } from "./prereg.ts";
import { answerIds, checkServedBy, claudeRoute, EXT_PREFIX, type GenerationLookup } from "./route.ts";
import { extHomeRule, extRunCopy } from "./run.ts";

const ROOT = join(import.meta.dir, "../../../..");
const KEYS = /^(ANTHROPIC|OPENAI|OPENROUTER|UBICLOUD|GEMINI|GOOGLE|XAI|DEEPSEEK|TYPESAFE)_[A-Z_]*KEY$|_TOKEN$/;
/** The files each host's attempt leaves beside the record (the last attempt's win); part S also keeps codex-sessions/. */
const KEEP: Record<"codex" | "claude-code", string[]> = {
  codex: ["codex-events.jsonl", "codex-config.toml", "codex-stderr.log", "usersim-events.jsonl", "tree.tar", SUMMARY],
  "claude-code": ["sdk-messages.jsonl", "claude-session.jsonl", "usersim-events.jsonl", "generations.jsonl", "tree.tar", SUMMARY],
};
type LArm = "l-none" | "l-gstack" | "l-gstack-md" | "l-gstack-task";
type SArm = "s-none" | "s-gstack" | "s-gstack-line" | "s-superpowers" | "s-agent-skills" | "s-gsd" | "s-tstack";

/** The home an extension arm's sessions copy. Part S: its Codex home, pinned in codex-pins.json (s-none copies none). Part
 *  P: its base arm's home from arms-pins.json. Part L: ext/homes.ts's home (l-gstack's for l-gstack-task), its hash read
 *  from the install record beside it (l-none copies none). pin names whose hash home_tree_sha256 is. */
export interface ExtHome { arm: ExtArm; part: Part; dir: string | null; home_rule: HomeRule; home_tree_sha256: string | null; pin: string; base_arm?: H2hArm }

/** An arm's home from its part's homes: sHomes (one Codex home per s-* arm), homes and installs (the base install layer's,
 *  for part P) or lHomes (one dir per part L home arm). */
export function extHome(arm: ExtArm, o: { sHomes?: string; homes?: string; installs?: ArmInstall[]; lHomes?: string }, x: ExtPrereg = readExtPrereg()): ExtHome {
  const part = partOf(arm);
  const need = (dir: string | undefined, what: string): string => dir ?? h2hFail("E_H2H_SESSION_INPUT", "arm " + arm + " needs " + what);
  if (part === "S") {
    const dir = arm === "s-none" ? null : join(need(o.sHomes, "the installed Codex homes (H2HX_S_HOMES)"), arm);
    if (dir && !existsSync(dir)) h2hFail("E_H2H_SESSION_INPUT", "arm " + arm + "'s Codex home " + dir + " does not exist");
    return { arm, part, dir, home_rule: extHomeRule(arm), home_tree_sha256: readCodexPin(arm as SArm).home_tree_sha256, pin: arm };
  }
  if (part === "P") {
    const base = x.parts.P.base_arm[arm as keyof ExtPrereg["parts"]["P"]["base_arm"]];
    const h = armHome(base, { installs: o.installs, homes: o.homes });
    return { arm, part, dir: h.dir, home_rule: h.home_rule, home_tree_sha256: h.home_tree_sha256, pin: base, base_arm: base };
  }
  const home = lHomeArm(arm as LArm);
  if (home === "l-none") return { arm, part, dir: null, home_rule: "none", home_tree_sha256: null, pin: home };
  const dir = join(need(o.lHomes, "part L's installed homes (H2HX_L_HOMES)"), home);
  if (!existsSync(recordPath(dir))) h2hFail("E_H2H_SESSION_INPUT", "arm " + arm + "'s home " + dir + " has no install record at " + recordPath(dir));
  const rec = JSON.parse(readFileSync(recordPath(dir), "utf8")) as { schema?: string; home?: string; exit?: number; home_tree_sha256?: string | null; sources?: { name?: string; sha?: string }[] };
  if (rec.schema !== "h2hx-arm-install.v1" || rec.home !== home || rec.exit !== 0 || typeof rec.home_tree_sha256 !== "string") h2hFail("E_H2H_SESSION_INPUT", recordPath(dir) + " is not a finished " + home + " install record");
  const gstack = rec.sources?.find((s) => s.name === "gstack")?.sha ?? "none";
  if (gstack !== x.gstack.L.sha) h2hFail("E_H2H_SESSION_INPUT", recordPath(dir) + " installed gstack " + gstack + ", not the plan's pin " + x.gstack.L.sha);
  return { arm, part, dir, home_rule: "gstack", home_tree_sha256: rec.home_tree_sha256!, pin: home };
}

/** Hashes the home's installed bytes against its pin; a drifted home refuses (E_H2H_HOME_DRIFT). */
export function checkExtHome(h: ExtHome): void {
  if (!h.dir) return;
  if (h.part === "S") return checkCodexHome(h.dir, h.arm as SArm);
  if (h.part === "P") return checkArmHome({ arm: h.base_arm!, dir: h.dir, home_rule: h.home_rule, home_tree_sha256: h.home_tree_sha256 });
  checkHome(h.dir, { arm: h.pin as unknown as H2hArm, home_tree_sha256: h.home_tree_sha256! });
}

export interface ExtSessionInput {
  session: ExtPlanned; unit: H2hUnitInput; home: ExtHome; control: string; proxy: string; out: string;
  /** Part S: ext/runtimes.ts's volume; parts P and L: sessions/runtimes.ts's. */
  runtime: { volume: string };
  allowance?: number; capLeftUsd?: number; harbor?: string; claude?: string; probeNode?: string; jobName?: string; browserWrapper?: string;
  /** arms-pins.json's records, for part P's read audit. */
  installs?: ArmInstall[];
}

/** The h2h config h2h_agent.py reads for a part P or L arm: the arm's turns (extScriptedTurns), the base post's
 *  continuation, DONE rule and question reply, the extension item's limits, Claude Code's environment plus the extension's
 *  (homes.ts extSessionEnv), and the home. Part P's sets generations, so h2h_turns.py reads each answer's generation record
 *  before the slot closes. */
export function extClaudeConfig(i: Pick<ExtSessionInput, "session" | "home" | "allowance">, statement: string, kind: H2hUnit["kind"], x: ExtPrereg = readExtPrereg(), p: H2hPrereg = readPrereg()) {
  const s = i.session;
  const part = partOf(s.arm);
  if (part === "S") h2hFail("E_H2HX_INPUT", "arm " + s.arm + " runs in Codex, not on the Claude Code path");
  if (i.home.arm !== s.arm) h2hFail("E_H2H_SESSION_INPUT", "the home is arm " + i.home.arm + "'s, not " + s.arm + "'s");
  const l = h2hStageLimits(s.item, i.allowance, x);
  return {
    schema: "h2h-config.v1", arm: s.arm, turns: extScriptedTurns(s.arm, s.entry, statement, x, p), continuation: p.texts.continuation, done_rule: p.done_rule, continuation_cap: p.continuation_cap, no_answer: p.texts.question_reply,
    limits: { allowance_usd: l.session_cap_usd, wall_sec: l.wall_limit_sec, max_turns: l.max_turns, ...QUIET }, disallowed_tools: [...p.disallowed_tools],
    env: { ...claudeEnv(p), ...extSessionEnv(s.arm, x), ...(kind === "B1" ? BROWSER.env : {}) }, home: i.home.dir, home_rule: i.home.home_rule, ...(part === "P" ? { generations: true } : {}),
  };
}

/** One part P or L attempt's task dir, config, manifest and overlay under dir, as sessions/run.ts runCopy writes the base
 *  post's; returns Harbor's argv and env. The arm goes to the driver as h2hx:<arm> with the route's model. */
export function extClaudeRunCopy(i: ExtSessionInput, attempt: 1 | 2, dir: string, x: ExtPrereg = readExtPrereg(), p: H2hPrereg = readPrereg()): { argv: string[]; env: Record<string, string>; config: ReturnType<typeof extClaudeConfig> } {
  const s = i.session;
  const u = i.unit;
  const route = claudeRoute(s.arm, x);
  if (route.model !== h2hStageModel(s.item, x)) h2hFail("E_H2HX_INPUT", "item " + s.item + " runs " + h2hStageModel(s.item, x) + ", but arm " + s.arm + "'s route runs " + route.model);
  const config = extClaudeConfig(i, u.statement, u.unit.kind, x, p);
  const task = join(dir, "task");
  mkdirSync(join(task, "environment"), { recursive: true });
  writeFileSync(join(task, "environment/Dockerfile"), "FROM " + u.image.tag + "\n");
  const budget = h2hBudget(config.limits.wall_sec, config.turns.length + config.continuation_cap);
  writeFileSync(join(task, "task.toml"), ["version = \"1.0\"", "", "[agent]", "timeout_sec = " + budget.agent_s, "", "[environment]", "docker_image = " + JSON.stringify(u.image.tag), "build_timeout_sec = " + BOUNDS.build_s, ""].join("\n"));
  writeFileSync(join(task, "instruction.md"), "The arm's turns carry the task.\n");
  const label = s.unit + "/" + s.arm + "/" + s.stage + "/" + s.index;
  const taskJson = join(dir, "task.json");
  writeFileSync(taskJson, JSON.stringify({ repo_dir: u.repo_dir, commits: u.image.commits, base_commit: u.image.head, kind: "H2H" }));
  const wrapper = i.browserWrapper ?? join(ROOT, BROWSER.wrapper_repo_path);
  if (u.unit.kind === "B1" && !existsSync(wrapper)) h2hFail("E_H2H_SESSION_INPUT", "B1 unit " + u.unit.id + " needs the Chromium wrapper at " + wrapper);
  const h2hJson = join(dir, "h2h-config.json");
  writeFileSync(h2hJson, JSON.stringify(config, null, 1) + "\n");
  const compose = join(dir, "h2h.compose.yaml");
  writeFileSync(compose, JSON.stringify(composeOverlay(u.unit.kind, i.claude ?? H2H_CLAUDE, wrapper, { volume: i.runtime.volume, path: runtimePath(u.image.tag) }), null, 1) + "\n");
  const manifest = join(dir, "images.json");
  const manifestSha = sessionManifest(manifest, label, u.image);
  const armTar = join(dir, "arm.tar");
  writeFileSync(armTar, Buffer.alloc(10240));
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !KEYS.test(k))) as Record<string, string>;
  env.ANTHROPIC_API_KEY = "placeholder-not-a-key";
  env.HARBOR_TELEMETRY = "0";
  env.PYTHONPATH = [join(import.meta.dir, "../sessions"), join(ROOT, "lanes/outcome-skills/pfchecks"), join(ROOT, "lanes/real-outcome/agent"), join(ROOT, "quick/laneb/runner/agent")].join(":");
  env.PYTHONDONTWRITEBYTECODE = "1";
  const ak: Record<string, string> = {
    skip_install: "true", task_json: taskJson, h2h_config: h2hJson, arm: EXT_PREFIX + s.arm, arm_tar: armTar, upstream_model: route.model, control_url: i.control, ledger: "u4", task_label: label, trial_n: "1",
    ...(attempt === 2 ? { rerun: SESSION_RERUN } : {}), image_id: u.image.image_id, manifest, manifest_sha256: manifestSha, repo_dir: u.repo_dir, workdir: u.work_dir, ...(i.probeNode !== undefined ? { probe_node: i.probeNode } : {}),
  };
  const argv = ["run", "-y", "-p", task, "-a", "h2h_agent:H2hAgent", "-m", route.harbor_model, "--base-url", /^https?:\/\//.test(i.proxy) ? i.proxy : "http://" + i.proxy, ...Object.entries(ak).flatMap(([k, v]) => ["--ak", k + "=" + v]), "-e", "docker", "--extra-docker-compose", join(ROOT, "quick/laneb/runner/agent-caps.compose.yaml"), "--extra-docker-compose", compose, "-o", join(dir, "jobs"), "--job-name", (i.jobName ?? "h2hx-" + s.unit + "-" + s.index) + "-a" + attempt, "--disable-verification"];
  return { argv, env, config };
}

/** The lines of a JSON-lines file, plain or gzip. */
const jsonLines = (f: string): Record<string, any>[] => {
  const raw = readFileSync(f);
  return (f.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8").split("\n").flatMap((l) => {
    try {
      const v = JSON.parse(l);
      return v && typeof v === "object" && !Array.isArray(v) ? [v] : [];
    } catch {
      return [];
    }
  });
};

/** A part S attempt's rollout files (root thread first), from its summary's codex_sessions under dir/codex-sessions. */
export const rollouts = (dir: string, s: Record<string, any> | null): string[] => ((s?.codex_sessions ?? []) as unknown[]).filter((r): r is string => typeof r === "string").map((r) => join(dir, "codex-sessions", r)).filter(existsSync);

/** The first request's input as the root rollout records it: its developer and user items (the tools item and the
 *  messages) before the first item of any other role, as JSON. Codex sends AGENTS.md text as such a message, and the
 *  rollout records it as sent. */
export function firstInput(files: readonly string[]): string | undefined {
  if (!files.length) return undefined;
  const items: unknown[] = [];
  for (const r of jsonLines(files[0]!)) {
    if (r.type !== "response_item") continue;
    if (r.payload?.role !== "developer" && r.payload?.role !== "user") break;
    items.push(r.payload);
  }
  return items.length ? JSON.stringify(items) : undefined;
}

/** The Codex CLI version the root rollout's session_meta records, or null. */
export function rolloutVersion(files: readonly string[]): string | null {
  const meta = files.length ? jsonLines(files[0]!).find((r) => r.type === "session_meta") : undefined;
  return typeof meta?.payload?.cli_version === "string" ? meta.payload.cli_version : null;
}

/** A lookup that answers from an attempt's generations.jsonl, as h2h_turns.py read each record through the slot. */
export function fileLookup(file: string): { ids: string[]; lookup: GenerationLookup } {
  const rows = existsSync(file) ? jsonLines(file) : [];
  const by = new Map(rows.filter((r) => typeof r.id === "string").map((r) => [r.id as string, { status: Number(r.status ?? 0), text: String(r.text ?? ""), generation_id: typeof r.generation_id === "string" ? r.generation_id : null }]));
  return { ids: [...by.keys()], lookup: async (id) => by.get(id) ?? { status: 0, text: "", generation_id: null } };
}

/** The extension's session record: the base record with the extension's fields. */
export type ExtSessionRecord = Omit<H2hSessionRecord, "arm"> & { arm: ExtArm; part: Part; host: "codex" | "claude-code"; codex_version?: string | null; unanswered_questions?: number; base_arm?: H2hArm; served_by?: string[] };

/** One attempt's exposure, by part. */
function extExposure(i: ExtSessionInput, ev: string, summary: Record<string, any> | null, x: ExtPrereg): ExtSessionRecord["exposure"] {
  const s = i.session;
  const first = summary?.slot?.close?.first_request;
  if (s.part === "S") {
    const files = rollouts(ev, summary);
    if (!files.length) return null;
    const m = readMarkers();
    return codexExposure(s.arm as SArm, s.entry, readCodexEvents(files), { markers: m, files: sessionFiles(i, ev, m), firstRequest: firstInput(files), agentsMd: x.parts.S.agents_md[s.arm] });
  }
  if (s.part === "P") return readExposure({ session: { ...s, arm: i.home.base_arm! } as unknown as H2hPlanned, installs: i.installs, unit: i.unit }, ev);
  const files = ["sdk-messages.jsonl", "claude-session.jsonl"].map((f) => join(ev, f)).filter(existsSync);
  return files.length ? lExposure(s.arm as LArm, s.entry, readEvents(files), first ?? null, x) : null;
}

/** Runs one planned extension session: the home against its pin, Harbor, the retry rule within the one session allowance,
 *  the halt rules, part P's served-by check, exposure, and out/session.json. */
export async function runExtSession(i: ExtSessionInput, x: ExtPrereg = readExtPrereg()): Promise<{ record: ExtSessionRecord; file: string }> {
  const s = i.session;
  if (existsSync(i.out)) h2hFail("E_H2H_SESSION_INPUT", i.out + " exists; each session writes a new run dir");
  if (i.home.arm !== s.arm) h2hFail("E_H2H_SESSION_INPUT", "the home is arm " + i.home.arm + "'s, not " + s.arm + "'s");
  if (partOf(s.arm) !== s.part) h2hFail("E_H2HX_INPUT", "arm " + s.arm + " is not part " + s.part + "'s");
  checkExtHome(i.home);
  mkdirSync(i.out, { recursive: true });
  const p = readPrereg();
  const host = s.part === "S" ? "codex" : "claude-code";
  const allowance = h2hStageLimits(s.item, i.allowance, x).session_cap_usd;
  const model = h2hStageModel(s.item, x);
  const started = Date.now();
  const usage: AttemptUsage[] = [];
  const served = new Set<string>();
  let record: ExtSessionRecord | null = null;
  for (const attempt of [1, 2] as const) {
    const dir = join(i.out, "a" + attempt);
    mkdirSync(dir, { recursive: true });
    const { argv, env, config } = s.part === "S" ? extRunCopy({ session: s, unit: i.unit, home: i.home.dir, control: i.control, proxy: i.proxy, runtime: i.runtime, allowance: i.allowance, browserWrapper: i.browserWrapper, probeNode: i.probeNode, jobName: i.jobName }, attempt, dir, x, p) : extClaudeRunCopy(i, attempt, dir, x, p);
    const { exit, killed } = await harbor(i.harbor ?? "harbor", argv, env, h2hBudget(config.limits.wall_sec, config.turns.length + config.continuation_cap).timer_ms, join(dir, "harbor.log"));
    const ev = find(join(dir, "jobs"), "evaluator");
    const summary = ev && existsSync(join(ev, SUMMARY)) ? withRefusalFallback(JSON.parse(readFileSync(join(ev, SUMMARY), "utf8")) as Record<string, any>, join(ev, "sdk-messages.jsonl")) : null;
    if (!summary) writeFileSync(join(dir, "attempt.json"), JSON.stringify({ harbor_exit: exit, killed }) + "\n");
    await haltCheck(i, attempt, summary, ev, dir);
    if (typeof summary?.refused === "string" && summary.refused.startsWith("E_H2H_SESSION_ARM")) h2hFail("E_H2H_SESSION_ARM", summary.refused.slice("E_H2H_SESSION_ARM ".length) + "; " + dir);
    if (s.part === "P" && ev) {
      const g = fileLookup(join(ev, "generations.jsonl"));
      const session = existsSync(join(ev, "claude-session.jsonl")) ? answerIds(readFileSync(join(ev, "claude-session.jsonl"), "utf8")) : [];
      const checked = await checkServedBy([...new Set([...session, ...g.ids])], g.lookup, claudeRoute(s.arm, x));
      if (typeof summary?.generations_error === "string") h2hFail("E_H2HX_ROUTE_RECORD", "the generation lookup failed (" + summary.generations_error + "), so not every answer was checked; part P's items stop for the Captain; " + dir);
      const spent = attemptUsage(attempt, summary, allowance).spent_micros;
      if (checked.checked === 0 && spent > 0) h2hFail("E_H2HX_ROUTE_RECORD", "the slot spent $" + (spent / 1_000_000).toFixed(2) + " and no answer had a generation record to check; part P's items stop for the Captain; " + dir);
      for (const n of checked.served_by) served.add(n);
    }
    if (ev) for (const f of KEEP[host]) if (existsSync(join(ev, f))) copyFileSync(join(ev, f), join(i.out, f));
    if (ev && host === "codex" && existsSync(join(ev, "codex-sessions"))) cpSync(join(ev, "codex-sessions"), join(i.out, "codex-sessions"), { recursive: true, force: true });
    usage.push(attemptUsage(attempt, summary, allowance));
    const again = retries(endOf(summary), attempt, summary);
    const stop = again && !retryCovered(i.capLeftUsd, allowance, usage) ? "the retry needs a full $" + allowance + " allowance and the spend cap had $" + i.capLeftUsd!.toFixed(2) + " left for this session, of which the first attempt spent $" + (usage[0]!.spent_micros / 1_000_000).toFixed(2) : undefined;
    const base = sessionRecord(s as unknown as H2hPlanned, summary, { model, attempt, exposure: ev ? extExposure(i, ev, summary, x) : null, wall_ms: Date.now() - started, home_tree_sha256: i.home.home_tree_sha256, usage: [...usage], ...(stop ? { retry_cap_stop: stop } : {}) });
    const roll = ev && host === "codex" ? rollouts(ev, summary) : [];
    const questions = Object.values((summary?.questions ?? {}) as Record<string, { unanswered?: number }>).reduce((n, q) => n + (q.unanswered ?? 0), 0);
    record = {
      ...base, arm: s.arm, part: s.part, host,
      ...(host === "codex" ? { transcript: roll.length ? join("codex-sessions", (summary!.codex_sessions as string[])[0]!) : "codex-events.jsonl", codex_version: rolloutVersion(roll) ?? (typeof summary?.codex_version === "string" ? summary.codex_version : null), unanswered_questions: questions } : {}),
      ...(s.part === "P" ? { base_arm: i.home.base_arm!, served_by: [...served].sort() } : {}),
    };
    if (!again || stop) break;
  }
  const file = join(i.out, "session.json");
  writeSessionRecord(file, record! as unknown as H2hSessionRecord);
  if (record!.end === "cap_stop") h2hFail("CAP_STOP", s.unit + "/" + s.arm + " stopped at the cap: " + (record!.retry_cap_stop ?? "the driver refused its slot") + ", so the part ends incomplete and is not retried; " + file);
  return { record: record!, file };
}
