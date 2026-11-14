// Copyright (c) 2026 Garry Tan. MIT License.
// The Captain's ruling 1N: the wiring file's retry value is 3 attempts within 15 minutes.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readWiring, RULED_RETRY } from "../../../lanes/design-constructed/wire/real.ts";

describe("ruling 1N", () => {
  test("the ruled retry budget reads; any other refuses with E_USAGE naming the ruled value", () => {
    const dir = mkdtempSync(join(tmpdir(), "dc-retry-"));
    try {
      const file = join(dir, "wiring.json");
      const base = { pinRecord: "p", cacheDir: "c", scanMs: 10_000 };
      writeFileSync(file, JSON.stringify({ ...base, retry: { attempts: 3, elapsed_ms: 900_000 } }));
      expect(readWiring(file).retry).toEqual(RULED_RETRY);
      writeFileSync(file, JSON.stringify({ ...base, retry: { attempts: 5, elapsed_ms: 900_000 } }));
      expect(() => readWiring(file)).toThrow("not the ruled 3 attempts within 15 minutes");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
