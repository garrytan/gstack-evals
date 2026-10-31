// Grades one seeded-mistake task on the work tree in the current directory. It is the check of every task in tasks.json:
//   bun --no-env-file --config="$SKILL_EVAL_FIXTURES/bunfig.toml" --tsconfig-override="$SKILL_EVAL_FIXTURES/tsconfig.json" "$SKILL_EVAL_FIXTURES/grade.ts" <task id>
// The flags give the grader the suite's own Bun config, so nothing in the graded tree (a .env file, a bunfig.toml preload
// or coverage threshold, a tsconfig.json paths entry) changes how grade.ts runs. The oracle and the mutants' bun steps
// run with the same --no-env-file and --config.
// It copies the tree once per scenario and, in each copy, runs the task's behavior oracle (<task id>/oracle.ts) and then
// the repo's own CI entry, `bun run check`:
//   final     the tree as the agent left it. The check and the oracle must pass.
//   touch     a harmless edit (a comment, or JSON reformatted) to the files the mistakes live in. Both must pass.
//   revert-a  the mistake the repo's history fixed once, put back.
//   revert-c  the mistake the task reports, put back.
//   fresh     the same mistake in a new file, written the way the repo writes such files.
// A mistake scenario passes when the check fails (the guard caught it) or the oracle still passes (the mistake can no
// longer do harm). The oracle tests behavior, never how a guard works, so a test, a lint rule, a type or a design change
// all count alike. Mutants come from <task id>/mutants.sh, which reads old file versions from a fresh seed (PRISTINE).
// The oracle runs first, in its own copy of the scenario's tree, so nothing the check does reaches it. It passes only
// when it exits 0 and its JUnit report shows its own tests ran and none failed, so tree code that ends the process early,
// or a paths entry that swaps the test file, fails it. The copies keep symlinks as links; a link that leaves the tree or
// points nowhere fails the grade before any scenario runs, so no mutant writes outside its copy.
// Prints one JSON line with every scenario. Exit 0 passes, 1 fails. Exit 2 means nothing was judged: the task or a
// mutant could not be set up, or a step did not finish (a timeout, a signal, an exit code above 128 or a spawn error), so
// a hung or killed check never counts as a caught mistake.
import { spawnSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";

const SCENARIOS = ["final", "touch", "revert-a", "revert-c", "fresh"];
const MUST_PASS = ["final", "touch"];
const STEP_MS = 300_000;
const COPY = { recursive: true, verbatimSymlinks: true };
const NO_GIT_CONFIG = { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };

const task = process.argv[2] ?? "";
const taskDir = join(import.meta.dir, task);
const env: Record<string, string> = {};
for (const name of ["PATH", "HOME", "LANG", "TERM"]) if (process.env[name] !== undefined) env[name] = process.env[name]!;
const run = (cmd: string[], cwd: string, extra: Record<string, string> = {}) => {
  const r = spawnSync(cmd[0]!, cmd.slice(1), { cwd, env: { ...env, ...extra }, timeout: STEP_MS, encoding: "utf8", stdio: ["ignore", "ignore", "pipe"], maxBuffer: 64 * 1024 * 1024 });
  if (r.status === null || r.status > 128) throw new Error(cmd.join(" ") + " did not finish: " + (r.error?.message ?? "ended by " + (r.signal ?? "exit " + r.status)));
  return r;
};

function strayLink(top: string, dir = top): string | undefined {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = strayLink(top, path);
      if (found) return found;
    } else if (entry.isSymbolicLink()) {
      let target = "";
      try {
        target = realpathSync(path);
      } catch {}
      if (target !== top && !target.startsWith(top + sep)) return relative(top, path);
    }
  }
}

function grade(root: string): { pass: boolean; [key: string]: unknown } {
  const tree = join(root, "tree");
  cpSync(process.cwd(), tree, COPY);
  const refused = strayLink(tree);
  if (refused) return { pass: false, refused, reason: "a symlink that leaves the tree or points nowhere" };
  const pristine = join(root, "pristine");
  mkdirSync(pristine);
  const seed = run(["sh", join(import.meta.dir, "seed.sh"), task], pristine, NO_GIT_CONFIG);
  if (seed.status !== 0) throw new Error("seed.sh failed: " + (seed.stderr ?? "").trim());
  const scenarios: Record<string, { check: boolean; oracle: boolean; ok: boolean }> = {};
  SCENARIOS.forEach((name, i) => {
    const dir = join(root, String(i), "repo");
    cpSync(tree, dir, COPY);
    if (name !== "final") {
      const m = run(["sh", join(taskDir, "mutants.sh"), name], dir, { PRISTINE: pristine, ...NO_GIT_CONFIG });
      if (m.status !== 0) throw new Error(name + " did not apply: " + (m.stderr ?? "").trim());
    }
    const graded = join(root, String(i), "oracle");
    cpSync(dir, graded, COPY);
    rmSync(join(graded, "__grade__"), { recursive: true, force: true });
    mkdirSync(join(graded, "__grade__"));
    copyFileSync(join(taskDir, "oracle.ts"), join(graded, "__grade__", "oracle.test.ts"));
    const report = join(root, String(i), "oracle.xml");
    const o = run([process.execPath, "--no-env-file", "--config=" + join(import.meta.dir, "bunfig.toml"), "test", "--reporter=junit", "--reporter-outfile=" + report, "./__grade__/oracle.test.ts"], graded, { GRADE_SCENARIO: name });
    const xml = existsSync(report) ? readFileSync(report, "utf8") : "";
    const totals = /<testsuites\s[^>]*>/.exec(xml)?.[0] ?? "";
    const count = (attr: string) => Number(new RegExp("\\s" + attr + '="(\\d+)"').exec(totals)?.[1] ?? NaN);
    const files = [...xml.matchAll(/<testsuite\s[^>]*?\sfile="([^"]*)"/g)].map((m) => m[1]);
    const oracle = o.status === 0 && count("failures") === 0 && count("tests") - count("skipped") > 0 && files.length > 0 && files.every((f) => f === "__grade__/oracle.test.ts");
    if (existsSync(join(dir, ".git"))) run(["git", "add", "-A"], dir, NO_GIT_CONFIG);
    const check = run(["bun", "run", "check"], dir).status === 0;
    scenarios[name] = { check, oracle, ok: MUST_PASS.includes(name) ? check && oracle : !check || oracle };
  });
  return { pass: Object.values(scenarios).every((s) => s.ok), scenarios };
}

let root = "";
let code = 2;
try {
  if (!/^[a-z0-9-]+$/.test(task) || !existsSync(join(taskDir, "oracle.ts"))) throw new Error("no task named " + JSON.stringify(task));
  root = realpathSync(mkdtempSync(join(tmpdir(), "grade-")));
  const result = grade(root);
  console.log(JSON.stringify({ task, ...result }));
  code = result.pass ? 0 : 1;
} catch (error) {
  console.error("E_TASKS_INVALID: grade: " + (error as Error).message);
} finally {
  if (root) {
    spawnSync("chmod", ["-R", "u+rwx", root], { stdio: "ignore" });
    try {
      rmSync(root, { recursive: true, force: true });
    } catch (error) {
      console.error("CLEANUP_INCOMPLETE: grade: " + (error as Error).message);
    }
  }
}
process.exit(code);
