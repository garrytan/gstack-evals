// Copyright (c) 2026 Garry Tan. MIT License.
// The ledger service: the one process on the controller host that holds the money controller and the one local ledger
// file (R2-3, R2-4, L7). It boots from the off-host copy every time: on a fresh host with an empty copy it starts
// clean; on a relaunch on the same host it keeps the ledger file and rebuilds the book from the newest verified
// snapshot and the chained lines after it; on a replacement host it restores the ledger file from the snapshot and
// puts the reserves after the watermark back through main's reconcileJournal (money/durability.ts). Every boot then
// admits the run's own hosts on dc-hosts, takes a verified snapshot and writes status.json.
//
// Captain stops (money open item 5): a broken write-ahead copy (an append that failed or lagged past its limit), a
// recovery whose completeness can't be shown, a failed snapshot or a refused host admission stop the controller for
// the Captain. Every open item is paused for the Captain, captain.json is written, no snapshot restarts the chain on
// its own, and only the Captain's resume (a control file the attaching agent writes on the Captain's word) takes a
// verified snapshot and lifts it.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { LocalLedger } from "../../../src/runner/ledger/local.ts";
import type { LedgerItemId } from "../types.ts";
import type { MoneyController } from "./book.ts";
import { latestSnapshot, recover, replayReserves, restoreLedgerFile, snapshotDue, takeSnapshot } from "./durability.ts";
import { admitVm, idleDelete, vmSubs } from "./hosts.ts";
import { settleFromJournals, writeScan } from "./journals.ts";
import { mainLeases } from "./ledger-main.ts";
import type { ItemFigures, LeaseSeam, OffHostTarget } from "./types.ts";
import type { WriteAhead } from "./wal.ts";

/** A VM the host layer made and holds on dc-hosts, never counted as work that will free room. */
export interface HostVm {
  vm: string;
  role: "controller" | "wal";
  ttlHours: number;
  priceMicrosPerHour: number;
  /** When the VM was created; its measured hours run from here. */
  createdAt: string;
}

export interface ServiceConfig {
  runId: string;
  /** The run id's fixed holder directory, the same absolute path on a replacement host (R2-17). */
  holder: string;
  /** Main's approval record. */
  record: string;
  /** The one local ledger file. */
  ledgerPath: string;
  journalDir: string;
  stateDir: string;
  hosts: HostVm[];
}

export type Boot = "fresh" | "same-host" | "restored";

export interface CaptainStop {
  why: string;
  at: string;
}

export interface ServiceStatus {
  pid: number;
  runId: string;
  boot: Boot;
  startedAt: string;
  at: string;
  watermark: number;
  lastSnapshot: string | null;
  captain: CaptainStop | null;
  /** Sub-reservations held as unknown by this boot's recovery. */
  held: number;
  uncertainMicros: number;
  items: ItemFigures[];
}

/** A target that also keeps the approval record's files beside each snapshot (RemoteTarget does). */
export type ServiceTarget = OffHostTarget & Partial<{ putRecord(name: string, tar: Uint8Array): Promise<void>; getRecord(name: string): Promise<Uint8Array | null> }>;

