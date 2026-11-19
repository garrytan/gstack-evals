---
id: 2026-11-19-geva-559-ship-panel-judged-sample-prereg
kind: plan
title: "Preregistration: do /ship's extra review voices find real defects the first pass misses? A judged sample of our own merged fixes"
summary: "A cross-family judge reads 160 fixed review findings (40 each from red team, adversarial, second-model and first pass) and 116 later corrections. Paid calls capped at $80; all-in $300."
author: GEVA-559
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-19
status: open
links:
  - https://github.com/garrytan/gstack/blob/5afef04e31de1cb30c727c7f827bdd729d04713e/docs/review-policy.md
  - https://github.com/garrytan/gstack/blob/5afef04e31de1cb30c727c7f827bdd729d04713e/review/sections/review-army.md
  - harness-evals#486
  - https://openrouter.ai/api/v1/models
attachments:
  - e76b94f5c9e14bb025e4c84f15cdf4a1af65c31bf1271d99b222eb49c5180869  draw.py
  - 0b7d0b0083d7bd51a2158cfb7dcf4bcff026fd5853f97ef41498122164a91a4c  draw.txt
  - 6314f08f95c50b88522d9a8123285f1970100bed2cacce1ecd4869e9989bd13f  power.py
  - 5e716bc0a47d8e948468f80b67e8390ec83a6f0e73c56714889ef4783b709b6a  power.txt
  - a4525ca6b7c31938a90288484840ca93672908d5053095c39690b8b464adc391  prompts.md
---

# Preregistration: do /ship's extra review voices find real defects the first pass misses?

## Approval

Garry said "do it" on 2026-11-19 to reading /ship's review panel from our own PR history, with a judged sample after Saturday at about $150 to $300, and a fair test only if the sample shows headroom. The keyless read is done (2,795 merged PRs with a /ship receipt across 12 repositories, in the Captain's drive). The Captain chose this sample (A1, 2026-11-19) and set four requirements, answered in sections 1, 6, 5 and 10. No paid call runs until this post merges, the Captain records each ledger item's cap (Agent notes), and 2026-11-21 06:00 UTC has passed. Nothing in this file changes after merge except its status.

## Plain summary

When /ship reviews a large or risky change, it runs a first pass (a lead review plus specialist readers such as testing and security) and three more voices: a red team, a native adversarial reader and a second-model review on another model family. gstack records which reader each fix answered, in a Review-Finding line on the merged commit. We take 40 fixed findings from each of the four sources on our five public repositories, from PRs whose description and commits show every finding the first pass raised, and a model from a third family (Gemini 4 Carbon) judges each one blind to who raised it: was it a real defect, and would it have failed a test, broken production or lost data? For each finding, it also checks whether another finding on the same PR describes the same defect: for the three extra voices, whether the first pass raised it, and for every source, whether it was fixed under more than one Review-Finding line, so each defect counts once. A real defect only an extra voice found is what the extra voices add.

What it decides: whether gstack should keep the three extra voices at gate class. Harness Evals' merged harness-evals#486 already recommends replacing /ship's panel with /review. /review runs the same three voices, so that switch doesn't settle whether they earn their place; this sample does, on the defects our own reviews actually fixed.

What it doesn't decide: how many defects any voice missed (unfixed and unraised defects are not read), how review compares with no review, or anything at light depth. A second part takes the 120 merged PRs that a later PR corrected within 7 days, sends 116 of them to the judge, and reports, by review depth, how many held a real defect a reviewer could have seen. That part is descriptive and changes nothing by itself.

## 1. Question and decision (R97)

**Question.** Of the distinct real blocking defects fixed during /ship review on full-depth PRs whose record shows every first-pass finding (section 2), what share did only an extra voice (red team, adversarial, second-model review) raise? Call it U.

