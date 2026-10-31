import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { inRoots, touches, touchRule, treePath } from "../../lanes/review-noloss/flag-scan.ts";
import { loadSuite, REPO_ROOT } from "../../lanes/review-noloss/suite.ts";
import { cleanup, run, tmp } from "./helpers.ts";

afterAll(cleanup);
const H = "/home/agent";
const U3593 = "garrytan/gstack#3593@89156431975e";
const U3596 = "garrytan/gstack#3596@0be7c3d44339";
const U3516 = "garrytan/gstack#3516@ee73419c3295";
const call = (name: string, input: Record<string, unknown>, id = "c1") => JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id, name, input }] } });

describe("noloss flag-scan: the frozen contamination rules", () => {
  test("paths map into each arm's roots, and ~/.claude/skills/<name>/ maps to gstack's <name>/", () => {
    expect(treePath("gstack", H + "/.local/share/gstack/lib/a.ts")).toBe("lib/a.ts");
    expect(treePath("gstack", H + "/.claude/skills/gstack/lib/a.ts")).toBe("lib/a.ts");
    expect(treePath("gstack", H + "/.claude/skills/review/SKILL.md")).toBe("review/SKILL.md");
    expect(treePath("gstack", H + "/.claude/skills")).toBe("");
    expect(treePath("gstack", "/work/t1/lib/a.ts")).toBe(null);
    expect(treePath("none", H + "/.local/share/gstack/lib/a.ts")).toBe(null);
  });

  test("Bash words expand the home and follow cd; listings and reads are told apart from recursive searches", () => {
    expect(touches("Bash", { command: "cd ~/.local/share/gstack && cat lib/a.ts" }, "/work/t").paths.map((p) => p.path)).toEqual([H + "/.local/share/gstack/lib/a.ts", H + "/.local/share/gstack"]);
    expect(touches("Bash", { command: "grep -rn foo $HOME/.claude/skills/" }, "/work/t").paths).toEqual([{ path: H + "/.claude/skills", reach: "tree", list: false }]);
    expect(touches("Bash", { command: "ls ${HOME}/.claude/skills/review" }, "/work/t").paths).toEqual([{ path: H + "/.claude/skills/review", reach: "entries", list: true }]);
    expect(touches("Bash", { command: "ls -laR ~/x && find ~/y -name z && tree ~/w" }, "/work/t").paths.map((p) => p.reach + " " + p.list)).toEqual(["tree true", "tree true", "tree true"]);
    expect(touches("Glob", { pattern: "**/*.md", path: H + "/.claude/skills" }, "/work/t").paths).toEqual([{ path: H + "/.claude/skills/**/*.md", reach: "path", list: true }]);
    expect(touches("LS", { path: H + "/.claude/skills/review" }, "/work/t").paths).toEqual([{ path: H + "/.claude/skills/review", reach: "entries", list: true }]);
    expect(touches("Skill", { skill: "pstack:interrogate" }, "/work/t").paths[0]!.path).toBe(H + "/.local/share/pstack/skills/interrogate/SKILL.md");
  });

  test("a bare cd goes home, a recursive call from above a root reaches into it, and a glob matches the files it names", () => {
    expect(touches("Bash", { command: "cd && cat .local/share/gstack/lib/a.ts" }, "/work/t").paths.map((p) => p.path)).toEqual([H + "/.local/share/gstack/lib/a.ts", H]);
    expect(touches("Bash", { command: "cd ~/.local/share/gstack && ls -la docs" }, "/work/t").paths.map((p) => p.reach)).toEqual(["entries", "path"]);
    expect(touches("Bash", { command: "cd ~/.local/share/gstack && ls -la" }, "/work/t").paths).toEqual([{ path: H + "/.local/share/gstack", reach: "entries", list: true }]);
    expect(touches("Bash", { command: "cd ~/.local/share/gstack && find -name '*.md'" }, "/work/t").paths.map((p) => p.reach)).toEqual(["tree", "tree"]);
    const grep = touches("Bash", { command: "grep -rn 4321 ~/.claude" }, "/work/t").paths[0]!;
    expect([inRoots("gstack", grep), inRoots("tstack", grep), inRoots("pstack", grep)]).toEqual([true, true, false]);
    expect(inRoots("pstack", touches("Grep", { pattern: "4321", path: "~" }, "/work/t").paths[0]!)).toBe(true);
    expect(inRoots("gstack", touches("Bash", { command: "ls ~/.claude" }, "/work/t").paths[0]!)).toBe(false);
    expect(inRoots("gstack", touches("Bash", { command: "cat ~/.claude/*/review/SKILL.md" }, "/work/t").paths[0]!)).toBe(true);
    expect(touchRule(grep)(H + "/.claude/skills/gstack/lib/a.ts")).toBe("recursive");
    const glob = touchRule(touches("Bash", { command: "cat ~/.claude/skills/gstack/*/a.ts" }, "/work/t").paths[0]!);
    expect([glob(H + "/.claude/skills/gstack/lib/a.ts"), glob(H + "/.claude/skills/gstack/lib/sub/a.ts")]).toEqual(["read", null]);
    const ls = touchRule(touches("Bash", { command: "ls ~/.local/share/gstack/lib" }, "/work/t").paths[0]!);
    expect([ls(H + "/.local/share/gstack/lib/a.ts"), ls(H + "/.local/share/gstack/lib/sub/a.ts"), ls(H + "/.local/share/gstack/lib")]).toEqual(["list", null, "list"]);
    expect(touchRule(touches("Glob", { pattern: "**/a.ts", path: H + "/.local/share/gstack" }, "/work/t").paths[0]!)(H + "/.local/share/gstack/lib/sub/a.ts")).toBe("list");
  });

  test("a review-units out dir: read, cd, recursive, list, search, told and missing-transcript flags, and none for a listing that does not show the file", async () => {
    const dir = tmp("noloss-flags-");
    const run_ = join(dir, "run");
    const session = (model: string, arm: string, task: string, pass: number, lines: string[] | null) => {
      const d = join(run_, "runs", model, arm, task, "p" + pass, "host");
      mkdirSync(d, { recursive: true });
      if (lines) writeFileSync(join(d, "transcript.ndjson"), lines.join("\n") + "\n");
    };
    writeFileSync(join(dir, "audit.tsv"), ["unit\tarm\trule\tpath\tdetail", U3593 + "\tgstack\tdiff-path\tlib/ship-budget.ts\tdiffers from the unit head", U3596 + "\tgstack\tmention\tdocs/notes.md:12\t#3596", U3516 + "\tgstack\tdiff-path\treview/SKILL.md\tdiffers from the unit head"].join("\n") + "\n");
    mkdirSync(run_, { recursive: true });
    writeFileSync(join(run_, "units.json"), JSON.stringify({ units: [{ id: U3593, task: "t3593" }, { id: U3596, task: "t3596" }, { id: U3516, task: "t3516" }] }));
    const M = "anthropic_claude-opus-5-5";
    session(M, "gstack", "t3593", 1, [call("Read", { file_path: H + "/.local/share/gstack/lib/ship-budget.ts" })]);
    session(M, "gstack", "t3593", 2, [call("Bash", { command: "cd ~/.claude/skills/gstack && sed -n 1,40p lib/ship-budget.ts" })]);
    session(M, "gstack", "t3593", 3, [call("Read", { file_path: "/work/t3593/lib/ship-budget.ts" }), call("Bash", { command: "ls ~/.local/share/gstack/lib" }, "c2")]);
    session(M, "gstack", "t3593", 4, [call("Bash", { command: "ls ~/.claude ~/.claude/skills ~/.local/share/gstack" })]);
    session(M, "gstack", "t3593", 5, [call("Bash", { command: "grep -rn budget ~/.claude" })]);
    session(M, "gstack", "t3593", 6, [call("Bash", { command: "cd && cat .local/share/gstack/lib/ship-budget.ts" })]);
    session(M, "gstack", "t3593", 7, [call("Bash", { command: "head -5 ~/.claude/skills/gstack/*/ship-budget.ts" })]);
    session(M, "gstack", "t3593", 8, [call("Glob", { pattern: "**/ship-budget.ts", path: H + "/.local/share/gstack" })]);
    session(M, "gstack", "t3596", 1, [call("Bash", { command: "grep -rn budget ~/.local/share/gstack" })]);
    session(M, "gstack", "t3596", 2, [call("Grep", { pattern: "#3596", path: H + "/.claude/skills/gstack/bin" })]);
    session(M, "gstack", "t3596", 3, null);
    session(M, "gstack", "t3596", 4, [call("Grep", { pattern: "3596", path: H })]);
    session(M, "gstack", "t3596", 5, [call("Bash", { command: "find ~ -name notes.md" })]);
    session(M, "gstack", "t3516", 1, []);
    session(M, "pstack", "t3593", 1, [call("Bash", { command: "grep -r 3593 ~/.local/share/pstack" })]);
    session(M, "pstack", "t3596", 1, [call("Read", { file_path: H + "/.local/share/gstack/docs/notes.md" })]);
    session(M, "none", "t3593", 1, [call("Read", { file_path: H + "/.local/share/gstack/lib/ship-budget.ts" })]);
    const out = join(dir, "flags.tsv");
    const r = await run(["flag-scan", "--suite", "gsta167-14pr", "--run", run_, "--audit", join(dir, "audit.tsv"), "--out", out]);
    expect(r.code).toBe(0);
    const rows = readFileSync(out, "utf8").trim().split("\n").slice(1).map((l) => l.split("\t"));
    const got = rows.map(([unit, arm, , pass, rule, tool]) => [unit!.split("#")[1]!.slice(0, 4), arm, pass, rule, tool].join(" ")).sort();
    expect(got).toEqual(["3516 gstack 1 read Skill", "3593 gstack 1 read Read", "3593 gstack 2 read Bash", "3593 gstack 3 list Bash", "3593 gstack 5 recursive Bash", "3593 gstack 6 read Bash", "3593 gstack 7 read Bash", "3593 gstack 8 list Glob", "3593 pstack 1 search Bash", "3596 gstack 1 recursive Bash", "3596 gstack 2 search Grep", "3596 gstack 3 no-transcript ", "3596 gstack 4 recursive Grep", "3596 gstack 4 search Grep", "3596 gstack 5 list Bash"].sort());
    expect(r.out).toContain("flag-scan gstack: 14 sessions, 13 unit-passes flagged on 3 units");
    expect(r.out).toContain("flag-scan pstack: 2 sessions, 1 unit-passes flagged on 1 units");
    const d = await run(["derive", "--suite", "gsta167-14pr", "--comparisons", join(import.meta.dir, "..", "..", "lanes/review-noloss/comparisons/gsta167-14pr.json"), "--root", join(import.meta.dir, "..", "..", "lanes/review-noloss/arms"), "--id", "gsta167-nf", "--out", join(dir, "nf"), "--drop-file", out]);
    expect([d.code, d.out]).toEqual([0, expect.stringContaining("11 units, 23 blocking blockers on 11 PRs; 3 units dropped")]);
  });

  test("a blocker whose case does not load fails the scan, and a sealed suite's flags never land in the repo", async () => {
    const dir = tmp("noloss-flags-refuse-");
    const run_ = join(dir, "run");
    mkdirSync(run_, { recursive: true });
    writeFileSync(join(run_, "units.json"), JSON.stringify({ units: [{ id: U3593, task: "t3593" }] }));
    writeFileSync(join(dir, "audit.tsv"), "unit\tarm\trule\tpath\tdetail\n" + U3593 + "\tgstack\tdiff-path\tlib/ship-budget.ts\tdiffers\n");
    const base = loadSuite("gsta167-14pr").suite;
    const suite = (name: string, value: unknown) => {
      writeFileSync(join(dir, name), JSON.stringify(value));
      return join(dir, name);
    };
    const lost = suite("lost.json", { ...base, units: base.units.map((u, i) => (i ? u : { ...u, blockers: u.blockers.map((b, j) => (j ? b : { ...b, case: "no-such-case" })) })) });
    const r = await run(["flag-scan", "--suite", lost, "--run", run_, "--audit", join(dir, "audit.tsv")]);
    expect([r.code, r.err]).toEqual([2, expect.stringMatching(/^E_NOLOSS_SUITE .*\(case no-such-case\) is in none of /s)]);
    const out = join(REPO_ROOT, ".flag-scan-sealed-test.tsv");
    const sealed = await run(["flag-scan", "--suite", suite("sealed.json", { ...base, sealed: true }), "--run", run_, "--audit", join(dir, "audit.tsv"), "--out", out]);
    expect([sealed.code, sealed.err, existsSync(out)]).toEqual([2, expect.stringMatching(/^E_USAGE .*is sealed, and --out .* is inside the repo/), false]);
  });
});
