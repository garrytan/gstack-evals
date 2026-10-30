// The R5 egress and R6 sealed-store probes on this machine (Docker tier, GSTACK_EVALS_DOCKER=1), and the replay lane's
// fake-upstream probe. A rig that is right passes every probe; an agent container put on the open egress network, or one
// with the proxy's management socket mounted, fails them, and an admission built on those results refuses the lease.
import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { admit, REQUIRED_PROBES, rigAdmission } from "../../src/rig/admission.ts";
import { agentProbes, openProbeRig, replayProbe, rigProbes, type ProbeRig } from "../../src/rig/rig-probes.ts";
import { openLease } from "../../src/runner/ledger/ledger.ts";
import type { AgentSession } from "../../src/trial/sandbox.ts";
import { buildTrialImage, stateRoot } from "../../src/trial/image.ts";
import { fakeGitHub, fingerprint, greenTier, initItem, REPO, scratchRepo } from "./helpers.ts";

const DOCKER = process.env.GSTACK_EVALS_DOCKER === "1";
let cleanup: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanup.reverse()) c();
  cleanup = [];
});

/** An agent container started by hand with what the trial sandbox never gives one: a network, or an extra mount. */
function rawAgent(image: string, rig: ProbeRig, o: { network: string; mount?: string }): AgentSession {
  const args = ["run", "-d", "--rm", "--network", o.network, "--entrypoint", "sleep"];
  for (const [k, v] of Object.entries(rig.ctx.agentEnv)) args.push("-e", k + "=" + v);
  if (o.mount) args.push("-v", o.mount + ":" + o.mount);
  const id = spawnSync("docker", [...args, image, "infinity"], { encoding: "utf8" }).stdout.trim();
  if (!id) throw new Error("docker run failed");
  const stop = () => void spawnSync("docker", ["rm", "-f", id]);
  return { exec: (command, timeoutMs) => ({ stdout: spawnSync("docker", ["exec", id, "sh", "-c", command], { encoding: "utf8", timeout: timeoutMs }).stdout ?? "", stderr: "", exit: 0 }) as never, spawn: () => { throw new Error("not used"); }, stop } as AgentSession;
}

/** A lease on an item whose admission rests on these probe results. */
function leaseOn(probes: ReturnType<typeof agentProbes>): string {
  const repo = scratchRepo();
  const record = mkdtempSync(join(tmpdir(), "gse-probe-record-"));
  cleanup.push(() => rmSync(repo.root, { recursive: true, force: true }), () => rmSync(record, { recursive: true, force: true }));
  initItem(record, "u11-lanea", "required");
  const gh = fakeGitHub([{ head_sha: repo.commit, tree: repo.tree, tier: greenTier(repo) }]);
  const all = REQUIRED_PROBES.trial.map((id) => probes.find((p) => p.id === id) ?? { id, requirement: "R6" as const, pass: true, detail: "not probed here" });
  admit({ record, item: "u11-lanea", proof: "trial", prereg: repo.prereg, repo: REPO, machineId: "m-1", gh, probes: () => all, fingerprint: fingerprint(), root: repo.root });
  try {
    openLease(record, null, { item: "u11-lanea", run_id: "run-1", machine_id: "m-1", requireAdmission: rigAdmission({ root: repo.root, fingerprint: fingerprint() }) });
    return "leased";
  } catch (error) {
    return (error as { code: string }).code + " " + (error as Error).message;
  }
}

describe("the replay lane's fake-upstream probe", () => {
  test("passes keyless on this machine", () => {
    expect(replayProbe()).toMatchObject({ id: "replay.fake-upstream", requirement: "replay", pass: true });
  }, 600_000);
});

