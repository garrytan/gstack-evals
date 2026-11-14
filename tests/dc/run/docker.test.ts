// Copyright (c) 2026 Garry Tan. MIT License.
// The Docker session rig on the local Docker daemon, keyless: the review container (pinned image by digest, empty HOME,
// the three frozen mounts, one network), C3 on a listing read inside it and C2 inside it, the trial network where the
// metering proxy container is all it reaches, gstack's real ./setup at the pin inside the gstack arms' containers, the
// RunBox inside the container, and the hostile fixture's sessions in containers at /work behind a scripted fake upstream
// (tests/adapters/harness.ts), with the sentinel's KEY, DRIVE and NET lines read both ways. Without a Docker daemon every
// test skips and the reason prints; the gstack tests also skip without DC_GSTACK_PIN_DIR.
import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { claudeCodeDriver } from "../../../src/adapters/claude-code/driver.ts";
import { removeTree } from "../../../src/trial/cleanup.ts";
import { buildTrialImage, checkImagePin, stateRoot } from "../../../src/trial/image.ts";
import { createTrialNetwork, removeTrialNetwork, startProxyContainer } from "../../../src/trial/proxy.ts";
import { dockerAvailable } from "../../../src/trial/sandbox.ts";
import { armPrompt, containerProblems, HOME, isGstackArm, sessionSetup } from "../../../lanes/design-constructed/run/arms.ts";
import { runFilesOf } from "../../../lanes/design-constructed/run/box.ts";
import { autoplanExposure } from "../../../lanes/design-constructed/run/detect.ts";
import { sha256Hex, type C2Expect } from "../../../lanes/design-constructed/run/contain.ts";
import { c3Problems, createInstallNetwork, GSTACK_CHECKOUT, LISTING_SH, prepareSession, removeNetwork, sessionFolder, startReviewContainer, type PreparedSession, type ReviewImage, type UnitFiles } from "../../../lanes/design-constructed/run/docker.ts";
import { exportUnit } from "../../../lanes/design-constructed/run/export.ts";
import { CONTROL_ALL, fixtureFilesLoaded, HOSTILE_OPENS, MARK, markersSeen, writeHostile } from "../../../lanes/design-constructed/run/hostile.ts";
import type { SessionKind } from "../../../lanes/design-constructed/types.ts";
import { HAS_CLAUDE_CLI, harness, type Harness, type Script } from "../../adapters/harness.ts";
import { BLOCK, commitAll, EVIDENCE, pinnedGstack, recordOf } from "./helpers.ts";

const DOCKER = dockerAvailable();
const SKIP = DOCKER ? null : "no Docker daemon answered docker version";
if (SKIP) console.log("tests/dc/run/docker.test.ts: skipped, " + SKIP);
const PIN = pinnedGstack();
if (DOCKER && "skip" in PIN) console.log("tests/dc/run/docker.test.ts: gstack install tests skipped, " + PIN.skip);
const MODEL = "claude-opus-5-5";
const SKILL_MARKS = { "plan-design-review": "Designer's eye plan review", autoplan: "Auto-review pipeline" } as const;
const KEY = Buffer.from(JSON.stringify({ items: [{ statement: "invented key" }] }));
const UNIT = Buffer.from(JSON.stringify({ id: "u1" }));

const cleanup: Array<() => void> = [];
afterAll(() => {
  for (const f of cleanup.reverse()) f();
});
const scratch = (name: string) => {
  const d = mkdtempSync(join(tmpdir(), "dc-docker-" + name + "-"));
  cleanup.push(() => removeTree(d));
  return d;
};
const keep = (p: PreparedSession) => (cleanup.push(() => p.container.stop()), p);

let pinned: ReviewImage | null = null;
function image(): ReviewImage {
  if (pinned) return pinned;
  const have = checkImagePin({ state: stateRoot() });
  if (have.ok) return (pinned = { tag: have.pin.tag, digest: have.pin.digest });
  const built = buildTrialImage({ state: stateRoot() });
  if (!built.ok) throw new Error(built.code + " " + built.message);
  return (pinned = { tag: built.tag, digest: built.digest });
}

