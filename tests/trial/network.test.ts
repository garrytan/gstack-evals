import { afterAll, describe, expect, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MeteringProxy, reconcileJournal } from "../../src/runner/proxy/metering-proxy.ts";
import type { CallOutcome, LedgerReply, ReservationLedger } from "../../src/types.ts";
import { removeTree } from "../../src/trial/cleanup.ts";
import { trialEnv } from "../../src/trial/env.ts";
import { buildTrialImage } from "../../src/trial/image.ts";
import { createTrialNetwork, recoverRun, removeTrialNetwork, startProxyContainer } from "../../src/trial/proxy.ts";
import { dockerSandbox } from "../../src/trial/sandbox.ts";

const DOCKER = process.env.GSTACK_EVALS_DOCKER === "1";
const roots: string[] = [];
const scratch = (name: string) => {
  const dir = mkdtempSync(join(tmpdir(), "gse-" + name + "-"));
  roots.push(dir);
  return dir;
};
afterAll(() => roots.forEach((r) => removeTree(r)));

/** Records every settle, in order, beside the test's own steps. */
class OrderLedger implements ReservationLedger {
  constructor(private order: string[]) {}
  async reserve(): Promise<LedgerReply> {
    return { ok: false, code: "CAP_STOP", message: "no reserves in this test" };
  }
  async settle(reservation_id: string, outcome: CallOutcome): Promise<LedgerReply> {
    this.order.push("reconcile " + reservation_id + " " + outcome.kind);
    return { ok: true, reservation: { reservation_id, idempotency_key: "k", lease_id: "lease", cell: { run_id: "r", arm: "a", task: "t", model: "m", trial: 0, attempt: 1, meter_id: "m_1" }, max_micros: 5, state: "unknown", spent_micros: null, usage: null } };
  }
}

/** A journal holding one sent call whose outcome was lost. */
function journalWithLostCall(dir: string): string {
  const path = join(dir, "journal.ndjson");
  writeFileSync(path, JSON.stringify({ kind: "request", reservation_id: "res_1", idempotency_key: "k1", lease_id: "lease", cell: { run_id: "r", arm: "a", task: "t", model: "m", trial: 0, attempt: 1, meter_id: "m_1" }, max_micros: 5 }) + "\n");
  return path;
}

describe("resume order", () => {
  // Value: protects=resume stops the proxy before it reconciles the journal, and settles the lease last; fails_when=reconcile runs beside a live proxy or the lease settles before reconcile, closing lost-answer holds as unknown at full charge; why_new=GSTA-28's note on #39 (Captain brief item 9); seam=recoverRun; no_claim=the resume CLI, which U10 builds
  test("stop the proxy, then reconcile its journal, then settle the lease", async () => {
    const dir = scratch("resume");
    const journal = journalWithLostCall(dir);
    const order: string[] = [];
    const ledger = new OrderLedger(order);
    const proxy = new MeteringProxy({ ledger, leaseId: "lease", host: "127.0.0.1", managementSocket: join(dir, "m.sock"), managementToken: "t".repeat(32), journal, retry: { attempts: 1, elapsed_ms: 1000 } });
    proxy.start();
    await expect(reconcileJournal(journal, ledger)).rejects.toThrow(/held by another proxy or reconcile/);
    const r = await recoverRun({ stopProxy: () => (order.push("stop proxy"), proxy.stop()), journal, ledger, settle: () => (order.push("settle lease"), "closed") });
    expect(order).toEqual(["stop proxy", "reconcile res_1 unknown", "settle lease"]);
    expect(r).toMatchObject({ reconciled: { unknown: ["res_1"] }, settled: "closed" });
  });
});

