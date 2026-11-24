// Copyright (c) 2026 Garry Tan. MIT License.
// Plan section 3, gate 6, and deviation (a): the id scan's needle file. With no units there are no needles, and the file
// is empty, so scan-ids.sh exits before grep; a lone newline would be an empty pattern that matches every line of every
// file (a 2 GB installed home then took over 40 minutes). With needles, one pattern a line, CVE ids with their right edge.
import { expect, test } from "bun:test";
import { needleFile, scanIds, unitNeedles } from "../../lanes/outcome-skills/cso/units/ids.ts";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("no units give an empty needle file and a scan with no hits; units give one pattern a line", () => {
  expect(needleFile([])).toBe("");
  const ns = unitNeedles({ unit: "u1", ghsa: "GHSA-2222-3333-4444", cves: ["CVE-2026-1111"], fix_commit: "a".repeat(40) });
  expect(needleFile([...ns, ...ns]).split("\n").filter(Boolean)).toEqual(["ghsa-2222-3333-4444", "cve-2026-1111([^0-9]|$)", ns[2]!.needle]);
  const root = mkdtempSync(join(tmpdir(), "cso-needles-"));
  try {
    writeFileSync(join(root, "a.txt"), "GHSA-2222-3333-4444\nnothing\n");
    expect(scanIds(root, []).hits).toEqual([]);
    expect(scanIds(root, [{ unit: "u1", ghsa: "GHSA-2222-3333-4444", cves: [], fix_commit: "b".repeat(40) }]).hits.map((h) => h.unit)).toEqual(["u1"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("an archive that unpacks a directory with no write bit still leaves no scratch behind", () => {
  const root = mkdtempSync(join(tmpdir(), "cso-needles-ro-"));
  try {
    const src = join(root, "src");
    mkdirSync(join(src, "locked"), { recursive: true });
    writeFileSync(join(src, "locked", "f.txt"), "x\n");
    chmodSync(join(src, "locked"), 0o555);
    spawnSync("tar", ["-czf", join(root, "pkg.tgz"), "-C", src, "."]);
    chmodSync(join(src, "locked"), 0o755);
    rmSync(src, { recursive: true, force: true });
    const before = readdirSync(tmpdir()).filter((d) => d.startsWith("cso-arch-")).length;
    expect(scanIds(root, [{ unit: "u1", ghsa: "GHSA-2222-3333-4444", cves: [], fix_commit: "b".repeat(40) }]).hits).toEqual([]);
    expect(readdirSync(tmpdir()).filter((d) => d.startsWith("cso-arch-")).length).toBe(before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("an archive holding a file name that is not UTF-8 is still opened and scanned", () => {
  const root = mkdtempSync(join(tmpdir(), "cso-needles-bytes-"));
  try {
    const made = spawnSync("bash", ["-c", "mkdir -p src/d && printf 'GHSA-2222-3333-4444\\n' > \"src/d/$(printf '\\xff\\xfe')\" && printf 'x\\n' > \"src/$(printf 'a\\xe9')\" && tar -czf pkg.tgz -C src . && rm -rf src"], { cwd: root });
    expect(made.status).toBe(0);
    const r = scanIds(root, [{ unit: "u1", ghsa: "GHSA-2222-3333-4444", cves: [], fix_commit: "b".repeat(40) }]);
    expect(r.hits.map((h) => h.unit)).toEqual(["u1"]);
    expect(r.hits[0]!.path).toContain("_xfffe");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a CVE id beside a byte that is not UTF-8 is still found: the scan reads bytes under the C locale", () => {
  const root = mkdtempSync(join(tmpdir(), "cso-needles-bytes-"));
  const before = process.env.LC_ALL;
  process.env.LC_ALL = "C.UTF-8";
  try {
    writeFileSync(join(root, "blob.bin"), Buffer.concat([Buffer.from("see CVE-2026-1111"), Buffer.from([0xff, 0xfe]), Buffer.from(" here\n")]));
    const hits = scanIds(root, [{ unit: "u1", ghsa: "GHSA-2222-3333-4444", cves: ["CVE-2026-1111"], fix_commit: "b".repeat(40) }]).hits;
    expect(hits.map((h) => [h.unit, h.kind, h.path])).toEqual([["u1", "cve", "blob.bin"]]);
  } finally {
    if (before === undefined) delete process.env.LC_ALL;
    else process.env.LC_ALL = before;
    rmSync(root, { recursive: true, force: true });
  }
});

