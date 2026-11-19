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
  - b81d9508538e490031435ffd0f5222123de525093d524ab01b4222e4503a4e38  draw.py
  - f52bdf6af5c64f8f562fc92d609f608c7a082d24387597c484a4fa81e40e85f3  draw.txt
  - 7df60380dbec2228e101d19fd6f86888b8ae9d0a0cc5c4d48151ab1d77c5ffec  power.py
  - 7b80e3f36637839f34ce90adbe903139e35d1ed1c0c0d86d12b72c5fe8729eba  power.txt
  - 2c45bfef7b270593f76d1a93e5d06c9f9d2e8b7bf51a57d563c28c1731062a2e  prompts.md
---

# Preregistration: do /ship's extra review voices find real defects the first pass misses?

## Approval

Garry said "do it" on 2026-11-19 to reading /ship's review panel from our own PR history, with a judged sample after Saturday at about $150 to $300, and a fair test only if the sample shows headroom. The keyless read is done (2,795 merged PRs with a /ship receipt across 12 repositories, in the Captain's drive). The Captain chose this sample (A1, 2026-11-19) and set four requirements, answered in sections 1, 6, 5 and 10. No paid call runs until this post merges, the Captain records each ledger item's cap (Agent notes), and 2026-11-21 06:00 UTC has passed. Nothing in this file changes after merge except its status.

## Plain summary

When /ship reviews a large or risky change, it runs a first pass (a lead review plus specialist readers such as testing and security) and three more voices: a red team, a native adversarial reader and a second-model review on another model family. gstack records which reader each fix answered, in a Review-Finding line on the merged commit. We take 40 fixed findings from each of the four sources on our five public repositories, and a model from a third family (Gemini 4 Carbon) judges each one blind to who raised it: was it a real defect, and would it have failed a test, broken production or lost data? For each finding from the three extra voices, it also checks whether the first pass raised the same defect. A real defect only an extra voice found is what the extra voices add.

What it decides: whether gstack should keep the three extra voices at gate class. Harness Evals' merged harness-evals#486 already recommends replacing /ship's panel with /review. /review runs the same three voices, so that switch doesn't settle whether they earn their place; this sample does, on the defects our own reviews actually fixed.

What it doesn't decide: how many defects any voice missed (unfixed and unraised defects are not read), how review compares with no review, or anything at light depth. A second part reads the 120 merged PRs that a later PR corrected within 7 days and reports, by review depth, how many held a real defect a reviewer could have seen. That part is descriptive and changes nothing by itself.

## 1. Question and decision (R97)

**Question.** Of the distinct real blocking defects fixed during /ship review on full-depth PRs, what share did only an extra voice (red team, adversarial, second-model review) raise? Call it U.

**What #486 found, and what it leaves open.** On 54 outside bugs on Opus 5.5, /ship's panel as Harness Evals' rig ran it found fewer bugs than /review: 37.0% against 44.4% of blocking bugs (-7.4 points, -15.1 to 0.0) and 62.0% against 72.2% at any severity (-10.2, -20.4 to -0.9). Its map reads "replace the panel with /review". The panel cost $3.10 a review against /review's $4.13, so the switch raises review cost by about a third. In that rig the second-model review never ran (no bubblewrap in the trial image), and its preregistration planned 2.8 readers a unit for the panel against 6.6 for /review's Review Army. /review at gstack 5afef04e runs a red team (when the diff passes 200 lines or a specialist finds a CRITICAL), an always-on native adversarial pass and a second-model review when Codex is available. So #486 compared two ways of running many readers. It did not ask whether gate class needs the three extra voices at all, which is where the cost of the switch could be paid back.

**Decision map.** Advice to gstack's owner (through the Captain to GStack Minder), set beside #486's "replace the panel with /review". The rows are read in this order, and the first that applies is the reading.

