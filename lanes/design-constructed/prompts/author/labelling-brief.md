You are labelling lists of plan changes against key items. Each key item records a design decision about a planned screen: the screen, component or flow, and its condition. Each list holds numbered changes a reviewer would make to the plan. For every list and every key item, give these labels.

Anticipated: yes when one change names, in substance, both the item's specific screen, component or flow and its specific state, viewport or device, assistive-technology need, point of confusion or design-system element. A category alone doesn't match. The right condition on another screen doesn't match. A change that names the screen and condition in other words does. Name every change number behind a yes.

- Match: item "the shipment table shows a blank grid while its 8-second query runs"; change "Show placeholder rows in the shipment table while the slow query loads." Same table, same loading condition.
- Match: item "the booking form's date picker is used on phones held sideways"; change "Lay out the booking form's date picker for landscape phones." Same component, same orientation.
- Match: item "the settings toggles have no visible focus when tabbed to"; change "Give each toggle on the settings page a visible keyboard focus outline." Same controls, same focus need.
- No match: item "the shipment table shows a blank grid while its 8-second query runs"; change "Add loading, empty and error states to every screen." A category with no screen.
- No match: item "the booking form's date picker is used on phones held sideways"; change "Make the checkout page work on phones." Another screen, and no orientation.
- No match: item "the settings toggles have no visible focus when tabbed to"; change "Check the settings toggles' colour contrast." Same controls, another condition.

Screen hit: yes when one change names the item's screen, component or flow, whatever its condition. Name every change number behind a yes.

- Match: item about the shipment table's loading; change "Add CSV export to the shipment table." Same screen, another condition.
- Match: item about the booking form's date picker; change "Default the date picker to next week." Same component.
- Match: item about the settings toggles' focus; change "Group the settings toggles under headings." Same controls.
- No match: item about the shipment table; change "Add a search box to the customer list." Another screen.
- No match: item about the booking form; change "Write a design spec before building." No screen.
- No match: item about the settings toggles; change "Use the design system's colours everywhere." No screen named.

Detail (only when the packet says "Details: yes"): for each anticipated item that has a detail and each change number behind that yes, say whether that change also states the detail in substance: the value, threshold, component or rule. A different value is no. A near paraphrase of the same value is yes.

- Yes: detail "first 50 rows within 2 seconds"; change "Render the first 50 shipment rows within 2 seconds, then stream the rest."
- Yes: detail "landscape at 640 by 360"; change "Fit the date picker to a 640 by 360 landscape phone screen."
- Yes: detail "3-pixel focus outline in the brand blue"; change "Draw a 3px focus ring in brand blue on each toggle."
- No: detail "first 50 rows within 2 seconds"; change "Show the first 100 rows quickly." A different value.
- No: detail "landscape at 640 by 360"; change "Support landscape phones." No value.
- No: detail "3-pixel focus outline in the brand blue"; change "Add a visible focus state to each toggle." No rule.

Label every list against every item; leave nothing out. Output one JSON object and nothing else:
{"cells": [{"list": "<list id>", "item": "<item id>", "anticipated": true | false, "anticipated_changes": [<change numbers>], "screen_hit": true | false, "screen_hit_changes": [<change numbers>], "detail_changes": [<change numbers behind the anticipated yes that state the detail>]}]}
Every yes needs at least one change number. Give detail_changes only when the packet says "Details: yes".
