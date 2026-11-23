// Copyright (c) 2026 Garry Tan. MIT License.
// One part S attempt's Harbor inputs (wiki/plans/2026-11-21-geva-568-skill-pack-h2h-sol-particle-prereg sections 2 and 3),
// as sessions/run.ts runCopy writes a base attempt's. The h2h config adds host "codex" and the codex block h2h_agent.py
// sends to ext/h2h_codex.py: the runtime volume's sol-agent link, CODEX_HOME at /root/.codex, part S's model, effort and
// Codex version. The turns are extScriptedTurns', the continuation, DONE rule, cap and question reply the base post's,
// and the limits part S's. The compose overlay mounts part S's runtime volume (ext/runtimes.ts) and no Claude Code
// binary. Harbor runs the same h2h_agent with ext/ on PYTHONPATH and part S's model as upstream_model.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BOUNDS } from "../../pfchecks/run.ts";
import { sessionManifest } from "../../statemachines/image.ts";
import { h2hFail, readPrereg, type H2hPrereg } from "../prereg.ts";
import { BROWSER, type H2hUnit } from "../types.ts";
import { H2H_PREFIX } from "../sessions/driver.ts";
import type { HomeRule } from "../sessions/home.ts";
import { h2hBudget, QUIET, type H2hUnitInput } from "../sessions/run.ts";
import { runtimePath, RUNTIMES_DIR } from "../sessions/runtimes.ts";
import { SESSION_RERUN } from "../sessions/session.ts";
import { h2hStageLimits } from "./driver.ts";
import type { ExtPlanned } from "./plan.ts";
import { extItemOf, extScriptedTurns, partOf, readExtPrereg, type ExtArm, type ExtPrereg } from "./prereg.ts";
import { solAgentPath } from "./runtimes.ts";
import { keylessEnv } from "../../../../src/trial/env.ts";

const ROOT = join(import.meta.dir, "../../../..");
/** CODEX_HOME inside every part S session container. */
export const CODEX_HOME = "/root/.codex";

/** The home rule h2h_codex.py's check applies: s-none's home holds nothing, the gstack arms may hold gstack, the rest are packs. */
export const extHomeRule = (arm: ExtArm): HomeRule => (arm === "s-none" ? "none" : arm === "s-gstack" || arm === "s-gstack-line" ? "gstack" : "pack");

/** A part S attempt's inputs: the planned session, its unit, the arm's installed home dir (null for s-none), the driver's
 *  control URL and proxy, and part S's runtime volume. */
export interface ExtRunInput { session: ExtPlanned; unit: H2hUnitInput; home: string | null; control: string; proxy: string; runtime: { volume: string }; allowance?: number; browserWrapper?: string; probeNode?: string; jobName?: string }

/** The h2h config h2h_agent.py reads for an s-* arm. */
export function extConfig(i: Pick<ExtRunInput, "session" | "home" | "allowance">, statement: string, kind: H2hUnit["kind"], x: ExtPrereg = readExtPrereg(), p: H2hPrereg = readPrereg()) {
  const s = i.session;
  if (partOf(s.arm) !== "S") h2hFail("E_H2HX_CODEX_CONFIG", "arm " + s.arm + " is not part S's; only part S runs in Codex");
  if (s.arm === "s-none" && i.home !== null) h2hFail("E_H2HX_CODEX_CONFIG", "s-none runs with no installed home, not " + i.home);
  if (s.arm !== "s-none" && i.home === null) h2hFail("E_H2HX_CODEX_CONFIG", "arm " + s.arm + " needs its installed home");
  const S = x.parts.S;
  const l = h2hStageLimits(extItemOf(s.stage, s.arm, x), i.allowance, x);
  return {
    schema: "h2h-config.v1", arm: s.arm, host: "codex" as const, turns: extScriptedTurns(s.arm, s.entry, statement, x, p), continuation: p.texts.continuation, done_rule: p.done_rule, continuation_cap: p.continuation_cap, no_answer: p.texts.question_reply,
    limits: { allowance_usd: l.session_cap_usd, wall_sec: l.wall_limit_sec, max_turns: l.max_turns, ...QUIET }, disallowed_tools: [] as string[],
    env: { HOME: "/root", GSTACK_TELEMETRY_SOURCE: "eval", ...(kind === "B1" ? BROWSER.env : {}) }, home: i.home, home_rule: extHomeRule(s.arm),
    codex: { bin: solAgentPath(x), home: CODEX_HOME, model: S.model, effort: S.reasoning_effort, version: S.codex.version },
  };
}

