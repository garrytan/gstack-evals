# Told text, review lane and TB2 lane

Frozen for stacks round 1. The review template is `TOLD_TEMPLATE` in src/trial/review/told.ts at the rig pin (gstack-evals 2194879). Its sha256, the string exactly as below with no trailing newline, is:

    16862a34212cd2eddbcedbc5654b26cb92b0dad50e3d501686770e6bc3d088ad

tests/trial/review/told.test.ts pins that value, so an edit to the text fails CI. `{base}` is replaced by the unit's base branch name (main for garrytan/gstack units, master for garrytan/gbrain units).

```
Review the changes on this branch against the base branch {base}: the commits this branch adds since it left {base}, as git diff {base}...HEAD shows them.

You may write and run throwaway tests, repro scripts and commands, but only under a scratch directory outside this repository (for example one made with mktemp -d). Do not change the code under review, and do not commit or push.

End your reply with one fenced json block that lists your findings: a JSON array with one object per finding, or [] when you have none. Each object has these fields:
- "file": the path of the file, relative to the repository root
- "line": the line number on this branch, or null
- "severity": the label your review procedure gives the finding
- "claim": what is wrong, in one or two sentences
- "evidence": what shows it, such as the code involved or a command you ran and what it printed
- "confirmed": true or false when your procedure confirms findings by running something; leave it out otherwise
```

## Prefix per review arm

The prompt is the prefix, one space, then the template. none has no prefix.

| Arm | Prefix |
|---|---|
| none | (none) |
| gstack | `/review` |
| pstack | `/pstack:interrogate` |
| tstack | `/sol-loop Run one review round and stop before any fix.` |

The findings parser is src/trial/review/findings.ts at the rig pin, sha256 584c81bcc40202798713cec9647c3a45c282373b379196e8fee413caa7ddb959 (`PARSER_SHA256`, the session key's verifier part).

## TB2 told lines

The prompt opens with the arm's command and one space, as in Lane B quick look 3. The skill per arm and task is quick/laneb/runner/skill-map.stacks.json at runner tag laneb-stacks-1-runner, sha256 e0d23b93611ec227ef671f231e7c55e072dd28c4c81d120b5aa22431fc2dbe7f.

| Arm | Told line |
|---|---|
| none | (none) |
| gstack | `/investigate` |
| placebo (gstack-placebo) | `/investigate` |
| pstack | `/pstack:poteto-mode` |
| pstack-placebo | `/pstack:poteto-mode` |
