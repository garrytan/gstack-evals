// Copyright (c) 2026 Garry Tan. MIT License.
// The unit stage's containment gates in Docker (GSTACK_EVALS_DOCKER=1), keyless: the leak check on the session image of a
// Node fixture unit, whose session layer copies the project's node_modules under /work/repo, and every gate of
// contain.ts (the session leak check, then the real sidecar's origin and gh gates) on a Go fixture unit's build tree.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { containUnit } from "../../lanes/eng-build/contain.ts";
import { EbError } from "../../lanes/eng-build/errors.ts";
import { leakNeedles, sessionLeakCheck } from "../../lanes/eng-build/leak.ts";
import { removeLabelled } from "../../lanes/eng-build/screen.ts";
import { removeSessionImages, sessionImage } from "../../lanes/eng-build/session-image.ts";
import { buildUnit, type BuildOutcome } from "../../lanes/eng-build/unit.ts";
import { tempDir } from "../real/fixture.ts";
import { goRepo, nodeLock, nodeRepo, type Fixture } from "./fixture.ts";

const DOCKER = process.env.GSTACK_EVALS_DOCKER === "1";
const LONG = 1_800_000;
const docker = (args: string[]) => spawnSync("docker", args, { encoding: "utf8", timeout: 600_000 });

describe.skipIf(!DOCKER)("containment gates in Docker (GSTACK_EVALS_DOCKER=1)", () => {
  let tmp: ReturnType<typeof tempDir>;
  const build = (name: string, make: (dir: string) => Fixture): { fx: Fixture; out: BuildOutcome } => {
    const fx = make(join(tmp.dir, name, "repo"));
    return { fx, out: buildUnit(fx.spec, fx.repo, join(tmp.dir, name, "unit"), { work: join(tmp.dir, name, "work"), labels: join(tmp.dir, "labels.json"), seed: 7 }) };
  };
  const units: string[] = [];

  beforeAll(() => {
    tmp = tempDir("eb-contain-docker-");
  });
  afterAll(() => {
    removeSessionImages();
    removeLabelled();
    for (const id of units) {
      const ids = docker(["images", "-q", "--filter", "label=gstack-evals.eb.unit=" + id]).stdout.split("\n").filter(Boolean);
      if (ids.length) docker(["rmi", "-f", "--no-prune", ...new Set(ids)]);
    }
    tmp?.cleanup();
  });

  // Value: protects=the leak check on the image a builder runs in, now that the session layer copies dependency folders
  // under /work/repo; fails_when=the session image lists no node_modules, or the check passes a line of the project.
  test("the leak check scans the Node unit's session image, which holds the project's node_modules at /work/repo", () => {
    const { fx, out } = build("node", (d) => nodeRepo(d, "vitest", nodeLock));
    units.push(fx.spec.id);
    expect(out.qualifies).toBe(true);
    const img = sessionImage(out.eb.image.id);
    expect(img.deps).toEqual(["node_modules"]);
    expect(docker(["run", "--rm", "--network", "none", "--entrypoint", "sh", img.id, "-c", "test -f /work/repo/node_modules/vitest/package.json && echo ok"]).stdout.trim()).toBe("ok");
    const runner = out.eb.groups[0]!.runner;
    const needles = leakNeedles(fx.repo, fx.sha.base!, fx.sha.merge!, [fx.sha.fix!]);
    expect(needles.length).toBeGreaterThan(0);
    expect(sessionLeakCheck({ unit: fx.spec.id, image: out.eb.image.id, repo: fx.spec.repo, runner, needles })).toMatchObject({ leaks: [] });
    let code = "none";
    try {
      sessionLeakCheck({ unit: fx.spec.id, image: out.eb.image.id, repo: fx.spec.repo, runner, needles: ["export const add = (a, b) => a + b;"] });
    } catch (e) {
      code = e instanceof EbError ? e.code : String(e);
    }
    expect(code).toBe("E_EB_LEAK");
  }, LONG);

  // Value: protects=the unit stage's gates before the pilot, run as the build session would meet them; fails_when=a clean
  // fixture unit is dropped by the session leak check or by the real sidecar's origin or gh gate.
  test("a clean Go unit passes every gate: the session image leak check and the real sidecar's origin and gh gates", async () => {
    const { fx, out } = build("go", goRepo);
    units.push(fx.spec.id);
    expect(out.qualifies).toBe(true);
    const trees = join(tmp.dir, "repos");
    const tree = join(trees, fx.spec.id);
    mkdirSync(tree, { recursive: true });
    spawnSync("sh", ["-c", 'git -C "$1" archive "$2" | tar -x -C "$3"', "sh", fx.repo, fx.sha.base!, tree]);
    const git = (args: string[]) => spawnSync("git", ["-C", tree, "-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", ...args], { encoding: "utf8" });
    git(["init", "-q", "-b", "main"]);
    git(["add", "-A"]);
    git(["commit", "-q", "-m", "base"]);
    expect(await containUnit({ dir: out.dir, repo: fx.repo, spec: fx.spec, trees })).toEqual([]);
  }, LONG);
});
