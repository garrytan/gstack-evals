---
id: 2026-11-22-geva-560-destructive-guard-counts-correction
kind: finding
title: "Correction to the two destructive-command guard replays: the counts their attachments left out, and one mislabelled hook"
summary: "No number changes. Attaches the counts the two guard replays published but left out of counts.json, and corrects one label: the 9055979 incident set ran through /careful, not the default hook."
author: GEVA-560
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-22
status: done
supersedes:
  - 2026-11-21-geva-560-destructive-guard-before-after
  - 2026-11-22-geva-560-destructive-guard-9055979
links:
  - garrytan/gstack-evals#394
  - garrytan/gstack-evals#437
attachments:
  - 7439cf4bc23e952aff712ceaf404fca88564206d77049e724b484404ceac5333  correction-counts.json
---

# Correction to the two destructive-command guard replays: the counts their attachments left out, and one mislabelled hook

- **We learned that both guard replays published counts their attached counts.json did not hold, though each said it held every count in its Result section.** We recounted each missing count from the same per-command results the posts used, and every one matches the number already published. No number, rate, interval or conclusion changes.
- **We learned that one label in the 9055979 post's counts.json is wrong.** Its incident-set entry says the totals came from the default hook. They came from /careful (E1). The totals themselves are right.
- **You should read [the before-and-after replay](../2026-11-21-geva-560-destructive-guard-before-after/README.md) (#394) and [the 9055979 replay](../2026-11-22-geva-560-destructive-guard-9055979/README.md) (#437) as they stand, with correction-counts.json beside them as the record for the counts listed below.** Merged posts don't change, so both bodies stay as they merged and only their status moves to superseded.

## What the before-and-after replay left out

Its Replicate section says counts.json holds every count in the Result section. These Result-section counts were not in it. They are now in correction-counts.json under the post's id.

| Published count | Value in the post | Key in correction-counts.json |
|---|---|---|
| Label-corrected destructive denominator | 940 (948 less 8 label errors) | destructive_label_corrected |
| Repo-session destructive calls, corrected | 12 calls; caught 8 by main, and 11 by careful_v2 and each later build | repo_destructive_calls_corrected |
| Sessions with a harmless ask or deny (of 14,448) | main 1,588; careful_v2 379; 55aaa6c4 438; 17303862 516; ab6a38b7 516 | sessions |
| Paired table, main against ab6a38b7 | flagged by both, only ab6a38b7, only main and neither: 442, 488, 1 and 17 destructive; 761, 220, 2,792 and 249,311 harmless; 20, 127, 4 and 139 context | paired_ab6a_vs_main |
| /guard against /careful | the same decision on all 7,013 commands /guard ran on | hook_agreement_ab6a |
| The default hook against /careful, interactive | the same decision on all 254,322 | hook_agreement_ab6a |
| Headless modes | 2,045 asks become warnings and 13 denies stay, in claude -p, an Agent SDK session with no gstack marker and an unattended session | headless_modes_ab6a |
| Whole-corpus latency at ab6a38b7 | /careful p50 68 ms and p99 95 ms; the default hook p50 103 ms and p99 131 ms | latency_full_corpus_ab6a |

## What the 9055979 replay left out or mislabelled

- **The 940 denominator.** Its Replicate section says counts.json holds every count in the Result section, but the label-corrected row's 940 (948 less the same 8 label errors) was not in it. It is now under destructive_label_corrected.
- **The incident-set hook.** counts.json's incident_set unit says the totals came from the default hook path E1. E1 is the /careful hook, and the default hook is E3, as the post's latency entry and probe files say. The incident-set totals (49 of 50 destructive caught, 11 denied, 9 of 51 twins asked at 9055979) come from E1. incident_set_hook records the correction.
- **Headless modes.** The post's What works section says 2,046 asks become warnings and 13 denies still block. That sits outside the Result section, but no attachment held it, so headless_modes_9055 now does.

## How we recounted

From the per-command decisions of the runs both posts used, on 2026-11-22: the same corpus, frozen labels, label corrections, session index and hook outputs, read again with the same counting rules. Every count reproduced the published number. The headless-mode counts read the default hook's decisions on every command it asked on or denied in an interactive session.

## Replicate it

The corpus and the per-command results come from private transcripts, so these counts can't be rerun from here. The incident set and the probes rerun as each post's Replicate section describes.

## What is held out, and why

As in both posts: the corpus, its labels, the per-command results and the replay scripts stay with the private record, because the commands come from private transcripts. correction-counts.json holds counts only, and this note quotes no command.

## Changelog

- 2026-11-22: first version.
