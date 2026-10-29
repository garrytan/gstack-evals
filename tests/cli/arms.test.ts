import { describe, expect, test } from "bun:test";
import { mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { resolveArms, type ResolvedArms } from "../../src/skill-eval/cli/arms.ts";
import { commitAll, gstackRoot, SKILL_MD, TMP, tree } from "./helpers.ts";

const SHA = "a".repeat(40);
const NO_HOME = tree({ ".keep": "" });
const ok = (spec: string[], flags: { base?: string; skill?: string } = {}, home = NO_HOME): ResolvedArms => {
  const r = resolveArms(spec, flags, home);
  if ("code" in r) throw new Error(r.code + " " + r.message);
  return r;
};
const fail = (spec: string[], flags: { base?: string; skill?: string } = {}, home = NO_HOME) => {
  const r = resolveArms(spec, flags, home);
  if (!("code" in r)) throw new Error("resolved");
  return r;
};

describe("the arm grammar", () => {
  // Value: protects=loose folders without gstack calls run as skill-diet runs them, none is bare without a base, and arms come back in canonical order; fails_when=order, kinds or the bare none change; why_new=new grammar; seam=none; no_claim=none beyond protects
  test("loose folders resolve to base-less overlays, none to bare, in canonical order", () => {
    const loose = tree({ "SKILL.md": "# demo\n\nNEVER guess.\n" });
    const r = ok(["none", "after=" + loose, "before=" + loose, "placebo"]);
    expect(r.arms.map((a) => a.name)).toEqual(["before", "after", "none", "placebo"]);
    expect(r.arms[0]).toMatchObject({ kind: "overlay", base: null, dir: loose });
    expect(r.arms[2]).toEqual({ name: "none", kind: "bare" });
    expect(r.arms[3]).toEqual({ name: "placebo", kind: "placebo", of: "before" });
    expect(r.base).toBeNull();
  });

  // Value: protects=the grammar refuses what the interface does not allow; fails_when=a missing after, a repeated or unknown arm, before2, a valued none, a folder without SKILL.md, a short sha or bare without base passes; why_new=new; seam=none; no_claim=none beyond protects
  test("it refuses malformed arms with E_USAGE", () => {
    const loose = tree({ "SKILL.md": "# demo\n" });
    const cases: [string[], string][] = [
      [["before=" + loose], "after=<spec> is required"],
      [["before=" + loose, "before=" + loose, "after=" + loose], "before given twice"],
      [["before=" + loose, "after=" + loose, "before2=" + loose], "before2 is the noise floor"],
      [["before=" + loose, "after=" + loose, "middle=" + loose], "unknown arm"],
      [["before=" + loose, "after=" + loose, "none=x"], "none takes no value"],
      [["before=" + TMP, "after=" + loose], "holds no SKILL.md"],
      [["before=gstack@abc123", "after=" + loose], "needs the full 40-character commit sha"],
      [["before=" + loose, "after=" + loose, "bare"], "bare (no gstack) needs a base"],
      [["before=gstack@" + SHA, "after=" + loose], "needs --skill"],
    ];
    for (const [spec, text] of cases) expect([spec.join(","), fail(spec)]).toEqual([spec.join(","), { code: "E_USAGE", message: expect.stringContaining(text) }]);
  });

  // Value: protects=an explicit base makes before and after overlays on it, none the base minus the skill, and allows bare; fails_when=--base without --skill passes or none keeps the skill; why_new=new; seam=none; no_claim=how U9 installs the overlay
  test("--base with --skill overlays the arms, makes none the base minus the skill, and allows bare", () => {
    const loose = tree({ "SKILL.md": SKILL_MD("learn") });
    expect(fail(["before=" + loose, "after=" + loose], { base: "gstack@" + SHA })).toMatchObject({ code: "E_USAGE", message: expect.stringContaining("--base needs --skill") });
    const r = ok(["before=" + loose, "after=" + loose, "none", "bare"], { base: "gstack@" + SHA, skill: "learn" });
    expect(r.base).toEqual({ ref: { repo: "gstack", sha: SHA }, source: "--base", root: null });
    expect(r.arms.find((a) => a.name === "none")).toEqual({ name: "none", kind: "overlay", base: { repo: "gstack", sha: SHA }, skill: "learn", dir: null });
    expect(r.arms.find((a) => a.name === "bare")).toEqual({ name: "bare", kind: "bare" });
    expect(ok(["before=gstack@" + SHA, "after=" + loose], { base: "gstack@" + SHA, skill: "learn" }).arms[0]).toEqual({ name: "before", kind: "stack", stack: { repo: "gstack", sha: SHA }, install: {} });
  });

  // Value: protects=base inference for rendered gstack folders, read from before first; fails_when=a rendered folder is treated as loose, the sha is not HEAD, or after's root overrides before's; why_new=interface v0.4's new inference; seam=git rev-parse; no_claim=none beyond protects
  test("a rendered gstack skill folder infers --base gstack@HEAD and --skill, before's root first", () => {
    const old = gstackRoot("learn");
    const oldSha = commitAll(old);
    const now = gstackRoot("learn", { "bin/gstack-learnings-search": "#!/bin/sh\n" });
    const nowSha = commitAll(now);
    const r = ok(["before=" + join(old, "learn"), "after=" + join(now, "learn"), "none"]);
    expect(r.base).toEqual({ ref: { repo: "gstack", sha: oldSha }, source: "inferred from before (" + old + ")", root: old });
    expect(r.skill).toEqual({ name: "learn", source: "inferred from before" });
    expect(r.notes).toEqual(["after comes from " + now + " at " + nowSha.slice(0, 12) + ": it is overlaid on the base, so only its learn/ folder is measured"]);
    expect(r.arms.find((a) => a.name === "none")).toMatchObject({ kind: "overlay", dir: null, skill: "learn" });
    const loose = tree({ "SKILL.md": SKILL_MD("learn") });
    expect(ok(["before=" + loose, "after=" + join(now, "learn")]).base?.source).toBe("inferred from after (" + now + ")");
    expect(ok(["before=" + join(old, "learn"), "after=" + loose], { base: "gstack@" + SHA, skill: "learn" }).base?.source).toBe("--base");
    expect(fail(["before=" + join(old, "learn"), "after=" + loose], { skill: "write-skill" })).toMatchObject({ code: "E_USAGE", message: expect.stringContaining("does not match the rendered skill folder") });
  });

  // Value: protects=the narrowed E_LOOSE_GSTACK fires only for a loose folder calling gstack bins with no resolvable root, and its fix carries resolved values; fails_when=a folder without gstack calls is refused, or the fix prints a placeholder instead of the found checkout's sha; why_new=interface v0.4 narrowed the code; seam=the gstack checkouts under the home dir; no_claim=none beyond protects
  test("a loose folder that calls gstack bins is E_LOOSE_GSTACK, with the found checkout's sha or the clone command", () => {
    const loose = tree({ "SKILL.md": SKILL_MD("learn") });
    const none = fail(["before=" + loose, "after=" + loose]);
    expect(none.code).toBe("E_LOOSE_GSTACK");
    expect(none.message).toContain("calls gstack bins, but no gstack root holds it");
    expect(none.fix).toContain("git clone https://github.com/garrytan/gstack.git ~/.local/share/gstack");
    expect(none.fix).toContain("--skill learn");
    expect(none.fix).not.toMatch(/<sha>|<name>/);
    const home = tree({ ".keep": "" });
    const installed = gstackRoot("learn");
    const sha = commitAll(installed);
    mkdirSync(join(home, ".local", "share"), { recursive: true });
    renameSync(installed, join(home, ".local", "share", "gstack"));
    const found = fail(["before=" + loose, "after=" + loose], {}, home);
    expect(found.fix).toContain("Pass --base gstack@" + sha + " --skill learn (the gstack checkout at " + join(home, ".local", "share", "gstack") + ")");
    const unrendered = gstackRoot("learn");
    expect(fail(["before=" + join(unrendered, "learn"), "after=" + loose])).toMatchObject({ code: "E_LOOSE_GSTACK", message: expect.stringContaining("has no git commit") });
  });
});
