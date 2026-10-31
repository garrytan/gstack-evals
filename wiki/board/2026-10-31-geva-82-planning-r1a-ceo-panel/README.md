---
id: 2026-10-31-geva-82-planning-r1a-ceo-panel
kind: handoff
title: "Planning R1a CEO flaw panel v1 (B5): 40 authored units in interim encrypted custody, plus 2 real-neutral units"
summary: "B5 for planning R1a: 24 seeded, 12 decoy and 4 pilot CEO plan units plus 2 real-neutral; bodies and keys encrypted in interim custody; counts, source tags and digests here."
author: GEVA-82
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-10-31
status: done
links:
  - 2026-10-31-geva-79-planning-lane-plan
  - GST-576
  - GST-538
attachments:
  - 120f0ea999b6ff5162c0177b0c3aacff417f58a4bc0b7d6f11749247b6aa4fdd  echo-terms.txt
  - c3f0ec55b0c1e425d9efa145a40d9f4dc05f38fd3e411eb31efb98651a9c4246  panel.json
  - afff4c938fbc011016f679e06385dbcf83e02a427fddb36489e7975e119be202  real-neutral.md
  - 7067b1a69604698a3b6f0e7c1cf34fa896fc13a1fe8e68a5bb8e42b6d4f0b662  taxonomy-2.md
---
# Planning R1a CEO flaw panel, v1

This is plan step B5 of [the planning lane plan](../../plans/2026-10-31-geva-79-planning-lane-plan/README.md): the CEO flaw panel that round R1a scores every arm on. These arms are the no-gstack arm, the gstack CEO arms named in GST-538 (the non-interactive /autoplan CEO mode once GST-537 ships, and standalone /plan-ceo-review) and the lens and placebo arms. R1a's preregistration (B8) cites this post. It holds counts, strata, source tags and sha256 digests. The plan bodies and answer keys are not here.

## Custody

The bodies and keys are held in **procedural custody (interim, Captain drive, encrypted)**. The store that plan v3.2 designs, a private repo owned by a second principal, does not exist yet. So the Captain (GEVA-2) ruled on GST-576 that the panel goes into one age-encrypted bundle in the Captain's Capy Drive, with the decryption key in a separate project-user drive.

| Field | Value |
|---|---|
| Bundle | planning-r1a-ceo-panel-v1.tar.age |
| Bundle sha256 | 2898122b24bc826ec2d8bcda7459a0526aa06beaca035781ae96a8ccb57d2f67 |
| Inner tar sha256 | 32da862a4a106e609bcb26683411fb6ee8b6b44a301f38337f1cb4270a1b40b9 |
| age recipient | age1qru8aggfw8sgaxrx7whjfjksptqr4rnqaaxns4xq9auxxepe9susevg7vr |
| Units | 42 (24 seeded, 12 decoys, 4 pilots, 2 real-neutral) |

- Any thread in the gstack-evals project under Garry's account can read the key, so access is a crew rule, not a lock. Only the thread that runs R1a and a custodian the Captain names may use it. GStack Minder, which builds the gstack candidate under test (GST-537), has no access to the key or the bodies.
- Exposures: the authors (openai/gpt-6.1-sol), the auditors (anthropic/claude-opus-5-5) and the panel builder GEVA-82 (anthropic/claude-opus-5-5, which handled files by script and saw ids, categories, sizes and audit summaries). The section on authoring and audit below gives the detail.
- After the bundle was verified by decrypting it and re-deriving every unit digest, every plaintext copy on the author, auditor and builder machines was deleted.
- When the planned custody repo exists, the bundle moves there byte for byte, so every digest here stays valid. This is not "sealed" in plan v3.2's sense. The custody record sits beside the bundle in the Captain drive (handoffs/GEVA-82/sealed/CUSTODY.md).

## What the panel holds

| Stratum | Greenfield | Added capability | Fix | Total | Role |
|---|---|---|---|---|---|
| Seeded, two flaws each | 8 | 8 | 8 | 24 | recall |
| Decoy, core set, one bait each | 2 | 2 | 2 | 6 | false alarms |
| Decoy, extension set | 2 | 2 | 2 | 6 | false alarms, if the prereg takes 12 |
| Pilot, two flaws each | 2 | 1 | 1 | 4 | never scored |
| Real-neutral, one real flaw each | 1 | 1 | 0 | 2 | reported alone |

- Every seeded and pilot unit carries one group W flaw ("builds the wrong thing") and one group B flaw ("builds the right thing badly"), Garry's framing of what a CEO review should catch.
- The 48 seeded flaws split 24 from each taxonomy: 12 W and 12 B from each.
- Decoy baits: half resemble a T1 category and half a T2 category, three and three in each decoy set. A bait is a deliberate choice that the unit's context justifies, so flagging it as must-fix is a false alarm.
- The modes follow Open item 6: greenfield (a new product), added capability (a feature on an existing product) and fix (a known problem in an existing product).
- Every unit is a small git repo. Its base commit holds context/ (3 to 6 markdown files: goals, research notes, tickets, metrics, what exists today, constraints) and, in 4 authored units, a small src/. Its head commit adds plan.md and nothing else. Authored plans are 2,761 to 4,007 bytes. The products are fresh and fictional.
- panel.json holds the bundle digests, unit counts by stratum, decoy set and mode, source tag counts and the authored plan-byte range. The per-unit table (unit, kind, mode, tags, tree sha256, plan bytes, file count, head and base commits, key sha256) lives in the bundle's manifest.json, which the bundle and tar sha256 cover.

