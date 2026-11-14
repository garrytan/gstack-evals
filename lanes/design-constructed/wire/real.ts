// Copyright (c) 2026 Garry Tan. MIT License.
// The real providers, bound on the controller host inside the ledger service's process (wire/host.ts runs each paid
// row there). Nothing here runs at import time, and realProviders only returns factories: a row builds the ledger
// provider after its start rules pass and the others after its ledger admission, and each provider reads a key by name
// only when it starts the thing that sends it (a proxy reads the three provider keys, the VM provider the Ubicloud
// token). The pieces:
//   ledger   the service's money controller and its approval record; J1 figures stay held until the owner's reconcile.
//   model    paid/direct.ts's callers: one in-process metering proxy per direct item, its ledger copied off host.
//   session  paid/sessions.ts's proxies on the trial network, run/docker.ts's review container per attempt (C3, C2 and
//            the gstack install, held for the Captain when a re-prepared container fails again; removed and checked
//            gone after the attempt, PD-43), and the Claude Code driver with the row's gate and D1 stop handler.
//   vm       stage3/ubicloud-real.ts's keyed backend, wrapped so every sandbox gets the controller's browser install first
//            (stage3/install.ts: Playwright's Chromium build with its apt libraries, and the pinned Claude Code in a VM
//            that reaches the proxy), recipes/browser.ts's Playwright over an SSH tunnel to that Chromium, and the recipe
//            agent (vmSessionAgents: stage3/agent.ts on the VM proxy endpoint, stage3/front.ts).
//   stage3   the build agent, the build reader, stage 3 authoring and the DES-4 judges. Their prompts and reply formats
//            are written before stage 3 starts and wait for the Captain's go (PD-31), so this provider refuses before it
//            reads a key or makes a VM.
// The choices the binding could not make without moving a scored outcome or the money sit in WIRING.md.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import { claudePin } from "../../eng-build/session-image.ts";
import type { AgentSession } from "../../../src/trial/sandbox.ts";
import { claudeCodeDriver, type ClaudeCodeOptions } from "../../../src/adapters/claude-code/driver.ts";
import { ledgerStatus, recordApproval } from "../../../src/runner/ledger/ledger.ts";
import type { RetryBudget } from "../../../src/runner/proxy/metering-proxy.ts";
import { createTrialNetwork, removeTrialNetwork, type TrialNetwork } from "../../../src/trial/proxy.ts";
import { DcError, fail } from "../errors.ts";
import type { LedgerService } from "../money/ledger-service.ts";
import type { Meter } from "../money/meter.ts";
import { DIRECT_MODELS } from "../money/price.ts";
import { ProviderWatch, routingOf } from "../money/served.ts";
import { DirectCallers } from "../paid/direct.ts";
import { datedTermsOf, type PinRecord } from "../paid/pin.ts";
import { containerLauncher, generationResolver, inProcessLauncher, SessionProxies, type SessionBinding, type SessionLauncher } from "../paid/sessions.ts";
import { playwrightBrowser } from "../recipes/browser.ts";
import type { RecipeAgent } from "../recipes/seams.ts";
import type { SessionSetup } from "../run/arms.ts";
import { containPoint, type C2Expect } from "../run/contain.ts";
import { createInstallNetwork, prepareSession, removeNetwork, reviewImage, type PreparedSession, type ReviewImage, type UnitFiles } from "../run/docker.ts";
import { cellId } from "../run/session.ts";
import { toolCallEnd } from "../run/stream.ts";
import { proxySessions, runVmAgent, sshAgentSession } from "../stage3/agent.ts";
import { serveVmFront } from "../stage3/front.ts";
import { browserFiles, BROWSER_ROOT, claudeFiles, controllerBackend, nodeFiles, type ControllerFiles } from "../stage3/install.ts";
import { MIRROR_NAMES, specFor, type Endpoint, type Mirror, type MirrorName, type Vm, type VmBackend } from "../stage3/sandbox.ts";
import { controllerMirrors, keyedUbicloud, sshTunnel, type SshRunner, type Tunnel } from "../stage3/ubicloud-real.ts";
import type { AnyModel, LedgerItemId } from "../types.ts";
import type { LedgerProvider, ModelProvider, Providers, ServedTerms, SessionBox, SessionProvider, VmProvider } from "../wire.ts";
import { readJson } from "./json.ts";

