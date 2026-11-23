// Copyright (c) 2026 Garry Tan. MIT License.
// The Codex rollout reader (src/scoring/codex-transcript.ts) on real Codex 0.170.0 rollouts written against a stub model
// (fixtures/codex/README.md): each session read into the SDK record shape gives detect() the same followed reading as the
// same session written as Claude Code tool calls, a code-mode cell's commands reach the stream, a failed patch writes
// nothing, a background run is seen where write_stdin reads it, and items the reader can't read are counted.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { detect, type Detection } from "../../lanes/delivery-route/detect.ts";
import { parseLog, type Rec } from "../../quick/laneb/l1/probes.ts";
import { codexTranscript, readCodexSessions } from "../../src/scoring/codex-transcript.ts";
import { walkRollouts } from "./codex-fixtures.ts";

const FX = join(import.meta.dir, "fixtures", "codex");
const patchOf = (name: string) => readFileSync(join(FX, name, "final.patch"), "utf8");
const codex = (name: string) => readCodexSessions(join(FX, name));

type Step = { name: string; input: Record<string, unknown>; result: string; error?: boolean };
function claude(steps: Step[]): Rec[] {
  const lines: object[] = [{ type: "SystemMessage", subtype: "init", init: { cwd: "/testbed", tools: ["Bash", "Read", "Write", "Edit"], skills: [] } }];
  steps.forEach((s, i) => {
    lines.push({ type: "AssistantMessage", content: [{ id: "t" + i, name: s.name, input: s.input }] });
    lines.push({ type: "UserMessage", content: [{ tool_use_id: "t" + i, content: s.result, is_error: s.error ?? false }] });
  });
  return parseLog(lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
}
const TEST_BODY = "from pkg.mod import add\n\n\ndef test_add():\n    assert add(2, 3) == 5\n";
const HEREDOC = "mkdir -p tests && cat > tests/test_mod.py <<'EOF'\n" + TEST_BODY + "EOF";
const RUN = "python -m pytest -q tests/test_mod.py";
const SED = "sed -i 's/a - b  # sum/a + b  # sum/' pkg/mod.py";
const FAIL = "F                                                                        [100%]\n=================================== FAILURES ===================================\ntests/test_mod.py:5: AssertionError\n=========================== short test summary info ============================\nFAILED tests/test_mod.py::test_add - assert -1 == 5\n1 failed in 0.01s\n";
const PASS = ".                                                                        [100%]\n1 passed in 0.00s\n";
const bash = (command: string, result: string, error = false): Step => ({ name: "Bash", input: { command }, result: (error ? "Exit code 1\n" : "") + result, error });
const writeTool = (path: string, content = TEST_BODY): Step => ({ name: "Write", input: { file_path: path, content }, result: "File created successfully at: " + path });
const editTool = (path: string): Step => ({ name: "Edit", input: { file_path: path, old_string: "a - b", new_string: "a + b" }, result: "The file " + path + " has been updated successfully." });
const fields = (d: Detection) => ({ followed: d.followed, followed_b2: d.followed_b2, followed_as_merged: d.followed_as_merged, followed_tool_only: d.followed_tool_only, test_before_source: d.test_before_source, failing_before_source: d.failing_before_source, passing_after_source: d.passing_after_source, fix_files: d.fix_files, unread_background: d.unread_background, unresolved_writes: d.unresolved_writes });
const read = (recs: Rec[], patch: string) => fields(detect(recs, patch, undefined, { rules: "b2" }));

/** Each fixture as Claude Code would have run the same session, with the followed reading both should give. */
const SAME: Record<string, { steps: Step[]; followed: boolean; tool_only: boolean }> = {
  direct: { steps: [bash(HEREDOC, ""), bash(RUN, FAIL, true), bash(SED, ""), bash(RUN + " && grep -n 'return' pkg/mod.py && python -c 'import pkg.mod as m; print(m.add(2, 3))'", PASS + "5:    return a + b  # sum\n5\n")], followed: true, tool_only: false },
  code: { steps: [bash(HEREDOC, ""), bash(RUN, FAIL, true), bash(SED, ""), bash(RUN, PASS)], followed: true, tool_only: false },
  patch: { steps: [writeTool("/testbed/tests/test_mod.py"), bash(RUN, FAIL, true), editTool("/testbed/pkg/mod.py"), writeTool("/testbed/tests/test_mod_more.py"), bash("python -m pytest -q tests/", "...                                                                      [100%]\n3 passed in 0.01s\n")], followed: true, tool_only: true },
  "patch-first": { steps: [editTool("/testbed/pkg/mod.py"), writeTool("/testbed/tests/test_mod.py"), bash(RUN, PASS)], followed: false, tool_only: false },
  "patch-failed": { steps: [bash(RUN, "ERROR: file or directory not found: tests/test_mod.py\n\n\nno tests ran in 0.00s\n", true)], followed: false, tool_only: false },
  move: { steps: [writeTool("/testbed/tests/test_mod.py", TEST_BODY.replace("pkg.mod", "pkg.calc")), bash(RUN, "ERROR tests/test_mod.py\n!!!!!!!!!!!!!!!!!!!! Interrupted: 1 error during collection !!!!!!!!!!!!!!!!!!!!\n1 error in 0.05s\n", true), editTool("/testbed/pkg/mod.py"), editTool("/testbed/pkg/calc.py"), bash(RUN, PASS)], followed: true, tool_only: true },
  sub: { steps: [bash(HEREDOC, ""), bash(RUN, FAIL, true), editTool("/testbed/pkg/mod.py"), bash(RUN, PASS)], followed: true, tool_only: false },
  bg: { steps: [bash(HEREDOC, ""), bash(RUN, FAIL, true), bash(SED, ""), { name: "Bash", input: { command: "sleep 3; " + RUN, run_in_background: true }, result: "Command running in background with ID: b1. Output is being written to: /tmp/tasks/b1.output" }, { name: "Read", input: { file_path: "/tmp/tasks/b1.output" }, result: PASS }], followed: true, tool_only: false },
  "bg-unread": { steps: [bash(HEREDOC, ""), bash(RUN, FAIL, true), bash(SED, ""), { name: "Bash", input: { command: "sleep 3; " + RUN, run_in_background: true }, result: "Command running in background with ID: b1. Output is being written to: /tmp/tasks/b1.output" }], followed: false, tool_only: false },
};

describe("each real Codex 0.170.0 rollout reads as the same session written as Claude Code tool calls", () => {
  for (const [name, same] of Object.entries(SAME)) {
    test(name + ": followed " + same.followed + ", with every field the same", () => {
      const c = codex(name), patch = patchOf(name), got = read(c.recs, patch);
      expect(got).toEqual(read(claude(same.steps), patch));
      expect([got.followed, got.followed_b2, got.followed_tool_only, c.unreadable_items, c.cwd]).toEqual([same.followed, same.followed, same.tool_only, 0, "/testbed"]);
    });
  }
});

const stream = (name: string) => codex(name).recs.flatMap((r) => (r.type === "AssistantMessage" && Array.isArray(r.content) ? r.content.map((b: any) => b.name + " " + JSON.stringify(b.input)) : []));
describe("what the stream holds", () => {
  test("a code-mode cell's two commands each reach the stream as a Bash call, from their CommandExecution items", () => {
    expect(stream("code")).toEqual([HEREDOC, RUN, SED, RUN].map((command) => "Bash " + JSON.stringify({ command })));
  });
  test("an apply_patch that adds a test and updates a source file writes both, the source first; a move writes both paths; a failed patch writes nothing", () => {
    expect(stream("patch").filter((s) => !s.startsWith("Bash"))).toEqual(["Write", "Edit", "Write"].map((t, i) => expect.stringMatching(new RegExp("^" + t + " .*" + ["tests/test_mod.py", "pkg/mod.py", "tests/test_mod_more.py"][i]))));
    expect(stream("move").filter((s) => s.startsWith("Edit")).map((s) => JSON.parse(s.slice(5)).file_path)).toEqual(["/testbed/pkg/mod.py", "/testbed/pkg/calc.py"]);
    expect(stream("patch-failed").filter((s) => !s.startsWith("Bash"))).toEqual([]);
  });
  test("a sub-agent's commands and patches are read from its own rollout, in time order with the root's", () => {
    const c = codex("sub");
    expect([c.threads, stream("sub").map((s) => s.split(" ")[0])]).toEqual([2, ["Bash", "Bash", "Edit", "Bash"]]);
  });
  test("a background run is seen at its write_stdin read, never at its CommandExecution item, and one never read stays unread", () => {
    expect(stream("bg").map((s) => s.split(" ")[0])).toEqual(["Bash", "Bash", "Bash", "Bash", "Read"]);
    expect(stream("bg").at(-2)).toContain('"run_in_background":true');
    expect(stream("bg-unread").map((s) => s.split(" ")[0])).toEqual(["Bash", "Bash", "Bash", "Bash"]);
  });
});

describe("fallbacks and items the reader can't read", () => {
  const lines = (name: string) => walkRollouts(join(FX, name)).map((f) => readFileSync(f, "utf8").split("\n").filter((l) => l.trim()));
  const drop = (ls: string[][], keep: (o: any) => boolean) => ls.map((t) => t.filter((l) => keep(JSON.parse(l))).join("\n"));
  test("with no CommandExecution or FileChange items, the calls' own outputs give the same reading", () => {
    for (const name of ["direct", "patch", "patch-first", "move", "bg", "patch-failed"]) {
      const bare = codexTranscript(drop(lines(name), (o) => !(o.type === "event_msg" && o.payload?.type === "item_completed" && /^(?:CommandExecution|FileChange)$/.test(o.payload.item?.type))));
      expect([name, read(bare.recs, patchOf(name)), bare.unreadable_items]).toEqual([name, read(codex(name).recs, patchOf(name)), 0]);
    }
  });
  test("each command starts in its own folder, as Codex runs it, though an earlier command changed folder", () => {
    const moved = lines("direct").map((t) => t.map((l) => { const o = JSON.parse(l); if (o.type === "event_msg" && o.payload?.item?.type === "CommandExecution" && o.payload.item.id.endsWith("_0")) o.payload.item.command[2] = o.payload.item.command[2].replace("mkdir -p tests && cat > tests/test_mod.py", "mkdir -p tests && cd tests && cat > test_mod.py"); return JSON.stringify(o); }).join("\n"));
    const c = codexTranscript(moved), d = detect(c.recs, patchOf("direct"), undefined, { rules: "b2" });
    expect([d.followed, d.test_file, d.fix_files, stream("direct").length]).toEqual([true, "/testbed/tests/test_mod.py", ["/testbed/pkg/mod.py"], 4]);
    expect(c.recs.some((r) => JSON.stringify(r.content ?? "").includes("cd /testbed && python -m pytest"))).toBe(true);
  });
  test("a line that is not JSON, an output that isn't unified exec's, a write_stdin to an unknown session and an unknown tool are counted", () => {
    const ls = lines("direct");
    const out = ls.map((t) => t.map((l) => { const o = JSON.parse(l); if (o.type === "event_msg" && o.payload?.item?.type === "CommandExecution" && o.payload.item.id.endsWith("_3")) return ""; if (o.type === "response_item" && o.payload?.type === "function_call_output" && o.payload.call_id.endsWith("_3")) { o.payload.output = "something else"; return JSON.stringify(o); } return l; }).filter(Boolean));
    const extra = [JSON.stringify({ timestamp: "2026-11-21T07:52:00.000Z", type: "response_item", payload: { type: "function_call", name: "write_stdin", arguments: JSON.stringify({ session_id: 999, chars: "" }), call_id: "x1" } }), JSON.stringify({ timestamp: "2026-11-21T07:52:00.001Z", type: "response_item", payload: { type: "function_call_output", call_id: "x1", output: "Chunk ID: 1\nWall time: 0.0 seconds\nProcess exited with code 0\nOriginal token count: 1\nOutput:\nok\n" } }), JSON.stringify({ timestamp: "2026-11-21T07:52:00.002Z", type: "response_item", payload: { type: "function_call", name: "mcp__files__write", arguments: "{}", call_id: "x2" } }), "{not json"];
    const c = codexTranscript([[...out[0]!, ...extra].join("\n")]);
    const d = detect(c.recs, patchOf("direct"), undefined, { rules: "b2" });
    expect([c.unreadable_items, d.passing_after_source, d.followed]).toEqual([4, false, false]);
  });
});
