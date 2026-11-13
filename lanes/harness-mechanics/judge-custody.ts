// Copyright (c) 2026 Garry Tan. MIT License.
// The host-side custody producer for the live judge arms (lanes/harness-mechanics/README.md "Not built"). It mirrors the
// decision-routing controller (lanes/decision-routing/host/controller.ts), which builds every task's runner-only markers
// before any lease so a custody failure never costs a VM. The judge pilot runs one Harbor job per rectangle (12 calibration
// tasks x 2 judge arms), so one agent config serves all 12 tasks and custody cannot be a static per-task kwarg. Instead the
// agent resolves <markers_dir>/<task>.json at runtime (quick/laneb/runner/agent/laneb_hooks.py judge_markers_file), and this
// producer writes those files into each judge part's run dir before launch. launch.sh syncs the run dir to the VM, so the
// agent finds the markers there; the per-task canaries live in a label store outside the run dirs, so no canary is ever
// synced to the VM. A task whose pristine image will not list stops the run with DR_LABEL_MISSING, nothing written.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dockerCli, pristineImage, type DockerRunner } from "../decision-routing/labels/container.ts";
import { plantCanary, pristineListing, taskMarkers, type Pristine } from "../decision-routing/labels/markers.ts";

/** The markers folder inside a judge part's run dir; prepare-run.ts points every judge arm's markers_dir kwarg at it. */
export const JUDGE_MARKERS_DIR = "judge-markers";

/** The judge task ids in a prepared part's job.json (its agents carry judge_backend), or [] when the part has no judge arm. */
export function judgePartTasks(runDir: string): string[] {
  const jobPath = join(runDir, "job.json");
  if (!existsSync(jobPath)) return [];
  const job = JSON.parse(readFileSync(jobPath, "utf8"));
  const hasJudge = (job.agents ?? []).some((a: { kwargs?: { judge_backend?: string } }) => a?.kwargs?.judge_backend);
  return hasJudge ? [...new Set((job.tasks ?? []) as string[])] : [];
}

/** Build one judge part's per-task custody: for every judge task, the pristine listing of its image (read with no network),
 * its reused canary and the runner-only markers, written to <runDir>/judge-markers/<task>.json (owner-only). Every listing
 * is resolved before any file is written, so a DR_LABEL_MISSING failure leaves no partial custody and the run never launches
 * with a task missing its markers. A cache lets the judge item's parts, which share the same calibration tasks, list and
 * canary each task once. */
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

/** Build custody for every judge part a prepared work dir holds (hm judge-custody). The label store (per-task canaries)
 * defaults outside the per-part run dirs, so launch.sh never syncs a canary to the VM; only the markers files, which ride
 * the run dir, reach it. Returns the parts touched and the distinct tasks custody was built for. */
export async function buildJudgeMarkers(work: string, o: { tasksDir: string; labelStore?: string; docker?: DockerRunner; log?: (s: string) => void }): Promise<{ parts: string[]; tasks: string[] }> {
  const plan = JSON.parse(readFileSync(join(work, "plan.json"), "utf8"));
  const labelStore = o.labelStore ?? join(work, "judge-labels");
  const cache = new Map<string, string[]>();
  const parts: string[] = [];
  const tasks = new Set<string>();
  for (const p of plan.parts ?? []) {
    const built = await buildRunMarkers(join(work, p.name), { tasksDir: o.tasksDir, labelStore, docker: o.docker, cache });
    if (!built.length) continue;
    parts.push(p.name);
    for (const t of built) tasks.add(t);
    o.log?.("judge-custody " + p.name + ": custody for " + built.length + " task(s)");
  }
  return { parts, tasks: [...tasks] };
}
