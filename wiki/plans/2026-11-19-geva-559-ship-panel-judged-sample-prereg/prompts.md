# Frozen prompts and output schemas

Every call sends one item: the system text for its call, then the item's packet (README section 4). The answer must be one JSON object with exactly the fields below and nothing around it. A response that isn't gets one retry with the same input; a second failure makes the item unscorable for that call.

Classes come from gstack's review policy (docs/review-policy.md at gstack 5afef04e): a blocker is the intended case gone wrong, a should is a real bug a caller will hit inside the intended case, and a nit is the rest.

## Call A1: was the fixed finding a real defect? (judge and both labellers, reviewer masked)

System text:

> You are reading one finding a code reviewer raised on a pull request, and the change that fixed it. Decide whether the finding described a real defect in the code as it stood before the fix, and how serious it was. Use exactly one class:
>
> - blocker: the intended case goes wrong. The code would fail a test, break production (a crash, a hang, a wrong result a user or operator relies on, a wrong published number), or lose data or secrets. Data loss, a trust-boundary bypass and uncapped spend are always blockers.
> - should: a real bug that a caller will hit inside the intended case, below the blocker bar.
> - nit: real but minor: wording, naming, style, a comment, a document, or a missing or weak test for code that works.
> - not_defect: the code was right before the fix, or the finding states a preference.
> - cant_tell: the packet does not show enough to decide.
>
> Also say whether the text describes one problem that this change fixes (one_finding). Judge the code, not the reviewer's confidence or severity label. Reviewer names and finding ids are masked as [reviewer] and [id].
>
> Answer with one JSON object: {"item": "<item id from the packet>", "one_finding": true or false, "class": "blocker" | "should" | "nit" | "not_defect" | "cant_tell", "reason": "<at most 60 words>"}

The labellers' system text adds one paragraph before the answer line:

> You also see what happened to these lines afterwards, under LATER. Use it as evidence: a later change that undoes or repairs the fix, or a test that later fails on these lines, bears on your answer.

## Call A2: did another finding on the pull request describe the same defect? (judge and both labellers, every part A item)

System text:

> You are given one finding raised on a pull request, the change that fixed it, and two lists of the other findings raised on the same pull request. FIRST PASS lists the first pass's findings: the lead review and its specialist readers (testing, security, state machines, API contract, claim checks and similar). LATER VOICES lists the findings of the reviewers that run after or beside the first pass: the red team, the adversarial reader and the second-model review. Each listed finding has an id and says whether it has a trailer. For each list, say which findings describe the same defect as this one: the same wrong behaviour at the same place, even in other words. A finding about another symptom, another place, or a broad area that merely contains this defect does not count.
>
> Answer with one JSON object: {"item": "<item id from the packet>", "same_first": [<every first-pass id that matches; empty when none>], "same_later": [<every later-voice id that matches; empty when none>], "reason": "<at most 40 words>"}

## Call B: did a later pull request correct a defect in this one? (judge and both labellers)

System text:

> You are reading lines a merged pull request added (EARLIER) and a later pull request, merged within 7 days, that changed some of those lines (LATER). Decide:
>
> - corrects: did the later change correct a defect in the earlier lines? "yes", "no" or "cant_tell". A refactor, an extension, a rename, a planned follow-up or a change of requirements is "no".
> - class: when corrects is "yes", the defect's class: "blocker", "should", "nit" or "cant_tell", with the meanings below. Otherwise null.
> - visible: could a careful reviewer reading only the earlier pull request's diff have seen the defect? "yes", "no" or "cant_tell". Null when corrects is not "yes".
> - raised: when the packet lists the earlier pull request's review findings, the id of one that describes this defect, or "none". "no_list" when the packet has no list.
>
> A blocker is the intended case going wrong: a failed test, broken production (a crash, a hang, a wrong result a user or operator relies on, a wrong published number), or lost data or secrets; data loss, a trust-boundary bypass and uncapped spend are always blockers. A should is a real bug a caller will hit inside the intended case, below that bar. A nit is real but minor: wording, naming, style, a comment, a document, or a missing or weak test.
>
> Answer with one JSON object: {"item": "<item id from the packet>", "corrects": "yes" | "no" | "cant_tell", "class": "blocker" | "should" | "nit" | "cant_tell" | null, "visible": "yes" | "no" | "cant_tell" | null, "raised": "<a finding id>" | "none" | "no_list", "reason": "<at most 60 words>"}

The labellers' version adds the LATER-history paragraph from call A1, reading "the later pull request's full commit messages" for "what happened to these lines afterwards".

## Settings

| Role | Model | Route | Settings |
|---|---|---|---|
| Judge | google/gemini-4-carbon | OpenRouter, provider google-vertex only, no fallbacks, data_collection deny | reasoning effort high, max output 16,000 tokens, temperature unset |
| Labeller 1 | claude-opus-5-5 | Anthropic API | effort high, max output 16,000 tokens |
| Labeller 2 | gpt-6.2-astra | OpenAI API | reasoning effort high, max output 16,000 tokens |
