// Copyright (c) 2026 Garry Tan. MIT License.
// The controller host's entrypoint, started detached with setsid by controller-host.ts:
//   bun lanes/design-constructed/money/host-main.ts --config <state>/host.json
// It boots the ledger service from the off-host copy, writes its pid, ticks (snapshots, Captain stops, control files,
// status.json) until SIGTERM or a finished teardown, and runs the wiring's stage module, when the config names one, in
// the same process so the stages and the money share one controller. Keys reach this process only through its
// environment, read by name by the stage module; this file reads none.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openLedgerService, type LedgerService, type ServiceConfig } from "./ledger-service.ts";
import { localWalTransport, RemoteTarget, sshWalTransport } from "./offhost.ts";

export type TargetConfig = { kind: "ssh"; host: string; keyPath: string; knownHosts: string; login?: string } | { kind: "local"; script: string; dir: string; timeoutMs?: number };

export interface HostConfig extends ServiceConfig {
  target: TargetConfig;
  /** BT: the service loop's turn. */
  tickMs?: number;
  /** How long a teardown waits for in-flight work to drain. */
  drainMs?: number;
  /** The wiring's module exporting runOnHost(service, args), run in this process; null holds the money only. */
  stage?: { module: string; args: string[] } | null;
}

/** What a stage module exports for the controller host. */
export interface HostStage {
  runOnHost(service: LedgerService, args: string[]): Promise<void>;
}

export const targetFor = (t: TargetConfig) => new RemoteTarget(t.kind === "ssh" ? sshWalTransport({ keyPath: t.keyPath, knownHosts: t.knownHosts, login: t.login }, t.host) : localWalTransport(t.script, t.dir, t.timeoutMs));

const writeJson = (path: string, v: unknown) => {
  writeFileSync(path + ".tmp", JSON.stringify(v) + "\n", { mode: 0o600 });
  renameSync(path + ".tmp", path);
};

export async function main(argv: string[]): Promise<number> {
  const at = argv.indexOf("--config");
  if (at < 0 || !argv[at + 1]) {
    process.stderr.write("E_USAGE host-main needs --config <path>\n");
    return 2;
  }
  const cfg = JSON.parse(readFileSync(argv[at + 1]!, "utf8")) as HostConfig;
  mkdirSync(cfg.stateDir, { recursive: true, mode: 0o700 });
  const pidFile = join(cfg.stateDir, "controller.pid");
  writeFileSync(pidFile, String(process.pid) + "\n");
  rmSync(join(cfg.stateDir, "teardown.json"), { force: true });
  let stop = false;
  process.on("SIGTERM", () => {
    stop = true;
  });
  const opened = await openLedgerService(cfg, targetFor(cfg.target));
  if (!opened.ok) {
    process.stderr.write("stopped for the Captain: " + opened.captain + "\n");
    rmSync(pidFile, { force: true });
    return 3;
  }
  const svc = opened.service;
  if (cfg.stage) {
    const stage = cfg.stage;
    import(stage.module)
      .then((m: HostStage) => m.runOnHost(svc, stage.args))
      .then(() => writeJson(join(cfg.stateDir, "stage.json"), { done: true, at: new Date().toISOString() }))
      .catch((e: Error) => writeJson(join(cfg.stateDir, "stage.json"), { done: false, error: e.message, at: new Date().toISOString() }));
  }
  const tickMs = cfg.tickMs ?? 30_000;
  while (!stop) {
    const done = await svc.tick();
    const teardown = done.find((d) => d === "teardown" || d === "teardown-force");
    if (teardown) {
      const r = await svc.teardown({ force: teardown === "teardown-force", drainMs: cfg.drainMs ?? 60_000 });
      writeJson(join(cfg.stateDir, "teardown.json"), { ...r, at: new Date().toISOString() });
      if (r.ok) break;
    }
    for (let waited = 0; waited < tickMs && !stop && !existsSync(join(cfg.stateDir, "control", "teardown")) && !existsSync(join(cfg.stateDir, "control", "teardown-force")); waited += 200) await Bun.sleep(Math.min(200, tickMs));
  }
  if (!svc.captain) {
    try {
      await svc.snapshot();
    } catch (e) {
      await svc.stopForCaptain("the last snapshot did not verify off host: " + (e as Error).message);
    }
  }
  svc.writeStatus();
  svc.close();
  rmSync(pidFile, { force: true });
  return 0;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
