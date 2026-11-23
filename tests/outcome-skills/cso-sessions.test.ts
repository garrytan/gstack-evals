// Copyright (c) 2026 Garry Tan. MIT License.
// Plan sections 4 and 9 (harness plan 15.3): the first turns, the DONE variants and the continuation cap of 3, the limits
// and environment, safety-stop classification from recorded stop shapes, the retry and gap rules, and the record's
// texts, opened paths and self-reported model and version.
import { describe, expect, test } from "bun:test";
import { loadCsoPrereg } from "../../lanes/outcome-skills/cso/prereg.ts";
import { armRuns, assistantTexts, csoClaudeEnv, csoConfig, csoDone, csoLimits, csoSessionRecord, firstTurn, harborModel, nextStep, openedPaths, readEnd, sessionIdentity } from "../../lanes/outcome-skills/cso/sessions.ts";

const p = loadCsoPrereg();
const T = p.texts.task;
const close = (o: Record<string, unknown> = {}) => ({ finalized: true, allowance_stops: 0, refusals: [], usage: {}, spent_micros: 0, ...o });
const sum = (turns: Array<Record<string, unknown>>, o: Record<string, unknown> = {}) => ({ turns, slot: { id: "s1", close: close(o.close as Record<string, unknown>) }, ...o, ...(o.close ? {} : {}) });
const turn = (termination: string, refusal = false) => ({ phase: "t1", termination, refusal, drive: {} });

describe("cso sessions: turns", () => {
  test("first turns are T for none and untold and /cso then T for cso; Codex asks for the skill by name", () => {
    expect(firstTurn("none", p)).toBe(T);
    expect(firstTurn("untold", p)).toBe(T);
    expect(firstTurn("cso", p)).toBe("/cso " + T);
    expect(firstTurn("cso", p, "codex")).toBe("Use the cso skill from gstack for this. " + T);
    expect(() => firstTurn("untold", p, "codex")).toThrow(/^E_CSO_SESSION /);
  });
  test("untold runs only in stage 0 and stage 1 on Opus", () => {
    expect(armRuns("untold", "opus", "stage1", p)).toBe(true);
    expect(armRuns("untold", "opus", "stage2", p)).toBe(false);
    expect(armRuns("untold", "particle", "stage0", p)).toBe(false);
    expect(armRuns("cso", "particle", "stage2", p)).toBe(true);
  });
  test("DONE in any of the last 3 non-empty lines, markers and punctuation stripped, any case", () => {
    for (const ok of ["report\nDONE", "**DONE**", "DONE.", "report\n\u0060\u0060\u0060\nDONE\n\u0060\u0060\u0060", "DONE\nGSTACK_RESULT: ok", "done!", "x\n## Done\n\n\nthanks", "- DONE -\nline\nline"]) expect(csoDone(ok, p)).toBe(true);
    for (const no of ["DONE\na\nb\nc", "Not done yet", "DONE with phase 1", "", null, "DONEZO"]) expect(csoDone(no, p)).toBe(false);
  });
  test("a turn without DONE gets the continuation at most 3 times, then the session ends completed at the cap", () => {
    expect(p.continuation_cap).toBe(3);
    expect(nextStep("working", 0, p)).toBe("continuation");
    expect(nextStep("working", 2, p)).toBe("continuation");
    expect(nextStep("working", 3, p)).toBe("cap");
    expect(nextStep("all set\nDONE", 3, p)).toBe("done");
  });
  test("the config h2h_turns.py reads: one turn, the frozen continuation and cap, limits per model, web tools off, env", () => {
    const c = csoConfig({ arm: "cso", model: "opus", home: "/homes/gstack" }, p);
    expect(c.turns).toEqual(["/cso " + T]);
    expect(c.continuation).toBe(p.texts.continuation);
    expect(c.no_answer).toBe(p.texts.question_reply);
    expect(c.continuation_cap).toBe(3);
    expect(c.limits).toMatchObject({ allowance_usd: 8, wall_sec: 2700, max_turns: 200 });
    expect(c.disallowed_tools).toEqual(["WebSearch", "WebFetch"]);
    expect(c.home_rule).toBe("gstack");
    expect(c.env).toMatchObject({ CLAUDE_CODE_DISABLE_BUNDLED_SKILLS: "1", CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS: "4", CLAUDE_CODE_ENABLE_TODO_TOOLS: "1" });
    expect("GSTACK_SESSION_KIND" in csoClaudeEnv(p)).toBe(false);
    expect(csoConfig({ arm: "none", model: "particle", home: null }, p)).toMatchObject({ home_rule: "none", limits: { allowance_usd: 3 } });
    expect(csoLimits("particle", p, 6).allowance_usd).toBe(6);
    expect(() => csoLimits("opus", p, 12)).toThrow(/^E_CSO_SESSION /);
    expect(harborModel("opus", p)).toBe("anthropic/claude-opus-5-5");
    expect(harborModel("particle", p)).toBe("anthropic/particle-ai/particle-1");
    expect(() => harborModel("sol", p)).toThrow(/^E_CSO_SESSION /);
  });
});

