// Copyright (c) 2026 Garry Tan. MIT License.
// GEVA-583 prereg section 4: the rerun's three exposure detector fixes on fixture transcripts. A start whose run id was
// cut or saved to a file, matched by a later call or by the saved run record in order; a call on the run through a shell
// variable or substitution with one accepted start; a finish flagged failed by a later step, or shown finished only by the
// record. The frozen detector (no options) reads each of these as before.
import { describe, expect, test } from "bun:test";
import { csoExposure } from "../../lanes/outcome-skills/cso/exposure.ts";

const L = "~/.claude/skills/gstack/bin/gstack-cso-launcher";
const RUN = "1767225600000-0123456789abcdef";
const RUN2 = "1767225700000-fedcba9876543210";
let n = 0;
const call = (command: string, out: string, error = false) => {
  const id = "t" + n++;
  return [
    { type: "AssistantMessage", parent_tool_use_id: null, content: [{ type: "tool_use", id, name: "Bash", input: { command } }] },
    { type: "UserMessage", content: [{ type: "tool_result", tool_use_id: id, content: out, is_error: error }] },
  ];
};
const refusal = '{"ok":false,"error":{"code":"UNSAFE_PATH","message":"symlink"}}';
const fin = (run: string) => JSON.stringify({ runId: run, status: "finished", completeness: "partial" });
const fixed = (recs: unknown[], runRecords: unknown[] = []) => csoExposure(recs as never, [], { fixed: true, runRecords: runRecords as never }).exposure;
const frozen = (recs: unknown[]) => csoExposure(recs as never).exposure;

describe("cso exposure, the rerun's fixed detector", () => {
  test("fix 1: a cut start takes the first run id a later call passes, before any other start", () => {
    const recs = [...call(L + " start --repo . | tail -5", '  "events": []\n}'), ...call(L + " inspect " + RUN, "{}"), ...call(L + " finish " + RUN, fin(RUN))];
    expect(fixed(recs)).toMatchObject({ procedure_ran: true, run_id: RUN, completeness: "partial" });
    expect(frozen(recs)).toMatchObject({ procedure_ran: false, run_id: null });
    const second = [...call(L + " start --repo . | tail -5", "}"), ...call(L + " start --repo . | tail -5", "}"), ...call(L + " inspect " + RUN, "{}"), ...call(L + " finish " + RUN, fin(RUN))];
    expect(fixed(second).procedure_ran).toBe(true);
    expect(fixed([...call(L + " start --repo .", refusal), ...call(L + " inspect " + RUN, "{}"), ...call(L + " finish " + RUN, fin(RUN))]).procedure_ran).toBe(false);
  });
  test("fix 1: an id a later call prints counts, and a start saved to a file is matched by its printed id", () => {
    const recs = [...call(L + " start --repo . > /tmp/s.json", ""), ...call("jq -r .runId /tmp/s.json", RUN), ...call(L + " inspect " + RUN + " > /tmp/i.json", ""), ...call(L + " finish " + RUN, fin(RUN))];
    expect(fixed(recs)).toMatchObject({ procedure_ran: true, run_id: RUN });
  });
  test("fix 1: the record matches starts by order only when the counts agree", () => {
    const recs = [...call(L + " start --repo . > /tmp/s.json", ""), ...call(L + ' inspect "$(jq -r .runId /tmp/s.json)" > /tmp/i.json', ""), ...call(L + ' finish "$(jq -r .runId /tmp/s.json)" > /tmp/f.json', "")];
    expect(fixed(recs, [{ runId: RUN, status: "finished", completeness: "complete" }])).toMatchObject({ procedure_ran: true, run_id: RUN, completeness: "complete" });
    expect(fixed(recs, [{ runId: RUN, status: "finished" }, { runId: RUN2, status: "finished" }]).run_id).toBeNull();
    expect(fixed(recs)).toMatchObject({ procedure_ran: false, run_id: null });
    expect(frozen(recs).procedure_ran).toBe(false);
  });
  test("fix 2: a shell variable or substitution is on the run only while one start was accepted", () => {
    const one = [...call(L + " start --repo .", JSON.stringify({ runId: RUN })), ...call("R=$(cat /tmp/r); " + L + " read $R src/a.ts", "x"), ...call(L + " finish " + RUN, fin(RUN))];
    expect(fixed(one).procedure_ran).toBe(true);
    expect(frozen(one).procedure_ran).toBe(false);
    const two = [...call(L + " start --repo .", JSON.stringify({ runId: RUN })), ...call(L + " start --repo . --code", JSON.stringify({ runId: RUN2 })), ...call(L + " read $R src/a.ts", "x"), ...call(L + " finish " + RUN, fin(RUN))];
    expect(fixed(two).procedure_ran).toBe(false);
  });
  test("fix 3: a finish flagged failed by a later step counts when it shows it finished; a refusal or a tool error does not", () => {
    const base = [...call(L + " start --repo .", JSON.stringify({ runId: RUN })), ...call(L + " inspect " + RUN, "{}")];
    const flagged = (out: string) => fixed([...base, ...call(L + " finish " + RUN + " > f.json; echo exit=$?; python3 -c 'x'", out, true)]).procedure_ran;
    expect(flagged("Exit code 1\nexit=0\nTraceback (most recent call last):")).toBe(true);
    expect(frozen([...base, ...call(L + " finish " + RUN + " > f.json; echo exit=$?; python3 -c 'x'", "Exit code 1\nexit=0\nTraceback", true)]).procedure_ran).toBe(false);
    expect(flagged("Exit code 1\nexit=1")).toBe(false);
    expect(flagged("<tool_use_error>exit=0</tool_use_error>")).toBe(false);
    expect(fixed([...base, ...call(L + " finish " + RUN, refusal)]).procedure_ran).toBe(false);
    expect(fixed([...base, ...call(L + " submit " + RUN + " s.json; " + L + " finish " + RUN, refusal + "\n" + fin(RUN))]).procedure_ran).toBe(true);
  });
  test("fix 3: the saved record showing the run finished counts with no finish call", () => {
    const recs = [...call(L + " start --repo .", JSON.stringify({ runId: RUN })), ...call(L + " inspect " + RUN, "{}")];
    expect(fixed(recs, [{ runId: RUN, status: "finished" }]).procedure_ran).toBe(true);
    expect(fixed(recs, [{ runId: RUN, status: "interrupted" }]).procedure_ran).toBe(false);
    expect(fixed(recs).procedure_ran).toBe(false);
  });
});
