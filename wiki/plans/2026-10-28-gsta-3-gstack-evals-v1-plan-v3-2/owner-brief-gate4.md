**Decision needed:** approve the plan "gstack-evals v1: an outcome-graded eval rig that steers gstack R&D". Reply **rec** to take every recommendation (recommended), or say in words what to change.
8 choices below; rec takes the recommended answer for each. Nothing is built until you answer.

### Before → after

Before (2026-10-27): nothing outside gstack measures whether a gstack skill helps, on which model, at what cost. gstack's in-repo paid tiers check documented behavior on fixed fixtures; none compares against no skill or a placebo, holds tasks out, or runs a cheaper model. Four crews are each about to hand-roll a before/after diet eval.

After v1.0 (target 2026-11-25, change d3 at gate_rev 2):
- Lane A: `gstack-evals skill-eval`, a packaged CLI any repo calls to check that an edited skill lost nothing. It reads gstack's skill eval contract unchanged (`test/fixtures/skill-evals/<skill>/tasks.json`), so /write-skill's diets and gstack's /learn eval move onto it with one added step, committing the lock that preregisters a paid run; /learn is the first outside caller. A keyless example and the schemas ship first.
- The review replay lane and v1's required skill-level experiment: gstack reviewer roles replayed on known historical defects with decoys, model and effort as arms, and required controls, seeded from GSTA-131's panel, with a standing token table any crew can use to price a review policy.
- The Martian /review replication: a preregistered re-measurement of the third-party result on gstack's /review prompt, under a re-pinned non-Sonnet judge.
- A pilot report on what v1.0 builds: the measured prices and variances of Lane A, the replay lane and the Martian replication, the parity SD estimated from public per-task data, and the sizing options for Garry (change d2 at gate_rev 3). Lane B's probes (the harness check, the Opus overhead probe and the tool-use smoke on every rung) need the Lane B rig, so they run in a public-only feasibility step at the start of M2, and that step sets v1.1's dates and caps (changes d4 and d5 at gate_rev 3).

After v1.1 (dated at the M2 feasibility report; earliest counted run February 2027):
- Lane B: outcome-graded tasks with arms none, placebo and gstack@sha. Imported public tasks serve as dev, val and a public ladder track. Promotion decisions and claims rest only on about 210 sealed tasks: PRs merged after 2026-10-17 minted into tasks, seeded-defect reviews, planning, gate and ship scenarios, and incidents (harness-evals as is, the others derived).
- Reports give, per task family and model: gstack's lift over none with a task-clustered interval, its cost difference, a ceiling flag, and a route (keep, cut, harden, fix routing), plus lift per skill per model where attribution arms run. The ladder (Opus 5.5, Haiku 5.5, the top two open-weight families on OpenRouter) adds the share of the gap gstack closes, and a parity claim only when a preregistered non-inferiority test earns it.
- Spend is phased. Garry approves the pilot cap now; later caps come with measured prices.

### Why it matters

