// Copyright (c) 2026 Garry Tan. MIT License.
// Part L's arm homes (plan sections 2 and 3; prereg.json parts.L and gstack.L). l-none is Claude Code as shipped, with an
// empty home. l-gstack installs gstack v1.102.1.0 the way the base install layer installs gstack (arms/recipes.ts
// gstackSteps, in the same throwaway container from the same install image), then seeds gstack's config with telemetry
// off through its own gstack-config, and writes prereg.json's parts.L.claude_md text as the home's CLAUDE.md. l-gstack-md
// is the same install with its own CLAUDE.md (one more line, the sentence); l-gstack-task runs on l-gstack's home, since
// its sentence goes in T. Every extension session's environment carries gstack_config.env (GSTACK_TELEMETRY_SOURCE=eval).
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homeRoots, homeTreeSha256 } from "../arms/hash.ts";
import { claudeVersion, ensureImage, prepareSources, type InstallRecord } from "../arms/install.ts";
import { ARM_HOME, logPath, recordPath } from "../arms/layer.ts";
import { gstackSteps, INSTALL_ENV, installScript, type Recipe, type Source } from "../arms/recipes.ts";
import { h2hFail } from "../prereg.ts";
import { EXT_ARMS, partOf, readExtPrereg, type ExtArm, type ExtPrereg } from "./prereg.ts";

type LArm = "l-none" | "l-gstack" | "l-gstack-md" | "l-gstack-task";
/** Part L arms that run on another arm's home. */
export const L_HOME_OF: Partial<Record<LArm, LArm>> = { "l-gstack-task": "l-gstack" };
export const lHomeArm = (arm: LArm): LArm => L_HOME_OF[arm] ?? arm;
const GSTACK_CONFIG = "$HOME/.claude/skills/gstack/bin/gstack-config";

/** A part L home's install: the base layer's Recipe shape (claude_md true when a CLAUDE.md is written) plus its text. */
export interface LRecipe { home: LArm; sources: Source[]; steps: string[]; claude_md: boolean; claude_md_text: string | null }

/** The steps that seed gstack's config with prereg.json's telemetry value, and check gstack reads it back. */
export function telemetrySteps(x: ExtPrereg = readExtPrereg()): string[] {
  const v = x.gstack_config.telemetry;
  if (!/^[a-z-]+$/.test(v)) h2hFail("E_H2HX_PREREG", "gstack_config.telemetry " + JSON.stringify(v) + " is not a gstack-config value");
  return [GSTACK_CONFIG + " set telemetry " + v, "test \"$(" + GSTACK_CONFIG + " get telemetry)\" = " + v];
}

/** The recipe for a part L arm's home (its home arm's for l-gstack-task). */
export function lRecipe(arm: LArm, x: ExtPrereg = readExtPrereg()): LRecipe {
  const home = lHomeArm(arm);
  if (home === "l-none") return { home, sources: [], steps: [], claude_md: false, claude_md_text: null };
  const g = x.gstack.L;
  if (!/^[0-9a-f]{40}$/.test(g.sha)) h2hFail("E_H2HX_PREREG", "gstack.L's sha " + g.sha + " is not a full commit id");
  const text = x.parts.L.claude_md[home] ?? h2hFail("E_H2HX_PREREG", "parts.L.claude_md has no text for " + home);
  return { home, sources: [{ name: "gstack", repo: g.repo, sha: g.sha, kind: "clone" }], steps: [...gstackSteps(g.sha), ...telemetrySteps(x)], claude_md: true, claude_md_text: text };
}

/** The environment every extension session adds to Claude Code's or Codex's own: prereg.json's gstack_config.env. */
export function extSessionEnv(arm: ExtArm, x: ExtPrereg = readExtPrereg()): Record<string, string> {
  if (!(EXT_ARMS as readonly string[]).includes(arm)) h2hFail("E_H2HX_INPUT", "arm " + arm + " is not an extension arm");
  return { ...x.gstack_config.env };
}

export type LInstallRecord = Omit<InstallRecord, "schema" | "home"> & { schema: "h2hx-arm-install.v1"; home: LArm; claude_md_text: string | null };

/** Installs a part L arm's home into an empty or missing directory, as arms/install.ts installHome does for the base arms:
 *  sources prepared on the host, the steps in the pinned install image with HOME the only writable mount, then the
 *  CLAUDE.md written on the host and the record and log beside the home. */
export function installLHome(arm: LArm, o: { home: string; sources: string; x?: ExtPrereg }): LInstallRecord {
  const x = o.x ?? readExtPrereg();
  if (partOf(arm) !== "L") h2hFail("E_H2HX_INPUT", "arm " + arm + " is not a part L arm");
  const r = lRecipe(arm, x);
  const home = resolve(o.home);
  if (existsSync(home) && readdirSync(home).length) h2hFail("E_H2H_INSTALL", home + " is not empty; an install writes a fresh home");
  mkdirSync(home, { recursive: true });
  const scratch = join(dirname(home), "." + r.home + "-src-" + randomBytes(4).toString("hex"));
  const started = new Date().toISOString();
  try {
    const image = ensureImage();
    const version = claudeVersion(image.tag);
    const { mounts, records } = prepareSources(r as unknown as Recipe, { sources: o.sources, scratch });
    let exit = 0, failure: string | null = null;
    if (r.steps.length) {
      const user = (process.getuid?.() ?? 1000) + ":" + (process.getgid?.() ?? 1000);
      const env = Object.entries(INSTALL_ENV).flatMap(([k, v]) => ["-e", k + "=" + v]);
      const name = "h2hx-install-" + r.home + "-" + randomBytes(4).toString("hex");
      const d = Bun.spawnSync(["docker", "run", "--rm", "--name", name, "--user", "0:0", "-v", home + ":" + ARM_HOME, ...mounts, "-w", ARM_HOME, ...env, "--entrypoint", "bash", image.tag, "-c", installScript(r as unknown as Recipe), "bash", user], { timeout: 3_600_000 });
      const out = d.stdout.toString() + d.stderr.toString();
      writeFileSync(logPath(home), out);
      exit = d.exitCode ?? -1;
      failure = exit === 0 ? null : out.trim().split("\n").slice(-12).join("\n") || "no output";
    } else writeFileSync(logPath(home), "");
    if (exit === 0 && r.claude_md_text !== null) {
      mkdirSync(join(home, ".claude"), { recursive: true });
      writeFileSync(join(home, ".claude", "CLAUDE.md"), r.claude_md_text);
    }
    const rec: LInstallRecord = {
      schema: "h2hx-arm-install.v1", home: r.home, image, claude_code_version: version, env: INSTALL_ENV, sources: records, steps: r.steps, claude_md: r.claude_md, claude_md_text: r.claude_md_text,
      started_at: started, ended_at: new Date().toISOString(), exit, failure, home_tree_sha256: exit === 0 ? homeTreeSha256(home) : null, roots: exit === 0 ? homeRoots(home) : [],
    };
    writeFileSync(recordPath(home), JSON.stringify(rec, null, 2) + "\n");
    if (exit !== 0) h2hFail("E_H2H_INSTALL", "the " + r.home + " install exited " + exit + " (log: " + logPath(home) + "): " + (failure ?? "").split("\n").slice(-3).join(" | "));
    return rec;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
