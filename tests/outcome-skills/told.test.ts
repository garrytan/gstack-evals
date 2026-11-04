// The told install at gstack 699a41cb (G prereg section 2; O1): ./setup --host claude --loadout lite in a clean HOME,
// exactly as #193's install-pin.sh runs it, checked against #193's after-pin lite manifest. The digest rule runs keyless
// on a small tree; the full check runs when OUTCOME_TOLD_HOME names a home installed by told-install.sh.
import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { sessionEnv } from "../../lanes/outcome-skills/arms/autoplan.ts";
import { checkToldHome, liteTreeDigest, TOLD_INSTALL_SH, TOLD_PIN, toldRuntimePreflight } from "../../lanes/outcome-skills/arms/told.ts";

const roots: string[] = [];
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));
const put = (p: string, text: string) => (mkdirSync(dirname(p), { recursive: true }), writeFileSync(p, text));

describe("the told pin and install", () => {
  test("the pin is the prereg's, with #193's after-pin lite manifest and the raw skill sources the prereg read", () => {
    expect(TOLD_PIN).toMatchObject({ sha: "699a41cb6808e01240d02e82247693f9170d401a", version: "1.94.39.0", loadout: "lite", lite_files: 204, lite_tree_digest: "ed09c8c81574c6446a9579d255bd919470e4792bfc3ced4df42fd3fdc66dc8a7", lite_spec_sha256: "c5df50f999eb649abc0cd48c40907fe29c5ba71e4534a5cc63ae6e3d26234f1d" });
    expect(TOLD_PIN.sources).toMatchObject({ "plan-eng-review/SKILL.md": "58d96f6f3e296ccc2942e2e1a5732810b18f9f8bcd6ed9338115c99c91a88524", "autoplan/SKILL.md": "a1f4036492f6b27c1f9b96b256408207bfc97e804bebb478a2f04a5d538a46ca" });
    expect(TOLD_PIN.hooks).toEqual(["Stop gstack-timeline-stop 5", "Stop gstack-skill-contract 10", "UserPromptSubmit gstack-skill-route 5"]);
  });

  test("told-install.sh runs setup as #193 does: env -i, the clean HOME, lite, no browser or fonts, and checks out the pin by sha", () => {
    const sh = readFileSync(TOLD_INSTALL_SH, "utf8");
    expect(sh).toContain("./setup --host claude --loadout lite");
    expect(sh).toContain("GSTACK_SKIP_PLAYWRIGHT=1 GSTACK_SKIP_FONTS=1");
    expect(sh).toContain("env -i HOME=");
    expect(sh).toContain(TOLD_PIN.sha);
  });

  test("the lite digest normalizes the render folder and the home in each file, skips the lock, and sorts by path", () => {
    const home = mkdtempSync(join(tmpdir(), "outcome-told-"));
    roots.push(home);
    const render = join(home, ".gstack", "render", "claude");
    put(join(render, "b", "SKILL.md"), "Read " + render + "/b/sections/x.md — and " + home + "/.claude/skills/gstack/bin\n");
    put(join(render, "a.md"), "plain\n");
    put(join(render, "loadout.lock.json"), "{}\n");
    const other = mkdtempSync(join(tmpdir(), "outcome-told-other-"));
    roots.push(other);
    const render2 = join(other, ".gstack", "render", "claude");
    put(join(render2, "b", "SKILL.md"), "Read " + render2 + "/b/sections/x.md — and " + other + "/.claude/skills/gstack/bin\n");
    put(join(render2, "a.md"), "plain\n");
    const one = liteTreeDigest(home), two = liteTreeDigest(other);
    expect(one).toEqual(two);
    expect(one.files).toBe(2);
    const sha = (s: string) => new Bun.CryptoHasher("sha256").update(s).digest("hex");
    expect(one.digest).toBe(sha("a.md\t" + sha("plain\n") + "\nb/SKILL.md\t" + sha("Read <RENDER>/b/sections/x.md — and <HOME>/.claude/skills/gstack/bin\n") + "\n"));
  });

  test("a broken link in the render tree is refused with E_OUTCOME_TOLD_INSTALL, not a bare ENOENT", () => {
    const home = mkdtempSync(join(tmpdir(), "outcome-told-link-"));
    roots.push(home);
    const render = join(home, ".gstack", "render", "claude");
    put(join(render, "a.md"), "plain\n");
    symlinkSync(join(home, "gone.md"), join(render, "b.md"));
    expect(() => liteTreeDigest(home)).toThrow(/^E_OUTCOME_TOLD_INSTALL .*b\.md/);
  });

  test("the pin names each hook's file and its sha256 from gstack 699a41cb", () => {
    expect(TOLD_PIN.hook_files).toEqual({
      "gstack-timeline-stop": { file: "timeline-stop-hook", sha256: "b80d833ea66b1786f5c729b3e40c34982c484c64a064331087655111a5c52b59" },
      "gstack-skill-contract": { file: "skill-contract-stop-hook", sha256: "0ba38cdb7b2cd102fadd7e7e34e611da66a275e0efc8c043e43dd00d05b9367c" },
      "gstack-skill-route": { file: "skill-route-hook", sha256: "27e255325a97ca830e3947a100c93446501548bb46abc2ca247efac0c3223673" },
    });
  });

  test("a home that is not an install is refused with E_OUTCOME_TOLD_INSTALL", () => {
    const home = mkdtempSync(join(tmpdir(), "outcome-told-bad-"));
    roots.push(home);
    expect(() => checkToldHome(home)).toThrow(/^E_OUTCOME_TOLD_INSTALL /);
  });
});

