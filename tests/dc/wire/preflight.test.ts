// Copyright (c) 2026 Garry Tan. MIT License.
// The no-model preflight (lanes/design-constructed/wire/preflight.ts) on stage3/fake.ts's simulated Ubicloud: one
// qualification VM through the preamble, the controller's install, the fixture app's qualification steps, one page in a
// scripted browser and the audit; and the host's launch-order rule and key narrowing for it. No key, no network, no VM.
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixtureBrowser, type AppKind } from "../../../lanes/design-constructed/recipes/fixtures.ts";
import { fakeBackend, fakeHosts, fakeMirrors, fakeSpec, fakeWorld, type FakeWorld } from "../../../lanes/design-constructed/stage3/fake.ts";
import { browserFiles, controllerBackend, nodeFiles, tarOf } from "../../../lanes/design-constructed/stage3/install.ts";
import { preflightRule, rowKeys } from "../../../lanes/design-constructed/wire/host.ts";
import { PREFLIGHT_DIR, preflightRecipe, runPreflight } from "../../../lanes/design-constructed/wire/preflight.ts";

const IMAGE = "redis:7.4.1-alpine@sha256:c1e88455c85225310bbea54816e9c3f4b5295815e6dbf80c34d40afc6df28275";

/** One preflight on a fake world: the controller's install on the real backend, a clock that reads one minute per VM. */
async function preflight(o: { world?: FakeWorld; app?: AppKind } = {}) {
  const w = o.world ?? fakeWorld();
  const dir = mkdtempSync(join(tmpdir(), "dc-preflight-"));
  mkdirSync(join(dir, "chromium", "chrome-linux"), { recursive: true });
  writeFileSync(join(dir, "chromium", "chrome-linux", "chrome"), "invented browser\n");
  writeFileSync(join(dir, "node.tar.xz"), "invented node build\n");
  const hosts = fakeHosts();
  const backend = controllerBackend(fakeBackend(w), { browser: browserFiles(join(dir, "chromium"), "chrome-linux/chrome"), node: nodeFiles(join(dir, "node.tar.xz")), agent: null });
  let t = 0;
  const r = await runPreflight({ sandbox: { backend, hosts, now: () => (t += 60_000) }, spec: fakeSpec({ label: "preflight qualification", proxy: null, mirrors: fakeMirrors() }), browser: fixtureBrowser(() => o.app ?? "content"), recipe: preflightRecipe(), app: () => tarOf(join(PREFLIGHT_DIR, "app")) });
  const id = w.vms[0]!.id;
  return { lines: r.lines.map((l) => l.replaceAll(id, "<vm>")), problems: r.problems.map((l) => l.replaceAll(id, "<vm>")), w, hosts };
}

const passed = [
  "preamble: ok",
  "install: ok",
  "egress self-check: DCNET count 1 in the kernel log after the install",
  "qualify copy: ok",
  "qualify services cache: ok, " + IMAGE + " pulled through the dockerhub mirror and started with docker run",
  "qualify install: ok",
  "qualify build: ok",
  "qualify start: ok",
  "qualify serve: ok",
  "page / at 375x812 in the pinned Chromium: HTTP 200",
  "audit: ok",
  "egress: 1 accepted (1 to a mirror endpoint), 0 blocked",
  "vm: <vm> deleted, 1.0 measured minutes",
];

