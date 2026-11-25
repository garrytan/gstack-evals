// Copyright (c) 2026 Garry Tan. MIT License.
// Keyless tests of eval 1's exposure detectors (lanes/eng-planted/e1/detect.ts), on both sides of each rule.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { walkRollouts } from "../../scoring/codex-fixtures.ts";
import { rollouts } from "../../../lanes/eng-planted/e1/launch.ts";
import { codexAsClaude, cExposure, dExposure, exposure, markedBlocks, pExposure, tlcResult } from "../../../lanes/eng-planted/e1/detect.ts";

const tx = (...lines: object[]) => lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
const bash = (id: string, command: string, result: string, is_error = false) => [
  { type: "assistant", message: { content: [{ type: "tool_use", id, name: "Bash", input: { command } }] } },
  { type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content: result, ...(is_error ? { is_error } : {}) }] } },
];

describe("D: a new diagram in the final plan", () => {
  const authored = "# Plan\n\nAdd a retry.\n";
  test("3 new arrow lines with labels joined is exposed; 2 lines is not", () => {
    expect(dExposure(authored, authored + "\nIdle -> Running\nRunning -> Done\nRunning -> Failed\n").exposed).toBe(true);
    expect(dExposure(authored, authored + "\nIdle -> Running\nRunning -> Done\n").exposed).toBe(false);
  });
  test("box drawing with unicode arrows counts; a block the authored plan already had does not", () => {
    const box = "┌──────┐\n│ Idle │ ─→ Running\n└──────┘\n";
    expect(dExposure(authored, authored + box).exposed).toBe(true);
    expect(dExposure(authored + box, authored + box).exposed).toBe(false);
  });
  test("no final plan, or a diagram with one label, is not exposed", () => {
    expect(dExposure(authored, null).exposed).toBe(false);
    expect(dExposure(authored, authored + "\n-> -> ->\n--> -->\n=> =>\n").exposed).toBe(false);
  });
  test("blocks split on lines without a mark", () => {
    expect(markedBlocks("a -> b\nplain\nc -> d\ne -> f").map((b) => b.length)).toEqual([1, 2]);
  });
});

describe("C: TLC reached a model-checking result", () => {
  test("a states-generated line, a completed check or a violation with its trace counts; a parse error does not", () => {
    const trace = "\nError: The behavior up to this point is:\nState 1: <Initial predicate>\n";
    expect(tlcResult("1234 states generated, 567 distinct states found, 0 states left on queue.")).toBe(true);
    expect(tlcResult("Model checking completed. No error has been found.")).toBe(true);
    expect(tlcResult("Error: Invariant TypeOK is violated." + trace)).toBe(true);
    expect(tlcResult("Error: Deadlock reached." + trace)).toBe(true);
    expect(tlcResult("Error: Invariant TypeOK is violated.")).toBe(false);
    expect(tlcResult("echo Error: Deadlock reached.")).toBe(false);
    expect(tlcResult("***Parse Error***\nWas expecting ==== or more Module body")).toBe(false);
    expect(tlcResult("Error: The configuration file Spec.cfg does not exist.")).toBe(false);
  });
  test("the command must match the frozen checker list", () => {
    const ok = tx(...bash("t1", 'java -cp "$TLA2TOOLS" tlc2.TLC Spec.tla', "1 states generated, 1 distinct states found"));
    expect(cExposure(ok)).toEqual({ exposed: true, runs: 1, results: 1 });
    const other = tx(...bash("t1", "echo 1 states generated, 1 distinct states found", "1 states generated, 1 distinct states found"));
    expect(cExposure(other).exposed).toBe(false);
    const parse = tx(...bash("t1", "java -jar /opt/tla/tla2tools.jar Spec.tla", "***Parse Error***"));
    expect(cExposure(parse)).toEqual({ exposed: false, runs: 1, results: 0 });
  });
});

