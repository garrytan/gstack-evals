**Decision needed:** approve the plan "gstack-evals CI, evals in CI and end-to-end tests". Reply **rec** to take every recommendation (recommended), or say in words what to change.
5 choices below; rec takes the recommended answer for each. Nothing is built until you answer.

### Before → after

Before (2026-10-28): CI runs typecheck, unit tests and the wiki check, keyless. U1 (thread GSTA-9, PR #3) adds the errors-doc check, a sealed pregate config and owns ci.yml and .gstack/pregate.json. The sealed guard runs only inside /ship. Nothing runs the rig's Docker tests in CI, gates a paid run on rig proof, or merges PRs in trains; the Captain merges by hand.

After:
- Every PR runs gstack-pregate sealed in CI, so sealed or held-out content fails before review (U19a).
- PRs reach main through gstack's merge train (U19): one keyless gate per train of up to 4 READY PRs, a tree check per slot, a /ship receipt per exact head.
- Rig changes run a Docker tier, and every program-funded paid run passes a keyless admission at its ledger lease (U20).
- A nightly job checks gstack-evals against gstack's newest tag and main, and an interface registry protects what callers code against (U21).
- gstack keeps its own CI. The crews' recurring gstack issues map to gstack's free tests, and gstack's /ship is asked to bind a diet's verdict to its tree (U22).
- No model key sits in GitHub. Paid work runs from Capy threads through the program ledger.

### Why it matters

- v3.2's numbers rest on properties that fail silently (egress only to the proxy, honest metering, graders the agent cannot edit). A broken rig still prints numbers, and the first published numbers spend from 11-16.
- Garry asked for a ship gate before main and a queue that tests PRs together; gstack ships both.
- Four crews will code against Lane A's interface, and the crews keep filing the same gstack failures.

### What caused this work

- Garry, 2026-10-28, asked the Captain to plan CI evals and end-to-end tests, to fold in what the other Captains need from gstack, to bring a plain-language /autoplan plan for his approval, and to gate every merge to main on /ship. For merging, he asked the Captain to run its own merge queue that tests queued PRs together so they land one after another, and to merge once every check passes.
- The Captain: align the plan to GSTA-3's build breakdown as new units on U1's CI, map each end-to-end test to its unit, leave A2's rules to v1.1, and add a PR CI step for gstack-pregate sealed, a gap U1's review flagged (gstack-evals#3).
- This run's two CEO and two Eng rounds (Opus 5.5 and gpt-6.1-sol); v2 to v5 apply the findings judged real.

### Big decisions

Three are Garry's. Each paid run still needs its cap in the ledger with his words.

1. gstack's PR CI. Keep v3.2's line: gstack-evals runs no job in gstack's PR CI in v1.0. It reaches gstack through the nightly drift check (U21), a diet-binding request for gstack's /ship (decision 2) and free-test requests (U22) (rec). Or a keyless gstack-evals check on every gstack PR, which needs a read token for this private repo in gstack's secrets, pin bumps and a warning week. Flips when gstack-evals is public and nightly breaks prove too slow; then a SHA-pinned reusable workflow with no token.
2. The diet receipt. gstack's /ship and /write-skill (the gstack Captain's code) ask for it only on a PR that declares a diet or cut, or removes a contract line listed in the skill's committed lock. Generated shared files such as the rendered preamble do not trigger it. The diet lane runs the eval; a NOT_MEASURABLE verdict (write-skill has 2 tasks, under Lane A's floor of 5 informative tasks) records a waiver with its reason code, and an exit 1 still shows as a loss. Advisory until the warning data shows no deadlock (rec). Or a blocking receipt on every edit to a covered skill, which turns each fix into a paid run (about $60 on Opus 5.5) and can never pass for write-skill. Flips if the gstack Captain wants other edits covered once run volume and caller caps are agreed.
3. Rig proof before money. Admission sits at the ledger lease (U4), the one boundary Lane A, the replay lane, direct-API arms and judge calibration all cross. ledger init --item takes an explicit --admission required|warn, recorded with the owner's words in the item's write-once file; a required item's lease refuses with E_RIG_UNPROVEN unless a matching admission record exists; a warn item, such as a caller's own Lane A run, gets a warning, and U2's preregistration check refuses a program preregistration whose item is not required. The record holds the proof set the preregistration names: for arms in src/trial (U11, the agentic arms of U16 and U18, counted runs), a green Docker tier at the run's commit and recipe plus the keyless probes on the machine that spends; for direct-API runs and judge calibration, a green ci.yml at the commit plus the replay lane's fake-upstream tests. Admission is keyless and adds no spend; the run's own calibration, already paid for, is bound into its receipt (rec). Or rig proof for counted runs only, with a weekly paid smoke under a standing $25 a month. Flips if U20 has not merged its first PR by 11-14; the Captain then asks Garry whether U11 and U16 wait or run without it.

