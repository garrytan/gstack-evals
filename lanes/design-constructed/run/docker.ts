// Copyright (c) 2026 Garry Tan. MIT License.
// The Docker session rig for review sessions (prereg section 4; 2026-11-09-geva-420 section 4; plan sections 7 and
// 10). One container per session, from the pinned trial image run by its digest (src/trial/image.ts): HOME is
// arms.ts HOME and empty at start, and the only mounts are the three frozen paths, binds of the session's own copy of
// the unit (repo/, plan.md and context/), so no drive or other host folder is mounted. The container joins one
// network, the run's trial network, where the metering proxy container (src/trial/proxy.ts) is the only thing it can
// reach. Its env comes from the agent allowlist (src/trial/env.ts) with no key variable at all; the session's bearer
// goes only on the CLI's own docker exec, through the docker client's env, never on its command line.
// Setup order (section 4): copy the export into the session folder, start the container, C3 on a listing read inside
// the container, C2 inside the container against its own mounts, then in the two gstack arms gstack's install at the
// pin (the frozen command, in HOME/.claude/skills/gstack), C2 again and C3 again. The install alone joins an install
// network for its package downloads and leaves it before the second C2; clean arms get no install and no install
// network. The RunBox and the agent session run their reads and the CLI inside the same container.
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { stackTree } from "../../../src/arms/install.ts";
import { dockerEnvArgs, PROVIDER_KEY_ENV, trialEnv } from "../../../src/trial/env.ts";
import { checkImagePin, stateRoot } from "../../../src/trial/image.ts";
import type { AgentSession, StepResult } from "../../../src/trial/sandbox.ts";
import { fail } from "../errors.ts";
import { GSTACK_PIN, HARNESS } from "../frozen.ts";
import { containerProblems, HOME, type SessionSetup } from "./arms.ts";
import { pickRuns } from "./box.ts";
import { CONTAINER_MOUNTS, runC2, type C2Expect } from "./contain.ts";
import { SENTINEL_KEYS } from "./hostile.ts";
import type { Exec, ExecResult, RunBox } from "./types.ts";

/** The review image: the pinned trial image's tag and the digest every session records (BT). */
export interface ReviewImage {
  tag: string;
  digest: string;
}

/** The pinned trial image for this checkout's recipe, equal to expectDigest when a run recorded one; else E_DC_INFRA_MISSING. */
export function reviewImage(o: { state?: string; expectDigest?: string | null } = {}): ReviewImage {
  const pin = checkImagePin({ state: o.state ?? stateRoot(), expectDigest: o.expectDigest ?? null });
  if (!pin.ok) return fail("E_DC_INFRA_MISSING", "review image: " + pin.code + " " + pin.message);
  return { tag: pin.pin.tag, digest: pin.pin.digest };
}

/** Where gstack's checkout goes in the gstack arms (gstack's README install for Claude Code, BT). */
export const GSTACK_CHECKOUT = HOME + "/.claude/skills/gstack";
const PATH = "/usr/local/bin:/usr/bin:/bin";
const BUFFER = 256 * 1024 * 1024;
const USER = () => (process.getuid?.() ?? 1000) + ":" + (process.getgid?.() ?? 1000);
const HARDENING = ["--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--pids-limit", "1024"];
const clientEnv = (): Record<string, string> => Object.fromEntries(["PATH", "HOME", "DOCKER_HOST", "DOCKER_CONFIG", "DOCKER_CONTEXT", "XDG_RUNTIME_DIR"].flatMap((k) => (process.env[k] ? [[k, process.env[k]!]] : [])));
const mountPath = (m: string) => m.replace(/\/+$/, "");
/** A key, token or other secret's variable name: the sentinel's names, the provider keys, and any API key, token, secret or password name. */
const isKeyName = (n: string): boolean => (SENTINEL_KEYS as readonly string[]).includes(n) || PROVIDER_KEY_ENV.includes(n) || /API_?KEY|TOKEN|SECRET|PASS(WORD|WD|PHRASE)|CREDENTIAL|PRIVATE_?KEY|ACCESS_?KEY/i.test(n);

