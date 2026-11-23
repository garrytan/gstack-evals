// Copyright (c) 2026 Garry Tan. MIT License.
// B1's four arms: the arm sources under arms/ (regenerated from the pinned agent-skills and gstack checkouts by sources),
// the four trees and their canonical tars (build), their manifests under quick/laneb/arms/manifests/b1 (build --manifests),
// and the check that the committed manifests rebuild byte for byte, that the step text is the same bytes in every treated
// arm, and what each wrapper adds around it (check).
//
//   bun lanes/delivery-route/arms.ts sources --agent-skills <checkout> --gstack <checkout> [--check]
//   bun lanes/delivery-route/arms.ts build [--out <dir>] [--manifests]
//   bun lanes/delivery-route/arms.ts check [--out <dir>]
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { manifest } from "../../quick/laneb/arms/tree.ts";
import { AGENT_SKILLS, ARM_NAMES, ARM_SOURCES, ARMS, B1, DESCRIBED_SKILL, GSTACK_WRAPPER, REPO, sha256, SKILL, type B1Arm } from "./pins.ts";

const pinErr = (m: string): never => { throw new Error("E_B1_PIN " + m); };
export const STUBS = ["gstack-skill-start", "gstack-skill-end", "gstack-learnings-log"];
// The gstack-shaped wrapper's substitutions on verify/SKILL.md's bytes before "# /verify": the skill's name, its
// description, its triggers and the name its preamble and telemetry pass to gstack-skill-start and gstack-skill-end. Each
// must match exactly the number of times given.
export const SUBSTITUTIONS: [string, string, number][] = [
  ["name: verify\n", "name: " + SKILL + "\n", 1],
  ['description: "Use when coding: run the checks and tests /ship picks until green. (gstack)"', 'description: "Use when fixing a bug: prove the bug with a failing test before the fix. (gstack)"', 1],
  ["triggers:\n  - verify my change\n  - run the checks\n  - make the tests pass\n  - make it green\n  - is it green\n  - check my work before ship\n", "triggers:\n  - fix this bug\n  - prove the fix\n  - reproduce the bug in a test\n", 1],
  ['--skill "verify"', '--skill "' + SKILL + '"', 2],
];
// Every arm's files, relative to /root, with the arm source each is copied from and its mode. Directories are 755.
export const LAYOUT: Record<B1Arm, { path: string; source: string; mode: number }[]> = {
  none: [],
  described: [{ path: ".claude/skills/" + DESCRIBED_SKILL + "/SKILL.md", source: "described-SKILL.md", mode: 0o644 }],
  "gstack-shaped": [{ path: ".claude/skills/" + SKILL + "/SKILL.md", source: "gstack-shaped-SKILL.md", mode: 0o644 }, ...STUBS.map((s) => ({ path: ".claude/skills/gstack/bin/" + s, source: s, mode: 0o755 }))],
  command: [{ path: ".claude/commands/" + SKILL + ".md", source: "command-" + SKILL + ".md", mode: 0o644 }],
};
// The file that carries the step text in each treated arm.
export const CARRIER: Record<Exclude<B1Arm, "none">, string> = { described: "described-SKILL.md", "gstack-shaped": "gstack-shaped-SKILL.md", command: "command-" + SKILL + ".md" };
export const TAR_ARGS = ["--sort=name", "--mtime=@0", "--owner=0", "--group=0", "--numeric-owner", "--format=gnu"];

const git = (dir: string, args: string[]) => spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
/** A file at the pinned commit of a checkout that holds it, checked against its recorded git blob. */
function pinnedFile(dir: string, sha: string, file: string, blob: string): string {
  if (git(dir, ["cat-file", "-e", sha + "^{commit}"]).status !== 0) pinErr(dir + " does not hold the pinned commit " + sha);
  const got = git(dir, ["rev-parse", sha + ":" + file]).stdout.trim();
  if (got !== blob) pinErr(dir + ":" + file + " at " + sha + " is blob " + (got || "missing") + ", not " + blob);
  return git(dir, ["show", sha + ":" + file]).stdout;
}
const lines = (text: string, from: number, to: number) => text.split("\n").slice(from - 1, to).join("\n") + "\n";

