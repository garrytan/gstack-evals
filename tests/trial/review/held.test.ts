import { describe, expect, test } from "bun:test";
import { cappedParse } from "../../../src/trial/review/capped.ts";
import { parseFindings } from "../../../src/trial/review/findings.ts";
import { codeParse } from "../../../src/trial/review/held.ts";

const FENCE = "\u0060".repeat(3);
const block = (claim: string) => "Review done.\n\n" + FENCE + "json\n" + JSON.stringify([{ file: "src/a.ts", line: 1, severity: "CRITICAL", claim, evidence: "src/a.ts:1 changes the exported value." }]) + "\n" + FENCE + "\n";
const REPORT = block("The retry loop never backs off.");
const ACK = "The background check finished; my findings above stand.";
const BROKEN = "Revised.\n\n" + FENCE + "json\n[{\"file\": \"src/a.ts\", \"line\": 1, \"severity\": \"CRITICAL\", \"claim\": \"x\", \"evidence\": \"y\",}]\n" + FENCE + "\n";
const ended = (turns: string[], waited_ms?: number) => ({ termination: { kind: "completed" as const }, turns, ...(waited_ms === undefined ? {} : { session_end: { cause: "clean" as const, pending: [], waited_ms, released_wakeups: [] } }) });

describe("held.ts: the held-session read rule (GSTA-2's A1 ruling on #141)", () => {
  // Value: protects=A1: a completed code session that waited on its background work is scored from its latest main-agent turn with a findings block, so a turn the CLI takes after the report cannot erase it, and the same transcript from a session that never waited parses exactly as findings.ts does today (missing); fails_when=a held session's acknowledgement turn scores as finding nothing, or a session that never waited gains credit for an earlier block; why_new=the red team on #141 (parseFindings reads only the final turn); seam=codeParse; no_claim=the driver (r2.test.ts drives it)
  test("a session that waited scores from its latest findings turn; the same transcript that never waited is missing, as today", () => {
    for (const record of [ended([REPORT, ACK]), ended([REPORT, ACK], 0)]) {
      expect(parseFindings(record)).toEqual({ kind: "missing" });
      expect(codeParse(record, [REPORT, ACK], [0, 1])).toEqual({ parse: parseFindings(record), scored_turn: { rule: "final", index: 1, of: 2 } });
    }
    const waited = codeParse(ended([REPORT, ACK], 1_200), [REPORT, ACK], [0, 1]);
    expect(waited.scored_turn).toEqual({ rule: "held", index: 0, of: 2 });
    expect(waited.parse).toMatchObject({ kind: "findings", findings: [{ claim: "The retry loop never backs off." }] });
    const later = codeParse(ended([REPORT, block("The lock is never released."), ACK], 900), [REPORT, block("The lock is never released."), ACK], [0, 1, 2]);
    expect([later.scored_turn, later.parse]).toMatchObject([{ rule: "held", index: 1, of: 3 }, { kind: "findings", findings: [{ claim: "The lock is never released." }] }]);
  });

  // Value: protects=GSTA-2's round-2 A1 narrowing on #141: the held rule applies only when the final turn has no json block at all, so a waited session whose last turn holds a revised block with a trailing comma stays malformed, exactly as a session that never waited; fails_when=an earlier draft rescues a malformed final block; why_new=the round-2 red team on #141; seam=codeParse; no_claim=the driver
  test("a malformed final block stays malformed whether or not the session waited", () => {
    for (const waited of [undefined, 0, 1_200]) {
      const scored = codeParse(ended([REPORT, BROKEN], waited), [REPORT, BROKEN], [0, 1]);
      expect([scored.parse.kind, scored.scored_turn]).toEqual(["malformed", { rule: "final", index: 1, of: 2 }]);
    }
  });

  // Value: protects=the rule's edges: a waited session whose final turn holds a json block that is not findings (here a draft object, malformed) keeps the final-turn parse, so the held search never replaces a final-turn block, a cap stop keeps capped.ts's parse and records its turn, and a session that did not complete scores incomplete from no turn; fails_when=the held rule turns malformed into missing, changes a capped parse, or credits a deadline session; why_new=GSTA-2's A1 conditions on #141 (record the scored turn); seam=codeParse; no_claim=plan units (plan.ts walks back already)
  test("a waited session with no findings turn keeps the final-turn parse; cap stops keep capped.ts; an ended session scores from no turn", () => {
    const draft = "One more check.\n\n" + FENCE + "json\n{\"draft\": true}\n" + FENCE + "\n";
    const none = ended(["Waiting.", draft], 900);
    expect(codeParse(none, none.turns, [0, 1])).toEqual({ parse: parseFindings(none), scored_turn: { rule: "final", index: 1, of: 2 } });
    const capped = { termination: { kind: "turn_cap" as const }, turns: [REPORT, ACK] };
    expect(codeParse(capped, [REPORT, ACK], [0, 0])).toEqual({ parse: cappedParse([REPORT, ACK]), scored_turn: { rule: "capped", index: 0, of: 2 } });
    expect(codeParse(capped, [ACK], [0])).toEqual({ parse: { kind: "missing" }, scored_turn: { rule: "capped", index: null, of: 1 } });
    const deadline = { termination: { kind: "missing" as const, code: "E_BACKGROUND_DEADLINE" as const }, turns: [REPORT], session_end: { cause: "deadline" as const, pending: ["local_agent \"reader b\""], waited_ms: 5_000, released_wakeups: [] } };
    expect(codeParse(deadline, [REPORT], [0])).toEqual({ parse: parseFindings(deadline), scored_turn: { rule: "final", index: null, of: 1 } });
    expect(codeParse(deadline, [REPORT], [0]).parse.kind).toBe("incomplete");
  });

  // Value: protects=GSTA-2's Step 11 ruling on #141 (outside voice #1): the held rule reads the latest main-agent text that carries a json block, so a malformed revision written after a valid report stays malformed when an acknowledgement follows; fails_when=the backward search skips the malformed revision and scores the superseded report
  test("[valid, malformed, ack] in a waited session parses as malformed", () => {
    const scored = codeParse(ended([REPORT, BROKEN, ACK], 1_200), [REPORT, BROKEN, ACK], [0, 1, 2]);
    expect([scored.parse.kind, scored.scored_turn]).toEqual(["malformed", { rule: "held", index: 1, of: 3 }]);
  });

  // Value: protects=GSTA-2's Step 11 ruling on #141 (native #1): the held rule rescues only the GST-734 pattern, a block in an earlier CLI turn than the final text, so a report and a closing line in the same final turn score exactly as on main whether or not the session waited; fails_when=a waited session's same-turn closer is rescued while the never-waited one scores missing
  test("a report and a closing line in one turn score as on main, waited or not; a report in an earlier turn is rescued", () => {
    const saved = "Saved to review.md.";
    for (const waited of [undefined, 0, 1_200]) {
      const record = ended([REPORT, saved], waited);
      expect(codeParse(record, [REPORT, saved], [0, 0])).toEqual({ parse: parseFindings(record), scored_turn: { rule: "final", index: 1, of: 2 } });
    }
    const gst734 = codeParse(ended([REPORT, ACK], 1_200), [REPORT, ACK], [0, 1]);
    expect([gst734.parse.kind, gst734.scored_turn]).toEqual(["findings", { rule: "held", index: 0, of: 2 }]);
  });

  // Value: protects=GSTA-2's ruling B on #141 (fix-check 2): the held search reads only json blocks whose body starts with [ (attempted findings blocks), so a json object an earlier turn wrote (a plan) never turns a waited session's plain final text into a malformed gap, and an object between a report and an acknowledgement does not hide the report; fails_when=a non-array block in an earlier turn scores held or malformed, or shadows the report before it; why_new=the fix-check reader on 8a4c909; seam=codeParse; no_claim=the final turn (findings.ts parses it as on main)
  test("the held search ignores a json object in an earlier turn: a plan object then a plain closer is missing, and an object after a report leaves the report held", () => {
    const plan = "Plan:\n\n" + FENCE + "json\n{\"readers\": 2}\n" + FENCE + "\n";
    const closer = "No issues found.";
    const planned = ended([plan, closer], 1_200);
    expect(codeParse(planned, [plan, closer], [0, 1])).toEqual({ parse: { kind: "missing" }, scored_turn: { rule: "final", index: 1, of: 2 } });
    const between = codeParse(ended([REPORT, plan, ACK], 1_200), [REPORT, plan, ACK], [0, 1, 2]);
    expect([between.scored_turn, between.parse]).toMatchObject([{ rule: "held", index: 0, of: 3 }, { kind: "findings", findings: [{ claim: "The retry loop never backs off." }] }]);
  });
});
