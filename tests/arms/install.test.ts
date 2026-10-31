import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { installArms, InstallError, localInstaller, releaseInstalls, runHold, stackInstall, stackTree, WRITABLE, type ArmInstall, type CacheHold } from "../../src/arms/install.ts";
import { resolveArms, type ResolvedArms } from "../../src/skill-eval/cli/arms.ts";
import { newRunId } from "../../src/skill-eval/cli/call.ts";
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

  // Value: protects=a run deletes only the install entries it built, once no other run holds them (the last holder deletes a shared one), keeps entries it only reused, a resumed run keeps the claim of the run it continues, and a reinstall after the cleanup gives the same arm trees, so --resume keeps its session keys; fails_when=cleanup deletes an entry another run holds or one the run only reused, leaks an entry the run built or its log, or a reinstall changes a tree; why_new=GST-361 (each Lane A call left about 3.6 GB of installs and U11's 65 GB disk filled); seam=installArms' hold, cached, releaseInstalls; no_claim=gstack's real setup (tests/arms/gstack-reinstall.test.ts) and the Docker rig's close and failed start (the Docker tier)
  test("a run deletes the installs it built once no run holds them, and a reinstall gives the same trees", () => {
    const state = scratch("state");
    const hold = (run: string): CacheHold => ({ run, entries: [] });
    const installed = (h?: CacheHold) => installArms({ host: "codex", arms: resolved.arms, skill: "demo", base: resolved.base, sources: [stack.root], runner: localInstaller(scratch("runner")), state, ...(h ? { hold: h } : {}) }).map((a) => a.tree_sha256);
    const left = () => readdirSync(join(state, "installs")).sort();
    const [a, b] = [hold("a"), hold("b")];
    const trees = installed(a);
    const built = left().filter((n) => !n.includes(".")).map((n) => join(state, "installs", n));
    expect(built.length).toBeGreaterThan(3);
    installed(b);
    expect(releaseInstalls(a)).toEqual([]);
    expect(left().filter((n) => !n.includes("."))).toHaveLength(built.length);
    expect(releaseInstalls(b).sort()).toEqual(built);
    expect(left()).toEqual([]);

    expect(installed(hold("c"))).toEqual(trees);
    const resumed = hold("c");
    installed(resumed);
    expect(releaseInstalls(resumed).sort()).toEqual(built);
    expect(left()).toEqual([]);

    installed();
    const warm = left();
    const d = hold("d");
    installed(d);
    expect([releaseInstalls(d), left()]).toEqual([[], warm]);
  });

  // Value: protects=runs that share a state root take holds and decide deletions one at a time under <state>/installs.lock, so a run releasing its entries while another run takes holds on them never deletes one the other holds, and the last holder still deletes them all; fails_when=the last-holder check and the delete, or a new hold, run outside the lock, so a release deletes entries a new run is hashing or using, or a handover strands one; why_new=PR #85 review (install cleanup races); seam=cached, releaseInstalls; no_claim=a caller that passes no hold
  test("a release and new holds on the same entries wait for the lock and never delete a held entry", async () => {
    const state = scratch("state");
    const options = { host: "codex" as const, arms: resolved.arms, skill: "demo", base: resolved.base, sources: [stack.root], state };
    const a = runHold(state, "a");
    installArms({ ...options, runner: localInstaller(scratch("runner")), hold: a });
    const built = [...new Set(a.entries)].sort();
    expect(built.length).toBeGreaterThan(3);
    const scripts = scratch("scripts");
    const lib = join(import.meta.dir, "..", "..", "src", "arms", "install.ts");
    writeFileSync(join(scripts, "lock.ts"), [
      `import { dlopen, FFIType } from "bun:ffi";`,
      `import { existsSync, openSync, writeFileSync } from "node:fs";`,
      `const [lock, ready, go] = process.argv.slice(2);`,
      `const libc = dlopen(process.platform === "darwin" ? "libc.dylib" : "libc.so.6", { flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 } });`,
      `if (libc.symbols.flock(openSync(lock!, "a"), 2) !== 0) process.exit(2);`,
      `writeFileSync(ready!, "");`,
      `while (!existsSync(go!)) Bun.sleepSync(20);`,
    ].join("\n"));
    writeFileSync(join(scripts, "release.ts"), `import { writeFileSync } from "node:fs";\nimport { releaseInstalls } from ${JSON.stringify(lib)};\nwriteFileSync(process.argv[3]!, "");\nreleaseInstalls(JSON.parse(process.argv[2]!));\n`);
    writeFileSync(join(scripts, "take.ts"), [
      `import { existsSync, writeFileSync } from "node:fs";`,
      `import { installArms, localInstaller, runHold } from ${JSON.stringify(lib)};`,
      `const options = JSON.parse(process.argv[2]!);`,
      `writeFileSync(process.argv[4]!, "");`,
      `const arms = installArms({ ...options, runner: localInstaller(process.argv[3]!), hold: runHold(options.state, "b") });`,
      `console.log(JSON.stringify(arms.flatMap((arm) => arm.layers.map((layer) => layer.src)).filter((src) => !existsSync(src))));`,
    ].join("\n"));
    const [ready, go, releasing, taking] = ["ready", "go", "releasing", "taking"].map((name) => join(scripts, name));
    const lock = Bun.spawn([process.execPath, join(scripts, "lock.ts"), join(state, "installs.lock"), ready, go!]);
    while (!existsSync(ready!)) await Bun.sleep(20);
    const release = Bun.spawn([process.execPath, join(scripts, "release.ts"), JSON.stringify(a), releasing!]);
    const take = Bun.spawn([process.execPath, join(scripts, "take.ts"), JSON.stringify(options), scratch("runner"), taking!], { stdout: "pipe" });
    while (!existsSync(releasing!) || !existsSync(taking!)) await Bun.sleep(20);
    // gstack-timing-ok: both children have started, and without the lock the release finishes in milliseconds; with it they wait until go, however long this takes
    await Bun.sleep(1000);
    expect([release.exitCode, take.exitCode]).toEqual([null, null]);
    expect(built.filter((dir) => !existsSync(join(dir, "install.json")) || existsSync(join(dir + ".holds", "b")))).toEqual([]);
    writeFileSync(go!, "");
    expect([await lock.exited, await release.exited, await take.exited]).toEqual([0, 0, 0]);
    expect(JSON.parse(await new Response(take.stdout).text())).toEqual([]);
    const b = runHold(state, "b");
    expect(b.entries).toEqual(built);
    expect(releaseInstalls(b).sort()).toEqual(built);
    expect(readdirSync(join(state, "installs"))).toEqual([]);
  }, 60_000);

  // Value: protects=a run that builds an entry another run commits first drops its own build, reuses the winner's entry and keeps a used hold, so its release deletes nothing and the winner's release deletes the entry; fails_when=the losing run returns its deleted build, marks its hold built, or its release deletes an entry the winner still holds; why_new=PR #85 /ship review (cached()'s lost commit race was untested); seam=cached, releaseInstalls; no_claim=two processes racing, which the lock test covers
  test("a run that loses the commit race reuses the winner's entry and keeps a used hold", () => {
    const state = scratch("state");
    const options = { host: "codex" as const, arms: resolved.arms.filter((a) => a.name === "after"), skill: "demo", base: null, sources: [stack.root], state };
    const runner = localInstaller(scratch("runner"));
    const [winner, loser] = [runHold(state, "winner"), runHold(state, "loser")];
    let raced = false;
    const racing = {
      ...runner,
      run(src: string, o: Parameters<typeof runner.run>[1]) {
        const failed = runner.run(src, o);
        if (!raced) {
          raced = true;
          installArms({ ...options, runner: localInstaller(scratch("runner")), hold: winner });
        }
        return failed;
      },
    };
    const [arm] = installArms({ ...options, runner: racing, hold: loser }) as [ArmInstall];
    const entry = dirname(arm.layers[0]!.src);
    expect([raced, readFileSync(join(entry + ".holds", "loser"), "utf8"), readFileSync(join(entry + ".holds", "winner"), "utf8")]).toEqual([true, "used\n", "built\n"]);
    expect(arm.layers.filter((l) => !existsSync(l.src))).toEqual([]);
    expect(releaseInstalls(loser)).toEqual([]);
    expect(releaseInstalls(winner)).toEqual([entry]);
  });

  // Value: protects=a resumed run takes over every hold of the run it continues, so it deletes the entries that run built even when an arm changed before the resume and its old entry is no longer used; fails_when=the resumed run's hold starts empty, so the dead run's holds and installs outlive the resume and block every later run from deleting them; why_new=PR #85 review (resumed holds stranded); seam=runHold, cached, releaseInstalls; no_claim=a run that dies and is never resumed, whose holds keep its entries until --resume
  test("a resumed run takes over the holds of the run it continues, entries its changed arms no longer use included", () => {
    const state = scratch("state");
    const dir = join(scratch("loose"), "loose");
    mkdirSync(dir);
    writeFileSync(join(dir, "SKILL.md"), "---\nname: loose\n---\nfirst\n");
    const installed = (hold: CacheHold) => installArms({ host: "claude", arms: [{ name: "before", kind: "overlay", base: null, skill: "loose", dir }], skill: null, base: null, sources: [], runner: localInstaller(scratch("runner")), state, hold });
    const crashed = runHold(state, "r");
    expect(crashed.entries).toEqual([]);
    installed(crashed);
    writeFileSync(join(dir, "SKILL.md"), "---\nname: loose\n---\nedited before the resume\n");
    const resumed = runHold(state, "r");
    expect(resumed.entries).toEqual(crashed.entries);
    installed(resumed);
    const entries = [...new Set(resumed.entries)].sort();
    expect(entries).toHaveLength(2);
    expect(releaseInstalls(resumed).sort()).toEqual(entries);
    expect(readdirSync(join(state, "installs"))).toEqual([]);
  });

  const looseArms = (name: string) => {
    const dir = join(scratch("loose"), "loose");
    mkdirSync(dir);
    writeFileSync(join(dir, "SKILL.md"), "---\nname: loose\n---\n" + name + "\n");
    return [{ name: "before", kind: "overlay" as const, base: null, skill: "loose", dir }];
  };

  // Value: protects=a run that only reused an entry keeps it on release and leaves the builder's built claim, and a resumed run that took over such a hold deletes nothing; fails_when=a release by a run that only reused an entry deletes it or moves the builder's claim, or a resumed run's used hold turns into a delete; why_new=PR #85 /ship state-machine review (used x release-shared and used x resume-release untested); seam=runHold, cached, releaseInstalls; no_claim=concurrent runs (the lock test)
  test("a run that only reused an entry keeps it and the builder's claim, on release and after a resume", () => {
    const state = scratch("state");
    const arms = looseArms("reused");
    const installed = (hold?: CacheHold) => installArms({ host: "claude", arms, skill: null, base: null, sources: [], runner: localInstaller(scratch("runner")), state, ...(hold ? { hold } : {}) });
    const x = runHold(state, "x");
    installed(x);
    const entry = x.entries[0]!;
    const y = runHold(state, "y");
    installed(y);
    expect(releaseInstalls(y)).toEqual([]);
    expect([existsSync(join(entry, "install.json")), readFileSync(join(entry + ".holds", "x"), "utf8")]).toEqual([true, "built\n"]);
    expect(releaseInstalls(x)).toEqual([entry]);
    installed();
    const warm = readdirSync(join(state, "installs")).sort();
    installed(runHold(state, "r"));
    const resumed = runHold(state, "r");
    expect(resumed.entries).toEqual([entry]);
    installed(resumed);
    expect([releaseInstalls(resumed), readdirSync(join(state, "installs")).sort()]).toEqual([[], warm]);
  });

  // Value: protects=a release that fails before its entry is gone keeps the run's hold, so --resume can still release the entry; fails_when=the hold is dropped before the rename, so a failed or killed release leaves an entry nobody deletes; why_new=PR #85 review (crash window in releaseInstalls); seam=releaseInstalls, runHold; no_claim=root, whom chmod does not stop
  test.skipIf(process.getuid?.() === 0)("a release that fails keeps its hold, so --resume can still release the entry", () => {
    const state = scratch("state");
    const arms = looseArms("failed release");
    const hold = runHold(state, "r");
    installArms({ host: "claude", arms, skill: null, base: null, sources: [], runner: localInstaller(scratch("runner")), state, hold });
    chmodSync(join(state, "installs"), 0o555);
    try {
      expect(() => releaseInstalls(hold)).toThrow();
    } finally {
      chmodSync(join(state, "installs"), 0o755);
    }
    const resumed = runHold(state, "r");
    expect(resumed.entries).toEqual(hold.entries);
    expect(releaseInstalls(resumed)).toEqual(hold.entries);
  });

  // Value: protects=a run id that is not a plain name (a tampered run.json on --resume) is refused before a hold path is built from it, and every id newRunId makes for a fresh run is accepted; fails_when=runHold joins ../ segments or a non-string into a hold path and releaseInstalls deletes or writes outside the state root, or a fresh run whose label has no ASCII letter is refused; why_new=PR #85 /ship security and red-team review; seam=runHold, newRunId; no_claim=none
  test("a run id that is not a plain name is refused before a hold path is built from it", () => {
    const root = scratch("hold");
    const state = join(root, "state");
    mkdirSync(join(state, "installs", "entry.holds"), { recursive: true });
    writeFileSync(join(root, "canary"), "keep\n");
    for (const run of ["../../../canary", "..", ".", "a/b", "", null, 123, ["ok"]]) expect(stop(() => runHold(state, run as string))).toBe("E_USAGE");
    expect(readFileSync(join(root, "canary"), "utf8")).toBe("keep\n");
    for (const label of ["demo", "", "_", "評価"]) expect(runHold(state, newRunId(label)).entries).toEqual([]);
  });
});
