// Copyright (c) 2026 Garry Tan. MIT License.
// Plan section 3's tools volume: a pinned Temurin JDK 21, tla2tools.jar 1.7.4 (prereg.json's sha256) and a pinned bun,
// in one Docker volume mounted read-only at /opt/pf-tools with TLA2TOOLS and JAVA set and bun on PATH. The same mount
// and environment go to every arm's session and every scoring run (score --mount and --env). The builder copies the JDK
// and bun out of their images (pinned by digest) and the jar from a host file it checks against the pin; the volume
// records its pins in MANIFEST.json and is reused while they match.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pfFail } from "./prereg.ts";

const PREREG = join(import.meta.dir, "../../../wiki/plans/2026-11-09-geva-487-pstack-checks-prereg/prereg.json");
const pins = (JSON.parse(readFileSync(PREREG, "utf8")) as { pins: { tla2tools: { version: string; url: string; sha256: string } } }).pins;
export const TOOLS_PINS = {
  jdk: { image: "eclipse-temurin:21-jdk", digest: "sha256:ebfbb18d11ff163ee83b21258acf12248af48d22a0fdfdc68fa1a1516c05976a", dir: "/opt/java/openjdk" },
  bun: { image: "oven/bun:1", digest: "sha256:1d22548f177f4ff38e0c15baa3c2c46c6c2060ba2d1bc573bb4720b407548f1d", version: "1.4.4", bin: "/usr/local/bin/bun" },
  tla2tools: pins.tla2tools,
} as const;
export const TOOLS_DIR = "/opt/pf-tools";
export const TOOLS_ENV = { TLA2TOOLS: TOOLS_DIR + "/tla2tools.jar", JAVA: TOOLS_DIR + "/jdk/bin/java" } as const;
const ref = (p: { image: string; digest: string }) => p.image.split(":")[0] + "@" + p.digest;
const sha = (b: string | Buffer) => createHash("sha256").update(b).digest("hex");
export const toolsVolume = (): string => "pf-tools-" + sha(JSON.stringify(TOOLS_PINS)).slice(0, 16);
/** The docker --mount spec, read-only. */
export const toolsMount = (): string => "type=volume,src=" + toolsVolume() + ",dst=" + TOOLS_DIR + ",readonly";

const docker = (args: string[], timeout = 900_000) => spawnSync("docker", args, { encoding: "utf8", timeout, maxBuffer: 1 << 26 });

/** The PATH an image sets (its Config.Env), or the Debian default. */
export function imagePath(image: string): string {
  const r = docker(["image", "inspect", "--format", "{{json .Config.Env}}", image], 60_000);
  const env = r.status === 0 ? ((JSON.parse(r.stdout) as string[] | null) ?? []) : [];
  return env.find((e) => e.startsWith("PATH="))?.slice(5) || "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
}
/** The K=V pairs a session or scoring container gets: TLA2TOOLS, JAVA, and bun ahead of the image's own PATH. */
export const toolsEnv = (image: string): string[] => [...Object.entries(TOOLS_ENV).map(([k, v]) => k + "=" + v), "PATH=" + TOOLS_DIR + "/bin:" + imagePath(image)];

/** Checks the jar at path against the pin; downloads it there first when it is missing (the builder's only network use). */
export async function tla2tools(path: string): Promise<string> {
  if (!existsSync(path)) {
    const r = await fetch(TOOLS_PINS.tla2tools.url);
    if (!r.ok) pfFail("E_PF_TOOLS", "tla2tools.jar download answered " + r.status);
    spawnSync("mkdir", ["-p", dirname(path)]);
    await Bun.write(path, await r.arrayBuffer());
  }
  const got = sha(readFileSync(path));
  if (got !== TOOLS_PINS.tla2tools.sha256) pfFail("E_PF_TOOLS", path + " has sha256 " + got + ", not the pin " + TOOLS_PINS.tla2tools.sha256);
  return path;
}

