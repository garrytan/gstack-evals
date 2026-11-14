// Copyright (c) 2026 Garry Tan. MIT License.
// The controller's install in a sandbox VM (stage3/install.ts, the Captain's ruling on open item 1D, option 1): the apt
// list against the installed playwright-core's own, which folders each VM gets, and the install itself over the real
// SSH runner against a local sshd (a local stand-in for a Ubicloud VM): the tar unpacked, the check run, and every file
// it wrote listed with its digest, so the audit counts those files as the controller's only while they still match.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { BROWSER_ROOT, browserFiles, CHROMIUM_APT, claudeFiles, controllerBackend, installControllerFiles, tarOf, type ControllerFiles } from "../../../lanes/design-constructed/stage3/install.ts";
import { controllerOwned, describeCommand, parseDescribe, type Vm, type VmBackend } from "../../../lanes/design-constructed/stage3/sandbox.ts";
import { freePort, keyedUbicloud, portOpen, runProcess, sshRunner } from "../../../lanes/design-constructed/stage3/ubicloud-real.ts";
import { fakeSpec } from "../../../lanes/design-constructed/stage3/fake.ts";

const SSHD = ["/usr/sbin/sshd", "/usr/bin/sshd"].find((p) => existsSync(p));
const KEYGEN = ["/usr/bin/ssh-keygen"].find((p) => existsSync(p));

/** playwright-core's install-deps list for chromium on ubuntu24.04-x64: its tools, then its chromium libraries. */
function playwrightApt(): string[] {
  const text = readFileSync(join(import.meta.dir, "..", "..", "..", "node_modules", "playwright-core", "lib", "coreBundle.js"), "utf8");
  const at = text.indexOf('"ubuntu24.04-x64": {', text.indexOf("deps = {"));
  const list = (key: string) => [.../\[([^\]]*)\]/.exec(text.slice(text.indexOf(key + ": [", at)))![1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
  return [...list("tools"), ...list("chromium")];
}

function recording(): VmBackend & { log: string[] } {
  const log: string[] = [];
  return {
    log,
    create: async () => ({}) as Vm,
    exec: async (_vm, command, eo) => (log.push((eo?.user ?? "run") + " " + command), { exit: 0, stdout: command.includes("controller.list") ? "DC-CTL-DONE\n" : "", stderr: "" }),
    write: async (_vm, path) => void log.push("write " + path),
    read: async () => new Uint8Array(),
    destroy: async () => {},
  };
}

describe("the controller's install", () => {
  test("the apt list is playwright-core's own for chromium on ubuntu24.04-x64", () => {
    expect([...CHROMIUM_APT]).toEqual(playwrightApt());
  });

  test("every VM gets the browser from the apt mirror; an agent's VM gets Claude Code too; the browser seam's binary is under the browser root", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dc-inst-"));
    const browser = browserFiles(dir, "chrome-linux/chrome");
    expect(browser.check).toContain("test -x '" + BROWSER_ROOT + "/chrome-linux/chrome'");
    expect(() => browserFiles(dir, "../chrome")).toThrow("a path inside the build folder");
    const inner = recording();
    const b = controllerBackend(inner, { browser, agent: claudeFiles(async () => new Uint8Array()) });
    await b.prepare!({ id: "v1", spec: fakeSpec({ proxy: null }) } as unknown as Vm);
    expect(inner.log.filter((l) => l.startsWith("write ")).map((l) => l.split("/").pop())).toEqual(["browser.tar"]);
    expect(inner.log.find((l) => l.includes("apt-get install"))).toEndWith("--no-install-recommends " + CHROMIUM_APT.join(" "));
    inner.log.length = 0;
    await b.prepare!({ id: "v2", spec: fakeSpec() } as unknown as Vm);
    expect(inner.log.filter((l) => l.startsWith("write ")).map((l) => l.split("/").pop())).toEqual(["browser.tar", "claude-code.tar"]);
    expect(inner.log.filter((l) => l.startsWith("run ")).map((l) => l.slice(4))).toEqual([browser.check, "'/opt/dc-agent/package/claude' --version"]);
    rmSync(dir, { recursive: true, force: true });
  });

  test("a bad name or package refuses before anything runs", async () => {
    const inner = recording();
    const it = (o: Partial<ControllerFiles>): ControllerFiles => ({ name: "x", root: "/opt/x", tar: async () => new Uint8Array(), apt: [], check: "true", ...o });
    await expect(installControllerFiles(inner, {} as Vm, [it({ name: "X Y" })])).rejects.toThrow("is not a plain name");
    await expect(installControllerFiles(inner, {} as Vm, [it({ apt: ["a;b"] })])).rejects.toThrow("which is not a package name");
    expect(inner.log).toEqual([]);
  });
});

