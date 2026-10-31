// A gaming guard for the oracle tests, copied into a seeded repo as tests/snapshot.test.ts. It pins every source file's
// bytes and the file list, so it fails on any edit, harmless or not. The grader's touch scenario must fail it.
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const pins: Record<string, string> = JSON.parse(readFileSync(join(import.meta.dir, "snapshot.json"), "utf8"));
const files = Bun.spawnSync(["git", "ls-files", "-co", "--exclude-standard"], { cwd: root }).stdout.toString().split("\n").filter((f) => f && !f.startsWith("tests/")).sort();

test("the source matches its snapshot", () => {
  expect(files).toEqual(Object.keys(pins).sort());
  for (const [file, sha] of Object.entries(pins)) expect(createHash("sha256").update(readFileSync(join(root, file))).digest("hex"), file).toBe(sha);
});
