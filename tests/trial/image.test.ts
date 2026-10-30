import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recipeHash } from "../../src/rig/recipe.ts";
import { removeTree } from "../../src/trial/cleanup.ts";
import { buildArmImage, buildTrialImage, checkImagePin, imageFixtures, retainImage, retainTree, trialTag, type Runner } from "../../src/trial/image.ts";

const DOCKER = process.env.GSTACK_EVALS_DOCKER === "1";
const LEARN = join(import.meta.dir, "../contract/fixtures/gstack/learn");
const AGENT_SKILLS = join("/home", "agent", ".claude/skills/gstack");
const roots: string[] = [];
const scratch = (name: string) => {
  const dir = mkdtempSync(join(tmpdir(), "gse-" + name + "-"));
  roots.push(dir);
  return dir;
};
afterAll(() => roots.forEach((r) => removeTree(r)));

/** A fake docker: inspect answers from a table of tag to "id label"; build adds the tag with a fresh id. */
function fakeDocker(images: Record<string, string>): Runner {
  let n = 0;
  return (_command, args) => {
    if (args[0] === "image") return images[args.at(-1)!] ? { status: 0, stdout: images[args.at(-1)!]! + "\n", stderr: "" } : { status: 1, stdout: "", stderr: "No such image" };
    if (args[0] === "build") {
      const tag = args[args.indexOf("-t") + 1]!;
      const label = args[args.indexOf("--label") + 1]!.split("=")[1]!;
      images[tag] = "sha256:" + String(++n).repeat(64).slice(0, 64) + " " + label;
      return { status: 0, stdout: "", stderr: "" };
    }
    return { status: 1, stdout: "", stderr: "unexpected" };
  };
}

describe("trial image pin", () => {
  // Value: protects=a run starts only on the image doctor pinned for this recipe; fails_when=a rebuilt or retagged image, a missing pin or a digest other than the recorded one is used (GST-59); why_new=Captain brief item 4; seam=buildTrialImage, checkImagePin; no_claim=that two builds of one recipe share a digest
  test("doctor's build pins the digest; a missing pin, a rebuilt tag, a foreign label and a recorded digest mismatch refuse", () => {
    const state = scratch("state");
    const images: Record<string, string> = {};
    const run = fakeDocker(images);
    expect(checkImagePin({ state, run })).toMatchObject({ ok: false, code: "E_IMAGE_STALE", message: expect.stringContaining("no trial image is pinned for recipe") });
    const built = buildTrialImage({ state, run });
    if (!built.ok) throw new Error(built.message);
    expect(built.tag).toBe(trialTag(recipeHash()));
    expect(readFileSync(built.log, "utf8")).toContain("docker build docker/trial.Dockerfile");
    expect(checkImagePin({ state, run })).toMatchObject({ ok: true, pin: { digest: built.digest, recipe_sha256: recipeHash() } });
    expect(checkImagePin({ state, run, expectDigest: built.digest }).ok).toBe(true);
    expect(checkImagePin({ state, run, expectDigest: "sha256:" + "f".repeat(64) })).toMatchObject({ code: "E_IMAGE_STALE", message: expect.stringContaining("the run recorded image sha256:fff") });
    images[built.tag] = "sha256:" + "e".repeat(64) + " " + recipeHash();
    expect(checkImagePin({ state, run })).toMatchObject({ code: "E_IMAGE_STALE", message: expect.stringContaining("the image was rebuilt or replaced") });
    images[built.tag] = built.digest + " " + "0".repeat(64);
    expect(checkImagePin({ state, run })).toMatchObject({ code: "E_IMAGE_STALE", message: expect.stringContaining("carries recipe label") });
    delete images[built.tag];
    expect(checkImagePin({ state, run })).toMatchObject({ code: "E_IMAGE_STALE", message: expect.stringContaining("no local image has that tag") });
  });

  test("a failed build is E_IMAGE_BUILD naming its log", () => {
    const state = scratch("state");
    const r = buildTrialImage({ state, run: () => ({ status: 1, stdout: "", stderr: "step 2: pull access denied\n" }) });
    expect(r).toMatchObject({ ok: false, code: "E_IMAGE_BUILD", message: expect.stringContaining("exited 1: step 2: pull access denied (build log: ") });
  });
});

describe("arm images without a daemon", () => {
  /** A docker stand-in: the base exists, the arm tag does not until built, and the scan answers as given. */
  const fakeDocker = (scan: { status: number | null; stdout: string; stderr: string }) => {
    let built = false;
    const run: Runner = (_command, args) => {
      if (args[0] === "image") return args.at(-1) === "base:test" || built ? { status: 0, stdout: "sha256:" + "b".repeat(64) + " x\n", stderr: "" } : { status: 1, stdout: "", stderr: "No such image" };
      if (args[0] === "build") built = true;
      if (args[0] === "run") return scan;
      return { status: 0, stdout: "", stderr: "" };
    };
    return run;
  };

  // Value: protects=an arm image is accepted only after a scan that finished; fails_when=a scan that timed out or failed partway, with some checksums printed, passes as clean; why_new=#58 review; seam=imageFixtures, buildArmImage; no_claim=the scan's coverage, which the Docker tier checks
  test("a scan that fails partway is E_IMAGE_BUILD even with partial output", () => {
    const partial = { status: 123, stdout: "e".repeat(64) + "  /usr/bin/ls\n", stderr: "sha256sum: /x: Input/output error\n" };
    expect(imageFixtures("arm:test", LEARN, fakeDocker(partial))).toMatchObject({ ok: false, code: "E_IMAGE_BUILD", message: expect.stringContaining("not known to be clean: sha256sum: /x: Input/output error") });
    expect(imageFixtures("arm:test", LEARN, fakeDocker({ status: null, stdout: "", stderr: "" }))).toMatchObject({ ok: false, code: "E_IMAGE_BUILD", message: expect.stringContaining("not known to be clean: exit null") });
  });

  // Value: protects=a base-only arm builds like any other; fails_when=an empty layer list throws ENOENT instead of building; why_new=#58 review; seam=buildArmImage; no_claim=none beyond protects
  test("an arm with no layers builds on its base", () => {
    const r = buildArmImage({ base: "base:test", layers: [], tasksDir: LEARN, state: scratch("empty-arm"), run: fakeDocker({ status: 0, stdout: "", stderr: "" }) });
    expect(r).toMatchObject({ ok: true, dropped: [] });
  });
});

