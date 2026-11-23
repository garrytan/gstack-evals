// Copyright (c) 2026 Garry Tan. MIT License.
// Part S's runtime volume (wiki/plans/2026-11-21-geva-568-skill-pack-h2h-sol-particle-prereg sections 2 and 3): the base
// runtime volume (sessions/runtimes.ts, node, bun, python3 and gh) copied into a volume of its own with Codex CLI 0.170.0
// added, mounted read-only at the same /opt/h2h-runtimes in every part S session container. The base arms keep the base
// volume byte for byte. Codex is the static musl build from prereg.json parts.S.codex: the platform tarball is checked
// against its sha256, its binary and the codex-code-mode-host beside it are copied to codex/, and bin/sol-agent links to
// codex/codex, so Codex starts under a name gstack's session-kind check never reads as codex (section 3). Only the link
// is on PATH; no file in the volume is named codex on PATH. MANIFEST.json holds the base manifest, the tarball pin and each
// binary's sha256, and the volume is reused while it holds the same, with every version read back.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { h2hFail } from "../prereg.ts";
import { buildRuntimeVolume, RUNTIME_MANIFEST, RUNTIME_PINS, RUNTIMES_DIR, runtimeVolume } from "../sessions/runtimes.ts";
import { readExtPrereg, type ExtPrereg } from "./prereg.ts";

const sha = (b: string | Buffer) => createHash("sha256").update(b).digest("hex");
const docker = (args: string[], timeout = 900_000) => spawnSync("docker", args, { encoding: "utf8", timeout, maxBuffer: 1 << 26 });
const fail = (why: string): never => h2hFail("E_H2HX_CODEX_RUNTIME", why);

/** The Codex pin as part S reads it: the npm platform tarball's URL and sha256, the binary's path inside it and the link name. */
export function codexPin(x: ExtPrereg = readExtPrereg()) {
  const c = x.parts.S.codex;
  const m = c.platform_tgz.match(/^@openai\/codex@(\d+\.\d+\.\d+)-(linux-x64)$/) ?? fail("prereg.json parts.S.codex.platform_tgz " + c.platform_tgz + " is not @openai/codex@<version>-linux-x64");
  if (m[1] !== c.version) fail("prereg.json parts.S.codex.platform_tgz names " + m[1] + ", not version " + c.version);
  if ((c.arg0_names_to_avoid as string[]).includes(c.link_name)) fail("prereg.json parts.S.codex.link_name " + c.link_name + " is one of the names to avoid");
  return { version: c.version, url: "https://registry.npmjs.org/@openai/codex/-/codex-" + m[1] + "-" + m[2] + ".tgz", tgz_sha256: c.platform_tgz_sha256, binary: c.binary, host: c.binary.replace(/codex$/, "codex-code-mode-host"), link: c.link_name };
}

export interface CodexFiles { tgz: string; dir: string; codex: string; host: string; codex_sha256: string; host_sha256: string }

/** Downloads the platform tarball into cache when it is missing, refuses one whose sha256 is not the pin, and unpacks the
 *  binary and its code-mode host into cache/codex-<version>/. The binary must print codex-cli <version>. */
export async function codexFiles(cache = join(homedir(), ".cache/h2h-runtimes"), x: ExtPrereg = readExtPrereg()): Promise<CodexFiles> {
  const pin = codexPin(x);
  mkdirSync(cache, { recursive: true });
  const tgz = join(cache, pin.tgz_sha256 + ".tgz");
  if (!existsSync(tgz)) {
    const r = await fetch(pin.url);
    if (!r.ok) fail("the Codex tarball download answered " + r.status + " (" + pin.url + ")");
    writeFileSync(tgz + ".part", Buffer.from(await r.arrayBuffer()));
    renameSync(tgz + ".part", tgz);
  }
  const got = sha(readFileSync(tgz));
  if (got !== pin.tgz_sha256) fail(tgz + " has sha256 " + got + ", not the pinned " + pin.tgz_sha256);
  const dir = join(cache, "codex-" + pin.version);
  const codex = join(dir, "codex");
  const host = join(dir, "codex-code-mode-host");
  if (!existsSync(codex) || !existsSync(host)) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const strip = String(pin.binary.split("/").length - 1);
    const t = spawnSync("tar", ["-xzf", tgz, "-C", dir, "--strip-components=" + strip, "--no-same-owner", pin.binary, pin.host], { encoding: "utf8" });
    if (t.status !== 0) fail("could not unpack " + pin.binary + " and " + pin.host + " from " + tgz + ": " + t.stderr.trim().slice(-300));
  }
  const v = spawnSync(codex, ["--version"], { encoding: "utf8", timeout: 60_000 });
  if (v.stdout.trim() !== "codex-cli " + pin.version) fail(codex + " prints " + JSON.stringify(v.stdout.trim()) + ", not codex-cli " + pin.version);
  return { tgz, dir, codex, host, codex_sha256: sha(readFileSync(codex)), host_sha256: sha(readFileSync(host)) };
}

