// Copyright (c) 2026 Garry Tan. MIT License.
// The ceo-outcome lens's parser and end states (src/trial/review/ceo-outcome.ts), keyless. The transcripts mix lines that
// gstack 699a41cb (garrytan/gstack, MIT, Copyright (c) 2026 Garry Tan) prints into a session's own text and tool calls:
// gstack-ceo-mode-handoff's --ceo-only line (bin/gstack-ceo-mode-handoff), autoplan's GSTACK_RESULT line
// (autoplan/sections/ceo-only.md) and the review-mode question shape of its captured plan-ceo-review session fixture
// (test/fixtures/ceo-handoff-n-calls.json). The review words in every block are this test's own. No real session wrote a
// ceo-outcome block, so no real final turn is here.
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { catalogsDigest, CEO_KEY_FIELDS, ceoKeyProblems, ceoUnitDir, checkCeoUnits, suiteProblems, type Suite } from "../../../lanes/review-noloss/suite.ts";
import { removeTree } from "../../../src/trial/cleanup.ts";
import { REPO_ROOT } from "../../../src/cli.ts";
import type { Termination } from "../../../src/types.ts";
import { CEO_PARSER_SHA256, CEO_TEMPLATE, CEO_TEMPLATE_SHA256, ceoPrompt, ceoRowFields, cut40, endState, FOLLOW_UP, FORCED_LINE, lastCeoBlock, needsFollowUp, parseCeoBlock, words, type CeoParse } from "../../../src/trial/review/ceo-outcome.ts";
import { mainAgentTexts } from "../../../src/trial/review/capped.ts";

const sha256 = (t: string | Buffer) => createHash("sha256").update(t).digest("hex");
const PREREG = join(REPO_ROOT, "wiki", "plans", "2026-11-04-geva-285-ceo-outcome-prereg");
const LADDER = join(REPO_ROOT, "wiki", "plans", "2026-11-05-geva-295-ceo-ladder-amendment");
const ASK = "Review this plan for problems.";

// gstack 699a41cb's own output lines.
const HANDOFF_LINE = "Auto-selected review mode \u2192 HOLD SCOPE (CEO-only run: Step 0E's rule). Approved decisions: none.";
const RESULT_LINE = "GSTACK_RESULT: skill=autoplan status=reviewed run=/tmp/gstack-state/projects/unit/autoplan-1";
const MODE_QUESTION = { question: "D2 \u2014 Which review mode? <gstack-qid:ceo-plan-mode-0f>", header: "Mode", options: [{ label: "HOLD SCOPE (Recommended)", description: "" }, { label: "SELECTIVE EXPANSION", description: "" }], multiSelect: false };

// This test's own review words.
const ISSUE = "Maintainers asked for a smaller first step, and the plan ships the whole sync engine at once with no opt-out for existing users.";
const FIX = "Ship the read-only mode first behind a flag and keep current behavior as the default.";
const fence = (body: string) => "```ceo-outcome\n" + body + "\n```";
const BLOCK = fence(JSON.stringify({ top: [{ issue: ISSUE, evidence: "plan.md, Rollout", fix: FIX }], forecast: 35 }, null, 2));
const BROKEN = fence('{"top": [{"issue": "cut short"');

let n = 0;
const main = (text: string) => ({ type: "assistant", message: { id: "m" + ++n, role: "assistant", content: [{ type: "text", text }] }, parent_tool_use_id: null, session_id: "s" });
const sub = (text: string) => ({ type: "assistant", message: { id: "m" + ++n, role: "assistant", content: [{ type: "text", text }] }, parent_tool_use_id: "toolu_agent1", session_id: "s" });
const apiError = (text: string) => ({ type: "assistant", message: { id: "synthetic", role: "assistant", model: "<synthetic>", content: [{ type: "text", text }] }, parent_tool_use_id: null, session_id: "s", error: "unknown", is_api_error_message: true });
const tool = (name: string, input: Record<string, unknown>, id: string) => ({ type: "assistant", message: { id: "m" + ++n, role: "assistant", content: [{ type: "tool_use", id, name, input }] }, parent_tool_use_id: null, session_id: "s" });
const result = (id: string, content: string, error = false) => ({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content, is_error: error }] }, parent_tool_use_id: null, session_id: "s" });
const transcript = (...ms: object[]) => ms.map((m) => JSON.stringify(m) + "\n").join("");
const parse = (...ms: object[]): CeoParse => lastCeoBlock(mainAgentTexts(transcript(...ms)));

