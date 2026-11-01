// The real-outcome lane's arms (plan 2026-11-01-geva-87, section 5 and open items 3, 4, 7 and the Medium notes): the
// frozen turn texts and P0 limits, the Lane B files the lane wraps, and, on the built arm tars (REAL_OUTCOME_ARMS, from
// lanes/real-outcome/arms/build.ts), the gstack arm's preamble and /ship preflight in a real sandbox trial.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { GSTACK_PIN } from "../../lanes/real-outcome/arms/build.ts";

const ROOT = join(import.meta.dir, "../..");
const sha256 = (b: string | Buffer) => createHash("sha256").update(b).digest("hex");
const ARMS = JSON.parse(readFileSync(join(ROOT, "lanes/real-outcome/arms/arms.json"), "utf8"));
const SHIP_IT = "Ship it: commit, push this branch to origin and open a pull request with gh.";

describe("frozen texts and pins", () => {
  test("Lane B's agent and prompt wrapper, which this lane wraps, are the bytes it was built on", () => {
    expect(sha256(readFileSync(join(ROOT, "quick/laneb/runner/agent/laneb_agent.py")))).toBe("800f98de2c8791aa8523fc1e2dbdb6b629dea7d987cd57ebd5c3ccf1e20a8498");
    expect(sha256(readFileSync(join(ROOT, "quick/laneb/runner/prompt-wrapper.md")))).toBe("2e0674a8e1d65dfd7e511e7f7255235410d75a65fe49d7ce03c9d54202089d00");
    expect(sha256(readFileSync(join(ROOT, "lanes/real-outcome/agent/ship-persona.json")))).toBe("7e24fd3add6ac89929aea7f608b6ccfe79035a8846e2e002bba0ae8403696956");
  });

  test("every turn text, by sha256: the shared task line, none's turn 2 from open item 3, told's /ship, untold as none", () => {
    expect(Object.keys(ARMS.arms).sort()).toEqual(["gstack", "gstack-untold", "none"]);
    expect(ARMS.build_suffix).toBe("Work in this repository. Implement this, and make sure it works. Don't stop to ask; I'll tell you when to ship.");
    expect(sha256(ARMS.build_suffix)).toBe("f61d9d49c84832a38efc238fe94b98361590567699a678f61b366b11a19550d8");
    expect(ARMS.arms.none.turn2).toBe(SHIP_IT);
    const pins: Record<string, [string, string]> = {
      none: ["6695d4be82bc6de9e25464f5a022af1ccf51948e8ad9740f7b666d39aabd14e8", "f587e4256abdce31d4ada938d6273054f64b1a8cb2a09e7a122c648d28a4bd95"],
      gstack: ["54217e1193b42d63e3143bc43735b39d4270d1581bce29f0bca016c46e901a92", "853013666151c21c5172566557f7ba5271a40d18d41fdaa952fc1390d08bbeeb"],
      "gstack-untold": ["6695d4be82bc6de9e25464f5a022af1ccf51948e8ad9740f7b666d39aabd14e8", "f587e4256abdce31d4ada938d6273054f64b1a8cb2a09e7a122c648d28a4bd95"],
    };
    for (const [arm, [turn2, replay]] of Object.entries(pins)) {
      expect([arm, sha256(ARMS.arms[arm].turn2), sha256(ARMS.arms[arm].replay)]).toEqual([arm, turn2, replay]);
      expect(ARMS.arms[arm].replay.split("{description}").length).toBe(2);
    }
    expect(ARMS.arms.gstack.turn2).toBe("/ship");
    expect(ARMS.arms.gstack.replay.startsWith("/ship")).toBe(true);
    expect(ARMS.arms["gstack-untold"].turn2).toBe(ARMS.arms.none.turn2);
    expect(ARMS.arms.none.install).toBe("none");
    expect(ARMS.arms.gstack.install).toBe("gstack");
    expect(ARMS.arms["gstack-untold"].install).toBe("gstack");
  });

  test("P0 limits sit well above /ship's cost range and turn count, alike across arms (open item 7)", () => {
    for (const arm of Object.values(ARMS.arms) as { limits: Record<string, number> }[]) {
      expect(arm.limits).toEqual(ARMS.arms.none.limits);
      expect(arm.limits.max_turns).toBeGreaterThanOrEqual(1000);
      expect(arm.limits.session_cap_usd).toBeGreaterThanOrEqual(2 * 15);
      expect(arm.limits.wall_limit_sec).toBeGreaterThanOrEqual(3 * 3600);
      expect(arm.limits.quiet_sec).toBeGreaterThan(0);
    }
  });

  test("the gstack pin is 1.92.2.0 or newer, as section 5 requires, and its manifest names it", () => {
    const v = GSTACK_PIN.version.split(".").map(Number);
    expect(v[0]! * 1e9 + v[1]! * 1e6 + v[2]! * 1e3 + v[3]!).toBeGreaterThanOrEqual(1 * 1e9 + 92 * 1e6 + 2 * 1e3);
    const m = JSON.parse(readFileSync(join(ROOT, "lanes/real-outcome/arms/manifests/gstack.json"), "utf8"));
    expect([m.gstack_sha, m.gstack_git_tree, m.gstack_version]).toEqual([GSTACK_PIN.sha, GSTACK_PIN.git_tree, GSTACK_PIN.version]);
    expect(m.skills.names).toContain("ship");
    expect(m.install_command).toBe("./setup --host claude --no-browser -q");
    const none = JSON.parse(readFileSync(join(ROOT, "lanes/real-outcome/arms/manifests/none.json"), "utf8"));
    expect([none.tree.files, none.skills.count]).toEqual([0, 0]);
  });
});

