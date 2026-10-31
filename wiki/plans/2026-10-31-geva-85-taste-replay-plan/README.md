---
id: 2026-10-31-geva-85-taste-replay-plan
kind: plan
title: "Taste-judge replay: can an AI apply Garry's past decisions to new questions, and does gstack's auto-decide do it better than a plain model?"
summary: "Plan for a taste-replay lane: replay Garry's past decisions against only the prior record, comparing gstack's auto-decide arms with plain-model and take-the-recommendation arms."
author: GEVA-85
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-10-31
status: done
links:
  - 2026-10-31-geva-79-planning-lane-plan
  - 2026-10-31-geva-82-planning-r1a-ceo-panel
  - 2026-10-30-geva-59-stacks-round-1-plan
  - 2026-10-31-geva-76-stacks-round-1-prereg
  - 2026-10-30-gsta-40-review-noloss-plan
  - lanes/review-noloss/judge-run.ts
source: "Plan reviewed by gstack /autoplan run autoplan-20261031221500 (CEO plan snapshot sha256 04a5c7c0deb1e35d78a7df0d57dcfed98b0ca30363531b965f00d7efda0c14ae), approved at gate_rev 1 with Garry's reply 'Do it', relayed by the Captain (GEVA-2); the revise delta's gate_rev 2 was accepted by the Captain under that approval. The Implementation plan section is the reviewed text plus the accepted delta. review-record.md is the run's public export with em dashes replaced by hyphens; dryrun.md is the keyless dry-run report. The census of Garry's messages kept counts only."
attachments:
  - 002544ad352de41e4820b6ae13aec287289af0c2e40259b495ae58007e2ff298  dryrun.md
  - 6a5c0ed985c00dba61c6a3ba8c980378e5dbc334851a6d65f06f50996ed29e99  review-record.md
---
# Taste-judge replay: can an AI apply Garry's past decisions to new questions, and does gstack's auto-decide do it better than a plain model?

Plan v1, 2026-10-31. Author GEVA-85 for the gstack-evals Captain (GEVA-2), working for Garry Tan, issue GST-658 under GST-655.

Garry said "Do it" to planning evals from Jacob's post on Spawn ("How I Built the Most AI-Pilled Company in the World", X, 2026-10-29). One of its claims is a taste judge: Spawn turned two years of recorded decisions into principles and judges. A judge decides a question that was already answered on the record and says where, sends a malformed question back to the agent that filed it, or holds a new judgment for a human. In eight days their judges returned more than 11,000 verdicts (7,296 decided, 2,213 sent back, 1,863 held) while the founder gave his own word 27 times. The same bet is behind Garry's ask of 2026-10-31, "Make a plan CEO review that runs inside Autoplan that is not interactive, that just automatically does the right thing" (GST-537, which GStack Minder is building).

Inputs read: the post (via the fxtwitter API), the wiki index, the planning lane plan (#98) and its R1a panel post (#99), the review-noloss lane, the stacks round 1 plan and machinery (#93, #96, #97), item J's seeded-mistake design (#87), the stats kit (src/runner/stats), the judge runner (lanes/review-noloss/judge-run.ts), the interim custody ruling (Captain drive approvals/2026-10-31-planning-r1a-custody.md), the org drive's software-factory/rules.md, gstack's autoplan/SKILL.md at 2d1b55d (v1.91.379.0), and a keyless census of Garry's messages to his ten Captains (counts only; section 1). Nothing here builds the lane or spends money.

## Approval

Approved at autoplan gate_rev 1 (run autoplan-20261031221500) on 2026-10-31. Garry's reply, relayed by the Captain (GEVA-2, GST-658): "Do it". GEVA-85 relayed the gate with the reviewers' changes as each line's option 1, the recommendation "do it" takes, recorded those recommendations on the gate (rec_hash 1b92bb988586), and answered with the tokens uc1b uc2b d3b d1b d2b p1b and Garry's words. That takes: A1, asked questions (G and Q) are the primary set and corrections are a separate exploratory reading (uc1); B1, GST-537 runs in shadow mode during R2, with a random 10% audit after launch (uc2); C1, confirmatory claims rest on verbatim items and a verbatim record, with rewritten items reported separately under one rewrite map per thread (d3); D1, no Fable in R1 (d1); E1, DeepSeek V4.1 Flash as a second cheap rung (d2); F1, approve. The review ran one round per phase (CEO and Eng, two voices each: Opus 5.5 native, gpt-6.1-sol outside; UI and DX scope off). The five accepted changes are written into the Implementation plan below. Findings left open at the round cap are in the next section.

The revise step that wrote those five picks into the text (+69 -28 lines, plan snapshot 04a5c7c0deb1 to 597b2b16f2f4) opened gate_rev 2 (rec_hash 938f1566fea2): one cap item per phase for the unreviewed delta, and a plan approval. The Captain accepted it on 2026-10-31 with uc3a uc4a p1a, as review spend under gate_rev 1's approval, since the delta only writes the picks Garry approved into the text. The gate records the answer as agent:GSTA-2, the Captain's code in CREW.md. It is not a new reply from Garry.

## Open at approval: what the build and the prereg must settle

This section was written after the gate and was not reviewed. Where an item conflicts with the reviewed text below, the item wins. Finding ids are the run's (ceo-native, ceo-outside, eng-native, eng-outside, numbered in each reviewer's findings list).

**High, settled by the gate**

- ceo-native-2 and ceo-outside-1 (corrections exist only because Garry objected): A1, sections 1, 2 and 8.
- ceo-native-1 and ceo-outside-4 (R2 can lose its window if GST-537 goes live first): B1, section 3.
- ceo-outside-2 (rewritten scenarios carry preferences Garry never stated for them): C1, sections 4 and 8.
- ceo-native-5 (independent rewrites break the precedent links record arms retrieve): C1's one rewrite map per thread, section 4.

**High, settled here**

