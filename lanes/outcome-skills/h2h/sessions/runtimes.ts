// Copyright (c) 2026 Garry Tan. MIT License.
// The head-to-head's runtime volume (post section 3, prereg.json runtimes): one read-only Docker volume mounted at
// /opt/h2h-runtimes in every session container of every arm, holding node, bun, python3 and gh, each pinned here by image
// digest or download sha256 and recorded in the volume's MANIFEST.json. Its bin dir is appended after the image's own
// PATH, so a unit's own toolchain still wins. Oracle and scoring containers do not mount it. As pfchecks/tools.ts builds
// its tools volume: node and bun are copied out of part A's install-image bases (arms/recipes.ts INSTALL_IMAGE), python3
// (python-build-standalone, relocatable) and gh (a static binary) come from release downloads checked against their
// sha256, each binary's version is read back and must match its pin, and the volume is reused while MANIFEST.json holds
// the same pins.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { INSTALL_IMAGE } from "../arms/recipes.ts";
import { imagePath } from "../../pfchecks/tools.ts";
import { h2hFail, PREREG_PATH } from "../prereg.ts";

export const RUNTIME_PINS = {
  node: { image: INSTALL_IMAGE.base, version: "v24.22.3" },
  bun: { image: INSTALL_IMAGE.bun, version: "1.4.4" },
  python3: { url: "https://github.com/astral-sh/python-build-standalone/releases/download/20261110/cpython-3.13.18%2B20261110-x86_64-unknown-linux-gnu-install_only_stripped.tar.gz", sha256: "f2d2199eb25880e07863b391cf7124e7ffa1338b0d65600dfcec117c4223a7fb", version: "Python 3.13.18" },
  gh: { url: "https://github.com/cli/cli/releases/download/v2.104.0/gh_2.104.0_linux_amd64.tar.gz", sha256: "98cb101ad87dbbd3f6b2f2bfcbd43197ccd07643140121d8a9cfaa91eadbc24e", version: "gh version 2.104.0 (2026-11-12)" },
} as const;
/** The mount point, from prereg.json. */
export const RUNTIMES_DIR: string = (JSON.parse(readFileSync(PREREG_PATH, "utf8")) as { runtimes: { mount: string } }).runtimes.mount;
/** The names the bin dir holds, each a link into its runtime's own tree. */
export const RUNTIME_BIN: Record<string, string> = { node: "../node/bin/node", npm: "../node/lib/node_modules/npm/bin/npm-cli.js", npx: "../node/lib/node_modules/npm/bin/npx-cli.js", bun: "../bun/bun", bunx: "../bun/bun", python3: "../python/bin/python3", python3_13: "../python/bin/python3.13", pip3: "../python/bin/pip3", gh: "../gh/bin/gh" };
export const RUNTIME_MANIFEST = { schema: "h2h-runtimes.v1", dir: RUNTIMES_DIR, path: "appended after the image PATH", pins: RUNTIME_PINS, bin: RUNTIME_BIN } as const;

const sha = (b: string | Buffer) => createHash("sha256").update(b).digest("hex");
export const runtimeVolume = (): string => "h2h-runtimes-" + sha(JSON.stringify(RUNTIME_MANIFEST)).slice(0, 16);
/** The image's own PATH with the runtimes' bin dir after it. */
export const runtimePath = (image: string): string => imagePath(image) + ":" + RUNTIMES_DIR + "/bin";

const docker = (args: string[], timeout = 900_000) => spawnSync("docker", args, { encoding: "utf8", timeout, maxBuffer: 1 << 26 });

/** Downloads each release file into cache when it is missing, and refuses one whose sha256 is not its pin. */
export async function runtimeDownloads(cache = join(homedir(), ".cache/h2h-runtimes")): Promise<{ python3: string; gh: string }> {
  mkdirSync(cache, { recursive: true });
  const out: Record<string, string> = {};
  for (const k of ["python3", "gh"] as const) {
    const pin = RUNTIME_PINS[k];
    const file = join(cache, pin.sha256 + ".tgz");
    if (!existsSync(file)) {
      const r = await fetch(pin.url);
      if (!r.ok) h2hFail("E_H2H_RUNTIMES", k + " download answered " + r.status + " (" + pin.url + ")");
      writeFileSync(file, Buffer.from(await r.arrayBuffer()));
    }
    const got = sha(readFileSync(file));
    if (got !== pin.sha256) h2hFail("E_H2H_RUNTIMES", file + " has sha256 " + got + ", not " + k + "'s pin " + pin.sha256);
    out[k] = file;
  }
  return out as { python3: string; gh: string };
}

