// Copyright (c) 2026 Garry Tan. MIT License.
// Part A's install recipes (plan sections 2 and 3): one per arm in types.ts ALL_ARMS, each the pack's README install at
// its prereg.json pin, which install.ts runs in a throwaway container with network whose only writable mount is the
// session HOME. Pure: the install image, the pins this build read on the freeze date for what prereg.json leaves to the
// build, each home's sources and shell steps, the agent-skills marketplace rewrite and the gstack CLAUDE.md append.
import { isDeepStrictEqual } from "node:util";
import { h2hFail, type H2hPrereg } from "../prereg.ts";
import { BROWSER, type H2hArm } from "../types.ts";
import { HOME_OF } from "./layer.ts";

/** Where install.ts mounts each source, read-only, in the install container. */
export const SRC_DIR = "/h2h-src";
/** Where a local marketplace tree lands, relative to HOME: Claude Code reads a directory marketplace in place, so the tree
 *  must outlive the install container. */
export const LOCAL_MARKETPLACES = ".claude/plugin-sources";

/** The one install image every arm uses: Node and npm for npx and the Claude Code CLI, Bun for gstack's setup, and
 *  Playwright's Chromium OS libraries so gstack's setup can launch the browser it installs. Every base by digest. */
export const INSTALL_IMAGE = {
  base: "node:24-bookworm@sha256:9d266751ca3d7fdbe651c878ffd5ad0a42fed49a18c283509267c97f025b7496",
  bun: "oven/bun:1.4.4@sha256:1d22548f177f4ff38e0c15baa3c2c46c6c2060ba2d1bc573bb4720b407548f1d",
  claude_code: "2.1.325",
  playwright_deps: "1.65.0",
} as const;

/** Pins this build read on the freeze date for what prereg.json leaves to the build. They never move. */
export const BUILD_PINS = {
  freeze_date: "2026-11-15",
  official_marketplace: { repo: "anthropics/claude-plugins-official", sha: "b5b01ac4f889fec0c4c6bb89f27ca7c8574473f6" },
  chrome_devtools_mcp: { npm: "chrome-devtools-mcp", version: "1.13.0", integrity: "sha512-Yf4qhS0+2oo7c+gOySMDHQt4ZL/yKXG2Mxxzjk0gcArINtcQ3tLiQVzAW6g2nsyQzAGhkcLwWWBAtlx3Bg+Spg==" },
  claude_code: { npm: "@anthropic-ai/claude-code", version: "2.1.325", integrity: "sha512-OUxCb0sx734zJh9zGTP9oF01gZ44DCGFaw7hgD4byepjRRGyvHzgUOwC7dlCgVIljV6CiEVDjq+anY3GUvKFQw==" },
} as const;

/** The install image's Dockerfile. */
export function installDockerfile(): string {
  return [
    "FROM " + INSTALL_IMAGE.base,
    "COPY --from=" + INSTALL_IMAGE.bun + " /usr/local/bin/bun /usr/local/bin/bun",
    "RUN ln -s bun /usr/local/bin/bunx \\",
    " && npm install -g @anthropic-ai/claude-code@" + INSTALL_IMAGE.claude_code + " \\",
    " && npx -y playwright@" + INSTALL_IMAGE.playwright_deps + " install-deps chromium \\",
    " && rm -rf /var/lib/apt/lists/* /root/.npm /root/.cache \\",
    " && claude --version && bun --version",
    "",
  ].join("\n");
}

/** The install container's whole environment: no key, no host variable, nothing else. */
export const INSTALL_ENV: Record<string, string> = {
  HOME: "/root", USER: "root", PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", LANG: "C.UTF-8", TERM: "dumb",
  DISABLE_AUTOUPDATER: "1", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
};

/** A pinned source install.ts prepares on the host: a local clone the container fetches the pin from (clone), or the
 *  pin's tree extracted and checked against its git tree id (tree), with agent-skills' one rewrite applied (rewrite). */
export interface Source { name: string; repo: string; sha: string; kind: "clone" | "tree"; rewrite?: boolean }
/** One home's install: the sources it mounts, the shell steps run in order under set -euo pipefail with HOME=/root, and
 *  whether prereg.json's gstack CLAUDE.md section is appended afterwards. */
