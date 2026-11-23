// Copyright (c) 2026 Garry Tan. MIT License.
// Plan section 3's pstack plugin, for P (and the blind probe) only: pstack's Claude Code tree at the pin prereg.json and
// src/arms/stacks.ts share, extracted and checked against its tree id by the stack arms' installer (install.ts
// stackTree), with stacks.ts's own install command (pstack's bootstrap) run in the builder container, where egress is
// open. The result is a Docker volume mounted read-only at /opt/pf-pstack and loaded as a Claude Code plugin directory
// (--plugin-dir) in P's session and P's scoring runs. Nothing from pstack is vendored.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stackTree } from "../../../src/arms/install.ts";
import { STACKS } from "../../../src/arms/stacks.ts";
import { pfFail } from "./prereg.ts";
import { TOOLS_PINS } from "./tools.ts";

const PREREG = join(import.meta.dir, "../../../wiki/plans/2026-11-09-geva-487-pstack-checks-prereg/prereg.json");
export const PSTACK_PIN = (JSON.parse(readFileSync(PREREG, "utf8")) as { pins: { pstack: { repo: string; commit: string; tree: string; tree_sha: string; plugin_version: string } } }).pins.pstack;
export const PSTACK = STACKS.find((s) => s.name === "pstack")!;
export const PSTACK_DIR = "/opt/pf-pstack";
export const PLUGIN_ARGS = ["--plugin-dir", PSTACK_DIR] as const;

/** The pin in prereg.json must be the stack arms' pin. */
export function checkPin(): void {
  if (PSTACK.repo !== PSTACK_PIN.repo || PSTACK.path !== PSTACK_PIN.tree || PSTACK.pin.sha !== PSTACK_PIN.commit || PSTACK.pin.git_tree !== PSTACK_PIN.tree_sha) pfFail("E_PF_PLUGIN", "prereg.json's pstack pin is not src/arms/stacks.ts's pin");
}
export const pstackVolume = (): string => "pf-pstack-" + PSTACK_PIN.tree_sha.slice(0, 12);
export const pstackMount = (): string => "type=volume,src=" + pstackVolume() + ",dst=" + PSTACK_DIR + ",readonly";

/** Builds the plugin volume from a local clone of cursor/plugins (sources), or reuses it when its .pf-pin matches. */
export function buildPstackVolume(sources: string[]): { volume: string; mount: string; git_tree: string; tree_sha256: string | null; reused: boolean } {
  checkPin();
  const volume = pstackVolume();
  const bun = TOOLS_PINS.bun.image.split(":")[0] + "@" + TOOLS_PINS.bun.digest;
  const pinText = PSTACK_PIN.commit + " " + PSTACK_PIN.tree_sha;
  const have = spawnSync("docker", ["run", "--rm", "--network", "none", "-v", volume + ":/p:ro", "--entrypoint", "cat", bun, "/p/.pf-pin"], { encoding: "utf8" });
  if (have.status === 0 && have.stdout.trim() === pinText) return { volume, mount: pstackMount(), git_tree: PSTACK_PIN.tree_sha, tree_sha256: null, reused: true };
  const tmp = mkdtempSync(join(tmpdir(), "pf-pstack-"));
  try {
    const t = stackTree({ repo: PSTACK.repo, sha: PSTACK.pin.sha, path: PSTACK.path } as Parameters<typeof stackTree>[0], sources, join(tmp, "tree"));
    if (t.git_tree !== PSTACK_PIN.tree_sha) pfFail("E_PF_PLUGIN", "the extracted pstack tree is " + t.git_tree + ", not " + PSTACK_PIN.tree_sha);
    spawnSync("docker", ["volume", "rm", "-f", volume]);
    spawnSync("docker", ["volume", "create", volume]);
    const script = "set -e; cp -a /in/. /p/; cd /p; " + PSTACK.install.claude + "; printf '%s\\n' \"$0\" > /p/.pf-pin; chmod -R a+rX /p";
    const r = spawnSync("docker", ["run", "--rm", "-v", join(tmp, "tree") + ":/in:ro", "-v", volume + ":/p", "--entrypoint", "sh", bun, "-c", script, pinText], { encoding: "utf8", timeout: 900_000 });
    if (r.status !== 0) pfFail("E_PF_PLUGIN", "pstack's installer failed in the builder: " + (r.stderr || r.stdout).trim().slice(-400));
    return { volume, mount: pstackMount(), git_tree: t.git_tree, tree_sha256: t.tree_sha256, reused: false };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
