// Copyright (c) 2026 Garry Tan. MIT License.
// The controller's pre-lease reserve check, on a scratch copy of the decision-routing ledger record with a temp SQLite
// ledger: before it opens a lease on an item it needs the item's cap to hold everything already committed on the item
// plus CONCURRENCY sessions' allowance in flight. Spend is put on the item through real open, reserve, settle and
// settle-lease calls. The real record is only read. The batch-start proxy port check (DR_PROXY_PORT_BUSY) refuses the
// same way, before any lease. Lease custody: with a real record the batch launches nothing until <out>/lease-confirmed.json
// lists its lease, which vm.sh record-out --confirm writes once the drive copy reads the lease back open; world() runs a
// stand-in confirmer unless a test turns it off.

import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONCURRENCY, ControllerError, PROXY_PORT_COUNT, PROXY_PORT_FIRST, reserveMicros, runBatch, type BatchOptions, type PlanRow } from "../../lanes/decision-routing/host/controller.ts";
import { openLease, settleLease } from "../../src/runner/ledger/ledger.ts";
import { LocalLedger } from "../../src/runner/ledger/local.ts";
import { readItem } from "../../src/runner/ledger/record.ts";

const REAL_RECORD = process.env.DR_REAL_RECORD ?? "";
const CELLS = JSON.parse(readFileSync(join(import.meta.dir, "../../lanes/decision-routing/config/cells.json"), "utf8"));
const ITEM = "dr-calibration";
const RUN = "dr-calibration@0123456789ab";
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const FAKE_HARBOR = `import { readFileSync, writeFileSync } from "node:fs";
const env = process.env;
const job = JSON.parse(readFileSync(process.argv[process.argv.indexOf("-c") + 1], "utf8"));
const kw = job.agents[0].kwargs;
const task = job.tasks[0].path.split("/").pop();
const mgmt = (path, body) => fetch("http://localhost" + path, { unix: env.DR_MGMT_SOCKET, method: "POST", headers: { "content-type": "application/json", "x-gstack-evals-management": env.DR_MGMT_TOKEN }, body: JSON.stringify(body) }).then((r) => r.json());
const b = await mgmt("/bind", { cell: { run_id: kw.item, arm: kw.cell, task, model: kw.model, trial: 1, attempt: 1 }, models: ["anthropic:claude-opus-5-5"], allowance_micros: 5000000 });
await fetch(env.DR_PROXY_BASE + "/" + b.slot + "/anthropic/v1/messages", { method: "POST", headers: { "content-type": "application/json", "x-api-key": b.token }, body: JSON.stringify({ model: "claude-opus-5-5", max_tokens: 100, messages: [{ role: "user", content: "hi" }] }) });
await mgmt("/unbind", { slot: b.slot });
await mgmt("/finalize", { meter_id: b.meter_id });
if (env.DR_TEST_TOUCH_STOP) writeFileSync(env.DR_TEST_TOUCH_STOP, "segment end\\n");
`;

let dirs: string[] = [];
let confirmers: Array<ReturnType<typeof setInterval>> = [];
afterEach(() => {
  for (const c of confirmers) clearInterval(c);
  confirmers = [];
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else out[p.slice(dir.length)] = readFileSync(p, "utf8");
    }
  };
  walk(dir);
  return out;
}

