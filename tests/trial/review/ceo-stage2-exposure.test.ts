// The stage 2 amendment's sections 3.1 and 3.2 on the autoplan arm's two exposure checks, with invented paths and text.
// handoff_ceo_only reads the handoff's own line in a call's own result; findings_written reads the ceo-review.md copy on
// disk. Each describe block's first test fails at 715c659, the build the stage 1 smoke ran.
import { describe, expect, test } from "bun:test";
import { autoplanCeoExposure } from "../../../src/trial/review/ceo-exposure.ts";

type Msg = Record<string, unknown>;
let n = 0;
const call = (name: string, input: Msg, result: string): Msg[] => {
  const id = "toolu_s2_" + ++n;
  return [
    { type: "assistant", message: { content: [{ type: "tool_use", id, name, input }] }, parent_tool_use_id: null },
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content: result, is_error: false }] }, parent_tool_use_id: null },
  ];
};
const nd = (...parts: Msg[][]) => parts.flat().map((m) => JSON.stringify(m)).join("\n") + "\n";
const bash = (command: string, result: string) => call("Bash", { command }, result);

const BIN = "~/.claude/skills/gstack/bin/";
const LINE = "Auto-selected review mode \u2192 HOLD SCOPE (CEO-only run: Step 0E's rule). Approved decisions: none.";
const CALL = BIN + 'gstack-ceo-mode-handoff "HOLD SCOPE" --ceo-only --decisions "none"';
const AP = "/work/agent/.gstack/projects/demo/autoplan-run-7";
const REVIEW = "# CEO-only review: a queue for the uploads\nMode: HOLD SCOPE.\n## Findings\n- High, Section 2: the retry has no bound. Fix: cap it at three.\n";
const NO_FINDINGS = "# CEO-only review: a queue for the uploads\nMode: HOLD SCOPE.\n";
const DISK = { copies: [REVIEW], copy_failed: false };
const handoff = (command: string, result: string) => autoplanCeoExposure(nd(bash(command, result)), DISK).checks.handoff_ceo_only;
const findings = (transcript: string, disk: { copies: string[]; copy_failed: boolean }) => autoplanCeoExposure(transcript, disk).checks.findings_written;
const handoffRun = bash(CALL, LINE);

describe("3.1: handoff_ceo_only reads the handoff's own line in the call's own result", () => {
  // Value: protects=a real handoff call inside a compound command counts; fails_when=a ; chain of other commands, || true segments and other gstack bin calls before the handoff reads not run; why_new=stage 2 amendment 3.1 (Sol's smoke unit 1 grammar class); seam=autoplanCeoExposure; no_claim=a session's exact command, which stays under custody
  test("Sol's smoke class: a ; chain of other commands, || true segments and gstack bin calls, then the handoff, reads run", () => {
    const chain = [
      "cd /work/agent/plan-demo",
      "git log --oneline --no-color --max-count=3",
      "ls .gstack",
      "test -d .gstack/projects || true",
      'head -n 3 "notes/plan-status.md" || true',
      "mkdir -p .gstack/scratch || true",
      BIN + "gstack-config get proactive",
      BIN + "gstack-slug",
      BIN + "gstack-repo-mode",
      BIN + "gstack-learnings-search --limit 2",
      CALL,
    ].join("; ");
    const result = ["a1b2c3d widen the cache", "projects", "ok", "slug: demo", "solo", LINE].join("\n");
    expect(handoff(chain, result)).toBe(true);
  });
  test("cd, export, set -e, $(...), && and ; chains and a filter pipe read run once the result holds the line", () => {
    for (const c of ["cd " + AP + " && " + CALL, "export X=1; " + CALL, "set -e; " + CALL, 'echo "$(' + CALL + ')"', CALL + " | tee /tmp/h.txt", CALL + " 2>&1 | head -n 5"]) expect([c, handoff(c, LINE)]).toEqual([c, true]);
  });
  test("an echo of the line with the handoff named only in a comment reads not run", () => {
    expect(handoff('echo "' + LINE + '" # ' + CALL, LINE)).toBe(false);
  });
  test("--auto never counts", () => {
    expect(handoff(CALL + " --auto", LINE)).toBe(false);
    expect(handoff(BIN + 'gstack-ceo-mode-handoff "HOLD SCOPE" --auto --ceo-only --decisions "none"', LINE)).toBe(false);
  });
  test("output sent away never counts, even when another segment prints a copy", () => {
    for (const c of [CALL + " > /dev/null", CALL + " >> " + AP + "/h.txt", CALL + " &> /dev/null", CALL + " 1>/dev/null; printf '%b\\n' '\\x41uto-selected review mode \\u2192 HOLD SCOPE'"]) expect([c, handoff(c, LINE)]).toEqual([c, false]);
  });
  test("the handoff must be its segment's command word with a mode first", () => {
    for (const c of ["true " + CALL, "echo " + CALL, BIN + "gstack-ceo-mode-handoff --ceo-only \"HOLD SCOPE\" --decisions none"]) expect([c, handoff(c, LINE)]).toEqual([c, false]);
  });
  test("note L: a printed line beside a no-op that names the handoff reads not run", () => {
    expect(handoff("printf '%s\\n' '" + LINE + "'; : gstack-ceo-mode-handoff --ceo-only", LINE)).toBe(false);
  });
  test("note M: a printf with an escaped prefix beside a no-op that names the handoff reads not run", () => {
    expect(handoff("printf '\\x41uto-selected review mode \\u2192 HOLD SCOPE (CEO-only run: Step 0E\\x27s rule). Approved decisions: none.\\n'; : " + CALL, LINE)).toBe(false);
  });
  test("the result needs exactly one line of the form, with one of the four modes", () => {
    expect(handoff(CALL, LINE + "\n" + LINE)).toBe(false);
    expect(handoff(CALL, LINE.replace("HOLD SCOPE", "HOLD_SCOPE"))).toBe(false);
    expect(handoff(CALL, "x " + LINE)).toBe(false);
  });
});

