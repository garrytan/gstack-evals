// Copyright (c) 2026 Garry Tan. MIT License.
// lanes/decision-routing/host/vm.sh against a fake runner: the sha256 pin and the owner and TTL checks refuse before any
// runner call; up lists, creates, runs post-boot hygiene over ssh stdin and lists again; keys travel on stdin only; down
// checks list --mine is empty.

import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PROXY_PORT_COUNT, PROXY_PORT_FIRST } from "../../lanes/decision-routing/host/controller.ts";

const HOST = join(import.meta.dir, "../../lanes/decision-routing/host");
const FAKE = ["#!/usr/bin/env bash", 'printf "%s\\n" "$*" >> "$FAKE_LOG"', "case $1 in", '  list) cat "$FAKE_STATE" 2> /dev/null || true ;;', '  up) echo "vm-1  loc" > "$FAKE_STATE"; echo vm-1 ;;', '  ssh) cat > "$FAKE_STDIN/$(ls "$FAKE_STDIN" | wc -l)" ;;', '  down) [ -n "$FAKE_LEAVE" ] || : > "$FAKE_STATE" ;;', "esac", ""].join("\n");
const KEYS = { ANTHROPIC_API_KEY: "sk-ant-vmtest-0123", OPENAI_API_KEY: "sk-oai-vmtest-0123", OPENROUTER_API_KEY: "sk-or-vmtest-0123", TYPESAFE_API_KEY: "ts-vmtest-0123" };

let dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

function rig() {
  const dir = mkdtempSync(join(tmpdir(), "dr-vm-"));
  dirs.push(dir);
  const runner = join(dir, "ubi-runner.sh");
  writeFileSync(runner, FAKE);
  chmodSync(runner, 0o755);
  const stdin = join(dir, "stdin");
  mkdirSync(stdin);
  const base = { PATH: process.env.PATH!, FAKE_LOG: join(dir, "log"), FAKE_STATE: join(dir, "state"), FAKE_STDIN: stdin, FAKE_LEAVE: "" };
  const run = (args: string[], env: Record<string, string> = {}, sha = createHash("sha256").update(FAKE).digest("hex")) => {
    const r = Bun.spawnSync(["bash", join(HOST, "vm.sh"), runner, sha, ...args], { env: { ...base, UBI_OWNER: "GEVA-TEST", UBI_TTL_HOURS: "8", ...env } });
    return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
  };
  const log = () => (existsSync(base.FAKE_LOG) ? readFileSync(base.FAKE_LOG, "utf8").trim().split("\n") : []);
  const inputs = () => readdirSync(stdin).sort().map((f) => readFileSync(join(stdin, f), "utf8"));
  return { run, log, inputs };
}

