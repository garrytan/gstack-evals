---
id: 2026-10-28-gsta-13-office-hours-diet-contract-lines
kind: research
title: "Office-hours diet: contract lines and task coverage"
summary: The v1.91.289.0 office-hours diet moved 54 contract lines into sections, rewrote 3 and removed none. With 13 tasks, 46 of the 57 changed lines have no covering task.
author: GSTA-13
model: anthropic/claude-opus-5-5
captain: GSTA-2
date: 2026-10-28
status: done
source: quick/lanea-quick/contract-lines/README.md as first committed in garrytan/gstack-evals#6 at 66d3ef0, by GSTA-13 and its Subagent 1. Its body is unchanged except that relative paths now name repo paths.
links:
  - 2026-10-28-gsta-13-lanea-quick-office-hours-diet-prereg
  - quick/lanea-quick/contract-lines/
  - https://github.com/garrytan/gstack/pull/3525
---

# Office-hours diet: contract lines and task coverage

This folder checks which contract lines of gstack's /office-hours skill the v1.91.289.0 diet kept, moved, rewrote or removed, and which office-hours eval tasks would notice if one of those lines stopped working. Before is `cd4fc4be` (v1.91.288.0), after is `a14c28ac` (v1.91.289.0, "skill diet pilots"). Both come from public, MIT-licensed garrytan/gstack, so the quoted lines below are safe to publish. Quotes are verbatim after normalization, so some carry the source's own dashes.

The map covers 13 tasks: the 11 from gstack#3550 and the 2 that GSTA-13 added for the moved blocks (second-opinion-accepted, visual-sketch-accepted). Every count is shown for 11 and for 13 tasks. The map was written from the skill text, the task files and the harness description (the preregistration draft then at `quick/lanea-quick/PREREG.md`, now the post 2026-10-28-gsta-13-lanea-quick-office-hours-diet-prereg, and the grader and the scripted user in `quick/lanea-quick/src/`), before any eval run existed. No run data was read.

**Change after this map was written (GSTA-13, before any run).** visual-sketch-accepted now removes gstack's design binary in its setup and checks for `sketch.html`. So it takes the wireframe path (SKILL.md 723, 844, 855 and 861 in before) instead of the mockup step (726 and 728). The tables below predate that change, and the results post recounts this task's lines. Its files now hash to `e5ab6a90f70061d2755300fdb9b3d348a711fe588c9df53e5a18f0ecc0dcde9d` (tasks) and `44448568dfe4c5daef54e9363d5e2de6b7b03f829f5668d4d443b257edbade2d` (sidecar).

## Files

The files sit in `quick/lanea-quick/contract-lines/`.

- `extract.ts` extracts and classifies the lines. It needs Bun and nothing else, and reads the skill through `git show`, so a blobless clone works:

  ```
  bun quick/lanea-quick/contract-lines/extract.ts --gstack ~/.capy/work/gstack \
    --before cd4fc4be73d86a5b14be9a91026d3e4b16cd8520 \
    --after a14c28aca7839cd0182fa130bff9874714672c24 \
    --skill office-hours --out quick/lanea-quick/contract-lines/lines.json
  ```

  Two runs gave byte-identical output (`lines.json` sha256 `8b99d6ac2e7ed588b6252d90c88443029c91ce9c0a2269331ca49ef7f023baee`).
- `lines.json` holds every before contract line with its class, where it lived before and after, its match and similarity, the after-only contract lines, file digests and the full rule set under `meta.rules`. Adding tasks did not change it.
- `coverage.json` lists the covering tasks for every moved, rewritten or removed line. Each cover names its graders (`via`), its strength with the judge and without it, and a reason; each line carries its status for 11 and 13 tasks, with and without the judge; uncovered lines carry a reason.

## How lines are picked and classed

The extractor reads `office-hours/SKILL.md` and every `office-hours/sections/*.md` (no `.tmpl`). It works on logical lines: wrapped prose lines join until a line ends a sentence, while list items, headings and table rows stand alone. Shell fences are skipped, because they hold commands. Other fences only give format lines: markdown headings in a template and ALL-CAPS labels such as `PREMISES:` or `SECOND OPINION (Codex):`.

