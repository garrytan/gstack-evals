// Copyright (c) 2026 Garry Tan. MIT License.
// Part S's Codex installs (wiki/plans/2026-11-21-geva-568-skill-pack-h2h-sol-particle-prereg sections 2 and 3): one
// recipe per s-* arm, each the pack's Codex install at its pin, run the way the base installs run (arms/install.ts): a
// throwaway container from the pinned install image with network, whose only writable mount is the session HOME, with the
// pinned Codex binary (ext/runtimes.ts codexFiles) mounted read-only and linked as codex inside the install container
// only. Sources are prepared on the host by the base layer (a local clone at the pin, or the pin's tree checked against its
// git tree id). The two marketplace deviations keep the bytes at the pins: Superpowers and agent-skills are added from
// their pinned trees as local Codex marketplaces under ~/.codex/plugin-sources. gstack's ./setup --host codex reads the
// top-level model in config.toml to pick its model profile, so the line naming part S's model is seeded before setup and
// removed after; ~/.gstack/config.yaml carries prereg.json's gstack_config. s-gstack-line's AGENTS.md is written on the
// host after the install, with prereg.json's bytes and digest. The record keeps the sources, image, Codex digest, tree
// hash under the base rule plus CODEX_HASH_SKIP, and the roots.
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { h2hFail, readPrereg, type H2hPrereg } from "../prereg.ts";
import type { H2hArm } from "../types.ts";
import { globRe, homeEntries, homeRoots, treeSha256, type HomeEntry } from "../arms/hash.ts";
import { containHome, type FrameUnit, type HomeContain } from "../arms/contain.ts";
import { ensureImage, prepareSources, type SourceRecord } from "../arms/install.ts";
import type { Where } from "../../statemachines/history.ts";
import { ARM_HOME, logPath, recordPath } from "../arms/layer.ts";
import { INSTALL_ENV, installScript, SRC_DIR, type Recipe, type Source } from "../arms/recipes.ts";
import { readExtPrereg, S_ARMS, type ExtPrereg } from "./prereg.ts";
import { codexFiles, codexPin } from "./runtimes.ts";

type SArm = (typeof S_ARMS)[number];
const sha = (b: string | Buffer) => createHash("sha256").update(b).digest("hex");
const fail = (why: string): never => h2hFail("E_H2HX_CODEX_INSTALL", why);
const run = (args: string[], timeout = 3_600_000) => spawnSync("docker", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, timeout });

/** Where the install container mounts the pinned Codex binary dir, read-only. */
export const CODEX_MOUNT = "/opt/h2h-codex";
/** Where a local Codex marketplace tree lands, relative to HOME; Codex reads a local marketplace in place. */
export const CODEX_MARKETPLACES = ".codex/plugin-sources";
/** What a Codex home's tree hash leaves out on top of the base rule (arms/hash.ts HASH_RULE), found by installing every
 *  s-* home twice on 2026-11-21 (the base rule's method). json: GSD's install state and manifest for Codex, with the
 *  keys the base rule drops from their Claude Code copies. skip: Codex's per-run arg0 links dir, gstack's timestamped
 *  hooks.json backups and the pointer to the newest one, the pack file of gstack's one-commit fetch (its bytes vary run to
 *  run; the checkout and HEAD are hashed), and gstack's cso build log. text: GSD's per-install heredoc nonce in the
 *  workflows and skills it writes for Codex. */
export const CODEX_HASH_RULE = {
  skip: [".codex/tmp/**", ".codex/hooks.json.bak*", "gstack/.git/objects/pack/**", "gstack/bin/.gstack-cso-build.log"],
  json: [
    { glob: ".codex/gsd-install-state.json", drop: ["appliedAt"] },
    { glob: ".codex/gsd-file-manifest.json", drop: ["timestamp", "files"] },
  ],
  text: [{ globs: [".codex/**", ".agents/**"], pattern: "(GSD_[A-Z_]*ARGS_END)_[0-9a-f]{32}", replace: "$1_NONCE" }],
};
const dropKeys = (v: unknown, drop: Set<string>): unknown => {
  if (Array.isArray(v)) return v.map((x) => dropKeys(x, drop));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).filter(([k]) => !drop.has(k)).map(([k, x]) => [k, dropKeys(x, drop)]));
  return v;
};

/** gstack's README install for Codex: the clone into ~/gstack (fetched from the local clone at the pin, origin set to
 *  GitHub as the README's clone leaves it), then ./setup --host codex with part S's model seeded in config.toml. */
