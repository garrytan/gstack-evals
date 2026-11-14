import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bytes, fakeBackend, fakeHosts, fakeSpec, fakeWorld, type FakeWorld } from "../../../lanes/design-constructed/stage3/fake.ts";
import { AGENT_CLAUDE, AGENT_ROOT, BROWSER_ROOT, controllerBackend } from "../../../lanes/design-constructed/stage3/install.ts";
import { secretHit } from "../../../lanes/design-constructed/stage3/sandbox.ts";
import { runRecipePreflight } from "../../../lanes/design-constructed/wire/preflight.ts";
import { containerPreflight, fakeContainerSeams } from "../../../lanes/design-constructed/wire/preflight-container.ts";

// The preflight ran only a qualify VM, which has no proxy and installs no Claude Code, so it never exercised the recipe
// VM's install path; every recipe session of launch 7 then failed outside the agent. It now also runs one recipe VM and
// one review container, with no model call.
const recipeVm = async (w: FakeWorld) => {
  const browser = { name: "browser", root: BROWSER_ROOT, tar: async () => bytes("browser"), apt: [], check: "true" };
  const agent = { name: "claude-code", root: AGENT_ROOT, tar: async () => bytes("claude"), apt: [], check: "'" + AGENT_CLAUDE + "' --version" };
  const hosts = fakeHosts();
  const backend = controllerBackend(fakeBackend(w), { browser, agent });
  const r = await runRecipePreflight({ sandbox: { backend, hosts, now: () => 0 }, spec: fakeSpec({ label: "preflight recipe" }) });
  for (const l of r.lines) expect(secretHit(l)).toBeNull();
  return { r, hosts, vm: w.vms[0]! };
};

describe("the preflight's recipe VM", () => {
  test("a clean recipe VM passes: Claude Code installed and checked as the run user, the proxy endpoint answers 404 for an unbound slot, and the audit shows the accepted proxy connection", async () => {
    const w = fakeWorld();
    const { r, hosts, vm } = await recipeVm(w);
    expect(r.problems).toEqual([]);
    expect(vm.installed).toContain(AGENT_ROOT + "/payload");
    expect(vm.calls.filter((c) => c.command === "'" + AGENT_CLAUDE + "' --version").map((c) => c.user)).toEqual(["run", "run"]);
    expect(vm.calls.some((c) => c.user === "run" && c.command.startsWith("curl ") && c.command.includes("/dc-preflight-unbound'"))).toBe(true);
    const p = vm.spec!.proxy!;
    expect(r.lines).toEqual(["preamble: ok", "install: ok, Claude Code included", "Claude Code's check as the run user: ok", "the proxy endpoint from the run user: HTTP 404 for an unbound slot, no model called", "audit: ok", expect.stringMatching(/^egress: \d+ accepted \(1 to the proxy endpoint\), 1 blocked$/), "vm: " + vm.id + " deleted, 0.0 measured minutes"]);
    expect(w.deleted).toEqual([vm.id]);
    expect(hosts.admitted.length).toBe(1);
    expect(p.port).toBeGreaterThan(0);
  });

  test("the agent tarball's check failing fails the preflight at the install and prints the step's cause", async () => {
    const w = fakeWorld({ handler: (_vm, c) => (c === "'" + AGENT_CLAUDE + "' --version" ? { exit: 126, stderr: "bash: line 1: " + AGENT_CLAUDE + ": Permission denied" } : undefined) });
    const { r } = await recipeVm(w);
    expect(r.problems).toContain("the install failed");
    expect(r.lines[1]).toMatch(/^install: the controller's install failed: the controller's install on \S+ failed at claude-code's check \(exit 126\): bash: line 1: \/opt\/dc-agent\/package\/claude: Permission denied$/);
    expect(w.vms[0]!.calls.some((c) => c.command.startsWith("curl "))).toBe(false);
  });

  test("an unreachable proxy endpoint fails the preflight and prints curl's cause", async () => {
    const { r } = await recipeVm(fakeWorld({ proxyDown: true }));
    expect(r.problems.length).toBe(1);
    expect(r.problems[0]).toMatch(/^the proxy endpoint from the run user: failed \(exit 7\): curl: \(7\) Failed to connect to \S+ port \d+ after 2 ms: Couldn't connect to server$/);
    expect(r.lines).toContain("audit: ok");
  });
});

describe("the preflight's review container", () => {
  const dir = () => mkdtempSync(join(tmpdir(), "dc-review-"));
  test("a clean container passes every step and its removal is checked", async () => {
    const s = fakeContainerSeams();
    const r = await containerPreflight(dir(), s);
    expect(r.problems).toEqual([]);
    expect(r.lines.map((l) => l.split(":")[0])).toEqual(["start", "C3 before the install", "gstack install", "C3 after the install", "claude --version, the no-model start", "removal"]);
    expect(s.stopped).toBe(1);
  });
  test("a container whose removal fails fails the preflight with E_DCW_CONTAINER_LEFT in the line", async () => {
    const r = await containerPreflight(dir(), fakeContainerSeams({ fail: "removal" }));
    expect(r.problems).toEqual([expect.stringMatching(/^removal: E_DCW_CONTAINER_LEFT: the review container dc-review-fake was not removed/)]);
  });
  test("an install digest that differs fails the preflight, and the container is still removed and checked", async () => {
    const s = fakeContainerSeams({ fail: "install-digest" });
    const r = await containerPreflight(dir(), s);
    expect(r.problems).toEqual(["the check stopped: E_DCW_INSTALL_DIGEST: the installed tree's digest differs from the pinned tree's"]);
    expect(s.stopped).toBe(1);
    expect(r.lines.at(-1)).toStartWith("removal: dc-review-fake removed");
  });
  test("a C3 problem before the install fails the preflight and skips the install", async () => {
    let installs = 0;
    const s = { ...fakeContainerSeams(), c3: () => ["the container runs as root"], install: () => (installs++, fakeContainerSeams().install(null as never)) };
    const r = await containerPreflight(dir(), s);
    expect(r.problems).toEqual(["C3 before the install: the container runs as root"]);
    expect(installs).toBe(0);
  });
});
