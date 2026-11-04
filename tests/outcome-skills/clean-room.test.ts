// The clean room for the none arm (G prereg section 4: panel v3's C1 clean room, reused from its closed PR #166 as
// GEVA-234 left it at 84059f4). The script is keyless under sh with the CLEAN_ROOM_ROOT seam; the preflight runs it in a
// real container with the session's mounts and must refuse a seeded drive mount (GSTACK_EVALS_DOCKER=1).
import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { CLEAN_ROOM_O1_SCRIPT, CLEAN_ROOM_SCRIPT, CLEAN_ROOM_SH, cleanRoomPreflight } from "../../lanes/outcome-skills/arms/clean-room.ts";

const roots: string[] = [];
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));
const fresh = () => {
  const d = mkdtempSync(join(tmpdir(), "outcome-clean-room-"));
  roots.push(d);
  for (const sub of ["home", "unit", "root"]) mkdirSync(join(d, sub));
  return { home: join(d, "home"), unit: join(d, "unit"), root: join(d, "root") };
};
const put = (path: string, text: string | null = null) => (text === null ? mkdirSync(path, { recursive: true }) : (mkdirSync(dirname(path), { recursive: true }), writeFileSync(path, text)));
const check = (r: { home: string; unit: string; root: string }, path = process.env.PATH ?? "/usr/bin:/bin") => {
  const c = spawnSync("sh", ["-c", CLEAN_ROOM_SCRIPT, "clean-room", r.home, r.unit], { encoding: "utf8", env: { PATH: path, CLEAN_ROOM_ROOT: r.root } });
  return { code: c.status, out: c.stdout, err: c.stderr };
};

describe("the clean-room script (keyless)", () => {
  test("it is C1's script, byte for byte, read from clean-room.sh", () => {
    expect(CLEAN_ROOM_SCRIPT).toBe(readFileSync(CLEAN_ROOM_SH, "utf8").replace(/\n$/, ""));
    expect(createHash("sha256").update(CLEAN_ROOM_SCRIPT).digest("hex")).toBe("b2bc5063d4b14a9b4354ff2f2689307a9b0aecc148dae531d25997614f876723");
  });

  test("a clean home and unit exit 0; each hit prints found <path> and exits 3", () => {
    const clean = fresh();
    put(join(clean.unit, "AGENTS.md"), "Review plans plainly.\n");
    put(join(clean.unit, ".git", "AGENTS.md"), "gstack\n");
    expect(check(clean)).toMatchObject({ code: 0, out: "" });
    const hits: [string, (r: ReturnType<typeof fresh>) => string, string | null][] = [
      ["home .capy", (r) => join(r.home, ".capy"), null],
      ["a drive mounted under the home", (r) => join(r.home, ".capy", "drive", "user-someone"), null],
      ["gstack install", (r) => join(r.home, ".local", "share", "gstack"), null],
      ["home skills, even empty", (r) => join(r.home, ".claude", "skills"), null],
      ["unit skills", (r) => join(r.unit, ".claude", "skills"), null],
      ["unit AGENTS.md", (r) => join(r.unit, "docs", "AGENTS.md"), "Load GStack first.\n"],
      ["home CLAUDE.md", (r) => join(r.home, ".claude", "CLAUDE.md"), "Use gstack skills.\n"],
      ["a drive under another user", (r) => join(r.root, "home", "user", ".capy", "drive"), null],
      ["a drive under /root", (r) => join(r.root, "root", ".capy", "drive"), null],
    ];
    for (const [name, where, text] of hits) {
      const r = fresh();
      put(where(r), text);
      const got = check(r);
      expect([name, got.code, got.out.split("\n").some((l) => l.startsWith("found ") && where(r).startsWith(l.slice(6)))]).toEqual([name, 3, true]);
    }
  });

  test("a unit CLAUDE.md linked to a file naming gstack is a hit; a dangling link stays clean", () => {
    const r = fresh();
    put(join(r.root, "notes.md"), "Load gstack first.\n");
    symlinkSync(join(r.root, "notes.md"), join(r.unit, "CLAUDE.md"));
    expect(check(r)).toMatchObject({ code: 3, out: "found " + join(r.unit, "CLAUDE.md") + "\n" });
    const dangling = fresh();
    symlinkSync(join(dangling.root, "gone.md"), join(dangling.unit, "CLAUDE.md"));
    expect(check(dangling)).toMatchObject({ code: 0, out: "" });
  });

  test("with find or grep off PATH the scan fails closed: reason on stderr, exit 4, even on a unit that names gstack", () => {
    for (const tool of ["find", "grep"] as const) {
      const bin = mkdtempSync(join(tmpdir(), "outcome-clean-room-bin-"));
      roots.push(bin);
      for (const t of ["sh", "find", "grep"].filter((t) => t !== tool)) symlinkSync(Bun.which(t)!, join(bin, t));
      const r = fresh();
      put(join(r.unit, "AGENTS.md"), "Load gstack first.\n");
      expect([tool, check(r, bin)]).toEqual([tool, { code: 4, out: "", err: "clean-room: " + tool + " is not on PATH, so the scan cannot run\n" }]);
    }
  });
});

