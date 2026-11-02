import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
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
});