/** The hostile fixture exported as a unit: repo/, plan.md and context/, with C2's expectations. */
function hostileUnit(): { unit: UnitFiles; expect: C2Expect; raw: string } {
  const root = scratch("unit");
  const raw = join(root, "src");
  mkdirSync(raw);
  writeHostile(raw, join(root, "fired.log"));
  commitAll(raw);
  const ex = exportUnit({ source: { clone: raw }, expect: recordOf(raw), evidence: EVIDENCE, out: join(root, "repo") });
  writeFileSync(join(root, "plan.md"), "# Settings screen\n\nWe will add a settings page with a form and a save button in src/components/Settings.tsx.\n");
  mkdirSync(join(root, "context"));
  writeFileSync(join(root, "context", "project.md"), "A demo web app.\n");
  return { unit: { repo: ex.repo, plan: join(root, "plan.md"), context: join(root, "context") }, expect: { manifest: ex.manifest, expectedTree: ex.expectedTree, sealedSha256: [sha256Hex(KEY), sha256Hex(UNIT)] }, raw };
}

/** A plain internal network (no route out); its bridge gateway is this host, where a test's harness proxy listens. */
function stubNetwork(): { name: string; gateway: string } {
  const name = "dc-stub-" + Math.random().toString(16).slice(2, 10);
  const r = spawnSync("docker", ["network", "create", "--internal", name], { encoding: "utf8" });
  if (r.status !== 0) throw new Error("docker network create: " + r.stderr);
  cleanup.push(() => removeNetwork(name));
  const gateway = spawnSync("docker", ["network", "inspect", "-f", "{{(index .IPAM.Config 0).Gateway}}", name], { encoding: "utf8" }).stdout.trim();
  return { name, gateway };
}

const sentinelLines = (out: string) => out.split("\n").filter((l) => /^(KEY|DRIVE|NET) /.test(l)).sort();

