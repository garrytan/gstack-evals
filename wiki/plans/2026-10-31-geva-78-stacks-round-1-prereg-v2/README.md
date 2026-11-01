---
id: 2026-10-31-geva-78-stacks-round-1-prereg-v2
kind: plan
title: "Stacks round 1 preregistration, version 2: TB2 gstack minus none, the step 5 tools, frozen scanner rules, a $200 judge envelope and the rig re-pin"
summary: "Supersedes the stacks round 1 prereg: TB2 gstack minus none, derived readings, frozen scanner rules, a $200 judge envelope, a planned Fable 5.1 rung, a re-pin to #97 and a keyless dry run."
author: GEVA-78
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-10-31
status: open
supersedes:
  - 2026-10-31-geva-76-stacks-round-1-prereg
links:
  - 2026-10-31-geva-76-stacks-round-1-prereg
  - 2026-10-30-geva-59-stacks-round-1-plan
  - 2026-10-29-gsta-30-laneb-quick-3-prereg
attachments:
  - abcc7fdc69f1e1844e1bad6686ea208dcac6d915c6a29f1816d8022d7650704d  dry-run.sh.txt
  - 7b98317fda76c24823c8ffe87168a9307cf19b69ef3f304a5af3c69132612b68  dry-run.txt
  - ad102609c5bb0ad40a1c6f90f0b4a841a4bffcceee5c8489b1a16dabb2c45c0f  fixtures.ts.txt
  - 1130e8631475dd7d17f1224baafabb64d114017c95754a2d832f9855aa1f84cc  judge-fake.ts.txt
  - ddfd6eaffa35bafd3797415d02837a85f35994684c860b54acc17a82f02f42f0  severity-map.pstack-high-medium.json
  - 611cbf8c9ae0b60e889b21d5889933b37b48e2c84864623ec7dbc609b1213fcc  severity-map.pstack-high.json
  - 1a4ea8a89ef0f900b228ef1b935b4e2e96cc530559a92eda98d74abcbab953b7  severity-map.tstack-should.json
---

# Stacks round 1 preregistration, version 2