describe("P: statechart's body reached the session and TLC ran", () => {
  const marker = "Model the states and transitions before you write code.";
  const run = bash("t2", "java -cp $TLA2TOOLS tlc2.TLC M.tla", "Model checking completed. No error has been found.");
  test("the expanded command plus a TLC result is exposed", () => {
    const t = tx({ type: "user", message: { content: [{ type: "text", text: "# statechart\n" + marker }] } }, ...run);
    expect(pExposure(t, marker)).toMatchObject({ exposed: true, body: true, checked: true });
  });
  test("a Read of statechart/SKILL.md counts as the body reaching; neither the body nor TLC alone is enough", () => {
    const read = [{ type: "assistant", message: { content: [{ type: "tool_use", id: "r1", name: "Read", input: { file_path: "/opt/plugins/pstack/skills/statechart/SKILL.md" } }] } }, { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "r1", content: "..." }] } }];
    expect(pExposure(tx(...read, ...run), marker).exposed).toBe(true);
    expect(pExposure(tx(...run), marker).exposed).toBe(false);
    expect(pExposure(tx(...read), marker).exposed).toBe(false);
  });
  test("the body in Claude Code's own session file counts, since the SDK stream never carries the expanded command", () => {
    const session = tx({ type: "user", message: { role: "user", content: [{ type: "text", text: "Base directory for this skill: /x\n\n" + marker }] } });
    expect(pExposure(tx(...run), marker, session)).toMatchObject({ exposed: true, body: true });
    expect(pExposure(tx(...run), marker, tx({ type: "user", message: { content: "other" } })).exposed).toBe(false);
    expect(exposure({ arm: "P", authored: "", final: null, transcript: tx(...run), claudeSession: session, stateRoot: null, statechartMarker: marker })).toBe(true);
  });
  test("an empty marker refuses", () => {
    expect(() => pExposure("", " ")).toThrow("E_USAGE");
  });
  test("only a Read, or a shell cat whose result holds the marker, counts as a read; a write or a grep does not", () => {
    const use = (name: string, input: object, result: string) => [{ type: "assistant", message: { content: [{ type: "tool_use", id: "w1", name, input }] } }, { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "w1", content: result }] } }];
    const path = "/opt/plugins/pstack/skills/statechart/SKILL.md";
    expect(pExposure(tx(...use("Write", { file_path: path, content: "x" }, "File created"), ...run), marker).read).toBe(false);
    expect(pExposure(tx(...use("Bash", { command: "grep -n x " + path }, marker), ...run), marker).read).toBe(false);
    expect(pExposure(tx(...use("Bash", { command: "cat " + path }, "# statechart\n" + marker), ...run), marker)).toMatchObject({ read: true, exposed: true });
    expect(pExposure(tx(...use("Bash", { command: "cat " + path }, "No such file"), ...run), marker).read).toBe(false);
  });
});

describe("exposure by arm", () => {
  test("N reads null", () => {
    expect(exposure({ arm: "N", authored: "", final: "", transcript: "", stateRoot: null })).toBeNull();
  });
});

describe("Codex rollouts read as Claude Code stream-json", () => {
  const files = walkRollouts(join(import.meta.dir, "../../scoring/fixtures/codex/direct"));
  test("exec commands become Bash calls with results, and assistant messages become text", () => {
    const lines = codexAsClaude(files).trim().split("\n").map((l) => JSON.parse(l));
    const uses = lines.filter((l) => l.type === "assistant").flatMap((l) => l.message.content).filter((b: any) => b.type === "tool_use");
    const texts = lines.filter((l) => l.type === "assistant").flatMap((l) => l.message.content).filter((b: any) => b.type === "text");
    expect(uses.length).toBeGreaterThan(0);
    expect(uses.every((u: any) => typeof u.name === "string")).toBe(true);
    expect(uses.some((u: any) => u.name === "Bash" && String(u.input.command).includes("pytest"))).toBe(true);
    expect(texts.length).toBeGreaterThan(0);
  });
  test("tool calls and the root thread's messages interleave by time; a sub-agent's messages are left out", () => {
    const dir = mkdtempSync(join(tmpdir(), "e1-cx-"));
    const at = (s: number) => new Date(Date.UTC(2026, 10, 28, 6, 0, s)).toISOString();
    const msg = (s: number, text: string) => ({ timestamp: at(s), type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text }] } });
    const exec = (s: number, cmd: string) => ({ timestamp: at(s), type: "event_msg", payload: { type: "item_completed", item: { type: "CommandExecution", id: "e" + s, command: ["bash", "-lc", cmd], status: "completed", exit_code: 0, aggregated_output: "ok", cwd: "/work" } } });
    const root = [{ timestamp: at(0), type: "session_meta", payload: { id: "root", cwd: "/work" } }, msg(1, "first"), msg(5, "last")];
    const sub = [{ timestamp: at(2), type: "session_meta", payload: { id: "sub", parent_thread_id: "root", cwd: "/work" } }, exec(3, "echo sub"), msg(4, "from the sub-agent")];
    writeFileSync(join(dir, "rollout-a-root.jsonl"), root.map((l) => JSON.stringify(l)).join("\n") + "\n");
    writeFileSync(join(dir, "rollout-b-sub.jsonl"), sub.map((l) => JSON.stringify(l)).join("\n") + "\n");
    const lines = codexAsClaude(rollouts(dir)).trim().split("\n").map((l) => JSON.parse(l));
    const seq = lines.map((l) => (l.type === "user" ? "result" : l.message.content[0].type === "text" ? l.message.content[0].text : "call"));
    expect(seq).toEqual(["first", "call", "result", "last"]);
  });
  test("the launcher's rollout walk hands codexAsClaude file paths", () => {
    const walked = rollouts(join(import.meta.dir, "../../scoring/fixtures/codex/direct"));
    expect([...walked].sort()).toEqual([...files].sort());
    expect(codexAsClaude(walked)).toContain("pytest");
  });
});
