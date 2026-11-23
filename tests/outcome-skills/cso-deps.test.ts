// Copyright (c) 2026 Garry Tan. MIT License.
// Deviation (c): a unit whose affected package an arm's install holds at or past its fixed version drops from every cell,
// tested both ways: held past the fix drops; held vulnerable, held below the first affected version or not held stays;
// and the id rule (a) alone keeps every such unit.
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { affects, carriesFix, cmpVersion, containDeps, NAMED_DROPS, type UnitAffected } from "../../lanes/outcome-skills/cso/units/deps.ts";
import { scanIds } from "../../lanes/outcome-skills/cso/units/ids.ts";
import { loadCsoPrereg } from "../../lanes/outcome-skills/cso/prereg.ts";

const put = (files: Record<string, string>) => {
  const root = mkdtempSync(join(tmpdir(), "cso-deps-"));
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), c);
  }
  return root;
};
const npm = (unit: string, name: string, ...ranges: Array<Array<Record<string, string>>>): UnitAffected => ({ unit, affected: [{ ecosystem: "npm", name, ranges }] });

const UNITS: UnitAffected[] = [
  npm("u-past", "hono", [{ introduced: "4.12.4" }, { fixed: "4.13.11" }]),
  npm("u-vulnerable", "katex", [{ introduced: "0" }, { fixed: "0.18.2" }]),
  npm("u-before", "widget", [{ introduced: "2.0.0" }, { fixed: "2.1.0" }]),
  npm("u-backport", "body-parser", [{ introduced: "0" }, { fixed: "1.20.6" }], [{ introduced: "2.0.0" }, { fixed: "2.3.0" }]),
  npm("u-manifest", "ip-address", [{ introduced: "0" }, { fixed: "10.7.1" }]),
  npm("u-absent", "left-pad", [{ introduced: "0" }, { fixed: "9.9.9" }]),
  { unit: "u-crate", affected: [{ ecosystem: "crates.io", name: "zip", ranges: [[{ introduced: "0" }, { fixed: "2.3.0" }]] }] },
  { unit: "u-go", affected: [{ ecosystem: "Go", name: "github.com/example/mod", ranges: [[{ introduced: "0" }, { fixed: "1.4.2" }]] }] },
];

const TREE = {
  "gstack/bun.lock": '{\n  "packages": {\n    "hono": ["hono@4.13.16", "", {}, "sha512-x"],\n    "katex": ["katex@0.16.47", "", {}, "sha512-y"],\n    "widget": ["widget@1.9.0", "", {}, "sha512-z"],\n  }\n}\n',
  "gstack/lib/package-lock.json": JSON.stringify({ packages: { "": {}, "node_modules/body-parser": { version: "2.0.1" } } }),
  "gstack/node_modules/ip-address/package.json": JSON.stringify({ name: "ip-address", version: "10.7.4" }),
  "gstack/vendor/Cargo.lock": '[[package]]\nname = "zip"\nversion = "2.4.1"\n',
  "gstack/tools/go.sum": "github.com/example/mod v1.5.0 h1:abc=\ngithub.com/example/mod v1.5.0/go.mod h1:def=\n",
};

describe("versions and OSV ranges", () => {
  test("compare, affect and carry", () => {
    expect(cmpVersion("4.13.16", "4.13.11")).toBe(1);
    expect(cmpVersion("v1.5.0", "1.5")).toBe(0);
    expect(cmpVersion("2.0.0-rc.1", "2.0.0")).toBe(-1);
    expect(cmpVersion("0", "0.0.1")).toBe(-1);
    expect(affects([{ introduced: "0" }, { last_affected: "1.2.3" }], "1.2.3")).toBe(true);
    expect(affects([{ introduced: "0" }, { last_affected: "1.2.3" }], "1.2.4")).toBe(false);
    expect(carriesFix(UNITS[3].affected[0], "1.20.9")).toBe("1.20.6");
    expect(carriesFix(UNITS[3].affected[0], "2.0.1")).toBe(null);
  });
});

describe("deviation (c): installed dependencies past the fix", () => {
  const root = put(TREE);
  const r = containDeps({ arm: "cso", root, units: UNITS });

  test("held past the fix in a lockfile, an installed manifest, Cargo.lock or go.sum drops the unit", () => {
    expect(r.dropped).toEqual(["u-crate", "u-go", "u-manifest", "u-past"]);
    expect(r.hits.find((h) => h.unit === "u-past")).toMatchObject({ version: "4.13.16", fixed: "4.13.11", path: "gstack/bun.lock" });
  });

  test("the other way: held vulnerable, held below the first affected version, a vulnerable backport line, or not held, stays", () => {
    for (const u of ["u-vulnerable", "u-before", "u-backport", "u-absent"]) expect(r.dropped).not.toContain(u);
  });

  test("the id rule (a) alone keeps every unit this gate drops", () => {
    expect(scanIds(root, [{ unit: "u-past", ghsa: "GHSA-5r4p-p66f-jhc7", cves: ["CVE-2026-111757"], fix_commit: "f".repeat(40) }]).hits).toEqual([]);
  });

  test("a Maven or NuGet file the gate can't read fails closed only when a unit of that ecosystem is asked about", () => {
    const blind = put({ ...TREE, "gstack/java/pom.xml": "<project/>" });
    expect(() => containDeps({ arm: "cso", root: blind, units: [...UNITS, { unit: "u-maven", affected: [{ ecosystem: "Maven", name: "org.x:y", ranges: [[{ introduced: "0" }, { fixed: "1.0" }]] }] }] })).toThrow("E_CSO_SCAN");
    expect(containDeps({ arm: "cso", root: blind, units: UNITS }).unread).toEqual(["gstack/java/pom.xml"]);
  });

  test("a missing tree fails closed", () => {
    expect(() => containDeps({ arm: "cso", root: join(root, "missing"), units: UNITS })).toThrow("E_CSO_SCAN");
  });
});

describe("the 16 named drops", () => {
  test("each is a distinct candidate in prereg.json's part 2 list, with its lockfile line", () => {
    const part2 = new Set(loadCsoPrereg().units.part2_added);
    expect(NAMED_DROPS.length).toBe(16);
    expect(new Set(NAMED_DROPS.map((d) => d.unit)).size).toBe(16);
    for (const d of NAMED_DROPS) {
      expect(part2.has(d.unit)).toBe(true);
      expect(d.line).toMatch(/bun\.lock .+@\d.*, fixed in \d/);
    }
  });
});