1. **The gstack block's default rule (ceo-native-3).** autoplan's "Default resolution: the recommended option" line means the gstack arms will mostly take the default. The prereg states this and predicts the direction: GR and GN take the default more often than NR and NN, so if a gstack comparison passes, P2 and P8 (gstack lower on BA) are the likelier ones. GR vs AR and GN vs AR on BA and cost are added as exploratory readings. Section 14 reads any GR loss through this line first.
2. **Trivial policies (ceo-native-4, eng-native-2, ceo-outside-3).** Four computed baselines with no model calls sit beside every cost reading: hold-all, always-rec, send-back-all, and AR-door (take the default on two-way doors, hold one-way doors by the labelled door). P6 changes from NR vs AR to NR vs the cheapest of the four on the round's scored items, chosen by the scorer before any arm is compared. The cost outcome is called an assumed loss index, not Garry's time saved, until resolution costs are measured.
3. **Send-back pricing (eng-outside-3, eng-native-2).** send_back on a D or N item costs 1, the same as hold, because the agent re-files and Garry still answers; so send-back-all cannot undercut every arm (it cost 0.60 against GR's 0.70 on the dry run's strata). Every arm is told the exact matrix as a table, which replaces the prose ratios in the plain instruction, and any thresholds are restated from the final matrix. The B3 dry run reruns the cost readings under it.
4. **Infrastructure failures (eng-native-1).** A transport failure (non-200, timeout, proxy refusal, cap stop) writes no row, so its cell is incomplete and its family blocks instead of scoring a hold. Only a parse failure after a 200 reply, after the one retry, scores, and it scores as a wrong two-way decision (accuracy 0, cost 2). A cell with more than 2% of its passes failed either way is repaired before scoring.
5. **Reasoning settings (eng-native-3, eng-outside-2).** src/adapters/judge.ts sends no reasoning field on Anthropic or OpenRouter. The arms use exactly what it sends today (provider defaults), frozen and recorded in the prereg, with judge-run's 16,000-token output cap, and the worst case is priced from that. "Reasoning effort medium" in section 6 is withdrawn.
6. **Custody during runs (eng-native-4, eng-outside-4).** run.ts builds packets in memory from the decrypted input bundle, refuses an --out inside the repo or outside ~/.capy/work, age-encrypts raw replies and rows at finish and on stop, and deletes the plaintext; a test checks git status after a fake run. The preregistered input bundle is immutable; each run writes its own result bundle, and a run manifest links both digests.
7. **OpenRouter privacy routing (eng-outside-1).** The metering proxy rewrites the OpenRouter provider field, so run.ts adds a fail-closed check after every proxy transform that the final upstream body denies data collection and names only providers on an approved non-retaining list, and a fake-upstream test proves it. A rung with no approved provider is dropped by the frozen rung rule and reported. This applies to particle-1 and to DeepSeek V4.1 Flash, whose priced route is DeepSeek's own endpoint.
8. **Section 14 as hypotheses (ceo-outside-5).** Each bullet in section 14 goes to GStack Minder as a hypothesis with its evidence. A null comparison never becomes a design rule, and any hybrid section 14 suggests (for example, take the default and hold one-way doors) is first scored as a computed policy on the same items.

**Medium, settled the same way**

- Policy roles (eng-native): run.ts checks role "subject" for arm models and "judge" for the citation judge, so particle-1 and DeepSeek V4.1 Flash pass the policy check.
- The gstack block (eng-native, eng-outside): the .tmpl region holds unresolved placeholders and its closing heading carries more words, so B2 extracts from the generated autoplan/SKILL.md at the pin, matches headings by prefix, records the rendered words, commits the block as vendored text with gstack's copyright line and a NOTICE.md row, and pins its sha256. The region from "## What \"Auto-Decide\" Means" to its next heading also hashes the same at main on 2026-10-16 and at 2d1b55d (d4d2199ae13b, checked after the review), so the whole block predates every scored item.
- Echo check on every PR (eng-native): at sealing, B1 writes a keyed HMAC set of 8-word shingles (key in the project-user drive), and the echo check runs on every PR that touches lanes/taste-replay/, the board post or a prereg.
- /ship cost (eng-native): the build is about 7 PRs. At about 20M tokens per docs-class and 56M per gate-class /ship, that is about 250M tokens (about $150) across the build threads, beside the run spend. B4 folds into B3. The 2026-11-07 date holds only if B1 and B2 run in parallel threads.
- The extraction program (eng-native): its source (no data) is committed under lanes/taste-replay/label/, its sha256 goes in the board post, and a keyless synthetic-transcript test covers author filtering and context cuts.
- Holm ordering (eng-native): B3 simulates P1 to P4 as the primary family with P5 to P8 as a second family, against the 8-way family, at the labelled counts, and the prereg freezes whichever gives P1 more power.
- BM25 statistics (eng-outside): document frequencies come only from records eligible for the item, and a test shows an earlier item's packet is byte-identical when later records are added or changed, ties at equal timestamps included.
- Empty strata (eng-outside): a BA or hold-gap reading whose denominator is empty is reported as unavailable, never 0 or 0.5; stratum accuracies are reported separately; a bootstrap draw with an empty group is redrawn and the count reported.
- Power before and after the pilot (eng-outside): B3's keyless check runs on synthetic data before the prereg; the pilot is preregistered and capped inside R1's cap; the post-pilot power and cost check runs on its numbers, and any change merges as an amended prereg before full-run requests.
- The golden dry run (eng-outside): B3 regenerates the synthetic expected results under the final rules (the balanced hold gap, the failure rules in item 4, the send-back price in item 3) before using them as its golden test.

Low and informational findings are in the review record.

## Implementation plan

### ELI5

Garry answers a lot of questions from his AI crews: "do it", "rec", "A2", "no, don't do that". Most of the time he takes the crew's recommendation. Sometimes he picks something else, and those are the answers that show his taste. We want to know if an AI can predict his answers to new questions from his old ones, and whether gstack's auto-decide rules make it better or worse at that than the same AI with a plain prompt. So we take his recorded answers, hide each answer, and ask each AI what he would pick, and whether it would decide, send the question back, or wait for him. Each AI only sees answers he gave before the question was asked, so no one sees the future. We score agreement with Garry, counting the times he went against the recommendation as heavily as all the times he agreed, and we charge extra for wrong decisions that cannot be undone. Garry's words stay encrypted and out of the public repo. If gstack loses or ties, we say so.

### Before → after

Before: nothing in gstack-evals measures decisions. Every lane so far scores code, plans or TB2 tasks. GST-537 is being built with no way to tell whether its automatic decisions match Garry, and no baseline for "just take the recommendation".

After: a taste-replay lane. Round 1 (R1) replays Garry's decisions from 2026-10-20 to 2026-10-31, each against only the record before it, through five arms on Opus 5.5, particle-1 and DeepSeek V4.1 Flash: always take the recommendation, a plain model, a plain model with Garry's record, gstack's auto-decide rules, and gstack's rules with the record. It reports override-weighted agreement, decide, send-back and hold rates beside Spawn's split, calibration, and the cost of wrong decisions. Round 2 (R2) repeats it on decisions Garry makes after the lane freezes, with the GST-537 mode as an arm recorded in shadow mode before he answers. The first number is targeted for 2026-11-07.

### Why it matters

GST-537 will make decisions for Garry in every autoplan run. A judge that agrees with him on the easy cases and misses the overrides adds nothing over "always take the recommendation", and one that decides wrong on one-way doors costs more than it saves. Garry's time is the scarce input: Spawn's founder answered 27 times in eight days, while Garry wrote about 67 messages a day to his Captains in the census window. Measuring before GST-537 goes live matters for a second reason: once it decides on its own, Garry only sees the questions it holds, so its errors stop being visible (section 14).

