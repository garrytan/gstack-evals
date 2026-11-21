// Copyright (c) 2026 Garry Tan. MIT License.
// b2 images --out <dir> [--shard k/n]: section 12's check before Sol's first counted part, keyless. Every run task's image
// builds with Codex added: the task's trial environment as Lane B's prepare writes it for a Sol part (materializeRebench with
// Lane B's runtime stages, runtime-copy.Dockerfile and part R's task setup, which is B1's lines plus Codex CLI 0.170.0), then
// codex --version in a throwaway container of the built image, with no network, must print the pinned version. Each task's
// row lands in <dir>/images.jsonl with the built image's id, and its images are removed after its row. b2 images --record
// <dir> folds the rows (several shards' dirs may be given) into the record the launch guard reads (B2_IMAGES): ok only when
// every one of the 183 run tasks has a passing row. Needs Docker and SWEREBENCH.
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildError } from "../harness-mechanics/build-check.ts";
import { imageRef, pool, rebenchRoot } from "../harness-mechanics/screen.ts";
import { SCREEN } from "../harness-mechanics/pins.ts";
import { loadRebenchPool, materializeRebench, R3A4_POOL_FILE, R3A4_POOL_SHA256 } from "../../quick/laneb/runner/materialize.ts";
import { taskSetupLines } from "../../quick/laneb/runner/prepare-run.ts";
import { CODEX_BIN, drawnTasks, HOSTS, REPO, sha256 } from "./pins.ts";

export type ImageRow = { task: string; pass: boolean; image?: string; version?: string; error?: string };
export type ImagesRecord = { ok: boolean; why: string; tasks: number; passed: number; rows_sha256: string; task_setup_sha256: string };

/** A run task's trial environment for a Sol part, as Lane B's prepare writes it with part R's task setup. */
export function codexEnvironment(task: string, dest: string): string {
  const lane = join(REPO, "quick/laneb"), runner = join(lane, "runner");
  const t = loadRebenchPool(join(lane, R3A4_POOL_FILE), R3A4_POOL_SHA256).find((x) => x.task_id === task);
  if (!t) throw new Error("E_B2_IMAGES " + task + " is not a swerebench-r3a4 pool task");
  if (!existsSync(join(rebenchRoot(), task))) throw new Error("E_B2_IMAGES " + task + " is not in the SWE-rebench export at " + rebenchRoot() + "; set SWEREBENCH");
  const runtimeCopy = readFileSync(join(runner, "runtime-copy.Dockerfile"), "utf8") + taskSetupLines({ TASK_SETUP: HOSTS.codex.taskSetup.file, TASK_SETUP_SHA256: HOSTS.codex.taskSetup.sha256 });
  materializeRebench(rebenchRoot(), t, dest, { runtimeStages: readFileSync(join(runner, "runtime-stages.Dockerfile"), "utf8"), runtimeCopy, network: "allowlist" });
  return join(dest, "environment");
}

/** A built image's reads against the rule: it built, and codex --version printed the pinned version. */
export function imageProblems(r: Omit<ImageRow, "pass">): string[] {
  if (r.error) return [r.error];
  const want = "codex-cli " + HOSTS.codex.version;
  return r.version === want ? [] : ["codex --version printed " + JSON.stringify(r.version ?? "") + ", not " + JSON.stringify(want)];
}

