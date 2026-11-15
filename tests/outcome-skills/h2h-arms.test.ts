// Copyright (c) 2026 Garry Tan. MIT License.
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { globRe, HASH_RULE, homeEntries, homeRoots, homeTreeSha256, treeSha256 } from "../../lanes/outcome-skills/h2h/arms/hash.ts";
import { ARM_HOME, HOME_COPY, HOME_OF, homeArm, homeVolume } from "../../lanes/outcome-skills/h2h/arms/layer.ts";
import { armPins, ARMS_PINS_PATH, checkoutCheck, dirGitTree, treeCheck, trimLinkSlashes, type ArmsPins } from "../../lanes/outcome-skills/h2h/arms/pins.ts";
import { appendClaudeMd, BUILD_PINS, installDockerfile, INSTALL_ENV, INSTALL_IMAGE, installScript, LOCAL_MARKETPLACES, recipe, rewriteMarketplace, SRC_DIR } from "../../lanes/outcome-skills/h2h/arms/recipes.ts";
import { readPrereg } from "../../lanes/outcome-skills/h2h/prereg.ts";
import { ALL_ARMS, BROWSER } from "../../lanes/outcome-skills/h2h/types.ts";

const p = readPrereg();
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const g = (d: string, ...a: string[]) => spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd: d, encoding: "utf8" }).stdout.trim();
function tree(files: Record<string, string>): string {
  const d = mkdtempSync(join(tmpdir(), "h2h-arms-"));
  for (const [f, body] of Object.entries(files)) {
    mkdirSync(dirname(join(d, f)), { recursive: true });
    writeFileSync(join(d, f), body);
  }
  return d;
}
const MKT = JSON.stringify({ $schema: "https://json.schemastore.org/claude-code-marketplace.json", name: "addy-agent-skills", owner: { name: "Addy Osmani" }, plugins: [{ name: "agent-skills", version: "0.6.16", source: { source: "github", repo: "addyosmani/agent-skills" }, license: "MIT", keywords: ["skills", "agents"] }] }, null, 2) + "\n";