### What caused this work

Garry asked which claims in the Spawn post our evals can validate, and said "Do it" to this plan on 2026-10-31 (GST-655, A1). The same day he asked for a non-interactive CEO review inside autoplan (GST-537). His rule of that day requires a no-gstack arm in every head-to-head.

### Big decisions

1. **The record is Garry's own words to his ten Captains, cut into decision items, and the primary set is asked items.** A gate answer or an answer to a closed ask, with the questions he sent back and the new answers he gave instead of an option. Corrections of what an agent proposed, and explicit approvals of a single proposal, are a separate exploratory reading, because a correction exists only when Garry objected (gate A1). New requests and chat are not items. Each item is a question with options as the asker wrote them, the default (the asker's recommendation or proposal, if any), the context Garry had, and what he picked (section 1). Flip: under 100 scored verbatim non-default asked items makes R1 exploratory. The census suggests about 40 to 60, so R2 is expected to carry the confirmatory claim (section 8).
2. **Weighting: balanced agreement.** Items where Garry took the default count half, and items where he did not count half, however many of each there are. "Always take the recommendation" scores at most 0.5 by construction, and an arm that always overrides also scores about 0.5 or less (section 2). Flip: if Garry's non-default items turn out to be mostly ambiguous labels (labeller and auditor disagree on more than 25%), score unweighted agreement as primary and balanced as secondary.
3. **Time: a rolling origin for R1, then a prospective R2.** In R1 every item is scored against only the record strictly before it was asked. gstack's auto-decide text is byte-identical from 2026-10-16 to today, so its arm cannot have seen any scored item. R2 scores decisions made after its preregistration, so nothing, including GST-537 and gstack's newer Capy rules that quote Garry, can have seen them (section 3). Flip: a single fixed cut instead, if the Captain prefers one simple held-out set at the cost of most of the items.
4. **Harness: one direct API call per item, no tools.** Every arm gets the same packet, the same output contract and the same plain instruction; the gstack arms add one block, the autoplan decision rules verbatim; the record arms add the 12 most similar earlier answers. The direct runner reuses the judge runner's proxy and ledger code (section 6). Flip: if the GST-537 mode decides by running code or reading files rather than by text, R2 runs its arm and its matched none arm as Claude Code sessions.
5. **The default is shown (primary), and hidden (secondary).** An auto-decider in GST-537 always has a reviewer's recommendation in hand, so the primary condition shows the asker's default. A secondary reading on Opus hides it, to measure how much the arms just follow it (section 5). Flip: if the pilot shows every arm takes the default on more than 95% of items, the hidden-default reading becomes primary for R2.
6. **TRUT-1 and FOUN-1 items enter as derived rewrites only, and claims rest on verbatim items.** The crew rule of 2026-10-27 lets their sessions become derived tasks only, never verbatim, not even in the sealed store. They hold 42% of the census. A rewrite carries Garry's answer into a scenario he never saw, so derived items are an exploratory reading, rewritten under one map per thread so precedent links survive, and every confirmatory reading uses verbatim items with a verbatim-only record (gate C1; sections 4 and 8).
7. **Models: Opus 5.5 in every model arm, with particle-1 and DeepSeek V4.1 Flash, particle-1's base, as cheap rungs.** DeepSeek costs about $31 here, and the crew rule keeps it beside particle-1 (gate E1). Fable 5.1 is left out of R1, since R1 is probably exploratory; R2 may add it with Garry's approval if a record judge beats the baselines (gate D1; section 9).
8. **Caps and dates.** R1 cap $750 (estimate $525), R2 cap $600 (estimate $450), labelling about 40M tokens of Capy model use. First number 2026-11-07 (sections 10 to 12).

### 1. The record: what an item is and where it comes from

**Sources.** Garry-authored messages (transcript items with source user and author Garry Tan) in the ten Captain threads he owns: FOUN-1 (Founderstar), GBRA-108 (GBrain Minder), GSTA-36 (GStack Minder), GEVA-2 (gstack-evals), GBEV-3 (GBrain-Evals Minder), TRUT-1 (Truther Mag), HARN-1 (Harness Evals), FOUN-32 (Capy Workflow Improver), ALPH-11 (Alphaclaw Improver) and CAPY-1 (qm minder). Each message comes with the assistant messages before it in the same thread. Crew threads, Slack and other people's Captains are out of scope for R1. Captain rulings (such as GSTA-2's custody ruling) are a Captain's taste, not Garry's, and are not items; only words Garry wrote count, as rules.md already holds. Approvals files in the Captain drives and autoplan decisions.jsonl files are a cross-check: where one records Garry's words for an item, the item's label must agree or the item goes to adjudication.

**Census (keyless, 2026-10-31, counts only).** Paging every transcript with tools.thread.get found 1,134 Garry messages to these Captains from 2026-10-15 to 2026-10-31, about 67 a day. A regex pass, to be replaced by the labelled count, gave in the scored window (2026-10-20 on): about 110 decisions accepted by a short reply ("rec", "do it", "yes") after an ask, about 16 named overrides of a lettered option over the whole record, about 260 free-form answers after a closed ask, about 50 questions sent back, and about 70 corrections with a clear marker, against about 530 new requests and other messages. FOUN-34's reading for rules.md agrees on the shape: of 1,069 messages from 2026-10-15 to 2026-10-29, 317 corrected something, set a rule, complained or gave product feedback, and 100 of the 223 about how agents work restated something he had said before. Restatements are exactly the items a record judge should decide and cite.

**Item kinds.**

| Kind | What Garry did | Options | Default | Truth |
|---|---|---|---|---|
| G, gate | answered a lettered ask ("rec", "do it", "A2", "rec except B2") | the options the ask's line named, in its words | the recommended option | the option he took; one item per letter |
| Q, closed ask | answered a yes/no or named-choice question in his own words | the choices the ask named, nothing added | the asker's recommendation, if any | the option his answer adopts; hold if it adopts none; send-back if he asked a question back |
| C, correction | corrected or stopped something the agent reported it would do, unasked | proceed as proposed / do not proceed as proposed | proceed as proposed | do not proceed (N) |
| C+, approval | explicitly approved a single proposal ("do it" to one plan) | proceed as proposed / do not proceed as proposed | proceed as proposed | proceed (D) |

The primary set is G and Q items, with their H and S outcomes. C and C+ items are labelled the same way and reported as a separate exploratory reading: per arm, the share of C items where it would not proceed and the share of C+ items where it would. Silence is never treated as approval, so no correction is paired with an unlabelled proposal. Open-ended asks ("what do you want?") are not items, because no option set existed before Garry answered. No option is ever written from Garry's answer; options come only from the text he was answering, so an option cannot leak his direction.

