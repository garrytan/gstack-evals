// The G exposure detectors (G admission prereg section 5; O1), keyless, in both directions. Each base fixture is a told
// session record as real_agent writes sdk-messages.jsonl, with the skill run in turn t2 the way the pin's files direct it;
// each mutation breaks one rule the detector reads and must read unexposed, and each alternative the pin allows must still
// read exposed. Text a session never wrote (the injected skill body, a tool result, turn 1's plan, a subagent's output)
// never counts.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { autoplanExposure, detectExposure, planEngReviewExposure, readTranscript, type ExposureRead } from "../../lanes/outcome-skills/arms/exposure.ts";

const FIX = join(import.meta.dir, "fixtures");
type Rec = Record<string, any>;
const load = (name: string): Rec[] => structuredClone(readTranscript(join(FIX, name)).records) as Rec[];
const blocks = (rs: Rec[]) => rs.flatMap((r) => (Array.isArray(r.content) ? r.content : []));
const withUse = (rs: Rec[], id: string) => rs.find((r) => Array.isArray(r.content) && r.content.some((b: Rec) => b.type === "tool_use" && b.id === id))!;
const withResult = (rs: Rec[], id: string) => rs.find((r) => Array.isArray(r.content) && r.content.some((b: Rec) => b.type === "tool_result" && b.tool_use_id === id))!;
const useOf = (rs: Rec[], id: string) => blocks(rs).find((b) => b.type === "tool_use" && b.id === id)!;
const resultOf = (rs: Rec[], id: string) => blocks(rs).find((b) => b.type === "tool_result" && b.tool_use_id === id)!;
const dropCall = (rs: Rec[], id: string) => rs.filter((r) => r !== withUse(rs, id) && r !== withResult(rs, id));
const textRecord = (rs: Rec[], re: RegExp) => rs.find((r) => r.type === "AssistantMessage" && r.content.some((b: Rec) => b.type === "text" && re.test(b.text)))!;
const retext = (rs: Rec[], re: RegExp, to: string) => {
  for (const b of blocks(rs)) if (b.type === "text" && typeof b.text === "string") b.text = b.text.replace(re, to);
  return rs;
};
const dropText = (rs: Rec[], re: RegExp) => rs.filter((r) => r !== textRecord(rs, re));
const callRecords = (rs: Rec[], id: string) => [withUse(rs, id), withResult(rs, id)];
const failed = (r: ExposureRead) => [r.exposed, r.failed];
const turn1Only = (rs: Rec[]) => rs.filter((r) => r.phase === "t1");