describe("h2h install recipes", () => {
  test("every arm has a recipe, and gstack-oneline and gstack-qa run on gstack's home", () => {
    for (const arm of ALL_ARMS) expect(recipe(arm, p).home).toBe(homeArm(arm));
    expect(HOME_OF).toEqual({ "gstack-oneline": "gstack", "gstack-qa": "gstack" });
    expect(recipe("gstack-qa", p)).toEqual(recipe("gstack", p));
    expect(recipe("gstack-oneline", p)).toEqual(recipe("gstack", p));
    expect(recipe("none", p)).toEqual({ home: "none", sources: [], steps: [], claude_md: false });
  });

  test("gstack is cloned at prereg.json's pin into ~/.claude/skills/gstack and set up with ./setup", () => {
    const r = recipe("gstack", p);
    const pin = p.pins.gstack!.sha;
    expect(r.sources).toEqual([{ name: "gstack", repo: "garrytan/gstack", sha: pin, kind: "clone" }]);
    expect(r.steps).toContain("git -C $HOME/.claude/skills/gstack fetch -q --depth 1 file://" + SRC_DIR + "/gstack " + pin);
    expect(r.steps).toContain("git -C $HOME/.claude/skills/gstack remote add -t main origin https://github.com/garrytan/gstack.git");
    expect(r.steps.at(-2)).toBe('test "$(git -C $HOME/.claude/skills/gstack rev-parse HEAD)" = ' + pin);
    expect(r.steps.at(-1)).toBe("(cd $HOME/.claude/skills/gstack && ./setup)");
    expect(r.claude_md).toBe(true);
    const pony = recipe("gstack-pony", p);
    expect(pony.steps.slice(0, r.steps.length)).toEqual(r.steps);
    expect(pony.steps.slice(r.steps.length)).toEqual(["mkdir -p $HOME/" + LOCAL_MARKETPLACES, "cp -a --no-preserve=ownership " + SRC_DIR + "/ponystack $HOME/" + LOCAL_MARKETPLACES + "/ponystack", "claude plugin marketplace add $HOME/" + LOCAL_MARKETPLACES + "/ponystack", "claude plugin install ponystack@ponystack"]);
    expect(pony.sources[1]).toEqual({ name: "ponystack", repo: p.pins.ponystack!.repo, sha: p.pins.ponystack!.sha, kind: "tree" });
    expect(pony.claude_md).toBe(true);
    for (const arm of ["superpowers", "agent-skills", "gsd", "pstack", "tstack"] as const) expect(recipe(arm, p).claude_md).toBe(false);
  });

  test("the plugin packs install from their marketplaces at the pins, and GSD and tstack as their READMEs say", () => {
    expect(recipe("superpowers", p).steps).toEqual([
      "claude plugin marketplace add anthropics/claude-plugins-official",
      "git -C $HOME/.claude/plugins/marketplaces/claude-plugins-official fetch -q --depth 1 origin " + BUILD_PINS.official_marketplace.sha,
      "git -C $HOME/.claude/plugins/marketplaces/claude-plugins-official reset -q --hard " + BUILD_PINS.official_marketplace.sha,
      "rm -f $HOME/.claude/plugins/marketplaces/claude-plugins-official/.git/FETCH_HEAD",
      'test "$(git -C $HOME/.claude/plugins/marketplaces/claude-plugins-official rev-parse HEAD)" = ' + BUILD_PINS.official_marketplace.sha,
      "claude plugin install superpowers@claude-plugins-official",
    ]);
    const a = recipe("agent-skills", p);
    expect(a.sources).toEqual([{ name: "agent-skills", repo: p.pins["agent-skills"]!.repo, sha: p.pins["agent-skills"]!.sha, kind: "tree", rewrite: true }]);
    expect(a.steps).toContain("claude plugin install agent-skills@addy-agent-skills");
    expect(a.steps).toContain("claude mcp add --scope user chrome-devtools -- npx -y chrome-devtools-mcp@" + BUILD_PINS.chrome_devtools_mcp.version + " --isolated --headless --executablePath " + BROWSER.wrapper_container_path);
    expect(recipe("gsd", p).steps).toEqual(["npx -y " + p.pins.gsd!.npm + " --claude --global"]);
    expect(p.pins.gsd!.npm).toBe("@opengsd/gsd-core@1.21.0");
    const ps = recipe("pstack", p);
    expect(ps.sources).toEqual([{ name: "cursor-plugins", repo: "cursor/plugins", sha: p.pins.pstack!.sha, kind: "tree" }]);
    expect(ps.steps.at(-1)).toBe("claude plugin install pstack@cursor-plugins");
    expect(recipe("tstack", p).steps).toEqual(["mkdir -p $HOME/.claude/skills", "cp -R " + SRC_DIR + "/tstack/skills/* $HOME/.claude/skills/"]);
  });

  test("the container script traces every step into one log and hands HOME back to the caller", () => {
    const s = installScript(recipe("tstack", p)).split("\n");
    expect(s.slice(0, 6)).toEqual(["exec 2>&1", "set -euo pipefail", "trap 'chown -R \"$1\" /root' EXIT", "git config --system --add safe.directory '*'", "cd /root", "set -x"]);
    expect(s.slice(6, 8)).toEqual(recipe("tstack", p).steps);
    expect(Object.keys(INSTALL_ENV).sort()).toEqual(["CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", "DISABLE_AUTOUPDATER", "HOME", "LANG", "PATH", "TERM", "USER"]);
    expect(INSTALL_ENV.HOME).toBe(ARM_HOME);
  });

  test("the install image pins its bases by digest and Claude Code at one version", () => {
    const d = installDockerfile();
    expect(d).toContain("FROM node:24-bookworm@sha256:");
    expect(d).toContain("COPY --from=oven/bun:1.4.4@sha256:");
    expect(d).toContain("npm install -g @anthropic-ai/claude-code@2.1.325 ");
    expect(d).toContain("playwright@1.65.0 install-deps chromium");
    expect(INSTALL_IMAGE.claude_code).toBe(BUILD_PINS.claude_code.version);
  });

  test("the marketplace rewrite changes only agent-skills' source field", () => {
    const out = rewriteMarketplace(MKT, "agent-skills");
    const j = JSON.parse(out);
    expect(j.plugins[0].source).toBe("./");
    expect({ ...j, plugins: [{ ...j.plugins[0], source: null }] }).toEqual({ ...JSON.parse(MKT), plugins: [{ ...JSON.parse(MKT).plugins[0], source: null }] });
    const bad = (f: (j: any) => void) => {
      const k = JSON.parse(MKT);
      f(k);
      return () => rewriteMarketplace(JSON.stringify(k, null, 2), "agent-skills");
    };
    expect(bad((k) => (k.plugins[0].source.ref = "v1"))).toThrow(/^E_H2H_INSTALL .*not a GitHub source with no ref/);
    expect(bad((k) => (k.plugins[0].source = "./x"))).toThrow(/^E_H2H_INSTALL /);
    expect(bad((k) => k.plugins.push({ ...k.plugins[0] }))).toThrow(/^E_H2H_INSTALL .*2 plugins named agent-skills/);
    expect(bad((k) => (k.plugins = []))).toThrow(/^E_H2H_INSTALL .*0 plugins/);
  });

  test("gstack's CLAUDE.md section is prereg.json's text, appended after a blank line", () => {
    const s = p.gstack_claude_md;
    expect(s.startsWith("## gstack\n")).toBe(true);
    expect(appendClaudeMd(null, s)).toBe(s);
    expect(appendClaudeMd("", s)).toBe(s);
    expect(appendClaudeMd("# Mine\n", s)).toBe("# Mine\n\n" + s);
    expect(appendClaudeMd("# Mine", s)).toBe("# Mine\n\n" + s);
  });
});

