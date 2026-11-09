# Eng-review intentions eval

Code for the preregistration in wiki/plans/2026-11-08-geva-405-eng-review-intentions-prereg/: does a review by the
pre-cut plan-eng-review, autoplan's eng phase or the rebuilt /plan-coverage candidate name more of the paths where a
change's real post-merge bugs, follow-up tests and CI changes landed than the same model with no gstack or with a
one-line engineering-manager prompt?

Nothing here holds unit text, keys or reviews. They stay sealed outside the repo; the repo gets counts and digests only.

## run side

review-units --plan eng-review (src/trial/review/er-cli.ts) runs the review sessions; src/trial/review/eng-review.ts
holds the lens's arms, prompts, settings, unit trees, pins, order and admission, and src/trial/review/er-run.ts the
session loop. This lane reads and checks them:

- er render --gstack <checkout at 199931029> --plan <plan.md> --out <dir> renders one unit's eng phase opening (render.ts).
- er exposure --session <attempt dir> --arm precut|engphase|candidate prints one session's detector checks (exposure.ts).
- er rows --run <dir> [--run <dir> ...] --out <rows.jsonl> writes one row per planned session (rows.ts). The out file must sit outside the repo.
- stophook.ts is smoke rule 2's Stop hook, on only for a run started with --enforce <arm>.
- run-checks.ts exports runSideChecks(), the run-side cases of section 16 item 4, for the score side's dry run.

**Admission.** An attempt starts only when the settled spend plus the $10 allowance of every attempt in flight plus its
own $10 allowance fits under --spend-cap. A retry is a new attempt admitted the same way, and one that doesn't fit is a
cap stop. The proxy's own cap stop stays. --parallel n (default 1) caps attempts in flight. --spend-cap is the lease the
launch opens on --item, and the command refuses one larger than the item's recorded cap less its committed spend. The
shared run loop admits whole rounds at twice their worst case (src/trial/review/run.ts, the round loop), so this lens has
its own loop on the same rig, driver and runTrial. A resumed run reuses every journaled session whose key still matches,
carries its spend, and carries cap-stopped cells with their spend; it never retries them.

### Build-time choices (run side)

Each one is tested in both directions under tests/er/.

