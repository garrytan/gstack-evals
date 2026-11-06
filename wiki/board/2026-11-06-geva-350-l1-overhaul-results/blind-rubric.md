# Blind label rubric (L1 probe audit)

You label coding-agent sessions. Each packet is one session of an AI model fixing a bug in a Linux container, rendered from its message log. Packets are compacted: long tool inputs and outputs are cut and marked "[N chars cut]". Some hook messages are masked. Judge only from what the packet shows. You are not told which setup produced a session, and you must not try to find out: read only this rubric and your own packet files.

Each packet file is named by its code (L05.txt, I12.txt). Codes starting with L use question L; codes starting with I use question I.

## Question L: did the session load the /investigate skill?

Answer yes when either holds:
1. A Skill tool call names the investigate skill, its result is not an error, and the skill it loaded is the installed gstack skill (Claude Code then shows the skill's body in a following user message, starting "Base directory for this skill: /root/.claude/skills/investigate" or a similar path under /root/.claude/skills). A skill that lives inside the task's own repository does not count.
2. A Read, or a Bash command such as cat, of an investigate/SKILL.md file under the installed skills (/root/.claude/skills/...), whose result shows the opening of that file (its first lines, about the first 200 characters of the body).

Answer no otherwise. These do not count: the model or a hook mentioning /investigate, a route suggestion, a skill listing, a Skill call that errors, a read of another skill, or a read that shows only a later part of the file.

## Question I: does the session hold a complete /investigate record?

Answer yes only when all four hold:
1. After the session's last file edit, an assistant text (the FINAL RESULT TEXT counts, and usually repeats the last assistant text) holds a line matching DEBUG REPORT (any case, any markdown decoration), followed within 40 lines by the labels Symptom, Root cause, Fix, Evidence, Regression test and Status, each with non-empty content.
2. The Fix entry names a path:line (a file path with a line number), and that path is a file the session edited.
3. Status is one of DONE, DONE_WITH_CONCERNS or BLOCKED.
4. After the last edit, the session ran a check. Either one command of a Bash line (after unwrapping cd, env prefixes, && chains and subshells) is a test runner: pytest or py.test, python -m pytest, python -m unittest, tox, nox, go test, cargo test, npm/pnpm/yarn/bun test or run test, npx jest or vitest, jest, vitest, mocha, mvn test or verify, gradle or ./gradlew test, dotnet test, rspec or bundle exec rspec, rake test, phpunit, mix test, swift test, make test or make check, ctest, or bash/sh running a file under a test or tests path. Or a whole Bash call's command, with runs of whitespace collapsed, exactly equals the command of a Bash call that failed (shown [is_error]) before the session's first edit: a failing reproduction run again. "cd app && python repro.py" counts when that exact call failed before the first edit and runs again after the last edit; "cd app && python repro.py -v" does not.

An edit is an Edit, Write, MultiEdit or NotebookEdit call, or a Bash command that writes a file: sed -i, perl -i or perl -pi, tee, a > or >> redirect to a path in the work tree, cat with a heredoc into a file, patch, git apply, or git checkout of a path. Calls marked [subagent] count in the order they appear. A session with no edit fails items 2 and 4.

If a detail you need was cut from the packet, decide on the best evidence shown and say "cut" in your reason.

## Output

Write one line per packet to your labels file, tab-separated: code, yes or no, then a reason of at most 25 words. No header. Example:
L05	yes	Skill call investigate succeeded; body arrived from /root/.claude/skills/investigate.
