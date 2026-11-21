---
id: 2026-11-21-geva-570-day-one-bash-parser-note
kind: plan
title: "Day-one usefulness eval: the command reader now parses each Bash call with a real bash parser"
summary: "The lane's command reader moves from a hand-written lexer to mvdan/sh's bash parser and fixes nine more shell-form gaps and two receipt bindings. No published count moves."
author: GEVA-570
model: anthropic/claude-opus-5-5
date: 2026-11-21
status: done
links:
  - 2026-11-21-geva-570-day-one-pin-change-note
  - 2026-11-17-geva-549-day-one-pin-change
  - 2026-11-17-geva-549-day-one-usefulness-results
  - lanes/day-one
---

# Day-one usefulness eval: the command reader now parses each Bash call with a real bash parser

The day-one lane decides which autoplan run a gstack session made by reading the session's own Bash calls. Until now a hand-written lexer read them. Every review of it found more shell forms it read wrong: the full review of the last follow-up's final head found nine. This change replaces the lexer with a maintained bash parser and keeps the run-matching rules on top of it. It adds to 2026-11-21-geva-570-day-one-pin-change-note and replaces none of it. Nothing here changes a published verdict or count.

## The parser

Each Bash call is parsed by [mvdan/sh](https://github.com/mvdan/sh), the parser behind shfmt, through [sh-syntax](https://github.com/un-ts/sh-syntax) 0.8.7, its WebAssembly build. NOTICE.md records both, with their licences and versions. The reader walks the parsed tree the way bash runs it.

When the parser refuses a call, the reader no longer guesses. Bash reads each command whole before it runs it, so a call the parser refuses at a line with no command before it ran nothing, as long as `bash -n` refuses the same text. When `bash -n` accepts it, the parser refused a form bash runs (an associative array subscript such as `([/work/app]=1)`, or `$(( (cmd) ) )`), so the call is unreadable. A call refused after an earlier command is unreadable too, because whether the earlier lines ran depends on how the call was run. The same holds for a call that runs more than 10,000 commands or nests more than 16 deep. A session with an unreadable call has no record that counts. A line such as `EOF)`, which closes a heredoc and its `$( )` at once, is split in two before a second parse, as bash reads it.

## What the reader now reads as bash does

Each fix has a test that failed before it.

- A pipeline or `&&` list that a newline continues and an `&` ends runs in the background whole, not just its last member.
- A subshell, a pipeline member, a statement an `&` ends, a substitution and a child shell each get a copy of the shell. A `cd`, a variable or a function they set stays inside them, and a `bash -c` child starts with no functions.
- A function's `$1`, `$2` and `"$@"` are its call's arguments, and `bash -c` gets its own.
- Assignments on one line take effect left to right, and a command's own assignments reach only that command.
- A function's `local`, `declare` and `typeset` names go back to the caller's values when it returns, before its call's own assignments are undone. `declare -g` sets the caller's variable.
- A function defined inside `eval` or `bash -c` reads its own text when it is called later.
- `&>`, `&>>` and `|&` are a redirect and a pipe, never a background `&`.
- A function defined after `then`, or with a redirect on its definition, edits nothing until it is called. `command` and `builtin` skip functions.
- A `for` or `if` body that an `&` ends runs in the background. A `for` loop reads its body once per item.
- A function that calls itself is read once, so it ends in bounded time.
- Inline code that names two run.json paths in one token names both.

## One change to the run-matching rules

- A start run in the background is matched to the run it made until the next Bash call holding a start begins. That call's start time counts even before it has a result, and a second start in the same Bash call no longer closes the window at once.

A rule that a start whose `--out` the log spells out makes only the run at that `--out` was tried and dropped. The reader cannot always tell which folder a relative or `$PWD` `--out` resolves against (after `cd "$(git rev-parse --show-toplevel)"`, `cd -`, a failed `cd` or Claude Code's own reset of its shell folder), and the rule then refused the run the start really made. Timing alone ties the start to its run, as on main. So a run created while two starts span it stays unmatched, even when one of them names another folder.

## Two receipt bindings

- A validation receipt now records a digest of the check rows it scored. A reading counts only when its own check rows under the receipt's tags match that digest, so a receipt from another output tree that reuses the tag no longer counts.
- The fixtures receipt from the real checker now records the checker's identity. A reading counts only when it matches every check stage in the reading, so a passing receipt from an older checker no longer stands in.

The E_DAYONE_BACKGROUND text now says the cell's last attempt ended that way, not both attempts.

## Why no published count moves

The sealed stage outputs were opened into RAM and read with the reader on main and the changed one, printing counts only. The custody record logs each opening.

- The first run of the comparison found 2 category 2 A sessions with one call the parser refused. Both were one line with an unclosed quote that `bash -n` refuses too, and neither named gstack-autoplan. That led to the first-line rule above.
- With it, in all 50 counted gstack sessions the changed reader finds the same run, exposure, frozen exposure, voice, reason and unmatched count as the reader on main, and both match the stored rows: A 13, S-dayone 12 and S-full 12 exposed of 15 each in category 2, 10, 12 and 11 under the frozen rule, and category 1 A 2 of 5. No call is unreadable, and no start runs in the background.
- Neither checker validation was admitted, so the new receipt bindings block the same readings they already blocked.
