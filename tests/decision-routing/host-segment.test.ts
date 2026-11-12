// Copyright (c) 2026 Garry Tan. MIT License.
// Results off the runner VM and the ledger record (vm.sh record-in, record-out, pull-out) against a fake runner whose ssh
// runs locally under a fake VM home and whose pull copies like the real runner's tar pull: the record goes to the VM before
// a segment; after it only new files come back, and a file that exists and differs is an error that copies nothing; the
// batch's out dir lands under runs/<run id> without the runner-only markers, never over an earlier segment's pull.
// record-out --confirm writes <out>/lease-confirmed.json on the VM only when the drive copy reads back with every lease
// that is open on the VM open (lease custody). record-in refuses the next segment while an earlier segment's pulled out
// dir holds a STOP file the controller wrote (a reason code) or a DR_CUSTODY_HIT refusal.

import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openLease } from "../../src/runner/ledger/ledger.ts";

const REAL_RECORD = process.env.DR_REAL_RECORD ?? "";
const RUN = "dr-calibration@abc";
const CAL_RUN = "dr-calibration-r3@abc";

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
  expect(run("record-in", "vm-1", record, RUN).code).toBe(0);
  expect(readFileSync(join(vmHome, "dr-record", "items", "dr-calibration", "0001-init.json"), "utf8")).toBe("init\n");
  writeFileSync(join(vmHome, "dr-record", "items", "dr-calibration", "0002-lease.json"), "lease\n");
  const r = run("record-out", "vm-1", record);
  expect(r.code).toBe(0);
  expect(r.out).toContain("1 new");
  expect(readFileSync(join(record, "items", "dr-calibration", "0002-lease.json"), "utf8")).toBe("lease\n");
});

test("record-out refuses a file that exists and differs and copies nothing", () => {
  const { record, vmHome, run } = rig();
  expect(run("record-in", "vm-1", record, RUN).code).toBe(0);
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

test("pull-out keeps the safety pseudo-session's canary and markers file on the VM too", () => {
  const { dir, vmHome, run } = rig();
  const out = join(vmHome, "out", "answer-sc");
  mkdirSync(join(out, "constructed-calibration", "log"), { recursive: true });
  writeFileSync(join(out, "answer.json"), "{}");
  writeFileSync(join(out, "constructed-calibration", "canary.txt"), "DRCANARY-" + "cd".repeat(16) + "\n");
  writeFileSync(join(out, "constructed-calibration", "markers.json"), "[]\n");
  writeFileSync(join(out, "constructed-calibration", "log", "decisions.jsonl"), "{}\n");
  expect(run("pull-out", "vm-1", out, RUN).code).toBe(0);
  const dest = join(dir, "runs", RUN, "answer-sc");
  expect(readFileSync(join(dest, "constructed-calibration", "log", "decisions.jsonl"), "utf8")).toBe("{}\n");
  expect(existsSync(join(dest, "constructed-calibration", "canary.txt"))).toBe(false);
  expect(existsSync(join(dest, "constructed-calibration", "markers.json"))).toBe(false);
  expect(existsSync(join(out, "constructed-calibration", "canary.txt"))).toBe(true);
  expect(readdirSync(vmHome).filter((n) => n.startsWith(".dr-pull"))).toEqual([]);
});

test("pull-out never lands over an earlier segment's pull of the same out dir name", () => {
  const { dir, vmHome, run } = rig();
  const out = join(vmHome, "out", "cal");
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "batch.json"), "segment 1");
  expect(run("pull-out", "vm-1", out, RUN).code).toBe(0);
  writeFileSync(join(out, "batch.json"), "segment 2");
  const again = run("pull-out", "vm-1", out, RUN);
  expect(again.code).not.toBe(0);
  expect(again.out).toContain("E_DR_RUNNER: ");
  expect(readFileSync(join(dir, "runs", RUN, "cal", "batch.json"), "utf8")).toBe("segment 1");
});

test("record-in refuses the next segment after a controller-written STOP or a custody hit, and not after an operator's drain", () => {
  const { dir, record, run } = rig();
  const seg = join(dir, "runs", RUN, "cal-1");
  mkdirSync(join(seg, "journals"), { recursive: true });
  writeFileSync(join(seg, "STOP"), "segment end\n");
  expect(run("record-in", "vm-1", record, RUN).code).toBe(0);
  writeFileSync(join(seg, "STOP"), "DR_PILOT_SESSION_STOP: pilot session over its stop\n");
  const stopped = run("record-in", "vm-1", record, RUN);
  expect(stopped.code).not.toBe(0);
  expect(stopped.out).toContain("DR_PILOT_SESSION_STOP");
  rmSync(join(seg, "STOP"));
  writeFileSync(join(seg, "journals", "dr-calibration.ndjson"), JSON.stringify({ kind: "refusal", code: "DR_CUSTODY_HIT", meter_id: "m1" }) + "\n");
  const hit = run("record-in", "vm-1", record, RUN);
  expect(hit.code).not.toBe(0);
  expect(hit.out).toContain("DR_CUSTODY_HIT");
  expect(run("record-in", "vm-1", record, "dr-calibration@other").code).toBe(0);
  expect(run("record-in", "vm-1", record).code).not.toBe(0);
});

test.if(process.getuid?.() !== 0)("record-in refuses the next segment when an earlier segment's pulled journals can't be read, rather than reading that as no custody hit", () => {
  const { dir, record, run } = rig();
  const seg = join(dir, "runs", RUN, "cal-1");
  mkdirSync(join(seg, "journals"), { recursive: true });
  writeFileSync(join(seg, "journals", "dr-calibration.ndjson"), JSON.stringify({ kind: "settle" }) + "\n");
  expect(run("record-in", "vm-1", record, RUN).code).toBe(0);
  chmodSync(join(seg, "journals", "dr-calibration.ndjson"), 0o000);
  try {
    const r = run("record-in", "vm-1", record, RUN);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("E_DR_RUNNER: ");
    expect(r.out).toContain("could not be read");
  } finally {
    chmodSync(join(seg, "journals", "dr-calibration.ndjson"), 0o644);
  }
});

test.skipIf(!REAL_RECORD || !existsSync(join(REAL_RECORD, "items", "dr-calibration-r3")))("record-out --confirm tells the VM a lease is in the drive only once the drive copy reads it back open", () => {
  const { dir, vmHome, run } = rig();
  const drive = join(dir, "drive");
  cpSync(REAL_RECORD, drive, { recursive: true });
  expect(run("record-in", "vm-1", drive, CAL_RUN).code).toBe(0);
  const lease = openLease(join(vmHome, "dr-record"), null, { item: "dr-calibration-r3", run_id: CAL_RUN });
  const out = join(vmHome, "out", "cal");
  mkdirSync(out, { recursive: true });
  const confirmed = join(out, "lease-confirmed.json");
  const leaseFile = readdirSync(join(vmHome, "dr-record", "items", "dr-calibration-r3")).find((n) => !existsSync(join(drive, "items", "dr-calibration-r3", n)))!;
  writeFileSync(join(drive, "items", "dr-calibration-r3", leaseFile), "a different file under the same name\n");
  const bad = run("record-out", "vm-1", drive, "--confirm", out);
  expect(bad.code).not.toBe(0);
  expect(existsSync(confirmed)).toBe(false);
  rmSync(join(drive, "items", "dr-calibration-r3", leaseFile));
  const good = run("record-out", "vm-1", drive, "--confirm", out);
  expect(good.code).toBe(0);
  expect(JSON.parse(readFileSync(confirmed, "utf8")).leases).toEqual([lease.lease_id]);
});
