// The keyless probes rig admit runs on the machine that will spend (CI plan v5, R5 and R6; U20). openProbeRig stands up
// the trial network and the metering proxy container as a run does (src/trial/proxy.ts), and agentProbes checks from an
// agent container on it:
// - R5, egress: the proxy answers, and nothing else does: no outside address this machine reaches, no DNS, no gateway or
//   host service on either bridge, no unix socket (the proxy's management socket or Docker's), and no provider key or
//   management token in the agent's env.
// - R6, the sealed store: no mount but the work dir, no env name off the agent allowlist, a canary planted on this machine
//   beside the work dir is unreadable, no git repository or pack outside the work dir, and no workflow reads a secret or
//   names a sealed key.
// The proxy holds a made-up key and binds no slot, so no probe can reach a provider. replayProbe runs the replay lane's
// fake-upstream tests, the probe for direct-API runs and judge calibration.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removeTree } from "../trial/cleanup.ts";
import { ROLE_ENV, trialEnv } from "../trial/env.ts";
import { createTrialNetwork, removeTrialNetwork, startProxyContainer, type ProxyHandle, type TrialNetwork } from "../trial/proxy.ts";
import { dockerSandbox, type AgentSession } from "../trial/sandbox.ts";
import type { ProbeResult } from "./admission.ts";
import { RIG_ROOT } from "./recipe.ts";
import { junitCases, keylessEnv } from "./tier.ts";

export interface ProbeContext {
  /** The agent's work dir on this machine, and where the sandbox mounts it. */
  work: string;
  workPath: string;
  baseUrl: string;
  socket: string;
  /** The egress network's gateway, and this machine's address on the internal bridge. */
  gateway: string;
  bridge: string;
  /** A listener on every address of this machine, which no agent may reach. */
  hostPort: number;
  /** An outside IPv4 address for example.com, or null when this machine resolves none. */
  outside: string | null;
  fakeKey: string;
  managementToken: string;
  canary: string;
  sealedDir: string;
  agentEnv: Record<string, string>;
}

export interface ProbeRig {
  net: TrialNetwork;
  proxy: ProxyHandle;
  ctx: ProbeContext;
  close(): void;
}

const TASK = "probe";
const PRUNE = "find / \\( -path /proc -o -path /sys -o -path /dev \\) -prune -o ";
const curlCode = (url: string) => "curl -s -m 5 -o /dev/null -w '%{http_code}' " + url + "; true";
const hostCode = (url: string) => (spawnSync("curl", ["-s", "-m", "5", "-o", "/dev/null", "-w", "%{http_code}", url], { encoding: "utf8" }).stdout ?? "").trim();

