// Lane B (TB2) arms for the stacks round (plan 2026-10-30-geva-59-stacks-round-1-plan, section 10 step 3): pstack and
// pstack-placebo as trees a TB2 trial extracts into /root, their canonical tars and their manifests. pstack is Lauren
// Tan's (MIT, in cursor/plugins). No pstack text is stored in this repo: the trees come from a local clone at the plan's
// pin, and only digests are committed.
//
//   bun arms/stacks.ts [out-dir]      default out-dir: ~/.capy/work/laneb-arms
//
// - Both trees come from the rig's own install path (src/arms/install.ts), as step 1 built it. pstack is the stack arm:
//   cursor/plugins at the pin, the subtree harness/pstack/claude-code verified against its git tree, copied to
//   ~/.local/share/pstack, with pstack's own bootstrap for poteto-mode's scripts run at build time, where egress is open.
//   pstack-placebo is the placebo arm of it: the plugin manifest and one SKILL.md per skill from Lane B's generator.
// - Each tree gets one rig-authored file, ~/.claude/settings.json, whose env block sets CLAUDE_CODE_PLUGIN_DIRS to the
//   plugin root. Claude Code reads it as a user setting (the Lane B agent loads the user and project setting sources)
//   and loads the folder as a plugin, so /pstack:<name> resolves with no runner change. Step 1's review rig passes the
//   same folder as --plugin-dir instead.
// - Directories become 0755, as in Lane B's other arms, since the trial runs Claude Code as root.
// - The source clone is <state>/sources/ (the rig never fetches: clone cursor/plugins there first). Every tar and gzip
//   runs in Lane B's pinned builder image, as in build.sh. The Claude Code binary the trial runtime pins is fetched to
//   <out>/claude-code/claude for tests/stacks.test.ts.
// - Writes <out>/<arm>.tar and .tar.gz, <out>/trees/<arm>, and manifests/<arm>.json, <arm>.files.tsv and
//   pstack-placebo-tokens.tsv beside this script.
import { spawnSync } from "node:child_process";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { copyLayers, installArms, localInstaller, stackSources, type ArmInstall } from "../../../src/arms/install.ts";
import { STACKS } from "../../../src/arms/stacks.ts";
import { stateRoot } from "../../../src/trial/image.ts";
import { tokenReport } from "./placebo/generate.ts";
import { placeboSkill, sha256, type SkillResult } from "./placebo/placebo.ts";
import { manifest } from "./tree.ts";

export const PSTACK = STACKS.find((k) => k.name === "pstack")!;
export const ARMS = ["pstack", "pstack-placebo"] as const;
export const TOLD_SKILL = PSTACK.told.tb2!.slice(1).split(":").pop()!;
export const CLAUDE_CODE_VERSION = "2.1.312";
export const SETTINGS = ".claude/settings.json";
export const PLUGIN_SKILLS = ".local/share/" + PSTACK.name + "/skills";

/** The rig-authored settings file: Claude Code loads each plugin root, relative to HOME, as a plugin folder. */
export const settingsFor = (plugins: readonly string[]): string => JSON.stringify({ env: { CLAUDE_CODE_PLUGIN_DIRS: plugins.map((p) => "~/" + p).join(":") } }, null, 2) + "\n";

export interface StackArm {
  name: (typeof ARMS)[number];
  tree: string;
  install: ArmInstall;
}