/** C3's listing, run inside a container: every path under HOME, the frozen mount points that exist, every mount point the kernel lists, and any drive path. */
export const LISTING_SH = 'find "$HOME" -mindepth 1; ' + CONTAINER_MOUNTS.map((m) => '[ -e "' + m + '" ] && echo "' + m + '"').join("; ") + "; awk '{print $5}' /proc/self/mountinfo; [ -e /drive ] && echo /drive; find / -maxdepth 6 \\( -path /proc -o -path /sys -o -path /dev -o -path /work \\) -prune -o -path '*/.capy/drive' -print 2>/dev/null; true";

/** The unit as one session gets it: the export's folder, plan.md and the context folder, on this host. */
export interface UnitFiles {
  repo: string;
  plan: string;
  context: string;
}

/** Copies the unit into a new session folder (repo/, plan.md, context/), the bind sources of the three mounts. */
export function sessionFolder(unit: UnitFiles, dir: string): string {
  if (existsSync(dir)) fail("E_DC_INFRA_MISSING", "session folder " + dir + " exists already; every session gets a new one");
  mkdirSync(dir, { recursive: true });
  cpSync(unit.repo, join(dir, "repo"), { recursive: true, verbatimSymlinks: true });
  cpSync(unit.plan, join(dir, "plan.md"));
  cpSync(unit.context, join(dir, "context"), { recursive: true, verbatimSymlinks: true });
  return dir;
}

export interface ReviewContainer {
  name: string;
  image: ReviewImage;
  network: string;
  /** The session folder on this host. */
  folder: string;
  /** One shell call in the container, in /work, with the container's env (C2's exec seam). */
  exec: Exec;
  run(command: string, timeoutMs?: number): ExecResult;
  /** Every path under HOME, the mount points, every mount point the kernel lists and any drive path: C3's listing. */
  listing(): string[];
  /** docker inspect's view: image, user, mounts, networks and env names (names only; docker prints no value). */
  inspect(): { image: string; user: string; mounts: Array<{ type: string; source: string; destination: string }>; networks: string[]; env: string[] };
  /** The gate hook's and the detectors' reads, inside this container, with gstack's binaries from its checkout. */
  box(): RunBox;
  /** The agent session the driver spawns the CLI through; env is the driver's agent env, checked on the agent allowlist. */
  agent(env: Record<string, string>): AgentSession;
  /** Removes the container; safe to call twice. */
  stop(): void;
}

