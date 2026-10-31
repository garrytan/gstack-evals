import { describe, expect, test } from "bun:test";
import { sentinelFor } from "../../src/adapters/calibration.ts";
import { askTurn, parseClaudeCode, parseCodex, shellReads, skillUse, type Call } from "../../src/grade/transcript.ts";
import { gradeTrial, type VerdictTask } from "../../src/skill-eval/verdict/grade.ts";
import type { TrialRecord } from "../../src/types.ts";

const assistant = (content: unknown[], parent: string | null = null, extra: Record<string, unknown> = {}) => ({ type: "assistant", parent_tool_use_id: parent, message: { role: "assistant", content }, ...extra });
const user = (content: unknown) => ({ type: "user", parent_tool_use_id: null, message: { role: "user", content } });
const ask = { questions: [{ question: "Which approach should we take?", header: "Approach", options: [{ label: "Approach A" }, { label: "Approach B" }] }] };

const SESSION = [
  { type: "system", subtype: "init", tools: ["AskUserQuestion"] },
  assistant([{ type: "thinking", thinking: "THINKING-ONLY" }]),
  assistant([{ type: "text", text: "Let me look around first." }]),
  assistant([{ type: "tool_use", id: "t1", name: "Bash", input: { command: "echo TOOL-INPUT-ONLY" } }]),
  user([{ type: "tool_result", tool_use_id: "t1", content: "TOOL-OUTPUT-ONLY" }]),
  assistant([{ type: "tool_use", id: "t2", name: "Task", input: { description: "research", prompt: "go" } }]),
  assistant([{ type: "text", text: "SUBAGENT-ONLY report" }], "t2"),
  user([{ type: "tool_result", tool_use_id: "t2", content: "SUBAGENT-ONLY report" }]),
  assistant([{ type: "text", text: "I can offer a SECOND-OPINION from an outside voice." }]),
  assistant([{ type: "tool_use", id: "t3", name: "AskUserQuestion", input: ask }]),
  user([{ type: "tool_result", tool_use_id: "t3", content: "User answered: PERSONA-ONLY approach A" }]),
  user("PERSONA-ONLY: three dentists paid."),
  assistant([{ type: "text", text: "API Error: 529 overloaded" }], null, { error: "overloaded", is_api_error_message: true }),
  assistant([{ type: "text", text: "Final plan: build the CLI." }]),
  { type: "result", subtype: "success", result: "Final plan: build the CLI.", num_turns: 5 },
];

const record = (turns: string[]): TrialRecord => ({ model: "m", arm: "after", task: "t", round: 1, trial: 0, termination: { kind: "completed" }, turns, check: null, judge: null, opened: null, files_read: [], asked: [], usage: null, cost_micros: null, wall_ms: null, agent_turns: null, loaded_bytes: null, metrics: {} });
const task = (over: Partial<VerdictTask>): VerdictTask => ({ id: "t", safety: false, interactive: true, judge: false, must: [], must_not: [], check: false, ...over });

