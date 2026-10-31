// Grades one seeded-mistake task on the work tree in the current directory. It is the check of every task in tasks.json:
//   bun "$SKILL_EVAL_FIXTURES/grade.ts" <task id>
// It copies the tree once per scenario and runs the repo's own CI entry, `bun run check`, in each copy, then the task's
// behavior oracle (<task id>/oracle.ts):
//   final     the tree as the agent left it. The check and the oracle must pass.
//   touch     a harmless edit (a comment, or JSON reformatted) to the files the mistakes live in. Both must pass.
//   revert-a  the mistake the repo's history fixed once, put back.
//   revert-c  the mistake the task reports, put back.
//   fresh     the same mistake in a new file, written the way the repo writes such files.
// A mistake scenario passes when the check fails (the guard caught it) or the oracle still passes (the mistake can no
// longer do harm). The oracle tests behavior, never how a guard works, so a test, a lint rule, a type or a design change
// all count alike. Mutants come from <task id>/mutants.sh, which reads old file versions from a fresh seed (PRISTINE).
// Prints one JSON line with every scenario. Exit 0 passes, 1 fails. Exit 2 means nothing was judged: the task or a
// mutant could not be set up, or a step did not finish (a timeout, a signal or a spawn error), so a hung check never
// counts as a caught mistake.
import { spawnSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCENARIOS = ["final", "touch", "revert-a", "revert-c", "fresh"];
const MUST_PASS = ["final", "touch"];
const STEP_MS = 300_000;

const task = process.argv[2] ?? "";
const taskDir = join(import.meta.dir, task);
const env: Record<string, string> = {};
for (const name of ["PATH", "HOME", "LANG", "TERM"]) if (process.env[name] !== undefined) env[name] = process.env[name]!;
const run = (cmd: string[], cwd: string, extra: Record<string, string> = {}) => {
  const r = spawnSync(cmd[0]!, cmd.slice(1), { cwd, env: { ...env, ...extra }, timeout: STEP_MS, encoding: "utf8", stdio: ["ignore", "ignore", "pipe"], maxBuffer: 64 * 1024 * 1024 });
  if (r.status === null) throw new Error(cmd.join(" ") + " did not finish: " + (r.error?.message ?? "ended by " + r.signal));
  return r;
};

const root = mkdtempSync(join(tmpdir(), "grade-"));
let code = 2;
try {
  if (!/^[a-z0-9-]+$/.test(task) || !existsSync(join(taskDir, "oracle.ts"))) throw new Error("no task named " + JSON.stringify(task));
  const pristine = join(root, "pristine");
  mkdirSync(pristine);
  const seed = run(["sh", join(import.meta.dir, "seed.sh"), task], pristine);
  if (seed.status !== 0) throw new Error("seed.sh failed: " + (seed.stderr ?? "").trim());
  const scenarios: Record<string, { check: boolean; oracle: boolean; ok: boolean }> = {};
  SCENARIOS.forEach((name, i) => {
    const dir = join(root, String(i), "repo");
    cpSync(process.cwd(), dir, { recursive: true });
    if (name !== "final") {
      const m = run(["sh", join(taskDir, "mutants.sh"), name], dir, { PRISTINE: pristine });
      if (m.status !== 0) throw new Error(name + " did not apply: " + (m.stderr ?? "").trim());
    }
    if (existsSync(join(dir, ".git"))) run(["git", "add", "-A"], dir);
    const check = run(["bun", "run", "check"], dir).status === 0;
    mkdirSync(join(dir, "__grade__"), { recursive: true });
    copyFileSync(join(taskDir, "oracle.ts"), join(dir, "__grade__", "oracle.test.ts"));
    const oracle = run(["bun", "test", "./__grade__/oracle.test.ts"], dir, { GRADE_SCENARIO: name }).status === 0;
    scenarios[name] = { check, oracle, ok: MUST_PASS.includes(name) ? check && oracle : !check || oracle };
  });
  const pass = Object.values(scenarios).every((s) => s.ok);
  console.log(JSON.stringify({ task, pass, scenarios }));
  code = pass ? 0 : 1;
} catch (error) {
  console.error("E_TASKS_INVALID: grade: " + (error as Error).message);
} finally {
  rmSync(root, { recursive: true, force: true });
}
process.exit(code);
