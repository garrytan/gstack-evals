---
id: 2026-10-31-geva-83-planning-r1a-prereg
kind: plan
title: "Planning R1a preregistration: gstack's CEO plan review against no gstack on the sealed CEO panel"
summary: "Freezes R1a before any paid call: arms (none primary), suites, Holm families, a 0.5 false-alarm gate, judges, pilot stops, power, a $2,800 cap with a $95 judge reserve, resume and the dry run."
author: GEVA-83
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-10-31
status: open
links:
  - 2026-10-31-geva-79-planning-lane-plan
  - 2026-10-31-geva-82-planning-r1a-ceo-panel
  - GST-637
  - GST-538
  - GST-618
  - GST-659
  - GST-737
  - GST-742
  - GST-748
  - lanes/review-noloss/suites/planrev-ceo-r1a.json
attachments:
  - 849226d6dd3e991157a0912b8efef02a9bd0b570c0f33cb96a0ba3485ec0a367  any-severity.json
  - 2634ebc8468af3f6b3307cf8715f027166a8c55fa34e59ef01be49fb299b31e8  build.sh.txt
  - 7efc17228292f17a25f08a2039f68e0b1148843bdb66700f1decda988c636360  comparisons.fable.json
  - 39df60057f75efe0ad6a21623781894c5cb2d467b6776277037f5dbfe327afbd  comparisons.primary.json
  - 4fffa2b3b604794eaace96bdad34deecbc4c3d4f64a51665039581e0ecd99ca1  comparisons.real-neutral.json
  - 25d7f666ac52dfaedec7aec125804e4dd3aacf1ba33278ed6abda8b33e8b7240  comparisons.secondary-opus.json
  - c5b4b260c8d21f1bbc0552d7858a20a1076a847f0dd512451d11e2ce6f3d3ce8  comparisons.secondary.json
  - 0d1170e5da6521f688a73efc2f37404c127b99b09f0de537a7c03a0d90eb2a12  convert.py.txt
  - 154dfe4f9ab8fa823a17e832a16d128efb943db2e63d3d52d58c78a676eead16  dryrun.ts.txt
  - fe963d42f4dbc513dcaac6185029f8c793c3287372bf3f779939c754854f9a03  dryrun.txt
  - 36a7008358b9a1f1ec8bff454c5ca4221cd04a92e4b07220e902d0557178bda5  fable-subset.tsv
  - a63af263d57f11e653b6da12b6afb06a7dc7c3ba6f3e7d4982ef96d468f55aa9  gate-size.ts.txt
  - fd77e60b79fbc93c29057f227dce9736e98720d6034d0609256c0ac87a109e49  gate-size.txt
  - 64e35c81c8bfdb038a7c21652ffaeaed8e3683d4e67ecc87638703a00d73fc06  judge-brief.md
  - e3bfc99132b2eca114d42663d99dfa3ca4f46384865e5c9bc16d7d7ae19bb001  policy.json
  - 55120380543c39a8521c40b8ed7eaa4816f9c5ca76179e358a61158e5b853b44  power-grid.txt
  - 1c51b933a24ebc990ecb782a375d17c15d97d0b968502670fd2d1c81e1db29a9  readings.py.txt
  - 150efbf71b69714e14a0da4b3b7102c82ce5984677219a424230fb66b9be8688  refill-gaps.ts.txt
---

# Planning R1a preregistration: CEO plan review against no gstack

This post freezes round R1a of the [planning lane plan](../2026-10-31-geva-79-planning-lane-plan/README.md) before any paid call. R1a asks one question: does gstack's /plan-ceo-review catch more known plan flaws than the same model asked plainly, with no gstack at all? The no-gstack arm is required and primary (Garry, 2026-10-31). The plan's "Open at approval" section wins over its reviewed text, and where this post departs from either, section 12 says so.

It pins the scorer and harness at main e305ed0, the merge of #100 (0239f14), #101 (a50deb5), #106 (GST-737, e1f5525) and #107 (GST-748, e305ed0), the panel at #99 (ad594d4), and gstack 1.91.379.0 (2d1b55d7621df1a71e02037c79b63b7ee2fdc64f). Issue GST-637. It also carries GST-538's two deferred items (sections 3 and 9).

**Custody.** The panel is held in procedural custody (interim, Captain drive, encrypted), not "sealed" in plan v3.2's sense (Captain ruling, approvals/2026-10-31-planning-r1a-custody.md in the Captain drive). The repo must not go public before GST-618 closes: PR #99's pre-fix commit still pairs per-unit digests with strata at refs/pull/99. Any R1a result run on the v1 panel after the repo goes public must say so.

## 1. Claims

