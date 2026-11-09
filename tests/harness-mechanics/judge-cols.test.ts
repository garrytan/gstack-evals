// Copyright (c) 2026 Garry Tan. MIT License.
// Unit 7's judge columns and the done hook's facts (lanes/harness-mechanics/judge.ts).
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HmRowIn } from "../../lanes/harness-mechanics/analyze.ts";
import { doneFacts, jevChanges, JEV_MODEL, judgeColumns, meterJournal, readHookLog, withJournalIds, type HookLine } from "../../lanes/harness-mechanics/judge.ts";
import { loadMatcher } from "../../lanes/harness-mechanics/match.ts";
import { REPO } from "../../lanes/harness-mechanics/pins.ts";

const base = { point: "done", rule: null, backend: "jev", p_jev: 0.1, escalated: false, answer: "no", acted: true, latency_ms: 0, calls: 1, req_digest: "d", journal_id: null, fail_open: false, error: null, jev_version: null } as HookLine;
const L = [
  { ...base, rule: "read_only_list", backend: null, calls: 0, latency_ms: 0 },
  { ...base, latency_ms: 120 },
  { ...base, escalated: true, latency_ms: 900, calls: 2 },
  { ...base, fail_open: true, calls: null, latency_ms: 2003 },
  { ...base, latency_ms: 50 },
] as HookLine[];
const tx = (lines: object[]) => lines.map((l) => JSON.stringify({ cwd: "/testbed", ...l })).join("\n") + "\n";
const use = (id: string, name: string, input: object) => ({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id, name, input }] } });
const result = (id: string, content: string, is_error = false) => ({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content, is_error }] } });
const say = (text: string) => ({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text }] } });

describe("judge columns", () => {
  const dir = mkdtempSync(join(tmpdir(), "hm-judge-cols-")), journal = join(dir, "journal.ndjson");
  const req = (rid: string, meter: string, max: number) => ({ kind: "request", reservation_id: rid, cell: { meter_id: meter }, max_micros: max });
  const out = (rid: string, meter: string, outcome: object) => ({ kind: "outcome", reservation_id: rid, meter_id: meter, outcome });
  writeFileSync(journal, [req("r1", "m1", 9000), out("r1", "m1", { kind: "spent", spent_micros: 1000 }), req("x1", "m2", 9000), out("x1", "m2", { kind: "spent", spent_micros: 7000 }),
    req("r2", "m1", 9000), out("r2", "m1", { kind: "spent", spent_micros: 2000 }), req("r3", "m1", 5000), out("r3", "m1", { kind: "unknown" }), req("r4", "m1", 9000)].map((l) => JSON.stringify(l)).join("\n") + "\n");

  test("the meter's requests in order, and its spend with an unknown outcome at its worst case", () => {
    expect(meterJournal(journal, "m1")).toEqual({ requests: ["r1", "r2", "r3", "r4"], spent_micros: 8000 });
    expect(meterJournal(join(dir, "missing"), "m1")).toEqual({ requests: [], spent_micros: 0 });
  });

  test("journal ids follow each line's calls, and stop after a line whose calls are unknown", () => {
    expect(withJournalIds(L, ["r1", "r2", "r3", "r4"]).map((l) => l.journal_id)).toEqual([null, ["r1"], ["r2", "r3"], null, null]);
  });

  test("the columns on judge rows only, the hook spend added to cost_usd; a bad line or a missing log fails hook_log", () => {
    const log = L.map((l) => JSON.stringify(l)).join("\n") + "\n";
    const row = (arm: string, trial: string) => ({ arm, model: "opus", task: "t1", trial, cost_usd: 0.5 }) as unknown as HmRowIn;
    const s = (trial: string, text: string | null) => ({ arm: "judge-jev", model: "opus", task: "t1", trial, log: text, journal, meter_id: "m1" });
    const [a, b, c, n] = judgeColumns([row("judge-jev", "1"), row("judge-jev", "2"), row("judge-jev", "3"), row("none", "1")], [s("1", log), s("2", log + "{bad\n"), s("3", null)]);
    expect(a).toMatchObject({ hook_time_s: 3.073, hook_cost_usd: 0.008, hook_log: true, fail_open: 1, escalations: 1, cost_usd: 0.508 });
    expect(b!.hook_log).toBe(false);
    expect(c).toMatchObject({ hook_log: false, fail_open: 0, hook_time_s: 0 });
    expect(n).toEqual(row("none", "1"));
    expect(readHookLog("").ok).toBe(true);
  });

  test("Jev's version: the pin is deciders.py's, and any other version is a change", () => {
    expect(readFileSync(join(REPO, "lanes/decision-routing/agent/dr_agent/deciders.py"), "utf8")).toContain('JEV_MODEL = "' + JEV_MODEL + '"');
    expect(jevChanges([{ ...base, jev_version: "jev-1.14.0" }, { ...base, jev_version: JEV_MODEL }, base]).length).toBe(1);
  });
  test("E1: a line whose session stopped on an unknown Jev version is a change", () => {
    expect(jevChanges([{ ...base, stopped: true, error: "E_HM_JEV_VERSION the TypeSafe response's model attribute is absent" }, { ...base, stopped: false }]).length).toBe(1);
  });
});

describe("the done hook's facts", () => {
  const edit = [use("t1", "Edit", { file_path: "/testbed/a.py", old_string: "a", new_string: "b" }), result("t1", "ok")];
  test("the last check after the last edit, with its error flag, and the claim", () => {
    const f = doneFacts(tx([...edit, use("t2", "Bash", { command: "python -m pytest -q tests/test_a.py" }), result("t2", "===== 3 passed in 0.10s ====="), say("Done.\nSTATUS: FIXED")]));
    expect(f).toMatchObject({ claims_done: true, check: { cmd: "python -m pytest -q tests/test_a.py", is_error: false }, edited_files: ["/testbed/a.py"] });
    const g = doneFacts(tx([...edit, use("t2", "Bash", { command: "python -m pytest -q" }), result("t2", "===== 1 failed in 0.10s =====", true), say("STATUS: NOT FIXED")]));
    expect(g).toMatchObject({ claims_done: false, check: { is_error: true } });
  });
  test("the bundled facts.js gives the same facts from a folder outside the repo", () => {
    const d = mkdtempSync(join(tmpdir(), "hm-facts-")), t = join(d, "t.jsonl"), re = join(d, "match.re");
    const text = tx([...edit, use("t2", "Bash", { command: "python -m pytest -q tests/test_a.py" }), result("t2", "===== 3 passed in 0.10s ====="), say("Done.\nSTATUS: FIXED")]);
    writeFileSync(t, text);
    writeFileSync(re, loadMatcher().match.regex);
    const b = spawnSync(process.execPath, ["build", "lanes/harness-mechanics/judge.ts", "--target=bun", "--outfile", join(d, "facts.js")], { cwd: REPO, encoding: "utf8" });
    expect(b.status).toBe(0);
    const r = spawnSync(process.execPath, [join(d, "facts.js"), "facts", t, "--regex", re], { cwd: d, encoding: "utf8" });
    expect({ status: r.status, err: r.stderr }).toEqual({ status: 0, err: "" });
    expect(JSON.parse(r.stdout)).toEqual(doneFacts(text));
  }, 60_000);
  test("a check before the last edit is not the last check", () => {
    const f = doneFacts(tx([use("t0", "Bash", { command: "python -m pytest -q" }), result("t0", "===== 3 passed in 0.10s ====="), ...edit, say("STATUS: FIXED")]));
    expect(f.check).toBeNull();
  });
});
