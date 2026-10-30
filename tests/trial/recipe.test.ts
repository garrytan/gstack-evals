import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fromPins, recipeHash, recipeInputs, RecipeError, rigBlock, RIG_ROOT, TRIAL_DOCKERFILE, type RecipeInputs } from "../../src/rig/recipe.ts";

const fixed: RecipeInputs = {
  dockerfile_sha256: "1".repeat(64),
  bun_lock_sha256: "2".repeat(64),
  from_pins: ["oven/bun:1.4.4-debian@sha256:" + "3".repeat(64), "buildpack-deps:bookworm-scm@sha256:" + "4".repeat(64)],
  host_cli: { claude: "2.1.0", codex: null },
  adapter_sha: "5".repeat(40),
};

describe("rig recipe hash", () => {
  // Value: protects=the one recipe hash that rig proof, the session cache key and the verdict's rig block share; fails_when=the hash function changes silently, or the rig block and the cache key compute it differently; why_new=CI plan v5 asks for one golden test (Captain brief item 1); seam=recipeHash, rigBlock; no_claim=rig admit, which U20 builds
  test("golden: fixed inputs give a fixed hash, and the rig block takes this checkout's hash", () => {
    expect(recipeHash(fixed)).toBe("f777d2ad6014e89ae79bf7df3d8f1fc4e2882fb14c5b5812bbe3a9c709a0a39c");
    expect(rigBlock()).toEqual({ recipe_sha256: recipeHash(recipeInputs(RIG_ROOT)) });
  });

  test("each input changes the hash", () => {
    const base = recipeHash(fixed);
    const variants: RecipeInputs[] = [
      { ...fixed, dockerfile_sha256: "9".repeat(64) },
      { ...fixed, bun_lock_sha256: "9".repeat(64) },
      { ...fixed, from_pins: [fixed.from_pins[0]!] },
      { ...fixed, host_cli: { claude: "2.1.1", codex: null } },
      { ...fixed, host_cli: { claude: "2.1.0", codex: "0.50.0" } },
      { ...fixed, adapter_sha: "9".repeat(40) },
    ];
    expect(new Set(variants.map(recipeHash).concat(base)).size).toBe(variants.length + 1);
  });

  test("every external FROM is pinned by digest; a FROM naming an earlier stage is internal", () => {
    const pins = fromPins(readFileSync(join(RIG_ROOT, TRIAL_DOCKERFILE), "utf8"));
    expect(pins).toHaveLength(2);
    for (const pin of pins) expect(pin).toMatch(/@sha256:[0-9a-f]{64}$/);
    expect(fromPins("FROM a@sha256:" + "a".repeat(64) + " AS base\nFROM base AS next\nFROM --platform=linux/amd64 next\n")).toEqual(["a@sha256:" + "a".repeat(64)]);
    expect(() => fromPins("FROM debian:bookworm-slim\n")).toThrow(RecipeError);
    expect(() => fromPins("FROM debian@sha256:abc\n")).toThrow("FROM debian@sha256:abc is not pinned by @sha256 digest");
  });
});
