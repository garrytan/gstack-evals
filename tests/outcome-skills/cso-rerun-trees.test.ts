// Copyright (c) 2026 Garry Tan. MIT License.
// GEVA-583 rerun prereg, "Trees": the counted-tree check against the parent's stage 2 export, on fixture records.
import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkCountedTree, main, STAGE2_SESSIONS } from "../../lanes/outcome-skills/cso/rerun-trees.ts";
import type { UnitRecord } from "../../lanes/outcome-skills/cso/types.ts";

const roots: string[] = [];
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));
const U = "owner__repo-ghsa-2222-3333-4444";
const SHA = "0d2709f7a3c7b94a" + "e".repeat(48);
const rec = (o: Partial<UnitRecord> = {}) => ({ unit: U, ghsa: "GHSA-2222-3333-4444", tree_sha256: SHA, ...o }) as UnitRecord;
function exportDir(tags: Record<string, string>): string {
  const d = mkdtempSync(join(tmpdir(), "cso-rerun-trees-"));
  roots.push(d);
  for (const [s, tag] of Object.entries(tags)) {
    mkdirSync(join(d, U, s), { recursive: true });
    writeFileSync(join(d, U, s, "run.json"), JSON.stringify({ image_tag: tag }));
  }
  return d;
}
const tag = (h = "0d2709f7a3c7b94a", id = "a5a1d9707f17") => "gstack-evals-cso-session:" + h + "-" + id;
const all = (f: (s: string) => string) => Object.fromEntries(STAGE2_SESSIONS.map((s) => [s, f(s)]));

test("a unit runs only when its four export tags agree with the rebuilt digest and its GHSA id matches its name", () => {
  const good = exportDir(all((s) => tag(undefined, s.startsWith("none") ? "a5a1d9707f17" : "bbbbbbbbbbbb")));
  expect(checkCountedTree(U, rec(), good)).toMatchObject({ ok: true, why: null });
  expect(checkCountedTree(U, null, good).why).toBe("no rebuilt unit record");
  expect(checkCountedTree(U, rec({ unit: "other" }), good).why).toContain("names other");
  expect(checkCountedTree(U, rec({ ghsa: "GHSA-9999-3333-4444" }), good).why).toContain("not the one in the unit's name");
  expect(checkCountedTree(U, rec({ tree_sha256: "f".repeat(64) }), good).why).toContain("the rebuilt tree_sha256 starts ffffffffffffffff");
  const split = exportDir(all((s) => tag(s === "cso-opus-0" ? "1".repeat(16) : undefined)));
  expect(checkCountedTree(U, rec(), split).why).toBe("the four stage 2 image tags disagree");
  const short = exportDir({ "cso-opus-0": tag(), "none-opus-0": tag() });
  expect(checkCountedTree(U, rec(), short).why).toContain("cso-particle-0, none-particle-0");
  const odd = exportDir(all(() => "gstack-evals-cso-session:" + "0d2709f7a3c7b94a"));
  expect(checkCountedTree(U, rec(), odd).why).toContain("not gstack-evals-cso-session:<16 hex>-<12 hex>");
});

test("main writes every check and the counted units, leaving out a unit with no record", () => {
  const exp = exportDir(all(() => tag()));
  const work = mkdtempSync(join(tmpdir(), "cso-rerun-work-"));
  roots.push(work);
  mkdirSync(join(work, "units"));
  writeFileSync(join(work, "units", U + ".json"), JSON.stringify(rec()));
  writeFileSync(join(work, "ids.json"), JSON.stringify([U, "gone__x-ghsa-aaaa-bbbb-cccc"]));
  expect(main(["--work", work, "--export", exp, "--units", join(work, "ids.json"), "--out", join(work, "trees.json")])).toBe(0);
  const out = JSON.parse(readFileSync(join(work, "trees.json"), "utf8"));
  expect(out.counted).toEqual([U]);
  expect(out.units.map((c: { unit: string; ok: boolean }) => [c.unit, c.ok])).toEqual([[U, true], ["gone__x-ghsa-aaaa-bbbb-cccc", false]]);
  expect(main(["--work", work])).toBe(2);
});