/** The Captain's wiring file for one host run: the choices the prereg and the areas leave to the integrator. */
export interface HostWiring {
  /** The proxies' retry budget (paid open item 1). */
  retry: RetryBudget;
  /** The run's pin record, from gstack-evals dc pins record (start rule 9's served providers). */
  pinRecord: string;
  /** The direct calls' reply cache; it holds model output, so it sits on tmpfs for sealed work. */
  cacheDir: string;
  /** How often a session proxy's journal is read for drift while sessions run, in ms (paid open item 5). */
  scanMs: number;
  /** The review sessions: local gstack repositories holding the pinned commit, and the image digest a run recorded. */
  sessions: { gstackSources: string[]; imageDigest: string | null } | null;
  /**
   * The sandbox VMs: Ubicloud's project and VM shape, the controller host's key for its sandboxes, the Playwright
   * Chromium build on this host (its folder and the binary's path inside it) and the pinned Claude Code npm tarball the
   * controller copies into each VM, the day's list price, and the VM proxy endpoint and mirrors on the controller
   * host's private IPv4. The proxy's host and the mirrors may name the controller instead of an address: a host of
   * "controller", and mirrors as { host: "controller", terms }, resolve on the host at run time (resolveVm).
   */
  vm: VmWiring<Endpoint | ControllerEndpoint, Mirror[] | ControllerMirrors> | null;
}

/** The wiring's name for the controller host's private IPv4, resolved on the host from the launch's record. */
export const CONTROLLER = "controller";
export type ControllerEndpoint = { host: typeof CONTROLLER; port: number };
/** The four controller mirrors (stage3/ubicloud-real.ts controllerMirrors), each with its terms record line. */
export type ControllerMirrors = { host: typeof CONTROLLER; terms: Record<MirrorName, string> };

export interface VmWiring<P = Endpoint, M = Mirror[]> {
  project: string;
  location: string;
  size: string;
  image: string;
  privateSubnet: string | null;
  keyPath: string;
  knownHosts: string;
  chromiumBuild: { dir: string; bin: string };
  claudeTarball: string;
  /** Node's pinned linux-x64 tar.xz (stage3/node-pin.json), which the controller unpacks on every sandbox VM. */
  nodeTarball: string;
  priceMicrosPerHour: number;
  proxy: P;
  mirrors: M;
}

/** What the launch recorded on the controller host (money/controller-host.ts, at provisioning): its VM, region and private IPv4. */
export interface ControllerFacts {
  vm: string;
  location: string | null;
  privateIp: string | null;
}

/** The launch's record on the host, or null when the folder holds none (a service not launched by controller-host.ts). */
export function readControllerFacts(path: string): ControllerFacts | null {
  if (!existsSync(path)) return null;
  const f = readJson<ControllerFacts>(path, "the controller host's launch record");
  if (typeof f.vm !== "string" || (f.location !== null && typeof f.location !== "string") || (f.privateIp !== null && typeof f.privateIp !== "string")) fail("E_DCW_CONTROLLER_ADDRESS", "the controller host's launch record " + path + " is not { vm, location, privateIp }");
  return f;
}

/** This host's own IPv4 addresses, read from its interfaces. */
export const hostAddresses = (): string[] => Object.values(networkInterfaces()).flatMap((l) => (l ?? []).filter((a) => a.family === "IPv4").map((a) => a.address));

/**
 * The vm section on this host: its location must be the region the launch recorded (PD-42), and a proxy or mirrors that
 * name the controller take the launch's private IPv4, which must sit on one of this host's interfaces. Any doubt
 * refuses before a VM is made.
 */