describe("vm.sh", () => {
  test("a runner off its pinned sha256 is refused before any call", () => {
    const r = rig();
    const res = r.run(["up"], {}, "0".repeat(64));
    expect(res.code).toBe(2);
    expect(res.err).toStartWith("E_DR_RUNNER: ");
    expect(r.log()).toEqual([]);
  });

  test("UBI_OWNER and UBI_TTL_HOURS are required", () => {
    const r = rig();
    for (const env of [{ UBI_OWNER: "" }, { UBI_TTL_HOURS: "" }, { UBI_TTL_HOURS: "3h" }] as Record<string, string>[]) {
      const res = r.run(["up"], env);
      expect(res.code).toBe(2);
      expect(res.err).toStartWith("E_DR_RUNNER: ");
    }
    expect(r.log()).toEqual([]);
  });

  test("up lists this owner's VMs, creates one, runs the post-boot hygiene over ssh stdin, and lists again", () => {
    const r = rig();
    const res = r.run(["up"]);
    expect(res.code).toBe(0);
    expect(r.log()).toEqual(["list --mine", "up -s standard-16 -S 640", "ssh vm-1 bash -s", "list --mine"]);
    expect(r.inputs()).toEqual([readFileSync(join(HOST, "post-boot.sh"), "utf8")]);
    expect(res.out).toContain("vm: vm-1");
  });

  test("the post-boot script turns apt off, enables linger and sets the run user's environment", () => {
    const s = readFileSync(join(HOST, "post-boot.sh"), "utf8");
    for (const line of [
      "sudo systemctl stop apt-daily.timer apt-daily-upgrade.timer",
      "sudo systemctl disable apt-daily.timer apt-daily-upgrade.timer",
      "sudo systemctl stop apt-daily.service apt-daily-upgrade.service unattended-upgrades.service",
      "sudo systemctl mask apt-daily.service apt-daily-upgrade.service unattended-upgrades.service",
      "systemctl list-timers",
      "pgrep -a apt",
      "sudo loginctl enable-linger",
      "export NODE_DISABLE_COMPILE_CACHE=1",
      "export HARBOR_TELEMETRY=0",
    ]) expect([line, s.includes(line)]).toEqual([line, true]);
    expect(s).not.toContain("pgrep -f");
  });

  test("keys travel only on ssh stdin into a umask 077 file, never on a command line", () => {
    const r = rig();
    const res = r.run(["keys", "vm-1"], KEYS);
    expect(res.code).toBe(0);
    expect(r.log()).toEqual(["ssh vm-1 umask 077; cat > ~/.dr-keys"]);
    expect(r.inputs()).toEqual([Object.entries(KEYS).map(([k, v]) => k + "=" + v + "\n").join("")]);
    for (const v of Object.values(KEYS)) expect(r.log().join("\n") + res.out + res.err).not.toContain(v);
  });

  test("down destroys the VM and passes only when list --mine is empty", () => {
    const r = rig();
    r.run(["up"]);
    expect(r.run(["down", "vm-1"]).code).toBe(0);
    r.run(["up"]);
    const left = r.run(["down", "vm-1"], { FAKE_LEAVE: "1" });
    expect(left.code).toBe(2);
    expect(left.err).toStartWith("E_DR_RUNNER: owner GEVA-TEST still has VMs after down vm-1");
  });
});

describe("post-boot.sh kernel check", () => {
  const check = (config: string) => {
    const dir = mkdtempSync(join(tmpdir(), "dr-kernel-"));
    dirs.push(dir);
    writeFileSync(join(dir, "config"), config);
    const r = Bun.spawnSync(["bash", join(HOST, "post-boot.sh"), "--kernel-config", join(dir, "config")]);
    return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
  };

  test("a kernel config with CONFIG_NFT_FIB_INET built in or as a module passes", () => {
    for (const line of ["CONFIG_NFT_FIB_INET=y", "CONFIG_NFT_FIB_INET=m"]) {
      const r = check("CONFIG_NF_TABLES_INET=y\n" + line + "\nCONFIG_NFT_FIB_IPV4=m\n");
      expect(r.code).toBe(0);
      expect(r.out).toContain("CONFIG_NFT_FIB_INET");
    }
  });

  test("a kernel config without CONFIG_NFT_FIB_INET is refused with E_DR_RUNNER", () => {
    for (const config of ["CONFIG_NF_TABLES_INET=y\n# CONFIG_NFT_FIB_INET is not set\n", "CONFIG_NFT_FIB_IPV4=m\nCONFIG_NFT_FIB_INET_X=y\n", ""]) {
      const r = check(config);
      expect(r.code).toBe(2);
      expect(r.err).toStartWith("E_DR_RUNNER: ");
    }
  });
});

describe("post-boot.sh container firewall", () => {
  test("containers on Docker's bridges reach the host only on the controller's fixed proxy ports: every other new TCP connection to the host is reset", () => {
    const r = Bun.spawnSync(["bash", join(HOST, "post-boot.sh"), "--firewall-rules"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.toString().trim().split("\n")).toEqual([
      "-N DR_CONTAINER_IN",
      "-A DR_CONTAINER_IN -p tcp -m tcp --dport " + PROXY_PORT_FIRST + ":" + (PROXY_PORT_FIRST + PROXY_PORT_COUNT - 1) + " -j RETURN",
      "-A DR_CONTAINER_IN -p tcp -m conntrack --ctstate NEW -j REJECT --reject-with tcp-reset",
      "-A INPUT -i docker0 -j DR_CONTAINER_IN",
      "-A INPUT -i br-+ -j DR_CONTAINER_IN",
    ]);
  });

  test("the hygiene step installs those rules and refuses a runner where they don't read back", () => {
    const s = readFileSync(join(HOST, "post-boot.sh"), "utf8");
    expect(s).toContain("sudo iptables -S DR_CONTAINER_IN");
    expect(s).toContain("E_DR_RUNNER: the container firewall");
  });
});

