---
id: 2026-11-21-geva-555-office-hours-rewrite-attempt-2-pre-run-change-6
kind: plan
title: "Pre-run change 6 to the second office-hours rewrite eval: the simulated person reads its own turns as JSON, and two of its rules are rewritten after a failed audit"
summary: "The simulator audit failed. The simulated person now reads its own turns as the JSON it returned, and two of its rules are rewritten. This is the last repair before INCOMPLETE."
author: GEVA-555
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-21
status: open
links:
  - wiki/plans/2026-11-18-geva-555-office-hours-rewrite-attempt-2-prereg/README.md
  - wiki/plans/2026-11-21-geva-555-office-hours-rewrite-attempt-2-pre-run-change-5/README.md
  - wiki/plans/2026-11-18-geva-553-office-hours-rewrite-pre-run-change-1/README.md
  - lanes/office-hours-rewrite/
attachments:
  - 2ca37509b665648d47d9757fe9cea38ef95985ada1e2263cfb74985f93157f0b  e2e.txt
  - 9bbeb9bd1ad89f85a09821ec8d50f768fe7df0f280a4fb31c1e3028e08b7f601  format-test-failing-first.txt
  - 904adf1d772987da01e5f2bede50c40b9e07a7772635e265dab5966595bee6c1  format-test.txt
  - 5d519101daef789c8d17420de27c97ecaf4deca3fd50620aa2df7549c9071694  sim-rules-builder.txt
  - 6d82c1e116bd6685d447214cf9cb0b547f7be29f6bdacb048280b622a6fb42dd  sim-rules-founder.txt
---

# Pre-run change 6 to the second office-hours rewrite eval

## In short

- The simulator audit read FAIL: 35 of 80 sampled turns failed, against a bar of at most 4 (5%). Stage 1 has not started and no arm session has run, so no arm data exists.
- Two separate problems caused it. In 19 of the failed turns the simulated person never gave a usable reply: from its third turn on it answered in plain prose instead of the JSON object its rules ask for, on all three tries. In the other 16, both auditors marked a fault in a delivered reply, mostly a volunteered fact (V1) or a revealed list that did not match the reply (V4).
- The format fix is in the lane's code. The simulated person now reads its own earlier turns as the JSON objects it returned (reply, revealed, rules, done), not as bare reply text. The adviser still sees only the reply.
- The fidelity fix rewrites two rules in the simulator's rules text: rule 3 (reveal only what the last message asks) and the line on what goes in revealed (list exactly the facts the reply states). Every other line is unchanged.
- The simulator audit's ledger item gets a higher cap, enough for one more audit. The new cap and the owner's words are in the approvals record and the ledger.
- This is the last repair. If the next audit fails, the eval stops INCOMPLETE, and the results name the simulated person as the blocker.

## 1. What the audit found

The audit runs a fixed six-message script over every fact sheet, then GPT-6.2 Astra and Opus 5.5 read a seeded sample of 80 of the simulated person's turns (preregistration section 12). A turn fails when both auditors mark it, or when the simulator delivered no reply.

| | Count |
|---|---|
| Fact sheets | 94 (66 founder, 28 builder) |
| Script turns | 444: 364 delivered, 80 failed the JSON check on all three tries |
| Sampled turns | 80: 38 clean, 7 disputed (one auditor), 35 failed |
| Failed with no reply (JSON check) | 19 |
| Failed, marked by both auditors | 16 |

The audit had run once before this. The runner machine's operating system deleted that run's output from memory-backed storage when the run's login session ended, before anyone read it: systemd-logind removes a user's shared-memory files when the user's last session ends. It was restarted, unread, as a second lease on the same ledger item. Runs since then keep the user's session alive and seal each run's output to disk as the run exits.

**Format.** Every one of the 80 failed script turns failed the JSON check on its third try. No try failed the ids, word-limit or done checks, and the reveal guard fired on 7 tries. Of the 410 tries that failed the JSON check, 376 were plain prose with no JSON object at all, and 31 were prose followed by a JSON object repeating it. How often the first try at a turn failed the JSON check:

| Script turn | 1 | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|
| First try failed the JSON check | 0 of 94 | 1 of 94 | 84 of 94 | 87 of 88 | 60 of 60 | 4 of 14 |
| Turn failed all three tries | 0 | 0 | 6 | 28 | 46 | 0 |

The cause is the chat history the simulated person reads. It is built from the visible transcript, so the person's own earlier turns appear in it as plain prose. Once two such turns are in the history, Gemini 4 Argon at temperature 0 follows them instead of the rule that asks for one JSON object and nothing else. A replay of the audit from its sealed reply cache, through the lane's own simulator turn and with no model calls, reproduced all 444 script turns; the counts above come from it.

**Fidelity.** The 16 turns both auditors marked are delivered replies in valid JSON. The codes are the founder lane's (lanes/office-hours-founder/sim/fidelity.ts): V1 volunteered a hidden fact the last message did not ask about, V2 invented a material fact, V4 logged ids that differ from the facts the reply states, V6 broke frame.