**What #486 found, and what it leaves open.** On 54 outside bugs on Opus 5.5, /ship's panel as Harness Evals' rig ran it found fewer bugs than /review: 37.0% against 44.4% of blocking bugs (-7.4 points, -15.1 to 0.0) and 62.0% against 72.2% at any severity (-10.2, -20.4 to -0.9). Its map reads "replace the panel with /review". The panel cost $3.10 a review against /review's $4.13, so the switch raises review cost by about a third. In that rig the second-model review never ran (no bubblewrap in the trial image), and its preregistration planned 2.8 readers a unit for the panel against 6.6 for /review's Review Army. /review at gstack 5afef04e runs a red team (when the diff passes 200 lines or a specialist finds a CRITICAL), an always-on native adversarial pass and a second-model review when Codex is available. So #486 compared two ways of running many readers. It did not ask whether gate class needs the three extra voices at all, which is where the cost of the switch could be paid back.

**Decision map.** Advice to gstack's owner (through the Captain to GStack Minder), set beside #486's "replace the panel with /review". The rows are read in this order, and the first that applies is the reading.

| Reading | When | Advice |
|---|---|---|
| Judge check fails | Section 5's check fails or is void | No judged number. FIX-METHOD on the instrument. #486's map stands alone. |
| No blockers | E + D + A is 0: no stratum's contribution counts a blocker (section 7) | No reading of U. No change from this sample; #486's map stands alone. |
| Keep the extra voices | U is at least 30% and its 95% lower bound at least 15% | Keep red team, adversarial and second-model review running at gate class, whichever review /ship uses. If the panel is replaced by /review as #486 recommends, /review must run all three at gate class, including the red team on diffs under 200 lines and the second-model review as a required voice. A voice whose own count of only-it blockers has an interval that includes zero is named as not shown to carry its weight. Ask Harness Evals for the fair test #486 couldn't run: gate-class units with the second-model review running. |
| Backs #486 | U's 95% upper bound is under 15% | On our own merged fixes the extra voices rarely found a blocker the first pass missed. Replace the panel with /review as #486 says, and gstack may drop red team, adversarial and second-model review at gate class to pay for the switch. This is a CUT-CANDIDATE for those voices at gate class after one Why-null cycle (R48), and Garry hears it in plain words. |
| Inconclusive | Anything else | No change from this sample. Report U with its interval; #486's map stands alone. |

So a high U argues for keeping the extra voices at gate class and narrows #486's advice (switch, but keep the voices). A low U backs #486 and adds a cost cut it didn't test.

## 2. Part A: the frame and the draw

**Source.** gstack writes a trailer \`Review-Finding: <pass>/<reader>#<n> reader=<reader>\` for each fixed review finding, and it survives on the squash commit that lands the PR. draw.py reads every such trailer on a merged commit whose PR has a /ship receipt in the keyless read (local clones, no API calls): 1,576 findings in 327 PRs. On the 254 full-depth PRs with trailers, the trailer count equals the last receipt's fixed count on 163, exceeds it on 79 (earlier /ship runs add trailers) and falls short on 12.

**Why trailers and not the PR text.** The phase 1 proposal drew from voice names in PR descriptions. That trail names a voice for a fix on 217 of the 1,529 PRs with fixes, many of its lines are summaries or findings left unfixed, and a description is likelier to name a voice when an unusual one found something. Trailers are written by gstack for every fix, so they don't select.

**Strata.** Full depth only (full/gate and full/code), by the trailer's reader:

| Stratum | Readers | Public full-depth findings | On complete-list PRs (the frame) |
|---|---|---|---|
| RT red team | red-team | 326 | 108 |
| AD native adversarial | adversarial-native | 170 | 66 |
| SM second-model review | outside-voice, cross-family-audit, gpt-6.1-sol | 208 | 86 |
| FR first pass | core, specialist-batched, specialist, testing, security, state-machines, api-contract, claim-check | 225 | 68 |

Private repositories hold 152 more full-depth findings in these strata; part A doesn't draw them.

**Complete first-pass lists.** A2 can only say the first pass didn't raise a finding when the PR shows everything the first pass raised, so part A draws only from PRs whose list is complete: every finding id the PR shows has text, and the PR shows at least as many distinct ids as its /ship receipts counted. A PR shows an id when a trailer carries it or its description holds a token `[<pass>/]<reader>#<n>` whose reader is one the trailers use. An id has text when a description line holds it as a whole token, or one of the PR's own head commits (from refs/pull/<n>/head) carries it in a trailer. The count to meet is the fixed, noted and deferred counts summed over every /ship receipt in the description that records them; a PR with no such receipt is not complete. draw.py checks this keyless. Of the 215 public full-depth PRs with trailers, 76 (35%) have a complete list.

