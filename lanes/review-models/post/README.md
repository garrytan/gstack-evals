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
- desk.ts and desk/: the judge check's person labels. Two people label the reviews through the organisation's labelling
  desk; no model makes a label. desk.ts writes the package in the desk's format (the org drive's
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
    gstack-evals rm-post labels-import --run $R --key $S/post-key.json --post $P --file <F1's file> --file <F2's file>
    gstack-evals rm-post labels-import --run $R --key $S/post-key.json --post $P --file <F1's file> --file <F2's file> --round adjudication   (only when the first import wrote a second part)
    gstack-evals rm-post readout --run $R --key $S/post-key.json --post $P --history <review-real-bugs-stage1-per-pass.csv> --md <readout.md>

The labelling root is the org drive's handoffs/labelling/. desk-package writes geva590-review-labels-pilot/ there: two
offline pages (labeller/check-reviews-A.html and -B.html, the same screens in two orders with 3 repeats and 3 attention
screens, one of them a screening screen that needs real code reading), guide.md, message-to-labeller.txt, bounty.json
(dryRun true, $125 a seat, 2 seats), items.json (desk only), check_return.py, privacy_check.py with its result in
privacy-check.md, host_pages.sh and returns/. The key from each screen's opaque id back to unit and arm stays in
$P/labels/people/pilot/key.json, never in the package. Tell the desk the package is ready; it hosts, hires, sends,
checks each return with check_return.py and puts the files in returns/. labels-import checks both files again. When
the two people read some reviews differently, it writes geva590-review-labels-pilot-adjudication/ beside the first
package for the same two people (no new bounty; the first one covers both parts), and the second import writes
$P/labels/final.json. Until final.json exists, the readout prints "Judge check: waiting on person labels" for every
arm and fails none on it. label-send is retired and refuses with E_RM_POST_RETIRED.

The readout also writes $P/labels/check-rows.jsonl, the pilot's rows for the kappa gate on 100 labels, which the
validation batch's rows join before the gate is read.

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
- Two people read a review differently when one says it names the bug and the other doesn't. The second part shows
  both readings and their one-line reasons side by side, in a random order and unattributed, so the hire-facing text
  never names the other person or earlier answers; each person may still recognise their own. No model writes a
  summary for it. A review still read differently after the second part is unresolved and stays in the check.
- Repeats and attention screens never become labels; check_return.py uses them to judge a file's care, and the
  desk pays on its verdict.
- A gstack cell's part-ran check needs, beside rm-exposure.ts's exposure, every model that answered in the session
  (main agent and subagents) to be the cell's model.
- An arm passes its pilot on part ran, the judge check and supply, the Pilots table's three columns. Pilot spend over
  the cap, cost and wall time are printed beside them.
- The retry reserve is change 2's figure after the validation batch's move (full path $987 cap, Fable leaves $295).
  Change 2 names none for the Sol-only set, so it reads the full path's. Projected reruns are the pilot's rerun rate
  times the drawn counted set's reviews for each set, at the set's mean per-review cap.
- The contamination second read has no budget row of its own, so it runs on the labels item under the labels run id,
  beside the people's labels ($650 since change 6).
