// The real-outcome lane's arm trees (plan 2026-11-01-geva-87, section 5 and open items 3 and 4; build unit B5): what a
// trial extracts into /root before Claude Code starts, through Lane B's agent (quick/laneb/runner/agent, _inject_arm).
//
//   bun lanes/real-outcome/arms/build.ts [out-dir]      default out-dir: ~/.capy/work/real-outcome-arms
//
// - none: an empty .claude/skills/, as Lane B's none arm. No gstack, no skills.
// - gstack: gstack at GSTACK_PIN, installed by the rig's own install path (src/arms/install.ts, as the stacks round's
//   arms are): git archive of the pinned commit verified against its tree id, then gstack's ./setup --host claude
//   --no-browser -q, with the checkout at ~/.local/share/gstack. The told and untold arms share this tree; only their
//   turn 2 differs (arms.json).
// - gstack's state (.gstack/) is seeded by the rig's seedStateRoot, the trial state every gstack lane uses: an onboarded
//   user (each first-run marker present), telemetry, update checks, artifact sync and outside voice (codex_reviews) off,
//   the CLAUDE.md routing offer declined, proactive core, and question tuning on with every question gstack's registry
//   lists set to never-ask, which gstack reads as auto-decide (one-way doors still ask). The version bump is left to
//   /ship's own auto-decide. The agent unsets GSTACK_STATE_ROOT and GSTACK_HOME, so gstack reads this ~/.gstack.
// - Every tar runs in Lane B's pinned builder image (canonical: sorted names, mtime 0, owner root), and each arm gets a
//   summary manifest beside this script; the per-file list goes to <out> and to the Captain's handoff, not to git.
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { manifest } from "../../../quick/laneb/arms/tree.ts";
import { copyLayers, installArms, localInstaller, stackSources, type ArmInstall } from "../../../src/arms/install.ts";
import { stateRoot } from "../../../src/trial/image.ts";
import { GLOBAL_PREFERENCES, neverAskPreferences } from "../../../src/trial/review/plan.ts";
import { seedStateRoot, STATE_ROOT_DIR } from "../../../src/trial/state-root.ts";

/** gstack at the commit the B5 build pinned (v1.92.35.0, 2026-11-01), with its git tree. */
export const GSTACK_PIN = { repo: "garrytan/gstack", sha: "4f5b043b3ea02f4fa9887c0122452856c045bb82", git_tree: "d98499668f5d096515db8931fb4f672cd69cd98c", version: "1.92.35.0" } as const;
export const SKILL = "ship";
export const CLAUDE_CODE_VERSION = "2.1.312";
/** Config keys the arm sets on top of the rig's seed (seedConfig): question tuning on, so never-ask reads as auto-decide. */
export const EXTRA_CONFIG = { question_tuning: "true" } as const;
export const ARMS = ["none", "gstack"] as const;

export interface ArmTree {
  name: (typeof ARMS)[number];
  tree: string;
  install: ArmInstall | null;
  preferences_sha256: string | null;
}

const sha256 = (b: string | Buffer) => new Bun.CryptoHasher("sha256").update(b).digest("hex");

/** The installed gstack checkout inside a tree laid out from HOME. */
export function gstackCheckout(tree: string): string {
  return realpathSync(join(tree, ".claude/skills/gstack"));
}