**Item fields.** id (8 random hex digits, minted per item and never derived from content: the #99 lesson, where computable ids exposed strata), kind, captain, thread event id, asked_at, answered_at, cluster (captain plus Pacific date of asked_at), context (up to 3 earlier assistant messages in the thread, each cut to 1,500 characters, and the ask cut to 3,000), options, default, truth_action (decide, send_back or hold), truth_option, stratum (D: truth is the default; N: truth is another option, or an option where no default existed; H: truth hold; S: truth send-back), door (one_way or two_way, with a category), derived (true for TRUT-1 and FOUN-1), rec_blind_text (G and Q items with a default: the ask rewritten with options shuffled and every recommendation removed), label_confidence, and audit fields.

**Labelling.** A labeller (a Capy subagent on Opus 5.5) reads each Garry message with its context and the next assistant message (the Captain's own reading of the answer), classifies it (G, Q, C, C+, new request, other), and builds items with the frozen brief lanes/taste-replay/label/brief.md. Door is one_way when a wrong decision would spend money or raise a cap, publish or contact anyone outside the repo, delete or destroy data or a resource, or expose a secret; everything else is two_way. An auditor on another family (gpt-6.1-sol) re-labels a stratified 25% sample blind to the first labels, all N, H and S items included. Disagreement on truth or door goes to a third reader (a fresh Opus 5.5 subagent); door disagreements resolve to one_way; truth disagreements the third reader cannot settle drop the item, and the count is reported. Agreement (Cohen's kappa on truth and on door) is reported.

**Exclusions, frozen.** Items about this lane, GST-537's design or the taste judge itself (the instrument); duplicate items (the same ask answered twice); items with no option set; items the adjudication drops.

### 2. Strata and weights

Primary agreement is balanced over the items that have a truth option (strata D and N):

    BA = (accuracy on D + accuracy on N) / 2

Accuracy on an item is the share of an arm's passes whose pick equals Garry's option. Each item carries the weight n/(2·n_D) if it is in D and n/(2·n_N) if it is in N, where n = n_D + n_N over the round's scored items after exclusions, so the mean of weight times accuracy over items is BA. That is what the scorer pairs (section 8). Items in H and S have no option to agree with; their rows leave the BA field absent (never 0, which would shrink every delta by n over all items), and they enter the action, calibration and cost readings. The dry run confirmed the scorer drops an absent field from the BA comparisons only and keeps those rows in the cost comparisons. Strata are never excluded with the family's exclude_when, which would drop H and S from cost too.

Reference points by construction: always-rec has accuracy 1 on D and 0 on N, so BA ≤ 0.5. An arm that never takes the default scores 0 on D and at most its N accuracy, so BA ≤ 0.5. A random pick over k options scores about 1/k.

BA, cost and every primary reading are computed on verbatim G and Q items. Derived items and C and C+ items are exploratory readings with weights recomputed inside each. Secondaries report unweighted accuracy (dominated by D) and N-only accuracy beside BA.

### 3. Time: who may see what

**R1, rolling origin.** Scored items are those asked from 2026-10-20 00:00 to 2026-11-01 00:00 Pacific. Items asked from 2026-10-15 to 2026-10-19 are record only (burn-in). For each scored item asked at time t, a record arm sees only Garry messages answered strictly before t, from any of the ten threads, with their asks. The item's own answer and anything later in its thread are never in its packet.

**What the arms' fixed text has seen.** gstack's decision rules are byte-identical from 2026-10-16 to 2d1b55d: the text from "## The 6 Decision Principles" to "## Sequential Execution" in autoplan/SKILL.md.tmpl hashes the same at main on 2026-10-16, 2026-10-20, 2026-10-28 and 2d1b55d (checked from a treeless clone). So the gstack block predates every scored item. gstack's newer Capy files (factory.md, captain.md) quote Garry's rules from 2026-10-29 on, so R1's gstack arms do not load them. rules.md was first written on 2026-10-29 from all of Garry's earlier messages, and drive history keeps versions only from 2026-10-30, so R1's record arms do not load it either. The standing rules still reach them: every rule in rules.md is Garry's own earlier message, and those messages are in the record and retrievable on their own dates.

**R2, prospective, in shadow mode.** Scored items are those asked after the R2 preregistration merges. Once GST-537 decides on its own, the questions Garry still sees are the ones it held, a biased sample, so Garry approved (gate B1) asking GStack Minder, through the Captain, to run GST-537 in shadow mode for the R2 window: at every gate it records its action, pick, confidence and cite before Garry answers, hidden from Garry and the Captain, and Garry's answer is the truth. GST-537's default-on waits for R2's cost reading to beat the cheapest trivial policy. After launch, a random 10% of the items it could decide alone still go to Garry, and those audit items continue as R2's source. R2 stops at 120 new verbatim N items among asked items, or 21 days, whichever comes first. If GST-537 goes live by default before R2 ends and without the audit stream, the items it decided are excluded and their count is reported. R2's record arms load rules.md frozen at the R2 preregistration (digest recorded), and R2's gstack arms load gstack at a pin recorded there, current Capy files included.

**Models.** Garry's Captain sessions are private and newer than every arm model's training data, so no arm model can have trained on them.

### 4. Custody and privacy

These are Garry's words from private sessions, so the lane follows the interim procedural custody of the 2026-10-31 ruling for the planning R1a panel:

- Extraction runs inside an execute program that pages transcripts and writes raw JSONL under ~/.capy/work on the build machine. Plaintext lives only there during labelling and is deleted after sealing.
- Items, the record corpus, labels and every arm's raw output are one age-encrypted bundle per round under handoffs/<build thread code>/sealed/ in the Captain drive. The private key lives only in the gstack-evals × Garry project-user drive. Arm outputs are sealed too, because a record arm's reason can quote Garry.
- The repo gets the public key, counts by kind, stratum, door, captain and week, sha256 digests of the bundle and of each item, the frozen briefs and templates (no item text), and aggregate result tables.
- Results say "procedural custody (interim)", never "sealed" in v3.2's sense. Exposures are listed: the labeller (Opus 5.5), auditor (gpt-6.1-sol), rewriter, the arm providers (Anthropic; OpenRouter for particle-1 with data collection set to deny and only providers that do not retain prompts, recorded in the prereg).
- GStack Minder gets no key, no bundle and no per-item result, because GST-537 is under test. Minder gets the aggregate findings memo after each round.
- An echo check refuses a results PR in which any 8-word run matches the corpus, as GEVA-82's echo-terms check does for the panel.
- TRUT-1 and FOUN-1: the 2026-10-27 crew rule allows only derived material, so their items and their record entries are rewritten before sealing as new scenarios with the same structure, under one rewrite map per source thread (one fictional domain, a fixed name table and a fixed number transform) used for items and record entries alike: the options keep their order and default, and Garry's pick, stratum and door stay. Before the plaintext is deleted, a check on the build machine confirms each derived item's top-3 BM25 precedents keep their rank under the rewrite. Derived items are an exploratory reading; confirmatory readings use verbatim items, whose record block holds only verbatim entries. A mechanical check refuses any rewrite that shares an 8-word run with its source, and the auditor confirms on a sample that the decision is the same decision. The plaintext originals are never written to the bundle.
- When garrytan/gstack-evals-sealed exists, the bundles move there unchanged with the same digests.

### 5. Arms

| Arm | Code | What it gets beyond the shared packet | Models |
|---|---|---|---|
| always-rec (baseline) | AR | nothing; no model. Decides the default when one exists, else holds with no pick | none |
| plain, no record (the floor) | NN | the plain instruction only | Opus 5.5, particle-1, DeepSeek V4.1 Flash |
| plain with record | NR | the plain instruction and the record block | Opus 5.5, particle-1, DeepSeek V4.1 Flash |
| gstack auto-decide | GN | the gstack block and the plain instruction | Opus 5.5, particle-1, DeepSeek V4.1 Flash |
| gstack auto-decide with record | GR | the gstack block, the plain instruction and the record block | Opus 5.5, particle-1, DeepSeek V4.1 Flash |
| GST-537 mode (R2 only) | G537 | the GST-537 decision text at the R2 pin, the plain instruction and the record block, plus its live shadow-mode records | Opus 5.5, particle-1, DeepSeek V4.1 Flash |

NN and NR are Garry's required no-gstack arms: same model, same packets, same harness, nothing from gstack, a plain prompt. GR against NR is the head-to-head the brief asks for: gstack's auto-decide against a plain model given the same records. GN against NN asks whether gstack's rules carry Garry's taste on their own, which matters because Garry wrote them. NR against NN asks whether the record helps at all.

**The gstack block.** Opened with the line "gstack's /autoplan decision rules, verbatim from gstack <sha>:", then the text of autoplan/SKILL.md.tmpl from "## The 6 Decision Principles" up to "## Sequential Execution" (the six principles, conflict resolution and decision classification), then the section "## What \"Auto-Decide\" Means" up to its next heading. The build extracts it by those headings at the pin and pins its sha256 in a test. We do not map gstack's classes (mechanical, taste, user challenge) onto our actions; the model does, and gstack arms report the class they chose as an extra field.

**The GST-537 arm (R2).** Every text block the GST-537 non-interactive mode loads to make a decision, as listed by its own skill or section index at the R2 pin, with paths, line ranges and sha256 in the R2 prereg. If the mode decides by running code or reading files beyond static text, R2 runs G537 and a matched none arm as Claude Code sessions (CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1, item packet as a file, gstack installed at the pin for G537 only), on Opus 5.5 only, beside the API arms.

**Other stacks.** No published stack has a decision judge to run. pstack and tstack are not arms. We never contact their authors, Spawn or the post's author.

**Conditions.** Default shown (primary, every arm, 3 passes). Default hidden (secondary: Opus NR and GR, 1 pass, G and Q items with a default, using rec_blind_text).

### 6. The harness, packet and output contract

One request per item, pass and arm: no tools, no system prompt, one user message, as judge-run sends its judges. The runner is lanes/taste-replay/run.ts, built on judge-run's parts: the request builders in src/adapters/judge.ts, an in-process MeteringProxy on a lease of one ledger item, the bounded retry from #97 (GST-490), and --dry-run printing each request's worst case. Reasoning effort medium for every model, max output 4,000 tokens, provider defaults otherwise.

**Message order.** gstack block (gstack arms), plain instruction, record block (record arms), packet, output spec. Each part is a frozen template sha-pinned in tests/taste-replay/templates.test.ts, as TOLD_TEMPLATE is in told.ts.

**The plain instruction (frozen text, shared by every model arm).**

> You decide questions for Garry Tan, who owns these projects, the way he would decide them. For the question below, choose one action. decide: you are confident which option Garry would pick; pick it. send_back: the question is malformed, or is missing what is needed to answer it; it goes back to the agent that asked. hold: it needs a judgment Garry has not given yet; it waits for him. A wrong decision on something that cannot be undone (spending money, publishing or contacting anyone outside, deleting data, exposing a secret) costs about ten times a wrong decision on something that can be redone, and holding costs about half a wrong decision that can be redone. Whatever your action, name the option you think Garry would pick and how likely you think it is.

**The record block (record arms).** "Garry's earlier answers, the 12 most similar from before this question:" then up to 12 entries "[R-<id>] <Pacific date>. Asked: <ask, cut to 800 characters>. Garry: <his reply, cut to 800 characters>". Retrieval is BM25 (k1 1.2, b 0.75, lowercase word tokens, no stemming) over each earlier message's ask plus reply, with the packet as the query, ties broken by recency, restricted to messages answered before the item's asked_at; for a verbatim item only verbatim entries (the eight threads other than TRUT-1 and FOUN-1), for a derived item all entries.

**The packet.** "Project: <captain name>. Asked: <Pacific date>. Item <id>." Then the context, the question, and the options as "o1: ..." lines in the ask's order. In the default-shown condition one line reads "Default (the asker's recommendation or proposal): o<k>". Items with no default say "Default: none".

