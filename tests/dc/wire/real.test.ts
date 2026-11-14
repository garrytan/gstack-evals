// Copyright (c) 2026 Garry Tan. MIT License.
// The real providers (lanes/design-constructed/wire/real.ts) driven keyless, with fakes only at the lowest seams: the
// proxies' upstream fetch, the review container (a local folder standing in for docker exec, with the bundled Claude
// Code CLI as the agent), Ubicloud's API fetch, the SSH runner and the VM agent's session (the stand-in CLI). The
// ledger is the real ledger service on a local off-host target. No key is real and nothing reaches a network.
import { afterAll, describe, expect, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
import { DcError } from "../../../lanes/design-constructed/errors.ts";
import { sessionSetup } from "../../../lanes/design-constructed/run/arms.ts";
import { sessionFolder, startReviewContainer, type PreparedSession, type ReviewContainer } from "../../../lanes/design-constructed/run/docker.ts";
import { BLOCK } from "../../../lanes/design-constructed/run/fixtures.ts";
import { RECIPES } from "../../../lanes/design-constructed/frozen.ts";
import { stubSession } from "../../../lanes/design-constructed/stage3/agent-fake.ts";
import { DESCRIBE_DONE, type Vm } from "../../../lanes/design-constructed/stage3/sandbox.ts";
import { controllerMirrors, freePort } from "../../../lanes/design-constructed/stage3/ubicloud-real.ts";
import { watchedEnv } from "../../../lanes/design-constructed/wire/dryrun-host.ts";
import { BOUND_PROVIDERS, build } from "../../../lanes/design-constructed/wire.ts";
import { fakeEnv, fakeKit, REPO_ROOT } from "../../../lanes/design-constructed/wire/fakes.ts";
import { fakeTerms, frameFixture, runRow, sessionsFixture, stage3Fixture } from "../../../lanes/design-constructed/wire/fixtures.ts";
import { hostContext, hostStage, runOnHost } from "../../../lanes/design-constructed/wire/host.ts";
import { realProviders, RULED_RETRY, type HostContext, type RealSeams } from "../../../lanes/design-constructed/wire/real.ts";
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
async function host(o: { vm?: boolean } = {}): Promise<{ svc: LedgerService; ctx: HostContext; wiring: string; root: string; work: string; pin: ReturnType<typeof pinRecord>; proxyPort: number }> {
  const root = temp("host");
  const shm = mkdtempSync("/dev/shm/dc-real-work-");
  dirs.push(shm);
  const work = join(shm, "work");
  mkdirSync(join(root, "ledger"), { recursive: true });
  const record = makeRecord(join(root, "ledger"));
  const cfg: ServiceConfig = { runId: "dc-real-test", holder: join(root, "holders", "dc-real-test"), record, ledgerPath: join(root, "ledger", "ledger.sqlite"), journalDir: join(root, "journals"), stateDir: join(root, "state"), hosts: [] };
  const opened = await openLedgerService(cfg, new DirTarget(join(root, "offhost")), { leases: (local) => mainLeases({ record, local, requireAdmission: () => null }) });
  if (!opened.ok) throw new Error("the service did not boot: " + opened.captain);
  writeFileSync(join(root, "commit"), COMMIT + "\n");
  mkdirSync(join(root, "repo", "docker"), { recursive: true });
  const tgz = new TextEncoder().encode("invented claude code tarball\n");
  writeFileSync(join(root, "claude.tgz"), tgz);
  writeFileSync(join(root, "repo", "docker", "host-cli.json"), JSON.stringify({ claude: "9.9.9" }));
  writeFileSync(join(root, "repo", "docker", "trial.Dockerfile"), "ADD --checksum=sha256:" + createHash("sha256").update(tgz).digest("hex") + " https://registry.npmjs.org/@anthropic-ai/claude-code-linux-x64/-/claude-code-linux-x64-9.9.9.tgz /opt/claude.tgz\n");
  const proxyPort = await freePort();
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
      retry: RULED_RETRY,
      pinRecord: join(root, "pins.json"),
      cacheDir: join(work, "cache"),
      scanMs: 50,
      sessions: { gstackSources: [], imageDigest: null },
      vm: o.vm === false ? null : { project: "pj-test", location: "eu-central-h1", size: "standard-2", image: "ubuntu-noble", privateSubnet: "ps-test", keyPath, knownHosts: join(root, "ssh", "known_hosts"), chromiumBuild: { dir: join(root, "chromium"), bin: "chrome-linux/chrome" }, claudeTarball: join(root, "claude.tgz"), priceMicrosPerHour: 57_400, proxy: { host: "127.0.0.1", port: proxyPort }, mirrors: [{ name: "npm", host: "10.0.0.2", port: 4873, url: "http://10.0.0.2:4873/", terms: "npm terms" }] },
    }),
  );
  const svc = opened.service;
  return { svc, ctx: hostContext(svc, wiring, ENV, undefined, work), wiring, root, work, pin, proxyPort };
}

