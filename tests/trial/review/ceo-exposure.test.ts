// Binding item 4: the two exposure detectors (CEO prereg section 7, as the B1 plan's section 12 widens them) on gstack
// 699a41cb's own lines and captured call shapes (fixtures/ceo-exposure/gstack-699.ts), with review words of our own.
// Each detector reads one session's transcript.ndjson: the main agent's own text and its own tool calls with their results.
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { autoplanCeoExposure, GSTACK_CEO_PIN, standaloneExposure } from "../../../src/trial/review/ceo-exposure.ts";
import * as G from "./fixtures/ceo-exposure/gstack-699.ts";

type Msg = Record<string, unknown>;
let n = 0;
const say = (text: string, extra: Msg = {}): Msg => ({ type: "assistant", message: { content: [{ type: "text", text }] }, parent_tool_use_id: null, ...extra });
/** One tool call and its result, as the SDK records them; parent puts both inside a subagent. */
const call = (name: string, input: Msg, result: string | null, o: { error?: boolean; parent?: string } = {}): Msg[] => {
  const id = "toolu_" + ++n;
  const parent = o.parent ?? null;
  const use = { type: "assistant", message: { content: [{ type: "tool_use", id, name, input }] }, parent_tool_use_id: parent };
  return result === null ? [use] : [use, { type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content: result, is_error: o.error ?? false }] }, parent_tool_use_id: parent }];
};
const skillBody = (text: string): Msg => ({ type: "user", message: { content: [{ type: "text", text }] }, parent_tool_use_id: null, isMeta: true });
const nd = (...parts: (Msg | Msg[])[]) => parts.flat().map((m) => JSON.stringify(m)).join("\n") + "\n";

const SKILLS = "/work/agent/.claude/skills/gstack";
const SECTIONS = SKILLS + "/plan-ceo-review/sections/review-sections.md";
const SECTIONS_TEXT = "     1\t<!-- AUTO-GENERATED from review-sections.md.tmpl -->\n     3\t" + G.REVIEW_SECTIONS.title + "\n";
const fill = (t: string, mode: string) => t.replace(/^\s*echo "|"$/g, "").replace("$mode", mode).replace("$decisions", "none");
const CEO_ONLY_LINE = fill(G.HANDOFF_BIN.ceoOnly, "HOLD SCOPE");
const AUTO_LINE = fill(G.HANDOFF_BIN.auto, "HOLD SCOPE");
const ceoOnlyCall = (mode: string) => G.CEO_ONLY.call.slice(1, -1).replace("<mode>", mode).replace("<rows or none>", "none");
const AP = "/work/agent/.gstack/projects/demo/autoplan-run-1";
const REVIEW = ["# CEO-only review: cache the profile reads", "Mode: HOLD SCOPE. Outside voice: disabled. Not approved.", "## User challenges (direction kept)", "None.", "## Scope added", "None.", "## Conservative choices", "None.", "## Findings", "- High, Section 2: the cache has no eviction bound. Fix: cap it at 1000 entries. Disposition: open.", "## Decision Audit Trail", "None."].join("\n");
const NO_FINDINGS = REVIEW.split("## Findings")[0]!;

describe("the pinned gstack files", () => {
  test("ceo-exposure.ts pins the four files it was built from at 699a41cb", () => {
    expect(GSTACK_CEO_PIN).toEqual({
      repo: "garrytan/gstack",
      sha: "699a41cb6808e01240d02e82247693f9170d401a",
      files: {
        "plan-ceo-review/sections/review-sections.md": "4fd3afe2b395cf5c3c5c7f06e497f4b586bd8050a1a4e3b95514260027aca441",
        "plan-ceo-review/SKILL.md": "46b7e0cfa8ede8204a416f40a482555e3325bba710594169307fbc25d709dd4f",
        "autoplan/sections/ceo-only.md": "18b171215648efb6accb69b74f8f78535eed16b5947464015851164670375f98",
        "bin/gstack-ceo-mode-handoff": "530ade6ed08c2795779f4c828855d5ab509158e006313d955036dca53f61b1f1",
      },
    });
  });
  const pin = process.env.OUTCOME_GSTACK_PIN;
  test.skipIf(!pin)("with OUTCOME_GSTACK_PIN set: each pinned file hashes to its digest and holds every vendored line", () => {
    for (const [f, sha] of Object.entries(GSTACK_CEO_PIN.files)) expect(createHash("sha256").update(readFileSync(join(pin!, f))).digest("hex")).toBe(sha);
    for (const group of [G.HANDOFF_BIN, G.CEO_ONLY, G.REVIEW_SECTIONS, G.SKILL, G.CAPTURED_AUTO_HANDOFF] as Record<string, string>[]) {
      const text = readFileSync(join(pin!, group.file!), "utf8");
      for (const [k, line] of Object.entries(group)) if (k !== "file") expect(text.includes(group.file!.endsWith(".json") ? JSON.stringify(line).slice(1, -1) : line)).toBe(true);
    }
  });
});