describe("3.2: findings_written reads the ceo-review.md copy on disk", () => {
  // Value: protects=findings_written follows the file the session left, so a Bash write form can't fail open or closed; fails_when=the transcript parser decides it; why_new=stage 2 amendment 3.2 (Opus's smoke unit 2 grammar class, #235 note 10); seam=autoplanCeoExposure; no_claim=a session's exact command, which stays under custody
  const heredoc = (body: string, quoted: boolean) => {
    const d = quoted ? "'EOR'" : "EOR";
    return ["cd " + AP + " ; mkdir -p " + AP + "/notes && grep -q demo " + AP + "/index.md " + AP + "/plan.md || echo " + AP + " >> " + AP + "/notes/seen.txt ; cat > " + AP + "/ceo-review.md << " + d, ...body.split("\n"), "EOR", 'echo "written"'].join("\n");
  };
  test("Opus's smoke class: a chained heredoc write whose copy holds the heading reads written", () => {
    const body = Array.from({ length: 22 }, (_, i) => (i === 8 ? "## Findings" : "Line " + i + " of the review."));
    const t = nd(handoffRun, bash(heredoc(body.join("\n"), true), "written"));
    expect(t.length).toBeGreaterThan(0);
    expect(findings(t, { copies: [body.join("\n")], copy_failed: false })).toBe(true);
  });
  test("note 10's multi-line ${...} form reads unwritten when the copy lacks the heading", () => {
    const t = nd(handoffRun, bash("cat > " + AP + "/ceo-review.md <<EOR\n" + NO_FINDINGS + "${UNSET:+\n## Findings\n- High: none.\n}\nEOR", ""));
    expect(findings(t, { copies: [NO_FINDINGS + "\n"], copy_failed: false })).toBe(false);
  });
  test("a missing copy reads unwritten, whatever the transcript wrote", () => {
    const t = nd(handoffRun, call("Write", { file_path: AP + "/ceo-review.md", content: REVIEW }, "File created successfully"));
    expect(findings(t, { copies: [], copy_failed: false })).toBe(false);
  });
  test("a logged copy-out failure reads unwritten, even with a copy that holds the heading", () => {
    const t = nd(handoffRun, call("Write", { file_path: AP + "/ceo-review.md", content: REVIEW }, "File created successfully"));
    expect(findings(t, { copies: [REVIEW], copy_failed: true })).toBe(false);
    expect(findings(t, { copies: [REVIEW], copy_failed: false })).toBe(true);
  });
  test("any one copy with the heading counts; prose that mentions it does not", () => {
    expect(findings(nd(handoffRun), { copies: [NO_FINDINGS, REVIEW], copy_failed: false })).toBe(true);
    expect(findings(nd(handoffRun), { copies: [NO_FINDINGS + "See ## Findings below.\n"], copy_failed: false })).toBe(false);
  });
});
