// The read audit (src/trial/review/audit.ts; panel v3 plan, sections 4 and 5): every tool call in a session's
// transcript.ndjson, the main agent's and each subagent's, is classed by what it touched. A non-error touch of a path
// with a .capy segment is contamination in every arm; in the none and lens arms a gstack skill file, anything under
// .local/share/gstack and a gstack-* command are contamination too. A touch whose result is an error is printed and
// never counts unless its Bash command is compound, a call with no result counts as done, and printed targets show HOME as ~ and /work/<task> as <unit>.
// Every transcript here is built in code, with a fake home made at runtime; nothing on this machine is read.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removeTree } from "../../../src/trial/cleanup.ts";
import { auditTranscript, touchLine } from "../../../src/trial/review/audit.ts";
import type { PlanArm } from "../../../src/trial/review/plan.ts";

const HOME = mkdtempSync(join(tmpdir(), "audit-home-"));
afterAll(() => removeTree(HOME));
const WORK = "/work/example-plan-7-1a2b3c4d";
const ARMS: PlanArm[] = ["none", "lens", "placebo", "gstack", "gstack-auto"];
const DRIVE = join(HOME, ".capy", "drive", "x");
const DRIVE_SHOWN = "~/" + [".capy", "drive", "x"].join("/");
const SKILL = join(HOME, ".claude", "skills", "gstack", "plan-ceo-review", "SKILL.md");
const SKILL_SHOWN = "~/.claude/skills/gstack/plan-ceo-review/SKILL.md";

type Msg = Record<string, unknown>;
const call = (id: string, name: string, input: Record<string, unknown>, parent: string | null = null): Msg => ({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id, name, input }] }, parent_tool_use_id: parent, session_id: "s" });
const result = (id: string, isError = false, parent: string | null = null): Msg => ({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: isError ? "Error: no such file or directory" : "ok", is_error: isError }] }, parent_tool_use_id: parent, session_id: "s" });
const ndjson = (...messages: Msg[]) => messages.map((m) => JSON.stringify(m)).join("\n") + "\n";
const audit = (text: string, arm: PlanArm) => auditTranscript(text, { arm, home: HOME, work: WORK });
/** Each arm's touches as [class, target, error, contaminated]. */
const byArm = (text: string) => Object.fromEntries(ARMS.map((arm) => [arm, audit(text, arm).map((t) => [t.class, t.target, t.error, t.contaminated])]));

