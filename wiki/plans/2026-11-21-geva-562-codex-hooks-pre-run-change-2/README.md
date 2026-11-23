---
id: 2026-11-21-geva-562-codex-hooks-pre-run-change-2
kind: plan
title: "Pre-run change 2 to the Codex hooks eval: the r-pilot cap, part C's open rules and the harness's readings"
summary: "Raises r-pilot's cap to $50 for its VM share, settles part C's effort, spawn-message, code-mode and VM rules for the pilot, and records how the harness reads rules the plan left open."
author: GEVA-562
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-21
status: open
links:
  - 2026-11-19-geva-562-codex-hooks-prereg
  - 2026-11-19-geva-562-codex-hooks-pre-run-change-1
  - GST-3174
---

# Pre-run change 2 to the Codex hooks eval: the r-pilot cap, part C's open rules and the harness's readings

## In short

- r-pilot's cap rises from $45 to $50, so the paid caps come to $1,115. The pilot's host and part VM cost $7.20, and its $9 central left them out.
- Part C keeps section 2's effort rule for the pilot. It reads the first c-on pilot session's spawn message before a second c-on session spends, accepts that code-mode reads over-flag, and holds each counted item's VM share back from the model spend a step may lease.
- The rest records how the harness reads rules the preregistration left open. None of it changes an arm, a primary, a scoring rule, a threshold, a model or a decision-table row.

This change governs where it and the preregistration or change 1 differ. It was written before any paid session, made no model call and spent nothing. The Captain took every decision below on 2026-11-21.

## 1. The r-pilot cap (decision A)

Section 11 sets r-pilot's cap by its cap rule: 1.35 times the $9 central plus six $5 allowances held open, $42.15, rounded up to $45. The rule also adds the VM share, and r-pilot's central pays for its 18 sessions only. Part R runs on L1's host and part VMs, whose reservations go on the item's own ledger: the host for its time to live and one part block come to $7.20.

So the launch guard projects $46.50 for the pilot ($9.30 planned, $30 for the six allowances, $7.20 VM) and refused it at $45. With the VM share the rule gives $49.35, which rounds up to $50. r-pilot's cap is $50. The paid caps come to $1,115; central stays $637. r-main is unchanged: its $99 central already holds its VM share, and its rule still gives $165.

## 2. Part C (decisions B to E)

- **B. Sub-agent effort.** Codex 0.170's spawn_agent accepts a reasoning effort. Section 2's rule stands for the pilot: a session with a request at another effort than its arm's is an infrastructure gap. gstack's review skill at the pin asks for no override. If any c-pilot session shows one, the Captain decides before c-main spends.
- **C. Encrypted spawn messages.** Codex 0.170's tool schema marks spawn_agent's message as encrypted. If real Sol rollouts store it as ciphertext, neither gstack's contract nor section 5.6's independent check can see the adversarial marker. So the first c-on pilot session's spawn message is read before anything else. If it is ciphertext, c-pilot stops before a second paid c-on session, and the Captain hears what Codex stores: the bytes and any field names, and nothing of the model's content.
- **D. Code-mode reads.** In Codex's code mode, nested calls report no exit status, so a `bash -c` or `<` read of the review SKILL.md is flagged with exit null even when it worked. This is accepted: it can only over-flag, a flagged session still scores, and change 1's section 7 still sends more than one flagged pilot session to the Captain.
- **E. VM cost.** Part C's run host is paid outside the ledger, and c-main's and h-main's centrals include it. Each counted step leases what its item has left less the VM share of the sessions still to run: $9.60 for c-main and $3.00 for h-main. Those are the parts of $234 and $201 that the planned session prices don't explain (198 sessions at $1.50, $1.50 and $0.40; 66 at $3.00), and they add up to R113's $12.60. Part C's pilot items pay for sessions only. The pilot's VM time, about an hour, counts in the all-in beside the crew's model use.

## 3. How the harness reads rules the preregistration left open

### Both parts

