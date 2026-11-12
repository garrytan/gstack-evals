# Office-hours founder eval: packets, judges, detectors and scores

This folder turns finished sessions into scores for the office-hours founder eval (the prereg that `frozen.ts` names as
`PREREG`, sections 5 to 8). It makes no model call of its
own: every judge call goes through an injected `Caller`, the product-value eval's metered judge client
(`lanes/product-value/judge.ts` `openJudge`), which holds the ledger lease and the reply cache.

## Modules

- `packets.ts` builds the blind packets a judge reads and the map from their random ids back to sessions and anchors.
  A packet holds one unit's four key items and normalized blocks rendered with `parse.ts` `renderBlock`, each with its
  uncut first move for the multi-target label. Roles: `label` (one unit, model and pass across arms), `shuffled` (the
  same blocks against a deranged key), `reference`, `pitch`, `anchor` (stage 1 oracle and near-miss blocks),
  `check` (the judge check's audit pass) and `gold` (stage 2's inserted gold cells). It also holds the gold cells, the
  gold floor and the stage 2 gold draw. `writePackets` refuses a map path inside the packets folder.
- `oracle.ts` writes the oracle block and the three near-miss anchors from `key.json`, each only where its sentence fits
  in 40 words.
- `judge.ts` holds the routing, the resend and tie-break rules, and `labeller()`, which implements `types.ts`
  `Labeller` on the same brief so authoring labels the way production does. The brief and the audit prompt live in
  `prompts/` and are pinned by sha256.
- `exposure.ts` is section 5's frozen detector (x1, x2, x3) and its secondaries (load, design doc, forcing questions on
  the stage route), built from the pinned gstack's office-hours files, whose sha256s it records.
- `counters.ts` counts questions and pushes and finds the first reply that recommends what to build or sell.
- `score.ts` joins session rows, the production judge's labels, the packet maps and each unit's key, meta and sheet into
  `ScoredSession` rows. It also gives the stock credits, the reference's credit rates per item (the AN-2 print), W_pitch
  per arm (the AN-1 print), the constructed-only filter for primary numbers and the real stratum's readout.
- `seams.ts` exports this area's dry-run seams; `fixtures.ts` holds the invented units, rows, transcripts and the stub
  judge the seams and tests use.

A run uses them in this order: the run side fills each `SessionRow` with `exposure()` and `counters()`; stage 1's
`buildLabelPackets` and `buildCheckPackets` go to `judgePackets`; `goldCells` and `goldFloor` feed the judge check;
stage 2's `buildLabelPackets` takes the check's map, packets and labels for its gold; `scoreSessions` and
`stockCredits` feed the readings.

## Build-time choices

1. A label packet holds one (stage, unit, model, pass). Stage 1's smoke office-hours and lens sessions are pass 1, so
   they share pass 1's packet with the none session on that unit and model.
2. Reference, pitch and anchor blocks each go in packets of their own, so label packets keep their composition. Every
   packet, shuffled ones included, carries the three stock rows. Stock credits are read only from true-key label
   packets, so reference, pitch, anchor, shuffled and gold packets never add to a stock count.
3. A packet whose sessions all ended without a block is not built, so its stock rows are not judged for that pass.
4. The shuffled-key derangement runs once per stage and within each stratum, grouped by project type, with
   `lanes/product-value/stats.ts` `derangeByGroup`. A stratum with fewer than two units gets no shuffled packets, and its
   W_shuffled is null. Stage 1 gets shuffled packets too, though no rule reads them.
5. Stage 1 has one anchor packet per (calibration unit, model) that has stage 1 sessions on the unit, judged by that
   model's production judge. The judge check scores a production judge from its own production labels, so the production
   judges must label the anchors too.
6. The check pass is stage 1's true-key packets (label, reference and anchor) again, under new ids and a new order, with
   the audit prompt, for Astra and Opus at max effort. Stock row 3 sits there as an ordinary block; rows 1 and 2 and the
   oracle and near-miss blocks are the anchors, and the map records which block is which.
7. Gold cells are every customer and wedge cell, primary or not, that Astra and Opus both labelled and agree on.
8. The gold floor counts oracle credited cells only up to the number of other credited cells, which keeps oracle cells at
   most half the credited gold cells. Distinct blocks are counted over the cells that count; which oracle cells count
   follows a fixed sorted order. `goldFloor` reports the counts and whether the floor is met; the readings area owns the
   pass rules.
9. Stage 2 draws 20 credited gold cells per production judge (oracle cells no more than the other credited cells drawn)
   and fills to 40 with not-credited cells. It draws fewer when gold runs short. Each gold packet carries its source
   check packet's key items, the drawn blocks and the three stock rows, under the brief, so it looks like a label packet.
10. The oracle and near-miss sentences use each key item as written, trimmed, with trailing full stops dropped. The
    40-word test counts words with `parse.ts` `words`. A near-miss block has an empty next action, no other moves and
    no doubt, because its fixed labels cover only the customer and wedge cells.
11. A resend's answer replaces the first answer. Two entries for one block that disagree on a cell read that cell as
    missing. The audit pass records the quoted words behind each credit but never requires them.
12. The panel works cell by cell: both first votes agreeing give the label, a split takes Gemini's vote, and a missing
    first vote leaves the cell null. Gemini's record holds only the split cells. The resend note is the product-value
    eval's fixed note.
13. `labeller()` uses the brief at the effort the caller asks for and keeps the caller's block order and ids.
14. Exposure reads every main-agent text up to the opening of the last fence labelled first-move, or of the last fence
    holding a "first_move" key. A forcing question counts only on a line with a question mark, by its words, never its
    Q number, since the skill numbers its prose questions per session. PREMISES: needs at least two numbered lines right
    after it. APPROACH A:, APPROACH B: and RECOMMENDATION: must be in capitals, as the skill prints them. The load check
    counts only the Read tool. A unit with no recorded founder stage has no route, so forcing_routed reads 0.
15. Questions and pushes leave out the first-move block. A push is a question sharing at least two content words with
    the last question of the reply before; each reply counts once. The rule does not test the founder's answer for
    vagueness: repeating the subject is the push.
16. A reply recommends what to build or sell when it holds a parsable first-move block, or a sentence that is not a
    question with a recommending phrase, an action word and no deferring phrase. `first_recommendation_reply` is the
    number of founder turns before that reply, and the order share counts the key facts revealed in those turns.
17. Any unlabelled customer, wedge or multi-target cell leaves W null, including a cell on an item that is not primary.
    This is the literal reading of section 7's list of cells that can change W. W_shuffled uses the same rule with the
    partner unit's primary items.
18. W_customer and W_wedge read one item where it is primary, W_both both items where both are primary, and multi-target
    voids each of them as it voids W.
19. C1: a no-block or arm-stop session scores 0 on every label-based score, W_shuffled, W_alt and R included (R stays null
    on a no-pivot unit), and keeps its E from the log. A missing, contaminated or gstack-read session scores null
    everywhere, E included. E_demand is null on a unit with no key fact of kind demand or payment.
20. The reference has no simulator, so its E, E_demand, E_all and order share are null.
21. The real readout drops a (model, unit) in every arm and kind when any of that model's sessions on the unit named its
    source.
22. The AN-2 credit rate per item is the unit mean of W_customer and of W_wedge on reference sessions, constructed units
    only. W_pitch is the unit mean of W on pitch sessions per model and arm, constructed units only.
