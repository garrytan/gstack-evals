// Trial and arm images (plan v3.2, "Execution, isolation and secrets"; Captain brief items 3, 4 and 5).
//
// - The trial image is built from docker/trial.Dockerfile with an empty build context, tagged by its recipe hash
//   (src/rig/recipe.ts) and labelled with it. doctor builds it (E_IMAGE_BUILD on failure) and pins its digest under
//   <state>/images/. A run checks the pin before it starts (checkImagePin): no pin, a tag that now names a rebuilt image,
//   a label from another recipe, or a digest other than the one the run or its preregistration recorded refuses with
//   E_IMAGE_STALE. GST-59: Lane A's first paid run used rebuilt images by mistake.
// - An arm image is the trial image plus the arm's installed tree, copied in as content-addressed layers. Its build drops
//   the skill's eval fixtures (any skill-evals path and any file whose bytes match a file in the tasks directory), and the
//   built image is scanned whole: an arm image that still holds one refuses with E_IMAGE_BUILD. Lane A's /learn image once
//   shipped tasks.json.
// - Every image and arm tree a run uses is kept by digest (retainImage, retainTree), so a replicator can fetch the exact
//   bytes; docs/adapters.md names the retention target.
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative, sep } from "node:path";
import type { ReasonCode } from "../errors/codes.ts";
import { recipeHash, recipeInputs, RIG_ROOT, TRIAL_DOCKERFILE } from "../rig/recipe.ts";
import { dirTreeSha256 } from "./cache.ts";

type Env = Record<string, string | undefined>;
export type Runner = (command: string, args: string[], opts?: { timeoutMs?: number }) => { status: number | null; stdout: string; stderr: string };

export const RECIPE_LABEL = "org.gstack-evals.recipe";
export const TRIAL_REPO = "gstack-evals-trial";
export const ARM_REPO = "gstack-evals-arm";
const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

export const dockerRun: Runner = (command, args, opts) => {
  const r = spawnSync(command, args, { encoding: "utf8", timeout: opts?.timeoutMs ?? 15_000, maxBuffer: 256 * 1024 * 1024 });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? (r.error ? String(r.error.message) : "") };
};

/** gstack-evals' state directory: $XDG_STATE_HOME/gstack-evals, ~/.capy/work/gstack-evals on Capy, else ~/.local/state/gstack-evals. */
export function stateRoot(env: Env = process.env, home = homedir()): string {
  if (env.XDG_STATE_HOME) return join(env.XDG_STATE_HOME, "gstack-evals");
  if (existsSync(join(home, ".capy", "work"))) return join(home, ".capy", "work", "gstack-evals");
  return join(home, ".local", "state", "gstack-evals");
}

export interface ImagePin {
  schema_version: 1;
  recipe_sha256: string;
  tag: string;
  /** The image id docker reports (sha256:...), the digest a run records. */
  digest: string;
  built_at: string;
  from_pins: string[];
}

export type ImageStop = { ok: false; code: ReasonCode; message: string; fix?: string };

export const trialTag = (recipe: string) => TRIAL_REPO + ":" + recipe.slice(0, 16);
const pinFile = (state: string, recipe: string) => join(state, "images", "trial-" + recipe + ".json");
const lastLine = (s: string) => s.trim().split("\n").slice(-1)[0] ?? "";

function inspect(run: Runner, image: string, docker = "docker"): { id: string; recipe: string | null } | null {
  const r = run(docker, ["image", "inspect", "--format", "{{.Id}} {{index .Config.Labels \"" + RECIPE_LABEL + "\"}}", image]);
  if (r.status !== 0) return null;
  const [id = "", recipe = ""] = r.stdout.trim().split(/\s+/);
  return id.startsWith("sha256:") ? { id, recipe: recipe && recipe !== "<no value>" ? recipe : null } : null;
}