function world(confirm = true) {
  const dir = mkdtempSync(join(tmpdir(), "dr-reserve-"));
  dirs.push(dir);
  const record = join(dir, "dr-record");
  cpSync(REAL_RECORD, record, { recursive: true });
  const sqlite = join(dir, "ledger.sqlite");
  writeFileSync(join(dir, "fake-harbor.ts"), FAKE_HARBOR);
  writeFileSync(join(dir, "runtime.tgz"), "runtime");
  writeFileSync(join(dir, "pin.json"), "{}");
  mkdirSync(join(dir, "pristine"));
  for (const t of ["task-0", "task-1"]) {
    mkdirSync(join(dir, "tasks", t, "tests"), { recursive: true });
    mkdirSync(join(dir, "tasks", t, "solution"), { recursive: true });
    writeFileSync(join(dir, "tasks", t, "tests", "test.sh"), "#!/bin/bash\npytest tests/test_hidden_reserve_case.py\n");
    writeFileSync(join(dir, "tasks", t, "solution", "solve.sh"), "#!/bin/bash\ntrue\n");
    writeFileSync(join(dir, "pristine", t + ".json"), JSON.stringify({ files: [], testNames: [] }));
  }
  const opts = (tasks: string[], extra: Partial<BatchOptions> = {}, env: Record<string, string> = {}): BatchOptions => ({
    plan: tasks.map((task) => ({ task, cell: "N", model: "opus", item: ITEM }) as PlanRow),
    out: join(dir, "out"),
    runId: RUN,
    record,
    ledger: sqlite,
    harbor: [process.execPath, join(dir, "fake-harbor.ts")],
    tasksDir: join(dir, "tasks"),
    proxyHost: "127.0.0.1",
    runtimeTarball: join(dir, "runtime.tgz"),
    runtimeSha256: sha("runtime"),
    pinFile: join(dir, "pin.json"),
    pinSha256: sha("{}"),
    custody: { pristineDir: join(dir, "pristine"), labelStore: join(dir, "labels") },
    concurrency: 1,
    pollMs: 20,
    log: () => {},
    env: { PATH: process.env.PATH ?? "", HOME: dir, ANTHROPIC_API_KEY: "sk-ant-fake-0123456789", ...env },
    fetch: async () => Response.json({ id: "msg", usage: { input_tokens: 100, output_tokens: 20 } }),
    ...extra,
  });
  const spend = async (micros: number) => {
    const local = LocalLedger.open(sqlite);
    try {
      const lease = openLease(record, local, { item: ITEM, run_id: RUN, amount_micros: micros, requireAdmission: () => null });
      const r = await local.reserve({ idempotency_key: "pre-" + micros, lease_id: lease.lease_id, cell: { run_id: RUN, arm: "N", task: "task-x", model: "opus", trial: 1, attempt: 1, meter_id: "m-pre" }, max_micros: micros });
      if (!r.ok) throw new Error(r.code + ": " + r.message);
      const s = await local.settle(r.reservation.reservation_id, { kind: "spent", spent_micros: micros, usage: { input: 1, output: 1, reasoning: 0, cache_read: 0, cache_write: 0 } });
      if (!s.ok) throw new Error(s.code + ": " + s.message);
      settleLease(record, local, lease.lease_id);
    } finally {
      local.close();
    }
  };
  if (confirm) {
    confirmers.push(setInterval(() => {
      const open = readItem(record, ITEM).open;
      if (!open) return;
      mkdirSync(join(dir, "out"), { recursive: true });
      writeFileSync(join(dir, "out", "lease-confirmed.json"), JSON.stringify({ leases: [open.lease_id] }));
    }, 10));
  }
  return { dir, record, sqlite, opts, spend };
}

const SEG_FAKE = ["#!/usr/bin/env bash", "case $1 in", '  ssh) shift 2; HOME=$FAKE_VM_HOME bash -c "$*" ;;', '  pull) mkdir -p "$4" && (cd "$FAKE_VM_HOME" && cp -r "$3" "$4/") ;;', "esac"].join("\n") + "\n";

describe.skipIf(!REAL_RECORD || !existsSync(join(REAL_RECORD, "items", ITEM)))("lease custody", () => {
  test("with no confirmation that the drive holds the lease, the batch launches nothing, stops with DR_LEASE_UNRECORDED and settles the lease at zero", async () => {
    const w = world(false);
    const err = await runBatch(w.opts(["task-0"], { leaseConfirmMs: 1500 })).then(() => null, (e) => e);
    expect(err).toBeInstanceOf(ControllerError);
    expect((err as ControllerError).code).toBe("DR_LEASE_UNRECORDED");
    expect(existsSync(join(w.dir, "out", "jobs")) ? readdirSync(join(w.dir, "out", "jobs")) : []).toEqual([]);
    const leases = readItem(w.record, ITEM).leases;
    expect(leases.at(-1)!.close?.spent_micros).toBe(0);
  }, 60_000);

  test("record-out --confirm through the runner lets the batch launch once the drive copy reads the lease open, and a failed record-out does not", async () => {
    for (const good of [false, true]) {
      const w = world(false);
      const drive = join(w.dir, "drive");
      cpSync(w.record, drive, { recursive: true });
      const runner = join(w.dir, "ubi-runner.sh");
      writeFileSync(runner, SEG_FAKE);
      chmodSync(runner, 0o755);
      const batch = runBatch(w.opts(["task-0"], { leaseConfirmMs: good ? 30_000 : 3000 })).then((r) => r, (e) => e);
      let open = readItem(w.record, ITEM).open;
      for (let i = 0; !open && i < 500; i++) {
        await Bun.sleep(10);
        open = readItem(w.record, ITEM).open;
      }
      expect(open).toBeTruthy();
      if (!good) {
        const name = readdirSync(join(w.record, "items", ITEM)).find((n) => !existsSync(join(drive, "items", ITEM, n)))!;
        writeFileSync(join(drive, "items", ITEM, name), "a different file under the same name\n");
      }
      const p = Bun.spawn(["bash", join(import.meta.dir, "../../lanes/decision-routing/host/vm.sh"), runner, sha(SEG_FAKE), "record-out", "vm-1", drive, "--confirm", join(w.dir, "out")], { env: { PATH: process.env.PATH!, UBI_OWNER: "GEVA-TEST", UBI_TTL_HOURS: "6", FAKE_VM_HOME: w.dir }, stdout: "pipe", stderr: "pipe" });
      expect(await p.exited === 0).toBe(good);
      const result = await batch;
      if (good) expect(result.launched).toEqual(["task-0__N__opus"]);
      else expect((result as ControllerError).code).toBe("DR_LEASE_UNRECORDED");
    }
  }, 90_000);
});