export function resolveVm(w: NonNullable<HostWiring["vm"]>, facts: ControllerFacts | null, addresses: () => string[] = hostAddresses): VmWiring {
  if (facts && w.location !== facts.location) throw new DcError("E_DCW_REGION", "the wiring's vm section makes VMs in " + w.location + ", but the controller host runs in " + (facts.location ?? "no recorded region") + "; a row never makes VMs outside its host's region (PD-42)");
  const relative = w.proxy.host === CONTROLLER || !Array.isArray(w.mirrors);
  if (!relative) return w as VmWiring;
  const no = (why: string): never => {
    throw new DcError("E_DCW_CONTROLLER_ADDRESS", "the wiring's vm section names the controller, but " + why + "; no VM is made");
  };
  const ip = facts?.privateIp ?? no("this host holds no launch record of its private IPv4");
  if (!addresses().includes(ip)) no("the recorded private IPv4 " + ip + " is not on any of this host's interfaces");
  const proxy = w.proxy.host === CONTROLLER ? { host: ip, port: w.proxy.port } : (w.proxy as Endpoint);
  const mirrors = Array.isArray(w.mirrors) ? w.mirrors : w.mirrors.host === CONTROLLER ? controllerMirrors(ip, w.mirrors.terms) : no("the mirrors name the host " + JSON.stringify(w.mirrors.host));
  return { ...w, proxy, mirrors };
}

const posInt = (v: unknown) => Number.isSafeInteger(v) && (v as number) > 0;

/** Reads the wiring file; a missing choice refuses with E_USAGE naming it, since the Captain makes it (WIRING.md). */
/** The proxies' retry budget, the wiring file's retry value (the Captain's ruling 1N): 3 attempts within 15 minutes. */
export const RULED_RETRY: RetryBudget = { attempts: 3, elapsed_ms: 900_000 };

export function readWiring(path: string): HostWiring {
  const w = readJson<HostWiring>(path, "the wiring file");
  const no = (what: string): never => fail("E_USAGE", "the wiring file " + path + " " + what + "; the Captain sets it (lanes/design-constructed/WIRING.md)");
  if (!w.retry || !posInt(w.retry.attempts) || !Number.isSafeInteger(w.retry.elapsed_ms) || w.retry.elapsed_ms < 0) no("names no retry budget (attempts and elapsed_ms)");
  if (typeof w.pinRecord !== "string" || !w.pinRecord) no("names no pin record");
  if (typeof w.cacheDir !== "string" || !w.cacheDir) no("names no reply cache folder");
  if (!posInt(w.scanMs)) no("names no journal scan interval (scanMs)");
  const vm = w.vm;
  if (vm && !(vm.proxy && (vm.proxy.host === CONTROLLER || /^\d{1,3}(\.\d{1,3}){3}$/.test(vm.proxy.host)) && posInt(vm.proxy.port))) no("names a vm proxy that is neither an IPv4 address nor \"controller\", with a port");
  if (vm && !Array.isArray(vm.mirrors) && !(vm.mirrors?.host === CONTROLLER && MIRROR_NAMES.every((n) => (vm.mirrors as ControllerMirrors).terms?.[n]?.trim()))) no("names mirrors that are neither a list nor { host: \"controller\", terms } with a terms line for each of " + MIRROR_NAMES.join(", "));
  if (w.retry.attempts !== RULED_RETRY.attempts || w.retry.elapsed_ms !== RULED_RETRY.elapsed_ms) no("sets a retry budget of " + w.retry.attempts + " attempts in " + w.retry.elapsed_ms + " ms, not the ruled " + RULED_RETRY.attempts + " attempts within 15 minutes (" + RULED_RETRY.elapsed_ms + " ms)");
  return { ...w, sessions: w.sessions ?? null, vm: w.vm ?? null };
}

