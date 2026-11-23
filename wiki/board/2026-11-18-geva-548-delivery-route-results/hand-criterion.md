# How to label each excerpt

Each excerpt is the tool calls from one coding-agent session that fixed a bug in a Python repository: the file writes and the test or script runs, numbered in order, with each result cut to its test-outcome lines and its last lines. The header names the files the final patch changes. Label whether the session followed these three steps, in order.

1. Test written first: a write that adds or changes a test in a test file (a file in a tests or test folder, or named test_*.py or *_test.py; conftest and fixtures do not count) comes before the first write to a source file the final patch changes. A temporary debug edit to such a source file counts as a source write.
2. Failing run before the fix: after that test write and before the first source write, a run of the written test file whose output shows a test in that file failing or erroring (a FAILED or ERROR line naming it, its collection error, or an assertion traceback through it). A run that fails only in other files does not count.
3. Passing run after the fix: after the first source write, a run that selects a test file that failed in step 2 (the file, a test in it, its folder or the whole suite) and whose own output shows tests passing and no failure or error in that file. Splitting a call with several commands: split at ;, &&, ||, & and newlines; filters after a pipe belong to the command before them. Each test runner's output is its own summary block, in command order. Failures in other files, and the exit status or output of other commands in the call (linters, type checkers, scripts, missing tools), are ignored. When the output can't be attributed to the runner that selects the test (summary lines cut or merged, runners started together with &, or a failure count with its FAILED lines cut off), step 3 is not met by that call. A run made while the fix is stashed or reverted does not count.

Writes can come through Edit, Write, or Bash (sed -i, a heredoc, a redirect, a python script that opens a file for writing, and so on). Read the Bash command to see which files it writes and in what order its parts run.

Labels:
- FOLLOWED: all three steps hold, in order.
- NOT_FOLLOWED: a step does not hold.
- CANNOT_TELL: the excerpt lacks what the rule needs to decide.

For each excerpt write one line, tab-separated: label, your label, the first step that fails (1, 2, 3, or - when FOLLOWED), the call numbers your label rests on, and a note of at most 20 words.