/** Part S's runtime manifest: the base volume's, with Codex's pin, its two binaries' digests and the link. */
export function extRuntimeManifest(f: Pick<CodexFiles, "codex_sha256" | "host_sha256">, x: ExtPrereg = readExtPrereg()) {
  const pin = codexPin(x);
  return { schema: "h2hx-runtimes.v1", base: { volume: runtimeVolume(), manifest: RUNTIME_MANIFEST }, dir: RUNTIMES_DIR, codex: { version: pin.version, url: pin.url, tgz_sha256: pin.tgz_sha256, codex_sha256: f.codex_sha256, host_sha256: f.host_sha256, link: "bin/" + pin.link + " -> ../codex/codex" } };
}
export const extRuntimeVolume = (manifest: ReturnType<typeof extRuntimeManifest>): string => "h2hx-runtimes-" + sha(JSON.stringify(manifest)).slice(0, 16);
/** The Codex link sessions run, inside the container. */
export const solAgentPath = (x: ExtPrereg = readExtPrereg()): string => RUNTIMES_DIR + "/bin/" + codexPin(x).link;

export interface ExtRuntimeVolume { volume: string; base_volume: string; manifest: ReturnType<typeof extRuntimeManifest>; reused: boolean; versions: Record<string, string> }

/** Builds part S's runtime volume on top of the base one, or reuses it when its MANIFEST.json holds the same pins. Every
 *  base runtime's version, sol-agent's version and both Codex binaries' sha256 are read back from the volume. */
export async function buildExtRuntimeVolume(o: { cache?: string } = {}, x: ExtPrereg = readExtPrereg()): Promise<ExtRuntimeVolume> {
  const base = await buildRuntimeVolume(o);
  const files = await codexFiles(o.cache, x);
  const manifest = extRuntimeManifest(files, x);
  const volume = extRuntimeVolume(manifest);
  const want = JSON.stringify(manifest);
  const pin = codexPin(x);
  const node = RUNTIME_PINS.node.image;
  const probe = () => docker(["run", "--rm", "--network", "none", "-v", volume + ":" + RUNTIMES_DIR + ":ro", "--entrypoint", "sh", node, "-c", 'd=$1; cat "$d/MANIFEST.json"; echo; for t in node bun python3 gh "$2"; do echo "V $t $("$d/bin/$t" --version 2>&1 | head -1)"; done; echo "S codex $(sha256sum "$d/codex/codex" | cut -d" " -f1)"; echo "S host $(sha256sum "$d/codex/codex-code-mode-host" | cut -d" " -f1)"; [ -e "$d/bin/codex" ] && echo "NAMED codex"; true', "sh", RUNTIMES_DIR, pin.link], 120_000);
  const read = (out: string) => Object.fromEntries([...out.matchAll(/^[VS] (\S+) (.*)$/gm)].map((m) => [m[1]!, m[2]!.trim()]));
  const check = (out: string) => {
    const v = read(out);
    const bad = [...(["node", "bun", "python3", "gh"] as const).filter((k) => v[k] !== RUNTIME_PINS[k].version).map((k) => k + " " + JSON.stringify(v[k] ?? null)), ...(v[pin.link] !== "codex-cli " + pin.version ? [pin.link + " " + JSON.stringify(v[pin.link] ?? null)] : []), ...(v.codex !== files.codex_sha256 ? ["codex sha256 " + v.codex] : []), ...(v.host !== files.host_sha256 ? ["codex-code-mode-host sha256 " + v.host] : []), ...(/^NAMED codex$/m.test(out) ? ["a bin/codex"] : [])];
    if (bad.length) fail("part S's runtime volume " + volume + " reads " + bad.join(", ") + ", not its pins");
    return v;
  };
  const have = probe();
  if (have.status === 0 && have.stdout.split("\n")[0] === want) return { volume, base_volume: base.volume, manifest, reused: true, versions: check(have.stdout) };
  docker(["volume", "rm", "-f", volume], 60_000);
  const steps: Array<[string, string[]]> = [
    ["volume", ["volume", "create", volume]],
    ["base copy", ["run", "--rm", "--network", "none", "-v", base.volume + ":/b:ro", "-v", volume + ":/t", "--entrypoint", "sh", node, "-c", "cp -a /b/. /t/ && rm -f /t/MANIFEST.json"]],
    ["codex", ["run", "--rm", "--network", "none", "-v", volume + ":/t", "-v", files.dir + ":/in:ro", "--entrypoint", "sh", node, "-c", 'mkdir -p /t/codex && cp /in/codex /in/codex-code-mode-host /t/codex/ && ln -s ../codex/codex "/t/bin/$1" && printf "%s" "$2" > /t/MANIFEST.json && chmod -R a+rX /t', "sh", pin.link, want]],
  ];
  for (const [name, args] of steps) {
    const r = docker(args);
    if (r.status !== 0) fail("part S's runtime volume step " + name + " failed: " + (r.stderr || r.stdout).trim().slice(-300));
  }
  const built = probe();
  if (built.status !== 0 || built.stdout.split("\n")[0] !== want) fail("part S's runtime volume " + volume + " did not read back its manifest: " + (built.stderr || built.stdout).trim().slice(-300));
  return { volume, base_volume: base.volume, manifest, reused: false, versions: check(built.stdout) };
}
