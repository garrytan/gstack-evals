// Copyright (c) 2026 Garry Tan. MIT License.
// Decision-routing D7 (Captain, 2026-11-10, after the harness mechanics lane's D7): SWE-rebench task images ship git
// tags, pseudo-refs and commits past the task's base commit, and some of those commits hold the upstream fix and its
// hidden tests, which an agent can read with git log --all. Two halves:
// - addHistoryStrip puts host/history.sh beside each task's environment/Dockerfile and appends a RUN step that strips
//   /testbed to the base commit's history and fails the image build if anything past the base is left (parts a to c).
//   tasks.ts calls it for every task dir, so every session image Harbor builds carries it. The verifier's image
//   (tests/Dockerfile) and the label containers keep the pristine image: no agent works in them.
// - historyCheck is the host gate before a batch's first session: it builds each task's session image the way Harbor
//   does, runs history.sh check in a throwaway container with no network and the task's runner-only markers mounted
//   read-only (never in an image layer), and fails the task on any of parts (a) to (d).
//   history --tasks-dir <dir> --tasks <id,id,...|file> --pristine-dir <dir> --work <dir>
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { dockerCli, type DockerRunner } from "../labels/container.ts";
import { taskMarkers, type Pristine } from "../labels/markers.ts";

export const HISTORY_SH = join(import.meta.dir, "history.sh");
export const STRIP_FILE = "dr-history.sh";
export const STRIP_STEP = [
  "# Decision-routing D7: keep only the base commit's git history in /testbed (lanes/decision-routing/host/history.sh).",
  "COPY " + STRIP_FILE + " /tmp/" + STRIP_FILE,
  "RUN sh /tmp/" + STRIP_FILE + " strip && rm -f /tmp/" + STRIP_FILE,
].join("\n");
/** taskMarkers leads with a canary; the history check plants none, so this placeholder is sliced off. */
const NO_CANARY = "DRCANARY-" + "0".repeat(32);
const BUILD_TIMEOUT_MS = 1_800_000;
const CHECK_TIMEOUT_MS = 1_800_000;

export const PARTS = {
  a: ["a_bad", "pseudo_bad", "grafts"],
  b: ["b_later"],
  c: ["c_alt", "c_modstore", "c_worktrees", "stores_later"],
  d: ["d_outside", "d_untracked", "d_worktree", "d_objects", "d_gitmeta"],
} as const;

export function addHistoryStrip(taskDir: string): void {
  const dockerfile = join(taskDir, "environment", "Dockerfile");
  const text = readFileSync(dockerfile, "utf8");
  if (text.includes(STRIP_STEP)) throw new Error("E_USAGE: history: " + dockerfile + " already carries the D7 strip");
  copyFileSync(HISTORY_SH, join(taskDir, "environment", STRIP_FILE));
  writeFileSync(dockerfile, text.trimEnd() + "\n\n" + STRIP_STEP + "\n");
}

export type HistoryRow = { task: string; pass: boolean; failed: string[]; counts: Record<string, string>; error?: string };

export function parseResult(task: string, stdout: string): HistoryRow {
  const line = stdout.split("\n").find((l) => l.startsWith("RESULT "));
  if (!line) return { task, pass: false, failed: [], counts: {}, error: "no RESULT line" };
  const counts = Object.fromEntries(line.slice(7).trim().split(/\s+/).map((kv) => kv.split("=", 2) as [string, string]));
  if (counts.error) return { task, pass: false, failed: [], counts, error: counts.error };
  const failed = Object.entries(PARTS).filter(([, keys]) => keys.some((k) => counts[k] === undefined || counts[k] !== "0")).map(([p]) => p);
  return { task, pass: failed.length === 0, failed, counts };
}

export async function historyCheck(o: { tasksDir: string; tasks: string[]; pristineDir: string; work: string; docker?: DockerRunner }): Promise<HistoryRow[]> {
  const docker = o.docker ?? dockerCli;
  mkdirSync(o.work, { recursive: true, mode: 0o700 });
  chmodSync(o.work, 0o700);
  const rows: HistoryRow[] = [];
  for (const task of o.tasks) {
    const taskDir = join(o.tasksDir, task);
    if (!readFileSync(join(taskDir, "environment", "Dockerfile"), "utf8").includes(STRIP_STEP)) {
      rows.push({ task, pass: false, failed: [], counts: {}, error: "environment/Dockerfile has no D7 strip" });
      continue;
    }
    const markers = taskMarkers(taskDir, JSON.parse(readFileSync(join(o.pristineDir, task + ".json"), "utf8")) as Pristine, NO_CANARY).slice(1);
    const dir = join(o.work, task);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(join(dir, "markers"), markers.length ? markers.join("\n") + "\n" : "", { mode: 0o600 });
    copyFileSync(HISTORY_SH, join(dir, "history.sh"));
    const tag = "dr-history/" + task.toLowerCase().replace(/[^a-z0-9.-]/g, "-");
    const built = await docker.run(["build", "-q", "-t", tag, join(taskDir, "environment")], { timeoutMs: BUILD_TIMEOUT_MS });
    if (built.code !== 0) {
      rows.push({ task, pass: false, failed: [], counts: {}, error: "image build failed: " + (built.stderr || built.stdout).trim().split("\n").slice(-2).join(" ").slice(0, 300) });
      continue;
    }
    const r = await docker.run(["run", "--rm", "--network", "none", "--entrypoint", "sh", "-v", resolve(dir) + ":/dr-history:ro", tag, "/dr-history/history.sh", "check", "/dr-history/markers"], { timeoutMs: CHECK_TIMEOUT_MS });
    await docker.run(["rmi", "-f", tag]);
    writeFileSync(join(dir, "hits"), r.stderr, { mode: 0o600 });
    rows.push(parseResult(task, r.stdout));
  }
  return rows;
}

export async function main(argv: string[], docker: DockerRunner = dockerCli): Promise<number> {
  const flag = (name: string) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
  const [tasksDir, tasks, pristineDir, work] = [flag("--tasks-dir"), flag("--tasks"), flag("--pristine-dir"), flag("--work")];
  if (!tasksDir || !tasks || !pristineDir || !work) {
    console.error("E_USAGE usage: history --tasks-dir <dir> --tasks <id,id,...|file> --pristine-dir <dir> --work <dir>");
    return 2;
  }
  const ids = (existsSync(tasks) ? readFileSync(tasks, "utf8") : tasks).split(/[\s,]+/).filter(Boolean);
  const rows = await historyCheck({ tasksDir, tasks: ids, pristineDir, work, docker });
  for (const r of rows) console.log("HISTORY " + r.task + " " + (r.pass ? "PASS" : "FAIL " + (r.error ?? r.failed.join(","))) + " " + Object.entries(r.counts).map(([k, v]) => k + "=" + v).join(" "));
  const failed = rows.filter((r) => !r.pass);
  console.log("history: " + (rows.length - failed.length) + " of " + rows.length + " tasks pass");
  if (failed.length === 0) return 0;
  console.error("DR_HISTORY_LEAK: " + failed.length + " of " + rows.length + " task images reach past their base commit or carry a hidden test marker: " + failed.map((r) => r.task).join(", "));
  return 1;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