describe("plan-eng-review exposure: review-sections read, Step 0 Scope Challenge, Sections 1 to 4 in order, a test plan written", () => {
  const base = () => load("plan-eng-review-exposed.jsonl");

  test("the exposed fixture reads exposed, with every check true", () => {
    const r = planEngReviewExposure(base());
    expect(r).toMatchObject({ skill: "plan-eng-review", exposed: true, failed: null, checks: { review_sections_read: true, scope_challenge: true, sections_in_order: true, test_plan_written: true } });
    expect(detectExposure("plan-eng-review", base())).toEqual(r);
  });

  test("the review-sections file not read, read with an error, or another file read reads unexposed", () => {
    expect(failed(planEngReviewExposure(dropCall(base(), "r1")))).toEqual([false, "review_sections_read"]);
    const errored = base();
    Object.assign(resultOf(errored, "r1"), { is_error: true, content: "<tool_use_error>File does not exist.</tool_use_error>" });
    expect(failed(planEngReviewExposure(errored))).toEqual([false, "review_sections_read"]);
    const tagged = base();
    resultOf(tagged, "r1").content = "<tool_use_error>File content (31000 tokens) exceeds maximum allowed tokens (25000).</tool_use_error>";
    expect(failed(planEngReviewExposure(tagged))).toEqual([false, "review_sections_read"]);
    for (const other of ["/root/.claude/skills/gstack/plan-eng-review/sections/review-sections.md.tmpl", "/root/.gstack/render/claude/plan-eng-review/sections/checklist.md", "/root/.gstack/render/claude/plan-ceo-review/sections/review-sections.md"]) {
      const rs = base();
      useOf(rs, "r1").input.file_path = other;
      expect([other, ...failed(planEngReviewExposure(rs))]).toEqual([other, false, "review_sections_read"]);
    }
  });

  test("a Read of the file outside the skill turn, or by a subagent, does not count", () => {
    const late = base();
    for (const r of callRecords(late, "r1")) r.phase = "t3";
    expect(failed(planEngReviewExposure(late))).toEqual([false, "review_sections_read"]);
    const sub = base();
    for (const r of callRecords(sub, "r1")) r.parent_tool_use_id = "toolu_outside_voice";
    expect(failed(planEngReviewExposure(sub))).toEqual([false, "review_sections_read"]);
  });

  test("every path to the pin's review-sections file counts, and so does a Bash read of it, a chunked Read included", () => {
    for (const path of ["~/.claude/skills/gstack/plan-eng-review/sections/review-sections.md", "/root/.local/share/gstack/plan-eng-review/sections/review-sections.md", "$HOME/.claude/skills/gstack/plan-eng-review/sections/review-sections.md"]) {
      const rs = base();
      useOf(rs, "r1").input.file_path = path;
      expect([path, planEngReviewExposure(rs).exposed]).toEqual([path, true]);
    }
    const chunk = base();
    Object.assign(useOf(chunk, "r1").input, { offset: 380, limit: 120 });
    expect(planEngReviewExposure(chunk).exposed).toBe(true);
    for (const command of ["cat ~/.claude/skills/gstack/plan-eng-review/sections/review-sections.md", "sed -n '380,520p' /root/.gstack/render/claude/plan-eng-review/sections/review-sections.md"]) {
      const rs = base();
      Object.assign(useOf(rs, "r1"), { name: "Bash", input: { command } });
      expect([command, planEngReviewExposure(rs).exposed]).toEqual([command, true]);
    }
    const listed = base();
    Object.assign(useOf(listed, "r1"), { name: "Bash", input: { command: "ls -l /root/.gstack/render/claude/plan-eng-review/sections/review-sections.md" } });
    expect(failed(planEngReviewExposure(listed))).toEqual([false, "review_sections_read"]);
  });

  test("no Step 0 Scope Challenge marker in the session's own text reads unexposed, though the skill body and the file name it", () => {
    const rs = retext(base(), /^.*Scope Challenge.*$/gm, "Checked the plan's scope.");
    expect(blocks(rs).some((b) => b.type === "tool_result" && JSON.stringify(b.content).includes("## Scope Challenge"))).toBe(true);
    expect(rs.some((r) => r.type === "UserMessage" && typeof r.content === "string" && r.content.includes("Step 0: Scope Challenge"))).toBe(true);
    expect(failed(planEngReviewExposure(rs))).toEqual([false, "scope_challenge"]);
    const prose = retext(base(), /^.*Scope Challenge.*$/gm, "I ran no scope challenge here.");
    expect(failed(planEngReviewExposure(prose))).toEqual([false, "scope_challenge"]);
  });

  test("the completion summary's Step 0 line alone, or a bold label, is a Scope Challenge marker", () => {
    const summaryOnly = retext(base(), /^## Step 0: Scope Challenge$|^Scope Challenge result: .*$/gm, "Scope checked.");
    expect(planEngReviewExposure(summaryOnly).exposed).toBe(true);
    const bold = retext(base(), /^## Step 0: Scope Challenge$/m, "**Scope Challenge**");
    retext(bold, /^- Step 0: Scope Challenge.*$|^Scope Challenge result: .*$/gm, "Done.");
    expect(planEngReviewExposure(bold).exposed).toBe(true);
  });

  test("Sections 1 to 4 out of order, or one missing, read unexposed", () => {
    const swapped = base();
    const s3 = textRecord(swapped, /^## Section 3/m), s4 = textRecord(swapped, /^## Section 4/m);
    [s3.content, s4.content] = [s4.content, s3.content];
    expect(failed(planEngReviewExposure(swapped))).toEqual([false, "sections_in_order"]);
    const missing = retext(dropText(base(), /^## Section 4/m), /^- Performance Review: .*$/m, "");
    expect(failed(planEngReviewExposure(missing))).toEqual([false, "sections_in_order"]);
  });

  test("section headings in turn 1's plan, in the skill body or in a tool result never count", () => {
    let rs = base();
    for (const re of [/^## Section 1/m, /^## Section 2/m, /^## Section 3/m, /^## Section 4/m]) rs = dropText(rs, re);
    rs = retext(rs, /^- (Architecture|Code Quality|Test|Performance) Review: .*$/gm, "");
    expect(failed(planEngReviewExposure(rs))).toEqual([false, "sections_in_order"]);
  });

  test("the pin's own heading forms all count as section markers", () => {
    const forms = ["### 1. Architecture review", "**2. Code Quality Review**", "### Section 3 — Tests", "4) Performance review"];
    const rs = base();
    for (const [i, form] of forms.entries()) retext(rs, new RegExp("^## Section " + (i + 1) + ": .*$", "m"), form);
    expect(planEngReviewExposure(rs).exposed).toBe(true);
  });

  test("no test plan written, one written elsewhere or a failed write reads unexposed; a Bash heredoc to the pin's path counts", () => {
    expect(failed(planEngReviewExposure(dropCall(base(), "w2")))).toEqual([false, "test_plan_written"]);
    const elsewhere = base();
    useOf(elsewhere, "w2").input.file_path = "/root/.gstack/projects/repo/test-plan.md";
    expect(failed(planEngReviewExposure(elsewhere))).toEqual([false, "test_plan_written"]);
    const refused = base();
    Object.assign(resultOf(refused, "w2"), { is_error: true, content: "Permission denied" });
    expect(failed(planEngReviewExposure(refused))).toEqual([false, "test_plan_written"]);
    const heredoc = base();
    Object.assign(useOf(heredoc, "w2"), { name: "Bash", input: { command: "cat > /root/.gstack/projects/repo/root-feature-eng-review-test-plan-20261105-101500.md <<'EOF'\n# Test Plan\nEOF" } });
    expect(planEngReviewExposure(heredoc).exposed).toBe(true);
    const tee = base();
    Object.assign(useOf(tee, "w2"), { name: "Bash", input: { command: "printf '# Test Plan\\n' | tee \"$PROJECT_DIR/root-feature-eng-review-test-plan-20261105-101500.md\"" } });
    expect(planEngReviewExposure(tee).exposed).toBe(true);
    const read = base();
    Object.assign(useOf(read, "w2"), { name: "Bash", input: { command: "cat /root/.gstack/projects/repo/root-feature-eng-review-test-plan-20261105-101500.md" } });
    expect(failed(planEngReviewExposure(read))).toEqual([false, "test_plan_written"]);
  });

  test("a session that stopped before the skill turn reads unexposed, with every check false", () => {
    expect(planEngReviewExposure(turn1Only(base()))).toMatchObject({ exposed: false, failed: "review_sections_read", checks: { review_sections_read: false, scope_challenge: false, sections_in_order: false, test_plan_written: false } });
  });
});

describe("autoplan exposure: the frozen configuration, then every phase its scope chose loaded and published in order, Eng last", () => {
  const base = () => load("autoplan-exposed.jsonl");
  const both = () => load("autoplan-exposed-design-dx.jsonl");

  test("both exposed fixtures read exposed, with the phases the scope chose", () => {
    expect(autoplanExposure(base())).toMatchObject({ skill: "autoplan", exposed: true, failed: null, phases: ["ceo", "eng"], published: ["ceo", "eng"] });
    expect(autoplanExposure(both())).toMatchObject({ exposed: true, failed: null, phases: ["ceo", "design", "dx", "eng"], published: ["ceo", "design", "dx", "eng"] });
    expect(detectExposure("autoplan", both())).toEqual(autoplanExposure(both()));
  });

  test("a session kind other than interactive, a missing preamble, the driver or a kind flag, or a ready Codex fails the configuration", () => {
    const unattended = base();
    resultOf(unattended, "s1").content = "SKILL_START_PROTO: 1\nSESSION_KIND: unattended\n";
    expect(failed(autoplanExposure(unattended))).toEqual([false, "config"]);
    expect(failed(autoplanExposure(dropCall(base(), "s1")))).toEqual([false, "config"]);
    for (const command of ["~/.claude/skills/gstack/bin/gstack-autoplan next --out .gstack/tmp/ap --plan PLAN.md --kind feature", "gstack-autoplan next --out /tmp/ap --plan PLAN.md"]) {
      const rs = base();
      useOf(rs, "s3").input.command = command;
      expect([command, ...failed(autoplanExposure(rs))]).toEqual([command, false, "config"]);
    }
    for (const mode of ["ready", "unverified (rate_limited)"]) {
      const rs = base();
      resultOf(rs, "s3").content = "CODEX_MODE: " + mode + "\n";
      expect([mode, ...failed(autoplanExposure(rs))]).toEqual([mode, false, "config"]);
    }
    const disabled = base();
    resultOf(disabled, "s3").content = "CODEX_MODE: disabled\n";
    expect(autoplanExposure(disabled).exposed).toBe(true);
    for (const [model, exposed] of [["haiku", false], ["sonnet", false], ["opus", true], [undefined, true]] as const) {
      const rs = base();
      const agent = blocks(rs).find((b) => b.type === "tool_use" && b.name === "Agent")!;
      if (model === undefined) delete agent.input.model;
      else agent.input.model = model;
      expect([model, autoplanExposure(rs).exposed]).toEqual([model, exposed]);
    }
  });

  test("no readable scope result reads unexposed", () => {
    expect(failed(autoplanExposure(dropCall(base(), "s2")))).toEqual([false, "scope"]);
    const errored = base();
    Object.assign(resultOf(errored, "s2"), { is_error: true, content: "gstack-autoplan-snapshot: Existing restore does not match" });
    expect(failed(autoplanExposure(errored))).toEqual([false, "scope"]);
    const garbled = base();
    resultOf(garbled, "s2").content = "not json";
    expect(failed(autoplanExposure(garbled))).toEqual([false, "scope"]);
  });

  test("a later scope result decides the phases: DX turned on and never run reads unexposed", () => {
    const rs = base();
    const at = rs.indexOf(withResult(rs, "s3")) + 1;
    const scope = { ...JSON.parse(resultOf(rs, "s2").content).scope, dxRequired: true, developerTool: true };
    rs.splice(at, 0,
      { type: "AssistantMessage", t: 0, phase: "t2", parent_tool_use_id: null, content: [{ type: "tool_use", id: "s4", name: "Bash", input: { command: 'bun "/root/.claude/skills/gstack/bin/gstack-autoplan-snapshot.ts" scope "/work/repo/PLAN.md" --developer-tool' } }] },
      { type: "UserMessage", t: 0, phase: "t2", parent_tool_use_id: null, content: [{ type: "tool_result", tool_use_id: "s4", content: JSON.stringify(scope), is_error: false }] });
    expect(autoplanExposure(rs)).toMatchObject({ exposed: false, failed: "review_skills_loaded", phases: ["ceo", "dx", "eng"] });
  });

  test("a chosen phase whose review skill never loaded reads unexposed; a direct Read of its SKILL.md counts", () => {
    expect(failed(autoplanExposure(dropCall(both(), "r2")))).toEqual([false, "review_skills_loaded"]);
    const errored = both();
    Object.assign(resultOf(errored, "r2"), { is_error: true, content: "<tool_use_error>EACCES</tool_use_error>" });
    expect(failed(autoplanExposure(errored))).toEqual([false, "review_skills_loaded"]);
    const wrong = both();
    useOf(wrong, "r2").input.file_path = "/work/repo/.gstack/tmp/autoplan/autoplan-dx-methodology-Zz9/methodology.md";
    expect(failed(autoplanExposure(wrong))).toEqual([false, "review_skills_loaded"]);
    const sub = both();
    for (const r of callRecords(sub, "r2")) r.parent_tool_use_id = "toolu_native";
    expect(failed(autoplanExposure(sub))).toEqual([false, "review_skills_loaded"]);
    const direct = both();
    useOf(direct, "r2").input = { file_path: "/root/.claude/skills/gstack/plan-design-review/SKILL.md" };
    expect(autoplanExposure(direct).exposed).toBe(true);
  });

  test("a chosen phase never published, or published without its report, reads unexposed", () => {
    expect(failed(autoplanExposure(dropCall(both(), "p2")))).toEqual([false, "findings_in_order"]);
    expect(failed(autoplanExposure(dropText(both(), /^\*\*Phase 2 complete/m)))).toEqual([false, "findings_in_order"]);
    const wrongNumber = retext(both(), /^\*\*Phase 2\.5 complete\.\*\*/m, "**Phase 2 complete.**");
    expect(failed(autoplanExposure(wrongNumber))).toEqual([false, "findings_in_order"]);
    const late = both();
    for (const r of callRecords(late, "p3")) r.phase = "t3";
    expect(failed(autoplanExposure(late))).toEqual([false, "findings_in_order"]);
  });

  test("phases published out of order, or anything published after Eng, read unexposed", () => {
    const swapped = both();
    const i2 = swapped.indexOf(withUse(swapped, "d2")), i3 = swapped.indexOf(withUse(swapped, "d3")), i4 = swapped.indexOf(withUse(swapped, "d4"));
    const design = swapped.slice(i2, i3), dx = swapped.slice(i3, i4);
    swapped.splice(i2, i4 - i2, ...dx, ...design);
    expect(failed(autoplanExposure(swapped))).toEqual([false, "findings_in_order"]);
    const after = both();
    const gate = after.indexOf(withUse(after, "q1"));
    after.splice(gate, 0,
      { type: "AssistantMessage", t: 0, phase: "t2", parent_tool_use_id: null, content: [{ type: "text", text: "**Phase 2 complete.**\nOutside review: unavailable. Native subagent: completed: 0 issues." }] },
      { type: "AssistantMessage", t: 0, phase: "t2", parent_tool_use_id: null, content: [{ type: "tool_use", id: "p9", name: "Bash", input: { command: "true autoplan-published design" } }] },
      { type: "UserMessage", t: 0, phase: "t2", parent_tool_use_id: null, content: [{ type: "tool_result", tool_use_id: "p9", content: "", is_error: false }] });
    expect(failed(autoplanExposure(after))).toEqual([false, "findings_in_order"]);
  });

  test("the injected skill body and a subagent's output never count as publications", () => {
    const rs = base();
    for (const id of ["p1", "p2"]) for (const r of callRecords(rs, id)) r.parent_tool_use_id = "toolu_native";
    expect(rs.some((r) => r.type === "UserMessage" && typeof r.content === "string" && r.content.includes("true autoplan-published eng"))).toBe(true);
    expect(failed(autoplanExposure(rs))).toEqual([false, "findings_in_order"]);
  });

  test("a session that stopped before the skill turn reads unexposed", () => {
    expect(autoplanExposure(turn1Only(base()))).toMatchObject({ exposed: false, failed: "config", phases: null });
  });
});

describe("transcripts and the detector table", () => {
  test("a torn last line is dropped and counted; a bad line before the end is refused", () => {
    const { records, torn } = readTranscript(join(FIX, "plan-eng-review-exposed.jsonl"));
    expect([records.length, torn]).toEqual([30, null]);
    const dir = require("node:fs").mkdtempSync(join(require("node:os").tmpdir(), "outcome-transcript-"));
    const text = require("node:fs").readFileSync(join(FIX, "plan-eng-review-exposed.jsonl"), "utf8");
    require("node:fs").writeFileSync(join(dir, "torn.jsonl"), text + '{"type":"Assist');
    expect(readTranscript(join(dir, "torn.jsonl"))).toMatchObject({ torn: '{"type":"Assist' });
    require("node:fs").writeFileSync(join(dir, "bad.jsonl"), '{"type":"Assist\n' + text);
    expect(() => readTranscript(join(dir, "bad.jsonl"))).toThrow(/^E_OUTCOME_TRANSCRIPT .*line 1/);
  });

  test("a skill with no detector yet, or no skill at all, is refused, not read unexposed", () => {
    for (const skill of ["plan-devex-review", "devex-review", "plan-design-review", "design-review"]) expect(() => detectExposure(skill, [])).toThrow(/^E_OUTCOME_ARM .*comes with family [XU]/);
    expect(() => detectExposure("ship", [])).toThrow(/^E_OUTCOME_ARM /);
  });
});
