// Copyright (c) 2026 Garry Tan. MIT License.
// The controller host's trial image, run by controller-host.ts's provisioning from the repository folder:
//   XDG_STATE_HOME=<host>/xdg bun lanes/design-constructed/money/host-image.ts --out <file> [--load <tar>] [--docker <bin>]
// With --load it loads a docker save tar of the pinned trial image, checks the image carries this checkout's recipe
// label, tags it as main's trial tag and pins it the way gstack-evals doctor does; without it, it builds the image from
// docker/trial.Dockerfile (src/trial/image.ts buildTrialImage). Either way checkImagePin must then pass, and the digest
// (the image id every session records) is written to --out for the launcher to compare with the wiring's sessions section.
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { recipeHash, recipeInputs, RIG_ROOT } from "../../../src/rig/recipe.ts";
import { buildTrialImage, checkImagePin, dockerRun, RECIPE_LABEL, stateRoot, trialTag, type ImagePin, type Runner } from "../../../src/trial/image.ts";

export type HostImage = { ok: true; digest: string; tag: string; how: "loaded" | "built" } | { ok: false; why: string };

const writeAtomic = (path: string, text: string) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path + ".tmp", text);
  renameSync(path + ".tmp", path);
};

/** Loads a saved trial image and pins it under this checkout's recipe, as doctor's build would. */
export function loadTrialImage(tar: string, o: { state?: string; run?: Runner; docker?: string; root?: string } = {}): HostImage {
  const run = o.run ?? dockerRun;
  const docker = o.docker ?? "docker";
  const state = o.state ?? stateRoot();
  const inputs = recipeInputs(o.root ?? RIG_ROOT);
  const recipe = recipeHash(inputs);
  const loaded = run(docker, ["load", "-q", "-i", tar], { timeoutMs: 1_800_000 });
  if (loaded.status !== 0) return { ok: false, why: "docker load exited " + loaded.status + ": " + loaded.stderr.trim() };
  const ref = /Loaded image ID: (sha256:[0-9a-f]{64})/.exec(loaded.stdout)?.[1] ?? /Loaded image: (\S+)/.exec(loaded.stdout)?.[1] ?? null;
  if (!ref) return { ok: false, why: "docker load named no image" };
  const seen = run(docker, ["image", "inspect", "--format", "{{.Id}} {{index .Config.Labels \"" + RECIPE_LABEL + "\"}}", ref]);
  const [digest = "", label = ""] = seen.stdout.trim().split(/\s+/);
  if (seen.status !== 0 || !/^sha256:[0-9a-f]{64}$/.test(digest)) return { ok: false, why: "docker image inspect could not read the loaded image's id" };
  if (label !== recipe) return { ok: false, why: "the loaded image carries recipe " + (label || "none") + ", not this checkout's " + recipe };
  const tag = trialTag(recipe);
  const tagged = run(docker, ["tag", digest, tag]);
  if (tagged.status !== 0) return { ok: false, why: "docker tag exited " + tagged.status + ": " + tagged.stderr.trim() };
  const pin: ImagePin = { schema_version: 1, recipe_sha256: recipe, tag, digest, built_at: new Date().toISOString(), from_pins: inputs.from_pins };
  writeAtomic(join(state, "images", "trial-" + recipe + ".json"), JSON.stringify(pin, null, 2) + "\n");
  return { ok: true, digest, tag, how: "loaded" };
}

/** The host's trial image: loaded from a tar when one was uploaded, else built; then checked as every session checks it. */
export function hostImage(o: { load?: string | null; state?: string; run?: Runner; docker?: string; root?: string }): HostImage {
  const state = o.state ?? stateRoot();
  let got: HostImage;
  if (o.load) got = loadTrialImage(o.load, { ...o, state });
  else {
    const b = buildTrialImage({ state, run: o.run, docker: o.docker, root: o.root });
    got = b.ok ? { ok: true, digest: b.digest, tag: b.tag, how: "built" } : { ok: false, why: b.code + " " + b.message };
  }
  if (!got.ok) return got;
  const pin = checkImagePin({ state, run: o.run, docker: o.docker, root: o.root, expectDigest: got.digest });
  return pin.ok ? got : { ok: false, why: pin.code + " " + pin.message };
}

export function main(argv: string[]): number {
  const flag = (f: string) => {
    const i = argv.indexOf(f);
    return i < 0 ? null : (argv[i + 1] ?? null);
  };
  const out = flag("--out");
  if (!out) {
    process.stderr.write("E_USAGE host-image needs --out <file>\n");
    return 2;
  }
  const r = hostImage({ load: flag("--load"), docker: flag("--docker") ?? undefined });
  if (!r.ok) {
    process.stderr.write("E_DC_INFRA_MISSING the trial image: " + r.why + "\n");
    return 3;
  }
  writeAtomic(out, JSON.stringify({ digest: r.digest, tag: r.tag, how: r.how }) + "\n");
  process.stdout.write("trial image " + r.how + ": " + r.digest + "\n");
  return 0;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