describe.skipIf(!DOCKER)("the review container and its checks (Docker)" + (SKIP ? " (skipped: " + SKIP + ")" : ""), () => {
  // Value: protects=section 4's container: the pinned image by digest, HOME empty at start, exactly the three frozen mounts, the trial network alone, where the metering proxy container answers and nothing outside does, no key variable inside; C3 passes on its real listing and C2 inside the container, and the hostile sentinel prints no KEY, no DRIVE and NET none, while a container with a planted drive path and key variables and a route out shows each and fails C3; fails_when=a mount, network, key name or drive path reaches the session container, C2 or C3 cannot run inside it, or the sentinel misses a planted path or key; why_new=run area open items 5, 6 and 7; seam=prepareSession, c3Problems, c2InContainer, createTrialNetwork, startProxyContainer, the sentinel; no_claim=a model call through the proxy (the stub-session test below reaches a harness proxy instead), and the gstack install (its own test)
  test("a clean container passes C3 and C2, reaches only the proxy, and the sentinel sees nothing; a planted container shows every plant", async () => {
    const img = image();
    const u = hostileUnit();
    const net = createTrialNetwork();
    cleanup.push(() => removeTrialNetwork(net));
    const dir = scratch("proxy");
    mkdirSync(join(dir, "ledger"));
    const proxy = startProxyContainer({ image: img.tag, net, dir: join(dir, "proxy"), ledger: join(dir, "ledger", "ledger.sqlite"), leaseId: "lease_test", managementToken: "m".repeat(32), retry: { attempts: 1, elapsed_ms: 1000 }, providerKeys: { ANTHROPIC_API_KEY: "sk-test-not-a-real-key-" + "z".repeat(12) } });
    cleanup.push(() => proxy.stop());
    const setup = sessionSetup("none", "opus");
    const s = keep(await prepareSession({ image: img, setup, unit: u.unit, expect: u.expect, dir: join(scratch("session"), "s"), network: net.name, install: null }));
    expect([s.c3, s.c2, s.install]).toEqual([[], [], null]);
    const seen = s.container.inspect();
    expect(seen.image).toBe(img.digest);
    expect(seen.mounts.map((m) => m.destination).sort()).toEqual(["/work/context", "/work/plan.md", "/work/repo"]);
    expect(seen.networks).toEqual([net.name]);
    expect(seen.env).toContain("CLAUDE_CODE_DISABLE_BUNDLED_SKILLS");
    expect(seen.env.filter((n) => /KEY|TOKEN/.test(n))).toEqual([]);
    expect(s.container.listing().filter((p) => p.startsWith(HOME + "/"))).toEqual([]);
    expect(s.container.run('curl -s -m 10 -o /dev/null -w "%{http_code}" ' + proxy.baseUrl + "/v1/models").stdout).toMatch(/^40[13]$/);
    const clean = s.container.run("sh repo/scripts/sentinel.sh");
    expect(clean.stdout).toContain("SENTINEL-DONE");
    expect(sentinelLines(clean.stdout)).toEqual(["NET none"]);

    const planted = "dc-planted-" + Math.random().toString(16).slice(2, 10);
    const run = spawnSync("docker", ["run", "-d", "--name", planted, "--user", (process.getuid?.() ?? 1000) + ":" + (process.getgid?.() ?? 1000), "-e", "HOME=" + HOME, "-e", "ANTHROPIC_API_KEY=planted-not-a-key", "-e", "GH_TOKEN=planted-not-a-token", "--tmpfs", HOME + "/.capy/drive", "--tmpfs", "/drive", "--mount", "type=bind,src=" + join(s.container.folder, "repo") + ",dst=/work/repo,readonly", "-w", "/work", "--entrypoint", "sleep", img.digest, "infinity"], { encoding: "utf8" });
    cleanup.push(() => void spawnSync("docker", ["rm", "-f", planted], { stdio: "ignore" }));
    expect(run.status).toBe(0);
    const dirty = spawnSync("docker", ["exec", planted, "sh", "repo/scripts/sentinel.sh"], { encoding: "utf8" }).stdout;
    const outside = spawnSync("curl", ["-s", "-m", "10", "-o", "/dev/null", "-w", "%{http_code}", "http://1.1.1.1/"], { encoding: "utf8" }).stdout;
    if (outside === "000") console.log("tests/dc/run/docker.test.ts: this host reaches no outside address, so the planted container's NET reached line is not checked");
    expect(sentinelLines(dirty)).toEqual([...(outside === "000" ? ["NET none"] : []), "DRIVE " + HOME + "/.capy/drive", "DRIVE /drive", "KEY ANTHROPIC_API_KEY", "KEY GH_TOKEN", ...(outside === "000" ? [] : ["NET reached"])].sort());
    const listing = spawnSync("docker", ["exec", planted, "sh", "-c", LISTING_SH], { encoding: "utf8" }).stdout.split("\n").filter(Boolean);
    const c3 = containerProblems(setup, listing);
    expect(c3.some((p) => p.startsWith("HOME is not empty"))).toBe(true);
    expect(c3.filter((p) => p.startsWith("a drive path is mounted")).length).toBeGreaterThanOrEqual(2);
  }, 600_000);
});

