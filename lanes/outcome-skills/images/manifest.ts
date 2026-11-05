// T-G's per-task image manifest and the trial-image binding (G admission readiness; the O5 pin post's open start condition
// 1). pin builds each sealed task's image on the envelope host with the lane's buildImage and writes one row per task.
// check runs before any session or lease: each row's image must be present with exactly its pinned id, and
// cleanRoomPreflight (C1's scan and O1's second scan, by image id, no network) must pass on it with the none arm's home and
// work dir. bind writes a task's run copy for Harbor: its environment is only FROM a local tag of the pinned image, and its
// task.toml names that tag as Harbor's prebuilt docker_image, so Harbor runs the pinned image itself, for both arms.
// real_agent then asserts the trial container's image id (image_id) before any sandbox or session opens. publicForm is the
// committed form: digests only, sorted, with kind counts and the sealed manifest's sha256; labels stay sealed.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileDigests, readTask, walk } from "../../real-outcome/task/format.ts";
import { cleanRoomPreflight } from "../arms/clean-room.ts";

export const HOME = "/root";
export const WORKDIR = "/testbed";
const ID = /^sha256:[0-9a-f]{64}$/;

export interface ImageRow {
  label: string;
  kind: string;
  task_json_sha256: string;
  environment_sha256: string;
  image_id: string;
}
export interface ImageManifest {
  schema: "tg-images.v1";
  set: string;
  gstack_evals: string;
  home: string;
  workdir: string;
  rows: ImageRow[];
}

const fail = (message: string): never => {
  throw new Error("E_OUTCOME_IMAGE " + message);
};
const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

/** sha256 over each file's path relative to dir and its own sha256, in sorted order. */
export function treeDigest(dir: string): string {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d).sort()) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else files.push(p);
    }
  };
  walk(dir);
  return sha(files.map((f) => relative(dir, f) + "\0" + sha(readFileSync(f)) + "\n").join(""));
}

export function readManifest(path: string): ImageManifest {
  let m: ImageManifest;
  try {
    m = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    return fail("cannot read the manifest " + path + ": " + (e as Error).message);
  }
  if (m.schema !== "tg-images.v1" || !Array.isArray(m.rows) || !m.rows.length || m.home !== HOME || m.workdir !== WORKDIR) fail(path + " is not a tg-images.v1 manifest with rows, home " + HOME + " and work dir " + WORKDIR);
  const labels = new Set<string>();
  for (const r of m.rows) {
    if (!r.label || labels.has(r.label)) fail(path + ": every row needs its own label");
    labels.add(r.label);
    if (!ID.test(r.image_id)) fail(path + ": row " + r.label + " has no sha256:<64 hex> image id");
    if (!/^[0-9a-f]{64}$/.test(r.task_json_sha256) || !/^[0-9a-f]{64}$/.test(r.environment_sha256)) fail(path + ": row " + r.label + " needs its task.json and environment digests");
  }
  return m;
}

/** Builds each task's image with the lane's buildImage (keyless for upstream tasks) and writes the manifest, rows by label. */
export async function pin(dirs: string[], out: string, set: string, commit: string): Promise<ImageManifest> {
  if (existsSync(out)) fail(out + " exists; pin writes a new manifest");
  const { buildImage } = await import("../../real-outcome/task/check.ts");
  const rows = dirs.map((d): ImageRow => {
    const t = readTask(d);
    return { label: t.id, kind: t.kind, task_json_sha256: sha(readFileSync(join(d, "task.json"))), environment_sha256: treeDigest(join(d, "environment")), image_id: buildImage(d, t).id };
  });
  rows.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
  const m: ImageManifest = { schema: "tg-images.v1", set, gstack_evals: commit, home: HOME, workdir: WORKDIR, rows };
  writeFileSync(out, JSON.stringify(m, null, 1) + "\n");
  return readManifest(out);
}

/** Before any session: every row's image present by its id and clean. Calls back once per row; throws at the first miss. */
export function check(m: ImageManifest, docker = "docker", each: (row: ImageRow, n: number) => void = () => {}): void {
  m.rows.forEach((r, i) => {
    cleanRoomPreflight({ docker, image: r.image_id, home: m.home, workdirs: [m.workdir], mounts: [], digest: r.image_id });
    each(r, i + 1);
  });
}

