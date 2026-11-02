import { describe, expect, test } from "bun:test";
import { cappedParse } from "../../../src/trial/review/capped.ts";
import { parseFindings } from "../../../src/trial/review/findings.ts";
import { codeParse } from "../../../src/trial/review/held.ts";

const FENCE = "\u0060".repeat(3);
const block = (claim: string) => "Review done.\n\n" + FENCE + "json\n" + JSON.stringify([{ file: "src/a.ts", line: 1, severity: "CRITICAL", claim, evidence: "src/a.ts:1 changes the exported value." }]) + "\n" + FENCE + "\n";
const REPORT = block("The retry loop never backs off.");
const ACK = "The background check finished; my findings above stand.";
const ended = (turns: string[], waited_ms?: number) => ({ termination: { kind: "completed" as const }, turns, ...(waited_ms === undefined ? {} : { session_end: { cause: "clean" as const, pending: [], waited_ms, released_wakeups: [] } }) });

describe("held.ts: the held-session read rule (GSTA-2's A1 ruling on #141)", () => {
  // Value: protects=A1: a completed code session that waited on its background work is scored from its latest main-agent turn with a findings block, so a turn the CLI takes after the report cannot erase it, and the same transcript from a session that never waited parses exactly as findings.ts does today (missing); fails_when=a held session's acknowledgement turn scores as finding nothing, or a session that never waited gains credit for an earlier block; why_new=the red team on #141 (parseFindings reads only the final turn); seam=codeParse; no_claim=the driver (r2.test.ts drives it)
  test("a session that waited scores from its latest findings turn; the same transcript that never waited is missing, as today", () => {
    for (const record of [ended([REPORT, ACK]), ended([REPORT, ACK], 0)]) {
      expect(parseFindings(record)).toEqual({ kind: "missing" });
      expect(codeParse(record, [REPORT, ACK])).toEqual({ parse: parseFindings(record), scored_turn: { rule: "final", index: 1, of: 2 } });
    }
    const waited = codeParse(ended([REPORT, ACK], 1_200), [REPORT, ACK]);
    expect(waited.scored_turn).toEqual({ rule: "held", index: 0, of: 2 });
    expect(waited.parse).toMatchObject({ kind: "findings", findings: [{ claim: "The retry loop never backs off." }] });
    const later = codeParse(ended([REPORT, block("The lock is never released."), ACK], 900), [REPORT, block("The lock is never released."), ACK]);
    expect([later.scored_turn, later.parse]).toMatchObject([{ rule: "held", index: 1, of: 3 }, { kind: "findings", findings: [{ claim: "The lock is never released." }] }]);
  });

  // Value: protects=the rule's edges: a waited session with no findings block anywhere keeps the final-turn parse (so a malformed or missing final turn is labelled as today), a cap stop keeps capped.ts's parse and records its turn, and a session that did not complete scores incomplete from no turn; fails_when=the held rule turns malformed into missing, changes a capped parse, or credits a deadline session; why_new=GSTA-2's A1 conditions on #141 (record the scored turn); seam=codeParse; no_claim=plan units (plan.ts walks back already)
  test("a waited session with no findings turn keeps the final-turn parse; cap stops keep capped.ts; an ended session scores from no turn", () => {
    const draft = "One more check.\n\n" + FENCE + "json\n{\"draft\": true}\n" + FENCE + "\n";
    const none = ended(["Waiting.", draft], 900);
    expect(codeParse(none, none.turns)).toEqual({ parse: parseFindings(none), scored_turn: { rule: "final", index: 1, of: 2 } });
    const capped = { termination: { kind: "turn_cap" as const }, turns: [REPORT, ACK] };
    expect(codeParse(capped, [REPORT, ACK])).toEqual({ parse: cappedParse([REPORT, ACK]), scored_turn: { rule: "capped", index: 0, of: 2 } });
    expect(codeParse(capped, [ACK])).toEqual({ parse: { kind: "missing" }, scored_turn: { rule: "capped", index: null, of: 1 } });
    const deadline = { termination: { kind: "missing" as const, code: "E_BACKGROUND_DEADLINE" as const }, turns: [REPORT], session_end: { cause: "deadline" as const, pending: ["local_agent \"reader b\""], waited_ms: 5_000, released_wakeups: [] } };
    expect(codeParse(deadline, [REPORT])).toEqual({ parse: parseFindings(deadline), scored_turn: { rule: "final", index: null, of: 1 } });
    expect(codeParse(deadline, [REPORT]).parse.kind).toBe("incomplete");
  });
});