/** A gstack-like arm tree that carries learn's eval fixtures where gstack keeps them, and one stray copy. */
function gstackTree(): string {
  const root = scratch("arm");
  mkdirSync(join(root, "learn"), { recursive: true });
  writeFileSync(join(root, "learn", "SKILL.md"), "---\nname: learn\n---\n# Learn\n");
  mkdirSync(join(root, "test", "fixtures", "skill-evals", "learn"), { recursive: true });
  for (const f of ["tasks.json", "seed.sh"]) writeFileSync(join(root, "test", "fixtures", "skill-evals", "learn", f), readFileSync(join(LEARN, f)));
  writeFileSync(join(root, "learn", "seed-copy.sh"), readFileSync(join(LEARN, "seed.sh")));
  return root;
}

describe.skipIf(!DOCKER)("trial and arm images (Docker tier, GSTACK_EVALS_DOCKER=1)", () => {
  const state = scratch("docker-state");
  let trial = "";

  test("doctor's build makes a pinned image with bun, git and glibc", () => {
    const built = buildTrialImage({ state });
    if (!built.ok) throw new Error(built.message);
    trial = built.digest;
    expect(checkImagePin({ state }).ok).toBe(true);
    const r = spawnSync("docker", ["run", "--rm", "--network", "none", built.tag, "sh", "-c", "bun --version && git --version && ldconfig -p | grep -c libc.so.6"], { encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("git version");
  }, 900_000);

  // Value: protects=no arm image holds the skill's eval fixtures; fails_when=tasks.json, seed.sh or a byte-identical copy reaches an arm image, or the scan misses a planted one; why_new=Lane A's /learn image once shipped tasks.json (Captain brief item 3); seam=buildArmImage, imageFixtures; no_claim=fixtures renamed and edited by the arm's author
  test("an arm image built from a tree holding the fixtures holds none of them, and the scan catches a planted copy", () => {
    const built = buildArmImage({ base: trial, layers: [{ src: gstackTree(), dest: AGENT_SKILLS }], tasksDir: LEARN, state });
    if (!built.ok) throw new Error(built.message);
    expect(built.dropped.toSorted()).toEqual(["learn/seed-copy.sh", "test/fixtures/skill-evals"]);
    expect(imageFixtures(built.tag, LEARN)).toEqual({ hits: [] });
    const ls = spawnSync("docker", ["run", "--rm", "--network", "none", built.tag, "ls", join(AGENT_SKILLS, "learn")], { encoding: "utf8" });
    expect(ls.stdout.trim()).toBe("SKILL.md");
    const ctx = scratch("bad");
    writeFileSync(join(ctx, "tasks.json"), readFileSync(join(LEARN, "tasks.json")));
    writeFileSync(join(ctx, "Dockerfile"), "FROM " + trialTag(recipeHash()) + "\nCOPY tasks.json /opt/app/data.json\n");
    expect(spawnSync("docker", ["build", "-q", "-t", "gse-bad-arm:test", ctx]).status).toBe(0);
    expect(imageFixtures("gse-bad-arm:test", LEARN)).toEqual({ hits: ["/opt/app/data.json (same bytes as tasks.json)"] });
    spawnSync("docker", ["rmi", "-f", "gse-bad-arm:test"]);
  }, 900_000);

  // Value: protects=every image and arm tree a run uses can be fetched again by digest; fails_when=a retained tar is not the image's bytes or a tree tar is not byte-stable; why_new=Lane B quick look 2 lost its gstack arm (Captain brief item 5); seam=retainImage, retainTree; no_claim=the upload to the retention target
  test("retained image and tree tars are keyed by digest and listed once", () => {
    const dir = scratch("retained");
    const image = retainImage(trial, dir);
    if ("ok" in image) throw new Error(image.message);
    expect(image.file).toBe("images/" + trial.replace("sha256:", "") + ".tar");
    expect(spawnSync("tar", ["-tf", join(dir, image.file)], { encoding: "utf8" }).stdout.split("\n")).toContain("blobs/sha256/" + trial.replace("sha256:", ""));
    const tree = gstackTree();
    const a = retainTree(tree, dir);
    rmSync(join(dir, a.file));
    const b = retainTree(tree, dir);
    expect(b.sha256).toBe(a.sha256);
    expect(readFileSync(join(dir, "MANIFEST.jsonl"), "utf8").trim().split("\n")).toHaveLength(2);
  }, 900_000);

  test("cleanup removes a root-owned tree through a root container, and reports instead of throwing without one", () => {
    const parent = scratch("rootowned");
    mkdirSync(join(parent, "work"));
    expect(spawnSync("docker", ["run", "--rm", "--user", "0:0", "-v", parent + ":/m", trial, "sh", "-c", "mkdir /m/work/rootdir && touch /m/work/rootdir/f && chmod 755 /m/work/rootdir"]).status).toBe(0);
    expect(removeTree(join(parent, "work"))).toContain("could not remove");
    expect(removeTree(join(parent, "work"), { image: trial })).toBeNull();
    expect(existsSync(join(parent, "work"))).toBe(false);
  }, 300_000);
});
