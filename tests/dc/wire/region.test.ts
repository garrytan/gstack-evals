// Copyright (c) 2026 Garry Tan. MIT License.
// PD-42 on the launch path: the stage each paid row belongs to, the region rule in start() (a stage records the region
// it started in and a later row of that stage in another region refuses before any admission), probe 1D's stop on the
// first browser launch of stage 0, and the host launch's check that the vm section's browser build and Claude Code
// tarball ship in the work folder. Fakes only: the fake kit's ledger, an invented browser seam and the simulated
// Ubicloud with every command run on this machine. No key, no network, no VM.
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserSeam, BrowserSession } from "../../../lanes/design-constructed/recipes/seams.ts";
import type { Vm } from "../../../lanes/design-constructed/stage3/sandbox.ts";
import { host, hostFixture, localSeams, localWorld, watchedEnv, FAKE_KEYS } from "../../../lanes/design-constructed/wire/dryrun-host.ts";
import { fakeEnv, fakeKit } from "../../../lanes/design-constructed/wire/fakes.ts";
import { probe1D } from "../../../lanes/design-constructed/wire/recipes.ts";
import { start, stageOf, type StartPlan } from "../../../lanes/design-constructed/wire/start.ts";

const dirs: string[] = [];
const temp = (tag: string) => {
  const d = mkdtempSync(join(tmpdir(), "dc-region-" + tag + "-"));
  dirs.push(d);
  return d;
};
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const plan = (row: string, sink: string, items: StartPlan["items"], record?: Record<string, unknown>): StartPlan => ({ row, sink, items, models: [], terms: [], ...(record ? { record } : {}) });

