// The rig recipe hash (CI plan v5, U20; built by U9). Image digests differ across build machines, so rig proof binds to
// what an image is built from instead: the trial Dockerfile, bun.lock, every FROM image's @sha256 pin, the host CLI
// versions baked into the image (docker/host-cli.json) and the adapter sha (git rev-parse HEAD:src/adapters). U9's
// session cache key and the verdict's rig block take this same hash. rig.yml and rig admit are U20's.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { RigBlock } from "../types.ts";

export const RIG_ROOT = join(import.meta.dir, "..", "..");
export const TRIAL_DOCKERFILE = "docker/trial.Dockerfile";
export const HOST_CLI_PINS = "docker/host-cli.json";

export interface RecipeInputs {
  dockerfile_sha256: string;
  bun_lock_sha256: string;
  /** Each external FROM's image@sha256:<digest>, in file order. */
  from_pins: string[];
  /** The host CLI versions baked into the image; null for a host with none pinned yet. */
  host_cli: { claude: string | null; codex: string | null };
  /** git rev-parse HEAD:src/adapters. */
  adapter_sha: string;
}

export class RecipeError extends Error {}

const sha = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");

/** Each external FROM's image reference; one without an @sha256 pin is refused. A FROM naming an earlier stage is internal. */
export function fromPins(dockerfile: string): string[] {
  const stages = new Set<string>();
  const pins: string[] = [];
  for (const line of dockerfile.split("\n")) {
    const m = /^\s*FROM\s+(?:--\S+\s+)*(\S+)(?:\s+AS\s+(\S+))?\s*$/i.exec(line);
    if (!m) continue;
    const image = m[1]!;
    if (!stages.has(image.toLowerCase())) {
      if (!/@sha256:[0-9a-f]{64}$/.test(image)) throw new RecipeError("FROM " + image + " is not pinned by @sha256 digest");
      pins.push(image);
    }
    if (m[2]) stages.add(m[2].toLowerCase());
  }
  if (!pins.length) throw new RecipeError("the Dockerfile has no FROM line");
  return pins;
}

export function recipeInputs(root: string = RIG_ROOT): RecipeInputs {
  const dockerfile = readFileSync(join(root, TRIAL_DOCKERFILE));
  const pins = JSON.parse(readFileSync(join(root, HOST_CLI_PINS), "utf8")) as Record<string, unknown>;
  const host = (name: "claude" | "codex") => {
    const v = pins[name];
    if (v !== null && (typeof v !== "string" || !/^\d+\.\d+\.\d+[\w.+-]*$/.test(v))) throw new RecipeError(HOST_CLI_PINS + ": " + name + " must be null or an exact version");
    return v as string | null;
  };
  const adapters = spawnSync("git", ["rev-parse", "HEAD:src/adapters"], { cwd: root, encoding: "utf8" });
  if (adapters.status !== 0) throw new RecipeError("git rev-parse HEAD:src/adapters failed in " + root + ": " + (adapters.stderr || "").trim());
  return {
    dockerfile_sha256: sha(dockerfile),
    bun_lock_sha256: sha(readFileSync(join(root, "bun.lock"))),
    from_pins: fromPins(dockerfile.toString("utf8")),
    host_cli: { claude: host("claude"), codex: host("codex") },
    adapter_sha: adapters.stdout.trim(),
  };
}

export function recipeHash(inputs: RecipeInputs = recipeInputs()): string {
  return sha([
    "recipe v1",
    "dockerfile " + inputs.dockerfile_sha256,
    "bun.lock " + inputs.bun_lock_sha256,
    ...inputs.from_pins.map((p) => "from " + p),
    "claude " + (inputs.host_cli.claude ?? "none"),
    "codex " + (inputs.host_cli.codex ?? "none"),
    "adapters " + inputs.adapter_sha,
  ].join("\n"));
}

/** The verdict's rig block (RigBlock in src/types.ts): the same hash the session cache key takes. */
export const rigBlock = (root: string = RIG_ROOT): RigBlock => ({ recipe_sha256: recipeHash(recipeInputs(root)) });
