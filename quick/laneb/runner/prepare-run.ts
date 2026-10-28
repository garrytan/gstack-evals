// Builds a run directory for one Lane B batch: materialized tasks (digest-checked against
// tasks/tasks.json), arm tarballs, the proxy config and a Harbor JobConfig whose paths point
// at the VM layout launch.sh syncs (runner at <vm>/runner, run dir at <vm>/run).
// Usage: bun prepare-run.ts <run dir> <job name> <models csv> <arms csv> <arm tar dir> <attempts> <concurrent>
// Env: TB2 (terminal-bench-2 checkout at the pinned commit), VM_ROOT (the VM's work directory, default below),
// NETWORK (default allowlist), WRAPPER (a prompt-wrapper*.md file in this directory, default prompt-wrapper.md), TASKS (comma list from tasks/final.json, default all).
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { materializeTb2 } from "./materialize.ts";
import { jobConfig } from "./grid.ts";

const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

if (import.meta.main) {
  const [runArg, jobName, modelsCsv, armsCsv, armDir, attempts, concurrent] = Bun.argv.slice(2);
  if (!concurrent) throw new Error("E_USAGE usage: prepare-run.ts <run dir> <job name> <models csv> <arms csv> <arm tar dir> <attempts> <concurrent>");
  const here = import.meta.dir;
  const root = resolve(here, "..");
  const run = resolve(runArg);
  const tb2 = process.env.TB2 ?? join(process.env.HOME ?? "", ".capy/work/ref/terminal-bench-2");
  const vm = process.env.VM_ROOT ?? "/home/ubi/work";
  const network = (process.env.NETWORK ?? "allowlist") as "allowlist" | "public";
  const cells = JSON.parse(readFileSync(join(root, "config/cells.json"), "utf8"));
  const selection = JSON.parse(readFileSync(join(root, "tasks/tasks.json"), "utf8"));
  const finalAll: string[] = JSON.parse(readFileSync(join(root, "tasks/final.json"), "utf8")).tasks;
  const final = process.env.TASKS ? process.env.TASKS.split(",") : finalAll;
  for (const id of final) if (!finalAll.includes(id)) throw new Error(`E_USAGE task ${id} is not in tasks/final.json`);
  const wrapper = process.env.WRAPPER ?? "prompt-wrapper.md";
  if (!/^prompt-wrapper[\w-]*\.md$/.test(wrapper) || !existsSync(join(here, wrapper))) throw new Error(`E_USAGE WRAPPER ${wrapper} is not a prompt-wrapper*.md file in ${here}`);
  const expected = new Map<string, string>([...selection.main, ...selection.reserves].map((t: any) => [t.task_id, t.digest.replace(/^sha256:/, "")]));
  const runtimeStages = readFileSync(join(here, "runtime-stages.Dockerfile"), "utf8");
  const runtimeCopy = readFileSync(join(here, "runtime-copy.Dockerfile"), "utf8");
  if (existsSync(run)) throw new Error(`${run} exists; use a fresh run directory`);
  mkdirSync(join(run, "arms"), { recursive: true });

  const tasks: Record<string, unknown> = {};
  for (const id of final) {
    const m = materializeTb2(join(tb2, id), join(run, "tasks", id), { runtimeStages, runtimeCopy, network });
    if (m.sourceDigest !== expected.get(id)) throw new Error(`${id}: source digest ${m.sourceDigest} differs from tasks.json ${expected.get(id)}`);
    tasks[id] = m;
  }
  // Every arm must be the preregistered bytes: its tar sha256 must equal the committed manifest's.
  const arms = armsCsv.split(",").map((name) => {
    const tar = `${vm}/run/arms/${name}.tar`;
    const manifestPath = join(here, "../arms/manifests", `${name}.json`);
    const want = process.env.ALLOW_UNREGISTERED_ARMS === "1" && !existsSync(manifestPath) ? null : JSON.parse(readFileSync(manifestPath, "utf8")).tar.sha256;
    const gz = join(armDir, `${name}.tar.gz`);
    let got: string;
    let extra = {};
    if (existsSync(gz)) {
      copyFileSync(gz, join(run, "arms", `${name}.tar.gz`));
      got = Bun.spawnSync(["sh", "-c", 'gzip -dc "$1" | sha256sum', "sh", gz]).stdout.toString().split(" ")[0];
      extra = { gz_sha256: sha256(gz) };
    } else {
      copyFileSync(join(armDir, `${name}.tar`), join(run, "arms", `${name}.tar`));
      got = sha256(join(run, "arms", `${name}.tar`));
    }
    if (want !== null && got !== want) throw new Error(`arm ${name}: tar sha256 ${got} is not the preregistered ${want} (arms/manifests/${name}.json)`);
    return { name, tar, sha256: got, ...extra };
  });
  const models = modelsCsv.split(",").map((id) => {
    const m = cells.models.find((c: any) => c.id === id);
    if (!m) throw new Error(`unknown model ${id}`);
    return m;
  });
  copyFileSync(join(root, "config/proxy.json"), join(run, "proxy.json"));
  const job = jobConfig({
    job_name: jobName, tasks_dir: `${vm}/run/tasks`, tasks: final, models, arms: arms.map(({ name, tar, sha256 }) => ({ name, tar, sha256 })),
    attempts: Number(attempts), n_concurrent: Number(concurrent), agent_dir: `${vm}/runner/agent`, runner_dir: `${vm}/runner`, wrapper,
    base_url: "http://__GATEWAY__:8787", max_output_tokens: cells.max_output_tokens, verifier_timeout_multiplier: cells.verifier_timeout_multiplier,
  });
  writeFileSync(join(run, "job.json"), JSON.stringify(job, null, 2) + "\n");
  if (process.env.ORACLE === "1") {
    const oracle = { ...job, job_name: `${jobName}-oracle`, n_attempts: 1, agents: [{ name: "oracle" }] };
    writeFileSync(join(run, "oracle.json"), JSON.stringify(oracle, null, 2) + "\n");
  }
  const git = (args: string[]) => Bun.spawnSync(["git", "-C", root, ...args]).stdout.toString().trim();
  const manifest = {
    job_name: jobName, created_at: new Date().toISOString(), network,
    git_head: git(["rev-parse", "HEAD"]), git_dirty: git(["status", "--porcelain", "--", "."]) !== "",
    wrapper, wrapper_sha256: sha256(join(here, wrapper)), persona_sha256: sha256(join(here, "agent/persona.json")),
    proxy_config_sha256: sha256(join(run, "proxy.json")), cells, arms, tasks,
  };
  writeFileSync(join(run, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`${run}: ${final.length} tasks x ${models.length} models x ${arms.length} arms x ${attempts} attempts, git ${manifest.git_head.slice(0, 7)}${manifest.git_dirty ? " (dirty)" : ""}`);
}