A logical line is a contract line when it matches one of six regex families: must (`must`, `ALWAYS`, `required`), never, stop (`STOP`), prohibition (`do not`, `don't`, `NOT`, `skip`, `avoid`), ask (`AskUserQuestion`, `ask`, `approve`, `confirm`, `wait`) and output (`output`, `format`, `header`, a named artifact such as design doc, wireframe, mockup or assignment, a write or save of a file, a mandated "say" or "tell the user"). The exact regexes sit at the top of `extract.ts` and in `meta.rules`. Before comparing, the extractor drops list, quote and heading markers, emphasis and backticks, straightens quotes and collapses whitespace.

Classes follow the brief. Kept means the same normalized line is still in after SKILL.md. Moved means it is gone from after SKILL.md but sits in an after section. Rewritten means no exact copy exists anywhere in after, but some after line scores at least 0.5 on Sørensen-Dice over content words (stopwords dropped, negations kept). Removed means nothing scores that high. Exact matching counts copies, so a line printed twice in before needs two copies in after. Only three lines needed the similarity step, scoring 0.606, 0.684 and 0.913, so any threshold up to 0.606 gives the same classes.

The regexes pick directive wording. A principle with no directive word, such as "Interest is not demand.", is not a contract line, and the output family also catches some descriptive lines that mention a design doc.

## Counts

| Class | From SKILL.md | Already in a section | Total |
|---|---:|---:|---:|
| kept | 95 | 0 | 95 |
| moved | 54 | 219 | 273 |
| rewritten | 3 | 0 | 3 |
| removed | 0 | 0 | 0 |
| total | 152 | 219 | 371 |

The diet changed 57 contract lines: 54 moved out of SKILL.md into the two new sections and 3 were rewritten in place. None was removed outright. Both new sections are byte-for-byte copies of the blocks cut from SKILL.md (checked with `diff`), and the four sections that existed before did not change. The 219 lines that already lived in sections stay where they were. They count as moved under the literal rule, and `lines.json` marks them `diet_change: false`. Of those, the 57 in `preamble.md` are read first on every run, so they are effectively always loaded in both versions.

After adds 9 contract lines of its own: 8 in SKILL.md (the shortened Phase 3.5 question and its "If B" line, the rewritten Phase 4 gate, the new Phase 4.25 skip rule, two STOP pointers to the new sections, a section-index row and the rewritten search rule) and 1 in `second-opinion.md`.

## Coverage rule

A task covers a line when a run of that task with its scripted replies should reach the line's phase, and the task's must, check or judge would fail if the line's behavior were missing. Full means the grader observes the behavior the line asks for. Partial means the grader catches the likely failure (the step is skipped, or the doc lands early) but would pass some other failure, such as the wrong branch or wording, or the run reaches the phase only after several unscripted turns. When in doubt, the line is uncovered and gets a reason.

The brief counts the judge line as a grader, so the main numbers do. This quick look does not grade judges (PREREG.md: "No judge"), so every count also appears for must and check alone. The primary pass matches `must` against all assistant text plus AskUserQuestion questions and options (`src/session.ts`), and the map assumes that.

Four facts from PREREG.md decide which branch a run takes. The images hold gstack's design binary but no OpenAI key, so the design probe should print `DESIGN_READY`, Step 1 should create `designs/mockup-*`, and generation should fail at Step 3. They hold no Codex CLI, so the second opinion falls back to a Claude subagent. `TMPDIR` is `<work>/.tmp`.

## Coverage summary

Cells read full / partial / none.

| Lines | 11 tasks | 13 tasks | 11 tasks, must and check only | 13 tasks, must and check only |
|---|---|---|---|---|
| Changed by the diet (57) | 4 / 3 / 50 | 6 / 5 / 46 | 2 / 2 / 53 | 4 / 7 / 46 |
| Already in sections (219) | 5 / 9 / 205 | 5 / 9 / 205 | 0 / 8 / 211 | 0 / 8 / 211 |
| New in after (9) | 3 / 2 / 4 | 3 / 4 / 2 | 2 / 1 / 6 | 2 / 5 / 2 |

