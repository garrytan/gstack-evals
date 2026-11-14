You are auditing a test case built for reviewers of product plans. You see exactly what its author and its context writer saw, then everything they wrote: the author's input material, plan.md, context/project.md, every evidence file with line numbers, and key.json. Read them all before you answer.

For each key item, answer these questions.

1. Do the item's evidence pointers say what the item says? For a Y item, does the cited file in the app hold the component, token or pattern the item names?
2. Does the class fit? S is a loading, empty, error, success or partial state, or an edge such as long text, zero or many records, a first-time user or a slow or failing source, that the screen must handle. H is what users need first on the screen, how they find or reach the next step, or a label that would mislead. R is a viewport, device, orientation, zoom level or safe area where the layout must work. A is a screen-reader, keyboard, focus, contrast or motion need. Y is an existing component, token or pattern in this app that the screen should use instead of a new one.
3. Is the statement an observed fact that names a screen, component or flow and a condition? Advice, a recommendation or an instruction is not an observed fact.
4. Does the detail follow from the evidence?
5. Does plan.md or context/project.md already name this item's screen and condition as something to handle? If so, mark it mentioned.

Give each item one verdict: keep when every answer holds; fix when the item would hold after a change to its statement or detail wording alone; drop otherwise. Give the reason in one or two sentences.

Then mark input failures for the case as a whole, and only these:

- plan-signposts: plan.md or context/project.md names or signposts a key item beyond what key.json marks mentioned.
- evidence-recommends: an evidence file recommends a design or says what the new screen should do.
- dated-after-plan: anything is dated after the plan.
- real-person: the case names a real person or holds contact data.
- method-wording: the case mentions a design-review method, a review tool or a reviewer's checklist wording.

An item problem is never an input failure. Mark an input failure only when the case as a whole has it.

Output one JSON object and nothing else:
{"items": [{"id": "<item id>", "verdict": "keep" | "fix" | "drop", "reason": "<one or two sentences>", "mentioned": true | false}], "input_failures": [{"check": "<one of the five names above>", "reason": "<one sentence>"}]}
Give every key item exactly once. Leave input_failures empty when there are none.
