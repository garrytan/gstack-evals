// Copyright (c) 2026 Garry Tan. MIT License.
// hm build-check --out <dir>: ruling A's check before any lease at a new pin, with no model call. Each task in the
// screened calibration list (HM_SCREENED at HM_SCREENED_SHA256), in its order, gets its trial image built the way Harbor
// builds it, from the environment directory prepare-run writes (screen.ts trialEnvironment). The image must build, its
// WORKDIR must be /testbed, and there, with no -w, pwd must print /testbed and git rev-parse origin/main HEAD the same
// commit twice. Rows append to <dir>/build-check.jsonl as they land, a failed build's row keeps its error line, and each
// task's images are removed after its row. Prints one line per task and exits 0 only when every task passes.
// Needs Docker and SWEREBENCH.
import { appendFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundleLists, SCREEN, screenedFromEnv } from "./pins.ts";
import { imageRef, pool, trialEnvironment } from "./screen.ts";

export type BuildRow = { task: string; pass: boolean; error?: string; workdir?: string; pwd?: string; main?: string; head?: string };

/** The line of a failed docker build (--progress=plain) that says why: the step's last fatal line, else its last error
 * line, else the build's last line. */
export function buildError(stderr: string): string {
  const lines = stderr.trim().split("\n").map((l) => l.trim()).filter(Boolean);
  const pick = (re: RegExp) => lines.filter((l) => re.test(l) && !/^ERROR: failed to (build|solve)/.test(l)).at(-1);
  return (pick(/\bfatal:/i) ?? pick(/\berror:/i) ?? lines.at(-1) ?? "").slice(0, 300);
}

/** A built image's reads against the rule: WORKDIR /testbed, pwd /testbed with no -w, and origin/main equal to HEAD there. */
export function buildProblems(r: Omit<BuildRow, "pass">): string[] {
  if (r.error) return [r.error];
  const p: string[] = [];
  if (r.workdir !== SCREEN.workdir) p.push("WORKDIR is " + JSON.stringify(r.workdir ?? "") + ", not " + SCREEN.workdir);
  if (r.pwd !== SCREEN.workdir) p.push("pwd with no -w is " + JSON.stringify(r.pwd ?? "") + ", not " + SCREEN.workdir);
  if (!r.main || !/^[0-9a-f]{40}$/.test(r.main) || r.main !== r.head) p.push("origin/main " + (r.main || "missing") + " is not HEAD " + (r.head || "?"));
  return p;
}

export function buildCheck(out: string, tasks: string[], log: (l: string) => void = console.log): BuildRow[] {
  mkdirSync(out, { recursive: true });
  const docker = process.env.HM_DOCKER ?? "docker", p = pool(), rows: BuildRow[] = [];
  const dk = (args: string[], timeoutSec = 600) => { const r = Bun.spawnSync([docker, ...args], { stdout: "pipe", stderr: "pipe", timeout: timeoutSec * 1000 }); return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() }; };
  for (const [i, task] of tasks.entries()) {
    const ref = imageRef(p.get(task)!), tag = "hm-build-" + (i + 1), ctx = mkdtempSync(join(tmpdir(), "hm-build-"));
    const read: Omit<BuildRow, "pass"> = { task };
    try {
      for (;;) {
        const pull = dk(["pull", "-q", ref], 3600);
        if (pull.code === 0) break;
        if (!/toomanyrequests|rate limit/i.test(pull.err)) { read.error = "pull failed: " + buildError(pull.err); break; }
        log("BUILD-CHECK wait Docker Hub's pull limit for " + ref);
        Bun.sleepSync(Number(process.env.HM_PULL_WAIT_SEC ?? SCREEN.pullWaitSec) * 1000);
      }
      if (!read.error) {
        const b = dk(["build", "--progress=plain", "-t", tag, trialEnvironment(task, join(ctx, "trial"))], 3600);
        if (b.code !== 0) read.error = "build failed: " + buildError(b.err);
      }
      if (!read.error) {
        read.workdir = dk(["image", "inspect", "--format", "{{.Config.WorkingDir}}", tag]).out.trim();
        const [pwd, main, head] = dk(["run", "--rm", "--network", "none", "--entrypoint", "sh", tag, "-c", "pwd && git rev-parse origin/main HEAD"]).out.trim().split("\n");
        Object.assign(read, { pwd, main, head });
      }
    } catch (e) {
      read.error = String((e as Error).message ?? e).split("\n")[0]!;
    } finally {
      rmSync(ctx, { recursive: true, force: true });
      dk(["rmi", "-f", tag, ref]);
    }
    const problems = buildProblems(read), row: BuildRow = { ...read, pass: !problems.length };
    rows.push(row);
    appendFileSync(join(out, "build-check.jsonl"), JSON.stringify(row) + "\n");
    log("BUILD-CHECK " + (i + 1) + "/" + tasks.length + " " + task + " " + (row.pass ? "PASS workdir " + row.workdir + ", origin/main = HEAD " + row.head!.slice(0, 12) : "FAIL " + problems.join("; ")));
  }
  const failed = rows.filter((r) => !r.pass);
  log("BUILD-CHECK " + (rows.length - failed.length) + " of " + rows.length + " built with WORKDIR " + SCREEN.workdir + " and origin/main = HEAD" + (failed.length ? "; FAILED: " + failed.map((r) => r.task).join(", ") : ""));
  return rows;
}

export function buildCheckCommand(out: string): number {
  return buildCheck(out, screenedFromEnv(bundleLists()).calibration).every((r) => r.pass) ? 0 : 1;
}