describe("h2h home tree hash", () => {
  test("globs match whole paths, * inside one segment and ** across segments", () => {
    expect(globRe("**/.git/index").test(".git/index")).toBe(true);
    expect(globRe("**/.git/index").test("a/b/.git/index")).toBe(true);
    expect(globRe("**/.git/index").test("a/.git/index2")).toBe(false);
    expect(globRe(".claude/backups/**").test(".claude/backups/x/y")).toBe(true);
    expect(globRe(".claude/*.json").test(".claude/a/b.json")).toBe(false);
  });

  test("the frozen rule leaves out what differs from run to run and keeps every pack byte", () => {
    const files = (machine: string, nonce: string, extra: Record<string, string> = {}) => tree({
      ".claude.json": JSON.stringify({ firstStartTime: machine, machineID: machine, userID: machine, mcpServers: { "chrome-devtools": { command: "npx" } } }),
      [".claude/backups/.claude.json.backup." + machine]: "x",
      ".claude/plugins/installed_plugins.json": JSON.stringify({ version: 2, plugins: { "a@b": [{ installPath: "/root/x", installedAt: machine, lastUpdated: machine }] } }),
      ".claude/gsd-core/workflows/quick.md": "IFS= read -rd '' GSD_ARGS <<'GSD_ARGS_END_" + nonce + "'\n",
      ".claude/skills/gstack/.git/index": machine,
      ".claude/skills/gstack/.git/logs/HEAD": machine,
      ".gstack/installs.tsv": "claude\tglobal\t1.99.4.0\t2026-11-15T04:18:" + (machine === "a" ? "31" : "59") + "Z\n",
      [".npm/_logs/" + machine + ".log"]: machine,
      ...(machine === "b" ? { ".claude/plugins/.last_inuse_sweep": "2026-11-15T05:02:11.000Z" } : {}),
      ".claude/skills/x/SKILL.md": "skill\n",
      ...extra,
    });
    const a = homeTreeSha256(files("a", "a".repeat(32)));
    expect(homeTreeSha256(files("b", "b".repeat(32)))).toBe(a);
    expect(homeTreeSha256(files("b", "b".repeat(32), { ".claude/skills/x/SKILL.md": "skill!\n" }))).not.toBe(a);
    const mcp = files("a", "a".repeat(32), { ".claude.json": JSON.stringify({ machineID: "a", mcpServers: {} }) });
    expect(homeTreeSha256(mcp)).not.toBe(a);
    const ex = files("a", "a".repeat(32));
    chmodSync(join(ex, ".claude/skills/x/SKILL.md"), 0o755);
    expect(homeTreeSha256(ex)).not.toBe(a);
    expect(HASH_RULE.skip).toContain("**/.git/index");
    expect(HASH_RULE.skip).toContain(".claude/plugins/.last_inuse_sweep");
  });

  test("entries are (path, git mode, sha256) with links by target, and an empty home hashes as the empty list", () => {
    const d = tree({ "a/f": "x" });
    symlinkSync("../a/f", join(d, "l"));
    expect(homeEntries(d)).toEqual([{ path: "a/f", mode: "100644", sha256: sha("x") }, { path: "l", mode: "120000", sha256: sha("../a/f") }]);
    expect(treeSha256([])).toBe(sha(""));
    expect(homeTreeSha256(mkdtempSync(join(tmpdir(), "h2h-empty-")))).toBe(sha(""));
  });

  test("roots descend only into the shared directories", () => {
    const d = tree({ ".claude.json": "{}", ".claude/settings.json": "{}", ".claude/skills/a/SKILL.md": "", ".claude/skills/b/SKILL.md": "", ".claude/plugins/cache/m/p/1/x": "", ".gstack/x": "", ".cache/ms-playwright/c/x": "" });
    expect(homeRoots(d)).toEqual([".cache/ms-playwright", ".claude/plugins/cache/m", ".claude/settings.json", ".claude/skills/a", ".claude/skills/b", ".claude.json", ".gstack"]);
  });
});

