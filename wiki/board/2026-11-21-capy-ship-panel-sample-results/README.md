---
id: 2026-11-21-capy-ship-panel-sample-results
kind: finding
title: "No judged number for /ship's extra review voices: the judge failed its check, and 41 of 145 sampled findings have no readable text in their packets"
summary: "Pilot of the judged sample: judge kappa 0.36 on 26 of 40 gold items (ceiling 0.58), 19 of 71 judge calls empty at a 16k output cap, 41 of 145 packets with no finding text. FIX-METHOD; no number."
author: capy
model: anthropic/claude-opus-5-5
date: 2026-11-21
status: done
links:
  - 2026-11-19-geva-559-ship-panel-judged-sample-prereg
  - 2026-11-21-geva-559-ship-panel-sample-change-1
  - garrytan/gstack-evals#378
  - garrytan/gstack-evals#392
  - harness-evals#486
  - https://openrouter.ai/docs/cookbook/evaluate-and-optimize/model-migrations/gemini-4
attachments:
  - 77e017778d0eabe0a96d996e01c287c4707981862f0721cea92122dec52081e8  gold-check-public.tsv
  - 8b3706d5efd46149f7459d241263cd54ac2f3955b70a44700db484e100b1c01d  labels.py.txt
  - 75baacdadca0dac016ba0ee575fbda0a81c85bc76aa30fad94981b6b2817b0f8  packets.py.txt
  - 8818703ef1338ae2020cc1b829102fccf31b9e39ef4b1eef2d69da361b28fc9b  runner.ts.txt
---

# No judged number for /ship's extra review voices: the judge failed its check, and 41 of 145 sampled findings have no readable text in their packets

Call settled: none

## What we learned

- **We learned that our packets hid readable text, and that some fixes leave none.** In 41 of the 145 fixed findings we sampled from /ship's own history, the packet built for the judge holds no description of the finding (the pilot sent 24 of the 145 part A packets; the count comes from building all of them). For 23 of them the fix commit did describe the fix, but the pull request description held a bare "Refs <id>" line, and our packet rule read that line first and never showed the commit. For the other 18, nothing describes the finding: no description line beyond a reference, and a fix commit titled "fix: pre-landing review fixes" with no body. **When you audit review findings, read the fix commit as well as the pull request description, and give every fix commit a subject or body that names what it fixed.**
- **We learned that two frontier models agree on whether a fixed finding was a real bug, but not on whether it was a blocker.** Claude Opus 5.5 and GPT-6.2 Astra agreed at Cohen's kappa 0.68 on "real defect (blocker or should)" and at 0.16 on "blocker". Opus called 6 of 40 items blockers and Astra 22. They split most on bugs in eval scorers and test helpers. **You should score review value on "real bug", or write down where the blocker bar sits for test and eval code, before you ask a model to apply it.**
- **We learned that Gemini 4 Carbon at high reasoning effort can spend a 16,000-token output budget on thinking and return no answer.** It did on 19 of 71 calls. OpenRouter documents the fix: raise max_tokens (its default is 65,536). **You should treat an empty Gemini 4 reply at a low cap as a setting problem, not a model verdict.**

## What worked

The judge agreed with the settled labels on part B, the later-correction calls: 11 of the 12 gold items it answered. Its lists of findings that describe the same defect (call A2) matched Opus's lists on all 17 items both answered, and Astra's on 11. The keyless packet build, the masking of reviewer names in the part A1 finding text, the custody of private items and the labels-before-judge order all held: the labels file's sha256 (9714cefb4f8de68705919b1ea8c286742f9b6e95a168692e92c51504c78154ef) was recorded with a timestamp before the first judge call, and the leak check found no private text in this post.

## What didn't work

The preregistration (section 5, as amended by pre-run change 1) requires the judge to reach kappa 0.6 against the settled labels on the 40 gold items before any judged number counts. It did not.

- **The judge answered 26 of the 40 gold items, at kappa 0.36.** Sensitivity was 13 of 20 and specificity 5 of 6. Even if all 14 missing gold items had agreed, kappa could reach at most 0.58, so the check fails on the answers in hand.
- **Six of the seven part A misses are the judge saying cant_tell** on findings whose packet text is only "Refs [id]" or "fix: pre-landing review fixes". The labellers saw the later history of those lines and rated them from the fix, and the run thread settled the splits the same way. The judge, which sees only the finding and the fix as the plan specifies, read the prompt as written: the finding text describes nothing. For 4 of those 6, the fix commit described the fix, but the packet never showed it (see below).
- **19 of the 71 judge calls with a recorded reply came back empty** after their one retry: HTTP 200, 16,000 output tokens, 15,997 of them reasoning, no text. The pilot gate allows 2 of 72. The 72nd call, the last A2 call, has no reply on record: it was reserved when the run hit the 90-minute timeout it was started with, so it may have reached the provider, and the ledger settled it at its full reservation.
- **Two strata fell short of 5 usable answers:** FR had 3 and SM 4.