describe("GST-109: user-visible turns from a Claude Code transcript", () => {
  // Value: protects=turns hold the main agent's text and each AskUserQuestion's question with its labels, in order, and nothing else: no thinking, tool input or output, subagent text, user or persona text, API errors or result echo; fails_when=any of those reaches the graded text; why_new=GST-109 decision 2 (assistant text blocks only); seam=parseClaudeCode; no_claim=none beyond protects
  test("only what the user saw, in order, with the final answer last", () => {
    const { turns } = parseClaudeCode(SESSION);
    expect(turns).toEqual(["Let me look around first.", "I can offer a SECOND-OPINION from an outside voice.", askTurn(ask.questions), "Final plan: build the CLI."]);
    expect(askTurn(ask.questions)).toBe("Which approach should we take?\n- Approach A\n- Approach B");
    for (const hidden of ["THINKING-ONLY", "TOOL-INPUT-ONLY", "TOOL-OUTPUT-ONLY", "SUBAGENT-ONLY", "PERSONA-ONLY", "API Error"]) expect(turns.join("\n")).not.toContain(hidden);
  });

  // Value: protects=the Captain's grading rule on parsed turns: a must held mid-session passes an interactive task but not a final-answer one, a pattern only in persona or subagent text never passes, and a must_not in a mid-session code block fails an interactive run; fails_when=grading reads hidden text or only the last turn on an interactive task; why_new=GST-109 (a pattern only in a persona reply does not pass); seam=parseClaudeCode, gradeTrial; no_claim=none beyond protects
  test("a must seen mid-session passes an interactive task; persona and subagent text never pass; a mid-session must_not fails", () => {
    const rec = record(parseClaudeCode(SESSION).turns);
    expect(gradeTrial(task({ must: ["second-opinion"] }), rec).outcome).toBe("pass");
    expect(gradeTrial(task({ interactive: false, must: ["second-opinion"] }), rec).outcome).toBe("fail");
    expect(gradeTrial(task({ must: ["dentists paid"] }), rec).outcome).toBe("fail");
    expect(gradeTrial(task({ must: ["SUBAGENT-ONLY"] }), rec).outcome).toBe("fail");
    expect(gradeTrial(task({ must: ["approach b"] }), rec).outcome).toBe("pass");
    const coded = record(["Here:\n\n```\nrm -rf data\n```\n", "All done."]);
    expect(gradeTrial(task({ must_not: ["rm -rf"] }), coded).outcome).toBe("fail");
    expect(gradeTrial(task({ interactive: false, must_not: ["rm -rf"] }), coded).outcome).toBe("pass");
  });

  // Value: protects=calls[] pairs each tool call with its result's error flag, main and subagent alike; fails_when=a failed call reads as ok or a subagent call is lost; why_new=U10 (skill-opened calls[]); seam=parseClaudeCode; no_claim=none beyond protects
  test("calls[] carries each call's tool, short input, result and whether a subagent made it", () => {
    const { calls } = parseClaudeCode([
      assistant([{ type: "tool_use", id: "a", name: "Skill", input: { skill: "learn" } }]),
      user([{ type: "tool_result", tool_use_id: "a", is_error: true, content: "Unknown skill" }]),
      assistant([{ type: "tool_use", id: "b", name: "Read", input: { file_path: "/h/.claude/skills/learn/SKILL.md", limit: 5 } }], "x"),
      user([{ type: "tool_result", tool_use_id: "b", content: "..." }]),
      assistant([{ type: "tool_use", id: "c", name: "Bash", input: { command: "ls" } }]),
    ]);
    expect(calls).toEqual([
      { id: "a", tool: "Skill", input: { skill: "learn" }, ok: false, subagent: false },
      { id: "b", tool: "Read", input: { file_path: "/h/.claude/skills/learn/SKILL.md" }, ok: true, subagent: true },
      { id: "c", tool: "Bash", input: { command: "ls" }, ok: null, subagent: false },
    ]);
  });

  // Value: protects=the opened signal: a successful Skill call (bare, or gstack-prefixed in an arm that installs gstack), a Read or a shell read under one of the skill's roots open it, and a failed call or a read elsewhere does not; fails_when=the none arm's failed Skill call counts or a gstack base's second path is missed; why_new=interface v0.5 Hosts (a Skill call or a read under the arm's skill tree); seam=skillUse; no_claim=none beyond protects
  test("opened needs a successful call that names or reads the skill", () => {
    const skill = { name: "learn", roots: ["/h/.claude/skills/learn", "/h/.claude/skills/gstack/learn"], namespaces: ["gstack"] };
    const c = (tool: string, input: Record<string, string>, ok: boolean | null = true): Call => ({ id: tool, tool, input, ok, subagent: false });
    expect(skillUse([c("Skill", { skill: "learn" }, false)], skill)).toEqual({ opened: false, files: [] });
    expect(skillUse([c("Skill", { skill: "gstack:learn" })], skill)).toEqual({ opened: true, files: ["SKILL.md"] });
    expect(skillUse([c("Read", { file_path: "/h/.claude/skills/gstack/learn/refs/a.md" })], skill)).toEqual({ opened: true, files: ["refs/a.md"] });
    expect(skillUse([c("Bash", { command: "cat '/h/.claude/skills/learn/SKILL.md' | head" })], skill)).toEqual({ opened: true, files: ["SKILL.md"] });
    expect(skillUse([c("Read", { file_path: "/h/.claude/skills/other/SKILL.md" }), c("Bash", { command: "ls /h/.claude/skills/learn/" })], skill)).toEqual({ opened: false, files: [] });
    expect(skillUse([c("Skill", { skill: "learn" })], null)).toEqual({ opened: false, files: [] });
  });

  // Value: protects=only a real read counts: a read command's file operands, an input redirection and a read inside sh -c, never a path inside text that echo or printf prints, a write target or a command that only lists; fails_when=printing a suggested cat command marks the skill opened and moves UNOPENED or NOT_MEASURABLE; why_new=review of #64 (quoted shell text could mark an unread skill as opened); seam=shellReads, skillUse; no_claim=every shell construct, such as command substitution or xargs, which are not reads here
  test("a shell read is a read command's operand, never text a command prints", () => {
    const skill = { name: "learn", roots: ["/h/.claude/skills/learn"] };
    const bash = (command: string): Call => ({ id: "b", tool: "Bash", input: { command }, ok: true, subagent: false });
    const opened = (command: string) => skillUse([bash(command)], skill).opened;
    expect(opened("echo 'cat /h/.claude/skills/learn/SKILL.md'")).toBe(false);
    expect(opened('printf "%s\\n" "head /h/.claude/skills/learn/SKILL.md"')).toBe(false);
    expect(opened("echo hi > /h/.claude/skills/learn/notes.md")).toBe(false);
    expect(opened("ls /h/.claude/skills/learn/ && echo done")).toBe(false);
    expect(opened('cd /tmp && cat "/h/.claude/skills/learn/SKILL.md" | head -5')).toBe(true);
    expect(opened("wc -l < /h/.claude/skills/learn/SKILL.md")).toBe(true);
    expect(opened("/bin/bash -lc 'sed -n 1,20p /h/.claude/skills/learn/refs/a.md'")).toBe(true);
    expect(opened("LC_ALL=C grep -n step /h/.claude/skills/learn/SKILL.md")).toBe(true);
    expect(shellReads("cat a b; echo 'cat c' && bash -c \"head -3 d\" | tail -1 e")).toEqual(["a", "b", "d", "e"]);
    expect(opened("grep /h/.claude/skills/learn/SKILL.md config.json")).toBe(false);
    expect(opened("cat manifest.json # wired /h/.claude/skills/learn/SKILL.md")).toBe(false);
    expect(opened("awk '{print}' /h/.claude/skills/learn/SKILL.md")).toBe(true);
    expect(opened("grep -e step /h/.claude/skills/learn/SKILL.md")).toBe(true);
    expect(shellReads("sed -n 1,5p f; grep -rn x d1 d2; a#b; cat g#h")).toEqual(["f", "d1", "d2", "g#h"]);
    expect(shellReads("grep -f /h/s/SKILL.md c.json; awk -f /h/s/scan.awk d.txt; grep --file=p.txt /h/s/a.md; grep -fp /h/s/b.md; grep -e x /h/s/c.md; sed -f /h/s/x.sed e")).toEqual(["/h/s/SKILL.md", "c.json", "/h/s/scan.awk", "d.txt", "p.txt", "/h/s/a.md", "p", "/h/s/b.md", "/h/s/c.md", "/h/s/x.sed", "e"]);
  });
});

