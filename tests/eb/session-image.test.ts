import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildRegistry } from "../../lanes/eng-build/build-stage.ts";
import { sessionToml } from "../../lanes/eng-build/launch.ts";
import { EB_BUILD_SKILL, EB_PROGRAM, EB_RUN, itemOf } from "../../lanes/eng-build/ledger.ts";
import { claudePin, DEPS_SCRIPT, NODE_IMAGE, sessionDockerfile } from "../../lanes/eng-build/session-image.ts";
import { serveStages } from "../../lanes/outcome-skills/driver/stage.ts";
import { recordProgram } from "../../src/runner/ledger/envelope.ts";
import { recordApproval } from "../../src/runner/ledger/ledger.ts";
import { LocalLedger } from "../../src/runner/ledger/local.ts";
import { readItem } from "../../src/runner/ledger/record.ts";

const D = 1_000_000;
const quote = [{ words: "test ledger", by: "test", source: "tests/eb/session-image.test.ts" }];

describe("build session image", () => {
  test("Claude Code is the review stage's pin: docker/host-cli.json's version and trial.Dockerfile's checksum line", () => {
    const pin = claudePin();
    expect(pin.version).toBe(JSON.parse(readFileSync(join(import.meta.dir, "../../docker/host-cli.json"), "utf8")).claude);
    expect(pin.add).toMatch(/^ADD --checksum=sha256:[0-9a-f]{64} https:\/\/registry\.npmjs\.org\/@anthropic-ai\/claude-code-linux-x64\/-\/claude-code-linux-x64-/);
    expect(pin.add).toContain("-" + pin.version + ".tgz ");
  });
  test("the Dockerfile layers the pinned runtime on the unit image, with bundled skills off and no gstack or drive", () => {
    const text = sessionDockerfile("gstack-evals-eb-base:abc");
    expect(text.split("\n").filter((l) => l.startsWith("FROM "))).toEqual(["FROM " + NODE_IMAGE + " AS eb-node", "FROM gstack-evals-eb-base:abc"]);
    expect(NODE_IMAGE).toMatch(/@sha256:[0-9a-f]{64}$/);
    expect(text).toContain(claudePin().add.replace(/ \S+$/, " /tmp/claude-code.tgz"));
    expect(text).toContain("CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1");
    expect(text).not.toMatch(/gstack\b(?!-evals)|\.capy|skills/);
  });
  // Value: protects=dependencies a build session needs that live inside the project, and Python editable installs that
  // point at the unit image's project; fails_when=a Yarn PnP file or .yarn's untracked cache stays out of the build tree
  // or out of the deps list, a tracked file is copied, or an editable finder still names the unit image's project.
  test("the dependency step copies untracked Yarn PnP files and .yarn's untracked children, and repoints editable installs", () => {
    const dir = mkdtempSync(join(tmpdir(), "eb-deps-"));
    try {
      const T = join(dir, "testbed");
      const R = join(dir, "work/repo");
      const put = (p: string, s = "x\n") => (mkdirSync(join(p, ".."), { recursive: true }), writeFileSync(p, s));
      put(join(T, "package.json"), "{}\n");
      put(join(T, ".yarn/releases/yarn-4.cjs"));
      const git = (args: string[]) => spawnSync("git", ["-C", T, "-c", "user.name=t", "-c", "user.email=t@example.invalid", ...args], { encoding: "utf8" });
      git(["init", "-q"]);
      git(["add", "-A"]);
      git(["commit", "-q", "-m", "base"]);
      for (const p of [".pnp.cjs", ".pnp.loader.mjs", ".yarn/cache/left-pad.zip", ".yarn/install-state.gz", "node_modules/.bin/x", "web/node_modules/y/index.js"]) put(join(T, p));
      const site = join(dir, "site/lib/python3.12/site-packages");
      put(join(site, "__editable___pkg_0_1_finder.py"), "MAPPING = {'pkg': '" + T + "/src/pkg'}\n");
      put(join(site, "__editable__.flat-0.1.pth"), T + "\n");
      put(join(site, "other.pth"), "/usr/lib/other\n");
      const r = spawnSync("sh", ["-c", DEPS_SCRIPT], { env: { ...process.env, EB_T: T, EB_R: R, EB_D: join(dir, "eb"), EB_SITE: join(dir, "site") }, encoding: "utf8" });
      expect(r.stderr).toBe("");
      expect(r.status).toBe(0);
      expect(readFileSync(join(dir, "eb/deps"), "utf8").split("\n").filter(Boolean)).toEqual(["f .pnp.cjs", "f .pnp.loader.mjs", "d .yarn/cache", "f .yarn/install-state.gz", "d node_modules", "d web/node_modules"]);
      expect(existsSync(join(R, ".yarn/cache/left-pad.zip")) && existsSync(join(R, ".pnp.cjs")) && existsSync(join(R, "web/node_modules/y/index.js"))).toBe(true);
      expect(existsSync(join(R, ".yarn/releases"))).toBe(false);
      expect(readFileSync(join(site, "__editable___pkg_0_1_finder.py"), "utf8")).toBe("MAPPING = {'pkg': '" + R + "/src/pkg'}\n");
      expect(readFileSync(join(site, "__editable__.flat-0.1.pth"), "utf8")).toBe(R + "\n");
      expect(readFileSync(join(site, "other.pth"), "utf8")).toBe("/usr/lib/other\n");
      expect(readFileSync(join(dir, "eb/editable"), "utf8").split("\n").filter(Boolean).length).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  test("the Harbor task gives the session image and no Harbor network policy, so real_agent's egress table decides", () => {
    const toml = sessionToml("u1", "gstack-evals-eb-session:x", 10800);
    expect(toml).toContain('docker_image = "gstack-evals-eb-session:x"');
    expect(toml).toContain("timeout_sec = 11400");
    expect(toml).not.toContain("network_mode");
  });
});

describe("build items on the outcome driver", () => {
  const serve = async (o: { program: boolean; skills: boolean }) => {
    const dir = mkdtempSync(join(tmpdir(), "eb-driver-"));
    const record = join(dir, "record");
    const cap = itemOf("eb-builds-opus").capUsd * D;
    if (o.program) recordProgram(record, { program: EB_PROGRAM, cap_micros: cap, skill_cap_micros: cap, skills: [EB_BUILD_SKILL], credit_rate_micros: D, quotes: quote });
    recordApproval(record, { action: "init", item: "eb-builds-opus", cap_micros: cap, quotes: quote, admission: "warn", ...(o.program ? { program: EB_PROGRAM, skills: [EB_BUILD_SKILL] } : {}) });
    const local = LocalLedger.open(join(dir, "ledger.sqlite"));
    try {
      const served = await serveStages({ record, local, run_id: EB_RUN, envelope_host: "m1", machine: "m1", stages: [{ item: "eb-builds-opus", arm: "eb-build:none", ...(o.skills ? { skills: [EB_BUILD_SKILL] } : {}) }], host: "127.0.0.1", dir: join(dir, "run"), registry: buildRegistry(), fetch: async () => new Response("{}"), env: { ANTHROPIC_API_KEY: "test-not-a-key" }, requireAdmission: () => null, log: () => {} });
      const opened = readItem(record, "eb-builds-opus").open !== null;
      await served.stop();
      const item = readItem(record, "eb-builds-opus");
      return { opened, settled: item.open === null && item.leases.length === 1 && item.leases[0]!.close !== null };
    } catch (e) {
      return { error: (e as Error).message };
    } finally {
      local.close();
      rmSync(dir, { recursive: true, force: true });
    }
  };
  test("an item in no program is refused", async () => {
    expect((await serve({ program: false, skills: true })).error).toContain("is in no program");
  });
  test("an item in the program opens and settles one lease when the stage charges EB_BUILD_SKILL, and is refused when it charges nothing", async () => {
    expect(await serve({ program: true, skills: true })).toEqual({ opened: true, settled: true });
    expect((await serve({ program: true, skills: false })).error).toContain("splits its spend across " + EB_BUILD_SKILL);
  });
});
