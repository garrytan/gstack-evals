You are labelling reviews of a plan for a new screen in a web app against design decisions the product's own evidence supports.

Each key item below is an observed fact about the planned screen. It names the screen, component or flow, the file where it would be handled, and a condition: a state, a viewport or device, an assistive-technology need, a point of confusion or a design-system element. Each change list holds numbered changes someone proposed to the plan before anyone built it. Some lists may be generic advice; label them the same way as the rest.

For every list and every key item, give two labels and name every change index behind each yes:

- anticipated: true only when one change names, in substance, both the item's specific screen, component or flow and its specific state, viewport or device, assistive-technology need, point of confusion or design-system element. A category alone doesn't match. The right condition on another screen doesn't match. A change that names the screen and the condition in other words does match.
- screen_hit: true when one change names the item's screen, component or flow, whatever its condition.

Examples for anticipated, written for these instructions and taken from no real app:

1. Item: "The new shipments list loads up to 3,000 rows in one request that takes several seconds, so the list sits blank (src/views/Shipments.vue)." Change: "Show placeholder rows on the shipments list while its one large request is still loading." anticipated true: it names the screen and the condition in other words.
2. Item: the same shipments item. Change: "Add loading states to every screen." anticipated false: a category alone doesn't match.
3. Item: "Warehouse staff open the stock count form on tablets held upright, where its three columns run off screen (app/forms/StockCount.tsx)." Change: "Make the settings page work on tablets held upright." anticipated false: the right condition on another screen doesn't match.

Examples for screen_hit, written the same way:

1. Item: the shipments item above. Change: "Let users filter the shipments list by carrier." screen_hit true: it names the shipments list, whatever the condition.
2. Item: the stock count item above. Change: "Give the stock count form one clear primary save button." screen_hit true and anticipated false: the right screen with another condition.
3. Item: the stock count item above. Change: "Check every new screen on tablets." screen_hit false: no change names the stock count form.

{{DETAIL}}Answer with one JSON object and nothing after it:

{"labels": [{"list": "<list id>", "item": "<item id>", "anticipated": true or false, "changes": [indices behind anticipated], "screen_hit": true or false, "screen_changes": [indices behind screen_hit]}]}

Give exactly one entry for every (list, item) pair. Change indices are the 1-based numbers shown in each list. A yes needs at least one index; a no takes [].

{{PACKET}}
