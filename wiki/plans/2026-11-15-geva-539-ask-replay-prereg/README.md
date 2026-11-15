---
id: 2026-11-15-geva-539-ask-replay-prereg
kind: plan
title: "Preregistration: does an ask ledger cut needless asks without holding back needed ones? A replay of 346 real asks with a no-gstack arm, on Opus 5.5, GPT-6.1 Sol and particle-1"
summary: "Replays 346 real owner asks in four arms (no gstack, gstack today, gstack plus an ask ledger, the ledger alone) to test if the ledger cuts needless asks without holding back needed ones."
author: GEVA-539
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-15
status: open
links:
  - lanes/ask-replay
  - lanes/ask-replay/frozen.json
  - lanes/ask-replay/synthetic/items.jsonl
  - https://github.com/garrytan/gstack/tree/0326b144af36676d599dcf63a9fad9a870d22ed6
attachments:
  - fb755012e90568677daf12b36f9863d4066e0a404bab1741a4e271a40542c464  autoplan-review-record.md
  - 474c5915068063e164764b3d420430f5d89ed07f92ba954180f831719580eb35  dryrun.txt
  - 82d5b22391faff5c600c410d18ef9be79cbf6ea9b69b467372722a0c0090d5f2  frozen.json
---

# Preregistration: does an ask ledger cut needless asks without holding back needed ones?

## Approval

The project owner approved this eval on 2026-11-15, with its money set out in Agent notes at the end of this post. The Captain ruled the plan's open questions at gate 1 (Big decisions 2, 3 and 6). Every rule below is frozen when this post merges. No paid call runs before then, and none runs before the Captain writes each spend item's cap and gives the go.

## ELI5

Our coordinating agents ask their owner a lot of questions. The October ask audit read 346 real asks from 8 coordinating threads, sent between October 9 and October 29, and found 140 of them needless: most repeated an ask already sent, a few asked permission the standing rules already gave, and a few asked about things the agent could have checked itself.

The idea under test is a small "ask ledger" in gstack: a list of every ask sent, open or answered. It folds a repeat into the "Waiting on you" line and refuses an ask that was already answered.

This eval replays those 346 real moments. At each one the model sees what the agent could see then and the ask it was about to send, and chooses: send it, fold it into the waiting line, or drop it. Four arms run on the same models and items: no gstack, gstack as it is today, gstack plus the ledger, and the ledger without gstack's text.

We count two things: needless asks that still went out, and needed asks that got held back. If the ledger cuts the first without raising the second, gstack builds the ledger. If gstack today already does as well, the ledger is dropped. If no gstack does as well as both, gstack's asking rules become a cut candidate.

The real asks stay private. Only counts and digests leave custody. This repo gets the harness, its tests and a made-up set of 60 items with the same shape.

## Before → after