Defaults the Captain or the gstack Captain owns, with flip conditions:
- Merge flow: gstack's train, settled by Garry's request for a Captain-managed merge queue that merges on green. Flips to the hand procedure if the dry runs hit a gap gstack cannot close in a week.
- Versions: VERSION and CHANGELOG.md change only in a release PR, as the breakdown says, and trains merge unstamped heads. Flips to a stamp at each slot if the …

_+ more in the plan (plan-active.md)._

### What we need from you

One decision: approve the plan.

- **rec (recommended):** approve the plan as reviewed, taking these recommendations:
  1. Decision 3's guard sits in Lane A's preflight, so it misses the replay-lane runs it names and gates direct API runs on a Docker tier that never exercises them: keep the plan as written (a reviewer suggested changing it).
  2. plan changed after ceo cap: unreviewed delta (+91 -86 lines, b0d92b7c190e -> e22d09b69528): accept the unreviewed delta into the approved plan.
  3. plan changed after ceo cap: unreviewed delta (+82 -108 lines, e22d09b69528 -> 5dfda506bade): accept the unreviewed delta into the approved plan.
  4. plan changed after ceo cap: unreviewed delta (+39 -52 lines, 5dfda506bade -> b73f82db82b7): accept the unreviewed delta into the approved plan.
  5. plan changed after eng cap: unreviewed delta (+39 -52 lines, 5dfda506bade -> b73f82db82b7): accept the unreviewed delta into the approved plan.
- **Change something:** say which choice and what you want instead, in words (for example "Decision 3's guard sits in Lane A's preflight, so it misses…: make the reviewer's change"). A change that alters the plan reopens its review before anything is built.
- **Reject:** nothing is built.

- **do it:** rec at full scope: every recommendation above, the follow-ons the plan names (docs, trains, cleanups) included, carried through to done with no further ask.

Reply: **rec**, or **do it**

### Cost

Cost so far: spent 0.00, worst case 40.00 (cap 40.00, headroom 0.00, 8 host attempt(s) unknown and counted at reservation; 8 reviewer attempt(s)). Taking every recommendation reopens nothing: no further spend.

---

_For the relaying agent, not the person:_ run autoplan-ci-20261028154111, gate_rev=3, rec_hash=f5da0da84c7a; rec resolves to d1a uc1a uc2a uc3a uc4a p1a; plan <run-dir>/plan-active.md (sha256 498ce66b6028). Answer with `gstack-autoplan answer --out <run-dir> --gate-rev 3 --reply rec --rec-hash f5da0da84c7a --by agent:<id> --owner-reply "<their exact words>"`, then `gstack-approvals import --autoplan <run-dir> --by <name>`.

<details>
<summary>Agent notes</summary>

Edited 2026-11-09 for public wording (GST-1060); the frozen original is wiki/plans/2026-10-28-gsta-8-ci-evals-e2e-plan/owner-brief-gate3.md at commit 09d7a8f.

</details>