This post replaces [2026-10-31-geva-76-stacks-round-1-prereg](../2026-10-31-geva-76-stacks-round-1-prereg/README.md) (#95) as stacks round 1's frozen preregistration. Every rule, pin and attachment of #95 stands as written, except the changes below. Each change does one of two things: it adds what Garry or the Captain asked for after #95 merged, or it fixes a rule that a keyless dry run showed the pinned code could not execute. Nothing here changes the arms, the models, the suite, the told text, the primary severity map or the LOSS family. Section 7 plans an exploratory Fable 5.1 rung outside the primary family. It joins only through a later amendment.

Where this post names an attachment of #95 (stacks-r1.json, comparisons.stacks-r1.json, comparisons.stacks-r1.opus.json, severity-map.json, contamination.tsv, labels.tsv, unit-tests.tsv, judge-brief.md), it means that file in #95's folder, pinned by its sha256 there.

## 1. Rig pin

Rig: garrytan/gstack-evals@715f837c353700344785e2ae2c721e8195d616cd (#97), replacing #95's 2194879. #97 is the squash merge of the step 5a fixes. It sits on #96 (9b29f6c), which carries the step 5 build items: the judge runner (`noloss judge-run`), the re-derivation tool (`noloss derive`), the contamination scanner (`noloss flag-scan`), the section 7 secondaries (`noloss secondary`) and the TB2 contrast script (quick/laneb/analysis/stacks-tb2.ts). The trial image recipe is unchanged at e742c72a07d63feb (the dry run prints it at the pin). The TB2 runner tag `laneb-stacks-1-runner` and every arm pin stay as #95 section 2 has them.

#97 changed:

- Retries. judge-run retries a 429 or 5xx within JUDGE_RETRY (3 attempts within 900 s), and `judge-run --dry-run` prices 3 sends per request and prints the item's cap and headroom line (GST-490, GST-474). Section 5 freezes the budget.
- Sealed-output guards. derive and flag-scan refuse an in-repo `--out` for a sealed suite, and insideRepo resolves symlinks, dangling ones included (GST-478).
- flag-scan's rules (GST-501). Section 4 freezes them as #97 left them.
- Impact binding. judge-run writes a finding_sha256 column in impact.tsv, and `derive --impact` requires it and refuses a row whose finding changed since judge-run read it (GST-506).
- The secondary guards: `noloss secondary` gates on coverage (GST-479) and never pools labelled and blind judgments (GST-480).

#95 section 9 said the judge runner lands in its own pull request before any judging spend. It landed in #96 with the other build items, and #97 fixed it, both before any spend.

## 2. TB2: gstack minus none, and the code that computes section 8

**The arms do not change.** Every TB2 model already has a none arm: Opus 5.5 runs none, gstack and pstack, and Haiku 5.5 and particle-1 run the same three plus gstack-placebo and pstack-placebo (#95 section 8; the plan's cost table counts five arms per cheap rung).

**New row: gstack minus none, per model** (Opus 5.5, Haiku 5.5, particle-1). Garry, 2026-10-31: "Ok well all of our head to head tests have to test no gstack from here so that that case is tested obviously Do it for science". It is frozen the same way as pstack minus gstack: paired by task, task-clustered bootstrap, 10,000 resamples, seed 20261031, printed on all 40 tasks and on the original 20, under both no-reward readings. It sits beside pstack minus gstack in every table and in the claims. It enters no win rule.

**The code.** TB2's contrasts come from `bun quick/laneb/analysis/stacks-tb2.ts <config>` at the rig pin. The config is analyze.ts's: models, `reference: claude-opus-5-5`, the job folders, the proxy-sessions.jsonl files, and `subsets.original_20` from quick look 3's analysis config. It prints pstack minus gstack, pstack minus pstack-placebo (Haiku and particle-1) and gstack minus none for each model, the win rule per model, and the TB2 idea cards below. It prints every table twice: with each no-reward trial scored 0, and with those trials dropped.

Why the script: the dry run shows that the runner tag's analyze.ts cannot run section 8. Its contrast pairs are fixed to gstack minus none, gstack minus placebo and placebo minus none, so it prints no pstack row. It also drops every trial without a reward as infrastructure: 12 trials in the dry run, where section 8's rules leave out 5 and score 7 as 0. stacks-tb2.ts reads the job folders through main's analyze.ts loader, which carries quick look 3's frozen outcome rules, the same rules section 8 states. A trial with a reward is graded on it. A trial with no reward after a model response scores 0, and the drop reading is printed beside it. A trial no model response reached is infrastructure. An agent timeout or a session cap is graded as it stands. A verifier timeout after a model response is a no-reward trial, so it scores 0 and is listed with its reason. Section 8's plan to recompute timeouts by hand from analyze.ts's list is no longer needed.

The win rule is unchanged: pstack wins a model's cell when its interval against gstack lies above zero and, on Haiku and particle-1, its interval against pstack-placebo lies above zero too. Skill opens still come from the tag's analyze.ts, which pools the two pstack forms as section 8 says. The dry run runs it on the same jobs.

**TB2 idea cards** (#95 section 7) come from the same script. A task counts as a win when pstack passed it at least twice and gstack never, among the model's graded trials. The null swaps the two arms' trials within each task, each task independently with probability one half, 10,000 permutations, seed 20261031. The script prints the null's mean and 95th percentile (nearest rank) beside the observed count.

## 3. Review readings, re-specified against the landed tools (GST-452, GST-454)

#95 section 5 said the derived comparisons file "names the derived suite's path". The pinned scorer refuses a path there, so `noloss derive` writes the derived suite's id into the copied comparisons file, and `score` takes the derived suite's path with `--suite`. Every derived reading below runs the same way:

```
gstack-evals noloss derive --suite stacks-r1.json --comparisons <comparisons file> --root <arms root> --id <reading id> --out <dir> <operation>
gstack-evals noloss score --suite <dir>/<reading id>.json --root <dir>/arms --prereg <dir>/comparisons.<reading id>.json --variant <id> --reference <id>
```

`score` runs once per comparison in the file, and each run scores the file's whole Holm family. The comparisons file is comparisons.stacks-r1.json, or comparisons.stacks-r1.opus.json after the particle-1 drop. derive changes no finding, match or ruling. It drops units for every arm alike, marks blockers detection-only, or re-maps severity. A stopped arm becomes complete in a derived suite only when every one of its coverage gaps names a dropped unit and it left no session unrun. A gap that names no unit is never cleared.

| Reading | #95 | Operation |
|---|---|---|
| Without flagged passes | section 5 | `--drop-file flags.tsv`, from `noloss flag-scan` (section 4 below) |
| Complete case, secondary | section 9 | `--drop-gaps`: every unit with a coverage gap, or with a judgment written coverage incomplete because a packet stayed unjudged, in any arm |
| Provable by a run | sections 1 and 5 | `--detection-only <unit>:<blocker>` for each blocker labels.tsv labels read (3) |
| Diff-scoped tests run | section 5 | `--drop-file` of unit-tests.tsv's rows with `tests_run` no |
| Diff-scoped tests cannot run (a listing) | section 5 | `--drop-file` of unit-tests.tsv's rows with `tests_run` yes |
| gbrain stratum | section 7 | `--drop-file` listing every garrytan/gstack unit |
| tstack SHOULD as informational | section 3 | `--severity-map severity-map.tstack-should.json` |
| pstack confirmed findings split by pstack's own severity | section 3 | two readings: `--severity-map severity-map.pstack-high.json` (confirmed HIGH is blocking) and `severity-map.pstack-high-medium.json` (confirmed HIGH and MEDIUM); the primary map is the third step (every confirmed finding) |
| Blocking by the judges' impact rating | section 3 | `--impact <matching run>/impact.tsv --key <matching batch key> --impact-judge anthropic/claude-opus-5-5`: the primary judge's ratings, an unrated finding counting as non-blocking |

**impact.tsv.** At the rig pin the runner writes six columns: packet, opaque, judge, impact, batch and finding_sha256. #95's frozen judge-brief.md lists the first four (packet, opaque id, judge, impact), and its text is unchanged. `derive --impact` requires all six. It refuses a row from a batch other than its `--key`'s, and a row whose finding_sha256 differs from the finding the arm now holds.

Section 1's provable-blocker test, "the same one-sided test on the run stratum alone gives p below 0.05", reads the unadjusted `p loss` of pstack-vs-gstack in the provable-by-a-run reading.

**Escaped-defect stratum.** #95 section 7 reports it apart without defining it. Here it is every blocking blocker whose case is an escaped defect, a bug a later PR fixed (case ids `<repo>-<pr>-fixed-by-<pr>`). The suite holds one, garrytan/gstack#1808 B1. Like the read stratum, it is a listing: each arm's outcome per pass from its judgments.tsv.

**Recall at any severity, new blockers and idea cards** come from one command, run for pstack-opus, tstack-opus and none-opus against gstack-opus, and for pstack-particle-1 and none-particle-1 against gstack-particle-1:

```
gstack-evals noloss secondary --suite stacks-r1.json --root <arms root> --variant <id> --reference <id> --seed 20261031
```

It prints each arm's blocking recall and its recall at any severity (blockers found at any mapped severity, PR-clustered intervals). It prints the new-blocker table: unmatched blocking findings that blind adjudication rules a defect, per pass per PR, paired by PR with the clustered interval and the exact two-sided sign-flip test, the way `score` pairs false blockers. It has no reading when either arm stopped or has an unadjudicated blocking finding. It also prints the review idea cards: blocking blockers the variant found in every pass and the reference in none. Their null swaps the two arms' labels within each unit, each unit independently with probability one half, 10,000 permutations, seed 20261031. The two arms need the same passes, and a blocker with a missing or coverage-incomplete judgment in either arm is left out and counted. The card rule is #95's: observed wins above the null's 95th percentile, or a mechanism a blinded reader names.

**Secondary guards.** GST-479 (the secondaries gate on coverage) and GST-480 (labelled and blind judgments never pool) are fixed at the rig pin by #97, so every secondary above reads at the pin.

**The verifiable sensitivity** (#95 section 7) is judge-run's unverifiable.tsv and its per-arm line. A not-defect ruling counts as unverifiable when a judge whose ruling judge-join keeps for that finding (the primary, and the second or third when the finding is in its set) marked it `verifiable: false`. Only an explicit false counts. The per-arm figure is the count divided by passes and by the suite's PR clusters. The sensitivity reading is a count, not a test. Each arm's false blockers per PR per pass, as `score` reports them, minus that arm's unverifiable figure, printed beside the primary figure.

**Packet seeds.** Both judge-packet batches, matching and adjudication, use `--seed 20261031`. #95 named none.

## 4. The contamination scanner's rules, frozen

#95 section 5 states the transcript rule. Its /ship red-team asked for the rule's mechanics to be frozen too. They are `noloss flag-scan` at the rig pin (lanes/review-noloss/flag-scan.ts), as #97 left them. The file's header states them, and this section describes that text. The rules apply to every tool call of the main agent and its subagents in each session's transcript.ndjson, whatever the call's result.

- Paths. A call's paths are Read `file_path`, NotebookRead `notebook_path`, Grep `path`, LS `path`, Glob `path` joined with its pattern, the SKILL.md a Skill call loads, and every word of a Bash command after `~`, `$HOME` and `${HOME}` expand to the session home (/home/agent), with relative words resolved against an earlier `cd` in the same command. A bare `cd` goes to the session home. A command after a `cd` also touches the directory it runs in, except that a listing naming a path lists only that path. Redirections and a listing's option values are not paths. A word holding `*`, `?` or `[...]` is a shell glob: `*` and `?` match within one path segment and `**` across segments, so the word touches every audited file it matches. `{a,b}` is a choice. The arm's told command loads its skill's SKILL.md at session start, so that counts as a read in every pass.
- `read`: a path that maps to a file contamination.tsv lists for the unit (its diff-path rows, and the file of its mention rows).
- `recursive`: a Grep call, or a Bash `grep -r`, `rgrep`, `rg`, `ag`, `ack`, `git grep` or `diff -r`, whose path is a directory holding such a file at any depth, an ancestor of an install root included. A call rooted at / reaches every root.
- `list`: a listing that shows such a file's name. `ls` and LS list a directory's entries, so they flag a file directly in it, except `ls -d` (or `--directory`), which lists only the directory itself. `ls -R`, `find` and `tree` list every file below their path, an ancestor of an install root or / included. Only three things narrow that: find's one `-name` test and `find -maxdepth`, when find runs no action (`-exec`, `-execdir`, `-ok`, `-okdir` or `,`), and `tree -L`. A Glob, or a listing that names the file itself, flags each file it matches.
- `search`: a call with any path in the roots, or a recursive call from an ancestor of a root, whose Grep pattern or Bash words hold the unit's PR number as a whole number, or 7 or more leading hex characters of a fix commit of one of the unit's blockers.
- `no-transcript`: a stack-arm session directory without transcript.ndjson cannot be read, so it is flagged.
- A catalog problem, or a blocker whose case is in none of the suite's catalogs, fails the scan, since the search rule reads each blocker's fix commit from its case.
- Roots under the session home: gstack ~/.local/share/gstack and ~/.claude/skills (a path under ~/.claude/skills/<name>/ maps to <name>/ of gstack's tree, and ~/.claude/skills/gstack/ to its root); pstack ~/.local/share/pstack; tstack ~/.claude/skills and ~/.claude/agents. The none arm has no roots.

The `list` rule comes from #95's own wording, which flags a session that "reads, lists, greps or diffs" a listed path, and from a Captain ruling (GSTA-2): a listing of a gstack directory counts, and it flags what it shows.

contamination.tsv names gstack only, so pstack and tstack can be flagged by the search rule alone. The scanner writes one row per flag (unit, arm, model, pass, rule, tool, call, path, audit_path), and `derive --drop-file` reads its unit column.

One consequence shows in the dry run. contamination.tsv lists review/SKILL.md for both gstack#3516 units, because their diffs change it. gstack's told /review loads that file in every pass, so every gstack pass on those two units is flagged, and the reading without flagged passes always drops at least those two units.

**Known limits.** The frozen rules miss some calls that touch an audited file:

- GST-563: a brace choice whose alternatives span a /.
- GST-613 lists eight more, F1 to F8: a listing behind a prefix command; option values counted as operands; literal paths matched as globs; bracket-class edge cases; F6, which is unverified; F7, `cd -` and `cd -P`; F8, ls option values that look like `-d` (the value of `-I`, `--hide` or `--ignore`, and clusters such as `-Id`); and a symlink route through `..` in insideRepo.

They bias the result one way. A contaminated gstack pass that the scanner misses stays in the reading without flagged passes, and that favours gstack. They stay unfixed in round 1, since a fix would re-pin the rig again.

**Disclosure rule.** The results report how many scored transcripts contain an `ls` carrying an option that takes a value (`-I`, `--hide`, `--ignore`, `-w`, `-T`, `--sort` and the like, clusters such as `-Id` included). If that count is above zero, each hit is checked by hand against the frozen rule text above before the reading without flagged passes is published, and the results list each hit with its outcome.

## 5. Judging spend and the judge ledger items

**The judging envelope counts inside the $2,050 review stop.** #95's rule that the settled spend of closed review items plus the caps of open ones never passes $2,050 covers the judging items as well.

**The envelope rises from $110 to $200** (the Captain's amendment to the cap approval, GSTA-2, 2026-10-31). The review lane's $2,050 hard stop and the round's $2,400 cap do not change. The reason: with GST-490's retries, the ask-once worst cases on the dry run's fixtures are $77.77 for matching and $99.21 for adjudication, $176.98 together, which pass $110, and a cap stop loses the batch.

**The single judge item is split.** A gstack-evals ledger item binds to its first run, and the adjudication batch can only be packed after the matching batch is joined, so it is a second judge-run. On #95's one item it is refused with E_ITEM_BOUND, as the dry run shows. The judge row of #95's table becomes:

| Item | Invocation | Cap |
|---|---|---|
| `stacks-r1-review-judge-match` | judge-run on the matching batch | $90 |
| `stacks-r1-review-judge-adjudicate` | judge-run on the adjudication batch | $200 minus the settled spend of every earlier judge item (the match item and its rerun, if any), admitted after those runs settle |

Together they never pass $200, which is raised only inside the stop.

**Retry budget, frozen.** JUDGE_RETRY in lanes/review-noloss/judge-run.ts at the rig pin: each request gets at most 3 sends, the first included, and no new send starts once 900 s have passed since the first began. The metering proxy retries a 429 or 5xx inside that budget. A 5xx without usage is charged its full reservation, so the dry run prices every request at 3 sends. Past the budget, the error comes back to judge-run, which stops the run with no reply files.

**Worst cases at the pin.** `judge-run --dry-run` on the dry run's fixtures (33 packets per batch, steps 15 and 28 of [dry-run.txt](dry-run.txt)), with the match item at $90 and the adjudicate item at $110, its cap when the match item settles at its full $90:

| Item | Cap | Ask once, 3 sends | Every answer asked again |
|---|---|---|---|
| match | $90 | $77.77 (primary $38.46; second up to $20.09, third up to $19.23) | $155.54 |
| adjudicate | $110 at the tightest | $99.21 (primary $48.54; second up to $26.39, third up to $24.27) | $198.42 |

Each item's cap and headroom line, as judge-run prints it:

```
item stacks-r1-review-judge-match: cap $90.00, $0.00 committed, $90.00 left; the worst case $77.77203 fits, and asked again $155.54406 does not fit. The cap stops the run wherever it falls.
item stacks-r1-review-judge-adjudicate: cap $110.00, $0.00 committed, $110.00 left; the worst case $99.208518 fits, and asked again $198.417036 does not fit. The cap stops the run wherever it falls.
```

The case where every answer is asked again is not covered. Neither item's cap holds it, and the item cap stops the run there. A cap stop is an incomplete run and is never rerun. These figures come from synthetic packets. Before each real run, `judge-run --dry-run` prints the same lines on the real batch, and the results quote them.

**Fit check.** The review arms' central projection is $1,043 for the Opus cells and $187 for the particle-1 cell (the plan's cost table), plus $120 for the three pilot items in #95's ledger table ($60, $30 and $30). That is $1,350. Adding the $200 envelope gives $1,550, under $2,050. The start rule (#95 section 9) still checks the real figures before each grid starts.

**Stops.** judge-run stops a run with no reply files on a provider error or a proxy refusal. Requests already in flight when a run stops keep retrying within their own budget (GST-579). The proxy meters them against the item's lease, so the ledger cap still binds. A stop for an infrastructure reason (a provider error other than a cap stop, the proxy down, a lost machine) is run again fresh once, under `stacks-r1-review-judge-<match|adjudicate>-rerun`, with what the $200 has left. A cap stop is never rerun.

## 6. The dry run

[dry-run.sh.txt](dry-run.sh.txt) runs every frozen rule of #95 and of this post, keyless, through the code at the rig pin, on seeded synthetic fixtures ([fixtures.ts.txt](fixtures.ts.txt)). The fixtures are seven raw arms on stacks-r1 (the four Opus arms at two passes, tstack-opus stopped by one synthetic session timeout, and the three particle-1 arms at one pass), a review-units session tree for the scanner, and 1,560 TB2 trials over the three models' cells. They record the two judge items at $90 (match) and $110 (adjudicate), the tightest case under section 5. The judge steps run judge-run in process against a fake provider ([judge-fake.ts.txt](judge-fake.ts.txt)). So the runner, its metering proxy, the ledger lease, the evidence sheets and the reply files are the pinned code, and only the answers are made up.

The dry run covers:

- both judge batches, from `judge-run --dry-run` worst cases and each item's cap and headroom line through judge-join and ingest
- the E_ITEM_BOUND refusal on a single item
- every comparison of comparisons.stacks-r1.json, with the stopped arm's comparisons read as no verdict through `score --expect`
- the particle-1 drop: the full file refused with E_NOLOSS_ARM, then every comparison of comparisons.stacks-r1.opus.json
- the secondaries
- flag-scan and the reading without flagged passes, the complete case, the four strata and the escaped-defect listing, and the four severity sensitivities, each derived reading scored on every comparison
- TB2 through stacks-tb2.ts and through the tag's analyze.ts

[dry-run.txt](dry-run.txt) is its transcript at the rig pin: 192 steps, each with its command and exit code. Its machine paths are written as $R (gstack-evals at the pin), $W (the work dir), $SRC (the unit clones) and $D (the dry-run folder), so it names no local path. 62 exit 0, 5 exit 1 and 125 exit 2. Every step exits as designed. `score` exits 1 on LOSS and 2 on NOT_DISTINGUISHED, NOLOSS_UNDERPOWERED, no verdict or a refusal, and the particle-1 drop's E_NOLOSS_ARM (step 52) is one of those refusals. The only other non-zero exit is step 29, E_ITEM_BOUND on #95's single item. flag-scan flags 7 unit-passes: 6 gstack `read` flags, 4 of them the gstack#3516 Skill loads above, and 1 pstack `search` flag. The fixtures' verdicts mean nothing.

Against the transcript at #97's first head (fb3b859), the exit codes match step for step. The only differences are the rig line, the sha256s of derive.ts, flag-scan.ts, judge-run.ts and suite.ts, which #97 changed after that head, the run ids in the E_ITEM_BOUND line, and the two item lines, which this version of the script shows.

To rerun it: `R=<gstack-evals at the rig pin> SRC=<dir holding gstack/ and gbrain/ clones with every unit head> bash dry-run.sh.txt <empty dir>`, after `git -C $R show laneb-stacks-1-runner:quick/laneb/tasks/final.json > <dir>/final.json`.

## 7. Planned amendment: an exploratory Fable 5.1 rung

Garry decided, through the Captain on 2026-10-31, to add an exploratory claude-fable-5-1 rung to the review lane. It covers the none and gstack cells only, on a subset of units at one pass, under its own ledger item of up to $600. It sits outside the primary family: it enters no LOSS family and no win rule, and the results report it beside Opus's none and gstack cells on the same units, marked exploratory.

This post does not activate it. At the rig pin, policy/models.json marks claude-fable-5-1 `smoke_only`. The rung joins before its cells run, through an amendment that re-pins the rig to a merge carrying the policy change (GEVA-81 is adding it to #101). That amendment admits the item only up to the smaller of $600 and the $2,400 round cap's headroom at admission: $2,400 minus the settled spend of closed items and the caps of open ones, across both lanes. Nothing else changes.

**Subset size.** 16 units, from this arithmetic:

- Price. src/runner/pricing/prices.ts at the pin lists Fable 5.1 at $10 input, $50 output, $0.25 cache read and $12.50 cache write per million tokens, and Opus 5.5 at $4, $20, $0.20 and $5. No Fable price is more than 2.5 times Opus's, so a Fable session costs at most 2.5 times the same Opus session.
- Sessions. The plan's central estimates per Opus unit-pass are $1 for none and $8 for gstack, $9 a unit for both cells at one pass. On Fable that is at most 2.5 × $9 = $22.50. With #95's start-rule margin of 1.4, it is $31.50.
- Judging. The dry run's ask-once worst cases at 3 sends are $77.77 and $99.21 on 33 packets, $2.36 and $3.01 a packet, $5.36 a unit for both batches. Those packets carry seven arms' findings, and a Fable batch carries two, so this is an upper figure.
- Per unit: $31.50 + $5.36 = $36.86. $600 / $36.86 = 16.3, so 16 units, $589.76 in all.

At the plan's high ends ($2 and $14 a unit-pass), 16 units would need $640 for the sessions alone, and the item cap would stop the run there. So the amendment redoes this arithmetic with the Opus pilots' measured cost per unit-pass in place of the plan's estimates, and with the admitted cap in place of $600, and takes the smaller subset. At the projection, the round's headroom once both lanes settle is $2,400 minus $1,550 for review and $171 for TB2 (the plan's table), about $679. While both lanes' stops are still open caps, the headroom is $50.

The amendment also fixes which units run, by a seeded draw from the suite before any review arm's result is read, and splits the item into one item per invocation as #95 section 9 does: the Fable sessions and the Fable cells' two judge runs, with caps that never sum past the admitted amount.

## 8. Changes from #95

- Rig re-pinned to 715f837c353700344785e2ae2c721e8195d616cd, #97's merge, which carries #96 (section 1).
- TB2: gstack minus none per model, frozen like pstack minus gstack; the contrasts, both readings and TB2 idea cards come from stacks-tb2.ts, because the tag's analyze.ts has no pstack pairs and drops no-reward trials (section 2).
- Derived readings run through `noloss derive`. The derived comparisons file names the derived suite's id, not its path (section 3).
- impact.tsv gains the batch and finding_sha256 columns, which derive requires; judge-brief.md is unchanged (section 3).
- The escaped-defect stratum is defined: one blocker, a listing (section 3).
- pstack's own-severity split is two frozen re-maps (section 3).
- Recall at any severity, the new-blocker test and the review idea cards come from `noloss secondary`, with GST-479 and GST-480 fixed at the pin. The verifiable sensitivity comes from judge-run (section 3).
- Both packet batches use seed 20261031 (section 3).
- The contamination scanner's rules are frozen as #97 left them, with their known limits and a disclosure rule for ls option values (section 4).
- The judging envelope rises from $110 to $200 inside the $2,050 review stop: a $90 match item and an adjudicate item of $200 minus the settled spend of every earlier judge item (the match item and its rerun, if any). The retry budget is frozen at 3 attempts within 900 s, and one fresh rerun is allowed for an infrastructure stop (section 5).
- An exploratory Fable 5.1 rung is planned for a later amendment, not activated here (section 7).

## Attachments

- [dry-run.sh.txt](dry-run.sh.txt), [fixtures.ts.txt](fixtures.ts.txt), [judge-fake.ts.txt](judge-fake.ts.txt): the dry run.
- [dry-run.txt](dry-run.txt): its transcript at the rig pin.
- [severity-map.tstack-should.json](severity-map.tstack-should.json), [severity-map.pstack-high.json](severity-map.pstack-high.json), [severity-map.pstack-high-medium.json](severity-map.pstack-high-medium.json): the sensitivity re-maps.