export function buildImages(out: string, tasks: string[], log: (l: string) => void = console.log): ImageRow[] {
  mkdirSync(out, { recursive: true });
  const docker = process.env.B2_DOCKER ?? "docker", p = pool(), rows: ImageRow[] = [];
  const dk = (args: string[], timeoutSec = 600) => { const r = Bun.spawnSync([docker, ...args], { stdout: "pipe", stderr: "pipe", timeout: timeoutSec * 1000 }); return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() }; };
  for (const [i, task] of tasks.entries()) {
    const t = p.get(task), tag = "b2-image-" + process.pid + "-" + (i + 1), ctx = mkdtempSync(join(tmpdir(), "b2-image-"));
    const read: Omit<ImageRow, "pass"> = { task };
    try {
      if (!t) throw new Error("not a swerebench-r3a4 pool task");
      for (;;) {
        const pull = dk(["pull", "-q", imageRef(t)], 3600);
        if (pull.code === 0) break;
        if (!/toomanyrequests|rate limit/i.test(pull.err)) { read.error = "pull failed: " + buildError(pull.err); break; }
        log("B2_IMAGES wait Docker Hub's pull limit for " + imageRef(t));
        Bun.sleepSync(Number(process.env.B2_PULL_WAIT_SEC ?? SCREEN.pullWaitSec) * 1000);
      }
      if (!read.error) {
        const b = dk(["build", "--progress=plain", "-t", tag, codexEnvironment(task, join(ctx, "trial"))], 3600);
        if (b.code !== 0) read.error = "build failed: " + buildError(b.err);
      }
      if (!read.error) {
        read.image = dk(["image", "inspect", "--format", "{{.Id}}", tag]).out.trim();
        read.version = dk(["run", "--rm", "--network", "none", "--entrypoint", CODEX_BIN, tag, "--version"]).out.trim();
      }
    } catch (e) {
      read.error = String((e as Error).message ?? e).split("\n")[0]!;
    } finally {
      rmSync(ctx, { recursive: true, force: true });
      dk(["rmi", "-f", tag, ...(t ? [imageRef(t)] : [])]);
    }
    const problems = imageProblems(read), row: ImageRow = { ...read, pass: !problems.length };
    rows.push(row);
    appendFileSync(join(out, "images.jsonl"), JSON.stringify(row) + "\n");
    log("B2_IMAGES " + (i + 1) + "/" + tasks.length + " " + task + " " + (row.pass ? "PASS " + row.version + ", image " + row.image : "FAIL " + problems.join("; ")));
  }
  return rows;
}

/** The record the guard reads: the last row per task from every dir's images.jsonl, against the 183 run tasks. */
export function imagesRecord(dirs: string[], run: string[] = drawnTasks().run): ImagesRecord {
  const last = new Map<string, ImageRow>();
  for (const d of dirs) {
    const f = join(d, "images.jsonl");
    if (!existsSync(f)) continue;
    for (const l of readFileSync(f, "utf8").split("\n").filter(Boolean)) { const r = JSON.parse(l) as ImageRow; last.set(r.task, r); }
  }
  const missing = run.filter((t) => !last.has(t)), failed = run.filter((t) => last.has(t) && !last.get(t)!.pass);
  const rows = run.filter((t) => last.has(t)).map((t) => JSON.stringify(last.get(t)));
  const why = [missing.length ? missing.length + " run tasks have no row (first " + missing[0] + ")" : "", failed.length ? failed.length + " run tasks failed (first " + failed[0] + ": " + (last.get(failed[0]!)!.error ?? last.get(failed[0]!)!.version) + ")" : ""].filter(Boolean).join("; ");
  return { ok: !why, why: why || "every run task's image builds with Codex " + HOSTS.codex.version, tasks: run.length, passed: run.length - missing.length - failed.length, rows_sha256: sha256(rows.join("\n") + "\n"), task_setup_sha256: HOSTS.codex.taskSetup.sha256 };
}

/** The guard's read of a record file: ok only when the file says ok for all run tasks on the pinned task setup. */
export function readImagesRecord(path: string | undefined): { ok: boolean; why: string } | null {
  if (!path || !existsSync(path)) return null;
  const r = JSON.parse(readFileSync(path, "utf8")) as ImagesRecord;
  if (r.task_setup_sha256 !== HOSTS.codex.taskSetup.sha256) return { ok: false, why: "the record was made on task setup " + r.task_setup_sha256 + ", not " + HOSTS.codex.taskSetup.sha256 };
  if (r.tasks !== drawnTasks().run.length || r.passed !== r.tasks) return { ok: false, why: r.why };
  return { ok: r.ok, why: r.why };
}
export const writeImagesRecord = (path: string, r: ImagesRecord) => writeFileSync(path, JSON.stringify(r, null, 2) + "\n");
