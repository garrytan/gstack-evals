# Review-models pilot: after the review sessions

The steps between the pilot's last review session and the readout the Captain gets before any counted unit, for
wiki/plans/2026-11-24-geva-590-review-models-prereg (Pilots, Judge check, sections 4 to 8 and 11) as pre-run changes 1
and 2 amend it. The scoring modules in ../score/ build every request and read every reply; this folder loads the
finished pilot, sends the paid calls in metered batches and writes the readout.

- pilot.ts: the finished pilot as reviews (five cells by the key's pilot units at pass 1), from the review-units out dir
  and the post key.
- key.ts: the post key, built from the supply's draw, gate records and full clones. It names fixes and BICs, so it is an
  answer key and stays outside the repository.
- audit.ts: N's read audit (no gstack file and no drive path in any session) and the models that answered in a session.
- send.ts: the three paid batches (the Carbon judge, the labels and adjudication, the contamination second read), each
  one lease on its ledger item through the cso lane's metered transport.
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
    gstack-evals rm-post label-send --run $R --key $S/post-key.json --post $P --run-id <labels run id> --item <labels item>
    gstack-evals rm-post readout --run $R --key $S/post-key.json --post $P --history <review-real-bugs-stage1-per-pass.csv> --md <readout.md>

The readout also writes $P/labels/check-rows.jsonl, the pilot's rows for the kappa gate on 100 labels, which the
validation batch's rows join before the gate is read.

## Readings the plan leaves open

- A review whose final session completed with findings, an empty list or no json block is ok; a provider refusal is a
  safety stop; anything else, a cell never run included, is a gap. A cell listed twice in cells.ndjson was rerun, and
  the earlier sessions' metered spend draws on the retry reserve, not on the arm's pilot cap.
- A finding is the voice's when its claim or severity opens with a voice cue ([codex], Codex:, outside voice,
  second-model review, adversarial challenge, structured review or a GPT model name), else native.
- The judge check takes every bug-unit review that parsed and is not contaminated, as labels.ts does; decoys go to the
  false-alarm read. The pilot's judge column passes when every review the check takes is labelled and Carbon makes at
  most 2 errors, an unresolved label counting as one. The readout lists the reviews left out and why.
- A labeller or second-read reply that is empty, cut off, refused or unreadable is sent once more; a second such reply
  leaves the read missing, so the item stays unlabelled (and fails its arm's judge column) or the search case stays
  doubtful. A reply that is not HTTP 200 stops the batch.
- A gstack cell's part-ran check needs, beside rm-exposure.ts's exposure, every model that answered in the session
  (main agent and subagents) to be the cell's model.
- An arm passes its pilot on part ran, the judge check and supply, the Pilots table's three columns. Pilot spend over
  the cap, cost and wall time are printed beside them.
- The retry reserve is change 2's figure after the validation batch's move (full path $987 cap, Fable leaves $295).
  Change 2 names none for the Sol-only set, so it reads the full path's. Projected reruns are the pilot's rerun rate
  times the drawn counted set's reviews for each set, at the set's mean per-review cap.
- The contamination second read has no budget row of its own, so it runs on the labels item under the labels run id.
