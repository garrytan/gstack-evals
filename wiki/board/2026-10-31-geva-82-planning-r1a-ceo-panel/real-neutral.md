# Real-neutral CEO units for planning R1a

Two units, reported unsealed and apart from the headline, as GST-538 item 1 asks. Each flaw is restated in our own words and names its public source in garrytan/gstack-evals history. Both units are part of the R1a bundle for delivery, but nothing about them is secret: anyone can rebuild them from the recipes below.

A real-neutral flaw is one found after the plan was approved, by something other than a gstack review. R01's plan passed /autoplan, so its flaw is one gstack's review missed, and the stratum leans against gstack.

## R01: the v1 plan schedules its first measured number last

- Plan: wiki/plans/2026-10-28-gsta-3-gstack-evals-v1-plan-v3-2/README.md at 04a0a88 (PR #2), approved at autoplan run autoplan-20261028004737, gate_rev 4.
- Mode: greenfield. Group B, category T1-B3 (risky unknown last). Plan section: Milestones. Deserved severity: High.
- Flaw: the plan dates its first measured answer to "does gstack help" at a pilot report about four weeks out, after the skeleton, the Lane A contract, the adapters and the replay lane are all built, with Lane B outcomes weeks later. The eval exists to steer R&D on a skill pack that changes constantly, so its main unknowns (does any lane show lift, what a session costs, how noisy a cell is) should be tested first with a cheap look on existing tools while the rig is built. As written, weeks of build happen before any number could redirect them.
- Evidence in the unit: the plan's Milestones (M0 to M1c first, the pilot report targeted for 2026-11-25, the Lane B rig no earlier than 2026-12-16); the owner's stated purpose in context/wiki/board/2026-10-28-gsta-6-garry-directions-oct-27.md; the unit order in context/wiki/plans/2026-10-28-gsta-3-v1-build-breakdown.md.
- What changes: a quick-look track runs in the first days on existing scripts, each look with its own small cap, and the rig milestones are re-ordered around what those looks show.
- Found by: Garry Tan, after the gate_rev 4 approval, asked for measured results that week, and the Captain (GSTA-2) started three quick looks outside the plan's schedule. The v3.2 review record has no finding on the schedule.
- Public source: wiki/plans/2026-10-28-gsta-11-review-replay-prereg.md at 2f28f9f (PR #5) line 80; wiki/plans/2026-10-28-gsta-12-laneb-quick-prereg.md at e634bf2 (PR #15) line 92; wiki/plans/2026-10-28-gsta-13-second-opinion-rerun-prereg.md at 66cc954 (PR #21) line 69.
- Recipe: plan.md is the plan file at 04a0a88 with four whole blocks stripped: the front matter, the untitled intro under the title, "What caused this work" and "Review record" (each records gate answers or review results). The review record and gate briefs beside it are not copied. Context, each at 04a0a88 under its repo path: wiki/board/2026-10-28-gsta-6-garry-directions-oct-27.md, wiki/plans/2026-10-28-gsta-3-v1-build-breakdown.md, wiki/research/2026-10-27-gsta-2-harness-and-skill-eval-landscape.md, wiki/research/2026-10-27-gsta-2-openrouter-programming-ranking.md. Left out: the public task sourcing research (it uses a term on the echo list and is only a neighbouring input), amendment A2 and the GSTA-7 research post (they carry another flaw's answer).
- Kept as written: about 35 lines of inline gate references inside core sections, such as "(rec)" choices, because they sit in sections that carry the plan itself.
- Digests: tree sha256 a16754329ed2698a9fe0b82a4402ad3c5637ec19c8b84426e74f8d0f9554cea1; plan.md efe9cbb254cf3812005938c6de41538da03903924f43ee3fb49430b96979545c (107,791 bytes).

## R02: the Lane B quick look assumes agents open skills on their own

- Plan: wiki/plans/2026-10-28-gsta-12-laneb-quick-prereg.md at f3867fd, the head of PR #15 when its cap was approved and the paid run started (refs/pull/15/head). Merged to main as e634bf2.
- Mode: added-capability. Group W, category T1-W4 (contradicted premise). Plan section: Arms. Deserved severity: Critical.
- Flaw: the plan installs gstack, a placebo with the same skill names and listing text, or nothing, and never tells the agent to use a skill. So any gap between gstack and placebo depends on agents opening skill bodies on their own, and nothing in the design makes that happen or stops the run when it doesn't. The repo's own landscape research reports a published eval where a skill went uninvoked in most runs until an explicit instruction lifted results. If agents never open a skill, gstack against placebo is an A/A test.
- Evidence in the unit: the plan's Arms; context/quick/laneb/runner/prompt-wrapper.md, which never mentions skills; context/wiki/research/2026-10-27-gsta-2-harness-and-skill-eval-landscape.md, its row on a skill that was never invoked and its rule to check that a stack's skills loaded.
- What changes: every gstack and placebo trial invokes the relevant skill, or the prompt tells the agent to use its skills, and a pilot check on skill opening gates the paid grid.
- Found by: the paid results run itself. Replicate 1's skill-open reading showed no skill opened in any gstack or placebo trial (0 of 540 over three replicates). PR #15's comments hold no finding on invocation.
- Public source: wiki/board/2026-10-29-gsta-12-laneb-quick-results/README.md at 1b68e63 (PR #33), summary and line 66; wiki/plans/2026-10-28-gsta-12-laneb-quick-2-prereg.md at 257db8e (PR #35), summary and line 19.
- Recipe: plan.md is the prereg at f3867fd, unchanged; the merged copy at e634bf2 adds a section that records post-run events, which this unit avoids. Context, each at f3867fd under its repo path: quick/laneb/README.md, quick/laneb/arms/README.md, quick/laneb/runner/prompt-wrapper.md, wiki/research/2026-10-28-gsta-12-tb2-task-selection.md, wiki/research/2026-10-27-gsta-2-harness-and-skill-eval-landscape.md.
- Digests: tree sha256 e3f11190e662c2ddd95a0ca97541dbc9932c3237f62b0594e8fd76e788eccc45; plan.md f28422e523dff3455c9a7b64d52c964e980ef71ce53795ce2f7714840d530dd0 (16,543 bytes).

## Dropped

- R03, the stacks round 1 plan (wiki/plans/2026-10-30-geva-59-stacks-round-1-plan at 02adc34, PR #82), which judged one idea on pooled recall with no reading split by whether a unit's tests can run in the rig. The auditor failed it on detectability: at the approval commit, nothing in the tree shows the condition that makes the flaw real, and the only file that does is the prereg's check run, which came after approval and would leak the answer. It also shares a root with an eng-lens real flaw already counted. Its source: the geva-76 prereg at af60b9e (PR #95), sections 4, 5 and 12.
- The v1 plan's missing rule for what a sealed release may reveal. Under a strict reading of "found after approval" it fails: GSTA-7's research proposed the fix before gate_rev 2, and v3.2 already says releases are aggregate-only. Its source: amendment A2 section 2 at 04a0a88.

## Where we searched

Every wiki/plans and wiki/board post in gstack-evals, superseded ones included, and the amendments, addenda, corrections and results posts that changed an approved plan; Captain drive reports and handoffs as leads only (a flaw counts only with a public record); and gstack's public docs. No CEO candidate turned up in gstack's design docs, where every change came inside the review loop, before approval. gbrain and most of gbrain-evals were not searched, for budget. No private repo was read.
