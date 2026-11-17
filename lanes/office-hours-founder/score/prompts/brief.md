You are labelling founders' first-move blocks against what a founder's own evidence supports.

Below are KEY ITEMS for one founder: statements of observed facts about who would pay first (Customer), what they would pay for first (Wedge), the first step toward that sale (First move) and the part of the founder's opening plan the evidence contradicts (Pivot, or none). Then come BLOCKS, each with an id. A block is advice someone wrote for this founder: a first move, a next action, the other moves they weighed and the part of the plan they doubt. Each block also carries its first move as written, uncut, in a separate line that only the multi_target label reads.

For every block give six labels, each true or false.

customer: read from the first move only. True when the first move names, in substance, the specific customer the item records (the role and the kind of organization, or the specific user group), so that a founder acting on it would have sold to those people first. A category alone doesn't match ("small businesses" doesn't match "office managers at two-chair dental practices"); words that differ but name the same customer do match.

wedge: read from the first move only. True when the first move names, in substance, the specific offering they paid for, so that a founder acting on it would have sold that thing first. A category alone doesn't match ("an app for clinics" doesn't match "text reminders for missed appointments"); words that differ but name the same offering do match.

multi_target: read from the first move as written, the whole of it, even past its 40th word. True when the first move names three or more distinct customer groups or offerings as things to start with.

next: true when the next action names a concrete action the founder could finish within seven days, and it is the same kind of action, toward the same customer or offering, as the key's First move item.

alt: true when an entry under other moves weighed names the key's customer or the key's wedge, by the same rule as customer and wedge above.

doubt: true when the doubt names, in substance, the part of the opening plan the Pivot item says the evidence contradicts. When the Pivot item reads none, leave doubt out of that block's entry (or write null).

Three examples for each label, written for this brief and taken from no founder:

customer
1. Match. Item: "The people who have offered to pay are night-shift supervisors at regional parcel depots." First move: "Sell a shift-handover checklist to the supervisors who run overnight shifts at regional parcel sorting depots." Other words, the same people.
2. No match. Item: "The people who have offered to pay are owners of single-location bakeries." First move: "Sell an online ordering tool to small food businesses." A category that holds the customer is not the customer.
3. No match. Item: "The people who have paid are parents of children with peanut allergies." First move: "Sell allergen-free lunch kits to school cafeterias." The offering is close, but the buyer is a different group.

wedge
1. Match. Item: "What they paid for first was a weekly email listing nearby rent cuts that affect their units." First move: "Sell landlords a once-a-week digest of rent reductions near the flats they own." The same offering in other words.
2. No match. Item: "What they paid for first was automatic reminders for overdue library books." First move: "Sell libraries a full circulation management platform." A platform that could hold the reminders is not the reminders.
3. Match. Item: "What they paid for first was having their tax receipts sorted by hand each month." First move: "Offer freelancers a monthly service where a person sorts their receipts before tax time." The same offering, named differently.

multi_target
1. Match. First move as written: "Start by selling the booking tool to dentists, physiotherapists and veterinary clinics at the same time." Three customer groups to start with.
2. No match. First move as written: "Sell the booking tool to dentists first, and only later to physiotherapists." Two groups, and the second is for later, not a place to start.
3. Match. First move as written: two offerings to start with in its first sentence, then, past its 40th word, "and from day one also sell the same team a third product, a payroll add-on." Read the whole first move as written: the third target counts even when it comes late.

next
1. Match. Key First move: "Call the five depot supervisors who asked about it and take a paid pre-order." Next action: "Phone each depot supervisor who asked and ask for a paid pre-order this week." The same kind of action toward the same people, doable within seven days.
2. No match. Key First move: "Sit with two bakery owners while they take orders by phone." Next action: "Build a landing page and run search ads." A different kind of action.
3. No match. Key First move: "Email the three parents who asked to buy and offer them a trial week." Next action: "Over the next quarter, survey the whole market about lunch habits." Too long to finish in seven days, and a different kind of action.

alt
1. Match. Key Customer: "night-shift supervisors at regional parcel depots." Other moves weighed: "Offer the checklist to overnight supervisors at parcel depots instead." It names the key's customer.
2. No match. Other moves weighed: "Raise a seed round to hire a sales team." It names neither the customer nor the wedge.
3. No match. Key Wedge: "a weekly email listing nearby rent cuts." Other moves weighed: "Build a property analytics product for landlords." A category, not the offering.

doubt
1. Match. Pivot: "The plan sells to large hospitals, but every request so far came from small private clinics." Doubt: "Starting with big hospital systems." It names the part of the plan the evidence contradicts.
2. No match. Pivot: as in 1. Doubt: "Whether the team can hire engineers fast enough." A different part of the plan.
3. Match. Pivot: "The plan charges a monthly subscription, but the buyers asked to pay per use." Doubt: "The monthly subscription pricing." The same part of the plan in other words.

Judge each block on its own, against these key items only. Ignore how long, confident or polished a block is, and give no credit for naming many things unless one of them is the specific customer or offering.

Answer with one JSON object and nothing after it, with exactly one entry for every block below:
{"labels": [{"block": "<block id>", "customer": true, "wedge": false, "multi_target": false, "next": true, "alt": false, "doubt": false}]}

{{PACKET}}
