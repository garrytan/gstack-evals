// Copyright (c) 2026 Garry Tan. MIT License.
// The controller host's entrypoint, started detached with setsid by controller-host.ts:
//   bun lanes/design-constructed/money/host-main.ts --config <state>/host.json
// It boots the ledger service from the off-host copy, writes its pid, ticks (snapshots, Captain stops, control files,
// status.json) until SIGTERM or a finished teardown, and runs the wiring's stage module in the same process so the rows
// and the money share one controller. Rows run one at a time: the config's stage at boot, then each row the launcher
// asks for in next/row.json (controller-host.ts sendRow) once the last one has ended. state/rows.json records each
// row's number, arguments, start, end, state and reason code, never its lines; each row's lines go to its own log in
// the work folder's .rows/, which is on tmpfs with the inputs and sinks (PD-41). stage.json holds the last row's end.
// Each row's log ends with the work folder's tmpfs use and the peak sampled on every tick while the row ran; rows.json
// and stage.json record both, and dc host next reads them before it sends a row (controller-host.ts tmpfsGuard).
// Keys reach this process only through its environment, read by name by the stage module; this file reads none.
import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { isReasonCode } from "../../../src/errors/codes.ts";
import { rowLog, tmpfsLine, workUse, type TmpfsUse } from "./controller-host.ts";
import { openLedgerService, type LedgerService, type ServiceConfig } from "./ledger-service.ts";
import { localWalTransport, RemoteTarget, sshWalTransport } from "./offhost.ts";

export type TargetConfig = { kind: "ssh"; host: string; keyPath: string; knownHosts: string; login?: string } | { kind: "local"; script: string; dir: string; timeoutMs?: number };

export interface HostConfig extends ServiceConfig {
  target: TargetConfig;
  /** BT: the service loop's turn. */
  tickMs?: number;
  /** How long a teardown waits for in-flight work to drain. */
  drainMs?: number;
  /** The host's work folder, a tmpfs mount: the uploaded inputs, every row's sink and every row's log (PD-41). */
  work: string;
  /** The wiring's module exporting runOnHost(service, args, row), run at boot in this process; null runs no row at boot. */
  stage?: { module: string; args: string[] } | null;
}

/** Where one row runs: the host's work folder and the row's own log, both on tmpfs. */
export interface HostRow {
  work: string;
  log: string;
}

/** What a stage module exports for the controller host. */
export interface HostStage {
  runOnHost(service: LedgerService, args: string[], row: HostRow): Promise<void>;
}

/** One row as state/rows.json records it: its arguments and reason code, never its lines (those stay on tmpfs). */
export interface RowRecord {
  n: number;
  id: string;
  /** The gstack-evals dc row's name. */
  row: string;
  args: string[];
  startedAt: string;
  endedAt: string | null;
  /** interrupted: the service stopped while the row ran. */
  state: "running" | "done" | "failed" | "interrupted";
  code: string | null;
  /** The work folder's tmpfs at the row's end and its peak while the row ran; null while it runs. */
  tmpfs?: TmpfsUse | null;
}

/** The launcher's request for the next row, written to next/row.json beside the service's own control folder. */
export interface RowRequest {
  id: string;
  stage: { module: string; args: string[] };
}

export const targetFor = (t: TargetConfig) => new RemoteTarget(t.kind === "ssh" ? sshWalTransport({ keyPath: t.keyPath, knownHosts: t.knownHosts, login: t.login }, t.host, undefined, join(dirname(t.keyPath), "wal-mux-%C")) : localWalTransport(t.script, t.dir, t.timeoutMs));

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
  mkdirSync(join(cfg.work, ".tmp"), { recursive: true, mode: 0o700 });
  process.env.TMPDIR = join(cfg.work, ".tmp");
  const rowsFile = join(cfg.stateDir, "rows.json");
  const rows: RowRecord[] = existsSync(rowsFile) ? JSON.parse(readFileSync(rowsFile, "utf8")) : [];
  const now = () => new Date().toISOString();
  for (const r of rows) if (r.state === "running") Object.assign(r, { state: "interrupted", endedAt: now() });
  writeJson(rowsFile, rows);
  let busy = false;
  let peak = 0;
  const startRow = (stage: RowRequest["stage"], id: string) => {
    const n = rows.length + 1;
    const log = rowLog(cfg.work, n);
    mkdirSync(dirname(log), { recursive: true, mode: 0o700 });
    rmSync(join(cfg.stateDir, "stage.json"), { force: true });
    const rec: RowRecord = { n, id, row: stage.args[1] ?? "", args: stage.args, startedAt: now(), endedAt: null, state: "running", code: null, tmpfs: null };
    rows.push(rec);
    writeJson(rowsFile, rows);
    busy = true;
    peak = workUse(cfg.work).usedBytes;
    const end = (code: string | null, why: string | null) => {
      if (why !== null) appendFileSync(log, why + "\n");
      const use = workUse(cfg.work);
      const tmpfs: TmpfsUse = { ...use, peakBytes: Math.max(peak, use.usedBytes) };
      appendFileSync(log, "tmpfs: " + tmpfsLine(tmpfs) + "\n");
      Object.assign(rec, { state: why === null ? "done" : "failed", endedAt: now(), code, tmpfs });
      writeJson(rowsFile, rows);
      writeJson(join(cfg.stateDir, "stage.json"), { n, done: why === null, code, at: rec.endedAt, tmpfs });
      busy = false;
    };
    import(resolve(stage.module))
      .then((m: HostStage) => m.runOnHost(svc, stage.args, { work: cfg.work, log }))
      .then(
        () => end(null, null),
        (e: Error & { code?: unknown }) => end(typeof e.code === "string" && isReasonCode(e.code) ? e.code : null, "row " + n + " failed: " + e.message),
      );
  };
  const control = join(cfg.stateDir, "control");
  const requests = join(cfg.stateDir, "next");
  const takeRequest = () => {
    const file = join(requests, "row.json");
    if (!existsSync(file)) return;
    let req: RowRequest | null = null;
    try {
      req = JSON.parse(readFileSync(file, "utf8")) as RowRequest;
    } catch {}
    rmSync(file, { force: true });
    if (!req || typeof req.id !== "string" || typeof req.stage?.module !== "string" || !Array.isArray(req.stage.args)) return;
    const refused = busy ? "row " + rows.at(-1)!.n + " still runs" : svc.captain ? "a Captain stop stands: " + svc.captain.why : null;
    if (refused) return writeJson(join(requests, "row-refused-" + req.id + ".json"), { why: refused, at: now() });
    startRow(req.stage, req.id);
  };
  if (cfg.stage) startRow(cfg.stage, randomUUID());
  const tickMs = cfg.tickMs ?? 30_000;
  const asked = () => existsSync(join(control, "teardown")) || existsSync(join(control, "teardown-force"));
  while (!stop) {
    let done: string[] = [];
    try {
      done = await svc.tick();
    } catch (e) {
      process.stderr.write("tick failed: " + (e as Error).message + "\n");
    }
    if (busy) peak = Math.max(peak, workUse(cfg.work).usedBytes);
    const teardown = done.find((d) => d === "teardown" || d === "teardown-force");
    if (teardown) {
      const r = await svc.teardown({ force: teardown === "teardown-force", drainMs: cfg.drainMs ?? 60_000 });
      writeJson(join(cfg.stateDir, "teardown.json"), { ...r, at: now() });
      if (r.ok) break;
    }
    for (let waited = 0; waited < tickMs && !stop && !asked(); waited += 200) {
      takeRequest();
      await Bun.sleep(Math.min(200, tickMs));
    }
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