/** An autoplan CEO-only session's shape: the handoff call and its line, ceo-review.md written, the result line, then the block. */
const autoplanSession = (last: string) => [
  tool("Bash", { command: "~/.claude/skills/gstack/bin/gstack-ceo-mode-handoff --ceo-only --mode HOLD_SCOPE" }, "tu1"),
  result("tu1", HANDOFF_LINE),
  tool("Write", { file_path: "/tmp/gstack-state/projects/unit/autoplan-1/ceo-review.md", content: "# CEO review\n\n## Findings\n\n1. Rollout risk.\n" }, "tu2"),
  result("tu2", "File created successfully"),
  sub("Outside voice: the scope is the risk.\n\n" + fence(JSON.stringify({ top: [{ issue: "A subagent's issue.", fix: "x" }], forecast: 90 }))),
  main(HANDOFF_LINE + "\n\nSection 1 of the review found the rollout risk.\n\n" + RESULT_LINE + "\n\n" + last),
];

describe("the lens's frozen text", () => {
  test("CEO_TEMPLATE is template.txt byte for byte, and FORCED_LINE is forced-line.txt without its newline", () => {
    expect(CEO_TEMPLATE_SHA256).toBe("b7c4c11020eff83695534cb32f10f019824b8775d92a1b1237ce72aeea05d862");
    expect(CEO_TEMPLATE).toBe(readFileSync(join(PREREG, "template.txt"), "utf8"));
    expect(sha256(FORCED_LINE + "\n")).toBe("d4f56ad49c82e6b8ca9a2ec05b24a641c45e9d158e11c9de65420008b66d4e43");
    expect(FORCED_LINE + "\n").toBe(readFileSync(join(REPO_ROOT, "wiki", "plans", "2026-11-01-geva-115-planning-ceo-v2-admission-prereg", "forced-line.txt"), "utf8"));
    expect(FOLLOW_UP).toBe("End your reply with the ceo-outcome block the first message asked for.");
    expect(CEO_PARSER_SHA256).toBe(sha256(readFileSync(join(REPO_ROOT, "src", "trial", "review", "ceo-outcome.ts"))));
  });
  test("each arm's prompt is its section 5 line, a blank line and the template", () => {
    expect(ceoPrompt("none")).toBe(ASK + "\n\n" + CEO_TEMPLATE);
    expect(ceoPrompt("lens")).toBe("Do a CEO/founder-mode review of this plan. " + ASK + "\n\n" + CEO_TEMPLATE);
    expect(ceoPrompt("gstack-auto")).toBe("/autoplan --ceo-only " + ASK + "\n\n" + CEO_TEMPLATE);
    expect(ceoPrompt("gstack-forced")).toBe(FORCED_LINE + " " + ASK + "\n\n" + CEO_TEMPLATE);
  });
});

describe("item2-one-parse: one word rule, ceo-rule.ts's wc", () => {
  // Value: protects=every ceo script counts and cuts words exactly as the frozen scorer checks them; fails_when=words or cut40 split on spaces only, keep tabs or newlines, or keep a no-break space inside a word; why_new=binding item 2; seam=ceo-outcome.ts words and cut40 against #222's ceo-rule.ts.txt wc; no_claim=rows or packets (built later)
  const source = readFileSync(join(LADDER, "ceo-rule.ts.txt"), "utf8");
  const line = source.split("\n").find((l) => l.startsWith("const wc = "))!;
  const wc = new Function("return " + line.slice("const wc = ".length).replace(/: string\)/, ")").replace(/;$/, ""))() as (s: string) => number;
  const samples = ["", "   ", "one", "a\tb\nc\u00a0d  e", "\u00a0lead and trail\u00a0", "x\u2003y\u3000z", "\ufeffbom start", "line\r\nbreak", "tab\t\tdouble", "no-break\u00a0joined\u00a0words"];
  const long = Array.from({ length: 45 }, (_, i) => "w" + i).join("\u00a0\t\n ");
  test("words equals wc on tabs, newlines, no-break spaces and other whitespace", () => {
    expect(line).toBe("const wc = (s: string) => s.split(/\\s+/).filter(Boolean).length;");
    for (const s of [...samples, long]) expect([s, words(s)]).toEqual([s, wc(s)]);
    expect(words("a\tb\nc\u00a0d  e")).toBe(5);
  });
  test("cut40 is the first 40 words joined by single spaces, and wc of the cut is min(40, words)", () => {
    expect(cut40(long)).toBe(Array.from({ length: 40 }, (_, i) => "w" + i).join(" "));
    expect(cut40("a\tb\nc\u00a0d  e")).toBe("a b c d e");
    for (const s of [...samples, long]) expect(wc(cut40(s))).toBe(Math.min(40, wc(s)));
  });
  test("row fields come from the one parse: issues and fixes cut, words and fix_words counted before the cut, empty without a block", () => {
    const longIssue = Array.from({ length: 52 }, (_, i) => "i" + i).join("\u00a0");
    const p = parseCeoBlock(JSON.stringify({ top: [{ issue: longIssue, fix: "keep\tit" }, { issue: "short one" }], forecast: 10 }));
    expect(ceoRowFields(p)).toEqual({ issues: [cut40(longIssue), "short one"], words: [52, 2], fixes: ["keep it", ""], fix_words: [2, 0] });
    expect(ceoRowFields({ kind: "missing" })).toEqual({ issues: [], words: [], fixes: [], fix_words: [] });
  });
});

