import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeBackend, fakeHosts, fakeSpec, fakeWorld } from "../../../lanes/design-constructed/stage3/fake.ts";
import { sandboxed } from "../../../lanes/design-constructed/stage3/sandbox.ts";
import { keyedUbicloud, sshArgs, sshRunner } from "../../../lanes/design-constructed/stage3/ubicloud-real.ts";

// Ubicloud reuses addresses. Launch 7's recipe VM came up on an address an earlier sandbox VM had held, with a new host
// key, and the one known_hosts file every sandbox VM shared made ssh refuse it: the first preamble step exited 255 and
// the audit could not collect. Each VM now has its own known_hosts file, named by its id.
describe("one known_hosts file per sandbox VM", () => {
  const twoVms = async (knownHostsDir?: string) => {
    const w = fakeWorld({ reuseAddresses: true, knownHostsDir });
    const d = { backend: fakeBackend(w), hosts: fakeHosts(), now: () => 0 };
    const files: Array<string | null> = [];
    const job = async (vm: { id: string }) => {
      files.push(knownHostsDir && existsSync(join(knownHostsDir, vm.id)) ? readFileSync(join(knownHostsDir, vm.id), "utf8") : null);
      return "done";
    };
    const first = await sandboxed(d, fakeSpec({ label: "recipe session c012" }), job);
    const second = await sandboxed(d, fakeSpec({ label: "recipe session c013" }), job);
    return { w, first, second, files };
  };

  test("the old shared file fails a VM on a reused address with a new key the way real ssh did", async () => {
    const { w, first, second } = await twoVms();
    expect(w.vms[1]!.ip).toBe(w.vms[0]!.ip);
    expect(w.vms[1]!.hostKey).not.toBe(w.vms[0]!.hostKey);
    expect(first.error).toBeNull();
    expect(first.audit.ok).toBe(true);
    expect(second.value).toBeNull();
    expect(second.error).toMatch(/^preamble step failed \(exit 255\): systemctl stop apt-daily/);
    expect(second.error).toContain("REMOTE HOST IDENTIFICATION HAS CHANGED");
    expect(second.error).toContain("Host key verification failed.");
    expect(second.audit.ok).toBe(false);
    expect((second.audit as { kind?: string }).kind).toBe("uncollected");
  });

  test("a file per VM id passes both VMs on the reused address, and each file is removed when its VM is deleted", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dc-kh-"));
    const { w, first, second, files } = await twoVms(join(dir, "known_hosts.d"));
    expect(w.vms[1]!.ip).toBe(w.vms[0]!.ip);
    for (const r of [first, second]) {
      expect(r.error).toBeNull();
      expect(r.value).toBe("done");
      expect(r.audit.ok).toBe(true);
    }
    expect(files).toEqual([w.vms[0]!.ip + " " + w.vms[0]!.hostKey + "\n", w.vms[1]!.ip + " " + w.vms[1]!.hostKey + "\n"]);
    for (const vm of w.vms) expect(existsSync(join(dir, "known_hosts.d", vm.id))).toBe(false);
  });

  test("a VM's own file still refuses a changed key on that VM's address", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dc-kh-"));
    const w = fakeWorld({ knownHostsDir: dir });
    const backend = fakeBackend(w);
    const vm = await backend.create(fakeSpec());
    expect((await backend.exec(vm, "true", { user: "root" })).exit).toBe(0);
    w.vms[0]!.hostKey = "ssh-ed25519 AAAAsomeoneelse";
    const r = await backend.exec(vm, "true", { user: "root" });
    expect(r.exit).toBe(255);
    expect(r.stderr).toContain("Host key verification failed.");
  });

  test("the real runner names the call's own file and keeps accept-new; keyedUbicloud keeps the files beside the launch's", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dc-kh-"));
    const base = { keyPath: join(dir, "key"), knownHosts: join(dir, "known_hosts"), program: "echo", wrap: (c: string) => c };
    const echoed = await sshRunner(base)("10.1.0.10", "true", { user: "root", knownHosts: join(dir, "known_hosts.d", "vm-a") });
    expect(echoed.stdout).toContain("UserKnownHostsFile=" + join(dir, "known_hosts.d", "vm-a"));
    expect(echoed.stdout).not.toContain("UserKnownHostsFile=" + join(dir, "known_hosts") + " ");
    const args = sshArgs(base, "10.1.0.10");
    expect(args).toContain("StrictHostKeyChecking=accept-new");
    expect(args.join(" ")).not.toContain("StrictHostKeyChecking=no");
    const seen: Array<string | undefined> = [];
    const api = (async (_u: string, init: { body?: string }) => {
      const argv = (JSON.parse(String(init.body)) as { argv: string[] }).argv;
      return argv[2] === "show" ? new Response("state: running\nip4: 10.1.0.10\nprivate-ipv4: \n") : new Response("ok");
    }) as unknown as typeof fetch;
    const keyed = await keyedUbicloud({ project: "pj", location: "loc", size: "standard-2", image: "ubuntu-noble", env: { UBICLOUD_API_KEY: "invented" }, keyPath: join(dir, "ssh", "id"), knownHosts: join(dir, "ssh", "known_hosts"), fetch: api, ssh: async (_h, _c, o) => (seen.push(o.knownHosts), { exit: 0, stdout: "", stderr: "" }) });
    const vm = await keyed.create(fakeSpec());
    await keyed.exec(vm, "true");
    expect(seen).toEqual([join(dir, "ssh", "known_hosts.d", vm.id)]);
    expect(readFileSync(join(dir, "ssh", "known_hosts.d", vm.id), "utf8")).toBe("");
    await keyed.destroy(vm);
    expect(existsSync(join(dir, "ssh", "known_hosts.d", vm.id))).toBe(false);
  });
});