/** What the real providers run on: the host's ledger service, the wiring file and the service's own environment. */
export interface HostContext {
  service: LedgerService;
  wiring: HostWiring;
  /** Where keys are read from, by name, when a proxy or the VM backend starts. */
  env: Readonly<Record<string, string | undefined>>;
  /** The wiring's own folder on the host: the served-provider watch, session folders and scratch. */
  dir: string;
  /** The checkout the host runs: the commit it was launched at, from the repository archive. */
  lane: () => { commit: string; dirty: boolean; root: string };
  /** The launch's record of this host; null when there is none. */
  controller?: () => ControllerFacts | null;
  /** This host's IPv4 addresses, for the controller's recorded private IPv4. */
  addresses?: () => string[];
}

/** The lowest seams, for keyless tests: the proxies' upstream, the review container, Ubicloud's API and SSH. */
export interface RealSeams {
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  sleep?: (ms: number) => Promise<void>;
  /** Where a session proxy runs; the trial network's proxy container when unset. */
  launcher?: SessionLauncher;
  /** One review container through C3, C2 and the install; run/docker.ts's prepareSession on the trial network when unset. */
  prepare?: (o: { setup: SessionSetup; unit: UnitFiles; expect: C2Expect; dir: string }) => Promise<PreparedSession>;
  query?: ClaudeCodeOptions["query"];
  ubicloud?: { fetch: typeof fetch; ssh: SshRunner; tunnel: (vm: Vm, remotePort: number) => Promise<Tunnel>; agent?: (vm: Vm, envFile: string) => AgentSession };
  /** Where the VM agents' item proxies run; an in-process proxy on this host's loopback when unset. */
  vmLauncher?: SessionLauncher;
  docker?: string;
}

/** sha256 of the routing and data terms the proxy sends for a model, the digest pin.ts records as its terms digest. */
export const routingDigest = (routing: unknown): string => createHash("sha256").update(JSON.stringify(routing)).digest("hex");

/** A ModelProvider on one metered client per item: the reply, its model id, and an OpenRouter call's served terms. */
export function meterModels(meterOf: (item: LedgerItemId) => Meter, termsDigest: (model: AnyModel, provider: string) => string, close?: () => Promise<void>): ModelProvider {
  return {
    async call(c) {
      const meter = meterOf(c.item);
      const r = await meter.call({ model: c.model, prompt: c.prompt, maxTokens: c.maxTokens, effort: c.effort, label: c.label, subject: c.subject, tag: c.tag });
      const id = DIRECT_MODELS[c.model];
      const routing = meter.terms().find((t) => t.model === c.model)?.routing as { allow_fallbacks?: boolean; data_collection?: string } | null | undefined;
      const served = id.provider === "openrouter" && r.servedBy ? { provider: r.servedBy, fallbacks: routing?.allow_fallbacks !== false, dataCollection: routing?.data_collection ?? "allow", termsDigest: termsDigest(c.model, r.servedBy) } : null;
      return { text: r.text, modelId: id.id, version: null, problem: r.problem, served };
    },
    close,
  };
}

/** The served terms a session's first OpenRouter call recorded in the run's watch, as start rule 9 reads them. */
function sessionServed(watch: ProviderWatch, model: AnyModel): ServedTerms | null {
  if (DIRECT_MODELS[model].provider !== "openrouter") return null;
  const line = watch.terms().find((t) => t.model === model);
  if (!line) return null;
  const routing = line.routing as { allow_fallbacks?: boolean; data_collection?: string } | null;
  return { provider: line.servedBy ?? "", fallbacks: routing?.allow_fallbacks !== false, dataCollection: routing?.data_collection ?? "allow", termsDigest: routingDigest(line.routing) };
}

const once = <T>(f: () => T): (() => T) => {
  let v: { value: T } | null = null;
  return () => (v ??= { value: f() }).value;
};