/** The trial network, the proxy container and a host listener, set up the way a run sets them up. */
export function openProbeRig(o: { image: string; docker?: string }): ProbeRig {
  const docker = o.docker ?? "docker";
  const scratch = mkdtempSync(join(tmpdir(), "gse-probe-"));
  const fakeKey = "sk-ant-probe-not-a-key-" + randomBytes(12).toString("hex");
  const managementToken = randomBytes(24).toString("hex");
  const canary = "GSE-SEALED-CANARY-" + randomBytes(12).toString("hex");
  const sealedDir = join(scratch, "sealed-store");
  const work = join(scratch, "work");
  for (const dir of [sealedDir, work, join(scratch, "ledger")]) mkdirSync(dir);
  writeFileSync(join(sealedDir, "canary.txt"), canary + "\n");
  writeFileSync(join(work, "README.md"), "The rig probe's work dir.\n");
  let net: TrialNetwork | null = null;
  let proxy: ProxyHandle | null = null;
  let listener: ChildProcess | null = null;
  const close = () => {
    proxy?.stop();
    if (net) removeTrialNetwork(net, docker);
    listener?.kill();
    removeTree(scratch);
  };
  try {
    net = createTrialNetwork(docker);
    proxy = startProxyContainer({ image: o.image, net, dir: join(scratch, "proxy"), ledger: join(scratch, "ledger", "ledger.sqlite"), leaseId: "rig-probe", managementToken, retry: { attempts: 1, elapsed_ms: 1000 }, providerKeys: { ANTHROPIC_API_KEY: fakeKey }, docker });
    const gateway = spawnSync(docker, ["network", "inspect", "-f", "{{(index .IPAM.Config 0).Gateway}}", net.egress], { encoding: "utf8" }).stdout.trim();
    const outside = (spawnSync("getent", ["ahostsv4", "example.com"], { encoding: "utf8" }).stdout ?? "").trim().split(/\s+/)[0] || null;
    const hostPort = 20_000 + Math.floor(Math.random() * 10_000);
    listener = spawn(process.execPath, ["-e", "Bun.serve({ hostname: '0.0.0.0', port: " + hostPort + ", fetch: () => new Response('host') }); setInterval(() => {}, 1e6)"], { stdio: "ignore" });
    for (let i = 0; i < 50 && hostCode("http://127.0.0.1:" + hostPort + "/") !== "200"; i++) Bun.sleepSync(100);
    const agentEnv = trialEnv("agent", { PATH: "/usr/local/bin:/usr/bin:/bin", HOME: "/home/agent", LANG: "C.UTF-8", TERM: "dumb", ANTHROPIC_BASE_URL: proxy.baseUrl, ANTHROPIC_API_KEY: "gse_" + randomBytes(32).toString("base64url") }, [], { ANTHROPIC_API_KEY: fakeKey });
    const ctx: ProbeContext = { work, workPath: "/work/" + TASK, baseUrl: proxy.baseUrl, socket: proxy.socket, gateway, bridge: net.subnet.replace(/0\/24$/, "1"), hostPort, outside, fakeKey, managementToken, canary, sealedDir, agentEnv };
    return { net, proxy, ctx, close };
  } catch (error) {
    close();
    throw error;
  }
}

/** A marker the agent prints after each probe command, so a command cut short reads as unfinished, not as empty. */
const DONE = "__gse_probe_done__";

/**
 * The R5 and R6 checks from inside one agent session. A probe whose command did not finish (a non-zero exit, a timeout,
 * a failed exec, no completion marker) fails, and so does every probe when the agent image lacks a tool they use, so an
 * empty answer counts as clean only when the search really ran.
 */
