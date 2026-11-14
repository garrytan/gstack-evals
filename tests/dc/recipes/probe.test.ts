// Copyright (c) 2026 Garry Tan. MIT License.
// The controller's in-page probe in a real headless Chromium on invented pages, when one is installed; skipped otherwise.
import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PAGE_PROBE_SCRIPT, readLoad } from "../../../lanes/design-constructed/recipes/qualify.ts";
import type { PageProbe } from "../../../lanes/design-constructed/recipes/seams.ts";

const CHROMIUM = ["/usr/local/bin/chromium", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find((p) => existsSync(p));

const PAGES: Record<string, string> = {
  content: '<div id="root"><nav>Projects Tickets Settings</nav><h1>Projects</h1><ul><li>Alpha</li><li>Beta</li></ul></div>',
  blank: '<div id="app"></div>',
  hidden: '<div id="root"><div style="display:none">hidden text</div></div>',
  login: '<div id="root"><form><h2>Sign in</h2><input type="email"><input type="password"><button>Sign in</button></form><p>Acme</p></div>',
  fallback: '<div id="__next"><h1>404</h1><h2>This page could not be found.</h2></div>',
  settings: '<div id="root"><nav>Projects Tickets Settings Billing Members</nav><h1>Account settings</h1><p>' + "Manage your profile, notifications and security preferences for this workspace. ".repeat(4) + '</p><form><label>New password</label><input type="password"><button>Save</button></form></div>',
};

function probe(dir: string, name: string): PageProbe {
  const file = join(dir, name + ".html");
  writeFileSync(file, "<!doctype html><html><body>" + PAGES[name] + "<script>document.title = JSON.stringify(" + PAGE_PROBE_SCRIPT + ");</script></body></html>");
  const out = execFileSync(CHROMIUM!, ["--headless", "--no-sandbox", "--disable-gpu", "--dump-dom", "file://" + file], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 60_000 });
  return JSON.parse(/<title>(.*?)<\/title>/s.exec(out)![1]!.replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
}

describe.skipIf(!CHROMIUM)("the page probe in headless Chromium", () => {
  test("content passes; blank, hidden, a login form alone and a framework fallback fail strict; a settings page passes", () => {
    const dir = mkdtempSync(join(tmpdir(), "dc-probe-"));
    try {
      const strict = (name: string) => readLoad({ url: "http://localhost:3000/p", viewport: [375, 812], status: 200, finalUrl: "http://localhost:3000/p", pageErrors: 0, probe: probe(dir, name) }).strict;
      expect(strict("content")).toBeNull();
      expect(strict("blank")).toBe("a blank page");
      expect(strict("hidden")).toBe("a blank page");
      expect(strict("login")).toBe("a login form alone");
      expect(strict("fallback")).toContain("framework fallback");
      expect(strict("settings")).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
