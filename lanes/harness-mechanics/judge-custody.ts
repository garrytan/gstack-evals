// Copyright (c) 2026 Garry Tan. MIT License.
// The custody producer for the live judge arms. It mirrors the decision-routing controller
// (lanes/decision-routing/host/controller.ts), which builds every task's runner-only markers before any lease so a custody
// failure never costs a VM. A judge rectangle runs one Harbor job over many tasks, so one agent config serves every task and
// custody cannot be a static per-task kwarg. Instead the agent resolves <markers_dir>/<task>.json at runtime
// (quick/laneb/runner/agent/laneb_hooks.py judge_markers_file), and prepare-run.ts writes those files into every judge
// batch's run dir on every prepare path (a part, its <part>-relaunch and its <part>-a2), through prepareJudgeCustody.
// Each markers file holds its task's canary and hidden-test markers. It rides the run dir to the host and the part VM, where
// the host-side agent reads it, and stays outside every task container: Harbor's build context is the task's environment
// dir and its mounts are only the trial's agent, verifier and artifacts dirs. The label store that keeps each task's one
// canary (<work>/judge-labels) sits beside the part dirs and is never synced. A task whose pristine image will not list
// stops the prepare with DR_LABEL_MISSING, nothing written.
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { dockerCli, pristineImage, type DockerRunner } from "../decision-routing/labels/container.ts";
import { plantCanary, pristineListing, taskMarkers, type Pristine } from "../decision-routing/labels/markers.ts";

/** The markers folder inside a judge part's run dir; prepare-run.ts points every judge arm's markers_dir kwarg at it. */
export const JUDGE_MARKERS_DIR = "judge-markers";
/** The label store beside a work dir's part dirs: one folder per task holding its canary.txt. */
export const JUDGE_LABELS_DIR = "judge-labels";
// The canary's shape (decision-routing labels/markers.ts plantCanary, and laneb_hooks.py CANARY).
const CANARY = /^DRCANARY-[0-9a-f]{32}$/;

/** The judge task ids in a prepared part's job files (job.json and every job-<n>.json splitJobs writes), each the basename
 * of the task's {path}, or [] when no job has a judge arm (an agent carrying judge_backend). A judge job's task with no
 * path fails closed, so custody is never built for a guessed name. */
export function judgePartTasks(runDir: string): string[] {
  if (!existsSync(runDir)) return [];
  const tasks: string[] = [];
  for (const f of readdirSync(runDir).filter((n) => /^job(-\d+)?\.json$/.test(n)).sort()) {
    const job = JSON.parse(readFileSync(join(runDir, f), "utf8"));
    if (!(job.agents ?? []).some((a: { kwargs?: { judge_backend?: string } }) => a?.kwargs?.judge_backend)) continue;
    for (const t of job.tasks ?? []) {
      const path = typeof t?.path === "string" ? t.path.replace(/\/+$/, "") : "";
      if (!path) throw new Error("E_HM_INPUT judge-custody: " + join(runDir, f) + " has a judge task with no path, so its custody can't be named; nothing built");
      tasks.push(basename(path));
    }
  }
  return [...new Set(tasks)];
}

/** Build one judge part's per-task custody: for every judge task, the pristine listing of its image (read with no network),
 * its reused canary and the runner-only markers, written to <runDir>/judge-markers/<task>.json (owner-only). Every listing
 * is resolved before any file is written, so a DR_LABEL_MISSING failure leaves no partial custody and the run never launches
 * with a task missing its markers. A cache lets one caller list and canary each task once. */
export async function buildRunMarkers(runDir: string, o: { tasksDir: string; labelStore: string; docker?: DockerRunner; cache?: Map<string, string[]> }): Promise<string[]> {
  const docker = o.docker ?? dockerCli;
  const tasks = judgePartTasks(runDir);
  if (!tasks.length) return [];
  const built = new Map<string, string[]>();
  for (const task of tasks) {
    const cached = o.cache?.get(task);
    if (cached) { built.set(task, cached); continue; }
    const taskDir = join(o.tasksDir, task);
    if (!existsSync(join(taskDir, "environment", "Dockerfile"))) throw new Error("DR_LABEL_MISSING judge-custody: task source " + taskDir + " has no environment/Dockerfile; no custody built, nothing launched");
    const listing: Pristine = await pristineListing(docker, pristineImage(taskDir));
    const markers = taskMarkers(taskDir, listing, plantCanary(join(o.labelStore, task)));
    built.set(task, markers);
    o.cache?.set(task, markers);
  }
  const dir = join(runDir, JUDGE_MARKERS_DIR);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  for (const [task, markers] of built) {
    const file = join(dir, task + ".json");
    writeFileSync(file, JSON.stringify(markers) + "\n", { mode: 0o600 });
    chmodSync(file, 0o600);
  }
  return tasks;
}

/** prepare-run.ts's custody step for a judge batch: buildRunMarkers into the run dir, with the label store beside the work
 * dir's part dirs (<work>/judge-labels), so a part, its relaunch and its attempt 2 share each task's one canary. */
export const prepareJudgeCustody = (runDir: string, tasksDir: string, docker?: DockerRunner) =>
  buildRunMarkers(runDir, { tasksDir, labelStore: join(dirname(runDir), JUDGE_LABELS_DIR), docker });

export type CustodyCheck = { pass: boolean; parts: string[]; tasks: number; problems: string[] };

/** hm judge-custody: a docker-free check over every prepared part dir in a work dir (one holding l1-part.json, the
 * relaunches and attempt 2s included). Each judge task needs its markers file, holding exactly one canary, and that canary
 * must be the label store's canary.txt for the task. */
export function checkJudgeCustody(work: string): CustodyCheck {
  const problems: string[] = [], parts: string[] = [];
  let tasks = 0;
  for (const name of readdirSync(work).sort()) {
    const run = join(work, name);
    if (!statSync(run).isDirectory() || !existsSync(join(run, "l1-part.json"))) continue;
    let judged: string[];
    try { judged = judgePartTasks(run); } catch (e) { problems.push(name + ": " + (e as Error).message); continue; }
    if (!judged.length) continue;
    parts.push(name);
    for (const task of judged) {
      tasks++;
      const file = join(run, JUDGE_MARKERS_DIR, task + ".json"), label = join(work, JUDGE_LABELS_DIR, task, "canary.txt");
      if (!existsSync(file)) { problems.push(name + "/" + task + ": no markers file " + file); continue; }
      let markers: unknown;
      try { markers = JSON.parse(readFileSync(file, "utf8")); } catch { problems.push(name + "/" + task + ": " + file + " does not parse"); continue; }
      const canaries = Array.isArray(markers) ? markers.filter((m) => typeof m === "string" && CANARY.test(m)) : [];
      if (canaries.length !== 1) { problems.push(name + "/" + task + ": " + file + " holds " + canaries.length + " canaries, not 1"); continue; }
      if (!existsSync(label)) { problems.push(name + "/" + task + ": no label store canary " + label); continue; }
      if (readFileSync(label, "utf8").trim() !== canaries[0]) problems.push(name + "/" + task + ": the markers file's canary is not the label store's");
    }
  }
  return { pass: problems.length === 0, parts, tasks, problems };
}
