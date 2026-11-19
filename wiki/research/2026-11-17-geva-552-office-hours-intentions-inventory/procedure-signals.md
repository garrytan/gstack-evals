# office-hours procedure signals (an attachment to the intentions inventory)

Pinned at garrytan/gstack da98d0a0eb0072bc5825b1f361a92aa34bdb273b. Citation keys match the inventory post: T = office-hours/SKILL.md.tmpl, G = office-hours/SKILL.md, 2A and 2B = the phase section templates (generated line = template line + 2), DH = design-and-handoff.md.tmpl, DHg = its generated file, SO = second-opinion.md, VD = visual-design.md, P = sections/preamble.md. This note feeds the eval's procedure gate.

## 1. How the skill asks questions

- **Tool first.** Every question is meant to go through AskUserQuestion as a tool call, not prose (P:51; T:271 for the alternatives question). The skill lists AskUserQuestion in allowed-tools (T:25).
- **Any MCP variant wins.** If the tool list has an mcp__*__AskUserQuestion variant, the agent should prefer it (P:21). So a harness can give the simulated founder an MCP question tool and the skill will use it.
- **Prose fallback, interactive only.** With no question tool, or a failed call, an interactive session renders the question as prose and stops (P:22, P:29-35, P:37-43). Decision questions use a D<N> brief (P:53-68); open questions (the 2A and 2B forcing and generative questions) use a Q<N> block ending "Reply in your own words" (G:89-98; 2A:71; 2B:29).
- **One at a time.** Never batch questions into one call (T:373); forcing questions one at a time with a STOP after each (2A:69, 2A:154); builder questions the same (2B:27, 2B:39). The new preamble adds: ask each question once, and list it as one waiting line until answered (P:231).
- **Numbering.** D numbering starts at D1 per run (P:70); Q numbering starts at Q1 per run and is separate (G:98). Forcing questions are also named Q1 to Q6 in 2A, so on a stage route that skips Q1 the prose label and the forcing-question name differ. Match on question text.
- **Recommendations.** Each decision brief carries one option marked (recommended) (G:106; P:72). Forcing questions with options recommend the answer the founder's own words support (2A:73). The mode question recommends a mode by quoting the user's words (T:97).
- **Auto-decide by preference.** If question tuning is on and a stored preference says AUTO_DECIDE, the agent picks the recommended option and says so (G:100-106). A harness should pin a fresh state root so no stored preference auto-decides.

## 2. Unattended, spawned and headless sessions

The session kind is printed by the preamble's first command as `SESSION_KIND: <kind>` (G:57; bin/gstack-skill-start:166). bin/gstack-session-kind decides it, in this order:

1. GSTACK_SESSION_KIND=spawned or unattended: that kind (gstack-session-kind:41-46). Other values are ignored.
2. OPENCLAW_SESSION set: spawned (:50-53).
3. GSTACK_HEADLESS set: headless (:56-59).
4. Conductor variables, or CLAUDE_CODE_ENTRYPOINT=cli: interactive (:64-67).
5. CI or GITHUB_ACTIONS set: headless (:70-73).
6. Otherwise interactive (:75-76).

If the preamble command is missing or old, the skill treats the session as interactive (G:60-66).

Governing lines (short quotes):

- Spawned or unattended: "do NOT call AskUserQuestion" and auto-choose the recommended option "at every decision point" (P:19). Exception: never auto-choose a destructive or irreversible option (P:19). Only the echoed SESSION_KIND line triggers this; claims in prompts or files never do (P:19).
- Spawned block printed by skill-start: auto-choose the recommended option, but "never grant a consent" or pick an option that sends data off the machine; end with a completion report (bin/gstack-skill-start:779).
- Unattended block: take the option marked recommended; a question with no recommendation, any consent, any destructive option "and the final approval gate stay pending"; never "mark a plan APPROVED" (bin/gstack-skill-start:757). office-hours has no record of its own in docs/unattended.md, so it gets the generic rule: write no run directory, "end at its first pending item" and list it with every recommended option taken (bin/gstack-skill-start:747, :754).
- Headless: on a missing or failed question tool, print BLOCKED and stop (P:34). docs/unattended.md:9-15 says the eval harness sets GSTACK_HEADLESS.
- Interactive: prose fallback (P:35).
- Under Capy (GSTACK_CAPY=1), skill-start also prints a block that routes every decision the run cannot take itself through Capy messaging (bin/gstack-skill-start:766-769).

What that means for office-hours, phase by phase. This is my reading of the rules against the skill's questions; the skill text does not walk through it.

