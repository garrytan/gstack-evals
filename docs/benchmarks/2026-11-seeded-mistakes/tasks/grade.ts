// Grades one seeded-mistake task on the work tree in the current directory. It is the check of every task in tasks.json:
//   bun --no-env-file --config="$SKILL_EVAL_FIXTURES/bunfig.toml" --tsconfig-override="$SKILL_EVAL_FIXTURES/tsconfig.json" "$SKILL_EVAL_FIXTURES/grade.ts" <task id>
// The flags give the grader the suite's own Bun config, so nothing in the graded tree (a .env file, a bunfig.toml preload
// or coverage threshold, a tsconfig.json paths entry) changes how grade.ts runs. The oracle and the mutants' bun steps
// run with the same --no-env-file and --config.
// It grades the tree once per scenario, in random order and always at the same path, so the check cannot tell which
// scenario it is in from where or when it runs. Each scenario gets a fresh copy of the tree, the scenario's edit, the
// task's behavior oracle (<task id>/oracle.ts) and then the repo's own CI entry, `bun run check`:
//   final     the tree as the agent left it. The check and the oracle must pass.
//   touch     a harmless edit (a comment, or JSON reformatted) to the files the mistakes live in. Both must pass.
//   revert-a  the mistake the repo's history fixed once, put back.
//   revert-c  the mistake the task reports, put back.
//   fresh     the same mistake in a new file or config entry, written the way the repo writes such files.
//   fresh-ok  fresh's new file or entry, written without the mistake. Both must pass, so a guard that fails on any new
//             file, or on any change to what the config means, fails here.
// A mistake scenario passes when the check fails (the guard caught it) or the oracle still passes (the mistake can no
// longer do harm). The oracle tests behavior, never how a guard works, so a test, a lint rule, a type or a design change
// all count alike. Mutants come from <task id>/mutants.sh, which reads old file versions from a seed (PRISTINE) made for
// that scenario and removed before any tree code runs. The JSON mutants find their key wherever the tree keeps it, and
// fail when they find nothing to change. A mutant that fails on the tree but applies to the seed failed because of the
// tree's layout, so its scenario fails, with the reason in the JSON line.
// The oracle runs first, in its own copy of the scenario's tree, so nothing the check does reaches it. Nothing in its
// environment or arguments names the scenario: it runs every test every time, and grade.ts reads each test's result from
// its JUnit report. Tests in its "with no mistake in place" block count in the must-pass scenarios only. The oracle
// passes only when the report shows its own tests ran and none that count failed, so tree code that ends the process
// early, or a paths entry that swaps the test file, fails it. The copies keep symlinks as links; a link that leaves the
// copy it is in, or points nowhere, fails the grade before anything runs in that copy, so no mutant writes outside its
// copy. Tree code that writes outside its own copy, keeps state between its runs or leaves a process running is out of
// reach of these rules.
// Prints one JSON line with every scenario. Exit 0 passes, 1 fails. A tree that cannot be copied (a FIFO, a socket, an
// unreadable file) fails, and so does a scenario whose oracle or check does not finish (a timeout, a signal or an exit
// code above 128), so a hung or killed check never counts as a caught mistake. Exit 2 means the grader itself failed
// and nothing was judged: an unknown task, a seed that failed, a mutant that failed on the seed too, a step that could
// not start, or a full disk.
import { spawnSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";

const SCENARIOS = ["final", "touch", "revert-a", "revert-c", "fresh", "fresh-ok"];
const MUST_PASS = ["final", "touch", "fresh-ok"];
const UNBROKEN = "with no mistake in place";
const ORACLE = "__grade__/oracle.test.ts";
const STEP_MS = 300_000;
const COPY = { recursive: true, verbatimSymlinks: true };
const NO_GIT_CONFIG = { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
const DISK_FAULTS = ["ENOSPC", "EDQUOT", "EIO", "ENOMEM", "EMFILE", "ENFILE"];

const task = process.argv[2] ?? "";
const taskDir = join(import.meta.dir, task);
const env: Record<string, string> = {};
for (const name of ["PATH", "HOME", "LANG", "TERM"]) if (process.env[name] !== undefined) env[name] = process.env[name]!;
type Step = { status: number; done: boolean; why: string };
const run = (cmd: string[], cwd: string, extra: Record<string, string> = {}): Step => {
  const r = spawnSync(cmd[0]!, cmd.slice(1), { cwd, env: { ...env, ...extra }, timeout: STEP_MS, encoding: "utf8", stdio: ["ignore", "ignore", "pipe"], maxBuffer: 64 * 1024 * 1024 });
  if (!r.pid) throw new Error(cmd.join(" ") + " could not start: " + r.error?.message);
  const done = r.status !== null && r.status <= 128;
  return { status: r.status ?? -1, done, why: done ? (r.stderr ?? "").trim() : cmd.join(" ") + " did not finish: " + (r.error?.message ?? "ended by " + (r.signal ?? "exit " + r.status)) };
};

const remove = (path: string) => {
  spawnSync("chmod", ["-R", "u+rwx", path], { stdio: "ignore" });
  rmSync(path, { recursive: true, force: true });
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

type Scenario = { check: boolean | null; oracle: boolean | null; ok: boolean; reason?: string };

function grade(root: string): { pass: boolean; [key: string]: unknown } {
  const tree = join(root, "tree");
  try {
    cpSync(process.cwd(), tree, COPY);
  } catch (error) {
    if (DISK_FAULTS.includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
    return { pass: false, reason: "the tree could not be copied: " + (error as Error).message };
  }
  const [dir, graded, pristine, report] = ["repo", "oracle", "pristine", "oracle.xml"].map((name) => join(root, name)) as [string, string, string, string];
  const refused = (copy: string) => {
    const link = strayLink(copy);
    return link === undefined ? undefined : { pass: false, refused: link, reason: "a symlink that leaves its copy of the tree or points nowhere" };
  };
  const first = refused(tree);
  if (first) return first;
  const order = [...SCENARIOS];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  const scenarios: Record<string, Scenario> = {};
  for (const name of order) {
    cpSync(tree, dir, COPY);
    const linked = refused(dir);
    if (linked) return linked;
    if (name !== "final") {
      mkdirSync(pristine);
      const seed = run(["sh", join(import.meta.dir, "seed.sh"), task], pristine, NO_GIT_CONFIG);
      if (seed.status !== 0) throw new Error("seed.sh failed: " + seed.why);
      const mutate = (cwd: string) => run(["sh", join(taskDir, "mutants.sh"), name], cwd, { PRISTINE: pristine, ...NO_GIT_CONFIG });
      const m = mutate(dir);
      if (m.status !== 0) {
        const probe = mutate(pristine);
        if (probe.status !== 0) throw new Error(name + " did not apply to the seed: " + probe.why);
        scenarios[name] = { check: null, oracle: null, ok: false, reason: "the tree's layout stopped the " + name + " mutant: " + m.why };
        for (const path of [pristine, dir]) remove(path);
        continue;
      }
      remove(pristine);
    }
    cpSync(dir, graded, COPY);
    const copied = refused(graded);
    if (copied) return copied;
    rmSync(join(graded, "__grade__"), { recursive: true, force: true });
    mkdirSync(join(graded, "__grade__"));
    copyFileSync(join(taskDir, "oracle.ts"), join(graded, ORACLE));
    const must = MUST_PASS.includes(name);
    const o = run([process.execPath, "--no-env-file", "--config=" + join(import.meta.dir, "bunfig.toml"), "test", "--reporter=junit", "--reporter-outfile=" + report, "./" + ORACLE], graded);
    const xml = existsSync(report) ? readFileSync(report, "utf8") : "";
    const cases = [...xml.matchAll(/<testcase\s([^>]*?)(\/?)>/g)].map(([, attrs, closed]) => ({ unbroken: attrs!.includes(' classname="' + UNBROKEN + '"'), file: /\sfile="([^"]*)"/.exec(attrs!)?.[1], pass: closed === "/" }));
    const ran = cases.length > 0 && cases.every((c) => c.file === ORACLE) && cases.some((c) => c.unbroken) && cases.some((c) => !c.unbroken);
    const oracle = o.done ? ran && (o.status === 0 || (!must && o.status === 1)) && cases.every((c) => c.pass || (c.unbroken && !must)) : null;
    const added = existsSync(join(dir, ".git")) ? run(["git", "add", "-A"], dir, NO_GIT_CONFIG) : undefined;
    const c = added?.done === false ? added : run(["bun", "run", "check"], dir);
    const check = c.done ? c.status === 0 : null;
    const unfinished = [o, c].filter((step) => !step.done).map((step) => step.why);
    scenarios[name] = { check, oracle, ok: must ? check === true && oracle === true : check === false || oracle === true, ...(unfinished.length ? { reason: unfinished.join("; ") } : {}) };
    for (const path of [dir, graded, report]) remove(path);
  }
  return { pass: Object.values(scenarios).every((s) => s.ok), order, scenarios: Object.fromEntries(SCENARIOS.map((name) => [name, scenarios[name]])) };
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
    try {
      remove(root);
    } catch (error) {
      console.error("CLEANUP_INCOMPLETE: grade: " + (error as Error).message);
    }
  }
}
process.exit(code);