describe.skipIf(!REAL_RECORD || !existsSync(join(REAL_RECORD, "items", ITEM)))("pre-lease reserve check", () => {
  test("the reserve is CONCURRENCY sessions at the cells' allowance: 6 x $5", () => {
    expect(reserveMicros()).toBe(CONCURRENCY * CELLS.limits.allowance_micros);
    expect(reserveMicros()).toBe(30_000_000);
  });

  test("cap minus settled at least the reserve: the lease opens, under the <item>@<sha12> run id unchanged", async () => {
    const w = world();
    const cap = readItem(w.record, ITEM).cap_micros!;
    await w.spend(cap - reserveMicros());
    const result = await runBatch(w.opts(["task-0"]));
    expect(result.stop).toBeNull();
    expect(result.launched).toEqual(["task-0__N__opus"]);
    const state = readItem(w.record, ITEM);
    expect(state.leases).toHaveLength(2);
    expect(state.leases[1]!.lease.run_id).toBe(RUN);
    expect(state.leases[1]!.lease.reserved_micros).toBe(reserveMicros());
    expect(state.leases.every((l) => l.close !== null)).toBe(true);
    expect(JSON.parse(readFileSync(join(w.dir, "out", "batch.json"), "utf8")).run_id).toBe(RUN);
  }, 60_000);

  test("cap minus settled below the reserve: the controller stops with DR_RESERVE_STOP and writes, leases and launches nothing", async () => {
    const w = world();
    const cap = readItem(w.record, ITEM).cap_micros!;
    await w.spend(cap - reserveMicros() + 1);
    const before = snapshot(w.record);
    const err = await runBatch(w.opts(["task-0"])).then(() => null, (e) => e);
    expect(err).toBeInstanceOf(ControllerError);
    expect((err as ControllerError).code).toBe("DR_RESERVE_STOP");
    expect((err as Error).message).toStartWith("DR_RESERVE_STOP: ");
    expect(snapshot(w.record)).toEqual(before);
    expect(readItem(w.record, ITEM).leases).toHaveLength(1);
    expect(existsSync(join(w.dir, "out", "jobs")) ? readdirSync(join(w.dir, "out", "jobs")) : []).toEqual([]);
  }, 60_000);

  test.if(process.platform === "linux")("a stranger listening on the proxy port range stops the batch with DR_PROXY_PORT_BUSY before any lease, and the batch runs once it is gone", async () => {
    const w = world();
    const before = snapshot(w.record);
    const port = PROXY_PORT_FIRST + PROXY_PORT_COUNT - 1;
    const stranger = Bun.listen({ hostname: "127.0.0.1", port, socket: { data() {} } });
    let err: unknown;
    try {
      err = await runBatch(w.opts(["task-0"])).then(() => null, (e) => e);
    } finally {
      stranger.stop(true);
    }
    expect(err).toBeInstanceOf(ControllerError);
    expect((err as ControllerError).code).toBe("DR_PROXY_PORT_BUSY");
    expect((err as Error).message).toContain(String(port));
    expect(snapshot(w.record)).toEqual(before);
    expect(existsSync(join(w.dir, "out", "jobs")) ? readdirSync(join(w.dir, "out", "jobs")) : []).toEqual([]);
    const result = await runBatch(w.opts(["task-0"]));
    expect(result.launched).toEqual(["task-0__N__opus"]);
  }, 60_000);

  test("a long run's segments: one drains through the stop file and settles, and the next opens its own lease under the same run id", async () => {
    const w = world();
    const stop = join(w.dir, "out", "STOP");
    const first = await runBatch(w.opts(["task-0", "task-1"], {}, { DR_TEST_TOUCH_STOP: stop }));
    expect(first.stop?.code).toBe("E_DR_STOPPED");
    expect(first.launched).toHaveLength(1);
    rmSync(stop);
    const second = await runBatch(w.opts(["task-0", "task-1"]));
    expect(second.stop).toBeNull();
    expect([...first.launched, ...second.launched].sort()).toEqual(["task-0__N__opus", "task-1__N__opus"]);
    expect(second.skipped).toEqual(first.launched);
    const state = readItem(w.record, ITEM);
    expect(state.leases.map((l) => l.lease.run_id)).toEqual([RUN, RUN]);
    expect(state.leases.every((l) => l.close !== null)).toBe(true);
  }, 60_000);
});