describe("standalone: review-sections.md read, and a mode named in the session's own text", () => {
  const read = call("Read", { file_path: SECTIONS, limit: 400 }, SECTIONS_TEXT);
  const named = say("Step 0E: this is a fix to an existing path, so I recommend HOLD SCOPE.\n\n" + G.REVIEW_SECTIONS.section1 + "\nThe cache wrapper sits inside the repository.");
  test("a successful Read and a mode in its own text: exposed, every check named", () => {
    expect(standaloneExposure(nd(read, named))).toEqual({ detector: "standalone", exposed: true, failed: null, checks: { review_sections_read: true, mode_named: true } });
  });
  test("HOLD_SCOPE with an underscore counts as the mode", () => {
    expect(standaloneExposure(nd(read, say("Mode: HOLD_SCOPE."))).exposed).toBe(true);
  });
  test("a simple Bash read (cat, head, sed -n, nl) with output counts; a chained one, an empty one and --help do not", () => {
    for (const c of ["cat " + SECTIONS, "head -n 120 " + SECTIONS, "sed -n '1,200p' " + SECTIONS, "nl -ba " + SECTIONS]) expect(standaloneExposure(nd(call("Bash", { command: c, description: "Read sections" }, SECTIONS_TEXT), named)).exposed).toBe(true);
    expect(standaloneExposure(nd(call("Bash", { command: "cat " + SKILLS + "/plan-ceo-review/SKILL.md; cat " + SECTIONS }, SECTIONS_TEXT), named)).failed).toBe("review_sections_read");
    expect(standaloneExposure(nd(call("Bash", { command: "cat " + SECTIONS }, ""), named)).failed).toBe("review_sections_read");
    expect(standaloneExposure(nd(call("Bash", { command: "cat --help " + SECTIONS }, "Usage: cat"), named)).failed).toBe("review_sections_read");
  });
  test("a Read whose result is an error or carries tool_use_error did not happen", () => {
    expect(standaloneExposure(nd(call("Read", { file_path: SECTIONS }, "File does not exist.", { error: true }), named)).failed).toBe("review_sections_read");
    expect(standaloneExposure(nd(call("Read", { file_path: SECTIONS }, "<tool_use_error>File has not been read yet</tool_use_error>"), named)).failed).toBe("review_sections_read");
    expect(standaloneExposure(nd(call("Read", { file_path: SECTIONS }, null), named)).failed).toBe("review_sections_read");
  });
  test("a Read by a subagent, or of another file, does not count", () => {
    const launch = call("Agent", { description: "Outside voice", prompt: "Review the plan." }, "Done.");
    expect(standaloneExposure(nd(launch, call("Read", { file_path: SECTIONS }, SECTIONS_TEXT, { parent: "toolu_" + (n - 1) }), named)).failed).toBe("review_sections_read");
    expect(standaloneExposure(nd(call("Read", { file_path: SKILLS + "/plan-eng-review/sections/review-sections.md" }, SECTIONS_TEXT), named)).failed).toBe("review_sections_read");
  });
  test("a mode that only the injected skill body, a tool result, a subagent or an API error names does not count", () => {
    expect(standaloneExposure(nd(skillBody(G.SKILL.read + "\n" + G.SKILL.hold), read)).failed).toBe("mode_named");
    expect(standaloneExposure(nd(call("Read", { file_path: SECTIONS }, SECTIONS_TEXT + G.SKILL.hold))).failed).toBe("mode_named");
    expect(standaloneExposure(nd(read, say("I pick HOLD SCOPE.", { parent_tool_use_id: "toolu_x" }))).failed).toBe("mode_named");
    expect(standaloneExposure(nd(read, say("API Error: HOLD SCOPE", { is_api_error_message: true }))).failed).toBe("mode_named");
  });
  test("a lower-case mode is not a mode name", () => {
    expect(standaloneExposure(nd(read, say("I will hold scope here."))).failed).toBe("mode_named");
  });
});

