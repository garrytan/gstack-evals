---
id: 2026-11-25-geva-592-judge-checks-tbv-eng-review-jev
kind: finding
title: "Gemini 4 Neon checked the trust-but-verify and eng-review judges, and one person checked two Jev routing label sets"
summary: "Gemini 4 Neon checked three judges: two pass, and TBV's Sol judge fails as frozen (0.52) but reads 0.774 after a rerun of empty replies. One person checked two Jev label sets."
author: GEVA-592
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-25
status: done
supersedes:
  - 2026-11-25-geva-592-neon-review-judge-checks
  - 2026-11-23-geva-401-tbv-held-out-results
  - 2026-11-11-geva-434-eng-review-intentions-stage-1-results
  - 2026-11-09-geva-421-jev-decision-routing
links:
  - wiki/board/2026-11-25-capy-unchecked-judge-corrections.md
  - README.md
  - docs/all-results.md
---

# Gemini 4 Neon checked the trust-but-verify and eng-review judges, and one person checked two Jev routing label sets

## Takeaways

- **We learned that two more judges agree with a third model.** The Opus 5.5 judge that scored trust-but-verify recall on the Sol and particle-1 arms agreed with Gemini 4 Neon at kappa 0.771 (95% interval 0.60 to 0.915). The GPT-6 Astra judge that graded Opus's lists in eng-review stage 1 agreed at kappa 0.90 (0.75 to 1.0). Their numbers now read **judge checked against Gemini 4 Neon, a third model, not against people**. Neon checked each judge on a sample of 40, smaller than eng-review's own planned check. It did not rescore any arm.
- **We learned that a judge check can fail because the checker ran out of room, not because the judge was wrong.** As frozen, the GPT-6.1 Sol judge that scored every Opus arm in trust-but-verify fails, at kappa 0.52 (0.362 to 0.697). Most of the gap came from 9 of its 40 packets where Neon returned no usable answer. After one rerun of those packets with more output room, a step decided after the fact, the judge reads kappa 0.774 (0.634 to 0.896). You should give a checking model the same output room the judge had before you freeze the check.
- **We learned what one person makes of two label sets in the Jev routing replay.** The labels behind relationship contradictions matched one person on all 40 items (kappa 1.0). The labels behind the recommendation judge scored kappa 0.619 (0.254 to 0.907) on 37 items, short of the 40-item minimum, so that number stays unchecked. One person is one person, so this is a small check.

Neon is a model. Agreement with Neon is not agreement with people, and a person sample could still move any of the Neon results here.

## What was checked

Garry ruled (R126) that for code checks Gemini 4 Neon, a model from a third lab, labels the items people would have labelled. No judge checked here is a Gemini model, and no system under test is one. Quality judgments stay unchecked: trust-but-verify's unsupported-claim count, eng-review's quality calls and day-one's "usable" calls.

The plan for each check was written before its first Neon call. Neon got exactly the request the judge got, with the same packet, and its reply was parsed by the lane's own rule. One retry on a failed call or a reply that did not parse, then "can't tell" for every item in that packet. Scoring: Cohen's kappa between Neon and the judge, with "can't tell" as a third category that can only disagree, a pass at kappa 0.6 or more (R78), and a 95% bootstrap interval (2,000 resamples, seed 20261125).

- **Trust-but-verify recall (held out).** Two checks, one per judge: 40 first-reply packets drawn at random from the held pass's packets each judge read as primary. The unit is each key fact's "in". Neon's output cap was the lane's 16,000 tokens.
- **Eng-review stage 1.** 40 cells drawn from Astra's production labels on Opus's lists, 20 Astra marked anticipated and 20 not, sent as the 20 check packets that hold them. The unit is "anticipated". Neon's output cap was 64,000 tokens, the cap the lane gave its own auditor.

## Results

| Check | Judge | Kappa (95% interval) | Agreement | Cells: both in, judge only, Neon only, both out | Neon "can't tell" | Result |
|---|---|---|---|---|---|---|
| Trust-but-verify recall | Claude Opus 5.5 (Sol and particle-1 arms) | 0.771 (0.60 to 0.915) | 0.91 over 134 facts | 28, 7, 1, 94 | 4 facts (1 packet) | pass |
| Trust-but-verify recall | GPT-6.1 Sol (Opus arms) | 0.52 (0.362 to 0.697) | 0.70 over 140 facts | 51, 1, 7, 47 | 34 facts (9 packets) | fail, as frozen |
| Eng-review stage 1 | GPT-6 Astra (Opus lists) | 0.90 (0.75 to 1.0) | 0.95 over 40 cells | 18, 2, 0, 20 | 0 | pass |

