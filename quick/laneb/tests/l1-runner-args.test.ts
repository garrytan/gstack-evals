// The pinned ubi-runner against the `up` call launch.sh makes on L1's awake host (GEVA-302, GST-1432). Keyless: the real
// runner (quick/laneb/l1/ubi-runner.sh, pinned by sha256) runs with a stand-in curl that records each request and answers
// 400, so nothing leaves the machine. Every argument launch.sh passes, resolved from the host.env l1.ts writes, must get
// through the runner's own checks and reach Ubicloud's create request unchanged. At build 38aaa9e launch.sh asked for
// 600 GiB, which the runner refuses before any request, and every L1 part failed to get a VM; a fake runner hid that.
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hostEnvText } from "../l1/l1.ts";

const LANEB = join(import.meta.dir, "..");
const RUNNER = join(LANEB, "l1/ubi-runner.sh");
// gstack 53593535's scripts/ubicloud/ubi-runner.sh with upstream 3374c583's API key header line, the copy L1 runs pin as
// UBI_RUNNER_SHA256. Runs that pinned c040c5b5 used 53593535's file unchanged.
const RUNNER_SHA256 = "21b321e61f12350fd97104bbd13cbb1e685b74755386ea180da1330d7af419cb";

// host.sh sources host.env, then exports these before it runs launch.sh.
function hostEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of hostEnvText("pilot-opus", 80, "GEVA-302").split("\n")) { const m = /^([A-Z_]+)=(.*)$/.exec(line); if (m) env[m[1]!] = m[2]!; }
  const exported = /^export (.*)$/m.exec(readFileSync(join(LANEB, "l1/host.sh"), "utf8"))![1]!;
  for (const m of exported.matchAll(/([A-Z_]+)="?([^"\s]*)"?/g)) if (m[1]!.startsWith("UBI_COUNTED")) env[m[1]!] = m[2]!;
  return env;
}

// launch.sh's one `up` call, its arguments resolved the way bash resolves ${NAME:-default} under the host's environment.
function upArgs(env: Record<string, string>): string[] {
  const calls = [...readFileSync(join(LANEB, "runner/launch.sh"), "utf8").matchAll(/"\$S" up ([^)\n]*)\)/g)];
  expect(calls.length).toBe(1);
  return [...calls[0]![1]!.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => (m[1] ?? m[2]!).replace(/\$\{([A-Z_]+):-([^}]*)\}/g, (_, k: string, d: string) => env[k] || d));
}

// The flags the runner's cmd_up accepts, read from its option parser.
function upFlags(): Set<string> {
  const src = readFileSync(RUNNER, "utf8");
  const body = src.slice(src.indexOf("cmd_up() {"), src.indexOf("esac", src.indexOf("cmd_up() {")));
  return new Set([...body.matchAll(/^\s+((?:-[-\w]+)(?:\|-[-\w]+)*)\)/gm)].flatMap((m) => m[1]!.split("|")));
}

async function runUp(args: string[], env: Record<string, string>) {
  const t = mkdtempSync(join(tmpdir(), "l1-runner-"));
  mkdirSync(join(t, "bin")); mkdirSync(join(t, "home")); mkdirSync(join(t, "rec"));
  const log = join(t, "requests.log");
  writeFileSync(join(t, "bin/curl"), "#!/bin/sh\n{ cat; echo; } >> '" + log + "'\nprintf 400\n");
  chmodSync(join(t, "bin/curl"), 0o755);
  writeFileSync(log, "");
  const p = Bun.spawn(["setsid", "bash", RUNNER, "up", ...args], {
    env: { PATH: join(t, "bin") + ":/usr/bin:/bin", HOME: join(t, "home"), UBICLOUD_API_KEY: "test-only", UBI_RECOVERY_DIR: join(t, "rec"), UBI_RUNNER_STATE: join(t, "state"), UBI_VM_RECORD: join(t, "vms.tsv"), ...env },
    stdin: "ignore", stdout: "pipe", stderr: "pipe",
  });
  let create: string[] | null = null;
  for (let i = 0; i < 150 && !create; i++) {
    const row = readFileSync(log, "utf8").split("\n").find((l) => l.includes('"create"'));
    if (row) create = JSON.parse(row).argv;
    else if (p.exitCode !== null) break;
    else await Bun.sleep(100);
  }
  try { process.kill(-p.pid, "SIGKILL"); } catch {}
  await p.exited;
  return { create, err: await new Response(p.stderr).text() };
}

