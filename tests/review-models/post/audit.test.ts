// Copyright (c) 2026 Garry Tan. MIT License.
// Value: protects=N's read audit finds a gstack file or a drive path in a plain-Opus session from any tool, result or init
// line, and a gstack cell's part-ran check sees every answering model; fails_when=a Glob of a skills folder, a Bash cat of
// a drive file, a quoted SKILL.md path or a gstack skill in init goes unseen, or an unreadable transcript reads clean;
// why_new=GEVA-590 Pilots table (N part ran) and change 2's exposure reading; seam=audit.ts over transcript.ndjson;
// no_claim=that Claude Code always records init's skill list
import { describe, expect, test } from "bun:test";
import { readAudit, sessionModels } from "../../../lanes/review-models/post/audit.ts";

const lines = (...m: unknown[]) => m.map((x) => JSON.stringify(x)).join("\n") + "\n";
const use = (name: string, input: Record<string, unknown>, model = "claude-opus-5-5", parent: string | null = null) => ({ type: "assistant", parent_tool_use_id: parent, message: { model, content: [{ type: "tool_use", id: "t" + Math.random(), name, input }] } });
const result = (text: string) => ({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "x", content: [{ type: "text", text }] }] } });
const init = (skills: string[]) => ({ type: "system", subtype: "init", slash_commands: ["compact"], skills });

describe("N's read audit (keyless)", () => {
  test("a clean plain review passes", () => {
    const a = readAudit(lines(init([]), use("Read", { file_path: "/work/app-12-abcdef12/src/a.ts" }), result("export const a = 1;")));
    expect(a).toEqual({ readable: true, hits: [], clean: true });
  });
  test("every way a session reaches gstack or a drive is a hit", () => {
    const a = readAudit(lines(
      init(["gstack-review"]),
      use("Glob", { pattern: "~/.claude/skills/gstack/**" }),
      use("Bash", { command: "cat $HOME/.capy/drive/notes/AGENTS.md" }, "claude-opus-5-5", "sub1"),
      result("See ~/.claude/skills/gstack/review/SKILL.md for the procedure."),
      result("drive://user/skills/gstack"),
    ));
    expect(a.clean).toBe(false);
    expect(a.hits).toEqual([
      { where: "Glob", pattern: "gstack" },
      { where: "init", pattern: "gstack" },
      { where: "Bash", pattern: "drive" },
      { where: "result", pattern: "gstack skill file" },
      { where: "result", pattern: "drive" },
    ]);
  });
  test("an empty transcript fails the audit", () => {
    expect(readAudit("")).toEqual({ readable: false, hits: [], clean: false });
  });
});

describe("session models (keyless)", () => {
  test("the main agent's and every subagent's model, without Claude Code's synthetic turns", () => {
    const t = lines(use("Read", { file_path: "a" }, "claude-fable-5-2"), use("Read", { file_path: "b" }, "claude-opus-5-5", "spec1"), { type: "assistant", message: { model: "<synthetic>", content: [] } });
    expect(sessionModels(t)).toEqual(["claude-fable-5-2", "claude-opus-5-5"]);
  });
});
