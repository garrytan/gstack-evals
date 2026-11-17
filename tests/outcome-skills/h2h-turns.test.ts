// Copyright (c) 2026 Garry Tan. MIT License.
// The head-to-head's turns (post section 4): T, each arm's scripted turns per entry from prereg.json, and the DONE rule's
// variants, with h2h_rules.py (the session loop's copy) checked against turns.ts on every fixture under plain python3.
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { readPrereg } from "../../lanes/outcome-skills/h2h/prereg.ts";
import { entryOf, GSD_ONBOARD, hasDone, scriptedTurns, taskText, turnPlan } from "../../lanes/outcome-skills/h2h/sessions/turns.ts";

const P = readPrereg();
const S = "The parser drops the last row when the file has no final newline.";
const T = taskText(S);
const RULES = join(import.meta.dir, "../../lanes/outcome-skills/h2h/sessions");

/** Final messages and whether each has DONE: the planted variants of section 15 and the near misses. */
const DONE_FIXTURES: Array<[string, boolean]> = [
  ["Fixed the parser.\n\nDONE", true],
  ["Fixed the parser.\nDONE.", true],
  ["Fixed the parser.\n**DONE**", true],
  ["Fixed it.\n\n```\nDONE\n```", true],
  ["Fixed it.\nDONE\nGSTACK_RESULT: {\"status\":\"ok\"}", true],
  ["Fixed it.\nDONE\n\n\nGSTACK_RESULT: ok\n\n", true],
  ["Done", true],
  ["# Done!", true],
  ["- `DONE`", true],
  ["DONE\na\nb\nc", false],
  ["Fixed the parser.", false],
  ["The fix is DONE", false],
  ["not done", false],
  ["DONE-ish", false],
  ["", false],
  ["Should I go ahead?\n", false],
];

describe("h2h turns", () => {
  test("T carries the statement once, without its trailing whitespace, and refuses an empty one", () => {
    expect(T).toBe(P.texts.task.replace("{problem statement}", S));
    expect(taskText(S + "\n\n  ")).toBe(T);
    expect(taskText("Use $& and $1 literally.")).toStartWith("Use $& and $1 literally.\n\n");
    expect(() => taskText(" \n")).toThrow(/^E_H2H_SESSION_INPUT /);
  });

  test("each arm's scripted turns follow the post's entry table", () => {
    expect(scriptedTurns("none", "bug", S)).toEqual([T]);
    expect(scriptedTurns("none", "feature", S)).toEqual([T]);
    expect(scriptedTurns("gstack", "bug", S)).toEqual([T]);
    expect(scriptedTurns("gstack", "feature", S)).toEqual(["/autoplan " + T]);
    expect(scriptedTurns("superpowers", "feature", S)).toEqual([T]);
    expect(scriptedTurns("agent-skills", "bug", S)).toEqual(["/agent-skills:test " + T]);
    expect(scriptedTurns("agent-skills", "feature", S)).toEqual(["/agent-skills:spec " + T, "/agent-skills:build auto"]);
    expect(scriptedTurns("gsd", "bug", S)).toEqual(["/gsd-debug " + T]);
    expect(scriptedTurns("gsd", "bug", S, { gsdOnboard: true })).toEqual([GSD_ONBOARD, "/gsd-debug " + T]);
    expect(scriptedTurns("gsd", "feature", S)).toEqual(["/gsd-onboard", "/gsd-quick " + T]);
    expect(scriptedTurns("gsd", "feature", S, { gsdOnboard: true })).toEqual(["/gsd-onboard", "/gsd-quick " + T]);
    expect(scriptedTurns("pstack", "bug", S)).toEqual(["/pstack:poteto-mode " + T]);
    expect(scriptedTurns("tstack", "feature", S)).toEqual(["Full send: " + T]);
    expect(scriptedTurns("gstack-pony", "feature", S)).toEqual(["/autoplan " + T]);
    expect(scriptedTurns("gstack-oneline", "bug", S)).toEqual([T + "\n\n" + P.texts.oneline]);
    expect(scriptedTurns("gstack-oneline", "feature", S)).toEqual(["/autoplan " + T + "\n\n" + P.texts.oneline]);
    expect(scriptedTurns("gstack-qa", "bug", S)).toEqual(["/qa " + T]);
    expect(() => scriptedTurns("gstack-qa", "feature", S)).toThrow(/^E_H2H_SESSION_INPUT /);
  });

  test("security and browser units take the bug entry; the plan carries the frozen continuation, reply and cap", () => {
    expect(entryOf({ kind: "B1", entry: "feature" })).toBe("bug");
    expect(entryOf({ kind: "B2", entry: "feature" })).toBe("bug");
    expect(entryOf({ kind: "O", entry: "feature" })).toBe("feature");
    expect(turnPlan("agent-skills", "feature", S)).toEqual({ arm: "agent-skills", entry: "feature", scripted: ["/agent-skills:spec " + T, "/agent-skills:build auto"], continuation: P.texts.continuation, question_reply: P.texts.question_reply, continuation_cap: 6 });
  });

  test("the DONE rule reads the last three non-empty lines with markers and punctuation stripped and case ignored", () => {
    for (const [text, want] of DONE_FIXTURES) expect([text, hasDone(text)]).toEqual([text, want]);
    expect(hasDone(null)).toBe(false);
  });

  test("h2h_rules.py agrees with turns.ts on every DONE fixture and orders scripted turns before continuations", () => {
    const script = "import json,sys\nsys.path.insert(0,sys.argv[1])\nfrom h2h_rules import has_done,next_turn\nd=json.load(sys.stdin)\nprint(json.dumps({'done':[has_done(t,d['rule']) for t in d['texts']],'next':[next_turn(*a) for a in d['steps']]}))";
    const steps = [[1, true, 0, 6], [0, true, 0, 6], [0, false, 0, 6], [0, false, 5, 6], [0, false, 6, 6]];
    const r = spawnSync("python3", ["-c", script, RULES], { input: JSON.stringify({ rule: P.done_rule, texts: DONE_FIXTURES.map((f) => f[0]), steps }), encoding: "utf8" });
    expect(r.stderr).toBe("");
    const out = JSON.parse(r.stdout);
    expect(out.done).toEqual(DONE_FIXTURES.map((f) => f[1]));
    expect(out.next).toEqual(["scripted", "end_done", "continuation", "continuation", "end_cap"]);
  });
});