| Reading | When | Advice |
|---|---|---|
| Judge check fails | Section 5's check fails or is void | No judged number. FIX-METHOD on the instrument. #486's map stands alone. |
| Trail too thin | Fewer than 50% of extra-voice findings judged blockers have a known first-pass trail (section 6) | No reading of U. FIX-METHOD on gstack's record: every Review-Finding line should name every reader that raised the finding, not only the one the fix answered. #486's map stands alone. |
| Keep the extra voices | U is at least 30% and its 95% lower bound at least 15% | Keep red team, adversarial and second-model review running at gate class, whichever review /ship uses. If the panel is replaced by /review as #486 recommends, /review must run all three at gate class, including the red team on diffs under 200 lines and the second-model review as a required voice. A voice whose own count of only-it blockers has an interval that includes zero is named as not shown to carry its weight. Ask Harness Evals for the fair test #486 couldn't run: gate-class units with the second-model review running. |
| Backs #486 | U's 95% upper bound is under 15% | On our own merged fixes the extra voices rarely found a blocker the first pass missed. Replace the panel with /review as #486 says, and gstack may drop red team, adversarial and second-model review at gate class to pay for the switch. This is a CUT-CANDIDATE for those voices at gate class after one Why-null cycle (R48), and Garry hears it in plain words. |
| Inconclusive | Anything else | No change from this sample. Report U with its interval; #486's map stands alone. |

So a high U argues for keeping the extra voices at gate class and narrows #486's advice (switch, but keep the voices). A low U backs #486 and adds a cost cut it didn't test.

## 2. Part A: the frame and the draw

