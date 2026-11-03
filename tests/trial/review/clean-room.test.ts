import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { removeTree } from "../../../src/trial/cleanup.ts";
import { CLEAN_ROOM_SCRIPT } from "../../../src/trial/review/clean-room.ts";

const roots: string[] = [];
afterAll(() => roots.forEach((r) => removeTree(r)));
const fresh = () => {
  const d = mkdtempSync(join(tmpdir(), "clean-room-"));
  roots.push(d);
  for (const sub of ["home", "unit", "root"]) mkdirSync(join(d, sub));
  return { home: join(d, "home"), unit: join(d, "unit"), root: join(d, "root") };
};
const put = (path: string, text: string | null = null) => (text === null ? mkdirSync(path, { recursive: true }) : (mkdirSync(dirname(path), { recursive: true }), writeFileSync(path, text)));
const check = (r: { home: string; unit: string; root: string }) => {
  const c = spawnSync("sh", ["-c", CLEAN_ROOM_SCRIPT, "clean-room", r.home, r.unit], { encoding: "utf8", env: { PATH: process.env.PATH ?? "/usr/bin:/bin", CLEAN_ROOM_ROOT: r.root } });
  return { code: c.status, out: c.stdout };
};
const SH = Bun.which("sh")!;
const without = (tool: "find" | "grep") => {
  const bin = mkdtempSync(join(tmpdir(), "clean-room-bin-"));
  roots.push(bin);
  for (const t of ["sh", "find", "grep"].filter((t) => t !== tool)) symlinkSync(Bun.which(t)!, join(bin, t));
  return bin;
};

describe("the clean-room script (GEVA-203, keyless)", () => {
  // Value: protects=a none or lens arm runs only where no drive and no gstack install is visible: each hit prints its path and exits 3, a clean home and unit exit 0; fails_when=a hit passes, a clean tree is refused, or a .git copy or a file that never names gstack counts; seam=CLEAN_ROOM_SCRIPT under sh with the CLEAN_ROOM_ROOT seam
  test("a clean home and unit exit 0; each hit prints found <path> and exits 3", () => {
    const clean = fresh();
    put(join(clean.unit, "AGENTS.md"), "Review plans plainly.\n");
    put(join(clean.unit, ".git", "AGENTS.md"), "gstack\n");
    expect(check(clean)).toEqual({ code: 0, out: "" });
    const hits: [string, (r: ReturnType<typeof fresh>) => string, string | null][] = [
      ["home .capy", (r) => join(r.home, ".capy"), null],
      ["gstack install", (r) => join(r.home, ".local", "share", "gstack"), null],
      ["home skills", (r) => join(r.home, ".claude", "skills"), null],
      ["unit skills", (r) => join(r.unit, ".claude", "skills"), null],
      ["unit AGENTS.md", (r) => join(r.unit, "docs", "AGENTS.md"), "Load GStack first.\n"],
      ["home CLAUDE.md", (r) => join(r.home, ".claude", "CLAUDE.md"), "Use gstack skills.\n"],
      ["a drive", (r) => join(r.root, "home", "user", ".capy", "drive"), null],
    ];
    for (const [name, where, text] of hits) {
      const r = fresh();
      put(where(r), text);
      const got = check(r);
      expect([name, got.code, got.out.includes("found " + where(r))]).toEqual([name, 3, true]);
    }
  });

  // Value: protects=an instruction file the arm would load through a link is checked like a plain one; fails_when=a unit CLAUDE.md that links to a file naming gstack passes, or a dangling link is refused; seam=CLEAN_ROOM_SCRIPT's find over <unit>
  test("a unit CLAUDE.md that is a symlink to a file naming gstack prints found <path> and exits 3; a dangling one stays clean", () => {
    const r = fresh();
    put(join(r.root, "notes.md"), "Load gstack first.\n");
    symlinkSync(join(r.root, "notes.md"), join(r.unit, "CLAUDE.md"));
    expect(check(r)).toEqual({ code: 3, out: "found " + join(r.unit, "CLAUDE.md") + "\n" });
    const dangling = fresh();
    symlinkSync(join(dangling.root, "gone.md"), join(dangling.unit, "CLAUDE.md"));
    expect(check(dangling)).toEqual({ code: 0, out: "" });
  });

  // Value: protects=R2R4 (#166 /ship round 2, and Capy's review at clean-room.ts:47): an instruction file under a directory whose name holds a newline is checked like any other, so one that names gstack prints found and exits 3, and a clean one stays clean; fails_when=the scan splits find's output on newlines, so the hit is read as two missing paths and the script exits 0; why_new=GST-1121 item 3 (a fail-open regression from round 1's find loop); seam=CLEAN_ROOM_SCRIPT's find over <unit>; no_claim=a newline in the home or unit path itself
  test("an AGENTS.md under a directory whose name holds a newline is scanned: naming gstack exits 3, clean exits 0", () => {
    const r = fresh();
    const odd = join(r.unit, "notes\nold", "AGENTS.md");
    put(odd, "Load gstack first.\n");
    const got = check(r);
    expect([got.code, got.out]).toEqual([3, "found " + odd + "\n"]);
    const clean = fresh();
    put(join(clean.unit, "notes\nold", "AGENTS.md"), "Review plans plainly.\n");
    put(join(clean.unit, "CLAUDE.md"), "Keep it short.\n");
    expect(check(clean)).toEqual({ code: 0, out: "" });
  });

  // Value: protects=a scan that cannot run fails closed: with find or grep off PATH the script prints its reason on stderr and exits 4, never 0 or a bare 3, even on a unit whose AGENTS.md names gstack, and so does a CLAUDE.md link grep cannot read; fails_when=a missing tool or a read error leaves the scan silent and exits 0, or prints found from a scan that never ran; seam=CLEAN_ROOM_SCRIPT under sh with a PATH built at runtime
  test("with find or grep missing from PATH, or a link grep cannot read, the script prints its reason on stderr and exits 4", () => {
    for (const tool of ["find", "grep"] as const) {
      const r = fresh();
      put(join(r.unit, "AGENTS.md"), "Load gstack first.\n");
      const c = spawnSync(SH, ["-c", CLEAN_ROOM_SCRIPT, "clean-room", r.home, r.unit], { encoding: "utf8", env: { PATH: without(tool), CLEAN_ROOM_ROOT: r.root } });
      expect([tool, c.status, c.stdout, c.stderr]).toEqual([tool, 4, "", "clean-room: " + tool + " is not on PATH, so the scan cannot run\n"]);
    }
    const unread = fresh();
    put(join(unread.root, "notes"));
    symlinkSync(join(unread.root, "notes"), join(unread.unit, "CLAUDE.md"));
    const c = spawnSync(SH, ["-c", CLEAN_ROOM_SCRIPT, "clean-room", unread.home, unread.unit], { encoding: "utf8", env: { PATH: process.env.PATH ?? "/usr/bin:/bin", CLEAN_ROOM_ROOT: unread.root } });
    expect([c.status, c.stdout, c.stderr]).toEqual([4, "", "clean-room: grep could not read " + join(unread.unit, "CLAUDE.md") + " (exit 2)\nclean-room: find could not finish under " + unread.unit + "\n"]);
  });
});