/** The record's side of a ledger provider: each item's recorded cap and latest approval, and a raise (PD-30). */
export const recordSeams = (record: string): Pick<LedgerProvider, "recordedCapMicros" | "approval" | "raise"> => ({
  recordedCapMicros: (item) => ledgerStatus(record, item)[0]?.cap_micros ?? null,
  approval: (item) => ledgerStatus(record, item)[0]?.approval ?? null,
  raise: (item, capMicros, quote) => void recordApproval(record, { action: "raise", item, cap_micros: capMicros, quotes: [quote] }),
});

/** The real providers on the host's ledger service. Returns factories only; nothing starts until a row builds one. */
export function realProviders(h: HostContext, s: RealSeams = {}): Providers {
  const svc = h.service;
  const watch = once(() => new ProviderWatch({ controller: svc.controller, out: join(h.dir, "watch"), datedTerms: datedTermsOf(readJson<PinRecord>(h.wiring.pinRecord, "the pin record")) }));
  const callers = once(() => new DirectCallers({ controller: svc.controller, local: svc.local, wal: svc.wal, watch: watch(), dir: join(svc.cfg.journalDir, "direct"), cacheDir: h.wiring.cacheDir, retry: h.wiring.retry, env: h.env, fetch: s.fetch, sleep: s.sleep }));
  return {
    ledger: (): LedgerProvider => ({ controller: svc.controller, ...recordSeams(svc.cfg.record), reconcile: async () => null }),
    model: () => meterModels((item) => callers().meter(item), (model) => routingDigest(routingOf(model)), async () => callers().stopAll()),
    session: () => realSessions(h, watch(), s, callers()),
    vm: () => realVm(h, s, watch()),
    stage3: (): never => {
      throw new DcError("E_DCW_NO_PROVIDER", "stage 3's pieces (the build agent, the build reader, stage 3 authoring and the DES-4 judges) wait for their pre-data prompts and reply formats and the Captain's go to start stage 3 (PD-31); no key was read and no VM was made");
    },
  };
}

const problemsOf = (p: PreparedSession): string[] => [...p.c3, ...p.c2, ...(p.c2AfterInstall ?? []), ...(p.c3AfterInstall ?? [])];
const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, "_");

