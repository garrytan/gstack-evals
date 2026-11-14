// Copyright (c) 2026 Garry Tan. MIT License.
// The money area's dry-run cases for the controller host: the off-host target's acknowledged appends through walctl
// (a local SSH stand-in), a copy that fails or lags stopping the controller for the Captain, a relaunch keeping the
// ledger file and a lost host restoring it, and a launch that fails partway deleting every VM it made on the simulated
// Ubicloud. No key, no network, no VM.
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeBackend, fakeWorld } from "../stage3/fake.ts";
import { runProcess } from "../stage3/ubicloud-real.ts";
import type { DryRunCase } from "../types.ts";
import { $ } from "./book.ts";
import { launch, repoBundle, repoTree, serviceEnv } from "./controller-host.ts";
import { commitAll, expectations, makeRecord } from "./dryrun-fixture.ts";
import { openLedgerService, recordTar, type ServiceConfig } from "./ledger-service.ts";
import { localWalTransport, RemoteTarget, WALCTL_PY, type WalTransport } from "./offhost.ts";
import { chainAfter, GENESIS, WriteAhead } from "./wal.ts";

async function withTemp(fn: (dir: string) => Promise<string | null>): Promise<string | null> {
  const dir = mkdtempSync(join(tmpdir(), "dc-host-dry-"));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function walIn(dir: string): Promise<{ script: string; data: string; transport: WalTransport }> {
  const script = join(dir, "walctl.py");
  writeFileSync(script, WALCTL_PY);
  const data = join(dir, "wal");
  mkdirSync(data, { recursive: true });
  const transport = localWalTransport(script, data, 10_000);
  if ((await transport(["init"])).exit !== 0) throw new Error("walctl init failed");
  return { script, data, transport };
}

function serviceCfg(dir: string): ServiceConfig {
  mkdirSync(join(dir, "host", "ledger"), { recursive: true });
  const record = makeRecord(join(dir, "host", "ledger"));
  const t = new Date(Date.UTC(2026, 10, 14)).toISOString();
  return {
    runId: "dc-dryrun-host",
    holder: join(dir, "host", "holders", "dc-dryrun-host"),
    record,
    ledgerPath: join(dir, "host", "ledger", "ledger.sqlite"),
    journalDir: join(dir, "host", "journals"),
    stateDir: join(dir, "host", "state"),
    hosts: [
      { vm: "dcwal-dry", role: "wal", ttlHours: 30, priceMicrosPerHour: $(0.02), createdAt: t },
      { vm: "dcctl-dry", role: "controller", ttlHours: 30, priceMicrosPerHour: $(0.06), createdAt: t },
    ],
  };
}

export function controllerHostCases(): DryRunCase[] {
  return [
    {
      rule: "R2-4",
      name: "the off-host target answers each append only after its fsynced write, and its lines read back as one chain",
      check: () =>
        withTemp(async (dir) => {
          const w = await walIn(dir);
          const target = new RemoteTarget(w.transport);
          const wal = new WriteAhead(target);
          for (let i = 0; i < 3; i++) await wal.append({ kind: "admit", n: i });
          const chain = chainAfter(await target.lines(), 0, GENESIS);
          return "lines" in chain && chain.lines.length === 3 ? null : "the copy read back as " + JSON.stringify(chain);
        }),
    },
    {
      rule: "R2-4",
      name: "a write-ahead target that fails or lags stops the controller for the Captain, and only the Captain's resume restarts it",
      check: () =>
        withTemp(async (dir) => {
          const e = expectations();
          const w = await walIn(dir);
          const mode = { now: "ok" as "ok" | "fail" | "lag" };
          const transport: WalTransport = async (args, input) => {
            if (mode.now === "fail" && args[0] === "append") return { exit: 1, stdout: new Uint8Array(), stderr: "down", timedOut: false };
            if (mode.now === "lag" && args[0] === "append") return runProcess(["bash", "-c", "sleep 5"], { timeoutMs: 150 });
            return w.transport(args, input);
          };
          const cfg = serviceCfg(dir);
          const o = await openLedgerService(cfg, new RemoteTarget(transport));
          if (!o.ok) return "the service did not boot: " + o.captain;
          const svc = o.service;
          try {
            await svc.controller.openItem("dc-authoring-1");
            for (const fault of ["fail", "lag"] as const) {
              mode.now = fault;
              const a = await svc.controller.admitCall("dc-authoring-1", { run: "author " + fault, model: "argon", worstCaseMicros: $(1) });
              e.want(a.kind === "unacked", fault + ": the admission read " + a.kind);
              await svc.tick();
              e.want(svc.captain !== null, fault + ": no Captain stop");
              mode.now = "ok";
              await svc.tick();
              e.want(svc.wal.broken !== null, fault + ": the chain restarted without the Captain");
              mkdirSync(join(cfg.stateDir, "control"), { recursive: true });
              writeFileSync(join(cfg.stateDir, "control", "resume-captain"), "");
              await svc.tick();
              e.want(svc.captain === null && svc.wal.broken === null, fault + ": the Captain's resume did not restart the chain");
            }
          } finally {
            svc.close();
          }
          return e.result();
        }),
    },
    {
      rule: "R2-3",
      name: "a relaunch on the same host keeps the ledger file and its lease; a lost host restores both from the copy",
      check: () =>
        withTemp(async (dir) => {
          const e = expectations();
          const w = await walIn(dir);
          const cfg = serviceCfg(dir);
          const boot = async () => {
            const o = await openLedgerService(cfg, new RemoteTarget(w.transport));
            if (!o.ok) throw new Error("the service did not boot: " + o.captain);
            return o.service;
          };
          const first = await boot();
          const lease = first.controller.lease("dc-hosts")?.leaseId;
          first.close();
          const ino = statSync(cfg.ledgerPath).ino;
          const same = await boot();
          e.want(same.boot === "same-host" && statSync(cfg.ledgerPath).ino === ino && same.controller.lease("dc-hosts")?.leaseId === lease, "the same-host relaunch lost the ledger or its lease");
          same.close();
          rmSync(join(dir, "host"), { recursive: true, force: true });
          const restored = await boot();
          const unknown = restored.controller.figures("dc-hosts").unknownMicros;
          e.want(restored.boot === "restored" && restored.controller.lease("dc-hosts")?.leaseId === lease && unknown === Math.ceil(30 * $(0.02)) + Math.ceil(30 * $(0.06)), "the lost host did not restore: " + restored.boot + ", unknown " + unknown);
          restored.close();
          return e.result();
        }),
    },
    {
      rule: "R2-3",
      name: "a controller host launch that fails partway deletes every VM it made on the simulated Ubicloud, the WAL host made on burstable-1",
      check: () =>
        withTemp(async (dir) => {
          const w = fakeWorld({
            ssh: async (_vm, command, input) => {
              const r = await runProcess(["bash", "-c", command], { input, timeoutMs: 30_000 });
              return { exit: r.exit, stdout: new TextDecoder().decode(r.stdout), stderr: r.stderr, raw: r.stdout };
            },
          });
          mkdirSync(join(dir, "approval"), { recursive: true });
          const record = makeRecord(join(dir, "approval"));
          mkdirSync(join(dir, "repo"));
          writeFileSync(join(dir, "repo", "README.md"), "fixture repository\n");
          const commit = commitAll(join(dir, "repo"), dir);
          let why = "";
          const backend = fakeBackend(w);
          const create = backend.create.bind(backend);
          const sizes: Array<string | undefined> = [];
          backend.create = (spec, o) => (sizes.push(o?.size), create(spec, o));
          try {
            await launch(backend, { runId: "dc-dryrun-host", owner: "dry-owner", longestStageHours: 24, ttlHours: 30, priceMicrosPerHour: { controller: 60_000, wal: 20_000 }, commit, tree: repoTree(join(dir, "repo"), commit), repoBundle: repoBundle(join(dir, "repo"), commit), recordTar: recordTar(record), root: join(dir, "host"), wal: { dir: join(dir, "wal"), script: join(dir, "walctl.py"), owner: null, authorizedKeys: join(dir, "authorized_keys") }, provision: () => ["exit 9"], bun: process.execPath, recipient: "age1" + "q".repeat(58) }, serviceEnv({ ANTHROPIC_API_KEY: "x", OPENAI_API_KEY: "x", OPENROUTER_API_KEY: "x", UBICLOUD_API_KEY: "x" }, "dry-owner"));
          } catch (err) {
            why = (err as Error).message;
          }
          const left = w.vms.filter((v) => !w.deleted.includes(v.id)).map((v) => v.id);
          return why.includes("provisioning the controller host failed") && w.vms.length === 2 && left.length === 0 && sizes[0] === "burstable-1" ? null : "launch read '" + why + "'; left " + left.join(", ") + "; the WAL host was made on " + sizes[0];
        }),
    },
  ];
}
