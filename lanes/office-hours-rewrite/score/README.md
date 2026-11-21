# Office-hours rewrite eval: block parser, packets, judges, judge check, detectors and scorer

This folder turns finished sessions into scores for the office-hours rewrite eval. It implements the preregistration's
section 5 (the block, the packets, the judges and R1 to R3), section 7's kept-whole definition and startup-only list,
section 8's failure table, section 10's guardrail counters, section 11's compliance checks and section 12's exposure
and judge check, as pre-run change 1 changes them (delivered replies only, item 4f's two descriptive checks). It makes
no model call of its own: every judge call goes through an injected `Caller`, the product-value eval's metered judge
client (`lanes/product-value/judge.ts` `openJudge`), the path the founder lane's `score/judge.ts` uses.

## Modules

- `block.ts` is the block parser (`BlockParser` in types.ts) and `renderBlock`, the three lines a judge reads.
- `packets.ts` builds label packets (one per stage, brief and model), the judge check's packets, the map from random
  ids back to sessions and anchors, and `assertUnique` over every map. `writePackets` refuses a map inside the packets
  folder and any path inside the repository.
- `judge.ts` holds the frozen prompt (`prompts/judge.md`, pinned by sha256), routing, the one resend, `judgePackets`
  and `labeller()` (`Labeller` in types.ts).
- `check.ts` is section 12's judge check: gold cells, the anchor cap, both kappas, near-miss accuracy and the stock check.
- `detect.ts` holds the detectors: exposure, startup-only questions (G1), kept whole, questions asked (G2), delivered
  founder replies (G3) and compliance. Each takes its marker set as data.
- `markers/current.json` and `markers/new.json` are candidate markers per pin; `markers/compliance.json` is shared.
- `score.ts` joins session rows, label maps and the routed judge's labels into scored rows, and counts stock credits.
- `seams.ts` exports this area's dry-run seams; `fixtures.ts` holds the invented briefs, rows, transcripts, state roots,
  planted check maps and the stub judge the seams and tests use.

A run uses them in this order: the session loop calls `parseBlock`; stage 1 builds `buildLabelPackets` (stage 1) and
`buildCheckPackets` with the label map as taken; Astra and Opus label the check map at max (gold) and at medium (their
check labels); `judgeCheck` reads each judge; stage 2 builds `buildLabelPackets` with every earlier map as taken;
`scoreSessions` feeds the readings.

## Markers

The marker strings in `markers/` are candidates, read from both pins' office-hours text in their prose-question forms:
the current pin at 858679423cc4778f9961d4aaf3c061a9368985ec (the second attempt's pre-run change 5, which leaves every
current marker matching) and the new pin at 0787a1e01f2d847f8e915a680e7f6afec777be88, read before the content change's
final head; pre-run change 5 names the new-pin markers that do not match that head. Each file records the sha256 of the
office-hours files it was read from. They pass the planted fixtures in tests/ohr/score/detect.test.ts. Stage 1
transcripts freeze the final sets (section 12 stage 4), before they read stage 2. The definitions in detect.ts do not
move.

## Reused and copied

Reused by import: `lanes/product-value/stats.ts` (seeded random, ids, shuffle, Cohen's kappa),
`lanes/product-value/judge.ts` (the `Caller` type, `lastJson`, the resend note, the call log),
`lanes/office-hours-founder/parse.ts` `replies`, `lanes/office-hours-founder/score/counters.ts` `sentences` and
`isQuestion`, and `src/trial/review/readers.ts` `readTranscript`.

Copied and adapted, because the shapes differ: `parseCells` and the one-resend loop from the founder lane's
`score/judge.ts` (two cells instead of six, no panel); the state-root walk from its `score/exposure.ts` `designDoc`;
the six forcing-question patterns from its `FORCING`, now in `markers/*.json`; the judge prompt's structure from its
`score/prompts/brief.md`.

## Build-time choices

1. Parser: labels match in any case. Reason: models vary the case of labels they were given.
2. Parser: markdown emphasis (`*`, `_`) around a label or a value is dropped. Reason: models bold labels.
3. Parser: quote, list, heading and number marks before a label are dropped. Reason: models list the three lines.
4. Parser: NEXT and ACTION may be joined by spaces, one hyphen or one underscore. Reason: common spellings of one label.
5. Parser: a label opens its line and carries a colon. Reason: a label inside prose is not the block.
6. Parser: a field runs to the next label line, a fence, a thematic break or the end; lines join with single spaces.
   Reason: section 5 cuts lines, so a field must be one line, and a trailing fence or rule is not part of it.
7. Parser: the last line of each label wins. Reason: the closing message asks for the lines at the end of the reply.
8. Parser: DECISION and NEXT ACTION must be non-empty; WHY may be empty. Reason: the judge reads only the first two.
9. Parser: a word is a run of non-white-space, cut at frozen.BLOCK_WORDS per field, and the cut is recorded. Reason:
   one plain rule a script can apply.
10. Packets: a brief and model whose sessions all ended without a block get no packet. Reason: stock and near-miss rows
    alone measure nothing about that brief.
11. The near-miss row is the contrast call with the key's first action and an empty WHY. Reason: only its decision cell
    is anchored, so the rest must not hint.
12. The oracle block is the key's call with its first action and an empty WHY, on calibration briefs only. Reason:
    section 12 names one oracle block per calibration brief.
13. Every scripted block (stock, near-miss, oracle, answers) passes through the parser, so the 40-word cut applies.
    Reason: the judge must not tell scripted rows by length.
14. Seeds: a label build uses frozen.SEED plus its stage, a check build frozen.SEED plus 10, and each build skips every
    id an earlier map holds. Reason: one seed (change 1, item 5) with ids unique across maps.
15. The check map is stage 1's label packets again under new ids, plus one anchor packet per brief holding authoring's
    answers, the oracle (calibration briefs), the near-miss row and the stock rows; Astra and Opus label every check
    packet, at max for gold and at medium for their check. Reason: section 12's outputs, labelled by both judges, with
    the label packets' composition kept intact.
16. The judge prompt is `prompts/judge.md` (sha256 55315d4c...e8), on the founder lane's brief structure with two cells
    and three invented examples per cell. Reason: section 5 describes R2 and R3 but does not word the prompt.
17. A packet renders as KEY ITEMS (Call, Contrast, Action 1 to n), then BLOCKS with their three lines. Reason: the
    judge must see the contrast call to tell R2's "not the contrast call".
18. A resend carries the product-value eval's fixed note, and its answer replaces the first; `labeller()` returns a
    null entry when both cells are unlabelled. Reason: the founder lane's checked rule, and types.ts's null contract.
19. Judge answers may use 16,000 tokens at medium effort and 32,000 at max. Reason: the founder lane's brief and audit
    limits.
20. Gold comes only from max-effort Astra and Opus labels; a near-miss action cell and every stock cell carry no gold.
    Reason: section 12 fixes only the near-miss decision label, and stock rows have their own check.
21. Credited anchor cells count up to the number of other credited gold cells, in sorted order. Reason: anchors at most
    half the credited gold, chosen without judgement.
22. The output floor counts gold cells that count and the distinct blocks behind them; short reads NO READ. Reason:
    "40 labelled outputs from at least 40 blocks".
23. An unlabelled judge cell is read as the opposite of gold. Reason: it counts against the judge and is never dropped.
24. An unlabelled near-miss decision counts as wrong, an unlabelled stock cell fails the stock check, and a map with no
    near-miss or no stock row fails. Reason: the same rule, and the founder lane passed an empty stock check.
25. FAIL outranks NO READ in the verdict, and the result carries its reason code. Reason: a defined failure is the more
    useful report; both fail A4.
26. R is 0 when any part is 0, else null when any part is null, else 1. Reason: a known 0 decides the conjunction.
27. Only founder turns marked `delivered: true` count toward R1, G3 and exposure's answered questions. Reason: pre-run
    change 1; an unmarked turn is not known to be delivered.
28. A safety stop, a refusal and no block score R2 = R3 = 0, with R1 read from the log; missing and contaminated score
    null everywhere. Reason: section 8's table.
29. The skill was read when a main-agent Read of office-hours/SKILL.md succeeded, a Skill tool call naming office-hours
    succeeded, or a user turn holds the skill's Phase 2A or 2B heading. Reason: a slash command can load the skill
    without a Read.
30. Interactive is the run row's SESSION_KIND value. Reason: the run side reads the printed line.
31. A question was asked one at a time when a reply the founder answered (reply k below the delivered count) holds
    exactly one question matching the pin's markers; exposure counts distinct marker ids. Reason: the skill's STOP
    after each question.
32. The deliverable is a non-empty markdown file under <state root>/projects/<slug>/ matching the pin's design pattern
    or, on the new pin, its memo pattern. Reason: the templates' file names.
33. Builder mode is a successful Read of the builder section or a design doc with Mode: Builder; a done founder means
    before the cap. Reason: the skill reads that section before any builder reply, and the closing goes out only on
    done or the cap.
34. Startup-only questions match question sentences; kill lines, the evidence ladder, payment links and the two-sentence
    version match any line; every reply counts, the closing replies included. Reason: section 7 lists a kill line and
    the ladder, which are not questions.
35. G2 counts question sentences by the founder lane's sentence rule, leaving out the replies to the closing messages.
    Reason: the closing asks for a block, not questions.
36. Compliance reads the newest markdown file (by modification time, then path) as the deliverable type. Reason: one
    type per session.
37. An action has a date and a number when a date pattern matches and a number appears outside it. Reason: "by
    2026-11-20" alone is not "the warmest 3 by Friday".
38. A kill line is a KILL/CONTINUE line followed by By in any deliverable or the adviser's text. Reason: the memo puts it
    under a heading, the design doc inline.
39. A SUCCESS line counts only in a design doc with Mode: Startup. Reason: change 1 item 4f.
40. Code written is a Write, Edit, MultiEdit or NotebookEdit call on a file with a code extension. Reason: the skill
    writes markdown docs; a shell redirect is not read.
41. The commitment check reads <state root>/developer-profile.json sessions (and builder-profile.jsonl) for a
    commitment entry with a kill date and test, needs an approved deliverable, and is null outside new-arm founder
    sessions. Reason: change 1 item 4f; the skill logs it only after approval.
42. The candidate markers in `markers/` are this build's choice until stage 1 freezes them. Reason: section 12 stage 4.
43. Seams are named `score: <rule> | holds|breaks: <case>`, two per rule. Reason: the dry run drives every rule on
    both sides of its edge.