**The trust-but-verify fail, and the rerun.** 24 of the 94 trust-but-verify calls (80 packets plus 14 retries) used all 16,000 output tokens. On 8 Sol packets Neon returned an empty reply on both tries, and on one more it returned a reply whose block would not parse. Under the frozen rule all 9 count as "can't tell", and the judge fails. The eval's owner then ruled that an empty or unparseable reply is a failure of the call, not a label, and allowed one rerun of the 10 empty packets (9 Sol, 1 Opus) at 64,000 output tokens, one try, with the same prompt and no new packets. A dated change to the plan recorded this before the rerun. All 10 returned a parsed answer, finishing on their own at 13,721 to 23,421 output tokens. 8 of them needed more than 16,000. The other 2 finished under 16,000 this time, so their first empty replies were not only a matter of room.

| Check | Frozen reading | Completed reading, decided after the fact (rerun of 10 empty replies) |
|---|---|---|
| Trust-but-verify, Sol judge | kappa 0.52 (0.362 to 0.697), fail | kappa 0.774 (0.634 to 0.896), agreement 0.886 over 140 facts; cells 63, 1, 15, 61; no "can't tell"; pass |
| Trust-but-verify, Opus judge | kappa 0.771 (0.60 to 0.915), pass | kappa 0.821 (0.705 to 0.927), agreement 0.933; cells 29, 7, 2, 96; pass |

The frozen fail is the result of record. The completed reading is reported beside it, and the Sol judge's numbers carry both. In the completed reading Neon credits 15 facts the Sol judge did not, and the Sol judge credits 1 Neon did not, so where they differ the Sol judge is the stricter one.

**Eng-review.** 16 of the 40 cells are on real review lists, and most of the rest on anchor lists. On real lists alone kappa is 0.714, with 6 cells the judge marked anticipated. That figure describes the sample and is not a gate. The sample is balanced between the two labels, so its kappa describes a balanced set, not the pool of 403 cells, where Astra marked 78 anticipated. This check is the size R126 set, 40 items. It is smaller than the judge check the stage 1 plan froze for itself, 40 cells per class from at least 40 lists with anchor cells capped at a quarter of the weight. So it adds a third model's agreement on a small sample, mostly of anchor cells, and does not stand in for the plan's own check.

## One person's check of two Jev routing label sets

The Jev routing replay scored each arm against labels where Claude Opus 5.5 and GPT-6 Astra agreed. One person, hired through a labelling bounty and shown plain-English screens with no model labels, labelled 40 items from each of two of its decision points. Their return passed both attention screens and gave the same answer on both repeated screens.

| Decision point | Items | Kappa against the two-model label (95% interval) | Agreement | Against each model alone |
|---|---|---|---|---|
| gbrain relationship contradictions (can two listed roles both be true today) | 40 | 1.0 (1.0 to 1.0) | 40 of 40 | Opus 1.0, Astra 1.0 |
| gstack recommendation judge (does the reason have substance) | 37 with a two-model label | 0.619 (0.254 to 0.907) | 32 of 37 | Opus 0.571, Astra 0.521, each on 40 |

The recommendation sample took every item where either model said "no substance", so it is not the replay's mix. Its kappa clears 0.6, but on 37 items, under the 40-item minimum this replay's date sets (R78), with a lower bound of 0.254, and each model alone is below 0.6. So we do not count it as a pass.

## Every number this changes

| Post | Numbers as printed | Now reads |
|---|---|---|
| [Trust-but-verify held-out](2026-11-23-geva-401-tbv-held-out-results/README.md) | Every Sol and particle-1 row, among them Sol current minus none -7.9 [-11.7, -4.2], Sol principle minus current +6.6 [+3.6, +9.8], Sol's source rows (among them held A principle minus none +10.0 [+5.2, +14.5] and held B -10.6 [-16.5, -4.7]) and every particle-1 row | judge checked against Gemini 4 Neon, a third model, not against people |
| same | Every Opus row, the Capy layer rows included: the headline principle minus none +3.6 [-1.1, +8.4], current minus none -4.8 [-8.9, -0.6], principle minus current +8.4 [+5.0, +12.0], held A +7.6 and the other source rows | judge failed its frozen check against Gemini 4 Neon, a third model (kappa 0.52); after a rerun of 10 empty replies, decided after the fact, it reads kappa 0.774. Cite these rows with both readings |
| same | "More unsupported claims" and every unsupported-claim row | unchanged: one model's opinion, unchecked |
| [Eng-review intentions stage 1](2026-11-11-geva-434-eng-review-intentions-stage-1-results.md) | Opus A 0.087 (95% CI 0.007 to 0.191) and the FLOOR reading | judge checked against Gemini 4 Neon, a third model, not against people |
| same | Sol's and particle-1's A values | unchanged: descriptive, judges never checked |
| [Jev decision routing](../research/2026-11-09-geva-421-jev-decision-routing/README.md) | Relationship contradictions +16.5 [+9.4, +24.7] | labels checked against one person (kappa 1.0 on 40 items) |
| same | Recommendation judge +10.0 [+2.9, +18.6], and the two claims that count it ("matched or beat the cascade on 7 of 8" and "measurably beat today's model on 4") | unchanged: one model's opinion, unchecked (one person's check fell short, kappa 0.619 on 37 items) |