export interface RuntimeVolume { volume: string; manifest: typeof RUNTIME_MANIFEST; reused: boolean; versions: Record<string, string> }

/** Builds the runtime volume, or reuses it when its MANIFEST.json holds these pins. Each runtime's version is read back
 *  from the volume and must be its pin's. */
export async function buildRuntimeVolume(o: { cache?: string } = {}): Promise<RuntimeVolume> {
  const volume = runtimeVolume();
  const want = JSON.stringify(RUNTIME_MANIFEST);
  const node = RUNTIME_PINS.node.image;
  const probe = () => docker(["run", "--rm", "--network", "none", "-v", volume + ":" + RUNTIMES_DIR + ":ro", "--entrypoint", "sh", node, "-c", 'd=$1; cat "$d/MANIFEST.json"; echo; for t in node bun python3 gh; do echo "V $t $("$d/bin/$t" --version 2>&1 | head -1)"; done', "sh", RUNTIMES_DIR], 120_000);
  const read = (out: string) => Object.fromEntries([...out.matchAll(/^V (\S+) (.*)$/gm)].map((m) => [m[1]!, m[2]!.trim()]));
  const check = (versions: Record<string, string>) => {
    const bad = (["node", "bun", "python3", "gh"] as const).filter((k) => versions[k] !== RUNTIME_PINS[k].version);
    if (bad.length) h2hFail("E_H2H_RUNTIMES", "the runtime volume " + volume + " reads " + bad.map((k) => k + " " + JSON.stringify(versions[k] ?? null)).join(", ") + ", not the pinned " + bad.map((k) => RUNTIME_PINS[k].version).join(", "));
  };
  const have = probe();
  if (have.status === 0 && have.stdout.split("\n")[0] === want) {
    const versions = read(have.stdout);
    check(versions);
    return { volume, manifest: RUNTIME_MANIFEST, reused: true, versions };
  }
  const files = await runtimeDownloads(o.cache);
  docker(["volume", "rm", "-f", volume], 60_000);
  const links = Object.entries(RUNTIME_BIN).map(([name, target]) => "ln -s " + target + " /t/bin/" + name.replace("_", ".")).join(" && ");
  const steps: Array<[string, string[]]> = [
    ["volume", ["volume", "create", volume]],
    ["node", ["run", "--rm", "--network", "none", "-v", volume + ":/t", "--entrypoint", "sh", node, "-c", "mkdir -p /t/bin /t/node/bin /t/node/lib && cp /usr/local/bin/node /t/node/bin/node && cp -a /usr/local/lib/node_modules /t/node/lib/"]],
    ["bun", ["run", "--rm", "--network", "none", "-v", volume + ":/t", "--entrypoint", "sh", RUNTIME_PINS.bun.image, "-c", "mkdir -p /t/bun && cp /usr/local/bin/bun /t/bun/bun"]],
    ["python3 and gh", ["run", "--rm", "--network", "none", "-v", volume + ":/t", "-v", files.python3 + ":/in/python.tgz:ro", "-v", files.gh + ":/in/gh.tgz:ro", "--entrypoint", "sh", node, "-c", "mkdir -p /t/python /t/gh && tar -xzf /in/python.tgz -C /t/python --strip-components=1 --no-same-owner && tar -xzf /in/gh.tgz -C /t/gh --strip-components=1 --no-same-owner"]],
    ["links and manifest", ["run", "--rm", "--network", "none", "-v", volume + ":/t", "--entrypoint", "sh", node, "-c", links + ' && printf "%s" "$0" > /t/MANIFEST.json && chmod -R a+rX /t', want]],
  ];
  for (const [name, args] of steps) {
    const r = docker(args);
    if (r.status !== 0) h2hFail("E_H2H_RUNTIMES", "runtime volume step " + name + " failed: " + (r.stderr || r.stdout).trim().slice(-300));
  }
  const built = probe();
  if (built.status !== 0 || built.stdout.split("\n")[0] !== want) h2hFail("E_H2H_RUNTIMES", "the runtime volume " + volume + " did not read back its manifest: " + (built.stderr || built.stdout).trim().slice(-300));
  const versions = read(built.stdout);
  check(versions);
  return { volume, manifest: RUNTIME_MANIFEST, reused: false, versions };
}
