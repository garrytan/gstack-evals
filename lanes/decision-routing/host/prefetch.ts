// Copyright (c) 2026 Garry Tan. MIT License.
// Image prefetch for a decision-routing batch: pulls every pristine task image a plan needs (the FROM line of each task's
// environment Dockerfile, which the label containers also run) before the batch's first session. Images already present
// are skipped. Pulls are spaced PULL_SPACING_MS apart, under Docker Hub's 100 unauthenticated pulls an hour per IPv6 /64.
// A pull refused for the rate limit waits the hour out and pulls the same image again, which spends no retry; any other
// failed pull stops with the image named. Finish it before a gate or a paid batch starts.
//   bun lanes/decision-routing/host/prefetch.ts --plan <plan.json> --tasks-dir <dir>
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dockerCli, pristineImage, type DockerRunner } from "../labels/container.ts";
import type { PlanRow } from "./controller.ts";

export const PULL_SPACING_MS = 40_000;
export const RATE_WINDOW_MS = 3_600_000;
const RATE_LIMITED = /toomanyrequests|pull rate limit/i;

export const imagesFor = (plan: readonly PlanRow[], tasksDir: string) => [...new Set(plan.map((r) => pristineImage(join(tasksDir, r.task))))];

export async function prefetch(plan: readonly PlanRow[], tasksDir: string, o: { docker?: Pick<DockerRunner, "run">; sleep?: (ms: number) => Promise<void>; log?: (l: string) => void } = {}) {
  const docker = o.docker ?? dockerCli;
  const sleep = o.sleep ?? ((ms: number) => Bun.sleep(ms));
  const log = o.log ?? ((l: string) => console.error(l));
  const out = { present: [] as string[], pulled: [] as string[], waits: 0 };
  for (const image of imagesFor(plan, tasksDir)) {
    if ((await docker.run(["image", "inspect", image])).code === 0) {
      out.present.push(image);
      continue;
    }
    if (out.pulled.length) await sleep(PULL_SPACING_MS);
    for (;;) {
      const r = await docker.run(["pull", image]);
      if (r.code === 0) break;
      if (!RATE_LIMITED.test(r.stderr + r.stdout)) throw new Error("E_USAGE: docker pull " + image + " failed: " + (r.stderr || r.stdout).trim().slice(0, 500));
      out.waits++;
      log("pull rate limit on " + image + "; waiting the hour out, then pulling it again");
      await sleep(RATE_WINDOW_MS);
    }
    out.pulled.push(image);
    log("pulled " + image);
  }
  return out;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const flag = (n: string) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
  const plan = flag("--plan"), tasksDir = flag("--tasks-dir");
  if (!plan || !tasksDir) {
    console.error("E_USAGE: prefetch.ts --plan <plan.json> --tasks-dir <dir>");
    process.exit(2);
  }
  try {
    const r = await prefetch(JSON.parse(readFileSync(plan, "utf8")) as PlanRow[], tasksDir);
    console.log("prefetch done: " + r.pulled.length + " pulled, " + r.present.length + " already present, " + r.waits + " rate-limit waits");
  } catch (e) {
    console.error((e as Error).message);
    process.exit(2);
  }
}