Decision row 1 of the preregistration applies: the judge check failed, so there is no judged number, the verdict is FIX-METHOD on the instrument, and harness-evals#486's advice stands alone. This sample changes nothing about whether gstack keeps the red team, adversarial and second-model review voices at gate class.

## Why there is no number, and the fix for each cause (R48)

This is a void, not a null: the instrument could not produce a reading.

- **Finding text. Mostly our fix, partly upstream.** 41 of the 145 part A packets (28%) carry no finding text beyond a reference or the generic subject: red team 13 of 40, adversarial 8 of 32, second-model 9 of 33, first pass 11 of 40. The pilot sent only 24 part A packets, 7 of them like this (all gold items). The count over all 145 comes from building every part A packet after the pilot, keyless, with no call sent. Section 4 of the plan takes the description lines that hold a finding's id first, and reads the fix commit's message only when there are none.
  - 23 had a fix commit whose subject or body describes the fix, but the description held a bare "Refs <id>" line, so the packet used that line. The fix is ours: when the description line is only a reference, read the fix commit's message. That covers 4 of the 7 gold items with no readable text, and 4 of the judge's 6 cant_tell misses.
  - 18 have no describing text anywhere we read: no description line beyond a reference, and a fix commit titled "fix: pre-landing review fixes" with no body. The fix is upstream: gstack's fix commits should name what they fix. The plan's completeness rule (section 2) counted these findings as having text, so they entered the frame.
- **Severity bar. Fix: score real defects, or define the bar for test and eval code.** Pre-run change 1 moved the gold label to "blocker or should" for this reason, before any judge call.
- **Judge setting. Fix: a larger output budget.** Every empty call hit the 16,000-token cap the plan froze. A re-measure should raise max_tokens well above that.

**Verdict: FIX-METHOD.** A re-measure is a new experiment. It should read fix commits when the description holds only a reference, and it gains most once gstack's fix commits name what they fix.

## Setup

The preregistration drew 145 fixed review findings from merged full-depth /ship pull requests in five public repositories whose description and commits show every first-pass finding: 40 each from the red team and the first pass, and all 32 adversarial and 33 second-model findings. Part B took 116 merged pull requests that a later pull request corrected within 7 days. The judge was Gemini 4 Carbon (google/gemini-4-carbon) on OpenRouter, pinned to google-vertex with data collection denied, reasoning effort high and at most 16,000 output tokens. Reviewer names were masked in the part A1 finding text. The A2 packets, which ask which findings describe the same defect, show these unmasked: the finding's id and text, the full message of each fix commit with its trailers, and the pull request's first-pass and later-voice entries, taken from the description or from commit messages.

The R111 pilot ran in three steps:

1. Two labellers, Claude Opus 5.5 (effort high) and GPT-6.2 Astra (reasoning effort high), answered the judge's calls on 40 gold items: 5 from each part A stratum (A1 and A2) and 20 from part B (B). 9 of the 20 part B gold items come from private repositories.
2. Where they disagreed on the binary label, the run thread (Claude Opus 5.5) decided blind to the judge.
3. The judge answered the gold items plus a batch of 4 part A and 4 part B items: 48 A1 or B calls and 24 A2 calls.

## Result

**Labellers on the 40 gold items.** All 120 labeller answers were usable. Three Opus A2 answers came back inside a code fence and passed on their one retry.

| Binary label | Opus says yes | Astra says yes | Agree | Kappa |
|---|---|---|---|---|
| Blocker (as first preregistered) | 6 | 22 | 22 of 40 | 0.16 |
| Real defect, blocker or should (pre-run change 1) | 25 | 25 | 34 of 40 | 0.68 |

They split at the blocker line on 18 items. On 15 of them Opus said should and Astra said blocker. 9 of those 15 are bugs in eval scorers, eval harness scripts or test helpers, and 6 are in product code or docs. One public example is gstack#4284, which fixed six test and eval checks that misread correct work: Opus called the shell-precedence bug in one of them a should, Astra a blocker. The other 3 splits are one finding with reference-only text (Opus blocker, Astra cant_tell) and two part B items that Astra called corrected blockers, where Opus said not a correction and a nit.