describe("the no-model preflight", () => {
  // Value: protects=the Captain's preflight before stage 0: one sandbox VM runs the preamble, the controller's install, qualification's own steps on a fixture app with a Docker service, one page in the pinned Chromium and the audit, and fails on any of them; fails_when=a step's failure, a page other than HTTP 200 or an audit with no accepted mirror connection passes, a line carries key text, or the VM is left undeleted; why_new=stage 0's first recipe VM stopped at the preamble, and nothing ran a VM before a paid row; seam=runPreflight, sandboxed, controllerBackend, setupSteps, the browser seam; no_claim=a real VM, mirror, Docker pull or Chromium
  test("the fixture recipe reads in the lane's format: pnpm through corepack, one pinned dependency, a pinned Docker Hub service and three routes", () => {
    const r = preflightRecipe();
    expect([r.install, r.build, r.start, r.baseUrl, r.routes, r.services.map((s) => s.image)]).toEqual(["pnpm install", "pnpm run build", "pnpm start", "http://127.0.0.1:3000", ["/", "/about", "/health"], [IMAGE]]);
    const pkg = JSON.parse(readFileSync(join(PREFLIGHT_DIR, "app", "package.json"), "utf8"));
    expect([pkg.packageManager, pkg.dependencies]).toEqual(["pnpm@9.15.9", { "escape-html": "1.0.3" }]);
  });
  test("a clean VM passes: one line per step in order, the VM deleted and its measured time settled on dc-hosts", async () => {
    const r = await preflight();
    expect(r.lines).toEqual(passed);
    expect(r.problems).toEqual([]);
    expect(r.w.deleted).toEqual([r.w.vms[0]!.id]);
    expect(r.hosts.settled.map((s) => s.hours * 60)).toEqual([1]);
    const calls = r.w.vms[0]!.calls.map((c) => c.command);
    expect(calls.filter((c) => c.startsWith("docker run -d --name 'svc-cache' --network host"))).toHaveLength(1);
    expect(calls.findIndex((c) => c.startsWith("nft -f -"))).toBeLessThan(calls.findIndex((c) => c.includes("apt-get install")));
    expect(r.lines.join("\n")).not.toMatch(/API_KEY|sk-/);
  });
  test("a page other than HTTP 200 fails the preflight", async () => {
    const r = await preflight({ app: "http-500" });
    expect(r.lines[9]).toBe("page / at 375x812 in the pinned Chromium: HTTP 500");
    expect(r.lines[10]).toBe("audit: ok");
    expect(r.problems).toEqual(["page / at 375x812 in the pinned Chromium: HTTP 500, not HTTP 200"]);
  });
  test("a clean audit with no accepted connection fails the preflight", async () => {
    const w = fakeWorld({ plant: (vm) => void (vm.egress = []), ssh: async (_vm, command) => (command.includes("grep -c DCNET") ? { exit: 0, stdout: "2\n", stderr: "" } : undefined) });
    const r = await preflight({ world: w });
    expect(r.lines.slice(-3)).toEqual(["audit: ok", "egress: 0 accepted (0 to a mirror endpoint), 0 blocked", "vm: <vm> deleted, 1.0 measured minutes"]);
    expect(r.problems).toEqual(["the audit saw no accepted DCNET connection to a mirror endpoint"]);
  });
  test("a failed install step fails the preflight: the controller's apt step before the job, or qualification's pnpm install inside it", async () => {
    const apt = await preflight({ world: fakeWorld({ faults: { preamble: ["apt-get install"] } }) });
    expect(apt.lines.slice(0, 3)).toEqual(["preamble: ok", "install: the controller's install failed: the controller's install on <vm> failed at the apt packages (exit 1): fake preamble failure", "audit: ok"]);
    expect(apt.problems).toEqual(["the install failed"]);
    const pnpm = await preflight({ world: fakeWorld({ handler: (_vm, command) => (command.includes("pnpm install") ? { exit: 1, stderr: "ERR_PNPM_FETCH_404 escape-html" } : undefined) }) });
    expect(pnpm.lines.slice(5, 8)).toEqual(["qualify install: failed (exit 1): ERR_PNPM_FETCH_404 escape-html", "audit: ok", "egress: 1 accepted (1 to a mirror endpoint), 0 blocked"]);
    expect(pnpm.problems).toEqual(["qualify install: failed (exit 1): ERR_PNPM_FETCH_404 escape-html"]);
    expect([apt.w.deleted.length, pnpm.w.deleted.length]).toEqual([1, 1]);
  });
});

describe("the preflight on the host", () => {
  // Value: protects=the Captain's launch order (model probe, preflight, clones, stage 0) and the preflight's narrow key set; fails_when=the clones row or a later row runs with no preflight or after a failed one, or the preflight's providers see a model key; why_new=the preflight row; seam=preflightRule, rowKeys; no_claim=the host's own refusal path, which the keyless launch drives
  test("the clones row and every later row wait for the host's latest preflight to end done; the model probe, the preflight and the ledger listing don't", () => {
    const row = (n: number, name: string, state: string, code: string | null = null) => ({ n, row: name, state, code });
    expect(["modelprobe", "preflight", "items"].map((r) => preflightRule(r, []))).toEqual([null, null, null]);
    expect(preflightRule("clones", [row(1, "modelprobe", "done")])).toContain("no preflight has run on this host");
    expect(preflightRule("clones", [row(1, "modelprobe", "done"), row(2, "preflight", "failed", "E_DCW_PREFLIGHT")])).toContain("row 2, ended failed with E_DCW_PREFLIGHT; the launch stops here");
    expect(preflightRule("recipes", [row(2, "preflight", "done"), row(3, "preflight", "failed")])).toContain("row 3, ended failed");
    expect(preflightRule("clones", [row(2, "preflight", "failed"), row(3, "preflight", "done")])).toBeNull();
  });
  test("the preflight's providers read only the Ubicloud token and UBI_OWNER; other rows keep the service's environment", () => {
    const env = { ANTHROPIC_API_KEY: "a", OPENAI_API_KEY: "o", OPENROUTER_API_KEY: "r", UBICLOUD_API_KEY: "u", UBI_OWNER: "owner", PATH: "/bin" };
    expect(rowKeys("preflight", env)).toEqual({ UBICLOUD_API_KEY: "u", UBI_OWNER: "owner" });
    expect(rowKeys("recipes", env)).toBe(env);
  });
});