/** The review sessions: one container per attempt on its round's sub-reservation, through the item's session proxy. */
export function realSessions(h: HostContext, watch: ProviderWatch, s: RealSeams, callers: DirectCallers): SessionProvider {
  const w = h.wiring.sessions ?? fail("E_USAGE", "the wiring file has no sessions section (gstack sources and the image digest); the Captain sets it (lanes/design-constructed/WIRING.md)");
  const svc = h.service;
  const c = svc.controller;
  const docker = s.docker ?? "docker";
  const work = join(h.dir, "sessions");
  mkdirSync(work, { recursive: true, mode: 0o700 });
  let net: TrialNetwork | null = null;
  let installNet: string | null = null;
  const image = once((): ReviewImage => reviewImage({ expectDigest: w.imageDigest }));
  const trialNet = () => (net ??= createTrialNetwork(docker));
  const launcher: SessionLauncher = s.launcher ?? ((r) => containerLauncher({ image: image().tag, net: trialNet(), ledgerPath: svc.cfg.ledgerPath, retry: h.wiring.retry, env: h.env, docker })(r));
  const prepare =
    s.prepare ??
    ((o: { setup: SessionSetup; unit: UnitFiles; expect: C2Expect; dir: string }) =>
      prepareSession({ ...o, image: image(), network: trialNet().name, docker, install: o.setup.container.gstack ? { sources: w.gstackSources, network: (installNet ??= createInstallNetwork(docker)), scratch: join(h.dir, "scratch") } : null }));
  const resolve = (id: string, item: LedgerItemId) => generationResolver(callers.freeProxy(item), c.runId)(id);
  const proxies = new SessionProxies({ controller: c, local: svc.local, wal: svc.wal, watch, dir: join(svc.cfg.journalDir, "sessions"), launcher, resolve });
  const bindings = new Map<string, SessionBinding>();
  const items = new Set<LedgerItemId>();
  let scanError: unknown = null;
  const timer = setInterval(async () => {
    for (const item of items)
      await proxies.scan(item).catch((e) => {
        scanError ??= e;
      });
  }, h.wiring.scanMs);
  timer.unref();

  return {
    async open({ cell, attempt, setup, unitDir, subId }): Promise<SessionBox> {
      if (scanError) throw scanError;
      const sub = c.sub(subId) ?? fail("E_INTERNAL", "session " + cellId(cell) + " names sub-reservation " + subId + ", which the controller doesn't hold");
      const key = cellId(cell) + ".a" + attempt;
      const base = join(work, safe(key));
      const unit: UnitFiles = { repo: join(unitDir, "repo"), plan: join(unitDir, "plan.md"), context: join(unitDir, "context") };
      const expect = readJson<C2Expect>(join(unitDir, "c2.json"), "the unit's C2 record");
      let prepared: PreparedSession | null = null;
      let n = 0;
      const contained = await containPoint(
        setup.container.gstack ? "after-install" : "before-session",
        async () => {
          prepared?.container.stop();
          prepared = await prepare({ setup, unit, expect, dir: join(base, "s" + ++n) });
          return problemsOf(prepared);
        },
        async () => {},
      );
      const p = prepared as PreparedSession | null;
      if (!p) return fail("E_INTERNAL", key + ": no container was prepared");
      if (contained.status !== "ok") {
        p.container.stop();
        throw new DcError("E_DCW_CONTAINMENT", key + " failed its container checks twice and is held for the Captain: " + contained.problems.map((x) => x.join("; ")).join(" | then | "));
      }
      const container = p.container;
      if (p.install) writeFileSync(join(base, "install.json"), JSON.stringify({ git_tree: p.install.git_tree, tree_sha256: p.install.tree_sha256, pinned_digest: p.install.pinned_digest, install_digest: p.install.install_digest, networks_after: p.install.networks_after }, null, 2) + "\n");
      let binding: SessionBinding;
      try {
        binding = await proxies.bind(sub.item, { sub, session: cellId(cell), attempt, arm: cell.kind });
      } catch (e) {
        container.stop();
        throw e;
      }
      bindings.set(key, binding);
      items.add(sub.item);
      let ended: Promise<{ spentMicros: number; unknownMicros: number }> | null = null;
      const end = () => (ended ??= proxies.end(binding));
      return {
        box: container.box(),
        exec: container.exec,
        async drive(stop) {
          const proxy = await proxies.open(sub.item);
          const m = DIRECT_MODELS[setup.model];
          const out = join(base, "driver");
          const driver = claudeCodeDriver({
            model: m.id,
            provider: m.provider === "anthropic" ? "anthropic" : "openrouter",
            proxy: { baseUrl: proxy.baseUrl, slot: binding.slot, token: binding.token },
            skill: null,
            out,
            maxTurns: setup.limits.turns,
            capStops: true,
            backgroundWaitMs: setup.backgroundWaitMs,
            disable1mContext: setup.env.CLAUDE_CODE_DISABLE_1M_CONTEXT === "1",
            ...(setup.env.GSTACK_SESSION_KIND === "unattended" ? { sessionKind: "unattended" as const } : {}),
            ...(stop ? { stopHook: stop } : {}),
            ...(s.query ? { query: s.query } : {}),
          });
          const outcome = await driver.run(container.agent(driver.env!), { id: cellId(cell), prompt: setup.prompt }, setup.limits.minutes * 60_000);
          const f = await end();
          const transcript = join(out, "transcript.ndjson");
          const plan = join(container.folder, "plan.md");
          const text = existsSync(transcript) ? readFileSync(transcript, "utf8") : "";
          return {
            transcript: text,
            termination: toolCallEnd(text, outcome.termination),
            errorSeen: proxies.errorSeen(binding),
            sessionEnd: outcome.session_end ?? null,
            planAfter: existsSync(plan) ? readFileSync(plan, "utf8") : null,
            spentUsd: f.unknownMicros > 0 ? null : f.spentMicros / 1e6,
            served: sessionServed(watch, setup.model),
            imageDigest: container.image.digest,
          };
        },
        async close() {
          try {
            await end();
          } finally {
            container.stop();
          }
        },
      };
    },
    async reconcile(cell, attempt) {
      const b = bindings.get(cellId(cell) + ".a" + attempt);
      if (!b) return { ok: false, why: "attempt " + attempt + " of " + cellId(cell) + " was never bound to a proxy slot" };
      const lease = c.lease(b.item);
      if (!lease || !svc.local.meters(lease.leaseId).has(b.meterId)) return { ok: false, why: "the proxy holds no meter " + b.meterId + " for attempt " + attempt + " of " + cellId(cell) };
      return { ok: true, judged: false };
    },
    async close() {
      clearInterval(timer);
      await proxies.stopAll();
      if (net) removeTrialNetwork(net, docker);
      if (installNet) removeNetwork(installNet, docker);
    },
  };
}

