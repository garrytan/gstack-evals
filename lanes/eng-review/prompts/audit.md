You are labelling test plans against what really happened after a software change merged.

Below are KEY ITEMS: facts about what happened in the 60 days after the change merged (a defect that was fixed, a test the project added later, a CI or eval change), each with an id. For a defect, the files and functions where it sat follow its statement. Then come CHECK LISTS, each with an id and up to eight numbered checks that someone proposed before the change was built. For every list and every key item, give two labels.

anticipated: one check names, in substance, both the specific code path or user flow the item records and the specific condition, input, environment or behavior that failed or was later tested, so that running that check as written would have caught the defect or checked that behavior. A category alone doesn't match ("test error handling" doesn't match "returns 500 on an empty tag list"); the right condition on another path doesn't match; a check that names the path and condition in other words does.

path_hit: one check names the item's path or flow, whatever its condition.

For each yes, name the number of every check behind it, one or more. One check may stand behind more than one item. For each anticipated item, also say whether the check you credit proposes a check (a test, a CI job or an eval) or a code change (a fix or a design change to the code itself): "credit" is "check" or "code".

Three examples, written for this brief and taken from no real project:

1. Match. Item: "The upload form accepted a file name with a trailing space and then could not find the file (forms/upload.py)." Check: "Unit test in forms/upload.py that a file name ending in a space is trimmed or refused before it is stored." The check names the path and the condition, so running it would have caught the defect. anticipated and path_hit are both yes.
2. No match. Item: "Later the project added a test that the scheduler skips jobs whose start time is in the past (core/scheduler.go)." Check: "Unit tests for every function in core/scheduler.go, covering valid and invalid input." It names the path but only a category of condition. anticipated is no; path_hit is yes.
3. No match. Item: "Later the project added Windows to the CI matrix for the path-joining helper (util/paths.rs)." Check: "A CI job that runs the date-parsing tests on Windows." It names the right environment on another path. anticipated and path_hit are both no.

Judge each list on its own. Ignore how long, confident or polished a check is, and give no credit for naming many things at once unless one of them names the item's path and condition.

This is an audit. For every anticipated label, quote the exact words of each check you name, in the same order as its numbers, so a reader can check the match.

Answer with one JSON object and nothing after it, with exactly one entry for every pair of a list and a key item below:
{"labels": [{"list": "<list id>", "item": "<item id>", "anticipated": true, "checks": [2], "quotes": ["<the exact words of check 2>"], "path_hit": true, "path_checks": [2], "credit": "check"}, {"list": "<list id>", "item": "<item id>", "anticipated": false, "checks": [], "quotes": [], "path_hit": false, "path_checks": [], "credit": null}]}

{{PACKET}}