- **"gstack's CEO review catches more of these flaws than plain Opus 5.5, against bare Claude Code with bundled skills off"** only when none-opus vs gstack-opus is LOSS on the Holm-adjusted p of the primary family and the false-alarm gate passes. The claim names the panel, gives the delta with its plan-clustered interval, and prints the false-alarm reading beside it.
- **"gstack's CEO review catches fewer"** under the mirror comparison and the same gate. Reported plainly.
- **Not distinguished** otherwise, with the power table's minimum detectable difference.
- **Ceiling.** If none-opus's must-fix recall on the headline panel is above 0.85, the round reports a ceiling and makes no claim; the lens goes to the harder-panel track.
- **Secondary family** (particle-1 none vs gstack, Opus none vs lens, particle-1 none vs placebo): the same rule inside its own Holm family. A lens result that matches gstack's says the skill's name carries the effect, which sends the skill to the cut track.
- **Fable 5.1 rung** (section 2): exploratory, reported with its interval, never a claim, whatever its scorer prints (section 4).
- **Not claimed:** anything on the 4 pilot units (section 8); NO_LOSS or non-inferiority at this size; that gstack writes better plans in general or helps finish tasks (R1b); anything about flaws outside the panel's two taxonomies. Seeded flaws are not natural flaws. The two real-neutral units are the check on that, and they are reported alone.

## 2. Arms, models and pins

Every arm runs through `review-units --plan ceo` in the Docker rig at the pin, on the same unit tree, with the same tools, the rec user and CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1. Each prompt is the arm's line, a blank line, then the told plan template (TOLD_PLAN_SHA256 48a6f6a32049f111023e6d15958d1263f94611116d14ccb703809a97eff44291). The parser reads the last `plan-findings` block (PLAN_PARSER_SHA256 048b1f22600b504b7bccccb48c5e2b9b54cdd7a433ad9b35e3261d2df49d0e46). Critical and High are must-fix (PLAN_SEVERITY_MAP).

| Arm id | Install | Line | Role |
|---|---|---|---|
| none-opus | bare | "Review this plan for problems." | required, primary |
| gstack-opus | gstack 1.91.379.0, whole tree | "/plan-ceo-review Review this plan for problems." | primary |
| lens-opus | bare | "Do a CEO/founder-mode review of this plan. Review this plan for problems." | secondary |
| none-particle-1 | bare | as none | secondary |
| gstack-particle-1 | gstack 1.91.379.0 | as gstack | secondary |
| placebo-particle-1 | Lane B placebo tree built from the gstack arm | as gstack | secondary |
| none-fable, gstack-fable | as none and gstack | as none and gstack | exploratory rung, subset, 1 pass |

- **The rec user.** Every arm answers each question "Go with your recommendation." and one that offers another skill, review, or promoting or committing docs "No, not now." (REC_USER_SHA256 ab8977416ccde79c7f9789e56bfce43f338b43374f823c87b22d051830ca7971). gstack arms run every question in the installed registry as never-ask. No model answers for the user, no outside voice runs (codex_reviews disabled), and each cell's slot holds only its driver model.
- **Models.** claude-opus-5-5, particle-ai/particle-1 (OpenRouter) and claude-fable-5-1. The lens line names the lens in the words of plan-ceo-review's own description at the gstack pin ("CEO/founder-mode plan review."). Sonnet 5.5, Haiku 5.5, DeepSeek V4.1 Flash and the open-weight slots stay out of R1a for cost and sequence, as the plan's section 7 says; they join a ladder round once a lens shows lift. OpenRouter's programming ranking was last read for #95 (meta.as_of 2026-10-31T09:13:38.678Z); this thread ran keyless, so it cites that same-day reading, and the next ladder preregistration re-reads it.
- **Fable 5.1 rung** (Garry, 2026-10-31, "Do it" on GST-659: Fable 5.1 is allowed as a capped, small-sample rung in stacks and planning). none-fable and gstack-fable run one pass on a frozen subset, suite planrev-ceo-r1a-fable: 12 seeded units (S01, S02, S05, S06, S09, S10, S13, S14, S17, S18, S21, S22; 4 per mode, carrying 12 T1 and 12 T2 flaws) and the 6 core decoys D01 to D06 ([fable-subset.tsv](fable-subset.tsv)). They also run in the pilot. At the pin, policy/models.json marks Fable smoke_only, and review-units admits a smoke_only subject only under a ledger item its policy row lists in `rungs`. R1a passes its own policy, [policy.json](policy.json): the default file at the pin with `"rungs": ["planning-r1a"]` added to claude-fable-5-1. Every R1a review-units command passes `--policy` with that file and `--item planning-r1a`. The default policy is unchanged, so Fable still runs nowhere else, and no code changes. Fable's price row is $10 and $50 per million input and output tokens, 2.5 times Opus 5.5's $4 and $20.
- **gstack-auto, a planned amendment arm.** Garry asked for a non-interactive CEO review inside /autoplan (GST-538, GST-537). Its slot is frozen in src/trial/review/plan.ts as GSTACK_AUTO { issue GST-537, command "/autoplan --ceo-only", min_version null }, and the CLI and run loop refuse it until a gstack release sets min_version (the dry run shows the refusal). If it releases before any full-run session, an amendment adds gstack-auto-opus on the same suites at 3 passes, makes none-opus vs gstack-auto-opus (both directions) the primary family, moves none-opus vs gstack-opus to the secondary family, and records the release, the version and the cost (about $590 more, cap about $3,400). If it releases after the full run starts, it waits for a later round.

## 3. Panel, run suites and custody

