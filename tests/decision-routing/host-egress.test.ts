// Copyright (c) 2026 Garry Tan. MIT License.
// The runner's egress smoke judges by bytes exchanged (host/egress_probe.py, host/egress-smoke.sh): Harbor's sidecar
// accepts every TCP connect and resets what it doesn't allow, so a listener that accepts and sends nothing must read
// closed and only one that answers reads open; the smoke's verdict follows those readings, and its job puts the proxy
// host on the agent's allowlist as controller.ts harborJob does.
import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOST = join(import.meta.dir, "../../lanes/decision-routing/host");
const dirs: string[] = [];
const servers: Server[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  for (const s of servers.splice(0)) s.close();
});

const listen = (onConn: (c: Socket) => void) =>
  new Promise<number>((done) => {
    const s = createServer(onConn);
    servers.push(s);
    s.listen(0, "127.0.0.1", () => done((s.address() as { port: number }).port));
  });
const freePort = async () => {
  const port = await listen(() => {});
  servers.pop()!.close();
  return port;
};
const probe = async (port: number) => {
  const p = Bun.spawn(["python3", join(HOST, "egress_probe.py"), "127.0.0.1", String(port)], { stdout: "pipe" });
  await p.exited;
  return (await new Response(p.stdout).text()).trim();
};

describe("egress probe", () => {
  test("a listener that accepts the connect and then drops it without a byte reads as zero bytes", async () => {
    const dropped = await listen((c) => c.destroy());
    const silent = await listen((c) => c.once("data", () => c.end()));
    expect(await probe(dropped)).toMatch(/^bytes=0 /);
    expect(await probe(silent)).toMatch(/^bytes=0 /);
  });

  test("a refused connect reads as zero bytes, and a listener that answers reads as bytes", async () => {
    expect(await probe(await freePort())).toMatch(/^bytes=0 connect:/);
    const http = await listen((c) => c.once("data", () => c.end("HTTP/1.0 200 OK\r\n\r\nok")));
    expect(await probe(http)).toMatch(/^bytes=[1-9][0-9]* data$/);
  });
});

describe("egress-smoke.sh verdict", () => {
  const GOOD: Record<string, string> = {};
  for (const u of ["root", "10001"]) {
    GOOD["proxy_as_" + u] = "open";
    for (const n of ["host_off_port", "closed_example_com_80", "closed_1_1_1_1_80", "closed_pypi_org_443"]) GOOD[n + "_as_" + u] = "closed";
  }
  const smoke = async (readings: Record<string, string>) => {
    const dir = mkdtempSync(join(tmpdir(), "dr-egress-"));
    dirs.push(dir);
    mkdirSync(join(dir, "bin"));
    mkdirSync(join(dir, "task"));
    writeFileSync(join(dir, "readings.json"), JSON.stringify(readings));
    writeFileSync(join(dir, "bin", "harbor"), '#!/usr/bin/env bash\njobs=$(python3 -c \'import json,sys; print(json.load(open(sys.argv[1]))["jobs_dir"])\' "$3")\nmkdir -p "$jobs/egress-smoke/t/agent"\ncp "$DR_TEST_READINGS" "$jobs/egress-smoke/t/agent/egress.json"\n');
    chmodSync(join(dir, "bin", "harbor"), 0o755);
    const r = Bun.spawnSync(["bash", join(HOST, "egress-smoke.sh"), join(dir, "task"), join(dir, "out"), "127.0.0.1", String(await freePort()), String(await freePort())], { env: { ...process.env, PATH: join(dir, "bin") + ":" + process.env.PATH, DR_TEST_READINGS: join(dir, "readings.json") } });
    return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString(), job: JSON.parse(readFileSync(join(dir, "out", "job.json"), "utf8")) };
  };

  test("the proxy answering and every other path silent, as root and as uid 10001, passes; the job allowlists the proxy host for the agent only", async () => {
    const r = await smoke(GOOD);
    expect(r.code).toBe(0);
    expect(r.out).toContain("egress smoke: the proxy stand-in 127.0.0.1:");
    expect(r.job.agents[0].extra_allowed_hosts).toEqual(["127.0.0.1"]);
    expect(r.job.environment.extra_allowed_hosts).toBeUndefined();
  });

  test("bytes back from a path that must be closed exit 1 with E_DR_RUNNER", async () => {
    for (const key of ["closed_pypi_org_443_as_10001", "closed_example_com_80_as_root", "host_off_port_as_root"]) {
      const r = await smoke({ ...GOOD, [key]: "open" });
      expect(r.code).toBe(1);
      expect(r.err).toContain("E_DR_RUNNER: " + key.replace(/_as_.*$/, "") + " reads open");
    }
  });

  test("a silent proxy, or a probe that can't be judged, exits 2", async () => {
    const changes: Array<Record<string, string>> = [{ proxy_as_root: "closed" }, { proxy_as_10001: "error" }, { closed_1_1_1_1_80_as_root: "error" }];
    for (const change of changes) {
      const r = await smoke({ ...GOOD, ...change });
      expect(r.code).toBe(2);
      expect(r.err).toContain("E_DR_RUNNER: ");
    }
  }, 30_000);
});