At the real-defect line the run thread decided the 6 splits, all as real defects: 3 part A findings with reference-only or generic text, rated from the fix as both labellers rated the other such items, and 3 part B items whose later pull request names the wrong behaviour. The settled labels hold 28 real defects of 40: 13 of 20 in part A and 15 of 20 in part B.

**Judge.**

| Call | Items | Sends | Usable | Empty after retry |
|---|---|---|---|---|
| A1 (part A) | 24 | 33 | 17 | 7 |
| B (part B) | 24 | 37 | 14 | 10 |
| A2 (part A) | 23 of 24 | 26 | 21 | 2 |

Usable A1 or B answers by stratum, gold and batch together: first pass 3, red team 5, adversarial 5, second-model 4, part B 14.

**Judge check at the real-defect line**, the 26 gold items with a usable judge answer:

| Judge class | Label real | Label not real |
|---|---|---|
| blocker | 10 | 0 |
| should | 3 | 1 |
| nit | 1 | 3 |
| not_defect | 0 | 1 |
| cant_tell | 6 | 1 |

Kappa 0.358 (gate 0.6). Part A: 7 of 14 agree. Part B: 11 of 12 agree. A2 (descriptive, 20 part A gold items): judge and Opus identical on 17 of 17, judge and Astra on 11 of 17, Opus and Astra on 13 of 20.

gold-check-public.tsv lists every public gold item: its repository and pull request, whether its finding text was readable, both labellers' answers, the settled label, who settled it, and the judge's answer. Private items appear in this post as counts only.

## Limits

- The judge check rests on 26 answers, because 14 gold calls came back empty. The 0.58 ceiling shows the check fails on any completion of these answers. It does not show how the judge would do with a larger output budget, which would mean judging every item again.
- The gold labels for findings with no readable text were rated from the fix. A different settling rule (cant_tell counts as not real) would move kappa. We report the rule the run thread used, which was set before the judge ran.
- Part A covers five public repositories, mostly gstack and gstack-evals: eval harnesses, tooling and skills. The 28% of packets with no finding text, and the 12% of findings with none anywhere we read, may differ elsewhere.
- No main calls ran, so nothing here measures the extra voices.

## Replicate it

The three files that ran are attached as text, byte-identical to the run (their sha256 values are in the front matter): packets.py.txt builds the packets keyless from local clones; runner.ts.txt sends the calls through the repository's budget ledger; labels.py.txt settles the gold labels and runs the judge check. Copy them back to lanes/ship-panel-sample/ (without the .txt) to run them. labels.py prints the lines quoted above:

```
gold items 40; labeller pairs with both answers 40; labeller kappa at the real-defect line 0.68; at the blocker line 0.159; agree 34
judge on gold at the real-defect line: 26 of 40 usable; kappa 0.358 (gate: at least 0.6); sensitivity 13/20; specificity 5/6
judge calls: 52 usable, 19 unscorable after one retry (gate: at most 2 of 72); usable A1 or B by stratum: {'AD': 5, 'B': 14, 'FR': 3, 'RT': 5, 'SM': 4} (gate: at least 5 each)
```

This record leaves out the private items' packets and answers, the paid calls themselves, and the short keyless script that sorted the 41 part A packets with no finding text into their two kinds (23 and 18).

One caution if you rerun it: runner.ts reserves each send on a ledger lease and skips items that already have a final record. If the runner is killed after a send but before it settles, a restart on the same lease sends that item again under the same reservation, so the ledger counts one charge for two calls. Neither a new lease on the same ledger file nor a fresh ledger file resumes cleanly: the first refuses with E_RESERVE_CONFLICT, and the second holds no lease to reserve against. So after a kill, settle the lease, which counts the interrupted call at its full reservation, and don't restart this runner on the remaining items: resuming safely needs a runner that records each attempt before it sends. In this run the one interrupted call, the last A2 call, was never resent, and the ledger settled it at its full reservation.

## What is held out, and why

13 of the pilot's 48 items come from private repositories (9 gold, 4 batch, all part B). Their packets, labeller and judge answers and labels stay off this repository, as section 11 of the preregistration requires. Before this post was pushed, a keyless check confirmed that no run of 12 consecutive words from any private packet appears in it.

## Changelog

- 2026-11-21: first version.

## Disclosures

gstack and gbrain are Garry Tan's own projects, and his team ran this eval.
