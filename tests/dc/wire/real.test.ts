// Copyright (c) 2026 Garry Tan. MIT License.
// The real providers (lanes/design-constructed/wire/real.ts) driven keyless, with fakes only at the lowest seams: the
// proxies' upstream fetch, the review container (a local folder standing in for docker exec, with the bundled Claude
// Code CLI as the agent), Ubicloud's API fetch and the SSH runner. The ledger is the real ledger service on a local
// off-host target. No key is real and nothing reaches a network.
import { afterAll, describe, expect, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "../../../lanes/design-constructed/money/book.ts";
import { makeRecord } from "../../../lanes/design-constructed/money/dryrun-fixture.ts";
import { DirTarget } from "../../../lanes/design-constructed/money/durability.ts";
import { mainLeases } from "../../../lanes/design-constructed/money/ledger-main.ts";
import { openLedgerService, type LedgerService, type ServiceConfig } from "../../../lanes/design-constructed/money/ledger-service.ts";
import { endpointsFixture } from "../../../lanes/design-constructed/paid/dryrun-cases.ts";
import { pinRecord, termsRecordsOf } from "../../../lanes/design-constructed/paid/pin.ts";
import { scripted } from "../../../lanes/design-constructed/paid/scripted.ts";
import { inProcessLauncher } from "../../../lanes/design-constructed/paid/sessions.ts";
import { localRunBox } from "../../../lanes/design-constructed/run/box.ts";
import { sessionFolder, type PreparedSession, type ReviewContainer } from "../../../lanes/design-constructed/run/docker.ts";
import { BLOCK } from "../../../lanes/design-constructed/run/fixtures.ts";
import { fixtureStage3 } from "../../../lanes/design-constructed/stage3/fixtures.ts";
import type { Vm } from "../../../lanes/design-constructed/stage3/sandbox.ts";
import { BOUND_PROVIDERS, build } from "../../../lanes/design-constructed/wire.ts";
import { fakeEnv, fakeKit, REPO_ROOT } from "../../../lanes/design-constructed/wire/fakes.ts";
import { fakeTerms, runRow, sessionsFixture } from "../../../lanes/design-constructed/wire/fixtures.ts";
import { hostContext, hostStage, runOnHost } from "../../../lanes/design-constructed/wire/host.ts";
import { realProviders, type HostContext, type RealSeams } from "../../../lanes/design-constructed/wire/real.ts";
import type { RowEnv } from "../../../lanes/design-constructed/wire/start.ts";
import { CLAUDE_CLI, HAS_CLAUDE_CLI, KEYS, messagesResponse } from "../../adapters/harness.ts";

const dirs: string[] = [];
const temp = (tag: string) => {
  const d = mkdtempSync(join(tmpdir(), "dc-real-" + tag + "-"));
  dirs.push(d);
  return d;
};
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const RETRY = { attempts: 1, elapsed_ms: 1000 };
const ENV = { ...KEYS, UBICLOUD_API_KEY: "ubi-fake-token-0123456789", UBI_OWNER: "dc-test" };
const COMMIT = "1".repeat(40);
const noSleep = async () => {};

/** A booted ledger service on a local off-host target, the host's commit file and a wiring file on a pinned record. */
async function host(o: { vm?: boolean } = {}): Promise<{ svc: LedgerService; ctx: HostContext; wiring: string; root: string; pin: ReturnType<typeof pinRecord> }> {
  const root = temp("host");
  mkdirSync(join(root, "ledger"), { recursive: true });
  const record = makeRecord(join(root, "ledger"));
  const cfg: ServiceConfig = { runId: "dc-real-test", holder: join(root, "holders", "dc-real-test"), record, ledgerPath: join(root, "ledger", "ledger.sqlite"), journalDir: join(root, "journals"), stateDir: join(root, "state"), hosts: [] };
  const opened = await openLedgerService(cfg, new DirTarget(join(root, "offhost")), { leases: (local) => mainLeases({ record, local, requireAdmission: () => null }) });
  if (!opened.ok) throw new Error("the service did not boot: " + opened.captain);
  writeFileSync(join(root, "commit"), COMMIT + "\n");
  mkdirSync(join(root, "repo"));
  const pin = pinRecord({ runId: "dc-real-test", commit: COMMIT, dated: "2026-11-13T00:00:00Z", reads: { sol: endpointsFixture("sol"), particle: endpointsFixture("particle"), argon: endpointsFixture("argon") } });
  writeFileSync(join(root, "pins.json"), JSON.stringify(pin));
  const keyPath = join(root, "ssh", "id_ed25519");
  mkdirSync(join(root, "ssh"));
  writeFileSync(keyPath, "invented private key\n", { mode: 0o600 });
  writeFileSync(keyPath + ".pub", "ssh-ed25519 AAAAinvented dc-launch\n");
  mkdirSync(join(root, "chromium", "chrome-linux"), { recursive: true });
  writeFileSync(join(root, "chromium", "chrome-linux", "chrome"), "invented browser\n", { mode: 0o755 });
  const wiring = join(root, "wiring.json");
  writeFileSync(
    wiring,
    JSON.stringify({
      retry: RETRY,
      pinRecord: join(root, "pins.json"),
      cacheDir: join(root, "cache"),
      scanMs: 50,
      sessions: { gstackSources: [], imageDigest: null },
      vm: o.vm === false ? null : { project: "pj-test", location: "eu-central-h1", size: "standard-2", image: "ubuntu-noble", privateSubnet: "ps-test", keyPath, knownHosts: join(root, "ssh", "known_hosts"), chromiumBuild: { dir: join(root, "chromium"), bin: "chrome-linux/chrome" }, claudeTarball: join(root, "claude.tgz"), priceMicrosPerHour: 57_400, proxy: { host: "10.0.0.2", port: 8787 }, mirrors: [{ name: "npm", host: "10.0.0.2", port: 4873, url: "http://10.0.0.2:4873/", terms: "npm terms" }] },
    }),
  );
  const svc = opened.service;
  return { svc, ctx: hostContext(svc, wiring, ENV), wiring, root, pin };
}

const rowEnv = (ctx: HostContext, seams: RealSeams): RowEnv => ({ ...fakeEnv(fakeKit()), providers: realProviders(ctx, seams), lane: () => ({ commit: COMMIT, dirty: false, root: REPO_ROOT }) });

describe("the real providers", () => {
  test("off the controller host every factory refuses with E_DCW_OFF_HOST, and on it nothing starts until a row builds a provider", async () => {
    const off = BOUND_PROVIDERS(null);
    for (const name of ["ledger", "model", "session", "vm"] as const) await expect(build(off, name, "t")).rejects.toThrow("exists only on the controller host");
    const h = await host();
    const up = scripted([{ kind: "ok", text: "never" }]);
    realProviders(h.ctx, { fetch: up.fetch });
    expect(up.sent).toEqual([]);
    expect(existsSync(h.svc.cfg.journalDir) ? readdirSync(h.svc.cfg.journalDir) : []).toEqual([]);
    expect(existsSync(join(h.ctx.dir, "watch"))).toBe(false);
    const ledger = await build(realProviders(h.ctx), "ledger", "t");
    expect(ledger.controller).toBe(h.svc.controller);
    expect(ledger.recordedCapMicros("dc-judges")).toBe($(520));
    expect(await ledger.reconcile("any")).toBeNull();
    h.svc.close();
  });

  test("the model provider sends a judge call through the item's direct proxy, the key read by name, the reply's served terms on the pin's digest", async () => {
    const h = await host();
    await h.svc.controller.openItem("dc-judges");
    const up = scripted(() => ({ kind: "ok", text: "{\"labels\": []}", provider: "OpenAI" }));
    const models = await build(realProviders(h.ctx, { fetch: up.fetch, sleep: noSleep }), "model", "t");
    try {
      const r = await models.call({ item: "dc-judges", model: "sol", prompt: "Label these lists.", maxTokens: 1000, effort: null, label: "judge t1", subject: "opus", tag: null });
      expect(r.text).toBe("{\"labels\": []}");
      expect(r.served?.provider).toBe("OpenAI");
      expect(r.served?.termsDigest).toBe(termsRecordsOf(h.pin).find((t) => t.model === "sol")!.termsDigest);
      expect(up.sent).toHaveLength(1);
      expect(up.sent[0]!.url).toStartWith("https://openrouter.ai/");
      expect(up.sent[0]!.headers.authorization).toBe("Bearer " + KEYS.OPENROUTER_API_KEY);
      expect(readdirSync(join(h.svc.cfg.journalDir, "direct"))).toHaveLength(1);
      const f = h.svc.controller.figures("dc-judges");
      expect(f.settledMicros).toBeGreaterThan(0);
      expect(f.inFlightMicros).toBe(0);
      expect((await new DirTarget(join(h.root, "offhost")).lines()).some((l) => l.includes("\"reserve\""))).toBe(true);
    } finally {
      await models.close?.();
      h.svc.close();
    }
  });

  /** A local folder standing in for the review container: its exec and agent run on this machine in the session folder. */
  const localPrepare = (o: { problems?: () => string[] } = {}): RealSeams["prepare"] & { dirs: string[] } => {
    const seen: string[] = [];
    const prepare = async (p: Parameters<NonNullable<RealSeams["prepare"]>>[0]): Promise<PreparedSession> => {
      seen.push(p.dir);
      const folder = sessionFolder(p.unit, p.dir);
      const home = join(p.dir, "..", "home-" + seen.length);
      mkdirSync(home, { recursive: true });
      const run = (command: string) => {
        const r = spawnSync("bash", ["-c", command], { cwd: folder, encoding: "utf8" });
        return { code: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
      };
      const container: ReviewContainer = {
        name: "local",
        image: { tag: "local", digest: "sha256:" + "a".repeat(64) },
        network: "none",
        folder,
        exec: run,
        run,
        listing: () => [],
        inspect: () => ({ image: "local", user: "1000", mounts: [], networks: [], env: [] }),
        box: () => localRunBox({ roots: [folder], gstackBin: "/nonexistent", env: {}, cwd: folder }),
        agent: (env) => ({
          exec: (command) => ({ exitCode: run(command).code, timedOut: false, stdout: "", stderr: "" }),
          spawn: (argv, extra = {}) => spawn(argv[0] === "claude" ? CLAUDE_CLI : argv[0]!, argv.slice(1), { cwd: folder, env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: home, ...env, ...extra }, stdio: ["pipe", "pipe", "pipe"] }),
          stop() {},
        }),
        stop() {},
      };
      return { container, c3: [], c2: o.problems?.() ?? [], install: null, c2AfterInstall: null, c3AfterInstall: null };
    };
    return Object.assign(prepare, { dirs: seen });
  };

  /** Anthropic's Messages API for the bundled CLI: the main agent's turn ends with a plan-changes block. */
  const messages = async (_url: string, init: RequestInit): Promise<Response> => {
    const body = JSON.parse(String(init.body));
    return messagesResponse(body, [{ type: "text", text: body.tools?.length ? "Review.\n\n" + BLOCK : "A title" }]);
  };

  test.skipIf(!HAS_CLAUDE_CLI)(
    "the sessions row runs end to end on the real session provider: a session proxy on the round's sub-reservation, the driver and the bundled CLI, settled from the proxy's meter",
    async () => {
      const h = await host();
      const f = sessionsFixture({ model: "opus", stage: 2, cells: [{ unit: "u1", kind: "none" }] });
      writeFileSync(join(f.dir, "exports", "u1", "c2.json"), "{}");
      const prepare = localPrepare();
      const env = rowEnv(h.ctx, { prepare, launcher: inProcessLauncher({ local: h.svc.local, retry: RETRY, env: ENV, fetch: messages, sleep: noSleep }) });
      try {
        const r = await runRow(f.argv, env);
        expect(r.err).toEqual([]);
        expect(r.code).toBe(0);
        expect(r.out).toContain("sessions opus stage 2: 1 cells, scored 1; 0 retried");
        const rows = JSON.parse(readFileSync(join(f.sink, "rows.json"), "utf8"));
        expect(rows[0].state).toBe("scored");
        expect(rows[0].list).toEqual(["Show an empty state on the orders screen with one action."]);
        const attempts = JSON.parse(readFileSync(join(f.sink, "attempts.json"), "utf8"));
        expect(attempts[0].imageDigest).toBe("sha256:" + "a".repeat(64));
        expect(attempts[0].spentUsd).toBeGreaterThan(0);
        const fig = h.svc.controller.figures("dc-stage2-opus");
        expect(fig.settledMicros).toBe($(attempts[0].spentUsd));
        expect([fig.inFlightMicros, fig.unknownMicros]).toEqual([0, 0]);
        expect(prepare.dirs).toHaveLength(1);
        expect(readdirSync(join(h.svc.cfg.journalDir, "sessions"))).toHaveLength(1);
      } finally {
        h.svc.close();
      }
    },
    120_000,
  );

  test("a container that fails its checks twice is held for the Captain with E_DCW_CONTAINMENT, before any proxy slot is bound", async () => {
    const h = await host();
    const f = sessionsFixture({ model: "opus", stage: 2, cells: [{ unit: "u1", kind: "none" }] });
    writeFileSync(join(f.dir, "exports", "u1", "c2.json"), "{}");
    const prepare = localPrepare({ problems: () => ["a mount outside the three binds"] });
    const up = scripted([{ kind: "ok", text: "never" }]);
    const r = await runRow(f.argv, rowEnv(h.ctx, { prepare, launcher: inProcessLauncher({ local: h.svc.local, retry: RETRY, env: ENV, fetch: up.fetch }) }));
    try {
      expect(r.code).toBe(2);
      expect(r.err[0]).toStartWith("E_DCW_CONTAINMENT ");
      expect(r.err[0]).toContain("held for the Captain");
      expect(prepare.dirs.map((d) => d.split("/").at(-1))).toEqual(["s1", "s2"]);
      expect(up.sent).toEqual([]);
      expect(existsSync(join(h.svc.cfg.journalDir, "sessions"))).toBe(false);
    } finally {
      h.svc.close();
    }
  });

  test("the VM provider refuses before it reads a key or calls Ubicloud while the in-VM agents are unbuilt, and with them binds the keyed backend, the specs and the browser", async () => {
    const h = await host();
    const calls: Array<{ method: string; url: string; auth: string; body: any }> = [];
    const ubi = (async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
      calls.push({ method: init.method, url, auth: init.headers.authorization ?? "", body: init.body ? JSON.parse(init.body) : null });
      if (init.method === "GET") return Response.json({ state: "running", ip4: "203.0.113.7", private_ipv4: "10.0.0.9/32" });
      return init.method === "POST" ? Response.json({}) : new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    const ssh: Array<{ host: string; command: string }> = [];
    const ubicloud = { fetch: ubi, ssh: async (hostIp: string, command: string) => (ssh.push({ host: hostIp, command }), { exit: 0, stdout: "", stderr: "" }), tunnel: async () => ({ port: 1, close: async () => {} }) };
    await expect(build(realProviders(h.ctx, { ubicloud }), "vm", "t")).rejects.toThrow("no real implementation in this build");
    expect(calls).toEqual([]);
    const s3 = fixtureStage3();
    const vm = await build(realProviders(h.ctx, { ubicloud, vmAgents: { recipeAgent: async () => ({ end: "completed", spentUsd: 0 }), buildAgent: s3.select.builds.agent, buildReader: s3.select.builds.reader, stage3Authoring: s3.select.authoring, pairwise: s3.deps([]).judge } }), "vm", "t");
    const check = vm.spec("check", "check u01 none");
    const recipe = vm.spec("recipe", "recipe session c001");
    expect([check.owner, check.proxy, recipe.proxy]).toEqual(["dc-test", null, { host: "10.0.0.2", port: 8787 }]);
    expect(recipe.mirrors.map((m) => m.name)).toEqual(["npm"]);
    expect(vm.priceMicrosPerHour).toBe(57_400);
    const made: Vm = await vm.backend.create(check);
    expect(made.id).toStartWith("dc-dc-test-");
    expect(calls[0]).toMatchObject({ method: "POST", auth: "Bearer " + ENV.UBICLOUD_API_KEY, body: { public_key: "ssh-ed25519 AAAAinvented dc-launch", size: "standard-2", boot_image: "ubuntu-noble", private_subnet_id: "ps-test" } });
    expect(calls[0]!.url).toBe("https://api.ubicloud.com/project/pj-test/location/eu-central-h1/vm/" + made.id);
    await vm.backend.exec(made, "true");
    expect(ssh).toEqual([{ host: "203.0.113.7", command: "true" }]);
    expect(typeof vm.browser.open).toBe("function");
    h.svc.close();
  });

  test("runOnHost runs one row in the service's process on the real providers and the host's commit; a row that fails throws for stage.json", async () => {
    const h = await host();
    expect(hostStage(h.wiring, ["items"])).toEqual({ module: "lanes/design-constructed/wire/host.ts", args: [h.wiring, "items"] });
    expect(h.ctx.lane()).toEqual({ commit: COMMIT, dirty: false, root: join(h.root, "repo") });
    await runOnHost(h.svc, [h.wiring, "items"]);
    const log = readFileSync(join(h.svc.cfg.stateDir, "stage.log"), "utf8").trim().split("\n");
    expect(log).toHaveLength(18);
    expect(log.at(-1)).toStartWith("all-in cap $");
    await expect(runOnHost(h.svc, [h.wiring, "sessions"])).rejects.toThrow("gstack-evals dc sessions exited 2");
    await expect(runOnHost(h.svc, [h.wiring])).rejects.toThrow("runOnHost takes the wiring file");
    h.svc.close();
  });

  test("a wiring file that leaves an integrator's choice out refuses with E_USAGE naming it", async () => {
    const h = await host();
    const bad = join(h.root, "bad.json");
    writeFileSync(bad, JSON.stringify({ retry: RETRY, pinRecord: "x", cacheDir: "y" }));
    expect(() => hostContext(h.svc, bad, ENV)).toThrow("names no journal scan interval (scanMs)");
    writeFileSync(bad, JSON.stringify({ pinRecord: "x", cacheDir: "y", scanMs: 10 }));
    expect(() => hostContext(h.svc, bad, ENV)).toThrow("names no retry budget");
    h.svc.close();
  });
});

describe("the terms the fixtures carry", () => {
  test("fakeTerms names only OpenRouter models", () => {
    expect(fakeTerms(["opus", "sol", "astra", "argon"]).map((t) => t.model)).toEqual(["sol", "argon"]);
  });
});
