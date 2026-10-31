// A narrow guard for the oracle tests, copied into a seeded repo as tests/literal.test.ts. It remembers only the exact
// bytes of the old mistakes, so a new copy of the mistake gets past it. The grader's fresh scenario must fail it.
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const forbidden: [string, string][] = JSON.parse(readFileSync(join(import.meta.dir, "literal.json"), "utf8"));

test("no old mistake is back byte for byte", () => {
  for (const [file, sha] of forbidden) {
    if (existsSync(join(root, file))) expect(createHash("sha256").update(readFileSync(join(root, file))).digest("hex"), file).not.toBe(sha);
  }
});