describe("R5 and R6 probe commands that do not finish", () => {
  const DONE = "__gse_probe_done__";
  const ctx = { work: "/tmp", workPath: "/work/t", baseUrl: "http://127.0.0.1:1", socket: "/run/probe.sock", gateway: "127.0.0.1", bridge: "127.0.0.1", hostPort: 1, outside: null, fakeKey: "k", managementToken: "t", canary: "c", sealedDir: "/s", agentEnv: {} } as unknown as Parameters<typeof agentProbes>[1];
  const done = (status: number) => DONE + " " + status;
  const fake = (answer: (command: string) => { stdout: string; exitCode: number | null; timedOut?: boolean }) =>
    ({ exec: (command: string) => ({ timedOut: false, error: undefined, ...answer(command) }), spawn: () => { throw new Error("unused"); }, stop: () => {} }) as unknown as AgentSession;

  test("fail instead of reading an empty answer as clean: a non-zero exit, a timeout, a missing tool or unreadable output", () => {
    const ids = REQUIRED_PROBES.trial.filter((id) => id !== "r6.workflows");
    const failed = agentProbes(fake((c) => (c.startsWith("for t in") ? { stdout: done(0), exitCode: 0 } : c.includes("grep -rlFa") ? { stdout: "", exitCode: null, timedOut: true } : { stdout: "", exitCode: 1 })), ctx);
    expect(failed.map((p) => p.id)).toEqual([...ids]);
    expect(failed.filter((p) => p.pass)).toEqual([]);
    expect(failed.find((p) => p.id === "r6.history")!.detail).toContain("did not finish (exit 1)");
    expect(failed.find((p) => p.id === "r6.canary")!.detail).toContain("did not finish (timed out)");
    const lacking = agentProbes(fake((c) => ({ stdout: (c.startsWith("for t in") ? "find " : "") + done(0), exitCode: 0 })), ctx);
    expect(lacking.every((p) => !p.pass && p.detail === "the agent image lacks find, so the probes cannot run")).toBe(true);
    const empty = agentProbes(fake(() => ({ stdout: done(0), exitCode: 0 })), ctx);
    expect(empty.filter((p) => ["r5.sockets", "r6.mounts", "r6.env"].includes(p.id)).map((p) => p.pass)).toEqual([false, false, false]);
    const unmarked = agentProbes(fake(() => ({ stdout: "", exitCode: 0 })), ctx);
    expect(unmarked.every((p) => !p.pass)).toBe(true);
  });

  test("judge the command's own exit status, and a scan only when it reaches the control it planted", () => {
    const toolCheck = (c: string) => c.startsWith("for t in");
    const killed = agentProbes(fake((c) => ({ stdout: toolCheck(c) ? done(0) : done(137), exitCode: 0 })), ctx);
    expect(killed.filter((p) => p.pass)).toEqual([]);
    expect(killed.find((p) => p.id === "r6.canary")!.detail).toContain("did not finish (exit 137)");
    expect(killed.find((p) => p.id === "r5.keys")!.detail).toContain("did not finish (exit 137)");
    const blind = agentProbes(fake((c) => ({ stdout: toolCheck(c) ? done(0) : c.includes("grep -rlFa") ? done(2) : c.includes(" -print ") ? done(1) : done(0), exitCode: 0 })), ctx);
    for (const id of ["r5.sockets", "r6.canary", "r6.history"]) expect(blind.find((p) => p.id === id)!.detail).toContain("never reached the control");
    const scanned = (canary: string) => agentProbes(fake((c) => ({ stdout: toolCheck(c) ? done(0) : c.includes("grep -rlFa") ? canary + done(2) : c.includes(" -print ") ? "/work/t/.gse-probe-control\n" + done(1) : done(0), exitCode: 0 })), ctx);
    const clean = scanned("/work/t/.gse-probe-canary\n");
    expect(clean.filter((p) => p.id === "r6.canary" || p.id === "r6.history").map((p) => p.pass)).toEqual([true, true]);
    const reached = scanned("/work/t/.gse-probe-canary\n/sealed/canary.txt\n").find((p) => p.id === "r6.canary")!;
    expect(reached.pass).toBe(false);
    expect(reached.detail).toContain("at /sealed/canary.txt");
  });
});

describe.skipIf(!DOCKER)("R5 and R6 probes (Docker tier, GSTACK_EVALS_DOCKER=1)", () => {
  let image = "";
  const rigFor = () => {
    if (!image) {
      const built = buildTrialImage({ state: stateRoot() });
      if (!built.ok) throw new Error(built.code + ": " + built.message);
      image = built.tag;
    }
    const rig = openProbeRig({ image });
    cleanup.push(rig.close);
    return rig;
  };

  test("every probe passes against the trial sandbox on this machine", () => {
    rigFor();
    const results = rigProbes({ image });
    expect(results.filter((p) => !p.pass)).toEqual([]);
    expect(results.map((p) => p.id).sort()).toEqual([...REQUIRED_PROBES.trial].sort());
  }, 900_000);

  test("an agent on the open egress network fails the egress probes, and its admission refuses", () => {
    const rig = rigFor();
    const agent = rawAgent(image, rig, { network: rig.net.egress });
    cleanup.push(agent.stop);
    const results = agentProbes(agent, rig.ctx);
    const failed = results.filter((p) => !p.pass).map((p) => p.id);
    expect(failed).toEqual(expect.arrayContaining(["r5.outside", "r5.dns"]));
    expect(leaseOn(results)).toMatch(/^E_RIG_UNPROVEN .*is red: .*probe r5\.outside failed/);
  }, 900_000);

  test("an agent that can reach the proxy's management socket fails the socket probe, and its admission refuses", () => {
    const rig = rigFor();
    const agent = rawAgent(image, rig, { network: rig.net.name, mount: dirname(rig.ctx.socket) });
    cleanup.push(agent.stop);
    const results = agentProbes(agent, rig.ctx);
    const failed = results.filter((p) => !p.pass).map((p) => p.id);
    expect(failed).toEqual(expect.arrayContaining(["r5.sockets", "r6.mounts"]));
    expect(leaseOn(results)).toMatch(/^E_RIG_UNPROVEN .*probe r5\.sockets failed/);
  }, 900_000);
});