For the 57 lines the diet changed, the two added tasks cut the uncovered count from 50 to 46 with the judge, and from 53 to 46 on must and check alone. With 13 tasks, every covered diet line has a must or check cover, so the judge adds strength but no new line.

The first version of this map (11 tasks, before the PREREG.md facts) reported 4 / 4 / 49. One line moved since: the `DESIGN_NOT_AVAILABLE` fallback (SKILL.md:723) loses ui-visual-step's partial cover, because the probe should print `DESIGN_READY` in these images.

## What the two new tasks cover

**second-opinion-accepted** (target: the 16 lines moved to `second-opinion.md`)

- Full: SKILL.md 624, 642, the `SECOND OPINION (Claude subagent):` header and its format line.
- Partial: SKILL.md 532, 534, 620, 695, after SKILL.md:511, after SKILL.md:515, after SKILL.md:552, after second-opinion.md:3. These are the preflight's fallback when Codex is missing, the offer (judge only), the subagent dispatch, the Phase 4 gate through its check, and the new SKILL.md question, STOP pointer and gate plus the section's opening line.
- Not covered: SKILL.md 540, 552, 558, 559, 562, 568, 609, 628, 634, 648, 653. The run reaches the prompt file, the filesystem boundary, the cold-read questions, the review-log record, the synthesis and the premise check, but the must reads only the header. Lines 568, 609 and 634 are the Codex path, which these images never take. Line 540 is the No path.
- The must passes only on the primary pass. On the final-answer pass it fails in every arm, because the header appears mid-session and the session ends at the approach question.

**visual-sketch-accepted** (target: the 38 lines moved to `visual-design.md`)

- Full: SKILL.md 827, "UI means a visual", full only with the judge and partial on the check alone.
- Partial: SKILL.md 726, 728, 825, after SKILL.md:355, after SKILL.md:559. These are the designer-ready mockup step, its "say skip" notice, the section heading, and the new index row and STOP pointer.
- Not covered: SKILL.md 723, 753, 767, 775, 782, 789, 805, 807, 809, 823, 829, 834, 844, 847, 855, 861, 865, 873, 881, 884, 886, 888, 889, 894, 917, 919, 925, 928, 930, 971, 973, 976, 978, 979.
- The check is weaker in these images than it looks. Step 1 creates `designs/mockup-*` before `$D variants` runs, and with no OpenAI key nothing is saved. So the check passes once the mockup step starts, whether or not any visual or sketch exists, and it never isolates the sketch lines (844, 855, 861). If the probe printed `DESIGN_NOT_AVAILABLE` instead, the check would grade the sketch and 723, 844, 855 and 861 would gain a cover.

## Rewritten and removed lines

| Line | Before | After | Similarity | 11 | 13 | Covering tasks |
|---|---|---|---:|---|---|---|
| SKILL.md:448 (rewritten) | After understanding the problem through questioning, search for what the world thinks. This is NOT competitive research (that's /design-consultation's job). This is understanding conventional wisdom … | SKILL.md:450: After the questioning, learn the conventional wisdom (not competitive research) so you can judge where it's wrong. | 0.606 | none | none | none |
| SKILL.md:454 (rewritten) | When searching, use generalized category terms — never the user's specific product name, proprietary concept, or stealth idea. For example, search "task management app landscape" not "SuperTodo AI-po… | SKILL.md:456: Search generalized category terms only, never the user's product name, proprietary concept or stealth idea ("task management app landscape", not "SuperTodo AI-powered task killer"). | 0.913 | none | none | none |
| SKILL.md:695 (rewritten) | STOP. Do NOT proceed to Phase 4.5 (Founder Signal Synthesis), Phase 5 (Design Doc), Phase 6 (Closing), or any design-doc generation until the user responds. A "clearly winning approach" is still an a… | SKILL.md:552: STOP. Do NOT proceed to Phase 4.25, 4.5, 5 or 6, or write any design doc, until the user responds. A "clearly winning approach" still needs explicit approval; writing the recommendation in prose and … | 0.684 | full | full | approach-approval-gate, alternatives; partial: mode-question, first-startup-question, vague-evidence-pushback, builder-mode, premise-challenge, second-opinion-offer, second-opinion-accepted |