describe("item4-parser-shapes: the block, the last block and the end state on real shapes", () => {
  // Value: protects=section 6's parser and end-state table as they meet gstack 699a41cb's real output lines and call shapes; fails_when=a subagent's, an API error's or an AskUserQuestion's block counts, a valid early block outlives a malformed last one, a CLI failure or infra failure before a block scores, or a termination kind has no end state; why_new=binding item 4 and F3, F4, F20; seam=ceo-outcome.ts parseCeoBlock, lastCeoBlock, needsFollowUp, endState on transcript.ndjson shapes through capped.ts's mainAgentTexts; no_claim=a real ceo-outcome session (none exists before stage 1)
  test("parseCeoBlock: one object with a top array of issue strings; forecast a whole number 0 to 100 or null; fix \"\" when absent", () => {
    const ok = parseCeoBlock(JSON.stringify({ top: [{ issue: ISSUE, evidence: { section: "Rollout" }, fix: FIX }, { issue: "second", fix: "" }, { issue: "third", fix: 7 }, { issue: "fourth" }], forecast: 35 }));
    expect(ok).toMatchObject({ kind: "block", forecast: 35, top: [{ issue: ISSUE, evidence: { section: "Rollout" }, fix: FIX }, { issue: "second", evidence: null, fix: "" }, { issue: "third", fix: "" }, { issue: "fourth", fix: "" }] });
    for (const f of [101, -1, 35.5, "35", null]) expect((parseCeoBlock(JSON.stringify({ top: [], forecast: f })) as { forecast: unknown }).forecast).toBeNull();
    expect(parseCeoBlock(JSON.stringify({ top: [], forecast: 100.0 }))).toMatchObject({ kind: "block", top: [], forecast: 100 });
    expect(parseCeoBlock("[]")).toMatchObject({ kind: "malformed", reason: "the ceo-outcome block is not one JSON object" });
    expect(parseCeoBlock(JSON.stringify({ issues: [] }))).toMatchObject({ kind: "malformed", reason: 'the ceo-outcome block has no "top" array' });
    expect(parseCeoBlock(JSON.stringify({ top: [{ issue: "a" }, { claim: "b" }] }))).toMatchObject({ kind: "malformed", reason: 'top item 1 has no "issue" string' });
    const bad = parseCeoBlock('{"top": [{"issue": "the secret words here"');
    expect(bad).toMatchObject({ kind: "malformed", reason: "the ceo-outcome block is not valid JSON" });
    expect(JSON.stringify(bad)).not.toContain("secret");
    expect(ok.body_sha256).toBe(sha256(JSON.stringify({ top: [{ issue: ISSUE, evidence: { section: "Rollout" }, fix: FIX }, { issue: "second", fix: "" }, { issue: "third", fix: 7 }, { issue: "fourth" }], forecast: 35 })));
  });
  test("the autoplan session's block after its GSTACK_RESULT line parses; the subagent's block never counts", () => {
    const p = parse(...autoplanSession(BLOCK));
    expect(p).toMatchObject({ kind: "block", forecast: 35, top: [{ issue: ISSUE, fix: FIX }] });
    expect(needsFollowUp(transcript(...autoplanSession(BLOCK)))).toBe(false);
  });
  test("F20: a valid early block and a malformed last block read no block, across turns and within one turn", () => {
    expect(parse(main("First pass.\n\n" + BLOCK), main("Revised.\n\n" + BROKEN))).toMatchObject({ kind: "malformed" });
    expect(parse(main(BLOCK + "\n\nOne more thought.\n\n" + BROKEN))).toMatchObject({ kind: "malformed" });
    expect(needsFollowUp(transcript(main(BLOCK), main(BROKEN)))).toBe(true);
    expect(parse(main(BROKEN), main(BLOCK))).toMatchObject({ kind: "block" });
  });
  test("F3: a block only in a subagent's text, an API error's text or an AskUserQuestion is no block, so the follow-up fires", () => {
    const cases = [
      [main("Review done."), sub(BLOCK)],
      [main("Review done."), apiError("API Error: 529 " + BLOCK)],
      [main("Review done."), tool("AskUserQuestion", { questions: [{ ...MODE_QUESTION, question: MODE_QUESTION.question + "\n" + BLOCK }] }, "tq"), result("tq", "User has answered your questions")],
      [tool("Read", { file_path: "/work/unit/plan.md" }, "tr"), result("tr", BLOCK)],
    ];
    for (const ms of cases) {
      expect(parse(...ms)).toEqual({ kind: "missing" });
      expect(needsFollowUp(transcript(...ms))).toBe(true);
    }
    expect(parse(...autoplanSession("No block this time."))).toEqual({ kind: "missing" });
  });
  test("the follow-up turn's block counts as the last block; a follow-up turn with none leaves the first turn's malformed block", () => {
    expect(parse(main("Review done. " + RESULT_LINE), main(BLOCK))).toMatchObject({ kind: "block" });
    expect(parse(main(BROKEN), main("I cannot add more."))).toMatchObject({ kind: "malformed" });
    expect(parse()).toEqual({ kind: "missing" });
    expect(lastCeoBlock(mainAgentTexts("not json\n{\"type\":\"assistant\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":" + JSON.stringify(BLOCK) + "}]},\"parent_tool_use_id\":null}\n{\"type\":\"assistant\""))).toMatchObject({ kind: "block" });
  });
  test("F4: every termination kind has its end state, before a block and after one", () => {
    const block = parse(main(BLOCK));
    const none: CeoParse = { kind: "missing" };
    const malformed = parse(main(BLOCK), main(BROKEN));
    const unreadable: CeoParse = { kind: "unreadable", reason: "ENOENT" };
    const table: [Termination, string, string][] = [
      [{ kind: "completed" }, "no-block", "scored"],
      [{ kind: "turn_cap" }, "no-block", "scored"],
      [{ kind: "allowance_stop" }, "no-block", "scored"],
      [{ kind: "timeout" }, "no-block", "scored"],
      [{ kind: "arm_failure", failure: "harness_crash" }, "gap", "scored"],
      [{ kind: "missing", code: "E_INFRA_FAILURE" }, "gap", "scored"],
      [{ kind: "missing", code: "UPSTREAM" }, "gap", "scored"],
      [{ kind: "missing", code: "E_ALLOWANCE" }, "gap", "scored"],
      [{ kind: "missing", code: "E_BACKGROUND_DEADLINE" }, "gap", "scored"],
      [{ kind: "missing", code: "E_USER_TURNS_MISSING" }, "gap", "scored"],
      [{ kind: "missing", code: "E_APPROVAL_BYPASS" }, "gap", "scored"],
      [{ kind: "missing", code: "E_CODEX_CONFIG" }, "gap", "scored"],
      [{ kind: "infra", incident: "provider outage" }, "gap", "scored"],
      [{ kind: "credentials_rejected" }, "gap", "scored"],
      [{ kind: "unknown", reservation_id: "r1" }, "gap", "scored"],
      [{ kind: "cap_stop" }, "incomplete", "incomplete"],
    ];
    const kinds: Record<Termination["kind"], true> = { completed: true, arm_failure: true, timeout: true, missing: true, infra: true, credentials_rejected: true, cap_stop: true, turn_cap: true, allowance_stop: true, unknown: true };
    expect(new Set<string>(table.map(([t]) => t.kind))).toEqual(new Set<string>(Object.keys(kinds)));
    const at = (t: Termination, state: string) => JSON.stringify(t) + " " + state;
    for (const [t, before, after] of table) {
      expect(at(t, endState(t, none))).toBe(at(t, before));
      expect(at(t, endState(t, malformed))).toBe(at(t, before));
      expect(at(t, endState(t, block))).toBe(at(t, after));
      expect(at(t, endState(t, unreadable))).toBe(at(t, t.kind === "cap_stop" ? "incomplete" : "gap"));
    }
  });
});

