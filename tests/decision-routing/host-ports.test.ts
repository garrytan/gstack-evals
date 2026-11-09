// Copyright (c) 2026 Garry Tan. MIT License.
// The proxy port check the controller runs at batch start (Captain's condition on the runner's container firewall): on
// TCP PROXY_PORT_FIRST to PROXY_PORT_FIRST + PROXY_PORT_COUNT - 1, the batch's own proxies must be the only listeners, and
// each of its proxies on that range must be seen listening, else DR_PROXY_PORT_BUSY. listeningPorts reads /proc/net/tcp*.

import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkProxyListeners, ControllerError, listeningPorts, PROXY_PORT_COUNT, PROXY_PORT_FIRST } from "../../lanes/decision-routing/host/controller.ts";

const LAST = PROXY_PORT_FIRST + PROXY_PORT_COUNT - 1;
let dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

const refused = (own: number[], listening: number[]) => {
  try {
    checkProxyListeners(own, listening);
    return null;
  } catch (e) {
    expect(e).toBeInstanceOf(ControllerError);
    expect((e as ControllerError).code).toBe("DR_PROXY_PORT_BUSY");
    return (e as Error).message;
  }
};

test("the batch's own proxy as the only listener on the range passes; ports off the range are not checked", () => {
  expect(refused([PROXY_PORT_FIRST], [22, PROXY_PORT_FIRST, PROXY_PORT_FIRST - 1, LAST + 1])).toBeNull();
  expect(refused([PROXY_PORT_FIRST, PROXY_PORT_FIRST + 1], [PROXY_PORT_FIRST + 1, PROXY_PORT_FIRST])).toBeNull();
  expect(refused([], [22, LAST + 1])).toBeNull();
  expect(refused([40123], [40123])).toBeNull();
});

test("anything else listening on the range, or an own proxy not seen listening, is refused with DR_PROXY_PORT_BUSY", () => {
  expect(refused([PROXY_PORT_FIRST], [PROXY_PORT_FIRST, LAST])).toContain(String(LAST));
  expect(refused([], [PROXY_PORT_FIRST + 3])).toContain(String(PROXY_PORT_FIRST + 3));
  expect(refused([PROXY_PORT_FIRST], [])).toContain(String(PROXY_PORT_FIRST));
});

test("listeningPorts reads LISTEN sockets from /proc/net/tcp and tcp6 and ignores other states", () => {
  const dir = mkdtempSync(join(tmpdir(), "dr-ports-"));
  dirs.push(dir);
  const head = "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n";
  writeFileSync(join(dir, "tcp"), head + "   0: 0100007F:B7CC 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 1\n   1: 0100007F:B7CD 0100007F:9C40 01 00000000:00000000 00:00000000 00000000     0        0 2\n");
  writeFileSync(join(dir, "tcp6"), head + "   0: 00000000000000000000000000000000:0016 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 3\n");
  expect(listeningPorts([join(dir, "tcp"), join(dir, "tcp6"), join(dir, "missing")]).sort((a, b) => a - b)).toEqual([22, 0xb7cc]);
});

test.if(process.platform === "linux")("listeningPorts sees a real listener on this host, and the check refuses it on the range", () => {
  const server = Bun.listen({ hostname: "127.0.0.1", port: LAST, socket: { data() {} } });
  try {
    expect(listeningPorts()).toContain(LAST);
    expect(refused([], listeningPorts())).toContain(String(LAST));
  } finally {
    server.stop(true);
  }
  expect(listeningPorts()).not.toContain(LAST);
});
