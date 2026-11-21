// Copyright (c) 2026 Garry Tan. MIT License.
// The Sol arms' half of the office-hours rewrite rig (the second attempt's pre-run change 2). withCodex takes the lane's
// Docker rig, whose proxy, lease and ledger items every arm shares, and adds:
// - the Codex installs: each skill arm runs gstack's own ./setup --host codex --no-browser -q from its pin's tree in the
//   builder (src/arms/install.ts, host codex), so its CODEX_HOME is ~/.codex in its own arm image; none is bare, with no
//   install and no ~/.codex;
// - one arm image per arm from them (armImages), and a sandbox per arm;
// - the model tap (run/tap.ts) in a container of its own on the trial network, in front of the proxy, logging to
//   <out>/tap/models.ndjson; Codex's base URL is the tap's. close stops the tap, then closes the rig.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { dockerInstaller, installArms, releaseInstalls, runHold, stackSources } from "../../../src/arms/install.ts";
import { armImages, sentinels, type HostRig } from "../../../src/skill-eval/cli/run-host.ts";
import { checkImagePin, stateRoot } from "../../../src/trial/image.ts";
import { dockerSandbox, type Sandbox } from "../../../src/trial/sandbox.ts";
import type { ArmSpec } from "../../../src/types.ts";
import { reportsPin } from "../pinned.ts";

export const TAP_PORT = 8099;
const TAP_SCRIPT = join(import.meta.dir, "tap.ts");

export interface CodexArms {
  arms: HostRig["arms"];
  sandbox(arm: string): Sandbox;
  /** The base URL agents reach the tap at, in front of the proxy. */
  baseUrl: string;
  tapLog: string;
}
export type OhrRig = HostRig & { codex?: CodexArms };

/** The models the tap saw a slot's successful responses report, each once; a response with no model reads "(no model)". Null when there is no tap log. */
export function tapModels(log: string, slot: string): string[] | null {
  if (!existsSync(log)) return null;
  const seen = new Set<string>();
  for (const l of readFileSync(log, "utf8").split("\n")) {
    if (!l.trim()) continue;
    const r = JSON.parse(l) as { slot: string; status: number; responses: { model: string | null }[] };
    if (r.slot !== slot || r.status < 200 || r.status >= 300) continue;
    for (const x of r.responses.length ? r.responses : [{ model: null }]) seen.add(x.model ?? "(no model)");
  }
  return [...seen];
}

/** The models the tap saw a slot's successful responses report that are not the pin, each once; no tap log reads "(no tap log)". */
export function tapOffPin(log: string, slot: string, pin: string): string[] {
  const models = tapModels(log, slot);
  return models === null ? ["(no tap log)"] : models.filter((m) => !reportsPin(pin, m));
}

export function withCodex(rig: HostRig, o: { arms: readonly ArmSpec[]; env: Record<string, string | undefined>; out: string; tasks: string; runId: string; nonce: string }): OhrRig {
  const bin = o.env.GSTACK_EVALS_DOCKER_BIN || "docker";
  const state = stateRoot(o.env);
  const pin = checkImagePin({ state, docker: bin });
  if (!pin.ok) throw new Error(pin.code + ": " + pin.message);
  const home = dockerSandbox({ trialImage: pin.pin.tag, docker: bin }).homePath("");
  const hold = runHold(state, o.runId + "-codex");
  const skills = Object.fromEntries(o.arms.filter((a) => a.kind !== "bare").map((a) => [a.name, "office-hours"]));
  const installs = installArms({ host: "codex", arms: o.arms, skill: null, skills, base: null, sources: stackSources({ root: null, home: homedir(), state }), runner: dockerInstaller({ image: pin.pin.tag, digest: pin.pin.digest, docker: bin, home }), state, hold });
  const images = armImages({ trialImage: pin.pin.tag, home, installs, marks: sentinels(o.arms as ArmSpec[], o.nonce), tasksDir: dirname(resolve(o.tasks)), state, docker: bin, out: join(o.out, "codex"), retain: join(state, "retained") });
  const dir = join(o.out, "tap");
  mkdirSync(dir, { recursive: true });
  const log = join(dir, "models.ndjson");
  writeFileSync(log, "");
  writeFileSync(join(dir, "tap.json"), JSON.stringify({ upstream: rig.baseUrl, port: TAP_PORT, log }) + "\n");
  const name = "ohr-tap-" + randomBytes(5).toString("hex");
  const user = (process.getuid?.() ?? 1000) + ":" + (process.getgid?.() ?? 1000);
  const run = spawnSync(bin, ["run", "-d", "--name", name, "--network", rig.network!, "--user", user, "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--read-only", "--tmpfs", "/tmp", "-v", dir + ":" + dir, "-v", TAP_SCRIPT + ":/opt/ohr-tap/tap.ts:ro", "--entrypoint", "bun", pin.pin.tag, "/opt/ohr-tap/tap.ts", join(dir, "tap.json")], { encoding: "utf8" });
  if (run.status !== 0) throw new Error("E_OHR_TAP the model tap did not start: " + run.stderr.trim());
  const deadline = Date.now() + 30_000;
  while (!spawnSync(bin, ["logs", name], { encoding: "utf8" }).stdout.includes("TAP_READY") && Date.now() < deadline) Bun.sleepSync(200);
  const stopTap = () => spawnSync(bin, ["rm", "-f", name], { stdio: "ignore" });
  if (Date.now() >= deadline) {
    stopTap();
    throw new Error("E_OHR_TAP the model tap did not answer within 30 s");
  }
  return {
    ...rig,
    codex: { arms: Object.fromEntries(installs.map((i) => [i.name, i])), sandbox: (arm) => dockerSandbox({ trialImage: pin.pin.tag, armImage: images.get(arm)!, docker: bin }), baseUrl: "http://" + name + ":" + TAP_PORT, tapLog: log },
    async close() {
      stopTap();
      try {
        return await rig.close();
      } finally {
        releaseInstalls(hold);
      }
    },
  };
}
