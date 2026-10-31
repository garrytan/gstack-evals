import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dockerInstaller, installArms, releaseInstalls, type CacheHold } from "../../src/arms/install.ts";
import { resolveArms } from "../../src/skill-eval/cli/arms.ts";
import { buildTrialImage, checkImagePin, stateRoot } from "../../src/trial/image.ts";
import { dockerSandbox } from "../../src/trial/sandbox.ts";

// Opt-in (GST-361): gstack's real ./setup, run again after a run deletes its installs, must give byte-identical arm
// trees, or --resume would refuse every journaled cell with E_CACHE_STALE. It needs Docker, the trial image doctor pins,
// egress for the installers and a gstack clone that holds both commits, so it runs only when asked:
//   GSTACK_EVALS_DOCKER=1 GSTACK_EVALS_GSTACK_SOURCE=<gstack clone> bun test tests/arms/gstack-reinstall.test.ts
const SOURCE = process.env.GSTACK_EVALS_GSTACK_SOURCE;
const BASE = "7204a39a27ba90755db2e71e5bb869262a937402";
const BEFORE = "398618259d56df55e66793f168d0bd8c25cb9085";

describe.skipIf(process.env.GSTACK_EVALS_DOCKER !== "1" || !SOURCE)("gstack's real setup after a run deletes its installs (opt-in)", () => {
  for (const host of ["claude", "codex"] as const) {
    // Value: protects=U11's /learn arms on gstack@7204a39a27ba (before from 398618259d56, after and none) reinstall with the same tree_sha256 after the run that built them deletes them, so a resumed run's session keys match its journal; fails_when=gstack's setup writes a timestamp, random id or other volatile byte that reaches a layer; why_new=GST-361 (cleanup makes every --resume reinstall); seam=dockerInstaller, installArms' hold, releaseInstalls; no_claim=other gstack commits, which a bump should check again
    test("U11's /learn arms reinstall byte-identically on " + host, () => {
      expect(buildTrialImage({ state: stateRoot() }).ok).toBe(true);
      const pin = checkImagePin({ state: stateRoot() });
      if (!pin.ok) throw new Error(pin.message);
      const home = dockerSandbox({ trialImage: pin.pin.tag }).homePath("");
      const work = mkdtempSync(join(tmpdir(), "gse-reinstall-"));
      try {
        for (const [arm, sha] of [["before", BEFORE], ["after", BASE]] as const) {
          mkdirSync(join(work, arm));
          execFileSync("sh", ["-c", 'git -C "$1" archive "$2" learn | tar -x -C "$3"', "sh", SOURCE!, sha, join(work, arm)]);
        }
        const resolved = resolveArms(["before=" + join(work, "before", "learn"), "after=" + join(work, "after", "learn"), "none"], { base: "gstack@" + BASE, skill: "learn" });
        if ("code" in resolved) throw new Error(resolved.code + " " + resolved.message);
        const state = join(work, "state");
        const install = (hold: CacheHold) => installArms({ host, arms: resolved.arms, skill: "learn", base: resolved.base, sources: [SOURCE!], runner: dockerInstaller({ image: pin.pin.tag, digest: pin.pin.digest, docker: "docker", home }), state, hold }).map((a) => [a.name, a.tree_sha256]);
        const first: CacheHold = { run: "first", entries: [] };
        const trees = install(first);
        expect(releaseInstalls(first).length).toBeGreaterThanOrEqual(3);
        expect(readdirSync(join(state, "installs"))).toEqual([]);
        const resumed: CacheHold = { run: "first", entries: [] };
        expect(install(resumed)).toEqual(trees);
        releaseInstalls(resumed);
      } finally {
        rmSync(work, { recursive: true, force: true });
      }
    }, 1_800_000);
  }
});