/** Seeds <tree>/.gstack as the rig seeds a trial's state root, with the arm's extra config and never-ask preferences. */
export function seedGstackState(tree: string): string {
  const prefs = neverAskPreferences(gstackCheckout(tree));
  if (prefs === null) throw new Error("E_REAL_ARM_BUILD the gstack tree has no question registry (scripts/question-registry.ts), so its questions cannot be set to auto-decide");
  const scratch = mkdtempSync(join(tmpdir(), "real-arm-state-"));
  try {
    seedStateRoot(scratch, "/root", "core", { ...EXTRA_CONFIG }, { [GLOBAL_PREFERENCES]: prefs });
    rmSync(join(tree, ".gstack"), { recursive: true, force: true });
    renameSync(join(scratch, STATE_ROOT_DIR), join(tree, ".gstack"));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  return prefs;
}

const dirs0755 = (root: string, rel = ""): void => {
  chmodSync(join(root, rel), 0o755);
  for (const name of readdirSync(join(root, rel))) if (lstatSync(join(root, rel, name)).isDirectory()) dirs0755(root, rel ? rel + "/" + name : name);
};

/** Lays out both arm trees under <out>/trees/. gstack is installed through the rig from a local repository that holds the pin. */
export function armTrees(out: string, state = stateRoot()): ArmTree[] {
  const none = join(out, "trees", "none");
  rmSync(none, { recursive: true, force: true });
  mkdirSync(join(none, ".claude", "skills"), { recursive: true });
  dirs0755(none);
  const scratch = mkdtempSync(join(tmpdir(), "real-arms-"));
  let install: ArmInstall;
  try {
    [install] = installArms({
      host: "claude",
      arms: [{ name: "gstack", kind: "stack", stack: { repo: GSTACK_PIN.repo, sha: GSTACK_PIN.sha }, install: {} }],
      skill: SKILL,
      base: null,
      sources: stackSources({ root: null, home: homedir(), state }),
      runner: localInstaller(scratch),
      state,
    }) as [ArmInstall];
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  const p = install.provenance as { stack: { git_tree: string } };
  if (p.stack.git_tree !== GSTACK_PIN.git_tree) throw new Error("E_REAL_ARM_BUILD gstack@" + GSTACK_PIN.sha + " installed tree " + p.stack.git_tree + ", not the pinned " + GSTACK_PIN.git_tree);
  const tree = join(out, "trees", "gstack");
  rmSync(tree, { recursive: true, force: true });
  mkdirSync(tree, { recursive: true });
  copyLayers(install.layers, tree);
  const version = readFileSync(join(gstackCheckout(tree), "VERSION"), "utf8").trim();
  if (version !== GSTACK_PIN.version) throw new Error("E_REAL_ARM_BUILD the installed gstack reports " + version + ", not " + GSTACK_PIN.version);
  const prefs = seedGstackState(tree);
  dirs0755(tree);
  return [
    { name: "none", tree: none, install: null, preferences_sha256: null },
    { name: "gstack", tree, install, preferences_sha256: sha256(prefs) },
  ];
}

if (import.meta.main) {
  const here = import.meta.dir;
  const out = resolve(process.argv[2] ?? join(homedir(), ".capy", "work", "real-outcome-arms"));
  mkdirSync(out, { recursive: true });
  process.env.PATH = dirname(process.execPath) + ":" + (process.env.PATH ?? "/usr/bin:/bin");
  const builder = /^ARG BUILDER_IMAGE=(.+)$/m.exec(readFileSync(join(here, "../../../quick/laneb/arms/Dockerfile"), "utf8"))![1]!;
  const inBuilder = (args: string[]): void => {
    const r = spawnSync("docker", ["run", "--rm", "--network", "none", "-u", process.getuid!() + ":" + process.getgid!(), "-v", out + ":/out", "-w", "/out", builder, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    if (r.status !== 0) throw new Error("E_REAL_ARM_BUILD builder " + args.join(" ") + " exited " + r.status + ": " + (r.stderr ?? r.error));
  };
  console.log("== arm trees: none, and gstack@" + GSTACK_PIN.sha.slice(0, 12) + " through the rig's install");
  const arms = armTrees(out);
  for (const arm of arms) {
    const top = readdirSync(arm.tree).sort();
    inBuilder(["tar", "--sort=name", "--mtime=@0", "--owner=0", "--group=0", "--numeric-owner", "--format=gnu", "-C", "trees/" + arm.name, "-cf", arm.name + ".tar", ...top]);
    const p = arm.install?.provenance as Record<string, any> | undefined;
    const meta: Record<string, string> = {
      claude_code: CLAUDE_CODE_VERSION,
      ...(p
        ? {
            gstack_repo: GSTACK_PIN.repo,
            gstack_sha: GSTACK_PIN.sha,
            gstack_version: GSTACK_PIN.version,
            gstack_git_tree: p.stack.git_tree,
            gstack_tree_sha256: p.stack.tree_sha256,
            rig_tree_sha256: arm.install!.tree_sha256,
            install_command: p.install.command,
            install_runner: p.install.runner,
            state_config_sha256: sha256(readFileSync(join(arm.tree, ".gstack", "config.yaml"))),
            question_preferences_sha256: arm.preferences_sha256!,
          }
        : {}),
    };
    const m = manifest(arm.name, arm.tree, join(out, arm.name + ".tar"), meta);
    writeFileSync(join(out, arm.name + ".files.tsv"), m.list);
    writeFileSync(join(here, "manifests", arm.name + ".json"), JSON.stringify({ ...m.summary, files_tsv_sha256: sha256(m.list) }, null, 2) + "\n");
    console.log(arm.name + " files=" + m.summary.tree.files + " skills=" + m.summary.skills.count + " tree_digest=" + m.summary.tree.digest + " tar_sha256=" + m.summary.tar.sha256);
  }
  console.log("tests: REAL_OUTCOME_ARMS=" + out + " bun test tests/real-outcome/arms.test.ts");
  if (!existsSync(join(out, "gstack.tar"))) process.exit(1);
}
