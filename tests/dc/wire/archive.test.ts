// Copyright (c) 2026 Garry Tan. MIT License.
// The teardown puts the host's approval record back in the Captain's place (wire/host.ts writeArchive) when the archive
// and the Captain's record sit on different file systems: the archive on /dev/shm and the record on disk, where a
// rename between them fails with EXDEV. No key, no network, no VM.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AGE_HEADER } from "../../../lanes/design-constructed/money/controller-host.ts";
import { writeArchive, type HostPlanFile } from "../../../lanes/design-constructed/wire/host.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const NOW = () => new Date("2026-11-20T00:00:00Z");

/** The Captain's record on disk holding "old", and the teardown's archive holding the host's record with "new". */
function fixture() {
  const disk = mkdtempSync(join(tmpdir(), "dc-archive-"));
  const shm = mkdtempSync("/dev/shm/dc-archive-");
  dirs.push(disk, shm);
  const record = join(disk, "record");
  mkdirSync(record);
  writeFileSync(join(record, "approval.json"), "old\n");
  mkdirSync(join(shm, "host", "record"), { recursive: true });
  writeFileSync(join(shm, "host", "record", "approval.json"), "new\n");
  const tar = Bun.spawnSync(["tar", "-C", join(shm, "host"), "-cf", "-", "record"], { stdout: "pipe" });
  const out: string[] = [];
  const err: string[] = [];
  writeFileSync(join(shm, "work.tar.age"), AGE_HEADER);
  const archive = { lines: join(shm, "wal-lines.ndjson"), snapshot: null, record: new Uint8Array(tar.stdout), sealed: join(shm, "work.tar.age"), rows: null };
  const run = (rename?: (from: string, to: string) => void) => writeArchive(join(shm, "archive"), { record } as HostPlanFile, archive, { out: (t) => out.push(t), err: (t) => err.push(t) }, NOW, rename);
  return { disk, shm, record, run, out, err };
}

describe("the teardown's approval record", () => {
  // Value: protects=the Captain's approval record at teardown; fails_when=the host's record is renamed from the archive on /dev/shm onto a record on disk (EXDEV), or a failure leaves the plan's path with no record; why_new=the operator's teardown stopped with E_INTERNAL after the old record had moved aside; seam=writeArchive's copy and renames; no_claim=a teardown on the live hosts
  test("with the archive on /dev/shm and the record on disk, the host's record lands at the plan's path and the old one is kept beside it", () => {
    const f = fixture();
    expect(statSync(f.disk).dev).not.toBe(statSync(f.shm).dev);
    expect(f.run()).toBe(true);
    expect(f.err).toEqual([]);
    expect(readFileSync(join(f.record, "approval.json"), "utf8")).toBe("new\n");
    const kept = readdirSync(f.disk).filter((n) => n !== "record");
    expect(kept).toEqual(["record.before-teardown-2026-11-20T00-00-00-000Z"]);
    expect(readFileSync(join(f.disk, kept[0]!, "approval.json"), "utf8")).toBe("old\n");
    expect(f.out.some((t) => t.startsWith("record: the host's approval record is written back to " + f.record))).toBe(true);
  });

  for (const [step, failing] of [
    ["moving the old record aside", (from: string) => from.endsWith("/record")],
    ["putting the host's record in place", (from: string) => from.includes(".from-teardown-")],
  ] as const) {
    test("a rename that fails with EXDEV while " + step + " leaves the old record at the plan's path", () => {
      const f = fixture();
      const rename = (from: string, to: string) => {
        if (failing(from)) throw Object.assign(new Error("EXDEV: cross-device link not permitted, rename"), { code: "EXDEV" });
        renameSync(from, to);
      };
      expect(f.run(rename)).toBe(false);
      expect(readFileSync(join(f.record, "approval.json"), "utf8")).toBe("old\n");
      expect(readdirSync(f.disk)).toEqual(["record"]);
      expect(f.err.length).toBe(1);
      expect(f.err[0]).toStartWith("E_DC_INFRA_MISSING the host's approval record could not be");
      expect(f.err[0]).toContain("EXDEV");
    });
  }
});