describe("autoplan-ceo: the handoff run with --ceo-only, and ceo-review.md written with a Findings section", () => {
  const handoff = call("Bash", { command: ceoOnlyCall("HOLD SCOPE"), description: "Mode handoff" }, CEO_ONLY_LINE);
  const write = call("Write", { file_path: AP + "/ceo-review.md", content: REVIEW }, "File created successfully at: " + AP + "/ceo-review.md");
  test("ceo-only.md's own call, its printed line and a Write with ## Findings: exposed", () => {
    expect(CEO_ONLY_LINE).toBe("Auto-selected review mode \u2192 HOLD SCOPE (CEO-only run: Step 0E's rule). Approved decisions: none.");
    expect(autoplanCeoExposure(nd(handoff, say(CEO_ONLY_LINE), write))).toEqual({ detector: "autoplan-ceo", exposed: true, failed: null, checks: { handoff_ceo_only: true, findings_written: true } });
  });
  test("HOLD_SCOPE with an underscore in the call counts", () => {
    expect(autoplanCeoExposure(nd(call("Bash", { command: ceoOnlyCall("HOLD_SCOPE") }, CEO_ONLY_LINE), write)).exposed).toBe(true);
  });
  test("a chained call counts when its own result holds the line --ceo-only prints, and not without it", () => {
    const chained = ceoOnlyCall("SELECTIVE_EXPANSION") + '; echo "HANDOFF_EXIT: $?"';
    expect(autoplanCeoExposure(nd(call("Bash", { command: chained }, fill(G.HANDOFF_BIN.ceoOnly, "SELECTIVE EXPANSION") + "\nHANDOFF_EXIT: 0"), write)).exposed).toBe(true);
    expect(autoplanCeoExposure(nd(call("Bash", { command: chained }, "HANDOFF_EXIT: 2"), write)).failed).toBe("handoff_ceo_only");
  });
  test("the captured --auto call and its line, an errored call, a subagent's call or the line only in its own text do not count", () => {
    expect(autoplanCeoExposure(nd(call("Bash", { command: G.CAPTURED_AUTO_HANDOFF.command }, AUTO_LINE), write)).failed).toBe("handoff_ceo_only");
    expect(autoplanCeoExposure(nd(call("Bash", { command: ceoOnlyCall("HOLD SCOPE") }, "gstack-ceo-mode-handoff: unknown mode: HOLD", { error: true }), write)).failed).toBe("handoff_ceo_only");
    expect(autoplanCeoExposure(nd(call("Bash", { command: ceoOnlyCall("HOLD SCOPE") }, "<tool_use_error>Cancelled</tool_use_error>" + CEO_ONLY_LINE), write)).failed).toBe("handoff_ceo_only");
    expect(autoplanCeoExposure(nd(call("Bash", { command: ceoOnlyCall("HOLD SCOPE") }, CEO_ONLY_LINE, { parent: "toolu_x" }), write)).failed).toBe("handoff_ceo_only");
    expect(autoplanCeoExposure(nd(say(CEO_ONLY_LINE), write)).failed).toBe("handoff_ceo_only");
  });
  test("a ## Findings heading that a later Edit or MultiEdit adds to ceo-review.md counts", () => {
    const first = call("Write", { file_path: AP + "/ceo-review.md", content: NO_FINDINGS }, "File created successfully");
    expect(autoplanCeoExposure(nd(handoff, first)).failed).toBe("findings_written");
    const edit = call("Edit", { replace_all: false, file_path: AP + "/ceo-review.md", old_string: "None.\n", new_string: "None.\n## Findings\n- Medium, Section 1: one point of failure. Fix: add a fallback." }, "The file has been updated.");
    expect(autoplanCeoExposure(nd(handoff, first, edit)).exposed).toBe(true);
    const multi = call("MultiEdit", { file_path: AP + "/ceo-review.md", edits: [{ old_string: "a", new_string: "b" }, { old_string: "None.", new_string: "## Findings\nNone." }] }, "Applied 2 edits.");
    expect(autoplanCeoExposure(nd(handoff, first, multi)).exposed).toBe(true);
  });
  test("a simple Bash heredoc or redirect into ceo-review.md counts; one into another file does not", () => {
    expect(autoplanCeoExposure(nd(handoff, call("Bash", { command: 'cat > "' + AP + "/ceo-review.md\" <<'EOF'\n" + REVIEW + "\nEOF" }, ""))).exposed).toBe(true);
    expect(autoplanCeoExposure(nd(handoff, call("Bash", { command: "printf '\\n## Findings\\nNone.\\n' >> " + AP + "/ceo-review.md" }, ""))).exposed).toBe(true);
    expect(autoplanCeoExposure(nd(handoff, call("Bash", { command: "cat > " + AP + "/notes.md <<'EOF'\n" + REVIEW + "\nEOF" }, ""))).failed).toBe("findings_written");
  });
  test("a write that errored, a subagent's write, another file's Findings or Findings only in its own text do not count", () => {
    expect(autoplanCeoExposure(nd(handoff, call("Write", { file_path: AP + "/ceo-review.md", content: REVIEW }, "EACCES", { error: true }))).failed).toBe("findings_written");
    expect(autoplanCeoExposure(nd(handoff, call("Write", { file_path: AP + "/ceo-review.md", content: REVIEW }, "ok", { parent: "toolu_x" }))).failed).toBe("findings_written");
    expect(autoplanCeoExposure(nd(handoff, call("Write", { file_path: AP + "/ceo-plan.md", content: REVIEW }, "ok"))).failed).toBe("findings_written");
    expect(autoplanCeoExposure(nd(handoff, call("Write", { file_path: AP + "/ceo-review.md", content: NO_FINDINGS + "\nSee ## Findings below." }, "ok"))).failed).toBe("findings_written");
    expect(autoplanCeoExposure(nd(handoff, say(REVIEW))).failed).toBe("findings_written");
  });
  test("the injected ceo-only.md body names the call and the heading, and counts for nothing", () => {
    expect(autoplanCeoExposure(nd(skillBody([G.CEO_ONLY.call, G.CEO_ONLY.findings, G.CEO_ONLY.result].join("\n"))))).toEqual({ detector: "autoplan-ceo", exposed: false, failed: "handoff_ceo_only", checks: { handoff_ceo_only: false, findings_written: false } });
  });
});
