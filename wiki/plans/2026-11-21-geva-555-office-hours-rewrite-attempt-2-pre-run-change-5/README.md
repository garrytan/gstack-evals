---
id: 2026-11-21-geva-555-office-hours-rewrite-attempt-2-pre-run-change-5
kind: plan
title: "Pre-run change 5 to the second office-hours rewrite eval: both gstack pins move to the content change's final head and its merge base"
summary: "Moves both gstack pins to 8fcca8a5 and its merge base 85867942 with what follows for A8, Codex and the markers, and adds F1 and G1: a watch on Sol's rollout and its collaboration mode."
author: GEVA-555
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-21
status: open
links:
  - wiki/plans/2026-11-18-geva-555-office-hours-rewrite-attempt-2-prereg/README.md
  - wiki/plans/2026-11-19-geva-555-office-hours-rewrite-attempt-2-pre-run-change-2/README.md
  - wiki/plans/2026-11-19-geva-555-office-hours-rewrite-attempt-2-pre-run-change-3/README.md
  - wiki/plans/2026-11-20-geva-555-office-hours-rewrite-attempt-2-pre-run-change-4/README.md
  - lanes/office-hours-rewrite/
  - garrytan/gstack#4468
  - garrytan/gstack#4510
attachments:
  - 9935903e7af5b843671c80c9ec470810c211d957419932574042ce02168f2c90  b-check-argv.ts
  - 1ad8589d93d180d2b9dd76f859a90082a854ec616a02ed84f09620f630ca3b55  b-check-probe.sh
  - 19ef0a3e7bfdc3d4580d6b282d2de6d5ba87aa5e29dda902f914fc5fedc5ae0d  b-check-report.py
  - c7632f8ebc0ad605be1d7fee0bf3934324225f97770c7e2e19dc52a466269e70  b-check-stub.ts
  - c6bfd980834a8351c425b1a595672180669a90e720be6a209a459e1955e786d5  b-check-tui.py
  - a5cd62fa2898b5e897a10cfd6e9d7f463fc0a8e8e6aaf1d82a9be4e646af0982  b-check.sh
  - 5c64a1381a918e3627d0e8ccc648e3ad907661243f3f81f778893ed771ff2f00  b-check.txt
  - d8f839464e4bc7b9a2f55962474ca00b0daed472ab12e724708925281c386f23  e2e.txt
  - bea858d46535c02cad61b14767f4e57df3b9f0d18d5b48be3c0e98b1d85bd308  e2e-f1.txt
  - 23aee1480055492c648927cd606fab957369691b8f0fe6e502e481161c2d2058  layout.json
  - 6e61e177c53cb38f38615758e5e9aae20c4dba4b02ffd72c3a69ad6d95521848  layout.sh
  - 75020b7a58c5e9020d0bfd25e5feb14aaca899a9b6a4614cc320606eb9a61d7f  pin-current.tsv
  - acc6a8fc3ea7141ed1ec9083faa816e329b45b660d3184e47b41ff09c6f76f0c  pin-new.tsv
---

# Pre-run change 5 to the second office-hours rewrite eval

## In short