const rowEnv = (ctx: HostContext, seams: RealSeams): RowEnv => ({ ...fakeEnv(fakeKit()), providers: realProviders(ctx, seams), lane: () => ({ commit: COMMIT, dirty: false, root: REPO_ROOT }) });

describe("the real providers", () => {
  test("off the controller host every factory refuses with E_DCW_OFF_HOST, and on it nothing starts until a row builds a provider", async () => {
    const off = BOUND_PROVIDERS(null);
    for (const name of ["ledger", "model", "session", "vm", "stage3"] as const) await expect(build(off, name, "t")).rejects.toThrow("exists only on the controller host");
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

  /**
   * A stand-in docker binary for the review container's lifecycle: run records the container by name, rm -f removes it
   * unless leave() is on, and container inspect reports no such container once it is gone. Every call is logged.
   */
  const standInDocker = (o: { leave?: boolean } = {}) => {
    const dir = temp("docker");
    mkdirSync(join(dir, "live"));
    const path = join(dir, "docker");
    writeFileSync(path, ["#!/bin/sh", 'd="$(dirname "$0")"', 'echo "$*" >> "$d/docker.log"', 'case "$1" in', '  run) while [ $# -gt 0 ]; do [ "$1" = --name ] && name="$2"; shift; done; : > "$d/live/$name"; echo c0ffee;;', '  rm) [ -e "$d/leave" ] || rm -f "$d/live/$3";;', '  container) if [ -e "$d/live/$3" ]; then echo "[{}]"; else echo "Error response from daemon: No such container: $3" >&2; exit 1; fi;;', "  *) exit 9;;", "esac", ""].join("\n"));
    chmodSync(path, 0o755);
    const leave = (on: boolean) => (on ? writeFileSync(join(dir, "leave"), "") : rmSync(join(dir, "leave"), { force: true }));
    leave(o.leave ?? false);
    const log = () => readFileSync(join(dir, "docker.log"), "utf8").trim().split("\n");
    return { path, leave, live: () => readdirSync(join(dir, "live")), removals: () => log().filter((l) => /^(rm|container) /.test(l)) };
  };

  /**
   * A local folder standing in for the review container: its exec and agent run on this machine in the session folder.
   * With docker, the container's name and stop() are run/docker.ts's own, started and removed through that binary.
   */
  const localPrepare = (o: { problems?: () => string[]; docker?: string } = {}): RealSeams["prepare"] & { dirs: string[] } => {
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
      const removal = o.docker ? startReviewContainer({ image: container.image, setup: p.setup, folder, network: "dc-trial-test", docker: o.docker }) : null;
      return { container: removal ? { ...container, name: removal.name, stop: removal.stop } : container, c3: [], c2: o.problems?.() ?? [], install: null, c2AfterInstall: null, c3AfterInstall: null };
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
        expect(r.out).toContain("background work at the first result (PD-32): none on opus 0 of 1 sessions, 0 ended at the wait's deadline, 0 ended another way with work still out");
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

  /** The SDK's side of one completed session with no CLI: the main agent's reply with a plan-changes block, then its result. */
  const blockQuery = (() =>
    (async function* () {
      yield { type: "assistant", parent_tool_use_id: null, message: { role: "assistant", content: [{ type: "text", text: "Review.\n\n" + BLOCK }] } };
      yield { type: "result", subtype: "success", num_turns: 1, usage: { input_tokens: 1, output_tokens: 1 } };
    })()) as unknown as RealSeams["query"];

  test("a review container's stop removes it with docker rm -f and checks docker container inspect reports no such container; a removal that leaves it throws E_DCW_CONTAINER_LEFT naming it, and a later call removes and checks again", () => {
    // Value: protects=PD-43 condition 1 at run/docker.ts: every removal is checked, and a failed one is an error naming the container; fails_when=stop ignores rm's result, skips the inspect, reads any inspect failure as gone, or a second call after a failed removal passes silently; why_new=PD-43 (stop ran docker rm -f with its output ignored); seam=startReviewContainer's stop; no_claim=a real Docker daemon (tests/dc/run/docker.test.ts runs one where it answers)
    const d = standInDocker({ leave: true });
    const unit = temp("unit");
    mkdirSync(join(unit, "repo"));
    mkdirSync(join(unit, "context"));
    writeFileSync(join(unit, "plan.md"), "# plan\n");
    const c = startReviewContainer({ image: { tag: "dc-test", digest: "sha256:" + "a".repeat(64) }, setup: sessionSetup("none", "opus", []), folder: sessionFolder({ repo: join(unit, "repo"), plan: join(unit, "plan.md"), context: join(unit, "context") }, join(unit, "s1")), network: "dc-trial-test", docker: d.path });
    expect(d.live()).toEqual([c.name]);
    let left: unknown = null;
    try {
      c.stop();
    } catch (e) {
      left = e;
    }
    expect(left).toBeInstanceOf(DcError);
    expect((left as DcError).code).toBe("E_DCW_CONTAINER_LEFT");
    expect((left as DcError).message).toContain(c.name);
    expect(d.live()).toEqual([c.name]);
    d.leave(false);
    c.stop();
    c.stop();
    expect(d.live()).toEqual([]);
    expect(d.removals()).toEqual(["rm -f " + c.name, "container inspect " + c.name, "rm -f " + c.name, "container inspect " + c.name]);
  });

  test("the sessions row removes each review container right after its session and checks the removal (PD-43 condition 1); a docker whose rm leaves the container stops the row with E_DCW_CONTAINER_LEFT, never a cell's outcome", async () => {
    // Value: protects=PD-43 condition 1 at the row: the session box's close removes the container and checks it, and a failed removal ends the sessions row with its own code; fails_when=close skips the stop, the error is caught into an infra outcome, or the row writes outcomes as if the cell ended; why_new=PD-43; seam=realSessions' open and close, the sessions row's worker loop, startReviewContainer's stop; no_claim=the CLI (a stand-in query ends the session) or a real Docker daemon
    for (const leave of [false, true]) {
      const h = await host();
      const f = sessionsFixture({ model: "opus", stage: 2, cells: [{ unit: "u1", kind: "none" }] });
      writeFileSync(join(f.dir, "exports", "u1", "c2.json"), "{}");
      const d = standInDocker({ leave });
      const up = scripted([{ kind: "ok", text: "never" }]);
      const r = await runRow(f.argv, rowEnv(h.ctx, { prepare: localPrepare({ docker: d.path }), query: blockQuery, launcher: inProcessLauncher({ local: h.svc.local, retry: RETRY, env: ENV, fetch: up.fetch, sleep: noSleep }) }));
      try {
        const names = d.removals().filter((l) => l.startsWith("rm ")).map((l) => l.slice("rm -f ".length));
        expect(names).toHaveLength(1);
        expect(d.removals()).toEqual(["rm -f " + names[0], "container inspect " + names[0]]);
        if (!leave) {
          expect(r.err).toEqual([]);
          expect(r.code).toBe(0);
          expect(r.out).toContain("sessions opus stage 2: 1 cells, scored 1; 0 retried");
          expect(d.live()).toEqual([]);
          continue;
        }
        expect(r.code).toBe(2);
        expect(r.err[0]).toStartWith("E_DCW_CONTAINER_LEFT ");
        expect(r.err[0]).toContain(names[0]!);
        expect(d.live()).toEqual(names);
        expect(existsSync(join(f.sink, "outcomes.json"))).toBe(false);
      } finally {
        h.svc.close();
      }
    }
  });

  test("a removal that fails before a re-prepared container, or when a session fails its containment twice, stops the row with E_DCW_CONTAINER_LEFT", async () => {
    // Value: protects=PD-43 condition 1 at the containment retry and its hold: the first container's removal is checked before a second is prepared, and the held session's removal before E_DCW_CONTAINMENT; fails_when=a re-prepare starts while the first container is still there, or the failed removal is swallowed behind the containment hold; why_new=PD-43; seam=realSessions' containPoint loop and its hold; no_claim=a real Docker daemon
    for (const leaveAt of [1, 2]) {
      const h = await host();
      const f = sessionsFixture({ model: "opus", stage: 2, cells: [{ unit: "u1", kind: "none" }] });
      writeFileSync(join(f.dir, "exports", "u1", "c2.json"), "{}");
      const d = standInDocker({ leave: leaveAt === 1 });
      let n = 0;
      const prepare = localPrepare({
        docker: d.path,
        problems: () => {
          if (++n === leaveAt) d.leave(true);
          return ["a mount outside the three binds"];
        },
      });
      const up = scripted([{ kind: "ok", text: "never" }]);
      const r = await runRow(f.argv, rowEnv(h.ctx, { prepare, query: blockQuery, launcher: inProcessLauncher({ local: h.svc.local, retry: RETRY, env: ENV, fetch: up.fetch }) }));
      try {
        expect(r.code).toBe(2);
        expect(r.err[0]).toStartWith("E_DCW_CONTAINER_LEFT ");
        expect(prepare.dirs.map((x) => x.split("/").at(-1))).toEqual(leaveAt === 1 ? ["s1"] : ["s1", "s2"]);
        expect(d.live()).toHaveLength(1);
        expect(up.sent).toEqual([]);
      } finally {
        h.svc.close();
      }
    }
  });

  /** Ubicloud's API and SSH for the VM tests: every VM runs at once, each write kept by path, the manifest empty. */
  const fakeUbicloud = (o: { files?: Map<string, Uint8Array>; agent?: NonNullable<RealSeams["ubicloud"]>["agent"] } = {}) => {
    const calls: Array<{ method: string; url: string; auth: string; body: any }> = [];
    const ssh: Array<{ host: string; command: string }> = [];
    const files = o.files ?? new Map<string, Uint8Array>();
    const fetch = (async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
      calls.push({ method: init.method, url, auth: init.headers.authorization ?? "", body: init.body ? JSON.parse(init.body) : null });
      if (init.method === "GET") return Response.json({ state: "running", ip4: "203.0.113.7", private_ipv4: "10.0.0.9/32" });
      return init.method === "POST" ? Response.json({}) : new Response(null, { status: 204 });
    }) as unknown as typeof globalThis.fetch;
    const run = async (hostIp: string, command: string, eo: { input?: Uint8Array }) => {
      ssh.push({ host: hostIp, command });
      const path = /^cat > '([^']+)'$/.exec(command)?.[1];
      if (path && eo.input) files.set(path, eo.input);
      return { exit: 0, stdout: command.includes("controller.list") ? DESCRIBE_DONE + "\n" : "", stderr: "" };
    };
    return { calls, ssh, files, ubicloud: { fetch, ssh: run, tunnel: async () => ({ port: 1, close: async () => {} }), ...(o.agent ? { agent: o.agent } : {}) } };
  };

  test("the VM provider binds the keyed backend, the specs, the browser and the real recipe agent: a recipe VM gets the browser and Claude Code, and its session reaches the item's metering proxy through the VM proxy endpoint", async () => {
    // Value: protects=PD-31's split: the VM provider binds the real recipe agent (vmSessionAgents on runVmAgent), Claude Code only in a VM that reaches the proxy, and the session's call on the admitted sub-reservation's item proxy with the key held there; fails_when=the recipe agent is a stand-in, the VM front or the item proxy is skipped, a check VM gets Claude Code, or a key name reaches the VM's env file; why_new=PD-31 (the VM provider refused as a whole); seam=realProviders, realVm, vmSessionAgents, runVmAgent, controllerBackend; no_claim=live Ubicloud, a real SSH session or the real CLI in a VM
    const h = await host();
    const files = new Map<string, Uint8Array>();
    const spawned: Array<Record<string, string>> = [];
    const u = fakeUbicloud({ files, agent: (_vm, envFile) => stubSession(new TextDecoder().decode(files.get(envFile) ?? new Uint8Array()), h.root, spawned) });
    const up = scripted([{ kind: "ok", text: "recipe written" }]);
    const vm = await build(realProviders(h.ctx, { ubicloud: u.ubicloud, fetch: up.fetch, sleep: noSleep }), "vm", "recipes");
    try {
      const check = vm.spec("check", "check u01 none");
      const recipe = vm.spec("recipe", "recipe session c001");
      expect([check.owner, check.proxy, recipe.proxy]).toEqual(["dc-test", null, { host: "127.0.0.1", port: h.proxyPort }]);
      expect(recipe.mirrors.map((m) => m.name)).toEqual(["npm"]);
      expect(vm.priceMicrosPerHour).toBe(57_400);
      const made: Vm = await vm.backend.create(recipe);
      expect(made.id).toStartWith("dc-dc-test-");
      expect(u.calls[0]).toMatchObject({ method: "POST", auth: "Bearer " + ENV.UBICLOUD_API_KEY, body: { public_key: "ssh-ed25519 AAAAinvented dc-launch", size: "standard-2", boot_image: "ubuntu-noble", private_subnet_id: "ps-test" } });
      expect(u.calls[0]!.url).toBe("https://api.ubicloud.com/project/pj-test/location/eu-central-h1/vm/" + made.id);
      await vm.backend.prepare!(made);
      expect([...files.keys()].filter((p) => p.endsWith(".tar")).map((p) => p.split("/").at(-1))).toEqual(["browser.tar", "claude-code.tar"]);
      await vm.backend.prepare!(await vm.backend.create(check));
      expect([...files.keys()].filter((p) => p.endsWith(".tar"))).toHaveLength(2);
      expect(typeof vm.browser.open).toBe("function");
      await h.svc.controller.openItem("dc-base-apps");
      const a = await h.svc.controller.admitRecipe({ run: "recipe session c001" });
      if (a.kind !== "admitted") throw new Error("the recipe session was not admitted: " + a.kind);
      const run = await vm.recipeAgent(made, { prompt: "write the recipe", limits: RECIPES.session, sub: { item: "dc-base-apps", id: a.sub.id } });
      expect(run.end).toBe("completed");
      expect(run.spentUsd).toBeGreaterThan(0);
      expect(up.sent).toHaveLength(1);
      expect(up.sent[0]!.url).toBe("https://api.anthropic.com/v1/messages");
      expect(up.sent[0]!.headers["x-api-key"]).toBe(KEYS.ANTHROPIC_API_KEY);
      expect(spawned[0]!.ANTHROPIC_BASE_URL).toStartWith("http://127.0.0.1:" + h.proxyPort + "/");
      expect(Object.keys(spawned[0]!).filter((k) => /API_KEY$/.test(k))).toEqual([]);
      expect(readdirSync(join(h.svc.cfg.journalDir, "sessions"))).toHaveLength(1);
    } finally {
      await vm.close?.();
      h.svc.close();
    }
  }, 60_000);

  test("a vm section that names the controller takes the launch's recorded private IPv4 for the VM proxy and the four mirrors; with no record, or an address on none of the host's interfaces, the VM provider refuses before Ubicloud is called", async () => {
    // Value: protects=the runbook's late-address gap: the wiring names the VM proxy and the mirrors relative to the controller, and the host resolves them from the launch's record and its own interfaces; fails_when=a "controller" host reaches a spec unresolved, the mirrors differ from controllerMirrors on the recorded address, or a missing or foreign address makes a VM or reads the Ubicloud token; why_new=the address existed only after launch and no wiring could name it before; seam=hostContext, readControllerFacts, resolveVm, realVm; no_claim=a real Ubicloud private subnet
    const h = await host();
    const terms = { npm: "npm terms line", pypi: "PyPI terms line", apt: "Ubuntu archive terms line", dockerhub: "Docker Hub terms line" };
    const w = JSON.parse(readFileSync(h.wiring, "utf8"));
    writeFileSync(h.wiring, JSON.stringify({ ...w, vm: { ...w.vm, proxy: { host: "controller", port: h.proxyPort }, mirrors: { host: "controller", terms } } }));
    const record = join(h.svc.cfg.stateDir, "controller.json");
    const u = fakeUbicloud();
    try {
      await expect(build(realProviders(hostContext(h.svc, h.wiring, ENV), { ubicloud: u.ubicloud }), "vm", "recipes")).rejects.toThrow("holds no launch record of its private IPv4");
      writeFileSync(record, JSON.stringify({ vm: "dcctl-test", location: "eu-central-h1", privateIp: "10.255.0.9" }));
      await expect(build(realProviders(hostContext(h.svc, h.wiring, ENV, () => ["127.0.0.1"]), { ubicloud: u.ubicloud }), "vm", "recipes")).rejects.toThrow("is not on any of this host's interfaces");
      expect([u.calls, u.ssh]).toEqual([[], []]);
      writeFileSync(record, JSON.stringify({ vm: "dcctl-test", location: "eu-central-h1", privateIp: "127.0.0.1" }));
      const vm = await build(realProviders(hostContext(h.svc, h.wiring, ENV), { ubicloud: u.ubicloud }), "vm", "recipes");
      try {
        const recipe = vm.spec("recipe", "recipe session c001");
        expect(recipe.proxy).toEqual({ host: "127.0.0.1", port: h.proxyPort });
        expect(recipe.mirrors).toEqual(controllerMirrors("127.0.0.1", terms));
        expect(vm.spec("qualify", "qualify c001").mirrors.map((m) => m.url)).toEqual(["http://127.0.0.1:4873/", "http://127.0.0.1:3141/root/pypi/+simple/", "http://127.0.0.1:3142/archive.ubuntu.com/ubuntu", "http://127.0.0.1:5000"]);
      } finally {
        await vm.close?.();
      }
      writeFileSync(h.wiring, JSON.stringify({ ...w, vm: { ...w.vm, mirrors: { host: "controller", terms: { ...terms, apt: "" } } } }));
      expect(() => hostContext(h.svc, h.wiring, ENV)).toThrow("with a terms line for each of npm, pypi, apt, dockerhub");
    } finally {
      h.svc.close();
    }
  });

  test("on the real providers the stage3 row refuses with E_DCW_NO_PROVIDER under PD-31 after its ledger admission, before any key is read or any VM is made", async () => {
    // Value: protects=PD-31: every stage 3 piece (the build agent, the build reader, stage 3 authoring and the DES-4 judges) refuses until the Captain's go; fails_when=the stage3 row builds the VM provider, reads any env name, calls Ubicloud or runs an SSH command; why_new=PD-31; seam=realProviders' stage3 factory, the stage3 row; no_claim=the stage 3 prompts themselves, which are not written yet
    const h = await host();
    const u = fakeUbicloud();
    const w = watchedEnv(ENV);
    const f = stage3Fixture(8);
    const r = await runRow(f.argv, rowEnv({ ...h.ctx, env: w.env }, { ubicloud: u.ubicloud }));
    try {
      expect(r.code).toBe(2);
      expect(r.err[0]).toStartWith("E_DCW_NO_PROVIDER ");
      expect(r.err[0]).toContain("PD-31");
      expect([...w.read]).toEqual([]);
      expect([u.calls, u.ssh]).toEqual([[], []]);
      expect(existsSync(join(f.sink, "launch.json"))).toBe(true);
    } finally {
      h.svc.close();
    }
  });

  test("the recipes row runs its recipe session on the real recipe agent, whose one model call reaches the dc-base-apps proxy through the VM proxy endpoint; the fake VM gives the audit no evidence, so the screen stops for the Captain", async () => {
    // Value: protects=PD-31's other half: the recipes row builds the real VM provider and its recipe session runs the real recipe agent, then the row closes the VM front; fails_when=the recipes row refuses, its session never reaches the item proxy, or the front stays open; why_new=PD-31; seam=the recipes row, realVm, runVmAgent; no_claim=a recipe that qualifies (the fake VM answers no audit command, so the screen stops at the audit)
    const h = await host();
    const files = new Map<string, Uint8Array>();
    const u = fakeUbicloud({ files, agent: (_vm, envFile) => stubSession(new TextDecoder().decode(files.get(envFile) ?? new Uint8Array()), h.root) });
    const up = scripted([{ kind: "ok", text: "recipe written" }]);
    const sink = join(temp("recipes"), "sink");
    const r = await runRow(["recipes", "--frame", frameFixture(0), "--out", sink], rowEnv(h.ctx, { ubicloud: u.ubicloud, fetch: up.fetch, sleep: noSleep }));
    try {
      expect(r.code).toBe(2);
      expect(r.err[0]).toStartWith("E_DC_SANDBOX_AUDIT ");
      expect(r.err[0]).toContain("recipe session c001");
      expect(up.sent.map((x) => [x.url, x.headers["x-api-key"]])).toEqual([["https://api.anthropic.com/v1/messages", KEYS.ANTHROPIC_API_KEY]]);
      expect(readdirSync(join(h.svc.cfg.journalDir, "sessions"))).toHaveLength(1);
      expect(await fetch("http://127.0.0.1:" + h.proxyPort + "/x").then(() => "open", () => "closed")).toBe("closed");
    } finally {
      h.svc.close();
    }
  }, 120_000);

  test("runOnHost runs one row in the service's process on the real providers and the host's commit; a row that fails throws for stage.json", async () => {
    const h = await host();
    const row = { work: h.work, log: join(h.work, ".rows", "1.log") };
    expect(hostStage(h.wiring, ["items"])).toEqual({ module: "lanes/design-constructed/wire/host.ts", args: [h.wiring, "items"] });
    expect(h.ctx.lane()).toEqual({ commit: COMMIT, dirty: false, root: join(h.root, "repo") });
    await runOnHost(h.svc, [h.wiring, "items"], row);
    const log = readFileSync(row.log, "utf8").trim().split("\n");
    expect(log).toHaveLength(18);
    expect(log.at(-1)).toStartWith("all-in cap $");
    await expect(runOnHost(h.svc, [h.wiring, "sessions"], row)).rejects.toThrow("gstack-evals dc sessions exited 2");
    await expect(runOnHost(h.svc, [h.wiring], row)).rejects.toThrow("runOnHost takes the wiring file");
    h.svc.close();
  });

  // Value: protects=PD-41's reply cache on tmpfs; fails_when=a row on the host writes model output to a reply cache on disk; why_new=the custody rule moved every sink and the cache onto tmpfs; seam=runOnHost; no_claim=the real host's mount
  test("runOnHost refuses a wiring whose reply cache sits on disk, before the row runs", async () => {
    const h = await host();
    const disk = join(h.root, "wiring-disk.json");
    writeFileSync(disk, JSON.stringify({ ...JSON.parse(readFileSync(h.wiring, "utf8")), cacheDir: join(h.root, "cache") }));
    const row = { work: h.work, log: join(h.work, ".rows", "1.log") };
    await expect(runOnHost(h.svc, [disk, "items"], row)).rejects.toThrow("not tmpfs");
    expect(existsSync(row.log)).toBe(false);
    h.svc.close();
  });

  // Value: protects=every later test file in the same bun process; fails_when=runOnHost leaves the process in the host's work folder, which a test's cleanup then removes, so later spawns and process.cwd() fail (CI's in-VM agent and unit repository tests did); why_new=CI was red at the phase 1b head; seam=runOnHost; no_claim=the real host, where host-main.ts exits after its row
  test("runOnHost leaves the process's working folder where it found it, after a row that passes and after one that fails", async () => {
    const h = await host();
    const before = process.cwd();
    const row = { work: h.work, log: join(h.work, ".rows", "1.log") };
    await runOnHost(h.svc, [h.wiring, "items"], row);
    expect(process.cwd()).toBe(before);
    await expect(runOnHost(h.svc, [h.wiring, "sessions"], row)).rejects.toThrow("gstack-evals dc sessions exited 2");
    expect(process.cwd()).toBe(before);
    h.svc.close();
  });

  test("a wiring file that leaves an integrator's choice out refuses with E_USAGE naming it", async () => {
    const h = await host();
    const bad = join(h.root, "bad.json");
    writeFileSync(bad, JSON.stringify({ retry: RETRY, pinRecord: "x", cacheDir: "y" }));
    expect(() => hostContext(h.svc, bad, ENV, undefined, h.work)).toThrow("names no journal scan interval (scanMs)");
    writeFileSync(bad, JSON.stringify({ pinRecord: "x", cacheDir: "y", scanMs: 10 }));
    expect(() => hostContext(h.svc, bad, ENV, undefined, h.work)).toThrow("names no retry budget");
    h.svc.close();
  });
});

describe("the terms the fixtures carry", () => {
  test("fakeTerms names only OpenRouter models", () => {
    expect(fakeTerms(["opus", "sol", "astra", "argon"]).map((t) => t.model)).toEqual(["sol", "argon"]);
  });
});