1. **Prompts.** Each part (the arm's prefix, the forced sentence, the common line) sits on its own line, then a blank line and the template.
2. **Rec user.** plan.ts's recommended-option user (a persona, no scripted replies) with one fixed reply, "Go with your recommendation.", to every question.
3. **Mounts.** The work dir is /work itself and holds plan.md and repo/ only. Skill arms add the gstack state root at /work/.gstack-home. none and lens get no state root, no gstack install and no skills. The eng phase arm adds six rendered files read-only under /work/autoplan/.
4. **Harbor.** It doesn't run in review-units, so there is no HARBOR_TELEMETRY to set.
5. **Order.** Units in the order given; each unit's cells sorted by sha256("20261108/unit/arm/model/pass").
6. **Cap.** Settled spend counts this launch's lease only.
7. **Unit trees.** Refused: a top level other than plan.md and repo/, a byte copy of key.json anywhere, and a repo/ with more than one commit, a parent, a remote, a shallow file, or an unreachable or reflog-only commit. git runs with hooks, fsmonitor and LFS filters off.
8. **Pins.** The command clones https://github.com/garrytan/gstack fresh unless --gstack names a clone, checks each sha, VERSION and both candidate digests there, and checks VERSION, both digests and ~/.claude/skills/plan-coverage/SKILL.md again in the installed trees.
9. **Attempts.** Each attempt runs in its own fresh directory, <session>/a1 and <session>/a2. A retry goes to the head of the queue.
10. **Sinks.** At every session end the state root goes to host/gstack-state and /work/repo/.gstack/plan-coverage to host/plan-coverage, for every arm. Both are copied with the run's records to the receipts sink, which must not exist before the launch.
11. **Stop hook.** An SDK-side Stop hook in the driver reads the transcript so far, plus the hook's last assistant text, and the live state root and plan-coverage folder. It blocks with ER_STOP_MESSAGE, naming the missing outputs, at most twice, then releases. Blocks print per session.
12. **Decisions.** exposure.ts's erDecisions on each skill session's last attempt, stored in the journal: AskUserQuestion calls answered or not, pre-cut's decision ledger, the eng phase's classification tables, the candidate's Decisions list, and whether the test plan artifact was written.
13. **Rows.** Exposure only for a skill session that ended block or no-block. A planned session with no journal line is missing, with the spend stops.json carries or null.
14. **Renderer.** See render.ts's header: the four autoplan parts whole, eng-phase.md in full, the snapshot tool run keyless in a scratch dir, host paths rewritten to /work paths with every identity recomputed, and a plan with only one of the two wrap headings refused.
15. **Detectors.** See exposure.ts's header: only the main agent's own text and what its successful Write, Edit and MultiEdit calls wrote count. The native eng voice counts through its dispatch and terminal result.

## score side

Everything from rows and keys to readings (GEVA-414). Every command is keyless except er judge, er generic and er probe
ask, which spend only through lanes/product-value/meter.ts on the ledger item they name. Every output path sits outside
the repository, and no command lets an output alias an input. Helpers come from the product-value lane by import
(io.ts, stats.ts, meter.ts, judge.ts's client, lastJson and resend note, cutoffEnd).

- stock.ts: section 8's three stock rows and the stock paths, verbatim, normalized with parse.ts.
- prompts/: the judge brief, the audit prompt, the pairwise prompt, the arm-guess probe and the recognition probe, each
  pinned by sha256 in judge.ts. The brief and audit prompt carry section 7's anticipated rule and specific-match rule
  verbatim and three generic examples written for this post.
- units.ts: readers for unit folders and rows.jsonl.
- er oracle (oracle.ts), er packets (packets.ts), er judge (judge.ts), er generic (author/generic.ts), er probe
  (probe.ts), er score (score.ts), er readings (rules.ts), er dryrun (dryrun.ts).
- cutoffs.json: each model's stated training cutoff from section 11.

### Build-time choices

The prereg names these rules without their mechanics. Each is the simplest choice that serves its words; the tests and
the dry run drive each in both directions.

1. Stock rows drop the prereg's "(1)" to "(8)" numbering. Row 3 counts toward STOCK FAIL ("any one row") but is never a
   judge-check anchor and never screens.
2. Label packets hold every key item (primary, mentioned, generic) and the own-test items, so every secondary reads the
   same labels. A B item's statement adds "Files and functions:" and its blamed sites. The shuffled-key packet holds the
   same lists and stock rows against the deranged unit's primary items only.
3. Derangement: over every keyed unit with a primary item, in levels (same repository, same type and language, same
   type, all). A group of two or more forms one seeded cycle; a lone unit joins an existing cycle of its group at that
   level by a seeded swap, else falls to the next level.
4. Labels: an anticipated cell must name check indices and a credit (check or code); anticipated implies path hit. A
   particle-1 panel cell is split when Astra and Opus differ on anticipated or path hit; each label takes the majority
   of three, indices are the union of the yes votes, credit the majority of the anticipated votes (a tie takes check).
   In the judge check, Gemini settles only the anticipated disagreements, for the all-cells kappa print.
5. Oracle list: one check per primary item, "Test <file>[ <functions>]: <statement>", normalized.
6. Stage 2 gold: per production judge, 20 anticipated and 20 not-anticipated gold cells over B, T and C items, each
   class drawn round-robin over (arm or anchor, item kind) strata. Gold packets number one per 8 of that model's
   unit-pass packets, sit after their batch in the judge order and show their source packets' items, drawn lists and
   the three stock rows. "40 per family" in the plain rendering is read as 40 per model whose lists they are.
7. Anchor weighting: anchors (stock rows 1 and 2, oracle lists) keep weight 1 while they are at most a quarter of the
   cells, else each takes (real / 3) / anchors. Floors count cells unweighted. Gold is where Astra and Opus agree, for
   anchors too.
8. Pairwise: a side without a block skips the pair. The stock block's checks are rows 1 and 2 (16 checks), each row
   normalized on its own. Ties leave the win rates; the stock block's 20% counts ties as not won. Length control is a
   logistic fit on the checks word-count difference per 10 words, read at zero.
9. Arm guess: 30 seeded block lists across models, checks only, three classes (none, lens, skill).
10. Recognition probe: one Opus call per calibration unit with the repository's owner/name, the merge date and plan.md,
    no reasoning effort; the reply (at most 8 changes) is labelled as a list by Astra with the brief against the
    primary items. Recognized: any primary item credited; an unlabelled cell with no credit reads unread.
11. Mechanical reads (frozen in score.ts's header): a list names a file by its path or base name as a whole token, and
    a function by its last name part as a whole identifier of at least 3 characters. Bug-site recall counts a primary B
    item when a blamed file or function is named. The grep baseline takes the 15 base-repo functions (frozen regexes over
    non-test source files outside vendored and build folders) sharing the most distinct name words with plan.md.
12. Check type: the earliest of eval, CI, end-to-end and unit keywords in the check's own words; none is other.
13. Secondaries each take their own maximum matching. Precision is the matching over every B, T and C item over the
    checks. The code-change share is over credited primary items. A no-block reply scores 0 on every block score whose
    item set is not empty. The foreseeable stratum is primary items no auditor rated no, with at least one rating.
14. Strata: change-size terciles by added source lines then id; merge month from merged_at; strict is first exposure on
    or after 2026-08-01; recognized comes from er probe tally.
15. Contrasts pair by unit on the mean over scored passes; secondary contrasts (lens minus none, skill minus lens,
    candidate and eng phase minus pre-cut) read their raw p in place of Holm. "Framing carries part" follows the words:
    lens minus none helps and skill minus lens's upper bound is not under +0.05.
16. Admission's 95% lower bound is a seeded bootstrap of unit means. The parse rate is blocks over Opus none sessions
    that ended block or no-block. Smoke rule 1 counts a missing session as not parsed; the enforced re-smoke must pass
    both parse and exposure at 5 of 6. The interim stop reads the first 24 Opus sessions of the arm in rows order that
    ended block or no-block. The stage 2 gold re-check gates on kappa only.
17. Leak: exposed when the earliest exposure is on or before the cutoff's last day. particle-1 publishes no cutoff, and
    its release date is a stated limit, not applied as a cutoff (cutoffs.json leaves it for the run thread to record).
18. Projection: control rate and ICC(1) from each model's stage 1 none reviews; item mix "1-2" up to a mean of 2.25
    primary items, else "2-4"; the MDD runs power.py's own mdd() through uv at alpha 0.05/3. Costs use measured mean
    spend per (model, arm), else Opus's times section 14's ratio, else the planning figure. Stage 2 runs must fit
    $1,500 less crew, authoring and judge overruns, and stage 3 its $280; cuts go in section 14's order.
19. Dry run: items and caps come from table rows under an "Item caps" heading in the approvals file; items whose id
    names labels, check, judge, pairwise, generic or probe open their lease through the metered judge client.
