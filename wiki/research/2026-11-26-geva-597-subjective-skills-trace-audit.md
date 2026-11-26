---
id: 2026-11-26-geva-597-subjective-skills-trace-audit
kind: research
title: "Do gstack's subjective skills run and change the work? A keyless trace audit of office-hours sessions we already held, with coverage for plan-ceo-review and plan-design-review"
summary: "On GPT-6.1 Sol, typed /office-hours waited for 7 or 8 founder answers in 6 of 6 sessions (plain 5 of 12); Opus 5.5 opened the skill in 2 of 6. No quality verdict without blind human picks."
author: GEVA-597
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-26
status: done
links:
  - 2026-11-14-geva-526-office-hours-founder-stage-1-results
  - 2026-11-09-geva-418-office-hours-founder-evidence-prereg
  - 2026-11-17-geva-552-office-hours-intentions-inventory
  - 2026-11-16-geva-544-skill-room-exposure-census
  - 2026-11-09-geva-412-plan-mode-intentions
  - 2026-11-02-geva-142-ceo-panel-v2-admission-results
  - 2026-11-10-geva-513-product-value-stage-1-results
  - 2026-11-08-geva-402-ceo-stage-2-results
  - 2026-11-17-geva-549-day-one-usefulness-results
  - 2026-11-21-geva-555-office-hours-rewrite-attempt-2-results
  - 2026-11-25-capy-unchecked-judge-corrections
---

# Do gstack's subjective skills run and change the work?

- **We learned that the same typed command can run a subjective skill on one frontier model and not on another.** Typed /office-hours made GPT-6.1 Sol ask and then wait for the founder's answers before advising in 6 of 6 sessions, against 5 of 12 plain Sol sessions on the same six founders. Opus 5.5 opened an office-hours file in only 2 of 6 sessions and gave its advice in the first reply, before any answer, in 4 of 6. You should read "opened", "ran the procedure" and "waited for the user" per model before reading any outcome of an interactive skill.
- **We learned what the skill changed in the work on Sol, as far as code can see it.** Sol with the skill drew out the founder's hidden demand facts in 5 of 5 scored sessions, against 0 of 12 plain, and wrote its recommendation only after 7 or 8 founder answers. Whether the resulting advice is better is a taste question: the only score we hold for it uses a model-written key and model judges no person has checked, so this post makes no better-or-worse claim. A five-pair blind check by the project owner is staged privately.
- **For plan-ceo-review the typed command never ran the procedure in two protocols, a forced line did, and the forced arm showed no gain on 84 real plans. For plan-design-review we hold no session where the skill ran against a matched plain arm.** No cut follows for any of the three skills: most of their main intentions have no score.

## Status

| Field | Value |
|---|---|
| Grade | Exploratory. Keyless: no new session, model call, grader or machine beyond the analysis host. Every number is a count over sessions already held, or cited from a merged post. |
| Question | Do subjective gstack skills trigger, change what the agent does, and change it in the intended direction? First /office-hours, then coverage for /plan-ceo-review and /plan-design-review. |
| Data | GEVA-526's stage 1 office-hours sessions (sealed; opened in custody, counts only published). Transcripts, founder sheets and keys stay private. |
| Pins | Sessions at gstack b6155921 (v1.98.0.0). The office-hours intentions inventory reads da98d0a0 (v1.100.0.0); only 27 lines of office-hours/ differ between the two (preamble and design handoff). gstack main has since merged an office-hours rewrite, so nothing here describes the current skill. |
| Reviewed by | The review of this post, recorded in its pull request |
| Reproduced by | Not yet. |

## office-hours: trace to artifact

**Intentions, before outputs.** The inventory holds nine main intentions for a startup session: demand over interest (S1), name the actual human (S2), narrowest wedge (S3), move the decision onto the evidence (S4), no code (X1), premises challenged and agreed (X2), two or three approaches and a stop until the user picks (X3), an approved design doc (X4) and one real-world action (X5). We mapped them to what a trace can show before choosing any output:

| Intention | Seen in a trace as | Counter-behaviour |
|---|---|---|
| S1, S2 | Questions about who pays or would be upset, then demand facts drawn out | Advice in the first reply; questions the agent answers itself |
| S3, S4 | The final first move moves toward what the answers support | The final move restates the pitch |
| X2, X3 | Premises, approaches, a stop for the user's pick | The pick taken on the user's behalf |
| X4, X5 | A reviewed design doc and an assignment | A heading or checklist with no change in the advice |

A heading, a checklist or a design doc in the transcript is procedure evidence, not evidence that the work improved.

**Setup.** Six invented founders played by a simulated founder (Gemini 4 Argon) from a hidden fact sheet; Claude Code for every arm, with web search and the question tool denied, at most 20 founder replies and the same closing template asking for a first-move block. Arms: plain (no gstack, no drive), office-hours ("/office-hours" typed as the first line, gstack installed) and, on Opus only, a one-sentence lens. Sol reached Claude Code through OpenRouter, not Codex CLI. No session hit its allowance or an arm stop. Route: explicit invocation only. No session had gstack installed with a neutral request, so automatic discovery is untested here, and office-hours has no hook.

**Counts on the same six founders.** Plain ran 3 passes on Opus and 2 on Sol and particle-1. "Scored" leaves out sessions lost when the simulator failed its JSON check twice.