describe("PD-42: the region each stage runs in", () => {
  test("every paid row names its stage in section 14 item 7's order, and a row with no stage refuses", () => {
    // Value: protects=PD-42's stage boundaries: each paid row maps to the stage whose region it keeps; fails_when=a row maps to the wrong stage, sessions or labels ignore the record's stage, or an unknown row maps silently; why_new=PD-42; seam=stageOf; no_claim=the order of the stages, which section 14 item 7 sets
    const cases: Array<[string, Record<string, unknown> | undefined, string]> = [
      ["modelprobe --out x", undefined, "probes"],
      ["recipes --frame f --out x", undefined, "stage 0"],
      ["gatecheck --out x", undefined, "gate check"],
      ["author --from 1 --to 8", undefined, "authoring"],
      ["probe --out x", undefined, "judge probe"],
      ["reprice --out x", undefined, "admission"],
      ["stage3 --out x", undefined, "stage 3"],
      ["sessions --stage 1", { stage: 1 }, "stage 1"],
      ["labels --stage 2", { stage: 2 }, "stage 2"],
    ];
    for (const [row, record, stage] of cases) expect(stageOf({ row, record })).toBe(stage);
    expect(() => stageOf({ row: "sessions --stage 9", record: { stage: 9 } })).toThrow("names no stage for the region rule");
    expect(() => stageOf({ row: "clones --out x" })).toThrow("names no stage for the region rule");
  });

  test("the first row of a stage records its region, a later row of that stage in the same region runs, and one in another region refuses before any admission with no sink", async () => {
    // Value: protects=PD-42 and the Captain's ruling C: a stage started in one region finishes there, and every launch record names its region; fails_when=a row of a started stage runs in another region, the refusal opens a lease or makes a sink, the region is missing from launch.json or the launch lines, or another stage is held to the first stage's region; why_new=PD-42; seam=start() with the fake kit's ledger; no_claim=the host's own launch record of its region (hostRegion), which the e2e launch test drives
    const dir = temp("start");
    const record = join(dir, "regions.json");
    const at = (region: string) => ({ region, record });
    const k1 = fakeKit();
    const first = await start(plan("recipes --frame f --out a", join(dir, "a"), ["dc-base-apps"]), fakeEnv(k1, { region: at("eu-central-h1") }));
    expect(first.lines).toContain("region: recipes --frame f --out a runs in Ubicloud eu-central-h1; stage 0 starts there");
    expect(JSON.parse(readFileSync(join(dir, "a", "launch.json"), "utf8"))).toMatchObject({ region: "eu-central-h1", regionStage: "stage 0" });
    expect(JSON.parse(readFileSync(record, "utf8"))).toEqual({ "stage 0": { region: "eu-central-h1", row: "recipes --frame f --out a", at: "2026-11-20T00:00:00.000Z" } });
    const recorded = readFileSync(record, "utf8");
    const k2 = fakeKit();
    const again = await start(plan("recipes --frame f --out b", join(dir, "b"), ["dc-base-apps"]), fakeEnv(k2, { region: at("eu-central-h1") }));
    expect(again.lines).toContain("region: recipes --frame f --out b runs in Ubicloud eu-central-h1; stage 0 started there");
    expect(readFileSync(record, "utf8")).toBe(recorded);
    const k3 = fakeKit();
    const moved = start(plan("recipes --frame f --out c", join(dir, "c"), ["dc-base-apps"]), fakeEnv(k3, { region: at("us-east-a2") }));
    await expect(moved).rejects.toMatchObject({ code: "E_DCW_REGION" });
    await expect(moved).rejects.toThrow("stage 0 started in eu-central-h1");
    expect(k3.built).toEqual([]);
    expect(existsSync(join(dir, "c"))).toBe(false);
    expect(readFileSync(record, "utf8")).toBe(recorded);
    const k4 = fakeKit();
    const next = await start(plan("gatecheck --out d", join(dir, "d"), ["dc-gate-check"]), fakeEnv(k4, { region: at("us-east-a2") }));
    expect(next.lines).toContain("region: gatecheck --out d runs in Ubicloud us-east-a2; gate check starts there");
    expect(Object.keys(JSON.parse(readFileSync(record, "utf8")))).toEqual(["stage 0", "gate check"]);
    for (const k of [k1, k2, k3, k4]) k.dispose();
  });

  test("off the controller host no region is read or recorded, and the launch record says so", async () => {
    // Value: protects=PD-42's scope: the rule binds rows on the controller host, where the ledger provider runs; fails_when=a row off the host writes a regions record or launch.json names a region; why_new=PD-42; seam=start() with no region seam; no_claim=the ledger provider's own off-host refusal
    const dir = temp("off");
    const k = fakeKit();
    const l = await start(plan("recipes --frame f --out a", join(dir, "a"), ["dc-base-apps"]), fakeEnv(k));
    expect(l.lines.some((x) => x.startsWith("region: "))).toBe(false);
    expect(JSON.parse(readFileSync(join(dir, "a", "launch.json"), "utf8"))).toMatchObject({ region: null, regionStage: null });
    k.dispose();
  });
});

describe("PD-42: probe 1D on stage 0's first qualification", () => {
  const vm = (label: string) => ({ id: "vm-" + label, spec: { label } }) as unknown as Vm;
  const session = { login: async () => true, load: async () => ({}) as never, close: async () => {} } satisfies BrowserSession;

  test("a browser that fails its first launch stops the screen with E_DCW_BROWSER_LAUNCH, naming the VM", async () => {
    // Value: protects=the Captain's ruling that a browser failure on stage 0's first qualification stops for the Captain; fails_when=the first launch failure passes through as an ordinary qualification failure, which the screen retries and records as infra; why_new=PD-42; seam=probe1D around the browser seam; no_claim=a failure before the browser launches (the VM, a preamble step or the controller's install), which the screen records as infra and the run monitor watches for
    const lines: string[] = [];
    const browser: BrowserSeam = { open: async () => Promise.reject(new Error("chromium exited with code 127")) };
    const p = probe1D(browser, (l) => lines.push(l)).open(vm("qualify c001"), "http://127.0.0.1:3000");
    await expect(p).rejects.toMatchObject({ code: "E_DCW_BROWSER_LAUNCH" });
    await expect(p).rejects.toThrow("qualify c001");
    await expect(p).rejects.toThrow("chromium exited with code 127");
    expect(lines).toEqual([]);
  });

  test("once one launch has passed, a later launch failure passes through unchanged", async () => {
    // Value: protects=probe 1D's scope: only the first launch is the probe, and later failures keep the frozen screen's handling; fails_when=a later failure stops the row, or the first pass logs nothing; why_new=PD-42; seam=probe1D; no_claim=the screen's retry, which recipes/sessions.ts holds
    const lines: string[] = [];
    let n = 0;
    const browser: BrowserSeam = { open: async () => (++n === 1 ? session : Promise.reject(new Error("page crashed"))) };
    const seam = probe1D(browser, (l) => lines.push(l));
    expect(await seam.open(vm("qualify c001"), "http://127.0.0.1:3000")).toBe(session);
    expect(lines).toEqual(["probe 1D: the VM's browser launched in qualify c001"]);
    const later = seam.open(vm("qualify c002"), "http://127.0.0.1:3000");
    await expect(later).rejects.toThrow("page crashed");
    await expect(later).rejects.not.toMatchObject({ code: "E_DCW_BROWSER_LAUNCH" });
  });
});

