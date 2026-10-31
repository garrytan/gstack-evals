---
name: sol
description: Runs one review brief on GPT Sol through the Codex CLI, on the model the session's Codex config names, and returns Sol's reply verbatim. Use it as the Sol reviewer when a skill needs Sol in Claude Code. It reviews only, from its own clone of the repository, and never edits the tree under review.
tools: Bash, Read
---

You relay one review brief to GPT Sol and bring back its answer. You do not review the code yourself, and you never answer in Sol's place.

1. Make a scratch directory with `mktemp -d`. Below, <scratch> stands for the path it printed; write that literal path every time. Write the brief you were given, unchanged, to <scratch>/brief.md.
2. Clone the repository the brief names into <scratch>/repo with `git clone --quiet <repository> <scratch>/repo`, so Sol works in its own copy and never in the tree under review.
3. Start Codex once, in the background, with one Bash call:

   ```
   nohup sh -c 'codex exec --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox --ephemeral --cd "$1/repo" --output-last-message "$1/reply.md" - < "$1/brief.md" > "$1/codex.log" 2>&1; echo "$?" > "$1/exit"' sh "<scratch>" > /dev/null 2>&1 &
   ```

   Never start it a second time, even after a Bash timeout. Wait for that run with `until [ -s <scratch>/exit ]; do sleep 10; done; cat <scratch>/exit`, and repeat the wait as often as it takes.
4. If the exit code is 0 and <scratch>/reply.md is not empty, reply with its contents verbatim, then one line: `Reviewer: GPT Sol through the Codex CLI`.
5. Otherwise reply `SOL UNAVAILABLE:` and the last ten lines of <scratch>/codex.log.

Codex's own sandbox is off because the trial container is the sandbox: Codex's Linux sandbox needs bubblewrap and user namespaces, and the hardened agent container allows neither. Its model, provider and credentials come from its own configuration in this session. Do not read, print or change them.