/** The checksum the Dockerfile pins for the Claude Code tarball (claudePin's ADD line). */
const pinnedSha = (add: string): string => /--checksum=sha256:([0-9a-f]{64})/.exec(add)![1]!;

/** The pinned Claude Code tarball's bytes, refused with E_USAGE unless its sha256 is the trial image's pinned checksum. */
export function claudeTarball(path: string, root: string): Uint8Array {
  const pin = claudePin(root);
  if (!existsSync(path)) fail("E_USAGE", "the wiring file's vm.claudeTarball " + path + " does not exist; it is Claude Code " + pin.version + "'s npm tarball for linux-x64");
  const bytes = new Uint8Array(readFileSync(path));
  const sha = createHash("sha256").update(bytes).digest("hex");
  if (sha !== pinnedSha(pin.add)) fail("E_USAGE", "the wiring file's vm.claudeTarball is not Claude Code " + pin.version + "'s pinned tarball (sha256 " + sha + ")");
  return bytes;
}

/** Where the Node pin sits under a repo root: the lane's stage3/node-pin.json, the file stage3/install.ts reads as NODE. */
export const nodePinPath = (root: string) => join(root, "lanes", "design-constructed", "stage3", "node-pin.json");

/** Refuses with E_USAGE unless the Node tarball is there and its sha256 is the pin's (nodePinPath under the repo root). */
export function nodeTarball(path: string, root: string): void {
  const pin = JSON.parse(readFileSync(nodePinPath(root), "utf8")) as { version: string; sha256: string };
  if (typeof path !== "string" || !existsSync(path)) fail("E_USAGE", "the wiring file's vm.nodeTarball " + path + " does not exist; it is Node " + pin.version + "'s linux-x64 tar.xz");
  const sha = createHash("sha256").update(readFileSync(path)).digest("hex");
  if (sha !== pin.sha256) fail("E_USAGE", "the wiring file's vm.nodeTarball is not Node " + pin.version + "'s pinned tarball (sha256 " + sha + ")");
}

