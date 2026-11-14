// Copyright (c) 2026 Garry Tan. MIT License.
// The controller host's provisioning pieces with fakes at the lowest seam: the trial image loaded through a stand-in
// docker runner and pinned as doctor pins it, a load whose recipe label differs refused, the provisioning lines for
// Docker and the gstack pin, and the pin packed from a local repository with no history. No Docker, no network.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recipeHash, recipeInputs } from "../../../src/rig/recipe.ts";
import type { Runner } from "../../../src/trial/image.ts";
import { controllerProvision, gstackPack, HOST_GSTACK_SOURCE, layout } from "../../../lanes/design-constructed/money/controller-host.ts";
import { hostImage, loadTrialImage } from "../../../lanes/design-constructed/money/host-image.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "dc-hostimg-"));
  dirs.push(d);
  return d;
};
const ID = "sha256:" + "12".repeat(32);

function docker(label: string): Runner & { calls: string[][] } {
  const calls: string[][] = [];
  const run = ((_cmd: string, args: string[]) => {
    calls.push(args);
    if (args[0] === "load") return { status: 0, stdout: "Loaded image ID: " + ID + "\n", stderr: "" };
    if (args[0] === "image") return { status: 0, stdout: ID + " " + label + "\n", stderr: "" };
    if (args[0] === "tag") return { status: 0, stdout: "", stderr: "" };
    return { status: 1, stdout: "", stderr: "unexpected" };
  }) as Runner & { calls: string[][] };
  run.calls = calls;
  return run;
}

describe("the controller host's trial image and gstack pin", () => {
  test("a loaded image with this checkout's recipe is tagged, pinned and passes checkImagePin", () => {
    const state = tmp();
    const recipe = recipeHash(recipeInputs());
    const run = docker(recipe);
    const r = hostImage({ load: "/x/image.tar", state, run });
    expect(r).toEqual({ ok: true, digest: ID, tag: "gstack-evals-trial:" + recipe.slice(0, 16), how: "loaded" });
    expect(run.calls.map((c) => c[0])).toEqual(["load", "image", "tag", "image"]);
    expect(JSON.parse(readFileSync(join(state, "images", "trial-" + recipe + ".json"), "utf8")).digest).toBe(ID);
  });

  test("a loaded image built from another recipe is refused and nothing is pinned", () => {
    const r = loadTrialImage("/x/image.tar", { state: tmp(), run: docker("f".repeat(64)) });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.why).toContain("not this checkout's");
  });

  test("the provisioning installs Docker and git, imports the pin and checks its tree, then loads the image", () => {
    const l = layout("r");
    const lines = controllerProvision({ bunVersion: "1.4.4", mirrors: false })({ privateIp: null, layout: l, uploads: { image: "load", gstack: { commit: "a".repeat(40), tree: "b".repeat(40) } } }).join("\n");
    expect(lines).toContain("apt-get install -y python3 openssh-client curl unzip tar git docker.io");
    expect(lines).toContain("systemctl enable --now docker");
    expect(lines).toContain('test "$(git -C ' + "'" + HOST_GSTACK_SOURCE + "'" + " rev-parse " + "a".repeat(40) + '^{tree})" = ' + "b".repeat(40));
    expect(lines).toContain("--load '" + l.root + "/image.tar'");
    expect(controllerProvision({ bunVersion: "1.4.4", mirrors: false, system: false })({ privateIp: null, layout: l }).join("\n")).toBe("set -euo pipefail");
    expect(() => controllerProvision({ bunVersion: "1.4.4", mirrors: false })({ privateIp: null, layout: l, uploads: { image: null, gstack: { commit: "x", tree: "y" } } })).toThrow("full shas");
  });

  test("the pin pack holds the commit and its tree with no history, and imports into an empty repository", () => {
    const d = tmp();
    const repo = join(d, "src");
    mkdirSync(repo);
    const env = { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: d, GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@invalid", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@invalid" };
    const g = (cwd: string, args: string[], stdin?: Uint8Array) => Bun.spawnSync(["git", ...args], { cwd, env, stdin, stdout: "pipe", stderr: "pipe" });
    g(repo, ["init", "-q"]);
    for (const n of ["one", "two"]) {
      writeFileSync(join(repo, n + ".txt"), n + "\n");
      g(repo, ["add", "."]);
      g(repo, ["commit", "-qm", n]);
    }
    const head = new TextDecoder().decode(g(repo, ["rev-parse", "HEAD"]).stdout).trim();
    const p = gstackPack(repo, head);
    const bare = join(d, "bare");
    g(d, ["init", "-q", "--bare", bare]);
    expect(g(bare, ["index-pack", "--stdin"], p.pack).exitCode).toBe(0);
    expect(new TextDecoder().decode(g(bare, ["rev-parse", head + "^{tree}"]).stdout).trim()).toBe(p.tree);
    const parent = new TextDecoder().decode(g(repo, ["rev-parse", head + "^"]).stdout).trim();
    expect(g(bare, ["cat-file", "-e", parent]).exitCode).not.toBe(0);
    expect(() => gstackPack(repo, "c".repeat(40))).toThrow("doesn't hold commit");
  });
});