export function publicForm(m: ImageManifest, manifestBytes: Buffer) {
  const kinds: Record<string, number> = {};
  for (const r of m.rows) kinds[r.kind] = (kinds[r.kind] ?? 0) + 1;
  return { schema: "tg-images.public.v1", set: m.set, manifest_sha256: sha(manifestBytes), gstack_evals: m.gstack_evals, rows: m.rows.length, kinds, image_ids: m.rows.map((r) => r.image_id).sort(), environment_sha256: m.rows.map((r) => r.environment_sha256).sort() };
}

export const tagFor = (imageId: string) => "gstack-evals-tg-" + imageId.slice(7, 19) + ":pinned";

/** The task's run copy for Harbor, bound to its row's image. The checks read the copy itself, so the bytes Harbor gets are
 *  the bytes checked. Refuses a task dir that is not the pinned one (task.json, environment, any file against task.json's
 *  file digests, any symlink), an image that is missing or moved, and an out dir that exists; a refusal leaves no copy. */
export function bind(taskDir: string, m: ImageManifest, label: string, out: string, docker = "docker"): { image_id: string; tag: string; out: string } {
  const row = m.rows.find((r) => r.label === label) ?? fail("no row for label " + label + " in the manifest");
  if (existsSync(out)) fail(out + " exists; bind writes a new run copy");
  const tag = tagFor(row.image_id);
  try {
    cpSync(taskDir, out, { recursive: true });
    const { links } = walk(out);
    if (links.length) fail(taskDir + " holds symlinks (" + links.join(", ") + "); a run copy takes only the task's own files");
    const raw = readFileSync(join(out, "task.json"));
    const got = sha(raw);
    if (got !== row.task_json_sha256) fail(taskDir + "/task.json has sha256 " + got + ", not the manifest row's " + row.task_json_sha256);
    const env = treeDigest(join(out, "environment"));
    if (env !== row.environment_sha256) fail(taskDir + "/environment has digest " + env + ", not the manifest row's " + row.environment_sha256);
    let want: Record<string, string>;
    try {
      want = JSON.parse(raw.toString("utf8")).files ?? {};
    } catch (e) {
      return fail(taskDir + "/task.json is not JSON: " + (e as Error).message);
    }
    const have = fileDigests(out);
    const drift = [...new Set([...Object.keys(have), ...Object.keys(want)])].filter((f) => have[f] !== want[f]).sort();
    if (drift.length) fail(taskDir + ": " + drift.join(", ") + " differ from task.json's file digests");
    const toml = readFileSync(join(out, "task.toml"), "utf8");
    if (!/^\[environment\]$/m.test(toml) || /^\s*docker_image\s*=/m.test(toml)) fail(taskDir + "/task.toml needs an [environment] section and no docker_image of its own");
    const t = spawnSync(docker, ["tag", row.image_id, tag], { encoding: "utf8", timeout: 30_000 });
    if (t.status !== 0) fail("docker tag " + row.image_id + " failed (exit " + (t.status ?? t.signal) + "): " + (t.stderr ?? "").trim().slice(-300));
    const id = spawnSync(docker, ["image", "inspect", "--format", "{{.Id}}", tag], { encoding: "utf8", timeout: 30_000 });
    if (id.status !== 0 || id.stdout.trim() !== row.image_id) fail("the tag " + tag + " resolves to " + (id.stdout ?? "").trim() + ", not " + row.image_id);
    rmSync(join(out, "environment"), { recursive: true, force: true });
    mkdirSync(join(out, "environment"));
    writeFileSync(join(out, "environment", "Dockerfile"), "FROM " + tag + "\n");
    writeFileSync(join(out, "task.toml"), toml.replace(/^\[environment\]$/m, "[environment]\ndocker_image = " + JSON.stringify(tag)));
  } catch (e) {
    rmSync(out, { recursive: true, force: true });
    throw e;
  }
  return { image_id: row.image_id, tag, out };
}