- The content change, gstack#4468, merged gstack main into its branch, and its ready head 4afa7f2b is retired. The new pin moves to the change's final head, 8fcca8a5. The current pin moves to that head's merge base with gstack main, 85867942. Both are at VERSION 1.102.0.0.
- The change's own diff is the same 22 files as before. The helper scripts and VERSION changed at both pins alike, because they came in with main.
- The current-to-new gap is back to 62 changed lines, in the pins and in Codex's render, the frozen figure.
- At both moved pins gstack's own Codex install lists office-hours once and Codex injects the whole render. The three-entry layout fix would hide office-hours, so it comes out and every Sol skill arm runs gstack's install as shipped (section 4). This replaces pre-run change 2's decision to hide the duplicate entries.
- Under `codex exec`, gstack's session-kind helper prints headless. Every Sol exec now runs Codex through a link named codex-ohr, so gstack treats the session as it treats a person at Codex's terminal. That is a harness difference, and a keyless check backs it (section 5).
- On Claude Code the skill now runs two commands as it loads, so the body differs between sessions. A8 now checks a frozen head and tail around the start step's output, and the session-kind reader reads that output (section 3).
- Seven new-pin detection markers that stopped matching are replaced from the new pin's text (section 7).
- The briefs pass the screen built from the moved pins: 94 of 94 (section 6).
- The keyless end to end at this change passed all 63 checks, on both hosts and both pins (section 8).
- F1: the harness snapshots Codex's home before and after every Sol exec and checks that nothing but Codex's own frozen writes touched it and that each rollout only grew. Event-stream naming of Codex's home is flagged too. Flagged sessions count as fails in a sensitivity row the report always prints, and an unreadable rollout scores missing with its own code and is listed by cell (section 10).
- G1: every Sol turn's turn_context must record collaboration mode default; any other turn is reported with its cell (section 11).
- The keyless end to end with F1 and G1 is in section 12.

This change governs where it and the plan or an earlier change differ. It is made before any arm session has run. It changes no model, judge, measure, threshold, item cap, ledger item, stop rule or decision row. F1 adds a sensitivity row beside the primary and its own missing code for an unreadable rollout; neither changes how the primary scores a session.

## 1. Why the pins move

The plan defines new as the content change's ready head and current as the commit it is built on, its merge base with gstack main. On 2026-11-20 the change merged gstack main into its branch (767bb1df) and added one commit on top, 8fcca8a5a0491ca6077b28103d85a47938fa6264. 4afa7f2b is no longer its head.

- `git merge-base 8fcca8a5a0491ca6077b28103d85a47938fa6264 <gstack main>`, with main at ebc867422e9c9e059657ee16d424f22e414a5e90, returns 858679423cc4778f9961d4aaf3c061a9368985ec, the current pin.
- `git diff --name-only` from 858679423cc4778f9961d4aaf3c061a9368985ec to 8fcca8a5a0491ca6077b28103d85a47938fa6264 lists the same 22 files, in the same order, as from fc5c285035b58ce0552d25cf7cb71749795b6d30 to 4afa7f2b3e291758f6a7842dd066cde22606fca1. The change under test is still those 22 files.
- Moving new alone would compare a pin with main's changes against one without them. Before current moved, the gap was 97 changed lines in the pins and 84 in Codex's render. Defining current as the merge base again puts main's changes on both sides.

## 2. The pins

| Pin | Before | After |
|---|---|---|
| current | garrytan/gstack fc5c285035b58ce0552d25cf7cb71749795b6d30 | garrytan/gstack 858679423cc4778f9961d4aaf3c061a9368985ec |
| new | garrytan/gstack 4afa7f2b3e291758f6a7842dd066cde22606fca1 | garrytan/gstack 8fcca8a5a0491ca6077b28103d85a47938fa6264 |

| File | Value at both moved pins |
|---|---|
| VERSION | 1.102.0.0 |

VERSION's bytes hash to 2ff194b6ed856895a2fcd37b3e7c2bb60b623f3e594c839f481932e22f37f393 at both pins (5ba97c87 before). pin-current.tsv and pin-new.tsv list every pinned file with its bytes and sha256. Each container still checks every one. The pinned paths are the same as before at each pin. No pinned path is missing, and no office-hours file is unlisted.

Files whose bytes changed, at the current pin:

| File | Before | After |
|---|---|---|
| office-hours/SKILL.md | 43,932 bytes, 0e898ac8 | 44,326 bytes, 6cfa24bd |
| office-hours/SKILL.md.tmpl | 18,975 bytes, 7779f733 | 18,968 bytes, 44ea3f48 |
| bin/gstack-session-kind | 3,555 bytes, 408a1688 | 5,825 bytes, 455e02bb |
| bin/gstack-skill-start | 53,228 bytes, 22ddd3ea | 54,148 bytes, 54684782 |