/** The compose overlay: part S's runtime volume read-only at /opt/h2h-runtimes with its bin dir after the image's PATH,
 *  and the browser conditions on B1 units. No Claude Code binary is mounted. */
export function extComposeOverlay(kind: H2hUnit["kind"], wrapper: string, runtime: { volume: string; path: string }) {
  const b1 = kind === "B1";
  const volumes = [{ type: "volume", source: runtime.volume, target: RUNTIMES_DIR, read_only: true }, ...(b1 ? [{ type: "bind", source: wrapper, target: BROWSER.wrapper_container_path, read_only: true }] : [])];
  return { services: { main: { volumes, environment: { PATH: runtime.path, ...(b1 ? BROWSER.env : {}) }, ...(b1 ? { shm_size: BROWSER.shm_size } : {}) } }, volumes: { [runtime.volume]: { external: true as const } } };
}

/** One part S attempt's task dir, config, manifest and overlay under dir; returns Harbor's argv and env. */
export function extRunCopy(i: ExtRunInput, attempt: 1 | 2, dir: string, x: ExtPrereg = readExtPrereg(), p: H2hPrereg = readPrereg()): { argv: string[]; env: Record<string, string>; config: ReturnType<typeof extConfig> } {
  const s = i.session;
  const u = i.unit;
  if (!/^h2hx-runtimes-[0-9a-f]{16}$/.test(i.runtime.volume)) h2hFail("E_H2HX_CODEX_RUNTIME", "a part S session mounts part S's runtime volume (ext/runtimes.ts), not " + i.runtime.volume);
  const config = extConfig(i, u.statement, u.unit.kind, x, p);
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
  writeFileSync(compose, JSON.stringify(extComposeOverlay(u.unit.kind, wrapper, { volume: i.runtime.volume, path: runtimePath(u.image.tag) }), null, 1) + "\n");
  const manifest = join(dir, "images.json");
  const manifestSha = sessionManifest(manifest, label, u.image);
  const armTar = join(dir, "arm.tar");
  writeFileSync(armTar, Buffer.alloc(10240));
  const env = keylessEnv();
  env.ANTHROPIC_API_KEY = "placeholder-not-a-key";
  env.HARBOR_TELEMETRY = "0";
  env.PYTHONPATH = [import.meta.dir, join(import.meta.dir, "../sessions"), join(ROOT, "lanes/outcome-skills/pfchecks"), join(ROOT, "lanes/real-outcome/agent"), join(ROOT, "quick/laneb/runner/agent")].join(":");
  env.PYTHONDONTWRITEBYTECODE = "1";
  const model = x.parts.S.model;
  const ak: Record<string, string> = {
    skip_install: "true", task_json: taskJson, h2h_config: h2hJson, arm: H2H_PREFIX + s.arm, arm_tar: armTar, upstream_model: model, control_url: i.control, ledger: "u4", task_label: label, trial_n: "1",
    ...(attempt === 2 ? { rerun: SESSION_RERUN } : {}), image_id: u.image.image_id, manifest, manifest_sha256: manifestSha, repo_dir: u.repo_dir, workdir: u.work_dir, ...(i.probeNode !== undefined ? { probe_node: i.probeNode } : {}),
  };
  const argv = ["run", "-y", "-p", task, "-a", "h2h_agent:H2hAgent", "-m", "anthropic/" + model, "--base-url", /^https?:\/\//.test(i.proxy) ? i.proxy : "http://" + i.proxy, ...Object.entries(ak).flatMap(([k, v]) => ["--ak", k + "=" + v]), "-e", "docker", "--extra-docker-compose", join(ROOT, "quick/laneb/runner/agent-caps.compose.yaml"), "--extra-docker-compose", compose, "-o", join(dir, "jobs"), "--job-name", (i.jobName ?? "h2hx-" + s.unit + "-" + s.index) + "-a" + attempt, "--disable-verification"];
  return { argv, env, config };
}
