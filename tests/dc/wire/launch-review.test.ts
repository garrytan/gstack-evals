// Copyright (c) 2026 Garry Tan. MIT License.
// Every launch needs the review container, whatever its first row, because the preflight starts one on the controller
// host. Off the host, before any VM, a launch refuses when the wiring has no sessions section, when the plan's image tar
// is missing, hashes to another sha256 than the recorded one or names another image in its index.json, or when the
// plan's gstack source lacks the pin. A complete launch's controller plan carries the image and the gstack upload. On
// the host, the provisioning re-hashes the uploaded tar before docker load and checks the loaded image's id after it,
// and either mismatch stops the launch before the preflight or any row. realReview itself refuses before any container
// without a sessions section, a pinned image of the recorded digest, or a gstack source holding the pin.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { recipeHash, recipeInputs } from "../../../src/rig/recipe.ts";
import type { Runner } from "../../../src/trial/image.ts";
import { layout, type ControllerPlan } from "../../../lanes/design-constructed/money/controller-host.ts";
import { loadTrialImage, sha256File } from "../../../lanes/design-constructed/money/host-image.ts";
import { FAKE_KEYS, FIXTURE_IMAGE_ID, fakeDocker, host, hostFixture, imageTarFixture, localSeams, localWorld, pinRepo, withTemp } from "../../../lanes/design-constructed/wire/dryrun-host.ts";
import { fakeContainerSeams } from "../../../lanes/design-constructed/wire/preflight-container.ts";
import { realReview, type HostContext } from "../../../lanes/design-constructed/wire/real.ts";

const inTemp = (f: (dir: string) => Promise<void>) => withTemp(async (dir) => (await f(dir), null));
const PROBE = ["modelprobe", "--terms", "terms.json", "--out", "sinks/modelprobe"];
const OTHER_ID = "sha256:" + "cd".repeat(32);

const edit = (path: string, change: (j: Record<string, unknown>) => Record<string, unknown>) => writeFileSync(path, JSON.stringify(change(JSON.parse(readFileSync(path, "utf8")))));
const editSessions = (f: ReturnType<typeof hostFixture>, change: (s: Record<string, unknown> | null) => Record<string, unknown> | null) => edit(join(f.plan.work, "wiring.json"), (w) => ({ ...w, sessions: change(w.sessions as Record<string, unknown>) }));

