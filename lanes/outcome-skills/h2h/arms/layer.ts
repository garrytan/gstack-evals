// Copyright (c) 2026 Garry Tan. MIT License.
// The arm layer contract (PART-A.md, top) that part S codes against: how a session container gets an arm's HOME. An
// arm's home is a host directory that install.ts filled with HOME set to /root, so every link, path in a JSON file and
// compiled binary names /root. A session copies it into its image's /root as one layer, the way the state machines
// session image copies A3's home (statemachines/image.ts SESSION_HOME and buildSessionImage), owned by root, after
// checking its tree hash against arms-pins.json. A read-only Docker volume holding the same bytes carries it between hosts.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { h2hFail } from "../prereg.ts";
import type { ArmInstall, H2hArm } from "../types.ts";
import { homeTreeSha256 } from "./hash.ts";

/** HOME in every session container, as in the state machines and pstack-checks rigs. Sessions run as root. */
export const ARM_HOME = "/root";

/** The arms that run on another arm's home (plan section 2: piece G's one-line control and the /qa secondary arm). */
export const HOME_OF: Partial<Record<H2hArm, H2hArm>> = { "gstack-oneline": "gstack", "gstack-qa": "gstack" };
/** The arm whose installed home this arm's sessions use. */
export const homeArm = (arm: H2hArm): H2hArm => HOME_OF[arm] ?? arm;

/** The host directory of an arm's home under a homes root (one directory per home arm). */
export const homeDir = (homes: string, arm: H2hArm): string => join(homes, homeArm(arm));
/** The install record install.ts writes beside a home. */
export const recordPath = (dir: string): string => dir + ".install.json";
/** The install log install.ts writes beside a home. */
export const logPath = (dir: string): string => dir + ".install.log";

/** The read-only volume name for a home: its home arm and the first 12 hex of its home_tree_sha256. */
export const homeVolume = (arm: H2hArm, treeSha256: string): string => "h2h-home-" + homeArm(arm) + "-" + treeSha256.slice(0, 12);
/** The volume's mount point in a build container; the session image build copies from it into ARM_HOME. */
export const HOME_VOLUME_MOUNT = "/h2h-home";
/** The session image build's copy step, run as root: the home's bytes, owned by root, as a root install's home is. */
export const HOME_COPY = "cp -a --no-preserve=ownership " + HOME_VOLUME_MOUNT + "/. " + ARM_HOME + "/";

/** What each arm's home needs on the session container's PATH to run as its pack documents (README requirements). The
 *  home carries none of these; PART-A.md says how this build reads it. */
export const RUNTIME_NEEDS: Record<H2hArm, string[]> = {
  none: [],
  gstack: ["bun >= 1.4.2 (gstack's bin/ scripts and skill preambles)", "git"],
  superpowers: ["bash (its SessionStart hook)"],
  "agent-skills": ["node and npx (chrome-devtools-mcp, B1 units only)"],
  gsd: ["node >= 18 (its hooks and gsd-tools)"],
  pstack: [],
  tstack: ["python3 (pr-wait)", "gh (its pull-request steps)"],
  "gstack-pony": ["bun >= 1.4.2", "git", "bash (ponystack's hook)"],
  "gstack-oneline": ["bun >= 1.4.2", "git"],
  "gstack-qa": ["bun >= 1.4.2", "git"],
};

/** Refuses (E_H2H_HOME_DRIFT) a home whose tree hash is not the one arms-pins.json records for the arm. */
export function checkHome(dir: string, rec: Pick<ArmInstall, "arm" | "home_tree_sha256">): void {
  if (!existsSync(dir)) h2hFail("E_H2H_HOME_DRIFT", dir + " does not exist; install the home of " + homeArm(rec.arm) + " first");
  const got = homeTreeSha256(dir);
  if (got !== rec.home_tree_sha256) h2hFail("E_H2H_HOME_DRIFT", dir + " hashes to " + got + ", not arms-pins.json's " + rec.home_tree_sha256 + " for " + rec.arm);
}

/** Loads a checked home into its read-only volume (created fresh) and returns the volume name. image: any image with sh
 *  and cp (the install image serves). */
export function loadHomeVolume(dir: string, rec: Pick<ArmInstall, "arm" | "home_tree_sha256">, image: string): string {
  checkHome(dir, rec);
  const volume = homeVolume(rec.arm, rec.home_tree_sha256);
  spawnSync("docker", ["volume", "rm", "-f", volume], { encoding: "utf8" });
  spawnSync("docker", ["volume", "create", volume], { encoding: "utf8" });
  const r = spawnSync("docker", ["run", "--rm", "--network", "none", "--user", "0:0", "-v", dir + ":/in:ro", "-v", volume + ":" + HOME_VOLUME_MOUNT, "--entrypoint", "sh", image, "-c", "cp -a --no-preserve=ownership /in/. " + HOME_VOLUME_MOUNT + "/"], { encoding: "utf8", timeout: 1_800_000 });
  if (r.status !== 0) h2hFail("E_H2H_INSTALL", "loading " + dir + " into volume " + volume + " failed: " + (r.stderr || r.stdout).trim().slice(-300));
  return volume;
}