export interface Recipe { home: H2hArm; sources: Source[]; steps: string[]; claude_md: boolean }

const GSTACK_REMOTE = "https://github.com/garrytan/gstack.git";

/** gstack's README clone (--single-branch --depth 1 into ~/.claude/skills/gstack), fetched from the local clone at the
 *  pin, with origin set to GitHub as the README's clone leaves it, then ./setup. */
export function gstackSteps(sha: string): string[] {
  const g = "$HOME/.claude/skills/gstack";
  return [
    "mkdir -p $HOME/.claude/skills",
    "git init -q -b main " + g,
    "git -C " + g + " remote add -t main origin " + GSTACK_REMOTE,
    "git -C " + g + " fetch -q --depth 1 file://" + SRC_DIR + "/gstack " + sha,
    "git -C " + g + " update-ref refs/remotes/origin/main " + sha,
    "git -C " + g + " reset -q --hard " + sha,
    "git -C " + g + " branch -q --set-upstream-to=origin/main main",
    "rm -f " + g + "/.git/FETCH_HEAD",
    "test \"$(git -C " + g + " rev-parse HEAD)\" = " + sha,
    "(cd " + g + " && ./setup)",
  ];
}

/** A marketplace added from its pinned tree, copied under HOME, then the plugin installed from it. */
export function localMarketplaceSteps(src: string, plugin: string, marketplace: string): string[] {
  const dir = "$HOME/" + LOCAL_MARKETPLACES + "/" + src;
  return ["mkdir -p $HOME/" + LOCAL_MARKETPLACES, "cp -a --no-preserve=ownership " + SRC_DIR + "/" + src + " " + dir, "claude plugin marketplace add " + dir, "claude plugin install " + plugin + "@" + marketplace];
}

/** Superpowers from the official marketplace. Claude Code 2.1.325 accepts the reserved name claude-plugins-official only
 *  from GitHub's anthropics organization at a branch or tag, so the marketplace is added from GitHub and its clone is
 *  then moved to the commit read on the freeze date before the install (PART-A.md, gap 1). */
export function superpowersSteps(): string[] {
  const m = "$HOME/.claude/plugins/marketplaces/claude-plugins-official";
  const pin = BUILD_PINS.official_marketplace.sha;
  return [
    "claude plugin marketplace add " + BUILD_PINS.official_marketplace.repo,
    "git -C " + m + " fetch -q --depth 1 origin " + pin,
    "git -C " + m + " reset -q --hard " + pin,
    "rm -f " + m + "/.git/FETCH_HEAD",
    "test \"$(git -C " + m + " rev-parse HEAD)\" = " + pin,
    "claude plugin install superpowers@claude-plugins-official",
  ];
}

/** chrome-devtools-mcp registered at user scope under the name and launcher its browser-testing skill gives, at the
 *  pinned version instead of @latest, headless and pointed at the shared Chromium wrapper; one run warms npx's cache so
 *  the offline session finds the package. */
export function devtoolsSteps(): string[] {
  const spec = BUILD_PINS.chrome_devtools_mcp.npm + "@" + BUILD_PINS.chrome_devtools_mcp.version;
  return ["claude mcp add --scope user chrome-devtools -- npx -y " + spec + " --isolated --headless --executablePath " + BROWSER.wrapper_container_path, "npx -y " + spec + " --version"];
}

