**Decision needed:** approve the plan "gstack-evals v1: an outcome-graded eval rig that steers gstack R&D". Reply **rec** to take every recommendation (recommended), or say in words what to change.
7 choices below; rec takes the recommended answer for each. Nothing is built until you answer.

### Before → after

Before (2026-10-27): nothing outside gstack measures whether a gstack skill helps, on which model, at what cost. gstack's in-repo paid tiers check documented behavior on fixed fixtures; none compares against no skill or a placebo, holds tasks out, or runs a cheaper model. Four crews are each about to hand-roll a before/after diet eval.

After v1:
- Lane A: `gstack-evals skill-eval`, a packaged CLI any repo calls to check that an edited skill lost nothing. It reads gstack's skill eval contract unchanged (`test/fixtures/skill-evals/<skill>/tasks.json`), so /write-skill's diets and gstack's /learn eval move onto it without edits; /learn is the first outside caller. A keyless example and the schemas ship first, so callers can write tasks while the paid adapters are built.
- Lane B: outcome-graded tasks with arms none, placebo and gstack@sha. Imported public tasks (DeepSWE, Terminal-Bench 4.0, ReviewBench, Qodo) serve as dev, val and a public ladder track. Promotion decisions and claims rest only on about 190 sealed tasks: PRs merged after 2026-10-17 minted into tasks, seeded-defect reviews, authored planning, gate and ship scenarios, and real incidents from harness-evals.
- A review replay lane: gstack reviewer roles replayed on known historical defects with decoys, model and effort as arms, and required controls, seeded from GSTA-131's panel. It is v1's required skill-level experiment and keeps a standing token table any crew can use to price a review policy.
- Reports give, per task family and model: gstack's lift over none with a task-clustered interval, its cost difference, a ceiling flag, and a route (keep, cut, harden, fix routing). The ladder (Opus 5.5, Haiku 5.5, the top two open-weight families on OpenRouter) adds the share of the gap gstack closes, and a parity claim only when a preregistered non-inferiority test earns it.
- Spend is phased. Garry approves a small pilot cap now; later caps come with measured prices.

### Why it matters

