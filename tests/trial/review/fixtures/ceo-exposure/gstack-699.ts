// Copyright (c) 2026 Garry Tan. MIT licence.
// Vendored from garrytan/gstack at 699a41cb6808e01240d02e82247693f9170d401a (VERSION 1.94.39.0); NOTICE.md lists it.
// Each line below is copied unchanged from the file its comment names, so ceo-exposure.test.ts meets the pinned
// commit's own text. With OUTCOME_GSTACK_PIN naming a checkout of that commit, the test finds each line in its file.
// Changes: none to the lines. The test fills each template's placeholders (<mode>, <rows or none>, $mode, $decisions,
// <absolute $_AP>) with values of its own, and builds every call from the input shapes noted below with paths and
// review words of its own. No session text from any run is copied here.

/** bin/gstack-ceo-mode-handoff: the --ceo-only and --auto lines it prints, and its usage line for modes. */
export const HANDOFF_BIN = {
  file: "bin/gstack-ceo-mode-handoff",
  ceoOnly: '  echo "Auto-selected review mode \u2192 $mode (CEO-only run: Step 0E\'s rule). Approved decisions: $decisions."',
  auto: '  echo "Auto-decided review mode \u2192 $mode (your preference). Change with /plan-tune. Approved decisions: $decisions."',
  underscores: "#         (underscores accepted for spaces)",
};

/** autoplan/sections/ceo-only.md: the handoff call it tells the run to make, the Findings heading and the result line. */
export const CEO_ONLY = {
  file: "autoplan/sections/ceo-only.md",
  call: '`~/.claude/skills/gstack/bin/gstack-ceo-mode-handoff "<mode>" --ceo-only --decisions "<rows or none>"`',
  findings: "`## Findings` (severity, section, fix, disposition) and `## Decision Audit",
  result: "`GSTACK_RESULT: skill=autoplan status=reviewed run=<absolute $_AP>`",
};

/** plan-ceo-review/sections/review-sections.md: its first heading and Section 1's heading. */
export const REVIEW_SECTIONS = {
  file: "plan-ceo-review/sections/review-sections.md",
  title: "## Review Sections (11 sections, after scope and mode are agreed)",
  section1: "### Section 1: Architecture Review",
};

/** plan-ceo-review/SKILL.md: the line that sends the session to review-sections.md, and one mode's definition. */
export const SKILL = {
  file: "plan-ceo-review/SKILL.md",
  read: "> **STOP.** Before running the 11-section deep review, required outputs, and review report (only after Step 0 scope and mode are agreed), Read `~/.claude/skills/gstack/plan-ceo-review/sections/review-sections.md` and execute it",
  hold: "* HOLD SCOPE: Preserve scope; trace failures, edge cases, error paths, tests and observability.",
};

/** test/fixtures/auto-decide-handoff-line-e354.json: a captured Bash call to the handoff (an --auto run, so it must not count). */
export const CAPTURED_AUTO_HANDOFF = {
  file: "test/fixtures/auto-decide-handoff-line-e354.json",
  command: '~/.claude/skills/gstack/bin/gstack-ceo-mode-handoff "HOLD SCOPE" --decisions "none" --auto',
};

// Input shapes the test builds calls from, as gstack's captured SDK fixtures carry them:
// Read {file_path, limit} (test/fixtures/autoplan-method-read-aa-events.json), Write {file_path, content}
// (test/fixtures/autoplan-dual-false-positive-6bd.json), Edit {replace_all, file_path, old_string, new_string}
// (test/fixtures/design-handoff-n-calls.json), and tool_result {type, tool_use_id, content, is_error} (6bd's events).