describe.skipIf(!DOCKER || "skip" in PIN)("gstack's real install in the gstack arms' containers (Docker)" + (SKIP ? " (skipped: " + SKIP + ")" : "skip" in PIN ? " (skipped: " + PIN.skip + ")" : ""), () => {
  // Value: protects=section 4's step 5 and C3: a gstack arm's container runs the frozen ./setup --host claude at the pin inside the container after the copy and C2, joins the install network only for the install, and afterwards passes C2 again and C3 with gstack's skills in HOME and no plan-tune state, while a clean arm gets no install and keeps HOME empty; the RunBox reads a run the pinned gstack-autoplan writes inside the container; fails_when=the install fails or runs a stand-in, the install network stays joined, the install writes into the repository, a plan-tune file exists, a clean arm gets an install, or the box misses the run; why_new=run area open item 5 (the stand-in install); seam=prepareSession, installGstack, c3Problems, the container RunBox, runFilesOf; no_claim=what Chromium does at run time (the trial image has no browser libraries)
  test("plan-design-review installs for real and passes C2 and C3 after it; none gets no install; the box reads the container's run", async () => {
    const img = image();
    const u = hostileUnit();
    const { name: net } = stubNetwork();
    const installNet = createInstallNetwork();
    cleanup.push(() => removeNetwork(installNet));
    const pin = PIN as { dir: string };
    const s = keep(await prepareSession({ image: img, setup: sessionSetup("plan-design-review", "opus"), unit: u.unit, expect: u.expect, dir: join(scratch("gstack"), "s"), network: net, install: { sources: [pin.dir], network: installNet, scratch: scratch("tree") } }));
    expect([s.c3, s.c2]).toEqual([[], []]);
    expect(s.install!.code).toBe(0);
    expect(s.install!.log).toContain("gstack ready (claude)");
    expect([s.c2AfterInstall, s.c3AfterInstall]).toEqual([[], []]);
    expect(s.container.inspect().networks).toEqual([net]);
    const listing = s.container.listing();
    for (const skill of ["plan-design-review", "autoplan"]) expect(listing).toContain(HOME + "/.claude/skills/" + skill + "/SKILL.md");
    expect(listing).toContain(GSTACK_CHECKOUT + "/VERSION");
    const box = s.container.box();
    expect(box.read(GSTACK_CHECKOUT + "/VERSION")?.trim()).toBe("1.98.0.0");
    expect(box.read(GSTACK_CHECKOUT + "/no-such-file")).toBeNull();
    const since = Date.now() - 1000;
    const out = HOME + "/.gstack/projects/demo/autoplan/run-1";
    const next = box.gstack("gstack-autoplan", ["next", "--out", out, "--plan", "plan.md", "--kind", "feature", "--scaffold"]);
    expect([next.code, next.stderr.slice(0, 300)]).toEqual([0, next.stderr.slice(0, 300)]);
    const runs = box.runs(since);
    expect(runs.map((r) => r.dir)).toEqual([out]);
    expect(typeof runs[0]!.state.status).toBe("string");
    expect(box.runs(Date.now() + 60_000)).toEqual([]);
    const every = runFilesOf(box).runs().map((r) => r.dir);
    expect(every).toContain(out);
    expect(every.filter((d) => d !== out).every((d) => d.startsWith(GSTACK_CHECKOUT + "/"))).toBe(true);
    expect(autoplanExposure(runFilesOf(box)).runDir).toBe(out);

    const none = keep(await prepareSession({ image: img, setup: sessionSetup("none", "opus"), unit: u.unit, expect: u.expect, dir: join(scratch("none"), "s"), network: net, install: null }));
    expect([none.c3, none.c2, none.install]).toEqual([[], [], null]);
    expect(none.container.listing().filter((p) => p.startsWith(HOME + "/"))).toEqual([]);
    expect(c3Problems(none.container, sessionSetup("none", "opus"))).toEqual([]);
  }, 1_800_000);
});

/** The hostile script in a container at /work: open a file in each fixture subfolder of repo/, run the sentinel, then end with a block. */
const containerScript: Script = ({ results }) => {
  if (!results.size) return [...HOSTILE_OPENS.map((p, i) => ({ type: "tool_use" as const, id: "toolu_open" + i, name: "Read", input: { file_path: "/work/repo/" + p } })), { type: "tool_use" as const, id: "toolu_sentinel", name: "Bash", input: { command: "sh repo/scripts/sentinel.sh" } }];
  return [{ type: "text", text: "Reviewed.\n\n" + BLOCK }];
};

