// Copyright (c) 2026 Garry Tan. MIT License.
// The canonical history (prereg section 3): sha256 over sorted-key JSON, rendering to alternating messages, and the
// drive-path refusal every assembler runs.
import { expect, test } from "bun:test";
import { TbvError } from "../../lanes/tbv/errors.ts";
import { historySha256, rebuildTurns, refuseOutsideRules, renderHistory } from "../../lanes/tbv/history/events.ts";
import { validateRequest } from "../../lanes/tbv/request.ts";
import type { Block, History, HistoryEvent } from "../../lanes/tbv/types.ts";
import { localRender } from "./fixtures/s2.ts";
import { codeOf } from "./history-helpers.ts";

const events: HistoryEvent[] = [
  { n: 1, kind: "user-text", text: "Fix the parser, café edition." },
  { n: 2, kind: "assistant-text", text: "Running tests." },
  { n: 3, kind: "tool-use", id: "toolu_1", name: "Bash", input: { command: "pytest -q", timeout: 60 } },
  { n: 4, kind: "tool-result", tool_use_id: "toolu_1", content: "1 failed", is_error: true },
  { n: 5, kind: "tool-use", id: "toolu_2", name: "Read", input: { file_path: "src/a.py" } },
  { n: 6, kind: "tool-result", tool_use_id: "toolu_2", content: "x = 1", is_error: false },
];
const hist = (ev: HistoryEvent[]): History => ({ schema: "tbv-history.v1", source: "A", task: "demo", cluster: "demo", family: "investigate", events: ev, sha256: "", side: { files: [], resolved: null, patch: null } });

test("historySha256 is sha256 of Python's sort_keys compact JSON, so key order never changes it", () => {
  const py = Bun.spawnSync(["python3", "-c", "import json,hashlib,sys; print(hashlib.sha256(json.dumps(json.load(sys.stdin), sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest())"], { stdin: Buffer.from(JSON.stringify(events)) });
  expect(historySha256(events)).toBe(py.stdout.toString().trim());
  const reordered = events.map((e) => Object.fromEntries(Object.entries(e).reverse())) as HistoryEvent[];
  (reordered[2] as { input: Record<string, unknown> }).input = { timeout: 60, command: "pytest -q" };
  expect(historySha256(reordered)).toBe(historySha256(events));
  expect(historySha256([...events.slice(0, 3), { ...events[3], is_error: false } as HistoryEvent, ...events.slice(4)])).not.toBe(historySha256(events));
});