describe("a launch that starts on the model probe needs the review container's inputs off the host", () => {
  test("a wiring with no sessions section refuses before any VM", () =>
    inTemp(async (dir) => {
      // Value: protects=the launch gap that held launch 9: a modelprobe launch passed off the host with sessions null and the preflight's realReview failed on the host; fails_when=a launch with no sessions section makes a VM
      const f = hostFixture(dir, PROBE);
      editSessions(f, () => null);
      const w = localWorld();
      const r = await host("launch", f, localSeams(dir, w, FAKE_KEYS));
      expect(r.err.join(" ")).toContain("E_DCW_START_RULE start rule review container: the wiring file has no sessions section");
      expect(w.vms).toHaveLength(0);
      expect(existsSync(f.recordPath)).toBe(false);
    }));

  test("a sessions section without the tar's sha256, or a plan with no image tar, refuses before any VM", () =>
    inTemp(async (dir) => {
      // Value: protects=the Captain's condition that the tar's sha256 is bound to the wiring and required at every launch; fails_when=a launch uploads an image whose tar nobody recorded
      const f = hostFixture(dir, PROBE);
      const w = localWorld();
      editSessions(f, (s) => ({ ...s, imageTarSha256: null }));
      expect((await host("launch", f, localSeams(dir, w, FAKE_KEYS))).err.join(" ")).toContain("records no imageTarSha256");
      editSessions(f, (s) => ({ ...s, imageTarSha256: sha256File(f.plan.imageTar!) }));
      edit(f.planPath, (p) => ({ ...p, imageTar: null }));
      expect((await host("launch", f, localSeams(dir, w, FAKE_KEYS))).err.join(" ")).toContain("start rule review container: the host plan names no image tar");
      expect(w.vms).toHaveLength(0);
    }));

  test("a tar whose sha256 differs, or whose index.json names another image, refuses with E_DCH_IMAGE_TAR before any VM", () =>
    inTemp(async (dir) => {
      // Value: protects=the off-host checks that the plan's tar is the recorded one, by sha256 and by its index digest (the image id on the containerd store); fails_when=a launch uploads a tar other than the recorded image
      const f = hostFixture(dir, PROBE);
      const w = localWorld();
      editSessions(f, (s) => ({ ...s, imageTarSha256: "0".repeat(64) }));
      const sum = await host("launch", f, localSeams(dir, w, FAKE_KEYS));
      expect(sum.err.join(" ")).toContain("E_DCH_IMAGE_TAR the host plan's image tar " + f.plan.imageTar + " hashes to sha256 " + sha256File(f.plan.imageTar!));
      const other = join(dir, "other-image.tar");
      editSessions(f, (s) => ({ ...s, imageTarSha256: imageTarFixture(other, OTHER_ID) }));
      edit(f.planPath, (p) => ({ ...p, imageTar: other }));
      const named = await host("launch", f, localSeams(dir, w, FAKE_KEYS));
      expect(named.err.join(" ")).toContain("E_DCH_IMAGE_TAR the host plan's image tar " + other + " names image " + OTHER_ID + " in its index.json, not the wiring's imageDigest " + FIXTURE_IMAGE_ID);
      expect(w.vms).toHaveLength(0);
    }));

  test("a gstack source that lacks the pin refuses before any VM", () =>
    inTemp(async (dir) => {
      // Value: protects=the off-host check that the plan's gstack source holds the pin commit the host's install verifies; fails_when=a launch starts with a source the host can't install from
      const f = hostFixture(dir, PROBE);
      const w = localWorld();
      const r = await host("launch", f, { ...localSeams(dir, w, FAKE_KEYS), gstackCommit: "e".repeat(40) });
      expect(r.err.join(" ")).toContain("start rule review container: the host plan names no local gstack repository holding " + "e".repeat(40));
      expect(w.vms).toHaveLength(0);
    }));

  test("a complete launch passes the off-host checks and its controller plan carries the image and the gstack upload", () =>
    inTemp(async (dir) => {
      // Value: protects=controllerPlanOf uploading the trial image and the gstack pin for every launch, not only a sessions first row; fails_when=a modelprobe launch's plan leaves the host with no trial image or pin source
      const f = hostFixture(dir, PROBE);
      const w = localWorld();
      const seen: ControllerPlan[] = [];
      const stop = (p: ControllerPlan): ControllerPlan => {
        seen.push(p);
        throw new Error("stopped once the plan was built");
      };
      const r = await host("launch", f, localSeams(dir, w, FAKE_KEYS, stop));
      expect(r.err.join(" ")).toContain("stopped once the plan was built");
      expect(seen[0]!.image).toEqual({ tar: { file: f.plan.imageTar! }, expectDigest: FIXTURE_IMAGE_ID, tarSha256: sha256File(f.plan.imageTar!) });
      expect(seen[0]!.gstack?.commit).toBe(pinRepo(dir).commit);
      expect(seen[0]!.gstack!.pack.length).toBeGreaterThan(0);
      expect(w.vms).toHaveLength(0);
    }));
});

