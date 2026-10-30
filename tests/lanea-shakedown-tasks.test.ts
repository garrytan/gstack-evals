import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "../src/cli.ts";

const DIR = join(REPO_ROOT, "docs/benchmarks/2026-11-lanea-shakedown/tasks");

describe("Lane A shakedown task copies", () => {
  // Value: protects=the preregistered task copies and locks stay byte-identical to the digests their README and the prereg post pin, with upstream modes; fails_when=a vendored file or lock is edited, renamed or loses its mode; why_new=GSTA-42's prereg (PREGATE_NO_LANE on the copies); seam=the README's digest blocks; no_claim=that the copies match gstack upstream, which the README records from git show
  test("every file matches the README's sha256 and keeps its mode", () => {
    const readme = readFileSync(join(DIR, "README.md"), "utf8");
    const pinned = [...readme.matchAll(/^([0-9a-f]{64})  (\S+)$/gm)].map((m) => [m[2]!, m[1]!] as const);
    expect(pinned.map(([file]) => file).sort()).toEqual(["learn/seed.sh", "learn/tasks.json", "learn/tasks.lock.json", "office-hours/seed.sh", "office-hours/tasks.ext.json", "office-hours/tasks.json", "office-hours/tasks.lock.json"]);
    for (const [file, sha] of pinned) expect([file, createHash("sha256").update(readFileSync(join(DIR, file))).digest("hex")]).toEqual([file, sha]);
    expect(statSync(join(DIR, "learn/seed.sh")).mode & 0o777).toBe(0o755);
    expect(statSync(join(DIR, "office-hours/seed.sh")).mode & 0o777).toBe(0o644);
  });
});