test("renderHistory joins consecutive blocks of one role and keeps is_error only where it is true", () => {
  expect(renderHistory(hist(events))).toEqual([
    { role: "user", content: [{ type: "text", text: "Fix the parser, café edition." }] },
    { role: "assistant", content: [{ type: "text", text: "Running tests." }, { type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "pytest -q", timeout: 60 } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "1 failed", is_error: true }] },
    { role: "assistant", content: [{ type: "tool_use", id: "toolu_2", name: "Read", input: { file_path: "src/a.py" } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_2", content: "x = 1" }] },
  ]);
});

test("renderHistory refuses a history that does not open with the user", () => {
  expect(codeOf(() => renderHistory(hist(events.slice(1))))).toBe("E_TBV_HISTORY");
});

test("refuseOutsideRules refuses drive paths, Captain drive folders and crew rules files, and names where", () => {
  for (const t of ["see " + ["", "home", "ada", ".capy", "drive", ""].join("/") + "notes.md", "cat ~/.capy/drive/x", "open captain-gstack-evals/NOTES.md", "read CREW.md first", "org-gstack-gbrain/software-factory/rules.md says"]) {
    expect(codeOf(() => refuseOutsideRules(t, "event 7"))).toBe("E_TBV_HISTORY");
  }
  try {
    refuseOutsideRules("read CREW.md", "event 7");
  } catch (e) {
    expect((e as Error).message).toContain("event 7");
  }
  for (const t of ["the captain/templates/report.md file", "pytest: 3 passed", "capy/skill/gstack/factory.md", "a crew of three"]) refuseOutsideRules(t, "event 1");
});

// GEVA-392: a response's results can be logged before its last call, because Claude Code starts a call while the
// response is still streaming. Joining consecutive blocks by role then put a result three messages after its call.
const LATE: HistoryEvent[] = [
  { n: 1, kind: "user-text", text: "Find why the importer skips a row." },
  { n: 2, kind: "assistant-text", text: "Reading the importer." },
  { n: 3, kind: "tool-use", id: "toolu_a", name: "Read", input: { file_path: "a.py" } },
  { n: 4, kind: "tool-use", id: "toolu_b", name: "Read", input: { file_path: "b.py" } },
  { n: 5, kind: "tool-use", id: "toolu_c", name: "Bash", input: { command: "pytest -q" } },
  { n: 6, kind: "tool-result", tool_use_id: "toolu_b", content: "b body", is_error: false },
  { n: 7, kind: "tool-result", tool_use_id: "toolu_a", content: "a body", is_error: false },
  { n: 8, kind: "tool-use", id: "toolu_d", name: "Read", input: { file_path: "d.py" } },
  { n: 9, kind: "tool-result", tool_use_id: "toolu_d", content: "d body", is_error: false },
  { n: 10, kind: "tool-result", tool_use_id: "toolu_c", content: "1 failed", is_error: true },
  { n: 11, kind: "assistant-text", text: "The test fails on row 3." },
  { n: 12, kind: "tool-use", id: "toolu_e", name: "Read", input: { file_path: "e.py" } },
  { n: 13, kind: "tool-result", tool_use_id: "toolu_e", content: "e body", is_error: false },
];
const use = (id: string, file: string): Block => ({ type: "tool_use", id, name: "Read", input: { file_path: file } });
const result = (id: string, content: string, isError = false): Block => ({ type: "tool_result", tool_use_id: id, content, ...(isError ? { is_error: true } : {}) });
const refusal = (fn: () => unknown): { code: string; message: string } => {
  try {
    fn();
  } catch (e) {
    if (e instanceof TbvError) return { code: e.code, message: e.message };
    throw e;
  }
  return { code: "no refusal", message: "" };
};

test("late parallel results: joined by role the validator refuses them; rebuilt, one response's calls share a message and its results follow in tool_use order", () => {
  expect(validateRequest({ messages: localRender(hist(LATE)) }, "opus")).toMatchObject({ ok: false, problem: "tool_use toolu_c has no tool_result in the next message" });
  const rebuilt = renderHistory(hist(LATE));
  expect(rebuilt).toEqual([
    { role: "user", content: [{ type: "text", text: "Find why the importer skips a row." }] },
    { role: "assistant", content: [{ type: "text", text: "Reading the importer." }, use("toolu_a", "a.py"), use("toolu_b", "b.py"), { type: "tool_use", id: "toolu_c", name: "Bash", input: { command: "pytest -q" } }, use("toolu_d", "d.py")] },
    { role: "user", content: [result("toolu_a", "a body"), result("toolu_b", "b body"), result("toolu_c", "1 failed", true), result("toolu_d", "d body")] },
    { role: "assistant", content: [{ type: "text", text: "The test fails on row 3." }, use("toolu_e", "e.py")] },
    { role: "user", content: [result("toolu_e", "e body")] },
  ]);
  expect(validateRequest({ messages: rebuilt }, "opus")).toEqual({ ok: true });
  expect(rebuildTurns(hist(LATE)).rebuilt).toBe(1);
  const blocks = (ms: Array<{ content: Array<Record<string, unknown>> }>) => ms.flatMap((m) => m.content).map((b) => JSON.stringify(b.is_error === false ? { ...b, is_error: undefined } : b)).sort();
  expect(blocks(rebuilt)).toEqual(blocks(localRender(hist(LATE))));
});

test("a turn whose results all come after its last call keeps their logged order, as joining by role did", () => {
  const ev: HistoryEvent[] = [
    { n: 1, kind: "user-text", text: "Look at both files." },
    { n: 2, kind: "tool-use", id: "toolu_x", name: "Read", input: { file_path: "x.py" } },
    { n: 3, kind: "tool-use", id: "toolu_y", name: "Read", input: { file_path: "y.py" } },
    { n: 4, kind: "tool-result", tool_use_id: "toolu_y", content: "y body", is_error: false },
    { n: 5, kind: "tool-result", tool_use_id: "toolu_x", content: "x body", is_error: false },
    { n: 6, kind: "tool-use", id: "toolu_z", name: "Read", input: { file_path: "z.py" } },
    { n: 7, kind: "tool-result", tool_use_id: "toolu_z", content: "z body", is_error: false },
  ];
  expect(renderHistory(hist(ev))).toEqual([
    { role: "user", content: [{ type: "text", text: "Look at both files." }] },
    { role: "assistant", content: [use("toolu_x", "x.py"), use("toolu_y", "y.py")] },
    { role: "user", content: [result("toolu_y", "y body"), result("toolu_x", "x body")] },
    { role: "assistant", content: [use("toolu_z", "z.py")] },
    { role: "user", content: [result("toolu_z", "z body")] },
  ]);
  expect(rebuildTurns(hist(ev)).rebuilt).toBe(0);
});

test("a call with no result still refuses, also when a later call joins its response, and the reason names no id or task", () => {
  const missing: HistoryEvent[] = [
    { n: 1, kind: "user-text", text: "Check the importer." },
    { n: 2, kind: "tool-use", id: "toolu_a", name: "Read", input: { file_path: "a.py" } },
    { n: 3, kind: "tool-use", id: "toolu_b", name: "Read", input: { file_path: "b.py" } },
    { n: 4, kind: "tool-result", tool_use_id: "toolu_a", content: "a body", is_error: false },
    { n: 5, kind: "tool-use", id: "toolu_c", name: "Read", input: { file_path: "c.py" } },
    { n: 6, kind: "tool-result", tool_use_id: "toolu_c", content: "c body", is_error: false },
    { n: 7, kind: "assistant-text", text: "Done." },
    { n: 8, kind: "tool-use", id: "toolu_d", name: "Read", input: { file_path: "d.py" } },
    { n: 9, kind: "tool-result", tool_use_id: "toolu_d", content: "d body", is_error: false },
  ];
  for (const ev of [missing, missing.slice(0, 6), missing.slice(0, 4)]) {
    const r = refusal(() => renderHistory(hist(ev)));
    expect(r.code).toBe("E_TBV_HISTORY");
    expect(r.message).toBe("the turns cannot be rebuilt at event " + ev.at(-1)!.n + ": 1 of the response's calls has no result");
  }
  expect(refusal(() => renderHistory(hist(missing.slice(0, 3)))).message).toBe("the turns cannot be rebuilt at event 3: 2 of the response's calls have no result");
});

test("an ambiguous turn refuses with its reason: user text while calls wait, a result that answers no waiting call, a repeated call id", () => {
  const head: HistoryEvent[] = [
    { n: 1, kind: "user-text", text: "Check the importer." },
    { n: 2, kind: "tool-use", id: "toolu_a", name: "Read", input: { file_path: "a.py" } },
    { n: 3, kind: "tool-use", id: "toolu_b", name: "Read", input: { file_path: "b.py" } },
    { n: 4, kind: "tool-result", tool_use_id: "toolu_a", content: "a body", is_error: false },
  ];
  const cases: Array<[HistoryEvent[], string]> = [
    [[...head, { n: 5, kind: "user-text", text: "Stop there." }, { n: 6, kind: "tool-result", tool_use_id: "toolu_b", content: "b body", is_error: false }], "event 5: the user's text comes while 1 of the response's calls has no result, so its place among the turns is ambiguous"],
    [[...head, { n: 5, kind: "tool-result", tool_use_id: "toolu_a", content: "a again", is_error: false }, { n: 6, kind: "tool-result", tool_use_id: "toolu_b", content: "b body", is_error: false }], "event 5: the result answers no call of its response that still has no result"],
    [[head[0]!, { n: 2, kind: "tool-result", tool_use_id: "toolu_z", content: "z body", is_error: false }], "event 2: the result answers no call of its response that still has no result"],
    [[...head, { n: 5, kind: "tool-result", tool_use_id: "toolu_b", content: "b body", is_error: false }, { n: 6, kind: "tool-use", id: "toolu_a", name: "Read", input: { file_path: "a.py" } }, { n: 7, kind: "tool-result", tool_use_id: "toolu_a", content: "a body", is_error: false }], "event 6: the call repeats an earlier call's id"],
  ];
  for (const [ev, why] of cases) {
    const r = refusal(() => renderHistory(hist(ev)));
    expect(r.code).toBe("E_TBV_HISTORY");
    expect(r.message).toBe("the turns cannot be rebuilt at " + why);
  }
});
