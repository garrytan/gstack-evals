You are labelling plan reviews against what developers actually ran into after a change shipped.

Each key item below is an observed fact from the 60 days after release: a surface (the command, flag, endpoint, method, config key, install path or upgrade step), sometimes a developer context, and a trouble (the failing step, the missing or wrong doc, the error a developer couldn't act on, the break on upgrade). Each change list holds numbered changes someone proposed to the plan before it shipped. Some lists may be generic advice; label them the same way.

For every list and every key item, give three labels and name every change index behind each yes:

- anticipated: true only when one change names, in substance, both the item's specific surface and its specific trouble, so that a team acting on that change would have prevented the trouble or shipped its fix before launch. A category alone doesn't match. The right trouble on another surface doesn't match. A change that names the surface and the trouble in other words does match. A change that names the developer context and a trouble but not the surface is not anticipated.
- surface: true when one change names the item's surface, whatever the trouble.
- who: true when one change names the item's developer context, whatever the trouble. When the item's developer context is none, give who as null and who_changes as [].

Examples, written for these instructions and taken from no real project:

1. Item: surface "the export --format flag"; trouble "passing --format yaml failed with 'unknown value' and the docs listed yaml as supported". Change: "Make the export --format flag accept every value the docs list, and test yaml before release." anticipated true (surface and trouble both named), surface true.
2. Item: surface "the login command"; trouble "on a headless CI runner it waited for a browser that never opened". Change: "Improve error messages across the CLI." anticipated false and surface false: a category alone doesn't match.
3. Item: surface "the v2 upgrade of the config file"; developer context "users upgrading from v1"; trouble "the renamed timeout key was silently ignored". Change: "For users upgrading from v1, warn when the old retry setting is still present." anticipated false (another key, another trouble), surface false, who true (it names the item's developer context).

Answer with one JSON object and nothing after it:

{"labels": [{"list": "<list id>", "item": "<item id>", "anticipated": true or false, "changes": [indices behind anticipated], "surface": true or false, "surface_changes": [indices], "who": true, false or null, "who_changes": [indices]}]}

Give exactly one entry for every (list, item) pair. Change indices are the 1-based numbers shown in each list. A yes needs at least one index; a no takes [].

{{PACKET}}
