// Copyright (c) 2026 Garry Tan. MIT License.
// Deviation (a): containment over each arm's installed gstack tree, tested both ways. A unit named in the install drops
// from every cell; the same unit stays under section 3's session-tree-only rule; a unit named nowhere stays everywhere.
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { containInstall, dropsEveryCell } from "../../lanes/outcome-skills/cso/units/install-contain.ts";
import { scanIds, unitNeedles, type UnitIds } from "../../lanes/outcome-skills/cso/units/ids.ts";

const g = (d: string, ...a: string[]) => {
  const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd: d, encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout;
};
const put = (root: string, files: Record<string, string>) => {
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), c);
  }
  return root;
};
const tmp = (n: string) => mkdtempSync(join(tmpdir(), "cso-" + n + "-"));
const hex = (c: string) => c.repeat(40);

const A: UnitIds = { unit: "org__a-ghsa-2345-6789-cfgh", ghsa: "GHSA-2345-6789-cfgh", cves: [], fix_commit: hex("a") };
const B: UnitIds = { unit: "org__b-ghsa-jmpq-rvwx-2345", ghsa: "GHSA-jmpq-rvwx-2345", cves: ["CVE-2026-1234"], fix_commit: hex("b") };
const C: UnitIds = { unit: "org__c-ghsa-6789-cfgh-jmpq", ghsa: "GHSA-6789-cfgh-jmpq", cves: [], fix_commit: "c0ffee" + hex("1").slice(6) };
const D: UnitIds = { unit: "org__d-ghsa-rvwx-2345-6789", ghsa: "GHSA-rvwx-2345-6789", cves: ["CVE-2026-7777"], fix_commit: hex("d") };
const E: UnitIds = { unit: "org__e-ghsa-cfgh-jmpq-rvwx", ghsa: "GHSA-cfgh-jmpq-rvwx", cves: ["CVE-2026-4321"], fix_commit: hex("e") };
const UNITS = [A, B, C, D, E];

/** An installed gstack tree: A's GHSA id in upper case in a changelog, B's CVE id only in a git object that no checked-out
 *  file holds, C's fix prefix inside a full sha in a gzipped tarball, and D's CVE id run on into another digit. */
function install(): string {
  const root = put(tmp("install"), { "gstack/CHANGELOG.md": "- bump widget past GHSA-2345-6789-CFGH\n", "gstack/notes.txt": "see CVE-2026-77770 for the old bug\n" });
  const repo = join(root, "gstack");
  g(repo, "init", "-q");
  writeFileSync(join(repo, "gone.md"), "fixed CVE-2026-1234 upstream\n");
  g(repo, "add", "-A");
  g(repo, "commit", "-q", "-m", "one");
  g(repo, "rm", "-q", "gone.md");
  g(repo, "commit", "-q", "-m", "two");
  const pack = put(tmp("pack"), { "dist/pin.txt": "built from c0ffee" + hex("1").slice(6) + "\n" });
  spawnSync("tar", ["-czf", join(root, "gstack", "vendor.tgz"), "-C", pack, "dist"]);
  return root;
}

describe("unit needles", () => {
  test("lowercase ids, the fix's first 12 hex characters, and malformed ids refused", () => {
    expect(unitNeedles(B).map((n) => n.kind + " " + n.needle)).toEqual(["ghsa ghsa-jmpq-rvwx-2345", "cve cve-2026-1234", "fix_prefix " + "b".repeat(12)]);
    expect(() => unitNeedles({ ...A, ghsa: "GHSA-1234-5678-abcd" })).toThrow("E_CSO_UNIT_IDS");
    expect(() => unitNeedles({ ...A, cves: ["CVE-26-1"] })).toThrow("E_CSO_UNIT_IDS");
    expect(() => unitNeedles({ ...A, fix_commit: "abc" })).toThrow("E_CSO_UNIT_IDS");
  });
});

describe("deviation (a): the arm's installed gstack tree", () => {
  const root = install();
  const session = put(tmp("session"), { "src/index.js": "module.exports = 1;\n" });
  const cso = containInstall({ arm: "cso", root, units: UNITS });
  const none = containInstall({ arm: "none", root: put(tmp("none"), { ".keep": "" }), units: UNITS });

  test("an id in a file (any case), a git object or an archive drops the unit", () => {
    expect(cso.dropped).toEqual([A.unit, B.unit, C.unit]);
    expect(cso.hits.map((h) => h.unit + " " + h.kind + " " + h.where)).toEqual([A.unit + " ghsa git", A.unit + " ghsa file", B.unit + " cve git", C.unit + " fix_prefix archive"]);
    expect(cso.hits.find((h) => h.unit === C.unit)?.path).toBe("gstack/vendor.tgz!dist/pin.txt");
    expect(cso.stores).toEqual(["gstack/.git"]);
    expect(cso.root_tree_sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  test("a CVE id that runs on into another digit, and a unit named nowhere, stay", () => {
    expect(cso.dropped).not.toContain(D.unit);
    expect(cso.dropped).not.toContain(E.unit);
  });

  test("a hit in one arm's install drops the unit from every cell", () => {
    expect(none.dropped).toEqual([]);
    expect(dropsEveryCell([none, cso])).toEqual([A.unit, B.unit, C.unit]);
  });

  test("the other direction: section 3's session-tree rule alone keeps every unit the install names", () => {
    expect(scanIds(session, UNITS).hits).toEqual([]);
    expect(dropsEveryCell([none])).toEqual([]);
  });

  test("a scan that cannot finish fails closed", () => {
    expect(() => containInstall({ arm: "cso", root: join(root, "missing"), units: UNITS })).toThrow("E_CSO_SCAN");
    const bad = put(tmp("bad"), { "store/HEAD": "ref: refs/heads/main\n", "store/refs/heads/.keep": "", ["store/objects/ab/" + "c".repeat(38)]: "not a zlib stream" });
    expect(() => containInstall({ arm: "cso", root: bad, units: UNITS })).toThrow("E_CSO_SCAN");
  });
});