The panel is #99's planning-r1a-ceo-panel-v1 (bundle sha256 2898122b24bc826ec2d8bcda7459a0526aa06beaca035781ae96a8ccb57d2f67, inner tar 32da862a4a106e609bcb26683411fb6ee8b6b44a301f38337f1cb4270a1b40b9, panel.json c3f0ec55b0c1e425d9efa145a40d9f4dc05f38fd3e411eb31efb98651a9c4246). GEVA-83 converted its 42 units into R1a's run material outside every checkout, keyless, with [convert.py.txt](convert.py.txt), [readings.py.txt](readings.py.txt) and [build.sh.txt](build.sh.txt):

- Each unit was checked against the panel manifest (head, base, a head commit that adds only plan.md, plan, key and repo bundle digests): 42 of 42 pass.
- Each keyed flaw became one plan case (kind plan, lens ceo), its line the line of its keyed plan.md heading; each decoy's bait became one INFORMATIONAL case. 70 cases.
- All 42 units sit in one source repository, panel/plans, as numbered units. **The numbers are a random permutation drawn at conversion**, and the map from number to stratum lives only in the run bundle. An arm sees its unit's number and head, so nothing published here pairs either with a stratum, mode, source or flaw label.

| Suite | Held | Units | Blockers | sha256 |
|---|---|---|---|---|
| planrev-ceo-r1a (headline) | stub in this repo, suite in the run bundle | 24 seeded, 12 decoys | 48 must-fix, 12 bait | 954f8f6e72f2f196d8de5757d231d39753b18d6a55dbd806770c2f2acb6bfdba |
| planrev-ceo-r1a-real | run bundle | 2 real-neutral | 2 | e07c0a1528d2d54987d9fe7f9527adfc85e3b4cd3aec823fbfcc71dcfab6c9d0 |
| planrev-ceo-r1a-pilot | run bundle | 4 pilot | 8 | 40e0b954a419514e9e5faf7a11c0dedc6a5b17bef308481dfe1dc26bd527ab14 |
| planrev-ceo-r1a-fable | run bundle | 12 seeded, 6 decoys | 24, 6 bait | d3337d23af13a6834835c4ac9fcb1025ba0860efda675b732f2bc8d3090b637c |

- **The stub** [lanes/review-noloss/suites/planrev-ceo-r1a.json](../../../lanes/review-noloss/suites/planrev-ceo-r1a.json) (file sha256 f8262d93b69048fdabbe8e15b38cdcec266e2e09f56275e31f267530d8e6c533) holds the id, kind, counts and two digests: the suite's (954f8f6e72f2f196d8de5757d231d39753b18d6a55dbd806770c2f2acb6bfdba) and its catalogs' (34b2f8e4d9a89aac677838aac5fbfccddd3c863f4972ff2f9c697a0ee92f3b04). Its counts equal panel.json's. It loads only with a sealed root whose suite, catalogs and counts match. This replaces the handoff's "the stub joins by amendment before the pilot".
- **The run bundle** planning-r1a-ceo-run-v1.tar.age (sha256 90d904347a66713ad00c85e9b7be2ea9754c55968371280aa33be9eb16126785, inner tar 86bd186a04607ec5ac37978af955a7006d84d9e240f379be912bab82e7c3aaab) sits beside the panel bundle in the Captain drive (handoffs/GEVA-82/sealed/), encrypted to the panel's age recipient. It holds the source repository, the suites, catalogs, reading files, the unit map and the conversion scripts. CUSTODY.md there records its digests and every opening. The plaintext was deleted after sealing and checked gone.
- **Real-neutral (GST-538 item 1).** R01 and R02 are public and reported unsealed, per unit and apart from the headline, in their own suite. R01's flaw (the v1 plan schedules its first measured number last, T1-B3) has its public sources in wiki/plans/2026-10-28-gsta-11-review-replay-prereg.md at 2f28f9f (line 80), wiki/plans/2026-10-28-gsta-12-laneb-quick-prereg.md at e634bf2 (line 92) and wiki/plans/2026-10-28-gsta-13-second-opinion-rerun-prereg.md at 66cc954 (line 69). R02's (the Lane B quick look assumes agents open skills on their own, T1-W4) has wiki/board/2026-10-29-gsta-12-laneb-quick-results/README.md at 1b68e63 (line 66) and wiki/plans/2026-10-28-gsta-12-laneb-quick-2-prereg.md at 257db8e (line 19). Their keys and rebuild recipes are in the panel post's real-neutral.md. The scorer reads a suite outside the repo only as a sealed one, so their two cases carry visibility sealed in the run bundle; that is a tooling detail, and nothing about them is secret.
- **Exposures.** The panel's authors (openai/gpt-6.1-sol subagents of GEVA-82) and auditors (anthropic/claude-opus-5-5, the Opus arms' family), and GEVA-82, as the panel post lists. GEVA-83 (anthropic/claude-opus-5-5) converted the bundle by script: it saw unit ids, kinds, modes, keyed category ids, deserved severities, check counts and digests, and no plan, context or key text. The primary judge shares a family with the panel's authors.

## 4. Statistics: the families

Scoring is `noloss score` at the pin: a flaw's value is the share of an arm's passes that flagged it must-fix; plans are the clusters; LOSS is a one-sided exact sign-flip at null zero, Holm-adjusted within each file's declared family; the interval is a plan-clustered bootstrap (seed 20261031, 10,000 draws). Each comparison carries the lane's 10-point margin, which the scorer requires, and no NO_LOSS reading is read as a claim.