// A stub docker records its arguments and runs one body, so the runtime preflight's exit mapping runs keyless.
const stubDocker = (body: string) => {
  const d = mkdtempSync(join(tmpdir(), "outcome-stub-docker-"));
  roots.push(d);
  const docker = join(d, "docker");
  writeFileSync(docker, "#!/bin/sh\nif [ \"$1\" = rm ]; then printf '%s\\n' \"$*\" >> '" + join(d, "rm.log") + "'; exit 0; fi\nprintf '%s\\n' \"$@\" > '" + join(d, "run.args") + "'\n" + body + "\n");
  chmodSync(docker, 0o755);
  const log = (n: string) => (existsSync(join(d, n)) ? readFileSync(join(d, n), "utf8") : "");
  return { docker, args: () => log("run.args").split("\n"), rm: () => log("rm.log") };
};
const ENV = sessionEnv({ PATH: "/usr/local/bin:/usr/bin:/bin", LANG: "C.UTF-8" });

describe("the told arm's runtime preflight (keyless, stub docker)", () => {
  const opts = (docker: string) => ({ docker, image: "img:1", user: "1000:1000", env: ENV, mounts: ["/h:/root"] });

  test("bun on the session's PATH passes and is returned; the run is the session's user and PATH in the arm's image, no pull, no network", () => {
    const s = stubDocker("printf '/usr/local/bin/bun\\n'; exit 0");
    expect(toldRuntimePreflight(opts(s.docker))).toBe("/usr/local/bin/bun");
    const a = s.args();
    const flags = a.slice(0, a.indexOf("img:1"));
    for (const f of ["--rm", "--pull", "never", "--network", "none", "--user", "1000:1000", "-v", "/h:/root", "PATH=" + ENV.PATH, "HOME=/root"]) expect([f, flags.includes(f)]).toEqual([f, true]);
    expect(flags[flags.indexOf("--name") + 1]).toMatch(/^gstack-evals-[0-9a-f]{16}$/);
    expect(a.slice(a.indexOf("img:1"))).toContain("command -v bun");
  });

  test("no bun, a run that did not finish or a spawn error is refused with E_OUTCOME_TOLD_INSTALL", () => {
    expect(() => toldRuntimePreflight(opts(stubDocker("exit 1").docker))).toThrow(/^E_OUTCOME_TOLD_INSTALL .*bun is not on the told session's PATH/);
    expect(() => toldRuntimePreflight(opts(stubDocker("exit 0").docker))).toThrow(/^E_OUTCOME_TOLD_INSTALL .*bun is not on the told session's PATH/);
    expect(() => toldRuntimePreflight(opts(stubDocker("echo 'Unable to find image' >&2; exit 125").docker))).toThrow(/^E_OUTCOME_TOLD_INSTALL .*did not finish \(exit 125\): Unable to find image/);
    expect(() => toldRuntimePreflight(opts(join(tmpdir(), "outcome-no-such-docker-" + process.pid)))).toThrow(/^E_OUTCOME_TOLD_INSTALL .*did not finish \(.*ENOENT/);
    const s = stubDocker("exec sleep 5");
    expect(() => toldRuntimePreflight({ ...opts(s.docker), timeoutMs: 300 })).toThrow(/^E_OUTCOME_TOLD_INSTALL .*did not finish/);
    expect(s.rm()).toStartWith("rm -f gstack-evals-");
  });
});

const DOCKER = process.env.GSTACK_EVALS_DOCKER === "1";
const IMAGE = process.env.OUTCOME_OUTCOME_CLEAN_ROOM_IMAGE ?? "busybox:1.36";
describe.skipIf(!DOCKER)("the told arm's runtime preflight in a real container (GSTACK_EVALS_DOCKER=1)", () => {
  test("an image with no bun on the session's PATH is refused", () => {
    expect(() => toldRuntimePreflight({ docker: "docker", image: IMAGE, env: ENV, mounts: [] })).toThrow(/^E_OUTCOME_TOLD_INSTALL .*bun is not on the told session's PATH/);
  });

  test("a stub bun mounted on the session's PATH passes", () => {
    const bin = mkdtempSync(join(tmpdir(), "outcome-stub-bun-"));
    roots.push(bin);
    writeFileSync(join(bin, "bun"), "#!/bin/sh\nexit 0\n");
    chmodSync(join(bin, "bun"), 0o755);
    chmodSync(bin, 0o755);
    expect(toldRuntimePreflight({ docker: "docker", image: IMAGE, env: { ...ENV, PATH: "/opt/stub-bin:" + ENV.PATH }, mounts: [bin + ":/opt/stub-bin:ro"] })).toBe("/opt/stub-bin/bun");
  });
});

const HOME_DIR = process.env.OUTCOME_TOLD_HOME ?? "";
describe.skipIf(!HOME_DIR)("an installed told home (OUTCOME_TOLD_HOME)", () => {
  test("matches #193's after-pin lite manifest: pin, loadout, 204 files, the digest, the hooks and the skill sources", () => {
    expect(checkToldHome(HOME_DIR)).toMatchObject({ ok: true, sha: TOLD_PIN.sha, version: TOLD_PIN.version, loadout: "lite", files: 204, digest: TOLD_PIN.lite_tree_digest, hooks: TOLD_PIN.hooks, review_sections: expect.stringMatching(/\/\.gstack\/render\/claude\/plan-eng-review\/sections\/review-sections\.md$/) });
  });

  test("the build home checked as the session's /root is refused, since its hooks point at the build home", () => {
    expect(() => checkToldHome(HOME_DIR, "/root")).toThrow(/^E_OUTCOME_TOLD_INSTALL .*hook .* is not \/root\/\.claude\/skills\/gstack\/hosts\/claude\/hooks\//);
  });

  let copy = "";
  const copied = () => {
    if (copy) return copy;
    copy = mkdtempSync(join(tmpdir(), "outcome-told-copy-"));
    roots.push(copy);
    const r = spawnSync("sh", ["-c", "cp -a '" + HOME_DIR + "/.' '" + copy + "' && grep -rlF '" + HOME_DIR + "' '" + copy + "/.gstack/render' '" + copy + "/.claude/settings.json' | xargs sed -i 's|" + HOME_DIR + "|" + copy + "|g'"], { encoding: "utf8" });
    expect(r.status).toBe(0);
    return copy;
  };
  const refusedWhile = (change: () => void, undo: () => void, why: RegExp) => {
    change();
    try {
      expect(() => checkToldHome(copied())).toThrow(why);
    } finally {
      undo();
    }
    expect(checkToldHome(copied()).ok).toBe(true);
  };

  test("a copy at another home still matches once its paths move with it; one changed render file is refused", () => {
    const copy = copied();
    expect(checkToldHome(copy)).toMatchObject({ ok: true, digest: TOLD_PIN.lite_tree_digest });
    const f = join(copy, ".gstack", "render", "claude", "plan-eng-review", "SKILL.md");
    const was = readFileSync(f);
    writeFileSync(f, readFileSync(f, "utf8") + "\n");
    expect(() => checkToldHome(copy)).toThrow(/^E_OUTCOME_TOLD_INSTALL .*digest/);
    writeFileSync(f, was);
  }, 600_000);

  test("each hook must be its source's pin file at the session home: a .. path, swapped hooks, edited hook bytes or a dirty checkout is refused", () => {
    const settings = join(copied(), ".claude", "settings.json");
    const was = readFileSync(settings, "utf8");
    const hooks = join(copied(), ".claude", "skills", "gstack", "hosts", "claude", "hooks");
    const edit = (f: (s: any) => void) => () => {
      const s = JSON.parse(was);
      f(s);
      writeFileSync(settings, JSON.stringify(s, null, 2));
    };
    const back = () => writeFileSync(settings, was);
    refusedWhile(edit((s) => (s.hooks.UserPromptSubmit[0].hooks[0].command = hooks + "/../hooks/skill-route-hook")), back, /^E_OUTCOME_TOLD_INSTALL .*UserPromptSubmit hook .*\/hooks\/\.\.\/hooks\/skill-route-hook is not /);
    refusedWhile(edit((s) => ([s.hooks.Stop[0].hooks[0].command, s.hooks.Stop[1].hooks[0].command] = [s.hooks.Stop[1].hooks[0].command, s.hooks.Stop[0].hooks[0].command])), back, /^E_OUTCOME_TOLD_INSTALL .*Stop hook /);
    const hook = join(hooks, "timeline-stop-hook");
    const bytes = readFileSync(hook);
    refusedWhile(() => writeFileSync(hook, Buffer.concat([bytes, Buffer.from("\n")])), () => writeFileSync(hook, bytes), /^E_OUTCOME_TOLD_INSTALL .*timeline-stop-hook has sha256 /);
    const stray = join(copied(), ".claude", "skills", "gstack", "o1-stray-file");
    refusedWhile(() => writeFileSync(stray, "x\n"), () => unlinkSync(stray), /^E_OUTCOME_TOLD_INSTALL .*git status .*o1-stray-file/);
  }, 600_000);

  test("a missing settings.json, a broken render link or a loadout line split by a newline is refused with E_OUTCOME_TOLD_INSTALL", () => {
    const settings = join(copied(), ".claude", "settings.json");
    refusedWhile(() => renameSync(settings, settings + ".o1"), () => renameSync(settings + ".o1", settings), /^E_OUTCOME_TOLD_INSTALL .*settings\.json/);
    const link = join(copied(), ".gstack", "render", "claude", "o1-broken-link.md");
    refusedWhile(() => symlinkSync(join(copied(), "o1-gone.md"), link), () => unlinkSync(link), /^E_OUTCOME_TOLD_INSTALL .*o1-broken-link\.md/);
    const config = join(copied(), ".gstack", "config.yaml");
    const was = readFileSync(config, "utf8");
    refusedWhile(() => writeFileSync(config, was.replace(/^claude_loadout:.*$/m, "claude_loadout:\nlite")), () => writeFileSync(config, was), /^E_OUTCOME_TOLD_INSTALL .*claude_loadout: lite/);
  }, 600_000);
});