export interface ToolsVolume { volume: string; mount: string; manifest: Record<string, unknown>; reused: boolean }

/** Builds the volume (or reuses it when MANIFEST.json holds the same pins). jar: the host path tla2tools() checked. */
export function buildToolsVolume(jar: string): ToolsVolume {
  const volume = toolsVolume();
  const manifest = { schema: "pf-tools.v1", pins: TOOLS_PINS, dir: TOOLS_DIR, env: TOOLS_ENV };
  const want = JSON.stringify(manifest);
  const jdk = ref(TOOLS_PINS.jdk), bun = ref(TOOLS_PINS.bun);
  const have = docker(["run", "--rm", "--network", "none", "-v", volume + ":/t:ro", "--entrypoint", "cat", jdk, "/t/MANIFEST.json"], 120_000);
  if (have.status === 0 && have.stdout.trim() === want) return { volume, mount: toolsMount(), manifest, reused: true };
  if (sha(readFileSync(jar)) !== TOOLS_PINS.tla2tools.sha256) pfFail("E_PF_TOOLS", jar + " is not the pinned tla2tools.jar");
  docker(["volume", "rm", "-f", volume], 60_000);
  const steps: Array<[string, string[]]> = [
    ["volume", ["volume", "create", volume]],
    ["jdk", ["run", "--rm", "--network", "none", "-v", volume + ":/t", "--entrypoint", "sh", jdk, "-c", "mkdir -p /t/bin && cp -a " + TOOLS_PINS.jdk.dir + " /t/jdk"]],
    ["bun", ["run", "--rm", "--network", "none", "-v", volume + ":/t", "--entrypoint", "sh", bun, "-c", "cp " + TOOLS_PINS.bun.bin + " /t/bin/bun && /t/bin/bun --version"]],
    ["jar", ["run", "--rm", "--network", "none", "-v", volume + ":/t", "-v", jar + ":/in/tla2tools.jar:ro", "--entrypoint", "sh", jdk, "-c", "cp /in/tla2tools.jar /t/tla2tools.jar && printf '%s' \"$0\" > /t/MANIFEST.json && chmod -R a+rX /t", want]],
  ];
  for (const [name, args] of steps) {
    const r = docker(args);
    if (r.status !== 0) pfFail("E_PF_TOOLS", "tools volume step " + name + " failed: " + (r.stderr || r.stdout).trim().slice(-300));
    if (name === "bun" && r.stdout.trim() !== TOOLS_PINS.bun.version) pfFail("E_PF_TOOLS", "the pinned bun image holds bun " + r.stdout.trim() + ", not " + TOOLS_PINS.bun.version);
  }
  return { volume, mount: toolsMount(), manifest, reused: false };
}

/** A two-state spec whose invariant TLC finds violated (the dry run's model-only red check and its real TLC run). */
export const TLC_SPEC = "---- MODULE Flag ----\nEXTENDS Naturals\nVARIABLE done\nInit == done = FALSE\nNext == done' = TRUE\nNeverDone == done = FALSE\n====\n";
export const TLC_CFG = "INIT Init\nNEXT Next\nINVARIANT NeverDone\n";
/** Runs TLC from the tools volume in image, offline, on a copy of the spec in /tmp; returns its exit and output. */
export function runTlc(image: string): { exit: number; out: string } {
  const script = 'set -e; d=$(mktemp -d); cd "$d"; printf "%s" "$0" > Flag.tla; printf "%s" "$1" > Flag.cfg; "$JAVA" -XX:+UseSerialGC -cp "$TLA2TOOLS" tlc2.TLC -workers 1 -metadir "$d/states" Flag';
  const r = docker(["run", "--rm", "--network", "none", "--mount", toolsMount(), ...toolsEnv(image).flatMap((e) => ["-e", e]), "--entrypoint", "bash", image, "-c", script, TLC_SPEC, TLC_CFG], 600_000);
  return { exit: r.status ?? -1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}
