// Copyright (c) 2026 Garry Tan. MIT License.
// The real SSH runner, tunnel and WAL transport against a local sshd on a loopback port (a local SSH stand-in for a
// Ubicloud VM): stdin, raw output, exit codes and the time limit; a forward to a local page; and the controller's
// pinned WAL key, which reaches walctl and nothing else. Skipped when sshd or ssh-keygen is missing.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RemoteTarget, sshWalTransport, walAuthorizedKey, WALCTL_PY } from "../../../lanes/design-constructed/money/offhost.ts";
import { WriteAhead } from "../../../lanes/design-constructed/money/wal.ts";
import type { Vm } from "../../../lanes/design-constructed/stage3/sandbox.ts";
import { asUser, freePort, keyedUbicloud, portOpen, realUbicloud, runProcess, sshRunner, sshTunnel, type SshOptions } from "../../../lanes/design-constructed/stage3/ubicloud-real.ts";

const SSHD = ["/usr/sbin/sshd", "/usr/bin/sshd"].find((p) => existsSync(p));
const KEYGEN = ["/usr/bin/ssh-keygen"].find((p) => existsSync(p));

let dir = "";
let port = 0;
let sshd: ReturnType<typeof Bun.spawn> | null = null;
let login = "";
let plain: SshOptions;
let pinned: SshOptions;

describe.skipIf(!SSHD || !KEYGEN)("SSH against a local sshd", () => {
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "dc-ssh-"));
    port = await freePort();
    login = new TextDecoder().decode((await runProcess(["id", "-un"])).stdout).trim();
    for (const k of ["host", "client", "walkey"]) await runProcess([KEYGEN!, "-q", "-t", "ed25519", "-N", "", "-f", join(dir, k)]);
    const script = join(dir, "walctl.py");
    writeFileSync(script, WALCTL_PY);
    mkdirSync(join(dir, "wal"));
    await runProcess(["python3", script, join(dir, "wal"), "init"]);
    const pub = (k: string) => readFileSync(join(dir, k + ".pub"), "utf8");
    writeFileSync(join(dir, "authorized_keys"), pub("client") + walAuthorizedKey(pub("walkey"), { script, dir: join(dir, "wal") }) + "\n", { mode: 0o600 });
    writeFileSync(join(dir, "sshd_config"), ["Port " + port, "ListenAddress 127.0.0.1", "HostKey " + join(dir, "host"), "AuthorizedKeysFile " + join(dir, "authorized_keys"), "PidFile " + join(dir, "sshd.pid"), "StrictModes no", "UsePAM no", "PasswordAuthentication no", "KbdInteractiveAuthentication no"].join("\n") + "\n");
    sshd = Bun.spawn([SSHD!, "-D", "-e", "-f", join(dir, "sshd_config")], { stdout: "ignore", stderr: "ignore" });
    await portOpen(port, 10_000);
    const base = { knownHosts: join(dir, "known_hosts"), login, extra: ["-p", String(port)] };
    plain = { ...base, keyPath: join(dir, "client") };
    pinned = { ...base, keyPath: join(dir, "walkey") };
  });
  afterAll(async () => {
    sshd?.kill("SIGTERM");
    await sshd?.exited;
    rmSync(dir, { recursive: true, force: true });
  });

  test("the runner carries stdin and raw output, keeps the exit code and kills a command past its limit", async () => {
    const run = sshRunner({ ...plain, wrap: (c) => c });
    const echo = await run("127.0.0.1", "cat; printf done", { input: new TextEncoder().encode("line\n") });
    expect([echo.exit, echo.stdout]).toEqual([0, "line\ndone"]);
    expect((await run("127.0.0.1", "exit 7", {})).exit).toBe(7);
    expect((await run("127.0.0.1", "sleep 20", { timeoutMs: 500 })).exit).toBe(124);
    expect(asUser("id", "run", "run")).toBe("sudo -n -u run -H bash -c 'cd ~ && id'");
    expect(asUser("echo 'x'", "root")).toBe("sudo -n bash -c 'echo '\\''x'\\'''");
  }, 30_000);

  test("the tunnel forwards a local port to a loopback port behind SSH and closes", async () => {
    const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("behind the tunnel") });
    try {
      const open = sshTunnel(plain, () => "127.0.0.1");
      const t = await open({ id: "local" } as Vm, server.port!);
      expect(await (await fetch("http://127.0.0.1:" + t.port + "/")).text()).toBe("behind the tunnel");
      await t.close();
      expect(await portOpen(t.port, 300)).toBe(false);
    } finally {
      server.stop(true);
    }
  }, 30_000);

  test("the controller's pinned key reaches walctl only: appends acknowledge and anything else is refused", async () => {
    const target = new RemoteTarget(sshWalTransport(pinned, "127.0.0.1", 10_000, join(dir, "mux-%C")));
    const wal = new WriteAhead(target);
    await wal.append({ kind: "admit", n: 1 });
    await wal.append({ kind: "admit", n: 2 });
    expect((await target.lines()).length).toBe(2);
    await target.putSnapshot("snap-0000000002", new TextEncoder().encode("snap"));
    expect(await target.latestSnapshot()).toBe("snap-0000000002");
    const escape = await runProcess(["ssh", "-i", pinned.keyPath, "-o", "BatchMode=yes", "-o", "UserKnownHostsFile=" + pinned.knownHosts, "-p", String(port), login + "@127.0.0.1", "rm -rf " + join(dir, "wal")]);
    expect(escape.exit).toBe(2);
    expect(existsSync(join(dir, "wal", "wal.ndjson"))).toBe(true);
    await runProcess(["ssh", "-o", "ControlPath=" + join(dir, "mux-%C"), "-O", "exit", "-p", String(port), login + "@127.0.0.1"]);
  }, 30_000);
});

describe.skipIf(!KEYGEN)("the paid backend's construction", () => {
  test("it refuses with no Ubicloud token and, given one by name, makes its own key once", async () => {
    const d = mkdtempSync(join(tmpdir(), "dc-key-"));
    try {
      const o = { project: "pj-test", location: "eu-central-h1", size: "standard-2", image: "ubuntu-noble", keyPath: join(d, "keys", "launch_ed25519"), knownHosts: join(d, "keys", "known_hosts") };
      expect(() => realUbicloud({ ...o, publicKey: "ssh-ed25519 AAAA", ssh: async () => ({ exit: 0, stdout: "", stderr: "" }), env: {} })).toThrow("UBICLOUD_API_KEY is not set");
      await keyedUbicloud({ ...o, env: { UBICLOUD_API_KEY: "test-not-a-token" } });
      const first = readFileSync(o.keyPath, "utf8");
      await keyedUbicloud({ ...o, env: { UBICLOUD_API_KEY: "test-not-a-token" } });
      expect(readFileSync(o.keyPath, "utf8")).toBe(first);
      expect(statSync(o.keyPath).mode & 0o777).toBe(0o600);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});