**Source.** gstack writes a trailer \`Review-Finding: <pass>/<reader>#<n> reader=<reader>\` for each fixed review finding, and it survives on the squash commit that lands the PR. draw.py reads every such trailer on a merged commit whose PR has a /ship receipt in the keyless read (local clones, no API calls): 1,576 findings in 327 PRs. On the 254 full-depth PRs with trailers, the trailer count equals the last receipt's fixed count on 163, exceeds it on 79 (earlier /ship runs add trailers) and falls short on 12.

**Why trailers and not the PR text.** The phase 1 proposal drew from voice names in PR descriptions. That trail names a voice for a fix on 217 of the 1,529 PRs with fixes, many of its lines are summaries or findings left unfixed, and a description is likelier to name a voice when an unusual one found something. Trailers are written by gstack for every fix, so they don't select.

**Strata.** Full depth only (full/gate and full/code), by the trailer's reader:

| Stratum | Readers | Frame (public) | Frame (private) |
|---|---|---|---|
| RT red team | red-team | 326 | 39 |
| AD native adversarial | adversarial-native | 170 | 35 |
| SM second-model review | outside-voice, cross-family-audit, gpt-6.1-sol | 208 | 38 |
| FR first pass | core, specialist-batched, specialist, testing, security, state-machines, api-contract, claim-check | 225 | 40 |

Left out: targeted readers (22 public full-depth findings, too few for a stratum), fix-check, QA, Capy's automatic review and six trailers with no reader. One private repository that belongs to another team is never sent to any model (section 11); its findings are left out of the frame.

**Draw.** Seed 1149397022422259893 (the first 16 hex digits of sha256 of this post's id). Per stratum, public findings sorted by item id (sha256 of repo, PR and finding id) and shuffled with the seed plus the stratum's index, then private findings the same way. The first 40 are the sample; the rest are the reserve, in order. Every stratum fills its 40 from public repositories, so part A sends no private finding: 160 findings in 103 PRs. draw.txt lists orders 1 to 80 of each stratum and digests of the private orders. Orders 1 to 5 are gold (section 5), order 6 is the pilot batch (section 10), orders 7 to 40 are main.

**Replacement.** An item is unscorable when its packet can't be built (no finding text, no fix diff) or the judge says the text is not one finding this change fixes (one_finding false). Its stratum's next reserve item takes its place, up to 20 a stratum; a stratum that needs more stops for the Captain. Every replacement and its reason is reported.

## 3. Part B: the corrected PRs

The 120 merged PRs with full 7-day exposure whose added lines a later PR changed within 7 days while naming them in a fix context (phase 1's correction-touch rows). By depth: full/gate 46, full/code 22, standard/code 7, light/code 17, light docs and tests 1, receipts older than depth recording 27; 56 public, 64 private. The 4 from the not-sent repository are counted and not read. Seeded order (seed plus 10): the first 20 sent items are gold, the next 4 private ones are the pilot batch, and the other 92 are main. draw.txt lists the public ones with their later PRs and a digest of the private ones.

## 4. Packets

Built keyless from local clones; a PR's head commits come from \`git fetch origin refs/pull/<n>/head\`, which is git, not the API.

**Call A1 (every part A item).** FINDING: every line of the PR description holding the finding id as a whole token, in order; if there is none, the message of each head commit whose trailers include the id, trailers removed. FIX: the diff of each head commit whose trailers include the id; if no head commit carries it, the squash commit's diff for the files the finding names, or the whole squash diff when it names none. TITLE: the PR title. In FINDING and commit messages, finding ids become [id], and reviewer words become [reviewer]: red team, adversarial, outside voice, second-model, cross-family, specialist, batched, the trailer reader names, Codex, Sol, GPT, Opus, Claude, Gemini and Astra, case-insensitive. FIX keeps at most 60,000 characters: files the finding names first, then the rest by lines changed, largest first, cut at a hunk boundary with the cut marked.

**Call A2 (RT, AD and SM items).** The finding unmasked, the head commits that fix it with every trailer they carry, and FIRST PASS: every first-pass finding of the same PR (each trailer whose reader is in the FR stratum, and each id token in the description whose reader part is a first-pass reader), with its id, its text (description lines holding the id, else its fix commit's message) and whether it has a trailer.

**Call B (part B items).** EARLIER: the earlier PR's added lines that the later PRs changed (phase 1's blame), with 20 lines of context at the earlier PR's merge, and its title. LATER: each later PR's hunks on those lines, its title and the first 2,000 characters of its description. FINDINGS: the earlier PR's review findings (trailers and description id tokens, all readers, with text and whether fixed), or "no list" when it shows none. At most 60,000 characters, cut as above.

**Labellers** see the same packets with the same masking, plus LATER for part A: each PR merged within 30 days of the item's PR that changed lines the FIX added or changed, with its title and those hunks, at most 12,000 characters; and for part B, the later PRs' full commit messages.

## 5. Judge and labels (R78)

**Judge.** Gemini 4 Carbon (google/gemini-4-carbon), through OpenRouter on google-vertex only, settings in prompts.md. The voices under study ran on Claude Opus 5.5 (first pass, red team, adversarial) and GPT-6.1 Sol (second-model review), so neither family can judge. OpenRouter's public model list, read 2026-11-19 06:48 UTC with no key, lists google/gemini-4-carbon at $2 per million input tokens and $10 per million output tokens with a 1,048,576-token context, the same prices gstack-evals already pins for it.

**Who labels and how (the Captain's third requirement).** The 40 gold items (20 from part A, 5 a stratum; 20 from part B) are labelled by two models that are not the judge: Claude Opus 5.5 and GPT-6.2 Astra. Each answers the judge's calls (A1, plus A2 for the 15 extra-voice gold items, or B) on the same packets plus LATER, blind to the reviewer in A1. Where they agree on the binary label (blocker or not; for part B, a corrected blocker or not), that is the label. Where they disagree, the run thread (a Claude Opus 5.5 thread) reads the packet and LATER and decides, blind to the judge, writing one line of reasoning per case. The settled labels go into one file whose sha256 is posted on GST-3147, with the time, before the first judge call on a gold item is sent.

**Check.** Cohen's kappa between the judge and the settled labels on the 40 gold items must be at least 0.6, with sensitivity, specificity and the five-class table printed beside it. If the two labellers agree below kappa 0.4 on the same binary label, the check is void. A2 agreement (judge against each labeller, and labeller against labeller) on the 15 extra-voice gold items is printed as a count; it doesn't gate, because 15 items can't carry a kappa. A failed or void check stops for the Captain. No other judge is tried under this post; a new judge needs a new post and its own check.

## 6. Scores

**A1.** blocker counts as a real blocking defect. should, nit, not_defect and cant_tell don't.

**First-pass trail (the Captain's second requirement).** For each RT, AD and SM item judged a blocker, A2's answer gives:

- also, fixed: same_as names a first-pass finding with a trailer. The first pass found it, and it is counted once, under the first pass.
- also, listed: same_as names a first-pass finding with no trailer (raised, not fixed under its own id). The first pass found it; it adds to the distinct total, not to the extra voices.
- only: same_as is "none" and the PR's first-pass list is complete.
- unknown: same_as is "none" and the list is not complete, or A2 was unscorable.

A PR's list is complete when every finding id it shows (trailers and description id tokens, all readers) has text, and it shows at least as many distinct ids as the fixed, noted and deferred counts summed over every /ship receipt in its description. Completeness is keyless and computed before any call.

## 7. Reading part A

Weights are the public frame counts (RT 326, AD 170, SM 208, FR 225), so the reading covers full-depth fixes on the five public repositories. For each extra stratum s with n scorable items:

- E = sum over s of weight(s) x (only + unknown x only/(only + also)) / n, where the fraction is that stratum's known split (the pooled split of the three extra strata when the stratum has no known items). This is the estimated number of blockers only an extra voice raised.
- A = the same sum for "also, listed", with unknowns split the same way.
- D = weight(FR) x (FR blockers / FR scorable items).
- U = E / (E + D + A).

Bounds: U low counts every unknown as "also, listed"; U high counts every unknown as only. Interval: a bootstrap over the sampled PRs (all strata together, so findings from one PR stay together), 10,000 replicates, seed 559, percentile 95%. power.py's estimate() and interval() are this code. The reading uses U and its interval; when U low or U high falls on the other side of a threshold, the report says the reading rests on unknown trails.

Printed with it:

- Per voice: E for that voice with its interval, and its blocker share with a Wilson interval.
- Per stratum: the share judged not_defect and nit, that is, fixes spent on findings that weren't defects or were minor.
- The trail-known share: known first-pass trails over extra-voice blockers, by stratum and pooled.
- U with should counted as real (a real bug below the floor), as a secondary reading.
- Only-extra blockers per 100 public full-depth PRs with trailers.
- Replacements, unscorable calls and provider safety stops, per stratum.

## 8. Reading part B (descriptive)

Per depth: PRs read, corrections judged real (corrects yes), real blockers, blockers a reviewer could have seen in the diff (visible yes), and of those, how many the PR's own review had raised and left unfixed (raised names a finding with no trailer). Each over the depth's 7-day population from the keyless read (full/gate 619, full/code 305, standard/code 114, light/code 488, light docs and tests 204, older receipts 370), with Wilson intervals, public and private pooled and public alone. full/gate minus light/code, with Newcombe's interval, is printed and labelled descriptive: the two depths differ in size and kind of change, and the 3.9-point detectable difference from the keyless read applies. Part B changes no advice by itself; a high share of visible blockers raised and left unfixed goes to GStack Minder as a note on the below-floor rule.

## 9. Power

power.py, output in power.txt: 200 simulated samples on the drawn sample's 103 PR clusters for each scenario, 1,000 bootstrap replicates each. The 95% interval for U is about 7 points wide when U is near 2%, 20 to 30 points near 17%, and 23 to 37 points near 35%. When the true U is 0.35, the sample reads "keep" in 53% to 82% of samples; at 0.54, in 99% to 100%. When the true U is 0.024, it reads "backs #486" in 73% to 93%; at 0.059, in 46% to 66%. A true U near 0.17 reads inconclusive in 92% to 95% of samples. So the sample separates "the extra voices carry a large share" from "almost none", and the space between reads inconclusive.

## 10. Pilot (R111)

Within a tenth of the cap, $30 of paid calls on its own ledger item:

1. Labels: both labellers on the 40 gold items, settled as in section 5, sha256 posted.
2. Judge: the 40 gold items, plus the pilot batch: order 6 of each part A stratum (4) and part B's 4 batch items, all private. With A2 on the extra-voice items, 48 A1 or B calls and 18 A2 calls.

It passes when:

- the judge check in section 5 passes;
- every call returns a usable answer after at most one retry, apart from at most 2 of the 66, and every stratum and part B has at least 5 usable judge answers;
- the 13 private part B items in the pilot (9 gold, 4 batch) are scored with their packets, calls and answers kept only under the Captain drive (section 11), and the leak check in section 11 passes on the pilot's public output;
- the measured cost per call projects the main run under its cap.

A failure stops for the Captain; a failing part is fixed by a dated change post or left out and reported as left out. Pilot answers count in the reading only if nothing in packets, prompts or settings changed after them; otherwise those items are judged again.

## 11. Order, privacy and stops

**Order.** After merge, the Captain's recorded caps and 2026-11-21 06:00 UTC: build every packet keyless; run the pilot; run the main calls; score with power.py's code; publish in a separate results post. The run thread writes the call runner before the pilot and records its sha256 in the run record before the first paid call; it changes no rule here and is published with the results.

**Privacy.** Private packets, calls, answers and labels stay on the run machine and under the Captain drive's handoffs/GEVA-559/phase2/private/, never in this repository. Public results carry private items as counts by depth only. Before the results are pushed, a keyless check confirms that no run of 12 consecutive words from any private packet appears in the change. The not-sent repository's items never leave the machine. Calls go through OpenRouter with data collection denied, and to Anthropic's and OpenAI's APIs for the labellers.

**Stops.** A ledger cap stop ends the item incomplete and is never rerun to change a reading. A projection past an item's cap stops before the call. An item that needs a 21st replacement stops for the Captain.

## 12. Limits

- Only fixed findings are read. A defect a voice raised and nobody fixed, or that nobody raised, is outside U.
- A trailer names the reader whose finding the fix answered, not every reader that raised it; A2 reads the trail for the rest, and unknowns are bounded.
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
- The trail-too-thin row and the keyless completeness rule are new.
- One private repository is never sent to a model.

<details>
<summary>Agent notes</summary>

**Captain's requirements (A1, 2026-11-19).** (1) R97 map: section 1. (2) First-pass counterfactual: sections 4 and 6. (3) R78 labellers: section 5. (4) R111 pilot within $30, private items scored without their text reaching this repo: sections 10 and 11; R113 doesn't apply.

**Money.** All-in cap $300 for the judged sample: paid calls through the gstack-evals ledger, plus the run and results threads at list price (cost.dollars). This prereg thread is on the phase 1 line, not this cap. Each ledger item opens with the Captain's recorded approval, quoting Garry's "do it" (2026-11-19) on the panel read and its "about $150 to $300" for the judged sample.

| Item | Calls | Expected | Cap |
|---|---|---|---|
| ship-panel-sample-pilot | 80 labeller calls (+30 A2), 48 judge A1 or B, 18 judge A2 | $19 | $30 |
| ship-panel-sample-main | about 155 A1, 120 A2, 92 B, with replacements and retries | $20 | $50 |
| Run and results threads (crew line) | packets, runner, pilot, main, results post and its /ship | $80 to $180 | $220 |
| **All-in** | | **$120 to $220** | **$300** |

Call prices from the pinned table: Gemini 4 Carbon $2 and $10, Opus 5.5 $4 and $20, GPT-6.2 Astra $8 and $40 per million input and output tokens. Expected figures assume about 12,000 input and 3,000 to 4,000 output tokens a call (packets are capped at about 18,000 input tokens), and about a third of that for A2. Each call reserves its maximum cost before it is sent; a refused reserve is a cap stop. If the running all-in projection passes $300, the run stops for the Captain.

</details>

## Disclosures

gstack is Garry Tan's own project.

Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.