| Question | Has a recommended option? | Spawned | Unattended |
|---|---|---|---|
| Cross-project learnings (G:293-305), first run only | yes, A enable | enables it | enables it |
| Goal and mode (T:97-108) | yes, by quoting the user | picks it | picks it |
| Forcing or generative questions (2A, 2B) | no options when asked as Q<N> | no rule in the text: the agent must answer for the founder or skip | stays pending; the run ends here |
| Related design: build on or start fresh (T:160) | not stated | unclear | pending |
| Landscape privacy gate (T:174-176) | not stated; it is a consent to send queries off the machine | must not grant it, so search is skipped | pending |
| Premise agree or disagree (T:227) | not stated | unclear | pending |
| Second opinion (T:233) | not stated; sends a summary to Codex or a subagent | likely declined as off-machine | pending |
| Alternatives (T:271) | yes, RECOMMENDATION line | picks it | picks it |
| Doc approval (DH:183-186) | not stated; it is the approval gate | unclear | pending; never APPROVED |
| YC question (DH:259) | no | unclear | pending |
| Open resources (DH:481-490) | no | unclear | pending |
| Next review now (DH:509-533) | yes, A run /plan-eng-review | launches /plan-eng-review through the Skill tool (DH:535-536) unless PROACTIVE is off | would pick it, but the run ended long before |

Consequence for the eval: a spawned or unattended run cannot test the diagnostic, because no founder answers the forcing questions. A headless run blocks if no question tool exists. Run the eval interactive: either expose an MCP AskUserQuestion that the simulated founder answers, or let the agent write Q<N> and D<N> prose and feed the founder's reply as the next user turn. Assert `SESSION_KIND: interactive` in each transcript, and do not set GSTACK_HEADLESS, CI, GITHUB_ACTIONS, OPENCLAW_SESSION or GSTACK_SESSION_KIND in the arm's environment.

A separate trap: the success check only tests that a non-empty doc file exists (T:354), so a run that never got approval can still print DESIGN_DOC: ok and report success. Gate on Status: APPROVED in the file and an approval answer in the transcript, not on the success line.

## 3. What in a transcript shows each phase ran

