// Copyright (c) 2026 Garry Tan. MIT License.
// Part R's prepare step, which L1's part machinery runs for each part, relaunch and attempt 2 (plans.ts names it as the
// profile's prepareRun): Lane B's prepare-run.ts with the same arguments and env, then two changes to its run dir.
// 1. proxy.json becomes part R's route (pins.ts PROXY_CONFIG, the OpenAI Responses API), and the manifest records its digest.
// 2. Each job.json agent becomes the Codex agent (quick/laneb/runner/agent/laneb_codex.py). Claude Code's own kwargs go
//    (max_output_tokens, sdk_max_turns); the session's Codex argv, resume argv and env, built by the shared driver
//    (src/adapters/codex/driver.ts codexArgs and codexEnv) with the proxy's host as __GATEWAY__ (vm-run.sh fills it) and the
//    session token as __SESSION_TOKEN__ (the agent fills it), go in with the arm's records from its manifest.
//   bun lanes/codex-hooks/r/prepare-run.ts <run dir> <job name> <models csv> <arms csv> <arm tar dir> <attempts> <concurrent>
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { codexArgs, codexEnv, type CodexOptions } from "../../../src/adapters/codex/driver.ts";
import { AGENT, ARMS, CODEX, CODEX_BIN, CODEX_HOME, GSTACK, GSTACK_CONFIG, isArm, MODEL, PROXY_CONFIG, PROXY_SLOT, QUESTION_REPLY, R, R_EFFORT, R_SETTINGS, REPO, sha256 } from "./pins.ts";

const DROP = ["max_output_tokens", "sdk_max_turns"];
const KEEP = ["skip_install", "arm", "arm_tar", "arm_sha256", "upstream_model", "session_cap_usd", "persona_path", "wrapper_path", "session_kind", "closing_line", "strip_snapshot", "repo_dir"];

/** The session's Codex options for an arm, as the shared driver takes them. */
export const codexOptions = (gstack: boolean): Pick<CodexOptions, "model" | "provider" | "proxy" | "effort" | "settings" | "hookTrust"> =>
  ({ model: MODEL, provider: "openai", proxy: { baseUrl: "http://__GATEWAY__:8787", slot: PROXY_SLOT, token: "" }, effort: R_EFFORT, settings: { ...R_SETTINGS }, hookTrust: gstack });

/** One Lane B agent entry as the Codex agent for its arm, with the arm manifest's records. */
export function codexAgent(agent: { name: string; import_path: string; kwargs: Record<string, unknown> }, manifest: { tree: { digest: string }; prompt_input: { sha256: string } }) {
  const k = agent.kwargs, arm = String(k.arm);
  if (!isArm(arm)) throw new Error("E_CODEX_R_PREPARE job.json names arm " + JSON.stringify(k.arm) + ", not one of part R's");
  const extra = Object.keys(k).filter((x) => !KEEP.includes(x) && !DROP.includes(x));
  if (extra.length) throw new Error("E_CODEX_R_PREPARE the " + arm + " agent carries kwargs the Codex agent does not take: " + extra.join(", "));
  const gstack = ARMS[arm].gstack, o = codexOptions(gstack);
  return {
    ...agent, name: AGENT.name, import_path: AGENT.import_path,
    kwargs: {
      ...Object.fromEntries(KEEP.filter((x) => x in k).map((x) => [x, k[x]])),
      codex_bin: CODEX_BIN, codex_argv: codexArgs(o), codex_resume_argv: codexArgs(o, "__THREAD__"),
      codex_env: codexEnv({ proxy: { ...o.proxy, token: "__SESSION_TOKEN__" }, sessionKind: "unattended" }), codex_home: CODEX_HOME, hook_trust: gstack,
      gstack_config: gstack ? GSTACK_CONFIG : "", gstack_pin: gstack ? GSTACK.sha : "", arm_tree_sha256: manifest.tree.digest, prompt_input_sha256: manifest.prompt_input.sha256, question_reply: QUESTION_REPLY,
    },
  };
}

/** Rewrite a prepared run dir for part R. */
export function codexRun(run: string) {
  copyFileSync(PROXY_CONFIG, join(run, "proxy.json"));
  const job = JSON.parse(readFileSync(join(run, "job.json"), "utf8"));
  const manifests = new Map<string, any>();
  const manifestOf = (arm: string) => manifests.get(arm) ?? manifests.set(arm, JSON.parse(readFileSync(join(REPO, "quick/laneb", R.armManifests, ARMS[arm as keyof typeof ARMS].tar + ".json"), "utf8"))).get(arm);
  job.agents = job.agents.map((a: any) => codexAgent(a, manifestOf(String(a.kwargs?.arm))));
  writeFileSync(join(run, "job.json"), JSON.stringify(job, null, 2) + "\n");
  const m = JSON.parse(readFileSync(join(run, "manifest.json"), "utf8"));
  m.proxy_config_sha256 = sha256(readFileSync(join(run, "proxy.json")));
  m.codex_hooks_r = { proxy_config: "lanes/codex-hooks/r/proxy.json", agent: AGENT.import_path, codex: CODEX.version, codex_bin: CODEX_BIN, model: MODEL, effort: R_EFFORT, settings: R_SETTINGS, question_reply_sha256: sha256(QUESTION_REPLY) };
  writeFileSync(join(run, "manifest.json"), JSON.stringify(m, null, 2) + "\n");
}

if (import.meta.main) {
  const args = Bun.argv.slice(2);
  if (args.length !== 7) throw new Error("E_USAGE usage: prepare-run.ts <run dir> <job name> <models csv> <arms csv> <arm tar dir> <attempts> <concurrent>");
  const r = Bun.spawnSync([process.execPath, join(REPO, "quick/laneb/runner/prepare-run.ts"), ...args], { env: process.env as Record<string, string>, stdout: "inherit", stderr: "inherit" });
  if (r.exitCode !== 0) process.exit(r.exitCode ?? 1);
  codexRun(resolve(args[0]!));
  console.log(resolve(args[0]!) + ": the Codex agent, on " + PROXY_CONFIG.slice(REPO.length + 1));
}