At the new pin:

| File | Before | After |
|---|---|---|
| office-hours/SKILL.md | 43,862 bytes, 8ff8e760 | 44,256 bytes, 30ff20bc |
| office-hours/SKILL.md.tmpl | 17,868 bytes, 791e0793 | 17,861 bytes, d5aed1ea |
| office-hours/sections/design-and-handoff.md | 35,348 bytes, 445b87a9 | 35,294 bytes, dedaede7 |
| office-hours/sections/design-and-handoff.md.tmpl | 25,953 bytes, 573730dc | 25,899 bytes, 79350fd2 |
| office-hours/sections/phase-2a-startup-diagnostic.md | 16,768 bytes, 003fe35d | 16,645 bytes, f62e3fbd |
| office-hours/sections/phase-2a-startup-diagnostic.md.tmpl | 16,634 bytes, fd07f7d1 | 16,511 bytes, 00ac8ff5 |
| office-hours/sections/phase-2c-pivot-discovery.md | 3,454 bytes, 58dde49c | 3,175 bytes, 559b4ebf |
| office-hours/sections/phase-2c-pivot-discovery.md.tmpl | 3,323 bytes, c7326044 | 3,044 bytes, 5b7aae97 |
| bin/gstack-session-kind | 3,555 bytes, 408a1688 | 5,825 bytes, 455e02bb |
| bin/gstack-skill-start | 53,228 bytes, 22ddd3ea | 54,148 bytes, 54684782 |

The two helper scripts are byte-identical across the moved pins, as are every other pinned helper and section file the change does not touch.

## 3. Figures that follow from the pins

A8's body on Claude Code, in two parts around the start step's output (see below):

- current: head def89776bac5fca440d0213140fef5a6136a87dc2a34f5d3e1f2c732e81551cb (23,740 characters) and tail 5cd9377e2676a750111089a9e48f6f79cdda63562b6f78bee5e53150edfb957b (42,108 characters). As one body less its frontmatter (pre-run change 3) the file reads 59f9c4c1f2ce21e27440d114ec0aba5a5b85af755a06a080c0a9d10f39231d9c (42,936 characters), and read ff57c98d797dbf55ded81fe8f591bc7a6348ba383504c534836b0f216681b3e9 (42,600 characters) before the move.
- new: head def89776bac5fca440d0213140fef5a6136a87dc2a34f5d3e1f2c732e81551cb (23,740 characters) and tail 368833a2fcd516e65d4328543490a36db03eae86c69265539a7f4646e18b1c93 (42,034 characters). As one body the file reads ba035a7b7201c0217a7ece0059ca5c2e242aea22fe78b864200c2de6ffc9c93b (42,862 characters), and read 5e0e5b6a7889418836171dc2d33f85b4c9ddb5f80ab901ca4cfeb7f2ad85af49 (42,526 characters) before the move.

Codex's render of office-hours/SKILL.md, from gstack's own `./setup --host codex` in each pin's tree, the same at both entries under CODEX_HOME/skills:

- current: 48,068 bytes, sha256 9aabb2d1949aab7be03eb09814d56279cf1eba3a39f86e362739d48a263b1f72, before ba7f2e3c (48,068 bytes).
- new: 48,058 bytes, sha256 7b927e4de37d5a2ca3db4d8691ec6926a1cc807d460b6a262454edaa9f22cdd7, before c8b25fa8 (48,058 bytes).

The gap is 62 changed diff lines from current to new, in the pins' office-hours/SKILL.md and in Codex's render alike. That is the frozen RENDER_GAP, so it does not move.

### A8 on Claude Code at the moved pins

gstack#4509 (7f9c1bc5) makes office-hours/SKILL.md run two commands as Claude Code loads it, through Claude Code's `!` lines. One inlines the shared preamble file, office-hours/sections/preamble.md. The other runs the skill's start step and inlines what it prints, which differs between sessions. In the first keyless end to end at the moved pins the body was 66,418 characters at the current pin and 66,344 at the new pin, and each of the four Opus skill sessions failed A8 as frozen.