Before: the only guard against needless asks is prose (gstack's "ask once" rule and its standing-approvals rule), and we have one audit count with no test of any fix.

After: a paired, preregistered measure of needless sends and held-back needed asks for no gstack, gstack today, gstack plus the ledger and the ledger alone, on Claude Opus 5.5 and GPT-6.1 Sol, with particle-1 on three arms where its endpoint denies data collection, and a decision already tied to each outcome.

## Why it matters

Every needless ask costs the owner a read and a reply. Repeats also train the owner to skim asks, which is how needed ones get missed. A ledger is cheap to build, but it adds a step to every ask and can block a needed follow-up. We should know which way it cuts before gstack ships it.

## What caused this work

The October ask audit convicted practice P53 (one open ask per decision, never re-sent). A pass over ideas for always-on agents ranked the ledger first (idea 1) and this replay as its smallest test (idea 10).

## Big decisions

1. **Arm (c) both consults and filters, as idea 1 describes.** The agent sees the ledger view and names the row its ask repeats, or says new; the harness then folds or refuses deterministically.
2. **Idea 1's three open points, ruled by the Captain at gate 1.** The agent names the row (an automatic text match is measured for free as S1). A refused ask can still go out with a stated reason saying what changed. The owner's next message answers every ask still open before it.
3. **Arm (d), the ledger without gstack's text, is in** (Captain, gate 1), so row 1 can license trimming gstack's ask prose as well as building the ledger.
4. **Labels are the audit's labels,** checked by a 99-item label audit with two labellers from two model families, with a full relabel as a priced contingency.
5. **Replicates: 2 per item per arm,** at medium reasoning, with a pilot rule that moves the main run to 3.
6. **The paid run goes in resumable foreground shards of under 55 minutes on one machine,** so plaintext never leaves it (Captain, gate 1; a custody deviation from the crew's runner-VM rule, section 16).

## Implementation plan

### 1. Question and decision (frozen word for word, R97)

Question: on the same models, items and harness, does gstack plus the idea 1 ledger send fewer needless asks than gstack today, without holding back more needed asks?

Decision table (word for word):

- If the ledger arm cuts needless asks without missing must-asks, the ledger gets built in gstack and the prose rule is trimmed.
- If gstack today matches the ledger, the ledger is dropped.
- If the no-gstack arm does as well as both, the quiet and ask rules become a cut candidate, which Garry hears plainly (R48).

Operational reading, frozen with the table before any outcome data. All differences are in percentage points, paired by item, and read on the two frontier models (Opus 5.5 and Sol). The margins are 10 points on needless sends and 5 points on must-ask misses, and they don't move.

- **Row 1, build:** on at least one frontier model the (c) minus (b) needless interval lies wholly below 0 and its leave-one-thread-out range stays below 0, and on both frontier models the (c) minus (b) must-ask guard passes (upper end below +5).
- **Row 1, trim:** read only when the build half holds. On both frontier models, the (d) minus (c) needless upper end is below +10 and the (d) minus (c) must-ask upper end is below +5. Then gstack's ask prose (rule 11 and the standing-approval ask lines) can be trimmed once the ledger ships. If not, the ledger is built and the prose stays.
- **Cut with a failed guard:** a cut on a frontier model with the guard failing on either. This is FIX-METHOD on the gate rule, not a Why-null cycle, and the ledger isn't built as is.
- **Row 2, drop:** no cut on either frontier model, and on both the lower end of the (c) minus (b) needless interval is above minus 10. A ledger that is worse also lands here.
- **Row 3, cut candidate, read on its own:** on both frontier models the upper ends of the (a) minus (b) and (a) minus (c) needless intervals are below +10, and (a)'s must-ask guard passes against both. It is worded as "gstack's quiet and ask rules add nothing on top of an owner's own ask rules", which doesn't license removing them for gstack users who have none.
- **Anything else** is inconclusive and gets one Why-null cycle (section 10). particle-1 never decides a row.

score.ts decide() reads these rows from the interval results, and the tests drive each row on fixtures: (c) cutting with the guard passing, the trim half, (a) clearly better than (b), (c) clearly worse than (b), and a cut with a failed guard.

Planned power: about 0.96 for a cut of 15 points on at least one model, times about 0.67 for the guard passing on both at a true difference of 0; the guard's power to catch a true 2-point must-ask cost is about 0.17. Recomputed on decision chains (section 9): needless detectable difference 8.3 points on items and 11.0 on the proxy chains (80 effective clusters, the worst case), duplicates 12.3 points (63 clusters), must-ask half-width 3.4 points (206 single-item clusters). The needless value passes 10 points on the chains, so the Captain heard it before the freeze and ruled (ruling N1): a real cut under about 11 points will often read inconclusive, and row 2 needs the observed (c) minus (b) difference within about 2 points of zero. That is acceptable because duplicates were 121 of 346 asks and a ledger only earns its build with a cut well above 11 points. Adding a new labelled window would put our labels in place of the audit's and cost a week. The margins stay at 10 and 5.

### 2. Items

**Source.** The October ask audit's labelled set: 346 real asks from 8 coordinating threads, 2026-10-09 to 2026-10-29. Labels: 206 genuine decisions (must-ask), 121 duplicates, 11 permission the standing rules already gave, 8 observable. The 294 rows judged status reports are not items, but they stay in the conversation as messages. The 33 asks before October 15 are built the same way and reported as their own stratum.

**One item is one moment:** the agent is about to send that real ask. It holds only what the agent could see then, with no later event and no label, in one frozen component order, asserted in a test: harness prompt, arm text, capability block, standing rules, conversation, ledger view (arms c and d only), draft.

1. **Conversation.** Every message the agent sent the owner and every owner message in that thread before the ask, each with its date and time, in order. The newest 120,000 characters are kept, as whole messages, with a one-line note when older ones were cut.
2. **Standing rules in force.** Rule rows from the org rules history, rule text only, whose date is on or before the ask's date. A row's date is the earliest date in its date text. An undated row takes the date of the next dated row with a higher rule number; rows that still can't be placed are dropped. Section 16 states how this differs from the plan.
3. **Capability block.** A fixed block, the same in every item, saying what a coordinating agent could check itself then (prompt.ts CAPABILITY).
4. **Draft.** The real ask, as written.

**Secret and contact scan (A1).** In custody, every built item and every label-audit input passes the scanner in privacy.ts: API key and token shapes, bearer headers, private key blocks, long hex or base64 runs near the words key, token, secret or password, email addresses and phone numbers. Each hit becomes the one fixed placeholder [redacted], identical in every arm, before the freeze.

**Drops and digests.** An item whose ask event can't be read is dropped before the freeze and counted. The frozen set is a sealed bundle; this post commits only bundle-level digests and counts, never a per-item digest or a ledger id. Threads appear as T1 to T8.

**Variant bundle for R61 (section 10).** Built and digested in custody before this post merges: the same rules plus the thread's crew reports and its own non-owner text in the same window.

**Bundle counts** (from the builder's count output; filled at the freeze):

| Count | Main bundle | Variant bundle |
|---|---|---|
| Bundle sha256 | f49f0973de12d2b1a01c975354c00927f918b5500d113b39bc1efc6cd66ef06c | cb857f63e2c315fadb4ac4a1c59fb21815ec05825e4070a3f290c430d9dcd325 |
| Items built | 346 | 346 |
| Items per class | 206 DECISION, 121 DUPLICATE, 11 PERMISSION_FOR_DEFAULT, 8 OBSERVABLE | same as main |
| Items per thread, T1 to T8 | DECISION/DUPLICATE/PERMISSION/OBSERVABLE: T1 11/26/0/0, T2 41/22/3/3, T3 61/13/0/1, T4 32/29/2/2, T5 12/3/1/0, T6 27/14/2/1, T7 11/9/3/1, T8 11/5/0/0 | same as main |
| Items dropped, ask event unreadable | 0 | 0 |
| Items before October 15 | 33 | same as main |
| Item size in tokens (item JSON, characters / 4): min, quartiles, 90th percentile, max, mean | 225; 19,765, 38,406, 45,196; 51,620; 64,378; mean 33,655 | 225; 23,844, 38,394, 45,137; 51,955; 63,967; mean 34,889 |
| Items with older messages cut | 205 | 228 |
| Crew messages carried | 0 | 8,168 |
| Secret and contact scan hits | 25 (22 emails, 2 keyword runs, 1 Anthropic-key-shaped string), each replaced with the placeholder | 35 (30 emails, 4 keyword runs, 1 key-shaped string) |
| Asks holding more than one lettered decision | 11 | same as main |
| Items whose repeated ask lies outside the window | 8 (113 inside) | 15 (106 inside) |
| Rule rows: total, dated, placed by the next dated row, dropped | 98 total, 93 dated, 5 placed by the next dated row, 0 dropped | same as main |
| Rule rows whose date text holds more than one date | 15 | same as main |
| Rule rows that restate gstack's ask rules | 7 of the 38 rule rows that appear in any item match the frozen ask pattern (frozen.json rules_ask_pattern) | same as main |
| Arm (a) prompts holding a gstack line of 40+ characters or the word gstack | 0 items hold a gstack line of 40+ characters. All 346 hold the word gstack in the owner conversation or rules, because the threads discuss gstack; the token check covers harness and arm text only | the same as the main bundle |

### 3. Arms (R44)

All arms get the same items, model and settings, one API call per sample, arm cells (item, arm and model) in a seeded random order within each item with each cell's replicates in sequence, the same harness prompt and the same JSON reply shape. The harness defines the three actions plainly:

- SEND: send it now.
- FOLD: don't send it now; carry it as one line under "Waiting on you" in the next digest, which reaches the owner at the next scheduled digest.
- DROP: don't ask; carry on.

The arms:

- **(a) the owner's standing rules with no gstack prose:** the harness prompt and the item. Clean by construction: direct provider API calls through the repo's metering proxy from cited code (lanes/ask-replay/run.ts), with no tools, no filesystem and no drive. The cleanliness test covers the harness, capability and arm text: no gstack line of 40 characters or more and no "gstack" token. The same check runs in custody on real items (the `arms` command) and is reported as a count in section 2.
- **(b) gstack today,** pinned at gstack v1.99.5.0, commit 0326b144af36676d599dcf63a9fad9a870d22ed6: (a) plus three whole files at the pin, each checked by sha256 (E_ASK_PIN on any mismatch). The builder reads them with git show at the pinned commit, never from the live checkout, which upgrades at every workflow start. gstack today has no ask dedupe: its approval record keeps answers for display and drops only byte-identical rows of its own record, and nothing checks an outgoing ask. So (b) is gstack's prose.

| File at the pin | sha256 | Bytes |
|---|---|---|
| capy/skill/gstack/factory.md | 23044b254f7b44d8588525869f2d42b16e78a45f44d103863beb0bd41a40341d | 4182 |
| capy/skill/gstack/captain.md | 991560bbde8ef04cd744d9aef5a339d406eb6ebff4985fc0a6e7222ea5af66fd | 12881 |
| captain/SKILL.md | 2c795bdefa9f2a7d5b4d526bbef4418eb4e41e2b008bf20de3f372b53ce924a4 | 27843 |

- **(c) gstack plus the ledger:** (b) plus the ledger as idea 1 would ship it (section 4): the ledger view, a one-line rule-11 addendum ("Before you send an ask, read the ledger and name the row it repeats, or say new."), two extra reply fields, and the send-time check the harness applies.
- **(d) the ledger without gstack's prose:** (a) plus exactly (c)'s ledger parts. Opus 5.5 and Sol only. A test asserts that (d) is (a) plus exactly the parts (c) adds to (b).

What (c) licenses if it wins: building idea 1 as ruled (the agent names the match, gstack folds or refuses) cuts needless asks in a single-decision replay on these models. It doesn't show that an automatic filter works (S1 reads that), and it doesn't show that agents will open the ledger unprompted in a live session. The replay shows the view every time, so exposure is 100% by construction, and a live roll-out should log how often agents read it.

### 4. The ledger in the harness (lanes/ask-replay/ledger.ts)

- **Rows:** every earlier real ask in that thread (the audit's ask rows, any class), in event order; event order also breaks same-second ties. Row text is the first decision line after stripping a frozen list of header and trailer lines (empty lines, markdown headings, TL;DR lines, lines starting "gstack:", and lines that are only a name followed by a colon), capped at 300 characters. Id: "q-" plus the first 12 hex characters of the sha256 of thread, sent time and text, the pattern gstack's approval record uses. Ids stay in custody.
- **Status (ruling K1):** a row is answered once an owner message in that thread arrives after it and before the item's moment. That message answers every row still open before it and is quoted, capped at 300 characters. Otherwise the row is open. The label audit measures how often the quoted message really answers the ask (section 7).
- **View:** "Waiting on you" (open rows: id, text, "asked <age> ago") and "Answered" (id, text, quoted answer), newest first, at the item's moment.
- **Reply fields in (c) and (d):** repeats ("new" or a row id) and reask_reason (optional).
- **Send-time check (rulings I1 and J1):** when the action is SEND or FOLD and repeats names an answered row, the action becomes DROP with the answer quoted, unless reask_reason is non-empty after trimming, in which case the agent's action stands. When the action is SEND and repeats names an open row, it becomes FOLD. A missing repeats field or an unknown row id counts as "new", and both are counted. The final action is scored; the agent's own action is kept for S2.
- **Multi-decision asks:** section 2 counts asks holding more than one lettered decision, and section 8 reports P1 and P2 on single-decision asks as a sensitivity read. A mixed ask keeps the audit's label.

### 5. Models and settings (R54)

| Model | Route | Arms |
|---|---|---|
| Claude Opus 5.5 | Anthropic Messages, claude-opus-5-5 | (a) to (d) |
| GPT-6.1 Sol | OpenAI Responses, gpt-6.1-sol, not stored | (a) to (d) |
| particle-1 | OpenRouter chat, particle-ai/particle-1, data collection denied | (a) to (c), the low-cost readout |

All run at medium reasoning and the provider's default temperature (no temperature field is sent). The output cap is 4,000 tokens, raised to 8,000 for every model if more than 1% of the synthetic smoke's replies hit it. Caching (frozen.json caching): on Anthropic both the system prefix and the user content end in an ephemeral cache breakpoint; OpenAI and OpenRouter use their own automatic caching, with no cache field in the request. A cell runs its replicates in sequence: replicate 2 starts only after replicate 1 has a sealed reply or a final MISSING, so replicate 2 reads the whole prompt from cache. Different cells and items still run in parallel. Reasoning tokens are priced as output, from src/runner/pricing/prices.ts.

**Processors (ruling L1).** Anthropic and OpenAI see real items, under their API data terms as published on 2026-11-15. Anthropic doesn't train on API data under its commercial terms and deletes it from back-end storage within 30 days by default ([Anthropic data retention](https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data)). OpenAI doesn't train on API data by default and keeps abuse-monitoring logs for up to 30 days ([OpenAI: your data](https://developers.openai.com/api/docs/guides/your-data)). OpenRouter stores no prompts or responses unless logging is opted in, and data_collection "deny" routes only to providers that don't collect ([data collection](https://openrouter.ai/docs/guides/privacy/data-collection), [provider selection](https://openrouter.ai/docs/guides/routing/provider-selection)). OpenRouter lists one particle-1 endpoint, Particle AI's own, with no data policy shown, so the evidence is the reply to I1's first data-collection-denied call. particle-1 sees real items only through an OpenRouter route that accepts data collection denied (provider.data_collection "deny", only particle-ai, no fallbacks); the request setting and the endpoint's reply are recorded in custody as evidence. If that can't be proven, particle-1 runs on the synthetic set only and the results say it is untested on real items (E_ASK_PROCESSOR).

### 6. Reply parsing and failures (frozen, lanes/ask-replay/parse.ts)

- **Reply:** one JSON object {"action": "SEND" | "FOLD" | "DROP", "reason": "<at most 40 words>"} plus the (c) and (d) fields. Opus and Sol answer through their JSON schema modes. particle-1 is sent without one, and the last JSON object in its text with a valid action is parsed. The action is case-insensitive. An unparsable reply gets one retry with the same prompt.
- **Safety stop, frozen per provider:** Anthropic stop_reason refusal; OpenAI a refusal content part or refusal field, finish_reason content_filter, or incomplete_details.reason content_filter; OpenRouter finish_reason content_filter. It is its own outcome (R95), counted apart.
- **Other failures:** anything else unparsable after the retry is a parse failure. An upstream error gets 3 retries with backoff (5, 20 and 60 seconds), then UPSTREAM, and one frozen end-of-run redraw pass covers UPSTREAM samples only. Each of these is MISSING.
- **MISSING is scored per comparison as a bound (B1):** the treatment arm's MISSING counts against it (a send on needless items, a miss on must-asks) and the comparator's counts in its favour (a hold on needless items, a send on must-asks). Treatment is (c) against (b), (d) against (c), and (a) against (b) and (c). A MISSING-excluded readout sits beside every result. If any arm and model cell has more than 3% MISSING, that model's rows are inconclusive (E_ASK_MISSING_CEILING).

### 7. Labels and their audit

- **Classes.** Must-ask is the audit's genuine-decision label. Needless is duplicate, permission-for-default or observable. The audit's labels came from two model classifiers (family: Anthropic Claude; both classifier passes ran on Opus 5.5, so the Opus labeller shares their family and Astra is the cross-family read) reading 500-character tails plus the reply kind, without the thread history. They are trusted only after a check.
- **Label audit (paid, before the main run; E1).** 99 items: 40 must-ask, 40 duplicates and all 19 permission and observable items, drawn at random within class by `ask-replay draw --kind audit`, which mints its seed from random bytes and appends it to CUSTODY.md, writes the drawn items to /dev/shm and prints counts only. Two labellers, Opus 5.5 and GPT-6 Astra at medium reasoning, each see the full item, the owner's next reply (allowed for labelling only) and a written codebook, blind to the audit's labels and to all arm outputs. Each also says whether the quoted owner message answers the row the ledger marks answered. The codebook is lanes/ask-replay/codebook.md, pinned by sha256 in frozen.json (labelling.codebook_sha256). It defines the four classes as the October ask audit did, the needed or needless reading, and the tie rule that a mixed ask takes the class of its first lettered decision. Each labeller replies with its class, the position of the earlier ask the ask repeats (or null), a yes, no or unclear judgement for each row the ledger marks answered, and a reason of at most 40 words. `ask-replay label --kind audit` runs it once per labeller, on the arm driver with the same leases, retries and sealed store; Astra is a labeller-only model row in frozen.json.
- **Rule.** The audit labels stand when each labeller's kappa against them is at least 0.6 both on needed against needless (pooled) and on duplicate against must-ask alone. Otherwise both label the other 247 items (the contingency, `ask-replay label --kind contingency`), the primary label becomes the two labellers' agreement, and disagreements leave the primary and are shown both ways. Either way, the primary readout is also shown under the labellers' agreement labels on the audited items, and a row that flips between the two is reported as label-sensitive. `ask-replay score --labels` computes the kappas, the primary labels, these views, the label-sensitive flag and the chains from the Opus links. For S2, a ledger row counts as answered when both labellers say yes and as not answered when both say no.
- **Decision chains (F1).** In custody Opus 5.5 links every duplicate to the earlier ask it repeats (`ask-replay label --kind link`, spend item I5). Astra's links on the 40 audited duplicates come from its audit labels, and their agreement is reported. Chains are the linked groups. Before the freeze, a free deterministic proxy (S1's matcher, then the nearest earlier ask in the same thread by content-word overlap, ties to the newest) gives the planned chains: over all items 225 clusters, with 63 chains holding 184 items; over needless items 80 clusters, with 21 chains holding 81 items. The largest chain's share of each thread's needless items: T1 0.77, T2 0.29, T3 0.21, T4 0.30, T5 0.25, T6 0.18, T7 0.15, T8 0.40.
- **No model judge scores arm outputs.** Every score in section 8 is deterministic from the action field. The label audit still holds itself to R78's bar: a cross-family pair, kappa of at least 0.6, and at least 40 labelled outputs.

### 8. Scoring (deterministic, frozen, lanes/ask-replay/score.ts)

- **Per sample, from the final action.** Primary coding: on a must-ask item a miss is FOLD or DROP; on a needless item a needless send is SEND. MISSING follows section 6.
- **Secondary coding (F8),** reported beside it: FOLD counts as an ask on answered duplicates and on permission and observable items; on must-asks only DROP counts as a miss. The primary coding decides every row.
- **Per item and arm:** the mean over the item's samples.
- **P1 (cut):** the needless-send rate over the 140 needless items, paired (c) minus (b), per model; also (c) minus (a), (b) minus (a), (d) minus (c) and (d) minus (a).
- **P2 (guard, non-inferiority):** the must-ask miss rate over the 206 must-ask items, same pairs, margin 5 points.
- **Per class, each on its own:** duplicates (121) with intervals; permission (11) and observable (8) as counts with exact intervals and no claims. The pre-October-15 stratum and single-decision asks are sensitivity reads. For both bundles, the cut on items whose repeated ask is inside the window is reported separately.
- **S1, automatic filter, free:** the office-hours lane's repeat rule (its sentences, isQuestion and contentWords helpers; at least two shared content words; a draft with no question uses its first sentence) as a send-time matcher. It runs first on the 346 original drafts against their earlier rows, before the pilot (catches on duplicates, and must-asks it would fold), then on arm (b)'s sends. Pre-pilot readout on the 346 original drafts, matched of items: DECISION 117 of 206, DUPLICATE 72 of 121, PERMISSION_FOR_DEFAULT 1 of 11, OBSERVABLE 3 of 8. An automatic send-time filter on this rule would fold more than half the must-asks, so it is unusable as a gate.
- **S2, gate share, free:** how much of (c)'s and (d)'s cut came from the send-time check against the agent's own FOLD or DROP; how often they named a row, said new or gave a reask reason; and gate DROPs split by the label audit's judgement of whether the quoted message answered the row.
- **Repeat count:** for each needless item, the samples per arm that sent it, summed per thread and per chain.

### 9. Statistics (R78, lanes/ask-replay/stats.ts)

- **Intervals.** Everything is paired by item. 95% intervals come from a bootstrap over decision chains, resampled within thread, 10,000 resamples, seed frozen in frozen.json (stats.bootstrap_seed: 1992076652). Must-ask items that start no chain are their own clusters. Each estimate also gets a leave-one-thread-out range. The arm order seed is frozen the same way (stats.order_seed: 1647197898).
- **Planned detectable differences** at 80% power, two-sided 5%, k = 2, with a paired spread of 0.35 on needless and 0.25 on must-ask, on items (2.8 times spread over the square root of clusters): needless 8.3 points, duplicates 8.9 points, must-ask interval half-width 3.4 points. Recomputed on the proxy chain count (80 effective clusters on needless items), the values are in section 1.
- **Pilot spread rule.** The pilot measures within-item spread from (b) at k = 2, and a frozen formula turns it into the projected P1 spread. W is the mean over needless items of the unbiased variance of (b)'s k samples. V is the unbiased variance across needless items of (b)'s item means. B2 = max(0, V minus W/k_pilot) is the variance of (b)'s true item rates and stands for the variance of the true paired difference. The projected spread is S(k) = sqrt(B2 + 2W/k), taking the treatment arm's within-item variance equal to (b)'s, and the projected detectable difference is 2.8 S(k) over the square root of the proxy effective clusters on needless items. If that is above 12 points at k = 2, the main run uses k = 3, which shrinks only the within-item part. A central cost projection past the approved total (Agent notes) goes to the Captain first.

### 10. Admission pilot and Why null (R48, R61)

- **Pilot (paid, first):** 40 items stratified by class and thread (24 needless, 16 must-ask), arm (a) at k = 1 and arm (b) at k = 2, on Opus 5.5 and Sol. `ask-replay draw --kind pilot` draws them: each group is spread over its (class, thread) strata in proportion to their sizes (largest remainder, random tie order) and drawn at random within each stratum, with the seed minted from random bytes and appended to CUSTODY.md. `ask-replay run --pilot` runs the frozen pilot arms and replicate counts. No ledger arm runs, so it can't peek at the effect.
- **Admission:** admit when, on at least one frontier model, arm (b) sends at least 5 of the 24 needless items and misses at most 8 of the 16 must-asks. Sends and misses are counted as the sum of per-item mean rates, so an item sent in 1 of its 2 samples counts 0.5. The bar admits a true 10% rate about 9% of the time and a true 20% rate about 54%.
- **Ceiling raise (R61):** if the pilot fails on room, the pre-built variant bundle gets one more pilot. If that fails too, the eval stops with a ceiling report: frontier models already hold repeats back when the history is laid out, and the ledger question moves to the simulated-week eval (idea 2). If the variant is used for the main run, the main-run items are re-capped before it starts.
- **Why null, for any null:** exposure (in (c) and (d), how often the agent named a row; in (b), whether its reasons cite an earlier ask, counted by the frozen phrase list in frozen.json exposure_phrases), task fit, power against the measured detectable difference, and the ceiling ((b)'s needless rate). Each null ends KEEP, FIX-METHOD or CUT-CANDIDATE, and a cut candidate is reported plainly.

### 11. Custody and privacy

- **What stays private.** The labelled set is the owner's own asks. Items, reconstructed states, his words, label-audit inputs and outputs and every per-item reply stay private, following the pattern in lanes/autoplan-audit/told.ts: sealed age records with a SHA256SUMS file in a private drive, decrypted only on /dev/shm, the identity streamed on stdin and removed after, a leftover sweep at every opening and on every wake, and a CUSTODY.md line for every opening and incident. Readers return counts only.
- **custody.ts** adds an async wrapper (told.ts's custody() is synchronous and removes the directory when its reader returns), keeps plaintext on /dev/shm and proves teardown with test ! -e at the end of every shard. It refuses an empty identity at once (E_ASK_IDENTITY).
- **Builder.** An execute program has no filesystem, so it reads the 8 threads through Capy's thread tool and writes each page straight to /dev/shm on the custody machine, returning only counts. No agent context holds the content. The bun builder (`ask-replay build`) then forms items, scans, seals and wipes the raw pages.
- **Paid run** (section 16, deviation 1): resumable foreground shards of under 55 minutes under a live program on the custody machine, so plaintext never leaves it. A cell's replicates run in sequence, so replicate 2 hits the cache replicate 1 wrote, while cells run in parallel. Every sample has a fixed id. Its sealed reply is written atomically under that id and its spend lease settles once against that id, so a resumed shard skips every settled sample and can't count a call twice. A sample with an open lease and no sealed reply is reconciled through the spend ledger's unknown-charge path, then redrawn once, and redraws are counted per arm (E_ASK_RESUME).
- **Before every push:** gstack-pregate sealed, plus the lane's scan (`ask-replay scan`: no issue keys or thread codes in prose, no dollar figures outside Agent notes, no private names, no 6-gram shared with any custody text), run in custody and reported as a count: TODO(custody:prepush_scan_hits).

### 12. Public synthetic set (lanes/ask-replay/synthetic/)

- **The set:** 60 items in 3 made-up coordinating threads (S1 to S3) about 4 made-up projects, with a made-up owner and standing rules written from scratch, in the same shape and fields as the real items. Class mix: 35 must-ask, 20 duplicates (10 repeating an open row and 10 an answered one), 3 permission and 2 observable. A seeded template generator writes it, so no model saw real asks while writing it.
- **Digest:** items.jsonl, 567,688 bytes, sha256 68009e99b8c13be664bec041c17c7b27034798a2422bca3288dd46fab27c45e4, generator seed 20261115. `ask-replay synth` checks that the committed set matches the generator byte for byte.
- **Privacy check in custody** (`ask-replay synth-check`): every synthetic text field (conversation, rules, drafts, ledger lines) against all custody text (owner and agent messages, rule rows, asks). It reports 6-gram hits and the largest content-word Jaccard overlap, both as counts, ignoring texts with fewer than 5 content words. Any 6-gram hit or an overlap above 0.5 fails the build. Result: 124 synthetic texts, 0 6-gram hits, largest overlap 0.29, pass.
- **Uses:** keyless tests and the full dry run with a stub model; and the paid smoke I1 after the go, before the pilot. The smoke draws 20 items (12 must-ask, 6 duplicates, 1 permission, 1 observable) with seed 20261115, one sample per arm, all four arms on Opus and Sol and three on particle-1.

### 13. Code, tests and dry run

**Modules** in lanes/ask-replay/: types.ts (the item and reply shapes), frozen.json and frozen.ts (every frozen number), codebook.md and label.ts (the labeller), draws.ts (the pilot and label-audit draws), build.ts, privacy.ts, ledger.ts, prompt.ts, parse.ts, run.ts, custody.ts, score.ts, stats.ts, chains.ts, synthetic/ (generator, set, digest), fixtures.ts, dryrun.ts and cli.ts. The command is `bin/gstack-evals ask-replay`, with subcommands build, synth, dryrun, smoke-plan, draw, arms, score, label, s1, chains-proxy, mdd, scan, synth-check and run. lanes/ask-replay/README.md explains each one.

**Reason codes** in src/errors/codes.ts, each with what, fix and recovery in docs/errors.md:

| Code | When |
|---|---|
| E_ASK_PIN | a gstack file's sha256 differs from frozen.json; stop before any paid call |
| E_ASK_CUSTODY | a custody step failed or a leftover was found; sweep, log, stop |
| E_ASK_IDENTITY | stdin is a terminal or empty; refuse at once |
| E_ASK_PROCESSOR | no particle-1 route accepts data collection denied; particle-1 untested on real items |
| E_ASK_CAP | a spend cap stopped a lease; the run is incomplete and never retried to change a verdict |
| E_ASK_RESUME | a sample has an open lease and no sealed reply; reconcile, redraw once, count it |
| E_ASK_PRIVACY | the lane scan or the synthetic check found a hit; no push, no build |
| E_ASK_PARSE | a reply with no valid action; scored as MISSING |
| E_ASK_MISSING_CEILING | a cell past 3% MISSING; that model's rows are inconclusive |
| E_ASK_UNFROZEN | a paid run while frozen.json still holds a placeholder |
| E_ASK_INPUT | malformed builder input, or a synthetic set that differs from its generator |
| E_ASK_DRYRUN_FAIL | the dry run had a FAIL line |

**Keyless tests** in tests/ask-replay/ (15 files) cover: the codebook pin, the labeller prompt's blindness, label parsing, labeller calls on the driver and the label readout; both draws; ledger status and every gate rule (a whitespace-only reask reason, FOLD naming an answered row, a missing repeats field, an unknown id); every scoring rule and both codings; MISSING bounds per comparison; every decision row on fixtures; stats on fixed data; component order; arm cleanliness; the gstack pins (skipped when no gstack clone is present); the privacy scanners; custody on a throwaway age identity; a resume that never double-counts; the builder on fixture pages; and the dry run.

**Dry run.** `bin/gstack-evals ask-replay dryrun` drives every frozen rule on the synthetic set with a stub model (scripted SEND, FOLD, DROP, unparsable, safety stop, upstream error, a missing repeats field and a reask reason), opens and settles one spend lease per frozen spend item on a temporary ledger, resumes a killed shard with no double count, checks that a cell's replicates run in sequence with both Anthropic cache breakpoints, checks both seeded draws, and runs custody on a throwaway age identity. Its output at this post's head is attached as dryrun.txt: 23 PASS, 0 FAIL.

**Frozen numbers.** lanes/ask-replay/frozen.json holds every number above. Its sha256 at this post's head is 82d5b22391faff5c600c410d18ef9be79cbf6ea9b69b467372722a0c0090d5f2, and this post attaches a copy as frozen.json.

### 14. Spend items

Each paid step runs as its own spend item through the program ledger, with a cap the Captain writes at 1.35 times its central estimate. The central estimates are in Agent notes.

| Item | Ledger item | What |
|---|---|---|
| I1 | ask-i1-smoke | synthetic smoke: 20 items, all arms, 3 models, 1 sample |
| I2 | ask-i2-pilot | admission pilot: 40 items, (a) k = 1 and (b) k = 2, Opus and Sol |
| I2r | ask-i2-pilot-retry | the R61 pilot on the variant bundle, only if needed |
| I3 | ask-i3-label-audit | label audit: 99 items, Opus 5.5 and Astra |
| I4 | ask-i4-relabel | label contingency: 247 items, both labellers, only if kappa misses 0.6 |
| I5 | ask-i5-linking | duplicate linking: 121 duplicates on Opus 5.5, plus Astra on the 40 audited |
| I6 | ask-i6-opus | main run, Opus 5.5: all items, arms (a) to (d), 2 samples |
| I7 | ask-i7-sol | main run, GPT-6.1 Sol: the same |
| I8 | ask-i8-particle | main run, particle-1: all items, arms (a) to (c), 2 samples, only with data collection denied |

Planning sizes: about 20k input tokens per item in (a), 31k in (b), 33k in (c) and 22k in (d), with 11k of gstack text cached in (b) and (c), and about 1.5k output tokens per sample with reasoning counted as output. Measured from the sealed bundle (`ask-replay arms`, prompt characters / 4), mean with the largest in brackets: 24,602 (32,929) in (a), 35,838 (44,165) in (b), 38,017 (49,191) in (c) and 26,781 (37,955) in (d). The variant bundle: 25,861 (33,062), 37,097 (44,298), 39,276 (49,324) and 28,040 (38,088). Agent notes prices the main run from the measured means.

### 15. Delivery (R77)

Two pull requests. This one, the preregistration, carries the harness, the synthetic set, the tests, the dry run's output, frozen.json and the bundle digests. No paid call runs until it merges and the Captain writes each item's cap and gives the go. Then I1, I2, I3 and I5 (and I4 if triggered), I6 to I8, scoring in custody, and a second pull request with the results: a finding file with the paired readout, the R48 verdict and the decision read against the table.

### 16. Deviations

1. **The paid run stays on the custody machine.** The crew's rule puts multi-hour drivers on a dedicated runner VM. The Captain approved, at gate 1, a custody choice instead: resumable foreground shards of under 55 minutes under a live program on the one machine that holds the plaintext, so it never leaves that machine. Fixed sample ids, atomic sealed writes and per-sample lease settlement make a lost shard cost only a resume (section 11).
2. **Rule text comes from the 2026-11-14 rules history, filtered by first date.** The plan read rule rows from the earliest retained version of the org rules history, its 2026-10-29 seed, so later amendments couldn't leak in. That seed isn't retained. Rule text comes from the 2026-11-14 version instead, and a row enters an item when the earliest date in its date text is on or before the ask's date. A rule amended after its first date therefore shows its amended text in earlier items. 15 rows have more than one date in their date text and are the ones this can touch.
3. **Rules the plan left open, frozen here:**
   - The pilot spread formula (section 9), which the plan named without giving.
   - Pilot sends and misses counted as sums of per-item mean rates (section 10).
   - The synthetic overlap check ignores texts with fewer than 5 content words, where one shared word would read as a large overlap (section 12).
   - The secret scan covers every GitHub token prefix (ghp_, gho_, ghu_, ghs_, ghr_), a superset of the shapes the plan named.
   - The OpenAI safety stop also counts incomplete_details.reason content_filter (section 6).
   - The metering proxy makes one attempt per call and run.ts owns the 3 upstream retries, so no call is retried twice over.
   - The end-of-run UPSTREAM redraw is draw 3 under its own sample key; draw 2 is the resume redraw (section 11).
   - Synthetic item ids come from the seeded generator, not from random bytes, so the public set reproduces byte for byte. Real item ids stay random.
   - particle-1 is sent without a JSON schema mode and parsed from its text. This was not checked against OpenRouter's list of supported parameters for the model; the I1 smoke confirms all three reply shapes before the pilot.
4. **Caching and replicate order.** The plan cached the shared prompt prefix only. Here Anthropic requests also put a cache breakpoint at the end of the user content, and each cell runs its replicates in sequence (replicate 2 starts only after replicate 1 has a sealed reply or a final MISSING), so replicate 2 reads its whole prompt from cache. Arm cells keep their seeded random order within each item, so the arms are still interleaved.
5. **Codebook choices.** The codebook adds two lines the October ask audit's definitions leave open: an ask that repeats an earlier ask is DUPLICATE even when the earlier ask was a genuine decision, and a labeller that sees several repeated asks names the latest (the proxy linker also ties to the newest).
6. **Additions the plan didn't list:** the subcommands draw, label, arms, run, scan and synth-check, run's --pilot switch and score's --labels; the reason codes E_ASK_UNFROZEN, E_ASK_INPUT and E_ASK_DRYRUN_FAIL; and a builder count of rule rows with more than one date (deviation 2). The plan's items.ts is types.ts.

### 17. Limits

- A single-decision replay is cleaner than a live thread: the history is laid out, nothing is compacted, and the agent isn't juggling work. The pilot and its ceiling rule guard against that; a live effect needs the simulated-week eval.
- The draft framing tests the moment before send, which is where the ledger acts. It doesn't test whether an agent would have drafted the ask at all.
- Arm (a) holds the owner's own standing rules, several of which are ask rules, so it is "no gstack prose", not "no ask rules".
- Labels are model labels audited by models; no human relabels.
- 8 threads, 3 weeks and one owner; the per-thread spread is shown.
- Every real item names gstack in its owner conversation or rules, because the threads discuss it. Arm (a) holds no line of gstack prose, but its agent works in a world where gstack exists.
- Rule text may carry amendments made after an item's date (section 16, deviation 2).

### 18. Values filled at the freeze

The values above that came from custody were filled at the freeze from `ask-replay build` (bundle counts and digests), `chains-proxy` and `mdd --items` (chains and detectable differences), `arms` (measured tokens and arm (a) cleanliness), `s1` (the pre-pilot S1 readout), `synth-check` (the synthetic overlap check) and the seeds minted in custody; the processors' terms are as published on 2026-11-15. None of them is an outcome. One is left for the push itself: the lane scan count in section 11.

## Review record

One lean /autoplan run, autoplan-20261115054010, reviewed the plan this post freezes, unattended, with the engineering phase only: the CEO and DX lenses were merged into the one engineering reviewer, and the design phase was skipped because the plan has no UI. The reviewer was Claude Opus 5.5; no second-model review ran at this stage. It raised 26 findings: 7 High, 10 Medium, 7 Low and 2 Informational, none Critical. The run log notes that the host had no publication-order guard installed. The full record is attached as autoplan-review-record.md, copied as gstack-autoplan wrote it. Its one issue-key-shaped string is this post's own author code in the answer metadata. The Captain ruled the plan's open points at gate 1 (Big decisions 2, 3 and 6).

## Disclosures

Filled in at the results post from org research/disclosures.md.

## Agent notes

The project owner approved the eval on 2026-11-15 at about $400 to $800 all-in.

Central estimates per spend item, from src/runner/pricing/prices.ts; the Captain's caps are 1.35 times these. I1 to I5 are at the planning sizes in section 14. I6 to I8 are at the measured means, with the replicate-2 cache hit (table below). The item list with central prices goes with READY.

| Item | Central |
|---|---|
| I1 smoke | $8 |
| I2 pilot | $25 |
| I2r pilot retry, if needed | $25 |
| I3 label audit | $41 |
| I4 relabel, if needed | $102 |
| I5 duplicate linking | $16 |
| I6 main run, Opus 5.5 | $308 |
| I7 main run, GPT-6.1 Sol | $154 |
| I8 main run, particle-1 | $7 |

Main-run arithmetic, per item, then times 346 items. Input is the sum of the measured means over the model's arms. Replicate 1 pays the cache-write rate on all of it (Opus and Sol at 1.25 times input; particle-1 has no write rate in prices.ts, so plain input). Replicate 2 pays the cache-read rate. Output is 1.5k tokens per sample, 2 samples per arm, at the output rate. Rates are dollars per million tokens.

| Model | Arms | Input per item | Replicate 1 | Replicate 2 | Output | Per item | Central |
|---|---|---|---|---|---|---|---|
| Opus 5.5 | a to d | 125.2k | 125.2k x 5 = $0.626 | 125.2k x 0.2 = $0.025 | 12k x 20 = $0.240 | $0.891 | $308.30 |
| GPT-6.1 Sol | a to d | 125.2k | 125.2k x 2.5 = $0.313 | 125.2k x 0.1 = $0.013 | 12k x 10 = $0.120 | $0.446 | $154.15 |
| particle-1 | a to c | 98.4k | 98.4k x 0.1 = $0.0098 | 98.4k x 0.003 = $0.0003 | 9k x 1 = $0.0090 | $0.019 | $6.62 |

This is conservative on replicate 1: in (b) and (c) the gstack system prefix is already a cache read for every item after the first, and the table charges it as a write. It assumes replicate 2 always hits the cache. On OpenAI and OpenRouter that depends on the provider's automatic caching.

Central without contingencies is about $559; with both (the R61 pilot retry and the full relabel) about $686. Using the variant bundle for the main run adds about $80 on Opus. The pilot's k = 3 rule sends its projection to the Captain first when the central passes $800. Crew Capy use is separate: estimated $250 to $330 against a $400 stop.