/** The four generated arm sources from the pinned checkouts. The stub scripts are written by hand and not generated. */
export function sources(agentSkills: string, gstack: string): Record<string, string> {
  const test = pinnedFile(agentSkills, AGENT_SKILLS.sha, AGENT_SKILLS.steps.file, AGENT_SKILLS.blobs[AGENT_SKILLS.steps.file]);
  const tdd = pinnedFile(agentSkills, AGENT_SKILLS.sha, AGENT_SKILLS.description.file, AGENT_SKILLS.blobs[AGENT_SKILLS.description.file]);
  const verify = pinnedFile(gstack, GSTACK_WRAPPER.sha, "verify/SKILL.md", GSTACK_WRAPPER.blobs["verify/SKILL.md"]);
  const steps = lines(test, AGENT_SKILLS.steps.from, AGENT_SKILLS.steps.to);
  const desc = tdd.split("\n")[AGENT_SKILLS.description.line - 1]!;
  if (!desc.startsWith("description: ")) pinErr(AGENT_SKILLS.description.file + " line " + AGENT_SKILLS.description.line + " is not its description");
  const at = verify.indexOf(GSTACK_WRAPPER.before);
  if (at < 0) pinErr("verify/SKILL.md has no " + JSON.stringify(GSTACK_WRAPPER.before));
  let pre = verify.slice(0, at);
  for (const [a, b, want] of SUBSTITUTIONS) {
    const n = pre.split(a).length - 1;
    if (n !== want) pinErr("the wrapper holds " + JSON.stringify(a.slice(0, 40)) + " " + n + " times, not " + want);
    pre = pre.split(a).join(b);
  }
  return {
    "steps.md": steps,
    "described-SKILL.md": "---\nname: " + DESCRIBED_SKILL + "\n" + desc + "\n---\n\n" + steps,
    ["command-" + SKILL + ".md"]: lines(test, AGENT_SKILLS.frontMatter.from, AGENT_SKILLS.frontMatter.to) + "\n" + steps,
    "gstack-shaped-SKILL.md": pre + "# /" + SKILL + "\n\n" + steps,
  };
}

/** What each treated arm's carrier holds around the step text: the bytes before it and after it. The steps are one exact
 *  byte run (steps.md) that each carrier holds once and ends with. */
export function wrappers(read: (f: string) => Buffer = (f) => readFileSync(join(REPO, ARM_SOURCES, f))) {
  const steps = read("steps.md");
  const out: Record<string, { file: string; bytes: number; before: number; after: number }> = {};
  for (const [arm, file] of Object.entries(CARRIER)) {
    const b = read(file), at = b.indexOf(steps);
    if (at < 0 || b.indexOf(steps, at + 1) >= 0) pinErr(file + " does not hold the step text exactly once");
    out[arm] = { file, bytes: b.length, before: at, after: b.length - at - steps.length };
  }
  return { steps_sha256: sha256(steps), steps_bytes: steps.length, arms: out };
}

/** Writes each arm's tree under <out>/tree/<arm> and its canonical tar at <out>/<arm>.tar; returns the tar paths. */
export function build(out: string): Record<B1Arm, string> {
  const tars = {} as Record<B1Arm, string>;
  for (const arm of ARM_NAMES) {
    const tree = join(out, "tree", arm);
    rmSync(tree, { recursive: true, force: true });
    mkdirSync(join(tree, ".claude/skills"), { recursive: true });
    for (const f of LAYOUT[arm]) {
      const dest = join(tree, f.path), parts = f.path.split("/");
      for (let i = 1; i < parts.length; i++) mkdirSync(join(tree, ...parts.slice(0, i)), { recursive: true });
      writeFileSync(dest, readFileSync(join(REPO, ARM_SOURCES, f.source)));
      chmodSync(dest, f.mode);
    }
    spawnSync("find", [join(tree, ".claude"), "-type", "d", "-exec", "chmod", "755", "{}", "+"]);
    const tar = join(out, ARMS[arm].tar + ".tar");
    const r = spawnSync("tar", [...TAR_ARGS, "-cf", tar, "-C", tree, ".claude"], { encoding: "utf8" });
    if (r.status !== 0) pinErr("tar for " + arm + " failed: " + r.stderr.trim());
    tars[arm] = tar;
  }
  return tars;
}

export const manifestDir = () => join(REPO, "quick/laneb", B1.armManifests);
export function manifestOf(arm: B1Arm, tree: string, tar: string) {
  const w = wrappers();
  const tarVersion = spawnSync("tar", ["--version"], { encoding: "utf8" }).stdout.split("\n")[0] ?? "";
  const carrier = arm === "none" ? null : { ...w.arms[arm]!, path: LAYOUT[arm][0]!.path };
  const meta = { claude_code: "2.1.312", typed: ARMS[arm].typed, spec: ARMS[arm].spec, steps: { sha256: w.steps_sha256, bytes: w.steps_bytes, source: AGENT_SKILLS.repo + " " + AGENT_SKILLS.sha + " " + AGENT_SKILLS.steps.file + " lines " + AGENT_SKILLS.steps.from + "-" + AGENT_SKILLS.steps.to }, carrier, tar_command: "tar " + TAR_ARGS.join(" ") + " -cf <arm>.tar .claude (" + tarVersion + ")" };
  return manifest(arm, tree, tar, meta);
}

