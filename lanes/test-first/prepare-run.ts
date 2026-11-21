// Copyright (c) 2026 Garry Tan. MIT License.
// B2's prepare step, which L1's part machinery runs for each part, relaunch and attempt 2 (plans.ts names it as the profile's
// prepareRun): Lane B's prepare-run.ts with the same arguments and env, then B2's changes to its run dir.
// - Every part: proxy.json becomes B2's (proxy.json beside this file: Anthropic for Opus, OpenRouter for particle-1 and the
//   OpenAI Responses API for gpt-6.2-sol), and the manifest records its digest and the part's host.
// - A Sol part runs on Codex: Lane B's prepare gets part R's task setup (B1's lines plus Codex 0.170.0, TASK_SETUP below), and
//   each job.json agent becomes B2's Codex agent (quick/laneb/runner/agent/laneb_b2_codex.py, Lane B's Codex agent with the
//   typed prompt). Claude Code's own kwargs go (max_output_tokens, sdk_max_turns, system_prompt, gstack_hooks); the session's
//   Codex argv, resume argv and env are the shared driver's (src/adapters/codex/driver.ts codexArgs and codexEnv): gpt-6.2-sol
//   at effort low, the hook-trust bypass and GSTACK_SESSION_KIND=unattended in the gstack arms only.
//   bun lanes/test-first/prepare-run.ts <run dir> <job name> <models csv> <arms csv> <arm tar dir> <attempts> <concurrent>
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { codexArgs, codexEnv } from "../../src/adapters/codex/driver.ts";
import { ARM_DEFS, B2, CODEX, CODEX_BIN, CODEX_HOME, GSTACK, HERE, HOSTS, MODELS, QUESTION_REPLY, REPO, sha256, SOL_EFFORT, type Host } from "./pins.ts";

export const PROXY_CONFIG = join(REPO, HERE, "proxy.json");
export const AGENT = { name: "laneb-b2-codex", import_path: "laneb_b2_codex:LanebB2CodexAgent" } as const;
export const PROXY_SLOT = "laneb";
const DROP = ["max_output_tokens", "sdk_max_turns", "system_prompt", "gstack_hooks"];
const KEEP = ["skip_install", "arm", "arm_tar", "arm_sha256", "upstream_model", "session_cap_usd", "persona_path", "wrapper_path", "session_kind", "closing_line", "strip_snapshot", "repo_dir", "told_skill"];
const prepErr = (m: string): never => { throw new Error("E_B2_PREPARE " + m); };

/** The host a part's model runs on. */
export function hostOfModel(model: string): Host {
  const m = Object.values(MODELS).find((x) => x.id === model);
  return m ? m.host : prepErr("model " + model + " is not one of B2's");
}

/** The session's Codex argv and env for an arm (gstack: the hook-trust bypass and the unattended session kind). */
export function codexSession(gstack: boolean) {
  const o = { model: MODELS.sol.id, provider: "openai" as const, proxy: { baseUrl: "http://__GATEWAY__:8787", slot: PROXY_SLOT, token: "" }, effort: SOL_EFFORT, settings: {}, hookTrust: gstack };
  return { argv: codexArgs(o), resume: codexArgs(o, "__THREAD__"), env: codexEnv({ proxy: { ...o.proxy, token: "__SESSION_TOKEN__" }, ...(gstack ? { sessionKind: "unattended" as const } : {}) }) };
}

