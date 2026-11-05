# Judge brief: CEO outcome eval (GEVA-285)

You judge plan reviews against what really happened to the plan. You see one unit at a time: the plan (plan.md), the unit's key, and a set of reviews. Each review is a list of at most three issues, ranked by its writer, each cut to its first 40 words. You don't know who wrote any review, and the reviews are in random order.

## The key

- D: the decisive issue, the main reason the public record gives for what happened to the plan (it was rejected, reversed or cut back). A key may add D2, a second wording the record supports equally. A match to D2 counts as a match to D.
- R1 to R3: other issues the record shows were real, when there are any.
- Match notes: what an issue must name to match D, and near misses that don't.

## Labels

Give each issue in each review one label:

- D, when the issue names the same thing going wrong as D, for the same reason, in this plan's terms. It must name the specific thing the key names: the feature, behavior, user group, constraint or decision. A category alone is not a match, even when D falls in that category. "Maintenance burden", "backward compatibility", "unclear demand" and "the scope is large" are categories.
- R1, R2 or R3, under the same rule for that issue.
- none, otherwise.

An issue gets one label. When it fits both D and an R, label it D. Judge each issue on its own words: the other issues in the same review don't change its label. Ignore severity words, length, tone and style. Judge an issue on its main problem, the first problem it states. An issue that lists several problems matches D only when that first problem is D, stated as specifically as the rule asks; a later problem in the same issue never earns D.

## Leak

For each review, also answer leak: yes when the review states as a known fact what happened to this plan after it was written (for example, that it was rejected or reverted), instead of predicting it. Otherwise no.

## Output

One JSON object per review, one per line, in a fenced block whose info string is ceo-judge:

{"review": "<review id>", "labels": ["D", "none", "R2"], "leak": "no"}

labels has exactly one entry per issue, in the review's rank order, and is empty for a review with no issues. Answer for every review in the unit, with no other text inside the block. Labels other than D, R1, R2, R3 and none are not accepted.

---

The D read's prompt is everything above the rule, byte for byte as the preregistration froze it (sha256 83d5d644b97aa87003ea38a8cb273b64590f1c50129430612af2432072852589). The remedy read's prompt is everything below it. The two reads are separate calls, and a D label never comes from the remedy read.

## Remedy read

You judge whether plan reviews name the change that would have changed what happened to the plan. You see one unit at a time: the plan (plan.md), the key's remedy with its match notes, and a set of reviews. Each review is a list of at most three issues, ranked by its writer. Each issue shows its text cut to its first 40 words, then its fix cut to its first 40 words; a review that gave no fix shows "no fix". You don't know who wrote any review, and the reviews are in random order.

- Remedy: the change the public record shows would have changed what happened to the plan: the scope the maintainers asked for, an existing alternative, a different approach, or not building it when the record rejects the plan's premise.
- Remedy match notes: what a fix must name to match the remedy, and near misses that don't.

For each issue, answer rem:

- yes, when the first remedy its fix states names the same change as the key's remedy, for this plan, as specifically as a D match must be. A category alone is not a match: "start smaller", "reuse an existing tool" and "don't build it" match only when they name what the remedy names, such as which smaller version, which existing tool, or that the premise fails for the reason the remedy gives.
- no, otherwise, and always for "no fix".

Answer rem for every issue, whatever you think of the issue itself. Only the first remedy a fix states counts: a later remedy in the same fix never earns rem. Ignore severity words, length, tone and style.

## Remedy output

One JSON object per review, one per line, in a fenced block whose info string is ceo-judge-rem:

{"review": "<review id>", "rem": ["yes", "no", "no"]}

rem has exactly one entry per issue, in the review's rank order, and is empty for a review with no issues. Answer for every review in the unit, with no other text inside the block. Values other than yes and no are not accepted.