function writeAtomic(path: string, text: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  const tmp = path + "." + process.pid + ".tmp";
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

/** Builds the trial image for this checkout's recipe and pins its digest (doctor's step). */
export function buildTrialImage(opts: { root?: string; state?: string; run?: Runner; docker?: string } = {}): ({ ok: true; log: string } & ImagePin) | ImageStop {
  const root = opts.root ?? RIG_ROOT;
  const run = opts.run ?? dockerRun;
  const docker = opts.docker ?? "docker";
  const state = opts.state ?? stateRoot();
  const inputs = recipeInputs(root);
  const recipe = recipeHash(inputs);
  const tag = trialTag(recipe);
  const log = join(state, "images", "build-" + recipe.slice(0, 16) + ".log");
  const context = join(state, "images", "empty-context");
  mkdirSync(context, { recursive: true });
  for (const name of readdirSync(context)) rmSync(join(context, name), { recursive: true, force: true });
  const r = run(docker, ["build", "--target", "trial", "--label", RECIPE_LABEL + "=" + recipe, "-t", tag, "-f", join(root, TRIAL_DOCKERFILE), context], { timeoutMs: 1_800_000 });
  writeAtomic(log, "$ docker build " + TRIAL_DOCKERFILE + " (recipe " + recipe + ")\n" + r.stdout + r.stderr);
  if (r.status !== 0) return { ok: false, code: "E_IMAGE_BUILD", message: "docker build of " + TRIAL_DOCKERFILE + " " + (r.status === null ? "did not finish" : "exited " + r.status) + ": " + lastLine(r.stderr || r.stdout) + " (build log: " + log + ")" };
  const image = inspect(run, tag, docker);
  if (!image) return { ok: false, code: "E_IMAGE_BUILD", message: "docker built " + tag + " but docker image inspect cannot read its id (build log: " + log + ")" };
  const pin: ImagePin = { schema_version: 1, recipe_sha256: recipe, tag, digest: image.id, built_at: new Date().toISOString(), from_pins: inputs.from_pins };
  writeAtomic(pinFile(state, recipe), JSON.stringify(pin, null, 2) + "\n");
  return { ok: true, log, ...pin };
}

/**
 * The image a run may use: the pinned trial image for this checkout's recipe, still under its tag and label, and equal
 * to expectDigest when the run (on resume) or its preregistration recorded one.
 */
export function checkImagePin(opts: { root?: string; state?: string; run?: Runner; expectDigest?: string | null; docker?: string } = {}): { ok: true; pin: ImagePin } | ImageStop {
  const root = opts.root ?? RIG_ROOT;
  const run = opts.run ?? dockerRun;
  const state = opts.state ?? stateRoot();
  const recipe = recipeHash(recipeInputs(root));
  const stale = (message: string, fix?: string): ImageStop => ({ ok: false, code: "E_IMAGE_STALE", message, ...(fix ? { fix } : {}) });
  const file = pinFile(state, recipe);
  if (!existsSync(file)) return stale("no trial image is pinned for recipe " + recipe.slice(0, 16) + " (" + file + " is missing)", "Run gstack-evals doctor, which builds the image from " + TRIAL_DOCKERFILE + " and pins its digest.");
  const pin = JSON.parse(readFileSync(file, "utf8")) as ImagePin;
  const image = inspect(run, pin.tag, opts.docker);
  if (!image) return stale(pin.tag + " is pinned at " + pin.digest + " but no local image has that tag");
  if (image.id !== pin.digest) return stale(pin.tag + " now names " + image.id + ", not the pinned " + pin.digest + "; the image was rebuilt or replaced after doctor pinned it");
  if (image.recipe !== recipe) return stale(pin.tag + " carries recipe label " + (image.recipe ?? "none") + ", not " + recipe);
  if (opts.expectDigest && opts.expectDigest !== pin.digest) return stale("the run recorded image " + opts.expectDigest + ", but the pinned image for this recipe is " + pin.digest, "Restore the recorded image from the run's retained tarball (docker load -i <retained>/images/<digest>.tar) and pin it, or start a new run; never resume on a rebuilt image.");
  return { ok: true, pin };
}

/** sha256 of every non-empty file under the tasks directory: the eval fixtures an arm image must not hold. */
export function fixtureDigests(tasksDir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      const st = lstatSync(path);
      if (st.isDirectory()) walk(path);
      else if (st.isFile() && st.size > 0) out.set(createHash("sha256").update(readFileSync(path)).digest("hex"), relative(tasksDir, path));
    }
  };
  walk(tasksDir);
  return out;
}

export const FIXTURE_PATH = /(^|\/)skill-evals(\/|$)/;

