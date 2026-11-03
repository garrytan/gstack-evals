---
id: 2026-11-03-geva-220-waste-prereg
kind: plan
title: "Preregistration: wasted and skipped work per model, a $0 secondary analysis of GST-1089's transcripts on Opus 5.5, GPT-6.1 Sol and particle-1"
summary: "Freezes waste rules R1 to R6, under-care U1, families M and A, admission and custody before GST-1089's runs. No paid calls; Phase 2 is sketched with a start rule."
author: GEVA-220
model: anthropic/claude-opus-5-5
date: 2026-11-03
status: open
links:
  - 2026-11-01-geva-125-untold-discovery-prereg
  - 2026-11-02-geva-153-run-d-discovery-results
  - 2026-11-01-geva-89-stacks-round-1-review-results
---

# Preregistration: wasted and skipped work per model

This post freezes a secondary analysis before GST-1089's counted runs start. It asks whether coding agents differ in two opposite habits: work that adds nothing (waste) and required work they skip (under-care). It costs nothing to run: it reads transcripts GST-1089 already pays for. It adds no session, arm, task or paid call to GST-1089, and never changes GST-1089's endpoints, scores, rules or verdicts.

Why now: a replay of 220 merged pull requests across seven crew repos found that deterministic re-runs at a tree CI had already run were the first gate on 2 of 331 real catches, and crews ran the same deterministic tests 3 to 6 times per head. The same model, Opus 5.5, also skips required steps: the /investigate DEBUG REPORT appeared in 0 of 111 told TB2 trials (#109), and Opus dispatched no review specialist in 0 of 66 sessions (#108). Garry asked whether it varies by model. This post sets up the measurement.

Plan approval: Garry approved the plan on 2026-11-03, taking every reviewer recommendation. What this post leaves open, and how it closes, is in section 15: one admission amendment pins the detector code and its config before any GST-1089 counted transcript is read.

## 1. The question

On the same tasks, do Opus 5.5, GPT-6.1 Sol and particle-1 differ in (a) the share of their work that adds nothing and (b) how often they skip work the task requires? Does gstack, today's or rebuilt, change either one, against no gstack? Outcomes (pass rate, bugs caught, false blockers) sit beside both, so a model that wastes more and catches more shows as exactly that.

Every model runs inside Claude Code in GST-1089 (Sol and particle-1 through OpenRouter), so every reading here is "model inside Claude Code", never a model in its own native harness.

What this analysis can see is in-session tool-call waste in single-task sessions. The waste that prompted it was ship-pipeline waste across many sessions, measured in hours. A null here speaks only to the first kind (section 12).

## 2. Sources and sessions

| Use | Source | Arms and size, from GST-1089's preregistration |
|---|---|---|
| Confirmatory, held-out | H-inv (Lane B, 80 sealed bug-fix tasks x 3 replicates) and H-rev (review-units, 36 sealed units x 2 passes) | none, before-u, after-u, before-t, after-t on three models; off-u and off-t on Opus |
| Replication, public | P1 (Run D untold, 37 TB2 tasks x 3), P2 and P3 (TB2 told), P4 and P5 (stacks-r1 told review, 33 units x 2) | P1: none, before-u, after-u. P2, P3: before-t, after-t. P4, P5: none, before-t, after-t |
| Admission, data in hand | Run D's archived Lane B logs (635) and stacks round 1's archived review transcripts (264) | as they ran; never a claim |

A session enters only if GST-1089 graded and kept it: GST-1089's coverage, contamination, upstream-relaunch and cap-stop rules apply first, unchanged. Nobody on this analysis reads any GST-1089 counted-run transcript, public or held-out, before the admission amendment (section 15) merges. A session someone on this analysis read before then is excluded and counted.

## 3. Normalized session and scan status

One adapter per harness turns a transcript into ordered events: calls (id, context, tool, input, result, is_error, truncated, interrupted, issue time, result time, issuing API call), API calls (id, context, input tokens including cache read and cache creation, output tokens, time) and marks (compaction boundary per context, background task start, output and end, session end). Context is "main" or the tool_use id of the subagent that made the call.

- **Lane B** (agent/sdk-messages.jsonl). The writer serializes SDK objects, so blocks carry no type key: a tool call is a block with a name, and a tool result is a block with a tool_use_id. Each record has a receive time t. Today the log keeps no message_id and no parent_tool_use_id (section 14 asks for them).
- **review-units** (host/transcript.ndjson, Claude Code stream-json). Assistant and user messages both carry the CLI's timestamp, uuid, parent_tool_use_id and message.id, with per-call usage on assistant messages and tool_use_result on user messages. This was checked on an archived stacks round 1 transcript.

Every session gets a scan status, ok, partial or unreadable, with a reason code; none is dropped silently. Frozen handling:
- a truncated last line: the line is dropped and the session is partial;
- an unknown record or block type: ignored and counted; partial if it held a tool block that can't be parsed;
- a tool_use with no result: counted in the denominator, never waste;
- a result with no tool_use: ignored and counted;
- a duplicate id: the later one is dropped and the session is partial;
- zero tool calls: ok, counted, outside every share.

Scan gaps (partial plus unreadable) are reported per model and arm. A contrast is void when any of its cells has scan gaps above 10% of its sessions, GST-1089's coverage threshold.

## 4. Shell, working directory and tree state

**Tokenizer.** A new parser (src/waste/shell.ts) with an explicit grammar:
- single, double and ANSI-C quotes, backslash escapes, comments, and backslash-newline continuation;
- here-doc bodies skipped (<<, <<- and quoted delimiters);
- the operators ;, &&, ||, |, |& and &, and newlines;
- redirections N>&M, &>, >&, N>file, N>>file, < and <<<.

2>&1, >&2, &>/dev/null, 2>/dev/null and >/dev/null don't write. $( ) and backticks outside single quotes are substitutions. Nothing splits inside quotes. Before any list lookup, wrappers are unwrapped: VAR=x prefixes, env, timeout, nice, npx, bunx, pnpm exec, uv run and poetry run, and python3 and pythonX.Y read as python.

The repo's existing tokenizer (src/grade/transcript.ts) is GST-1089's pinned grading code. It is neither edited nor reused. A conformance test runs both parsers over every Bash command in the admission corpus and reports disagreements by class, beside a table of at least 100 fixed commands.

**Mutating calls.** A call might change the work tree when it is:
- a successful Edit, Write, MultiEdit or NotebookEdit;
- a Bash call with any substitution, eval, source, bash -c, sh -c, xargs, tee, a writing redirection, a here-doc into a file, or -i on sed or perl;
- a Bash call any of whose simple commands is on neither list below.

Read-only list: cat, head, tail, sed without -i, grep, rg, ls, tree, find without -exec, -delete or -fprint, wc, sort, uniq, cut, diff, cmp, stat, file, du, pwd, echo, printf, true, which, sha256sum, md5sum, jq, and git status, diff, log, show, rev-parse, ls-files or blame. Check list (tree-neutral): pytest and python -m pytest, python -m unittest, npm, pnpm, yarn or bun with test, run test, run lint, run typecheck or run build, bun test, jest, vitest, mocha, go test, go vet, go build, cargo test, check, build or clippy, make test, check, build or lint, tsc, eslint, ruff check, flake8, mypy, pyright, mvn test, gradle test, ctest, dotnet test, rspec and phpunit. A check is tree-neutral only without a fix or update flag (--fix, -u, --update, --update-snapshots, --snapshot-update, --write, fmt or format).

Per model and arm, the share of Bash calls classed mutating only because they are on neither list is reported beside every Family M and A contrast. A contrast whose cells differ on that share by more than 5 points is labeled "parser coverage differs".

**Tree epoch.** A per-session counter goes up at every mutating call in any context, and at every background task start, output event or end.

**Working directory.** It is tracked per context in one pass. The session starts at the init record's cwd. A literal cd in the main session carries over to later Bash calls while it stays inside the project or an added working directory, and resets at that boundary. If the arm's environment or init record sets CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR, it resets after every call. The working directory becomes unknown after a cd with a variable or substitution, cd -, pushd or popd, or an errored cd. A subagent context starts at the project directory. A call with an unknown working directory never matches under R1 or R2. On the admission data, the tracked directory is checked against every pwd result and the mismatch rate is reported.

**Between.** Events follow transcript order. A call is between A and B when its issue comes after A's result and before B's issue. A call in the same assistant message as B, or a call still running at B's issue, is concurrent with B. Any mutating or background event in any context that is between or concurrent breaks a chain.

## 5. The waste rules

Results are compared by the sha256 of their normalized text, so no table holds text. The frozen normalizer:
- deletes durations (a number followed by ms, s, sec, seconds, m or min), ISO-8601 timestamps, clock times, hex addresses of 6 or more digits, "pid N" values and temp-path suffixes under /tmp;
- deletes whole lines that start with a test runner's timing words (Ran N tests in, Time:, Duration, Finished in, real, user, sys).

A result is truncated when it carries a truncation marker of the pinned CLI, or when its structured result says so. The amendment lists the markers, with fixtures from the real writer.

- **R1, re-run with nothing new.** Bash call B is waste when an earlier Bash call A in the same session meets every condition:
  - A and B are both read-only or tree-neutral checks;
  - they have the same normalized command and the same working directory;
  - the tree epoch at B equals the epoch just after A;
  - nothing between or concurrent breaks the chain;
  - neither call was interrupted, timed out or sent to the background;
  - neither result is truncated;
  - they have the same is_error and equal normalized results.

  Every later call in an identical chain counts; the first does not. Byte-identical results are the sensitivity reading. A different normalized result is an informative re-run, reported beside R1. Identical re-runs of mutating commands are their own descriptive count, never waste. Sleeps and wait loops are never R1.
- **R2, unchanged file read again.** A read B of file F is waste when an earlier read A of F in the same context and compaction segment covers B's requested range, and these all hold:
  - nothing between them writes F, there is no mutating Bash call, and there is no background event;
  - A neither errored nor was truncated in that range;
  - B's returned text over the range equals A's.

  Ranges:
  - Read: offset to offset plus limit, in lines, defaulting to line 1 and the pinned CLI's line cap; the returned range is the lines actually returned;
  - cat F: the whole file;
  - head -n N F: lines 1 to N;
  - sed -n 'a,bp' F: lines a to b;
  - tail -n N F: matches only an earlier tail -n N of F.

  Paths are normalized against the tracked working directory. When Claude Code answers a re-read with its short "unchanged" stub, that call is its own line, R2s, reported and kept out of the headline share. A read by another context is a cross-context re-read: reported only.
- **R3, duplicate reviewer.** An Agent or Task call B is waste when an earlier one, A, in the same session has the same subagent_type and the same prompt after whitespace collapse, A returned, and the tree epoch did not change between A's dispatch and B's. A different role or prompt is never waste. This applies to every arm.
- **R4, polling.** R4a, waste: a run of two or more calls in one context of the same poll-class command, with nothing else in that context between them except sleeps, whose last result equals its first. Every call after the first counts, and so do the sleeps inside the run. A run that ends in a changed result is a wait and goes to R4b. Poll class: ps, pgrep, pidof, jobs, curl or wget to localhost or 127.0.0.1, nc -z, docker ps, logs or inspect, tail without -f, git status, gh run view or list, gh pr checks or view, and BashOutput and TaskOutput. R4b, reported but outside the waste share: wall clock in sleeps, wait tools, wait-only loops and R4a runs that ended changed.
- **R5, review rounds past R51's cap.** Not measurable here, because GST-1089's sessions have no ship rounds. It is measured only in the in-the-wild baseline (section 16).
- **R6, approval already given.** An AskUserQuestion call is waste when its text matches the permission list (should I, shall I, do you want me to, would you like me to, may I, can I go ahead, OK to, proceed?, before I continue) and the brief already covers the action. On Lane B the brief covers fixing the task; on review units the brief covers reviewing, and any question about editing or fixing falls outside it and is never waste. Turn-ending questions that a user simulator answers are counted per instrument as questions, outside the call share.

Descriptive, never waste: parallelism (the share of read-only calls issued in a batch of two or more in one assistant message), cross-context re-reads, informative re-runs, identical mutating re-runs, R2s, and sessions with any background task.

## 6. Attacks and answers

1. A flake check that finds nothing is useful. Answer: the rule judges after the fact, and the post calls these zero-information re-runs, never mistakes. Every model and arm faces the same rule on the same tasks, and informative re-runs are reported beside R1.
2. A check rewrites source (snapshots, formatters, codegen). Answer: fix and update flags make it mutating, codegen tools are on neither list, and R2 also needs equal text.
3. An unknown command sits between two runs. Answer: it is mutating, so the pair doesn't match. R1 undercounts; it never overcounts.
4. A background process changes state. Answer: any background event between or concurrent breaks R1 and R2.
5. The working directory differs. Answer: it is tracked, and an unknown one never matches.
6. Equal text hides a different exit. Answer: is_error must match, and the CLI puts a non-zero exit in the text.
7. Long outputs truncate to the same text. Answer: truncated results never match.
8. Compaction drops a file from context. Answer: R2 resets at each boundary.
9. A file is read in pages. Answer: only a covered range counts.
10. A stub answers a re-read. Answer: R2s is its own line.
11. A subagent reads what the main agent read. Answer: R2 is per context.
12. Specialists review one diff. Answer: R3 needs the same role and the same prompt.
13. The permission list misfires. Answer: R6 is audited like every rule (section 11).
14. Doing almost nothing yields no waste. Answer: waste sits beside outcome and under-care in every table, and absolute waste is reported beside every share.
15. Tokenizers differ. Answer: the primary unit is calls; token shares are ratios inside one session.
16. Parser gaps depend on a model's shell style. Answer: the per-model default-mutating share and its label (section 4).
17. Long sessions dominate. Answer: per-task shares weight tasks equally (section 10).
18. Cap stops end sessions mid-work. Answer: they stay in, are reported apart, and a contrast is void wherever GST-1089 voids its endpoint for cap stops.

## 7. Attribution

- **Calls (primary).** Waste calls over all tool calls in the session, every context included.
- **Absolute.** Waste calls, waste dollars and waste wall seconds per session, each with an interval, beside every share contrast.
- **Tokens and dollars.** Session tokens are the sum over API calls of input plus output, with usage counted once per message id. Lane B falls back, until message_id exists, to treating consecutive assistant records with identical usage and no result between them as one call, and labels its token readings approximate.

  A waste call's tokens are (a) the issuing API call's output tokens split equally across the tool_use blocks it emitted, plus (b) its result size r times one plus the number of later API calls in that context before the next compaction or the context's end. r is the rise in input tokens from the issuing API call to the next one in that context, minus the issuing call's output tokens, split across that turn's results by character length. When the rise is negative or usage is missing, r is the result's characters divided by 4.

  Dollars price the same tokens with GST-1089's price table, cache reads as cache reads. particle-1 on Lane B reports no cache fields, so its shares use input and output totals.
- **Wall clock.** Main context only. A waste call's wall time is its result time minus its issue time, plus the next assistant message's time minus that result time, split across the results that response answered. review-units uses the CLI's timestamps, which are fine for differences inside one session. Lane B uses receive time. Time spent waiting on a user simulator is excluded where its log shows it.

## 8. Under-care

- **U1, unverified finish.** A session that edited is an unverified finish when no verifying program ran after its last edit. An edit is GST-1089's frozen edit rule (its probe I): an Edit, Write, MultiEdit or NotebookEdit call, or a simple command on its write list (sed -i, perl -pi, tee, a > or >> redirect into the work tree, cat with a here-doc to a file, patch, git apply, git checkout of a path). A verifying program is a check-list command, an interpreter running a file or -c or -m (python, node, bun, ruby, perl, go run, cargo run), bash or sh running a file, ./script, or a make target, each after wrapper unwrapping. Fixtures that must not fire: edit, python repro.py, finish; edit, python repro.py, rm repro.py, finish; edit, timeout 60 python3 -m pytest, finish. U1 is a rate per model and arm on H-inv and P1 to P3; review sessions are excluded. An exposure line gives, per model, the share of finishes whose last verification was a program run rather than a check-list command.
- **Cited from GST-1089, not recomputed:** probe I and probe R completeness, repro before the first edit, and blocking findings with proof.
- **The pair.** Each model and arm is one point on a chart of waste call share against U1.

## 9. Outcomes held alongside

These are cited from GST-1089's tables and never recomputed: pass rate (H-inv, P3), blocking recall and false blockers per unit-pass (H-rev, P5), and dollars and tokens per session. From these come passes per million tokens, matched blockers per million tokens, and a frontier of dollars per session against outcome per model and arm. All are descriptive.

## 10. Endpoints, families and claims

The unit of analysis is the task (Lane B) or unit (review). A task's share in a cell is the sum of waste calls over the sum of calls across that task's sessions in the cell. A cell's estimate is the mean of its task shares. A task whose calls total zero in a cell leaves every contrast with that cell, and is counted.

- **Family M, models differ (confirmatory).** Waste call share in the none arm, Opus minus Sol, Opus minus particle-1 and Sol minus particle-1, on H-inv and on H-rev: six tests, Holm at 0.05. If held-out transcripts can't be scanned (section 14), Family M runs on P1 and P4 instead, and that is recorded before any session is read.
- **Family A, gstack against none (confirmatory per model, when admitted).** Waste call share, after-t minus none, on H-inv and on H-rev: two tests per model, Holm within each model. Family A uses before-t if GST-1089 runs no after arm.
- **Claims.** A claim is made when a contrast's Holm-adjusted p is under 0.05. A claim under 3 points is labeled small. Every claim is stated as a share, beside its absolute and wall-clock readings.
- **Secondary (intervals, no verdicts):** token, dollar and wall-clock shares and the absolute readings for every Family M and A contrast; the same contrasts on P1 to P5; before-t minus none, after-u minus none, before-u minus none and after minus before; off-u and off-t on Opus; per-rule shares; R4b; U1 and its contrasts; byte-identical R1; readings both per context and on the merged stream for Lane B.

## 11. Analysis, power and admission

**Method.** It matches GST-1089 and reuses the repo's tested helpers in src/runner/stats (pairTaskMeans, the sign-flip test, holmAdjusted, minimumDetectable). A contrast pairs by cluster over the clusters both cells share and reads the mean per-cluster difference. Intervals are 95% percentile intervals from a cluster bootstrap with 10,000 resamples. p values come from two-sided Monte Carlo sign-flip tests on per-cluster differences, with 100,000 draws. Seed 1114.

**Power.** MDD = (z at Holm's first-step alpha + 0.842) x SE, with SE from the paired cluster differences. Holm's first-step alpha is 0.05/6 for Family M and 0.05/2 per model for Family A. Admission estimates SE from the archives and scales it to GST-1089's planned clusters (80 and 36 held-out; 37 and 33 public) by the square root of the cluster ratio. Every null states its reference rate (Opus in Family M, none in Family A) and its MDD.

**Admission.** It runs before the admission amendment merges, at $0:
1. **Scan.** All 635 Run D logs and 264 stacks round 1 transcripts scan with zero unreadable sessions. A failure is fixed in the adapter before the amendment.
2. **Precision per rule.** An Opus 5.5 reader gets min(30, all hits) flagged calls per rule, drawn at random with seed 1114. It is blind to rule, model and arm, and reads each call with its surrounding calls. It answers one question: would removing this call have changed nothing the agent knew or did next? A rule passes with 28 or more of 30, or with a Clopper-Pearson 95% lower bound of at least 85% when it has fewer than 30 hits. A rule with under 15 hits stays descriptive. A failing rule gets one fix, then a fresh sample drawn from sessions not used to design the fix. A second failure drops the rule from the headline share.
3. **Recall (descriptive).** The same reader marks every zero-information step in 20 random sessions, and the share the rules catch is reported. Under half labels every headline "lower bound, rules catch under half".
4. **Room.** The Opus none cell's waste call share on admission data is at least 2%, or some model and arm cell reaches 5%.
5. **Power.** A contrast is estimable when the archives hold at least 10 shared clusters for both its cells. The projected MDD must be at most 3 points for at least four of Family M's estimable contrasts. Family A is confirmatory for a model only if its projected MDD, from the archives' gstack-against-none contrast for that model, is at most 3 points; otherwise it is descriptive for that model.
6. **Checks reported:** the working-directory mismatch rate, and parser conformance by class.

If item 4 or 5 fails, the GST-1089 analysis runs descriptive only: intervals, no claims.

## 12. R48 verdicts

Every Family M or A null gets one Why-null cycle:
- exposure: the share of sessions with any check, any re-read and any subagent;
- task fit: do these tasks invite re-runs at all;
- power and floor: MDD against the margin, and the reference rate;
- frontier: does plain Opus already show near-zero waste.

The verdicts:
- **KEEP:** waste stays a standing secondary reading in later preregistrations.
- **FIX-METHOD:** a floor, a task-fit problem or a detector limit; Phase 2 is the fix.
- **CUT-CANDIDATE:** room and power were adequate and nothing differed. Its scope is in-session tool-call waste on single-task sessions only, and it never cuts the ship-pipeline question or Phase 2's branch (c).

When gstack adds waste in Family A, the post names the rules that fire more and the skill steps they trace to, plainly, as cut candidates for gstack's maintainers. A saturation null gets one ceiling-raise attempt, which here is Phase 2.

## 13. Custody and what is committed

- Held-out transcripts never leave custody. The scan works from a manifest that GST-1089's run thread writes inside custody: each encrypted path mapped to a random label, arm, model, replicate and instrument. The scan never derives ids from paths, and never prints or writes a path, a command or transcript text. It decrypts and stream-parses one session at a time into /dev/shm, so /dev/shm holds at most one transcript.
- The scan writes its per-session table only to a /dev/shm path given on the command line, or encrypts it in-process to the custodian key. Held-out analysis runs in custody on that table and emits only aggregates: per-cell rates, intervals and counts.
- A test plants a canary string in a path, a command and a result, and checks that it never appears in stdout, stderr or the table.
- Transcript input is untrusted. Files are streamed line by line, regex input is capped at 64 KB per field (longer results are compared only by sha256), only linear-time patterns are used, and each session has a memory cap.
- Public transcripts may be scanned anywhere. Still, only counts and digests are committed. Nothing committed quotes a transcript, a command line or a file path from any session.

## 14. Requests to GST-1089 (its Amendment B may take them; nothing here depends on them)

1. **Lane B record fields.** Add message_id and parent_tool_use_id to assistant messages, and parent_tool_use_id and tool_use_result to user messages, in Lane B's message log. All exist on the pinned Python Agent SDK. Without them, Lane B token readings are approximate, R2 and R3 run on the merged stream, and the post labels both.
2. **An optional tree digest.** An evaluator-side digest of the work tree after each tool call, taken outside the agent's view. With it, R1 and R2 also require an unchanged digest, which can only remove matches, and the agreement between epoch and digest is reported. Without it, the shell rules stand.
3. **Retention.** Keep each held-out session's transcript in the encrypted per-batch outputs until this analysis's results post merges and its R48 cycle closes. One named rescan in custody is allowed, at a FIX-METHOD repair.
4. **A dry run.** Drive the scan in GST-1089's dry run on a synthetic batch in the exact encrypted layout, with /dev/shm decrypts and leftover checks.
5. **One keyless scan per batch,** after scoring, with the manifest in section 13.

If requests 3 to 5 are declined, Family M runs on the public instruments, recorded before any session is read.

## 15. What stays open, and the build

Open until the admission amendment: the detector code sha, the canonical config and its sha256 (the lists and patterns in sections 4 and 5, plus the CLI truncation markers, line cap and timing lines), the PRNG the stats helpers use, the pinned CLI and SDK versions, and the admission numbers. The amendment may fill these in only within the definitions above, and may change a rule only through section 11's one-fix path, stated as a dated change. The canonical config is JSON with sorted keys, UTF-8 and LF line endings, with no spaces. Patterns use the RE2-compatible subset of ECMAScript regexes, as run by the pinned Bun. A golden test pins the output table's sha256 on a fixed fixture corpus.

The detector ships in its own pull request at gate class:
- src/waste: the adapters, shell.ts, one annotator pass, the rules as pure predicates over its state, the attribution and the analysis on src/runner/stats;
- one command-table row (gstack-evals waste scan and analyze) and new reason codes;
- tests/waste: property tests, plus fixtures generated by the real writers (Lane B's writer under the pinned Python SDK with a stub CLI, and review-units' driver with a stub CLI) and hand cases for every rule, every attack and every scan-status path.

It lists its shared-registry edits and pregate lanes. The crew-log reader for section 16 ships in its own pull request.

## 16. In-the-wild baseline (descriptive, its own post)

- **(a) The replay's per-PR data** (220 merged PRs, 7 repos): per repo, deterministic re-runs at a head CI also ran, rounds past R51's cap (R5), review passes per head, CI reruns, and the catches each gate made first. A field a repo lacks is reported as not measured. Repos other than this one get labels minted from random bytes; no private repo is named.
- **(b) Crew transcripts** for this repo's crew threads in that sample. Exports are written to /dev/shm outside any checkout and never cross machines, and are deleted, then checked gone, before the turn ends. Only counts and per-thread digests leave. Past incidents put credentials in transcripts, which is why the exports never sit on disk. The counts are R1 (same command, same output digest, no edit, commit or push between), R4 and R5. Tool results in these exports are cut short, so R1 here is approximate.
- These crews ran almost entirely on Opus 5.5, so this is a one-model baseline, never a model comparison.

## 17. Phase 2 (sketched, not built; its own gate)

A suite of 24 fixture ship tasks. Each is a small repo, a PR diff, the CI result and tree hash for that head, a brief that grants stated permissions, and 0 to 2 seeded blocking bugs. A third are clean, to count false blockers. Half are public and half sealed. It runs on review-units' rig with an evaluator-side tree hash at every tool-call boundary, and scripted feedback rounds make R5 measurable. Arms: none and gstack, on Opus 5.5, GPT-6.1 Sol and particle-1, 3 replicates: 432 sessions. Expected cost about $1,900 in paid calls (cap about $3,500) plus about 150M host tokens, re-costed at its gate.

It starts only if one of these holds:
- (a) a Family M or A contrast makes a claim on GST-1089 data;
- (b) on admission or public data, some model and arm cell's waste call share reaches 10% and a model contrast's 95% interval excludes 0;
- (c) the in-the-wild baseline shows deterministic re-runs at a tree CI ran, plus rounds past the cap, above 10% of the measured ship-check wall clock.

Otherwise it is not built, and the null goes through R48.

## 18. Spend

Phase 1: $0 in paid calls. Host model use is about 220M tokens, or about $220 at about $1 per 1,000 Capy credits: about 35M for this post's ship, about 120M for the gate-class detector ship, about 30M for the build, about 12M for the admission readers and about 25M for the baseline. Phase 2 needs its own approval.

## 19. Outside terms, licences and rights

Phase 1 adds no data source, benchmark, dataset or model call. TB2's licence covers P1 to P3, and GST-1089 records it; no task content is committed here. stacks round 1's units come from gstack's public pull requests. Provider and OpenRouter terms are GST-1089's, and this analysis follows whatever GST-1089 decides for the particle-1 cell. The replay data and crew transcripts are private sessions: counts and digests only. Phase 2's fixtures would be authored fresh, on permissively licensed bases only.

## 20. Not in scope, and risks

Not in scope: any paid call; Phase 2's build; any change to GST-1089 beyond the requests in section 14; Sonnet 5.5 or Haiku 5.5 cells; Sol in its native harness; an LLM-judged waste label.

Risks:
- GST-1089 slips. Admission and the baseline still land.
- Base rates near zero in short sessions. Admission item 4 catches it, and Phase 2 is the fix.
- A detector bug. Gate-class review, fixtures from the real writers, and the precision audit.
- "Waste" reads as blame. The post says zero-information steps, with outcomes beside every number.