describe.skipIf(!DOCKER || !HAS_CLAUDE_CLI)("the hostile fixture in review containers at /work, behind a scripted fake upstream (Docker)" + (SKIP ? " (skipped: " + SKIP + ")" : ""), () => {
  // Value: protects=2026-11-09-geva-420 start rule 5 in the real container: each arm's session runs the pinned CLI inside its own container at /work on the stripped export, sees no planted marker and loads no fixture instruction file, lists gstack's skills only in the gstack arms (installed by the real ./setup), and its sentinel prints no KEY and no DRIVE line and NET none, while a none session on the unstripped repository at /work shows every CLAUDE.md-family marker and the nested skill, so the capture works at /work; fails_when=a marker, a fixture instruction file, a key, a drive path or a route out reaches a session, a clean arm lists a gstack skill, or the control misses a planted file; why_new=run area open items 5 and 6; seam=prepareSession, the container's agent session, claudeCodeDriver memoryLog, the real CLI in the trial image; no_claim=the metering proxy container (the session reaches a harness proxy on the stub network's gateway, so the test network is not the isolated trial network), a real model's behaviour, and the AGENTS.md control and the project hook at /work (sdk.test.ts runs both at the repository root)
  test("every arm's session in its container sees no marker and the sentinel prints NET none only; the unstripped control at /work shows the capture works", async () => {
    const img = image();
    const u = hostileUnit();
    const net = stubNetwork();
    const kinds: SessionKind[] = "skip" in PIN ? ["none", "lens"] : ["none", "lens", "plan-design-review", "autoplan"];
    const installNet = "skip" in PIN ? null : createInstallNetwork();
    if (installNet) cleanup.push(() => removeNetwork(installNet));
    for (const kind of kinds) {
      const h: Harness = harness(containerScript, { host: net.gateway });
      cleanup.push(() => h.close());
      const binding = h.bind(MODEL, "anthropic");
      const s = keep(await prepareSession({ image: img, setup: sessionSetup(kind, "opus"), unit: u.unit, expect: u.expect, dir: join(scratch("arm"), "s"), network: net.name, install: isGstackArm(kind) ? { sources: [(PIN as { dir: string }).dir], network: installNet!, scratch: scratch("tree") } : null }));
      expect([kind, s.c3, s.c2, s.c2AfterInstall ?? [], s.c3AfterInstall ?? []]).toEqual([kind, [], [], [], []]);
      const out = join(h.dir, "host");
      const driver = claudeCodeDriver({ model: MODEL, provider: "anthropic", proxy: { baseUrl: h.baseUrl, slot: binding.slot, token: binding.token }, skill: null, out, query: query as never, disable1mContext: true, memoryLog: true, ...(isGstackArm(kind) ? { sessionKind: "unattended" as const } : {}) });
      const outcome = await driver.run(s.container.agent(driver.env!), { id: "t", prompt: armPrompt(kind) }, 300_000);
      expect([kind, outcome.termination]).toEqual([kind, { kind: "completed" }]);
      const memory = existsSync(join(out, "memory.ndjson")) ? readFileSync(join(out, "memory.ndjson"), "utf8") : null;
      const bodies = h.upstream.map((b) => JSON.stringify(b.body));
      expect([kind, [...markersSeen(bodies, memory, null)]]).toEqual([kind, []]);
      expect([kind, fixtureFilesLoaded(memory, "/work")]).toEqual([kind, []]);
      for (const [skill, mark] of Object.entries(SKILL_MARKS)) expect([kind, skill, bodies.some((b) => b.includes(mark))]).toEqual([kind, skill, isGstackArm(kind)]);
      const last = bodies.at(-1) ?? "";
      expect(last).toContain("SENTINEL-DONE");
      expect(last).toContain("NET none");
      expect(last).not.toMatch(/KEY [A-Z_]+|DRIVE \//);
      s.container.stop();
    }

    const h: Harness = harness(containerScript, { host: net.gateway });
    cleanup.push(() => h.close());
    const binding = h.bind(MODEL, "anthropic");
    const folder = sessionFolder({ ...u.unit, repo: u.raw }, join(scratch("control"), "s"));
    const c = startReviewContainer({ image: img, setup: sessionSetup("none", "opus"), folder, network: net.name });
    cleanup.push(() => c.stop());
    const out = join(h.dir, "host");
    const driver = claudeCodeDriver({ model: MODEL, provider: "anthropic", proxy: { baseUrl: h.baseUrl, slot: binding.slot, token: binding.token }, skill: null, out, query: query as never, disable1mContext: true, memoryLog: true });
    const outcome = await driver.run(c.agent(driver.env!), { id: "t", prompt: armPrompt("none") }, 300_000);
    const memory = existsSync(join(out, "memory.ndjson")) ? readFileSync(join(out, "memory.ndjson"), "utf8") : null;
    const seen = markersSeen(h.upstream.map((b) => JSON.stringify(b.body)), memory, null);
    expect(outcome.termination).toEqual({ kind: "completed" });
    expect(CONTROL_ALL.filter((m) => !seen.has(m))).toEqual([]);
    expect(seen.has(MARK.skill)).toBe(true);
    expect(fixtureFilesLoaded(memory, "/work")).toContain("repo/CLAUDE.md");
  }, 2_400_000);
});
