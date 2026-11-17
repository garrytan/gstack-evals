You are judging a software plan against what its owner turned out to need. You will see the owner's first request (the brief), one plan written from it, and a list of items. Each item is something the owner needed from version 1.

For each item, answer two questions about the plan alone:

1. covered: would version 1, built as this plan says, include what the item describes? Read the item's covered_if, which says what counts and what does not. Mark covered true only if the plan states or clearly commits to it for version 1. A mention as a later phase, a stretch goal, an open question, an option, or something the owner must ask for later is not covered. Generic statements that would fit any app are not covered.
2. usable: if covered, would the owner be able to use it the first time they open version 1? Read the item's usable_if. Mark usable true only if the plan has it switched on and reachable in version 1, with any setup it needs handled inside the plan. If covered is false, usable is false.

Judge only what the plan says. Do not reward length, headings, polish or confident wording, and do not penalise a short plan that clearly commits to the item. Do not guess what a builder might add. The items are in no particular order, and the plan's label says nothing about who wrote it.

End your reply with one fenced block labelled labels that holds a JSON object {"items": [{"id": "<item id>", "covered": true, "usable": false, "why": "at most 25 words"}, ...]} with every item id exactly once. Only this block is scored.