export function codexGstackSteps(gsha: string, model: string, telemetry: string): string[] {
  const g = "$HOME/gstack";
  const line = "model = " + JSON.stringify(model);
  return [
    "git init -q -b main " + g,
    "git -C " + g + " remote add -t main origin https://github.com/garrytan/gstack.git",
    "git -C " + g + " fetch -q --depth 1 file://" + SRC_DIR + "/gstack " + gsha,
    "git -C " + g + " update-ref refs/remotes/origin/main " + gsha,
    "git -C " + g + " reset -q --hard " + gsha,
    "git -C " + g + " branch -q --set-upstream-to=origin/main main",
    "rm -f " + g + "/.git/FETCH_HEAD",
    "test \"$(git -C " + g + " rev-parse HEAD)\" = " + gsha,
    "mkdir -p $HOME/.codex $HOME/.gstack",
    "printf '%s\\n' 'telemetry: " + telemetry + "' > $HOME/.gstack/config.yaml",
    "printf '%s\\n' '" + line + "' > $HOME/.codex/config.toml",
    "(cd " + g + " && ./setup --host codex)",
    "grep -qxF '" + line + "' $HOME/.codex/config.toml",
    "sed -i '\\#^" + line.replace(/[.\\]/g, "\\$&") + "$#d' $HOME/.codex/config.toml",
    "[ -s $HOME/.codex/config.toml ] || rm -f $HOME/.codex/config.toml",
    "test ! -e $HOME/.codex/AGENTS.md",
  ];
}

/** A pinned tree copied under HOME as a local Codex marketplace, then its plugin added from it. */
export function codexMarketplaceSteps(src: string, plugin: string, marketplace: string): string[] {
  const dir = "$HOME/" + CODEX_MARKETPLACES + "/" + src;
  return ["mkdir -p $HOME/" + CODEX_MARKETPLACES, "cp -a --no-preserve=ownership " + SRC_DIR + "/" + src + " " + dir, "codex plugin marketplace add " + dir, "codex plugin add " + plugin + "@" + marketplace];
}

/** Superpowers' marketplace lists its plugin at the URL "./", which Codex git-clones, so the local marketplace is a git
 *  checkout at the pin, fetched from the local clone, rather than a bare tree. */
export function codexGitMarketplaceSteps(src: string, sha: string, plugin: string, marketplace: string): string[] {
  const dir = "$HOME/" + CODEX_MARKETPLACES + "/" + src;
  return ["mkdir -p $HOME/" + CODEX_MARKETPLACES, "git init -q " + dir, "git -C " + dir + " fetch -q --depth 1 file://" + SRC_DIR + "/" + src + " " + sha, "git -C " + dir + " reset -q --hard " + sha, "rm -f " + dir + "/.git/FETCH_HEAD", "test \"$(git -C " + dir + " rev-parse HEAD)\" = " + sha, "codex plugin marketplace add " + dir, "codex plugin add " + plugin + "@" + marketplace];
}

/** The recipe for an s-* arm's Codex home, at the base post's pins (gstack at part S's). s-gstack-line installs s-gstack's and adds its AGENTS.md afterwards. */
export function codexRecipe(arm: SArm, x: ExtPrereg = readExtPrereg(), p: H2hPrereg = readPrereg()): Recipe & { arm: SArm; agents_md: string | null } {
  const pin = (k: string) => p.pins[k] ?? fail("the base prereg.json has no pin " + k);
  const out = (sources: Source[], steps: string[], agents_md: string | null = null) => ({ home: arm as unknown as H2hArm, arm, sources, steps, claude_md: false, agents_md });
  const link = "ln -sf " + CODEX_MOUNT + "/codex /usr/local/bin/codex";
  switch (arm) {
    case "s-none":
      return out([], []);
    case "s-gstack":
    case "s-gstack-line": {
      const g = x.gstack.S;
      const steps = [link, ...codexGstackSteps(g.sha, x.parts.S.model, x.gstack_config.telemetry)];
      return out([{ name: "gstack", repo: g.repo, sha: g.sha, kind: "clone" }], steps, arm === "s-gstack-line" ? (x.parts.S.agents_md["s-gstack-line"] ?? fail("prereg.json parts.S.agents_md has no s-gstack-line text")) : null);
    }
    case "s-superpowers": {
      const s = pin("superpowers");
      return out([{ name: "superpowers", repo: s.repo, sha: s.sha, kind: "clone" }], [link, ...codexGitMarketplaceSteps("superpowers", s.sha, "superpowers", "superpowers-dev")]);
    }
    case "s-agent-skills": {
      const a = pin("agent-skills");
      return out([{ name: "agent-skills", repo: a.repo, sha: a.sha, kind: "tree" }], [link, ...codexMarketplaceSteps("agent-skills", "agent-skills", "agent-skills")]);
    }
    case "s-gsd": {
      const g = pin("gsd");
      return out([], [link, "npx -y " + (g.npm ?? fail("the gsd pin names no npm package")) + " --codex --global"]);
    }
    case "s-tstack": {
      const t = pin("tstack");
      return out([{ name: "tstack", repo: t.repo, sha: t.sha, kind: "tree" }], ["mkdir -p $HOME/.codex/skills", "cp -R " + SRC_DIR + "/tstack/skills/* $HOME/.codex/skills/"]);
    }
  }
}

