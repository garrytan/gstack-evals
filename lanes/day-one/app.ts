// Copyright (c) 2026 Garry Tan. MIT License.
// The browser container (prereg section 6): one per checklist run, on the trial network (internal, no egress). It holds
// the built app, the owner's sample files and Playwright's MCP server, and the checker reaches it only over MCP.
// - nodeVolume: a read-only volume holding Node 24 alone (the h2h runtimes' node pin, copied out of its image), mounted
//   at NODE_DIR in build sessions and here, so the builder and the app run the same node.
// - startApp: copies the build's tree to a scratch folder, mounts it at /work/app (writable, so the app can save),
//   the samples at /samples (read-only) and the node volume; runs sh ./start.sh in /work/app with PORT=3000 and node on
//   PATH; then starts the MCP server over HTTP on 8931 with headless Chromium, an isolated profile, /samples as its only
//   workspace root (--ignore-roots) and screenshots to /work/shots. The app counts as started once its port answers an
//   HTTP request within APP_START_S; a build that never answers is "does not start", scored as no task done.
// - The checker's session never sees the app's files: its own work dir is empty and its only route to the app is the
//   browser.
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { RUNTIME_PINS } from "../outcome-skills/h2h/sessions/runtimes.ts";
import { APP_PORT, APP_START_S, BROWSER_IMAGE, MCP_PORT } from "./frozen.ts";

export const NODE_DIR = "/opt/day-one-node";
export const NODE_BIN = NODE_DIR + "/bin";
export const NODE_PIN = RUNTIME_PINS.node;
export const nodeVolumeName = (): string => "day-one-node-" + createHash("sha256").update(JSON.stringify(NODE_PIN)).digest("hex").slice(0, 16);

const run = (docker: string, args: string[], timeout = 300_000) => spawnSync(docker, args, { encoding: "utf8", timeout, maxBuffer: 1 << 24 });

/** Builds the node volume, or reuses it when its node reads back the pinned version. */
export function nodeVolume(docker = "docker"): { volume: string; version: string; reused: boolean } {
  const volume = nodeVolumeName();
  const probe = () => run(docker, ["run", "--rm", "--network", "none", "-v", volume + ":" + NODE_DIR + ":ro", "--entrypoint", NODE_BIN + "/node", NODE_PIN.image, "--version"], 120_000);
  const have = probe();
  if (have.status === 0 && have.stdout.trim() === NODE_PIN.version) return { volume, version: NODE_PIN.version, reused: true };
  run(docker, ["volume", "rm", "-f", volume], 60_000);
  for (const args of [["volume", "create", volume], ["run", "--rm", "--network", "none", "-v", volume + ":/t", "--entrypoint", "sh", NODE_PIN.image, "-c", "mkdir -p /t/bin && cp /usr/local/bin/node /t/bin/node && chmod -R a+rX /t"]]) {
    const r = run(docker, args);
    if (r.status !== 0) throw new Error("E_DAYONE_APP: the node volume step " + args.slice(0, 2).join(" ") + " failed: " + (r.stderr || r.stdout).trim().slice(-300));
  }
  const built = probe();
  if (built.status !== 0 || built.stdout.trim() !== NODE_PIN.version) throw new Error("E_DAYONE_APP: the node volume " + volume + " reads " + JSON.stringify(built.stdout.trim()) + ", not " + NODE_PIN.version);
  return { volume, version: NODE_PIN.version, reused: false };
}

export interface AppRun {
  container: string;
  /** The MCP server's URL as the checker's container reaches it on the trial network. */
  mcpUrl: string;
  started: boolean;
  /** Seconds until the app answered, or null. */
  start_s: number | null;
  detail: string;
  /** The writable copy of the build the app ran from. */
  copy: string;
}

/** The shell line the browser container runs: the app in the background, then the MCP server in the foreground. */
export const browserCommand = (): string =>
  "cd /work/app && (PATH=" + NODE_BIN + ":$PATH PORT=" + APP_PORT + " sh ./start.sh > /work/app.log 2>&1 &) ; " +
  "cd /samples && exec node /app/cli.js --headless --browser chromium --no-sandbox --isolated --ignore-roots --port " + MCP_PORT + " --host 0.0.0.0 --allowed-hosts '*' --output-dir /work/shots --viewport-size 1280x900";

/** Starts the browser container for one build and waits for the app and the MCP server. */
export async function startApp(o: { docker: string; network: string; build: string; samples: string; scratch: string; volume: string; label: string; sleep?: (ms: number) => Promise<void> }): Promise<AppRun> {
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const container = "day-one-app-" + o.label + "-" + randomBytes(4).toString("hex");
  const copy = join(o.scratch, container);
  rmSync(copy, { recursive: true, force: true });
  mkdirSync(join(copy, "work"), { recursive: true });
  cpSync(o.build, join(copy, "work", "app"), { recursive: true, verbatimSymlinks: true, filter: (src) => !src.split("/").includes(".git") });
  mkdirSync(join(copy, "work", "shots"), { recursive: true });
  const base = { container, mcpUrl: "http://" + container + ":" + MCP_PORT + "/mcp", copy };
  const r = run(o.docker, ["run", "-d", "--name", container, "--network", o.network, "--pids-limit", "2048", "--user", process.getuid!() + ":" + process.getgid!(), "-e", "HOME=/tmp", "-v", join(copy, "work") + ":/work", "-v", o.samples + ":/samples:ro", "-v", o.volume + ":" + NODE_DIR + ":ro", "--entrypoint", "sh", BROWSER_IMAGE, "-c", browserCommand()]);
  if (r.status !== 0) return { ...base, started: false, start_s: null, detail: "docker run failed: " + (r.stderr || r.stdout).trim().slice(-300) };
  const probe = (port: number) => run(o.docker, ["exec", container, "node", "-e", "fetch('http://localhost:" + port + "/').then(()=>process.exit(0),()=>process.exit(1))"], 15_000).status === 0;
  let mcp = false;
  let app = false;
  const t0 = Date.now();
  while ((Date.now() - t0) / 1000 < APP_START_S && !(app && mcp)) {
    if (!mcp) mcp = probe(MCP_PORT);
    if (!app) app = probe(APP_PORT);
    if (!(app && mcp)) await sleep(2000);
  }
  const start_s = app ? Math.round((Date.now() - t0) / 1000) : null;
  const log = run(o.docker, ["exec", container, "sh", "-c", "tail -c 400 /work/app.log 2>/dev/null"], 15_000).stdout.trim();
  if (!mcp) return { ...base, started: false, start_s, detail: "the MCP server never answered on " + MCP_PORT };
  return { ...base, started: app, start_s, detail: app ? "the app answered on " + APP_PORT : "the app never answered on " + APP_PORT + " within " + APP_START_S + " s; app.log tail: " + log };
}

/** Stops the browser container and copies its screenshots and app log to dest; the scratch copy is removed. */
export function stopApp(a: Pick<AppRun, "container" | "copy">, docker: string, dest: string): void {
  run(docker, ["rm", "-f", a.container], 60_000);
  mkdirSync(dest, { recursive: true });
  try {
    cpSync(join(a.copy, "work", "shots"), join(dest, "shots"), { recursive: true });
    cpSync(join(a.copy, "work", "app.log"), join(dest, "app.log"));
  } catch {
    // nothing to keep
  }
  rmSync(a.copy, { recursive: true, force: true });
}