describe("h2h pin checks", () => {
  test("a copied tree hashes to its commit's git tree, exec bits and links included", () => {
    const r = tree({ "a.txt": "a\n", "bin/run": "#!/bin/sh\n" });
    chmodSync(join(r, "bin/run"), 0o755);
    symlinkSync("bin/run", join(r, "link"));
    g(r, "init", "-q");
    g(r, "add", "-A");
    g(r, "commit", "-q", "-m", "c");
    const want = g(r, "rev-parse", "HEAD^{tree}");
    const copy = mkdtempSync(join(tmpdir(), "h2h-copy-"));
    spawnSync("bash", ["-c", "git -C '" + r + "' archive HEAD | tar -x -C '" + copy + "'"]);
    expect(dirGitTree(copy)).toBe(want);
    expect(treeCheck("o/r", copy, want, "copy").matched).toBe(true);
    writeFileSync(join(copy, "a.txt"), "b\n");
    expect(treeCheck("o/r", copy, want, "copy")).toMatchObject({ matched: false });
    expect(treeCheck("o/r", join(copy, "missing"), want, "copy").how).toContain("is missing, not the pin's tree");
  });

  test("a checkout matches at its pin and tree, and not after a tracked change or at another commit", () => {
    const r = tree({ "a.txt": "a\n" });
    g(r, "init", "-q");
    g(r, "add", "-A");
    g(r, "commit", "-q", "-m", "c");
    const pin = g(r, "rev-parse", "HEAD");
    const t = g(r, "rev-parse", "HEAD^{tree}");
    writeFileSync(join(r, "build-output.js"), "untracked\n");
    expect(checkoutCheck("o/r", r, pin, t).matched).toBe(true);
    expect(checkoutCheck("o/r", r, "0".repeat(40), t).how).toContain("is not the pin");
    writeFileSync(join(r, "a.txt"), "changed\n");
    const c = checkoutCheck("o/r", r, pin, t);
    expect(c.matched).toBe(false);
    expect(c.how).toContain("1 tracked files changed (M a.txt)");
  });

  test("Claude Code's link copy is applied by trimming a target's trailing slash", () => {
    const d = tree({ "skills/a/SKILL.md": "" });
    mkdirSync(join(d, ".opencode"));
    symlinkSync("../skills/", join(d, ".opencode/skills"));
    expect(trimLinkSlashes(d)).toEqual([".opencode/skills -> ../skills"]);
    expect(readlinkSync(join(d, ".opencode/skills"))).toBe("../skills");
  });
});

describe("h2h arms-pins.json", () => {
  const j = JSON.parse(readFileSync(ARMS_PINS_PATH, "utf8")) as ArmsPins;
  test("holds one finished, pin-checked record per arm, at prereg.json's pins", () => {
    expect(j.schema).toBe("h2h-arms-pins.v1");
    expect(j.arms.map((a) => a.arm)).toEqual([...ALL_ARMS]);
    for (const a of j.arms) {
      expect(a.home_of).toBe(HOME_OF[a.arm] ?? null);
      expect(a.pins).toEqual(armPins(a.arm, p));
      expect(a.home_tree_sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(a.claude_code_version).toBe(INSTALL_IMAGE.claude_code);
      expect(a.pin_checks.every((c) => c.matched)).toBe(true);
      expect(a.pin_checks.length > 0).toBe(a.arm !== "none");
      expect(typeof a.browser).toBe("string");
      for (const s of a.newer_seen) expect(s.sha).toMatch(/^[0-9a-f]{40}$|^$/);
    }
    const byArm = Object.fromEntries(j.arms.map((a) => [a.arm, a]));
    expect(byArm["gstack-qa"]!.home_tree_sha256).toBe(byArm.gstack!.home_tree_sha256);
    expect(byArm["gstack-oneline"]!.home_tree_sha256).toBe(byArm.gstack!.home_tree_sha256);
    expect(byArm.none!.home_tree_sha256).toBe(sha(""));
    expect(byArm.none!.roots).toEqual([]);
  });

  test("records the build's own pins, the image and the hash rule as the code has them", () => {
    expect(j.build_pins).toEqual(JSON.parse(JSON.stringify(BUILD_PINS)));
    expect(j.hash_rule).toEqual(JSON.parse(JSON.stringify(HASH_RULE)));
    expect(j.install_image).toMatchObject({ ...INSTALL_IMAGE, dockerfile_sha256: sha(installDockerfile()) });
    expect(j.freeze_date).toBe("2026-11-15");
  });

  test("names each home's volume and the copy a session image build runs", () => {
    expect(homeVolume("gstack-qa", "ab".repeat(32))).toBe("h2h-home-gstack-" + "ab".repeat(6));
    expect(HOME_COPY).toBe("cp -a --no-preserve=ownership /h2h-home/. /root/");
    expect(existsSync(ARMS_PINS_PATH)).toBe(true);
  });
});