describe("the read audit (GEVA-203, keyless)", () => {
  // Value: protects=a session that touches only its unit and plain commands yields no touch in any arm; fails_when=a plain Read, Grep or Bash under /work is classed, so a clean arm reads untested; why_new=C1 adds the read audit to every plan session; seam=auditTranscript; no_claim=what a real session reads
  test("a clean session has no touch in any arm", () => {
    const text = ndjson({ type: "system", subtype: "init" }, call("t1", "Read", { file_path: WORK + "/plan.md" }), result("t1"), call("t2", "Bash", { command: "ls " + WORK + " && git log --oneline -3" }), result("t2"), call("t3", "Grep", { pattern: "rollout", path: WORK }), result("t3"));
    for (const arm of ARMS) expect([arm, audit(text, arm)]).toEqual([arm, []]);
  });

  // Value: protects=a read under the home's Capy drive is contamination in every arm, gstack included, because the drive holds sealed material; fails_when=any arm, gstack or placebo among them, reads it clean; why_new=FOUN-32's rule from GGST-6 (a read under ~/.capy counts in any arm); seam=auditTranscript's capy class; no_claim=a drive mounted under another home, which the clean room keeps out
  test("a drive read is contaminated in every arm, gstack included", () => {
    const text = ndjson(call("t1", "Read", { file_path: DRIVE }), result("t1"));
    for (const arm of ARMS) expect([arm, audit(text, arm)]).toEqual([arm, [{ tool: "Read", class: "capy", target: DRIVE_SHOWN, error: false, contaminated: true }]]);
  });

  // Value: protects=a gstack skill file read is contamination in the none and lens arms only, and a gstack arm reading its own skill is not; fails_when=the none or lens arm reads a SKILL.md clean, or a gstack, gstack-auto or placebo arm is marked untested for its own install; why_new=panel v3 section 4 (a no-gstack arm that read a gstack skill file is untested); seam=auditTranscript's skill class and its bare-arm rule; no_claim=exposure of the gstack arm, which the readings script reads
  test("a skill read is contaminated in none and lens, and a gstack arm reading its own skill is not", () => {
    const text = ndjson(call("t1", "Read", { file_path: SKILL }), result("t1"), call("t2", "Read", { file_path: join(HOME, ".claude", "skills", "gstack", "review", "sections", "specialists.md") }), result("t2"));
    const sections = "~/.claude/skills/gstack/review/sections/specialists.md";
    const as = (contaminated: boolean) => [["skill", SKILL_SHOWN, false, contaminated], ["skill", sections, false, contaminated]];
    expect(byArm(text)).toEqual({ none: as(true), lens: as(true), placebo: as(false), gstack: as(false), "gstack-auto": as(false) });
    expect(audit(text, "gstack").map(touchLine)).toEqual(["Read skill " + SKILL_SHOWN, "Read skill " + sections]);
    expect(audit(ndjson(call("t1", "Read", { file_path: DRIVE }), result("t1")), "gstack").map(touchLine)).toEqual(["Read capy " + DRIVE_SHOWN + " (contamination)"]);
  });

  // Value: protects=a read whose tool_result is an error (a missing file) is printed and never contamination, in any arm; fails_when=a failed attempt marks the arm untested, or the attempt is dropped from the printed audit; why_new=audit.ts's error rule; seam=auditTranscript's tool_result is_error map, touchLine; no_claim=a tool that reports failure without is_error
  test("a failed attempt is printed and never contamination", () => {
    const text = ndjson(call("t1", "Read", { file_path: DRIVE }), result("t1", true), call("t2", "Read", { file_path: SKILL }), result("t2", true));
    for (const arm of ARMS) expect([arm, audit(text, arm).map((t) => [t.class, t.error, t.contaminated])]).toEqual([arm, [["capy", true, false], ["skill", true, false]]]);
    expect(audit(text, "none").map(touchLine)).toEqual(["Read capy " + DRIVE_SHOWN + " (error, not contamination)", "Read skill " + SKILL_SHOWN + " (error, not contamination)"]);
  });

  // Value: protects=an error clears a Bash call's touches only for a single simple command: a compound command that read a drive file before a later part failed stays contaminated, in a none arm and a gstack arm alike, while a simple command that errors stays clean; fails_when="cat <drive file>; false" returns the file and reads clean, or a failed simple cat marks the arm untested; why_new=PR #166 review (O1); seam=auditTranscript's error rule for Bash; no_claim=how a shell parses quoting, which the rule does not read
  test("a compound Bash command that errors after a drive read stays contaminated; a simple one that errors does not", () => {
    const failed = (id: string, content: string): Msg => ({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content, is_error: true }] }, parent_tool_use_id: null, session_id: "s" });
    const compound = ndjson(call("t1", "Bash", { command: "cat " + DRIVE + "; false" }), failed("t1", "sealed notes\n"));
    for (const arm of ["none", "gstack"] as const) expect([arm, audit(compound, arm)]).toEqual([arm, [{ tool: "Bash", class: "capy", target: DRIVE_SHOWN, error: false, contaminated: true }]]);
    expect(audit(compound, "none").map(touchLine)).toEqual(["Bash capy " + DRIVE_SHOWN + " (contamination)"]);
    const simple = ndjson(call("t1", "Bash", { command: "cat " + DRIVE }), failed("t1", "cat: no such file or directory"));
    for (const arm of ["none", "gstack"] as const) expect([arm, audit(simple, arm)]).toEqual([arm, [{ tool: "Bash", class: "capy", target: DRIVE_SHOWN, error: true, contaminated: false }]]);
  });

  // Value: protects=R2S1 (#166 /ship round 2, the Captain's ruling on GST-1121): only ;, &&, ||, | and a background & separate commands (a newline, a subshell and a command substitution run commands of their own too), and the & or | of a redirection such as 2>&1 separates nothing, so a failed `ls <path> 2>&1` in a none or lens arm reads clean while every real compound that errors stays contaminated; fails_when=a redirection makes a simple command compound, so one failed ls marks the arm untested, or a real compound loses its touches on error; why_new=GST-1121 (R2S1, a regression from round 1's O1 fix); seam=auditTranscript's error rule for Bash; no_claim=quoting, which the rule does not read
  test("R2S1: an errored simple command with a redirection reads clean; an errored compound stays contaminated", () => {
    const failed = (id: string, content: string): Msg => ({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content, is_error: true }] }, parent_tool_use_id: null, session_id: "s" });
    const skills = join(HOME, ".claude", "skills", "gstack", "SKILL.md");
    const shown = "~/.claude/skills/gstack/SKILL.md";
    const touch = (command: string) => audit(ndjson(call("t1", "Bash", { command }), failed("t1", "ls: cannot access: No such file or directory")), "none").map((t) => [t.target, t.error, t.contaminated]);
    for (const command of ["ls " + skills + " 2>&1", "ls " + skills + " 2>/dev/null", "cat " + skills + " >&2", "cat " + skills + " 1>&-", "cat " + skills + " &>/dev/null", "cat " + skills + " &>>log", "cat " + skills + " >|out", "cat " + skills + " 0<&3"]) expect([command, touch(command)]).toEqual([command, [[shown, true, false]]]);
    for (const command of ["ls " + skills + " 2>&1 | head -5", "cat " + skills + " 2>&1; false", "cat " + skills + " && false", "cat " + skills + " || false", "cat " + skills + " |& head", "cat " + skills + " &", "cat " + skills + " & false", "cat " + skills + "\nfalse", "(cat " + skills + ")", "echo $(cat " + skills + ")", "echo `cat " + skills + "`"]) expect([command, touch(command)]).toEqual([command, [[shown, false, true]]]);
  });

  // Value: protects=P2-3 (#176 /ship pass 2, the Captain's ruling): the read audit reads no quotes, so a backslash-escaped quote cannot hide a separator and an errored compound that read a gstack file stays contaminated (it fails closed; a quoted separator makes a compound too, an open note owned by the E1 prereg); fails_when=quote handling returns and an escaped quote opens a fake quoted span that excuses the read; why_new=GST-1121 (P2-3, the pass 2 Red Team's probe of S3, which is reverted); seam=auditTranscript's error rule for Bash; no_claim=quoted separators, which the rule counts as compound by design
  test("P2-3: an escaped quote hides no separator, so an errored compound that read a gstack file stays contaminated", () => {
    const failed = (id: string): Msg => ({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: "ls: cannot access 'nope': No such file or directory", is_error: true }] }, parent_tool_use_id: null, session_id: "s" });
    for (const command of ['echo \\"; cat ~/.local/share/gstack/review/SKILL.md; ls nope; echo "done"', "echo \\'; cat ~/.local/share/gstack/review/SKILL.md; false; echo 'ok'"]) {
      const touches = audit(ndjson(call("t1", "Bash", { command }), failed("t1")), "none");
      expect([command, touches.length > 0, touches.every((t) => !t.error && t.contaminated)]).toEqual([command, true, true]);
    }
  });

  // Value: protects=FT3 (#176's final readers, the Captain's ruling): the audit expands ~, $HOME and ${HOME}, normalizes each path, and counts any path with a .capy segment in either form, failing closed, so a relative (../.capy), dotted (~/./.capy), doubled-slash, cd-relative or $HOME-built ("$HOME"/.capy) path is contamination in every arm, and a dotted .local/share/./gstack path is a gstack touch; a path that only holds capy in a name (capybara.md, .capybara/, my.capy.md, src/capy/) is no touch; fails_when=a relative or non-normalized .capy path reads clean, or a name that holds capy marks an arm untested; why_new=GST-1175 (FT3); seam=auditTranscript's pathClasses; no_claim=a path the shell builds at run time from other variables or a script file
  test("FT3: relative, dotted and $HOME-built .capy paths count in every arm; a name that only holds capy does not", () => {
    const counts: [string, Record<string, unknown>][] = [
      ["Read", { file_path: "../.capy/drive/x/notes.md" }],
      ["Read", { file_path: "~/./.capy/drive/x" }],
      ["Read", { file_path: HOME + "//.capy/drive/x" }],
      ["Glob", { pattern: "*.md", path: HOME + "/work/../.capy/drive" }],
      ["Bash", { command: 'cat "$HOME"/.capy/drive/x' }],
      ["Bash", { command: "cat ${HOME}/./.capy/drive/x" }],
      ["Bash", { command: "cd ~ && cat .capy/drive/x" }],
    ];
    for (const [tool, input] of counts) for (const arm of ARMS) expect([tool, input, arm, audit(ndjson(call("t1", tool, input), result("t1")), arm).some((t) => t.class === "capy" && t.contaminated)]).toEqual([tool, input, arm, true]);
    expect(audit(ndjson(call("t1", "Read", { file_path: "~/.local/share/./gstack/review/checklist.md" }), result("t1")), "none").map((t) => [t.class, t.contaminated])).toEqual([["gstack", true]]);
    const clean: [string, Record<string, unknown>][] = [
      ["Read", { file_path: WORK + "/capybara.md" }],
      ["Read", { file_path: "~/.capybara/notes" }],
      ["Bash", { command: "cat docs/my.capy.md src/capy/index.ts" }],
      ["Grep", { pattern: "capy", path: WORK }],
    ];
    for (const [tool, input] of clean) for (const arm of ARMS) expect([tool, input, arm, audit(ndjson(call("t1", tool, input), result("t1")), arm)]).toEqual([tool, input, arm, []]);
  });

  // Value: protects=a subagent's tool call (parent_tool_use_id set) is audited the same as the main agent's; fails_when=a none arm launches a subagent that reads a skill or drive file and stays clean; why_new=audit.ts reads every tool call, the main agent's and each subagent's; seam=auditTranscript over sidechain messages; no_claim=a subagent whose transcript is written elsewhere
  test("a subagent's call counts the same as the main agent's", () => {
    const text = ndjson(call("a1", "Agent", { description: "Read the plan", prompt: "Read plan.md and summarize it." }), call("t1", "Read", { file_path: SKILL }, "a1"), result("t1", false, "a1"), call("t2", "Read", { file_path: DRIVE }, "a1"), result("t2", false, "a1"), result("a1"));
    expect(audit(text, "none")).toEqual([{ tool: "Read", class: "skill", target: SKILL_SHOWN, error: false, contaminated: true }, { tool: "Read", class: "capy", target: DRIVE_SHOWN, error: false, contaminated: true }]);
    expect(audit(text, "gstack").map((t) => t.contaminated)).toEqual([false, true]);
  });

  // Value: protects=a Bash command that cats a file under .local/share/gstack (spelled from HOME or ~) or runs a gstack-* command, after an env assignment too, is contamination in none and lens and not in the gstack arms; fails_when=Bash reads slip past the audit, or a gstack arm's own commands mark it untested; why_new=panel v3 section 4 (a gstack-* command counts); seam=auditTranscript's Bash word and segment split; no_claim=a command that reaches gstack through a variable or a script file
  test("Bash: a cat under .local/share/gstack and a gstack-* command are contaminated in none and lens", () => {
    const text = ndjson(call("t1", "Bash", { command: "cat " + join(HOME, ".local", "share", "gstack", "config.yaml") }), result("t1"), call("t2", "Bash", { command: "cd " + WORK + " && GSTACK_HOME=/opt/x gstack-config get proactive" }), result("t2"), call("t3", "Bash", { command: "cat ~/.local/share/gstack/state.json | head -5" }), result("t3"));
    const as = (contaminated: boolean) => [["gstack", "~/.local/share/gstack/config.yaml", false, contaminated], ["command", "gstack-config", false, contaminated], ["gstack", "~/.local/share/gstack/state.json", false, contaminated]];
    expect(byArm(text)).toEqual({ none: as(true), lens: as(true), placebo: as(false), gstack: as(false), "gstack-auto": as(false) });
  });

  // Value: protects=a call with no tool_result (the session ended before it came back) counts as done; fails_when=a missing result reads as an error, so an unanswered drive or skill read escapes the audit; why_new=audit.ts's no-result rule; seam=auditTranscript; no_claim=none beyond protects
  test("a call with no result counts as done", () => {
    const text = ndjson(call("t1", "Read", { file_path: DRIVE }), call("t2", "Read", { file_path: SKILL }));
    expect(byArm(text)).toMatchObject({ none: [["capy", DRIVE_SHOWN, false, true], ["skill", SKILL_SHOWN, false, true]], gstack: [["capy", DRIVE_SHOWN, false, true], ["skill", SKILL_SHOWN, false, false]] });
  });

  // Value: protects=the printed target replaces the session's HOME with ~ and its /work/<task> with <unit>, so a log or arm.json carries no machine path; fails_when=a raw home or work path is printed, or touchLine's suffixes change; why_new=audit.ts's printed form, which arm.json's untested paths reuse; seam=touchLine; no_claim=paths outside HOME and the unit, printed as written
  test("the printed target shows HOME as ~ and /work/<task> as <unit>", () => {
    const text = ndjson(call("t1", "Read", { file_path: WORK + "/.claude/skills/gstack/SKILL.md" }), result("t1"), call("t2", "Grep", { pattern: "rollout", path: join(HOME, ".capy") }), result("t2"));
    expect(audit(text, "none").map(touchLine)).toEqual(["Read skill <unit>/.claude/skills/gstack/SKILL.md (contamination)", "Grep capy ~/.capy (contamination)"]);
    expect(audit(text, "gstack").map(touchLine)).toEqual(["Read skill <unit>/.claude/skills/gstack/SKILL.md", "Grep capy ~/.capy (contamination)"]);
    expect(audit(text, "none").map((t) => t.target).join(" ")).not.toContain(HOME);
  });
});