The eval's owner decided on 2026-11-21 that A8 checks the body with the start step's output cut out:

- head is the body less its frontmatter up to the start line, with the preamble line read as preamble.md less its last newline. It is the same at both pins. tail is the body after the start line.
- A session passes A8 when its skill message holds the arm's head, then a start-step output that is not empty, then the arm's tail, ending at the message's end or at its ARGUMENTS line.
- An empty start-step output fails. So does a changed head or tail, or the other pin's tail.
- The figures above come from each pin's files, and a test rebuilds them from a gstack clone that holds both pins.

The head also carries the preamble's own text, which names other session kinds. So the session-kind reader now takes the SESSION_KIND line from the start step's output first, and falls back to the first tool result that prints one, as before.

## 4. The Codex layout at the moved pins

gstack#4510 (ed4086e) is in both moved pins. Its setup links the runtime copies of office-hours, plan-design-review and gstack-upgrade under CODEX_HOME/skills/gstack/ to the rendered files, where before it wrote second copies. Codex resolves both entries to one file.

The same keyless check as pre-run change 2's, on Codex 0.170.0 against a stub Responses server, with the first message `$office-hours` plus the lens line and an invented opening (layout.sh, layout.json):

| Capture | Skills listed | office-hours entries | Skill items injected | Injected |
|---|---|---|---|---|
| current as shipped | 67 | 1 | 1 | 48,068 bytes, the whole render |
| current with the three-entry fix and bundled skills off | 60 | 0 | 0 | nothing |
| new as shipped | 67 | 1 | 1 | 48,058 bytes, the whole render |
| new with the three-entry fix and bundled skills off | 60 | 0 | 0 | nothing |

At the old pins the fix was what made `$office-hours` inject anything. At the moved pins gstack's install works as shipped, and the fix hides office-hours.

The eval's owner decided on 2026-11-21 that the fix comes out. Every Sol skill arm runs gstack's `./setup --host codex` exactly as shipped, and no exec carries a `[[skills.config]]` entry. This replaces the decision in pre-run change 2, section 3, that the duplicate entries stay hidden. The install check still reads the rendered SKILL.md at both entries.

## 5. The session kind on Codex at the moved pins

gstack#4510 also changed bin/gstack-session-kind. When a tool shell has CODEX_THREAD_ID and its nearest codex ancestor process runs `exec`, `e` or `review`, it prints headless. Codex 0.170.0 sets CODEX_THREAD_ID in every tool shell, and the Sol driver runs every turn as `codex exec` or `codex exec resume`. GSTACK_SESSION_KIND overrides only spawned and unattended, so it cannot make a session read as interactive. A skill session that prints a kind other than interactive retries once and then scores missing (pre-run change 1). In the keyless end to end both Sol skill arms printed SESSION_KIND: headless, retried, and ended missing (section 8). So as built, every Sol skill session would score missing. The eval's owner decided on 2026-11-21 to launch Codex through a link named codex-ohr for every Sol exec. We drive Sol non-interactively, through `codex exec` and `codex exec resume`, where a person would type at Codex's terminal. gstack's exec check looks above the tool shell for a process named codex, codex.js or codex.exe and reads its subcommand. Under the link's name it finds none, so gstack's exec detection is bypassed and gstack behaves as it does for a terminal user. This is a harness difference, and the results name it as one. A7's rule stays as frozen.

Each exec runs `sh -c` with Codex's own directory first on PATH, makes a fresh temporary directory, links the pinned binary there as codex-ohr and runs it through the link (run/codex.ts codexLaunch). The binary and its checksum do not change.

Removing CODEX_THREAD_ID from the tool shells was the other way to get there, and it was rejected. At 8fcca8a5 the second-opinion and visual-design steps and bin/gstack-skill-end read that variable to know they run inside Codex. Without it they would try an outside review and log the host as unknown, which a terminal user never sees.