/** A Codex home's entries: the base rule's, without CODEX_HASH_RULE's skipped paths, with its json rules and then its
 *  text rules applied to regular files they match. */
export function codexHomeEntries(dir: string): HomeEntry[] {
  const skip = CODEX_HASH_RULE.skip.map(globRe);
  const json = CODEX_HASH_RULE.json.map((j) => ({ re: globRe(j.glob), drop: new Set(j.drop) }));
  const text = CODEX_HASH_RULE.text.map((t) => ({ res: t.globs.map(globRe), pattern: new RegExp(t.pattern, "gm"), replace: t.replace }));
  return homeEntries(dir).filter((e) => !skip.some((re) => re.test(e.path))).map((e) => {
    const j = e.mode === "120000" ? undefined : json.find((x) => x.re.test(e.path));
    if (j) return { ...e, sha256: sha(JSON.stringify(dropKeys(JSON.parse(readFileSync(join(dir, e.path), "utf8")), j.drop))) };
    const t = e.mode === "120000" ? [] : text.filter((x) => x.res.some((re) => re.test(e.path)));
    if (!t.length) return e;
    const body = readFileSync(join(dir, e.path)).toString("latin1");
    const out = t.reduce((s, x) => s.replace(x.pattern, x.replace), body);
    return out === body ? e : { ...e, sha256: sha(Buffer.from(out, "latin1")) };
  });
}
export const codexHomeTreeSha256 = (dir: string): string => treeSha256(codexHomeEntries(dir));

/** The Codex install record (h2hx-codex-install.v1) beside each home. */
export interface CodexInstallRecord {
  schema: "h2hx-codex-install.v1";
  arm: SArm;
  image: { tag: string; id: string; dockerfile_sha256: string };
  codex: { version: string; codex_sha256: string };
  env: Record<string, string>;
  sources: SourceRecord[];
  steps: string[];
  agents_md_sha256: string | null;
  started_at: string;
  ended_at: string;
  exit: number;
  failure: string | null;
  home_tree_sha256: string | null;
  roots: string[];
}

/** Installs an s-* arm's Codex home into home, an empty or missing directory. Refuses (E_H2HX_CODEX_INSTALL) a non-empty
 *  home; a failed install keeps its record and log and refuses with the step's exit. */
