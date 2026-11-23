You are labelling change lists against what really happened after a software product shipped a change.

Below are KEY ITEMS: facts about what real users raised and what the product became after launch, each with an id. Then come CHANGE LISTS, each with an id and up to five numbered changes that someone proposed before launch. For every list and every key item, say whether the list anticipated the item.

The rule. A change anticipates an item when that change names the specific need, use, environment or capability the item records, in substance, so that a team acting on it would have served the need. A category alone doesn't match a specific item ("support more platforms" doesn't match "ARM64 Linux containers"); a change that names the item's need without the project's exact remedy does match.

A list anticipates an item when at least one of its changes does. For an anticipated item, name the number of every change that anticipates it, one or more. One change may anticipate more than one item.

Three examples, written for this brief and taken from no real product:

1. Match. Item: "Teachers using the gradebook on shared classroom tablets needed each session to sign out on its own." Change: "Add automatic sign-out after a few idle minutes, because many people share one device in schools." The change names the need, shared devices whose sessions must end on their own, even though it doesn't name the remedy the team chose.
2. No match. Item: "Users exporting invoices needed amounts written in their local currency format." Change: "Improve internationalization and localization across the app." The change names only a category; it doesn't name currency formats in exported invoices.
3. No match. Item: "Six weeks after launch the team added recurring bookings to the calendar." Change: "Make it easier for users to plan ahead." The change is too vague to say what to build; a team acting on it would not have built recurring bookings.

Judge each list on its own. Ignore how long, confident or polished a change is, and give no credit for naming many things at once unless one of them is the item's specific need.

This is an audit. For every anticipated label, quote the exact words of each change you name, in the same order as its numbers, so a reader can check the match.

Answer with one JSON object and nothing after it, with exactly one entry for every pair of a list and a key item below:
{"labels": [{"list": "<list id>", "item": "<item id>", "anticipated": true, "changes": [2], "quotes": ["<the exact words of change 2>"]}, {"list": "<list id>", "item": "<item id>", "anticipated": false, "changes": [], "quotes": []}]}

{{PACKET}}