export function agentProbes(agent: AgentSession, ctx: ProbeContext): ProbeResult[] {
  const sh = (command: string, timeoutMs = 60_000) => {
    const r = agent.exec(command + "\necho " + DONE, timeoutMs);
    const text = r.stdout.trim();
    if (r.timedOut || r.error || r.exitCode !== 0 || !text.endsWith(DONE)) throw new Error("the agent's command did not finish (" + (r.timedOut ? "timed out" : r.error ? String(r.error) : "exit " + r.exitCode) + "), so this probe proves nothing: " + command.split("\n")[0]!.slice(0, 80));
    return text.slice(0, -DONE.length).trim();
  };
  let broken = "";
  try {
    const missing = sh("for t in cat curl env find getent grep head test; do command -v \"$t\" >/dev/null || printf '%s ' \"$t\"; done");
    if (missing) broken = "the agent image lacks " + missing.trim() + ", so the probes cannot run";
  } catch (error) {
    broken = (error as Error).message;
  }
  const out: ProbeResult[] = [];
  const probe = (requirement: ProbeResult["requirement"], id: string, check: () => [boolean, string]) => {
    if (broken) return out.push({ id, requirement, pass: false, detail: broken });
    try {
      const [pass, detail] = check();
      out.push({ id, requirement, pass, detail });
    } catch (error) {
      out.push({ id, requirement, pass: false, detail: (error as Error).message });
    }
  };

  probe("R5", "r5.proxy", () => {
    const proxy = sh('curl -s -m 10 -o /dev/null -w "%{http_code}" -H "x-api-key: $ANTHROPIC_API_KEY" "$ANTHROPIC_BASE_URL/v1/models"; true');
    return [/^40[13]$/.test(proxy), "the proxy answered an unbound bearer with " + proxy + " (401 or 403 expected)"];
  });
  probe("R5", "r5.outside", () => {
    if (!ctx.outside) return [false, "this machine resolves no outside address for example.com, so the egress probe has no control"];
    const control = hostCode("http://" + ctx.outside + "/");
    const seen = sh(curlCode("http://" + ctx.outside + "/"));
    return [control !== "000" && control !== "" && seen === "000", "this machine reaches " + ctx.outside + " (" + control + "); the agent got " + seen + " (000 expected)"];
  });
  probe("R5", "r5.dns", () => {
    const dns = sh("getent hosts example.com >/dev/null && echo RESOLVED || echo NODNS");
    return [dns === "NODNS", "the agent's lookup of example.com: " + dns];
  });
  probe("R5", "r5.gateway", () => {
    const control = hostCode("http://" + ctx.gateway + ":" + ctx.hostPort + "/");
    const seen = [sh(curlCode("http://" + ctx.gateway + "/")), sh(curlCode("http://" + ctx.gateway + ":" + ctx.hostPort + "/")), sh(curlCode("http://" + ctx.bridge + ":" + ctx.hostPort + "/"))];
    return [control === "200" && seen.every((c) => c === "000"), "this machine serves port " + ctx.hostPort + " on " + ctx.gateway + " (" + control + "); the agent got " + seen.join(", ") + " from the egress gateway, that port on it and that port on the internal bridge " + ctx.bridge + " (000 expected)"];
  });
  probe("R5", "r5.sockets", () => {
    const socket = sh("test -e " + JSON.stringify(ctx.socket) + " && echo PRESENT || echo ABSENT");
    const sockets = sh(PRUNE + "-type s -print 2>/dev/null | head -5", 120_000);
    return [socket === "ABSENT" && sockets === "", "the proxy's management socket is " + socket.toLowerCase() + " in the agent; unix sockets it can see: " + (sockets.replace(/\n/g, ", ") || "none")];
  });
  probe("R5", "r5.keys", () => {
    const env = sh("env");
    const leaked = [ctx.fakeKey, ctx.managementToken, "GSTACK_EVALS_PROXY_TOKEN"].filter((s) => env.includes(s));
    return [leaked.length === 0, leaked.length ? "the agent's env holds " + leaked.length + " of the provider key, the management token and its name" : "the agent's env holds no provider key and no management token"];
  });

  probe("R6", "r6.mounts", () => {
    const mounts = sh("cat /proc/self/mountinfo").split("\n").map((l) => (l.split(" ")[4] ?? "").replace(/\\(\d{3})/g, (_, o: string) => String.fromCharCode(parseInt(o, 8)))).filter(Boolean);
    if (!mounts.includes("/")) return [false, "the agent's mountinfo lists no root mount, so its mounts could not be read"];
    const extra = mounts.filter((p) => p !== "/" && p !== ctx.workPath && !/^\/(proc|dev|sys)(\/|$)/.test(p) && !["/etc/hosts", "/etc/hostname", "/etc/resolv.conf"].includes(p));
    return [extra.length === 0, extra.length ? "the agent sees mounts besides its work dir: " + extra.join(", ") : "the agent's only mount is its work dir " + ctx.workPath];
  });
  probe("R6", "r6.env", () => {
    const allowed = new Set<string>([...ROLE_ENV.agent, "HOSTNAME", "PWD", "OLDPWD", "SHLVL", "_"]);
    const names = sh("env").split("\n").map((l) => l.split("=")[0]!).filter((n) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(n));
    if (!names.includes("PATH")) return [false, "the agent's env lists no PATH, so its env could not be read"];
    const off = names.filter((n) => !allowed.has(n));
    return [off.length === 0, off.length ? "the agent's env has names off its allowlist: " + off.join(", ") : "every name in the agent's env is on its allowlist"];
  });
  probe("R6", "r6.canary", () => {
    const found = sh("grep -rlFa " + JSON.stringify(ctx.canary) + " / --exclude-dir=proc --exclude-dir=sys --exclude-dir=dev 2>/dev/null | head -1", 600_000);
    return [found === "", found ? "the agent can read the canary planted in " + ctx.sealedDir + ", at " + found : "the canary planted beside the work dir is out of the agent's reach"];
  });
  probe("R6", "r6.history", () => {
    const repos = sh(PRUNE + "\\( -name .git -o -name '*.pack' -o -name packed-refs \\) -print 2>/dev/null | head -5", 120_000);
    return [repos === "", repos ? "the agent sees git history outside a task's work: " + repos.replace(/\n/g, ", ") : "no git repository, pack or packed-refs is visible to the agent"];
  });
  return out;
}