The check behind the decision is keyless: Codex 0.170.0's native binary with gstack's helpers from 8fcca8a5, against a stub Responses server, with every provider key unset. In each run the stub had the model run a probe in its tool shell, then one apply_patch, then one command that reads the patched file. The probe prints names, set or unset, and kinds, never values. The TUI ran under a pseudo-terminal. The exec runs took the Sol arm's own arguments from the lane (solArgv) and, for codex-ohr, the lane's own launch command. They ran first as the Sol arm runs, with Codex's sandbox bypassed because the container is the sandbox, and then with Codex's workspace-write sandbox on, to show that its sandbox helper still runs under the link.

| Probe | TUI as codex | exec as codex | exec as codex-ohr | exec as codex, sandbox on | exec as codex-ohr, sandbox on |
|---|---|---|---|---|---|
| gstack-session-kind | interactive | headless | interactive | interactive | interactive |
| CODEX_THREAD_ID | set, the session's own thread | set, the session's own thread | set, the session's own thread | set, the session's own thread | set, the session's own thread |
| CODEX_CI | set | set, as in the TUI | set, as in the TUI | set, as in the TUI | set, as in the TUI |
| Codex's other variables | CODEX_APPLY_PATCH_PRESERVE_LINE_ENDINGS, CODEX_HOME, CODEX_SESSION_ID, CODEX_TOOL_CALL_ID, CODEX_VERSION | the same five | the same five | the same five and CODEX_SANDBOX_NETWORK_DISABLED | the same five and CODEX_SANDBOX_NETWORK_DISABLED |
| GSTACK_HEADLESS, CI, GITHUB_ACTIONS | unset | unset | unset | unset | unset |
| Host gstack-skill-end records | codex | codex | codex | codex | codex |
| Nearest Codex process above the shell | codex, the TUI | codex, exec | codex-ohr, exec | none visible | none visible |
| gstack finds a process named codex | yes | yes | no | no | no |
| apply_patch wrote its file | yes | yes | yes | yes | yes |
| The next command read that file | yes | yes | yes | yes | yes |
| cli_version in Codex's session record | 0.170.0 | 0.170.0 | 0.170.0 | 0.170.0 | 0.170.0 |
| Model in every request | gpt-6.1-sol | gpt-6.1-sol | gpt-6.1-sol | gpt-6.1-sol | gpt-6.1-sol |

CODEX_APPLY_PATCH_PRESERVE_LINE_ENDINGS, CODEX_CI and CODEX_VERSION hold the same values in every run as in the TUI. CODEX_HOME, CODEX_SESSION_ID and CODEX_TOOL_CALL_ID differ by run, as each run has its own home, session and calls. Under codex-ohr every probe reads as it does in the TUI, apart from the nearest Codex process, which is the point. With Codex's own sandbox on, even the plain name reads interactive, because the sandbox hides the parent processes from the tool shell. The Sol arm bypasses that sandbox, so the case does not arise in the lane. Codex's own session record still names its originator as codex_exec in every exec run, under either name; gstack does not read it. The row's served model comes from the model tap, in the end to end (section 8).

## 6. The vocabulary screen

Authoring screened every brief against six forcing questions at the current pin and, at the new pin, the forcing questions, the reality check's quoted questions and the pivot flow's quoted questions, plus the lens line.

| Screen | Source strings | Five-word sequences | sha256 of the sorted sequences |
|---|---|---|---|
| Authoring's, at fc5c285 and 4afa7f2b | 24 | 230 | 2744f33844b963009dfe10b095f7509bb8a4e33e478435c3768b5e73a0ce0af3 |
| The moved pins', at 85867942 and 8fcca8a5 | 20 | 185 | fe1ad3549f78a167afa632d6fff60e7e36756bc8543490ab712d3031dae34386 |

The current pin's phase-2a file is unchanged by the move. The new screen holds 14 sequences the old one did not and lacks 59 it had. A brief that passed the old screen can fail the new one only through those 14.