- **Primary family**, [comparisons.primary.json](comparisons.primary.json): none-opus vs gstack-opus (LOSS means gstack catches more) and gstack-opus vs none-opus (LOSS means gstack catches fewer). Holm over 2.
- **Secondary family**, [comparisons.secondary.json](comparisons.secondary.json): none-particle-1 vs gstack-particle-1, none-opus vs lens-opus, none-particle-1 vs placebo-particle-1. Holm over 3.
- **After the frozen particle-1 rung drop** (pilot stop c), [comparisons.secondary-opus.json](comparisons.secondary-opus.json): none-opus vs lens-opus alone. Both secondary files are frozen now because the drop changes the family size and can move a verdict.
- **Fable**, [comparisons.fable.json](comparisons.fable.json): none-fable vs gstack-fable in both directions on planrev-ceo-r1a-fable, Holm over 2. A comparisons file scores one suite, so the Fable subset cannot share the secondary file's Holm step; it is read alone, as exploratory. **The Fable subset makes no claim, whatever its scorer prints** (GSTA-2, 2026-11-01): a "claim may be made" line, a LOSS or a gate PASS there is a reading, never a claim.
- **Real-neutral**, [comparisons.real-neutral.json](comparisons.real-neutral.json): the primary and secondary pairs on planrev-ceo-r1a-real, descriptive, no family; R1a reports each arm's outcome on each of the two flaws.
- **The false-alarm gate** (open item 7). Every primary, secondary and Fable comparison carries `false_alarm_gate: {margin_per_decoy: 0.5}`. The gate reads must-fix false alarms on decoys only (a bait flagged must-fix, or a must-fix finding there ruled not-defect), paired by decoy. A LOSS whose reference's excess per decoy has a 95% interval reaching past 0.5 prints FALSE_ALARM_GATE_FAIL, and its claim may not be made. The headline gate reads all 12 decoys.
  - **Why 0.5, not 1** (GSTA-2, 2026-11-01). Each decoy holds one bait. At margin 1, an arm that flagged every bait must-fix and raised no other false alarm had an excess of at most 1 on every decoy, so it passed (#110's /ship, Step 11). At 0.5 it fails. The dry run checks it at both margins.
  - **How often an honest arm passes.** [gate-size.txt](gate-size.txt), from [gate-size.ts.txt](gate-size.ts.txt), runs the pinned scorer's interval and the gate's own rule on simulated readings in which the reference's decoy false alarms match none's. On the headline's 12 decoys at 3 passes, such an arm passes every time when its only false alarms are flagged baits, at any bait rate. It passes at least 80% of the time while its other must-fix findings ruled not-defect stay at or under about 0.5 per decoy per pass (Poisson) or 0.25 (overdispersed), and only 40% to 63% of the time at 1 such finding per decoy per pass. So a noisy arm can lose a true "catches more" claim to the gate. gate-size.txt measures only how often an honest arm passes, not how often an arm with real excess false alarms does. On the Fable subset's 6 decoys at 1 pass an honest arm passes far less often, between 19% and 95%; that reading makes no claim either way. The share of honest readings that pass, as a range over bait rates 0.1, 0.3 and 0.5 (2,000 readings per cell):

  Headline suite (primary, secondary and secondary-opus files), 12 decoys at 3 passes:

  | Other must-fix findings ruled not-defect, per decoy per pass | Poisson, margin 0.5 | Overdispersed, margin 0.5 | Poisson, margin 1 | Overdispersed, margin 1 |
  |---|---|---|---|---|
  | 0 (flagged baits only) | 100% | 100% | 100% | 100% |
  | 0.1 | 98 to 100% | 98 to 99% | 100% | 100% |
  | 0.25 | 92 to 97% | 87 to 90% | 100% | 100% |
  | 0.5 | 78 to 83% | 65 to 71% | 100% | 96 to 97% |
  | 0.75 | 69 to 72% | 50 to 53% | 99% | 88 to 91% |
  | 1 | 59 to 63% | 41 to 43% | 96 to 97% | 78 to 81% |
  | 1.5 | 47 to 50% | 29 to 31% | 92% | 62 to 64% |
  | 2 | 41 to 44% | 22% | 84 to 85% | 48 to 50% |

  Fable subset, 6 decoys at 1 pass:

  | Other must-fix findings ruled not-defect, per decoy per pass | Poisson, margin 0.5 | Overdispersed, margin 0.5 | Poisson, margin 1 | Overdispersed, margin 1 |
  |---|---|---|---|---|
  | 0 (flagged baits only) | 75 to 95% | 75 to 95% | 100% | 100% |
  | 0.1 | 60 to 80% | 61 to 80% | 94 to 97% | 94 to 96% |
  | 0.25 | 50 to 61% | 49 to 61% | 85 to 90% | 83 to 86% |
  | 0.5 | 39 to 43% | 37 to 42% | 73 to 76% | 66 to 70% |
  | 0.75 | 32 to 37% | 30 to 35% | 64 to 68% | 55 to 58% |
  | 1 | 29 to 34% | 27 to 28% | 58 to 61% | 48 to 50% |
  | 1.5 | 25 to 27% | 19 to 22% | 48 to 50% | 36 to 40% |
  | 2 | 21 to 23% | 19 to 20% | 41 to 42% | 32 to 33% |

  Pilot read (e) in section 8 sends the round back to the Captain when the pilot's noise is above 0.25, the highest rate at which an honest arm still passes at least 80% of the time here under both models (GSTA-2, 2026-11-01).
- **Size rule** (judging decision 3, GEVA-81's recommendation, taken). score's size rule and the exported power table ignore --alpha and --dependence. No code change: no NO_LOSS claim is made, so the size rule gates nothing, and power admission is the grid in section 7.

## 5. Secondary and sensitivity readings

All are reported, none is a claim. Each runs through the pinned scorer as the dry run shows.

- **Recall by source** (open item 5): T1 alone and T2 alone, each a derived suite that counts the other source's 24 flaws as detection-only (`derive --detection-only`, lists in the run bundle). A claim names the source it rests on, since T1 overlaps /plan-ceo-review's own checklist.
- **Recall by mode** (open item 6): greenfield, added capability and fix, each a derived suite of its 8 seeded plans and 4 decoys (`derive --drop-file`). Each gstack session's CEO review mode is recorded from its mode handoff line (modes.tsv), and any value of scope expansion is not claimed.
- **Volume-matched recall** (open item 7): `derive --first-k 2`, each arm's first 2 must-fix findings per unit-pass, 2 being the flaws per seeded plan. It must agree in sign with the primary; if it does not, the claim says so.
- **Any-severity recall**, with real new defects per plan (unmatched must-fix findings adjudicated defect): `noloss secondary`, and `derive --severity-map` [any-severity.json](any-severity.json) for the scored any-severity reading.
- **Not-defect must-fix findings** on every scored plan, per arm, from blind adjudication.
- **Missing cells** (open item 2): a malformed, missing or timed-out pass scores as finding nothing and is listed in arm.json diagnostics. Failure scoring at the pin, from #101, #106 (GST-737) and #107 (GST-748), as the Captain settled it:
  - Model output is non-empty text, non-empty thinking, a thinking block with a non-empty signature (Claude 5.5 models send empty thinking with a signature), redacted thinking, or a tool_use block. An empty assistant message is no model output, and a record with no model_output flag is a gap.
  - A session the arm's own failure ends (a crash or a timeout) after model output scores as finding nothing: a miss for that arm. The same failure before any model output is a coverage gap.
  - Infra is never the arm's miss. A provider API error, an evaluator error, a user-simulator failure, docker exec's own exits 125, 126 and 127, an ECONNRESET followed by exit 1 after the SDK closes stdin (teardown), and a machine that stops answering are coverage gaps.
  - An evaluator stall is credited to the session, timed with performance.now, capped at 10% of the session timeout and recorded as credited_stall_ms. A stall just before a persona pause is credited. A timeout reached only past that cap is infra.
  - A completed session with model output but no text turn scores as a miss, because the plan parser reads reviews only from text turns. The results count these misses per arm.
  - A coverage gap stops the arm with E_COVERAGE_GAP, and review-units exits 2. The run procedure reads exit 2 as a stopped arm, records it, and never reruns it as a crashed run. Its gaps may be refilled only by the one resume section 10 allows.
  - Each session record keeps the agent CLI's own `exit_code` and `signal` (null for both when the harness's own abort or teardown killed it). The exit-137 count below reads exit_code 137 or signal SIGKILL from them.
  - The dry run runs the pinned harness's own keyless tests of these cases (tests/trial/review/plan-scoring.test.ts and tests/adapters/claude-code.test.ts). The sensitivity reading drops every unit any arm's diagnostics name, for every arm, and rescoring the primary family on it must agree in sign.
- **Host memory kills** (#106's /ship, GST-742). The driver cannot tell a host OOM kill of one arm's CLI (exit 137, container still alive) from the arm's own crash, so after model output the frozen scoring counts it as that arm's miss. R1a reports exit-137 sessions per arm. If there are any, it also gives the primary family without them, as a sensitivity reading beside the frozen scoring and never in its place: every unit that holds an exit-137 session is dropped for every arm (`derive --drop-file`, the path the missing-cells reading uses), and the primary pair is rescored on the rest.
- **Cost per flaw caught** per arm from cost.tsv, and for particle-1 the ladder reading gap closed = (gstack-particle-1 minus none-particle-1) / (gstack-opus minus none-particle-1), descriptive.

## 6. Judging

Judges read blind packets from `noloss judge-packet` at the pin with [judge-brief.md](judge-brief.md): openai/gpt-6.1-sol first, anthropic/claude-opus-5-5 second on the blockers judge-join names (every arm disagreement plus a seeded 20% sample), and anthropic/claude-sonnet-5-5 third where the two differ. Unmatched must-fix findings go to blind adjudication by the same three. Severity is applied mechanically, never by a judge. Blind and labelled adjudication are never pooled (#100's gate). Packets carry each finding's section, claim, evidence and fix, and the unit's tree at its head bound by head, tree and plan digest.

GEVA-81's three judging decisions from #100's /ship:

1. **Heading list** (taken). #101 adds the five missing plan-ceo-review section titles to PLAN_HEADING_WORDS and re-pins it: 63 words, sha256 ecb56e71518091b9e7b41bc5c3507ca3c29de228304e48c8f51398d50d03f853, checked against the panel's echo-terms.txt.
2. **No marker, and an identifiability probe** (taken, with the probe by amendment). Packets remove the heading words with no marker. The probe (a judge guesses the arm from a sample of packets, with a threshold) has no tool at the pin, so it is a planned reading that joins by amendment with its own tool and dry run before full-run judging (Captain, A2). If it never lands, the results list "identifiability not probed" as a limit. No claim depends on it.
3. **Size rule** (taken): section 4.

judge-run --dry-run needs the cap's ledger item, so it runs after the cap is recorded and before any judging spend; its model checks are the policy's judge and adjudicator roles, which all three models hold.

## 7. Power and the smallest worthwhile effect

The headline is seeded-only: 24 plan clusters of 2 flaws at 3 passes (decoys and real-neutral add none). [power-grid.txt](power-grid.txt) is GEVA-81's `noloss power --clusters` grid, run at #101's 2d81b48 (power.ts has changed only in a doc comment since, so it holds at the pin), at alpha 0.025 (the primary family's strictest Holm step), 0.0167 (the secondary's) and 0.05, recall 0.2, 0.35 and 0.5, and within-plan dependence 0, 0.3 and 0.6.

- **The smallest worthwhile effect is 20 points** of must-fix recall. At alpha 0.025 a 20-point LOSS has power 91.4% to 100% across every recall and dependence in the grid. At 15 points power falls under 80% from recall 0.35 with dependence 0.6 (79.6%) and at recall 0.5, so a 15-point effect is not admitted.
- The pilot measures recall. Before the full run, the grid is rerun at none-opus's pilot recall. If LOSS power for 20 points at alpha 0.025 and dependence 0.3 falls under 80%, the round returns to the Captain before any full-run session. The panel size freezes after the pilot; 24 seeded plans is a floor.

## 8. Pilot and stops

The pilot runs the 4 pilot units, one pass, in all 8 cells (32 sessions), judged like the full run on planrev-ceo-r1a-pilot.

**Pilot units are in no claim and no comparisons file.** They sit only in planrev-ceo-r1a-pilot, which shares no unit with the headline, real-neutral or Fable suites, and no comparisons file names it. At the pin, `noloss score` run on the pilot suite without a comparisons file would still print an eligible claim line (#100's /ship, outside-voice finding 3, deferred to this prereg). So R1a never runs `noloss score` on pilot units, and any such output is not a claim. The pilot is read through `noloss secondary`, which prints each arm's must-fix recall with its interval and no verdict.

Read before any full-run session:

- (a) none-opus's pilot must-fix recall (`noloss secondary`) above 0.85 or below 0.10: the panel goes back to its author.
- (b) User-simulator fallback above 10% of replies: the rec user needs repair.
- (c) particle-1 tool-use failure on more than 20% of its cells: the frozen rung drop, scored with comparisons.secondary-opus.json.
- (d) The metered cost per session re-projects the run. A projection over the cap shrinks the run in this order, each step an amendment, until it fits: the Fable rung, then the extension decoys D07 to D12, then the lens cell. The primary pair never shrinks. Or the Captain raises the cap.
- (e) Decoy noise for the false-alarm gate (GSTA-2, 2026-11-01). The pilot has no decoys, so its plans stand in: each Opus and particle-1 cell's must-fix findings ruled not-defect by blind adjudication, per pilot plan per pass. If any cell's rate is above 0.25, an honest arm could pass the gate under 80% of the time (section 4, gate-size.txt), so the round returns to the Captain before any full-run session. A pilot rate comes from 4 plans at 1 pass, so it can understate the full-run rate.
- Exit-137 sessions per arm (GST-742): any in the pilot halves `--parallel` for the full run (section 10).
- Each gstack session reached its review output (open item 3), and each gstack session's mode is in modes.tsv (open item 6).
- **Timeout** (GSTA-2, 2026-11-01). Pilot sessions run with --timeout 3600. The full run's timeout is twice the longest pilot session in any cell (Opus, particle-1 and Fable), rounded up to 300 seconds, at least 1800 and at most 3600. If any pilot session times out, the full run uses 3600. A timeout after model output scores as a miss (section 5), so a timeout set too short would turn slow sessions into misses.
- The power rerun (section 7).
- Any change the pilot drives merges as an amended prereg before full-run sessions.

## 9. Cost and cap

Re-projected at gstack's $5 reservation per Opus session (GST-538 item 2), the rig's $0.192 particle-1 allowance, and $12.50 per Fable session (Fable's list price is 2.5 times Opus's).

| Part | Sessions | Projection |
|---|---|---|
| Opus cells, 38 units (headline and real-neutral) x 3 passes x 3 cells | 342 | $1,710 |
| particle-1 cells, the same | 342 | $66 |
| Pilot, 4 units x 1 pass x 8 cells | 32 | $162 |
| Fable subset, 18 units x 1 pass x 2 cells | 36 | $450 |
| Judges, second and third reads, adjudication | | about $95 (GEVA-81's $70 to $80, scaled for the Fable cells) |
| **Total** | | **about $2,480** |

- **Cap: $2,800** ($2,000 for the Opus and particle-1 design plus up to $800 for the Fable rung, GST-659), under R42's $5,000 per thread. The Captain records it under approvals/ when this post merges. About $3,400 if gstack-auto joins.
- The worst case at the rig's allowances ($7.04 Opus, $0.192 particle-1, $17.60 Fable per session) is about $3,335 before judges, the sum of the four review-units dry runs, so the ledger cap binds first. A cap stop ends the run incomplete, and it is never retried to change a verdict.
- **Judge reserve** (GSTA-2, 2026-11-01). Because that worst case is above the cap, a cap stop could otherwise land during judging. So the session phase stops at **$2,705**: the **$2,800** cap minus the **$95 judge envelope** (the judges' row above). Every review-units command, pilot and full run alike, passes `--spend-cap` set to $2,705 minus the line item's committed spend so far (`gstack-evals ledger status --item planning-r1a`). review-units starts a round only when that round's worst case at the allowance fits under its `--spend-cap`, so sessions never take the item past $2,705, and judging and adjudication always have their $95. If gstack-auto joins, the session phase stops at its cap minus the same envelope.
- $600, the plan's figure, buys about 84 Opus sessions after the pilot, particle-1 and judges (GEVA-81's handoff). One Opus cell is 114 sessions, so $600 cannot buy the panel at $5 a session.

## 10. Run rules

- Order: cap recorded, pilot, stop checks, any amendment merged, then the full run, judging, adjudication and the results PR. Preregistration and results never share a PR.
- **Run machine** (GST-742). A unit's arms run at the same time with no memory limit, and a round holds up to `--parallel` units of one model with every arm. R1a runs at `--parallel 4`, so at most 12 sessions at once (4 units by 3 arms on Opus or particle-1), on a machine with at least 64 GB of memory, about 5 GB per session. The run records the machine's vCPU count and memory beside `--parallel` in its out dir, and the results print them. Any exit-137 session in the pilot halves `--parallel` for the full run, and the results say so.
- Spend only through the ledger, one item per paid step. Sessions run with the keys only on the rig.
- **OpenRouter route** (eng-native F12). At the pin the proxy sends every particle-1 call with the route `{only: ["particle-ai"], allow_fallbacks: false, data_collection: "deny", max_price: $0.10 input, $1 output per Mtok}` (sha256 22cb6215a4019fba2cf7949d892df384d96d0a57e12375a40fa3abe7531570d2). The dry run read OpenRouter's public endpoints API and provider feed, keyless, at 2026-11-01T11:37:21.594Z:
  - Particle AI is the only provider listed for particle-1. Its data policy there says no training and no prompt retention, so `data_collection: "deny"` keeps it.
  - It lists $0.05 input and $0.50 output, half of max_price. A listed price above max_price would refuse every particle-1 call, so the pilot and the full run each re-read it first. A price above the row stops the round before any spend; a new price row is a code change, so it comes by amendment.
  - The ledger meters particle-1 at the row, twice today's listed price, which errs safe for the cap.
  - Particle AI's own privacy policy (effective 2026-08-25, read 2026-10-31) says standard synchronous inference keeps no data by default, prompts and outputs are not used for training without an opt-in, and it is hosted in the US.
  - DeepSeek V4.1 Flash is not an R1a model. Its max_price equals its listed price, so any rise would refuse its calls; the dry run reports it for GST-637.
- **Route per session** (#101's /ship, adversarial finding 2). The session key holds no route. So each R1a run writes route.json into its out dir: the routing object the scorer at the pin sends for each OpenRouter model. The results join it to every session in cells.ndjson. Every R1a session runs at the pinned scorer sha, a resume at another sha is not allowed, and a session from one is not scored.
- **Resume** (GSTA-2, 2026-11-01). Each review-units run may take one `--resume`, at the same scorer sha, to refill its coverage gaps and the cells that never ran because the controller or its machine stopped (never cells a cap stop left, section 9). It never reruns a miss or a session with findings. At the pin, `--resume` reuses every session cells.ndjson journals, gaps included, and runs only cells with no line there (the pinned test "findings, cost, voice, resume and a changed key" in tests/trial/review/run.test.ts, which the dry run runs). So before that one resume, the run runs [refill-gaps.ts.txt](refill-gaps.ts.txt) (`bun refill-gaps.ts <scorer> <out dir>`). It moves the lines of the sessions the arms' `coverage_gaps` name, and only those, from cells.ndjson to refilled-gaps.ndjson in the out dir, and keeps every miss and findings line. Because the resume deletes a rerun cell's raw run directory first (src/trial/review/run.ts:318), the script copies each such directory to refilled-gaps/ in the out dir before it moves anything. It refuses, and changes nothing, on a second use, on a note that matches no journal line or more than one, on a named session that the pinned planScore does not score as a gap, and on a named session whose run directory is missing. A run that printed CAP_STOP takes no resume. The results report, per arm, the count of refilled sessions and their first attempts' metered spend from refilled-gaps.ndjson, since the resume drops that spend from cost.tsv. A refilled session scores like any other, and a gap left after the resume leaves its arm stopped. The dry run runs the script on a synthetic gap (GSTA-2, 2026-11-01).
- **Receipts** (#101's /ship, red-team finding 2 and adversarial finding 4). review-units refuses a sealed run whose `--out` is inside the repo. Since #106 (GST-737), a sealed suite, or an unsealed one that reads catalogs under the sealed root, also refuses a receipts sink (GSTACK_EVALS_RECEIPTS) inside the repo with E_USAGE before any session; the dry run runs the pinned harness's own tests for both. #107 adds that the sink refuses symlinks, a dangling parent and any target with more than one hard link, and that every noloss writer refuses in-repo output when the suite reads the sealed root. Beside that check, R1a keeps a procedural rule: `--out` root and any receipts sink (GSTACK_EVALS_RECEIPTS) sit under ~/.capy/work/planning-r1a, outside the repo and every drive. After the run, the run dir and the retained unit trees review-units writes under the state root (`<stateRoot>/retained`, which holds `retained/trees/`: ~/.capy/work/gstack-evals/retained on Capy, or $XDG_STATE_HOME/gstack-evals/retained when that is set) are sealed with age to the panel's recipient, beside the panel bundle, and their plaintext is deleted and checked gone with `test ! -e` (GSTA-2, 2026-11-01). At e305ed0 review-units keeps every unit tree there on every run, outside the run dir (src/trial/review/cli.ts:261, src/trial/image.ts:264). The run machine starts with no `<stateRoot>/retained`, checked with `test ! -e` before the first session, so the sealed copy holds only R1a's trees. Sealing and deletion happen after the run's one resume, if any, and never before it, because a resume rebuilds and re-retains any tree it lacks.
- Panel material is decrypted outside every checkout at run time, and every opening is logged in CUSTODY.md.

## 11. Planned amendments

- gstack-auto (section 2), when GST-537 releases.
- The judge identifiability probe (section 6), when its tool lands.
- Any pilot-driven change (section 8).

## 12. Departures from the plan's text

| Plan | Here | Why |
|---|---|---|
| R1a cap $600 | $2,800 | GST-538 item 2: $5 per Opus session; Fable rung, GST-659 |
| 6 decoys | 12 | Open item 7, "decoys rise to 12 if the cap allows" |
| 3 real units in the headline | 2, alone | GST-538 item 1 and ceo-native F11; B5 found two |
| Sealed suite registered in the repo | stub only | Open item 1 |
| Primary judge gpt-6.1-sol, second Opus, third read | same, third judge Sonnet 5.5 | judge-run needs a distinct third model |
| No Fable | exploratory Fable rung | Garry, GST-659 |
| Ladder re-read at prereg | cites #95's same-day reading | this thread runs keyless |

## 13. Dry run

[dryrun.txt](dryrun.txt) is the keyless dry run at the pin, through the pinned scorer, on the real suites with synthetic arms; [dryrun.ts.txt](dryrun.ts.txt) is its script. GEVA-96 reran it on 2026-11-01 at 12:55 UTC after the rebuild that #110's /ship Step 11 asked for, opening the run bundle under custody (CUSTODY.md logs the opening and the deletion of the plaintext). It checks 170 things and all pass: the stub and every suite load, and the stub refuses without the sealed root; the frozen review-units commands plan 648, 36, 32 and 36 sessions, and gstack-auto is refused; synthetic arms go through blind judging and adjudication on the real plan trees; both families print their Holm steps (of 2, of 3); every primary, secondary and Fable comparison carries the gate at margin 0.5, and each decoy is its own cluster, as gate-size.ts.txt assumes; the gate passes the real-shaped arms and, on 12 decoys, fails a flag-everything arm and a flag-every-bait arm with no other false alarm, which passes at the old margin 1; Fable is refused under the default policy and under any ledger item but planning-r1a; a sealed run with an in-repo `--out` is refused; the particle-1 drop refuses the full secondary file and scores the Opus-only one as a family of 1; first-k 2, any severity, missing cells, a stopped arm, by-source (24 flaws each) and by-mode (16 flaws in 8 plans each) readings run; the real-neutral and Fable suites score; no pilot unit sits in a scored suite, no comparisons file names the pilot suite, score refuses the pilot suite under each of the 5 frozen files, and the pilot stop (a) reading comes from `noloss secondary` with no verdict or claim; power counts 24 clusters and 48 flaws; particle-1's route keeps an endpoint under the data policy and max_price (section 10), and route.json is written; the Fable reading prints its no-claim line; the frozen run paths sit outside the repo, and `<stateRoot>/retained` resolves where the cleanup rule says, outside the run root; every test in the pinned tests/trial/review/plan-scoring.test.ts, tests/adapters/claude-code.test.ts and tests/trial/review/run.test.ts passes (71 tests), with each outcome case in section 5, each receipts-sink refusal and the resume's reuse of a journaled gap checked by name; and refill-gaps.ts, on a synthetic findings session, miss and gap, moves the gap's line alone, copies its run directory, keeps the other two lines byte for byte, and refuses a second use and a miss named as a gap. The transcript drops every line that names a unit, and its last check confirms no unit head or base prefix appears in it. Scripts are kept as .txt so nothing runs them from the wiki.