- Codes both auditors gave the same turn: V1 in 12, V4 in 7.
- Codes either auditor gave: V1 14, V4 9, V2 2, V6 1, and one unreadable read.
- By script turn: 4 at turn 2 ("Tell me more about where things stand right now"), 8 at turn 3 ("Has anyone used it or paid for it yet?"), 4 at turn 4.
- By kind: 11 founder, 5 builder. By origin: 5 of the 21 sampled turns from briefs carried over from the first attempt, 11 of the 59 from new briefs.

These 16 alone are four times the bar, so the format fix by itself cannot pass the audit.

## 2. The format fix

- `sim/founder.ts`: the simulator's messages keep the adviser's lines as written and give each of the person's own turns as the JSON object it returned. A person turn that arrives without its JSON is refused before any model call (E_USAGE).
- `sim/audit.ts`: the audit script keeps each delivered turn's JSON for the turns after it.
- `run/session.ts`: the stage session loop keeps each delivered turn's JSON on the transcript line the simulator reads. What the adviser receives is unchanged.
- persona-sim and the founder lane's code are unchanged.

The test came first. `tests/ohr/sim/history.test.ts` uses a stand-in model that answers in prose whenever its own past turns read as prose, as Argon did. At 98d4c3d4, the head the audit ran on, all four tests fail (format-test-failing-first.txt): the turn-3 history goes out as prose and the turn ends check-failed, a person turn without JSON is not refused, the audit script stops at turn 3, and the session loop drops the JSON. With the fix all four pass (format-test.txt).

## 3. The two rewritten rules

Both rules files, founder and builder, get the same two edits and nothing else. The new files are attached, and `frozen.SIM_RULES_SHA256` and `frozen.SIM_RULES_MOVE` point at them.

Rule 3, before:

> 3. Each fact on the sheet stays hidden until the advisor asks for it. Reveal a fact only when the advisor's last message asks something its reveal_when line covers. When a question is broad, reveal at most two facts, the ones it covers most directly; no reply ever states more than two hidden facts. Never volunteer a fact the last message did not ask about, even when it seems helpful, and never add a fact to a choice, an agreement or a closing remark.

Rule 3, after:

> 3. Each fact on the sheet stays hidden until the advisor's last message asks for it. Reveal a fact only when that message asks the thing its reveal_when line names; a fact that is related, helpful or likely to come up later stays hidden. A broad or open question reveals only the facts whose reveal_when line names that kind of question, at most two, and otherwise you answer it from your opening message. When you are unsure whether the message asks for a fact, keep it hidden. No reply ever states more than two hidden facts, and never add a fact to a choice, an agreement or a closing remark.

Why: most V1 marks fell on the script's broad questions at turns 2 and 3. The old wording let a broad question reveal up to two facts "it covers most directly", which reads as permission to pick facts near the question. The new wording ties every reveal to what the reveal_when line names, and says to keep a fact hidden when unsure.

The revealed line, before:

> List in revealed every hidden fact your reply states or clearly implies, and no other.

The revealed line, after:

> In revealed, list the id of each fact on the sheet that your reply states or clearly implies, in full or in part and in any words, including a fact you revealed in an earlier reply, and list no other id; check every sentence of your reply against the sheet before you answer.

Why: V4 marks a revealed list that differs from the facts the reply states. The old line left open whether a fact restated from an earlier turn, or stated in other words, belongs in the list. The new line says it does, and asks for a sentence-by-sentence check.

## 4. What stays as frozen

Everything else in the plan: the audit's script, its sample of 80, the seed, both auditors at maximum effort, the 5% bar and the NO READ floor; the reveal guard and three tries a turn; every other line of the rules text; the stages, admission A1 to A7 and its one repair, the judge check, the decision table, and the caps of every other ledger item. No arm session has run.

## 5. The last repair

This is the only repair of the simulated person. The next audit runs once, as the third and last lease on the audit's ledger item. If it fails, the eval stops INCOMPLETE, and the results name the simulated person as the blocker. A cap stop on that lease also reads INCOMPLETE.

## 6. Checks

- `bun test tests/ohr`: 691 tests across 44 files: 680 pass, 11 skip, none fail.
- `bun run typecheck`, `bun run errors:check` and `bun run wiki:check` pass.
- The keyless end to end ran on 2026-11-21 with this change's code, on both hosts and both pins: 86 checks passed and none failed (e2e.txt). It drives the stage session loop and the simulator turn with a stand-in model, so the new history shape runs end to end.

## Attachments

- sim-rules-founder.txt and sim-rules-builder.txt: the simulator's rules text with the two rewritten rules (section 3).
- format-test-failing-first.txt: the format test at 98d4c3d4, before the fix, all four failing, with the repository path left off file names.
- format-test.txt: the same test with the fix, all four passing.
- e2e.txt: the keyless end to end in section 6, as it printed, with the home directory written as ~.