// O1's second scan. A gstack trace is: ~/.gstack existing; a .claude/skills folder anywhere below a work dir, outside
// .git, existing; or, for a CLAUDE.md in a parent of a work dir, ~/CLAUDE.md, ~/.claude/settings.json (its hooks) and any
// entry under .claude/commands or .claude/plugins in the home or a work dir, "gstack" in any case in the name or content.
describe("O1's second clean-room scan (keyless)", () => {
  const room = () => {
    const r = fresh();
    const work = join(r.root, "work", "repo");
    put(join(work, "src", "app.js"), "export const add = (a, b) => a + b;\n");
    return { ...r, work };
  };
  const scan = (r: ReturnType<typeof room>, workdirs = [r.work], path = process.env.PATH ?? "/usr/bin:/bin") => {
    const c = spawnSync("sh", ["-c", CLEAN_ROOM_O1_SCRIPT, "clean-room-o1", r.home, ...workdirs], { encoding: "utf8", env: { PATH: path, CLEAN_ROOM_ROOT: r.root } });
    return { code: c.status, out: c.stdout, err: c.stderr };
  };

  test("a clean home and work dir exit 0, and look-alikes that name no gstack stay clean", () => {
    const r = room();
    put(join(r.root, "work", "CLAUDE.md"), "Write plainly.\n");
    put(join(r.home, "CLAUDE.md"), "Write plainly.\n");
    put(join(r.home, ".claude", "settings.json"), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "/opt/hooks/stop" }] }] } }));
    put(join(r.home, ".claude", "commands", "review.md"), "Review the diff.\n");
    put(join(r.work, ".claude", "plugins", "lint", "plugin.json"), "{}\n");
    put(join(r.work, ".git", "modules", "x", ".claude", "skills"));
    expect(scan(r)).toEqual({ code: 0, out: "", err: "" });
  });

  test("each gstack trace prints found <path> and exits 3", () => {
    const traces: [string, (r: ReturnType<typeof room>) => string, string | null][] = [
      ["~/.gstack, even empty", (r) => join(r.home, ".gstack"), null],
      ["a skills folder nested in a work dir", (r) => join(r.work, "packages", "api", ".claude", "skills"), null],
      ["a parent CLAUDE.md naming gstack", (r) => join(r.root, "work", "CLAUDE.md"), "Load gstack before implementing.\n"],
      ["a CLAUDE.md at the top of the walk", (r) => join(r.root, "CLAUDE.md"), "Use GStack.\n"],
      ["~/CLAUDE.md", (r) => join(r.home, "CLAUDE.md"), "Use gstack skills.\n"],
      ["a settings.json hook naming gstack", (r) => join(r.home, ".claude", "settings.json"), JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: "/opt/gstack/hooks/skill-route-hook" }] }] } })],
      ["a home command named for gstack", (r) => join(r.home, ".claude", "commands", "gstack-review.md"), "Review.\n"],
      ["a home plugin file naming gstack", (r) => join(r.home, ".claude", "plugins", "p", "plugin.json"), '{"name":"GStack"}\n'],
      ["a work-dir command naming gstack", (r) => join(r.work, ".claude", "commands", "review.md"), "Run the gstack review.\n"],
      ["a work-dir plugin folder named for gstack", (r) => join(r.work, ".claude", "plugins", "gstack"), null],
    ];
    for (const [name, where, text] of traces) {
      const r = room();
      put(where(r), text);
      const got = scan(r);
      expect([name, got.code, got.out.split("\n").some((l) => l === "found " + where(r))]).toEqual([name, 3, true]);
    }
  });

  test("with dirname off PATH, or a work dir that is not absolute, the scan fails closed with exit 4", () => {
    const bin = mkdtempSync(join(tmpdir(), "outcome-clean-room-bin-"));
    roots.push(bin);
    for (const t of ["sh", "find", "grep"]) symlinkSync(Bun.which(t)!, join(bin, t));
    const r = room();
    expect(scan(r, [r.work], bin)).toMatchObject({ code: 4, out: "", err: "clean-room-o1: dirname is not on PATH, so the scan cannot run\n" });
    expect(scan(r, ["work/repo"])).toMatchObject({ code: 4, err: expect.stringContaining("not an absolute path") });
  });
});

