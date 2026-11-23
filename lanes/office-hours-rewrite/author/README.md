# Office-hours rewrite eval: authoring

This folder builds the eval's briefs: the first attempt's 110 (prereg section 3, section 13's authoring line, section
14's reuse list and pre-run change 1 items 4d and 4e), and the second attempt's 96, 19 of them reused from the first
attempt (the second attempt's sections 4 and 5). Every model call goes through an injected caller in the product-value
meter's CallRequest shape, every label through the shared Labeller in types.ts (score/judge.ts labeller() in production), and
every block through the injected BlockParser (score/block.ts parseBlock), so the tests and seams make no call. Briefs
are written only into /dev/shm and sealed with age to a path outside the repository and off /dev/shm, so the checkpoints beside it survive a reboot. The /dev/shm checks read the real path of each directory's nearest existing parent, so a link can't point one elsewhere.

## Modules

- prompts.ts: the type table (the prereg's words), the skins, the anti-pattern surfaces, the author prompts, the
  full-information and opening-only prompts, the audit and the rewrite note.
- draws.ts: the first attempt's 76 slots in seeded order with their frozen inputs, the 68 the second attempt keeps, each
  slot's fixed draws (draw 1000 * (p + 1) + k from the family p + k names) and the seeded fact order.
- files.ts: reading an author's reply into opening.md, sheet.json, key.json and prior.json; shape checks (with item
  4e's builder goal fact); the twin check; the digest.
- screens.ts: the vocabulary screen and its pinned sources.
- checks.ts: the unanimous key, the give-away screen, the blind audit, the recognition probe and the generic screen.
- brief.ts: one draft from the author call through every check, with the one rewrite.
- pilot.ts: the projection read: the Jeffreys 0.95 quantile, the cost to fill calibration and comparison at the top-up
  bound of 30, its room and its scale.
- run.ts: the reused briefs, the pilot, then calibration and comparison with the projection read after each batch, then
  the reserves; the outcome log and resume; the halts; the judge check's answers.
- sets.ts: placing briefs into sets with pairs whole, and reserve replacement.
- custody.ts: the /dev/shm work directory, the age seal, decryption into /dev/shm only, the brief layout, the sealed
  outcome log (one record a settled draft, one checkpoint a batch) and its resume reader, and the reuse reader.
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

- The caller: the metered client on the authoring ledger item, spent(), the item's committed spend so far, and
  spentOn(brief), the dollars one brief's calls took.
- The labeller: score/judge.ts labeller() over the judge client; the block parser: score/block.ts parseBlock.
- An mdd(comparisonFounderBriefs) function for the E_OHR_SUPPLY_SHORT message.
- A gstack clone holding both screen commits (gitReader), an age recipients file, an age identity file for the reused
  briefs or a checkpoint, and a command entry. This folder wires no CLI row: authorRun, haltOf, authorToCustody, ageSealer, loadScreen and checkAnswers are the entry points.

## Build-time choices

1. Skins: seven voice-and-industry sets; SKINS[1] to [5] are the comparison skins, [0] serves calibration and [6] the reserves, so no two openings share an industry.
2. A skin is one voice with an industry per founder type and a project domain per builder goal, because section 3 says skins differ by industry and voice but not how many industries.
3. Builder slots are 24 of the 25 goal-and-skin pairs, seeded, so each goal gets 4 or 5 and each skin 4 or 5.
4. Calibration and reserves take two seeded paired types and two seeded goals each, never the same ones, plus T7 and T8.
5. The anti-pattern list (21 entries) is our reading of the rewrite's phase-2a, phase-2c and design-and-handoff, first at 0787a1e and confirmed unchanged at the new pin 4afa7f2 (pre-run change 2); authors get only our surface phrase.
6. Anti-patterns go round a seeded order of the list over the comparison openings first, then calibration and reserves, so each appears in at least one comparison opening; builders carry none.
7. A pair's first twin takes a seeded side of its contrast.
8. Author prompts are pairPrompt, twinPrompt, unpairedPrompt and builderPrompt, modelled on the founder lane's author prompt.
9. The first twin's author also writes twin_call, the opposite decision; it is the contrast for the first twin's screens and the call the second twin's prompt asks for. It is not kept in key.json.
10. A second twin writes only sheet.json and key.json; its opening is the partner's, byte for byte.
11. The twin check (keyless, drops at once): same persona and fact ids, every fact outside both keys' decisive ids unchanged, at least one decisive fact rewritten, and a different call.
12. Brief ids: d<draw> for an unpaired brief, d<draw>a and d<draw>b for twins; key.twin is set before any check, so the digest never changes after one.
13. A draw number is 1000 * (p + 1) + k for slot p's k-th first-twin or unpaired draft (the second attempt's section 5.1; the first attempt counted first drafts in the order made); second twins carry their pair's draw. Every prompt ends with "Brief reference: <id>[.<attempt>]." so no two drafts send one request and the meter cache cannot replay one draft for another.
14. A failed unpaired brief or first twin is drawn again in its slot; a failed second twin gets a new draft against the same partner until 30 have failed (the top-up bound), when the partner drops and its slot starts a new pair.
15. T8's prior session uses fixed dates (2026-10-06, test due 2026-11-03), both before authoring, so the test's date has passed at every session.
16. Item 4e's goal fact: one fact whose text holds the goal's word (hackathon, open source, research, learn or learning, fun) and whose reveal_when holds "goal" or "mode".
17. Facts: 10 to 16 with the founder lane's kinds; 1 or 2 decisive ids; 2 to 4 actions.
18. The full-information prompt: the none arm's first message, T8's prior line, "Everything else I know, in no particular order:", the facts in seeded order, the closing message's request ("Please end your reply..." and its three lines) and "Answer in this one reply. I can't answer questions, so decide with what you have."
19. The opening-only prompt is the same without the facts; T8's keeps its prior line, the most a skill arm sees before it asks.
20. The give-away screen drops a brief when any validator's decision cell is credited; the action cell is not read.
21. A validator with no block, or a cell the rule reads left unlabelled, is asked once more with twice the tokens; a second miss drops the brief.
22. Audit checks (a) to (f), by Opus and the other author family at high effort; (f) checks the opening carries its surface trait. An unreadable audit fails every check.
23. The vocabulary screen bars 5-word sequences from the Ask lines of phase-2a at the current pin and at the new pin, every double-quoted string in the new pin's "Reality Check" section of phase-2a and in its "Pivot flow" section of phase-2c, and the lens line, plus the founder lane's six named terms, each source refused on any other sha256. The quoted strings are not only questions: at the new pin the reality-check section gives six (three questions, a gstack-slug shell line, a founder's example words and an adviser's line) and the pivot flow six (four questions, a worked market-size line and an adviser's line). The shell line's five-word sequences are path pieces ("claude skills gstack bin gstack"), so it bars nothing a brief would say (pre-run change 4).
24. The generic screen labels the rewrite's three stock rows with Astra and Opus; any credited cell drops the brief; an unlabelled cell is counted.
25. Check order: twin check, vocabulary, unanimous, give-away (unpaired only), audit, probe, generic. Vocabulary, audit and probe failures take the one rewrite; the others drop.
26. The pilot (the second attempt's section 5.4) takes the first two open slots of each pair type, each until it settles one partner or has drafted 3 first twins, and 8 drafts each of T7, T8 and builders, one a slot in turn. The projection is read at its end and after every later batch, and every read goes into the summary. Since the Captain's ruling of 2026-11-18 it is descriptive only and never stops authoring, which ends at its quotas, its cap, a stop that is not about money, or the draft limit. The reserves draw last.
27. A batch starts no more drafts than the cap less the spend covers at $3.50 each (section 13's brief allowance), and authoring stops after 10,000 drafts, or before a slot's 1,000th first-twin or unpaired draft, whose draw number would reach the next slot's.
28. Every settled draft is sealed with its spend as it settles, and a checkpoint of the log and the placed briefs after every batch. A resume rebuilds each slot's state from the newest checkpoint and the records after it, so no sealed draft is requested again. Every sealed file carries the run id, also kept in plain run.json beside them, and a resume continues that run on the same ledger item whether or not the stopped run's meter dir survived: its lease reserves the spend cap less what the item has committed, once the meter settles the dead lease from the local ledger, and the projection's scale comes from the sealed records' per-draft spend. The first attempt's pilot continuation and its frozen-inputs digest are gone. Every sealed file and run.json also name the ledger item, and a resume refuses another --item. The checkpoint the run ends on, and run.json, record how it stopped and every stop code; a checkpoint whose name is taken gets a _2 suffix. A run that ended on a cap stop never resumes, and its lease closes with the cap stop, so the item takes no later lease. ohr author holds an exclusive lock on the checkpoints folder while it runs, and --resume takes it before it reads the journal or leases, so two processes never write one run.
29. A reserve takes the dropped brief's skin; kind means pair, unpaired founder or builder, and type is not matched.
30. checkAnswers hands the judge check every placed brief's full-information blocks and every unpaired brief's opening-only blocks, with author naming the validator.
31. A stop that a draft or label call throws (CAP_STOP, E_LEASE_CLOSED, E_OHR_MODEL_DRIFT, E_PV_PROVIDER_DRIFT or E_PV_EMPTY_REPLIES) ends the run like a cap stop once the batch's drafts settle. The run carries it as its halt, so the briefs already placed are still written and sealed, and haltOf returns that stop's code. A cap stop wins over any other stop in its batch, and the run records the code of every stop the batch threw. Any other error still rejects the run.
32. A first-attempt brief is reused only when its slot is one of the 13 reused slots and its files, its outcome and its brief.json name one digest, and a pair only with both twins; ohr author first checks the sealed output's plaintext sha256. A brief that fails is drafted again in its slot.
33. A cap stop after calibration and comparison are full ends authoring with the reserves placed so far and no halt; before, it halts as rule 31 says.

## Contract requests

- The product-value meter routes model "astra" to gpt-6-astra, while the prereg's unanimous key names GPT-6.2 Astra (frozen.ts JUDGE_MODEL_KEYS). The wire must map the authoring caller's "astra" to openai/gpt-6.2-astra.
- The screen reads the new pin's files, and pre-run change 2 confirms the anti-pattern list at that pin.

## Limits

- Tests for draws and the pilot were written first and seen failing; the other modules' tests were written with the code and each rule is driven on both sides instead.
- A reserve may change a skin's type mix (a T7 reserve can stand in for a dropped T8), and a replacement may remove the only opening carrying some anti-pattern.
- ageSealer and ageDecrypter shell out to age, which is not installed here; the tests drive custody through injected sealers.