describe("on the host, the provisioning checks the tar and the loaded image before any row", () => {
  const launchStops = async (dir: string, f: ReturnType<typeof hostFixture>, code: string, cause: string, over?: (p: ControllerPlan) => ControllerPlan) => {
    const w = localWorld();
    const r = await host("launch", f, localSeams(dir, w, FAKE_KEYS, over));
    expect(r.err.join(" ")).toContain(code + " " + cause);
    expect(r.err.join(" ")).toContain("so neither the preflight nor any row runs on it");
    expect(w.vms.length).toBeGreaterThan(0);
    expect(w.vms.every((v) => w.deleted.includes(v.id))).toBe(true);
    expect(existsSync(layout(f.plan.runId, join(dir, "host")).rows)).toBe(false);
    expect(existsSync(f.recordPath)).toBe(false);
  };

  test("an uploaded tar that hashes to another sha256 stops the provisioning with E_DCH_IMAGE_TAR before docker load", () =>
    inTemp(async (dir) => {
      // Value: protects=the Captain's condition that the host re-hashes the tar before loading it; fails_when=a tar changed in transit is loaded and a session runs on it
      const f = hostFixture(dir, PROBE);
      await launchStops(dir, f, "E_DCH_IMAGE_TAR", "the trial image: the uploaded tar hashes to sha256 ", (p) => ({ ...p, image: { ...p.image!, tar: new TextEncoder().encode("another tar\n") } }));
    }));

  test("a load that gives another image id stops the provisioning with E_DCH_IMAGE_DIGEST before the image is pinned", () =>
    inTemp(async (dir) => {
      // Value: protects=the Captain's condition that the host checks the image id after the load (the classic store would load the tar under its config digest); fails_when=the host pins and runs an image other than the recorded digest
      const f = hostFixture(dir, PROBE);
      fakeDocker(dir, OTHER_ID);
      await launchStops(dir, f, "E_DCH_IMAGE_DIGEST", "the trial image: docker image inspect reads the loaded image's id as " + OTHER_ID + ", not the recorded " + FIXTURE_IMAGE_ID);
    }));

  test("host-image refuses a tar of another sha256 without calling docker, and a load of another id without pinning", () =>
    inTemp(async (dir) => {
      // Value: protects=money/host-image.ts's two checks and their reason codes; fails_when=docker load runs on an unchecked tar or a wrong image is pinned
      const tar = join(dir, "t.tar");
      const sum = imageTarFixture(tar, FIXTURE_IMAGE_ID);
      const calls: string[][] = [];
      const run: Runner = (_d, args) => (calls.push(args), args[0] === "load" ? { status: 0, stdout: "Loaded image ID: " + OTHER_ID + "\n", stderr: "" } : args[0] === "image" ? { status: 0, stdout: OTHER_ID + " " + recipeHash(recipeInputs()) + "\n", stderr: "" } : { status: 0, stdout: "", stderr: "" });
      const state = join(dir, "state");
      expect(loadTrialImage(tar, { state, run, sha256: "0".repeat(64) })).toMatchObject({ ok: false, code: "E_DCH_IMAGE_TAR" });
      expect(calls).toEqual([]);
      expect(loadTrialImage(tar, { state, run, sha256: sum, expect: FIXTURE_IMAGE_ID })).toMatchObject({ ok: false, code: "E_DCH_IMAGE_DIGEST" });
      expect(calls.map((c) => c[0])).toEqual(["load", "image"]);
      expect(existsSync(join(state, "images"))).toBe(false);
    }));
});

describe("realReview refuses before any container", () => {
  const ctx = (dir: string, sessions: unknown): HostContext => ({ wiring: { sessions }, dir: join(dir, "wire") }) as unknown as HostContext;

  test("without a sessions section, a pinned image of the recorded digest, or a gstack source holding the pin", () =>
    inTemp(async (dir) => {
      // Value: protects=the preflight's review provider checking its wiring, image pin and gstack source when it is built, before the preflight's first VM; fails_when=the preflight makes a VM and only then finds the review container can't start
      const before = process.env.XDG_STATE_HOME;
      process.env.XDG_STATE_HOME = join(dir, "xdg");
      try {
        const pin = pinRepo(dir);
        const recipe = recipeHash(recipeInputs());
        const run: Runner = (_d, args) => (args[0] === "load" ? { status: 0, stdout: "Loaded image ID: " + FIXTURE_IMAGE_ID + "\n", stderr: "" } : args[0] === "image" ? { status: 0, stdout: FIXTURE_IMAGE_ID + " " + recipe + "\n", stderr: "" } : { status: 0, stdout: "", stderr: "" });
        const sessions = { gstackSources: [pin.repo], imageDigest: FIXTURE_IMAGE_ID, imageTarSha256: null };
        const seams = { imageRun: run, gstackCommit: pin.commit, container: fakeContainerSeams() };
        expect(() => realReview(ctx(dir, null), seams)).toThrow("has no sessions section");
        expect(() => realReview(ctx(dir, sessions), seams)).toThrow("review image: E_IMAGE_STALE no trial image is pinned");
        expect(loadTrialImage(join(dir, "x.tar"), { run, expect: FIXTURE_IMAGE_ID }).ok).toBe(true);
        expect(() => realReview(ctx(dir, { ...sessions, imageDigest: OTHER_ID }), seams)).toThrow("the run recorded image " + OTHER_ID);
        expect(() => realReview(ctx(dir, sessions), { ...seams, gstackCommit: "e".repeat(40) })).toThrow("holds the pin's commit " + "e".repeat(40));
        const r = await realReview(ctx(dir, sessions), seams).check(join(dir, "container"));
        expect(r.problems).toEqual([]);
      } finally {
        if (before === undefined) delete process.env.XDG_STATE_HOME;
        else process.env.XDG_STATE_HOME = before;
      }
    }));
});