- A gstack skill costs about 13K tokens per invocation (the header of gstack's own arm benchmark), and nothing measures whether it earns them. A skill that does nothing on Opus 5.5 should get shorter or get harder tests. Today we cannot tell which.
- Optimizers delete what is not tested: a diet loop without gate tasks removed an approval gate in the Langfuse case. gstack has started dieting: /learn's template halved in v1.91.287.0, and /plan-design-review, /office-hours (73 to 44 KB) and /design-review (116 to 85 KB) shrank in v1.91.289.0, each on gstack's own skill-diet panel. More diets are coming, and nothing shared yet checks that a diet kept its gates.
- Outside trials found skill packs adding cost without correctness (Superpowers matched no-skills at 3.07x tokens in the preregistered SKT trial), and a third party reported gstack's /review prompt scoring 31.6 F1 against 33.2 for a two-sentence baseline. gstack should know where it stands and say so when it loses.
- If gstack lifts a cheap or open-weight model toward Opus 5.5, the factory gets cheaper and the claim is worth making with receipts. If it does not, that steers R&D just as much.

### What caused this work

- Garry asked on 2026-10-27 for a gstack-evals repo built from harness-evals and gbrain-evals, then asked whether it is a good idea; the Captain answered yes, if v1 is narrow.
- GSTA-36 forwarded GSTA-133's interface for a shared skill eval; GBRA-225 and HARN-1 added requirements. Four crews wait on Lane A.
- Garry's directions the same day, relayed by the Captain: the eval is open source and earnest, to steer gstack's AI research and R&D; stacks use current versions; a skill that adds nothing on Opus 5.5 is worth knowing about (harder evals or shorter skills); measure whether gstack lifts low-cost, small or open models to the level of a frontier model such as Opus 5.5, pegged to the most-used open codegen models on OpenRouter; allow claims that gstack brought a cheap model to parity with a frontier model.
- GSTA-4 researched task sources; the Captain adopted its mix. Run 1's reviewers found plan v1 underpowered and its Lane A verdict logic unsafe; v2 fixed both.
- Run 2's first gate (2026-10-28): Garry took the recommendation, accepting seven reviewer changes: a narrow, dated v1; the Martian replication inside the first cap; one required skill-level experiment; four separate budgets; gate removals cleared only by covering tasks; a failed margin check exits 1; the model denylist as default policy. On private repos as sealed sources he ruled that harness-evals may be used and the others may not.
- GSTA-5 mined incidents from the other Captains. GSTA-131 handed over its review replay panel and listed what it needs as common capability. gstack shipped /write-skill with the skill eval contract that Lane A implements.
- Run 2's second gate (2026-10-28): Garry took the recommendation and approved the budget raise, accepting seven more changes (a release budget for sealed sets; freshness against a roster fixed at minting; v1.0 narrowed to Lane A, the replay experiment, the Martian replication and the pilot report; custody stated honestly, with a second principal as an owner action; no interactive Codex tasks in v1; parity sizing that scales with the SD squared; a Harbor spike before the trial module) and raising the review budget to $110 and three rounds. He then widened the sealed-source ruling: build tests from the other repos as well.
- Run 2's third gate (2026-10-28): Garry took the recommendation, accepting four changes: the parity SD estimated now from public per-task data, with the headline restated at the expected SD and the plan's cited Opus prices and the sizing options priced (d2); a scripted miner that grows the /review experiment to at least 40 public cases (d3); and the November pilot report limited to what v1.0 builds, with Lane B's probes moved to a feasibility step at the start of M2 (d4, d5). He kept the Phase 1 shakedown as planned (d1). He then proposed model-aware, modular loading (Amendment A1).

### Big decisions

Garry took the recommendation at all three of run 2's gates, so each recommendation below stands unless he changes it. Each paid phase still needs its cap recorded in the ledger with his words before it spends.
1. Distribution: a bin in this repo, installed from a git tag now, on npm when the repo opens (rec); or an org-drive bundle.
2. Billing: callers' own keys. Each approved cap is split into line items, and one run at a time holds a line item's lease in a machine-local ledger; approvals, leases and settlements are write-once files in an append-only approval record, which on Capy lives in the caller's Captain drive (rec); or one shared proxy and ledger.
3. Lane A: 12 tasks x 4 arms (before, before2, after, none) x 3 trials, about $60 on Opus 5.5; exit 0 means "no loss detected" on at least 5 informative tasks (rec); or 3 arms without the noise floor, about $45.
4. Sonnet: none anywhere, per Garry's ruling; GBRA-225's Sonnet cells become Opus 5.5 and Haiku 5.5 (rec); or Sonnet as a ladder rung.
5. Visibility: decided. Private now, public-safe always, sealed bodies outside the repo.
6. Hosts: Claude Code for every Lane A task and for Lane B; Codex for non-interactive Lane A tasks only in v1, since gstack drives Codex only through `codex exec --json` and no interactive Codex driver exists yet (rec, change d5); Capy threads and OpenClaw next.
7. Stack arm in v1.1 (no home team, decided): Superpowers@current on the cheap rungs, exploratory, about $150 (rec); or pstack@current as a told variant; or none until v2.
8. Ladder: Haiku 5.5 plus the top two verified open-weight families (today DeepSeek V4.1 Flash, GLM 5.3 Flash) in Claude Code, through OpenRouter pinned to each author's endpoint (rec); or N=1 or 3.
9. Parity margin and how many build tasks to mint: a 10-point margin (rec). The count scales with the SD squared (d6 at gate_rev 2). Under the current design (three cheap models, Holm-corrected, 90% power) it is about 95, 214 or 343 build tasks at a per-task SD of 0.2, 0.3 or 0.38. Trial noise alone gives an SD of about 0.23 to 0.33, and a realistic SD is 0.33 to 0.42, so at a 213-task ceiling the expected outcome of the current design is "parity not attempted" (d2 at gate_rev 3). Two levers fit a higher SD under the same ceiling: one preregistered primary cheap model at alpha 0.05, with the others exploratory for parity (213 tasks then cover an SD of 0.35), and 80% power on top of that (0.41). Decision rule (rec): keep the 213 ceiling. M1c estimates the SD from public DeepSWE per-task data at no API cost; at the pilot report Garry picks the design that estimate needs, or decides parity at that size and price is not worth minting for. Phase 2b's measured SD confirms the pick before minting, and above what the picked design covers, parity is preregistered as not attempted while the rest of the matrix runs. Or a ceiling of 380, which roughly doubles the counted-run cost.
10. Null routing: a bounded null (interval rules out a 10-point lift) goes to the cut …

_+ more in the plan (plan-active.md)._

### What we need from you

One decision: approve the plan.

- **rec (recommended):** approve, with the plan changes marked below, taking these recommendations:
  1. The diets Lane A exists to guard already shipped (v1.91.287.0 /learn, v1.91.289.0 plan-design-review, office-hours, design-review) and the Phase 1 shakedown does not audit them: keep the plan as written (a reviewer suggested changing it).
  2. Decision 9 and the budget headline sit at the least likely SD and price corner, so parity not attempted is the expected v1.1 outcome: make the reviewer's change (changes the plan).
  3. Every stage of v1.0's required /review experiment (about 13 public cases, about 7 derived for confirmation) sits under the plan's own 24 to 38 point detection floor: make the reviewer's change (changes the plan).
  4. The November pilot depends on Lane B integrations deferred to December: make the reviewer's change (changes the plan).
  5. v1.0 pilot rows (harness check, overhead probe, review probe, replay harness arms, rig shakeout: $360 of $500) need importers, placebo, OpenRouter route and simulator that only M2 (v1.1, 2026-12-16) builds: make the reviewer's change (changes the plan).
  6. plan changed after ceo cap: unreviewed delta (+114 -77 lines, 05dc4c6e050d -> 39ef6b530a34): accept the unreviewed delta into the approved plan.
  7. plan changed after dx cap: unreviewed delta (+114 -77 lines, 05dc4c6e050d -> 39ef6b530a34): accept the unreviewed delta into the approved plan.
  8. plan changed after eng cap: unreviewed delta (+114 -77 lines, 05dc4c6e050d -> 39ef6b530a34): accept the unreviewed delta into the approved plan.
- **Change something:** say which choice and what you want instead, in words (for example "The diets Lane A exists to guard already shipped…: make the reviewer's change"). A change that alters the plan reopens its review before anything is built.
- **Reject:** nothing is built.

- **do it:** rec at full scope: every recommendation above, the follow-ons the plan names (docs, trains, cleanups) included, carried through to done with no further ask.

Reply: **rec**, or **do it**

### Cost

Cost so far: spent 0.00, worst case 90.00 (cap 110.00, headroom 20.00, 18 host attempt(s) unknown and counted at reservation; 18 reviewer attempt(s)). Taking every recommendation reopens nothing: no further spend.

---

_For the relaying agent, not the person:_ run autoplan-20261028004737, gate_rev=4, rec_hash=8585ef863783; rec resolves to d1a d2b d3b d4b d5b uc1a uc2a uc3a p1b; plan <run-dir>/plan-active.md (sha256 ed4ed9507063). Answer with `gstack-autoplan answer --out <run-dir> --gate-rev 4 --reply rec --rec-hash 8585ef863783 --by agent:<id> --owner-reply "<their exact words>"`, then `gstack-approvals import --autoplan <run-dir> --by <name>`.

<details>
<summary>Agent notes</summary>

Edited 2026-11-09 for public wording; the frozen original is wiki/plans/2026-10-28-gsta-3-gstack-evals-v1-plan-v3-2/owner-brief-gate4.md at commit 09d7a8f.

</details>
