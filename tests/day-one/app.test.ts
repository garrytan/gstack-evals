// Value: protects=the browser container: a build's ./start.sh runs as its first line says, a script that fails still reads "does not start", and Chromium's profile and temp files stay off disk.
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nodeVolume, startApp, stopApp, type AppRun } from "../../lanes/day-one/app.ts";
import { BROWSER_IMAGE, MCP_PORT } from "../../lanes/day-one/frozen.ts";

const REFERENCE = join(import.meta.dir, "../../lanes/day-one/fixtures/reference");
const haveImage = spawnSync("docker", ["image", "inspect", BROWSER_IMAGE], { encoding: "utf8" }).status === 0;

const MCP_NAVIGATE = [
  "const u = 'http://localhost:" + MCP_PORT + "/mcp';",
  "const h = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };",
  "let r = await fetch(u, { method: 'POST', headers: h, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } }) });",
  "const s = r.headers.get('mcp-session-id'); await r.text();",
  "const H = { ...h, ...(s ? { 'mcp-session-id': s } : {}) };",
  "await (await fetch(u, { method: 'POST', headers: H, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) })).text();",
  "r = await fetch(u, { method: 'POST', headers: H, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'browser_navigate', arguments: { url: 'http://localhost:3000/' } } }) });",
  "console.log(await r.text());",
].join("\n");

describe.skipIf(!haveImage)("day-one browser container", () => {
  const withBuild = async (startSh: string, use: (a: AppRun) => void) => {
    const dir = mkdtempSync(join(tmpdir(), "day-one-app-"));
    try {
      const build = join(dir, "build");
      cpSync(REFERENCE, build, { recursive: true });
      writeFileSync(join(build, "start.sh"), startSh);
      chmodSync(join(build, "start.sh"), 0o755);
      mkdirSync(join(dir, "samples"));
      const a = await startApp({ docker: "docker", network: "none", build, samples: join(dir, "samples"), scratch: join(dir, "scratch"), volume: nodeVolume().volume, label: "test" });
      try {
        use(a);
      } finally {
        stopApp(a, "docker", join(dir, "kept"));
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  test("a bash start script with set -euo pipefail starts", async () => {
    await withBuild("#!/usr/bin/env bash\nset -euo pipefail\nexec node server.js\n", (a) => expect(a.detail).toBe("the app answered on 3000"));
  }, 180_000);

  test("a one-line start script starts, and Chromium writes nothing to the container's disk layer", async () => {
    await withBuild("node server.js\n", (a) => {
      expect(a.started).toBe(true);
      const nav = spawnSync("docker", ["exec", a.container, "node", "--input-type=module", "-e", MCP_NAVIGATE], { encoding: "utf8", timeout: 90_000 });
      expect(nav.stdout).toContain("http://localhost:3000/");
      const diff = spawnSync("docker", ["diff", a.container], { encoding: "utf8" }).stdout.trim().split("\n");
      expect(diff.filter((l) => !/^[AC] \/(samples|work|opt|opt\/day-one-node)$/.test(l))).toEqual([]);
    });
  }, 180_000);

  test("a start script that fails reads as does not start", async () => {
    await withBuild("#!/usr/bin/env bash\nset -euo pipefail\necho broken >&2\nexit 3\n", (a) => {
      expect(a.started).toBe(false);
      expect(a.detail).toContain("the app never answered on 3000");
    });
  }, 180_000);
});
