// The metering proxy inside its container (U9). The evaluator writes config.json into the proxy's directory, mounts
// that directory, the local ledger's directory and gstack-evals' src read-only, and passes the provider keys and the
// management credential through the proxy env allowlist. The trial listener binds the container's address on the
// internal trial network; the management socket sits in the mounted directory, on the evaluator side only.
import { readFileSync } from "node:fs";
import { openLocalLedger } from "../runner/ledger/local.ts";
import { MeteringProxy, type RetryBudget } from "../runner/proxy/metering-proxy.ts";

export interface ProxyConfig {
  lease_id: string;
  /** The local SQLite ledger, at the same path as on the evaluator. */
  ledger: string;
  journal: string;
  socket: string;
  host: string;
  port: number;
  retry: RetryBudget;
}

if (import.meta.main) {
  const config = JSON.parse(readFileSync(process.argv[2]!, "utf8")) as ProxyConfig;
  const proxy = new MeteringProxy({
    ledger: openLocalLedger({ path: config.ledger, rule: "the run's local ledger" }),
    leaseId: config.lease_id,
    host: config.host,
    port: config.port,
    managementSocket: config.socket,
    managementToken: process.env.GSTACK_EVALS_PROXY_TOKEN ?? "",
    journal: config.journal,
    retry: config.retry,
    env: process.env,
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