/** One Lane B agent entry as B2's Codex agent for its arm, with the arm manifest's records. */
export function codexAgent(agent: { name: string; import_path: string; kwargs: Record<string, unknown> }, manifest: { tree: { digest: string }; prompt_input?: { sha256: string } }) {
  const k = agent.kwargs, d = ARM_DEFS[String(k.arm)];
  if (!d || d.host !== "codex") prepErr("job.json names arm " + JSON.stringify(k.arm) + ", not one of B2's Codex arms");
  const extra = Object.keys(k).filter((x) => !KEEP.includes(x) && !DROP.includes(x));
  if (extra.length) prepErr("the " + d!.label + " agent carries kwargs B2's Codex agent does not take: " + extra.join(", "));
  if (String(k.told_skill ?? "") !== (d!.typed ? "prove-it" : "")) prepErr(d!.label + "'s told skill is " + JSON.stringify(k.told_skill ?? "") + ", not its arm's");
  const s = codexSession(d!.gstack);
  return {
    ...agent, name: AGENT.name, import_path: AGENT.import_path,
    kwargs: {
      ...Object.fromEntries(KEEP.filter((x) => x in k && !(x === "told_skill" && !k[x])).map((x) => [x, k[x]])),
      codex_bin: CODEX_BIN, codex_argv: s.argv, codex_resume_argv: s.resume, codex_env: s.env, codex_home: CODEX_HOME, hook_trust: d!.gstack,
      gstack_config: d!.gstack ? "/root/gstack/bin/gstack-config" : "", gstack_pin: d!.gstack ? GSTACK.sha : "", arm_tree_sha256: manifest.tree.digest, prompt_input_sha256: manifest.prompt_input?.sha256 ?? "", question_reply: QUESTION_REPLY,
    },
  };
}

/** Rewrite a prepared run dir for B2: its proxy config, and for a Codex part its agents. */
export function b2Run(run: string, host: Host) {
  copyFileSync(PROXY_CONFIG, join(run, "proxy.json"));
  const job = JSON.parse(readFileSync(join(run, "job.json"), "utf8"));
  const wrong = job.agents.map((a: any) => String(a.kwargs?.arm)).filter((a: string) => ARM_DEFS[a]?.host !== host);
  if (wrong.length) prepErr("a " + host + " part names arms of another host: " + wrong.join(", "));
  if (host === "codex") {
    const manifestOf = (arm: string) => JSON.parse(readFileSync(join(REPO, "quick/laneb", B2.armManifests, ARM_DEFS[arm]!.tar + ".json"), "utf8"));
    job.agents = job.agents.map((a: any) => codexAgent(a, manifestOf(String(a.kwargs?.arm))));
    writeFileSync(join(run, "job.json"), JSON.stringify(job, null, 2) + "\n");
  }
  const m = JSON.parse(readFileSync(join(run, "manifest.json"), "utf8"));
  m.proxy_config_sha256 = sha256(readFileSync(join(run, "proxy.json")));
  m.b2 = { host, proxy_config: HERE + "/proxy.json", task_setup_sha256: HOSTS[host].taskSetup.sha256, ...(host === "codex" ? { agent: AGENT.import_path, codex: CODEX.version, codex_bin: CODEX_BIN, model: MODELS.sol.id, effort: SOL_EFFORT, question_reply_sha256: sha256(QUESTION_REPLY) } : {}) };
  writeFileSync(join(run, "manifest.json"), JSON.stringify(m, null, 2) + "\n");
}

if (import.meta.main) {
  const args = Bun.argv.slice(2);
  if (args.length !== 7) throw new Error("E_USAGE usage: prepare-run.ts <run dir> <job name> <models csv> <arms csv> <arm tar dir> <attempts> <concurrent>");
  const host = hostOfModel(args[2]!);
  const env = { ...process.env, ...(host === "codex" ? { TASK_SETUP: HOSTS.codex.taskSetup.file, TASK_SETUP_SHA256: HOSTS.codex.taskSetup.sha256 } : {}) } as Record<string, string>;
  const r = Bun.spawnSync([process.execPath, process.env.B2_LANEB_PREPARE ?? join(REPO, "quick/laneb/runner/prepare-run.ts"), ...args], { env, stdout: "inherit", stderr: "inherit" });
  if (r.exitCode !== 0) process.exit(r.exitCode ?? 1);
  b2Run(resolve(args[0]!), host);
  console.log(resolve(args[0]!) + ": B2's " + host + " part on " + HERE + "/proxy.json");
}