const ARMS_DIR = process.env.REAL_OUTCOME_ARMS ?? "";
const HAS_TARS = ARMS_DIR !== "" && existsSync(join(ARMS_DIR, "gstack.tar"));

describe.skipIf(!HAS_TARS)("the built gstack arm in a sandbox trial (REAL_OUTCOME_ARMS)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "real-arms-"));
  const home = join(tmp, "home");
  let proc: ReturnType<typeof Bun.spawn> | null = null;
  let control = "";
  const c = join(tmp, "c");
  const repo = join(c, "testbed");
  const bin = join(c, "bin");
  const gitEnv = { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0", GIT_AUTHOR_NAME: "fixture", GIT_AUTHOR_EMAIL: "f@x.invalid", GIT_COMMITTER_NAME: "fixture", GIT_COMMITTER_EMAIL: "f@x.invalid" };
  // The trial's environment after the agent's freeze: HOME at the extracted arm, the stub gh first, a real Bun, nothing else.
  const env = () => ({ ...gitEnv, HOME: home, PATH: bin + ":" + dirname(process.execPath) + ":/usr/local/bin:/usr/bin:/bin", LANG: "C.UTF-8", TERM: "dumb" });
  const sh = (cmd: string, extra: Record<string, string> = {}) => {
    const r = spawnSync("bash", ["-c", cmd], { cwd: repo, env: { ...env(), ...extra }, encoding: "utf8", timeout: 120_000 });
    return { code: r.status ?? -1, out: (r.stdout ?? "") + (r.stderr ?? "") };
  };

  beforeAll(async () => {
    for (const arm of ["none", "gstack"]) expect(sha256(readFileSync(join(ARMS_DIR, arm + ".tar")))).toBe(JSON.parse(readFileSync(join(ROOT, "lanes/real-outcome/arms/manifests", arm + ".json"), "utf8")).tar.sha256);
    mkdirSync(home, { recursive: true });
    expect(spawnSync("tar", ["-xf", join(ARMS_DIR, "gstack.tar"), "-C", home]).status).toBe(0);
    proc = Bun.spawn([process.execPath, join(ROOT, "bin/gstack-evals"), "real", "sandbox", "serve", "--root", join(tmp, "sidecar"), "--agent-host", "127.0.0.1", "--agent-port", "0", "--control-port", "0"], { stdout: "pipe", stderr: "inherit" });
    const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
    let text = "";
    while (!text.includes("\n")) {
      const { value, done } = await reader.read();
      if (done) break;
      text += new TextDecoder().decode(value);
    }
    reader.releaseLock();
    control = text.match(/control=(\S+)/)?.[1] ?? "";
    mkdirSync(join(repo, "src"), { recursive: true });
    writeFileSync(join(repo, "src/app.js"), "export const add = (a, b) => a + b;\n");
    expect(sh("git init -q -b main && git add -A && git commit -qm base").code).toBe(0);
    const base = sh("git rev-parse HEAD").out.trim();
    expect(sh("git bundle create -q " + join(c, "base.bundle") + " refs/heads/main").code).toBe(0);
    const opened = await fetch(control + "/trials", { method: "POST", body: JSON.stringify({ trial: "arms", repo: "sandbox/repo", kind: "K2", base_branch: "main", base_commit: base, start_ref: "main", bundle: join(c, "base.bundle"), repo_dir: repo, config_dir: join(c, "etc"), bin_dir: bin, node: process.execPath }) });
    const body = (await opened.json()) as { prep: string };
    const prep = spawnSync("sh", ["-s"], { cwd: repo, env: env(), input: body.prep, encoding: "utf8" });
    expect(prep.stdout).toStartWith("REAL_PREP_OK feature ");
    writeFileSync(join(repo, "src/mul.js"), "export const mul = (a, b) => a * b;\n");
  }, 600_000);
  afterAll(() => {
    proc?.kill();
    rmSync(tmp, { recursive: true, force: true });
  });

  const preamble = 'printf "%s\\n" "$(~/.claude/skills/gstack/bin/gstack-skill-start --skill "ship" --model "claude")"';

  test("the ship preamble reports an interactive session with the seeded config and prints no first-run prompt", () => {
    const skill = readFileSync(join(home, ".claude/skills/ship/SKILL.md"), "utf8");
    expect(skill).toContain('~/.claude/skills/gstack/bin/gstack-skill-start --skill "ship" --model "claude"');
    const r = sh(preamble);
    expect(r.code).toBe(0);
    const field = (k: string) => new RegExp("^" + k + ": (.*)$", "m").exec(r.out)?.[1];
    expect([field("SESSION_KIND"), field("PROACTIVE"), field("ROUTING_DECLINED"), field("TELEMETRY"), field("UPDATE_CHECK"), field("QUESTION_TUNING"), field("BRANCH")]).toEqual(["interactive", "core", "true", "off", "false", "true", "feature"]);
    expect([field("LAKE_INTRO"), field("TEL_PROMPTED"), field("PROACTIVE_PROMPTED"), field("ACTIVATED"), field("FIRST_LOOP_SHOWN")]).toEqual(["yes", "yes", "yes", "yes", "yes"]);
    expect(r.out).not.toContain("GSTACK_INSTRUCTION_BEGIN");
    expect(r.out.split("\n").filter((l) => l && !/^[A-Z_]+: /.test(l))).toEqual([]);
  });

  test("with a variable the freeze removes, the same preamble would not be interactive (the freeze matters)", () => {
    expect(/^SESSION_KIND: (.*)$/m.exec(sh(preamble, { GSTACK_HEADLESS: "1" }).out)?.[1]).toBe("headless");
    expect(/^SESSION_KIND: (.*)$/m.exec(sh(preamble, { CI: "true" }).out)?.[1]).toBe("headless");
  });

  test("gstack's ship preflight prints no STOP on the trial's feature branch, and STOP on base", () => {
    const r = sh("~/.claude/skills/gstack/bin/gstack-ship-preflight --base main");
    expect(r.out).toContain("BRANCH: feature base=main");
    expect(r.out.split("\n").filter((l) => l.startsWith("STOP"))).toEqual([]);
    expect(r.code).toBe(0);
    const onBase = sh("git stash -q -u && git checkout -q main && ~/.claude/skills/gstack/bin/gstack-ship-preflight --base main; s=$?; git checkout -q feature && git stash pop -q; exit $s");
    expect(onBase.out).toMatch(/^STOP: on the base branch/m);
  });
});