| | Opus office-hours | Opus plain | Opus lens | Sol office-hours | Sol plain | particle-1 office-hours | particle-1 plain |
|---|---|---|---|---|---|---|---|
| Sessions | 6 | 18 | 2 | 6 | 12 | 6 | 12 |
| Lost to the simulator | 1 | 0 | 0 | 1 | 0 | 3 | 0 |
| Opened an office-hours file | 2 | n/a | n/a | 6 | n/a | 6 | n/a |
| Procedure ran (GEVA-526's read, fixed after its smoke) | 1 | n/a | n/a | 6 | n/a | 0 | n/a |
| Frozen exposure detector | 0 | n/a | n/a | 0 | n/a | 0 | n/a |
| At least one founder turn before advice | 2 | 0 | 2 | 6 | 5 | 4 | 0 |
| Demand facts drawn out, scored sessions | 0 of 5 | 0 of 18 | 0 of 2 | 5 of 5 | 0 of 12 | 1 of 3 | 0 of 12 |
| First move matches the key's customer or wedge (W), scored | 1 of 5 | 0 of 18 | 1 of 2 | 5 of 5 | 6 of 12 | 1 of 3 | 0 of 12 |
| W with a lost session counted as a miss | 1 of 6 | 0 of 18 | 1 of 2 | 5 of 6 | 6 of 12 | 1 of 6 | 0 of 12 |

Base rates on all 16 calibration founders (GEVA-526): plain W was Opus 1 of 48, Sol 8 of 32 and particle-1 1 of 32, and with every fact given up front 47 of 48, 32 of 32 and 30 of 32. Plain Opus and particle-1 never gave the founder a turn (0 of 48, 0 of 32); plain Sol did in 9 of 32.

**The trace, graded apart from the artifact.** The trace is read by code. Every scored Sol office-hours session opened with questions and no recommendation (170 to 230 words), drew its first key fact at founder turn 1 to 3, printed three or four numbered decision briefs, dispatched one or two subagents, wrote one file, and gave its first-move block in reply 8 or 9 at about 3,600 to 4,600 words of agent text. Plain Sol answered at once in 7 of 12 sessions and asked once in 5, at about 1,000 words. Opus with the skill answered at once in 4 of 6, with no office-hours file opened. The artifact is the first-move block. Its W score is a known-answer match against a key that Sol and Argon wrote, judged by GPT-6 Astra, Opus 5.5 or a panel whose check used model-made gold only; the unchecked-judge correction labels this score Q, so every W count here reads as one model's opinion, unchecked.

**Did the founder's answer change what was chosen?** The design shows co-occurrence, not cause. On one founder, plain Sol answered at once in both passes and missed; Sol with the skill drew all six key facts and matched. On two founders, plain Sol asked one question and matched in all four passes. Across all calibration founders, plain Sol matched in 7 of 9 sessions where the founder answered first and in 1 of 23 where nobody answered. Sol chose when to wait in the plain arm, so none of this shows that waiting carries the skill's effect.

**Where the instruments failed (from GEVA-526, reused).** The simulated founder volunteered unasked facts: both auditors marked 7 of 33 audited turns (bar: at most 1), so facts drawn out are inflated wherever the founder spoke. The frozen exposure detector expected capitalised markers and missed Sol's prose-fallback format. The run's repair sentence, "taking your recommended option at every decision", stopped the skill giving the founder any turn on the re-smoke (0 turns in 12 Opus and Sol sessions); that was our harness. The second rewrite eval's simulator then failed its audit three times.

## Coverage for plan-ceo-review and plan-design-review

**Three plan-ceo-review exposure figures come from different protocols and do not conflict.**

| Source | Line given | gstack | Tasks | Detector | Opus 5.5 |
|---|---|---|---|---|---|
| CEO panel v2 (GEVA-142) | the plain invocation | the v2 pin | 8 seeded plans x 2 passes | read the sections file and ran the procedure | 0 of 16; the forced line naming the skill's steps: 16 of 16 |
| Product-value stage 1 (GEVA-513) | the told line; then with a standing-preference sentence; then with the opt-in gate | the stage pin | three six-session smokes | mode handoff, an expansion proposal and review Sections 9 and 10 | 0 of 18 (1 of 18 read the sections by tool audit) |
| CEO outcome stage 2 (GEVA-402) | CEO v2's forced line (standalone), and the forced line with the gate hook (enforced) | 699a41cb and 4743132c | 84 real plans, changed units | its own detector built from 699a41cb | 0.825 standalone, 0.857 enforced (Sol 1.000 and 1.000; particle-1 0.964 and 0.976) |

The 84-plan exposure measures a forced line, not what a user types; the 0 of 16 and 0 of 18 measure a typed or told line. Stage 2's outcome was no gain for the forced arms (Opus enforced +0.0 points, 95% CI -6.0 to +6.0) on a key written by models from what maintainers really decided.

| | plan-ceo-review | plan-design-review |
|---|---|---|
| Main intentions (GEVA-412) | 6: 3 partly scored, 3 untested (scope mode, user decides, honest about failure) | 8: 1 partly (planned only), 7 untested |
| Neutral request | No skill-specific reading | No reading |
| Typed or told | 0 of 16; 0 of 18 (above) | Never run |
| Forced | 16 of 16; stage 2 exposure above | Only as a phase of /autoplan --full in the day-one eval, design-phase exposure not reported |
| Plain base rate | Seeded flaws 12 of 12; real plans, deciding issue in top three 0.341 / 0.155 / 0.226 | Planted design flaws 10 of 10, 12 of 12, 12 of 12 |
| Paired artifacts held | Stage 2, sealed | None standalone |
| Later-user evidence | By design: the key is what maintainers decided | One owner's first use of an app built from an /autoplan-reviewed plan (case study) |
| Blind human picks | None | None |

The missing ingredient for plan-design-review is one session per pair where the skill ran standalone on a plan, against a plain review of the same plan on the same model and harness.

## Why null?

There is no null to explain: no comparison was run. For office-hours the skill's procedure ran on Sol and mostly did not on Opus, the tasks fit (plain models leave room), and five Sol pairs are far too few for any population claim. For plan-ceo-review the forced arm's null stands as published; three main intentions are untested. Verdicts: none new. No CUT-CANDIDATE: the untested main intentions forbid one.

## Limits

- Five Sol pairs and six founders; v1.98, not the current rewrite; Sol in Claude Code, not Codex CLI; a simulated founder that failed its audit.
- W rests on model-written keys and model judges; no person checked them, and it carries the Q label (one model's opinion, unchecked).
- The per-founder lines above are counts on tiny cells and are reported for transparency, not as estimates.

## Replication

The sessions are sealed. The trace was read by two small scripts over the session records (counting founder turns, revealed key-fact ids, office-hours file reads, numbered briefs, subagent and write calls, and a bag-of-words overlap with the key's customer). They print counts only and stay with the sealed record, because they need the private units to run.

## Changelog

- 2026-11-26: first version.