describe("turns and calls from Codex's exec --json events", () => {
  // Value: protects=Codex's turns are its agent messages in order with the final answer last, reasoning and command output never count, and each command, file change or MCP call is a call whose completed form replaces its started one, ok on exit 0; fails_when=reasoning or tool output is graded, a started item doubles a call, or a failing command counts as ok; why_new=U10 scope (the Codex adapter); seam=parseCodex; no_claim=none beyond protects
  test("agent messages are the turns; commands, file changes and MCP calls are calls", () => {
    const item = (type: string, item: Record<string, unknown>) => ({ type, item });
    const { turns, calls } = parseCodex([
      { type: "thread.started", thread_id: "x" },
      { type: "turn.started" },
      item("item.completed", { id: "r0", type: "reasoning", text: "REASONING-ONLY" }),
      item("item.completed", { id: "m0", type: "agent_message", text: "Reading the skill." }),
      item("item.started", { id: "c0", type: "command_execution", command: "/bin/bash -lc 'cat /h/.codex/skills/learn/SKILL.md'", aggregated_output: "", exit_code: null, status: "in_progress" }),
      item("item.completed", { id: "c0", type: "command_execution", command: "/bin/bash -lc 'cat /h/.codex/skills/learn/SKILL.md'", aggregated_output: "TOOL-OUTPUT-ONLY", exit_code: 0, status: "completed" }),
      item("item.completed", { id: "c1", type: "command_execution", command: "/bin/bash -lc 'cat /h/.codex/skills/learn/missing.md'", aggregated_output: "", exit_code: 1, status: "failed" }),
      item("item.completed", { id: "f0", type: "file_change", changes: [{ path: "/w/a.ts", kind: "update" }, { path: "/w/b.ts", kind: "add" }], status: "completed" }),
      item("item.completed", { id: "p0", type: "mcp_tool_call", server: "docs", tool: "search", status: "failed", error: { message: "no" } }),
      item("item.started", { id: "c2", type: "command_execution", command: "sleep 100", exit_code: null, status: "in_progress" }),
      item("item.completed", { id: "m1", type: "agent_message", text: "FINAL: done." }),
      { type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } },
    ]);
    expect(turns).toEqual(["Reading the skill.", "FINAL: done."]);
    expect(calls.map((c) => [c.id, c.tool, c.ok])).toEqual([["c0", "shell", true], ["c1", "shell", false], ["f0", "apply_patch", true], ["p0", "mcp:docs.search", false], ["c2", "shell", null]]);
    expect(calls[2]!.input).toEqual({ path: "/w/a.ts /w/b.ts" });
    expect(skillUse(calls, { name: "learn", roots: ["/h/.codex/skills/learn"] })).toEqual({ opened: true, files: ["SKILL.md"] });
    expect(gradeTrial(task({ interactive: false, must: ["done"] }), record(turns)).outcome).toBe("pass");
    expect(gradeTrial(task({ interactive: false, must: ["TOOL-OUTPUT-ONLY|REASONING-ONLY"] }), record(turns)).outcome).toBe("fail");
  });
});