- Codex 0.170.0 runs beside main's default 0.166.0 and never replaces it: part C at /opt/codex-0.170.0 in the review image, part R at /opt/laneb/codex in B1's task image. Both check the npm tarball's sha256 (67c4bccce8e6c3a2b9ae0e586750e0efac7e0b8cd85e6b4734ad474317d2cc32) and the binary's (880819aab735adcf16f36cd628940b9f1e652a36c01d10a5d32f83cc84902971).
- The per-arm prompt-input digests include the date and the working path, so each run records its own and none is frozen.

### Part R

- **r-none gets no ~/.gstack.** Section 2 gives every arm the seeded ~/.gstack, and section 4.2 gives r-none none. Section 4.2 wins, because r-none is the arm with no gstack.
- **The allowance stays $5.** Sol's reservation is sized from the request's bytes, so it can refuse before real spend reaches $5. The pilot readout counts allowance stops by kind, a refused reservation or spend reaching $5, and a dated change raises the allowance before r-main if the pilot shows reservation stops.
- **"Interval wider than the MDD"** is read as width, the upper bound minus the lower, against the MDD at the observed pairs and disagreement. When no MDD fits, the interval counts as wider.
- **The 90% delivery row** reads FIX-METHOD when the hook's line reached fewer than 90% of the r-on sessions in the primary's pairs.
- **An INCOMPLETE r-none** drops only its own passes contrasts. The decision reads INCOMPLETE only through r-on, r-off or a cap stop.
- **"Steps arrived"** (section 4.5) counts tool results only, so a skill Codex put into the prompt itself doesn't count.
- **Destructive commands.** gstack's ask-level warnings leave no trace in an unattended `codex exec` session, so the table counts gstack's denies only, apart from Codex's own policy rejects.

### Part C

- **The states file.** `codex-hooks c states` writes one file per phase from the rig's readouts, taking each cell's latest attempt. A scored session the contract blocked has a first-stop line and a final line, and any other scored session has a final line. A cap stop is `cap_stop`. An infrastructure failure after its one rerun, a session on another model or Codex version, and a provider safety stop that reached no response are gaps with their reason codes (`SAFETY_STOP` for the last, which keeps its own class in the table). Each finding's file is made relative to the repository the way review-units writes it, and a state whose text is blank scores as finding nothing.
- **Clusters.** Session-level contrasts pair by unit and pass and cluster by pull request over all 32 pull requests in the suite. Section 5's 26 are the pull requests that hold blocking bugs, which the bug-level tests use. A pair with a gap drops alone, not its whole unit.
- **Judging.** Each state is its own packet (section 6, attack 12). The second judge's must-read set is grouped by bug-pass; a state with no counted finding counts as a miss there, gets no packet and stays out of the check set. Key-blind extraction uses its own frozen rule, not the R2 brief, and its "unlabelled" severity never counts as blocking. "Unmatched" means matched to no blocker at all, over-blocking ones included, as in R2.
- **Gaps from judging.** A judge refusing a packet twice makes that session not scored (`E_CH_C_JUDGE_GAP`), which counts toward the more-than-7-of-66 INCOMPLETE rule. Any cap stop makes part C INCOMPLETE.
- **The false-block share** is taken over scored c-on sessions, so 3 false blocks with 7 gaps is 3 of 59.
- **The CUT-CANDIDATE bar** is a fixed 11.5 points.
- **The judge check's anchors.** A near miss sits 40 lines from its bug, with another unit's bug summary as its claim, drawn with the seed plus 2. Anchor pairs drop until anchors are at most 30% of the check set. Gold labels are the items where GPT-6.2 Astra and Gemini 4 Argon agree.
- **Route B** is Gemini 4 Carbon as primary, Opus 5.5 second and Sonnet 5.5 third, and it must pass both checks.
- **Seeds.** 20261119 for the packets and the confirmation draw, plus 1 for the 20% second-read sample, plus 2 for the anchors.
- **The judge item** ($55 central, $80 cap) covers every judging step under one run id.
- **E3's cost per added bug** uses each arm's total cost, and c-none reads the severity map's "none" entry.

## 4. What is still open

- The first c-on pilot session's spawn message (decision C).
- The hand readings, which need real pilot sessions.
- R2's severity-map rules were rebuilt from the after-pin amendment's text, because the code that built the map is not in this repository. The pilot's judge check is the test of that rebuild.

## Disclosures

gstack is Garry Tan's own project.

Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.