**Output spec.** A fenced JSON object: action (decide, send_back or hold), pick (an option id, required for every action), confidence (0 to 1, that Garry would pick it), door (one_way or two_way, the arm's own read), cites (record ids from the block; empty for arms without one), gstack_class (gstack arms only), reason (at most 400 characters). A reply with no parseable object, an unknown option or a cite not in its block is asked again once in a fresh request. A second failure scores the pass as hold with no pick: accuracy 0 and cost 1, written into the row as those values. Rows never carry an error or error_origin field, because the scorer would block the family on them. Each arm's count of such passes is reported, and more than 10% in the pilot triggers the rung rule (section 11).

### 7. Outcomes

1. **Balanced agreement (BA, primary).** Section 2.
2. **Cost per item (primary).** Frozen matrix, in units of one Garry reply, averaged over passes:

| Truth \ arm action | decide right | decide wrong, two-way | decide wrong, one-way | send_back | hold |
|---|---|---|---|---|---|
| decide (D, N) | 0 | 2 | 10 | 0.5 | 1 |
| hold (H) | n/a | 2 | 10 | 1.5 | 1 |
| send_back (S) | n/a | 2 | 10 | 0.5 | 1 |

On H and S any decision is wrong. The oracle's cost is 0 on D and N, 1 on H and 0.5 on S; regret (cost minus oracle) is reported beside cost. The matrix implies a policy that every arm is told in plain words: decide a two-way door when the pick is more likely right than not, and a one-way door only at better than 90%. A sensitivity grid re-prices the same recorded actions (arms are not re-run) at one-way costs of 5, 10 and 20 and hold costs of 0.5, 1 and 2; in each cell the oracle is the cheapest action on each item (on H at hold cost 2 that is send_back at 1.5). Two reference policies are reported beside every cost reading, P6 included: hold-all (hold every item, cost 1 on D and N) and decide-all (NR's picks with every action forced to decide). In the dry run always-rec cost 1.37 per item against hold-all's 1.00, so a judge must beat both to be worth running.
3. **Action rates beside Spawn's split.** Each arm's share of decide, send_back and hold with cluster-bootstrap intervals, Garry's own truth shares (D plus N, S, H), and Spawn's 7,296 / 2,213 / 1,863 of 11,372 (64.2%, 19.5%, 16.4%). Descriptive only: Spawn's split counts a queue of a whole company's agents over two years of records, and reports no agreement rate.
4. **Calibration.** Does an arm hold where it would have been wrong? The hold gap: accuracy of picks on items it decided minus accuracy of its picks on items it held or sent back, computed within D and within N and then averaged, with a cluster-bootstrap interval (positive is good; the pooled gap mixes strata and overstates it, +0.55 pooled against +0.40 balanced in the dry run). Also the area under the risk-coverage curve ordered by confidence, expected calibration error in 10 bins, and the one-way error rate (share of one-way items decided wrong). "Near zero" means the interval covers 0. Malformed passes have no confidence, so they are left out of the risk-coverage curve and calibration error and counted beside them. An arm that holds by door alone reached a hold gap of +0.11 in the dry run, so a small positive gap is not evidence of calibration.
5. **Citations (record arms).** Share of decisions that cite a record entry; share of cites whose record entry predates the item, by the answered_at the record store holds (the parser already refuses cites outside the block, so this checks the block builder); and, on a random 100 decided items per record cell, whether a cited entry supports the decision, read blind by gpt-6.1-sol through judge-run. This is Spawn's "decides and says where".
6. **Secondaries.** Unweighted and N-only accuracy; every reading split by kind (G, Q) and by door; the C and C+ reading; the derived-item reading; the default-hidden reading; cost per item in dollars. Every subset reading (derived items, default hidden, each split) recomputes the BA weights inside the subset.