describe("PD-42: the browser build and the Claude Code tarball ship in the work folder", () => {
  const vmSection = (chromiumDir: string, tarball: string) => ({ project: "dry", location: "dry", size: "standard-4", image: "ubuntu-noble", privateSubnet: null, keyPath: "ssh/id_ed25519", knownHosts: "ssh/known_hosts", chromiumBuild: { dir: chromiumDir, bin: "chrome-linux/chrome" }, claudeTarball: tarball, priceMicrosPerHour: 57_400, proxy: { host: "controller", port: 8790 }, mirrors: { host: "controller", terms: { npm: "npm terms", pypi: "pypi terms", apt: "apt terms", dockerhub: "dockerhub terms" } } });

  test("a host launch whose vm section names either file outside the work folder, or a Chromium binary the work folder lacks, or a tarball other than the pinned one refuses with E_USAGE before any key read, and makes no VM", async () => {
    // Value: protects=PD-42's rule that relaunch uploads nothing, so the recipe VM files must ride in the work folder; fails_when=the launch proceeds with a path outside the work folder, a missing browser or an unpinned tarball, reads a key or makes a VM; why_new=PD-42; seam=the host row's launch on the simulated Ubicloud; no_claim=a launch that passes, which needs the pinned tarball and the e2e launch test covers
    const dir = temp("vmfiles");
    const f = hostFixture(dir);
    const work = f.plan.work;
    mkdirSync(join(work, "chromium", "chrome-linux"), { recursive: true });
    writeFileSync(join(work, "claude-code.tgz"), "an invented tarball\n");
    const cases: Array<[ReturnType<typeof vmSection>, string]> = [
      [vmSection(join(work, "chromium"), "claude-code.tgz"), "relative to the work folder"],
      [vmSection("chromium", join(work, "claude-code.tgz")), "relative to the work folder"],
      [vmSection("../chromium", "claude-code.tgz"), "relative to the work folder"],
      [vmSection("chromium", "claude-code.tgz"), "holds no Chromium binary"],
    ];
    const wiring = JSON.parse(readFileSync(join(work, "wiring.json"), "utf8"));
    const run = async (vm: ReturnType<typeof vmSection>, want: string) => {
      writeFileSync(join(work, "wiring.json"), JSON.stringify({ ...wiring, vm }) + "\n");
      const w = localWorld();
      const watched = watchedEnv(FAKE_KEYS);
      const r = await host("launch", f, localSeams(dir, w, watched.env));
      expect(r.err.join(" ")).toContain("E_USAGE");
      expect(r.err.join(" ")).toContain(want);
      expect([...watched.read].filter((k) => k.endsWith("_KEY"))).toEqual([]);
      expect(w.vms.length).toBe(0);
    };
    for (const [vm, want] of cases) await run(vm, want);
    writeFileSync(join(work, "chromium", "chrome-linux", "chrome"), "invented browser\n", { mode: 0o755 });
    await run(vmSection("chromium", "claude-code.tgz"), "pinned tarball");
  });
});