export async function installCodexHome(arm: SArm, o: { home: string; sources: string; cache?: string }, x: ExtPrereg = readExtPrereg()): Promise<CodexInstallRecord> {
  const r = codexRecipe(arm, x);
  const home = resolve(o.home);
  if (existsSync(home) && readdirSync(home).length) fail(home + " is not empty; an install writes a fresh home");
  mkdirSync(home, { recursive: true });
  const scratch = join(dirname(home), "." + arm + "-src-" + randomBytes(4).toString("hex"));
  const started = new Date().toISOString();
  try {
    const image = ensureImage();
    const files = await codexFiles(o.cache, x);
    const { mounts, records } = prepareSources(r, { sources: o.sources, scratch });
    const user = (process.getuid?.() ?? 1000) + ":" + (process.getgid?.() ?? 1000);
    const env = Object.entries(INSTALL_ENV).flatMap(([k, v]) => ["-e", k + "=" + v]);
    const d = run(["run", "--rm", "--name", "h2hx-install-" + arm + "-" + randomBytes(4).toString("hex"), "--user", "0:0", "-v", home + ":" + ARM_HOME, "-v", files.dir + ":" + CODEX_MOUNT + ":ro", ...mounts, "-w", ARM_HOME, ...env, "--entrypoint", "bash", image.tag, "-c", installScript(r), "bash", user]);
    writeFileSync(logPath(home), (d.stdout ?? "") + (d.stderr ?? "") + (d.error ? "\n" + d.error.message : ""));
    const exit = d.status ?? -1;
    const failure = exit === 0 ? null : (((d.stdout ?? "") + (d.stderr ?? "")).trim().split("\n").slice(-12).join("\n") || String(d.error?.message ?? "no output"));
    let agents: string | null = null;
    if (exit === 0 && r.agents_md !== null) {
      agents = sha(r.agents_md);
      if (agents !== x.parts.S.agents_md_sha256) fail("prereg.json's s-gstack-line AGENTS.md text has sha256 " + agents + ", not its recorded " + x.parts.S.agents_md_sha256);
      writeFileSync(join(home, ".codex", "AGENTS.md"), r.agents_md);
    }
    const rec: CodexInstallRecord = {
      schema: "h2hx-codex-install.v1", arm, image, codex: { version: codexPin(x).version, codex_sha256: files.codex_sha256 }, env: INSTALL_ENV, sources: records, steps: r.steps, agents_md_sha256: agents,
      started_at: started, ended_at: new Date().toISOString(), exit, failure, home_tree_sha256: exit === 0 ? codexHomeTreeSha256(home) : null, roots: exit === 0 ? homeRoots(home) : [],
    };
    writeFileSync(recordPath(home), JSON.stringify(rec, null, 2) + "\n");
    if (exit !== 0) fail("the " + arm + " install exited " + exit + " (log: " + logPath(home) + "): " + (failure ?? "").split("\n").slice(-3).join(" | "));
    return rec;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** Reads a Codex home's install record. */
export function readCodexRecord(home: string): CodexInstallRecord {
  const f = recordPath(resolve(home));
  if (!existsSync(f)) fail(f + " does not exist; run the Codex install for this home first");
  const j = JSON.parse(readFileSync(f, "utf8")) as CodexInstallRecord;
  if (j.schema !== "h2hx-codex-install.v1") fail(f + " is not an h2hx-codex-install.v1 record");
  return j;
}

/** Where part S's installed-home pins live: each s-* arm's tree hash, roots, sources, install image and Codex digest. */
export const CODEX_PINS_PATH = join(import.meta.dir, "codex-pins.json");
export interface CodexPin { arm: SArm; home_tree_sha256: string; roots: string[]; sources: SourceRecord[]; image_dockerfile_sha256: string; codex_sha256: string; agents_md_sha256: string | null }
export interface CodexPins { schema: "h2hx-codex-pins.v1"; installed_on: string; hash_rule: typeof CODEX_HASH_RULE; arms: CodexPin[] }

/** The pins file from one homes root holding a home per s-* arm (homes/<arm>), each re-hashed under today's rule. */
export function buildCodexPins(homes: string, installedOn: string): CodexPins {
  const arms = S_ARMS.map((arm): CodexPin => {
    const dir = join(homes, arm);
    const rec = readCodexRecord(dir);
    if (rec.exit !== 0) fail(dir + " is a failed install (exit " + rec.exit + ")");
    return { arm, home_tree_sha256: codexHomeTreeSha256(dir), roots: homeRoots(dir), sources: rec.sources, image_dockerfile_sha256: rec.image.dockerfile_sha256, codex_sha256: rec.codex.codex_sha256, agents_md_sha256: rec.agents_md_sha256 };
  });
  return { schema: "h2hx-codex-pins.v1", installed_on: installedOn, hash_rule: CODEX_HASH_RULE, arms };
}

/** One arm's pin from the pins file. */
export function readCodexPin(arm: SArm, path = CODEX_PINS_PATH): CodexPin {
  if (!existsSync(path)) fail(path + " does not exist; install part S's homes and write their pins first");
  const j = JSON.parse(readFileSync(path, "utf8")) as CodexPins;
  if (j.schema !== "h2hx-codex-pins.v1") fail(path + " is not an h2hx-codex-pins.v1 file");
  return j.arms.find((a) => a.arm === arm) ?? fail(path + " has no pin for " + arm);
}

/** Refuses (E_H2HX_CODEX_INSTALL) a Codex home whose tree hash is not its arm's pin. */
export function checkCodexHome(dir: string, arm: SArm, path = CODEX_PINS_PATH): void {
  if (!existsSync(dir)) fail(dir + " does not exist; install the " + arm + " home first");
  const want = readCodexPin(arm, path).home_tree_sha256;
  const got = codexHomeTreeSha256(dir);
  if (got !== want) fail(dir + " hashes to " + got + ", not " + arm + "'s pinned " + want);
}

/** The base containment (arms/contain.ts) over a Codex home, with the arm's own name and the Codex tree hash. */
export function containCodexHome(o: { arm: SArm; home: string; unitDir: string; where: Where; frame?: readonly FrameUnit[] }): Omit<HomeContain, "arm" | "home"> & { arm: SArm; home: SArm } {
  const r = containHome({ ...o, arm: o.arm as unknown as H2hArm });
  return { ...r, arm: o.arm, home: o.arm, home_tree_sha256: codexHomeTreeSha256(o.home) };
}