The re-screen ran `gstack-evals ohr rescreen`, which runs authoring's vocabulary check over a briefs directory with the screen built from the pins, and prints each brief's verdict with counts and file names and no text.

The re-screen ran under custody at 8ce64ee1 on 2026-11-21, on the machine that holds the sealed briefs. The screen held 185 five-word sequences, sha256 fe1ad3549f78a167afa632d6fff60e7e36756bc8543490ab712d3031dae34386, built from 85867942's phase-2a file and 8fcca8a5's phase-2a and phase-2c files. Result: 94 briefs, 94 pass, 0 fail, exit 0. No brief drops, so the reserve rule does not fire.

## 7. Detection markers

The current pin's candidate markers (lanes/office-hours-rewrite/score/markers/current.json) move to 85867942. office-hours/SKILL.md is the only marker source whose bytes changed, and every current marker matches the moved pin's files as it matched fc5c285's.

The new pin's candidate markers were read at 0787a1e0, before the content change's final head. Seven of their 44 pattern entries match 4afa7f2b's files and do not match 8fcca8a5's: the three pivot questions under questions, the same three under startup_only, and the wallet question under startup_only. The eval's owner decided on 2026-11-21 to replace those seven from 8fcca8a5's text. new.json now records 8fcca8a5 and its file hashes. Each replacement was read from the line that replaced the old one in the same file, without printing the skill's text:

- pivot-love-or-size, under questions: `\bloved\b.*\b(?:market|too small)\b|\btoo small\b.*\bloved\b`
- pivot-sunk-cost, under questions: `\bstarting (?:from )?zero\b`
- pivot-commitment, under questions: `\bwalk away\b`
- the same three under startup_only, and startup_only's wallet: the old pattern or the new one. wallet's new pattern is `\bwhich\W+would\W+they\W+pay\b`.

Under questions, which count exposure on the new pin alone, each replacement matches its new line and none of the lines the final head retired. G1 reads startup_only on both pins, and its fixtures ask these questions in the old wording, so each startup_only entry keeps its old pattern beside the new one and still catches either wording.

