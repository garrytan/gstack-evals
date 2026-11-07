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

  test("a Bash read or test-plan write counts only as one simple command that ran: no &&, ||, ;, second line, $(, backtick, if or case, and a read must return text", () => {
    const P = "/root/.gstack/render/claude/plan-eng-review/sections/review-sections.md";
    const asRead = (command: string, content?: string) => {
      const rs = base();
      Object.assign(useOf(rs, "r1"), { name: "Bash", input: { command } });
      if (content !== undefined) resultOf(rs, "r1").content = content;
      return planEngReviewExposure(rs).checks.review_sections_read;
    };
    for (const command of ["cat " + P, "sed -n '380,520p' " + P, "head -n 600 " + P + " 2>/dev/null"]) expect([command, asRead(command)]).toEqual([command, true]);
    for (const command of ["false && cat " + P + "; true", "cat " + P + " || true", "cat " + P + "; true", "true\ncat " + P, "echo $(cat " + P + ")", "echo `cat " + P + "`", "if cat " + P + "\nthen true\nfi", "case x in x) cat " + P + " ;; esac", "cat " + P + " | head -5", ": <<'EOF'\ncat " + P + "\nEOF", "cat " + P + " &", "! cat " + P])
      expect([command, asRead(command)]).toEqual([command, false]);
    expect(asRead("cat " + P, "")).toBe(false);
    const T = "/root/.gstack/projects/repo/root-feature-eng-review-test-plan-20261105-101500.md";
    const asWrite = (command: string) => {
      const rs = base();
      Object.assign(useOf(rs, "w2"), { name: "Bash", input: { command } });
      return planEngReviewExposure(rs).checks.test_plan_written;
    };
    for (const command of ["cat > " + T + " <<'EOF'\n# Test Plan\nEOF", "cat <<'EOF' | tee -a " + T + "\n# Test Plan\nEOF", "printf '# Test Plan\\n' >> \"${PROJECT_DIR}/root-feature-eng-review-test-plan-1.md\""])
      expect([command, asWrite(command)]).toEqual([command, true]);
    for (const command of ["false && cat > /nonexistent/projects/repo/demo-eng-review-test-plan-x.md; true", ": <<'EOF'\ncat > " + T + "\nEOF", "cat > " + T + " <<'EOF'\n# Test Plan\nEOF\nrm " + T, "cat > " + T + " <<'EOF'\n# Test Plan", "true || printf x > " + T, "printf x > " + T + "; true", "printf x > $(echo " + T + ")", "printf x | tee " + T + " | cat", "printf x | sh -c 'cat > " + T + "'", "printf x > " + T + " &"])
      expect([command, asWrite(command)]).toEqual([command, false]);
  });

  test("a Bash test-plan write follows Write's path rule (under /projects/<slug>/ or $PROJECT_DIR), a 2> redirect is not a write, and Edit and MultiEdit never count", () => {
    const asWrite = (command: string) => {
      const rs = base();
      Object.assign(useOf(rs, "w2"), { name: "Bash", input: { command } });
      return planEngReviewExposure(rs).checks.test_plan_written;
    };
    const T = "/root/.gstack/projects/repo/root-feature-eng-review-test-plan-20261105-101500.md";
    for (const [command, counts] of [["printf x > /tmp/root-feature-eng-review-test-plan-1.md", false], ["printf x > ./root-feature-eng-review-test-plan-1.md", false], ["gstack-slug 2> " + T, false], ["gstack-slug 2>> " + T, false], ["printf x > ~/.gstack/projects/repo/root-feature-eng-review-test-plan-1.md", true], ["printf x > \"$PROJECT_DIR/root-feature-eng-review-test-plan-1.md\"", true]] as const)
      expect([command, asWrite(command)]).toEqual([command, counts]);
    for (const name of ["Edit", "MultiEdit"]) {
      const rs = base();
      Object.assign(useOf(rs, "w2"), { name, input: { file_path: T, old_string: "", new_string: "# Test Plan\n", edits: [] } });
      expect([name, ...failed(planEngReviewExposure(rs))]).toEqual([name, false, "test_plan_written"]);
    }
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

  test("a section counts only as a heading in the pin's forms with content before the next section heading: a preview list, empty headings or the completion summary do not", () => {
    const sections = [/^## Section 1/m, /^## Section 2/m, /^## Section 3/m, /^## Section 4/m];
    const without = () => sections.reduce((rs, re) => dropText(rs, re), base());
    expect(failed(planEngReviewExposure(without()))).toEqual([false, "sections_in_order"]);
    for (const text of ["Next I review the plan in four sections:\n1. Architecture review\n2. Code quality review\n3. Test review\n4. Performance review", "## Section 1: Architecture review\n\n## Section 2: Code quality review\n\n## Section 3: Test review\n\n## Section 4: Performance review"]) {
      const rs = without();
      rs.splice(rs.indexOf(textRecord(rs, /^## Step 0/m)) + 1, 0, { type: "AssistantMessage", t: 0, phase: "t2", parent_tool_use_id: null, content: [{ type: "text", text }] });
      expect([text, ...failed(planEngReviewExposure(rs))]).toEqual([text, false, "sections_in_order"]);
    }
  });

  test("section headings in turn 1's plan, in the skill body or in a tool result never count", () => {
    let rs = base();
    for (const re of [/^## Section 1/m, /^## Section 2/m, /^## Section 3/m, /^## Section 4/m]) rs = dropText(rs, re);
    rs = retext(rs, /^- (Architecture|Code Quality|Test|Performance) Review: .*$/gm, "");
    expect(failed(planEngReviewExposure(rs))).toEqual([false, "sections_in_order"]);
  });

  test("the pin's own heading forms all count as section markers", () => {
    const forms = ["### 1. Architecture review", "**2. Code Quality Review**", "### Section 3 — Tests", "## 4) Performance review"];
    const rs = base();
    for (const [i, form] of forms.entries()) retext(rs, new RegExp("^## Section " + (i + 1) + ": .*$", "m"), form);
    expect(planEngReviewExposure(rs).exposed).toBe(true);
  });

  test("rule decision (GSTA-2), not a regression: a bare numbered line such as 4) Performance review is never a section heading", () => {
    const rs = retext(base(), /^## Section 4: .*$/m, "4) Performance review");
    expect(failed(planEngReviewExposure(rs))).toEqual([false, "sections_in_order"]);
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

  const T = "/root/.gstack/projects/repo/root-feature-eng-review-test-plan-20261105-101500.md";
  const asWrite = (command: string) => {
    const rs = base();
    Object.assign(useOf(rs, "w2"), { name: "Bash", input: { command } });
    resultOf(rs, "w2").content = "";
    return planEngReviewExposure(rs).checks.test_plan_written;
  };
  const P = "/root/.gstack/render/claude/plan-eng-review/sections/review-sections.md";
  const asRead = ([command, content]: string[]) => {
    const rs = base();
    Object.assign(useOf(rs, "r1"), { name: "Bash", input: { command } });
    resultOf(rs, "r1").content = content;
    return planEngReviewExposure(rs).checks.review_sections_read;
  };
  const withSections = (texts: string[]) => {
    const rs = base();
    blocks(rs)
      .filter((b) => b.type === "text" && /^## Section \d/.test(b.text))
      .forEach((b, i) => {
        b.text = texts[i] ?? "ok";
      });
    return planEngReviewExposure(rs).checks.sections_in_order;
  };

  test("a > inside double or single quotes or after a comment # is no test-plan write, and a numbered redirect such as 2> never is", () => {
    const commands = ['echo "run: cat > ' + T + '"', "echo 'saved > " + T + " done'", "true # > " + T, "echo '>' " + T, "printf x 2> " + T];
    expect(commands.map((c) => [c, asWrite(c)])).toEqual(commands.map((c) => [c, false]));
  });

  test("a real heredoc write, a quoted $PROJECT_DIR target after a real redirect and a tee still write the test plan", () => {
    const commands = ["cat > " + T + " <<'EOF'\n# Test Plan\nEOF", 'cat > "$PROJECT_DIR/root-feature-eng-review-test-plan-20261105-101500.md" <<\'EOF\'\n# Test Plan\nEOF', "printf '# Test Plan\\n' | tee \"$PROJECT_DIR/root-feature-eng-review-test-plan-20261105-101500.md\"", "echo '# Test Plan' >> " + T + " # appended"];
    expect(commands.map((c) => [c, asWrite(c)])).toEqual(commands.map((c) => [c, true]));
  });

  test("cat --help, head --version and an awk BEGIN-only program never read the review-sections file", () => {
    const calls = [["cat --help " + P, "Usage: cat [OPTION]... [FILE]..."], ["head --version " + P, "head (GNU coreutils) 9.4"], ["awk 'BEGIN{print \"ok\"}' " + P, "ok"]];
    expect(calls.map((c) => [c[0], asRead(c)])).toEqual(calls.map((c) => [c[0], false]));
  });

  test("a real cat, sed -n or tail of the review-sections file still reads it", () => {
    const calls = [["cat " + P, "## Scope Challenge"], ["sed -n '380,520p' " + P, "## Review Sections (after scope is agreed)"], ["tail -n 200 " + P, "### 4. Performance review"]];
    expect(calls.map((c) => [c[0], asRead(c)])).toEqual(calls.map((c) => [c[0], true]));
  });

  test("a numbered preview list without sub-bullets or the completion summary's list lines are not Sections 1 to 4", () => {
    const texts = [
      "I'll review in this order:\n1. Architecture\n2. Code quality\n3. Tests\n4. Performance",
      "- Architecture Review: 1 issue found\n- Code Quality Review: 0 issues found\n- Test Review: 1 issue found\n- Performance Review: 0 issues found",
    ];
    expect(texts.map((t) => [t, withSections([t])])).toEqual(texts.map((t) => [t, false]));
  });

  test("the fixture's real sections count as Sections 1 to 4", () => {
    expect(planEngReviewExposure(base()).checks.sections_in_order).toBe(true);
  });

  const four = (f: (n: number, name: string) => string) => ["Architecture", "Code quality", "Test", "Performance"].map((name, i) => f(i + 1, name));

  test("p2/red-team#1: a preview list with sub-bullets, in short or full section names, is not Sections 1 to 4", () => {
    const texts = [
      "I'll review in this order:\n1. Architecture\n   - boundaries\n2. Code quality\n   - naming\n3. Tests\n   - coverage\n4. Performance\n   - hot paths",
      "I'll review in this order:\n" + four((n, name) => n + ". " + name + " review\n   - " + name.toLowerCase() + " points").join("\n"),
      "I'll review in this order:\n" + four((n, name) => n + ". " + name + " review\n- " + name.toLowerCase() + " points").join("\n"),
    ];
    expect(texts.map((t) => [t, withSections([t])])).toEqual(texts.map((t) => [t, false]));
  });

  test("p2/red-team#1: a bold summary is not Sections 1 to 4", () => {
    expect(withSections(["Summary:\n**Architecture review:** 1 issue found\n- process-local store\n**Code quality review:** no issues\n- none\n**Test review:** 1 gap\n- refill boundary\n**Performance review:** no issues\n- none"])).toBe(false);
  });

  test("rule decision (GSTA-2), not a regression: four headings that carry their verdict on the heading line, with nothing under them, are not Sections 1 to 4", () => {
    expect(withSections(["## Section 1: Architecture review: no issues found.", "## Section 2: Code quality review: no issues found.", "## Section 3: Test review: no issues found.", "## Section 4: Performance review: no issues found."])).toBe(false);
  });

  test("the same verdict headings count with one finding line under each", () => {
    expect(withSections(four((n, name) => "## Section " + n + ": " + name + " review: no issues found.\nChecked the store boundary and the refill path."))).toBe(true);
  });

  test("GSTA-2: text after a section's name counts only when content follows before the next section heading, and an inline verdict is never content", () => {
    const rest = four((n, name) => "### Section " + n + ": " + name + " review\n- Issue: process-local store").slice(1);
    const heads = ["### Section 1: Architecture (boundaries, coupling)", "### Section 1: Architecture review — skipped", "## Section 1: Architecture review: no issues found."];
    expect(heads.map((h) => [h, withSections([[h, ...rest].join("\n")])])).toEqual(heads.map((h) => [h, false]));
    expect(heads.map((h) => [h, withSections([[h, "- Issue: the cache has no owner", ...rest].join("\n")])])).toEqual(heads.map((h) => [h, true]));
  });

  test("GSTA-2: a section's body ends at the next heading of the same or higher level, so an inline-only Section 4 before the completion summary does not count", () => {
    const three = ["## Section 1: Architecture review", "- Issue: process-local store", "## Section 2: Code quality review", "- Issue: naming", "## Section 3: Test review", "- Gap: refill boundary"];
    const summary = ["## Completion summary", "- Step 0: Scope Challenge — scope accepted as-is"];
    for (const four of ["## Section 4: Performance review: no issues found.", "### 4. Performance review", "**4. Performance Review**: no issues"]) expect([four, withSections([[...three, four, ...summary].join("\n")])]).toEqual([four, false]);
  });

  test("GSTA-2: content under a deeper heading inside a section counts, as in ## Section 4 with ### 4.1 under it", () => {
    const text = ["## Section 1: Architecture review", "- Issue: process-local store", "## Section 2: Code quality review", "- Issue: naming", "## Section 3: Test review", "- Gap: refill boundary", "## Section 4: Performance review", "### 4.1 Hot path", "- Checked the refill loop", "## Completion summary", "- Step 0: Scope Challenge — scope accepted as-is"].join("\n");
    expect(withSections([text])).toBe(true);
  });

  test("the pin's own forms count with bullets under them: ### 1. Architecture review and **2. Code Quality Review**", () => {
    const text = ["### 1. Architecture review", "- Issue: process-local store", "**2. Code Quality Review**", "- Issue: naming", "### 3. Test review", "- Gap: refill boundary", "### 4. Performance review", "- None found in the hot path"].join("\n");
    expect(withSections([text])).toBe(true);
  });

  test("fc2/fix-check#1: bold numbered sections with only bullets under them count, in one block or four", () => {
    const sections = four((n, name) => "**" + n + ". " + name + " review**\n- Issue: process-local store");
    expect([withSections([sections.join("\n")]), withSections(sections)]).toEqual([true, true]);
  });

  test("p1/red-team#2: heading-only outlines whose inline text is not the section's name are not Sections 1 to 4", () => {
    const texts = [four((n, name) => "### Section " + n + " (" + name + ")").join("\n"), four((n) => "## Section " + n + " of 4").join("\n")];
    expect(texts.map((t) => [t, withSections([t])])).toEqual(texts.map((t) => [t, false]));
  });

  test("p1/red-team#2: the same headings count with content under them", () => {
    const texts = [four((n, name) => "### Section " + n + " (" + name + ")\n- Issue: process-local store").join("\n"), four((n) => "## Section " + n + " of 4\nNo issues found.").join("\n")];
    expect(texts.map((t) => [t, withSections([t])])).toEqual(texts.map((t) => [t, true]));
  });

  test("the completion summary written as ### headings is not Sections 1 to 4", () => {
    expect(withSections(["### Architecture Review: 1 issue\n### Code Quality Review: 0 issues\n### Test Review: 1 gap\n### Performance Review: 0 issues"])).toBe(false);
  });

  test("rule decision (GSTA-2), not a regression: bare numbered sections with only a list under them do not count, at any indentation", () => {
    const texts = ["", "   "].map((indent) => four((n, name) => n + ". " + name + " review\n" + indent + "- Issue: process-local store").join("\n"));
    expect(texts.map((t) => [t, withSections([t])])).toEqual(texts.map((t) => [t, false]));
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

  test("the configuration needs at least one CODEX_MODE line from a call that ran: a missing or failed probe reads unexposed", () => {
    expect(failed(autoplanExposure(dropCall(base(), "s3")))).toEqual([false, "config"]);
    const errored = base();
    resultOf(errored, "s3").is_error = true;
    expect(failed(autoplanExposure(errored))).toEqual([false, "config"]);
  });

  test("a snapshot init or methodology command that ends at its subcommand or phase still counts", () => {
    const rs = both();
    useOf(rs, "s2").input.command = 'bun "/root/.claude/skills/gstack/bin/gstack-autoplan-snapshot.ts" init';
    useOf(rs, "m1").input.command = 'bun "/root/.claude/skills/gstack/bin/gstack-autoplan-snapshot.ts" methodology ceo';
    expect(autoplanExposure(rs)).toMatchObject({ exposed: true, phases: ["ceo", "design", "dx", "eng"] });
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

  test("a publication call that failed, by is_error or a tool_use_error tag, does not count", () => {
    for (const result of [{ is_error: true, content: "<tool_use_error>Execution cancelled</tool_use_error>" }, { is_error: true, content: "" }, { is_error: false, content: "<tool_use_error>denied by hook</tool_use_error>" }]) {
      const rs = base();
      Object.assign(resultOf(rs, "p2"), result);
      expect([result, autoplanExposure(rs)]).toMatchObject([result, { exposed: false, failed: "findings_in_order", published: ["ceo"] }]);
    }
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

describe("autoplan exposure, GEVA-387: a methodology file read after the phase's methodology command, whatever its output fed, loads the phase", () => {
  const both = () => load("autoplan-exposed-design-dx.jsonl");
  const DX = "/work/repo/.gstack/tmp/autoplan/autoplan-dx-methodology-Ab3/methodology.md";
  const PIPED = " | python3 -c \"import json,sys; d=json.load(sys.stdin); print(d['methodologyPath'])\"";
  const pipe = (rs: Rec[], id: string, tail = PIPED, out?: string) => {
    const res = resultOf(rs, id);
    useOf(rs, id).input.command += tail;
    res.content = out ?? JSON.parse(res.content).methodologyPath + "\n";
    return rs;
  };
  const call = (id: string, name: string, input: Rec, content: string): Rec[] => [
    { type: "AssistantMessage", t: 0, phase: "t2", parent_tool_use_id: null, content: [{ type: "tool_use", id, name, input }] },
    { type: "UserMessage", t: 0, phase: "t2", parent_tool_use_id: null, content: [{ type: "tool_result", tool_use_id: id, content, is_error: false }] },
  ];
  const bashRead = (rs: Rec[], id: string, command: string, content = "     1\t# Review") => {
    Object.assign(useOf(rs, id), { name: "Bash", input: { command } });
    resultOf(rs, id).content = content;
    return rs;
  };
  const move = (rs: Rec[], id: string, after: string) => {
    const moved = callRecords(rs, id);
    const rest = rs.filter((r) => !moved.includes(r));
    rest.splice(rest.indexOf(withResult(rest, after)) + 1, 0, ...moved);
    return rest;
  };
  const loads = (rs: Rec[]) => autoplanExposure(rs).checks.review_skills_loaded;
  const r61 = () => {
    const rs = both();
    const s2 = resultOf(rs, "s2");
    const init = JSON.parse(s2.content);
    s2.content = JSON.stringify({ ...init, scope: { ...init.scope, uiRequired: false } });
    const from = rs.indexOf(withUse(rs, "d2")), to = rs.indexOf(withResult(rs, "p2"));
    rs.splice(from, to - from + 1);
    return pipe(pipe(rs, "m3"), "m4");
  };

  test("a methodology command piped into python3, then ranged Reads of the phase's own methodology.md before its publish, loads the phase", () => {
    const rs = pipe(both(), "m3");
    useOf(rs, "r3").input = { file_path: DX, offset: 1, limit: 600 };
    rs.splice(rs.indexOf(withResult(rs, "r3")) + 1, 0, ...call("r3b", "Read", { file_path: DX, offset: 601, limit: 600 }, "   601\t## Review Sections"));
    expect(autoplanExposure(rs)).toMatchObject({ exposed: true, failed: null, phases: ["ceo", "design", "dx", "eng"] });
  });

  test("the same with the methodology command redirected to a file", () => {
    for (const tail of [" > /work/repo/.gstack/tmp/autoplan/dx-manifest.json", " >/dev/null 2>&1"]) expect([tail, autoplanExposure(pipe(both(), "m3", tail, "")).exposed]).toEqual([tail, true]);
  });

  test("a Bash read of the methodology file after the command, as one simple cat, head, tail, nl or sed -n that returned text, loads the phase", () => {
    for (const command of ["sed -n '1,600p' " + DX, 'cat "' + DX + '"', "head -n 2000 " + DX, "tail -n +601 " + DX + " 2>/dev/null", "nl -ba " + DX]) expect([command, autoplanExposure(bashRead(pipe(both(), "m3"), "r3", command)).exposed]).toEqual([command, true]);
  });

  test("a Bash cat of the installed review SKILL.md loads the phase, with or without a methodology command", () => {
    const command = "cat /root/.claude/skills/gstack/plan-design-review/SKILL.md";
    expect(autoplanExposure(bashRead(both(), "r2", command)).exposed).toBe(true);
    expect(autoplanExposure(dropCall(bashRead(both(), "r2", command), "m2")).exposed).toBe(true);
  });

  test("a session shaped like R61 session 2 (CEO by the manifest, DX and Eng by a piped command and a Read, reports in order) reads exposed", () => {
    expect(autoplanExposure(r61())).toMatchObject({ exposed: true, failed: null, phases: ["ceo", "dx", "eng"], published: ["ceo", "dx", "eng"] });
  });

  test("a methodology file read only after the phase's first publish does not load it", () => {
    expect(loads(move(pipe(both(), "m3"), "r3", "p3"))).toBe(false);
    expect(loads(move(bashRead(pipe(both(), "m3"), "r3", "cat " + DX), "r3", "p3"))).toBe(false);
  });

  test("another phase's methodology file does not load the phase, even after the phase's own command ran", () => {
    const eng = pipe(both(), "m3");
    useOf(eng, "r3").input.file_path = "/work/repo/.gstack/tmp/autoplan/autoplan-eng-methodology-Ab4/methodology.md";
    expect(failed(autoplanExposure(eng))).toEqual([false, "review_skills_loaded"]);
    const dx = pipe(both(), "m2");
    useOf(dx, "r2").input.file_path = "/work/repo/.gstack/tmp/autoplan/autoplan-dx-methodology-Zz9/methodology.md";
    expect(failed(autoplanExposure(dx))).toEqual([false, "review_skills_loaded"]);
    expect(loads(bashRead(pipe(both(), "m2"), "r2", "cat /work/repo/.gstack/tmp/autoplan/autoplan-dx-methodology-Zz9/methodology.md"))).toBe(false);
  });

  test("a methodology file read with no ok methodology command for the phase before it does not load the phase", () => {
    expect(loads(dropCall(pipe(both(), "m3"), "m3"))).toBe(false);
    expect(loads(move(pipe(both(), "m3"), "m3", "r3"))).toBe(false);
    expect(loads(bashRead(dropCall(pipe(both(), "m3"), "m3"), "r3", "cat " + DX))).toBe(false);
    for (const result of [{ is_error: true, content: "error: no such phase" }, { is_error: false, content: "<tool_use_error>denied by hook</tool_use_error>" }]) {
      const rs = pipe(both(), "m3");
      Object.assign(resultOf(rs, "m3"), result);
      expect([result, loads(rs)]).toEqual([result, false]);
    }
  });

  test("a subagent's Read, or one in turn 1 or turn 3, does not load the phase", () => {
    const sub = pipe(both(), "m3");
    for (const r of callRecords(sub, "r3")) r.parent_tool_use_id = "toolu_native";
    expect(loads(sub)).toBe(false);
    for (const phase of ["t1", "t3"]) {
      const rs = pipe(both(), "m3");
      for (const r of callRecords(rs, "r3")) r.phase = phase;
      expect([phase, loads(rs)]).toEqual([phase, false]);
    }
  });

  test("a failed Read, and a Bash read that errors or returns nothing, do not load the phase", () => {
    for (const result of [{ is_error: true, content: "<tool_use_error>File does not exist.</tool_use_error>" }, { is_error: false, content: "<tool_use_error>denied by hook</tool_use_error>" }]) {
      const rs = pipe(both(), "m3");
      Object.assign(resultOf(rs, "r3"), result);
      expect([result, loads(rs)]).toEqual([result, false]);
    }
    for (const result of [{ is_error: true, content: "cat: " + DX + ": No such file or directory" }, { is_error: false, content: "" }, { is_error: false, content: "\n  \n" }]) {
      const rs = bashRead(pipe(both(), "m3"), "r3", "cat " + DX);
      Object.assign(resultOf(rs, "r3"), result);
      expect([result, loads(rs)]).toEqual([result, false]);
    }
  });

  test("compound Bash reads and commands that are not reads do not load the phase", () => {
    const SKILL = "/root/.claude/skills/gstack/plan-design-review/SKILL.md";
    const commands = (f: string) => ["cd /work/repo && cat " + f, "cat " + f + "; echo", "echo $(cat " + f + ")", "cat " + f + " | head -5", "true\ncat " + f, "cat --help " + f, "head --version " + f, "wc -l " + f, "ls " + f, "grep -n Review " + f, "awk '{print}' " + f];
    for (const command of commands(DX)) expect([command, loads(bashRead(pipe(both(), "m3"), "r3", command))]).toEqual([command, false]);
    for (const command of commands(SKILL)) expect([command, loads(bashRead(dropCall(both(), "m2"), "r2", command))]).toEqual([command, false]);
  });

  test("a methodology.md outside an autoplan-<phase>-methodology-<suffix> folder does not load the phase", () => {
    const D = "/work/repo/.gstack/tmp/autoplan/";
    for (const path of [D + "methodology.md", D + "autoplan-dx-methodology.md", D + "xautoplan-dx-methodology-Ab3/methodology.md", D + "autoplan-dx-methodology-/methodology.md", D + "autoplan-dx-methodology-Ab3/old/methodology.md", D + "autoplan-dx-methodology-Ab3/methodology.md.bak", D + "autoplan-dx-Ab3/methodology.md"]) {
      const rs = pipe(both(), "m3");
      useOf(rs, "r3").input.file_path = path;
      expect([path, loads(rs), loads(bashRead(pipe(both(), "m3"), "r3", "cat " + path))]).toEqual([path, false, false]);
    }
  });

  test("a session shaped like R61 session 1 (every load credited, reports eng, ceo, eng, dx) reads unexposed on findings_in_order", () => {
    const rs = r61();
    const block = (d: string, g: string) => rs.slice(rs.indexOf(withUse(rs, d)), rs.indexOf(withResult(rs, g)) + 1);
    const report = (n: string, p: string) => [textRecord(rs, new RegExp("^\\*\\*Phase " + n + " complete")), ...callRecords(rs, p)];
    const again = structuredClone(report("3", "p4"));
    const [use, res] = [useOf(again, "p4"), resultOf(again, "p4")];
    use.id = res.tool_use_id = "p5";
    const start = rs.indexOf(withUse(rs, "d1")), end = rs.indexOf(withResult(rs, "p4"));
    rs.splice(start, end - start + 1, ...block("d1", "g1"), ...block("d3", "g3"), ...block("d4", "g4"), ...report("3", "p4"), ...report("1", "p1"), ...again, ...report("2\\.5", "p3"));
    expect(autoplanExposure(rs)).toMatchObject({ exposed: false, failed: "findings_in_order", checks: { review_skills_loaded: true }, phases: ["ceo", "dx", "eng"], published: ["eng", "ceo", "eng", "dx"] });
  });

  test("every load credited but a phase published without its report reads unexposed on findings_in_order", () => {
    expect(autoplanExposure(dropText(r61(), /^\*\*Phase 2\.5 complete/m))).toMatchObject({ exposed: false, failed: "findings_in_order", checks: { review_skills_loaded: true }, published: ["ceo", "eng"] });
  });

  const SKILL = "/root/.claude/skills/gstack/plan-design-review/SKILL.md";
  const bashLoads = (file: string, command: string) => (file === DX ? loads(bashRead(pipe(both(), "m3"), "r3", command)) : loads(bashRead(dropCall(both(), "m2"), "r2", command)));

  test("a Bash read whose file sits in a comment or carries a suffix does not load the phase", () => {
    for (const file of [SKILL, DX]) {
      for (const command of ["cat README.md # " + file, "cat README.md #" + file, "cat " + file + "-old", "cat " + file + "~", "cat " + file + ".bak", 'cat "' + file + '-old"', "cat '" + file + "'x"]) expect([command, bashLoads(file, command)]).toEqual([command, false]);
    }
  });

  test("a Bash read of a quoted file, or with a comment after the file, still loads the phase", () => {
    for (const file of [SKILL, DX]) {
      for (const command of ['cat "' + file + '"', "cat '" + file + "'", "cat " + file + " # the review", "sed -n '1,600p' \"" + file + "\" 2>/dev/null"]) expect([command, bashLoads(file, command)]).toEqual([command, true]);
    }
  });

  const wrapped = (before: string, after: string) => {
    const rs = pipe(both(), "m3", after, "");
    useOf(rs, "m3").input.command = before + useOf(rs, "m3").input.command;
    useOf(rs, "r3").input.file_path = DX;
    return rs;
  };

  test("a methodology command that is not the only command, follows a pipe or a comment, or has another line does not open the phase's methodology file", () => {
    const cases: [string, string][] = [["false && ", " || true"], ["", "; true"], ["", " || true"], ["", " &"], ["true | ", ""], ["", " | head -5 | python3 -m json.tool"], ["echo $(", ")"], ["echo `", "`"], ["! ", ""], ["true # ", ""], ["", "\ntrue"], ["", " | python3 - <<'PY'\nimport sys"]];
    for (const [before, after] of cases) expect([before, after, loads(wrapped(before, after))]).toEqual([before, after, false]);
  });

  test("a methodology command piped once into a quoted script, redirected, continued on a new line or fed a heredoc that closes opens the phase's methodology file", () => {
    const multiline = " | python3 -c 'import json, sys\nd = json.load(sys.stdin)\nprint(d[\"methodologyPath\"])'";
    for (const after of [PIPED, multiline, " > /work/repo/.gstack/tmp/autoplan/dx.json 2>&1", " \\\n  " + PIPED, " | python3 - <<'PY'\nimport sys\nPY", PIPED + " # read the path"]) expect([after, loads(wrapped("", after))]).toEqual([after, true]);
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

  test("an assistant or user record with no phase or parent_tool_use_id is refused with E_OUTCOME_TRANSCRIPT", () => {
    for (const key of ["phase", "parent_tool_use_id"]) {
      const rs = load("plan-eng-review-exposed.jsonl");
      delete textRecord(rs, /^## Section 1/m)[key];
      expect(() => planEngReviewExposure(rs)).toThrow(/^E_OUTCOME_TRANSCRIPT record \d+ \(AssistantMessage\) has no phase or parent_tool_use_id/);
    }
  });

  test("a skill with no detector yet, or no skill at all, is refused, not read unexposed", () => {
    for (const skill of ["plan-devex-review", "devex-review", "plan-design-review", "design-review"]) expect(() => detectExposure(skill, [])).toThrow(/^E_OUTCOME_ARM .*comes with family [XU]/);
    expect(() => detectExposure("ship", [])).toThrow(/^E_OUTCOME_ARM /);
  });
});