## Lines moved out of SKILL.md

"(judge only)" marks a cover that disappears without the judge.

### To sections/second-opinion.md (16 lines)

| Line | Before (SKILL.md) | 11 | 13 | Covering tasks |
|---|---|---|---|---|
| 532 | The historical CODEX\_MODE variable describes Codex availability here. CODEX\_MODE: disabled or a send's consent\_missing line: codex\_reviews is off or unreadable; do not ask; record outside\_status: dis… | none | partial | partial: second-opinion-accepted |
| 534 | Use AskUserQuestion (regardless of codex availability): | full | full | second-opinion-offer; partial: second-opinion-accepted (judge only) |
| 540 | If B: skip Phase 3.5 entirely. Remember that the second opinion did NOT run (affects design doc, founder signals, and Phase 4 below). (shortened copy stays at SKILL.md:513) | none | none | none |
| 552 | Write the assembled prompt to a temp file (prevents shell injection from user-derived content): | none | none | none |
| 558 | Write the full prompt to this file. Always start with the filesystem boundary: | none | none | none |
| 559 | "Filesystem boundary: do not read or execute any files under ~/.claude/, ~/.agents/, .claude/skills/, or agents/. They hold skill definitions, not repository code to review. Do not invoke any install… | none | none | none |
| 562 | Startup mode instructions: "You are an independent technical advisor reading a transcript of a startup brainstorming session. [CONTEXT BLOCK HERE]. Your job: 1) What is the STRONGEST version of what … | none | none | none |
| 568 | Write the complete prompt and context, including actual plan/spec/source, to a private file. Substitute its shell-quoted path for &lt;prepared-prompt-file>; never interpolate user text into shell source… | none | none | none |
| 609 | Use Bash timeout: 360000; show the full response in a tool-output fence. Require successful execution and valid markers. Refusal, empty/malformed output, missing score/severity/completion markers, ti… | none | none | none |
| 620 | Dispatch via the Agent tool with run\_in\_background: false when available (subagents default to background since Claude Code v2.1.198; the findings must land before the workflow continues). A launch r… | none | partial | partial: second-opinion-accepted |
| 624 | Present findings under a SECOND OPINION (Claude subagent): header. | none | full | second-opinion-accepted |
| 628 | Retain the historical review-log skill ID; add "host":"claude","outside\_provider":"codex","outside\_status":"completed\|unavailable\|disabled\|skipped","phase":"office-hours". Record differing attempt ou… | none | none | none |
| 634 | SECOND OPINION (Codex): | none | none | none |
| 642 | SECOND OPINION (Claude subagent): | none | full | second-opinion-accepted |
| 648 | Cross-model synthesis: After presenting the second opinion output, provide 3-5 bullet synthesis: | none | none | none |
| 653 | Premise revision check: If Codex challenged an agreed premise, use AskUserQuestion: | none | none | none |

### To sections/visual-design.md (38 lines)