describe("the ceo-outcome suite kind: key.json's frozen fields", () => {
  // Value: protects=B2's key.json carries exactly the fields the readings contract, packets and readings need, blank as null, and a refusal names fields, never key text; fails_when=a field is renamed, dropped or added, a held unit carries a D or remedy, or a remedy lacks its kind; why_new=plan section 0 (the unit suite) and section 7; seam=lanes/review-noloss/suite.ts ceoKeyProblems, checkCeoUnits, suiteProblems; no_claim=any real key
  const changed = { kind: "changed", outcome: "rejected", outcome_date: "2026-10-01", strict: "2026-09-12", category: "scope", role: "outside", D: "secret decisive words", D2: null, match_notes: "names the opt-out", R1: "r1 words", R2: null, R3: null, remedy: "ship a smaller first step", remedy_notes: "names the smaller step", remedy_kind: "scope", decoy: "R1", second_order: false, pointers: ["https://example.invalid/record"] };
  const held = { ...changed, kind: "held", outcome: "held", category: "held", D: null, match_notes: null, R1: null, remedy: null, remedy_notes: null, remedy_kind: null, decoy: null };
  test("the field list and its sound shapes", () => {
    expect([...CEO_KEY_FIELDS]).toEqual(["kind", "outcome", "outcome_date", "strict", "category", "role", "D", "D2", "match_notes", "R1", "R2", "R3", "remedy", "remedy_notes", "remedy_kind", "decoy", "second_order", "pointers"]);
    expect(ceoKeyProblems(changed)).toEqual([]);
    expect(ceoKeyProblems(held)).toEqual([]);
    expect(ceoKeyProblems({ ...changed, remedy: null, remedy_notes: null, remedy_kind: null, decoy: null })).toEqual([]);
  });
  test("refusals name the field and never the key's text", () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ ...changed, extra: 1 }, "unknown field extra"],
      [(({ remedy_kind: _, ...rest }) => rest)(changed), "missing field remedy_kind"],
      [{ ...changed, kind: "held" }, "outcome and kind disagree"],
      [{ ...changed, category: "code defect" }, "category must be one of"],
      [{ ...changed, remedy_kind: null }, "remedy_kind must be"],
      [{ ...changed, decoy: "R2" }, "decoy names R2, which is null"],
      [{ ...held, D: "secret decisive words" }, "so D must be null"],
      [{ ...changed, strict: "Sept" }, "strict must be a date"],
      [{ ...changed, second_order: "yes" }, "second_order must be true or false"],
    ];
    for (const [key, message] of cases) {
      const p = ceoKeyProblems(key);
      expect(p.join("; ")).toContain(message);
      expect(p.join("; ")).not.toContain("secret");
    }
  });
  test("a ceo-outcome suite takes units with no blockers and one units dir, and checkCeoUnits reads each unit's key.json and plan.md", () => {
    const root = mkdtempSync(join(tmpdir(), "ceo-suite-"));
    const id = "acme/widgets#7@" + "a".repeat(12);
    const suite = { schema_version: 1, id: "ceo-s", title: "t", kind: "ceo-outcome", development_only: true, purpose: "p", sealed: false, catalogs: ["units"], sources: [], prereg_freezes: [], judging_rule: "judge-brief.md", shelf_life: { rule: "r", released: null }, groups: {}, units: [{ id, repo: "acme/widgets", pr: 7, head: "a".repeat(40), base: "b".repeat(40), cluster: "acme/widgets#7", group: null, blockers: [] }], ineligible: [], excluded: [], frozen_bars: [] } as unknown as Suite;
    expect(suiteProblems(suite)).toEqual([]);
    expect(suiteProblems({ ...suite, catalogs: ["a", "b"] })).toContain("a ceo-outcome suite's catalogs list one dir, its units dir");
    expect(checkCeoUnits(suite, root)).toEqual([id + ": no key.json in " + join(root, "units", "acme__widgets#7@" + "a".repeat(12)), id + ": no plan.md in " + join(root, "units", "acme__widgets#7@" + "a".repeat(12))]);
    mkdirSync(ceoUnitDir(suite, id, root), { recursive: true });
    writeFileSync(join(ceoUnitDir(suite, id, root), "plan.md"), "# Plan\n");
    writeFileSync(join(ceoUnitDir(suite, id, root), "key.json"), JSON.stringify({ ...changed, D: "" }));
    expect(checkCeoUnits(suite, root)).toEqual([id + ": key.json: D must be text"]);
    writeFileSync(join(ceoUnitDir(suite, id, root), "key.json"), JSON.stringify(changed));
    expect(checkCeoUnits(suite, root)).toEqual([]);
    const digest = catalogsDigest(suite, root);
    writeFileSync(join(ceoUnitDir(suite, id, root), "key.json"), JSON.stringify({ ...changed, decoy: null }));
    expect(catalogsDigest(suite, root)).not.toBe(digest);
    removeTree(root);
  });
});
