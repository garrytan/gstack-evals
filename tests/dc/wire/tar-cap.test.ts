// Copyright (c) 2026 Garry Tan. MIT License.
// The launcher packs the work folder at launch and a row's inputs at next as a tar in memory (wire/host.ts tarOf). A
// folder over the cap is refused before it is packed, so a large input fails with its size named instead of the
// launcher running out of memory. No key, no network, no VM.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TAR_CAP_BYTES, tarOf } from "../../../lanes/design-constructed/wire/host.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function folder(bytes: number): string {
  const d = mkdtempSync(join(tmpdir(), "dc-tarcap-"));
  dirs.push(d);
  writeFileSync(join(d, "f.bin"), new Uint8Array(bytes));
  return d;
}

describe("the launcher's in-memory tar", () => {
  // Value: protects=the launcher's memory at launch and next; fails_when=a work or inputs folder past the cap is packed whole in memory; why_new=a 3.4 GB read ran the launcher out of memory at teardown and the sweep found the same shape here; seam=tarOf; no_claim=the real folder sizes of a run
  test("packs a folder under the cap and refuses one over it, naming the size, before packing", () => {
    expect(TAR_CAP_BYTES).toBe(2 * 2 ** 30);
    const small = folder(64 * 1024);
    expect(tarOf(small, 1024 * 1024).length).toBeGreaterThan(64 * 1024);
    const big = folder(2 * 1024 * 1024);
    expect(() => tarOf(big, 1024 * 1024)).toThrow(/holds 2\.0 MiB.*over 1\.0 MiB/);
  });
});
