// Copyright (c) 2026 Garry Tan. MIT License.
// The devex eval's keyless dry run (prereg 2026-11-09-geva-417 section 15 rule 4): every part's checks run, a part not
// built yet is one FAIL line, and dx dryrun exits 0 only when every line passes. The fake parts live in a temp dir.
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dryRun, PARTS, run } from "../../lanes/devex/dryrun.ts";

const dir = mkdtempSync(join(tmpdir(), "dx-dryrun-test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const fake = (name: string, body: string) => {
  const path = join(dir, name + ".ts");
  writeFileSync(path, body);
  return { name, path };
};

describe("dx dryrun", () => {
  test("a built part's lines pass through; a missing, empty, checkless or throwing part is one FAIL line", async () => {
    const lines = await dryRun([
      fake("good", "export async function checks() { return [{ rule: 'a', pass: true }, { rule: 'b', pass: false, detail: 'why' }]; }"),
      { name: "missing", path: join(dir, "nope.ts") },
      fake("bare", "export const x = 1;"),
      fake("empty", "export async function checks() { return []; }"),
      fake("throws", "export async function checks() { throw new Error('boom'); }"),
    ]);
    expect(lines.map((l) => [l.part, l.rule, l.pass])).toEqual([
      ["good", "a", true],
      ["good", "b", false],
      ["missing", "part not built", false],
      ["bare", "part exports no checks()", false],
      ["empty", "part's checks() returned no line", false],
      ["throws", "part's checks threw", false],
    ]);
  });

  test("every part: a part not built is exactly one FAIL line; a built part's lines all pass", async () => {
    const lines = await dryRun();
    for (const p of PARTS) {
      const mine = lines.filter((l) => l.part === p.name);
      if (!existsSync(p.path)) expect(mine.map((l) => [l.rule, l.pass])).toEqual([["part not built", false]]);
      else {
        expect(mine.length).toBeGreaterThan(0);
        for (const l of mine) expect({ rule: l.rule, pass: l.pass, detail: l.detail }).toEqual({ rule: l.rule, pass: true, detail: l.detail });
      }
    }
    if (PARTS.every((p) => existsSync(p.path))) expect(lines.every((l) => l.pass)).toBe(true);
  }, 300_000);

  test("dx dryrun prints a summary and exits 0 only when every line passes", async () => {
    const out: string[] = [];
    const code = await run(["--part", "leases"], { out: (t) => void out.push(t), err: () => {} });
    expect(code).toBe(0);
    expect(out.at(-1)).toMatch(/^dx dryrun: \d+ PASS, 0 FAIL$/);
    expect(out.slice(0, -1).every((l) => l.startsWith("PASS leases: "))).toBe(true);
    const all: string[] = [];
    const whole = await run([], { out: (t) => void all.push(t), err: () => {} });
    expect(whole).toBe(all.some((l) => l.startsWith("FAIL ")) ? 1 : 0);
    await expect(run(["--part", "nope"], { out: () => {}, err: () => {} })).rejects.toThrow(/usage/);
  }, 300_000);
});
