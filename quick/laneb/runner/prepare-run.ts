// Builds a run directory for one Lane B batch: materialized tasks (digest-checked against
// tasks/tasks.json), arm tarballs, the proxy config and a Harbor JobConfig whose paths point
// at the VM layout launch.sh syncs (runner at <vm>/runner, run dir at <vm>/run).
// Usage: bun prepare-run.ts <run dir> <job name> <models csv> <arms csv> <arm tar dir> <attempts> <concurrent>
// An arms entry may set agent options per arm (grid.ts armSpec), e.g. gstack:told=investigate:system_prompt=claude-code-preset;
// the manifest records every arm's system_prompt, session_kind and told skill.
// Env: TB2 (terminal-bench-2 checkout at the pinned commit), VM_ROOT (the VM work dir, default in the code), NETWORK (default allowlist),
// TASK_SET (tb2, the default, or swebv-r3: R3's SWE-bench Verified list, materialized from SWEBV, a harbor-datasets checkout
// at the registry pin, with the patch exported from /testbed, less R3's drop list), TASKS (a comma list from the task set,
// default all; a task on R3's drop list is refused; or swerebench-r3a4: R3 amendment 4's SWE-rebench pool, materialized from
// SWEREBENCH, the pinned Harbor's export of the Hub package, each task checked against tasks/swerebench-r3a4.json),
// CELLS (a cells*.json file in config/, default cells.json), ARM_MANIFESTS (the arm manifest directory under quick/laneb,
// default arms/manifests).
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { loadR3Drops, loadRebenchPool, loadSwebvTasks, materializeRebench, materializeSwebv, materializeTb2, R3_BAND_SHA256, R3_DROP_FILE, R3_DROP_SHA256, R3A4_POOL_FILE, R3A4_POOL_SHA256 } from "./materialize.ts";
import { armSpec, jobConfig, PROCEDURE_LINES } from "./grid.ts";

const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

// Copies every arm's tar into <run>/arms. Each must be the preregistered bytes: its tar sha256 must equal the committed
// manifest's. Arms that share a tar (tar=<name>) share one copy of it in the run dir and one manifest.
export function stageArms(armsCsv: string, o: { armDir: string; run: string; root: string; armManifests: string; vm: string }) {
  const arms = armsCsv.split(",").map((entry) => {
    const { name, tar_name, ...options } = armSpec(entry);
    const file = tar_name ?? name;
    const tar = `${o.vm}/run/arms/${file}.tar`;
    const manifestPath = join(o.root, o.armManifests, `${file}.json`);
    const want = process.env.ALLOW_UNREGISTERED_ARMS === "1" && !existsSync(manifestPath) ? null : JSON.parse(readFileSync(manifestPath, "utf8")).tar.sha256;
    const gz = join(o.armDir, `${file}.tar.gz`);
    let got: string;
    let extra = {};
    if (existsSync(gz)) {
      copyFileSync(gz, join(o.run, "arms", `${file}.tar.gz`));
      got = Bun.spawnSync(["sh", "-c", 'gzip -dc "$1" | sha256sum', "sh", gz]).stdout.toString().split(" ")[0]!;
      extra = { gz_sha256: sha256(gz) };
    } else {
      copyFileSync(join(o.armDir, `${file}.tar`), join(o.run, "arms", `${file}.tar`));
      got = sha256(join(o.run, "arms", `${file}.tar`));
    }
    if (want !== null && got !== want) throw new Error(`arm ${name}: tar sha256 ${got} is not the preregistered ${want} (${o.armManifests}/${file}.json)`);
    return { name, tar, sha256: got, ...extra, options, ...(tar_name ? { tar_name } : {}) };
  });
  if (new Set(arms.map((a) => a.name)).size !== arms.length) throw new Error(`E_USAGE arms ${armsCsv}: an arm is named twice`);
  return arms;
}