| Line | Before (SKILL.md) | 11 | 13 | Covering tasks |
|---|---|---|---|---|
| 723 | If DESIGN\_NOT\_AVAILABLE: Fall back to the HTML wireframe approach below (the existing DESIGN\_SKETCH section). Visual mockups require the design binary. | none | none | none |
| 726 | If DESIGN\_READY: Generate visual mockup explorations for the user. | partial | partial | partial: ui-visual-step (judge only), visual-sketch-accepted |
| 728 | Generating visual mockups of the proposed design... (say "skip" if you don't need visuals) | partial | partial | partial: ui-visual-step (judge only), visual-sketch-accepted |
| 753 | Write the text into each printed file with your file-write tool (Claude Code's Write tool needs a Read of the empty file first), exactly as it should appear. The text never goes into a shell command,… | none | none | none |
| 767 | Round accounting (before any board, check or inline view): $D never overwrites; a taken name is bumped (for example -2), so use only the paths its JSON printed and carry them as literal paths into la… | none | none | none |
| 775 | Write this round's board images (printed paths that passed checks, in order) as a JSON array to $\_DESIGN\_DIR/board-images.json with the Write tool; board letters A, B, C follow that order. Then archi… | none | none | none |
| 782 | This publishes the board to the design daemon, opens it in the user's default browser, and exits; it does not wait for feedback. Read captured stderr for the BOARD\_URL: http://127.0.0.1:N/boards/&lt;id>… | none | none | none |
| 789 | If the command exits nonzero or prints no BOARD\_URL, show each variant inline with Read and fall back to AskUserQuestion: "Which variant do you prefer? Any feedback?" | none | none | none |
| 805 | If "regenerated": false: proceed with the approved variant. | none | none | none |
| 807 | Step 6: Save approved choice | none | none | none |
| 809 | Write the user's feedback (none when they gave none) into the feedback file from Step 2, then map the confirmed letter through this board's board-images.json (never the directory listing) and save it… | none | none | none |
| 823 | Reference the printed APPROVED\_IMAGE in the design doc or plan. | none | none | none |
| 825 | Visual Sketch (UI ideas only) (shortened copy stays at SKILL.md:556) | partial | partial | partial: ui-visual-step (judge only), backend-skips-visual, visual-sketch-accepted |
| 827 | If the chosen approach involves user-facing UI (screens, pages, forms, dashboards, or interactive elements), generate a rough wireframe to help the user visualize it. (shortened copy stays at SKILL.md:558) | full | full | ui-visual-step (judge only), visual-sketch-accepted |
| 829 | If the idea is backend-only, infrastructure, or has no UI component — skip this section silently. | full | full | backend-skips-visual |
| 834 | Check if DESIGN.md exists in the repo root. If it does, read it for design system constraints (colors, typography, spacing, component patterns). Use these constraints in the wireframe. | none | none | none |
| 844 | Step 2: Generate wireframe HTML | none | none | none |
| 847 | Intentionally rough aesthetic — use system fonts, thin gray borders, no color, hand-drawn-style elements. This is a sketch, not a polished mockup. | none | none | none |
| 855 | Create a private directory for it first — the renderer serves that whole directory over loopback, so it must be yours alone and hold nothing else (never a fixed, shared /tmp name another user could p… | none | none | none |
| 861 | Write the sketch to &lt;that directory>/sketch.html (Write tool). | none | none | none |
| 865 | gstack-render opens the sketch in the Aside browser when it is running — otherwise in gstack's own headless browser (its first line says which: ENGINE=aside or ENGINE=browse) — and screenshots it: | none | none | none |
| 873 | Only if it prints NEEDS\_ASIDE or ASIDE\_NOT\_RUNNING followed by ERROR: no browser available (Aside is not open AND gstack's own browser is not built), skip the render step. Tell the user: "The visual … | none | none | none |
| 881 | Show the screenshot to the user. Ask: "Does this feel right? Want to iterate on the layout?" | none | none | none |
| 884 | If they approve or say "good enough," proceed. | none | none | none |
| 886 | Step 5: Include in design doc | none | none | none |
| 888 | Reference the wireframe screenshot in the design doc's "Recommended Approach" section. | none | none | none |
| 889 | The screenshot file at &lt;sketch-dir>/sketch.png (name the full path in the doc) can be referenced by downstream skills (/plan-design-review, /design-review) to see what was originally envisioned. | none | none | none |
| 894 | After the wireframe is approved, offer outside design perspectives: | none | none | none |
| 917 | The historical CODEX\_MODE variable describes Codex availability here. CODEX\_MODE: disabled or a send's consent\_missing line: codex\_reviews is off or unreadable; do not ask; record outside\_status: dis… | none | none | none |
| 919 | If Codex is available, use AskUserQuestion: | none | none | none |
| 925 | If user chooses A, run both independent voices below and wait for both results before synthesis. They may overlap when the host supports parallel tool calls; the native subagent call remains blocking. | none | none | none |
| 928 | Prompt: "For this product approach, provide: a visual thesis (one sentence — mood, material, energy), a content plan (hero → support → detail → CTA), and 2 interaction ideas that change page feel. Ap… | none | none | none |
| 930 | Write the complete prompt and context, including actual plan/spec/source, to a private file. Substitute its shell-quoted path for &lt;prepared-prompt-file>; never interpolate user text into shell source… | none | none | none |
| 971 | Use Bash timeout: 360000; show the full response in a tool-output fence. Require successful execution and valid markers. Refusal, empty/malformed output, missing Recommendation markers, timeout or CL… | none | none | none |
| 973 | Retain the historical review-log skill ID; add "host":"claude","outside\_provider":"codex","outside\_status":"completed\|unavailable\|disabled\|skipped","phase":"design-sketch". Record differing attempt o… | none | none | none |
| 976 | "For this product approach, what design direction would you recommend? What aesthetic, typography, and interaction patterns fit? What would make this approach feel inevitable to the user? Be specific… | none | none | none |
| 978 | Present Codex output under CODEX SAYS (design sketch): and subagent output under CLAUDE SUBAGENT (design direction):. | none | none | none |
| 979 | Error handling: all non-blocking. On failure, skip and continue. | none | none | none |

## Lines already in sections

These did not change in the diet, and the two added tasks cover none of them.

| Section | Lines | 11 and 13 tasks (full / partial / none) | must and check only |
|---|---:|---|---|
| design-and-handoff.md | 121 | 0 / 1 / 120 | 0 / 0 / 121 |
| phase-2a-startup-diagnostic.md | 32 | 3 / 5 / 24 | 0 / 6 / 26 |
| phase-2b-builder-brainstorm.md | 9 | 2 / 3 / 4 | 0 / 2 / 7 |
| preamble.md | 57 | 0 / 0 / 57 | 0 / 0 / 57 |

Covered ones:

| Line | Text | Covering tasks |
|---|---|---|
| design-and-handoff.md:5 | Write the design document to the project directory. | partial: backend-skips-visual (judge only) |
| phase-2a-startup-diagnostic.md:7 | Specificity is the only currency. Vague answers get pushed. "Enterprises in healthcare" is not a customer. "Everyone needs this" means you can't find anyone. You need a name, a role, a company, a rea… | vague-evidence-pushback |
| phase-2a-startup-diagnostic.md:24 | Name common failure patterns. If you recognize a common failure mode — "solution in search of a problem," "hypothetical users," "waiting to launch until it's perfect," "assuming interest equals deman… | partial: vague-evidence-pushback |
| phase-2a-startup-diagnostic.md:71 | Ask these questions ONE AT A TIME via AskUserQuestion. Push on each one until the answer is specific, evidence-based, and uncomfortable. Comfort means the founder hasn't gone deep enough. | partial: vague-evidence-pushback |
| phase-2a-startup-diagnostic.md:77 | Smart routing based on product stage — you don't always need all six: | partial: first-startup-question (judge only) |
| phase-2a-startup-diagnostic.md:87 | Ask: "What's the strongest evidence you have that someone actually wants this — not 'is interested,' not 'signed up for a waitlist,' but would be genuinely upset if it disappeared tomorrow?" | first-startup-question (judge only) |
| phase-2a-startup-diagnostic.md:114 | Red flags: Category-level answers. "Healthcare enterprises." "SMBs." "Marketing teams." These are filters, not people. You can't email a category. | partial: vague-evidence-pushback |
| phase-2a-startup-diagnostic.md:120 | FORCING (aim for): "Name the actual human. Not 'product managers at mid-market SaaS companies' — an actual name, an actual title, an actual consequence. What's the real thing they're avoiding that yo… | partial: vague-evidence-pushback |
| phase-2a-startup-diagnostic.md:163 | Only allow a FULL skip (no additional questions) if the user provides a fully formed plan with real evidence — existing users, revenue numbers, specific customer names. Even then, still run Phase 3 (… | premise-challenge |
| phase-2b-builder-brainstorm.md:5 | Delight is the currency — what makes someone say "whoa"? | builder-mode |
| phase-2b-builder-brainstorm.md:14 | STRUCTURED (avoid): "Consider adding tags and search to the sound recorder. This would improve retention by making recordings easier to organize." | partial: builder-mode (judge only) |
| phase-2b-builder-brainstorm.md:23 | Help them find the most exciting version of their idea. Don't settle for the obvious version. | builder-mode (judge only) |
| phase-2b-builder-brainstorm.md:29 | Ask these ONE AT A TIME via AskUserQuestion. The goal is to brainstorm and sharpen the idea, not interrogate. | partial: builder-mode (judge only) |
| phase-2b-builder-brainstorm.md:34 | Who would you show this to? What would make them say "whoa"? | partial: builder-mode |

## New contract lines in after

| Line | Text | Closest before line | 11 | 13 | Covering tasks |
|---|---|---|---|---|---|
| SKILL.md:355 | \| Phase 4.25 visual design for an approved approach with user-facing UI (designer mockups, or the HTML sketch when the designer is unavailable) \| sections/visual-design.md \| | SKILL.md:723 (0.333) | partial | partial | partial: ui-visual-step (judge only), visual-sketch-accepted |
| SKILL.md:456 | Search generalized category terms only, never the user's product name, proprietary concept or stealth idea ("task management app landscape", not "SuperTodo AI-powered task killer"). | SKILL.md:454 (0.913) | none | none | none |
| SKILL.md:511 | Use AskUserQuestion: "Want a second opinion from an independent AI perspective? It reviews your problem statement, key answers, premises and landscape findings from a structured summary, without this… | SKILL.md:536 (0.702) | full | full | second-opinion-offer; partial: second-opinion-accepted (judge only) |
| SKILL.md:513 | If B: skip Phase 3.5 and remember the second opinion did NOT run (the design doc, founder signals and Phase 4 depend on it). | SKILL.md:540 (0.889) | none | none | none |
| SKILL.md:515 | STOP. Before running the Phase 3.5 second opinion the user just accepted (provider preflight, cold-read prompt, dispatch and synthesis), Read ~/.claude/skills/gstack/office-hours/sections/second-opin… | SKILL.md:361 (0.566) | none | partial | partial: second-opinion-accepted |
| SKILL.md:552 | STOP. Do NOT proceed to Phase 4.25, 4.5, 5 or 6, or write any design doc, until the user responds. A "clearly winning approach" still needs explicit approval; writing the recommendation in prose and … | SKILL.md:695 (0.684) | full | full | approach-approval-gate, alternatives; partial: mode-question, first-startup-question, vague-evidence-pushback, builder-mode, premise-challenge, second-opinion-offer, second-opinion-accepted |
| SKILL.md:558 | If the approach approved in Phase 4 has no user-facing UI (screens, pages, forms, dashboards, interactive elements), skip to Phase 4.5. | SKILL.md:827 (0.529) | full | full | backend-skips-visual |
| SKILL.md:559 | STOP. Before Phase 4.25 visual design for an approved approach with user-facing UI (designer mockups, or the HTML sketch when the designer is unavailable), Read ~/.claude/skills/gstack/office-hours/s… | SKILL.md:361 (0.519) | partial | partial | partial: ui-visual-step (judge only), visual-sketch-accepted |
| second-opinion.md:3 | The user already answered the Phase 3.5 question in SKILL.md with A. Run the provider preflight below, skip its AskUserQuestion, and continue from "If A". | SKILL.md:540 (0.303) | none | partial | partial: second-opinion-accepted |

## Uncovered lines

Diet-changed lines with no covering task among the 13, by reason:

- SKILL.md 448: Every task answers the landscape privacy gate with 'Skip. Keep this session private.', so no search runs.
- SKILL.md 454: Every task skips the landscape search, and no grader sees search queries.
- SKILL.md 540: Rewritten copy stays in SKILL.md, but no grader checks that a No keeps the cold read off or that the design doc omits Cross-Model Perspective. second-opinion-accepted takes the Yes path.
- SKILL.md 552, 558, 559, 562, 628, 648, 653: second-opinion-accepted reaches this step, but its must checks only the header and its check only the absence of a design doc; nothing grades this behavior. The other tasks decline the second opinion.
- SKILL.md 568, 609: Codex path; the images hold no Codex CLI, so it is never reached.
- SKILL.md 634: PREREG.md: the images hold no Codex CLI, so the Codex presentation is never reached.
- SKILL.md 723: The images hold the design binary, so the probe should print DESIGN_READY and this fallback branch should not run (if it printed DESIGN_NOT_AVAILABLE, visual-sketch-accepted's check would grade it).
- SKILL.md 753: visual-sketch-accepted reaches Step 2, but no grader checks how the brief and feedback files are written.
- SKILL.md 767: visual-sketch-accepted should hit this rule (Step 3 saves nothing without an OpenAI key), but no grader checks the failure report or the stop before the board.
- SKILL.md 775, 782, 789, 805, 807, 809, 823: Needs saved mockups; generation cannot succeed without an OpenAI key in the images, so no task reaches this step.
- SKILL.md 834, 847, 865, 873, 881, 884, 886: visual-sketch-accepted may reach the sketch after the mockup step fails, but its check passes on the mockup folder alone and nothing grades this behavior; ui-visual-step has no check.
- SKILL.md 844, 855, 861: In these images the mockup step's Step 1 folder satisfies visual-sketch-accepted's check before any sketch exists, so the check does not observe this sketch step, and the judge asks for a sketch only when the designer is unavailable. ui-visual-step has no check. If the probe printed DESIGN_NOT_AVAILABLE, the check would grade this step.
- SKILL.md 888: No grader reads the design doc, and visual-sketch-accepted stops before it, so a wireframe reference is not observed.
- SKILL.md 889: No grader reads the design doc, and visual-sketch-accepted stops before it, so a screenshot path is not observed.
- SKILL.md 894, 917, 919, 925, 928, 930, 971, 973, 976, 978, 979: Offered only after a wireframe is approved; ui-visual-step skips the visuals and visual-sketch-accepted's check does not need a wireframe, so nothing grades it.

Unchanged section lines with no covering task: design-and-handoff.md 120, phase-2a-startup-diagnostic.md 24, phase-2b-builder-brainstorm.md 4, preamble.md 57 (205 with the judge, 211 without). Their ids and reasons are in `coverage.json`.

## What the gaps mean

The second-opinion block now runs in one task, but only its header is graded. A cold read that dropped its filesystem boundary, skipped the synthesis or ignored the premise check would still pass.

The visual-design block now runs in one task, but its check confirms only that the mockup step started. The sketch, its render, the "Does this feel right?" approval, the outside design voices and the reference in the design doc stay ungraded.

The two rewritten search rules cannot fail here, because every task skips search at the privacy gate.

Two before/after differences could show up for reasons other than the cut. In before, the mockup block had no UI guard; only the sketch block said to skip backend ideas. After puts the guard in SKILL.md. Since the images hold the design binary, backend-skips-visual may fail in the before arm when the run starts the mockup step for the CLI approach, which the diet fixed. Before also ran the Codex preflight ahead of the second-opinion question, and with no Codex CLI that shared text reports "do not ask", next to "Use AskUserQuestion (regardless of codex availability)". After asks first. If second-opinion-offer or second-opinion-accepted differ between arms, check this before crediting the cut.

## Files read

From garrytan/gstack PR #3550 at `09fc5124d9b5c3e2e23144e520c230d7f1478aad`:

- `test/fixtures/skill-evals/office-hours/tasks.json` (11 tasks): sha256 `472af4f02f08a658a5572f3ed993fe8aa600d1610642db2a48fba91e691ed656`
- `test/fixtures/skill-evals/office-hours/tasks.ext.json`: sha256 `20d3a53727befd809824e2ce28a9af1114e6cdde3f0f2e5346d2142f4fb2f125`

Added by GSTA-13 in this repo:

- `quick/lanea-quick/tasks/office-hours.extra.json` (2 tasks): sha256 `229c9a11fcbc8b6e3e751caaf810c229992a1f79503b4949e6cd716b7d26f888`
- `quick/lanea-quick/tasks/office-hours.extra.ext.json`: sha256 `4f09afcdcd3767f09922499dcae31248c2578afa8c3b4395899e8898da663615`

Harness description: `quick/lanea-quick/PREREG.md` as read for this map, sha256 `26b1ac95ba3ce6d5f006fecb16abc5f29d04b2f20ba7087ac09a3015290afcc8`, plus `src/grade.ts`, `src/session.ts` and `src/usersim.ts`. Skill file digests for both commits are in `lines.json` under `meta.files`.