describe("calibration's sentinel proof of a skill read", () => {
  const home = "/home/agent";
  const sentinel = (arm: string) => sentinelFor("0da2e120", arm);
  const grepLine = (arm: string) => "272:<!-- " + sentinel(arm) + " -->";
  const ref = (arm: string | null) => ({ name: "learn", roots: [home + "/.claude/skills/learn", home + "/.claude/skills/gstack/learn"], home, ...(arm ? { sentinel: sentinel(arm) } : {}) });
  const call = (command: string, ok: boolean | null = true): Call => ({ id: "c1", tool: "Bash", input: { command }, ok, subagent: false });
  const use = (c: Call, output: string, arm: string | null = "before2") => skillUse([c], ref(arm), new Map([[c.id, output]]));
  const U11 = "for f in " + home + '/.claude/skills/learn/SKILL.md; do grep -n "gstack-evals-sentinel" "$f"; done';

  // Value: protects=a read of the arm's calibration copy counts whenever a call's output quotes the arm's own sentinel, however the path reached the command (U11 row 3's for loop, a loop whose last grep misses so the host marks the call failed, a glob, xargs, $(...), a variable, a cd and a relative path), and the command parser alone still misses each of them, so trials keep today's opened signal; fails_when=any of these reads leaves opened false and stops calibration with CALIBRATION_SKILL; why_new=U11 row 3 (GEVA-54, /learn on Haiku 5.5): before2 read its copy through a for loop and calibration reported no read; seam=skillUse's sentinel proof; no_claim=a real host's output format, which tests/adapters/run-host.test.ts covers
  test("U11 row 3's for loop and other shell indirection read the arm's copy when the output quotes its sentinel", () => {
    const indirect = [
      U11,
      "for f in " + home + "/.claude/skills/learn/SKILL.md " + home + '/.claude/skills/gstack/learn/missing.md; do grep -n "gstack-evals-sentinel" "$f"; done',
      "grep -n gstack-evals-sentinel ~/.claude/skills/*/SKILL.md",
      "find ~/.claude/skills -name SKILL.md | xargs grep -n gstack-evals-sentinel",
      "tail -n 2 $(find ~/.claude/skills -name SKILL.md)",
      'f=~/.claude/skills/learn/SKILL.md; cat "$f"',
      "cd ~/.claude/skills/learn && cat SKILL.md",
    ];
    for (const command of indirect) {
      expect([command, use(call(command), grepLine("before2"), null).opened]).toEqual([command, false]);
      expect([command, use(call(command), grepLine("before2"))]).toEqual([command, { opened: true, files: ["SKILL.md"] }]);
    }
    expect(use(call(indirect[1]!, false), grepLine("before2") + "\ngrep: " + home + "/.claude/skills/gstack/learn/missing.md: No such file or directory")).toEqual({ opened: true, files: ["SKILL.md"] });
  });

  // Value: protects=the proof never over-accepts: the sentinel only in the model's own text, an echo whose input already quotes it, another arm's sentinel (before and before2 in both directions, after), a read of the repo's copy or another arm's copy, a failed read whose output carries no sentinel, a failed Skill call and a subagent's report are not reads; fails_when=any of them sets opened, so a session that never read its copy passes CALIBRATION_SKILL; why_new=GEVA-58 brief (it must not over-accept); seam=skillUse's sentinel proof, parseClaudeCode; no_claim=none beyond protects
  test("a typed sentinel, another arm's sentinel, another copy, a failed read and a subagent's report are not reads", () => {
    const { calls, outputs } = parseClaudeCode([
      assistant([{ type: "tool_use", id: "ls", name: "Bash", input: { command: "ls ~/.claude/skills/learn" } }]),
      user([{ type: "tool_result", tool_use_id: "ls", content: "SKILL.md" }]),
      assistant([{ type: "text", text: sentinel("before2") }]),
    ]);
    expect(skillUse(calls, ref("before2"), outputs)).toEqual({ opened: false, files: [] });
    expect(use(call('echo "' + sentinel("before2") + '"'), sentinel("before2") + "\n").opened).toBe(false);
    expect(use(call(U11), grepLine("before"), "before2").opened).toBe(false);
    expect(use(call(U11), grepLine("before2"), "before").opened).toBe(false);
    expect(use(call(U11), grepLine("after"), "before2").opened).toBe(false);
    expect(use(call("cat /workspace/gstack/learn/SKILL.md"), "---\nname: learn\n---\n# Learn\n").opened).toBe(false);
    expect(use(call("grep -rn gstack-evals-sentinel /calibration/after/learn"), "/calibration/after/learn/SKILL.md:" + grepLine("after")).opened).toBe(false);
    expect(use(call("cat ~/.claude/skills/learn/SKILL.md", false), "cat: " + home + "/.claude/skills/learn/SKILL.md: No such file or directory").opened).toBe(false);
    expect(use({ id: "c1", tool: "Skill", input: { skill: "learn" }, ok: false, subagent: false }, "<tool_use_error>Unknown skill: learn</tool_use_error>").opened).toBe(false);
    expect(use({ id: "c1", tool: "Task", input: { description: "find the sentinel" }, ok: true, subagent: false }, "The line is " + sentinel("before2")).opened).toBe(false);
  });

  // Value: protects=both parsers keep each call's output for the proof: Claude Code's tool_result content as a string or text blocks, failed results included, and Codex's aggregated_output of a command that exited 1; fails_when=an output is dropped, so the proof never sees the sentinel; why_new=GEVA-58 (the proof reads tool output, which calls[] does not carry); seam=parseClaudeCode, parseCodex; no_claim=none beyond protects
  test("each host's parser keeps every call's output, failed calls included", () => {
    const claude = parseClaudeCode([
      assistant([{ type: "tool_use", id: "a", name: "Bash", input: { command: U11 } }, { type: "tool_use", id: "b", name: "Read", input: { file_path: "/x" } }]),
      user([{ type: "tool_result", tool_use_id: "a", is_error: true, content: "Exit code 2\n" + grepLine("before2") }, { type: "tool_result", tool_use_id: "b", content: [{ type: "text", text: "1\tx" }] }]),
    ]);
    expect([...claude.outputs]).toEqual([["a", "Exit code 2\n" + grepLine("before2")], ["b", "1\tx"]]);
    const codex = parseCodex([{ type: "item.completed", item: { id: "c0", type: "command_execution", command: "/bin/bash -lc 'grep -n gstack-evals-sentinel ~/.codex/skills/*/SKILL.md'", aggregated_output: grepLine("before2") + "\n", exit_code: 1, status: "failed" } }]);
    expect(codex.calls.map((c) => c.ok)).toEqual([false]);
    expect(skillUse(codex.calls, { name: "learn", roots: [home + "/.codex/skills/learn"], sentinel: sentinel("before2") }, codex.outputs)).toEqual({ opened: true, files: ["SKILL.md"] });
  });
});

