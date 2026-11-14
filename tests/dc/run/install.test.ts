// Copyright (c) 2026 Garry Tan. MIT License.
// The Captain's ruling 1F: the install network leaves before Claude Code launches, and a session whose install digest
// differs from the pinned tree's stops before launch. The real listing command runs in a local shell standing in for
// docker exec.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installDigest, treeListing } from "../../../lanes/design-constructed/run/docker.ts";
import { cases } from "../../../lanes/design-constructed/run/dryrun-cases.ts";

describe("ruling 1F", () => {
  test("a pinned file missing from the container's listing changes the digest", () => {
    const dir = mkdtempSync(join(tmpdir(), "dc-install-test-"));
    try {
      writeFileSync(join(dir, "a"), "a\n");
      writeFileSync(join(dir, "b"), "b\n");
      const pinned = treeListing(dir);
      const full = [...pinned].map(([p, v]) => v + "  " + p).join("\n");
      const short = [...pinned].slice(0, 1).map(([p, v]) => v + "  " + p).join("\n");
      expect(installDigest(pinned, full)).not.toBe(installDigest(pinned, short));
      expect(installDigest(pinned, full + "\nffff  ./extra")).toBe(installDigest(pinned, full));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  for (const c of cases().filter((c) => c.name.includes("ruling 1F"))) test(c.name, async () => expect(await c.check()).toBeNull());
});