Left out: targeted readers (22 public full-depth findings, too few for a stratum), fix-check, QA, Capy's automatic review and six findings from one PR whose trailers carry no reader= field. One private repository that belongs to another team is never sent to any model (section 11); its findings are left out of the frame.

**Draw.** Seed 1149397022422259893 (the first 16 hex digits of sha256 of this post's id). Per stratum, the frame's findings sorted by item id (sha256 of repo, PR and finding id) and shuffled with the seed plus the stratum's index. The first 40 are the sample; the rest are the reserve, in order. Part A sends no private finding: 160 findings in 59 PRs. draw.txt lists every order of each stratum. Orders 1 to 5 are gold (section 5), order 6 is the pilot batch (section 10), orders 7 to 40 are main.

**Replacement.** An item is unscorable when its packet can't be built (no finding text, no fix diff) or the judge says the text is not one finding this change fixes (one_finding false). Its stratum's next reserve item takes its place, up to 20 a stratum; a stratum that needs more stops for the Captain. Every replacement and its reason is reported.

## 3. Part B: the corrected PRs

The 120 merged PRs with full 7-day exposure whose added lines a later PR changed within 7 days while naming them in a fix context (phase 1's correction-touch rows). By depth: full/gate 46, full/code 22, standard/code 7, light/code 17, light docs and tests 1, receipts older than depth recording 27; 56 public, 64 private. The 4 from the not-sent repository are counted and not read. Seeded order (seed plus 10): the first 20 sent items are gold, the next 4 private ones are the pilot batch, and the other 92 are main. draw.txt lists the public ones with their later PRs and a digest of the private ones.

## 4. Packets

Built keyless from local clones; a PR's head commits come from \`git fetch origin refs/pull/<n>/head\`, which is git, not the API.

**Call A1 (every part A item).** FINDING: every line of the PR description holding the finding id as a whole token, in order; if there is none, the message of each head commit whose trailers include the id, trailers removed. FIX: the diff of each head commit whose trailers include the id; if no head commit carries it, the squash commit's diff for the files the finding names, or the whole squash diff when it names none. TITLE: the PR title. In FINDING and commit messages, finding ids become [id], and reviewer words become [reviewer]: red team, adversarial, outside voice, second-model, cross-family, specialist, batched, the trailer reader names, Codex, Sol, GPT, Opus, Claude, Gemini and Astra, as whole words, case-insensitive. Three first-pass reader names are also ordinary words (core, testing and security); they are masked only as reader labels, in a finding id or after reader=, never in prose. FIX keeps at most 60,000 characters: files the finding names first, then the rest by lines changed, largest first, cut at a hunk boundary with the cut marked.

**Call A2 (every part A item).** The finding unmasked, the head commits that fix it with every trailer they carry, and two lists of the same PR's findings, both leaving out the item itself, each entry with its id, its text (description lines holding the id, else its fix commit's message) and whether it has a trailer. FIRST PASS: every first-pass finding (each trailer whose reader is in the FR stratum, and each id token in the description whose reader part is a first-pass reader). LATER VOICES: every red team, adversarial and second-model finding (each trailer whose reader is in the RT, AD or SM stratum, and each id token in the description whose reader part is one of those readers).

**Call B (part B items).** EARLIER: the earlier PR's added lines that the later PRs changed (phase 1's blame), with 20 lines of context at the earlier PR's merge, and its title. LATER: each later PR's hunks on those lines, its title and the first 2,000 characters of its description. FINDINGS: the earlier PR's review findings (trailers and description id tokens, all readers, with text and whether fixed), or "no list" when it shows none. At most 60,000 characters, cut as above.

