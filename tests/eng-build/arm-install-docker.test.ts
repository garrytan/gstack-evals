// Copyright (c) 2026 Garry Tan. MIT License.
// The candidate review arm installed once through the rig's real install path (GSTACK_EVALS_DOCKER=1 and EB_GSTACK_SOURCE,
// a public gstack clone that holds the arm's pin): review-stage.ts reviewArmSpec gives the spec, installArms extracts the
// pinned tree from the clone and verifies it against the commit's tree, and the Docker installer runs installCommand in
// the pinned trial image (gstack-evals doctor pins it), as dockerRig does. Keyless: setup fetches public packages only,
// and no key variable reaches the installer container.
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REVIEW_ARMS } from "../../lanes/eng-build/arms.ts";
import { installCommand, reviewArmSpec } from "../../lanes/eng-build/review-stage.ts";
import { dockerInstaller, installArms } from "../../src/arms/install.ts";
import { checkImagePin } from "../../src/trial/image.ts";
import { dockerSandbox } from "../../src/trial/sandbox.ts";
import { ER_INSTALL_SKILL } from "../../src/trial/review/eng-review.ts";

const SOURCE = process.env.EB_GSTACK_SOURCE ?? "";
const RUN = process.env.GSTACK_EVALS_DOCKER === "1" && SOURCE !== "";

describe.skipIf(!RUN)("the candidate arm through the rig's install path (GSTACK_EVALS_DOCKER=1, EB_GSTACK_SOURCE)", () => {
  test("installs gstack at the candidate's pin with ./setup --host claude, and the installed tree is the pinned commit's", () => {
    const pin = checkImagePin({});
    if (!pin.ok) throw new Error(pin.code + ": " + pin.message);
    const spec = reviewArmSpec("candidate")!;
    expect(spec).toMatchObject({ kind: "stack", stack: { sha: REVIEW_ARMS.candidate.gstack!.sha }, install: { claude: "./setup --host claude" } });
    expect(installCommand("candidate")).toBe("./setup --host claude");
    const state = mkdtempSync(join(tmpdir(), "eb-install-"));
    try {
      const home = dockerSandbox({ trialImage: pin.pin.tag }).homePath("");
      const [arm] = installArms({ host: "claude", arms: [spec], skill: null, skills: { candidate: ER_INSTALL_SKILL.candidate }, base: null, sources: [SOURCE], runner: dockerInstaller({ image: pin.pin.tag, digest: pin.pin.digest, docker: "docker", home }), state });
      const full = spawnSync("git", ["-C", SOURCE, "rev-parse", REVIEW_ARMS.candidate.gstack!.sha + "^{commit}"], { encoding: "utf8" }).stdout.trim();
      const tree = spawnSync("git", ["-C", SOURCE, "rev-parse", full + "^{tree}"], { encoding: "utf8" }).stdout.trim();
      const p = arm!.provenance as { kind: string; stack: { sha: string; git_tree: string }; install: { command: string; runner: string } };
      expect(p.kind).toBe("stack");
      expect(full.startsWith(p.stack.sha)).toBe(true);
      expect(p.stack.git_tree).toBe(tree);
      expect(p.install).toMatchObject({ command: "./setup --host claude", runner: "docker " + pin.pin.digest });
      expect(arm!.skill?.roots.some((r) => r.endsWith("/plan-coverage"))).toBe(true);
      const checkout = arm!.skill!.dir.slice(0, arm!.skill!.dir.lastIndexOf("/.local/share/gstack/") + "/.local/share/gstack".length);
      expect(checkout.endsWith("/.local/share/gstack")).toBe(true);
      const version = readFileSync(join(checkout, "VERSION"), "utf8").trim();
      const pinned = spawnSync("git", ["-C", SOURCE, "show", full + ":VERSION"], { encoding: "utf8" }).stdout.trim();
      expect(version).toBe(pinned);
      console.log("candidate installed: commit " + full + ", tree " + tree + ", VERSION " + version + ", skill " + ER_INSTALL_SKILL.candidate + " at " + arm!.skill!.roots.length + " roots, runner " + p.install.runner);
      expect(existsSync(arm!.skill!.file)).toBe(true);
    } finally {
      rmSync(state, { recursive: true, force: true });
    }
  }, 1_800_000);
});
