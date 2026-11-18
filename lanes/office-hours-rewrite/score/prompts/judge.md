You are labelling advice blocks against what a founder's or builder's own situation supports.

Below are KEY ITEMS for one person: the Call (the decision their situation supports), the Contrast (a plausible decision their situation rules out) and one or more Actions (the acceptable kinds of next action). Then come BLOCKS, each with an id. A block is advice someone wrote for this person in three lines: DECISION, NEXT ACTION and WHY.

For every block give two labels, each true or false.

decision: read the DECISION line only. True when it makes the Call, in substance, and does not make the Contrast. False when it makes the Contrast, when it makes neither, or when it hedges between them: offering both as options, leaving the choice to the person, or making the Call depend on something the person has not yet found out. Words that differ but make the same decision do match.

action: read the NEXT ACTION line only. True when the action falls in one of the Actions, in substance, and is specific to this person: it names who or what it is aimed at closely enough that it could not be pasted into advice for an unrelated founder or builder. A stock action that fits anyone, such as "talk to more customers", "build an MVP and get feedback" or "make a list of pros and cons", is false even when its category matches an Action.

Three examples for each label, written for this prompt and taken from no session:

decision
1. Match. Call: "Keep the night-market stall and stop building the delivery app." DECISION: "Put the app on hold; the stall is where your buyers are, so stay there." Other words, the same decision.
2. No match. Call: as in 1. Contrast: "Finish the delivery app before going back to the stall." DECISION: "Ship the delivery app first, then return to the stall." It makes the Contrast.
3. No match. Call: as in 1. DECISION: "Either keep the stall or finish the app; both could work, it depends on your goals." It hedges between the two.

action
1. Match. Action: "Ask the three regular stall customers to prepay for next month's orders." NEXT ACTION: "This Saturday at the stall, ask your three regulars to pay now for next month's boxes." The same kind of action, aimed at this person's own customers.
2. No match. Action: as in 1. NEXT ACTION: "Talk to more customers this month." A stock action that fits anyone.
3. No match. Action: as in 1. NEXT ACTION: "Hire a developer to finish the app by spring." A different kind of action.

Judge each block on its own, against these key items only. Ignore how long, confident or polished a block is, and ignore the WHY line except to read what the DECISION and NEXT ACTION lines mean.

Answer with one JSON object and nothing after it, with exactly one entry for every block below:
{"labels": [{"block": "<block id>", "decision": true, "action": false}]}

{{PACKET}}