/** Starts one session's container on its network (the trial network): the pinned image by digest, the three mounts, HOME empty. */
export function startReviewContainer(o: { image: ReviewImage; setup: SessionSetup; folder: string; network: string; docker?: string }): ReviewContainer {
  const docker = o.docker ?? "docker";
  const name = "dc-review-" + randomBytes(6).toString("hex");
  const env = trialEnv("agent", { PATH, HOME, LANG: "C.UTF-8", TERM: "dumb", ...o.setup.env });
  const keys = Object.keys(env).filter(isKeyName);
  if (keys.length) fail("E_DC_INFRA_MISSING", "the review container's env may hold no key variable: " + keys.join(", "));
  const binds: Array<[string, string]> = [[join(o.folder, "repo"), "/work/repo"], [join(o.folder, "plan.md"), "/work/plan.md"], [join(o.folder, "context"), "/work/context"]];
  if (JSON.stringify(binds.map((b) => b[1])) !== JSON.stringify(HARNESS.mounts.map(mountPath))) fail("E_DC_INFRA_MISSING", "the rig's mounts are not the frozen three");
  for (const [src] of binds) if (!existsSync(src)) fail("E_DC_INFRA_MISSING", "session folder is missing " + src);
  const started = spawnSync(docker, ["run", "-d", "--name", name, "--network", o.network, "--user", USER(), ...HARDENING, ...binds.flatMap(([s, d]) => ["--mount", "type=bind,src=" + s + ",dst=" + d]), "-w", "/work", ...dockerEnvArgs(env).args, "--entrypoint", "sleep", o.image.digest, "infinity"], { encoding: "utf8", timeout: 120_000, env: clientEnv() });
  if (started.status !== 0) fail("E_DC_INFRA_MISSING", "could not start the review container: " + String(started.stderr ?? started.error ?? "").trim().split("\n").slice(-1)[0]);
  let stopped = false;
  const run = (command: string, timeoutMs = 600_000): ExecResult => {
    const r = spawnSync(docker, ["exec", "-w", "/work", name, "sh", "-c", command], { encoding: "utf8", timeout: timeoutMs, maxBuffer: BUFFER, env: clientEnv() });
    return { code: r.status ?? 1, stdout: r.stdout ?? "", stderr: (r.stderr ?? "") + (r.error ? String(r.error.message) : "") };
  };
  const inspect = () => {
    const r = spawnSync(docker, ["inspect", "-f", "{{json .Image}}\t{{json .Config.User}}\t{{json .Mounts}}\t{{json .NetworkSettings.Networks}}\t{{range .Config.Env}}{{index (split . \"=\") 0}} {{end}}", name], { encoding: "utf8", env: clientEnv() });
    if (r.status !== 0) return fail("E_DC_INFRA_MISSING", "docker inspect " + name + " failed: " + String(r.stderr).trim());
    const [imageJson, userJson, mountsJson, networksJson, names = ""] = r.stdout.replace(/\n$/, "").split("\t");
    const [image, user, mounts, networks] = [imageJson, userJson, mountsJson, networksJson].map((x) => JSON.parse(x!));
    return {
      image,
      user,
      mounts: (mounts ?? []).map((m: { Type: string; Source: string; Destination: string }) => ({ type: m.Type, source: m.Source, destination: m.Destination })),
      networks: Object.keys(networks ?? {}).sort(),
      env: names.split(" ").filter(Boolean),
    };
  };
  const box = (): RunBox => ({
    runs(sinceMs) {
      const script = 'for r in /work "$HOME"; do find "$r" -maxdepth 11 \\( -name .git -o -name node_modules \\) -prune -o -type f -name run.json -printf "%T@\\t%p\\n"; done | while IFS="$(printf "\\t")" read -r t p; do printf "@@run %s %s\\n" "$t" "$p"; base64 -w0 "$p"; echo; done';
      const r = run(script, 120_000);
      if (r.code !== 0) return fail("E_DC_INFRA_MISSING", "the container's run listing exited " + r.code + ": " + r.stderr.trim().slice(0, 200));
      const lines = r.stdout.split("\n");
      const found: Array<{ dir: string; mtimeMs: number; text: string }> = [];
      for (let i = 0; i < lines.length; i++) {
        const m = /^@@run (\S+) (.+)\/run\.json$/.exec(lines[i]!);
        if (m) found.push({ dir: m[2]!, mtimeMs: Number(m[1]) * 1000, text: Buffer.from(lines[++i] ?? "", "base64").toString("utf8") });
      }
      return pickRuns(found, sinceMs);
    },
    read(path) {
      const r = spawnSync(docker, ["exec", name, "sh", "-c", '[ -f "$1" ] && base64 -w0 "$1"', "sh", path], { encoding: "utf8", maxBuffer: BUFFER, env: clientEnv() });
      return r.status === 0 ? Buffer.from(r.stdout ?? "", "base64").toString("utf8") : null;
    },
    gstack(bin, args) {
      const r = spawnSync(docker, ["exec", "-w", "/work", name, GSTACK_CHECKOUT + "/bin/" + bin, ...args], { encoding: "utf8", timeout: 120_000, maxBuffer: BUFFER, env: clientEnv() });
      return { code: r.status ?? 1, stdout: r.stdout ?? "", stderr: (r.stderr ?? "") + (r.error ? String(r.error.message) : "") };
    },
  });
  return {
    name,
    image: o.image,
    network: o.network,
    folder: o.folder,
    exec: (command) => run(command),
    run,
    listing() {
      const r = run(LISTING_SH, 300_000);
      if (r.code !== 0) return fail("E_DC_INFRA_MISSING", "the container listing exited " + r.code + ": " + r.stderr.trim().slice(0, 200));
      return [...new Set(r.stdout.split("\n").filter(Boolean))];
    },
    inspect,
    box,
    agent(driverEnv): AgentSession {
      const agentEnv = trialEnv("agent", { ...env, ...driverEnv });
      const args = (extra: Record<string, string>) => dockerEnvArgs({ ...agentEnv, ...extra });
      return {
        exec(command, timeoutMs): StepResult {
          const { args: e, clientEnv: secret } = args({});
          const r = spawnSync(docker, ["exec", "-w", "/work", ...e, name, "sh", "-c", command], { encoding: "utf8", timeout: timeoutMs, maxBuffer: BUFFER, env: { ...clientEnv(), ...secret } });
          const timedOut = (r.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT";
          return { exitCode: timedOut ? null : r.status, timedOut, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
        },
        spawn(argv, extra = {}) {
          const { args: e, clientEnv: secret } = args(extra);
          return spawn(docker, ["exec", "-i", "-w", "/work", ...e, name, ...argv], { env: { ...clientEnv(), ...secret }, stdio: ["pipe", "pipe", "pipe"] });
        },
        stop() {},
      };
    },
    stop() {
      if (!stopped) spawnSync(docker, ["rm", "-f", name], { stdio: "ignore", env: clientEnv() });
      stopped = true;
    },
  };
}

/**
 * C3 inside the container: containerProblems on the container's own listing, plus what docker reports: the pinned image
 * by digest, a non-root user, exactly the three frozen binds from the session folder, the session's network alone, and
 * no key variable name in the env. clean checks the empty HOME every arm starts with (before any install).
 */
export function c3Problems(c: ReviewContainer, setup: SessionSetup, o: { clean?: boolean } = {}): string[] {
  const as = o.clean ? { ...setup, container: { ...setup.container, gstack: null } } : setup;
  const problems = containerProblems(as, c.listing());
  const seen = c.inspect();
  if (seen.image !== c.image.digest) problems.push("the image is " + seen.image + ", not the pinned " + c.image.digest);
  if (!seen.user || /^(0|root)(:|$)/.test(seen.user)) problems.push("the container runs as root");
  const want = HARNESS.mounts.map((m) => "bind " + join(c.folder, mountPath(m).slice("/work/".length)) + " " + mountPath(m)).sort();
  const got = seen.mounts.map((m) => m.type + " " + m.source + " " + m.destination).sort();
  if (JSON.stringify(got) !== JSON.stringify(want)) problems.push("mounts are " + (got.join(", ") || "none") + ", not the three frozen binds");
  if (JSON.stringify(seen.networks) !== JSON.stringify([c.network])) problems.push("networks are " + (seen.networks.join(", ") || "none") + ", not " + c.network + " alone");
  const keys = seen.env.filter(isKeyName);
  if (keys.length) problems.push("key variables in the container env: " + keys.join(", "));
  return problems;
}

/** C2 inside the container, against its own mounts (the Docker exec behind contain.ts's seam). */
export const c2InContainer = (c: ReviewContainer, expect: C2Expect): Promise<string[]> => runC2(c.exec, "/work/repo", CONTAINER_MOUNTS, expect);

/** A plain bridge network for the gstack install's downloads; the session's container joins it only for the install. */
export function createInstallNetwork(docker = "docker"): string {
  const name = "dc-install-" + randomBytes(5).toString("hex");
  const r = spawnSync(docker, ["network", "create", name], { encoding: "utf8", env: clientEnv() });
  if (r.status !== 0) fail("E_DC_INFRA_MISSING", "could not create the install network: " + String(r.stderr).trim());
  return name;
}

export const removeNetwork = (name: string, docker = "docker"): void => void spawnSync(docker, ["network", "rm", name], { stdio: "ignore", env: clientEnv() });

export interface GstackInstall {
  code: number;
  log: string;
  git_tree: string;
  tree_sha256: string;
}

/**
 * gstack's install at the pin, in a gstack arm's container: the pinned commit's tree, verified against its git tree, is
 * copied to GSTACK_CHECKOUT, and the frozen install command runs there with the install network joined. The network
 * leaves before this returns, whatever the install did. sources are local repositories that hold the pinned commit.
 */
export function installGstack(c: ReviewContainer, o: { sources: readonly string[]; installNetwork: string; scratch: string; docker?: string; timeoutMs?: number }): GstackInstall {
  const docker = o.docker ?? "docker";
  const to = join(o.scratch, "gstack-" + randomBytes(4).toString("hex"));
  const tree = stackTree({ repo: GSTACK_PIN.repo, sha: GSTACK_PIN.commit }, o.sources, to);
  try {
    const mk = c.run('mkdir -p "$HOME/.claude/skills"', 60_000);
    if (mk.code !== 0) fail("E_DC_INFRA_MISSING", "gstack install: mkdir exited " + mk.code);
    const cp = spawnSync(docker, ["cp", "-q", to + "/.", c.name + ":" + GSTACK_CHECKOUT], { encoding: "utf8", env: clientEnv() });
    if (cp.status !== 0) fail("E_DC_INFRA_MISSING", "gstack install: docker cp exited " + cp.status + ": " + String(cp.stderr).trim());
    const joined = spawnSync(docker, ["network", "connect", o.installNetwork, c.name], { encoding: "utf8", env: clientEnv() });
    if (joined.status !== 0) fail("E_DC_INFRA_MISSING", "gstack install: could not join the install network: " + String(joined.stderr).trim());
    try {
      const r = c.run("cd " + GSTACK_CHECKOUT + " && " + GSTACK_PIN.install, o.timeoutMs ?? 1_800_000);
      return { code: r.code, log: r.stdout + r.stderr, git_tree: tree.git_tree, tree_sha256: tree.tree_sha256 };
    } finally {
      const left = spawnSync(docker, ["network", "disconnect", "-f", o.installNetwork, c.name], { encoding: "utf8", env: clientEnv() });
      if (left.status !== 0) fail("E_DC_INFRA_MISSING", "gstack install: could not leave the install network: " + String(left.stderr).trim());
    }
  } finally {
    rmSync(to, { recursive: true, force: true });
  }
}

export interface PreparedSession {
  container: ReviewContainer;
  /** C3 before any install (HOME empty in every arm), then C2 in the container. */
  c3: string[];
  c2: string[];
  /** The gstack arms only: the install, then C2 and C3 again. */
  install: GstackInstall | null;
  c2AfterInstall: string[] | null;
  c3AfterInstall: string[] | null;
}

/**
 * One session's container in the setup order: session folder, container, C3, C2, and in the gstack arms the install,
 * C2 and C3 again. The checks' problems come back for the caller's containPoint (re-export once, then drop or hold);
 * an install that exits non-zero is a problem after install. The caller stops the container.
 */
export async function prepareSession(o: { image: ReviewImage; setup: SessionSetup; unit: UnitFiles; expect: C2Expect; dir: string; network: string; install: { sources: readonly string[]; network: string; scratch: string } | null; docker?: string }): Promise<PreparedSession> {
  const gstack = o.setup.container.gstack !== null;
  if (gstack && !o.install) fail("E_DC_INFRA_MISSING", "a gstack arm's session needs its install sources and install network");
  const container = startReviewContainer({ image: o.image, setup: o.setup, folder: sessionFolder(o.unit, o.dir), network: o.network, docker: o.docker });
  try {
    const c3 = c3Problems(container, o.setup, { clean: true });
    const c2 = await c2InContainer(container, o.expect);
    if (!gstack || c3.length || c2.length) return { container, c3, c2, install: null, c2AfterInstall: null, c3AfterInstall: null };
    const install = installGstack(container, { ...o.install!, installNetwork: o.install!.network, docker: o.docker });
    const c2AfterInstall = await c2InContainer(container, o.expect);
    const c3AfterInstall = [...(install.code === 0 ? [] : ["the gstack install exited " + install.code]), ...c3Problems(container, o.setup)];
    return { container, c3, c2, install, c2AfterInstall, c3AfterInstall };
  } catch (e) {
    container.stop();
    throw e;
  }
}
