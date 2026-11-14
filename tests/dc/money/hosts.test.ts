// Copyright (c) 2026 Garry Tan. MIT License.
// The off-host write-ahead target (walctl through a local SSH stand-in) and the ledger service: fresh boot, a relaunch
// on the same host, a lost host restored from the copy, a copy that fails or lags (a Captain stop), the Captain's
// resume, teardown and the idle deletion of the controller host. No key, no network, no VM.
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "../../../lanes/design-constructed/money/book.ts";
import { makeRecord } from "../../../lanes/design-constructed/money/dryrun-fixture.ts";
import { openLedgerService, type HostVm, type LedgerService, type ServiceConfig } from "../../../lanes/design-constructed/money/ledger-service.ts";
import { localWalTransport, RemoteTarget, walAuthorizedKey, WALCTL_PY, type WalTransport } from "../../../lanes/design-constructed/money/offhost.ts";
import { chainAfter, GENESIS, WriteAhead } from "../../../lanes/design-constructed/money/wal.ts";
import { runProcess } from "../../../lanes/design-constructed/stage3/ubicloud-real.ts";

const dirs: string[] = [];
const temp = () => {
  const d = mkdtempSync(join(tmpdir(), "dc-hosts-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A WAL host stand-in: walctl installed in a folder and run locally. */
async function walHost(): Promise<{ dir: string; script: string; transport: WalTransport }> {
  const root = temp();
  const script = join(root, "walctl.py");
  writeFileSync(script, WALCTL_PY);
  const dir = join(root, "wal");
  mkdirSync(dir);
  const transport = localWalTransport(script, dir, 10_000);
  const init = await transport(["init"]);
  if (init.exit !== 0) throw new Error("walctl init failed: " + init.stderr);
  return { dir, script, transport };
}

/** A transport that fails or stalls while broken is set. */
const switchable = (inner: WalTransport, mode: { now: "ok" | "fail" | "lag" }): WalTransport => async (args, input) => {
  if (mode.now === "fail" && args[0] !== "lines") return { exit: 1, stdout: new Uint8Array(), stderr: "link down", timedOut: false };
  if (mode.now === "lag" && args[0] === "append") return runProcess(["bash", "-c", "sleep 5"], { timeoutMs: 200 });
  return inner(args, input);
};

describe("the off-host target over walctl", () => {
  test("an append resolves only on the WAL host's acknowledgement and reads back as one chain", async () => {
    const w = await walHost();
    const target = new RemoteTarget(w.transport);
    const wal = new WriteAhead(target);
    for (let i = 0; i < 5; i++) await wal.append({ kind: "admit", n: i });
    const lines = await target.lines();
    expect(lines.length).toBe(5);
    const chain = chainAfter(lines, 0, GENESIS);
    expect("lines" in chain && chain.lines.length).toBe(5);
    expect(statSync(join(w.dir, "wal.ndjson")).mode & 0o777).toBe(0o600);
  });

  test("snapshots and records put, read back by name and list newest first", async () => {
    const target = new RemoteTarget((await walHost()).transport);
    expect(await target.latestSnapshot()).toBeNull();
    await target.putSnapshot("snap-0000000003", new TextEncoder().encode("three"));
    await target.putSnapshot("snap-0000000012", new TextEncoder().encode("twelve"));
    await target.putRecord("snap-0000000012", new TextEncoder().encode("tar"));
    expect(await target.latestSnapshot()).toBe("snap-0000000012");
    expect(new TextDecoder().decode((await target.getSnapshot("snap-0000000003"))!)).toBe("three");
    expect(await target.getSnapshot("snap-0000000099")).toBeNull();
    expect(new TextDecoder().decode((await target.getRecord("snap-0000000012"))!)).toBe("tar");
    await expect(target.putSnapshot("../escape", new Uint8Array([1]))).rejects.toThrow("did not acknowledge");
  });

  test("a failed, lagging or wrongly acknowledged append throws and breaks the log", async () => {
    const w = await walHost();
    const mode = { now: "ok" as "ok" | "fail" | "lag" };
    const wal = new WriteAhead(new RemoteTarget(switchable(w.transport, mode)));
    await wal.append({ kind: "admit" });
    mode.now = "lag";
    await expect(wal.append({ kind: "admit" })).rejects.toThrow("within its time limit");
    expect(wal.broken).toContain("line 2");
    mode.now = "ok";
    await expect(wal.append({ kind: "admit" })).rejects.toThrow("broken");
    const liar = new WriteAhead(new RemoteTarget(async () => ({ exit: 0, stdout: new TextEncoder().encode("ACK " + "0".repeat(64)), stderr: "", timedOut: false })));
    await expect(liar.append({ kind: "admit" })).rejects.toThrow("did not acknowledge");
  });

  test("the controller's key is pinned to walctl on the WAL folder", () => {
    expect(walAuthorizedKey("ssh-ed25519 AAAAC3Nza dc-controller\n")).toBe('command="python3 /opt/dc-wal/walctl.py /var/lib/dc-wal",restrict ssh-ed25519 AAAAC3Nza dc-controller');
    expect(() => walAuthorizedKey("ssh-ed25519 AAAA\nssh-rsa BBBB")).toThrow();
  });
});

const HOUR = 3_600_000;

function hostsAt(t0: number): HostVm[] {
  return [
    { vm: "dcwal-test", role: "wal", ttlHours: 30, priceMicrosPerHour: $(0.02), createdAt: new Date(t0).toISOString() },
    { vm: "dcctl-test", role: "controller", ttlHours: 30, priceMicrosPerHour: $(0.06), createdAt: new Date(t0).toISOString() },
  ];
}

async function setup(o: { mode?: { now: "ok" | "fail" | "lag" } } = {}) {
  const w = await walHost();
  const root = temp();
  const clock = { t: Date.UTC(2026, 10, 14, 8) };
  const record = join(root, "ledger", "record");
  mkdirSync(join(root, "ledger"), { recursive: true });
  const made = makeRecord(join(root, "ledger"));
  if (made !== record) throw new Error("record path " + made);
  const cfg: ServiceConfig = { runId: "dc-hosts-test", holder: join(root, "holders", "dc-hosts-test"), record, ledgerPath: join(root, "ledger", "ledger.sqlite"), journalDir: join(root, "journals"), stateDir: join(root, "state"), hosts: hostsAt(clock.t) };
  const transport = o.mode ? switchable(w.transport, o.mode) : w.transport;
  const open = () => openLedgerService(cfg, new RemoteTarget(transport), { now: () => new Date(clock.t), leases: undefined });
  return { w, root, cfg, clock, open };
}

const svcOf = async (p: ReturnType<typeof setup> extends Promise<infer T> ? T : never): Promise<LedgerService> => {
  const o = await p.open();
  if (!o.ok) throw new Error("the service did not boot: " + o.captain);
  return o.service;
};

describe("the ledger service", () => {
  test("a fresh boot opens dc-hosts, admits both hosts, verifies a snapshot and writes its status", async () => {
    const s = await setup();
    const svc = await svcOf(s);
    try {
      expect(svc.boot).toBe("fresh");
      const f = svc.controller.figures("dc-hosts");
      expect(f.inFlightCount).toBe(2);
      expect(f.inFlightMicros).toBe(Math.ceil(30 * $(0.02)) + Math.ceil(30 * $(0.06)));
      expect(svc.lastSnapshot?.name).toMatch(/^snap-\d{10}$/);
      const st = JSON.parse(readFileSync(join(s.cfg.stateDir, "status.json"), "utf8"));
      expect([st.boot, st.captain, st.items.length]).toEqual(["fresh", null, 1]);
    } finally {
      svc.close();
    }
  });

  test("a relaunch on the same host keeps the ledger file and the lease, and holds what was in flight as unknown", async () => {
    const s = await setup();
    const first = await svcOf(s);
    const lease = first.controller.lease("dc-hosts")!.leaseId;
    first.close();
    const ino = statSync(s.cfg.ledgerPath).ino;
    const again = await svcOf(s);
    try {
      expect(again.boot).toBe("same-host");
      expect(statSync(s.cfg.ledgerPath).ino).toBe(ino);
      expect(again.controller.lease("dc-hosts")!.leaseId).toBe(lease);
      expect(again.recovered.held).toBe(2);
      expect(again.controller.figures("dc-hosts").unknownMicros).toBe(Math.ceil(30 * $(0.02)) + Math.ceil(30 * $(0.06)));
      expect(again.controller.subsOf("dc-hosts").length).toBe(2);
    } finally {
      again.close();
    }
  });

  test("a lost host restores the ledger file and the approval record from the off-host copy", async () => {
    const s = await setup();
    const first = await svcOf(s);
    const lease = first.controller.lease("dc-hosts")!.leaseId;
    first.close();
    rmSync(join(s.root, "ledger"), { recursive: true, force: true });
    rmSync(s.cfg.stateDir, { recursive: true, force: true });
    const again = await svcOf(s);
    try {
      expect(again.boot).toBe("restored");
      expect(existsSync(join(s.cfg.record, "items"))).toBe(true);
      expect(again.controller.lease("dc-hosts")!.leaseId).toBe(lease);
      expect(again.recovered.held).toBe(2);
    } finally {
      again.close();
    }
  });

  test("a copy that can't be shown complete stops the boot for the Captain", async () => {
    const s = await setup();
    const first = await svcOf(s);
    await first.controller.openItem("dc-authoring-1");
    first.close();
    const wal = join(s.w.dir, "wal.ndjson");
    const lines = readFileSync(wal, "utf8").split("\n").filter(Boolean);
    writeFileSync(wal, [...lines.slice(0, -1), lines.at(-1)!.replace('"kind":"lease"', '"kind":"lease2"')].join("\n") + "\n");
    rmSync(join(s.root, "ledger", "ledger.sqlite"));
    const again = await s.open();
    expect(again.ok).toBe(false);
    expect(JSON.parse(readFileSync(join(s.cfg.stateDir, "captain.json"), "utf8")).why).toContain("does not parse");
  });

  for (const fault of ["fail", "lag"] as const) {
    test("a copy that " + (fault === "fail" ? "fails" : "lags") + " stops the controller for the Captain until the Captain's resume", async () => {
      const mode = { now: "ok" as "ok" | "fail" | "lag" };
      const s = await setup({ mode });
      const svc = await svcOf(s);
      try {
        await svc.controller.openItem("dc-authoring-1");
        mode.now = fault;
        const a = await svc.controller.admitCall("dc-authoring-1", { run: "author 1", model: "argon", worstCaseMicros: $(1) });
        expect(a.kind).toBe("unacked");
        await svc.tick();
        expect(svc.captain?.why).toContain("write-ahead copy is broken");
        expect(existsSync(join(s.cfg.stateDir, "captain.json"))).toBe(true);
        mode.now = "ok";
        s.clock.t += HOUR;
        await svc.tick();
        expect(svc.wal.broken).not.toBeNull();
        expect((await svc.controller.admitCall("dc-authoring-1", { run: "author 2", model: "argon", worstCaseMicros: $(1) })).kind).toBe("captain");
        mkdirSync(join(s.cfg.stateDir, "control"), { recursive: true });
        writeFileSync(join(s.cfg.stateDir, "control", "resume-captain"), "");
        expect(await svc.tick()).toEqual(["resume-captain"]);
        expect([svc.captain, svc.wal.broken]).toEqual([null, null]);
        expect((await svc.controller.admitCall("dc-authoring-1", { run: "author 3", model: "argon", worstCaseMicros: $(1) })).kind).toBe("admitted");
      } finally {
        svc.close();
      }
    });
  }

  test("a teardown waits for in-flight work, then settles every item and the hosts at measured hours", async () => {
    const s = await setup();
    const svc = await svcOf(s);
    try {
      await svc.controller.openItem("dc-authoring-1");
      const a = await svc.controller.admitCall("dc-authoring-1", { run: "author 1", model: "argon", worstCaseMicros: $(1) });
      expect(a.kind).toBe("admitted");
      expect(await svc.teardown({ drainMs: 20 })).toEqual({ ok: false, why: "dc-authoring-1 still has work in flight" });
      s.clock.t += 10 * HOUR;
      expect(await svc.teardown({ force: true })).toEqual({ ok: true });
      expect(svc.controller.openItems()).toEqual([]);
      const hosts = svc.controller.subsOf("dc-hosts").filter((x) => x.state === "settled").reduce((n, x) => n + x.spentMicros, 0);
      expect(hosts).toBe(Math.ceil(10 * $(0.02)) + Math.ceil(10 * $(0.06)));
      expect(svc.controller.subsOf("dc-authoring-1")[0]!.state).toBe("unknown");
    } finally {
      svc.close();
    }
  });

  test("an idle wait over 12 hours deletes the controller host after its leases settle; the WAL host stays held", async () => {
    const s = await setup();
    const svc = await svcOf(s);
    try {
      const deleted: string[] = [];
      expect((await svc.idleDelete(12, async (vm) => void deleted.push(vm))).deleted).toBe(false);
      s.clock.t += 20 * HOUR;
      const d = await svc.idleDelete(13, async (vm) => void deleted.push(vm));
      expect([d.deleted, deleted]).toEqual([true, ["dcctl-test"]]);
      const subs = svc.controller.subsOf("dc-hosts");
      expect(subs.find((x) => x.vm?.id === "dcctl-test")!.spentMicros).toBe(Math.ceil(20 * $(0.06)));
      expect(subs.find((x) => x.vm?.id === "dcwal-test")!.state).toBe("in-flight");
    } finally {
      svc.close();
    }
  });
});
