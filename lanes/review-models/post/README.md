# Review-models pilot: after the review sessions

The steps between the pilot's last review session and the readout the Captain gets before any counted unit, for
wiki/plans/2026-11-24-geva-590-review-models-prereg (Pilots, Judge check, sections 4 to 8 and 11) as pre-run changes 1,
2, 5, 6 and 9 amend it. The scoring modules in ../score/ build every request and read every reply; this folder loads the
finished pilot, sends the paid calls in metered batches and writes the readout.

- pilot.ts: the finished pilot as reviews (five cells by the key's pilot units at pass 1), from the review-units out dir
  and the post key.
- key.ts: the post key, built from the supply's draw, gate records and full clones. It names fixes and BICs, so it is an
  answer key and stays outside the repository.
- audit.ts: N's read audit (no gstack file and no drive path in any session) and the models that answered in a session.
- send.ts: the three paid batches (the Carbon judge, the judge check's labels and the contamination second read), each
  one lease on its ledger item through the cso lane's metered transport. Under change 9 (R126) no people label: Grok 4.7
  labels each review the check takes, with Kimi K3.1 Pro where Grok can't.
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

label-send sends one Grok 4.7 call (x-ai/grok-4.7 on OpenRouter, pinned to amazon-bedrock, at default effort and the
proxy's output cap) per bug-unit review the check takes that has findings, in a shuffle with seed 1872089902 over the
reviews sorted by arm and unit, so the arms interleave. Each call carries the judge's own input for the review (the
bug's evidence, the fix diff and the numbered, scrubbed findings) and change 6's question, and nothing about the arm,
the models or Carbon's rulings. Every reply goes to $P/labels/pilot/replies.jsonl before the next send, so a stopped
batch resumes from it. The labels land in $P/labels/final.json once every review has one, each row naming its labeller
and the reason. Until final.json exists, the readout prints "Judge check: waiting on labels" for every arm and fails
none on it. desk-package and labels-import, the retired person-label path, refuse with E_RM_POST_DESK_RETIRED.

The readout also writes $P/labels/check-rows.jsonl, the pilot's rows for the kappa gate on 100 labels, which the
validation batch's rows join before the gate is read.

### The validation batch

The post key lists the draw's validation units beside the pilot's (rebuild a key made before they were added with
rm-post key; a key without them refuses --batch validation). With V the validation batch's review-units out dir,
contamination, second-read-send, judge-send and label-send take --batch validation and read the validation units from
V instead of the pilot's from R; a cell the batch never ran is a gap and is never labelled. Use the same post dir:

    gstack-evals rm-post contamination --run $V --key $S/post-key.json --post $P --batch validation --journal <its proxy journal>
    gstack-evals rm-post judge-send --run $V --key $S/post-key.json --post $P --batch validation --run-id <judge run id> --item <judge item>
    gstack-evals rm-post label-send --run $V --key $S/post-key.json --post $P --batch validation --run-id <labels run id> --item <labels item>
    gstack-evals rm-post readout --run $R --key $S/post-key.json --post $P --history <stage 1 csv> --md <readout.md> --validation-run $V

The validation replies sit in $P/labels/validation/ and its labels land in $P/labels/final-validation.json, so the
pilot's final.json is never overwritten. The readout reads the pilot and refuses --batch validation; given
--validation-run and final-validation.json, it adds the R78 gate on both batches' labels together (change 9 item 5).

## Readings the plan leaves open

- A review whose final session completed with findings, an empty list or no json block is ok; a provider refusal is a
  safety stop; anything else, a cell never run included, is a gap. A cell listed twice in cells.ndjson was rerun, and
  the earlier sessions' metered spend draws on the retry reserve, not on the arm's pilot cap.
- A finding is the voice's when its claim or severity opens with a voice cue ([codex], Codex:, outside voice,
  second-model review, adversarial challenge, structured review or a GPT model name), else native.
- The judge check takes every bug-unit review that parsed and is not contaminated, as send.ts's pilotBatch does; decoys go to the
  false-alarm read. The pilot's judge column passes when every review the check takes is labelled and Carbon makes at
  most 2 errors, an unresolved label counting as one. The readout lists the reviews left out and why.
- A second-read reply that is empty, cut off, refused or unreadable is sent once more; a second such reply leaves the
  search case doubtful, and label-send waits on it. A reply that is not HTTP 200 stops the batch.
- Labels (change 9): one pass, one question per review (change 6): which numbered findings name the bug, none, or
  can't tell, with a one-line reason. A reply naming a finding outside the list, naming one twice or giving no reason
  does not read. A review names the bug when the labeller names any finding. Can't tell reads as not naming; the final
  row marks such a no with cant_tell, and the readout prints the kappa with those read as naming, change 6's second
  reading. A review with no findings names nothing, so it is labelled no with no call.
- An empty, cut-off or unreadable Grok reply is sent once more as attempt 2. A review Grok still can't label goes once
  to Kimi K3.1 Pro (moonshotai/kimi-k3.1-pro, pinned to deepinfra at bf16): a refusal (OpenRouter's content_filter or
  a refusal message), a harness failure (any reply that is not HTTP 200, an error body, or a transport error that is not
  a coded stop) or two attempts that did not read. Kimi gets one call. A review neither labels is can't tell, with
  labeller none and both reasons in fallback. A cap stop or a provider drift from the meter ends the batch with no
  labels written; the rerun resumes from the replies kept.
- The readout counts, per arm, the Kimi fallbacks, the can't tells and the reviews neither model labelled, names each
  review Grok did not label by its opaque label with its labeller and reason, and ends every judge-check line with
  change 9's wording: "judge checked against Grok 4.7, a fourth model family, not against people; Gemini 4 Neon was not
  used because the judge is a Gemini model".
- A gstack cell's part-ran check needs, beside rm-exposure.ts's exposure, every model that answered in the session
  (main agent and subagents) to be the cell's model.
- An arm passes its pilot on part ran, the judge check and supply, the Pilots table's three columns. Pilot spend over
  the cap, cost and wall time are printed beside them.
- The retry reserve is change 2's figure after the validation batch's move (full path $987 cap, Fable leaves $295).
  Change 2 names none for the Sol-only set, so it reads the full path's. Projected reruns are the pilot's rerun rate
  times the drawn counted set's reviews for each set, at the set's mean per-review cap.
- The contamination second read has no budget row of its own, so it runs on the labels item under the labels run id,
  beside the labels ($80 since change 9).