/** Rebuilds every tar into a scratch dir and compares it with the committed manifests; also checks the wrappers. */
export function check(out = mkdtempSync(join(tmpdir(), "b1-arms-"))): { pass: boolean; lines: string[] } {
  const lines: string[] = [], problems: string[] = [];
  const w = wrappers();
  lines.push("steps " + w.steps_bytes + " bytes, sha256 " + w.steps_sha256);
  for (const [arm, c] of Object.entries(w.arms)) lines.push(arm + ": " + c.file + " " + c.bytes + " bytes, " + c.before + " before the steps, " + c.after + " after");
  const tars = build(out);
  for (const arm of ARM_NAMES) {
    const f = join(manifestDir(), ARMS[arm].tar + ".json");
    if (!existsSync(f)) { problems.push(arm + ": no committed manifest " + f); continue; }
    const want = JSON.parse(readFileSync(f, "utf8")), got = manifestOf(arm, join(out, "tree", arm), tars[arm]).summary;
    if (got.tar.sha256 !== want.tar?.sha256) problems.push(arm + ": the rebuilt tar is sha256 " + got.tar.sha256 + ", not the manifest's " + want.tar?.sha256);
    else if (JSON.stringify((got as Record<string, unknown>).carrier) !== JSON.stringify(want.carrier) || got.tree.digest !== want.tree?.digest) problems.push(arm + ": the rebuilt tree or carrier differs from the manifest");
    else lines.push(arm + ": tar " + got.tar.sha256 + " rebuilt byte for byte, " + got.tree.files + " files");
  }
  for (const p of problems) lines.push("PROBLEM " + p);
  return { pass: !problems.length, lines };
}

export const ARMS_DIR = () => process.env.B1_ARMS_DIR ?? join(process.env.HOME ?? "", ".capy/work/b1/arms");

export function main(argv: string[]): number {
  const flag = (n: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const usage = "E_USAGE usage: arms.ts sources --agent-skills <checkout> --gstack <checkout> [--check] | build [--out <dir>] [--manifests] | check [--out <dir>]";
  try {
    if (argv[0] === "sources") {
      const a = flag("--agent-skills"), g = flag("--gstack");
      if (!a || !g) throw new Error(usage);
      const s = sources(a, g), dir = join(REPO, ARM_SOURCES);
      const differ = Object.entries(s).filter(([f, t]) => !existsSync(join(dir, f)) || readFileSync(join(dir, f), "utf8") !== t).map(([f]) => f);
      if (argv.includes("--check")) { console.log(differ.length ? "differ: " + differ.join(", ") : "every generated arm source matches the pinned checkouts"); return differ.length ? 1 : 0; }
      mkdirSync(dir, { recursive: true });
      for (const [f, t] of Object.entries(s)) writeFileSync(join(dir, f), t);
      console.log("wrote " + Object.keys(s).join(", ") + " under " + ARM_SOURCES);
      return 0;
    }
    if (argv[0] === "build") {
      const out = flag("--out") ?? ARMS_DIR();
      mkdirSync(out, { recursive: true });
      const tars = build(out);
      for (const arm of ARM_NAMES) {
        const { summary, list } = manifestOf(arm, join(out, "tree", arm), tars[arm]);
        if (argv.includes("--manifests")) {
          mkdirSync(manifestDir(), { recursive: true });
          writeFileSync(join(manifestDir(), ARMS[arm].tar + ".json"), JSON.stringify({ ...summary, inventory_sha256: sha256(list) }, null, 2) + "\n");
        }
        writeFileSync(join(out, ARMS[arm].tar + ".files.tsv"), list);
        console.log(arm + " files=" + summary.tree.files + " tar_sha256=" + summary.tar.sha256 + " -> " + tars[arm]);
      }
      return 0;
    }
    if (argv[0] === "check") {
      const r = check(flag("--out"));
      for (const l of r.lines) console.log(l);
      console.log("B1 ARMS " + (r.pass ? "PASS" : "FAIL"));
      return r.pass ? 0 : 1;
    }
    throw new Error(usage);
  } catch (e) {
    const m = (e as Error).message;
    console.error(m.startsWith("E_") ? m : "E_INTERNAL " + m);
    return m.startsWith("E_USAGE") ? 2 : 1;
  }
}
if (import.meta.main) process.exit(main(process.argv.slice(2)));