## The /review checks, restated

This post replaces the [first Neon post](2026-11-25-geva-592-neon-review-judge-checks.md), so its results are restated here, unchanged. R2's same-bug matching judge passed (kappa 0.95, 0.846 to 1.0), so R2's blocking recall, 26.2% against 3.6% (+22.6 [+11.0, +33.7]), reads judge checked against Gemini 4 Neon, a third model, not against people. R1's adjudication judge passed narrowly (kappa 0.65, 0.388 to 0.85), so R1's new-blocker and false-blocker numbers carry that label and should be treated as weak. R2's adjudication judge (kappa 0.0) and stacks round 1's (kappa 0.254) failed, so their new-blocker and false-blocker numbers stay withdrawn.

Two wording fixes to that post. First, it said each verdict rested on recall. R2's and R1's verdicts do, but stacks round 1's "couldn't test" rests on the procedure not running, not on recall. Either way, no verdict rests on a withdrawn row. Second, the line in [all results](../../docs/all-results.md) for the earlier correction said no number changed. That was true of that correction alone, and the line now says so.

## Day-one was not checked

Day-one's browser checker was not checked against Neon. It already failed two blind validations against one model's labels (kappa 0.444 and 0.419), so no category 2 number counts. A Neon check would need Neon to drive a browser on 24 hosted builds, and a pass would only open a counted result decided after the fact. "No category 2 number counts" stands.

## Why the verdicts stand

Trust-but-verify's headline verdict on Opus, not distinguished, rests on rows the Sol judge scored, which now carry both readings. A judge check changes how far to trust those rows, not the rows themselves, so the verdict stands with the same caveat. Eng-review's FLOOR rests on Opus A, whose judge passed this smaller check. The Jev replay's cost and speed figures need no judge and stand.

Every other row in [the correction](2026-11-25-capy-unchecked-judge-corrections.md) stands as it reads there.

## Cost

Neon's calls for these checks cost $25.03 on OpenRouter (google/gemini-4-neon at $3 in and $15 out per million tokens, prices as of 2026-11-25): $16.65 for the trust-but-verify checks, $2.88 for the rerun and $5.50 for eng-review. With the first Neon post's $6.78, that is $31.81 of a $150 cap. The person's label job cost $135.70 ($115 pay and a $20.70 fee).

## Limits

- Neon is a model, not a person, and one labeller is one person.
- Each check is 40 items, so the intervals are wide.
- The trust-but-verify rerun was decided after we saw the frozen result. It changed only the output cap, on only the packets that came back empty, once.
- Neon checked only the primary judge's labels. Second and third judges were not scored against it.

## Held-out material and replication

The packets, prompts, answer keys and the labeller's return stay outside this repo. Their files and the scoring code are in custody; the sha256 of each:

```
b020254223d9d779116de1fdad84915a55ede06debd7f04b9992d8849a273c9a  PLAN.md
d833d7dda1ce8dcf45638aec190eb251ca3794bf95a1abf0747b84c47f3c149b  tbv_neon.py
55573283bc2ace1e30e6cd021a36aa11d5a2e08b4993c2f9de04a283e55b2f23  tbv_rerun.py
a054d5270e4e5f402c611ed6a03745694ed63e8ce81b1fbee27240b4af5c61bb  er_neon.ts
656e1930420bd0222b1d20db85d5090faea3ec00135db80651ab16f798fef15d  scores-tbv.json
4239665d72ced5fa04df4729390850666e0381a6ebab76a8810f39075af8fc98  scores-tbv-rerun.json
40f94427703121105edecd1e0660347c3a6816204e9ec8d4bbd9a03e247e5923  scores-er.json
bf5e2f3794cb7dc0b5da25526726be16ee27b47987545ab195284cec2e2900fe  neon-tbv-held.ndjson.age
2c0444a014789af71f9a783a8ecda673e929bdcccbd2ef6d5aec414307d583a8  neon-tbv-held-rerun.ndjson.age
05d85c8044bba39cf6eb04eae00b148b2b0dfbd74ae0bdd57b2c0b2a644e92a5  neon-er-s1.tar.age
e5a43f3f29c4ba40b237984c4beaf73b32bdf29288adbf21e0e85f0174714de7  neon-ledger.jsonl
450f2556e3f25ca6fd098f86c6047d65e480f6aa592940ffed7a377c75989ee4  score_l1.py
df6ebd43d529324bd6793f9fe2e28ecbb3237765ad69703a69678146ce453607  scores-people-L1.json
```

## Changelog

- 2026-11-25: first version.