/** Files in an image that are eval fixtures: a skill-evals path, or bytes equal to a file in the tasks directory. */
export function imageFixtures(image: string, tasksDir: string, run: Runner = dockerRun, docker = "docker"): { hits: string[] } | ImageStop {
  const digests = fixtureDigests(tasksDir);
  const scan = "find / -xdev \\( -path /proc -o -path /sys -o -path /dev \\) -prune -o -type f -print0 | xargs -0 -r sha256sum";
  const r = run(docker, ["run", "--rm", "--network", "none", "--user", "0:0", "--entrypoint", "sh", image, "-c", scan], { timeoutMs: 600_000 });
  if (r.status !== 0) return { ok: false, code: "E_IMAGE_BUILD", message: "could not scan " + image + " for eval fixtures, so it is not known to be clean: " + (lastLine(r.stderr) || "exit " + r.status) };
  const hits: string[] = [];
  for (const line of r.stdout.split("\n")) {
    const m = /^([0-9a-f]{64}) {2}(.+)$/.exec(line);
    if (!m) continue;
    const [, hash, path] = m as unknown as [string, string, string];
    if (FIXTURE_PATH.test(path)) hits.push(path + " (a skill-evals path)");
    else if (hash !== EMPTY_SHA256 && digests.has(hash)) hits.push(path + " (same bytes as " + digests.get(hash) + ")");
  }
  return { hits };
}

export interface ArmLayer {
  /** A directory on this machine. */
  src: string;
  /** Where it lands in the image, such as the host's skills directory under /home/agent. */
  dest: string;
}

/** Copies a layer's tree into the build context, dropping .git, skill-evals paths and files with a fixture's bytes; modes become 0755 or 0644 so the agent's uid can read every file, and a sticky directory stays 1777. */
function stage(src: string, to: string, digests: Map<string, string>, dropped: string[], rel = ""): void {
  mkdirSync(to, { recursive: true });
  chmodSync(to, lstatSync(src).mode & 0o1000 ? 0o1777 : 0o755);
  for (const name of readdirSync(src).sort()) {
    const path = join(src, name);
    const relPath = rel ? rel + "/" + name : name;
    const st = lstatSync(path);
    if (name === ".git" || FIXTURE_PATH.test(relPath)) {
      dropped.push(relPath);
      continue;
    }
    if (st.isDirectory()) stage(path, join(to, name), digests, dropped, relPath);
    else if (st.isFile() && st.size > 0 && digests.has(createHash("sha256").update(readFileSync(path)).digest("hex"))) dropped.push(relPath);
    else {
      cpSync(path, join(to, name), { verbatimSymlinks: true, preserveTimestamps: false });
      if (st.isFile()) chmodSync(join(to, name), st.mode & 0o111 ? 0o755 : 0o644);
    }
  }
}

/**
 * Builds the arm image: the trial image plus each layer, tagged by a hash of the base digest, the staged tree and the
 * destinations, and reused when that tag already exists. BuildKit cannot take a bare image id in FROM, so the base is
 * tagged by its id first. The build is reproducible: no provenance attestation, SOURCE_DATE_EPOCH=0 and layer timestamps
 * rewritten to it, so the same base and layers give the same image digest. The built image is scanned for eval fixtures.
 */
