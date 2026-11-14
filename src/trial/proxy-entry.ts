// The metering proxy inside its container (U9). The evaluator writes config.json into the proxy's directory, mounts
// that directory, the local ledger's directory and gstack-evals' src read-only, and passes the provider keys and the
// management credential through the proxy env allowlist. The trial listener binds the container's address on the
// internal trial network; the management socket sits in the mounted directory, on the evaluator side only. A config's
// upstream, which only keyless end-to-end checks set, sends every upstream call to that base URL instead.
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
  /** Test only: a base URL every upstream call goes to in place of the provider's, keeping its path, so a keyless end-to-end check can stand a stub model server behind the real proxy container. A paid run never sets it. */
  upstream?: string;
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
    ...(config.upstream ? { fetch: (url: string, init: RequestInit) => fetch(config.upstream!.replace(/\/+$/, "") + new URL(url).pathname + new URL(url).search, init) } : {}),
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
