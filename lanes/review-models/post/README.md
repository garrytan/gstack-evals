# Review-models pilot: after the review sessions

The steps between the pilot's last review session and the readout the Captain gets before any counted unit, for
wiki/plans/2026-11-24-geva-590-review-models-prereg (Pilots, Judge check, sections 4 to 8 and 11) as pre-run changes 1,
2, 5 and 6 amend it. The scoring modules in ../score/ build every request and read every reply; this folder loads the
finished pilot, sends the paid calls in metered batches and writes the readout.

- pilot.ts: the finished pilot as reviews (five cells by the key's pilot units at pass 1), from the review-units out dir
  and the post key.
- key.ts: the post key, built from the supply's draw, gate records and full clones. It names fixes and BICs, so it is an
  answer key and stays outside the repository.
- audit.ts: N's read audit (no gstack file and no drive path in any session) and the models that answered in a session.
- send.ts: the two paid batches (the Carbon judge and the contamination second read), each one lease on its ledger item
  through the cso lane's metered transport.
- desk.ts and desk/: the judge check's person labels. Engineers label the reviews through the organisation's labelling
  desk (R125): seat A labels every review, seat B a seeded subset, and seat C the subset reviews A and B read
  differently; no model makes a label. desk.ts writes one package per seat in the desk's format (the org drive's
  handoffs/labelling/bg1-dev-judge/ is the model) and reads the files the people's pages download. desk/ holds the page
  template, check_return.py, privacy_check.py and host_pages.sh, copied into every package.
- readout.ts: the per-arm pilot table, the retry reserve, the staged rule and the proceed set, as Markdown that names
  units by opaque label only.
- cli.ts: gstack-evals rm-post.

## Commands, in order

S is the supply folder (the Captain drive's handoffs/GEVA-590/supply/), R the pilot's review-units out dir and P a post
dir outside the repository. Each paid step needs the provider keys set by name, the ledger item's cap recorded by the
Captain and a rig admission record for the item on the machine that spends (docs/rig.md). A paid step that stops reruns
with the same --run-id and pays for nothing twice.

    gstack-evals rm-post key --draw $S/draw.json --p $S/p-gates-2.jsonl --b $S/b-gates-2.jsonl --frame wiki/plans/2026-11-15-geva-538-skill-pack-h2h-prereg/b2-frame.json --sources <full clones> --out $S/post-key.json
    gstack-evals rm-post contamination --run $R --key $S/post-key.json --post $P --journal <the pilot's proxy journal>
    gstack-evals rm-post second-read-send --post $P --run-id <labels run id> --item <labels item>        (only when contamination printed cases)
    gstack-evals rm-post judge-send --run $R --key $S/post-key.json --post $P --run-id <judge run id> --item <judge item>
    gstack-evals rm-post desk-package --run $R --key $S/post-key.json --post $P --desk <labelling root>
    gstack-evals rm-post labels-import --run $R --key $S/post-key.json --post $P --file <A1's file> --file <B1's file>
    gstack-evals rm-post labels-import --run $R --key $S/post-key.json --post $P --file <C1's file> --round third   (only when the first import wrote seat C's package)
    gstack-evals rm-post readout --run $R --key $S/post-key.json --post $P --history <review-real-bugs-stage1-per-pass.csv> --md <readout.md>

The labelling root is the org drive's handoffs/labelling/. The packages are on hold: R125 makes the labellers
engineers, and where they come from and what a seat pays are not settled, so no package names a recruiting source or
a price. desk-package writes three folders there:

- geva590-review-labels-pilot-a/, seat A: one offline page (labeller/check-reviews-A.html) with every review the check
  takes, 3 repeats and 2 attention screens;
- geva590-review-labels-pilot-b/, seat B: one page (check-reviews-B.html) with a subset of 15 of those reviews, 3 per
  arm, plus 2 repeats and the same 2 attention screens. Within each arm the subset is the review screens' opaque ids,
  sorted, shuffled with seed 1872089902 and taken from the front; with fewer arms the 15 spread as evenly as the arms
  allow (5 each over three arms);
- geva590-review-labels-code-task/: the screening item as a stand-alone task of about 10 minutes (code-task.html and
  code-task.md), with its expected answer in answer.md, desk side, so whoever recruits can check a candidate before
  they get a seat. The item is no longer a screen inside any package.

