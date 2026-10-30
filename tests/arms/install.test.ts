import { afterAll, describe, expect, test } from "bun:test";
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installArms, InstallError, localInstaller, stackInstall, stackTree, WRITABLE, type ArmInstall } from "../../src/arms/install.ts";
import { resolveArms, type ResolvedArms } from "../../src/skill-eval/cli/arms.ts";
import { FIXTURE_PATH } from "../../src/trial/image.ts";
import type { Host } from "../../src/types.ts";
import { commitAll, git } from "../cli/helpers.ts";
import { FAKE_STACK, fakeStack } from "../adapters/stack.ts";

const roots: string[] = [];
const scratch = (name: string) => {
  const dir = mkdtempSync(join(tmpdir(), "gse-" + name + "-"));
  roots.push(dir);
  return dir;
};
afterAll(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

const stack = fakeStack();
roots.push(stack.root);
const resolved = resolveArms(["before=" + join(stack.root, "demo"), "after=fake-stack@" + stack.edited, "none", "placebo", "bare"], {}) as ResolvedArms;
const install = (host: Host, state = scratch("state")) => installArms({ host, arms: resolved.arms, skill: "demo", base: resolved.base, sources: [stack.root], runner: localInstaller(scratch("runner")), state });
const stop = (fn: () => unknown): string => {
  try {
    fn();
  } catch (error) {
    if (error instanceof InstallError) return error.code;
    throw error;
  }
  return "no stop";
};

/** Every entry under a layer: [path, "l:<target>" | "f:<mode>"]. */
function entries(dir: string, rel = ""): [string, string][] {
  return readdirSync(join(dir, rel)).sort().flatMap((name): [string, string][] => {
    const path = rel ? rel + "/" + name : name;
    const st = lstatSync(join(dir, path));
    if (st.isSymbolicLink()) return [[path, "l:" + readlinkSync(join(dir, path))]];
    if (st.isDirectory()) return [[path + "/", "d:" + (st.mode & 0o7777).toString(8)], ...entries(dir, path)];
    return [[path, "f:" + (st.mode & 0o777).toString(8)]];
  });
}
const byName = (arms: ArmInstall[]) => Object.fromEntries(arms.map((a) => [a.name, a]));

describe("arm installs on a real host (src/arms/install.ts)", () => {
  // Value: protects=a stack tree comes only from a local repository that holds the commit, and only when the bytes git archive extracted hash back to the commit's tree id; fails_when=a missing commit is fetched or skipped, or an archive an attribute rewrote (export-subst) is installed as if it were the commit; why_new=GST-272 (the base comes from a pinned source and is verified by digest; nothing fetched at trial time); seam=stackTree; no_claim=git's object store integrity, which git fsck checks
  test("stackTree verifies the extracted tree against the commit and refuses a missing commit", () => {
    const to = join(scratch("tree"), "t");
    const got = stackTree({ repo: "fake-stack", sha: stack.base }, [scratch("empty"), stack.root], to);
    expect(got.source).toBe(stack.root);
    expect(readFileSync(join(to, "demo", "SKILL.md"), "utf8")).toContain("# Demo base");
    expect(lstatSync(join(to, "setup")).mode & 0o111).not.toBe(0);
    expect(stop(() => stackTree({ repo: "gstack", sha: "0".repeat(40) }, [stack.root], join(scratch("tree"), "t")))).toBe("E_STACK_SOURCE");
    const subst = scratch("subst");
    writeFileSync(join(subst, ".gitattributes"), "VERSION export-subst\n");
    writeFileSync(join(subst, "VERSION"), "$Format:%H$\n");
    const sha = commitAll(subst);
    expect(stop(() => stackTree({ repo: "subst", sha }, [subst], join(scratch("tree"), "t")))).toBe("E_STACK_DIGEST");
  });

  // Value: protects=a source repository's replace refs cannot swap another commit's tree in for the pinned sha; fails_when=git cat-file, rev-parse or archive honour refs/replace, so the digest check passes on the replacement's tree; why_new=PR #70 security review; seam=stackTree; no_claim=a partial clone's lazy fetch, which GIT_NO_LAZY_FETCH turns off and this test does not exercise
  test("stackTree installs the commit's own tree, never a replace ref's", () => {
    const repo = scratch("replace");
    writeFileSync(join(repo, "SKILL.md"), "original\n");
    const original = commitAll(repo, "original");
    writeFileSync(join(repo, "SKILL.md"), "replacement\n");
    git(repo, "commit", "-q", "-am", "replacement");
    git(repo, "replace", original, git(repo, "rev-parse", "HEAD"));
    expect(git(repo, "show", original + ":SKILL.md")).toBe("replacement");
    const to = join(scratch("tree"), "t");
    const got = stackTree({ repo: "replace", sha: original }, [repo], to);
    expect(readFileSync(join(to, "SKILL.md"), "utf8")).toBe("original\n");
    expect(got.git_tree).toBe(git(repo, "--no-replace-objects", "rev-parse", original + "^{tree}"));
  });

  // Value: protects=an eval fixture path of any spelling (skill-evals, Skill_Evals) is removed from the tree before its installer runs and never reaches a layer; fails_when=the filter is case-sensitive or exact, or the installer sees the answer key in its checkout; why_new=PR #70 security review; seam=FIXTURE_PATH, installArms; no_claim=fixtures under other names, which buildArmImage drops by their bytes
  test("eval fixture paths of any spelling never reach the installer or a layer", () => {
    expect(["skill-evals", "a/Skill_Evals/b", "SKILLEVAL", "x/skill-eval"].every((p) => FIXTURE_PATH.test(p))).toBe(true);
    expect(["skills", "skill-evaluator", "evals"].some((p) => FIXTURE_PATH.test(p))).toBe(false);
    const root = scratch("decoys");
    cpSync(FAKE_STACK, root, { recursive: true });
    mkdirSync(join(root, "test", "Skill_Evals"), { recursive: true });
    writeFileSync(join(root, "test", "Skill_Evals", "answer.md"), "the answer key\n");
    const sha = commitAll(root, "decoys");
    const command = "if find . -iname '*skill*eval*' | grep -q .; then echo the installer saw an eval fixture >&2; exit 1; fi; " + stackInstall("claude");
    const [arm] = installArms({ host: "claude", arms: [{ name: "after", kind: "stack", stack: { repo: "fake-stack", sha }, install: { claude: command } }], skill: "demo", base: null, sources: [root], runner: localInstaller(scratch("runner")), state: scratch("state") });
    expect(arm!.skill).not.toBeNull();
    for (const [path] of entries(arm!.layers[0]!.src)) expect(path).not.toMatch(/skill[-_]?evals?/i);
  });

  // Value: protects=a --skill that is not a plain name is refused before any path is built from it; fails_when=--skill ../../.. reaches rmSync(join(stage, skill)) and deletes outside the stage directory; why_new=PR #70 security review; seam=resolveArms, installArms; no_claim=none
  test("a --skill that is not a plain name is refused before it touches the filesystem", () => {
    const state = scratch("state");
    writeFileSync(join(state, "keep"), "keep\n");
    expect(stop(() => installArms({ host: "claude", arms: resolved.arms, skill: "../../..", base: resolved.base, sources: [stack.root], runner: localInstaller(scratch("runner")), state }))).toBe("E_USAGE");
    expect(existsSync(join(state, "keep"))).toBe(true);
    expect(resolveArms(["before=" + join(stack.root, "demo"), "after=fake-stack@" + stack.edited], { skill: "../demo" })).toMatchObject({ code: "E_USAGE" });
  });

  // Value: protects=a loose arm cannot pull a file from the build host into its image through a link; fails_when=a loose SKILL.md that is an absolute link, or a relative link out of the folder, is copied and later read through; why_new=PR #70 security review; seam=installArms (loose overlay arm); no_claim=links inside the folder, which are kept
  test("a loose arm holding a link out of its folder is refused", () => {
    const secret = join(scratch("host"), "secret.md");
    writeFileSync(secret, "---\nname: loose\n---\nhost file\n");
    for (const target of [secret, "../" + secret.split("/").slice(-2).join("/")]) {
      const dir = join(scratch("loose"), "loose");
      mkdirSync(dir);
      symlinkSync(target, join(dir, "SKILL.md"));
      expect(stop(() => installArms({ host: "claude", arms: [{ name: "before", kind: "overlay", base: null, skill: "loose", dir }], skill: null, base: null, sources: [], runner: localInstaller(scratch("runner")), state: scratch("state") }))).toBe("E_IMAGE_BUILD");
    }
  });

  for (const host of ["claude", "codex"] as const) {
    // Value: protects=a base arm is the base minus the target skill (one shared layer) plus an overlay holding only what installing its skill folder adds, none is that base layer alone, a stack arm is its own tree, a placebo keeps every skill folder's name with one filler SKILL.md (front matter and routing kept, hooks dropped), and the skill is found where the host reads it (Codex's gstack-<skill> render); no layer holds a skill-evals path, ~/.gstack, ~/.claude.json, an absolute link or an owner-only mode, and only the host config and data dirs are world-writable (1777) so the CLI can keep its state; fails_when=the overlay carries another skill or the base, none keeps the skill, an arm sees another arm's tree, the answer key or volatile state reaches a layer, or the placebo changes the listing; why_new=GST-272 (base, stack and placebo arms on real hosts); seam=installArms, findSkill, overlay, canonicalize; no_claim=gstack's real setup, which the Docker tier and the U11 smoke run
    test("base, none, stack and placebo layers on " + host, () => {
      const arms = byName(install(host));
      const skills = host === "claude" ? ".claude/skills" : ".codex/skills";
      expect(Object.keys(arms)).toEqual(["before", "after", "none", "placebo", "bare"]);
      expect([arms.before!.layers.length, arms.none!.layers.length, arms.after!.layers.length, arms.placebo!.layers.length, arms.bare!.layers.length]).toEqual([2, 1, 1, 1, 0]);
      expect(arms.before!.layers[0]!.src).toBe(arms.none!.layers[0]!.src);
      const overlay = entries(arms.before!.layers[1]!.src).filter(([, kind]) => !kind.startsWith("d:"));
      expect(overlay.map(([path]) => path)).toEqual(host === "claude" ? [".claude/skills/demo/SKILL.md", ".local/share/gstack/demo/SKILL.md"] : [".codex/skills/gstack-demo", ".local/share/gstack/.agents/skills/gstack-demo/SKILL.md", ".local/share/gstack/demo/SKILL.md"]);
      expect(arms.before!.skill!.roots).toEqual(host === "claude" ? [".claude/skills/demo", ".claude/skills/gstack/demo", ".local/share/gstack/demo"] : [".codex/skills/gstack-demo", ".local/share/gstack/.agents/skills/gstack-demo"]);
      expect(readFileSync(arms.before!.skill!.file, "utf8")).toContain("# Demo base");
      expect(readFileSync(arms.after!.skill!.file, "utf8")).toContain("# Demo edited");
      expect(arms.before!.gstack).toBe(skills + "/gstack/bin/gstack-skill-start");
      expect([arms.none!.skill, arms.none!.gstack]).toEqual([null, skills + "/gstack/bin/gstack-skill-start"]);
      expect(entries(arms.none!.layers[0]!.src).some(([path]) => path.includes("demo"))).toBe(false);
      expect([arms.placebo!.gstack, arms.bare!.tree_sha256, arms.bare!.skill]).toEqual([null, "bare:bare", null]);
      expect(new Set(Object.values(arms).map((a) => a.tree_sha256)).size).toBe(5);

      const placebo = entries(arms.placebo!.layers[0]!.src).filter(([, kind]) => !kind.startsWith("d:")).map(([path]) => path);
      expect(placebo).toEqual((host === "claude" ? ["_gstack-command", "demo", "gstack", "other"] : ["gstack", "gstack-demo", "gstack-other"]).map((f) => skills + "/" + f + "/SKILL.md"));
      const text = (f: string) => readFileSync(join(arms.placebo!.layers[0]!.src, skills, f, "SKILL.md"), "utf8");
      const demo = text(host === "claude" ? "demo" : "gstack-demo");
      expect(demo.startsWith("---\nname: demo\ndescription: Demo skill of the fake stack, as the base holds it.\n---\n")).toBe(true);
      expect(demo).not.toContain("Demo base");
      expect(text(host === "claude" ? "other" : "gstack-other")).not.toContain("hooks:");
      expect(text("gstack")).toContain("## Route first\n\n- A request to say hello goes to demo.");
      expect(arms.placebo!.skill!.roots).toEqual([skills + "/" + (host === "claude" ? "demo" : "gstack-demo")]);

      for (const arm of Object.values(arms)) {
        for (const layer of arm.layers) {
          for (const [path, kind] of entries(layer.src)) {
            expect(path).not.toMatch(/skill-evals|^\.gstack|^\.claude\.json/);
            expect(kind).toMatch(/^(l:[^/].*|f:(755|644)|d:(755|1777))$/);
            if (kind === "d:1777") expect(WRITABLE).toContain(path.slice(0, -1));
          }
        }
      }
    });
  }

  // Value: protects=an install is byte-stable, so a rerun from an empty cache gets the same arm trees, and a cached install that no longer hashes to its recorded digest is refused rather than reused; fails_when=volatile state (timestamps, random ids) reaches a layer, or a tampered cache is installed; why_new=GST-272 (the image for a base sha and overlay is byte-identical across builds; retention by digest); seam=installArms, cached; no_claim=Docker image bytes, which the Docker tier checks
  test("installs are byte-stable and a tampered cache is refused", () => {
    const state = scratch("state");
    const first = install("codex", state).map((a) => a.tree_sha256);
    expect(install("codex").map((a) => a.tree_sha256)).toEqual(first);
    const none = byName(install("codex", state)).none!.layers[0]!.src;
    writeFileSync(join(none, ".local", "share", "gstack", "other", "SKILL.md"), "tampered\n");
    expect(stop(() => install("codex", state))).toBe("E_STACK_DIGEST");
  });
});