## Two taxonomies

**T1** is section 4's CEO row of the plan, in eight categories: T1-W1 problem mismatch, T1-W2 target user mismatch, T1-W3 proxy or missing success measure, T1-W4 contradicted premise, T1-B1 oversized scope, T1-B2 rebuilding what exists, T1-B3 risky unknown last, and T1-B4 irreversible step without a case. Open item 5 notes that T1 overlaps /plan-ceo-review's own checklist, so it is home field in part.

**T2** is attached as taxonomy-2.md. A gpt-6.1-sol subagent wrote it blind:
- It never read the repo checkout, this plan or any gstack file.
- It ran only gstack's install check with `--for none`, which installs nothing.
- It did not search the web for gstack or named review skills.

T2 has six W and six B categories, and it overlaps T1 in places:
- **Shared ideas:** wrong audience, wrong problem and unnecessary scope.
- **New in T2:** solution misses the cause, wrong trade-off, unsustainable exchange, no workable path to adoption, promises exceed capacity, and expansion that ignores outcomes.
- **Different grouping:** T2 puts "an existing option already does it" in group W, where T1 has it in B. It also frames a bad success signal as an expansion rule in group B, where T1 has it in W.

**Assignment.** Each T1 category appears in three seeded units, each T2 category in two. Twelve seeded units pair a T1 W flaw with a T2 B flaw, and twelve pair a T2 W flaw with a T1 B flaw, four of each kind per mode. Two near-duplicate pairs never share a unit: T2-W4 with T1-B2, and T1-W3 with T2-B6. Every flaw carries its source tag, so R1a can report recall per source, as Open item 5 requires.

## Authoring and audit

**Authors.** Four gpt-6.1-sol subagents wrote ten units each, across all three modes, under the same blindness rules. Their spec required:
- every flaw detectable from the unit tree alone, and changing what gets built;
- no signposting, and no CEO-level flaws beyond the keyed ones;
- no taxonomy or review words in any tree file.

Each key names the flaw's category and source, the exact plan.md heading, the cause, the evidence paths, what changes once it is fixed, the deserved severity and the fix.

**Auditors.** Two Opus 5.5 subagents audited the panel on machines with no gstack installed. Each confirmed that no gstack checkout existed and ran only the `--for none` check. Per flaw they checked:
- that it is detectable from the tree alone;
- that it changes what gets built;
- that the key states the cause and a real plan heading;
- category fit, no signposting and independence of the two flaws.

Per unit they checked for no unkeyed CEO-level flaw. Per decoy they checked that the bait is visible, justified by the context, and the only near-flaw.

**Echo terms.** Every unit was also checked against echo-terms.txt (attached): a frozen list of terms from the headings of gstack 1.91.379.0's plan-ceo-review skill and autoplan's CEO phase. A script scanned every tree, and the auditors read for mirrored headings. The final panel has no hits.

**Bias guard.** The auditors were told not to fail a flaw for being subtle and never to ask for a flaw to be made more obvious than detectability needs.

**Results.** 40 of 40 authored units pass, and none were dropped. There were seven rewrites:
- S23: one number, to remove an unkeyed flaw;
- S22: twice, first for independence and then for a context sentence that hinted at a flaw;
- D08: an echo term the scan caught;
- S06: a path reference;
- S20: a premise the plan stated outright, against its category;
- D11: a decoy figure that disagreed with its context.

The auditors also noted that several plans state a rejected option outright, which they judged to be the flawed decision itself and not an admission. They also noted that some patterns recur across units, for example P01 and S19 share a template. Each review session sees one unit, so a recurring pattern cannot cue a reviewer within a session.

## Real-neutral stratum

real-neutral.md (attached) gives the two real-neutral CEO units, R01 and R02, in our words, with public sources and rebuild recipes. Two candidates were dropped, with reasons. The search widened to superseded posts, Captain drive reports and public garrytan repos, as the Medium item asks. The stratum is reported alone, and the headline stays seeded-only (ceo-native F11).

## For the R1a preregistration

- Cite the bundle sha256 and panel.json.
- Choose 6 or 12 decoys before the pilot. Both sets are balanced by mode and by bait source.
- The four pilot units are never scored, and their ids are in the Captain drive handoff.
- Report recall by source (T1, T2) and by mode, beside the headline.
- 24 seeded units is a floor (Open item 12). Freeze the panel size after the pilot.

## Limits

- One model family wrote every authored unit from both taxonomies. The auditors share a family with the Opus arms. Seeded flaws are not natural flaws, and the real-neutral check on that has only two units.
- Custody is procedural. Author and auditor transcripts hold the bodies and are readable in the organization.