describe("launch.sh's up call against the pinned ubi-runner", () => {
  test("the vendored runner is the pinned copy", () => {
    expect(createHash("sha256").update(readFileSync(RUNNER)).digest("hex")).toBe(RUNNER_SHA256);
  });

  test("every flag launch.sh passes is one the runner's up accepts", () => {
    const flags = upFlags();
    expect(flags.has("-S")).toBe(true);
    for (const a of upArgs(hostEnv()).filter((a) => a.startsWith("-"))) expect(flags.has(a)).toBe(true);
  });

  test("every argument gets through the runner's own checks into Ubicloud's create request", async () => {
    const env = hostEnv(), args = upArgs(env);
    expect(env.UBI_OWNER).toBe("GEVA-302");
    const r = await runUp(args, { UBI_OWNER: env.UBI_OWNER!, UBI_TTL_HOURS: env.UBI_TTL_HOURS!, UBI_COUNTED: env.UBI_COUNTED ?? "" });
    expect(r.err).not.toMatch(/invalid |unknown option|expected key=value|must be a path/);
    expect(r.create).not.toBeNull();
    for (let i = 0; i < args.length; i += 2) {
      const at = r.create!.indexOf(args[i]!);
      expect(at).toBeGreaterThan(-1);
      expect(r.create![at + 1]).toBe(args[i + 1]!);
    }
    expect(r.create![1]).toMatch(new RegExp("/ubirun-geva302-\\d+-[0-9a-f]+-t" + env.UBI_TTL_HOURS + "$"));
  }, 30000);
});

// GST-3959: the runner's API calls send the Ubicloud key as a header read from a file descriptor, never as a curl
// argument, where any local user could read it from the process list. Keyless: a stand-in curl records its arguments
// and the header files it was handed, and the real curl talks only to a local server. The value is an inert dummy.
describe("the pinned ubi-runner keeps the Ubicloud key out of curl's arguments", () => {
  const KEY = "dummy-not-a-key-GST3959-4711";

  test("a stand-in curl sees the key only in a header file, never in its argv", () => {
    const t = mkdtempSync(join(tmpdir(), "l1-runner-key-"));
    const argv = join(t, "argv.log"), hdr = join(t, "hdr.log");
    mkdirSync(join(t, "bin"));
    writeFileSync(join(t, "bin/curl"), [
      "#!/usr/bin/env bash",
      "printf '%s\\n' \"$*\" >> '" + argv + "'",
      "out=''; prev=''",
      "for a in \"$@\"; do",
      "  [ \"$prev\" = -o ] && out=$a",
      "  [ \"$prev\" = -H ] && case $a in @*) cat \"${a#@}\" >> '" + hdr + "' ;; esac",
      "  prev=$a",
      "done",
      "cat >/dev/null; printf '' > \"$out\"; printf 200",
      "",
    ].join("\n"));
    chmodSync(join(t, "bin/curl"), 0o755);
    writeFileSync(argv, ""); writeFileSync(hdr, "");
    const r = Bun.spawnSync(["bash", RUNNER, "cli", "vm", "list"], {
      env: { PATH: join(t, "bin") + ":/usr/bin:/bin", HOME: t, UBICLOUD_API_KEY: KEY, UBI_RUNNER_STATE: join(t, "state") },
      timeout: 10_000,
    });
    expect(r.exitCode, r.stderr.toString()).toBe(0);
    expect(readFileSync(argv, "utf8")).toContain("/cli");
    expect(readFileSync(argv, "utf8")).not.toContain(KEY);
    expect(readFileSync(hdr, "utf8")).toBe("Authorization: Bearer " + KEY + "\n");
  });

  test("the real curl still sends the Authorization header to the API", async () => {
    const t = mkdtempSync(join(tmpdir(), "l1-runner-key-"));
    let seen = "";
    const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch(req) { seen = req.headers.get("authorization") ?? ""; return new Response("eu-central-h1 vm-a\n"); } });
    try {
      const p = Bun.spawn(["bash", RUNNER, "cli", "vm", "list"], {
        env: { PATH: "/usr/bin:/bin", HOME: t, UBICLOUD_API_KEY: KEY, UBI_RUNNER_STATE: join(t, "state"), UBICLOUD_API_URL: "http://127.0.0.1:" + server.port },
        stdout: "pipe", stderr: "pipe",
      });
      expect(await p.exited).toBe(0);
      expect(await new Response(p.stdout).text()).toBe("eu-central-h1 vm-a\n");
      expect(seen).toBe("Bearer " + KEY);
    } finally { server.stop(true); }
  }, 20000);
});