/** The approval record directory as a tar, read in one synchronous step. */
export function recordTar(record: string): Uint8Array {
  const r = Bun.spawnSync(["tar", "-C", dirname(record), "-cf", "-", basename(record)], { stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error("could not read the approval record at " + record);
  return new Uint8Array(r.stdout);
}

function extractRecord(record: string, tar: Uint8Array): void {
  mkdirSync(dirname(record), { recursive: true, mode: 0o700 });
  const r = Bun.spawnSync(["tar", "-C", dirname(record), "-xf", "-"], { stdin: tar, stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0 || !existsSync(record)) throw new Error("could not restore the approval record at " + record);
}

const writeAtomic = (path: string, text: string) => {
  writeFileSync(path + ".tmp", text, { mode: 0o600 });
  renameSync(path + ".tmp", path);
};

/** The host's measured hours not yet settled, spread over its open sub-reservations in order (in flight settle, unknown reconcile). */
export async function settleHostVm(c: MoneyController, h: HostVm, nowMs: number): Promise<number> {
  const subs = vmSubs(c, h.vm);
  const settledHours = subs.filter((s) => s.state === "settled").reduce((a, s) => a + s.spentMicros, 0) / h.priceMicrosPerHour;
  const open = subs.filter((s) => s.state === "in-flight" || s.state === "unknown");
  let left = Math.max((nowMs - Date.parse(h.createdAt)) / 3_600_000 - settledHours, 0);
  let total = 0;
  for (const [i, s] of open.entries()) {
    const hours = i === open.length - 1 ? left : Math.min(left, s.vm!.ttlHours);
    left -= hours;
    const spent = Math.ceil(hours * h.priceMicrosPerHour);
    total += spent;
    if (s.state === "in-flight") await c.settle(s.id, { spentMicros: spent });
    else await c.reconcile(s.id, spent);
  }
  return total;
}

export class LedgerService {
  captain: CaptainStop | null = null;
  lastSnapshot: { name: string; at: Date } | null = null;
  private settledSig = "";
  private priorPauses = new Map<LedgerItemId, { why: string; allowTag: string | null; captain: boolean } | null>();
  readonly startedAt: Date;

  constructor(
    readonly cfg: ServiceConfig,
    readonly target: ServiceTarget,
    readonly controller: MoneyController,
    readonly wal: WriteAhead,
    readonly local: LocalLedger,
    readonly boot: Boot,
    readonly recovered: { held: number; uncertainMicros: number },
    private readonly now: () => Date,
  ) {
    this.startedAt = now();
  }

  private sig(): string {
    return this.controller
      .subsOf()
      .filter((s) => s.state !== "in-flight")
      .map((s) => s.id + ":" + s.state)
      .join(",");
  }

  /** A verified snapshot off host; it restarts a broken chain, so it runs on its own only while no Captain stop stands. */
  async snapshot(): Promise<void> {
    const tar = this.target.putRecord ? recordTar(this.cfg.record) : null;
    const snap = await takeSnapshot(this.controller, this.wal, this.target, { ledgerPath: this.cfg.ledgerPath, now: this.now() });
    if (tar) await this.target.putRecord!(snap.name, tar);
    this.lastSnapshot = { name: snap.name, at: this.now() };
    this.settledSig = this.sig();
  }

  /** Opens dc-hosts and admits each of the run's hosts that holds no open sub-reservation. */
  async admitHosts(): Promise<void> {
    const c = this.controller;
    for (const h of this.cfg.hosts) {
      if (vmSubs(c, h.vm).some((s) => s.state === "in-flight" || s.state === "unknown")) continue;
      if (!c.lease("dc-hosts")) await c.openItem("dc-hosts");
      const a = await admitVm(c, { vm: h.vm, ttlHours: h.ttlHours, priceMicrosPerHour: h.priceMicrosPerHour, stage: "hosts", controller: true, run: h.role + " host " + h.vm });
      if (a.kind !== "admitted") return this.stopForCaptain("the " + h.role + " host " + h.vm + " was not admitted on dc-hosts: " + a.kind + ": " + a.why);
    }
  }

  /** Stops every item for the Captain and records why, durably, on this host. */
  async stopForCaptain(why: string): Promise<void> {
    if (this.captain) return;
    this.captain = { why, at: this.now().toISOString() };
    const items = this.controller.toJSON().items;
    for (const item of this.controller.openItems()) {
      this.priorPauses.set(item, items.find(([i]) => i === item)?.[1].paused ?? null);
      await this.controller.pause(item, "stopped for the Captain: " + why, { captain: true });
    }
    writeAtomic(join(this.cfg.stateDir, "captain.json"), JSON.stringify(this.captain) + "\n");
    this.writeStatus();
  }

  /** The Captain's resume: a verified snapshot restarts the chain, then each item gets its earlier pause back or none. */
  async resumeForCaptain(): Promise<void> {
    if (!this.captain) return;
    await this.snapshot();
    for (const item of this.controller.openItems()) {
      await this.controller.resume(item, { captain: true });
      const prior = this.priorPauses.get(item);
      if (prior) await this.controller.pause(item, prior.why, { allowTag: prior.allowTag, captain: prior.captain });
    }
    this.priorPauses.clear();
    renameSync(join(this.cfg.stateDir, "captain.json"), join(this.cfg.stateDir, "captain-" + this.now().toISOString().replace(/[:.]/g, "-") + ".json"));
    this.captain = null;
    this.writeStatus();
  }

  /** One turn of the service loop: a broken copy stops for the Captain; otherwise a due snapshot; then control files and status. */
  async tick(): Promise<string[]> {
    const done: string[] = [];
    if (!this.captain && this.wal.broken) await this.stopForCaptain("the write-ahead copy is broken: " + this.wal.broken);
    if (!this.captain && snapshotDue({ lastAt: this.lastSnapshot?.at ?? null, now: this.now(), settledSince: this.sig() === this.settledSig ? 0 : 1 })) {
      try {
        await this.snapshot();
      } catch (e) {
        await this.stopForCaptain("a snapshot did not verify off host: " + (e as Error).message);
      }
    }
    const control = join(this.cfg.stateDir, "control");
    for (const name of existsSync(control) ? readdirSync(control).sort() : []) {
      rmSync(join(control, name), { force: true });
      if (name === "resume-captain") {
        try {
          await this.resumeForCaptain();
          done.push(name);
        } catch (e) {
          done.push(name + " refused: " + (e as Error).message);
        }
      } else done.push(name);
    }
    this.writeStatus();
    return done;
  }

  /**
   * Deletes the controller host for a wait over 12 hours with nothing in flight (R2-3): its own hours settle at the
   * measured figure, every open item but dc-hosts settles, the off-host copy verifies, then deleteSelf removes the VM.
   * The WAL host keeps the copy and stays on dc-hosts; its hours settle at the relaunch or the teardown.
   */
  async idleDelete(waitHours: number, deleteSelf: (vm: string) => Promise<void>): Promise<{ deleted: boolean; why: string }> {
    const c = this.controller;
    const d = idleDelete(c, waitHours);
    if (!d.delete) return { deleted: false, why: d.why };
    if (this.captain) return { deleted: false, why: "a Captain stop stands: " + this.captain.why };
    const host = this.cfg.hosts.find((h) => h.role === "controller");
    if (!host) return { deleted: false, why: "the run names no controller host" };
    await settleHostVm(c, host, this.now().getTime());
    for (const item of c.openItems()) {
      if (item === "dc-hosts") continue;
      if (!(await c.settleItem(item))) return { deleted: false, why: item + " still has work in flight" };
    }
    await this.snapshot();
    this.writeStatus();
    await deleteSelf(host.vm);
    return { deleted: true, why: d.why + "; leases settled and the off-host copy verified" };
  }

  /**
   * Ends the run's money on this host: every item settles once drained (or, with force, every sub-reservation still in
   * flight is held as unknown at its full reservation first; the Captain's choice, off by default), the hosts settle at
   * measured hours, dc-hosts settles and a final snapshot verifies. Returns why it can't when work stays in flight.
   */
  async teardown(o: { force?: boolean; drainMs?: number } = {}): Promise<{ ok: true } | { ok: false; why: string }> {
    const c = this.controller;
    if (this.captain) return { ok: false, why: "a Captain stop stands: " + this.captain.why };
    for (const item of c.openItems()) {
      if (item === "dc-hosts") continue;
      if (o.force) for (const s of c.subsOf(item)) if (s.state === "in-flight") await c.markUnknown(s.id);
      if (await c.settleItem(item)) continue;
      const drained = await Promise.race([c.drained(item).then(() => true), Bun.sleep(o.drainMs ?? 0).then(() => false)]);
      if (!drained) return { ok: false, why: item + " still has work in flight" };
    }
    for (const h of this.cfg.hosts) await settleHostVm(c, h, this.now().getTime());
    await c.settleItem("dc-hosts");
    await this.snapshot();
    this.writeStatus();
    return { ok: true };
  }

  status(): ServiceStatus {
    const c = this.controller;
    return {
      pid: process.pid,
      runId: this.cfg.runId,
      boot: this.boot,
      startedAt: this.startedAt.toISOString(),
      at: this.now().toISOString(),
      watermark: this.wal.seq,
      lastSnapshot: this.lastSnapshot?.name ?? null,
      captain: this.captain,
      held: this.recovered.held,
      uncertainMicros: this.recovered.uncertainMicros,
      items: c.openItems().map((i) => c.figures(i)),
    };
  }

  writeStatus(): void {
    writeAtomic(join(this.cfg.stateDir, "status.json"), JSON.stringify(this.status()) + "\n");
  }

  close(): void {
    this.local.close();
  }
}

export type Opened = { ok: true; service: LedgerService } | { ok: false; captain: string };

/**
 * Boots the service from the off-host copy. leases binds the ledger seam (main's ledger by default; the wiring may
 * pass its admission rule).
 */
export async function openLedgerService(cfg: ServiceConfig, target: ServiceTarget, o: { now?: () => Date; leases?: (local: LocalLedger) => LeaseSeam } = {}): Promise<Opened> {
  const now = o.now ?? (() => new Date());
  for (const d of [cfg.stateDir, cfg.journalDir, cfg.holder]) mkdirSync(d, { recursive: true, mode: 0o700 });
  const refuse = (why: string): Opened => {
    const captain: CaptainStop = { why, at: now().toISOString() };
    writeAtomic(join(cfg.stateDir, "captain.json"), JSON.stringify(captain) + "\n");
    writeAtomic(join(cfg.stateDir, "status.json"), JSON.stringify({ pid: process.pid, runId: cfg.runId, at: captain.at, captain, booted: false }) + "\n");
    return { ok: false, captain: why };
  };
  let boot: Boot = "same-host";
  try {
    if (!existsSync(cfg.ledgerPath)) {
      const snap = await latestSnapshot(target);
      if (snap?.ledger) {
        if (!existsSync(cfg.record)) {
          const tar = target.getRecord ? await target.getRecord(snap.name) : null;
          if (!tar) return refuse("the off-host copy holds no approval record beside " + snap.name + ", and this host has none");
          extractRecord(cfg.record, tar);
        }
        restoreLedgerFile(snap, cfg.ledgerPath);
        boot = "restored";
      } else if (snap || (await target.lines()).length) return refuse("the off-host copy holds lines but no snapshot with a ledger, and this host has no ledger file");
      else boot = "fresh";
    }
    if (!existsSync(cfg.record)) return refuse("this host has no approval record at " + cfg.record);
  } catch (e) {
    return refuse("the off-host copy could not be read: " + (e as Error).message);
  }
  const local = LocalLedger.open(cfg.ledgerPath, now);
  const leases = o.leases?.(local) ?? mainLeases({ record: cfg.record, local });
  let rec: Awaited<ReturnType<typeof recover>>;
  try {
    rec = await recover(target, { runId: cfg.runId, holder: cfg.holder, leases, now });
  } catch (e) {
    local.close();
    return refuse("recovery could not read the off-host copy: " + (e as Error).message);
  }
  if (rec.kind === "captain") {
    local.close();
    return refuse(rec.why);
  }
  if (boot === "restored" && rec.reserves.length) await replayReserves(local, rec.reserves, join(cfg.journalDir, "recovery-" + now().toISOString().replace(/[:.]/g, "-") + ".ndjson"));
  let held = rec.held.length;
  let uncertainMicros = rec.uncertainMicros;
  if (boot === "same-host" && rec.held.length) {
    const scan = await settleFromJournals({ controller: rec.controller, local, wal: rec.wal, journalDir: cfg.journalDir, held: rec.held });
    writeScan(cfg.stateDir, now(), scan);
    const settled = new Set(scan.settled.map((s) => s.sub));
    held -= settled.size;
    uncertainMicros -= rec.held.filter((s) => settled.has(s.id)).reduce((a, s) => a + s.reserveMicros, 0);
  }
  const svc = new LedgerService(cfg, target, rec.controller, rec.wal, local, boot, { held, uncertainMicros }, now);
  const standing = join(cfg.stateDir, "captain.json");
  if (existsSync(standing)) await svc.stopForCaptain((JSON.parse(readFileSync(standing, "utf8")) as CaptainStop).why);
  if (!svc.captain) {
    await svc.admitHosts();
    if (!svc.captain) {
      try {
        await svc.snapshot();
      } catch (e) {
        await svc.stopForCaptain("the boot snapshot did not verify off host: " + (e as Error).message);
      }
    }
  }
  svc.writeStatus();
  return { ok: true, service: svc };
}
