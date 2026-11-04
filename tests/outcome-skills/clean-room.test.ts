// The clean room for the none arm (G prereg section 4: panel v3's C1 clean room, reused from its closed PR #166 as
// GEVA-234 left it at 84059f4). The script is keyless under sh with the CLEAN_ROOM_ROOT seam; the preflight runs it in a
// real container with the session's mounts and must refuse a seeded drive mount (GSTACK_EVALS_DOCKER=1).
import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { CLEAN_ROOM_SCRIPT, CLEAN_ROOM_SH, cleanRoomPreflight } from "../../lanes/outcome-skills/arms/clean-room.ts";

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

  test("an image that cannot run the scan fails closed", () => {
    expect(() => cleanRoomPreflight({ docker: "docker", image: "gstack-evals-no-such-image:0", home: "/root", workdirs: ["/work/repo"], mounts: [], digest: "sha256:test" })).toThrow(/^E_OUTCOME_CLEAN_ROOM .*did not finish/);
  });
});