**Labellers** see the same packets with the same masking, plus LATER for part A: each PR merged within 30 days of the item's PR that changed lines the FIX added or changed, with its title and those hunks, at most 12,000 characters; and for part B, the later PRs' full commit messages.

## 5. Judge and labels (R78)

**Judge.** Gemini 4 Carbon (google/gemini-4-carbon), through OpenRouter on google-vertex only, settings in prompts.md. The voices under study ran on Claude Opus 5.5 (first pass, red team, adversarial) and GPT-6.1 Sol (second-model review), so neither family can judge. OpenRouter's public model list, read 2026-11-19 06:48 UTC with no key, lists google/gemini-4-carbon at $2 per million input tokens and $10 per million output tokens with a 1,048,576-token context, the same prices gstack-evals already pins for it.

**Who labels and how (the Captain's third requirement).** The 40 gold items (20 from part A, 5 a stratum; 20 from part B) are labelled by two models that are not the judge: Claude Opus 5.5 and GPT-6.2 Astra. Each answers the judge's calls (A1 and A2 for the 20 part A gold items, or B) on the same packets plus LATER, blind to the reviewer in A1. Where they agree on the binary label (blocker or not; for part B, a corrected blocker or not), that is the label. Where they disagree, the run thread (a Claude Opus 5.5 thread) reads the packet and LATER and decides, blind to the judge, writing one line of reasoning per case. The settled labels go into one file whose sha256 is posted on GST-3147, with the time, before the first judge call on a gold item is sent.

**Check.** Cohen's kappa between the judge and the settled labels on the 40 gold items must be at least 0.6, with sensitivity, specificity and the five-class table printed beside it. If the two labellers agree below kappa 0.4 on the same binary label, the check is void. A2 agreement (judge against each labeller, and labeller against labeller) on the 20 part A gold items is printed as a count; it doesn't gate, because 20 items are too few for a kappa (R78 asks for 40). A failed or void check stops for the Captain. No other judge is tried under this post; a new judge needs a new post and its own check.

## 6. Scores

**A1.** blocker counts as a real blocking defect. should, nit, not_defect and cant_tell don't.

**First-pass trail (the Captain's second requirement).** Every sampled PR has a complete first-pass list (section 2), so for each RT, AD and SM item judged a blocker, A2's same_first gives one of:

- also, fixed: same_first names at least one first-pass finding with a trailer. The first pass found it, and it is counted once, under the first pass.
- also, listed: same_first names first-pass findings, none with a trailer (raised, not fixed under their own ids). The first pass found it; it adds to the distinct total, not to the extra voices.
- only: same_first is empty.

An item whose A2 answer is unscorable is unscorable, and the next reserve item takes its place (section 2).

**Same defect fixed more than once (k).** Each part A item gets k = 1 + the number of findings with a trailer in its own group that A2 names as the same defect. For an RT, AD or SM item the group is same_later; for an FR item it is same_first, which there lists the other first-pass findings with the same defect. k comes from the PR's full trail, sampled or not. Section 7 counts each item as 1/k wherever it counts, so a defect fixed under k trailers counts once in total.

## 7. Reading part A

Weights are the frame counts (RT 108, AD 66, SM 86, FR 68), so the reading covers full-depth fixes on complete-list PRs in the five public repositories. With n the scorable items of a stratum, and every count summing 1/k over its items (section 6), not 1 per item:

- E = sum over RT, AD and SM of weight x (blockers that are only) / n. This is the estimated number of distinct blockers only an extra voice raised.
- A = the same sum over blockers that are "also, listed".
- D = weight(FR) x (FR blockers) / n(FR).
- U = E / (E + D + A). When E + D + A is 0 there is no reading (section 1).

Interval: a bootstrap over the sampled PRs (all strata together, so findings from one PR stay together), 10,000 replicates, seed 559, percentile 95%; a replicate where E + D + A is 0 is skipped, and the number skipped is printed. power.py's estimate() and interval() are this code.

Printed with it:

- Per voice: E for that voice with its interval, and its blocker share with a Wilson interval.
- Per stratum: the share judged not_defect and nit, that is, fixes spent on findings that weren't defects or were minor.
- U with should counted as real (a real bug below the floor), as a secondary reading.
- Only-extra blockers per 100 complete-list PRs.
- Replacements, unscorable calls and provider safety stops, per stratum.

## 8. Reading part B (descriptive)

Per depth: PRs read, corrections judged real (corrects yes), real blockers, blockers a reviewer could have seen in the diff (visible yes), and of those, how many the PR's own review had raised and left unfixed (raised names a finding with no trailer). Each over the depth's 7-day population from the keyless read (full/gate 619, full/code 305, standard/code 114, light/code 488, light docs and tests 204, older receipts 370), with Wilson intervals, public and private pooled and public alone. full/gate minus light/code, with Newcombe's interval, is printed and labelled descriptive: the two depths differ in size and kind of change, and the 3.9-point detectable difference from the keyless read applies. Part B changes no advice by itself; a high share of visible blockers raised and left unfixed goes to GStack Minder as a note on the below-floor rule.

## 9. Power

power.py, output in power.txt: 200 simulated samples on the drawn sample's 59 PR clusters for each scenario, 1,000 bootstrap replicates each. Each simulated extra-voice blocker is "only" with the scenario's share and otherwise "also, fixed" or "also, listed" at even odds, as section 6 defines them on complete lists. The simulation sets k = 1 for every item; no simulated sample reaches the no-blockers row, and no bootstrap replicate is skipped. The 95% interval for U is about 6 to 7 points wide when U is near 3%, 19 to 23 points near 18%, and 22 to 27 points near 37%. A true U of 0.37 reads "keep" in 81% to 89% of samples, and 0.57 in 100%. A true U of 0.026 reads "backs #486" in 89% to 97%, and 0.064 in 54% to 66%. A true U near 0.18 reads inconclusive in 95% to 97%. So the sample separates "the extra voices carry a large share" from "almost none", and the space between reads inconclusive.

## 10. Pilot (R111)

Within a tenth of the cap, $30 of paid calls on its own ledger item:

1. Labels: both labellers on the 40 gold items, settled as in section 5, sha256 posted.
2. Judge: the 40 gold items, plus the pilot batch: order 6 of each part A stratum (4, public) and part B's 4 batch items (private). With A2 on every part A item, 48 A1 or B calls and 24 A2 calls.

It passes when:

- the judge check in section 5 passes;
- every call returns a usable answer after at most one retry, apart from at most 2 of the 72, and every stratum and part B has at least 5 usable judge answers;
- the 13 private part B items in the pilot (9 gold, 4 batch) are scored with their packets, calls and answers kept only under the Captain drive (section 11), and the leak check in section 11 passes on the pilot's public output;
- the measured cost per call projects the main run under its cap.

A failure stops for the Captain; a failing part is fixed by a dated change post or left out and reported as left out. Pilot answers count in the reading only if nothing in packets, prompts or settings changed after them; otherwise those items are judged again.

## 11. Order, privacy and stops

**Order.** After merge, the Captain's recorded caps and 2026-11-21 06:00 UTC: build every packet keyless; run the pilot; run the main calls; score with power.py's code; publish in a separate results post. The run thread writes the call runner before the pilot and records its sha256 in the run record before the first paid call; it changes no rule here and is published with the results.

**Privacy.** Private packets, calls, answers and labels stay on the run machine and under the Captain drive's handoffs/GEVA-559/phase2/private/, never in this repository. Public results carry private items as counts by depth only. Before the results are pushed, a keyless check confirms that no run of 12 consecutive words from any private packet appears in the change. The not-sent repository's items never leave the machine. Calls go through OpenRouter with data collection denied, and to Anthropic's and OpenAI's APIs for the labellers.

**Stops.** A ledger cap stop ends the item incomplete and is never rerun to change a reading. A projection past an item's cap stops before the call. An item that needs a 21st replacement stops for the Captain.

## 12. Limits

- Only fixed findings are read. A defect a voice raised and nobody fixed, or that nobody raised, is outside U.
- A trailer names the reader whose finding the fix answered, not every reader that raised it; A2 reads the PR's listed findings for the rest.
- Part A reads only PRs whose first-pass list is complete: 76 of the 215 public full-depth PRs with trailers (35%). The result holds for those PRs. Carrying it to the rest assumes they split between "only" and "also" the same way, and they may not: a PR that shows every finding may come from a more careful run, or from one that noted fewer findings.
- Two trailers of one defect are judged in separate A2 calls and can get different answers, one "only" and one "also"; nothing here reconciles them.
- The first pass and the red team run side by side in one step, so "only an extra voice raised it" is about who raised it, not about order.
- Part A covers five public repositories, mostly gstack and gstack-evals: eval harnesses, tooling and skills, not product code. Reviews ran on gstack 1.91 to 1.101 and on the models of their day.
- One judge family. A1 masks reviewer names, but a finding's style can still hint at its source.
- Part B's correction-touch is a proxy; in the keyless read about half of 12 hand-checked public pairs were real corrections.
- No arm is compared with another, so R44's no-gstack arm doesn't apply; #486 has plain-review arms. R113 doesn't apply (under $500).

## 13. Departures from the phase 1 proposal

- The frame is gstack's Review-Finding trailers, not voice names in PR text (section 2 says why). The proposal's counts (637 voice-named fixed findings, 415 public) are replaced by section 2's.
- The proposal read #486's switch as "one structured reviewer at every class". /review runs the same three extra voices, so the decision map advises on the voices, beside the switch (section 1).
- Targeted readers are not a stratum.
- The second labeller is GPT-6.2 Astra, the newest Astra, not GPT-6 Astra.
- No fallback judge. The proposal named Astra and Opus as fallbacks, but they are the labellers.
- Part A draws only from PRs whose first-pass list is complete, so no trail is unknown and nothing is imputed (section 2). An earlier draft imputed unknown trails from the known ones; review showed that biased U down, because on an incomplete list a match is still found while a miss reads unknown.
- The no-blockers row, the keyless completeness rule and the 1/k count for a defect fixed under several trailers are new.
- One private repository is never sent to a model.

<details>
<summary>Agent notes</summary>

**Third review round (Captain, 2026-11-19).** Option D: part A draws only from complete-list PRs, because every stratum fills its 40 there (RT 108, AD 66, SM 86, FR 68), so nothing is imputed.

**Captain's requirements (A1, 2026-11-19).** (1) R97 map: section 1. (2) First-pass counterfactual: sections 4 and 6. (3) R78 labellers: section 5. (4) R111 pilot within $30, private items scored without their text reaching this repo: sections 10 and 11; R113 doesn't apply.

**Money.** All-in cap $300 for the judged sample: paid calls through the gstack-evals ledger, plus the run and results threads at list price (cost.dollars). This prereg thread is on the phase 1 line, not this cap. Each ledger item opens with the Captain's recorded approval, quoting Garry's "do it" (2026-11-19) on the panel read and its "about $150 to $300" for the judged sample.

| Item | Calls | Expected | Cap |
|---|---|---|---|
| ship-panel-sample-pilot | 80 labeller calls (+40 A2), 48 judge A1 or B, 24 judge A2 | $20 | $30 |
| ship-panel-sample-main | about 155 A1, 155 A2, 92 B, with replacements and retries | $21 | $50 |
| Run and results threads (crew line) | packets, runner, pilot, main, results post and its /ship | $80 to $180 | $220 |
| **All-in** | | **$121 to $221** | **$300** |

Call prices from the pinned table: Gemini 4 Carbon $2 and $10, Opus 5.5 $4 and $20, GPT-6.2 Astra $8 and $40 per million input and output tokens. Expected figures assume about 12,000 input and 3,000 to 4,000 output tokens a call (packets are capped at about 18,000 input tokens), and about a third of that for A2. Each call reserves its maximum cost before it is sent; a refused reserve is a cap stop. If the running all-in projection passes $300, the run stops for the Captain.

</details>

## Disclosures

gstack is Garry Tan's own project.

Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.
