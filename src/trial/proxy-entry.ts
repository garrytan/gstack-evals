// The metering proxy inside its container (U9). The evaluator writes config.json into the proxy's directory, mounts
// that directory, the local ledger's directory and gstack-evals' src read-only, and passes the provider keys and the
// management credential through the proxy env allowlist. The trial listener binds the container's address on the
// internal trial network; the management socket sits in the mounted directory, on the evaluator side only.
import { readFileSync } from "node:fs";
import { openLocalLedger } from "../runner/ledger/local.ts";
import { MeteringProxy, type RetryBudget } from "../runner/proxy/metering-proxy.ts";
import { relayedLedger } from "./write-ahead.ts";

export interface ProxyConfig {
  lease_id: string;
  /** The local SQLite ledger, at the same path as on the evaluator. */
  ledger: string;
  journal: string;
  socket: string;
  host: string;
  port: number;
  retry: RetryBudget;
  /** Off by default: the evaluator's write-ahead relay socket, in the mounted directory; every reserve waits for its acknowledgment (write-ahead.ts). */
  write_ahead_socket?: string;
  /** Off by default: OpenRouter outcome lines carry served_provider and generation_id (ProxyOptions.servedProvider). */
  served_provider?: boolean;
}

if (import.meta.main) {
  const config = JSON.parse(readFileSync(process.argv[2]!, "utf8")) as ProxyConfig;
  const local = openLocalLedger({ path: config.ledger, rule: "the run's local ledger" });
  const proxy = new MeteringProxy({
    ledger: config.write_ahead_socket ? relayedLedger(local, config.write_ahead_socket) : local,
    leaseId: config.lease_id,
    host: config.host,
    port: config.port,
    managementSocket: config.socket,
    managementToken: process.env.GSTACK_EVALS_PROXY_TOKEN ?? "",
    journal: config.journal,
    retry: config.retry,
    env: process.env,
    ...(config.served_provider ? { servedProvider: true } : {}),
  });
  proxy.start();
  console.log("PROXY_READY " + config.host + ":" + proxy.port);
  const stop = () => {
    proxy.stop();
    process.exit(0);
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}