describe("cso sessions: ends from recorded stop shapes", () => {
  test("Anthropic's refusal stop in any turn is a safety stop, never retried", () => {
    expect(readEnd(sum([turn("completed", true)]), 1)).toEqual({ end: "safety_stop", reason: "E_CSO_STOP_SAFETY a refusal stop", retry: false });
  });
  test("Claude Code's refusal fallback notice is a safety stop even when the turn then ends on a harness error", () => {
    const r = readEnd(sum([turn("error")]), 1, [{ type: "SystemMessage", subtype: "model_refusal_fallback", data: {} }]);
    expect(r.end).toBe("safety_stop");
    expect(r.reason).toContain("refusal fallback");
  });
  test("OpenAI's cyber-policy refusal on Sol is a safety stop", () => {
    expect(readEnd(sum([turn("error_result")]), 1, [{ type: "turn.failed", error: { code: "cyber_policy", message: "blocked" } }]).end).toBe("safety_stop");
  });
  test("an upstream end gets one retry and a second is a gap; an infra failure the same", () => {
    const up = sum([turn("completed"), turn("error_result")]);
    expect(readEnd(up, 1)).toEqual({ end: "gap", reason: null, retry: true });
    expect(readEnd(up, 2)).toMatchObject({ end: "gap", retry: false, reason: expect.stringMatching(/^E_CSO_GAP_UPSTREAM /) });
    expect(readEnd(sum([turn("error")]), 1).retry).toBe(true);
    expect(readEnd(null, 2)).toMatchObject({ end: "gap", reason: expect.stringMatching(/^E_CSO_GAP_INFRA /) });
  });
  test("limits are their own ends, scored on the text they have; an allowance stop wins over the turn's end", () => {
    expect(readEnd(sum([turn("wall_limit")]), 1)).toEqual({ end: "limit_wall", reason: "E_CSO_STOP_LIMIT wall", retry: false });
    expect(readEnd(sum([turn("turn_ceiling")]), 1).end).toBe("limit_turns");
    expect(readEnd(sum([turn("completed")], { close: { allowance_stops: 1 } }), 1).end).toBe("limit_allowance");
    expect(readEnd(sum([turn("completed")]), 1)).toEqual({ end: "completed", reason: null, retry: false });
  });
  test("a cap stop refuses: the item ends incomplete and nothing is retried", () => {
    expect(() => readEnd({ cap_stop: true, turns: [], slot: { id: null, open_refused: "over cap", close: null } }, 1)).toThrow(/^E_CSO_CAP_STOP /);
  });
});