Three limits come with that. The new pivot-love-or-size entry under questions needs the new line's word "loved", so a question that says "love" does not count. wallet's new pattern lies inside startup_only's payment-test phrase, so one question in that wording counts under both ids. And the check that no marker matches a retired line does not hold for the whole file. 4afa7f2b's office-hours sections lose 24 lines at 8fcca8a5: 9 in phase 2a, 14 in phase 2c and 1 in design and handoff. 12 new-pin entries match one of them: the four startup_only entries above, and 8 that this change does not touch (conversation-count under questions and startup_only, and startup_only's payment-test, two-sentence-pitch, kill-line and evidence-ladder). Each of the 8 also matches a line at 8fcca8a5, because its phrase survived the rewording.

All of them stay candidates until stage 1 freezes them (plan section 12, stage 4).

## 8. The keyless end to end

The keyless end to end ran on 2026-11-21 at the moved pins, on both hosts, with this change's code: 63 checks passed and none failed. The run's log is e2e.txt.

- By host and pin: on Opus, 13 checks for current, 14 for new and 4 for none; on Sol, 5 each for current, new and none, and 5 across its three arms; and 12 for the rig as a whole.
- Every row named its pinned served model and CLI version: claude-opus-5-5 on Claude Code 2.1.314 for the six Opus sessions, and gpt-6.1-sol-2026-11-01 on Codex 0.170.0 for the three Sol sessions. The rows parsed and matched the frozen manifest.
- Opus: each of the four skill sessions passed A8, its skill message holding the pin's head and tail around the start step's output. Each of their rows reads the session kind the start step printed, interactive.
- Sol: each skill arm got the whole render as its `<skill>` item and printed SESSION_KIND: interactive. In all three Sol sessions the question reached the simulator, its answer came back by exec resume, and a block ended the session. The tap logged all 14 responses with the dated pin.
- Containment: all 9 attempts were clean, one for each session.

The first end to end at the moved pins, run before these decisions were built, passed 45 checks and failed 14, for the reasons in sections 3 to 5.

## 9. Commits

Every paid run after authoring runs at the commit on the results branch that last changes the newest pre-run change (pre-run change 2, section 11). When this post lands, this is the newest pre-run change.

## 10. F1: trusting Sol's rollout

The eval's owner decided F1 and G1 on 2026-11-21. Codex keeps each session's rollout under its own home, $HOME/.codex, and the Sol arm's transcript, its questions and its scored block all come from that file. The agent runs in the same container as the same user, so it could change the file. F1 checks that it did not, and reports every session where the check cannot say so.

**The watch.** The harness, never the agent, runs a snapshot of Codex's home through its own shell step: before every exec, after every exec, and after the rollouts are copied out (run/home-watch.ts, called from run/codex.ts). A snapshot lists every entry under $HOME/.codex with its type, inode, size, ctime, mtime and path, the sha256 of every rollout, and the sha256 of each rollout's first N bytes, where N is its size at the previous snapshot. It runs with a fixed PATH and absolute tool paths. A user cannot set ctime back, so a file that was touched shows even when its bytes and mtime are put back. Every snapshot and every diff goes to host/codex/home-watch.ndjson beside the trial. Consecutive snapshots are diffed into creates, modifies, truncations, deletes and moves, a move being the same inode under a new path.

**The rules.** A Sol attempt is flagged when:

- anything changes under Codex's home between two execs, when Codex is not running;
- across an exec, a delete, move or truncation happens anywhere under Codex's home, or a create or modify happens that is not a live rollout's own create or append and is not in the frozen allow list below;
- a live rollout after an exec does not start with the bytes hashed at the snapshot before it (the prefix check), or a rollout is gone;
- a directory's entries change in an exec with no allowed create inside it. This catches a rollout deleted and written back, even on a disk that hands the new file the old inode number;
- a snapshot fails or prints no closing record (fail closed);
- the rollout bytes copied out are not the bytes the last snapshot hashed, or the session's own rollout is not there exactly once;
- in the exec --json events the adapter holds, a command, MCP arguments or a file_change path names Codex's home, its sessions or a rollout, and the same for a tool call's input in the rollouts. Running or reading the skill install by its path (.codex/skills/..., with no "..") is no flag, because every Sol skill arm runs gstack's helpers from there. A write there still shows in the snapshots.

A flag never changes how the session scores in the primary. The session row carries every flag, each line naming its attempt, and is null on Claude Code rows.

**The frozen allow list** (frozen.ts CODEX_HOME_ALLOW). Codex's own writes to its state files cannot be told from the agent's without knowing which process made them. So the list holds exactly the kinds and paths that the three Sol sessions of the keyless end to end showed across their nine execs, paths relative to $HOME/.codex and * within one path segment. Codex made no delete, move or truncation there.

- Created folders: the home itself, tmp, tmp/arg0-linux, .tmp, .tmp/git-*, .tmp/git-*/objects, .tmp/git-*/refs, sessions, sessions/*, sessions/*/*, sessions/*/*/*, shell_snapshots and thread-writer-locks.
- Created files: .sandbox_migration, installation_id, .tmp/plugins.sync.lock, .tmp/git-*/HEAD, thread-writer-locks/.coordination.lock, and for each of goals_1, logs_2, memories_1, queue_1, state_5 and thread_history_1 the .sqlite file with its -wal and -shm files.
- Folders whose entries change on every exec: .tmp, shell_snapshots, thread-writer-locks and tmp/arg0-linux.
- Modified files: logs_2.sqlite, state_5.sqlite-wal, thread_history_1.sqlite-wal, and the six -shm files.
- Beside the list: a rollout's own create (sessions/*/*/*/rollout-*.jsonl, a regular file) and its appends, which the prefix check guards.

**Residual gaps.** The watch cannot see:

- an append to a live rollout during an exec that looks like Codex's own;
- a file created and removed inside one exec in a folder Codex changes on every exec (the four above), or in the home, sessions or a date folder during the exec that creates them;
- a change to an allow-listed file inside an exec, or a delete and rewrite of one, since Codex writes those files itself;
- a rewrite of the rollout inside the exec that creates it, since no earlier bytes exist to compare. The other rules still apply to the rest of the home;
- a file the agent makes under a date folder with a rollout's name: it reads as a live rollout, and only the session's own thread must have exactly one;
- anything outside $HOME/.codex, and anything a leftover process does after the last snapshot, which comes after the rollouts are copied;
- writes a real paid session makes that the keyless sessions did not, such as a database checkpoint into a main .sqlite file. Those are flagged, so the gap fails closed: they count as fails in the sensitivity row, and stage 1 shows any such flag.

**Where this departs from the decision as given.** The decision suggested a watcher logging every event for the whole session. Here the harness snapshots Codex's home at every exec boundary instead. A continuous watcher out of the agent's reach would need a root process with its capabilities back, or an inotify tool, inside a container that drops every capability and runs as the agent's own user, which means changing the arm image or the shared sandbox. Any process the harness starts in the container today runs as that user, and the agent could stop it. The snapshots need neither change and run keyless. What they cannot see is listed above. The decision also flags any change to a file other than the live rollouts; Codex changes its own state files in every exec, so the allow list lets exactly those through, and that is a gap too.

**An unreadable rollout.** When the adapter cannot read the rollout after a turn, or the session's rollout is not copied out, the attempt retries once and then scores missing with its own code, E_OHR_ROLLOUT_UNREADABLE, instead of E_OHR_INFRA_MISSING. ohr read report lists every Sol cell missing on an unreadable rollout by name, apart from the Sol cells missing with E_OHR_INFRA_MISSING.

**The sensitivity row.** ohr read report always prints, beside the primary (new minus current, pooled), a sensitivity row that scores every flagged Sol session as a fail on R1, R2, R3 and R, with the count and cells it flagged. It is there with zero flags too, so a zero is visible. A flagged session that reads missing or contaminated stays out, as it does in the primary.

## 11. G1: Plan mode

Every Sol turn's turn_context in the rollout must record collaboration mode default (record type turn_context, payload.collaboration_mode.mode). A turn that records another mode, a turn_context with no mode, a started turn with no turn_context, or a rollout with none, is reported. The session row lists those turns, each naming its attempt, rollout and turn id, and ohr read report names their cells. G1 changes no score.

## 12. The keyless end to end with F1 and G1

The keyless end to end ran again on 2026-11-21 with F1 and G1 built: 72 checks passed and none failed. The run's log is e2e-f1.txt.

- By host and pin: on Opus, 13 checks for current, 14 for new and 4 for none, as in section 8; on Sol, 8 each for current, new and none, and 5 across its three arms; and 12 for the rig as a whole. The 9 new checks are the three below for each Sol arm.
- The watch logged 7 snapshots in each Sol session, before and after each of its three execs and after copy-out, every one whole, with 6 diffs. The none arm starts with no Codex home and ends with 41 entries; each skill arm starts with its 120-entry install and ends with 152.
- No Sol session was flagged.
- All 9 Sol turns recorded collaboration mode default, 3 in each session.

The allow list in section 10 was read from an earlier run of the same end to end with the watch on and an allow list that held only the rollout rules. That run showed the Codex writes listed there and no change between execs.

## Attachments

- pin-current.tsv and pin-new.tsv: every pinned file at each moved pin, with its bytes and sha256.
- layout.sh and layout.json: the layout check in section 4 and what it printed.
- e2e.txt: the keyless end to end in section 8, as it printed, with the home directory written as ~.
- e2e-f1.txt: the keyless end to end in section 12, as it printed, with the home directory written as ~.
- b-check.sh, b-check-probe.sh, b-check-stub.ts, b-check-argv.ts, b-check-report.py, b-check-tui.py and b-check.txt: the launch check in section 5, and what it printed.