// A stub docker records its arguments and runs one body, so the preflight's exit mapping runs keyless.
const stubDocker = (body: string) => {
  const d = mkdtempSync(join(tmpdir(), "outcome-stub-docker-"));
  roots.push(d);
  const docker = join(d, "docker");
  writeFileSync(docker, "#!/bin/sh\nif [ \"$1\" = rm ]; then printf '%s\\n' \"$*\" >> '" + join(d, "rm.log") + "'; exit 0; fi\nprintf '%s\\n' \"$@\" > '" + join(d, "run.args") + "'\n" + body + "\n");
  chmodSync(docker, 0o755);
  const log = (n: string) => (existsSync(join(d, n)) ? readFileSync(join(d, n), "utf8") : "");
  return { docker, args: () => log("run.args").split("\n"), rm: () => log("rm.log") };
};
const thrown = (f: () => unknown) => {
  try {
    f();
  } catch (e) {
    return (e as Error).message;
  }
  return null;
};

describe("the clean-room preflight's exit mapping (keyless, stub docker)", () => {
  const opts = (docker: string) => ({ docker, image: "img:1", home: "/root", workdirs: ["/work/repo"], mounts: ["/src:/work/repo:ro"], digest: "sha256:test" });

  test("exit 0 passes, with both scans in one container call and the flags that let root see other users' homes", () => {
    const s = stubDocker("exit 0");
    expect(thrown(() => cleanRoomPreflight(opts(s.docker)))).toBeNull();
    const a = s.args();
    const flags = a.slice(0, a.indexOf("img:1"));
    for (const f of ["--rm", "--pull", "never", "--network", "none", "--cap-drop", "ALL", "--cap-add", "DAC_READ_SEARCH", "--security-opt", "no-new-privileges", "-v", "/src:/work/repo:ro"]) expect([f, flags.includes(f)]).toEqual([f, true]);
    expect(flags[flags.indexOf("--name") + 1]).toMatch(/^gstack-evals-[0-9a-f]{16}$/);
    expect(a.join("\n")).toContain(CLEAN_ROOM_SCRIPT);
    expect(a.join("\n")).toContain(CLEAN_ROOM_O1_SCRIPT);
  });

  test("exit 3 with hits names them; exit 3 with none, exit 4 or a spawn error did not finish", () => {
    expect(thrown(() => cleanRoomPreflight(opts(stubDocker("printf 'found /root/.gstack\\nfound /work/CLAUDE.md\\n'; exit 3").docker)))).toMatch(/^E_OUTCOME_CLEAN_ROOM .*sha256:test.*found \/root\/\.gstack, \/work\/CLAUDE\.md\n  fix: /);
    expect(thrown(() => cleanRoomPreflight(opts(stubDocker("exit 3").docker)))).toMatch(/^E_OUTCOME_CLEAN_ROOM .*did not finish \(exit 3\)/);
    expect(thrown(() => cleanRoomPreflight(opts(stubDocker("echo 'clean-room: find is not on PATH, so the scan cannot run' >&2; exit 4").docker)))).toMatch(/^E_OUTCOME_CLEAN_ROOM .*did not finish \(exit 4\): clean-room: find is not on PATH/);
    expect(thrown(() => cleanRoomPreflight(opts(join(tmpdir(), "outcome-no-such-docker-" + process.pid))))).toMatch(/^E_OUTCOME_CLEAN_ROOM .*did not finish \(.*ENOENT/);
  });

  test("a timed-out run is refused and its named container removed with docker rm -f", () => {
    const s = stubDocker("exec sleep 5");
    expect(thrown(() => cleanRoomPreflight({ ...opts(s.docker), timeoutMs: 300 }))).toMatch(/^E_OUTCOME_CLEAN_ROOM .*did not finish/);
    const a = s.args();
    expect(s.rm()).toBe("rm -f " + a[a.indexOf("--name") + 1] + "\n");
  });
});

const DOCKER = process.env.GSTACK_EVALS_DOCKER === "1";
const IMAGE = process.env.OUTCOME_OUTCOME_CLEAN_ROOM_IMAGE ?? "busybox:1.36";

describe.skipIf(!DOCKER)("the clean-room preflight in a real container (GSTACK_EVALS_DOCKER=1)", () => {
  const unit = () => {
    const r = fresh();
    put(join(r.unit, "src", "app.js"), "export const add = (a, b) => a + b;\n");
    return r;
  };

  test("a clean image with the unit mounted passes; nothing is written", () => {
    const r = unit();
    expect(() => cleanRoomPreflight({ docker: "docker", image: IMAGE, home: "/root", workdirs: ["/work/repo"], mounts: [r.unit + ":/work/repo:ro"], digest: "sha256:test" })).not.toThrow();
  });

  test("a seeded drive mount is refused with E_OUTCOME_CLEAN_ROOM, the path, the image digest and a fix, before any lease", () => {
    for (const at of ["/root/.capy/drive", "/root/.capy"]) {
      const r = unit();
      put(join(r.root, "drive", "user-someone", "AGENTS.md"), "Load gstack.\n");
      let err = "";
      try {
        cleanRoomPreflight({ docker: "docker", image: IMAGE, home: "/root", workdirs: ["/work/repo"], mounts: [r.unit + ":/work/repo:ro", join(r.root, "drive") + ":" + at + ":ro"], digest: "sha256:test" });
      } catch (e) {
        err = (e as Error).message;
      }
      expect([at, err.startsWith("E_OUTCOME_CLEAN_ROOM "), err.includes("found /root/.capy"), err.includes("sha256:test"), err.includes("fix: ")]).toEqual([at, true, true, true, true]);
    }
  });

  test("a gstack skills folder in the arm's home is refused", () => {
    const r = unit();
    put(join(r.root, "skills", "plan-eng-review", "SKILL.md"), "---\nname: plan-eng-review\n---\n");
    expect(() => cleanRoomPreflight({ docker: "docker", image: IMAGE, home: "/root", workdirs: ["/work/repo"], mounts: [r.unit + ":/work/repo:ro", join(r.root, "skills") + ":/root/.claude/skills:ro"], digest: "sha256:test" })).toThrow(/^E_OUTCOME_CLEAN_ROOM .*found \/root\/\.claude\/skills/);
  });

  test("a Capy drive in another uid's 0700 home is seen, as the session's root would see it", () => {
    const r = unit();
    const homes = join(r.root, "homes");
    put(join(homes, "other", ".capy", "drive", "user-someone", "AGENTS.md"), "Load gstack.\n");
    const asRoot = (cmd: string) => spawnSync("docker", ["run", "--rm", "--pull", "never", "--network", "none", "-v", homes + ":/x", IMAGE, "sh", "-c", cmd], { encoding: "utf8" });
    expect(asRoot("chown -R 4242:4242 /x/other && chmod 700 /x/other").status).toBe(0);
    try {
      expect(() => cleanRoomPreflight({ docker: "docker", image: IMAGE, home: "/root", workdirs: ["/work/repo"], mounts: [r.unit + ":/work/repo:ro", homes + ":/home:ro"], digest: "sha256:test" })).toThrow(/^E_OUTCOME_CLEAN_ROOM .*found \/home\/other\/\.capy\/drive/);
    } finally {
      asRoot("chown -R " + process.getuid!() + ":" + process.getgid!() + " /x/other && chmod 755 /x/other");
    }
  });

  test("a CLAUDE.md naming gstack in a parent of the work dir is refused", () => {
    const r = fresh();
    put(join(r.root, "work", "repo", "src", "app.js"), "export const add = (a, b) => a + b;\n");
    put(join(r.root, "work", "CLAUDE.md"), "Load gstack before implementing.\n");
    expect(() => cleanRoomPreflight({ docker: "docker", image: IMAGE, home: "/root", workdirs: ["/work/repo"], mounts: [join(r.root, "work") + ":/work:ro"], digest: "sha256:test" })).toThrow(/^E_OUTCOME_CLEAN_ROOM .*found \/work\/CLAUDE\.md/);
  });

  test("an image that cannot run the scan fails closed", () => {
    expect(() => cleanRoomPreflight({ docker: "docker", image: "gstack-evals-no-such-image:0", home: "/root", workdirs: ["/work/repo"], mounts: [], digest: "sha256:test" })).toThrow(/^E_OUTCOME_CLEAN_ROOM .*did not finish/);
  });
});