const SEALED_NAME = /\b[A-Z0-9_]*(?:SEALED|HELD_?OUT|HOLD_?OUT)[A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASS)[A-Z0-9_]*\b/g;

/** R6: no workflow reads a secret or names a sealed key, so no CI run can hand one to a trial. */
export function workflowProbe(root: string = RIG_ROOT): ProbeResult {
  const dir = join(root, ".github", "workflows");
  const hits: string[] = [];
  for (const f of readdirSync(dir).filter((n) => /\.ya?ml$/.test(n)).sort()) {
    const text = readFileSync(join(dir, f), "utf8");
    if (/\bsecrets\./.test(text)) hits.push(f + " reads secrets.");
    for (const m of text.matchAll(SEALED_NAME)) hits.push(f + " names " + m[0]);
  }
  return { id: "r6.workflows", requirement: "R6", pass: hits.length === 0, detail: hits.length ? hits.join("; ") : "no workflow reads a secret or names a sealed key" };
}

/** Every R5 and R6 probe on this machine, from an agent container on a fresh trial network. */
export function rigProbes(o: { image: string; docker?: string; root?: string }): ProbeResult[] {
  const rig = openProbeRig(o);
  let agent: AgentSession | null = null;
  try {
    agent = dockerSandbox({ trialImage: o.image, ...(o.docker ? { docker: o.docker } : {}) }).agent(TASK, { work: rig.ctx.work, env: rig.ctx.agentEnv, network: rig.net.name });
    return [...agentProbes(agent, rig.ctx), workflowProbe(o.root)];
  } finally {
    agent?.stop();
    rig.close();
  }
}

export const REPLAY_TESTS = "./tests/replay/run.test.ts";

/** The replay lane's fake-upstream tests on this machine, with no credential in the env. */
export function replayProbe(root: string = RIG_ROOT): ProbeResult {
  const scratch = mkdtempSync(join(tmpdir(), "gse-replay-probe-"));
  const junit = join(scratch, "junit.xml");
  try {
    const r = spawnSync(process.execPath, ["test", REPLAY_TESTS, "--reporter=junit", "--reporter-outfile=" + junit], { cwd: root, env: keylessEnv(), encoding: "utf8", timeout: 600_000, maxBuffer: 64 * 1024 * 1024 });
    const cases = existsSync(junit) ? junitCases(readFileSync(junit, "utf8")) : [];
    const bad = cases.filter((c) => c.status !== "pass");
    const pass = r.status === 0 && cases.length > 0 && bad.length === 0;
    return { id: "replay.fake-upstream", requirement: "replay", pass, detail: REPLAY_TESTS + ": " + cases.length + " cases, exit " + r.status + (bad.length ? ", not passing: " + bad.map((c) => c.status + " " + c.key).join("; ") : "") };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
