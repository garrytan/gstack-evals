// Copyright (c) 2026 Garry Tan. MIT License.
// The controller host's stage module (money/host-main.ts imports it and calls runOnHost in the ledger service's own
// process): one paid row, run on the real providers bound to that service, so its money, its proxies and its sessions
// live on the host that stays awake, never on a Capy machine. Its arguments are the wiring file, then the row's own
// arguments as gstack-evals dc takes them. The row's lines go to stage.log in the service's state folder; a row that
// exits non-zero throws, so host-main records it in stage.json. The checkout is the commit the host was launched at,
// unpacked from git archive under the host's root beside its commit file.
import { appendFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { main, realEnv } from "../cli.ts";
import { fail } from "../errors.ts";
import type { HostStage } from "../money/host-main.ts";
import type { LedgerService } from "../money/ledger-service.ts";
import { readWiring, type HostContext } from "./real.ts";

export const HOST_STAGE_MODULE = "lanes/design-constructed/wire/host.ts";

/** The plan's stage field for one paid row (money/controller-host.ts ControllerPlan.stage). */
export const hostStage = (wiring: string, row: readonly string[]): { module: string; args: string[] } => ({ module: HOST_STAGE_MODULE, args: [wiring, ...row] });

/** The host's checkout: the unpacked archive at the commit the launcher wrote; an archive has no working tree to dirty. */
export function hostLane(root: string): () => { commit: string; dirty: boolean; root: string } {
  return () => ({ commit: readFileSync(join(root, "commit"), "utf8").trim(), dirty: false, root: join(root, "repo") });
}

/** The real providers' context on a service: the wiring file, the service's own environment and its host root. */
export function hostContext(service: LedgerService, wiringPath: string, env: Readonly<Record<string, string | undefined>> = process.env): HostContext {
  const root = dirname(service.cfg.stateDir);
  return { service, wiring: readWiring(wiringPath), env, dir: join(root, "wire"), lane: hostLane(root) };
}

export const runOnHost: HostStage["runOnHost"] = async (service, args) => {
  const [wiring, ...row] = args;
  if (!wiring || !row.length) fail("E_USAGE", "runOnHost takes the wiring file, then one gstack-evals dc row and its arguments");
  const ctx = hostContext(service, wiring!);
  const log = join(service.cfg.stateDir, "stage.log");
  const line = (t: string) => appendFileSync(log, t + "\n");
  const code = await main(row, { out: line, err: line }, () => realEnv(ctx));
  if (code !== 0) throw new Error("gstack-evals dc " + row[0] + " exited " + code + "; " + log + " holds its lines");
};
