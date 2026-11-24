# Review-models scoring

The scoring part of the review-models eval (GEVA-590): wiki/plans/2026-11-24-geva-590-review-models-prereg, sections 4,
7 and 8, the judge check and the interim look, as wiki/plans/2026-11-24-geva-590-review-models-pre-run-change-1 amends
them. Nothing here calls a model: the judge and the labellers get request builders and reply readers, and the caller
sends the requests through the metering proxy.

- frozen.ts: the frozen constants and the refusal helper.
- judge.ts: the Carbon request (OpenRouter, google-vertex only, default effort), the normalised numbered findings, the
  reply parser and the one-retry rule, and gstack's blocking rule.
- location.ts: the judge-free location hit and its agreement with the judge.
- score.ts: per-review catches, the unit table under each reading, arm summaries and cost.tsv rows.
- stats.ts: the clustered bootstrap standard error every bound uses.
- labels.ts: the labellers' items, requests and replies, the adjudication round and the kappa gate.
- staged.ts: the cost gap, the headroom, the Fable drop rule and the frozen proceed sets.
- look.ts: the contrasts, the binding futility look and the final read.

## Readings the plan leaves open

- The cost gap's "lower 95% bound" is the mean minus 1.96 clustered bootstrap standard errors, the lower end of the
  interval change 1 item 4 prints. It can only keep Fable in against a one-sided bound.
- Gaps and contaminated reviews are scored dropped and as a miss, and the plan names neither as the decider. A verdict
  holds only when both readings give it, and the look stops a contrast only when both readings cross.
- At the look, a cell stops when no open decision contrast uses it. OS and N never stop.
- A label pair that still disagrees after adjudication stays in the check, read both ways, and the lower kappa stands.
  In the pilot's judge column it counts as an error.
- Decoy reviews carry no known bug, so the judge check leaves them out.
- An empty, cut-off, refused or unreadable judge reply gets the same one retry.
