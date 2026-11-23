// Copyright (c) 2026 Garry Tan. MIT License.
// The containment check GEVA-434 left for the next attempt (lanes/eng-review/contain-check.py, pinned by its sha256
// prefix in prereg 2026-11-11-geva-522 section 11), run against its fixture tests: synthetic repos only, no unit data.
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SCRIPT = join(import.meta.dir, "..", "..", "lanes", "eng-review", "contain-check.py");

describe("er contain-check.py", () => {
  test("is the pinned copy", () => {
    expect(createHash("sha256").update(readFileSync(SCRIPT)).digest("hex").slice(0, 16)).toBe("73f3404953506184");
  });
  test("passes a clean unit and fails every staged, untracked, ignored, modified or moved-HEAD case", () => {
    const r = spawnSync("python3", [join(import.meta.dir, "test-contain-check.py"), SCRIPT], { encoding: "utf8", timeout: 120_000 });
    expect(r.stdout).toContain("failures 0");
    expect(r.stdout).not.toContain("FAIL ");
    expect(r.status).toBe(0);
  }, 150_000);
});