/** The recipe for an arm's home. gstack-oneline and gstack-qa have gstack's (HOME_OF). */
export function recipe(arm: H2hArm, p: H2hPrereg): Recipe {
  const home = HOME_OF[arm] ?? arm;
  const pin = (k: string) => p.pins[k] ?? h2hFail("E_H2H_PREREG", "prereg.json has no pin " + k);
  const gs = pin("gstack");
  const gstack: Source = { name: "gstack", repo: gs.repo, sha: gs.sha, kind: "clone" };
  switch (home) {
    case "none":
      return { home, sources: [], steps: [], claude_md: false };
    case "gstack":
      return { home, sources: [gstack], steps: gstackSteps(gs.sha), claude_md: true };
    case "superpowers":
      return { home, sources: [], steps: superpowersSteps(), claude_md: false };
    case "agent-skills": {
      const a = pin("agent-skills");
      return { home, sources: [{ name: "agent-skills", repo: a.repo, sha: a.sha, kind: "tree", rewrite: true }], steps: [...localMarketplaceSteps("agent-skills", "agent-skills", "addy-agent-skills"), ...devtoolsSteps()], claude_md: false };
    }
    case "gsd": {
      const g = pin("gsd");
      if (!g.npm) h2hFail("E_H2H_PREREG", "prereg.json's gsd pin names no npm package");
      return { home, sources: [], steps: ["npx -y " + g.npm + " --claude --global"], claude_md: false };
    }
    case "pstack": {
      const c = pin("pstack");
      return { home, sources: [{ name: "cursor-plugins", repo: c.repo, sha: c.sha, kind: "tree" }], steps: localMarketplaceSteps("cursor-plugins", "pstack", "cursor-plugins"), claude_md: false };
    }
    case "tstack": {
      const t = pin("tstack");
      return { home, sources: [{ name: "tstack", repo: t.repo, sha: t.sha, kind: "tree" }], steps: ["mkdir -p $HOME/.claude/skills", "cp -R " + SRC_DIR + "/tstack/skills/* $HOME/.claude/skills/"], claude_md: false };
    }
    case "gstack-pony": {
      const y = pin("ponystack");
      return { home, sources: [gstack, { name: "ponystack", repo: y.repo, sha: y.sha, kind: "tree" }], steps: [...gstackSteps(gs.sha), ...localMarketplaceSteps("ponystack", "ponystack", "ponystack")], claude_md: true };
    }
    default:
      return h2hFail("E_H2H_INSTALL", "no install recipe for arm " + arm);
  }
}

/** The container script: every step traced into one ordered log, the home handed back to the caller's uid:gid ($1) whatever the outcome. git
 *  may read the read-only sources, which the caller owns, through the container's system config, never HOME's. */
export function installScript(r: Recipe): string {
  return ["exec 2>&1", "set -euo pipefail", "trap 'chown -R \"$1\" /root' EXIT", "git config --system --add safe.directory '*'", "cd /root", "set -x", ...r.steps].join("\n") + "\n";
}

/** prereg.json's gstack section appended to a CLAUDE.md, after a blank line when the file already has text. */
export function appendClaudeMd(existing: string | null, section: string): string {
  if (!existing) return section;
  return existing + (existing.endsWith("\n") ? "\n" : "\n\n") + section;
}

/** agent-skills' marketplace entry with its GitHub source (no ref) replaced by the marketplace's own root ("./"), which
 *  is the local tree at the pin. Only that field's bytes change; refuses (E_H2H_INSTALL) any other shape. */
export function rewriteMarketplace(text: string, plugin: string): string {
  const before = JSON.parse(text) as { plugins?: Array<{ name: string; source: unknown }> };
  const hits = (before.plugins ?? []).filter((p) => p.name === plugin);
  if (hits.length !== 1) return h2hFail("E_H2H_INSTALL", "the marketplace lists " + hits.length + " plugins named " + plugin + ", not 1");
  const src = hits[0]!.source as Record<string, unknown>;
  if (typeof src !== "object" || src === null || src.source !== "github" || Object.keys(src).sort().join(",") !== "repo,source") return h2hFail("E_H2H_INSTALL", "the " + plugin + " entry's source is " + JSON.stringify(src) + ", not a GitHub source with no ref");
  const re = new RegExp('"source":\\s*\\{\\s*"source":\\s*"github",\\s*"repo":\\s*' + JSON.stringify(src.repo).replace(/[.*+?^${}()|[\]\\/]/g, "\\$&") + "\\s*\\}", "g");
  const found = text.match(re) ?? [];
  if (found.length !== 1) return h2hFail("E_H2H_INSTALL", "the " + plugin + " source object appears " + found.length + " times in the file's text, not once");
  const out = text.replace(re, '"source": "./"');
  const after = JSON.parse(out) as typeof before;
  const i = before.plugins!.findIndex((p) => p.name === plugin);
  const want = structuredClone(before);
  want.plugins![i]!.source = "./";
  if (!isDeepStrictEqual(after, want)) h2hFail("E_H2H_INSTALL", "rewriting the " + plugin + " source changed more than that field");
  return out;
}