### 8. Statistics and the claims allowed

The scorer is the stats kit at main ad594d4: evaluateFamily in src/runner/stats/gates.ts with clusteredPairedDelta (cluster bootstrap, exact or Monte Carlo cluster sign-flip, Holm). lanes/taste-replay/score.ts writes one row per item per arm and model and encodes each arm pair as its own metric, so one family call holds every comparison and Holm runs across them: the A rows carry the reference arm's value under the metric name, the B rows the candidate's. Clusters are captain plus Pacific date of asked_at. Items with no truth option carry no BA value and drop out of BA comparisons only. Metric names carry no dots (rows.ts reads a dot as a path), so they read ba_GR_NR, cost_GR_NR, ba_NR_NN, cost_NR_AR and ba_GN_NN. Alpha 0.05, 10,000 draws, seed 85, at least 10 clusters, superiority gates with a minimum effect of 0.03 on both metrics (a pass needs the Holm-adjusted sign-flip p at or below 0.05 and the point estimate at or past 0.03).

**Primary family (Opus 5.5, default shown, verbatim G and Q items), 8 comparisons, Holm across all 8:**

| # | Comparison | Metric | Direction |
|---|---|---|---|
| P1 | GR vs NR | BA | GR higher |
| P2 | GR vs NR | BA | GR lower |
| P3 | GR vs NR | cost | GR lower |
| P4 | GR vs NR | cost | GR higher |
| P5 | NR vs NN | BA | NR higher |
| P6 | NR vs AR | cost | NR lower |
| P7 | GN vs NN | BA | GN higher |
| P8 | GN vs NN | BA | GN lower |

Both directions of each gstack comparison sit in the family, so gstack can lose. Claims read each comparison's own status and never the family verdict: a clear win makes its mirror comparison read fail, so the family verdict reads fail whenever anything wins (the dry run shows P1 pass, P2 fail, verdict fail). **Secondary families:** the same 8 with particle-1 cells (r1-secondary.json) and with DeepSeek V4.1 Flash cells (r1-deepseek.json), each with its own Holm. The scorer blocks a whole family when any cell is short of an item (12 missing items were enough in the dry run), and the primary family's output does not change. So when a particle-1 cell is short, the secondary family is rescored on the items every particle-1 cell holds, under its own file r1-secondary-derived.json, labelled exploratory, with the missing count; if particle-1 was dropped by the pilot rule, it is reported as dropped. Everything else is exploratory, with intervals and unadjusted p-values.

**Claims.**
- "gstack's auto-decide agrees with Garry more than a plain model given the same record" only when P1 passes and P4 does not, on verbatim asked items. Stated with the delta, its interval and the cost reading beside it.
- "gstack's auto-decide agrees with Garry less" when P2 passes. Reported plainly.
- "Garry's record helps a plain model apply his decisions" when P5 passes.
- "A record judge costs less than always taking the recommendation" when P6 passes.
- Otherwise "not distinguished", with the minimum detectable difference from the power table.
- Ceiling: N accuracy above 0.85 for NR means no claim, and the lane needs harder items. Floor: if every arm's N accuracy is at or below 0.2, the round reports that no arm predicts Garry's overrides, which is itself the main GST-537 finding.
- Confirmatory or exploratory: R1 is confirmatory only if the labelled census gives at least 100 scored verbatim N items among G and Q items and B4's power simulation, rerun at the labelled counts and clusters with variance taken from the pilot, gives P1 at least 80% power at a true BA difference of 0.08. Otherwise every R1 reading is exploratory and R2 is the confirmatory round. In the dry run, 60 N items gave 59.5% power at 0.08, 100 gave 80.0% and 135 gave 86.5% (section 13). The census suggests about 40 to 60 such items in R1, so R1 is expected to be exploratory and R2 to carry the confirmatory claim.
- Not claimed: anything about Garry's taste outside these Captain threads; parity of particle-1 (that needs its own margin and non-inferiority test); that our numbers match or beat Spawn's.

### 9. Models

