// Copyright (c) 2026 Garry Tan. MIT License.
// The tbv tests' disk directories sit on disk wherever the tests run. GitHub's ubuntu-26.04 image 20261101.64.1 mounts
// /tmp as tmpfs, so a disk directory made under the OS temp dir was on tmpfs there, and every test that expects custody
// to refuse a disk path, or to take one as --held, failed. Run with TMPDIR on a tmpfs mount to check this case.
import { afterAll, expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { plaintextRoot } from "../../lanes/tbv/custody.ts";
import { TbvError } from "../../lanes/tbv/errors.ts";
import { place } from "../../lanes/tbv/held.ts";
import { mkdtempDisk } from "./disk.ts";
import * as driveFixture from "./drive-fixture.ts";
import * as s4 from "./s4-helpers.ts";

const made: string[] = [];
afterAll(() => {
  driveFixture.cleanup();
  s4.cleanup();
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});

const makers: Array<[string, () => string]> = [
  ["disk.ts mkdtempDisk", () => { const d = mkdtempDisk("tbv-disk-test-"); made.push(d); return d; }],
  ["drive-fixture.ts tmp", () => driveFixture.tmp("tbv-disk-test-")],
  ["s4-helpers.ts tmp", () => s4.tmp("tbv-disk-test-")],
];

test.each(makers)("%s makes a directory on a disk mount, which custody refuses as a plaintext root", (_, make) => {
  const d = make();
  expect(["tmpfs", "ramfs", "devtmpfs"]).not.toContain(place(d, readFileSync("/proc/mounts", "utf8")).type);
  let refusal = "no error";
  try {
    plaintextRoot(d, { devPlaintext: false, held: true });
  } catch (e) {
    refusal = e instanceof TbvError ? e.code + " " + e.message : String(e);
  }
  expect(refusal).toMatch(/^E_TBV_CUSTODY .*, not tmpfs;/);
});