describe("cso sessions: the record", () => {
  const recs = [
    { type: "SystemMessage", subtype: "init", data: { model: "claude-opus-5-5-20261101", claude_code_version: "2.1.325" } },
    { type: "AssistantMessage", parent_tool_use_id: null, content: [{ type: "thinking", thinking: "hidden" }, { type: "text", text: "Starting the audit." }, { type: "tool_use", id: "a", name: "Read", input: { file_path: "/work/repo/src/a.ts" } }] },
    { type: "UserMessage", content: [{ type: "tool_result", tool_use_id: "a", content: "file body" }] },
    { type: "AssistantMessage", parent_tool_use_id: "task1", content: [{ type: "text", text: "subagent note" }, { type: "tool_use", id: "b", name: "Grep", input: { pattern: "x", path: "/work/repo/lib" } }] },
    { type: "AssistantMessage", parent_tool_use_id: null, content: [{ type: "tool_use", id: "c", name: "Bash", input: { command: "cat src/b.ts | head -5 && sed -n 1,40p ./src/a.ts" } }] },
    { type: "AssistantMessage", parent_tool_use_id: null, content: [{ type: "tool_use", id: "d", name: "Bash", input: { command: "~/.claude/skills/gstack/bin/gstack-cso-launcher read 1767225600000-0123456789abcdef @cso-path//0123456789abcdef0123456789abcdef" } }] },
    { type: "AssistantMessage", parent_tool_use_id: null, content: [{ type: "text", text: "Finding 1: src/a.ts:2\nDONE" }] },
    { type: "ResultMessage", subtype: "success", result: "Finding 1: src/a.ts:2\nDONE" },
  ];
  test("every main-thread assistant text block in order, no thinking, no subagent text, no repeated result", () => {
    expect(assistantTexts(recs)).toEqual(["Starting the audit.", "Finding 1: src/a.ts:2\nDONE"]);
  });
  test("every opened path, repository-relative, in first-seen order, helper handles included", () => {
    expect(openedPaths(recs, "/work/repo")).toEqual(["src/a.ts", "lib", "src/b.ts", "@cso-path//0123456789abcdef0123456789abcdef"]);
  });
  test("helper reads through shell variables count as opened, each one in a command, as in stage 0's Opus sessions", () => {
    const bash = (command: string) => ({ type: "AssistantMessage", parent_tool_use_id: null, content: [{ type: "tool_use", id: "v" + command.length, name: "Bash", input: { command } }] });
    const v = [
      bash("G=~/.claude/skills/gstack/bin/gstack-cso-launcher; R=1795273710354-cc00549a7600619a; $G read $R packages/happy-dom/src/fetch/Fetch.ts 2>&1 | grep -n -i redirect | head -60"),
      bash('L=~/.claude/skills/gstack/bin/gstack-cso-launcher; R=1795273710354-cc00549a7600619a; $L read $R lib/a.js | sed -n 1,9p; $L read "$R" "lib/b.js"'),
      bash("X=/usr/bin/foo; $X read 1795273710354-cc00549a7600619a lib/c.js"),
    ];
    expect(openedPaths(v, "/work/repo")).toEqual(["packages/happy-dom/src/fetch/Fetch.ts", "lib/a.js", "lib/b.js"]);
  });
  test("helper reads inside a for loop over listed words count as opened, one path per word", () => {
    const bash = (command: string) => ({ type: "AssistantMessage", parent_tool_use_id: null, content: [{ type: "tool_use", id: "w" + command.length, name: "Bash", input: { command } }] });
    const v = [
      bash("G=~/.claude/skills/gstack/bin/gstack-cso-launcher; R=1795273710354-cc00549a7600619a; D=$(mktemp -d); for f in a.go cipher/b.go; do $G read $R $f > $D/$(echo $f | tr / _) 2>&1; done; wc -l $D/*"),
      bash('L=~/.claude/skills/gstack/bin/gstack-cso-launcher; R=1795273710354-cc00549a7600619a; for p in "pkg/x.go" pkg/y.go\ndo echo "== $p"; "$L" read $R "$p" | head; done'),
      bash("L=~/.claude/skills/gstack/bin/gstack-cso-launcher; R=1795273710354-cc00549a7600619a; for w in ci.yml; do $L read $R .github/workflows/${w}; done"),
    ];
    expect(openedPaths(v, "/work/repo")).toEqual(["a.go", "cipher/b.go", "pkg/x.go", "pkg/y.go", ".github/workflows/ci.yml"]);
  });
  test("a loop inside a loop is written out from the inside, and a glob word stays a glob", () => {
    const bash = (command: string) => ({ type: "AssistantMessage", parent_tool_use_id: null, content: [{ type: "tool_use", id: "n" + command.length, name: "Bash", input: { command } }] });
    const v = [
      bash('L=~/.claude/skills/gstack/bin/gstack-cso-launcher; R=1795273710354-cc00549a7600619a; for d in api web; do echo "looking for $d"; for f in x.go y.go; do $L read $R $d/$f; done; done'),
      bash("L=~/.claude/skills/gstack/bin/gstack-cso-launcher; R=1795273710354-cc00549a7600619a; for f in src/*.c; do $L read $R $f; done"),
    ];
    expect(openedPaths(v, "/work/repo")).toEqual(["api/x.go", "api/y.go", "web/x.go", "web/y.go", "src/*.c"]);
  });
  test("model id and harness version come from the session's own init record, never the plan", () => {
    expect(sessionIdentity(recs)).toEqual({ model_id: "claude-opus-5-5-20261101", harness_version: "2.1.325" });
    expect(() => sessionIdentity(recs.slice(1))).toThrow(/^E_CSO_SESSION /);
    const exposure = { loaded: false, procedure_ran: false, run_id: null, completeness: null, findings_submitted: null, tooling_errors: 0, host_reads_after_start: 0, scope: null };
    const r = csoSessionRecord({ unit: "u", arm: "none", model: "opus", stage: "stage0", attempts: 2, end: { end: "completed", reason: null, retry: false }, summary: { turns: [{}, {}], continuations: 1, done: true }, records: recs, repoDir: "/work/repo", exposure, helper: { snapshot_root: null, handles: {} }, usage: [{ spent_micros: 1_500_000, tokens: { input: 1, output: 2, cache_read: 3, cache_write: 4 } }, { spent_micros: 500_000, tokens: { input: 1, output: 2, cache_read: 3, cache_write: 4 } }], wall_sec: 30 });
    expect(r).toMatchObject({ schema: "cso-session.v1", model_id: "claude-opus-5-5-20261101", harness: "claude-code", harness_version: "2.1.325", cost_usd: 2, attempts: 2, continuations: 1, done_seen: true, turns: 2, tokens: { input: 2, output: 4, cache_read: 6, cache_write: 8 } });
  });
});