- A gstack skill costs about 13K tokens per invocation (the header of gstack's own arm benchmark), and nothing measures whether it earns them. A skill that does nothing on Opus 5.5 should get shorter or get harder tests. Today we cannot tell which.
- Optimizers delete what is not tested: a diet loop without gate tasks removed an approval gate in the Langfuse case, and gstack's largest skills (design-review 116 KB, office-hours 73 KB) are about to be dieted.
- Outside trials found skill packs adding cost without correctness (Superpowers matched no-skills at 3.07x tokens in the preregistered SKT trial), and a third party reported gstack's /review prompt scoring 31.6 F1 against 33.2 for a two-sentence baseline. gstack should know where it stands and say so when it loses.
- If gstack lifts a cheap or open-weight model toward Opus 5.5, the factory gets cheaper and the claim is worth making with receipts. If it does not, that steers R&D just as much.

### What caused this work

- Garry asked on 2026-10-27 for a gstack-evals repo built from harness-evals and gbrain-evals, then asked whether it is a good idea; the Captain answered yes, if v1 is narrow.
- GSTA-36 forwarded GSTA-133's interface for a shared skill eval; GBRA-225 and HARN-1 added requirements. Four crews wait on Lane A.
- Garry's directions the same day, relayed by the Captain: the eval is open source and earnest, to steer gstack's AI research and R&D; stacks use current versions; a skill that adds nothing on Opus 5.5 is worth knowing about (harder evals or shorter skills); measure whether gstack lifts low-cost, small or open models to the level of a frontier model such as Opus 5.5, pegged to the most-used open codegen models on OpenRouter; allow claims that gstack brought a cheap model to parity with a frontier model.
- GSTA-4 researched task sources; the Captain adopted its mix. Run 1's reviewers found plan v1 underpowered and its Lane A verdict logic unsafe; v2 fixed both.
- Run 2's first gate (2026-10-28): Garry took the recommendation, accepting seven reviewer changes: a narrow, dated v1; the Martian replication inside the first cap; one required skill-level experiment; four separate budgets; gate removals cleared only by covering tasks; a failed margin check exits 1; the model denylist as default policy. On private repos as sealed sources he ruled that harness-evals may be used and the others may not.
- GSTA-5 mined incidents from the other Captains. GSTA-131 handed over its review replay panel and listed what it needs as common capability. gstack shipped /write-skill with the skill eval contract that Lane A implements.

### Big decisions

Garry took the recommendation at run 2's first gate, so each recommendation below stands unless he changes it at the next gate. Each paid phase still needs its cap entered in the ledger with his approval before it spends.
1. Distribution: a bin in this repo, installed from a git tag now, on npm when the repo opens (rec); or an org-drive bundle.
2. Billing: callers' own keys and their own per-repo ledger, metered by the proxy the CLI starts (rec); or one shared proxy and ledger.
3. Lane A: 12 tasks x 4 arms (before, before2, after, none) x 3 trials, about $60 on Opus 5.5; exit 0 means "no loss detected" on at least 5 informative tasks (rec); or 3 arms without the noise floor, about $45.
4. Sonnet: none anywhere, per Garry's ruling; GBRA-225's Sonnet cells become Opus 5.5 and Haiku 5.5 (rec); or Sonnet as a ladder rung.
5. Visibility: decided. Private now, public-safe always, sealed bodies outside the repo.
6. Hosts: Claude Code and Codex for Lane A, Claude Code for Lane B; Capy threads and OpenClaw next (rec).
7. Stack arm in v1 (no home team, decided): Superpowers@current on the cheap rungs, exploratory, about $150, since it invokes skills on its own and lets us replicate the SKT null (rec); or pstack@current as a told variant (prompts open with /poteto-mode); or none until v2.
8. Ladder: Haiku 5.5 plus the top two verified open-weight families (today DeepSeek V4.1 Flash, GLM 5.3 Flash) in Claude Code, through OpenRouter pinned to each author's endpoint (rec); or N=1 or 3.
9. Parity margin, which sets how many sealed tasks to mint: 10 points (rec), minted as a first batch of 100 build tasks and raised to about 165 only if the pilot's measured spread needs it, with approval (the recount is under "Lane B: tasks"); 7.5 points, about 200 to 300; 5 points, about 450 and roughly three times the counted-run cost.
10. Null routing: a bounded null (interval rules out a 10-point lift) goes to the cut track; ceiling or a wide interval goes to harder tasks; an unopened skill goes to a routing fix; no lift at higher cost goes to shortening through Lane A (rec).
11. First cap: $500 for the pilot, now including a 28-PR Martian /review replication paid for by dropping the Opus SWE-bench Verified cells (rec, change d3); or $300 (Lane A, the harness check, the replication and the review replay pilot only). Later caps come after the pilot with measured prices; the curve is under "Phases and budget".
12. Task mix: GSTA-4's, with /qa moved to v1.1 (it needs a browser in the sandbox) and minted sealed tasks raised from 40 to 60 to about 100 for the margin, plus incidents from harness-evals and ported public bugs (rec); or GSTA-4's mix unchanged.
13. Private sealed sources: decided. Garry, 2026-10-28, ruled that harness-evals may be used and the others may not. harness-evals is the only private repo that supplies sealed tasks. The other private repos are out, and so are two Captain sessions about those repos …

_+ more in the plan (plan-active.md)._

### What we need from you

One decision: approve the plan.

- **rec (recommended):** approve, with the plan changes marked below, taking these recommendations:
  1. Single-use sealed sets give v1 one confirmatory reading of one gstack sha while gstack ships several releases a day; no reuse design was considered: make the reviewer's change (changes the plan).
  2. Freshness rule against a roster re-read at every preregistration lets one model release between M2 minting and M3 preregistration void most build-fix tasks: make the reviewer's change (changes the plan).
  3. v3 makes v1 larger (new replay lane, incidents family, trial module, simulator, network, proxy and ledger rewrites, keyless gstack checks) while M0 gets 2 days and M2 9 days including minting and sealing: make the reviewer's change (changes the plan).
  4. Under one GitHub identity any thread can push a workflow that reads the sealed runner secret or read its logs, and a Capy project is not an access boundary, so neither named separator separates agents: make the reviewer's change (changes the plan).
  5. Codex interactive driver cites a gstack precedent that does not exist: gstack drives Codex only via `codex exec --json` (codex-session-runner.ts:489, codex-host-runner.ts:62), yet Phase 1's shakedown runs the office-hours diet in Codex: make the reviewer's change (changes the plan).
  6. Parity recount scales task count linearly with SD; n scales with SD squared, so SD 0.4 needs about 380 build-fix tasks, not 165: make the reviewer's change (changes the plan).
  7. src/trial and Harbor both own isolation in Lane B, and Harbor's fit is verified in M2 after M1b builds the module: make the reviewer's change (changes the plan).
- **Change something:** say which choice and what you want instead, in words (for example "Single-use sealed sets give v1 one confirmatory reading of…: keep the plan as written (a reviewer suggested changing it)"). A change that alters the plan reopens its review before anything is built.
- **Reject:** nothing is built.

- **do it:** rec at full scope: every recommendation above, the follow-ons the plan names (docs, trains, cleanups) included, carried through to done with no further ask.

Reply: **rec**, or **do it**

### Cost

Cost so far: spent 0.00, worst case 60.00 (cap 80.00, headroom 20.00, 12 host attempt(s) unknown and counted at reservation; 12 reviewer attempt(s)). Taking every recommendation reopens up to ceo, dx, eng: at most +30.00 more.

---

_For the relaying agent, not the person:_ run autoplan-20261028004737, gate_rev=2, rec_hash=09b2e1711f58; rec resolves to d1b d2b d3b d4b d5b d6b d7b p1b; plan <run-dir>/plan-active.md (sha256 495eb74e8730). Answer with `gstack-autoplan answer --out <run-dir> --gate-rev 2 --reply rec --rec-hash 09b2e1711f58 --by agent:<id> --owner-reply "<their exact words>"`, then `gstack-approvals import --autoplan <run-dir> --by <name>`.

<details>
<summary>Agent notes</summary>

Edited 2026-11-09 for public wording (GST-1060); the frozen original is wiki/plans/2026-10-28-gsta-3-gstack-evals-v1-plan-v3-2/owner-brief-gate2.md at commit 09d7a8f.

</details>
