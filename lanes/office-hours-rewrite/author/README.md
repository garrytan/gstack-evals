# Office-hours rewrite eval: authoring

This folder builds the eval's 110 briefs (prereg section 3, section 13's authoring line, section 14's reuse list and
pre-run change 1 items 4d and 4e). Every model call goes through an injected caller in the product-value meter's
CallRequest shape, every label through the shared Labeller in types.ts (score/judge.ts labeller() in production), and
every block through the injected BlockParser (score/block.ts parseBlock), so the tests and seams make no call. Briefs
are written only into /dev/shm and sealed with age to a path outside the repository.

## Modules

- prompts.ts: the type table (the prereg's words), the skins, the anti-pattern surfaces, the author prompts, the
  full-information and opening-only prompts, the audit and the rewrite note.
- draws.ts: the 76 slots in seeded order with their frozen inputs, author alternation and the seeded fact order.
- files.ts: reading an author's reply into opening.md, sheet.json, key.json and prior.json; shape checks (with item
  4e's builder goal fact); the twin check; the digest.
- screens.ts: the vocabulary screen and its pinned sources.
- checks.ts: the unanimous key, the give-away screen, the blind audit, the recognition probe and the generic screen.
- brief.ts: one draft from the author call through every check, with the one rewrite.
- pilot.ts: pilot.py's line, the 90% Wilson read and the two-step gate.
- run.ts: the pilot, then drawing until 110 briefs are placed or the cap stops it; the halts; the judge check's answers.
- sets.ts: placing briefs into sets with pairs whole, and reserve replacement.
- custody.ts: the /dev/shm work directory, the age seal, decryption into /dev/shm only, and the brief layout.
- fixtures.ts: invented fixtures, a scripted caller, a fixture parser and a word labeller.
- seams.ts: the dry-run seams, each frozen rule on both sides.

## Reused and copied

Imported as is: the founder lane's reply reader, sheet shape check, JSON writers, custody sink (openSink, writeSealed),
word rule, unitStrings and forcingQuestions, the validator routing (VALIDATORS), ask(), the recognition probe and its
prompts (PROBE, PROBE_REWRITE), the rewrite prompt shape, the named terms, author alternation and the scripted stub
caller; the autoplan audit's Wilson interval; the product-value seeded shuffle and repo-path helpers.

Copied and adapted, because the shape differs: the vocabulary screen (other sources, and it also reads prior.json), the
audit (checks a to f against a call and a contrast instead of a customer and wedge), the generic screen (decision and
action cells over the rewrite's three stock rows), the draft runner (roles, twins and one rewrite, after
constructed.ts), the sets (slots instead of type minimums) and the fixed-seed fact order (this eval's seed).

## What another area must provide

- The caller: the metered client on the authoring ledger item, and spent(), its metered spend so far.
- The labeller: score/judge.ts labeller() over the judge client; the block parser: score/block.ts parseBlock.
- An mdd(comparisonFounderBriefs) function for the E_OHR_SUPPLY_SHORT message.
- A gstack clone holding both screen commits (gitReader), an age recipients file, and a command entry. This folder wires
  no CLI row: authorRun, haltOf, authorToCustody, ageSealer, loadScreen and checkAnswers are the entry points.

## Build-time choices

1. Skins: seven voice-and-industry sets; SKINS[1] to [5] are the comparison skins, [0] serves calibration and [6] the reserves, so no two openings share an industry.
2. A skin is one voice with an industry per founder type and a project domain per builder goal, because section 3 says skins differ by industry and voice but not how many industries.
3. Builder slots are 24 of the 25 goal-and-skin pairs, seeded, so each goal gets 4 or 5 and each skin 4 or 5.
4. Calibration and reserves take two seeded paired types and two seeded goals each, never the same ones, plus T7 and T8.
5. The anti-pattern list (21 entries) is our reading of the rewrite at 0787a1e's phase-2a, phase-2c and design-and-handoff; authors get only our surface phrase.
6. Anti-patterns go round a seeded order of the list over the comparison openings first, then calibration and reserves, so each appears in at least one comparison opening; builders carry none.
7. A pair's first twin takes a seeded side of its contrast.
8. Author prompts are pairPrompt, twinPrompt, unpairedPrompt and builderPrompt, modelled on the founder lane's author prompt.
9. The first twin's author also writes twin_call, the opposite decision; it is the contrast for the first twin's screens and the call the second twin's prompt asks for. It is not kept in key.json.
10. A second twin writes only sheet.json and key.json; its opening is the partner's, byte for byte.
11. The twin check (keyless, drops at once): same persona and fact ids, every fact outside both keys' decisive ids unchanged, at least one decisive fact rewritten, and a different call.
12. Brief ids: d<draw> for an unpaired brief, d<draw>a and d<draw>b for twins; key.twin is set before any check, so the digest never changes after one.
13. A draw number counts first drafts only; second twins carry their pair's draw. Every prompt ends with "Brief reference: <id>[.<attempt>]." so no two drafts send one request and the meter cache cannot replay one draft for another.
14. A failed unpaired brief or first twin is drawn again in its slot; a failed second twin gets a new draft against the same partner until authoring ends.
15. T8's prior session uses fixed dates (2026-10-06, test due 2026-11-03), both before authoring, so the test's date has passed at every session.
16. Item 4e's goal fact: one fact whose text holds the goal's word (hackathon, open source, research, learn or learning, fun) and whose reveal_when holds "goal" or "mode".
17. Facts: 10 to 16 with the founder lane's kinds; 1 or 2 decisive ids; 2 to 4 actions.
18. The full-information prompt: the none arm's first message, T8's prior line, "Everything else I know, in no particular order:", the facts in seeded order, the closing message's request ("Please end your reply..." and its three lines) and "Answer in this one reply. I can't answer questions, so decide with what you have."
19. The opening-only prompt is the same without the facts; T8's keeps its prior line, the most a skill arm sees before it asks.
20. The give-away screen drops a brief when any validator's decision cell is credited; the action cell is not read.
21. A validator with no block, or a cell the rule reads left unlabelled, is asked once more with twice the tokens; a second miss drops the brief.
22. Audit checks (a) to (f), by Opus and the other author family at high effort; (f) checks the opening carries its surface trait. An unreadable audit fails every check.
23. The vocabulary screen bars 5-word sequences from the Ask lines of phase-2a at the current pin and at 0787a1e, 0787a1e's quoted reality-check questions, its quoted pivot-flow questions, and the lens line, plus the founder lane's six named terms, each source refused on any other sha256.
24. The generic screen labels the rewrite's three stock rows with Astra and Opus; any credited cell drops the brief; an unlabelled cell is counted.
25. Check order: twin check, vocabulary, unanimous, give-away (unpaired only), audit, probe, generic. Vocabulary, audit and probe failures take the one rewrite; the others drop.
26. The pilot runs pair slots only, launches exactly as many second-twin drafts as the read needs, and its first-pass rate is its first twins' pass rate; its cost per draw is the lease's spend over all its drafts.
27. A batch starts no more drafts than the cap less the spend covers at $3.50 each (section 13's brief allowance), and authoring stops after 1000 drafts.
28. The pilot's frozen-inputs digest covers every slot's first prompt, the twin prompt's text, the screen's sequences and the fixed notes. A continuation from a pilot with another digest places none of its briefs.
29. A reserve takes the dropped brief's skin; kind means pair, unpaired founder or builder, and type is not matched.
30. checkAnswers hands the judge check every placed brief's full-information blocks and every unpaired brief's opening-only blocks, with author naming the validator.

## Contract requests

- The product-value meter routes model "astra" to gpt-6-astra, while the prereg's unanimous key names GPT-6.2 Astra (frozen.ts JUDGE_MODEL_KEYS). The wire must map the authoring caller's "astra" to openai/gpt-6.2-astra.
- The screen and the anti-pattern list read the content change at 0787a1e. If the new pin lands at another head, the pre-run change that pins it should confirm or update both.

## Limits

- Tests for draws and the pilot were written first and seen failing; the other modules' tests were written with the code and each rule is driven on both sides instead.
- A reserve may change a skin's type mix (a T7 reserve can stand in for a dropped T8), and a replacement may remove the only opening carrying some anti-pattern.
- ageSealer and ageDecrypter shell out to age, which is not installed here; the tests drive custody through injected sealers.