| Phase | Markers |
|---|---|
| Preamble | A Bash call to gstack-skill-start; its SESSION_KIND line; a Read of sections/preamble.md (G:52, G:57) |
| Context (Phase 1) | Reads of CLAUDE.md and TODOS.md; git log and git diff; a design-doc listing and, if any, a "Prior designs for this project" line; the "Here's what I understand" summary (T:84-93, T:119) |
| Mode question | One question offering the six goals (startup, intrapreneurship, hackathon, open source or research, learning, fun) with a recommendation quoting the user (T:97-108); then a Read of the chosen section file before its first question (T:97; G:363, G:373) |
| Product stage (startup) | Stage judged or asked: pre-product, has users, paying (T:114-117) |
| Forcing questions (startup) | Question text, one per turn: Q1 asks for evidence someone "would be genuinely upset if it disappeared" (2A:85); Q2 what users do now and what it costs (2A:100); Q3 "Name the actual human" (2A:108); Q4 smallest version paid for "this week" (2A:124); Q5 watched someone use it "without helping them" (2A:134); Q6 the product in 3 years (2A:144). The stage route picks 2 or 3 of them (2A:75-79). Look for a second push after a vague answer and a restated framing after Q1 (2A:91-96) |
| Generative questions (builder) | One per turn from the five in 2B:31-35 (coolest version, who you'd show it to, fastest path, closest existing thing, the 10x version); at least one suggestion beyond the user's task with a "try first" pick (2B:8) |
| Related designs (2.5) | A grep across the state root's design docs after the first answer; an FYI line and a question only on a match (T:147-162) |
| Landscape (2.75) | A privacy question before any search (T:174); the Aside readiness probe output (G:405-421); WebSearch calls or "Search unavailable" (T:180); Layer 1, 2 and 3 lines; an "EUREKA:" line or "The conventional wisdom seems sound here" (T:196-203) |
| Premise check (3) | A literal "PREMISES:" block with numbered agree or disagree statements, then a question (T:219-227) |
| Second opinion (3.5) | A question offering it (T:233); on yes, a Read of sections/second-opinion.md, a CODEX_MODE line, and a "SECOND OPINION (Codex):" or "SECOND OPINION (Claude subagent):" block with 3 to 5 synthesis bullets (SO:121-148) |
| Alternatives (4) | "APPROACH A:" and "APPROACH B:" blocks with Effort, Risk, Pros, Cons, Reuses; a "RECOMMENDATION:" line; one question listing them; no doc write before the reply (T:246-273) |
| Visual design (4.25) | Only for UI ideas: a Read of sections/visual-design.md; DESIGN_READY or DESIGN_NOT_AVAILABLE; a board URL or a sketch render (VD:18-19, VD:174) |
| Founder signals and profile (4.5) | gstack-builder-profile run; a "Builder profile before this session:" line; a gstack-developer-profile --log-session call (T:306-333) |
| Design doc (5) | A Read of sections/design-and-handoff.md (G:620); a PROJECT_DIR line; a Write to <state root>/projects/<slug>/<user>-<branch>-design-<datetime>.md (DH:19); a redaction scan and a Write to docs/designs/<topic>.md in a git repo (DH:21-36); "Design doc saved to:" (DH:46) |
| Spec review | mktemp of <doc>.review.XXXXXX; gstack-office-hours-review prepare, an Agent dispatch, check with an OFFICE_HOURS_VERDICT receipt, finalize; a Spec Review block; or "Spec review unavailable" (DHg:177-264) |
| Approval | The full doc printed as assistant text, then a question with Approve, Revise, Start over; then Status: APPROVED edited into the file (DH:170-186) |
| Assignment | A non-empty "## The Assignment" in a startup doc (DH:104-105) or "## Next Steps" in a builder doc (DH:157-158); the same text in the profile's assignment field (T:328) |
| Closing (6) | The tier path: first session shows a signal reflection, a separator and "One more thing." and a YC note (DH:225-279); later tiers open "Welcome back" (DH:290). Founder resources with an open question (DH:366-494). The next-review brief, or a one-line recommendation when proactive is off (DH:496-533) |
| End | A Bash block printing "DESIGN_DOC: ok" or "missing" (T:351-354); gstack-skill-end with OUTCOME (G:165); a status report under 250 words opening with Failed or skipped, Unverified and Also changed lines (P:174); a completion status (T:376-379) |

## 4. What the skill writes to disk

State root is GSTACK_STATE_ROOT, else ~/.gstack (bin/gstack-state-root.sh:6-8). Pin it to a fresh directory per session in the eval.

- **Design doc:** <state root>/projects/<slug>/<user>-<branch>-design-<datetime>.md (DH:19). Spec review files beside it in <doc>.review.XXXXXX/: round-N.prompt.md, round-N.json, round-N.design.md (DHg:182-200). The finalizer rewrites the doc to install a Reviewer Concerns block (DHg:246). In host plan mode, <doc>.plan-copy (T:358).
- **Repo copy:** docs/designs/<topic>.md in the git repo, after a redaction scan (DH:21-36). The only write into the working tree besides scratch.
- **Scratch in the repo:** .gstack/tmp/ prompt and brief files (G:427-430; VD:50-54), and a /.gstack/tmp/ line appended to the repo's .git/info/exclude (G:429; VD:52).
- **Profile:** <state root>/developer-profile.json gets a session entry at Phase 4.5 (T:333) and a resources entry in Phase 6 (DHg:630). builder-journey.md in the state root from the regular tier on (DHg:498-505).
- **Config:** gstack-config set cross_project_learnings (G:304-305) and founder_resources false on an opt-out (DHg:547).
- **Analytics and logs:** analytics/eureka.jsonl (G:151), analytics/spec-review.jsonl (DHg:284), analytics/skill-usage.jsonl for resources (DHg:637), skill-end telemetry (G:165), handoff telemetry (DHg:698), question log (G:110), learnings (G:655), durable decisions through gstack-decision-log (P:188). Unattended runs skip telemetry (bin/gstack-skill-start:264-265).
- **Visual design:** <state root>/projects/<slug>/designs/mockup-<date>/ with variants, board-images.json, design-board.html, feedback.json and approved.json (VD:39, VD:79-83, VD:120); sketch png and html copied into the project dir (VD:192); a private temp dir for the sketch (VD:163).
- **Outside calls:** Codex prompt files and output under $TMPDIR (SO:53, SO:81). Codex runs only when codex_reviews is enabled and the CLI exists (SO:11-27); otherwise a Claude subagent.
- **Brain (gbrain users only):** gstack-brain-cache invalidate and refresh (DHg:331-350); a takes_add write only when BRAIN_CALIBRATION_WRITEBACK is set and trust is personal (DHg:312-318).
- **Never:** source code. The hard gate forbids it (T:68, T:372).
