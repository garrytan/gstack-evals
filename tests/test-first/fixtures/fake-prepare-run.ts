// Fake prepare-run for B2's driven launch test (tests/test-first/launch.test.ts), after quick/laneb's fixture
// (quick/laneb/tests/fixtures/l1/fake-prepare-run.ts): the same arguments, a job.json over TASKS x arms with each arm's
// label, its told skill from the spec and the part's model in the agent's kwargs as Lane B's grid writes them, and each
// task's instruction.md, with nothing else materialized. B2's prepare-run.ts runs it as Lane B's prepare (B2_LANEB_PREPARE).
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const [run, jobName, model, armsCsv, , attempts, concurrent] = Bun.argv.slice(2) as string[];
if (existsSync(run!)) throw new Error(run + " exists");
mkdirSync(join(run!, "arms"), { recursive: true });
const tasks = (process.env.TASKS ?? "").split(",");
const agents = armsCsv!.split(",").map((e) => ({ name: "laneb-claude-code", import_path: "laneb_hooks:LanebHooksAgent", kwargs: { arm: e.split(":")[0], upstream_model: model, ...(/:told=([^:]+)/.test(e) ? { told_skill: e.match(/:told=([^:]+)/)![1] } : {}) } }));
writeFileSync(join(run!, "job.json"), JSON.stringify({ job_name: jobName, n_attempts: Number(attempts), n_concurrent_trials: Number(concurrent), tasks: tasks.map((t) => ({ path: "/vm/run/tasks/" + t })), agents, model }) + "\n");
writeFileSync(join(run!, "manifest.json"), JSON.stringify({ arms: [] }) + "\n");
for (const t of tasks) {
  mkdirSync(join(run!, "tasks", t), { recursive: true });
  writeFileSync(join(run!, "tasks", t, "instruction.md"), "Fix the failing test in " + t + ".\n");
}