Each seat's folder holds guide.md, message-to-labeller.txt, job.json (seat, screens, minutes, the 48-hour deadline and
`price: null`), items.json (desk only), check_return.py, privacy_check.py with its result in privacy-check.md, and
returns/; seat A's also holds host_pages.sh, which serves every seat of the batch. The key from each screen's opaque id
back to unit and arm, and the subset, stay in $P/labels/people/pilot/key.json, never in a package. labels-import
checks seat A's and seat B's files again, refuses two files from one page or one person on both seats, and reads every
review outside the subset by seat A's file alone. When A and B read every subset review alike, it writes
$P/labels/final.json. When they read some differently, it writes geva590-review-labels-pilot-c/: one page (C) with
those reviews under new screen ids, 1 repeat and 1 attention screen, for an engineer who is neither A1 nor B1. Its
key, with the two codes it excludes, stays in $P/labels/people/pilot/third-key.json. labels-import --round third
checks seat C's file, refuses it if it names A1 or B1, and writes $P/labels/final.json. Until final.json exists, the readout prints "Judge check: waiting on person labels" for every
arm and fails none on it. label-send is retired and refuses with E_RM_POST_RETIRED.

The readout also writes $P/labels/check-rows.jsonl, the pilot's rows for the kappa gate on 100 labels, which the
validation batch's rows join before the gate is read.

### The validation batch

The post key lists the draw's validation units beside the pilot's (rebuild a key made before they were added with
rm-post key; a key without them refuses --batch validation). With V the validation batch's review-units out dir,
contamination, second-read-send, judge-send, desk-package and labels-import take --batch validation and read the
validation units from V instead of the pilot's from R; a cell the batch never ran is a gap and never reaches the
desk. Use the same post dir or a new one:

    gstack-evals rm-post contamination --run $V --key $S/post-key.json --post $P --batch validation --journal <its proxy journal>
    gstack-evals rm-post desk-package --run $V --key $S/post-key.json --post $P --desk <labelling root> --batch validation
    gstack-evals rm-post labels-import --run $V --key $S/post-key.json --post $P --batch validation --file <A1's file> --file <B1's file>
    gstack-evals rm-post labels-import --run $V --key $S/post-key.json --post $P --batch validation --file <C1's file> --round third

The packages are geva590-review-labels-validation-a/ and -b/ (and -c/ when A and B differ), the screen keys sit in
$P/labels/people/validation/ and the labels land in $P/labels/final-validation.json, so the pilot's final.json is never
overwritten. The readout reads the pilot only and refuses --batch validation.

## Readings the plan leaves open

- A review whose final session completed with findings, an empty list or no json block is ok; a provider refusal is a
  safety stop; anything else, a cell never run included, is a gap. A cell listed twice in cells.ndjson was rerun, and
  the earlier sessions' metered spend draws on the retry reserve, not on the arm's pilot cap.
- A finding is the voice's when its claim or severity opens with a voice cue ([codex], Codex:, outside voice,
  second-model review, adversarial challenge, structured review or a GPT model name), else native.
- The judge check takes every bug-unit review that parsed and is not contaminated, as desk.ts's pilotBatch does; decoys go to the
  false-alarm read. The pilot's judge column passes when every review the check takes is labelled and Carbon makes at
  most 2 errors, an unresolved label counting as one. The readout lists the reviews left out and why.
- A second-read reply that is empty, cut off, refused or unreadable is sent once more; a second such reply leaves the
  search case doubtful, and the label package waits on it. A reply that is not HTTP 200 stops the batch.
- Person labels: the question is one per review by default (change 6): which numbered finding names the bug (one or
  more), none, or can't tell, with a required one-line reason. `--shape finding` asks change 5's question once per
  finding instead. A review names the bug for a person when they pick a finding (or answer names for one). Can't tell
  reads as not naming; the final row marks such a no with cant_tell, and the readout prints the kappa with those read
  as naming, change 6's second reading. A review with no findings names nothing, so it is labelled no and not shown.
- Every review outside seat B's subset takes seat A's label. Seat A and seat B read a subset review differently when
  one says it names the bug and the other doesn't. That review goes to seat C, who sees the same screen blind:
  nothing about earlier answers or the other labellers reaches a hire (the desk's rule 4). Each of the three readings
  is names, doesn't or can't tell, and the label is the one at least two share. All three different, or a majority
  of can't tell, leaves the review unresolved; it stays in the check and is read both ways, as change 2 says. No
  model writes a summary for it.
- The subset's final rows keep seat A's and seat B's readings (a_b), and the readout prints their agreement and
  Cohen's kappa beside Carbon's kappa, with can't tell read as not naming.
- Repeats and attention screens never become labels; check_return.py uses them to judge a file's care, and the
  desk accepts a return on its verdict.
- A gstack cell's part-ran check needs, beside rm-exposure.ts's exposure, every model that answered in the session
  (main agent and subagents) to be the cell's model.
- An arm passes its pilot on part ran, the judge check and supply, the Pilots table's three columns. Pilot spend over
  the cap, cost and wall time are printed beside them.
- The retry reserve is change 2's figure after the validation batch's move (full path $987 cap, Fable leaves $295).
  Change 2 names none for the Sol-only set, so it reads the full path's. Projected reruns are the pilot's rerun rate
  times the drawn counted set's reviews for each set, at the set's mean per-review cap.
- The contamination second read has no budget row of its own, so it runs on the labels item under the labels run id,
  beside the people's labels ($650 since change 6).
