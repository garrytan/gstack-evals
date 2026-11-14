// Copyright (c) 2026 Garry Tan. MIT License.
// The browser seam end to end on this machine: the VM's commands run locally (a local SSH stand-in), the tunnel is the
// identity, and a local test page stands in for the app. Skipped when no Chromium is installed.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { browserStart, browserStop, playwrightBrowser, VM_BROWSER_DIR } from "../../../lanes/design-constructed/recipes/browser.ts";
import { readLoad } from "../../../lanes/design-constructed/recipes/qualify.ts";
import type { Vm, VmBackend } from "../../../lanes/design-constructed/stage3/sandbox.ts";
import { freePort, runProcess } from "../../../lanes/design-constructed/stage3/ubicloud-real.ts";

const CHROMIUM = ["/usr/local/bin/chromium", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"].find((p) => existsSync(p));

const local: VmBackend = {
  create: async () => {
    throw new Error("not used");
  },
  exec: async (_vm, command) => {
    const r = await runProcess(["bash", "-c", command], { timeoutMs: 60_000 });
    return { exit: r.exit, stdout: new TextDecoder().decode(r.stdout), stderr: r.stderr };
  },
  write: async () => {},
  read: async () => new Uint8Array(),
  destroy: async () => {},
};
const vm = { id: "local-stand-in", spec: {} } as unknown as Vm;

const PAGES: Record<string, string> = {
  "/projects": '<div id="root"><nav>Projects Tickets Settings</nav><h1>Projects</h1><ul><li>Alpha</li><li>Beta</li></ul></div>',
  "/broken": '<div id="root"><h1>Tickets</h1></div><script>setTimeout(() => { throw new Error("late failure"); }, 2000);</script>',
  "/login": '<form method="post" action="/session"><input id="u" name="u"><input id="p" type="password" name="p"><button id="go">Sign in</button></form>',
  "/home": '<div id="root"><h1>Welcome back</h1><p>Signed in.</p></div>',
};

let server: ReturnType<typeof Bun.serve> | null = null;
let base = "";

describe.skipIf(!CHROMIUM)("the browser seam through a local stand-in", () => {
  beforeAll(async () => {
    server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req) {
        const path = new URL(req.url).pathname;
        if (path === "/session") return new Response(null, { status: 303, headers: { location: "/home", "set-cookie": "s=1; Path=/" } });
        const body = PAGES[path];
        return body ? new Response("<!doctype html><html><body>" + body + "</body></html>", { headers: { "content-type": "text/html" } }) : new Response("<h1>404</h1>", { status: 404, headers: { "content-type": "text/html" } });
      },
    });
    base = "http://127.0.0.1:" + server.port;
  });
  afterAll(() => {
    server?.stop(true);
  });

  test("loads read status, final route, page errors in the window and the probe; login keeps its state; close stops the browser", async () => {
    const port = await freePort();
    const seam = playwrightBrowser({ backend: local, tunnel: async (_vm, p) => ({ port: p, close: async () => {} }), chromium: CHROMIUM!, devtoolsPort: port });
    const session = await seam.open(vm, base);
    try {
      const [ok, broken, missing] = await Promise.all([session.load(base + "/projects", [1280, 800]), session.load(base + "/broken", [375, 812]), session.load(base + "/nowhere", [768, 1024])]);
      expect([ok.status, ok.pageErrors, ok.finalUrl]).toEqual([200, 0, base + "/projects"]);
      expect(ok.probe?.root).toBe("#root");
      expect(readLoad(ok).strict).toBeNull();
      expect([broken.status, broken.pageErrors]).toEqual([200, 1]);
      expect(missing.status).toBe(404);
      expect(await session.login({ route: "/login", username: "seed", password: "seed-pass", usernameSelector: "#u", passwordSelector: "#p", submitSelector: "#go" }, base + "/login")).toBe(true);
    } finally {
      await session.close();
    }
    expect(existsSync(VM_BROWSER_DIR)).toBe(false);
    const left = await runProcess(["bash", "-c", "curl -sf http://127.0.0.1:" + port + "/json/version"]);
    expect(left.exit).not.toBe(0);
  }, 60_000);

  test("start and stop commands hold the pid and remove the profile", () => {
    expect(browserStart("/x/chromium", 9222)).toContain("--remote-debugging-address=127.0.0.1");
    expect(browserStart("/x/chromium", 9222)).toContain("setsid -f sh -c");
    expect(browserStop()).toContain("rm -rf '" + VM_BROWSER_DIR + "'");
  });
});