/** The recipe agent on the VM sessions: Claude Code from the pinned tarball, each session on its item's metering proxy through the VM proxy endpoint. */
export function vmSessionAgents(h: HostContext, s: RealSeams, keyed: VmBackend & { address(vm: Vm): string }, watch: ProviderWatch, w: VmWiring): { recipeAgent: RecipeAgent; claude: ControllerFiles; close(): Promise<void> } {
  if (typeof w.claudeTarball !== "string") fail("E_USAGE", "the wiring file's vm section names no claudeTarball (Claude Code's pinned npm tarball for linux-x64)");
  const root = h.lane().root;
  claudeTarball(w.claudeTarball, root);
  const svc = h.service;
  const front = serveVmFront({ host: w.proxy.host, port: w.proxy.port });
  const launcher = s.vmLauncher ?? inProcessLauncher({ local: svc.local, retry: h.wiring.retry, env: h.env, fetch: s.fetch, sleep: s.sleep });
  const proxies = new SessionProxies({ controller: svc.controller, local: svc.local, wal: svc.wal, watch, dir: join(svc.cfg.journalDir, "sessions"), launcher });
  const sessions = proxySessions({ controller: svc.controller, proxies, front, scanMs: h.wiring.scanMs });
  const out = join(h.dir, "vm-agents");
  mkdirSync(out, { recursive: true, mode: 0o700 });
  const ssh = { keyPath: w.keyPath, knownHosts: w.knownHosts };
  const deps = { backend: keyed, sessions, out, session: s.ubicloud?.agent ?? ((vm: Vm, envFile: string) => sshAgentSession(ssh, keyed.address(vm), envFile)), ...(s.query ? { query: s.query } : {}) };
  return {
    recipeAgent: (vm, o) => runVmAgent(deps, vm, { prompt: o.prompt, limits: o.limits, sub: o.sub }),
    claude: claudeFiles(async () => claudeTarball(w.claudeTarball, root)),
    async close() {
      await sessions.close();
      front.close();
    },
  };
}

/**
 * The VM world: the keyed Ubicloud backend with the token read by name and the controller's install on every sandbox
 * (the browser, and Claude Code where the VM reaches the proxy); specs on the VM proxy endpoint and the mirrors; the
 * browser over SSH to the installed Chromium; the recipe agent. Stage 3's pieces are not here (PD-31).
 */
export async function realVm(h: HostContext, s: RealSeams, watch: ProviderWatch): Promise<VmProvider> {
  const section = h.wiring.vm ?? fail("E_USAGE", "the wiring file has no vm section (Ubicloud's project, the VM shape, the key, the browser build, the Claude Code tarball, the price, the proxy and the mirrors); the Captain sets it (lanes/design-constructed/WIRING.md)");
  const w = resolveVm(section, h.controller?.() ?? null, h.addresses);
  const cb = w.chromiumBuild;
  if (!cb || typeof cb.dir !== "string" || typeof cb.bin !== "string") fail("E_USAGE", "the wiring file's vm section names no chromiumBuild (the Playwright Chromium folder on this host and the binary's path inside it)");
  if (!existsSync(join(cb.dir, cb.bin)) || !statSync(join(cb.dir, cb.bin)).isFile()) fail("E_USAGE", "the wiring file's vm.chromiumBuild has no binary at " + join(cb.dir, cb.bin));
  nodeTarball(w.nodeTarball, h.lane().root);
  const keyed = await keyedUbicloud({ project: w.project, location: w.location, size: w.size, image: w.image, privateSubnet: w.privateSubnet ?? undefined, env: h.env, keyPath: w.keyPath, knownHosts: w.knownHosts, ...(s.ubicloud ? { fetch: s.ubicloud.fetch, ssh: s.ubicloud.ssh } : {}) });
  const agents = vmSessionAgents(h, s, keyed, watch, w);
  const backend = controllerBackend(keyed, { browser: browserFiles(cb.dir, cb.bin), node: nodeFiles(w.nodeTarball), agent: agents.claude });
  return {
    backend,
    priceMicrosPerHour: w.priceMicrosPerHour,
    now: () => Date.now(),
    spec: (kind, label) => specFor(kind, label, { proxy: w.proxy, mirrors: w.mirrors, env: h.env }),
    browser: playwrightBrowser({ backend, tunnel: s.ubicloud?.tunnel ?? sshTunnel({ keyPath: w.keyPath, knownHosts: w.knownHosts }, (vm) => keyed.address(vm)), chromium: BROWSER_ROOT + "/" + cb.bin }),
    recipeAgent: agents.recipeAgent,
    close: agents.close,
  };
}
