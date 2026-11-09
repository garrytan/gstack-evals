# Plan-eng-review intentions eval

Code for the preregistration in wiki/plans/2026-11-08-geva-405-eng-review-intentions-prereg/. Nothing here holds unit
text, keys or reviews; they stay sealed outside the repo.

## run side

review-units --plan eng-review (src/trial/review/er-cli.ts) runs the review sessions; src/trial/review/eng-review.ts
holds the lens's arms, prompts, settings, unit trees, pins, order and admission, and src/trial/review/er-run.ts the
session loop. This lane reads and checks them:

- er render --gstack <checkout at 199931029> --plan <plan.md> --out <dir> renders one unit's eng phase opening (render.ts).
- er exposure --session <attempt dir> --arm precut|engphase|candidate prints one session's detector checks (exposure.ts).
- er rows --run <dir> [--run <dir> ...] --out <rows.jsonl> writes one row per planned session (rows.ts). The out file must sit outside the repo.
- stophook.ts is smoke rule 2's Stop hook, on only for a run started with --enforce <arm>.
- run-checks.ts exports runSideChecks(), the run-side cases of section 16 item 4, for the score side's dry run.

**Admission.** An attempt starts only when the settled spend plus the $10 allowance of every attempt in flight plus its
own $10 allowance fits under --spend-cap. A retry is a new attempt admitted the same way, and one that doesn't fit is a
cap stop. The proxy's own cap stop stays. --parallel n (default 1) caps attempts in flight. --spend-cap is the lease the
launch opens on --item, and the command refuses one larger than the item's recorded cap less its committed spend. The
shared run loop admits whole rounds at twice their worst case (src/trial/review/run.ts, the round loop), so this lens has
its own loop on the same rig, driver and runTrial. A resumed run reuses every journaled session whose key still matches,
carries its spend, and carries cap-stopped cells with their spend; it never retries them.

### Build-time choices (run side)

Each one is tested in both directions under tests/er/.

1. **Prompts.** Each part (the arm's prefix, the forced sentence, the common line) sits on its own line, then a blank line and the template.
2. **Rec user.** plan.ts's recommended-option user (a persona, no scripted replies) with one fixed reply, "Go with your recommendation.", to every question.
3. **Mounts.** The work dir is /work itself and holds plan.md and repo/ only. Skill arms add the gstack state root at /work/.gstack-home. none and lens get no state root, no gstack install and no skills. The eng phase arm adds six rendered files read-only under /work/autoplan/.
4. **Harbor.** It doesn't run in review-units, so there is no HARBOR_TELEMETRY to set.
5. **Order.** Units in the order given; each unit's cells sorted by sha256("20261108/unit/arm/model/pass").
6. **Cap.** Settled spend counts this launch's lease only.
7. **Unit trees.** Refused: a top level other than plan.md and repo/, a byte copy of key.json anywhere, and a repo/ with more than one commit, a parent, a remote, a shallow file, or an unreachable or reflog-only commit. git runs with hooks, fsmonitor and LFS filters off.
8. **Pins.** The command clones https://github.com/garrytan/gstack fresh unless --gstack names a clone, checks each sha, VERSION and both candidate digests there, and checks VERSION, both digests and ~/.claude/skills/plan-coverage/SKILL.md again in the installed trees.
9. **Attempts.** Each attempt runs in its own fresh directory, <session>/a1 and <session>/a2. A retry goes to the head of the queue.
10. **Sinks.** At every session end the state root goes to host/gstack-state and /work/repo/.gstack/plan-coverage to host/plan-coverage, for every arm. Both are copied with the run's records to the receipts sink, which must not exist before the launch.
11. **Stop hook.** An SDK-side Stop hook in the driver reads the transcript so far, plus the hook's last assistant text, and the live state root and plan-coverage folder. It blocks with ER_STOP_MESSAGE, naming the missing outputs, at most twice, then releases. Blocks print per session.
12. **Decisions.** exposure.ts's erDecisions on each skill session's last attempt, stored in the journal: AskUserQuestion calls answered or not, pre-cut's decision ledger, the eng phase's classification tables, the candidate's Decisions list, and whether the test plan artifact was written.
13. **Rows.** Exposure only for a skill session that ended block or no-block. A planned session with no journal line is missing, with the spend stops.json carries or null.
14. **Renderer.** See render.ts's header: the four autoplan parts whole, eng-phase.md in full, the snapshot tool run keyless in a scratch dir, host paths rewritten to /work paths with every identity recomputed, and a plan with only one of the two wrap headings refused.
15. **Detectors.** See exposure.ts's header: only the main agent's own text and what its successful Write, Edit and MultiEdit calls wrote count. The native eng voice counts through its dispatch and terminal result.
