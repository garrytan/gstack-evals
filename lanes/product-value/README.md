# Product-value eval

Code for the preregistration in wiki/plans/2026-11-08-geva-403-product-value-prereg/: does a plan review by gstack's
plan-ceo-review (and, one level up, office-hours) anticipate more of what real users raised and what the project built
after launch than the same model with no gstack, or with a one-line founder framing?

Nothing here holds unit text, keys or reviews. Units, keys, transposition sources, judge labels and every review stay
sealed outside the repo; the repo gets counts and digests only.

## Modules

- meter.ts: the metered client. Every direct model call goes through one lease of one ledger line item and an
  in-process metering proxy, with a reply cache keyed by model and request digest.
- cli.ts: `gstack-evals pv <command>`, one module per subcommand.
## Scoring side (branch pv-score-side)

Every command below is keyless except pv judge and pv generic, which spend only through meter.ts on the item they
name. Every output path must sit outside the repository, and every command that takes several input or output paths
refuses two that resolve to the same real file or directory (the four-paths guard owed from #273's merge script).

- prompts/: the judge brief (brief.md), the judge check's audit prompt (audit.md), the pairwise prompt (pairwise.md) and
  the arm-guess probe (probe.md), each pinned by sha256 in judge.ts. The brief and the audit prompt carry section 7's
  anticipation rule and specific-match rule verbatim and three generic match and no-match examples written for this
  post, from no unit.
- pv oracle (oracle.ts): one oracle list per calibration unit, made by a script from its primary items.
- pv packets (packets.ts): label packets with the three stock rows and, in stage 1, the oracle list; a shuffled-key
  packet beside each; judge-check packets; stage 2 gold packets and the plain rendering; pairwise and probe packets. The
  map from random ids to units, arms, passes and items is written to --map, outside the packets directory.
- pv judge (judge.ts): runs a map's packets on one judge item. It writes labels.ndjson, pairwise.ndjson, probe.ndjson
  and calls.ndjson; every record names the judge model and the version the provider reported.
- pv generic (author/generic.ts): section 3's generic screen with the same brief, packets and judge client.
- pv score (score.ts): A per review and every secondary, stock credits, cell and split summaries, the length-adjusted
  difference, the pairwise rates and the probe tally.
- pv readings (rules.ts): stage 1 (twin check, path, admission, STOCK FAIL, judge check, smoke rules, CEILING flags,
  leak exposure, MDD) and stage 2 (contrasts, verdicts, the reading rule, the gold re-check, the interim stop).
- pv dryrun (dryrun.ts): drives every frozen rule of item 4 on both sides of its edge, runs the twin simulations and
  opens and settles one ledger lease per stage 1 item on a temporary ledger. The run side's own checks plug in through
  run-checks.ts (export runSideChecks()); until that module exists the dry run prints one FAIL line for them and exits 1.
- pv taste (taste.ts): section 15's 10 blind pairs for the owner from calibration units, which never count toward any
  score. Each Opus skill list pairs with the Opus none list on its unit (the lowest pass with a block) and, where one
  exists, the Opus lens list; 7 plan and 3 brief pairs come in seeded order (sha256 of the seed, family, unit and
  partner arm), and a seeded coin picks which side the skill list takes. One Opus call per drawn (family, unit) on the
  render item writes the summary from plan.md or brief.md and context/ only, cut at 150 words. pairs.md carries no unit
  id, arm or key; the answers file, which must sit outside the packet folder, maps each pair back.
- cutoffs.json: each model's stated training cutoff with its provider source, read 2026-11-08. Particle publishes none.

### Build-time choices

The preregistration names these rules without their mechanics. Each choice below is the simplest one that serves its
words, and the tests drive each in both directions.

1. Oracle list: one change per primary item in rank order, "Plan for this need before launch: " plus the item's
   statement. A unit with six primary items keeps five changes, so its sixth item is left out.
2. Label packets hold every key item (U, E, R, generic and mentioned), so the secondaries read the same labels, and in
   the brief family the plan's three commitments as items. One packet per (unit, model); a particle-1 packet goes to both
   panel judges.
3. Shuffled keys: a separate packet per label packet holds the same lists and the stock rows (their labels unused)
   against another unit's items. Each project type with two or more units becomes one seeded cycle; lone units cycle
   together; a single lone unit joins a random cycle.
4. The judge check labels every stage 1 list: check packets mirror stage 1's label packets, so a stock row or oracle
   list is one list per (unit, model). "At least 40 distinct lists" counts lists over both classes together.
5. Oracle half cap: the oracle cells used are at most the non-oracle anticipated gold cells, a seeded subset when the cap
   binds. Stage 2 gold: per production judge, 20 anticipated cells (oracle never above real) and not-anticipated cells to
   40, seeded; one gold packet per source check packet with the drawn lists, all three stock rows and the unit's items.
   The plain rendering is a seeded 40 of the family's gold cells, with the answers in a separate file.
6. Resend: the second send appends a fixed note, so it never reads the meter's cache of the first answer, and its
   answer replaces the first whole. The same holds for a Gemini retry.
7. Panel: Gemini reads the whole packet and its vote counts only on split cells. A panel cell missing an Astra or Opus
   vote stays unlabelled.
8. Versions: judge.ts reads the provider's model string from each upstream reply and keeps it beside the meter's cache,
   so a cached call reports the same version.
9. Secondaries: each takes its own maximum matching over its own item set. Precision is the matching over all key items
   divided by the list's changes; the multi-item share counts changes named for two or more primary items.
10. Pairwise: ties are left out of both win rates; the length-controlled rate is a logistic fit on the word-count
    difference (per 10 words) read at zero, with a unit bootstrap interval. The probe shows Astra one list per packet, 30
    seeded stage 2 lists per family across the three models.
11. Admission reads instrument failures first (NO READ, then STOCK FAIL), then the band. The parse rate is blocks over
    completed none replies of all three models on the admitted units.
12. A twin pair without 3 scored passes on each side drops from the twin check and is named.
13. Smoke rule 1 counts a missing session as no parsable block. The interim stop reads the first 32 completed Opus skill
    sessions in rows-file order; a session with no exposure reading counts as not exposed.
14. A contrast reads untested on coverage when either arm's coverage is under 0.90. Exposure is exposed skill sessions
    over skill sessions with an exposure reading.
15. Inspiration split: Capy-inspired transposed units against every other unit. The sign rule's point estimate on each
    side is the mean paired difference.
16. CUT-CANDIDATE is never returned on a primary that reads untested, leak included.
17. Leak: a month-stated cutoff covers the whole month; a unit is leak-exposed when the cutoff's last day falls after its
    plan date.
18. MDD: the power.txt rows at the largest tabled unit count at or below the actual one (48 below that), the larger MDD
    over ICC and control rate, at alpha 0.025.
19. The twin simulations use power.py's unit model at control 0.35 with 1 or 2 items a unit, at ICC 0.5 and 0.843.

## Review run side

review-units --plan product-value (src/trial/review/pv-cli.ts) runs the sessions. This lane reads them:

- pv parse <reply.txt | transcript.ndjson> prints the strict or lenient parse, the normalized list and its counts.
- pv exposure --session <dir> --skill plan-ceo-review|office-hours [--brief <brief.md>] prints one session's detector checks.
- pv rows --run <dir> [--run <dir> ...] --out <rows.jsonl> writes one row per planned session. The out file must sit outside the repo.

### Build-time choices

The prereg leaves these mechanics open. Each one is tested in both directions under tests/pv/.

1. **Which block.** The strict parse reads the last plan-changes fence in the last main-agent text that holds one. The one lenient parse reads that labelled block when there is one, else the last fence of any label. It records what it used: label, commas, array.
2. **Normalizer.** It drops non-string items, then keeps the first five. Per item it keeps link and image text, drops code ticks and emphasis markers, strips leading headings, bullets and numbering such as 1. or (2) until none is left, collapses whitespace and keeps the first 40 words.
3. **End states.** A parsed block wins over how the session ended, so a timeout with a block is block. A completion or a turn cap with no block is no-block. A timeout or E_BACKGROUND_DEADLINE is a harness timeout, allowance_stop an allowance stop, and arm_failure or an unreadable transcript a crash. A provider failure whose text says the prompt or context was too long is a context overflow; any other is an API error. A cap stop has no end state and counts as not run.
4. **Retry.** An infrastructure failure moves the attempt to p<n>-attempt1 and runs once more under its named reason. The cap check counts two attempts per session, and spend sums both.
5. **Web contamination.** Any successful WebSearch or WebFetch result, a subagent's or a server-side one included, makes the session contaminated (E_PV_WEB_CONTAMINATED). It is excluded as missing. A refused call does not count.
6. **Handoff line.** It counts from a successful main-agent Bash call to gstack-ceo-mode-handoff, in any of the three forms the pinned script prints. A line the command itself echoes does not count.
7. **Sections 9 and 10.** They are read from the main agent's text and from what its successful Write, Edit and MultiEdit calls wrote. A subagent's text does not count.
8. **0F proposals.** A proposal is a sighting with an effort (S, M, L or XL) and an impact, from a table with proposal and effort columns, a heading section or a list item. Sightings merge by their lowercased title words. The status is the last one stated, and pending when none is.
9. **expansion_in_block.** A block change carries a proposal when it shares at least half of the title's content words and at least two, or all of a one-word title.
10. **office-hours.** A design doc is a non-empty regular file at projects/<slug>/*-design-*.md in the session's copied state root (host/gstack-state, symlinks skipped). premises_overlap needs at least 3 shared three-word sequences between its Premises section and brief.md. The best doc decides.
11. **Rows.** Exposure is read only for a skill session that ended block or no-block; other rows carry exposed null. A planned session with no journal entry is a missing row with spend null. The opt-in gate arm (plan-ceo-review-gate, smoke rule 3) reads as the skill arm. Rows refuse mixed families or fallback settings and a session planned twice.


## Authoring build-time choices

- Public records pass a cheap screen before any input is written: a record that is mainly a fix, refactor, chore, docs, tests, CI or a dependency bump is not a plan (section 4), and a record whose 42-day window holds nothing the selector ties to the feature drops.
- When the release mining linked to a record doesn't contain its merge commit, collect tries the next releases published by 2026-10-09 and keeps the first that does; if that release's window is still open, the record waits for wave B.
- A key audit item verdict of drop removes that item. The audit counts as failed only when an item needs a fix, an item went unreviewed or the auditor names a missing item; a unit that fails twice drops.
- Transposed units: a summary the in-custody check rejects is rewritten once with the check's notes; T1's files get one copy sweep against the source before the input audit; a traceability leak gets one repair round, and a second leak drops the unit.
- Calibration draw (pv sets calibration): seeded order is the sha256 of the seed, a newline and the unit id, the order mining uses. The quota picks (the first 2 audited public units of mobile, consumer and server-side data or enterprise) take the first draws in that order, and the other public draws follow. Pilot units tested the pipeline before the screen stage existed, so they enter no set. An audited unit carries a classifier label and at least one primary item after the generic screen.
