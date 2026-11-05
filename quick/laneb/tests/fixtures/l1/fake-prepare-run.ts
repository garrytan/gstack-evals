// Fake prepare-run.ts for l1-launch.test.ts: the same arguments, a job.json over TASKS x arms (each arm's label in its
// agent's kwargs, as grid.ts writes it), and each task's instruction.md with nothing else materialized. FAKE_QUOTE_TASK names
// a task whose instruction quotes the route hook's line.
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
const [run, jobName, model, armsCsv, , attempts, concurrent] = Bun.argv.slice(2) as string[];
if (existsSync(run!)) throw new Error(run + " exists");
mkdirSync(join(run!, "arms"), { recursive: true });
const tasks = (process.env.TASKS ?? "").split(",");
const agents = armsCsv!.split(",").map((e) => ({ name: "laneb-claude-code", kwargs: { arm: e.split(":")[0], spec: e } }));
writeFileSync(join(run!, "job.json"), JSON.stringify({ job_name: jobName, n_attempts: Number(attempts), n_concurrent_trials: Number(concurrent), tasks: tasks.map((t) => ({ path: "/vm/run/tasks/" + t })), agents, model }) + "\n");
writeFileSync(join(run!, "manifest.json"), JSON.stringify({ arms: [] }) + "\n");
for (const t of tasks) {
  mkdirSync(join(run!, "tasks", t), { recursive: true });
  writeFileSync(join(run!, "tasks", t, "instruction.md"), "Fix the failing test in " + t + "." + (process.env.FAKE_QUOTE_TASK === t ? " The log says: gstack skill routing (UserPromptSubmit hook; matched /investigate." : "") + "\n");
}
