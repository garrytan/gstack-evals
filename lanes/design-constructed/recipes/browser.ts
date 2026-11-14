// Copyright (c) 2026 Garry Tan. MIT License.
// The BrowserSeam for recipe qualification and stage 3's reads: a headless Chromium inside the VM on loopback, driven
// by the controller's Playwright over the VM's SSH tunnel (2026-11-09 plan I1, which stage 3 keeps), so no key and no
// model call enters the VM. Each load sets the viewport, navigates, waits the frozen page-error window (counting
// uncaught page errors from the navigation's start to the window's end), then runs PAGE_PROBE_SCRIPT. Login fills the
// recipe's declarative fields with the controller's own script and keeps the storage state for later loads.
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { RECIPES } from "../frozen.ts";
import type { Vm, VmBackend } from "../stage3/sandbox.ts";
import { shq, type Tunnel } from "../stage3/ubicloud-real.ts";
import { PAGE_PROBE_SCRIPT } from "./qualify.ts";
import type { RecipeLogin } from "./recipe.ts";
import type { BrowserSeam, BrowserSession, PageLoad, PageProbe } from "./seams.ts";

/** BT: the DevTools port inside the VM, on loopback only. */
export const VM_DEVTOOLS_PORT = 9222;
/** BT: one navigation's limit; a navigation past it reads as no response. */
export const NAVIGATION_TIMEOUT_MS = 60_000;
/** BT: the browser's profile and log inside the VM; close removes them before the audit lists written files. */
export const VM_BROWSER_DIR = "/tmp/dc-browser";

export interface BrowserDeps {
  backend: VmBackend;
  tunnel: (vm: Vm, remotePort: number) => Promise<Tunnel>;
  /** The Chromium binary inside the VM. */
  chromium: string;
  devtoolsPort?: number;
  /** How long the DevTools endpoint may take to answer after the browser starts. */
  startWaitMs?: number;
}

/** The command that starts the VM's browser as the run user, detached, on loopback only. */
export const browserStart = (chromiumBin: string, port: number, dir = VM_BROWSER_DIR) =>
  "rm -rf " + shq(dir) + " && mkdir -p " + shq(dir) + " && setsid -f sh -c " + shq("echo $$ > " + shq(dir + "/pid") + " && exec \"$0\" \"$@\"") + " " + shq(chromiumBin) + " --headless=new --no-sandbox --disable-gpu --no-first-run --no-default-browser-check --remote-debugging-address=127.0.0.1 --remote-debugging-port=" + port + " --user-data-dir=" + shq(dir + "/profile") + " about:blank < /dev/null > " + shq(dir + "/log") + " 2>&1";

/** Stops the VM's browser by the pid it wrote and removes its profile. */
export const browserStop = (dir = VM_BROWSER_DIR) => {
  const pid = "\"$(cat " + shq(dir + "/pid") + " 2>/dev/null)\"";
  return "if test -s " + shq(dir + "/pid") + "; then kill " + pid + " 2>/dev/null; for i in $(seq 1 25); do kill -0 " + pid + " 2>/dev/null || break; sleep 0.2; done; kill -9 " + pid + " 2>/dev/null; fi; rm -rf " + shq(dir) + "; true";
};

async function readLoad(page: Page, url: string, viewport: readonly [number, number], windowMs: number): Promise<PageLoad> {
  let pageErrors = 0;
  let counting = true;
  page.on("pageerror", () => {
    if (counting) pageErrors++;
  });
  await page.setViewportSize({ width: viewport[0], height: viewport[1] });
  let status: number | null = null;
  try {
    const res = await page.goto(url, { waitUntil: "load", timeout: NAVIGATION_TIMEOUT_MS });
    status = res?.status() ?? null;
  } catch {
    status = null;
  }
  await page.waitForTimeout(windowMs);
  counting = false;
  let probe: PageProbe | null = null;
  try {
    probe = (await page.evaluate(PAGE_PROBE_SCRIPT)) as PageProbe;
  } catch {
    probe = null;
  }
  const finalUrl = page.url();
  return { url, viewport, status, finalUrl: finalUrl && finalUrl !== "about:blank" ? finalUrl : null, pageErrors, probe };
}

/** The controller's Playwright over the VM's SSH tunnel. */
export function playwrightBrowser(d: BrowserDeps): BrowserSeam {
  const port = d.devtoolsPort ?? VM_DEVTOOLS_PORT;
  const windowMs = RECIPES.pageErrorWindowMs;
  return {
    async open(vm: Vm, _baseUrl: string): Promise<BrowserSession> {
      const started = await d.backend.exec(vm, browserStart(d.chromium, port), { user: "run" });
      if (started.exit !== 0) throw new Error("the VM's browser did not start (exit " + started.exit + ")");
      const stop = () => d.backend.exec(vm, browserStop(), { user: "run" }).catch(() => undefined);
      const ready = await d.backend.exec(vm, "for i in $(seq 1 " + Math.ceil((d.startWaitMs ?? 30_000) / 500) + "); do curl -sf http://127.0.0.1:" + port + "/json/version > /dev/null && exit 0; sleep 0.5; done; exit 1", { user: "run" });
      if (ready.exit !== 0) {
        await stop();
        throw new Error("the VM's browser did not answer on its DevTools port");
      }
      let tunnel: Tunnel | null = null;
      let browser: Browser | null = null;
      let context: BrowserContext;
      try {
        tunnel = await d.tunnel(vm, port);
        browser = await chromium.connectOverCDP("http://127.0.0.1:" + tunnel.port);
        context = await browser.newContext();
      } catch (e) {
        await browser?.close().catch(() => undefined);
        await tunnel?.close();
        await stop();
        throw e;
      }
      return {
        async login(login: RecipeLogin, url: string): Promise<boolean> {
          const page = await context.newPage();
          try {
            await page.goto(url, { waitUntil: "load", timeout: NAVIGATION_TIMEOUT_MS });
            await page.fill(login.usernameSelector, login.username, { timeout: 15_000 });
            await page.fill(login.passwordSelector, login.password, { timeout: 15_000 });
            await Promise.all([page.waitForLoadState("load", { timeout: NAVIGATION_TIMEOUT_MS }).catch(() => undefined), page.click(login.submitSelector, { timeout: 15_000 })]);
            await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
            return !(await page.locator(login.passwordSelector).first().isVisible().catch(() => false));
          } catch {
            return false;
          } finally {
            await page.close().catch(() => undefined);
          }
        },
        async load(url: string, viewport: readonly [number, number]): Promise<PageLoad> {
          const page = await context.newPage();
          try {
            return await readLoad(page, url, viewport, windowMs);
          } finally {
            await page.close().catch(() => undefined);
          }
        },
        async close(): Promise<void> {
          await context.close().catch(() => undefined);
          await browser!.close().catch(() => undefined);
          await tunnel!.close();
          await stop();
        },
      };
    },
  };
}
