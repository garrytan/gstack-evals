---
id: 2026-11-06-geva-345-ceo-stage-2-amendment
kind: plan
title: "CEO outcome eval, stage 2 amendment: harness fixes, the hook-enforced CEO arm, sizing at the measured ICC and the all-in check"
summary: "Replaces autoplan-ceo with a hook-enforced CEO arm, fixes the harness and Sol's allowance, and sizes stage 2 at 62 changed and 21 held units, Opus at 2 passes, for an Opus MDD of 11 points in $2,000."
author: GEVA-345
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-06
status: open
links:
  - 2026-11-04-geva-285-ceo-outcome-prereg
  - 2026-11-05-geva-289-ceo-rule-guards-amendment
  - 2026-11-05-geva-295-ceo-ladder-amendment
  - 2026-11-05-geva-300-ceo-stop-label-amendment
  - 2026-11-05-geva-324-ceo-pin
  - 2026-11-06-geva-338-ceo-pin-part-2
  - 2026-11-06-geva-341-ceo-stage-1-gate-amendment
  - garrytan/gstack-evals#214
  - garrytan/gstack-evals#242
attachments:
  - b0492d8229d07d324189e6af9bb2e216908943215dc0dd2b78fe0f6e02a21e75  stage2-sizing.py
  - d9edc0e4a5f6f621a79621b06b81fe03571c0000dff7df5b48b00cce90e24c68  stage2-sizing.txt
---

# CEO outcome eval, stage 2 amendment

