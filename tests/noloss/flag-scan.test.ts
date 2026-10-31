import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { touches, treePath } from "../../lanes/review-noloss/flag-scan.ts";
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
    expect(touches("Bash", { command: "grep -rn foo $HOME/.claude/skills" }, "/work/t").paths).toEqual([{ path: H + "/.claude/skills", recursive: true }]);
    expect(touches("Bash", { command: "ls ${HOME}/.claude/skills/review" }, "/work/t").paths).toEqual([{ path: H + "/.claude/skills/review", recursive: false }]);
    expect(touches("Glob", { pattern: "**/*.md", path: H + "/.claude/skills" }, "/work/t").paths).toEqual([{ path: H + "/.claude/skills", recursive: false }]);
    expect(touches("Skill", { skill: "pstack:interrogate" }, "/work/t").paths[0]!.path).toBe(H + "/.local/share/pstack/skills/interrogate/SKILL.md");
  });

  test("a review-units out dir: read, cd, recursive, search, told and missing-transcript flags, and nothing for listings", async () => {
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
    session(M, "gstack", "t3596", 1, [call("Bash", { command: "grep -rn budget ~/.local/share/gstack" })]);
    session(M, "gstack", "t3596", 2, [call("Grep", { pattern: "#3596", path: H + "/.claude/skills/gstack/bin" })]);
    session(M, "gstack", "t3596", 3, null);
    session(M, "gstack", "t3516", 1, []);
    session(M, "pstack", "t3593", 1, [call("Bash", { command: "grep -r 3593 ~/.local/share/pstack" })]);
    session(M, "pstack", "t3596", 1, [call("Read", { file_path: H + "/.local/share/gstack/docs/notes.md" })]);
    session(M, "none", "t3593", 1, [call("Read", { file_path: H + "/.local/share/gstack/lib/ship-budget.ts" })]);
    const out = join(dir, "flags.tsv");
    const r = await run(["flag-scan", "--suite", "gsta167-14pr", "--run", run_, "--audit", join(dir, "audit.tsv"), "--out", out]);
    expect(r.code).toBe(0);
    const rows = readFileSync(out, "utf8").trim().split("\n").slice(1).map((l) => l.split("\t"));
    const got = rows.map(([unit, arm, , pass, rule, tool]) => [unit!.split("#")[1]!.slice(0, 4), arm, pass, rule, tool].join(" ")).sort();
    expect(got).toEqual(["3516 gstack 1 read Skill", "3593 gstack 1 read Read", "3593 gstack 2 read Bash", "3593 pstack 1 search Bash", "3596 gstack 1 recursive Bash", "3596 gstack 2 search Grep", "3596 gstack 3 no-transcript "].sort());
    expect(r.out).toContain("flag-scan gstack: 7 sessions, 6 unit-passes flagged on 3 units");
    expect(r.out).toContain("flag-scan pstack: 2 sessions, 1 unit-passes flagged on 1 units");
    const d = await run(["derive", "--suite", "gsta167-14pr", "--comparisons", join(import.meta.dir, "..", "..", "lanes/review-noloss/comparisons/gsta167-14pr.json"), "--root", join(import.meta.dir, "..", "..", "lanes/review-noloss/arms"), "--id", "gsta167-nf", "--out", join(dir, "nf"), "--drop-file", out]);
    expect([d.code, d.out]).toEqual([0, expect.stringContaining("11 units, 23 blocking blockers on 11 PRs; 3 units dropped")]);
  });
});