Opus 5.5 runs every model arm. particle-1 (particle-ai/particle-1 on OpenRouter, $0.10 in and $1 out per million tokens) is the fixed rung in every arm, with its own family. DeepSeek V4.1 Flash (deepseek/deepseek-v4.1-flash-1017, $0.30 in and $1.20 out at DeepSeek's own endpoint, an upper bound) runs every model arm beside particle-1, as the crew rule keeps particle-1's base beside it (gate E1). Fable 5.1 is left out of R1 (gate D1); R2 may add it, with Garry's approval, if a record judge beats the baselines in R1. Sonnet 5.5, Haiku 5.5 and the open-weight slots are dropped from R1 for cost and sequence, as the planning lane did: they join a later round once an arm shows a difference on Opus or particle-1, with the OpenRouter programming ranking re-read at that prereg. The ladder reading for particle-1 is descriptive: gap closed = (p1-GR minus p1-NN) over (opus-GR minus p1-NN).

### 10. Cost, with sources

| Item | Figure | Source |
|---|---|---|
| Opus 5.5 | $4 in, $20 out per million tokens | src/runner/pricing/prices.ts |
| DeepSeek V4.1 Flash | $0.30 in, $1.20 out | prices.ts |
| particle-1 | $0.10 in, $1 out | prices.ts |
| Record-arm request | about 12k input (instruction 0.5k, gstack block 1k, record 4k, packet 2k, slack), 2.4k output with reasoning | estimate, to be replaced by the pilot |
| No-record request | about 3k input, 2.4k output | estimate |
| Judge call | $0.02 to $0.05 | GEVA-65 rerun results; GSTA-30 |
| Capy model use | about $0.6 per million tokens on the thread counter | the Captain's /ship measurement (20M tokens, $11.50) |

R1 at an estimated 400 scored items:

| Cell | Requests | Estimate | Worst case (4k output, 16k input) |
|---|---|---|---|
| Opus NR, GR, 3 passes | 2,400 | $240 | $360 |
| Opus NN, GN, 3 passes | 2,400 | $145 | $230 |
| Opus default hidden, NR and GR, 1 pass | 600 | $60 | $90 |
| particle-1, four arms, 3 passes | 4,800 | $19 | $27 |
| DeepSeek V4.1 Flash, four arms, 3 passes | 4,800 | $31 | $45 |
| Citation judge | 600 | $18 | $30 |
| Pilot (20 items, every cell, 1 pass) | about 200 | $12 | $18 |
| **Total** | | **about $525** | about $870; the **$750** cap binds first |

Labelling and rewriting run as Capy subagents: about 25M tokens to label, 5M to audit, 10M to rewrite TRUT-1 and FOUN-1 items, so about 40M tokens, about $25. R2 at an estimated 250 items with G537 added: about $450, cap $600. The whole lane projects to about $1,100 to $1,400 across its threads, each far under $5,000.

### 11. Cap, stops and start rule

- Each round runs only after its prereg PR merges and the Captain records its cap (org R42). Preregistration and results never share a PR.
- Ledger cap stop: the run ends incomplete and is never retried to change a verdict; a rerun needs a named repair.
- Pilot (20 burn-in items, never scored, every cell, 1 pass), read before the full run: (a) more than 10% malformed passes in a cell means the parser or prompt is repaired before the prereg freezes, and for particle-1 the frozen rung drop removes its cells through a derived family file; (b) every arm taking the default on more than 95% of pilot items is recorded for R2's condition choice (Big decision 5); (c) the measured cost per request re-projects the run, and a projection above the cap means a smaller sample of D items (N, H and S are never cut), not a raised cap, unless the Captain raises it.
- Any pilot-driven change to the items, primary outcome or size merges as an amended prereg before full-run requests.

### 12. Build order, keyless first, and dates

Every step before the pilot is keyless. Each code step is a PR through the Captain's queue with a /ship receipt.

1. **B1 extraction and custody (one thread).** An execute program pages the ten transcripts to raw JSONL on the build machine; the labeller, auditor and third reader produce items with the frozen brief; the rewriter derives TRUT-1 and FOUN-1 items; the 8-word check and echo check pass; the bundle is sealed and the plaintext deleted. Commit: lanes/taste-replay/label/brief.md and the rewrite brief (no item text), and a board post with counts by kind, stratum, door, captain and week, kappa, drop counts and digests.
2. **B2 lane code.** lanes/taste-replay/: item.schema.json; packet.ts (packet, record block, BM25 retrieval with the time filter, default shown and hidden); templates.ts (plain instruction, gstack block extraction by heading at a pin, output spec), sha-pinned; run.ts on judge-run's proxy, ledger and retry; parse.ts; cli.ts with a "taste" row in src/cli.ts; E_TASTE_* codes in src/errors/codes.ts. Tests: a record arm's block never holds an entry at or after the item's asked_at; ids are random; the default-hidden packet names no recommendation; malformed replies retry once, then score as hold.
3. **B3 scorer.** lanes/taste-replay/score.ts (rows, weights, the cost matrix, the arm-pair metric encoding, calibration, rates, citations, the grid) and lanes/taste-replay/comparisons/r1-primary.json and r1-secondary.json. A golden test reproduces the plan's dry run (section 13) number for number on the same synthetic data.
4. **B4 dry run on the real code.** Rerun section 13 through B2 and B3 with fake replies, every frozen rule and fallback included, before the prereg.
5. **B5 R1 prereg PR,** then the cap, the pilot, the full run, scoring, and the results PR (aggregates only, echo-checked).
6. **R2.** When GST-537 has shipped, the R2 prereg pins it and starts accrual; at the stop rule, label, seal, run and report the same way.

Dates: plan merged 2026-11-01; B1 and B2 by 2026-11-03; B3 and B4 by 2026-11-04; R1 prereg 2026-11-05; first number 2026-11-07. R2 depends on GST-537; with a 21-day accrual cap its number comes by 2026-11-30 at the latest. Dates slip with labelling disagreements, not with spend.

### 13. Dry run of the frozen rules (done before review)

A subagent built a synthetic R1 set shaped like the census estimate (seed 85: 400 scored items, D 190, N 135, H 40, S 35, 85 captain-date clusters, 48 one-way, 168 derived, 2 to 4 options) with simulated replies for every arm on Opus and particle-1, plus sanity arms that always override (FLAG), pick at random (RAND) or fail every pass (BROKEN). It ran every frozen rule through the pinned scorer, evaluateFamily at main ad594d4, unmodified, keyless. The report is attached as dryrun.md with each command and its verbatim lines; everything is synthetic and no paid call was made.

| Rule | Result | What this plan therefore states |
|---|---|---|
| Primary family, both directions, Holm over 8 | Pass | Claims read each comparison's status, never the family verdict (section 8). Metric names carry no dots. |
| Secondary family (particle-1) | Pass | As the primary. |
| Bounds by construction | Pass | BA: always-rec 0.500, FLAG 0.356, RAND 0.393 (1/k is 0.394). NR against FLAG passes, FLAG against NR fails. |
| Cost matrix and grid | Change | The grid re-prices recorded actions; the oracle is the cheapest action per cell; hold-all and decide-all are reported beside every cost reading, because always-rec (1.37) cost more than hold-all (1.00) (section 7). |
| Items with no truth option | Pass, with wording | An absent BA field is dropped from BA comparisons only (325 paired, 75 excluded; cost pairs all 400). Never 0, never exclude_when, never an error field (sections 2, 6). |
| Malformed passes (BROKEN) | Pass | 100% malformed scores BA 0 and cost 1; P1 fails and P2 passes for it. |
| Fewer than 10 clusters | Pass | 8 clusters gives inconclusive even at Holm p 0.031. |
| Identical arms | Pass | Inconclusive with the scorer's no-variation reason. |
| A particle-1 cell short of items | Change | The secondary family blocks whole while the primary is unchanged; section 8 now rescores particle-1 on the shared items under a derived file, as exploratory. |
| Calibration | Change | The hold gap is balanced within D and N with an interval; "near zero" means the interval covers 0; malformed passes stay out of the curve (section 7). |
| Verbatim-only reading | Change | Weights are recomputed inside every subset (+0.0127 against +0.0145 with the round's weights); "same sign" means the point estimate. The Fable sample it named has since left R1 (gate D1). |
| Power | Change | Below. |

Power for P1, 200 simulated rounds per cell, each the full 8-comparison family with Holm and 2,000 draws, D fixed at 190, about 85 clusters:

| N items | True BA difference 0.04 | 0.06 | 0.08 | 0.10 | Smallest difference at 80% power |
|---|---|---|---|---|---|
| 60 | 17.5% | 36.5% | 59.5% | 83.0% | 0.097 |
| 100 | 23.5% | 46.0% | 80.0% | 92.5% | 0.080 |
| 135 | 27.5% | 62.0% | 86.5% | 97.0% | 0.075 |
| 200 | 27.0% | 71.0% | 94.5% | 99.5% | 0.068 |

So the confirmatory floor is 100 N items, not the 60 this plan first wrote, and B4 reruns the simulation at the labelled counts with the pilot's variance. A true difference of 0.04 (8 points on overrides) passes only 18% to 28% of the time at any size here, partly because a pass also needs the point estimate to reach 0.03; in the dry run's own round the estimate came out at 0.0299 and did not pass. These figures rest on assumed variance components, which is why B4 reruns them.

### 14. What it means for GST-537

GST-537 will take these decisions for real, so each R1 outcome maps to a design choice, which the Captain passes to GStack Minder as an aggregate memo, not as gstack changes from this lane:

- **GR against NR.** If gstack's rules add nothing once the record is present, GST-537 should load Garry's record (retrieval with cites) rather than more principles. If GR loses, the six principles pull decisions away from Garry, most likely through "bias toward action" and "boil lakes" on spend and scope questions; the per-kind and per-door splits say where.
- **GN against NN.** Whether gstack's own rules, which Garry wrote, already carry his taste without his record.
- **Every arm against always-rec on cost.** If no judge beats taking the recommendation, GST-537 should take the recommendation and hold only one-way doors by a hard-coded list, as Spawn does for irreversible actions with "a small set of dumb, hard-coded gates".
- **Calibration.** If arms do not hold where they would be wrong (hold gap near zero), GST-537 must not choose what to hold by its own confidence; it should hold by door category and by the absence of a cited precedent.
- **Cites.** If record arms decide without a supporting cite, GST-537 should require one to decide, which is Spawn's "says where".
- **After launch.** Once GST-537 decides on its own, Garry sees only what it holds, so its errors become invisible. It should log every automatic decision with its cite, count Garry's later reversals, and send a random 10% of decidable items to Garry anyway so agreement stays measurable. Garry approved the shadow mode and the 10% audit at the gate (B1), and the Captain has sent GStack Minder the ask.

### 15. Reuse

| Piece | From | Use here |
|---|---|---|
| Comparison family, cluster bootstrap and sign-flip, Holm | src/runner/stats (U2) | the scorer, unchanged |
| Direct API runner: request builders, in-process metering proxy, ledger lease, bounded retry, --dry-run | judge-run.ts (#96, #97) and src/adapters/judge.ts | run.ts |
| Ledger, metering proxy, pricing | U3, U4, src/runner/pricing | every paid call |
| Interim procedural custody, age bundle, echo check | the 2026-10-31 ruling, GEVA-82 (#99) | the item set, record corpus and raw outputs |
| Random item ids | the #99 fix (GST-618) | item ids |
| Sha-pinned frozen templates | told.ts (#93) | the instruction, gstack block and output spec |
| Keyless dry run before review | the #95 lesson, the planning lane's dry run (#98) | section 13 and B4 |
| Derived-only rule for TRUT-1 and FOUN-1 | CREW.md, 2026-10-27 | their items |

Lane A, Lane B, the review-noloss scorer and item J's seeded-mistake tasks (#87) are not used: they score code, plans or TB2 tasks, and this lane's outcome is a pick, so the generic stats kit fits where noloss's blocker matching does not.

### 16. Risks

- The labels are interpretations of Garry's free-form words. The cross-family audit, kappa and the drop rule bound this; a low kappa on N items flips the weighting (Big decision 2).
- The record is 17 days of one person, against Spawn's two years of a company. Small N items make R1 likely exploratory; R2 adds items.
- The default-shown condition may anchor every arm on the default. The hidden-default reading measures it, and pilot stop (b) records it.
- Derived rewrites may lose the taste signal. The verbatim-only sign rule and the per-derived split catch it.
- Retrieval may miss the precedent that matters, which would understate the record arms. The citation reading shows how often the right precedent was present; a later round may test a larger block.
- Garry may change his mind over time, so an old precedent can be wrong today. That is part of what is measured, and the per-week split shows drift.
- Garry knowing his decisions are replayed could change how he answers in R2; nothing about the lane is sent to his Captains' asks, and the R2 items are only scored after accrual.

### 17. Verification

The lane is ready for its first paid run when B1 to B3 are merged with keyless tests; the B4 dry run shows every frozen rule and fallback running through the pinned scorer; the custody bundle's digests, counts and kappa are committed; the prereg names the family files, the gstack pin and block sha256, the template sha256s, the bundle digest, the models and settings, the cap, the pilot stops and section 8's claims; and the Captain has recorded the cap.

### 18. Needs

- The Captain's word at this plan's gate.
- For R2: GST-537's shadow mode from GStack Minder (asked by the Captain, 2026-10-31).
- For R1: a cap of $750 after the prereg merges. For R2: a cap of $600 after its prereg.
- No new credentials: the Anthropic, OpenAI and OpenRouter keys are already on the rig.

## Review record

The run's public export is review-record.md in this bundle: both phases, both voices, every finding and both gates, with em dashes replaced by hyphens. The keyless dry run of every frozen scoring rule through the pinned scorer is dryrun.md.