if (import.meta.main) {
  const [runArg, jobName, modelsCsv, armsCsv, armDir, attempts, concurrent] = Bun.argv.slice(2);
  if (!concurrent) throw new Error("E_USAGE usage: prepare-run.ts <run dir> <job name> <models csv> <arms csv> <arm tar dir> <attempts> <concurrent>");
  const here = import.meta.dir;
  const root = resolve(here, "..");
  const run = resolve(runArg);
  const tb2 = process.env.TB2 ?? join(process.env.HOME ?? "", ".capy/work/ref/terminal-bench-2");
  const vm = process.env.VM_ROOT ?? "/home/ubi/work";
  const network = (process.env.NETWORK ?? "allowlist") as "allowlist" | "public";
  const taskSet = process.env.TASK_SET ?? "tb2";
  if (taskSet !== "tb2" && taskSet !== "swebv-r3" && taskSet !== "swerebench-r3a4") throw new Error(`E_USAGE TASK_SET ${taskSet} is not tb2, swebv-r3 or swerebench-r3a4`);
  const cellsFile = process.env.CELLS ?? "cells.json";
  if (!/^cells[\w.-]*\.json$/.test(cellsFile) || !existsSync(join(root, "config", cellsFile))) throw new Error(`E_USAGE CELLS ${cellsFile} is not a cells*.json file in config/`);
  const armManifests = process.env.ARM_MANIFESTS ?? "arms/manifests";
  if (!/^[\w/-]+$/.test(armManifests) || !existsSync(join(root, armManifests))) throw new Error(`E_USAGE ARM_MANIFESTS ${armManifests} is not a directory under ${root}`);
  const cells = JSON.parse(readFileSync(join(root, "config", cellsFile), "utf8"));
  const runtimeStages = readFileSync(join(here, "runtime-stages.Dockerfile"), "utf8");
  const runtimeCopy = readFileSync(join(here, "runtime-copy.Dockerfile"), "utf8");
  const band = taskSet === "swebv-r3" ? loadSwebvTasks(join(root, "tasks/swebv-r3.txt"), join(root, "tasks/swebv-r3.json"), R3_BAND_SHA256) : [];
  const drops = taskSet === "swebv-r3" ? loadR3Drops(join(root, R3_DROP_FILE), R3_DROP_SHA256, band.map((t) => t.task_id)) : [];
  const swebv = band.filter((t) => !drops.some((d) => d.task_id === t.task_id));
  const rebench = taskSet === "swerebench-r3a4" ? loadRebenchPool(join(root, R3A4_POOL_FILE), R3A4_POOL_SHA256) : [];
  const all: string[] = taskSet === "swebv-r3" ? swebv.map((t) => t.task_id) : taskSet === "swerebench-r3a4" ? rebench.map((t) => t.task_id) : JSON.parse(readFileSync(join(root, "tasks/final.json"), "utf8")).tasks;
  // tb2 also admits, when TASKS names it, any task tasks/tasks.json holds a digest for: the reserves and quick look 3's
  // extension, which the L1 TB2 twin draws on (L1 Amendment C).
  const selection = taskSet === "tb2" ? JSON.parse(readFileSync(join(root, "tasks/tasks.json"), "utf8")) : null;
  const known: string[] = selection ? [...all, ...[...selection.main, ...selection.reserves, ...(selection.extension ?? [])].map((t: any) => t.task_id)] : all;
  const final = process.env.TASKS ? process.env.TASKS.split(",") : all;
  for (const id of final) {
    const drop = drops.find((d) => d.task_id === id);
    if (drop) throw new Error(`E_USAGE task ${id} is on R3's drop list (${drop.reason}); it never runs`);
    if (!known.includes(id)) throw new Error(`E_USAGE task ${id} is not in the ${taskSet} task set`);
  }
  if (new Set(final).size !== final.length) throw new Error(`E_USAGE TASKS names a task twice`);
  if (existsSync(run)) throw new Error(`${run} exists; use a fresh run directory`);
  mkdirSync(join(run, "arms"), { recursive: true });

  const tasks: Record<string, unknown> = {};
  if (taskSet === "swerebench-r3a4") {
    const exportDir = process.env.SWEREBENCH ?? join(process.env.HOME ?? "", ".capy/work/ref/swe-rebench-leaderboard");
    for (const id of final) tasks[id] = materializeRebench(exportDir, rebench.find((t) => t.task_id === id)!, join(run, "tasks", id), { runtimeStages, runtimeCopy, network });
  } else if (taskSet === "swebv-r3") {
    const root = process.env.SWEBV ?? join(process.env.HOME ?? "", ".capy/work/ref/harbor-datasets");
    for (const id of final) tasks[id] = materializeSwebv(root, swebv.find((t) => t.task_id === id)!, join(run, "tasks", id), { runtimeStages, runtimeCopy, network });
  } else {
    const expected = new Map<string, string>([...selection.main, ...selection.reserves, ...(selection.extension ?? [])].map((t: any) => [t.task_id, t.digest.replace(/^sha256:/, "")]));
    for (const id of final) {
      const m = materializeTb2(join(tb2, id), join(run, "tasks", id), { runtimeStages, runtimeCopy, network });
      if (m.sourceDigest !== expected.get(id)) throw new Error(`${id}: source digest ${m.sourceDigest} differs from tasks.json ${expected.get(id)}`);
      tasks[id] = m;
    }
  }
  const arms = stageArms(armsCsv, { armDir: armDir!, run, root, armManifests, vm });
  const models = modelsCsv.split(",").map((id) => {
    const m = cells.models.find((c: any) => c.id === id);
    if (!m) throw new Error(`unknown model ${id}`);
    return m;
  });
  copyFileSync(join(root, "config/proxy.json"), join(run, "proxy.json"));
  const job = jobConfig({
    job_name: jobName, tasks_dir: `${vm}/run/tasks`, tasks: final, models, arms: arms.map(({ name, tar, sha256, options }) => ({ name, tar, sha256, ...options })),
    ...(cells.sdk_max_turns ? { sdk_max_turns: cells.sdk_max_turns } : {}),
    attempts: Number(attempts), n_concurrent: Number(concurrent), agent_dir: `${vm}/runner/agent`, runner_dir: `${vm}/runner`,
    base_url: "http://__GATEWAY__:8787", max_output_tokens: cells.max_output_tokens, verifier_timeout_multiplier: cells.verifier_timeout_multiplier,
    ...(taskSet === "swebv-r3" || taskSet === "swerebench-r3a4" ? { repo_dir: "/testbed" } : {}),
  });
  writeFileSync(join(run, "job.json"), JSON.stringify(job, null, 2) + "\n");
  if (process.env.ORACLE === "1") {
    const oracle = { ...job, job_name: `${jobName}-oracle`, n_attempts: 1, agents: [{ name: "oracle" }] };
    writeFileSync(join(run, "oracle.json"), JSON.stringify(oracle, null, 2) + "\n");
  }
  const git = (args: string[]) => Bun.spawnSync(["git", "-C", root, ...args]).stdout.toString().trim();
  const manifest = {
    job_name: jobName, created_at: new Date().toISOString(), network, task_set: taskSet, cells_file: cellsFile, arm_manifests: armManifests,
    git_head: git(["rev-parse", "HEAD"]), git_dirty: git(["status", "--porcelain", "--", "."]) !== "",
    wrapper_sha256: sha256(join(here, "prompt-wrapper.md")), persona_sha256: sha256(join(here, "agent/persona.json")),
    proxy_config_sha256: sha256(join(run, "proxy.json")), cells,
    arms: arms.map(({ options, ...arm }) => ({ ...arm, system_prompt: options.system_prompt ?? "sdk-default", session_kind: options.session_kind ?? "", told_skill: options.told ?? "",
      ...(options.gstack_hooks ? { gstack_hooks: options.gstack_hooks } : {}),
      ...(options.procedure_line ? { procedure_line: options.procedure_line, procedure_line_sha256: createHash("sha256").update(PROCEDURE_LINES[options.procedure_line as keyof typeof PROCEDURE_LINES]).digest("hex") } : {}) })), tasks,
  };
  writeFileSync(join(run, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`${run}: ${final.length} tasks x ${models.length} models x ${arms.length} arms x ${attempts} attempts, git ${manifest.git_head.slice(0, 7)}${manifest.git_dirty ? " (dirty)" : ""}`);
}