export function buildArmImage(opts: { base: string; layers: ArmLayer[]; tasksDir: string; state?: string; run?: Runner; docker?: string; noCache?: boolean }): { ok: true; tag: string; digest: string; tree_sha256: string; dropped: string[] } | ImageStop {
  const run = opts.run ?? dockerRun;
  const docker = opts.docker ?? "docker";
  const state = opts.state ?? stateRoot();
  const digests = fixtureDigests(opts.tasksDir);
  const base = inspect(run, opts.base, docker);
  if (!base) return { ok: false, code: "E_IMAGE_STALE", message: "the arm's base image " + opts.base + " is not a local image" };
  const baseTag = "gstack-evals-base:" + base.id.replace("sha256:", "").slice(0, 32);
  if (run(docker, ["tag", base.id, baseTag]).status !== 0) return { ok: false, code: "E_IMAGE_BUILD", message: "docker tag " + base.id + " " + baseTag + " failed" };
  const context = join(state, "images", "arm-context-" + randomBytes(6).toString("hex"));
  const dropped: string[] = [];
  try {
    mkdirSync(context, { recursive: true });
    opts.layers.forEach((layer, i) => stage(layer.src, join(context, "layer-" + i), digests, dropped));
    const tree = dirTreeSha256(context);
    const id = createHash("sha256").update([base.id, tree, ...opts.layers.map((l) => l.dest)].join("\n")).digest("hex");
    const tag = ARM_REPO + ":" + id.slice(0, 16);
    writeFileSync(join(context, "Dockerfile"), "FROM " + baseTag + "\n" + opts.layers.map((l, i) => "COPY layer-" + i + "/ " + JSON.stringify(l.dest) + "\n").join(""));
    let image = opts.noCache ? null : inspect(run, tag, docker);
    if (!image || image.recipe !== id) {
      const reproducible = ["--provenance=false", "--build-arg", "SOURCE_DATE_EPOCH=0", "--output", "type=image,name=" + tag + ",rewrite-timestamp=true", ...(opts.noCache ? ["--no-cache"] : [])];
      const r = run(docker, ["build", ...reproducible, "--label", RECIPE_LABEL + "=" + id, context], { timeoutMs: 1_800_000 });
      if (r.status !== 0) return { ok: false, code: "E_IMAGE_BUILD", message: "docker build of arm image " + tag + " exited " + r.status + ": " + lastLine(r.stderr || r.stdout) };
      image = inspect(run, tag, docker);
      if (!image) return { ok: false, code: "E_IMAGE_BUILD", message: "docker built " + tag + " but cannot read its id" };
    }
    const scan = imageFixtures(tag, opts.tasksDir, run, docker);
    if ("ok" in scan) return scan;
    if (scan.hits.length) return { ok: false, code: "E_IMAGE_BUILD", message: "arm image " + tag + " holds the skill's eval fixtures, which would put the answer key in the agent's reach: " + scan.hits.join(", ") };
    return { ok: true, tag, digest: image.id, tree_sha256: tree, dropped };
  } finally {
    rmSync(context, { recursive: true, force: true });
  }
}

export interface Retained {
  kind: "image" | "tree";
  /** The image id, or the tree's sha256 (dirTreeSha256). */
  ref: string;
  file: string;
  sha256: string;
  bytes: number;
}

function record(dir: string, entry: Retained): Retained {
  const manifest = join(dir, "MANIFEST.jsonl");
  const seen = existsSync(manifest) && readFileSync(manifest, "utf8").split("\n").some((l) => l && JSON.parse(l).file === entry.file);
  if (!seen) writeFileSync(manifest, JSON.stringify(entry) + "\n", { flag: "a" });
  return entry;
}

const fileSha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

/** Saves an image once, by its id, as <dir>/images/<id>.tar, and lists it in <dir>/MANIFEST.jsonl. */
export function retainImage(image: string, dir: string, run: Runner = dockerRun, docker = "docker"): Retained | ImageStop {
  const found = inspect(run, image, docker);
  if (!found) return { ok: false, code: "E_IMAGE_STALE", message: "cannot retain " + image + ": no local image has that name" };
  const file = join("images", found.id.replace("sha256:", "") + ".tar");
  const path = join(dir, file);
  if (!existsSync(path)) {
    mkdirSync(join(dir, "images"), { recursive: true });
    const r = run(docker, ["save", "-o", path + ".tmp", found.id], { timeoutMs: 1_800_000 });
    if (r.status !== 0) return { ok: false, code: "E_IMAGE_BUILD", message: "docker save " + found.id + " exited " + r.status + ": " + lastLine(r.stderr) };
    renameSync(path + ".tmp", path);
  }
  return record(dir, { kind: "image", ref: found.id, file, sha256: fileSha(path), bytes: lstatSync(path).size });
}

/** Archives a tree once, by its tree sha256, as a byte-stable tar (sorted, owner 0, mtime 0) under <dir>/trees/. */
export function retainTree(src: string, dir: string): Retained {
  const tree = dirTreeSha256(src);
  const file = join("trees", tree + ".tar");
  const path = join(dir, file);
  if (!existsSync(path)) {
    mkdirSync(join(dir, "trees"), { recursive: true });
    const r = spawnSync("tar", ["--sort=name", "--mtime=@0", "--owner=0", "--group=0", "--numeric-owner", "-C", src, "-cf", path + ".tmp", "."], { encoding: "utf8" });
    if (r.status !== 0) throw new Error("tar of " + src + " failed: " + r.stderr);
    renameSync(path + ".tmp", path);
  }
  return record(dir, { kind: "tree", ref: tree, file: file.split(sep).join("/"), sha256: fileSha(path), bytes: lstatSync(path).size });
}