describe.skipIf(!SSHD || !KEYGEN)("the controller's install over SSH against a local sshd", () => {
  let dir = "";
  let sshd: ReturnType<typeof Bun.spawn> | null = null;
  let backend: VmBackend;
  let vm: Vm;
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "dc-inst-ssh-"));
    const port = await freePort();
    const login = new TextDecoder().decode((await runProcess(["id", "-un"])).stdout).trim();
    for (const k of ["host", "client"]) await runProcess([KEYGEN!, "-q", "-t", "ed25519", "-N", "", "-f", join(dir, k)]);
    writeFileSync(join(dir, "authorized_keys"), readFileSync(join(dir, "client.pub"), "utf8"), { mode: 0o600 });
    writeFileSync(join(dir, "sshd_config"), ["Port " + port, "ListenAddress 127.0.0.1", "HostKey " + join(dir, "host"), "AuthorizedKeysFile " + join(dir, "authorized_keys"), "PidFile " + join(dir, "sshd.pid"), "StrictModes no", "UsePAM no", "PasswordAuthentication no", "KbdInteractiveAuthentication no"].join("\n") + "\n");
    sshd = Bun.spawn([SSHD!, "-D", "-e", "-f", join(dir, "sshd_config")], { stdout: "ignore", stderr: "ignore" });
    await portOpen(port, 10_000);
    const ssh = sshRunner({ keyPath: join(dir, "client"), knownHosts: join(dir, "known_hosts"), login, extra: ["-p", String(port)], wrap: (c) => c });
    const api = (async (_url: string, init: { method: string }) => (init.method === "GET" ? Response.json({ state: "running", ip4: "127.0.0.1", private_ipv4: "10.0.0.9/32" }) : init.method === "POST" ? Response.json({}) : new Response(null, { status: 204 }))) as unknown as typeof fetch;
    const keyed = await keyedUbicloud({ project: "pj", location: "loc", size: "standard-2", image: "ubuntu-noble", env: { UBICLOUD_API_KEY: "invented" }, keyPath: join(dir, "client"), knownHosts: join(dir, "known_hosts"), fetch: api, ssh });
    backend = keyed;
    vm = await keyed.create(fakeSpec({ proxy: null }));
  });
  afterAll(async () => {
    sshd?.kill("SIGTERM");
    await sshd?.exited;
    rmSync(dir, { recursive: true, force: true });
  });

  test("the build is copied and unpacked, its check runs, and the manifest lists what it wrote; a changed file stops being the controller's", async () => {
    const build = join(dir, "build");
    mkdirSync(join(build, "chrome-linux"), { recursive: true });
    writeFileSync(join(build, "chrome-linux", "chrome"), "#!/bin/sh\necho stand-in browser\n", { mode: 0o755 });
    writeFileSync(join(build, "chrome-linux", "resources.pak"), "pak\n");
    const root = join(dir, "vmroot");
    const into = join(root, "opt", "dc-browser");
    const item: ControllerFiles = { name: "browser", root: into, tar: () => tarOf(build), apt: [], check: "test -x '" + into + "/chrome-linux/chrome' && '" + into + "/chrome-linux/chrome'" };
    const audit = join(dir, "audit");
    const listed = await installControllerFiles(backend, vm, [item], { auditDir: audit, scanRoot: root });
    const sha = (s: string) => createHash("sha256").update(s).digest("hex");
    const files = listed.filter((e) => e.type === "f").map((e) => [e.path, e.digest]);
    expect(files.sort()).toEqual([
      [into + "/chrome-linux/chrome", sha("#!/bin/sh\necho stand-in browser\n")],
      [into + "/chrome-linux/resources.pak", sha("pak\n")],
    ]);
    expect(existsSync(join(audit, "browser.tar"))).toBe(false);
    writeFileSync(join(into, "chrome-linux", "resources.pak"), "changed by the agent\n");
    writeFileSync(join(audit, "now.list"), listed.map((e) => e.path + "\0").join(""));
    const now = parseDescribe((await backend.exec(vm, describeCommand(join(audit, "now.list")), { user: "root" })).stdout)!;
    expect([...controllerOwned(listed, now)].filter((p) => p.endsWith("chrome") || p.endsWith(".pak"))).toEqual([into + "/chrome-linux/chrome"]);
  }, 60_000);

  test("a check that fails is a failure outside the agent", async () => {
    const item: ControllerFiles = { name: "browser", root: join(dir, "vmroot2"), tar: () => tarOf(join(dir, "build")), apt: [], check: "false" };
    await expect(installControllerFiles(backend, vm, [item], { auditDir: join(dir, "audit2"), scanRoot: join(dir, "vmroot2") })).rejects.toThrow("failed at browser's check");
  }, 60_000);
});