/** Installs pstack and its placebo through the rig, and lays each out as a tree rooted at HOME, settings file included. */
export function stackTrees(out: string, state = stateRoot()): StackArm[] {
  const sources = stackSources({ root: null, home: homedir(), state });
  const scratch = mkdtempSync(join(tmpdir(), "laneb-stacks-"));
  let installs: ArmInstall[];
  try {
    installs = installArms({
      host: "claude",
      arms: [
        { name: "pstack", kind: "stack", stack: { repo: PSTACK.repo, sha: PSTACK.pin.sha, path: PSTACK.path }, install: { ...PSTACK.install } },
        { name: "pstack-placebo", kind: "placebo", of: "pstack" },
      ],
      skill: TOLD_SKILL,
      base: null,
      sources,
      runner: localInstaller(scratch),
      state,
    });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  return installs.map((install) => {
    const tree = join(out, "trees", install.name);
    rmSync(tree, { recursive: true, force: true });
    mkdirSync(tree, { recursive: true });
    copyLayers(install.layers, tree);
    mkdirSync(join(tree, ".claude"), { recursive: true });
    writeFileSync(join(tree, SETTINGS), settingsFor(install.plugins));
    const dirs = (rel: string): void => {
      chmodSync(join(tree, rel), 0o755);
      for (const name of readdirSync(join(tree, rel))) if (lstatSync(join(tree, rel, name)).isDirectory()) dirs(rel ? rel + "/" + name : name);
    };
    dirs("");
    chmodSync(join(tree, SETTINGS), 0o644);
    return { name: install.name as StackArm["name"], tree, install };
  });
}

/** The placebo's token report, from the generator run again on each pstack SKILL.md; refuses a placebo file that differs from it. */
export function placeboReport(pstack: string, placebo: string, seed: string): SkillResult[] {
  return readdirSync(join(placebo, PLUGIN_SKILLS)).sort().map((folder) => {
    const result = placeboSkill(folder, readFileSync(join(pstack, PLUGIN_SKILLS, folder, "SKILL.md"), "utf8"), seed);
    if (readFileSync(join(placebo, PLUGIN_SKILLS, folder, "SKILL.md"), "utf8") !== result.output) throw new Error("E_INTERNAL " + folder + "/SKILL.md in the placebo tree is not the generator's output");
    return result;
  });
}

if (import.meta.main) {
  const here = import.meta.dir;
  const out = process.argv[2] ?? join(homedir(), ".capy", "work", "laneb-arms");
  mkdirSync(out, { recursive: true });
  const builder = /^ARG BUILDER_IMAGE=(.+)$/m.exec(readFileSync(join(here, "Dockerfile"), "utf8"))![1]!;
  const inBuilder = (args: string[]): void => {
    const r = spawnSync("docker", ["run", "--rm", "--network", "none", "-u", process.getuid!() + ":" + process.getgid!(), "-v", out + ":/out", "-w", "/out", builder, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    if (r.status !== 0) throw new Error("E_INTERNAL builder " + args.join(" ") + " exited " + r.status + ": " + (r.stderr ?? r.error));
  };

  console.log("== pstack and pstack-placebo through the rig's install (cursor/plugins@" + PSTACK.pin.sha.slice(0, 12) + ":" + PSTACK.path + ")");
  const arms = stackTrees(out);
  const results = placeboReport(arms[0]!.tree, arms[1]!.tree, String(arms[1]!.install.provenance.seed));
  writeFileSync(join(here, "manifests", "pstack-placebo-tokens.tsv"), tokenReport(results));
  const ratios = results.map((r) => r.placeboTokens / r.originalTokens);
  console.log("placebo skills " + results.length + " ratio_min " + Math.min(...ratios).toFixed(4) + " ratio_max " + Math.max(...ratios).toFixed(4));

  console.log("== Claude Code " + CLAUDE_CODE_VERSION + ", the trial runtime's binary, for the tests");
  const cc = join(out, "claude-code");
  if (spawnSync(join(cc, "claude"), ["--version"], { encoding: "utf8" }).stdout?.trim() !== CLAUDE_CODE_VERSION + " (Claude Code)") {
    rmSync(cc, { recursive: true, force: true });
    mkdirSync(cc, { recursive: true });
    const pack = spawnSync("sh", ["-c", "npm pack @anthropic-ai/claude-code-linux-x64@" + CLAUDE_CODE_VERSION + " >/dev/null && tar xzf anthropic-ai-claude-code-linux-x64-" + CLAUDE_CODE_VERSION + ".tgz && install -m 0755 package/claude claude && rm -rf package *.tgz"], { cwd: cc, encoding: "utf8" });
    if (pack.status !== 0) throw new Error("E_INTERNAL cannot fetch Claude Code " + CLAUDE_CODE_VERSION + ": " + pack.stderr);
  }

  console.log("== tars and manifests");
  const bun = spawnSync("bun", ["--version"], { encoding: "utf8" }).stdout.trim();
  for (const arm of arms) {
    const top = readdirSync(arm.tree).sort();
    inBuilder(["tar", "--sort=name", "--mtime=@0", "--owner=0", "--group=0", "--numeric-owner", "--format=gnu", "-C", "trees/" + arm.name, "-cf", arm.name + ".tar", ...top]);
    inBuilder(["sh", "-c", "gzip -n -6 -c " + arm.name + ".tar > " + arm.name + ".tar.gz"]);
    const p = arm.install.provenance as Record<string, any>;
    const stack = p.kind === "stack" ? p.stack : (arms[0]!.install.provenance as Record<string, any>).stack;
    const meta: Record<string, string> = {
      claude_code: CLAUDE_CODE_VERSION,
      tar_gz_sha256: sha256(readFileSync(join(out, arm.name + ".tar.gz"))),
      stack_repo: stack.repo,
      stack_sha: stack.sha,
      stack_path: stack.path,
      stack_git_tree: stack.git_tree,
      stack_tree_sha256: stack.tree_sha256,
      rig_tree_sha256: arm.install.tree_sha256,
      plugin_dirs: arm.install.plugins.map((d) => "~/" + d).join(":"),
      settings_sha256: sha256(readFileSync(join(arm.tree, SETTINGS))),
      told: PSTACK.told.tb2!,
      ...(p.kind === "stack"
        ? { install_command: p.install.command, install_runner: p.install.runner, install_bun: bun }
        : { placebo_of: p.of, placebo_seed: p.seed, placebo_generator_sha256: p.generator_sha256 }),
    };
    const m = manifest(arm.name, arm.tree, join(out, arm.name + ".tar"), meta, PLUGIN_SKILLS);
    writeFileSync(join(here, "manifests", arm.name + ".json"), JSON.stringify(m.summary, null, 2) + "\n");
    writeFileSync(join(here, "manifests", arm.name + ".files.tsv"), m.list);
    console.log(arm.name + " files=" + m.summary.tree.files + " skills=" + m.summary.skills.count + " tree_digest=" + m.summary.tree.digest + " tar_sha256=" + m.summary.tar.sha256);
  }
  console.log("tests: LANEB_STACK_ARMS=" + out + " bun test quick/laneb/tests/stacks.test.ts");
}