describe("Skill calls through a plugin namespace", () => {
  // Value: protects=a Skill call that names the skill through one of the arm's own namespaces (pstack:interrogate for the pstack plugin, gstack:review for a gstack arm) opens it, and a namespace the arm does not have, another skill of the namespace or a longer name does not; fails_when=any plugin's namespace counts, so a pstack arm reads as opening gstack's skill or the reverse; why_new=ship #88 red team (pstack loads as a plugin, so its skills answer as pstack:<name>), then #88 /ship Step 11 (both voices: any namespace was accepted); seam=skillUse; no_claim=how a told slash command shows in the transcript
  test("<namespace>:<name> opens the skill only through the arm's own namespaces", () => {
    const call = (skill: string) => ({ id: "c1", tool: "Skill", input: { skill }, ok: true }) as unknown as Call;
    const ref = { name: "interrogate", roots: ["/sandbox/pstack/skills/interrogate"], namespaces: ["pstack"] };
    expect(skillUse([call("pstack:interrogate")], ref).opened).toBe(true);
    expect(skillUse([call("gstack:interrogate")], ref).opened).toBe(false);
    expect(skillUse([call("evil:interrogate")], ref).opened).toBe(false);
    expect(skillUse([call("interrogate")], ref).opened).toBe(true);
    expect(skillUse([call("pstack:poteto-mode")], ref).opened).toBe(false);
    expect(skillUse([call("pre-interrogate")], ref).opened).toBe(false);
    expect(skillUse([call("pstack:interrogate")], { name: "interrogate", roots: [] }).opened).toBe(false);
    expect(skillUse([call("gstack:review")], { name: "review", roots: [], namespaces: ["gstack"] }).opened).toBe(true);
  });
});
