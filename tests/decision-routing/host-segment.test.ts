// Copyright (c) 2026 Garry Tan. MIT License.
// Results off the runner VM and the ledger record (vm.sh record-in, record-out, pull-out) against a fake runner whose ssh
// runs locally under a fake VM home and whose pull copies like the real runner's tar pull: the record goes to the VM before
// a segment; after it only new files come back, and a file that exists and differs is an error that copies nothing; the
// batch's out dir lands under runs/<run id> without the runner-only markers.

import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const VM = join(import.meta.dir, "../../lanes/decision-routing/host/vm.sh");
const FAKE = ["#!/usr/bin/env bash", "case $1 in", '  ssh) shift 2; HOME=$FAKE_VM_HOME bash -c "$*" ;;', '  pull) mkdir -p "$4" && (cd "$FAKE_VM_HOME" && cp -r "$3" "$4/") ;;', "esac"].join("\n") + "\n";

let dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

function rig() {
  const dir = mkdtempSync(join(tmpdir(), "dr-seg-"));
  dirs.push(dir);
  const runner = join(dir, "ubi-runner.sh");
  writeFileSync(runner, FAKE);
  chmodSync(runner, 0o755);
  const sha = createHash("sha256").update(FAKE).digest("hex");
  const record = join(dir, "record");
  mkdirSync(join(record, "items", "dr-calibration"), { recursive: true });
  writeFileSync(join(record, "items", "dr-calibration", "0001-init.json"), "init\n");
  const vmHome = join(dir, "vm");
  mkdirSync(vmHome);
  const run = (...args: string[]) => {
    const r = Bun.spawnSync(["bash", VM, runner, sha, ...args], { env: { PATH: process.env.PATH!, UBI_OWNER: "GEVA-TEST", UBI_TTL_HOURS: "6", FAKE_VM_HOME: vmHome, DR_RUNS_DIR: join(dir, "runs") } });
    return { code: r.exitCode, out: r.stdout.toString() + r.stderr.toString() };
  };
  return { dir, record, vmHome, run };
}

test("record-in copies the record to the VM; record-out brings back only new files", () => {
  const { record, vmHome, run } = rig();
  expect(run("record-in", "vm-1", record).code).toBe(0);
  expect(readFileSync(join(vmHome, "dr-record", "items", "dr-calibration", "0001-init.json"), "utf8")).toBe("init\n");
  writeFileSync(join(vmHome, "dr-record", "items", "dr-calibration", "0002-lease.json"), "lease\n");
  const r = run("record-out", "vm-1", record);
  expect(r.code).toBe(0);
  expect(r.out).toContain("1 new");
  expect(readFileSync(join(record, "items", "dr-calibration", "0002-lease.json"), "utf8")).toBe("lease\n");
});

test("record-out refuses a file that exists and differs and copies nothing", () => {
  const { record, vmHome, run } = rig();
  expect(run("record-in", "vm-1", record).code).toBe(0);
  writeFileSync(join(vmHome, "dr-record", "items", "dr-calibration", "0001-init.json"), "changed\n");
  writeFileSync(join(vmHome, "dr-record", "items", "dr-calibration", "0002-lease.json"), "lease\n");
  const r = run("record-out", "vm-1", record);
  expect(r.code).not.toBe(0);
  expect(r.out).toContain("items/dr-calibration/0001-init.json");
  expect(readFileSync(join(record, "items", "dr-calibration", "0001-init.json"), "utf8")).toBe("init\n");
  expect(existsSync(join(record, "items", "dr-calibration", "0002-lease.json"))).toBe(false);
});

test("pull-out lands the out dir under runs/<run id> without the markers, and needs batch.json or answer.json", () => {
  const { dir, vmHome, run } = rig();
  const out = join(vmHome, "out", "cal");
  mkdirSync(join(out, "journals"), { recursive: true });
  mkdirSync(join(out, "markers"), { recursive: true });
  writeFileSync(join(out, "markers", "s.json"), "[]");
  writeFileSync(join(out, "journals", "dr-calibration.ndjson"), "{}\n");
  expect(run("pull-out", "vm-1", out, "dr-calibration@abc").code).not.toBe(0);
  writeFileSync(join(out, "batch.json"), "{}");
  expect(run("pull-out", "vm-1", out, "dr-calibration@abc").code).toBe(0);
  const dest = join(dir, "runs", "dr-calibration@abc", "cal");
  expect(readFileSync(join(dest, "journals", "dr-calibration.ndjson"), "utf8")).toBe("{}\n");
  expect(existsSync(join(dest, "markers"))).toBe(false);
});
