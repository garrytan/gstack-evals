// Copyright (c) 2026 Garry Tan. MIT License.
// The canonical history (prereg section 3): sha256 over sorted-key JSON, rendering to alternating messages, and the
// drive-path refusal every assembler runs.
import { expect, test } from "bun:test";
import { historySha256, refuseOutsideRules, renderHistory } from "../../lanes/tbv/history/events.ts";
import type { History, HistoryEvent } from "../../lanes/tbv/types.ts";
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