describe.skipIf(!DOCKER)("trial network (Docker tier, GSTACK_EVALS_DOCKER=1)", () => {
  // Value: protects=an agent container reaches the metering proxy and nothing else: no outside IP this machine reaches, no DNS, no gateway, no host service on the internal bridge, no management socket, no provider key; and the proxy container holds its journal's flock; fails_when=any probe gets out, the key or management token enters the agent env, reconcile runs beside the containerized proxy, or a stale management socket passes for a proxy that failed to start; why_new=U9 scope (internal network, dual-homed proxy) and Captain brief items 9 and 10; seam=createTrialNetwork, startProxyContainer, recoverRun; no_claim=metered calls through the container, which U3's fake-upstream tests cover in process
  test("the agent reaches only the proxy, which is dual-homed and holds its journal", async () => {
    const state = scratch("net-state");
    const built = buildTrialImage({ state });
    if (!built.ok) throw new Error(built.message);
    const net = createTrialNetwork();
    const dir = scratch("proxy");
    mkdirSync(join(dir, "ledger"));
    const fakeKey = "sk-test-not-a-real-key-" + "z".repeat(12);
    const proxy = startProxyContainer({ image: built.tag, net, dir: join(dir, "proxy"), ledger: join(dir, "ledger", "ledger.sqlite"), leaseId: "lease_test", managementToken: "m".repeat(32), retry: { attempts: 1, elapsed_ms: 1000 }, providerKeys: { ANTHROPIC_API_KEY: fakeKey } });
    const work = scratch("net-work");
    const sandbox = dockerSandbox({ trialImage: built.tag });
    const agent = sandbox.agent("probe", { work, network: net.name, env: trialEnv("agent", { PATH: "/usr/local/bin:/usr/bin:/bin", HOME: "/home/agent", LANG: "C.UTF-8", TERM: "dumb", ANTHROPIC_BASE_URL: proxy.baseUrl, ANTHROPIC_API_KEY: "gse_" + "x".repeat(43) }, [], { ANTHROPIC_API_KEY: fakeKey }) });
    try {
      const gateway = spawnSync("docker", ["network", "inspect", "-f", "{{(index .IPAM.Config 0).Gateway}}", net.egress], { encoding: "utf8" }).stdout.trim();
      const probe = (c: string) => agent.exec(c, 60_000).stdout.trim();
      expect(probe('curl -s -m 10 -o /dev/null -w "%{http_code}" -H "x-api-key: $ANTHROPIC_API_KEY" "$ANTHROPIC_BASE_URL/v1/models"')).toMatch(/^40[13]$/);
      const outside = spawnSync("getent", ["ahostsv4", "example.com"], { encoding: "utf8" }).stdout.trim().split(/\s+/)[0];
      expect(outside).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
      expect(spawnSync("curl", ["-s", "-m", "10", "-o", "/dev/null", "-w", "%{http_code}", "http://" + outside + "/"], { encoding: "utf8" }).stdout).not.toBe("000");
      expect(probe("curl -s -m 5 -o /dev/null -w '%{http_code}' http://" + outside + "/; true")).toBe("000");
      expect(probe("curl -s -m 5 -o /dev/null -w '%{http_code}' http://" + gateway + "/; true")).toBe("000");
      const port = 20_000 + Math.floor(Math.random() * 10_000);
      const host = spawn(process.execPath, ["-e", "Bun.serve({ hostname: '0.0.0.0', port: " + port + ", fetch: () => new Response('host') }); setInterval(() => {}, 1e6)"], { stdio: "ignore" });
      try {
        let served = "";
        for (let i = 0; i < 50 && served !== "200"; i++, Bun.sleepSync(100)) served = spawnSync("curl", ["-s", "-m", "2", "-o", "/dev/null", "-w", "%{http_code}", "http://127.0.0.1:" + port + "/"], { encoding: "utf8" }).stdout;
        expect(served).toBe("200");
        const bridge = net.subnet.replace(/0\/24$/, "1");
        expect(probe("curl -s -m 5 -o /dev/null -w '%{http_code}' http://" + bridge + ":" + port + "/; true")).toBe("000");
      } finally {
        host.kill();
      }
      expect(probe("getent hosts example.com >/dev/null && echo RESOLVED || echo NODNS")).toBe("NODNS");
      expect(probe("ls " + JSON.stringify(proxy.socket) + " 2>&1; true")).toContain("No such file or directory");
      const env = probe("env");
      expect(env).not.toContain(fakeKey);
      expect(env).not.toContain("GSTACK_EVALS_PROXY_TOKEN");
      const networks = spawnSync("docker", ["inspect", "-f", "{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}", proxy.container], { encoding: "utf8" }).stdout.trim().split(" ").toSorted();
      expect(networks).toEqual([net.egress, net.name].toSorted());
      const order: string[] = [];
      const ledger = new OrderLedger(order);
      await expect(reconcileJournal(proxy.journal, ledger)).rejects.toThrow(/held by another proxy or reconcile/);
      const r = await recoverRun({ stopProxy: () => proxy.stop(), journal: proxy.journal, ledger, settle: () => "closed" });
      expect(r.settled).toBe("closed");
      expect(existsSync(proxy.socket)).toBe(true);
      writeFileSync(join(dir, "ledger", "not-a-dir"), "a file where the ledger's directory should be\n");
      expect(() => startProxyContainer({ image: built.tag, net, dir: join(dir, "proxy"), ledger: join(dir, "ledger", "not-a-dir", "ledger.sqlite"), leaseId: "lease_test", managementToken: "m".repeat(32), retry: { attempts: 1, elapsed_ms: 1000 }, timeoutMs: 20_000 })).toThrow(/the proxy container did not come up/);
    } finally {
      agent.stop();
      proxy.stop();
      removeTrialNetwork(net);
    }
  }, 900_000);
});