GEVA-345, Captain GEVA-2. This post amends the CEO outcome preregistration (#214) as its amendments (#217, #222, #225, #242) and pin posts (#235, #241) leave it, for every step after stage 1. The stage 1 gate amendment (#242, section 5) committed in advance to what it covers: the harness fixes, Sol's allowance, the two notes the guard amendment left for stage 2, a full smoke rerun and the order of the remaining steps. The Captain added the hook-enforced CEO arm, sizing at the measured ICC and the all-in check.

Nothing here spends. No model was called and no VM started to write it. Like every post on this eval, it holds counts, categories and sha256s only (#214, section 15). Code lines are at the build commit 715c659 unless marked.

## ELI5

Stage 1 asked whether plain Opus 5.5 already finds the real reason a real plan failed. It found it in half its reviews, so there is room for gstack's CEO review to help, and the eval may go on. But the arm meant to be the headline, gstack's CEO review run inside /autoplan, never actually ran its procedure on Opus in the small test run before stage 1: both Opus sessions skipped the step that picks a review mode, and one wrote its findings in a way our checker missed. So that arm can't be tested as built. This post swaps it for a new arm in which a gstack hook refuses to let the CEO review finish until it has written a ranked list of top risks. It fixes the checker and a money guard that stopped two GPT-6.1 Sol sessions far too early. It then works out how big the comparison can be for the money left. The answer is 62 real plans plus 21 control plans, with Opus reviewing each plan twice, which can detect a gain of about 11 points on Opus. Before any of that is paid for, a small test run must pass in full.

## Before → after

Before: stage 1 read HEADROOM (Opus none 24 of 48 = 0.500), but rule 5 stops stage 2 because autoplan-ceo was exposed in 0 of 2 Opus smoke sessions. The detector misses a handoff call inside a compound command and a findings file written with a Bash heredoc. Sol's $3.52 allowance cut both Sol standalone smoke sessions at about 86k prompt tokens with $0.60 spent. Stage 2 is sized for an ICC of 0.5 at 48 changed units and 2 passes on every model, with planning costs that predate any measurement.

After: stage 2 runs a hook-enforced CEO arm (gstack's /plan-ceo-review gate, pinned at 4743132) beside the standalone arm and the no-gstack arm, on all three models. The detector reads the handoff from its own printed line and findings from the file on disk. Every allowance passes a trip rule that keeps one call's worst case from stopping a session it can't reach. Both gstack arms run as unattended sessions. Stage 2 is 62 changed and 21 held units, 2 passes on Opus and 1 on Sol and particle-1, at measured costs, for $1,992.07 all-in at caps with a $30 crew reserve. A full smoke rerun on the fixed harness gates everything after it, before any comparison unit is authored.

## Why it matters

Stage 1 showed the CEO line can measure something: plain Opus misses the deciding issue half the time. If stage 2 runs an arm that never ran its procedure, a null would say nothing about plan-ceo-review, and the line would spend most of its $2,000 to learn that. An arm whose procedure is enforced by a hook turns that into a fair test of gstack's CEO review on Opus and GPT-6.1 Sol, with an MDD stated before it spends.

## What caused this work

- Stage 1 read HEADROOM on 2026-11-06 (GEVA-340), and autoplan-ceo failed its exposure smoke on all three models. Rule 5 (#214, section 10) makes that FIX-METHOD on the harness and sends it to the Captain.
- #242, section 5 committed the next step: a stage 2 amendment with the harness fixes, then a full smoke rerun that passes the frozen gate with no exception.
- The project owner decided on 2026-11-05 that each eval line's next round brings in its hook-enforced arm, under an amendment. gstack shipped the /plan-ceo-review gate on main at 4743132 (1.96.0.0).
- The Captain's ruling on B2 start rule 6 approves comparison authoring only when the all-in check fits $2,000 with a stated MDD.

## Big decisions

1. **The enforced arm replaces autoplan-ceo in stage 2.** Options: (a) replace the advisory autoplan-ceo arm; (b) run the enforced arm beside it; (c) turn the gate on inside autoplan-ceo. Pick (a). Why: autoplan-ceo never ran its procedure on Opus (0 of 2 sessions called the mode handoff), and the detector fixes can't change that, so its contrast would measure a procedure that didn't happen. Under (b), rule 5 still ties stage 2 to that arm's Opus admission, and a third gstack arm widens each model's Holm family from 2 to 3. Under (c), the gate holds only the final stop until a ranked Findings list exists; it can't make autoplan call its handoff, and one Opus autoplan session already wrote a Findings heading without one. What would flip it: a gstack change that makes /autoplan --ceo-only run its Step 0 handoff, which a later round could test.
2. **The enforced arm's told line is the standalone arm's forced line.** Options: (a) the forced line with the gate on; (b) the plain /plan-ceo-review invocation with the gate on. Pick (a). Why: the forced line ran the procedure in 6 of 6 smoke sessions, and the full smoke gate admits no exception, so the arm must expose reliably. It also makes enforced against standalone differ only in the gate and the pin. What would flip it: the Captain choosing to measure the invocation a user types, with the exposure risk that CEO v2 showed (0 of 16).
3. **Two gstack pins.** Options: (a) the enforced arm at 4743132 and standalone kept at 699a41cb; (b) both at 4743132. Pick (a). Why: arm pins stay frozen, and plan-ceo-review's tree is byte-identical between the two commits (autoplan differs only in DRIVER.md). The cost is that enforced minus standalone, a secondary, also carries 94 commits of other changes. What would flip it: the Captain wanting that secondary clean, at the price of re-pinning a frozen arm.
4. **Sessions the gate can't vouch for.** Options: (a) every completed enforced session keeps its #214 section 6 class whatever its gate report says, and a report other than exit 0 with a fired record sets gate_armed false, so the session reads unexposed; (b) drop a completed session whose report exits 2 (GATE_NOT_ARMED) or 3 (GATE_ERRORED) as a gap. Pick (a). Why: both codes can come from the session itself (a stop the gate never counted as final, a slow repository scan, a long transcript), so (b) would keep only the sessions where the gate fired cleanly and select the arm on a signal it produces, up to the 0.90 coverage floor. Under (a), the 0.80 exposure bar and the per-protocol read handle those sessions. A session that ended on its timeout, turn cap or allowance keeps its class too, because a slow procedure stays the arm's own cost. In the smoke rerun, exit 2 or 3 on any session still fails the gate. What would flip it: nothing within this design; a gate that can't arm through the harness fails the smoke instead.
5. **Sol's allowance.** Options: (a) raise each model's allowance to pass a trip rule; (b) change the proxy's worst-case estimate. Pick (a). Why: the estimate bounds input at one token per request byte, which is the only bound the proxy can prove without a tokenizer, and (b) changes money code every lane shares. What would flip it: a provider token count the proxy could trust before each call.
6. **Shape.** Options at $2,000 with the $30 crew reserve: (A) 1 pass everywhere, 75 changed units; (B) 2 passes on Opus and 1 on Sol and particle-1, 62 changed units; (C) the frozen 2 passes everywhere, 50 changed units. Pick (B). Why: at the measured ICC the pairing removes most of the unit-to-unit spread, so a second pass cuts the remaining noise about as much as doubling units does, and an Opus pass costs about a fifth of a new unit with all its cells. (B) gives an Opus MDD of 0.11, against 0.13 to 0.14 for A and 0.13 for C, and its PASS line shape is one the frozen scorer already reads. Shape E, with 3 Opus passes, reaches 0.10 on Opus but costs Sol and particle-1 2 to 3 points (0.17 to 0.18, against 0.15). What would flip it: the Captain weighting Sol's contrast equally with Opus's, which favors (A) at 0.13 on Sol and particle-1.
7. **Order.** Options: (a) the build, then authoring, one pin post, the smoke and stage 2; (b) the build, a smoke pin post and the smoke, then authoring sized on the smoke's measured costs, then the stage 2 pin post and stage 2. Pick (b). Why: the smoke can stop the line (twelve sessions, no exception), and the enforced arm's cost is unmeasured. (b) costs one more small pin post (about $24) and avoids authoring about $285 of units before the gate that decides whether they run. What would flip it: the Captain preferring one pin post and accepting that risk.
8. **findings_written reads the file.** The on-disk ceo-review.md copy becomes primary, as #235's note 10 set out; the transcript parser stays as a report-only cross-check. This closes the heredoc miss and the multi-line ${...} fail-open with one rule.
9. **Where the scorer changes land.** ceo-rule.ts is a wiki attachment pinned by sha256, so the build PR carries a short scorer post with the replacement ceo-rule.ts.txt and its keyless dry run, as #225 carried the stop-label amendment. That post implements this post's rules and adds none.
10. **Session kind.** Options: (a) GSTACK_SESSION_KIND=unattended for both gstack arms, enforced and standalone; (b) unattended for the enforced arm only; (c) unset for both, as stage 1's smoke ran. Pick (a). Why: no human answers a harness session, and gstack documents unattended for that case: a stop that ends on a question counts as final, so the gate checks it. Unset, gstack-session-kind reads interactive, and an enforced session that writes its block and ends on a closing question never fires the gate. Setting both arms keeps enforced minus standalone free of a session-kind difference. The cost: under unattended, plan-ceo-review picks its recommended option at each decision point instead of asking the rec user, so standalone runs a different path from its stage 1 smoke and re-earns its admission in the smoke rerun, which has no carve-out. No frozen rule stops the change for standalone: stage 1 scored no standalone reading (its only standalone sessions were the smoke); the kind is the driver's existing sessionKind option (driver.ts:150 to 151 and 190 at 715c659), not part of the 699a41cb pin or its tree; and review-sections.md stays the file standalone must read, because only gstack-autoplan loads the runner-profile checklist (plan-ceo-review/sections/manifest.json, the same tree at both pins). none and lens have no gstack and stay unset; the harness sets the kind per run today, so the build makes it per arm (section 3.3 item 3). What would flip it: nothing within this design; if standalone fails the smoke rerun under unattended, the gate stops the line and the question goes to the Captain.

## Implementation plan

### 1. What this post replaces, and what stands

| Frozen text | Where | Replaced by |
|---|---|---|
| The autoplan-ceo arm in stage 2 (`/autoplan --ceo-only`, harness arm gstack-auto) | #214, sections 1, 5 and 11 | the enforced arm (section 4); autoplan-ceo keeps its stage 1 smoke record and doesn't run again |
| Rule 5's last sentence, "If autoplan-ceo fails on Opus, stage 2 doesn't start" | #214, section 10 | "If the enforced arm fails rule 5 on Opus, stage 2 doesn't start", read on the smoke rerun (section 8) |
| The headline, Opus autoplan-ceo against none | #214, section 1 | Opus enforced against none |
| findings_written's transcript definition | #214, section 7; #235, section 1, change 5 | section 3.2 |
| handoff_ceo_only's command grammar (ranHandoff, ceo-exposure.ts:241) | #225; #235, notes 2 and 5 | section 3.1 |
| Session allowances: 1.6M input and 32k output tokens at the model's price, and Sol's --allowance 3.52 | #214, section 3; #241, section 4 | section 5 for the smoke rerun and stage 2 |
| Stage 2 size: 48 changed and 16 held units, 2 passes, and power.txt's MDD rows | #214, sections 4, 11 and 12 | section 6 |
| The projection's judge multiplier "times 3 for the larger packets" and its cut order | #214, section 10, rule 6 | section 7.3 |
| Stage 2's envelope, "$1,410", and each judge item's cap, "$1,410 less stage 2's settled spend" | #214, section 13 | $2,000 less every other all-in line (section 7.3) |
| allin's four input fields: crew_spent, crew_rest, stage1_settled and stage2_envelope | the stop-label amendment's ceo-rule.ts.txt:548 to 552 | the table's lines (sections 3.5 and 7.2) |
| The rerun of "all six smoke items" | #242, section 5 | section 8's six items: the autoplan-ceo items don't rerun, because the arm leaves stage 2, and enforced items take their place; the gate stands in full |
| Standalone's session kind, unset as every arm ran in stage 1 | the arm config at 715c659 (driver.ts:190) | unattended for both gstack arms (Big decision 10, section 3.3) |
| Start rules 5 and 8, and the comparison set's authoring step | #214, section 14; #242, section 5 | section 9 |

Everything else stands: the primary (hit@3, since stage 1 read HEADROOM), the judges and their brief, the labels, the stock rows, packets, coverage, Holm within each model, the verdict words, the under-36 stop, the end-state table, the operator rules (#235, section 5), custody (#214, section 15) and the 10x tier's secondaries in the norem form that stage 1 fixed. Every earlier post stays open.

### 2. Stage 1, as it is

All counts come from the scorer's headroom output (ceo-rule.ts.txt sha256 2222e0cf..., scorer 715c659) and the stage 1 ledger.

**The block.** Leak drops 0, so 16 changed calibration units stay. Opus none hit@3 24 of 48 = 0.500, with 0 gaps, unjudged or incomplete readings, inside the band of 8 to 28. Stock rows hit D on 0 of 16 changed units. Verdict: **HEADROOM**. Sol none and particle-1 none each read 11 of 32 (0.344); they decide nothing. Judges, Sol against Opus on D: n 508, both D 49, Sol only 1, Opus only 5, neither 453; positive agreement 0.942, raw 0.988, PABAK 0.976, kappa 0.936. Measured ICC 0.843 at p0 0.500.

**The 2x and 10x tiers.** hit@3 is the 2x tier and stage 2's primary. On the 10x tier, Opus none reads G_R 0.451 (260 twelfths over 48 readings), inside G_R's band of 0.25 to 0.50, and strict10 0.354, past the tier's 0.20 edge. Opus ranks the deciding issue first in 35% of its reviews, so the strict end of the 10x tier has less room than the ladder planned. The remedy read was keyed on 15 of 16 changed units, but Sol and Opus agreed on rem at 0.571 [0.000, 0.889], under the 0.70 gate, so rem left G_R everywhere for the rest of the design (#222, item 12): stage 2 prints G_R in the norem form, 0.67 h3 plus 0.33 h1, as a secondary. The stock fix scored rem on 0 of 15 keyed units.

**Rule 5 on the smoke.**

| Arm and model | Exposed | Block written | Longest session | Larger session | Rule 5 |
|---|---|---|---|---|---|
| autoplan-ceo, Opus | 0 of 2 | 2 | 48.2 s | $0.30 | untested |
| standalone, Opus | 2 of 2 | 2 | 147.2 s | $0.77 | admitted |
| autoplan-ceo, Sol | 1 of 2 | 2 | 635.8 s | $1.33 | untested |
| standalone, Sol | 2 of 2 | 0 | 436.9 s | $0.60 | untested |
| autoplan-ceo, particle-1 | 0 of 2 | 2 | 210.0 s | $0.15 | untested |
| standalone, particle-1 | 2 of 2 | 2 | 157.6 s | $0.07 | admitted |

**Smoke failures by cause.** `ceo rows --checks` failed 7 of 12 sessions. A session can fail on more than one cause.

| Cause | Sessions |
|---|---|
| autoplan never called gstack-ceo-mode-handoff | 3 (Opus units 1 and 2, particle-1 unit 2) |
| autoplan called the handoff inside a compound command the rule refuses | 1 (Sol unit 1) |
| ceo-review.md holds no Findings heading, on the transcript and on disk | 1 (particle-1 unit 1) |
| ceo-review.md written by a Bash heredoc the parser doesn't read; the disk copy holds the heading | 1 (Opus unit 2, which also never called the handoff) |
| standalone ended in allowance_stop (E_ALLOWANCE, 402) before any block | 2 (Sol units 1 and 2) |

Every session passed journaled, transcript_readable and end_state_determinate, and `logs.copy_out` was empty in all 12. The findings_written disagreement count stands at 1. With section 3's fixes, the Opus autoplan sessions still read unexposed, because neither called the handoff; at most Sol unit 1 changes.

**Spend.** Stage 1 settled $17.60 of $160: the smoke $5.75, the none items $9.06 and the judges $2.79, with no cap stop. The runner host ran 3.11 hours, $0.93 on the crew line. The none items saw 0 allowance stops in 140 sessions.

**One correction.** The headroom line names power.txt's nearest row (p0 0.55, ICC 0.5, MDD 0.18), and the stage 1 record read the true MDD at ICC 0.843 as larger. Under #214's own power model it is smaller: the paired test cancels each unit's difficulty, and a higher ICC leaves less pass-to-pass noise. At the frozen 48 changed units and 2 passes, stage2-sizing.txt reads 0.13 at ICC 0.843.

### 3. The harness fixes

One build PR, gate class (it touches the exposure detectors, a scorer and run admission), merged through /ship before the smoke pin post. Each fix has a test that fails on 715c659 and passes on the build, with the fail-first log kept in the build thread's handoff folder. Fixtures use invented text only; the build thread may read the two smoke commands' shapes under custody, and records only the grammar class each fell in.

#### 3.1 handoff_ceo_only reads the handoff's own line

The handoff (gstack-ceo-mode-handoff at 699a41cb) prints one line, and with --ceo-only that line has a fixed form: "Auto-selected review mode → <MODE> (CEO-only run: Step 0E's rule). Approved decisions: <rows>." The new rule reads a successful main-agent Bash call as running the handoff when all of these hold:

1. its result holds exactly one line of that form, with one of the four modes;
2. its command names gstack-ceo-mode-handoff and --ceo-only as shell words, outside a comment;
3. its command doesn't contain the line's fixed prefix "Auto-selected review mode", so no other part of the command can have printed it.

Any compound form whose output reaches the result (a `cd`, an `export`, `set -e`, `$(...)`, `&&` and `;` chains, a pipe to a filter) reads as run. A call whose output is redirected away reads as not run, as the skill asks the model to send the line. Tests: Sol unit 1's grammar class rebuilt with invented paths reads not run on 715c659 and run on the build; an `echo` of the line with the handoff named in a comment reads not run on both; `--auto` reads not run.

#### 3.2 findings_written reads the file

findings_written holds when a ceo-review.md copy in the session's host/ceo-review/ holds a line the detector's Findings pattern matches (FINDINGS, ceo-exposure.ts:70), as #235's smoke findings check already reads it. The transcript parser still runs and feeds the report-only disagreement count (#235, note 9), and decides nothing. A session with a non-empty `logs.copy_out` reads findings_written false and is named. Tests: a heredoc write of the smoke's grammar class reads false on 715c659 and true on the build; the multi-line ${...} form from #235's note 10 reads true on 715c659 and false on the build; a missing copy reads false.

The Bash write forms are read through the file they leave, not by parsing the command, so a new form can't fail open or closed. These two fixes have no stage 2 consumer once autoplan-ceo leaves stage 2 (section 4.5). They are built because #242 committed them: the results post re-reads stage 1's smoke with them as a descriptive count, and a later round of the autoplan arm needs them.

#### 3.3 The enforced arm in the harness

A new harness arm, gstack-enforced, with the analysis name enforced:

1. **Install.** gstack at 4743132ca027d487fb02bb5f8ce94f2816ff8e7c by its own `./setup`, with the /plan-ceo-review gate on (`ceo_review_gate on` in the arm's gstack config, beside `agent_model host` and `codex_reviews disabled`), so the arm's tree sha256 and session key carry the switch. The /investigate gate stays off.
2. **Hooks.** The Stop and SubagentStop hooks reach the session through the driver's `settingSources` (driver.ts:480), or through the settings JSON that `gstack-skill-gates settings --ceo-review` prints, whichever the armed test shows working. Apart from item 3, nothing else in the arm's environment changes: CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1, WebSearch and WebFetch off, the claude-code-preset system prompt, the rec user and the never-ask registry as in every arm.
3. **Session kind and gate deadline.** GSTACK_SESSION_KIND=unattended for both gstack arms, enforced and standalone, through the driver's sessionKind option (driver.ts:150 to 151 and 190); none and lens stay unset (Big decision 10). Today the kind is run-wide: cli.ts:212 takes one --session-kind flag and run.ts:456 passes it to every arm's session, while ceo-o-cmp-<model>-p runs none, standalone and lens in one run. So the build adds a per-arm sessionKind, read from the arm's config in run.ts and keyed per arm, with a test that none and lens sessions get no GSTACK_SESSION_KIND in their env or session key. The armed test records what `gstack-session-kind` prints inside a harness session, and anything other than unattended fails it. It also runs the 699a41cb pin's own bin/gstack-session-kind in standalone's exact env and fails unless it prints unattended, as lanes/outcome-skills/arms/autoplan.ts:59 to 66 does for the autoplan pin. The enforced arm also sets GSTACK_SKILL_GATE_DEADLINE_MS=20000 (lib/skill-gates.ts:187 at 4743132), frozen with the arm, so host load doesn't turn a slow repository scan into exit 3.
4. **Output file.** GSTACK_CEO_REVIEW_OUTPUT stays unset, as the gate ships, so a block names the last markdown file the run wrote, else the last plan file it read.
5. **Record.** Before the session's work dir is removed, the harness copies `$GSTACK_STATE_ROOT/skill-gates/<session id>/` into the session's host/skill-gates/, byte for byte, with copy failures in `logs.copy_out` as for ceo-review.md. It then runs `gstack-skill-gates report --session <id> --expect armed --json` from the 4743132 checkout against that copy and stores the exit code and JSON in trial.json.
6. **Rows.** `ceo rows` maps the arm to enforced and `ceo rows --checks` gives it four exposure checks: review_sections_read and mode_named (standaloneExposure, ceo-exposure.ts:139), gate_armed (the report exits 0 and its JSON shows at least one fired run for that session id; any other exit, 1 included, or a missing record reads false) and gate_released (the record shows released, not exhausted). Every completed session keeps its #214 section 6 class whatever the report says (section 4.4).

**The armed-and-blocked test** (fail-first, keyless). It runs through the harness's own driver, Agent SDK preset and pinned CLI, in the arm's exact environment (item 3 included), against a local stand-in for the Messages API that plays scripted turns, as gstack's `scripts/skill-gates-smoke.ts` does for the CLI. The test unit is built with unit.ts and the review-units sandbox, with the state root seeded and excluded as a real session has it (unit.ts:117 to 130), and the record is copied out through item 5's real path. Cases:

1. **Blocked, then released.** The session types the forced line, ends a turn without a ranked Findings list (the stop is blocked, `blocked via=stop`), writes `## Findings` with a numbered list through a Bash heredoc into an untracked markdown file, and ends again. The report exits 0, and the row reads exposed. On 715c659, with no gate wiring, the same script reports exit 2 and the row reads unexposed.
2. **Question-ending.** The session writes its block and ends its turn on a closing question. Under unattended the stop counts as final, the gate checks it, the report exits 0 and the row reads exposed. With the kind unset, the same script reports exit 2 and the row reads unexposed.
3. **Exhausted.** Three blocks, then the stop goes through. The report exits 0, gate_released is false, and the row reads unexposed.
4. **Hook error.** A hook forced to error reports exit 3; the session keeps its class and reads unexposed.
5. **Copy failure.** The record copy fails, `logs.copy_out` is set, and the row reads unexposed.
6. **Usage error.** A report that exits 1 reads unexposed.

No model is called and nothing is spent.

#### 3.4 The allowance trip check

projection (section 3.5) prints, for every run item, the prompt size at which one call's worst case trips the item's allowance at the committed spend section 5 names, and refuses PASS when any item trips under 200,000 prompt tokens. Test: Sol at --allowance 3.52 with $0.60 committed trips at 85k and refuses; at section 5's $10.00 it passes.

#### 3.5 The scorer post

The build PR carries a short post with the replacement ceo-rule.ts.txt and its keyless dry run. It implements these changes and adds no rule:

- **Arms.** enforced joins the arms. Stage 2's gstack arms are enforced and standalone; autoplan-ceo stays readable in stage 1 readings and is refused in stage 2's family and cells.
- **Rule 5 on the rerun.** headroom and projection read the smoke rows of the six rerun items (section 8) in place of stage 1's smoke rows, and block stage 2 when enforced fails rule 5 on Opus.
- **Items and allowances.** Six run items, ceo-o-cmp-<model>-p (none and standalone, plus lens on Opus) and ceo-o-cmp-<model>-e (enforced), at section 5's allowances, with the trip check of section 3.4.
- **Size.** The comparison set's changed and held counts come from the sealed suite. The PASS line keeps the frozen shape "held passes 1; 1 pass on sol, particle" and adds the changed and held counts, the cut point in seeded order, so the projection sha256 the Captain records fixes which units stage 2 runs. compare refuses readings whose units aren't exactly the first n changed and h held units of the seeded order.
- **Projection.** Section 7.3's judge multiplier, stage 2 envelope and cut order, and the trip check recomputed from the rerun's measured bytes per token and cache-write mode (section 5).
- **allin.** allin takes the table's lines in place of its four frozen fields: crew spent, crew rest, the crew reserve, stage 1 settled, the smoke rerun caps, authoring and mining, runner hosts, the six stage 2 run caps and the judges. It refuses when a line is missing or the sum passes $2,000.
- **MDD.** compare reads stage2-sizing.txt's reference grid (section 6) in place of power.txt, at the logit model, alpha 0.025 and ICC 0.843, for the contrast's retained changed units and its model's planned passes. When a cut leaves one gstack arm on a model, that contrast tests at 0.05, so the printed MDD is conservative there. compare's grid-row MDD rounds n down to the next grid row, so it reads at or above the computed design MDD, and Sol and particle-1 read the grid at its control rate of 0.50, not at their measured none rate of 0.344. It still decides nothing.
- **Secondaries.** enforced minus standalone (labelled "the gate and the pin difference"), lens minus none and enforced minus lens on Opus, in place of autoplan-ceo minus lens.

Its dry run drives each of these on synthetic readings, with a refusal and an accept twin for every new guard, and reruns every earlier check.

#### 3.6 The two guard-amendment notes

#217 left two notes for before stage 2 spend. #222 settled both (decisions 5 and 6), and this post confirms the rest at 715c659:

1. **The Holm family against the PASS line.** compare binds the projection output by the sha256 the Captain records with the caps and refuses readings whose family, passes, held passes or lens differ from its PASS line (the stop-label amendment's ceo-rule.ts.txt:555 to 611). The scorer post keeps that check with enforced in the arm list, and its dry run adds two refusals: a stage 2 family that names autoplan-ceo, and one that leaves out enforced on a model whose PASS line runs it.
2. **The judge-call count.** Each row's issues, words, fixes and fix_words come from one parse of its closing block (ceo-cli.ts:291, ceoRowFields); packets take each review's issues from that field (ceo-cli.ts:497); readings copy issues and words from the row (ceo-cli.ts:635 to 636); ceo-rule.ts checks labels against issues and words. What remains is that one parse: a row that drops an issue from all three fields at once still passes. The build adds a test that an enforced row goes through the same path.

### 4. The enforced arm

#### 4.1 What it is

| | |
|---|---|
| Harness arm | gstack-enforced |
| gstack | garrytan/gstack@4743132ca027d487fb02bb5f8ce94f2816ff8e7c (1.96.0.0), /plan-ceo-review gate on, /investigate gate off |
| Told line | the forced line (sha256 d4f56ad4...4e43), then "Review this plan for problems.", a blank line and template.txt, as for standalone |
| Models | Opus 5.5, GPT-6.1 Sol, particle-1 |
| What the gate holds | after /plan-ceo-review loads, the final stop waits until an output file written since the load has a Findings or Top risks heading followed by a numbered list from 1 with at least one real item; at most 3 blocks, then it lets the stop through as exhausted |

The forced line types /plan-ceo-review, which the gate counts as a load (skillLoads, lib/skill-contract.ts:251 at 4743132). Between 699a41cb and 4743132, plan-ceo-review's tree is byte-identical (the sha256 of `git ls-tree -r` over plan-ceo-review/ is 74a01aee... at both), so the enforced arm reads the same procedure as standalone. The gate never changes the skill's text, and its fired, released and exhausted markers ride a system message the model never sees.

#### 4.2 Exposure

An enforced session is exposed when it passes all four checks of section 3.3: it read review-sections.md, named a mode, and its gate armed with no error and was released. An exhausted gate reads unexposed, because the rule the arm adds didn't hold. The exposure rate, the 0.80 bar and the per-protocol read work as #214's section 7 says. ceo rows also prints, per enforced cell, the blocks per session and the share released on the first stop.

#### 4.3 Before it spends

The armed-and-blocked test of section 3.3 passes in the build's CI or its run log, and the smoke rerun (section 8) shows both enforced sessions on each model armed and released through the real harness. The gate has only been tested with the claude CLI's --settings, not the Agent SDK preset this harness runs, so neither step is skipped.

#### 4.4 Sessions the gate can't vouch for

| Session | Gate report | Reads |
|---|---|---|
| completed (on its own final stop, with or without the follow-up turn) | exit 0 with a fired record | #214's section 6 class, scored or no-block; gate_armed true |
| completed | exit 1, 2 (GATE_NOT_ARMED) or 3 (GATE_ERRORED), or no record | #214's section 6 class; gate_armed false, so unexposed |
| timeout, turn cap or allowance stop | any | #214's section 6 class; the report is recorded and reads unexposed when not 0 |
| CLI, infra or background-deadline failure | any | #214's section 6 class |

No session leaves a contrast on its gate report, because dropping them would keep only the sessions where the gate fired cleanly. A session the gate can't vouch for counts against the arm's exposure rate (the 0.80 bar) and stays in the intention-to-treat read. The results post gives gate reports per cell by exit code. In the smoke rerun, exit 2 or 3 on any session fails the gate.

#### 4.5 Why it replaces autoplan-ceo, and the family

Big decision 1 gives the reasons. Stage 2's family on each model is the gstack arms that start stage 2 there, enforced and standalone, each against none, with Holm over two. The headline is Opus enforced against none. The no-gstack arm runs in every head-to-head. autoplan-ceo's stage 1 smoke stands as its record: untested on every model, exposure null, the cause "the procedure didn't run". The results post gives its R48 reading as FIX-METHOD on the arm, not on the skill, and names what a later round would need.

### 5. Allowances

**The trip rule.** For each cell, the allowance must hold one call's worst case at a 200,000-token prompt on top of twice the cell's largest session spend. The worst case is the proxy's own (metering-proxy.ts:542; prices.ts:174): every request byte priced as an input token at the row's highest input or cache-write rate, at the long-prompt row once the bytes pass its threshold, plus 32,000 output tokens. Bytes per token are the most the stage 1 smoke journals saw: Opus 2.83, Sol 5.67, particle-1 5.09. 200,000 tokens is Claude Code's working context for these sessions; the largest stage 1 prompt was 133,119. The build checks that the pinned CLI keeps each model's prompt under it, Opus 5.5 included, and the smoke rerun reports each cell's largest prompt. The rule assumes one call in flight per slot. The proxy commits each in-flight call's full worst case until it settles (metering-proxy.ts:544 to 550), so two large calls at once in one slot can trip the allowance early. The smoke rerun reports each session's peak in-flight reservation, and if any smoke session shows two calls in flight, stage 2 waits on a re-size of the allowances against the peak in-flight worst case plus committed spend.

| Model | Worst case at 200k | Twice the largest planning session | Needs | Set (every arm on the model) | Trips at, with that committed |
|---|---|---|---|---|---|
| Opus 5.5 | $3.475 | $2.00 | $5.475 | $7.04 (the default) | 310k |
| GPT-6.1 Sol | $6.155 | $3.00 | $9.155 | $10.00 | 229k |
| particle-1 | $0.134 | $0.20 | $0.334 | $0.50 | 526k |

Stage 1's Sol flag, --allowance 3.52 at $0.60 committed, trips at 85k tokens by the same arithmetic, which matches the two stops after calls at 86,350 and 86,391 prompt tokens. Every arm on a model gets the same allowance, so the stop rule is the same for none and gstack. After the smoke rerun, projection recomputes the rule on measured spend, and an allowance that the rule raises is raised before caps are recorded. It also recomputes the worst case from the rerun's measured bytes per token, since stage 1's sessions ran without the gate, and from the cache-write mode the rerun's journals show. The table prices cache writes at the 5-minute rate. At the 1-hour rate Opus's worst case at 200k is $5.18, which with $2.00 committed passes $7.04, so a journal showing 1-hour writes raises Opus's allowance under the same rule before caps are recorded.

### 6. Sizing at the measured ICC

stage2-sizing.py extends power.py's simulation (Beta unit difficulty with mean p0 and ICC rho, the paired sign-flip test on unit means, two-sided, 80% power) with a reachability check and a second effect model:

- **logit:** power.py's model, one logit shift for every unit plus unit noise tau 0.5.
- **rank:** the arm's unit rates keep the measured ICC and each unit's rank, so a gain arrives as whole units moving from rarely hit to mostly hit.

**What the ICC does.** The Captain expected that at ICC 0.843 extra passes buy little and extra units buy a lot. That holds for one arm's rate, where the unit-to-unit spread dominates. A paired contrast cancels that spread, and what is left is the pass-to-pass noise, which a second pass halves just as doubling units does. Under both models, at ICC 0.843 and Holm's first step:

| Changed units | 1 pass | 2 passes |
|---|---|---|
| 36 | 0.24 to 0.25 | 0.17 to 0.18 |
| 48 | 0.19 | 0.13 |
| 64 | 0.15 | 0.10 to 0.11 |
| 80 | 0.13 | 0.09 |
| 96 | 0.11 to 0.12 | 0.08 |

Units still win per session, but a unit also costs authoring, mining and a session in every cell, about $12.60 at caps, while a second Opus pass costs about $2.50 a unit. So the money buys the most Opus power as more Opus passes on fewer units.

**Shapes at $2,000, with the $30 crew reserve** (stage2-sizing.txt, part 1 and part 2a; MDD at alpha 0.025):

| Shape | Changed and held units | Opus MDD | Sol and particle-1 MDD | All-in at caps |
|---|---|---|---|---|
| A: 1 pass everywhere | 75 and 25 | 0.13 to 0.14 | 0.13 | $1,999.59 |
| **B: 2 Opus passes, 1 on Sol and particle-1** | **62 and 21** | **0.11** | **0.15** | **$1,992.07** |
| C: 2 passes everywhere (frozen) | 50 and 17 | 0.13 | 0.13 | $1,995.88 |
| D: 2 on Opus and Sol, 1 on particle-1 | 51 and 17 | 0.12 to 0.13 | Sol 0.12, particle-1 0.18 | $1,998.21 |
| E: 3 Opus passes, 1 on the others | 53 and 18 | 0.10 | 0.17 to 0.18 | $1,987.18 |

**The design: shape B, 62 changed and 21 held units.** Opus none, standalone, enforced and lens run 2 passes on changed units; Sol and particle-1 cells run 1; held units run 1 pass everywhere. That is 1,078 sessions.

**The MDD, plainly.** At the measured ICC, stage 2 finds a true gain of 11 points or more on Opus 80% of the time at Holm's first step, and 10 points at its second (logit and rank models agree). On Sol and particle-1 it is 15 points. If the ICC is really 0.5, Opus's MDD is 15 to 16 points and Sol's 22. At the 36-unit yield floor, Opus's MDD is 17 to 18 points and Sol's 25. With a wider spread of unit-level effects (tau 1.5 and 2.5, part 2d), Opus's MDD is 0.12 to 0.13 under shape B against 0.14 under shape A, so the shape call stands; both effect models used above are the optimistic end. The prior stands as #214 stated it: a true gain of 0 to 10 points on Opus, so "not distinguished" stays the likeliest reading. The Sol and particle-1 ICC is assumed equal to Opus's, since stage 1 measured it on Opus alone.

**Yield.** The custody addendum's yield projection gives 140 changed comparison units at its 10th percentile on the measured rates, and 89 with the audit and classifier rates both at their Wilson 80% lower bounds, so 62 is inside both. The 2 changed units that passed after the calibration slice filled are the first comparison units, in seeded order. Calibration units never join the comparison set, at most two units come from one repository, and the set is blind-built, audited and sealed under unit-brief.md as frozen. If the set falls short of 62, stage 2 runs on every changed unit that passed, at least 36, with one held unit for every three changed, and the MDD for the count that ran.

### 7. Money: the re-projection and the all-in check

_Internal planning record: these budget and cost figures are plans and caps, not findings._

#### 7.1 Crew spent

The 18 threads on the CEO line to this post's start read 469,608 credits, $469.61 at $1 per 1,000: the design and its /ship tail, the guard, ladder and stop-label amendments, B0, B1 and its /ship, the harness follow-up and the exposure fix with their tails, both pin posts and the part 2 /ship, B2's mining and authoring, stage 1's run threads and the stage 1 gate amendment. The difficulty ladder plan, which served every line, is left out, as B2's re-projection left it out. This thread is counted at its 70M-token stop in 7.2.

#### 7.2 The table

At $0.40 per million crew tokens, the top of the CEO threads' measured range; authoring at 1,760 credits per passing unit and mining at the top of the addendum's range, $97 over 62 units ($1.5645 per unit); stage 2 caps under #214's section 10 rule (1.25 times each item's projection plus one full round at allowance).

| Line | Basis | Dollars |
|---|---|---|
| Crew spent | 18 threads | 469.61 |
| Stage 1 settled | 12 ledger items | 17.60 |
| Stage 1 runner host | 3.11 hours | 0.93 |
| This amendment to READY | 70M tokens | 28.00 |
| Build PR and its gate-class /ship | 250M | 100.00 |
| Smoke pin post and its /ship | 60M | 24.00 |
| Smoke rerun thread | 40M | 16.00 |
| Smoke rerun items, at caps | six items, section 8 | 72.00 |
| Comparison mining and authoring | 83 units at $3.32 | 275.93 |
| Authoring overhead (restore, sealing, suite) | 25M | 10.00 |
| Stage 2 pin post and its /ship | 80M | 32.00 |
| Stage 2 run items, at caps | opus-p 199, opus-e 203, sol-p 152, sol-e 186, particle-p 10, particle-e 12 | 762.00 |
| Stage 2 judges, the floor | section 7.3 | 70.00 |
| Stage 2 run thread | 80M | 32.00 |
| Runner hosts, smoke rerun and stage 2 | about 40 hours | 12.00 |
| Results post and its /ship | 100M | 40.00 |
| Crew reserve | the crew lines after authoring | 30.00 |
| **All-in** | | **1,992.07** |

The line fits $2,000 at caps with $7.93 to spare, because shape B is sized to the largest unit count that fits. The $30 crew reserve covers the crew lines still to come after authoring (the stage 2 pin post, the run thread and the results post, $104 at estimate): a crew overrun after authoring is met from the reserve before the cut order touches lens or authored units. At the per-session figures rather than the caps, stage 2's run items project $531.38, so the line would likely close between $1,730 and $1,760. The authoring line is conservative: 2 of the 62 changed units and 8 classifier passes are already in hand.

#### 7.3 Projection rule changes

- **Per-session spend.** As frozen: each none from stage 1's median none session; each gstack cell from the larger of its two smoke rerun sessions; lens at 1.2 times Opus none's median.
- **Judges.** Stage 1's settled judge spend ($2.79) times stage 2's units over 20, times stage 2's reviews per changed packet over stage 1's (16 over 9 at shape B, in place of the frozen 3), with a floor of twice that and at least $70.
- **Stage 2 envelope.** $2,000 less every other all-in line, $839.93 at this table, in place of #214's $1,410. Each stage 2 judge item is capped at that envelope less stage 2's settled spend, as #214's section 13 frames it, and the six run caps plus the judge floor must fit inside it ($832.00 here).
- **Cut order**, when the six run caps plus the judge floor pass the envelope: drop standalone on particle-1; drop standalone on Sol; drop lens; then drop changed units from the end of the seeded order, with held units kept at one for every three, down to 36. Under 36, stage 2 doesn't start and the question goes to the Captain.

**The all-in check** (ceo-rule.ts allin) runs three times: before the smoke rerun on this table; after the smoke settles, with crew actuals, the smoke's settled spend and the rerun's per-session spends, which sets the comparison set's size (section 9, step 5); and before stage 2's first lease, as frozen. Each time the sum must be at most $2,000. When it isn't, the design shrinks by the cut order and the MDD for the size that fits is reported, never padded.

### 8. The smoke rerun

Six items on the first two calibration units, the same units and suite file as stage 1 (suite sha256 a3677868...), one round each, built from the build's merge commit:

| Item | Arm | Model | Allowance | Cap |
|---|---|---|---|---|
| ceo-o-sm2-opus-e | gstack-enforced at 4743132 | Opus 5.5 | default ($7.04) | $15 |
| ceo-o-sm2-opus-p | gstack-forced at 699a41cb | Opus 5.5 | default ($7.04) | $15 |
| ceo-o-sm2-sol-e | gstack-enforced | GPT-6.1 Sol | $10.00 | $20 |
| ceo-o-sm2-sol-p | gstack-forced | GPT-6.1 Sol | $10.00 | $20 |
| ceo-o-sm2-particle-e | gstack-enforced | particle-1 | $0.50 | $1 |
| ceo-o-sm2-particle-p | gstack-forced | particle-1 | $0.50 | $1 |

Both gstack arms run with GSTACK_SESSION_KIND=unattended (Big decision 10), so standalone re-earns its admission under the new kind. Each cap covers one round of two sessions at full allowance, rounded up. The caps sum to $72, inside the all-in table. The smoke pin post freezes each item's exact command with #241's shared flags.

**The gate, in full, with no exception.** Before anything after the smoke spends, all three hold:

1. `ceo rows --checks` on the six rerun runs exits 0: every one of the 12 sessions is journaled, has a readable transcript and a parsable last block, holds the end state #214's section 6 gives, is scored, and passes every check of its arm's exposure detector (standalone's two; enforced's four).
2. Every session has an empty `logs.copy_out`, and every enforced session's gate report exits 0.
3. The smoke findings check of #235's section 4 runs as frozen. No session in these items carries findings_written, so it has nothing to compare; it stays in force for any later autoplan run.

**Rule 5 on the rerun.** A cell is admitted when both its sessions pass the gate above and finished within 1800 s. A cell that fails only the 1800 s leg is untested in stage 2 and isn't run there; when that cell is enforced on Opus, stage 2 doesn't start. Any other failure fails the gate.

**A failed gate** stops the line before any comparison unit is authored. The run thread reports per-session checks and causes to the Captain, and nothing reruns without a new post.

### 9. Order and start rules

Nothing spends until every step before it holds.

1. This post merges.
2. The build PR (section 3) merges through /ship, with its scorer post.
3. The smoke pin post merges: the build commit, the six smoke commands, a keyless dry run of the smoke items and the trip check, one temporary-ledger lease opened and settled per item, and #214's section 16 check. The Captain records the six smoke caps in approvals/.
4. The smoke rerun runs detached on a runner host, and its gate passes (section 8).
5. The all-in check reruns on measured figures, with the $30 crew reserve kept as its own line, and sets the comparison set's size under shape B, at most 62 changed units unless the measured figures leave room for more. The Captain records the approval to author.
6. Authoring: mining, blind building, audit and sealing in seeded order under unit-brief.md, with a custody addendum that posts digests, counts and measured cost per passing unit.
7. The stage 2 pin post merges: the comparison suite, every stage 2 command, projection's output and its sha256, the dry run, one temporary-ledger lease opened and settled per item for the six run items and the three judge items, and #214's section 16 check. The Captain records the caps and the projection sha256, and the project owner gets the MDD and the dollar figure.
8. Stage 2 runs on HEADROOM, the enforced arm's Opus admission, a passing projection and the all-in check, as #214's start rule 8 says.
9. The results post.

### 10. Outside terms, licences and rights

No new provider, data route, dataset or licence. The enforced arm sends the same sealed units over the same routes stage 1 used and #241's section 6 checked: Anthropic's API for Opus, OpenRouter to OpenAI for Sol (only openai, no fallbacks, data_collection deny) and OpenRouter to Particle AI. gstack at 4743132 is our own public commit. The allowance change moves no data. Section 16 of #214 and the Captain's ruling on the Sol route stand, including the per-item provider check on every Sol item.

### 11. Risks and limits

- **The full gate is strict.** Twelve sessions on a new arm must all pass. A failure on any model, particle-1 included, stops the line. That is the price of no exception, and the smoke-first order keeps it cheap.
- **The gate under the Agent SDK is untested** until the build's armed test runs. If it can't arm through this harness, the enforced arm can't run, and the question goes to the Captain.
- **Session kind.** Both gstack arms run unattended, so plan-ceo-review picks its recommended options without asking the rec user, and standalone's path differs from its stage 1 smoke. The smoke rerun re-earns its admission, and a failure there stops the line (Big decision 10).
- **The block may point at plan.md.** With no output file set, a block can tell the model to add Findings to the plan under review. The score reads only the closing block, so this changes nothing scored, and the results post reports blocks per cell.
- **Two pins.** Enforced minus standalone carries the gate and 94 commits outside plan-ceo-review's tree; it is a secondary and decides nothing.
- **Planning figures.** The enforced arm's cost and Sol standalone's full-session cost are guesses until the smoke; the smoke-first order sizes authoring on measured figures.
- **The ICC** comes from 16 units on Opus alone. The ICC 0.5 rows give the sensitivity.
- **autoplan-ceo** is untested in this eval. The line measures plan-ceo-review as a standalone, enforced and advisory, not inside /autoplan.

### 12. Not in this post

The build, the scorer post, the pin posts, authoring, any paid call, any change to the primary, the judges, the labels, the verdict words or the under-36 stop, and the results.

### 13. Files

| File | What it is |
|---|---|
| stage2-sizing.py | the sizing and power script (seed 20261106; no key, no network) |
| stage2-sizing.txt | its output: part 0 the allowance rule, part 1 the money for each shape, part 2 the MDDs |

Rerun: `uv run --with numpy==2.3.4 python stage2-sizing.py > stage2-sizing.txt`.

## Review record

Lean /autoplan (feature kind), one Opus 5.5 reviewer, one round: 13 findings (2 High, 5 Medium, 5 Low, 1 Informational) and no outside terms. The reviewer reran the money part of stage2-sizing.py and traced every number to the evidence. The Captain took every recommendation at gate 1 and extended the session-kind fix to both gstack arms. Every finding is applied: completed sessions keep their class when the gate report fails (Big decision 4); both gstack arms run unattended (Big decision 10); the replaced smoke items, stage 2 envelope and allin fields have rows in section 1; the PASS line carries the unit counts; the armed test gained the unit layout, the question-ending, exhausted, copy-failure and usage-error cases and a frozen deadline; a $30 crew reserve re-sized shape B from 64 to 62 changed units; gate_armed needs a fired record; cross-references name #214; the stage 2 pin post opens temporary leases; part 2d adds the wider-spread power rows; the trip rule is recomputed on measured inputs; and section 3.5 notes the conservative MDD after a cut. The /ship record is in the pull request.
